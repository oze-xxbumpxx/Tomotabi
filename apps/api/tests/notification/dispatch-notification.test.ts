import { describe, expect, it } from "vitest";
import type { UserId } from "../../src/common/domain/user-id";
import type { NotificationEvent } from "../../src/modules/notification/domain/notification-event";
import type {
  DispatchContext,
  DispatchTarget,
  NotificationDispatchStore,
} from "../../src/modules/notification/adapter/outbound/notification-dispatch-store";
import type {
  DispatchLog,
  DispatchLogEntry,
} from "../../src/modules/notification/adapter/outbound/dispatch-log.port";
import type {
  PushSender,
  PushSendOutcome,
  PushSendRequest,
} from "../../src/modules/notification/adapter/outbound/push-sender";
import type { VapidKeyringPort } from "../../src/modules/notification/adapter/outbound/vapid-keyring.port";
import type { VapidKey } from "../../src/modules/notification/domain/vapid-keyring";
import { DispatchNotificationUseCase } from "../../src/modules/notification/usecase/dispatch-notification.usecase";
import type { Clock } from "../../src/adapter/clock/clock";

const ACTOR = "00000000-0000-4000-8000-000000000001" as UserId;
const PARTNER = "00000000-0000-4000-8000-000000000002" as UserId;
const TRIP_ID = "99999999-9999-4999-8999-999999999999";
const SUB_ID = "sub-00000000-0000-4000-8000-000000000001";
const KEY_ID = "vapid-1";
/** 宛先の許可リスト内の正しい宛先。値は秘密としてテストにのみ使う。 */
const VALID_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

const vapidKey: VapidKey = {
  keyId: KEY_ID,
  state: "current",
  publicKey: "BPubKey",
  privateKey: "PrivKey",
};

function targetOf(overrides: Partial<DispatchTarget> = {}): DispatchTarget {
  return {
    subscriptionId: SUB_ID,
    userId: PARTNER,
    endpoint: VALID_ENDPOINT,
    p256dh: Buffer.alloc(65, 4),
    authSecret: Buffer.alloc(16, 7),
    vapidKeyId: KEY_ID,
    revision: 3n,
    ...overrides,
  };
}

function eventOf(): NotificationEvent {
  return {
    eventId: "evt-1",
    action: "plan_added",
    targetKind: "plan",
    tripId: TRIP_ID,
    targetId: "plan-1",
    actorUserId: ACTOR,
    occurredAt: "2026-09-05T12:00:00.000Z",
  };
}

class FakeStore implements NotificationDispatchStore {
  context: DispatchContext | null = {
    actorName: "はな",
    tripName: "京都の旅",
    targets: [targetOf()],
  };
  disabled: { id: string; revision: bigint }[] = [];
  async readDispatchContext() {
    return this.context;
  }
  async disableIfSameRevision(subscriptionId: string, revision: bigint) {
    this.disabled.push({ id: subscriptionId, revision });
    return true;
  }
}

class FakeSender implements PushSender {
  requests: PushSendRequest[] = [];
  next: "respond" | "throw" = "respond";
  status = 201;
  async send(request: PushSendRequest): Promise<PushSendOutcome> {
    this.requests.push(request);
    if (this.next === "throw") {
      throw new Error(`send failed to ${request.endpoint}`);
    }
    return { status: this.status, durationMs: 12 };
  }
}

function keyringOf(key: VapidKey | null = vapidKey): VapidKeyringPort {
  return {
    snapshot: { status: "ready", subject: "mailto:x@example.com", current: vapidKey, keys: new Map() },
    keyFor: () => key,
  };
}

function logOf(): DispatchLog & { entries: DispatchLogEntry[]; warnings: DispatchLogEntry[] } {
  const entries: DispatchLogEntry[] = [];
  const warnings: DispatchLogEntry[] = [];
  return {
    entries,
    warnings,
    info: (entry) => entries.push(entry),
    warn: (entry) => {
      entries.push(entry);
      warnings.push(entry);
    },
  };
}

const clock: Clock = {
  now: () => new Date("2026-09-05T12:00:00.000Z"),
  today: () => {
    throw new Error("unused");
  },
};

function setup(overrides: {
  store?: FakeStore;
  sender?: FakeSender;
  keyring?: VapidKeyringPort;
} = {}) {
  const store = overrides.store ?? new FakeStore();
  const sender = overrides.sender ?? new FakeSender();
  const keyring = overrides.keyring ?? keyringOf();
  const log = logOf();
  const usecase = new DispatchNotificationUseCase(
    store,
    keyring,
    sender,
    clock,
    log,
  );
  return { store, sender, keyring, log, usecase };
}

// PU-06: 応答ごとの扱い
describe("送る結果の扱い（PU-06）", () => {
  it.each([
    [200, "accepted"],
    [201, "accepted"],
    [204, "accepted"],
    [404, "gone"],
    [410, "gone"],
    [400, "config_error"],
    [401, "config_error"],
    [403, "config_error"],
    [429, "dropped"],
    [500, "dropped"],
    [503, "dropped"],
    [301, "dropped"], // 転送は追わない
  ])("HTTP %s は %s", async (status, result) => {
    const sender = new FakeSender();
    sender.status = status;
    const { usecase, log, store } = setup({ sender });
    await usecase.execute(eventOf());
    expect(sender.requests).toHaveLength(1);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.result).toBe(result);
    expect(log.entries[0]?.status).toBe(status);
    expect(log.entries[0]?.eventId).toBe("evt-1");
    expect(log.entries[0]?.subscriptionId).toBe(SUB_ID);
    // config_errorはwarn、それ以外はinfo。
    if (result === "config_error") {
      expect(log.warnings).toHaveLength(1);
    } else {
      expect(log.warnings).toHaveLength(0);
    }
    // goneのときだけ購読を無効にする（同じ版のときだけ）。
    if (result === "gone") {
      expect(store.disabled).toEqual([{ id: SUB_ID, revision: 3n }]);
    } else {
      expect(store.disabled).toHaveLength(0);
    }
  });

  it("通信の失敗・時間切れはdroppedとして記録する", async () => {
    const sender = new FakeSender();
    sender.next = "throw";
    const { usecase, log, store } = setup({ sender });
    await usecase.execute(eventOf());
    expect(log.entries[0]?.result).toBe("dropped");
    expect(log.entries[0]?.status).toBeNull();
    expect(store.disabled).toHaveLength(0);
    // 例外のmessage（宛先を含み得る）はログに出さない。
    expect(JSON.stringify(log.entries)).not.toContain(VALID_ENDPOINT);
  });
});

describe("送らない判定", () => {
  it("対象が消えた（旅行・操作した人の行が無い）ときは何もしない", async () => {
    const store = new FakeStore();
    store.context = null;
    const sender = new FakeSender();
    const { usecase, log } = setup({ store, sender });
    await usecase.execute(eventOf());
    expect(sender.requests).toHaveLength(0);
    expect(log.entries).toHaveLength(0);
  });

  it("許可リスト外の宛先の購読には送らず、droppedと理由を記録する（N-01）", async () => {
    const store = new FakeStore();
    store.context = {
      actorName: "はな",
      tripName: "京都の旅",
      targets: [targetOf({ endpoint: "https://evil.example.com/x" })],
    };
    const sender = new FakeSender();
    const { usecase, log } = setup({ store, sender });
    await usecase.execute(eventOf());
    expect(sender.requests).toHaveLength(0);
    expect(log.entries[0]?.result).toBe("dropped");
    expect(log.entries[0]?.reason).toBe("host_not_allowed");
    expect(JSON.stringify(log.entries)).not.toContain("evil.example.com");
  });

  it("revoked・一覧に無い鍵の購読には送らない（F-72）", async () => {
    for (const key of [
      null,
      { keyId: KEY_ID, state: "revoked" as const, publicKey: null, privateKey: null },
      { keyId: KEY_ID, state: "current" as const, publicKey: "P", privateKey: null },
    ]) {
      const sender = new FakeSender();
      const { usecase, log } = setup({ sender, keyring: keyringOf(key) });
      await usecase.execute(eventOf());
      expect(sender.requests).toHaveLength(0);
      expect(log.entries[0]?.result).toBe("dropped");
      expect(log.entries[0]?.reason).toBe("key_unavailable");
    }
  });

  it("購読が記録したvapid_key_idの鍵で送る（F-71）", async () => {
    const retired: VapidKey = {
      keyId: "vapid-0",
      state: "retired",
      publicKey: "BPub0",
      privateKey: "Priv0",
    };
    const store = new FakeStore();
    store.context = {
      actorName: "はな",
      tripName: "京都の旅",
      targets: [targetOf({ vapidKeyId: "vapid-0" })],
    };
    const sender = new FakeSender();
    const keyring: VapidKeyringPort = {
      snapshot: {
        status: "ready",
        subject: "mailto:x@example.com",
        current: vapidKey,
        keys: new Map(),
      },
      keyFor: (keyId) => (keyId === "vapid-0" ? retired : null),
    };
    const { usecase } = setup({ store, sender, keyring });
    await usecase.execute(eventOf());
    expect(sender.requests).toHaveLength(1);
    expect(sender.requests[0]?.vapidKey.keyId).toBe("vapid-0");
    expect(sender.requests[0]?.subject).toBe("mailto:x@example.com");
    expect(sender.requests[0]?.endpoint).toBe(VALID_ENDPOINT);
  });

  it("PT-03: 同時に送るのは3件まで。4件目は先の1件が終わってから始まる", async () => {
    const targets = Array.from({ length: 7 }, (_, i) =>
      targetOf({ subscriptionId: `sub-${i}` }),
    );
    const store = new FakeStore();
    store.context = {
      actorName: "はな",
      tripName: "京都の旅",
      targets,
    };
    // 呼ばれた数のピークを測る偽物の送る部品。
    let inFlight = 0;
    let peak = 0;
    const sender: PushSender = {
      async send() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return { status: 201, durationMs: 10 };
      },
    };
    const { usecase, log } = setup({ store, sender });
    await usecase.execute(eventOf());
    expect(peak).toBe(3);
    expect(log.entries).toHaveLength(7);
  });

  it("複数の購読へそれぞれ送り、結果は購読ごとに記録する", async () => {
    const store = new FakeStore();
    store.context = {
      actorName: "はな",
      tripName: "京都の旅",
      targets: [
        targetOf({ subscriptionId: "sub-a" }),
        targetOf({ subscriptionId: "sub-b" }),
      ],
    };
    const sender = new FakeSender();
    sender.status = 201;
    const { usecase, log } = setup({ store, sender });
    await usecase.execute(eventOf());
    expect(sender.requests).toHaveLength(2);
    expect(log.entries.map((entry) => entry.subscriptionId).sort()).toEqual([
      "sub-a",
      "sub-b",
    ]);
  });
});
