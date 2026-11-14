import { ArrowRight, CalendarBlank } from "@phosphor-icons/react";
import type { Ref } from "react";
import { HeroMedia } from "./HeroMedia";
import { Comparison } from "./HeroPanel";
import { MEDIA } from "./media";
import type { DemoStory } from "./types";

export interface HeroProps {
  story: DemoStory | null;
  /** The example could not be loaded or computed: show a message, not a skeleton. */
  storyFailed?: boolean;
  onTryDemo: () => void;
  onOpenCalendar: () => void;
  /** Sentinel the nav watches to switch from transparent to solid. */
  sentinelRef?: Ref<HTMLDivElement>;
}

export function Hero({ story, storyFailed = false, onTryDemo, onOpenCalendar, sentinelRef }: HeroProps) {
  return (
    <section className="lw-hero" aria-labelledby="lw-hero-title">
      <HeroMedia />
      <div ref={sentinelRef} className="lw-hero-sentinel" aria-hidden="true" />
      <div className="lw-wrap lw-hero-grid">
        <h1 id="lw-hero-title" className="lw-hero-title">
          If your Moon mission slips a day, does it still fit your limits?
        </h1>
        <div className="lw-hero-copy">
          <p className="lw-hero-sub">
            Compare the longest loss of Sun and Earth visibility across start dates, and see what a 24&nbsp;h delay
            changes.
          </p>
          <div className="lw-hero-actions">
            <button type="button" className="lw-btn lw-btn-primary" onClick={onTryDemo}>
              Try a 24 h delay
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
            <button type="button" className="lw-btn lw-btn-ghost" onClick={onOpenCalendar}>
              <CalendarBlank size={18} weight="regular" aria-hidden="true" />
              Find start dates that fit
            </button>
          </div>
        </div>
        <Comparison story={story} failed={storyFailed} />
      </div>
      <p className="lw-media-caption">{MEDIA.generatedCaption}</p>
    </section>
  );
}
