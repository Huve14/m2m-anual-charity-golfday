import { type FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./client";

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
  const [codeSent, setCodeSent] = useState(false);

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

  async function emailCode(form: HTMLFormElement) {
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email) { setMessage("Enter your email address first."); return; }
    setBusy(true);
    setMessage("");
    try {
      const client = await getSupabase();
      const destination = `${window.location.origin}/auth?next=${encodeURIComponent(audience === "admin" ? "/admin" : "/host")}`;
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: destination } });
      if (error) throw error;
      setCodeSent(true);
      setMessage("A six-digit sign-in code is on its way. Enter it below.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The sign-in code could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(form: HTMLFormElement) {
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const token = String(data.get("otp") || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(token)) { setMessage("Enter the six-digit code from your email."); return; }
    setBusy(true);
    setMessage("");
    try {
      const client = await getSupabase();
      const { error } = await client.auth.verifyOtp({ email, token, type: "email" });
      if (error) throw error;
      setMessage("Signed in successfully.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The sign-in code could not be verified.");
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
        <button className="text-button" type="button" disabled={busy} onClick={(event) => emailCode(event.currentTarget.form!)}>Email me a sign-in code</button>
        {codeSent ? <div className="otp-entry"><label><span>Six-digit code</span><input type="text" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label><button className="secondary-button" type="button" disabled={busy} onClick={(event) => verifyCode(event.currentTarget.form!)}>Verify code</button></div> : null}
        {message ? <p className="form-message" role="status">{message}</p> : null}
      </form>
    </main>
  );
}

export async function signOut() {
  const client = await getSupabase();
  await client.auth.signOut();
}
