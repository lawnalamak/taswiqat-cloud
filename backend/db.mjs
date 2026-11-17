import mysql from 'mysql2/promise';
import { ApiError } from './validation.mjs';
export const json = value => typeof value === 'string' ? JSON.parse(value) : value;
export const newId = () => globalThis.crypto.randomUUID();
export function createDatabase(env = process.env) {
  let pool;
  function getPool() {
    if (pool) return pool;
    if (!env.DATABASE_URL) throw new ApiError(503,'database_unavailable','قاعدة البيانات غير مهيأة');
    const u = new URL(env.DATABASE_URL);
    if (!['mysql:','mysql2:'].includes(u.protocol)) throw new Error('MySQL DATABASE_URL required');
    const sslParam = u.searchParams.get('ssl');
    let ssl;
    if (sslParam?.startsWith('{')) {
      const options=JSON.parse(sslParam);
      if (options.rejectUnauthorized===false) throw new Error('Insecure DB TLS is not allowed');
      ssl={rejectUnauthorized:true};
      if (typeof options.ca==='string') ssl.ca=options.ca;
    } else if (['require','required','verify-full','verify-ca'].includes(u.searchParams.get('sslmode')) || ['true','1'].includes(sslParam)) ssl={rejectUnauthorized:true};
    pool = mysql.createPool({ host:u.hostname,port:Number(u.port || 3306),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:decodeURIComponent(u.pathname.slice(1)),waitForConnections:true,connectionLimit:5,queueLimit:50,connectTimeout:10000,charset:'utf8mb4',timezone:'Z',ssl,enableKeepAlive:true });
    return pool;
  }
  const db = {
    get pool() { return getPool(); },
    async query(sql,args=[]) { const [rows] = await getPool().execute(sql,args); return rows; },
    async transaction(fn, { mutation = true } = {}) {
      const conn = await getPool().getConnection();
      const tx = { query: async(sql,args=[]) => { const [rows] = await conn.execute(sql,args); return rows; } };
      try {
        await conn.beginTransaction();
        // One canonical revision lock orders every domain mutation and prevents blind admin overwrite.
        if (mutation) {
          const rows = await tx.query('SELECT version FROM taswiqat_revision WHERE id=1 FOR UPDATE');
          if (!rows.length) throw new ApiError(503,'schema_not_ready','يرجى تشغيل المهاجرات');
          tx.version = Number(rows[0].version);
        }
        const result = await fn(tx);
        if (mutation) await tx.query('UPDATE taswiqat_revision SET version=version+1 WHERE id=1');
        await conn.commit();
        return result;
      } catch (e) { await conn.rollback().catch(()=>{}); throw e; } finally { conn.release(); }
    },
    async close() { if (pool) { await pool.end(); pool=undefined; } }
  };
  return db;
}
export async function audit(tx, actor, action, entityId=null, detail={}) {
  await tx.query('INSERT INTO taswiqat_audit(actor_id,action,entity_id,detail_json) VALUES(?,?,?,?)',[actor || null,action,entityId,JSON.stringify(detail)]);
}
export function publicUser(row) { return { id:row.id,name:row.name,email:row.email,role:row.role }; }
export async function assertActiveUser(tx,userId) {
  const rows=await tx.query('SELECT * FROM taswiqat_users WHERE id=?',[userId]);
  if (!rows.length || rows[0].status !== 'active') throw new ApiError(403,'user_suspended','الحساب غير نشط');
  return rows[0];
}
