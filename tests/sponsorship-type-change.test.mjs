import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const event='10000000-0000-4000-8000-000000000001', oldType='20000000-0000-4000-8000-000000000001', newType='20000000-0000-4000-8000-000000000002', company='30000000-0000-4000-8000-000000000001', booking='40000000-0000-4000-8000-000000000001',slot='50000000-0000-4000-8000-000000000001';
test('changing one sponsorship unit preserves allocations, counts and commercial totals',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table m2m_events(id uuid primary key);
 create table m2m_sponsorship_types(id uuid primary key,event_id uuid,category text,is_active boolean default true,capacity int);
 create table m2m_sponsorship_commitments(id uuid primary key default gen_random_uuid(),event_id uuid,event_company_id uuid,sponsorship_type_id uuid,status text,quantity int,confirmed_amount_minor int,invoice_reference text,payment_status text,notes text,contribution text,prize_value_minor int);
 create table m2m_sponsorship_units(id uuid primary key default gen_random_uuid(),event_id uuid,commitment_id uuid,unit_number int,hole_slot_id uuid unique,allocated_at timestamptz,allocated_by uuid,unique(commitment_id,unit_number));
 create table m2m_hole_sponsorship_slots(id uuid primary key,event_id uuid,sponsorship_type_id uuid);
 insert into m2m_events values('${event}');
 insert into m2m_sponsorship_types(id,event_id,category,capacity) values('${oldType}','${event}','alcoholic_hole',10),('${newType}','${event}','non_alcoholic_hole',10);
 insert into m2m_hole_sponsorship_slots values('${slot}','${event}',null);`);
 const original=await readFile('supabase/migrations/20260829053332_create_multi_event_golf_management.sql','utf8');
 await db.exec(original.slice(original.indexOf('create or replace function public.m2m_guard_sponsorship_capacity()'),original.indexOf('create or replace function public.m2m_guard_sponsorship_type_capacity()')));
 await db.exec(original.slice(original.indexOf('create or replace function public.m2m_sync_commitment_units_trigger()'),original.indexOf('create or replace function public.m2m_assign_tee_slot(')));
 await db.exec(await readFile('supabase/migrations/20260915113157_change_sponsorship_unit_type.sql','utf8'));
 await db.exec(`insert into m2m_sponsorship_commitments(id,event_id,event_company_id,sponsorship_type_id,status,quantity,confirmed_amount_minor,prize_value_minor,payment_status,invoice_reference) values('${booking}','${event}','${company}','${oldType}','confirmed',2,101,51,'paid','INV-1');`);
 for(const unitNumber of [1,2]) await t.test(`split allocated unit ${unitNumber} and replay safely`,async()=>{
  await db.exec('begin');
  try{
   const {rows:[unit]}=await db.query('update m2m_sponsorship_units set hole_slot_id=$1,allocated_at=now() where commitment_id=$2 and unit_number=$3 returning *',[slot,booking,unitNumber]);
   const change=()=>db.query('select m2m_change_sponsorship_unit_type($1,$2,$3) id',[event,unit.id,newType]);
   const first=await change();assert.deepEqual(await change(),first);
   const {rows:[moved]}=await db.query('select * from m2m_sponsorship_units where id=$1',[unit.id]);
   assert.equal(moved.hole_slot_id,slot);assert.equal(moved.commitment_id,first.rows[0].id);
   const {rows}=await db.query('select * from m2m_sponsorship_commitments order by sponsorship_type_id');
   assert.equal(rows.length,2);assert.equal(rows.reduce((sum,r)=>sum+r.quantity,0),2);
   assert.equal(rows.reduce((sum,r)=>sum+r.confirmed_amount_minor,0),101);
   assert.equal(rows.reduce((sum,r)=>sum+r.prize_value_minor,0),51);
   assert.ok(rows.every(r=>r.payment_status==='paid'&&r.invoice_reference==='INV-1'));
   assert.equal((await db.query('select count(*)::int n from m2m_sponsorship_units')).rows[0].n,2);
  }finally{await db.exec('rollback');}
 });
 for(const [name,setup] of [['full inventory',`update m2m_sponsorship_types set capacity=0 where id='${newType}'`],['cross-event target',`update m2m_sponsorship_types set event_id=gen_random_uuid() where id='${newType}'`],['restricted position',`update m2m_hole_sponsorship_slots set sponsorship_type_id='${oldType}';update m2m_sponsorship_units set hole_slot_id='${slot}' where unit_number=1`]]) await t.test(name,async()=>{
  await db.exec('begin');try{await db.exec(setup);await db.exec('savepoint attempt');
   const unit=(await db.query('select id from m2m_sponsorship_units where unit_number=1')).rows[0].id;
   await assert.rejects(db.query('select m2m_change_sponsorship_unit_type($1,$2,$3)',[event,unit,newType]));
   await db.exec('rollback to savepoint attempt');
   assert.equal((await db.query('select count(*)::int n from m2m_sponsorship_commitments')).rows[0].n,1);
  }finally{await db.exec('rollback');}
 });
});

test('admin type change uses one event-scoped operation; hosts are rejected',async t=>{
 process.env.SUPABASE_URL='https://sponsorship.test';process.env.SUPABASE_SECRET_KEY='test-secret';process.env.SUPABASE_PUBLISHABLE_KEY='test-public';
 const {default:handler}=await import('../api/v1/admin/sponsorships.js');
 let role='admin';const calls=[];
 t.mock.method(globalThis,'fetch',async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:input);calls.push({path:url.pathname,body:init.body?JSON.parse(init.body):null});
  if(url.pathname==='/auth/v1/user')return Response.json({id:company});
  if(url.pathname.endsWith('/m2m_profiles'))return Response.json({id:company,role,is_active:true});
  if(url.pathname.endsWith('/rpc/m2m_change_sponsorship_unit_type'))return Response.json(booking);
  if(url.pathname.endsWith('/m2m_audit_events'))return Response.json(null);
  throw new Error('Unexpected request');
 });
 const req={method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:{action:'changeUnitType',eventId:event,unitId:slot,sponsorshipTypeId:newType}};
 const res=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},end(text){this.body=JSON.parse(text);}});
 let r=res();await handler(req,r);assert.equal(r.statusCode,200);
 assert.deepEqual(calls.find(c=>c.path.endsWith('/rpc/m2m_change_sponsorship_unit_type')).body,{p_event:event,p_unit:slot,p_type:newType});
 calls.length=0;role='host';r=res();await handler(req,r);assert.equal(r.statusCode,403);assert.ok(!calls.some(c=>c.path.includes('/rpc/')));
});
