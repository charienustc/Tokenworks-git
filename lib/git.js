/**
 * Git CLI adapter for the git panel.
 *
 * One bounded, argv-only execution path over `ctx.subprocess` plus parsers for
 * the machine-readable formats it consumes. The adapter owns this plugin's git
 * safety rules:
 *
 * - the executable is resolved once through the composition's subprocess
 *   provider, never a guessed path;
 * - the environment is the provider's scrubbed one plus explicit git settings,
 *   so `git` can never block on a terminal prompt or spawn a pager;
 * - arguments are an enumerated set of subcommands and validated paths, never
 *   free-form user text and never a shell string;
 * - every invocation has a hard timeout and bounded collected output;
 * - only three commands (`add`, `restore --staged`, `commit`) change repository
 *   state, and each is reachable solely through its own dedicated method.
 */

/** Git environment overrides applied to every invocation. */
const GIT_ENV = Object.freeze({
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
});

/** Default settings; the bundle row's `config` overrides them. */
export const GIT_DEFAULTS = Object.freeze({
  gitPath: 'git',
  timeoutMs: 20000,
  writeTimeoutMs: 120000,
  maxOutputBytes: 8 * 1024 * 1024,
  maxDiffBytes: 512 * 1024,
  logLimit: 200,
  allowWrite: true,
  commitNoVerify: false,
});

/** One failed git invocation, carrying the facts its caller renders. */
export class GitError extends Error {
  /**
   * @param message - human diagnostic.
   * @param details - failure facts.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'GitError';
    this.code = details.code ?? 'git-failed';
    this.args = details.args;
    this.exitCode = details.exitCode;
    this.stderr = details.stderr;
    this.timedOut = details.timedOut === true;
  }
}

/** Read collected output at offset 0, which is non-consuming for these providers. */
function readCollected(reader) {
  if (reader === undefined) return { text: '', truncated: false };
  const read = reader.readFrom(0);
  return { text: read.text, truncated: read.lossy === true };
}

/** Fold one porcelain status column into a display letter (empty means unmodified). */
function statusLetter(letter) {
  if (letter === '.' || letter === ' ' || letter === '' || letter === '?') return '';
  return letter;
}

/**
 * Parse `git status --porcelain=v2 -z --branch -uall`.
 * @param raw - the NUL-delimited output.
 * @returns branch facts and one entry per changed path.
 */
export function parseStatus(raw) {
  const branch = { oid: null, head: null, upstream: null, ahead: 0, behind: 0 };
  const entries = [];
  let renameSource = false;
  for (const token of raw.split('\0')) {
    const record = token.replace(/^\n+/, '').replace(/\n+$/, '');
    if (record === '') continue;
    if (renameSource) {
      renameSource = false;
      const target = entries[entries.length - 1];
      if (target !== undefined) target.origPath = record;
      continue;
    }
    if (record.startsWith('# ')) {
      const header = record.slice(2);
      if (header.startsWith('branch.oid ')) branch.oid = header.slice(11).trim();
      else if (header.startsWith('branch.head ')) branch.head = header.slice(12).trim();
      else if (header.startsWith('branch.upstream ')) branch.upstream = header.slice(16).trim();
      else if (header.startsWith('branch.ab ')) {
        const match = /^\+(\d+) -(\d+)$/.exec(header.slice(10).trim());
        if (match !== null) {
          branch.ahead = Number(match[1]);
          branch.behind = Number(match[2]);
        }
      }
      continue;
    }
    const kind = record[0];
    if (kind === '1' || kind === '2') {
      const parts = record.split(' ');
      const xy = parts[1] ?? '..';
      const path = parts.slice(kind === '2' ? 9 : 8).join(' ');
      const entry = { kind: 'changed', x: statusLetter(xy[0]), y: statusLetter(xy[1]), path, origPath: null };
      if (kind === '2') renameSource = true;
      entries.push(entry);
      continue;
    }
    if (kind === 'u') {
      const parts = record.split(' ');
      const xy = parts[1] ?? 'UU';
      entries.push({
        kind: 'conflicted',
        x: statusLetter(xy[0]) || 'U',
        y: statusLetter(xy[1]) || 'U',
        path: parts.slice(10).join(' '),
        origPath: null,
      });
      continue;
    }
    if (kind === '?') {
      entries.push({ kind: 'untracked', x: '?', y: '?', path: record.slice(2), origPath: null });
      continue;
    }
  }
  return { branch, entries };
}

/** Group entries into the four lists the panel renders. */
export function groupChanges(entries) {
  const staged = [];
  const unstaged = [];
  const untracked = [];
  const conflicted = [];
  for (const entry of entries) {
    if (entry.kind === 'untracked') {
      untracked.push(entry);
      continue;
    }
    if (entry.kind === 'conflicted') {
      conflicted.push(entry);
      continue;
    }
    if (entry.x !== '') staged.push(entry);
    if (entry.y !== '') unstaged.push(entry);
  }
  return { staged, unstaged, untracked, conflicted };
}

/** Parse `-z --pretty=format:` log output into commit records. */
export function parseLog(raw) {
  const commits = [];
  for (const record of raw.split('\0')) {
    if (record === '') continue;
    const fields = record.split('\x1f');
    if (fields.length < 6) continue;
    commits.push({
      hash: fields[0],
      parents: fields[1] === '' ? [] : fields[1].split(' '),
      author: fields[2],
      date: fields[3],
      refs: fields[4]
        .split(', ')
        .map((ref) => ref.trim())
        .filter((ref) => ref !== ''),
      subject: fields[5],
    });
  }
  return commits;
}

/** Display name and kind for one full ref name. */
export function classifyRef(fullName) {
  if (fullName.startsWith('refs/heads/')) return { kind: 'local', name: fullName.slice(11) };
  if (fullName.startsWith('refs/remotes/')) return { kind: 'remote', name: fullName.slice(13) };
  if (fullName.startsWith('refs/tags/')) return { kind: 'tag', name: fullName.slice(10) };
  return { kind: 'other', name: fullName };
}

/** Parse `for-each-ref` output into branch records. */
export function parseRefs(raw) {
  const refs = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const fields = line.split('\x1f');
    if (fields.length < 6) continue;
    const { kind, name } = classifyRef(fields[0]);
    if (name.endsWith('/HEAD')) continue;
    refs.push({
      kind,
      name,
      hash: fields[1],
      upstream: fields[2] === '' ? null : fields[2],
      track: fields[3] === '' ? null : fields[3],
      head: fields[4].trim() === '*',
      date: fields[5],
      subject: fields[6] ?? '',
    });
  }
  return refs;
}

/**
 * Build the adapter bound to one composition context.
 * @param ctx - host context carrying `subprocess` (and `fs` for untracked files).
 * @param config - bundle row configuration merged over {@link GIT_DEFAULTS}.
 * @returns the read and write operations the routes call.
 */
export function createGit(ctx, config) {
  const settings = { ...GIT_DEFAULTS, ...(config ?? {}) };
  let executable = null;

  /** Resolve and cache the git executable; a failure is retried on the next call. */
  async function gitPath() {
    if (executable !== null) return executable;
    executable = await ctx.subprocess.resolveExecutable(settings.gitPath);
    return executable;
  }

  /**
   * Run one git invocation.
   * @param args - complete argv after the executable.
   * @param options - working directory, deadline, output ceiling, cancellation.
   * @returns exit code, both streams, and truncation/timeout facts.
   */
  async function run(args, options = {}) {
    const { cwd, timeoutMs = settings.timeoutMs, maxBytes = settings.maxOutputBytes, signal } = options;
    const binary = await gitPath();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal !== undefined) {
      if (signal.aborted) throw new GitError('cancelled', { code: 'cancelled', args });
      signal.addEventListener('abort', onAbort, { once: true });
    }
    let handle;
    try {
      handle = ctx.subprocess.spawn({
        argv: [binary, ...args],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes },
          stderr: { maxBytes: 256 * 1024 },
        },
        graceMs: 3000,
        env: { ...GIT_ENV },
        signal: controller.signal,
      });
    } catch (error) {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
      throw new GitError(`cannot start git: ${String(error && error.message)}`, {
        code: 'spawn-failed',
        args,
      });
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        handle.terminate();
      } catch {
        /* a process that already exited needs no termination */
      }
    }, timeoutMs);
    let outcome;
    try {
      outcome = await handle.done;
    } catch (error) {
      outcome = { exitCode: null, signal: null, error };
    }
    clearTimeout(timer);
    if (signal !== undefined) signal.removeEventListener('abort', onAbort);
    const stdout = readCollected(handle.collected.stdout);
    const stderr = readCollected(handle.collected.stderr);
    return {
      exitCode: outcome?.exitCode ?? null,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated,
      timedOut,
      args,
    };
  }

  /** Run and throw on any non-zero exit. */
  async function text(args, options) {
    const result = await run(args, options);
    if (result.timedOut) {
      throw new GitError(`git ${args[0] ?? ''} 超时`, { ...result, code: 'timeout' });
    }
    if (result.exitCode !== 0) {
      const detail = (result.stderr.trim().split('\n')[0] ?? '').trim();
      throw new GitError(detail === '' ? `git ${args[0] ?? ''} 失败` : detail, {
        ...result,
        code: 'git-exit',
      });
    }
    return result;
  }

  /** Run and keep a non-zero exit as data, for the probe commands that expect one. */
  async function attempt(args, options) {
    return run(args, options);
  }

  /** Run one write command under the write timeout, surfacing git's own first error line. */
  async function writeCommand(root, args, what, signal) {
    const result = await attempt(args, {
      cwd: root,
      signal,
      timeoutMs: settings.writeTimeoutMs,
    });
    if (result.exitCode !== 0) {
      const first = (result.stderr.trim().split('\n')[0] ?? '').trim();
      throw new GitError(first === '' ? `${what} 失败` : first, { ...result, code: 'git-exit' });
    }
    return result;
  }

  /** The first line git complained with, or a fallback. */
  function firstError(result, fallback) {
    const text = `${result.stderr}\n${result.stdout}`.trim();
    return (text.split('\n')[0] ?? '').trim() || fallback;
  }

  /** The repository root for a directory, or null when it is not inside a work tree. */
  async function repoRoot(cwd, signal) {
    const result = await attempt(['rev-parse', '--show-toplevel'], { cwd, signal });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim().replace(/\r$/, '') || null;
  }

  /** Everything the panel's header and change list need for one directory. */
  async function status(cwd, signal) {
    const root = await repoRoot(cwd, signal);
    if (root === null) return { repo: false, cwd };
    const head = await attempt(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root, signal });
    const unborn = head.exitCode !== 0;
    const branchName = await attempt(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: root, signal });
    const raw = await text(['status', '--porcelain=v2', '-z', '--branch', '-uall'], { cwd: root, signal });
    const parsed = parseStatus(raw.stdout);
    const groups = groupChanges(parsed.entries);
    const oid = parsed.branch.oid ?? (unborn ? null : head.stdout.trim());
    const name = unborn ? parsed.branch.head : branchName.stdout.trim();
    return {
      repo: true,
      cwd: root,
      root,
      unborn,
      detached: !unborn && branchName.exitCode !== 0,
      branch: name === '' || name === '(detached)' ? null : name,
      head: oid,
      shortHead: oid === null ? null : oid.slice(0, 7),
      upstream: parsed.branch.upstream,
      ahead: parsed.branch.ahead,
      behind: parsed.branch.behind,
      truncated: raw.truncated,
      changes: {
        staged: groups.staged,
        unstaged: groups.unstaged,
        untracked: groups.untracked,
        conflicted: groups.conflicted,
        total:
          groups.staged.length +
          groups.unstaged.length +
          groups.untracked.length +
          groups.conflicted.length,
      },
    };
  }

  /** Read one text file under the repository for the untracked-file pseudo-diff. */
  async function readSmallFile(absolutePath, signal) {
    const fs = ctx.get('fs');
    if (fs === undefined) return null;
    const cap = settings.maxDiffBytes;
    const target = await fs.resolve(absolutePath, { signal });
    const bytes = await fs.readBytes(target, signal, cap);
    const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
    if (sample.includes(0)) return { binary: true, text: '', truncated: false };
    return {
      binary: false,
      text: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      truncated: bytes.length >= cap,
    };
  }

  /** Build an all-added unified diff for a file git does not track yet. */
  function addedDiff(path, value) {
    const lines = value.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${path}`,
      `@@ -0,0 +1,${String(lines.length)} @@`,
      lines.map((line) => `+${line}`).join('\n'),
      '',
    ].join('\n');
  }

  /**
   * Unified diff for one path.
   * @param cwd - any directory inside the work tree.
   * @param request - `side` selects worktree, index or an untracked file.
   * @param signal - caller cancellation.
   * @returns the patch text plus binary and truncation facts.
   */
  async function diff(cwd, request, signal) {
    const root = await repoRoot(cwd, signal);
    if (root === null) throw new GitError('不是 git 仓库', { code: 'not-a-repo' });
    const path = assertPathspec(request.path);
    if (request.side === 'untracked') {
      const file = await readSmallFile(`${root}/${path}`, signal);
      if (file === null) return { text: '', truncated: false, binary: false };
      if (file.binary) return { text: '', truncated: false, binary: true };
      return { text: addedDiff(path, file.text), truncated: file.truncated, binary: false };
    }
    const args = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-U3'];
    if (request.side === 'index') args.push('--cached');
    args.push('--', path);
    const result = await run(args, {
      cwd: root,
      signal,
      maxBytes: Math.min(settings.maxDiffBytes, settings.maxOutputBytes),
    });
    if (result.exitCode !== 0) {
      throw new GitError(result.stderr.trim() || 'git diff 失败', { ...result, code: 'git-exit' });
    }
    return {
      text: result.stdout,
      truncated: result.truncated,
      binary: /^Binary files /m.test(result.stdout) || result.stdout.includes('\0'),
    };
  }

  /** Commit history for the graph, newest first. */
  async function log(cwd, request, signal) {
    const limit = Math.max(1, Math.min(Number(request.limit) || settings.logLimit, 1000));
    const args = [
      'log',
      '-z',
      `--max-count=${String(limit)}`,
      '--pretty=format:%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s',
    ];
    const skip = Number(request.skip) || 0;
    if (skip > 0) args.push(`--skip=${String(Math.floor(skip))}`);
    if (request.all === true) args.push('--all');
    if (request.path !== undefined && request.path !== '') args.push('--', assertPathspec(request.path));
    const result = await attempt(args, { cwd, signal });
    if (result.exitCode !== 0) {
      // An unborn HEAD is the one expected failure: report an empty history.
      if (/does not have any commits|unknown revision|bad revision|your current branch/i.test(result.stderr)) {
        return { commits: [], unborn: true };
      }
      throw new GitError(result.stderr.trim() || 'git log 失败', { ...result, code: 'git-exit' });
    }
    return { commits: parseLog(result.stdout), unborn: false };
  }

  /** One commit's metadata and patch. */
  async function commitDetail(cwd, rev, signal) {
    if (typeof rev !== 'string' || !/^[0-9a-zA-Z^~_.\/-]+$/.test(rev)) {
      throw new GitError('提交标识无效', { code: 'bad-request' });
    }
    const meta = await text(['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%B', rev], {
      cwd,
      signal,
    });
    const fields = meta.stdout.split('\x1f');
    const patch = await run(
      ['show', '--format=', '--patch', '--no-color', '--no-ext-diff', '--no-textconv', '-U3', rev],
      { cwd, signal, maxBytes: Math.min(settings.maxDiffBytes, settings.maxOutputBytes) },
    );
    return {
      hash: fields[0] ?? rev,
      parents: (fields[1] ?? '') === '' ? [] : (fields[1] ?? '').split(' '),
      author: fields[2] ?? '',
      email: fields[3] ?? '',
      date: fields[4] ?? '',
      refs: (fields[5] ?? '')
        .split(', ')
        .map((ref) => ref.trim())
        .filter((ref) => ref !== ''),
      message: (fields[6] ?? '').replace(/\n+$/, ''),
      patch: patch.stdout,
      patchTruncated: patch.truncated,
    };
  }

  /** Local branches, remote-tracking branches and tags. */
  async function branches(cwd, signal) {
    const result = await attempt(
      [
        'for-each-ref',
        // `for-each-ref` hex escapes are `%xx`; `%x1f` (the `log --pretty` spelling)
        // would be emitted literally.
        '--format=%(refname)%1f%(objectname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(HEAD)%1f%(committerdate:iso-strict)%1f%(contents:subject)',
        'refs/heads',
        'refs/remotes',
        'refs/tags',
      ],
      { cwd, signal },
    );
    if (result.exitCode !== 0) {
      throw new GitError(result.stderr.trim() || 'git for-each-ref 失败', { ...result, code: 'git-exit' });
    }
    return { refs: parseRefs(result.stdout) };
  }

  /** Author identity git will use; null when the repository cannot commit yet. */
  async function identity(cwd, signal) {
    const result = await attempt(['var', 'GIT_AUTHOR_IDENT'], { cwd, signal });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  }

  /** Compare two paths with platform-insensitive separator and case rules. */
  function normalize(value) {
    return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  /** Guard: the directory must exist and, when a registry exists, sit inside a registered workspace. */
  async function allowedRoot(root) {
    if (typeof root !== 'string' || root.trim() === '') {
      throw new GitError('缺少工作区目录', { code: 'bad-root' });
    }
    const fs = ctx.get('fs');
    if (fs !== undefined) {
      const info = await fs.stat(await fs.resolve(root, {}));
      if (info === undefined || info === null) {
        throw new GitError(`目录不存在：${root}`, { code: 'bad-root' });
      }
    }
    const registry = ctx.get('workspaceRegistry');
    if (registry === undefined) return root;
    const wanted = normalize(root);
    const inside = registry
      .list()
      .some(
        (workspace) =>
          wanted === normalize(workspace.path) || wanted.startsWith(normalize(workspace.path) + '/'),
      );
    if (!inside) {
      throw new GitError(`这个目录不属于任何已注册工作区：${root}`, { code: 'outside-workspace' });
    }
    return root;
  }

  /** Validate a repository-relative pathspec before it reaches git. */
  function assertPathspec(value) {
    if (typeof value !== 'string' || value === '') {
      throw new GitError('路径无效', { code: 'bad-request' });
    }
    if (
      value.includes('\0') ||
      value.startsWith('/') ||
      value.startsWith('\\') ||
      /^[a-zA-Z]:/.test(value)
    ) {
      throw new GitError(`路径必须是仓库内的相对路径：${value}`, { code: 'bad-request' });
    }
    if (value.split(/[\\/]+/).some((segment) => segment === '..')) {
      throw new GitError(`路径不能跳出仓库：${value}`, { code: 'bad-request' });
    }
    return value;
  }

  /** Throw unless the row configuration permits repository writes. */
  function assertWriteAllowed() {
    if (settings.allowWrite !== true) {
      throw new GitError('这个插件当前配置为只读（allowWrite: false）。', { code: 'read-only' });
    }
  }

  /**
   * Validate a branch or tag name before it reaches git: the same shape
   * `git check-ref-format --branch` enforces, checked locally.
   */
  function assertRefName(value, kind) {
    const name = String(value ?? '').trim();
    const label = kind === 'tag' ? '标签' : '分支';
    if (name === '') throw new GitError(`${label}名不能为空`, { code: 'bad-request' });
    if (name.length > 200) throw new GitError(`${label}名过长`, { code: 'bad-request' });
    if (
      name.includes('\0') ||
      /\s/.test(name) ||
      /^[.\/-]/.test(name) ||
      /[\/.]$/.test(name) ||
      name.includes('..') ||
      name.includes('--') ||
      name.includes('@{') ||
      name.endsWith('.lock') ||
      /[~^:?*[\]\\]/.test(name) ||
      name.split('/').some((segment) => segment === '')
    ) {
      throw new GitError(`${label}名不合法：${name}`, { code: 'bad-request' });
    }
    return name;
  }

  /** Validate one commit-ish argument (rev) before it reaches git. */
  function assertRev(value) {
    const rev = String(value ?? '').trim();
    if (rev === '' || !/^[0-9a-zA-Z^~_.\/-]+$/.test(rev) || rev.includes('..')) {
      throw new GitError(`提交标识无效：${rev}`, { code: 'bad-request' });
    }
    return rev;
  }

  /** The configured remotes of the repository, in `git remote` order. */
  async function remotes(cwd, signal) {
    const result = await attempt(['remote'], { cwd, signal });
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  }

  /** Normalize a caller-supplied path list for the write commands. */
  function pathList(paths) {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new GitError('没有选择文件', { code: 'bad-request' });
    }
    if (paths.length > 500) throw new GitError('一次最多操作 500 个文件', { code: 'bad-request' });
    return paths.map(assertPathspec);
  }

  return {
    settings,
    run,
    repoRoot,
    status,
    diff,
    log,
    commitDetail,
    branches,
    identity,
    allowedRoot,
    assertPathspec,
    remotes,

    /** Stage paths (`git add --`). */
    async stage(root, paths, signal) {
      assertWriteAllowed();
      return text(['add', '--', ...pathList(paths)], {
        cwd: root,
        signal,
        timeoutMs: settings.writeTimeoutMs,
      });
    },

    /** Move paths back out of the index (`git restore --staged --`). */
    async unstage(root, paths, signal) {
      assertWriteAllowed();
      const list = pathList(paths);
      const result = await attempt(['restore', '--staged', '--', ...list], {
        cwd: root,
        signal,
        timeoutMs: settings.writeTimeoutMs,
      });
      if (result.exitCode === 0) return result;
      // An unborn HEAD has no tree to restore from; dropping the index entry is the
      // only equivalent operation there.
      const fallback = await attempt(['rm', '--cached', '--force', '--', ...list], {
        cwd: root,
        signal,
        timeoutMs: settings.writeTimeoutMs,
      });
      if (fallback.exitCode !== 0) {
        throw new GitError(result.stderr.trim() || 'git restore --staged 失败', {
          ...result,
          code: 'git-exit',
        });
      }
      return fallback;
    },

    /** Commit the current index. */
    async commit(root, message, signal) {
      assertWriteAllowed();
      const body = String(message ?? '').trim();
      if (body === '') throw new GitError('提交信息不能为空', { code: 'bad-request' });
      const args = ['commit', '--message', body];
      if (settings.commitNoVerify === true) args.push('--no-verify');
      const result = await attempt(args, { cwd: root, signal, timeoutMs: settings.writeTimeoutMs });
      if (result.exitCode !== 0) {
        const combined = `${result.stderr}\n${result.stdout}`;
        const hint = /Please tell me who you are|unable to auto-detect email/i.test(combined)
          ? '这个仓库还没有配置 user.name / user.email，git 无法生成提交。'
          : (result.stderr.trim().split('\n')[0] ?? '') || 'git commit 失败';
        throw new GitError(hint, { ...result, code: 'commit-failed' });
      }
      const head = await attempt(['rev-parse', '--short', 'HEAD'], { cwd: root, signal });
      return { hash: head.stdout.trim(), output: result.stdout.trim() };
    },

    /** Create a branch (`git branch`) and optionally switch to it (`git switch -c`). */
    async createBranch(root, name, start, switchTo, signal) {
      assertWriteAllowed();
      const branch = assertRefName(name, 'branch');
      const from = start === undefined || start === null || start === '' ? null : assertRev(start);
      const args =
        switchTo === false
          ? ['branch', branch, ...(from === null ? [] : [from])]
          : ['switch', '-c', branch, ...(from === null ? [] : [from])];
      return writeCommand(root, args, 'git branch', signal);
    },

    /**
     * Switch branches (`git switch`), or detach onto a commit or tag. No force
     * flag exists here: a dirty work tree makes git refuse, and that refusal is
     * the point.
     */
    async checkout(root, ref, options, signal) {
      assertWriteAllowed();
      const config = options ?? {};
      if (config.detach === true) {
        return writeCommand(root, ['switch', '--detach', assertRev(ref)], 'git switch', signal);
      }
      return writeCommand(root, ['switch', assertRefName(ref, 'branch')], 'git switch', signal);
    },

    /** Delete a merged branch (`git branch -d`); force deletion is not offered. */
    async deleteBranch(root, name, signal) {
      assertWriteAllowed();
      const branch = assertRefName(name, 'branch');
      const result = await attempt(['branch', '-d', branch], {
        cwd: root,
        signal,
        timeoutMs: settings.writeTimeoutMs,
      });
      if (result.exitCode === 0) return result;
      const combined = `${result.stderr}\n${result.stdout}`;
      const message = /not fully merged/i.test(combined)
        ? `分支 ${branch} 还有未合并的提交；面板只做安全删除，不会用 -D 强删。`
        : firstError(result, 'git branch -d 失败');
      throw new GitError(message, { ...result, code: 'git-exit' });
    },

    /** Create a lightweight tag at rev, defaulting to HEAD. */
    async createTag(root, name, rev, signal) {
      assertWriteAllowed();
      const tag = assertRefName(name, 'tag');
      const at = rev === undefined || rev === null || rev === '' ? null : assertRev(rev);
      return writeCommand(root, ['tag', tag, ...(at === null ? [] : [at])], 'git tag', signal);
    },

    /** Delete a tag. */
    async deleteTag(root, name, signal) {
      assertWriteAllowed();
      return writeCommand(root, ['tag', '-d', assertRefName(name, 'tag')], 'git tag -d', signal);
    },

    /** Fetch every remote and prune refs that vanished upstream. */
    async fetch(root, signal) {
      assertWriteAllowed();
      const list = (await remotes(root, signal)).filter((entry) => entry !== '');
      if (list.length === 0) {
        throw new GitError('这个仓库没有配置远程仓库。', { code: 'bad-request' });
      }
      return writeCommand(root, ['fetch', '--all', '--prune'], 'git fetch', signal);
    },

    /**
     * Fast-forward only pull. A diverged branch is left untouched on purpose:
     * the panel does not create surprise merge commits.
     */
    async pull(root, signal) {
      assertWriteAllowed();
      const list = await remotes(root, signal);
      if (list.length === 0) {
        throw new GitError('这个仓库没有配置远程仓库。', { code: 'bad-request' });
      }
      const result = await attempt(['pull', '--ff-only'], {
        cwd: root,
        signal,
        timeoutMs: settings.writeTimeoutMs,
      });
      if (result.exitCode === 0) return result;
      const message = /not possible to fast-forward|diverging/i.test(result.stderr)
        ? '当前分支与远端已经分叉，面板只做快进式拉取；请手动合并后再拉取。'
        : firstError(result, 'git pull 失败');
      throw new GitError(message, { ...result, code: 'git-exit' });
    },

    /**
     * Push the current branch. Publishing a new branch adds `-u <remote> <branch>`.
     * There is no force variant: a rejected push stays rejected.
     */
    async push(root, options, signal) {
      assertWriteAllowed();
      const config = options ?? {};
      const args = ['push'];
      if (config.setUpstream === true) {
        const remote = String(config.remote ?? '').trim() || 'origin';
        assertRefName(remote, 'branch');
        const branch = String(config.branch ?? '').trim();
        args.push('-u', remote, branch === '' ? 'HEAD' : assertRefName(branch, 'branch'));
      }
      return writeCommand(root, args, 'git push', signal);
    },

    /**
     * Discard worktree changes of tracked paths (`git restore --worktree --`).
     * Untracked files are never deleted: that is a file deletion, not a revert.
     */
    async discard(root, paths, signal) {
      assertWriteAllowed();
      const list = pathList(paths);
      const result = await attempt(['restore', '--worktree', '--', ...list], {
        cwd: root,
        signal,
        timeoutMs: settings.writeTimeoutMs,
      });
      if (result.exitCode === 0) return result;
      const combined = `${result.stderr}\n${result.stdout}`;
      const message = /did not match any file|pathspec/i.test(combined)
        ? '未跟踪的文件不会被删除：面板只丢弃已跟踪文件在暂存区之外的改动。'
        : firstError(result, 'git restore 失败');
      throw new GitError(message, { ...result, code: 'git-exit' });
    },

    /**
     * Move HEAD while keeping the work tree: `--soft` keeps the index, `--mixed`
     * drops the index. `--hard` discards work, so it is not exposed here.
     */
    async reset(root, rev, mode, signal) {
      assertWriteAllowed();
      const target = assertRev(rev);
      const flag = mode === 'soft' ? '--soft' : mode === 'mixed' ? '--mixed' : null;
      if (flag === null) {
        throw new GitError('只支持 soft 与 mixed 重置；--hard 会丢弃工作区，面板不提供。', {
          code: 'bad-request',
        });
      }
      return writeCommand(root, ['reset', flag, target], 'git reset', signal);
    },

    /** Revert one commit by recording its inverse as a new commit. */
    async revert(root, rev, signal) {
      assertWriteAllowed();
      return writeCommand(root, ['revert', '--no-edit', assertRev(rev)], 'git revert', signal);
    },

    /** Apply one commit from elsewhere onto the current branch. */
    async cherryPick(root, rev, signal) {
      assertWriteAllowed();
      return writeCommand(root, ['cherry-pick', assertRev(rev)], 'git cherry-pick', signal);
    },

    /** Merge a ref into the current branch, letting git choose ff or a merge commit. */
    async merge(root, ref, signal) {
      assertWriteAllowed();
      return writeCommand(root, ['merge', '--no-edit', assertRev(ref)], 'git merge', signal);
    },
  };
}
