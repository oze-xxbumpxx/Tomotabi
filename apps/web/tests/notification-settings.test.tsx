import "fake-indexeddb/auto";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/shared/api/query-client";

const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

import { NotificationGuideCard } from "@/features/notifications";

import { NotificationSettingsScreen } from "@/screens/notification-settings/notification-settings-screen";
import { parseFromParam } from "@/screens/notification-settings/parse-from-param";
import { TripMenu } from "@/features/trips/ui/trip-menu";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const otherUserId = "3f7c1f68-9c05-4f2e-9b4c-2d5b1a90f811";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const ownSubscriptionId = "11111111-2222-4333-8444-555555555555";
const otherSubscriptionId = "66666666-7777-4888-8999-000000000000";

const vapidKey =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfCKj-BuUSmcKVzKy0mLA8L4k2eFIhEs";

const meBody = {
  user: { id: userId, displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
};

const participants = [
  { userId, slot: 0 as const, displayName: "ひなた" },
  { userId: otherUserId, slot: 1 as const, displayName: "あおい" },
];

const configBody = {
  publicVapidKey: vapidKey,
  keyId: "key-2026-10",
  maxActiveSubscriptions: 3,
};

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ownSubscriptionId,
    deviceLabel: "この端末",
    enabled: true,
    vapidKeyState: "current",
    isCurrentSession: true,
    updatedAt: "2026-10-07T10:00:00.000Z",
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

type Handler = (
  init?: RequestInit,
  url?: string,
) => Response | Promise<Response>;

function stubApi(handlers: {
  me?: Handler;
  config?: Handler;
  subscriptions?: Handler;
  register?: Handler;
  disable?: Handler;
  balance?: Handler;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    if (url === "/api/me") {
      return Promise.resolve(
        handlers.me !== undefined ? handlers.me(init) : json(meBody),
      );
    }
    if (url === "/api/me/push-config") {
      return Promise.resolve(
        handlers.config !== undefined
          ? handlers.config(init)
          : json(configBody),
      );
    }
    if (url === "/api/me/push-subscriptions" && method === "GET") {
      return Promise.resolve(
        handlers.subscriptions !== undefined
          ? handlers.subscriptions(init)
          : json({ items: [] }),
      );
    }
    if (url === "/api/me/push-subscriptions" && method === "PUT") {
      return Promise.resolve(
        handlers.register !== undefined
          ? handlers.register(init)
          : json(subscriptionRow(), 201),
      );
    }
    if (
      url.startsWith("/api/me/push-subscriptions/") &&
      method === "DELETE"
    ) {
      return Promise.resolve(
        handlers.disable !== undefined
          ? handlers.disable(init, url)
          : new Response(null, { status: 204 }),
      );
    }
    if (url === `/api/trips/${tripId}/balance`) {
      return Promise.resolve(
        handlers.balance !== undefined
          ? handlers.balance(init)
          : json({ participants, rows: [], updatedAt: "2026-10-07T10:00:00.000Z" }),
      );
    }
    return Promise.reject(new Error(`未想定のfetch: ${method} ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** ブラウザの購読のモック。endpointと鍵を持つ。 */
function browserSubscriptionMock(
  options: {
    applicationServerKey?: ArrayBuffer | null;
    unsubscribeResult?: boolean;
  } = {},
) {
  const unsubscribe = vi
    .fn<() => Promise<boolean>>()
    .mockResolvedValue(options.unsubscribeResult ?? true);
  const subscription = {
    endpoint: "https://push.example.com/sub/abc",
    expirationTime: null,
    options: {
      applicationServerKey:
        options.applicationServerKey === undefined
          ? null
          : options.applicationServerKey,
    },
    toJSON: () => ({
      endpoint: "https://push.example.com/sub/abc",
      expirationTime: null,
      keys: { p256dh: "B".repeat(87), auth: "C".repeat(22) },
    }),
    unsubscribe,
  };
  return subscription;
}

type PushEnv = {
  permission?: NotificationPermission;
  hasServiceWorker?: boolean;
  hasPushManager?: boolean;
  hasNotification?: boolean;
  standalone?: boolean | undefined;
  subscription?: ReturnType<typeof browserSubscriptionMock> | null;
  requestPermission?: () => Promise<NotificationPermission>;
};

/**
 * navigator.serviceWorker / window.PushManager / window.Notification を
 * jsdom に立てる。PW-02〜PW-09のブラウザ側はここで模擬する。
 */
function stubPushEnv(env: PushEnv = {}) {
  const {
    permission = "default",
    hasServiceWorker = true,
    hasPushManager = true,
    hasNotification = true,
    standalone = undefined,
    subscription = null,
    requestPermission,
  } = env;

  const getSubscription = vi
    .fn<() => Promise<unknown>>()
    .mockResolvedValue(subscription);
  const subscribe = vi.fn<(options?: unknown) => Promise<unknown>>(
    () => Promise.resolve(browserSubscriptionMock()),
  );
  const registration = {
    pushManager: { getSubscription, subscribe },
  };
  const ready = Promise.resolve(registration);

  const serviceWorker = {
    register: vi.fn(() => Promise.resolve(registration)),
    ready,
    getRegistration: vi.fn(() => Promise.resolve(registration)),
  };

  if (hasServiceWorker) {
    Object.defineProperty(window.navigator, "serviceWorker", {
      value: serviceWorker,
      configurable: true,
      writable: true,
    });
  } else {
    Object.defineProperty(window.navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
  }
  if (standalone !== undefined) {
    Object.defineProperty(window.navigator, "standalone", {
      value: standalone,
      configurable: true,
    });
  } else {
    delete (window.navigator as { standalone?: unknown }).standalone;
  }

  if (hasPushManager) {
    vi.stubGlobal("PushManager", class PushManager {});
  } else {
    delete (window as { PushManager?: unknown }).PushManager;
  }

  if (hasNotification) {
    const notificationMock: {
      permission: NotificationPermission;
      requestPermission: () => Promise<NotificationPermission>;
    } = {
      permission,
      requestPermission: vi.fn(() =>
        Promise.resolve("granted" as NotificationPermission),
      ),
    };
    if (requestPermission !== undefined) {
      notificationMock.requestPermission = async () => {
        const next = await requestPermission();
        // 本物のブラウザと同じく、許可の答えをpermissionに反映する。
        notificationMock.permission = next;
        return next;
      };
    } else {
      notificationMock.requestPermission = async () => {
        notificationMock.permission = "granted";
        return "granted";
      };
    }
    vi.stubGlobal("Notification", notificationMock);
  } else {
    delete (window as { Notification?: unknown }).Notification;
  }

  return { serviceWorker, registration, getSubscription, subscribe };
}

function renderScreen(props?: {
  backHref?: string;
  tripId?: string | null;
}) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NotificationSettingsScreen
        backHref={props?.backHref ?? "/trips"}
        tripId={props?.tripId ?? null}
      />
    </QueryClientProvider>,
  );
}

function renderGuideCard(props?: {
  partnerName?: string | null;
  userId?: string;
}) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NotificationGuideCard
        userId={props?.userId ?? userId}
        partnerName={props?.partnerName ?? "あおい"}
        homePath={`/trips/${tripId}/home`}
      />
    </QueryClientProvider>,
  );
}

function clearPushStorage() {
  window.localStorage.clear();
}

beforeEach(() => {
  clearPushStorage();
  pushMock.mockReset();
  replaceMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (window.navigator as { standalone?: unknown }).standalone;
  delete (window as { PushManager?: unknown }).PushManager;
  delete (window as { Notification?: unknown }).Notification;
  clearPushStorage();
});

describe("PW-01 旅行のメニューとfromの検証", () => {
  it("旅行のメニューに「この端末の通知」がログアウトの上にあり、今の旅行のホームへのfromつきで設定の画面を開く", async () => {
    // TripMenuは旅行と操作の状態が要る。最小の形で立てる。
    const trip = {
      id: tripId,
      name: "京都旅行",
      startsOn: "2026-10-03",
      endsOn: "2026-10-05",
      status: "traveling" as const,
      version: 1,
    };
    render(
      <TripMenu
        trip={trip as never}
        etag='"1"'
        displayName="ひなた"
        start={
          {
            state: { status: "editing" },
            submit: vi.fn(),
            backToEditing: vi.fn(),
            confirmRequest: vi.fn(),
          } as never
        }
        startPending={{ check: { status: "none" }, reload: vi.fn() } as never}
        onEdit={vi.fn()}
        onRequestFinish={vi.fn()}
        onSwitch={vi.fn()}
        onSignOut={vi.fn()}
        signOutPending={false}
        signOutFailure={null}
        onClose={vi.fn()}
      />,
    );

    const link = await screen.findByRole("link", {
      name: /この端末の通知/,
    });
    expect(link).toHaveAttribute(
      "href",
      `/settings/notifications?from=${encodeURIComponent(`/trips/${tripId}/home`)}`,
    );
    // ログアウトの上にある。
    const signOut = screen.getByRole("button", { name: /ログアウト/ });
    expect(
      link.compareDocumentPosition(signOut) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("fromが許した経路なら戻る先はその旅行のホーム。違えば旅行一覧", () => {
    const allowed = `/trips/${tripId}/home`;
    expect(parseFromParam(allowed)).toEqual({
      backHref: allowed,
      tripId,
    });
    // fromの残りは使わず、戻る先はtripIdから組み立て直す。
    expect(
      parseFromParam(`/trips/${tripId}/../../sign-in?x=1`),
    ).toEqual({ backHref: `/trips/${tripId}/home`, tripId });
    expect(parseFromParam("/trips/not-a-uuid/home")).toEqual({
      backHref: "/trips",
      tripId: null,
    });
    expect(parseFromParam("https://evil.example.com/")).toEqual({
      backHref: "/trips",
      tripId: null,
    });
    expect(parseFromParam(null)).toEqual({
      backHref: "/trips",
      tripId: null,
    });
  });

  it("PW-10: 通知を止められなかった失敗は文を変え、ログアウトは押せるまま", async () => {
    const trip = {
      id: tripId,
      name: "京都旅行",
      startsOn: "2026-10-03",
      endsOn: "2026-10-05",
      status: "traveling" as const,
      version: 1,
    };
    render(
      <TripMenu
        trip={trip as never}
        etag='"1"'
        displayName="ひなた"
        start={
          {
            state: { status: "editing" },
            submit: vi.fn(),
            backToEditing: vi.fn(),
            confirmRequest: vi.fn(),
          } as never
        }
        startPending={{ check: { status: "none" }, reload: vi.fn() } as never}
        onEdit={vi.fn()}
        onRequestFinish={vi.fn()}
        onSwitch={vi.fn()}
        onSignOut={vi.fn()}
        signOutPending={false}
        signOutFailure="push-stop"
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        "通知を止められませんでした。もう一度お試しください。この端末に通知が届かなくなった場合は、設定から有効にし直してください",
      ),
    ).toBeInTheDocument();
    // ログアウトはしていないので、もう一度押せる。
    expect(
      screen.getByRole("button", { name: /ログアウト/ }),
    ).toBeEnabled();
  });

  it("画面の「←」は検証済みの戻る先へ行く", async () => {
    stubPushEnv();
    stubApi({});
    renderScreen({
      backHref: `/trips/${tripId}/home`,
      tripId,
    });
    const back = await screen.findByRole("link", { name: "戻る" });
    expect(back).toHaveAttribute("href", `/trips/${tripId}/home`);
  });
});

describe("PW-02 7つの状態の出し分け", () => {
  it("使えない（serviceWorkerが無い）", async () => {
    stubPushEnv({ hasServiceWorker: false });
    stubApi({});
    renderScreen();
    expect(
      await screen.findByText("この端末では通知が使えません。"),
    ).toBeInTheDocument();
    expect(screen.getByText("オフ")).toBeInTheDocument();
  });

  it("使えない（push-configが503 PUSH_UNAVAILABLE）。一覧がrevokedでも先に503を見る", async () => {
    stubPushEnv({ permission: "granted", subscription: browserSubscriptionMock() });
    stubApi({
      config: () => json({ code: "PUSH_UNAVAILABLE" }, 503),
      subscriptions: () =>
        json({ items: [subscriptionRow({ enabled: false, vapidKeyState: "revoked" })] }),
    });
    renderScreen();
    expect(
      await screen.findByText("この端末では通知が使えません。"),
    ).toBeInTheDocument();
  });

  it("ホーム画面への追加が要る（iPhone・PushManager無し・非standalone）", async () => {
    stubPushEnv({
      hasPushManager: false,
      hasNotification: false,
      standalone: false,
    });
    stubApi({});
    renderScreen();
    expect(
      await screen.findByText(/ホーム画面に追加/),
    ).toBeInTheDocument();
  });

  it("まだ有効にしていない（permissionがdefault）", async () => {
    stubPushEnv({ permission: "default" });
    stubApi({});
    renderScreen();
    expect(
      await screen.findByRole("button", { name: "通知を有効にする" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/アプリを開いていなくても知らせます/),
    ).toBeInTheDocument();
  });

  it("許可を断った（permissionがdenied）", async () => {
    stubPushEnv({ permission: "denied" });
    stubApi({});
    renderScreen();
    expect(
      await screen.findByText(/通知が「許可しない」になっています/),
    ).toBeInTheDocument();
  });

  it("ブラウザだけ（購読はあるがAPIに行が無い）", async () => {
    stubPushEnv({
      permission: "granted",
      subscription: browserSubscriptionMock(),
    });
    stubApi({ subscriptions: () => json({ items: [] }) });
    renderScreen();
    expect(
      await screen.findByRole("button", { name: "登録し直す" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/登録の記録がサーバーにありません/),
    ).toBeInTheDocument();
  });

  it("有効（覚えた購読IDの行が有効）", async () => {
    window.localStorage.setItem(
      "tomotabi:push-subscription:" + userId,
      ownSubscriptionId,
    );
    stubPushEnv({
      permission: "granted",
      subscription: browserSubscriptionMock(),
    });
    stubApi({ subscriptions: () => json({ items: [subscriptionRow()] }) });
    renderScreen();
    expect(await screen.findByText("有効")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "この端末の通知を止める" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/金額や場所は出ません/),
    ).toBeInTheDocument();
  });

  it("APIで無効（行はあるがenabled=false）", async () => {
    window.localStorage.setItem(
      "tomotabi:push-subscription:" + userId,
      ownSubscriptionId,
    );
    // ブラウザの購読が無いと「ブラウザだけ」の判定を越えて行を見る。
    stubPushEnv({
      permission: "granted",
      subscription: null,
    });
    stubApi({
      subscriptions: () => json({ items: [subscriptionRow({ enabled: false })] }),
    });
    renderScreen();
    expect(
      await screen.findByText(/サーバーで止められています/),
    ).toBeInTheDocument();
  });
});

describe("PW-03 有効にする順番", () => {
  it("押したときだけ許可を求め、登録が成功してから「有効」と出す", async () => {
    const requestPermission = vi.fn(() =>
      Promise.resolve("granted" as NotificationPermission),
    );
    const { subscribe } = stubPushEnv({
      permission: "default",
      requestPermission,
    });
    stubApi({
      subscriptions: vi
        .fn()
        .mockImplementationOnce(() => json({ items: [] }))
        .mockImplementation(() =>
          json({ items: [subscriptionRow({ isCurrentSession: true })] }),
        ),
    });
    renderScreen();

    expect(requestPermission).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("button", { name: "通知を有効にする" }),
    );
    expect(requestPermission).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalled();
    // 登録と一覧の再取得が済むと「有効」に変わる。
    await waitFor(() => {
      expect(screen.getByText("有効")).toBeInTheDocument();
    });
  });

  it("登録が失敗したら「有効」にしない", async () => {
    stubPushEnv({ permission: "default" });
    stubApi({
      register: () => json({ code: "INVALID" }, 500),
    });
    renderScreen();
    await userEvent.click(
      await screen.findByRole("button", { name: "通知を有効にする" }),
    );
    expect(
      await screen.findByText("登録できませんでした。もう一度お試しください。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("有効")).not.toBeInTheDocument();
  });
});

describe("PW-04 鍵を替えたあと", () => {
  it("今の購読の鍵が公開鍵と違えば解除してから登録する", async () => {
    const oldKeySubscription = browserSubscriptionMock({
      applicationServerKey: new Uint8Array([1, 2, 3]).buffer,
    });
    const { subscribe } = stubPushEnv({
      permission: "granted",
      subscription: oldKeySubscription,
    });
    window.localStorage.setItem(
      "tomotabi:push-subscription:" + userId,
      ownSubscriptionId,
    );
    // api-disabled（行はあるがenabled=false）の画面から「登録し直す」で進める。
    stubApi({
      subscriptions: () =>
        json({ items: [subscriptionRow({ enabled: false })] }),
    });
    renderScreen();
    await userEvent.click(
      await screen.findByRole("button", { name: "登録し直す" }),
    );
    await waitFor(() => {
      expect(oldKeySubscription.unsubscribe).toHaveBeenCalled();
      expect(subscribe).toHaveBeenCalled();
    });
  });

  it("409 PUSH_KEY_CHANGEDなら公開鍵を取り直して1回だけやり直す", async () => {
    stubPushEnv({ permission: "default" });
    const configFetch = vi.fn(() => json(configBody));
    const register = vi
      .fn()
      .mockImplementationOnce(() => json({ code: "PUSH_KEY_CHANGED" }, 409))
      .mockImplementationOnce(() => json(subscriptionRow(), 201));
    stubApi({
      config: configFetch,
      register,
      subscriptions: vi
        .fn()
        .mockImplementationOnce(() => json({ items: [] }))
        .mockImplementation(() => json({ items: [subscriptionRow()] })),
    });
    renderScreen();
    await userEvent.click(
      await screen.findByRole("button", { name: "通知を有効にする" }),
    );
    await waitFor(() => {
      expect(register).toHaveBeenCalledTimes(2);
      expect(configFetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    await waitFor(() => {
      expect(screen.getByText("有効")).toBeInTheDocument();
    });
  });
});

describe("PW-05 端末の一覧", () => {
  it("有効な端末を出し、「この端末」の印、ほかの端末に「止める」", async () => {
    stubPushEnv({ permission: "granted", subscription: browserSubscriptionMock() });
    window.localStorage.setItem(
      "tomotabi:push-subscription:" + userId,
      ownSubscriptionId,
    );
    stubApi({
      subscriptions: () =>
        json({
          items: [
          subscriptionRow(),
          {
            id: otherSubscriptionId,
            deviceLabel: "Pixel 9",
            enabled: true,
            vapidKeyState: "current",
            isCurrentSession: false,
            updatedAt: "2026-10-01T10:00:00.000Z",
          },
          {
            id: "99999999-8888-4777-8666-555555555555",
            deviceLabel: "古いiPhone",
            enabled: false,
            vapidKeyState: "current",
            isCurrentSession: false,
            updatedAt: "2026-09-01T10:00:00.000Z",
          },
          ],
        }),
    });
    renderScreen();
    expect(
      await screen.findByText("通知を受け取る端末（2 / 3台）"),
    ).toBeInTheDocument();
    // 無効な行は出さない。
    expect(screen.queryByText("古いiPhone")).not.toBeInTheDocument();
    expect(screen.getByText("Pixel 9")).toBeInTheDocument();
    // ほかの端末だけ「止める」。
    const row = screen.getByText("Pixel 9").closest("li")!;
    expect(
      row.querySelector("button")?.textContent,
    ).toBe("止める");
  });

  it("3台いっぱい（409 PUSH_LIMIT_REACHED）なら一覧で止める案内", async () => {
    stubPushEnv({ permission: "default" });
    stubApi({
      register: () => json({ code: "PUSH_LIMIT_REACHED" }, 409),
    });
    renderScreen();
    await userEvent.click(
      await screen.findByRole("button", { name: "通知を有効にする" }),
    );
    expect(
      await screen.findByText(/使える端末は3台までです/),
    ).toBeInTheDocument();
  });
});

describe("PW-06 止める", () => {
  it("「この端末の通知を止める」でAPIを無効にし、ブラウザの購読も解除する", async () => {
    const subscription = browserSubscriptionMock();
    stubPushEnv({ permission: "granted", subscription });
    window.localStorage.setItem(
      "tomotabi:push-subscription:" + userId,
      ownSubscriptionId,
    );
    const disable = vi.fn(() => new Response(null, { status: 204 }));
    stubApi({
      subscriptions: vi
        .fn()
        .mockImplementationOnce(() => json({ items: [subscriptionRow()] }))
        .mockImplementation(() => json({ items: [] })),
      disable,
    });
    renderScreen();
    await userEvent.click(
      await screen.findByRole("button", { name: "この端末の通知を止める" }),
    );
    await waitFor(() => {
      expect(disable).toHaveBeenCalled();
      expect(subscription.unsubscribe).toHaveBeenCalled();
    });
    // 記憶が消え、有効な行が無くなると「まだ有効にしていない」に戻る。
    expect(
      window.localStorage.getItem(
        "tomotabi:push-subscription:" + userId,
      ),
    ).toBeNull();
  });

  it("同じセッションに有効な行が新旧並ぶときは、記憶した購読の行を止める", async () => {
    const subscription = browserSubscriptionMock();
    stubPushEnv({ permission: "granted", subscription });
    // 購読を作り直したあとの状態: APIの一覧には新旧どちらも
    // isCurrentSessionの有効な行（作成の昇順で古い行が先頭）。
    // 記憶は新しい行を指す。
    const oldRowId = "22222222-3333-4444-8555-666666666666";
    window.localStorage.setItem(
      "tomotabi:push-subscription:" + userId,
      ownSubscriptionId,
    );
    const disabledUrls: string[] = [];
    stubApi({
      subscriptions: () =>
        json({
          items: [
            subscriptionRow({ id: oldRowId }),
            subscriptionRow({ id: ownSubscriptionId }),
          ],
        }),
      disable: (_init, url) => {
        disabledUrls.push(url ?? "");
        return new Response(null, { status: 204 });
      },
    });
    renderScreen();
    await userEvent.click(
      await screen.findByRole("button", { name: "この端末の通知を止める" }),
    );
    // 先頭の古い行ではなく、記憶した新しい購読の行を止める。
    await waitFor(() => {
      expect(disabledUrls).toEqual([
        `/api/me/push-subscriptions/${ownSubscriptionId}`,
      ]);
    });
  });
});

describe("PW-07 利用者の切り替え", () => {
  it("覚えた購読の持ち主が違えば、解除してから登録する", async () => {
    // 前の人（otherUserId）の購読IDが残っていて、APIにはこの
    // endpointの有効な行が無い（ブラウザだけの購読）。
    window.localStorage.setItem(
      "tomotabi:push-subscription:" + otherUserId,
      otherSubscriptionId,
    );
    const oldSubscription = browserSubscriptionMock();
    stubPushEnv({
      permission: "granted",
      subscription: oldSubscription,
    });
    const register = vi.fn(() => json({ id: ownSubscriptionId }, 201));
    stubApi({ register });
    renderScreen();
    await userEvent.click(
      await screen.findByRole("button", { name: "登録し直す" }),
    );
    await waitFor(() => {
      expect(oldSubscription.unsubscribe).toHaveBeenCalled();
      expect(register).toHaveBeenCalled();
    });
  });

  it("解除に失敗したら登録しない", async () => {
    window.localStorage.setItem(
      "tomotabi:push-subscription:" + otherUserId,
      otherSubscriptionId,
    );
    const oldSubscription = browserSubscriptionMock({
      unsubscribeResult: false,
    });
    // permission default →「まだ有効にしていない」のボタンから進める。
    stubPushEnv({
      permission: "default",
      subscription: oldSubscription,
    });
    const register = vi.fn(() => json(subscriptionRow(), 201));
    stubApi({ register });
    renderScreen();
    await userEvent.click(
      await screen.findByRole("button", { name: "通知を有効にする" }),
    );
    expect(
      await screen.findByText(/前に使っていた人の通知が残っています/),
    ).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });
});

describe("PW-08・PW-09 ホームの案内のカード", () => {
  it("使える・拒否していない・有効でない・閉じていないとき出る", async () => {
    stubPushEnv({ permission: "default" });
    stubApi({ subscriptions: () => json({ items: [] }) });
    renderGuideCard();
    expect(
      await screen.findByText("あおいの記録を通知で受け取る"),
    ).toBeInTheDocument();
  });

  it("使えない環境では出さない", async () => {
    stubPushEnv({ hasPushManager: false });
    stubApi({});
    renderGuideCard();
    await waitFor(() => {
      expect(
        screen.queryByText(/記録を通知で受け取る/),
      ).not.toBeInTheDocument();
    });
  });

  it("この端末が有効なら出さない（記憶が無くても同じ）", async () => {
    // 記憶を入れないまま、isCurrentSessionの有効な行だけがある状態。
    const fetchMock = stubApi({
      subscriptions: () => json({ items: [subscriptionRow()] }),
    });
    stubPushEnv({
      permission: "granted",
      subscription: browserSubscriptionMock(),
    });
    renderGuideCard();
    // 一覧の取得が済んだあとも出さないことを確かめる。
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          urlOf(input).includes("/api/me/push-subscriptions"),
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        screen.queryByText(/記録を通知で受け取る/),
      ).not.toBeInTheDocument();
    });
  });

  it("許可を断った端末では出さない", async () => {
    stubPushEnv({ permission: "denied" });
    stubApi({ subscriptions: () => json({ items: [] }) });
    renderGuideCard();
    await waitFor(() => {
      expect(
        screen.queryByText(/記録を通知で受け取る/),
      ).not.toBeInTheDocument();
    });
  });

  it("閉じたら同じ人・同じ端末では出さない。別の人なら出す", async () => {
    stubPushEnv({ permission: "default" });
    stubApi({ subscriptions: () => json({ items: [] }) });
    const first = renderGuideCard();
    await userEvent.click(
      await screen.findByRole("button", { name: "閉じる" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByText(/記録を通知で受け取る/),
      ).not.toBeInTheDocument();
    });
    first.unmount();
    // 同じ人では出ない。
    renderGuideCard();
    await waitFor(() => {
      expect(
        screen.queryByText(/記録を通知で受け取る/),
      ).not.toBeInTheDocument();
    });
    cleanup();
    // 別の人なら出る。
    renderGuideCard({ userId: otherUserId });
    expect(
      await screen.findByText(/記録を通知で受け取る/),
    ).toBeInTheDocument();
  });

  it("localStorageが読めなくても画面が出る（閉じた記録が読めなければ出す）", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    stubPushEnv({ permission: "default" });
    stubApi({ subscriptions: () => json({ items: [] }) });
    renderGuideCard();
    expect(
      await screen.findByText(/記録を通知で受け取る/),
    ).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("「通知を有効にする」はその場で登録する", async () => {
    const { subscribe } = stubPushEnv({ permission: "default" });
    stubApi({ subscriptions: () => json({ items: [subscriptionRow()] }) });
    renderGuideCard();
    await userEvent.click(
      await screen.findByRole("button", { name: "通知を有効にする" }),
    );
    await waitFor(() => {
      expect(subscribe).toHaveBeenCalled();
    });
  });

  it("iPhoneでホーム画面への追加が要るときは設定の画面へ移る", async () => {
    stubPushEnv({
      hasPushManager: false,
      hasNotification: false,
      standalone: false,
    });
    stubApi({ subscriptions: () => json({ items: [] }) });
    renderGuideCard();
    await userEvent.click(
      await screen.findByRole("button", { name: "通知を有効にする" }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      `/settings/notifications?from=${encodeURIComponent(`/trips/${tripId}/home`)}`,
    );
  });
});
