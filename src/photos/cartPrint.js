/** @param {string} value */
function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
/** @param {{label:string, url:string, qr:string}[]} cards @param {string} eventName */
export function cartPrintDocument(cards, eventName) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>${escapeHtml(eventName)} — Fourball cart QR codes</title><style>
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#15352b;margin:20px}header{max-width:800px;margin:0 auto 20px}button{padding:12px 20px;cursor:pointer}.cards{max-width:800px;margin:auto;display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{border:1px dashed #777;padding:20px;text-align:center;break-inside:avoid;overflow-wrap:anywhere}.card h2{font-size:22px;margin:8px 0}.card img{display:block;width:190px;height:190px;margin:12px auto}.event{font-size:14px}.link{font-size:10px;color:inherit;word-break:break-all}@page{size:A4 portrait;margin:12mm}@media print{body{margin:0}header{display:none}.cards{gap:8mm}.card{min-height:120mm;padding:6mm}.card img{width:48mm;height:48mm}}
  </style></head><body><header><h1>Fourball cart QR codes</h1><p>${cards.length} cards. Print at 100% scale, then cut along the borders. Save this file to reprint the same codes later.</p><button onclick="window.print()">Print / Save as PDF</button></header><main class="cards">${cards.map((card) => `<article class="card"><p class="event">${escapeHtml(eventName)}</p><h2>${escapeHtml(card.label)}</h2><img src="${escapeHtml(card.qr)}" alt="Scan for fourball photos"><strong>Your golf-day photos</strong><p>Scan to view, download and share.<br>Upload your own photos too.</p><p>New photos appear after approval.</p><a class="link" href="${escapeHtml(card.url)}">${escapeHtml(card.url)}</a></article>`).join("")}</main></body></html>`;
}
/** @param {{label:string, url:string}[]} cards */
export function cartLinksCsv(cards) {
  const cell = (/** @type {string} */ value) =>
    `"${(/^[=+\-@\t\r\n]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`;
  return (
    "\uFEFFFourball,Gallery link\r\n" +
    cards.map((card) => [card.label, card.url].map(cell).join(",")).join("\r\n")
  );
}
