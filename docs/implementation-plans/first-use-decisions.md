# 実装計画: first-use-decisions（初めて使った人のレビューの残りを直す）

- 設計書: `docs/designs/first-use-decisions.md`（#296で承認）
- 論点の記録: `docs/discussions/first-use-decisions.md`
- 試験計画: `docs/tests/first-use-decisions.md`
- 関連: #253
- レベル: L2

## 実装の進め方

3つのタスクとも、手元のDevin（SWE-2、effortはmedium）に渡す。どれもブラウザの画面だけの小さな直しで、設計書に直し方が書いてあり、判断が要らないため。Claude Codeは各PRをレビューする。

## 分け方

設計書の6つの直しを、Devinに渡す3つのタスクに分ける。3つは専用のクローンを1つずつ使って並行で進める。触るファイルが重ならないように分けた。`apps/web/src/app/globals.css`だけは3つとも触ることがあるが、それぞれ関係する規則のすぐそばに足すので、違う場所の変更になる。

| タスク                        | 何を直すか                                               | 主に触るファイル                                                                      |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `wide-and-quiet`              | 広い画面の幅、精算の「支払いを記録」の見た目、補足の文字 | `globals.css`、`trip-tab-bar.tsx`、`settlement-screen.tsx`                            |
| `cancel-row-and-notify-entry` | 履歴の取り消しの行、旅行の一覧の通知の設定への入口       | `record-list.tsx`、`trips-screen.tsx`                                                 |
| `partner-tag`                 | 二人の名前が並ぶ所の「（相手）」                         | `home-balance-card.tsx`、`transfer-card.tsx`、`payment-detail-screen.tsx`、新しい部品 |

マージの順番は決めない。`globals.css`で衝突したら、あとのPRでmainを取り込んで両方を残す。

## 確かめ方

試験の観点は`docs/tests/first-use-decisions.md`に書いた。各タスクは、そこに書いた観点を、今ある画面ごとの試験のファイルに足す。3つがマージされたら、結合検証環境に出して、パソコンの幅（1280px）とスマートフォンの幅（375px）で見て確かめる。

## リスク

- `globals.css`の衝突: 3つとも触る見込みがある。関係する規則のそばに足すので、たいていは自動で合わさる。衝突したら、あとのPRでmainを取り込み、両方の規則を残す。
- 幅を広げたときの行の崩れ: 48remにすると、金額や時刻が名前から離れて見える行が出るかもしれない。結合検証環境で見て、離れすぎる行があれば、その行だけ幅を抑える直しを別に出す。
- 補足の文字の折り返し: 12pxにすると、精算の小見出しのように詰めて並べた所で折り返しが出るかもしれない。スマートフォンの幅で見て確かめる。

## 戻し方

3つのタスクは別々のPRで、互いの変更に頼らない。どれか1つだけを戻すときは、そのPRを戻す（revertのPRを作る）。`globals.css`は、戻すPRが足した規則だけが消え、ほかのタスクの規則は残る。保存されたデータには触らないので、戻してもデータの直しは要らない。

## 文書の更新

- 設計書と試験計画は、この計画で足りる。実装で設計から外れる所が出たら、その場で止めて設計書を直す。
- `docs/glossary.md`に「（相手）」の表記を足す（`partner-tag`のPRで）。

## タスク

<!-- delegation-task:wide-and-quiet -->

## 目的

パソコンの画面で本文が狭い列に寄って見える点、精算の画面で主な操作が2つ並んで見える点、補足の文字が小さく薄い点を直す（#253）。設計書`docs/designs/first-use-decisions.md`の「対象範囲」の表の、本文の幅・精算の主ボタン・補足の文字・下のタブの名前の4行が対象。L2の設計は承認済み。

## 読む資料

- `docs/designs/first-use-decisions.md`（対象範囲・変更後構成・フロントエンド設計）
- `apps/web/src/app/globals.css`の`main`・`dialog.sheet`・`.tabbar-inner`・`.main-action`と、補足の文字の規則
- `apps/web/src/features/trips/ui/trip-tab-bar.tsx`
- `apps/web/src/screens/settlement/settlement-screen.tsx`

## やること

- [ ] `:root`に`--content-max: 40rem`を足し、`main`・`dialog.sheet`・`.tabbar-inner`・`.main-action`の40remをこの変数に置き換える。
- [ ] `@media (min-width: 1024px)`で`--content-max`を48remにする。
- [ ] `TripTabBar`に`quiet?: boolean`を足す。`true`のときは主ボタンに`main-action-quiet`の見た目を付ける。オフラインのときの押せない見た目にも同じく付ける。行き先と押せる条件は変えない。
- [ ] `.main-action-quiet`を足す。背景は画面の背景の色、枠線と文字は墨の色、高さは今の主ボタンより小さく（目安40px）、幅は文字に合わせる。暗い画面でも読めるようにする。
- [ ] 精算の画面の`TripTabBar`に`quiet`を渡す。
- [ ] 補足の文字（`.field-optional`・`.pay-share-sub`・`.settle-tile-label`・`.settle-item-confirm .settle-item-share`・`.rrow-pill`・`.home-rec-voided-badge`・`.conflict-diff`・`.conflict-same`・`.conflict-side`）を12pxにし、色を`--color-text-muted`から`--color-text-secondary`にする。

## テスト

- [ ] `docs/tests/first-use-decisions.md`の「精算の「支払いを記録」」の観点を、`trip-tab-bar.test.tsx`と`settlement-screens.test.tsx`に足す。
- [ ] 精算の画面の主ボタンが`main-action-quiet`を持ち、「支払いを記録」（`/trips/{id}/payments/new`）へのリンクのままであることを確かめる単体の試験。
- [ ] ホームの主ボタンは`main-action-quiet`を持たないことを確かめる単体の試験。
- [ ] オフラインのときも、精算の画面では押せない見た目に`main-action-quiet`が付くことを確かめる単体の試験。
- [ ] `npm test`と`npm run test:e2e`が通る。

## 既知の指摘（関係する領域のときだけ）

- E2E: 日付は今日から数えて作り、年や日を決め打ちしない。要素は役割・見出し・ラベルで探し、クラス名で探さない。APIを模擬したら、外す条件をPRの説明に書く。

## やらないこと

- 下のタブの名前（`.tabbar-item`）の大きさは変えない。
- 2段の並び（広い画面で横に並べる）は作らない。
- 精算の画面のほかでは、主ボタンの見た目を変えない。

## 完了条件

- `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る。
- PRの説明に、幅と文字の大きさは結合検証環境で見て確かめる予定だと書く。

<!-- /delegation-task -->

<!-- delegation-task:cancel-row-and-notify-entry -->

## 目的

履歴で取り消した支払いが2件あるように見える点と、通知の設定が旅行のメニューの奥からしか開けない点を直す（#253）。設計書`docs/designs/first-use-decisions.md`の「対象範囲」の表の、取り消しの行・通知の設定への入口の2行が対象。L2の設計は承認済み。

## 読む資料

- `docs/designs/first-use-decisions.md`（対象範囲・フロントエンド設計）
- `apps/web/src/features/records/ui/record-list.tsx`（支払いと、その取り消しの行の組み立て）
- `apps/web/src/screens/trips/trips-screen.tsx`（旅行の一覧の見出し）
- `apps/web/src/screens/notification-settings/parse-from-param.ts`（`from`が無いときの戻る先）

## やること

- [ ] 履歴の行で、種類が支払いの取り消し（`payment_cancellation`）のときは金額を出さない。
- [ ] 同じ行の補足（`meta`）の末尾に「 · 精算から外しました」を足す。
- [ ] 元の支払いの行（線で消して「取り消し済み」を付ける行）は、今のまま金額を出す。
- [ ] 取り消しの行を押すと支払いの詳細を開く動きは変えない。
- [ ] 旅行の一覧の見出し「旅行を切り替え」の右に、鈴のアイコン（`Bell`）と「通知の設定」の文字のリンクを足す。行き先は`/settings/notifications`（`from`を付けない。戻る先は旅行一覧になる）。

## テスト

- [ ] `docs/tests/first-use-decisions.md`の「履歴の取り消しの行」と「通知の設定への入口」の観点を、`records-screens.test.tsx`と`trips-screen.test.tsx`に足す。
- [ ] 履歴で、支払いの取り消しの行に金額が出ず、「精算から外しました」が出ることを確かめる単体の試験。
- [ ] 元の支払いの行には、金額と「取り消し済み」が出ることを確かめる単体の試験。
- [ ] 旅行の一覧に「通知の設定」のリンクがあり、`/settings/notifications`へ行くことを確かめる単体の試験。
- [ ] `npm test`と`npm run test:e2e`が通る。

## 既知の指摘（関係する領域のときだけ）

- E2E: 日付は今日から数えて作り、年や日を決め打ちしない。要素は役割・見出し・ラベルで探し、クラス名で探さない。APIを模擬したら、外す条件をPRの説明に書く。

## やらないこと

- 取り消しの行を一覧から外したり、元の行とまとめたりしない。
- 達成・予約の取り消しの行は変えない。
- 旅行のメニューの「この端末の通知」と、ホームの案内のカードは変えない。

## 完了条件

- `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る。

<!-- /delegation-task -->

<!-- delegation-task:partner-tag -->

## 目的

お金の受け渡しの向きを見るときに、どちらが相手かがわからない点を直す（#253）。設計書`docs/designs/first-use-decisions.md`の「対象範囲」の表の、相手の名前の行が対象。L2の設計は承認済み。

## 読む資料

- `docs/designs/first-use-decisions.md`（対象範囲・変更後構成・フロントエンド設計）
- `apps/web/src/features/trips/model/home-model.ts`の`displayNameOf`
- `apps/web/src/screens/home/home-balance-card.tsx`（ホームの精算のカード）
- `apps/web/src/features/settlement/ui/transfer-card.tsx`（精算の受け渡し）
- `apps/web/src/screens/payment-detail/payment-detail-screen.tsx`（払った人と負担の内訳）

## やること

- [ ] `features/trips`に、名前の後ろに小さく「（相手）」を出す部品`PartnerTag`を足す。自分のユーザーIDと比べて、自分でなければ出す。`features/trips`の入口から公開する。
- [ ] ホームの精算のカードの「誰から誰へ」の2つの名前に付ける。
- [ ] 精算の受け渡しのカードの2つの名前に付ける。
- [ ] 支払いの詳細の「払った人」と、負担の内訳の名前に付ける。
- [ ] 名前が取れずに「相手」と出すところには付けない（「相手（相手）」にしない）。
- [ ] 「（相手）」は読み上げでも名前と一緒に読む（`aria-hidden`にしない）。
- [ ] `docs/glossary.md`に「（相手）」の表記（二人の名前が並ぶ所で、相手の名前の後ろに付ける印）を足す。

## テスト

- [ ] `docs/tests/first-use-decisions.md`の「相手の印」の観点を、`home-screen.test.tsx`・`settlement-screens.test.tsx`・`payments-screens.test.tsx`に足す。
- [ ] 3つの画面で、相手の名前に「（相手）」が付き、自分の名前には付かないことを確かめる単体の試験。
- [ ] 名前が取れないときに「相手（相手）」と出ないことを確かめる単体の試験。
- [ ] `npm test`と`npm run test:e2e`が通る。

## 既知の指摘（関係する領域のときだけ）

- E2E: 日付は今日から数えて作り、年や日を決め打ちしない。要素は役割・見出し・ラベルで探し、クラス名で探さない。APIを模擬したら、外す条件をPRの説明に書く。

## やらないこと

- 履歴の行・通知の文・予定の詳細など、名前が1つだけ出る所には付けない。
- `displayNameOf`の返す文字は変えない（ほかの画面の文に「（相手）」が混ざらないため）。

## 完了条件

- `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る。

<!-- /delegation-task -->
