// Landing page. INTERFACE IS FIXED BY THE INTEGRATOR in ./types.ts: App.tsx mounts <Landing> and owns the data;
// every section here only renders props.
import "./styles/base.css";
import "./styles/nav.css";
import "./styles/hero.css";
import "./styles/replay.css";
import "./styles/features.css";
import "./styles/points.css";
import "./styles/how.css";
import "./styles/data.css";
import "./styles/closing.css";
import { useEffect, useState } from "react";
import { Closing } from "./Closing";
import { DataLimits } from "./DataLimits";
import { Features } from "./Features";
import { Hero } from "./Hero";
import { How } from "./How";
import { useIntersection } from "./hooks";
import { Nav } from "./Nav";
import { Points } from "./Points";
import { Replay } from "./Replay";
import type { LandingProps } from "./types";

export type { DemoStory, LandingProps, PointSummary, StripDay, SunReplay } from "./types";

const PAGE_BG = "#0a0b0d"; // same as --lw-bg

/** The landing view (route `#/`). */
export function Landing(p: LandingProps) {
  const [solid, setSolid] = useState(false);
  // The nav turns solid once the top of the hero has scrolled under it (IntersectionObserver, no scroll listener).
  const sentinelRef = useIntersection<HTMLDivElement>((inView) => setSolid(!inView), { rootMargin: "-64px 0px 0px 0px" });

  // The landing is one dark page in both OS themes: keep overscroll and the area behind it dark too.
  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = PAGE_BG;
    return () => {
      document.body.style.backgroundColor = prev;
    };
  }, []);

  return (
    <div className="lw-root">
      <Nav solid={solid} onOpenTool={p.onOpenTool} />
      <main>
        <Hero story={p.story} storyFailed={p.storyFailed} onTryDemo={p.onTryDemo} onOpenCalendar={p.onOpenCalendar} sentinelRef={sentinelRef} />
        <Replay replay={p.replay} story={p.story} storyFailed={p.storyFailed} />
        <Features story={p.story} storyFailed={p.storyFailed} example={p.example} onTryDemo={p.onTryDemo} onOpenCalendar={p.onOpenCalendar} />
        <Points
          manifest={p.manifest}
          points={p.points}
          story={p.story}
          example={p.example}
          onOpenCalendar={p.onOpenCalendar}
        />
        <How />
        <DataLimits onAssumptions={p.onAssumptions} />
      </main>
      <Closing onOpenTool={p.onOpenTool} />
    </div>
  );
}
