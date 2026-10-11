/**
 * Client half of the git panel: one right-Sidebar tab type, its body, its live
 * chip title, and the Session-header button that opens it.
 *
 * The body reads the Session's workspace directory from the framework's Session
 * snapshot and talks to the Host half over the composition's own HTTP carrier.
 * Rendering follows the USTC Tokenworks UI rules: only framework props and
 * `react` are imported, every colour is a theme token, all copy goes through the
 * locale service, and each registration is owned by an effect so unloading the
 * plugin removes it.
 */
window.__ModuleLoader__.load({
  id: '@local/tokenworks-git-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useMemo = React.useMemo;
    const useCallback = React.useCallback;

    /** Locale namespace owned by this plugin. */
    const NS = 'git-panel';
    /** This implementation's identity in the tab system, and its body/title key. */
    const TAB_ID = '@local/tokenworks-git-panel/tab';
    /** The page type the tab strip and the header button open. */
    const TAB_KIND = 'tokenworksGitPanel';
    /** Host route prefix, matching the Host half. */
    const API = '/git-panel';
    /** Poll cadence while the tab is on screen. */
    const REFRESH_MS = 5000;
    /** Backstop cadence for the composer branch chip; writes announce themselves. */
    const DOCK_REFRESH_MS = 5000;
    /** Static locale keys: an open operation's banner needs one, keyed by name. */
    const OPERATION_LABEL = {
      merge: 'operation.merge',
      'cherry-pick': 'operation.cherry-pick',
      revert: 'operation.revert',
      rebase: 'operation.rebase',
    };
    /** What abandoning each operation actually does, spelled out per operation. */
    const ABORT_DETAIL = {
      merge: 'confirm.abortMerge',
      'cherry-pick': 'confirm.abortCherryPick',
      revert: 'confirm.abortRevert',
      rebase: 'confirm.abortRebase',
    };

    /** Simplified Chinese dictionary and key-set source of truth. */
    const zh = {
      'type.label': 'Git',
      'guide.title': 'Git',
      'guide.description': '查看工作区的改动、差异与提交历史，并暂存或提交',
      'header.open': '打开 Git 面板',
      'dock.branch': '当前分支',
      'dock.loading': '正在读取分支…',
      'dock.empty': '没有其他本地分支。',
      'dock.detached': '游离 HEAD',
      'dock.confirmTitle': '切换到 {branch}？',
      'dock.confirmDetail': '切换会更新工作区文件；有会被覆盖的未提交改动时，git 会拒绝。',
      'dock.confirm': '切换',
      'dock.cancel': '取消',
      'tab.changes': '改动',
      'tab.history': '历史',
      'tab.branches': '分支',
      'state.loading': '正在读取仓库…',
      'state.noWorkspace': '这个会话还没有工作区目录。',
      'state.retry': '重试',
      'state.refresh': '刷新',
      'state.unborn': '还没有任何提交',
      'state.detached': '游离 HEAD',
      'state.clean': '工作区干净，没有未提交的改动。',
      'group.conflicted': '冲突',
      'group.staged': '已暂存',
      'group.unstaged': '未暂存',
      'group.untracked': '未跟踪',
      'action.stage': '暂存',
      'action.unstage': '取消暂存',
      'action.close': '关闭差异',
      'commit.placeholder': '提交信息…',
      'commit.submit': '提交',
      'commit.count': '已暂存 {n} 个文件',
      'commit.noneStaged': '还没有暂存任何文件',
      'commit.readOnly': '插件当前是只读模式（allowWrite: false）',
      'commit.noIdentity': '这个仓库还没有配置 user.name / user.email，无法提交。',
      'commit.busy': '正在提交…',
      'commit.done': '已提交 {hash}',
      'operation.merge': '合并未完成',
      'operation.cherry-pick': '拣选未完成',
      'operation.revert': '还原未完成',
      'operation.rebase': '变基未完成',
      'operation.unknown': '有未解决的冲突',
      'operation.hint': '解决「冲突」组里的文件后暂存并提交；或放弃，把它当作没发生过。',
      'operation.abort': '放弃这次操作',
      'operation.aborted': '已放弃这次操作',
      'confirm.abortMerge': '撤销这次合并，回到合并前的状态：当前分支的提交不变，对方分支的改动不会被合并进来，你已经做的冲突解决会丢失。',
      'confirm.abortCherryPick': '撤销这次拣选，回到拣选前的状态：该提交的改动不会被应用，你已经做的冲突解决会丢失。',
      'confirm.abortRevert': '撤销这次还原，回到还原前的状态，你已经做的冲突解决会丢失。',
      'confirm.abortRebase': '撤销这次变基，回到变基前的状态，你已经做的冲突解决会丢失。',
      'diff.conflictNote': '冲突文件：下面是当前内容（含 <<<<<<< 标记）。解决后暂存即表示冲突已解决。',
      'diff.empty': '这个文件没有可显示的差异。',
      'diff.binary': '二进制文件，无法显示文本差异。',
      'diff.truncated': '差异过大，只显示了一部分。',
      'history.all': '全部引用',
      'history.empty': '还没有提交。',
      'history.loading': '正在读取提交历史…',
      'history.back': '返回列表',
      'history.files': '变更文件',
      'branches.local': '本地分支',
      'branches.remote': '远程分支',
      'branches.tag': '标签',
      'branches.empty': '没有分支。',
      'branches.current': '当前',
      'branches.upstreamOfHead': '当前分支的上游',
      'branches.gone': '上游已删除',
      'state.refreshing': '正在刷新…',
      'state.notRepoTitle': '不是 git 仓库',
      'state.workspace': '工作区目录',
      'empty.changesTitle': '工作区干净',
      'changes.total': '{n} 个改动',
      'action.stageAll': '全部暂存',
      'dir.root': '根目录',
      'diff.collapse': '折叠这段改动',
      'diff.expand': '展开这段改动',
      'diff.stat': '+{adds} −{dels}',
      'notice.staged': '已暂存 {n} 个文件',
      'notice.unstaged': '已取消暂存 {n} 个文件',
      'commit.submitCount': '提交 {n} 个文件',
      'commit.shortcut': 'Ctrl/⌘ + Enter',
      'history.count': '{n} 次提交',
      'branches.count': '{n} 个引用',
      'confirm.cancel': '取消',
      'confirm.discardDetail': '这会丢弃 {n} 个文件里未提交的改动，无法恢复。',
      'confirm.checkoutDetail': '切换会改动工作区；有未提交改动时 git 可能拒绝。',
      'confirm.checkoutCommitDetail': '这会进入游离 HEAD 状态。',
      'confirm.deleteBranchDetail': '面板只做安全删除：未合并的分支会被 git 拒绝。',
      'confirm.deleteTagDetail': '标签会从本地删除。',
      'confirm.pullDetail': '只做快进式拉取，不会创建合并提交。',
      'confirm.pushDetail': '把本地提交推送到远端；面板不会强制推送。',
      'confirm.resetSoftDetail': 'HEAD 移到该提交，改动保留在暂存区。',
      'confirm.resetMixedDetail': 'HEAD 移到该提交，改动保留但不再暂存。',
      'confirm.revertDetail': '会创建一个反向提交。',
      'confirm.cherryPickDetail': '把这个提交应用到当前分支。',
      'confirm.mergeDetail': '把 {name} 合并进当前分支。',
      'op.branchCreate': '新建分支',
      'op.checkout': '切换分支',
      'op.checkoutCommit': '检出提交',
      'op.branchDelete': '删除分支',
      'op.tagCreate': '新建标签',
      'op.tagDelete': '删除标签',
      'op.discard': '放弃改动',
      'op.fetch': '获取',
      'op.pull': '拉取',
      'op.push': '推送',
      'op.resetSoft': '软重置',
      'op.resetMixed': '混合重置',
      'op.revert': '还原提交',
      'op.cherryPick': '拣选提交',
      'op.merge': '合并',
      'action.switch': '切换',
      'action.delete': '删除',
      'action.discard': '放弃',
      'action.discardAll': '全部放弃',
      'action.revert': '还原',
      'action.cherryPick': '拣选',
      'action.checkout': '检出',
      'action.merge': '合并',
      'action.create': '创建',
      'branch.namePlaceholder': '分支名，如 feature/login',
      'branch.startPlaceholder': '起点（留空 = 当前 HEAD）',
      'tag.namePlaceholder': '标签名，如 v1.0.0',
      'tag.revPlaceholder': '指向（留空 = 当前 HEAD）',
      'remotes.title': '远程仓库',
      'notice.branchCreated': '已创建并切换到 {name}',
      'notice.switched': '已切换到 {name}',
      'notice.branchDeleted': '已删除分支 {name}',
      'notice.tagCreated': '已创建标签 {name}',
      'notice.tagDeleted': '已删除标签 {name}',
      'notice.discarded': '已放弃 {n} 个文件的改动',
      'notice.fetched': '已获取远端更新',
      'notice.pulled': '已拉取',
      'notice.pushed': '已推送',
      'notice.reset': '已重置到 {rev}',
      'notice.reverted': '已还原提交 {rev}',
      'notice.cherryPicked': '已拣选提交 {rev}',
      'notice.merged': '已合并 {name}',
      'common.error': '出错了',
    };

    /** English dictionary over the same key set. */
    const en = {
      'type.label': 'Git',
      'guide.title': 'Git',
      'guide.description': 'Changes, diffs and history for this workspace, with staging and commit',
      'header.open': 'Open the Git panel',
      'dock.branch': 'Current branch',
      'dock.loading': 'Reading branches…',
      'dock.empty': 'No other local branch.',
      'dock.detached': 'Detached HEAD',
      'dock.confirmTitle': 'Switch to {branch}?',
      'dock.confirmDetail': 'Switching updates files in the working tree; git refuses when uncommitted changes would be overwritten.',
      'dock.confirm': 'Switch',
      'dock.cancel': 'Cancel',
      'tab.changes': 'Changes',
      'tab.history': 'History',
      'tab.branches': 'Branches',
      'state.loading': 'Reading the repository…',
      'state.noWorkspace': 'This Session has no workspace directory.',
      'state.retry': 'Retry',
      'state.refresh': 'Refresh',
      'state.unborn': 'No commits yet',
      'state.detached': 'Detached HEAD',
      'state.clean': 'The working tree is clean.',
      'group.conflicted': 'Conflicts',
      'group.staged': 'Staged',
      'group.unstaged': 'Changes',
      'group.untracked': 'Untracked',
      'action.stage': 'Stage',
      'action.unstage': 'Unstage',
      'action.close': 'Close the diff',
      'commit.placeholder': 'Commit message…',
      'commit.submit': 'Commit',
      'commit.count': '{n} staged file(s)',
      'commit.noneStaged': 'Nothing is staged yet',
      'commit.readOnly': 'The plugin runs read-only (allowWrite: false)',
      'commit.noIdentity': 'This repository has no user.name / user.email, so it cannot commit.',
      'commit.busy': 'Committing…',
      'commit.done': 'Committed {hash}',
      'operation.merge': 'Merge in progress',
      'operation.cherry-pick': 'Cherry-pick in progress',
      'operation.revert': 'Revert in progress',
      'operation.rebase': 'Rebase in progress',
      'operation.unknown': 'Unresolved conflicts',
      'operation.hint': 'Resolve the files in the Conflicts group, then stage and commit; or abandon it and pretend it never started.',
      'operation.abort': 'Abandon it',
      'operation.aborted': 'Abandoned',
      'confirm.abortMerge': 'Undoes this merge and returns to the state before it: your branch keeps its commits, the other branch is not merged in, and conflict resolutions made so far are lost.',
      'confirm.abortCherryPick': 'Undoes this cherry-pick and returns to the state before it: the commit is not applied, and resolutions made so far are lost.',
      'confirm.abortRevert': 'Undoes this revert and returns to the state before it; resolutions made so far are lost.',
      'confirm.abortRebase': 'Undoes this rebase and returns to the state before it; resolutions made so far are lost.',
      'diff.conflictNote': 'Conflicted file: this is the current content, markers included. Staging it marks the conflict resolved.',
      'diff.empty': 'No text difference to show.',
      'diff.binary': 'Binary file: no text diff.',
      'diff.truncated': 'The diff is large; only part of it is shown.',
      'history.all': 'All refs',
      'history.empty': 'No commits yet.',
      'history.loading': 'Reading history…',
      'history.back': 'Back to the list',
      'history.files': 'Changed files',
      'branches.local': 'Local',
      'branches.remote': 'Remote',
      'branches.tag': 'Tags',
      'branches.empty': 'No branches.',
      'branches.current': 'current',
      'branches.upstreamOfHead': 'upstream of HEAD',
      'branches.gone': 'upstream gone',
      'state.refreshing': 'Refreshing…',
      'state.notRepoTitle': 'Not a git repository',
      'state.workspace': 'Workspace directory',
      'empty.changesTitle': 'Working tree clean',
      'changes.total': '{n} change(s)',
      'action.stageAll': 'Stage all',
      'dir.root': 'root',
      'diff.collapse': 'Collapse this hunk',
      'diff.expand': 'Expand this hunk',
      'diff.stat': '+{adds} −{dels}',
      'notice.staged': 'Staged {n} file(s)',
      'notice.unstaged': 'Unstaged {n} file(s)',
      'commit.submitCount': 'Commit {n} file(s)',
      'commit.shortcut': 'Ctrl/⌘ + Enter',
      'history.count': '{n} commit(s)',
      'branches.count': '{n} ref(s)',
      'confirm.cancel': 'Cancel',
      'confirm.discardDetail': 'This discards uncommitted changes in {n} file(s) and cannot be undone.',
      'confirm.checkoutDetail': 'Switching changes the working tree; git may refuse while changes are uncommitted.',
      'confirm.checkoutCommitDetail': 'This leaves HEAD detached.',
      'confirm.deleteBranchDetail': 'Safe delete only: git refuses a branch that is not merged.',
      'confirm.deleteTagDetail': 'The tag is removed from this repository.',
      'confirm.pullDetail': 'Fast-forward only; no merge commit is created.',
      'confirm.pushDetail': 'Publishes local commits; the panel never force pushes.',
      'confirm.resetSoftDetail': 'HEAD moves to that commit; the changes stay staged.',
      'confirm.resetMixedDetail': 'HEAD moves to that commit; the changes stay unstaged.',
      'confirm.revertDetail': 'Records the inverse as a new commit.',
      'confirm.cherryPickDetail': 'Applies that commit onto the current branch.',
      'confirm.mergeDetail': 'Merges {name} into the current branch.',
      'op.branchCreate': 'New branch',
      'op.checkout': 'Switch branch',
      'op.checkoutCommit': 'Check out commit',
      'op.branchDelete': 'Delete branch',
      'op.tagCreate': 'New tag',
      'op.tagDelete': 'Delete tag',
      'op.discard': 'Discard changes',
      'op.fetch': 'Fetch',
      'op.pull': 'Pull',
      'op.push': 'Push',
      'op.resetSoft': 'Soft reset',
      'op.resetMixed': 'Mixed reset',
      'op.revert': 'Revert commit',
      'op.cherryPick': 'Cherry-pick',
      'op.merge': 'Merge',
      'action.switch': 'Switch',
      'action.delete': 'Delete',
      'action.discard': 'Discard',
      'action.discardAll': 'Discard all',
      'action.revert': 'Revert',
      'action.cherryPick': 'Cherry-pick',
      'action.checkout': 'Check out',
      'action.merge': 'Merge',
      'action.create': 'Create',
      'branch.namePlaceholder': 'Branch name, e.g. feature/login',
      'branch.startPlaceholder': 'Start point (empty = HEAD)',
      'tag.namePlaceholder': 'Tag name, e.g. v1.0.0',
      'tag.revPlaceholder': 'Target (empty = HEAD)',
      'remotes.title': 'Remotes',
      'notice.branchCreated': 'Created and switched to {name}',
      'notice.switched': 'Switched to {name}',
      'notice.branchDeleted': 'Deleted branch {name}',
      'notice.tagCreated': 'Created tag {name}',
      'notice.tagDeleted': 'Deleted tag {name}',
      'notice.discarded': 'Discarded changes in {n} file(s)',
      'notice.fetched': 'Fetched remote updates',
      'notice.pulled': 'Pulled',
      'notice.pushed': 'Pushed',
      'notice.reset': 'Reset to {rev}',
      'notice.reverted': 'Reverted {rev}',
      'notice.cherryPicked': 'Cherry-picked {rev}',
      'notice.merged': 'Merged {name}',
      'common.error': 'Something went wrong',
    };

    /** Shared, per-Session headline state so the chip title costs no extra request. */
    const headlines = (() => {
      const values = new Map();
      const listeners = new Set();
      return {
        get: (sessionId) => values.get(sessionId),
        set(sessionId, value) {
          values.set(sessionId, value);
          for (const listener of listeners) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    })();

    /**
     * Repository-change notifications. The panel and the composer chip live in
     * separate slot trees, so a write in one is invisible to the other: without this
     * the chip would keep naming the previous branch until its next poll, and the
     * panel would not notice a switch made from the chip.
     */
    const repoListeners = new Set();
    function notifyRepoChanged() {
      for (const listener of repoListeners) listener();
    }

    /** React 18's external-store hook, with a subscribe-and-force fallback. */
    const useExternalStore =
      React.useSyncExternalStore ??
      ((subscribe, getSnapshot) => {
        const [, bump] = useState(0);
        useEffect(() => subscribe(() => bump((value) => value + 1)), [subscribe]);
        return getSnapshot();
      });

    /** One JSON round trip against the Host half; failures carry the Host's message. */
    async function request(path, init) {
      const options = init === undefined ? undefined : init;
      let response;
      try {
        response = await fetch(path, options);
      } catch (error) {
        const failure = new Error(String((error && error.message) || error));
        failure.code = 'network';
        throw failure;
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        const message =
          payload && payload.error && payload.error.message
            ? payload.error.message
            : `HTTP ${String(response.status)}`;
        const failure = new Error(message);
        failure.code = payload && payload.error ? payload.error.code : `http-${String(response.status)}`;
        throw failure;
      }
      return payload;
    }

    const query = (params) =>
      Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join('&');

    /** One JSON POST against the Host half. */
    const post = (path, body) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const api = {
      status: (root) => request(`${API}/status?${query({ root })}`),
      head: (root) => request(`${API}/head?${query({ root })}`),
      diff: (root, side, path) => request(`${API}/diff?${query({ root, side, path })}`),
      log: (root, options) =>
        request(`${API}/log?${query({ root, limit: options.limit, all: options.all ? 1 : 0 })}`),
      commitDetail: (root, rev) => request(`${API}/commit?${query({ root, rev })}`),
      branches: (root) => request(`${API}/branches?${query({ root })}`),
      remotes: (root) => request(`${API}/remotes?${query({ root })}`),
      stage: (root, paths) => post(`${API}/stage`, { root, paths }),
      unstage: (root, paths) => post(`${API}/unstage`, { root, paths }),
      commit: (root, message) => post(`${API}/commit`, { root, message }),
      createBranch: (root, name, start) => post(`${API}/branch`, { root, name, start }),
      checkout: (root, ref, detach) => post(`${API}/checkout`, { root, ref, detach }),
      deleteBranch: (root, name) => post(`${API}/branch-delete`, { root, name }),
      createTag: (root, name, rev) => post(`${API}/tag`, { root, name, rev }),
      deleteTag: (root, name) => post(`${API}/tag-delete`, { root, name }),
      sync: (root, action, extra) => post(`${API}/sync`, { root, action, ...(extra ?? {}) }),
      discard: (root, paths) => post(`${API}/discard`, { root, paths }),
      undo: (root, action, rev, mode) => post(`${API}/undo`, { root, action, rev, mode }),
      abort: (root, operation) => post(`${API}/abort`, { root, operation }),
    };

    /** Split a repository-relative path into its display name and directory. */
    function splitPath(path) {
      const index = path.lastIndexOf('/');
      if (index === -1) return { name: path, dir: '' };
      return { name: path.slice(index + 1), dir: path.slice(0, index) };
    }

    /** CSS class for one status letter. */
    function markClass(letter) {
      const upper = String(letter || '?').toUpperCase();
      if (upper === 'A') return 'tw-git-mark a';
      if (upper === 'D') return 'tw-git-mark d';
      if (upper === 'U') return 'tw-git-mark u';
      if (upper === '?') return 'tw-git-mark q';
      return 'tw-git-mark m';
    }

    /**
     * One patch line's role inside a hunk. Anything that is neither a context,
     * an addition nor a deletion (a "\ No newline" marker, say) stays inert.
     */
    function lineKind(line) {
      const first = line.charAt(0);
      if (first === '+') return 'add';
      if (first === '-') return 'del';
      if (first === ' ') return 'ctx';
      if (first === '') return 'ctx';
      return 'meta';
    }

    /** `@@ -a,b +c,d @@` → the first old and new line numbers of one hunk. */
    function parseHunkHeader(line) {
      const match = /^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match === null) return { oldStart: 0, newStart: 0 };
      return { oldStart: Number(match[1]), newStart: Number(match[2]) };
    }

    /** Length of the shared leading run of two strings. */
    function commonPrefix(left, right) {
      const limit = Math.min(left.length, right.length);
      let index = 0;
      while (index < limit && left.charAt(index) === right.charAt(index)) index += 1;
      return index;
    }

    /** Length of the shared trailing run, never crossing the shared prefix. */
    function commonSuffix(left, right, prefix) {
      const limit = Math.min(left.length, right.length) - prefix;
      let index = 0;
      while (
        index < limit &&
        left.charAt(left.length - 1 - index) === right.charAt(right.length - 1 - index)
      ) {
        index += 1;
      }
      return index;
    }

    /** Split one side of a replaced line into unchanged and changed runs. */
    function inlineSegments(text, prefix, suffix) {
      const parts = [];
      if (prefix > 0) parts.push({ text: text.slice(0, prefix), changed: false });
      const end = text.length - suffix;
      if (end > prefix) parts.push({ text: text.slice(prefix, end), changed: true });
      if (suffix > 0) parts.push({ text: text.slice(text.length - suffix), changed: false });
      return parts;
    }

    /**
     * Highlight the word-level change between one deleted and one added line.
     * Trivial and very long replacements stay plain on purpose: there the marks
     * would be noise rather than information.
     */
    function applyInline(del, add) {
      const left = del.text.slice(1);
      const right = add.text.slice(1);
      if (left.length > 500 || right.length > 500) return;
      const prefix = commonPrefix(left, right);
      const suffix = commonSuffix(left, right, prefix);
      if (prefix + suffix < 4) return;
      del.segments = inlineSegments(left, prefix, suffix);
      add.segments = inlineSegments(right, prefix, suffix);
    }

    /** Mark word-level changes inside every replaced-line pair of one hunk. */
    function annotateHunk(hunk) {
      const rows = hunk.lines;
      let index = 0;
      while (index < rows.length) {
        if (rows[index].kind !== 'del') {
          index += 1;
          continue;
        }
        let dels = index;
        while (dels < rows.length && rows[dels].kind === 'del') dels += 1;
        let adds = dels;
        while (adds < rows.length && rows[adds].kind === 'add') adds += 1;
        // Pair one-for-one replacements only; block rewrites read better plain.
        if (dels - index === 1 && adds - dels === 1) applyInline(rows[index], rows[dels]);
        index = adds;
      }
    }

    /**
     * Split one patch into files, hunks and numbered lines. Every line carries
     * its old and new number so the viewer can draw a gutter, and replaced pairs
     * carry the inline highlight segments computed above.
     */
    function parseFilePatch(text) {
      const files = [];
      const raw = String(text ?? '').split('\n');
      let file = null;
      let hunk = null;
      let oldNo = 0;
      let newNo = 0;
      for (let index = 0; index < raw.length; index += 1) {
        const line = raw[index];
        // A patch ends with a newline: drop the empty tail it produces.
        if (line === '' && index === raw.length - 1) continue;
        if (line.startsWith('diff --git ')) {
          file = {
            header: line,
            path: patchPath(line),
            meta: [],
            hunks: [],
            adds: 0,
            dels: 0,
            binary: false,
          };
          files.push(file);
          hunk = null;
          continue;
        }
        if (file === null) {
          if (line === '') continue;
          file = { header: '', path: null, meta: [], hunks: [], adds: 0, dels: 0, binary: false };
          files.push(file);
          hunk = null;
        }
        if (line.startsWith('@@')) {
          const start = parseHunkHeader(line);
          hunk = { header: line, oldStart: start.oldStart, newStart: start.newStart, lines: [] };
          oldNo = start.oldStart;
          newNo = start.newStart;
          file.hunks.push(hunk);
          continue;
        }
        if (hunk === null) {
          file.meta.push(line);
          if (line.startsWith('Binary files')) file.binary = true;
          continue;
        }
        const kind = lineKind(line);
        let oldNumber = null;
        let newNumber = null;
        if (kind === 'add') {
          newNumber = newNo;
          newNo += 1;
          file.adds += 1;
        } else if (kind === 'del') {
          oldNumber = oldNo;
          oldNo += 1;
          file.dels += 1;
        } else if (kind === 'ctx') {
          oldNumber = oldNo;
          newNumber = newNo;
          oldNo += 1;
          newNo += 1;
        }
        hunk.lines.push({ kind, text: line, old: oldNumber, new: newNumber, segments: null });
      }
      for (const entry of files) {
        for (const entryHunk of entry.hunks) annotateHunk(entryHunk);
      }
      return files;
    }

    /** The `b/` path of a `diff --git a/x b/x` header, when it has one. */
    function patchPath(header) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
      if (match === null) return null;
      return match[2];
    }

    /** Best-effort per-file status letter for a commit patch. */
    function patchStatus(section) {
      for (const line of section.meta) {
        if (line.startsWith('new file')) return 'A';
        if (line.startsWith('deleted file')) return 'D';
        if (line.startsWith('rename from')) return 'R';
      }
      return 'M';
    }

    /**
     * Assign one lane per commit, and one lane per parent edge, so every row can
     * draw its own segment while sharing one column geometry.
     * @param commits - newest-first commit records with `parents`.
     * @returns rows carrying lane facts plus the widest lane count.
     */
    function layoutGraph(commits) {
      const lanes = [];
      const rows = [];
      for (const commit of commits) {
        const found = lanes.indexOf(commit.hash);
        // An edge from above already targets this commit when its lane pre-existed.
        const entering = found !== -1;
        let lane = found;
        if (lane === -1) {
          lane = lanes.indexOf(null);
          if (lane === -1) {
            lane = lanes.length;
            lanes.push(null);
          }
          lanes[lane] = commit.hash;
        }
        const before = lanes.slice();
        const parents = commit.parents;
        // A previous row may already be heading for this commit's first parent
        // (the diamond: M→[A,B], A→C, B→C). Forcing that parent into this row's own
        // lane would clear the other lane here, and the renderer would then bend
        // that branch into *this* dot instead of letting it continue to C. Reuse
        // the lane that already carries it and retire this row's lane instead.
        const shared = parents.length === 0 ? -1 : lanes.indexOf(parents[0]);
        if (parents.length === 0) {
          lanes[lane] = null;
        } else if (shared !== -1 && shared !== lane) {
          lanes[lane] = null;
          lanes[shared] = parents[0];
        } else {
          lanes[lane] = parents[0];
        }
        const parentLanes = [];
        for (let index = 0; index < parents.length; index += 1) {
          const parent = parents[index];
          if (index === 0) {
            parentLanes.push(shared !== -1 && shared !== lane ? shared : lane);
            continue;
          }
          let target = lanes.indexOf(parent);
          if (target === -1) {
            target = lanes.indexOf(null);
            if (target === -1) {
              target = lanes.length;
              lanes.push(null);
            }
            lanes[target] = parent;
          }
          parentLanes.push(target);
        }
        for (let index = 0; index < lanes.length; index += 1) {
          if (index === lane || index === shared) continue;
          if (lanes[index] !== null && lanes[index] === lanes[lane]) lanes[index] = null;
        }
        while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
        rows.push({ commit, lane, entering, before, after: lanes.slice(), parentLanes });
      }
      let widest = 1;
      for (const row of rows) widest = Math.max(widest, row.before.length, row.after.length);
      return { rows, widest };
    }

    /**
     * One row's graph segment, drawn Git-Graph style: every lane that crosses
     * this row spans the full height, edges bend with rounded corners, and the
     * dot sits solid on its line, so rows join into one continuous graph.
     */
    function GraphCell(props) {
      const { row, widest, height } = props;
      const step = 14;
      const x = (lane) => 8 + lane * step;
      const width = Math.max(22, 6 + widest * step);
      const middle = height / 2;
      const r = 5;
      const parts = [];
      const palette = [
        'var(--dsw-alias-brand-primary)',
        'var(--dsw-alias-state-success-primary)',
        'var(--dsw-alias-state-warn-primary)',
        'var(--dsw-alias-label-secondary)',
        'var(--dsw-alias-state-error-primary)',
      ];
      const laneColor = (lane) => palette[lane % palette.length];
      const stroke = (color) => ({
        stroke: color,
        fill: 'none',
        'stroke-width': 1.6,
        'stroke-linecap': 'round',
        opacity: 0.9,
      });
      // Lanes passing straight through this row.
      for (let lane = 0; lane < row.before.length; lane += 1) {
        if (row.before[lane] === null || lane === row.lane) continue;
        if (row.after[lane] !== row.before[lane]) continue;
        parts.push(
          h('path', {
            key: `p${String(lane)}`,
            d: `M ${x(lane)} 0 L ${x(lane)} ${height}`,
            ...stroke(laneColor(lane)),
          }),
        );
      }
      // Lanes that end here: down the lane, then a rounded elbow into the dot.
      for (let lane = 0; lane < row.before.length; lane += 1) {
        if (row.before[lane] === null || lane === row.lane) continue;
        if (row.after[lane] === row.before[lane]) continue;
        const from = x(lane);
        const to = x(row.lane);
        const dir = to > from ? 1 : -1;
        parts.push(
          h('path', {
            key: `e${String(lane)}`,
            d: `M ${from} 0 L ${from} ${middle - r} Q ${from} ${middle}, ${from + dir * r} ${middle} L ${to} ${middle}`,
            ...stroke(laneColor(lane)),
          }),
        );
      }
      // The dot lane's own edge from above; without it rows would not join up.
      if (row.entering === true) {
        parts.push(
          h('path', {
            key: 'in',
            d: `M ${x(row.lane)} 0 L ${x(row.lane)} ${middle}`,
            ...stroke(laneColor(row.lane)),
          }),
        );
      }
      // Edges from the dot down to each parent lane.
      for (let index = 0; index < row.parentLanes.length; index += 1) {
        const target = row.parentLanes[index];
        const from = x(row.lane);
        const to = x(target);
        parts.push(
          h('path', {
            key: `o${String(index)}`,
            d:
              target === row.lane
                ? `M ${from} ${middle} L ${from} ${height}`
                : `M ${from} ${middle} C ${from} ${middle + height / 4}, ${to} ${height - height / 4}, ${to} ${height}`,
            ...stroke(laneColor(target)),
          }),
        );
      }
      // The dot itself: solid, with a thin ring so crossings stay readable.
      parts.push(
        h('circle', {
          key: 'dot',
          cx: x(row.lane),
          cy: middle,
          r: 3.4,
          fill: laneColor(row.lane),
          stroke: 'var(--dsw-alias-bg-base)',
          'stroke-width': 1.4,
        }),
      );
      return h(
        'svg',
        {
          className: 'tw-git-graph',
          width,
          height,
          viewBox: `0 0 ${String(width)} ${String(height)}`,
          'aria-hidden': true,
        },
        parts,
      );
    }

    /** Upper bound on rendered diff lines: a huge patch must not freeze the panel. */
    const MAX_DIFF_LINES = 4000;

    /** Height of one history row; the graph SVG fills it exactly, so the
     * lanes of adjacent rows touch and the graph reads as one continuous line. */
    const GRAPH_ROW = 42;

    /** Compact commit date: `YYYY-MM-DD HH:mm` from the ISO author date. */
    const commitWhen = (iso) => String(iso ?? '').slice(0, 16).replace('T', ' ');

    /** The sign the gutter shows for one diff line. */
    function lineSign(line) {
      if (line.kind === 'add') return '+';
      if (line.kind === 'del') return '−';
      return '';
    }

    /** One line's text, with the word-level marks of a replaced pair applied. */
    function lineText(line) {
      if (line.kind === 'meta') return line.text;
      if (line.segments === null || line.segments === undefined) return line.text.slice(1).replace(/\r$/, '');
      return line.segments.map((part, index) =>
        part.changed
          ? h('mark', { key: String(index), className: 'tw-git-word' }, part.text)
          : h('span', { key: String(index) }, part.text),
      );
    }

    /**
     * Render one patch as a numbered, foldable file/hunk tree. A folded hunk is
     * skipped entirely, which also makes folding the escape hatch for huge diffs.
     */
    function DiffCode(props) {
      const { text, binary, truncated, empty, t, resetKey } = props;
      const files = useMemo(
        () => (typeof text === 'string' && text !== '' ? parseFilePatch(text) : []),
        [text],
      );
      const [folded, setFolded] = useState(() => new Set());
      useEffect(() => {
        setFolded(new Set());
      }, [resetKey]);
      if (binary === true) return h('p', { className: 'tw-git-note' }, t('diff.binary'));
      if (text === '' || text === undefined || text === null) {
        return h('p', { className: 'tw-git-note' }, empty);
      }
      const nodes = [];
      let rendered = 0;
      let clipped = false;
      const toggle = (key) =>
        setFolded((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      const line = (key, kind, oldNo, newNo, sign, content) =>
        h(
          'div',
          { key, className: `tw-git-line ${kind}` },
          h('span', { className: 'tw-git-lno' }, oldNo === null ? '' : oldNo),
          h('span', { className: 'tw-git-lno' }, newNo === null ? '' : newNo),
          h('span', { className: 'tw-git-sign' }, sign),
          h('span', { className: 'tw-git-text' }, content),
        );
      const named = files.length > 1;
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        if (named) {
          nodes.push(
            h(
              'div',
              { key: `fh${String(fileIndex)}`, className: 'tw-git-filehead' },
              h('span', { className: 'tw-git-filepath', title: file.path ?? '' }, file.path ?? '?'),
              h(
                'span',
                { className: 'tw-git-filestat' },
                t('diff.stat', { adds: file.adds, dels: file.dels }),
              ),
            ),
          );
        }
        if (file.hunks.length === 0) {
          for (let metaIndex = 0; metaIndex < file.meta.length; metaIndex += 1) {
            if (rendered >= MAX_DIFF_LINES) {
              clipped = true;
              break;
            }
            rendered += 1;
            nodes.push(
              line(`m${String(fileIndex)}:${String(metaIndex)}`, 'meta', null, null, '', file.meta[metaIndex]),
            );
          }
        }
        for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex += 1) {
          const hunk = file.hunks[hunkIndex];
          const key = `${String(fileIndex)}:${String(hunkIndex)}`;
          const isFolded = folded.has(key);
          nodes.push(
            h(
              'div',
              { key: `h${key}`, className: 'tw-git-hunkrow' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'tw-git-hunkbtn',
                  title: isFolded ? t('diff.expand') : t('diff.collapse'),
                  'aria-label': isFolded ? t('diff.expand') : t('diff.collapse'),
                  'aria-expanded': isFolded ? 'false' : 'true',
                  onClick: () => toggle(key),
                },
                isFolded ? '▸' : '▾',
              ),
              h('span', { className: 'tw-git-hunktext' }, hunk.header),
            ),
          );
          if (isFolded) continue;
          for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex += 1) {
            if (rendered >= MAX_DIFF_LINES) {
              clipped = true;
              break;
            }
            rendered += 1;
            const entry = hunk.lines[lineIndex];
            nodes.push(
              line(
                `l${key}:${String(lineIndex)}`,
                entry.kind,
                entry.old,
                entry.new,
                lineSign(entry),
                lineText(entry),
              ),
            );
          }
          if (clipped) break;
        }
        if (clipped) break;
      }
      if (clipped || truncated === true) {
        nodes.push(h('p', { key: 'trunc', className: 'tw-git-note' }, t('diff.truncated')));
      }
      return h(React.Fragment, null, nodes);
    }

    /** Compact inline SVG mark reused by the guide card, the chip and the header button. */
    function GitMark(props) {
      const size = props.size ?? 16;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 7, cy: 5.5, r: 2.2 }),
        h('circle', { cx: 7, cy: 18.5, r: 2.2 }),
        h('circle', { cx: 17, cy: 10, r: 2.2 }),
        h('path', { d: 'M7 7.7v8.6' }),
        h('path', { d: 'M7 13.2c0-3.1 3.2-3.2 5.6-3.2h2.2' }),
      );
    }

    /** The tab chip's live text: branch, ahead/behind and change count. */
    function GitTabTitle(props) {
      const { sessionId, t } = props;
      const headline = useExternalStore(headlines.subscribe, () => headlines.get(sessionId));
      if (headline === undefined || headline === null) {
        return h(React.Fragment, null, h(GitMark, { size: 14 }), t('type.label'));
      }
      const parts = [h(GitMark, { key: 'mark', size: 14 })];
      const label = headline.branch === null ? t('state.detached') : headline.branch;
      parts.push(h('span', { key: 'branch' }, label));
      if (headline.total > 0) parts.push(h('span', { key: 'count' }, ` ●${String(headline.total)}`));
      return h(React.Fragment, null, parts);
    }

    /**
     * Self-contained styles for the Session-header button. That slot renders
     * outside the tab, so it cannot rely on the panel's stylesheet.
     */
    const OPEN_CSS = [
      '.tw-git-openbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.tw-git-openbtn:hover{border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}',
    ].join('');

    /**
     * The composer chip carries its own rules: the panel's stylesheet only exists
     * while the tab is mounted, and the chip must look right without it.
     */
    const DOCK_CSS = [
      // The chip copies the metrics of the built-in pills beside it (no frame, the
      // same 20px line box, the same tertiary label and hover fill), and the menu
      // uses the composition's menu surface, so both read as part of that row.
      '.tw-git-dock{position:relative;display:inline-flex;align-items:center;min-width:0}',
      '.tw-git-dockchip{box-sizing:border-box;max-width:100%;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;background:0 0;border:none;border-radius:999px;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer}',
      '.tw-git-dockchip svg{flex:none;width:14px;height:14px}',
      '.tw-git-dockchip:hover,.tw-git-dockchip[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.tw-git-dockname{max-width:200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-dockmeta{flex:none;font-variant-numeric:tabular-nums}',
      '.tw-git-dockmenu{position:absolute;bottom:calc(100% + 8px);left:0;z-index:30;display:flex;flex-direction:column;min-width:190px;max-width:300px;max-height:240px;overflow:auto;padding:4px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,8px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2)));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:0 12px 28px color-mix(in srgb,var(--dsw-alias-bg-base) 45%,transparent)}',
      '.tw-git-dockrow{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:4px 8px;border:.5px solid transparent;border-radius:var(--dsw-radius-md,6px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;text-align:left;cursor:pointer}',
      '.tw-git-dockrow:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}',
      '.tw-git-dockrow.current{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);cursor:default}',
      '.tw-git-dockconfirm{display:flex;flex-direction:column;gap:5px;padding:6px 8px}',
      '.tw-git-docktitle{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}',
      '.tw-git-docknote{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}',
      '.tw-git-dockerror{color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:1.5;word-break:break-word}',
      '.tw-git-dockactions{display:flex;align-items:center;justify-content:flex-end;gap:6px}',
      '.tw-git-dockbtn{padding:2px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:20px;cursor:pointer}',
      '.tw-git-dockbtn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}',
      '.tw-git-dockbtn.primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.tw-git-dockbtn:disabled{opacity:.5;cursor:default}',
    ].join('');

    /** The button in the Session header that opens this tab. */
    function GitOpenAction(props) {
      const { t, openTab } = props;
      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, OPEN_CSS),
        h(
          'button',
          {
            key: 'button',
            type: 'button',
            className: 'tw-git-openbtn',
            title: t('header.open'),
            'aria-label': t('header.open'),
            onClick: () => openTab(),
          },
          h(GitMark, { size: 15 }),
        ),
      );
    }

    /** The last path segment of a repository root, for the header label. */
    function repoName(root) {
      const text = String(root ?? '').replace(/[\\/]+$/, '');
      const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
      return index === -1 ? text : text.slice(index + 1);
    }

    /** Centred placeholder for a state that has no list to show yet. */
    function PanelState(props) {
      const { title, detail, retry, t } = props;
      return h(
        'div',
        { className: 'tw-git-state' },
        h(GitMark, { size: 26 }),
        h('p', { className: 'tw-git-statetitle' }, title),
        detail === undefined || detail === null || detail === ''
          ? null
          : h('p', { className: 'tw-git-statedetail', title: detail }, detail),
        retry === undefined || retry === null
          ? null
          : h(
              'button',
              { type: 'button', className: 'tw-git-ghost', onClick: retry },
              t('state.retry'),
            ),
      );
    }

    /** The repository headline: where we are, on what branch, and a refresh. */
    function PanelHeader(props) {
      const { status, busy, onRefresh, t } = props;
      const branch = status.unborn ? t('state.unborn') : status.branch ?? t('state.detached');
      const meta = [];
      if (status.upstream !== null && status.upstream !== undefined) {
        meta.push(
          h('span', { key: 'up', className: 'tw-git-meta', title: status.upstream }, status.upstream),
        );
      }
      if (status.ahead > 0) {
        meta.push(h('span', { key: 'ahead', className: 'tw-git-meta' }, `↑${String(status.ahead)}`));
      }
      if (status.behind > 0) {
        meta.push(h('span', { key: 'behind', className: 'tw-git-meta' }, `↓${String(status.behind)}`));
      }
      return h(
        'div',
        { className: 'tw-git-head' },
        h(
          'div',
          { className: 'tw-git-headrow' },
          h(
            'span',
            { className: 'tw-git-repo', title: `${t('state.workspace')}: ${String(status.root ?? '')}` },
            repoName(status.root),
          ),
          h(
            'span',
            { className: 'tw-git-branch', title: branch },
            h(GitMark, { size: 12 }),
            h('span', { className: 'tw-git-branchtext' }, branch),
          ),
          h('span', { className: 'tw-git-spacer' }),
          h(
            'button',
            {
              type: 'button',
              className: 'tw-git-tool',
              title: busy ? t('state.refreshing') : t('state.refresh'),
              'aria-label': t('state.refresh'),
              disabled: busy,
              onClick: onRefresh,
            },
            h('span', { className: 'tw-git-spin', 'data-spin': busy ? 'true' : 'false' }, '⟳'),
          ),
        ),
        meta.length === 0 ? null : h('div', { className: 'tw-git-metarow' }, meta),
      );
    }

    /** The commit message box: draft, hint, shortcut and the primary action. */
    function CommitBox(props) {
      const { message, busy, stagedCount, capabilities, onChange, onSubmit, t } = props;
      const readOnly = capabilities.allowWrite !== true;
      const noIdentity = capabilities.identity === null || capabilities.identity === undefined;
      const hint = readOnly
        ? t('commit.readOnly')
        : noIdentity
          ? t('commit.noIdentity')
          : stagedCount === 0
            ? t('commit.noneStaged')
            : t('commit.count', { n: stagedCount });
      const disabled =
        busy !== null || readOnly || noIdentity || stagedCount === 0 || message.trim() === '';
      return h(
        'div',
        { className: 'tw-git-commit' },
        h('textarea', {
          value: message,
          placeholder: t('commit.placeholder'),
          'aria-label': t('commit.placeholder'),
          spellCheck: false,
          disabled: readOnly,
          onChange: (event) => onChange(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !disabled) {
              event.preventDefault();
              onSubmit();
            }
          },
        }),
        h(
          'div',
          { className: 'tw-git-commitrow' },
          h('span', { className: 'tw-git-hint', title: hint }, hint),
          h('span', { className: 'tw-git-spacer' }),
          h('span', { className: 'tw-git-kbd' }, t('commit.shortcut')),
          h(
            'button',
            { type: 'button', className: 'tw-git-primary', disabled, onClick: onSubmit },
            busy === 'commit'
              ? t('commit.busy')
              : stagedCount > 0
                ? t('commit.submitCount', { n: stagedCount })
                : t('commit.submit'),
          ),
        ),
      );
    }

    /** The change list: a toolbar, directory-grouped sections, and the open diff. */
    function ChangesView(props) {
      const {
        groups,
        selection,
        diff,
        busy,
        folded,
        total,
        clean,
        canStageAll,
        canDiscardAll,
        stageAllGroups,
        discardAllGroups,
        onStageAll,
        onDiscardAll,
        onToggleDir,
        onSelect,
        onStage,
        onUnstage,
        onDiscard,
        onClose,
        t,
      } = props;
      const list = h(
        'div',
        { key: 'list', className: selection === null ? 'tw-git-scroll' : 'tw-git-scroll split' },
        groups.length === 0 || clean === true
          ? h(
              'div',
              { className: 'tw-git-state' },
              h('p', { className: 'tw-git-statetitle' }, t('empty.changesTitle')),
              h('p', { className: 'tw-git-statedetail' }, t('state.clean')),
            )
          : h(
              'div',
              { className: 'tw-git-toolbar' },
              h('span', { className: 'tw-git-toolbartext' }, t('changes.total', { n: total })),
              h('span', { className: 'tw-git-spacer' }),
              // A 全部… button appears only when it spans more than one group: with a
              // single group it would just repeat that group's own button. The staged
              // group is the only unstageable one, so a global unstage never renders.
              canStageAll && stageAllGroups > 1
                ? h(
                    'button',
                    { key: 'stage', type: 'button', className: 'tw-git-ghost', disabled: busy !== null, onClick: onStageAll },
                    t('action.stageAll'),
                  )
                : null,
              canDiscardAll && discardAllGroups > 1
                ? h(
                    'button',
                    {
                      key: 'discard',
                      type: 'button',
                      className: 'tw-git-ghost danger',
                      disabled: busy !== null,
                      onClick: onDiscardAll,
                    },
                    t('action.discardAll'),
                  )
                : null,
            ),
        groups.map((group) =>
          h(ChangeGroup, {
            key: group.id,
            group,
            selectedKey: selection === null ? null : selection.key,
            busy: busy !== null,
            folded,
            onToggleDir,
            onSelect,
            onStage,
            onUnstage,
            onDiscard,
            t,
          }),
        ),
      );
      if (selection === null) return list;
      // The selection carries the letter it had when the file was picked; after a
      // stage or unstage the live group entry knows the current one.
      const liveEntry = groups
        .map((group) => group.entries.find((entry) => entry.key === selection.key))
        .find((entry) => entry !== undefined);
      const letter = liveEntry === undefined ? selection.letter : liveEntry.letter;
      const pane = h(
        'div',
        { key: 'diff', className: 'tw-git-diff' },
        h(
          'div',
          { className: 'tw-git-diffhead' },
          h('span', { className: markClass(letter) }, letter),
          h('span', { className: 'tw-git-path', title: selection.path }, selection.path),
          h('span', { className: 'tw-git-spacer' }),
          h(
            'button',
            {
              type: 'button',
              className: 'tw-git-tool',
              title: t('action.close'),
              'aria-label': t('action.close'),
              onClick: onClose,
            },
            '✕',
          ),
        ),
        h(
          'div',
          { className: 'tw-git-code' },
          diff.phase === 'loading'
            ? h('p', { className: 'tw-git-note' }, t('state.loading'))
            : diff.phase === 'error'
              ? h('p', { className: 'tw-git-note error' }, String(diff.error.message))
              : diff.phase === 'ready' && diff.diff !== undefined && diff.diff !== null
                ? h(
                    React.Fragment,
                    null,
                    diff.diff.conflicted === true
                      ? h('p', { key: 'conflictnote', className: 'tw-git-note' }, t('diff.conflictNote'))
                      : null,
                    h(DiffCode, {
                      text: diff.diff.text,
                      binary: diff.diff.binary,
                      truncated: diff.diff.truncated,
                      empty: t('diff.empty'),
                      resetKey: selection.key,
                      t,
                    }),
                  )
                : null,
        ),
      );
      return h(React.Fragment, null, list, pane);
    }

    /** Commit history: the DAG list, or the detail of one opened commit. */
    function HistoryView(props) {
      const {
        history,
        detail,
        allRefs,
        busy,
        onToggleAll,
        onOpen,
        onBack,
        onSync,
        onRevert,
        onCherryPick,
        onCheckoutCommit,
        onReset,
        t,
      } = props;
      if (detail.phase !== 'idle') {
        const commit = detail.commit;
        const files = commit === null ? [] : parseFilePatch(commit.patch);
        const subject = commit === null ? '' : String(commit.message).split('\n')[0];
        return h(
          'div',
          { className: 'tw-git-body' },
          h(
            'div',
            { className: 'tw-git-diffhead' },
            h(
              'button',
              {
                type: 'button',
                className: 'tw-git-tool',
                title: t('history.back'),
                'aria-label': t('history.back'),
                onClick: onBack,
              },
              '←',
            ),
            h(
              'span',
              { className: 'tw-git-path' },
              commit === null
                ? ''
                : `${commit.hash.slice(0, 10)}${subject === '' ? '' : ` · ${subject}`}`,
            ),
          ),
          detail.phase === 'loading'
            ? h(
                'div',
                { className: 'tw-git-scroll' },
                h('p', { className: 'tw-git-note' }, t('state.loading')),
              )
            : detail.phase === 'error'
              ? h(
                  'div',
                  { className: 'tw-git-scroll' },
                  h('p', { className: 'tw-git-note error' }, String(detail.error.message)),
                )
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'tw-git-scroll split' },
                    h(
                      'div',
                      { className: 'tw-git-metablock' },
                      h('div', { className: 'tw-git-hint' }, `${commit.author} · ${commit.date}`),
                      h('div', { className: 'tw-git-message' }, commit.message),
                      h(
                        'div',
                        { className: 'tw-git-actions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'tw-git-ghost',
                            disabled: busy !== null,
                            onClick: () => onCherryPick(commit.hash),
                          },
                          t('action.cherryPick'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'tw-git-ghost',
                            disabled: busy !== null,
                            onClick: () => onRevert(commit.hash),
                          },
                          t('action.revert'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'tw-git-ghost',
                            disabled: busy !== null,
                            onClick: () => onCheckoutCommit(commit.hash),
                          },
                          t('action.checkout'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'tw-git-ghost',
                            disabled: busy !== null,
                            onClick: () => onReset(commit.hash, 'soft'),
                          },
                          t('op.resetSoft'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'tw-git-ghost',
                            disabled: busy !== null,
                            onClick: () => onReset(commit.hash, 'mixed'),
                          },
                          t('op.resetMixed'),
                        ),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'tw-git-sectionhead' },
                      h('span', { className: 'tw-git-sectiontitle' }, t('history.files')),
                      h('span', { className: 'tw-git-count' }, files.length),
                    ),
                    ...files.map((section, index) =>
                      h(
                        'div',
                        { key: `f${String(index)}`, className: 'tw-git-row' },
                        h('span', { className: markClass(patchStatus(section)) }, patchStatus(section)),
                        h(
                          'span',
                          { className: 'tw-git-filename', title: section.path ?? '' },
                          section.path === null ? '?' : splitPath(section.path).name,
                        ),
                        h(
                          'span',
                          { className: 'tw-git-dirname' },
                          section.path === null ? '' : splitPath(section.path).dir,
                        ),
                        h(
                          'span',
                          { className: 'tw-git-hint' },
                          t('diff.stat', { adds: section.adds, dels: section.dels }),
                        ),
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'tw-git-diff' },
                    h(
                      'div',
                      { className: 'tw-git-code' },
                      h(DiffCode, {
                        text: commit.patch,
                        binary: false,
                        truncated: commit.patchTruncated,
                        empty: t('diff.empty'),
                        resetKey: commit.hash,
                        t,
                      }),
                    ),
                  ),
                ),
        );
      }
      const commits = history.commits ?? [];
      const layout = layoutGraph(commits);
      return h(
        'div',
        { className: 'tw-git-body' },
        h(
          'div',
          { className: 'tw-git-toolbar' },
          h('span', { className: 'tw-git-toolbartext' }, t('history.count', { n: commits.length })),
          h('span', { className: 'tw-git-spacer' }),
          h(
            'button',
            {
              type: 'button',
              className: 'tw-git-ghost',
              disabled: busy !== null,
              onClick: () => onSync('fetch'),
            },
            t('op.fetch'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'tw-git-ghost',
              disabled: busy !== null,
              onClick: () => onSync('pull'),
            },
            t('op.pull'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'tw-git-ghost',
              disabled: busy !== null,
              onClick: () => onSync('push'),
            },
            t('op.push'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'tw-git-ghost',
              'data-on': allRefs ? 'true' : 'false',
              onClick: onToggleAll,
            },
            t('history.all'),
          ),
        ),
        h(
          'div',
          { className: 'tw-git-scroll' },
          history.phase === 'loading'
            ? h('p', { className: 'tw-git-note' }, t('history.loading'))
            : history.phase === 'error'
              ? h('p', { className: 'tw-git-note error' }, String(history.error.message))
              : commits.length === 0
                ? h(
                    'div',
                    { className: 'tw-git-state' },
                    h('p', { className: 'tw-git-statetitle' }, t('history.empty')),
                  )
                : layout.rows.map((row) =>
                    h(
                      'button',
                      {
                        key: row.commit.hash,
                        type: 'button',
                        className: 'tw-git-commit-row',
                        title: `${row.commit.hash} · ${row.commit.author} · ${row.commit.date}`,
                        onClick: () => onOpen(row.commit.hash),
                      },
                      h(GraphCell, { row, widest: layout.widest, height: GRAPH_ROW }),
                      h(
                        'span',
                        { className: 'tw-git-commitmain' },
                        h(
                          'span',
                          { className: 'tw-git-commitline' },
                          ...(row.commit.refs ?? []).slice(0, 2).map((ref, index) =>
                            h(
                              'span',
                              {
                                key: `r${String(index)}`,
                                className: /HEAD/.test(ref) ? 'tw-git-ref head' : 'tw-git-ref',
                              },
                              ref.replace('HEAD -> ', ''),
                            ),
                          ),
                          h(
                            'span',
                            { className: 'tw-git-subject', title: row.commit.subject },
                            row.commit.subject,
                          ),
                        ),
                        h(
                          'span',
                          { className: 'tw-git-commitsub' },
                          h(
                            'span',
                            { className: 'tw-git-commitmeta' },
                            `${row.commit.author} · ${commitWhen(row.commit.date)}`,
                          ),
                          h('span', { className: 'tw-git-hash' }, row.commit.hash.slice(0, 7)),
                        ),
                      ),
                    ),
                  ),
        ),
      );
    }

    /** Local branches, remote-tracking branches and tags. */
    /** Modal confirmation for the operations that move HEAD or discard work. */
    function ConfirmDialog(props) {
      const { request, busy, onCancel, onConfirm, t } = props;
      return h(
        'div',
        { className: 'tw-git-overlay' },
        h(
          'div',
          {
            className: 'tw-git-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': request.title,
            onKeyDown: (event) => {
              if (event.key === 'Escape') onCancel();
            },
          },
          h('p', { className: 'tw-git-dialogtitle' }, request.title),
          request.detail === undefined || request.detail === null
            ? null
            : h('p', { className: 'tw-git-dialogtext' }, request.detail),
          h(
            'div',
            { className: 'tw-git-dialogrow' },
            h(
              'button',
              { type: 'button', className: 'tw-git-ghost', onClick: onCancel, autoFocus: true },
              t('confirm.cancel'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: request.danger === true ? 'tw-git-danger' : 'tw-git-primary',
                disabled: busy !== null,
                onClick: onConfirm,
              },
              request.label,
            ),
          ),
        ),
      );
    }

    /** Branches, tags and remotes, with the actions each row can run. */
    function BranchesView(props) {
      const {
        branches,
        remotes,
        busy,
        onCheckout,
        onMerge,
        onDeleteBranch,
        onCreateBranch,
        onCreateTag,
        onDeleteTag,
        t,
      } = props;
      /** The inline create form: null when closed, otherwise its draft. */
      const [form, setForm] = useState(null);
      const refs = branches.refs ?? [];
      const groups = [
        { id: 'local', title: t('branches.local'), entries: refs.filter((ref) => ref.kind === 'local') },
        { id: 'remote', title: t('branches.remote'), entries: refs.filter((ref) => ref.kind === 'remote') },
        { id: 'tag', title: t('branches.tag'), entries: refs.filter((ref) => ref.kind === 'tag') },
      ].filter((group) => group.entries.length > 0);

      const submitForm = () => {
        if (form === null || form.name.trim() === '') return;
        if (form.kind === 'branch') onCreateBranch(form.name.trim(), form.start.trim());
        else onCreateTag(form.name.trim(), form.start.trim());
        setForm(null);
      };
      const onFormKey = (event) => {
        if (event.key === 'Enter' && busy === null) submitForm();
      };
      const namePlaceholder = form === null || form.kind === 'branch' ? t('branch.namePlaceholder') : t('tag.namePlaceholder');
      const startPlaceholder = form === null || form.kind === 'branch' ? t('branch.startPlaceholder') : t('tag.revPlaceholder');
      const formNode =
        form === null
          ? null
          : h(
              'div',
              { className: 'tw-git-form' },
              h('input', {
                className: 'tw-git-input',
                value: form.name,
                placeholder: namePlaceholder,
                'aria-label': namePlaceholder,
                spellCheck: false,
                onChange: (event) => setForm({ ...form, name: event.target.value }),
                onKeyDown: onFormKey,
              }),
              h('input', {
                className: 'tw-git-input',
                value: form.start,
                placeholder: startPlaceholder,
                'aria-label': startPlaceholder,
                spellCheck: false,
                onChange: (event) => setForm({ ...form, start: event.target.value }),
                onKeyDown: onFormKey,
              }),
              h(
                'div',
                { className: 'tw-git-formrow' },
                h(
                  'button',
                  { type: 'button', className: 'tw-git-ghost', onClick: () => setForm(null) },
                  t('confirm.cancel'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tw-git-primary',
                    disabled: busy !== null || form.name.trim() === '',
                    onClick: submitForm,
                  },
                  t('action.create'),
                ),
              ),
            );

      /** The action cluster one row carries, by ref kind. */
      const rowActions = (group, ref) => {
        const parts = [];
        if (group.id === 'local' && ref.head !== true) {
          parts.push(
            h(
              'button',
              {
                key: 'switch',
                type: 'button',
                className: 'tw-git-rowact',
                disabled: busy !== null,
                onClick: () => onCheckout(ref.name),
              },
              t('action.switch'),
            ),
            h(
              'button',
              {
                key: 'merge',
                type: 'button',
                className: 'tw-git-rowact',
                disabled: busy !== null,
                onClick: () => onMerge(ref.name),
              },
              t('action.merge'),
            ),
            h(
              'button',
              {
                key: 'delete',
                type: 'button',
                className: 'tw-git-rowact',
                disabled: busy !== null,
                onClick: () => onDeleteBranch(ref.name),
              },
              t('action.delete'),
            ),
          );
        }
        if (group.id === 'tag') {
          parts.push(
            h(
              'button',
              {
                key: 'delete',
                type: 'button',
                className: 'tw-git-rowact',
                disabled: busy !== null,
                onClick: () => onDeleteTag(ref.name),
              },
              t('action.delete'),
            ),
          );
        }
        return parts;
      };

      // The Host may still be the older build that returned names only, and its new
      // shape only lands on the next Host restart, so both are accepted here.
      const remoteList = (remotes ?? []).map((remote) =>
        typeof remote === 'string'
          ? { name: remote, url: null }
          : { name: String(remote.name ?? ''), url: remote.url ?? null },
      );
      const headRef = refs.find((ref) => ref.head === true);
      const headUpstream = headRef === undefined || headRef.upstream === null ? null : headRef.upstream;

      /** The muted second line of a row, carrying whatever facts that row has. */
      const metaLine = (parts) => {
        const text = parts.filter((part) => typeof part === 'string' && part !== '').join(' · ');
        return text === ''
          ? null
          : h('div', { className: 'tw-git-bsub' }, h('span', { className: 'tw-git-bmeta' }, text));
      };
      /** ↑ahead ↓behind, from the counts the adapter parses out of git's own summary. */
      const delta = (ref) => {
        if (ref.ahead === 0 && ref.behind === 0) return null;
        const ahead = ref.ahead > 0 ? `↑${String(ref.ahead)}` : '';
        const behind = ref.behind > 0 ? `↓${String(ref.behind)}` : '';
        return h('span', { className: 'tw-git-bdelta' }, `${ahead}${behind}`);
      };
      const branchRow = (group, ref) =>
        h(
          'div',
          { key: `${group.id}:${ref.name}`, className: ref.head === true ? 'tw-git-brow head' : 'tw-git-brow' },
          h('span', { className: ref.head === true ? 'tw-git-bdot on' : 'tw-git-bdot' }),
          h(
            'div',
            { className: 'tw-git-bmain' },
            h(
              'div',
              { className: 'tw-git-bline' },
              h('span', { className: 'tw-git-bname', title: ref.name }, ref.name),
              ref.head === true ? h('span', { className: 'tw-git-ref head' }, t('branches.current')) : null,
              ref.kind === 'remote' && ref.name === headUpstream
                ? h('span', { className: 'tw-git-ref' }, t('branches.upstreamOfHead'))
                : null,
              ref.gone === true ? h('span', { className: 'tw-git-ref gone' }, t('branches.gone')) : null,
            ),
            metaLine([ref.hash, commitWhen(ref.date), ref.subject]),
          ),
          h('span', { className: 'tw-git-spacer' }),
          ref.kind === 'local' ? delta(ref) : null,
          ref.kind !== 'local' || ref.upstream === null || ref.upstream === undefined
            ? null
            : h('span', { className: 'tw-git-bup', title: ref.upstream }, `→ ${ref.upstream}`),
          ...rowActions(group, ref),
        );
      const remoteRow = (remote) =>
        h(
          'div',
          { key: `remote:${remote.name}`, className: 'tw-git-brow' },
          h('span', { className: 'tw-git-bdot' }),
          h(
            'div',
            { className: 'tw-git-bmain' },
            h(
              'div',
              { className: 'tw-git-bline' },
              h('span', { className: 'tw-git-bname', title: remote.name }, remote.name),
              headUpstream !== null && headUpstream.startsWith(`${remote.name}/`)
                ? h('span', { className: 'tw-git-ref' }, t('branches.upstreamOfHead'))
                : null,
            ),
            metaLine([remote.url]),
          ),
        );
      return h(
        'div',
        { className: 'tw-git-body' },
        h(
          'div',
          { className: 'tw-git-toolbar' },
          h('span', { className: 'tw-git-toolbartext' }, t('branches.count', { n: refs.length })),
          h('span', { className: 'tw-git-spacer' }),
          h(
            'button',
            {
              type: 'button',
              className: 'tw-git-ghost',
              disabled: busy !== null,
              onClick: () => setForm({ kind: 'branch', name: '', start: '' }),
            },
            t('op.branchCreate'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'tw-git-ghost',
              disabled: busy !== null,
              onClick: () => setForm({ kind: 'tag', name: '', start: '' }),
            },
            t('op.tagCreate'),
          ),
        ),
        formNode,
        h(
          'div',
          { className: 'tw-git-scroll' },
          branches.phase === 'loading'
            ? h('p', { className: 'tw-git-note' }, t('state.loading'))
            : branches.phase === 'error'
              ? h('p', { className: 'tw-git-note error' }, String(branches.error.message))
              : h(
                  React.Fragment,
                  null,
                  groups.length === 0
                    ? h(
                        'div',
                        { className: 'tw-git-state' },
                        h('p', { className: 'tw-git-statetitle' }, t('branches.empty')),
                      )
                    : groups.map((group) =>
                        h(
                          React.Fragment,
                          { key: group.id },
                          h(
                            'div',
                            { className: 'tw-git-sectionhead' },
                            h('span', { className: 'tw-git-sectiontitle' }, group.title),
                            h('span', { className: 'tw-git-count' }, group.entries.length),
                          ),
                          ...group.entries.map((ref) => branchRow(group, ref)),
                        ),
                      ),
                  remoteList.length === 0
                    ? null
                    : h(
                        React.Fragment,
                        null,
                        h(
                          'div',
                          { className: 'tw-git-sectionhead' },
                          h('span', { className: 'tw-git-sectiontitle' }, t('remotes.title')),
                          h('span', { className: 'tw-git-count' }, remoteList.length),
                        ),
                        ...remoteList.map((remote) => remoteRow(remote)),
                      ),
                ),
        ),
      );
    }

    /** Split one change group into per-directory runs, keeping the status order. */
    function groupByDir(entries) {
      const dirs = new Map();
      for (const entry of entries) {
        if (!dirs.has(entry.dir)) dirs.set(entry.dir, []);
        dirs.get(entry.dir).push(entry);
      }
      return [...dirs.entries()].map(([dir, items]) => ({ dir, entries: items }));
    }

    /** One section of the change list: a title, its batch action, and its files. */
    function ChangeGroup(props) {
      const { group, selectedKey, busy, folded, onToggleDir, onSelect, onStage, onUnstage, onDiscard, t } = props;
      const runs = useMemo(() => groupByDir(group.entries), [group.entries]);
      const paths = group.entries.map((entry) => entry.path);
      // Scoped names on purpose: the toolbar's 全部… actions would otherwise read
      // identically while covering a different set of files.
      const batch =
        group.action === 'stage'
          ? { label: t('action.stage'), run: () => onStage(paths) }
          : group.action === 'unstage'
            ? { label: t('action.unstage'), run: () => onUnstage(paths) }
            : null;
      // Only tracked, unstaged files can be restored; untracked ones are refused.
      const discardPaths = group.entries
        .filter((entry) => entry.side === 'worktree')
        .map((entry) => entry.path);
      const discardBatch =
        discardPaths.length === 0 ? null : { label: t('op.discard'), run: () => onDiscard(discardPaths) };
      // A single root run needs no folder row: there is nothing to distinguish.
      const showDirs = runs.length > 1 || (runs.length === 1 && runs[0].dir !== '');
      const nodes = [
        h(
          'div',
          { key: 'head', className: 'tw-git-sectionhead' },
          h('span', { className: 'tw-git-sectiontitle' }, group.title),
          h('span', { className: 'tw-git-count' }, group.entries.length),
          batch === null
            ? null
            : h(
                'button',
                { key: 'batch', type: 'button', className: 'tw-git-batch', disabled: busy, onClick: batch.run },
                batch.label,
              ),
          discardBatch === null
            ? null
            : h(
                'button',
                {
                  key: 'discard',
                  type: 'button',
                  className: 'tw-git-batch danger',
                  disabled: busy,
                  onClick: discardBatch.run,
                },
                discardBatch.label,
              ),
        ),
      ];
      for (const run of runs) {
        const key = `${group.id}:${run.dir}`;
        const isFolded = showDirs && folded.has(key);
        if (showDirs) {
          nodes.push(
            h(
              'button',
              {
                key: `d${key}`,
                type: 'button',
                className: 'tw-git-dirrow',
                'aria-expanded': isFolded ? 'false' : 'true',
                onClick: () => onToggleDir(key),
              },
              h('span', { className: 'tw-git-caret' }, isFolded ? '▸' : '▾'),
              h('span', { className: 'tw-git-dirname', title: run.dir }, run.dir === '' ? t('dir.root') : run.dir),
              h('span', { className: 'tw-git-dircount' }, run.entries.length),
            ),
          );
        }
        if (isFolded) continue;
        for (const entry of run.entries) {
          const action =
            group.action === 'stage'
              ? { label: t('action.stage'), run: () => onStage([entry.path]) }
              : group.action === 'unstage'
                ? { label: t('action.unstage'), run: () => onUnstage([entry.path]) }
                : null;
          nodes.push(
            h(
              'div',
              {
                key: entry.key,
                className: 'tw-git-file',
                'data-active': selectedKey === entry.key ? 'true' : 'false',
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'tw-git-filemain',
                  title: entry.path,
                  onClick: () => onSelect(entry),
                },
                h('span', { className: markClass(entry.letter) }, entry.letter),
                h('span', { className: 'tw-git-filename' }, entry.name),
              ),
              action === null
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'tw-git-fileact',
                      title: action.label,
                      'aria-label': action.label,
                      disabled: busy,
                      onClick: action.run,
                    },
                    action.label,
                  ),
              // Untracked files are never deleted, so discard is not offered there.
              entry.side === 'worktree' && typeof onDiscard === 'function'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'tw-git-fileact danger',
                      title: t('action.discard'),
                      'aria-label': t('action.discard'),
                      disabled: busy,
                      onClick: () => onDiscard([entry.path]),
                    },
                    t('action.discard'),
                  )
                : null,
            ),
          );
        }
      }
      return h(React.Fragment, null, nodes);
    }

    /**
     * The branch chip under the composer: the Session workspace's current branch,
     * and on click the local branches to switch to. It renders nothing unless the
     * workspace is a git repository, so it stays out of the way everywhere else,
     * and it is the only surface that shows git state without opening the panel.
     */
    function GitBranchDock(props) {
      const { sessionId, useSessions, t } = props;
      const cwd = useSessions((sessions) => {
        const row = sessions.byId[sessionId];
        return row === undefined ? undefined : row.cwd;
      });
      const [status, setStatus] = useState({ phase: 'idle', data: null });
      /** `head` is the light route; a Host older than this Client has only `status`. */
      const [source, setSource] = useState('head');
      /** `null` is closed; otherwise the list, the confirm step and its outcome. */
      const [menu, setMenu] = useState(null);

      const refresh = useCallback(async () => {
        if (typeof cwd !== 'string' || cwd === '') {
          setStatus({ phase: 'idle', data: null });
          return;
        }
        try {
          const payload = source === 'head' ? await api.head(cwd) : await api.status(cwd);
          setStatus({ phase: 'ready', data: (source === 'head' ? payload.head : payload.status) ?? null });
        } catch {
          if (source === 'head') setSource('status');
          else setStatus({ phase: 'error', data: null });
        }
      }, [cwd, source]);

      useEffect(() => {
        void refresh();
        const timer = setInterval(() => {
          void refresh();
        }, DOCK_REFRESH_MS);
        return () => {
          clearInterval(timer);
        };
      }, [refresh]);

      // A write anywhere else in this repository renames or re-points the branch, so
      // re-read immediately instead of waiting for the poll above.
      useEffect(() => {
        repoListeners.add(refresh);
        return () => {
          repoListeners.delete(refresh);
        };
      }, [refresh]);

      const openMenu = useCallback(async () => {
        if (typeof cwd !== 'string' || cwd === '') return;
        setMenu({ phase: 'loading', refs: [], error: null, pending: null, busy: false });
        try {
          const data = await api.branches(cwd);
          setMenu({
            phase: 'ready',
            refs: (data.refs ?? []).filter((ref) => ref.kind === 'local'),
            error: null,
            pending: null,
            busy: false,
          });
        } catch (error) {
          setMenu({
            phase: 'error',
            refs: [],
            error: String((error && error.message) || error),
            pending: null,
            busy: false,
          });
        }
      }, [cwd]);

      const confirmSwitch = useCallback(async () => {
        if (menu === null || menu.pending === null || typeof cwd !== 'string') return;
        const branch = menu.pending;
        setMenu({ ...menu, busy: true, error: null });
        try {
          await api.checkout(cwd, branch, false);
          setMenu(null);
          await refresh();
          notifyRepoChanged();
        } catch (error) {
          setMenu({ ...menu, busy: false, error: String((error && error.message) || error) });
        }
      }, [cwd, menu, refresh]);

      const repo =
        status.phase === 'ready' && status.data !== null && status.data.repo === true ? status.data : null;
      if (repo === null) return null;

      const label = repo.branch === null ? t('dock.detached') : repo.branch;
      const ahead = repo.ahead > 0 ? ` ↑${String(repo.ahead)}` : '';
      const behind = repo.behind > 0 ? ` ↓${String(repo.behind)}` : '';
      const open = menu !== null;
      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, DOCK_CSS),
        h(
          'div',
          { className: 'tw-git-dock' },
        h(
          'button',
          {
            type: 'button',
            className: 'tw-git-dockchip',
            title: t('dock.branch'),
            'aria-label': t('dock.branch'),
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => {
              if (open) setMenu(null);
              else void openMenu();
            },
          },
          h(GitMark, { size: 14 }),
          h('span', { className: 'tw-git-dockname' }, label),
          ahead === '' && behind === '' ? null : h('span', { className: 'tw-git-dockmeta' }, `${ahead}${behind}`),
        ),
        menu === null
          ? null
          : h(
              'div',
              { className: 'tw-git-dockmenu' },
              menu.phase === 'loading' ? h('div', { className: 'tw-git-docknote' }, t('dock.loading')) : null,
              menu.phase === 'error' ? h('div', { className: 'tw-git-dockerror' }, menu.error) : null,
              menu.phase === 'ready' && menu.pending === null
                ? menu.refs.length === 0
                  ? h('div', { className: 'tw-git-docknote' }, t('dock.empty'))
                  : menu.refs.map((ref) =>
                      h(
                        'button',
                        {
                          key: `dock:${ref.name}`,
                          type: 'button',
                          className: ref.head === true ? 'tw-git-dockrow current' : 'tw-git-dockrow',
                          disabled: ref.head === true,
                          onClick: () => {
                            setMenu({ ...menu, pending: ref.name, error: null });
                          },
                        },
                        h('span', { className: 'tw-git-dockname' }, ref.name),
                        ref.head === true ? h('span', { className: 'tw-git-dockmeta' }, '✓') : null,
                      ),
                    )
                : null,
              menu.pending === null
                ? null
                : h(
                    'div',
                    { className: 'tw-git-dockconfirm' },
                    h('div', { className: 'tw-git-docktitle' }, t('dock.confirmTitle', { branch: menu.pending })),
                    h('div', { className: 'tw-git-docknote' }, t('dock.confirmDetail')),
                    menu.error === null ? null : h('div', { className: 'tw-git-dockerror' }, menu.error),
                    h(
                      'div',
                      { className: 'tw-git-dockactions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'tw-git-dockbtn',
                          onClick: () => {
                            setMenu({ ...menu, pending: null, error: null });
                          },
                        },
                        t('dock.cancel'),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'tw-git-dockbtn primary',
                          disabled: menu.busy === true,
                          onClick: () => {
                            void confirmSwitch();
                          },
                        },
                        t('dock.confirm'),
                      ),
                    ),
                  ),
            ),
        ),
      );
    }

    /** The tab body: repository state, change list, diff, history and branches. */
    function GitTabBody(props) {
      const { sessionId, useSessions, useTabInfo, t } = props;
      const cwd = useSessions((sessions) => {
        const row = sessions.byId[sessionId];
        return row === undefined ? undefined : row.cwd;
      });
      const tab = useTabInfo().tab;
      const visible = tab.visible !== false;

      const [state, setState] = useState({ phase: 'loading' });
      const [view, setView] = useState('changes');
      const [selection, setSelection] = useState(null);
      const [diff, setDiff] = useState({ phase: 'idle' });
      const [history, setHistory] = useState({ phase: 'loading', commits: [] });
      const [branches, setBranches] = useState({ phase: 'loading', refs: [] });
      const [detail, setDetail] = useState({ phase: 'idle', commit: null });
      const [allRefs, setAllRefs] = useState(false);
      const [message, setMessage] = useState('');
      const [busy, setBusy] = useState(null);
      const [notice, setNotice] = useState(null);
      /** Directory rows the user folded shut, keyed `group:dir`. */
      const [folded, setFolded] = useState(() => new Set());
      /** The operation waiting for confirmation, or null when none is pending. */
      const [confirm, setConfirm] = useState(null);
      /** The configured remotes: the default target when publishing a branch. */
      const [remotes, setRemotes] = useState([]);

      const root = state.status !== undefined && state.status.repo === true ? state.status.root : cwd;
      /** Primitive readiness flag: polling publishes a new status object every tick. */
      const ready = state.phase === 'ready' && state.status !== undefined && state.status.repo === true;

      /** Pull the repository headline, publishing it for the tab chip too. */
      const refresh = useCallback(
        async (options) => {
          if (cwd === undefined || cwd === null || cwd === '') {
            setState({ phase: 'empty' });
            return;
          }
          if (options === undefined || options.announce !== false) setState((old) => ({ ...old, phase: old.phase === 'ready' ? 'ready' : 'loading' }));
          try {
            const payload = await api.status(cwd);
            setState({ phase: 'ready', status: payload.status, capabilities: payload.capabilities });
            headlines.set(sessionId, {
              root: payload.status.root ?? cwd,
              branch: payload.status.repo === true ? payload.status.branch : null,
              total: payload.status.repo === true ? payload.status.changes.total : 0,
            });
          } catch (error) {
            setState({ phase: 'error', error });
          }
        },
        [cwd, sessionId],
      );

      useEffect(() => {
        refresh();
      }, [refresh]);

      useEffect(() => {
        if (!visible) return undefined;
        if (cwd === undefined || cwd === null || cwd === '') return undefined;
        const timer = setInterval(() => {
          refresh({ announce: false });
        }, REFRESH_MS);
        return () => clearInterval(timer);
      }, [cwd, refresh, visible]);

      useEffect(() => {
        if (notice === null) return undefined;
        // Feedback should not pile up: a notice clears itself once it is read.
        const timer = setTimeout(() => setNotice(null), notice.kind === 'error' ? 8000 : 4000);
        return () => clearTimeout(timer);
      }, [notice]);

      /** Load the diff for the selected entry. */
      useEffect(() => {
        if (selection === null || root === undefined || root === null) return undefined;
        let live = true;
        setDiff({ phase: 'loading' });
        const load = async () => {
          try {
            return (await api.diff(root, selection.side, selection.path)).diff;
          } catch (error) {
            // The Host only learns the `conflict` side on its next restart, and until
            // then the same file content comes back through the untracked view.
            if (selection.side !== 'conflict') throw error;
            return (await api.diff(root, 'untracked', selection.path)).diff;
          }
        };
        load()
          .then((payload) => {
            if (live) setDiff({ phase: 'ready', diff: payload });
          })
          .catch((error) => {
            if (live) setDiff({ phase: 'error', error });
          });
        return () => {
          live = false;
        };
      }, [root, selection]);

      /** Load history when its tab is shown or the ref scope changes. */
      const loadHistory = useCallback(async () => {
        if (root === undefined || root === null) return;
        setHistory((old) => ({ ...old, phase: 'loading' }));
        try {
          const payload = await api.log(root, { all: allRefs });
          setHistory({ phase: 'ready', commits: payload.commits });
        } catch (error) {
          setHistory({ phase: 'error', commits: [], error });
        }
      }, [root, allRefs]);

      useEffect(() => {
        if (view !== 'history' || !ready) return undefined;
        loadHistory();
        return undefined;
      }, [view, ready, loadHistory]);

      /** Load the ref list: on tab entry, and again after any ref-changing write. */
      const loadBranches = useCallback(async () => {
        if (root === undefined || root === null) return;
        setBranches((old) => ({ ...old, phase: 'loading' }));
        try {
          const payload = await api.branches(root);
          setBranches({ phase: 'ready', refs: payload.refs });
        } catch (error) {
          setBranches({ phase: 'error', refs: [], error });
        }
      }, [root]);

      useEffect(() => {
        if (view !== 'branches' || !ready) return undefined;
        loadBranches();
        return undefined;
      }, [view, ready, loadBranches]);

      /** Load the configured remotes once the repository is known. */
      useEffect(() => {
        if (!ready || root === undefined || root === null) return undefined;
        let live = true;
        api
          .remotes(root)
          .then((payload) => {
            if (live) setRemotes(payload.remotes ?? []);
          })
          .catch(() => {
            if (live) setRemotes([]);
          });
        return () => {
          live = false;
        };
      }, [ready, root]);

      /** Open one commit's detail. */
      const openCommit = useCallback(
        async (hash) => {
          setDetail({ phase: 'loading', commit: null });
          try {
            const payload = await api.commitDetail(root, hash);
            setDetail({ phase: 'ready', commit: payload.commit });
          } catch (error) {
            setDetail({ phase: 'error', commit: null, error });
          }
        },
        [root],
      );

      /** Run one write operation, then reload the state it invalidated. */
      const write = useCallback(
        async (label, operation, done) => {
          setBusy(label);
          setNotice(null);
          try {
            await operation();
            await refresh({ announce: false });
            if (view === 'branches') await loadBranches();
            if (view === 'history') await loadHistory();
            notifyRepoChanged();
            if (done !== undefined) setNotice({ kind: 'ok', text: done });
          } catch (error) {
            setNotice({ kind: 'error', text: String((error && error.message) || error) });
          } finally {
            setBusy(null);
          }
        },
        [loadBranches, loadHistory, refresh, view],
      );

      // A branch switch made from the composer chip changes this repository too, and
      // that chip is a separate component tree, so it announces itself the same way.
      useEffect(() => {
        const listener = () => {
          void refresh({ announce: false });
        };
        repoListeners.add(listener);
        return () => {
          repoListeners.delete(listener);
        };
      }, [refresh]);

      /** Follow a path that changes section, so an open diff stays truthful. */
      const follow = useCallback((paths, side, prefix) => {        setSelection((current) =>
          current !== null && paths.includes(current.path)
            ? { ...current, side, key: `${prefix}:${current.path}` }
            : current,
        );
      }, []);

      const stagePaths = useCallback(
        (paths) => {
          if (paths.length === 0) return Promise.resolve();
          return write(
            'stage',
            async () => {
              await api.stage(root, paths);
              follow(paths, 'index', 'staged');
            },
            t('notice.staged', { n: paths.length }),
          );
        },
        [follow, root, t, write],
      );
      const unstagePaths = useCallback(
        (paths) => {
          if (paths.length === 0) return Promise.resolve();
          return write(
            'unstage',
            async () => {
              await api.unstage(root, paths);
              follow(paths, 'worktree', 'unstaged');
            },
            t('notice.unstaged', { n: paths.length }),
          );
        },
        [follow, root, t, write],
      );

      /** Fold or unfold one directory row of the change list. */
      const toggleDir = useCallback((key) => {
        setFolded((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      }, []);
      const submitCommit = useCallback(async () => {
        setBusy('commit');
        setNotice(null);
        try {
          const payload = await api.commit(root, message);
          setMessage('');
          setSelection(null);
          setNotice({ kind: 'ok', text: t('commit.done', { hash: payload.commit.hash }) });
          await refresh({ announce: false });
          if (view === 'history') await loadHistory();
        } catch (error) {
          setNotice({ kind: 'error', text: String((error && error.message) || error) });
        } finally {
          setBusy(null);
        }
      }, [loadHistory, message, refresh, root, t, view]);

      /** Queue an operation behind the confirmation dialog. */
      const ask = useCallback((request) => setConfirm(request), []);

      /** Run the queued operation, then close the dialog. */
      const runConfirmed = useCallback(async () => {
        const request = confirm;
        if (request === null) return;
        setConfirm(null);
        await write(request.kind ?? 'op', request.run, request.done);
      }, [confirm, write]);

      const switchBranch = useCallback(
        (name) =>
          ask({
            title: t('op.checkout'),
            detail: t('confirm.checkoutDetail'),
            label: t('action.switch'),
            run: () => api.checkout(root, name, false),
            done: t('notice.switched', { name }),
          }),
        [ask, root, t],
      );

      const checkoutCommit = useCallback(
        (hash) =>
          ask({
            title: t('op.checkoutCommit'),
            detail: t('confirm.checkoutCommitDetail'),
            label: t('action.checkout'),
            run: () => api.checkout(root, hash, true),
            done: t('notice.switched', { name: hash.slice(0, 7) }),
          }),
        [ask, root, t],
      );

      // Creating a branch is not destructive, so it runs without a prompt.
      const createBranch = useCallback(
        (name, start) =>
          write(
            'branch',
            () => api.createBranch(root, name, start === '' ? null : start),
            t('notice.branchCreated', { name }),
          ),
        [root, t, write],
      );

      const deleteBranch = useCallback(
        (name) =>
          ask({
            title: t('op.branchDelete'),
            detail: t('confirm.deleteBranchDetail'),
            label: t('action.delete'),
            danger: true,
            run: () => api.deleteBranch(root, name),
            done: t('notice.branchDeleted', { name }),
          }),
        [ask, root, t],
      );

      const createTag = useCallback(
        (name, rev) =>
          write(
            'tag',
            () => api.createTag(root, name, rev === '' ? null : rev),
            t('notice.tagCreated', { name }),
          ),
        [root, t, write],
      );

      const deleteTag = useCallback(
        (name) =>
          ask({
            title: t('op.tagDelete'),
            detail: t('confirm.deleteTagDetail'),
            label: t('action.delete'),
            danger: true,
            run: () => api.deleteTag(root, name),
            done: t('notice.tagDeleted', { name }),
          }),
        [ask, root, t],
      );

      const discardPaths = useCallback(
        (paths) => {
          if (paths.length === 0) return;
          ask({
            title: t('op.discard'),
            detail: t('confirm.discardDetail', { n: paths.length }),
            label: t('action.discard'),
            danger: true,
            run: () => api.discard(root, paths),
            done: t('notice.discarded', { n: paths.length }),
          });
        },
        [ask, root, t],
      );

      /** Fetch only moves remote-tracking refs, so only pull and push ask first. */
      const syncRepo = useCallback(
        (action) => {
          if (action === 'fetch') {
            write('fetch', () => api.sync(root, 'fetch', {}), t('notice.fetched'));
            return;
          }
          ask({
            title: action === 'push' ? t('op.push') : t('op.pull'),
            detail: action === 'push' ? t('confirm.pushDetail') : t('confirm.pullDetail'),
            label: action === 'push' ? t('op.push') : t('op.pull'),
            run: () => {
              const status = state.status ?? {};
              const hasUpstream = status.upstream !== null && status.upstream !== undefined;
              const extra =
                action === 'push' && !hasUpstream
                  ? {
                      // The Host may still be the older build that returned names only.
                      remote: remotes.length > 0 ? (remotes[0].name ?? remotes[0]) : 'origin',
                      branch: status.branch ?? undefined,
                      setUpstream: true,
                    }
                  : {};
              return api.sync(root, action, extra);
            },
            done: action === 'push' ? t('notice.pushed') : t('notice.pulled'),
          });
        },
        [ask, remotes, root, state.status, t, write],
      );

      const revertCommit = useCallback(
        (rev) =>
          ask({
            title: t('op.revert'),
            detail: t('confirm.revertDetail'),
            label: t('action.revert'),
            run: () => api.undo(root, 'revert', rev),
            done: t('notice.reverted', { rev: rev.slice(0, 7) }),
          }),
        [ask, root, t],
      );

      const cherryPickCommit = useCallback(
        (rev) =>
          ask({
            title: t('op.cherryPick'),
            detail: t('confirm.cherryPickDetail'),
            label: t('action.cherryPick'),
            run: () => api.undo(root, 'cherry-pick', rev),
            done: t('notice.cherryPicked', { rev: rev.slice(0, 7) }),
          }),
        [ask, root, t],
      );

      const resetTo = useCallback(
        (rev, mode) =>
          ask({
            title: mode === 'soft' ? t('op.resetSoft') : t('op.resetMixed'),
            detail: mode === 'soft' ? t('confirm.resetSoftDetail') : t('confirm.resetMixedDetail'),
            label: mode === 'soft' ? t('op.resetSoft') : t('op.resetMixed'),
            danger: true,
            run: () => api.undo(root, 'reset', rev, mode),
            done: t('notice.reset', { rev: rev.slice(0, 7) }),
          }),
        [ask, root, t],
      );

      const mergeRef = useCallback(
        (name) =>
          ask({
            title: t('op.merge'),
            detail: t('confirm.mergeDetail', { name }),
            label: t('action.merge'),
            run: () => api.undo(root, 'merge', name),
            done: t('notice.merged', { name }),
          }),
        [ask, root, t],
      );

      /** Conflicts leave an operation open; abandoning it needs a confirmation. */
      const abortOperation = useCallback(() => {
        const operation = state.phase === 'ready' && state.status.repo === true ? state.status.operation : null;
        if (operation === null || operation === undefined) return;
        ask({
          title: t('operation.abort'),
          detail: t(ABORT_DETAIL[operation] ?? 'confirm.abortMerge'),
          label: t('operation.abort'),
          danger: true,
          run: () => api.abort(root, operation),
          done: t('operation.aborted'),
        });
      }, [ask, root, state, t]);

      const groups = useMemo(() => {
        if (state.phase !== 'ready' || state.status.repo !== true) return [];
        const status = state.status;
        const build = (id, title, entries, side, action) =>
          entries.length === 0
            ? null
            : {
                id,
                title,
                action,
                entries: entries.map((entry) => ({
                  key: `${id}:${entry.path}`,
                  path: entry.path,
                  side,
                  letter:
                    side === 'index'
                      ? entry.x || 'M'
                      : side === 'worktree'
                        ? entry.y || 'M'
                        : side === 'conflict'
                          ? entry.x || 'U'
                          : '?',
                  ...splitPath(entry.path),
                })),
              };
        return [
          // A conflicted path is diffed from its own content, not from `git diff`,
          // which answers with the combined format the parser cannot read.
          build('conflicted', t('group.conflicted'), status.changes.conflicted, 'conflict', null),
          build('staged', t('group.staged'), status.changes.staged, 'index', 'unstage'),
          build('unstaged', t('group.unstaged'), status.changes.unstaged, 'worktree', 'stage'),
          build('untracked', t('group.untracked'), status.changes.untracked, 'untracked', 'stage'),
        ].filter((group) => group !== null);
      }, [state, t]);

      const stagedCount = state.phase === 'ready' && state.status.repo === true ? state.status.changes.staged.length : 0;
      const capabilities = state.capabilities ?? { allowWrite: false, identity: null };
      const clean = state.phase === 'ready' && state.status.repo === true && state.status.changes.total === 0;

      /** The panel's own stylesheet, unmounted with the body. */
      const style = h('style', { key: 'style' }, CSS);

      if (cwd === undefined || cwd === null || cwd === '') {
        return h('div', { className: 'tw-git-root' }, style, h(PanelState, { title: t('state.noWorkspace'), t }));
      }
      if (state.phase === 'loading') {
        return h('div', { className: 'tw-git-root' }, style, h(PanelState, { title: t('state.loading'), t }));
      }
      if (state.phase === 'error') {
        return h(
          'div',
          { className: 'tw-git-root' },
          style,
          h(PanelState, {
            title: t('common.error'),
            detail: String(state.error.message),
            retry: () => refresh(),
            t,
          }),
        );
      }
      if (state.status === undefined || state.status.repo !== true) {
        return h(
          'div',
          { className: 'tw-git-root' },
          style,
          h(PanelState, { title: t('state.notRepoTitle'), detail: cwd, t }),
        );
      }

      const status = state.status;
      const header = h(PanelHeader, {
        status,
        busy: busy !== null,
        onRefresh: () => {
          refresh({ announce: false });
          if (view === 'history') loadHistory();
          if (view === 'branches') loadBranches();
        },
        t,
      });

      const tabs = h(
        'div',
        { key: 'tabs', className: 'tw-git-tabs', role: 'tablist' },
        ...[
          // Only the change count is actionable; list lengths for history and
          // branches are noise, so those tabs carry no badge.
          { id: 'changes', label: t('tab.changes'), count: status.changes.total },
          { id: 'history', label: t('tab.history') },
          { id: 'branches', label: t('tab.branches') },
        ].map((entry) =>
          h(
            'button',
            {
              key: entry.id,
              type: 'button',
              role: 'tab',
              className: 'tw-git-tab',
              'aria-selected': view === entry.id ? 'true' : 'false',
              onClick: () => setView(entry.id),
            },
            h('span', { className: 'tw-git-tablabel' }, entry.label),
            entry.count > 0 ? h('span', { className: 'tw-git-tabcount' }, entry.count) : null,
          ),
        ),
      );

      const noticeNode =
        notice === null
          ? null
          : h(
              'div',
              {
                key: 'notice',
                className: notice.kind === 'error' ? 'tw-git-banner error' : 'tw-git-banner',
              },
              notice.text,
            );

      const stageablePaths = [];
      const discardablePaths = [];
      // How many groups each global action would span: one group means the group's own
      // button already covers it, so the toolbar must stay out of the way.
      let stageGroups = 0;
      let discardGroups = 0;
      for (const group of groups) {
        let stages = false;
        let discards = false;
        for (const entry of group.entries) {
          if (group.action === 'stage') {
            stageablePaths.push(entry.path);
            stages = true;
          }
          // Only tracked, unstaged files can be restored; untracked ones stay.
          if (entry.side === 'worktree') {
            discardablePaths.push(entry.path);
            discards = true;
          }
        }
        if (stages) stageGroups += 1;
        if (discards) discardGroups += 1;
      }

      let body = null;
      if (view === 'changes') {
        body = h(
          'div',
          { key: 'body', className: 'tw-git-body' },
          h(ChangesView, {
            groups,
            selection,
            diff,
            busy,
            folded,
            total: status.changes.total,
            clean,
            canStageAll: stageablePaths.length > 0,
            canDiscardAll: discardablePaths.length > 0,
            stageAllGroups: stageGroups,
            discardAllGroups: discardGroups,
            onStageAll: () => stagePaths(stageablePaths),
            onDiscardAll: () => discardPaths(discardablePaths),
            onToggleDir: toggleDir,
            onSelect: (entry) => setSelection(entry),
            onStage: stagePaths,
            onUnstage: unstagePaths,
            onDiscard: discardPaths,
            onClose: () => setSelection(null),
            t,
          }),
          h(CommitBox, {
            message,
            busy,
            stagedCount,
            capabilities,
            onChange: setMessage,
            onSubmit: submitCommit,
            t,
          }),
        );
      } else if (view === 'history') {
        body = h(HistoryView, {
          history,
          detail,
          allRefs,
          busy,
          onToggleAll: () => setAllRefs((value) => !value),
          onOpen: openCommit,
          onBack: () => setDetail({ phase: 'idle', commit: null }),
          onSync: syncRepo,
          onRevert: revertCommit,
          onCherryPick: cherryPickCommit,
          onCheckoutCommit: checkoutCommit,
          onReset: resetTo,
          t,
        });
      } else {
        body = h(BranchesView, {
          branches,
          remotes,
          busy,
          onCheckout: switchBranch,
          onMerge: mergeRef,
          onDeleteBranch: deleteBranch,
          onCreateBranch: createBranch,
          onCreateTag: createTag,
          onDeleteTag: deleteTag,
          t,
        });
      }

      // A conflict is repository-wide state, so its banner sits above the tabs rather
      // than inside the changes view, and says which operation is still open. An older
      // Host reports no operation, and then the banner still explains the state but
      // cannot offer to abandon it.
      const openOperation =
        state.phase === 'ready' && state.status.repo === true ? state.status.operation : null;
      const conflictedCount =
        state.phase === 'ready' && state.status.repo === true ? state.status.changes.conflicted.length : 0;
      const operationNode =
        conflictedCount === 0
          ? null
          : h(
              'div',
              { className: 'tw-git-operation' },
              h(
                'span',
                { className: 'tw-git-operationtitle' },
                openOperation === null || openOperation === undefined
                  ? t('operation.unknown')
                  : t(OPERATION_LABEL[openOperation] ?? 'operation.merge'),
              ),
              h('span', { className: 'tw-git-operationhint' }, t('operation.hint')),
              openOperation === null || openOperation === undefined
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'tw-git-ghost danger',
                      disabled: busy !== null,
                      onClick: abortOperation,
                    },
                    t('operation.abort'),
                  ),
            );

      const dialog =
        confirm === null
          ? null
          : h(ConfirmDialog, {
              request: confirm,
              busy,
              onCancel: () => setConfirm(null),
              onConfirm: runConfirmed,
              t,
            });

      return h('div', { className: 'tw-git-root' }, style, header, operationNode, tabs, noticeNode, body, dialog);
    }

    /** Panel styles: theme tokens only, prefixed classes, no global selectors. */
    const CSS = [
      '.tw-git-operation{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}',
      '.tw-git-operationtitle{flex:none;color:var(--dsw-alias-state-warn-primary);font-size:12px;font-weight:600}',
      '.tw-git-operationhint{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-root{position:relative;height:100%;min-height:0;flex:auto;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}',
      '.tw-git-spacer{flex:1 1 auto;min-width:0}',
      '.tw-git-head{flex:none;display:flex;flex-direction:column;gap:2px;padding:8px 6px 7px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.tw-git-headrow{display:flex;align-items:center;gap:6px;min-width:0}',
      '.tw-git-repo{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:13px}',
      '.tw-git-branch{flex:0 1 auto;min-width:0;display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-branchtext{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-metarow{display:flex;align-items:center;gap:8px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-tool{width:26px;height:26px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:.5px solid var(--dsw-alias-border-l1);background:0 0;border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit}',
      '.tw-git-tool:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}',
      '.tw-git-tool:disabled{opacity:.45;cursor:default}',
      '.tw-git-tool svg{width:15px;height:15px}',
      '.tw-git-spin{display:inline-block;line-height:1}',
      '.tw-git-spin[data-spin="true"]{animation:tw-git-spin .9s linear infinite}',
      '@keyframes tw-git-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.tw-git-spin[data-spin="true"]{animation:none}}',
      '.tw-git-tabs{flex:none;display:flex;gap:2px;padding:3px 6px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.tw-git-tab{flex:1 1 auto;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:4px;border:.5px solid var(--dsw-alias-border-l1);background:0 0;border-radius:999px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
      '.tw-git-tab:hover{border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}',
      '.tw-git-tab[aria-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500}',
      '.tw-git-tablabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-tabcount{flex:none;font-size:10px;opacity:.75}',
      '.tw-git-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.tw-git-scroll{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-gutter:stable}',
      '.tw-git-scroll.split{flex:0 0 auto;max-height:42%}',
      '.tw-git-toolbar{flex:none;display:flex;align-items:center;gap:6px;padding:6px 8px 4px 12px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-toolbartext{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-ghost{flex:none;padding:1px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;white-space:nowrap;cursor:pointer}',
      '.tw-git-ghost:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary)}',
      '.tw-git-ghost:disabled{opacity:.45;cursor:default}',
      '.tw-git-ghost[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.tw-git-sectionhead{display:flex;align-items:center;gap:6px;margin-top:6px;padding:8px 12px 4px;border-top:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-sectiontitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-count{flex:none;min-width:16px;box-sizing:border-box;text-align:center;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1.6}',
      '.tw-git-brow{display:flex;align-items:center;gap:7px;width:100%;min-width:0;box-sizing:border-box;padding:5px 10px 5px 12px;border-radius:6px}',
      '.tw-git-brow:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.tw-git-brow.head{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}',
      '.tw-git-bdot{flex:none;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-border-l2)}',
      '.tw-git-bdot.on{background:var(--dsw-alias-brand-primary)}',
      '.tw-git-bmain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.tw-git-bline{display:flex;align-items:center;gap:5px;min-width:0}',
      '.tw-git-bname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:12px}',
      '.tw-git-brow.head .tw-git-bname{color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.tw-git-bsub{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-bmeta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}',
      '.tw-git-bdelta{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}',
      '.tw-git-bup{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-ref.gone{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base)}',
      '.tw-git-batch{margin-left:auto;flex:none;padding:0 7px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}',
      '.tw-git-batch:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary)}',
      '.tw-git-batch:disabled{opacity:.45;cursor:default}',
      '.tw-git-dirrow{display:flex;align-items:center;gap:4px;width:100%;min-width:0;box-sizing:border-box;padding:3px 8px 3px 13px;border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;text-align:left;cursor:pointer}',
      '.tw-git-dirrow:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}',
      '.tw-git-caret{flex:none;width:9px;text-align:center;font-size:9px;line-height:1}',
      '.tw-git-dirname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-dircount{flex:none;color:var(--dsw-alias-state-idle-primary);font-size:10px}',
      '.tw-git-file{display:flex;align-items:center;gap:4px;min-width:0;padding-right:6px}',
      '.tw-git-file:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.tw-git-file[data-active="true"]{background:var(--dsw-alias-bg-layer-2)}',
      '.tw-git-filemain{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;padding:4px 0 4px 12px;border:0;background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.tw-git-filename{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-row .tw-git-filename{flex:1 1 auto}',
      '.tw-git-mark{flex:none;width:12px;text-align:center;font-weight:600;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.tw-git-mark.m{color:var(--dsw-alias-state-warn-primary)}',
      '.tw-git-mark.a{color:var(--dsw-alias-state-success-primary)}',
      '.tw-git-mark.d,.tw-git-mark.u{color:var(--dsw-alias-state-error-primary)}',
      '.tw-git-fileact{flex:none;opacity:.85;padding:0 6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;white-space:nowrap;cursor:pointer}',
      '.tw-git-file:hover .tw-git-fileact{opacity:1}',
      '.tw-git-fileact:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.tw-git-fileact:focus-visible{opacity:1}',
      '.tw-git-fileact:disabled{opacity:.35;cursor:default}',
      '.tw-git-hint{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-row .tw-git-hint{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-row{display:flex;align-items:center;gap:6px;width:100%;min-width:0;box-sizing:border-box;padding:4px 10px 4px 12px;color:inherit;font:inherit;text-align:left}',
      '.tw-git-diff{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.tw-git-diffhead{flex:none;display:flex;align-items:center;gap:6px;height:32px;padding:0 6px 0 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-code{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-gutter:stable;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.6}',
      '.tw-git-line{display:grid;grid-template-columns:44px 44px 14px minmax(0,auto);width:max-content;min-width:100%;box-sizing:border-box}',
      '.tw-git-lno{padding-right:8px;text-align:right;color:var(--dsw-alias-label-secondary);opacity:.6;font-size:10px;user-select:none;-webkit-user-select:none}',
      '.tw-git-sign{text-align:center;color:var(--dsw-alias-label-secondary);user-select:none;-webkit-user-select:none}',
      '.tw-git-text{padding-right:16px;white-space:pre}',
      '.tw-git-line.add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}',
      '.tw-git-line.del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}',
      '.tw-git-line.add .tw-git-sign{color:var(--dsw-alias-state-success-primary)}',
      '.tw-git-line.del .tw-git-sign{color:var(--dsw-alias-state-error-primary)}',
      '.tw-git-line.meta{color:var(--dsw-alias-label-secondary);opacity:.8}',
      '.tw-git-word{border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 26%,transparent);color:inherit}',
      '.tw-git-line.add .tw-git-word{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent)}',
      '.tw-git-line.del .tw-git-word{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,transparent)}',
      '.tw-git-filehead{display:flex;align-items:center;gap:8px;padding:5px 10px 4px 12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-filepath{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.tw-git-filestat{flex:none}',
      '.tw-git-hunkrow{display:flex;align-items:center;gap:6px;padding:2px 10px 2px 4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-hunkbtn{flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:.5px solid var(--dsw-alias-border-l1);border-radius:4px;background:0 0;color:inherit;font-size:9px;line-height:1;cursor:pointer}',
      '.tw-git-hunkbtn:hover{border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.tw-git-hunktext{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-note{margin:0;padding:10px 12px;color:var(--dsw-alias-label-secondary);font-size:12px;word-break:break-word}',
      '.tw-git-note.error{color:var(--dsw-alias-state-error-primary)}',
      '.tw-git-state{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:24px 18px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.tw-git-state svg{opacity:.45}',
      '.tw-git-statetitle{margin:0;color:var(--dsw-alias-label-primary);font-size:13px}',
      '.tw-git-statedetail{margin:0;max-width:100%;font-size:11px;opacity:.8;word-break:break-all}',
      '.tw-git-banner{margin:6px 8px 0;padding:6px 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-banner.error{color:var(--dsw-alias-state-error-primary)}',
      '.tw-git-metablock{padding:8px 12px 2px}',
      '.tw-git-message{margin-top:4px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary);font-size:12px}',
      '.tw-git-commit{flex:none;border-top:.5px solid var(--dsw-alias-border-l1);padding:8px 10px 10px}',
      '.tw-git-commit textarea{width:100%;box-sizing:border-box;min-height:68px;max-height:200px;resize:vertical;padding:7px 9px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5;outline:none}',
      '.tw-git-commit textarea:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.tw-git-commit textarea:disabled{opacity:.6}',
      '.tw-git-commitrow{display:flex;align-items:center;gap:8px;margin-top:7px;min-width:0}',
      '.tw-git-commitrow .tw-git-hint{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-kbd{flex:none;padding:1px 5px;border:.5px solid var(--dsw-alias-border-l1);border-radius:4px;color:var(--dsw-alias-label-secondary);font-size:10px;white-space:nowrap}',
      '.tw-git-primary{flex:none;padding:5px 12px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;font-weight:500;white-space:nowrap;cursor:pointer}',
      '.tw-git-primary:hover:not(:disabled){opacity:.9}',
      '.tw-git-primary:disabled{opacity:.5;cursor:default}',
      '.tw-git-commit-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;box-sizing:border-box;height:42px;padding:0 10px 0 4px;border:0;background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.tw-git-commit-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.tw-git-commitmain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px}',
      '.tw-git-commitline{display:flex;align-items:center;gap:4px;min-width:0}',
      '.tw-git-commitsub{display:flex;align-items:center;gap:8px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.tw-git-commitmeta{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-graph{flex:none;display:block}',
      '.tw-git-hash{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.tw-git-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-ref{flex:none;max-width:90px;padding:0 5px;border-radius:999px;font-size:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-git-ref.head{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
      '.tw-git-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}',
      '.tw-git-rowact{flex:none;opacity:.85;padding:0 6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;white-space:nowrap;cursor:pointer}',
      '.tw-git-rowact:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);opacity:1}',
      '.tw-git-rowact:disabled{opacity:.35;cursor:default}',
      '.tw-git-form{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 10px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.tw-git-input{width:100%;box-sizing:border-box;padding:5px 8px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}',
      '.tw-git-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.tw-git-input::placeholder{color:var(--dsw-alias-label-secondary)}',
      '.tw-git-formrow{display:flex;align-items:center;justify-content:flex-end;gap:8px}',
      '.tw-git-ghost.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,transparent)}',
      '.tw-git-batch.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}',
      '.tw-git-ghost.danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.tw-git-fileact.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}',
      '.tw-git-fileact.danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.tw-git-danger{flex:none;padding:5px 12px;border:0;border-radius:6px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;font-weight:500;white-space:nowrap;cursor:pointer}',
      '.tw-git-danger:hover:not(:disabled){opacity:.9}',
      '.tw-git-danger:disabled{opacity:.5;cursor:default}',
      '.tw-git-overlay{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 62%,transparent)}',
      '.tw-git-dialog{width:100%;max-width:290px;box-sizing:border-box;padding:12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2));box-shadow:0 10px 28px color-mix(in srgb,var(--dsw-alias-bg-base) 45%,transparent)}',
      '.tw-git-dialogtitle{margin:0 0 6px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}',
      '.tw-git-dialogtext{margin:0 0 10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}',
      '.tw-git-dialogrow{display:flex;align-items:center;justify-content:flex-end;gap:8px}',
    ].join('');

    /** Required browser services; anything absent keeps this plugin inactive. */
    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'];

    /**
     * Client plugin body: dictionaries, the tab type, its body and title, and the
     * Session-header button that opens it.
     * @param ctx - client root context carrying the services above.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-panel: dictionaries');
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            priority: 'extension',
            title: () => t('type.label'),
            guide: [
              {
                id: 'git',
                order: 30,
                title: () => t('guide.title'),
                description: () => t('guide.description'),
                icon: GitMark,
              },
            ],
          }),
        'git-panel: tab type',
      );
      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
              GitTabBody,
            ),
          ),
        'git-panel: tab body',
      );
      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS }, GitTabTitle),
          ),
        'git-panel: tab title',
      );
      ctx.effect(
        () =>
          ctx.slots.inject('conversation.session.header.utilities', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'git-panel-open',
                order: 6,
                locale: NS,
                inject: () => ({ openTab: () => ctx.sidebarRight.openTab(TAB_KIND) }),
              },
              GitOpenAction,
            ),
          ),
        'git-panel: header button',
      );
      ctx.effect(
        () =>
          ctx.slots.inject('conversation.composer.dock', () =>
            ctx.slots.register(
              {
                name: 'conversation.composer.dock',
                id: 'git-panel-branch',
                order: -1,
                locale: NS,
              },
              GitBranchDock,
            ),
          ),
        'git-panel: composer branch chip',
      );
    }

    return { inject, apply };
  },
});
