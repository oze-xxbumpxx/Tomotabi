import { describe, expect, it } from "vitest";
import { BoundedText } from "../../src/common/domain/bounded-text";
import { TodoCategory } from "../../src/modules/planning/domain/todo-category";
import { parseTodoCategoryName } from "../../src/modules/planning/usecase/plan-input";
import { testCategory } from "../support/planning-context";

const AT = new Date("2026-09-05T12:00:00.000Z");

describe("カテゴリのDomain", () => {
  it("名前は1〜30文字で、前後の空白を除く", () => {
    expect(parseTodoCategoryName("  持ちもの  ")).toBe("持ちもの");
    expect(parseTodoCategoryName("あ".repeat(30))).toBe("あ".repeat(30));
    expect(() => parseTodoCategoryName("")).toThrow();
    expect(() => parseTodoCategoryName("   ")).toThrow();
    expect(() => parseTodoCategoryName("あ".repeat(31))).toThrow();
  });

  it("名前を変えると版が1つ増える", () => {
    const renamed = TodoCategory.rename(
      testCategory(),
      BoundedText.parse("予約するもの", 30),
      AT,
    );
    expect(renamed.name).toBe("予約するもの");
    expect(renamed.version).toBe(2);
    expect(renamed.updatedAt).toBe(AT);
  });

  it("同じ名前なら同じカテゴリを返し、版を増やさない", () => {
    const category = testCategory();
    expect(TodoCategory.rename(category, category.name, AT)).toBe(category);
  });
});
