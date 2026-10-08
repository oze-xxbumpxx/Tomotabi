// VAPIDの鍵を作るCLI。VAPID_KEYSに足す1要素のJSONを0600のファイルに書く。
// 秘密鍵は標準出力に出さない。使い方: npm run cli:generate-vapid-key -w @tomotabi/api -- <出力ファイル> [--key-id <ID>]
import { ConsoleIo } from "./shared/console-io";
import { describeFailure } from "./shared/run-cli";
import { CliUsageError } from "./shared/slot";
import { runGenerateVapidKey } from "./vapid/generate-vapid-key";

try {
  runGenerateVapidKey(process.argv.slice(2), new ConsoleIo());
  process.exitCode = 0;
} catch (error) {
  process.stderr.write(`${describeFailure(error)}\n`);
  process.exitCode = error instanceof CliUsageError ? 2 : 1;
}
