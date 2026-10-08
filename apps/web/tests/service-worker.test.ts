import { describe, expect, it, vi } from "vitest";
import { openPathFromNotificationData } from "@/service-worker/handlers";
import { registerServiceWorker } from "@/service-worker/register";
import type {
  ClientsLike,
  NotificationClickEventLike,
  PushEventLike,
  ServiceWorkerScopeLike,
  WindowClientLike,
} from "@/service-worker/types";

const ORIGIN = "https://tomotabi.example";

const eventId = "550e8400-e29b-41d4-a716-446655440000";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const targetId = "6d6a86a1-6d0b-4c0f-9bb9-9a1d3a9e9c01";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId,
    action: "payment_added",
    tripId,
    targetKind: "payment",
    targetId,
    occurredAt: "2026-10-08T13:25:00.000Z",
    actorName: "あおい",
    tripName: "沖縄旅行",
    ...overrides,
  };
}

function windowClient(url: string): WindowClientLike & {
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
} {
  const client = {
    url,
    focus: vi.fn(async (): Promise<WindowClientLike> => client),
    navigate: vi.fn(
      async (_navigateTo: string): Promise<WindowClientLike | null> => client,
    ),
  };
  return client;
}

function clientsWith(items: WindowClientLike[]): ClientsLike & {
  matchAll: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
} {
  return {
    matchAll: vi.fn(async () => items),
    openWindow: vi.fn(async () => windowClient("new")),
  };
}

function fakeScope(clients: ClientsLike) {
  const listeners: {
    push: ((event: PushEventLike) => void) | null;
    notificationclick: ((event: NotificationClickEventLike) => void) | null;
  } = { push: null, notificationclick: null };
  const showNotification = vi.fn(
    async (
      _title: string,
      _options?: { body?: string; tag?: string; data?: unknown },
    ) => {},
  );
  const scope = {
    location: { origin: ORIGIN },
    clients,
    registration: { showNotification },
    addEventListener(type: string, listener: unknown) {
      if (type === "push") {
        listeners.push = listener as (event: PushEventLike) => void;
      }
      if (type === "notificationclick") {
        listeners.notificationclick = listener as (
          event: NotificationClickEventLike
        ) => void;
      }
    },
  } as unknown as ServiceWorkerScopeLike;
  return { scope, listeners, showNotification };
}

function dispatchPush(
  listener: (event: PushEventLike) => void,
  data: { json(): unknown } | null,
): Promise<unknown> {
  let awaited: Promise<unknown> | null = null;
  listener({
    data,
    waitUntil: (task) => {
      awaited = task;
    },
  });
  if (awaited === null) throw new Error("waitUntilが呼ばれなかった");
  return awaited;
}

function dispatchClick(
  listener: (event: NotificationClickEventLike) => void,
  notification: { data: unknown; close(): void },
): Promise<unknown> {
  let awaited: Promise<unknown> | null = null;
  listener({
    notification,
    waitUntil: (task) => {
      awaited = task;
    },
  });
  if (awaited === null) throw new Error("waitUntilが呼ばれなかった");
  return awaited;
}

describe("service workerのpush", () => {
  it("決まった形の中身をwaitUntilでshowNotificationに渡す。tagはeventId", async () => {
    const { scope, listeners, showNotification } = fakeScope(clientsWith([]));
    registerServiceWorker(scope);

    await dispatchPush(listeners.push!, {
      json: () => payload(),
    });

    expect(showNotification).toHaveBeenCalledWith("tomotabi", {
      body: "あおいが「沖縄旅行」で支払いを記録しました",
      tag: eventId,
      data: {
        path: `/trips/${tripId}/records?recordType=payment&recordId=${targetId}`,
      },
    });
  });

  it("形が違う中身は汎用の文と旅行一覧へのパス。tagは付けない", async () => {
    const { scope, listeners, showNotification } = fakeScope(clientsWith([]));
    registerServiceWorker(scope);

    await dispatchPush(listeners.push!, { json: () => ({ bad: "shape" }) });

    const [title, options] = showNotification.mock.calls[0]!;
    expect(title).toBe("tomotabi");
    expect(options).toMatchObject({
      body: "アプリで最新の情報をご確認ください",
      data: { path: "/trips" },
    });
    expect(options).not.toHaveProperty("tag");
  });

  it("JSONでない・dataが無い中身も汎用の文にする", async () => {
    const { scope, listeners, showNotification } = fakeScope(clientsWith([]));
    registerServiceWorker(scope);

    await dispatchPush(listeners.push!, {
      json: () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    await dispatchPush(listeners.push!, { json: () => null });
    await dispatchPush(listeners.push!, null);

    expect(showNotification).toHaveBeenCalledTimes(3);
    for (const call of showNotification.mock.calls) {
      expect(call[1]).toMatchObject({ data: { path: "/trips" } });
    }
  });
});

describe("service workerのnotificationclick", () => {
  const openPath = `/trips/${tripId}/plans/${targetId}`;

  function notificationWith(data: unknown) {
    return { data, close: vi.fn() };
  }

  it("同じオリジンのウィンドウがあればfocusしてnavigate。通知は閉じる", async () => {
    const client = windowClient(`${ORIGIN}/trips`);
    const clients = clientsWith([client]);
    const { scope, listeners } = fakeScope(clients);
    registerServiceWorker(scope);
    const notification = notificationWith({ path: openPath });

    await dispatchClick(listeners.notificationclick!, notification);

    expect(notification.close).toHaveBeenCalledOnce();
    expect(clients.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(client.focus).toHaveBeenCalledOnce();
    expect(client.navigate).toHaveBeenCalledWith(openPath);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it("ウィンドウが無ければopenWindowで開く", async () => {
    const clients = clientsWith([]);
    const { scope, listeners } = fakeScope(clients);
    registerServiceWorker(scope);
    const notification = notificationWith({ path: openPath });

    await dispatchClick(listeners.notificationclick!, notification);

    expect(notification.close).toHaveBeenCalledOnce();
    expect(clients.openWindow).toHaveBeenCalledWith(openPath);
  });

  it("違うオリジンのウィンドウだけならopenWindowで開く", async () => {
    const clients = clientsWith([windowClient("https://evil.example/x")]);
    const { scope, listeners } = fakeScope(clients);
    registerServiceWorker(scope);

    await dispatchClick(listeners.notificationclick!, notificationWith({ path: openPath }));

    expect(clients.openWindow).toHaveBeenCalledWith(openPath);
  });

  it("navigateが失敗したらopenWindowで開く", async () => {
    const client = windowClient(`${ORIGIN}/trips`);
    client.navigate.mockRejectedValue(
      new TypeError("ServiceWorker is not the active worker"),
    );
    const clients = clientsWith([client]);
    const { scope, listeners } = fakeScope(clients);
    registerServiceWorker(scope);
    const notification = notificationWith({ path: openPath });

    await dispatchClick(listeners.notificationclick!, notification);

    expect(notification.close).toHaveBeenCalledOnce();
    expect(client.focus).toHaveBeenCalledOnce();
    expect(clients.openWindow).toHaveBeenCalledWith(openPath);
  });

  it("navigateがnullを返したらopenWindowで開く", async () => {
    const client = windowClient(`${ORIGIN}/trips`);
    client.navigate.mockResolvedValue(null);
    const clients = clientsWith([client]);
    const { scope, listeners } = fakeScope(clients);
    registerServiceWorker(scope);

    await dispatchClick(listeners.notificationclick!, notificationWith({ path: openPath }));

    expect(client.navigate).toHaveBeenCalledWith(openPath);
    expect(clients.openWindow).toHaveBeenCalledWith(openPath);
  });

  it("focusが失敗したらopenWindowで開く", async () => {
    const client = windowClient(`${ORIGIN}/trips`);
    client.focus.mockRejectedValue(new TypeError("window is gone"));
    const clients = clientsWith([client]);
    const { scope, listeners } = fakeScope(clients);
    registerServiceWorker(scope);

    await dispatchClick(listeners.notificationclick!, notificationWith({ path: openPath }));

    expect(client.navigate).not.toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledWith(openPath);
  });

  it.each([
    [{ path: "https://evil.example/x" }, "絶対URL"],
    [{ path: "//evil.example/x" }, "スキーム相対URL"],
    [{ path: "trips" }, "先頭が/でないパス"],
    [{ notPath: "/trips" }, "path欄が無いdata"],
    [null, "dataがnull"],
    ["string", "dataが文字列"],
  ])("dataが%s（%s）なら旅行一覧を開く", async (data, _label) => {
    const clients = clientsWith([]);
    const { scope, listeners } = fakeScope(clients);
    registerServiceWorker(scope);

    await dispatchClick(listeners.notificationclick!, notificationWith(data));

    expect(clients.openWindow).toHaveBeenCalledWith("/trips");
  });
});

describe("openPathFromNotificationData", () => {
  it("先頭が/のパスだけを返し、それ以外は旅行一覧", () => {
    expect(openPathFromNotificationData({ path: "/trips/abc" })).toBe("/trips/abc");
    expect(openPathFromNotificationData({ path: "https://evil.example" })).toBe("/trips");
    expect(openPathFromNotificationData({ path: "//evil.example" })).toBe("/trips");
    expect(openPathFromNotificationData(undefined)).toBe("/trips");
  });
});
