import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveUploadedImage, UploadRejected } from "./uploads.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ttrpg3d-uploads-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ONE_PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("saveUploadedImage (docs/CHARACTER_SHEET_IMPORT.md, part 2 -- the decided image-storage shape)", () => {
  it("decodes the base64 payload, writes it to disk, and returns a /uploads/ URL path", () => {
    const url = saveUploadedImage(dir, "image/png", ONE_PIXEL_PNG_BASE64);
    expect(url).toMatch(/^\/uploads\/[\w-]+\.png$/);
    const written = readFileSync(join(dir, url.replace("/uploads/", "")));
    expect(written).toEqual(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
  });

  it("creates the uploads directory if it doesn't exist yet", () => {
    const nested = join(dir, "does", "not", "exist", "yet");
    expect(existsSync(nested)).toBe(false);
    saveUploadedImage(nested, "image/png", ONE_PIXEL_PNG_BASE64);
    expect(existsSync(nested)).toBe(true);
  });

  it("maps each allowed mime type to its own real file extension", () => {
    expect(saveUploadedImage(dir, "image/png", ONE_PIXEL_PNG_BASE64)).toMatch(/\.png$/);
    expect(saveUploadedImage(dir, "image/jpeg", ONE_PIXEL_PNG_BASE64)).toMatch(/\.jpg$/);
    expect(saveUploadedImage(dir, "image/webp", ONE_PIXEL_PNG_BASE64)).toMatch(/\.webp$/);
  });

  it("rejects (UploadRejected, not a crash) an unsupported mime type", () => {
    expect(() => saveUploadedImage(dir, "application/octet-stream", ONE_PIXEL_PNG_BASE64)).toThrow(UploadRejected);
    expect(() => saveUploadedImage(dir, "image/gif", ONE_PIXEL_PNG_BASE64)).toThrow(UploadRejected);
  });

  it("rejects empty image data", () => {
    expect(() => saveUploadedImage(dir, "image/png", "")).toThrow(UploadRejected);
  });

  it("rejects a payload over the 2MB cap", () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64");
    expect(() => saveUploadedImage(dir, "image/png", big)).toThrow(UploadRejected);
  });

  it("generates a fresh, unique filename per upload, even for identical bytes", () => {
    const first = saveUploadedImage(dir, "image/png", ONE_PIXEL_PNG_BASE64);
    const second = saveUploadedImage(dir, "image/png", ONE_PIXEL_PNG_BASE64);
    expect(first).not.toBe(second);
  });
});
