# 実装計画: screen-speed（画面の速さと読み込み中の表示）

- 設計書: [docs/designs/screen-speed.md](../designs/screen-speed.md)
- レベル: L2。設計は2026-10-18にユーザーがチャットで承認（PR #234）
- 担当: Claude Code（1つのPR）

## 手順

| # | 内容 | 対象ファイル | 完了条件 |
| --- | --- | --- | --- |
| 1 | 骨組みの共通部品（`Skeleton`・`SkeletonCard`）と、`Loading`を共通の骨組み（見出し1本とカード2枚）に置き換える | `apps/web/src/shared/ui/state/loading.tsx`、`globals.css` | `Loading`の`role="status"`と「読み込み中」が残る。既存の試験が通る |
| 2 | 4画面の骨組み（ホーム・しおり・記録・精算）。本物と同じ外側のクラス名を使う | `apps/web/src/screens/{home,itinerary,records,settlement}/*-skeleton.tsx` と各画面 | 各画面の`isPending`のときに骨組みが出る（SS-T01） |
| 3 | 「更新中」を重ねる札にし、0.5秒続いたときだけ出す | `apps/web/src/shared/ui/state/refetch-failed.tsx`（`Refetching`）、`globals.css` | SS-T03・SS-T04 |
| 4 | `useMe`をTanStack Query（キー`["me"]`、`staleTime: Infinity`）に載せる。ログイン・ログアウト・401で消す | `apps/web/src/features/auth/model/use-me.ts`、`use-sign-out.ts`、401を扱う所 | SS-T05。`useMe`の返す形は変えない |
| 5 | 旅行の下の10のルートに`generateStaticParams`（空の配列） | `apps/web/src/app/trips/[tripId]/**/page.tsx` | 組み立ての出力で10のルートが「静的（●）」（SS-T06） |
| 6 | 品質確認 | ― | lint・type-check・test・build・test:e2e・ハーネスの試験が通る（SS-T07） |

## 依存

1 → 2（骨組みの部品を使う）。3・4・5は独立。

## 試験

設計書の「テスト方針」のSS-T01〜SS-T08。試験はwebの`tests/`に足す。SS-T08（実機）はマージのあと、ユーザーが結合検証環境で確かめる。

## リスクとロールバック

設計書の「リスク」のとおり。問題が出たら、このPRを戻せば今の動きに戻る（データ・APIの変更は無い）。
