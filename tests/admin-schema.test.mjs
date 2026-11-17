import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/admin.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('../backend/admin.mjs', import.meta.url), 'utf8');
const validation = await readFile(new URL('../backend/validation.mjs', import.meta.url), 'utf8');
const ids = {
  workspace: '11111111-1111-4111-8111-111111111111',
  user: '22222222-2222-4222-8222-222222222222',
  subscription: '33333333-3333-4333-8333-333333333333',
  ticket: '44444444-4444-4444-8444-444444444444',
};
const timestamps = { createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
const clone = value => JSON.parse(JSON.stringify(value));

// All fixtures, DOM and HTTP responses are confined to this VM. The unmodified
// production script boots with an unauthenticated session; no DB, network,
// deployed fixture or application/auth route is created or bypassed.
async function harness() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      innerHTML: '', textContent: '', hidden: false, disabled: false, readOnly: false,
      open: false, options: [{ textContent: '' }], dataset: {},
      classList: { toggle() {}, contains() { return false; } },
      setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() {},
      querySelector(selector) { return selector === ':scope > .notice' ? node('recordNotice') : null; },
      showModal() { this.open = true; }, close() { this.open = false; },
      reportValidity() { return true; },
    });
    return nodes.get(id);
  };
  const requests = [];
  const confirmations = [];
  let reply;
  class OfflineFormData extends Map {
    constructor(form) { super(Object.entries(form)); }
  }
  const context = vm.createContext({
    window: { location: { origin: 'https://offline.invalid', hash: '' } },
    document: { getElementById: node, querySelectorAll: () => [], body: node('body') },
    location: { hash: '' },
    FormData: OfflineFormData,
    AbortController, URL, URLSearchParams,
    setTimeout: () => 1, clearTimeout() {},
    confirm(message) { confirmations.push(message); return true; },
    async fetch(path, options) {
      requests.push({ path, options });
      if (path === '/api/session') return { ok: true, json: async () => ({ authenticated: false }) };
      assert.equal(path, '/api/admin/state', 'No other API may be used by this offline test');
      assert.equal(options.method, 'PUT');
      assert.ok(reply, 'An explicit canonical response is required');
      return { ok: true, json: async () => clone(reply) };
    },
  });
  vm.runInContext(source, context, { filename: 'assets/admin.js' });
  await new Promise(resolve => setImmediate(resolve));
  const run = code => vm.runInContext(code, context);
  const base = run('freshAdminState()');
  delete base.theme;
  base.settings = { theme: 'light' };
  base.connections = [];
  base.operations = [];
  function load(state = base, mode = 'server') {
    context.fixture = clone(state);
    context.fixtureMode = mode;
    run('adminMode = fixtureMode; adminState = fixture; adminSnapshot = 7; adminReady = true; adminStorageBlocked = false; adminSession = {csrfToken: "offline-only"};');
  }
  const validate = state => { context.candidate = clone(state); return run('validateAdminState(candidate)'); };
  return { node, requests, confirmations, run, base, load, validate, reply: value => { reply = value; } };
}

function populated(base) {
  const state = clone(base);
  state.workspaces.push({ id: ids.workspace, name: 'نشاط', businessType: '', ownerEmail: '', ownerId: ids.user, planId: 'basic', status: 'active', notes: '', ...timestamps });
  state.users.push({ id: ids.user, name: '', email: '', workspaceId: ids.workspace, role: 'user', status: 'archived', ...timestamps });
  state.subscriptions.push({ id: ids.subscription, workspaceId: ids.workspace, planId: 'basic', status: 'trial', startDate: '2026-11-01', endDate: '2026-11-15', notes: '', manual: true, ...timestamps });
  state.tickets.push({ id: ids.ticket, workspaceId: ids.workspace, userId: ids.user, title: 'تذكرة', description: 'وصف', priority: 'normal', assignee: '', status: 'open', ...timestamps });
  return state;
}
function fieldTag(html, name) {
  const tag = html.match(new RegExp(`<(?:input|textarea|select)\\b[^>]*\\bname="${name}"[^>]*>`));
  assert.ok(tag, `Missing field ${name}`);
  return tag[0];
}
function selectHtml(html, name) {
  const select = html.match(new RegExp(`<select\\b[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(select, `Missing select ${name}`);
  return select[1];
}

test('unmodified admin bootstrap stays fail-closed in the offline VM', async () => {
  const h = await harness();
  assert.equal(h.run('adminMode'), 'locked');
  assert.equal(h.run('adminReady'), false);
  assert.deepEqual(h.requests.map(item => item.path), ['/api/session']);
});

test('live accepts a 3001-character ticket and exact 240/10000 boundaries', async () => {
  const h = await harness();
  h.load();
  const state = populated(h.base);
  state.tickets[0].title = 'ع'.repeat(240);
  state.tickets[0].description = 'ت'.repeat(3001);
  assert.doesNotThrow(() => h.validate(state));
  state.tickets[0].description = 'ت'.repeat(10000);
  assert.doesNotThrow(() => h.validate(state));
  state.tickets[0].description += 'ت';
  assert.throws(() => h.validate(state), /عنوان التذكرة/);
  state.tickets[0].description = 'وصف';
  state.tickets[0].title += 'ع';
  assert.throws(() => h.validate(state), /عنوان التذكرة/);
  h.load(populated(h.base));
  h.run(`openAdminRecord('tickets', '${ids.ticket}')`);
  const html = h.node('adminDialogFields').innerHTML;
  assert.match(fieldTag(html, 'title'), /maxlength="240"/);
  assert.match(fieldTag(html, 'description'), /maxlength="10000"/);
  assert.equal(h.node('adminField_workspaceId').disabled, true);
  h.run("openAdminRecord('tickets')");
  assert.equal(h.node('adminField_workspaceId').required, true);
});

test('live site and plan validation and form limits match the backend', async () => {
  const h = await harness();
  h.load();
  const state = clone(h.base);
  Object.assign(state.site, { heroLine1: 'ع'.repeat(160), heroLine2: '', heroDescription: 'و'.repeat(2000), notice: 'ن'.repeat(2000) });
  Object.assign(state.plans[0], { name: 'ب'.repeat(160), price: 1000000, channels: 11, members: 100 });
  assert.doesNotThrow(() => h.validate(state));
  for (const [key, bad] of [['heroLine1', 'ع'.repeat(161)], ['heroLine2', 'ع'.repeat(161)], ['heroDescription', 'و'.repeat(2001)], ['notice', 'ن'.repeat(2001)]]) {
    const invalid = clone(state); invalid.site[key] = bad;
    assert.throws(() => h.validate(invalid), undefined, key);
  }
  for (const [key, bad] of [['name', 'ب'.repeat(161)], ['name', ''], ['price', 1000000.01], ['price', -1], ['channels', 0], ['channels', 12], ['channels', 1.5], ['members', 0], ['members', 101]]) {
    const invalid = clone(state); invalid.plans[0][key] = bad;
    assert.throws(() => h.validate(invalid), undefined, `${key}: ${bad}`);
  }
  const valid = clone(state);
  Object.assign(valid.plans[0], { channels: 1, members: 1, price: 199.999 });
  Object.assign(valid.site, { heroLine1: '', heroDescription: '', notice: '' });
  assert.doesNotThrow(() => h.validate(valid));
  const tooMany = clone(state);
  tooMany.plans = Array.from({ length: 21 }, (_, index) => ({ ...state.plans[0], id: `plan_${index}` }));
  assert.throws(() => h.validate(tooMany), /20/);
  h.run('renderAdminServerSite()');
  const siteForm = h.node('adminView').innerHTML;
  for (const [name, max] of [['heroLine1', 160], ['heroLine2', 160], ['heroDescription', 2000], ['notice', 2000]]) {
    assert.match(fieldTag(siteForm, name), new RegExp(`maxlength="${max}"`));
    assert.doesNotMatch(fieldTag(siteForm, name), /\brequired\b/);
  }
  h.run("openAdminRecord('plans', 'basic')");
  const planForm = h.node('adminDialogFields').innerHTML;
  assert.match(fieldTag(planForm, 'name'), /maxlength="160"/);
  assert.match(fieldTag(planForm, 'price'), /min="0" max="1000000" step="any"/);
  assert.match(fieldTag(planForm, 'channels'), /min="1" max="11" step="1"/);
  assert.match(fieldTag(planForm, 'members'), /min="1" max="100" step="1"/);
  // These checks make a backend contract change visible rather than silently drifting.
  assert.match(validation, /heroLine1: text\(160\), heroLine2: text\(160\), heroDescription: text\(2000\)/);
  assert.match(validation, /notice: text\(2000\)/);
  assert.match(backend, /title:str\(240\)\.min\(1\),description:str\(10000\)\.min\(1\)/);
  assert.match(backend, /price:z\.number\(\)\.finite\(\)\.min\(0\)\.max\(1000000\),channels:z\.number\(\)\.int\(\)\.min\(1\)\.max\(11\),members:z\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)/);
});

test('existing live admin/user opens with zero workspaces, optional name and immutable identity', async () => {
  const h = await harness();
  for (const [role, status] of [['admin', 'active'], ['user', 'archived']]) {
    const state = clone(h.base);
    state.users = [{ id: ids.user, name: '', email: '', workspaceId: '', role, status, ...timestamps }];
    h.load(state);
    assert.doesNotThrow(() => h.validate(state));
    h.run(`openAdminRecord('users', '${ids.user}')`);
    assert.equal(h.node('adminDialog').open, true);
    assert.equal(h.run('adminEditing.id'), ids.user);
    const html = h.node('adminDialogFields').innerHTML;
    assert.doesNotMatch(fieldTag(html, 'name'), /\brequired\b/);
    assert.doesNotMatch(fieldTag(html, 'email'), /\brequired\b/);
    const roles = selectHtml(html, 'role');
    assert.deepEqual([...roles.matchAll(/value="([^"]+)"/g)].map(match => match[1]), ['user', 'admin']);
    const statuses = selectHtml(html, 'status');
    assert.deepEqual([...statuses.matchAll(/value="([^"]+)"/g)].map(match => match[1]), ['active', 'suspended', 'archived']);
    assert.match(statuses, new RegExp(`value="${status}" selected`));
    for (const key of ['email', 'workspaceId', 'role']) assert.equal(h.node(`adminField_${key}`).disabled, true);
    if (role === 'admin') assert.equal(h.node('adminField_status').disabled, true);
    const read = h.run(`adminReadRecordForm('users', {name: '', email: 'changed@example.test', workspaceId: 'bad', role: 'owner', status: '${role === 'admin' ? 'archived' : status}'})`);
    assert.deepEqual(clone(read), { name: '', email: '', workspaceId: '', role, status });
    h.node('adminDialog').close();
    h.run("adminEditing = null; openAdminRecord('users')");
    assert.equal(h.node('adminDialog').open, false, 'Live creation is still prohibited');
  }
});

test('saving only a live user name keeps archived status and server identity', async () => {
  const h = await harness();
  const state = clone(h.base);
  state.users = [{ id: ids.user, name: '', email: '', workspaceId: '', role: 'user', status: 'archived', ...timestamps }];
  h.load(state);
  h.run(`openAdminRecord('users', '${ids.user}')`);
  Object.assign(h.node('adminRecordForm'), { name: 'اسم جديد', status: 'archived' });
  const canonical = clone(state); canonical.users[0].name = 'اسم جديد';
  h.reply({ state: canonical, version: 8 });
  await h.run('submitAdminRecord({preventDefault() {}})');
  const request = h.requests.find(item => item.options.method === 'PUT');
  assert.ok(request);
  const user = JSON.parse(request.options.body).state.users[0];
  assert.equal(user.name, 'اسم جديد');
  assert.equal(user.status, 'archived');
  assert.equal(user.role, 'user');
  assert.equal(user.email, '');
  assert.equal(user.workspaceId, '');
});

test('existing workspace ownerEmail stays readonly/optional/preserved; provisioning still requires it', async () => {
  const h = await harness();
  h.load(populated(h.base));
  h.run(`openAdminRecord('workspaces', '${ids.workspace}')`);
  const html = h.node('adminDialogFields').innerHTML;
  assert.doesNotMatch(fieldTag(html, 'ownerEmail'), /\brequired\b/);
  assert.doesNotMatch(fieldTag(html, 'businessType'), /\brequired\b/);
  assert.equal(h.node('adminField_ownerEmail').readOnly, true);
  const record = h.run("adminReadRecordForm('workspaces', {name: 'تعديل', businessType: '', ownerEmail: 'tampered@example.test', planId: 'basic', status: 'active', notes: ''})");
  assert.equal(record.ownerEmail, '');
  h.run("openAdminRecord('workspaces')");
  assert.match(fieldTag(h.node('adminDialogFields').innerHTML, 'ownerEmail'), /\brequired\b/);
});

test('live archive omits only the workspace, retains children and adopts canonical archive', async () => {
  const h = await harness();
  const before = populated(h.base);
  before.connections = [{ id: 'connection', workspaceId: ids.workspace, status: 'not_configured' }];
  before.operations = [{ id: 'planned', workspaceId: ids.workspace, published: false, dispatchEnabled: false }];
  h.load(before);
  const canonical = clone(before); canonical.workspaces[0].status = 'archived';
  h.reply({ state: canonical, version: 8 });
  await h.run(`deleteAdminRecord('workspaces', '${ids.workspace}')`);
  const request = h.requests.find(item => item.options.method === 'PUT');
  assert.ok(request, 'Related automatic subscription/users/tickets must not prevent server archive');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.version, 7);
  assert.equal(payload.state.workspaces.length, 0);
  for (const key of ['users', 'subscriptions', 'tickets', 'connections', 'operations', 'audit']) assert.deepEqual(payload.state[key], before[key], `Retain ${key} unchanged`);
  assert.equal(h.run('adminSnapshot'), 8);
  assert.deepEqual(clone(h.run('adminState')), canonical);
  assert.equal(h.confirmations.length, 1);
  assert.match(h.confirmations[0], /ليس حذفًا فعليًا/);
  assert.doesNotMatch(h.confirmations[0], /يُحفظ الحذف فعليًا/);
  // Actual backend source archives the omitted row and returns a fresh snapshot.
  assert.match(backend, /for \(const w of before\.workspaces\) if \(!next\.workspaces\.some\(n=>n\.id===w\.id\)\) await tx\.query\("UPDATE taswiqat_workspaces SET status='archived'/);
  assert.match(backend, /return adminSnapshot\(tx,tx\.version\+1\)/);
  assert.doesNotMatch(backend, /DELETE\s+FROM/i);
});

test('archive payload may reference original rows but canonical response cannot omit them', async () => {
  const h = await harness();
  const before = populated(h.base); h.load(before);
  const omitted = clone(before); omitted.workspaces = [];
  contextCandidate(h, omitted);
  assert.doesNotThrow(() => h.run('validateAdminState(candidate, adminState)'));
  assert.throws(() => h.run('validateAdminState(candidate)'), /مرتبط بنشاط غير موجود/);
  h.reply({ state: omitted, version: 8 });
  await assert.rejects(h.run('adminServerRepository.commit(candidate, 7)'), /مرتبط بنشاط غير موجود/);
  assert.equal(h.run('adminSnapshot'), 7);
  assert.deepEqual(clone(h.run('adminState')), before);
  const unknown = clone(omitted); unknown.tickets[0].workspaceId = '55555555-5555-4555-8555-555555555555';
  contextCandidate(h, unknown);
  assert.throws(() => h.run('validateAdminState(candidate, adminState)'), /مرتبط بنشاط غير موجود/);
});
function contextCandidate(h, state) { h.run(`globalThis.candidate = ${JSON.stringify(state)}`); }

test('live messages describe server actions/quotas while demo keeps old limits and guards', async () => {
  const h = await harness(); h.load(populated(h.base));
  h.run("renderAdminRecordSection('workspaces')");
  assert.match(h.node('recordNotice').textContent, /الأرشفة لا تحذف/);
  assert.doesNotMatch(h.node('adminRecordResults').innerHTML, /جميع الإجراءات محلية|سجلات للمعاينة/);
  h.run('renderAdminServerPlans()');
  assert.match(h.node('adminView').innerHTML, /حصص يفرضها الخادم/);
  assert.doesNotMatch(h.node('adminView').innerHTML, /ليست رسومًا محصّلة أو حصصًا مفروضة|لا يفرض حدودًا فعلية/);
  assert.match(h.node('adminView').innerHTML, /لا رسوم محصّلة ولا دفع أو تكامل مفعّل/);
  h.load(h.base); h.run("renderAdminRecordSection('users')");
  assert.doesNotMatch(h.node('adminRecordResults').innerHTML, /اللوحة غير المحمية|تجريبي/);

  const demo = clone(h.run('freshAdminState()'));
  const populatedDemo = populated(h.base);
  for (const key of ['workspaces', 'users', 'subscriptions', 'tickets']) demo[key] = populatedDemo[key];
  Object.assign(demo.workspaces[0], { businessType: 'تجارة', ownerEmail: 'owner@example.test' });
  Object.assign(demo.users[0], { name: 'مستخدم', email: 'user@example.test', role: 'editor', status: 'active' });
  h.load(demo, 'demo');
  assert.doesNotThrow(() => h.validate(demo));
  demo.tickets[0].description = 'ت'.repeat(3001);
  assert.throws(() => h.validate(demo), /عنوان التذكرة/);
  demo.tickets[0].description = 'وصف'; demo.tickets[0].title = 'ع'.repeat(181);
  assert.throws(() => h.validate(demo), /عنوان التذكرة/);
  h.run(`openAdminRecord('tickets', '${ids.ticket}')`);
  assert.match(fieldTag(h.node('adminDialogFields').innerHTML, 'title'), /maxlength="180"/);
  assert.match(fieldTag(h.node('adminDialogFields').innerHTML, 'description'), /maxlength="3000"/);
  h.node('adminDialog').close();
  await h.run(`deleteAdminRecord('workspaces', '${ids.workspace}')`);
  assert.equal(h.requests.filter(item => item.options.method === 'PUT').length, 0);
  assert.match(h.node('adminToast').textContent, /لا يمكن حذف النشاط/);
  h.run("adminState.workspaces = []; adminEditing = null; openAdminRecord('users')");
  assert.equal(h.node('adminDialog').open, false, 'Demo still requires a workspace');
  assert.deepEqual(clone(h.run("adminStatusOptions('users')")).map(item => item[0]), ['active', 'inactive']);
});

test('unified system settings render backend bounds and explicit operational scope', async () => {
  const h = await harness();
  const state = clone(h.base);
  state.settings = { theme: 'dark', registrationEnabled: false, trialDays: 21, supportHours: '<script>offline</script>' };
  h.load(state); h.run('renderAdminServerSettings()');
  const html = h.node('adminView').innerHTML;
  assert.match(fieldTag(html, 'trialDays'), /min="1" max="90" step="1"/);
  assert.match(fieldTag(html, 'supportHours'), /maxlength="500"/);
  assert.match(selectHtml(html, 'registrationEnabled'), /value="false" selected/);
  assert.match(html, /&lt;script&gt;offline&lt;\/script&gt;/);
  assert.match(html, /لا تغيّر نهاية الاشتراكات الحالية/);
  assert.match(html, /إيقاف التسجيل يمنع إنشاء حسابات جديدة/);
  assert.equal(h.run('adminSiteSnapshot'), 7);
  assert.equal(h.run('adminSiteDirty'), false);
  assert.match(backend, /trialDays:z\.number\(\)\.int\(\)\.min\(1\)\.max\(90\)/);
});

test('unified settings save uses version/CSRF and preserves all other collections and theme', async () => {
  const h = await harness(); const before = populated(h.base);
  before.settings = { theme: 'dark', registrationEnabled: true, trialDays: 14, supportHours: 'قبل' };
  h.load(before); h.run('renderAdminServerSettings(); adminSiteDirty = true;');
  Object.assign(h.node('adminSystemSettingsForm'), { registrationEnabled: 'false', trialDays: '30', supportHours: ' بعد ' });
  const canonical = clone(before);
  Object.assign(canonical.settings, { registrationEnabled: false, trialDays: 30, supportHours: 'بعد' });
  h.reply({ state: canonical, version: 8 });
  await h.run('saveAdminSystemSettings({preventDefault(){}})');
  const request = h.requests.find(item => item.options.method === 'PUT');
  assert.ok(request); const payload = JSON.parse(request.options.body);
  assert.equal(payload.version, 7);
  assert.equal(request.options.headers['X-CSRF-Token'], 'offline-only');
  assert.deepEqual(payload.state.settings, canonical.settings);
  for (const key of Object.keys(before).filter(key => key !== 'settings')) assert.deepEqual(payload.state[key], before[key], key);
  assert.equal(h.run('adminSiteSnapshot'), 8);
  assert.equal(h.run('adminSiteDirty'), false);
});

test('invalid system settings and stale forms never write or discard unsaved input', async () => {
  const h = await harness(); h.load(); h.run('renderAdminServerSettings(); adminSiteDirty = true;');
  for (const fields of [
    { registrationEnabled: 'false', trialDays: '0' },
    { registrationEnabled: 'false', trialDays: '91' },
    { registrationEnabled: 'false', trialDays: '1.5' },
    { registrationEnabled: 'unknown', trialDays: '14' },
    { registrationEnabled: 'true', trialDays: '14', supportHours: 'ع'.repeat(501) },
  ]) {
    Object.assign(h.node('adminSystemSettingsForm'), { supportHours: '', ...fields });
    await h.run('saveAdminSystemSettings({preventDefault(){}})');
    assert.equal(h.requests.filter(item => item.options.method === 'PUT').length, 0);
    assert.equal(h.run('adminSiteDirty'), true);
  }
  Object.assign(h.node('adminSystemSettingsForm'), { registrationEnabled: 'true', trialDays: '14', supportHours: '' });
  h.run('adminSnapshot = 8;');
  await h.run('saveAdminSystemSettings({preventDefault(){}})');
  assert.equal(h.requests.filter(item => item.options.method === 'PUT').length, 0);
  assert.equal(h.run('adminSiteDirty'), true);
  assert.equal(h.run('adminSiteSnapshot'), 7);
});
