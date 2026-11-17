import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../assets/youtube-connect.js',import.meta.url),'utf8');
const transport = await readFile(new URL('../assets/client-api.js',import.meta.url),'utf8');
const channelId = 'UC' + 'a'.repeat(22);
const otherChannel = 'UC' + 'b'.repeat(22);
const row = {channelId,title:'نشاط عربي',url:`https://www.youtube.com/channel/${channelId}`,thumbnailUrl:'https://yt3.ggpht.com/photo'};
const ready = value => ({ready:true,mode:'testing',reason:null,policyVersion:'2026-11-17',connection:null,pending:null,...value});
function fixture(responder = {}, ctx = {}) {
  const calls = [], navigations = [], changed = [], focus = [];
  const state = {mode:'live',authenticated:true,loaded:true,workspaceId:'workspace-a',canManage:true,view:'channels',...ctx};
  const window = {location:{assign:url=>navigations.push(url)},confirm:()=>true};
  window.top = window;
  window.TaswiqatAPI = Object.fromEntries(['youtubeStatus','youtubeConnect','youtubeConfirm','youtubeCancel','youtubeDisconnect'].map(method=>[method,async (...args)=>{
    calls.push({method,args});
    if (responder[method]) return responder[method](...args);
    return method === 'youtubeStatus' ? ready() : {ok:true};
  }]));
  const document = {getElementById:id=>({focus:()=>focus.push(id)})};
  vm.runInNewContext(source,{window,document,URL,queueMicrotask});
  const ui = window.TaswiqatYouTube;
  ui.configure({context:()=>state,render:()=>{},guardLeave:fn=>fn(),connectionChanged:(c,id)=>changed.push({c,id})});
  return {ui,calls,navigations,changed,state,focus};
}
function authorizationURL(scope = 'https://www.googleapis.com/auth/youtube.readonly') {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({scope,state:'only-in-the-authorization-request',client_id:'offline-client',code_challenge:'offline-challenge'});
}
test('unconfigured integration disables start and never fabricates a connection',async()=>{
  const c=fixture({youtubeStatus:()=>ready({ready:false})});
  await c.ui.refresh();
  const html=c.ui.renderCard();
  assert.match(html,/غير متاح حاليًا/);
  assert.match(html,/disabled/);
  assert.doesNotMatch(html,/متصلة للقراءة فقط/);
  await c.ui.connect();
  assert.equal(c.calls.filter(x=>x.method==='youtubeConnect').length,0);
});
test('one start action records consent version and navigates to narrow Google authorization',async()=>{
  const c=fixture({youtubeConnect:()=>({url:authorizationURL()})});
  await c.ui.refresh(); await c.ui.connect();
  assert.deepEqual(c.calls.find(x=>x.method==='youtubeConnect').args,['workspace-a','2026-11-17']);
  assert.equal(c.navigations.length,1);
  assert.equal(new URL(c.navigations[0]).searchParams.get('scope'),'https://www.googleapis.com/auth/youtube.readonly');
});
test('duplicate clicks cannot start two authorization requests',async()=>{
  let finish;
  const c=fixture({youtubeConnect:()=>new Promise(resolve=>{finish=resolve;})});
  await c.ui.refresh();
  const first=c.ui.connect(); await c.ui.connect();
  assert.equal(c.calls.filter(x=>x.method==='youtubeConnect').length,1);
  finish({url:authorizationURL()}); await first;
});
test('foreign origin and broad scope authorization URLs are rejected',async()=>{
  for (const url of ['https://evil.invalid/o/oauth2/v2/auth',authorizationURL('https://www.googleapis.com/auth/youtube')]) {
    const c=fixture({youtubeConnect:()=>({url})});
    await c.ui.refresh(); await c.ui.connect();
    assert.equal(c.navigations.length,0); assert.match(c.ui.renderCard(),/رفضنا رابط/);
  }
});
test('policy version mismatch fails closed instead of enabling a stale consent screen',async()=>{
  const c=fixture({youtubeStatus:()=>ready({policyVersion:'obsolete'})});
  await c.ui.refresh(); assert.match(c.ui.renderCard(),/أعد تحميل الصفحة/);
  await c.ui.connect(); assert.equal(c.navigations.length,0);
});
test('a late response from another workspace cannot populate this card',async()=>{
  let finish;
  const c=fixture({youtubeStatus:()=>new Promise(resolve=>{finish=resolve;})});
  const work=c.ui.refresh(); c.state.workspaceId='workspace-b'; c.ui.renderCard();
  finish(ready({connection:{status:'connected',details:row}})); await work;
  assert.equal(c.changed.length,0); assert.doesNotMatch(c.ui.renderCard(),/نشاط عربي/);
});
test('logout and demo mode do not borrow authority or perform channel writes',async()=>{
  for (const state of [{mode:'demo'},{authenticated:false},{canManage:false}]) {
    const c=fixture({},state); await c.ui.refresh(); await c.ui.connect();
    assert.equal(c.calls.filter(x=>x.method==='youtubeConnect').length,0);
  }
});
test('verified identity is escaped and unsafe thumbnails are not rendered',async()=>{
  const c=fixture({youtubeStatus:()=>ready({connection:{status:'connected',details:{...row,title:'<script>bad()</script>',thumbnailUrl:'https://evil.invalid/img'}}})});
  await c.ui.refresh(); const html=c.ui.renderCard();
  assert.match(html,/متصلة للقراءة فقط/); assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>/); assert.doesNotMatch(html,/evil\.invalid/);
});
test('pending candidates are not silently confirmed and only server candidates can be selected',async()=>{
  const c=fixture({youtubeStatus:()=>ready({pending:{channels:[row],replacing:true}})});
  await c.ui.refresh(); c.ui.renderCard();
  assert.equal(c.calls.filter(x=>x.method==='youtubeConfirm').length,0);
  await c.ui.confirm(otherChannel);
  assert.equal(c.calls.filter(x=>x.method==='youtubeConfirm').length,0);
  await c.ui.confirm(channelId);
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls.find(x=>x.method==='youtubeConfirm').args)),['workspace-a',{channelId}]);
});
test('cancel replacement reconciles server state and retains the verified previous connection',async()=>{
  let pending=true;
  const c=fixture({youtubeStatus:()=>ready({connection:{status:'connected',details:row},pending:pending?{channels:[{...row,channelId:otherChannel}],replacing:true}:null}),youtubeCancel:()=>{pending=false;return {ok:true};}});
  await c.ui.refresh(); await c.ui.cancel();
  const html=c.ui.renderCard(); assert.match(html,/نشاط عربي/); assert.match(html,/متصلة للقراءة فقط/);
  assert.doesNotMatch(html,/أكد القناة/);
});
test('failed disconnect does not claim that a channel was successfully removed',async()=>{
  const c=fixture({youtubeStatus:()=>ready({connection:{status:'connected',details:row}}),youtubeDisconnect:()=>{throw new Error('لم نؤكد نتيجة الفصل');}});
  await c.ui.refresh(); await c.ui.disconnect();
  const html=c.ui.renderCard(); assert.match(html,/لم نؤكد نتيجة الفصل/); assert.match(html,/متصلة للقراءة فقط/);
});
test('protected channel transport uses workspace CSRF, not an account preauth challenge',async()=>{
  const calls=[];
  const window={location:{origin:'https://taswiqat.example'},dispatchEvent:()=>{}};
  const sandbox={window,URL,Headers,AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(type){this.type=type;}},fetch:async(url,options)=>{calls.push({url,options});return {status:200,ok:true,json:async()=>({ok:true})};}};
  vm.runInNewContext(transport,sandbox);
  window.TaswiqatAPI.setCSRFToken('offline-csrf');
  await window.TaswiqatAPI.youtubeConnect('workspace-a','2026-11-17');
  const call=calls[0]; assert.equal(new URL(call.url).pathname,'/api/oauth/google/connect');
  assert.equal(call.options.method,'POST'); assert.equal(call.options.headers.get('X-CSRF-Token'),'offline-csrf');
  assert.equal(call.options.headers.get('X-Taswiqat-Origin'),'https://taswiqat.example');
  assert.deepEqual(JSON.parse(call.options.body),{workspaceId:'workspace-a',policyVersion:'2026-11-17'});
  assert.equal(calls.length,1);
});

for (const revocation of ['completed','pending','unavailable']) {
  test(`disconnect ${revocation} shows its actual external revocation outcome`,async()=>{
    let removed=false;
    const c=fixture({youtubeStatus:()=>ready({connection:removed?null:{status:'connected',details:row},reason:removed && revocation==='pending'?'revocation_pending':null}),youtubeDisconnect:()=>{removed=true;return {ok:true,revocation};}});
    await c.ui.refresh();await c.ui.disconnect();const html=c.ui.renderCard();
    assert.doesNotMatch(html,/متصلة للقراءة فقط/);
    if(revocation==='completed')assert.match(html,/أكد Google سحب الإذن/);
    else {assert.match(html,/security\.google\.com\/settings\/security\/permissions/);assert.doesNotMatch(html,/أكد Google سحب الإذن/);}
    if(revocation==='pending') {assert.match(html,/إلغاء الإذن قيد المحاولة/);assert.match(html,/youtube-connect-button" disabled/);await c.ui.connect();assert.equal(c.calls.filter(x=>x.method==='youtubeConnect').length,0);}
    if(revocation==='unavailable')assert.match(html,/تعذّر طلب سحب إذن Google|يلزم سحبه يدويًا/);
  });
}
test('an already pending revocation from status blocks reconnect even after a fresh page load',async()=>{
  const c=fixture({youtubeStatus:()=>ready({reason:'revocation_pending'})});await c.ui.refresh();
  assert.match(c.ui.renderCard(),/youtube-connect-button" disabled/);await c.ui.connect();assert.equal(c.navigations.length,0);
});
