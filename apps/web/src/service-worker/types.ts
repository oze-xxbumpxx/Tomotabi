/**
 * Service WorkerのDOM型（lib "webworker"はlib "dom"と衝突するため、
 * 使う部分だけを構造で定義する。試験では偽物をこの形に合わせる）。
 */
export type PushEventLike = {
  data: { json(): unknown } | null;
  waitUntil(task: Promise<unknown>): void;
};

export type NotificationClickEventLike = {
  notification: { data: unknown; close(): void };
  waitUntil(task: Promise<unknown>): void;
};

export type WindowClientLike = {
  url: string;
  focus(): Promise<WindowClientLike>;
  navigate(url: string): Promise<WindowClientLike>;
};

export type ClientsLike = {
  matchAll(options: {
    type: "window";
    includeUncontrolled: boolean;
  }): Promise<readonly WindowClientLike[]>;
  openWindow(url: string): Promise<unknown>;
};

export type ServiceWorkerScopeLike = {
  location: { origin: string };
  clients: ClientsLike;
  registration: {
    showNotification(
      title: string,
      options?: { body?: string; tag?: string; data?: unknown },
    ): Promise<void>;
  };
  addEventListener(
    type: "push",
    listener: (event: PushEventLike) => void,
  ): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: NotificationClickEventLike) => void,
  ): void;
};
