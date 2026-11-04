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

async function wheel(page: Page, deltaY: number, momentum = false, deltaMode = 0) {
  return timeline(page).evaluate((root, input) => {
    const event = new WheelEvent("wheel", { deltaY: input.deltaY, deltaMode: input.deltaMode, bubbles: true, cancelable: true });
    if (input.momentum) Object.defineProperty(event, "momentum", { value: true });
    return root.dispatchEvent(event);
  }, { deltaY, momentum, deltaMode });
}

async function expectCompactSelection(page: Page, day: number) {
  await expect(current(page)).toHaveAttribute("data-session-id", await row(page, day).getAttribute("data-session-id") as string);
  expect(await timeline(page).locator("[data-session-id]").evaluateAll((elements) => elements.every((element) => Number((element as HTMLElement).style.getPropertyValue("--expansion")) === 0))).toBe(true);
  await expect(timeline(page).getByRole("button", { name: "View details" })).toHaveCount(0);
  await expect(date(page, day)).toHaveAttribute("aria-expanded", "false");
}

async function markerPosition(page: Page) {
  return timeline(page).evaluate((root) => {
    const marker = root.querySelector('[data-timeline-marker]')!.getBoundingClientRect();
    const date = root.querySelector('[data-current] [data-date-control] strong')!.getBoundingClientRect();
    const top = root.getBoundingClientRect().top;
    return { dot: marker.top + marker.height / 2 - top, target: date.top + date.height / 2 - top };
  });
}

test("the dot glides between compact dates and reverses from its current position", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  await wheel(page, 10);
  await page.clock.runFor(176);
  const before = await markerPosition(page);
  await wheel(page, 14);
  await expectCompactSelection(page, 23);
  const start = await markerPosition(page);
  expect(Math.abs(start.dot - before.dot)).toBeLessThan(1);
  expect(start.dot).toBeLessThan(start.target - 20);
  const snapped = await page.evaluate(() => scrollY);
  await page.clock.runFor(80);
  const middle = await markerPosition(page);
  expect(middle.dot).toBeGreaterThan(start.dot + 10);
  expect(middle.dot).toBeLessThan(middle.target - 1);
  expect(await page.evaluate(() => scrollY)).toBe(snapped);
  await wheel(page, -40);
  const reversed = await markerPosition(page);
  expect(Math.abs(reversed.dot - middle.dot)).toBeLessThan(1);
  await page.clock.runFor(80);
  expect((await markerPosition(page)).dot).toBeLessThan(reversed.dot - 10);
  await page.clock.runFor(110);
  const landed = await markerPosition(page);
  expect(Math.abs(landed.dot - landed.target)).toBeLessThan(1);
  await expectCompactSelection(page, 21);
  await page.clock.runFor(500);
  await expectSettled(page, 21);
  await expectVisibleSelection(page);
});

test("scroll closes the old card smoothly before moving, then opens only after a pause", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  const start = await page.evaluate(() => ({ y: scrollY, height: document.documentElement.scrollHeight }));
  expect(await wheel(page, 40)).toBe(false);
  expect(await weight(page, 21)).toBe(1);
  expect(await page.evaluate(() => scrollY)).toBe(start.y);
  await page.clock.runFor(80);
  expect(await weight(page, 21)).toBeGreaterThan(0);
  expect(await weight(page, 21)).toBeLessThan(1);
  expect(await page.evaluate(() => scrollY)).toBe(start.y);
  await page.clock.runFor(96);
  await expectCompactSelection(page, 23);
  const snapped = await page.evaluate(() => scrollY);
  expect(snapped).not.toBe(start.y);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(start.height);
  await page.clock.runFor(180);
  await expectCompactSelection(page, 23);
  expect(await page.evaluate(() => scrollY)).toBe(snapped);
  await page.clock.runFor(80);
  expect(await weight(page, 23)).toBeGreaterThan(0);
  expect(await weight(page, 23)).toBeLessThan(1);
  await page.clock.runFor(300);
  await expectSettled(page, 23);
  expect(await page.evaluate(() => scrollY)).toBe(snapped);
  await expectVisibleSelection(page);
});

test("momentum postpones opening without skipping, and a fresh gesture switches again", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  await wheel(page, 40);
  await page.clock.runFor(176);
  for (const delta of [30, 15, 7, 3, 1]) {
    await page.clock.runFor(100);
    expect(await wheel(page, delta, true)).toBe(false);
    await expectCompactSelection(page, 23);
  }
  await page.clock.runFor(180);
  await expectCompactSelection(page, 23);
  await page.clock.runFor(400);
  await expectSettled(page, 23);
  await wheel(page, 40);
  await page.clock.runFor(176);
  await expectCompactSelection(page, 24);
  await page.clock.runFor(600);
  await expectSettled(page, 24);
});

test("reversal during card opening closes it and changes destination without stale movement", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  await wheel(page, 40);
  await page.clock.runFor(176);
  await page.clock.runFor(280);
  expect(await weight(page, 23)).toBeGreaterThan(0);
  expect(await weight(page, 23)).toBeLessThan(1);
  await wheel(page, -40);
  await page.clock.runFor(176);
  await expectCompactSelection(page, 21);
  const snapped = await page.evaluate(() => scrollY);
  await page.clock.runFor(180);
  await expectCompactSelection(page, 21);
  await page.clock.runFor(500);
  await expectSettled(page, 21);
  expect(await page.evaluate(() => scrollY)).toBe(snapped);
});

test("reversing while the old card closes redirects it without showing an intermediate session", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  const initial = await page.evaluate(() => scrollY);
  await wheel(page, 40);
  await page.clock.runFor(80);
  const closing = await weight(page, 21);
  await wheel(page, -40);
  expect(await weight(page, 21)).toBe(closing);
  expect(await weight(page, 23)).toBe(0);
  await page.clock.runFor(96);
  await expectCompactSelection(page, 21);
  expect(await page.evaluate(() => scrollY)).toBe(initial);
  await page.clock.runFor(500);
  await expectSettled(page, 21);
  expect(await weight(page, 23)).toBe(0);
});

test("repeated real wheel gestures switch directly between sessions", async ({ page }, testInfo) => {
  for (const [delta, day] of [[120, 23], [1600, 24], [-120, 23], [-120, 21]]) {
    await pointAtPhoto(page);
    await page.mouse.wheel(0, delta!);
    // Precise compact-state timing is covered with the paused clock above.
    // Real browser round trips can outlast that intentionally brief phase.
    await expectSettled(page, day!);
    await expectVisibleSelection(page);
  }
  await page.screenshot({ path: testInfo.outputPath("joined-direct-scroll.png") });
});

test("tiny input accumulates intent and line/page wheel units switch one session", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  await wheel(page, 10);
  await page.clock.runFor(176);
  await expectCompactSelection(page, 21);
  await wheel(page, 14);
  await expectCompactSelection(page, 23);
  await page.clock.runFor(600);
  await wheel(page, 2, false, 1);
  await page.clock.runFor(176);
  await expectCompactSelection(page, 24);
  await page.clock.runFor(600);
  await wheel(page, -.1, false, 2);
  await page.clock.runFor(176);
  await expectCompactSelection(page, 23);
});

test("reduced motion retains the pause and then opens without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  await wheel(page, 40);
  await page.clock.runFor(180);
  await expectCompactSelection(page, 23);
  await page.clock.runFor(40);
  await expectSettled(page, 23);
  await expect(timeline(page)).not.toHaveAttribute("data-timeline-transitioning");
});

test("date clicks and dialogs cancel pending scroll expansion", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  await wheel(page, 40);
  await date(page, 20).dispatchEvent("click");
  await page.clock.runFor(800);
  await expectSettled(page, 20);
  await wheel(page, 40);
  await page.clock.runFor(176);
  await expectCompactSelection(page, 21);
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.textContent = "Session details";
    document.body.append(dialog);
    dialog.showModal();
  });
  await page.clock.runFor(800);
  await page.getByRole("dialog").evaluate((element) => { (element as HTMLDialogElement).close(); element.remove(); });
  await expectSettled(page, 21);
});

test("outward gestures at the first and last sessions pass through", async ({ page }) => {
  await goToDate(page, 3);
  expect(await wheel(page, -80)).toBe(true);
  await goToDate(page, 25);
  expect(await wheel(page, 80)).toBe(true);
  const start = await page.evaluate(() => scrollY);
  await pointAtPhoto(page);
  await page.mouse.wheel(0, 80);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(start);
  const exited = await page.evaluate(() => scrollY);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => scrollY)).toBe(exited);
  await expectSettled(page, 25);
});

test("a closing boundary session retains input until its pending placement finishes", async ({ page }) => {
  await goToDate(page, 24);
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  for (const delta of [40, 20, 10, 2, 40, 40]) {
    expect(await wheel(page, delta)).toBe(false);
    await page.clock.runFor(10);
  }
  await page.clock.runFor(116);
  await expectCompactSelection(page, 25);
  await page.clock.runFor(600);
  expect(await wheel(page, 80)).toBe(true);
  await page.evaluate(() => { scrollBy(0, 40); window.dispatchEvent(new Event("scroll")); });
  const exited = await page.evaluate(() => scrollY);
  await page.clock.runFor(800);
  expect(await page.evaluate(() => scrollY)).toBe(exited);
});

test("resizing during closing, marker travel or opening cancels obsolete frames", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  for (const [width, delay, day] of [[1280, 80, 23], [1440, 240, 24], [1280, 440, 25]]) {
    await wheel(page, 40);
    await page.clock.runFor(delay!);
    await page.setViewportSize({ width: width!, height: 1024 });
    await page.clock.runFor(32);
    const resized = await page.evaluate(() => scrollY);
    await page.clock.runFor(900);
    await expectSettled(page, day!);
    await expectVisibleSelection(page);
    // WebKit can round the final resized layout by one device pixel.
    expect(Math.abs(await page.evaluate(() => scrollY) - resized)).toBeLessThan(2);
  }
});

test("diagonal wheel input does not prematurely open a pending card", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  await wheel(page, 40);
  await page.clock.runFor(176);
  await page.clock.runFor(100);
  await timeline(page).dispatchEvent("wheel", { deltaX: 100, deltaY: 10, bubbles: true, cancelable: true });
  await expectCompactSelection(page, 23);
  await page.clock.runFor(80);
  await expectCompactSelection(page, 23);
  await page.clock.runFor(400);
  await expectSettled(page, 23);
});

test("scrollbar movement collapses cards and reaches the last session without jumping back", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T00:00:01Z"));
  await page.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); window.dispatchEvent(new Event("scroll")); });
  await page.clock.runFor(32);
  await expectCompactSelection(page, 25);
  await page.clock.runFor(80);
  await page.evaluate(() => { scrollBy(0, -10); window.dispatchEvent(new Event("scroll")); });
  await page.clock.runFor(32);
  await expectCompactSelection(page, 25);
  await page.clock.runFor(600);
  await expectSettled(page, 25);
  await expectVisibleSelection(page);
  const position = await page.evaluate(() => scrollY);
  await page.clock.runFor(800);
  expect(await page.evaluate(() => scrollY)).toBe(position);
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
  await goToDate(page, 23);
  await expectVisibleSelection(page);
  expect(await timeline(page).evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length)).toBe(0);
});

test("narrow, short and tall desktop windows retain direct date selection", async ({ page }) => {
  for (const viewport of [{ width: 820, height: 900 }, { width: 1280, height: 600 }, { width: 1440, height: 1800 }]) {
    await page.setViewportSize(viewport);
    await goToDate(page, 21);
    await goToDate(page, 23);
    await goToDate(page, 21);
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

test("older-history pagination preserves the active artwork and viewport anchor before further date selection", async ({ page }) => {
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
  await goToDate(page, 20);
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
  // Measure the fixed footer after the dialog's opening transform has settled.
  await expect.poll(() => dialog.evaluate((element) => element.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"))).toBe(false);
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
