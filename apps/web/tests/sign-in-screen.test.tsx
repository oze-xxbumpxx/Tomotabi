import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signInSocial } = vi.hoisted(() => ({ signInSocial: vi.fn() }));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signIn: { social: signInSocial } },
}));

import SignInPage from "@/app/sign-in/page";
import { SignInScreen } from "@/screens/sign-in/sign-in-screen";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignInScreen", () => {
  it("W-01: shows only the Google sign-in button", () => {
    const { container } = render(<SignInScreen hasError={false} />);

    expect(
      screen.getByRole("button", { name: "Google でログイン" }),
    ).toBeInTheDocument();
    expect(screen.getByText("tomotabi")).toBeInTheDocument();
    // メール欄・登録導線・同意文は置かない
    expect(container.querySelector("input")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/同意|利用規約|登録/)).not.toBeInTheDocument();
  });

  it("W-02: starts Google sign-in with callbackURL /", async () => {
    render(<SignInScreen hasError={false} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Google でログイン" }),
    );

    expect(signInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/",
    });
  });
});

describe("/sign-in page", () => {
  it("W-03: shows a generic error and never the error value", async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({ error: "access_denied" }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "ログインできませんでした。時間をおいて、もう一度お試しください。",
    );
    expect(screen.queryByText(/access_denied/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Google でログイン" }),
    ).toBeInTheDocument();
  });

  it("shows no error without the error parameter", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
