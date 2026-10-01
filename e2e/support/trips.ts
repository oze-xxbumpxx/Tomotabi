import { expect, type Locator, type Page } from "@playwright/test";

export type TripInput = {
  name: string;
  /** `YYYY-MM-DD`。 */
  startsOn: string;
  /** `YYYY-MM-DD`。 */
  endsOn: string;
};

/**
 * `/trips` の「新しい旅行」シートで旅行を作り、しおりに移ったあと
 * trip id を URL から取って返す。
 */
export async function createTrip(
  page: Page,
  trip: TripInput,
): Promise<string> {
  await page.goto("/trips");
  await page.getByRole("link", { name: "新しい旅行をつくる" }).click();
  const sheet = page.getByRole("dialog", { name: "新しい旅行" });
  await sheet.getByLabel("旅行名").fill(trip.name);
  await sheet.getByLabel("開始日").fill(trip.startsOn);
  await sheet.getByLabel("終了日").fill(trip.endsOn);
  await sheet.getByRole("button", { name: "旅行をつくる" }).click();
  await page.waitForURL(/\/trips\/[^/]+\/itinerary/);
  await expect(
    page.getByRole("heading", { name: trip.name }),
  ).toBeVisible();
  const tripId = /\/trips\/([^/]+)\/itinerary/.exec(page.url())?.[1];
  if (tripId === undefined) {
    throw new Error(`could not read trip id from url: ${page.url()}`);
  }
  return tripId;
}

/**
 * しおりの「旅行のメニュー」から「旅行名と期間を変更」のシートを開き、
 * そのシートの Locator を返す。
 */
export async function openTripEditSheet(
  page: Page,
  tripName: string,
): Promise<Locator> {
  await page.getByRole("button", { name: "旅行のメニュー" }).click();
  await page
    .getByRole("dialog", { name: tripName })
    .getByRole("button", { name: "旅行名と期間を変更" })
    .click();
  const sheet = page.getByRole("dialog", { name: "旅行名と期間を変更" });
  await expect(sheet.getByLabel("旅行名")).toBeVisible();
  return sheet;
}
