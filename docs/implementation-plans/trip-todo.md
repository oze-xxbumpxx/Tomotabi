# 実装計画: trip-todo

- 前提となる設計書: docs/designs/trip-todo.md
- レベル: L3
- 実装ルート: メインのセッション
- 判断理由: 既定。予定の追加の書き込みと受領の表に手が入り、設計の文脈を持ったまま進めたい

## 変更対象ファイル

| path                                                                                                                  | なぜ変えるか                                                                                        |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/api/src/infrastructure/database/schema/planning.ts`                                                             | `todos`の表を足す                                                                                   |
| `apps/api/src/infrastructure/database/schema/infra.ts`                                                                | 受領の`resource_type`のcheckに`todo`・`todo_deletion`を足す                                         |
| `apps/api/src/common/idempotency/command-receipt.ts`                                                                  | `resourceType`の型に同じ2つを足す                                                                   |
| `apps/api/src/modules/planning/adapter/outbound/planning-work-context.ts`                                             | `todos: TodoRepository`を足す                                                                       |
| `apps/api/src/modules/planning/infrastructure/pg-planning-unit-of-work.ts`                                            | 文脈に`DrizzleTodoRepository`を渡す                                                                 |
| `apps/api/src/modules/planning/adapter/inbound/create-plan.input-port.ts`                                             | 入力に`fromTodoId`を足す                                                                            |
| `apps/api/src/modules/planning/usecase/create-plan.usecase.ts`                                                        | 予定のINSERTのあと、同じトランザクションでToDoを完了にする                                          |
| `apps/api/src/modules/planning/controller/plans.controller.ts`                                                        | 本文の`fromTodoId`を渡す                                                                            |
| `apps/api/src/modules/planning/planning.module.ts`                                                                    | ToDoのUseCaseとControllerを登録する                                                                 |
| `packages/contracts/openapi/planning.json`                                                                            | ToDoの6操作、`Todo`・`TodoList`・`TodoCreate`・`TodoPatch`・`TodoDeletion`、`PlanCreate.fromTodoId` |
| `packages/contracts/src/plan.ts`・`packages/contracts/src/index.ts`                                                   | 型を足して公開する                                                                                  |
| `apps/api/src/generated/planning.zod.ts`・`apps/web/src/shared/api/generated/`                                        | `npm run api:generate`で作り直す（手で直さない）                                                    |
| `apps/web/src/features/trips/ui/trip-tab-bar.tsx`                                                                     | `TripTab`に`todos`、タブを5つ                                                                       |
| `apps/web/src/app/globals.css`                                                                                        | `.tabbar-inner`を5列、ToDoの画面の部品                                                              |
| `apps/web/src/shared/browser/pending-requests.ts`                                                                     | 許可リストにToDoの5つの経路                                                                         |
| `apps/web/src/app/trips/[tripId]/route-query.ts`                                                                      | `?fromTodo=`の読み解き                                                                              |
| `apps/web/src/app/trips/[tripId]/plans/new/plan-new-route.tsx`・`apps/web/src/screens/plan-form/plan-form-screen.tsx` | ToDoから開いたときの初期値と説明、`fromTodoId`を送る                                                |

## 新規作成ファイル

| path                                                                                                                                                 | 役割                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/api/drizzle/0011_planning_todos.sql`                                                                                                           | 表・check・索引、受領のcheckの置き換え（`npm run db:generate`で作り、必要なら手で整える） |
| `apps/api/drizzle/0012_planning_todos_grants.sql`                                                                                                    | 実行用のロールへの`SELECT, INSERT, UPDATE, DELETE`                                        |
| `apps/api/src/modules/planning/domain/todo.ts`                                                                                                       | ToDoの値と`create`・`rename`・`changeMemo`・`complete`・`reopen`                          |
| `apps/api/src/modules/planning/adapter/outbound/todo.repository.ts`                                                                                  | Repositoryの口                                                                            |
| `apps/api/src/modules/planning/infrastructure/drizzle-todo.repository.ts`                                                                            | Drizzleの実装（一覧は予定をLEFT JOIN）                                                    |
| `apps/api/src/modules/planning/adapter/inbound/todo.input-port.ts`                                                                                   | 6操作の入力と結果の型                                                                     |
| `apps/api/src/modules/planning/usecase/todo-dto.ts`                                                                                                  | Domain → 契約の`Todo`                                                                     |
| `apps/api/src/modules/planning/usecase/todo-write-flow.ts`                                                                                           | 旅行FOR SHARE → 受領 → ToDoのロック → 保存の共通の流れ                                    |
| `apps/api/src/modules/planning/usecase/list-todos.usecase.ts` ほか5つ（`create-todo`・`update-todo`・`complete-todo`・`reopen-todo`・`delete-todo`） | 各操作                                                                                    |
| `apps/api/src/modules/planning/controller/todos.controller.ts`                                                                                       | `/api/trips/:tripId/todos`の6つの口                                                       |
| `apps/web/src/features/todos/api/todos-api.ts`・`model/todo-queries.ts`・`model/todo-save.ts`・`index.ts`                                            | 取得と5つの書き込み                                                                       |
| `apps/web/src/screens/todos/todos-screen.tsx`                                                                                                        | ToDoのリスト                                                                              |
| `apps/web/src/screens/todo-detail/todo-detail-screen.tsx`（削除の確認も同じファイル）                                                                | 詳細と削除の確認                                                                          |
| `apps/web/src/app/trips/[tripId]/todos/page.tsx`・`todos-route.tsx`                                                                                  | ルート                                                                                    |
| `apps/web/src/app/trips/[tripId]/todos/[todoId]/page.tsx`・`todo-detail-route.tsx`                                                                   | ルート                                                                                    |

## 実装手順

1. DBと受領の種類 … `schema/planning.ts`・`schema/infra.ts`・`command-receipt.ts`・migration 2本 / 表・check・索引・権限・受領のcheck / `npm run db:check -w @tomotabi/api`が通り、`tests/db/planning-schema.db.test.ts`にToDoのcheckの試験が通る
2. 契約 … `openapi/planning.json`・`contracts/src` / 6操作と`fromTodoId`を足し、`npm run api:generate` / `npm run api:check`が通る
3. Domain … `domain/todo.ts` / 名前・メモの値型は予定と同じものを使う / `tests/domain/todo.test.ts`が通る
4. Repositoryと文脈 … `todo.repository.ts`・`drizzle-todo.repository.ts`・`planning-work-context.ts`・`pg-planning-unit-of-work.ts` / 一覧は`(trip_id, created_at, id)`順で予定をLEFT JOIN / 型検査が通る
5. ToDoのUseCase … `todo-write-flow.ts`と6つのUseCase / 上限200・版の確認（編集だけ）・削除は`{ id }`を受領に残す / `tests/usecase/planning/todo-usecase.test.ts`が通る
6. 予定の追加を広げる … `create-plan.input-port.ts`・`create-plan.usecase.ts` / 予定のINSERTのあとToDoをロックして未完了なら完了。無い・完了済みは何もしない / 今の`plan-usecase.test.ts`と`write-usecase.test.ts`が落ちず、足した試験が通る
7. Controllerと登録 … `todos.controller.ts`・`plans.controller.ts`・`planning.module.ts` / `tests/db/todos-http.db.test.ts`が通る（403・404・409・再送・`fromTodoId`）
8. webの取得と保存 … `features/todos`・`pending-requests.ts` / `tests/pending-requests.test.tsx`にToDoの経路、`tests/todos-screens.test.tsx`が通る
9. 下のタブ … `trip-tab-bar.tsx`・`globals.css` / `tests/trip-tab-bar.test.tsx`が5つのタブで通る
10. ToDoの画面 … `screens/todos`・`screens/todo-detail`・ルート2つ / Claude Designの見本どおり。`tests/todos-screens.test.tsx`が通る
11. 予定の追加の画面 … `route-query.ts`・`plan-new-route.tsx`・`plan-form-screen.tsx` / 名前とメモが入り、説明が出て、`fromTodoId`を送る / `tests/route-query.test.ts`・`tests/plans-screens.test.tsx`が通る
12. E2E … `e2e/tests/todo.spec.ts` / 追加 → 予定にする → しおりに予定 → ToDoが完了で「の予定」から予定の詳細が開く
13. 品質確認 … `bash .claude/scripts/run-quality-gates.sh`、`reviewer`と`security-reviewer`

## 依存関係

- 1 → 4（表が要る）、2 → 5・7・8（生成した型とzodが要る）、3 → 5、5 → 6・7、8 → 10・11、9は8と並べてよい。
- apiとwebは同じPRに入れる。契約は`fromTodoId`を任意で足すだけなので、apiを先に出してもwebは壊れない。

## テスト計画

`docs/tests/trip-todo.md`の観点を、上の手順の試験のファイルに分けて置く。apps/webの試験は`tests/**/*.test.ts(x)`（`apps/web/vitest.config.ts`の`include`）、apps/apiのDBつきは`tests/db/*.db.test.ts`。

## リスク

- 受領のcheckの置き換えは、今ある行が新しいcheckを満たすかをmigrationの中で確かめる（今の種類をすべて残すので満たす）。
- 下のタブを5つにすると、今の画面の試験（`trip-tab-bar.test.tsx`・`screen-skeletons.test.tsx`）でタブの数を見ている所が落ちる。期待値を5つに直す。
- 予定の追加の要求の要約に`fromTodoId`が入るので、今の再送の試験の要約の期待値が変わらないこと（`fromTodoId`が無いときは今と同じ本文）を確かめる。

## ロールバック方法

- コードはPRを戻す。migrationは表を足しただけなので、戻すときは`planning.todos`を消し、受領のcheckを元の種類に戻すmigrationを足す（受領に`todo`の行が残っていれば先に消す。消すのはユーザーの確認のあと）。

## ドキュメント更新対象

- `docs/glossary.md`に「ToDo」（旅行ごとのリストの項目。予定にすると完了になる）を足す。
- ドメインモデルの文書は無いので対象外。ADRは要らない（今の書き込みの流れと受領の仕組みに載せるだけ）。
