// 設計用モデルの検証。ネットワーク配信・実API・OS検証は行わない。
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,createECDH,ECDH,randomBytes} from 'node:crypto';
const dir=dirname(fileURLToPath(import.meta.url));
const req=createRequire(resolve(process.env.FINANCE_VALIDATION_DEPS||'.','package.json'));
const {PGlite}=req('@electric-sql/pglite');
const parser=req('@apidevtools/swagger-parser');
const webpush=req('web-push');
const passed=[];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function endpoint(raw){
 assert.ok(typeof raw==='string'&&raw.length<=4096&&!/[\s\\]/u.test(raw));
 const u=new URL(raw);
 assert.ok(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!raw.includes('#')&&(!u.port||u.port==='443'));
 assert.ok(u.hostname==='fcm.googleapis.com'||/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+push\.apple\.com$/.test(u.hostname));
 return raw;
}
const ep='https://fcm.googleapis.com/fcm/send/design-test?opaque=a%2Fb';
assert.equal(endpoint(ep),ep);
endpoint('https://web.push.apple.com/Q/test');
for(const raw of ['http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.example/x','https://evilpush.apple.com/x','https://push.apple.com/x','https://127.0.0.1/x','https://localhost/x','https://u:p@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x','https://fcm.googleapis.com/x#',' https://fcm.googleapis.com/x','https://web.push.apple.com.evil.example/x']) assert.throws(()=>endpoint(raw));
passed.push('宛先許可・悪意あるURL拒否・不透明なpath/queryの維持');
function decodeKey(raw,length){
 assert.match(raw,/^[A-Za-z0-9_-]+$/);
 const b=Buffer.from(raw,'base64url');assert.equal(b.length,length);assert.equal(b.toString('base64url'),raw);return b;
}
const ecdh=createECDH('prime256v1');ecdh.generateKeys();
const keys={p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')};
const pk=decodeKey(keys.p256dh,65),auth=decodeKey(keys.auth,16);
assert.equal(pk[0],4);ECDH.convertKey(pk,'prime256v1');
assert.throws(()=>decodeKey('bad',16));
assert.throws(()=>ECDH.convertKey(Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]),'prime256v1'));
passed.push('購読鍵の長さ・canonical base64url・P256曲線');
const allowed={plan:['plan_added','plan_cancelled','plan_moved'],achievement:['achievement_added','achievement_cancelled'],booking:['booking_added','booking_cancelled'],payment:['payment_added','payment_cancelled'],settlement:['settlement_completed','settlement_cancelled']};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function route(p){
 assert.deepEqual(Object.keys(p).sort(),['schemaVersion','eventId','action','tripId','targetKind','targetId','occurredAt'].sort());
 assert.equal(p.schemaVersion,1); for(const field of ['eventId','tripId','targetId'])assert.match(p[field],uuid);
 assert.ok(allowed[p.targetKind]?.includes(p.action));assert.ok(Number.isFinite(Date.parse(p.occurredAt)));
 assert.ok(Buffer.byteLength(JSON.stringify(p))<=2048);
 const root=`/trips/${p.tripId}`;
 return p.targetKind==='plan'?`${root}/plans/${p.targetId}`:p.targetKind==='settlement'?`${root}/settlements/${p.targetId}`:`${root}/records?type=${p.targetKind}&recordId=${p.targetId}`;
}
const payload={schemaVersion:1,eventId:id(100),action:'payment_added',tripId:id(10),targetKind:'payment',targetId:id(20),occurredAt:'2026-09-09T00:00:00.000Z'};
for(const [kind,actions] of Object.entries(allowed))for(const action of actions){const r=route({...payload,targetKind:kind,action});assert.equal(new URL(r,'https://travel.example').origin,'https://travel.example');}
assert.throws(()=>route({...payload,targetId:'https://evil.example'}));
assert.throws(()=>route({...payload,url:'https://evil.example'}));
assert.throws(()=>route({...payload,action:'plan_added'}));
passed.push('11通知種別・クリック先・余分なURLと種別不一致の拒否');
const vapid=webpush.generateVAPIDKeys();
const details=webpush.generateRequestDetails({endpoint:ep,keys},JSON.stringify(payload),{vapidDetails:{subject:'mailto:design@example.invalid',...vapid},contentEncoding:'aes128gcm',TTL:300,urgency:'normal'});
assert.equal(details.method,'POST');assert.equal(details.endpoint,ep);assert.equal(details.headers['Content-Encoding'],'aes128gcm');
assert.ok(Buffer.isBuffer(details.body)&&details.body.length>0);assert.ok(!details.body.includes(Buffer.from(JSON.stringify(payload))));
assert.ok(details.headers.Authorization.startsWith('vapid '));assert.equal(String(details.headers.TTL),'300');
passed.push('web-push 3.6.7の暗号化・VAPID要求生成（送信なし）');
const classify=s=>s>=200&&s<300?'accepted':s===404||s===410?'disable':'keep';
for(const s of [404,410])assert.equal(classify(s),'disable');
for(const s of [0,301,400,401,403,429,500,503])assert.equal(classify(s),'keep');
assert.equal(classify(201),'accepted');passed.push('HTTP結果分類・リダイレクトは成功扱いしない');
const db=new PGlite();
for(const f of ['00_validation_prerequisites.sql','05_push_notifications.sql'])await db.exec(await readFile(resolve(dir,'sql',f),'utf8'));
await db.query('INSERT INTO identity.users VALUES ($1),($2)',[id(1),id(2)]);
const hash=x=>createHash('sha256').update(x).digest();
async function register(user,n,session='session-a',label='検証端末',raw=ep+'/'+n){
 return db.transaction(async tx=>{
  await tx.query('SELECT id FROM identity.users WHERE id=$1 FOR UPDATE',[id(user)]);
  const closed=await tx.query('SELECT session_id FROM notification.closed_push_sessions WHERE session_id=$1',[session]);assert.equal(closed.rows.length,0,'PUSH_SESSION_CLOSED');
  await tx.query('UPDATE notification.push_subscriptions SET enabled=false,revision=revision+1,updated_at=now() WHERE user_id=$1 AND enabled AND expiration_time<=now()',[id(user)]);
  const prev=(await tx.query('SELECT * FROM notification.push_subscriptions WHERE endpoint_hash=$1',[hash(raw)])).rows[0];
  if(prev)assert.equal(prev.user_id,id(user),'PUSH_ENDPOINT_OWNED_BY_OTHER');
  if(!prev?.enabled){const count=(await tx.query('SELECT count(*)::int n FROM notification.push_subscriptions WHERE user_id=$1 AND enabled',[id(user)])).rows[0].n;assert.ok(count<3,'PUSH_LIMIT_REACHED');}
  if(prev){await tx.query('UPDATE notification.push_subscriptions SET enabled=true,device_label=$2,registration_session_id=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND (NOT enabled OR device_label IS DISTINCT FROM $2 OR registration_session_id IS DISTINCT FROM $3)',[prev.id,label,session]);return prev.id;}
  await tx.query('INSERT INTO notification.push_subscriptions(id,user_id,endpoint,endpoint_hash,p256dh,auth_secret,registration_session_id,device_label,vapid_key_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(n),id(user),raw,hash(raw),pk,auth,session,label,'test-key']);return id(n);
 });
}
await register(1,21);await register(1,21);
const revision=async n=>(await db.query('SELECT revision FROM notification.push_subscriptions WHERE id=$1',[id(n)])).rows[0].revision;
assert.equal(String(await revision(21)),'1');
await register(1,21,'session-new');assert.equal(String(await revision(21)),'2');
await assert.rejects(register(2,21,'session-b'),/PUSH_ENDPOINT_OWNED_BY_OTHER/);
await assert.rejects(db.query('INSERT INTO notification.push_subscriptions SELECT $1,user_id,endpoint,endpoint_hash,p256dh,auth_secret,expiration_time,registration_session_id,device_label,vapid_key_id,enabled,revision,created_at,updated_at FROM notification.push_subscriptions WHERE id=$2',[id(29),id(21)]));
await assert.rejects(db.query('UPDATE notification.push_subscriptions SET auth_secret=$1 WHERE id=$2',[Buffer.alloc(15),id(21)]));
passed.push('DDL制約・endpoint一意・所有者拒否・無変更冪等・更新revision');
await register(1,22);await register(1,23);await assert.rejects(register(1,24),/PUSH_LIMIT_REACHED/);
await db.query("UPDATE notification.push_subscriptions SET expiration_time=now()-interval '1 day' WHERE id=$1",[id(23)]);
await register(1,24);passed.push('3件上限と期限切れの枠解放（逐次モデル）');
const disable=async (n,rev)=>db.query('UPDATE notification.push_subscriptions SET enabled=false,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND enabled RETURNING id',[id(n),rev]);
assert.equal((await disable(21,1)).rows.length,0);assert.equal((await disable(21,2)).rows.length,1);assert.equal((await disable(21,2)).rows.length,0);
passed.push('古い送信失敗による無効化防止・重複無効化なし');
await db.transaction(async tx=>{
 await tx.query('SELECT id FROM identity.users WHERE id=$1 FOR UPDATE',[id(1)]);
 await tx.query('INSERT INTO notification.closed_push_sessions(session_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',['session-a',id(1)]);
 await tx.query('UPDATE notification.push_subscriptions SET enabled=false,revision=revision+1,updated_at=now() WHERE user_id=$1 AND registration_session_id=$2 AND enabled',[id(1),'session-a']);
});
await assert.rejects(register(1,25,'session-a'),/PUSH_SESSION_CLOSED/);
await register(1,25,'session-next');passed.push('ログアウト停止記録・旧session遅延登録拒否・新session登録');
for(const f of ['openapi.notifications.json','openapi.planning.json','openapi.auth.json'])await parser.validate(resolve(dir,f));
const api=JSON.parse(await readFile(resolve(dir,'openapi.notifications.json'),'utf8'));
assert.equal(Object.values(api.paths).reduce((n,p)=>n+Object.keys(p).length,0),4);
assert.deepEqual(Object.keys(api.components.schemas.PushSubscription.properties).sort(),['id','deviceLabel','enabled','updatedAt'].sort());
passed.push('通知4操作・予定・認証OpenAPI形式と秘密情報非公開DTO');
await db.close();
console.log(JSON.stringify({passed,limitations:['設計モデルと組込みPostgreSQLであり実API・Neon同時接続ではない','Google認証とログアウト前処理の実統合は未検証','HTTPS送信・AbortSignal・Vercel waitUntil・実端末受信は未検証','暗号化要求生成のみ。通知は一件も送っていない']},null,2));
