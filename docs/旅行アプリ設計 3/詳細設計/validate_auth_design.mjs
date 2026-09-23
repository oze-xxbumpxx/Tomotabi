// 認証設計の検証。実Google OAuth・NestJS・Neon・ブラウザを使うE2Eではない。
// Node.js 22以上。AUTH_VALIDATION_DEPSにbetter-auth@1.7.3導入済みフォルダを指定。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
const req=createRequire(resolve(process.env.AUTH_VALIDATION_DEPS||'.','package.json'));
const load=async n=>import(pathToFileURL(req.resolve(n)).href);
const { betterAuth }=await load('better-auth');
const { memoryAdapter }=await load('better-auth/adapters/memory');
const { makeSignature }=await load('better-auth/crypto');
const now=new Date();
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const db={
  user:[1,2,3].map(n=>({id:uid(n),email:`example${n}@example.invalid`,name:`Person ${n}`,emailVerified:true,createdAt:now,updatedAt:now})),
  account:[1,2,3].map(n=>({id:uid(n+10),userId:uid(n),providerId:'google',accountId:`test-google-sub-${n}`,createdAt:now,updatedAt:now})),
  session:[],verification:[]
};
const access=new Map([1,2].map(n=>[uid(n),{enabled:true,sub:`test-google-sub-${n}`} ]));
const admitted=id=>{
  const a=access.get(id);
  return !!a?.enabled && db.account.some(x=>x.userId===id && x.providerId==='google' && x.accountId===a.sub);
};
const origin='https://travel.example.invalid';
const secret=randomBytes(32).toString('base64');
const auth=betterAuth({
  baseURL:origin,secret,database:memoryAdapter(db),
  emailAndPassword:{enabled:false},
  socialProviders:{google:{clientId:'test-client-not-real',clientSecret:'test-secret-not-real',disableSignUp:true}},
  account:{accountLinking:{enabled:false,disableImplicitLinking:true}},
  session:{expiresIn:7*24*60*60,disableSessionRefresh:true,cookieCache:{enabled:false}},
  advanced:{cookiePrefix:'travel',useSecureCookies:true,database:{generateId:'uuid'}},
  trustedOrigins:[origin],
  databaseHooks:{session:{create:{before:async session=>admitted(session.userId)?{data:session}:false}}},
  logger:{disabled:true}
});
const ctx=await auth.$context;
assert.equal(ctx.authCookies.sessionToken.name,'__Secure-travel.session_token');
assert.equal(ctx.authCookies.sessionToken.attributes.httpOnly,true);
assert.equal(ctx.authCookies.sessionToken.attributes.secure,true);
assert.equal(ctx.authCookies.sessionToken.attributes.sameSite,'lax');
assert.equal(ctx.authCookies.sessionToken.attributes.domain,undefined);
const results=['Cookie名・Secure・HttpOnly・SameSite・Domain未設定'];
const s=await ctx.internalAdapter.createSession(uid(1),false);
assert.ok(s);
assert.ok(Math.abs((s.expiresAt.getTime()-s.createdAt.getTime())-7*86400000)<2000);
assert.equal(await ctx.internalAdapter.createSession(uid(3),false),null);
results.push('許可利用者の7日セッション作成・第三者のセッション作成拒否');
const cookie=`${ctx.authCookies.sessionToken.name}=${encodeURIComponent(s.token+'.'+await makeSignature(s.token,secret))}`;
const headers=new Headers({cookie,origin});
async function businessGuard(h,tripMember=true) {
  const result=await auth.api.getSession({headers:h});
  if(!result) return 401;
  if(!admitted(result.user.id) || !tripMember) return 403;
  return 200;
}
assert.equal(await businessGuard(headers),200);
assert.equal(await businessGuard(headers,false),403);
assert.equal(await businessGuard(new Headers()),401);
assert.equal(await businessGuard(new Headers({cookie:'__Secure-travel.session_token=forged',origin})),401);
results.push('署名付きセッション検証・偽Cookie拒否・旅行参加者拒否');
access.get(uid(1)).enabled=false;
assert.equal(await businessGuard(headers),403);
access.get(uid(1)).enabled=true;
const account=db.account.find(x=>x.userId===uid(1));
const originalSub=account.accountId;
account.accountId='different-sub';
assert.equal(await businessGuard(headers),403);
account.accountId=originalSub;
results.push('許可停止・Google sub不一致は既存セッションでも拒否');
const denied=await auth.handler(new Request(origin+'/api/auth/sign-out',{method:'POST',headers:{cookie,origin:'https://evil.example.invalid','content-type':'application/json'},body:'{}'}));
assert.equal(denied.status,403);
results.push('Better Authの異なるOriginからのログアウト拒否');
const signedOut=await auth.handler(new Request(origin+'/api/auth/sign-out',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:'{}'}));
assert.equal(signedOut.status,200);
assert.equal(await businessGuard(headers),401);
results.push('ログアウト後のCookie再利用拒否');
const expired=await ctx.internalAdapter.createSession(uid(2),false,{expiresAt:new Date(Date.now()-1000)},true);
const expiredCookie=`${ctx.authCookies.sessionToken.name}=${encodeURIComponent(expired.token+'.'+await makeSignature(expired.token,secret))}`;
assert.equal(await businessGuard(new Headers({cookie:expiredCookie,origin})),401);
results.push('期限切れセッション拒否');
function mutationOriginAllowed(h) {
 return h.get('origin')===origin && h.get('content-type')?.split(';')[0].trim()==='application/json';
}
assert.equal(mutationOriginAllowed(new Headers({origin,'content-type':'application/json'})),true);
assert.equal(mutationOriginAllowed(new Headers({'content-type':'application/json'})),false);
assert.equal(mutationOriginAllowed(new Headers({origin:'null','content-type':'application/json'})),false);
assert.equal(mutationOriginAllowed(new Headers({origin,'content-type':'text/plain'})),false);
results.push('業務更新のOrigin欠落・null・不正Content-Type拒否（設計モデル）');
console.log(JSON.stringify({passed:results,limitations:['メモリDBによる認証ライブラリ検証','Google本人確認・二人の初期登録は未実施','NestJS/Vercelのルーティング未実装','iPhone/AndroidのE2E未実施']},null,2));
