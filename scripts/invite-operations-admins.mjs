import { createClient } from "@supabase/supabase-js";

const url = String(process.env.SUPABASE_URL || "").trim();
const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
const siteUrl = String(process.env.M2M_OPERATIONS_SITE_URL || "").replace(/\/$/, "");
const admins = String(process.env.M2M_INITIAL_ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

if (!url || !serviceRole || !siteUrl || admins.length === 0) {
  throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, M2M_OPERATIONS_SITE_URL and M2M_INITIAL_ADMIN_EMAILS.");
}

const client = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
for (const [index, email] of admins.entries()) {
  const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/auth?next=${encodeURIComponent("/admin")}`,
    data: { full_name: email.split("@")[0] },
  });
  if (error || !data.user) throw new Error(`Invitation failed for ${email}: ${error?.message || "missing Auth user"}`);
  const { error: profileError } = await client.from("m2m_profiles").upsert({
    id: data.user.id,
    email,
    full_name: data.user.user_metadata?.full_name || email.split("@")[0],
    role: index === 0 ? "super_admin" : "admin",
    is_active: true,
  });
  if (profileError) throw new Error(`Profile failed for ${email}: ${profileError.message}`);
  process.stdout.write(`Invited ${email} as ${index === 0 ? "super_admin" : "admin"}\n`);
}
