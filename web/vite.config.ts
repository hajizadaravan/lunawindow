/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

// public/ is copied into dist/ wholesale. Keep synthetic test data out of production builds unless the build
// was explicitly made for it (VITE_DATA_DIR=data-synthetic).
const dropSyntheticFromDist = () => ({
  name: "drop-synthetic-from-dist",
  apply: "build" as const,
  closeBundle() {
    if (process.env.VITE_DATA_DIR !== "data-synthetic")
      rmSync(resolve(__dirname, "dist", "data-synthetic"), { recursive: true, force: true });
  },
});

export default defineConfig({
  base: "./",
  plugins: [react(), dropSyntheticFromDist()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
