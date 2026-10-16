import { describe, it, expect } from "vitest";
import { parseSlashRoll, findInlineRolls } from "./chatCommands.js";

describe("parseSlashRoll", () => {
  it("extracts the notation from a real /roll command", () => {
    expect(parseSlashRoll("/roll 2d20kh1+2")).toBe("2d20kh1+2");
  });

  it("trims surrounding whitespace on both the command and the notation", () => {
    expect(parseSlashRoll("  /roll   1d6  ")).toBe("1d6");
  });

  it("returns null for plain text that isn't a slash command at all", () => {
    expect(parseSlashRoll("hello there")).toBeNull();
  });

  it("returns null for a bare /roll with no notation", () => {
    expect(parseSlashRoll("/roll")).toBeNull();
    expect(parseSlashRoll("/roll   ")).toBeNull();
  });

  it("is case-sensitive -- /Roll is not a recognized command", () => {
    expect(parseSlashRoll("/Roll 1d6")).toBeNull();
  });

  it("does not match /roll appearing mid-message, only as the whole message", () => {
    expect(parseSlashRoll("I'll /roll 1d6 later")).toBeNull();
  });
});

describe("findInlineRolls", () => {
  it("finds a single inline segment inside a sentence", () => {
    const segments = findInlineRolls("I attack for [[1d8+3]] damage");
    expect(segments).toHaveLength(1);
    expect(segments[0].notation).toBe("1d8+3");
    expect(segments[0].start).toBe(13);
    expect(segments[0].end).toBe(22);
  });

  it("finds multiple segments in order", () => {
    const segments = findInlineRolls("[[1d20]] to hit, [[2d6]] damage");
    expect(segments.map((s) => s.notation)).toEqual(["1d20", "2d6"]);
  });

  it("returns an empty array for a message with no segments", () => {
    expect(findInlineRolls("just a normal message")).toEqual([]);
  });

  it("trims whitespace inside the brackets", () => {
    expect(findInlineRolls("[[  1d6  ]]")[0].notation).toBe("1d6");
  });

  it("treats an unterminated segment as no match rather than throwing", () => {
    expect(findInlineRolls("oops [[1d6 forgot to close")).toEqual([]);
  });

  it("is non-greedy -- stops at the first closing ]]", () => {
    const segments = findInlineRolls("[[1d6]] and [[1d8]]");
    expect(segments.map((s) => s.notation)).toEqual(["1d6", "1d8"]);
  });
});
