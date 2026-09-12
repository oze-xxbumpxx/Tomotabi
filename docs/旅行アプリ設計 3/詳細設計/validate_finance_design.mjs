// 設計検証用。PGliteは単一接続の組込みPostgreSQLであり、Neon/TCPの同時実行検証ではない。
// npm install @electric-sql/pglite drizzle-orm@0.45.2 pg @apidevtools/swagger-parser
// FINANCE_VALIDATION_DEPS=<上記を入れたフォルダ> node validate_finance_design.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url));
const require=createRequire(resolve(process.env.FINANCE_VALIDATION_DEPS || '.', 'package.json'));
const { PGlite }=require('@electric-sql/pglite');
const { drizzle }=require('drizzle-orm/pglite');
const { sql }=require('drizzle-orm');
const parser=require('@apidevtools/swagger-parser');
const client=new PGlite();
const checks=[];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function reject(query, params, code) {
  try { await client.query(query,params); assert.fail(`expected ${code}`); }
  catch(e) { assert.equal(e.code,code,e.message); }
}
await client.exec(await readFile(resolve(dir,'sql/00_validation_prerequisites.sql'),'utf8'));
await client.exec(await readFile(resolve(dir,'sql/01_finance.sql'),'utf8'));
checks.push('DDL適用');
await client.query('INSERT INTO identity.users(id) VALUES ($1),($2)',[id(1),id(2)]);
await client.query('INSERT INTO planning.trips(id) VALUES ($1),($2)',[id(10),id(11)]);
for(const t of [id(10),id(11)]) {
  await client.query('INSERT INTO planning.trip_participants VALUES ($1,0,$2),($1,1,$3)',[t,id(1),id(2)]);
  await client.query('INSERT INTO infra.trip_finance_guards(trip_id) VALUES ($1)',[t]);
}
await client.query('INSERT INTO planning.plans VALUES ($1,$2)',[id(20),id(11)]);
const insertPayment=`INSERT INTO record.payments
 (id,trip_id,plan_id,amount_yen,payer_slot,slot0_percent,slot0_burden_yen,slot1_burden_yen,contribution_yen,created_by)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
const params=(p,amount=6000,b0=3000,b1=3000,c=3000,plan=null)=>[id(p),id(10),plan,amount,0,50,b0,b1,c,id(1)];
await client.query(insertPayment,params(100));
await reject(insertPayment,params(101,6000,3000,3000,3000,id(20)),'23503');
checks.push('別旅行の予定参照を拒否');
await reject(insertPayment,params(102,6000,3001,3000,3000),'23514');
await reject(insertPayment,params(103,1001,500,501,501),'23514');
await client.query(insertPayment,params(104,1001,501,500,500));
checks.push('負担額の合計・端数を検証');
await reject('UPDATE record.payments SET label=$1 WHERE id=$2',['changed',id(100)],'55000');
await reject('DELETE FROM record.payments WHERE id=$1',[id(100)],'55000');
checks.push('履歴のUPDATE/DELETEを拒否');

// ORMのトランザクションとSQL行ロックを組込みDBで確認。
const db=drizzle(client);
await assert.rejects(db.transaction(async tx=>{
  await tx.execute(sql`SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id=${id(10)} FOR UPDATE`);
  await tx.execute(sql`UPDATE infra.trip_finance_guards SET next_settlement_sequence=2 WHERE trip_id=${id(10)}`);
  throw new Error('expected rollback');
}),/expected rollback/);
assert.equal(String((await client.query('SELECT next_settlement_sequence FROM infra.trip_finance_guards WHERE trip_id=$1',[id(10)])).rows[0].next_settlement_sequence),'1');
checks.push('Drizzleで行ロックSQL・ロールバック');

// node-postgresアダプターでもロッククエリを生成できることを確認（接続は行わない）。
const { drizzle: drizzlePg }=require('drizzle-orm/node-postgres');
const { pgSchema,uuid }=require('drizzle-orm/pg-core');
const { Pool }=require('pg');
const pool=new Pool();
const pgdb=drizzlePg(pool);
const guards=pgSchema('infra').table('trip_finance_guards',{tripId:uuid('trip_id')});
assert.match(pgdb.select().from(guards).for('update').toSQL().sql,/for update/i);
await pool.end();
checks.push('node-postgresアダプターのFOR UPDATE生成（未接続）');

async function settle(pid, previewId, sid, kind, value, base=null) {
 await client.transaction(async tx=>{
  await tx.query('SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id=$1 FOR UPDATE',[id(10)]);
  const sequence=(await tx.query('UPDATE infra.trip_finance_guards SET next_settlement_sequence=next_settlement_sequence+1 WHERE trip_id=$1 RETURNING next_settlement_sequence-1 AS seq',[id(10)])).rows[0].seq;
  await tx.query('INSERT INTO settlement.previews(id,trip_id,created_by,signed_total_yen) VALUES ($1,$2,$3,$4)',[id(previewId),id(10),id(1),value]);
  await tx.query(`INSERT INTO settlement.preview_items(preview_id,trip_id,payment_id,kind,contribution_yen,base_settlement_id,expected_claim_fingerprint,expected_cancelled)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[id(previewId),id(10),id(pid),kind,value,base===null?null:id(base),'0'.repeat(64),kind==='REVERSAL']);
  await tx.query('INSERT INTO settlement.settlements(id,trip_id,preview_id,sequence,signed_total_yen,completion_kind,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id(sid),id(10),id(previewId),sequence,value,value===0?'no_transfer_required':'transfer_completed',id(1)]);
  await tx.query('INSERT INTO settlement.items(settlement_id,trip_id,preview_id,payment_id,kind,contribution_yen,base_settlement_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id(sid),id(10),id(previewId),id(pid),kind,value,base===null?null:id(base)]);
  await tx.query('INSERT INTO settlement.active_claims VALUES ($1,$2,$3,$4)',[id(10),id(pid),kind,id(sid)]);
 });
}
async function pending(pid) {
 return (await client.query('SELECT kind,contribution_yen FROM settlement.pending_items WHERE payment_id=$1',[id(pid)])).rows.map(r=>[r.kind,String(r.contribution_yen)]);
}
async function cancel(sid) {
 await client.transaction(async tx=>{
  await tx.query('SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id=$1 FOR UPDATE',[id(10)]);
  await tx.query('INSERT INTO settlement.cancellations VALUES ($1,$2,$3,now())',[id(sid),id(10),id(1)]);
  await tx.query('DELETE FROM settlement.active_claims WHERE settlement_id=$1',[id(sid)]);
 });
}
assert.deepEqual(await pending(100),[['BASE','3000']]);
await settle(100,200,300,'BASE',3000);
assert.deepEqual(await pending(100),[]);
await reject('INSERT INTO settlement.active_claims VALUES ($1,$2,$3,$4)',[id(10),id(100),'BASE',id(300)],'23505');
await client.query('INSERT INTO record.payment_cancellations VALUES ($1,$2,$3,now())',[id(100),id(10),id(1)]);
assert.deepEqual(await pending(100),[['REVERSAL','-3000']]);
await settle(100,201,301,'REVERSAL',-3000,300);
assert.deepEqual(await pending(100),[]);
await cancel(301); assert.deepEqual(await pending(100),[['REVERSAL','-3000']]);
await cancel(300); assert.deepEqual(await pending(100),[]);
checks.push('BASE→取消調整→調整取消→元精算取消の対象導出');
await client.query(insertPayment,params(105,100,100,0,0).map((v,i)=>i===5?100:v));
assert.deepEqual(await pending(105),[['BASE','0']]);
await settle(105,202,302,'BASE',0);
assert.deepEqual(await pending(105),[]);
checks.push('0円でも対象を保持して締める');
const spec=await parser.validate(resolve(dir,'openapi.finance.json'));
const operations=Object.values(spec.paths).reduce((n,v)=>n+Object.keys(v).filter(k=>['get','post'].includes(k)).length,0);
assert.equal(operations,11);
checks.push(`OpenAPI構造・参照検証（${operations}操作）`);
await client.close();
console.log(JSON.stringify({passed:checks,limitations:['Neon未接続','複数DB接続による競合は未検証','APIサーバー未実装','認証契約は暫定']},null,2));
