# 実装計画: plan-form-clarity（予定の追加と、予定の詳細の操作を分かりやすくする）

- 設計書: `docs/designs/plan-form-clarity.md`（#309で承認）
- 論点の記録: `docs/discussions/plan-form-clarity.md`
- 試験計画: `docs/tests/plan-form-clarity.md`
- 関連: #254
- レベル: L2

## 実装の進め方

1つのタスクにまとめて、手元のDevin（SWE-2、effortはmedium）に渡す。設計書に直し方が書いてあり、判断が要らないため。Claude CodeがPRをレビューする。

予定の追加と予定の詳細の直しは、どちらも`apps/web/tests/plans-screens.test.tsx`に試験を足す。2つに分けて並行で進めると同じファイルの末尾で衝突するので、分けない。直しの量は6つとも小さい。

## 分け方

| タスク             | 何を直すか                                                                         | 主に触るファイル                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `form-and-actions` | 時刻の欄・種類の見出し・メモの補足・別の日に移す・取りやめの見た目・支払いの戻る先 | `plan-form-fields.tsx`、`plan-form.ts`、`plan-form-screen.tsx`、`plan-detail-screen.tsx`、`plan-move-sheet.tsx`、`payment-form-screen.tsx`、`globals.css` |

## 確かめ方

試験の観点は`docs/tests/plan-form-clarity.md`に書いた。マージしたら結合検証環境に出し、スマートフォンの幅（375px）で予定の追加・編集と予定の詳細を見る。

## リスク

- 時刻の値の形を変える（`timeUndecided`を外す）ので、予定の追加・編集の今の試験の多くを直すことになる。試験の期待（送る本文）は変えず、操作だけを新しい欄に合わせる。
- iPhoneのSafariでは`<input type="time">`の入れかけを`validity.badInput`で拾えないことがある。単体の試験はjsdomで`validity`を模擬して確かめ、実機は結合検証環境で見る。

## 戻し方

PRを戻す（revertのPRを作る）。送る本文の形も、端末に残す保留の形も変えないので、戻してもデータの直しは要らない。

## 文書の更新

- 設計書と試験計画は、この計画で足りる。実装で設計から外れる所が出たら、その場で止めて設計書を直す。
- `docs/glossary.md`の「日の移動」があれば「別の日に移す」に直す（無ければ足さない）。

## タスク

<!-- delegation-task:form-and-actions -->

## 目的

予定の追加と予定の詳細の6つの分かりにくさを直す（#254）。設計書`docs/designs/plan-form-clarity.md`の「対象範囲」の表の7行が対象。L2の設計は承認済み（#309）。

## 読む資料

- `docs/designs/plan-form-clarity.md`（対象範囲・変更後構成・フロントエンド設計・エラー処理）
- `docs/tests/plan-form-clarity.md`（観点の表）
- `apps/web/src/features/plans/ui/plan-form-fields.tsx`と`apps/web/src/features/plans/model/plan-form.ts`（時刻の値と検証）
- `apps/web/src/screens/plan-form/plan-form-screen.tsx`（初期値と保留の読み直し）
- `apps/web/src/screens/plan-detail/plan-detail-screen.tsx`と`apps/web/src/features/plans/ui/plan-move-sheet.tsx`
- `apps/web/src/screens/payment-form/payment-form-screen.tsx`（保存したあとの行き先と戻るリンク）

## やること

- [ ] `PlanFormValues`から`timeUndecided`を外し、`time`が空文字なら時刻未定にする。送るときは空なら`time: null`、そうでなければ`HH:mm`。編集は変えた項目だけを送る今の決まりのまま。
- [ ] 時刻の欄は「時刻未定」のチェックを消して`<input type="time">`を常に出し、欄の下に「空のままなら時刻未定」を`aria-describedby`で結ぶ。
- [ ] 時刻が入っているときだけ、欄の右に「消す」ボタン（読み上げの名前は「時刻を消す」）を出す。押すと欄を空にして時刻の欄に焦点を戻す。
- [ ] 検証で、空はエラーにしない。入れかけ（`validity.badInput`が真）は「時刻を確認してください」にして送らない。
- [ ] 種類の見出しを「種類（どれか1つ）」にする。
- [ ] メモの欄の下に「場所やURLはメモに書けます」を出し、`aria-describedby`で結ぶ。
- [ ] 予定の詳細の「日の移動」のボタンと、開く画面の見出しを「別の日に移す」にする。移したあとの知らせを「別の日に移しました」にする。
- [ ] 「取りやめにする」のボタンに`btn-outline-danger`を足す。`globals.css`に、文字と枠線を`--color-danger`にする規則と、ボタンの上の間12pxを足す。押せないときはほかのボタンと同じ押せない見た目にする。
- [ ] 支払いの記録で、URLの`planId`を確かめられたときは、保存したあとと戻るリンクの行き先を`/trips/{tripId}/plans/{planId}`にする。確かめられないときと`planId`が無いときは今のまましおりへ行く。

## テスト

- [ ] `docs/tests/plan-form-clarity.md`の観点を、`plans-screens.test.tsx`と`payments-screens.test.tsx`に足す。
- [ ] 「時刻未定」のチェックを使っている今の試験は、送る本文の期待を変えずに、操作だけを新しい欄に合わせる。
- [ ] `e2e/tests/m01-flow.spec.ts`で「時刻未定」や「日の移動」を探している所を新しい形に直す。
- [ ] `npm test`と`npm run test:e2e`が通る。

## 既知の指摘（関係する領域のときだけ）

- E2E: 日付は今日から数えて作り、年や日を決め打ちしない。要素は役割・見出し・ラベルで探し、クラス名で探さない。APIを模擬したら、外す条件をPRの説明に書く。

## やらないこと

- 予定の項目（場所・URL・費用の欄）を足さない。
- APIと契約（`packages/contracts`）、送る本文の形を変えない。
- 取りやめの確かめのダイアログと、達成・予約のボタンは変えない。
- ホーム・しおり・履歴・精算の主ボタンから開いた支払いの記録の戻る先は変えない。

## 完了条件

- `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る。
- PRの説明に、設計書の「対象範囲」の表の行ごとに、直した場所と試験を書く。

<!-- /delegation-task -->
