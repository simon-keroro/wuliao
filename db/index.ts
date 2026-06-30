import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let cachedDb: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (cachedDb) return cachedDb;

  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable."
    );
  }

  cachedDb = drizzle(env.DB, { schema });
  return cachedDb;
}
