// docs/tests/payments-and-settlement.md の FE-04（再読み込みをまたぐ結果不明）を
// 実APIつなぎで検証する。
// 支払いの記録の応答だけを捨て、再読み込み → 「同じ内容で確認する」で
// 保存済みの結果が返り、支払いが1件だけであることを実DBでも確かめる。

import { countPayments } from "../support/db";
import { expect, test } from "../support/fixtures";
import { createTrip } from "../support/trips";

test("FE-04: 応答の届かなかった支払いの記録は同じ内容で確認する", async ({
  hinataPage: page,
}) => {
  const tripId = await createTrip(page, {
    name: "広島 1 泊",
    startsOn: "2026-11-28",
    endsOn: "2026-11-29",
  });

  // POST /payments の応答だけを捨てる。request は route.fetch で本物の
  // API へ届けるので、サーバー側では保存が完了する。
  await page.route("**/api/trips/*/payments", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fetch();
    await route.abort("failed");
  });

  // 支払いを記録 → 入力して保存（応答は捨てられる）。
  await page.getByRole("link", { name: "支払いを記録" }).click();
  const sheet = page.getByRole("dialog", { name: "支払いを記録" });
  await expect(sheet.getByLabel("金額")).toBeVisible();
  await expect(sheet.getByRole("radio", { name: /（自分）/ })).toBeChecked();
  await sheet.getByLabel("金額").fill("2500");
  await sheet.getByLabel("用途").fill("夕食代");
  await sheet.getByRole("button", { name: "保存" }).click();

  // 結果不明: 「保存されたか確認できません」と入力の固定が出る。
  const unknown = sheet
    .getByRole("alert")
    .filter({ hasText: "保存されたか確認できません" });
  await expect(unknown).toBeVisible();
  await expect(sheet.getByLabel("金額")).toHaveJSProperty("readOnly", true);
  await expect(sheet.getByLabel("用途")).toHaveJSProperty("readOnly", true);

  // 捨てた応答の要求はサーバーに届いている（再読み込みの前に確かめる）。
  expect(await countPayments(tripId)).toBe(1);

  // 経路を戻して再読み込み → IndexedDB の保留の要求から確認が続く。
  await page.unroute("**/api/trips/*/payments");
  await page.reload();

  await expect(unknown).toBeVisible();
  await expect(sheet.getByLabel("金額")).toHaveJSProperty("readOnly", true);
  await expect(sheet.getByLabel("用途")).toHaveValue("夕食代");

  // 「同じ内容で確認する」→ 保存済みの結果が返り、しおりへ戻る。
  await sheet.getByRole("button", { name: "同じ内容で確認する" }).click();
  await page.waitForURL(new RegExp(`/trips/${tripId}/itinerary$`));
  await expect(
    page.getByRole("status").filter({ hasText: "支払いを記録しました" }),
  ).toBeVisible();

  // 支払いは1件だけ（実DBで数える。再送で二重に作られていない）。
  expect(await countPayments(tripId)).toBe(1);

  // 画面でも精算の対象が1件として出る。
  await page
    .getByRole("navigation", { name: "タブ" })
    .getByRole("link", { name: "精算" })
    .click();
  await expect(page.getByRole("heading", { name: "精算" })).toBeVisible();
  await expect(page.getByText("対象 1 件")).toBeVisible();
  await expect(page.getByText("夕食代")).toBeVisible();
});
