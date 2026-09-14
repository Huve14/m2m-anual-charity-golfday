import { useEffect, useMemo, useState } from "react";
import { capabilityApi, type Fourball } from "./client";
import { PhotoGallery } from "./PhotoGallery";
import { PhotoUpload } from "./PhotoUpload";
interface Context {
  event: { id: string; name: string };
  kind: "staff" | "gallery";
  fourballId: string | null;
  fourballs: Fourball[];
  uploadsEnabled: boolean;
}
export function PhotoApp() {
  // Fragments never reach access logs or Referer headers. Keep only in this tab's session.
  const [token] = useState(() => {
    const value = window.location.hash.slice(1);
    if (value) {
      sessionStorage.setItem("m2m-photo-token", value);
      window.history.replaceState(null, "", window.location.pathname);
    }
    return value || sessionStorage.getItem("m2m-photo-token") || "";
  });
  const api = useMemo(() => capabilityApi(token), [token]);
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"mine" | "all">("mine");
  const [uploadOpen, setUploadOpen] = useState(false);
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (document.hidden) return;
      try {
        const data = await api<Context>();
        if (active) {
          setContext(data);
          setError("");
        }
      } catch (caught) {
        if (active) {
          setContext(null);
          setError(
            caught instanceof Error
              ? caught.message
              : "This link is unavailable.",
          );
        }
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api]);
  return (
    <div className="photo-app">
      <header className="photo-topbar">
        <img src="/assets/m2m-logo.png" alt="M2M" />
        <span>Golf day photos</span>
      </header>
      <main className="photo-main">
        {error ? (
          <div className="photo-empty">
            <h1>Photo access unavailable</h1>
            <p role="alert">{error}</p>
          </div>
        ) : !context ? (
          <p role="status">Opening your photos…</p>
        ) : (
          <>
            <header className="photo-hero">
              <p className="eyebrow">
                {context.kind === "staff"
                  ? "Capture the day"
                  : "Captured on the course"}
              </p>
              <h1>{context.event.name}</h1>
              <p>
                {context.kind === "staff"
                  ? "Upload your photos for the event team to approve."
                  : `${context.fourballs[0]?.team_name || "Your fourball"} · Memories ready to download and share.`}
              </p>
              {context.kind === "gallery" ? (
                <button
                  className="primary-button"
                  onClick={() => setUploadOpen((value) => !value)}
                >
                  {uploadOpen ? "Hide uploads" : "Upload your photos"}
                </button>
              ) : null}
            </header>
            <div hidden={context.kind !== "staff" && !uploadOpen}>
              <PhotoUpload
                api={api}
                fourballs={context.fourballs}
                defaultFourballId={context.fourballId || undefined}
                enabled={context.uploadsEnabled}
              />
            </div>
            {context.kind === "gallery" ? (
              <>
                <nav className="photo-tabs" aria-label="Choose photo gallery">
                  <button
                    aria-pressed={tab === "mine"}
                    onClick={() => setTab("mine")}
                  >
                    My fourball
                  </button>
                  <button
                    aria-pressed={tab === "all"}
                    onClick={() => setTab("all")}
                  >
                    All event photos
                  </button>
                </nav>
                <PhotoGallery
                  key={tab}
                  api={api}
                  query={`?view=gallery&scope=${tab}`}
                />
              </>
            ) : null}
          </>
        )}
      </main>
      <footer className="photo-footer">
        M2M Charity Golf Day · Photos published with organiser approval
      </footer>
    </div>
  );
}
