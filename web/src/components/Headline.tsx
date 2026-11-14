import type { AnalysisResult, BodyId, HorizonInput } from "../contract/types";
import { fmtHours, fmtSignedHours, fmtUtc } from "../analysis/format";
import { BODY_NAME, STATUS_LABEL } from "../analysis/wording";
import { shiftReason } from "../analysis/shiftReason";
import { ModeTag } from "./ModeTag";
import { StatusIcon } from "./BodyCard";

type Pair = Record<BodyId, AnalysisResult>;

interface Props {
  siteName: string;
  base: Pair;
  shifted: Pair | null;
  shiftHours: number;
  durationHours: number;
  horizon: HorizonInput;
  onAssumptions: () => void;
}

function Gap({ r, testId }: { r: AnalysisResult; testId: string }) {
  const lg = r.longestInterruption;
  return (
    <span className="hl-gap" data-testid={testId}>
      <span className="num hl-hours">{lg ? fmtHours(lg.durationHours) : "None"}</span>
      {lg ? (
        <span className="hl-sub">
          from <span className="num">{fmtUtc(lg.startUtc)}</span>
          {lg.boundaryTruncated && ", touches the window edge and may continue"}
        </span>
      ) : (
        <span className="hl-sub">{r.unknownHours > 0 ? "no interruption in the known data" : "no interruption"}</span>
      )}
    </span>
  );
}

function Verdict({ r, testId }: { r: AnalysisResult; testId: string }) {
  if (!r.limit) return <span className="status none" data-testid={testId}>No limit set</span>;
  return (
    <span className={`status ${r.limit.status}`} data-testid={testId}>
      <StatusIcon status={r.limit.status} />
      {STATUS_LABEL[r.limit.status]}
    </span>
  );
}

/** The result first: longest gaps and limit verdicts for the baseline and (optionally) the later start. */
export function Headline(p: Props) {
  const { base, shifted } = p;
  const reasons = shifted
    ? (["sun", "earth"] as const).map((b) => shiftReason(base[b], shifted[b], p.shiftHours)).filter(Boolean)
    : [];
  return (
    <section className="panel headline" aria-labelledby="result-h" data-testid="headline">
      <div className="panel-head">
        <h2 id="result-h" tabIndex={-1}>
          Result: {p.siteName}, {p.durationHours / 24}-day window
        </h2>
        <ModeTag horizon={p.horizon} />
      </div>
      <div className="hl-grid" role="table" aria-label="Longest loss of visibility and limit verdicts">
        <div role="row" className="hl-row hl-head">
          <span role="columnheader" className="hl-body-col">
            <span className="sr-only">Body</span>
          </span>
          <span role="columnheader">
            Baseline <span className="num hl-sub">{fmtUtc(base.sun.windowStartUtc)}</span>
          </span>
          {shifted && (
            <span role="columnheader">
              Start {p.shiftHours} h later <span className="num hl-sub">{fmtUtc(shifted.sun.windowStartUtc)}</span>
            </span>
          )}
        </div>
        {(["sun", "earth"] as const).map((b) => (
          <div role="row" className="hl-row" key={b}>
            <span role="rowheader" className="hl-body-col">
              <span className={`swatch ${b}`} aria-hidden /> Longest {BODY_NAME[b]} gap
              <span className="hl-sub">
                {base[b].limit ? <>your limit {fmtHours(base[b].limit!.limitHours)}</> : "no limit set"}
              </span>
            </span>
            <span role="cell" className="hl-cell">
              <Gap r={base[b]} testId={`hl-base-${b}`} />
              <Verdict r={base[b]} testId={`hl-verdict-base-${b}`} />
            </span>
            {shifted && (
              <span role="cell" className="hl-cell">
                <Gap r={shifted[b]} testId={`hl-shifted-${b}`} />
                <span className="hl-diff num">
                  {fmtSignedHours(
                    (shifted[b].longestInterruption?.durationHours ?? 0) - (base[b].longestInterruption?.durationHours ?? 0),
                  )}{" "}
                  vs baseline
                </span>
                <Verdict r={shifted[b]} testId={`hl-verdict-shifted-${b}`} />
              </span>
            )}
          </div>
        ))}
      </div>
      {reasons.length > 0 && (
        <div className="hl-reason" data-testid="shift-reason">
          <strong>Why it changes:</strong> {reasons.join(" ")}
        </div>
      )}
      <p className="hint">
        Gaps are measured within each selected analysis interval for the body centre against the modelled horizon. A
        verdict only says whether that window passes your own tolerance in the current model; it says nothing about
        power, radio links or landing safety.{" "}
        <button type="button" className="btn link" onClick={p.onAssumptions}>
          Assumptions &amp; sources
        </button>
      </p>
    </section>
  );
}
