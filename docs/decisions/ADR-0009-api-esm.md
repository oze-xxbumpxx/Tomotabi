# ADR-0009: APIをESM（Node.jsの新しい形のモジュール）にする

- Status: Accepted（2026-10-15のチャットでユーザーが選んだ）
- Date: 2026-10-15
- 関連feature: integration-env
- 置き換えるもの: ADR-0008の「APIはCommonJSのまま変えない」

## Context（背景・なぜ判断が必要か）

結合検証環境のAPIが、Vercelで最初の要求のたびに`ERR_REQUIRE_ESM`で落ちた。APIはCommonJS（古い形）で組み立てていて、ESMだけで配られている`better-auth`を`require()`で読んでいた。手元とCIのNodeは`require()`でESMを読めるが、Vercelの実行環境では読めない。

ADR-0008でNodeを22から24に上げたが、直らなかった。Vercelの組み立てを手元で再現すると、関数は`nodejs24.x`で作られていた。それでも落ちたので、VercelはNodeの版に関わらず、この読み込みを使えないと判断した（推測。Vercelの資料には書かれていない）。手元で`node --no-experimental-require-module`を付けると、同じエラーが出ることは確かめてある。

## Decision（採用した決定）

- `apps/api`をESMにする。`package.json`に`"type": "module"`、`tsconfig.json`の`module`と`moduleResolution`を`nodenext`にする。
- 相対importに`.js`を付ける（`src`の226ファイル、1,090か所。フォルダは`/index.js`）。付け忘れは`npm run type-check`で止まる。
- `packages/contracts`はCommonJSのまま変えない。ESMから名前付きで読めることを、起動と試験で確かめた。
- Node 24は、そのまま使う（ADR-0008）。

## Alternatives（検討した非採用案と却下理由）

| 案 | 選ばなかった理由 |
| --- | --- |
| `better-auth`を使う3つのファイルだけ、`import()`で後から読む | 変更は小さい。ユーザーはESM化を選んだ（理由は聞いていない） |
| Node 22に戻す | Nodeの版は原因ではなかったので、戻しても直らない |

## Consequences（影響）

- 新しく書く相対importは`.js`を付ける。付け忘れはtype-checkで見つかる（`.claude/rules/coding-standards.md`に書いた）。
- ESMだけで配られる部品が、これから増えても読める。
- 確かめたこと（Node 24.22.0）: lint・型・単体試験（603件）・実DBの試験（315件）・E2E（16件）・ビルド・`db:check`・`api:check`がすべて通る。ビルドしたAPIは、`--no-experimental-require-module`を付けたNodeでも起動し、`/api/health`が200を返す。Vercelの組み立てを手元で再現して出来た関数も、同じ条件で起動して200を返す。
- Vercelの本物の実行環境では、デプロイして確かめる（結合検証環境のIE-01）。
