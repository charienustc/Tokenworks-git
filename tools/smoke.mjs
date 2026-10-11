/**
 * Adapter smoke test: drives `lib/git.js` against a scratch repository through a
 * minimal fake of `ctx.subprocess` and `ctx.fs`, so the git argv, the parsers
 * and the write paths are exercised without the USTC Tokenworks runtime.
 *
 * The fake captures child output through file descriptors rather than pipes:
 * that keeps the test runnable under a confined sandbox, where a piped
 * `spawn` from a confined process fails with EPERM.
 *
 * Usage: node tools/smoke.mjs
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat as fsStat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
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

/** Every git argv the adapter has issued, in order (for shape assertions). */
const commands = [];

/** Minimal stand-in for the composition's subprocess provider. */
function fakeSubprocess() {
  return {
    async resolveExecutable(command) {
      return command;
    },
    spawn(spec) {
      commands.push(spec.argv.slice());
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
let skips = 0;
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

// --- discard -----------------------------------------------------------------
// Start from a known state: the worktree modification left over above.
await git.discard(scratch, ['alpha.txt']);
const afterDiscard = await git.status(scratch);
check(
  'discard: restores a tracked file to its committed content',
  afterDiscard.changes.total === 0,
  JSON.stringify(afterDiscard.changes),
);

await writeFile(join(scratch, 'fresh.txt'), 'brand new\n', 'utf8');
let refusedUntracked = null;
try {
  await git.discard(scratch, ['fresh.txt']);
} catch (error) {
  refusedUntracked = error;
}
check('discard: refuses to delete an untracked file', refusedUntracked !== null, refusedUntracked && refusedUntracked.code);
const keptUntracked = await git.status(scratch);
check(
  'discard: the untracked file survives the refusal',
  keptUntracked.changes.untracked.some((entry) => entry.path === 'fresh.txt'),
);

// --- literal pathspecs --------------------------------------------------------
// Git reads `[1]` inside a pathspec as a character class, so discarding
// `file[1].txt` must not reach a neighbouring `file1.txt`.
await writeFile(join(scratch, 'file1.txt'), 'one\n', 'utf8');
await writeFile(join(scratch, 'file[1].txt'), 'bracket\n', 'utf8');
await git.stage(scratch, ['file1.txt', 'file[1].txt']);
await git.commit(scratch, 'glob neighbours');
await writeFile(join(scratch, 'file1.txt'), 'one changed\n', 'utf8');
await writeFile(join(scratch, 'file[1].txt'), 'bracket changed\n', 'utf8');
await git.discard(scratch, ['file[1].txt']);
const neighbours = await git.status(scratch);
check(
  'discard: a bracketed filename does not glob onto its neighbour',
  neighbours.changes.unstaged.some((entry) => entry.path === 'file1.txt') &&
    !neighbours.changes.unstaged.some((entry) => entry.path === 'file[1].txt'),
  JSON.stringify(neighbours.changes.unstaged.map((entry) => entry.path)),
);
await git.discard(scratch, ['file1.txt']);

// --- branches ----------------------------------------------------------------
await git.createBranch(scratch, 'feature/x', null, true);
const onFeature = await git.status(scratch);
check('branch: create switches to the new branch', onFeature.branch === 'feature/x', onFeature.branch);

await git.checkout(scratch, 'main', {});
const backOnMain = await git.status(scratch);
check('checkout: switches back to an existing branch', backOnMain.branch === 'main', backOnMain.branch);

await git.deleteBranch(scratch, 'feature/x');
const refsAfterDelete = await git.branches(scratch);
check(
  'branch: safe delete removes a merged branch',
  !refsAfterDelete.refs.some((entry) => entry.kind === 'local' && entry.name === 'feature/x'),
);

await git.createBranch(scratch, 'wip', null, true);
await writeFile(join(scratch, 'wip.txt'), 'work in progress\n', 'utf8');
await git.stage(scratch, ['wip.txt']);
const wipCommit = await git.commit(scratch, 'wip commit');
await git.checkout(scratch, 'main', {});
let unmerged = null;
try {
  await git.deleteBranch(scratch, 'wip');
} catch (error) {
  unmerged = error;
}
check(
  'branch: safe delete refuses an unmerged branch',
  unmerged !== null && /未合并/.test(unmerged.message),
  unmerged && unmerged.message,
);

// --- tags ---------------------------------------------------------------------
const headForTag = await git.log(scratch, { limit: 1 });
await git.createTag(scratch, 'v0.1.0', headForTag.commits[0].hash.slice(0, 7));
const tagged = await git.branches(scratch);
check(
  'tag: creating names the current commit',
  tagged.refs.some((entry) => entry.kind === 'tag' && entry.name === 'v0.1.0'),
  JSON.stringify(tagged.refs.filter((entry) => entry.kind === 'tag').map((entry) => entry.name)),
);
await git.deleteTag(scratch, 'v0.1.0');
const untagged = await git.branches(scratch);
check(
  'tag: deleting removes it again',
  !untagged.refs.some((entry) => entry.kind === 'tag' && entry.name === 'v0.1.0'),
);
let badTag = null;
try {
  await git.createTag(scratch, 'bad tag', null);
} catch (error) {
  badTag = error;
}
check('tag: a malformed name is rejected', badTag !== null && badTag.code === 'bad-request');

// `%(upstream:track)` ships as English text; the panel renders ↑/↓ from these
// counts instead, and marks an upstream that no longer exists.
const refShapes = await git.branches(scratch);
check(
  'branches: every ref carries numeric divergence and a gone flag',
  refShapes.refs.length > 0 &&
    refShapes.refs.every(
      (ref) => Number.isInteger(ref.ahead) && Number.isInteger(ref.behind) && typeof ref.gone === 'boolean',
    ),
  JSON.stringify(refShapes.refs.map((ref) => [ref.name, ref.ahead, ref.behind, ref.gone])),
);

// --- cherry-pick --------------------------------------------------------------
await git.cherryPick(scratch, wipCommit.hash);
const afterPick = await git.log(scratch, { limit: 1 });
check(
  'cherry-pick: replays the commit on the current branch',
  afterPick.commits[0].subject === 'wip commit',
  JSON.stringify(afterPick.commits[0].subject),
);

// --- merge: two branches that each moved on their own files -------------------
// Both sides advance, so this cannot degenerate into "already up to date".
await git.createBranch(scratch, 'topic', null, true);
await writeFile(join(scratch, 'topic.txt'), 'topic work\n', 'utf8');
await git.stage(scratch, ['topic.txt']);
await git.commit(scratch, 'topic commit');
await git.checkout(scratch, 'main', {});
await writeFile(join(scratch, 'main-side.txt'), 'main side\n', 'utf8');
await git.stage(scratch, ['main-side.txt']);
await git.commit(scratch, 'main side commit');
await git.merge(scratch, 'topic');
const afterMerge = await git.log(scratch, { limit: 1 });
check(
  'merge: joins the branch histories into a merge commit',
  afterMerge.commits[0].parents.length === 2 && /^Merge/.test(afterMerge.commits[0].subject),
  `${afterMerge.commits[0].subject} parents=${String(afterMerge.commits[0].parents.length)}`,
);
await git.deleteBranch(scratch, 'topic');
const refsAfterMerge = await git.branches(scratch);
check(
  'branch: the merged branch can now be deleted',
  !refsAfterMerge.refs.some((entry) => entry.kind === 'local' && entry.name === 'topic'),
);

await writeFile(join(scratch, 'revert-me.txt'), 'temporary\n', 'utf8');
await git.stage(scratch, ['revert-me.txt']);
const doomed = await git.commit(scratch, 'to be reverted');
await git.revert(scratch, doomed.hash);
const afterRevert = await git.log(scratch, { limit: 2 });
check(
  'revert: records the inverse as a new commit',
  /^Revert/.test(afterRevert.commits[0].subject),
  afterRevert.commits[0].subject,
);

// --- reset (soft and mixed only) ---------------------------------------------
await git.reset(scratch, 'HEAD~1', 'soft');
const afterSoft = await git.status(scratch);
check(
  'reset(soft): rewinds HEAD and keeps the change staged',
  afterSoft.changes.staged.some((entry) => entry.path === 'revert-me.txt'),
  JSON.stringify(afterSoft.changes),
);
await git.reset(scratch, 'HEAD', 'mixed');
const afterMixed = await git.status(scratch);
check(
  'reset(mixed): moves the change out of the index',
  afterMixed.changes.staged.length === 0 && afterMixed.changes.unstaged.length > 0,
  JSON.stringify(afterMixed.changes),
);
let hardRefused = null;
try {
  await git.reset(scratch, 'HEAD', 'hard');
} catch (error) {
  hardRefused = error;
}
check('reset: refuses --hard outright', hardRefused !== null && hardRefused.code === 'bad-request');
await git.stage(scratch, ['revert-me.txt']);
await git.commit(scratch, 'keep the file');

// --- ref and rev validation ---------------------------------------------------
const badNames = ['bad name', '-x', 'double..dot', 'trailing/', 'with~tilde', 'at@{brace'];
let badNameRejected = 0;
for (const name of badNames) {
  try {
    await git.createBranch(scratch, name, null, false);
  } catch (error) {
    if (error.code === 'bad-request') badNameRejected += 1;
  }
}
check('guard: every malformed ref name is rejected', badNameRejected === badNames.length, badNameRejected);

let badRev = null;
try {
  await git.checkout(scratch, '../evil', { detach: true });
} catch (error) {
  badRev = error;
}
check('guard: a rev that could escape is rejected', badRev !== null && badRev.code === 'bad-request');

// A rev travels as its own argv element with no `--` separator, so anything
// option-shaped must be refused: `git reset --soft --hard` would discard the
// work tree, which is precisely what this panel promises never to do.
await writeFile(join(scratch, 'injection.txt'), 'do not lose me\n', 'utf8');
let injectedReset = null;
try {
  await git.reset(scratch, '--hard', 'soft');
} catch (error) {
  injectedReset = error;
}
check(
  'guard: reset refuses an option-shaped rev',
  injectedReset !== null && injectedReset.code === 'bad-request',
  injectedReset && injectedReset.code,
);
check(
  'guard: the refused reset left the work tree alone',
  (await git.status(scratch)).changes.untracked.some((entry) => entry.path === 'injection.txt'),
);

let injectedSwitch = null;
try {
  await git.checkout(scratch, '-f', { detach: true });
} catch (error) {
  injectedSwitch = error;
}
check(
  'guard: checkout refuses an option-shaped rev',
  injectedSwitch !== null && injectedSwitch.code === 'bad-request',
  injectedSwitch && injectedSwitch.code,
);

let injectedDetail = null;
try {
  await git.commitDetail(scratch, '--output=leak.txt');
} catch (error) {
  injectedDetail = error;
}
check(
  'guard: commit detail refuses an option-shaped rev',
  injectedDetail !== null && injectedDetail.code === 'bad-request',
  injectedDetail && injectedDetail.code,
);
await rm(join(scratch, 'injection.txt'), { force: true });

// --- the light branch read used by the composer chip ---------------------------
const branchHead = await git.head(scratch);
check(
  'head: names the branch and the commit without walking the work tree',
  branchHead.repo === true &&
    branchHead.unborn === false &&
    branchHead.branch === 'main' &&
    branchHead.detached === false &&
    typeof branchHead.shortHead === 'string' &&
    branchHead.shortHead.length === 7,
  JSON.stringify(branchHead),
);
check(
  'head: an upstream is either named or absent',
  branchHead.upstream === null || typeof branchHead.upstream === 'string',
  JSON.stringify(branchHead.upstream),
);

// --- detached checkout --------------------------------------------------------
const headNow = await git.log(scratch, { limit: 1 });
await git.checkout(scratch, headNow.commits[0].hash, { detach: true });
const detached = await git.status(scratch);
check('checkout: a commit hash detaches HEAD', detached.detached === true, JSON.stringify(detached.detached));

// --- the light branch read used by the composer chip ---------------------------
const detachedHead = await git.head(scratch);
check(
  'head: a detached HEAD reports no branch',
  detachedHead.repo === true && detachedHead.detached === true && detachedHead.branch === null,
  JSON.stringify(detachedHead),
);

const plainDir = await mkdtemp(join(tmpdir(), 'tw-notrepo-'));
const outsideHead = await git.head(plainDir);
check('head: a directory outside a work tree reports no repository', outsideHead.repo === false, JSON.stringify(outsideHead));
await rm(plainDir, { recursive: true, force: true });
await git.checkout(scratch, 'main', {});

// --- remotes ------------------------------------------------------------------
let noRemoteFetch = null;
try {
  await git.fetch(scratch);
} catch (error) {
  noRemoteFetch = error;
}
check(
  'fetch: a repository without remotes is refused clearly',
  noRemoteFetch !== null && noRemoteFetch.code === 'bad-request',
  noRemoteFetch && noRemoteFetch.message,
);

const remoteDir = join(ioDir, 'remote.git');
await rm(remoteDir, { recursive: true, force: true });
gitCli(['init', '--bare', remoteDir], root);
gitCli(['remote', 'add', 'origin', remoteDir], scratch);
const remoteList = await git.remotes(scratch);
check(
  'remotes: the configured remote is listed with its fetch URL',
  remoteList.length === 1 &&
    remoteList[0].name === 'origin' &&
    typeof remoteList[0].url === 'string' &&
    remoteList[0].url !== '',
  JSON.stringify(remoteList),
);

/** The git-level argv of the most recent command whose subcommand is `name`. */
const lastArgv = (name) => {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    // argv[0] is the executable; argv[1] is the subcommand.
    if (commands[index][1] === name) return commands[index].slice(1);
  }
  return [];
};

// git's local transport forks `sh`, which this sandbox blocks (no named pipes),
// so the remote commands are asserted by invocation shape and a real round trip
// is reported as skipped rather than silently passing.
let transport = 'ok';
const attemptTransport = async (run) => {
  try {
    await run();
  } catch (error) {
    const message = String((error && error.message) || error);
    transport = /signal pipe|could not read from remote/i.test(message) ? 'sandbox' : `failed: ${message}`;
  }
};

commands.length = 0;
await attemptTransport(() => git.push(scratch, { remote: 'origin', branch: 'main', setUpstream: true }));
check(
  'push: publishing a branch uses `-u <remote> <branch>`',
  lastArgv('push').join(' ') === 'push -u origin main',
  lastArgv('push').join(' '),
);

commands.length = 0;
await attemptTransport(() => git.push(scratch, {}));
check('push: a plain push carries no extra arguments', lastArgv('push').join(' ') === 'push', lastArgv('push').join(' '));

commands.length = 0;
await attemptTransport(() => git.fetch(scratch));
check('fetch: fetches every remote and prunes', lastArgv('fetch').join(' ') === 'fetch --all --prune', lastArgv('fetch').join(' '));

commands.length = 0;
await attemptTransport(() => git.pull(scratch));
check('pull: pulls fast-forward only', lastArgv('pull').join(' ') === 'pull --ff-only', lastArgv('pull').join(' '));

if (transport === 'sandbox') {
  skips += 1;
  console.log(
    "SKIP  push/fetch/pull end to end: this sandbox blocks git's local transport (sh.exe cannot create signal pipes)",
  );
} else {
  check('push/fetch/pull: the local remote round-trips', transport === 'ok', transport);
}

// --- the new writes obey the same read-only fence -----------------------------
let readOnlyBranch = null;
try {
  await readOnly.createBranch(scratch, 'nope', null, false);
} catch (error) {
  readOnlyBranch = error;
}
check('guard: allowWrite=false blocks branch creation', readOnlyBranch !== null && readOnlyBranch.code === 'read-only');

let readOnlyPush = null;
try {
  await readOnly.push(scratch, {});
} catch (error) {
  readOnlyPush = error;
}
check('guard: allowWrite=false blocks push', readOnlyPush !== null && readOnlyPush.code === 'read-only');

let readOnlyDiscard = null;
try {
  await readOnly.discard(scratch, ['alpha.txt']);
} catch (error) {
  readOnlyDiscard = error;
}
check('guard: allowWrite=false blocks discard', readOnlyDiscard !== null && readOnlyDiscard.code === 'read-only');

// --- merge commits and non-ASCII paths ----------------------------------------
// A merge's patch defaults to the combined `diff --cc` format, which the panel's
// parser cannot read; the adapter asks for a two-way, first-parent patch instead.
const allCommits = await git.log(scratch, { limit: 80 });
const mergeCommit = allCommits.commits.find((commit) => commit.parents.length > 1);
check('fixture: the history contains a merge commit', mergeCommit !== undefined);
const mergeDetail = mergeCommit === undefined ? null : await git.commitDetail(scratch, mergeCommit.hash);
check(
  'commit detail: a merge patch stays in the two-way format',
  mergeDetail !== null && !/^diff --cc /m.test(mergeDetail.patch) && !/^@@@ /m.test(mergeDetail.patch),
  mergeDetail === null
    ? 'no merge commit'
    : JSON.stringify(mergeDetail.patch.split('\n').find((line) => line.startsWith('diff '))),
);

// git quotes non-ASCII paths by default, which would blank out the panel's file
// list, so the diff commands run with `core.quotePath=false`.
await writeFile(join(scratch, '中文名.txt'), 'hello\n', 'utf8');
await git.stage(scratch, ['中文名.txt']);
await git.commit(scratch, 'unicode path');
await writeFile(join(scratch, '中文名.txt'), 'hello again\n', 'utf8');
const unicodeDiff = await git.diff(scratch, { side: 'worktree', path: '中文名.txt' });
check(
  'diff: a non-ASCII path survives unquoted',
  unicodeDiff.text.includes('diff --git a/中文名.txt b/中文名.txt'),
  JSON.stringify(unicodeDiff.text.split('\n')[0]),
);
await git.discard(scratch, ['中文名.txt']);

await rm(remoteDir, { recursive: true, force: true });
await rm(scratch, { recursive: true, force: true });
console.log(
  failures === 0
    ? `\nALL PASS${skips === 0 ? '' : ` (${String(skips)} skipped)`}`
    : `\n${String(failures)} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
