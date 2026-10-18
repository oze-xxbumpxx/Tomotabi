import { describe, expect, it } from "vitest";
import { blockPinchZoom } from "../src/shared/lib/block-pinch-zoom";

function touchMove(touches: number): Event {
  const event = new Event("touchmove", { cancelable: true });
  Object.defineProperty(event, "touches", { value: { length: touches } });
  return event;
}

describe("blockPinchZoom", () => {
  it("2本指の拡大（gesturestart・gesturechange）を打ち消す", () => {
    const release = blockPinchZoom(document);
    for (const type of ["gesturestart", "gesturechange"]) {
      const event = new Event(type, { cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    release();
  });

  it("2本指で動かしたときだけ止め、1本指のスクロールは止めない", () => {
    const release = blockPinchZoom(document);
    const two = touchMove(2);
    const one = touchMove(1);
    document.dispatchEvent(two);
    document.dispatchEvent(one);
    expect(two.defaultPrevented).toBe(true);
    expect(one.defaultPrevented).toBe(false);
    release();
  });

  it("外したあとは止めない", () => {
    blockPinchZoom(document)();
    const event = new Event("gesturestart", { cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
