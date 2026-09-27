import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signInSocial, replaceMock } = vi.hoisted(() => ({
  signInSocial: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signIn: { social: signInSocial } },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
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

  it("W-04: shows a generic error when sign-in returns an error", async () => {
    signInSocial.mockResolvedValue({
      data: null,
      error: { status: 503, code: "secret_code_x", message: "db down" },
    });
    render(<SignInScreen hasError={false} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Google でログイン" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ログインできませんでした。時間をおいて、もう一度お試しください。",
    );
    expect(screen.queryByText(/secret_code_x|db down|503/)).toBeNull();
  });

  it("W-05: shows a generic error when sign-in throws", async () => {
    signInSocial.mockRejectedValue(new Error("network exploded"));
    render(<SignInScreen hasError={false} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Google でログイン" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ログインできませんでした。時間をおいて、もう一度お試しください。",
    );
    expect(screen.queryByText(/network exploded/)).toBeNull();
  });

  it("keeps the generic error after the query is cleared", () => {
    const { rerender } = render(<SignInScreen hasError />);

    expect(replaceMock).toHaveBeenCalledWith("/sign-in");

    // router.replace("/sign-in") のあとの再描画（hasError=false）でも文が残る
    rerender(<SignInScreen hasError={false} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "ログインできませんでした。時間をおいて、もう一度お試しください。",
    );
  });

  it("shows only one alert when a retry from the error query also fails", async () => {
    signInSocial.mockResolvedValue({
      data: null,
      error: { status: 503, code: "secret_code_x", message: "db down" },
    });
    render(<SignInScreen hasError />);

    await userEvent.click(
      screen.getByRole("button", { name: "Google でログイン" }),
    );

    expect(await screen.findAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ログインできませんでした。時間をおいて、もう一度お試しください。",
    );
  });

  it("W-06: disables the button while sign-in is in flight", async () => {
    let resolveSignIn: (value: { data: null; error: null }) => void = () => {};
    signInSocial.mockImplementation(
      () =>
        new Promise<{ data: null; error: null }>((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    render(<SignInScreen hasError={false} />);

    const button = screen.getByRole("button", { name: "Google でログイン" });
    await userEvent.click(button);

    expect(signInSocial).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(signInSocial).toHaveBeenCalledTimes(1);

    resolveSignIn({ data: null, error: null });
    expect(await screen.findByRole("button")).toBeEnabled();
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

  it("W-07: clears the error query from the address bar but keeps the message", async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({ error: "signup_disabled" }),
      }),
    );

    expect(replaceMock).toHaveBeenCalledWith("/sign-in");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ログインできませんでした。時間をおいて、もう一度お試しください。",
    );
    expect(screen.queryByText(/signup_disabled/)).not.toBeInTheDocument();
  });

  it("shows no error without the error parameter", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
