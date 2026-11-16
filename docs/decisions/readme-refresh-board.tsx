/**
 * READMEを最新にするときの判断画面。
 * 書き方は .claude/skills/decision-board/SKILL.md。
 * README.md はまだ変えていない。推奨は決定ではない。
 */
import { useState } from "react";

type Tab = "next" | "now" | "done";
type Group = "yours" | "moving" | "stuck";

type Item = {
  id: string;
  tab: Tab;
  group: Group;
  title: string;
  step: string;
  marker: string;
  line: string;
  tone: "question" | "note";
};

type Choice = {
  id: string;
  letter: string;
  title: string;
  summary: string;
  tradeoff: string;
  sketch: string[];
  recommended?: boolean;
};

type Question = {
  kicker: string;
  heading: string;
  paragraphs: string[];
  points: string[];
  reason: string;
  choices: Choice[];
};

type Note = {
  heading: string;
  paragraphs: string[];
};

type EvidenceBlock = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type Detail =
  | { kind: "question"; question: Question; evidence: EvidenceBlock[] }
  | { kind: "note"; note: Note; evidence: EvidenceBlock[] };

const GROUP_LABEL: Record<Group, string> = {
  yours: "あなたの番",
  moving: "動いている",
  stuck: "止まっている",
};

const PANEL =
  "flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] border border-[#E6E8EC] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const ITEMS: Item[] = [
  {
    id: "reader",
    tab: "now",
    group: "yours",
    title: "READMEの読み手",
    step: "いま：読み手",
    marker: "Q1",
    line: "誰が読む前提で直す？",
    tone: "question",
  },
  {
    id: "snapshot",
    tab: "now",
    group: "yours",
    title: "検証の表",
    step: "いま：検証の表",
    marker: "Q2",
    line: "2026-09-11の表を残す？",
    tone: "question",
  },
  {
    id: "harness",
    tab: "now",
    group: "yours",
    title: "作業の進め方",
    step: "いま：ハーネス",
    marker: "Q3",
    line: ".claudeをREADMEに書く？",
    tone: "question",
  },
  {
    id: "fresh",
    tab: "now",
    group: "yours",
    title: "版と件数の古さ",
    step: "いま：古くしない方法",
    marker: "Q4",
    line: "数字をどう保つ？",
    tone: "question",
  },
  {
    id: "rewrite",
    tab: "now",
    group: "stuck",
    title: "READMEの本文",
    step: "いま：本文は未着手",
    marker: "",
    line: "判断が出るまで止める",
    tone: "note",
  },
  {
    id: "checked",
    tab: "done",
    group: "yours",
    title: "READMEと実体の差",
    step: "いま：確認済み",
    marker: "",
    line: "READMEはまだ直していない",
    tone: "note",
  },
];

const DETAILS: Record<string, Detail> = {
  reader: {
    kind: "question",
    question: {
      kicker: "Q1 · READMEを最新にする",
      heading: "READMEは、誰が読む前提で直す？",
      paragraphs: [
        "README.mdは、二人向けの旅行アプリだと書き、ログインから通知までできていて、本番はまだ、と続けています。",
        "同じファイルに、起動手順、2026-09-11の検証の表、依存の版、残作業が並んでいます。",
        "誰が読むかで、残す節が変わります。開発の進め方はAGENTS.mdにあります。",
      ],
      points: [
        "読み手が決まらないと、古い検証の表を残すかも決まりません。",
        "本番への公開は、READMEの冒頭ではまだです。",
        "ToDoの画面や、ログインに要る環境変数は、本文にありません。",
      ],
      reason: "本番はまだで、いま読むのは手を動かす人だからです。",
      choices: [
        {
          id: "a",
          letter: "A",
          title: "手を動かす人向け",
          summary: "起動の手順と、いま動く範囲を短く書きます。",
          tradeoff: "製品の紹介としては短くなります。",
          sketch: ["# Tomotabi", "起動の手順", "いま動く範囲", "詳細はAGENTS.md"],
          recommended: true,
        },
        {
          id: "b",
          letter: "B",
          title: "いまの作業メモ",
          summary: "検証の日付と残作業も、このファイルに残します。",
          tradeoff: "日付の表は、次の変更でまた古くなります。",
          sketch: ["# Tomotabi", "検証結果 2026-09-11", "依存の版", "残課題"],
        },
        {
          id: "c",
          letter: "C",
          title: "外に見せる説明",
          summary: "何のアプリかを主にし、コマンドは別の文書へ移します。",
          tradeoff: "クローンした人は、起動手順をREADMEで見つけられません。",
          sketch: ["# Tomotabi", "二人の旅行アプリ", "（コマンドは別）"],
        },
      ],
    },
    evidence: [
      {
        title: "何が問題か",
        paragraphs: [
          "出所はREADME.mdと、下に書いた開いたファイルです。試験のいまの合格件数はデータなし。",
        ],
        bullets: [
          "「検証結果（2026-09-11）」は、PlaywrightのE2Eを未作成と書いています。e2e/tests/には仕様ファイルが9つあります。",
          "同じ表のweb 5件、api 13件、ハーネス88件は、その日付の記録です。今回は試験を回していません。",
          "できることにToDoがありません。画面はapps/web/src/screens/todos/todos-screen.tsxです。",
          "ディレクトリ図にe2e/、docs/、.claude/がありません。",
          "ログインに要る環境変数が本文にありません。.env.exampleとbetter-auth.tsにはあります。",
        ],
      },
      {
        title: "選択肢の比較",
        bullets: [
          "Aは起動手順を残し、詳細はAGENTS.mdへ寄せます。",
          "Bは検証の表と残課題をREADMEに残します。",
          "Cは説明を主にし、コマンドをREADMEから外します。",
        ],
      },
      {
        title: "見た実物",
        bullets: [
          "README.mdの冒頭と、AGENTS.mdの「現在の状態」は、本番はまだ、までほぼ同じ文です。",
          "workspacesはpackage.jsonでapps/web、apps/api、packages/contracts、e2eです。",
          "docs/にはdecisions、requirements、designs、tests、runbooks、glossary.mdがあります。",
          ".claude/にはskills、agents、hooks、rules、scripts、testsがあります。",
        ],
      },
    ],
  },
  snapshot: {
    kind: "question",
    question: {
      kicker: "Q2 · READMEを最新にする",
      heading: "2026-09-11の検証の表を、READMEに残す？",
      paragraphs: [
        "「検証結果（2026-09-11）」は、画面の単体が5件、APIが13件、E2Eは未作成、と書いています。",
        "e2e/scripts/run.mjsは、npx playwright testを絞り込みなしで起動します。READMEの説明は、M-01を流す、だけです。",
        "依存の版の表も、package-lock.jsonと違っています。試験は今回回していないので、いまの合格件数はデータなしです。",
      ],
      points: [
        "表の日付は2026-09-11です。",
        "E2E未作成は、いまのe2e/tests/と矛盾します。",
        "件数を書き換えても、次の変更でまたずれます。",
      ],
      reason: "件数は未実行でデータなしであり、表を残すとまた古くなるからです。",
      choices: [
        {
          id: "a",
          letter: "A",
          title: "表を外す",
          summary: "検証の表と版の表をREADMEから外し、lockfileとCIを見ます。",
          tradeoff: "過去に何が通ったかは、このファイルからは辿れません。",
          sketch: ["README", "起動の手順だけ", "件数の表は無し"],
          recommended: true,
        },
        {
          id: "b",
          letter: "B",
          title: "数字を更新して残す",
          summary: "日付を更新し、表の形は残します。",
          tradeoff: "試験を回さないと件数は書けません。書いたあとも古くなります。",
          sketch: ["検証結果（新しい日付）", "件数は未実行", "データなし"],
        },
        {
          id: "c",
          letter: "C",
          title: "試験の文書へ移す",
          summary: "docs/tests/に置き、READMEはリンクだけにします。",
          tradeoff: "どの文書を正にするかは、別途そろえる必要があります。",
          sketch: ["README → リンク", "docs/tests/", "記録はそちら"],
        },
      ],
    },
    evidence: [
      {
        title: "何が問題か",
        paragraphs: [
          "各項目は、README.mdの表の数字、その次がpackage-lock.jsonのversionです。",
        ],
        bullets: [
          "nextは16.3.4と16.4.3。reactとreact-domは19.3.0と19.3.1。",
          "@nestjs/core、common、platform-express、testingは11.2.3と11.2.8。",
          "drizzle-ormは0.45.2と0.45.4。pgは8.23.0と8.23.1。vitestは3.2.7と4.1.12。",
          "orvalは8.36.0と8.45.0。zodは4.6.5と4.6.7。@testcontainers/postgresqlは11.14.0と12.2.1。",
          "一致したのはtypescript 5.9.3、neverthrow 8.2.0、eslint 9.39.5です。",
        ],
      },
      {
        title: "選択肢の比較",
        bullets: [
          "Aは表をやめ、lockfileとCIを正にします。",
          "Bは表を残して数字を取り直します。いまの件数はデータなしです。",
          "Cはdocs/tests/へ移します。移し先のどれを正にするかは未確認です。",
        ],
      },
      {
        title: "見た実物",
        bullets: [
          "e2e/tests/はm01-flow、m02-two-people、m03-selected-trip、m04-unknown-result、notifications、payment-and-settlement、records-and-home、todo、unknown-paymentの9ファイルです。",
          "e2e/playwright.config.tsのtestDirは./tests、browserNameはchromiumです。",
          "確認環境の先頭はNode 22.23.2です。.nvmrcと.node-versionは24、enginesは>=24.0.0 <25です。",
          "postgres:16-alpineはe2e/scripts/run.mjsで使っています。2026-09-12の起動確認は、今回は再実行していません。",
        ],
      },
    ],
  },
  harness: {
    kind: "question",
    question: {
      kicker: "Q3 · READMEを最新にする",
      heading: "作業の進め方を、READMEに書く？",
      paragraphs: [
        "READMEはnpm run test:harnessと、2026-09-11時点のハーネス88件だけを書いています。",
        ".claude/には、スキル、フック、エージェント、試験があります。開発ルールの説明はAGENTS.mdとCLAUDE.mdです。",
        "READMEのディレクトリ図に.claude/はありません。88件を今回数え直してはいません。いまの件数はデータなしです。",
      ],
      points: [
        "手順の説明は、すでにAGENTS.mdにあります。",
        "READMEに写すと、同じ説明が二か所になります。",
        "READMEだけ見た人は、ハーネスの置き場所が分かりません。",
      ],
      reason: "手順の正はAGENTS.mdにあり、READMEに写すと二重になるからです。",
      choices: [
        {
          id: "a",
          letter: "A",
          title: "コマンドとリンクだけ",
          summary: "test:harnessと、AGENTS.mdへのリンクだけをREADMEに残します。",
          tradeoff: "スキルの一覧は、READMEを見ても分かりません。",
          sketch: ["npm run test:harness", "詳細はAGENTS.md"],
          recommended: true,
        },
        {
          id: "b",
          letter: "B",
          title: "置き場所まで書く",
          summary: "スキル、フック、試験のフォルダをREADMEの図に足します。",
          tradeoff: "AGENTS.mdと二重になり、片方だけ古くなります。",
          sketch: [".claude/skills", ".claude/hooks", ".claude/tests"],
        },
        {
          id: "c",
          letter: "C",
          title: "READMEには書かない",
          summary: "ハーネスの説明はAGENTS.mdだけにします。",
          tradeoff: "READMEだけ見た人は、試験コマンドに気づきません。",
          sketch: ["READMEには無し", "AGENTS.mdだけ"],
        },
      ],
    },
    evidence: [
      {
        title: "何が問題か",
        paragraphs: [
          "READMEのディレクトリ図と、開いた.claude/の中身が対応していません。件数の再計測はデータなしです。",
        ],
        bullets: [
          "READMEにあるのはnpm run test:harnessと、2026-09-11の88件です。",
          "package.jsonのtest:harnessはnode --test .claude/tests/*.test.mjsです。",
          ".claude/skills/decision-board/SKILL.mdは、この画面の手順です。",
        ],
      },
      {
        title: "選択肢の比較",
        bullets: [
          "AはコマンドとAGENTS.mdへのリンクだけです。",
          "Bは.claude/のフォルダをREADMEの図に書きます。",
          "CはREADMEからハーネスの記述を外します。",
        ],
      },
      {
        title: "見た実物",
        bullets: [
          "開いたフォルダは.claude/skills、agents、hooks、rules、scripts、tests、evalsです。",
          "agentsはreviewer.mdとsecurity-reviewer.mdです。",
          "AGENTS.mdが、作業分担、ブランチ、品質コマンドを書いています。",
          "CLAUDE.mdはAGENTS.mdを指しています。",
        ],
      },
    ],
  },
  fresh: {
    kind: "question",
    question: {
      kicker: "Q4 · READMEを最新にする",
      heading: "版や試験の件数を、どうやって古くしない？",
      paragraphs: [
        "READMEの版の表は、package-lock.jsonと違っています。",
        "たとえばnextは、READMEが16.3.4、lockfileが16.4.3です。vitestは、READMEが3.2.7、lockfileが4.1.12です。",
        "READMEの数字を検査するスクリプトは、ルートのpackage.jsonと.claude/scripts/にはありませんでした。",
      ],
      points: [
        "数字を書くと、lockfileが動いたときにずれます。",
        "検査は、いまは無いので新しく作ることになります。",
        "文章の言い回しまで検査すると、直す範囲が広がります。",
      ],
      reason: "検査は無く、版の表はすでにlockfileと違っているからです。",
      choices: [
        {
          id: "a",
          letter: "A",
          title: "数字を書かない",
          summary: "版と件数はREADMEに置かず、lockfileとコマンドの結果を見ます。",
          tradeoff: "READMEだけでは、いま入っている版が分かりません。",
          sketch: ["READMEに版は無し", "見る場所は", "package-lock.json"],
          recommended: true,
        },
        {
          id: "b",
          letter: "B",
          title: "人が気づいたときに直す",
          summary: "表は残し、更新の仕組みは足しません。",
          tradeoff: "今回と同じずれが、また起きます。",
          sketch: ["版の表を残す", "直す時期は未定"],
        },
        {
          id: "c",
          letter: "C",
          title: "差分を見る検査を足す",
          summary: "READMEに書いた版がlockfileと違うと失敗する検査を、新しく作ります。",
          tradeoff: "対象を決めないと、文章の言い回しまで落ちます。",
          sketch: ["新しい検査", "対象は未定", "いまは未確認"],
        },
      ],
    },
    evidence: [
      {
        title: "何が問題か",
        paragraphs: [
          "数字の出所はREADME.mdとpackage-lock.jsonです。READMEを検査する既存のコマンドは見つかっていません。",
        ],
        bullets: [
          "nextは16.3.4と16.4.3。vitestは3.2.7と4.1.12。差の一覧はQ2の根拠と同じです。",
          "ルートのscriptsに、READMEを見る名前はありません。あるのはdev、build、lint、type-check、test、api:check、db:checkなどです。",
          "api:checkは生成コードの差分、db:checkはmigrationの差分を見ます。READMEは見ていません。",
        ],
      },
      {
        title: "選択肢の比較",
        bullets: [
          "AはREADMEに版と件数を書きません。",
          "Bは表を残し、更新は人の気づき待ちです。",
          "Cは新しい検査です。検査の中身はまだ無く、未確認です。",
        ],
      },
      {
        title: "見た実物",
        bullets: [
          ".claude/scripts/を一覧し、READMEの版を比べるファイルはありませんでした。",
          "見た名前はdiscussion.mjs、run-quality-gates.sh、delegation.mjs、wait-for-pr.mjsなどです。",
          "品質コマンドの実体は.claude/scripts/run-quality-gates.shです。READMEの文言は対象外です。",
        ],
      },
    ],
  },
  rewrite: {
    kind: "note",
    note: {
      heading: "READMEの本文は、まだ直しません",
      paragraphs: [
        "読み手、検証の表、ハーネスの書き方、数字の保ち方が決まるまで、README.mdは変えません。",
        "この画面の推奨は、決定ではありません。選ぶのは人です。",
      ],
    },
    evidence: [
      {
        title: "何が問題か",
        paragraphs: [
          "本文を先に書くと、読み手の判断と違う形になります。README.mdの差分はまだありません。",
        ],
      },
      {
        title: "見た実物",
        bullets: [
          "この変更で触る予定だったREADME.mdは、開いただけで内容を変えていません。",
          "判断の画面はdocs/decisions/readme-refresh-board.tsxです。",
        ],
      },
    ],
  },
  checked: {
    kind: "note",
    note: {
      heading: "開いたファイルとの差は、ここに集約しました",
      paragraphs: [
        "起動コマンドの多く、CIのジョブ名、スキーマ6つ、APIのモジュール名は、開いたファイルと一致していました。",
        "ずれていたのは、2026-09-11の検証、依存の版、できることの不足、ディレクトリ図、環境変数、ハーネスの説明です。",
        "試験の再実行はしていません。いまの合格件数はデータなしです。",
      ],
    },
    evidence: [
      {
        title: "何が問題か",
        bullets: [
          "一致: apps/web/srcのapp、screens、features、shared。apps/api/src/modulesのidentity、planning、record、settlement、notification、foundation。",
          "一致: schemaはidentity、planning、record、settlement、notification、infraの6ファイルです。",
          "一致: .github/workflows/ci.ymlのquality、build、harness、api-dbと、e2e.ymlです。",
          "AdapterはIFです。push-sender.tsはinterfaceで、apps/api/src/adapter/transaction/があります。",
        ],
      },
      {
        title: "見た実物",
        bullets: [
          "DATABASE_URLが無いとき、in-memoryなのはfoundationの検証カウンタです。better-auth.tsはauthを作らず、経路は503です。",
          "cli:generate-vapid-keyはapps/api/package.jsonにあります。READMEの管理CLIはenrollとdisableだけです。",
          "E2Eの待受はe2e/scripts/run.mjsで3100と3101です。manual:pushは3000と3001で、READMEの説明と一致します。",
          "docs/tests/integration-env.mdのIE-01からIE-15には結果があります。IE-13は一部合格です。final-acceptance.mdの2行は「まだ」です。",
          "Actionsはactions/checkout@v5などタグのままです。SHA固定の残課題は、まだ当たっています。",
          "m0_probesはapps/api/src/infrastructure/database/sql/m0_probe.sqlにあり、apps/api/drizzleのSQLにはありませんでした。",
          "ルートのpackage.jsonにはbuild:web、build:api、test:web、test:apiがあります。READMEのコマンド一覧にはありません。",
          "api:checkはapps/web/src/shared/api/generatedとapps/api/src/generatedの両方を見ます。READMEの生成先はwebだけです。",
          ".env.exampleにはAPI_ORIGIN、PUBLIC_APP_ORIGIN、BETTER_AUTH_SECRET、GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、VAPID_KEYS、VAPID_SUBJECT、PORTがあります。READMEが手順に書くのはDATABASE_URL、MIGRATION_DATABASE_URL、ENROLLの2つです。",
          "apps/web/package.jsonにはbetter-authと@tanstack/react-queryがあります。READMEの採用構成の表にはありません。",
        ],
      },
    ],
  },
};

function Sketch({ lines }: { lines: string[] }) {
  return (
    <span className="mt-2 block rounded-xl border border-[#E6E8EC] bg-[#F3F4F6] px-3 py-2">
      {lines.map((line) => (
        <span key={line} className="block text-[12px] leading-5 text-[#1F2937]">
          {line}
        </span>
      ))}
    </span>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      className={
        on
          ? "grid h-4 w-4 shrink-0 place-items-center rounded-full border border-[#2563EB]"
          : "h-4 w-4 shrink-0 rounded-full border border-[#E6E8EC]"
      }
    >
      {on ? <span className="h-2 w-2 rounded-full bg-[#2563EB]" /> : null}
    </span>
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
            {block.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-[12px] leading-5 text-[#6B7280]">
                {paragraph}
              </p>
            ))}
            {block.bullets ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] leading-5 text-[#6B7280]">
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
        className="w-full rounded-full border border-[#E6E8EC] bg-white px-4 py-2 text-[14px] text-[#1F2937] outline-none placeholder:text-[#6B7280] focus:border-[#2563EB]"
      />
    </form>
  );
}

function ChoiceCard({
  choice,
  reason,
  selected,
  onSelect,
}: {
  choice: Choice;
  reason: string;
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
          ? "w-full rounded-2xl border border-[#2563EB] bg-white p-4 text-left"
          : "w-full rounded-2xl border border-[#E6E8EC] bg-[#F3F4F6] p-4 text-left"
      }
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-[#1F2937]">{choice.letter}</span>
          <span className="text-[14px] font-semibold text-[#1F2937]">{choice.title}</span>
          {choice.recommended ? (
            <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">
              推奨
            </span>
          ) : null}
        </span>
        <Radio on={selected} />
      </span>
      <span className="mt-1 block text-[14px] leading-6 text-[#1F2937]">{choice.summary}</span>
      <span className="mt-0.5 block text-[12px] leading-5 text-[#6B7280]">{choice.tradeoff}</span>
      {choice.recommended ? (
        <span className="mt-1 block text-[12px] leading-5 text-[#2563EB]">推奨の理由: {reason}</span>
      ) : null}
      <Sketch lines={choice.sketch} />
    </button>
  );
}

function QuestionBody({
  model,
  picked,
  onPick,
  open,
  onClose,
  memo,
  onMemo,
}: {
  model: Question;
  picked: string;
  onPick: (id: string) => void;
  open: boolean;
  onClose: () => void;
  memo: string;
  onMemo: (value: string) => void;
}) {
  const lead = model.choices.slice(0, 2);
  const rest = model.choices.slice(2);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] text-[#6B7280]">{model.kicker}</p>
          <h2 className="mt-1 text-[22px] font-bold leading-7 text-[#1F2937]">{model.heading}</h2>
        </div>
        {open ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="問いを閉じる"
            className="text-[16px] leading-none text-[#6B7280]"
          >
            ×
          </button>
        ) : null}
      </div>
      {open ? null : (
        <p className="mt-3 text-[14px] leading-6 text-[#6B7280]">
          閉じています。左の一覧から開き直せます。
        </p>
      )}
      {open ? (
        <>
          <div className="mt-3 space-y-2">
            {model.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-[14px] leading-6 text-[#1F2937]">
                {paragraph}
              </p>
            ))}
          </div>
          <ul className="mt-3 list-disc space-y-1 rounded-2xl bg-[#F3F4F6] px-4 py-3 pl-8 text-[14px] leading-6 text-[#1F2937]">
            {model.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {lead.map((choice) => (
              <ChoiceCard
                key={choice.id}
                choice={choice}
                reason={model.reason}
                selected={picked === choice.id}
                onSelect={() => onPick(choice.id)}
              />
            ))}
            {rest.map((choice) => (
              <div key={choice.id} className="col-span-2">
                <ChoiceCard
                  choice={choice}
                  reason={model.reason}
                  selected={picked === choice.id}
                  onSelect={() => onPick(choice.id)}
                />
              </div>
            ))}
          </div>
          <MemoField value={memo} onChange={onMemo} />
        </>
      ) : null}
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
      <h2 className="text-[22px] font-bold leading-7 text-[#1F2937]">{note.heading}</h2>
      <div className="mt-3 space-y-2">
        {note.paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-[14px] leading-6 text-[#1F2937]">
            {paragraph}
          </p>
        ))}
      </div>
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
          : "w-full rounded-xl px-2 py-2 text-left"
      }
    >
      <span className="block text-[14px] font-semibold leading-5 text-[#1F2937]">{item.title}</span>
      <span className="mt-0.5 block text-[12px] text-[#6B7280]">{item.step}</span>
      <span className="mt-1 flex items-start gap-2 border-l-2 border-[#2563EB] pl-2">
        {item.marker ? (
          <span className="text-[11px] font-semibold text-[#2563EB]">{item.marker}</span>
        ) : null}
        <span className="text-[12px] leading-4 text-[#1F2937]">{item.line}</span>
      </span>
    </button>
  );
}

export default function ReadmeRefreshBoard() {
  const [tab, setTab] = useState<Tab>("now");
  const [selected, setSelected] = useState("reader");
  const [away, setAway] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [memos, setMemos] = useState<Record<string, string>>({});

  const visible = ITEMS.filter((item) => item.tab === tab);
  const current = visible.find((item) => item.id === selected) ?? visible[0];
  const detail = current ? DETAILS[current.id] : undefined;
  const question = detail?.kind === "question" ? detail.question : null;
  const pickedId =
    question === null
      ? ""
      : (picked[current?.id ?? ""] ??
        question.choices.find((choice) => choice.recommended)?.id ??
        question.choices[0]?.id ??
        "");
  const nowCount = ITEMS.filter((item) => item.tab === "now").length;
  const tabs: { id: Tab; label: string }[] = [
    { id: "next", label: "次にやること" },
    { id: "now", label: `いまの作業 ${nowCount}` },
    { id: "done", label: "終わったこと" },
  ];

  function selectTab(next: Tab) {
    const nextItems = ITEMS.filter((item) => item.tab === next);
    const nextId = nextItems.some((item) => item.id === selected)
      ? selected
      : (nextItems[0]?.id ?? selected);
    setTab(next);
    setSelected(nextId);
    setClosed((prev) => ({ ...prev, [nextId]: false }));
  }

  function selectItem(id: string) {
    setSelected(id);
    setClosed((prev) => ({ ...prev, [id]: false }));
  }

  return (
    <div
      className="min-h-screen bg-[#F3F4F6] p-3 text-[#1F2937]"
      style={{
        fontFamily:
          '"Hiragino Sans", ui-sans-serif, "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif',
      }}
    >
      <div className="mx-auto flex h-[calc(100vh-24px)] min-w-[1100px] max-w-[1240px] gap-3">
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
                    : "relative h-5 w-9 rounded-full bg-[#E6E8EC]"
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
            <p className="px-4 pt-2 text-[12px] text-[#6B7280]">離席中。判断は変わりません。</p>
          ) : null}
          <div className="mx-3 mt-3 grid grid-cols-3 rounded-full bg-[#F3F4F6] p-1" role="tablist">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => selectTab(item.id)}
                className={
                  tab === item.id
                    ? "rounded-full bg-white px-1 py-1 text-[11px] font-semibold text-[#1F2937] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                    : "rounded-full px-1 py-1 text-[11px] text-[#6B7280]"
                }
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 py-3">
            {visible.length === 0 ? (
              <p className="px-2 text-[12px] text-[#6B7280]">このタブには、まだありません。</p>
            ) : null}
            {tab === "now"
              ? (["yours", "moving", "stuck"] as const).map((group) => {
                  const groupItems = visible.filter((item) => item.group === group);
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
                            selected={item.id === current?.id}
                            onSelect={() => selectItem(item.id)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })
              : visible.map((item) => (
                  <InboxItemButton
                    key={item.id}
                    item={item}
                    selected={item.id === current?.id}
                    onSelect={() => selectItem(item.id)}
                  />
                ))}
          </div>
        </aside>

        <main className={`${PANEL} min-w-0 flex-1`}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {current && detail?.kind === "question" && question ? (
              <QuestionBody
                model={question}
                picked={pickedId}
                onPick={(id) => setPicked((prev) => ({ ...prev, [current.id]: id }))}
                open={closed[current.id] !== true}
                onClose={() => setClosed((prev) => ({ ...prev, [current.id]: true }))}
                memo={memos[current.id] ?? ""}
                onMemo={(value) => setMemos((prev) => ({ ...prev, [current.id]: value }))}
              />
            ) : current && detail?.kind === "note" ? (
              <NoteBody
                note={detail.note}
                memo={memos[current.id] ?? ""}
                onMemo={(value) => setMemos((prev) => ({ ...prev, [current.id]: value }))}
              />
            ) : (
              <p className="text-[14px] leading-6 text-[#6B7280]">このタブには、まだありません。</p>
            )}
          </div>
        </main>

        <EvidenceColumn blocks={detail?.evidence ?? [{ title: "根拠", paragraphs: ["このタブには項目がありません。"] }]} />
      </div>
    </div>
  );
}
