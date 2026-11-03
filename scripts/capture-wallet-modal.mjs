/**
 * Captures the actual Wallet/Overview Storybook UI for code-review screenshots.
 * Uses fake QR test data; NEVER use the example QR for a real payment.
 *
 * Run against a built Storybook:
 *   python3 -m http.server 6006 --directory storybook-static &
 *   node scripts/capture-wallet-modal.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.env.STORYBOOK_URL || "http://127.0.0.1:6006";
const output = resolve("docs/assets/wallet");
const shots = [
  { id: "wallet-overview--top-up-amount-preview", heading: "Add funds.", file: "paynow-modal-step-1.png" },
  { id: "wallet-overview--pay-now-qr-preview", heading: "Scan to pay.", file: "paynow-modal-step-2.png" },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const url = new URL("/iframe.html", base);
    url.searchParams.set("id", shot.id);
    url.searchParams.set("viewMode", "story");
    url.searchParams.set("globals", "theme:dark;viewport:desktop");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 90000 });
    const modal = page.getByRole("dialog", { name: "Add funds to your wallet" });
    await modal.waitFor({ state: "visible", timeout: 90000 });
    await modal.getByRole("heading", { name: shot.heading }).waitFor({ state: "visible", timeout: 90000 });
    if (shot.heading === "Scan to pay.") {
      const qr = modal.getByRole("img", { name: /PayNow QR code/ });
      await qr.waitFor({ state: "visible" });
      await qr.evaluate((image) => {
        if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) {
          throw new Error("Preview QR image was not loaded");
        }
      });
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(output, shot.file), animations: "disabled" });
    console.log(`Captured ${shot.file} from ${shot.id}`);
    await page.close();
  }
} finally {
  await browser.close();
}
