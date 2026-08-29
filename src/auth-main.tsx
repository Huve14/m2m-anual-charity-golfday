import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getSupabase } from "./ops/client";
import "./ops/ops.css";

function AuthCallback() {
  const [message, setMessage] = useState("Verifying your secure link…");
  useEffect(() => {
    let active = true;
    async function complete() {
      try {
        const client = await getSupabase();
        const params = new URLSearchParams(window.location.search);
        const tokenHash = params.get("token_hash");
        const type = params.get("type") as "invite" | "magiclink" | "email" | null;
        if (tokenHash && type) {
          const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
        }
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error("This secure link is invalid or has expired.");
        const next = params.get("next") || "/host";
        const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/host";
        window.location.replace(safeNext);
      } catch (caught) {
        if (active) setMessage(caught instanceof Error ? caught.message : "The secure link could not be verified.");
      }
    }
    complete();
    return () => { active = false; };
  }, []);
  return <main className="callback-shell"><img src="/assets/m2m-logo.png" alt="M2M" /><span className="spinner" /><h1>{message}</h1><a href="/host">Return to sign in</a></main>;
}

const root = document.getElementById("auth-root");
if (!root) throw new Error("Auth root element not found");
createRoot(root).render(<StrictMode><AuthCallback /></StrictMode>);

