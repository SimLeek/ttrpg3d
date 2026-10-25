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

/** Decodes+writes one base64 image to `uploadsDir`, returning the URL PATH (not a full origin -- the caller's own server base URL, same as every other API response) it'll be served back at via the matching `express.static` mount. Throws UploadRejected (not a crash) for an unsupported mime type or an oversized payload -- the caller maps this to a real 400, same as any other validation failure in this codebase. */
export function saveUploadedImage(uploadsDir: string, mimeType: string, dataBase64: string): string {
  const ext = ALLOWED_MIME_TO_EXT[mimeType];
  if (!ext) throw new UploadRejected(`unsupported image type: ${mimeType}`);
  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.length === 0) throw new UploadRejected("empty image data");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new UploadRejected(`image exceeds the ${MAX_UPLOAD_BYTES} byte limit`);
  mkdirSync(uploadsDir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  writeFileSync(join(uploadsDir, filename), buffer);
  return `/uploads/${filename}`;
}
