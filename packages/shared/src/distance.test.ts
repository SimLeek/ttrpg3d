import { describe, it, expect } from "vitest";
import { minkowskiDistance } from "./distance.js";

describe("minkowskiDistance", () => {
  it("p=1 is Manhattan (taxicab) distance", () => {
    expect(minkowskiDistance([0, 0, 0], [3, 4, 0], 1)).toBe(7);
  });

  it("p=2 is ordinary Euclidean distance", () => {
    expect(minkowskiDistance([0, 0, 0], [3, 4, 0], 2)).toBe(5);
  });

  it("generalizes to a real Minkowski-n for other p values", () => {
    // 2D 3-4-5-ish case at p=3: (3^3 + 4^3)^(1/3) = 91^(1/3)
    expect(minkowskiDistance([0, 0, 0], [3, 4, 0], 3)).toBeCloseTo(Math.pow(91, 1 / 3), 10);
  });

  it("is zero for two identical points, regardless of p", () => {
    expect(minkowskiDistance([5, 5, 5], [5, 5, 5], 1)).toBe(0);
    expect(minkowskiDistance([5, 5, 5], [5, 5, 5], 2)).toBe(0);
  });

  it("falls back to Euclidean for a non-finite or non-positive p, rather than NaN/Infinity", () => {
    expect(minkowskiDistance([0, 0, 0], [3, 4, 0], NaN)).toBe(5);
    expect(minkowskiDistance([0, 0, 0], [3, 4, 0], 0)).toBe(5);
    expect(minkowskiDistance([0, 0, 0], [3, 4, 0], -2)).toBe(5);
    expect(minkowskiDistance([0, 0, 0], [3, 4, 0], Infinity)).toBe(5);
  });
});
