// Response bodies and error messages are deliberately not carried: the UI must not display server text.
export type ApiFailure =
  | { kind: "network" }
  | { kind: "http"; status: number }
  | { kind: "invalid-json" }
  | { kind: "validation" };

export class ApiRequestError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(`API request failed: ${failure.kind}`);
    this.name = "ApiRequestError";
  }
}
