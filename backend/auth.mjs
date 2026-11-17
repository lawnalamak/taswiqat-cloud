import { SignJWT, jwtVerify } from 'jose';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { fail, ApiError, digest, parse, emailSchema } from './validation.mjs';
import { newId, audit } from './db.mjs';
export const SESSION_COOKIE = 'webdev_app_session';
const STATE_COOKIE = 'taswiqat_oauth_state';
const secret = env => { if (!env.MANUS_JWT_SECRET || !env.MANUS_PROJECT_ID) fail(503,'auth_not_configured','مصادقة Manus غير مهيأة'); return new TextEncoder().encode(env.MANUS_JWT_SECRET); };
export function validateOrigin(value, env = process.env) {
  try {
    if (typeof value!=='string' || value.length>2048 || value.trim()!==value) throw new Error();
    const u = new URL(value);
    const local = env.TASWIQAT_ALLOW_LOCALHOST === 'true' && u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
    if ((!local && u.protocol !== 'https:') || u.username || u.password || u.pathname !== '/' || u.search || u.hash || u.origin === 'null' || value.length > 2048) throw new Error();
    return u.origin;
  } catch { fail(400,'invalid_origin','عنوان المتصفح يجب أن يكون أصل HTTPS صالحًا'); }
}
export function cookieOptions(origin, env=process.env) {
  const plain = env.TASWIQAT_ALLOW_LOCALHOST === 'true' && origin?.startsWith('http://');
  return { httpOnly:true,secure:!plain,sameSite:plain ? 'lax':'none',path:'/' };
}
export async function verifySessionToken(token, env=process.env) {
  if (typeof token !== 'string' || token.length > 12000) fail(401,'invalid_session','جلسة غير صالحة');
  try {
    const { payload } = await jwtVerify(token,secret(env),{algorithms:['HS256']});
    if (!Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now()/1000) || payload.appId !== env.MANUS_PROJECT_ID || typeof payload.openId !== 'string' || !payload.openId || payload.openId.length>255) throw new Error();
    if (payload.origin) validateOrigin(payload.origin,env);
    return payload;
  } catch(e) { if (e instanceof ApiError && e.status===503) throw e; fail(401,'invalid_session','جلسة منتهية أو غير صالحة'); }
}
export function csrfToken(token, env=process.env) { secret(env); return createHmac('sha256',env.MANUS_JWT_SECRET).update(`taswiqat:csrf:${digest(token)}`).digest('base64url'); }
const safeEqual = (a,b) => typeof a==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function checkCsrf(req, env=process.env) {
  if (!safeEqual(req.get('X-CSRF-Token'),csrfToken(req.auth.token,env))) fail(403,'csrf_invalid','رمز حماية الطلب غير صالح');
  const incoming = req.get('Origin');
  const supplied = req.get('X-Taswiqat-Origin');
  if (!incoming && !supplied) return;
  const browserOrigin = supplied ? validateOrigin(supplied,env) : null;
  let origin;
  try {
    origin = incoming ? validateOrigin(incoming,env) : browserOrigin;
  } catch (error) {
    // Cloud Preview rewrites Origin to its internal loopback listener. A custom
    // origin header alone never authenticates: the session HMAC above is required,
    // and the HTTPS origin below must still match the signed session/allowlist.
    const peer = req.socket?.remoteAddress;
    const host = req.get('Host');
    const loopbackPeer = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer);
    let internal = false;
    try {
      const wire = new URL(incoming);
      internal = loopbackPeer && wire.protocol === 'http:' &&
        ['127.0.0.1','localhost','[::1]'].includes(wire.hostname) &&
        wire.origin === `http://${host}` && wire.pathname === '/' &&
        !wire.username && !wire.password && !wire.search && !wire.hash;
    } catch { /* Null/malformed origins stay rejected. */ }
    if (!browserOrigin || !internal) throw error;
    origin = browserOrigin;
  }
  if (browserOrigin && browserOrigin !== origin) fail(403,'origin_mismatch','مصدر الطلب غير مسموح');
  if (req.auth.payload.origin) {
    if (origin!==req.auth.payload.origin) fail(403,'origin_mismatch','مصدر الطلب غير مسموح');
    return;
  }
  // Preview tokens have no origin. Match exact browser host, never wildcard subdomains.
  const trusted = (env.TASWIQAT_PUBLIC_ORIGINS || '').split(',').filter(Boolean).map(v=>validateOrigin(v.trim(),env));
  const directHost=req.get('Host');
  const forwardedHost=env.TASWIQAT_TRUST_PROXY === 'true' && req.get('X-Forwarded-Proto') === 'https' ? req.get('X-Forwarded-Host') : null;
  const host=forwardedHost || directHost;
  if (host && /^[a-zA-Z0-9.[\]:-]+$/.test(host)) {
    try { trusted.push(validateOrigin(`${origin.startsWith('http:')?'http':'https'}://${host}`,env)); } catch { /* invalid hosts never trusted */ }
  }
  if (!trusted.includes(origin)) fail(403,'origin_mismatch','مصدر الطلب لا يطابق عنوان التطبيق');
}
export function authMiddleware(db,env=process.env) {
  return async(req,res,next)=>{
    try {
      const token=req.cookies?.[SESSION_COOKIE];
      if (!token) fail(401,'authentication_required','يرجى تسجيل الدخول');
      const payload=await verifySessionToken(token,env);
      const revoked=await db.query('SELECT token_hash FROM taswiqat_revocations WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3)',[digest(token)]);
      if (revoked.length) fail(401,'invalid_session','تم تسجيل الخروج');
      const rows=await db.query('SELECT * FROM taswiqat_users WHERE open_id=?',[payload.openId]);
      // Unlinked Preview JWT is not an authoritative identity source; complete OAuth first.
      if (!rows.length) fail(401,'oauth_link_required','أكمل تسجيل الدخول لربط هويتك');
      const user=rows[0];
      if (user.open_id!==payload.openId) fail(401,'invalid_session','هوية جلسة غير مطابقة');
      if (user.status!=='active') fail(403,'user_suspended','الحساب موقوف');
      if (user.role==='admin') {
        const pins=await db.query('SELECT pinned_open_id FROM taswiqat_private_admin WHERE id=1');
        if (pins[0]?.pinned_open_id!==user.open_id) fail(403,'admin_not_pinned','هوية المدير غير مثبتة');
      }
      req.auth={token,payload,user}; next();
    } catch(e) { next(e); }
  };
}
export const requireAdmin = (req,res,next) => req.auth.user.role==='admin' ? next() : next(new ApiError(403,'admin_required','صلاحية مدير النظام مطلوبة'));
async function rpc(env, method, body) {
  if (!env.MANUS_OAUTH_API_URL) fail(503,'auth_not_configured','خدمة تسجيل الدخول غير مهيأة');
  let response, data;
  try {
    response=await fetch(`${env.MANUS_OAUTH_API_URL.replace(/\/$/,'')}/webdev.v1.WebDevAuthPublicService/${method}`,{method:'POST',headers:{'Content-Type':'application/json','connect-protocol-version':'1'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    data=await response.json();
  } catch { fail(502,'oauth_provider_error','تعذر التواصل مع مزوّد الهوية'); }
  if (!response.ok || data.error) fail(502,'oauth_provider_error','رفض مزوّد الهوية الطلب');
  return data;
}
export function mountAuthRoutes(app, db, env, wrap, authenticate) {
  app.get('/api/auth/start',wrap(async(req,res)=>{
    secret(env);
    if (!env.MANUS_OAUTH_PORTAL_URL || !env.MANUS_OAUTH_API_URL) fail(503,'auth_not_configured','تسجيل الدخول غير مهيأ');
    const origin=validateOrigin(req.query.origin,env);
    if (req.query.target!==undefined && !['app','admin'].includes(req.query.target)) fail(400,'invalid_target','وجهة غير صالحة');
    const nonce=randomBytes(32).toString('base64url');
    const redirectUri=`${origin}/api/auth/callback`;
    const target=req.query.target || 'app';
    const state=Buffer.from(JSON.stringify({redirectUri,nonce})).toString('base64');
    const cookie=await new SignJWT({appId:env.MANUS_PROJECT_ID,nonce,redirectUri,origin,target,kind:'oauth_state'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(secret(env));
    await db.query('INSERT INTO taswiqat_oauth_nonces(nonce_hash,expires_at) VALUES(?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))',[digest(nonce)]);
    res.cookie(STATE_COOKIE,cookie,{...cookieOptions(origin,env),maxAge:600000});
    const url=new URL('/app-auth',env.MANUS_OAUTH_PORTAL_URL);
    url.search=new URLSearchParams({appId:env.MANUS_PROJECT_ID,redirectUri,state,responseType:'code'}).toString();
    res.json({url:url.toString()});
  }));
  app.get('/api/auth/callback',wrap(async(req,res)=>{
    let bound,state;
    try {
      const verified=await jwtVerify(req.cookies?.[STATE_COOKIE] || '',secret(env),{algorithms:['HS256']});
      bound=verified.payload;
      if (typeof req.query.state!=='string' || req.query.state.length>8000) throw new Error();
      state=JSON.parse(Buffer.from(req.query.state,'base64').toString());
      if (bound.kind!=='oauth_state' || bound.appId!==env.MANUS_PROJECT_ID || !bound.exp || state.nonce!==bound.nonce || state.redirectUri!==bound.redirectUri || bound.redirectUri!==`${validateOrigin(bound.origin,env)}/api/auth/callback`) throw new Error();
    } catch { fail(400,'oauth_state_invalid','طلب دخول غير صالح أو منتهي'); }
    res.clearCookie(STATE_COOKIE,cookieOptions(bound.origin,env));
    if (typeof req.query.code!=='string' || !req.query.code || req.query.code.length>4096) fail(400,'oauth_code_missing','رمز تسجيل الدخول مفقود');
    const result=await db.query('UPDATE taswiqat_oauth_nonces SET used=TRUE WHERE nonce_hash=? AND used=FALSE AND expires_at>UTC_TIMESTAMP(3)',[digest(bound.nonce)]);
    if (result.affectedRows!==1) fail(400,'oauth_state_used','طلب الدخول مستخدم أو منتهي');
    const token=await rpc(env,'ExchangeToken',{clientId:env.MANUS_PROJECT_ID,grantType:'authorization_code',code:req.query.code,redirectUri:bound.redirectUri});
    if (typeof token.accessToken!=='string' || !token.accessToken) fail(502,'oauth_provider_error','لم يرسل المزوّد رمز دخول');
    const identity=await rpc(env,'GetUserInfo',{accessToken:token.accessToken});
    const info=parse(z.object({openId:z.string().min(1).max(255),name:z.string().max(160).default(''),email:z.union([emailSchema,z.literal('')]).default('')}).passthrough(),identity);
    const user=await db.transaction(async tx=>{
      const pins=await tx.query('SELECT * FROM taswiqat_private_admin WHERE id=1 FOR UPDATE');
      const pin=pins[0];
      if (pin && !pin.pinned_open_id && info.email && info.email===pin.email) {
        await tx.query('UPDATE taswiqat_private_admin SET pinned_open_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=1 AND pinned_open_id IS NULL',[info.openId]);
        pin.pinned_open_id=info.openId;
        await audit(tx,null,'admin_identity_pinned',null,{});
      }
      const role=pin?.pinned_open_id===info.openId ? 'admin':'user';
      const old=await tx.query('SELECT * FROM taswiqat_users WHERE open_id=?',[info.openId]);
      const id=old[0]?.id || newId('u');
      if (old[0] && old[0].open_id!==info.openId) fail(409,'identity_collision','تعارض هوية يتطلب مراجعة إعداد قاعدة البيانات');
      if (old[0] && old[0].status!=='active') fail(403,'user_suspended','الحساب موقوف');
      if (!old.length && role!=='admin') {
        const settings=await tx.query('SELECT settings_json FROM taswiqat_site_settings WHERE id=1');
        const value=typeof settings[0]?.settings_json==='string' ? JSON.parse(settings[0].settings_json):settings[0]?.settings_json;
        if (value?.registrationEnabled===false) fail(403,'registration_disabled','تسجيل مستخدمين جدد موقوف حاليًا');
      }
      if (old.length) await tx.query('UPDATE taswiqat_users SET name=?,email=?,email_authoritative=TRUE,role=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[info.name,info.email,role,id]);
      else await tx.query('INSERT INTO taswiqat_users(id,open_id,name,email,email_authoritative,role) VALUES(?,?,?,?,TRUE,?)',[id,info.openId,info.name,info.email,role]);
      await audit(tx,id,'login',id,{});
      return {id,role};
    });
    const session=await new SignJWT({openId:info.openId,appId:env.MANUS_PROJECT_ID,origin:bound.origin,jti:newId('s')}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(secret(env));
    res.cookie(SESSION_COOKIE,session,{...cookieOptions(bound.origin,env),maxAge:604800000});
    const target=bound.target==='admin' && user.role==='admin' ? '/admin.html':'/#app';
    res.redirect(302,`${bound.origin}${target}`);
  }));
  app.post('/api/auth/logout',authenticate,wrap(async(req,res)=>{
    checkCsrf(req,env);
    await db.query('INSERT IGNORE INTO taswiqat_revocations(token_hash,expires_at) VALUES(?,?)',[digest(req.auth.token),new Date(req.auth.payload.exp*1000)]);
    res.clearCookie(SESSION_COOKIE,cookieOptions(req.auth.payload.origin,env));
    res.json({ok:true});
  }));
}
