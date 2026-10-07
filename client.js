/**
 * Client half of the git panel: one right-Sidebar tab type, its body, its live
 * chip title, and the Session-header button that opens it.
 *
 * The body reads the Session's workspace directory from the framework's Session
 * snapshot and talks to the Host half over the composition's own HTTP carrier.
 * Rendering follows the Harness UI rules: only framework props and `react` are
 * imported, every colour is a theme token, all copy goes through the locale
 * service, and each registration is owned by an effect so unloading the plugin
 * removes it.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-git-panel',
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
    const TAB_ID = '@local/dsh-git-panel/tab';
    /** The page type the tab strip and the header button open. */
    const TAB_KIND = 'dshGitPanel';
    /** Host route prefix, matching the Host half. */
    const API = '/git-panel';
    /** Poll cadence while the tab is on screen. */
    const REFRESH_MS = 5000;

    /** Simplified Chinese dictionary and key-set source of truth. */
    const zh = {
      'type.label': 'Git',
      'guide.title': 'Git',
      'guide.description': '查看工作区的改动、差异与提交历史，并暂存或提交',
      'header.open': '打开 Git 面板',
      'tab.changes': '改动',
      'tab.history': '历史',
      'tab.branches': '分支',
      'state.loading': '正在读取仓库…',
      'state.noWorkspace': '这个会话还没有工作区目录。',
      'state.notRepo': '这个目录不是 git 仓库。',
      'state.notRepoPath': '这个目录不是 git 仓库：',
      'state.retry': '重试',
      'state.refresh': '刷新',
      'state.unborn': '还没有任何提交',
      'state.detached': '游离 HEAD',
      'state.upstream': '上游',
      'state.ahead': '领先',
      'state.behind': '落后',
      'state.clean': '工作区干净，没有未提交的改动。',
      'group.conflicted': '冲突',
      'group.staged': '已暂存',
      'group.unstaged': '未暂存',
      'group.untracked': '未跟踪',
      'action.stage': '暂存',
      'action.unstage': '取消暂存',
      'action.unstageAll': '全部取消暂存',
      'action.close': '关闭差异',
      'commit.placeholder': '提交信息…',
      'commit.submit': '提交',
      'commit.count': '已暂存 {n} 个文件',
      'commit.needsMessage': '先写提交信息',
      'commit.noneStaged': '还没有暂存任何文件',
      'commit.readOnly': '插件当前是只读模式（allowWrite: false）',
      'commit.noIdentity': '这个仓库还没有配置 user.name / user.email，无法提交。',
      'commit.busy': '正在提交…',
      'commit.done': '已提交 {hash}',
      'diff.empty': '这个文件没有可显示的差异。',
      'diff.binary': '二进制文件，无法显示文本差异。',
      'diff.truncated': '差异过大，只显示了一部分。',
      'diff.tooLarge': '文件过大，未读取内容。',
      'history.all': '全部引用',
      'history.empty': '还没有提交。',
      'history.loading': '正在读取提交历史…',
      'history.back': '返回列表',
      'history.files': '变更文件',
      'history.open': '查看提交',
      'branches.local': '本地分支',
      'branches.remote': '远程分支',
      'branches.tag': '标签',
      'branches.empty': '没有分支。',
      'branches.current': '当前',
      'common.error': '出错了',
    };

    /** English dictionary over the same key set. */
    const en = {
      'type.label': 'Git',
      'guide.title': 'Git',
      'guide.description': 'Changes, diffs and history for this workspace, with staging and commit',
      'header.open': 'Open the Git panel',
      'tab.changes': 'Changes',
      'tab.history': 'History',
      'tab.branches': 'Branches',
      'state.loading': 'Reading the repository…',
      'state.noWorkspace': 'This Session has no workspace directory.',
      'state.notRepo': 'This directory is not a git repository.',
      'state.notRepoPath': 'This directory is not a git repository: ',
      'state.retry': 'Retry',
      'state.refresh': 'Refresh',
      'state.unborn': 'No commits yet',
      'state.detached': 'Detached HEAD',
      'state.upstream': 'Upstream',
      'state.ahead': 'ahead',
      'state.behind': 'behind',
      'state.clean': 'The working tree is clean.',
      'group.conflicted': 'Conflicts',
      'group.staged': 'Staged',
      'group.unstaged': 'Changes',
      'group.untracked': 'Untracked',
      'action.stage': 'Stage',
      'action.unstage': 'Unstage',
      'action.unstageAll': 'Unstage all',
      'action.close': 'Close the diff',
      'commit.placeholder': 'Commit message…',
      'commit.submit': 'Commit',
      'commit.count': '{n} staged file(s)',
      'commit.needsMessage': 'Write a commit message first',
      'commit.noneStaged': 'Nothing is staged yet',
      'commit.readOnly': 'The plugin runs read-only (allowWrite: false)',
      'commit.noIdentity': 'This repository has no user.name / user.email, so it cannot commit.',
      'commit.busy': 'Committing…',
      'commit.done': 'Committed {hash}',
      'diff.empty': 'No text difference to show.',
      'diff.binary': 'Binary file: no text diff.',
      'diff.truncated': 'The diff is large; only part of it is shown.',
      'diff.tooLarge': 'The file is too large to read.',
      'history.all': 'All refs',
      'history.empty': 'No commits yet.',
      'history.loading': 'Reading history…',
      'history.back': 'Back to the list',
      'history.files': 'Changed files',
      'history.open': 'Open the commit',
      'branches.local': 'Local',
      'branches.remote': 'Remote',
      'branches.tag': 'Tags',
      'branches.empty': 'No branches.',
      'branches.current': 'current',
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

    const api = {
      status: (root) => request(`${API}/status?${query({ root })}`),
      diff: (root, side, path) => request(`${API}/diff?${query({ root, side, path })}`),
      log: (root, options) =>
        request(`${API}/log?${query({ root, limit: options.limit, all: options.all ? 1 : 0 })}`),
      commitDetail: (root, rev) => request(`${API}/commit?${query({ root, rev })}`),
      branches: (root) => request(`${API}/branches?${query({ root })}`),
      stage: (root, paths) =>
        request(`${API}/stage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root, paths }),
        }),
      unstage: (root, paths) =>
        request(`${API}/unstage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root, paths }),
        }),
      commit: (root, message) =>
        request(`${API}/commit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root, message }),
        }),
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
      if (upper === 'A') return 'dsh-git-mark a';
      if (upper === 'D') return 'dsh-git-mark d';
      if (upper === 'U') return 'dsh-git-mark u';
      if (upper === '?') return 'dsh-git-mark q';
      return 'dsh-git-mark m';
    }

    /** The line classes a unified diff uses. */
    function classifyLine(line) {
      if (line.startsWith('@@')) return 'hunk';
      if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
      if (line.startsWith('+')) return 'add';
      if (line.startsWith('-')) return 'del';
      if (
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('similarity index') ||
        line.startsWith('rename from') ||
        line.startsWith('rename to') ||
        line.startsWith('Binary files') ||
        line.startsWith('\\')
      ) {
        return 'meta';
      }
      return 'ctx';
    }

    /** Split one patch into per-file sections with add/delete counts. */
    function parsePatch(text) {
      const files = [];
      let current = null;
      for (const line of String(text ?? '').split('\n')) {
        if (line.startsWith('diff --git ')) {
          current = { header: line, lines: [], adds: 0, dels: 0, path: patchPath(line) };
          files.push(current);
          continue;
        }
        if (current === null) {
          if (line === '') continue;
          current = { header: '', lines: [], adds: 0, dels: 0, path: null };
          files.push(current);
        }
        const kind = classifyLine(line);
        if (kind === 'add') current.adds += 1;
        else if (kind === 'del') current.dels += 1;
        current.lines.push({ kind, text: line });
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
      for (const line of section.lines) {
        if (line.kind !== 'meta') continue;
        if (line.text.startsWith('new file')) return 'A';
        if (line.text.startsWith('deleted file')) return 'D';
        if (line.text.startsWith('rename from')) return 'R';
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
        let lane = lanes.indexOf(commit.hash);
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
        if (parents.length === 0) lanes[lane] = null;
        else lanes[lane] = parents[0];
        const parentLanes = [];
        for (let index = 0; index < parents.length; index += 1) {
          const parent = parents[index];
          if (index === 0) {
            parentLanes.push(lane);
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
          if (index !== lane && lanes[index] !== null && lanes[index] === lanes[lane]) lanes[index] = null;
        }
        while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
        rows.push({ commit, lane, before, after: lanes.slice(), parentLanes });
      }
      let widest = 1;
      for (const row of rows) widest = Math.max(widest, row.before.length, row.after.length);
      return { rows, widest };
    }

    /** One row's graph segment: pass-through lanes, the dot, and the parent edges. */
    function GraphCell(props) {
      const { row, widest, height } = props;
      const step = 10;
      const x = (lane) => 6 + lane * step;
      const width = Math.max(18, 6 + widest * step);
      const middle = height / 2;
      const parts = [];
      const laneColor = (lane) => {
        const palette = [
          'var(--dsw-alias-brand-primary)',
          'var(--dsw-alias-state-success-primary)',
          'var(--dsw-alias-state-warn-primary)',
          'var(--dsw-alias-label-secondary)',
          'var(--dsw-alias-state-error-primary)',
        ];
        return palette[lane % palette.length];
      };
      for (let lane = 0; lane < row.before.length; lane += 1) {
        if (row.before[lane] === null || lane === row.lane) continue;
        const ended = row.after[lane] === null || row.after[lane] === undefined;
        parts.push(
          h('path', {
            key: `lane-${String(lane)}`,
            d: ended
              ? `M ${x(lane)} 0 L ${x(lane)} ${middle} L ${x(row.lane)} ${middle}`
              : `M ${x(lane)} 0 L ${x(lane)} ${height}`,
            stroke: laneColor(lane),
            fill: 'none',
            'stroke-width': 1.5,
            opacity: 0.85,
          }),
        );
      }
      for (let index = 0; index < row.parentLanes.length; index += 1) {
        const target = row.parentLanes[index];
        parts.push(
          h('path', {
            key: `edge-${String(index)}`,
            d:
              target === row.lane
                ? `M ${x(row.lane)} ${middle} L ${x(row.lane)} ${height}`
                : `M ${x(row.lane)} ${middle} C ${x(row.lane)} ${middle + height / 4}, ${x(target)} ${height - height / 4}, ${x(target)} ${height}`,
            stroke: laneColor(index === 0 ? row.lane : target),
            fill: 'none',
            'stroke-width': 1.5,
          }),
        );
      }
      parts.push(
        h('circle', {
          key: 'dot',
          cx: x(row.lane),
          cy: middle,
          r: 3.2,
          fill: 'var(--dsw-alias-bg-base)',
          stroke: laneColor(row.lane),
          'stroke-width': 1.6,
        }),
      );
      return h(
        'svg',
        {
          className: 'dsh-git-graph',
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

    /** Render one patch's lines. */
    function DiffCode(props) {
      const { text, binary, truncated, empty, t } = props;
      if (binary === true) return h('p', { className: 'dsh-git-note' }, t('diff.binary'));
      if (text === '' || text === undefined) return h('p', { className: 'dsh-git-note' }, empty);
      const files = parsePatch(text);
      const nodes = [];
      let rendered = 0;
      let clipped = false;
      for (const file of files) {
        for (const line of file.lines) {
          if (rendered >= MAX_DIFF_LINES) {
            clipped = true;
            break;
          }
          rendered += 1;
          nodes.push(h('div', { key: String(nodes.length), className: `dsh-git-l ${line.kind}` }, line.text || ' '));
        }
        if (clipped) break;
      }
      if (clipped || truncated === true) {
        nodes.push(h('p', { key: 'trunc', className: 'dsh-git-note' }, t('diff.truncated')));
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

    /** The button in the Session header that opens this tab. */
    function GitOpenAction(props) {
      const { t, openTab } = props;
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-git-tool',
          title: t('header.open'),
          'aria-label': t('header.open'),
          onClick: () => openTab(),
        },
        h(GitMark, { size: 15 }),
      );
    }

    /** One section of the change list. */
    function ChangeGroup(props) {
      const { group, selectedKey, onSelect, onStage, onUnstage, busy, t } = props;
      const header = [
        h('span', { key: 'title' }, group.title),
        h('span', { key: 'count', className: 'dsh-git-count' }, group.entries.length),
      ];
      if (group.action === 'unstage') {
        header.push(
          h(
            'button',
            {
              key: 'all',
              type: 'button',
              disabled: busy,
              onClick: () => onUnstage(group.entries.map((entry) => entry.path)),
            },
            t('action.unstageAll'),
          ),
        );
      }
      const nodes = [h('div', { key: 'group', className: 'dsh-git-group' }, header)];
      for (const entry of group.entries) {
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
              className: 'dsh-git-rowwrap',
              'data-active': selectedKey === entry.key ? 'true' : 'false',
            },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-git-rowmain',
                onClick: () => onSelect(entry),
              },
              h('span', { className: markClass(entry.letter) }, entry.letter),
              h('span', { className: 'dsh-git-name' }, entry.name),
              h('span', { className: 'dsh-git-dir' }, entry.dir),
            ),
            action === null
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-git-act',
                    title: action.label,
                    'aria-label': action.label,
                    disabled: busy,
                    onClick: action.run,
                  },
                  group.action === 'stage' ? '⊕' : '⊖',
                ),
          ),
        );
      }
      return h(React.Fragment, null, nodes);
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
      const [history, setHistory] = useState({ phase: 'idle', commits: [] });
      const [branches, setBranches] = useState({ phase: 'idle', refs: [] });
      const [detail, setDetail] = useState({ phase: 'idle', commit: null });
      const [allRefs, setAllRefs] = useState(false);
      const [message, setMessage] = useState('');
      const [busy, setBusy] = useState(null);
      const [notice, setNotice] = useState(null);

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

      /** Load the diff for the selected entry. */
      useEffect(() => {
        if (selection === null || root === undefined || root === null) return undefined;
        let live = true;
        setDiff({ phase: 'loading' });
        api
          .diff(root, selection.side, selection.path)
          .then((payload) => {
            if (live) setDiff({ phase: 'ready', diff: payload.diff });
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

      /** Load branches when their tab is shown. */
      useEffect(() => {
        if (view !== 'branches' || !ready) return undefined;
        let live = true;
        setBranches({ phase: 'loading', refs: [] });
        api
          .branches(root)
          .then((payload) => {
            if (live) setBranches({ phase: 'ready', refs: payload.refs });
          })
          .catch((error) => {
            if (live) setBranches({ phase: 'error', refs: [], error });
          });
        return () => {
          live = false;
        };
      }, [view, ready, root]);

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
        async (label, operation) => {
          setBusy(label);
          setNotice(null);
          try {
            await operation();
            await refresh({ announce: false });
          } catch (error) {
            setNotice({ kind: 'error', text: String((error && error.message) || error) });
          } finally {
            setBusy(null);
          }
        },
        [refresh],
      );

      const stagePaths = useCallback(
        (paths) =>
          write('stage', async () => {
            await api.stage(root, paths);
            // The entry moved sections: follow it so the open diff stays truthful.
            setSelection((current) =>
              current !== null && paths.includes(current.path)
                ? { ...current, side: 'index', key: `staged:${current.path}` }
                : current,
            );
          }),
        [root, write],
      );
      const unstagePaths = useCallback(
        (paths) =>
          write('unstage', async () => {
            await api.unstage(root, paths);
            setSelection((current) =>
              current !== null && paths.includes(current.path)
                ? { ...current, side: 'worktree', key: `unstaged:${current.path}` }
                : current,
            );
          }),
        [root, write],
      );
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
                        : '?',
                  ...splitPath(entry.path),
                })),
              };
        return [
          build('conflicted', t('group.conflicted'), status.changes.conflicted, 'worktree', null),
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
        return h('div', { className: 'dsh-git-root' }, style, h('p', { className: 'dsh-git-note' }, t('state.noWorkspace')));
      }
      if (state.phase === 'loading') {
        return h('div', { className: 'dsh-git-root' }, style, h('p', { className: 'dsh-git-note' }, t('state.loading')));
      }
      if (state.phase === 'error') {
        return h(
          'div',
          { className: 'dsh-git-root' },
          style,
          h('p', { className: 'dsh-git-note error' }, String(state.error.message)),
          h(
            'div',
            { className: 'dsh-git-note' },
            h('button', { type: 'button', className: 'dsh-git-tool', onClick: () => refresh() }, t('state.retry')),
          ),
        );
      }
      if (state.status.repo !== true) {
        return h(
          'div',
          { className: 'dsh-git-root' },
          style,
          h('p', { className: 'dsh-git-note' }, t('state.notRepo')),
          h('p', { className: 'dsh-git-note' }, cwd),
        );
      }

      const status = state.status;
      const header = h(
        'div',
        { key: 'header', className: 'dsh-git-header' },
        h(
          'span',
          { className: 'dsh-git-chip', title: status.upstream ?? undefined },
          h('span', null, status.unborn ? t('state.unborn') : status.branch ?? t('state.detached')),
        ),
        status.ahead > 0 ? h('span', { className: 'dsh-git-chip' }, `↑${String(status.ahead)}`) : null,
        status.behind > 0 ? h('span', { className: 'dsh-git-chip' }, `↓${String(status.behind)}`) : null,
        h('span', { className: 'dsh-git-spacer' }),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-git-tool',
            title: t('state.refresh'),
            'aria-label': t('state.refresh'),
            disabled: busy !== null,
            onClick: () => {
              refresh({ announce: false });
              if (view === 'history') loadHistory();
            },
          },
          '⟳',
        ),
      );

      const tabs = h(
        'div',
        { key: 'tabs', className: 'dsh-git-tabs', role: 'tablist' },
        ...[
          { id: 'changes', label: t('tab.changes') },
          { id: 'history', label: t('tab.history') },
          { id: 'branches', label: t('tab.branches') },
        ].map((entry) =>
          h(
            'button',
            {
              key: entry.id,
              type: 'button',
              role: 'tab',
              className: 'dsh-git-tab',
              'aria-selected': view === entry.id ? 'true' : 'false',
              onClick: () => setView(entry.id),
            },
            entry.label,
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
                className: notice.kind === 'error' ? 'dsh-git-banner error' : 'dsh-git-banner',
              },
              notice.text,
            );

      let body = null;
      if (view === 'changes') {
        const list = h(
          'div',
          { key: 'list', className: selection === null ? 'dsh-git-scroll' : 'dsh-git-scroll split' },
          clean ? h('p', { className: 'dsh-git-note' }, t('state.clean')) : null,
          groups.map((group) =>
            h(ChangeGroup, {
              key: group.id,
              group,
              selectedKey: selection === null ? null : selection.key,
              busy: busy !== null,
              onSelect: (entry) => setSelection(entry),
              onStage: stagePaths,
              onUnstage: unstagePaths,
              t,
            }),
          ),
        );
        const diffNode =
          selection === null
            ? null
            : h(
                'div',
                { key: 'diff', className: 'dsh-git-diff' },
                h(
                  'div',
                  { className: 'dsh-git-diffhead' },
                  h('span', { className: 'dsh-git-path', title: selection.path }, selection.path),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-git-tool',
                      title: t('action.close'),
                      'aria-label': t('action.close'),
                      onClick: () => setSelection(null),
                    },
                    '✕',
                  ),
                ),
                h(
                  'div',
                  { className: 'dsh-git-code' },
                  diff.phase === 'loading'
                    ? h('p', { className: 'dsh-git-note' }, t('state.loading'))
                    : diff.phase === 'error'
                      ? h('p', { className: 'dsh-git-note error' }, String(diff.error.message))
                      : h(DiffCode, {
                          text: diff.diff.text,
                          binary: diff.diff.binary,
                          truncated: diff.diff.truncated,
                          empty: t('diff.empty'),
                          t,
                        }),
                ),
              );
        const commitBox = h(
          'div',
          { key: 'commit', className: 'dsh-git-commit' },
          h('textarea', {
            value: message,
            placeholder: t('commit.placeholder'),
            'aria-label': t('commit.placeholder'),
            onChange: (event) => setMessage(event.target.value),
          }),
          h(
            'div',
            { className: 'dsh-git-commitrow' },
            h(
              'span',
              { className: 'dsh-git-hint' },
              capabilities.allowWrite !== true
                ? t('commit.readOnly')
                : capabilities.identity === null
                  ? t('commit.noIdentity')
                  : t('commit.count', { n: stagedCount }),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-git-primary',
                disabled:
                  busy !== null ||
                  capabilities.allowWrite !== true ||
                  capabilities.identity === null ||
                  stagedCount === 0 ||
                  message.trim() === '',
                onClick: submitCommit,
              },
              busy === 'commit' ? t('commit.busy') : t('commit.submit'),
            ),
          ),
        );
        body = h('div', { key: 'body', className: 'dsh-git-body' }, list, diffNode, commitBox);
      } else if (view === 'history') {
        if (detail.phase !== 'idle') {
          body = h(
            'div',
            { key: 'body', className: 'dsh-git-body' },
            h(
              'div',
              { className: 'dsh-git-diffhead' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-git-tool',
                  title: t('history.back'),
                  'aria-label': t('history.back'),
                  onClick: () => setDetail({ phase: 'idle', commit: null }),
                },
                '←',
              ),
              h('span', { className: 'dsh-git-path' }, detail.commit === null ? '' : detail.commit.hash.slice(0, 10)),
            ),
            detail.phase === 'loading'
              ? h('p', { className: 'dsh-git-note' }, t('state.loading'))
              : detail.phase === 'error'
                ? h('p', { className: 'dsh-git-note error' }, String(detail.error.message))
                : h(
                    'div',
                    { className: 'dsh-git-scroll' },
                    h('div', { className: 'dsh-git-group' }, `${detail.commit.author} · ${detail.commit.date}`),
                    h('div', { className: 'dsh-git-l ctx' }, detail.commit.message),
                    h('div', { className: 'dsh-git-group' }, t('history.files')),
                    ...parsePatch(detail.commit.patch).map((section, index) =>
                      h(
                        'div',
                        { key: `f${String(index)}`, className: 'dsh-git-row' },
                        h('span', { className: markClass(patchStatus(section)) }, patchStatus(section)),
                        h('span', { className: 'dsh-git-name' }, section.path === null ? '(?)' : splitPath(section.path).name),
                        h('span', { className: 'dsh-git-dir' }, section.path === null ? '' : splitPath(section.path).dir),
                        h('span', { className: 'dsh-git-hint' }, `+${String(section.adds)} −${String(section.dels)}`),
                      ),
                    ),
                  ),
            h(
              'div',
              { className: 'dsh-git-diff' },
              h(
                'div',
                { className: 'dsh-git-code' },
                detail.phase === 'ready'
                  ? h(DiffCode, {
                      text: detail.commit.patch,
                      binary: false,
                      truncated: detail.commit.patchTruncated,
                      empty: t('diff.empty'),
                      t,
                    })
                  : null,
              ),
            ),
          );
        } else {
          const layout = layoutGraph(history.commits ?? []);
          body = h(
            'div',
            { key: 'body', className: 'dsh-git-body' },
            h(
              'div',
              { className: 'dsh-git-group' },
              h('span', null, t('tab.history')),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => setAllRefs((value) => !value),
                },
                `${t('history.all')}${allRefs ? ' ✓' : ''}`,
              ),
            ),
            h(
              'div',
              { className: 'dsh-git-scroll' },
              history.phase === 'loading'
                ? h('p', { className: 'dsh-git-note' }, t('history.loading'))
                : history.phase === 'error'
                  ? h('p', { className: 'dsh-git-note error' }, String(history.error.message))
                  : (history.commits ?? []).length === 0
                    ? h('p', { className: 'dsh-git-note' }, t('history.empty'))
                    : layout.rows.map((row) =>
                        h(
                          'button',
                          {
                            key: row.commit.hash,
                            type: 'button',
                            className: 'dsh-git-commit-row',
                            onClick: () => openCommit(row.commit.hash),
                          },
                          h(GraphCell, { row, widest: layout.widest, height: 22 }),
                          h('span', { className: 'dsh-git-hash' }, row.commit.hash.slice(0, 7)),
                          h('span', { className: 'dsh-git-subject', title: row.commit.subject }, row.commit.subject),
                          ...(row.commit.refs ?? []).slice(0, 2).map((ref, index) =>
                            h(
                              'span',
                              {
                                key: `r${String(index)}`,
                                className: /HEAD/.test(ref) ? 'dsh-git-ref head' : 'dsh-git-ref',
                              },
                              ref.replace('HEAD -> ', ''),
                            ),
                          ),
                        ),
                      ),
            ),
          );
        }
      } else {
        const groupsForRefs = [
          { id: 'local', title: t('branches.local'), entries: (branches.refs ?? []).filter((ref) => ref.kind === 'local') },
          { id: 'remote', title: t('branches.remote'), entries: (branches.refs ?? []).filter((ref) => ref.kind === 'remote') },
          { id: 'tag', title: t('branches.tag'), entries: (branches.refs ?? []).filter((ref) => ref.kind === 'tag') },
        ].filter((group) => group.entries.length > 0);
        body = h(
          'div',
          { key: 'body', className: 'dsh-git-body' },
          h(
            'div',
            { className: 'dsh-git-scroll' },
            branches.phase === 'loading'
              ? h('p', { className: 'dsh-git-note' }, t('state.loading'))
              : branches.phase === 'error'
                ? h('p', { className: 'dsh-git-note error' }, String(branches.error.message))
                : groupsForRefs.length === 0
                  ? h('p', { className: 'dsh-git-note' }, t('branches.empty'))
                  : groupsForRefs.map((group) =>
                      h(
                        React.Fragment,
                        { key: group.id },
                        h(
                          'div',
                          { className: 'dsh-git-group' },
                          h('span', null, group.title),
                          h('span', { className: 'dsh-git-count' }, group.entries.length),
                        ),
                        ...group.entries.map((ref) =>
                          h(
                            'div',
                            { key: `${group.id}:${ref.name}`, className: 'dsh-git-row' },
                            h('span', { className: 'dsh-git-name', title: ref.name }, ref.name),
                            ref.head ? h('span', { className: 'dsh-git-ref head' }, t('branches.current')) : null,
                            h('span', { className: 'dsh-git-dir' }, ref.track === null ? '' : ref.track),
                            ref.upstream === null ? null : h('span', { className: 'dsh-git-hint' }, `→ ${ref.upstream}`),
                          ),
                        ),
                      ),
                    ),
          ),
        );
      }

      return h('div', { className: 'dsh-git-root' }, style, header, tabs, noticeNode, body);
    }

    /** Panel styles: theme tokens only, prefixed classes, no global selectors. */
    const CSS = [
      '.dsh-git-root{height:100%;min-height:0;flex:auto;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}',
      '.dsh-git-header{flex:none;display:flex;align-items:center;gap:6px;height:38px;padding:0 6px 0 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-git-chip{display:inline-flex;align-items:center;min-width:0;max-width:100%;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-git-spacer{flex:1 1 auto;min-width:0}',
      '.dsh-git-tool{width:26px;height:26px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;background:0 0;border-radius:4px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit}',
      '.dsh-git-tool:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}',
      '.dsh-git-tool:disabled{opacity:.45;cursor:default}',
      '.dsh-git-tool svg{width:15px;height:15px}',
      '.dsh-git-tabs{flex:none;display:flex;gap:2px;padding:4px 6px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-git-tab{flex:1 1 auto;min-width:0;padding:4px 6px;border:0;background:0 0;border-radius:4px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-git-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-git-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.dsh-git-scroll{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-gutter:stable}',
      '.dsh-git-scroll.split{flex:0 0 auto;max-height:45%}',
      '.dsh-git-note{margin:0;padding:10px 12px;color:var(--dsw-alias-label-secondary);font-size:12px;word-break:break-all}',
      '.dsh-git-note.error{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-git-banner{margin:6px 8px;padding:6px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-git-banner.error{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-git-group{display:flex;align-items:center;gap:6px;padding:6px 10px 2px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.dsh-git-count{margin-left:2px;color:var(--dsw-alias-state-idle-primary)}',
      '.dsh-git-group button{margin-left:auto;border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;padding:0}',
      '.dsh-git-group button:hover{color:var(--dsw-alias-label-primary)}',
      '.dsh-git-row{display:flex;align-items:center;gap:6px;width:100%;min-width:0;box-sizing:border-box;padding:3px 8px 3px 10px;color:inherit;font:inherit;text-align:left}',
      '.dsh-git-rowwrap{display:flex;align-items:center;gap:6px;width:100%;min-width:0;box-sizing:border-box;padding:0 8px 0 10px;cursor:pointer}',
      '.dsh-git-rowwrap:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.dsh-git-rowwrap[data-active="true"]{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-git-rowmain{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;padding:3px 0;border:0;background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dsh-git-mark{width:12px;flex:none;text-align:center;font-weight:600;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-git-mark.m{color:var(--dsw-alias-state-warn-primary)}',
      '.dsh-git-mark.a{color:var(--dsw-alias-state-success-primary)}',
      '.dsh-git-mark.d,.dsh-git-mark.u{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-git-name{flex:none;max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-git-dir{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.dsh-git-hint{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.dsh-git-act{flex:none;display:none;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;background:0 0;border-radius:4px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;cursor:pointer}',
      '.dsh-git-rowwrap:hover .dsh-git-act{display:inline-flex}',
      '.dsh-git-act:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.dsh-git-diff{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-git-diffhead{flex:none;display:flex;align-items:center;gap:6px;height:30px;padding:0 6px 0 10px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.dsh-git-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-git-code{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-gutter:stable;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.55}',
      '.dsh-git-l{white-space:pre;padding:0 10px}',
      '.dsh-git-l.hunk{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-git-l.meta{color:var(--dsw-alias-label-secondary);opacity:.75}',
      '.dsh-git-l.add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}',
      '.dsh-git-l.del{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}',
      '.dsh-git-commit{flex:none;border-top:.5px solid var(--dsw-alias-border-l1);padding:8px}',
      '.dsh-git-commit textarea{width:100%;box-sizing:border-box;min-height:54px;max-height:160px;resize:vertical;padding:6px 8px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}',
      '.dsh-git-commit textarea:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-git-commitrow{display:flex;align-items:center;gap:8px;margin-top:6px}',
      '.dsh-git-primary{margin-left:auto;padding:4px 12px;border:0;border-radius:4px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;cursor:pointer}',
      '.dsh-git-primary:disabled{opacity:.5;cursor:default}',
      '.dsh-git-graph{flex:none}',
      '.dsh-git-commit-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;box-sizing:border-box;padding:2px 8px 2px 4px;border:0;background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dsh-git-commit-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.dsh-git-hash{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-git-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-git-ref{flex:none;max-width:90px;padding:0 5px;border-radius:999px;font-size:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-git-ref.head{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
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
    }

    return { inject, apply };
  },
});
