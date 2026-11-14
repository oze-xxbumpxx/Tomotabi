# 実装計画: todo-organize（ToDoのカテゴリ分けと予定との関連付け）

- 前提となる設計書: docs/designs/todo-organize.md（PR #351で承認）
- 試験計画: docs/tests/todo-organize.md
- レベル: L3
- 実装ルート: Devin委譲（承認済みのタスクだけ）
- 判断理由: 設計まではClaude Code、実装はDevinのクラウドでSWE-2に任せる（2026-11-14 ユーザーの指示）。

## 進め方

設計書の「移行とリリース」のとおり、3つのタスクに分け、1つずつDevinに渡す。後のタスクは前のタスクのPRがマージされてから渡す（同じファイルを触るため、並行にしない）。

| タスク      | 中身                                                                                     | 前提               | SWE-2のeffort                                                         |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| `api`       | DB・契約・API。カテゴリと3つの欄、完了の付け外しで関連付けを残す                         | この計画のマージ   | max（DB・契約・4つのUseCase・同時の書き込みの試験があり、一番大きい） |
| `web-list`  | ToDoのリストと詳細（カテゴリ・担当・期限・絞り込み）                                     | `api`のマージ      | high                                                                  |
| `plan-link` | 予定との関連付け（予定を作っても完了にしない、予定を選ぶ、予定の詳細の「関連するToDo」） | `web-list`のマージ | high                                                                  |

委譲は`delegation.mjs open-task`で`--runner cloud`を付けて作り、`delegation-launch.mjs --runner cloud`で起動する。クラウドのCLIは`--model`を無視するので、起動の前にDevin Webのセッションエージェントのモデルを、ユーザーにSWE-2へ合わせてもらう。

## 変更対象ファイル

| path                                                                                                                                                   | なぜ変えるか                                                         | タスク                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------- |
| `apps/api/src/infrastructure/database/schema/planning.ts`                                                                                              | カテゴリの表、ToDoの3列、制約を外す                                  | `api`                   |
| `apps/api/src/infrastructure/database/schema/infra.ts`                                                                                                 | 受領の種類を3つ足す                                                  | `api`                   |
| `apps/api/drizzle/meta/_journal.json`ほか`meta/`                                                                                                       | migrationの記録（`npm run db:generate`で作る）                       | `api`                   |
| `packages/contracts/openapi/planning.json`                                                                                                             | カテゴリの4つの操作、ToDoの入力と応答                                | `api`                   |
| `packages/contracts/src/plan.ts`、`src/index.ts`                                                                                                       | `TodoCategory`ほかの型、`Todo`・`TodoPlan`・`TodoList`を広げる       | `api`                   |
| `apps/api/src/generated/planning.zod.ts`、`apps/web/src/shared/api/generated/planning.ts`、`planning.zod.ts`                                           | 生成物（`npm run api:generate`で作り直す。手で直さない）             | `api`                   |
| `apps/api/src/common/idempotency/command-receipt.ts`                                                                                                   | 受領の種類                                                           | `api`                   |
| `apps/api/src/modules/planning/domain/todo.ts`                                                                                                         | 3つの欄、`complete`・`reopen`の関連付け、`linkPlan`                  | `api`・`plan-link`      |
| `apps/api/src/modules/planning/adapter/inbound/todo.input-port.ts`                                                                                     | 入力の欄、カテゴリの入力の口                                         | `api`                   |
| `apps/api/src/modules/planning/adapter/outbound/todo.repository.ts`                                                                                    | `countByCategory`・`deleteByCategory`、`TodoPlanLink.name`           | `api`                   |
| `apps/api/src/modules/planning/adapter/outbound/planning-work-context.ts`                                                                              | `todoCategories`                                                     | `api`                   |
| `apps/api/src/modules/planning/adapter/outbound/planning-read.port.ts`                                                                                 | 一覧にカテゴリ                                                       | `api`                   |
| `apps/api/src/modules/planning/infrastructure/drizzle-todo.repository.ts`                                                                              | 3列、件数と削除                                                      | `api`                   |
| `apps/api/src/modules/planning/infrastructure/pg-planning-read.ts`                                                                                     | 一覧を同じ読み取りのトランザクションで読む                           | `api`                   |
| `apps/api/src/modules/planning/infrastructure/pg-planning-unit-of-work.ts`                                                                             | `todoCategories`を組み立てる                                         | `api`                   |
| `apps/api/src/modules/planning/usecase/create-todo.usecase.ts`、`update-todo.usecase.ts`、`list-todos.usecase.ts`、`todo-dto.ts`、`todo-write-flow.ts` | 新しい欄の確かめと保存                                               | `api`・`plan-link`      |
| `apps/api/src/modules/planning/usecase/complete-todo.usecase.ts`、`reopen-todo.usecase.ts`                                                             | 関連付けを残す                                                       | `api`                   |
| `apps/api/src/modules/planning/usecase/create-plan.usecase.ts`                                                                                         | 予定を作っても完了にしない                                           | `plan-link`             |
| `apps/api/src/modules/planning/controller/todos.controller.ts`                                                                                         | 新しい欄を渡す                                                       | `api`                   |
| `apps/api/src/modules/planning/planning.module.ts`、`apps/api/src/composition/planning-composition.module.ts`                                          | カテゴリのControllerとUseCaseを登録                                  | `api`                   |
| `apps/web/src/features/todos/api/todos-api.ts`、`model/todo-queries.ts`、`model/todo-save.ts`、`index.ts`                                              | カテゴリの保存、新しい欄                                             | `web-list`              |
| `apps/web/src/screens/todos/todos-screen.tsx`、`todo-actor.ts`                                                                                         | カテゴリごとの欄、絞り込み、`withDone`で予定を残す                   | `web-list`              |
| `apps/web/src/screens/todo-detail/todo-detail-screen.tsx`                                                                                              | カテゴリ・担当・期限（`web-list`）、関連する予定（`plan-link`）      | `web-list`・`plan-link` |
| `apps/web/src/screens/plan-detail/plan-detail-screen.tsx`、`apps/web/src/features/plans/ui/plan-detail.tsx`                                            | 「関連するToDo」                                                     | `plan-link`             |
| `apps/web/src/screens/plan-form/plan-form-screen.tsx`                                                                                                  | ToDoから開いたときの文                                               | `plan-link`             |
| `apps/web/src/shared/browser/pending-requests.ts`                                                                                                      | カテゴリの4つの経路                                                  | `web-list`              |
| `apps/web/src/app/globals.css`                                                                                                                         | 欄・印・メニューの見た目                                             | `web-list`・`plan-link` |
| `docs/requirements/trip-todo.md`、`docs/designs/trip-todo.md`                                                                                          | 変わる決まり（元のF-03・F-07・F-10・F-12・対象外）にこの機能への案内 | `plan-link`             |
| `docs/glossary.md`                                                                                                                                     | 「ToDo」を直し、「カテゴリ」「関連付け」を足す                       | `plan-link`             |

## 新規作成ファイル

| path                                                                                                                                                                                | 役割                                                                   | タスク      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| `apps/api/drizzle/0013_<名前>.sql`                                                                                                                                                  | カテゴリの表、ToDoの3列、制約を外す、受領の種類                        | `api`       |
| `apps/api/drizzle/0014_<名前>.sql`                                                                                                                                                  | アプリのロールへの権限（今の`0012_planning_todos_grants.sql`と同じ形） | `api`       |
| `apps/api/src/modules/planning/domain/todo-category.ts`                                                                                                                             | カテゴリのDomain                                                       | `api`       |
| `apps/api/src/modules/planning/adapter/inbound/todo-category.input-port.ts`                                                                                                         | カテゴリの入力の口と操作名                                             | `api`       |
| `apps/api/src/modules/planning/adapter/outbound/todo-category.repository.ts`                                                                                                        | カテゴリのRepositoryの口                                               | `api`       |
| `apps/api/src/modules/planning/infrastructure/drizzle-todo-category.repository.ts`                                                                                                  | 実装                                                                   | `api`       |
| `apps/api/src/modules/planning/usecase/create-todo-category.usecase.ts`、`rename-todo-category.usecase.ts`、`reorder-todo-categories.usecase.ts`、`delete-todo-category.usecase.ts` | 4つの操作                                                              | `api`       |
| `apps/api/src/modules/planning/controller/todo-categories.controller.ts`                                                                                                            | カテゴリの経路                                                         | `api`       |
| `apps/api/tests/domain/todo-category.test.ts`、`tests/usecase/planning/todo-category-usecase.test.ts`、`tests/db/todo-categories-http.db.test.ts`                                   | 試験                                                                   | `api`       |
| `apps/web/src/features/todos/model/todo-due.ts`、`todo-groups.ts`                                                                                                                   | 期限の印、絞り込み、欄への振り分け                                     | `web-list`  |
| `apps/web/tests/todo-due.node.test.ts`                                                                                                                                              | 上の試験                                                               | `web-list`  |
| `apps/web/src/screens/todos/todo-category-section.tsx`、`todo-category-sheet.tsx`                                                                                                   | 欄とメニュー、追加・名前の変更・削除のシート                           | `web-list`  |
| `apps/web/src/screens/todo-detail/plan-picker-sheet.tsx`                                                                                                                            | 予定を選ぶシート                                                       | `plan-link` |
| `apps/web/src/screens/plan-detail/plan-todos-section.tsx`                                                                                                                           | 「関連するToDo」の欄                                                   | `plan-link` |

新しい画面の部品の名前は目安。今のフォルダの分け方に合えば、別の名前でもよい。

## ファイルごとの変更内容

各タスクの「やること」に書く（下の`delegation-task`の区間）。区間の本文がそのままIssueになる。

## 実装手順

<!-- delegation-task:api -->

## 目的

ToDoにカテゴリ・担当・期限を足すため、DB・契約・APIを作る。完了の付け外しで予定との関連付けを残す変更（要件F-18）も、このPRで入れる。「予定にすると完了になる」（今の動き）は変えない。L3、ユーザー承認: 済み（設計書はPR #351で承認）。

## 読む資料

- 設計書: `docs/designs/todo-organize.md`（「API 設計」「DB 設計」「バックエンド設計」「移行とリリース」）
- 要件: `docs/requirements/todo-organize.md`
- 試験計画: `docs/tests/todo-organize.md`（記号が`A`の観点）
- 今のToDoの作り: `apps/api/src/modules/planning/`の`todo`がつくファイル、`apps/api/drizzle/0011_planning_todos.sql`・`0012_planning_todos_grants.sql`

## やること

- [ ] DB: `planning.todo_categories`を足す。`planning.todos`に`category_id`・`assignee_id`・`due_on`を足し、`todo_plan_requires_done`の制約を外す。`infra.command_receipts`の`resource_type`の制約に`todo_category`・`todo_category_order`・`todo_category_deletion`を足す。外部キーと索引は設計書の「DB 設計」のとおり。
- [ ] migrationは`npm run db:generate`で作り、表・列・制約（0013）と権限（0014）の2本にする。権限は今の`0012_planning_todos_grants.sql`と同じ形で書く。
- [ ] 契約: `packages/contracts/openapi/planning.json`に、カテゴリの追加（`POST /todo-categories`）・名前の変更（`PATCH /todo-categories/{categoryId}`）・並べ替え（`PUT /todo-categories/order`）・削除（`POST /todo-categories/{categoryId}/delete`）を足す。`GET /todos`の応答に`categories`、`Todo`に`categoryId`・`assigneeId`・`dueOn`、`TodoPlan`に`name`を足す。`POST /todos`に`categoryId?`、`PATCH /todos/{todoId}`に`categoryId?`・`assigneeId?`・`dueOn?`を足す。`packages/contracts/src/plan.ts`の型を合わせ、`npm run api:generate`で生成物を作り直す。
- [ ] `planId`は、このPRでは`POST /todos`と`PATCH /todos`の入力に足さない（3つ目のタスクで足す）。
- [ ] Domain: `todo-category.ts`（`rename`）を足す。`Todo.update`に3つの欄を足す。`Todo.complete`は、引数の`planId`がnullなら今の関連付けを残す。`Todo.reopen`は`planId`を消さない。
- [ ] UseCase: カテゴリの4つの操作を、ToDoの`runTodoUpdate`と同じ流れ（旅行行 → 受領 → 行のロック → 版 → Domain → 保存と受領）で作る。追加と並べ替えは、旅行のカテゴリを全部`FOR UPDATE`でロックしてから数える・順を比べる。削除は`expectedTodoCount`と保存のときの件数を比べ、違えば409 `TODO_COUNT_CHANGED`。同じなら中のToDoを消してからカテゴリを消す。
- [ ] ToDoの追加と編集で`categoryId`・`assigneeId`を付けるときは、同じ旅行のカテゴリか、旅行の参加者かを同じトランザクションで確かめる。エラーコードは設計書の「API 設計」の表のとおり。
- [ ] 一覧: カテゴリを二人の決めた順で返し、ToDoは追加した順で返す。2つを`REPEATABLE READ`の読み取り専用のトランザクションの中で続けて読む。関連する予定の名前も返す。
- [ ] ロックの順は、旅行 → 予定 → カテゴリ → ToDo。
- [ ] 書き込みのログにカテゴリの4つの操作を足す。カテゴリの名前は入れない。

## テスト

- [ ] 試験計画の`A-D01`〜`A-D10`、`A-U01`〜`A-U06`、`A-I01`〜`A-I21`を、試験計画の「試験種別」の置き場に書く。
- [ ] 今のToDoの試験で「未完了に戻すとつながりが消える」を確かめている箇所は、関連付けが残る形に書き直す。それ以外の今の試験は通ったまま。
- [ ] `npm run test:api-db`・`npm run api:check`・`npm run db:check`が通る。

## やらないこと

- 画面（`apps/web/src/screens/`・`apps/web/src/features/`）の変更。生成物の作り直しで`apps/web/src/shared/api/generated/`が変わるのはよい。
- `POST /plans`の動き（予定にするとToDoが完了になる）の変更。3つ目のタスクで変える。
- ToDoの入力への`planId`の追加。3つ目のタスクで足す。
- 通知のイベント。

## 完了条件

- `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る。
- `npm run test:api-db` / `npm run api:check` / `npm run db:check`が通る。

## 進め方

`.agents/skills/devin-workflow/SKILL.md`に従う。ブランチは`devin/<内容>-<この Issue の番号>`。PR本文に`Closes #<この Issue の番号>`を書く。

<!-- /delegation-task -->

<!-- delegation-task:web-list -->

## 目的

ToDoのリストをカテゴリごとの欄にし、担当・期限・絞り込みを足す。ToDoの詳細にカテゴリ・担当・期限を選ぶ欄を足す。L3、ユーザー承認: 済み（設計書はPR #351で承認）。前のタスク（DB・契約・API）のPRがマージされてから始める。

## 読む資料

- 設計書: `docs/designs/todo-organize.md`（「フロントエンド設計」）
- 要件: `docs/requirements/todo-organize.md`（F-01〜F-14、E-01〜E-05・E-11、B-01〜B-07）
- 試験計画: `docs/tests/todo-organize.md`（記号が`W`の観点）
- 画面の見本: https://claude.ai/artifact/LRsVh7g3KmuPN4bfVNtXrE （「ToDoのリスト」「ToDoの詳細」。言葉は見本のとおり。見本の「関連する予定」と「新しく予定を作る」は次のタスク）
- 画面の言葉の決まり: `.claude/rules/writing-style.md`の「使わない書き方」の表（画面の言葉の行）
- 今の画面: `apps/web/src/screens/todos/`、`apps/web/src/screens/todo-detail/`、`apps/web/src/features/todos/`

## やること

- [ ] リスト: 上に「4件済み · 残り6件」と進み具合の棒、その下に絞り込み（すべて・自分の担当・期限が近い）。カテゴリの欄を二人の決めた順に出し、最後に未分類の欄。欄の中は未完了が上、完了が下、それぞれ追加した順。カテゴリが0個なら欄の見出しを出さない。
- [ ] 欄の見出しに、名前・「1 / 3 件済み」・メニュー（名前を変更・上へ移動・下へ移動・削除）。見出しを押すとたためる。たたんだ欄と、追加の欄で最後に選んだカテゴリは`localStorage`に旅行ごとに覚える（読めないときは覚えない）。絞り込みは覚えない。
- [ ] 「カテゴリを追加」、名前の変更、削除の確かめは、今の画面と同じシートで出す。削除の確かめには名前と「ToDo 3件も削除されます」を出し、APIに`expectedTodoCount`を送る。409 `TODO_COUNT_CHANGED`なら、件数が変わったことを出して一覧を読み直す。
- [ ] 追加の欄は画面の下に置き、入れるカテゴリを選べる。
- [ ] 行に、未完了なら期限（「10/5まで」）と担当の名前、関連する予定（今の「10/13 の予定 ›」を「10/12 新幹線で京都へ ›」の形に）を出す。
- [ ] 完了の印を押した直後の見た目（今の`withDone`）は、`plan`を消さずに残す。
- [ ] ToDoの詳細: 内容の下にカテゴリ・担当（自分・相手・未定）・期限の行を足す。選んだらすぐ`PATCH`で保存する。期限の欄には「あと3日」「今日まで」「期限切れ」を出す。内容とメモは今のまま「変更を保存」。
- [ ] 期限の印と絞り込みと欄への振り分けは、`features/todos/model/`の関数にまとめる。「今日」は日本の日付（`shared/lib/local-date`）で決める。
- [ ] 端末に残す仕組みの許可リスト（`shared/browser/pending-requests.ts`）に、カテゴリの4つの経路を足す。

## テスト

- [ ] 試験計画の`W-C01`〜`W-C06`、`W-S01`〜`W-S15`、`W-E01`を、試験計画の「試験種別」の置き場に書く。
- [ ] 今の`todos-screens.test.tsx`と`todo.spec.ts`は、欄の組み方が変わった箇所を新しい形に直し、それ以外は通ったまま。

## 既知の指摘（関係する領域のときだけ）

- E2E: 日付は今日から数えて作り、年や日を決め打ちしない。要素は役割・見出し・ラベルで探し、クラス名で探さない。APIを模擬したら、外す条件をPRの説明に書く。

## やらないこと

- APIと契約の変更。前のタスクで作ったものだけを使う。
- ToDoの詳細の「関連する予定」と「新しく予定を作る」、予定の詳細の「関連するToDo」、予定の追加の画面の文。次のタスクで作る。
- ホームの画面の変更。

## 完了条件

- `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る。
- `npm run test:e2e`が通る。

## 進め方

`.agents/skills/devin-workflow/SKILL.md`に従う。ブランチは`devin/<内容>-<この Issue の番号>`。PR本文に`Closes #<この Issue の番号>`を書く。

<!-- /delegation-task -->

<!-- delegation-task:plan-link -->

## 目的

未完了のToDoも予定と関連付けられるようにし、予定の詳細に「関連するToDo」を出す。ToDoから予定を作っても、ToDoを完了にしない（要件F-19。今の動きを変える）。L3、ユーザー承認: 済み（設計書はPR #351で承認）。前のタスク（ToDoのリストと詳細）のPRがマージされてから始める。

## 読む資料

- 設計書: `docs/designs/todo-organize.md`（「データフロー」の予定を作る流れ、「API 設計」、「フロントエンド設計」）
- 要件: `docs/requirements/todo-organize.md`（F-15〜F-23、E-06〜E-08）
- 試験計画: `docs/tests/todo-organize.md`（記号が`L`の観点）
- 画面の見本: https://claude.ai/artifact/LRsVh7g3KmuPN4bfVNtXrE （「ToDoの詳細」の関連する予定、「予定を選ぶ」、「予定の詳細」）。見本では、関連する予定があるToDoにも「新しく予定を作る」を描いているが、出すのは関連する予定が無い未完了のToDoだけ（要件F-19）。
- 今の作り: `apps/api/src/modules/planning/usecase/create-plan.usecase.ts`（`completeSourceTodo`）、`apps/web/src/screens/plan-detail/`、`apps/web/src/screens/plan-form/plan-form-screen.tsx`

## やること

- [ ] 契約とAPI: `POST /todos`と`PATCH /todos/{todoId}`に`planId?`を足す。同じ旅行の、取りやめていない予定だけを受け付け、それ以外は422 `TODO_PLAN_NOT_AVAILABLE`。`null`で外す。すでに付いている予定が取りやめになっていても、ほかの欄の編集は通す。`npm run api:generate`で生成物を作り直す。
- [ ] Domain: `Todo.linkPlan(todo, planId, at)`を足す。`Todo.complete`から`planId`の引数を外す。
- [ ] 予定の追加: `CreatePlanUseCase`の`completeSourceTodo`を、ToDoに関連する予定が無いときだけ`linkPlan`する形に変える。ToDoは完了にしない。ToDoが無い・別の予定と関連付いているときは何もしない（予定は作る）。
- [ ] ToDoの詳細: 「関連する予定」の欄を足す。押すと予定を選ぶシートを開き、旅行の期間の予定を日付ごとに並べる（取りやめた予定は出さない）。1つ選んで「決定」ですぐ保存する。関連付けを外すボタンと「予定を変更」を出す。
- [ ] ToDoの詳細の主ボタン「新しく予定を作る」（今の「予定にする」）は、未完了で関連する予定が無いときだけ出す。
- [ ] 予定の詳細: メモの下に「関連するToDo」の欄を足す。ToDoの一覧を`plan.id`で絞り、未完了を上・完了を下、それぞれ追加した順に並べる。「1 / 3 件済み」と、未完了があれば「未完了のToDoが2件あります」を出す。完了の印の付け外しと、一行の追加（`planId`つき）ができる。取りやめた予定では追加の欄を出さない。
- [ ] 予定の追加の画面: ToDoから開いたときの文を「ToDoの「…」から作ります。保存すると、このToDoと関連付けられます。」に変える。
- [ ] 文書: `docs/requirements/trip-todo.md`と`docs/designs/trip-todo.md`の、変わった決まり（元のF-03・F-07・F-10・F-12と「対象外」）に、`docs/requirements/todo-organize.md`への案内を1行ずつ足す。`docs/glossary.md`の「ToDo」を直し、「カテゴリ」「関連付け」を足す。

## テスト

- [ ] 試験計画の`L-D01`、`L-C01`、`L-I01`〜`L-I09`、`L-S01`〜`L-S08`、`L-E01`・`L-E02`を、試験計画の「試験種別」の置き場に書く。
- [ ] 今の試験で「予定にすると完了になる」を確かめている箇所は、完了にならず関連付く形に書き直す。それ以外の今の試験は通ったまま。
- [ ] `npm run test:api-db`・`npm run api:check`が通る。

## 既知の指摘（関係する領域のときだけ）

- E2E: 日付は今日から数えて作り、年や日を決め打ちしない。要素は役割・見出し・ラベルで探し、クラス名で探さない。APIを模擬したら、外す条件をPRの説明に書く。

## やらないこと

- DBの変更。前のタスクで済んでいる。
- 予定の応答（`Plan`）の形の変更。
- 1つのToDoを複数の予定と関連付けること、予定の取りやめでToDoを変えること。

## 完了条件

- `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る。
- `npm run test:api-db` / `npm run api:check` / `npm run test:e2e`が通る。

## 進め方

`.agents/skills/devin-workflow/SKILL.md`に従う。ブランチは`devin/<内容>-<この Issue の番号>`。PR本文に`Closes #<この Issue の番号>`を書く。

<!-- /delegation-task -->

## 依存関係

- `api` → `web-list` → `plan-link`の順。どれも前のPRのマージのあとに渡す。
- `api`のmigrationは、結合検証環境では`api`のPRのマージのあと、今の手順（デプロイの前にmigrationを流す）で流す。

## テスト計画

`docs/tests/todo-organize.md`のとおり。観点の記号（`A`・`W`・`L`）がタスクに対応する。

## リスク

| リスク                                                                                        | いつ分かるか   | どうするか                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `npm run db:generate`が、制約を外す変更と表の追加を1本にまとめない                            | `api`の作業中  | 手で1本の`0013`にまとめ、`npm run db:check`で差分が無いことを確かめる                             |
| 一覧の読み取りのトランザクションで、今の`PgPlanningRead`の作り（プールから1文ずつ）と合わない | `api`の作業中  | `listTodos`だけ、プールから接続を1つ取り、`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`で読む |
| 今の試験の書き直しが多く、決まりの変更と関係ない試験まで変える                                | 各PRのレビュー | レビューで、書き直した試験が試験計画の「回帰試験範囲」の2つの決まりに当たるかを見る               |
| クラウドのDevinのモデルがSWE-2でない                                                          | 起動の前       | 起動の前に、ユーザーにDevin Webのセッションエージェントのモデルを確かめてもらう                   |

## ロールバック方法

設計書の「移行とリリース」のとおり。画面 → API → DBの順で戻す。`plan-link`を出したあとは、APIを`api`のPR以降の版までしか戻さない。

## ドキュメント更新対象

- `docs/requirements/trip-todo.md`・`docs/designs/trip-todo.md`・`docs/glossary.md`（`plan-link`のタスク）。
- ドメインモデルの文書は無い（`docs/01`〜`07`は未作成）。
