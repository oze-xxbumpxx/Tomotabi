# 実装計画: dependency-audit（依存パッケージの脆弱性を直った版に上げる）

- 関連: #258（テスト・開発用パッケージの脆弱性）
- レベル: L1（版を上げるだけで、アプリの動きは変えない）

## この計画で直すもの

#258の表の大半（vitest・vite・testcontainersほか）は、#260で直った版に上がっている。2026-10-26に`npm audit --package-lock-only`をやり直すと、次の15件が残っていた。本番のAPIが使うパッケージのHighが含まれるので、#258の残りと合わせて1つのタスクにする。

| 深刻度   | パッケージ                                                | 入っている所                                     | 直し方                                                                                                                         |
| -------- | --------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| High     | multer 2.4.0                                              | `@nestjs/platform-express`（本番のAPI）          | Nestは12系でも2.4.0に固定しているので、`overrides`で2.5.0以上にする                                                            |
| High     | body-parser 2.3.0                                         | `express`（本番のAPI）                           | `^2.3.0`の範囲なので、更新で2.4.0にする                                                                                        |
| High     | zod 4.1.11 / 4.6.5                                        | `@vercel/cli-config`経由と、api・webの直接の依存 | 4.6.6以上にする。直接の依存は範囲の下限も上げる                                                                                |
| High     | `@vercel/functions`・`@vercel/oidc`・`@vercel/cli-config` | 本番のAPI                                        | 中のzodが直れば消えるかを確かめる。消えなければ`@vercel/functions`を最新に上げる                                               |
| High     | undici 7.29.1                                             | `orval`の中の`@scalar/json-magic`（開発用）      | 今の`overrides`の`undici: ^7.29.1`を直った版（7.30.1以上）にする。`orval`を上げて要らなくなれば外す                            |
| Moderate | orval・`@scalar/json-magic`・`@scalar/openapi-parser`     | 開発用                                           | `orval`を最新の8系に上げる                                                                                                     |
| Moderate | drizzle-kit・esbuild・`@esbuild-kit/*`                    | 開発用（マイグレーション）                       | 直せない。drizzle-kitは最新の0.31.11でも`@esbuild-kit/esm-loader`を使っている。`npm audit fix --force`が出す0.18.1へは下げない |

## この計画で直さないもの

- drizzle-kitの古いesbuild。直った版が出たら別に上げる。#258を閉じるときに、この1件だけ残ることを書く。
- Nestの12系への移行（メジャーの更新で、multerはこれでも直らない）。

## タスク

<!-- delegation-task:audit-fix -->

## 目的

`npm audit --package-lock-only`に出る依存パッケージの脆弱性を、直った版に上げて消す（#258の残りと、本番のAPIが使うパッケージのHigh）。L1、ユーザー承認: 不要。アプリの動きは変えない。

## 読む資料

- `docs/implementation-plans/dependency-audit.md`の表（どのパッケージをどう直すか）
- ルートの`package.json`の`overrides`
- `apps/api/package.json`と`apps/web/package.json`

## やること

- [ ] ルートの`package.json`の`overrides`に`multer`を`^2.5.0`で足す（`@nestjs/platform-express`が2.4.0に固定しているため）。
- [ ] `apps/api`と`apps/web`の`zod`の範囲を`^4.6.6`以上にする。
- [ ] `orval`を最新の8系に上げる。`overrides`の`@scalar/json-magic`の`undici`は、直った版（7.30.1以上）にする。`orval`を上げて古い`@scalar/json-magic`が入らなくなったら、この行は外す。
- [ ] `npm update`で、範囲の中で上げられるもの（body-parserほか）を上げる。
- [ ] `npm audit --package-lock-only`をやり直し、残るのがdrizzle-kit・esbuild・`@esbuild-kit/*`だけになったことを確かめる。`@vercel/*`が残ったら`@vercel/functions`を最新に上げる。
- [ ] PRの説明に、上げる前と後の`npm audit`の件数（深刻度ごと）と、残ったものとその理由を書く。

## テスト

- [ ] `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る。
- [ ] `npm run test:e2e`が通る。
- [ ] `orval`を上げたら`npm run api:check`を流し、生成物に差分が出ないことを確かめる。差分が出たら、生成し直したものをコミットし、型と試験が通ることを確かめる。

## やらないこと

- drizzle-kitを0.18.1に下げない（`npm audit fix --force`は使わない）。
- `@nestjs/*`をメジャーの版（12系）に上げない。
- アプリのコードを変えない。版を上げて型や試験が通らないときは、直さずにPRの説明に書いて止める。

## 完了条件

- `npm audit --package-lock-only`に出るのが、drizzle-kit・esbuild・`@esbuild-kit/*`だけになっている。
- 上の4つの品質コマンドとE2Eが通る。
- PRの本文に`Closes #258`がある。

<!-- /delegation-task -->
