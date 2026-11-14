import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

test("real terrain loads, follows shared time, and changes site without stale geometry", async ({ page }) => {
  test.skip(process.env.VITE_DATA_DIR === "data-synthetic", "Real models intentionally unavailable for synthetic data");
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const outside: string[] = [];
  page.on("request", req => { if (!new URL(req.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) outside.push(req.url()); });
  await page.goto("/");
  await page.getByRole("button", { name: "Open 3D terrain" }).click();
  await expect(page.getByTestId("terrain-canvas")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect(page.getByTestId("terrain-canvas").locator("canvas")).toBeVisible();
  await page.getByTestId("terrain-panel").screenshot({ path: "screenshots/terrain-desktop.png" });
  const time = page.getByRole("slider", { name: "3D mission time" });
  await time.focus();
  await page.keyboard.press("ArrowRight");
  const readout = await page.getByTestId("terrain-time-readout").innerText();
  await expect(page.getByTestId("horizon-readout")).toContainText(readout);
  await expect(page.getByTestId("time-cursor")).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("checkbox", { name: "Relief light" }).uncheck();
  await expect(page.getByTestId("terrain-panel")).toContainText("SUN DIRECTION · LIVE");
  await page.getByRole("button", { name: "Top view", exact: true }).click();
  await page.getByRole("button", { name: "Face Earth", exact: true }).click();
  await page.getByRole("button", { name: "Play terrain time" }).click();
  await expect(time).not.toHaveValue("1");
  await page.getByRole("button", { name: "Pause terrain time" }).click();
  // A new coordinate must never be shown over a model from the previous point.
  const points = page.getByRole("radiogroup", { name: "Demonstration point" }).getByRole("radio");
  for (const index of [1, 2]) {
    await points.nth(index).check();
    await expect(page.getByRole("button", { name: "Open 3D terrain" })).toBeVisible();
    await expect(page.getByTestId("terrain-panel").locator("canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "Open 3D terrain" }).click();
    await expect(page.getByTestId("terrain-canvas")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  }
  await page.getByRole("button", { name: "Close 3D view" }).click();
  await expect(page.getByTestId("terrain-panel").locator("canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test("missing model leaves the analysis usable and offers retry", async ({ page }) => {
  test.skip(process.env.VITE_DATA_DIR === "data-synthetic");
  await page.route("**/terrain3d/*.glb", route => route.fulfill({ status: 404, body: "missing" }));
  await page.goto("/");
  await page.getByRole("button", { name: "Open 3D terrain" }).click();
  await expect(page.getByTestId("terrain-panel")).toContainText("terrain model could not be downloaded");
  await expect(page.getByRole("button", { name: "Reload 3D view" })).toBeVisible();
  await expect(page.getByTestId("timelines")).toBeVisible();
  await page.unroute("**/terrain3d/*.glb");
  await page.getByRole("button", { name: "Reload 3D view" }).click();
  await expect(page.getByTestId("terrain-canvas")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
});

test("mobile terrain controls fit the viewport", async ({ page }) => {
  test.skip(process.env.VITE_DATA_DIR === "data-synthetic");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open 3D terrain" }).click();
  await expect(page.getByTestId("terrain-canvas")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  const box = await page.getByTestId("terrain-panel").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole("slider", { name: "3D mission time" })).toBeVisible();
  await page.getByTestId("terrain-panel").screenshot({ path: "screenshots/terrain-mobile.png" });
});
