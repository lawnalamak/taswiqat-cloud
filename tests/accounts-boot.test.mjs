import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('../assets/app.js', import.meta.url), 'utf8');
const portal = await readFile(new URL('../assets/auth-portal.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Source section missing: ${start}`);
  return app.slice(a, b);
}
const inspectedPortal = portal.replace('window.TaswiqatAuthPortal =', 'window.offlineController = panel => instances.get(panel); window.TaswiqatAuthPortal =');
const bootSource = [
  section('function primeAuthOptions()', 'function openAuth('),
  section('function showSessionPanel(', 'async function refreshSession('),
  section('async function refreshSession(', 'async function ensureWorkspace('),
  section('function initializeCustomerApp()', 'window.addEventListener("hashchange"'),
].join('\n');
const capabilities = {manus:true,email:false,google:false,apple:false,registrationEnabled:true,csrfToken:'offline-proof-not-for-ui'};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(hash = '#auth/login') {
  const calls = [], session = deferred(), options = deferred();
  function node() {
    const selectors = new Map();
    return {
      nodeType:1, parentNode:null, hidden:false, dataset:{}, innerHTML:'', textContent:'', value:'',
      classList:{add(){},remove(){},toggle(){}},
      addEventListener(){},removeEventListener(){},setAttribute(){},focus(){},
      after(other){this.afterNode=other;},
      querySelector(selector) { if (!selectors.has(selector)) selectors.set(selector, node()); return selectors.get(selector); },
      querySelectorAll(){return [];},
      replaceChildren(root) { this.child = root; root.parentNode = this; },
      remove() { if (this.parentNode) this.parentNode.child = null; this.parentNode = null; },
    };
  }
  const nodes = Object.fromEntries(['appView','sessionPanel','landingView','sessionView'].map(id => [id,node()]));
  const location = new URL(`https://taswiqat.manus.space/${hash}`);
  const storage = {getItem(){return null;},removeItem(){},setItem(){}};
  const window = {
    location, history:{replaceState(){},pushState(){}}, requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    TaswiqatAPI:{
      session() { calls.push('session'); return session.promise; },
      authOptions() { calls.push('options'); return calls.filter(x=>x==='options').length === 1 ? options.promise : Promise.resolve({...capabilities}); },
    },
  };
  const context = vm.createContext({
    window, location, history:window.history, localStorage:storage, sessionStorage:storage,
    URL, URLSearchParams, document:{createElement:node,querySelectorAll:()=>[],querySelector:()=>null,body:node()},
    $:id=>nodes[id] || null, e:value=>String(value ?? ''), toggleMenu(){}, pendingInvite:()=>'',
    captureInvite(){}, remoteAppURL:()=>null, clearPrivateState(){}, activeWorkspaces:()=>[],
    startLogin(){},finishAccountLogin(){},showLanding(){},startDemo(){},openAuth(){},
    render(){},guardLeave(){},isManager:()=>false,switchWorkspace(){},
    fetch(){throw new Error('Network forbidden in offline boot tests');},
  });
  vm.runInContext(`let sessionInfo=null, sessionStatus='loading', sessionError='', mode='live', requestedView='overview', authView='login', setupAfterLogin=false, bootPromise, initialAuthOptions=null, youtubeReturnIntent=null;
    const api=()=>window.TaswiqatAPI;
    const authRouteView=()=>location.hash.match(/^#auth\\/(login|register|forgot|reset|verify)/)?.[1] || '';
    async function restoreRoute(){ showSessionPanel(); }
    async function startSetup(){}
  `, context);
  vm.runInContext(inspectedPortal, context);
  vm.runInContext(bootSource, context);
  vm.runInContext('initializeCustomerApp()', context);
  return {
    calls,session,options,window,nodes,context,
    state:()=>window.offlineController(nodes.sessionPanel),
    status:()=>vm.runInContext('sessionStatus',context),
    prefetched:()=>vm.runInContext('initialAuthOptions',context),
  };
}
for (const hash of ['#auth/login','#app']) {
  test(`${hash}: session and login options start together; confirmed options are consumed once`, async () => {
    const h = harness(hash);
    assert.deepEqual(h.calls, ['session','options']);
    assert.equal(h.status(),'loading');
    assert.equal(h.state(),undefined, 'Do not mount a logged-out gate before session resolution');
    h.options.resolve({...capabilities});
    await tick();
    assert.equal(h.status(),'loading');
    assert.equal(h.state(),undefined);
    const prefetched = await h.prefetched();
    assert.equal('csrfToken' in prefetched, false);
    h.session.resolve({authenticated:false});
    await tick();
    assert.equal(h.status(),'anonymous');
    assert.equal(h.state().capabilitiesState,'ready');
    assert.equal(h.state().capabilities.manus,true);
    assert.equal(h.state().capabilities.google,false);
    assert.equal(h.state().root.querySelector('[data-safe-entry]').querySelector('button').disabled,false);
    assert.equal(h.state().root.querySelector('[data-safe-entry]').querySelector('button span').textContent,'تسجيل الدخول إلى تسويقات');
    assert.equal(h.state().root.querySelector('form').hidden,true,'Unavailable email is not the primary login form');
    assert.equal(h.state().root.querySelector('[data-capability-note]').afterNode,h.state().root.querySelector('[data-safe-entry]'));
    assert.deepEqual(h.calls,['session','options'], 'No duplicate options request after mount');
    assert.equal(h.prefetched(),null);
    assert.equal('csrfToken' in h.state().capabilities,false);
  });
}
test('an authenticated session discards unused prefetch and never becomes a new login identity', async () => {
  const h = harness();
  h.session.resolve({authenticated:true,user:{id:'offline-user',name:'Offline user',role:'user'},workspaces:[]});
  await tick();
  assert.equal(h.status(),'authenticated');
  assert.equal(h.prefetched(),null);
  assert.equal(h.state(),undefined);
  h.options.resolve({...capabilities});
  await tick();
  assert.equal(h.status(),'authenticated');
  assert.equal(h.state(),undefined);
  assert.deepEqual(h.calls,['session','options']);
});
test('failed prefetched options leave login disabled; explicit retry obtains fresh options', async () => {
  const h = harness();
  h.options.reject(new Error('Offline timeout'));
  await tick();
  h.session.resolve({authenticated:false});
  await tick();
  const state = h.state();
  assert.equal(state.capabilitiesState,'error');
  assert.equal(state.root.querySelector('[data-safe-entry]').hidden,true);
  assert.equal(state.root.querySelector('[data-capability-note]').querySelector('button').hidden,false);
  const mounted = h.window.TaswiqatAuthPortal.mount(h.nodes.sessionPanel,{view:'login',onManusLogin(){}});
  await tick();
  assert.equal(h.calls.filter(x=>x==='options').length,2);
  assert.equal(h.state().capabilitiesState,'ready');
  await mounted.refreshOptions();
  assert.equal(h.calls.filter(x=>x==='options').length,3, 'Retry never reuses the one-use initial promise');
});

test('email login form remains available when the API actually enables email', async () => {
  const h = harness();
  h.options.resolve({...capabilities,email:true});
  h.session.resolve({authenticated:false});
  await tick();
  assert.equal(h.state().capabilitiesState,'ready');
  assert.equal(h.state().root.querySelector('form').hidden,false);
  assert.equal(h.state().root.querySelector('[data-submit]').disabled,false);
});
