import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/auth-portal.js', import.meta.url), 'utf8');
// Inspection exists only in this offline VM, never in served production code.
const inspected = source.replace('window.TaswiqatAuthPortal =', 'window.offlineController = panel => instances.get(panel); window.TaswiqatAuthPortal =');
function harness(hash) {
  const location = { hash, pathname: '/', search: '' };
  const replacements = [];
  const makeNode = () => {
    const selectors = new Map();
    const node = {
      nodeType: 1, parentNode: null, dataset: {}, innerHTML: '', value: '', textContent: '',
      classList: { add() {}, remove() {} },
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, focus() {},
      after() {},
      querySelector(selector) {
        if (!selectors.has(selector)) selectors.set(selector, makeNode());
        return selectors.get(selector);
      },
      querySelectorAll() { return []; },
      replaceChildren(root) { this.child = root; root.parentNode = this; },
      remove() { if (this.parentNode) this.parentNode.child = null; this.parentNode = null; },
    };
    return node;
  };
  const window = {
    location,
    history: { replaceState(_state, _title, url) { replacements.push(url); location.hash = url.slice(url.indexOf('#')); } },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    TaswiqatAPI: { async authOptions() { return { manus: true, email: false, google: false, apple: false, registrationEnabled: true }; } },
  };
  const context = vm.createContext({ window, document: { createElement: makeNode }, URLSearchParams,
    fetch() { throw new Error('Network is forbidden in this offline test'); } });
  vm.runInContext(inspected, context, { filename: 'assets/auth-portal.js' });
  return { panel: makeNode(), window, replacements, portal: window.TaswiqatAuthPortal, state: panel => window.offlineController(panel) };
}

for (const view of ['verify', 'reset']) {
  test(`${view}: paired route mounts preserve the scrubbed proof only in memory`, async () => {
    const token = 'a'.repeat(43);
    const h = harness(`#auth/${view}?token=${token}`);
    const first = h.portal.mount(h.panel, { view });
    const state = h.state(h.panel); const root = h.panel.child;
    assert.equal(state.token, token);
    assert.equal(h.window.location.hash, `#auth/${view}`);
    h.portal.mount(h.panel, { view });
    assert.equal(h.state(h.panel), state);
    assert.equal(h.panel.child, root);
    assert.equal(state.token, token);
    assert.equal(h.replacements.length, 1);
    assert.ok(!root.innerHTML.includes(token));
    await new Promise(resolve => setImmediate(resolve));
    first.unmount();
    assert.equal(state.token, '');
    assert.equal(h.state(h.panel), undefined);
  });

  test(`${view}: a genuinely new proof remounts; an old handle cannot unmount it`, async () => {
    const h = harness(`#auth/${view}?token=${'a'.repeat(43)}`);
    h.portal.mount(h.panel, { view });
    const original = h.state(h.panel);
    const duplicate = h.portal.mount(h.panel, { view });
    h.window.location.hash = `#auth/${view}?token=${'b'.repeat(43)}`;
    h.portal.mount(h.panel, { view });
    const replacement = h.state(h.panel);
    assert.notEqual(replacement, original);
    assert.equal(original.token, '');
    assert.equal(original.disposed, true);
    assert.equal(replacement.token.length, 43);
    duplicate.unmount();
    assert.equal(h.state(h.panel), replacement);
    h.window.location.hash = '#auth/login';
    h.portal.mount(h.panel, { view: 'login' });
    assert.equal(replacement.token, '');
    assert.equal(replacement.disposed, true);
    h.portal.unmount();
    await new Promise(resolve => setImmediate(resolve));
  });
}
