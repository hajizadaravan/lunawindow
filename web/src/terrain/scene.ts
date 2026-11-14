import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { BodyId, SiteDataset } from "../contract/types";
import { dataUrl } from "../lib/data";
import { directionFromAzEl, validateTerrainMetadata, type Directions, type TerrainMetadata } from "./geometry";

export interface TerrainScene {
  update(directions: Directions, relief: boolean): void;
  view(kind: "overview" | "top" | "sun" | "earth"): void;
  dispose(): void;
}

export async function createTerrainScene(host: HTMLDivElement, site: SiteDataset, signal: AbortSignal, onContextLost: () => void): Promise<TerrainScene> {
  // Only a known, validated site ID may select a model. No remote resources at runtime.
  if (!/^demo-[abc]$/.test(site.site.id) || site.synthetic) throw new Error("No measured 3D model is available for this dataset.");
  const base = `terrain3d/${site.site.id}`;
  const response = await fetch(dataUrl(`${base}.json`), { signal });
  if (!response.ok) throw new Error("The measured terrain model is unavailable. The charts still work.");
  const meta: TerrainMetadata = await response.json();
  validateTerrainMetadata(meta, site);
  const modelResponse = await fetch(dataUrl(`${base}.glb`), { signal });
  if (!modelResponse.ok) throw new Error("The terrain model could not be downloaded.");
  const bytes = await modelResponse.arrayBuffer();
  if (bytes.byteLength !== meta.bytes) throw new Error("The terrain download is incomplete.");
  if (crypto.subtle) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== meta.sha256) throw new Error("The terrain model failed its integrity check.");
  }
  signal.throwIfAborted();
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  const disposeModel = () => gltf.scene.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) material.dispose();
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
  renderer.domElement.setAttribute("aria-label", "Measured lunar terrain. Drag to orbit and scroll to zoom; view buttons are available below.");
  renderer.domElement.setAttribute("role", "img");
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#080d14");
  scene.add(gltf.scene);
  const camera = new THREE.PerspectiveCamera(45, 1, 10, 800_000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.minDistance = 750;
  controls.maxDistance = 180_000;
  controls.maxPolarAngle = Math.PI * 0.48;
  const ambient = new THREE.AmbientLight(0xc6d5ec, 0.3);
  const light = new THREE.DirectionalLight(0xfff5e5, 3);
  scene.add(ambient, light, light.target);
  const overlays = new THREE.Group();
  scene.add(overlays);
  const orange = 0xffa460;
  const blue = 0x7abaff;

  function label(text: string, color: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "600 30px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 42);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }));
    sprite.scale.set(2400, 600, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, site.site.observerHeightM, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  mast.position.y = site.site.observerHeightM / 2;
  overlays.add(mast);
  // The pin is an annotation, deliberately larger than the actual two-metre mast.
  const pin = new THREE.Mesh(new THREE.RingGeometry(140, 220, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  pin.rotation.x = -Math.PI / 2; pin.position.y = 5; pin.renderOrder = 5;
  overlays.add(pin);
  const siteLabel = label(`POINT ${site.site.id.slice(-1).toUpperCase()}`, "#f0f4fa");
  siteLabel.position.set(0, 650, 0); overlays.add(siteLabel);
  for (const [name, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const) {
    const l = label(name, "#91a5ba");
    l.position.fromArray(directionFromAzEl(az, 0)).multiplyScalar(14_000);
    l.position.y = 1200;
    l.scale.set(1200, 300, 1);
    overlays.add(l);
  }
  const makeGuide = (body: BodyId) => {
    const color = body === "sun" ? orange : blue;
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color, dashSize: 350, gapSize: 180, depthTest: false, transparent: true, opacity: 0.75 }));
    line.renderOrder = 6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(180, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
    head.renderOrder = 8;
    const caption = label(body === "sun" ? "SUN DIRECTION" : "EARTH DIRECTION", body === "sun" ? "#ffba80" : "#93caff");
    overlays.add(line, head, caption);
    return { line, head, caption };
  };
  const guides = { sun: makeGuide("sun"), earth: makeGuide("earth") };

  let directions: Directions = { sun: null, earth: null };
  let disposed = false;
  const render = () => { if (!disposed) renderer.render(scene, camera); };
  controls.addEventListener("change", render);
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    render();
  });
  resize.observe(host);
  const contextLost = (event: Event) => { event.preventDefault(); onContextLost(); };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);

  const api: TerrainScene = {
    update(next, relief) {
      directions = next;
      if (relief) {
        light.position.set(-20000, 35000, 10000); light.intensity = 3; ambient.intensity = 0.3;
      } else {
        const sun = directions.sun;
        if (sun) light.position.fromArray(directionFromAzEl(sun.az, sun.el)).multiplyScalar(50000);
        light.intensity = sun ? 3.5 : 0;
        ambient.intensity = 0.12; // explicitly labelled fill light, for legibility only
      }
      for (const body of ["sun", "earth"] as const) {
        const d = next[body];
        const g = guides[body];
        g.line.visible = g.head.visible = g.caption.visible = d !== null;
        if (!d) continue;
        const tip = new THREE.Vector3().fromArray(directionFromAzEl(d.az, d.el)).multiplyScalar(body === "sun" ? 16000 : 12000);
        tip.y += site.site.observerHeightM;
        const positions = g.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        positions.setXYZ(0, 0, site.site.observerHeightM, 0);
        positions.setXYZ(1, tip.x, tip.y, tip.z);
        positions.needsUpdate = true;
        g.line.geometry.computeBoundingSphere();
        g.line.computeLineDistances();
        g.head.position.copy(tip);
        g.caption.position.copy(tip).add(new THREE.Vector3(0, 650, 0));
      }
      render();
    },
    view(kind) {
      controls.target.set(0, -350, 0);
      if (kind === "top") camera.position.set(0, 48000, 1);
      else if (kind === "sun" || kind === "earth") {
        const body = directions[kind];
        if (!body) return;
        camera.position.fromArray(directionFromAzEl(body.az + 180, 0)).multiplyScalar(20000);
        camera.position.y = 11000;
      } else camera.position.set(18000, 18000, 24000);
      controls.update(); render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resize.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      disposeModel();
      overlays.traverse(obj => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
          if ("geometry" in obj) obj.geometry.dispose();
          for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
            if ("map" in m && m.map instanceof THREE.Texture) m.map.dispose();
            m.dispose();
          }
        }
      });
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
  api.view("overview");
  return api;
}
