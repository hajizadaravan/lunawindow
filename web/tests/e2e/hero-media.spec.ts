import { expect, test } from "@playwright/test";

test("hero video plays, pauses, resumes and switches to a still for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const video = page.locator(".lw-media video");
  await expect(video).toHaveAttribute("data-ready", "true");
  const start = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).not.toBe(start);
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted && v.loop && v.playsInline)).toBe(true);
  await page.getByRole("button", { name: "Pause animation" }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(video).toHaveCount(0);
  await expect(page.locator(".lw-media img")).toHaveAttribute("data-ready", "true");
});

test("reduced motion does not request the video", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("hero-loop.mp4")) requests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator(".lw-media img")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".lw-media video")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("a video load failure leaves the poster visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/hero-loop.mp4", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".lw-media img")).toHaveAttribute("data-ready", "true");
  await expect.poll(() => page.locator(".lw-media video").evaluate((v: HTMLVideoElement) => v.error !== null)).toBe(true);
  await expect(page.locator(".lw-media video")).toHaveCSS("opacity", "0");
  await expect(page.getByRole("button", { name: "Pause animation" })).toHaveCount(0);
});
