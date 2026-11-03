/** Capture actual Storybook top-up stages at representative light, dark and narrow viewports. */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.env.STORYBOOK_URL || "http://127.0.0.1:6006";
const output = resolve("docs/assets/wallet");
const waitingStory = "wallet-overview--pay-now-screenshot-capture";
const confirmedStory = "wallet-overview--pay-now-confirmed-screenshot-capture";
const shots = [
  { stage: "amount", heading: "Add funds.", theme: "light", width: 1440, height: 900, file: "paynow-modal-step-1.png" },
  { stage: "payment", heading: "Scan to pay.", theme: "light", width: 1440, height: 900, file: "paynow-modal-step-2.png" },
  { stage: "success", heading: "Payment confirmed!", theme: "light", width: 1440, height: 900, file: "paynow-modal-step-3.png" },
  { stage: "amount", heading: "Add funds.", theme: "dark", width: 1440, height: 900, file: "paynow-modal-dark-step-1.png" },
  { stage: "payment", heading: "Scan to pay.", theme: "dark", width: 1440, height: 900, file: "paynow-modal-dark-step-2.png" },
  { stage: "amount", heading: "Add funds.", theme: "light", width: 320, height: 568, file: "paynow-modal-small-phone-step-1.png" },
  { stage: "payment", heading: "Scan to pay.", theme: "light", width: 320, height: 568, file: "paynow-modal-small-phone-step-2.png" },
  { stage: "success", heading: "Payment confirmed!", theme: "light", width: 320, height: 568, file: "paynow-modal-small-phone-step-3.png" },
  { stage: "payment", heading: "Scan to pay.", theme: "light", width: 560, height: 700, file: "paynow-modal-narrow-desktop.png" },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1 });
    const url = new URL("/iframe.html", base);
    url.searchParams.set("id", shot.stage === "success" ? confirmedStory : waitingStory);
    url.searchParams.set("viewMode", "story");
    url.searchParams.set("globals", "theme:" + shot.theme + ";viewport:desktop");
    try {
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 90000 });
      const addFunds = page.getByRole("button", { name: "Add funds" });
      await addFunds.waitFor({ state: "visible", timeout: 25000 });
      await addFunds.click();
      const modal = page.getByRole("dialog", { name: "Add funds to your wallet" });
      await modal.waitFor({ state: "visible", timeout: 15000 });
      if (shot.stage !== "amount") {
        await modal.getByRole("button", { name: "Continue with PayNow" }).click();
      }
      await modal.getByRole("heading", { name: shot.heading }).waitFor({ state: "visible", timeout: 20000 });
      if (shot.stage === "payment") {
        const qr = modal.getByRole("img", { name: /PayNow QR code/ });
        await qr.waitFor({ state: "visible" });
        await qr.evaluate((image) => {
          if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) {
            throw new Error("Preview QR image was not loaded");
          }
        });
        await modal.getByRole("link", { name: /Simulate scan/ }).waitFor({ state: "visible" });
      }
      const widths = await modal.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
      if (widths.scroll > widths.client + 2) throw new Error("Horizontal modal overflow: " + JSON.stringify(widths));
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(output, shot.file), animations: "disabled" });
      console.log("Captured", shot.file, "at", shot.width + "x" + shot.height);
    } catch (error) {
      console.error("Capture failed for", shot.file, "URL:", page.url(), error);
      await page.screenshot({ path: resolve(output, "paynow-capture-debug.png"), animations: "disabled" });
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
