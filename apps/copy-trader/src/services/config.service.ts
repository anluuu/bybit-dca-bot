import type { CopyConfig } from "@dca/shared";
import { getAllConfig, setConfig } from "../configStore.js";

export async function listConfig(): Promise<CopyConfig> {
  return await getAllConfig();
}

export async function updateConfig(key: string, value: string): Promise<void> {
  await setConfig(key, value);
}
