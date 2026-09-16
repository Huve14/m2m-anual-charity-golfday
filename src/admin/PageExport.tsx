import { useState } from "react";
import { exportPagePdf } from "./exportPagePdf";
import { downloadWorkbook } from "./downloadWorkbook";

export const pageExportTypes: Record<string, string> = { overview: "overview", setup: "setup", companies: "companies", sponsorships: "sponsors", suppliers: "suppliers", fourballs: "fourballs", tee: "tee", hosts: "hosts", players: "players", gala: "attendees" };

export function PageExport({ eventId, tab, eventName, pageName }: { eventId: string; tab: string; eventName: string; pageName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download(format: "pdf" | "excel") {
    const content = document.getElementById("event-page-content");
    if (!content || busy) return;
    setBusy(true);
    setError("");
    try {
      if (format === "pdf") await exportPagePdf(content, `${eventName} — ${pageName}`);
      else await downloadWorkbook(`/api/v1/admin/exports?eventId=${encodeURIComponent(eventId)}&type=${pageExportTypes[tab]}`, pageExportTypes[tab]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The export could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="page-export-toolbar">
    <p>{error ? <span role="alert">{error}</span> : busy ? <span role="status">Preparing export…</span> : "Excel: all tab records. PDF: current view; choose Save as PDF."}</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => download("excel")} aria-label={`Export ${pageName} as Excel`}>Export Excel</button>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => download("pdf")} aria-label={`Export ${pageName} page as PDF`}>
      Export PDF
    </button>
  </div>;
}
