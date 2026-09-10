#!/usr/bin/env node
// PostToolUse / ConfigChange Hook — Agent 設定の構文・整合性検証
//
// 方針（docs/claude-code/improvement-cycle.md / memory機能改善 §7）:
// - 重要な制御は Command Hook で行う。LLM 判断が必要な部分は Agent（reflection / manager）に委ねる。
// - 強制度: 「構文エラーはブロック・方針違反は警告」
//     BLOCK(exit 2, stderr): 機械的に確実な誤り
//       - settings.json の JSON が不正
//       - Agent/Skill の YAML frontmatter が欠落 or 不正
//       - model 指定が公式形式でもエイリアス（sonnet / opus / inherit 等）でもない
//       - Agent 名が重複している
//     WARN(exit 0, additionalContext): 方針・整合性の注意（ロックアウト回避のためブロックしない）
//       - Agent() ツール権限を許可外 Agent が持つ（過剰権限の疑い）
//       - 参照先 Agent / Skill / Rule が存在しない
//       - Agent 名とファイル名の不一致
// - 構成変更の人間承認はフックでは行わない（PR レビューが担う）。
// - 監視対象外のファイルでは即 exit 0。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Agent() ツールの保持を許可する Agent（指揮・改善統括。IMP-2026-031 で reviewer から除去）
const AGENT_TOOL_ALLOWED = new Set(['orchestrator', 'agent-improvement-manager']);
// Claude Code 組み込み Agent（.claude/agents/ に定義ファイルが無い。存在チェックから除外）
const BUILTIN_AGENTS = new Set(['Explore']);
// 公式エイリアスと claude-<family>-... 形式。Cursor の inherit も含む。
const MODEL_ALIAS = new Set(['inherit', 'opus', 'sonnet', 'haiku', 'fable']);
const MODEL_FULL = /^claude-(opus|sonnet|haiku|fable)(-|$)/;
// 構成変更の承認境界は PR レビュー（フック内の人間承認層は撤去済み）

function isAllowedModel(model) {
  return MODEL_ALIAS.has(model) || MODEL_FULL.test(model);
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function toRel(filePath) {
  if (!filePath) return null;
  return filePath.startsWith(ROOT) ? filePath.slice(ROOT.length + 1) : filePath;
}

/** PostToolUse は tool_input.file_path。ConfigChange は file_path / source。 */
function resolveTargetRel(input) {
  const event = input.hook_event_name || 'PostToolUse';
  if (event === 'ConfigChange') {
    const fromField = toRel(input.file_path);
    if (fromField) return fromField;
    if (input.source === 'project_settings') return '.claude/settings.json';
    if (input.source === 'local_settings') return '.claude/settings.local.json';
    return null;
  }
  return toRel(input.tool_input?.file_path);
}

function isWatched(rel) {
  if (!rel) return false;
  return (
    rel === 'CLAUDE.md' ||
    rel === '.claude/settings.json' ||
    rel.startsWith('.claude/agents/') ||
    rel.startsWith('.claude/skills/') ||
    rel.startsWith('.claude/rules/')
  );
}

// frontmatter（先頭 --- ... --- ）を素朴に key: value で読む。
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return null; // 閉じが無い = 不正
  const fm = {};
  let lastKey = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) {
      lastKey = m[1];
      fm[lastKey] = m[2].trim();
    } else if (lastKey && /^\s+/.test(line)) {
      // 折り返し（> や複数行）の継続行は直前キーへ連結
      fm[lastKey] = (fm[lastKey] + ' ' + line.trim()).trim();
    }
  }
  return fm;
}

function listAgentNames() {
  const dir = join(ROOT, '.claude/agents');
  const names = new Map(); // name -> [files]
  if (!existsSync(dir)) return names;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const fm = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
      const name = fm?.name;
      if (!name) continue;
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(f);
    } catch {
      // 読めないファイルは無視
    }
  }
  return names;
}

function isSkillFile(rel) {
  return /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(rel);
}

function collectHookCommands(settings) {
  const commands = [];
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== 'object') return commands;
  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const hook of entry?.hooks || []) {
        if (hook?.command) commands.push(String(hook.command));
      }
    }
  }
  return commands;
}

function missingHookPaths(settings) {
  const missing = [];
  const seen = new Set();
  for (const cmd of collectHookCommands(settings)) {
    const re = /\$CLAUDE_PROJECT_DIR\/([^"'\s]+)/g;
    let m;
    while ((m = re.exec(cmd))) {
      const relPath = m[1];
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      if (!existsSync(join(ROOT, relPath))) missing.push(relPath);
    }
  }
  return missing;
}

function referencedAgents(toolsValue) {
  // 例: "Agent(architecture-designer, implementer, Explore), Read, Grep"
  const refs = [];
  const m = toolsValue.match(/Agent\(([^)]*)\)/);
  if (m && m[1].trim()) {
    for (const r of m[1].split(',')) {
      const n = r.trim();
      if (n) refs.push(n);
    }
  }
  return refs;
}

function blockExit(reasons) {
  process.stderr.write(
    '⛔ Agent 設定の検証エラー（構文・整合性）— 修正してください:\n' +
      reasons.map((r) => ` - ${r}`).join('\n') +
      '\n',
  );
  process.exit(2);
}

function warnExit(warnings, hookEventName = 'PostToolUse') {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
        additionalContext:
          '⚠ Agent 設定の注意（方針・整合性。ブロックはしません）:\n' +
          warnings.map((w) => ` - ${w}`).join('\n'),
      },
    }),
  );
  process.exit(0);
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    process.exit(0);
  }

  const eventName = input.hook_event_name || 'PostToolUse';
  const rel = resolveTargetRel(input);
  if (!isWatched(rel)) process.exit(0);

  const blocks = [];
  const warns = [];
  const abs = join(ROOT, rel);

  let text = '';
  try {
    text = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  } catch {
    process.exit(0);
  }

  // settings.json: JSON 妥当性 + フック参照先の実在
  if (rel === '.claude/settings.json') {
    try {
      const settings = JSON.parse(text);
      for (const p of missingHookPaths(settings)) {
        blocks.push(`.claude/settings.json: フック参照先が存在しません: ${p}`);
      }
    } catch (e) {
      blocks.push(`.claude/settings.json の JSON が不正: ${String(e.message || e)}`);
    }
  }

  // Agent / Skill の frontmatter 検証（スキルは SKILL.md のみ。補助 .md は対象外）
  const isAgent = rel.startsWith('.claude/agents/') && rel.endsWith('.md');
  const isSkill = isSkillFile(rel);

  if (isAgent || isSkill) {
    const fm = parseFrontmatter(text);
    if (!fm) {
      blocks.push(`${rel}: YAML frontmatter が欠落または閉じられていません（先頭の --- ... ---）`);
    } else {
      if (!fm.name) blocks.push(`${rel}: frontmatter に name がありません`);
      if (isSkill && !fm.description) warns.push(`${rel}: Skill に description がありません`);

      if (isAgent) {
        // model 形式（公式エイリアスと claude-<family>-... を許可）
        if (fm.model && !isAllowedModel(fm.model)) {
          blocks.push(
            `${rel}: model 指定が不正（inherit / opus / sonnet / haiku / fable または claude-<family>-...）: "${fm.model}"`,
          );
        }
        if (!fm.model) warns.push(`${rel}: model 指定がありません`);

        // name とファイル名の一致
        const fileBase = basename(rel).replace(/\.md$/, '');
        if (fm.name && fm.name !== fileBase) {
          warns.push(`${rel}: name "${fm.name}" がファイル名 "${fileBase}" と一致しません`);
        }

        // 名前の重複
        const names = listAgentNames();
        if (fm.name && (names.get(fm.name)?.length || 0) > 1) {
          blocks.push(`Agent 名 "${fm.name}" が重複: ${names.get(fm.name).join(', ')}`);
        }

        // tools: Agent() 権限と参照先
        if (fm.tools) {
          const refs = referencedAgents(fm.tools);
          if (refs.length > 0 && fm.name && !AGENT_TOOL_ALLOWED.has(fm.name)) {
            warns.push(
              `${rel}: Agent() ツールは ${[...AGENT_TOOL_ALLOWED].join(' / ')} のみ想定（過剰権限の疑い）`,
            );
          }
          for (const r of refs) {
            if (BUILTIN_AGENTS.has(r)) continue;
            if (!existsSync(join(ROOT, `.claude/agents/${r}.md`))) {
              warns.push(`${rel}: 参照先 Agent が存在しません: ${r}`);
            }
          }
        }
      }
    }
  }


  if (blocks.length) blockExit(blocks);
  if (warns.length) warnExit(warns, eventName);
  process.exit(0);
}

main();
