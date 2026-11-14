import { CheckCircle, Question, Warning, XCircle, MinusCircle } from "@phosphor-icons/react";
import type { AnalysisResult, HorizonInput, LimitStatus } from "../contract/types";
import { fmtHours, fmtUtc } from "../analysis/format";
import { BODY_NAME, STATUS_LABEL, limitReason, truncationNote } from "../analysis/wording";
import { ModeTag } from "./ModeTag";

export function StatusIcon({ status }: { status: LimitStatus }) {
  const p = { size: 16, weight: "bold" as const, "aria-hidden": true };
  if (status === "within") return <CheckCircle {...p} />;
  if (status === "exceeded") return <XCircle {...p} />;
  if (status === "indeterminate-missing-data") return <Question {...p} />;
  return <Warning {...p} />;
}

export function BodyCard({
  result,
  horizon,
  onAssumptions,
}: {
  result: AnalysisResult;
  horizon: HorizonInput;
  onAssumptions: () => void;
}) {
  const name = BODY_NAME[result.body];
  const lg = result.longestInterruption;
  const trunc = truncationNote(result);
  const id = `card-${result.body}`;
  return (
    <section className="panel body-card" aria-labelledby={id} data-testid={`card-${result.body}`}>
      <div className="head">
        <h3 className="body-title" id={id}>
          <span className={`swatch ${result.body}`} aria-hidden />
          Longest loss of {name} visibility
        </h3>
        <ModeTag horizon={horizon} />
      </div>
      {lg ? (
        <p className="big" data-testid={`longest-${result.body}`}>
          {fmtHours(lg.durationHours)}
          <small>within the selected analysis interval</small>
        </p>
      ) : (
        <p className="big" data-testid={`longest-${result.body}`}>
          None
          <small>
            {result.unknownHours > 0
              ? `no interruption in the known data; ${fmtHours(result.unknownHours)} missing`
              : `${name} centre above the modelled horizon throughout`}
          </small>
        </p>
      )}
      {lg && (
        <dl className="kv">
          <dt>Starts</dt>
          <dd className="num">{fmtUtc(lg.startUtc)}</dd>
          <dt>Ends</dt>
          <dd className="num">{fmtUtc(lg.endUtc)}</dd>
          <dt>All gaps</dt>
          <dd>
            {result.interruptionCount} {result.interruptionCount === 1 ? "interruption" : "interruptions"},{" "}
            {fmtHours(result.blockedHours)} blocked in total
            {result.unknownHours > 0 && <>, {fmtHours(result.unknownHours)} missing data</>}
          </dd>
        </dl>
      )}
      {trunc && (
        <div className="trunc" role="note">
          <Warning size={16} weight="bold" aria-hidden />
          <span>{trunc}</span>
        </div>
      )}
      {lg && horizon.kind === "terrain" && !(lg.touchesWindowStart && lg.touchesWindowEnd) && (
        <p className="hint" style={{ margin: 0 }} data-testid={`approx-${result.body}`}>
          Start and end times are approximate. Where the {name} skims the terrain, the stated horizon uncertainty of
          ±{horizon.uncertaintyDeg.toFixed(2)}° can move them by hours; see the near-horizon marks on the timeline.
        </p>
      )}
      {lg && result.longestInterruption?.adjacentToUnknown && (
        <div className="trunc" role="note">
          <Question size={16} weight="bold" aria-hidden />
          <span>This gap borders missing data, so it may be longer than shown.</span>
        </div>
      )}
      <div className="verdict" data-testid={`verdict-${result.body}`}>
        {result.limit ? (
          <>
            <span className={`status ${result.limit.status}`}>
              <StatusIcon status={result.limit.status} />
              {STATUS_LABEL[result.limit.status]}
              <span className="sr-only"> for the {name} limit of {fmtHours(result.limit.limitHours)}</span>
            </span>
            <p>{limitReason(result)}</p>
          </>
        ) : (
          <>
            <span className="status none">
              <MinusCircle size={16} weight="bold" aria-hidden />
              No {name} limit set
            </span>
            <p className="muted">Enter a tolerance in Mission period to check this interval against it.</p>
          </>
        )}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {result.body === "sun"
          ? "Sun centre above the modelled horizon. Not a power estimate."
          : "Earth centre above the modelled horizon. Not a radio-link estimate."}{" "}
        <button type="button" className="btn link" onClick={onAssumptions}>
          Assumptions &amp; sources
        </button>
      </p>
    </section>
  );
}
