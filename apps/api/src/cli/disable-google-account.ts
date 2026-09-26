// 利用停止 CLI（管理者端末専用）。allowlist.enabled = false と全セッション削除を 1 トランザクションで行う。
// 使い方: MIGRATION_DATABASE_URL を設定し、npm run cli:disable -w @tomotabi/api -- --slot 0
import { disableGoogleAccount } from "./disable/disable-google-account";
import { ConsoleIo } from "./shared/console-io";
import { runCli } from "./shared/run-cli";
import { parseSlot } from "./shared/slot";

void runCli(async (pool) => {
  const slot = parseSlot(process.argv.slice(2));
  const result = await disableGoogleAccount(pool, slot);
  new ConsoleIo().print(
    `slot ${slot} を利用停止にしました。user_id: ${result.userId}、削除したセッション: ${result.deletedSessions} 件`,
  );
}).then((exitCode) => {
  process.exitCode = exitCode;
});
