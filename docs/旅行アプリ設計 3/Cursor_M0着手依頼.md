# CursorへのM0着手依頼

更新日：2026-09-11。M-1のアーキテクチャ判断は完了。以下はCursorへ渡す依頼文であり、この資料を作成した時点では実装していません。

## 依頼

旅行WebアプリのM0「開発基盤と互換性の検証」を実施してください。

まず対象リポジトリのAGENTS.md・既存コード・未コミット変更を確認し、既存成果物を上書きしないでください。この資料と同じフォルダのCursor引き継ぎ.md、詳細設計11、10、09、08、03、02を読み、必要に応じてその他の設計も参照してください。古い未確定表記より最新の合意を優先してください。

### 採用構成

- apps/web：Next.js App Router＋React＋TypeScript。app → screens → features → shared、機能内はui／model／api。
- apps/api：NestJS＋TypeScriptのモジュラーモノリス。業務モジュールごとにController／UseCase／Service／Domain／Infrastructure／Adapterの6区分。
- Adapterは本プロジェクトではIF定義の配置を意味します。UseCaseはIFへ依存し、Service／Infrastructureの実装はModuleで注入します。Domainはフレームワーク・DBに依存させません。
- UseCaseが処理順とtransactionを管理し、Serviceは副作用のない業務計算、Domainは値・Entityのルールを担当します。
- packages/contracts：公開API契約のみ。DB schema・秘密情報・サーバーdomainをwebへ共有しません。
- Node 22.x、Drizzle＋pg、Vitestを前後共通、APIはSupertest、実DBはTestcontainers、画面E2EはPlaywright。相互互換性を確認して依存を固定してください。

### M0の実施範囲

1. 既存リポジトリに合わせてworkspaceと上記の最小ディレクトリ構成を整備する。未実装機能の空クラスを大量に作らない。
2. TypeScript・lint・import境界・Node指定・lockfile・開発手順を設定する。
3. NestのIF／DIとService／Domainの接続が成立する最小例をテストする。架空の検証例を実機能の完成として報告しない。
4. Nextの画面入口・Client境界と本番build、api buildを検証する。
5. Vitestのweb／api設定、@nestjs/testing、Supertest、Testcontainersの基盤を作る。Dockerが使えなければ実DB検証は未完了として報告し、PGliteへ置換して合格にしない。
6. GitHub Actionsのquality／build／最小api-db検証を実装する。未作成のE2Eや業務テストを成功扱いにせず、必要な段階で有効化する。
7. 実行コマンド、実バージョン、検証結果、残課題をREADME等へ記録する。

### 境界

sql/00_validation_prerequisites.sqlは本番migrationではありません。認証標準表の生成と本番migrationの統合はM1で行います。金銭処理・認証・通知の本実装をこの依頼で一括完了させる必要はありません。公開用のテストログイン裏口は作らないでください。

Vercel／Neonの公開、本番データ操作、有料契約はM0の作業に含みません。GitHub Actionsを動かす際も本番秘密を渡さず、08の無料枠条件を維持してください。

### 完了報告

変更内容、確認した依存バージョン、実行した検証と結果、未実行の理由、M1に必要な残作業を報告してください。層間依存制約、IF経由のDI、web/api build、実PostgreSQL起動・破棄の結果を明記してください。
