import { expect, test, type Page } from "@playwright/test";

// The landing view (`#/`) on the real cached data. Every number is read back from the page and cross-checked
// between sections, never hardcoded here.

const hero = (page: Page) => page.locator(".lw-hero");
const replay = (page: Page) => page.getByTestId("replay");
const replayTime = (page: Page) => page.getByTestId("replay-time");

async function heroNumbers(page: Page) {
  const panel = page.getByRole("group", { name: "Longest Sun interruption" });
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  return {
    base: (await panel.locator(".lw-delta-from").innerText()).trim(),
    shifted: (await panel.locator(".lw-delta-to").innerText()).trim(),
  };
}

test("hero numbers arrive from the dataset and agree with the other sections", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const { base, shifted } = await heroNumbers(page);
  expect(base).toMatch(/^\d+(\.\d)? h$/);
  expect(shifted).toMatch(/^\d+(\.\d)? h$/);
  await expect(hero(page).getByRole("status")).toContainText(`${shifted} if the start is delayed`);

  // The bento delay cell shows the same pair.
  const delay = page.locator('.lw-cell[data-kind="delay"] .lw-delay-v');
  await expect(delay).toHaveText([base, shifted]);
  // The replay is the delayed window's longest Sun gap: its sentence quotes the same hours.
  await expect(page.getByTestId("replay-sentence")).toContainText(`${shifted} out of view`);
  // Every point row resolves (skeletons replaced) and names its horizon mode.
  for (const id of ["demo-a", "demo-b", "demo-c"]) {
    const row = page.getByTestId(`point-${id}`);
    await expect(row).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(row.locator(".lw-strip-summary")).toContainText(/\d+ of \d+ daily starts meet/);
  }
  await expect(page.getByTestId("point-demo-a")).toContainText(`${base} planned, ${shifted} delayed`);
});

test("replay autoplays once in view, and play, pause and the scrubber work", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(replay(page)).toBeVisible({ timeout: 30_000 });
  const before = await replayTime(page).innerText();
  await replay(page).getByRole("img").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Pause replay" })).toBeVisible();
  await expect.poll(() => replayTime(page).innerText()).not.toBe(before);

  // Switching reduced motion on mid-play stops it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "Play replay" })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Autoplay happens once: scrolling away and back does not restart it.
  const stopped = await replayTime(page).innerText();
  await page.locator(".lw-closing").scrollIntoViewIfNeeded();
  await replay(page).getByRole("img").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await expect(replayTime(page)).toHaveText(stopped);
  await expect(page.getByRole("button", { name: "Play replay" })).toBeVisible();

  await page.getByRole("button", { name: "Play replay" }).click();
  await page.getByRole("button", { name: "Pause replay" }).click();
  const paused = await replayTime(page).innerText();
  await page.waitForTimeout(600);
  await expect(replayTime(page)).toHaveText(paused);

  const range = page.getByRole("slider", { name: "Replay time" });
  await range.fill("0");
  const start = await replayTime(page).innerText();
  await range.fill("1000");
  await expect(replayTime(page)).not.toHaveText(start);
  // Keyboard works too.
  await range.focus();
  await page.keyboard.press("Home");
  await expect(replayTime(page)).toHaveText(start);

  // Play from the start, then it stops at the end (no loop).
  await range.fill("995");
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect(page.getByRole("button", { name: "Play replay" })).toBeVisible({ timeout: 5_000 });
  await expect(range).toHaveValue("1000");
});

test("reduced motion: the replay rests at the gap start and does not autoplay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(replay(page)).toBeVisible({ timeout: 30_000 });
  await replay(page).getByRole("img").scrollIntoViewIfNeeded();
  const sentence = await page.getByTestId("replay-sentence").innerText();
  // "goes behind the terrain at 17 Feb 2027, 09:30 UTC" -> readout "17 Feb 09:30 UTC"
  const m = sentence.match(/terrain at (\d+ \w+) \d{4}, (\d\d:\d\d) UTC/);
  expect(m).not.toBeNull();
  await expect(replayTime(page)).toHaveText(`${m![1]} ${m![2]} UTC`);
  await page.waitForTimeout(1200);
  await expect(replayTime(page)).toHaveText(`${m![1]} ${m![2]} UTC`);
  await expect(page.getByRole("button", { name: "Play replay" })).toBeVisible();
  // Manual control still works.
  await page.getByRole("slider", { name: "Replay time" }).fill("1000");
  await expect(replayTime(page)).not.toHaveText(`${m![1]} ${m![2]} UTC`);
});

test("nav links scroll to their section and move focus to its heading", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "On this page" });
  for (const [label, id, heading] of [
    ["The three points", "points", "Three demonstration points, one question"],
    ["Data and limits", "data", "Where the numbers come from"],
    ["Why a day matters", "why", "One ridge can hide the Sun for hours"],
    ["What you can do", "features", "What you can do with it"],
  ] as const) {
    await nav.getByRole("button", { name: label }).click();
    const h = page.locator(`#${id} h2`).first();
    await expect(h).toHaveText(heading);
    await expect(h).toBeInViewport();
    await expect(h).toBeFocused();
  }
  // The nav is solid once the hero has scrolled under it.
  await expect(page.locator(".lw-nav")).toHaveAttribute("data-solid", "true");
  await expect(page).toHaveURL(/#\/$|\/$/);
});

test("try a 24 h delay opens the tool on the example result", async ({ page }) => {
  await page.goto("/");
  await hero(page).getByRole("button", { name: "Try a 24 h delay" }).click();
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.getByTestId("example-tag")).toBeVisible();
  await expect(page.locator("#result")).toBeInViewport();
});

test("find start dates that fit opens the tool at the calendar", async ({ page }) => {
  await page.goto("/");
  await page.locator("#points").getByRole("button", { name: "Find start dates that fit" }).click();
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.getByTestId("calendar")).toBeInViewport();
});

test("open the navigator opens the tool; read the assumptions opens the dialog", async ({ page }) => {
  await page.goto("/");
  await page.locator(".lw-closing").getByRole("button", { name: "Open the navigator" }).click();
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.getByTestId("scenario")).toBeVisible();

  await page.goto("/#/");
  await page.getByRole("button", { name: "Read the assumptions" }).click();
  await expect(page.getByTestId("assumptions")).toBeVisible();
});

test("no horizontal overflow at 390 px once the data has arrived, and the page stays dark in light mode", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  await heroNumbers(page);
  await expect(page.getByTestId("point-demo-c")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw).toBeLessThanOrEqual(cw);
  await expect(page.locator(".lw-root")).toHaveCSS("background-color", "rgb(10, 11, 13)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(10, 11, 13)");
  // Phones keep the wordmark and the main CTA, not the section links.
  await expect(page.getByRole("navigation", { name: "On this page" })).toBeHidden();
  await expect(page.locator(".lw-nav").getByRole("button", { name: "Open the navigator" })).toBeVisible();
});

test("no layout shift when the data arrives (preview harness, MOCK callbacks)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/landing-preview.html?delay=2500");
    await expect(page.locator(".lw-compare")).toHaveAttribute("data-ready", "false");
    const tops = () =>
      page.evaluate(() =>
        ["#why", "#features", "#points", "#how", "#data", ".lw-closing"].map(
          (s) => document.querySelector(s)!.getBoundingClientRect().top + window.scrollY,
        ),
      );
    const before = await tops();
    await expect(page.locator(".lw-compare")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
    await expect(page.getByTestId("point-demo-c")).toHaveAttribute("aria-busy", "false");
    // Sub-pixel rounding inside the hero panel (text vs skeleton line boxes) is tolerated; anything visible is not.
    const after = await tops();
    after.forEach((t, i) => expect(Math.abs(t - before[i]), `section ${i} top at ${width} px`).toBeLessThan(1));
  }
});

test("every tool shot covers its bento cell, and the 3D terrain shot keeps both labels in view", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 1024, 900, 600, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".lw-cell[data-kind='shot']")).toHaveCount(4);
    for (const name of ["calendar", "horizon", "timeline", "terrain"] as const) {
      const shot = page.locator(".lw-shot").filter({ has: page.locator(`img[src$='media/shots/${name}.png']`) });
      await shot.scrollIntoViewIfNeeded();
      const img = shot.locator("img");
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      const cell = (await shot.boundingBox())!;
      const pic = (await img.boundingBox())!;
      // The crop never leaves an empty strip inside the cell.
      expect(pic.x, `${name} left at ${width} px`).toBeLessThanOrEqual(cell.x + 0.5);
      expect(pic.y, `${name} top at ${width} px`).toBeLessThanOrEqual(cell.y + 0.5);
      expect(pic.x + pic.width, `${name} right at ${width} px`).toBeGreaterThanOrEqual(cell.x + cell.width - 0.5);
      expect(pic.y + pic.height, `${name} bottom at ${width} px`).toBeGreaterThanOrEqual(cell.y + cell.height - 0.5);
      // The Sun and Earth labels of the terrain shot (crop.narrowKeepX in media.ts) are never cut off.
      const keep = (await img.getAttribute("data-keep-x"))?.split(",").map(Number);
      expect(keep !== undefined, `${name} has a kept range`).toBe(name === "terrain");
      if (keep) {
        expect(pic.x + keep[0] * pic.width, `${name} kept range left at ${width} px`).toBeGreaterThanOrEqual(cell.x);
        expect(pic.x + keep[1] * pic.width, `${name} kept range right at ${width} px`).toBeLessThanOrEqual(cell.x + cell.width);
      }
    }
  }
});
