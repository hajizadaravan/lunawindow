import { expect, test, type Page } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
test.skip(process.env.VITE_DATA_DIR === "data-synthetic", "Real models intentionally unavailable for synthetic data");

// Real demo-a data, terrain horizon: the Sun centre is lost at 2027-02-17 09:30:47 UTC (an 8.9 h gap). With the
// window starting 06:00 the last visible sample is index 21 (09:30) and the first blocked one is index 22 (09:40).
const DATE = "2027-02-17";
// Software WebGL parsing and hashing a 7 MB model is slow when the suite runs workers in parallel.
const READY_MS = 60_000;
test.describe.configure({ timeout: 120_000 });
const LAST_VISIBLE = 21;

function watch(page: Page) {
  const errors: string[] = [];
  const outside: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", req => { if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(req.url()).hostname)) outside.push(req.url()); });
  return { errors, outside };
}

async function openTerrain(page: Page, date = DATE, hour = "6") {
  await page.goto("/#/app");
  await page.getByLabel("Start date (UTC)").fill(date);
  await page.getByLabel("Start hour (UTC)").selectOption(hour);
  await expect(page.locator(".window-line")).toContainText(`${date} ${hour.padStart(2, "0")}:00 UTC`);
  await page.getByRole("button", { name: "Open 3D terrain" }).click();
  await expect(page.getByTestId("terrain-canvas")).toHaveAttribute("data-ready", "true", { timeout: READY_MS });
  await expect(page.getByTestId("terrain-canvas").locator("canvas")).toBeVisible();
}

const canvas = (page: Page) => page.getByTestId("terrain-canvas").locator("canvas");
const slider = (page: Page) => page.getByRole("slider", { name: "3D mission time" });

async function stepSlider(page: Page, key: string, times = 1) {
  await slider(page).focus();
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

async function settled(page: Page) {
  await expect(canvas(page)).toHaveAttribute("data-frame-loop", "idle", { timeout: 10_000 });
}

const framesDrawn = async (page: Page) => Number(await canvas(page).getAttribute("data-frames"));

/** A camera button starts a short glide. The "running" flag lasts only as long as the glide, so wait on the frame
 *  counter instead (it only grows), then on the loop stopping. */
async function clickView(page: Page, name: string) {
  const before = await framesDrawn(page);
  await page.getByRole("button", { name, exact: true }).click();
  await expect.poll(() => framesDrawn(page), { timeout: 10_000 }).toBeGreaterThan(before);
  await settled(page);
}

test("scene state follows the analysis at a real Sun-centre loss, and the shared cursor follows the scene", async ({ page }) => {
  const seen = watch(page);
  await openTerrain(page);
  const sun = page.getByTestId("terrain-state-sun");
  const time = page.getByTestId("terrain-time-readout");
  const cursorReadout = page.getByTestId("cursor-readout");
  await expect(page.getByTestId("terrain-panel")).toContainText("Horizon: Terrain (LOLA)");
  await expect(page.getByTestId("terrain-panel")).toContainText("Cast shadows are not simulated");

  // The strip shows the same loss as the timelines.
  await expect(page.getByTestId("terrain-strip").locator('g[data-body="sun"] rect[data-state="blocked"]').first()).toBeAttached();

  await stepSlider(page, "ArrowRight", LAST_VISIBLE);
  await expect(time).toHaveText(`${DATE} 09:30 UTC`);
  await expect(sun).toHaveAttribute("data-state", "visible");
  await expect(sun).toContainText("Centre visible");
  await expect(canvas(page)).toHaveAttribute("data-sun-state", "visible");
  await expect(cursorReadout).toContainText("Sun visible");
  await expect(page.getByTestId("time-cursor")).toHaveAttribute("aria-valuenow", String(LAST_VISIBLE));

  await page.keyboard.press("ArrowRight");
  await expect(time).toHaveText(`${DATE} 09:40 UTC`);
  await expect(sun).toHaveAttribute("data-state", "blocked");
  await expect(sun).toContainText("Centre blocked");
  await expect(canvas(page)).toHaveAttribute("data-sun-state", "blocked");
  await expect(cursorReadout).toContainText("Sun blocked");
  await expect(page.getByTestId("horizon-readout")).toContainText(`${DATE} 09:40 UTC`);

  // Playback through the loss: start one hour before it at 1 h of mission time per second.
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("1");
  await stepSlider(page, "ArrowLeft", 7);
  await expect(sun).toHaveAttribute("data-state", "visible");
  await expect(page.getByTestId("terrain-lighting-tag")).toHaveText("SUN DIRECTION · LIVE"); // the default
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await expect(canvas(page)).toHaveAttribute("data-frame-loop", "running");
  await expect(sun).toHaveAttribute("data-state", "blocked", { timeout: 15_000 });
  await expect(canvas(page)).toHaveAttribute("data-sun-state", "blocked");
  await expect.poll(async () => Number(await page.getByTestId("time-cursor").getAttribute("aria-valuenow"))).toBeGreaterThan(LAST_VISIBLE);

  // Pause: the loop stops and every view rests on the same sample.
  await page.getByRole("button", { name: "Pause terrain time" }).click();
  await settled(page);
  // Pausing publishes the exact sample; the timelines catch up to the 3D slider and then both stay put.
  await expect.poll(async () => (await page.getByTestId("time-cursor").getAttribute("aria-valuenow")) === (await slider(page).inputValue())).toBe(true);
  const shown = await time.innerText();
  await expect(cursorReadout).toContainText(shown);
  await expect(page.getByTestId("horizon-readout")).toContainText(shown);
  const cursorAfterPause = await page.getByTestId("time-cursor").getAttribute("aria-valuenow");
  await page.waitForTimeout(500);
  await expect(page.getByTestId("time-cursor")).toHaveAttribute("aria-valuenow", cursorAfterPause!);

  // Scrubbing pauses playback.
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("6");
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await expect(page.getByRole("button", { name: "Pause terrain time" })).toBeVisible();
  await stepSlider(page, "Home");
  await expect(page.getByRole("button", { name: "Play terrain time" })).toBeVisible();
  await settled(page);
  await expect(time).toHaveText(`${DATE} 06:00 UTC`);

  // Dragging the shared timeline cursor while playing also pauses and the scene follows it.
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await page.getByTestId("time-cursor").focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Play terrain time" })).toBeVisible();
  await expect(slider(page)).toHaveValue("1008");

  // An outside move back to the very sample playback started from is still an outside move: it pauses, and
  // nothing drags the shared cursor forward again afterwards.
  await page.keyboard.press("Home");
  await expect(slider(page)).toHaveValue("0");
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("6");
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await expect.poll(async () => Number(await page.getByTestId("time-cursor").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await page.getByTestId("time-cursor").focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("button", { name: "Play terrain time" })).toBeVisible();
  await expect(slider(page)).toHaveValue("0");
  await expect(time).toHaveText(`${DATE} 06:00 UTC`);
  await page.waitForTimeout(600); // longer than two publish intervals
  await expect(page.getByTestId("time-cursor")).toHaveAttribute("aria-valuenow", "0");
  await expect(slider(page)).toHaveValue("0");
  await settled(page);
  // A new start hour while playing is an outside change too: playback stops, both views rest on one sample of
  // the new window and nothing moves afterwards (the app keeps the cursor's index on a start change).
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await expect.poll(async () => Number(await page.getByTestId("time-cursor").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await page.getByLabel("Start hour (UTC)").selectOption("7");
  await expect(page.getByRole("button", { name: "Play terrain time" })).toBeVisible();
  await settled(page);
  const restedOn = await slider(page).inputValue();
  // The panel shows that sample of the new window (10-minute samples from 07:00).
  const restedAt = new Date(Date.parse(`${DATE}T07:00:00Z`) + Number(restedOn) * 600_000).toISOString();
  await expect(time).toHaveText(`${restedAt.slice(0, 10)} ${restedAt.slice(11, 16)} UTC`);
  await expect(page.getByTestId("time-cursor")).toHaveAttribute("aria-valuenow", restedOn);
  await page.waitForTimeout(600); // longer than two publish intervals
  await expect(slider(page)).toHaveValue(restedOn);
  await expect(page.getByTestId("time-cursor")).toHaveAttribute("aria-valuenow", restedOn);
  await page.getByLabel("Start hour (UTC)").selectOption("6");
  await page.getByTestId("time-cursor").focus();
  await page.keyboard.press("End");
  await expect(slider(page)).toHaveValue("1008");

  // Play at the end replays from the start; it stops by itself at the end.
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("24");
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await expect.poll(async () => Number(await slider(page).inputValue())).toBeLessThan(500);
  await expect(page.getByRole("button", { name: "Play terrain time" })).toBeVisible({ timeout: 30_000 });
  await expect(slider(page)).toHaveValue("1008");
  await settled(page);

  // Hiding the tab pauses.
  await stepSlider(page, "Home");
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("button", { name: "Play terrain time" })).toBeVisible();
  await page.evaluate(() => { delete (document as { hidden?: boolean }).hidden; });
  await settled(page);

  expect(seen.errors).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test("lighting choice, camera views, site change and close", async ({ page }) => {
  test.setTimeout(4 * READY_MS); // three model loads, each allowed READY_MS
  const seen = watch(page);
  await openTerrain(page);
  await settled(page); // the settle-in glide ends and the loop stops
  // A lighting picked by hand is kept when playback starts.
  await page.getByRole("radio", { name: "Fixed relief" }).check();
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await expect(page.getByTestId("terrain-lighting-tag")).toHaveText("RELIEF LIGHT · FIXED");
  await page.getByRole("button", { name: "Pause terrain time" }).click();
  await page.getByRole("radio", { name: "Sun direction" }).check();
  await expect(page.getByTestId("terrain-lighting-tag")).toHaveText("SUN DIRECTION · LIVE");
  await expect(page.getByTestId("terrain-panel")).toContainText("Surface shading follows the Sun direction");
  await expect(page.getByTestId("terrain-panel")).toContainText("Cast shadows are not simulated");

  for (const name of ["Top view", "Face Earth", "Face Sun", "Reset view"]) await clickView(page, name);

  // Geometric mode keeps the mode tag and the note.
  await page.getByRole("radio", { name: /Geometric/ }).check();
  await expect(page.getByTestId("terrain-panel")).toContainText("Horizon: Geometric reference (no terrain)");
  await expect(page.getByTestId("terrain-panel")).toContainText("flat 0° geometric horizon");

  // A new coordinate must never be shown over a model from the previous point.
  await page.getByRole("button", { name: "Play terrain time" }).click();
  const points = page.getByRole("radiogroup", { name: "Demonstration point" }).getByRole("radio");
  for (const index of [1, 2]) {
    await points.nth(index).check();
    await expect(page.getByRole("button", { name: "Open 3D terrain" })).toBeVisible({ timeout: READY_MS });
    await expect(page.getByTestId("terrain-panel").locator("canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "Open 3D terrain" }).click();
    await expect(page.getByTestId("terrain-canvas")).toHaveAttribute("data-ready", "true", { timeout: READY_MS });
  }
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await page.getByRole("button", { name: "Close 3D view" }).click();
  await expect(page.getByTestId("terrain-panel").locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open 3D terrain" })).toBeVisible();
  expect(seen.errors).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test("reduced motion snaps the camera but keeps user-started playback", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTerrain(page);
  await settled(page);
  await page.getByRole("button", { name: "Top view", exact: true }).click();
  await settled(page);
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await expect.poll(async () => Number(await slider(page).inputValue())).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause terrain time" }).click();
  await settled(page);
});

test("missing model leaves the analysis usable and offers retry", async ({ page }) => {
  await page.route("**/terrain3d/*.glb", route => route.fulfill({ status: 404, body: "missing" }));
  await page.goto("/#/app");
  await page.getByRole("button", { name: "Open 3D terrain" }).click();
  // The first open also loads the three.js chunk and the model description, while the calendar is still computing.
  await expect(page.getByTestId("terrain-panel")).toContainText("terrain model could not be downloaded", { timeout: READY_MS });
  await expect(page.getByRole("button", { name: "Reload 3D view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play terrain time" })).toBeDisabled();
  await expect(page.getByTestId("timelines")).toBeVisible();
  await page.unroute("**/terrain3d/*.glb");
  await page.getByRole("button", { name: "Reload 3D view" }).click();
  await expect(page.getByTestId("terrain-canvas")).toHaveAttribute("data-ready", "true", { timeout: READY_MS });
});

test("a model built from another DEM is refused before it is downloaded", async ({ page }) => {
  let modelRequested = false;
  await page.route("**/terrain3d/demo-a.glb", route => { modelRequested = true; return route.continue(); });
  await page.route("**/terrain3d/demo-a.json", async route => {
    const res = await route.fetch();
    const meta = await res.json();
    await route.fulfill({ response: res, json: { ...meta, sourceSha256: "0".repeat(64) } });
  });
  await page.goto("/#/app");
  await page.getByRole("button", { name: "Open 3D terrain" }).click();
  await expect(page.getByTestId("terrain-panel")).toContainText("does not match this site's coordinates or source data", { timeout: READY_MS });
  await expect(page.getByTestId("terrain-canvas").locator("canvas")).toHaveCount(0);
  expect(modelRequested).toBe(false);
});

// The byte-length and sha256 checks catch a damaged or mismatched download; they are not tamper protection (the
// expected hash comes from a JSON on the same origin).
test("a model file that does not match its description is refused: wrong length, then wrong hash", async ({ page }) => {
  let mode: "short" | "flipped" = "short";
  await page.route("**/terrain3d/demo-a.glb", async route => {
    const res = await route.fetch();
    const body = Buffer.from(await res.body());
    if (mode === "short") return route.fulfill({ response: res, body: body.subarray(0, body.length - 1) });
    body[body.length - 1] ^= 0xff; // same length, one byte changed
    return route.fulfill({ response: res, body });
  });
  await page.goto("/#/app");
  await page.getByRole("button", { name: "Open 3D terrain" }).click();
  const panel = page.getByTestId("terrain-panel");
  await expect(panel).toContainText("The terrain download is incomplete.", { timeout: READY_MS });
  await expect(page.getByTestId("terrain-canvas").locator("canvas")).toHaveCount(0);
  mode = "flipped";
  await page.getByRole("button", { name: "Reload 3D view" }).click();
  await expect(panel).toContainText("The terrain model failed its integrity check.", { timeout: READY_MS });
  await expect(page.getByTestId("terrain-canvas").locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play terrain time" })).toBeDisabled();
});

test("mobile terrain controls fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTerrain(page);
  const box = await page.getByTestId("terrain-panel").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(slider(page)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Playback speed" })).toBeVisible();
  await expect(page.getByTestId("terrain-strip")).toBeVisible();
});

// Screenshots for review (web/screenshots/, git-ignored): both widths, both lightings, a visible and a blocked moment.
test("screenshots", async ({ page }) => {
  for (const [width, height, tag] of [[1280, 900, "desktop"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("about:blank");
    await openTerrain(page);
    await settled(page);
    for (const [lighting, radio] of [["sun", "Sun direction"], ["relief", "Fixed relief"]] as const) {
      await page.getByRole("radio", { name: radio }).check();
      await stepSlider(page, "Home");
      await stepSlider(page, "ArrowRight", LAST_VISIBLE);
      await expect(page.getByTestId("terrain-state-sun")).toHaveAttribute("data-state", "visible");
      await settled(page);
      await page.getByTestId("terrain-panel").screenshot({ path: `screenshots/terrain-${tag}-${lighting}-visible.png` });
      await stepSlider(page, "ArrowRight", 30); // 14:30 UTC, well inside the 8.9 h gap
      await expect(page.getByTestId("terrain-state-sun")).toHaveAttribute("data-state", "blocked");
      await settled(page);
      await page.getByTestId("terrain-panel").screenshot({ path: `screenshots/terrain-${tag}-${lighting}-blocked.png` });
    }
    // Labels keep their on-screen size from directly above as well.
    await page.getByRole("radio", { name: "Sun direction" }).check();
    await clickView(page, "Top view");
    await page.getByTestId("terrain-panel").screenshot({ path: `screenshots/terrain-${tag}-top.png` });
  }
});

// Frame rate during playback on a slow device: hardware GPU (software WebGL is GPU-bound at a few frames per second
// whatever the page does, so it cannot measure this) and the main thread slowed 4x. On this dev server, an M-series Mac
// measured 5.3-5.5 fps and about 12 h/s before the shared cursor was throttled (every frame re-rendered the app),
// and 28-29 fps at 21-24 h/s after (about 20 fps with the rest of the suite running in parallel).
test.describe("playback frame rate", () => {
  test("stays smooth at 24 h/s on a 4x slower CPU and keeps the labelled speed", async ({ playwright, baseURL }) => {
    // Its own browser, because the rest of this file forces software WebGL.
    const browser = await playwright.chromium.launch({ args: process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : ["--enable-gpu"] });
    const page = await browser.newPage({ baseURL, viewport: { width: 1280, height: 800 } });
    try {
    await openTerrain(page, "2027-02-10", "0");
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });
    test.skip(/swiftshader|llvmpipe|software|unknown/i.test(renderer), `No hardware WebGL here (${renderer})`);
    await settled(page);
    await page.getByRole("combobox", { name: "Playback speed" }).selectOption("24");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.getByRole("button", { name: "Play terrain time" }).click();
    await page.waitForTimeout(500); // steady state
    const r = await page.evaluate(async () => {
      let frames = 0;
      let run = true;
      const tick = () => { if (run) { frames++; requestAnimationFrame(tick); } };
      requestAnimationFrame(tick);
      const slider = document.querySelector<HTMLInputElement>("#terrain-time-slider")!;
      const i0 = Number(slider.value);
      const t0 = performance.now();
      await new Promise(res => setTimeout(res, 3000));
      run = false;
      const secs = (performance.now() - t0) / 1000;
      return { fps: frames / secs, samplesPerSecond: (Number(slider.value) - i0) / secs };
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.getByRole("button", { name: "Pause terrain time" }).click();
    console.log(`playback at 24 h/s, CPU 4x slower: ${r.fps.toFixed(1)} fps, ${(r.samplesPerSecond / 6).toFixed(1)} h of mission time per second`);
    expect(r.fps).toBeGreaterThan(12); // the suite runs workers in parallel; alone it measures 28-29
    // 24 h/s at 10-minute samples is 144 samples per second of real time (read off the slider, so a frame that is
    // still busy when the measurement ends shows slightly less).
    expect(r.samplesPerSecond).toBeGreaterThan(144 * 0.8);
    expect(r.samplesPerSecond).toBeLessThan(144 * 1.1);
    } finally {
      await browser.close();
    }
  });
});
