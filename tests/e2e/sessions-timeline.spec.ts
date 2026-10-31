import { expect, test, type Page } from "@playwright/test";

const timeline = (page: Page) => page.getByRole("region", { name: "Joined session timeline" });
const current = (page: Page) => timeline(page).locator('[data-current="true"]');
const date = (page: Page, day: number) => timeline(page).getByRole("button", { name: `Show Tennis Court Booking, ${day} Oct 2026`, exact: true });
const row = (page: Page, day: number) => date(page, day).locator("..");
const weight = (page: Page, day: number) => row(page, day).evaluate((el) => Number(el.style.getPropertyValue("--expansion")));

async function pointAtPhoto(page: Page) {
  const bounds = await current(page).locator('[data-timeline-reveal="hero"]').boundingBox();
  if (!bounds) throw new Error("The selected session photo is missing");
  await page.mouse.move(bounds.x + bounds.width / 2, Math.max(210, Math.min(bounds.y + 60, page.viewportSize()!.height - 30)));
}

async function expectSettled(page: Page, day: number) {
  await expect(date(page, day)).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => weight(page, day)).toBe(1);
  await expect(current(page)).toHaveCount(1);
  const others = timeline(page).locator('[data-session-id]:not([data-current="true"])');
  expect(await others.evaluateAll((elements) => elements.every((element) => element instanceof HTMLElement && Number(element.style.getPropertyValue("--expansion")) === 0))).toBe(true);
  await expect(current(page).locator("[data-timeline-feature]")).not.toHaveAttribute("inert");
  await expect(current(page).getByRole("button", { name: "View details" })).toBeVisible();
}

async function goToDate(page: Page, day: number) {
  await date(page, day).evaluate((button) => button.focus({ preventScroll: true }));
  await page.keyboard.press("Enter");
  await expectSettled(page, day);
}

// Gesture boundaries are intentional input, rather than a wait for animation.
async function freshGesture(page: Page, delta: number) {
  await page.waitForTimeout(240);
  await pointAtPhoto(page);
  await page.mouse.wheel(0, delta);
}

async function expectVisibleSelection(page: Page) {
  const bounds = await current(page).evaluate((el) => {
    const feature = el.querySelector('[data-timeline-expanded]')!.getBoundingClientRect();
    const day = el.querySelector('[data-date-control] strong')!.getBoundingClientRect();
    const marker = el.closest('[role="region"]')!.querySelector('[data-timeline-marker]')!.getBoundingClientRect();
    const header = el.closest('[data-view]')!.querySelector('header')!.getBoundingClientRect();
    return { top: feature.top, bottom: feature.bottom, header: header.bottom, height: innerHeight,
      markerCenter: marker.top + marker.height / 2, dayCenter: day.top + day.height / 2 };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.header + 27);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
  expect(Math.abs(bounds.markerCenter - bounds.dayCenter)).toBeLessThan(2);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  // Real AppShell, view and Zustand provider with a deterministic chronological feed.
  await page.goto("/storybook/iframe.html?id=sessions-overview--desktop-wheel-navigation&viewMode=story");
  // WebKit may take longer than the default 5s for the staged entrance animations.
  await expect(timeline(page)).toHaveAttribute("data-timeline-entrance", "complete", { timeout: 15_000 });
  await expectSettled(page, 21);
});

test("one wheel gesture glides to one full card with stable document height", async ({ page }, testInfo) => {
  await pointAtPhoto(page);
  await timeline(page).evaluate((root) => {
    const frames: { weights: number[]; height: number; documentHeight: number; y: number }[] = [];
    const end = performance.now() + 900;
    Object.defineProperty(window, "timelineFrames", { value: frames });
    const sample = () => {
      frames.push({ weights: Array.from(root.querySelectorAll<HTMLElement>("[data-session-id]"), (element) => Number(element.style.getPropertyValue("--expansion"))),
        height: root.getBoundingClientRect().height, documentHeight: document.documentElement.scrollHeight, y: scrollY });
      if (performance.now() < end) requestAnimationFrame(sample);
    };
    sample();
  });
  await page.mouse.wheel(0, 368);
  await expectSettled(page, 23);
  const frames = await page.evaluate(() => Reflect.get(window, "timelineFrames") as { weights: number[]; height: number; documentHeight: number; y: number }[]);
  expect(frames.some(({ weights }) => weights.some((value) => value > .05 && value < .95))).toBe(true);
  expect(new Set(frames.map(({ y }) => y)).size).toBeGreaterThan(2);
  for (const frame of frames) {
    expect(frame.weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
    expect(frame.height).toBeCloseTo(frames[0]!.height, 0);
    expect(frame.documentHeight).toBe(frames[0]!.documentHeight);
  }
  await expectVisibleSelection(page);
  await page.screenshot({ path: testInfo.outputPath("joined-gesture-settled.png") });
});

test("momentum beyond animation completion stays one gesture, then fresh gestures repeat and reverse", async ({ page }) => {
  await pointAtPhoto(page);
  // A continuous tail lasts over twice the 280 ms glide. Each gap is below the
  // 220 ms quiet boundary, including the tiny final deltas.
  // Keep wheel intervals inside the browser event loop. Playwright RPC and CI
  // scheduling can stretch 65ms into >220ms and falsely split one gesture.
  await timeline(page).evaluate(async (root) => {
    for (const delta of [40, 32, 24, 18, 12, 8, 6, 4, 2, 1]) {
      const target = root.querySelector<HTMLElement>('[data-current="true"] [data-timeline-reveal="hero"]');
      if (!target) throw new Error("No active session photo for the wheel gesture");
      const consumed = !target.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true, cancelable: true }));
      if (!consumed) throw new Error("Timeline did not consume the current wheel burst");
      await new Promise<void>((resolve) => setTimeout(resolve, 65));
    }
  });
  await expectSettled(page, 23);
  await freshGesture(page, 80);
  await expectSettled(page, 24);
  await freshGesture(page, -80);
  await expectSettled(page, 23);
});

test("tiny input does not select and a deliberate 24 px gesture does", async ({ page }) => {
  await pointAtPhoto(page);
  for (const delta of [1, 2, -1, 2]) await page.mouse.wheel(0, delta);
  await expectSettled(page, 21);
  await page.waitForTimeout(240);
  await page.mouse.wheel(0, 12);
  await expect(date(page, 21)).toHaveAttribute("aria-expanded", "true");
  await page.mouse.wheel(0, 12);
  await expectSettled(page, 23);
});

test("plain document scrolling preserves the selected full card", async ({ page }) => {
  const start = await page.evaluate(() => scrollY);
  await page.evaluate((top) => { document.scrollingElement!.scrollTop = top + 256; }, start);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(start + 256, 0);
  await page.waitForTimeout(350);
  await expectSettled(page, 21);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(start + 256, 0);
});

test("native scroll takeover cancels an unfinished seek without a stale reposition", async ({ page }) => {
  await date(page, 21).evaluate((button) => button.focus({ preventScroll: true }));
  const position = await page.evaluate(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    document.scrollingElement!.scrollTop = window.scrollY + 73;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return window.scrollY;
  });
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
  const weights = await timeline(page).locator("[data-session-id]").evaluateAll((elements) => elements.map((element) => Number((element as HTMLElement).style.getPropertyValue("--expansion"))));
  expect(weights.filter((value) => value === 1)).toHaveLength(1);
  expect(weights.every((value) => value === 0 || value === 1)).toBe(true);
});

test("fresh outward gestures at the first and last sessions scroll the page", async ({ page }) => {
  await page.locator("main").evaluate((main) => {
    const footer = document.createElement("div");
    footer.style.height = "1000px";
    main.append(footer);
  });
  await goToDate(page, 3);
  await page.evaluate(() => { document.scrollingElement!.scrollTop = 50; });
  await freshGesture(page, -80);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expectSettled(page, 3);
  await goToDate(page, 25);
  const lastStop = await page.evaluate(() => scrollY);
  await goToDate(page, 24);
  await pointAtPhoto(page);
  for (const delta of [80, 40, 24, 12, 6, 2]) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(65);
  }
  await expectSettled(page, 25);
  const settled = await page.evaluate(() => scrollY);
  expect(settled).toBeCloseTo(lastStop, 0);
  // Landing on the final card does not leak the original gesture's momentum
  // into the page; only a fresh outward gesture scrolls beyond the timeline.
  await freshGesture(page, 100);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(settled + 90);
  await expectSettled(page, 25);
  await freshGesture(page, -80);
  await expectSettled(page, 24);
});

test("nested scrollers, open dialogs, horizontal wheels and pinch gestures keep their own input", async ({ page }) => {
  await current(page).evaluate((element) => {
    const scroller = document.createElement("div");
    scroller.setAttribute("data-test-scroller", "");
    scroller.style.cssText = "position:fixed;z-index:10;left:600px;top:300px;width:200px;height:100px;overflow:auto;overscroll-behavior:contain;background:white";
    scroller.innerHTML = '<div style="height:500px">Nested content</div>';
    element.append(scroller);
  });
  const start = await page.evaluate(() => scrollY);
  const scroller = page.locator("[data-test-scroller]");
  await scroller.hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(start);
  await expectSettled(page, 21);
  await scroller.evaluate((element) => element.remove());
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = '<div style="height:1500px">Session details</div>';
    dialog.style.cssText = "height:300px;width:400px;overflow:auto";
    document.body.append(dialog);
    dialog.showModal();
  });
  await page.getByRole("dialog").hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.getByRole("dialog").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("dialog").evaluate((element) => { if (element instanceof HTMLDialogElement) element.close(); element.remove(); });
  const accepted = await timeline(page).evaluate((root) => [
    root.dispatchEvent(new WheelEvent("wheel", { deltaX: 100, deltaY: 10, bubbles: true, cancelable: true })),
    root.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true })),
  ]);
  expect(accepted).toEqual([true, true]);
  await expectSettled(page, 21);
});

test("keyboard, date and collapsed-row navigation select and focus their intended session", async ({ page }) => {
  await date(page, 21).focus();
  await page.keyboard.press("ArrowDown");
  await expect(date(page, 23)).toBeFocused();
  await expectSettled(page, 23);
  await page.keyboard.press("PageUp");
  await expect(date(page, 21)).toBeFocused();
  await expectSettled(page, 21);
  await page.keyboard.press("Home");
  await expectSettled(page, 3);
  await page.keyboard.press("End");
  await expectSettled(page, 25);
  await expect(date(page, 25)).toBeFocused();
  await goToDate(page, 21);
  await row(page, 23).getByRole("button", { name: "Expand Tennis Court Booking at Bishan Tennis Centre" }).click();
  await expectSettled(page, 23);
  await expect(date(page, 23)).toBeFocused();
});

test("new keyboard and date targets replace a running transition", async ({ page }) => {
  await date(page, 21).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expectSettled(page, 24);
  await expect(date(page, 24)).toBeFocused();
  await page.evaluate(async () => {
    const root = document.querySelector('[aria-label="Joined session timeline"]')!;
    const control = (day: number) => root.querySelector<HTMLButtonElement>(`[aria-label="Show Tennis Court Booking, ${day} Oct 2026"]`)!;
    control(3).click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    control(20).click();
  });
  await expectSettled(page, 20);
  const position = await page.evaluate(() => scrollY);
  await page.waitForTimeout(350);
  await expectSettled(page, 20);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
});

test("the reference desktop keeps compact neighbors and one accessible feature", async ({ page }) => {
  await goToDate(page, 24);
  await expectVisibleSelection(page);
  const layout = await timeline(page).evaluate((root) => {
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-session-id]"));
    const index = rows.findIndex((element) => element.hasAttribute("data-current"));
    const previous = rows[index - 1]!.getBoundingClientRect();
    const next = rows[index + 1]!.getBoundingClientRect();
    const header = root.closest('[data-view]')!.querySelector('header')!.getBoundingClientRect();
    return { previousTop: previous.top, previousBottom: previous.bottom, nextBottom: next.bottom, header: header.bottom, height: innerHeight };
  });
  expect(layout.previousTop).toBeGreaterThanOrEqual(layout.header + 27);
  expect(layout.previousBottom - layout.previousTop).toBeCloseTo(112, 0);
  expect(layout.nextBottom).toBeLessThanOrEqual(layout.height);
  await expect(timeline(page).getByRole("button", { name: "View details" })).toHaveCount(1);
  const hiddenFeatures = timeline(page).locator('[data-session-id]:not([data-current]) [data-timeline-feature]');
  expect(await hiddenFeatures.evaluateAll((elements) => elements.every((element) => element.hasAttribute("inert") && element.getAttribute("aria-hidden") === "true"))).toBe(true);
});

test("reduced motion selects immediately with a synchronized marker and date", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await pointAtPhoto(page);
  await page.mouse.wheel(0, 40);
  await expectSettled(page, 23);
  await expectVisibleSelection(page);
  expect(await timeline(page).evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length)).toBe(0);
});

test("narrow, short and tall desktop windows advance on their first qualifying gesture", async ({ page }) => {
  for (const viewport of [{ width: 820, height: 900 }, { width: 1280, height: 600 }, { width: 1440, height: 1800 }]) {
    await page.setViewportSize(viewport);
    await goToDate(page, 21);
    await freshGesture(page, 40);
    await expectSettled(page, 23);
    await freshGesture(page, -40);
    await expectSettled(page, 21);
  }
});

test("mobile Joined keeps native list scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(timeline(page)).toBeHidden();
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole("list", { name: "Joined sessions" }).getByRole("button").first().hover();
  await page.mouse.wheel(0, 150);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
});

test("a date retarget continues from the current visual state without an endpoint jump", async ({ page }) => {
  const retarget = await timeline(page).evaluate(async (root) => {
    const control = (day: number) => root.querySelector<HTMLButtonElement>(`[aria-label="Show Tennis Court Booking, ${day} Oct 2026"]`)!;
    const snapshot = () => ({
      y: scrollY,
      height: root.getBoundingClientRect().height,
      weights: Array.from(root.querySelectorAll<HTMLElement>("[data-session-id]"), (element) => Number(element.style.getPropertyValue("--expansion"))),
    });
    control(3).click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const before = snapshot();
    control(20).click();
    // React may publish the new selected ID here; the current geometry must
    // survive until the replacement animation contributes its first frame.
    await Promise.resolve();
    const immediate = snapshot();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { before, immediate, moving: snapshot() };
  });
  expect(retarget.before.weights.some((value) => value > 0 && value < 1)).toBe(true);
  expect(retarget.immediate.weights).toEqual(retarget.before.weights);
  expect(retarget.immediate.y).toBe(retarget.before.y);
  expect(retarget.moving.weights.filter((value) => value > 0 && value < 1)).toHaveLength(3);
  expect(retarget.moving.weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
  expect(retarget.moving.height).toBeCloseTo(retarget.before.height, 0);
  await expectSettled(page, 20);
  await expectVisibleSelection(page);
  const settled = await page.evaluate(() => scrollY);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => scrollY)).toBe(settled);
});

test("resizing during a glide settles a full visible session without a late scroll write", async ({ page }) => {
  const moving = await timeline(page).evaluate(async (root) => {
    root.querySelector<HTMLButtonElement>('[aria-label="Show Tennis Court Booking, 25 Oct 2026"]')!.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return root.hasAttribute("data-timeline-transitioning") && Array.from(root.querySelectorAll<HTMLElement>("[data-session-id]")).some((element) => {
      const expansion = Number(element.style.getPropertyValue("--expansion"));
      return expansion > 0 && expansion < 1;
    });
  });
  expect(moving).toBe(true);
  await page.setViewportSize({ width: 1280, height: 600 });
  await expectSettled(page, 25);
  await expectVisibleSelection(page);
  const settled = await page.evaluate(() => scrollY);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(settled, 0);
  await expectSettled(page, 25);
});

test("line and page wheel units reach the same one-session navigation", async ({ page }) => {
  for (const wheel of [{ deltaMode: 1, deltaY: 2 }, { deltaMode: 2, deltaY: .1 }]) {
    await goToDate(page, 21);
    await page.waitForTimeout(240);
    const passed = await timeline(page).evaluate((root, input) => root.dispatchEvent(new WheelEvent("wheel", { ...input, bubbles: true, cancelable: true })), wheel);
    expect(passed).toBe(false);
    await expectSettled(page, 23);
  }
});

test("positive momentum never starts navigation and a late owned tail remains consumed", async ({ page }) => {
  const momentum = () => timeline(page).evaluate((root) => {
    const event = new WheelEvent("wheel", { deltaY: 500, bubbles: true, cancelable: true });
    // Exercise the feature-detected path on both engines, including engines
    // that do not yet expose a native momentum property.
    Object.defineProperty(event, "momentum", { value: true });
    return root.dispatchEvent(event);
  });
  expect(await momentum()).toBe(true);
  await expectSettled(page, 21);
  await freshGesture(page, 40);
  await expectSettled(page, 23);
  await page.waitForTimeout(240);
  expect(await momentum()).toBe(false);
  await page.waitForTimeout(350);
  await expectSettled(page, 23);
});

test("a fresh gesture during a glide queues one neighboring session and consumes its tail", async ({ page }) => {
  // Control animation frames and input timestamps together: 240 ms is a fresh
  // gesture after the 220 ms quiet gap, while the 280 ms glide is still running.
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  const wheel = (deltaY: number) => timeline(page).evaluate((root, delta) => root.dispatchEvent(new WheelEvent("wheel", {
    deltaY: delta, bubbles: true, cancelable: true,
  })), deltaY);
  expect(await wheel(40)).toBe(false);
  await page.clock.runFor(240);
  await expect(date(page, 23)).toHaveAttribute("aria-expanded", "true");
  await expect(timeline(page)).toHaveAttribute("data-timeline-transitioning");
  expect(await weight(page, 23)).toBeGreaterThan(0);
  expect(await weight(page, 23)).toBeLessThan(1);

  expect(await wheel(40)).toBe(false);
  // The new gesture waits for the first destination instead of replacing it.
  await expect(date(page, 23)).toHaveAttribute("aria-expanded", "true");
  await expect(date(page, 24)).toHaveAttribute("aria-expanded", "false");
  for (const delta of [30, 20, 12, 8, 4, 1]) {
    await page.clock.runFor(80);
    expect(await wheel(delta)).toBe(false);
  }
  await page.clock.runFor(300);
  await expectSettled(page, 24);
  await expect(date(page, 25)).toHaveAttribute("aria-expanded", "false");
});

test("older-history pagination preserves the active artwork and viewport anchor before further gestures", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Observe the real page insertion before Storybook's play function releases
  // its pending feed. The browser test owns these independent geometry checks.
  await page.addInitScript(() => {
    // The static iframe's eager sentinel can request history before the story
    // clicks its button. Keep this fixture on its explicit pagination path.
    const NativeIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeIntersectionObserver {
      observe(target: Element) {
        if (target.querySelector("button")?.textContent === "Load more sessions") return;
        super.observe(target);
      }
    };
    const snapshots: { count: number; id: string | undefined; top: number; artwork: string | null }[] = [];
    Reflect.set(window, "paginationSnapshots", snapshots);
    new MutationObserver(() => {
      const root = document.querySelector('[aria-label="Joined session timeline"][data-timeline-entrance="complete"]');
      const active = root?.querySelector<HTMLElement>("[data-session-id][data-current]");
      if (!root || !active) return;
      snapshots.push({ count: root.querySelectorAll("[data-session-id]").length, id: active.dataset.sessionId,
        top: active.getBoundingClientRect().top, artwork: active.querySelector("[data-timeline-expanded] img")?.getAttribute("src") ?? null });
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-timeline-entrance", "data-current"] });
  });
  const story = "sessions-overview-loading--older-history-preserves-timeline-anchor";
  await page.goto(`/storybook/iframe.html?id=${story}&viewMode=story`);
  await expect.poll(() => page.evaluate((id) => Reflect.get(window, "__STORYBOOK_PREVIEW__")?.storyRenders?.some((render: { id: string; phase: string }) => render.id === id && render.phase === "finished"), story)).toBe(true);
  await expect(timeline(page).locator("[data-session-id]")).toHaveCount(10);
  await expectSettled(page, 21);
  const anchors = await page.evaluate(() => {
    const snapshots = Reflect.get(window, "paginationSnapshots") as { count: number; id: string; top: number; artwork: string | null }[];
    return { before: snapshots.filter(({ count }) => count === 6).at(-1), after: snapshots.find(({ count }) => count === 10) };
  });
  expect(anchors.before).toBeDefined();
  expect(anchors.after).toBeDefined();
  expect(anchors.after!.id).toBe(anchors.before!.id);
  expect(anchors.after!.artwork).toBe(anchors.before!.artwork);
  expect(Math.abs(anchors.after!.top - anchors.before!.top)).toBeLessThan(2);
  await expect(page.getByRole("button", { name: "Load more sessions", exact: true })).toHaveCount(0);
  await freshGesture(page, -40);
  await expectSettled(page, 20);
  await expect(timeline(page)).toHaveAttribute("data-timeline-entrance", "complete");
});

test("URL-restored session details keep native pane scrolling and restore focus", async ({ page }) => {
  const story = "sessions-overview-loading--url-restores-session-and-panel-across-pages";
  await page.goto(`/storybook/iframe.html?id=${story}&viewMode=story`);
  // Wait for the user-visible loaded feed, not a private Storybook phase.
  await expect(timeline(page).locator("[data-session-id]")).toHaveCount(10, { timeout: 15_000 });
  await expectSettled(page, 10);
  expect(new URL(page.url()).searchParams.get("session")).toBe("54000000-0000-4000-8000-000000000008");
  expect(new URL(page.url()).searchParams.get("panel")).toBe("participants");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The editorial layout scrolls its details pane, not the dialog itself,
  // so its footer and artwork remain fixed as the content moves.
  await page.setViewportSize({ width: 1280, height: 420 });
  const trigger = current(page).getByRole("button", { name: "View details" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Tennis Court Booking" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Participants (3)" })).toHaveAttribute("aria-selected", "true");
  const content = dialog.getByTestId("session-details-scroll");
  await expect.poll(() => content.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  const calendarButton = dialog.getByRole("link", { name: /View in calendar/ });
  const footerTop = await calendarButton.evaluate((element) => element.getBoundingClientRect().top);
  const documentTop = await page.evaluate(() => scrollY);
  await content.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await calendarButton.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(footerTop, 0);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(documentTop, 0);
  // Radix correctly hides the background from role queries while the modal is
  // open; inspect its inert visual state without treating it as accessible UI.
  expect(await page.locator('[aria-label="Joined session timeline"] [data-session-id][data-current]').evaluate((element) => Number((element as HTMLElement).style.getPropertyValue("--expansion")))).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expectSettled(page, 10);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(documentTop, 0);
  expect(new URL(page.url()).searchParams.get("panel")).toBe("participants");
});

test("a short feed can align its final session in a tall viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  await page.goto("/storybook/iframe.html?id=sessions-overview--chronological-timeline&viewMode=story");
  await expect(timeline(page)).toHaveAttribute("data-timeline-entrance", "complete");
  await expectSettled(page, 21);
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await goToDate(page, 22);
  await expectVisibleSelection(page);
  const layout = await row(page, 21).evaluate((previous) => ({
    previousTop: previous.getBoundingClientRect().top,
    previousHeight: previous.getBoundingClientRect().height,
    header: previous.closest('[data-view]')!.querySelector("header")!.getBoundingClientRect().bottom,
    y: scrollY,
    documentHeight: document.documentElement.scrollHeight,
  }));
  // Spare flex space must not absorb the tail required to reach this stop.
  expect(layout.y).toBeGreaterThan(0);
  expect(layout.previousTop).toBeCloseTo(layout.header + 28, 0);
  expect(layout.previousHeight).toBeCloseTo(112, 0);
  expect(layout.documentHeight).toBe(documentHeight);
});
