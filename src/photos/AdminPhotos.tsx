import { BatchPhotoLinks } from "./BatchPhotoLinks";
import { useCallback, useEffect, useState } from "react";
import { opsApi } from "../ops/client";
import { PhotoGallery } from "./PhotoGallery";
import { FourballTags } from "./PhotoUpload";
import { IssuedPhotoLink, type IssuedLink } from "./PhotoLink";
import type { Fourball, PhotoApi } from "./client";
import "./photos.css";
interface Link {
  id: string;
  kind: "gallery" | "staff";
  label: string;
  fourball_id: string | null;
  revoked_at: string | null;
  created_at: string;
}
interface Setup {
  settings: { gallery_enabled: boolean; uploads_enabled: boolean };
  fourballs: Fourball[];
  links: Link[];
}
export function AdminPhotos({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [editTags, setEditTags] = useState(false);
  const [kind, setKind] = useState<"staff" | "gallery">("staff");
  const [fourballId, setFourballId] = useState("");
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [revision, setRevision] = useState(0);
  const api: PhotoApi = useCallback(
    <T,>(query = "", body?: unknown) =>
      opsApi<T>(
        `/api/v1/admin/photos${query}`,
        body ? { method: "POST", body: JSON.stringify(body) } : {},
      ),
    [],
  );
  useEffect(() => {
    let active = true;
    api<Setup>(`?eventId=${eventId}`)
      .then((data) => {
        if (active) setSetup(data);
      })
      .catch((caught: Error) => {
        if (active) setError(caught.message);
      });
    return () => {
      active = false;
    };
  }, [api, eventId, revision]);
  async function mutate(body: object) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ link?: IssuedLink }>("", { ...body, eventId });
      setRevision((v) => v + 1);
      setMessage("Saved.");
      return result;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Photo action failed.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function moderate(next: string | null) {
    const result = await mutate({
      action: "moderate",
      ids: selected,
      status: next,
      ...(editTags ? { fourballIds: tags } : {}),
    });
    if (result) {
      setSelected([]);
      setEditTags(false);
    }
  }
  async function removeSelected() {
    if (
      !window.confirm(
        `Permanently delete ${selected.length} selected photo${selected.length === 1 ? "" : "s"}? This removes the files and all gallery and review entries, including Rejected. This cannot be undone.`,
      )
    )
      return;
    const result = await mutate({ action: "delete", ids: selected });
    setRevision((v) => v + 1);
    setSelected([]);
    if (result) {
      setEditTags(false);
      setMessage("Photos permanently deleted.");
    }
  }
  async function create(replace?: Link) {
    const result = await mutate({
      action: "link",
      kind: replace?.kind || kind,
      fourballId: replace
        ? replace.fourball_id
        : kind === "gallery"
          ? fourballId
          : null,
      label: replace?.label || label,
      ...(replace ? { replaceId: replace.id } : {}),
    });
    if (result?.link) setIssued(result.link);
  }
  return (
    <div className="admin-photos">
      <header className="section-header">
        <div>
          <p className="eyebrow">Capture, approve, share</p>
          <h2>Event photos</h2>
          <p>
            Review uploads, manage access and give golfers photos throughout the
            day.
          </p>
        </div>
      </header>
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="success-banner" role="status">
          {message}
        </p>
      ) : null}
      {setup ? (
        <>
          <section className="panel photo-settings">
            <h3>Photo access</h3>
            <label>
              <input
                type="checkbox"
                checked={setup.settings.gallery_enabled}
                disabled={busy}
                onChange={(e) =>
                  void mutate({
                    action: "settings",
                    galleryEnabled: e.target.checked,
                    uploadsEnabled: setup.settings.uploads_enabled,
                  })
                }
              />
              Gallery access enabled
            </label>
            <label>
              <input
                type="checkbox"
                checked={setup.settings.uploads_enabled}
                disabled={busy}
                onChange={(e) =>
                  void mutate({
                    action: "settings",
                    galleryEnabled: setup.settings.gallery_enabled,
                    uploadsEnabled: e.target.checked,
                  })
                }
              />
              Accept new contributions
            </label>
            <p className="muted-copy">
              Disabling gallery access also pauses uploads. Approved photos
              remain stored.
            </p>
          </section>
          <BatchPhotoLinks
            eventId={eventId}
            eventName={eventName}
            fourballs={setup.fourballs}
            onCreated={() => setRevision((v) => v + 1)}
          />
          <details className="panel photo-access-panel">
            <summary>Staff upload links & fourball QR codes</summary>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <label>
                Access type
                <select
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as "staff" | "gallery")
                  }
                >
                  <option value="staff">Staff / photographer upload</option>
                  <option value="gallery">Fourball gallery</option>
                </select>
              </label>
              {kind === "gallery" ? (
                <label>
                  Fourball
                  <select
                    value={fourballId}
                    onChange={(e) => setFourballId(e.target.value)}
                    required
                  >
                    <option value="">Choose fourball</option>
                    {setup.fourballs.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.team_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Link label
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Course photographer"
                />
              </label>
              <button className="primary-button" disabled={busy}>
                Create link & QR
              </button>
            </form>
            {issued ? (
              <IssuedPhotoLink
                link={issued}
                label={
                  issued.kind === "staff"
                    ? issued.label || "Staff photo uploads"
                    : setup.fourballs.find((t) => t.id === issued.fourball_id)
                        ?.team_name || "Fourball photos"
                }
              />
            ) : null}
            <div className="photo-link-list">
              {setup.links.map((link) => (
                <article key={link.id}>
                  <div>
                    <strong>
                      {link.label ||
                        (link.kind === "staff"
                          ? "Staff upload link"
                          : "Fourball gallery")}
                    </strong>
                    <span>
                      {setup.fourballs.find((t) => t.id === link.fourball_id)
                        ?.team_name || "Event staff"}{" "}
                      · {new Date(link.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {link.revoked_at ? (
                    <span>Revoked</span>
                  ) : (
                    <div className="photo-actions">
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void create(link)}
                      >
                        Replace link
                      </button>
                      <button
                        className="danger-link"
                        disabled={busy}
                        onClick={() =>
                          void mutate({ action: "revoke", id: link.id })
                        }
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </details>
          <nav className="photo-tabs" aria-label="Photo approval queues">
            {["pending", "approved", "rejected"].map((value) => (
              <button
                key={value}
                aria-pressed={status === value}
                onClick={() => {
                  setStatus(value);
                  setSelected([]);
                }}
              >
                {value === "pending"
                  ? "Awaiting approval"
                  : value === "approved"
                    ? "Approved"
                    : "Rejected"}
              </button>
            ))}
          </nav>
          {selected.length ? (
            <section className="photo-moderation panel">
              <strong>{selected.length} selected</strong>
              <label>
                <input
                  type="checkbox"
                  checked={editTags}
                  onChange={(e) => setEditTags(e.target.checked)}
                />
                Replace fourball tags on selected photos
              </label>
              {editTags ? (
                <FourballTags
                  fourballs={setup.fourballs}
                  value={tags}
                  onChange={setTags}
                />
              ) : null}
              <div className="photo-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void removeSelected()}
                >
                  Delete permanently
                </button>
                {status !== "approved" ? (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void moderate("approved")}
                  >
                    Approve selected
                  </button>
                ) : (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void moderate("pending")}
                  >
                    Withdraw approval
                  </button>
                )}
                {status !== "rejected" ? (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void moderate("rejected")}
                  >
                    Reject selected
                  </button>
                ) : null}
                {editTags ? (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void moderate(null)}
                  >
                    Save tags only
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
          <PhotoGallery
            key={status}
            api={api}
            query={`?view=gallery&eventId=${eventId}&status=${status}`}
            admin
            selected={selected}
            onSelect={setSelected}
            revision={revision}
          />
        </>
      ) : (
        <p role="status">Loading photo workspace…</p>
      )}
    </div>
  );
}
