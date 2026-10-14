// 利用停止CLI（管理者端末専用）。allowlist.enabled = falseと全セッション削除を1トランザクションで行う。
// 使い方: MIGRATION_DATABASE_URLを設定し、npm run cli:disable -w @tomotabi/api -- --slot 0
import { disableGoogleAccount } from "./disable/disable-google-account.js";
import { ConsoleIo } from "./shared/console-io.js";
import { runCli } from "./shared/run-cli.js";
import { parseSlot } from "./shared/slot.js";

void runCli(async (pool) => {
  const slot = parseSlot(process.argv.slice(2));
  const result = await disableGoogleAccount(pool, slot);
  new ConsoleIo().print(
    `slot ${slot} を利用停止にしました。user_id: ${result.userId}、削除したセッション: ${result.deletedSessions} 件`,
  );
}).then((exitCode) => {
  process.exitCode = exitCode;
});
