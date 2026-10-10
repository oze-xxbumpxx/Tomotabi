import { describe, expect, it } from "vitest";
import {
  determineDeviceNotificationState,
  type DeviceNotificationInput,
} from "@/features/notifications/model/device-state";

/**
 * PU-14: 設定の画面の状態の判定。7つの状態が表の上から順に1つだけに
 * 決まる。ホーム画面に追加していないiPhoneは「ホーム画面への追加が要る」になる。
 */

const capable: Pick<
  DeviceNotificationInput,
  | "hasServiceWorker"
  | "hasPushManager"
  | "hasNotification"
  | "iosNeedsHomeScreen"
> = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  iosNeedsHomeScreen: false,
};

function input(overrides: Partial<DeviceNotificationInput> = {}): DeviceNotificationInput {
  return {
    ...capable,
    permission: "default",
    pushConfigUnavailable: false,
    hasBrowserSubscription: false,
    currentRow: null,
    hasCurrentSessionEnabledRow: false,
    ...overrides,
  };
}

describe("determineDeviceNotificationState", () => {
  it("ホーム画面に追加していないiPhoneは「ホーム画面への追加が要る」になる（「使えない」より先）", () => {
    // iPhoneではPushManagerも無いので「使えない」にも当てはまるが、先に判定する。
    expect(
      determineDeviceNotificationState(
        input({
          iosNeedsHomeScreen: true,
          hasPushManager: false,
          hasNotification: false,
        }),
      ),
    ).toBe("needs-home-screen-app");
  });

  it("serviceWorker・PushManager・Notificationのどれかが無ければ「使えない」", () => {
    expect(
      determineDeviceNotificationState(input({ hasServiceWorker: false })),
    ).toBe("unavailable");
    expect(
      determineDeviceNotificationState(input({ hasPushManager: false })),
    ).toBe("unavailable");
    expect(
      determineDeviceNotificationState(input({ hasNotification: false })),
    ).toBe("unavailable");
  });

  it("鍵の設定が崩れている（push-config 503）は一覧のvapidKeyStateより先に「使えない」", () => {
    // 一覧の行がrevokedでも、503を先に見て「APIで無効」とは出さない。
    expect(
      determineDeviceNotificationState(
        input({
          pushConfigUnavailable: true,
          permission: "granted",
          hasBrowserSubscription: true,
          hasCurrentSessionEnabledRow: true,
          currentRow: { enabled: false, vapidKeyState: "revoked" },
        }),
      ),
    ).toBe("unavailable");
  });

  it("まだ許可していない（permissionがdefault）は「まだ有効にしていない」", () => {
    expect(
      determineDeviceNotificationState(input({ permission: "default" })),
    ).toBe("not-enabled");
  });

  it("許可を断った（permissionがdenied）は「許可を断った」", () => {
    expect(
      determineDeviceNotificationState(input({ permission: "denied" })),
    ).toBe("denied");
  });

  it("ブラウザでは登録したがAPIに未登録は「ブラウザだけ」", () => {
    expect(
      determineDeviceNotificationState(
        input({
          permission: "granted",
          hasBrowserSubscription: true,
          hasCurrentSessionEnabledRow: false,
        }),
      ),
    ).toBe("browser-only");
  });

  it("一覧に今のendpointの有効な行があれば「有効」", () => {
    expect(
      determineDeviceNotificationState(
        input({
          permission: "granted",
          hasBrowserSubscription: true,
          hasCurrentSessionEnabledRow: true,
          currentRow: { enabled: true, vapidKeyState: "current" },
        }),
      ),
    ).toBe("enabled");
  });

  it("記憶が無くても、一覧にisCurrentSessionの有効な行があれば「有効」", () => {
    // 記憶は「止める」のIDを決めるためで、有効かどうかの条件ではない。
    expect(
      determineDeviceNotificationState(
        input({
          permission: "granted",
          hasBrowserSubscription: true,
          hasCurrentSessionEnabledRow: true,
          currentRow: null,
        }),
      ),
    ).toBe("enabled");
  });

  it("行はあるがenabled=falseまたはrevokedなら「APIで無効になった」", () => {
    // ブラウザの購読が無い（「ブラウザだけ」に行かない）とき、
    // 記憶の行がdisabled/revokedなら「APIで無効」。
    expect(
      determineDeviceNotificationState(
        input({
          permission: "granted",
          currentRow: { enabled: false, vapidKeyState: "current" },
        }),
      ),
    ).toBe("api-disabled");
    expect(
      determineDeviceNotificationState(
        input({
          permission: "granted",
          currentRow: { enabled: true, vapidKeyState: "revoked" },
        }),
      ),
    ).toBe("api-disabled");
  });

  it("上から順に判定する: deniedはpermissionの判定より後の行より先に決まる", () => {
    // deniedだが購読も行もある → 表の上のdeniedが先。
    expect(
      determineDeviceNotificationState(
        input({
          permission: "denied",
          hasBrowserSubscription: true,
          currentRow: { enabled: true, vapidKeyState: "current" },
          hasCurrentSessionEnabledRow: true,
        }),
      ),
    ).toBe("denied");
  });

  it("表に無い組み合わせ（許可済みだが購読も記憶も無い）は「まだ有効にしていない」", () => {
    expect(
      determineDeviceNotificationState(input({ permission: "granted" })),
    ).toBe("not-enabled");
  });
});
