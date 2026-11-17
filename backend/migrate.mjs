import { pathToFileURL } from 'node:url';
import { createDatabase } from './db.mjs';
export const SCHEMA_VERSION = 2;
export const TABLES = ['migrations','revision','private_admin','users','workspaces','memberships','invitations','plans','subscriptions','site_settings','tickets','audit','connections','media','oauth_nonces','revocations'].map(x => `taswiqat_${x}`);
const suffix = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const definitions = [
  `CREATE TABLE IF NOT EXISTS taswiqat_revision (id TINYINT PRIMARY KEY, version BIGINT UNSIGNED NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS taswiqat_private_admin (id TINYINT PRIMARY KEY, email VARCHAR(254) NOT NULL, pinned_open_id VARCHAR(255) NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_users (id VARCHAR(80) PRIMARY KEY, open_id VARCHAR(255) NOT NULL UNIQUE, name VARCHAR(160) NOT NULL, email VARCHAR(254) NOT NULL DEFAULT '', email_authoritative BOOLEAN NOT NULL DEFAULT FALSE, role ENUM('admin','user') NOT NULL DEFAULT 'user', status ENUM('active','suspended','archived') NOT NULL DEFAULT 'active', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(email))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_workspaces (id VARCHAR(80) PRIMARY KEY, name VARCHAR(160) NOT NULL, owner_id VARCHAR(80) NOT NULL, status ENUM('active','suspended','archived') NOT NULL DEFAULT 'active', state_json JSON NOT NULL, version BIGINT UNSIGNED NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(owner_id), INDEX(status))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_memberships (workspace_id VARCHAR(80) NOT NULL, user_id VARCHAR(80) NOT NULL, role ENUM('owner','manager','employee') NOT NULL, status ENUM('active','suspended') NOT NULL DEFAULT 'active', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(workspace_id,user_id), INDEX(user_id))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_invitations (id VARCHAR(80) PRIMARY KEY, workspace_id VARCHAR(80) NOT NULL, name VARCHAR(160) NOT NULL, email VARCHAR(254) NOT NULL, role ENUM('manager','employee') NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, status ENUM('pending','accepted','revoked') NOT NULL DEFAULT 'pending', expires_at DATETIME(3) NOT NULL, created_by VARCHAR(80) NOT NULL, accepted_by VARCHAR(80) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(workspace_id,status,expires_at))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_plans (id VARCHAR(80) PRIMARY KEY, data_json JSON NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS taswiqat_subscriptions (id VARCHAR(80) PRIMARY KEY, workspace_id VARCHAR(80) NOT NULL UNIQUE, plan_id VARCHAR(80) NOT NULL, status ENUM('trial','active','suspended','cancelled','expired') NOT NULL DEFAULT 'trial', trial_ends_at DATETIME(3) NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(plan_id,status))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_site_settings (id TINYINT PRIMARY KEY, site_json JSON NOT NULL, settings_json JSON NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS taswiqat_tickets (id VARCHAR(80) PRIMARY KEY, workspace_id VARCHAR(80) NOT NULL, user_id VARCHAR(80) NOT NULL, subject VARCHAR(240) NOT NULL, message TEXT NOT NULL, status ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(workspace_id,user_id,status))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_audit (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_id VARCHAR(80) NULL, action VARCHAR(100) NOT NULL, entity_id VARCHAR(80) NULL, detail_json JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(created_at))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_connections (id VARCHAR(80) PRIMARY KEY, workspace_id VARCHAR(80) NOT NULL, provider VARCHAR(40) NOT NULL, status VARCHAR(40) NOT NULL, public_json JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(workspace_id))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_media (id VARCHAR(80) PRIMARY KEY, workspace_id VARCHAR(80) NOT NULL, user_id VARCHAR(80) NOT NULL, object_key VARCHAR(500) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL, mime_type VARCHAR(80) NOT NULL, byte_size INT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(workspace_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_oauth_nonces (nonce_hash CHAR(64) PRIMARY KEY, expires_at DATETIME(3) NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE, INDEX(expires_at))`,
  `CREATE TABLE IF NOT EXISTS taswiqat_revocations (token_hash CHAR(64) PRIMARY KEY, expires_at DATETIME(3) NOT NULL, INDEX(expires_at))`
];
export const DEFAULT_SITE = { heroLine1: 'كل قنواتك.', heroLine2: 'مكان واحد.', heroDescription: 'مساحة موحّدة تساعد الأنشطة التجارية العربية على تنظيم قنواتها التسويقية ومحتواها وفريقها.', contactEmail: '', notice: '' };
export const DEFAULT_PLANS = [
  { id:'basic',name:'الأساسية',price:199,channels:2,members:1,active:true },
  { id:'pro',name:'الاحترافية',price:449,channels:5,members:5,active:true },
  { id:'enterprise',name:'المؤسسات',price:899,channels:11,members:20,active:true }
];
export async function migrate(db) {
  const connection = await db.pool.getConnection();
  try {
    const [lock] = await connection.query("SELECT GET_LOCK('taswiqat_migrations',30) AS acquired");
    if (Number(lock[0].acquired) !== 1) throw new Error('Migration lock unavailable');
    await connection.query(`CREATE TABLE IF NOT EXISTS taswiqat_migrations (version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))${suffix}`);
    const [done] = await connection.query('SELECT version FROM taswiqat_migrations WHERE version=1');
    if (!done.length) {
      for (const ddl of definitions) await connection.query(ddl + suffix);
      await connection.query('INSERT IGNORE INTO taswiqat_revision(id,version) VALUES(1,0)');
      await connection.query('INSERT IGNORE INTO taswiqat_site_settings(id,site_json,settings_json) VALUES(1,?,?)',[JSON.stringify(DEFAULT_SITE),JSON.stringify({})]);
      for (const plan of DEFAULT_PLANS) await connection.query('INSERT IGNORE INTO taswiqat_plans(id,data_json) VALUES(?,?)',[plan.id,JSON.stringify(plan)]);
      await connection.query('INSERT IGNORE INTO taswiqat_migrations(version) VALUES(1)');
    }
    const [v2] = await connection.query('SELECT version FROM taswiqat_migrations WHERE version=2');
    if (!v2.length) {
      for (const table of ['taswiqat_workspaces','taswiqat_subscriptions','taswiqat_tickets']) {
        const [columns] = await connection.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',[table,'admin_json']);
        if (!columns.length) await connection.query(`ALTER TABLE ${table} ADD COLUMN admin_json JSON NULL`);
      }
      await connection.query('INSERT IGNORE INTO taswiqat_migrations(version) VALUES(2)');
    }
    console.log(`taswiqat schema ready: v${SCHEMA_VERSION}`);
  } finally { await connection.query("SELECT RELEASE_LOCK('taswiqat_migrations')").catch(()=>{}); connection.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createDatabase();
  try { await migrate(db); } catch { console.error('Migration failed; inspect database configuration/schema permissions.'); process.exitCode=1; } finally { await db.close(); }
}
