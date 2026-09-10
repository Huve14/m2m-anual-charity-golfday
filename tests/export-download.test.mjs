import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8");
const component = source.slice(source.indexOf("function Exports("), source.indexOf("\ninterface Enquiry"));
const compiled = ts.transpileModule(component, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;
const require = createRequire(import.meta.url);

for (const [index, type] of ["players", "fourballs", "sponsors", "hosts"].entries()) {
  test(`${type} export survives React clearing currentTarget while authentication is pending`, async () => {
    const requests = [];
    const downloads = [];
    const alerts = [];
    const blob = new Blob(["Company,Team\r\nExample,Team 1"], { type: "text/csv" });
    const anchor = { click() { downloads.push({ href: this.href, filename: this.download }); } };
    const Exports = new Function("require", "fetch", "document", "URL", "window", "SectionHeader", `const exports = {}; ${compiled}; return Exports;`)(
      (name) => name === "../ops/client" ? {
        getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } }),
      } : require(name),
      async (url, options) => { requests.push({ url, options }); return { ok: true, blob: async () => blob }; },
      { createElement: () => anchor },
      { createObjectURL: (value) => { assert.equal(value, blob); return "blob:test-export"; }, revokeObjectURL() {} },
      { alert: (message) => alerts.push(message) },
      () => null,
    );
    const card = Exports({ event: { id: "event-123" } }).props.children[1].props.children[index];
    let prevented = false;
    const click = { currentTarget: { href: card.props.href }, preventDefault() { prevented = true; } };
    const pending = card.props.onClick(click);
    // React resets currentTarget as soon as synchronous event dispatch finishes.
    click.currentTarget = null;
    await pending;
    assert.equal(prevented, true);
    assert.deepEqual(alerts, []);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `/api/v1/admin/exports?eventId=event-123&type=${type}`);
    assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
    assert.deepEqual(downloads, [{ href: "blob:test-export", filename: `m2m-${type}.csv` }]);
  });
}
