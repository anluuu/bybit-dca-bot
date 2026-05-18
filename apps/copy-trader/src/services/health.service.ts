import { sql as pg } from "../db/client.js";

export async function isDbReady(): Promise<boolean> {
  try {
    await pg`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
