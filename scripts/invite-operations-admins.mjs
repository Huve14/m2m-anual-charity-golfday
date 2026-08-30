import { createClient } from "@supabase/supabase-js";

const url = String(process.env.SUPABASE_URL || "").trim();
const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
const temporaryPassword = String(process.env.M2M_INITIAL_ADMIN_PASSWORD || "");
const admins = String(process.env.M2M_INITIAL_ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

if (!url || !serviceRole || admins.length === 0 || temporaryPassword.length < 12) {
  throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, M2M_INITIAL_ADMIN_EMAILS and a strong M2M_INITIAL_ADMIN_PASSWORD (12+ characters).");
}

const client = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
for (const [index, email] of admins.entries()) {
  let authUser = null;
  for (let page = 1; page <= 10 && !authUser; page += 1) {
    const listed = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (listed.error) throw listed.error;
    authUser = listed.data.users.find((user) => user.email?.toLowerCase() === email) || null;
    if (listed.data.users.length < 1000) break;
  }
  if (authUser) {
    const { data, error } = await client.auth.admin.updateUserById(authUser.id, { password: temporaryPassword, email_confirm: true });
    if (error || !data.user) throw new Error(`Password setup failed for ${email}: ${error?.message || "missing Auth user"}`);
    authUser = data.user;
  } else {
    const { data, error } = await client.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { full_name: email.split("@")[0] } });
    if (error || !data.user) throw new Error(`Account creation failed for ${email}: ${error?.message || "missing Auth user"}`);
    authUser = data.user;
  }
  const { error: profileError } = await client.from("m2m_profiles").upsert({
    id: authUser.id,
    email,
    full_name: authUser.user_metadata?.full_name || email.split("@")[0],
    role: index === 0 ? "super_admin" : "admin",
    is_active: true,
    must_change_password: true,
  });
  if (profileError) throw new Error(`Profile failed for ${email}: ${profileError.message}`);
  process.stdout.write(`Provisioned ${email} as ${index === 0 ? "super_admin" : "admin"}\n`);
}
