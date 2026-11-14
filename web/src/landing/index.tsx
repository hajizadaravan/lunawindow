// Landing sections shown around the tool. INTERFACE IS FIXED BY THE INTEGRATOR: the landing lane fills in the
// bodies and may add files in this folder; App.tsx (frontend lane) mounts these two components and owns the props.
import "./landing.css";
import { Hero } from "./Hero";
import { Sections } from "./Sections";

/** The example scenario, computed by App from the cached dataset with the analysis module. Never hardcode these. */
export interface DemoStory {
  siteName: string; // e.g. "Point A"
  startUtc: string; // ISO, baseline window start
  durationDays: number;
  shiftHours: number; // 24
  limitHours: number; // example Sun limit, 6
  baseSunGapHours: number; // longest Sun gap, baseline window
  shiftedSunGapHours: number; // longest Sun gap, start delayed by shiftHours
  baseEarthGapHours: number;
  shiftedEarthGapHours: number;
  horizonLabel: string; // active horizon mode, e.g. "Terrain horizon (LOLA 40 m)"
}

export interface LandingHeroProps {
  /** null while the dataset is loading or if the example could not be computed. */
  story: DemoStory | null;
  /** Applies the example scenario in the tool and scrolls to the result. */
  onTryDemo: () => void;
  /** Scrolls to the start-date calendar. */
  onOpenCalendar: () => void;
  onAssumptions: () => void;
}

export function LandingHero(props: LandingHeroProps) {
  return <Hero {...props} />;
}

/** Sections below the tool: who it is for, how it works, what it does not claim. */
export function LandingSections(props: { onAssumptions: () => void }) {
  return <Sections {...props} />;
}
