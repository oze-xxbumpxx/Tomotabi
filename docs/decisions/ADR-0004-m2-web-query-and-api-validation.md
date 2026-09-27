# ADR-0004: web の取得状態ライブラリと API の入力検証

- Status: Proposed（ユーザー承認待ち。2026-09-27 の確認で web のライブラリは「TanStack Query＋フォームは自前」を選択済み）
- Date: 2026-09-27
- 関連 feature: m2-trips-and-plans

## Context（背景・なぜ判断が必要か）

M2 で初めて、利用者の入力を受けて保存する画面と API ができる。詳細設計 10 §3 は「フォーム／取得状態のライブラリは M2 の 1 画面で必要性を確認して選定」「入力検証の実装ライブラリは既存 OpenAPI との対応を確認して選定」としており、M2 で決める必要がある。

web 側で必要な振る舞い（詳細設計 07 §3・§9）:

- 同じ条件の取得をまとめる、画面へ復帰したときに再取得する、再取得中・再取得失敗で前回の表示を残す、条件が変わったら前の結果を出さない、遅い古い要求の結果を捨てる。
- 保存は、送信直前に要求（キー・本文・If-Match）を固定し、結果不明なら同じ要求で確かめる。自動で再送しない。

API 側で必要なこと: 旅行・予定の body・クエリ・ヘッダーの形式検証。M0（m0-validation-result-client）で、OpenAPI を契約の正典とし、Orval で web 用の fetch client と Zod スキーマを生成する方式にした。API 側の入力検証は「M1 以降に入力が生じた際に Controller 境界で Zod を検討」と先送りしていた。

## Decision（採用した決定）

1. **web の取得状態は TanStack Query（v5）を使う。** QueryClientProvider を app の Client Component に置く。取得関数は既存の `callApi`（Orval の生成関数 + Zod 検証 + neverthrow）を包み、Query には検証済みの値だけを渡す。mutation の自動再試行は無効にする。
2. **web のフォームはライブラリを入れない。** React の状態と、契約から生成した Zod スキーマ＋Domain 相当の検証関数（文字数・日付）で作る。M2 のフォームは 5 項目以下で、送信状態は `mutation-request` と feature の model が持つため。
3. **API の入力検証は、contracts の OpenAPI から Orval で生成した Zod スキーマを Controller 境界で使う。** 生成先は `apps/api/src/generated/`（生成物。手で直さない）。Nest の Pipe で body・クエリを検証し、形式違反を 400 にする。値の規則（コードポイントの文字数、実在日、期間）は Domain の値型で検証し、422 にする。DB の CHECK を最後の防御として残す。
4. **生成物の差分は CI で確認する**（M0 と同じ `generate` → 差分なしの確認に API 側の出力を足す）。

## Alternatives（検討した別案と不採用の理由）

| 案 | 不採用の理由 |
|---|---|
| web: ライブラリなし（fetch + useEffect の自作 hook） | 重複の排除、復帰時の再取得、古い要求の破棄、再取得中の前回表示を自作する必要がある。07 §3 の表の大半がライブラリの既定の機能に当たる |
| web: SWR | 機能は近いが、mutation と invalidate の扱い、キャッシュの操作 API が TanStack Query の方が明示的。M3 の精算で「固定した確認を再取得で書き換えない」制御をしやすい |
| web: React Hook Form（フォーム） | M3 の支払いフォームで検討の余地はあるが、M2 の小さなフォームでは依存を増やす利点が小さい。必要になったら別 ADR で足す |
| API: class-validator + class-transformer（Nest 標準の例） | OpenAPI と別にデコレーターで制約を二重に書くことになり、契約とずれる。M0 で「OpenAPI を正典」とした方針に反する |
| API: 手書きの Zod スキーマ | 契約と二重管理になる。生成で足りる |
| API: nestjs-zod などの統合ライブラリ | 生成した Zod スキーマを使う Pipe は数十行で書け、依存を増やす理由が弱い |

## Consequences（影響・トレードオフ・後方互換）

- web に `@tanstack/react-query` の依存が 1 つ増える。Next.js 16 / React 19 での動作を M2-c の最初に確かめる。
- API の Zod は web と同じ版を使う（ルートの Orval の設定に API 用の出力を足す。`zod` を api の dependencies に追加）。
- Orval の Zod 出力は `format: date` を実在日まで検証しない。Domain の値型（`LocalDate`）で補う。
- 生成物が 2 か所（web・api）に出る。どちらも contracts の OpenAPI から作り、手で直さない。
- 既存の foundation・auth の web 用生成物は変わらない。

## Status（状態）

Proposed。承認後に Accepted（承認日）へ更新する。
