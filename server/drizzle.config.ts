import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL not set - database operations may fail");
}

// Determine SSL configuration for Neon database  
function getSSLConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  
  // If DATABASE_URL contains sslmode=disable, don't use SSL
  if (databaseUrl?.includes('sslmode=disable')) {
    return false;
  }
  
  // Validate the database certificate by default. A provider CA can be
  // supplied explicitly when the deployment uses a private certificate.
  if (databaseUrl?.includes('neon.tech')) {
    return process.env.DATABASE_SSL_CA
      ? { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true }
      : { rejectUnauthorized: true };
  }
  
  // Render's own Postgres (and most other managed Postgres reached over a
  // private network) presents a self-signed certificate, so don't reject
  // it unless a CA was explicitly supplied.
  if (databaseUrl?.includes('render.com') || process.env.NODE_ENV === 'production') {
    return process.env.DATABASE_SSL_CA
      ? { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true }
      : { rejectUnauthorized: false };
  }
  
  // For local development, disable SSL by default
  return false;
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: getSSLConfig()
  },
});
