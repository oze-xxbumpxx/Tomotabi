/**
 * run.mjsが子プロセスに渡す環境変数を読む。直接`playwright test`を
 * 実行した場合（環境変数が無い）はここで失敗させる。
 */
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required. Run E2E via \`npm run test:e2e\` (e2e/scripts/run.mjs sets it).`,
    );
  }
  return value;
};

// ポートは固定値（webのbuildにAPI_ORIGINが焼き込まれるため、
// 実行ごとに変えられない。ADR-0005 / 設計書「データフロー」）。
export const WEB_PORT = 3100;
export const API_PORT = 3101;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://localhost:${API_PORT}`;

export const RUNTIME_DATABASE_URL = required("E2E_DATABASE_URL_RUNTIME");
export const MIGRATOR_DATABASE_URL = required("E2E_DATABASE_URL_MIGRATOR");
export const AUTH_SECRET = required("E2E_AUTH_SECRET");
export const HINATA_USER_ID = required("E2E_HINATA_USER_ID");
export const AOI_USER_ID = required("E2E_AOI_USER_ID");

/** CIではbuildを事前ステップで済ませ、webServerは起動だけにする。 */
export const SKIP_BUILD = process.env.E2E_SKIP_BUILD === "1";
