const printStyles = `
  @page { size: A4 landscape; margin: 12mm; }
  html, body { margin: 0 !important; background: white !important; }
  body { padding: 0 !important; color: #172033; font-family: Arial, sans-serif; }
  .page-export-heading { margin-bottom: 20px; border-bottom: 2px solid #172033; padding-bottom: 12px; }
  .page-export-heading h1 { font-size: 22px; margin: 0 0 8px; }
  .page-export-heading p { font-size: 11px; margin: 0; }
  #event-page-content, #event-page-content * { max-height: none !important; overflow: visible !important; }
  #event-page-content { width: 100%; }
  .table-scroll, .panel { box-shadow: none !important; }
  table { width: 100% !important; min-width: 0 !important; table-layout: auto !important; }
  th, td { white-space: normal !important; overflow-wrap: anywhere; font-size: 9px !important; padding: 6px !important; }
  thead { display: table-header-group; }
  tr, img, .metric-card, .photo-card { break-inside: avoid; }
  h2, h3, h4, summary { break-after: avoid; }
  img { max-width: 100%; }
  .hole-allocation-workspace { display: block !important; }
  .hole-course { break-inside: avoid; margin-bottom: 20px; }
  .hole-number-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 8px !important; padding: 12px !important; }
  .ops-body .hole-number-grid button { min-height: 64px; padding: 8px 12px; gap: 4px; break-inside: avoid; }
  .hole-number-grid button > strong { font-size: 20px; }
  .hole-editor { position: static !important; }
  .page-export-value { display: inline-block; white-space: pre-wrap; overflow-wrap: anywhere; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

/** Snapshot the current view without changing the live page or its form values. */
export async function exportPagePdf(content: HTMLElement, title: string) {
  const snapshot = content.cloneNode(true) as HTMLElement;
  const originals = [content, ...content.querySelectorAll<HTMLElement>("*")];
  const copies = [snapshot, ...snapshot.querySelectorAll<HTMLElement>("*")];
  originals.forEach((original, index) => {
    const copy = copies[index];
    const style = getComputedStyle(original);
    if (original.hidden || style.display === "none" || style.visibility === "hidden" || original.matches("script, iframe, dialog:not([open]), input[type=file], input[type=password]")) {
      copy.remove();
    } else if (original instanceof HTMLInputElement || original instanceof HTMLTextAreaElement || original instanceof HTMLSelectElement) {
      const value = document.createElement("span");
      value.className = "page-export-value";
      value.textContent = original instanceof HTMLSelectElement
        ? Array.from(original.selectedOptions, (option) => option.text).join(", ")
        : original instanceof HTMLInputElement && ["checkbox", "radio"].includes(original.type)
          ? original.checked ? "Yes" : "No"
          : original.value || "—";
      copy.replaceWith(value);
    } else if (original.matches("button")) {
      // Hole selectors also contain the course's placement counts and sponsors.
      // Keep these informational cards with their grid and selected-hole styling.
      if (original.matches(".hole-number-grid > button")) return;
      // Photo thumbnails are buttons too; retain their images in the export.
      if (copy.querySelector("img")) copy.replaceWith(...Array.from(copy.childNodes));
      else copy.remove();
    }
  });

  const frame = document.createElement("iframe");
  frame.title = "Page export preview";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1120px;height:800px;border:0";
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    const printWindow = frame.contentWindow;
    if (!doc || !printWindow) throw new Error("Print preview unavailable");
    doc.title = title;
    doc.documentElement.lang = "en";
    const stylesReady = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'), (source) => {
      const copy = source.cloneNode(true) as HTMLElement;
      const ready = source instanceof HTMLLinkElement ? new Promise<void>((resolve, reject) => {
        copy.onload = () => resolve();
        copy.onerror = () => reject(new Error("Print styles could not load"));
      }) : Promise.resolve();
      doc.head.appendChild(copy);
      return ready;
    });
    const style = doc.createElement("style");
    style.textContent = printStyles;
    doc.head.appendChild(style);
    doc.body.className = document.body.className;
    const heading = doc.createElement("header");
    heading.className = "page-export-heading";
    const name = doc.createElement("h1");
    name.textContent = title;
    const date = doc.createElement("p");
    date.textContent = `Exported ${new Date().toLocaleString()} · Current view and loaded records`;
    heading.appendChild(name);
    heading.appendChild(date);
    doc.body.appendChild(heading);
    doc.body.appendChild(snapshot);
    const imagesReady = Array.from(doc.images, async (img) => {
      img.loading = "eager";
      try { await img.decode(); } catch { /* Keep the image's alt text if unavailable. */ }
    });
    await Promise.race([
      Promise.all([...stylesReady, ...imagesReady]).then(() => doc.fonts.ready),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("Print preview timed out")), 20_000)),
    ]);
    printWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
    printWindow.focus();
    printWindow.print();
    // Some browsers do not dispatch afterprint when the dialog is cancelled.
    window.setTimeout(() => frame.remove(), 300_000);
  } catch (error) {
    frame.remove();
    throw error;
  }
}
