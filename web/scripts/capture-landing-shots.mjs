// Captures real screenshots of the navigator for the landing bento (web/public/media/shots/*.png).
//
// Usage (from web/, with a dev server running on the cached data):
//   npx vite --port 5199 --strictPort &
//   node scripts/capture-landing-shots.mjs [--url http://localhost:5199/#/app] [--only calendar,horizon,timeline,terrain]
//
// It opens the tool in a dark colour scheme at deviceScaleFactor 2, applies the example scenario if it is not
// already applied, waits for the results and the start-date calendar, and takes element screenshots by the tool's
// existing test ids. The calendar is shot on the example start. The horizon view and timeline are shot on the
// delayed window (start 24 h later), the horizon view with the time cursor inside its long Sun interruption and the
// timeline with the cursor back at the window start so it does not cover the interruption's label.
// Last, the 3D terrain shot: Demo point A on 2027-02-17 from 06:00 UTC with the 3D time at 09:30 UTC (the moment the
// terrain e2e screenshots use: the last sample before the Sun centre is lost), Sun-direction lighting, both centres
// visible. It is a clip of the WebGL viewport only, with the "Drag to orbit" hint hidden. The viewer needs WebGL, so
// the browser launches with SwiftShader like tests/e2e/terrain.spec.ts (hardware GPUs are not used headless).
// After a run, update the width/height in src/landing/media.ts if the printed sizes changed.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHOT_NAMES = ["calendar", "horizon", "timeline", "terrain"];
const args = process.argv.slice(2);
/** The value after a flag, or undefined when the flag is absent. A flag given without a value is a usage error. */
function flagValue(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`${flag} needs a value. Usage: node scripts/capture-landing-shots.mjs [--url <app url>] [--only ${SHOT_NAMES.join(",")}]`);
    process.exit(2);
  }
  return value;
}
const url = flagValue("--url") ?? "http://localhost:5199/#/app";
const onlyArg = flagValue("--only");
const only = onlyArg === undefined ? null : new Set(onlyArg.split(",").map((s) => s.trim()).filter(Boolean));
if (only) {
  const unknown = [...only].filter((name) => !SHOT_NAMES.includes(name));
  if (unknown.length > 0 || only.size === 0) {
    console.error(`--only takes a comma-separated list of: ${SHOT_NAMES.join(", ")}${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
    process.exit(2);
  }
}
const wanted = (name) => !only || only.has(name);
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

/** Fractions of the 3D viewport kept in the terrain shot: the point, both rays and both labels, without the chips. */
const TERRAIN_CLIP = { x: 0.12, y: 0.32, w: 0.76, h: 0.64 };

async function shootTerrain(page) {
  await page.fill("#start-date", "2027-02-17");
  await page.selectOption("#start-hour", "6");
  await page.waitForFunction(() => document.querySelector(".window-line")?.textContent?.includes("2027-02-17 06:00 UTC"));
  const panel = page.locator('[data-testid="terrain-panel"]');
  if (!(await panel.textContent()).includes("Demo point A")) throw new Error("terrain shot expects Demo point A selected");
  await panel.getByRole("button", { name: "Open 3D terrain" }).click();
  await page.waitForSelector('[data-testid="terrain-canvas"][data-ready="true"]', { timeout: 90_000 });
  await panel.getByRole("radio", { name: "Sun direction" }).check();
  const slider = panel.getByRole("slider", { name: "3D mission time" });
  await slider.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 21; i++) await page.keyboard.press("ArrowRight");
  const readout = await panel.locator('[data-testid="terrain-time-readout"]').textContent();
  if (readout !== "2027-02-17 09:30 UTC") throw new Error(`terrain shot at ${readout}, expected 2027-02-17 09:30 UTC`);
  for (const body of ["sun", "earth"]) {
    const state = await panel.locator(`[data-testid="terrain-state-${body}"]`).getAttribute("data-state");
    if (state !== "visible") throw new Error(`terrain shot expects the ${body} centre visible, got ${state}`);
  }
  await page.addStyleTag({ content: ".terrain-gesture { display: none !important; }" });
  await page.evaluate(() => document.activeElement?.blur?.());
  const viewport = panel.locator(".terrain-viewport");
  await viewport.scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-testid="terrain-canvas"] canvas[data-frame-loop="idle"]', { timeout: 20_000 });
  const b = await viewport.boundingBox();
  const clip = {
    x: Math.round(b.x + b.width * TERRAIN_CLIP.x), y: Math.round(b.y + b.height * TERRAIN_CLIP.y),
    width: Math.round(b.width * TERRAIN_CLIP.w), height: Math.round(b.height * TERRAIN_CLIP.h),
  };
  const path = `${outDir}/terrain.png`;
  await page.screenshot({ path, clip, animations: "disabled" });
  console.log(`terrain: ${path} (${clip.width * 2}x${clip.height * 2} px)`);
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
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

  for (const s of SHOTS.filter((s) => wanted(s.name))) {
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
  if (wanted("terrain")) await shootTerrain(page);
} finally {
  await browser.close();
}
