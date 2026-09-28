import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import {
  RefetchFailed,
  Refetching,
} from "@/shared/ui/state/refetch-failed";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("W-13: 開けない（C-2）は 403 と 404 で同じ文言", () => {
  it.each([
    ["trip", "この旅行を開けません"],
    ["item", "この項目を開けません"],
  ] as const)(
    "%s の文言と「旅行一覧へ」を出す",
    async (target, title) => {
      const onGoToTrips = vi.fn();
      const user = userEvent.setup();
      render(<NotAvailable target={target} onGoToTrips={onGoToTrips} />);

      expect(screen.getByText(title)).toBeInTheDocument();
      expect(
        screen.getByText("削除されたか、開く権限がありません。"),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "旅行一覧へ" }));
      expect(onGoToTrips).toHaveBeenCalledTimes(1);
    },
  );
});

describe("W-14: 再取得の失敗は前回の表示を残す", () => {
  it("前回の内容のまま「更新できていません」と取得時刻と再試行を出す", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <section>
        <p>前回の表示内容</p>
        <RefetchFailed
          fetchedAt={new Date(2026, 8, 28, 12, 40)}
          onRetry={onRetry}
        />
      </section>,
    );

    expect(screen.getByText("前回の表示内容")).toBeInTheDocument();
    expect(
      screen.getByText("更新できていません · 12:40 時点"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("初回の取得失敗は「取得できませんでした」と再試行を出す", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<FetchFailed onRetry={onRetry} />);

    expect(screen.getByText("取得できませんでした")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("読み込み中と更新中を出す", () => {
    render(
      <>
        <Loading />
        <Refetching />
      </>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
    expect(screen.getByText("更新中")).toBeInTheDocument();
  });
});

function OfflineForm() {
  const online = useOnlineStatus();
  return (
    <div>
      {!online ? (
        <OfflineBanner at={new Date(2026, 8, 28, 9, 30)} />
      ) : null}
      <button type="button" disabled={!online}>
        保存
      </button>
      {!online ? <span>オフラインのため保存できません</span> : null}
    </div>
  );
}

describe("W-15: オフライン（C-3）", () => {
  it("帯を出し、保存につながるボタンを押せなくする", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineForm />);

    expect(
      screen.getByText("インターネットに接続できません"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/表示は 09:30 時点の内容です。保存はできません。/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(
      screen.getByText("オフラインのため保存できません"),
    ).toBeInTheDocument();
  });

  it("サーバー描画でも navigator を参照せず落ちない", () => {
    expect(() => renderToString(<OfflineForm />)).not.toThrow();
  });

  it("オンラインでは帯を出さずボタンを押せる", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineForm />);

    expect(
      screen.queryByText("インターネットに接続できません"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });
});
