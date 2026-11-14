// Every media file the landing uses, in one place. Swap an asset by editing its entry here.
// Paths are relative to the app's public folder; `src` resolves them against the Vite base URL.
// Tool screenshots are real captures of the navigator: regenerate them with scripts/capture-landing-shots.mjs.

const base = import.meta.env.BASE_URL;
const src = (p: string) => `${base}${p}`;

export interface Shot {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** Bento crop: the image is drawn `zoom` times the cell width, with the point (x, y) (fractions of the image)
   *  at the cell's top-left corner. The image is never drawn smaller than what fills the cell's height.
   *  `narrowKeepX` is for one-column widths, where a wide shot is cut on both sides: the horizontal range of the
   *  image (fractions) that must stay in view. Its middle is centred in the cell and the 680 px legibility floor
   *  is dropped, so the range always fits. */
  crop: { x: number; y: number; zoom: number; narrowKeepX?: readonly [number, number] };
}

export const MEDIA = {
  heroVideo: src("media/hero-loop.mp4"),
  heroPoster: src("media/hero-poster.jpg"),
  /** Closing band reuses the hero poster with a different crop (see .lw-closing-media in the CSS). */
  closingImage: src("media/hero-poster.jpg"),
  /** Caption for generated media, shown outside the image. */
  generatedCaption: "Illustrative animation, not NASA imagery",
  generatedStillCaption: "Illustrative image, not NASA imagery",
  shots: {
    calendar: {
      src: src("media/shots/calendar.png"),
      width: 2464,
      height: 866,
      alt: "The navigator's start-date calendar: one row of daily starts per demonstration point, each day marked as meeting or exceeding the Sun limit, with the example start outlined.",
      crop: { x: 0, y: 0.04, zoom: 1.35 },
    },
    horizon: {
      src: src("media/shots/horizon.png"),
      width: 1832,
      height: 1266,
      alt: "The navigator's horizon view at Demo point A: the terrain horizon all around the point, Earth high above it, and the Sun just below the ridge.",
      crop: { x: 0.02, y: 0.09, zoom: 1.75 },
    },
    timeline: {
      src: src("media/shots/timeline.png"),
      width: 1832,
      height: 906,
      alt: "The navigator's visibility timelines for the delayed window: Earth in view throughout, the Sun in view except one outlined interruption near the end.",
      crop: { x: 0, y: 0.09, zoom: 1.3 },
    },
    // Captured by scripts/capture-landing-shots.mjs like the others (2x, dark): a clip of the 3D viewport only, at Demo
    // point A, 2027-02-17 09:30 UTC (the moment the terrain e2e screenshots use), Sun-direction lighting, both centres
    // visible, with the "Drag to orbit" hint hidden. Redo just this one with `--only terrain`.
    terrain: {
      src: src("media/shots/terrain.png"),
      width: 1846,
      height: 692,
      alt: "The navigator's 3D view of the LOLA terrain around Demo point A, with lines from the point toward the Sun and Earth directions, both labelled centre visible.",
      // narrowKeepX: from the left edge of the Sun label to the right edge of the Earth label.
      crop: { x: 0.035, y: 0.12, zoom: 1.04, narrowKeepX: [0.13, 0.63] },
    },
  } satisfies Record<string, Shot>,
};
