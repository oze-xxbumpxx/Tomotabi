# VercelとAWSの運用費比較

> 2026-09-09：現行のデプロイ・無料枠の確認値・停止／復元手順は「詳細設計/08_デプロイと無料枠運用.md」を参照。本書のAWS料金は当時の比較で、今回再計算していない。

> 2026-09-07更新：採用状況は「Cursor引き継ぎ.md」第4節と「設計方針の合意事項.md」の最新決定を優先する。本書に残る「提案」「未合意」は作成時点の表記を含む。採用対象外の案まで合意済みとは扱わない。

確認日：2026-09-05。本番はVercel Hobby + Neon Free、月額0円の運用を採用済み。デプロイやアカウント作成は未実施。

## 結論

運用費を月額0円に抑えるという希望に合わせ、本番はVercel Hobby + Neon Freeを採用する。React、TypeScript、NestJS、PostgreSQL、REST + OpenAPIという技術案は維持できる。無料枠内であれば月額0円を目指せるが、実際の利用量を測定する前に無料運用を保証するものではない。

AWSの学習を希望する場合は、後の段階でTerraformによる短期間の検証環境を作り、デプロイ・監視・復旧・削除まで経験する方法を提案する。これは未承認の追加学習案であり、本番の常時稼働や検証環境の作成を今回実行するものではない。Vercel運用だけでAWSの運用経験を得たとは扱わない。

## 比較条件

- 二人利用、低アクセス、予定や支払い等の少量のデータを想定。
- 写真・動画の大量保存と配信、有料の監視、独自ドメイン代、税金は含めない。
- 円表示は比較用に1ドル150円と仮定。現在の為替レートを意味しない。
- AWSは東京リージョン、月730時間、通常のオンデマンド料金を想定。期間限定の無料枠・初回クレジット・割引契約は含めない。
- Vercel・Neonは無料プランの継続提供と、その利用枠内に収まることを前提とする。

| 構成例 | 月額目安 | 代償 |
|---|---|---|
| Vercel Hobby + Neon Free | 無料枠内なら0円 | 利用量・DB容量の上限、休止後の待ち時間、実行環境の制約 |
| AWS Lightsail 2GBにアプリとPostgreSQLを同居 | 約1,800〜2,500円 | OS・DBの更新、バックアップ、復旧を自分で運用。サーバー障害で両方停止 |
| AWS Fargate 1タスク + ALB + RDS Single-AZ | 約10,000〜15,000円を予算目安 | 常時稼働の基本料金。NAT Gateway・冗長化等は追加 |

これらは3つの構成例の比較であり、AWSの全構成の最低価格・最高価格ではない。Lambda中心の構成や外部DBとの併用などで別の料金設計も可能。

## Vercelで成立する構成

- フロント：フレームワーク学習の希望を受け、Next.js（App Router）+ React + TypeScriptへ候補を変更。静的配信に加えてサーバー側描画を使う場合は、その利用量もVercel無料枠内に収める設計とする。
- バックエンド：NestJSをVercel Functionsとして動かす。VercelはNestJSのデプロイを公式にサポートし、1つのFunctionとして扱う。[Vercel公式](https://vercel.com/docs/frameworks/backend/nestjs)
- DB：NeonのPostgreSQL。無料枠の掲載値は1プロジェクト0.5GB、月100 CU-hours。非稼働時に停止する仕組みと接続プールを持つ。[Neon料金](https://neon.com/pricing)
- 認証：既存のGoogleログイン方針を維持し、アプリ側で二人のアカウントに限定する。
- 通知：Web Pushの方針を維持し、DBへのコミット後に送信する。
- Dockerはローカル開発・テスト環境の再現等に利用できるが、Vercelへの本番デプロイがDockerコンテナの常時稼働になるわけではない。
- GitHub Actionsは自動テストに使い、VercelのGit連携によるデプロイとの役割分担を詳細設計で定める。

Vercel Hobbyは月額0ドルで、個人の非商用利用向け。今回の二人向け・非商用の個人利用を前提に候補とする。Proへ移行する場合は基本月額20ドルからで、利用により追加料金がある。[Vercel料金](https://vercel.com/pricing)、[Hobby](https://vercel.com/docs/plans/hobby)

### 詳細設計で反映する実行環境の条件

- セッションや通知の購読先など、保持が必要な状態は外部の永続化先に置く。
- DB接続数とプールを管理する。バックエンドとDBのリージョンの組み合わせも確認する。
- 通知送信は、コミット後に制限時間内で完了を待つか、Vercelが提供するwaitUntil等を使って実行寿命を確保する。HTTP応答後も常にプロセスが生き続ける前提を置かない。waitUntilもFunctionのタイムアウトに従うため、到達保証にはならない。[Vercel Functions API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- 通知失敗を保存済みの業務操作の失敗として扱わない。既存の通知欠落を許容する方針は維持する。
- 永続化の制約とトランザクションで二重精算を防ぐ。プロセス内のロックのみでは複数の実行環境をまたぐ制御はできない。
- 無料枠の上限に達した場合や、DBの休止・復帰時の動作を確認する。DBのバックアップ・復元方法を定める。

## AWS Lightsailの根拠

Linux / Unix、パブリックIPv4付き2GBプランは月12ドル。1GBは7ドルだが、今回はNode.jsとPostgreSQLを同居させる試算のため2GBを例とする。実負荷で必要メモリを検証する。2GBプランのディスクは60GB。[Lightsail公式料金](https://aws.amazon.com/lightsail/pricing/)

スナップショットは保存量に対して月0.05ドル/GB。仮に課金対象60GBなら3ドルなので、12 + 3 = 15ドル、仮換算2,250円。保持履歴・変更量によって増減する。同じサーバーへのDB同居は、RDSのような管理サービスとは運用責任が異なる。

## AWS Fargate + ALB + RDSの積み上げ

最小規模の概算例であり、高可用性を保証する構成ではない。FargateはLinux/x86、0.25vCPU・0.5GBを1タスク。RDSはdb.t4g.micro、Single-AZ、PostgreSQL、gp3 20GB。ALBはインターネット向け1台。NATなしでFargateにIPv4を付与し、ALBのIPv4を2つ、合計3個と仮定。RDSは非公開とする。

| 項目 | 単価と数量 | 月額USD | 仮換算JPY |
|---|---|---:|---:|
| Fargate | (0.25 × $0.05056 + 0.5 × $0.00553) × 730時間 | 11.25 | 1,687円 |
| RDS本体 + ストレージ | $0.025 × 730時間 + $0.138 × 20GB | 21.01 | 3,152円 |
| ALB基本料金 | $0.0243 × 730時間 | 17.74 | 2,661円 |
| IPv4 | $0.005 × 730時間 × 3個 | 10.95 | 1,642円 |
| 基本部分の小計 | | 60.94 | 9,142円 |

これにALBの処理量（LCU）、フロントの静的配信、コンテナイメージ保存、ログ、DNS等が加わるため、少量利用では月10,000〜15,000円を予算の目安とする。料金の上限保証ではない。CPUクレジットの超過、バックアップ容量、転送量等による追加料金もあり得る。NAT Gateway、複数タスク、Multi-AZ DB等を加える場合は再試算が必要。

根拠となる東京リージョンのAWS公式価格データを取得して計算した。ECS・ELBのpublicationDateは2026-08-31、RDSは2026-09-04。

- [Fargate料金](https://aws.amazon.com/fargate/pricing/) / [東京の公式価格データ](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json)
- [RDS PostgreSQL料金](https://aws.amazon.com/rds/postgresql/pricing/) / [東京の公式価格データ](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json)
- [ALB料金](https://aws.amazon.com/elasticloadbalancing/pricing/) / [東京の公式価格データ](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-northeast-1/index.json)
- [IPv4料金](https://aws.amazon.com/vpc/pricing/)

## 設計方針への影響

本番配置はVercel Hobby + Neon Freeに確定した。無料URLを利用し、有料プラン・アドオンは導入しない。AWS / Terraformを本番必須にする提案は取り下げ、AWS学習は別の段階で必要性を判断する。ホスティングの変更だけで業務の文脈、精算ルール、REST API、二人限定の認可を変更しない。
