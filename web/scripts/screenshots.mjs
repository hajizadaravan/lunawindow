#!/usr/bin/env node
// Captures desktop (1280x800) and phone (390x844) screenshots of a running dev server.
// Usage: node scripts/screenshots.mjs [baseUrl] [outDir] [colorScheme]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5173/";
const out = process.argv[3] ?? "screenshots";
const scheme = process.argv[4] ?? "light";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, colorScheme: scheme, deviceScaleFactor: name === "phone" ? 2 : 1 });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForSelector("[data-testid=timelines], .notice.error, .error-page", { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-${scheme}-top.png` });
  await page.screenshot({ path: `${out}/${name}-${scheme}-full.png`, fullPage: true });
  const toggle = page.getByRole("checkbox", { name: /hours later/ });
  if (await toggle.count()) {
    await toggle.check();
    await page.getByTestId("comparison").screenshot({ path: `${out}/${name}-${scheme}-compare.png` });
  }
  if (errors.length) console.log(name, "console errors:", errors);
  await page.close();
}
await browser.close();
console.log("saved to", out);
