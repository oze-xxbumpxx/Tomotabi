# 実装計画: payments-and-settlement（支払い・精算の中核）

- 前提となる設計書: docs/designs/payments-and-settlement.md（2026-10-02承認）、ADR-0006（2026-10-02 Accepted）
- 試験計画: docs/tests/payments-and-settlement.md
- レベル: L3
- 実装ルート: Devinに委譲する。effortは、お金の計算・同時実行を含むPRはmax、画面はhigh

## この文書の読み方

- **PRの名前**（「支払い・精算のDBの土台」「支払いのAPI」など）は、この計画の中での呼び名。Issueの題とPRの説明にもこの名前を使う。
- **手順の番号**（1〜20）は、下の「実装手順」の番号。
- 観点の番号（FU-・FD-・FH-・FW-・FE-・FM-）は試験計画の番号。要件の番号（F-・E-）は要件定義の番号。
- 用語は要件定義の「この文書の読み方」と`docs/glossary.md`のとおり。

## PRの分け方

| PR | 範囲 | 手順 | 観点 | effort | マージ後にできること |
| --- | --- | --- | --- | --- | --- |
| 支払い・精算のDBの土台 | 表・migration・トリガー・権限 | 1〜3 | FD-01〜FD-04 | high | 支払いと精算の表がそろい、権限の試験がCIで回る |
| お金の計算とAPIの型 | 円の値型、負担額と寄与、対象の導出、指紋、残額、`finance.json`と生成物 | 4〜6 | FU-01〜FU-09 | max | お金の規則が単体で確かめられ、APIの型がそろう |
| 支払いのAPI | 支払いの記録・取得・取り消し、お金の書き込みの共通の流れ | 7〜9 | FU-10、FH-01〜FH-03、FH-15〜FH-17 | max | 支払いを記録・取り消せる |
| 残額と確認のAPI | 残額、受け渡しの確認の作成・一覧・取得と検証 | 10〜11 | FH-04〜FH-08 | max | 残額を見て確認を作れる |
| 精算のAPI | 精算の完了・一覧・取得・取り消し、同時実行 | 12〜14 | FD-05〜FD-12、FH-09〜FH-14 | max | 精算を完了・取り消せる。お金の中核のAPIがそろう |
| webの土台 | 円の扱い、保留中の要求（IndexedDB）とログアウトでの削除 | 15〜16 | FW-08〜FW-11 | high | 画面から使う共通部品がそろう |
| 支払いを記録の画面 | 支払いを記録・割合を指定・関連する予定、主ボタン「支払いを記録」 | 17 | FW-01〜FW-04、FW-12 | high | 画面から支払いを記録できる |
| 精算の画面 | 精算・内訳・受け渡しの確認・0円・対象0件、下部のタブ「精算」 | 18〜19 | FW-05〜FW-07 | high | 画面から精算できる |
| E2Eと手動確認 | FE-01〜FE-04、FM-01・FM-02 | 20 | FE・FM | high（E2E）・Claude Codeとユーザー（手動） | 支払い・精算の中核の完了 |

委譲は4つの波に分けて並行で進める（2026-10-02ユーザー判断。並行する分はクラウドのDevinを使う）。

| 波 | 同時に進めるPR | 始める条件 | 実行場所 |
| --- | --- | --- | --- |
| 1 | 支払い・精算のDBの土台 ／ お金の計算とAPIの型 ／webの土台 | すぐ | お金の計算とAPIの型はローカル（SWE-2 max）、ほかはクラウド |
| 2 | 支払いのAPI／ 支払いを記録の画面 ／ 精算の画面 | 波1がすべてマージされたら | 支払いのAPIはローカル（max）、画面はクラウド |
| 3 | 残額と確認のAPI → 精算のAPI（この2つは順番） | 支払いのAPIがマージされたら | ローカル（max） |
| 4 | E2Eと手動確認 | 波2・3がすべてマージされたら | クラウド（E2E）、Claude Codeとユーザー（手動） |

- お金の計算とAPIの型はDBの表を使わないので、支払い・精算のDBの土台と並行できる。webの土台はAPIの型に依存しない部分だけにする（下部のタブと主ボタンは画面のPRに移す）。
- 画面の試験はAPIを模擬で動かすので、APIの実装のでき上がりを待たない（APIの型＝契約があればよい）。
- 同じファイルを触るPR（`package-lock.json`、しおりの画面の下部、`orval.config.ts`）は、あとでマージする側で衝突を解消する。マージの順番はClaude Codeが案内する。
- ローカルのDevinは同じクローンで2つ同時に動かさないので、同じ波でローカルは1つだけにする。

L3のPR（APIの3つ）は、最初のレビューでreviewerとsecurity-reviewerを並行して動かす（試行中のやり方）。

## 変更対象ファイル

| path | なぜ変えるか |
| --- | --- |
| `apps/api/src/infrastructure/database/schema/record.ts` | 支払いと支払いの取り消しの表 |
| `apps/api/src/app.module.ts`・`composition/*` | 支払い・精算のモジュールの登録 |
| `packages/contracts/openapi/*` | `finance.json`を足す |
| `orval.config.ts` | `finance.json`の生成（webとAPI） |
| `apps/web/src/screens/itinerary/itinerary-screen.tsx` | 下部のタブ「精算」と主ボタン「支払いを記録」 |
| `apps/web/src/features/plans/ui/plan-detail.tsx` | 予定の詳細から「支払いを記録」を開く導線 |
| `apps/web/src/features/auth/model/use-sign-out.ts` | ログアウトでその利用者の保留中の要求を消す |
| `apps/web/package.json`（`idb`）、`apps/web`のdevDependencies（`fake-indexeddb`） | ADR-0006 |

## 新規作成ファイル

設計書「変更後構成」のとおり（`schema/settlement.ts`、`drizzle/0005〜0007`、`common/domain/yen.ts`、`modules/record`の支払い、`modules/settlement`、`features/payments`、`features/settlement`、`shared/browser/pending-requests.ts`、`shared/lib/yen.ts`、画面のルート、E2Eの試験）。

## 実装手順

### 支払い・精算のDBの土台

1. Drizzleの定義: `record.payments`・`payment_cancellations`、`settlement`スキーマの6表。正本`sql/01_finance.sql`の制約どおり、金額の上限だけ9,999,999円。`settlement.pending_items`のVIEWは作らない。
2. migration: 生成（表）、custom（追記のみのトリガー、`app_runtime`の権限）。`trip_finance_guards`に連番の列のUPDATEを足す。
3. 試験: FD-01〜FD-04（旅行・予定の段階の`*-schema.db.test.ts`と同じ形）。

### お金の計算とAPIの型

4. `common/domain/yen.ts`（支払い額1〜9,999,999と符号付きの合計を分けたブランド型。bigint）。
5. Domain: 負担額と寄与（`Payment.create`）、対象の導出、指紋、残額。正本のモデル`finance_model_check.py`の筋書きをTypeScriptの単体試験に移す（FU-09）。
6. 契約: 正本`openapi.finance.json`を`packages/contracts/openapi/finance.json`に移し、上限・エラーのcodeを設計書どおりに直す。OrvalでwebとAPIの生成物を作る。`api:check`が通ること。

### 支払いのAPI

7. お金の書き込みの共通の流れ: `PgFinanceUnitOfWork`（`SET LOCAL lock_timeout = '3s'`、順番待ちの札の`FOR UPDATE`）、参加者の確認、受領の読み書き。旅行・予定の段階の`trip-write-flow.ts`と同じ考え方で、お金用に作る。
8. 支払いの記録・取得・取り消しのUseCaseとController。
9. 試験: FU-10、FH-01〜FH-03、FH-15〜FH-17。

### 残額と確認のAPI

10. 残額の取得（`REPEATABLE READ`の読み取り）、確認の作成・一覧・取得（検証結果を含む）。
11. 試験: FH-04〜FH-08。

### 精算のAPI

12. 精算の完了（取り消された対象の例外を含む）、一覧、取得。
13. 精算の取り消し（最新の有効な精算だけ、占有を同じトランザクションで消す）。
14. 試験: FD-05〜FD-12、FH-09〜FH-14。同時実行の観点を10回続けて流す。

### webの土台

15. `shared/lib/yen.ts`（文字列 ⇔ BigInt、3桁区切りの表示）、`shared/browser/pending-requests.ts`（ADR-0006。`idb`）。`mutation-request`と保存状態のhookに、送る前に保存・結果で消す流れをつなぐ（支払いと精算の操作だけ）。ログアウトで消す。
16. 試験: FW-08〜FW-11。保留中の要求は、まだ支払い・精算の操作が無いので、試験用の操作名で確かめる（画面のPRで実際の操作をつなぐ）。

### 支払いを記録の画面

17. `features/payments`（api・model・ui）と`/trips/{tripId}/payments/new`（しおりの上のシート）。予定の詳細からの導線と、しおりの主ボタン「支払いを記録」。試験: FW-01〜FW-04、FW-12。

### 精算の画面

18. `features/settlement`（api・model・ui）と`/trips/{tripId}/settlement`（残額・内訳・未完了の確認・履歴）。下部のタブ「精算」。
19. `/trips/{tripId}/settlement/previews/{previewId}`（受け渡しの確認・確認のダイアログ・0円）。記録できない確認の表示（了承の画面は次の段階）。試験: FW-05〜FW-07。

### E2Eと手動確認

20. E2Eの試験FE-01〜FE-04（`e2e/tests/`）。手動確認FM-01・FM-02はClaude Codeが手順を用意し、375幅のスクリーンショットをユーザーに見てもらう。

## 依存関係

- 支払い・精算のDBの土台 → お金の計算とAPIの型 → 支払いのAPI → 残額と確認のAPI → 精算のAPI
- webの土台はどのPRにも依存しない（APIの型を使わない部分だけ）
- 2つの画面は、お金の計算とAPIの型（APIの型）とwebの土台に依存する。APIの実装には依存しない（試験はAPIを模擬する）
- E2Eは画面の2つのPRに依存する

## 委譲の仕方

- Issueは`.github/ISSUE_TEMPLATE/devin-task.md`の形で、PRごとに1つ作る。「読む資料」に設計書の節、試験計画の観点、この計画の手順を書き、Issueの本文でも番号には中身を添える。
- 記録は`node .claude/scripts/delegation.mjs init <Issue> --model swe-2-<effort> --level 3`。起動後は`devin-stall-watch.mjs`で見張る。
- 設計と違う実装が要るときは、Devinは止まって報告する（devin-workflow）。
- お金の計算と排他のPRでは、正本のモデルと詳細設計「支払いと精算」の節ごとに突き合わせてレビューする。

## テスト計画

試験計画のとおり。配置は各workspaceの`tests/`に`src/`をミラーする（`apps/api/tests/domain/finance/*`、`tests/db/finance-*.db.test.ts`、`apps/web/tests/*`、`e2e/tests/*`）。

## リスク

| リスク | 対策 |
| --- | --- |
| お金の規則の誤り | 正本のモデルの筋書きを単体試験に移し、占有を履歴から作り直す試験を毎回流す |
| 同時実行の不安定な試験 | 待ちを確かめてから進める形（旅行・予定の段階の予定の同時実行の試験と同じ）。10回続けて流す |
| PRが大きくなる | 上の9つに分けた。1つのPRで収まらないときは止まって報告する |
| 結果不明の復帰がブラウザによって動かない | IndexedDBが使えないときは送らずに止める。E2Eで通常の場合を確かめる |

## ロールバック方法

PRごとにrevertする。表のmigrationを戻すときは、本番のデータが無いうちに限る（公開準備の段階より前）。

## ドキュメント更新対象

- `docs/glossary.md`（足した用語があれば）
- README（APIの一覧に支払い・精算）
- `docs/tests/payments-and-settlement.md`（E2Eで自動化した観点の印）
