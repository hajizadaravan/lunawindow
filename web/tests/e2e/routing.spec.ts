import { expect, test, type Page } from "@playwright/test";

// Hash routing: `#/` landing, `#/app` tool. Landing button names are matched loosely because the landing lane owns
// their wording.
const tryDemo = (page: Page) => page.getByRole("button", { name: /24 h delay|try the (demo|example)/i }).first();
const openCalendar = (page: Page) => page.getByRole("button", { name: /start dates/i }).first();
const toolNav = (page: Page) => page.getByRole("navigation", { name: "LunaWindow" });
const aboutLink = (page: Page) => toolNav(page).getByRole("link", { name: "About LunaWindow" });
const toolAssumptions = (page: Page) => toolNav(page).getByRole("button", { name: "Assumptions & sources" });

test("landing and tool are separate views, with titles and fallback for unknown hashes", async ({ page }) => {
  await page.goto("/");
  await expect(tryDemo(page)).toBeVisible();
  await expect(page.getByTestId("scenario")).toHaveCount(0);
  await expect(aboutLink(page)).toHaveCount(0);
  await expect(page).toHaveTitle(/^LunaWindow:/);

  await page.goto("/#/app");
  await expect(page.getByTestId("scenario")).toBeVisible();
  await expect(page.getByTestId("timelines")).toBeVisible();
  await expect(aboutLink(page)).toBeVisible();
  await expect(toolAssumptions(page)).toBeVisible();
  await expect(page).toHaveTitle(/Visibility tool/);

  await page.goto("/#/does-not-exist");
  await expect(tryDemo(page)).toBeVisible();
  await expect(page.getByTestId("scenario")).toHaveCount(0);
});

test("try the demo opens the tool on the example result; back and forward switch views", async ({ page }) => {
  await page.goto("/");
  await tryDemo(page).click();
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.getByTestId("example-tag")).toBeVisible();
  // The result heading is scrolled to and focused (existing scrollTarget logic).
  await expect(page.locator("#result")).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("#result") !== null)).toBe(true);

  await page.goBack();
  await expect(tryDemo(page)).toBeVisible();
  await expect(page.getByTestId("scenario")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.goForward();
  await expect(page.getByTestId("scenario")).toBeVisible();
  await expect(page.getByTestId("example-tag")).toBeVisible();
});

test("find start dates opens the tool at the calendar", async ({ page }) => {
  await page.goto("/");
  await openCalendar(page).click();
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.getByTestId("calendar")).toBeInViewport();
});

test("About LunaWindow returns to the landing at the top with focus on its heading", async ({ page }) => {
  await page.goto("/#/app");
  await expect(page.getByTestId("timelines")).toBeVisible();
  await page.mouse.wheel(0, 2000);
  await aboutLink(page).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(tryDemo(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("H1");
  await expect(page).toHaveTitle(/^LunaWindow:/);
});

test("the assumptions dialog opens from both views", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /assumptions/i }).first().click();
  const dialog = page.getByRole("dialog", { name: "Assumptions & sources" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.goto("/#/app");
  await toolAssumptions(page).click();
  await expect(dialog).toBeVisible();
});
