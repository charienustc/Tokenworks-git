/**
 * Host half of the git panel: a read surface plus the write surface the panel
 * exposes over the composition's HTTP carrier.
 *
 * Security has one home, here. Every route asks the composition's `connection`
 * service for a rejection first: its Host/Origin fence and browser
 * authentication gate every caller before any repository fact is reachable. On
 * top of that fence each route validates its own inputs: a workspace directory
 * the composition has registered, repository-relative pathspecs, branch and tag
 * names, commit-ish revisions, and a commit message.
 *
 * Every route that changes repository state is serialized, so two of them never
 * race git's index lock, and the whole write group is refused when the row's
 * `allowWrite` is false.
 *
 * The write surface is bounded on purpose. There is no force anywhere
 * (`push --force`, `branch -D`, `checkout --force`), no `reset --hard`, and no
 * deletion of untracked files: each of those destroys work that git cannot give
 * back, so the panel refuses them rather than offering a confirmation prompt.
 */

import { createGit, GitError } from './lib/git.js';

/** Cordis function-plugin name. */
export const name = 'git-panel';

/** The route carrier, the trust fence, and the process provider. */
export const inject = ['webServer', 'connection', 'subprocess'];

/** Every route this plugin owns lives under this prefix. */
const BASE = '/git-panel';

/** Largest request body accepted on a write endpoint. */
const MAX_BODY_BYTES = 256 * 1024;

/** Longest git output echoed back to the panel, in characters. */
const MAX_ECHO = 4000;

/** JSON response; every fact here is live, so nothing is cacheable. */
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** 405 carrying the methods the path does support. */
function methodNotAllowed(res, allow) {
  res.statusCode = 405;
  res.setHeader('allow', allow);
  res.end();
}

/** Collect a bounded UTF-8 request body; null once the ceiling is passed. */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** HTTP status for one adapter failure code. */
function statusFor(code) {
  if (code === 'read-only') return 403;
  if (code === 'timeout') return 504;
  if (code === 'spawn-failed' || code === 'git-failed') return 500;
  if (code === 'git-exit' || code === 'commit-failed') return 409;
  return 400;
}

/** Echo git's own summary back to the panel, bounded and stripped of progress noise. */
function echo(result) {
  const stdout = String((result && result.stdout) || '').trim();
  const raw = stdout === '' ? String((result && result.stderr) || '').trim() : stdout;
  const text = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(-6)
    .join('\n');
  return text.length > MAX_ECHO ? `${text.slice(0, MAX_ECHO)}…` : text;
}

/** Parse the JSON body of a write request, or throw a validation GitError. */
async function jsonBody(req) {
  const media = String(req.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (media !== 'application/json') {
    throw new GitError('请求必须是 application/json', { code: 'bad-request' });
  }
  const raw = await readBody(req);
  if (raw === null) throw new GitError('请求体过大', { code: 'bad-request' });
  try {
    return JSON.parse(raw);
  } catch {
    throw new GitError('请求体不是合法 JSON', { code: 'bad-request' });
  }
}

/**
 * Host plugin body: build the adapter and register one route per path.
 * @param ctx - host context carrying the injected services.
 * @param config - the bundle row's configuration.
 */
export function apply(ctx, config) {
  const git = createGit(ctx, config ?? {});

  /** Write operations run one at a time: git's index lock is not reentrant. */
  let writeChain = Promise.resolve();
  function serialize(operation) {
    const next = writeChain.then(operation, operation);
    writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Wrap one handler with the trust fence and uniform error reporting. */
  function guarded(handler) {
    return async (req, res) => {
      try {
        const rejection = ctx.connection.requestRejection(req);
        if (rejection !== undefined) {
          res.statusCode = rejection;
          res.end();
          return;
        }
        await handler(req, res);
      } catch (error) {
        const code = error instanceof GitError ? error.code : 'internal';
        json(res, statusFor(code), {
          ok: false,
          error: { code, message: String((error && error.message) || error) },
        });
      }
    };
  }

  /** Authorize the workspace directory named by the query string. */
  async function queryRoot(url) {
    return git.allowedRoot(url.searchParams.get('root') ?? '');
  }

  const endpoints = [
    {
      path: `${BASE}/status`,
      GET: guarded(async (req, res) => {
        const root = await queryRoot(new URL(String(req.url), 'http://localhost'));
        const status = await git.status(root);
        const identity = status.repo === true ? await git.identity(status.root) : null;
        json(res, 200, {
          ok: true,
          status,
          capabilities: {
            allowWrite: git.settings.allowWrite === true,
            identity,
            logLimit: git.settings.logLimit,
            maxDiffBytes: git.settings.maxDiffBytes,
          },
        });
      }),
    },
    {
      path: `${BASE}/diff`,
      GET: guarded(async (req, res) => {
        const url = new URL(String(req.url), 'http://localhost');
        const root = await queryRoot(url);
        const side = url.searchParams.get('side') ?? 'worktree';
        if (side !== 'worktree' && side !== 'index' && side !== 'untracked') {
          throw new GitError('side 只能是 worktree、index 或 untracked', { code: 'bad-request' });
        }
        const result = await git.diff(root, { side, path: url.searchParams.get('path') ?? '' });
        json(res, 200, { ok: true, diff: result });
      }),
    },
    {
      path: `${BASE}/log`,
      GET: guarded(async (req, res) => {
        const url = new URL(String(req.url), 'http://localhost');
        const root = await queryRoot(url);
        const limit = Number(url.searchParams.get('limit') ?? '') || git.settings.logLimit;
        const result = await git.log(root, {
          limit,
          skip: Number(url.searchParams.get('skip') ?? '') || 0,
          all: url.searchParams.get('all') === '1',
          path: url.searchParams.get('path') ?? '',
        });
        json(res, 200, { ok: true, ...result });
      }),
    },
    {
      path: `${BASE}/commit`,
      GET: guarded(async (req, res) => {
        const url = new URL(String(req.url), 'http://localhost');
        const root = await queryRoot(url);
        const commit = await git.commitDetail(root, url.searchParams.get('rev') ?? '');
        json(res, 200, { ok: true, commit });
      }),
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        const outcome = await serialize(() => git.commit(root, body.message));
        json(res, 200, { ok: true, commit: outcome });
      }),
    },
    {
      path: `${BASE}/branches`,
      GET: guarded(async (req, res) => {
        const root = await queryRoot(new URL(String(req.url), 'http://localhost'));
        const result = await git.branches(root);
        json(res, 200, { ok: true, ...result });
      }),
    },
    {
      path: `${BASE}/stage`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        const outcome = await serialize(() => git.stage(root, body.paths));
        json(res, 200, { ok: true, stage: { exitCode: outcome.exitCode } });
      }),
    },
    {
      path: `${BASE}/unstage`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        const outcome = await serialize(() => git.unstage(root, body.paths));
        json(res, 200, { ok: true, unstage: { exitCode: outcome.exitCode } });
      }),
    },
    {
      path: `${BASE}/remotes`,
      GET: guarded(async (req, res) => {
        const root = await queryRoot(new URL(String(req.url), 'http://localhost'));
        json(res, 200, { ok: true, remotes: await git.remotes(root) });
      }),
    },
    {
      path: `${BASE}/branch`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        // The button means "create and work on it", so this always switches.
        await serialize(() => git.createBranch(root, body.name, body.start, true));
        json(res, 200, { ok: true, branch: { name: String(body.name ?? '') } });
      }),
    },
    {
      path: `${BASE}/checkout`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        await serialize(() => git.checkout(root, body.ref, { detach: body.detach === true }));
        json(res, 200, { ok: true, checkout: { ref: String(body.ref ?? '') } });
      }),
    },
    {
      path: `${BASE}/branch-delete`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        await serialize(() => git.deleteBranch(root, body.name));
        json(res, 200, { ok: true, branch: { name: String(body.name ?? '') } });
      }),
    },
    {
      path: `${BASE}/tag`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        await serialize(() => git.createTag(root, body.name, body.rev));
        json(res, 200, { ok: true, tag: { name: String(body.name ?? '') } });
      }),
    },
    {
      path: `${BASE}/tag-delete`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        await serialize(() => git.deleteTag(root, body.name));
        json(res, 200, { ok: true, tag: { name: String(body.name ?? '') } });
      }),
    },
    {
      path: `${BASE}/sync`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        const action = String(body.action ?? '');
        const outcome = await serialize(() => {
          if (action === 'fetch') return git.fetch(root);
          if (action === 'pull') return git.pull(root);
          if (action === 'push') {
            return git.push(root, {
              remote: body.remote,
              branch: body.branch,
              setUpstream: body.setUpstream === true,
            });
          }
          throw new GitError('action 只能是 fetch、pull 或 push', { code: 'bad-request' });
        });
        json(res, 200, { ok: true, sync: { action, output: echo(outcome) } });
      }),
    },
    {
      path: `${BASE}/discard`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        const outcome = await serialize(() => git.discard(root, body.paths));
        json(res, 200, { ok: true, discard: { exitCode: outcome.exitCode } });
      }),
    },
    {
      path: `${BASE}/undo`,
      POST: guarded(async (req, res) => {
        const body = await jsonBody(req);
        const root = await git.allowedRoot(body.root ?? '');
        const action = String(body.action ?? '');
        const rev = String(body.rev ?? '');
        await serialize(() => {
          if (action === 'reset') return git.reset(root, rev, body.mode);
          if (action === 'revert') return git.revert(root, rev);
          if (action === 'cherry-pick') return git.cherryPick(root, rev);
          if (action === 'merge') return git.merge(root, rev);
          throw new GitError('action 只能是 reset、revert、cherry-pick 或 merge', { code: 'bad-request' });
        });
        json(res, 200, { ok: true, undo: { action, rev } });
      }),
    },
  ];

  for (const endpoint of endpoints) {
    const methods = Object.keys(endpoint).filter((key) => key !== 'path');
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path: endpoint.path,
          handler: (req, res) => {
            const method = String(req.method ?? 'GET').toUpperCase();
            const handler = endpoint[method];
            if (typeof handler !== 'function') {
              methodNotAllowed(res, methods.join(', '));
              return undefined;
            }
            return handler(req, res);
          },
        }),
      `git-panel: ${methods.join('/')} ${endpoint.path}`,
    );
  }
}
