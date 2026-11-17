import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../assets/client-api.js', import.meta.url), 'utf8');
function client(responder) {
  const calls = [], events = [];
  const window = { location: { origin: 'https://app.example' }, dispatchEvent: e => events.push(e.type) };
  const context = vm.createContext({ window, URL, Headers, AbortController, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({path, options});
      const {status = 200, data = {}} = responder(path, options);
      return {status, ok: status >= 200 && status < 300, json: async () => data};
    },
  });
  vm.runInContext(source, context);
  return { api: window.TaswiqatAPI, calls, events };
}
test('email requests use a pre-auth challenge and never borrow workspace authority', async () => {
  const c = client(path => path === '/api/auth/options'
    ? {data: {manus:true,email:true,google:false,apple:false,registrationEnabled:true,csrfToken:'offline-challenge'}}
    : {data:{ok:true,message:'accepted'}});
  await c.api.authEmail('register', {name:'offline test',email:'offline@example.invalid'});
  assert.deepEqual(c.calls.map(x => x.path), ['/api/auth/options','/api/auth/email/register']);
  const write = c.calls[1].options;
  assert.equal(write.headers.get('X-CSRF-Token'), 'offline-challenge');
  assert.equal(write.headers.get('X-Taswiqat-Origin'), 'https://app.example');
  assert.equal(write.credentials, 'same-origin');
  assert.deepEqual(c.events, []);
});
test('wrong email password does not expire a separate application session', async () => {
  const c = client(path => path === '/api/auth/options' ? {data:{csrfToken:'offline-challenge'}}
    : {status:401,data:{error:{code:'invalid_credentials',message:'بيانات الدخول غير صحيحة'}}});
  await assert.rejects(c.api.authEmail('login',{email:'offline@example.invalid',password:'not-a-real-password'}), /بيانات الدخول/);
  assert.deepEqual(c.events, []);
});
test('normal protected writes still require the existing authenticated session', async () => {
  const c = client(() => ({data:{authenticated:false}}));
  await assert.rejects(c.api.post('/api/workspaces',{}), /الجلسة/);
  assert.deepEqual(c.calls.map(x=>x.path), ['/api/session']);
  assert.deepEqual(c.events, ['taswiqat:session-expired']);
});
test('pre-auth cannot be used for arbitrary protected API writes', async () => {
  const c = client(() => ({data:{}}));
  await assert.rejects(c.api.request('/api/admin/state',{method:'PUT',preAuth:true,body:{}}), /مسار حساب/);
  await assert.rejects(c.api.authEmail('unsupported',{}), /مسار حساب/);
  assert.equal(c.calls.length, 0);
});
test('API rejects cross-origin requests and unimplemented account providers', async () => {
  const c = client(() => ({data:{csrfToken:'offline-challenge'}}));
  await assert.rejects(c.api.get('https://other.example/api/session'), /نفس الموقع/);
  await assert.rejects(c.api.authProviderStart('facebook'), /غير مدعومة/);
  await c.api.authProviderStart('google');
  assert.equal(c.calls[0].path, '/api/auth/options');
  assert.equal(c.calls[1].path, '/api/auth/google/start');
  assert.equal(c.calls[1].options.headers.get('X-CSRF-Token'), 'offline-challenge');
  assert.equal(c.calls[1].options.headers.get('X-Taswiqat-Origin'), 'https://app.example');
});
