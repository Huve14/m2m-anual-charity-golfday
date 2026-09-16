import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { exportTypes } from "../api/_export-data.js";

const source = await readFile(new URL("../src/admin/PageExport.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace(/^import .*;\n/gm, ""), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const requests = [];
const content = {};
const { PageExport, pageExportTypes } = new Function("require", "useState", "document", "downloadWorkbook", "exportPagePdf", `const exports = {}; ${compiled}; return exports;`)(createRequire(import.meta.url), () => [false, () => {}], { getElementById: () => content }, async (...args) => requests.push(["excel", ...args]), async (...args) => requests.push(["pdf", ...args]));

for (const [tab, type] of Object.entries(pageExportTypes)) {
  test(`${tab} has working Excel and PDF controls`, async () => {
    requests.length = 0;
    assert.ok(exportTypes.includes(type));
    const view = PageExport({ eventId: "test-event", tab, eventName: "Golf Day", pageName: tab });
    const buttons = view.props.children.filter((child) => child.type === "button");
    assert.equal(buttons.length, 2);
    for (const button of buttons) await button.props.onClick();
    assert.deepEqual(requests, [["excel", `/api/v1/admin/exports?eventId=test-event&type=${type}`, type], ["pdf", content, `Golf Day — ${tab}`]]);
  });
}

test("new export controls cover only tabs 01–10", () => {
  assert.equal(Object.keys(pageExportTypes).length, 10);
  for (const tab of ["data", "enquiries", "photos"]) assert.equal(pageExportTypes[tab], undefined);
});
