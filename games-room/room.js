/* The Games Room — a MODELED 3D room (rebuilt 2026-11-26 20:13 on
   Johnny's ruling: "It can't be just a photograph. It has to be a
   real 3D space we can walk through for each game without distorting
   anything"). The first live build projected his mountain-home
   photograph onto geometry; a projected photo reads true only from
   its own viewpoint and tore into sliding layers the moment the
   camera moved (his recordings, 19:57 + 20:10). This room is real
   geometry throughout — walls, island, library, fireplace, terrace,
   furniture, all meshes with materials sampled from the photo's own
   palette (timber, stone, marble, cream fabric) — so parallax is
   correct from every position and distortion is impossible. The
   photograph itself is used only as (a) the modeling reference and
   (b) the mountain scenery beyond the terrace, on a backdrop 70 m
   out, where a backdrop is honest. It is a crafted likeness of his
   house, not the literal photograph.
   LAYOUT (Johnny, 2026-11-26 15:22 + 18:14): the porch is the
   vehicle pad — the Disc hovers ~a foot off the terrace OUT ON ITS
   EDGE (PAD z −9.7), the Thumb Drive kart beside it (z −9.9),
   Starman takes the Disc's spot when toggled (tap the parked craft
   to swap). Line Rider lives on an iPad on the kitchen island; the
   Frequency Generator sits on the coffee table by the armchairs;
   Threads is on a tablet beside the white armchair. The desk
   computer and the wooden table are plain dressing. Stations hand
   over to the real games through window.__roomHost (below). */
import * as THREE from 'three';
import { makeCraft } from './craft.js';

const params = new URLSearchParams(location.search);
const STILL = params.has('still');
const t0 = performance.now();
window.__roomStats = { loadMs: null, fps: 0, frames: 0, errors: [] };
window.addEventListener('error', e => window.__roomStats.errors.push(String(e.message || e.error)));

const canvas = document.getElementById('gr-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
/* cinematic tone + real shadows (photorealism pass, 2026-11-26):
   ACES filmic response is what makes the photo's warm late-day
   light read as light instead of flat color; PCF-soft shadows from
   one warm sun are what seat every object IN the room */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.10;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171310);
/* atmosphere: a light warm-blue haze that only bites past ~30 m,
   so the room itself stays crisp while the vista layers fall back
   with real atmospheric perspective */
scene.fog = new THREE.Fog(0xC3D0DA, 30, 95);
const camera = new THREE.PerspectiveCamera(47.9, innerWidth / innerHeight, 0.05, 220);
function fitFov() {
  camera.aspect = innerWidth / innerHeight;
  /* one vertical FOV for every shape (47.9°): landscape sees the
     room wide; portrait takes a narrower slice of the same space,
     filled edge to edge, never a band floating in void. */
  camera.fov = 47.9;
  camera.updateProjectionMatrix();
}
fitFov();

/* ---------- textures: procedural, in the photo's palette ---------- */
/* one loading manager for every texture: the host's entry veil
   lifts only when the hero photo AND the photographic surface set
   have both arrived, so the first frame seen is the finished room
   (Johnny, 2026-11-26 23:25 — no grid flash, no half-dressed room).
   A 4.5 s fallback guarantees the veil can never trap the page. */
const loadMgr = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(loadMgr);
let heroDone = false, batchDone = false, readyFired = false;
function maybeReady() {
  if (readyFired || !heroDone || !batchDone) return;
  readyFired = true;
  window.__roomReady = true;
  if (window.__roomHost && window.__roomHost.roomReady) window.__roomHost.roomReady();
}
loadMgr.onLoad = () => { batchDone = true; maybeReady(); };
setTimeout(() => { batchDone = true; maybeReady(); }, 4500);
function woodTex(url, rx, ry) {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/* the room's copy of the hero photo (yoga figure removed, Johnny
   2026-11-26; the served Health hero is untouched). In the modeled
   room the photo is scenery and reference only: its mountain vista
   becomes the backdrop beyond the terrace, its framed painting
   hangs over the fireplace, and it lights the room's reflections. */
let backdropMat = null;
let paintingMat = null;
/* the middle vista layers' materials — their maps are composed
   from the hero photo in its load callback (above); the meshes
   themselves are built with the vista stack further down */
let vistaFarMat = null;
let vistaMidMat = null;
/* the fireplace's animated flame: the canvas, its context and the
   mesh are created with the fireplace (below) and driven from the
   render loop */
let fireCanvas = null, fireCtx = null, fireMesh = null, fireTexObj = null, lastFireDraw = 0;
/* the island's steam puffs, animated in the loop */
const steamPuffs = [];
const heroTex = texLoader.load('games-room/assets/hero-room.webp', () => {
  window.__roomStats.loadMs = Math.round(performance.now() - t0);
  /* no title card (Johnny, 2026-11-26 19:57): the host boots into
     the room's own loading veil and lifts it when this callback
     says the first complete frame exists — hero + surfaces both
     in (see maybeReady above) */
  heroDone = true; maybeReady();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(heroTex).texture;
  const img = heroTex.image, W = img.width, H = img.height;
  /* the backdrop: a 70 m cylinder around the house. The photo's
     vista band (peaks to river, its right-hand half) is drawn at
     the rows that put the peaks ~20° above the terrace eye line;
     the photo's own sky stretches above it, hazy valley below. At
     that distance it is scenery, and it never moves against the
     room — the room is real geometry in front of it. */
  if (backdropMat) {
    /* 2048 wide for panorama sharpness. The vista crop is drawn
       ONCE, centred (the cylinder's wrap seam sits behind the
       house, out of view) — a mirrored second pass ghosted the
       ridges into a smear. Soft haze fills the sides. */
    const sc = document.createElement('canvas'); sc.width = 2048; sc.height = 1024;
    const g = sc.getContext('2d');
    const skyGrad = g.createLinearGradient(0, 0, 0, 470);
    skyGrad.addColorStop(0, '#9FB6CC'); skyGrad.addColorStop(1, '#D8E2EC');
    g.fillStyle = skyGrad; g.fillRect(0, 0, 2048, 470);
    const skyH = Math.max(8, Math.round(H * 0.10));
    g.globalAlpha = 0.65;
    g.drawImage(img, 0, 0, W, skyH, 0, 60, 2048, 380);
    g.globalAlpha = 1;
    /* the backdrop now carries ONLY the far layer — sky and the
       pale peaks at near-natural aspect. The old single band
       (peaks → river squashed into one strip) is what read as
       smeared horizontal bands (Johnny, 2026-11-26 23:23/23:33);
       the nearer layers — far ridge, river + forest, mist, near
       treeline — are separate planes at real depths (below), so
       parallax between them is true when the camera moves. */
    g.drawImage(img, W * 0.295, H * 0.02, W * 0.685, H * 0.345, 250, 290, 1550, 312);
    /* feather the peaks' top into the sky and their foot into haze */
    const fT = g.createLinearGradient(0, 282, 0, 375);
    fT.addColorStop(0, 'rgba(216,226,236,0.9)'); fT.addColorStop(1, 'rgba(216,226,236,0)');
    g.fillStyle = fT; g.fillRect(0, 282, 2048, 93);
    const fB = g.createLinearGradient(0, 520, 0, 700);
    /* round 2: this foot haze at full strength was the pale
       horizontal band across the valley at terrace angles (the
       vista-calibration pass's primary target) — halved, and the
       round-2 mid layer now carries the valley's real content */
    fB.addColorStop(0, 'rgba(190,200,208,0)'); fB.addColorStop(1, 'rgba(190,200,208,0.5)');
    g.fillStyle = fB; g.fillRect(0, 520, 2048, 180);
    const side = g.createLinearGradient(0, 0, 2048, 0);
    side.addColorStop(0, 'rgba(190,203,216,0.95)');
    side.addColorStop(0.18, 'rgba(190,203,216,0.25)');
    side.addColorStop(0.30, 'rgba(190,203,216,0)');
    side.addColorStop(0.70, 'rgba(190,203,216,0)');
    side.addColorStop(0.82, 'rgba(190,203,216,0.25)');
    side.addColorStop(1, 'rgba(190,203,216,0.95)');
    g.fillStyle = side; g.fillRect(0, 280, 2048, 420);
    const haze = g.createLinearGradient(0, 460, 0, 780);
    haze.addColorStop(0, 'rgba(216,226,236,0)');
    haze.addColorStop(0.55, 'rgba(205,218,228,0.15)');
    haze.addColorStop(1, 'rgba(190,205,220,0)');
    g.fillStyle = haze; g.fillRect(0, 460, 2048, 320);
    const bot = g.createLinearGradient(0, 660, 0, 1024);
    bot.addColorStop(0, '#5d6f74'); bot.addColorStop(1, '#2e3d42');
    g.fillStyle = bot; g.fillRect(0, 660, 2048, 364);
    const st = new THREE.CanvasTexture(sc);
    st.colorSpace = THREE.SRGBColorSpace;
    st.wrapS = THREE.RepeatWrapping;
    backdropMat.map = st;
    /* a touch of blow-out: the photo's terrace light is bright
       enough to bloom past the interior, and the far peaks sit
       pale in it */
    backdropMat.color.setRGB(1.08, 1.06, 1.03);
    backdropMat.needsUpdate = true;
  }
  /* the two middle vista layers (graphics round 2): pre-composed
     strips derived from the photo offline (make_tex_r2.py), where
     their alpha feathers and registration could be iterated
     visually — the far ridge (56 m): the photo's golden peaks;
     the mid layer (42 m): slopes → mist → the TURQUOISE RIVER →
     forest. The old runtime crops never reached the river band
     (photo y .47-.64) at all, and their pale tints + jagged
     procedural ridge cut washed the whole vista out — the single
     biggest gap against the photo. The strips' windows end at
     photo x .862 so the photo's own porch columns never enter
     the valley; the mid column and the faucet arc are painted
     out in the source. A slight colour lift counters the ACES
     desaturation so the layers keep the photo's saturation. */
  const vistaLoad = (mat, file, lift) => {
    if (!mat) return;
    texLoader.load('games-room/assets-v4/' + file, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      mat.map = t; mat.color.setRGB(lift[0], lift[1], lift[2]);
      mat.opacity = 1; mat.needsUpdate = true;
    });
  };
  vistaLoad(vistaFarMat, 'vista-far.webp', [1.04, 1.03, 1.01]);
  vistaLoad(vistaMidMat, 'vista-mid.webp', [1.05, 1.045, 1.02]);
  /* the painting over the fireplace is the photo's own framed
     picture, lifted from the same image */
  if (paintingMat) {
    const pc = document.createElement('canvas'); pc.width = 512; pc.height = 336;
    /* the photo's inner canvas, measured off the hero image:
       (0.129, 0.230) → (0.215, 0.367) — the old crop was the bare
       gilt corner, not the painting */
    /* round 2: the old fractions framed the gilt corner, not the
       canvas — these are measured off a gridded overlay of the
       photo: the full inner canvas (peaks, forest, lake) with a
       sliver of its gilt edge, at the canvas's own aspect */
    pc.getContext('2d').drawImage(img, W * 0.150, H * 0.172, W * 0.092, H * 0.158, 0, 0, 512, 336);
    const pt = new THREE.CanvasTexture(pc);
    pt.colorSpace = THREE.SRGBColorSpace;
    paintingMat.map = pt;
    paintingMat.color.set(0xffffff);
    paintingMat.needsUpdate = true;
  }
}, undefined, () => { heroDone = true; maybeReady(); });
heroTex.colorSpace = THREE.SRGBColorSpace;
heroTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

/* procedural architectural textures, in the photo's own palette —
   for the built geometry the photo never showed (ceiling, side
   walls, parapet, terrace build-out) */
function canvasTex(draw, rx, ry) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  draw(c.getContext('2d'), 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
let seed = 5;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
/* photographic surface textures, extracted or built from the house
   photo itself (photorealism pass): the island's travertine, the
   library wall's ashlar stone, the terrace flagstones, the pale
   oak floor, dark walnut, the sofa's own linen — each with a
   derived normal map (and roughness where the surface needs it).
   Mirrored wrapping hides the tiling seams. */
function photoTex(file, rx, ry, srgb = true) {
  const t = texLoader.load('games-room/assets-v3/' + file);
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.repeat.set(rx, ry);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/* a normal map derived from any canvas (Sobel) — for the surfaces
   still drawn procedurally (timber, book spines, the rug) */
function normalFromCanvas(src, strength = 1.5) {
  const S = src.width, H = src.height;
  const g = src.getContext('2d');
  const data = g.getImageData(0, 0, S, H).data;
  const out = document.createElement('canvas'); out.width = S; out.height = H;
  const og = out.getContext('2d');
  const img = og.createImageData(S, H);
  const lum = (x, y) => data[(((y + H) % H) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) {
    const dx = (lum(x + 1, y) - lum(x - 1, y)) * strength;
    const dy = (lum(x, y + 1) - lum(x, y - 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const i = (y * S + x) * 4;
    img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
    img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const timberT = canvasTex((g, S) => {
  g.fillStyle = '#4a3421'; g.fillRect(0, 0, S, S);
  const rows = 6, rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const l = 0.85 + rnd() * 0.35;
    g.fillStyle = `rgb(${74 * l | 0},${52 * l | 0},${33 * l | 0})`;
    g.fillRect(0, r * rh, S, rh);
    for (let i = 0; i < 46; i++) {
      g.strokeStyle = `rgba(30,19,10,${0.05 + rnd() * 0.10})`;
      g.lineWidth = 0.8 + rnd() * 1.4;
      const y = r * rh + rnd() * rh; g.beginPath();
      g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + rnd() * 3 - 1.5, S * 0.7, y + rnd() * 3 - 1.5, S, y); g.stroke();
    }
    g.fillStyle = 'rgba(16,10,5,0.85)'; g.fillRect(0, r * rh - 1.5, S, 3);
    g.fillStyle = 'rgba(16,10,5,0.5)'; g.fillRect(rnd() * S, r * rh, 3, rh);
  }
}, 3, 3);
const stoneWallT = canvasTex((g, S) => {
  g.fillStyle = '#4a4036'; g.fillRect(0, 0, S, S);
  const rows = 5, rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = (r % 2) * -70;
    while (x < S) {
      const bw = 120 + rnd() * 90, l = 0.85 + rnd() * 0.3;
      g.fillStyle = `rgb(${112 * l | 0},${98 * l | 0},${80 * l | 0})`;
      g.fillRect(x + 2, r * rh + 2, bw - 4, rh - 4);
      for (let i = 0; i < 130; i++) {
        g.fillStyle = `rgba(${rnd() > 0.5 ? '255,246,230' : '20,14,8'},${0.02 + rnd() * 0.04})`;
        g.fillRect(x + 2 + rnd() * (bw - 4), r * rh + 2 + rnd() * (rh - 4), 1.6, 1.6);
      }
      x += bw;
    }
  }
}, 6, 3);
const stoneFloorT = canvasTex((g, S) => {
  g.fillStyle = '#5d5347'; g.fillRect(0, 0, S, S);
  const n = 2, ts = S / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const l = 0.9 + rnd() * 0.2;
    g.fillStyle = `rgb(${154 * l | 0},${141 * l | 0},${120 * l | 0})`;
    g.fillRect(i * ts + 3, j * ts + 3, ts - 6, ts - 6);
    for (let k = 0; k < 700; k++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? '255,250,238' : '24,18,12'},${0.025 + rnd() * 0.045})`;
      g.fillRect(i * ts + 3 + rnd() * (ts - 6), j * ts + 3 + rnd() * (ts - 6), 1.7, 1.7);
    }
    const gr = g.createRadialGradient(i * ts + rnd() * ts, j * ts + rnd() * ts, 8, i * ts + ts / 2, j * ts + ts / 2, ts * 0.7);
    gr.addColorStop(0, 'rgba(40,32,22,0.10)'); gr.addColorStop(1, 'rgba(40,32,22,0)');
    g.fillStyle = gr; g.fillRect(i * ts, j * ts, ts, ts);
  }
}, 5, 2);

/* ---- materials for the modeled room, in the photo's palette ---- */
/* the island top is the photo's own travertine — warm stone with
   its fine horizontal pore signature — finished with a clearcoat
   sheen so the sun rakes across it the way it does in the photo */
const marbleMat = new THREE.MeshPhysicalMaterial({
  map: photoTex('trav.jpg', 2, 1),
  normalMap: photoTex('trav-n.jpg', 2, 1, false),
  roughnessMap: photoTex('trav-r.jpg', 2, 1, false),
  roughness: 1, clearcoat: 0.3, clearcoatRoughness: 0.5, envMapIntensity: 0.55,
});
/* trav v2 carries bold veining that must READ at entry distance
   (parent review, 2026-11-27 00:42 — v1's fine veins under a
   pulled-down albedo read as flat beige). The repeat drops to
   (2,1) so the veins run at the photo's scale, and the albedo
   stays near the stone's own tone */
marbleMat.color.setRGB(0.90, 0.84, 0.74);
const islandWood = new THREE.MeshStandardMaterial({
  map: photoTex('walnut.jpg', 2, 1), normalMap: photoTex('walnut-n.jpg', 2, 1, false),
  roughness: 0.72, envMapIntensity: 0.35,
});
const steelMat = new THREE.MeshStandardMaterial({ color: 0xC9CCCE, roughness: 0.32, metalness: 1.0, envMapIntensity: 1.1 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xDCE9EA, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0, envMapIntensity: 1.4, side: THREE.DoubleSide });
const fabricMat = new THREE.MeshStandardMaterial({
  map: photoTex('fabric.jpg', 1, 1), normalMap: photoTex('fabric-n.jpg', 1, 1, false),
  color: 0xF2EAD8, roughness: 1, envMapIntensity: 0.25,
});
const cushionMat = new THREE.MeshStandardMaterial({
  map: photoTex('fabric.jpg', 1, 1), normalMap: photoTex('fabric-n.jpg', 1, 1, false),
  color: 0xFBF6EA, roughness: 1, envMapIntensity: 0.25,
});
const stoneSmooth = new THREE.MeshStandardMaterial({
  map: photoTex('trav.jpg', 1.5, 3), normalMap: photoTex('trav-n.jpg', 1.5, 3, false),
  color: 0xD8CBB6, roughness: 0.6, envMapIntensity: 0.4,
});
const goldMat = new THREE.MeshStandardMaterial({ color: 0xA87F3F, roughness: 0.35, metalness: 0.9, envMapIntensity: 1.1 });
const ceramicMat = new THREE.MeshPhysicalMaterial({ color: 0xEDE7DA, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 0.7, side: THREE.DoubleSide });
const pineMat = new THREE.MeshStandardMaterial({
  map: photoTex('walnut.jpg', 2, 1), normalMap: photoTex('walnut-n.jpg', 2, 1, false),
  color: 0xCBB59A, roughness: 0.75, envMapIntensity: 0.3,
});
const weatheredMat = new THREE.MeshStandardMaterial({
  map: photoTex('floorwood.jpg', 2, 1), normalMap: photoTex('floorwood-n.jpg', 2, 1, false),
  color: 0x9C8B74, roughness: 0.9, envMapIntensity: 0.25,
});
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.38, metalness: 0.85, envMapIntensity: 0.9 });
const blackGlass = new THREE.MeshPhysicalMaterial({ color: 0x0B0D10, roughness: 0.12, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.2 });
const plainWood = new THREE.MeshStandardMaterial({
  map: photoTex('walnut.jpg', 1, 1), normalMap: photoTex('walnut-n.jpg', 1, 1, false),
  color: 0x8F7B66, roughness: 0.85, envMapIntensity: 0.2,
});
const plainStone = new THREE.MeshStandardMaterial({
  map: photoTex('trav.jpg', 1, 1), normalMap: photoTex('trav-n.jpg', 1, 1, false),
  color: 0x7A6E5C, roughness: 0.9, envMapIntensity: 0.2,
});
const timberN = normalFromCanvas(timberT.image, 1.1); timberN.repeat.set(3, 3);
const timberMat = new THREE.MeshStandardMaterial({ map: timberT, normalMap: timberN, roughness: 0.95, envMapIntensity: 0.15 });
timberMat.color.setRGB(1.4, 1.2, 1.0);
const ceilMat = new THREE.MeshStandardMaterial({ map: timberT, normalMap: timberN, roughness: 1, envMapIntensity: 0.12 });
ceilMat.color.setRGB(2.6, 2.2, 1.7);
/* the beams carry their own grain scale: the shared timber texture
   at repeat (3,3) stretched a single tile across a 34 m header, so
   the beams read as flat brown slabs (Johnny's recording, pitch-up).
   A cloned texture per beam samples one plank row (v 0.34..0.54)
   along its length — real grain, at furniture scale. */
function beamTexture(repX) {
  const t = timberT.clone();
  t.repeat.set(repX, 0.2); t.offset.set(0, 0.34);
  t.needsUpdate = true;
  return t;
}
function beamNormal(repX) {
  const t = timberN.clone();
  t.repeat.set(repX, 0.2); t.offset.set(0, 0.34);
  t.needsUpdate = true;
  return t;
}
/* the old emissive lift is gone: it was a crutch for the flat
   light. With a real sun the beams shade themselves. */
const beamMat = new THREE.MeshStandardMaterial({ map: beamTexture(9), normalMap: beamNormal(9), roughness: 0.95, envMapIntensity: 0.15 });
beamMat.color.setRGB(1.9, 1.6, 1.25);
const beamMatEdge = new THREE.MeshStandardMaterial({ map: beamTexture(5), normalMap: beamNormal(5), roughness: 0.95, envMapIntensity: 0.15 });
beamMatEdge.color.setRGB(1.5, 1.25, 1.0);
/* the library wall is the photo's light ashlar stone — big smooth
   blocks with real joint relief, not the old dark rubble */
const stoneWallMat = new THREE.MeshStandardMaterial({
  map: photoTex('ashlar.jpg', 5, 3), normalMap: photoTex('ashlar-n.jpg', 5, 3, false),
  roughness: 0.85, envMapIntensity: 0.35,
});
/* the fireplace pieces carry the same stone at the same block
   scale — a shared repeat would shrink the blocks to tiles on
   the narrow pillars and breast */
const stoneFireMat = new THREE.MeshStandardMaterial({
  map: photoTex('ashlar.jpg', 1.2, 1.4), normalMap: photoTex('ashlar-n.jpg', 1.2, 1.4, false),
  roughness: 0.85, envMapIntensity: 0.35,
});
/* the parapets are rusticated stone, heavier and rougher */
const parapetMat = new THREE.MeshStandardMaterial({
  map: photoTex('rustic.jpg', 10, 0.6), normalMap: photoTex('rustic-n.jpg', 10, 0.6, false),
  roughness: 1, envMapIntensity: 0.15,
});
/* the terrace floor is the photo's own flagstones, cropped from
   its sunlit corner — warm grey-beige with real joints */
const stoneFloorMat = new THREE.MeshStandardMaterial({
  map: photoTex('terrace.jpg', 12, 3), normalMap: photoTex('terrace-n.jpg', 12, 3, false),
  roughnessMap: photoTex('terrace-r.jpg', 12, 3, false), roughness: 1, envMapIntensity: 0.35,
});
const stoneFloorMatB = new THREE.MeshStandardMaterial({
  map: photoTex('terrace.jpg', 7, 7), normalMap: photoTex('terrace-n.jpg', 7, 7, false),
  roughnessMap: photoTex('terrace-r.jpg', 7, 7, false), roughness: 1, envMapIntensity: 0.35,
});
/* the interior floor: the old orange pine corrected to the photo's
   pale warm oak */
const woodFloorMat = new THREE.MeshStandardMaterial({
  map: photoTex('floorwood.jpg', 6, 5), normalMap: photoTex('floorwood-n.jpg', 6, 5, false),
  color: 0xBFAE97, roughness: 0.7, envMapIntensity: 0.4,
});

function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
/* a box with real-world edges: its vertices are pushed onto a
   rounded shell of radius r, so no surface in the room ends in a
   knife edge (the dollhouse tell Johnny called out) */
function rbox(w, h, d, r, mat) {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const pos = geo.attributes.position;
  const hx = Math.max(w / 2 - r, 0.001), hy = Math.max(h / 2 - r, 0.001), hz = Math.max(d / 2 - r, 0.001);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = THREE.MathUtils.clamp(v.x, -hx, hx);
    const cy = THREE.MathUtils.clamp(v.y, -hy, hy);
    const cz = THREE.MathUtils.clamp(v.z, -hz, hz);
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      const s = r / len;
      pos.setXYZ(i, cx + dx * s, cy + dy * s, cz + dz * s);
    }
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/* ================= the room's geometry (modeled) =================
   Every surface below is a real mesh at its real place: wood floor
   inside, stone terrace wrapping the back and right of the house,
   the library wall (bookshelves, fireplace, the photo's painting),
   glass doors to the porch, columns, parapets, ceiling and beams —
   and 70 m out, the backdrop cylinder carrying the photo's vista.
   Nothing in the walkable space is a projected image, so no view
   of it can tear, stretch or smear. */
/* floors: wood inside; stone on the terrace (back strip + the
   right-side wrap, as the photo's terrace wraps the house) */
{
  const wood = new THREE.Mesh(new THREE.PlaneGeometry(16, 14), woodFloorMat);
  wood.rotation.x = -Math.PI / 2; wood.position.set(-2.5, 0, -4);
  scene.add(wood);
  const stoneA = new THREE.Mesh(new THREE.PlaneGeometry(18.5, 4.9), stoneFloorMat);
  stoneA.rotation.x = -Math.PI / 2; stoneA.position.set(7.25, 0.005, -11.35);
  scene.add(stoneA);
  const stoneB = new THREE.Mesh(new THREE.PlaneGeometry(11, 10.4), stoneFloorMatB);
  stoneB.rotation.x = -Math.PI / 2; stoneB.position.set(11, 0.004, -3.7);
  scene.add(stoneB);
  /* the hillside the house stands on: a soft ground disc running
     out to the backdrop, so the terrace edge drops to land, never
     to void */
  const skirt = new THREE.Mesh(new THREE.CircleGeometry(78, 40),
    new THREE.MeshStandardMaterial({ map: photoTex('canopy.jpg', 20, 20), roughness: 1 }));
  /* the photo's own forest canopy, pulled deeper: from the
     terrace this disc is the valley floor, and a flat colour
     there read as an olive billboard (terrace gate frame) */
  skirt.material.color.setRGB(0.6, 0.66, 0.58);
  skirt.rotation.x = -Math.PI / 2; skirt.position.set(2, -0.06, -6);
  scene.add(skirt);
}
/* the backdrop: the photo's mountains, 70 m out — scenery, not room */
{
  /* fog: false — this layer's haze is painted into its canvas;
     the scene fog is for the ground and the middle distance */
  backdropMat = new THREE.MeshBasicMaterial({ color: 0x39434a, side: THREE.BackSide, fog: false });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 120, 40, 1, true), backdropMat);
  cyl.position.set(2, 25, -6);
  scene.add(cyl);
}
/* the library wall: stone, with the bookshelves, the fireplace and
   the painting the photo shows — all modeled */
/* the photo's books are antique and muted — browns, tans, deep
   reds and greens, never rainbow stripes — and every spine carries
   the same drawn detail (raised bands, a title label, cloth grain,
   rounded shading), tinted per book by the instanced color */
const bookPalette = [0x9A7B58, 0x86644A, 0x6E5138, 0x7A4636, 0x5C6650, 0x8A7358, 0xA68B64, 0x63503E, 0x4E5A60, 0x93765A, 0x74584A, 0x55604C];
const spineC = document.createElement('canvas'); spineC.width = 128; spineC.height = 256;
{
  const g = spineC.getContext('2d');
  g.fillStyle = '#CFC4B2'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? '60,45,30' : '255,250,240'},${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * 128, rnd() * 256, 1.6, 1.6);
  }
  for (const by of [26, 52, 204, 230]) {
    g.fillStyle = 'rgba(70,52,32,0.55)'; g.fillRect(0, by, 128, 5);
    g.fillStyle = 'rgba(255,246,225,0.28)'; g.fillRect(0, by + 5, 128, 2);
  }
  g.fillStyle = 'rgba(240,230,205,0.85)'; g.fillRect(24, 84, 80, 58);
  g.strokeStyle = 'rgba(90,66,38,0.8)'; g.lineWidth = 3; g.strokeRect(24, 84, 80, 58);
  g.fillStyle = 'rgba(60,44,26,0.85)';
  for (let i = 0; i < 3; i++) g.fillRect(34, 98 + i * 13, 60 - i * 11, 5);
  const sh = g.createLinearGradient(0, 0, 128, 0);
  sh.addColorStop(0, 'rgba(30,20,10,0.42)'); sh.addColorStop(0.18, 'rgba(30,20,10,0)');
  sh.addColorStop(0.5, 'rgba(255,250,238,0.10)'); sh.addColorStop(0.85, 'rgba(30,20,10,0)');
  sh.addColorStop(1, 'rgba(30,20,10,0.5)');
  g.fillStyle = sh; g.fillRect(0, 0, 128, 256);
}
const spineT = new THREE.CanvasTexture(spineC); spineT.colorSpace = THREE.SRGBColorSpace; spineT.anisotropy = 8;
const bookXforms = [];
const bookStacks = [];
function shelfUnit(cx) {
  const g = new THREE.Group();
  /* floor-to-nearly-ceiling, as in the photo: an OPEN frame — back,
     sides, top — never a solid carcass: the books stand on the
     boards between the uprights, in the open, over a cabinet base */
  const back = box(1.3, 4.6, 0.03, islandWood); back.position.set(cx, 2.3, -10.96); g.add(back);
  for (const sx of [-0.625, 0.625]) {
    const side = box(0.05, 4.6, 0.32, plainWood); side.position.set(cx + sx, 2.3, -10.82); g.add(side);
  }
  const topB = box(1.3, 0.05, 0.34, plainWood); topB.position.set(cx, 4.62, -10.82); g.add(topB);
  const cab = box(1.2, 0.85, 0.03, islandWood); cab.position.set(cx, 0.55, -10.645); g.add(cab);
  const cabSeam = box(0.015, 0.78, 0.012, darkMetal); cabSeam.position.set(cx, 0.55, -10.628); g.add(cabSeam);
  for (const kx of [-0.09, 0.09]) {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), goldMat);
    knob.position.set(cx + kx, 0.55, -10.62); g.add(knob);
  }
  for (const sy of [1.06, 1.62, 2.18, 2.74, 3.30, 3.86]) {
    const board = box(1.2, 0.04, 0.28, plainWood); board.position.set(cx, sy, -10.80); g.add(board);
    let x = cx - 0.56;
    const endX = cx + 0.50;
    /* most shelves carry a horizontal stack somewhere, like the
       photo's — flat books break the vertical rhythm */
    if (rnd() < 0.5) {
      const sw = 0.24 + rnd() * 0.08, n = 2 + (rnd() * 2 | 0);
      for (let i = 0; i < n; i++) {
        bookStacks.push({
          x: x + sw / 2 + (rnd() - 0.5) * 0.012, y: sy + 0.02 + 0.019 + i * 0.037,
          z: -10.80 + (rnd() - 0.5) * 0.01, w: sw - i * 0.02,
          c: bookPalette[(rnd() * bookPalette.length) | 0],
        });
      }
      x += sw + 0.03 + rnd() * 0.05;
    }
    while (x < endX) {
      if (rnd() < 0.10) { x += 0.04 + rnd() * 0.06; continue; }
      const bw = 0.028 + rnd() * 0.026, bh = 0.23 + rnd() * 0.13;
      bookXforms.push({
        x: x + bw / 2, y: sy + 0.02 + bh / 2, z: -10.80 + (rnd() - 0.5) * 0.024,
        w: bw, h: bh, rz: rnd() < 0.05 ? (rnd() - 0.5) * 0.14 : 0,
        c: bookPalette[(rnd() * bookPalette.length) | 0],
      });
      x += bw + 0.004;
    }
  }
  scene.add(g);
}
{
  /* five tall units flanking the fireplace and running toward the
     doors, as the photo's wall does (the desk stands against the
     last stretch of plain wall) */
  for (const cx of [-9.62, -5.88, -3.94, -2.0, -0.06]) shelfUnit(cx);
  const bookMat = new THREE.MeshStandardMaterial({
    map: spineT, normalMap: normalFromCanvas(spineC, 0.9), roughness: 0.88, envMapIntensity: 0.2,
  });
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.2), bookMat, bookXforms.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), col = new THREE.Color();
  bookXforms.forEach((b, i) => {
    q.setFromEuler(eu.set(0, 0, b.rz));
    m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, 1));
    books.setMatrixAt(i, m4);
    books.setColorAt(i, col.setHex(b.c));
  });
  scene.add(books);
  const stacks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.2), bookMat, bookStacks.length);
  bookStacks.forEach((b, i) => {
    q.identity();
    m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, 0.037, 1));
    stacks.setMatrixAt(i, m4);
    stacks.setColorAt(i, col.setHex(b.c));
  });
  scene.add(stacks);
  /* the wall itself */
  const wall = box(12.6, 5.9, 0.3, stoneWallMat); wall.position.set(-4.1, 2.95, -11.15); scene.add(wall);
  /* the fireplace: stone surround, black firebox, timber mantel,
     a lit fire, and the painting above it */
  /* the surround is a stone MASS at the photo's scale — wide
     piers standing proud of the shelves, a deep lintel, the
     breast running to the ceiling (parent review, 2026-11-27
     00:42: the first build read as a glow between shelves) */
  for (const px of [-8.52, -6.68]) {
    const pillar = box(0.62, 1.78, 0.42, stoneFireMat); pillar.position.set(px, 0.89, -10.8); scene.add(pillar);
  }
  const lintel = box(2.5, 0.5, 0.42, stoneFireMat); lintel.position.set(-7.6, 1.53, -10.8); scene.add(lintel);
  const breast = box(2.5, 4.3, 0.25, stoneFireMat); breast.position.set(-7.6, 3.75, -10.87); scene.add(breast);
  const fbox = box(1.35, 1.28, 0.1, new THREE.MeshStandardMaterial({ color: 0x0A0806, roughness: 1 }));
  fbox.position.set(-7.6, 0.64, -10.95); scene.add(fbox);
  const mantel = box(2.7, 0.1, 0.55, beamMat); mantel.position.set(-7.6, 1.86, -10.75); scene.add(mantel);
  const hearth = box(2.7, 0.05, 0.8, plainStone); hearth.position.set(-7.6, 0.025, -10.45); scene.add(hearth);
  /* a REAL fire: layered flame tongues redrawn a dozen times a
     second (drawFire, in the loop section) over a dark red bed —
     the old static radial blob read as a sticker */
  fireCanvas = document.createElement('canvas'); fireCanvas.width = 128; fireCanvas.height = 96;
  fireCtx = fireCanvas.getContext('2d');
  fireTexObj = new THREE.CanvasTexture(fireCanvas);
  fireMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.95),
    new THREE.MeshBasicMaterial({ map: fireTexObj, transparent: true, toneMapped: false }));
  fireMesh.position.set(-7.6, 0.56, -10.88); scene.add(fireMesh);
  const log1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8), islandWood);
  log1.rotation.z = Math.PI / 2; log1.rotation.y = 0.4; log1.position.set(-7.6, 0.1, -10.85); scene.add(log1);
  const log2 = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.72, 8), islandWood);
  log2.rotation.z = Math.PI / 2; log2.rotation.y = -0.5; log2.position.set(-7.55, 0.17, -10.82); scene.add(log2);
  const andiron = box(0.9, 0.03, 0.03, darkMetal); andiron.position.set(-7.6, 0.13, -10.70); scene.add(andiron);
  /* the fire's spill on the hearth stone */
  const hgC = document.createElement('canvas'); hgC.width = hgC.height = 128;
  const hg = hgC.getContext('2d');
  const hgr = hg.createRadialGradient(64, 64, 4, 64, 64, 62);
  hgr.addColorStop(0, 'rgba(255,150,60,0.35)'); hgr.addColorStop(1, 'rgba(255,120,40,0)');
  hg.fillStyle = hgr; hg.fillRect(0, 0, 128, 128);
  const hearthGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(hgC), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  hearthGlow.rotation.x = -Math.PI / 2; hearthGlow.position.set(-7.6, 0.058, -10.1);
  hearthGlow.renderOrder = 2; scene.add(hearthGlow);
  /* the painting at the photo's scale: a big gilt landscape
     filling the breast above the mantel */
  const frame = box(1.86, 1.26, 0.06, goldMat); frame.position.set(-7.6, 2.92, -10.72); scene.add(frame);
  paintingMat = new THREE.MeshStandardMaterial({ color: 0x6B7A86, roughness: 0.6 });
  const painting = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 1.1), paintingMat);
  painting.position.set(-7.6, 2.92, -10.685); scene.add(painting);
}
/* the glass doors to the porch, FOLDED OPEN as the photo has
   them: each leaf swings out and back until it lies FLAT against
   the wall's terrace face, stacked at its jamb — the photo's
   folded accordion. Round 2: at 135° the leaves stood diagonally
   across the terrace and read as a black cage in every terrace
   frame; at ~166° with the hinges moved to the terrace face
   (z -11.30, the wall slab's outer surface) each leaf lies along
   the stone, clear of the bay and out of the vista's way. */
{
  const dg = new THREE.Group();
  const doorLeaf = (hingeX, dir) => {
    const leaf = new THREE.Group();
    leaf.position.set(hingeX, 0, -11.30);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 3.14), glassMat);
    glass.position.set(dir * 0.57, 1.67, 0); leaf.add(glass);
    const rail = (w, h, x, y) => { const r = box(w, h, 0.07, darkMetal); r.position.set(x, y, 0); leaf.add(r); };
    rail(1.14, 0.08, dir * 0.57, 3.28); rail(1.14, 0.08, dir * 0.57, 0.06);
    rail(0.08, 3.3, dir * 0.04, 1.67); rail(0.08, 3.3, dir * 1.10, 1.67);
    return leaf;
  };
  const leafA = doorLeaf(2.45, 1); leafA.rotation.y = 2.90; dg.add(leafA);
  const leafB = doorLeaf(4.71, -1); leafB.rotation.y = -2.90; dg.add(leafB);
  const tGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.34, 1.9), glassMat);
  tGlass.position.set(3.58, 4.32, -11); dg.add(tGlass);
  const tRail = box(2.42, 0.08, 0.07, darkMetal); tRail.position.set(3.58, 5.3, -11); dg.add(tRail);
  const mRail = box(2.42, 0.08, 0.07, darkMetal); mRail.position.set(3.58, 3.32, -11); dg.add(mRail);
  scene.add(dg);
}
/* the kitchen island: a real counter — dark cabinet base with
   panelled front, a marble top at y 0.92 (the height every station
   pose was built against), and the photo's own foreground props
   modeled on it: cooktop, pot, kettle, skillet, fruit bowls, the
   black faucet and the sink. The iPad's spot (0.9, -2.3) stays
   clear between them. */
{
  const isl = new THREE.Group();
  const base = rbox(5.0, 0.86, 2.18, 0.03, islandWood); base.position.set(0.9, 0.43, -2.51); isl.add(base);
  for (const px of [-0.95, 0.3, 1.55, 2.8]) {
    const panel = box(1.05, 0.62, 0.03, plainWood); panel.position.set(px, 0.45, -1.405); isl.add(panel);
  }
  const top = rbox(5.3, 0.06, 2.48, 0.025, marbleMat); top.position.set(0.9, 0.89, -2.51); isl.add(top);
  /* cooktop with pot and kettle */
  const hob = box(0.95, 0.015, 0.6, blackGlass); hob.position.set(-0.35, 0.927, -2.5); isl.add(hob);
  for (const [bx, bz, br] of [[-0.58, -2.65, 0.10], [-0.12, -2.65, 0.075], [-0.58, -2.35, 0.075], [-0.12, -2.35, 0.09]]) {
    const burn = new THREE.Mesh(new THREE.CylinderGeometry(br, br, 0.008, 20), darkMetal);
    burn.position.set(bx, 0.936, bz); isl.add(burn);
  }
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.17, 22), steelMat);
  pot.position.set(-0.58, 1.005, -2.65); isl.add(pot);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 22), steelMat);
  lid.position.set(-0.58, 1.10, -2.65); isl.add(lid);
  const knobS = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), darkMetal);
  knobS.position.set(-0.58, 1.125, -2.65); isl.add(knobS);
  const kettle = new THREE.Group(); kettle.position.set(0.28, 0.92, -2.5);
  const kBody = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.115, 0.2, 20), steelMat);
  kBody.position.y = 0.10; kettle.add(kBody);
  const kHandle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.011, 8, 18, Math.PI), darkMetal);
  kHandle.position.y = 0.21; kettle.add(kHandle);
  const kSpout = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 0.11, 10), steelMat);
  kSpout.position.set(-0.11, 0.13, 0); kSpout.rotation.z = 0.7; kettle.add(kSpout);
  isl.add(kettle);
  /* skillet with vegetables, front-left as in the photo */
  const skill = new THREE.Group(); skill.position.set(-1.05, 0.92, -1.85);
  const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.04, 22), darkMetal);
  pan.position.y = 0.02; skill.add(pan);
  const handle = box(0.24, 0.018, 0.04, darkMetal); handle.position.set(-0.26, 0.03, 0); skill.add(handle);
  /* round 2: the coloured balls are gone — the pan carries the
     photo's own vegetables (assets-v4/skillet.webp: the hero
     photo's skillet crop, mirror-filled to a full pan of veg)
     on a disc seated at the pan's rim. Food was Johnny's named
     item 2: real food, not coloured spheres in a pan */
  const skilletTex = texLoader.load('games-room/assets-v4/skillet.webp');
  skilletTex.colorSpace = THREE.SRGBColorSpace; skilletTex.anisotropy = 8;
  const skilletDisc = new THREE.Mesh(new THREE.CircleGeometry(0.148, 24),
    new THREE.MeshStandardMaterial({
      map: skilletTex, transparent: true, roughness: 0.85, envMapIntensity: 0.25,
    }));
  skilletDisc.rotation.x = -Math.PI / 2; skilletDisc.position.y = 0.043;
  skill.add(skilletDisc);
  isl.add(skill);
  /* fruit bowl + egg bowl */
  const bowlAt = (bx, bz, r, fruits) => {
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), ceramicMat);
    bowl.position.set(bx, 0.92 + r * 0.55, bz); isl.add(bowl);
    fruits.forEach(([fx, fz, fc, fr], i) => {
      /* round 2: fruit with a skin's sheen and a little natural
         size scatter, not billiard balls */
      const f = new THREE.Mesh(new THREE.SphereGeometry(fr, 14, 12),
        new THREE.MeshStandardMaterial({ color: fc, roughness: 0.38, envMapIntensity: 0.5 }));
      f.scale.setScalar(0.92 + rnd() * 0.2);
      f.position.set(bx + fx, 0.92 + r * 0.62 + (i === 0 ? fr * 0.7 : 0), bz + fz); isl.add(f);
    });
  };
  bowlAt(1.95, -2.8, 0.17, [[-0.07, 0.02, 0xE8912D, 0.052], [0.06, -0.04, 0xB03A2E, 0.05], [0.0, 0.07, 0xE8C93B, 0.048], [0.08, 0.05, 0x7A9A3D, 0.047], [0, 0, 0xE8912D, 0.052]]);
  /* a tuft of greens among the fruit, as the photo's bowl carries */
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.032 + rnd() * 0.012, 1),
      new THREE.MeshStandardMaterial({ color: [0x4A6032, 0x5A7040, 0x3E5228][i], roughness: 0.9, flatShading: true }));
    leaf.position.set(1.95 + (rnd() - 0.5) * 0.09, 1.06 + rnd() * 0.02, -2.8 + (rnd() - 0.5) * 0.09);
    isl.add(leaf);
  }
  bowlAt(1.5, -1.9, 0.11, [[-0.04, 0.02, 0xD9A066, 0.033], [0.045, -0.02, 0xEFE6D4, 0.033], [0.0, 0.05, 0xD9A066, 0.033], [0.01, -0.05, 0xEFE6D4, 0.033]]);
  /* bread board */
  const board = box(0.55, 0.025, 0.35, weatheredMat); board.position.set(2.9, 0.933, -2.0); isl.add(board);
  /* round 2: the loaf wears the photo's own crust (a mottled
     patch lifted off the hero photo's bread) instead of flat tan */
  const crustTex = texLoader.load('games-room/assets-v4/crust.webp');
  crustTex.colorSpace = THREE.SRGBColorSpace;
  crustTex.wrapS = crustTex.wrapT = THREE.RepeatWrapping; crustTex.repeat.set(2, 1);
  const bread = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14),
    new THREE.MeshStandardMaterial({ map: crustTex, color: 0xFFFFFF, roughness: 0.85, envMapIntensity: 0.4 }));
  bread.scale.set(1.25, 0.62, 0.85); bread.position.set(2.85, 0.985, -2.0); isl.add(bread);
  /* the black gooseneck faucet + sink, the photo's right foreground */
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.32, 12), darkMetal);
  stem.position.set(2.35, 1.08, -3.4); isl.add(stem);
  const spoutArm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 10), darkMetal);
  spoutArm.rotation.x = Math.PI / 2; spoutArm.position.set(2.35, 1.235, -3.24); isl.add(spoutArm);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10), darkMetal);
  nozzle.position.set(2.35, 1.20, -3.08); isl.add(nozzle);
  const sink = box(0.85, 0.02, 0.52, blackGlass); sink.position.set(2.35, 0.912, -2.62); isl.add(sink);
  /* the rest of the photo's island dressing: a saucepan on the
     free burner, olive oil, herb pots, a utensil crock, garlic,
     a folded linen towel — the small things the eye checks for.
     Nothing lands within reach of the iPad's spot (0.9, -2.3). */
  const sauce = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.085, 0.075, 18), steelMat);
  sauce.position.set(-0.12, 0.975, -2.35); isl.add(sauce);
  const sauceHandle = box(0.17, 0.014, 0.028, darkMetal); sauceHandle.position.set(0.03, 0.99, -2.35); isl.add(sauceHandle);
  const oilMat = new THREE.MeshStandardMaterial({ color: 0x55601F, roughness: 0.12, transparent: true, opacity: 0.94, envMapIntensity: 1.3 });
  const oilBody = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.20, 14), oilMat);
  oilBody.position.set(1.78, 1.02, -3.05); isl.add(oilBody);
  const oilNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.02, 0.05, 10), oilMat);
  oilNeck.position.set(1.78, 1.145, -3.05); isl.add(oilNeck);
  const oilCork = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.025, 8),
    new THREE.MeshStandardMaterial({ color: 0xC8A878, roughness: 0.9 }));
  oilCork.position.set(1.78, 1.18, -3.05); isl.add(oilCork);
  const terraMat = new THREE.MeshStandardMaterial({ color: 0x9A5F43, roughness: 0.9, envMapIntensity: 0.2 });
  const leafGreens = [0x4A6032, 0x5A7040, 0x3E5228];
  const herbAt = (hx, hz) => {
    const potH = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.042, 0.09, 14), terraMat);
    potH.position.set(hx, 0.965, hz); isl.add(potH);
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 + rnd() * 0.025, 1),
        new THREE.MeshStandardMaterial({ color: leafGreens[i % 3], roughness: 0.9, flatShading: true }));
      leaf.position.set(hx + (rnd() - 0.5) * 0.06, 1.06 + rnd() * 0.05, hz + (rnd() - 0.5) * 0.06);
      isl.add(leaf);
    }
  };
  herbAt(-1.55, -3.25); herbAt(0.62, -3.38);
  const crock = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 14),
    new THREE.MeshStandardMaterial({ color: 0x3A3A3C, roughness: 0.4, envMapIntensity: 0.5 }));
  crock.position.set(-1.02, 0.98, -3.32); isl.add(crock);
  for (let i = 0; i < 3; i++) {
    const u = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 6), plainWood);
    u.position.set(-1.02 + (i - 1) * 0.025, 1.12, -3.32 + (i % 2) * 0.02 - 0.01);
    u.rotation.z = (i - 1) * 0.16; isl.add(u);
  }
  for (const [gx, gz] of [[2.62, -1.78], [2.68, -1.72], [2.58, -1.70]]) {
    const gar = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xE8DFC8, roughness: 0.7 }));
    gar.scale.y = 0.8; gar.position.set(gx, 0.935, gz); isl.add(gar);
  }
  const towel = box(0.34, 0.018, 0.24, cushionMat); towel.position.set(2.35, 0.932, -1.52); towel.rotation.y = 0.2; isl.add(towel);
  /* steam over the pot and a wisp over the skillet: soft sprites
     cycling up and fading — the photo's pot is steaming, and the
     motion is one of the things that makes a still room feel used */
  const steamC = document.createElement('canvas'); steamC.width = steamC.height = 128;
  {
    const g = steamC.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const steamT = new THREE.CanvasTexture(steamC);
  const addSteam = (sx, sz, baseY, s0, n) => {
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamT, transparent: true, opacity: 0, depthWrite: false, color: 0xF4F7F7 }));
      sp.position.set(sx, baseY, sz);
      scene.add(sp);
      steamPuffs.push({ sp, x: sx, z: sz, baseY, s0, phase: i / n });
    }
  };
  addSteam(-0.58, -2.65, 1.16, 0.20, 4);
  addSteam(-1.05, -1.85, 1.02, 0.13, 2);
  scene.add(isl);
  /* two stools tucked at the counter's near side */
  for (const sx of [0.2, 1.7]) {
    const stool = new THREE.Group(); stool.position.set(sx, 0, -0.82);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 18), plainWood);
    seat.position.y = 0.63; stool.add(seat);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.6, 10), darkMetal);
    leg.position.y = 0.31; stool.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.025, 16), darkMetal);
    foot.position.y = 0.013; stool.add(foot);
    stool.add(blobShadow(0.55, 0.55, 0.4));
    scene.add(stool);
  }
}
/* the terrace columns: smooth stone, base and capital, meeting the
   roof-edge beam (its underside, y 5.24) — never through it */
for (const [cx, r] of [[1.72, 0.34], [10.7, 0.42]]) {
  const col = new THREE.Group();
  const baseB = box(r * 2 + 0.16, 0.3, r * 2 + 0.16, stoneSmooth); baseB.position.y = 0.15; col.add(baseB);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 4.95, 22), stoneSmooth);
  shaft.position.y = 2.77; col.add(shaft);
  const capB = box(r * 2 + 0.2, 0.32, r * 2 + 0.2, stoneSmooth); capB.position.y = 5.3; col.add(capB);
  col.position.set(cx, 0, -10.6);
  scene.add(col);
}
/* the dining set out on the terrace, left of the pad (dressing) */
{
  const dt = new THREE.Group(); dt.position.set(0.2, 0, -12.1); dt.rotation.y = 0.06;
  const dtop = box(2.2, 0.06, 1.1, weatheredMat); dtop.position.y = 0.74; dt.add(dtop);
  for (const [lx, lz] of [[-1.0, -0.45], [1.0, -0.45], [-1.0, 0.45], [1.0, 0.45]]) {
    const leg = box(0.07, 0.74, 0.07, weatheredMat); leg.position.set(lx, 0.37, lz); dt.add(leg);
  }
  const sageMat = new THREE.MeshStandardMaterial({
    map: photoTex('fabric.jpg', 1, 1), normalMap: photoTex('fabric-n.jpg', 1, 1, false),
    color: 0x93A086, roughness: 1, envMapIntensity: 0.2,
  });
  const chairAt = (x, z, ry) => {
    const ch = new THREE.Group(); ch.position.set(x, 0, z); ch.rotation.y = ry;
    const seat = box(0.45, 0.05, 0.45, plainWood); seat.position.y = 0.46; ch.add(seat);
    const cush = box(0.4, 0.035, 0.4, sageMat); cush.position.y = 0.50; ch.add(cush);
    const back = box(0.45, 0.55, 0.05, plainWood); back.position.set(0, 0.76, -0.2); ch.add(back);
    for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
      const leg = box(0.04, 0.46, 0.04, plainWood); leg.position.set(lx, 0.23, lz); ch.add(leg);
    }
    dt.add(ch);
  };
  chairAt(-0.6, -0.85, Math.PI); chairAt(0.6, -0.85, Math.PI);
  chairAt(-0.6, 0.85, 0); chairAt(0.6, 0.85, 0);
  /* a runner and a potted herb dress the table, as the photo's
     terrace table is dressed */
  const runner = box(1.9, 0.012, 0.4, cushionMat); runner.position.y = 0.776; dt.add(runner);
  const dtPot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.10, 14),
    new THREE.MeshStandardMaterial({ color: 0x9A5F43, roughness: 0.9 }));
  dtPot.position.set(0, 0.82, 0); dt.add(dtPot);
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055 + rnd() * 0.02, 1),
      new THREE.MeshStandardMaterial({ color: [0x4A6032, 0x5A7040, 0x3E5228][i], roughness: 0.9, flatShading: true }));
    leaf.position.set((rnd() - 0.5) * 0.07, 0.93 + rnd() * 0.04, (rnd() - 0.5) * 0.07); dt.add(leaf);
  }
  dt.add(blobShadow(2.6, 1.6, 0.35));
  scene.add(dt);
}
/* the two cream armchairs in front of the library wall — modeled:
   base, arms, tilted back, loose cushions, in the photo's ivory */
function accentMat(hex) {
  return new THREE.MeshStandardMaterial({
    map: photoTex('fabric.jpg', 1, 1), normalMap: photoTex('fabric-n.jpg', 1, 1, false),
    color: hex, roughness: 1, envMapIntensity: 0.2,
  });
}
function makeArmchair(cx, ry, accent, withThrow) {
  const g = new THREE.Group(); g.position.set(cx, 0, -8.83); g.rotation.y = ry;
  const base = rbox(0.98, 0.32, 0.92, 0.07, fabricMat); base.position.y = 0.26; g.add(base);
  for (const ax of [-0.39, 0.39]) {
    const arm = rbox(0.2, 0.3, 0.88, 0.07, fabricMat); arm.position.set(ax, 0.57, 0); g.add(arm);
  }
  const back = rbox(0.98, 0.74, 0.2, 0.07, fabricMat); back.position.set(0, 0.79, -0.37); back.rotation.x = -0.08; g.add(back);
  const seatC = rbox(0.58, 0.15, 0.62, 0.06, cushionMat); seatC.position.set(0, 0.5, 0.06); g.add(seatC);
  const backC = rbox(0.58, 0.48, 0.13, 0.06, cushionMat); backC.position.set(0, 0.83, -0.25); backC.rotation.x = -0.08; g.add(backC);
  const acc = rbox(0.42, 0.42, 0.12, 0.05, accentMat(accent));
  acc.position.set(0.14, 0.80, -0.17); acc.rotation.set(-0.15, 0, 0.12); g.add(acc);
  if (withThrow) {
    const throwMat = accentMat(0x98918A);
    const tTop = rbox(0.24, 0.045, 0.72, 0.02, throwMat); tTop.position.set(0.40, 0.735, 0.05); g.add(tTop);
    const tDrop = rbox(0.045, 0.42, 0.72, 0.02, throwMat); tDrop.position.set(0.515, 0.51, 0.05); g.add(tDrop);
  }
  for (const [lx, lz] of [[-0.42, -0.38], [0.42, -0.38], [-0.42, 0.38], [0.42, 0.38]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.1, 8), plainWood);
    leg.position.set(lx, 0.05, lz); g.add(leg);
  }
  g.add(blobShadow(1.35, 1.25, 0.42));
  scene.add(g);
}
makeArmchair(-2.78, 0.15, 0x8B9578, false);
makeArmchair(-1.73, -0.10, 0xB09A7C, true);
/* the cream sofa and the rug the photo's living area is built on —
   the model had neither, and the space read empty because of it.
   The sofa angles toward the fireplace from the room's left,
   clear of the Frequency Generator's coffee table and every
   station glide */
{
  const rugC = document.createElement('canvas'); rugC.width = 512; rugC.height = 384;
  {
    const g = rugC.getContext('2d');
    g.fillStyle = '#C9BBA2'; g.fillRect(0, 0, 512, 384);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? '90,72,50' : '255,248,232'},${0.03 + rnd() * 0.05})`;
      g.fillRect(rnd() * 512, rnd() * 384, 1.8, 1.8);
    }
    g.strokeStyle = 'rgba(154,123,88,0.75)'; g.lineWidth = 16; g.strokeRect(14, 14, 484, 356);
    g.strokeStyle = 'rgba(107,81,54,0.6)'; g.lineWidth = 5; g.strokeRect(38, 38, 436, 308);
    g.strokeStyle = 'rgba(107,81,54,0.16)'; g.lineWidth = 2;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      g.save(); g.translate(96 + i * 80, 84 + j * 72); g.rotate(Math.PI / 4);
      g.strokeRect(-17, -17, 34, 34); g.restore();
    }
  }
  const rugT = new THREE.CanvasTexture(rugC); rugT.colorSpace = THREE.SRGBColorSpace; rugT.anisotropy = 8;
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 2.7),
    new THREE.MeshStandardMaterial({ map: rugT, normalMap: normalFromCanvas(rugC, 0.4), roughness: 1, envMapIntensity: 0.15 }));
  rug.rotation.x = -Math.PI / 2; rug.rotation.z = 0.06;
  rug.position.set(-2.85, 0.006, -7.45);
  scene.add(rug);
  const sofa = new THREE.Group(); sofa.position.set(-4.62, 0, -7.15); sofa.rotation.y = 0.48;
  const sBase = rbox(2.35, 0.42, 0.98, 0.08, fabricMat); sBase.position.y = 0.32; sofa.add(sBase);
  const sBack = rbox(2.35, 0.62, 0.24, 0.08, fabricMat); sBack.position.set(0, 0.80, -0.38); sBack.rotation.x = -0.10; sofa.add(sBack);
  for (const ax of [-1.06, 1.06]) {
    const arm = rbox(0.24, 0.36, 0.98, 0.08, fabricMat); arm.position.set(ax, 0.66, 0); sofa.add(arm);
  }
  for (const sx of [-0.72, 0, 0.72]) {
    const seat = rbox(0.66, 0.17, 0.72, 0.06, cushionMat); seat.position.set(sx, 0.60, 0.05); sofa.add(seat);
    const backC = rbox(0.66, 0.50, 0.15, 0.06, cushionMat); backC.position.set(sx, 0.94, -0.24); backC.rotation.x = -0.16; sofa.add(backC);
  }
  const accS = rbox(0.4, 0.4, 0.13, 0.05, accentMat(0x8B9578)); accS.position.set(-0.55, 0.86, -0.16); accS.rotation.set(-0.2, 0, 0.15); sofa.add(accS);
  const accR = rbox(0.4, 0.4, 0.13, 0.05, accentMat(0xA9603C)); accR.position.set(0.62, 0.86, -0.16); accR.rotation.set(-0.2, 0, -0.12); sofa.add(accR);
  /* a terracotta throw over the near arm, top fold + hanging drop */
  const throwMat = accentMat(0xA9603C);
  const thTop = rbox(0.66, 0.05, 1.0, 0.02, throwMat); thTop.position.set(-1.06, 0.865, 0.02); thTop.rotation.z = 0.05; sofa.add(thTop);
  const thDrop = rbox(0.05, 0.52, 0.9, 0.02, throwMat); thDrop.position.set(-1.20, 0.56, 0.02); sofa.add(thDrop);
  for (const [lx, lz] of [[-1.05, -0.4], [1.05, -0.4], [-1.05, 0.4], [1.05, 0.4]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.12, 8), plainWood);
    leg.position.set(lx, 0.06, lz); sofa.add(leg);
  }
  sofa.add(blobShadow(2.8, 1.5, 0.4));
  scene.add(sofa);
}
/* the shell: timber ceiling + beams over the interior, the stone
   left wall, and the terrace parapets. The porch itself is open-air
   (no roof over it, as in the photo) — the roof-edge beam the
   columns meet is its front line, and beyond it the backdrop sky. */
{
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(15.9, 14), ceilMat);
  ceil.rotation.x = Math.PI / 2; ceil.position.set(-2.45, 5.9, -4);
  scene.add(ceil);
  for (const bz of [-3.5, -7.5]) {
    const beam = box(15.9, 0.62, 0.5, beamMat);
    beam.position.set(-2.45, 5.55, bz); scene.add(beam);
  }
  const edge = box(14, 0.62, 0.5, beamMatEdge);
  edge.position.set(6, 5.55, -10.6); scene.add(edge);
  const wlMat = stoneWallMat.clone();
  wlMat.normalScale = new THREE.Vector2(0.6, 0.6);
  const wl = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.9), wlMat);
  wl.position.set(-10.4, 2.95, -4); wl.rotation.y = Math.PI / 2; scene.add(wl);
  /* the terrace parapets: along the outer lip (the vehicles park
     just inside it, poised at the edge) and the right return */
  const par = box(18.2, 1.05, 0.35, parapetMat);
  par.position.set(7.1, 0.525, -13.8); scene.add(par);
  const cap = box(18.4, 0.09, 0.5, plainStone);
  cap.position.set(7.1, 1.09, -13.8); scene.add(cap);
  const parR = box(0.35, 1.05, 4.3, parapetMat);
  parR.position.set(15.9, 0.525, -11.65); scene.add(parR);
  const capR = box(0.5, 0.09, 4.5, plainStone);
  capR.position.set(15.9, 1.09, -11.65); scene.add(capR);
}

/* ================= the vista, in true layers =================
   Johnny's Highlands reference (2026-11-26 23:33): layered mist,
   dense pines in front, hazed peaks behind — and his own photo
   holds the same layering (mist in the river bend, ridge behind
   ridge). So the vista is built as separated layers at real
   depths, each its own cylinder segment centred on the house:
   near treeline 27 m → mist → the photo's river + forest 42 m →
   mist → the photo's far ridge 56 m → the backdrop's pale peaks
   70 m. Parallax between them is TRUE when the camera moves;
   nothing is a single flat band, so nothing can smear. */
function vistaLayer(r, h, y, mat, order) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 48, 1, true, Math.PI - 1.55, 3.1), mat);
  m.position.set(2, y, -6);
  m.renderOrder = order;
  scene.add(m);
  return m;
}
{
  /* near treeline: the PHOTO's own near-shore forest, alpha-cut
     along its real tree-top silhouette (assets-v3/treeline.png,
     extracted from the hero photo) — no drawn trees anywhere in
     the vista (parent review, 2026-11-27 00:42: the procedural
     pines read as paper cutouts, the single most fake read in
     the frame). Mirrored repeat so the band runs the full arc */
  /* round 2: assets-v4/treeline.webp replaces the old strip (a
     repeating mini-vista whose tiles read as boxy chunks): real
     photo conifer crowns (the hardened pine-a extraction) tiled
     over a darkened forest-slope mass from the same photo */
  const treeT = texLoader.load('games-room/assets-v4/treeline.webp');
  treeT.colorSpace = THREE.SRGBColorSpace;
  treeT.wrapS = THREE.MirroredRepeatWrapping; treeT.repeat.x = 2;
  vistaLayer(27, 7, 1.1, new THREE.MeshBasicMaterial({
    map: treeT, transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
  }), 5);
  /* mist bands: soft translucent veils BETWEEN the layers, the
     atmospheric perspective of the Highlands clip */
  const mistC = document.createElement('canvas'); mistC.width = 512; mistC.height = 128;
  {
    const g = mistC.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(226,235,242,0)');
    grad.addColorStop(0.38, 'rgba(226,235,242,0.42)');
    grad.addColorStop(0.62, 'rgba(226,235,242,0.36)');
    grad.addColorStop(1, 'rgba(226,235,242,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 128);
    g.globalCompositeOperation = 'destination-out';
    const vary = g.createLinearGradient(0, 0, 512, 0);
    vary.addColorStop(0, 'rgba(0,0,0,0.25)'); vary.addColorStop(0.3, 'rgba(0,0,0,0)');
    vary.addColorStop(0.55, 'rgba(0,0,0,0.3)'); vary.addColorStop(0.8, 'rgba(0,0,0,0)');
    vary.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = vary; g.fillRect(0, 0, 512, 128);
    g.globalCompositeOperation = 'source-over';
  }
  const mistT = new THREE.CanvasTexture(mistC);
  const mistMat = op => new THREE.MeshBasicMaterial({
    map: mistT, transparent: true, opacity: op, depthWrite: false, side: THREE.BackSide, fog: false,
  });
  vistaLayer(33, 10, 0.6, mistMat(0.08), 4);
  vistaMidMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.BackSide, fog: false,
  });
  /* round 2: the mid ring comes in from 42 to 38 and lifts a
     touch — from the entry its river band compressed into a flat
     stripe at the parapet line; nearer and higher, the river's
     bend survives the doorway's thin vertical window */
  vistaLayer(38, 11, 1.2, vistaMidMat, 3);
  vistaLayer(49, 11, 0.9, mistMat(0.05), 2);
  vistaFarMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.BackSide, fog: false,
  });
  vistaLayer(56, 13, 2.0, vistaFarMat, 1);
}
/* real pines on the hillside — geometry, so the nearest layer has
   true silhouette and true parallax: instanced trunks + three
   foliage tiers, scattered beyond the parapet, plus two tall
   pines flanking the terrace as the photo's stand */
{
  /* the pines FRAME the vista from the terrace's edges, as the
     photo's do — the centre is left to the photographic treeline
     layer, the mist and the river */
  const spots = [];
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    const phi = side * (0.88 + rnd() * 0.4);
    /* far, low and wide of the sightlines: at the terrace they
       must read as the photo's dark distant treeline at the
       frame's edges — mid-green cones at r30 read as paper
       triangles in the centre (parent review, 2026-11-27) */
    const r = 37 + rnd() * 9;
    const h = 2.2 + rnd() * 1.1;
    spots.push({ x: 2 + Math.sin(phi) * r, z: -6 - Math.cos(phi) * r, h });
  }
  /* the two near flanking pines are no longer cones (round 2):
     they are photographic cards cut from the photo's own tall
     pine, below — flat dark triangles at 20 m were the terrace
     frame's most fake read after the vista itself */
  const coneGeo = new THREE.ConeGeometry(1, 1, 7);
  const folMat = new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: 0.22 });
  const cones = new THREE.InstancedMesh(coneGeo, folMat, spots.length * 3);
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.06, 0.10, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x4A3826, roughness: 1 }), spots.length);
  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), col = new THREE.Color();
  const cA = new THREE.Color(0x22382A), cB = new THREE.Color(0x33493B);
  spots.forEach((s, i) => {
    m4.compose(new THREE.Vector3(s.x, s.h * 0.09, s.z), q0, new THREE.Vector3(1, s.h * 0.18, 1));
    trunks.setMatrixAt(i, m4);
    const tiers = [[0.30, 0.16, 0.52], [0.23, 0.40, 0.50], [0.15, 0.62, 0.46]];
    tiers.forEach(([rr, yy, hh], k) => {
      m4.compose(new THREE.Vector3(s.x, s.h * yy + s.h * hh / 2, s.z), q0,
        new THREE.Vector3(s.h * rr, s.h * hh, s.h * rr));
      cones.setMatrixAt(i * 3 + k, m4);
      cones.setColorAt(i * 3 + k, col.copy(cA).lerp(cB, rnd()));
    });
  });
  scene.add(trunks); scene.add(cones);
  /* photographic pines near the terrace: crossed pairs of cards
     carrying the photo's own tall pine (assets-v4/pine-a.webp,
     keyed off the photo's mist), so the nearest layer has a real
     tree's silhouette and texture. The tree fills the texture's
     lower ~92% (its top is trimmed); each card is sunk 0.25 m so
     the trunk roots below the parapet line. One texture, four
     stands, two of them mirrored for variety. Basic material,
     fog off — they belong to the vista stack, not the room. */
  const pineTexA = texLoader.load('games-room/assets-v4/pine-a.webp');
  pineTexA.colorSpace = THREE.SRGBColorSpace; pineTexA.anisotropy = 8;
  const pineTexB = pineTexA.clone();
  pineTexB.wrapS = THREE.RepeatWrapping; pineTexB.repeat.x = -1; pineTexB.needsUpdate = true;
  const pineCard = (tex, w, h, x, z, ry) => {
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.32, side: THREE.DoubleSide, fog: false,
    });
    for (const a of [0, Math.PI / 3]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      p.rotation.y = a; grp.add(p);
    }
    grp.position.set(x, h / 2 - 0.25, z); grp.rotation.y = ry;
    scene.add(grp);
  };
  pineCard(pineTexA, 3.4, 8.2, -7.5, -20, 0.4);
  pineCard(pineTexB, 3.0, 7.0, 19.5, -24, 1.1);
  pineCard(pineTexB, 3.8, 9.0, -14.5, -27.5, 0.9);
  pineCard(pineTexA, 3.2, 7.6, 26.5, -31, 0.2);
}
/* light behaving like light: soft volumetric-feeling shafts where
   the sun enters — two crossed-gradient cards along the sun's own
   direction at the door bay and the open terrace side, plus the
   bright pool where that light lands on the floorboards */
const sunDirToSun = new THREE.Vector3(15, 10.5, -16).normalize();
{
  const shaftC = document.createElement('canvas'); shaftC.width = 128; shaftC.height = 256;
  {
    const g = shaftC.getContext('2d');
    const v = g.createLinearGradient(0, 0, 0, 256);
    v.addColorStop(0, 'rgba(255,255,255,0.9)'); v.addColorStop(0.6, 'rgba(255,255,255,0.38)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = v; g.fillRect(0, 0, 128, 256);
    g.globalCompositeOperation = 'destination-in';
    const hz = g.createLinearGradient(0, 0, 128, 0);
    hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(0.3, 'rgba(0,0,0,1)');
    hz.addColorStop(0.7, 'rgba(0,0,0,1)'); hz.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hz; g.fillRect(0, 0, 128, 256);
    g.globalCompositeOperation = 'source-over';
  }
  const shaftT = new THREE.CanvasTexture(shaftC);
  const shaft = (w, len, sx, sy, sz, op) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len),
      new THREE.MeshBasicMaterial({
        map: shaftT, transparent: true, opacity: op, color: 0xFFE9C4,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        fog: false, toneMapped: false,
      }));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDirToSun);
    m.rotateY(0.5);
    const d = sunDirToSun.clone().multiplyScalar(-len * 0.38);
    m.position.set(sx + d.x, sy + d.y, sz + d.z);
    m.renderOrder = 6;
    scene.add(m);
  };
  shaft(2.4, 6.5, 3.58, 3.4, -11, 0.10);
  shaft(1.1, 5.5, 2.6, 3.2, -11, 0.08);
  shaft(3.2, 7.5, 8.5, 4.6, -10.6, 0.06);
  const patchC = document.createElement('canvas'); patchC.width = patchC.height = 128;
  {
    const g = patchC.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,225,170,0.8)'); gr.addColorStop(1, 'rgba(255,225,170,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const patchGeo = new THREE.PlaneGeometry(5.2, 3.2); patchGeo.rotateX(-Math.PI / 2);
  const patch = new THREE.Mesh(patchGeo, new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(patchC), transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }));
  /* the pool lands where the sun's own rays land: through the
     door bay, down-left across the floorboards toward the
     fireplace side — the photo's signature diagonal */
  patch.position.set(-2.4, 0.014, -4.8); patch.rotation.y = -2.19; patch.renderOrder = 2;
  scene.add(patch);
}

/* fill kept LOW so the sun's direction reads: the first build's
   even fill washed every shadow out (parent review, 2026-11-27
   00:42 — "warmer but still even, no raking sun"). The IBL and
   the two warm points carry the ambience; this is just a lift */
/* round 2: the hemisphere lift drops a touch (0.6 → 0.52) and the
   island marble's env reflection with it — the bright photo IBL
   was washing the sun's modelling out of the stone and counter,
   the flat read that survived round 1 */
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x4a3b28, 0.52));
/* the sun: warm late-day light raking IN from the terrace side —
   through the folded-open doors, across the island and the floor,
   the photo's own light. One shadow-casting light fitted to the
   room (2048 map, soft kernel): the frame-budget choice that
   buys every contact shadow in the room */
const sun = new THREE.DirectionalLight(0xFFDFAE, 3.6);
sun.position.set(13, 10.5, -19);
sun.target.position.set(-2, 0.4, -3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
sun.shadow.camera.near = 2; sun.shadow.camera.far = 55;
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
scene.add(sun); scene.add(sun.target);
/* warm downlights over the living area and the porch, matching the
   photo's late-afternoon warmth */
for (const [lx, lz] of [[-2, -6], [5, -7]]) {
  const down = new THREE.PointLight(0xffdfae, 14, 18, 2);
  down.position.set(lx, 4.8, lz);
  scene.add(down);
}
const fireGlow = new THREE.PointLight(0xff9a4d, 3.6, 9, 2);
fireGlow.position.set(-7.5, 1.2, -10.2);
scene.add(fireGlow);

/* soft contact shadow: a radial-gradient blob, so objects sit IN the room */
function blobShadow(w, d, opacity = 0.42) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, `rgba(10,6,2,${opacity})`); grad.addColorStop(1, 'rgba(10,6,2,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.renderOrder = 1;
  return m;
}

/* ================= living screens ================= */
/* Line Rider, alive — in v3 it plays on the iPad on the island. */
const lrCanvas = document.createElement('canvas'); lrCanvas.width = 512; lrCanvas.height = 300;
const lrCtx = lrCanvas.getContext('2d');
const lrTex = new THREE.CanvasTexture(lrCanvas); lrTex.colorSpace = THREE.SRGBColorSpace;
const lrTrack = [];
for (let i = 0; i <= 120; i++) {
  const x = i / 120;
  lrTrack.push({ x: 20 + x * 472, y: 78 + Math.sin(x * 5.2) * 34 + Math.sin(x * 13.7) * 9 + x * 66 });
}
function drawLineRider(time) {
  const g = lrCtx, W = 512, H = 300;
  g.fillStyle = '#0b0e14'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(140,160,200,0.20)';
  for (let x = 16; x < W; x += 32) for (let y = 16; y < H; y += 32) g.fillRect(x, y, 2, 2);
  g.strokeStyle = '#57a8ff'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath();
  lrTrack.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
  const u = (time % 5200) / 5200;
  const fi = u * (lrTrack.length - 1), i0 = Math.floor(fi), fr = fi - i0;
  const a = lrTrack[i0], b = lrTrack[Math.min(i0 + 1, lrTrack.length - 1)];
  const sx = a.x + (b.x - a.x) * fr, sy = a.y + (b.y - a.y) * fr;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  g.save(); g.translate(sx, sy - 7); g.rotate(ang);
  g.strokeStyle = '#e8ecf4'; g.lineWidth = 3; g.beginPath();
  g.moveTo(-11, 4); g.lineTo(10, 4); g.moveTo(-4, 4); g.lineTo(-8, -2); g.stroke();
  g.fillStyle = '#e33f2f'; g.beginPath(); g.arc(1, -9, 5.5, 0, 7); g.fill();
  g.fillStyle = '#f4f6fb'; g.beginPath(); g.arc(0, -3, 4.4, 0, 7); g.fill();
  g.restore();
  lrTex.needsUpdate = true;
}

/* the desk monitor's idle screen: a dim desktop, plain dressing */
const idleCanvas = document.createElement('canvas'); idleCanvas.width = 512; idleCanvas.height = 300;
{
  const g = idleCanvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, '#1a2230'); grad.addColorStop(1, '#0d1119');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 300);
  g.fillStyle = 'rgba(150,170,205,0.13)';
  g.fillRect(36, 34, 190, 120); g.fillRect(250, 60, 220, 160); g.fillRect(60, 180, 130, 80);
  g.fillStyle = 'rgba(150,170,205,0.20)';
  g.fillRect(36, 34, 190, 16); g.fillRect(250, 60, 220, 16);
}
const idleTex = new THREE.CanvasTexture(idleCanvas); idleTex.colorSpace = THREE.SRGBColorSpace;

/* Threads, alive on the tablet beside the armchair. */
const thCanvas = document.createElement('canvas'); thCanvas.width = 640; thCanvas.height = 400;
const thCtx = thCanvas.getContext('2d');
const thTex = new THREE.CanvasTexture(thCanvas); thTex.colorSpace = THREE.SRGBColorSpace;
const thImg = new Image(); let thReady = false;
thImg.onload = () => { thReady = true; }; thImg.src = 'games-room/assets/game-peek-threads-play.webp';
const thNodes = [[70, 90], [300, 60], [560, 110], [120, 250], [430, 210], [580, 300], [240, 330]];
function drawThreads(time) {
  const g = thCtx, W = 640, H = 400;
  g.fillStyle = '#141210'; g.fillRect(0, 0, W, H);
  if (thReady) { g.filter = 'brightness(1.35) saturate(1.15)'; g.drawImage(thImg, 0, 0, W, H); g.filter = 'none'; }
  g.fillStyle = 'rgba(8,6,4,0.10)'; g.fillRect(0, 0, W, H);
  const pairs = [[0, 1], [1, 2], [0, 3], [3, 4], [4, 2], [4, 5], [3, 6], [6, 5], [1, 4]];
  g.globalCompositeOperation = 'lighter';
  pairs.forEach(([i, j], k) => {
    const [x1, y1] = thNodes[i], [x2, y2] = thNodes[j];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + 26;
    const pulse = 0.55 + 0.45 * Math.sin(time / 700 + k * 1.7);
    g.strokeStyle = `rgba(255,${170 + Math.round(40 * pulse)},90,${0.35 + 0.4 * pulse})`;
    g.lineWidth = 2.2; g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
  });
  const cyc = (time % 6000) / 6000;
  const [x1, y1] = thNodes[3], [x2, y2] = thNodes[5];
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + 34;
  const px = (1 - cyc) * (1 - cyc) * x1 + 2 * (1 - cyc) * cyc * mx + cyc * cyc * x2;
  const py = (1 - cyc) * (1 - cyc) * y1 + 2 * (1 - cyc) * cyc * my + cyc * cyc * y2;
  const glow = g.createRadialGradient(px, py, 1, px, py, 26);
  glow.addColorStop(0, 'rgba(255,230,170,0.95)'); glow.addColorStop(1, 'rgba(255,180,80,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(px, py, 26, 0, 7); g.fill();
  g.globalCompositeOperation = 'source-over';
  thNodes.forEach(([x, y]) => {
    g.fillStyle = '#ffd9a0'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
    g.fillStyle = 'rgba(60,40,20,0.9)'; g.beginPath(); g.arc(x, y, 7.5, 0, 7); g.stroke();
  });
  thTex.needsUpdate = true;
}

/* The Frequency Generator's Chladni plate: sand settling into resonant
   figures, crossfading between two modes — the instrument is ON. */
function chladniPattern(mode) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3d42'; g.fillRect(0, 0, 512, 512);
  const grd = g.createRadialGradient(256, 256, 40, 256, 256, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  const [m, n] = mode;
  g.fillStyle = 'rgba(238,214,165,0.95)';
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const dx = x - 256, dy = y - 256, r = Math.hypot(dx, dy) / 256;
    if (r > 0.98) continue;
    const th = Math.atan2(dy, dx);
    const f = Math.cos(m * th) * Math.cos(n * Math.PI * r * 0.5) - Math.cos(n * th) * Math.cos(m * Math.PI * r * 0.5);
    if (Math.abs(f) < 0.10) g.fillRect(x, y, 2.0, 2.0);
  }
  g.fillStyle = '#101114'; g.beginPath(); g.arc(256, 256, 10, 0, 7); g.fill();
  return c;
}
const fgCanvas = document.createElement('canvas'); fgCanvas.width = fgCanvas.height = 512;
const fgCtx = fgCanvas.getContext('2d');
const fgTex = new THREE.CanvasTexture(fgCanvas); fgTex.colorSpace = THREE.SRGBColorSpace;
const fgPatA = chladniPattern([2, 0]), fgPatB = chladniPattern([3, 1]);
function drawPlate(time) {
  const ph = (time % 9000) / 9000, blend = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
  fgCtx.globalAlpha = 1; fgCtx.drawImage(fgPatA, 0, 0);
  fgCtx.globalAlpha = blend * 0.9; fgCtx.drawImage(fgPatB, 0, 0);
  fgCtx.globalAlpha = 1; fgTex.needsUpdate = true;
}

/* ================= stations ================= */
const stations = [];
function screenMesh(w, h, tex) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
}
function registerStation(cfg) {
  const hit = box(cfg.hit[0], cfg.hit[1], cfg.hit[2],
    new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.copy(cfg.focus);
  hit.userData.station = cfg;
  scene.add(hit);
  cfg.hitMesh = hit;
  stations.push(cfg);
  return cfg;
}
const parkedName = () => `Universe — ${parkedCraft === 'disc' ? 'the Disc' : 'Starman'}`;

/* the desk, against the library wall: monitor (dark, plain dressing),
   keyboard, mug. No station in v3. */
{
  const desk = new THREE.Group(); desk.position.set(0.9, 0, -10.12);
  const top = box(1.7, 0.05, 0.8, pineMat); top.position.y = 0.74; desk.add(top);
  for (const [lx, lz] of [[-0.78, -0.33], [0.78, -0.33], [-0.78, 0.33], [0.78, 0.33]]) {
    const leg = box(0.06, 0.74, 0.06, pineMat); leg.position.set(lx, 0.37, lz); desk.add(leg);
  }
  /* round 2: the monitor and keyboard are gone — a glowing office
     screen was the one wrong-era object in the entry frame, and the
     reference photo has no screen here. The desk reads as a library
     console now: a stack of books and the mug. */
  const dbk1 = box(0.44, 0.055, 0.31, new THREE.MeshStandardMaterial({ color: 0x5d4030, roughness: 0.75 }));
  dbk1.position.set(-0.18, 0.795, -0.08); dbk1.rotation.y = 0.14; desk.add(dbk1);
  const dbk2 = box(0.38, 0.045, 0.27, new THREE.MeshStandardMaterial({ color: 0x33503e, roughness: 0.75 }));
  dbk2.position.set(-0.18, 0.845, -0.08); dbk2.rotation.y = 0.3; desk.add(dbk2);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 18),
    new THREE.MeshStandardMaterial({ color: 0xb9c4cc, roughness: 0.4 }));
  mug.position.set(0.55, 0.815, 0.12); desk.add(mug);
  desk.add(blobShadow(2.0, 1.1));
  scene.add(desk);
}

/* the wooden table: plain dressing in v3 — books and a mug where the
   Frequency Generator used to sit */
{
  const table = new THREE.Group(); table.position.set(-4.4, 0, -5.1);
  const top = box(1.6, 0.05, 0.95, weatheredMat); top.position.y = 0.72; table.add(top);
  for (const [lx, lz] of [[-0.72, -0.4], [0.72, -0.4], [-0.72, 0.4], [0.72, 0.4]]) {
    const leg = box(0.07, 0.72, 0.07, weatheredMat); leg.position.set(lx, 0.36, lz); table.add(leg);
  }
  const bk1 = box(0.42, 0.05, 0.3, new THREE.MeshStandardMaterial({ color: 0x6d4a2f, roughness: 0.7 }));
  bk1.position.set(-0.28, 0.775, 0.05); bk1.rotation.y = 0.2; table.add(bk1);
  const bk2 = box(0.36, 0.04, 0.26, new THREE.MeshStandardMaterial({ color: 0x39506b, roughness: 0.7 }));
  bk2.position.set(-0.28, 0.82, 0.05); bk2.rotation.y = 0.32; table.add(bk2);
  const mug2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 18),
    new THREE.MeshStandardMaterial({ color: 0x8a4f3a, roughness: 0.5 }));
  mug2.position.set(0.42, 0.795, -0.15); table.add(mug2);
  const wtPot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.09, 12),
    new THREE.MeshStandardMaterial({ color: 0x9A5F43, roughness: 0.9 }));
  wtPot.position.set(-0.58, 0.79, -0.22); table.add(wtPot);
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045 + rnd() * 0.015, 1),
      new THREE.MeshStandardMaterial({ color: [0x4A6032, 0x5A7040, 0x3E5228][i], roughness: 0.9, flatShading: true }));
    leaf.position.set(-0.58 + (rnd() - 0.5) * 0.05, 0.87 + rnd() * 0.03, -0.22 + (rnd() - 0.5) * 0.05); table.add(leaf);
  }
  table.add(blobShadow(1.9, 1.25));
  scene.add(table);
}

/* Line Rider: an iPad PROPPED on a stand on the kitchen island,
   screen alive (Johnny, 2026-11-27 07:43: "prop up the Line Rider
   iPad" — lying flat it read as a black slab from across the room;
   on its stand at ~35° the drawn track faces the room). The stand
   is furniture: it stays on the counter when the pick-up lifts the
   iPad off it. The start is unchanged: approach lifts the iPad to
   meet you while the camera pushes into its screen. */
const ipadRig = { group: null, rest: null, lifted: null };
let ipadK = 0;
{
  const ipad = new THREE.Group();
  ipad.position.set(0.9, 1.065, -2.3); ipad.rotation.set(0.62, -0.35, 0);
  const body = box(0.62, 0.022, 0.45, darkMetal); ipad.add(body);
  const scr = screenMesh(0.56, 0.385, lrTex);
  scr.rotation.x = -Math.PI / 2; scr.position.y = 0.013;
  ipad.add(scr);
  scene.add(ipad);
  ipadRig.group = ipad;
  ipadRig.rest = { p: ipad.position.clone(), e: ipad.rotation.clone() };
  ipadRig.lifted = { p: new THREE.Vector3(0.9, 1.10, -2.02), e: new THREE.Euler(0.55, -0.35, 0) };
  /* the stand: an inclined walnut plank at the iPad's own tilt
     that its back rests on (foot on the counter at the front,
     rising toward the back) and a small lip at its lower edge —
     in the island's world spot, yawed with the iPad (-0.35).
     Positive x-tilt is what turns a screen toward the room: the
     plank's long axis is its local z, tilted like the iPad's */
  const stand = new THREE.Group(); stand.position.set(0.9, 0, -2.3); stand.rotation.y = -0.35;
  const plank = box(0.5, 0.018, 0.40, timberMat);
  plank.position.set(0, 1.040, -0.018); plank.rotation.x = 0.62; stand.add(plank);
  const lip = box(0.5, 0.03, 0.035, darkMetal); lip.position.set(0, 0.937, 0.20); stand.add(lip);
  scene.add(stand);
  /* a tighter, stronger contact shadow: at glancing angles the
     iPad read as a black plate floating over the counter — the
     shadow is what seats it */
  const sh = blobShadow(1.0, 0.78, 0.66); sh.position.set(0.9, 0.923, -2.3); scene.add(sh);
  registerStation({
    id: 'linerider', name: 'Line Rider',
    focus: new THREE.Vector3(0.9, 1.07, -2.3),
    camPos: new THREE.Vector3(0.85, 1.50, -1.02),
    camFocus: new THREE.Vector3(0.9, 1.10, -2.24),
    pushPos: new THREE.Vector3(0.88, 1.28, -1.50),
    pushFocus: new THREE.Vector3(0.9, 1.10, -2.16),
    /* the hitbox hugs the propped slab: the old 0.7-tall box
       reached 0.2 above it and ate the Threads tablet's sightline
       behind it (gate6) */
    hit: [0.85, 0.42, 0.6],
    tapObj: ipadRig.group,
  });
}

/* Frequency Generator: a compact instrument on the coffee table by
   the armchairs — plate alive on top */
{
  const table = new THREE.Group(); table.position.set(-2.6, 0, -6.4);
  const top = box(1.25, 0.05, 0.65, weatheredMat); top.position.y = 0.42; table.add(top);
  for (const [lx, lz] of [[-0.55, -0.26], [0.55, -0.26], [-0.55, 0.26], [0.55, 0.26]]) {
    const leg = box(0.06, 0.42, 0.06, weatheredMat); leg.position.set(lx, 0.21, lz); table.add(leg);
  }
  /* the rig sits RAISED on its driver base, the way a real
     Chladni setup does (Johnny, 2026-11-27 07:45): the plate
     stays LEVEL — a tilted plate would spill its sand — on a
     believable base unit that lifts it clear of the table edge's
     sightline from the entry, pattern up and readable */
  const baseFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.33, 0.025, 36), darkMetal);
  baseFoot.position.set(-0.25, 0.457, 0); table.add(baseFoot);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.305, 0.135, 36), darkMetal);
  base.position.set(-0.25, 0.537, 0); table.add(base);
  const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.295, 0.295, 0.018, 36),
    new THREE.MeshStandardMaterial({ color: 0x8f959e, roughness: 0.35, metalness: 0.85 }));
  baseRing.position.set(-0.25, 0.60, 0); table.add(baseRing);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.018, 40),
    [darkMetal, new THREE.MeshBasicMaterial({ map: fgTex, toneMapped: false }), darkMetal]);
  plate.position.set(-0.25, 0.618, 0); table.add(plate);
  const amp = box(0.30, 0.13, 0.20, blackGlass); amp.position.set(0.30, 0.51, -0.13); amp.rotation.y = -0.25; table.add(amp);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.025, 16),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.3, metalness: 0.7 }));
  knob.position.set(0.22, 0.585, -0.16); table.add(knob);
  /* the photo's coffee table carries a small book stack and a
     potted plant beside the instrument — placed clear of the
     plate's swing (plate centre (−0.25, 0), radius 0.34) */
  const cb1 = box(0.34, 0.032, 0.25, new THREE.MeshStandardMaterial({ color: 0x6E4A30, roughness: 0.75 }));
  cb1.position.set(0.02, 0.461, 0.235); cb1.rotation.y = 0.15; table.add(cb1);
  const cb2 = box(0.28, 0.028, 0.20, new THREE.MeshStandardMaterial({ color: 0x44586B, roughness: 0.75 }));
  cb2.position.set(0.02, 0.491, 0.235); cb2.rotation.y = -0.06; table.add(cb2);
  const ctPot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.08, 12),
    new THREE.MeshStandardMaterial({ color: 0x9A5F43, roughness: 0.9 }));
  ctPot.position.set(0.52, 0.485, -0.24); table.add(ctPot);
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04 + rnd() * 0.015, 1),
      new THREE.MeshStandardMaterial({ color: [0x4A6032, 0x5A7040, 0x3E5228][i], roughness: 0.9, flatShading: true }));
    leaf.position.set(0.52 + (rnd() - 0.5) * 0.05, 0.56 + rnd() * 0.03, -0.24 + (rnd() - 0.5) * 0.05); table.add(leaf);
  }
  table.add(blobShadow(1.5, 0.95));
  scene.add(table);
  registerStation({
    id: 'frequency', name: 'Frequency Generator',
    focus: new THREE.Vector3(-2.85, 0.64, -6.38),
    camPos: new THREE.Vector3(-2.45, 1.30, -4.85),
    hit: [1.5, 0.9, 1.0],
    /* the tap zone is the rig's own bounds — plate, driver base
       and amp, unioned at tap time — not the whole coffee table */
    tapMeshes: [plate, base, baseFoot, baseRing, amp, knob],
  });
}

/* Threads: a tablet on a small round side table beside the white
   armchair — it lifts to meet you, then settles back, exactly as
   v2's iPad did */
const tabletRig = { rest: null, lifted: null, group: null };
let tabletK = 0;
{
  /* round 2: the side table + tablet moved 0.40 m left and
     0.15 m forward (to -1.25, -8.40): from the entry seat the
     tablet was wholly shadowed behind the island iPad — its
     sightline grazed the iPad's tap box and a 25-click scan
     over its rect fired it zero times. From the round-2 entry
     framing the sightline now clears the iPad by ~0.7 m, and
     the table still stands beside the white armchair */
  const side = new THREE.Group(); side.position.set(-1.25, 0, -8.40);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.03, 24), pineMat);
  top.position.y = 0.55; side.add(top);
  /* a pedestal with body: the first build's 3 cm leg vanished
     against the room at reading distance, and the table + tablet
     read as floating mid-room (Johnny's recording). Darker timber,
     a trumpet base, and a real contact shadow keep it standing. */
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 0.50, 14), plainWood);
  leg.position.y = 0.28; side.add(leg);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.21, 0.06, 20), plainWood);
  foot.position.y = 0.03; side.add(foot);
  side.add(blobShadow(0.95, 0.95, 0.52));
  scene.add(side);
  /* propped on a small stand like the iPad (Johnny, 2026-11-27
     07:43): at 0.22 rad lying back it read as a dark slab from
     the entry; at ~30° on its plank the living Threads screen
     faces the room and the armchair. The stand stays on the side
     table when the tablet lifts to meet you */
  const grp = new THREE.Group(); grp.position.set(-1.25, 0.665, -8.40); grp.rotation.set(0.52, 0.30, 0);
  const body = box(0.52, 0.018, 0.36, darkMetal); grp.add(body);
  const scr = screenMesh(0.47, 0.315, thTex); scr.rotation.x = -Math.PI / 2; scr.position.y = 0.011; grp.add(scr);
  scene.add(grp);
  const tStand = new THREE.Group(); tStand.position.set(-1.25, 0, -8.40); tStand.rotation.y = 0.30;
  const tPlank = box(0.42, 0.016, 0.32, timberMat);
  tPlank.position.set(0, 0.643, -0.012); tPlank.rotation.x = 0.52; tStand.add(tPlank);
  const tLip = box(0.42, 0.028, 0.03, darkMetal); tLip.position.set(0, 0.578, 0.165); tStand.add(tLip);
  scene.add(tStand);
  tabletRig.group = grp; tabletRig.rest = grp.position.clone();
  tabletRig.lifted = grp.position.clone().add(new THREE.Vector3(0, 0.203, 0.20));
  registerStation({
    id: 'threads', name: 'Threads',
    focus: new THREE.Vector3(-1.25, 0.69, -8.40),
    /* the start is a sit-down: the camera settles into the white
       armchair itself, eyes at seated height, looking at the tablet
       on the side table — the doors and terrace behind it, not the
       unphotographed space behind the photo's own camera */
    camPos: new THREE.Vector3(-1.30, 1.22, -8.15),
    camFocus: new THREE.Vector3(-1.25, 0.62, -8.40),
    hit: [0.7, 0.5, 0.6],
    tapObj: tabletRig.group,
  });
}

/* ============ the vehicle pad: Disc ⇄ Starman, and the kart ============ */
const PAD = new THREE.Vector3(4.6, 0, -9.7);
/* the kart parks further right and deeper than the first build:
   from the entry seat its old spot lined up exactly over the
   island with the black faucet stem under it, so it read as
   mounted on a pole over the counter (Johnny's recording,
   2026-11-27 00:21). From the seat, this spot's sightline clears
   the island's right end entirely and lands on open terrace */
/* round 2: nudged 0.6 m toward the opening — from the new entry
   framing the old spot sat at the frame's very edge (a sliver);
   this lands the kart in the entry's right third, still a few
   feet from the pad on open terrace */
const KART_POS = new THREE.Vector3(8.8, 0, -11.6);
const HOVER = 0.30;
/* parked vehicles REST on the pad (Johnny, 2026-11-27 00:21):
   grounded, still, one at rest — no hover, no bob. The Disc's
   wrap origin is its body's base; the kart's billboard base sits
   0.305 below its group origin, hence its higher rest height */
const REST_Y = 0.02;
const KART_REST_Y = 0.325;
let parkedCraft = 'disc';
let swapAnim = null;
let discShadow, starShadow, discWrap, starWrap, craftHitMesh, discBuilt = null;
let craftTapBoxes = null;
const craftSizes = {};
{
  const factory = makeCraft(renderer);
  discBuilt = factory.buildDisc();
  const starBuilt = factory.buildStarman();
  /* measure the real builds, scale them to their room sizes (the Disc
     3.60 m across, Starman 3.95 m long — the v2 measurements), and seat
     each in a wrap whose origin is the pad point under it, so the
     wrap's height IS the hover height */
  discWrap = new THREE.Group();
  discBuilt.group.scale.setScalar(3.60 / new THREE.Box3().setFromObject(discBuilt.group).getSize(new THREE.Vector3()).x);
  let bb = new THREE.Box3().setFromObject(discBuilt.group);
  discBuilt.group.position.y = -bb.min.y;
  discWrap.add(discBuilt.group); scene.add(discWrap);
  discWrap.position.set(PAD.x, REST_Y, PAD.z);
  const ds = new THREE.Box3().setFromObject(discWrap).getSize(new THREE.Vector3());
  craftSizes.disc = Math.round(ds.x * 100) / 100;
  starWrap = new THREE.Group();
  /* scale by the car BODY (the loft — the one substantial
     BufferGeometry child): the whole-group box is dominated by the
     invisible-at-park headlight beams and light-smear planes */
  let bodyZ = 0;
  starBuilt.group.children.forEach(c => {
    if (c.geometry && c.geometry.type === 'BufferGeometry') {
      const s = new THREE.Box3().setFromObject(c).getSize(new THREE.Vector3());
      bodyZ = Math.max(bodyZ, s.z);
    }
  });
  const sb0 = new THREE.Box3().setFromObject(starBuilt.group).getSize(new THREE.Vector3());
  const starScale = THREE.MathUtils.clamp(3.95 / (bodyZ || sb0.z), 2, 7);
  starBuilt.group.scale.setScalar(starScale);
  bb = new THREE.Box3().setFromObject(starBuilt.group);
  starBuilt.group.position.y = -bb.min.y;
  starWrap.add(starBuilt.group); scene.add(starWrap);
  starWrap.position.set(PAD.x, REST_Y, PAD.z);
  starWrap.rotation.y = 2.50;
  starWrap.visible = false;
  /* report the body size (effects excluded), scaled */
  const bodyBox = new THREE.Box3();
  starBuilt.group.traverse(o => {
    if (o.isMesh && !['ConeGeometry', 'PlaneGeometry', 'Sprite', 'CircleGeometry'].includes(o.geometry.type)) {
      bodyBox.union(new THREE.Box3().setFromObject(o));
    }
  });
  const ss = bodyBox.getSize(new THREE.Vector3());
  craftSizes.starman = [ss.x, ss.y, ss.z].map(v => Math.round(v * 100) / 100);
  window.__craftDebug = { THREE, star: starBuilt, disc: discBuilt, starWrap, discWrap, scene, camera };
  discShadow = blobShadow(3.6, 3.6, 0.38); discShadow.position.set(PAD.x, 0.012, PAD.z); scene.add(discShadow);
  /* landing pads: a darker stone medallion under each vehicle, so
     the eye has a ground plane to park them on */
  const padDisc = (x, z, r) => {
    const p = new THREE.Mesh(new THREE.CircleGeometry(r, 36),
      new THREE.MeshStandardMaterial({
        map: photoTex('terrace.jpg', 3, 3), normalMap: photoTex('terrace-n.jpg', 3, 3, false),
        color: 0xB3A58C, roughness: 1, envMapIntensity: 0.2,
      }));
    p.rotation.x = -Math.PI / 2; p.position.set(x, 0.007, z); scene.add(p);
  };
  padDisc(PAD.x, PAD.z, 1.9);
  starShadow = blobShadow(4.6, 2.6, 0.36); starShadow.position.set(PAD.x, 0.012, PAD.z);
  starShadow.rotation.z = 2.50; starShadow.visible = false; scene.add(starShadow);
  /* the coarse raycast box is sized to cover both crafts'
     footprints; the projected tap rect (craftTapBox, measured
     lazily from the crafts' own visual bounds) is what actually
     gates a tap */
  craftHitMesh = box(4.4, 1.9, 4.4, new THREE.MeshBasicMaterial({ visible: false }));
  craftHitMesh.position.set(PAD.x, 0.95, PAD.z);
  scene.add(craftHitMesh);
}
function swapCraft() {
  if (swapAnim || view.state !== 'room') return;
  swapAnim = { t: 0, from: parkedCraft, to: parkedCraft === 'disc' ? 'starman' : 'disc', flipped: false };
}
function stepSwap(dt) {
  if (!swapAnim) return;
  swapAnim.t += dt / 380;
  const t = swapAnim.t;
  if (t >= 0.5 && !swapAnim.flipped) {
    swapAnim.flipped = true;
    parkedCraft = swapAnim.to;
    discWrap.visible = parkedCraft === 'disc';
    starWrap.visible = parkedCraft === 'starman';
    discShadow.visible = parkedCraft === 'disc';
    starShadow.visible = parkedCraft === 'starman';
    if (centred && centred.id === 'universe') showPill(centred);
  }
  if (t >= 1) swapAnim = null;
}
function craftDip(craft) {
  if (!swapAnim) return 0;
  const t = swapAnim.t;
  if (craft === swapAnim.from) return t < 0.5 ? Math.sin(t * Math.PI) * 0.17 : 0.17;
  return t < 0.5 ? 0.17 : 0.17 * (1 - Math.sin((t - 0.5) * Math.PI));
}
registerStation({
  id: 'universe', name: 'Universe — the Disc', dynamicName: parkedName,
  focus: new THREE.Vector3(PAD.x, 0.95, PAD.z),
  /* pulled back, up and left from v3's first pose: the old spot
     hovered half a metre over the island's near-right corner, whose
     grazing projected top filled the lower frame with a smeared
     wedge and cut the Disc's rim — now the island's far edge sits
     low in the frame and the pad reads whole */
  camPos: new THREE.Vector3(0.4, 2.3, 0.6),
  hit: [4.4, 2.2, 4.2],
});

/* the Thumb Drive kart, hovering beside the Disc's pad */
let kartGroup, kartShadowMesh, kartBill;
{
  kartGroup = new THREE.Group();
  kartGroup.position.set(KART_POS.x, KART_REST_Y, KART_POS.z); kartGroup.rotation.y = 0.5;
  const tex = texLoader.load('games-room/assets/kart.webp');
  tex.colorSpace = THREE.SRGBColorSpace;
  kartBill = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.05),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  /* the kart is a ground vehicle, not an aircraft: its cutout runs
     to the plane's bottom edge, so the plane sits low in the group
     and the kart's base hovers ~5 cm over its pad. At the old
     height it read as floating on a pole from the entry sightline
     over the island (Johnny's recording, 2026-11-26 23:23) */
  kartBill.position.y = 0.22; kartBill.rotation.x = -0.10;
  kartGroup.add(kartBill);
  scene.add(kartGroup);
  kartShadowMesh = blobShadow(1.8, 1.05, 0.4);
  kartShadowMesh.position.set(KART_POS.x, 0.012, KART_POS.z); kartShadowMesh.rotation.z = 0.5;
  scene.add(kartShadowMesh);
  /* a dense contact core under the kart + its own pad medallion */
  const kartCore = blobShadow(1.15, 0.68, 0.5);
  kartCore.position.set(KART_POS.x, 0.014, KART_POS.z); kartCore.rotation.z = 0.5;
  scene.add(kartCore);
  const kartPad = new THREE.Mesh(new THREE.CircleGeometry(1.35, 32),
    new THREE.MeshStandardMaterial({
      map: photoTex('terrace.jpg', 3, 3), normalMap: photoTex('terrace-n.jpg', 3, 3, false),
      color: 0xB3A58C, roughness: 1, envMapIntensity: 0.2,
    }));
  kartPad.rotation.x = -Math.PI / 2; kartPad.position.set(KART_POS.x, 0.007, KART_POS.z);
  scene.add(kartPad);
  registerStation({
    id: 'thumbdrive', name: 'Thumb Drive',
    /* the focus is the kart's own centre (its billboard plane
       spans y ~0.33..0.87): at 0.85 the station's point sat at
       the kart's roofline and its hitbox floated 0.6 above it */
    focus: new THREE.Vector3(KART_POS.x, 0.62, KART_POS.z),
    camPos: new THREE.Vector3(8.2, 1.75, -7.6),
    hit: [1.9, 0.95, 1.2],
    tapObj: kartGroup,
  });
}

/* ================= view state ================= */
/* the entry framing stands where the photo's camera stands
   (graphics round 2, 2026-11-27 — Johnny: "still not like you
   are actually standing in the picture... get the game room to
   feel identical"): behind the island's left third at standing
   eye height, looking diagonally right across the island, so
   the island fills the lower foreground, the fireplace and
   shelves hold the left, and the door bay, terrace and vista
   open across the right half — the photo's own composition.
   Stations: the iPad centre-foreground, Frequency left-centre,
   Threads left, the pad and kart through the opening right —
   the kart the far case, inside one look-turn everywhere */
const HOME = { pos: new THREE.Vector3(0.55, 1.52, 0.7), focus: new THREE.Vector3(0.6, 1.02, -9.5) };
const view = {
  state: 'room',                       // room | glide | station | open | back
  pos: HOME.pos.clone(), focus: HOME.focus.clone(),
  fromPos: null, fromFocus: null, toPos: null, toFocus: null, t: 0, dur: 0,
  onDone: null, station: null, atSeat: true,
};
/* the entry look: a normalized look (-1..1 each way) that yaws and
   pitches the camera in place at the entry point — you turn your
   head; the glides do the walking. Glides never touch it, so a
   return restores the exact pre-approach look — Δ=0 by construction. */
let lookX = 0, lookPitch = 0;
/* The standing look (rebuilt room, 2026-11-26 20:13): you stand at
   the entry point and TURN — the room is real geometry, so a turn
   is honest from here exactly as it is from anywhere; travelling
   is what the station glides are for. The old model's seat slide
   died with the projection build (it existed to fake parallax in a
   photograph; real geometry has its own). The bounds keep the view
   inside the built room — behind the standing point the house
   isn't modeled — and every station still reaches the centre of
   the frame inside them. A soft knee (softLook) decelerates the
   view into the bounds, so the limit feels like the room ending,
   never a clunk. */
const LIM = () => (innerWidth / innerHeight < 0.8
  ? { yaw: 0.72, pitchUp: 0.24, pitchDown: 0.24, slide: 0 }
  : { yaw: 0.16, pitchUp: 0.08, pitchDown: 0.06, slide: 0 });
/* soft knee: full sensitivity through the middle of the drag, easing
   off toward the ends. A pure function of the stored look, so a
   return still restores the exact pre-approach look — Δ=0. */
const softLook = v => v * (1 - 0.22 * v * v);
function clampLook() {
  lookX = THREE.MathUtils.clamp(lookX, -1, 1);
  lookPitch = THREE.MathUtils.clamp(lookPitch, -1, 1);
}
function seatPos() { return HOME.pos.clone().add(new THREE.Vector3(softLook(lookX) * LIM().slide, 0, 0)); }
function seatFocus() { return HOME.focus.clone().add(new THREE.Vector3(softLook(lookX) * LIM().slide, 0, 0)); }
function applyLook() {
  if (view.state !== 'room' || !view.atSeat) return;
  view.pos.copy(seatPos()); view.focus.copy(seatFocus());
  const L = LIM();
  const yaw = softLook(lookX) * L.yaw;
  const sp = softLook(lookPitch);
  const pitch = sp >= 0 ? sp * L.pitchUp : sp * L.pitchDown;
  const dir = view.focus.clone().sub(view.pos).normalize();
  dir.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  dir.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(right, pitch));
  camera.position.copy(view.pos);
  camera.lookAt(view.pos.clone().add(dir));
}
function glideTo(pos, focus, dur, onDone) {
  view.fromPos = view.pos.clone(); view.fromFocus = view.focus.clone();
  view.toPos = pos.clone(); view.toFocus = focus.clone();
  view.t = 0; view.dur = dur; view.onDone = onDone || null;
  view.state = 'glide';
}
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function stepGlide(dt) {
  if (view.state !== 'glide' && view.state !== 'back') return;
  view.t += dt / (view.dur * 1000);
  const k = ease(Math.min(view.t, 1));
  view.pos.lerpVectors(view.fromPos, view.toPos, k);
  view.focus.lerpVectors(view.fromFocus, view.toFocus, k);
  if (view.t >= 1) {
    const cb = view.onDone; view.onDone = null;
    view.state = view.station ? 'station' : 'room';
    if (cb) cb();
  }
}

/* ================= chrome: Leave, the name pill, the game frame ================= */
const pill = document.getElementById('gr-pill');
const swapPill = document.getElementById('gr-swap');
let centred = null;
function showPill(st) {
  if (st.id === 'universe') {
    /* the pad's pill IS the board action (Johnny, 2026-11-27
       07:43): it names the craft you will fly, tapping the craft
       does the same thing, and the swap lives on its own small
       pill above — one tap target, one verb, so a start can
       never be mistaken for a swap again */
    pill.textContent = parkedCraft === 'disc' ? 'Board the Disc' : 'Board Starman';
    const small = document.createElement('small');
    small.textContent = 'fly out to the Universe';
    pill.appendChild(small);
    swapPill.textContent = parkedCraft === 'disc' ? '⇄ Starman' : '⇄ the Disc';
    swapPill.classList.add('on');
  } else {
    const name = st.dynamicName ? st.dynamicName() : st.name;
    pill.textContent = name;
    const small = document.createElement('small');
    small.textContent = 'tap to walk over';
    pill.appendChild(small);
    swapPill.classList.remove('on');
  }
  pill.classList.add('on');
}
function hidePill() { pill.classList.remove('on'); swapPill.classList.remove('on'); }
function stationById(id) {
  if (id === 'disc' || id === 'starman') id = 'universe';
  return stations.find(s => s.id === id);
}

/* LIVE: the start's last frame hands over to the REAL game on
   games.html — the host (window.__roomHost) hides this overlay and
   opens the game's own stage on the page. The room stays parked in
   state 'open', at the station, until the host calls hostReturn()
   when the game's stage closes. */
function openGame(st) {
  view.state = 'open';
  if (window.__roomHost && window.__roomHost.enterGame) {
    window.__roomHost.enterGame(st.id, parkedCraft);
  }
}
/* leaving a game runs its start backwards: vehicles fly home and
   land, everything else glides back to the seat — Δ=0 either way */
function exitStation() {
  const st = view.station;
  if (st && (st.id === 'universe' || st.id === 'thumbdrive')) {
    view.state = 'prefade';
    if (REDUCED) {
      fadeOverlay(1, 350, () => { backToRoom(); fadeOverlay(0, 350); });
    } else {
      fadeOverlay(1, 450, () => { startFlight(vehicleFor(st), -1, st); });
    }
    return;
  }
  backToRoom();
}
const backBtn = document.getElementById('gr-back');
let backBtnShown = false;
/* the overlay's buttons live in games.html and SURVIVE this
   module: when the room is rebuilt after a game handoff (see
   disposeForGame), the fresh module must not stack a second set
   of handlers on them. Wire once, dispatch through the CURRENT
   window.__room, so the live module always answers */
if (!backBtn.__roomWired) {
  backBtn.__roomWired = true;
  backBtn.addEventListener('click', () => { if (window.__room && window.__room._backTap) window.__room._backTap(); });
}

function approach(st) {
  hidePill(); centred = null;
  view.station = st; view.atSeat = false;
  lastStartSkipped = false;
  const focus = st.camFocus || st.focus;
  if (st.id === 'linerider') {
    /* the pick-up: glide in over the counter, then push into the
       screen while the iPad lifts to meet you (ipadK, in the loop) */
    glideTo(st.camPos, focus, 1.05, () => {
      glideTo(st.pushPos, st.pushFocus, 0.65, () => openGame(st));
    });
  } else if (st.id === 'universe' || st.id === 'thumbdrive') {
    /* boarding: glide to the pad, then the vehicle launches */
    glideTo(st.camPos, focus, 1.25, () => startStart(st));
  } else {
    glideTo(st.camPos, focus, 1.25, () => openGame(st));
  }
}
function backToRoom() {
  view.station = null;
  glideTo(seatPos(), seatFocus(), 1.25, () => { view.atSeat = true; });
  view.state = 'back';
}
if (!pill.__roomWired) {
  pill.__roomWired = true;
  pill.addEventListener('click', () => { if (window.__room && window.__room._pillTap) window.__room._pillTap(); });
  document.getElementById('gr-leave').addEventListener('click', () => {
    if (window.__roomHost && window.__roomHost.leave) window.__roomHost.leave();
  });
}
if (!swapPill.__roomWired) {
  swapPill.__roomWired = true;
  swapPill.addEventListener('click', () => { if (window.__room && window.__room._swapTap) window.__room._swapTap(); });
}

/* ================= launches: the pad is the garage =================
   Every vehicle on the porch launches into its game (Johnny,
   2026-11-26 15:50): board at the pad, lift off, the house falls
   away, accelerate out over the valley, fade through cloud-white —
   the seam where the mock hands over to the game's own opening frame
   (the live build makes it one continuous scene). The return flight
   is the same timeline reversed and lands the vehicle back on its
   spot, Δ=0. A tap mid-flight skips to the arrival; with reduced
   motion the whole start is a plain fade. */
const fadeEl = document.getElementById('gr-fade');
const REDUCED = params.has('rm') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
let overlayOp = 0, overlayAnim = null, flight = null, lastStartSkipped = false;
function setOverlay(v) { overlayOp = v; fadeEl.style.opacity = v.toFixed(3); }
function fadeOverlay(to, dur, onDone) { overlayAnim = { from: overlayOp, to, dur, t: 0, onDone }; }
function stepOverlay(dt) {
  if (!overlayAnim) return;
  overlayAnim.t += dt;
  const k = Math.min(overlayAnim.t / overlayAnim.dur, 1);
  setOverlay(overlayAnim.from + (overlayAnim.to - overlayAnim.from) * k);
  if (k >= 1) { const cb = overlayAnim.onDone; overlayAnim = null; if (cb) cb(); }
}
function vehicleFor(st) { return st.id === 'thumbdrive' ? 'kart' : parkedCraft; }
function rmStart(st) {
  lastStartSkipped = true;
  view.state = 'prefade';
  fadeOverlay(1, 350, () => { openGame(st); fadeOverlay(0, 350); });
}
function startStart(st) {
  if (REDUCED) { rmStart(st); return; }
  startFlight(vehicleFor(st), 1, st);
}
const FLIGHT_DUR = 5600;
function startFlight(vehicle, dir, st) {
  flight = { vehicle, dir, st, t: dir === 1 ? 0 : 1, hold: false };
  view.state = dir === 1 ? 'flight' : 'flightback';
  overlayAnim = null;
}
const sstep = (a, b, x) => { const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const easeInQ = x => x * x;
function applyFlightPose(vehicle, t) {
  const st = stationById(vehicle === 'kart' ? 'thumbdrive' : 'universe');
  const S = st.camPos, F = st.focus;
  let camPos, camFocus, fov = 47.9, speedK = 0;
  if (vehicle === 'disc' || vehicle === 'starman') {
    const wrap = vehicle === 'disc' ? discWrap : starWrap;
    const liftK = sstep(0, 0.30, t);
    const depK = easeInQ(sstep(0.25, 0.80, t));
    speedK = depK;
    const topY = vehicle === 'disc' ? 6.5 : 5.0, outY = vehicle === 'disc' ? 10 : 13;
    const vx = vehicle === 'disc' ? 9 : 3, vz = vehicle === 'disc' ? -30 : -34;
    const craftPos = new THREE.Vector3(
      PAD.x + depK * (vx - PAD.x),
      REST_Y + liftK * topY + depK * outY,
      PAD.z + depK * (vz - PAD.z));
    wrap.position.copy(craftPos);
    if (vehicle === 'disc') {
      /* saucer character: rise flat, then tilt and zip */
      wrap.rotation.set(-0.38 * depK, 0, 0.10 * Math.sin(t * 22) * depK);
    } else {
      /* rocket character: rise, nose up, boost */
      wrap.rotation.set(-0.30 * sstep(0.2, 0.5, t), 2.50, 0);
    }
    const blend = sstep(0.05, 0.45, t);
    camPos = S.clone().lerp(craftPos.clone().add(new THREE.Vector3(-2.6, 1.3, 5.2)), blend);
    camFocus = F.clone().lerp(craftPos.clone().add(new THREE.Vector3(0, 0.2, -2)), blend);
    fov = 47.9 + 13 * depK;
    (vehicle === 'disc' ? discShadow : starShadow).material.opacity = (1 - liftK) * 0.95;
    setOverlay(sstep(0.74, 0.97, t));
  } else {
    /* kart character: a dip, then a low fast dart off the porch,
       nose over the terrace edge */
    const dartK = easeInQ(sstep(0.12, 0.62, t));
    speedK = dartK;
    const dip = 0.08 * Math.sin(Math.PI * Math.min(t / 0.18, 1));
    const craftPos = new THREE.Vector3(
      KART_POS.x + dartK * 7.5,
      KART_REST_Y - dip + dartK * dartK * 1.6,
      KART_POS.z - dartK * 4.5);
    kartGroup.position.copy(craftPos);
    kartBill.rotation.x = -0.10 - 0.30 * Math.sin(Math.PI * Math.min(dartK * 1.2, 1));
    camPos = S.clone().lerp(new THREE.Vector3(7.6, 1.5, -4.6), sstep(0.1, 0.5, t));
    camFocus = F.clone().lerp(craftPos.clone(), sstep(0, 0.2, t));
    fov = 47.9 + 8 * dartK;
    kartShadowMesh.material.opacity = (1 - dartK) * 0.95;
    setOverlay(sstep(0.55, 0.85, t));
  }
  /* gentle shake, deterministic in t so the stills are reproducible */
  const amp = 0.015 + 0.05 * speedK;
  camPos.x += Math.sin(t * 331) * amp * 0.7;
  camPos.y += Math.sin(t * 419 + 1.7) * amp * 0.5;
  camFocus.x += Math.sin(t * 389 + 0.6) * amp * 1.6;
  camFocus.y += Math.sin(t * 457 + 2.9) * amp * 1.2;
  camera.position.copy(camPos);
  camera.fov = fov; camera.updateProjectionMatrix();
  camera.lookAt(camFocus);
}
function restoreParked() {
  discWrap.position.set(PAD.x, REST_Y, PAD.z); discWrap.rotation.set(0, 0, 0);
  starWrap.position.set(PAD.x, REST_Y, PAD.z); starWrap.rotation.set(0, 2.50, 0);
  kartGroup.position.set(KART_POS.x, KART_REST_Y, KART_POS.z);
  kartBill.rotation.x = -0.10;
  camera.fov = 47.9; camera.updateProjectionMatrix();
  setOverlay(0);
}
function stepFlight(dt) {
  if (!flight) return;
  if (!flight.hold) {
    flight.t += flight.dir * dt / FLIGHT_DUR;
    if (flight.dir === 1 && flight.t >= 1) {
      const st = flight.st; flight = null;
      openGame(st);
      setOverlay(1);
      fadeOverlay(0, 900);
      return;
    }
    if (flight.dir === -1 && flight.t <= 0) {
      flight = null;
      restoreParked();
      backToRoom();
      return;
    }
  }
  applyFlightPose(flight.vehicle, flight.t);
}
function skipFlight() {
  if (!flight || flight.hold) return;
  if (flight.dir === 1) {
    const st = flight.st; flight = null;
    setOverlay(1);
    openGame(st);
    fadeOverlay(0, 300);
  } else {
    flight = null;
    restoreParked();
    backToRoom();
  }
}

/* ================= pointing ================= */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function castAt(cx, cy, meshes) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? hits[0].object : null;
}
/* every hit along the ray, nearest first — a tap is arbitrated
   by walking this list: the first object whose own projected
   rect contains the tap owns it. A graze across a big invisible
   hitbox (the pad's box reaches toward the kart's sightline)
   must not eat a tap meant for the object behind it */
function castAll(cx, cy, meshes) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(meshes, false);
}
let downAt = null, dragMoved = 0, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', e => {
  if (flight && !flight.hold) { skipFlight(); return; }
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  dragMoved = 0; lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointermove', e => {
  if (!downAt) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  if (view.state === 'room' && view.atSeat && dragMoved > 6) {
    /* MIRROR drag (Johnny, 2026-11-27 11:12, his acceptance test
       in his own words): drag right turns the view right — the
       world slides left, like turning your head; drag up looks
       up. Not grab-the-world: the room is a mirror, not a camera.
       Measured on this code: a 120 px rightward drag moves a
       station's projection ~280 px LEFT (look.x falls); a 100 px
       upward drag moves it ~80 px DOWN (look.pitch rises).
       Room only — the Universe's flight controls keep their own
       feel. (An interim flip toward content-follows-finger was
       tried against his 07:39 "backwards" report and reverted
       the same morning when he restated the test: the mirror
       signs are these.) */
    lookX -= dx * 0.0035; lookPitch -= dy * 0.0035; clampLook();
    /* looking around is not selecting: a look drag dismisses any
       centred station's pill (Johnny, 2026-11-27 00:21 — the
       Line Rider pill stood on screen while he was just looking) */
    if (centred) { centred = null; hidePill(); }
  }
});
/* the tap zone is the object's OWN projected bounds (Johnny,
   2026-11-27 11:11: "you have to press way to the right to have
   the play game option show up" — the old zone was a fixed-radius
   circle around each station's FOCUS point, and a focus point is
   not the visual: the craft's sits half a metre above the Disc's
   centre and the circle was smaller than the craft, so taps on
   the thing he saw missed and the live spot read as displaced
   from the model). Project the visual's world box to a screen
   rect, widen it 22 px a side (and to at least 44 px across):
   generous, and centred on the visual by construction. */
function projRect(box) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, any = false;
  for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
    const v = new THREE.Vector3(cx, cy, cz).project(camera);
    if (v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); any = true;
  }
  if (!any) return null;
  x0 -= 22; y0 -= 22; x1 += 22; y1 += 22;
  if (x1 - x0 < 44) { const c = (x0 + x1) / 2; x0 = c - 22; x1 = c + 22; }
  if (y1 - y0 < 44) { const c = (y0 + y1) / 2; y0 = c - 22; y1 = c + 22; }
  return { x0, y0, x1, y1 };
}
function inRect(r, x, y) { return !!r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }
/* the tight form of the same idea: project an object's own
   geometry corners (its local bounding boxes carried by its
   world matrix) instead of its world AABB — a tilted slab's AABB
   carries empty corners that would steal a neighbour's pixels
   (the propped iPad's AABB swallowed the Threads tablet's whole
   zone, though the tablet peeks past the iPad's real edge) */
function projPointsRect(pts) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, any = false;
  for (const p of pts) {
    const v = p.clone().project(camera);
    if (v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); any = true;
  }
  if (!any) return null;
  x0 -= 22; y0 -= 22; x1 += 22; y1 += 22;
  if (x1 - x0 < 44) { const c = (x0 + x1) / 2; x0 = c - 22; x1 = c + 22; }
  if (y1 - y0 < 44) { const c = (y0 + y1) / 2; y0 = c - 22; y1 = c + 22; }
  return { x0, y0, x1, y1 };
}
function objCornerPoints(obj, filter) {
  const pts = [];
  obj.updateWorldMatrix(true, true);
  obj.traverse(o => {
    if (!o.isMesh) return;
    if (filter && !filter(o)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
      pts.push(new THREE.Vector3(cx, cy, cz).applyMatrix4(o.matrixWorld));
    }
  });
  return pts;
}
const padTapBox = new THREE.Box3(
  new THREE.Vector3(PAD.x - 1.9, 0, PAD.z - 1.9),
  new THREE.Vector3(PAD.x + 1.9, 0.06, PAD.z + 1.9));
function padCornerPoints() {
  const pts = [];
  for (const cx of [padTapBox.min.x, padTapBox.max.x]) for (const cy of [padTapBox.min.y, padTapBox.max.y]) for (const cz of [padTapBox.min.z, padTapBox.max.z]) {
    pts.push(new THREE.Vector3(cx, cy, cz));
  }
  return pts;
}
/* tap points are measured lazily, on the first tap that needs
   them: at build time a nested group's world matrix can still
   be stale (the Frequency rig's first box came out in its table's
   local coordinates and the zone landed under the floor plan) —
   by the first tap the room has rendered and every matrix is
   true. Starman's points filter its invisible effect planes out,
   the same rule its parked size is reported by */
const starFilter = o => !['ConeGeometry', 'PlaneGeometry', 'Sprite', 'CircleGeometry'].includes(o.geometry.type);
function craftTapRect() {
  if (!craftTapBoxes) {
    craftTapBoxes = {
      disc: objCornerPoints(discWrap),
      starman: objCornerPoints(starWrap, starFilter),
    };
  }
  return projPointsRect(craftTapBoxes[parkedCraft].concat(padCornerPoints()));
}
function stationTapRect(st) {
  if (st.id === 'universe') return craftTapRect();
  if (st.tapObj) return projPointsRect(objCornerPoints(st.tapObj));
  if (st.tapMeshes) {
    let pts = [];
    st.tapMeshes.forEach(m => { pts = pts.concat(objCornerPoints(m)); });
    return projPointsRect(pts);
  }
  return projRect(new THREE.Box3().setFromObject(st.hitMesh));
}
/* one tap target, one verb (Johnny, 2026-11-27 07:43): tapping a
   station's object does exactly what its pill does — the first tap
   centres it and raises the pill; a tap on the already-centred
   object walks over / boards, same as tapping the pill. Tapping
   the craft NEVER swaps it (his taps on the Disc only ever swapped
   when he was trying to fly); the swap is the #gr-swap pill and
   nothing else. The tap still has to land ON the thing: the
   raycast must hit its hitbox AND the point must fall inside the
   visual's own projected rect (see projRect) */
function tapStation(st) {
  if (centred === st) { approach(st); return; }
  centred = st; showPill(st);
}
canvas.addEventListener('pointerup', e => {
  if (!downAt) return;
  const wasTap = dragMoved <= 6 && performance.now() - downAt.t < 600;
  downAt = null;
  if (!wasTap || view.state !== 'room') return;
  const ust = stationById('universe');
  const hits = castAll(e.clientX, e.clientY, [craftHitMesh, ...stations.map(s => s.hitMesh)]);
  for (const h of hits) {
    if (h.object === craftHitMesh) {
      if (inRect(craftTapRect(), e.clientX, e.clientY)) { tapStation(ust); return; }
      continue;
    }
    const st = h.object.userData.station;
    if (st && inRect(stationTapRect(st), e.clientX, e.clientY)) { tapStation(st); return; }
  }
  if (centred) {
    centred = null; hidePill();
  }
});

/* ================= live host integration =================
   games.html owns the page; this module owns the room. The host
   (window.__roomHost, a classic script in games.html) shows/hides
   the overlay and opens the real games; these are its only ways
   in and out. */
/* the module preloads with the page (auto-open), but it does not
   render until the host shows the room: a visitor who cancels the
   auto-open and stays on the games page costs no GPU. showRoom
   activates the room before its fade lands, and the hero texture
   is already loaded by then, so the first frame shown is complete */
let hostActive = false;
/* dead: set by disposeForGame — this module instance has released
   everything and must never render, resize or answer again */
let dead = false;
/* THE HANDOFF RELEASE (Johnny's iPhone, 2026-11-27 00:52): flying
   into the Universe with the room's WebGL context still resident
   put two heavy contexts on the GPU at once; iOS killed the page
   (white flash, reload, back on the grid in the wrong theme).
   Before the Universe initializes, the host calls this: stop the
   loop, dispose every geometry/material/texture, force the
   context lost, and take the canvas out of the page. The room
   the visitor returns to is a FRESH module instance the host
   imports when the game closes — parked state is deterministic,
   so the rebuilt room is Δ=0 by construction */
function disposeForGame() {
  if (dead) return;
  dead = true;
  hostActive = false;
  try {
    scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      mats.forEach(m => {
        for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
        m.dispose();
      });
    });
    if (scene.environment && scene.environment.dispose) scene.environment.dispose();
    renderer.renderLists.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  } catch (e) { /* best-effort: the context loss is the point */ }
  if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
}
function hostReset() {
  flight = null; overlayAnim = null; swapAnim = null;
  setOverlay(0);
  restoreParked();
  setParked('disc');
  view.station = null; centred = null; hidePill();
  lookX = 0; lookPitch = 0; clampLook();
  view.state = 'room'; view.atSeat = true;
  view.pos.copy(seatPos()); view.focus.copy(seatFocus());
  ipadK = 0; tabletK = 0;
  if (ipadRig.group) { ipadRig.group.position.copy(ipadRig.rest.p); ipadRig.group.rotation.copy(ipadRig.rest.e); }
  if (tabletRig.group) tabletRig.group.position.copy(tabletRig.rest);
  camera.fov = 47.9; camera.updateProjectionMatrix();
  camera.position.copy(view.pos); camera.lookAt(view.focus);
}
function resumeAtStation(id) {
  const st = stationById(id); if (!st) return;
  view.station = st; view.atSeat = false;
  view.pos.copy(st.camPos); view.focus.copy(st.camFocus || st.focus);
  view.state = 'station';
  camera.position.copy(view.pos); camera.lookAt(view.focus);
}

/* ================= hooks for the stills harness ================= */
const VIEWS = {
  entry: { pos: HOME.pos, focus: HOME.focus },
  terrace: { pos: new THREE.Vector3(0.6, 2.0, 0.4), focus: new THREE.Vector3(5.9, 1.0, -9.6) },
};
function setParked(craft) {
  parkedCraft = craft;
  discWrap.visible = craft === 'disc';
  starWrap.visible = craft === 'starman';
  discShadow.visible = discWrap.visible;
  starShadow.visible = starWrap.visible;
}
function setView(name) {
  if (name === 'disc' || name === 'starman') {
    setParked(name);
    const st = stationById('universe');
    view.pos.copy(st.camPos); view.focus.copy(st.focus);
    view.station = null; view.state = 'room'; view.atSeat = false;
    camera.position.copy(view.pos); camera.lookAt(view.focus);
    return;
  }
  const v = VIEWS[name] || stationById(name);
  if (!v) return;
  const pos = v.pos || v.camPos;
  const focus = v.pos ? v.focus : (v.camFocus || v.focus);
  view.pos.copy(pos); view.focus.copy(focus);
  view.station = null; view.state = 'room';
  view.atSeat = name === 'entry';
  camera.position.copy(pos); camera.lookAt(focus);
}
window.__room = {
  state: () => ({
    sizes: craftSizes,
    gameOn: view.state === 'open',
    gliding: view.state === 'glide' || view.state === 'back',
    look: { x: lookX, pitch: lookPitch },
    tabletPos: tabletRig.group ? tabletRig.group.position.toArray() : [0, 0, 0],
    ipadPos: ipadRig.group ? ipadRig.group.position.toArray() : [0, 0, 0],
    ipadRot: ipadRig.group ? [ipadRig.group.rotation.x, ipadRig.group.rotation.y, ipadRig.group.rotation.z] : [0, 0, 0],
    craftPos: (parkedCraft === 'disc' ? discWrap : starWrap).position.toArray(),
    kartPos: kartGroup ? kartGroup.position.toArray() : [0, 0, 0],
    flight: flight ? { vehicle: flight.vehicle, t: Math.round(flight.t * 1000) / 1000, dir: flight.dir } : null,
    flightSkipped: lastStartSkipped,
    viewState: view.state,
    station: view.station ? view.station.id : null,
    centred: centred ? centred.id : null,
    craft: parkedCraft,
    swapping: !!swapAnim,
    pos: view.pos.toArray(), focus: view.focus.toArray(),
  }),
  setView,
  centre: id => { const st = stationById(id); if (st) { centred = st; showPill(st); } },
  approach: id => { const st = stationById(id); if (st) approach(st); },
  back: () => exitStation(),
  setHostActive: b => { hostActive = !!b; },
  refit: () => { renderer.setSize(innerWidth, innerHeight); fitFov(); },
  hostReturn: () => exitStation(),
  hostReset: () => hostReset(),
  resumeAtStation: id => resumeAtStation(id),
  disposeForGame: () => disposeForGame(),
  _backTap: () => exitStation(),
  _pillTap: () => { if (centred) approach(centred); },
  _swapTap: () => { if (centred && centred.id === 'universe') swapCraft(); },
  /* the tap zone the pointer handler will use for a station,
     exposed so the gate can tap the visual's own centre and
     prove the zone sits on the model (Johnny, 2026-11-27 11:11) */
  tapAudit: id => {
    const st = stationById(id);
    const r = st.id === 'universe' ? craftTapRect() : stationTapRect(st);
    if (!r) return null;
    return { rect: r, centre: { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 } };
  },
  swap: () => swapCraft(),
  look: (x, p) => { lookX = x; lookPitch = p; clampLook(); },
  /* rotate the current view in place (gate hook: look sweeps at
     station poses, where the seat look does not apply) */
  spin: (dyaw, dpitch) => {
    const dir = view.focus.clone().sub(view.pos);
    const sph = new THREE.Spherical().setFromVector3(dir);
    sph.theta -= dyaw;
    sph.phi = THREE.MathUtils.clamp(sph.phi - dpitch, 0.15, Math.PI - 0.15);
    view.focus.copy(view.pos).add(new THREE.Vector3().setFromSpherical(sph));
    camera.position.copy(view.pos); camera.lookAt(view.focus);
  },
  project: id => {
    const st = stationById(id); if (!st) return null;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const behind = st.focus.clone().sub(camera.position).dot(camDir) < 0;
    const v = st.focus.clone().project(camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, behind };
  },
};
if (params.get('craft') === 'starman') setParked('starman');
if (params.has('view')) setView(params.get('view'));
if (params.has('look')) { lookX = parseFloat(params.get('look')); clampLook(); }
if (params.has('pitch')) { lookPitch = parseFloat(params.get('pitch')); clampLook(); }
if (params.has('centre')) window.__room.centre(params.get('centre'));
if (params.has('flight')) {
  const veh = params.get('flight');
  const ft = parseFloat(params.get('ft') || '0.5');
  if (veh === 'starman') setParked('starman');
  flight = { vehicle: veh, dir: 1, st: stationById(veh === 'kart' ? 'thumbdrive' : 'universe'), t: ft, hold: true };
  view.state = 'flight'; view.atSeat = false;
  applyFlightPose(veh, ft);
}
if (params.has('dyaw') || params.has('dpitch')) {
  const dir = view.focus.clone().sub(view.pos);
  const sph = new THREE.Spherical().setFromVector3(dir);
  sph.theta -= parseFloat(params.get('dyaw') || 0);
  sph.phi = THREE.MathUtils.clamp(sph.phi - parseFloat(params.get('dpitch') || 0), 0.15, Math.PI - 0.15);
  view.focus.copy(view.pos).add(new THREE.Vector3().setFromSpherical(sph));
  camera.position.copy(view.pos); camera.lookAt(view.focus);
}

/* the fireplace's flame: layered tongues with individual sway,
   redrawn at ~11 fps — cheap canvas work, and the motion is what
   separates a fire from a picture of one */
function drawFire(now) {
  if (!fireCtx) return;
  const g = fireCtx;
  g.clearRect(0, 0, 128, 96);
  const bed = g.createRadialGradient(64, 84, 4, 64, 80, 60);
  bed.addColorStop(0, 'rgba(255,190,90,0.95)'); bed.addColorStop(0.4, 'rgba(220,90,25,0.55)');
  bed.addColorStop(1, 'rgba(60,10,0,0)');
  g.fillStyle = bed; g.fillRect(0, 0, 128, 96);
  for (let i = 0; i < 6; i++) {
    const bx = 34 + i * 12 + Math.sin(now / 170 + i * 2.1) * 3;
    const h = 30 + Math.random() * 26 + Math.sin(now / 230 + i) * 6;
    const w = 7 + Math.random() * 5;
    const sway = Math.sin(now / 140 + i * 1.3) * 4;
    const grad = g.createLinearGradient(0, 88, 0, 88 - h);
    grad.addColorStop(0, 'rgba(255,170,60,0.95)');
    grad.addColorStop(0.55, 'rgba(255,110,25,0.75)');
    grad.addColorStop(1, 'rgba(200,50,10,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(bx - w, 88);
    g.quadraticCurveTo(bx - w * 0.5, 88 - h * 0.6, bx + sway, 88 - h);
    g.quadraticCurveTo(bx + w * 0.5, 88 - h * 0.6, bx + w, 88);
    g.closePath(); g.fill();
  }
  const core = g.createRadialGradient(64, 82, 2, 64, 82, 26);
  core.addColorStop(0, 'rgba(255,240,190,0.95)'); core.addColorStop(1, 'rgba(255,200,90,0)');
  g.fillStyle = core; g.fillRect(0, 40, 128, 56);
  fireTexObj.needsUpdate = true;
  if (fireMesh) fireMesh.scale.set(1, 1 + Math.sin(now / 90) * 0.03, 1);
}

/* every solid mesh casts and receives: the sun's soft shadows are
   what ground the furniture, the island dressing and the craft in
   the room. Excluded by construction: basic-material meshes
   (screens, blob shadows, the backdrop and vista layers, hit
   boxes, the fire) and transparent ones (the glass, the oil) */
scene.traverse(o => {
  if (!o.isMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if (mats.every(m => m.isMeshBasicMaterial) || mats.some(m => m.transparent)) return;
  o.castShadow = true; o.receiveShadow = true;
});

/* ================= the living loop ================= */
let prev = performance.now(), fpsCount = 0, fpsTime = 0;
function animate(now) {
  if (dead) return;
  requestAnimationFrame(animate);
  const dt = Math.min(now - prev, 100); prev = now;
  if (!hostActive) return;
  stepGlide(dt);
  stepSwap(dt);
  stepOverlay(dt);
  stepFlight(dt);
  if (view.state !== 'glide' && view.state !== 'back') applyLook();
  else { camera.position.copy(view.pos); camera.lookAt(view.focus); }

  const t = STILL ? 2600 : now;
  drawLineRider(t); drawThreads(t); drawPlate(t);
  if (now - lastFireDraw > 90) { lastFireDraw = now; drawFire(now); }
  for (const p of steamPuffs) {
    const cyc = ((t / 3400) + p.phase) % 1;
    p.sp.position.set(p.x + Math.sin(cyc * 5 + p.phase * 9) * 0.03, p.baseY + cyc * 0.5, p.z);
    const s = p.s0 * (0.7 + cyc * 1.1);
    p.sp.scale.set(s, s, 1);
    p.sp.material.opacity = Math.sin(cyc * Math.PI) * 0.15;
  }
  const flying = flight ? flight.vehicle : null;
  if (discBuilt) {
    /* parked craft REST on the pad — still, grounded, one vehicle
       (Johnny, 2026-11-27 00:21). The only lift a parked craft ever
       makes is the swap's small rise-and-settle */
    const swapLift = swapAnim ? Math.sin(Math.min(swapAnim.t, 1) * Math.PI) * 0.12 : 0;
    if (flying !== 'disc') discWrap.position.y = REST_Y + swapLift;
    if (flying !== 'starman') starWrap.position.y = REST_Y + swapLift;
    if (flying !== 'disc') discShadow.material.opacity = 0.92;
    if (discWrap.visible && flying !== 'disc') discBuilt.update(0.10, Math.min(dt, 50) / 1000, t / 1000);
  }
  if (kartGroup && flying !== 'kart') {
    kartGroup.position.y = KART_REST_Y;
    kartShadowMesh.material.opacity = 0.95;
    /* the kart is a flat cutout: it turns to face you, like a sprite */
    kartGroup.rotation.y = Math.atan2(camera.position.x - kartGroup.position.x, camera.position.z - kartGroup.position.z);
  }
  /* the island iPad's pick-up, progress-tied like the tablet's:
     the settled position is the rest position EXACTLY (Δ=0) */
  if (ipadRig.group) {
    const target = (view.station && view.station.id === 'linerider' && view.state !== 'back') ? 1 : 0;
    ipadK = target === 1 ? Math.min(1, ipadK + dt / 650) : Math.max(0, ipadK - dt / 650);
    const g = ipadRig.group, R = ipadRig.rest, L = ipadRig.lifted;
    if (ipadK === 0) { g.position.copy(R.p); g.rotation.copy(R.e); }
    else if (ipadK === 1) { g.position.copy(L.p); g.rotation.copy(L.e); }
    else {
      const k = ipadK * ipadK * (3 - 2 * ipadK);
      g.position.lerpVectors(R.p, L.p, k);
      g.rotation.set(R.e.x + (L.e.x - R.e.x) * k, R.e.y + (L.e.y - R.e.y) * k, R.e.z + (L.e.z - R.e.z) * k);
    }
  }
  /* the Threads tablet rises to meet you as you arrive, and settles
     back onto its side table when you leave — progress-tied, so the
     settled position is the rest position EXACTLY (Δ=0) */
  if (tabletRig.group) {
    const target = (view.station && view.station.id === 'threads' && view.state !== 'back') ? 1 : 0;
    tabletK = target === 1 ? Math.min(1, tabletK + dt / 700) : Math.max(0, tabletK - dt / 700);
    const g = tabletRig.group;
    if (tabletK === 0) g.position.copy(tabletRig.rest);
    else if (tabletK === 1) g.position.copy(tabletRig.lifted);
    else {
      const k = tabletK * tabletK * (3 - 2 * tabletK);
      g.position.lerpVectors(tabletRig.rest, tabletRig.lifted, k);
    }
  }
  fireGlow.intensity = 3.6 + Math.sin(t / 300) * 0.7 + Math.sin(t / 97) * 0.4;

  /* the room-level back control exists for exactly one state: you
     are AT a station with no game open — the seat you return to
     after coming back from the Threads page. Every other return
     runs on its own (the reverse motion), and every game carries
     its own exit on the page. */
  const wantBack = view.state === 'station';
  if (wantBack !== backBtnShown) {
    backBtnShown = wantBack;
    backBtn.style.display = wantBack ? '' : 'none';
  }

  renderer.render(scene, camera);
  fpsCount++; fpsTime += dt;
  if (fpsTime >= 1000) {
    window.__roomStats.fps = Math.round(fpsCount * 1000 / fpsTime);
    fpsCount = 0; fpsTime = 0;
  }
  window.__roomStats.frames++;
}
addEventListener('resize', () => {
  if (dead) return;
  renderer.setSize(innerWidth, innerHeight);
  fitFov();
});
requestAnimationFrame(animate);
