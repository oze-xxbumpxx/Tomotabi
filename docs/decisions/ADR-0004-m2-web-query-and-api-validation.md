# ADR-0004: webの取得状態ライブラリとAPIの入力検証

- Status: Accepted（2026-09-27ユーザー承認）
- Date: 2026-09-27
- 関連feature: m2-trips-and-plans

## Context（背景・なぜ判断が必要か）

M2で初めて、利用者の入力を受けて保存する画面とAPIができる。詳細設計10 §3は「フォーム／取得状態のライブラリはM2の1画面で必要性を確認して選定」「入力検証の実装ライブラリは既存OpenAPIとの対応を確認して選定」としており、M2で決める必要がある。

web側で必要な振る舞い（詳細設計07 §3・§9）:

- 同じ条件の取得をまとめる、画面へ復帰したときに再取得する、再取得中・再取得失敗で前回の表示を残す、条件が変わったら前の結果を出さない、遅い古い要求の結果を捨てる。
- 保存は、送信直前に要求（キー・本文・If-Match）を固定し、結果不明なら同じ要求で確かめる。自動で再送しない。

API側で必要なこと: 旅行・予定のbody・クエリ・ヘッダーの形式検証。M0（m0-validation-result-client）で、OpenAPIを契約の正典とし、Orvalでweb用のfetch clientとZodスキーマを生成する方式にした。API側の入力検証は「M1以降に入力が生じた際にController境界でZodを検討」と先送りしていた。

## Decision（採用した決定）

1. **webの取得状態はTanStack Query（v5）を使う。** QueryClientProviderをappのClient Componentに置く。取得関数は既存の`callApi`（Orvalの生成関数 + Zod検証 + neverthrow）を包み、Queryには検証済みの値だけを渡す。mutationの自動再試行は無効にする。
2. **webのフォームはライブラリを入れない。** Reactの状態と、契約から生成したZodスキーマ＋Domain相当の検証関数（文字数・日付）で作る。M2のフォームは5項目以下で、送信状態は`mutation-request`とfeatureのmodelが持つため。
3. **APIの入力検証は、contractsのOpenAPIからOrvalで生成したZodスキーマをController境界で使う。** 生成先は`apps/api/src/generated/`（生成物。手で直さない）。NestのPipeでbody・クエリを検証し、形式違反を400にする。未知の項目を拒否するため`zod.strict`で生成する。Zodの`.max()`はUTF-16の長さで数えるため、入力bodyの文字列の`maxLength`は検証用の生成から外し、文字数はコードポイントで数えるDomainの値型に任せる（契約の`maxLength`は残す）。値の規則（コードポイントの文字数、実在日、期間）はDomainの値型で検証し、422にする。DBのCHECKを最後の防御として残す。
4. **生成物の差分はCIで確認する**（M0と同じ`generate` → 差分なしの確認にAPI側の出力を足す）。

## Alternatives（検討した別案と不採用の理由）

| 案 | 不採用の理由 |
|---|---|
| web: ライブラリなし（fetch + useEffectの自作hook） | 重複の排除、復帰時の再取得、古い要求の破棄、再取得中の前回表示を自作する必要がある。07 §3の表の大半がライブラリの既定の機能に当たる |
| web: SWR | 機能は近いが、mutationとinvalidateの扱い、キャッシュの操作APIがTanStack Queryの方が明示的。M3の精算で「固定した確認を再取得で書き換えない」制御をしやすい |
| web: React Hook Form（フォーム） | M3の支払いフォームで検討の余地はあるが、M2の小さなフォームでは依存を増やす利点が小さい。必要になったら別ADRで足す |
| API: class-validator + class-transformer（Nest標準の例） | OpenAPIと別にデコレーターで制約を二重に書くことになり、契約とずれる。M0で「OpenAPIを正典」とした方針に反する |
| API: 手書きのZodスキーマ | 契約と二重管理になる。生成で足りる |
| API: nestjs-zodなどの統合ライブラリ | 生成したZodスキーマを使うPipeは数十行で書け、依存を増やす理由が弱い |

## Consequences（影響・トレードオフ・後方互換）

- webに`@tanstack/react-query`の依存が1つ増える。Next.js 16 / React 19での動作をM2-cの最初に確かめる。
- APIのZodはwebと同じ版を使う（ルートのOrvalの設定にAPI用の出力を足す。`zod`をapiのdependenciesに追加）。
- OrvalのZod出力は`format: date`を実在日まで検証しない。Domainの値型（`LocalDate`）で補う。
- 生成物が2か所（web・api）に出る。どちらもcontractsのOpenAPIから作り、手で直さない。
- 既存のfoundation・authのweb用生成物は変わらない。

## Status（状態）

Accepted（2026-09-27）。
