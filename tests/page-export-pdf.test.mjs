import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/admin/exportPagePdf.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function harness({ blocked = false } = {}) {
  const events = [], timers = new Map(), handlers = new Map();
  let resolveFonts;
  const fontsReady = new Promise((resolve) => { resolveFonts = resolve; });
  const element = (tag = "div") => ({
    tag, children: [], style: {}, textContent: "", className: "",
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { this.children.push(...children); },
    querySelectorAll() { return []; }, matches() { return false; },
    cloneNode() { return element(tag); },
  });
  const doc = {
    head: element("head"), body: element("body"), documentElement: {}, images: [], fonts: { ready: fontsReady },
    createElement: element, open() {}, write() {}, close() {},
  };
  const preview = {
    document: doc, opener: {}, closed: false,
    focus() { events.push("focus"); },
    print() { events.push("print"); handlers.get("afterprint")?.(); },
    close() { this.closed = true; },
    addEventListener(name, handler) { handlers.set(name, handler); },
    requestAnimationFrame(callback) { events.push("paint"); callback(); },
  };
  const window = {
    open() { events.push("open"); return blocked ? null : preview; },
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const document = { ...doc, baseURI: "https://example.test/admin/sponsorships", querySelectorAll() { return []; } };
  const { exportPagePdf } = new Function("window", "document", "getComputedStyle", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLLinkElement", `const exports = {}; ${compiled}; return exports;`)(window, document, () => ({ display: "block", visibility: "visible" }), class {}, class {}, class {}, class {});
  return { run: () => exportPagePdf(element(), "Golf day — Sponsorships"), preview, doc, events, timers, resolveFonts };
}

test("PDF waits for fonts and paint, and keeps its document available after print and retry", async () => {
  const app = harness();
  const pending = app.run();
  assert.deepEqual(app.events, ["open"], "Preview opens synchronously in the user's click");
  const controls = app.doc.body.children.find((child) => child.className === "page-export-controls");
  const button = controls.children[0];
  assert.equal(button.disabled, true);
  app.resolveFonts();
  await pending;
  assert.deepEqual(app.events, ["open", "paint", "paint", "focus", "print"]);
  assert.match(app.doc.body.className, /\bpage-export-document\b/, "PDF previews are isolated from the QR-only print stylesheet");
  assert.equal(app.preview.opener, null);
  assert.equal(app.preview.closed, false);
  assert.equal(app.timers.size, 0, "No delayed cleanup can erase the document while saving");
  assert.equal(button.disabled, false);
  button.onclick();
  assert.equal(app.events.filter((event) => event === "print").length, 2);
  assert.equal(app.preview.closed, false);
  assert.equal(app.doc.head.children.find((child) => child.tag === "base").href, "https://example.test/admin/sponsorships");
});

test("blocked PDF preview reports how to retry", async () => {
  await assert.rejects(harness({ blocked: true }).run(), /Allow pop-ups/);
});

test("PDF readiness timeout closes the incomplete preview and reports an error", async () => {
  const app = harness();
  const pending = app.run();
  app.timers.values().next().value();
  await assert.rejects(pending, /Print preview timed out/);
  assert.equal(app.preview.closed, true);
  assert.equal(app.timers.size, 0);
  assert.equal(app.events.includes("print"), false);
});
