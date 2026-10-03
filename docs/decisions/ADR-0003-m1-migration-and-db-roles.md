# ADR-0003: 本番migrationの方式とDBロールの分離

- Status: Accepted（2026-09-23ユーザー承認）
- Date: 2026-09-23
- 関連feature: m1-auth-onboarding

## Context（背景・なぜ判断が必要か）

M0は検証用SQLをテストが直接流すだけで、migrationの履歴が無い。詳細設計02 §3と08 §6は、次を方針として決めている。

- Drizzle KitのSQL履歴で管理する
- pushによる無記録の変更をしない
- 起動時に自動適用しない
- migratorとapp_runtimeを分ける
- 全表へのALLを禁止する

ただし、具体的な運用形は決まっていない。M1で最初の本番用の表（認証）を作るので、ここで形を固定する。以後のM2〜M5はこれに従って表を足す。

## Decision（採用した決定）

1. **Drizzle Kitのgenerate + migrateを使う。** TypeScriptスキーマから`drizzle-kit generate`でSQLを作り、差分をレビューしてコミットする。適用は`drizzle-kit migrate`で行い、適用済みの記録はDrizzle標準の履歴表に残す。
2. **トリガー・VIEW・GRANTはカスタムmigrationに書く。** `drizzle-kit generate --custom`で作った空のmigrationに、レビュー済みのSQLを書く。ORMスキーマに表せない保証もすべて同じ履歴に並べる。
3. **適用は管理者が明示的に行う。** `MIGRATION_DATABASE_URL`（migrator接続・直接接続）を使う。アプリの起動時、PRのCI、本番への自動デプロイでは適用しない。CIはTestcontainersの空DBにだけ適用する。
4. **ロールを分ける。**
   - `migrator`: スキーマと表の所有者。DDLを実行する。
   - `app_runtime`: 表ごとに必要なDMLだけをGRANTで受け取る。DDL・TRUNCATE・所有権は持たない。
   - ロールの作成（CREATE ROLEとパスワード）はmigrationに含めない。管理手順は2つに分ける（2026-09-24、PR #16のレビューで追記）。
     - `db/admin/create-roles.sql`: ロールはクラスタ全体で共有されるため、クラスタごとに1回だけ実行する。
     - `db/admin/grant-database.sql`: DBごとのCONNECT / CREATE権限。DBごとに実行し、再実行しても同じ結果になる。
     - どちらも`psql -v ON_ERROR_STOP=1`で実行し、SQLのエラーを成功として扱わない。
   - 表ごとのGRANTはmigrationに含める。
5. 既存の`sql/00`〜`05`は参照仕様として扱い、生成SQLと突き合わせるだけにする。そのまま実行しない。

## Alternatives（検討した非採用案と却下理由）

| 案 | 却下理由 |
|---|---|
| `drizzle-kit push` | 履歴が残らない。本番で無記録の変更になる（詳細設計02で禁止） |
| 手書きSQLだけのmigration（dbmateなど別ツール） | ORMスキーマとSQLの二重管理になる。Drizzle Kitで足りる |
| アプリ起動時に自動migrate | 実行ロールにDDL権限が必要になり、最小権限と矛盾する。Vercelで複数インスタンスが同時に適用するおそれもある |
| ロールの作成もmigrationに含める | パスワードなどの秘密が履歴に入る。NeonではロールをコンソールやAPIで作ることも多い。dumpに含まれないため、管理手順として別に持つ（運用設定 §5） |
| 単一ロールで開始し、M7で分離する | GRANTの漏れがM7でまとめて見つかる。M1から分けておけば、表を足すたびに権限テストで検出できる |

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: スキーマ・制約・権限の変更がすべてPRでレビューされる履歴になる。app_runtimeで権限テストを回すため、GRANT漏れや過剰付与をすぐ検出できる。
- 悪い: 表を足すたびに、GRANTのカスタムmigrationと権限テストの追加が必要になる。
- 悪い: ローカルでもロール作成の手順が1つ増える（composeの初期化スクリプトで自動化する）。
- 残るリスク: Neon（プール接続 / 直接接続）での適用と権限の実確認はM6〜M7まで未検証。

## Migration（移行が必要な場合の手順）

対象外（既存の本番DBが無い）。M0の`infra.m0_probes`はmigrationに含めず、テスト用SQLのまま残す。

## Rollback（決定を戻す場合の手順）

migrationはコードと一緒に前進させる方針とする。DBの自動巻き戻しはしない（詳細設計08 §7）。

- 方式そのものを戻す場合: M1の時点なら本番DBが無いので、migrationフォルダの破棄だけで戻せる。
- 本番で運用を始めた後: 後方互換の追加migrationで直す。

## References（設計書・要件・関連ADR・外部資料へのリンク）

- docs/designs/m1-auth-onboarding.md、ADR-0002
- `docs/旅行アプリ設計 3/詳細設計/02_ORMとDB_API.md` §2〜§4、`08_デプロイと無料枠運用.md` §6〜§7、`運用設定と公開チェック.md` §5
- https://orm.drizzle.team/docs/drizzle-kit-generate
- https://orm.drizzle.team/docs/drizzle-kit-migrate
- https://orm.drizzle.team/docs/kit-custom-migrations
