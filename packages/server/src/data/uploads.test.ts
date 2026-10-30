import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateUpload, mintUploadUrl, writeUploadedImageBytes, UploadRejected } from "./uploads.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ttrpg3d-uploads-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ONE_PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/**
 * Real request, 2026-10-29: "store the uploaded image link with the
 * account before the image is successfully uploaded and not after"
 * -- `saveUploadedImage` used to be ONE function; it's now three
 * (validate -> mint a url -> write the bytes), specifically so the
 * caller (server.ts's own postUpload) can record the url against an
 * account in between minting and writing. This helper composes all
 * three in the SAME order the real caller does, for every test below
 * that doesn't care about that split itself.
 */
function saveUploadedImage(uploadsDir: string, mimeType: string, dataBase64: string): string {
  const { ext, buffer } = validateUpload(mimeType, dataBase64);
  const url = mintUploadUrl(ext);
  writeUploadedImageBytes(uploadsDir, url, buffer);
  return url;
}

describe("validateUpload/mintUploadUrl/writeUploadedImageBytes (docs/CHARACTER_SHEET_IMPORT.md, part 2 -- the decided image-storage shape)", () => {
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
    expect(() => validateUpload("application/octet-stream", ONE_PIXEL_PNG_BASE64)).toThrow(UploadRejected);
    expect(() => validateUpload("image/gif", ONE_PIXEL_PNG_BASE64)).toThrow(UploadRejected);
  });

  it("rejects empty image data", () => {
    expect(() => validateUpload("image/png", "")).toThrow(UploadRejected);
  });

  it("rejects a payload over the 2MB cap", () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64");
    expect(() => validateUpload("image/png", big)).toThrow(UploadRejected);
  });

  it("generates a fresh, unique filename per upload, even for identical bytes", () => {
    const first = saveUploadedImage(dir, "image/png", ONE_PIXEL_PNG_BASE64);
    const second = saveUploadedImage(dir, "image/png", ONE_PIXEL_PNG_BASE64);
    expect(first).not.toBe(second);
  });

  it("mintUploadUrl returns a url BEFORE any bytes are written -- the caller can record it (e.g. against an account) ahead of the possibly-fallible write, same ordering real request 2026-10-29 asks for", () => {
    const url = mintUploadUrl("png");
    expect(url).toMatch(/^\/uploads\/[\w-]+\.png$/);
    expect(existsSync(join(dir, url.replace("/uploads/", "")))).toBe(false); // nothing written yet
    writeUploadedImageBytes(dir, url, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
    expect(existsSync(join(dir, url.replace("/uploads/", "")))).toBe(true);
  });
});
