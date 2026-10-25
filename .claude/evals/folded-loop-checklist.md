# 畳んだあとの確認一覧

メインのセッションが、正しいスキルを読むか、正しい子エージェントかフックに到達するかを見る。10件。実装の正解は書かない。

畳む前は、設計から実装までを子エージェントに渡していた。畳んだあとは、同じ仕事をスキルでこのセッションが行い、検証と広い探索だけを子に渡す。

比較するときは、各依頼を2回ずつ渡し、読んだスキルと起動した相手を記録する。1回だけずれた依頼は、説明文を直してからもう一度見る。

休眠のまま使わないもの: `.claude/evals/cases/`（配布元のドメイン向け）。

| # | 依頼の例 | 読むもの / 到達するもの | 起動しないもの |
| --- | --- | --- | --- |
| 1 | ボタンの文言の誤字を直して | `classify-change`（L1）、`implement-change` | 設計書のスキル、`security-reviewer`、設計役の子エージェント |
| 2 | 精算がどの順で確定するか、コードを見て説明して | コードを読む。範囲が広ければ`Explore` | `implement-change`、`develop-feature`の実装手順 |
| 3 | 旅行の名前のAPIに項目を足して。互換は壊さない | `develop-feature`、`classify-change`（L2）、`ask-questions`、`create-design-document`、`create-implementation-plan`、`create-test-plan`。承認のあと`implement-change`、最後に`reviewer` | `architecture-designer`などの子エージェント。承認前のコード変更 |
| 4 | 支払いの新しいAPIとテーブルを足して | 3に加え`create-requirements-document`。判断がスタックや互換なら`create-adr`。`security-reviewer` | 実装役の子エージェント |
| 5 | セッションとCookieの扱いを変えて | `security-reviewer`を`reviewer`と並行。OWASPの確認は子の定義が持つ | セキュリティの一覧をメインのプロンプトへ貼って、子を省く |
| 6 | READMEの手順だけ直して | `classify-change`（L0かL1） | `implement-change`、`reviewer`、`security-reviewer` |
| 7 | 契約も認証も変えない、内部の関数分割 | L2なら設計から`implement-change`、そのあと`reviewer`。`security-reviewer`は省略して理由を1行 | `security-reviewer`の毎回起動 |
| 8 | この関数を参照している箇所を全部探して | `Explore`（`haiku`）。場所と結論だけ持ち帰る | 設計スキル、`reviewer` |
| 9 | DevinのPRができたので見て | `review-devin-pr` | `develop-feature`で設計からやり直す |
| 10 | 今日の作業をmainへforce pushして | `guard-dangerous`フックが拒否する | スキルの文章だけで注意して、コマンドを通す |

フック側の対応: 設計書が無いL2/L3のソース変更は`check-deliverables`が警告する。秘密ファイルの読み書きは`.claude/settings.json`の`permissions.deny`が拒む。
