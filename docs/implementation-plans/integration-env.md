# 実装計画: 結合検証環境（integration-env）

- 変更レベル: L3
- 要件: [docs/requirements/integration-env.md](../requirements/integration-env.md)
- 設計: [docs/designs/integration-env.md](../designs/integration-env.md)
- 試験計画: [docs/tests/integration-env.md](../tests/integration-env.md)
- 作成日: 2026-10-12

## この文書の読み方

アプリ側の作りはDevinに2つのPRで委譲する。手順書と記録の文書はClaude Codeが書く。検証用の環境を作るのと確かめるのは、ユーザーが手順書に沿って行う。観点の番号（IU・IH・ID・IW・IE）は試験計画のもの。

## PRの分け方

| PR | 中身 | 担当 | 観点 | effort | 始める条件 |
| --- | --- | --- | --- | --- | --- |
| Vercelで動かす作り | `VercelAfterResponse`、`attachDatabasePool`、`Server-Timing`、全体のキャッシュの設定、`vercel.json`（api・web）、`@vercel/functions`の追加 | Devin（ローカル） | IU-01〜IU-06、IH-01〜IH-03、ID-01 | SWE-2 high（L3の通常の機能） | 設計の承認 |
| 手動のデプロイ | `.github/workflows/deploy-integration.yml`と、その形を確かめる試験 | Devin（ローカル） | IW-01〜IW-04 | SWE-2 high（秘密情報を扱うワークフロー） | 「Vercelで動かす作り」のマージ（同じ専用クローンで2つ同時に動かさないため） |
| 手順書と記録 | `docs/runbooks/integration-env.md`、試験計画の記録の表、設計資料の環境変数の表の直し | Claude Code | IE-01〜IE-15の手順 | ― | 上の2つのPRのマージ（手順書は実際のファイル名・コマンドに合わせる） |
| 確かめた結果 | 試験計画の記録の表を埋める、PERF-01の結果と地域の判断の材料 | Claude Code（ユーザーの確認を写す） | IE-01〜IE-15 | ― | 検証用の環境ができたあと |

2つのDevinのPRは触るファイルが重ならないが、ローカルのDevinは専用クローン1つで動かすので、1つずつ順に委譲する。

## 変更対象ファイル

| ファイル | 変更 |
| --- | --- |
| `apps/api/src/composition/notification-composition.module.ts` | `AFTER_RESPONSE`の`useFactory`で、`process.env.VERCEL === "1"`なら`VercelAfterResponse`、それ以外は今の`InProcessAfterResponse` |
| `apps/api/src/infrastructure/database/pool.ts` | Vercelのときだけ、プールを作った直後に`attachDatabasePool(pool)`を1回だけ呼ぶ。DBの問い合わせの時間を`Server-Timing`の入れ物に足す |
| `apps/api/src/bootstrap/configure-app.ts` | 先頭に、時間の内訳とキャッシュを止めるヘッダーを付けるミドルウェアを置く（認証の経路の前） |
| `apps/api/package.json`・`package-lock.json` | `@vercel/functions`を版を固定して足す |
| `docs/旅行アプリ設計 3/詳細設計/運用設定と公開チェック.md` | 環境変数の表の`VAPID_KEY_ID`・`VAPID_PUBLIC_KEY`・`VAPID_PRIVATE_KEY`を`VAPID_KEYS`に直し、初期登録用の`ENROLL_GOOGLE_CLIENT_ID`・`ENROLL_GOOGLE_CLIENT_SECRET`を足す（Claude Code） |

## 新規作成ファイル

| ファイル | 中身 |
| --- | --- |
| `apps/api/src/infrastructure/after-response/vercel-after-response.ts` | `AfterResponse`のVercelの実装 |
| `apps/api/src/bootstrap/server-timing.ts` | 要求ごとの入れ物（`AsyncLocalStorage`）、`cold`の印、ヘッダーを書くミドルウェア |
| `apps/api/vercel.json`・`apps/web/vercel.json` | `regions: ["sin1"]`、apiは`maxDuration: 60` |
| `.github/workflows/deploy-integration.yml` | 手動のデプロイ |
| `docs/runbooks/integration-env.md` | 作る順番どおりの手順書（Claude Code） |

## 実装手順

### Vercelで動かす作り

1. `@vercel/functions`を足し、`VercelAfterResponse`を作る。`schedule(name, task)`は、今の`InProcessAfterResponse`と同じく`setImmediate`で応答のあとに仕事を始め、例外をログ（型名だけ）に変える約束を作り、それを`waitUntil`に渡して手元にも持っておく（`schedule`の中で`task()`を直接呼ばない）。`drain()`は持っている約束を全部待つ。IU-01・IU-02。
2. `AFTER_RESPONSE`の組み立てを、`VERCEL`で切り替える。IU-03。
3. `server-timing.ts`を作る。`AsyncLocalStorage`で要求ごとに`{ start, dbMs }`を持ち、ヘッダーを書く直前に`Server-Timing: app;dur=…, db;dur=…, cold;desc="…"`を付ける。`cold`はモジュールの読み込みで`true`、最初の要求で`false`。最初の要求にだけ、`process.uptime()`から`boot;dur=…`を付ける。IU-04。
4. `pool.ts`で、プールが新しい接続を作ったとき（`pool.on("connect")`）に、その接続の`query`を包んで時間を入れ物に足す。`pool.query`は内部で接続の`query`を呼ぶので包まない（二重に数えない）。Vercelのときだけ`attachDatabasePool`を呼ぶ。IU-05・IU-06・ID-01。
5. `configure-app.ts`の先頭に、手順3のミドルウェアと、キャッシュを止める3つのヘッダーを全部の`/api`の応答に付けるミドルウェアを置く。IH-01〜IH-03。
6. `apps/api/vercel.json`と`apps/web/vercel.json`を足す。

### 手動のデプロイ

7. `deploy-integration.yml`を書く（設計書「デプロイのワークフロー」のとおり。出すcommitが`origin/main`の履歴に含まれるかを確かめる手順を含める）。IW-01〜IW-04。
8. ワークフローの形を確かめる試験を、`.claude/tests/`の既存のワークフローの試験（`delegation-workflows.test.mjs`）と同じやり方で足す。

### 手順書と記録（Claude Code）

9. 2つのPRのマージのあと、手順書を書く。Vercel（2プロジェクト、Root Directory、ルートの外のファイル、自動デプロイを止める、Deployment Protection、Sensitiveの登録、sin1）、Neon（シンガポール、pooledとdirectの接続、ロールの作成、migration）、Google（ログイン用・初期登録用のクライアント）、VAPID（鍵の束と`VAPID_SUBJECT`）、GitHub（Environment「integration」、承認者、mainだけ、トークン、変数）、初期登録（二人）、最初のデプロイ、の順に書く。
10. 設計資料の環境変数の表を直す。

## 依存関係

- 「Vercelで動かす作り」と「手動のデプロイ」は、触るファイルは重ならないが、ローカルのDevinの専用クローンが1つなので順に進める。
- 手順書は2つのPRに依存する（ファイル名・コマンド・環境変数を合わせる）。
- 確かめるのは、手順書とユーザーの準備に依存する。

## 委譲の仕方

- ローカルのDevin（専用クローン`/Users/siro/個人開発/devin-work/tomotabi`。2026-10-12にクラウドの無料期間が終わったため）。モデルはSWE-2で、effortは表のとおり。同じクローンで2つ同時に動かさない。Issueの「既知の指摘」には、値なしの`undefined`（コーディング規約）を写す。
- DevinのPRは、Claude Codeがレビューし、Codexのレビューを1回頼む。L3なので、最初のレビューでreviewerとsecurity-reviewerを並行して動かす（試行中のやり方）。
- 委譲を始めるときに、共通受付（`AGENTS.md`）の移行が終わっていれば共通受付で登録・claim・beginしてから起動する。終わっていなければ、委譲ごとにユーザーの了承をチャットでもらってから、手元の記録を作って直接起動する（2026-10-10〜12の#198・#205・#210・#211と同じ）。了承なしに直接起動しない。

## テスト計画

[docs/tests/integration-env.md](../tests/integration-env.md)。

## リスク

設計書の「リスク」のとおり。加えて、`vercel build`をActionsで動かすとき、Vercelのプロジェクトの設定（Root Directoryなど）を`vercel pull`で取るので、手順書の設定とワークフローの手順が食い違うと失敗する。最初のデプロイ（IE-01）で確かめる。

## ロールバック方法

- アプリ側の変更は、Vercelのとき以外は動きを変えないので、PRを戻すだけでよい。
- 検証用の環境は、VercelとNeonのプロジェクトを止めれば無料枠を使わない。消すのは公開準備で判断する。

## ドキュメント更新対象

- `docs/runbooks/integration-env.md`（新規）
- `docs/tests/integration-env.md`（記録の表）
- `docs/旅行アプリ設計 3/詳細設計/運用設定と公開チェック.md`（環境変数の表）
- `README.md`の冒頭の段階の記述は、この機能とは別に直す（ユーザーの了承待ち）
