// 組込みDBと小さなUseCaseモデルの検証。NestJS APIや複数接続の競合テストではない。
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url));
const req=createRequire(resolve(process.env.FINANCE_VALIDATION_DEPS||'.','package.json'));
const {PGlite}=req('@electric-sql/pglite');
const parser=req('@apidevtools/swagger-parser');
const db=new PGlite();
for(const f of ['00_validation_prerequisites.sql','01_finance.sql','03_planning_records.sql'])
 await db.exec(await readFile(resolve(dir,'sql',f),'utf8'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
await db.query('INSERT INTO identity.users VALUES ($1),($2)',[id(1),id(2)]);
await db.query("INSERT INTO planning.trips(id,name,starts_on,ends_on) VALUES ($1,'旅行','2026-10-01','2026-10-03')",[id(10)]);
await db.query('INSERT INTO planning.trip_participants VALUES ($1,0,$2),($1,1,$3)',[id(10),id(1),id(2)]);
for(const p of [20,21,22]) await db.query("INSERT INTO planning.plans(id,trip_id,name,kind,planned_date) VALUES ($1,$2,'昼食','food','2026-10-01')",[id(p),id(10)]);
async function lock(tx,p) {
 await tx.query('SELECT id FROM planning.trips WHERE id=$1 FOR SHARE',[id(10)]);
 return (await tx.query('SELECT * FROM planning.plans WHERE id=$1 AND trip_id=$2 FOR NO KEY UPDATE',[id(p),id(10)])).rows[0];
}
async function add(p,event,kind) {
 await db.transaction(async tx=>{
  const plan=await lock(tx,p);
  assert.ok((kind==='achievement'?['place','food','shopping']:['food','lodging','transport']).includes(plan.kind),'PLAN_KIND_NOT_SUPPORTED');
  assert.ok(kind!=='achievement'||!plan.cancelled_at,'PLAN_CANCELLED');
  const occupied=await tx.query('SELECT event_id FROM record.active_plan_events WHERE plan_id=$1 AND event_kind=$2',[id(p),kind]);
  assert.equal(occupied.rows.length,0,'RECORD_ALREADY_ACTIVE');
  await tx.query('INSERT INTO record.plan_events(id,trip_id,plan_id,event_kind,created_by) VALUES ($1,$2,$3,$4,$5)',[id(event),id(10),id(p),kind,id(1)]);
  await tx.query('INSERT INTO record.active_plan_events VALUES ($1,$2,$3,$4)',[id(10),id(p),kind,id(event)]);
 });
}
async function cancel(p,event) {
 await db.transaction(async tx=>{
  await lock(tx,p);
  const old=await tx.query('SELECT event_id FROM record.plan_event_cancellations WHERE event_id=$1',[id(event)]);
  if(old.rows.length) return;
  await tx.query('INSERT INTO record.plan_event_cancellations(event_id,trip_id,cancelled_by) VALUES ($1,$2,$3)',[id(event),id(10),id(2)]);
  await tx.query('DELETE FROM record.active_plan_events WHERE event_id=$1',[id(event)]);
 });
}
async function change(p,kind,version) {
 await db.transaction(async tx=>{
  const plan=await lock(tx,p);
  assert.equal(String(plan.version),String(version),'VERSION_CONFLICT');
  const history=await tx.query('SELECT id FROM record.plan_events WHERE plan_id=$1',[id(p)]);
  assert.equal(history.rows.length,0,'PLAN_HAS_RECORD_HISTORY');
  await tx.query('UPDATE planning.plans SET kind=$1,version=version+1 WHERE id=$2',[kind,id(p)]);
 });
}
await add(20,100,'achievement'); await add(20,101,'booking');
await assert.rejects(add(20,102,'achievement'),/RECORD_ALREADY_ACTIVE/);
await cancel(20,100); await add(20,103,'achievement'); await cancel(20,100);
assert.equal((await db.query("SELECT event_id FROM record.active_plan_events WHERE plan_id=$1 AND event_kind='achievement'",[id(20)])).rows[0].event_id,id(103));
await cancel(20,103); await cancel(20,101);
await assert.rejects(change(20,'shopping',1),/PLAN_HAS_RECORD_HISTORY/);
await db.query('UPDATE planning.plans SET cancelled_at=now(),cancelled_by=$1 WHERE id=$2',[id(1),id(21)]);
await assert.rejects(add(21,104,'achievement'),/PLAN_CANCELLED/);
await add(21,105,'booking');
await db.query('INSERT INTO record.payments(id,trip_id,plan_id,amount_yen,payer_slot,slot0_percent,slot0_burden_yen,slot1_burden_yen,contribution_yen,created_by) VALUES ($1,$2,$3,1000,0,50,500,500,500,$4)',[id(200),id(10),id(22),id(1)]);
await change(22,'shopping',1);
await assert.rejects(change(22,'place',1),/VERSION_CONFLICT/);
await assert.rejects(add(22,106,'booking'),/PLAN_KIND_NOT_SUPPORTED/);
await assert.rejects(db.query('DELETE FROM record.plan_events WHERE id=$1',[id(100)]),e=>e.code==='55000');
const spec=await parser.validate(resolve(dir,'openapi.planning.json'));
assert.equal(Object.values(spec.paths).reduce((n,v)=>n+Object.keys(v).length,0),13);
await db.close();
console.log(JSON.stringify({passed:['DDL適用','達成・予約の併存と同種重複拒否','取消後再登録・古い取消の再送','取消済み履歴でも種類変更拒否','取りやめ済み達成拒否・予約許可','支払いのみなら種類変更可能','古いversionの拒否','不適切種類への予約拒否','履歴削除拒否','OpenAPI13操作の形式・参照'],limitations:['UseCaseのモデルであり実API未実装','複数接続の競合未検証','旅行期間の同時更新は統合テストが必要']},null,2));
