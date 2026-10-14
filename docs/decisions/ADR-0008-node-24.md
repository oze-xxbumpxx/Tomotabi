# ADR-0008: Node.jsを24.xにする

- Status: Accepted（2026-10-15のチャットでユーザーが選んだ）
- Date: 2026-10-15
- 関連feature: integration-env
- 置き換えるもの: ADR-0001の「Node 22.xを`.nvmrc`と`engines`とCIで指定する」

## Context（背景・なぜ判断が必要か）

結合検証環境で、APIをVercelに出したところ、最初の要求で関数が落ちた。ログは`ERR_REQUIRE_ESM`で、`better-auth`（ESMだけで配られている）を`require()`で読めなかった。

APIはCommonJSで組み立てている。Node 22.12からは`require()`でESMを読めるので、手元とCIでは動いていた。VercelのNode 22の実行環境では、この読み込みが使えない。手元で`node --no-experimental-require-module`を付けて組み立て済みのAPIを読むと、同じエラーが出ることを確かめた。

## Decision（採用した決定）

- Node.jsを24.xにする。`.nvmrc`・`.node-version`・ルートの`package.json`の`engines`（`>=24.0.0 <25`）・GitHub Actionsの`setup-node`・Devinのblueprintをそろえる。
- APIはCommonJSのまま変えない。Node 24では`require()`でESMを読むのが標準になっている。
- `@types/node`は今回は22のまま残す。型の差で困ったときに上げる。

VercelのNode 24の実行環境で、この読み込みが使えるかは資料からは分からない。最初のデプロイ（結合検証環境のIE-01）で確かめる。使えなかったときは、下の非採用案のどちらかに戻って決め直す。

## Alternatives（検討した非採用案と却下理由）

| 案 | 選ばなかった理由 |
| --- | --- |
| `better-auth`を使う3つのファイルだけ、起動時に`import()`で読む | 変更は小さい。ユーザーはNodeの版を上げる案を選んだ（理由は聞いていない） |
| `apps/api`をまるごとESMにする | 相対の`import`約1,550か所（325ファイル）に`.js`を付ける大きな変更になり、ほかの作業とぶつかりやすい |

## Consequences（影響）

- 手元で動かす人は、Node 24を使う。`fnm`や`nvm`は`.node-version`・`.nvmrc`で切り替わる。
- Node 24に付いてくるnpm 11は、依存のインストールのスクリプトを、許可したものだけ動かす。lint・型・試験・ビルド・ハーネスの試験はNode 24.22.0で通ることを確かめた。CIでも同じかは、このPRのCIで確かめる。
- VercelのプロジェクトのNode.jsの版は、`engines`から24.xが選ばれる。プロジェクトの設定も24.xにそろえる（手順書3章）。
