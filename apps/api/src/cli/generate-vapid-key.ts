// VAPIDの鍵を作るCLI（管理者端末専用）。NestのAppModuleとHTTPルートには登録しない。
// 秘密鍵は標準出力・ログに出さず、権限600のファイルに書く。
// 使い方: npm run cli:generate-vapid-key -w @tomotabi/api -- --out ./vapid-key.json [--key-id 2026-10]
import { ConsoleIo } from "./shared/console-io";
import { CliUsageError } from "./shared/slot";
import { runGenerateVapidKey } from "./vapid/generate-vapid-key";

try {
  process.exitCode = runGenerateVapidKey(process.argv.slice(2), new ConsoleIo());
} catch (error) {
  if (error instanceof CliUsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write("予期しないエラーが発生しました\n");
    process.exitCode = 1;
  }
}
