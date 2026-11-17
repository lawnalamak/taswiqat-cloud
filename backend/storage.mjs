import { z } from 'zod';
import { parse, decodeMedia, fail, MAX_MEDIA_BYTES } from './validation.mjs';
import { getWorkspace, limitsFor } from './workspaces.mjs';
import { newId, audit } from './db.mjs';
const uploadSchema=z.object({name:z.string().min(1).max(255),type:z.enum(['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm']),data:z.string().max(4200000)}).strict();
export function mountStorageRoutes(app,db,env,wrap) {
  app.post('/api/workspaces/:id/media',wrap(async(req,res)=>{
    const input=parse(uploadSchema,req.body);
    const bytes=decodeMedia(input);
    const w=await getWorkspace(db,req.params.id,req.auth.user.id,{write:true});
    await limitsFor(db,w.id,{write:true});
    if (!env.MANUS_API_URL || !env.MANUS_API_KEY) fail(503,'storage_not_configured','التخزين غير مهيأ؛ يمكن حفظ dataURL الآمن ضمن حدود الحالة');
    const counts=await db.query('SELECT COUNT(*) AS n,COALESCE(SUM(byte_size),0) AS total FROM taswiqat_media WHERE workspace_id=?',[w.id]);
    if (Number(counts[0].n)>=500 || Number(counts[0].total)+bytes.length>100*MAX_MEDIA_BYTES) fail(409,'storage_quota','تم بلوغ حد مساحة الوسائط');
    const id=newId('media');
    const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm'};
    const key=`taswiqat/${w.id}/${id}.${extensions[input.type]}`;
    try {
      const presign=new URL('/v1/storage/presign/put',env.MANUS_API_URL);
      presign.searchParams.set('path',key);
      const response=await fetch(presign,{headers:{Authorization:`Bearer ${env.MANUS_API_KEY}`},signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      if (!response.ok || data.error || typeof data.url!=='string') throw new Error();
      const signed=new URL(data.url);
      if (signed.protocol!=='https:') throw new Error();
      const upload=await fetch(signed,{method:'PUT',headers:{'Content-Type':input.type},body:bytes,signal:AbortSignal.timeout(30000)});
      if (!upload.ok) throw new Error();
    } catch { fail(502,'storage_upload_failed','لم يؤكد التخزين نجاح رفع الملف'); }
    await db.transaction(async tx=>{
      await getWorkspace(tx,w.id,req.auth.user.id,{write:true});
      await limitsFor(tx,w.id,{write:true});
      const current=await tx.query('SELECT COUNT(*) AS n,COALESCE(SUM(byte_size),0) AS total FROM taswiqat_media WHERE workspace_id=?',[w.id]);
      if (Number(current[0].n)>=500 || Number(current[0].total)+bytes.length>100*MAX_MEDIA_BYTES) fail(409,'storage_quota','تم بلوغ حد مساحة الوسائط');
      await tx.query('INSERT INTO taswiqat_media(id,workspace_id,user_id,object_key,name,mime_type,byte_size) VALUES(?,?,?,?,?,?,?)',[id,w.id,req.auth.user.id,key,input.name,input.type,bytes.length]);
      await audit(tx,req.auth.user.id,'media_uploaded',w.id,{mediaId:id,size:bytes.length});
    });
    res.status(201).json({media:{id,name:input.name,type:input.type,url:`/manus-storage/${key}`,size:bytes.length}});
  }));
}
