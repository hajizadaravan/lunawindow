import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { BodyId, SiteDataset, VisState } from "../contract/types";
import { dataUrl } from "../lib/data";
import { directionFromAzEl, shortAzimuthDelta, validateDisplaySkyline, validateTerrainMetadata, type Directions, type DisplaySkyline } from "./geometry";
import type { SurfaceAgreement } from "./playback";

export type Lighting = "sun" | "relief";
export type ViewKind = "overview" | "top" | "sun" | "earth";
/**
 * Directions to draw and, per body, the visibility state read from the analysis results (never from the scene), and
 * whether the drawn surface agrees with that state (display only; it never changes the state).
 */
export interface Frame {
  directions: Directions;
  state: Record<BodyId, VisState>;
  surface: Record<BodyId, SurfaceAgreement>;
  /** Geometric (flat 0°) mode: there a disagreement means "terrain ignored by this mode", not a mesh fault. */
  geometric: boolean;
}
/** Advances playback by one animation frame; returns false when playback has ended. */
export type FrameDriver = (now: number) => boolean;

export interface TerrainScene {
  /** The drawn mesh's skyline, verified against this exact GLB. */
  readonly skyline: DisplaySkyline;
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
/** Caption variants: the state alone, or flagged because the drawn surface tells a different story (terrain mode), or
 *  because the flat geometric mode ignores the terrain drawn across the ray. */
type CaptionVariant = "plain" | "differs" | "flat";
type CaptionKey = `${VisState}:${CaptionVariant}`;
const CAPTION_SUFFIX: Record<CaptionVariant, string> = { plain: "", differs: " · 3D SURFACE DIFFERS", flat: " · TERRAIN IGNORED" };
const captionKey = (state: VisState, surface: SurfaceAgreement, geometric: boolean): CaptionKey =>
  `${state}:${surface !== "differs" ? "plain" : geometric ? "flat" : "differs"}`;

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
  // The drawn surface's skyline, bound to the GLB by its sha256: without it the view could not say when the surface
  // on screen and the analysis result disagree, so it is required like the model itself.
  const skylineResponse = await fetch(dataUrl(`${base}.skyline.json`), { signal });
  if (!skylineResponse.ok) throw new Error("The terrain model's skyline check is unavailable. The charts still work.");
  let skyline: unknown;
  try { skyline = await skylineResponse.json(); } catch { signal.throwIfAborted(); throw new Error("The terrain model's skyline check could not be read."); }
  validateDisplaySkyline(skyline, site, meta.sha256);
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
  // Cast shadows from the display mesh (Sun lighting only). Rendered only when the Sun or the shadowed region moves.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", "Measured lunar terrain. Drag to orbit and scroll to zoom; view buttons are available below.");
  canvas.setAttribute("role", "img");
  canvas.dataset.frameLoop = "idle";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#080d14");
  scene.add(gltf.scene);
  gltf.scene.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.receiveShadow = true; } });
  const modelBox = new THREE.Box3().setFromObject(gltf.scene);
  const camera = new THREE.PerspectiveCamera(45, 1, 10, 800_000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.minDistance = 750;
  controls.maxDistance = 180_000;
  controls.maxPolarAngle = Math.PI * 0.48;
  const ambient = new THREE.AmbientLight(0xc6d5ec, 0.3);
  const light = new THREE.DirectionalLight(0xfff5e5, 3);
  // 4096² on desktops; 2048² on phones and small or touch screens (a 4096² depth target is about 64 MB).
  const small = Boolean(window.matchMedia?.("(max-width: 820px), (pointer: coarse)").matches);
  const SHADOW_MAP = Math.min(small ? 2048 : 4096, renderer.capabilities.maxTextureSize);
  light.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  light.shadow.normalBias = 0; // see prepareShadows: the offset is taken along the light, not along the normal
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
      const w = l.px * l.aspect;
      // A caption whose anchor sits near a side edge slides inward rather than being cut off (phones especially).
      const ax = ((projected.x + 1) / 2) * viewW;
      const edge = 4;
      const x = l.optional || w + 2 * edge > viewW ? ax : Math.min(viewW - edge - w / 2, Math.max(edge + w / 2, ax));
      l.sprite.center.x = 0.5 - (x - ax) / w;
      const y = ((1 - projected.y) / 2) * viewH;
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
    // No data is never compared with the surface, so it has only the plain caption.
    const captions = Object.fromEntries(STATES.flatMap(s => (s === "unknown" ? (["plain"] as const) : (["plain", "differs", "flat"] as const)).map(variant => {
      const text = `${name} · ${STATE_CAPTION[s]}${CAPTION_SUFFIX[variant]}`;
      const sprite = label(text, s === "visible" ? captionColor[body] : s === "blocked" ? "#d3dbe5" : "#8996a8",
        { px: 22, backdrop: true, priority: body === "sun" ? 1 : 2, anchorY: -0.45 });
      overlays.add(sprite);
      return [`${s}:${variant}`, sprite];
    }))) as Partial<Record<CaptionKey, THREE.Sprite>>;
    overlays.add(solid, dashed, head, openHead);
    return { solid, dashed, dashedMaterial, head, openHead, captions };
  };
  const guides = { sun: makeGuide("sun"), earth: makeGuide("earth") };

  let frame: Frame = { directions: { sun: null, earth: null }, state: { sun: "unknown", earth: "unknown" }, surface: { sun: "unchecked", earth: "unchecked" }, geometric: false };
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
      prepareShadows();
      renderer.render(scene, camera);
      canvas.dataset.frames = String(++framesDrawn); // read by the frame-rate test
    } finally {
      inFrame = false;
    }
    if (more && !disposed && !lost) frameId = requestAnimationFrame(tick);
    setLoopFlag();
  }
  const renderNow = () => { if (!disposed && !lost) { layoutLabels(); prepareShadows(); renderer.render(scene, camera); } };

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

  /** Unit vector toward the light: the Sun direction, or the fixed relief light. */
  const lightDir = new THREE.Vector3();
  function applyLighting() {
    const sun = frame.directions.sun;
    if (lighting === "relief") {
      lightDir.set(-20000, 35000, 10000).normalize(); light.intensity = 2; ambient.intensity = 0.25;
    } else {
      if (sun) lightDir.fromArray(directionFromAzEl(sun.az, sun.el));
      light.intensity = sun ? 3.5 : 0;
      ambient.intensity = 0.4; // explicitly labelled fill light, so ground in shadow stays readable
    }
    // Relief light is a reading aid, so it casts nothing; the Sun casts shadows from the drawn mesh. Switched only with
    // the lighting choice (switching recompiles materials); a moment without a Sun direction just has no light.
    const cast = lighting === "sun";
    if (light.castShadow !== cast) { light.castShadow = cast; shadowKey = ""; canvas.dataset.shadows = cast ? "on" : "off"; }
    // Redraw only when the Sun moves: azimuth in 0.005° steps, elevation in 0.001° steps (at a 1° Sun an elevation
    // step moves the shadow edge of a 500 m ridge by about 30 m). Saves redraws when paused or between samples.
    if (cast && sun) sunKey = `${Math.round(sun.az / 0.005)},${Math.round(sun.el / 0.001)}`;
    placeLight();
  }

  // ---- shadows: one orthographic shadow map, fitted in light space to the terrain the camera can see (where the
  // view's corner rays meet the ground, at least 15 km around the target, at most the whole model), so terrain in view
  // has shadows and there is no lit band beyond the map. Depth always spans the whole model, so far ridges toward the
  // Sun still cast.
  let shadowKey = "";
  let sunKey = "";
  let shadowDraws = 0;
  const region = { x: 0, z: 0, r: 15000 };
  const fitCamera = new THREE.OrthographicCamera();
  const corner = new THREE.Vector3();
  const ray = new THREE.Vector3();
  const halfWidth = Math.max(modelBox.max.x - modelBox.min.x, modelBox.max.z - modelBox.min.z) / 2;
  function placeLight() {
    const reach = modelBox.getSize(corner).length() + 10_000; // beyond every vertex, toward the light
    light.target.position.set(region.x, 0, region.z);
    light.position.copy(lightDir).multiplyScalar(reach).add(light.target.position);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
  }
  // The model keeps lunar curvature: the origin sits on the site surface, so the Moon's centre is R + surface height
  // below it. Corner rays are met with the reference sphere lowered by 10 km (deeper than any crater floor here), so
  // the hit is never nearer than the real ground.
  const groundCentre = new THREE.Vector3(0, -(meta.referenceRadiusM + meta.origin.surfaceElevationM), 0);
  const groundRadius = meta.referenceRadiusM - 10_000;
  const toCamera = new THREE.Vector3();
  /** Horizontal distance from (x, z) to the farthest ground point in view, or the whole model when a corner of the
   *  view passes over the curved ground. */
  function viewReach(x: number, z: number): number {
    camera.updateMatrixWorld();
    toCamera.copy(camera.position).sub(groundCentre);
    const c = toCamera.lengthSq() - groundRadius * groundRadius;
    if (c <= 0) return 2 * halfWidth; // camera below the lowered ground: nothing to bound safely
    let reach = Math.hypot(camera.position.x - x, camera.position.z - z);
    for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      ray.set(cx, cy, 1).unproject(camera).sub(camera.position).normalize();
      const b = toCamera.dot(ray);
      const disc = b * b - c;
      if (b >= 0 || disc < 0) return 2 * halfWidth; // this corner misses the ground: cover the whole model
      const t = -b - Math.sqrt(disc);
      reach = Math.max(reach, Math.hypot(camera.position.x + ray.x * t - x, camera.position.z + ray.z * t - z));
    }
    return reach * 1.1;
  }
  function prepareShadows() {
    if (!light.castShadow || !frame.directions.sun) return;
    // The region follows the camera in coarse steps, so orbiting or small moves rarely redraw the shadow map.
    const tx = Math.min(modelBox.max.x, Math.max(modelBox.min.x, controls.target.x));
    const tz = Math.min(modelBox.max.z, Math.max(modelBox.min.z, controls.target.z));
    const want = Math.min(2 * halfWidth, Math.max(15_000, viewReach(tx, tz)));
    const fitted = Math.min(2 * halfWidth, 1.25 ** Math.ceil(Math.log(want) / Math.log(1.25)));
    const r = Number.isFinite(fitted) ? fitted : 2 * halfWidth; // a non-finite radius in the data: cover everything
    const grid = r / 8;
    const x = Math.round(tx / grid) * grid;
    const z = Math.round(tz / grid) * grid;
    const key = `${sunKey}|${x}|${z}|${r}`;
    if (key === shadowKey) return;
    shadowKey = key;
    region.x = x; region.z = z; region.r = r;
    canvas.dataset.shadowRegionKm = (r / 1000).toFixed(0); // read by the e2e test
    placeLight();
    fitCamera.position.copy(light.position);
    fitCamera.up.set(0, 1, 0);
    fitCamera.lookAt(light.target.position);
    fitCamera.updateMatrixWorld();
    const view = fitCamera.matrixWorldInverse;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      // Receivers: the region in view, clipped to the model.
      corner.set(
        Math.min(modelBox.max.x, Math.max(modelBox.min.x, k & 1 ? x + r : x - r)),
        k & 2 ? modelBox.max.y : modelBox.min.y,
        Math.min(modelBox.max.z, Math.max(modelBox.min.z, k & 4 ? z + r : z - r)),
      ).applyMatrix4(view);
      x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
      // Casters: the whole model, so a distant ridge toward the Sun is inside the depth range.
      corner.set(k & 1 ? modelBox.max.x : modelBox.min.x, k & 2 ? modelBox.max.y : modelBox.min.y, k & 4 ? modelBox.max.z : modelBox.min.z).applyMatrix4(view);
      z0 = Math.min(z0, corner.z); z1 = Math.max(z1, corner.z);
    }
    const cam = light.shadow.camera;
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.near = Math.max(1, -z1 - 1000); cam.far = -z0 + 1000;
    cam.updateProjectionMatrix();
    // Anti-stripe offset taken along the light ray, not along the surface normal: moving a point toward the Sun along
    // its own ray leaves every occluder farther than the offset exactly where it was, so the shadow edges cast by
    // distant ridges do not move. (A normal offset raises the ground and, at a 1° Sun, shifts edges by kilometres.)
    // Size: about two texels of light-space height spread along the ground at the Sun's elevation, 5 to 600 m.
    const texelHeight = (y1 - y0) / SHADOW_MAP;
    const grazing = Math.max(Math.abs(lightDir.y), Math.sin(THREE.MathUtils.degToRad(0.5)));
    const offsetM = Math.min(600, Math.max(5, (2 * texelHeight) / grazing));
    light.shadow.bias = -offsetM / (cam.far - cam.near);
    canvas.dataset.shadowOffsetM = offsetM.toFixed(0);
    renderer.shadowMap.needsUpdate = true;
    canvas.dataset.shadowDraws = String(++shadowDraws); // read by the e2e test
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
      canvas.dataset[`${body}Surface`] = frame.surface[body];
      const shown = captionKey(state, frame.surface[body], frame.geometric);
      canvas.dataset[`${body}Caption`] = shown;
      for (const [k, sprite] of Object.entries(g.captions)) sprite.visible = show && k === shown;
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
      for (const sprite of Object.values(g.captions)) sprite.position.copy(tip);
    }
  }

  const api: TerrainScene = {
    skyline,
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
      light.dispose(); // its shadow map
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
  applyFrame(); // light and overlays in their no-data state until the first frame arrives
  // Settle in: a short glide from a wider, higher pose to the overview (a plain snap with reduced motion).
  const overview = poseFor("overview")!;
  const start = { position: overview.position.clone().multiplyScalar(1.45).setY(overview.position.y * 1.9), target: overview.target.clone() };
  controls.target.copy(start.target); camera.position.copy(start.position); controls.update();
  moveTo(overview, SETTLE_MS, start);
  return api;
}
