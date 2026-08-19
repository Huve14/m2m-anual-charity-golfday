#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const sqlFile = resolve(process.cwd(), "supabase", "m2m-registrations-table.sql");
const dbUrl =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_POSTGRES_URL ||
  process.env.POSTGRES_URL;

if (!dbUrl) {
  console.error(
    "Missing database URL. Set SUPABASE_DB_URL (or DATABASE_URL) and retry.",
  );
  process.exit(1);
}

if (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://")) {
  console.error(
    "Invalid database URL. Expected a PostgreSQL URL starting with postgres:// or postgresql://.",
  );
  process.exit(1);
}

try {
  execFileSync(
    "psql",
    [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", sqlFile],
    { stdio: "inherit" },
  );
  console.log("m2m_registrations table deployment complete.");
} catch (error) {
  const message =
    error?.statusCode ||
    error?.errno ||
    (error instanceof Error ? error.message : "unknown error");
  console.error(
    "Failed to create the m2m_registrations table. Check your DB URL and network access.",
  );
  console.error(message);
  process.exit(1);
}
