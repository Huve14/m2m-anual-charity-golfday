import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds the M2M four-ball registration experience for Vercel", async () => {
  const [html, page] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(html, /M2M Charity Golf Day \| Four-ball Registration/);
  assert.match(html, /m2m-golf-social\.png/);
  assert.match(page, /Drive change/);
  assert.match(page, /Play with purpose/);
  assert.match(page, /Four-ball registration/);
  assert.match(page, /First name/);
  assert.match(page, /Cell phone number/);
  assert.match(page, /How many four-balls would you like to book/);
  assert.match(page, /Submit registration/);
});
