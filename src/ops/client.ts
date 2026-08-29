import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let clientPromise: Promise<SupabaseClient> | null = null;

type ConfigResponse = {
  ok?: boolean;
  message?: string;
  supabaseUrl?: string;
  publishableKey?: string;
};

type ErrorResponse = {
  ok?: boolean;
  message?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
};

export function getSupabase(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = fetch("/api/v1/config", { cache: "no-store" })
      .then(async (response) => {
        if (!response.headers.get("content-type")?.includes("application/json")) {
          throw new Error("The operational API is unavailable in this local server. Use a Vercel preview for authenticated workflows.");
        }
        const payload = await response.json() as ConfigResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.message || "Authentication is unavailable.");
        if (!payload.supabaseUrl || !payload.publishableKey) throw new Error("Authentication configuration is incomplete.");
        return createClient(payload.supabaseUrl, payload.publishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
        });
      });
  }
  return clientPromise;
}

export class OpsApiError extends Error {
  status: number;
  code: string;
  fieldErrors: Record<string, string>;

  constructor(message: string, status = 500, code = "unexpected_error", fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "OpsApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export async function opsApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new OpsApiError("Sign in is required.", 401, "authentication_required");
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as ErrorResponse;
  if (!response.ok || payload.ok === false) {
    throw new OpsApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload.fieldErrors);
  }
  return payload as T;
}

export async function currentSession(): Promise<Session | null> {
  const client = await getSupabase();
  const { data } = await client.auth.getSession();
  return data.session;
}

export function money(minor: number, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency, maximumFractionDigits: 0 }).format((minor || 0) / 100);
}

export function dateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function toLocalInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function toIso(value: FormDataEntryValue | null) {
  const raw = String(value || "");
  return raw ? new Date(raw).toISOString() : "";
}
