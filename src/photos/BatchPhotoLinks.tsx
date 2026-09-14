import { useEffect, useRef, useState } from "react";
import { opsApi } from "../ops/client";
import type { Fourball } from "./client";
import type { IssuedLink } from "./PhotoLink";
import { cartLinksCsv, cartPrintDocument } from "./cartPrint.js";

type Card = { label: string; url: string; qr: string };
export function BatchPhotoLinks({
  eventId,
  eventName,
  fourballs,
  onCreated,
}: {
  eventId: string;
  eventName: string;
  fourballs: Fourball[];
  onCreated: () => void;
}) {
  const [selected, setSelected] = useState(() =>
    fourballs.map((team) => team.id),
  );
  const [links, setLinks] = useState<Record<string, IssuedLink>>({});
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const stop = useRef(false);
  const pendingBatch = useRef<{
    batchToken: string;
    fourballIds: string[];
  } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  useEffect(() => {
    if (!Object.keys(links).length && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [links, busy]);
  const ready = fourballs
    .filter((team) => selected.includes(team.id) && cards[team.id])
    .map((team) => cards[team.id]);
  async function create() {
    if (busy) return;
    stop.current = false;
    setBusy(true);
    try {
      const qrcode = await import("qrcode");
      const available = { ...links };
      const missing = selected.filter((id) => !available[id]);
      if (pendingBatch.current || missing.length) {
        if (!pendingBatch.current) {
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          const batchToken = btoa(String.fromCharCode(...bytes))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
          pendingBatch.current = { batchToken, fourballIds: missing };
        }
        setMessage("Creating gallery links for the selected fourballs…");
        const result = await opsApi<{ links: IssuedLink[] }>(
          "/api/v1/admin/photos",
          {
            method: "POST",
            body: JSON.stringify({
              action: "link-batch",
              eventId,
              ...pendingBatch.current,
            }),
          },
        );
        for (const link of result.links)
          if (link.fourball_id) available[link.fourball_id] = link;
        if (!mounted.current) return;
        setLinks(available);
        pendingBatch.current = null;
      }
      for (const team of fourballs.filter(
        (team) => selected.includes(team.id) && !cards[team.id],
      )) {
        if (stop.current) break;
        setMessage(`Creating QR for ${team.team_name}…`);
        try {
          const link = available[team.id];
          if (!link || !mounted.current) break;
          const url = new URL(link.path, window.location.origin).href;
          const qr = await qrcode.toDataURL(url, {
            width: 640,
            margin: 4,
            errorCorrectionLevel: "M",
          });
          if (!mounted.current) break;
          setCards((previous) => ({
            ...previous,
            [team.id]: { label: team.team_name, url, qr },
          }));
          setErrors((previous) => {
            const next = { ...previous };
            delete next[team.id];
            return next;
          });
        } catch (error) {
          if (mounted.current)
            setErrors((previous) => ({
              ...previous,
              [team.id]:
                error instanceof Error ? error.message : "Could not create QR.",
            }));
        }
      }
      if (mounted.current)
        setMessage(
          stop.current
            ? "Stopped. Resume to create the remaining codes."
            : "Batch finished. Download your print sheet and links below.",
        );
    } catch (error) {
      if (mounted.current)
        setMessage(
          error instanceof Error ? error.message : "QR generation failed.",
        );
    } finally {
      if (mounted.current) {
        setBusy(false);
        onCreated();
      }
    }
  }
  function download(contents: string, mime: string, filename: string) {
    const url = URL.createObjectURL(new Blob([contents], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return (
    <section className="panel photo-cart-batch">
      <h3>Print QR codes for fourball carts</h3>
      <p>
        Select fourballs to create their gallery links and labelled cart cards.
        Keep this page open while the batch runs.
      </p>
      <div className="photo-actions">
        <button
          className="secondary-button"
          disabled={busy || Boolean(pendingBatch.current)}
          onClick={() => setSelected(fourballs.map((team) => team.id))}
        >
          Select all
        </button>
        <button
          className="secondary-button"
          disabled={busy || Boolean(pendingBatch.current)}
          onClick={() => setSelected([])}
        >
          Clear selection
        </button>
      </div>
      <div className="photo-cart-selection">
        {fourballs.map((team) => (
          <label key={team.id}>
            <input
              type="checkbox"
              checked={selected.includes(team.id)}
              disabled={busy || Boolean(pendingBatch.current)}
              onChange={(e) =>
                setSelected((previous) =>
                  e.target.checked
                    ? [...previous, team.id]
                    : previous.filter((id) => id !== team.id),
                )
              }
            />
            <span>
              {team.team_name}
              {cards[team.id] ? " — Ready" : ""}
              {errors[team.id] ? (
                <span className="error-banner">{errors[team.id]}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      {!fourballs.length ? (
        <p>No fourballs have been created for this event yet.</p>
      ) : null}
      <p>
        {selected.length} selected · {ready.length} QR codes ready
      </p>
      <div className="photo-actions">
        <button
          className="primary-button"
          disabled={
            busy || !selected.length || ready.length === selected.length
          }
          onClick={() => void create()}
        >
          {busy ? "Creating codes…" : "Create remaining links & QR codes"}
        </button>
        {busy ? (
          <button
            className="secondary-button"
            onClick={() => {
              stop.current = true;
              setMessage("Stopping after the current request…");
            }}
          >
            Stop
          </button>
        ) : null}
        <button
          className="secondary-button"
          disabled={!ready.length || busy}
          onClick={() =>
            download(
              cartPrintDocument(ready, eventName),
              "text/html;charset=utf-8",
              `fourball-cart-QR-${eventId}.html`,
            )
          }
        >
          Download print sheet ({ready.length})
        </button>
        <button
          className="secondary-button"
          disabled={!ready.length || busy}
          onClick={() =>
            download(
              cartLinksCsv(ready),
              "text/csv;charset=utf-8",
              `fourball-gallery-links-${eventId}.csv`,
            )
          }
        >
          Download links CSV
        </button>
      </div>
      <p>
        Open the downloaded print sheet, then choose Print / Save as PDF. It
        includes four cards per A4 page. Save it to reprint the same codes
        later; links cannot be retrieved after leaving this page.
      </p>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
