import { jwtVerify } from 'jose';
import { fail } from './validation.mjs';
export const MAINTENANCE_NAME = 'youtube-maintenance';
export const MAINTENANCE_TABLE = 'taswiqat_channel_maintenance';
export const MAINTENANCE_DEFINITION = `CREATE TABLE IF NOT EXISTS ${MAINTENANCE_TABLE} (name VARCHAR(80) PRIMARY KEY, task_uid VARCHAR(160) NOT NULL UNIQUE, last_attempt_at DATETIME(3) NULL, last_success_at DATETIME(3) NULL, last_status VARCHAR(40) NOT NULL DEFAULT 'registered', last_result_json JSON NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`;
export async function resolveMaintenanceIdentity(jwt, env) {
  if (!env.MANUS_OAUTH_API_URL) fail(503,'maintenance_not_configured','خدمة الصيانة غير مهيأة');
  let response, data;
  try {
    response = await fetch(`${env.MANUS_OAUTH_API_URL.replace(/\/$/,'')}/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`, {
      method:'POST',headers:{'Content-Type':'application/json','connect-protocol-version':'1'},
      body:JSON.stringify({jwt_token:jwt,project_id:env.MANUS_PROJECT_ID}),signal:AbortSignal.timeout(10000),redirect:'error',
    });
    data = await response.json();
  } catch { fail(502,'maintenance_identity_unavailable','تعذّر التحقق من هوية الصيانة'); }
  if (!response.ok || !data || data.projectId !== env.MANUS_PROJECT_ID || typeof data.taskUid !== 'string' || !data.taskUid || !data.openId?.startsWith('cron_')) fail(403,'maintenance_identity_invalid','هوية الصيانة غير صالحة');
  return data;
}
export function mountChannelMaintenance(app, db, env, wrap, runMaintenance, services = {}) {
  app.post('/api/scheduled/youtube-maintenance', wrap(async (req,res) => {
    res.set('Cache-Control','private, no-store');
    const token = req.cookies?.app_session_id;
    if (typeof token !== 'string' || token.length > 12000) fail(401,'maintenance_authentication_required','هوية مهمة الصيانة مطلوبة');
    if (!env.MANUS_JWT_SECRET || !env.MANUS_PROJECT_ID) fail(503,'maintenance_not_configured','خدمة الصيانة غير مهيأة');
    let payload;
    try {
      ({payload} = await jwtVerify(token,new TextEncoder().encode(env.MANUS_JWT_SECRET),{algorithms:['HS256']}));
      if (!Number.isInteger(payload.exp) || payload.appId !== env.MANUS_PROJECT_ID || typeof payload.openId !== 'string' || !payload.openId.startsWith('cron_')) throw new Error();
    } catch { fail(403,'maintenance_identity_invalid','هوية الصيانة غير صالحة'); }
    const identity = await (services.identity || resolveMaintenanceIdentity)(token,env);
    if (identity.projectId !== env.MANUS_PROJECT_ID || identity.openId !== payload.openId || typeof identity.taskUid !== 'string' || !identity.taskUid) fail(403,'maintenance_identity_invalid','هوية الصيانة غير مطابقة');
    const rows = await db.query(`SELECT task_uid FROM ${MAINTENANCE_TABLE} WHERE name=?`,[MAINTENANCE_NAME]);
    if (rows[0]?.task_uid !== identity.taskUid) fail(403,'maintenance_task_unregistered','مهمة الصيانة غير معتمدة للتطبيق');
    // The registered job owns a fixed application-maintenance scope. Ignore all body selectors.
    await db.query(`UPDATE ${MAINTENANCE_TABLE} SET last_attempt_at=UTC_TIMESTAMP(3),last_status='running' WHERE name=? AND task_uid=?`,[MAINTENANCE_NAME,identity.taskUid]);
    try {
      const result = await runMaintenance(db,env,services.youtube || {});
      const disabled = result?.disabled === true || result?.ready === false;
      const failed = typeof result?.failed === 'number' && result.failed > 0;
      const degraded = failed || (typeof result?.revocationExpired === 'number' && result.revocationExpired > 0);
      const safe = {};
      for (const [key,value] of Object.entries(result || {})) if (/^[a-zA-Z_]{1,50}$/.test(key) && (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) safe[key] = value;
      await db.query(`UPDATE ${MAINTENANCE_TABLE} SET last_status=?,last_result_json=?,last_success_at=CASE WHEN ?=TRUE THEN UTC_TIMESTAMP(3) ELSE last_success_at END WHERE name=? AND task_uid=?`,[disabled?'disabled':degraded?'degraded':'succeeded',JSON.stringify(safe),!disabled && !degraded,MAINTENANCE_NAME,identity.taskUid]);
      res.status(failed ? 503 : 200).json({ok:!failed,...safe});
    } catch (error) {
      await db.query(`UPDATE ${MAINTENANCE_TABLE} SET last_status='failed' WHERE name=? AND task_uid=?`,[MAINTENANCE_NAME,identity.taskUid]).catch(()=>{});
      throw error;
    }
  }));
}
