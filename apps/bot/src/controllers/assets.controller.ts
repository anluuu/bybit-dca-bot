import { listAssets } from "../services/assets.service.js";

export async function listAssetsHandler() {
  return listAssets();
}
