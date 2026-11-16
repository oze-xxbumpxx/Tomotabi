/**
 * 判断画面の見本。claude.aiのArtifactでは、この1ファイルを出す。
 * 帯に書いたとおり、割合・経過・工程の分数・不具合の筋書きは作り物。
 * ファイル名と、コードを読んで書いた分岐だけがリポジトリの事実。
 * 本番の成果物はこの帯も、この数字も写さない。書き方はSKILL.md。
 */
import React, { useState } from "react";

type Tab = "next" | "now" | "done";
type Group = "yours" | "moving" | "stuck";
type Mode = "design" | "bug";
type Visual = "full" | "top" | "float" | "diff" | "none";

type Item = {
  id: string;
  tab: Tab;
  group: Group;
  title: string;
  step: string;
  time?: string;
  marker: string;
  line: string;
  tone: "question" | "task" | "plain";
  badge?: string;
};

type Choice = {
  id: string;
  letter: string;
  title: string;
  summary: string;
  tradeoff: string;
  visual: Visual;
  recommended?: boolean;
  verify?: string;
  blast?: string;
};

type Question = {
  kicker: string;
  heading: string;
  decided?: string;
  paragraphs: string[];
  points: string[];
  reason?: string;
  choices: Choice[];
};

type Note = {
  heading: string;
  paragraphs: string[];
  steps?: string[];
};

type EvidenceBlock = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  extra?: "chart" | "places";
};

type Detail =
  | { kind: "question"; question: Question; evidence: EvidenceBlock[] }
  | { kind: "task"; note: Note; evidence: EvidenceBlock[] }
  | { kind: "note"; note: Note; evidence: EvidenceBlock[] };

const GROUP_LABEL: Record<Group, string> = {
  yours: "あなたの番",
  moving: "動いている",
  stuck: "止まっている",
};

const PANEL =
  "flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const DESIGN_ITEMS: Item[] = [
  {
    id: "q1",
    tab: "now",
    group: "yours",
    title: "受け渡しの確認の主ボタン",
    step: "いま：置き場所（2/3）",
    time: "3分前",
    marker: "Q1",
    line: "主ボタンはどこに置く？",
    tone: "question",
  },
  {
    id: "t1",
    tab: "now",
    group: "yours",
    title: "手元のiPhoneで確認を見る",
    step: "いま：実機（2/3）",
    time: "20分前",
    marker: "T1",
    line: "あなたがやること",
    tone: "task",
  },
  {
    id: "q2",
    tab: "now",
    group: "moving",
    title: "履歴のまとまり",
    step: "いま：選ぶ（2/3）",
    time: "8分前",
    marker: "Q2",
    line: "履歴を旅行ごとにまとめる？",
    tone: "question",
  },
  {
    id: "q3",
    tab: "now",
    group: "moving",
    title: "ToDoのカテゴリの位置",
    step: "いま：選ぶ（2/3）",
    time: "15分前",
    marker: "Q3",
    line: "カテゴリを予定の横に出す？",
    tone: "question",
  },
  {
    id: "sub",
    tab: "now",
    group: "moving",
    title: "通知の購読を片づける",
    step: "いま：整理（2/2）",
    time: "2分前",
    marker: "",
    line: "人が選ぶ問いは無い",
    tone: "plain",
    badge: "知らせ 1",
  },
  {
    id: "draft",
    tab: "now",
    group: "stuck",
    title: "受け渡しメモの下書き",
    step: "いま：書き出す形（2/2）",
    time: "3時間前",
    marker: "",
    line: "文面はまだ無い",
    tone: "plain",
  },
  {
    id: "shot",
    tab: "next",
    group: "yours",
    title: "決めたあとに画面を撮る",
    step: "いま：確認",
    marker: "T2",
    line: "あなたがやること",
    tone: "task",
  },
  {
    id: "yen",
    tab: "done",
    group: "moving",
    title: "0円のボタン文言",
    step: "いま：反映済み",
    marker: "",
    line: "文言は2つに分かれている",
    tone: "plain",
  },
  {
    id: "push",
    tab: "done",
    group: "moving",
    title: "通知のタイトルと本文",
    step: "いま：反映済み",
    marker: "",
    line: "タイトルは tomotabi",
    tone: "plain",
  },
];

const BUG_ITEMS: Item[] = [
  {
    id: "cause",
    tab: "now",
    group: "yours",
    title: "受け渡しの確認を開き直す",
    step: "いま：原因（1/2）",
    time: "12分前",
    marker: "Q1",
    line: "原因はどれか？",
    tone: "question",
  },
  {
    id: "repro",
    tab: "now",
    group: "yours",
    title: "手元で1回開き直す",
    step: "いま：再現",
    time: "12分前",
    marker: "T1",
    line: "あなたがやること",
    tone: "task",
  },
  {
    id: "logs",
    tab: "now",
    group: "moving",
    title: "ブラウザのログを探す",
    step: "いま：ログ",
    marker: "",
    line: "数はデータなし",
    tone: "plain",
  },
  {
    id: "fix",
    tab: "next",
    group: "yours",
    title: "直し方",
    step: "いま：直し方（2/2）",
    marker: "Q2",
    line: "どう直すか？",
    tone: "question",
  },
];

const Q1: Question = {
  kicker: "Q1 · 受け渡しの確認の主ボタン",
  heading: "主ボタンはどこに置く？",
  decided: "ボタンの文字は「受け渡し完了を記録」のままにする",
  paragraphs: [
    "受け渡しの確認で、主ボタンが下の方に隠れていると、金額を見た人が押さないまま戻ることがある。",
    "置き場所を3つから選んでください。文言は変えません。",
  ],
  points: [
    "スマホでは、親指が届く下の方が押しやすい",
    "右上は、ほかの画面の「戻る」と高さがそろいやすい",
  ],
  reason: "金額の直下で、幅いっぱいに押せるため。",
  choices: [
    {
      id: "a",
      letter: "A",
      title: "下に幅いっぱい",
      summary: "スクロールしても下に残り、親指で押せる",
      tradeoff: "明細が長いと、ボタンの分だけ高さを取る",
      visual: "full",
      recommended: true,
    },
    {
      id: "b",
      letter: "B",
      title: "右上に置く",
      summary: "「戻る」と高さがそろう",
      tradeoff: "片手では届きにくい",
      visual: "top",
    },
    {
      id: "c",
      letter: "C",
      title: "右下に浮かせる",
      summary: "スクロール中も目立つ",
      tradeoff: "明細の金額に重なることがある",
      visual: "float",
    },
  ],
};

const DESIGN: Record<string, Detail> = {
  q1: {
    kind: "question",
    question: Q1,
    evidence: [
      {
        title: "押されないまま閉じられている",
        extra: "chart",
        paragraphs: [
          "見本の想定です。ボタンが画面の外にあると、金額を見た人が押せないまま戻る、という話です。",
          "割合は測っていないので、データなし。下の図は形だけです。",
        ],
      },
      {
        title: "3つの置き場所",
        extra: "places",
        paragraphs: [
          "どれも、受け渡しの確認の主ボタンの位置の話です。選んだあと、その画面を開いて位置を見ます。",
        ],
      },
      {
        title: "見た実物",
        bullets: [
          "文言は apps/web/src/screens/settlement-preview/settlement-preview-screen.tsx にある。「受け渡し完了を記録」と、受け渡しが不要なときの「受け渡し不要として精算を記録」。",
          "確認ダイアログの見出しは apps/web/src/features/settlement/ui/complete-settlement-dialog.tsx の「受け渡し完了を記録しますか？」。",
          "いまの画面でボタンが下端か右上かは、未確認。",
          "ほかのアプリの事例は、未確認。",
        ],
      },
    ],
  },
  t1: {
    kind: "task",
    note: {
      heading: "手元のiPhoneで確認を見る",
      paragraphs: [
        "あなたがやること。受け渡しの確認を開き、主ボタンがスクロールなしで見えるかを見ます。",
      ],
      steps: [
        "旅行の精算から、受け渡しの確認を開く",
        "金額と主ボタンが、同時に見えるかをメモする",
        "見えた位置を、左のQ1のどれに近いか書く",
      ],
    },
    evidence: [
      {
        title: "見ること",
        bullets: [
          "画面は受け渡しの確認。ファイルは settlement-preview-screen.tsx。",
          "この見本では、実機の結果はデータなし。",
        ],
      },
    ],
  },
  q2: {
    kind: "question",
    question: {
      kicker: "Q2 · 履歴のまとまり",
      heading: "履歴を旅行ごとにまとめる？",
      paragraphs: [
        "履歴は、支払い・達成・予約・取り消しを新しい順に並べた画面です。旅行が複数あると、混ざって見える人がいます。",
        "いまの並びは、この見本では未確認です。推奨は付けていません。",
      ],
      points: ["変える前に、いまの並びを画面で見る", "見出しを足すと、日付の連続は切れる"],
      choices: [
        {
          id: "a",
          letter: "A",
          title: "新しい順のまま",
          summary: "日付の流れを切らない",
          tradeoff: "旅行をまたぐと、どれの支払いか分かりにくい",
          visual: "none",
        },
        {
          id: "b",
          letter: "B",
          title: "旅行の見出しを足す",
          summary: "旅行ごとに塊になる",
          tradeoff: "旅行をまたいだ時系列は読みにくい",
          visual: "none",
        },
      ],
    },
    evidence: [
      {
        title: "何が問題か",
        paragraphs: ["混ざる件数が欲しいところですが、数えていないのでデータなし。"],
      },
      {
        title: "見た実物",
        bullets: [
          "画面のファイルは apps/web/src/screens/records/records-screen.tsx。",
          "いま旅行ごとにまとまっているかは、未確認。",
        ],
      },
    ],
  },
  q3: {
    kind: "question",
    question: {
      kicker: "Q3 · ToDoのカテゴリの位置",
      heading: "カテゴリを予定の横に出す？",
      paragraphs: [
        "ToDoは旅行ごとの項目で、カテゴリを1つ付けられます。予定の横に出すと、しおりを見ながら分類を確認できます。",
        "いまの位置は未確認なので、推奨は付けていません。",
      ],
      points: ["カテゴリはToDoを分ける欄で、予定そのものではない"],
      choices: [
        {
          id: "a",
          letter: "A",
          title: "ToDoの一覧だけに出す",
          summary: "分類の編集場所が1つになる",
          tradeoff: "しおりを見ているときはカテゴリが見えない",
          visual: "none",
        },
        {
          id: "b",
          letter: "B",
          title: "予定の横にも出す",
          summary: "しおりの上で分類が分かる",
          tradeoff: "予定の行が長くなる",
          visual: "none",
        },
      ],
    },
    evidence: [
      {
        title: "見た実物",
        bullets: [
          "ToDoの画面は apps/web/src/screens/todos/todos-screen.tsx。",
          "予定の横に出ているかは、未確認。データなし。",
        ],
      },
    ],
  },
  sub: {
    kind: "note",
    note: {
      heading: "通知の購読を片づける",
      paragraphs: [
        "人が選ぶ問いはありません。購読のAPIは進んでいます。",
        "「知らせ 1」と工程の分数は見本の飾りです。実数はデータなし。",
      ],
    },
    evidence: [
      {
        title: "見た実物",
        bullets: [
          "購読の口は apps/api/src/modules/notification/controller/push-subscriptions.controller.ts。",
          "残件の数は、未確認。",
        ],
      },
    ],
  },
  draft: {
    kind: "note",
    note: {
      heading: "受け渡しメモの下書き",
      paragraphs: ["止まっています。書き出す文面は、まだありません。"],
    },
    evidence: [
      {
        title: "根拠",
        paragraphs: ["文面の案はデータなし。"],
      },
    ],
  },
  shot: {
    kind: "task",
    note: {
      heading: "決めたあとに画面を撮る",
      paragraphs: ["あなたがやること。Q1で置き場所を選んだあと、受け渡しの確認を撮ります。"],
      steps: ["選んだ位置で画面を開く", "金額とボタンが同時に写るか見る"],
    },
    evidence: [
      {
        title: "まだ撮っていない",
        paragraphs: ["スクリーンショットはデータなし。"],
      },
    ],
  },
  yen: {
    kind: "note",
    note: {
      heading: "0円のボタン文言は分かれている",
      paragraphs: [
        "受け渡しが不要なときは「受け渡し不要として精算を記録」、それ以外は「受け渡し完了を記録」です。",
      ],
    },
    evidence: [
      {
        title: "見た実物",
        bullets: [
          "apps/web/src/screens/settlement-preview/settlement-preview-screen.tsx の recordAction。direction が null のとき文言が分かれる。",
        ],
      },
    ],
  },
  push: {
    kind: "note",
    note: {
      heading: "通知のタイトルと本文は決まっている",
      paragraphs: [
        "タイトルは tomotabi。本文は、相手の名前、旅行の名前、操作の順です。",
      ],
    },
    evidence: [
      {
        title: "見た実物",
        bullets: [
          "apps/api/src/modules/notification/domain/notification-message.ts の NOTIFICATION_TITLE と ACTION_TEXTS。",
        ],
      },
    ],
  },
};

const BUG: Record<string, Detail> = {
  cause: {
    kind: "question",
    question: {
      kicker: "Q1 · 受け渡しの確認を開き直す",
      heading: "原因はどれか？",
      paragraphs: [
        "見本の症状です。受け渡しの確認を開き直すと、主ボタンが押せない、という想定で、実機では未確認です。",
        "下の3つは、画面のコードにある分岐です。今回の原因だと決めたわけではありません。",
      ],
      points: [
        "ボタンが無くなる分岐と、ボタンが残って無効になる分岐は別",
        "直し方は左の「次にやること」に置いてある",
      ],
      reason:
        "主ボタンそのものが別の表示に替わるのは、結果不明の分岐だけなので、先にそこを見る。",
      choices: [
        {
          id: "a",
          letter: "A",
          title: "結果不明の表示に替わっている",
          summary: "主ボタンの代わりに「同じ内容で確認する」が出る",
          tradeoff: "結果不明でなければ、この分岐には入らない",
          visual: "none",
          recommended: true,
          verify: "開き直した画面が「保存されたか確認できません」かを見る",
          blast: "settlement-preview-screen.tsx の recordAction（check.status が found）",
        },
        {
          id: "b",
          letter: "B",
          title: "オフラインでボタンが無効",
          summary: "ボタンは残り、押せない",
          tradeoff: "オフラインでなければ、この無効にはならない",
          visual: "none",
          verify: "「インターネットに接続できません」が出ているかを見る",
          blast: "settlement-preview-screen.tsx の disabled と、offline-banner.tsx",
        },
        {
          id: "c",
          letter: "C",
          title: "記録できる状態ではない",
          summary: "記録済みや、記録できないときは別の文言になる",
          tradeoff: "記録できる状態なら、この表示にはならない",
          visual: "none",
          verify: "「この確認では記録できません」などの文言かを見る",
          blast: "settlement-preview-screen.tsx の status 分岐",
        },
      ],
    },
    evidence: [
      {
        title: "再現手順",
        bullets: [
          "見本の手順です。実機では未確認。",
          "受け渡しの確認を開く",
          "一度閉じて、同じ確認を開き直す",
          "主ボタンが押せるかを見る",
        ],
      },
      {
        title: "実際と期待",
        paragraphs: [
          "実際（見本の想定）: 主ボタンが押せない。期待: 金額を確認した人が、主ボタンを押せる。",
        ],
      },
      {
        title: "ログと数",
        paragraphs: ["ブラウザのログも件数も、取っていないのでデータなし。"],
      },
    ],
  },
  repro: {
    kind: "task",
    note: {
      heading: "手元で1回開き直す",
      paragraphs: [
        "あなたがやること。見本の症状が、手元で起きるかを1回見ます。",
      ],
      steps: [
        "受け渡しの確認を開く",
        "閉じて、同じ確認を開き直す",
        "主ボタン、結果不明の表示、オフラインの帯のどれが出たかをメモする",
      ],
    },
    evidence: [
      {
        title: "まだ見ていない",
        paragraphs: ["実機の結果はデータなし。"],
      },
    ],
  },
  logs: {
    kind: "note",
    note: {
      heading: "ブラウザのログを探す",
      paragraphs: ["人が選ぶ問いはありません。ログはまだ無いので、データなしです。"],
    },
    evidence: [
      {
        title: "ログと数",
        paragraphs: ["データなし。"],
      },
    ],
  },
  fix: {
    kind: "question",
    question: {
      kicker: "Q2 · 直し方",
      heading: "どう直すか？",
      paragraphs: [
        "原因はまだ未確認です。直し方は仮の候補で、推奨は付けていません。",
        "原因の問いを先に選んでから、この問いを開きます。",
      ],
      points: ["仮の直し方は、読んだ分岐を変えるか、変えないか"],
      choices: [
        {
          id: "a",
          letter: "A",
          title: "分岐は変えない",
          summary: "再現したときの文言が、どの分岐かを確かめる",
          tradeoff: "原因がコードの不具合なら、このままでは直らない",
          visual: "none",
          verify: "開き直した画面の文言を、3つの分岐のどれかと突き合わせる",
          blast: "コードは変えない。確認は settlement-preview-screen.tsx",
        },
        {
          id: "b",
          letter: "B",
          title: "結果不明でも主ボタンを残す",
          summary: "いまは found のとき、主ボタンを出していない",
          tradeoff: "同じ要求の確認を飛ばして、別の操作を押せると二重になり得る",
          visual: "diff",
          verify: "found のとき、主ボタンと「同じ内容で確認する」が両方見えるかを見る",
          blast: "settlement-preview-screen.tsx の recordAction と save-unknown.tsx",
        },
        {
          id: "c",
          letter: "C",
          title: "オフラインの理由をボタンの隣に出す",
          summary: "帯は画面の上にある。隣にあるかは未確認",
          tradeoff: "すでに隣にあるなら、この変更は要らない",
          visual: "none",
          verify: "オフラインのとき、無効ボタンの隣に理由の1行があるかを見る",
          blast: "settlement-preview-screen.tsx と offline-banner.tsx。範囲の詳細は未確認",
        },
      ],
    },
    evidence: [
      {
        title: "原因が先",
        paragraphs: [
          "原因が未確認なので、直し方の採否はまだ決められません。ログはデータなし。",
        ],
      },
      {
        title: "確かめ方の置き場",
        bullets: [
          "各カードの「確かめ方」と「影響範囲」を、選んだあと手元で実行する。",
          "実行結果は、まだデータなし。",
        ],
      },
    ],
  },
};

function itemsFor(mode: Mode): Item[] {
  return mode === "design" ? DESIGN_ITEMS : BUG_ITEMS;
}

function detailFor(mode: Mode, id: string): Detail {
  const table = mode === "design" ? DESIGN : BUG;
  return table[id] ?? table[mode === "design" ? "q1" : "cause"];
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="#F0FDF4" stroke="#16A34A" />
      <path
        d="M4.6 8.2 6.8 10.4 11.4 5.6"
        fill="none"
        stroke="#16A34A"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      className={
        on
          ? "mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full border-[5px] border-[#2563EB] bg-white"
          : "mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full border border-[#D1D5DB] bg-white"
      }
    />
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#E6E8EC] bg-[#F8FAFC] p-2.5">{children}</div>
  );
}

function Lines() {
  return (
    <div className="mt-2 space-y-1">
      <div className="h-2 w-10 rounded bg-[#FDBA74]" />
      <div className="h-1.5 w-full rounded bg-[#E5E7EB]" />
      <div className="h-1.5 w-2/3 rounded bg-[#E5E7EB]" />
    </div>
  );
}

function ChoiceVisual({ visual }: { visual: Visual }) {
  if (visual === "none") {
    return <p className="mt-2 text-[11px] text-[#6B7280]">図なし</p>;
  }
  if (visual === "diff") {
    return (
      <pre className="mt-2 overflow-x-auto rounded-xl bg-[#F8FAFC] p-2 text-[10px] leading-4 text-[#1F2937]">
        {`- 主ボタンを出す\n+ 「同じ内容で確認する」`}
      </pre>
    );
  }
  if (visual === "top") {
    return (
      <PhoneFrame>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[#6B7280]">受け渡しの確認</span>
          <span className="rounded bg-[#2563EB] px-1.5 py-0.5 text-[10px] font-semibold text-white">
            記録
          </span>
        </div>
        <Lines />
      </PhoneFrame>
    );
  }
  if (visual === "float") {
    return (
      <PhoneFrame>
        <div className="relative">
          <span className="text-[10px] text-[#6B7280]">受け渡しの確認</span>
          <Lines />
          <span className="absolute bottom-0 right-0 rounded bg-[#2563EB] px-1.5 py-0.5 text-[10px] font-semibold text-white">
            記録
          </span>
        </div>
      </PhoneFrame>
    );
  }
  return (
    <PhoneFrame>
      <span className="text-[10px] text-[#6B7280]">受け渡しの確認</span>
      <Lines />
      <div className="mt-2 rounded-md bg-[#2563EB] py-1 text-center text-[10px] font-semibold text-white">
        受け渡し完了を記録
      </div>
    </PhoneFrame>
  );
}

function SampleChart() {
  return (
    <div className="mt-2 rounded-xl bg-[#F8F9FB] px-3 py-3">
      <p className="text-[11px] font-semibold text-[#C2410C]">見本の図。実測はデータなし</p>
      <svg viewBox="0 0 280 96" className="mt-1 h-[96px] w-full">
        <circle cx="36" cy="48" r="16" fill="#FFFFFF" stroke="#E6E8EC" />
        <path d="M28 54 38 40 46 50" fill="none" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M38 40 42 44" fill="none" stroke="#F97316" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M30 52 26 56" fill="none" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M52 48 C 100 48, 120 24, 176 24" fill="none" stroke="#16A34A" strokeWidth="1.6" />
        <path d="M52 48 C 100 48, 120 72, 176 72" fill="none" stroke="#F97316" strokeWidth="1.6" />
        <circle cx="188" cy="24" r="7" fill="#F0FDF4" stroke="#16A34A" />
        <circle cx="188" cy="72" r="7" fill="#FFF7ED" stroke="#F97316" />
        <text x="202" y="20" fontSize="11" fill="#166534">
          ボタンを押す
        </text>
        <text x="202" y="34" fontSize="12" fontWeight="700" fill="#16A34A">
          70%
        </text>
        <text x="202" y="68" fontSize="11" fill="#9A3412">
          押さずに閉じる
        </text>
        <text x="202" y="82" fontSize="12" fontWeight="700" fill="#F97316">
          30%
        </text>
      </svg>
    </div>
  );
}

function PlaceCompare() {
  const places = [
    { label: "下に幅いっぱい", on: true },
    { label: "右上", on: false },
    { label: "右下に浮かせる", on: false },
  ];
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {places.map((place) => (
        <div
          key={place.label}
          className={
            place.on
              ? "rounded-xl border border-[#2563EB] bg-[#EFF6FF] p-2"
              : "rounded-xl border border-[#E6E8EC] bg-white p-2"
          }
        >
          <div className="mx-auto h-10 w-7 rounded-md border border-[#E6E8EC] bg-white" />
          <p className="mt-1 text-center text-[10px] leading-3 text-[#1F2937]">{place.label}</p>
          {place.on ? (
            <p className="text-center text-[10px] font-semibold text-[#2563EB]">推奨</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function EvidenceColumn({ blocks }: { blocks: EvidenceBlock[] }) {
  const [help, setHelp] = useState(false);
  return (
    <aside className={`${PANEL} w-[320px] shrink-0`}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <h2 className="text-[15px] font-semibold text-[#1F2937]">根拠</h2>
        {blocks.map((block, index) => (
          <section key={block.title}>
            <div className="flex items-start gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#2563EB] text-[11px] font-semibold text-white">
                {index + 1}
              </span>
              <h3 className="text-[14px] font-semibold leading-5 text-[#1F2937]">{block.title}</h3>
            </div>
            {block.extra === "chart" ? <SampleChart /> : null}
            {block.extra === "places" ? <PlaceCompare /> : null}
            {block.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-[12px] leading-5 text-[#4B5563]">
                {paragraph}
              </p>
            ))}
            {block.bullets ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] leading-5 text-[#4B5563]">
                {block.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
      <div className="flex justify-end px-4 pb-3">
        <button
          type="button"
          aria-expanded={help}
          onClick={() => setHelp((open) => !open)}
          className="grid h-7 w-7 place-items-center rounded-full border border-[#E6E8EC] text-[12px] text-[#6B7280]"
        >
          ?
        </button>
      </div>
      {help ? (
        <p className="px-4 pb-3 text-[12px] leading-5 text-[#6B7280]">
          決めるのは人です。推奨は勧めです。
        </p>
      ) : null}
    </aside>
  );
}

function MemoField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <label className="sr-only" htmlFor="decision-memo">
        メモや質問
      </label>
      <input
        id="decision-memo"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="メモや質問を書く"
        className="w-full rounded-full border border-[#E6E8EC] px-4 py-2 text-[13px] text-[#1F2937] outline-none placeholder:text-[#9CA3AF] focus:border-[#2563EB]"
      />
    </form>
  );
}

function ChoiceCard({
  choice,
  selected,
  onSelect,
}: {
  choice: Choice;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        selected
          ? "w-full rounded-2xl border border-[#2563EB] bg-white p-3 text-left"
          : "w-full rounded-2xl border border-[#E6E8EC] bg-[#F8F9FB] p-3 text-left"
      }
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[#1F2937]">{choice.letter}</span>
          <span className="text-[14px] font-semibold text-[#1F2937]">{choice.title}</span>
          {choice.recommended ? (
            <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">
              推奨
            </span>
          ) : null}
        </span>
        <Radio on={selected} />
      </span>
      <span className="mt-1 block text-[13px] leading-5 text-[#4B5563]">{choice.summary}</span>
      <span className="mt-0.5 block text-[12px] leading-5 text-[#6B7280]">{choice.tradeoff}</span>
      {choice.verify ? (
        <span className="mt-1 block text-[12px] leading-5 text-[#4B5563]">
          確かめ方: {choice.verify}
        </span>
      ) : null}
      {choice.blast ? (
        <span className="mt-0.5 block text-[12px] leading-5 text-[#4B5563]">
          影響範囲: {choice.blast}
        </span>
      ) : null}
      <span className="mt-2 block">
        <ChoiceVisual visual={choice.visual} />
      </span>
    </button>
  );
}

function QuestionBody({
  item,
  model,
  picked,
  onPick,
  decidedOpen,
  onCloseDecided,
  memo,
  onMemo,
}: {
  item: Item;
  model: Question;
  picked: string;
  onPick: (id: string) => void;
  decidedOpen: boolean;
  onCloseDecided: () => void;
  memo: string;
  onMemo: (value: string) => void;
}) {
  const lead = model.choices.slice(0, 2);
  const rest = model.choices.slice(2);
  return (
    <div>
      {model.decided && decidedOpen ? (
        <div className="rounded-2xl bg-[#F8F9FB] px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[13px] font-semibold text-[#1F2937]">{item.title}</p>
              <p className="mt-0.5 text-[11px] text-[#6B7280]">
                {item.step}
                {item.time ? ` · ${item.time}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onCloseDecided}
              aria-label="決めたことを閉じる"
              className="text-[16px] leading-none text-[#6B7280]"
            >
              ×
            </button>
          </div>
          <p className="mt-1 flex items-start gap-2 text-[12px] leading-5 text-[#4B5563]">
            <CheckIcon />
            <span>{model.decided}</span>
          </p>
        </div>
      ) : null}
      <p className="mt-4 text-[12px] text-[#6B7280]">{model.kicker}</p>
      <h2 className="mt-1 text-[22px] font-bold leading-7 text-[#111827]">{model.heading}</h2>
      <div className="mt-3 space-y-2">
        {model.paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-[14px] leading-6 text-[#1F2937]">
            {paragraph}
          </p>
        ))}
      </div>
      {model.points.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 rounded-2xl bg-[#F8F9FB] px-4 py-3 pl-8 text-[13px] leading-5 text-[#4B5563]">
          {model.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      {model.reason ? (
        <p className="mt-3 text-[12px] leading-5 text-[#2563EB]">推奨の理由: {model.reason}</p>
      ) : (
        <p className="mt-3 text-[12px] leading-5 text-[#6B7280]">
          根拠が足りないので、推奨は付けていません。
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {lead.map((choice) => (
          <ChoiceCard
            key={choice.id}
            choice={choice}
            selected={picked === choice.id}
            onSelect={() => onPick(choice.id)}
          />
        ))}
        {rest.map((choice) => (
          <div key={choice.id} className="col-span-2">
            <ChoiceCard
              choice={choice}
              selected={picked === choice.id}
              onSelect={() => onPick(choice.id)}
            />
          </div>
        ))}
      </div>
      <MemoField value={memo} onChange={onMemo} />
    </div>
  );
}

function NoteBody({
  note,
  memo,
  onMemo,
}: {
  note: Note;
  memo: string;
  onMemo: (value: string) => void;
}) {
  return (
    <div>
      <h2 className="text-[22px] font-bold leading-7 text-[#111827]">{note.heading}</h2>
      <div className="mt-3 space-y-2">
        {note.paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-[14px] leading-6 text-[#1F2937]">
            {paragraph}
          </p>
        ))}
      </div>
      {note.steps ? (
        <ul className="mt-3 list-disc space-y-1 rounded-2xl bg-[#F8F9FB] px-4 py-3 pl-8 text-[13px] leading-5 text-[#4B5563]">
          {note.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : null}
      <MemoField value={memo} onChange={onMemo} />
    </div>
  );
}

function InboxItemButton({
  item,
  selected,
  onSelect,
}: {
  item: Item;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={
        selected
          ? "w-full rounded-xl bg-white px-2 py-2 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          : "w-full rounded-xl px-2 py-2 text-left hover:bg-white/70"
      }
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold leading-5 text-[#1F2937]">{item.title}</span>
        {item.time ? (
          <span className="shrink-0 text-[11px] text-[#9CA3AF]">{item.time}</span>
        ) : null}
      </span>
      <span className="mt-0.5 block text-[11px] text-[#6B7280]">{item.step}</span>
      <span className="mt-1 flex items-start gap-2 border-l-2 border-[#2563EB] pl-2">
        {item.marker ? (
          <span className="text-[11px] font-semibold text-[#2563EB]">{item.marker}</span>
        ) : null}
        <span className="text-[12px] leading-4 text-[#4B5563]">{item.line}</span>
      </span>
      {item.badge ? (
        <span className="mt-1 inline-block rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#2563EB]">
          {item.badge}
        </span>
      ) : null}
    </button>
  );
}

export default function DecisionBoardExample() {
  const [mode, setMode] = useState<Mode>("design");
  const [tab, setTab] = useState<Tab>("now");
  const [selected, setSelected] = useState("q1");
  const [away, setAway] = useState(false);
  const [decidedOpen, setDecidedOpen] = useState(true);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [memos, setMemos] = useState<Record<string, string>>({});

  const items = itemsFor(mode).filter((item) => item.tab === tab);
  const current = items.find((item) => item.id === selected);
  const detail = current ? detailFor(mode, selected) : null;
  const memoKey = `${mode}:${selected}`;
  const pickKey = `${mode}:${selected}`;

  function changeMode(next: Mode) {
    setMode(next);
    setTab("now");
    setSelected(next === "design" ? "q1" : "cause");
    setDecidedOpen(true);
  }

  function changeTab(next: Tab) {
    const nextItems = itemsFor(mode).filter((item) => item.tab === next);
    setTab(next);
    setSelected((current) =>
      nextItems.some((item) => item.id === current) ? current : (nextItems[0]?.id ?? current),
    );
    setDecidedOpen(true);
  }

  function selectItem(id: string) {
    setSelected(id);
    setDecidedOpen(true);
  }

  const question = detail?.kind === "question" ? detail.question : null;
  const pickedId =
    question === null
      ? ""
      : (picked[pickKey] ??
        question.choices.find((choice) => choice.recommended)?.id ??
        question.choices[0]?.id ??
        "");

  const nowCount = itemsFor(mode).filter((item) => item.tab === "now").length;
  const tabs: { id: Tab; label: string }[] = [
    { id: "next", label: "次にやること" },
    { id: "now", label: `いまの作業 ${nowCount}` },
    { id: "done", label: "終わったこと" },
  ];

  return (
    <div
      className="min-h-screen bg-[#F3F4F6] p-3 text-[#1F2937]"
      style={{ fontFamily: '"Hiragino Sans", "Noto Sans JP", ui-sans-serif, sans-serif' }}
    >
      <div className="mx-auto mb-3 flex max-w-[1240px] flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] leading-5 text-[#6B7280]">
          {mode === "design"
            ? "見本データ。ファイル名はリポジトリにある。割合、経過、工程の分数は作り物。"
            : "見本の不具合。実在の故障ではない。ログはデータなし。ファイル名はリポジトリにある。"}
        </p>
        <div className="flex rounded-full bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {(
            [
              ["design", "設計の見本"],
              ["bug", "不具合の見本"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => changeMode(id)}
              aria-pressed={mode === id}
              className={
                mode === id
                  ? "rounded-full bg-[#2563EB] px-3 py-1 text-[12px] font-semibold text-white"
                  : "rounded-full px-3 py-1 text-[12px] text-[#4B5563]"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto flex h-[calc(100vh-64px)] max-w-[1240px] min-w-[1100px] gap-3">
        <aside className={`${PANEL} w-[280px] shrink-0`}>
          <div className="flex items-center justify-between px-4 pt-4">
            <h1 className="text-[15px] font-semibold">インボックス</h1>
            <button
              type="button"
              role="switch"
              aria-checked={away}
              onClick={() => setAway((value) => !value)}
              className="flex items-center gap-2 text-[12px] text-[#6B7280]"
            >
              離席
              <span
                className={
                  away
                    ? "relative h-5 w-9 rounded-full bg-[#2563EB]"
                    : "relative h-5 w-9 rounded-full bg-[#E5E7EB]"
                }
              >
                <span
                  className={
                    away
                      ? "absolute top-0.5 left-4 h-4 w-4 rounded-full bg-white"
                      : "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white"
                  }
                />
              </span>
            </button>
          </div>
          {away ? (
            <p className="px-4 pt-2 text-[11px] text-[#6B7280]">離席中。判断は変わりません。</p>
          ) : null}
          <div className="mx-3 mt-3 grid grid-cols-3 rounded-full bg-[#F3F4F6] p-1" role="tablist">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => changeTab(item.id)}
                className={
                  tab === item.id
                    ? "rounded-full bg-white px-1 py-1 text-[11px] font-semibold text-[#1F2937] shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                    : "rounded-full px-1 py-1 text-[11px] text-[#6B7280]"
                }
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 py-3">
            {items.length === 0 ? (
              <p className="px-2 text-[12px] text-[#6B7280]">このタブには、まだありません。</p>
            ) : null}
            {tab === "now"
              ? (["yours", "moving", "stuck"] as const).map((group) => {
                  const groupItems = items.filter((item) => item.group === group);
                  if (groupItems.length === 0) return null;
                  return (
                    <section
                      key={group}
                      className={group === "yours" ? "rounded-xl bg-[#E8F1FB] p-1" : "px-1"}
                    >
                      <h2
                        className={
                          group === "yours"
                            ? "px-2 py-1 text-[12px] font-semibold text-[#2563EB]"
                            : "px-2 py-1 text-[12px] font-semibold text-[#6B7280]"
                        }
                      >
                        {GROUP_LABEL[group]}
                      </h2>
                      <div className="space-y-1">
                        {groupItems.map((item) => (
                          <InboxItemButton
                            key={item.id}
                            item={item}
                            selected={item.id === selected}
                            onSelect={() => selectItem(item.id)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })
              : items.map((item) => (
                  <InboxItemButton
                    key={item.id}
                    item={item}
                    selected={item.id === selected}
                    onSelect={() => selectItem(item.id)}
                  />
                ))}
          </div>
        </aside>

        <main className={`${PANEL} min-w-0 flex-1`}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {current && detail?.kind === "question" && question ? (
              <QuestionBody
                item={current}
                model={question}
                picked={pickedId}
                onPick={(id) => setPicked((prev) => ({ ...prev, [pickKey]: id }))}
                decidedOpen={decidedOpen}
                onCloseDecided={() => setDecidedOpen(false)}
                memo={memos[memoKey] ?? ""}
                onMemo={(value) => setMemos((prev) => ({ ...prev, [memoKey]: value }))}
              />
            ) : current && detail && detail.kind !== "question" ? (
              <NoteBody
                note={detail.note}
                memo={memos[memoKey] ?? ""}
                onMemo={(value) => setMemos((prev) => ({ ...prev, [memoKey]: value }))}
              />
            ) : (
              <p className="text-[14px] leading-6 text-[#6B7280]">このタブには、まだありません。</p>
            )}
          </div>
        </main>

        {detail ? (
          <EvidenceColumn blocks={detail.evidence} />
        ) : (
          <EvidenceColumn
            blocks={[{ title: "根拠", paragraphs: ["このタブには項目がありません。"] }]}
          />
        )}
      </div>
    </div>
  );
}
