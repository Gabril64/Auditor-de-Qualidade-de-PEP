import { generatePassword, hashPassword } from "./auth/passwords.js";
import { configuredServiceToken, ensureServiceUser, serviceUserEmail } from "./auth/serviceToken.js";
import { getDb } from "./db/connection.js";
import { errorMessage } from "./errorMessage.js";

const DEFAULT_ADMIN_EMAIL = "admin@auditor.local";

/** Creates the first administrator if no user with this email exists yet; otherwise a no-op.
 * Returns the password only when it just created the account — never for one that already
 * existed, since an existing password is never known or changed here. */
async function ensureAdmin(email: string, password: string | undefined): Promise<string | null> {
  const db = getDb();
  if (!db) throw new Error("could not open the database");

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return null;

  const plainPassword = password || generatePassword();
  const passwordHash = await hashPassword(plainPassword);
  db.prepare(
    "INSERT INTO users (email, name, password_hash, role, created_by, created_at) VALUES (?, ?, ?, 'admin', NULL, ?)",
  ).run(email, "Administrador", passwordHash, new Date().toISOString());

  return plainPassword;
}

/** Seeds the first administrator on startup. Idempotent: running it again never recreates the
 * account or changes its password. The password is printed once, to the container's own logs
 * (`docker compose logs producer`) — never written to a file or sent anywhere else. */
export async function runSeed(): Promise<void> {
  const email = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  try {
    const password = await ensureAdmin(email, process.env.ADMIN_PASSWORD);
    if (password) {
      console.log(`[Seed] Administrator created: ${email} / ${password} (change it on first login)`);
    } else {
      console.log(`[Seed] Administrator already exists: ${email}`);
    }
  } catch (error) {
    console.error("[Seed] Failed to seed the administrator:", errorMessage(error));
  }

  if (!configuredServiceToken()) return;
  try {
    const outcome = await ensureServiceUser();
    console.log(
      outcome === "created"
        ? `[Seed] Service account created for EVAL_API_TOKEN: ${serviceUserEmail()}`
        : `[Seed] Service account already exists: ${serviceUserEmail()}`,
    );
  } catch (error) {
    console.error("[Seed] Failed to seed the service account:", errorMessage(error));
  }
}
