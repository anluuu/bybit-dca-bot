import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!Number.isFinite(apiId) || !apiHash) {
    console.error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH before running.");
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Phone number (E.164, e.g. +5511...): "),
    password: async () => await input.text("Two-factor password (if any, else blank): "),
    phoneCode: async () => await input.text("Login code from Telegram: "),
    onError: (err) => console.error(err),
  });

  console.log("\n=== Session string (paste into Dokploy as TELEGRAM_SESSION_STRING) ===");
  console.log(client.session.save());
  console.log("=======================================================================\n");

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
