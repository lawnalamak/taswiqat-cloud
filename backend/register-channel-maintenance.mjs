import { pathToFileURL } from 'node:url';
import { createDatabase, audit } from './db.mjs';
import { MAINTENANCE_NAME, MAINTENANCE_TABLE } from './channel-maintenance.mjs';
export async function registerChannelMaintenance(db, taskUid) {
  if (typeof taskUid !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(taskUid)) throw new Error('Invalid task UID');
  const versions = await db.query('SELECT MAX(version) AS version FROM taswiqat_migrations');
  if (Number(versions[0]?.version) < 4) throw new Error('Channel schema v4 is required');
  return db.transaction(async tx => {
    const rows = await tx.query(`SELECT task_uid FROM ${MAINTENANCE_TABLE} WHERE name=? FOR UPDATE`,[MAINTENANCE_NAME]);
    if (rows.length) {
      if (rows[0].task_uid !== taskUid) throw new Error('Another maintenance task is already registered; inspect it rather than creating duplicates');
      return {registered:true,unchanged:true};
    }
    await tx.query(`INSERT INTO ${MAINTENANCE_TABLE}(name,task_uid) VALUES(?,?)`,[MAINTENANCE_NAME,taskUid]);
    await audit(tx,null,'channel_maintenance_registered',null,{name:MAINTENANCE_NAME});
    return {registered:true,unchanged:false};
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--task-uid');
  if (index < 0 || !args[index+1] || !args.includes('--confirm-registration')) {
    console.error('Usage: node backend/register-channel-maintenance.mjs --task-uid <returned-task-uid> --confirm-registration');
    process.exitCode = 1;
  } else {
    const db = createDatabase();
    try { console.log(JSON.stringify(await registerChannelMaintenance(db,args[index+1]))); }
    catch { console.error('Maintenance registration failed. Check schema and existing job; do not recreate or overwrite a registered task blindly.');process.exitCode=1; }
    finally { await db.close(); }
  }
}
