# ADR-0001: M0のworkspaceと採用スタック

- Status: Accepted
- Date: 2026-09-11
- 関連feature: m0-foundation

## Context（背景・なぜ判断が必要か）

アプリ未実装のリポジトリに、承認済みのNext / Nest構成を初めて入れる。パッケージマネージャ、共有範囲、検証用モジュールの置き方を固定しないと、後続のM1が場当たりになる。

詳細設計08〜11とM-1でフレームワークは決まっている。本ADRは「リポジトリへの入れ方」の実装判断を残す。Cookpit由来のpnpm / 導入済みCIを、無検証のまま事実扱いしない。

## Decision（採用した決定）

- npm workspacesで`apps/web` / `apps/api` / `packages/contracts`を組む。
- Node 22.xを`.nvmrc`と`engines`とCIで指定し、lockfileで依存を固定する。
- 公開契約だけをcontractsに置く。Drizzle schema・Nest domain・秘密は置かない。
- 業務未実装のため、空のtrips / paymentsモジュールは作らない。接続確認は`foundation`モジュールに限定する。
- 単体テストランナーはVitest。APIのHTTPはSupertest。実PostgreSQLはTestcontainers。E2Eジョブはまだ置かない。
- パッケージマネージャにpnpmを必須としない。ハーネスの`pnpm`固定は別課題とする。

## Alternatives（検討した非採用案と却下理由）

| 案 | 却下理由 |
|---|---|
| pnpm workspaces | ディスクとphantom依存には有利。ただしユーザーの日常（npm）と距離があり、M0で必須ではない。後から切り替え可能 |
| 単一Next.jsにAPIを同居 | 詳細設計の「業務DBはNest経由」に反する |
| 空の業務モジュールを先に量産 | M0依頼が禁止。レビュー対象が増え、未完成を完成と誤認しやすい |
| 実DBをPGliteで代替してCI合格 | 詳細設計09が明示的に禁止。複数接続やNeon相当を再現しない |
| Yarn | 追加メリットが薄く、ユーザー環境ともハーネスとも一致しない |

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: 後続がimport境界とDIの型に沿って機能を足せる。contractsの範囲が狭い。
- 悪い: npmはpnpmより依存の厳密さが弱い。境界はESLintで補う。
- リスク: ローカルDockerが無いとapi-dbが未完了。foundation APIを残したまま公開すると不要な書き込み口になる。

## Migration（移行が必要な場合の手順。不要なら「対象外」）

対象外（新規導入）。将来pnpmにする場合はlockfileを作り直し、ハーネスのpnpm前提と揃える。

## Rollback（決定を戻す場合の手順）

作業ブランチを破棄する。`main`にアプリ成果物が無ければ追加のDB / 公開手順は不要。

## References（設計書・要件・関連ADR・外部資料へのリンク）

- docs/旅行アプリ設計3/Cursor_M0着手依頼.md
- docs/旅行アプリ設計3/詳細設計/08〜11
- docs/designs/m0-foundation.md
