// docs/CHARACTER_SHEET_IMPORT.md, part 2 -- the decided image-storage
// shape ("a new upload endpoint, writing to disk; the tokenImage
// variable holds a URL, not base64 bytes"). No multipart/FormData
// handling exists anywhere in this codebase's HTTP layer (confirmed:
// every createEndpoint in server.ts reads a plain JSON `ctx.body`) --
// rather than adding multipart-parsing infrastructure just for this,
// the client base64-encodes the (small, size-capped) image into an
// ordinary JSON body, same convention every other endpoint already
// uses. Written back out as real bytes on disk, served back via a
// plain Express static mount (server.ts's own `express` hook on
// `defineServer`) -- so the stored URL is a genuinely small string,
// not the image's own bytes living in Colyseus-synced character
// state.
//
// Real request, 2026-10-29: "see if you can store the uploaded image
// link with the account before the image is successfully uploaded
// and not after, so that all images are linked to an account even in
// case of crashes or mid code drops... all significant uploads should
// be like that." Split into `validateUpload` (pure, no disk I/O --
// everything determinable from the request body alone: mime type,
// size) and `writeUploadedImageBytes` (the actual, possibly-fallible
// disk write), with the URL generated in between the two. The
// CALLER (server.ts's own postUpload) is what actually orders this:
// validate -> generate the url -> record (accountId, url) with the
// store -> THEN write the bytes. A crash/kill/disk-full between the
// record and the write leaves a DANGLING record (points to a file
// that was never created) instead of the OLD failure mode, an
// ORPHANED FILE (bytes on disk nothing can ever find or attribute to
// an account) -- a dangling record is the strictly safer failure,
// since nothing was actually wasted and it's trivially filterable
// later; an orphaned file is pure, silent, unaccountable waste, which
// was the entire point of tracking uploads per account to begin with.
// This split is the template any FUTURE "upload something" endpoint
// in this codebase should follow, not just this one.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** PNG/JPG/WebP only, and a modest size cap -- "same spirit as any ordinary avatar-upload limit elsewhere on the web," per that doc's own defaulted decision. Revisit if real use shows this is wrong. */
const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export class UploadRejected extends Error {}

/** Decodes+validates one base64 image -- no disk I/O at all, so a REJECTED upload (bad mime type, empty, oversized) never touches the filesystem or gets an account record at all; only a genuinely VALID upload proceeds to `writeUploadedImageBytes` below. Throws UploadRejected (not a crash) -- the caller maps this to a real 400, same as any other validation failure in this codebase. */
export function validateUpload(mimeType: string, dataBase64: string): { ext: string; buffer: Buffer } {
  const ext = ALLOWED_MIME_TO_EXT[mimeType];
  if (!ext) throw new UploadRejected(`unsupported image type: ${mimeType}`);
  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.length === 0) throw new UploadRejected("empty image data");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new UploadRejected(`image exceeds the ${MAX_UPLOAD_BYTES} byte limit`);
  return { ext, buffer };
}

/** The URL PATH (not a full origin -- the caller's own server base URL, same as every other API response) `buffer` will be served back at, via the matching `express.static` mount -- minted BEFORE the actual write, so the caller can record it against an account first. */
export function mintUploadUrl(ext: string): string {
  return `/uploads/${randomUUID()}.${ext}`;
}

/** The actual, possibly-fallible disk write -- `url` must be one `mintUploadUrl` already returned (this trusts the caller, same as every other internal helper in this file). */
export function writeUploadedImageBytes(uploadsDir: string, url: string, buffer: Buffer): void {
  mkdirSync(uploadsDir, { recursive: true });
  const filename = url.slice("/uploads/".length);
  writeFileSync(join(uploadsDir, filename), buffer);
}
