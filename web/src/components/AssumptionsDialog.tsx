import { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";
import type { BodyId, HorizonInput, Manifest, SiteDataset } from "../contract/types";
import { fmtUtc } from "../analysis/format";
import { modeName } from "./ModeTag";

interface Props {
  open: boolean;
  onClose: () => void;
  manifest: Manifest;
  site: SiteDataset | null;
  horizon: HorizonInput | null;
  bands: Record<BodyId, number> | null;
}

const m = (v: number | null | undefined, unit = "m") => (v === null || v === undefined ? "not available" : `${v} ${unit}`);

export function AssumptionsDialog({ open, onClose, manifest, site, horizon, bands }: Props) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const terrain = site?.horizons.terrain ?? null;
  const geo = site?.horizons.geometric ?? null;
  const sourceTitle = (id: string) => manifest.sources.find((s) => s.id === id)?.title ?? id;

  return (
    <dialog
      ref={ref}
      className="assumptions"
      aria-labelledby="asm-h"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      data-testid="assumptions"
    >
      <div className="dialog-head">
        <h2 id="asm-h">Assumptions &amp; sources</h2>
        <button className="btn" type="button" onClick={onClose} aria-label="Close assumptions and sources">
          <X size={16} weight="bold" aria-hidden />
          Close
        </button>
      </div>
      <div className="dialog-body">
        <section>
          <h3>What these results mean</h3>
          <ul>
            <li>Visibility is computed for the apparent direction of the body centre against a modelled horizon.</li>
            <li>Sun visible is not available power. Earth-centre visible is not a working radio link.</li>
            <li>Your limits are tolerances you choose, not computed battery endurance or link budgets.</li>
            <li>
              Every gap is measured within the selected analysis interval. A gap touching the start or end of the
              interval may continue outside it.
            </li>
            <li>This is an exploratory prototype. It does not certify landing safety, power or communication, and it ranks no site.</li>
          </ul>
        </section>

        <section>
          <h3>Dataset disclaimers</h3>
          {manifest.synthetic && (
            <p>
              <strong>This dataset is synthetic test data and contains no NASA measurements.</strong>
            </p>
          )}
          <ul>
            {manifest.disclaimers.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Generated</dt>
            <dd className="num">{fmtUtc(manifest.generatedAtUtc)}</dd>
            <dt>Generator</dt>
            <dd>
              {manifest.generator.name} {manifest.generator.version}
            </dd>
            <dt>Data range</dt>
            <dd className="num">
              {fmtUtc(manifest.supportedRange.startUtc)} to {fmtUtc(manifest.supportedRange.endUtc)}
            </dd>
          </dl>
        </section>

        <section>
          <h3>Horizon model in use</h3>
          {horizon ? (
            <p>
              <strong>{modeName(horizon)}</strong>
              {site && !terrain && " (no terrain horizon exists for this site)"}.
            </p>
          ) : (
            <p>No site loaded.</p>
          )}
          {geo && (
            <>
              <p style={{ marginBottom: 4 }}>
                <strong>{geo.label}</strong>: elevation {geo.elevationDeg}°, uncertainty {geo.uncertaintyDeg}°.
              </p>
              <ul>
                {geo.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </>
          )}
          {terrain ? (
            <>
              <p style={{ marginBottom: 4, marginTop: 10 }}>
                <strong>{terrain.label}</strong>
              </p>
              <dl className="kv">
                <dt>Azimuth step</dt>
                <dd className="num">{terrain.azimuthStepDeg}°</dd>
                <dt>Uncertainty</dt>
                <dd className="num">{terrain.uncertaintyDeg}°</dd>
                <dt>Search extent</dt>
                <dd className="num">{m(terrain.searchExtentM)}</dd>
                <dt>Near-field start</dt>
                <dd className="num">{m(terrain.nearFieldStartM)}</dd>
                <dt>Curvature</dt>
                <dd>{terrain.curvatureModel}</dd>
                <dt>Coverage limited</dt>
                <dd>
                  {terrain.coverageLimited.filter(Boolean).length} of {terrain.coverageLimited.length} azimuth bins left
                  valid DEM coverage before the search extent
                </dd>
                <dt>DEM</dt>
                <dd className="break">
                  {terrain.dem.product} ({sourceTitle(terrain.dem.sourceId)}), {terrain.dem.resolutionM} m,{" "}
                  {terrain.dem.projection}
                </dd>
                <dt>Height reference</dt>
                <dd>{terrain.dem.heightReference}</dd>
                <dt>Scaling</dt>
                <dd>{terrain.dem.scaling}</dd>
              </dl>
              <ul style={{ marginTop: 8 }}>
                {terrain.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </>
          ) : (
            site && <p>Terrain horizon: not available for {site.site.name}.</p>
          )}
        </section>

        {site && (
          <section>
            <h3>Observer and frame: {site.site.name}</h3>
            <p style={{ marginTop: 0 }}>{site.site.description}</p>
            <dl className="kv">
              <dt>Position</dt>
              <dd className="num">
                {site.site.latDeg}°, {site.site.lonEastDeg}°E
              </dd>
              <dt>Frame</dt>
              <dd>{site.site.frame}</dd>
              <dt>Frame note</dt>
              <dd>{site.site.frameNote}</dd>
              <dt>Reference sphere</dt>
              <dd className="num">{m(site.site.referenceRadiusM)}</dd>
              <dt>Surface elevation</dt>
              <dd className="num">{m(site.site.surfaceElevationM)}</dd>
              <dt>Observer height</dt>
              <dd className="num">{m(site.site.observerHeightM)} above the surface</dd>
              <dt>Observer altitude</dt>
              <dd className="num">{m(site.site.observerAltitudeM)} above the sphere</dd>
            </dl>
            <p style={{ marginBottom: 4 }}>Site checks:</p>
            <ul>
              {site.site.siteChecks.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {site && (
          <section>
            <h3>Ephemeris and time grid</h3>
            <dl className="kv">
              <dt>Source</dt>
              <dd>{sourceTitle(site.ephemeris.sourceId)}</dd>
              <dt>Retrieved</dt>
              <dd className="num">{fmtUtc(site.ephemeris.retrievedAtUtc)}</dd>
              <dt>Corrections</dt>
              <dd>{site.ephemeris.corrections}</dd>
              <dt>Time step</dt>
              <dd className="num">
                {site.time.stepSeconds} s ({site.time.stepSeconds / 60} min), {site.time.count} samples from{" "}
                {fmtUtc(site.time.startUtc)}, {site.time.scale}
              </dd>
              <dt>Body centre</dt>
              <dd>
                Visibility uses the body centre. Angular radius Sun{" "}
                <span className="num">{site.ephemeris.bodies.sun.angularRadiusDeg.max.toFixed(4)}°</span>, Earth{" "}
                <span className="num">{site.ephemeris.bodies.earth.angularRadiusDeg.max.toFixed(4)}°</span> (maximum),
                so part of a disc can show while its centre is blocked.
              </dd>
              <dt>Near-horizon band</dt>
              <dd>
                {bands ? (
                  <>
                    Sun <span className="num">{bands.sun.toFixed(4)}°</span>, Earth{" "}
                    <span className="num">{bands.earth.toFixed(4)}°</span>: maximum angular radius plus the active
                    horizon uncertainty. Inside it the visible/blocked label is not reliable.
                  </>
                ) : (
                  "computed once an analysis runs"
                )}
              </dd>
              <dt>Crossings</dt>
              <dd>Rise and set times are linearly interpolated between samples.</dd>
            </dl>
            <p style={{ marginBottom: 4 }}>Query parameters:</p>
            <div className="table-scroll">
              <table className="data">
                <tbody>
                  {Object.entries(site.ephemeris.query).map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row" className="mono">
                        {k}
                      </th>
                      <td className="mono break">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Raw responses: <span className="mono break">{site.ephemeris.bodies.sun.rawFile}</span>,{" "}
              <span className="mono break">{site.ephemeris.bodies.earth.rawFile}</span>
            </p>
          </section>
        )}

        {manifest.map && (
          <section>
            <h3>Overview map</h3>
            <p style={{ margin: 0 }}>
              {manifest.map.rendering}. Source: {sourceTitle(manifest.map.sourceId)}.
            </p>
          </section>
        )}

        <section>
          <h3>Sources</h3>
          <ul>
            {manifest.sources.map((s) => (
              <li key={s.id}>
                <strong>{s.title}</strong>. Used for: {s.usedFor}.{" "}
                {/^https?:\/\//i.test(s.url) && (
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="break">
                    {s.url}
                  </a>
                )}
                {s.retrievedAtUtc && <> Retrieved {fmtUtc(s.retrievedAtUtc)}.</>}
                {s.citation && <div className="hint">{s.citation}</div>}
                {s.sha256 && <div className="hint mono break">sha256 {s.sha256}</div>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </dialog>
  );
}
