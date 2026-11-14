import { daysFromToday } from "../support/dates";
import { expect, test } from "../support/fixtures";
import { createTrip } from "../support/trips";

// 旅行のToDoリスト（docs/tests/todo-organize.md の W-E01・L-E01 と回帰）:
// ひなたがカテゴリを作ってToDoを分けると、あおいの画面でも同じ欄に出る。
// あおいが「新しく予定を作る」で予定を作ると、ToDoは完了にならず予定と結ばれ、
// 「日付 名前 ›」のリンクから予定の詳細が開く。予定の詳細には「関連するToDo」が出る。
const TRIP = {
  name: "京都 ToDo",
  startsOn: daysFromToday(30),
  endsOn: daysFromToday(31),
};

test("ToDo: カテゴリを作って分けると、もう一人の画面でも同じ欄に出る（W-E01）", async ({
  hinataPage,
  aoiPage,
}) => {
  const tripId = await createTrip(hinataPage, TRIP);

  // ひなたがToDoのタブからカテゴリを作る。
  await hinataPage
    .getByRole("navigation", { name: "タブ" })
    .getByRole("link", { name: "ToDo" })
    .click();
  await hinataPage
    .getByRole("button", { name: "カテゴリを追加" })
    .click();
  const sheet = hinataPage.getByRole("dialog", {
    name: "カテゴリを追加",
  });
  await sheet.getByLabel("名前").fill("洗濯物");
  await sheet.getByRole("button", { name: "追加する" }).click();
  await expect(
    hinataPage.getByRole("region", { name: "洗濯物" }),
  ).toBeVisible();

  // そのカテゴリを選んでToDoを追加する。
  await hinataPage.getByLabel("入れるカテゴリ").selectOption({
    label: "洗濯物",
  });
  await hinataPage.getByLabel("ToDoの内容").fill("下着を洗う");
  await hinataPage.getByRole("button", { name: "追加する" }).click();
  const column = hinataPage.getByRole("region", { name: "洗濯物" });
  await expect(column.getByText("下着を洗う")).toBeVisible();

  // あおいの画面でも同じ欄に出る。
  await aoiPage.goto(`/trips/${tripId}/todos`);
  const aoiColumn = aoiPage.getByRole("region", { name: "洗濯物" });
  await expect(aoiColumn).toBeVisible();
  await expect(
    aoiColumn.getByRole("link", { name: /下着を洗う/ }),
  ).toBeVisible();
});

test("ToDo: 追加したものを相手が見て、新しく予定を作ると完了にならず予定と結ばれる（L-E01）", async ({
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

  // あおいが詳細から「新しく予定を作る」。名前が入った予定の追加が開く。
  await aoiPage.getByRole("link", { name: /湯豆腐を食べる/ }).click();
  await aoiPage
    .getByRole("button", { name: "新しく予定を作る" })
    .click();
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

  // ToDoは完了にならず、関連する予定と結ばれる（F-19）。
  // 詳細には「関連する予定」が出る。
  await hinataPage.reload();
  await expect(
    hinataPage.getByRole("button", {
      name: "「湯豆腐を食べる」を完了にする",
    }),
  ).toBeVisible();
  await hinataPage
    .getByRole("link", { name: /湯豆腐を食べる/ })
    .click();
  await expect(
    hinataPage.getByRole("button", { name: /関連する予定/ }),
  ).toContainText("湯豆腐を食べる");

  // 「日付 名前 ›」のリンクから予定の詳細が開き、「関連するToDo」が出る。
  await hinataPage
    .getByRole("link", { name: /湯豆腐を食べる ›$/ })
    .click();
  await expect(hinataPage).toHaveURL(new RegExp(`/trips/${tripId}/plans/`));
  const todosRegion = hinataPage.getByRole("region", {
    name: "関連するToDo",
  });
  await expect(todosRegion).toBeVisible();
  await expect(todosRegion.getByText("湯豆腐を食べる")).toBeVisible();
  await expect(
    todosRegion.getByText("未完了のToDoが1件あります"),
  ).toBeVisible();
});
