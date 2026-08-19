import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds the premium M2M charity golf experience for Vercel", async () => {
  const [html, hole] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/hole-2.html", import.meta.url), "utf8"),
  ]);

  assert.match(html, /M2M Charity Golf Day — Four-ball Registration/);
  assert.match(html, /m2m-golf-plate\.png/);
  assert.match(html, /Bring the/);
  assert.match(html, /boardroom/);
  assert.match(html, /Enter your/);
  assert.match(html, /Contact person/);
  assert.match(html, /How many four-balls/);
  assert.match(html, /entry\.437593400/);
  assert.match(html, /docs\.google\.com\/forms/);
  assert.match(hole, /Glendower · Hole 2 — Flythrough/);
  assert.match(hole, /Fly the hole/);
});
