// 旅行・ホームの設計モデル検証。実API、同時接続、Vercelの検証ではない。
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
for(const f of ['00_validation_prerequisites.sql','01_finance.sql','02_auth_allowlist.sql','03_planning_records.sql','04_trip_lifecycle.sql'])
 await db.exec(await readFile(resolve(dir,'sql',f),'utf8'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
await db.query('INSERT INTO identity.users VALUES ($1),($2)',[id(1),id(2)]);
await db.query('INSERT INTO identity.allowed_google_accounts(slot,user_id,google_sub) VALUES (0,$1,$2),(1,$3,$4)',[id(1),'test-sub-a',id(2),'test-sub-b']);
async function createTrip(t,fail=false) {
 await db.transaction(async tx=>{
  const {rows:users}=await tx.query('SELECT slot,user_id FROM identity.allowed_google_accounts WHERE enabled ORDER BY slot FOR SHARE');
  assert.equal(users.length,2,'PARTICIPANTS_NOT_READY');
  await tx.query("INSERT INTO planning.trips(id,name,starts_on,ends_on,created_by) VALUES ($1,'京都旅行','2026-10-01','2026-10-03',$2)",[id(t),id(1)]);
  for(const u of users) await tx.query('INSERT INTO planning.trip_participants VALUES ($1,$2,$3)',[id(t),u.slot,u.user_id]);
  await tx.query('INSERT INTO infra.trip_finance_guards(trip_id) VALUES ($1)',[id(t)]);
  if(fail) throw Error('ROLLBACK_TEST');
 });
}
await assert.rejects(createTrip(9,true),/ROLLBACK_TEST/);
for(const table of ['planning.trips','planning.trip_participants','infra.trip_finance_guards'])
 assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
await createTrip(10);
assert.equal((await db.query('SELECT count(*)::int n FROM planning.trip_participants WHERE trip_id=$1',[id(10)])).rows[0].n,2);
await db.query('UPDATE identity.allowed_google_accounts SET enabled=false WHERE slot=1');
await assert.rejects(createTrip(11),/PARTICIPANTS_NOT_READY/);
await db.query('UPDATE identity.allowed_google_accounts SET enabled=true WHERE slot=1');
async function transition(to,version) {
 return db.transaction(async tx=>{
  const trip=(await tx.query('SELECT * FROM planning.trips WHERE id=$1 FOR UPDATE',[id(10)])).rows[0];
  assert.equal(String(trip.version),String(version),'VERSION_CONFLICT');
  if(trip.status===to) return;
  assert.ok((trip.status==='planning'&&to==='traveling')||(trip.status==='traveling'&&to==='finished'),'INVALID_TRIP_TRANSITION');
  if(to==='traveling') await tx.query("UPDATE planning.trips SET status='traveling',started_at=now(),started_by=$2,version=version+1 WHERE id=$1",[id(10),id(1)]);
  else await tx.query("UPDATE planning.trips SET status='finished',finished_at=now(),finished_by=$2,version=version+1 WHERE id=$1",[id(10),id(2)]);
 });
}
await assert.rejects(transition('finished',1),/INVALID_TRIP_TRANSITION/);
await transition('traveling',1);
await assert.rejects(transition('finished',1),/VERSION_CONFLICT/);
await transition('finished',2);
await transition('finished',3);
await assert.rejects(transition('traveling',3),/INVALID_TRIP_TRANSITION/);
await db.query('INSERT INTO record.payments(id,trip_id,amount_yen,payer_slot,slot0_percent,slot0_burden_yen,slot1_burden_yen,contribution_yen,created_by) VALUES ($1,$2,6000,0,50,3000,3000,3000,$3)',[id(100),id(10),id(1)]);
assert.equal(String((await db.query('SELECT sum(contribution_yen) n FROM settlement.pending_items WHERE trip_id=$1',[id(10)])).rows[0].n),'3000');
const context=(status,today,start,end)=>status==='finished'?'completed':today<start?'before':today>end?'after_dates':'during';
assert.equal(context('planning','2026-09-30','2026-10-01','2026-10-03'),'before');
assert.equal(context('planning','2026-10-01','2026-10-01','2026-10-03'),'during');
assert.equal(context('traveling','2026-10-03','2026-10-01','2026-10-03'),'during');
assert.equal(context('traveling','2026-10-04','2026-10-01','2026-10-03'),'after_dates');
assert.equal(context('finished','2026-09-30','2026-10-01','2026-10-03'),'completed');
assert.equal(context('traveling','2026-09-30','2026-10-01','2026-10-03'),'before');
for(const f of ['openapi.trips.json','openapi.planning.json']) await parser.validate(resolve(dir,f));
await db.close();
console.log(JSON.stringify({passed:['DDL適用','作成失敗時の旅行・参加者・guardのロールバック','二人の参加者登録','参加者不足拒否','状態遷移と不正遷移拒否','古いversion拒否','同じ状態で重複更新なし','終了後も支払い登録・未精算保持','ホームの6つの日付・状態分岐','旅行7操作・予定13操作のOpenAPI形式'],limitations:['UseCaseモデルであり実APIではない','同時旅行作成とreceipt再送の競合は未検証','ホームのSAVEPOINT部分回復・UI未検証']},null,2));
