# ADR-0006: 結果不明の要求を IndexedDB に残す方式

- Status: Proposed
- Date: 2026-10-02
- 関連 feature: payments-and-settlement（支払い・精算の中核）

## Context（背景・なぜ判断が必要か）

保存を送ったあと通信が切れるなどして結果が分からなくなったとき、同じ内容・同じキーで送り直して結果を確かめる仕組みは、旅行・予定の段階でメモリの中に作った（`shared/api/mutation-request.ts`・`save-state.ts`）。メモリの中なので、画面を再読み込みすると忘れ、利用者が新しいキーで送り直すと二重に保存されうる。

お金の記録（支払い・精算）は二重にできると困る。詳細設計 07 §9 は、送信済みの要求を送る前に IndexedDB に保存し、再読み込み・再ログインをまたいで同じ要求で確かめる案を示している。2026-10-02 にユーザーが、支払い・精算の中核でこれを入れると決めた（最初は支払いと精算の保存だけ）。

決める必要があるのは、ブラウザの保存領域とその扱い方（依存を足すか）。

## Decision（採用する決定。【】は決めてほしい点で、推奨を先に書く）

1. **保存先は IndexedDB**（詳細設計 07 §9 どおり）。データベース `tomotabi`、object store `pending-requests`。キーは要求の id（UUID）。`userId`・`tripId`・`operation` に index を張る。
2. **【推奨: 小さなライブラリ `idb` を使う】** IndexedDB の標準の API はイベントとコールバックで書くため、トランザクションの完了やエラーの扱いを間違えやすい。`idb`（Promise で包むだけの薄いライブラリ。約 1 KB）で書く。
3. 保存するのは `{ id, userId, tripId, operation, method, url, bodyJson, idempotencyKey, ifMatch, createdAt }` だけ。Cookie・セッショントークン・Google の情報・未送信の入力は保存しない。
4. 送る直前に保存し、保存に失敗したら送らない（黙ってメモリだけに切り替えない）。成功・確定した拒否で消す。結果不明では残す。
5. 試験では `fake-indexeddb`（devDependencies）で IndexedDB を差し替える。E2E は実ブラウザの IndexedDB を使う。

## Alternatives（検討した別案と不採用の理由）

| 案 | 不採用の理由 |
| --- | --- |
| 標準の IndexedDB API だけで書く（依存を足さない） | 書けるが、`onsuccess`・`onerror`・`oncomplete` の扱いを自前で包むことになり、取りこぼし（トランザクションの自動コミットの時機など）を作りやすい。`idb` はその包みだけを提供する |
| `idb-keyval`（キーと値だけ） | index が無く、利用者・旅行・操作で探すときに全件を読む。件数は少ないので動くが、ログアウト時の「その利用者の分だけ消す」などで条件を自前で書くことになる |
| localStorage | 同期の API で、文字列だけ。容量が小さい。詳細設計 07 §9 が IndexedDB を指定している |
| サーバー側だけで解決する（再送の受領だけに頼る） | 受領は同じキーを送ったときにしか効かない。再読み込みでキーを忘れると、利用者は新しいキーで送ってしまう |

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: 再読み込み・再ログインのあとでも、同じ要求で確かめられ、お金の記録が二重にできない。
- 悪い: web の依存が 1 つ（`idb`）、devDependencies が 1 つ（`fake-indexeddb`）増える。
- 残るリスク: プライベートモードや保存領域の制限で IndexedDB が使えない端末では、支払い・精算を保存できない（案内を出して止める）。OS や利用者がデータを消した場合と、別の端末への移動は保証しない（正本どおり。精算はサーバーの未完了の確認と履歴から確かめる）。

## Migration（移行が必要な場合の手順）

対象外（新しく足すだけ）。旅行・予定の保存は、次の「記録と 4 画面の完成」で同じ仕組みに載せる。

## Rollback（決定を戻す場合の手順）

`shared/browser/pending-requests.ts` をメモリだけの実装に差し替え、`idb`・`fake-indexeddb` を外す。保存の流れ（送る前に保存・結果で消す）は同じ口のまま残せる。

## References（設計書・要件・関連 ADR・外部資料へのリンク）

- `docs/旅行アプリ設計 3/詳細設計/07_画面状態と入力操作.md` §9「再読み込み・再ログインへの引き継ぎ」
- `docs/requirements/payments-and-settlement.md` F-50〜F-55、`docs/designs/payments-and-settlement.md`「結果不明からの復帰」
- ADR-0004（web の取得状態）
- idb: https://github.com/jakearchibald/idb
