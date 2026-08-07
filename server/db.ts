import pkg from 'pg';
const { Pool } = pkg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "../shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for database connection");
}

// Render's own Postgres (and most managed Postgres providers reached over
// an internal/private network) present a self-signed certificate. If a CA
// is explicitly provided, verify against it; otherwise encrypt the
// connection but don't reject the self-signed cert.
const sslConfig = process.env.DATABASE_URL?.includes('sslmode=disable')
  ? false
  : process.env.DATABASE_SSL_CA
    ? { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true }
    : { rejectUnauthorized: false };

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  connectionTimeoutMillis: 10000,
  max: 20,
  idleTimeoutMillis: 30000,
});

export const db = drizzle(pool, { schema });
