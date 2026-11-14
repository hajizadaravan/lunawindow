import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { BodyId, SiteDataset, VisState } from "../contract/types";
import { dataUrl } from "../lib/data";
import { directionFromAzEl, shortAzimuthDelta, validateTerrainMetadata, type Directions } from "./geometry";

export type Lighting = "sun" | "relief";
export type ViewKind = "overview" | "top" | "sun" | "earth";
/** Directions to draw and, per body, the visibility state read from the analysis results (never from the scene). */
export interface Frame {
  directions: Directions;
  state: Record<BodyId, VisState>;
}
/** Advances playback by one animation frame; returns false when playback has ended. */
export type FrameDriver = (now: number) => boolean;

export interface TerrainScene {
  setFrame(frame: Frame): void;
  setLighting(mode: Lighting): void;
  view(kind: ViewKind): void;
  setDriver(driver: FrameDriver | null): void;
  dispose(): void;
}

const VIEW_MS = 600;
const SETTLE_MS = 850;
const BODIES: BodyId[] = ["sun", "earth"];
const STATES: VisState[] = ["visible", "blocked", "unknown"];
const STATE_CAPTION: Record<VisState, string> = { visible: "CENTRE VISIBLE", blocked: "CENTRE BLOCKED", unknown: "NO DATA" };

const reducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function createTerrainScene(host: HTMLDivElement, site: SiteDataset, demSha256: string | null, signal: AbortSignal, onContextLost: () => void): Promise<TerrainScene> {
  // Only a known, validated site ID may select a model. No remote resources at runtime.
  if (!/^demo-[abc]$/.test(site.site.id) || site.synthetic) throw new Error("No measured 3D model is available for this dataset.");
  const base = `terrain3d/${site.site.id}`;
  const response = await fetch(dataUrl(`${base}.json`), { signal });
  if (!response.ok) throw new Error("The measured terrain model is unavailable. The charts still work.");
  let meta: unknown;
  try { meta = await response.json(); } catch { signal.throwIfAborted(); throw new Error("The terrain model description could not be read."); }
  validateTerrainMetadata(meta, site, demSha256);
  const modelResponse = await fetch(dataUrl(`${base}.glb`), { signal });
  if (!modelResponse.ok) throw new Error("The terrain model could not be downloaded.");
  const bytes = await modelResponse.arrayBuffer();
  if (bytes.byteLength !== meta.bytes) throw new Error("The terrain download is incomplete.");
  // Fails closed: without Web Crypto (a page served over plain HTTP from another machine) the model is not shown.
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify the terrain model here (it needs HTTPS or localhost). The charts still work.");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== meta.sha256) throw new Error("The terrain model failed its integrity check.");
  signal.throwIfAborted();
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  const disposeMaterial = (material: THREE.Material) => {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
    material.dispose();
  };
  const disposeModel = () => gltf.scene.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) disposeMaterial(material);
    }
  });
  if (signal.aborted) { disposeModel(); signal.throwIfAborted(); }
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  } catch {
    disposeModel();
    throw new Error("3D is unavailable on this device. You can still use the map, sky plot and timelines.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", "Measured lunar terrain. Drag to orbit and scroll to zoom; view buttons are available below.");
  canvas.setAttribute("role", "img");
  canvas.dataset.frameLoop = "idle";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#080d14");
  scene.add(gltf.scene);
  const camera = new THREE.PerspectiveCamera(45, 1, 10, 800_000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.minDistance = 750;
  controls.maxDistance = 180_000;
  controls.maxPolarAngle = Math.PI * 0.48;
  const ambient = new THREE.AmbientLight(0xc6d5ec, 0.3);
  const light = new THREE.DirectionalLight(0xfff5e5, 3);
  scene.add(ambient, light, light.target);
  const overlays = new THREE.Group();
  scene.add(overlays);
  const bodyColor = { sun: 0xffa460, earth: 0x7abaff };
  const captionColor = { sun: "#ffba80", earth: "#93caff" };
  // Greys are chosen per lighting so a blocked or no-data ray stays readable on dark (Sun) and pale (relief) ground.
  const grey = { sun: { blocked: 0xa3aebb, unknown: 0x5b6676, ring: 0x6b7685 }, relief: { blocked: 0x323b47, unknown: 0x8a939e, ring: 0x323b47 } };
  const blockedColor = grey.sun.blocked;

  // Labels are drawn at a fixed on-screen size (CSS px), wherever the camera is: sizeAttenuation is off and the
  // scale is recomputed from the viewport height and field of view. layoutLabels() keeps them from piling up.
  type Label = { sprite: THREE.Sprite; aspect: number; px: number; priority: number; baseY: number; optional: boolean };
  const labels: Label[] = [];
  let viewW = 1;
  let viewH = 1;
  const PIXEL = 2; // canvas pixels per CSS pixel, so text stays sharp on high-density screens
  function label(text: string, color: string, opts: { px: number; backdrop?: boolean; priority: number; anchorY?: number; optional?: boolean }) {
    const h = opts.px * PIXEL;
    const fontPx = Math.round(h * (opts.backdrop ? 0.5 : 0.72));
    const c = document.createElement("canvas");
    const measure = c.getContext("2d")!;
    measure.font = `600 ${fontPx}px system-ui, sans-serif`;
    const w = Math.ceil(measure.measureText(text).width + (opts.backdrop ? h * 0.7 : 4));
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (opts.backdrop) {
      // A dark plate keeps the text readable over pale relief-lit ground.
      ctx.fillStyle = "rgba(8, 13, 20, 0.84)";
      ctx.beginPath(); ctx.roundRect(0, 0, w, h, h * 0.22); ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2 + 1);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    sprite.renderOrder = 10;
    const baseY = opts.anchorY ?? 0.5;
    sprite.center.set(0.5, baseY);
    labels.push({ sprite, aspect: w / h, px: opts.px, priority: opts.priority, baseY, optional: opts.optional ?? false });
    sizeLabel(labels[labels.length - 1]);
    return sprite;
  }
  function sizeLabel(l: Label) {
    // Without size attenuation a sprite of scale s spans s / tan(fov / 2) in clip space, i.e. s / tan(fov / 2) * H / 2 px.
    const y = (l.px * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / viewH;
    l.sprite.scale.set(y * l.aspect, y, 1);
  }
  const projected = new THREE.Vector3();
  /** Stack labels that would overlap on screen (higher priority keeps its place); drop optional ones that cannot fit. */
  function layoutLabels() {
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const gap = 3;
    for (const l of [...labels].sort((a, b) => a.priority - b.priority)) {
      l.sprite.center.y = l.baseY;
      if (!l.sprite.visible && !l.optional) continue;
      if (l.optional) l.sprite.visible = true;
      projected.copy(l.sprite.getWorldPosition(projected)).project(camera);
      if (projected.z > 1 || projected.z < -1) { if (l.optional) l.sprite.visible = false; continue; }
      const x = ((projected.x + 1) / 2) * viewW;
      const y = ((1 - projected.y) / 2) * viewH;
      const w = l.px * l.aspect;
      let fit = false;
      for (let k = 0; k < 4 && !fit; k++) {
        const shift = k * (l.px + gap); // move up by whole label heights
        const r = { x0: x - w / 2 - gap, x1: x + w / 2 + gap, y0: y - (1 - l.baseY) * l.px - shift, y1: y + l.baseY * l.px - shift };
        if (!placed.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) {
          placed.push(r);
          l.sprite.center.y = l.baseY - shift / l.px;
          fit = true;
        }
        if (l.optional) break; // compass letters never move; they give way instead
      }
      if (!fit) {
        if (l.optional) l.sprite.visible = false;
        else l.sprite.center.y = l.baseY; // nothing fits: leave it in place rather than hide a state caption
      }
    }
  }

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, site.site.observerHeightM, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  mast.position.y = site.site.observerHeightM / 2;
  overlays.add(mast);
  // The marker is an annotation, deliberately larger than the actual two-metre mast. Inner ring: Sun; outer ring: Earth.
  const ring = (inner: number, outer: number) => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, side: THREE.DoubleSide, transparent: true }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = 5; mesh.renderOrder = 5;
    overlays.add(mesh);
    return mesh;
  };
  const marker = { sun: ring(110, 175), earth: ring(205, 270) };
  // The point label sits just below the marker; captions sit above their ray heads.
  const siteLabel = label(`POINT ${site.site.id.slice(-1).toUpperCase()}`, "#f0f4fa", { px: 20, backdrop: true, priority: 0, anchorY: 1.35 });
  siteLabel.position.set(0, 5, 0); overlays.add(siteLabel);
  for (const [name, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const) {
    const l = label(name, "#91a5ba", { px: 18, priority: 3, optional: true });
    l.position.fromArray(directionFromAzEl(az, 0)).multiplyScalar(14_000);
    l.position.y = 1200;
    overlays.add(l);
  }
  const makeGuide = (body: BodyId) => {
    const color = bodyColor[body];
    const points = [new THREE.Vector3(), new THREE.Vector3()];
    // Visible: a solid ray and a solid head. Blocked: a grey dashed ray and an open (wire) head. No data: faint dots.
    const solid = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
    const dashedMaterial = new THREE.LineDashedMaterial({ color: blockedColor, dashSize: 350, gapSize: 220, depthTest: false, transparent: true, opacity: 0.9 });
    const dashed = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), dashedMaterial);
    solid.renderOrder = dashed.renderOrder = 6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(180, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
    const openHead = new THREE.Mesh(new THREE.SphereGeometry(180, 10, 8), new THREE.MeshBasicMaterial({ color: blockedColor, wireframe: true, depthTest: false, depthWrite: false }));
    head.renderOrder = openHead.renderOrder = 8;
    const name = body === "sun" ? "SUN" : "EARTH";
    const captions = Object.fromEntries(STATES.map(s => {
      const sprite = label(`${name} · ${STATE_CAPTION[s]}`, s === "visible" ? captionColor[body] : s === "blocked" ? "#d3dbe5" : "#8996a8",
        { px: 22, backdrop: true, priority: body === "sun" ? 1 : 2, anchorY: -0.45 });
      overlays.add(sprite);
      return [s, sprite];
    })) as Record<VisState, THREE.Sprite>;
    overlays.add(solid, dashed, head, openHead);
    return { solid, dashed, dashedMaterial, head, openHead, captions };
  };
  const guides = { sun: makeGuide("sun"), earth: makeGuide("earth") };

  let frame: Frame = { directions: { sun: null, earth: null }, state: { sun: "unknown", earth: "unknown" } };
  let lighting: Lighting = "sun";
  let disposed = false;
  let lost = false;

  // ---- frame loop: runs only while a driver (playback) or a camera transition needs it; otherwise one frame per request.
  let frameId = 0;
  let framesDrawn = 0;
  let inFrame = false;
  let driver: FrameDriver | null = null;
  type Pose = { position: THREE.Vector3; target: THREE.Vector3 };
  let tween: { from: Pose; to: Pose; duration: number; start: number | null } | null = null;
  const setLoopFlag = () => { canvas.dataset.frameLoop = frameId ? "running" : "idle"; };
  const invalidate = () => {
    if (disposed || lost || frameId || inFrame) return;
    frameId = requestAnimationFrame(tick);
    setLoopFlag();
  };
  const stopLoop = () => { if (frameId) cancelAnimationFrame(frameId); frameId = 0; setLoopFlag(); };
  function tick(now: number) {
    frameId = 0;
    if (disposed || lost) return;
    inFrame = true;
    let more = false;
    try {
      if (driver && driver(now)) more = true;
      if (tween && stepTween(now)) more = true;
      layoutLabels();
      renderer.render(scene, camera);
      canvas.dataset.frames = String(++framesDrawn); // read by the frame-rate test
    } finally {
      inFrame = false;
    }
    if (more && !disposed && !lost) frameId = requestAnimationFrame(tick);
    setLoopFlag();
  }
  const renderNow = () => { if (!disposed && !lost) { layoutLabels(); renderer.render(scene, camera); } };

  const sphericalOf = (p: Pose) => new THREE.Spherical().setFromVector3(p.position.clone().sub(p.target));
  function stepTween(now: number): boolean {
    if (!tween) return false;
    if (tween.start === null) tween.start = now;
    const t = Math.min(1, (now - tween.start) / tween.duration);
    const e = ease(t);
    const a = sphericalOf(tween.from);
    const b = sphericalOf(tween.to);
    const target = tween.from.target.clone().lerp(tween.to.target, e);
    // Orbit around the target (radius, tilt, and azimuth the short way) so the camera never cuts through the terrain.
    const theta = a.theta + THREE.MathUtils.degToRad(shortAzimuthDelta(THREE.MathUtils.radToDeg(a.theta), THREE.MathUtils.radToDeg(b.theta))) * e;
    const s = new THREE.Spherical(a.radius + (b.radius - a.radius) * e, a.phi + (b.phi - a.phi) * e, theta);
    controls.target.copy(target);
    camera.position.setFromSpherical(s).add(target);
    controls.update();
    if (t >= 1) { tween = null; return false; }
    return true;
  }
  const cancelTween = () => { tween = null; };
  controls.addEventListener("start", cancelTween);
  controls.addEventListener("change", invalidate);

  function poseFor(kind: ViewKind): Pose | null {
    const target = new THREE.Vector3(0, -350, 0);
    const position = new THREE.Vector3();
    if (kind === "top") position.set(0, 48000, 1);
    else if (kind === "sun" || kind === "earth") {
      const body = frame.directions[kind];
      if (!body) return null;
      position.fromArray(directionFromAzEl(body.az + 180, 0)).multiplyScalar(20000);
      position.y = 11000;
    } else position.set(18000, 18000, 24000);
    // A narrow view (phone) stands farther back so both rays, 12–16 km long, stay in frame.
    if (kind !== "top") position.multiplyScalar(Math.max(1, 1.5 / Math.max(camera.aspect, 0.3)));
    return { position, target };
  }
  function moveTo(to: Pose, duration: number, from?: Pose) {
    if (reducedMotion()) {
      tween = null;
      controls.target.copy(to.target); camera.position.copy(to.position); controls.update();
      invalidate();
      return;
    }
    tween = { from: from ?? { position: camera.position.clone(), target: controls.target.clone() }, to, duration, start: null };
    invalidate();
  }

  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    viewW = width; viewH = height;
    for (const l of labels) sizeLabel(l);
    renderer.setSize(width, height, false);
    renderNow(); // setSize clears the canvas; draw now so it never shows blank
  });
  resize.observe(host);
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true; driver = null; tween = null; stopLoop();
    onContextLost();
  };
  canvas.addEventListener("webglcontextlost", contextLost);

  function applyLighting() {
    if (lighting === "relief") {
      light.position.set(-20000, 35000, 10000); light.intensity = 2; ambient.intensity = 0.25;
    } else {
      const sun = frame.directions.sun;
      if (sun) light.position.fromArray(directionFromAzEl(sun.az, sun.el)).multiplyScalar(50000);
      light.intensity = sun ? 3.5 : 0;
      ambient.intensity = 0.12; // explicitly labelled fill light, for legibility only
    }
  }

  function applyFrame() {
    applyLighting();
    for (const body of BODIES) {
      const d = frame.directions[body];
      const state = frame.state[body];
      const g = guides[body];
      const m = marker[body].material as THREE.MeshBasicMaterial;
      const tone = grey[lighting];
      m.color.setHex(state === "visible" ? bodyColor[body] : state === "blocked" ? tone.ring : tone.unknown);
      m.opacity = state === "unknown" ? 0.35 : 1;
      canvas.dataset[`${body}State`] = state;
      const show = d !== null;
      g.solid.visible = show && state === "visible";
      g.dashed.visible = show && state !== "visible";
      g.head.visible = show && state === "visible";
      g.openHead.visible = show && state === "blocked";
      for (const s of STATES) g.captions[s].visible = show && s === state;
      if (!d) continue;
      g.dashedMaterial.color.setHex(state === "blocked" ? tone.blocked : tone.unknown);
      (g.openHead.material as THREE.MeshBasicMaterial).color.setHex(tone.blocked);
      g.dashedMaterial.dashSize = state === "blocked" ? 350 : 90;
      g.dashedMaterial.gapSize = state === "blocked" ? 220 : 300;
      const tip = new THREE.Vector3().fromArray(directionFromAzEl(d.az, d.el)).multiplyScalar(body === "sun" ? 16000 : 12000);
      tip.y += site.site.observerHeightM;
      for (const line of [g.solid, g.dashed]) {
        const positions = line.geometry.getAttribute("position") as THREE.BufferAttribute;
        positions.setXYZ(0, 0, site.site.observerHeightM, 0);
        positions.setXYZ(1, tip.x, tip.y, tip.z);
        positions.needsUpdate = true;
        line.geometry.computeBoundingSphere();
      }
      g.dashed.computeLineDistances();
      g.head.position.copy(tip);
      g.openHead.position.copy(tip);
      for (const s of STATES) g.captions[s].position.copy(tip);
    }
  }

  const api: TerrainScene = {
    setFrame(next) {
      if (disposed) return;
      frame = next;
      applyFrame();
      invalidate();
    },
    setLighting(mode) {
      if (disposed) return;
      lighting = mode;
      applyFrame();
      invalidate();
    },
    view(kind) {
      if (disposed) return;
      const to = poseFor(kind);
      if (to) moveTo(to, VIEW_MS);
    },
    setDriver(next) {
      if (disposed) return;
      driver = next;
      if (driver) invalidate();
      // Without a driver the loop stops after the frame already requested (if any), unless a camera move needs it.
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      driver = null; tween = null; stopLoop();
      resize.disconnect();
      controls.removeEventListener("start", cancelTween);
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      canvas.removeEventListener("webglcontextlost", contextLost);
      disposeModel();
      overlays.traverse(obj => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) obj.geometry.dispose();
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
          for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) disposeMaterial(m);
        }
      });
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
  { const { width, height } = host.getBoundingClientRect(); if (width > 0 && height > 0) { camera.aspect = width / height; camera.updateProjectionMatrix(); viewW = width; viewH = height; for (const l of labels) sizeLabel(l); } }
  // Settle in: a short glide from a wider, higher pose to the overview (a plain snap with reduced motion).
  const overview = poseFor("overview")!;
  const start = { position: overview.position.clone().multiplyScalar(1.45).setY(overview.position.y * 1.9), target: overview.target.clone() };
  controls.target.copy(start.target); camera.position.copy(start.position); controls.update();
  moveTo(overview, SETTLE_MS, start);
  return api;
}
