import { useEffect, useState } from "react";
import { opsApi } from "../ops/client";
import "./photos.css";
export interface IssuedLink {
  id: string;
  path: string;
  kind: string;
  label: string;
  fourball_id: string | null;
}
export function IssuedPhotoLink({
  link,
  label,
}: {
  link: IssuedLink;
  label: string;
}) {
  const url = new URL(link.path, window.location.origin).href;
  const [qr, setQr] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    import("qrcode")
      .then((qrcode) =>
        qrcode.toDataURL(url, {
          width: 640,
          margin: 3,
          errorCorrectionLevel: "M",
        }),
      )
      .then((data) => {
        if (active) setQr(data);
      })
      .catch(() => {
        if (active) setMessage("QR generation failed. Copy the link below.");
      });
    return () => {
      active = false;
    };
  }, [url]);
  return (
    <div className="photo-issued-link">
      <div className="photo-print-card">
        <h3>{label}</h3>
        {qr ? (
          <img src={qr} alt={`Scan for ${label}`} width={200} height={200} />
        ) : null}
        <p>
          Scan to{" "}
          {link.kind === "staff"
            ? "upload golf-day photos"
            : "view, download and share golf-day photos"}
          .
        </p>
      </div>
      <a href={url} target="_blank" rel="noreferrer">
        Open {link.kind === "staff" ? "upload page" : "gallery"}
      </a>
      <label>
        Shareable link
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <p className="muted-copy">
        Save this link or QR now. Anyone holding it has{" "}
        {link.kind === "staff" ? "upload" : "gallery and contribution"} access.
      </p>
      <div className="photo-actions">
        <button
          className="secondary-button"
          onClick={() =>
            void navigator.clipboard
              .writeText(url)
              .then(() => setMessage("Link copied."))
              .catch(() => setMessage("Select the link above to copy it."))
          }
        >
          Copy link
        </button>
        {qr ? (
          <a
            className="secondary-button"
            href={qr}
            download={`golf-day-qr-${link.id}.png`}
          >
            Download QR
          </a>
        ) : null}
        <button className="secondary-button" onClick={() => window.print()}>
          Print QR
        </button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
export function FourballPhotoLink({
  eventId,
  fourballId,
  label,
}: {
  eventId: string;
  fourballId: string;
  label: string;
}) {
  const [link, setLink] = useState<IssuedLink | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const data = await opsApi<{ link: IssuedLink }>("/api/v1/photo-links", {
        method: "POST",
        body: JSON.stringify({ eventId, fourballId }),
      });
      setLink(data.link);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Link creation failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="photo-link-section">
      <h3>Fourball photos</h3>
      <p>Give every golfer a link or QR code for the day’s approved photos.</p>
      {link ? (
        <IssuedPhotoLink link={link} label={label} />
      ) : (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy ? "Creating…" : "Create gallery link & QR"}
        </button>
      )}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
