// Capture actual Wallet/Overview Storybook stories, with a mock Stripe session.
// This is only used for design review. The QR preview is intentionally unscannable.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:6006";
const screenshots = [
  ["stage-1", "wallet-overview--pay-now-amount-preview", "Add funds."],
  ["stage-2", "wallet-overview--pay-now-qr-preview", "Scan to pay."],
];

async function waitForStorybook() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${origin}/iframe.html`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Storybook did not start");
}

await waitForStorybook();
await mkdir("docs/assets/wallet", { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });

  for (const [name, storyId, heading] of screenshots) {
    const url = `${origin}/iframe.html?id=${storyId}&viewMode=story&globals=theme:dark`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    const dialog = page.getByRole("dialog", { name: "Add funds to your wallet" });
    await dialog.waitFor({ state: "visible", timeout: 30000 });
    await dialog.getByRole("heading", { name: heading }).waitFor({ state: "visible", timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    if (name === "stage-2") {
      await dialog.getByRole("img", { name: /PayNow QR code/ }).waitFor({ state: "visible" });
    }
    await page.waitForTimeout(500);
    const image = await page.screenshot({ type: "jpeg", quality: 82, animations: "disabled" });
    const file = `docs/assets/wallet/add-funds-${name}.jpg`;
    await writeFile(file, image);
    console.log(`CAPTURED ${file} (${image.length} bytes)`);
    const encoded = image.toString("base64");
    for (let n = 0; n < encoded.length; n += 2400) {
      console.log(`WALLET_IMAGE_CHUNK ${name} ${n / 2400} ${encoded.slice(n, n + 2400)}`);
    }
    console.log(`WALLET_IMAGE_COMPLETE ${name}`);
  }
} finally {
  await browser.close();
}
