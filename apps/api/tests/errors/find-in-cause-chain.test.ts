import { describe, expect, it } from "vitest";
import { someInCauseChain } from "../../src/common/errors/find-in-cause-chain";

function hasCode(code: string): (node: object) => boolean {
  return (node) => (node as { code?: unknown }).code === code;
}

function withCause(error: Error, cause: unknown): Error {
  (error as { cause?: unknown }).cause = cause;
  return error;
}

function chainOf(length: number): Error {
  const innermost = withCause(new Error("innermost"), null);
  let current = innermost;
  for (let i = 1; i < length; i += 1) {
    current = withCause(new Error(`node-${i}`), current);
  }
  return current;
}

describe("someInCauseChain", () => {
  it("先頭または cause の途中で predicate が真なら true", () => {
    expect(someInCauseChain(new Error("plain"), hasCode("x"))).toBe(false);

    const raw = Object.assign(new Error("raw"), { code: "23505" });
    expect(someInCauseChain(raw, hasCode("23505"))).toBe(true);

    const wrapped = withCause(new Error("wrapper"), raw);
    expect(someInCauseChain(wrapped, hasCode("23505"))).toBe(true);

    const nested = withCause(new Error("outer"), wrapped);
    expect(someInCauseChain(nested, hasCode("23505"))).toBe(true);
  });

  it("predicate がどこにも合わない・オブジェクトでない値だけなら false", () => {
    expect(someInCauseChain(new Error("other"), hasCode("23505"))).toBe(false);
    expect(someInCauseChain(null, hasCode("23505"))).toBe(false);
    expect(someInCauseChain("just a string", hasCode("23505"))).toBe(false);
    // causeがオブジェクトでなければそこで打ち切る
    const broken = withCause(new Error("top"), 42);
    expect(someInCauseChain(broken, hasCode("x"))).toBe(false);
  });

  it("cause が循環しても打ち切って false を返す", () => {
    const selfLoop = new Error("self loop");
    (selfLoop as { cause?: unknown }).cause = selfLoop;
    expect(someInCauseChain(selfLoop, hasCode("x"))).toBe(false);

    const inner = new Error("inner");
    const outer = new Error("outer");
    (inner as { cause?: unknown }).cause = outer;
    (outer as { cause?: unknown }).cause = inner;
    expect(someInCauseChain(outer, hasCode("x"))).toBe(false);
  });

  it("循環の中に合うノードがあれば打ち切る前に true を返す", () => {
    const matched = Object.assign(new Error("matched"), { code: "23505" });
    const cyclic = new Error("cyclic");
    (cyclic as { cause?: unknown }).cause = cyclic;
    (matched as { cause?: unknown }).cause = cyclic;
    expect(someInCauseChain(matched, hasCode("23505"))).toBe(true);
  });

  it("深さの上限（8 個）まで辿り、それより深いノードは見ない", () => {
    // 先頭を数えて8個目に一致がある: true
    const depth8 = chainOf(8);
    let tail: unknown = depth8;
    while ((tail as { cause?: unknown }).cause !== null) {
      tail = (tail as { cause?: unknown }).cause;
    }
    (tail as { code?: unknown }).code = "hit";
    expect(someInCauseChain(depth8, hasCode("hit"))).toBe(true);

    // 9個目に一致がある: 上限を超えるためfalse
    const depth9 = withCause(new Error("deeper"), depth8);
    expect(someInCauseChain(depth9, hasCode("hit"))).toBe(false);
  });
});
