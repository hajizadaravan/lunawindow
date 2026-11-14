import { ArrowRight, CalendarBlank, CheckCircle, Question, Warning, WarningOctagon, XCircle } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type { LimitStatus, Manifest } from "../contract/types";
import { dataUrl } from "../lib/data";
import { formatDay, formatHours, formatLatLon } from "./format";
import type { DemoStory, LandingProps, PointSummary, StripDay } from "./types";
import { SHORT_CAVEAT } from "./verdict";

interface Props {
  manifest: Manifest;
  points: PointSummary[];
  story: DemoStory | null;
  example: LandingProps["example"];
  onOpenCalendar: () => void;
}

const STATUS = {
  meets: { label: "Meets the limit, planned and delayed", Icon: CheckCircle },
  exceeds: { label: "Exceeds the limit", Icon: XCircle },
  uncertain: { label: "Uncertain: a gap touches the window edge or data is missing", Icon: Warning },
} as const;

function mapSrc(m: Manifest): string | null {
  if (!m.map) return null;
  try {
    return dataUrl(m.map.image);
  } catch {
    return null;
  }
}

export function Points({ manifest, points, story, example, onOpenCalendar }: Props) {
  const src = mapSrc(manifest);
  const map = manifest.map;
  const offMap = points.filter((p) => !p.mapPos).map((p) => p.letter);
  const letters = points.map((p) => p.letter).join(", ");

  return (
    <section id="points" className="lw-section lw-points" aria-labelledby="lw-points-title">
      <div className="lw-wrap">
        <h2 id="lw-points-title" className="lw-h2">
          Three demonstration points, one question
        </h2>
        <p className="lw-body">
          These are comparison points chosen for this prototype, not proposed or approved landing sites. Each row
          asks the same thing: for every daily start, does the longest loss of the Sun stay within the limit, as
          planned and after a delay?
        </p>

        <div className="lw-points-grid" data-has-map={Boolean(src && map)}>
          {src && map && (
            <figure className="lw-map">
              <div className="lw-map-frame" style={{ aspectRatio: `${map.widthPx} / ${map.heightPx}` }}>
                <img
                  src={src}
                  width={map.widthPx}
                  height={map.heightPx}
                  alt={`Shaded relief of the lunar south pole region from LOLA elevation data, with demonstration points ${letters} marked.`}
                  loading="lazy"
                  decoding="async"
                />
                {points.map((p) =>
                  p.mapPos ? (
                    <span
                      key={p.id}
                      className="lw-map-pin"
                      style={{ left: `${p.mapPos.x * 100}%`, top: `${p.mapPos.y * 100}%` } as CSSProperties}
                      aria-hidden="true"
                    >
                      {p.letter}
                    </span>
                  ) : null,
                )}
              </div>
              <figcaption className="lw-caption">
                Real LOLA elevation data. {map.rendering}
                {offMap.length > 0 && ` Point ${offMap.join(", ")} lies outside this map.`}
              </figcaption>
            </figure>
          )}

          <div className="lw-points-list">
            <p className="lw-example">
              Each strip below: one cell per daily start, a {example.durationDays}-day window, a Sun limit of{" "}
              {formatHours(example.sunLimitHours)}, every start checked as planned and {formatHours(example.shiftHours)}{" "}
              later.
            </p>
            <ul className="lw-legend" aria-label="Strip legend">
              {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => {
                const { label, Icon } = STATUS[k];
                return (
                  <li key={k}>
                    <span className="lw-swatch" data-status={k} aria-hidden="true" />
                    <Icon size={16} weight="regular" aria-hidden="true" />
                    {label}
                  </li>
                );
              })}
            </ul>
            <ol className="lw-point-rows">
              {points.map((p) => (
                <PointRow key={p.id} p={p} story={story} example={example} />
              ))}
            </ol>
            <button type="button" className="lw-btn lw-btn-ghost" onClick={onOpenCalendar}>
              <CalendarBlank size={18} weight="regular" aria-hidden="true" />
              Find start dates that fit
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The analysis' verdict next to one gap number: nothing when within the limit, an icon when exceeded (worded for
 * screen readers by srVerdict), an icon and a short visible note when the gap is truncated or data is missing.
 * Never colour alone.
 */
function StatusMark({ status }: { status: LimitStatus }) {
  if (status === "within") return null;
  if (status === "exceeded") return <Warning className="lw-point-mark" size={13} weight="fill" aria-hidden="true" />;
  return (
    <span className="lw-point-caveat">
      <Question className="lw-point-mark" size={14} weight="bold" aria-hidden="true" />({SHORT_CAVEAT[status]})
    </span>
  );
}

function srVerdict(r: NonNullable<PointSummary["result"]>, limit: number): string {
  const L = formatHours(limit);
  const parts: string[] = [];
  if (r.baseSunStatus === "exceeded") parts.push(`The planned start exceeds the ${L} limit.`);
  if (r.shiftedSunStatus === "exceeded") parts.push(`The delayed start exceeds the ${L} limit.`);
  return parts.join(" ");
}

const POINT_FAILED_TEXT = "This point could not be loaded from the cached dataset.";

function PointRow({ p, story, example }: { p: PointSummary; story: DemoStory | null; example: LandingProps["example"] }) {
  const ready = p.result !== null && p.strip !== null;
  return (
    <li className="lw-point" aria-busy={!ready && !p.failed} data-failed={p.failed} data-testid={`point-${p.id}`}>
      <span className="lw-point-letter" aria-hidden="true">
        {p.letter}
      </span>
      <div className="lw-point-body">
        <div className="lw-point-head">
          <h3 className="lw-h3">
            <span className="sr-only">{p.letter}. </span>
            {p.name}
          </h3>
          <span className="lw-point-coords">{formatLatLon(p.latDeg, p.lonEastDeg)}</span>
        </div>
        <p className="lw-point-hint">{p.locationHint}</p>
        <p className="lw-point-gap">
          {p.result ? (
            <>
              Longest Sun gap{story ? `, window from ${formatDay(story.startUtc)}` : ", example window"}:{" "}
              <span className="lw-num" data-over={p.result.baseSunStatus === "exceeded"}>
                {formatHours(p.result.baseSunGapHours)}
              </span>
              <StatusMark status={p.result.baseSunStatus} /> planned,{" "}
              <span className="lw-num" data-over={p.result.shiftedSunStatus === "exceeded"}>
                {formatHours(p.result.shiftedSunGapHours)}
              </span>
              <StatusMark status={p.result.shiftedSunStatus} /> delayed.{" "}
              {srVerdict(p.result, example.sunLimitHours) && (
                <span className="sr-only">{srVerdict(p.result, example.sunLimitHours)} </span>
              )}
              <span className="lw-point-mode">{p.result.horizonLabel}</span>
            </>
          ) : p.failed ? (
            <span className="lw-point-failed" role="status">
              <WarningOctagon size={16} weight="bold" aria-hidden="true" />
              {POINT_FAILED_TEXT}
            </span>
          ) : (
            <span className="lw-skel lw-skel-line" />
          )}
        </p>
        {p.strip ? (
          <Strip strip={p.strip} exampleStart={story?.startUtc ?? null} limit={example.sunLimitHours} />
        ) : p.failed ? (
          // The strip's footprint, empty: its data will not arrive. Says so only when the row above did not.
          <div className="lw-strip-wrap">
            <div className="lw-strip" aria-hidden="true" />
            <div className="lw-strip-axis" aria-hidden="true" />
            {p.result ? (
              <p className="lw-strip-summary lw-point-failed" role="status">
                <WarningOctagon size={16} weight="bold" aria-hidden="true" />
                The start-date strip could not be computed from the cached dataset.
              </p>
            ) : (
              <p className="lw-strip-summary" aria-hidden="true" />
            )}
          </div>
        ) : (
          <div className="lw-strip-wrap" aria-hidden="true">
            <div className="lw-strip lw-skel" />
            <div className="lw-strip-axis" />
            <p className="lw-strip-summary">
              <span className="lw-skel lw-skel-line" />
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

function Strip({ strip, exampleStart, limit }: { strip: StripDay[]; exampleStart: string | null; limit: number }) {
  const n = strip.length;
  const count = (s: StripDay["status"]) => strip.filter((d) => d.status === s).length;
  const ex = exampleStart ? strip.findIndex((d) => Date.parse(d.startUtc) === Date.parse(exampleStart)) : -1;
  const meets = count("meets");
  const exceeds = count("exceeds");
  const uncertain = count("uncertain");
  const exPos = ex >= 0 ? ((ex + 0.5) / n) * 100 : null;
  if (n === 0) return <p className="lw-strip-summary">No daily start fits inside the data range.</p>;
  return (
    <div className="lw-strip-wrap">
      <div className="lw-strip" aria-hidden="true">
        {strip.map((d, i) => (
          <span
            key={d.startUtc}
            className="lw-strip-cell"
            data-status={d.status}
            data-example={i === ex}
            title={`${formatDay(d.startUtc)}: ${formatHours(d.sunGapHours)} planned, ${formatHours(d.shiftedSunGapHours)} delayed. ${STATUS[d.status].label}.`}
          />
        ))}
      </div>
      <div className="lw-strip-axis" aria-hidden="true">
        {/* An end label that the example label would cover is left out; the example label is anchored at the ends. */}
        <span data-hidden={exPos !== null && exPos < 22}>{formatDay(strip[0].startUtc)}</span>
        {exPos !== null && (
          <span
            className="lw-strip-example"
            data-anchor={exPos < 10 ? "start" : exPos > 90 ? "end" : "middle"}
            style={{ left: `${exPos}%` }}
          >
            {formatDay(strip[ex].startUtc)}
          </span>
        )}
        <span data-hidden={exPos !== null && exPos > 78}>{formatDay(strip[n - 1].startUtc)}</span>
      </div>
      <p className="lw-strip-summary">
        {meets} of {n} daily starts meet the {formatHours(limit)} limit, {exceeds} exceed it
        {uncertain ? `, ${uncertain} uncertain` : ""}.
      </p>
    </div>
  );
}
