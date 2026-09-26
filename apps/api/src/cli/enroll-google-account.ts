// 初期登録 CLI（管理者端末専用）。Nest の AppModule と HTTP ルートには登録しない。
// 使い方: MIGRATION_DATABASE_URL / ENROLL_GOOGLE_CLIENT_ID / ENROLL_GOOGLE_CLIENT_SECRET を設定し、
//         npm run cli:enroll -w @tomotabi/api -- --slot 0
import { enrollGoogleAccount } from "./enroll/enroll-google-account";
import { GoogleAuthLibraryClient } from "./enroll/google-auth-library-client";
import { ConsoleIo } from "./shared/console-io";
import { runCli } from "./shared/run-cli";
import { parseSlot, requireEnv } from "./shared/slot";

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
