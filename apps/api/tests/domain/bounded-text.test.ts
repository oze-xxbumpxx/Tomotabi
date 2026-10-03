import { describe, expect, it } from "vitest";
import { BoundedText } from "../../src/common/domain/bounded-text";

describe("BoundedText", () => {
  it("U-01: 前後の空白を除いて返す", () => {
    expect(BoundedText.parse("  京都  ", 100)).toBe("京都");
  });

  it("U-02: 空白だけ・空文字は例外", () => {
    expect(() => BoundedText.parse("   ", 100)).toThrow();
    expect(() => BoundedText.parse("", 100)).toThrow();
  });

  it("U-03: 上限はコードポイントで数える", () => {
    expect(BoundedText.parse("あ".repeat(100), 100)).toBe("あ".repeat(100));
    expect(() => BoundedText.parse("あ".repeat(101), 100)).toThrow();
    // 絵文字100個はUTF-16では200だが、コードポイントでは100なので通る
    const emoji = "🍣".repeat(100);
    expect(emoji.length).toBe(200);
    expect(BoundedText.parse(emoji, 100)).toBe(emoji);
  });

  it("U-03: トリム後に上限へ収まれば通る", () => {
    expect(BoundedText.parse(` ${"あ".repeat(100)} `, 100)).toBe("あ".repeat(100));
  });

  describe("U-04: メモ用の省略可変種", () => {
    it("空・空白だけ・null・undefined は null", () => {
      expect(BoundedText.parseOptional("", 2000)).toBeNull();
      expect(BoundedText.parseOptional("   ", 2000)).toBeNull();
      expect(BoundedText.parseOptional(null, 2000)).toBeNull();
      expect(BoundedText.parseOptional(undefined, 2000)).toBeNull();
    });

    it("改行・内部の空白は保持し、前後は除く", () => {
      expect(BoundedText.parseOptional("a\n  b", 2000)).toBe("a\n  b");
      expect(BoundedText.parseOptional("  伏見稲荷へ  ", 2000)).toBe("伏見稲荷へ");
    });

    it("2000 ちょうどは通り、2001 は例外", () => {
      expect(BoundedText.parseOptional("あ".repeat(2000), 2000)).toBe("あ".repeat(2000));
      expect(() => BoundedText.parseOptional("あ".repeat(2001), 2000)).toThrow();
    });
  });
});
