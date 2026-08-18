import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the M2M four-ball registration experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /M2M Charity Golf Day \| Four-ball Registration/);
  assert.match(html, /Make your/);
  assert.match(html, /Four-ball registration/);
  assert.match(html, /First name/);
  assert.match(html, /Cell phone number/);
  assert.match(html, /How many four-balls would you like to book/);
  assert.match(html, /Submit registration/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});
