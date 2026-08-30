import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./ops/client";
import "./ops/ops.css";

function safePortalPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : null;
}

async function portalForSession(session: Session, requested: string | null) {
  const safeRequested = safePortalPath(requested);
  if (safeRequested) return safeRequested;
  const response = await fetch("/api/v1/admin/events", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  return response.ok ? "/admin" : "/host";
}

function AuthCallback() {
  const [message, setMessage] = useState("Verifying your secure link…");
  useEffect(() => {
    let active = true;
    async function complete() {
      try {
        const client = await getSupabase();
        const params = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const authError = params.get("error_description") || hash.get("error_description");
        if (authError) throw new Error(authError);

        const code = params.get("code");
        const tokenHash = params.get("token_hash");
        const type = params.get("type") as "invite" | "magiclink" | "email" | null;
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (code) {
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) throw error;
        }
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error("This secure link is invalid or has expired.");
        window.location.replace(await portalForSession(data.session, params.get("next")));
      } catch (caught) {
        if (active) setMessage(caught instanceof Error ? caught.message : "The secure link could not be verified.");
      }
    }
    complete();
    return () => { active = false; };
  }, []);
  return <main className="callback-shell"><img src="/assets/m2m-logo.png" alt="M2M" /><span className="spinner" /><h1>{message}</h1><p><a href="/admin">Administrator sign in</a> · <a href="/host">Host sign in</a></p></main>;
}

const root = document.getElementById("auth-root");
if (!root) throw new Error("Auth root element not found");
createRoot(root).render(<StrictMode><AuthCallback /></StrictMode>);
