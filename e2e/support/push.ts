import type { Page } from "@playwright/test";

/**
 * ブラウザの通知の購読（PushManager.subscribe）を、Playwright内で
 * 動く見せかけに差し替える（Issue #205）。実機・実push配信は
 * 確かめない（PM-03は最後の受け入れに回す）。
 *
 * - Notification.requestPermission / Notification.permission は
 *   localStorageの保存値を返す見せかけにする（headlessの実APIは
 *   permissionがdeniedに固定されるため。許可の流れそのものを試す
 *   ため「default → granted」を再現する）。
 * - PushManager.subscribe はheadlessだとpushサービスに届かないため、
 *   navigator.serviceWorker が返す登録（register / getRegistration /
 *   ready）のpushManagerだけを見せかけにする。ServiceWorkerの登録
 *   そのものは実物（/sw.js）を通す。
 * - 作った購読はlocalStorageに持ち、page.gotoの画面遷移を跨いで残る。
 *   p256dhは実P-256の点・authは16バイトで、APIの購読の検証
 *   （on-curve・endpoint host・長さ）をそのまま通る。
 */
const PUSH_STUB_SOURCE = String.raw`(() => {
  const SUB_KEY = "e2e:fake-push-subscription";
  const PERMISSION_KEY = "e2e:notification-permission";

  const readPermission = () => {
    try {
      return localStorage.getItem(PERMISSION_KEY) ?? "default";
    } catch {
      return "default";
    }
  };
  const writePermission = (value) => {
    try {
      localStorage.setItem(PERMISSION_KEY, value);
    } catch {
      // 保存できなくても見せかけは成立させる
    }
  };
  class FakeNotification extends EventTarget {
    static get permission() {
      return readPermission();
    }
    static requestPermission() {
      writePermission("granted");
      return Promise.resolve("granted");
    }
  }
  Object.defineProperty(window, "Notification", {
    configurable: true,
    writable: true,
    value: FakeNotification,
  });

  const b64ToBytes = (b64) =>
    Uint8Array.from(
      atob(b64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
  const bytesToB64 = (bytes) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const readSub = () => {
    try {
      const raw = localStorage.getItem(SUB_KEY);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const writeSub = (sub) => {
    try {
      if (sub === null) {
        localStorage.removeItem(SUB_KEY);
      } else {
        localStorage.setItem(SUB_KEY, JSON.stringify(sub));
      }
    } catch {
      // localStorageが使えなくても、登録の見せかけとしては成立させる
    }
  };

  const makeSubscription = (stored) => ({
    endpoint: stored.endpoint,
    expirationTime: stored.expirationTime,
    options: {
      applicationServerKey: new Uint8Array(stored.applicationServerKey).buffer,
      userVisibleOnly: true,
    },
    getKey: (name) =>
      b64ToBytes(name === "p256dh" ? stored.keys.p256dh : stored.keys.auth),
    toJSON: () => ({
      endpoint: stored.endpoint,
      expirationTime: stored.expirationTime,
      keys: { p256dh: stored.keys.p256dh, auth: stored.keys.auth },
    }),
    unsubscribe: async () => {
      writeSub(null);
      return true;
    },
  });

  const fakePushManager = {
    getSubscription: async () => {
      const stored = readSub();
      return stored === null ? null : makeSubscription(stored);
    },
    subscribe: async (options) => {
      // 実P-256の鍵の組を作り、0x04||X||Yの非圧縮点をp256dhとする
      // （apps/apiの購読の検証と同じ形。webpushの鍵の読み出しと同じ手順）。
      const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
      );
      const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
      const point = new Uint8Array(65);
      point[0] = 4;
      point.set(b64ToBytes(publicJwk.x), 1);
      point.set(b64ToBytes(publicJwk.y), 33);
      const auth = crypto.getRandomValues(new Uint8Array(16));
      const stored = {
        endpoint:
          "https://fcm.googleapis.com/fcm/send/e2e-" + crypto.randomUUID(),
        expirationTime: null,
        keys: { p256dh: bytesToB64(point), auth: bytesToB64(auth) },
        applicationServerKey: Array.from(
          new Uint8Array(options?.applicationServerKey ?? new ArrayBuffer(0)),
        ),
      };
      writeSub(stored);
      return makeSubscription(stored);
    },
    permissionState: async () => "granted",
  };

  const wrapRegistration = (registration) => {
    if (registration === null || registration === undefined) {
      return registration;
    }
    return new Proxy(registration, {
      get: (target, prop) => {
        if (prop === "pushManager") {
          return fakePushManager;
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };

  const real = navigator.serviceWorker;
  if (real === undefined || real === null) {
    return;
  }
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: new Proxy(real, {
      get: (target, prop) => {
        if (prop === "register") {
          return (...args) =>
            target.register.apply(target, args).then(wrapRegistration);
        }
        if (prop === "getRegistration") {
          return (...args) =>
            target.getRegistration.apply(target, args).then(wrapRegistration);
        }
        if (prop === "ready") {
          return target.ready.then(wrapRegistration);
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  });
})();`;

/**
 * この試験のcontextに通知の見せかけを入れる。
 * pageを作ったあと・最初のpage.gotoの前に呼ぶ（addInitScriptは
 * 以後の遷移で評価される）。
 */
export async function preparePushStub(page: Page): Promise<void> {
  await page.context().addInitScript(PUSH_STUB_SOURCE);
}
