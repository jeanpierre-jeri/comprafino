import { describe, expect, it } from "vitest";
import { unique } from "./index";

describe("unique", () => {
  it("preserves first occurrence order without mutating the input", () => {
    const input = Object.freeze([3, 1, 3, 2, 1]);
    expect(unique(input)).toEqual([3, 1, 2]);
    expect(input).toEqual([3, 1, 3, 2, 1]);
  });
  it("handles empty inputs", () => {
    expect(unique([])).toEqual([]);
  });
});
