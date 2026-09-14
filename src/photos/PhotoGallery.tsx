import { useEffect, useRef, useState } from "react";
import {
  savePhotoFile,
  type Photo,
  type PhotoApi,
  type PhotoPage,
} from "./client";
export function PhotoGallery({
  api,
  query,
  admin = false,
  selected = [],
  onSelect,
  revision = 0,
}: {
  api: PhotoApi;
  query: string;
  admin?: boolean;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  revision?: number;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [incoming, setIncoming] = useState<Photo[]>([]);
  const [pages, setPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState<Photo | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const previousPages = useRef(0);
  const latest = useRef<Photo[]>([]);
  const previewCache = useRef(new Map<string, { url: string; renewedAt: number }>());
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    let running = false;
    async function refresh() {
      if (running || document.hidden) return;
      running = true;
      try {
        let before: string | null = null;
        const rows: Photo[] = [];
        for (let page = 0; page < pages; page++) {
          const data: PhotoPage = await api<PhotoPage>(
            `${query}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
          );
          for (const photo of data.photos) {
            const cached = previewCache.current.get(photo.id);
            if (cached && Date.now() - cached.renewedAt < 40000) {
              photo.previewUrl = cached.url;
            } else {
              previewCache.current.set(photo.id, {url: photo.previewUrl, renewedAt: Date.now()});
            }
            rows.push(photo);
          }
          before = data.next;
          if (!before) break;
        }
        if (!active) return;
        latest.current = rows;
        setHasMore(Boolean(before));
        const expanded = pages > previousPages.current;
        previousPages.current = pages;
        setPhotos((existing) =>
          expanded || !existing.length
            ? rows
            : existing.flatMap((photo) => {
                const updated = rows.find((row) => row.id === photo.id);
                return updated ? [updated] : [];
              }),
        );
        setIncoming(rows);
        setError("");
        setLoading(false);
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Photos could not be refreshed.",
          );
          setPhotos([]);
          setIncoming([]);
          setOpened(null);
          setLoading(false);
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const focus = () => void refresh();
    document.addEventListener("visibilitychange", focus);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [api, query, pages, revision]);
  const newCount = incoming.filter(
    (row) => !photos.some((photo) => photo.id === row.id),
  ).length;
  async function download(photo: Photo, share = false) {
    setFileBusy(true);
    try {
      await savePhotoFile(
        api,
        `?view=photo&id=${photo.id}${
          admin
            ? `&${query
                .split("&")
                .filter((p) => p.startsWith("eventId="))
                .join("&")}`
            : ""
        }`,
        share,
      );
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError"))
        setError(caught instanceof Error ? caught.message : "Download failed.");
    } finally {
      setFileBusy(false);
    }
  }
  async function open(photo: Photo) {
    try {
      const data = await api<{ photo: Photo }>(
        `?view=photo&id=${photo.id}${
          admin
            ? `&${query
                .split("&")
                .filter((p) => p.startsWith("eventId="))
                .join("&")}`
            : ""
        }`,
      );
      setOpened(data.photo);
      dialog.current?.showModal();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Photo could not be opened.",
      );
    }
  }
  useEffect(() => {
    if (!opened) return;
    const close = () => setOpened(null);
    const element = dialog.current;
    element?.addEventListener("close", close);
    return () => element?.removeEventListener("close", close);
  }, [opened]);
  // A withdrawn image is also removed from an open viewer on the next refresh.
  const visibleOpened =
    opened && photos.some((photo) => photo.id === opened.id) ? opened : null;
  return (
    <section className="photo-gallery" aria-label="Photo gallery">
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      <div className="photo-actions">
        <span className="muted-copy">Updates every 5 seconds</span>
        {newCount ? (
          <button
            className="secondary-button"
            onClick={() => setPhotos(latest.current)}
          >
            Show {newCount} new photo{newCount === 1 ? "" : "s"}
          </button>
        ) : null}
        {admin && photos.length ? (
          <button
            className="secondary-button"
            onClick={() =>
              onSelect?.(
                selected.length ? [] : photos.map((p) => p.id).slice(0, 100),
              )
            }
          >
            {selected.length ? "Clear selection" : "Select displayed photos"}
          </button>
        ) : null}
      </div>
      {loading ? (
        <p role="status">Loading photos…</p>
      ) : !photos.length ? (
        <div className="photo-empty">
          <span aria-hidden="true">◎</span>
          <h2>
            {admin ? "No photos in this queue" : "Your golf day, in pictures"}
          </h2>
          <p>
            {admin
              ? "Completed uploads will appear here for review."
              : "Approved photos will appear here throughout the day."}
          </p>
        </div>
      ) : null}
      <div className="photo-grid">
        {photos.map((photo) => (
          <article key={photo.id} className="photo-card">
            <button
              className="photo-image"
              aria-label={`View ${photo.filename}`}
              onClick={() => void open(photo)}
            >
              <img src={photo.previewUrl} alt={photo.filename} loading="lazy" />
            </button>
            <div className="photo-card-footer">
              {admin ? (
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(photo.id)}
                    onChange={(e) =>
                      onSelect?.(
                        e.target.checked
                          ? [...selected, photo.id].slice(0, 100)
                          : selected.filter((id) => id !== photo.id),
                      )
                    }
                  />
                  Select photo
                </label>
              ) : null}
              <span title={photo.filename}>{photo.filename}</span>
              {admin ? (
                <small>
                  {photo.source === "staff" ? "Staff" : "Golfer"} ·{" "}
                  {photo.fourballIds.length
                    ? `${photo.fourballIds.length} fourball tag(s)`
                    : "General event"}{" "}
                  · Batch {photo.batchId.slice(0, 8)}
                </small>
              ) : null}
              <div className="photo-actions">
                <button
                  disabled={fileBusy}
                  onClick={() => void download(photo)}
                  className="text-button"
                >
                  Download
                </button>
                <button
                  disabled={fileBusy}
                  onClick={() => void download(photo, true)}
                  className="text-button"
                >
                  Share
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {hasMore ? (
        <button
          className="secondary-button"
          onClick={() => setPages((count) => count + 1)}
        >
          Load more photos
        </button>
      ) : null}
      <dialog ref={dialog} className="photo-lightbox">
        <button
          className="secondary-button"
          onClick={() => dialog.current?.close()}
        >
          Close photo
        </button>
        {visibleOpened ? (
          <>
            <img src={visibleOpened.downloadUrl} alt={visibleOpened.filename} />
            <div className="photo-actions">
              <button
                className="primary-button"
                disabled={fileBusy}
                onClick={() => void download(visibleOpened)}
              >
                Download full-size photo
              </button>
              <button
                className="secondary-button"
                disabled={fileBusy}
                onClick={() => void download(visibleOpened, true)}
              >
                Share photo
              </button>
            </div>
          </>
        ) : (
          <p>This photo is no longer available.</p>
        )}
      </dialog>
    </section>
  );
}
