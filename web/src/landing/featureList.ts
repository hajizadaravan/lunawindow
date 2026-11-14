// The "What you can do" bento. One entry per shipped feature: adding a feature is adding one entry here.
// `span` is the cell width on the 12-column desktop grid; rows fill left to right, so keep each row summing to 12.
import { MEDIA, type Shot } from "./media";

export type FeatureVisual =
  | { kind: "shot"; shot: Shot }
  /** Live numbers from the DemoStory props (base vs delayed longest Sun gap). */
  | { kind: "delay" }
  | { kind: "modes" }
  | { kind: "limits" };

export interface Feature {
  id: string;
  title: string;
  /** At most 25 words. */
  body: string;
  visual: FeatureVisual;
  span: number;
  /** Tinted text cell instead of an image cell. */
  tinted?: boolean;
  action?: "calendar" | "demo";
}

export const FEATURES: Feature[] = [
  {
    id: "calendar",
    title: "Start-date calendar",
    body: "Every daily start for all three points at once, marked against your own limits, so dates that fit stand out.",
    visual: { kind: "shot", shot: MEDIA.shots.calendar },
    span: 7,
    action: "calendar",
  },
  {
    id: "delay",
    title: "24 h delay check",
    body: "Run the same window a day later and see how the longest loss of the Sun changes.",
    visual: { kind: "delay" },
    span: 5,
    action: "demo",
  },
  {
    id: "horizon",
    title: "Horizon view",
    body: "Where the Sun and Earth sit against the terrain horizon around a point, moment by moment.",
    visual: { kind: "shot", shot: MEDIA.shots.horizon },
    span: 5,
  },
  {
    id: "timeline",
    title: "Visibility timeline",
    body: "When each body is in view across the window, with every interruption laid out in time.",
    visual: { kind: "shot", shot: MEDIA.shots.timeline },
    span: 7,
  },
  {
    id: "terrain",
    title: "3D terrain view",
    body: "Watch the Sun and Earth directions move over measured LOLA terrain across your window. The mesh is display only; visibility comes from the analysis.",
    visual: { kind: "shot", shot: MEDIA.shots.terrain },
    span: 12,
  },
  {
    id: "modes",
    title: "Two horizon modes, kept apart",
    body: "A geometric reference with no terrain, and a terrain horizon from LOLA. Every result names the one in use.",
    visual: { kind: "modes" },
    span: 6,
    tinted: true,
  },
  {
    id: "limits",
    title: "Your own limits",
    body: "You enter how long your plan can go without the Sun or Earth. They are tolerances, not a battery or radio model.",
    visual: { kind: "limits" },
    span: 6,
    tinted: true,
  },
];

/** Planned work, deliberately not built yet. No dates, no promises. */
export const PLANNED = [
  "A date heatmap for the whole south-pole region",
  "Cast shadows in the 3D terrain view",
  "An energy and battery model",
];
