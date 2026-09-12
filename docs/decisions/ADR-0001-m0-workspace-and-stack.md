# ADR-0001: M0 の workspace と採用スタック

- Status: Accepted
- Date: 2026-09-11
- 関連 feature: m0-foundation

## Context（背景・なぜ判断が必要か）

アプリ未実装のリポジトリに、承認済みの Next / Nest 構成を初めて入れる。パッケージマネージャ、共有範囲、検証用モジュールの置き方を固定しないと、後続の M1 が場当たりになる。

詳細設計 08〜11 と M-1 でフレームワークは決まっている。本 ADR は「リポジトリへの入れ方」の実装判断を残す。Cookpit 由来の pnpm / 導入済み CI を、無検証のまま事実扱いしない。

## Decision（採用した決定）

- npm workspaces で `apps/web` / `apps/api` / `packages/contracts` を組む。
- Node 22.x を `.nvmrc` と `engines` と CI で指定し、lockfile で依存を固定する。
- 公開契約だけを contracts に置く。Drizzle schema・Nest domain・秘密は置かない。
- 業務未実装のため、空の trips / payments モジュールは作らない。接続確認は `foundation` モジュールに限定する。
- 単体テストランナーは Vitest。API の HTTP は Supertest。実 PostgreSQL は Testcontainers。E2E ジョブはまだ置かない。
- パッケージマネージャに pnpm を必須としない。ハーネスの `pnpm` 固定は別課題とする。

## Alternatives（検討した非採用案と却下理由）

| 案 | 却下理由 |
|---|---|
| pnpm workspaces | ディスクと phantom 依存には有利。ただしユーザーの日常（npm）と距離があり、M0 で必須ではない。後から切り替え可能 |
| 単一 Next.js に API を同居 | 詳細設計の「業務 DB は Nest 経由」に反する |
| 空の業務モジュールを先に量産 | M0 依頼が禁止。レビュー対象が増え、未完成を完成と誤認しやすい |
| 実 DB を PGlite で代替して CI 合格 | 詳細設計 09 が明示的に禁止。複数接続や Neon 相当を再現しない |
| Yarn | 追加メリットが薄く、ユーザー環境ともハーネスとも一致しない |

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: 後続が import 境界と DI の型に沿って機能を足せる。contracts の範囲が狭い。
- 悪い: npm は pnpm より依存の厳密さが弱い。境界は ESLint で補う。
- リスク: ローカル Docker が無いと api-db が未完了。foundation API を残したまま公開すると不要な書き込み口になる。

## Migration（移行が必要な場合の手順。不要なら「対象外」）

対象外（新規導入）。将来 pnpm にする場合は lockfile を作り直し、ハーネスの pnpm 前提と揃える。

## Rollback（決定を戻す場合の手順）

作業ブランチを破棄する。`main` にアプリ成果物が無ければ追加の DB / 公開手順は不要。

## References（設計書・要件・関連 ADR・外部資料へのリンク）

- docs/旅行アプリ設計 3/Cursor_M0着手依頼.md
- docs/旅行アプリ設計 3/詳細設計/08〜11
- docs/designs/m0-foundation.md
