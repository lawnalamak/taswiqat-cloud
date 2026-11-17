import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT, generateKeyPair, jwtVerify } from 'jose';
import { createApp } from '../backend/app.mjs';
import { hashPassword, verifyPassword, sendAuthEmail, canonicalAuthLink, consumeAuthToken, authRateLimiter, authOptions } from '../backend/auth-email.mjs';
import { providerConfigured, verifyProviderIdToken, exchangeProviderCode, resolveProviderUser, appleClientSecret, appleFirstName, pkceChallenge } from '../backend/auth-provider.mjs';
import { PREAUTH_COOKIE, SESSION_COOKIE, csrfToken, issuePreauth, checkPreauth, authMiddleware, allowedAuthOrigin, accountSchemaReady } from '../backend/auth.mjs';
import { ApiError, digest } from '../backend/validation.mjs';
import { migrate, DEFAULT_PLANS, AUTH_DEFINITIONS, SCHEMA_VERSION, TABLES } from '../backend/migrate.mjs';
const origin='https://taswiqat.manus.space';
const env={MANUS_JWT_SECRET:'offline-account-auth-signing-key-not-production',MANUS_PROJECT_ID:'offline-account-app',MANUS_OAUTH_PORTAL_URL:'https://manus.example.invalid',MANUS_OAUTH_API_URL:'https://manus.example.invalid',TASWIQAT_AUTH_ORIGIN:origin,TASWIQAT_EMAIL_API_KEY:'re_offline_only_not_a_real_key',TASWIQAT_EMAIL_FROM:'Taswiqat <auth@example.invalid>',TASWIQAT_GOOGLE_CLIENT_ID:'offline.apps.googleusercontent.com',TASWIQAT_GOOGLE_CLIENT_SECRET:'offline-not-a-real-provider-secret'};
function memoryDb() {
  let state={version:3,settings:{},pins:[],users:[],credentials:[],tokens:[],identities:[],nonces:[]};
  let queue=Promise.resolve();const statements=[];
  const db={statements,get state(){return state;},query:async(sql,a=[])=>{
    statements.push({sql,args:a});
    if (sql.includes('SELECT MAX(version)')) return [{version:state.version}];
    if (sql.startsWith('SELECT settings_json')) return [{settings_json:state.settings}];
    if (sql.startsWith('SELECT') && sql.includes('taswiqat_private_admin')) return state.pins;
    if (sql.startsWith('SELECT') && sql.includes('taswiqat_revocations')) return [];
    if (sql.startsWith('SELECT') && sql.includes('taswiqat_users')) {
      if (sql.includes('LOWER(TRIM(email))')) return state.users.filter(u=>u.email.trim().toLowerCase()===a[0]);
      if (sql.includes('open_id=?')) return state.users.filter(u=>u.open_id===a[0]);
      return state.users.filter(u=>u.id===a[0]);
    }
    if (sql.startsWith('SELECT') && sql.includes('taswiqat_auth_credentials')) return state.credentials.filter(c=>c.login_email===a[0]);
    if (sql.startsWith('SELECT') && sql.includes('taswiqat_auth_tokens')) return state.tokens.filter(t=>t.token_hash===a[0] && t.purpose===a[1] && t.delivered && !t.used && t.expires_at>Date.now());
    if (sql.startsWith('SELECT') && sql.includes('taswiqat_auth_identities')) return state.identities.filter(i=>i.provider===a[0] && Buffer.from(i.subject).equals(Buffer.from(a[1])));
    if (sql.startsWith('INSERT INTO taswiqat_auth_tokens')) {state.tokens.push({token_hash:a[0],purpose:a[1],email:a[2],name:a[3],user_id:a[4],session_version:a[5],expires_at:Date.now()+1200000,delivered:false,used:false});return {affectedRows:1};}
    if (sql.startsWith('UPDATE taswiqat_auth_tokens')) {
      let rows;
      if (sql.includes('token_hash<>?')) rows=state.tokens.filter(t=>t.email===a[0] && t.purpose===a[1] && t.token_hash!==a[2]);
      else if (sql.includes('WHERE email=?')) rows=state.tokens.filter(t=>t.email===a[0]);
      else rows=state.tokens.filter(t=>t.token_hash===a[0] && (!sql.includes('purpose=?') || t.purpose===a[1]) && (!sql.includes('used=FALSE') || !t.used) && (!sql.includes('delivered=TRUE AND') || t.delivered) && (!sql.includes('expires_at>') || t.expires_at>Date.now()));
      for(const t of rows){if(sql.includes('SET delivered=TRUE')) t.delivered=true;else t.used=true;}
      return {affectedRows:rows.length};
    }
    if (sql.startsWith('INSERT INTO taswiqat_users')) {
      if (state.users.some(u=>u.open_id===a[1])) throw new Error('Duplicate synthetic identity');
      state.users.push({id:a[0],open_id:a[1],name:a[2],email:a[3],email_authoritative:true,role:'user',status:'active',session_version:0});return {affectedRows:1};
    }
    if (sql.startsWith('INSERT INTO taswiqat_auth_credentials')) {
      if (state.credentials.some(c=>c.login_email===a[0])) throw new Error('Duplicate credentials');
      state.credentials.push({login_email:a[0],user_id:a[1],password_hash:a[2],verified_at:Date.now()});return {affectedRows:1};
    }
    if (sql.startsWith('UPDATE taswiqat_auth_credentials')) {const c=state.credentials.find(c=>c.login_email===a[1] && c.user_id===a[2]);if(c)c.password_hash=a[0];return {affectedRows:c?1:0};}
    if (sql.startsWith('UPDATE taswiqat_users SET session_version')) {const u=state.users.find(u=>u.id===a[0]);if(u)u.session_version++;return {affectedRows:u?1:0};}
    if (sql.startsWith('UPDATE taswiqat_users SET name')) {const u=state.users.find(u=>u.id===a[1]);if(u)u.name=a[0];return {affectedRows:u?1:0};}
    if (sql.startsWith('INSERT INTO taswiqat_auth_identities')) {state.identities.push({provider:a[0],subject:Buffer.from(a[1]),user_id:a[2]});return {affectedRows:1};}
    if (sql.startsWith('INSERT INTO taswiqat_oauth_nonces')) {state.nonces.push({nonce_hash:a[0],used:false,expires_at:Date.now()+600000});return {affectedRows:1};}
    if (sql.startsWith('UPDATE taswiqat_oauth_nonces')) {const n=state.nonces.find(n=>n.nonce_hash===a[0] && !n.used && n.expires_at>Date.now());if(n)n.used=true;return {affectedRows:n?1:0};}
    if (sql.startsWith('INSERT INTO taswiqat_audit')) return {affectedRows:1};
    throw new Error('Unexpected offline SQL: '+sql);
  },transaction:fn=>{
    const work=queue.then(async()=>{const snapshot=structuredClone(state);try{return await fn(db);}catch(e){state=snapshot;throw e;}});
    queue=work.catch(()=>{});return work;
  }};
  return db;
}
async function withApp(db,fn,services={},customEnv=env) {
  const app=createApp({db,env:customEnv,authServices:services});const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {return await fn(base);} finally {await new Promise(r=>server.close(r));}
}
async function challenge(base,browserOrigin=origin) {
  const r=await fetch(`${base}/api/auth/options?origin=${encodeURIComponent(browserOrigin)}`);
  assert.equal(r.status,200);const options=await r.json();
  const cookie=r.headers.get('set-cookie')?.split(';')[0];return {options,cookie};
}
async function post(base,action,body,c) {
  return fetch(`${base}/api/auth/email/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:c.cookie,Origin:origin,'X-Taswiqat-Origin':origin,'X-CSRF-Token':c.options.csrfToken},body:JSON.stringify(body)});
}
const password='offline-password-12+';
test('salted versioned scrypt rejects wrong/malformed passwords and bounds work parameters',async()=>{
  const a=await hashPassword(password),b=await hashPassword(password);assert.notEqual(a,b);assert.match(a,/^scrypt:v1:32768:8:1:/);
  assert.equal(await verifyPassword(password,a),true);assert.equal(await verifyPassword('incorrect-password',a),false);assert.equal(await verifyPassword(password,a.replace('32768','999999999')),false);
  for(const p of ['short','x'.repeat(129),'valid-password\0']) await assert.rejects(hashPassword(p),e=>e.status===400);
});
test('canonical fragment links never use Host/caller origin and sender success requires API acceptance',async()=>{
  const token=randomBytes(32).toString('base64url');assert.equal(canonicalAuthLink('verify',token,env),`${origin}/#auth/verify?token=${token}`);
  assert.throws(()=>canonicalAuthLink('reset',token,{...env,TASWIQAT_AUTH_ORIGIN:'https://attacker.invalid/path'}));
  let request;
  await sendAuthEmail({email:'offline@example.invalid',purpose:'reset',token},env,async(url,opts)=>{request={url,opts};return {ok:true,json:async()=>({id:'offline-confirmed-id'})};});
  assert.equal(request.url,'https://api.resend.com/emails');assert.match(JSON.parse(request.opts.body).text,/#auth\/reset\?token=/);
  for(const mock of [async()=>({ok:false,json:async()=>({message:'SECRET_RAW_REJECTION'})}),async()=>({ok:true,json:async()=>({})}),async()=>{throw new Error('SECRET_RAW_REJECTION');}]) {
    await assert.rejects(sendAuthEmail({email:'offline@example.invalid',purpose:'reset',token},env,mock),e=>e.code==='email_send_failed' && !e.message.includes('SECRET'));
  }
  await assert.rejects(sendAuthEmail({email:'offline@example.invalid',purpose:'reset',token},{},async()=>{assert.fail('Must not call sender');}),e=>e.status===503);
});
test('options preserve Manus v2 and canonical/explicit Preview challenges with absent new keys',async()=>{
  const db=memoryDb();db.state.version=2;
  const config={MANUS_JWT_SECRET:env.MANUS_JWT_SECRET,MANUS_PROJECT_ID:env.MANUS_PROJECT_ID,MANUS_OAUTH_PORTAL_URL:env.MANUS_OAUTH_PORTAL_URL,MANUS_OAUTH_API_URL:env.MANUS_OAUTH_API_URL,TASWIQAT_PUBLIC_ORIGINS:'https://preview.example.invalid'};
  await withApp(db,async base=>{
    for(const o of [origin,'https://preview.example.invalid']) {const c=await challenge(base,o);assert.equal(c.options.manus,true);assert.equal(c.options.email,false);assert.equal(c.options.google,false);assert.equal(c.options.apple,false);assert.ok(c.options.csrfToken);assert.match(c.cookie,/taswiqat_preauth=/);}
    const bad=await fetch(base+'/api/auth/options?origin=https://attacker.example.invalid');assert.equal(bad.status,403);
  },{},config);
  assert.throws(()=>allowedAuthOrigin('https://sibling.preview.example.invalid',config),e=>e.status===403);
  db.state.version=null;assert.equal((await authOptions(db,env)).email,false);await assert.rejects(accountSchemaReady(db),e=>e.code==='schema_not_ready');
});
test('pre-auth CSRF binds cookie, signature, purpose and exact origin including guarded Preview rewrite',async()=>{
  let cookie;const token=await issuePreauth({cookie:(name,value)=>{cookie=value;}},origin,env);
  const headers={'X-CSRF-Token':token,Origin:origin,'X-Taswiqat-Origin':origin,Host:'127.0.0.1:3000'};
  const req={cookies:{[PREAUTH_COOKIE]:cookie},get:n=>headers[n],socket:{remoteAddress:'127.0.0.1'}};
  assert.equal((await checkPreauth(req,env)).origin,origin);
  headers.Origin='http://127.0.0.1:3000';await checkPreauth(req,env);
  req.socket.remoteAddress='203.0.113.8';await assert.rejects(checkPreauth(req,env));req.socket.remoteAddress='127.0.0.1';
  headers.Origin='https://attacker.example.invalid';await assert.rejects(checkPreauth(req,env));
  headers.Origin=origin;headers['X-CSRF-Token']='forged';await assert.rejects(checkPreauth(req,env),e=>e.code==='csrf_invalid');
  headers['X-CSRF-Token']=token;delete headers.Origin;delete headers['X-Taswiqat-Origin'];await assert.rejects(checkPreauth(req,env),e=>e.code==='origin_mismatch');
  headers.Origin=origin;req.cookies[PREAUTH_COOKIE]=await new SignJWT({kind:'preauth',appId:env.MANUS_PROJECT_ID,origin,nonce:'offline'}).setProtectedHeader({alg:'HS256'}).setExpirationTime(Math.floor(Date.now()/1000)-1).sign(new TextEncoder().encode(env.MANUS_JWT_SECRET));
  await assert.rejects(checkPreauth(req,env),e=>e.code==='csrf_invalid');
});
test('normalized-email and IP limits are independent, bounded and expire',()=>{
  let now=0;const limit=authRateLimiter({now:()=>now,ipLimit:3,emailLimit:2,maxEntries:10,windowMs:100});
  limit({ip:'a',body:{email:' A@EXAMPLE.INVALID '}});limit({ip:'b',body:{email:'a@example.invalid'}});
  assert.throws(()=>limit({ip:'c',body:{email:'a@example.invalid'}}),e=>e.status===429);
  now=101;limit({ip:'a',body:{email:'a@example.invalid'}});
  const ip=authRateLimiter({ipLimit:1});ip({ip:'same',body:{}});assert.throws(()=>ip({ip:'same',body:{}}),e=>e.status===429);
});
test('register has no attacker-selected password; only delivered proof creates a synthetic local account',async()=>{
  const db=memoryDb(),sent=[];
  await withApp(db,async base=>{
    const c=await challenge(base);assert.equal(c.options.email,true);
    let r=await post(base,'register',{name:'Offline',email:' USER@example.invalid ',password},c);assert.equal(r.status,400);assert.equal(sent.length,0);
    r=await post(base,'register',{name:'Offline',email:' USER@example.invalid '},c);assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
    assert.equal(db.state.users.length,0);assert.equal(db.state.credentials.length,0);assert.equal(sent.length,1);
    assert.equal(sent[0].email,'user@example.invalid');assert.equal(db.state.tokens[0].token_hash,digest(sent[0].token));assert.equal(JSON.stringify(db.state).includes(sent[0].token),false);
    assert.ok(db.state.tokens[0].expires_at<=Date.now()+1200000);
    r=await post(base,'verify',{token:sent[0].token,password},c);assert.equal(r.status,200);
    assert.match(r.headers.get('set-cookie'),/webdev_app_session=.*HttpOnly; Secure; SameSite=None/);
    assert.equal(db.state.credentials.length,1);assert.equal(db.state.users[0].role,'user');assert.match(db.state.users[0].open_id,/^taswiqat:email:/);
    r=await post(base,'verify',{token:sent[0].token,password},c);assert.equal(r.status,400);assert.equal(db.state.users.length,1);
  },{sendEmail:async m=>{sent.push(m);}});
});
test('verification/reset purpose, expiry, delivery and replay are enforced transactionally',async()=>{
  const db=memoryDb(),token=randomBytes(32).toString('base64url');
  db.state.tokens.push({token_hash:digest(token),purpose:'verify',email:'test@example.invalid',name:'Offline',delivered:true,used:false,expires_at:Date.now()+5000});
  await assert.rejects(db.transaction(tx=>consumeAuthToken(tx,token,'reset')),e=>e.code==='invalid_token');
  db.state.tokens[0].delivered=false;await assert.rejects(db.transaction(tx=>consumeAuthToken(tx,token,'verify')));
  db.state.tokens[0].delivered=true;db.state.tokens[0].expires_at=0;await assert.rejects(db.transaction(tx=>consumeAuthToken(tx,token,'verify')));
  db.state.tokens[0].expires_at=Date.now()+5000;
  const concurrent=await Promise.allSettled([db.transaction(tx=>consumeAuthToken(tx,token,'verify')),db.transaction(tx=>consumeAuthToken(tx,token,'verify'))]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
});
test('pinned/email-colliding OAuth accounts receive generic notices, never credentials/reset tokens or auto linking',async()=>{
  for(const pinned of [false,true]) {
    const db=memoryDb(),sent=[];const email='operator@example.invalid';
    if(pinned)db.state.pins.push({email,pinned_open_id:'manus-operator'});
    db.state.users.push({id:'existing',open_id:'manus-operator',email,name:'Offline',role:pinned?'admin':'user',status:'active',session_version:0});
    await withApp(db,async base=>{
      const c=await challenge(base);const register=await post(base,'register',{name:'Offline',email},c);const forgot=await post(base,'forgot',{email},c);
      assert.equal(register.status,200);assert.deepEqual(await register.json(),await forgot.json());assert.equal(sent.length,2);assert.ok(sent.every(m=>m.token===null));
      const login=await post(base,'login',{email,password},c);assert.equal(login.status,401);
      assert.equal(db.state.tokens.length,0);assert.equal(db.state.credentials.length,0);assert.equal(db.state.users.length,1);
      assert.ok(!db.statements.some(({sql})=>/UPDATE taswiqat_private_admin/.test(sql)));
    },{sendEmail:async m=>sent.push(m)});
  }
});
test('mail rejection never claims sent/ok and pending token cannot verify',async()=>{
  const db=memoryDb(),sent=[];
  await withApp(db,async base=>{
    const c=await challenge(base);const r=await post(base,'register',{name:'Offline',email:'reject@example.invalid'},c);
    assert.equal(r.status,502);assert.equal((await r.json()).error.code,'email_send_failed');assert.equal(db.state.tokens[0].delivered,false);assert.equal(db.state.tokens[0].used,true);
    const v=await post(base,'verify',{token:sent[0].token,password},c);assert.equal(v.status,400);assert.equal(db.state.users.length,0);
  },{sendEmail:async m=>{sent.push(m);throw new ApiError(502,'email_send_failed','تعذر تأكيد إرسال البريد');}});
});
test('forgot/reset authenticates only verified local account, invalidates sessions and all outstanding tokens',async()=>{
  const db=memoryDb(),sent=[];const email='local@example.invalid',id='offline-local';
  db.state.users.push({id,open_id:'taswiqat:email:offline-local',email,name:'Offline',role:'user',status:'active',session_version:0});
  db.state.credentials.push({user_id:id,login_email:email,verified_at:Date.now(),password_hash:await hashPassword(password)});
  let session;
  await withApp(db,async base=>{
    const c=await challenge(base);const login=await post(base,'login',{email,password},c);assert.equal(login.status,200);session=login.headers.get('set-cookie').split(';')[0].slice(`${SESSION_COOKIE}=`.length);
    const f=await post(base,'forgot',{email},c);assert.equal(f.status,200);assert.equal(db.state.users[0].session_version,0);
    const reset=await post(base,'reset',{token:sent[0].token,password:'new-offline-password-12+'},c);assert.equal(reset.status,200);assert.equal(db.state.users[0].session_version,1);
    assert.equal(await verifyPassword('new-offline-password-12+',db.state.credentials[0].password_hash),true);assert.ok(db.state.tokens.every(t=>t.used));
    const replay=await post(base,'reset',{token:sent[0].token,password},c);assert.equal(replay.status,400);
  },{sendEmail:async m=>sent.push(m)});
  await new Promise(resolve=>authMiddleware(db,env)({cookies:{[SESSION_COOKIE]:session}},{},e=>{assert.equal(e.code,'invalid_session');resolve();}));
});
test('registration disabled blocks new proof/provider creation but not existing login',async()=>{
  const db=memoryDb();db.state.settings.registrationEnabled=false;
  await assert.rejects(resolveProviderUser(db,'google',{subject:'new-sub',email:'new@example.invalid',name:'Offline'}),e=>e.code==='registration_disabled');
  await withApp(db,async base=>{const c=await challenge(base);assert.equal(c.options.registrationEnabled,false);const r=await post(base,'register',{name:'Offline',email:'new@example.invalid'},c);assert.equal(r.status,200);assert.equal(db.state.tokens.length,0);},{sendEmail:async()=>{}});
});
test('session-version compatibility keeps sv-less Manus users at zero and rejects changed versions',async()=>{
  const db=memoryDb();db.state.users.push({id:'m',open_id:'manus-offline',email:'m@example.invalid',role:'user',status:'active',session_version:0});
  const token=await new SignJWT({openId:'manus-offline',appId:env.MANUS_PROJECT_ID}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(env.MANUS_JWT_SECRET));
  await new Promise((resolve,reject)=>authMiddleware(db,env)({cookies:{[SESSION_COOKIE]:token}},{},e=>e?reject(e):resolve()));
  db.state.users[0].session_version=1;
  await new Promise(resolve=>authMiddleware(db,env)({cookies:{[SESSION_COOKIE]:token}},{},e=>{assert.equal(e.code,'invalid_session');resolve();}));
});
test('Google ID-token signature, audience, issuer, nonce, expiry and verified email all fail closed',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');const bound={nonce:'offline-nonce'};
  async function jwt(claims={}){return new SignJWT({iss:'https://accounts.google.com',aud:env.TASWIQAT_GOOGLE_CLIENT_ID,sub:'CaseSensitiveSub',email:'user@example.invalid',email_verified:true,nonce:bound.nonce,...claims}).setProtectedHeader({alg:'RS256'}).setIssuedAt().setExpirationTime(claims.exp || '5m').sign(privateKey);}
  const valid=await verifyProviderIdToken('google',await jwt(),bound,env,publicKey);assert.equal(valid.subject,'CaseSensitiveSub');
  for(const claims of [{iss:'https://attacker.invalid'},{aud:'different-client'},{nonce:'wrong'},{email_verified:false},{sub:''},{exp:Math.floor(Date.now()/1000)-10},{azp:'another-client'}]) await assert.rejects(verifyProviderIdToken('google',await jwt(claims),bound,env,publicKey),e=>e.code==='provider_identity_invalid');
  const wrong=await generateKeyPair('RS256');await assert.rejects(verifyProviderIdToken('google',await jwt(),bound,env,wrong.publicKey));
});
test('Google exchange uses exact callback and PKCE; access/refresh tokens are neither returned nor stored',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');const bound={nonce:'offline-nonce',verifier:randomBytes(48).toString('base64url'),redirectUri:origin+'/api/auth/google/callback'};
  const jwt=await new SignJWT({iss:'accounts.google.com',aud:env.TASWIQAT_GOOGLE_CLIENT_ID,sub:'offline-sub',email:'g@example.invalid',email_verified:'true',nonce:bound.nonce}).setProtectedHeader({alg:'RS256'}).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const info=await exchangeProviderCode('google','offline-code',bound,env,{jwks:publicKey,fetcher:async(url,opts)=>{assert.equal(url,'https://oauth2.googleapis.com/token');const form=new URLSearchParams(opts.body);assert.equal(form.get('code_verifier'),bound.verifier);assert.equal(form.get('redirect_uri'),bound.redirectUri);return {ok:true,json:async()=>({id_token:jwt,access_token:'DO_NOT_RETAIN',refresh_token:'DO_NOT_RETAIN'})};}});
  assert.equal(JSON.stringify(info).includes('DO_NOT_RETAIN'),false);assert.match(pkceChallenge(bound.verifier),/^[A-Za-z0-9_-]{43}$/);
});
test('Apple client secret uses ES256 with team/key/client; relay/missing email and missing repeated name are handled',async()=>{
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const config={...env,TASWIQAT_APPLE_CLIENT_ID:'com.example.offline',TASWIQAT_APPLE_TEAM_ID:'OFFLINE123',TASWIQAT_APPLE_KEY_ID:'OFFLINE456',TASWIQAT_APPLE_PRIVATE_KEY:pair.privateKey.export({format:'pem',type:'pkcs8'})};
  // IDs are ten-character Apple identifiers; these are generated offline fixtures, not account data.
  config.TASWIQAT_APPLE_TEAM_ID='A'.repeat(10);config.TASWIQAT_APPLE_KEY_ID='B'.repeat(10);
  assert.equal(providerConfigured('apple',config),true);const secret=await appleClientSecret(config);
  const checked=await jwtVerify(secret,pair.publicKey,{algorithms:['ES256'],issuer:config.TASWIQAT_APPLE_TEAM_ID,audience:'https://appleid.apple.com',subject:config.TASWIQAT_APPLE_CLIENT_ID});assert.equal(checked.protectedHeader.kid,config.TASWIQAT_APPLE_KEY_ID);
  assert.equal(providerConfigured('apple',{...config,TASWIQAT_APPLE_PRIVATE_KEY:'bad'}),false);
  const rsa=await generateKeyPair('RS256'),bound={nonce:'apple-offline-nonce'};
  for(const email of ['relay@privaterelay.appleid.com','']) {
    const token=await new SignJWT({iss:'https://appleid.apple.com',aud:config.TASWIQAT_APPLE_CLIENT_ID,sub:'apple-sub',email,email_verified:'true',nonce:bound.nonce}).setProtectedHeader({alg:'RS256'}).setIssuedAt().setExpirationTime('5m').sign(rsa.privateKey);
    assert.equal((await verifyProviderIdToken('apple',token,bound,config,rsa.publicKey)).email,email);
  }
  assert.equal(appleFirstName(undefined),'');assert.equal(appleFirstName(JSON.stringify({name:{firstName:'<Offline>',lastName:'Name'},email:'attacker@example.invalid'})),'Offline Name');
});
test('provider identity uses binary sub, preserves established names, blocks collisions/pin and never links by email',async()=>{
  const db=memoryDb();const info={subject:'CaseSensitive',email:'g@example.invalid',name:'Offline'};
  const user=await resolveProviderUser(db,'google',info);assert.match(user.open_id,/^taswiqat:oidc:/);assert.equal(user.role,'user');
  const repeat=await resolveProviderUser(db,'google',{...info,name:''});assert.equal(repeat.id,user.id);assert.equal(repeat.name,'Offline');
  await assert.rejects(resolveProviderUser(db,'google',{...info,subject:'casesensitive'}),e=>e.code==='account_unavailable');
  await assert.rejects(resolveProviderUser(db,'apple',{...info,subject:'apple-other'}),e=>e.code==='account_unavailable');assert.equal(db.state.users.length,1);
  db.state.pins.push({email:'operator@example.invalid',pinned_open_id:user.open_id});
  await assert.rejects(resolveProviderUser(db,'google',info),e=>e.code==='account_unavailable');
  assert.ok(!db.statements.some(({sql})=>sql.includes('UPDATE taswiqat_private_admin')));
});
test('provider start/callback bind browser challenge, state and one-use DB nonce; all redirects fixed and errors sanitized',async()=>{
  const db=memoryDb();let exchanges=0;
  await withApp(db,async base=>{
    const c=await challenge(base);const headers={Cookie:c.cookie,Origin:origin,'X-Taswiqat-Origin':origin,'X-CSRF-Token':c.options.csrfToken};
    const start=await fetch(base+`/api/auth/google/start?origin=${encodeURIComponent(origin)}`,{headers});assert.equal(start.status,200);
    const providerCookie=start.headers.get('set-cookie').split(';')[0];const url=new URL((await start.json()).url);assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/auth/google/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    const callback=base+'/api/auth/google/callback?state='+url.searchParams.get('state')+'&code=offline-code';
    const bad=await fetch(callback,{headers:{Cookie:c.cookie},redirect:'manual'});assert.equal(bad.headers.get('location'),origin+'/#auth/login?error=provider_login_failed');assert.equal(exchanges,0);
    const cookie=c.cookie+'; '+providerCookie;
    const good=await fetch(callback,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(good.headers.get('location'),origin+'/#app');assert.match(good.headers.get('set-cookie'),/webdev_app_session=/);assert.equal(exchanges,1);
    const replay=await fetch(callback,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(replay.headers.get('location'),origin+'/#auth/login?error=provider_login_failed');assert.equal(exchanges,1);
  },{exchangeProvider:async()=>{exchanges++;return {subject:'provider-offline',email:'p@example.invalid',name:'Offline'};}});
});
test('all email POSTs require challenge; JSON/form bodies are bounded and unconfigured providers fail closed',async()=>{
  const db=memoryDb();
  await withApp(db,async base=>{
    for(const action of ['register','verify','login','forgot','reset']) {const r=await fetch(base+'/api/auth/email/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{}'});assert.equal(r.status,403);}
    const c=await challenge(base);const large=await post(base,'register',{name:'x'.repeat(10000),email:'large@example.invalid'},c);assert.equal(large.status,413);
    const form=await fetch(base+'/api/auth/apple/callback',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'state='+('x'.repeat(14000)),redirect:'manual'});assert.equal(form.status,303);assert.equal(form.headers.get('location'),origin+'/#auth/login?error=provider_login_failed');
  });
  await withApp(db,async base=>{const c=await challenge(base);assert.equal(c.options.google,false);const r=await fetch(base+'/api/auth/google/start?origin='+origin);assert.equal(r.status,503);},{},{...env,TASWIQAT_GOOGLE_CLIENT_SECRET:undefined});
});
test('v4 migration is additive/idempotent and prices are default-only, never reseed existing rows or pin',async()=>{
  assert.equal(SCHEMA_VERSION,4);assert.deepEqual(DEFAULT_PLANS.map(p=>p.price),[49,99,199]);assert.ok(TABLES.includes('taswiqat_auth_tokens'));assert.match(AUTH_DEFINITIONS[0],/VARBINARY\(255\)/);
  const versions=new Set([1,2]),columns=new Set(),sqls=[];
  const connection={query:async(sql,args)=>{sqls.push(sql);if(sql.includes('GET_LOCK'))return [[{acquired:1}]];if(sql.startsWith('SELECT version'))return [versions.has(Number(sql.match(/version=(\d+)/)[1]))?[{version:Number(sql.match(/version=(\d+)/)[1])}]:[]];if(sql.startsWith('ALTER TABLE'))columns.add('session_version');const inserted=sql.match(/INSERT IGNORE INTO taswiqat_migrations\(version\) VALUES\((\d+)\)/);if(inserted)versions.add(Number(inserted[1]));return [{}];},execute:async()=>[columns.has('session_version')?[{COLUMN_NAME:'session_version'}]:[]],release:()=>{}};
  const db={pool:{getConnection:async()=>connection}};await migrate(db);await migrate(db);
  assert.equal(sqls.filter(s=>s.startsWith('ALTER TABLE')).length,1);assert.equal(sqls.filter(s=>s.includes('CREATE TABLE IF NOT EXISTS taswiqat_auth_')).length,3);
  assert.deepEqual([...versions],[1,2,3,4]);
  for(const table of ['taswiqat_youtube_tokens','taswiqat_youtube_attempts','taswiqat_youtube_revocations','taswiqat_channel_maintenance']) {
    assert.ok(TABLES.includes(table));assert.equal(sqls.filter(s=>s.startsWith('CREATE TABLE IF NOT EXISTS '+table+' ')).length,1);
  }
  assert.ok(!sqls.some(s=>s.includes('taswiqat_plans') || /UPDATE taswiqat_(users|private_admin)/.test(s)));
});

test('Apple form callback succeeds with browser-bound state, rejects challenge substitution, and redirects on replay',async()=>{
  const db=memoryDb(),pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const config={...env,TASWIQAT_APPLE_CLIENT_ID:'com.example.offline',TASWIQAT_APPLE_TEAM_ID:'A'.repeat(10),TASWIQAT_APPLE_KEY_ID:'B'.repeat(10),TASWIQAT_APPLE_PRIVATE_KEY:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  let calls=0;
  await withApp(db,async base=>{
    const c=await challenge(base),headers={Cookie:c.cookie,Origin:origin,'X-Taswiqat-Origin':origin,'X-CSRF-Token':c.options.csrfToken};
    const start=await fetch(base+'/api/auth/apple/start?origin='+encodeURIComponent(origin),{headers});assert.equal(start.status,200);
    const url=new URL((await start.json()).url),cookie=start.headers.get('set-cookie').split(';')[0];assert.equal(url.searchParams.get('response_mode'),'form_post');assert.equal(url.searchParams.get('scope'),'name email');
    const body=new URLSearchParams({state:url.searchParams.get('state'),code:'offline-apple-code',user:JSON.stringify({name:{firstName:'<Offline>',lastName:'Apple'},email:'DO_NOT_TRUST@example.invalid'})}).toString();
    const invoke=browserCookie=>fetch(base+'/api/auth/apple/callback',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:browserCookie},body,redirect:'manual'});
    const substituted=await invoke(cookie);assert.equal(substituted.headers.get('location'),origin+'/#auth/login?error=provider_login_failed');assert.equal(calls,0);
    const success=await invoke(c.cookie+'; '+cookie);assert.equal(success.headers.get('location'),origin+'/#app');assert.equal(calls,1);assert.equal(db.state.users[0].name,'Offline Apple');assert.equal(db.state.users[0].email,'relay@privaterelay.appleid.com');
    const replay=await invoke(c.cookie+'; '+cookie);assert.equal(replay.headers.get('location'),origin+'/#auth/login?error=provider_login_failed');assert.equal(calls,1);
  },{exchangeProvider:async()=>{calls++;return {subject:'apple-offline-sub',email:'relay@privaterelay.appleid.com',name:''};}},config);
});
test('verified local-looking credentials cannot recover or log in as pinned/admin operator',async()=>{
  for(const role of ['user','admin']) {
    const db=memoryDb(),email='operator@example.invalid',id='operator',sent=[];
    db.state.pins.push({email,pinned_open_id:'taswiqat:email:operator'});
    db.state.users.push({id,open_id:'taswiqat:email:operator',email,role,status:'active',session_version:0});
    db.state.credentials.push({user_id:id,login_email:email,password_hash:await hashPassword(password),verified_at:Date.now()});
    await withApp(db,async base=>{const c=await challenge(base);const forgot=await post(base,'forgot',{email},c);assert.equal(forgot.status,200);assert.equal(sent[0].token,null);const login=await post(base,'login',{email,password},c);assert.equal(login.status,403);assert.equal(db.state.tokens.length,0);assert.equal(db.state.users[0].session_version,0);},{sendEmail:async m=>sent.push(m)});
  }
});
test('registration switch rechecked at proof consumption, and suspended local users cannot log in/recover',async()=>{
  const db=memoryDb(),sent=[];
  await withApp(db,async base=>{
    const c=await challenge(base);await post(base,'register',{name:'Offline',email:'pending@example.invalid'},c);db.state.settings.registrationEnabled=false;
    const verify=await post(base,'verify',{token:sent[0].token,password},c);assert.equal(verify.status,403);assert.equal((await verify.json()).error.code,'registration_disabled');assert.equal(db.state.users.length,0);
  },{sendEmail:async m=>sent.push(m)});
  db.state.users.push({id:'inactive',open_id:'taswiqat:email:inactive',name:'Offline',email:'inactive@example.invalid',role:'user',status:'suspended',session_version:0});
  db.state.credentials.push({user_id:'inactive',login_email:'inactive@example.invalid',verified_at:Date.now(),password_hash:await hashPassword(password)});
  await withApp(db,async base=>{
    const c=await challenge(base);const login=await post(base,'login',{email:'inactive@example.invalid',password},c);assert.equal(login.status,403);
    const forgot=await post(base,'forgot',{email:'inactive@example.invalid'},c);assert.equal(forgot.status,200);assert.equal(sent.at(-1).token,null);
  },{sendEmail:async m=>sent.push(m)});
});
test('callback state signature/expiry are verified and different-origin Preview cannot hand off canonical cookies',async()=>{
  const db=memoryDb(),config={...env,TASWIQAT_PUBLIC_ORIGINS:'https://preview.example.invalid'};
  await withApp(db,async base=>{
    const c=await challenge(base,'https://preview.example.invalid');const headers={Cookie:c.cookie,Origin:'https://preview.example.invalid','X-Taswiqat-Origin':'https://preview.example.invalid','X-CSRF-Token':c.options.csrfToken};
    const start=await fetch(base+'/api/auth/google/start?origin=https://preview.example.invalid',{headers});assert.equal(start.status,409);assert.equal((await start.json()).error.code,'canonical_login_required');
    for(const exp of [Math.floor(Date.now()/1000)-1,Math.floor(Date.now()/1000)+300]) {
      const jwt=await new SignJWT({kind:'oidc_state',appId:env.MANUS_PROJECT_ID,provider:'google',origin,redirectUri:origin+'/api/auth/google/callback',state:'offline-state',nonce:'offline-nonce',challenge:digest(c.cookie.split('=').slice(1).join('='))}).setProtectedHeader({alg:'HS256'}).setExpirationTime(exp).sign(new TextEncoder().encode(exp<Date.now()/1000?env.MANUS_JWT_SECRET:'forged-key-offline'));
      const callback=await fetch(base+'/api/auth/google/callback?state=offline-state&code=offline-code',{headers:{Cookie:c.cookie+'; taswiqat_oidc_google='+jwt},redirect:'manual'});assert.equal(callback.headers.get('location'),origin+'/#auth/login?error=provider_login_failed');
    }
    assert.equal(db.state.users.length,0);assert.equal(db.state.nonces.length,0);
  },{exchangeProvider:async()=>assert.fail('Must not exchange invalid state')},config);
});
