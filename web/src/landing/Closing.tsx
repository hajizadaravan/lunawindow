import { ArrowRight } from "@phosphor-icons/react";
import { MEDIA } from "./media";
import { Mark } from "./Nav";

export function Closing({ onOpenTool }: { onOpenTool: () => void }) {
  return (
    <>
      <section className="lw-closing" aria-labelledby="lw-closing-title">
        <img className="lw-closing-media" src={MEDIA.closingImage} alt="" loading="lazy" decoding="async" />
        <div className="lw-closing-scrim" aria-hidden="true" />
        <div className="lw-wrap lw-closing-inner">
          <h2 id="lw-closing-title" className="lw-closing-title">
            Check your own start date
          </h2>
          <button type="button" className="lw-btn lw-btn-primary lw-btn-lg" onClick={onOpenTool}>
            Open the navigator
            <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <p className="lw-media-caption">{MEDIA.generatedStillCaption}</p>
      </section>
      <footer className="lw-footer">
        <div className="lw-wrap lw-footer-inner">
          <span className="lw-wordmark">
            <Mark />
            LunaWindow
          </span>
          <div className="lw-footer-text">
            <p>Built for the NASA Space Apps Challenge 2026, Lunar Landing Site Navigator.</p>
            <p>
              Exploratory prototype for students and educators. Nothing here certifies landing safety, power or
              communication.
            </p>
            <p>
              The hero animation and the closing image are illustrative, not NASA imagery. The map and the computed
              results come from the cached dataset.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
