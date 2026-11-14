import { expect, test } from "@playwright/test";

// One end-to-end flow, asserting on visible text. Works against the real dataset (web/public/data) or the
// synthetic one (VITE_DATA_DIR=data-synthetic).
test("pick site, change start, set limit, compare +24 h, move cursor, open assumptions", async ({ page }) => {
  await page.goto("/");
  const synthetic = process.env.VITE_DATA_DIR === "data-synthetic";
  if (synthetic) await expect(page.getByTestId("synthetic-banner")).toContainText("Synthetic test data, not NASA measurements");
  else await expect(page.getByTestId("synthetic-banner")).toHaveCount(0);

  // pick a site (the last one listed)
  const radios = page.getByRole("radiogroup", { name: "Demonstration point" }).getByRole("radio");
  const last = radios.last();
  await last.check();
  await expect(last).toBeChecked();
  await expect(page.getByTestId("timelines")).toBeVisible();
  await expect(page.getByTestId("mode-tag").first()).toContainText("Horizon:");

  // change the start date to the day after the first allowed day, hour 06
  const date = page.getByLabel("Start date (UTC)");
  const min = await date.getAttribute("min");
  const next = new Date(Date.parse(`${min}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  await date.fill(next);
  await page.getByLabel("Start hour (UTC)").selectOption("6");
  await expect(page.locator(".window-line")).toContainText(`${next} 06:00 UTC`);

  // set a Sun limit
  await page.getByLabel("Max Sun loss").fill("12");
  const verdict = page.getByTestId("verdict-sun");
  await expect(verdict).toContainText(/Within limit|Limit exceeded|Not exceeded, gap truncated|Indeterminate, missing data/);
  await expect(verdict).toContainText("12.0 h");

  // +24 h comparison
  await page.getByRole("checkbox", { name: "Also check a start 24 hours later", exact: true }).check();
  await expect(page.getByTestId("comparison")).toContainText("Baseline");
  await expect(page.getByTestId("comparison-summary")).toContainText("Starting 24 h later");

  // move the shared cursor by keyboard
  const cursor = page.getByTestId("time-cursor");
  const readout = page.getByTestId("cursor-readout");
  await cursor.focus();
  await expect(readout).toContainText(`${next} 06:00 UTC`);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(readout).toContainText(`${next} 12:00 UTC`);
  await page.keyboard.press("ArrowRight");
  await expect(readout).not.toContainText(`${next} 12:00 UTC`);
  await page.keyboard.press("Home");
  await expect(readout).toContainText(`${next} 06:00 UTC`);
  await expect(page.getByTestId("horizon-readout")).toContainText(`${next} 06:00 UTC`);

  // assumptions panel
  await page.getByRole("button", { name: "Assumptions & sources" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Assumptions & sources" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Sun visible is not available power");
  await expect(dialog).toContainText("Query parameters");
  await expect(dialog).toContainText("Near-horizon band");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

// Regression: shortening the duration with the cursor at the end of a long window used to read past the
// dataset for one render and blank the page.
test("shortening the duration with the cursor at the window end keeps the page alive", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.getByTestId("timelines")).toBeVisible();

  // Ask for the latest start a 1-day window allows, while the window is 14 days long: the app clamps it
  // earlier but remembers the request.
  const date = page.getByLabel("Start date (UTC)");
  await page.getByLabel("Duration").selectOption("24");
  const latestForOneDay = await date.getAttribute("max");
  await page.getByLabel("Duration").selectOption("336");
  await date.fill(latestForOneDay!);
  await page.getByTestId("time-cursor").focus();
  await page.keyboard.press("End");

  // Back to 1 day: the start jumps to the remembered late date in the same render as the stale cursor.
  await page.getByLabel("Duration").selectOption("24");
  await expect(page.locator(".window-line")).toContainText(`${latestForOneDay}`);

  await expect(page.getByTestId("timelines")).toBeVisible();
  await expect(page.getByTestId("horizon-readout")).toContainText("UTC");
  expect(errors).toEqual([]);
});
