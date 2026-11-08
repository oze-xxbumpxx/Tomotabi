import { daysFromToday } from "../support/dates";
import { expect, test } from "../support/fixtures";
import { createTrip } from "../support/trips";

// 旅行のToDoリスト（docs/tests/trip-todo.md の E2E）: ひなたが追加した
// ToDoをあおいがToDoのタブで見る。あおいが「予定にする」で予定を作ると、
// しおりに予定が増え、ToDoは済んだ欄に移って「の予定 ›」から予定の詳細が開く。
const TRIP = {
  name: "京都 ToDo",
  startsOn: daysFromToday(30),
  endsOn: daysFromToday(31),
};

test("ToDo: 追加したものを相手が見て、予定にすると完了になる", async ({
  hinataPage,
  aoiPage,
}) => {
  const tripId = await createTrip(hinataPage, TRIP);

  // ひなたがToDoのタブから追加する。
  await hinataPage
    .getByRole("navigation", { name: "タブ" })
    .getByRole("link", { name: "ToDo" })
    .click();
  await hinataPage.getByLabel("ToDoの内容").fill("湯豆腐を食べる");
  await hinataPage.getByRole("button", { name: "追加する" }).click();
  await expect(hinataPage.getByText("あなたが追加した")).toBeVisible();

  // あおいも同じToDoを見られる（通知は届かない）。
  await aoiPage.goto(`/trips/${tripId}/todos`);
  await expect(
    aoiPage.getByRole("link", { name: /湯豆腐を食べる/ }),
  ).toBeVisible();

  // あおいが詳細から「予定にする」。名前が入った予定の追加が開く。
  await aoiPage.getByRole("link", { name: /湯豆腐を食べる/ }).click();
  await aoiPage.getByRole("button", { name: "予定にする" }).click();
  const sheet = aoiPage.getByRole("dialog", { name: "予定を追加" });
  await expect(sheet.getByRole("textbox", { name: /名前/ })).toHaveValue(
    "湯豆腐を食べる",
  );
  // 種類のradioはsr-only（見た目のspanがポインタを受ける）ためforceで選ぶ。
  await sheet
    .getByRole("radio", { name: "食べ処", exact: true })
    .check({ force: true });
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(aoiPage).toHaveURL(new RegExp(`/trips/${tripId}/itinerary`));
  await expect(aoiPage.getByText("湯豆腐を食べる")).toBeVisible();

  // ToDoは済んだ欄に移り、「の予定 ›」から予定の詳細が開く。
  await hinataPage.reload();
  const done = hinataPage.getByRole("region", { name: "済んだもの" });
  await expect(done.getByText(/が予定にした/)).toBeVisible();
  await done.getByRole("link", { name: /の予定 ›$/ }).click();
  await expect(hinataPage).toHaveURL(new RegExp(`/trips/${tripId}/plans/`));
  await expect(hinataPage.getByText("湯豆腐を食べる")).toBeVisible();
});
