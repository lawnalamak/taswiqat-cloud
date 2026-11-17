import { pathToFileURL } from 'node:url';
import { createDatabase, audit } from './db.mjs';
import { parse, emailSchema, fail } from './validation.mjs';
export async function configureAdmin(db, email, change=false) {
  email=parse(emailSchema,email);
  await db.transaction(async tx=>{
    const rows=await tx.query('SELECT * FROM taswiqat_private_admin WHERE id=1 FOR UPDATE');
    const old=rows[0];
    if (old && old.email===email && !change) return;
    if (old && !change) fail(409,'explicit_change_required','المدير مضبوط سابقًا؛ استخدم --change لتغيير الربط صراحة');
    if (old) {
      await tx.query("UPDATE taswiqat_users SET role='user' WHERE role='admin'");
      await tx.query('UPDATE taswiqat_private_admin SET email=?,pinned_open_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=1',[email]);
    } else await tx.query('INSERT INTO taswiqat_private_admin(id,email) VALUES(1,?)',[email]);
    await audit(tx,null,'admin_allowlist_configured',null,{explicitChange:!!old});
  });
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const db=createDatabase();
  try {
    let input='';
    for await (const chunk of process.stdin) { input+=chunk; if (input.length>1024) throw new Error('Input too long'); }
    if (input.trim().split(/\r?\n/).length!==1) throw new Error('Supply exactly one email on stdin');
    if (process.argv.slice(2).some(x=>x!=='--change')) throw new Error('Only --change is supported; email must be stdin');
    await configureAdmin(db,input.trim(),process.argv.includes('--change'));
    console.log('Private administrator allowlist saved. Authoritative OAuth callback is required to pin the identity.');
  } catch(e) { console.error(e.code==='explicit_change_required' ? e.message:'Administrator configuration failed; check stdin email, schema and DB permissions.'); process.exitCode=1; } finally { await db.close(); }
}
