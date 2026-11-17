import test from 'node:test';
import assert from 'node:assert/strict';
import { parse,workspaceStateSchema,validateState,enforceEmployeeState,canonicalPosts,decodeMedia,MAX_MEDIA_BYTES,invitationSchema } from '../backend/validation.mjs';
import { enforceImmutableUsers, validateAdminCollections } from '../backend/admin.mjs';
import { assertMemberCapacity } from '../backend/workspaces.mjs';
const base=()=>({business:{name:'Offline business',type:'retail',market:'',website:'',bio:''},selected:['ig'],posts:[],campaigns:[],team:[],theme:'light'});
const post=(author='me',status='draft')=>({id:'post1',title:'Offline fixture',text:'Test',channels:['ig'],media:null,campaignId:null,scheduledFor:null,status,author,updatedAt:'2026-01-01T00:00:00.000Z'});
test('strict state bounds reject invented published status and duplicate channels',()=>{
  const state=base();state.posts=[post()];
  assert.doesNotThrow(()=>validateState(parse(workspaceStateSchema,state)));
  state.posts[0].status='published';assert.throws(()=>parse(workspaceStateSchema,state));
  state.posts=[];state.selected=['ig','ig'];assert.throws(()=>parse(workspaceStateSchema,state));
  state.selected=['ig'];state.extra='ignored?';assert.throws(()=>parse(workspaceStateSchema,state));
});
test('state validates references, post IDs and planned dates',()=>{
  const state=base();state.posts=[post('me','planned')];assert.throws(()=>validateState(state),e=>e.code==='invalid_schedule');
  state.posts=[post(),post()];assert.throws(()=>validateState(state),e=>e.code==='duplicate_id');
  state.posts=[{...post(),campaignId:'missing'}];assert.throws(()=>validateState(state),e=>e.code==='invalid_campaign');
  state.posts=[{...post(),channels:['fb']}];assert.throws(()=>validateState(state),e=>e.code==='invalid_channel');
});
test('employee can create/change only own draft or review with immutable config',()=>{
  const old=base();old.posts=[post()];
  const next=structuredClone(old);next.posts[0].text='changed';next.posts[0].status='review';
  assert.doesNotThrow(()=>enforceEmployeeState(old,next,'me'));
  next.posts[0].status='ready';assert.throws(()=>enforceEmployeeState(old,next,'me'),e=>e.status===403);
  next.posts[0].status='review';next.business.name='other';assert.throws(()=>enforceEmployeeState(old,next,'me'));
});
test('employee cannot edit/delete others or demote approved posts, and cannot delete own posts',()=>{
  for (const original of [post('other'),post('me','ready'),post('me','planned')]) {
    const old=base();old.posts=[original];const next=structuredClone(old);next.posts[0].text='tampered';next.posts[0].status='draft';
    assert.throws(()=>enforceEmployeeState(old,next,'me'),e=>e.code==='employee_scope');
    next.posts=[];assert.throws(()=>enforceEmployeeState(old,next,'me'));
  }
  const old=base();old.posts=[post()];const next=base();assert.throws(()=>enforceEmployeeState(old,next,'me'));
});
test('server preserves author and generates update timestamp on actual edits',()=>{
  const old=base();old.posts=[post()];const next=structuredClone(old);next.posts[0].text='changed';
  const result=canonicalPosts(old,next,'me',['me']);assert.notEqual(result[0].updatedAt,old.posts[0].updatedAt);
  next.posts[0].author='other';assert.throws(()=>canonicalPosts(old,next,'me',['me','other']),e=>e.code==='immutable_author');
  next.posts=[{...post('other'),id:'new'}];assert.throws(()=>canonicalPosts(old,next,'me',['me','other']));
});
test('media accepts only canonical allowlisted dataURL with matching signatures and 3 MiB decoded cap',()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10]);
  const data='data:image/png;base64,'+png.toString('base64');
  assert.equal(decodeMedia({type:'image/png',data}).length,8);
  for (const payload of [{type:'image/svg+xml',data:'data:image/svg+xml;base64,PHN2Zz4='},{type:'image/png',data:'data:image/png;base64,PGh0bWw+'},{type:'image/jpeg',data},{type:'image/png',data:'data:image/png;base64,!!!!!'}]) assert.throws(()=>decodeMedia(payload));
  const oversized=Buffer.alloc(MAX_MEDIA_BYTES+1);png.copy(oversized);
  assert.throws(()=>decodeMedia({type:'image/png',data:'data:image/png;base64,'+oversized.toString('base64')}),e=>e.status===413);
});
test('unsafe media URLs and oversized collections fail validation',()=>{
  const state=base();state.posts=[{...post(),media:{name:'x',type:'image/png',url:'https://attacker.example/evil.svg'}}];
  assert.throws(()=>validateState(state),e=>e.code==='invalid_media_url');
  state.posts=Array.from({length:501},(_,i)=>({...post(),id:'p'+i}));assert.throws(()=>parse(workspaceStateSchema,state));
});
test('invitations forbid owner/admin roles and normalize email',()=>{
  assert.equal(parse(invitationSchema,{name:'n',email:' MEMBER@example.invalid ',role:'employee'}).email,'member@example.invalid');
  for (const role of ['owner','admin']) assert.throws(()=>parse(invitationSchema,{name:'n',email:'m@example.invalid',role}));
});
test('member quota reserves pending invitations and refuses growth',async()=>{
  const db={query:async sql=>[{n:sql.includes('memberships')?1:1}]};
  await assert.rejects(assertMemberCapacity(db,'w',{members:2},1),e=>e.code==='member_quota');
  await assert.doesNotReject(assertMemberCapacity(db,'w',{members:2},0));
});
test('admin cannot manufacture login identities, edit roles/email or remove/suspend last admin',()=>{
  const users=[{id:'admin',role:'admin',email:'a@example.invalid',workspaceId:'',status:'active',name:'a'},{id:'regular',role:'user',email:'r@example.invalid',workspaceId:'w',status:'active',name:'r'}];
  assert.doesNotThrow(()=>enforceImmutableUsers(users,structuredClone(users)));
  assert.throws(()=>enforceImmutableUsers(users,[users[0],{...users[1],role:'admin'}]),e=>e.code==='immutable_identity');
  assert.throws(()=>enforceImmutableUsers(users,[users[0],{...users[1],email:'a@example.invalid'}]));
  assert.throws(()=>enforceImmutableUsers(users,[...users,{...users[1],id:'fake'}]),e=>e.code==='login_identity_creation_prohibited');
  assert.throws(()=>enforceImmutableUsers(users,[users[1]]),e=>e.code==='last_admin_protected');
  assert.throws(()=>enforceImmutableUsers(users,[{...users[0],status:'suspended'},users[1]]),e=>e.code==='last_admin_protected');
});
test('admin collection references and duplicate IDs are validated',()=>{
  const state={plans:[{id:'basic'}],workspaces:[{id:'w',planId:'basic'}],users:[],subscriptions:[],tickets:[]};
  assert.doesNotThrow(()=>validateAdminCollections(state));
  state.workspaces.push({...state.workspaces[0]});assert.throws(()=>validateAdminCollections(state),e=>e.code==='duplicate_id');
});
test('JSON object key order never grants or denies employee access or rewrites an unchanged post',()=>{
  const reverse=value=>Array.isArray(value)?value.map(reverse):value && typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverse(item)])):value;
  const old=base();
  old.posts=[post('other','ready'),{...post('me'),id:'my-post'}];
  old.team=[{id:'me',name:'M',email:'m@example.invalid',role:'employee',status:'active'}];
  const reordered=reverse(old);
  const parsed=parse(workspaceStateSchema,reordered);
  assert.doesNotThrow(()=>validateState(parsed));
  assert.doesNotThrow(()=>enforceEmployeeState(old,parsed,'me'));
  assert.equal(canonicalPosts(old,parsed,'me',['me','other'])[0],old.posts[0]);
  parsed.posts[1].text='actual employee edit';
  assert.doesNotThrow(()=>enforceEmployeeState(old,parsed,'me'));
  parsed.selected=['ig','x'];
  assert.throws(()=>enforceEmployeeState(old,parsed,'me'),e=>e.code==='employee_scope');
});
