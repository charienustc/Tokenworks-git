/**
 * Adapter smoke test: drives `lib/git.js` against a scratch repository through a
 * minimal fake of `ctx.subprocess` and `ctx.fs`, so the git argv, the parsers
 * and the write paths are exercised without the Harness runtime.
 *
 * The fake captures child output through file descriptors rather than pipes:
 * that keeps the test runnable under a confined DSH sandbox, where a piped
 * `spawn` from a confined process fails with EPERM.
 *
 * Usage: node tools/smoke.mjs
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, stat as fsStat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGit } from '../lib/git.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const scratch = join(root, '.smoke');
const ioDir = join(root, '.smoke-io');
let spawnCount = 0;

/** Run one command, capturing both streams through file descriptors. */
function capture(argv, cwd) {
  const id = String((spawnCount += 1));
  const outPath = join(ioDir, `${id}.out`);
  const errPath = join(ioDir, `${id}.err`);
  const outFd = openSync(outPath, 'w');
  const errFd = openSync(errPath, 'w');
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env: process.env,
    stdio: ['ignore', outFd, errFd],
    windowsHide: true,
  });
  closeSync(outFd);
  closeSync(errFd);
  const read = (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };
  return { status: result.status, stdout: read(outPath), stderr: read(errPath), error: result.error };
}

/** Minimal stand-in for the composition's subprocess provider. */
function fakeSubprocess() {
  return {
    async resolveExecutable(command) {
      return command;
    },
    spawn(spec) {
      const outcome = capture(spec.argv, spec.cwd);
      return {
        collected: {
          stdout: { readFrom: () => ({ text: outcome.stdout, nextOffset: 0, lossy: false }) },
          stderr: { readFrom: () => ({ text: outcome.stderr, nextOffset: 0, lossy: false }) },
        },
        done: Promise.resolve({ exitCode: outcome.status, signal: null }),
        terminate: () => undefined,
      };
    },
  };
}

/** Minimal stand-in for the composition's filesystem provider. */
function fakeFs() {
  return {
    async resolve(path) {
      return path;
    },
    async stat(path) {
      try {
        const info = await fsStat(path);
        return { path, size: info.size };
      } catch {
        return undefined;
      }
    },
    async readBytes(path, signal, maxBytes) {
      const buffer = await readFile(path);
      return new Uint8Array(buffer.subarray(0, maxBytes));
    },
  };
}

const ctx = {
  subprocess: fakeSubprocess(),
  get: (name) => (name === 'fs' ? fakeFs() : undefined),
};

let failures = 0;
function check(label, condition, detail) {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`${mark}  ${label}${condition || detail === undefined ? '' : `  → ${String(detail)}`}`);
}

function gitCli(args, cwd) {
  const result = capture(['git', ...args], cwd);
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr}${result.error === undefined ? '' : ` (${result.error.message})`}`,
    );
  }
  return result.stdout;
}

await rm(scratch, { recursive: true, force: true });
await rm(ioDir, { recursive: true, force: true });
await mkdir(scratch, { recursive: true });
mkdirSync(ioDir, { recursive: true });
gitCli(['init', '-b', 'main'], scratch);
gitCli(['config', 'user.name', 'Smoke Test'], scratch);
gitCli(['config', 'user.email', 'smoke@example.com'], scratch);
await writeFile(join(scratch, 'alpha.txt'), 'one\ntwo\nthree\n', 'utf8');
await mkdir(join(scratch, 'src'), { recursive: true });
await writeFile(join(scratch, 'src', 'beta.ts'), 'export const value = 1;\n', 'utf8');

const git = createGit(ctx, { allowWrite: true, logLimit: 50 });

// --- unborn repository ------------------------------------------------------
const unborn = await git.status(scratch);
check('status: reports a repository', unborn.repo === true);
check('status: reports an unborn HEAD', unborn.unborn === true, JSON.stringify(unborn).slice(0, 200));
check('status: branch name from the symref', unborn.branch === 'main', unborn.branch);
check('status: counts untracked files', unborn.changes.untracked.length === 2, unborn.changes.untracked.length);

const emptyLog = await git.log(scratch, { limit: 10 });
check('log: empty history on an unborn HEAD', emptyLog.commits.length === 0 && emptyLog.unborn === true);

// --- staging and diffs ------------------------------------------------------
await git.stage(scratch, ['alpha.txt']);
const staged = await git.status(scratch);
check(
  'stage: alpha.txt moved into the index',
  staged.changes.staged.some((entry) => entry.path === 'alpha.txt' && entry.x === 'A'),
  JSON.stringify(staged.changes.staged),
);
check(
  'stage: alpha.txt left the untracked list',
  !staged.changes.untracked.some((entry) => entry.path === 'alpha.txt'),
);

const indexDiff = await git.diff(scratch, { side: 'index', path: 'alpha.txt' });
check('diff(index): shows the added lines', /\+one/.test(indexDiff.text), indexDiff.text.slice(0, 160));

const untrackedDiff = await git.diff(scratch, { side: 'untracked', path: 'src/beta.ts' });
check('diff(untracked): synthesizes an all-added patch', /\+export const value = 1;/.test(untrackedDiff.text));

await git.unstage(scratch, ['alpha.txt']);
const unstaged = await git.status(scratch);
check(
  'unstage: alpha.txt returned to untracked on an unborn HEAD',
  unstaged.changes.staged.length === 0 && unstaged.changes.untracked.length === 2,
  JSON.stringify(unstaged.changes),
);

// --- commit, history and refs ----------------------------------------------
await git.stage(scratch, ['alpha.txt', 'src/beta.ts']);
const committed = await git.commit(scratch, 'first commit');
check('commit: returns the new short hash', /^[0-9a-f]{7,}$/.test(committed.hash), committed.hash);

const afterCommit = await git.status(scratch);
check('status: clean after the commit', afterCommit.changes.total === 0, JSON.stringify(afterCommit.changes));
check('status: born HEAD with a branch', afterCommit.unborn === false && afterCommit.branch === 'main');

await writeFile(join(scratch, 'alpha.txt'), 'one\nTWO\nthree\nfour\n', 'utf8');
const modified = await git.status(scratch);
check(
  'status: reports a worktree modification',
  modified.changes.unstaged.some((entry) => entry.path === 'alpha.txt' && entry.y === 'M'),
  JSON.stringify(modified.changes.unstaged),
);
const worktreeDiff = await git.diff(scratch, { side: 'worktree', path: 'alpha.txt' });
check(
  'diff(worktree): shows both a removal and an addition',
  /-two/.test(worktreeDiff.text) && /\+TWO/.test(worktreeDiff.text),
  worktreeDiff.text.slice(0, 200),
);

const log = await git.log(scratch, { limit: 10 });
check('log: one commit recorded', log.commits.length === 1, log.commits.length);
check(
  'log: commit carries an author and subject',
  log.commits[0].author === 'Smoke Test' && log.commits[0].subject === 'first commit',
  JSON.stringify(log.commits[0]),
);
check('log: root commit has no parents', log.commits[0].parents.length === 0);

const detail = await git.commitDetail(scratch, log.commits[0].hash);
check('commitDetail: message round-trips', detail.message === 'first commit', detail.message);
check('commitDetail: patch names the file', /alpha\.txt/.test(detail.patch));

const refs = await git.branches(scratch);
check(
  'branches: the current branch is listed and flagged',
  refs.refs.some((ref) => ref.name === 'main' && ref.head === true),
  JSON.stringify(refs.refs),
);

const identity = await git.identity(scratch);
check('identity: resolves the configured author', typeof identity === 'string' && identity.includes('Smoke Test'));

// --- guards -----------------------------------------------------------------
let escaped = null;
try {
  await git.diff(scratch, { side: 'worktree', path: '../outside.txt' });
} catch (error) {
  escaped = error;
}
check('guard: rejects a pathspec that escapes the repository', escaped !== null && escaped.code === 'bad-request');

let outside = null;
try {
  await git.allowedRoot('C:/definitely/not/registered');
} catch (error) {
  outside = error;
}
check('guard: existence-checked without a registry', outside !== null && outside.code === 'bad-root');

const readOnly = createGit(ctx, { allowWrite: false });
let blocked = null;
try {
  await readOnly.stage(scratch, ['alpha.txt']);
} catch (error) {
  blocked = error;
}
check('guard: allowWrite=false blocks staging', blocked !== null && blocked.code === 'read-only');

await rm(scratch, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${String(failures)} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
