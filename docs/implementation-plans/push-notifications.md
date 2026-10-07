# 実装計画: push-notifications（相手の操作を知らせる通知）

- 前提となる設計書: docs/designs/push-notifications.md（2026-10-07承認、PR #168）
- 試験計画: docs/tests/push-notifications.md
- レベル: L3
- 実装ルート: Devinに委譲する（支払い・精算、記録と4画面と同じ進め方）。起動はクラウド（2026-10-04のユーザーの指示で、クラウドを既定にした。AGENTS.mdと`review-devin-pr`の「既定はローカル」はまだ直していない）。クラウドでは`--model`が効かず、Devin Webの既定（ユーザーが設定したSWE-2 Max）で動くので、全部のPRがmaxで動く。下の表のeffortは、クラウドが使えずローカルで起動するときの目安
- 判断理由: API（購読・ログアウト・送る処理）・DB・契約・Service Worker・画面にまたがり、並行できるPRが多い

## この文書の読み方

- **PRの名前**（「購読のAPI」など）は、この計画の中での呼び名。Issueの題とPRの説明にもこの名前を使う。
- **手順の番号**（1〜21）は、下の「実装手順」の番号。
- 観点の番号（PU-・PD-・PT-・PW-・PE-・PM-）は試験計画の番号。要件の番号（F-・N-・E-・B-）は要件定義の番号。

## PRの分け方

| PR                       | 範囲                                                                                                     | 手順   | 観点                                                   | effort（ローカルのときの目安）             | マージ後にできること                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------ |
| DB・契約・鍵             | 2つの表と権限、通知の契約と生成物、通知の中身の型、VAPIDの鍵の読み込みと鍵を作るコマンド、`.env.example` | 1〜5   | PU-08、PD-01                                           | high                                       | APIと画面の型がそろい、鍵を作って読み込める      |
| 購読のAPI                | 宛先と鍵の決まり、セッションのIDの受け渡し、設定・一覧・登録・停止の4つのAPI                             | 6〜9   | PU-01・PU-02、PD-02〜PD-10                             | max                                        | APIで購読を登録・停止できる                      |
| ログアウトのガード       | `POST /api/auth/sign-out`の手前で通知を止める処理                                                        | 10     | PD-11〜PD-14                                           | max                                        | ログアウトした端末に新しい通知が届かない         |
| 送る処理                 | 保存のあとの処理の口、イベントを渡す口、送る相手の選び方、本文、送る部品、11種類のUseCaseからのイベント  | 11〜15 | PU-03〜PU-07・PU-09・PU-10、PD-15〜PD-21、PT-01〜PT-03 | max                                        | 相手の操作で、登録した購読へ通知が送られる       |
| Service Workerとmanifest | 中身の確かめ方と開くパス（webの`shared/push`）、Service Workerとそのビルド、manifestとアイコン           | 16〜17 | PU-11〜PU-13                                           | high                                       | ブラウザが通知を受け取って出し、押すと対象を開く |
| 通知の画面               | 通知の設定の画面、旅行のメニューの行、ホームの案内のカード、ログアウトの流れ、精算の画面の`settlementId` | 18〜20 | PU-14、PW-01〜PW-11                                    | high                                       | 画面から通知を有効にし、止められる               |
| E2Eと手動確認            | E2Eの4つ、手動確認の手順、最後の受け入れの行                                                             | 21     | PE-01〜PE-04、PM-01〜PM-03                             | high（E2E）・Claude Codeとユーザー（手動） | 通知の完成                                       |

委譲は4つの波に分けて並行で進める。全部クラウドで起動する。

| 波  | 同時に進めるPR                               | 始める条件                                                            |
| --- | -------------------------------------------- | --------------------------------------------------------------------- |
| 1   | DB・契約・鍵                                 | すぐ                                                                  |
| 2   | 購読のAPI ／ Service Workerとmanifest        | DB・契約・鍵がマージされたら                                          |
| 3   | ログアウトのガード ／ 送る処理 ／ 通知の画面 | 購読のAPIがマージされたら。通知の画面はService Workerとmanifestも待つ |
| 4   | E2Eと手動確認                                | 波1〜3がすべてマージされたら                                          |

- 画面の試験はAPIとブラウザの通知の機能を模擬で動かすので、通知の画面はAPIの実装を待たない。ただしService Workerの登録と`shared/push`を使うので、Service Workerとmanifestを待つ。
- ログアウトのガードと送る処理は、購読のAPIが足す購読のRepositoryとセッションのIDを使う。
- 同じファイルを触るPR（`package-lock.json`、`orval.config.ts`と生成物、`app.module.ts`、`composition/*`）は、あとでマージする側で衝突を解消する。マージの順番はClaude Codeが案内する。
- L3のAPIのPR（購読のAPI・ログアウトのガード・送る処理）は、最初のレビューでreviewerとsecurity-reviewerを並行して動かす（試行中のやり方）。

## 変更対象ファイル

| path                                                                                                                                    | なぜ変えるか                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/api/drizzle.config.ts`                                                                                                            | `schemaFilter`に`notification`を足す（足さないと`db:generate`が新しいスキーマの表を作らない） |
| `packages/contracts/openapi/auth.json`                                                                                                  | サインアウトの503 `PUSH_STOP_FAILED`と応答ヘッダー`X-Push-Stopped`                            |
| `orval.config.ts`と生成物                                                                                                               | 通知の契約を足したので作り直す                                                                |
| `apps/api/src/common/http/api-error.ts`                                                                                                 | 通知のエラーコード（設計書「エラー処理」の表）                                                |
| `apps/api/src/modules/identity/adapter/outbound/session-verifier.ts`と実装、`common/guard/session.guard.ts`・`authenticated-request.ts` | `authenticated`の結果と要求にセッションのIDを載せる                                           |
| `apps/api/src/bootstrap/configure-app.ts`                                                                                               | `/api/auth/sign-out`のBetter Authの処理の手前にガードを置く                                   |
| `apps/api/src/app.module.ts`・`composition/*`                                                                                           | notificationのモジュールの配線と、3つのモジュールへの`NotificationPublisher`の受け渡し        |
| 11種類の保存のUseCase（`planning`・`record`・`settlement`の`usecase/`）                                                                 | 初めて保存できて状態が変わったときに`publish`する                                             |
| `apps/api/src/main.ts`                                                                                                                  | 終了のときに保存のあとの処理を待つ（最大5秒）                                                 |
| `apps/web/src/features/trips/ui/trip-menu.tsx`                                                                                          | 「この端末の通知」の行                                                                        |
| `apps/web/src/features/auth/model/use-sign-out.ts`とログインの画面                                                                      | ブラウザの購読の解除、503と`X-Push-Stopped`の扱い、案内                                       |
| `apps/web/src/screens/home/home-screen.tsx`                                                                                             | 案内のカード                                                                                  |
| `apps/web/src/screens/settlement/settlement-screen.tsx`・`features/settlement/ui/settlement-history.tsx`                                | `settlementId`の行を目立たせてスクロール                                                      |
| `apps/web/package.json`・`.gitignore`                                                                                                   | Service Workerのビルド（`predev`・`prebuild`、`esbuild`を開発の依存に足す）。出力を無視する   |
| `docs/tests/final-acceptance.md`                                                                                                        | 実機での確認の行（PM-03）                                                                     |

## 新規作成ファイル

設計書「変更後構成」のとおり。主なもの:

- `apps/api/drizzle/0009_notification_tables.sql`・`0010_notification_grants.sql`、`apps/api/src/infrastructure/database/schema/notification.ts`
- `packages/contracts/openapi/notifications.json`、`packages/contracts/src/push-payload.ts`（通知の中身の型と11種類の組み合わせ）
- `apps/api/src/modules/notification/`（controller・usecase・domain・adapter・infrastructure）、`apps/api/src/adapter/after-response/`、`apps/api/src/composition/notification-composition.module.ts`、`apps/api/src/cli/generate-vapid-key.ts`
- `apps/web/src/shared/push/`、`apps/web/src/service-worker/`、`apps/web/scripts/build-service-worker.mjs`、`apps/web/src/app/manifest.ts`、`apps/web/public/icons/`
- `apps/web/src/app/settings/notifications/page.tsx`、`apps/web/src/screens/notification-settings/`、`apps/web/src/features/notifications/`
- `e2e/tests/notifications.spec.ts`

## 実装手順

### DB・契約・鍵

1. `schema/notification.ts`と`0009_notification_tables.sql`（設計資料の`sql/05_push_notifications.sql`を写す）。先に`apps/api/drizzle.config.ts`の`schemaFilter`に`notification`を足してから`db:generate`で作り、`npm run db:check`が通る形にする。完了条件: 生成したmigrationに2つの表が入り、空のDBに当たる。
2. `0010_notification_grants.sql`（`notification`スキーマのUSAGE、2つの表のSELECT・INSERT・UPDATE）。完了条件: PD-01。
3. 設計資料の`openapi.notifications.json`を`packages/contracts/openapi/notifications.json`に写し、パスに`/api`を付け、一覧の項目に`vapidKeyState`・`isCurrentSession`を足す。`auth.json`のサインアウトに503 `PUSH_STOP_FAILED`と`X-Push-Stopped`を足す。`orval.config.ts`に足して`npm run api:generate`。完了条件: `npm run api:check`と`npm run type-check`が通る。
4. `packages/contracts/src/push-payload.ts`（通知の中身の型、11種類のactionとtargetKindの組み合わせ、文字の長さの上限）。完了条件: APIとwebの両方から読める。
5. `EnvVapidKeyring`（`VAPID_KEYS`と`VAPID_SUBJECT`を読み、形を確かめる。崩れていたら通知の機能を止めた状態にする）、`cli/generate-vapid-key.ts`（秘密鍵を標準出力に出さずファイルに書く）、`.env.example`の欄。完了条件: PU-08。

### 購読のAPI

6. `domain/push-endpoint.ts`（宛先の決まり）と`domain/push-keys.ts`（鍵の形とP-256の点）。完了条件: PU-01・PU-02。
7. `SessionVerifier`の`authenticated`にセッションのIDを足し、`SessionGuard`が要求に載せる。完了条件: 今の認証の試験が通る。
8. `PushSubscriptionRepository`とDrizzleの実装（利用者の行のFOR UPDATE、期限の過ぎた購読の無効化、有効な数、upsert、版の扱い、一意の制約の違反の変換）。
9. 4つのUseCaseとコントローラー（`SessionGuard`・利用許可・`OriginGuard`・`no-store`）。完了条件: PD-02〜PD-10。同時実行のPD-04・PD-05を10回続けて通す。

### ログアウトのガード

10. `ClosePushSessionUseCase`と`signOutPushGuard`（`SessionVerifier`の4つの結果で分ける。`unavailable`とDBの失敗は503、`unauthenticated`と`forbidden`はそのまま渡す。`X-Push-Stopped`を付ける）。`configure-app.ts`でBetter Authの処理の手前に置く。完了条件: PD-11〜PD-14。PD-14を10回続けて通す。

### 送る処理

11. `adapter/after-response/`（`AfterResponse`と`InProcessAfterResponse`。`drain()`と、`main.ts`の終了のときの待ち）。完了条件: PU-09。
12. `domain/notification-message.ts`（本文の言葉、名前の切り詰め、UTF-8で2KB以内）。完了条件: PU-03〜PU-05。
13. `WebPushSender`（`generateRequestDetails`に`TTL: 300`・`urgency`・`contentEncoding`、購読の鍵で署名）と`HttpsPushTransport`（3秒の全体の打ち切り、転送を追わない、同時3件）。完了条件: PU-06・PU-07、PT-01〜PT-03。
14. 送る相手の読み取り（相手の有効な購読、名前2つ。READ ONLY・`statement_timeout`と`lock_timeout`）と`DispatchNotificationUseCase`（応答ごとの扱い、版が同じときだけ無効にする、ログ）。完了条件: PD-15・PD-18〜PD-21。
15. 各モジュールの`NotificationPublisher`と、11種類のUseCaseからの`publish`（設計書「どのUseCaseが、いつイベントを渡すか」の表）。完了条件: PU-10、PD-16・PD-17。

### Service Workerとmanifest

16. `shared/push/`（中身の確かめ方、開くパス、端末の名前）と`service-worker/`（`push`・`notificationclick`）、`scripts/build-service-worker.mjs`（esbuildで`public/sw.js`）、`predev`・`prebuild`。完了条件: PU-11〜PU-13・PU-15、`npm run build`が通る。
17. `app/manifest.ts`とアイコン（今のアプリのアイコンから192・512のPNG）。完了条件: Chromeでmanifestが読める。

### 通知の画面

18. `features/notifications`（APIの呼び出し、状態の判定、有効にする・止める・切り替えの手順）と`/settings/notifications`の画面（この端末・端末の一覧）。旅行のメニューの行。完了条件: PU-14、PW-01〜PW-07。
19. ホームの案内のカード、ログアウトの流れ（ブラウザの購読の解除、503、`X-Push-Stopped`とログインの画面の案内）。完了条件: PW-08〜PW-10。
20. 精算の画面の`settlementId`。完了条件: PW-11。

### E2Eと手動確認

21. E2EのPE-01〜PE-04（`e2e/tests/notifications.spec.ts`。CIは試験用の鍵を環境変数で渡す）。手動確認PM-01・PM-02はClaude Codeが手順（試験用の鍵の作り方、二人のプロファイル）を用意し、ユーザーが確かめる。`docs/tests/final-acceptance.md`にPM-03の行を足す。

## 依存関係

- DB・契約・鍵 → 購読のAPI → ログアウトのガード ／ 送る処理
- DB・契約・鍵 → Service Workerとmanifest → 通知の画面
- E2Eは全部に依存する

## 委譲の仕方

- Issueは`.github/ISSUE_TEMPLATE/devin-task.md`の形で、PRごとに1つ作る。「読む資料」に設計書の節、試験計画の観点、この計画の手順を書き、Issueの本文でも番号には中身を添える。
- 記録は`node .claude/scripts/delegation.mjs init <Issue> --model swe-2-<effort> --level 3`。起動後は`devin-stall-watch.mjs`で見張る。
- 設計と違う実装が要るときは、Devinは止まって報告する（devin-workflow）。
- セキュリティに関わるPR（購読のAPI・ログアウトのガード・送る処理）は、宛先の決まりと秘密の扱い（N-01〜N-04）を設計書の「セキュリティ」と突き合わせてレビューする。

## テスト計画

試験計画のとおり。配置は各workspaceの`tests/`に`src/`をミラーする（`apps/api/tests/domain/notification/*`、`apps/api/tests/db/notification-*.db.test.ts`、`apps/web/tests/*`、`e2e/tests/*`）。

## リスク

| リスク                                                                | 対策                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 11種類のUseCaseに手を入れるので、今の保存の試験が崩れる               | `NotificationPublisher`の何もしない実装を既定にし、今の試験はそのまま通す             |
| 応答のあとの処理を試験が待たず、不安定になる                          | 試験は`drain()`で待ってから確かめる。時間で待たない                                   |
| 同時実行の不安定な試験                                                | 待ちを確かめてから進める形（今の同時実行の試験と同じ）。10回続けて流す                |
| Better Authの経路の手前のガードが、サインイン・コールバックに影響する | ガードは`POST /api/auth/sign-out`だけに付け、ほかの経路の今の試験が通ることを確かめる |
| Service Workerのビルドを忘れて古い`sw.js`が残る                       | `predev`・`prebuild`で毎回作る。出力はgitに入れない                                   |
| 並行するPRの衝突（生成物・`package-lock.json`・`composition`）        | 衝突しやすいファイルを波1にまとめ、マージの順番をClaude Codeが案内する                |

## ロールバック方法

PRごとにrevertする。migrationは表を足すだけなので、権限を`REVOKE`し、表とスキーマを消せば戻る（購読のデータは消えてよい）。`VAPID_KEYS`を外せば、コードを戻さずに通知の機能だけを止められる。

## ドキュメント更新対象

- `docs/glossary.md`（購読・配信サービス・停止の記録）
- README（APIの一覧に通知の4つ、環境変数`VAPID_KEYS`・`VAPID_SUBJECT`、鍵を作るコマンド）
- `docs/tests/final-acceptance.md`（実機の確認）
