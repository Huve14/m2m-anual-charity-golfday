import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  canReadPhoto,
  fileSchema,
  hashPhotoToken,
  normalisePhoto,
  photoError,
} from "../api/_photos.js";

test("only approved, complete, same-event photos can be read by gallery links", () => {
  const link = { kind: "gallery", event_id: "event-a" };
  const photo = {
    event_id: "event-a",
    upload_status: "complete",
    status: "approved",
  };
  assert.equal(canReadPhoto(link, photo), true);
  for (const change of [
    { status: "pending" },
    { status: "rejected" },
    { upload_status: "uploading" },
    { event_id: "event-b" },
  ])
    assert.equal(canReadPhoto(link, { ...photo, ...change }), false);
  assert.equal(canReadPhoto({ ...link, kind: "staff" }, photo), false);
});
test("photo links use irreversible SHA-256 hashes", () => {
  const token = "example-secret-photo-token";
  const hash = hashPhotoToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hash, hashPhotoToken(token));
  assert.notEqual(hash, hashPhotoToken(`${token}x`));
});
test("file validation rejects unsupported formats, empty and oversized files", () => {
  const file = {
    id: "10000000-0000-4000-8000-000000000001",
    name: "golf.jpg",
    type: "image/jpeg",
    size: 1000,
  };
  assert.equal(fileSchema.safeParse(file).success, true);
  for (const change of [
    { type: "image/heic" },
    { type: "image/svg+xml" },
    { size: 0 },
    { size: 26214401 },
    { id: "../other" },
  ])
    assert.equal(fileSchema.safeParse({ ...file, ...change }).success, false);
});
test("normalisation decodes, rotates and strips metadata while keeping full-size output", async () => {
  const source = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#228855" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const { original, preview } = await normalisePhoto(source, "image/jpeg");
  const full = await sharp(original).metadata();
  const small = await sharp(preview).metadata();
  assert.equal(full.width, 800);
  assert.equal(full.height, 1200);
  assert.equal(full.exif, undefined);
  assert.equal(full.orientation, undefined);
  assert.equal(small.format, "webp");
  assert.ok(small.width <= 720 && small.height <= 720);
});
test("normalisation rejects forged MIME types, corrupt images and unsupported raster formats", async () => {
  const png = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    normalisePhoto(png, "image/jpeg"),
    /valid, non-animated/,
  );
  await assert.rejects(
    normalisePhoto(
      Buffer.from("<svg><script>bad()</script></svg>"),
      "image/png",
    ),
    /valid, non-animated/,
  );
  await assert.rejects(normalisePhoto(Buffer.alloc(0), "image/jpeg"), /25 MB/);
  const valid = await normalisePhoto(png, "image/png");
  assert.equal((await sharp(valid.original).metadata()).format, "jpeg");
});
test("quota and link failures use safe actionable messages", () => {
  for (const code of [
    "photo_link_invalid",
    "photo_rate_limit",
    "photo_quota_exceeded",
    "photo_uploads_closed",
    "photo_tags_invalid",
  ])
    assert.ok(photoError({ message: code }).message.length > 15);
  assert.ok(
    !photoError({ message: "secret database diagnostic" }).message.includes(
      "secret",
    ),
  );
});
