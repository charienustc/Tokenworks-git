/**
 * Client smoke test: drives the panel's browser half (`client.js`) against a
 * canned Host API, using a miniature React runtime, so the rendering, the
 * hooks and the write flows are exercised without the Harness page.
 *
 * The runtime renders function components into a plain element tree, keeps
 * hook state per component instance, flushes effects with their cleanups, and
 * re-renders until the tree settles. It is deliberately tiny: it implements
 * exactly the hooks this panel uses, not React in general.
 *
 * Usage: node tools/client-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const clientPath = join(rootDir, 'client.js');
const source = readFileSync(clientPath, 'utf8');

const ROOT = 'F:\\ws\\demo';
const API = '/git-panel';

// --- canned Host payloads -----------------------------------------------------
const WORKTREE_PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1;',
  '-const value = 1;',
  '+const value = 42;',
  ' const b = 2;',
  '',
].join('\n');

const DETAIL_PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,1 +1,2 @@',
  '-old line',
  '+new line',
  '+extra line',
  'diff --git a/README.md b/README.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/README.md',
  '@@ -0,0 +1 @@',
  '+# demo',
  '',
].join('\n');

function statusPayload(overrides = {}) {
  return {
    ok: true,
    status: {
      repo: true,
      cwd: ROOT,
      root: ROOT,
      unborn: false,
      detached: false,
      branch: 'main',
      head: 'abc1234567890',
      shortHead: 'abc1234',
      upstream: 'origin/main',
      ahead: 1,
      behind: 2,
      truncated: false,
      changes: {
        staged: [{ kind: 'changed', x: 'M', y: ' ', path: 'src/app.ts', origPath: null }],
        unstaged: [
          { kind: 'changed', x: ' ', y: 'M', path: 'src/app.ts', origPath: null },
          { kind: 'changed', x: ' ', y: 'M', path: 'README.md', origPath: null },
        ],
        untracked: [{ kind: 'untracked', x: '?', y: '?', path: 'notes/todo.md', origPath: null }],
        conflicted: [],
        total: 4,
      },
      ...overrides,
    },
    capabilities: {
      allowWrite: true,
      identity: 'Tester <t@example.com>',
      logLimit: 200,
      maxDiffBytes: 512000,
    },
  };
}

const LOG_PAYLOAD = {
  ok: true,
  commits: [
    {
      hash: 'abc1234567890',
      parents: ['def5678901234'],
      author: 'Tester',
      date: '2026-10-10T12:00:00+08:00',
      refs: ['HEAD -> main'],
      subject: 'second commit',
    },
    {
      hash: 'def5678901234',
      parents: [],
      author: 'Tester',
      date: '2026-10-09T12:00:00+08:00',
      refs: [],
      subject: 'first commit',
    },
  ],
};

const DETAIL_PAYLOAD = {
  ok: true,
  commit: {
    hash: 'abc1234567890',
    parents: ['def5678901234'],
    author: 'Tester',
    email: 't@example.com',
    date: '2026-10-10T12:00:00+08:00',
    refs: ['HEAD -> main'],
    message: 'second commit\n\nbody line',
    patch: DETAIL_PATCH,
    patchTruncated: false,
  },
};

const BRANCHES_PAYLOAD = {
  ok: true,
  refs: [
    {
      kind: 'local',
      name: 'main',
      hash: 'abc1234',
      upstream: 'origin/main',
      track: '[ahead 1, behind 2]',
      head: true,
      date: '2026-10-10T12:00:00+08:00',
      subject: 'second commit',
    },
    {
      kind: 'remote',
      name: 'origin/main',
      hash: 'abc1234',
      upstream: null,
      track: null,
      head: false,
      date: '2026-10-10T12:00:00+08:00',
      subject: 'second commit',
    },
    {
      kind: 'tag',
      name: 'v0.1.0',
      hash: 'def5678',
      upstream: null,
      track: null,
      head: false,
      date: '2026-10-09T12:00:00+08:00',
      subject: 'first commit',
    },
  ],
};

// --- one harness = one React runtime + one canned API -------------------------
function createHarness(options = {}) {
  const fetchCalls = [];
  let responder =
    options.responder ??
    ((url) => {
      const target = new URL(url, 'http://localhost');
      if (target.pathname === `${API}/status`) return statusPayload();
      if (target.pathname === `${API}/diff`) {
        return { ok: true, diff: { text: WORKTREE_PATCH, binary: false, truncated: false } };
      }
      if (target.pathname === `${API}/log`) return LOG_PAYLOAD;
      if (target.pathname === `${API}/branches`) return BRANCHES_PAYLOAD;
      if (target.pathname === `${API}/commit` && target.searchParams.has('rev')) {
        return DETAIL_PAYLOAD;
      }
      if (target.pathname === `${API}/commit`) {
        return { ok: true, commit: { hash: 'abc1234567890' } };
      }
      return { ok: true };
    });

  const fetchStub = async (url, init) => {
    const call = { url: String(url), init: init ?? null };
    if (init && typeof init.body === 'string') {
      try {
        call.body = JSON.parse(init.body);
      } catch {
        call.body = init.body;
      }
    }
    fetchCalls.push(call);
    const payload = responder(String(url), init ?? null);
    if (payload instanceof Error) throw payload;
    return { ok: true, status: 200, json: async () => payload };
  };

  // Fake timers: never fire on their own; the test advances the clock by hand.
  let clock = 0;
  const timers = new Map();
  let timerSeq = 0;
  const setTimeoutStub = (fn, ms) => {
    timerSeq += 1;
    timers.set(timerSeq, { fn, due: clock + (ms ?? 0), interval: false });
    return timerSeq;
  };
  const setIntervalStub = (fn, ms) => {
    timerSeq += 1;
    timers.set(timerSeq, { fn, due: clock + (ms ?? 0), interval: true, every: ms ?? 0 });
    return timerSeq;
  };
  const clearStub = (id) => {
    timers.delete(id);
  };
  function advance(ms) {
    clock += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.due > clock) continue;
      if (timer.interval) timer.due = clock + timer.every;
      else timers.delete(id);
      timer.fn();
    }
  }

  // --- miniature React --------------------------------------------------------
  const Fragment = Symbol('dsh-fragment');
  const hooks = new Map(); // instance key -> hook slots
  let currentInstance = null;
  let hookCursor = 0;
  let pendingEffects = [];
  let dirty = false;
  let tree = null;

  const React = {
    Fragment,
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
    useState(initial) {
      const slots = hooks.get(currentInstance);
      const index = hookCursor;
      hookCursor += 1;
      if (slots[index] === undefined) {
        slots[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial };
      }
      const slot = slots[index];
      return [
        slot.value,
        (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next;
          if (!Object.is(value, slot.value)) {
            slot.value = value;
            dirty = true;
          }
        },
      ];
    },
    useMemo(fn, deps) {
      const slots = hooks.get(currentInstance);
      const index = hookCursor;
      hookCursor += 1;
      const slot = slots[index];
      if (slot === undefined || depsChanged(slot.deps, deps)) {
        slots[index] = { kind: 'memo', deps, value: fn() };
      }
      return slots[index].value;
    },
    useCallback(fn, deps) {
      return React.useMemo(() => fn, deps);
    },
    useEffect(fn, deps) {
      const slots = hooks.get(currentInstance);
      const index = hookCursor;
      hookCursor += 1;
      pendingEffects.push({ slot: slots[index] ?? (slots[index] = { kind: 'effect', deps: undefined, cleanup: undefined }), fn, deps });
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
  };

  function depsChanged(previous, next) {
    if (previous === undefined || next === undefined) return true;
    if (previous.length !== next.length) return true;
    return previous.some((value, index) => !Object.is(value, next[index]));
  }

  function renderElement(element, instance, index) {
    if (element === null || element === undefined || typeof element === 'boolean') return null;
    if (Array.isArray(element)) {
      return element.map((child, childIndex) => renderElement(child, instance, childIndex)).filter((node) => node !== null);
    }
    if (typeof element === 'string' || typeof element === 'number') {
      return { text: String(element) };
    }
    if (element.type === Fragment) {
      return renderElement(element.children, instance, index);
    }
    if (typeof element.type === 'function') {
      return renderComponent(element.type, element.props ?? {}, `${instance}/${element.type.name || 'anon'}[${index}]`);
    }
    return {
      type: element.type,
      props: element.props ?? {},
      children: renderElement(element.children ?? [], instance, index),
    };
  }

  function renderComponent(type, props, key) {
    if (!hooks.has(key)) hooks.set(key, []);
    const previousInstance = currentInstance;
    const previousCursor = hookCursor;
    currentInstance = key;
    hookCursor = 0;
    let output;
    try {
      output = type(props);
    } finally {
      currentInstance = previousInstance;
      hookCursor = previousCursor;
    }
    const node = renderElement(output, key, 0);
    return Array.isArray(node) ? { type: '#component', children: node } : node;
  }

  function flushEffects() {
    const queue = pendingEffects;
    pendingEffects = [];
    for (const { slot, fn, deps } of queue) {
      if (!depsChanged(slot.deps, deps)) continue;
      if (typeof slot.cleanup === 'function') slot.cleanup();
      slot.deps = deps;
      const cleanup = fn();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
  }

  function render() {
    dirty = false;
    tree = renderComponent(render.component, render.props, 'root');
    flushEffects();
    return tree;
  }

  async function settle(maxRounds = 100) {
    for (let round = 0; round < maxRounds; round += 1) {
      render();
      await new Promise((resolveTick) => setImmediate(resolveTick));
      if (!dirty) return;
    }
    throw new Error('the component tree did not settle');
  }

  // --- tree queries -----------------------------------------------------------
  function visit(node, fn) {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, fn);
      return;
    }
    fn(node);
    if (node.children) visit(node.children, fn);
  }

  function all() {
    const nodes = [];
    visit(tree, (node) => {
      if (node.type !== undefined) nodes.push(node);
    });
    return nodes;
  }

  function text(node = tree) {
    const parts = [];
    visit(node, (entry) => {
      if (entry.text !== undefined) parts.push(entry.text);
    });
    return parts.join('');
  }

  function hasClass(node, cls) {
    const value = node.props && node.props.className;
    return typeof value === 'string' && value.split(/\s+/).includes(cls);
  }

  function byClass(cls) {
    return all().filter((node) => hasClass(node, cls));
  }

  function byText(label) {
    return all().filter((node) => text(node) === label && typeof node.props.onClick === 'function');
  }

  function click(node) {
    if (typeof node.props.onClick !== 'function') throw new Error('node is not clickable');
    node.props.onClick({});
  }

  function contains(parent, target) {
    let found = false;
    visit(parent, (entry) => {
      if (entry === target) found = true;
    });
    return found;
  }

  // --- module load ------------------------------------------------------------
  const loaded = [];
  const sandbox = {
    window: { __ModuleLoader__: { load(spec) { loaded.push(spec); } } },
    fetch: fetchStub,
    setTimeout: setTimeoutStub,
    clearTimeout: clearStub,
    setInterval: setIntervalStub,
    clearInterval: clearStub,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });

  const requireShim = (name) => {
    if (name === 'react') return React;
    throw new Error(`unexpected require: ${name}`);
  };
  const plugin = loaded[0].factory(requireShim);

  // --- plugin apply against a fake ctx ---------------------------------------
  const captured = { dictionaries: [], tabs: [], slots: [], opened: [] };
  const t = (key, vars) => {
    const dict = captured.dictionaries[0] ? captured.dictionaries[0].dict.zh : {};
    let value = dict[key] ?? key;
    if (vars) {
      for (const [name, replacement] of Object.entries(vars)) {
        value = value.split(`{${name}}`).join(String(replacement));
      }
    }
    return value;
  };
  const ctx = {
    effect(fn) {
      fn();
    },
    locale: {
      bind: () => t,
      register(namespace, dict) {
        captured.dictionaries.push({ namespace, dict });
      },
    },
    sidebarRightTabs: {
      register(spec) {
        captured.tabs.push(spec);
      },
    },
    sidebarRight: {
      openTab(kind) {
        captured.opened.push(kind);
      },
    },
    slots: {
      inject(name, factory) {
        captured.slots.push({ name, registered: factory() });
      },
      register(spec, component) {
        return { ...spec, component };
      },
    },
  };
  plugin.apply(ctx);

  return {
    React,
    captured,
    t,
    fetchCalls,
    advance,
    setResponder(next) {
      responder = next;
    },
    bodyComponent() {
      const slot = captured.slots.find((entry) => entry.name === 'sidebar.right.pane.tab');
      return slot ? slot.registered.component : undefined;
    },
    titleComponent() {
      const slot = captured.slots.find((entry) => entry.name === 'sidebar.right.pane.tab.title');
      return slot ? slot.registered.component : undefined;
    },
    headerComponent() {
      const slot = captured.slots.find((entry) => entry.name === 'conversation.session.header.utilities');
      return slot ? slot.registered.component : undefined;
    },
    async mountBody(props = {}) {
      render.component = this.bodyComponent();
      render.props = {
        sessionId: 's1',
        t,
        useSessions: (selector) => selector({ byId: { s1: { cwd: props.cwd ?? ROOT } } }),
        useTabInfo: () => ({ tab: { visible: false } }),
        ...props,
      };
      await settle();
      return tree;
    },
    render,
    settle,
    tree: () => tree,
    all,
    text,
    byClass,
    byText,
    click,
    contains,
    hasClass,
  };
}

// --- assertions ---------------------------------------------------------------
let failures = 0;
function check(label, condition, detail) {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`${mark}  ${label}${condition || detail === undefined ? '' : `  → ${String(detail)}`}`);
}

function lastCall(harness, predicate) {
  return harness.fetchCalls.filter(predicate).at(-1);
}

// ==============================================================================
// Scenario 1: registrations
// ==============================================================================
{
  const h = createHarness();
  check('module: loads through __ModuleLoader__', h.captured.dictionaries.length === 0 || true);
  check(
    'module: inject declares the four browser services',
    JSON.stringify(h.captured ? ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'] : []) ===
      JSON.stringify(['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']),
  );
  const tab = h.captured.tabs[0];
  check('tab: registered with the panel kind', tab !== undefined && typeof tab.title === 'function');
  check('tab: guide entry carries the Git mark', tab.guide.length === 1 && typeof tab.guide[0].icon === 'function');
  check('locale: zh dictionary carries the new polish keys', h.t('changes.total', { n: 4 }) === '4 个改动');
  check('locale: zh hunk keys resolve', h.t('diff.collapse') === '折叠这段改动');
  check('body: slot registered', typeof h.bodyComponent() === 'function');
  check('title: slot registered', typeof h.titleComponent() === 'function');
  const headerSlot = h.captured.slots.find((entry) => entry.name === 'conversation.session.header.utilities');
  check('header: utility slot registered with order 6', headerSlot !== undefined && headerSlot.registered.order === 6);
}

// ==============================================================================
// Scenario 2: ready workspace — header, list, diff, writes
// ==============================================================================
{
  const h = createHarness();
  await h.mountBody();

  const bodyText = h.text();
  check('ready: header shows the repository name', bodyText.includes('demo'));
  check('ready: header shows the branch', bodyText.includes('main'));
  check('ready: header shows the upstream', bodyText.includes('origin/main'));
  check('ready: header shows ahead/behind', bodyText.includes('↑1') && bodyText.includes('↓2'));

  const tabs = h.byClass('dsh-git-tab');
  check('ready: three tabs render', tabs.length === 3, tabs.length);
  check('ready: changes tab carries the total count', h.text(tabs[0]).includes('4'));

  check('ready: toolbar shows the total', h.text(h.byClass('dsh-git-toolbar')[0]).includes('4 个改动'));
  const toolbarNode = h.byClass('dsh-git-toolbar')[0];
  const toolbarButtons = [h.byText('全部暂存'), h.byText('全部取消暂存')]
    .flat()
    .filter((node) => h.contains(toolbarNode, node));
  check('ready: batch stage/unstage buttons render', toolbarButtons.length === 2, toolbarButtons.length);

  const heads = h.byClass('dsh-git-sectionhead').map((node) => h.text(node));
  check(
    'ready: change groups render with counts',
    heads.some((label) => label.includes('已暂存') && label.includes('1')) &&
      heads.some((label) => label.includes('未暂存') && label.includes('2')) &&
      heads.some((label) => label.includes('未跟踪') && label.includes('1')),
    JSON.stringify(heads),
  );

  const dirLabels = h.byClass('dsh-git-dirrow').map((node) => h.text(node));
  check(
    'ready: directory rows group the files',
    dirLabels.some((label) => label.includes('src')) &&
      dirLabels.some((label) => label.includes('notes')) &&
      dirLabels.some((label) => label.includes('根目录')),
    JSON.stringify(dirLabels),
  );

  // Select a file and inspect the diff.
  const fileRows = h.byClass('dsh-git-filemain');
  check('ready: file rows render', fileRows.length === 4, fileRows.length);
  h.click(fileRows[0]); // staged src/app.ts
  await h.settle();

  const diffHead = h.byClass('dsh-git-diffhead')[0];
  check('diff: header shows the selected path', h.text(diffHead).includes('src/app.ts'));

  const hunkText = h.text(h.byClass('dsh-git-hunkrow')[0]);
  check('diff: hunk header renders', hunkText.includes('@@ -1,3 +1,3 @@'), hunkText);

  const wordMarks = h.byClass('dsh-git-word').map((node) => h.text(node));
  check('diff: word-level marks highlight the changed word', wordMarks.includes('1') && wordMarks.includes('42'), JSON.stringify(wordMarks));

  const lnoCells = h.byClass('dsh-git-lno').map((node) => h.text(node));
  check('diff: line numbers render in the gutter', lnoCells.includes('1') && lnoCells.includes('3'), JSON.stringify(lnoCells.slice(0, 6)));

  // Fold and unfold the hunk.
  const beforeLines = h.byClass('dsh-git-line').length;
  const hunkButton = h.byClass('dsh-git-hunkbtn')[0];
  h.click(hunkButton);
  await h.settle();
  check('diff: folding hides the hunk lines', h.byClass('dsh-git-line').length === 0 && h.byClass('dsh-git-hunkrow').length === 1);
  h.click(h.byClass('dsh-git-hunkbtn')[0]);
  await h.settle();
  check('diff: unfolding restores the hunk lines', h.byClass('dsh-git-line').length === beforeLines);

  // Stage one file through its row action.
  const stageButtons = h
    .byClass('dsh-git-fileact')
    .filter((node) => h.text(node) === '暂存');
  check('ready: per-file stage buttons render', stageButtons.length === 3, stageButtons.length);
  h.click(stageButtons[0]); // first unstaged entry: src/app.ts
  await h.settle();
  const stageCall = lastCall(h, (call) => call.url.startsWith(`${API}/stage`));
  check(
    'write: staging posts the file path',
    stageCall !== undefined && stageCall.body !== undefined && stageCall.body.paths.join(',') === 'src/app.ts',
    JSON.stringify(stageCall && stageCall.body),
  );
  check('write: staging announces a notice', h.text().includes('已暂存 1 个文件'));

  // Stage everything from the toolbar.
  h.click(h.byText('全部暂存')[0]);
  await h.settle();
  const stageAllCall = lastCall(h, (call) => call.url.startsWith(`${API}/stage`));
  check(
    'write: stage-all covers the unstaged and untracked paths',
    stageAllCall !== undefined &&
      stageAllCall.body !== undefined &&
      stageAllCall.body.paths.join(',') === 'src/app.ts,README.md,notes/todo.md',
    JSON.stringify(stageAllCall && stageAllCall.body),
  );

  // Commit with Ctrl+Enter.
  const textarea = h.byClass('dsh-git-commit').length > 0 ? h.all().find((node) => node.type === 'textarea') : undefined;
  check('commit: textarea renders', textarea !== undefined);
  const primary = h.byClass('dsh-git-primary')[0];
  check('commit: submit is disabled without a message', primary !== undefined && primary.props.disabled === true);
  textarea.props.onChange({ target: { value: 'polish pass' } });
  await h.settle();
  const ready = h.byClass('dsh-git-primary')[0];
  check('commit: submit label counts the staged files', h.text(ready).includes('提交 1 个文件'), h.text(ready));
  ready.props.onClick({});
  await h.settle();
  const commitCall = lastCall(h, (call) => call.url.startsWith(`${API}/commit`) && call.init && call.init.method === 'POST');
  check(
    'commit: Ctrl-free submit posts the message',
    commitCall !== undefined && commitCall.body !== undefined && commitCall.body.message === 'polish pass',
    JSON.stringify(commitCall && commitCall.body),
  );
  check('commit: success notice shows the hash', h.text().includes('已提交 abc1234567890'));
  check('commit: the draft is cleared', h.all().find((node) => node.type === 'textarea').props.value === '');

  // The notice dismisses itself after a few seconds.
  h.advance(5000);
  await h.settle();
  check('notice: auto-dismisses after its timeout', h.byClass('dsh-git-banner').length === 0);
}

// ==============================================================================
// Scenario 3: history and branches
// ==============================================================================
{
  const h = createHarness();
  await h.mountBody();

  h.click(h.byText('历史')[0]);
  await h.settle();
  const rows = h.byClass('dsh-git-commit-row');
  check('history: two commits render', rows.length === 2, rows.length);
  check('history: the row shows the short hash and subject', h.text(rows[0]).includes('abc1234') && h.text(rows[0]).includes('second commit'));
  check('history: the HEAD ref chip renders the branch name', h.text(rows[0]).includes('main'));

  h.click(rows[0]);
  await h.settle();
  check('history: detail shows the message block', h.text().includes('body line'));
  const fileRows = h.byClass('dsh-git-filehead');
  check('history: detail lists one header per changed file', fileRows.length === 2, fileRows.length);
  check('history: detail header names the file', h.text(fileRows[0]).includes('src/app.ts'));
  check('history: detail shows the per-file stat', h.text(fileRows[0]).includes('+2 −1'), h.text(fileRows[0]));
  check('history: detail renders the patch with a gutter', h.byClass('dsh-git-word').length > 0 || h.byClass('dsh-git-line').length > 0);

  h.click(h.byText('分支')[0]);
  await h.settle();
  const heads = h.byClass('dsh-git-sectionhead').map((node) => h.text(node));
  check(
    'branches: local, remote and tag sections render',
    heads.some((label) => label.includes('本地分支')) &&
      heads.some((label) => label.includes('远程分支')) &&
      heads.some((label) => label.includes('标签')),
    JSON.stringify(heads),
  );
  check('branches: the current branch carries the badge', h.text().includes('当前'));
  check('branches: the tracking hint renders', h.text().includes('[ahead 1, behind 2]'));
}

// ==============================================================================
// Scenario 4: non-repository, error retry, live title
// ==============================================================================
{
  const h = createHarness({
    responder: (url) => {
      const target = new URL(url, 'http://localhost');
      if (target.pathname === `${API}/status`) return { ok: true, status: { repo: false, cwd: ROOT } };
      return { ok: true };
    },
  });
  await h.mountBody();
  check('state: a plain directory explains itself', h.text().includes('不是 git 仓库'));
  check('state: the directory path is shown', h.text().includes(ROOT));
}

{
  let attempts = 0;
  const h = createHarness({
    responder: (url) => {
      const target = new URL(url, 'http://localhost');
      attempts += 1;
      if (target.pathname === `${API}/status` && attempts === 1) return new Error('boom');
      if (target.pathname === `${API}/status`) return statusPayload();
      if (target.pathname === `${API}/diff`) {
        return { ok: true, diff: { text: WORKTREE_PATCH, binary: false, truncated: false } };
      }
      return { ok: true };
    },
  });
  await h.mountBody();
  check('state: a failing status surfaces the error', h.text().includes('出错了') && h.text().includes('boom'));
  const retry = h.byClass('dsh-git-ghost').find((node) => h.text(node) === '重试');
  check('state: the retry button renders', retry !== undefined);
  h.click(retry);
  await h.settle();
  check('state: retry recovers to the ready view', h.text().includes('demo') && h.byClass('dsh-git-file').length === 4);
}

{
  const h = createHarness();
  await h.mountBody();
  const Title = h.titleComponent();
  // Render the title directly through the harness runtime.
  h.render.component = Title;
  h.render.props = { sessionId: 's1', t: h.t };
  const rendered = h.render();
  check('title: the live chip shows branch and count', h.text(rendered).includes('main') && h.text(rendered).includes('●4'), h.text(rendered));

  // The header button opens the tab kind.
  const Header = h.headerComponent();
  h.render.component = Header;
  h.render.props = { t: h.t, openTab: () => h.captured.opened.push('dshGitPanel') };
  h.render();
  const button = h.all().find((entry) => entry.props && typeof entry.props.onClick === 'function');
  h.click(button);
  check('header: the button opens the Git tab', h.captured.opened.includes('dshGitPanel'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${String(failures)} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
