# 試験計画: 結合検証環境（integration-env）

- 変更レベル: L3
- 要件: [docs/requirements/integration-env.md](../requirements/integration-env.md)
- 設計: [docs/designs/integration-env.md](../designs/integration-env.md)
- 作成日: 2026-10-12

## 観点の番号

| 接頭辞 | 範囲 |
| --- | --- |
| IU | 単体（Vercelで差し替える部品、`Server-Timing`） |
| IH | HTTP（全部の`/api`の応答のヘッダー） |
| ID | 実DB（DBの時間の測り方） |
| IW | デプロイのワークフローの形 |
| IE | 検証用の環境で確かめること（要件のOPS・PM-03・PERF-01に対応） |

## 単体

| ID | 観点 | 種類 |
| --- | --- | --- |
| IU-01 | `VercelAfterResponse.schedule`は仕事を`waitUntil`に渡し、すぐに戻る（応答を待たせない）。`drain`は渡した仕事が全部終わるまで待つ | 正常 |
| IU-02 | 仕事が例外・拒否になっても、`schedule`の呼び出し側には伝わらず、ログには例外の型名だけが出る（messageは出ない） | 異常・セキュリティ |
| IU-03 | `VERCEL=1`のときだけ`AFTER_RESPONSE`が`VercelAfterResponse`になり、それ以外は`InProcessAfterResponse`のまま | 境界 |
| IU-04 | `Server-Timing`は`app;dur=<数>`・`db;dur=<数>`・`cold;desc="true|false"`の形で、最初の要求だけ`cold`が`true`。数値と真偽以外を含まない | 正常・セキュリティ |
| IU-05 | Vercelのときだけ`attachDatabasePool`が1回だけ呼ばれる。手元・CIでは呼ばれない | 境界 |

## HTTP

| ID | 観点 | 種類 |
| --- | --- | --- |
| IH-01 | 業務のAPIの応答に、`Cache-Control: private, no-store`・`CDN-Cache-Control: no-store`・`Vercel-CDN-Cache-Control: no-store`が付く | 正常 |
| IH-02 | 認証の経路（`/api/auth/*`）、経路の制限の404・403・503、エラーの応答にも、同じ3つが付く | 境界 |
| IH-03 | 全部の`/api`の応答に`Server-Timing`が付き、本文と状態のコードは今と変わらない（既存のHTTPの試験がそのまま通る） | 回帰 |

## 実DB

| ID | 観点 | 種類 |
| --- | --- | --- |
| ID-01 | DBに問い合わせる要求では`db;dur`が0より大きく、問い合わせない要求（`/api/health`など）では0 | 正常・境界 |

## デプロイのワークフロー

| ID | 観点 | 種類 |
| --- | --- | --- |
| IW-01 | きっかけは`workflow_dispatch`だけで、`environment: integration`を使う。`push`や`pull_request`では動かない | セキュリティ |
| IW-02 | 出す前に、指定のcommitの`ci.yml`が成功しているかを確かめ、成功していなければ止める | 異常 |
| IW-03 | `vercel build`のあと`--prebuilt`で出し、apiを出してからwebを出す。トークンは`--token`で渡し、`set -x`を使わない | 正常・セキュリティ |

## 検証用の環境で確かめること

手順は`docs/runbooks/integration-env.md`。確かめた日・環境（デプロイしたcommit）・結果を、下の記録の表に書く。

| ID | 要件の観点 | 確かめること |
| --- | --- | --- |
| IE-01 | R-02 | 最初のデプロイで、APIがVercelの設定なしの対応で動き、`/api/health`が200を返す。関数の実行場所がsin1 |
| IE-02 | OPS-03 | 画面の`/api`が抜けたり二重になったりせず、APIに届く。転送先を要求から変えられない |
| IE-03 | OPS-04 | ログインとログアウトで、複数の`Set-Cookie`が保たれ、ログアウトでCookieが消える。`If-Match`・`Idempotency-Key`・本文が転送で保たれる（予定の編集と支払いの記録） |
| IE-04 | OPS-05 | 二人でそれぞれ同じ画面を開き、一人の結果がもう一人に見えない。`/api`の応答のヘッダーに、キャッシュを止める3つがある |
| IE-05 | OPS-06 | 二人が普段のGoogleアカウントでログインできる。登録していないGoogleアカウントは断られる。APIのURLへの直接の要求と、別の旅行への要求も断られる。公開URLでVercelのログインを求められない |
| IE-06 | OPS-07 | APIがNeonのpooledの接続で動き、TLSの検証が有効。管理用の接続（direct）はVercelに置いていない |
| IE-07 | OPS-08 | 5分以上使わずNeonを休ませたあと、最初の操作が待ったうえで成功する。使わない接続が手放される（Neonの接続の数で見る） |
| IE-08 | OPS-09 | 二人の端末で、同じ精算をほぼ同時に完了・取り消しし、二重にならない |
| IE-09 | OPS-10 | 実行用のロールで、履歴の表への更新・削除とDDLが断られる（Neonの管理画面のSQLで、実行用のロールとして試す） |
| IE-10 | OPS-11 | 保存のあとに通知が届く。Vercelの関数のログに、送る処理の1行（結果の種類）が出る。`waitUntil`の仕事が応答のあとに動いている |
| IE-11 | PM-03 | iPhone（ホーム画面に追加したアプリ）とAndroid（Chrome）の両方で、相手の予定・支払い・精算の通知が届き、押すと対象が開く |
| IE-12 | OPS-17 | 主な使い方の流れ（旅行を作る、予定、支払い、精算）、ほかのアプリから戻ったときの表示、結果が分からない操作のやり直し |
| IE-13 | PERF-01 | 日本の実機から、ホームを開く・予定を足す・支払いを記録するの応答の時間を、休止のあと最初の1回と続けての3回で測る。ブラウザの開発者ツールの全体の時間と`Server-Timing`から、距離・Neonの休止・関数の起動に分けて書く |
| IE-14 | OPS-18 | 確かめたあと、VercelとNeonの管理画面で、CPU・メモリ・関数の呼び出し・DBの容量・CU時間・転送量を読む |
| IE-15 | R-09 | Actionsのデプロイが、承認なしでは動かず、main以外のブランチからは動かない。CIが失敗したcommitは出せない |

## 記録

| ID | 確かめた日 | デプロイしたcommit | 結果 |
| --- | --- | --- | --- |
| IE-01 | まだ | まだ | まだ |
| IE-02 | まだ | まだ | まだ |
| IE-03 | まだ | まだ | まだ |
| IE-04 | まだ | まだ | まだ |
| IE-05 | まだ | まだ | まだ |
| IE-06 | まだ | まだ | まだ |
| IE-07 | まだ | まだ | まだ |
| IE-08 | まだ | まだ | まだ |
| IE-09 | まだ | まだ | まだ |
| IE-10 | まだ | まだ | まだ |
| IE-11 | まだ | まだ | まだ |
| IE-12 | まだ | まだ | まだ |
| IE-13 | まだ | まだ | まだ |
| IE-14 | まだ | まだ | まだ |
| IE-15 | まだ | まだ | まだ |

## 完了条件

- IU・IH・ID・IWがすべて通り、品質ゲート（lint・type-check・test・build・E2E）が通る。
- IE-01〜IE-15を確かめ、記録の表に日付・commit・結果がある。見つかった問題は直したか、公開準備までに直すものとして記録してある。
- IE-13の結果から、本番の地域を決める材料がそろっている。
