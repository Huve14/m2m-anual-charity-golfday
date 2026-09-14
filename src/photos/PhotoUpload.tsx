import { useEffect, useRef, useState } from "react";
import type { Upload } from "tus-js-client";
import { transferPhoto, type Fourball, type PhotoApi } from "./client";
interface QueueItem {
  id: string;
  file: File;
  batchId: string;
  tags: string[];
  reserved: boolean;
  uploaded: boolean;
  state: string;
  progress: number;
  error: string;
}
export function FourballTags({
  fourballs,
  value,
  onChange,
  disabled = false,
}: {
  fourballs: Fourball[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="photo-tags" disabled={disabled}>
      <legend>Link to fourballs</legend>
      <label>
        <input
          type="checkbox"
          checked={!value.length}
          onChange={() => onChange([])}
        />
        General event
      </label>
      {fourballs.map((team) => (
        <label key={team.id}>
          <input
            type="checkbox"
            checked={value.includes(team.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, team.id]
                  : value.filter((id) => id !== team.id),
              )
            }
          />
          {team.team_name}
        </label>
      ))}
    </fieldset>
  );
}
export function PhotoUpload({
  api,
  fourballs,
  defaultFourballId,
  enabled,
}: {
  api: PhotoApi;
  fourballs: Fourball[];
  defaultFourballId?: string;
  enabled: boolean;
}) {
  const [tags, setTags] = useState<string[]>(
    defaultFourballId ? [defaultFourballId] : [],
  );
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const uploads = useRef(new Set<Upload>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const active = uploads.current;
    return () => {
      alive.current = false;
      active.forEach((upload) => {
        void upload.abort();
      });
    };
  }, []);
  function update(id: string, changes: Partial<QueueItem>) {
    if (alive.current)
      setQueue((rows) =>
        rows.map((row) => (row.id === id ? { ...row, ...changes } : row)),
      );
  }
  async function process(items: QueueItem[]) {
    setBusy(true);
    setError("");
    try {
      const unreserved = items.filter((item) => !item.reserved);
      if (unreserved.length) {
        await api("", {
          action: "reserve",
          batchId: unreserved[0].batchId,
          files: unreserved.map((item) => ({
            id: item.id,
            name: item.file.name,
            type: item.file.type,
            size: item.file.size,
          })),
          fourballIds: unreserved[0].tags,
        });
        unreserved.forEach((item) => {
          item.reserved = true;
          update(item.id, { reserved: true });
        });
      }
      // Sequential uploads keep large camera batches usable on limited mobile connections.
      for (const item of items) {
        if (!alive.current) break;
        try {
          update(item.id, { state: "Uploading", error: "" });
          if (!item.uploaded) {
            // A previous attempt may have reached storage even if its response was lost.
            let alreadyComplete = false;
            if (item.state === "Needs retry") {
              try {
                await api("", { action: "complete", id: item.id });
                alreadyComplete = true;
              } catch {
                /* Upload or finalisation still needed. */
              }
            }
            if (!alreadyComplete) {
              await transferPhoto(
                item.file,
                item.id,
                api,
                (p) => update(item.id, { progress: p }),
                (upload) => uploads.current.add(upload),
              );
            }
            item.uploaded = true;
            update(item.id, { uploaded: true });
          }
          update(item.id, { state: "Checking photo", progress: 100 });
          await api("", { action: "complete", id: item.id });
          update(item.id, { state: "Awaiting approval" });
        } catch (caught) {
          update(item.id, {
            state: "Needs retry",
            error: caught instanceof Error ? caught.message : "Upload failed.",
          });
        }
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Upload failed.";
      setError(message);
      items.forEach((item) =>
        update(item.id, { state: "Needs retry", error: message }),
      );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function choose(files: FileList | null) {
    if (!files?.length) return;
    if (files.length > 100) {
      setError("Choose up to 100 photos per batch.");
      return;
    }
    const invalid = Array.from(files).find(
      (file) =>
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        !file.size ||
        file.size > 25 * 1024 * 1024 ||
        file.name.length > 180,
    );
    if (invalid) {
      setError(
        `${invalid.name}: use JPEG, PNG or WebP up to 25 MB. Export HEIC and RAW photos to JPEG.`,
      );
      return;
    }
    const batchId = crypto.randomUUID();
    const items = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      batchId,
      tags: [...tags],
      reserved: false,
      uploaded: false,
      state: "Queued",
      progress: 0,
      error: "",
    }));
    setQueue((previous) => [...previous, ...items]);
    void process(items);
  }
  async function retag(item: QueueItem, ids: string[]) {
    try {
      await api("", { action: "retag", id: item.id, fourballIds: ids });
      update(item.id, { tags: ids, error: "" });
    } catch (caught) {
      update(item.id, {
        error: caught instanceof Error ? caught.message : "Tag update failed.",
      });
    }
  }
  return (
    <section className="photo-upload panel">
      <h2>Upload photos</h2>
      <p>
        Take a photo or select a batch. Uploads start automatically and appear
        in the gallery after approval.
      </p>
      <p className="muted-copy">
        JPEG, PNG or WebP · 25 MB per photo · Keep this page open until uploads
        finish.
      </p>
      {!enabled ? (
        <p className="notice-banner">The organiser has paused contributions.</p>
      ) : (
        <>
          <FourballTags fourballs={fourballs} value={tags} onChange={setTags} />
          <div className="photo-actions">
            <label className="primary-button photo-file-button">
              Take a photo
              <input
                aria-label="Take a photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                disabled={busy}
                onChange={(e) => {
                  choose(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="secondary-button photo-file-button">
              Choose photos
              <input
                aria-label="Choose photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy}
                onChange={(e) => {
                  choose(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="error-banner">
          {error}
        </p>
      ) : null}
      {queue.length ? (
        <div className="photo-queue" aria-live="polite">
          {queue.map((item) => (
            <article key={item.id}>
              <strong>{item.file.name}</strong>
              <span>
                {item.state}
                {item.state === "Uploading" ? ` · ${item.progress}%` : ""}
              </span>
              {item.state === "Uploading" ? (
                <progress max={100} value={item.progress} />
              ) : null}
              {item.error ? <p role="alert">{item.error}</p> : null}
              {item.state === "Needs retry" ? (
                <button
                  className="secondary-button"
                  disabled={busy || !enabled}
                  onClick={() =>
                    void process(
                      queue.filter(
                        (q) =>
                          q.batchId === item.batchId &&
                          q.state === "Needs retry",
                      ),
                    )
                  }
                >
                  Retry batch failures
                </button>
              ) : null}
              {item.state === "Awaiting approval" ? (
                <details>
                  <summary>Adjust fourball tags</summary>
                  <FourballTags
                    fourballs={fourballs}
                    value={item.tags}
                    onChange={(ids) => void retag(item, ids)}
                    disabled={!enabled}
                  />
                </details>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
