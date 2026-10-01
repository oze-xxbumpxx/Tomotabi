import { test as base, type Page } from "@playwright/test";
import { newLoggedInContext } from "./auth";
import { resetBusinessTables } from "./db";
import { AOI_USER_ID, HINATA_USER_ID } from "./env";

type E2eFixtures = {
  /** ひなたとしてログインした page（context は試験ごとに新規）。 */
  hinataPage: Page;
  /** あおいとしてログインした page。二人での試験用（M-02）。 */
  aoiPage: Page;
};

/**
 * 各試験の前に業務の表を空にし、ひなた・あおいのログイン済み context を
 * 用意する（ADR-0005 Decision 2・5）。
 */
export const test = base.extend<
  E2eFixtures & { resetBusinessData: void }
>({
  resetBusinessData: [
    async ({ browser: _browser }, use) => {
      await resetBusinessTables();
      await use();
    },
    { auto: true },
  ],
  hinataPage: async ({ browser }, use) => {
    const context = await newLoggedInContext(browser, HINATA_USER_ID);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  aoiPage: async ({ browser }, use) => {
    const context = await newLoggedInContext(browser, AOI_USER_ID);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";
