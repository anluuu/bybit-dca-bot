import { hash, compare } from "bcryptjs";
import { config } from "../config.js";
import { logger } from "../logger.js";

// Pre-hash the password once at module load so login is constant-time.
// bcryptjs hash() is async so we lazily initialize on first call.
let passwordHashPromise: Promise<string> | null = null;

function getPasswordHash(): Promise<string> {
  if (!passwordHashPromise) {
    passwordHashPromise = hash(config.ADMIN_PASSWORD, 12);
  }
  return passwordHashPromise;
}

export interface VerifyResult {
  ok: boolean;
}

/**
 * Verify username + password against the configured admin credentials.
 * Returns { ok: false } (never throws) so the controller can return 401 cleanly.
 */
export async function verifyCredentials(
  username: string,
  password: string
): Promise<VerifyResult> {
  if (username !== config.ADMIN_USERNAME) {
    logger.warn("Failed login attempt", { username });
    return { ok: false };
  }
  const hash = await getPasswordHash();
  const match = await compare(password, hash);
  if (!match) {
    logger.warn("Failed login attempt", { username });
  }
  return { ok: match };
}
