import {
  ArrowRight,
  CalendarBlank,
  Check,
  LineSegment,
  Mountains,
  Question,
  Sliders,
  Warning,
  WarningOctagon,
  Wrench,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { FEATURES, PLANNED, type Feature } from "./featureList";
import { formatHours } from "./format";
import { STORY_FAILED_TEXT } from "./HeroPanel";
import { CAVEAT } from "./verdict";
import type { DemoStory, LandingProps } from "./types";

interface Props {
  story: DemoStory | null;
  storyFailed?: boolean;
  example: LandingProps["example"];
  onTryDemo: () => void;
  onOpenCalendar: () => void;
}

export function Features(p: Props) {
  return (
    <section id="features" className="lw-section lw-features" aria-labelledby="lw-features-title">
      <div className="lw-wrap">
        <h2 id="lw-features-title" className="lw-h2">
          What you can do with it
        </h2>
        <ul className="lw-bento">
          {FEATURES.map((f) => (
            <Cell key={f.id} f={f} {...p} />
          ))}
        </ul>
        <section className="lw-planned" aria-labelledby="lw-planned-title">
          <div>
            <h3 id="lw-planned-title" className="lw-h3">
              <Wrench size={18} weight="regular" aria-hidden="true" />
              Planned, not built yet
            </h3>
            <p className="lw-body">Each of these needs new modelling and its own verification before it can be trusted.</p>
          </div>
          <ul>
            {PLANNED.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

function Cell({ f, story, storyFailed = false, example, onTryDemo, onOpenCalendar }: { f: Feature } & Props) {
  const v = f.visual;
  const action =
    f.action === "calendar" ? (
      <button type="button" className="lw-btn lw-btn-ghost lw-btn-sm" onClick={onOpenCalendar}>
        <CalendarBlank size={16} weight="regular" aria-hidden="true" />
        Find start dates that fit
      </button>
    ) : f.action === "demo" ? (
      <button type="button" className="lw-btn lw-btn-primary lw-btn-sm" onClick={onTryDemo}>
        Try a 24 h delay
        <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </button>
    ) : null;

  return (
    <li
      className="lw-cell"
      data-kind={v.kind}
      data-tinted={f.tinted ?? false}
      style={{ "--lw-span": f.span } as CSSProperties}
    >
      {v.kind === "shot" && (
        <div className="lw-shot">
          <img
            src={v.shot.src}
            width={v.shot.width}
            height={v.shot.height}
            alt={v.shot.alt}
            loading="lazy"
            decoding="async"
            data-keep-x={v.shot.crop.narrowKeepX?.join(",")}
            style={
              {
                "--lw-zoom": `${v.shot.crop.zoom * 100}%`,
                "--lw-cx": `${-v.shot.crop.x * 100}%`,
                "--lw-cy": `${-v.shot.crop.y * 100}%`,
                // Image width per unit of cell height at which the part below the crop's top just fills the cell.
                "--lw-cover": v.shot.width / (v.shot.height * (1 - v.shot.crop.y)),
                ...(v.shot.crop.narrowKeepX && {
                  "--lw-fx": `${(-(v.shot.crop.narrowKeepX[0] + v.shot.crop.narrowKeepX[1]) / 2) * 100}%`,
                }),
              } as CSSProperties
            }
          />
        </div>
      )}
      {v.kind === "delay" && <DelayNumbers story={story} failed={storyFailed} />}
      {v.kind === "modes" && (
        <div className="lw-cell-icons" aria-hidden="true">
          <LineSegment size={28} weight="regular" />
          <Mountains size={28} weight="regular" />
        </div>
      )}
      {v.kind === "limits" && (
        <div className="lw-cell-icons" aria-hidden="true">
          <Sliders size={28} weight="regular" />
        </div>
      )}
      <div className="lw-cell-text">
        <h3 className="lw-h3">{f.title}</h3>
        <p className="lw-cell-body">{f.body}</p>
        {v.kind === "limits" && (
          <p className="lw-cell-note">
            The examples on this page use a Sun limit of {formatHours(example.sunLimitHours)}.
          </p>
        )}
        {action && <div className="lw-cell-action">{action}</div>}
      </div>
    </li>
  );
}

function DelayNumbers({ story, failed }: { story: DemoStory | null; failed: boolean }) {
  // Failed: the skeleton's footprint, placeholders left empty, and the message in the verdict line.
  const isFailed = story === null && failed;
  const skel = isFailed ? "lw-skel-empty" : "lw-skel";
  return (
    <div className="lw-delay" aria-busy={story === null && !failed} data-failed={isFailed}>
      <div className="lw-delay-pair">
        <div>
          <span className="lw-delay-k">Planned start</span>
          <span className="lw-delay-v">{story ? formatHours(story.baseSunGapHours) : <span className={`${skel} lw-skel-big`} />}</span>
        </div>
        <ArrowRight className="lw-delay-arrow" size={24} weight="bold" aria-hidden="true" />
        <div>
          <span className="lw-delay-k">{story ? `Start +${formatHours(story.shiftHours)}` : "Delayed start"}</span>
          <span className="lw-delay-v" data-over={story ? story.shiftedSunStatus === "exceeded" : false}>
            {story ? formatHours(story.shiftedSunGapHours) : <span className={`${skel} lw-skel-big`} />}
          </span>
        </div>
      </div>
      <p className="lw-delay-verdict" role={isFailed ? "status" : undefined}>
        {/* Worded from the analysis' limit status, never from comparing the hours with the limit. */}
        {story ? (
          story.shiftedSunStatus === "exceeded" ? (
            <>
              <Warning size={16} weight="fill" aria-hidden="true" />
              Delayed, it exceeds the example {formatHours(story.limitHours)} limit.
            </>
          ) : story.shiftedSunStatus === "within" ? (
            <>
              <Check size={16} weight="bold" aria-hidden="true" />
              Delayed, it stays within the example {formatHours(story.limitHours)} limit.
            </>
          ) : (
            <>
              <Question className="lw-icon-muted" size={16} weight="bold" aria-hidden="true" />
              Delayed, no Sun interruption found exceeds the example {formatHours(story.limitHours)} limit, but{" "}
              {CAVEAT[story.shiftedSunStatus]}.
            </>
          )
        ) : isFailed ? (
          <>
            <WarningOctagon className="lw-icon-muted" size={16} weight="bold" aria-hidden="true" />
            {STORY_FAILED_TEXT}
          </>
        ) : (
          <span className="lw-skel lw-skel-text" />
        )}
      </p>
      <p className="lw-delay-meta">
        {story ? (
          <>
            Longest Sun interruption at {story.siteName}, {story.durationDays}-day window. {story.horizonLabel}.
          </>
        ) : (
          <span className={`${skel} lw-skel-text`} />
        )}
      </p>
    </div>
  );
}
