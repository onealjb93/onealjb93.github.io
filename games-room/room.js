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

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171310);
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
const texLoader = new THREE.TextureLoader();
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
const heroTex = texLoader.load('games-room/assets/hero-room.webp', () => {
  window.__roomStats.loadMs = Math.round(performance.now() - t0);
  window.__roomReady = true;
  /* no title card, no veil (Johnny, 2026-11-26 19:57): the host
     fades the finished room in over the page — this callback is
     what tells it the first complete frame exists */
  if (window.__roomHost && window.__roomHost.roomReady) window.__roomHost.roomReady();
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
    /* vista band: source x 50%..100%, y 8%..63% (peaks → river) */
    g.drawImage(img, W * 0.29, H * 0.08, W * 0.68, H * 0.55, 274, 400, 1500, 330);
    /* feather the crop's top into the sky and its foot into the valley */
    const fT = g.createLinearGradient(0, 392, 0, 485);
    fT.addColorStop(0, 'rgba(216,226,236,0.9)'); fT.addColorStop(1, 'rgba(216,226,236,0)');
    g.fillStyle = fT; g.fillRect(0, 392, 2048, 93);
    const fB = g.createLinearGradient(0, 685, 0, 762);
    fB.addColorStop(0, 'rgba(93,111,116,0)'); fB.addColorStop(1, 'rgba(93,111,116,0.92)');
    g.fillStyle = fB; g.fillRect(0, 685, 2048, 77);
    const side = g.createLinearGradient(0, 0, 2048, 0);
    side.addColorStop(0, 'rgba(190,203,216,0.95)');
    side.addColorStop(0.18, 'rgba(190,203,216,0.25)');
    side.addColorStop(0.30, 'rgba(190,203,216,0)');
    side.addColorStop(0.70, 'rgba(190,203,216,0)');
    side.addColorStop(0.82, 'rgba(190,203,216,0.25)');
    side.addColorStop(1, 'rgba(190,203,216,0.95)');
    g.fillStyle = side; g.fillRect(0, 380, 2048, 380);
    const haze = g.createLinearGradient(0, 430, 0, 780);
    haze.addColorStop(0, 'rgba(216,226,236,0)');
    haze.addColorStop(0.55, 'rgba(205,218,228,0.22)');
    haze.addColorStop(1, 'rgba(190,205,220,0)');
    g.fillStyle = haze; g.fillRect(0, 430, 2048, 350);
    const bot = g.createLinearGradient(0, 715, 0, 1024);
    bot.addColorStop(0, '#5d6f74'); bot.addColorStop(1, '#2e3d42');
    g.fillStyle = bot; g.fillRect(0, 715, 2048, 309);
    const st = new THREE.CanvasTexture(sc);
    st.colorSpace = THREE.SRGBColorSpace;
    st.wrapS = THREE.RepeatWrapping;
    backdropMat.map = st;
    backdropMat.color.set(0xffffff);
    backdropMat.needsUpdate = true;
  }
  /* the painting over the fireplace is the photo's own framed
     picture, lifted from the same image */
  if (paintingMat) {
    const pc = document.createElement('canvas'); pc.width = 256; pc.height = 176;
    pc.getContext('2d').drawImage(img, W * 0.135, H * 0.135, W * 0.105, H * 0.145, 0, 0, 256, 176);
    const pt = new THREE.CanvasTexture(pc);
    pt.colorSpace = THREE.SRGBColorSpace;
    paintingMat.map = pt;
    paintingMat.color.set(0xffffff);
    paintingMat.needsUpdate = true;
  }
});
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
const marbleT = canvasTex((g, S) => {
  g.fillStyle = '#CFC2A8'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2400; i++) {
    g.fillStyle = `rgba(${140 + rnd() * 70 | 0},${128 + rnd() * 55 | 0},${100 + rnd() * 45 | 0},${0.04 + rnd() * 0.06})`;
    g.fillRect(rnd() * S, rnd() * S, 2.2, 2.2);
  }
  /* veins wander in every direction (long horizontal runs read as
     wood planks at counter distance, not stone) */
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(105,96,80,${0.10 + rnd() * 0.16})`;
    g.lineWidth = 0.7 + rnd() * 1.6;
    let x = rnd() * S, y = rnd() * S;
    const ang = rnd() * Math.PI * 2;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += Math.cos(ang + (rnd() - 0.5) * 0.9) * S * 0.22;
      y += Math.sin(ang + (rnd() - 0.5) * 0.9) * S * 0.22;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}, 2, 1);
const marbleMat = new THREE.MeshStandardMaterial({ map: marbleT, roughness: 0.5, envMapIntensity: 0.4 });
const islandWood = new THREE.MeshStandardMaterial({ color: 0x3A2A1C, roughness: 0.85, envMapIntensity: 0.15 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0xA8ADB3, roughness: 0.45, metalness: 0.85, envMapIntensity: 0.35 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0xBFD4D8, transparent: true, opacity: 0.16, roughness: 0.08, metalness: 0.2, envMapIntensity: 0.8, side: THREE.DoubleSide });
const fabricMat = new THREE.MeshStandardMaterial({ color: 0xDCD2BE, roughness: 1, envMapIntensity: 0.1 });
const cushionMat = new THREE.MeshStandardMaterial({ color: 0xEAE3D3, roughness: 1, envMapIntensity: 0.1 });
const stoneSmooth = new THREE.MeshStandardMaterial({ color: 0xC9B797, roughness: 0.75, envMapIntensity: 0.12 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0x8A6D3B, roughness: 0.4, metalness: 0.6, envMapIntensity: 0.4 });
const ceramicMat = new THREE.MeshStandardMaterial({ color: 0xE8E2D4, roughness: 0.5, envMapIntensity: 0.3, side: THREE.DoubleSide });
const pineMat = new THREE.MeshStandardMaterial({ map: woodTex('games-room/assets/wood-pine.jpg', 2, 1), color: 0xC4A888, roughness: 0.8, envMapIntensity: 0.35 });
const weatheredMat = new THREE.MeshStandardMaterial({ map: woodTex('games-room/assets/wood-weathered.jpg', 2, 1), roughness: 0.9, envMapIntensity: 0.35 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.45, metalness: 0.6, envMapIntensity: 0.4 });
const blackGlass = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.25, metalness: 0.3, envMapIntensity: 0.4 });
const plainWood = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9, envMapIntensity: 0.15 });
const plainStone = new THREE.MeshStandardMaterial({ color: 0x3b332a, roughness: 1, envMapIntensity: 0.1 });
const timberMat = new THREE.MeshStandardMaterial({ map: timberT, roughness: 0.95, envMapIntensity: 0.08 });
const ceilMat = new THREE.MeshStandardMaterial({ map: timberT, color: 0xC7AB84, emissive: 0x140B04, roughness: 1, envMapIntensity: 0.1 });
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
const beamMat = new THREE.MeshStandardMaterial({ map: beamTexture(9), color: 0x9A7B58, emissive: 0x1A0F06, roughness: 1, envMapIntensity: 0.08 });
const beamMatEdge = new THREE.MeshStandardMaterial({ map: beamTexture(5), color: 0x9A7B58, emissive: 0x1A0F06, roughness: 1, envMapIntensity: 0.08 });
const stoneWallMat = new THREE.MeshStandardMaterial({ map: stoneWallT, roughness: 1, envMapIntensity: 0.08 });
const parapetMat = new THREE.MeshStandardMaterial({ map: stoneWallT.clone(), roughness: 1, envMapIntensity: 0.08 });
parapetMat.map.repeat.set(10, 0.5); parapetMat.map.needsUpdate = true;
const stoneFloorMat = new THREE.MeshStandardMaterial({ map: stoneFloorT, color: 0x9A8A72, roughness: 0.95, envMapIntensity: 0.1 });
stoneFloorMat.map.repeat.set(8, 4);
const stoneFloorMatB = stoneFloorMat.clone();
stoneFloorMatB.map = stoneFloorT.clone();
stoneFloorMatB.map.repeat.set(5, 8); stoneFloorMatB.map.needsUpdate = true;
const woodFloorMat = new THREE.MeshStandardMaterial({ map: woodTex('games-room/assets/wood-pine.jpg', 5, 5), color: 0x8A7154, roughness: 0.85, envMapIntensity: 0.12 });

function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }

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
    new THREE.MeshStandardMaterial({ color: 0x5D6F74, roughness: 1 }));
  skirt.rotation.x = -Math.PI / 2; skirt.position.set(2, -0.06, -6);
  scene.add(skirt);
}
/* the backdrop: the photo's mountains, 70 m out — scenery, not room */
{
  backdropMat = new THREE.MeshBasicMaterial({ color: 0x39434a, side: THREE.BackSide });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 120, 40, 1, true), backdropMat);
  cyl.position.set(2, 25, -6);
  scene.add(cyl);
}
/* the library wall: stone, with the bookshelves, the fireplace and
   the painting the photo shows — all modeled */
const bookPalette = [0x7A4A2B, 0x39506B, 0x6D2F28, 0x51663A, 0x8A6D3B, 0x54423A, 0x2F4F4F, 0x9A7B4F, 0x703838, 0x445566];
const bookXforms = [];
function shelfUnit(cx) {
  const g = new THREE.Group();
  /* an OPEN frame — back, sides, top — never a solid carcass: the
     books stand on the boards between the uprights, in the open */
  const back = box(1.3, 3.6, 0.03, islandWood); back.position.set(cx, 1.8, -10.96); g.add(back);
  for (const sx of [-0.625, 0.625]) {
    const side = box(0.05, 3.6, 0.32, plainWood); side.position.set(cx + sx, 1.8, -10.82); g.add(side);
  }
  const topB = box(1.3, 0.05, 0.32, plainWood); topB.position.set(cx, 3.58, -10.82); g.add(topB);
  const cab = box(1.2, 0.85, 0.03, islandWood); cab.position.set(cx, 0.55, -10.645); g.add(cab);
  for (const sy of [1.12, 1.74, 2.36, 2.98]) {
    const board = box(1.2, 0.04, 0.28, plainWood); board.position.set(cx, sy, -10.80); g.add(board);
    let x = cx - 0.56;
    while (x < cx + 0.48) {
      if (rnd() < 0.12) { x += 0.05 + rnd() * 0.06; continue; }
      const bw = 0.028 + rnd() * 0.026, bh = 0.23 + rnd() * 0.13;
      bookXforms.push({ x: x + bw / 2, y: sy + 0.02 + bh / 2, z: -10.80, w: bw, h: bh, c: bookPalette[(rnd() * bookPalette.length) | 0] });
      x += bw + 0.004;
    }
  }
  scene.add(g);
}
{
  for (const cx of [-9.5, -5.3, -1.3]) shelfUnit(cx);
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.2),
    new THREE.MeshStandardMaterial({ roughness: 0.85, envMapIntensity: 0.1 }), bookXforms.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  bookXforms.forEach((b, i) => {
    m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, 1));
    books.setMatrixAt(i, m4);
    books.setColorAt(i, col.setHex(b.c));
  });
  scene.add(books);
  /* the wall itself */
  const wall = box(12.6, 5.9, 0.3, stoneWallMat); wall.position.set(-4.1, 2.95, -11.15); scene.add(wall);
  /* the fireplace: stone surround, black firebox, timber mantel,
     a lit fire, and the painting above it */
  for (const px of [-8.4, -6.8]) {
    const pillar = box(0.4, 1.6, 0.3, stoneWallMat); pillar.position.set(px, 0.8, -10.85); scene.add(pillar);
  }
  const lintel = box(2.0, 0.45, 0.3, stoneWallMat); lintel.position.set(-7.6, 1.375, -10.85); scene.add(lintel);
  const breast = box(2.0, 4.3, 0.25, stoneWallMat); breast.position.set(-7.6, 3.75, -10.87); scene.add(breast);
  const fbox = box(1.2, 1.15, 0.1, new THREE.MeshStandardMaterial({ color: 0x0A0806, roughness: 1 }));
  fbox.position.set(-7.6, 0.58, -10.95); scene.add(fbox);
  const mantel = box(2.3, 0.09, 0.45, beamMat); mantel.position.set(-7.6, 1.66, -10.8); scene.add(mantel);
  const hearth = box(2.2, 0.05, 0.7, plainStone); hearth.position.set(-7.6, 0.025, -10.5); scene.add(hearth);
  const fireC = document.createElement('canvas'); fireC.width = 128; fireC.height = 96;
  const fg = fireC.getContext('2d');
  const fgr = fg.createRadialGradient(64, 78, 4, 64, 70, 62);
  fgr.addColorStop(0, 'rgba(255,236,170,1)'); fgr.addColorStop(0.35, 'rgba(255,160,60,0.9)');
  fgr.addColorStop(0.7, 'rgba(200,70,20,0.55)'); fgr.addColorStop(1, 'rgba(60,10,0,0)');
  fg.fillStyle = fgr; fg.fillRect(0, 0, 128, 96);
  const fireTex = new THREE.CanvasTexture(fireC);
  const fire = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.62),
    new THREE.MeshBasicMaterial({ map: fireTex, transparent: true, toneMapped: false }));
  fire.position.set(-7.6, 0.42, -10.88); scene.add(fire);
  const log1 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 8), islandWood);
  log1.rotation.z = Math.PI / 2; log1.rotation.y = 0.4; log1.position.set(-7.6, 0.1, -10.85); scene.add(log1);
  const frame = box(1.15, 0.82, 0.05, goldMat); frame.position.set(-7.6, 2.62, -10.72); scene.add(frame);
  paintingMat = new THREE.MeshStandardMaterial({ color: 0x6B7A86, roughness: 0.6 });
  const painting = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.68), paintingMat);
  painting.position.set(-7.6, 2.62, -10.69); scene.add(painting);
}
/* the folding glass doors to the porch, at the wall's right end */
{
  const dg = new THREE.Group();
  for (const px of [2.8, 4.0]) {
    const leaf = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 3.14), glassMat);
    glass.position.set(px, 1.67, -11); leaf.add(glass);
    const rail = (w, h, x, y) => { const r = box(w, h, 0.07, darkMetal); r.position.set(x, y, -11); leaf.add(r); };
    rail(1.14, 0.08, px, 3.28); rail(1.14, 0.08, px, 0.06);
    rail(0.08, 3.3, px - 0.53, 1.67); rail(0.08, 3.3, px + 0.53, 1.67);
    dg.add(leaf);
  }
  const tGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.9), glassMat);
  tGlass.position.set(3.4, 4.32, -11); dg.add(tGlass);
  const tRail = box(2.38, 0.08, 0.07, darkMetal); tRail.position.set(3.4, 5.3, -11); dg.add(tRail);
  const mRail = box(2.38, 0.08, 0.07, darkMetal); mRail.position.set(3.4, 3.32, -11); dg.add(mRail);
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
  const base = box(5.0, 0.86, 2.18, islandWood); base.position.set(0.9, 0.43, -2.51); isl.add(base);
  for (const px of [-0.95, 0.3, 1.55, 2.8]) {
    const panel = box(1.05, 0.62, 0.03, plainWood); panel.position.set(px, 0.45, -1.405); isl.add(panel);
  }
  const top = box(5.3, 0.06, 2.48, marbleMat); top.position.set(0.9, 0.89, -2.51); isl.add(top);
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
  const vegCols = [0xE8912D, 0x7A9A3D, 0xB03A2E, 0xE8C93B, 0x51663A];
  for (let i = 0; i < 6; i++) {
    const v = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8),
      new THREE.MeshStandardMaterial({ color: vegCols[i % 5], roughness: 0.6 }));
    v.position.set((rnd() - 0.5) * 0.18, 0.05, (rnd() - 0.5) * 0.18); skill.add(v);
  }
  isl.add(skill);
  /* fruit bowl + egg bowl */
  const bowlAt = (bx, bz, r, fruits) => {
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), ceramicMat);
    bowl.position.set(bx, 0.92 + r * 0.55, bz); isl.add(bowl);
    fruits.forEach(([fx, fz, fc, fr], i) => {
      const f = new THREE.Mesh(new THREE.SphereGeometry(fr, 10, 10),
        new THREE.MeshStandardMaterial({ color: fc, roughness: 0.55 }));
      f.position.set(bx + fx, 0.92 + r * 0.62 + (i === 0 ? fr * 0.7 : 0), bz + fz); isl.add(f);
    });
  };
  bowlAt(1.95, -2.8, 0.17, [[-0.07, 0.02, 0xE8912D, 0.052], [0.06, -0.04, 0xB03A2E, 0.05], [0.0, 0.07, 0xE8C93B, 0.048], [0.08, 0.05, 0x7A9A3D, 0.047], [0, 0, 0xE8912D, 0.052]]);
  bowlAt(1.5, -1.9, 0.11, [[-0.04, 0.02, 0xD9A066, 0.033], [0.045, -0.02, 0xEFE6D4, 0.033], [0.0, 0.05, 0xD9A066, 0.033], [0.01, -0.05, 0xEFE6D4, 0.033]]);
  /* bread board */
  const board = box(0.55, 0.025, 0.35, weatheredMat); board.position.set(2.9, 0.933, -2.0); isl.add(board);
  const bread = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xC89B62, roughness: 0.8 }));
  bread.scale.set(1.25, 0.62, 0.85); bread.position.set(2.85, 0.985, -2.0); isl.add(bread);
  /* the black gooseneck faucet + sink, the photo's right foreground */
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.32, 12), darkMetal);
  stem.position.set(2.35, 1.08, -3.4); isl.add(stem);
  const spoutArm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 10), darkMetal);
  spoutArm.rotation.x = Math.PI / 2; spoutArm.position.set(2.35, 1.235, -3.24); isl.add(spoutArm);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10), darkMetal);
  nozzle.position.set(2.35, 1.20, -3.08); isl.add(nozzle);
  const sink = box(0.85, 0.02, 0.52, blackGlass); sink.position.set(2.35, 0.912, -2.62); isl.add(sink);
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
  const chairAt = (x, z, ry) => {
    const ch = new THREE.Group(); ch.position.set(x, 0, z); ch.rotation.y = ry;
    const seat = box(0.45, 0.05, 0.45, plainWood); seat.position.y = 0.46; ch.add(seat);
    const back = box(0.45, 0.55, 0.05, plainWood); back.position.set(0, 0.76, -0.2); ch.add(back);
    for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
      const leg = box(0.04, 0.46, 0.04, plainWood); leg.position.set(lx, 0.23, lz); ch.add(leg);
    }
    dt.add(ch);
  };
  chairAt(-0.6, -0.85, Math.PI); chairAt(0.6, -0.85, Math.PI);
  chairAt(-0.6, 0.85, 0); chairAt(0.6, 0.85, 0);
  dt.add(blobShadow(2.6, 1.6, 0.35));
  scene.add(dt);
}
/* the two cream armchairs in front of the library wall — modeled:
   base, arms, tilted back, loose cushions, in the photo's ivory */
function makeArmchair(cx, ry) {
  const g = new THREE.Group(); g.position.set(cx, 0, -8.83); g.rotation.y = ry;
  const base = box(0.98, 0.32, 0.92, fabricMat); base.position.y = 0.26; g.add(base);
  for (const ax of [-0.39, 0.39]) {
    const arm = box(0.2, 0.3, 0.88, fabricMat); arm.position.set(ax, 0.57, 0); g.add(arm);
  }
  const back = box(0.98, 0.74, 0.2, fabricMat); back.position.set(0, 0.79, -0.37); back.rotation.x = -0.08; g.add(back);
  const seatC = box(0.58, 0.15, 0.62, cushionMat); seatC.position.set(0, 0.5, 0.06); g.add(seatC);
  const backC = box(0.58, 0.48, 0.13, cushionMat); backC.position.set(0, 0.83, -0.25); backC.rotation.x = -0.08; g.add(backC);
  for (const [lx, lz] of [[-0.42, -0.38], [0.42, -0.38], [-0.42, 0.38], [0.42, 0.38]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.1, 8), plainWood);
    leg.position.set(lx, 0.05, lz); g.add(leg);
  }
  g.add(blobShadow(1.35, 1.25, 0.42));
  scene.add(g);
}
makeArmchair(-2.78, 0.15);
makeArmchair(-1.73, -0.10);
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
  const wl = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.9), stoneWallMat);
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

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x4a3b28, 0.95));
const sun = new THREE.DirectionalLight(0xffeecf, 1.2);
sun.position.set(5, 6.5, 3.5);
scene.add(sun);
/* warm downlights over the living area and the porch, matching the
   photo's late-afternoon warmth */
for (const [lx, lz] of [[-2, -6], [5, -7]]) {
  const down = new THREE.PointLight(0xffdfae, 10, 20, 2);
  down.position.set(lx, 4.8, lz);
  scene.add(down);
}
const fireGlow = new THREE.PointLight(0xff9a4d, 5, 9, 2);
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
  const desk = new THREE.Group(); desk.position.set(0.9, 0, -10.45);
  const top = box(1.7, 0.05, 0.8, pineMat); top.position.y = 0.74; desk.add(top);
  for (const [lx, lz] of [[-0.78, -0.33], [0.78, -0.33], [-0.78, 0.33], [0.78, 0.33]]) {
    const leg = box(0.06, 0.74, 0.06, pineMat); leg.position.set(lx, 0.37, lz); desk.add(leg);
  }
  const monitor = new THREE.Group(); monitor.position.set(-0.1, 0.765, -0.14); monitor.rotation.y = 0.38;
  const frame = box(0.94, 0.56, 0.035, darkMetal); frame.position.y = 0.33; monitor.add(frame);
  const scr = screenMesh(0.86, 0.48, idleTex); scr.position.set(0, 0.33, 0.021); monitor.add(scr);
  const neck = box(0.07, 0.16, 0.05, darkMetal); neck.position.y = 0.02; monitor.add(neck);
  desk.add(monitor);
  const kb = box(0.45, 0.018, 0.15, blackGlass); kb.position.set(0.02, 0.775, 0.18); kb.rotation.y = 0.38; desk.add(kb);
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
  table.add(blobShadow(1.9, 1.25));
  scene.add(table);
}

/* Line Rider: an iPad lying on the kitchen island, screen alive.
   Its start is the pick-up: as you approach it lifts off the counter
   and tilts toward you while the camera pushes into its screen. */
const ipadRig = { group: null, rest: null, lifted: null };
let ipadK = 0;
{
  const ipad = new THREE.Group();
  ipad.position.set(0.9, 0.944, -2.3); ipad.rotation.set(-0.06, -0.35, 0);
  const body = box(0.62, 0.022, 0.45, darkMetal); ipad.add(body);
  const scr = screenMesh(0.56, 0.385, lrTex);
  scr.rotation.x = -Math.PI / 2; scr.position.y = 0.013;
  ipad.add(scr);
  scene.add(ipad);
  ipadRig.group = ipad;
  ipadRig.rest = { p: ipad.position.clone(), e: ipad.rotation.clone() };
  ipadRig.lifted = { p: new THREE.Vector3(0.9, 1.07, -2.02), e: new THREE.Euler(-0.55, -0.35, 0) };
  /* a tighter, stronger contact shadow: at glancing angles the
     iPad read as a black plate floating over the counter — the
     shadow is what seats it */
  const sh = blobShadow(1.0, 0.78, 0.66); sh.position.set(0.9, 0.923, -2.3); scene.add(sh);
  registerStation({
    id: 'linerider', name: 'Line Rider',
    focus: new THREE.Vector3(0.9, 0.96, -2.3),
    camPos: new THREE.Vector3(0.85, 1.50, -1.02),
    camFocus: new THREE.Vector3(0.9, 0.99, -2.24),
    pushPos: new THREE.Vector3(0.88, 1.28, -1.50),
    pushFocus: new THREE.Vector3(0.9, 1.03, -2.16),
    hit: [1.0, 0.5, 0.8],
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
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.018, 40),
    [darkMetal, new THREE.MeshBasicMaterial({ map: fgTex, toneMapped: false }), darkMetal]);
  plate.position.set(-0.25, 0.475, 0); table.add(plate);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.10, 12), darkMetal);
  post.position.set(-0.25, 0.415, 0); table.add(post);
  const amp = box(0.30, 0.13, 0.20, blackGlass); amp.position.set(0.30, 0.51, -0.13); amp.rotation.y = -0.25; table.add(amp);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.025, 16),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.3, metalness: 0.7 }));
  knob.position.set(0.22, 0.585, -0.16); table.add(knob);
  table.add(blobShadow(1.5, 0.95));
  scene.add(table);
  registerStation({
    id: 'frequency', name: 'Frequency Generator',
    focus: new THREE.Vector3(-2.85, 0.52, -6.35),
    camPos: new THREE.Vector3(-2.45, 1.30, -4.85),
    hit: [1.5, 0.9, 1.0],
  });
}

/* Threads: a tablet on a small round side table beside the white
   armchair — it lifts to meet you, then settles back, exactly as
   v2's iPad did */
const tabletRig = { rest: null, lifted: null, group: null };
let tabletK = 0;
{
  const side = new THREE.Group(); side.position.set(-0.85, 0, -8.55);
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
  const grp = new THREE.Group(); grp.position.set(-0.85, 0.613, -8.55); grp.rotation.set(0.22, 0.30, 0);
  const body = box(0.52, 0.018, 0.36, darkMetal); grp.add(body);
  const scr = screenMesh(0.47, 0.315, thTex); scr.rotation.x = -Math.PI / 2; scr.position.y = 0.011; grp.add(scr);
  scene.add(grp);
  tabletRig.group = grp; tabletRig.rest = grp.position.clone();
  tabletRig.lifted = grp.position.clone().add(new THREE.Vector3(0, 0.203, 0.20));
  registerStation({
    id: 'threads', name: 'Threads',
    focus: new THREE.Vector3(-0.85, 0.62, -8.55),
    /* the start is a sit-down: the camera settles into the white
       armchair itself, eyes at seated height, looking at the tablet
       on the side table — the doors and terrace behind it, not the
       unphotographed space behind the photo's own camera */
    camPos: new THREE.Vector3(-1.30, 1.22, -8.15),
    camFocus: new THREE.Vector3(-0.85, 0.62, -8.55),
    hit: [0.9, 0.7, 0.8],
  });
}

/* ============ the vehicle pad: Disc ⇄ Starman, and the kart ============ */
const PAD = new THREE.Vector3(4.6, 0, -9.7);
const KART_POS = new THREE.Vector3(7.3, 0, -9.9);
const HOVER = 0.30;
let parkedCraft = 'disc';
let swapAnim = null;
let discShadow, starShadow, discWrap, starWrap, craftHitMesh, discBuilt = null;
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
  discWrap.position.set(PAD.x, HOVER, PAD.z);
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
  starWrap.position.set(PAD.x, HOVER, PAD.z);
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
  starShadow = blobShadow(4.6, 2.6, 0.36); starShadow.position.set(PAD.x, 0.012, PAD.z);
  starShadow.rotation.z = 2.50; starShadow.visible = false; scene.add(starShadow);
  craftHitMesh = box(3.8, 1.7, 3.8, new THREE.MeshBasicMaterial({ visible: false }));
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
  kartGroup.position.set(KART_POS.x, HOVER, KART_POS.z); kartGroup.rotation.y = 0.5;
  const tex = texLoader.load('games-room/assets/kart.webp');
  tex.colorSpace = THREE.SRGBColorSpace;
  kartBill = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.05),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  kartBill.position.y = 0.47; kartBill.rotation.x = -0.10;
  kartGroup.add(kartBill);
  scene.add(kartGroup);
  kartShadowMesh = blobShadow(1.8, 1.05, 0.4);
  kartShadowMesh.position.set(KART_POS.x, 0.012, KART_POS.z); kartShadowMesh.rotation.z = 0.5;
  scene.add(kartShadowMesh);
  registerStation({
    id: 'thumbdrive', name: 'Thumb Drive',
    focus: new THREE.Vector3(KART_POS.x, 0.85, KART_POS.z),
    camPos: new THREE.Vector3(6.4, 1.7, -6.0),
    hit: [1.8, 1.3, 1.0],
  });
}

/* ================= view state ================= */
const HOME = { pos: new THREE.Vector3(0, 1.55, 0), focus: new THREE.Vector3(0.62, 1.34, -8) };
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
let centred = null;
function showPill(st) {
  const name = st.dynamicName ? st.dynamicName() : st.name;
  pill.textContent = name;
  const small = document.createElement('small');
  small.textContent = st.id === 'universe' ? 'tap to walk over · tap the craft to swap' : 'tap to walk over';
  pill.appendChild(small);
  pill.classList.add('on');
}
function hidePill() { pill.classList.remove('on'); }
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
backBtn.addEventListener('click', exitStation);

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
pill.addEventListener('click', () => { if (centred) approach(centred); });
document.getElementById('gr-leave').addEventListener('click', () => {
  if (window.__roomHost && window.__roomHost.leave) window.__roomHost.leave();
});

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
      HOVER + liftK * topY + depK * outY,
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
      HOVER - dip + dartK * dartK * 1.6,
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
  discWrap.position.set(PAD.x, HOVER, PAD.z); discWrap.rotation.set(0, 0, 0);
  starWrap.position.set(PAD.x, HOVER, PAD.z); starWrap.rotation.set(0, 2.50, 0);
  kartGroup.position.set(KART_POS.x, HOVER, KART_POS.z);
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
    lookX -= dx * 0.0035; lookPitch -= dy * 0.0035; clampLook();
  }
});
canvas.addEventListener('pointerup', e => {
  if (!downAt) return;
  const wasTap = dragMoved <= 6 && performance.now() - downAt.t < 600;
  downAt = null;
  if (!wasTap || view.state !== 'room') return;
  /* a tap on the parked craft swaps Disc ⇄ Starman in place */
  if (castAt(e.clientX, e.clientY, [craftHitMesh])) { swapCraft(); return; }
  const obj = castAt(e.clientX, e.clientY, stations.map(s => s.hitMesh));
  if (obj) {
    centred = obj.userData.station;
    showPill(centred);
  } else if (centred) {
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

/* ================= the living loop ================= */
let prev = performance.now(), fpsCount = 0, fpsTime = 0;
function animate(now) {
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
  const flying = flight ? flight.vehicle : null;
  if (discBuilt) {
    const bobD = Math.sin(t / 1400) * 0.055;
    if (flying !== 'disc') discWrap.position.y = HOVER + bobD - craftDip('disc');
    if (flying !== 'starman') starWrap.position.y = HOVER + Math.sin(t / 1400 + 0.7) * 0.04 - craftDip('starman');
    if (flying !== 'disc') discShadow.material.opacity = 0.92 - bobD * 1.6;
    if (discWrap.visible && flying !== 'disc') discBuilt.update(0.10, Math.min(dt, 50) / 1000, t / 1000);
  }
  if (kartGroup && flying !== 'kart') {
    kartGroup.position.y = HOVER + Math.sin(t / 1500 + 1.3) * 0.03;
    kartShadowMesh.material.opacity = 0.95 - Math.sin(t / 1500 + 1.3) * 0.10;
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
  fireGlow.intensity = 5 + Math.sin(t / 300) * 0.9 + Math.sin(t / 97) * 0.5;

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
  renderer.setSize(innerWidth, innerHeight);
  fitFov();
});
requestAnimationFrame(animate);
