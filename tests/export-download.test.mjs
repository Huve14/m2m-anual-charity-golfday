import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { exportTypes } from "../api/_export-data.js";

const source = await readFile(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8");
const component = source.slice(source.indexOf("function Exports("), source.indexOf("\ninterface Enquiry"));
const compiled = ts.transpileModule(component, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const require = createRequire(import.meta.url);

function harness({ token = "test-token", status = 200, contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename, message = "Please sign in again." } = {}) {
  const requests = [], downloads = [], errors = [], timers = [], revoked = [];
  let hook = 0;
  const blob = new Blob(["test workbook"]);
  const anchor = { click() { downloads.push({ href: this.href, filename: this.download }); }, remove() {} };
  const Exports = new Function("require", "fetch", "document", "URL", "window", "SectionHeader", "ErrorBanner", "useState", "currentSession", `const exports = {}; ${compiled}; return Exports;`)(
    require,
    async (url, options) => { requests.push({ url, options }); return { ok: status === 200, headers: new Headers({ "Content-Type": contentType, ...(filename ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}) }), blob: async () => blob, json: async () => ({ message }) }; },
    { createElement: () => anchor, body: { appendChild() {} } },
    { createObjectURL: (value) => { assert.equal(value, blob); return "blob:test-export"; }, revokeObjectURL: (url) => revoked.push(url) },
    { setTimeout: (callback) => timers.push(callback) },
    () => null, () => null,
    () => { const index = hook++; return ["", (value) => { if (index === 1 && value) errors.push(value); }]; },
    async () => token ? { access_token: token } : null,
  );
  const links = [];
  function visit(node) { if (!node) return; if (Array.isArray(node)) return node.forEach(visit); if (node.type === "a") links.push(node); if (node.props) visit(node.props.children); }
  visit(Exports({ event: { id: "event-123" } }));
  async function click(type) {
    const card = links.find((link) => link.props.href.endsWith(`type=${type}`));
    assert.ok(card, `Download card exists for ${type}`);
    let prevented = false;
    const event = { currentTarget: { href: card.props.href }, preventDefault() { prevented = true; } };
    const pending = card.props.onClick(event);
    event.currentTarget = null;
    await pending;
    assert.equal(prevented, true);
  }
  return { click, requests, downloads, errors, timers, revoked, links };
}

for (const type of exportTypes) {
  test(`${type} Excel export survives React clearing currentTarget`, async () => {
    const app = harness();
    await app.click(type);
    assert.deepEqual(app.errors, []);
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].url, `/api/v1/admin/exports?eventId=event-123&type=${type}`);
    assert.equal(app.requests[0].options.headers.Authorization, "Bearer test-token");
    assert.deepEqual(app.downloads, [{ href: "blob:test-export", filename: `m2m-${type}.xlsx` }]);
    assert.deepEqual(app.revoked, [], "The file remains available while the browser starts downloading");
    app.timers[0]();
    assert.deepEqual(app.revoked, ["blob:test-export"]);
  });
}

test("uses the event-specific filename supplied by the server", async () => {
  const app = harness({ filename: "m2m-golf-2026-confirmations-2026-09-10.xlsx" });
  await app.click("confirmations");
  assert.equal(app.downloads[0].filename, "m2m-golf-2026-confirmations-2026-09-10.xlsx");
});

test("shows errors instead of saving sign-in failures or HTML as an Excel workbook", async () => {
  for (const options of [{ token: null }, { status: 403 }, { contentType: "text/html" }]) {
    const app = harness(options);
    await app.click("confirmations");
    assert.equal(app.errors.length, 1);
    assert.deepEqual(app.downloads, []);
    if (options.token === null) assert.deepEqual(app.requests, []);
  }
});
