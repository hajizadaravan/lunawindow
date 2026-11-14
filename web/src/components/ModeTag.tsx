import { Mountains, LineSegment } from "@phosphor-icons/react";
import type { HorizonInput } from "../contract/types";

export function modeName(h: Pick<HorizonInput, "kind">) {
  return h.kind === "terrain" ? "Terrain (LOLA)" : "Geometric reference (no terrain)";
}

/** Labels which horizon model a result was computed with. Shape (solid vs dashed, icon) differs, not only colour. */
export function ModeTag({ horizon }: { horizon: Pick<HorizonInput, "kind"> }) {
  const terrain = horizon.kind === "terrain";
  return (
    <span className={`mode-tag ${horizon.kind}`} data-testid="mode-tag">
      {terrain ? <Mountains size={14} weight="bold" aria-hidden /> : <LineSegment size={14} weight="bold" aria-hidden />}
      Horizon: {modeName(horizon)}
    </span>
  );
}
