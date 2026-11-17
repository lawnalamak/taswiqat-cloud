import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { jwtVerify } from 'jose';
import { createApp } from '../backend/app.mjs';
import { digest } from '../backend/validation.mjs';

const env = {
  MANUS_JWT_SECRET: 'offline-native-entry-test-key-never-production',
  MANUS_PROJECT_ID: 'offline-native-entry-app',
  MANUS_OAUTH_PORTAL_URL: 'https://portal.example.invalid',
  MANUS_OAUTH_API_URL: 'https://rpc.example.invalid',
};
const origin = 'https://taswiqat.manus.space';
async function withServer(overrides, fn) {
  const queries = [];
  const db = { query: async (sql, args) => {
    queries.push({ sql, args });
    if (sql.startsWith('INSERT INTO taswiqat_oauth_nonces')) return { affectedRows: 1 };
    if (sql.startsWith('UPDATE taswiqat_oauth_nonces')) return { affectedRows: 0 };
    throw new Error('Unexpected offline query');
  } };
  const server = createApp({ db, env: { ...env, ...overrides } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, options = {}) => fetch(base + path, { ...options, redirect: 'manual' });
  try { return await fn({ get, queries }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function portalURL(response) {
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get('location'));
  assert.equal(url.origin, env.MANUS_OAUTH_PORTAL_URL);
  assert.equal(url.pathname, '/app-auth');
  assert.equal(url.searchParams.get('appId'), env.MANUS_PROJECT_ID);
  assert.equal(url.searchParams.get('responseType'), 'code');
  return url;
}
async function boundState(response, url, overrides = {}) {
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^taswiqat_oauth_state=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Max-Age=600/);
  const pair = cookie.split(';')[0];
  const signed = pair.slice('taswiqat_oauth_state='.length);
  const { payload } = await jwtVerify(signed, new TextEncoder().encode(overrides.MANUS_JWT_SECRET || env.MANUS_JWT_SECRET), { algorithms: ['HS256'] });
  const state = JSON.parse(Buffer.from(url.searchParams.get('state'), 'base64').toString());
  assert.equal(payload.kind, 'oauth_state');
  assert.equal(payload.appId, env.MANUS_PROJECT_ID);
  assert.equal(payload.nonce, state.nonce);
  assert.match(state.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(payload.redirectUri, state.redirectUri);
  assert.equal(payload.exp - payload.iat, 600);
  return { payload, state, pair };
}

test('public HTML login link reaches server OAuth without executing any browser JavaScript', async () => {
  const fragment = await readFile(new URL('../landing.fragment.html', import.meta.url), 'utf8');
  const anchor = fragment.match(/<a\b[^>]*href="\/api\/auth\/login"[^>]*>\s*تسجيل الدخول\s*<\/a>/);
  assert.ok(anchor, 'Login must be an actual navigable anchor, not a JS-only button/hash');
  assert.doesNotMatch(anchor[0], /onclick|javascript:/i);
  await withServer({}, async ({ get, queries }) => {
    const html = await get('/');
    assert.equal(html.status, 200);
    assert.ok((await html.text()).includes(anchor[0]), 'Generated and served HTML must contain the same native entry');
    const relay = await get('/api/auth/login');
    assert.equal(relay.status, 302);
    assert.equal(relay.headers.get('location'), `${origin}/api/auth/login/start?target=app`);
    assert.equal(relay.headers.get('set-cookie'), null, 'Bind the state only after reaching its callback origin');
    assert.equal(queries.length, 0);
    const destination = new URL(relay.headers.get('location'));
    const started = await get(destination.pathname + destination.search);
    const url = portalURL(started);
    assert.equal(url.searchParams.get('redirectUri'), `${origin}/api/auth/callback`);
    const { payload, state } = await boundState(started, url);
    assert.equal(payload.origin, origin);
    assert.equal(payload.target, 'app');
    assert.equal(queries.length, 1);
    assert.equal(queries[0].args[0], digest(state.nonce));
    assert.doesNotMatch(started.headers.get('set-cookie'), /webdev_app_session=/, 'Starting entry must not invent a login session');
  });
});

test('native entry ignores caller origin/next and forwarded hosts; configured HTTPS origin is fixed', async () => {
  const fixed = 'https://accounts.example.invalid';
  await withServer({ TASWIQAT_AUTH_ORIGIN: fixed, TASWIQAT_TRUST_PROXY: 'true' }, async ({ get }) => {
    const attack = '?origin=https://attacker.example.invalid&next=https://attacker.example.invalid&target=admin';
    const headers = { Host: 'attacker.example.invalid', 'X-Forwarded-Host': 'attacker.example.invalid', 'X-Forwarded-Proto': 'https' };
    const relay = await get('/api/auth/login' + attack, { headers });
    assert.equal(relay.headers.get('location'), `${fixed}/api/auth/login/start?target=admin`);
    const started = await get('/api/auth/login/start' + attack, { headers });
    const url = portalURL(started);
    assert.equal(url.searchParams.get('redirectUri'), `${fixed}/api/auth/callback`);
    const { payload } = await boundState(started, url);
    assert.equal(payload.origin, fixed);
    assert.equal(payload.target, 'admin');
    assert.equal(started.headers.get('referrer-policy'), 'no-referrer');
    assert.match(started.headers.get('cache-control'), /no-store/);
  });
});

test('native entry rejects invalid target and unsafe configured origin before a nonce or cookie', async () => {
  await withServer({}, async ({ get, queries }) => {
    for (const path of ['/api/auth/login', '/api/auth/login/start']) {
      for (const target of ['https://attacker.example.invalid', '', 'app&target=admin']) {
        const response = await get(`${path}?target=${encodeURIComponent(target)}`);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, 'invalid_target');
        assert.equal(response.headers.get('location'), null);
        assert.equal(response.headers.get('set-cookie'), null);
      }
    }
    assert.equal(queries.length, 0);
  });
  await withServer({ TASWIQAT_AUTH_ORIGIN: 'http://attacker.example.invalid', TASWIQAT_ALLOW_LOCALHOST: 'true' }, async ({ get, queries }) => {
    for (const path of ['/api/auth/login', '/api/auth/login/start']) {
      const response = await get(path);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'invalid_origin');
    }
    assert.equal(queries.length, 0);
  });
});

test('native entry fails closed when platform credentials are not configured', async () => {
  await withServer({ MANUS_JWT_SECRET: '' }, async ({ get, queries }) => {
    for (const path of ['/api/auth/login', '/api/auth/login/start']) {
      const response = await get(path);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'auth_not_configured');
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal(queries.length, 0);
  });
});

test('native attempts remain bound to the browser and reject state substitution and consumed nonce', async () => {
  await withServer({}, async ({ get, queries }) => {
    const started = await get('/api/auth/login/start');
    const url = portalURL(started);
    const { state, pair } = await boundState(started, url);
    const path = `/api/auth/callback?code=offline-code&state=${encodeURIComponent(url.searchParams.get('state'))}`;
    const noCookie = await get(path);
    assert.equal(noCookie.status, 400);
    assert.equal((await noCookie.json()).error.code, 'oauth_state_invalid');
    const substituted = Buffer.from(JSON.stringify({ ...state, nonce: 'forged-offline-nonce' })).toString('base64');
    const forged = await get(`/api/auth/callback?code=offline-code&state=${encodeURIComponent(substituted)}`, { headers: { Cookie: pair } });
    assert.equal(forged.status, 400);
    assert.equal((await forged.json()).error.code, 'oauth_state_invalid');
    assert.equal(queries.length, 1, 'Invalid binding must not consume a nonce or contact the provider');
    const consumed = await get(path, { headers: { Cookie: pair } });
    assert.equal(consumed.status, 400);
    assert.equal((await consumed.json()).error.code, 'oauth_state_used');
    assert.equal(queries.length, 2);
    assert.match(queries[1].sql, /used=FALSE AND expires_at>UTC_TIMESTAMP/);
    assert.equal(queries[1].args[0], digest(state.nonce));
  });
});

test('legacy JSON auth-start contract and HTTPS browser binding remain compatible', async () => {
  await withServer({}, async ({ get, queries }) => {
    const browserOrigin = 'https://preview.example.invalid';
    const response = await get(`/api/auth/start?origin=${encodeURIComponent(browserOrigin)}&target=app`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['url']);
    const url = new URL(body.url);
    const { payload } = await boundState(response, url);
    assert.equal(payload.origin, browserOrigin);
    assert.equal(payload.redirectUri, `${browserOrigin}/api/auth/callback`);
    assert.equal(queries.length, 1);
  });
});
