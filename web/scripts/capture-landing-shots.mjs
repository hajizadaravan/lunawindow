// Captures real screenshots of the navigator for the landing bento (web/public/media/shots/*.png).
//
// Usage (from web/, with a dev server running on the cached data):
//   npx vite --port 5199 --strictPort &
//   node scripts/capture-landing-shots.mjs [--url http://localhost:5199/#/app]
//
// It opens the tool in a dark colour scheme at deviceScaleFactor 2, applies the example scenario if it is not
// already applied, waits for the results and the start-date calendar, and takes element screenshots by the tool's
// existing test ids. The calendar is shot on the example start. The horizon view and timeline are shot on the
// delayed window (start 24 h later), the horizon view with the time cursor inside its long Sun interruption and the
// timeline with the cursor back at the window start so it does not cover the interruption's label.
// After a run, update the width/height in src/landing/media.ts if the printed sizes changed.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const urlIdx = args.indexOf("--url");
const url = urlIdx >= 0 ? args[urlIdx + 1] : "http://localhost:5199/#/app";
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public/media/shots");
mkdirSync(outDir, { recursive: true });

const SHOTS = [
  { name: "calendar", selector: '[data-testid="calendar"]' },
  { name: "horizon", selector: '[data-testid="horizon-view"]' },
  { name: "timeline", selector: '[data-testid="timelines"]' },
];

/**
 * After the calendar shot: show the delayed window of the example (start 24 h later, 2027-02-11) and put the time
 * cursor 156 h in, inside its long Sun interruption, so the horizon view and timeline show the gap itself.
 */
async function showDelayedGap(page) {
  await page.fill("#start-date", "2027-02-11");
  await page.waitForTimeout(600);
  // PageUp is +24 h, Shift+ArrowRight +6 h: 156 h after the start.
  await moveCursor(page, ["PageUp", "PageUp", "PageUp", "PageUp", "PageUp", "PageUp", "Shift+ArrowRight", "Shift+ArrowRight"]);
}

async function moveCursor(page, keys) {
  await page.locator('[data-testid="time-cursor"]').focus();
  for (const k of keys) await page.keyboard.press(k);
  await page.waitForTimeout(400);
  // Drop keyboard focus so no focus ring shows in the shots (the cursor may sit on an SVG element).
  await page.evaluate(() => document.activeElement?.blur?.());
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await page.goto(url);
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 30_000 });

  // Apply the example scenario (a real, interesting state: the 24 h delay pushes the Sun gap past the 6 h limit).
  const tryDelay = page.locator('[data-testid="try-delay"]');
  if (await tryDelay.isVisible()) await tryDelay.click();
  await page.waitForSelector('[data-testid="example-tag"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="headline"]', { timeout: 30_000 });
  // Every point's calendar row has cells once all three datasets are in.
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="cal-demo-"]').length > 0, null, {
    timeout: 60_000,
  });
  await page.waitForTimeout(800);

  for (const s of SHOTS) {
    if (s.name === "horizon") await showDelayedGap(page);
    if (s.name === "timeline") await moveCursor(page, ["Home"]); // keep the "Longest" label clear of the cursor
    const el = page.locator(s.selector).first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await el.boundingBox();
    const path = `${outDir}/${s.name}.png`;
    await el.screenshot({ path, animations: "disabled" });
    console.log(`${s.name}: ${path} (about ${Math.round(box.width * 2)}x${Math.round(box.height * 2)} px; check the PNG header for the exact size)`);
  }
} finally {
  await browser.close();
}
