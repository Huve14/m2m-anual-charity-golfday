import { type FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, opsApi } from "./client";

export function useOpsSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => {};
    getSupabase()
      .then(async (client) => {
        const { data, error: sessionError } = await client.auth.getSession();
        if (!active) return;
        if (sessionError) setError(sessionError.message);
        setSession(data.session);
        setLoading(false);
        const listener = client.auth.onAuthStateChange((_event, nextSession) => {
          if (active) setSession(nextSession);
        });
        unsubscribe = () => listener.data.subscription.unsubscribe();
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Authentication is unavailable.");
        setLoading(false);
      });
    return () => { active = false; unsubscribe(); };
  }, []);

  return { session, loading, error };
}

export function SignIn({ audience }: { audience: "admin" | "host" }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const client = await getSupabase();
      const { error } = await client.auth.signInWithPassword({ email: String(form.get("email") || ""), password: String(form.get("password") || "") });
      if (error) throw error;
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin-shell">
      <section className="signin-story">
        <img src="/assets/m2m-logo.png" alt="Marketing 2 The Max" />
        <p className="eyebrow">Secure golf-day operations</p>
        <h1>{audience === "admin" ? <>Every event.<br /><span>Under control.</span></> : <>Your fourball.<br /><span>Ready to play.</span></>}</h1>
        <p>{audience === "admin" ? "Run sponsors, teams, hosts and tee allocations from one event-specific workspace." : "Complete your player list securely before the event deadline."}</p>
      </section>
      <form className="signin-card" onSubmit={signIn}>
        <p className="eyebrow">Authorised access</p>
        <h2>{audience === "admin" ? "Administrator sign in" : "Host portal sign in"}</h2>
        <label><span>Email address</span><input type="email" name="email" autoComplete="email" required /></label>
        <label><span>Password</span><input type="password" name="password" autoComplete="current-password" required /></label>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="form-help">Use your email address and the password supplied by an administrator.</p>
        {message ? <p className="form-message" role="status">{message}</p> : null}
      </form>
    </main>
  );
}

export function AccountGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "change">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { opsApi<{ profile: { mustChangePassword: boolean } }>("/api/v1/account").then((data) => setState(data.profile.mustChangePassword ? "change" : "ready")).catch((error) => setMessage(error instanceof Error ? error.message : "Your account could not be loaded.")); }, []);
  if (state === "ready") return <>{children}</>;
  if (state === "loading" && !message) return <main className="callback-shell"><span className="spinner" /><h1>Checking your account…</h1></main>;
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); const data = new FormData(event.currentTarget);
    try { await opsApi("/api/v1/account", { method: "PATCH", body: JSON.stringify({ password: data.get("password"), confirmation: data.get("confirmation") }) }); setState("ready"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Your password could not be changed."); }
    finally { setBusy(false); }
  }
  return <main className="signin-shell"><section className="signin-story"><img src="/assets/m2m-logo.png" alt="Marketing 2 The Max" /><p className="eyebrow">Account security</p><h1>Set your<br /><span>own password.</span></h1><p>Your temporary password must be replaced before you can access golf-day information.</p></section><form className="signin-card" onSubmit={change}><p className="eyebrow">First sign in</p><h2>Change password</h2><label><span>New password</span><input type="password" name="password" minLength={12} autoComplete="new-password" required /></label><label><span>Confirm password</span><input type="password" name="confirmation" minLength={12} autoComplete="new-password" required /></label><p className="form-help">Use at least 12 characters with uppercase, lowercase, a number and a symbol.</p><button className="primary-button" disabled={busy}>{busy ? "Changing…" : "Change password"}</button>{message ? <p className="form-message" role="alert">{message}</p> : null}</form></main>;
}

export async function signOut() {
  const client = await getSupabase();
  await client.auth.signOut();
}
