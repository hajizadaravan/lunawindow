import { expect, test, type Page } from "@playwright/test";

// The example point's cached file fails to load (route interception). The landing must say so instead of showing
// endless loading skeletons, and the pending "Try a 24 h delay" scroll target must not block later route changes.

const FAILED = "This example could not be loaded from the cached dataset.";

async function failExamplePoint(page: Page) {
  await page.route("**/sites/demo-a.json", (route) => route.fulfill({ status: 500, body: "test failure" }));
}

test("a failed example point shows a message, not a loading skeleton", async ({ page }) => {
  await failExamplePoint(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const panel = page.getByRole("group", { name: "Longest Sun interruption" });
  await expect(panel.getByRole("status")).toHaveText(FAILED);
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#why").getByRole("status")).toHaveText(FAILED);
  await expect(page.locator('.lw-cell[data-kind="delay"]').getByRole("status")).toHaveText(FAILED);

  const a = page.getByTestId("point-demo-a");
  await expect(a).toHaveAttribute("data-failed", "true");
  await expect(a.getByRole("status")).toContainText("could not be loaded");
  // The other points still load and resolve.
  for (const id of ["demo-b", "demo-c"]) {
    const row = page.getByTestId(`point-${id}`);
    await expect(row).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(row.locator(".lw-strip-summary")).toContainText(/\d+ of \d+ daily starts meet/);
  }
  // Nothing on the landing is left loading.
  await expect(page.locator('.lw-root [aria-busy="true"]')).toHaveCount(0);
});

test("after a failed 'Try a 24 h delay', route changes still go to the top with focus on the heading", async ({ page }) => {
  await failExamplePoint(page);
  await page.goto("/");
  await expect(page.getByRole("group", { name: "Longest Sun interruption" }).getByRole("status")).toHaveText(FAILED);

  await page.getByRole("button", { name: "Try a 24 h delay" }).first().click();
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.locator(".notice.error").first()).toBeVisible();
  // The result cannot appear: the tool falls back to its top and heading.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("H1");

  // Back to the landing from far down the tool: top of the page, landing heading focused.
  // Instant scrolls (a wheel's smooth scroll could still be moving when the route changes).
  await page.evaluate(() => window.scrollTo({ top: 2000, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.getByRole("navigation", { name: "LunaWindow" }).getByRole("link", { name: "About LunaWindow" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("lw-hero-title");

  // And to the tool again by address: top, tool heading focused.
  await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => (window.location.hash = "#/app"));
  await expect(page.getByTestId("scenario")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest(".topbar") !== null)).toBe(true);
});
