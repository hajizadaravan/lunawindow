// DEV-ONLY preview harness for the landing (open /landing-preview.html). Not part of the app build.
// The story below is MOCK data for layout only; in the app, DemoStory is computed by App from the cached dataset.
// ?story=null renders the loading state.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../styles.css";
import { LandingHero, LandingSections, type DemoStory } from "./index";

const MOCK: DemoStory = {
  siteName: "Point A",
  startUtc: "2027-01-12T00:00:00Z",
  durationDays: 7,
  shiftHours: 24,
  limitHours: 6,
  baseSunGapHours: 0,
  shiftedSunGapHours: 8.9,
  baseEarthGapHours: 0,
  shiftedEarthGapHours: 0,
  horizonLabel: "Terrain horizon (LOLA 40 m)",
};

const params = new URLSearchParams(location.search);
const story = params.get("story") === "null" ? null : MOCK;
const log = (what: string) => () => console.log(`[preview] ${what}`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <header className="topbar">
      <div className="brand">
        <h1>LunaWindow</h1>
        <p>Preview harness</p>
      </div>
    </header>
    <main>
      <LandingHero story={story} onTryDemo={log("try demo")} onOpenCalendar={log("calendar")} onAssumptions={log("assumptions")} />
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ height: 240, border: "1px dashed var(--line-strong)", borderRadius: 10, display: "grid", placeItems: "center", color: "var(--ink-3)" }}>
          Tool goes here (owned by the frontend lane)
        </div>
      </div>
      <LandingSections onAssumptions={log("assumptions")} />
    </main>
  </StrictMode>,
);
