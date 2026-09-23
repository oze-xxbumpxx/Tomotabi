# ADR-0003: 本番 migration の方式と DB ロールの分離

- Status: Accepted（2026-09-23 ユーザー承認）
- Date: 2026-09-23
- 関連 feature: m1-auth-onboarding

## Context（背景・なぜ判断が必要か）

M0 は検証用 SQL をテストが直接流すだけで、migration の履歴が無い。詳細設計 02 §3 と 08 §6 は、次を方針として決めている。

- Drizzle Kit の SQL 履歴で管理する
- push による無記録の変更をしない
- 起動時に自動適用しない
- migrator と app_runtime を分ける
- 全表への ALL を禁止する

ただし、具体的な運用形は決まっていない。M1 で最初の本番用の表（認証）を作るので、ここで形を固定する。以後の M2〜M5 はこれに従って表を足す。

## Decision（採用した決定）

1. **Drizzle Kit の generate + migrate を使う。** TypeScript スキーマから `drizzle-kit generate` で SQL を作り、差分をレビューしてコミットする。適用は `drizzle-kit migrate` で行い、適用済みの記録は Drizzle 標準の履歴表に残す。
2. **トリガー・VIEW・GRANT はカスタム migration に書く。** `drizzle-kit generate --custom` で作った空の migration に、レビュー済みの SQL を書く。ORM スキーマに表せない保証もすべて同じ履歴に並べる。
3. **適用は管理者が明示的に行う。** `MIGRATION_DATABASE_URL`（migrator 接続・直接接続）を使う。アプリの起動時、PR の CI、本番への自動デプロイでは適用しない。CI は Testcontainers の空 DB にだけ適用する。
4. **ロールを分ける。**
   - `migrator`: スキーマと表の所有者。DDL を実行する。
   - `app_runtime`: 表ごとに必要な DML だけを GRANT で受け取る。DDL・TRUNCATE・所有権は持たない。
   - ロールの作成（CREATE ROLE とパスワード）は migration に含めない。`db/admin/create-roles.sql` を管理手順とする。GRANT は migration に含める。
5. 既存の `sql/00`〜`05` は参照仕様として扱い、生成 SQL と突き合わせるだけにする。そのまま実行しない。

## Alternatives（検討した非採用案と却下理由）

| 案 | 却下理由 |
|---|---|
| `drizzle-kit push` | 履歴が残らない。本番で無記録の変更になる（詳細設計 02 で禁止） |
| 手書き SQL だけの migration（dbmate など別ツール） | ORM スキーマと SQL の二重管理になる。Drizzle Kit で足りる |
| アプリ起動時に自動 migrate | 実行ロールに DDL 権限が必要になり、最小権限と矛盾する。Vercel で複数インスタンスが同時に適用するおそれもある |
| ロールの作成も migration に含める | パスワードなどの秘密が履歴に入る。Neon ではロールをコンソールや API で作ることも多い。dump に含まれないため、管理手順として別に持つ（運用設定 §5） |
| 単一ロールで開始し、M7 で分離する | GRANT の漏れが M7 でまとめて見つかる。M1 から分けておけば、表を足すたびに権限テストで検出できる |

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: スキーマ・制約・権限の変更がすべて PR でレビューされる履歴になる。app_runtime で権限テストを回すため、GRANT 漏れや過剰付与をすぐ検出できる。
- 悪い: 表を足すたびに、GRANT のカスタム migration と権限テストの追加が必要になる。
- 悪い: ローカルでもロール作成の手順が 1 つ増える（compose の初期化スクリプトで自動化する）。
- 残るリスク: Neon（プール接続 / 直接接続）での適用と権限の実確認は M6〜M7 まで未検証。

## Migration（移行が必要な場合の手順）

対象外（既存の本番 DB が無い）。M0 の `infra.m0_probes` は migration に含めず、テスト用 SQL のまま残す。

## Rollback（決定を戻す場合の手順）

migration はコードと一緒に前進させる方針とする。DB の自動巻き戻しはしない（詳細設計 08 §7）。

- 方式そのものを戻す場合: M1 の時点なら本番 DB が無いので、migration フォルダの破棄だけで戻せる。
- 本番で運用を始めた後: 後方互換の追加 migration で直す。

## References（設計書・要件・関連 ADR・外部資料へのリンク）

- docs/designs/m1-auth-onboarding.md、ADR-0002
- `docs/旅行アプリ設計 3/詳細設計/02_ORMとDB_API.md` §2〜§4、`08_デプロイと無料枠運用.md` §6〜§7、`運用設定と公開チェック.md` §5
- https://orm.drizzle.team/docs/drizzle-kit-generate
- https://orm.drizzle.team/docs/drizzle-kit-migrate
- https://orm.drizzle.team/docs/kit-custom-migrations
