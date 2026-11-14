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
   *  at the cell's top-left corner. */
  crop: { x: number; y: number; zoom: number };
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
  } satisfies Record<string, Shot>,
};
