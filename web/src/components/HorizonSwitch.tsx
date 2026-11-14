import { Info } from "@phosphor-icons/react";

export type HorizonMode = "geometric" | "terrain";

interface Props {
  mode: HorizonMode;
  onChange: (m: HorizonMode) => void;
  terrainAvailable: boolean;
  siteLoaded: boolean;
  siteName: string;
}

export function HorizonSwitch({ mode, onChange, terrainAvailable, siteLoaded, siteName }: Props) {
  return (
    <>
      <div className="segmented" role="radiogroup" aria-labelledby="horizon-h" aria-describedby="horizon-help">
        <label>
          <input
            type="radio"
            name="horizon"
            value="geometric"
            checked={mode === "geometric"}
            onChange={() => onChange("geometric")}
          />
          Geometric reference (no terrain)
        </label>
        <label>
          <input
            type="radio"
            name="horizon"
            value="terrain"
            checked={mode === "terrain"}
            disabled={!terrainAvailable}
            onChange={() => onChange("terrain")}
          />
          Terrain (LOLA)
        </label>
      </div>
      <p id="horizon-help" className="hint">
        {!siteLoaded
          ? "Loading site data."
          : terrainAvailable
            ? "Geometric: a flat local horizon at 0° elevation. Terrain: horizon elevation per azimuth computed from LOLA elevation data."
            : null}
      </p>
      {siteLoaded && !terrainAvailable && (
        <div className="notice info" role="note">
          <Info size={16} weight="bold" aria-hidden />
          <span>
            Terrain (LOLA) is unavailable for {siteName}: this dataset has no terrain horizon for it. Only the geometric
            reference horizon (no terrain) can be analysed.
          </span>
        </div>
      )}
    </>
  );
}
