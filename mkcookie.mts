import { Pool } from "pg";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import { createAuth } from "/Users/devin/repos/Tomotabi/apps/api/src/modules/identity/infrastructure/better-auth";

const userId = process.argv[2];
if (!userId) throw new Error("usage: tsx mkcookie.mts <userId>");

const pool = new Pool({
  connectionString: "postgres://app_runtime:app_runtime@127.0.0.1:5432/tomotabi",
});
pool.on("error", () => {});

const auth: Auth = createAuth(
  {
    baseURL: "http://localhost:3000",
    secret: "local-testing-secret-0123456789abcdef",
    googleClientId: "unused",
    googleClientSecret: "unused",
    useSecureCookies: false,
  },
  pool,
  { plugins: [testUtils()] },
);

const context = await auth.$context;
const helpers = (context as unknown as { test: TestHelpers }).test;
const result = await helpers.login({ userId });
const header = result.headers.get("cookie");
if (!header) throw new Error("no cookie returned");
console.log(header);
await pool.end();
process.exit(0);
