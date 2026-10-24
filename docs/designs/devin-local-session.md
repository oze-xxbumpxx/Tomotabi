# 設計書: devin-local-session（手元のDevinのセッションを、起動ごとの書き出しのIDで確定する）

- ステータス: draft
- レベル: L2
- 関連: 論点の記録 `docs/discussions/devin-local-session.md`、元の設計 `docs/designs/delegation-review-reliability.md`、移し替え `docs/designs/delegation-journal-rollover.md`

## この設計を一言で

手元でDevinを起動するたびに、非公開の書き出し先を`--export`で指定し、起動したプロセスが書いたファイルからセッションのIDを読んで起動を確定する。URLは無くてよい。書き出しにIDが入るかは、害の無い依頼で手元のDevinを1回起動して確かめ、入っていなければ、専用クローンをロックして一覧を読み比べる方法に切り替える。クラウドの起動は、確かめるまで新しい設定で止めておく。

```mermaid
flowchart LR
  subgraph 今
    a1["起動"] --> b1["IDもURLも受け取らない"] --> c1["必ず launch_unknown"]
  end
  subgraph 変更後
    s2["起動（--export 非公開ファイル）"] --> l2["書き出しからIDを読む<br/>2秒おき・最大60秒"]
    l2 --> x2{"一覧にもそのIDがあるか"}
    x2 -->|"ある"| r2["running（URLは空）"]
    x2 -->|"無い・読めない"| u2["launch_unknown<br/>自動で再起動しない"]
  end
```

## 背景

2026-10-24に、手元のDevin CLI（3000.11.3）を読み取りで調べた。手元の`devin list --format json`は、セッションごとに`id`・`short_id`・`working_directory`・`last_activity_at`・`title`を返し、URLを持たない。ところが起動ラッパー（`delegation-launch.mjs`）は起動のあとIDとURLを受け取らず、共有状態の決まり（`delegation-shared.mjs`の`started`、`delegation-control.mjs`の`session_verified`）はIDに加えて`app.devin.ai`のURLを求める。このため、手元の起動は必ず`launch_unknown`で終わり、`cli_launch_verified`を外せない。

最初の案は、起動の前後の一覧を読み比べて新しいIDを取るものだった。PR #270のレビュー（DevinとCodex）で、同じ専用クローンで別のセッションが先に一覧に出ると、そのIDで確定してしまうと指摘された。一覧には、どの起動から生じたセッションかが無いためである。そこで、起動したプロセスが書くファイル（`--export`）からIDを読む方法に決め直した（論点の記録「手元のセッションのIDを、起動したプロセスとどう結び付けるか」）。

## 目的

- 手元の起動で、起動したプロセスのセッションのIDを取り違えずに確かめ、`running`にできる。
- 確かめられないときは、今どおり`launch_unknown`にして自動で再起動しない。
- 確かめていないクラウドの起動は止めたまま、手元の委譲を始められる。

## 要件

- 起動のたびに、非公開の書き出し先（状態の置き場の`devin-logs/export-<activation_id>`、0600）を`--export`で指定する。
- 起動のあと2秒おきに書き出しを読み、セッションのIDが読めたら止める。最大60秒待つ（論点の記録「起動のあと、一覧を何秒まで待つか」。確かめの起動で測った秒数で見直す）。
- 読めたIDは、専用クローンで`devin list --format json`を読み、同じIDのセッションが`working_directory`＝専用クローンの実パスで載っているときだけ確定する。
- 書き出しが無い・読めない・IDが形に合わない・一覧に載っていないときは、IDを空にする。起動し直さない。
- 書き出しのどこにIDが入っているかは、確かめの起動で確かめてから実装に書く。推測で読まない。
- 確かめの起動で書き出しにIDが入っていなければ、「切り替え先」の方法にする（下の節）。
- 手元のセッションの「始まった」（`started`）は、`session_url`を空（`null`）で送る。共有状態は、タスクの`runner`が`local`のとき、形の合うIDだけで`running`にする。`cloud`のときは今どおりURLを必須にする。
- クラウドの起動は、新しい設定`cloud_launch_verified: false`で止める（論点の記録「クラウドの起動を、どう止めておくか」）。
- `cli_launch_verified`と`migration_complete`は、確かめの起動と実装のあと、同じ設定のPRで外す（論点の記録「移行の完了を、いつ外すか」）。

## 対象範囲

- `.claude/scripts/delegation-launch.mjs`（書き出しの指定と読み取り、一覧での照合、クラウドの止め方）
- `.claude/scripts/delegation-shared.mjs`（`started`の決まり）
- `.claude/scripts/delegation-control.mjs`（`session_verified`）
- `.claude/config/delegation-review.json`（`cloud_launch_verified`を足す。2つの設定を外すのは別のPR）
- `.claude/tests/delegation-launch.test.mjs`・`.claude/tests/delegation-control.test.mjs`
- `.claude/skills/review-devin-pr/SKILL.md`・`docs/devin-setup.md`（確かめの起動の例外、手元のセッションのURLが空であること、書き出しの置き場）

## 対象外

- クラウドの起動の確かめ（内部の再送とURLの形）。クラウドは止めたまま残す。
- 起動の出力（ログ）からIDを読み取ること（論点の記録でBを選ばなかった）。
- 監視の画面（`devin-watch`）。セッションのIDが分かるようになっても、今の見え方は変えない。
- 委譲の流れの他の部分（register・claim・begin・link-pr・finalize）。

## 現状構成

`spawnDevin`は`devin`を切り離して起動し、起動できた時点で`{ session_id: null, session_url: null }`を返す。`launchDelegation`は、IDとURLがそろい、URLの末尾がIDと同じときだけ`started`にIDとURLを入れる。共有状態は、IDとURLとcontrollerの`session_verified`がそろったときだけ`running`にする。

## 変更後構成

### 起動ラッパー

```mermaid
sequenceDiagram
  participant L as delegation-launch
  participant D as devin（専用クローン）
  participant F as 書き出し（非公開）
  participant S as 共有状態
  L->>S: begin（今どおり1回だけ）
  L->>D: devin -p --prompt-file --export F（切り離して起動）
  loop 2秒おき・最大60秒
    L->>F: セッションIDを読む
  end
  L->>D: devin list --format json（そのIDが専用クローンにあるか）
  L->>S: started（runnerがlocalなら session_id だけ、URLは空）
  S-->>L: running / launch_unknown
```

- 書き出し先は、起動の前に、まだ無いことを確かめてから決める（前の起動の書き出しを読まないため）。
- 書き出しは起動したプロセスだけが書くので、別のセッションが同じフォルダで始まっても取り違えない。一覧での照合は、書き出しのIDが本当にこの専用クローンのセッションかを確かめるためだけに使う。
- 書き出しの本文（会話）は読まずに捨てる。IDの欄だけを読む。

### 切り替え先: 専用クローンのロックと一覧の読み比べ

確かめの起動で、書き出しにIDが入っていないと分かったときだけ、こちらにする。

1. 起動許可（begin）を取る前に、状態の置き場に専用クローンのロックファイルを排他で作る（すでにあれば起動前の失敗として止める）。続けて、専用クローンの一覧を読む。読めなければ、beginを送らずに止める。beginのあとに読むと、止まったときにタスクが`launching`のまま残り、再開できなくなるため。
2. beginを送り、起動する。
3. 待つ時間（60秒）いっぱい2秒おきに一覧を読み続ける。最後まで新しいIDがちょうど1つのときだけ確定する。途中で2つ以上になったら、IDを空にする。
4. ロックファイルを消す。

専用クローンでは、人がDevinを開かない決まりにする（手順書に書く）。守られないと取り違えるおそれが残るので、書き出しの方法より弱い。

### 共有状態の決まり

`started`で`running`にする条件を、タスクの`runner`で分ける。

| runner  | 条件                                        | URL                                                           |
| ------- | ------------------------------------------- | ------------------------------------------------------------- |
| `local` | IDが形に合う（英数字・`_`・`-`、128字まで） | 空（`null`）のときだけ受け付ける。URLが来たら`launch_unknown` |
| `cloud` | 今どおり、IDとURLがそろい、URLの末尾がID    | `app.devin.ai/sessions/<ID>`                                  |

controllerの`session_verified`も同じ分け方にする。

### クラウドを止める設定

`delegation-launch.mjs`は、`--runner cloud`のとき`cloud_launch_verified`が`true`でなければ起動しない（今の`migration_complete`・`cli_launch_verified`の確認と同じ場所）。

### 確かめの起動（論点の記録「確かめのための起動を、どうするか」のA）

1. 一時フォルダ（例: `$TMPDIR/devin-probe-<日時>`）を作る。リポジトリではないフォルダにする。
2. そのフォルダで`devin --model swe-2-medium --permission-mode accept-edits -p --prompt-file <依頼> --export <書き出し先>`を起動する。依頼は「このフォルダに`probe.txt`を作って、中身に`ok`と書いて終わる」だけ。
3. 2秒おきに書き出しと一覧を読み、書き出しにIDが出るまでの秒数、IDの欄の名前と形、一覧のIDと同じかを記録する。
4. CLIの中で起動の要求を送り直していないかを確かめる。依頼が終わってからさらに2分待って一覧を読み、このフォルダに新しいセッションが1つだけあることを記録する。2つ以上あれば、`cli_launch_verified`は外さない。
5. 結果をこの設計書の「確かめの結果」と、試験計画に書く。書き出しにIDが無ければ、切り替え先の方法で実装することを、ここに書く。手順書の「起動する試験はしない」に、この1回を例外として書き足す。

この起動は共有状態を通さない（register・beginを使わない）。委譲の記録には残らない。書き出しは確かめたあと消す。

## データフロー

`started`の要求の形は変えない。手元のときは`session_url: null`で送る。タスクには`session_id`が入り、`session_url`は`null`のまま残る。

## API 設計

対象外（アプリの公開APIは変えない）。

## DB 設計

対象外。

## フロントエンド設計

対象外。

## バックエンド設計

対象外（アプリのコードは触らない）。

## エラー処理

外部（Devin CLI）の呼び出しとファイルの読み取りを足すので、5つを決める。

- (a) 再試行: 書き出しを読むのは2秒おきの読み直しで、最大60秒（30回）。起動そのものは1回だけで、再試行しない。
- (b) 時間切れ: 一覧のコマンド1回は10秒で打ち切る。書き出しの読み取りを含めて全体で70秒。
- (c) 冪等性: 起動は今どおりbeginの許可を1回だけ使う（spentの記録）。書き出しと一覧は読むだけなので、何回読んでも状態は変わらない。
- (d) 部分失敗: 起動のあとに書き出しや一覧を読めなくなったら、IDを空にして`started`を送る。共有状態は`launch_unknown`になり、自動で再起動しない。
- (e) フォールバック: Devin CLIが動かないときは、今どおり起動前の失敗として止まる。

## ログと監視

起動ラッパーの出力（JSON）に、見つけたIDと、書き出しにIDが出るまでの秒数を足す。プロンプトの中身、ログの本文、書き出しの本文は出さない。

## セキュリティ

書き出しには会話が入るので、状態の置き場の0700のフォルダに0600で作り、IDを読んだあとは本文を読まない。委譲の記録や出力に写すのはIDだけで、今の形の検査を通したものに限る。一覧のJSONは、IDと作業フォルダだけを読む。確かめの起動は、リポジトリの外の一時フォルダで、`dangerous`ではなく`accept-edits`の権限で動かす。

## 性能

起動ごとに、書き出しの読み取りを最大30回、一覧のコマンドを1回動かす。

## テスト方針

- 起動ラッパー: `--export`に、まだ無い非公開のファイルを指定する。書き出しからIDを読め、一覧に専用クローンのセッションとして載っていれば、`session_id`だけで`started`を送る。書き出しが無い・読めない・形が違う・一覧に無い・別のフォルダのセッション、のときはIDを空にする。`--runner cloud`は`cloud_launch_verified`が`false`なら起動しない。
- 切り替え先にした場合: ロックがあれば起動しない。前の一覧を読めなければbeginを送らない。待つ時間いっぱい読み、途中で2つ以上になれば空にする。
- 共有状態: `runner: local`はIDだけで`running`。URLが付いたら`launch_unknown`。`runner: cloud`は今どおりURLが要る。
- 確かめの起動: 手動で1回。結果を試験計画に書く。

## 移行とリリース

1. この設計の承認（このPRのマージ）。
2. 確かめの起動を1回して、結果を記録する。書き出しのIDの欄、IDが出るまでの秒数、2つ目のセッションができないこと（CLIの中での再送が無いこと）を確かめる。再送が見つかれば、ここで止めてユーザーに渡す。
3. 実装のPR（2の結果に合わせて、書き出しの方法か切り替え先の方法。決まり・`cloud_launch_verified: false`・試験・手順書）。
4. 設定のPRで`cli_launch_verified`と`migration_complete`を`true`にする。
5. 第1波の委譲（#251・#247・#250）を始める。前に、専用クローンをmainに戻す。

確かめの起動を実装の前にしたのは、書き出しのどこにIDが入るかで、実装の中身が変わるため。戻すときは、2つの設定を`false`に戻せば、今と同じく起動しなくなる。

## リスク

- Devin CLIの版が変わり、書き出しや一覧の形が変わると、IDを読めずに`launch_unknown`になる。止まる側に倒れるので、誤った状態は残らない。
- 切り替え先の方法にした場合、人が専用クローンで別にDevinを開くと、取り違えるおそれが残る。手順書で専用クローンを委譲だけのものと決めて防ぐ。

## 確かめの結果

（確かめの起動のあとに書く）

## 決めたこと（問いと答え）

`docs/discussions/devin-local-session.md`

## 未決事項

なし。5件とも2026-10-24に決定した。IDの取り方は、PR #270のレビューを受けて同じ日に決め直した。
