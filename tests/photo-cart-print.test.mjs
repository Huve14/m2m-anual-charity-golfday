import test from "node:test";
import assert from "node:assert/strict";
import { cartPrintDocument, cartLinksCsv } from "../src/photos/cartPrint.js";

test("cart print sheet keeps each fourball associated with its QR and link and escapes names", () => {
  const cards = [
    {
      label: "<script>alert(1)</script>",
      url: "https://example.com/photos#one",
      qr: "data:image/png;base64,ONE",
    },
    {
      label: 'Team "Two" & Friends',
      url: "https://example.com/photos#two",
      qr: "data:image/png;base64,TWO",
    },
  ];
  const document = cartPrintDocument(cards, "Golf <Day>");
  assert.equal((document.match(/<article /g) || []).length, 2);
  assert.ok(!document.includes("<script>"));
  assert.ok(document.includes("Golf &lt;Day&gt;"));
  const articles = document.match(/<article[^]*?<\/article>/g);
  assert.ok(articles[0].includes("base64,ONE"));
  assert.ok(articles[0].includes("photos#one"));
  assert.ok(!articles[0].includes("photos#two"));
  assert.ok(articles[1].includes("Team &quot;Two&quot; &amp; Friends"));
  assert.ok(articles[1].includes("base64,TWO"));
  assert.ok(document.includes("break-inside:avoid"));
});

test("links CSV preserves quoted names and prevents spreadsheet formulas", () => {
  const csv = cartLinksCsv([
    { label: 'Team "A", B', url: "https://example.com/photos#secret" },
    { label: '=HYPERLINK("bad")', url: "https://example.com/photos#second" },
  ]);
  assert.equal(
    csv,
    '\uFEFFFourball,Gallery link\r\n"Team ""A"", B","https://example.com/photos#secret"\r\n"\'=HYPERLINK(""bad"")","https://example.com/photos#second"',
  );
});
