# 詳細設計02：ORM選定・DB定義・API仕様

作成日：2026-09-07
状態：詳細設計上の選定と実装前の仕様。Drizzle ORM＋node-postgres（pg）を選定して具体化した。基本設計の業務ルールは変更しない。個別のライブラリ選定をユーザーが明示承認したという記録ではない。

## 1. ORMの選定

Drizzle ORMを使い、NestJSのNode.js実行環境からpgでNeonへ接続する。SQLの制約・ロック・トランザクションを設計と対応付けやすいことを重視した判断。Prismaで実現できないという比較ではない。

| 判断軸 | Prisma | Drizzle | 今回の判断 |
|---|---|---|---|
| トランザクション | 対話的トランザクションの公式APIあり | コールバック型と分離レベルの指定あり | どちらも候補になる |
| SQLとの対応 | ORMモデルのAPIに加えてSQL実行手段を使用 | SQLに近いクエリとSQL断片を組み合わせる | 複合制約・行ロックを明示する今回の設計はDrizzleで具体化 |
| PostgreSQL接続 | ドライバーアダプター等の構成を選ぶ | pgを直接組み合わせられる | Node.js実行環境なのでpgに統一 |
| マイグレーション | Prismaの管理方式 | Drizzle KitでSQL生成・適用 | SQLをレビューして履歴管理する |
| 学習上の狙い | ORMモデルを中心に扱う開発を学べる | SQLとTypeScriptの対応を追いやすいと判断 | DB整合性とSQLの理解を優先 |

比較は公式の機能記載と本アプリへの適合判断に限る。求人数・速度・人気で優位と断定しない。Prismaの公式資料は世代によりAPI表記が異なるため、サンプルを混在させない。

参照：
- [Drizzle：トランザクション](https://orm.drizzle.team/docs/transactions)
- [Drizzle：PostgreSQL接続](https://orm.drizzle.team/docs/get-started-postgresql)
- [Drizzle Kit：SQL生成](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [Prisma：トランザクションと実行環境](https://www.prisma.io/docs/orm/reference/transactions-and-runtime)
- [Prisma v6：対話的トランザクション](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions)

## 2. バージョンと接続

npmのdist-tagsを確認し、検証には安定版タグのdrizzle-orm 0.45.2とpg 8.23.0を使用。Drizzle Kitの安定版タグは0.31.10だったが、今回Kitによるマイグレーション生成は実施していない。公式ページにある@rcをそのまま採用しない。本番実装の開始時に、互換性と更新内容を確認してlockfileで固定する。

- 実行用：Neonのプール付き接続URL、pg.Pool、TLS。接続情報はサーバーの環境変数に置く。
- マイグレーション・pg_dump：直接接続URLを別に用意する。
- トランザクション内は同一接続／Drizzleのtxだけを使う。途中でグローバルdbやpool.queryを使わない。
- プールはインスタンスで再利用し、初期上限は2接続の案。インスタンス数が増えれば合計接続も増えるため、上限2だけで全体の接続数が制限されるとは扱わない。
- DB接続を維持するためのウォームアップや常時ポーリングはしない。アイドル接続を解放し、Vercel環境でプールの寿命とプロセス停止時の扱いを検証する。
- セッション単位のDB状態に依存しない。旅行ロックはトランザクション内の行ロックであり、外部送金や画面操作を待たない。

Neonはトランザクション単位のプーリングを案内し、マイグレーション等には直接接続を案内している。[Neon公式](https://neon.com/docs/connect/connection-pooling)
同じトランザクションの全SQLを同じクライアントで実行することは、pgの公式要件。[node-postgres公式](https://node-postgres.com/features/transactions)

## 3. 成果物と適用範囲

| ファイル | 内容 |
|---|---|
| sql/00_validation_prerequisites.sql | 検証用のユーザー・旅行・予定・参加者の最小依存表。本番の完全な設計ではない |
| sql/01_finance.sql | 財務の10テーブル、複合FK・CHECK・UNIQUE、追記履歴の保護、次回対象VIEW |
| openapi.finance.json | OpenAPI 3.1形式、9パス・11操作。支払い詳細GETも追加 |
| validate_finance_design.mjs | DDL・制約・調整VIEW・ORM・API仕様を検証するスクリプト |

SQLは空の検証DBへ適用できる設計成果物。既存本番への適用や初回マイグレーションの実行はしていない。アプリの起動時にSQLを自動適用しない。

Cursorで実装するときは、DrizzleのTypeScriptスキーマとDrizzle KitのSQL履歴へ落とし込む。Drizzle生成SQLを比較するための参照仕様として本DDLを使い、二重に同じ表を作るマイグレーションを実行しない。トリガー・VIEW等はレビューしたカスタムSQLに含める。DBへのpushによる無記録の本番変更は避ける。

## 4. DBが保証する範囲とUseCaseの責務

DDLで保証するもの：金額範囲、割合範囲、確定負担額の端数処理、負担額合計、同一旅行の参照、1件1取消、1確認1完了、有効対象の重複禁止、履歴の通常UPDATE/DELETE禁止。

DDLだけでは保証しないもの：

- 旅行の参加者が必ず二人揃っていること。旅行の利用開始時に検証し、固定したslotとユーザーを運用途中で入れ替えない。
- 確認・精算の合計と明細総和、明細寄与と元の確定負担額の対応。
- REVERSALの参照先が履歴上存在するだけでなく、現在有効なBASEであること。
- 最新の有効な精算だけを取り消すこと。
- 取消後のactive_claimsの削除、履歴から再構築した占有表との一致。
- 取消了承対象の一致と、異なる精算・取消を経た古い確認の拒否。

これらは旅行ロック下でUseCaseが検証・更新する。pending_items VIEWには必ず認可済みtrip_idの条件を付ける。複数のDBクエリで一覧・合計を取得する場合は同じ読み取りスナップショットを使う。RESTの入力チェックやUIだけに置かない。SQLを直接操作できる管理者まで業務UseCaseで制限したと誤認しない。

本番アプリのDBロールには必要なSELECT/INSERT、占有表のDELETE、guardのUPDATE等だけを付与する。DDL・TRUNCATE・トリガー無効化はアプリから許可しない。ロールとGRANTの具体化は運用・認証詳細設計で行う。

金額上限999,999,999円、用途名100文字は暫定の入力制約。ユーザーに合意を得た業務要件そのものとは分け、変更可能な設計値として記録する。

## 5. APIを具体化した際の改善

### 0円の扱い

前案のtransferCompleted:trueだけでは、0円のときにも送金をしたように読める。completionKindを次の二値にする。

- transfer_completed：元の非0円の金額を全額受け渡した。
- no_transfer_required：対象はあるが金額0円のため、受け渡し不要として締めた。

確認内容から許可する値をサーバーで検証する。金額と対象はクライアントから上書きできない。

### 取り消しの了承

acknowledgeCancelledItems:booleanを、acknowledgedCancellationPaymentIdsの配列へ置き換える。確認後に取り消されたBASE対象の現在のID集合と完全一致を要求する。

例：支払いAの取り消しを確認した後、完了ボタンを押す直前にBも取り消された場合、Aだけを了承した要求は409で止める。画面はA・Bの変更を表示して再確認する。単なるtrueでは、利用者が見ていないBの取り消しまで了承したと扱ってしまうため。

これは対象や元の精算金額を変える操作ではない。受け渡し済みの金額で完了し、取消分は次回へ回す合意を維持する。

### 再送・認証

Idempotency-KeyはUUID。request_hashには操作名・tripId・対象ID・正規化したbodyを含める。別旅行への同じキーの再利用も拒否。receiptのユニーク制約違反が起きたらロールバック後に既存hashと比較し、異なる入力を成功扱いしない。

後続の03_認証とセッション.mdでBetter AuthのDBセッションCookie方式を選定した。APIの暫定AppAccessTokenはSessionCookieへ置き換え、業務POSTのOrigin完全一致検査を追加済み。実Google OAuth・配信経路の統合検証は未実施。

OpenAPIは構造を機械検証するための契約だが、割合合計100・二人のIDの重複防止・各金額の一致などはサーバー側の意味的検証も必要。[OpenAPI公式仕様](https://spec.openapis.org/oas/v3.1.1.html)

## 6. 検証結果

PGlite 0.5.8（組込みPostgreSQL）、drizzle-orm 0.45.2、pg 8.23.0、swagger-parser 12.1.0で検証した。

- DDLを適用できた。
- 別旅行の予定の参照、誤った負担合計・端数、履歴のUPDATE/DELETEを拒否した。
- Drizzleで行ロックSQLを実行でき、失敗時のトランザクションがロールバックされた。
- node-postgres用DrizzleアダプターでFOR UPDATEを含むSQLを生成できた（接続自体はしていない）。
- 元精算→支払い取消→逆向き調整→調整取消→元精算取消の各段階で、次回対象VIEWが期待どおりになった。
- 0円の対象を保持し、受け渡し不要として締められた。
- OpenAPIの構造と参照を検証し、11操作を確認した。

Dockerデーモンが起動していなかったため、別のDB環境を勝手に起動せず、検証用依存をwork内へ導入して組込みDBで確認した。PGliteはNeon・TCP接続・PgBouncerや複数接続の競合を再現しない。最新取消のUseCase・APIサーバー・認証の実装検証も未実施。

## 7. 次の作業

Googleログイン、二人限定の許可、Next.jsとNestJS間の本人確認、セッション管理を設計する。その後、予定・達成・予約APIを具体化する。

実装段階ではNeonまたは独立したPostgreSQL検証DBで、別々の接続による二重精算・完了と取消の競合・ロールバック・再送を検証し、この段階の未検証部分を埋める。


## 運用設計への接続（2026-09-09）

詳細設計08でpoolの解放、タイムアウト初期値、実行／管理ロール、DB更新の公開順、dump／restore手順を追加した。実行ロールの最終GRANTはBetter Auth標準スキーマと実クエリを確認して作成する。初期のDBエラー再試行はサーバーで自動化せず、確定したロールバックと結果不明を区別して07の同じ要求による確認へ接続する。
