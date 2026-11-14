// DEV-ONLY, used by the preview harness (preview.tsx) and nothing else. It is NOT part of the landing components,
// which only render props. MOCK: it stands in for the app shell. To show exactly the props the app sends, it calls
// the app's own builders (src/lib/landingData.ts) on the real cached files, with MOCK example inputs that mirror the
// EXAMPLE constant in App.tsx (demo-a, 2027-02-10 00:00 UTC, 7 days, Sun limit 6 h, +24 h).
import type { Manifest, SiteDataset } from "../contract/types";
import { loadManifest, loadSite } from "../lib/data";
import { buildPoints, computeReplay, computeStory, computeStrip, type ExampleInputs } from "../lib/landingData";
import type { DemoStory, PointSummary, StripDay, SunReplay } from "./types";

const MOCK_EXAMPLE = { siteId: "demo-a", startUtc: "2027-02-10T00:00:00Z", durationHours: 168, sunLimitHours: 6 };

export interface MockData {
  manifest: Manifest;
  story: DemoStory | null;
  storyFailed: boolean;
  replay: SunReplay | null;
  points: PointSummary[];
  example: { durationDays: number; shiftHours: number; sunLimitHours: number };
}

/** MOCK props from the real cached files. `loading` returns the manifest-only state (everything else pending). */
export async function buildMockProps(loading: boolean): Promise<MockData> {
  const manifest = await loadManifest();
  const ex: ExampleInputs = { ...MOCK_EXAMPLE, shiftHours: manifest.defaults.shiftHours };
  const example = { durationDays: ex.durationHours / 24, shiftHours: ex.shiftHours, sunLimitHours: ex.sunLimitHours };
  if (loading)
    return { manifest, story: null, storyFailed: false, replay: null, points: buildPoints(manifest, {}, {}, ex), example };

  const loaded: Record<string, SiteDataset> = {};
  const strips: Record<string, StripDay[] | null> = {};
  for (const e of manifest.sites) {
    const s = await loadSite(e.file);
    loaded[e.id] = s;
    strips[e.id] = computeStrip(manifest, s, ex);
  }
  const exSite = loaded[ex.siteId];
  const story = exSite ? computeStory(exSite, ex) : null;
  return {
    manifest,
    story,
    storyFailed: story === null,
    replay: exSite ? computeReplay(exSite, ex) : null,
    points: buildPoints(manifest, loaded, strips, ex),
    example,
  };
}
