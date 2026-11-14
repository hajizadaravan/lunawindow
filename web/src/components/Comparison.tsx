import type { AnalysisResult, HorizonInput } from "../contract/types";
import { fmtHours, fmtSignedHours, fmtUtc } from "../analysis/format";
import { BODY_NAME, STATUS_LABEL, comparisonSummary } from "../analysis/wording";
import { ModeTag } from "./ModeTag";
import { StatusIcon } from "./BodyCard";

type Pair = { sun: AnalysisResult; earth: AnalysisResult };

interface Props {
  shiftHours: number;
  base: Pair;
  shifted: Pair;
  horizon: HorizonInput;
  onAssumptions: () => void;
}

function Gap({ r }: { r: AnalysisResult }) {
  const lg = r.longestInterruption;
  if (!lg) return <>none</>;
  return (
    <>
      {fmtHours(lg.durationHours)}
      <span className="sub">
        {fmtUtc(lg.startUtc)}
        {lg.boundaryTruncated && ", touches window edge, may continue"}
      </span>
    </>
  );
}

function Status({ r }: { r: AnalysisResult }) {
  if (!r.limit) return <span className="muted">no limit set</span>;
  return (
    <span className={`status ${r.limit.status}`}>
      <StatusIcon status={r.limit.status} />
      {STATUS_LABEL[r.limit.status]}
    </span>
  );
}

export function Comparison(p: Props) {
  const { base, shifted } = p;
  const diff = (b: "sun" | "earth") =>
    (shifted[b].longestInterruption?.durationHours ?? 0) - (base[b].longestInterruption?.durationHours ?? 0);
  return (
    <section className="panel" aria-labelledby="cmp-h" data-testid="comparison">
      <div className="panel-head">
        <h2 id="cmp-h">Details: baseline vs start {p.shiftHours} hours later</h2>
        <ModeTag horizon={p.horizon} />
      </div>
      {(
        <>
          <div className="table-scroll" style={{ maxHeight: "none", marginTop: 12 }}>
            <table className="compare-table">
              <caption className="sr-only">Baseline versus start {p.shiftHours} hours later</caption>
              <thead>
                <tr>
                  <th scope="col"></th>
                  <th scope="col">
                    Baseline
                    <span className="sub num">{fmtUtc(base.sun.windowStartUtc)}</span>
                  </th>
                  <th scope="col">
                    +{p.shiftHours} h
                    <span className="sub num">{fmtUtc(shifted.sun.windowStartUtc)}</span>
                  </th>
                  <th scope="col">Difference</th>
                </tr>
              </thead>
              <tbody>
                {(["sun", "earth"] as const).map((b) => (
                  <tr key={b}>
                    <th scope="row">Longest {BODY_NAME[b]} gap</th>
                    <td className="num">
                      <Gap r={base[b]} />
                    </td>
                    <td className="num">
                      <Gap r={shifted[b]} />
                    </td>
                    <td className="num">{fmtSignedHours(diff(b))}</td>
                  </tr>
                ))}
                {(["sun", "earth"] as const).map((b) => (
                  <tr key={`${b}-limit`}>
                    <th scope="row">
                      {BODY_NAME[b]} limit
                      {base[b].limit && <span className="sub num">{fmtHours(base[b].limit!.limitHours)}</span>}
                    </th>
                    <td>
                      <Status r={base[b]} />
                    </td>
                    <td>
                      <Status r={shifted[b]} />
                    </td>
                    <td>
                      {base[b].limit && shifted[b].limit
                        ? base[b].limit!.status === shifted[b].limit!.status
                          ? "unchanged"
                          : "changed"
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="summary" data-testid="comparison-summary">
            {comparisonSummary(p.shiftHours, base, shifted)}
          </p>
          <p className="hint">
            Both windows have the same duration and horizon model; durations are within each selected analysis
            interval.{" "}
            <button type="button" className="btn link" onClick={p.onAssumptions}>
              Assumptions &amp; sources
            </button>
          </p>
        </>
      )}
    </section>
  );
}
