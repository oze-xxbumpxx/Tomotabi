// 初期登録CLI（管理者端末専用）。NestのAppModuleとHTTPルートには登録しない。
// 使い方: MIGRATION_DATABASE_URL / ENROLL_GOOGLE_CLIENT_ID / ENROLL_GOOGLE_CLIENT_SECRETを設定し、
//         npm run cli:enroll -w @tomotabi/api -- --slot 0
import { enrollGoogleAccount } from "./enroll/enroll-google-account.js";
import { GoogleAuthLibraryClient } from "./enroll/google-auth-library-client.js";
import { ConsoleIo } from "./shared/console-io.js";
import { runCli } from "./shared/run-cli.js";
import { parseSlot, requireEnv } from "./shared/slot.js";

void runCli(async (pool) => {
  const slot = parseSlot(process.argv.slice(2));
  const clientId = requireEnv("ENROLL_GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("ENROLL_GOOGLE_CLIENT_SECRET");
  await enrollGoogleAccount(
    {
      clientId,
      google: new GoogleAuthLibraryClient(clientId, clientSecret),
      io: new ConsoleIo(),
      pool,
    },
    slot,
  );
}).then((exitCode) => {
  process.exitCode = exitCode;
});
