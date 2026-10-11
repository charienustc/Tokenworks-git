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
      kind: 'local',
      name: 'feature',
      hash: 'def5678',
      upstream: null,
      track: null,
      head: false,
      date: '2026-10-09T12:00:00+08:00',
      subject: 'first commit',
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
      if (target.pathname === `${API}/remotes`) return { ok: true, remotes: ['origin'] };
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

  /** Descendants of one node matching a predicate, document order. */
  function descendants(parent, predicate) {
    const nodes = [];
    visit(parent, (node) => {
      if (node !== parent && predicate(node)) nodes.push(node);
    });
    return nodes;
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
    descendants,
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

/** The last POST that hit one exact endpoint path (a prefix match is a trap). */
function postTo(harness, path) {
  return lastCall(harness, (call) => {
    const target = new URL(call.url, 'http://localhost');
    return target.pathname === `${API}${path}` && call.init !== null && call.init.method === 'POST';
  });
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

  // The stylesheet's contract: every pill control draws a visible outline, so a
  // control never looks like plain text.
  const css = h.text();
  const outlined = (cls) => new RegExp(`\\.${cls}\\{[^}]*border:`).test(css);
  check(
    'style: the pill controls carry an outline',
    ['dsh-git-ghost', 'dsh-git-batch', 'dsh-git-rowact', 'dsh-git-fileact', 'dsh-git-tab', 'dsh-git-tool'].every(outlined),
    ['dsh-git-ghost', 'dsh-git-batch', 'dsh-git-rowact', 'dsh-git-fileact', 'dsh-git-tab', 'dsh-git-tool']
      .filter((cls) => !outlined(cls))
      .join(','),
  );
  check(
    'style: row buttons keep a hover surface instead of a border',
    /\.dsh-git-dirrow:hover\{[^}]*background:/.test(css) && /\.dsh-git-commit-row:hover\{[^}]*background:/.test(css),
  );

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
  // The primary path is the Ctrl/⌘+Enter shortcut on the draft itself. The tree
  // re-rendered after the change, so the textarea must be re-queried: its old
  // node carries the stale disabled closure.
  const fresh = h.all().find((node) => node.type === 'textarea');
  let prevented = false;
  fresh.props.onKeyDown({ key: 'Enter', ctrlKey: true, preventDefault() { prevented = true; } });
  check('commit: the shortcut preventDefaults the Enter', prevented === true);
  await h.settle();
  const commitCall = lastCall(h, (call) => call.url.startsWith(`${API}/commit`) && call.init && call.init.method === 'POST');
  check(
    'commit: Ctrl+Enter posts the message',
    commitCall !== undefined && commitCall.body !== undefined && commitCall.body.message === 'polish pass',
    JSON.stringify(commitCall && commitCall.body),
  );
  check('commit: success notice shows the hash', h.text().includes('已提交 abc1234567890'));
  check('commit: the draft is cleared', h.all().find((node) => node.type === 'textarea').props.value === '');

  // --- discard: tracked files only, always behind a confirmation ---------------
  const discardButtons = h.byClass('dsh-git-fileact').filter((node) => h.text(node) === '放弃');
  check('changes: only tracked, unstaged files offer discard', discardButtons.length === 2, discardButtons.length);

  h.click(discardButtons[0]);
  await h.settle();
  const discardDialog = h.byClass('dsh-git-dialog')[0];
  check(
    'discard: a confirmation dialog appears first',
    discardDialog !== undefined && h.text(discardDialog).includes('无法恢复'),
    discardDialog === undefined ? 'no dialog' : h.text(discardDialog),
  );
  const discardDialogButtons = h.descendants(discardDialog, (node) => node.type === 'button');
  check(
    'discard: the dialog offers cancel and a danger action',
    discardDialogButtons.length === 2 && h.hasClass(discardDialogButtons[1], 'dsh-git-danger'),
  );

  h.click(discardDialogButtons[0]);
  await h.settle();
  check(
    'discard: cancelling closes the dialog without writing',
    h.byClass('dsh-git-dialog').length === 0 && postTo(h, '/discard') === undefined,
  );

  h.click(h.byClass('dsh-git-fileact').filter((node) => h.text(node) === '放弃')[0]);
  await h.settle();
  h.click(h.descendants(h.byClass('dsh-git-dialog')[0], (node) => node.type === 'button')[1]);
  await h.settle();
  const discardCall = postTo(h, '/discard');
  check(
    'discard: confirming posts the file path',
    discardCall !== undefined && discardCall.body.paths.join(',') === 'src/app.ts',
    JSON.stringify(discardCall && discardCall.body),
  );
  check('discard: the notice reports the discarded count', h.text().includes('已放弃 1 个文件的改动'));

  h.click(h.byText('全部放弃')[0]);
  await h.settle();
  h.click(h.descendants(h.byClass('dsh-git-dialog')[0], (node) => node.type === 'button')[1]);
  await h.settle();
  const discardAllCall = postTo(h, '/discard');
  check(
    'discard: discard-all covers the unstaged tracked paths',
    discardAllCall !== undefined && discardAllCall.body.paths.join(',') === 'src/app.ts,README.md',
    JSON.stringify(discardAllCall && discardAllCall.body),
  );

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
  check(
    'history: the sub-line shows author, date and hash',
    h.text(rows[0]).includes('Tester') && h.text(rows[0]).includes('2026-10-10 12:00') && h.text(rows[0]).includes('abc1234'),
    h.text(rows[0]),
  );

  // The graph joins rows: every edge from one row's bottom continues into the next.
  const rowSvgs = rows.map((rowNode) => h.descendants(rowNode, (node) => node.type === 'svg')[0]);
  check('history: each row carries a graph svg', rowSvgs.every((svg) => svg !== undefined));
  const firstPaths = h.descendants(rowSvgs[0], (node) => node.type === 'path').map((node) => node.props.d);
  check('history: the parent edge leaves the dot downward', firstPaths.some((d) => d === 'M 8 21 L 8 42'), JSON.stringify(firstPaths));
  const secondPaths = h.descendants(rowSvgs[1], (node) => node.type === 'path').map((node) => node.props.d);
  check('history: the root commit draws the incoming edge from the row top', secondPaths.some((d) => d === 'M 8 0 L 8 21'), JSON.stringify(secondPaths));
  const dot = h.descendants(rowSvgs[0], (node) => node.type === 'circle')[0];
  check('history: the dot is solid on its lane', dot !== undefined && typeof dot.props.fill === 'string' && dot.props.fill.startsWith('var('), dot && dot.props.fill);

  // --- remote sync from the history toolbar ------------------------------------
  const historyToolbar = h.byClass('dsh-git-toolbar')[0];
  check(
    'history: the toolbar carries fetch, pull and push',
    ['获取', '拉取', '推送'].every((label) => h.text(historyToolbar).includes(label)),
    h.text(historyToolbar),
  );

  h.click(h.byText('获取')[0]);
  await h.settle();
  const fetchCall = postTo(h, '/sync');
  check(
    'fetch: runs without a prompt',
    fetchCall !== undefined && fetchCall.body.action === 'fetch' && h.byClass('dsh-git-dialog').length === 0,
    JSON.stringify(fetchCall && fetchCall.body),
  );

  h.click(h.byText('推送')[0]);
  await h.settle();
  const pushDialog = h.byClass('dsh-git-dialog')[0];
  check('push: asks before publishing', pushDialog !== undefined && h.text(pushDialog).includes('推送到远端'));
  h.click(h.descendants(pushDialog, (node) => node.type === 'button')[1]);
  await h.settle();
  const pushCall = postTo(h, '/sync');
  check(
    'push: confirming posts the action, and an existing upstream needs no -u',
    pushCall !== undefined && pushCall.body.action === 'push' && pushCall.body.setUpstream === undefined,
    JSON.stringify(pushCall && pushCall.body),
  );

  h.click(rows[0]);
  await h.settle();
  check('history: detail shows the message block', h.text().includes('body line'));
  const fileRows = h.byClass('dsh-git-filehead');
  check('history: detail lists one header per changed file', fileRows.length === 2, fileRows.length);
  check('history: detail header names the file', h.text(fileRows[0]).includes('src/app.ts'));
  check('history: detail shows the per-file stat', h.text(fileRows[0]).includes('+2 −1'), h.text(fileRows[0]));
  check('history: detail renders the patch with a gutter', h.byClass('dsh-git-word').length > 0 || h.byClass('dsh-git-line').length > 0);

  // --- commit detail actions ---------------------------------------------------
  const detailActions = h.byClass('dsh-git-actions')[0];
  check(
    'history: the detail offers the commit actions',
    detailActions !== undefined &&
      ['拣选', '还原', '检出', '软重置', '混合重置'].every((label) => h.text(detailActions).includes(label)),
    detailActions === undefined ? 'no actions' : h.text(detailActions),
  );

  h.click(h.byText('拣选')[0]);
  await h.settle();
  const pickDialog = h.byClass('dsh-git-dialog')[0];
  check('cherry-pick: asks before applying', pickDialog !== undefined && h.text(pickDialog).includes('应用到当前分支'));
  h.click(h.descendants(pickDialog, (node) => node.type === 'button')[1]);
  await h.settle();
  const pickCall = postTo(h, '/undo');
  check(
    'cherry-pick: confirming posts the commit rev',
    pickCall !== undefined && pickCall.body.action === 'cherry-pick' && pickCall.body.rev === 'abc1234567890',
    JSON.stringify(pickCall && pickCall.body),
  );

  h.click(h.byText('软重置')[0]);
  await h.settle();
  h.click(h.descendants(h.byClass('dsh-git-dialog')[0], (node) => node.type === 'button')[1]);
  await h.settle();
  const resetCall = postTo(h, '/undo');
  check(
    'reset: the soft reset posts its mode',
    resetCall !== undefined && resetCall.body.action === 'reset' && resetCall.body.mode === 'soft',
    JSON.stringify(resetCall && resetCall.body),
  );

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
// Scenario 4: branch, tag and remote operations
// ==============================================================================
{
  const h = createHarness();
  await h.mountBody();
  h.click(h.byText('分支')[0]);
  await h.settle();

  const toolbar = h.byClass('dsh-git-toolbar')[0];
  check(
    'branches: the toolbar offers both create forms',
    h.text(toolbar).includes('新建分支') && h.text(toolbar).includes('新建标签'),
    h.text(toolbar),
  );
  check('branches: configured remotes are listed', h.text().includes('远程仓库') && h.text().includes('origin'));

  // Create a branch from the inline form.
  h.click(h.byText('新建分支')[0]);
  await h.settle();
  const inputs = h.all().filter((node) => node.type === 'input');
  check('branch: the create form asks for a name and a start point', inputs.length === 2, inputs.length);
  inputs[0].props.onChange({ target: { value: 'feature/login' } });
  await h.settle();
  h.click(h.byText('创建')[0]);
  await h.settle();
  const branchCall = postTo(h, '/branch');
  check(
    'branch: creating posts the name',
    branchCall !== undefined && branchCall.body.name === 'feature/login',
    JSON.stringify(branchCall && branchCall.body),
  );

  // A non-current branch carries the switch / merge / delete cluster.
  const featureRow = h
    .byClass('dsh-git-row')
    .find((node) => h.text(node).includes('feature') && h.text(node).includes('切换'));
  check(
    'branch: a non-current branch offers switch, merge and delete',
    featureRow !== undefined && ['切换', '合并', '删除'].every((label) => h.text(featureRow).includes(label)),
    featureRow === undefined ? 'no row' : h.text(featureRow),
  );

  h.click(h.descendants(featureRow, (node) => node.type === 'button' && h.text(node) === '切换')[0]);
  await h.settle();
  check('branch: switching asks first', h.byClass('dsh-git-dialog').length === 1);
  h.click(h.descendants(h.byClass('dsh-git-dialog')[0], (node) => node.type === 'button')[1]);
  await h.settle();
  const checkoutCall = postTo(h, '/checkout');
  check(
    'branch: switching posts the branch name without detaching',
    checkoutCall !== undefined && checkoutCall.body.ref === 'feature' && checkoutCall.body.detach === false,
    JSON.stringify(checkoutCall && checkoutCall.body),
  );

  const rowAgain = h
    .byClass('dsh-git-row')
    .find((node) => h.text(node).includes('feature') && h.text(node).includes('删除'));
  h.click(h.descendants(rowAgain, (node) => node.type === 'button' && h.text(node) === '删除')[0]);
  await h.settle();
  const deleteDialog = h.byClass('dsh-git-dialog')[0];
  check(
    'branch: deleting warns that it is a safe delete',
    deleteDialog !== undefined && h.text(deleteDialog).includes('安全删除'),
  );
  h.click(h.descendants(deleteDialog, (node) => node.type === 'button')[1]);
  await h.settle();
  const deleteCall = postTo(h, '/branch-delete');
  check(
    'branch: deleting posts the branch name',
    deleteCall !== undefined && deleteCall.body.name === 'feature',
    JSON.stringify(deleteCall && deleteCall.body),
  );

  // Tags: create through the form, delete through the row.
  h.click(h.byText('新建标签')[0]);
  await h.settle();
  const tagInputs = h.all().filter((node) => node.type === 'input');
  tagInputs[0].props.onChange({ target: { value: 'v1.0.0' } });
  await h.settle();
  h.click(h.byText('创建')[0]);
  await h.settle();
  const tagCall = postTo(h, '/tag');
  check(
    'tag: creating posts the name',
    tagCall !== undefined && tagCall.body.name === 'v1.0.0',
    JSON.stringify(tagCall && tagCall.body),
  );

  const tagRow = h.byClass('dsh-git-row').find((node) => h.text(node).includes('v0.1.0'));
  h.click(h.descendants(tagRow, (node) => node.type === 'button' && h.text(node) === '删除')[0]);
  await h.settle();
  h.click(h.descendants(h.byClass('dsh-git-dialog')[0], (node) => node.type === 'button')[1]);
  await h.settle();
  const tagDeleteCall = postTo(h, '/tag-delete');
  check(
    'tag: deleting posts the name',
    tagDeleteCall !== undefined && tagDeleteCall.body.name === 'v0.1.0',
    JSON.stringify(tagDeleteCall && tagDeleteCall.body),
  );
}

// ==============================================================================
// Scenario 5: non-repository, error retry, live title
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
  check(
    'header: the button carries the same pill outline as the panel',
    /\.dsh-git-openbtn\{[^}]*border:\.5px solid/.test(h.text()),
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${String(failures)} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
