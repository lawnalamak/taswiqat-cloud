import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { fail, digest, emailSchema } from './validation.mjs';
import { newId, audit } from './db.mjs';
import { signingKey, authOrigin, allowedAuthOrigin, issuePreauth, checkPreauth, setSession, registrationEnabled, accountSchemaReady, accountEmailBlocked, assertAlternateUser } from './auth.mjs';
import { providerConfigured } from './auth-provider.mjs';

const scrypt=promisify(scryptCallback);
const passwordSchema=z.string().min(12).max(128).refine(v=>!v.includes('\0'));
const tokenSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const nameSchema=z.string().trim().min(1).max(160).refine(v=>!/[<>\x00-\x1f\x7f]/.test(v));
const genericMessage='تم قبول الطلب. إن كانت هذه الطريقة متاحة للبريد، فاتبع التعليمات المرسلة؛ وإلا استخدم طريقة الدخول المعتادة.';
export function authInput(schema,input) {
  const parsed=schema.safeParse(input);
  if (!parsed.success) fail(400,'validation_error','تحقق من البيانات؛ كلمة المرور بين 12 و128 حرفًا والرابط صالح وغير منتهٍ');
  return parsed.data;
}
export async function hashPassword(password) {
  authInput(passwordSchema,password);
  const salt=randomBytes(16);
  const hash=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return `scrypt:v1:32768:8:1:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}
export async function verifyPassword(password,encoded) {
  if (!passwordSchema.safeParse(password).success) return false;
  const parts=typeof encoded==='string' ? encoded.split(':'):[];
  const valid=parts.length===7 && parts.slice(0,5).join(':')==='scrypt:v1:32768:8:1' && /^[A-Za-z0-9_-]{22}$/.test(parts[5]) && /^[A-Za-z0-9_-]{86}$/.test(parts[6]);
  // Unknown users pay the same KDF cost; only our fixed, versioned parameters are accepted.
  const hash=await scrypt(password,valid?Buffer.from(parts[5],'base64url'):Buffer.alloc(16),64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return valid && timingSafeEqual(hash,Buffer.from(parts[6],'base64url'));
}
export function emailConfigured(env) {
  try {
    signingKey(env); authOrigin(env);
    if (typeof env.TASWIQAT_EMAIL_API_KEY!=='string' || !/^re_[A-Za-z0-9_-]{8,200}$/.test(env.TASWIQAT_EMAIL_API_KEY)) return false;
    const from=env.TASWIQAT_EMAIL_FROM;
    if (typeof from!=='string' || from.length>320 || /[\r\n\x00]/.test(from)) return false;
    const address=from.includes('<') ? /^([^<>]+) <([^<>]+)>$/.exec(from)?.[2]:from;
    return emailSchema.safeParse(address).success;
  } catch { return false; }
}
export function canonicalAuthLink(purpose,token,env) {
  if (!['verify','reset'].includes(purpose) || !tokenSchema.safeParse(token).success) fail(400,'invalid_token','رابط غير صالح');
  return `${authOrigin(env)}/#auth/${purpose}?token=${encodeURIComponent(token)}`;
}
export async function sendAuthEmail({email,purpose,token},env,fetcher=fetch) {
  if (!emailConfigured(env)) fail(503,'email_not_configured','خدمة البريد غير متاحة حاليًا؛ لم تُرسل رسالة');
  const link=token ? canonicalAuthLink(purpose,token,env):null;
  const text=link ? `تسويقات\n\n${purpose==='verify'?'أكّد بريدك ثم اختر كلمة المرور':'استعد كلمة المرور'} عبر الرابط التالي:\n${link}\n\nالرابط صالح لمدة 20 دقيقة ولمرة واحدة. تجاهل الرسالة إذا لم تطلبها.`:
    'تسويقات\n\nوصل طلب متعلق بالدخول إلى حسابك. إذا لم يتوفر رابط في هذه الرسالة، استخدم طريقة الدخول المعتادة. لا يغيّر هذا الطلب الحساب أو كلمة المرور. تجاهل الرسالة إذا لم تطلبها.';
  try {
    const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.TASWIQAT_EMAIL_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':newId()},body:JSON.stringify({from:env.TASWIQAT_EMAIL_FROM,to:[email],subject:'تسويقات — طلب آمن للحساب',text}),signal:AbortSignal.timeout(15000),redirect:'error'});
    const data=await response.json();
    if (!response.ok || typeof data.id!=='string' || !data.id || data.error) throw new Error();
  } catch { fail(502,'email_send_failed','تعذر تأكيد إرسال البريد؛ حاول لاحقًا'); }
}
export function authRateLimiter({now=Date.now,ipLimit=30,emailLimit=6,maxEntries=10000,windowMs=900000}={}) {
  const buckets=new Map();
  return req=>{
    const time=now();
    for (const [key,v] of buckets) if (v.until<=time) buckets.delete(key);
    const email=typeof req.body?.email==='string' ? req.body.email.trim().toLowerCase():null;
    const keys=[[`ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`,ipLimit]];
    if (email) keys.push([`email:${digest(email)}`,emailLimit]);
    for (const [key,limit] of keys) {
      let bucket=buckets.get(key);
      if (!bucket) {
        if (buckets.size>=maxEntries) fail(429,'rate_limited','الخدمة مشغولة؛ حاول لاحقًا');
        bucket={n:0,until:time+windowMs};buckets.set(key,bucket);
      }
      if (++bucket.n>limit) fail(429,'rate_limited','طلبات كثيرة؛ حاول لاحقًا');
    }
  };
}
export async function consumeAuthToken(tx,token,purpose) {
  authInput(tokenSchema,token);
  const rows=await tx.query('SELECT * FROM taswiqat_auth_tokens WHERE token_hash=? AND purpose=? AND delivered=TRUE AND used=FALSE AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',[digest(token),purpose]);
  if (!rows.length || rows[0].purpose!==purpose || rows[0].token_hash!==digest(token)) fail(400,'invalid_token','الرابط منتهٍ أو مستخدم أو غير صالح');
  const result=await tx.query('UPDATE taswiqat_auth_tokens SET used=TRUE WHERE token_hash=? AND purpose=? AND delivered=TRUE AND used=FALSE AND expires_at>UTC_TIMESTAMP(3)',[digest(token),purpose]);
  if (result.affectedRows!==1) fail(400,'invalid_token','الرابط منتهٍ أو مستخدم أو غير صالح');
  return rows[0];
}
async function newToken(tx,purpose,email,name='',user=null) {
  const token=randomBytes(32).toString('base64url');
  await tx.query('INSERT INTO taswiqat_auth_tokens(token_hash,purpose,email,name,user_id,session_version,expires_at) VALUES(?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 20 MINUTE))',[digest(token),purpose,email,name,user?.id || null,user?Number(user.session_version || 0):null]);
  return token;
}
async function deliverToken(db,sender,env,email,purpose,token) {
  try { await sender({email,purpose,token},env); }
  catch(error) {
    if (token) await db.query('UPDATE taswiqat_auth_tokens SET used=TRUE WHERE token_hash=?',[digest(token)]).catch(()=>{});
    throw error;
  }
  if (token) await db.transaction(async tx=>{
    await tx.query('UPDATE taswiqat_auth_tokens SET used=TRUE WHERE email=? AND purpose=? AND token_hash<>?',[email,purpose,digest(token)]);
    await tx.query('UPDATE taswiqat_auth_tokens SET delivered=TRUE WHERE token_hash=? AND used=FALSE AND expires_at>UTC_TIMESTAMP(3)',[digest(token)]);
  });
}
async function credentials(tx,email) {
  const rows=await tx.query('SELECT * FROM taswiqat_auth_credentials WHERE login_email=? FOR UPDATE',[email]);
  return rows[0];
}
async function localUser(tx,credential) {
  if (!credential?.verified_at) fail(403,'account_unavailable','تعذر الدخول بهذه الطريقة؛ استخدم طريقة الدخول المعتادة');
  const pins=await tx.query('SELECT email,pinned_open_id FROM taswiqat_private_admin WHERE id=1 FOR UPDATE');
  const rows=await tx.query('SELECT * FROM taswiqat_users WHERE id=? FOR UPDATE',[credential.user_id]);
  assertAlternateUser(rows[0],pins[0],'taswiqat:email:');
  if (credential.login_email!==rows[0].email.trim().toLowerCase()) fail(403,'account_unavailable','تعذر الدخول بهذه الطريقة');
  return rows[0];
}
export async function authOptions(db,env) {
  const result={manus:false,email:false,google:false,apple:false,registrationEnabled:false};
  try {
    signingKey(env);
    const rows=await db.query('SELECT MAX(version) AS version FROM taswiqat_migrations');
    if (!(Number(rows[0]?.version)>=2)) return result;
    result.registrationEnabled=await registrationEnabled(db);
    result.manus=!!(env.MANUS_OAUTH_PORTAL_URL && env.MANUS_OAUTH_API_URL);
    if (Number(rows[0]?.version)>=3) {
      result.email=emailConfigured(env);result.google=providerConfigured('google',env);result.apple=providerConfigured('apple',env);
    }
  } catch { return {manus:false,email:false,google:false,apple:false,registrationEnabled:false}; }
  return result;
}
export function mountEmailAuthRoutes(app,db,env,wrap,{sendEmail=sendAuthEmail}={}) {
  const limit=authRateLimiter();
  let kdfBusy=0;
  const withKdf=async fn=>{
    if (kdfBusy>=4) fail(429,'rate_limited','الخدمة مشغولة؛ حاول لاحقًا');
    kdfBusy++;try{return await fn();}finally{kdfBusy--;}
  };
  const guard=async req=>{
    const bound=await checkPreauth(req,env);limit(req);
    if (!emailConfigured(env)) fail(503,'email_not_configured','خدمة البريد غير متاحة حاليًا؛ لم تُرسل رسالة');
    await accountSchemaReady(db);return bound;
  };
  app.get('/api/auth/options',wrap(async(req,res)=>{
    const options=await authOptions(db,env);
    let csrfToken=null;
    // Unconfigured applications report sanitized capabilities without inventing a challenge.
    if (env.MANUS_JWT_SECRET && env.MANUS_PROJECT_ID) {
      let validConfig=true;
      try { allowedAuthOrigin('https://taswiqat.manus.space',env); } catch {validConfig=false;}
      if (validConfig) {
        const origin=allowedAuthOrigin(req.query.origin || req.get('X-Taswiqat-Origin') || req.get('Origin'),env);
        csrfToken=await issuePreauth(res,origin,env);
      }
    }
    res.json({...options,csrfToken});
  }));
  app.post('/api/auth/email/register',wrap(async(req,res)=>{
    await guard(req);
    const {name,email}=authInput(z.object({name:nameSchema,email:emailSchema}).strict(),req.body);
    const token=await db.transaction(async tx=>{
      const {blocked}=await accountEmailBlocked(tx,email);
      if (blocked || !(await registrationEnabled(tx)) || await credentials(tx,email)) return null;
      return newToken(tx,'verify',email,name);
    });
    // Equal outward responses require actual sender acceptance also for ineligible accounts.
    // Such requests receive only a generic notice, never a verification/recovery token.
    await deliverToken(db,sendEmail,env,email,'verify',token);
    res.json({ok:true,message:genericMessage});
  }));
  app.post('/api/auth/email/verify',wrap(async(req,res)=>{
    const bound=await guard(req);
    const {token,password}=authInput(z.object({token:tokenSchema,password:passwordSchema}).strict(),req.body);
    const passwordHash=await withKdf(()=>hashPassword(password));
    const user=await db.transaction(async tx=>{
      const record=await consumeAuthToken(tx,token,'verify');
      limit({...req,body:{email:record.email}});
      if (!(await registrationEnabled(tx))) fail(403,'registration_disabled','تسجيل مستخدمين جدد موقوف حاليًا');
      const {blocked}=await accountEmailBlocked(tx,record.email);
      if (blocked || await credentials(tx,record.email)) fail(400,'invalid_token','تعذر إكمال الطلب؛ استخدم طريقة الدخول المعتادة');
      const id=newId();const openId=`taswiqat:email:${id}`;
      await tx.query('INSERT INTO taswiqat_users(id,open_id,name,email,email_authoritative,role) VALUES(?,?,?,?,TRUE,\'user\')',[id,openId,record.name,record.email]);
      await tx.query('INSERT INTO taswiqat_auth_credentials(login_email,user_id,password_hash,verified_at) VALUES(?,?,?,UTC_TIMESTAMP(3))',[record.email,id,passwordHash]);
      await tx.query('UPDATE taswiqat_auth_tokens SET used=TRUE WHERE email=?',[record.email]);
      await audit(tx,id,'email_verified',id);
      return {id,open_id:openId,session_version:0};
    });
    await setSession(res,user,bound.origin,env);
    res.json({ok:true,message:'تم تأكيد البريد وتسجيل الدخول'});
  }));
  app.post('/api/auth/email/login',wrap(async(req,res)=>{
    const bound=await guard(req);
    const {email,password}=authInput(z.object({email:emailSchema,password:passwordSchema}).strict(),req.body);
    const rows=await db.query('SELECT * FROM taswiqat_auth_credentials WHERE login_email=?',[email]);
    const old=rows[0];
    const valid=await withKdf(()=>verifyPassword(password,old?.password_hash));
    if (!valid) fail(401,'invalid_credentials','البريد أو كلمة المرور غير صحيحة');
    const user=await db.transaction(async tx=>{
      const current=await credentials(tx,email);
      if (!current || current.password_hash!==old.password_hash) fail(401,'invalid_credentials','البريد أو كلمة المرور غير صحيحة');
      const user=await localUser(tx,current);await audit(tx,user.id,'login',user.id);return user;
    });
    await setSession(res,user,bound.origin,env);
    res.json({ok:true,message:'تم تسجيل الدخول'});
  }));
  app.post('/api/auth/email/forgot',wrap(async(req,res)=>{
    await guard(req);
    const {email}=authInput(z.object({email:emailSchema}).strict(),req.body);
    const token=await db.transaction(async tx=>{
      const credential=await credentials(tx,email);
      if (!credential?.verified_at) return null;
      let user;
      try {user=await localUser(tx,credential);} catch(e) {if(e.code==='account_unavailable')return null;throw e;}
      return newToken(tx,'reset',email,user.name,user);
    });
    await deliverToken(db,sendEmail,env,email,'reset',token);
    res.json({ok:true,message:genericMessage});
  }));
  app.post('/api/auth/email/reset',wrap(async(req,res)=>{
    await guard(req);
    const {token,password}=authInput(z.object({token:tokenSchema,password:passwordSchema}).strict(),req.body);
    const passwordHash=await withKdf(()=>hashPassword(password));
    await db.transaction(async tx=>{
      const record=await consumeAuthToken(tx,token,'reset');
      limit({...req,body:{email:record.email}});
      const credential=await credentials(tx,record.email);
      const user=await localUser(tx,credential);
      if (record.user_id!==user.id || Number(record.session_version)!==Number(user.session_version || 0)) fail(400,'invalid_token','الرابط منتهٍ أو مستخدم أو غير صالح');
      await tx.query('UPDATE taswiqat_auth_credentials SET password_hash=?,updated_at=UTC_TIMESTAMP(3) WHERE login_email=? AND user_id=?',[passwordHash,record.email,user.id]);
      await tx.query('UPDATE taswiqat_users SET session_version=session_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[user.id]);
      await tx.query('UPDATE taswiqat_auth_tokens SET used=TRUE WHERE email=?',[record.email]);
      await audit(tx,user.id,'password_reset',user.id);
    });
    res.json({ok:true,message:'تم تغيير كلمة المرور وإبطال الجلسات السابقة؛ سجّل الدخول مجددًا'});
  }));
}
