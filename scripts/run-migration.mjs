// Applies a single SQL file to the project's Supabase Postgres database via
// a direct connection (DATABASE_URL). Used for migrations that were, until
// now, pasted into the Supabase SQL Editor by hand.
//
// Usage: node --env-file=.env.local scripts/run-migration.mjs supabase/migrations/0009_telegram_dedup.sql
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node --env-file=.env.local scripts/run-migration.mjs <path-to-sql-file>");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
// Supabase's pooler requires SSL; without it, connection fails with a
// misleading "password authentication failed" rather than an SSL error.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

await client.connect();
try {
  await client.query(sql);
  console.log("Applied:", file);
} finally {
  await client.end();
}
