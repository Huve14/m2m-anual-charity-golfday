import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";

const source = await readFile(new URL("../src/ops/PlayerInputs.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } });
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputText)(createRequire(import.meta.url), module, module.exports);
const { PlayerInputs, playerFields } = module.exports;
const player = Object.fromEntries(playerFields.map(({ name }) => [name, ""]));
const event = { requiredPlayerFields: ["full_name", "email", "phone"], shirtSizeOptions: ["S", "M"] };

test("existing events show all nine fields", () => {
  const html = renderToStaticMarkup(createElement(PlayerInputs, { event, player }));
  for (const { name } of playerFields) assert.ok(html.includes(`name="${name}"`));
});

test("admin and host player forms omit hidden contact fields even if stale requirements include them", () => {
  for (const enforceRequired of [false, true]) {
    const html = renderToStaticMarkup(createElement(PlayerInputs, { event: { ...event, visiblePlayerFields: ["full_name", "handicap"] }, player, enforceRequired }));
    assert.ok(html.includes('name="fullName"'));
    assert.ok(html.includes('name="handicap"'));
    assert.ok(!html.includes('name="email"'));
    assert.ok(!html.includes('name="phone"'));
    assert.equal((html.match(/required=""/g) || []).length, enforceRequired ? 1 : 0);
  }
});

test("an explicitly empty visibility selection does not fall back to all fields", () => {
  assert.equal(renderToStaticMarkup(createElement(PlayerInputs, { event: { ...event, visiblePlayerFields: [] }, player })), "");
});

test("both save schemas preserve omitted fields while accepting explicit clearing", async () => {
  for (const [path, variable] of [["../api/v1/admin/fourballs.js", "playerSchema"], ["../api/v1/host/index.js", "playerInput"]]) {
    const api = await readFile(new URL(path, import.meta.url), "utf8");
    const definition = api.slice(api.indexOf(`const ${variable} = `), api.indexOf("\n});", api.indexOf(`const ${variable} = `)) + 4);
    const schema = new Function("z", `${definition}; return ${variable};`)(z);
    const id = "11111111-1111-4111-8111-111111111111";
    const input = { action: "savePlayer", id, eventId: id, fourballId: id, playerId: id, fullName: "Test Player" };
    const parsed = schema.parse(input);
    assert.equal(Object.hasOwn(parsed, "email"), false);
    assert.equal(Object.hasOwn(parsed, "phone"), false);
    assert.equal(schema.parse({ ...input, email: "" }).email, "");
  }
});
