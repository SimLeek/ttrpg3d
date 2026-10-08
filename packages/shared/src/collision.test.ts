import { describe, it, expect } from "vitest";
import { aabbsOverlap, type AABB } from "./index.js";

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB => ({ minX, minY, minZ, maxX, maxY, maxZ });

describe("aabbsOverlap", () => {
  it("is true when two boxes clearly overlap", () => {
    expect(aabbsOverlap(box(0, 0, 0, 1, 1, 1), box(0.5, 0.5, 0.5, 1.5, 1.5, 1.5))).toBe(true);
  });

  it("is true when one box is fully inside the other", () => {
    expect(aabbsOverlap(box(0, 0, 0, 10, 10, 10), box(2, 2, 2, 3, 3, 3))).toBe(true);
  });

  it("is false when boxes are clearly apart", () => {
    expect(aabbsOverlap(box(0, 0, 0, 1, 1, 1), box(5, 5, 5, 6, 6, 6))).toBe(false);
  });

  it("is false when boxes only touch exactly at a shared face (zero-volume overlap)", () => {
    expect(aabbsOverlap(box(0, 0, 0, 1, 1, 1), box(1, 0, 0, 2, 1, 1))).toBe(false);
  });

  it("is false when boxes are apart on just one axis, even if they'd overlap on the other two", () => {
    expect(aabbsOverlap(box(0, 0, 0, 1, 1, 1), box(0, 0, 2, 1, 1, 3))).toBe(false);
  });
});
