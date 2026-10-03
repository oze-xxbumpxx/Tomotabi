import { expect, test } from "../support/fixtures";
import { createTrip, openTripEditSheet } from "../support/trips";

// M-02（docs/tests/m2-trips-and-plans.md）: ひなた・あおいが同じ旅行の
// しおりを開く。ひなたが先に旅行名を変えたあと、あおいが古い画面のまま
// 旅行名を変える → C-5（「相手が先に変更しました」、旅行名は「変更あり」で
// 最新（相手）とあなたの入力が並ぶ）→「あなたの入力で保存」→
// 両方の画面であおいの名前になる（ひなたの画面は再読み込みで）。
const TRIP = {
  name: "松山 1 泊",
  startsOn: "2026-11-03", // 11/3 火
  endsOn: "2026-11-04", // 11/4 水
};

test("M-02: 二人の変更の競合は C-5 で見比べてから保存する", async ({
  hinataPage,
  aoiPage,
}) => {
  const tripId = await createTrip(hinataPage, TRIP);

  // あおいも同じ旅行のしおりを開く（別のcontext）。
  await aoiPage.goto(`/trips/${tripId}/itinerary`);
  await expect(
    aoiPage.getByRole("heading", { name: TRIP.name }),
  ).toBeVisible();

  // 二人とも同じ時点（同じversion）の「旅行名と期間を変更」を開く。
  const hinataSheet = await openTripEditSheet(hinataPage, TRIP.name);
  const aoiSheet = await openTripEditSheet(aoiPage, TRIP.name);

  // ひなたが先に旅行名を保存する。
  await hinataSheet.getByLabel("旅行名").fill("ひなたの松山");
  await hinataSheet.getByRole("button", { name: "保存" }).click();
  await expect(
    hinataPage.getByRole("status").filter({ hasText: "変更しました" }),
  ).toBeVisible();
  await expect(
    hinataPage.getByRole("heading", { name: "ひなたの松山" }),
  ).toBeVisible();

  // あおいは古い画面のまま別の名前で保存する → C-5。
  await aoiSheet.getByLabel("旅行名").fill("あおいの松山");
  await aoiSheet.getByRole("button", { name: "保存" }).click();
  await expect(
    aoiSheet
      .getByRole("alert")
      .filter({ hasText: "相手が先に変更しました" }),
  ).toBeVisible();
  // 旅行名は「変更あり」で、最新（相手）とあなたの入力が並ぶ。
  await expect(aoiSheet.getByText("変更あり")).toBeVisible();
  await expect(aoiSheet.getByText("最新（相手）")).toBeVisible();
  await expect(aoiSheet.getByText("ひなたの松山")).toBeVisible();
  await expect(
    aoiSheet.getByText("あなたの入力", { exact: true }),
  ).toBeVisible();
  await expect(aoiSheet.getByText("あおいの松山")).toBeVisible();

  // 「あなたの入力で保存」→ あおいの入力が保存される。
  await aoiSheet
    .getByRole("button", { name: "あなたの入力で保存" })
    .click();
  await expect(
    aoiPage.getByRole("status").filter({ hasText: "変更しました" }),
  ).toBeVisible();
  await expect(
    aoiPage.getByRole("heading", { name: "あおいの松山" }),
  ).toBeVisible();

  // ひなたの画面も再読み込みであおいの名前になる。
  await hinataPage.reload();
  await expect(
    hinataPage.getByRole("heading", { name: "あおいの松山" }),
  ).toBeVisible();
});
