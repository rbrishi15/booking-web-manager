/** Capture the actual Storybook modal in dark mode for PR review. No payment credentials are needed. */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.env.STORYBOOK_URL || "http://127.0.0.1:6006";
const output = resolve("docs/assets/wallet");
const storyId = "wallet-overview--pay-now-screenshot-capture";
const shots = [
  { step: 1, heading: "Add funds.", file: "paynow-modal-step-1.png" },
  { step: 2, heading: "Scan to pay.", file: "paynow-modal-step-2.png" },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const url = new URL("/iframe.html", base);
    url.searchParams.set("id", storyId);
    url.searchParams.set("viewMode", "story");
    url.searchParams.set("globals", "theme:dark;viewport:desktop");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 90000 });
    try {
      const addFunds = page.getByRole("button", { name: "Add funds" });
      await addFunds.waitFor({ state: "visible", timeout: 25000 });
      await addFunds.click();
      const modal = page.getByRole("dialog", { name: "Add funds to your wallet" });
      await modal.waitFor({ state: "visible", timeout: 15000 });
      if (shot.step === 2) {
        await modal.getByRole("button", { name: "Continue with PayNow" }).click();
      }
      await modal.getByRole("heading", { name: shot.heading }).waitFor({ state: "visible", timeout: 20000 });
      if (shot.step === 2) {
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
      console.log(`Captured ${shot.file} with Storybook at ${url}`);
    } catch (error) {
      console.error("Capture failed for", shot.file, "URL:", page.url());
      console.error("Storybook title:", await page.title());
      console.error("Visible page:", (await page.locator("body").innerText()).slice(0, 2400));
      await page.screenshot({ path: resolve(output, "paynow-capture-debug.png"), animations: "disabled" });
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
