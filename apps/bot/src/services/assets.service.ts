import { sql } from "drizzle-orm";
import type { Asset as WireAsset, PublicStatus } from "@dca/shared";
import { db } from "../db/client.js";
import { assets } from "../db/schema.js";
import { mapAssetRowToWire } from "../dto/asset.dto.js";

export async function listAssets(): Promise<WireAsset[]> {
  const rows = await db.select().from(assets);
  return rows.map(mapAssetRowToWire);
}

export async function getPublicStatus(): Promise<PublicStatus | null> {
  const [firstAsset] = await db.select().from(assets).limit(1);
  if (!firstAsset) return null;
  return {
    pair: firstAsset.pair,
    buyAmount: firstAsset.buyAmount,
    cronSchedule: firstAsset.cronSchedule,
    monthlyCap: firstAsset.monthlyCap,
  };
}

export async function findAssetByPair(pair: string) {
  const [asset] = await db
    .select()
    .from(assets)
    .where(sql`${assets.pair} = ${pair}`)
    .limit(1);
  return asset ?? null;
}

export async function getFirstAsset() {
  const [firstAsset] = await db.select().from(assets).limit(1);
  return firstAsset ?? null;
}
