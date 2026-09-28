import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiRequestError, type ApiFailure } from "@/shared/api/api-failure";
import { createQueryClient } from "@/shared/api/query-client";

afterEach(cleanup);

function retryPredicate() {
  const retry = createQueryClient().getDefaultOptions().queries?.retry;
  expect(typeof retry).toBe("function");
  return retry as (failureCount: number, error: unknown) => boolean;
}

describe("createQueryClient", () => {
  it("retries a network failure exactly once", () => {
    const retry = retryPredicate();
    expect(retry(0, { kind: "network" } satisfies ApiFailure)).toBe(true);
    expect(retry(1, { kind: "network" } satisfies ApiFailure)).toBe(false);
  });

  it("retries an ApiRequestError-wrapped network failure", () => {
    const retry = retryPredicate();
    expect(retry(0, new ApiRequestError({ kind: "network" }))).toBe(true);
  });

  it.each([
    { kind: "http", status: 500, code: "TEMPORARILY_UNAVAILABLE" },
    { kind: "http", status: 422, code: "VALIDATION_FAILED" },
    { kind: "http", status: 401, code: "UNAUTHENTICATED" },
    { kind: "invalid-json" },
    { kind: "validation" },
  ] satisfies ApiFailure[])(
    "does not retry %j",
    (failure) => {
      const retry = retryPredicate();
      expect(retry(0, failure)).toBe(false);
      expect(retry(0, new ApiRequestError(failure))).toBe(false);
    },
  );

  it("uses staleTime 0 and refetches on window focus", () => {
    const queries = createQueryClient().getDefaultOptions().queries;
    expect(queries?.staleTime).toBe(0);
    expect(queries?.refetchOnWindowFocus).toBe(true);
  });

  it("does not retry mutations automatically", () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(
      false,
    );
  });
});

describe("QueryClientProvider on Next.js 16 / React 19", () => {
  it("runs a query through the app provider and renders data", async () => {
    function Probe() {
      const query = useQuery({
        queryKey: ["probe"],
        queryFn: () => Promise.resolve("取得できた"),
      });
      return <p>{query.status === "success" ? query.data : "読み込み中"}</p>;
    }

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("取得できた")).toBeInTheDocument(),
    );
  });
});
