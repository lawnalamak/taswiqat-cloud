import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { verifySessionToken, csrfToken, checkCsrf, validateOrigin, cookieOptions, authMiddleware, requireAdmin, assertCurrentSession } from '../backend/auth.mjs';
const env={MANUS_JWT_SECRET:'offline-test-fixture-key-never-production',MANUS_PROJECT_ID:'offline-test-app'};
const encoder=new TextEncoder();
async function token(payload={},key=env.MANUS_JWT_SECRET,header={alg:'HS256'}) {
  return new SignJWT({openId:'offline-openid',appId:env.MANUS_PROJECT_ID,...payload}).setProtectedHeader(header).setIssuedAt().setExpirationTime(payload.exp || '5m').sign(encoder.encode(key));
}
test('HS256 token requires correct signature, expiry and exact appId',async()=>{
  assert.equal((await verifySessionToken(await token(),env)).openId,'offline-openid');
  await assert.rejects(verifySessionToken(await token({},'forged-signing-key'),env),e=>e.status===401);
  await assert.rejects(verifySessionToken(await token({exp:Math.floor(Date.now()/1000)-10}),env),e=>e.code==='invalid_session');
  await assert.rejects(verifySessionToken(await token({appId:'another-app'}),env),e=>e.status===401);
  const noExp=await new SignJWT({openId:'a',appId:env.MANUS_PROJECT_ID}).setProtectedHeader({alg:'HS256'}).sign(encoder.encode(env.MANUS_JWT_SECRET));
  await assert.rejects(verifySessionToken(noExp,env),e=>e.status===401);
  await assert.rejects(verifySessionToken('eyJhbGciOiJub25lIn0.eyJvcGVuSWQiOiJhIn0.',env),e=>e.status===401);
});
test('missing platform credentials fail closed',async()=>{
  await assert.rejects(verifySessionToken(await token(),{}),e=>e.status===503);
});
test('origins reject HTTP/public credentials/path/query/hash; local HTTP explicitly separate',()=>{
  assert.equal(validateOrigin('https://business.example'), 'https://business.example');
  for (const bad of ['http://business.example','https://business.example/evil','https://u:p@business.example','https://business.example?x=1','https://business.example/#app','javascript:alert(1)','//business.example']) assert.throws(()=>validateOrigin(bad));
  assert.throws(()=>validateOrigin('http://localhost:3000'));
  assert.equal(validateOrigin('http://localhost:3000',{TASWIQAT_ALLOW_LOCALHOST:'true'}),'http://localhost:3000');
  assert.deepEqual(cookieOptions('https://a.example'),{httpOnly:true,secure:true,sameSite:'none',path:'/'});
});
test('CSRF is bound to exact session and HTTPS origin, never a user-supplied role',()=>{
  const value='offline-session';
  const headers={'X-CSRF-Token':csrfToken(value,env),Origin:'https://business.example'};
  const req={auth:{token:value,payload:{origin:'https://business.example'}},get:name=>headers[name]};
  assert.doesNotThrow(()=>checkCsrf(req,env));
  headers['X-CSRF-Token']=csrfToken('different-session',env);
  assert.throws(()=>checkCsrf(req,env),e=>e.code==='csrf_invalid');
  headers['X-CSRF-Token']=csrfToken(value,env);headers.Origin='https://attacker.example';
  assert.throws(()=>checkCsrf(req,env),e=>e.code==='origin_mismatch');
});
test('Preview origin must match trusted exact host or configured origin',()=>{
  const headers={'X-CSRF-Token':csrfToken('preview',env),Origin:'https://preview.example',Host:'internal:3000','X-Forwarded-Host':'preview.example','X-Forwarded-Proto':'https'};
  const req={auth:{token:'preview',payload:{}},get:name=>headers[name]};
  assert.throws(()=>checkCsrf(req,env),e=>e.code==='origin_mismatch');
  assert.doesNotThrow(()=>checkCsrf(req,{...env,TASWIQAT_TRUST_PROXY:'true'}));
  headers.Origin='https://sibling.preview.example';
  assert.throws(()=>checkCsrf(req,{...env,TASWIQAT_TRUST_PROXY:'true'}));
});
test('role/email claims in signed JWT do not grant admin; authoritative database role wins',async()=>{
  const jwt=await token({role:'admin',email:'admin-fixture@example.invalid'});
  const db={query:async sql=>sql.includes('revocations')?[]:sql.includes('users')?[{id:'offline-user',open_id:'offline-openid',role:'user',status:'active',email:'user@example.invalid',name:'Offline fixture'}]:[]};
  const req={cookies:{webdev_app_session:jwt}};
  await new Promise((resolve,reject)=>authMiddleware(db,env)(req,{},e=>e?reject(e):resolve()));
  assert.equal(req.auth.user.role,'user');
  requireAdmin(req,{},e=>assert.equal(e.status,403));
});
test('unlinked Preview identity does not become administrator or create fake DB identity',async()=>{
  const db={query:async()=>[]};
  const req={cookies:{webdev_app_session:await token({role:'admin',email:'unlinked@example.invalid'})}};
  await new Promise(resolve=>authMiddleware(db,env)(req,{},e=>{assert.equal(e.code,'oauth_link_required');resolve();}));
});
test('suspended user is rejected on every authenticated request',async()=>{
  const db={query:async sql=>sql.includes('users')?[{id:'u',open_id:'offline-openid',role:'user',status:'suspended'}]:[]};
  const req={cookies:{webdev_app_session:await token()}};
  await new Promise(resolve=>authMiddleware(db,env)(req,{},e=>{assert.equal(e.code,'user_suspended');resolve();}));
});
test('loopback Preview Origin rewrite requires session HMAC and exact signed HTTPS browser origin',()=>{
  const headers={'X-CSRF-Token':csrfToken('preview',env),Origin:'http://127.0.0.1:3000',Host:'127.0.0.1:3000','X-Taswiqat-Origin':'https://preview.example'};
  const req={auth:{token:'preview',payload:{origin:'https://preview.example'}},socket:{remoteAddress:'127.0.0.1'},get:name=>headers[name]};
  assert.doesNotThrow(()=>checkCsrf(req,env));
  delete headers['X-Taswiqat-Origin'];assert.throws(()=>checkCsrf(req,env),e=>e.code==='invalid_origin');
  headers['X-Taswiqat-Origin']='https://attacker.example';assert.throws(()=>checkCsrf(req,env),e=>e.code==='origin_mismatch');
  headers['X-Taswiqat-Origin']='https://preview.example';req.socket.remoteAddress='203.0.113.10';assert.throws(()=>checkCsrf(req,env),e=>e.code==='invalid_origin');
  req.socket.remoteAddress='127.0.0.1';headers.Origin='https://attacker.example';assert.throws(()=>checkCsrf(req,env),e=>e.code==='origin_mismatch');
  headers.Origin='null';assert.throws(()=>checkCsrf(req,env),e=>e.code==='invalid_origin');
  headers.Origin='http://127.0.0.1:3000';headers['X-CSRF-Token']='forged';assert.throws(()=>checkCsrf(req,env),e=>e.code==='csrf_invalid');
  headers['X-CSRF-Token']=csrfToken('preview',env);req.auth.payload={};assert.doesNotThrow(()=>checkCsrf(req,{...env,TASWIQAT_PUBLIC_ORIGINS:'https://preview.example'}));
  headers['X-Taswiqat-Origin']='https://attacker.example';assert.throws(()=>checkCsrf(req,{...env,TASWIQAT_PUBLIC_ORIGINS:'https://preview.example'}),e=>e.code==='origin_mismatch');
});
test('current-session revalidation rejects logout, changed session version and substituted identity',async()=>{
  const jwt=await token();let revoked=false;
  const user={id:'current-user',open_id:'offline-openid',role:'user',status:'active',session_version:0};
  const db={query:async sql=>sql.includes('taswiqat_revocations')?(revoked?[{token_hash:'offline'}]:[]):sql.includes('taswiqat_users')?[user]:[]};
  const auth={token:jwt,user:{...user}};
  assert.equal((await assertCurrentSession(db,auth,env)).user.id,'current-user');
  revoked=true;await assert.rejects(assertCurrentSession(db,auth,env),e=>e.code==='invalid_session');
  revoked=false;user.session_version=1;await assert.rejects(assertCurrentSession(db,auth,env),e=>e.code==='invalid_session');
  user.session_version=0;await assert.rejects(assertCurrentSession(db,{...auth,user:{id:'other-user'}},env),e=>e.code==='invalid_session');
});
