import { currentSession } from "../ops/client";

export async function downloadWorkbook(exportUrl: string, type: string) {
      const session = await currentSession();
      if (!session?.access_token) throw new Error("Sign in again to download this workbook.");
      const response = await fetch(exportUrl, { cache: "no-store", headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(payload.message || "The Excel export could not be downloaded.");
      }
      if (!response.headers.get("Content-Type")?.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) throw new Error("The server did not return an Excel workbook. Please try again.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.headers.get("Content-Disposition")?.match(/filename="([^"/\\]+\.xlsx)"/i)?.[1] || `m2m-${type}.xlsx`;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally {
        anchor.remove();
        // Give the browser time to start reading the download before releasing it.
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
}
