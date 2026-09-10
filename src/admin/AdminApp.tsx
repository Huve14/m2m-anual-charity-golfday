import { prizeValueRand, supplierPrizeSummary } from "./supplierValues";
import { PlayerInputs, playerFields } from "../ops/PlayerInputs";
import { glendowerHoleGuide } from "./holeGuide";
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import { strFromU8, unzipSync } from "fflate";
import { AccountGate, SignIn, signOut, useOpsSession } from "../ops/Auth";
import { dateTime, money, OpsApiError, opsApi, toIso, toLocalInput } from "../ops/client";
import type { EventCompany, EventRecord, FourballRecord, UserRecord } from "../ops/types";

type Tab = "overview" | "setup" | "companies" | "sponsorships" | "suppliers" | "fourballs" | "tee" | "hosts" | "players" | "imports" | "exports" | "enquiries";

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "01" }, { id: "setup", label: "Event setup", icon: "02" },
  { id: "companies", label: "Companies", icon: "03" }, { id: "sponsorships", label: "Sponsorships", icon: "04" },
  { id: "suppliers", label: "Suppliers", icon: "05" }, { id: "fourballs", label: "Fourballs", icon: "06" },
  { id: "tee", label: "Tee sheet", icon: "07" }, { id: "hosts", label: "Hosts", icon: "08" },
  { id: "players", label: "Players", icon: "09" }, { id: "imports", label: "Imports", icon: "10" },
  { id: "exports", label: "Exports", icon: "11" }, { id: "enquiries", label: "Website enquiries", icon: "12" },
];

const golfFormats = [
  "Better Ball Stableford",
  "Fourball Alliance – Two scores to count",
  "Fourball Alliance – One score to count",
  "Individual Stableford",
  "Scramble",
  "Texas Scramble",
  "Medal / Stroke Play",
  "Match Play",
  "Custom",
] as const;

const formatRules: Record<string, string> = {
  "Better Ball Stableford": "Format: Better Ball Stableford. Each player plays their own ball and the best Stableford score for the side counts on each hole. Handicaps and allowances apply according to the host club's competition conditions. Ties are decided by count-back over the final 9, 6, 3 and 1 holes, then by lot. Local rules and all event-day instructions apply.",
  "Fourball Alliance – Two scores to count": "Format: Fourball Alliance. All four players play their own ball and the best two Stableford scores count on each hole. Handicaps and allowances apply according to the host club's competition conditions. Ties are decided by count-back over the final 9, 6, 3 and 1 holes, then by lot. Local rules and all event-day instructions apply.",
  "Fourball Alliance – One score to count": "Format: Fourball Alliance. All four players play their own ball and the best Stableford score counts on each hole. Handicaps and allowances apply according to the host club's competition conditions. Ties are decided by count-back over the final 9, 6, 3 and 1 holes, then by lot. Local rules and all event-day instructions apply.",
  "Individual Stableford": "Format: Individual Stableford. Each player records Stableford points on every hole and the highest total wins. Handicaps and allowances apply according to the host club's competition conditions. Ties are decided by count-back over the final 9, 6, 3 and 1 holes, then by lot. Local rules and all event-day instructions apply.",
  Scramble: "Format: Scramble. Every player tees off, the team selects a shot, and every player plays again from that position until the ball is holed. The event committee must confirm the minimum number of tee shots required per player and the team-handicap calculation before play. Ties are decided by count-back. Local rules and all event-day instructions apply.",
  "Texas Scramble": "Format: Texas Scramble. Every player tees off, the team selects a shot, and all players except the owner of the selected ball play the next shot; repeat until holed. The event committee must confirm minimum drives and team-handicap calculation before play. Ties are decided by count-back. Local rules and all event-day instructions apply.",
  "Medal / Stroke Play": "Format: Medal / Stroke Play. Each player completes every hole and the lowest net aggregate score wins. Handicaps and allowances apply according to the host club's competition conditions. Ties are decided by count-back over the final 9, 6, 3 and 1 holes, then by lot. Local rules and all event-day instructions apply.",
  "Match Play": "Format: Match Play. Holes are won, lost or halved and the match result is determined by holes up with holes remaining. Handicap strokes and the procedure for tied matches apply according to the host club's competition conditions. Local rules and all event-day instructions apply.",
  Custom: "Custom golf-day format. Add the scoring method, handicap allowance, number of scores to count, tie-break procedure, pace-of-play requirements and applicable local rules.",
};

const generalGolfDayRules = "Play is governed by the Rules of Golf, the host club's local rules and the event committee's competition conditions. Players must use their official handicap where applicable, keep pace with the group ahead, repair pitch marks and replace divots. Scores must be checked and submitted before the published deadline. The committee's decision is final. Ties are decided by count-back over the final 9, 6, 3 and 1 holes, then by lot.";

function FormatSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const options = golfFormats.includes(value as typeof golfFormats[number]) ? golfFormats : [...golfFormats.slice(0, -1), value, "Custom"];
  return <select name="format" value={value} onChange={(event) => onChange(event.target.value)} required>{options.map((format) => <option key={format} value={format}>{format}</option>)}</select>;
}

function RulesSelector({ format, rules, onRulesChange, required = true }: { format: string; rules: string; onRulesChange: (value: string) => void; required?: boolean }) {
  return <><label className="span-2"><span>Rules template</span><select value="" onChange={(event) => { const preset = event.target.value; if (preset === "format") onRulesChange(formatRules[format] || formatRules.Custom); if (preset === "general") onRulesChange(generalGolfDayRules); }}><option value="">Choose a rules template…</option><option value="format">Recommended for {format}</option><option value="general">General charity golf day</option></select></label><label className="span-2"><span>Event rules</span><textarea name="rules" value={rules} onChange={(event) => onRulesChange(event.target.value)} rows={7} required={required} placeholder="Select a template, then adjust it for the venue and competition…" /></label></>;
}

function routeTab(): Tab {
  const candidate = window.location.pathname.split("/").filter(Boolean)[1] as Tab | undefined;
  return tabs.some((item) => item.id === candidate) ? candidate! : "overview";
}

interface ApiEvents { ok: true; events: EventRecord[] }
interface ApiEvent { ok: true; event: EventRecord }

function ErrorBanner({ message }: { message: string }) {
  return message ? <div className="error-banner" role="alert">{message}</div> : null;
}

function Loading({ label = "Loading event data…" }: { label?: string }) {
  return <div className="loading-state"><span className="spinner" />{label}</div>;
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{copy}</p></div>;
}

function Pill({ value }: { value: string }) {
  return <span className={`status-pill status-${value.toLowerCase().replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

function SectionHeader({ eyebrow, title, copy, actions }: { eyebrow: string; title: string; copy?: string; actions?: ReactNode }) {
  return <header className="section-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{copy ? <p>{copy}</p> : null}</div>{actions ? <div className="section-actions">{actions}</div> : null}</header>;
}

function FormActions({ busy, label = "Save" }: { busy: boolean; label?: string }) {
  return <div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving…" : label}</button></div>;
}

async function jsonMutation<T>(path: string, method: string, body: unknown) {
  return opsApi<T>(path, { method, body: JSON.stringify(body) });
}

export function AdminRoot() {
  const auth = useOpsSession();
  if (auth.loading) return <Loading label="Opening secure operations…" />;
  if (!auth.session) return <><ErrorBanner message={auth.error} /><SignIn audience="admin" /></>;
  return <AccountGate><AdminApp /></AccountGate>;
}

function AdminApp() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("event") || "");
  const [tab, setTab] = useState<Tab>(routeTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    opsApi<ApiEvents>("/api/v1/admin/events")
      .then((payload) => { if (active) { setEvents(payload.events); setError(""); } })
      .catch((caught: Error) => { if (active) setError(caught.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);

  useEffect(() => {
    const restoreRoute = () => {
      setSelectedId(new URLSearchParams(window.location.search).get("event") || "");
      setTab(routeTab());
    };
    window.addEventListener("popstate", restoreRoute);
    return () => window.removeEventListener("popstate", restoreRoute);
  }, []);

  const selected = events.find((event) => event.id === selectedId) || null;
  function chooseEvent(id: string) {
    setSelectedId(id);
    setTab("overview");
    const url = new URL(window.location.href);
    url.searchParams.delete("company");
    if (id) url.searchParams.set("event", id); else url.searchParams.delete("event");
    url.pathname = id ? "/admin/overview" : "/admin";
    window.history.pushState({}, "", url);
  }
  function chooseTab(nextTab: Tab) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    url.searchParams.delete("company");
    url.pathname = `/admin/${nextTab}`;
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  function refresh() { setVersion((value) => value + 1); }

  if (loading) return <Loading />;
  return (
    <div className="ops-app">
      <header className="ops-topbar">
        <button className="brand-button" onClick={() => chooseEvent("")}><img src="/assets/m2m-logo.png" alt="M2M" /><span>Golf operations</span></button>
        <div className="topbar-actions"><span className="secure-label"><i /> Secure admin</span><button className="ghost-button" onClick={() => setUsersOpen(true)}>Users</button><button className="ghost-button" onClick={signOut}>Sign out</button></div>
      </header>
      {selected ? (
        <div className="workspace-shell">
          <aside className="workspace-sidebar">
            <button className="event-back" onClick={() => chooseEvent("")}>← All events</button>
            <div className="event-identity" style={{ "--event-accent": selected.accentColour } as CSSProperties}><Pill value={selected.status} /><h1>{selected.name}</h1><p>{selected.venueName || "Venue to follow"}</p><span>{dateTime(selected.shotgunStartAt)}</span></div>
            <nav aria-label="Event workspace">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => chooseTab(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
          </aside>
          <main className="workspace-main"><ErrorBanner message={error} /><EventTab event={selected} tab={tab} version={version} onRefresh={refresh} /></main>
        </div>
      ) : (
        <main className="event-directory">
          <SectionHeader eyebrow="Multi-event control room" title="Golf day events" copy="Create, stage and run every golf day as a distinct operational workspace." actions={<button className="primary-button" onClick={() => setCreateOpen(true)}>Create event</button>} />
          <ErrorBanner message={error} />
          {events.length === 0 ? <Empty title="No events yet" copy="Create the first golf day to configure sponsors, fourballs and hosts." /> : <div className="event-grid">{events.map((event) => <button key={event.id} className="event-card" onClick={() => chooseEvent(event.id)} style={{ "--event-accent": event.accentColour } as CSSProperties}><div><Pill value={event.status} /><span className="event-code">{event.slug}</span></div><h2>{event.name}</h2><p>{event.venueName || "Venue not set"}</p><dl><div><dt>Format</dt><dd>{event.format}</dd></div><div><dt>Shotgun</dt><dd>{dateTime(event.shotgunStartAt)}</dd></div></dl><span className="card-link">Open workspace →</span></button>)}</div>}
        </main>
      )}
      {createOpen ? <EventCreate onClose={() => setCreateOpen(false)} onCreated={(event) => { setCreateOpen(false); refresh(); chooseEvent(event.id); }} /> : null}
      {usersOpen ? <UserDrawer onClose={() => setUsersOpen(false)} /> : null}
    </div>
  );
}

function EventCreate({ onClose, onCreated }: { onClose: () => void; onCreated: (event: EventRecord) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [format, setFormat] = useState("Better Ball Stableford");
  const [rules, setRules] = useState(formatRules["Better Ball Stableford"]);
  function chooseFormat(nextFormat: string) {
    setFormat(nextFormat);
    setRules(formatRules[nextFormat] || formatRules.Custom);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const payload = await jsonMutation<ApiEvent>("/api/v1/admin/events", "POST", {
        name: data.get("name"), slug: data.get("slug"), venueName: data.get("venueName"), venueAddress: data.get("venueAddress"),
        format: data.get("format"), timezone: "Africa/Johannesburg", currency: "ZAR",
        shotgunStartAt: toIso(data.get("shotgunStartAt")), registrationDeadlineAt: toIso(data.get("registrationDeadlineAt")),
        playerDeadlineAt: toIso(data.get("playerDeadlineAt")), rules: data.get("rules"), primaryColour: "#0C1735", accentColour: "#ED1C24",
        holeCount: Number(data.get("holeCount")), slotsPerHole: Number(data.get("slotsPerHole")),
      });
      onCreated(payload.event);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Event creation failed."); }
    finally { setBusy(false); }
  }
  // FormatSelect is rendered inside its visible Format label below.
  // eslint-disable-next-line jsx-a11y/label-has-associated-control
  return <div className="overlay" role="presentation"><section className="drawer wide" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="drawer-head"><div><p className="eyebrow">New golf day</p><h2 id="create-title">Create event workspace</h2></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div><form className="form-grid" onSubmit={submit}><ErrorBanner message={error} /><label className="span-2"><span>Event name</span><input name="name" required placeholder="M2M Invitational 2027" onBlur={(e) => { const slug = e.currentTarget.form?.elements.namedItem("slug") as HTMLInputElement; if (slug && !slug.value) slug.value = e.currentTarget.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }} /></label><label><span>URL slug</span><input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="m2m-invitational-2027" /></label><label><span>Format</span><FormatSelect value={format} onChange={chooseFormat} /></label><label><span>Venue</span><input name="venueName" required /></label><label><span>Venue address</span><input name="venueAddress" /></label><label><span>Shotgun start</span><input type="datetime-local" name="shotgunStartAt" required /></label><label><span>Registration deadline</span><input type="datetime-local" name="registrationDeadlineAt" required /></label><label><span>Player deadline</span><input type="datetime-local" name="playerDeadlineAt" required /></label><label><span>Number of holes</span><input type="number" name="holeCount" min="1" max="36" defaultValue="18" required /></label><label><span>Starts per hole</span><select name="slotsPerHole" defaultValue="2"><option value="1">A only</option><option value="2">A and B</option><option value="3">A, B and C</option></select></label><RulesSelector format={format} rules={rules} onRulesChange={setRules} /><FormActions busy={busy} label="Create event" /></form></section></div>;
}

function EventTab({ event, tab, version, onRefresh }: { event: EventRecord; tab: Tab; version: number; onRefresh: () => void }) {
  if (tab === "overview") return <Overview event={event} version={version} />;
  if (tab === "setup") return <EventSetup key={event.id} event={event} onRefresh={onRefresh} />;
  if (tab === "companies") return <Companies event={event} version={version} onRefresh={onRefresh} />;
  if (tab === "sponsorships") return <Sponsorships event={event} version={version} onRefresh={onRefresh} />;
  if (tab === "suppliers") return <Suppliers key={event.id} event={event} version={version} onRefresh={onRefresh} />;
  if (tab === "fourballs") return <Fourballs event={event} version={version} onRefresh={onRefresh} />;
  if (tab === "tee") return <TeeSheet event={event} version={version} onRefresh={onRefresh} />;
  if (tab === "hosts") return <Hosts event={event} version={version} onRefresh={onRefresh} />;
  if (tab === "players") return <Players event={event} version={version} />;
  if (tab === "imports") return <ConfirmedImports event={event} onRefresh={onRefresh} />;
  if (tab === "exports") return <Exports event={event} />;
  return <Enquiries event={event} version={version} onRefresh={onRefresh} />;
}

interface DashboardPayload { ok: true; metrics: Record<string, number>; setup: { blockers: string[]; warnings: string[]; readyToActivate: boolean } }
function Overview({ event, version }: { event: EventRecord; version: number }) {
  const [data, setData] = useState<DashboardPayload | null>(null); const [error, setError] = useState("");
  useEffect(() => { let active = true; opsApi<DashboardPayload>(`/api/v1/admin/dashboard?eventId=${event.id}`).then((payload) => { if (active) setData(payload); }).catch((caught: Error) => { if (active) setError(caught.message); }); return () => { active = false; }; }, [event.id, version]);
  if (!data && !error) return <Loading />;
  const metrics = data?.metrics || {};
  const cards = [["Confirmed companies", metrics.confirmedCompanies], ["Sponsor capacity", metrics.sponsorshipCapacity], ["Reserved sponsor units", metrics.reservedSponsorUnits], ["Confirmed sponsor units", metrics.confirmedSponsorUnits], ["Allocated sponsor units", metrics.allocatedSponsorUnits], ["Unallocated sponsor units", metrics.unallocatedSponsorUnits], ["Total fourballs", metrics.totalFourballs], ["Confirmed fourballs", metrics.confirmedFourballs], ["Complete fourballs", metrics.completeFourballs], ["Incomplete fourballs", metrics.incompleteFourballs], ["Player fields complete", `${metrics.filledRequiredPlayerFields || 0}/${metrics.totalRequiredPlayerFields || 0}`], ["Player completion", `${metrics.playerCompletionPercent || 0}%`], ["Hosts invited", metrics.invitedHosts], ["Hosts accepted", metrics.acceptedHosts], ["Hosts submitted", metrics.submittedHosts], ["Hosts outstanding", metrics.outstandingHosts], ["Overdue hosts", metrics.overdueHosts], ["Fourballs without starts", metrics.unassignedFourballs], ["Open tee slots", metrics.openTeeSlots]];
  return <><SectionHeader eyebrow="Operational overview" title={event.name} copy={`${event.format} · ${event.venueName || "Venue to follow"} · ${dateTime(event.shotgunStartAt)}`} /><ErrorBanner message={error} /><div className="metric-grid">{cards.map(([label, value]) => <article className="metric-card" key={String(label)}><span>{label}</span><strong>{value ?? 0}</strong></article>)}</div>{data ? <div className="overview-panels"><section className="panel"><h3>Setup readiness</h3>{data.setup.blockers.length === 0 ? <p className="success-copy">Core setup is complete.</p> : <ul className="issue-list">{data.setup.blockers.map((item) => <li key={item}>Required: {item}</li>)}</ul>}{data.setup.warnings.length > 0 ? <ul className="warning-list">{data.setup.warnings.map((item) => <li key={item}>Recommended: {item}</li>)}</ul> : null}</section><section className="panel"><h3>Next operational focus</h3><p>{metrics.unassignedFourballs ? `${metrics.unassignedFourballs} confirmed fourball(s) still need a shotgun start.` : "All confirmed fourballs have start positions."}</p><p>{metrics.overdueHosts ? `${metrics.overdueHosts} host submission(s) are overdue.` : `${metrics.outstandingHosts || 0} host submission(s) remain outstanding.`}</p></section></div> : null}</>;
}

function EventSetup({ event, onRefresh }: { event: EventRecord; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [imagery, setImagery] = useState({ logo: event.logoPath, banner: event.bannerPath });
  const [uploadMessage, setUploadMessage] = useState("");
  const [visibleFields, setVisibleFields] = useState(event.visiblePlayerFields || playerFields.map((field) => field.key));
  const [requiredFields, setRequiredFields] = useState(event.requiredPlayerFields);
  const [format, setFormat] = useState(event.format);
  const [rules, setRules] = useState(event.rules);
  function chooseFormat(nextFormat: string) {
    setFormat(nextFormat);
    setRules(formatRules[nextFormat] || formatRules.Custom);
  }
  async function submit(formEvent: FormEvent<HTMLFormElement>) { formEvent.preventDefault(); setBusy(true); setError(""); setMessage(""); const data = new FormData(formEvent.currentTarget); try { await jsonMutation("/api/v1/admin/events", "PATCH", { id: event.id, action: "update", name: data.get("name"), slug: data.get("slug"), venueName: data.get("venueName"), venueAddress: data.get("venueAddress"), format: data.get("format"), timezone: data.get("timezone"), currency: data.get("currency"), shotgunStartAt: toIso(data.get("shotgunStartAt")), registrationDeadlineAt: toIso(data.get("registrationDeadlineAt")), playerDeadlineAt: toIso(data.get("playerDeadlineAt")), rules: data.get("rules"), primaryColour: data.get("primaryColour"), accentColour: data.get("accentColour"), visiblePlayerFields: visibleFields, requiredPlayerFields: requiredFields.filter((field) => visibleFields.includes(field)), shirtSizeOptions: String(data.get("shirtSizeOptions") || "").split(",").map((v) => v.trim()).filter(Boolean), reminderOffsetsDays: String(data.get("reminderOffsetsDays") || "").split(",").map(Number).filter(Boolean) }); setDirty(false); setMessage("Event setup saved."); onRefresh(); } catch (caught) { setError(caught instanceof OpsApiError && Object.keys(caught.fieldErrors).length ? `${caught.message} ${Object.entries(caught.fieldErrors).map(([field, message]) => `${field}: ${message}`).join(" ")}` : caught instanceof Error ? caught.message : "Save failed."); } finally { setBusy(false); } }
  async function status(action: string) { setBusy(true); setError(""); try { await jsonMutation("/api/v1/admin/events", "PATCH", { id: event.id, action }); onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Status change failed."); } finally { setBusy(false); } }
  async function upload(kind: "logo" | "banner", file: File | undefined) { if (!file) return; setBusy(true); setError(""); setUploadMessage(""); try { const extension = (file.name.split(".").pop() || "png").toLowerCase(); const prepared = await jsonMutation<{ ok: true; signedUrl: string; publicUrl: string }>("/api/v1/admin/branding", "POST", { eventId: event.id, kind, extension }); const response = await fetch(prepared.signedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file }); if (!response.ok) throw new Error("The image upload failed."); await jsonMutation("/api/v1/admin/events", "PATCH", { id: event.id, action: "update", [kind === "logo" ? "logoPath" : "bannerPath"]: prepared.publicUrl }); setImagery((current) => ({ ...current, [kind]: prepared.publicUrl })); setUploadMessage(`${kind === "logo" ? "Logo" : "Banner"} saved.`); onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed."); } finally { setBusy(false); } }

  // FormatSelect is rendered inside its visible Format label below.
  // eslint-disable-next-line jsx-a11y/label-has-associated-control
  return <><SectionHeader eyebrow="Event definition" title="Setup and branding" copy="These settings control deadlines, host completion and event identity." actions={<>{event.status === "draft" ? <button className="primary-button" disabled={busy} onClick={() => status("activate")}>Activate event</button> : null}{event.status !== "archived" ? <button className="ghost-button" disabled={busy} onClick={() => status("archive")}>Archive</button> : <button className="ghost-button" disabled={busy} onClick={() => status("restoreDraft")}>Restore draft</button>}</>} /><ErrorBanner message={error} />{message ? <p className="success-banner">{message}</p> : null}<form className="panel form-grid" onSubmit={submit} onChangeCapture={() => { setDirty(true); setMessage(""); }} onInvalidCapture={() => { setError("Please check the highlighted field before saving."); setMessage(""); }}><label className="span-2"><span>Event name</span><input name="name" defaultValue={event.name} required /></label><label><span>Slug</span><input name="slug" defaultValue={event.slug} required /></label><label><span>Format</span><FormatSelect value={format} onChange={chooseFormat} /></label><label><span>Venue</span><input name="venueName" defaultValue={event.venueName} /></label><label><span>Address</span><input name="venueAddress" defaultValue={event.venueAddress} /></label><label><span>Shotgun start</span><input type="datetime-local" name="shotgunStartAt" defaultValue={toLocalInput(event.shotgunStartAt)} /></label><label><span>Registration deadline</span><input type="datetime-local" name="registrationDeadlineAt" defaultValue={toLocalInput(event.registrationDeadlineAt)} /></label><label><span>Player deadline</span><input type="datetime-local" name="playerDeadlineAt" defaultValue={toLocalInput(event.playerDeadlineAt)} /></label><label><span>Timezone</span><input name="timezone" defaultValue={event.timezone} required /></label><label><span>Currency</span><input name="currency" defaultValue={event.currency} maxLength={3} required /></label><label><span>Primary colour</span><input type="color" name="primaryColour" defaultValue={event.primaryColour} /></label><label><span>Accent colour</span><input type="color" name="accentColour" defaultValue={event.accentColour} /></label><label><span>Shirt sizes</span><input name="shirtSizeOptions" defaultValue={event.shirtSizeOptions.join(", ")} /></label><label><span>Reminder days</span><input name="reminderOffsetsDays" defaultValue={event.reminderOffsetsDays.join(", ")} /></label><fieldset className="span-2 player-field-settings"><legend>Fourball player information</legend><p>Choose which fields appear in the admin and host player forms. Hidden fields are not required; existing details are kept.</p><div className="player-field-heading"><span>Field</span><span>Show</span><span>Required</span></div>{playerFields.map(({ key, label }) => <div className="player-field-option" key={key}><span>{label}</span><input type="checkbox" aria-label={`Show ${label}`} checked={visibleFields.includes(key)} onChange={(e) => { setVisibleFields(e.target.checked ? [...visibleFields, key] : visibleFields.filter((field) => field !== key)); if (!e.target.checked) setRequiredFields(requiredFields.filter((field) => field !== key)); }} /><input type="checkbox" aria-label={`Require ${label}`} disabled={!visibleFields.includes(key)} checked={visibleFields.includes(key) && requiredFields.includes(key)} onChange={(e) => setRequiredFields(e.target.checked ? [...requiredFields, key] : requiredFields.filter((field) => field !== key))} /></div>)}</fieldset><RulesSelector format={format} rules={rules} onRulesChange={setRules} required={false} /><div className="span-2" role="status">{dirty ? "Unsaved changes. Save event setup to keep your changes." : message}</div><FormActions busy={busy} label="Save event setup" /></form><section className="panel branding-panel"><h3>Event imagery</h3><p>Choose an image to upload and save it immediately.</p>{uploadMessage ? <p className="success-banner" role="status">{uploadMessage}</p> : null}<div><label className="upload-card"><span>Event logo</span>{imagery.logo ? <img src={imagery.logo} alt="Current event logo" /> : <em>M2M fallback</em>}<input type="file" disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={(e) => upload("logo", e.target.files?.[0])} /></label><label className="upload-card banner"><span>Event banner</span>{imagery.banner ? <img src={imagery.banner} alt="Current event banner" /> : <em>M2M fallback</em>}<input type="file" disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={(e) => upload("banner", e.target.files?.[0])} /></label></div></section><PlayerFields eventId={event.id} /></>;
}

interface PlayerField { id: string; key: string; label: string; type: string; options: string[]; required: boolean }
function PlayerFields({ eventId }: { eventId: string }) {
  const [fields, setFields] = useState<PlayerField[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [version, setVersion] = useState(0);
  useEffect(() => { let active = true; opsApi<{ ok: true; fields: PlayerField[] }>(`/api/v1/admin/player-fields?eventId=${eventId}`).then((payload) => { if (active) setFields(payload.fields); }).catch((caught: Error) => { if (active) setError(caught.message); }); return () => { active = false; }; }, [eventId, version]);
  async function add(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const formElement = event.currentTarget; const form = new FormData(formElement); try { await jsonMutation("/api/v1/admin/player-fields", "POST", { action: "create", eventId, key: form.get("key"), label: form.get("label"), type: form.get("type"), required: form.get("required") === "on", options: String(form.get("options") || "").split(",").map((v) => v.trim()).filter(Boolean) }); formElement.reset(); setVersion((v) => v + 1); } catch (caught) { setError(caught instanceof Error ? caught.message : "Question creation failed."); } finally { setBusy(false); } }
  async function remove(field: PlayerField) { if (!window.confirm(`Delete “${field.label}”? Existing answers will also be removed.`)) return; setBusy(true); try { await jsonMutation("/api/v1/admin/player-fields", "DELETE", { action: "delete", eventId, id: field.id }); setVersion((v) => v + 1); } catch (caught) { setError(caught instanceof Error ? caught.message : "Delete failed."); } finally { setBusy(false); } }
  return <section className="panel"><SectionHeader eyebrow="Event-specific data" title="Custom player questions" copy="Add questions that count toward completion when marked required." /><ErrorBanner message={error} />{fields.length ? <div className="compact-list">{fields.map((field) => <div key={field.id}><div><strong>{field.label}</strong><span>{field.key} · {field.type}{field.required ? " · required" : ""}</span></div><button className="danger-link" disabled={busy} onClick={() => remove(field)}>Delete</button></div>)}</div> : <Empty title="No custom questions" copy="Built-in player fields are already available." />}<form className="inline-form" onSubmit={add}><input name="label" placeholder="Question label" required /><input name="key" placeholder="field_key" pattern="[a-z][a-z0-9_]{1,39}" required /><select name="type" defaultValue="text"><option value="text">Text</option><option value="number">Number</option><option value="select">Select</option><option value="checkbox">Checkbox</option></select><input name="options" placeholder="Options, comma separated" /><label className="check-inline"><input type="checkbox" name="required" />Required</label><button className="secondary-button" disabled={busy}>Add question</button></form></section>;
}

interface CompaniesPayload { ok: true; companies: EventCompany[]; directory: Array<{ id: string; name: string }> }
function CompanyDetailsForm({ company, busy, onSave }: { company: EventCompany; busy: boolean; onSave: (event: FormEvent<HTMLFormElement>, company: EventCompany) => Promise<void> }) {
  return <section className="panel" id="company-details"><h3>Company & contact details</h3><form className="form-grid company-details-form" onSubmit={(submitEvent) => onSave(submitEvent, company)}><label><span>Company name</span><input name="name" defaultValue={company.name} required /></label><div className="two-fields"><label><span>Registration number</span><input name="registrationNumber" defaultValue={company.registrationNumber} /></label><label><span>Company phone</span><input name="phone" defaultValue={company.phone} /></label></div><label><span>Website</span><input name="website" defaultValue={company.website} /></label><label><span>Billing email</span><input type="email" name="billingEmail" defaultValue={company.billingEmail} /></label><label><span>Primary contact</span><input name="primaryContactName" defaultValue={company.primaryContactName} /></label><label><span>Contact email</span><input type="email" name="primaryContactEmail" defaultValue={company.primaryContactEmail} /></label><label><span>Contact phone</span><input name="primaryContactPhone" defaultValue={company.primaryContactPhone} /></label><label className="span-2"><span>Notes</span><textarea name="notes" defaultValue={company.notes} /></label><div className="form-actions span-2"><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save company details"}</button></div></form></section>;
}

function QuickBookingForm({ label, options, currency, disabled, onAdd, emptyMessage = "No packages available" }: { emptyMessage?: string; label: string; options: Array<{ id: string; name: string; priceMinor: number; available: number }>; currency: string; disabled: boolean; onAdd: (typeId: string) => Promise<void> }) {
  const [choice, setChoice] = useState("");
  const selected = options.find((option) => option.id === choice) || options[0];
  return <form className="company-quick-booking" onSubmit={(event) => { event.preventDefault(); if (selected && !disabled) void onAdd(selected.id); }}>
    <label><span>{label} package</span><select aria-label={`${label} package`} value={selected?.id || ""} disabled={disabled || !selected} onChange={(event) => setChoice(event.target.value)}>
      {!selected ? <option value="">{emptyMessage}</option> : options.map((option) => <option key={option.id} value={option.id}>{option.name} · {money(option.priceMinor, currency)} · {option.available} available</option>)}
    </select></label>
    <button className="primary-button" disabled={disabled || !selected}>+ Add {label.toLowerCase()}</button>
    <p>One booking · package price · confirmed · unpaid. Details can be completed afterwards.</p>
  </form>;
}

function Companies({ event, version, onRefresh }: { event: EventRecord; version: number; onRefresh: () => void }) {
  const [sponsorshipCategory, setSponsorshipCategory] = useState("");
  const [quickTeamId, setQuickTeamId] = useState("");
  const [fourballDirty, setFourballDirty] = useState(false);
  const [fourballTypes, setFourballTypes] = useState<FourballType[]>([]);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [data, setData] = useState<CompaniesPayload | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [localVersion, setLocalVersion] = useState(0);
  const [editor, setEditor] = useState<"details" | "sponsorships" | "fourballs" | null>(null);
  const [openedEditors, setOpenedEditors] = useState({ sponsorships: false, fourballs: false });
  function toggleEditor(next: "details" | "sponsorships" | "fourballs") {
    if (next !== "details") setOpenedEditors((current) => ({ ...current, [next]: true }));
    setEditor((current) => current === next ? null : next);
  }
  const [query, setQuery] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState(() => new URLSearchParams(window.location.search).get("company") || "");
  const [message, setMessage] = useState("");
  function openCompany(id: string) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("company", id); else url.searchParams.delete("company");
    window.history.pushState({}, "", url); setSelectedCompanyId(id); setSponsorshipCategory(""); setQuickTeamId(""); setFourballDirty(false); setMessage(""); setEditor(null); setOpenedEditors({ sponsorships: false, fourballs: false });
    window.scrollTo({ top: 0 });
  }
  useEffect(() => {
    const restoreCompany = () => setSelectedCompanyId(new URLSearchParams(window.location.search).get("company") || "");
    window.addEventListener("popstate", restoreCompany);
    return () => window.removeEventListener("popstate", restoreCompany);
  }, []);
  const [sponsors, setSponsors] = useState<SponsorPayload | null>(null);
  const [teams, setTeams] = useState<FourballRecord[]>([]);
  const selectedCompany = data?.companies.find((company) => company.id === selectedCompanyId);
  useEffect(() => { let active = true; Promise.all([opsApi<CompaniesPayload>(`/api/v1/admin/companies?eventId=${event.id}`), opsApi<SponsorPayload>(`/api/v1/admin/sponsorships?eventId=${event.id}&includeCancelled=true`), opsApi<FourballsPayload>(`/api/v1/admin/fourballs?eventId=${event.id}&includeCancelled=true`), opsApi<{ types: FourballType[] }>(`/api/v1/admin/fourball-types?eventId=${event.id}`)]).then(([payload, sponsorData, teamData, typeData]) => { if (active) { setFourballTypes(typeData.types); setData(payload); setSponsors(sponsorData); setTeams(teamData.fourballs); setError(""); } }).catch((caught: Error) => { if (active) setError(caught.message); }); return () => { active = false; }; }, [event.id, version, localVersion]);
  async function add(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); setError(""); setAddErrors({});
    const formElement = formEvent.currentTarget;
    const form = new FormData(formElement);
    const text = (key: string) => String(form.get(key) || "").trim();
    function showErrors(fields: Record<string, string>) {
      setAddErrors(fields);
      setError(Object.values(fields).join(" "));
      const field = formElement.elements.namedItem(Object.keys(fields)[0]);
      if (field instanceof HTMLElement) field.focus();
    }
    const fields: Record<string, string> = {};
    if (!text("companyId") && text("name").length < 2) fields.name = "Enter a company name with at least 2 characters, or choose an existing company.";
    if (text("primaryContactName") && !text("primaryContactEmail")) fields.primaryContactEmail = "Enter a contact email for the primary contact, or leave both name and email blank.";
    if (text("primaryContactEmail") && !text("primaryContactName")) fields.primaryContactName = "Enter the primary contact’s name for this email address.";
    if (Object.keys(fields).length) { showErrors(fields); return; }
    setBusy(true);
    try {
      await jsonMutation("/api/v1/admin/companies", "POST", { eventId: event.id, companyId: text("companyId") || undefined, name: text("name") || undefined, relationshipStatus: form.get("relationshipStatus"), primaryContactName: text("primaryContactName"), primaryContactEmail: text("primaryContactEmail"), primaryContactPhone: text("primaryContactPhone") });
      formElement.reset(); setLocalVersion((v) => v + 1); onRefresh();
    } catch (caught) {
      if (caught instanceof OpsApiError && Object.keys(caught.fieldErrors).length) showErrors(caught.fieldErrors);
      else setError(caught instanceof Error ? caught.message : "Company creation failed.");
    } finally { setBusy(false); }
  }

  async function save(formEvent: FormEvent<HTMLFormElement>, company: EventCompany) {
    formEvent.preventDefault(); setBusy(true); setError("");
    const form = new FormData(formEvent.currentTarget);
    try {
      const result = await jsonMutation<{ company: EventCompany }>("/api/v1/admin/companies", "PATCH", {
        id: company.id, eventId: event.id, name: form.get("name"), registrationNumber: form.get("registrationNumber"),
        website: form.get("website"), billingEmail: form.get("billingEmail"), phone: form.get("phone"),
        primaryContactName: form.get("primaryContactName"),
        primaryContactEmail: form.get("primaryContactEmail"), primaryContactPhone: form.get("primaryContactPhone"), notes: form.get("notes"),
      });
      setData((current) => current ? { ...current, companies: current.companies.map((item) => item.id === result.company.id ? result.company : item) } : current);
      setMessage("Company details saved."); setLocalVersion((v) => v + 1); onRefresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Company update failed."); } finally { setBusy(false); }
  }
  async function saveParticipation(company: EventCompany, status: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await jsonMutation<{ company: EventCompany }>("/api/v1/admin/companies", "PATCH", { id: company.id, eventId: event.id, relationshipStatus: status });
      if (result.company.relationshipStatus !== status) throw new Error("The participation status was not saved. Please try again.");
      setData((current) => current ? { ...current, companies: current.companies.map((item) => item.id === company.id ? result.company : item) } : current);
      setMessage(`Participation saved as ${status}.`); setLocalVersion((value) => value + 1); onRefresh();
      if (status === "cancelled") setEditor(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Participation could not be saved."); }
    finally { setBusy(false); }
  }
  function revealBooking(kind: "fourballs" | "sponsorships", teamId = "") {
    if (kind === "fourballs" && teamId !== quickTeamId && fourballDirty && !window.confirm("Discard unsaved player or team changes?")) return;
    if (kind === "fourballs") { setQuickTeamId(teamId); setFourballDirty(false); }
    setOpenedEditors((current) => ({ ...current, [kind]: true })); setEditor(kind);
    requestAnimationFrame(() => document.getElementById(`company-${kind}-editor`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  async function quickAdd(kind: "fourballs" | "sponsorships", typeId: string) {
    if (busy || !selectedCompany || selectedCompany.relationshipStatus === "cancelled") return;
    if (kind === "fourballs" && fourballDirty && !window.confirm("Discard unsaved player or team changes and add a fourball?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (kind === "fourballs") {
        const type = fourballTypes.find((item) => item.id === typeId);
        if (!type) throw new Error("Choose an available fourball package.");
        const result = await jsonMutation<FourballsPayload>("/api/v1/admin/fourballs", "POST", { eventId: event.id, eventCompanyId: selectedCompany.id, fourballTypeId: type.id, quantity: 1, teamNamePrefix: `${selectedCompany.name.slice(0, 125)} – ${teams.filter((team) => team.eventCompanyId === selectedCompany.id).length + 1}`, bookingStatus: "confirmed", confirmedAmountMinor: type.priceMinor, paymentStatus: "unpaid" });
        setTeams((current) => [...current, ...result.fourballs]);
        setQuickTeamId(result.fourballs[0]?.id || ""); setFourballDirty(false);
      } else {
        const type = sponsors?.types.find((item) => item.id === typeId);
        if (!type) throw new Error("Choose an available sponsorship package.");
        await jsonMutation("/api/v1/admin/sponsorships", "POST", { action: "createCommitment", eventId: event.id, eventCompanyId: selectedCompany.id, sponsorshipTypeId: type.id, quantity: 1, status: "confirmed", confirmedAmountMinor: type.priceMinor, paymentStatus: "unpaid" });
      }
      setOpenedEditors((current) => ({ ...current, [kind]: true })); setEditor(kind);
      setMessage(kind === "fourballs" ? "Fourball added. Enter the four players below." : "Sponsorship added. Complete its details below.");
      setLocalVersion((value) => value + 1); onRefresh();
      requestAnimationFrame(() => document.getElementById(`company-${kind}-editor`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The booking could not be added."); }
    finally { setBusy(false); }
  }
  async function removeBooking(kind: "fourballs" | "sponsorships", id: string) {
    if (busy || !selectedCompany || selectedCompany.relationshipStatus === "cancelled") return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (kind === "fourballs") {
        await jsonMutation("/api/v1/admin/fourballs", "PATCH", { action: "update", eventId: event.id, id, bookingStatus: "cancelled" });
        setTeams((current) => current.map((team) => team.id === id ? { ...team, bookingStatus: "cancelled", teeSlot: null } : team));
      } else {
        await jsonMutation("/api/v1/admin/sponsorships", "POST", { action: "updateCommitment", eventId: event.id, id, status: "cancelled" });
        setSponsors((current) => current ? { ...current, commitments: current.commitments.map((item) => item.id === id ? { ...item, status: "cancelled" } : item) } : current);
      }
      setMessage("Booking removed. Its history has been retained."); setLocalVersion((value) => value + 1); onRefresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The booking could not be removed."); }
    finally { setBusy(false); }
  }
  if (selectedCompanyId && !data) return <><ErrorBanner message={error} /><Loading /></>;
  if (selectedCompany) {
    const companyTeams = teams.filter((team) => team.eventCompanyId === selectedCompany.id);
    const companySponsors = sponsors?.commitments.filter((item) => item.eventCompanyId === selectedCompany.id) || [];
    const cancelled = selectedCompany.relationshipStatus === "cancelled";
    const activeTeams = cancelled ? [] : companyTeams.filter((team) => team.bookingStatus !== "cancelled");
    const activeSponsors = cancelled ? [] : companySponsors.filter((item) => item.status !== "cancelled");
    const allocatedLocations = Array.from(new Set(activeSponsors.flatMap((item) => item.units.flatMap((unit) => { const slot = sponsors?.holeSlots.find((position) => position.id === unit.holeSlotId); return slot ? [slot.holeNumber ? `Hole ${slot.holeNumber}` : slot.locationName] : []; })))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return <div className="company-workspace company-overview">
      <button className="text-button" disabled={busy} onClick={() => openCompany("")}>← All companies</button>
      <SectionHeader eyebrow="Company overview" title={selectedCompany.name} actions={<label className="company-participation"><span>Company participation · saves immediately</span><select aria-label="Company participation" value={selectedCompany.relationshipStatus} disabled={busy} onChange={(change) => saveParticipation(selectedCompany, change.target.value)}><option value="prospect">Prospect</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select></label>} />
      <ErrorBanner message={error} />{message ? <p className="success-banner" role="status">{message}</p> : null}{busy ? <p role="status" className="muted-copy">Saving…</p> : null}
      {cancelled ? <p className="company-cancelled-banner">Participation cancelled. Bookings are inactive and course positions are released. History is retained below. <button className="secondary-button" disabled={busy} onClick={() => saveParticipation(selectedCompany, "confirmed")}>Resume bookings</button></p> : null}
      <div className="company-summary-strip"><div><span>Active fourballs</span><strong>{activeTeams.length}</strong></div><div><span>Sponsorship units</span><strong>{activeSponsors.reduce((total, item) => total + item.quantity, 0)}</strong></div><div><span>Allocated locations</span><strong>{allocatedLocations.join(", ") || "—"}</strong></div></div>
      <section className="panel company-contact-summary"><div><span className="eyebrow">Primary contact</span><h3>{selectedCompany.primaryContactName || "No contact supplied"}</h3><p>{selectedCompany.primaryContactEmail || "No email"}{selectedCompany.primaryContactPhone ? ` · ${selectedCompany.primaryContactPhone}` : ""}</p></div><button className="secondary-button" aria-expanded={editor === "details"} aria-controls="company-details-editor" onClick={() => toggleEditor("details")}>{editor === "details" ? "Close details" : "Edit contact & billing"}</button></section>
      <div className="company-booking-panels">
        <section className="panel"><header><h3>Fourballs</h3>{activeTeams.length ? <button className="text-button" disabled={busy} aria-expanded={editor === "fourballs"} onClick={() => toggleEditor("fourballs")}>{editor === "fourballs" ? "Close players" : "Enter players"}</button> : null}</header>
          {!cancelled ? <QuickBookingForm label="Fourball" currency={event.currency} disabled={busy} options={fourballTypes.filter((type) => type.isActive && type.booked < type.capacity).map((type) => ({ ...type, available: type.capacity - type.booked }))} onAdd={(typeId) => quickAdd("fourballs", typeId)} /> : null}
          {activeTeams.length ? activeTeams.map((team) => <div className="company-booking-row" key={team.id}><div><strong>{team.teamName}</strong><span>{team.players.filter((player) => player.fullName.trim()).length}/4 players named · {money(team.confirmedAmountMinor, event.currency)}</span><span>{team.teeSlot?.label || "Start not assigned"}</span></div><div className="company-booking-actions"><Pill value={team.bookingStatus} /><button className="text-button" disabled={busy} onClick={() => revealBooking("fourballs", team.id)}>Enter players</button><button className="danger-link" disabled={busy} aria-label={`Remove fourball ${team.teamName}`} onClick={() => removeBooking("fourballs", team.id)}>Remove</button></div></div>) : <p className="muted-copy">No fourballs booked. Add one above to enter players.</p>}
        </section>
        <section className="panel"><header><h3>Sponsorships</h3>{activeSponsors.length ? <button className="text-button" disabled={busy} aria-expanded={editor === "sponsorships"} onClick={() => toggleEditor("sponsorships")}>{editor === "sponsorships" ? "Close details" : "Sponsorship details"}</button> : null}</header>
          {!cancelled ? <><fieldset className="company-sponsorship-category"><legend>Sponsorship category</legend>{[["alcoholic_hole", "Alc (Alcoholic)"], ["non_alcoholic_hole", "Non Alc (Non-alcoholic)"], ...((sponsors?.types || []).some((type) => type.isActive && !["alcoholic_hole", "non_alcoholic_hole", "supplier"].includes(type.category)) ? [["other", "Branded / other"]] : [])].map(([value, label]) => <label key={value}><input type="radio" name="company-sponsorship-category" value={value} checked={sponsorshipCategory === value} disabled={busy} onChange={() => setSponsorshipCategory(value)} />{label}</label>)}</fieldset><QuickBookingForm key={sponsorshipCategory} label="Sponsorship" currency={event.currency} disabled={busy || !sponsorshipCategory} emptyMessage={sponsorshipCategory ? "No packages available in this category" : "Choose a category first"} options={(sponsors?.types || []).filter((type) => type.isActive && (sponsorshipCategory === "other" ? !["alcoholic_hole", "non_alcoholic_hole", "supplier"].includes(type.category) : type.category === sponsorshipCategory)).map((type) => ({ ...type, available: type.capacity - (sponsors?.commitments || []).filter((item) => item.sponsorshipTypeId === type.id && ["reserved", "confirmed"].includes(item.status)).reduce((total, item) => total + item.quantity, 0) })).filter((type) => type.available > 0)} onAdd={(typeId) => quickAdd("sponsorships", typeId)} /></> : null}
          {!cancelled ? <p className="muted-copy">Track products, services and prizes in <a href={`/admin/suppliers?event=${event.id}`}>Suppliers →</a>.</p> : null}
          {activeSponsors.length ? activeSponsors.map((item) => <div className="company-booking-row" key={item.id}><div><strong>{item.typeName}</strong>{item.contribution ? <span>Supplying: {item.contribution}</span> : null}<span>{sponsorshipCategoryLabel(sponsors?.types.find((type) => type.id === item.sponsorshipTypeId)?.category)}</span><span>{item.quantity} unit{item.quantity === 1 ? "" : "s"} · {money(item.confirmedAmountMinor, event.currency)}</span><span>{item.units.map((unit) => sponsors?.holeSlots.find((slot) => slot.id === unit.holeSlotId)?.displayLabel || "Location not assigned").join(" · ")}</span></div><div className="company-booking-actions"><Pill value={item.status} /><button className="danger-link" disabled={busy} aria-label={`Remove sponsorship ${item.typeName}`} onClick={() => removeBooking("sponsorships", item.id)}>Remove</button></div></div>) : <p className="muted-copy">No sponsorships booked. Add one above to enter details.</p>}
        </section>
      </div>
      {companyTeams.some((team) => team.bookingStatus === "cancelled") || companySponsors.some((item) => item.status === "cancelled") ? <details className="panel"><summary>Removed bookings</summary>{companyTeams.filter((team) => team.bookingStatus === "cancelled").map((team) => <p key={team.id}>{team.teamName} · Fourball · Cancelled</p>)}{companySponsors.filter((item) => item.status === "cancelled").map((item) => <p key={item.id}>{item.typeName} · {item.quantity} sponsorship unit{item.quantity === 1 ? "" : "s"} · Cancelled</p>)}</details> : null}
      <div id="company-details-editor" hidden={editor !== "details"}><CompanyDetailsForm key={selectedCompany.id} company={selectedCompany} busy={busy} onSave={save} /></div>
      {!cancelled ? <>
        <div id="company-sponsorships-editor" hidden={editor !== "sponsorships"}>{openedEditors.sponsorships && activeSponsors.length ? <Sponsorships companyId={selectedCompany.id} event={event} version={version + localVersion} onRefresh={onRefresh} /> : null}</div>
        <div id="company-fourballs-editor" hidden={editor !== "fourballs"}>{openedEditors.fourballs && activeTeams.length ? <Fourballs key={`${selectedCompany.id}-${quickTeamId}`} initialTeamId={quickTeamId} onDirtyChange={setFourballDirty} companyId={selectedCompany.id} event={event} version={version + localVersion} onRefresh={onRefresh} /> : null}</div>
      </> : <details className="panel"><summary>View player history</summary>{companyTeams.map((team) => <div className="company-history-team" key={team.id}><h4>{team.teamName}</h4>{team.players.map((player) => <p key={player.id}>Player {player.position}: {player.fullName || "Not supplied"}{player.email ? ` · ${player.email}` : ""}</p>)}</div>)}</details>}
    </div>;
  }
  return <>
    <SectionHeader eyebrow="Event relationships" title="Companies" copy="Your central company directory. Manage contacts, sponsorship holes and fourballs from each company." />
    <ErrorBanner message={error} />
    <section className="panel"><details className="action-disclosure"><summary>Add company</summary><form className="form-grid compact" onSubmit={add}><label><span>Use existing company</span><select name="companyId" aria-invalid={Boolean(addErrors.companyId)} aria-describedby={addErrors.companyId ? "add-company-companyId-error" : undefined} defaultValue=""><option value="">Create a new company</option>{data?.directory.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>{addErrors.companyId ? <small className="company-field-error" id="add-company-companyId-error">{addErrors.companyId}</small> : null}</label><label><span>New company name</span><input name="name" aria-invalid={Boolean(addErrors.name)} aria-describedby={addErrors.name ? "add-company-name-error" : undefined} placeholder="Leave blank when choosing existing" />{addErrors.name ? <small className="company-field-error" id="add-company-name-error">{addErrors.name}</small> : null}</label><label><span>Relationship status</span><select name="relationshipStatus" aria-invalid={Boolean(addErrors.relationshipStatus)} aria-describedby={addErrors.relationshipStatus ? "add-company-relationshipStatus-error" : undefined} defaultValue="prospect"><option value="prospect">Prospect</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option></select>{addErrors.relationshipStatus ? <small className="company-field-error" id="add-company-relationshipStatus-error">{addErrors.relationshipStatus}</small> : null}</label><label><span>Primary contact</span><input name="primaryContactName" aria-invalid={Boolean(addErrors.primaryContactName)} aria-describedby={addErrors.primaryContactName ? "add-company-primaryContactName-error" : undefined} />{addErrors.primaryContactName ? <small className="company-field-error" id="add-company-primaryContactName-error">{addErrors.primaryContactName}</small> : null}</label><label><span>Contact email</span><input type="email" name="primaryContactEmail" aria-invalid={Boolean(addErrors.primaryContactEmail)} aria-describedby={addErrors.primaryContactEmail ? "add-company-primaryContactEmail-error" : undefined} />{addErrors.primaryContactEmail ? <small className="company-field-error" id="add-company-primaryContactEmail-error">{addErrors.primaryContactEmail}</small> : null}</label><label><span>Contact phone</span><input name="primaryContactPhone" aria-invalid={Boolean(addErrors.primaryContactPhone)} aria-describedby={addErrors.primaryContactPhone ? "add-company-primaryContactPhone-error" : undefined} />{addErrors.primaryContactPhone ? <small className="company-field-error" id="add-company-primaryContactPhone-error">{addErrors.primaryContactPhone}</small> : null}</label><p className="muted-copy span-2">Primary contact is optional. If supplied, enter both a name and an email address.</p><FormActions busy={busy} label="Add company" /></form></details></section>
    <label className="company-filter"><span>Find company</span><input type="search" value={query} onChange={(change) => setQuery(change.target.value)} placeholder="Search company or contact…" /></label>
    {!data ? <Loading /> : data.companies.length === 0 ? <Empty title="No companies in this event" copy="Add a sponsor or fourball company to begin." /> : <div className="data-cards">{data.companies.filter((company) => `${company.name} ${company.primaryContactName} ${company.primaryContactEmail}`.toLowerCase().includes(query.trim().toLowerCase())).map((company) => <article key={company.id} className="data-card company-card"><div><div className="company-card-status"><span>Participation</span><Pill value={company.relationshipStatus} /></div><h3>{company.name}</h3><p>{company.primaryContactName || "No primary contact"}</p><a href={company.primaryContactEmail ? `mailto:${company.primaryContactEmail}` : undefined}>{company.primaryContactEmail || "Email not supplied"}</a><div className="company-booking-summary"><span>{teams.filter((team) => team.eventCompanyId === company.id && team.bookingStatus !== "cancelled" && company.relationshipStatus !== "cancelled").length} fourballs</span><span>{sponsors?.commitments.filter((item) => item.eventCompanyId === company.id && item.status !== "cancelled" && company.relationshipStatus !== "cancelled").reduce((total, item) => total + item.quantity, 0) || 0} sponsorship units</span><span>Locations: {Array.from(new Set(sponsors?.commitments.filter((item) => item.eventCompanyId === company.id && item.status !== "cancelled" && company.relationshipStatus !== "cancelled").flatMap((item) => item.units.flatMap((unit) => { const slot = sponsors.holeSlots.find((position) => position.id === unit.holeSlotId); return slot ? [slot.holeNumber ? `Hole ${slot.holeNumber}` : slot.locationName] : []; })) || [])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", ") || "Not allocated"}</span></div><button className="secondary-button" onClick={() => openCompany(company.id)}>Edit company →</button></div></article>)}</div>}
  </>;
}

function sponsorshipCategoryLabel(category?: string) {
  return category === "supplier" ? "Supplier sponsorship" : category === "alcoholic_hole" ? "Alc" : category === "non_alcoholic_hole" ? "Non Alc" : category === "branded_hole" ? "Branded hole" : "Other sponsorship";
}

interface SponsorshipType { id: string; name: string; category: string; capacity: number; priceMinor: number; requiresHole: boolean; isActive: boolean }
interface SponsorshipCommitment { prizeValueMinor: number | null; contribution: string; category?: string; requiresHole: boolean; id: string; eventCompanyId: string; companyName: string; sponsorshipTypeId: string; typeName: string; status: string; quantity: number; confirmedAmountMinor: number; invoiceReference: string; paymentStatus: string; notes: string; units: Array<{ id: string; unitNumber: number; holeSlotId: string | null }> }
interface SponsorPayload { ok: true; holes: Array<{ id: string; number: number; label: string }>; types: SponsorshipType[]; commitments: SponsorshipCommitment[]; holeSlots: Array<{ id: string; holeId: string | null; holeNumber: number | null; locationName: string; label: string; displayLabel: string; unitId: string | null; sponsorshipTypeId: string | null }>; companies: Array<{ id: string; name: string }> }
function HoleAllocationBoard({ data, venueName, companyId, busy, onAllocate, onCreateSlot }: { data: SponsorPayload; venueName: string; companyId: string; busy: boolean; onAllocate: (unitId: string, slotId: string) => Promise<void>; onCreateSlot: (holeId: string, label: string) => Promise<boolean> }) {
  const [selectedNumber, setSelectedNumber] = useState(1);
  const [sponsorSearch, setSponsorSearch] = useState("");
  const guide = /glendower/i.test(venueName) ? glendowerHoleGuide.find((item) => item.number === selectedNumber) : undefined;
  const units = data.commitments.flatMap((commitment) => commitment.units.map((unit) => ({ ...unit, commitment })));
  const hole = data.holes.find((item) => item.number === selectedNumber);
  const slots = data.holeSlots.filter((slot) => slot.holeNumber === selectedNumber);
  const numbers = Array.from({ length: Math.max(18, ...data.holes.map((item) => item.number)) }, (_, index) => index + 1);
  return <section className="hole-allocation-workspace">
    <div className="hole-course"><div className="fourball-list-heading"><strong>Hole allocation</strong><span>Choose a hole</span></div><div className="hole-number-grid">{numbers.map((number) => {
      const positions = data.holeSlots.filter((slot) => slot.holeNumber === number);
      const occupied = positions.filter((slot) => units.some((unit) => unit.holeSlotId === slot.id));
      const matches = occupied.some((slot) => units.some((unit) => unit.holeSlotId === slot.id && unit.commitment.eventCompanyId === companyId));
      return <button key={number} className={matches ? "company-hole" : ""} aria-pressed={selectedNumber === number} onClick={() => setSelectedNumber(number)}><strong>{String(number).padStart(2, "0")}</strong><span>{occupied.length ? `${occupied.length}/${positions.length} placed` : "Open"}</span><span className="hole-company-names">{Array.from(new Set(units.filter((unit) => positions.some((position) => position.id === unit.holeSlotId)).map((unit) => unit.commitment.companyName))).join(" · ")}</span>{matches ? <small>Selected company</small> : null}</button>;
    })}</div></div>
    <div className="panel hole-editor"><p className="eyebrow">Sponsor placement</p><h3>Hole {selectedNumber}</h3><p className="muted-copy">Select a confirmed sponsorship for each position. Moving a sponsorship frees its previous position.</p>
      {guide ? <section className="hole-guide" aria-label="Hole details"><div className="hole-facts"><span>Par <strong>{guide.par}</strong></span><span>Stroke index <strong>{guide.strokeIndex}</strong></span><span>{selectedNumber <= 9 ? "Front nine" : "Back nine"}</span></div><dl className="tee-distances">{["Championship", "Club", "Women’s"].map((label, index) => <div key={label}><dt>{label}</dt><dd>{guide.distances[index]} m</dd></div>)}</dl><details><summary>Proposed activation & setup</summary><strong>{guide.plan}</strong><p>{guide.description}</p><p>{guide.setup}</p><p>Shotgun 10:30 SAST. Plan for up to 8 players and 4 carts together.</p></details><p className="guide-source">Glendower · M2M Invitational guide, 22 September 2026. Reference distances; event tees and setup space to be confirmed. Activation plans are provisional.</p></section> : null}
      {slots.some((slot) => !units.some((unit) => unit.holeSlotId === slot.id)) ? <label className="sponsor-search"><span>Find a sponsorship to place</span><input type="search" value={sponsorSearch} onChange={(change) => setSponsorSearch(change.target.value)} placeholder="Company or sponsorship" /></label> : null}
      {slots.map((slot) => {
        const assigned = units.find((unit) => unit.holeSlotId === slot.id);
        const options = units.filter((unit) => unit.commitment.status === "confirmed" && (!companyId || unit.commitment.eventCompanyId === companyId) && (!slot.sponsorshipTypeId || slot.sponsorshipTypeId === unit.commitment.sponsorshipTypeId));
        return <div className="hole-position" key={slot.id}><strong>{slot.label}</strong>{assigned ? <><h4>{assigned.commitment.companyName}</h4><p>{assigned.commitment.typeName} · unit {assigned.unitNumber}</p><button className="secondary-button" disabled={busy || Boolean(companyId && assigned.commitment.eventCompanyId !== companyId)} onClick={() => onAllocate(assigned.id, "")}>Remove placement</button></> : <div className="placement-options" aria-label={`Sponsors for hole ${selectedNumber}, ${slot.label}`}>
          {options.filter((unit) => `${unit.commitment.companyName} ${unit.commitment.typeName}`.toLowerCase().includes(sponsorSearch.toLowerCase())).map((unit) => <button className="placement-option" key={unit.id} disabled={busy} onClick={() => onAllocate(unit.id, slot.id)}><strong>{unit.commitment.companyName}</strong><span>{unit.commitment.typeName} · #{unit.unitNumber}</span><small>{unit.holeSlotId ? `Move from ${data.holeSlots.find((position) => position.id === unit.holeSlotId)?.displayLabel}` : "Place on this hole"}</small></button>)}
          {!options.length ? <p>No eligible confirmed sponsorships.</p> : !options.some((unit) => `${unit.commitment.companyName} ${unit.commitment.typeName}`.toLowerCase().includes(sponsorSearch.toLowerCase())) ? <p>No matching sponsorships.</p> : null}
        </div>}</div>;
      })}
      {!hole ? <p className="warning-copy">This hole has not been configured for this event.</p> : <details className="action-disclosure"><summary>Add sponsorship position</summary><form className="stack-form" onSubmit={async (submitEvent) => { submitEvent.preventDefault(); const form = submitEvent.currentTarget; if (await onCreateSlot(hole.id, String(new FormData(form).get("label")))) form.reset(); }}><label><span>Position label</span><input name="label" required maxLength={120} placeholder="e.g. Drinks station" /></label><button className="secondary-button" disabled={busy}>Add position to hole {selectedNumber}</button></form></details>}
    </div>
  </section>;
}

function Suppliers({ event, version, onRefresh }: { event: EventRecord; version: number; onRefresh: () => void }) {
  const [data, setData] = useState<SponsorPayload | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [localVersion, setLocalVersion] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  useEffect(() => {
    let active = true;
    opsApi<SponsorPayload>(`/api/v1/admin/sponsorships?eventId=${event.id}&includeCancelled=true`)
      .then((payload) => { if (active) setData(payload); })
      .catch((caught: Error) => { if (active) setError(caught.message); });
    return () => { active = false; };
  }, [event.id, version, localVersion]);
  async function action(body: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try {
      await jsonMutation("/api/v1/admin/sponsorships", "POST", { eventId: event.id, ...body });
      setLocalVersion((value) => value + 1); onRefresh(); setMessage("Supplier changes saved."); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Supplier changes could not be saved."); return false; }
    finally { setBusy(false); }
  }
  async function allocate(unitId: string, holeSlotId: string) {
    await action({ action: holeSlotId ? "allocate" : "unallocate", unitId, ...(holeSlotId ? { holeSlotId } : {}) });
  }
  async function saveContribution(formEvent: FormEvent<HTMLFormElement>, item: SponsorshipCommitment) {
    formEvent.preventDefault(); const form = new FormData(formEvent.currentTarget);
    await action({ action: "updateCommitment", id: item.id, contribution: form.get("contribution"), prizeValueMinor: Math.round(Number(form.get("prizeValue")) * 100), notes: form.get("notes"), status: form.get("status") });
  }
  const suppliers = (data?.commitments || []).filter((item) => (item.category || data?.types.find((type) => type.id === item.sponsorshipTypeId)?.category) === "supplier");
  const prizeSummary = supplierPrizeSummary(suppliers);
  const visible = suppliers.filter((item) => (showCancelled || item.status !== "cancelled") && `${item.companyName} ${item.contribution} ${item.notes} ${item.units.map((unit) => data?.holeSlots.find((slot) => slot.id === unit.holeSlotId)?.displayLabel || "").join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="suppliers-page">
    <SectionHeader eyebrow="Contributions register" title="Suppliers" copy="Keep track of what is being sponsored and who is providing it." actions={<button className="primary-button" disabled={!data || busy} aria-expanded={showAdd} aria-controls="supplier-add" onClick={() => setShowAdd(!showAdd)}>{showAdd ? "Close form" : "+ Add supplier / sponsor"}</button>} />
    <ErrorBanner message={error} />
    {message ? <p className="success-banner" role="status">{message}</p> : null}
    {data ? <>
      <section className="supplier-prize-total" aria-label="Total prize value" aria-live="polite"><span>Total prize value</span><strong>{prizeValueRand(prizeSummary.totalMinor)}</strong><p>All active supplier contributions. Cancelled contributions are excluded.</p>{prizeSummary.unvalued > 0 ? <p>{prizeSummary.unvalued} contribution{prizeSummary.unvalued === 1 ? " still needs" : "s still need"} a value.</p> : null}</section>
      <div id="supplier-add" hidden={!showAdd}>
        <SupplierEntryForm eventId={event.id} data={data} busy={busy} onSave={action} onCompanyAdded={(company) => { setData((current) => current ? { ...current, companies: [...current.companies.filter((item) => item.id !== company.id), company] } : current); onRefresh(); }} />
      </div>
      <section className="panel">
        <header className="supplier-register-heading"><div><h3>Suppliers & sponsors</h3><p className="muted-copy">{suppliers.filter((item) => item.status !== "cancelled").length} active contribution{suppliers.filter((item) => item.status !== "cancelled").length === 1 ? "" : "s"}</p></div><label className="check-inline"><input type="checkbox" checked={showCancelled} onChange={(change) => setShowCancelled(change.target.checked)} />Show cancelled</label></header>
        <label className="company-filter"><span>Find a supplier or contribution</span><input type="search" value={query} onChange={(change) => setQuery(change.target.value)} placeholder="Search names, contributions or locations" /></label>
        {visible.length ? <div className="commitment-list">{visible.map((item) => <article className="commitment-card supplier-record" key={item.id}>
          <header><div><p className="eyebrow">Supplier / sponsor</p><h4>{item.companyName}</h4></div><Pill value={item.status} /></header>
          <div className="supplier-contribution"><span>What they are sponsoring</span><p>{item.contribution || "Contribution details not yet supplied"}</p></div>
          <p className="supplier-prize-value"><strong>Prize value:</strong> {item.prizeValueMinor == null ? "Not entered" : prizeValueRand(item.prizeValueMinor)}</p>
          {item.notes ? <p className="supplier-notes"><strong>Notes:</strong> {item.notes}</p> : null}
          {item.status !== "cancelled" ? <details className="action-disclosure"><summary>Location · {item.units.map((unit) => data.holeSlots.find((slot) => slot.id === unit.holeSlotId)?.displayLabel || "Not assigned").join("; ")}</summary><p className="muted-copy">Optional. Choose a hole or a venue position, or leave this contribution without a location.</p>{item.units.map((unit) => <SponsorshipPlacementCard key={unit.id} unit={unit} item={item} data={data} busy={busy} onAllocate={allocate} />)}</details> : null}
          <details className="action-disclosure"><summary>Edit contribution</summary><form className="stack-form" onSubmit={(formEvent) => saveContribution(formEvent, item)}>
            <label><span>What are they sponsoring?</span><textarea name="contribution" required maxLength={2000} defaultValue={item.contribution} /></label>
            <label><span>Prize value (R)</span><input name="prizeValue" type="number" min="0" max="21474836.47" step="0.01" required defaultValue={item.prizeValueMinor == null ? "" : item.prizeValueMinor / 100} placeholder="e.g. 5000.00" /></label>
            <label><span>Status</span><select name="status" defaultValue={item.status}><option value="draft">Draft</option><option value="reserved">Reserved</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select></label>
            <label><span>Notes</span><textarea name="notes" maxLength={5000} defaultValue={item.notes} /></label>
            <FormActions busy={busy} label="Save contribution" />
          </form></details>
        </article>)}</div> : <Empty title={suppliers.length ? "No matching contributions" : "No suppliers or sponsors yet"} copy={suppliers.length ? "Change your search or show cancelled records." : "Add a supplier or sponsor and describe the products, services or prizes they are providing."} />}
      </section>
      <details className="panel action-disclosure"><summary>Locations (optional)</summary><VenuePositions data={data} companyId="" busy={busy} onSave={action} onAllocate={allocate} /></details>
    </> : <Loading />}
  </div>;
}

function SupplierEntryForm({ eventId, data, busy, onSave, onCompanyAdded }: { eventId: string; data: SponsorPayload; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<boolean>; onCompanyAdded: (company: SponsorPayload["companies"][number]) => void }) {
  const [companyId, setCompanyId] = useState(data.companies.length ? "" : "new");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [createdCompany, setCreatedCompany] = useState<SponsorPayload["companies"][number] | null>(null);
  const companies = createdCompany && !data.companies.some((company) => company.id === createdCompany.id) ? [...data.companies, createdCompany] : data.companies;
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); const element = formEvent.currentTarget; const form = new FormData(element);
    setCreating(true); setError("");
    let selectedId = companyId;
    try {
      if (selectedId === "new") {
        const { company } = await jsonMutation<{ company: EventCompany }>("/api/v1/admin/companies", "POST", { eventId, name: form.get("name"), relationshipStatus: "confirmed", primaryContactName: form.get("primaryContactName"), primaryContactEmail: form.get("primaryContactEmail"), primaryContactPhone: form.get("primaryContactPhone") });
        // Retain the new company after a failed contribution save so retrying cannot duplicate it.
        selectedId = company.id; setCompanyId(company.id); setCreatedCompany(company); onCompanyAdded(company);
      }
      if (await onSave({ action: "createSupplier", eventCompanyId: selectedId, contribution: form.get("contribution"), prizeValueMinor: Math.round(Number(form.get("prizeValue")) * 100), holeSlotId: form.get("holeSlotId") || null })) {
        element.reset(); setCompanyId(""); setCreatedCompany(null);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The supplier could not be added."); }
    finally { setCreating(false); }
  }
  return <section className="panel"><h3>Add supplier / sponsor</h3><ErrorBanner message={error} />
    <form className="stack-form" onSubmit={submit}><fieldset className="supplier-entry-fields" disabled={busy || creating}>
      <label><span>Supplier / sponsor</span><select name="eventCompanyId" required value={companyId} onChange={(change) => setCompanyId(change.target.value)}><option value="">Choose an existing company or add a new one</option><option value="new">+ Add a new supplier / sponsor</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      {companyId === "new" ? <>
        <label><span>Supplier / sponsor name</span><input name="name" required minLength={2} maxLength={180} placeholder="Company or supplier name" /></label>
        <div className="two-fields"><label><span>Contact name (optional)</span><input name="primaryContactName" maxLength={160} /></label><label><span>Contact email (optional)</span><input name="primaryContactEmail" type="email" /></label></div>
        <label><span>Contact phone (optional)</span><input name="primaryContactPhone" type="tel" maxLength={40} /></label><p className="muted-copy">If adding a contact, enter both their name and email.</p>
      </> : null}
      <label><span>What are they sponsoring?</span><textarea name="contribution" required maxLength={2000} placeholder="e.g. 200 bottled waters, competition prizes or catering" /></label>
      <label><span>Prize value (R)</span><input name="prizeValue" type="number" min="0" max="21474836.47" step="0.01" required placeholder="e.g. 5000.00" /></label><p className="muted-copy">Enter the total Rand value of this contribution, including all items or prizes supplied.</p>
      <label><span>Location (optional)</span><select name="holeSlotId" defaultValue=""><option value="">No location / decide later</option>{data.holeSlots.filter((slot) => !slot.unitId && (!slot.sponsorshipTypeId || data.types.some((type) => type.id === slot.sponsorshipTypeId && type.name === "Supplier sponsorship" && type.category === "supplier"))).map((slot) => <option key={slot.id} value={slot.id}>{slot.displayLabel}</option>)}</select></label>
      <p className="muted-copy">Add venue positions such as the putting green in Locations below. Contributions are saved as confirmed with no cash payment due.</p>
      <FormActions busy={busy || creating} label="Save supplier / sponsor" />
    </fieldset></form>
  </section>;
}

function VenuePositions({ data, companyId, busy, onSave, onAllocate }: { data: SponsorPayload; companyId: string; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<boolean>; onAllocate: (unitId: string, slotId: string) => Promise<void> }) {
  const positions = data.holeSlots.filter((slot) => !slot.holeId);
  const units = data.commitments.flatMap((item) => item.units.map((unit) => ({ unit, item })));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const form = new FormData(element);
    if (await onSave({ action: "createVenueSlot", locationName: form.get("locationName"), label: form.get("label") })) element.reset();
  }
  return <section className="panel"><h3>Venue sponsorship positions</h3><p className="muted-copy">Place suppliers and venue sponsors at the putting green, registration, clubhouse or any other event area.</p>
    <details className="action-disclosure"><summary>Add venue position</summary><form className="stack-form" onSubmit={submit}>
      <label><span>Location</span><input name="locationName" required maxLength={120} placeholder="e.g. Putting green" /></label>
      <label><span>Position label</span><input name="label" required maxLength={120} placeholder="e.g. Prize display" /></label>
      <FormActions busy={busy} label="Add venue position" />
    </form></details>
    {positions.map((slot) => {
      const assigned = units.find(({ unit }) => unit.holeSlotId === slot.id);
      const eligible = units.filter(({ item }) => item.status === "confirmed" && !item.requiresHole && (!companyId || item.eventCompanyId === companyId) && (!slot.sponsorshipTypeId || slot.sponsorshipTypeId === item.sponsorshipTypeId));
      return <div className="hole-position" key={slot.id}><strong>{slot.displayLabel}</strong>{assigned ? <>
        <h4>{assigned.item.companyName}</h4><p>{assigned.item.contribution || assigned.item.typeName}</p>
        <button className="secondary-button" disabled={busy || Boolean(companyId && assigned.item.eventCompanyId !== companyId)} onClick={() => onAllocate(assigned.unit.id, "")}>Remove placement</button>
      </> : <div className="placement-options" aria-label={`Sponsors for ${slot.displayLabel}`}>{eligible.map(({ unit, item }) => <button key={unit.id} className="placement-option" disabled={busy} onClick={() => onAllocate(unit.id, slot.id)}><strong>{item.companyName}</strong><span>{item.contribution || item.typeName} · #{unit.unitNumber}</span><small>{unit.holeSlotId ? `Move from ${data.holeSlots.find((position) => position.id === unit.holeSlotId)?.displayLabel}` : "Place here"}</small></button>)}{!eligible.length ? <p>No eligible confirmed sponsorships. Add a supplier or a package that does not require a hole.</p> : null}</div>}</div>;
    })}
  </section>;
}

function SponsorshipPlacementCard({ unit, item, data, busy, onAllocate }: { unit: SponsorshipCommitment["units"][number]; item: SponsorshipCommitment; data: SponsorPayload; busy: boolean; onAllocate: (unitId: string, slotId: string) => Promise<void> }) {
  const [choosing, setChoosing] = useState(false);
  const slot = data.holeSlots.find((position) => position.id === unit.holeSlotId);
  const available = data.holeSlots.filter((position) => (!item.requiresHole || position.holeId) && (!position.unitId || position.unitId === unit.id) && (!position.sponsorshipTypeId || position.sponsorshipTypeId === item.sponsorshipTypeId));
  return <div className="sponsorship-placement"><div className="placement-summary"><div><strong>{slot ? (slot.holeNumber ? `Hole ${String(slot.holeNumber).padStart(2, "0")}` : slot.locationName) : "Unallocated"}</strong><p>Unit {unit.unitNumber}{slot ? ` · ${slot.label}` : ""}</p></div><button className="secondary-button" disabled={busy || item.status !== "confirmed"} aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>{choosing ? "Close" : slot ? "Change location" : "Choose location"}</button></div>{choosing ? <div className="placement-hole-options">{available.map((position) => <button key={position.id} disabled={busy} aria-pressed={position.id === unit.holeSlotId} onClick={() => onAllocate(unit.id, position.id)}><strong>{position.holeNumber ? `Hole ${position.holeNumber}` : position.locationName}</strong><span>{position.label}</span></button>)}{slot ? <button disabled={busy} onClick={() => onAllocate(unit.id, "")}>Remove placement</button> : null}{!available.length ? <p>No available positions for this sponsorship.</p> : null}</div> : null}{item.status !== "confirmed" ? <p>Confirm this sponsorship to assign a location.</p> : null}</div>;
}

function SponsorshipInventoryCard({ type, used, currency, busy, onSave }: { type: SponsorshipType; used: number; currency: string; busy: boolean; onSave: (capacity: number) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(type.capacity));
  const [feedback, setFeedback] = useState("");
  async function save(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault(); setFeedback("");
    if (await onSave(Number(quantity))) { setEditing(false); setFeedback("Quantity saved."); }
    else setFeedback("Quantity could not be saved. Check the error above and try again.");
  }
  return <article className="inventory-card sponsor-inventory-card">
    <span>{type.category.replaceAll("_", " ")}</span><h3>{type.name}</h3>
    <strong>{used}<small> / {type.capacity}</small></strong><span className="inventory-count-label">Reserved or confirmed / total quantity</span>
    <p>{money(type.priceMinor, currency)} · {type.requiresHole ? "Hole allocation" : "No hole required"}</p>
    <div className="capacity-bar"><i style={{ width: `${type.capacity ? Math.min(100, (used / type.capacity) * 100) : 0}%` }} /></div>
    {editing ? <form className="inventory-quantity-form" onSubmit={save}>
      <label><span>Total quantity</span><input aria-label={`${type.name} total quantity`} type="number" min={used} max="999" step="1" required value={quantity} disabled={busy} onChange={(change) => setQuantity(change.target.value)} aria-describedby={`capacity-help-${type.id}`} /></label>
      <p id={`capacity-help-${type.id}`}>{used} already reserved or confirmed. Total quantity cannot be lower than this.</p>
      <div><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save quantity"}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => { setEditing(false); setFeedback(""); }}>Cancel</button></div>
    </form> : <button className="secondary-button inventory-edit-button" disabled={busy} onClick={() => { setQuantity(String(type.capacity)); setFeedback(""); setEditing(true); }}>Edit quantity</button>}
    {feedback ? <p className="inventory-feedback" role="status">{feedback}</p> : null}
  </article>;
}

function Sponsorships({ event, version, onRefresh, companyId = "" }: { companyId?: string; event: EventRecord; version: number; onRefresh: () => void }) {
  const [data, setData] = useState<SponsorPayload | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [localVersion, setLocalVersion] = useState(0);
  const [companyFilter, setCompanyFilter] = useState(companyId);
  const [showInventory, setShowInventory] = useState(false);
  const [message, setMessage] = useState("");
  const commitments = (data?.commitments || []).filter((item) => (companyId || (item.category || data?.types.find((type) => type.id === item.sponsorshipTypeId)?.category) !== "supplier") && (!companyFilter || item.eventCompanyId === companyFilter) && (!companyId || item.status !== "cancelled"));
  useEffect(() => { let active = true; opsApi<SponsorPayload>(`/api/v1/admin/sponsorships?eventId=${event.id}${companyId ? "&includeCancelled=true" : ""}`).then((payload) => { if (active) setData(payload); }).catch((caught: Error) => { if (active) setError(caught.message); }); return () => { active = false; }; }, [event.id, version, localVersion, companyId]);
  async function action(body: Record<string, unknown>) { setBusy(true); setError(""); setMessage(""); try { await jsonMutation("/api/v1/admin/sponsorships", "POST", { eventId: event.id, ...body }); setLocalVersion((v) => v + 1); onRefresh(); setMessage("Sponsorship changes saved."); return true; } catch (caught) { setError(caught instanceof Error ? caught.message : "Sponsorship update failed."); return false; } finally { setBusy(false); } }
  async function addType(formEvent: FormEvent<HTMLFormElement>) { formEvent.preventDefault(); const formElement = formEvent.currentTarget; const form = new FormData(formElement); const saved = await action({ action: "createType", name: form.get("name"), category: form.get("category"), capacity: Number(form.get("capacity")), priceMinor: Math.round(Number(form.get("price")) * 100), requiresHole: form.get("requiresHole") === "on", isActive: true }); if (saved) formElement.reset(); }
  async function addCommitment(formEvent: FormEvent<HTMLFormElement>) { formEvent.preventDefault(); const formElement = formEvent.currentTarget; const form = new FormData(formElement); const saved = await action({ action: "createCommitment", eventCompanyId: form.get("eventCompanyId"), sponsorshipTypeId: form.get("sponsorshipTypeId"), status: form.get("status"), quantity: Number(form.get("quantity")), confirmedAmountMinor: Math.round(Number(form.get("amount")) * 100), paymentStatus: form.get("paymentStatus"), invoiceReference: form.get("invoiceReference"), contribution: form.get("contribution") }); if (saved) formElement.reset(); }
  async function saveCommitment(formEvent: FormEvent<HTMLFormElement>, item: SponsorshipCommitment) { formEvent.preventDefault(); const form = new FormData(formEvent.currentTarget); await action({ action: "updateCommitment", id: item.id, status: form.get("status"), quantity: Number(form.get("quantity")), confirmedAmountMinor: Math.round(Number(form.get("amount")) * 100), paymentStatus: form.get("paymentStatus"), invoiceReference: form.get("invoiceReference"), notes: form.get("notes"), contribution: form.get("contribution") }); }
  async function allocate(unitId: string, holeSlotId: string) { await action({ action: holeSlotId ? "allocate" : "unallocate", unitId, ...(holeSlotId ? { holeSlotId } : {}) }); }
  const usedByType = useMemo(() => new Map((data?.types || []).map((type) => [type.id, (data?.commitments || []).filter((c) => c.sponsorshipTypeId === type.id && ["reserved", "confirmed"].includes(c.status)).reduce((sum, c) => sum + c.quantity, 0)])), [data]);
  return <>
    <SectionHeader eyebrow="Sponsor operations" title="Sponsorships & locations" copy="Record what companies are sponsoring and place them on a hole or elsewhere at the venue." actions={!companyId ? <button className="secondary-button" aria-expanded={showInventory} onClick={() => setShowInventory(!showInventory)}>{showInventory ? "Hide packages" : "Packages & bookings"}</button> : null} />
    <ErrorBanner message={error} />
    {message ? <p className="success-banner" role="status">{message}</p> : null}
    {!companyId ? <label className="company-filter"><span>Company</span><select value={companyFilter} onChange={(change) => setCompanyFilter(change.target.value)}><option value="">All companies</option>{data?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label> : null}
    {!companyId ? data ? <HoleAllocationBoard venueName={event.venueName} data={data} companyId={companyFilter} busy={busy} onAllocate={allocate} onCreateSlot={(holeId, label) => action({ action: "createHoleSlot", holeId, label })} /> : <Loading /> : null}
    {data ? <>
      <VenuePositions data={data} companyId={companyId || companyFilter} busy={busy} onSave={action} onAllocate={allocate} />
    </> : null}
    <div hidden={!showInventory} className="sponsor-setup">
    {data ? <div className="inventory-grid">{data.types.filter((type) => type.category !== "supplier").map((type) => <SponsorshipInventoryCard key={type.id} type={type} used={usedByType.get(type.id) || 0} currency={event.currency} busy={busy} onSave={(capacity) => action({ action: "updateType", id: type.id, capacity })} />)}</div> : <Loading />}
    <div className="split-panels">
      <section className="panel"><details className="action-disclosure"><summary>Configure sponsorship type</summary><form className="stack-form" onSubmit={addType}><label><span>Name</span><input name="name" required /></label><label><span>Category</span><select name="category"><option value="alcoholic_hole">Alcoholic hole</option><option value="non_alcoholic_hole">Non-alcoholic hole</option><option value="branded_hole">Branded hole</option><option value="other">Other / venue sponsorship</option></select></label><div className="two-fields"><label><span>Capacity</span><input type="number" name="capacity" min="0" required /></label><label><span>Price ({event.currency})</span><input type="number" name="price" min="0" required /></label></div><label className="check-inline"><input type="checkbox" name="requiresHole" />Requires hole allocation</label><FormActions busy={busy} label="Add type" /></form></details></section>
      <section className="panel"><details className="action-disclosure"><summary>Confirm sponsorship</summary><form className="stack-form" onSubmit={addCommitment}><label><span>Company</span><select name="eventCompanyId" defaultValue={companyId} required><option value="">Select company</option>{data?.companies.filter((c) => !companyId || c.id === companyId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><span>Inventory type</span><select name="sponsorshipTypeId" required><option value="">Select type</option>{data?.types.filter((type) => type.category !== "supplier").map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><div className="two-fields"><label><span>Status</span><select name="status" defaultValue="confirmed"><option value="draft">Draft</option><option value="reserved">Reserved</option><option value="confirmed">Confirmed</option></select></label><label><span>Quantity</span><input type="number" name="quantity" min="1" defaultValue="1" required /></label></div><label><span>Confirmed amount ({event.currency})</span><input type="number" name="amount" min="0" step="0.01" required /></label><label><span>Payment</span><select name="paymentStatus"><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="waived">Waived</option></select></label><label><span>Invoice reference</span><input name="invoiceReference" /></label><label><span>What are they sponsoring?</span><textarea name="contribution" maxLength={2000} placeholder="Describe the contribution (required for suppliers)" /></label><FormActions busy={busy} label="Add sponsorship" /></form></details></section>
    </div>
    </div>
    <section className="panel"><h3>Company sponsorships</h3>{data && commitments.length ? <div className="commitment-list">{commitments.map((item) => <article className="commitment-card" key={item.id}><header><div><h4>{item.companyName}</h4><p>{sponsorshipCategoryLabel(item.category || data.types.find((type) => type.id === item.sponsorshipTypeId)?.category)} · {item.typeName} · {item.quantity} unit{item.quantity === 1 ? "" : "s"}</p></div><div className="pill-row"><Pill value={item.status} /><Pill value={item.paymentStatus} /></div></header><div className="unit-list">{item.contribution ? <p><strong>Supplying:</strong> {item.contribution}</p> : null}{item.units.map((unit) => <SponsorshipPlacementCard key={unit.id} unit={unit} item={item} data={data} busy={busy} onAllocate={allocate} />)}</div><details className="action-disclosure"><summary>Edit contribution, quantity and payment</summary><form className="form-grid compact" onSubmit={(submitEvent) => saveCommitment(submitEvent, item)}><label><span>Status</span><select name="status" defaultValue={item.status}><option value="draft">Draft</option><option value="reserved">Reserved</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select></label><label><span>Quantity</span><input type="number" name="quantity" min="1" max="99" defaultValue={item.quantity} required /></label><label><span>Confirmed amount ({event.currency})</span><input type="number" name="amount" min="0" step="0.01" defaultValue={item.confirmedAmountMinor / 100} required /></label><label><span>Payment status</span><select name="paymentStatus" defaultValue={item.paymentStatus}><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="waived">Waived</option></select></label><label><span>Invoice reference</span><input name="invoiceReference" defaultValue={item.invoiceReference} /></label><label className="span-2"><span>What are they sponsoring?</span><textarea name="contribution" maxLength={2000} defaultValue={item.contribution} required={item.category === "supplier"} placeholder="e.g. 200 bottled waters, prizes or catering" /></label><label className="span-2"><span>Notes</span><textarea name="notes" defaultValue={item.notes} /></label><FormActions busy={busy} label="Save sponsorship" /></form></details></article>)}</div> : <Empty title="No sponsorship commitments" copy="Add a company and confirm its first sponsorship." />}</section>
  </>;
}

interface FourballsPayload { ok: true; fourballs: FourballRecord[]; teeSlots: Array<{ id: string; label: string; fourballId: string | null }>; profiles: Array<{ id: string; email: string; fullName: string; role: string }> }
interface FourballType { id: string; eventId: string; name: string; capacity: number; priceMinor: number; isActive: boolean; booked: number }
function useFourballs(eventId: string, version: number, includeCancelled = false) {
  const [data, setData] = useState<FourballsPayload | null>(null); const [error, setError] = useState("");
  useEffect(() => { let active = true; opsApi<FourballsPayload>(`/api/v1/admin/fourballs?eventId=${eventId}${includeCancelled ? "&includeCancelled=true" : ""}`).then((payload) => { if (active) { setData(payload); setError(""); } }).catch((caught: Error) => { if (active) setError(caught.message); }); return () => { active = false; }; }, [eventId, version, includeCancelled]);
  return { data, error };
}

function Fourballs({ event, version, onRefresh, companyId = "", initialTeamId = "", onDirtyChange }: { initialTeamId?: string; onDirtyChange?: (dirty: boolean) => void; companyId?: string; event: EventRecord; version: number; onRefresh: () => void }) {
  const [localVersion, setLocalVersion] = useState(0); const loaded = useFourballs(event.id, version + localVersion); const [companies, setCompanies] = useState<EventCompany[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [types, setTypes] = useState<FourballType[]>([]); const [selectedTypeId, setSelectedTypeId] = useState(""); const [quantity, setQuantity] = useState(1); const [bookingAmount, setBookingAmount] = useState(0);
  const [companyFilter, setCompanyFilter] = useState(companyId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(initialTeamId);
  const [playerPosition, setPlayerPosition] = useState(1);
  const [pageView, setPageView] = useState("teams");
  const [editorView, setEditorView] = useState("players");
  const [showTeamList, setShowTeamList] = useState(false);
  const [dirtyForms, setDirtyForms] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => { onDirtyChange?.(dirtyForms.length > 0); }, [dirtyForms.length, onDirtyChange]);
  const fourballs = (loaded.data?.fourballs || []).filter((team) => !companyFilter || team.eventCompanyId === companyFilter);
  const visibleFourballs = fourballs.filter((team) => {
    const matches = `${team.teamName} ${team.companyName} ${team.hosts.map((host) => `${host.fullName} ${host.email}`).join(" ")} ${team.players.map((player) => player.fullName).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
    return matches && (filter === "all" || (filter === "no-host" && team.bookingStatus !== "cancelled" && !team.hosts.length) || (filter === "no-start" && team.bookingStatus === "confirmed" && !team.teeSlot) || (filter === "outstanding" && team.bookingStatus !== "cancelled" && team.submissionStatus !== "submitted"));
  });
  const selected = fourballs.find((team) => team.id === selectedId) || visibleFourballs[0];
  function selectTeam(id: string) {
    if (id === selected?.id) { setShowTeamList(false); return; }
    if (dirtyForms.length && !window.confirm("Discard unsaved changes to this fourball?")) return;
    setDirtyForms([]); setSelectedId(id); setPlayerPosition(1); setNotice(""); setShowTeamList(false);
  }
  useEffect(() => { let active = true; Promise.all([opsApi<CompaniesPayload>(`/api/v1/admin/companies?eventId=${event.id}`), opsApi<{ ok: true; types: FourballType[] }>(`/api/v1/admin/fourball-types?eventId=${event.id}`)]).then(([companyData, typeData]) => { if (active) { setCompanies(companyData.companies); setTypes(typeData.types); } }).catch((caught: Error) => { if (active) setError(caught.message); }); return () => { active = false; }; }, [event.id, version, localVersion]);
  function changed() { setLocalVersion((v) => v + 1); onRefresh(); }
  async function action(body: Record<string, unknown>, savedForm?: string) { setBusy(true); setError(""); try { await jsonMutation("/api/v1/admin/fourballs", "PATCH", { eventId: event.id, ...body }); if (savedForm) setDirtyForms((forms) => forms.filter((id) => id !== savedForm)); setNotice("Changes saved."); changed(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Fourball update failed."); } finally { setBusy(false); } }
  async function add(formEvent: FormEvent<HTMLFormElement>) { formEvent.preventDefault(); setBusy(true); setError(""); const formElement = formEvent.currentTarget; const form = new FormData(formElement); try { await jsonMutation("/api/v1/admin/fourballs", "POST", { eventId: event.id, eventCompanyId: form.get("eventCompanyId"), fourballTypeId: form.get("fourballTypeId"), quantity: Number(form.get("quantity")), teamNamePrefix: form.get("teamNamePrefix"), bookingStatus: form.get("bookingStatus"), confirmedAmountMinor: Math.round(Number(form.get("amount")) * 100), paymentStatus: form.get("paymentStatus") }); formElement.reset(); setSelectedTypeId(""); setQuantity(1); setBookingAmount(0); changed(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Fourball creation failed."); } finally { setBusy(false); } }
  async function addType(formEvent: FormEvent<HTMLFormElement>) { formEvent.preventDefault(); setBusy(true); setError(""); const formElement = formEvent.currentTarget; const form = new FormData(formElement); try { await jsonMutation("/api/v1/admin/fourball-types", "POST", { eventId: event.id, name: form.get("name"), capacity: Number(form.get("capacity")), priceMinor: Math.round(Number(form.get("price")) * 100), isActive: true }); formElement.reset(); changed(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Fourball type creation failed."); } finally { setBusy(false); } }
  async function saveType(formEvent: FormEvent<HTMLFormElement>, type: FourballType) { formEvent.preventDefault(); setBusy(true); setError(""); const form = new FormData(formEvent.currentTarget); try { await jsonMutation("/api/v1/admin/fourball-types", "PATCH", { id: type.id, eventId: event.id, name: form.get("name"), capacity: Number(form.get("capacity")), priceMinor: Math.round(Number(form.get("price")) * 100), isActive: form.get("isActive") === "on" }); changed(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Fourball type update failed."); } finally { setBusy(false); } }
  async function savePlayer(formEvent: FormEvent<HTMLFormElement>, fourballId: string, playerId: string) { formEvent.preventDefault(); const form = new FormData(formEvent.currentTarget); await action({ action: "savePlayer", id: playerId, fourballId, ...Object.fromEntries(form.entries()) }, playerId); }
  return <div className="fourball-page">
    <SectionHeader eyebrow="Team management" title="Fourballs" copy="Choose a team and enter its players." actions={!companyId ? <button className="primary-button" aria-pressed={pageView === "new"} onClick={() => setPageView(pageView === "new" ? "teams" : "new")}>{pageView === "new" ? "Back to teams" : "+ Add fourballs"}</button> : null} />
    {!companyId ? <div className="fourball-view-switch" aria-label="Fourball workspace views">{[["teams", "Teams & players"], ["new", "New booking"], ["packages", "Manage packages"]].map(([value, label]) => <button key={value} aria-pressed={pageView === value} onClick={() => setPageView(value)}>{label}</button>)}</div> : null}
    <ErrorBanner message={error || loaded.error} />

    <div className="fourball-view-panel" hidden={pageView !== "packages"}>
    <div className="inventory-grid">
      {types.map((type) => <form className="inventory-card" key={type.id} onSubmit={(event) => saveType(event, type)}>
        <span>{type.isActive ? "Available package" : "Inactive package"}</span>
        <input name="name" defaultValue={type.name} aria-label="Fourball type name" required />
        <strong>{type.booked}<small> / {type.capacity} booked</small></strong>
        <div className="two-fields"><label><span>Capacity</span><input type="number" name="capacity" min={type.booked} defaultValue={type.capacity} required /></label><label><span>Price ({event.currency})</span><input type="number" name="price" min="0" step="0.01" defaultValue={type.priceMinor / 100} required /></label></div>
        <label className="check-inline"><input type="checkbox" name="isActive" defaultChecked={type.isActive} />Active</label>
        <button className="secondary-button" disabled={busy}>Save type</button>
      </form>)}
    </div>
    <div>
      <section className="panel"><details className="action-disclosure" open={types.length === 0}><summary>Configure fourball type</summary><form className="stack-form" onSubmit={addType}><label><span>Type name</span><input name="name" placeholder="Fourball only" required /></label><div className="two-fields"><label><span>Available quantity</span><input type="number" name="capacity" min="0" defaultValue="20" required /></label><label><span>Default price ({event.currency})</span><input type="number" name="price" min="0" step="0.01" required /></label></div><FormActions busy={busy} label="Add fourball type" /></form></details></section>

    </div>
    </div>
    <div className="fourball-view-panel" hidden={pageView !== "new"}>      <section className="panel fourball-new-booking"><h3>Add client fourballs</h3><p className="muted-copy">Choose a company and package to create its teams.</p><form className="form-grid" onSubmit={add}>
        <label><span>Client / company</span><select name="eventCompanyId" defaultValue={companyId} required><option value="">Select a client</option>{companies.filter((company) => company.relationshipStatus !== "cancelled" && (!companyId || company.id === companyId)).map((company) => <option key={company.id} value={company.id}>{company.name} · {company.relationshipStatus}</option>)}</select></label>
        <label><span>Fourball type</span><select name="fourballTypeId" value={selectedTypeId} onChange={(change) => { const id = change.target.value; const selected = types.find((type) => type.id === id); setSelectedTypeId(id); setBookingAmount(((selected?.priceMinor || 0) * quantity) / 100); }} required><option value="">Select a type</option>{types.filter((type) => type.isActive && type.booked < type.capacity).map((type) => <option key={type.id} value={type.id}>{type.name} · {type.capacity - type.booked} available · {money(type.priceMinor, event.currency)}</option>)}</select></label>
        <div className="two-fields"><label><span>Quantity</span><input type="number" name="quantity" min="1" max={Math.max(1, (types.find((type) => type.id === selectedTypeId)?.capacity || 1) - (types.find((type) => type.id === selectedTypeId)?.booked || 0))} value={quantity} onChange={(change) => { const next = Number(change.target.value); setQuantity(next); setBookingAmount(((types.find((type) => type.id === selectedTypeId)?.priceMinor || 0) * next) / 100); }} required /></label><label><span>Adjusted total value ({event.currency})</span><input type="number" name="amount" min="0" step="0.01" value={bookingAmount} onChange={(change) => setBookingAmount(Number(change.target.value))} required /></label></div>
        <label><span>Team name prefix</span><input name="teamNamePrefix" placeholder="Client name – Team" required /></label>
        <div className="two-fields"><label><span>Booking status</span><select name="bookingStatus" defaultValue="confirmed"><option value="pending">Pending</option><option value="confirmed">Confirmed</option></select></label><label><span>Payment</span><select name="paymentStatus"><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="waived">Waived</option></select></label></div>
        <FormActions busy={busy} label="Create fourballs" />
      </form></section></div>
    <div className="fourball-view-panel" hidden={pageView !== "teams"}>

      <div className="fourball-toolbar">    {!companyId ? <label className="company-filter"><span>Company</span><select value={companyFilter} onChange={(change) => { if (dirtyForms.length && !window.confirm("Discard unsaved changes to this fourball?")) return; setDirtyForms([]); setSelectedId(""); setPlayerPosition(1); setCompanyFilter(change.target.value); }}><option value="">All companies</option>{companies.filter((company) => company.relationshipStatus !== "cancelled").map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label> : null}
        <label className="fourball-search"><span>Find a fourball</span><input type="search" placeholder="Search team, company, host or player…" value={query} onChange={(change) => { if (!selectedId && selected) setSelectedId(selected.id); setQuery(change.target.value); }} /></label>
        <div className="fourball-filters" aria-label="Filter fourballs">{[["all", "All teams"], ["no-host", "No host"], ["no-start", "No start"], ["outstanding", "Not submitted"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => { if (!selectedId && selected) setSelectedId(selected.id); setFilter(value); }}>{label}</button>)}</div>
      </div>
    {!loaded.data ? <Loading /> : fourballs.length === 0 ? <Empty title="No client fourballs" copy="Choose Add fourballs to create your first teams." /> : <>

      <button className="secondary-button mobile-team-toggle" aria-expanded={showTeamList} onClick={() => setShowTeamList(!showTeamList)}>{showTeamList ? "Close team list" : "Choose another team"} · {visibleFourballs.length} teams</button>
      <div className={`fourball-workspace ${showTeamList ? "show-team-list" : ""}`}>
        <section className="fourball-browser" aria-label="Fourball list">
          <div className="fourball-list-heading"><strong>Teams</strong><span aria-live="polite">{visibleFourballs.length} of {fourballs.length}</span></div>
          <div className="fourball-results">{visibleFourballs.length ? visibleFourballs.map((team) => <button key={team.id} className="fourball-row" aria-pressed={selected?.id === team.id} disabled={busy} onClick={() => selectTeam(team.id)}>
            <span className="fourball-row-title">{team.teamName}<span aria-hidden="true">→</span></span>
            <span className="fourball-row-company">{team.companyName}</span>
            <span className="fourball-row-meta"><Pill value={team.bookingStatus} /><span>{team.players.filter((player) => player.fullName.trim()).length}/4 named</span><span>{team.teeSlot?.label || "No start"}</span></span>
            <span className="fourball-row-host">{team.hosts.length ? team.hosts.map((host) => host.fullName || host.email).join(", ") : "Host needed"}</span>
          </button>) : <div className="fourball-no-results"><strong>No matching teams</strong><p>Try another name or clear the filters.</p><button className="secondary-button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button></div>}</div>
        </section>
        <div className="fourball-detail">{selected ? [selected].map((fourball) => <article key={fourball.id} className="fourball-card" onChangeCapture={(change) => { const form = (change.target as HTMLElement).closest("form"); if (form?.id) setDirtyForms((forms) => forms.includes(form.id) ? forms : [...forms, form.id]); }}>
      <div className="fourball-editor-heading"><span>Editing fourball</span><span role="status">{dirtyForms.length ? "Unsaved changes" : notice}</span></div>
      <header><div><div className="pill-row"><Pill value={fourball.bookingStatus} /><Pill value={fourball.submissionStatus} /></div><h3>{fourball.teamName}</h3><p>{fourball.companyName} · {fourball.fourballTypeName}</p><small>{money(fourball.confirmedAmountMinor, event.currency)} confirmed · list {money(fourball.unitPriceMinor, event.currency)}</small></div><strong>{fourball.teeSlot?.label || "Start unassigned"}</strong></header>
      <div className="fourball-editor-switch" aria-label="Team editor views"><button aria-pressed={editorView === "players"} onClick={() => setEditorView("players")}>Players <span>{fourball.players.filter((player) => player.fullName.trim()).length}/4</span></button><button aria-pressed={editorView === "booking"} onClick={() => setEditorView("booking")}>Booking & host</button></div>
      <div className="fourball-editor-panel" hidden={editorView !== "booking"}>      <div className="fourball-controls"><label><span>Booking</span><select value={fourball.bookingStatus} disabled={busy} onChange={(change) => action({ action: "update", id: fourball.id, bookingStatus: change.target.value })}><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select></label><label><span>Shotgun start</span><select value={fourball.teeSlot?.id || ""} disabled={busy || fourball.bookingStatus !== "confirmed"} onChange={(change) => action({ action: change.target.value ? "assignTee" : "clearTee", id: fourball.id, teeSlotId: change.target.value || undefined })}><option value="">Unassigned</option>{loaded.data!.teeSlots.filter((slot) => !slot.fourballId || slot.fourballId === fourball.id).map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}</select></label><label><span>Assign existing host</span><select defaultValue="" disabled={busy} onChange={(change) => { if (change.target.value) action({ action: "assignHost", id: fourball.id, profileId: change.target.value, isPrimary: fourball.hosts.length === 0 }); change.target.value = ""; }}><option value="">Select account</option>{loaded.data!.profiles.filter((profile) => !fourball.hosts.some((host) => host.profileId === profile.id)).map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName} · {profile.email}{profile.role !== "host" ? ` · ${profile.role}` : ""}</option>)}</select></label>{fourball.submissionStatus === "submitted" ? <button className="secondary-button" disabled={busy} onClick={() => action({ action: "reopen", id: fourball.id })}>Reopen submission</button> : null}</div>
      <div className="host-chips">{fourball.hosts.map((host) => <span key={host.id}>{host.isPrimary ? "Primary · " : ""}{host.fullName || host.email}<button aria-label={`Remove ${host.fullName}`} onClick={() => action({ action: "removeHost", id: fourball.id, profileId: host.profileId })}>×</button></span>)}</div>
      <section className="fourball-team-editor"><h4>Team details</h4><form id="fourball-team-form" className="inline-form" onSubmit={(submitEvent) => { submitEvent.preventDefault(); const form = new FormData(submitEvent.currentTarget); action({ action: "update", id: fourball.id, teamName: form.get("teamName"), confirmedAmountMinor: Math.round(Number(form.get("amount")) * 100), paymentStatus: form.get("paymentStatus") }, "fourball-team-form"); }}><label><span>Team name</span><input name="teamName" defaultValue={fourball.teamName} required /></label><label><span>Value ({event.currency})</span><input type="number" name="amount" min="0" step="0.01" defaultValue={fourball.confirmedAmountMinor / 100} required /></label><select aria-label="Payment status" name="paymentStatus" defaultValue={fourball.paymentStatus}><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="waived">Waived</option></select><button className="secondary-button" disabled={busy}>Save team</button></form></section></div><section className="fourball-editor-panel fourball-player-section" hidden={editorView !== "players"}><div className="fourball-player-tabs" aria-label="Choose player">{fourball.players.map((player) => <button key={player.id} type="button" aria-pressed={playerPosition === player.position} onClick={() => setPlayerPosition(player.position)}><span>Player {player.position}</span><strong>{player.fullName || "Add player"}</strong></button>)}</div><div className="player-editor-grid">{fourball.players.map((player) => <form key={player.id} id={player.id} hidden={playerPosition !== player.position} className="player-editor" onSubmit={(submitEvent) => savePlayer(submitEvent, fourball.id, player.id)}><h4>Player {player.position}</h4><PlayerInputs event={event} player={player} /><button className="secondary-button" disabled={busy}>Save player</button></form>)}</div></section>
    </article>) : <Empty title="Select a team" copy="Choose a fourball from the list to edit its details." />}</div></div></>}
    </div>
  </div>;
}

function TeeSheet({ event, version, onRefresh }: { event: EventRecord; version: number; onRefresh: () => void }) {
  const [localVersion, setLocalVersion] = useState(0); const loaded = useFourballs(event.id, version + localVersion); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function assign(slotId: string, fourballId: string) { setBusy(true); setError(""); try { if (fourballId) await jsonMutation("/api/v1/admin/fourballs", "PATCH", { action: "assignTee", eventId: event.id, id: fourballId, teeSlotId: slotId }); else { const existing = loaded.data?.teeSlots.find((slot) => slot.id === slotId)?.fourballId; if (existing) await jsonMutation("/api/v1/admin/fourballs", "PATCH", { action: "clearTee", eventId: event.id, id: existing }); } setLocalVersion((v) => v + 1); onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Tee assignment failed."); } finally { setBusy(false); } }
  const available = loaded.data?.fourballs.filter((f) => f.bookingStatus === "confirmed") || [];
  return <><SectionHeader eyebrow="Shotgun operations" title="Tee sheet" copy="Every start position is exclusive; moving a fourball automatically clears its previous slot." /><ErrorBanner message={error || loaded.error} />{!loaded.data ? <Loading /> : <div className="tee-grid">{loaded.data!.teeSlots.map((slot) => { const assigned = loaded.data?.fourballs.find((f) => f.id === slot.fourballId); return <article className={assigned ? "tee-card assigned" : "tee-card"} key={slot.id}><span>{slot.label}</span><strong>{assigned?.teamName || "Open start"}</strong><small>{assigned?.companyName || "Available"}</small><select value={assigned?.id || ""} disabled={busy} onChange={(e) => assign(slot.id, e.target.value)}><option value="">Unassigned</option>{available.filter((f) => !f.teeSlot || f.id === assigned?.id).map((f) => <option key={f.id} value={f.id}>{f.teamName}</option>)}</select></article>; })}</div>}</>;
}

function Hosts({ event, version, onRefresh }: { event: EventRecord; version: number; onRefresh: () => void }) {
  const [localVersion, setLocalVersion] = useState(0); const loaded = useFourballs(event.id, version + localVersion); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function invite(formEvent: FormEvent<HTMLFormElement>) { formEvent.preventDefault(); setBusy(true); setError(""); const formElement = formEvent.currentTarget; const form = new FormData(formElement); try { await jsonMutation("/api/v1/admin/users", "POST", { action: "invite", email: form.get("email"), fullName: form.get("fullName"), temporaryPassword: form.get("temporaryPassword"), role: "host", eventId: event.id, fourballId: form.get("fourballId"), isPrimary: form.get("isPrimary") === "on" }); formElement.reset(); setLocalVersion((v) => v + 1); onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Account creation failed."); } finally { setBusy(false); } }
  async function assign(fourballId: string, profileId: string, isPrimary: boolean) { if (!profileId) return; setBusy(true); setError(""); try { await jsonMutation("/api/v1/admin/fourballs", "PATCH", { action: "assignHost", eventId: event.id, id: fourballId, profileId, isPrimary }); setLocalVersion((v) => v + 1); onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Host assignment failed."); } finally { setBusy(false); } }
  async function remove(fourballId: string, profileId: string, name: string) { if (!window.confirm(`Remove ${name} from this fourball?`)) return; setBusy(true); setError(""); try { await jsonMutation("/api/v1/admin/fourballs", "PATCH", { action: "removeHost", eventId: event.id, id: fourballId, profileId }); setLocalVersion((v) => v + 1); onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Host removal failed."); } finally { setBusy(false); } }
  async function remind(fourballId: string, profileId: string) { setBusy(true); setError(""); try { await jsonMutation("/api/v1/admin/reminders", "POST", { eventId: event.id, fourballId, profileId }); setLocalVersion((v) => v + 1); } catch (caught) { setError(caught instanceof Error ? caught.message : "Reminder failed."); } finally { setBusy(false); } }
  const assignments = loaded.data?.fourballs.flatMap((fourball) => fourball.hosts.map((host) => ({ ...host, fourball }))) || [];
  const fourballs = loaded.data?.fourballs.filter((fourball) => fourball.bookingStatus !== "cancelled") || [];
  return <>
    <SectionHeader eyebrow="Host accountability" title="Accounts and assignments" copy="Give every fourball its own primary host, add co-hosts, or reassign an existing account between a company's teams." />
    <ErrorBanner message={error || loaded.error} />
    <section className="panel"><details className="action-disclosure"><summary>Create and assign a new host</summary><form className="inline-form" onSubmit={invite}><input name="fullName" placeholder="Host full name" required /><input type="email" name="email" placeholder="Email / username" required /><input type="password" name="temporaryPassword" minLength={12} placeholder="Temporary password" autoComplete="new-password" required /><select name="fourballId" required><option value="">Assign fourball</option>{fourballs.map((fourball) => <option key={fourball.id} value={fourball.id}>{fourball.companyName} · {fourball.teamName}</option>)}</select><label className="check-inline"><input type="checkbox" name="isPrimary" defaultChecked />Primary host</label><button className="secondary-button" disabled={busy}>Create account</button></form></details></section>
    {!loaded.data ? <Loading /> : fourballs.length === 0 ? <Empty title="No fourballs available" copy="Create or confirm a fourball before assigning its host." /> : <div className="host-assignment-grid">{fourballs.map((fourball) => { const primary = fourball.hosts.find((host) => host.isPrimary); const available = loaded.data!.profiles.filter((profile) => !fourball.hosts.some((host) => host.profileId === profile.id)); return <article className="panel host-assignment-card" key={fourball.id}><header><div><Pill value={fourball.submissionStatus} /><h3>{fourball.teamName}</h3><p>{fourball.companyName}</p></div><strong>{fourball.hosts.length} host{fourball.hosts.length === 1 ? "" : "s"}</strong></header><div className="two-fields"><label><span>Primary host</span><select value={primary?.profileId || ""} disabled={busy} onChange={(change) => assign(fourball.id, change.target.value, true)}><option value="">Select primary host</option>{loaded.data!.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName} · {profile.email}</option>)}</select></label><label><span>Add co-host</span><select value="" disabled={busy || available.length === 0} onChange={(change) => assign(fourball.id, change.target.value, false)}><option value="">{available.length ? "Select account" : "All accounts assigned"}</option>{available.map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName} · {profile.email}</option>)}</select></label></div><div className="host-assignment-list">{fourball.hosts.length ? fourball.hosts.map((host) => <div key={host.id}><div><strong>{host.fullName || host.email}</strong><span>{host.isPrimary ? "Primary host" : "Co-host"} · {host.email}</span></div><div>{!host.isPrimary ? <button className="secondary-button" disabled={busy} onClick={() => assign(fourball.id, host.profileId, true)}>Make primary</button> : null}<button className="danger-link" disabled={busy} onClick={() => remove(fourball.id, host.profileId, host.fullName || host.email)}>Remove</button>{fourball.submissionStatus !== "submitted" ? <button className="secondary-button" disabled={busy} onClick={() => remind(fourball.id, host.profileId)}>Send reminder</button> : null}</div></div>) : <p className="muted-copy">No host assigned to this fourball.</p>}</div></article>; })}</div>}
    {assignments.length ? <p className="host-total">{assignments.length} host assignment{assignments.length === 1 ? "" : "s"} across {fourballs.length} fourball{fourballs.length === 1 ? "" : "s"}.</p> : null}
  </>;
}

function Players({ event, version }: { event: EventRecord; version: number }) {
  const loaded = useFourballs(event.id, version); const [query, setQuery] = useState(""); const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const players = useMemo(() => (loaded.data?.fourballs || []).flatMap((fourball) => fourball.players.map((player) => ({ ...player, teamName: fourball.teamName, companyName: fourball.companyName, bookingStatus: fourball.bookingStatus, complete: event.requiredPlayerFields.every((field) => { const map: Record<string, string> = { full_name: player.fullName, email: player.email, phone: player.phone, handicap: player.handicap, shirt_size: player.shirtSize, dietary_requirements: player.dietaryRequirements, special_requirements: player.specialRequirements, home_club: player.homeClub, golf_id: player.golfId }; return Boolean(map[field]?.trim()); }) }))).filter((player) => (!onlyIncomplete || !player.complete) && `${player.fullName} ${player.teamName} ${player.companyName}`.toLowerCase().includes(query.toLowerCase())), [loaded.data, event.requiredPlayerFields, onlyIncomplete, query]);
  return <><SectionHeader eyebrow="Player readiness" title="Player list completion" copy="Filter incomplete records and review the final operational player list." /><ErrorBanner message={loaded.error} /><div className="filter-bar"><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search player, team or company" /><label className="check-inline"><input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />Incomplete only</label><strong>{players.length} player positions</strong></div>{!loaded.data ? <Loading /> : <div className="table-scroll panel"><table><thead><tr><th>Status</th><th>Player</th><th>Company / team</th><th>Contact</th><th>Golf</th><th>Shirt</th><th>Requirements</th></tr></thead><tbody>{players.map((player) => <tr key={player.id}><td><Pill value={player.complete ? "complete" : "incomplete"} /></td><td><strong>{player.fullName || `Player ${player.position}`}</strong></td><td>{player.companyName}<small>{player.teamName}</small></td><td>{player.email || "—"}<small>{player.phone}</small></td><td>{player.handicap ? `HCP ${player.handicap}` : "—"}<small>{player.homeClub}</small></td><td>{player.shirtSize || "—"}</td><td>{player.dietaryRequirements || "—"}<small>{player.specialRequirements}</small></td></tr>)}</tbody></table></div>}</>;
}

interface ImportCompany { companyName: string; contactName: string; contactEmail: string; fourballQuantity: number; sponsorshipConfirmed: boolean; sourceRows: number[] }
interface ImportPreview { fileName: string; fileSha256: string; companies: ImportCompany[]; warnings: string[]; rowCount: number }
interface ImportSetup { ok: true; fourballTypes: Array<{ id: string; name: string; capacity: number; priceMinor: number }>; sponsorshipTypes: Array<{ id: string; name: string; capacity: number; priceMinor: number; requiresHole: boolean }>; batches: Array<{ id: string; fileName: string; companyCount: number; fourballCount: number; sponsorshipCount: number; createdAt: string }> }

function normalHeader(value: unknown) { return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "); }
function cleanCell(value: unknown, maximum = 254) { return String(value ?? "").trim().slice(0, maximum); }

async function parseConfirmedWorkbook(file: File): Promise<ImportPreview> {
  if (!file.name.toLowerCase().endsWith(".xlsx") || file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error("Choose an XLSX workbook smaller than 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let archive: Record<string, Uint8Array>;
  try { archive = unzipSync(bytes); } catch { throw new Error("The XLSX workbook could not be read."); }
  const names = Object.keys(archive);
  if (names.some((name) => /vbaProject|macrosheets|xl\/externalLinks/i.test(name))) throw new Error("Workbooks with macros or external links are not accepted.");
  for (const name of names) if (/^xl\/worksheets\/.*\.xml$/i.test(name) && /<f(?:\s|>)/i.test(strFromU8(archive[name]))) throw new Error("Remove spreadsheet formulas before importing.");
  const rows = await readXlsxFile(file);
  if (rows.length < 2 || rows.length > 501) throw new Error("The workbook must contain a header and between 1 and 500 data rows.");
  const aliases: Record<string, string> = { company: "company", "company name": "company", "first name": "first", "contact name": "first", "last name": "last", surname: "last", email: "email", "email address": "email", "4ball yes/no": "fourball", "4 ball yes/no": "fourball", "fourball yes/no": "fourball", "fourball quantity": "fourball", "hole sponsor ? yes / no": "sponsor", "hole sponsor? yes / no": "sponsor", "hole sponsor": "sponsor", "sponsorship confirmed": "sponsor" };
  const columns = new Map<string, number>();
  rows[0].forEach((cell, index) => { const alias = aliases[normalHeader(cell)]; if (alias && !columns.has(alias)) columns.set(alias, index); });
  for (const required of ["company", "fourball", "sponsor"]) if (!columns.has(required)) throw new Error(`Required column not found: ${required}.`);
  const grouped = new Map<string, ImportCompany>();
  const warnings: string[] = [];
  rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    const companyName = cleanCell(row[columns.get("company")!], 180).replace(/\s+/g, " ");
    if (!companyName) { warnings.push(`Row ${rowNumber}: skipped because company is blank.`); return; }
    const first = cleanCell(row[columns.get("first") ?? -1], 100);
    const last = cleanCell(row[columns.get("last") ?? -1], 100);
    const email = cleanCell(row[columns.get("email") ?? -1]).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warnings.push(`Row ${rowNumber}: “${email}” is not a valid email and was omitted.`);
    if (/^\d+$/.test(first)) warnings.push(`Row ${rowNumber}: first name “${first}” looks unusual; review this company before importing.`);
    const fourballRaw = cleanCell(row[columns.get("fourball")!], 30).toLowerCase();
    let fourballs = 0;
    if (["yes", "y", "true"].includes(fourballRaw)) fourballs = 1;
    else if (/^\d+$/.test(fourballRaw)) fourballs = Number(fourballRaw);
    else if (fourballRaw && !["no", "n", "false"].includes(fourballRaw)) warnings.push(`Row ${rowNumber}: fourball value “${fourballRaw}” was treated as No.`);
    const sponsorRaw = cleanCell(row[columns.get("sponsor")!], 40).toLowerCase();
    const sponsorshipConfirmed = ["yes", "y", "true"].includes(sponsorRaw);
    if (sponsorRaw && !["yes", "y", "true", "no", "n", "false"].includes(sponsorRaw)) warnings.push(`Row ${rowNumber}: sponsorship value “${sponsorRaw}” is ambiguous and was left off for manual review.`);
    const key = companyName.toLowerCase();
    const existing = grouped.get(key) || { companyName, contactName: "", contactEmail: "", fourballQuantity: 0, sponsorshipConfirmed: false, sourceRows: [] };
    existing.fourballQuantity += fourballs;
    existing.sponsorshipConfirmed ||= sponsorshipConfirmed;
    existing.sourceRows.push(rowNumber);
    if (!existing.contactName && (first || last)) existing.contactName = `${first} ${last}`.trim();
    if (!existing.contactEmail && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) existing.contactEmail = email;
    grouped.set(key, existing);
  });
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fileSha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return { fileName: file.name, fileSha256, companies: [...grouped.values()], warnings, rowCount: rows.length - 1 };
}

function ConfirmedImports({ event, onRefresh }: { event: EventRecord; onRefresh: () => void }) {
  const [setup, setSetup] = useState<ImportSetup | null>(null); const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fourballTypeId, setFourballTypeId] = useState(""); const [sponsorshipTypeId, setSponsorshipTypeId] = useState("");
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [version, setVersion] = useState(0);
  useEffect(() => { let active = true; opsApi<ImportSetup>(`/api/v1/admin/confirmed-imports?eventId=${event.id}`).then((data) => { if (!active) return; setSetup(data); setFourballTypeId((value) => value || data.fourballTypes[0]?.id || ""); setSponsorshipTypeId((value) => value || data.sponsorshipTypes[0]?.id || ""); }).catch((caught: Error) => { if (active) setError(caught.message); }); return () => { active = false; }; }, [event.id, version]);
  async function chooseFile(file: File | undefined) { if (!file) return; setBusy(true); setError(""); setMessage(""); try { setPreview(await parseConfirmedWorkbook(file)); } catch (caught) { setPreview(null); setError(caught instanceof Error ? caught.message : "The workbook could not be previewed."); } finally { setBusy(false); } }
  function updateCompany(index: number, changes: Partial<ImportCompany>) { setPreview((current) => current ? { ...current, companies: current.companies.map((company, companyIndex) => companyIndex === index ? { ...company, ...changes } : company) } : current); }
  async function commit() {
    if (!preview || !fourballTypeId) return;
    const sponsors = preview.companies.filter((company) => company.sponsorshipConfirmed).length;
    if (sponsors && !sponsorshipTypeId) { setError("Select the sponsorship type before importing."); return; }
    if (!window.confirm(`Import ${preview.companies.length} companies, ${preview.companies.reduce((sum, company) => sum + company.fourballQuantity, 0)} fourballs and ${sponsors} sponsorships as confirmed?`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await jsonMutation<{ ok: true; result: { companiesProcessed: number; fourballsCreated: number; sponsorshipsCreated: number; skippedFourballs: number; skippedSponsorships: number } }>("/api/v1/admin/confirmed-imports", "POST", { eventId: event.id, fileName: preview.fileName, fileSha256: preview.fileSha256, fourballTypeId, sponsorshipTypeId: sponsors ? sponsorshipTypeId : null, companies: preview.companies.map((company) => ({ companyName: company.companyName, contactName: company.contactName, contactEmail: company.contactEmail, fourballQuantity: company.fourballQuantity, sponsorshipConfirmed: company.sponsorshipConfirmed })) });
      setMessage(`Imported ${result.result.companiesProcessed} companies, created ${result.result.fourballsCreated} fourballs and ${result.result.sponsorshipsCreated} sponsorships.${result.result.skippedFourballs || result.result.skippedSponsorships ? " Existing matching allocations were left unchanged." : ""}`);
      setPreview(null); setVersion((value) => value + 1); onRefresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The import failed."); } finally { setBusy(false); }
  }
  const totalFourballs = preview?.companies.reduce((sum, company) => sum + company.fourballQuantity, 0) || 0;
  const totalSponsors = preview?.companies.filter((company) => company.sponsorshipConfirmed).length || 0;
  return <><SectionHeader eyebrow="Existing confirmations" title="Import confirmed companies" copy="Preview your existing XLSX list, consolidate repeated companies and create only missing confirmed bookings and sponsorships." /><ErrorBanner message={error} />{message ? <div className="success-banner" role="status">{message}</div> : null}<section className="panel"><div className="form-grid compact"><label><span>Confirmed-list workbook</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(change) => chooseFile(change.target.files?.[0])} /></label><label><span>Fourball type</span><select value={fourballTypeId} onChange={(change) => setFourballTypeId(change.target.value)} required><option value="">Select type</option>{setup?.fourballTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {money(type.priceMinor, event.currency)}</option>)}</select></label><label><span>Hole sponsorship type</span><select value={sponsorshipTypeId} onChange={(change) => setSponsorshipTypeId(change.target.value)}><option value="">Do not map sponsorships</option>{setup?.sponsorshipTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {money(type.priceMinor, event.currency)}</option>)}</select></label></div>{setup && setup.fourballTypes.length === 0 ? <p className="warning-copy">Configure at least one active fourball type before importing.</p> : null}{setup && setup.sponsorshipTypes.length === 0 ? <p className="warning-copy">Configure a sponsorship type before mapping confirmed hole sponsors.</p> : null}</section>{preview ? <><div className="metric-grid"><article className="metric-card"><span>Workbook rows</span><strong>{preview.rowCount}</strong></article><article className="metric-card"><span>Consolidated companies</span><strong>{preview.companies.length}</strong></article><article className="metric-card"><span>Confirmed fourballs</span><strong>{totalFourballs}</strong></article><article className="metric-card"><span>Confirmed sponsors</span><strong>{totalSponsors}</strong></article></div>{preview.warnings.length ? <section className="panel"><h3>Review warnings</h3><ul className="warning-list">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}<section className="panel"><h3>Import preview</h3><div className="table-scroll"><table><thead><tr><th>Company</th><th>Primary contact</th><th>Source rows</th><th>Fourballs</th><th>Hole sponsor</th></tr></thead><tbody>{preview.companies.map((company, index) => <tr key={`${company.companyName}-${index}`}><td><input value={company.companyName} onChange={(change) => updateCompany(index, { companyName: change.target.value })} /></td><td><input value={company.contactName} placeholder="Name" onChange={(change) => updateCompany(index, { contactName: change.target.value })} /><input type="email" value={company.contactEmail} placeholder="Email optional" onChange={(change) => updateCompany(index, { contactEmail: change.target.value })} /></td><td>{company.sourceRows.join(", ")}</td><td><input type="number" min="0" max="100" value={company.fourballQuantity} onChange={(change) => updateCompany(index, { fourballQuantity: Number(change.target.value) })} /></td><td><input type="checkbox" checked={company.sponsorshipConfirmed} aria-label={`${company.companyName} sponsorship confirmed`} onChange={(change) => updateCompany(index, { sponsorshipConfirmed: change.target.checked })} /></td></tr>)}</tbody></table></div><div className="form-actions"><button className="primary-button" disabled={busy || !fourballTypeId || preview.companies.length === 0} onClick={commit}>{busy ? "Importing…" : "Import confirmed list"}</button></div></section></> : <Empty title={busy ? "Reading workbook…" : "No workbook selected"} copy="Choose your confirmed-list XLSX file to see every proposed company, fourball and sponsorship before anything is saved." />}{setup?.batches.length ? <section className="panel"><h3>Previous imports</h3><div className="compact-list">{setup.batches.map((batch) => <div key={batch.id}><div><strong>{batch.fileName}</strong><span>{dateTime(batch.createdAt)}</span></div><span>{batch.companyCount} companies · {batch.fourballCount} fourballs · {batch.sponsorshipCount} sponsors</span></div>)}</div></section> : null}</>;
}

function Exports({ event }: { event: EventRecord }) {
  const exports = [["players", "Complete player list", "Contact, golf, clothing and special requirements"], ["fourballs", "Fourballs and tee sheet", "Teams, hosts, payment and shotgun starts"], ["sponsors", "Sponsor allocation sheet", "Commitments, commercial status and hole allocations"], ["hosts", "Outstanding host report", "Invitation, acceptance, reminder and submission states"]];
  return <><SectionHeader eyebrow="Event handoff" title="Operational exports" copy="Exports are generated for this event only and protect spreadsheet cells from formula injection." /><div className="export-grid">{exports.map(([type, title, copy]) => <a key={type} className="export-card" href={`/api/v1/admin/exports?eventId=${event.id}&type=${type}`} onClick={async (click) => { click.preventDefault(); const exportUrl = click.currentTarget.href; try { const client = (await import("../ops/client")).getSupabase; const supabase = await client(); const { data } = await supabase.auth.getSession(); const response = await fetch(exportUrl, { headers: { Authorization: `Bearer ${data.session?.access_token || ""}` } }); if (!response.ok) throw new Error("Export failed."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `m2m-${type}.csv`; anchor.click(); URL.revokeObjectURL(url); } catch { window.alert("The export could not be downloaded."); } }}><span>CSV</span><h3>{title}</h3><p>{copy}</p><strong>Download →</strong></a>)}</div></>;
}

interface Enquiry { registrationId: string; submittedAt: string; status: string; email: string; contactName: string; company: string; phone: string; fourballCount: number; players: Array<{ name?: string; handicap?: string }>; sponsorshipLabel: string; sponsorshipAmount: number; totalAmount: number; notes: string; conversion: { event_id: string; converted_at: string } | null }
function Enquiries({ event, version, onRefresh }: { event: EventRecord; version: number; onRefresh: () => void }) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]); const [companies, setCompanies] = useState<EventCompany[]>([]); const [types, setTypes] = useState<SponsorshipType[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [localVersion, setLocalVersion] = useState(0);
  useEffect(() => { let active = true; Promise.all([opsApi<{ ok: true; enquiries: Enquiry[] }>("/api/v1/admin/enquiries"), opsApi<CompaniesPayload>(`/api/v1/admin/companies?eventId=${event.id}`), opsApi<SponsorPayload>(`/api/v1/admin/sponsorships?eventId=${event.id}`)]).then(([inbox, companyData, sponsorData]) => { if (active) { setEnquiries(inbox.enquiries); setCompanies(companyData.companies); setTypes(sponsorData.types); } }).catch((caught: Error) => { if (active) setError(caught.message); }); return () => { active = false; }; }, [event.id, version, localVersion]);
  async function convert(formEvent: FormEvent<HTMLFormElement>, enquiry: Enquiry) { formEvent.preventDefault(); setBusy(true); setError(""); const form = new FormData(formEvent.currentTarget); try { await jsonMutation("/api/v1/admin/enquiries", "POST", { registrationId: enquiry.registrationId, eventId: event.id, companyId: form.get("companyId") || null, companyName: form.get("companyName") || enquiry.company || enquiry.contactName, sponsorshipTypeId: form.get("sponsorshipTypeId") || null }); setLocalVersion((v) => v + 1); onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Conversion failed."); } finally { setBusy(false); } }
  const unconverted = enquiries.filter((item) => !item.conversion);
  return <><SectionHeader eyebrow="Public-site compatibility" title="Website enquiries" copy="Review and atomically convert public submissions into this event without changing the live registration form." /><ErrorBanner message={error} />{unconverted.length === 0 ? <Empty title="Inbox is clear" copy="No unconverted website enquiries are waiting." /> : <div className="enquiry-list">{unconverted.map((item) => <article className="enquiry-card" key={item.registrationId}><header><div><Pill value={item.status} /><h3>{item.company || "Individual registration"}</h3><p>{item.contactName} · {item.email} · {item.phone}</p></div><div><strong>{item.fourballCount} fourball{item.fourballCount === 1 ? "" : "s"}</strong><span>{money(item.totalAmount, event.currency)}</span></div></header><div className="enquiry-meta"><span>{item.registrationId}</span><span>{dateTime(item.submittedAt)}</span><span>{item.sponsorshipLabel || "No sponsorship"}</span><span>{item.players.filter((p) => p.name).length} named players</span></div>{item.notes ? <p>{item.notes}</p> : null}<details className="action-disclosure"><summary>Review conversion</summary><form className="form-grid compact" onSubmit={(e) => convert(e, item)}><label><span>Match existing company</span><select name="companyId" defaultValue=""><option value="">Create from enquiry</option>{companies.map((company) => <option key={company.companyId} value={company.companyId}>{company.name}</option>)}</select></label><label><span>Company name</span><input name="companyName" defaultValue={item.company || item.contactName} /></label><label><span>Map sponsorship</span><select name="sponsorshipTypeId" defaultValue=""><option value="">No mapped sponsorship</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><div className="conversion-preview"><strong>Conversion creates</strong><span>{item.fourballCount} fourball(s) with four player positions each</span><span>{item.contactName} as primary host for each team</span><span>A pending event-company relationship</span></div><FormActions busy={busy} label="Convert enquiry" /></form></details></article>)}</div>}</>;
}

function UserDrawer({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserRecord[]>([]); const [canManageAdmins, setCanManageAdmins] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [version, setVersion] = useState(0);
  useEffect(() => { let active = true; opsApi<{ ok: true; users: UserRecord[]; canManageAdmins: boolean }>("/api/v1/admin/users").then((payload) => { if (active) { setUsers(payload.users); setCanManageAdmins(payload.canManageAdmins); } }).catch((caught: Error) => { if (active) setError(caught.message); }); return () => { active = false; }; }, [version]);
  async function invite(formEvent: FormEvent<HTMLFormElement>) { formEvent.preventDefault(); setBusy(true); setError(""); const formElement = formEvent.currentTarget; const form = new FormData(formElement); try { await jsonMutation("/api/v1/admin/users", "POST", { action: "invite", fullName: form.get("fullName"), email: form.get("email"), role: form.get("role"), temporaryPassword: form.get("temporaryPassword") }); formElement.reset(); setVersion((v) => v + 1); } catch (caught) { setError(caught instanceof Error ? caught.message : "Account creation failed."); } finally { setBusy(false); } }
  async function status(user: UserRecord) { setBusy(true); setError(""); try { await jsonMutation("/api/v1/admin/users", "PATCH", { action: user.isActive ? "deactivate" : "reactivate", profileId: user.id }); setVersion((v) => v + 1); } catch (caught) { setError(caught instanceof Error ? caught.message : "Account update failed."); } finally { setBusy(false); } }
  return <div className="overlay"><section className="drawer" role="dialog" aria-modal="true" aria-labelledby="users-title"><div className="drawer-head"><div><p className="eyebrow">Account directory</p><h2 id="users-title">Administrators and hosts</h2></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div><ErrorBanner message={error} /><form className="stack-form invite-form" onSubmit={invite}><h3>Create user account</h3><label><span>Full name</span><input name="fullName" required /></label><label><span>Email / username</span><input type="email" name="email" required /></label><label><span>Temporary password</span><input type="password" name="temporaryPassword" minLength={12} autoComplete="new-password" required /></label><p className="form-help">12+ characters with uppercase, lowercase, a number and symbol. Share it securely; the user must replace it at first sign in.</p><label><span>Role</span><select name="role"><option value="host">Host</option>{canManageAdmins ? <><option value="admin">Administrator</option><option value="super_admin">Super administrator</option></> : null}</select></label><FormActions busy={busy} label="Create account" /></form><div className="user-list">{users.map((user) => <article key={user.id}><div><strong>{user.fullName}</strong><span>{user.email}</span></div><div><Pill value={user.role} /><button className={user.isActive ? "danger-link" : "text-button"} disabled={busy || (!canManageAdmins && user.role !== "host")} onClick={() => status(user)}>{user.isActive ? "Deactivate" : "Reactivate"}</button></div></article>)}</div></section></div>;
}
