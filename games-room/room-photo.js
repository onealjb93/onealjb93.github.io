/* The Games Room — THE PHOTOGRAPH IS THE ROOM (photo build,
   2026-11-27, on Johnny's ruling after five modelled rounds:
   "not even close. It has to be identical."). The modelled room
   (rounds 1-5) is superseded as the identity vehicle: the room's
   surface is Johnny's mountain-home photograph itself — the
   Health committee hero — rendered on geometry displaced by a
   depth map derived from the photo (Depth Anything V2 Small)
   and anchored to the room layout measured across the rounds
   (seat, island plane, wall plane, floor plane, terrace,
   vista). From the seat the frame IS the photo, pixel for
   pixel; mirror look-drag turns the head in place and the
   depth gives true parallax — the near island slides against
   the far valley. The visitor is seated: a photo only knows
   the world from where it was taken, and that limit is
   accepted on the record. The games stay real 3D objects IN
   the photographic room — the Disc and kart on the terrace,
   Line Rider's iPad on the island, the Frequency Generator
   on the coffee table, Threads by the white armchair — at
   their photo-true places, occluded by and occluding the
   photo surface by depth. All interaction semantics are the
   room's own: tap centres, tap never swaps, #gr-swap is the
   only Disc<->Starman swap, Leave returns to the referrer,
   every return is delta-0. Stations hand over to the real
   games through window.__roomHost (below). */
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
/* ROUND 5 — the FOV is the PHOTO's, derived from the photo
   itself: on the hero image the painting's centre and the
   firebox's centre stand 0.29 of the frame height apart; in the
   room those two points subtend 11.2° from the entry seat, so
   the photo's vertical FOV is ~39-40°, not the 47.9° the room
   opened with. At 47.9° everything stood ~20% too small — the
   fireplace wall read miniature and the island's top thinned
   to a band over a looming face. One vertical FOV for every
   shape: landscape sees the room wide; portrait takes a
   narrower slice of the same space. */
const ROOM_FOV = 40.5;
const camera = new THREE.PerspectiveCamera(ROOM_FOV, innerWidth / innerHeight, 0.05, 220);
function fitFov() {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = ROOM_FOV;
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
/* round 3: there are no middle vista layer materials any more —
   the backdrop canvas (below) carries the whole vista as ONE
   deep painting; only the near treeline layer remains (built
   with the vista stack further down) */
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
    /* 2048 wide for panorama sharpness. The vista is drawn ONCE,
       centred (the cylinder's wrap seam sits behind the house,
       out of view) — a mirrored second pass ghosted the ridges
       into a smear. Soft haze fills the sides. */
    const sc = document.createElement('canvas'); sc.width = 4096; sc.height = 1024;
    const g = sc.getContext('2d');
    const skyGrad = g.createLinearGradient(0, 0, 0, 760);
    skyGrad.addColorStop(0, '#A9C2D8'); skyGrad.addColorStop(0.55, '#D8E2EC');
    skyGrad.addColorStop(1, '#C9D6DE');
    g.fillStyle = skyGrad; g.fillRect(0, 0, 4096, 1024);
    /* the sky wash comes only from the photo's pure-sky rows
       over the peaks — the full-width top strip used before
       carried the porch's roller housing and column tops,
       stretched across the whole sky */
    /* ROUND 4: the stretched sky strip is gone — it read as a
       pale sheet across the opening's top. The sky is the
       gradient alone, in the photo's own morning colours, and
       the painting's peaks feather into it below. */
    /* ROUND 3 — ONE deep vista painting. Rounds 1-2 stacked the
       vista as separate strips at 38/49/56 m (far ridge, mist,
       river + forest, each graded and feathered apart); at the
       seams the stack read as exactly what it was — pale bands
       laid over each other, worst of all the grey band hanging
       behind the terrace pines where a strip's feathered foot
       met the backdrop's haze. The whole vista is now drawn as
       a SINGLE image — the photo's own valley, peaks to river
       to forest in one draw, graded as one piece — so no seam,
       band or layer edge exists to be read. The strips and the
       mist veils between them are gone; the depth trade is
       accepted (Johnny, round 3): the vista's depth-feel over
       strip parallax. What still moves with true parallax is
       the near world — the terrace pines, the treeline at 27 m,
       the hillside cones — in front of the painting.
       The painting is sized to the arc it should occupy (~155°
       of the cylinder) at the photo's own aspect, and placed
       on the 48 m cylinder so it spans world y ~20 down to the
       valley floor: peaks just under the roofline sightline,
       the river in the opening's lower middle. (The first
       round-3 composition stretched it across 83% of the
       circumference on the old 120 m cylinder — the visible
       slice was a ~170-row sliver of canvas, smeared into
       vertical streaks; the tighter arc + shorter cylinder is
       the fix.) */
    /* the source window is tightened to the vista itself:
       x stops before the porch column (0.865W), y starts below
       the opening's roller housing (0.09H) — an earlier window
       (0.335..0.90W, from 0.02H) carried the photo's porch
       architecture into the painting's top and right edge,
       where it read as a building floating in the valley */
    /* placement calibrated with a numbered-band probe (photo14
       gate): the entry seat's axis lands at canvas x ~1030 and
       the door opening frames canvas ~830..990 — the painting
       is centred at 910 so the opening holds the source's
       heart (central peaks, the tall pine, the river's bend),
       and its 880 px span still covers the terrace view's
       wider window (~520..1010) */
    /* ROUND 4 — THE IDENTITY MAP. A numbered-band probe
       (photo15 gate) measured what the seats actually see of
       this canvas: from the entry, columns ~890..1210 of the
       old 2048 canvas and rows ~225..730 — the round-3 painting
       (880 px over a 155° arc) showed only its central ~115
       source px through the opening, magnified and streaked,
       and the canvas's own anisotropy (2048 px around 360°
       against 1024 rows over the cylinder's height) stretched
       every feature ~4.6x wider than tall. THE SMEAR WAS THE
       MAP, not the photo. Now: a 4096-wide canvas on a 90 m
       cylinder, and the painting drawn at the scale the seats
       see — the photo's whole vista window (peaks, the river's
       full S-bend, the forest) inside canvas x 1605..2455,
       y 345..725, with a deliberate 0.81 vertical squeeze so
       the river lands at ~60% of the opening's height, where
       the photo keeps it, instead of below the parapet
       sightline where round 3 lost it. */
    /* ROUND 5 — THE RECOMPOSITION. The bands5 probe measured
       the windows the NEW entry seat actually frames: through
       the opening, canvas columns ~1650..1985 and rows
       ~410..590; the terrace view spans columns ~1250..2050,
       rows ~380..640. On the round-4 map (850x380 at 1605,345)
       the entry window caught only source x 582..876 — the
       left peaks and the upper valley — and the river (source
       x 855..1095) fell outside the jamb: that, in one line,
       is why the river never read. The painting is now
       composed TO the measured window: the vista's heart
       (source 700,60 -> 1130,350: the golden peaks and the
       river's full S-bend) maps onto the entry window
       (1655,415 -> 1980,585). Mirrored extensions carry the
       valley across the terrace's wider window — the round-4
       terrace frame washed to blank sky over the parapet
       where the painting simply ran out. */
    const PX = 1538, PY = 397, PW = 556, PH = 234;
    g.drawImage(img, W * 0.4258, H * 0.0586, W * 0.5742, H * 0.7813, PX, PY, PW, PH);
    /* the mirrored extensions: the same draw, flipped, on
       both sides — sky and forest mirror gently, and the side
       haze (below) sits over the joins */
    g.save();
    g.translate(PX, 0); g.scale(-1, 1);
    g.drawImage(img, W * 0.4258, H * 0.0586, W * 0.5742, H * 0.7813, 0, PY, PW, PH);
    g.restore();
    g.save();
    g.translate(PX + PW, 0); g.scale(-1, 1);
    g.drawImage(img, W * 0.4258, H * 0.0586, W * 0.5742, H * 0.7813, -PW, PY, PW, PH);
    g.restore();
    const patch = (sx, sy, sw, sh, dx, dy, dw, dh) => {
      const pc = document.createElement('canvas'); pc.width = dw; pc.height = dh;
      const pg = pc.getContext('2d');
      pg.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
      pg.globalCompositeOperation = 'destination-in';
      const m = pg.createRadialGradient(dw / 2, dh / 2, Math.min(dw, dh) * 0.22,
        dw / 2, dh / 2, Math.max(dw, dh) * 0.60);
      m.addColorStop(0, 'rgba(255,255,255,1)');
      m.addColorStop(1, 'rgba(255,255,255,0)');
      pg.fillStyle = m; pg.fillRect(0, 0, dw, dh);
      g.drawImage(pc, dx, dy);
    };
    /* the river, boosted: the same pixels drawn a second time
       over their mapped rect (canvas 1765..1961 x 517..587),
       saturated and tipped toward the photo's turquoise,
       feathered so no edge shows. The photo's river is the
       valley's signature colour; at the painting's scale it
       sat at the edge of reading, and a plain re-draw at full
       strength is the honest lift — no invented channel, the
       S-bend is the photo's own. */
    {
      const rc = document.createElement('canvas'); rc.width = 196; rc.height = 70;
      const rg = rc.getContext('2d');
      try { rg.filter = 'saturate(1.55) contrast(1.07)'; } catch (e) { /* older WebKit: unfiltered pass */ }
      rg.drawImage(img, W * 0.66, H * 0.459, W * 0.203, H * 0.234, 0, 0, 196, 70);
      rg.filter = 'none';
      rg.globalCompositeOperation = 'destination-in';
      const rm = rg.createRadialGradient(98, 35, 18, 98, 35, 105);
      rm.addColorStop(0, 'rgba(255,255,255,1)'); rm.addColorStop(1, 'rgba(255,255,255,0)');
      rg.fillStyle = rm; rg.fillRect(0, 0, 196, 70);
      g.drawImage(rc, 1765, 517);
      g.save();
      g.globalCompositeOperation = 'overlay';
      g.globalAlpha = 0.16; g.fillStyle = '#2FA8A0';
      g.fillRect(1772, 524, 182, 56);
      g.restore();
    }
    /* the figure on the terrace (the photo's foreground, not
       the valley's) stands in the new map at canvas
       ~1890..1995 x 476..567, across the river's right bend —
       the photo's own pine slope covers the figure, exactly
       where the photo itself lets the figure occlude the river */
    patch(W * 0.60, H * 0.50, W * 0.12, H * 0.30, 1898, 470, 118, 98);
    /* the painting's foot (rows 560..631) is the source's
       terrace floor and island — the photo's foreground, none
       of it valley. A feathered band of the photo's forested
       slope (source 666,230 -> 922,358: forest and the river's
       left bank) lays the valley floor across the foot; the
       river keeps rows 517..560, its visible reach from the
       seat, and the dining set the band would have shown is
       the part the real dining set occludes from the seat */
    {
      const bc = document.createElement('canvas'); bc.width = PW; bc.height = 71;
      const bg2 = bc.getContext('2d');
      bg2.drawImage(img, W * 0.52, H * 0.45, W * 0.20, H * 0.25, 0, 0, PW, 71);
      bg2.globalCompositeOperation = 'destination-in';
      const bm = bg2.createLinearGradient(0, 0, 0, 71);
      bm.addColorStop(0, 'rgba(255,255,255,0)'); bm.addColorStop(0.45, 'rgba(255,255,255,1)');
      bm.addColorStop(1, 'rgba(255,255,255,1)');
      bg2.fillStyle = bm; bg2.fillRect(0, 0, PW, 71);
      g.drawImage(bc, PX, 560);
    }
    /* a whisper of the photo's gold over the peaks band */
    {
      const pg2 = g.createLinearGradient(0, 400, 0, 505);
      pg2.addColorStop(0, 'rgba(255,170,80,0)');
      pg2.addColorStop(0.5, 'rgba(255,170,80,0.10)');
      pg2.addColorStop(1, 'rgba(255,170,80,0)');
      g.save(); g.globalCompositeOperation = 'overlay';
      g.fillStyle = pg2; g.fillRect(1540, 400, 560, 105);
      g.restore();
    }
    /* feather the peaks' top into the sky */
    const fT = g.createLinearGradient(0, 382, 0, 452);
    fT.addColorStop(0, 'rgba(216,226,236,0.55)'); fT.addColorStop(1, 'rgba(216,226,236,0)');
    g.fillStyle = fT; g.fillRect(1538, 382, 556, 70);
    /* under the painting, the valley floor continues: the
       source's own river-and-forest band, stretched wide and
       darkened by the gradient below — what a lower sightline
       (terrace, look-down) meets under the parapet */
    /* round 5: the floor band rises and widens to meet the
       recomposed painting (foot at row 631) across the whole
       terrace window — under the parapet sightline a lower
       look meets forest, never the void the round-4 terrace
       frame washed into */
    g.drawImage(img, W * 0.68, H * 0.60, W * 0.30, H * 0.22, 1150, 615, 1800, 360);
    /* the valley floor: the painting's own forest darkens and
       deepens downward — NO pale foot-haze anywhere (that haze
       was the grey band). The river's lower bend fades into
       the forest as it does in the photo. */
    const ext = g.createLinearGradient(0, 640, 0, 1024);
    ext.addColorStop(0, 'rgba(43,58,46,0)');
    ext.addColorStop(0.35, 'rgba(43,58,46,0.5)');
    ext.addColorStop(0.65, 'rgba(38,54,43,0.88)');
    ext.addColorStop(1, 'rgba(29,42,35,1)');
    g.fillStyle = ext; g.fillRect(0, 640, 4096, 384);
    /* side haze, kept off the painting: full strength only
       above and below it, a whisper across its edges */
    /* side haze keyed to the ROUND-5 span (painting +
       extensions, canvas 982..2650 = fractions 0.240..0.647):
       full haze outside it, a feather across its edges, clear
       over the valley itself; the across-band whisper drops
       0.32 -> 0.22 — the recomposed painting is smaller on the
       canvas and the wash cost more than it hid */
    const sideGrad = peak => {
      const s = g.createLinearGradient(0, 0, 4096, 0);
      s.addColorStop(0, `rgba(190,203,216,${peak})`);
      s.addColorStop(0.20, `rgba(190,203,216,${peak})`);
      s.addColorStop(0.235, `rgba(190,203,216,${peak * 0.25})`);
      s.addColorStop(0.27, 'rgba(190,203,216,0)');
      s.addColorStop(0.615, 'rgba(190,203,216,0)');
      s.addColorStop(0.65, `rgba(190,203,216,${peak * 0.25})`);
      s.addColorStop(0.685, `rgba(190,203,216,${peak})`);
      s.addColorStop(1, `rgba(190,203,216,${peak})`);
      return s;
    };
    g.fillStyle = sideGrad(0.95); g.fillRect(0, 0, 4096, 360);
    g.fillStyle = sideGrad(0.95); g.fillRect(0, 760, 4096, 264);
    g.fillStyle = sideGrad(0.22); g.fillRect(0, 360, 4096, 400);
    if (params.has('bands2')) {
      /* PROBE (temporary, round 4 calibration): numbered bands over
         the finished painting — read which canvas columns/rows the
         opening frames from each seat, then compose to that map */
      for (let x = 0; x < 2048; x += 128) {
        g.fillStyle = (x / 128) % 2 ? 'rgba(255,0,80,0.42)' : 'rgba(0,160,255,0.42)';
        g.fillRect(x, 0, 128, 1024);
      }
      for (let y = 0; y < 1024; y += 64) {
        g.fillStyle = (y / 64) % 2 ? 'rgba(255,255,0,0.22)' : 'rgba(0,255,120,0.22)';
        g.fillRect(0, y, 2048, 64);
      }
      g.fillStyle = '#ffffff'; g.font = 'bold 46px sans-serif';
      for (let x = 0; x < 2048; x += 128) for (let y = 70; y < 1024; y += 128) g.fillText(String(x / 128), x + 10, y);
      g.font = 'bold 30px sans-serif'; g.fillStyle = '#ffff00';
      for (let y = 0; y < 1024; y += 64) for (let x = 256; x < 2048; x += 512) g.fillText('r' + (y / 64), x + 66, y + 36);
    }
    const st = new THREE.CanvasTexture(sc);
    st.colorSpace = THREE.SRGBColorSpace;
    st.wrapS = THREE.RepeatWrapping;
    /* full anisotropy: at the opening's edges the cylinder is
       seen at a grazing angle, and without this the GPU's mip
       choice smears the painting horizontally — half the
       round-3 streak was this flag's absence */
    st.anisotropy = renderer.capabilities.getMaxAnisotropy();
    backdropMat.map = st;
    /* round 5: the blow-out eases (1.08 -> 1.03) — at the old
       lift the recomposed peaks washed toward the pale read
       Johnny called out; the photo's light is bright, but its
       peaks keep their gold and their shadow side */
    backdropMat.color.setRGB(1.03, 1.02, 1.01);
    backdropMat.needsUpdate = true;
  }
  /* round 3: the round-2 middle vista strips (vista-far /
     vista-mid, loaded here in round 2) are GONE — the backdrop
     canvas above carries the whole vista as one painting. The
     assets-v4 strip files are simply no longer loaded. */
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
    /* round 4: re-measured on the native wall band — the inner
       canvas is (0.139, 0.191) -> (0.234, 0.371) */
    pc.getContext('2d').drawImage(img, W * 0.139, H * 0.191, W * 0.095, H * 0.180, 0, 0, 512, 336);
    const pt = new THREE.CanvasTexture(pc);
    pt.colorSpace = THREE.SRGBColorSpace;
    paintingMat.map = pt;
    paintingMat.color.set(0xffffff);
    paintingMat.needsUpdate = true;
  }
}, undefined, () => { heroDone = true; maybeReady(); });
heroTex.colorSpace = THREE.SRGBColorSpace;
heroTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

/* ================= THE PHOTO IS THE ROOM =================
   The photograph (extended with mirrored periphery bands —
   see REPORT-PHOTO.md; the centre is the untouched photo) is
   textured onto a grid whose every vertex sits on its own
   photo ray at the anchored depth for that pixel. Built once,
   when the photo and its depth have both arrived; both ride
   the room's loading manager, so the veil covers the build. */
const PHOTO_META = {
  extW: 1792, extH: 832, gridW: 449, gridH: 209, step: 4,
  tanHe: 1.2912181698843945, tanVe: 0.599494150303469,
  seat: [0.55, 1.6, 0.0],
  xax: [0.9999861498722319, -0.0, 0.005263084999327529],
  yax: [0.00037026118896976484, 0.9975223270893656, -0.07034962590425542],
  fwd: [0.005250044796198329, -0.0703506002690577, -0.9975085112776839],
  dMin: 0.9, dMax: 190.0,
};
let photoMesh = null, photoExtTex = null, photoDepthImg = null;
texLoader.load('games-room/assets-v8/photo-ext.webp', t => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  photoExtTex = t; buildPhotoSurface();
});
texLoader.load('games-room/assets-v8/photo-depth.png', t => {
  photoDepthImg = t.image; buildPhotoSurface();
});
function buildPhotoSurface() {
  if (photoMesh || !photoExtTex || !photoDepthImg) return;
  const M = PHOTO_META, GW = M.gridW, GH = M.gridH;
  const cv = document.createElement('canvas');
  cv.width = photoDepthImg.width; cv.height = photoDepthImg.height;
  const g2 = cv.getContext('2d');
  g2.drawImage(photoDepthImg, 0, 0);
  const data = g2.getImageData(0, 0, cv.width, cv.height).data;
  const seat = new THREE.Vector3(...M.seat);
  const xa = new THREE.Vector3(...M.xax), ya = new THREE.Vector3(...M.yax), fw = new THREE.Vector3(...M.fwd);
  const pos = new Float32Array(GW * GH * 3);
  const uv = new Float32Array(GW * GH * 2);
  const idx = [];
  const dir = new THREE.Vector3();
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i;
    const ex = i * M.step, ey = j * M.step;
    const nx = (ex / M.extW) * 2 - 1;
    const ny = 1 - (ey / M.extH) * 2;
    const q16 = (data[k * 4] << 8) | data[k * 4 + 1];
    const q = q16 / 65535;
    const inv = q * (1 / M.dMin - 1 / M.dMax) + 1 / M.dMax;
    const d = 1 / inv;
    dir.set(0, 0, 0).addScaledVector(xa, nx * M.tanHe)
      .addScaledVector(ya, ny * M.tanVe).addScaledVector(fw, 1).normalize();
    pos[k * 3] = seat.x + dir.x * d;
    pos[k * 3 + 1] = seat.y + dir.y * d;
    pos[k * 3 + 2] = seat.z + dir.z * d;
    uv[k * 2] = ex / M.extW;
    uv[k * 2 + 1] = 1 - ey / M.extH;
    if (i < GW - 1 && j < GH - 1) {
      const a = k, b = k + 1, c = k + GW, dd = k + GW + 1;
      idx.push(a, c, b, b, c, dd);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    map: photoExtTex, toneMapped: false, fog: false, side: THREE.DoubleSide,
  });
  photoMesh = new THREE.Mesh(geo, mat);
  photoMesh.frustumCulled = false;
  photoMesh.renderOrder = -1;
  scene.add(photoMesh);
  window.__roomStats.photoMesh = { verts: GW * GH, tris: idx.length / 3 };
}

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
/* round 4 (identity pass): assets-v6 — textures composed offline
   from the hero photo itself (make_tex_r4.py): the wall's breast
   stone, the island's own stone fields, the terrace's low walls
   and slabs, the column shaft. The v3 sheets they replace
   (ashlar, trav, rustic) were CG stock — the tile read, the pale
   slab and the brick parapet all traced back to them */
function tex6(file, rx, ry, srgb = true) {
  const t = texLoader.load('games-room/assets-v6/' + file);
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
/* a roughness map derived from any canvas: the stone's bright,
   smooth fields polish down toward 0.30, its dark veins stay
   rough up to 0.62 — the range the island's sheen needs */
function roughFromCanvas(src) {
  const S = src.width, H = src.height;
  const data = src.getContext('2d').getImageData(0, 0, S, H).data;
  const out = document.createElement('canvas'); out.width = S; out.height = H;
  const og = out.getContext('2d');
  const img = og.createImageData(S, H);
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 0.35 + data[i + 1] * 0.5 + data[i + 2] * 0.15) / 255;
    const r = Math.round((0.62 - lum * 0.32) * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = r; img.data[i + 3] = 255;
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
/* the island top (round 3): ONE slab of the photo's own stone —
   trav-top.webp, the travertine grain multiplied by the photo
   island's own blurred light pattern and warm-graded offline —
   laid at repeat (1,1), so nothing tiles on the top. Its normal
   and roughness maps are derived from that same image when it
   lands, so the light response comes from the stone itself; the
   clearcoat sheen lets the sun rake across it as in the photo.
   (Rounds 1-2 tiled trav.jpg at (2,1): the fine grain vanished
   at entry distance and the top read as flat pale cream.) */
const marbleMat = new THREE.MeshPhysicalMaterial({
  roughness: 1, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.6,
});
/* round 4: the photo's island is a honed, warm-mottled stone —
   a lighter hand with the tint and the clearcoat, and the
   stone itself is now the photo's own fields (assets-v6/
   island-top2.webp), not a stock travertine multiplied by its
   light. The normal/roughness still derive from the image */
marbleMat.color.setRGB(0.99, 0.95, 0.87);
/* round 5: assets-v7/island-top3.webp — round 4's top was
   blended from three tiny bright fields (90x34 px the
   largest) and read as washed cream at every range. The new
   sheet is composed from the photo's two largest in-focus
   stone fields at a stronger grade (see make_tex_r5.py) */
texLoader.load('games-room/assets-v7/island-top3.webp', t => {
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  marbleMat.map = t;
  const c = document.createElement('canvas');
  c.width = t.image.width; c.height = t.image.height;
  c.getContext('2d').drawImage(t.image, 0, 0);
  marbleMat.normalMap = normalFromCanvas(c, 1.15);
  marbleMat.roughnessMap = roughFromCanvas(c);
  marbleMat.needsUpdate = true;
});
const islandWood = new THREE.MeshStandardMaterial({
  map: photoTex('walnut.jpg', 2, 1), normalMap: photoTex('walnut-n.jpg', 2, 1, false),
  roughness: 0.72, envMapIntensity: 0.35,
});
/* round 5: brushed, not chrome — at 1.1 env the pot and
   kettle blew out mirror-bright against the photo's satin steel */
const steelMat = new THREE.MeshStandardMaterial({ color: 0xC9CCCE, roughness: 0.42, metalness: 1.0, envMapIntensity: 0.75 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xDCE9EA, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0, envMapIntensity: 1.4, side: THREE.DoubleSide });
/* round 5: the photo's linen is warm ivory, a full step
   darker than the near-white the chairs shipped with — at
   0xFBF6EA the cushions read as flat pale blocks */
const fabricMat = new THREE.MeshStandardMaterial({
  map: photoTex('fabric.jpg', 1, 1), normalMap: photoTex('fabric-n.jpg', 1, 1, false),
  color: 0xE7DCC4, roughness: 1, envMapIntensity: 0.25,
});
const cushionMat = new THREE.MeshStandardMaterial({
  map: photoTex('fabric.jpg', 1, 1), normalMap: photoTex('fabric-n.jpg', 1, 1, false),
  color: 0xEFE6D2, roughness: 1, envMapIntensity: 0.25,
});
/* the columns wear the photo's own column stone (round 4):
   the shaft crop with its baked shading flattened out, so the
   room's sun does the shading — the old sheet was stock trav */
const stoneSmooth = new THREE.MeshStandardMaterial({
  map: tex6('column.webp', 2, 2), normalMap: tex6('column-n.webp', 2, 2, false),
  color: 0xE4D8C2, roughness: 0.62, envMapIntensity: 0.4,
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
  color: 0x9A8268, roughness: 0.85, envMapIntensity: 0.2,
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
  map: tex6('wall-stone.webp', 3, 2), normalMap: tex6('wall-stone-n.webp', 3, 2, false),
  roughness: 0.85, envMapIntensity: 0.35,
});
stoneWallMat.normalScale = new THREE.Vector2(0.55, 0.55);
/* the fireplace pieces carry the same stone at the same block
   scale — a shared repeat would shrink the blocks to tiles on
   the narrow pillars and breast */
const stoneFireMat = new THREE.MeshStandardMaterial({
  map: tex6('wall-stone.webp', 1.2, 1.4), normalMap: tex6('wall-stone-n.webp', 1.2, 1.4, false),
  roughness: 0.85, envMapIntensity: 0.35,
});
/* round 5: a cool step on the fireplace pieces — under the
   fire's light the shared warm grade read as timber, not
   limestone */
stoneFireMat.color.setRGB(0.93, 0.91, 0.89);
stoneFireMat.normalScale = new THREE.Vector2(0.55, 0.55);
/* the parapets are rusticated stone, heavier and rougher */
/* round 5: repeat (8,0.7) -> (5,0.6) — at eight across, the
   sheet's vertical features printed as streaks down the
   parapet's face; larger blocks streak less */
const parapetMat = new THREE.MeshStandardMaterial({
  map: tex6('parapet2.webp', 5, 0.6), normalMap: tex6('parapet2-n.webp', 5, 0.6, false),
  roughness: 1, envMapIntensity: 0.2,
});
/* the terrace floor is the photo's own flagstones, cropped from
   its sunlit corner — warm grey-beige with real joints */
/* round 5: the repeat halves (6,2) -> (3,1) — at six across,
   the sheet's joints drew a busy geometric grid over the
   terrace; the photo's floor is broad slabs, and the larger
   tile is the closer read */
const stoneFloorMat = new THREE.MeshStandardMaterial({
  map: tex6('terrace2.webp', 3, 1), normalMap: tex6('terrace2-n.webp', 3, 1, false),
  roughness: 0.95, envMapIntensity: 0.35,
});
const stoneFloorMatB = new THREE.MeshStandardMaterial({
  map: tex6('terrace2.webp', 4, 4), normalMap: tex6('terrace2-n.webp', 4, 4, false),
  roughness: 0.95, envMapIntensity: 0.35,
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

/* (the modelled room geometry of rounds 1-5 stood here; in this
   build the photograph above replaces every one of its surfaces) */
/* fill kept LOW so the sun's direction reads: the first build's
   even fill washed every shadow out (parent review, 2026-11-27
   00:42 — "warmer but still even, no raking sun"). The IBL and
   the two warm points carry the ambience; this is just a lift */
/* round 2: the hemisphere lift drops a touch (0.6 → 0.52) and the
   island marble's env reflection with it — the bright photo IBL
   was washing the sun's modelling out of the stone and counter,
   the flat read that survived round 1 */
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x4a3b28, 0.46));
/* the sun: warm late-day light raking IN from the terrace side —
   through the folded-open doors, across the island and the floor,
   the photo's own light. One shadow-casting light fitted to the
   room (2048 map, soft kernel): the frame-budget choice that
   buys every contact shadow in the room */
const sun = new THREE.DirectionalLight(0xFFDFAE, 3.85);
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
/* round 5: 5.2 blew the surround out to a glowing band over
   a dark box — the photo's surround is pale stone, warm only
   near the fire. Down to 3.6 and a shorter reach now that the
   fire itself is visible */
const fireGlow = new THREE.PointLight(0xff9a4d, 3.6, 7, 2);
/* round 3: the fire moved to the wall's middle bay (-3.94);
   its light moves with it */
fireGlow.position.set(-3.84, 1.2, -10.2);
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
const lrCanvas = document.createElement('canvas'); lrCanvas.width = 512; lrCanvas.height = 350;
const lrCtx = lrCanvas.getContext('2d');
const lrTex = new THREE.CanvasTexture(lrCanvas); lrTex.colorSpace = THREE.SRGBColorSpace;
const lrTrack = [];
for (let i = 0; i <= 120; i++) {
  const x = i / 120;
  lrTrack.push({ x: 20 + x * 472, y: 118 + Math.sin(x * 5.2) * 40 + Math.sin(x * 13.7) * 10 + x * 80 });
}
function drawLineRider(time) {
  const g = lrCtx, W = 512, H = 350;
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
  /* GROUNDING PASS (2026-11-27 22:25 — Johnny: "Same with Line
     Rider. It's tilted and going through the counter... All of
     them need to feel totally natural and realistically in the
     room."): the old slab was 0.62 × 0.45 m — a drawing board,
     more than twice a real iPad in each dimension — laid back
     at 0.62 rad (35° from flat), so from the seat its lower edge
     dove behind the island's fruit bowl and read as sunk INTO
     the counter. Now it is a real iPad Pro 12.9" (0.280 ×
     0.203 m; screen 0.256 × 0.175) standing on an easel stand
     at 1.22 rad (70° from flat — the angle a stand actually
     holds a tablet at), its bottom edge RESTING on the island
     top (y 0.92, the depth map's island plane; base anchor
     2.42 m, exact in the depth build). Geometry, in the stand's
     yawed local frame (yaw -0.35 at (0.9, -2.3)): bottom edge
     at local z +0.10 on the counter; centre = bottom edge +
     (D/2)·(0, sin70°, -cos70°) = (0, 1.015, +0.065); the world
     centre below is that offset yawed by -0.35. */
  const ipad = new THREE.Group();
  ipad.position.set(0.878, 1.015, -2.239);
  /* Euler order YXZ: yaw first, then tilt — the SAME composition
     the stand group's yaw + the board's local tilt produce, so
     slab and board are exactly parallel. (With the default XYZ
     the two compositions differ by ~11° and the board rendered
     pasted across the screen's right edge — caught in this
     pass's first frames.) */
  ipad.rotation.set(1.22, -0.35, 0); ipad.rotation.order = 'YXZ';
  const body = box(0.28, 0.016, 0.203, darkMetal); ipad.add(body);
  const scr = screenMesh(0.256, 0.175, lrTex);
  scr.rotation.x = -Math.PI / 2; scr.position.y = 0.0095;
  ipad.add(scr);
  scene.add(ipad);
  ipadRig.group = ipad;
  ipadRig.rest = { p: ipad.position.clone(), e: ipad.rotation.clone() };
  ipadRig.lifted = { p: new THREE.Vector3(0.878, 1.055, -1.959), e: new THREE.Euler(1.08, -0.35, 0, 'YXZ') };
  /* the stand, in the same yawed local frame: a foot plate on
     the counter, a lip at its front holding the iPad's bottom
     edge, a back board parallel to the slab behind its upper
     half, and a centre strut tying the board down to the foot —
     an easel, in walnut and dark metal like the room's own
     furniture. The stand stays on the counter when the pick-up
     lifts the iPad off it. */
  const stand = new THREE.Group(); stand.position.set(0.9, 0, -2.3); stand.rotation.y = -0.35;
  const foot = box(0.26, 0.014, 0.20, timberMat); foot.position.set(0, 0.927, 0.055); stand.add(foot);
  const lip = box(0.26, 0.024, 0.018, darkMetal); lip.position.set(0, 0.939, 0.118); stand.add(lip);
  const board = box(0.24, 0.014, 0.15, timberMat);
  board.position.set(0, 1.032, 0.028); board.rotation.x = 1.22; stand.add(board);
  const strut = box(0.06, 0.014, 0.17, darkMetal);
  strut.position.set(0, 0.962, -0.002); strut.rotation.x = -0.52; stand.add(strut);
  scene.add(stand);
  /* the contact shadow, sized to the real iPad + stand (it was
     a 1.0 × 0.78 m pool under the old slab) and nudged along
     the sun's floor projection (-x, +z): the shadow is what
     seats it on the stone */
  const sh = blobShadow(0.55, 0.5, 0.6); sh.position.set(0.86, 0.923, -2.26); scene.add(sh);
  registerStation({
    id: 'linerider', name: 'Line Rider',
    focus: new THREE.Vector3(0.88, 1.02, -2.24),
    camPos: new THREE.Vector3(0.70, 1.34, -0.98),
    camFocus: new THREE.Vector3(0.88, 1.04, -2.22),
    pushPos: new THREE.Vector3(0.72, 1.32, -1.00),
    pushFocus: new THREE.Vector3(0.878, 1.06, -1.95),
    /* the hitbox hugs the standing slab (top edge y 1.11) with
       tap generosity below the counter line, where the island's
       front face carries no other station's sightline */
    hit: [0.7, 0.45, 0.5],
    tapObj: ipadRig.group,
  });
}

/* Frequency Generator: a compact instrument on the coffee table by
   the armchairs — plate alive on top */
{
  const table = new THREE.Group(); table.position.set(-0.69, 0, -4.47);
  /* the rig sits RAISED on its driver base, the way a real
     Chladni setup does (Johnny, 2026-11-27 07:45): the plate
     stays LEVEL — a tilted plate would spill its sand — on a
     believable base unit that lifts it clear of the table edge's
     sightline from the entry, pattern up and readable.
     GROUNDING PASS (2026-11-27 22:25): the old rig was a
     0.68 m-diameter black drum — twice a real Chladni plate,
     wider than the photo's coffee-table books are long — and
     its only blob shadow sat at FLOOR level under the table
     (the blob's default y), so the base met the tabletop with
     no contact shadow at all and read heavy, flat and floating
     in its close view. The rig is now bench scale (plate
     Ø 0.46 m, base Ø 0.41 m — a large real plate against the
     table's ~0.30 m books), same stack, same tabletop
     (y 0.445, the photo's coffee-table plane): foot bottom
     exactly on it. The foot is a wide thin plinth (Ø 0.47 m)
     and the driver body narrower (Ø 0.39 m), so the stack
     reads as an instrument, not a drum. */
  const baseFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.24, 0.02, 36), darkMetal);
  baseFoot.position.set(-0.25, 0.455, 0); table.add(baseFoot);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.195, 0.095, 36), darkMetal);
  base.position.set(-0.25, 0.512, 0); table.add(base);
  const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.014, 36),
    new THREE.MeshStandardMaterial({ color: 0x8f959e, roughness: 0.35, metalness: 0.85 }));
  baseRing.position.set(-0.25, 0.567, 0); table.add(baseRing);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.014, 40),
    [darkMetal, new THREE.MeshBasicMaterial({ map: fgTex, toneMapped: false }), darkMetal]);
  plate.position.set(-0.25, 0.578, 0); table.add(plate);
  const amp = box(0.22, 0.10, 0.15, blackGlass); amp.position.set(0.24, 0.495, -0.10); amp.rotation.y = -0.25; table.add(amp);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 16),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.3, metalness: 0.7 }));
  knob.position.set(0.17, 0.552, -0.115); table.add(knob);
  /* the contact shadow ON the tabletop, under the rig and the
     amp, offset a few cm along the sun's projection (-x, +z)
     the way the photo's own tabletop shadows lean */
  const fsh = blobShadow(0.95, 0.72, 0.55);
  fsh.position.set(-0.30, 0.449, 0.05); table.add(fsh);
  scene.add(table);
  registerStation({
    id: 'frequency', name: 'Frequency Generator',
    focus: new THREE.Vector3(-0.94, 0.60, -4.47),
    camPos: new THREE.Vector3(-0.28, 1.38, -2.09),
    hit: [1.1, 0.7, 0.85],
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
  /* propped on a small stand like the iPad (Johnny, 2026-11-27
     07:43): at 0.22 rad lying back it read as a dark slab from
     the entry; at ~30° on its plank the living Threads screen
     faces the room and the armchair. The stand stays on the side
     table when the tablet lifts to meet you */
  /* GROUNDING PASS (2026-11-27 22:25): the old tablet was
     0.52 × 0.36 m — a serving tray, twice a real tablet — laid
     back at 0.52 rad on its plank, with NO contact shadow on
     the side table at all. Now a real iPad-class tablet
     (0.280 × 0.195 m, screen 0.256 × 0.160) on the same easel
     language as the island iPad, at 1.10 rad (63° from flat),
     its bottom edge resting on the photo's side-table top
     (y 0.571): centre = bottom edge (local z +0.06) +
     (D/2)·(0, sin63°, -cos63°), yawed by +0.30 into world. */
  const grp = new THREE.Group(); grp.position.set(-1.105, 0.658, -4.905);
  /* YXZ for the same reason as the island iPad: yaw-then-tilt
     matches the stand's composition, so the tablet stands
     square on its easel instead of rolled */
  grp.rotation.set(1.10, 0.30, 0); grp.rotation.order = 'YXZ';
  const body = box(0.28, 0.016, 0.195, darkMetal); grp.add(body);
  const scr = screenMesh(0.256, 0.16, thTex); scr.rotation.x = -Math.PI / 2; scr.position.y = 0.0095; grp.add(scr);
  scene.add(grp);
  const tStand = new THREE.Group(); tStand.position.set(-1.11, 0, -4.92); tStand.rotation.y = 0.30;
  const tFoot = box(0.24, 0.012, 0.17, timberMat); tFoot.position.set(0, 0.577, 0.028); tStand.add(tFoot);
  const tLip = box(0.24, 0.022, 0.016, darkMetal); tLip.position.set(0, 0.588, 0.082); tStand.add(tLip);
  const tBoard = box(0.22, 0.012, 0.13, timberMat);
  tBoard.position.set(0, 0.671, -0.007); tBoard.rotation.x = 1.10; tStand.add(tBoard);
  const tStrut = box(0.05, 0.012, 0.14, darkMetal);
  tStrut.position.set(0, 0.612, -0.01); tStrut.rotation.x = -0.52; tStand.add(tStrut);
  scene.add(tStand);
  /* the contact shadow the station never had, on the side-table
     top under the stand, leaning with the sun (-x, +z) */
  const tsh = blobShadow(0.5, 0.42, 0.5); tsh.position.set(-1.14, 0.574, -4.89); scene.add(tsh);
  tabletRig.group = grp; tabletRig.rest = grp.position.clone();
  tabletRig.lifted = grp.position.clone().add(new THREE.Vector3(0, 0.17, 0.17));
  registerStation({
    id: 'threads', name: 'Threads',
    focus: new THREE.Vector3(-1.105, 0.66, -4.905),
    /* the start is a sit-down: the camera settles into the white
       armchair itself, eyes at seated height, looking at the tablet
       on the side table — the doors and terrace behind it, not the
       unphotographed space behind the photo's own camera */
    camPos: new THREE.Vector3(-1.11, 1.06, -4.28),
    camFocus: new THREE.Vector3(-1.105, 0.62, -4.905),
    hit: [0.6, 0.45, 0.5],
    tapObj: tabletRig.group,
  });
}

/* ============ the painting portal: Johnny's View (merge, 2026-11-28) ============
   Johnny, 2026-11-27 22:34-22:37: the oil painting over the
   fireplace is a station — tap centres it, opening it brings
   Johnny's View into the frame on Mount Corcoran. The painting
   is IN the photograph; nothing is modelled. Its bounds were
   measured off the same depth map the room is displaced from:
   centre (-5.208, 2.942, -10.630) on the back wall, 2.02 x 1.64 m,
   and its tap plane lies in the photo's own plane (local axes =
   the photo's axes), so a tap lands on the painting exactly
   where the eye sees it. */
{
  const paintC = new THREE.Vector3(-5.208, 2.942, -10.630);
  const paintPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.02, 1.64),
    new THREE.MeshBasicMaterial({ visible: false }));
  paintPlane.position.copy(paintC);
  paintPlane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0.9999861498722319, 0.0, 0.005263084999327529),
    new THREE.Vector3(0.00037026118896976484, 0.9975223270893656, -0.07034962590425542),
    new THREE.Vector3(-0.005250044796198329, 0.0703506002690577, 0.9975085112776839)));
  scene.add(paintPlane);
  registerStation({
    id: 'painting', name: "Johnny's View",
    focus: paintC.clone(),
    camPos: new THREE.Vector3(-4.45, 2.76, -9.23),
    camFocus: paintC.clone(),
    hit: [2.2, 1.8, 0.4],
    tapObj: paintPlane,
  });
}

/* ============ the Vision Pro: AR World's station (merge, 2026-11-28) ============
   Johnny, 2026-11-27 22:52: an Apple Vision Pro resting on the
   island counter near the Line Rider iPad; putting it on opens
   AR World. Placed from the depth map: the island top is a clean
   plane at y 0.92, and this spot sits 0.42 m right of the iPad's
   stand, short of the faucet, on open stone. Real headset scale
   (0.27 m across the front), facing the seat on the iPad's own
   yaw, its contact shadow leaning with the sun like its
   neighbours'. Built from the room's material language. */
{
  const vp = new THREE.Group();
  vp.position.set(1.32, 0.92, -2.42);
  vp.rotation.y = -0.31;
  const vpFabric = new THREE.MeshStandardMaterial({ color: 0xd9d6d0, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.35 });
  const vpSeal = new THREE.MeshStandardMaterial({ color: 0x2b2d2f, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.2 });
  const vpShell = box(0.262, 0.096, 0.05, vpFabric); vpShell.position.set(0, 0.05, -0.028); vp.add(vpShell);
  const vpSealBand = box(0.24, 0.07, 0.02, vpSeal); vpSealBand.position.set(0, 0.048, -0.056); vp.add(vpSealBand);
  const vpGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.092, 28, 1, true, -0.83, 1.66), blackGlass);
  vpGlass.position.set(0, 0.05, -0.14); vp.add(vpGlass);
  const vpArmL = box(0.02, 0.032, 0.1, vpFabric); vpArmL.position.set(-0.133, 0.052, -0.055); vp.add(vpArmL);
  const vpArmR = box(0.02, 0.032, 0.1, vpFabric); vpArmR.position.set(0.133, 0.052, -0.055); vp.add(vpArmR);
  const vpCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.01, 16), darkMetal);
  vpCrown.rotation.z = Math.PI / 2; vpCrown.position.set(0.138, 0.078, -0.012); vp.add(vpCrown);
  const vpStrap = new THREE.Mesh(new THREE.TorusGeometry(0.102, 0.02, 10, 28, Math.PI), vpFabric);
  vpStrap.rotation.x = -Math.PI / 2; vpStrap.position.set(0, 0.05, -0.055); vp.add(vpStrap);
  const vpTop = box(0.055, 0.01, 0.15, vpFabric); vpTop.position.set(0, 0.103, -0.05); vp.add(vpTop);
  scene.add(vp);
  const vpShadow = blobShadow(0.52, 0.44, 0.5);
  vpShadow.position.set(1.285, 0.9235, -2.375); scene.add(vpShadow);
  registerStation({
    id: 'visionpro', name: 'AR World',
    focus: new THREE.Vector3(1.32, 0.985, -2.42),
    camPos: new THREE.Vector3(1.03, 1.34, -1.50),
    camFocus: new THREE.Vector3(1.32, 0.97, -2.42),
    hit: [0.62, 0.42, 0.55],
    tapObj: vp,
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
const KART_POS = new THREE.Vector3(7.2, 0, -10.6);
const HOVER = 0.30;
/* parked heights (GROUNDING PASS, 2026-11-27 22:25 — Johnny:
   the vehicles must feel "appropriately sized and parked...
   like they fit in"): the Disc HOVERS one foot (0.30 m) off
   the terrace floor on its pad — a parked saucer, still, no
   bob — with its shadow thrown off-centre by the sun (see the
   shadow's placement below). Starman is a car: it rests on its
   wheels at floor level. The kart's group origin is now its
   floor contact point (its billboard is centred inside the
   group), so its rest height is the floor itself. */
const REST_Y = 0.02;
const DISC_REST_Y = HOVER;
const KART_REST_Y = 0.0;
let parkedCraft = 'disc';
let swapAnim = null;
let discShadow, starShadow, discWrap, starWrap, craftHitMesh, discBuilt = null;
let craftTapBoxes = null;
const craftSizes = {};
{
  const factory = makeCraft(renderer);
  discBuilt = factory.buildDisc();
  const starBuilt = factory.buildStarman();
  /* measure the real builds, scale them to their room sizes, and seat
     each in a wrap whose origin is the pad point under it, so the
     wrap's height IS the hover height. GROUNDING PASS: the Disc
     was 3.60 m across — wider than the terrace door bay is tall,
     looming over the dining set in every entry frame. At 3.00 m
     it is still a two-seat craft (half again the 1.9 m dining
     table) but sits inside the terrace's own proportions.
     Starman stays 3.95 m long — a car's length. */
  discWrap = new THREE.Group();
  discBuilt.group.scale.setScalar(3.00 / new THREE.Box3().setFromObject(discBuilt.group).getSize(new THREE.Vector3()).x);
  let bb = new THREE.Box3().setFromObject(discBuilt.group);
  discBuilt.group.position.y = -bb.min.y;
  discWrap.add(discBuilt.group); scene.add(discWrap);
  discWrap.position.set(PAD.x, DISC_REST_Y, PAD.z);
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
  /* the hovering Disc's shadow: softer and a touch larger than
     the craft (a shadow blurs as its caster rises), and thrown
     off-centre along the sun's floor projection — the scene sun
     rakes from (13, 10.5, -19) toward (-2, 0.4, -3), so a point
     0.30 m up casts 0.30 × (15, 16)/10.1 ≈ (0.45, 0.48) m toward
     (-x, +z). A centred shadow under a hovering craft is the
     pasted-on tell; this offset is the grounding cue. */
  discShadow = blobShadow(3.35, 3.35, 0.30); discShadow.position.set(PAD.x - 0.45, 0.012, PAD.z + 0.47); scene.add(discShadow);
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
  /* focus at the hovering Disc's body centre (base 0.30 + ~half
     its 0.9 m body at the new 3.00 m scale) */
  focus: new THREE.Vector3(PAD.x, 0.80, PAD.z),
  /* pulled back, up and left from v3's first pose: the old spot
     hovered half a metre over the island's near-right corner, whose
     grazing projected top filled the lower frame with a smeared
     wedge and cut the Disc's rim — now the island's far edge sits
     low in the frame and the pad reads whole */
  camPos: new THREE.Vector3(0.4, 2.3, 0.6),
  hit: [4.4, 2.2, 4.2],
});

/* the Thumb Drive kart, parked beside the Disc's pad */
let kartGroup, kartShadowMesh, kartBill;
{
  kartGroup = new THREE.Group();
  kartGroup.position.set(KART_POS.x, KART_REST_Y, KART_POS.z); kartGroup.rotation.y = 0.5;
  const tex = texLoader.load('games-room/assets/kart.webp');
  tex.colorSpace = THREE.SRGBColorSpace;
  /* GROUNDING PASS (2026-11-27 22:25): the kart was a 1.5 ×
     1.05 m cutout leaning back 0.10 rad, its base ~5 cm over
     the terrace — a toy floating at the overlook next to a
     3.6 m Disc. It is a CAR: the cutout (880 × 616, measured)
     fills its frame edge to edge and BOTH wheels' contact
     pixels sit on the image's last row (centre valance at
     0.968), so a car-width plane with its bottom edge ON the
     floor puts the wheels on the floor. Plane 1.85 m wide
     (a performance car's rear width, against the 3.00 m Disc
     and the terrace furniture) × 1.295 m by the image's own
     aspect; group origin = the floor contact point; the plane
     stands VERTICAL (the old lean lifted its contact line off
     the floor plane at every look angle but one). */
  kartBill = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 1.295),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  kartBill.position.y = 0.6475;
  kartGroup.add(kartBill);
  scene.add(kartGroup);
  kartShadowMesh = blobShadow(2.2, 1.7, 0.42);
  kartShadowMesh.position.set(KART_POS.x, 0.012, KART_POS.z); kartShadowMesh.rotation.z = 0.5;
  scene.add(kartShadowMesh);
  /* a dense contact core under the wheels */
  const kartCore = blobShadow(1.6, 1.05, 0.5);
  kartCore.position.set(KART_POS.x, 0.014, KART_POS.z); kartCore.rotation.z = 0.5;
  scene.add(kartCore);

  registerStation({
    id: 'thumbdrive', name: 'Thumb Drive',
    /* the focus is the car's visual centre: the plane spans
       y 0..1.295, its body mass centred a little below middle */
    focus: new THREE.Vector3(KART_POS.x, 0.60, KART_POS.z),
    camPos: new THREE.Vector3(4.9, 1.45, -6.7),
    hit: [2.0, 1.45, 1.2],
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
/* ROUND 5 — the seat moves to the photo's camera: closer to
   the island and a touch higher, pitched ~4° down. Measured
   off the photo: the island's far edge sits at ~64% of the
   frame height and its near edge falls BELOW the frame (the
   front face is a sliver at the photo's bottom edge, no more);
   the round-4 seat (z 0.7, eye 1.52, near-level) put the far
   edge at 60% and the near edge at 79% with the dark face
   filling the last fifth — the slab that swallowed the lower
   half of every entry frame. From (0.55, 1.60, 0.0) the top's
   angular span is the photo's ~36% of frame: far edge ~0.65,
   near edge off-frame, painting centre ~0.25, fire ~0.53. */
const HOME = { pos: new THREE.Vector3(0.55, 1.60, 0.0), focus: new THREE.Vector3(0.6, 0.93, -9.5) };
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
  let camPos, camFocus, fov = ROOM_FOV, speedK = 0;
  if (vehicle === 'disc' || vehicle === 'starman') {
    const wrap = vehicle === 'disc' ? discWrap : starWrap;
    const liftK = sstep(0, 0.30, t);
    const depK = easeInQ(sstep(0.25, 0.80, t));
    speedK = depK;
    const topY = vehicle === 'disc' ? 6.5 : 5.0, outY = vehicle === 'disc' ? 10 : 13;
    const vx = vehicle === 'disc' ? 9 : 3, vz = vehicle === 'disc' ? -30 : -34;
    const craftPos = new THREE.Vector3(
      PAD.x + depK * (vx - PAD.x),
      (vehicle === 'disc' ? DISC_REST_Y : REST_Y) + liftK * topY + depK * outY,
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
    fov = ROOM_FOV + 13 * depK;
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
    kartBill.rotation.x = -0.30 * Math.sin(Math.PI * Math.min(dartK * 1.2, 1));
    camPos = S.clone().lerp(new THREE.Vector3(7.6, 1.5, -4.6), sstep(0.1, 0.5, t));
    camFocus = F.clone().lerp(craftPos.clone(), sstep(0, 0.2, t));
    fov = ROOM_FOV + 8 * dartK;
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
  discWrap.position.set(PAD.x, DISC_REST_Y, PAD.z); discWrap.rotation.set(0, 0, 0);
  starWrap.position.set(PAD.x, REST_Y, PAD.z); starWrap.rotation.set(0, 2.50, 0);
  kartGroup.position.set(KART_POS.x, KART_REST_Y, KART_POS.z);
  kartBill.rotation.x = 0;
  camera.fov = ROOM_FOV; camera.updateProjectionMatrix();
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
  /* MERGE FIX (2026-11-28): the pad's corners are NOT concatenated
     in anymore. The 3.8 m pad rect swallowed the Thumb Drive kart's
     own tap rect whole at every look, so a tap on the kart always
     resolved to the parked craft and the kart could never be
     centred from the seat. The rect is the craft itself now —
     which is also what the visitor sees and aims at. */
  return projPointsRect(craftTapBoxes[parkedCraft]);
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
  /* MERGE FIX (2026-11-28): every hit whose visual rect contains
     the tap is a candidate, and the candidate whose rect CENTRE
     is nearest the tap wins (ray order breaks ties). The old
     first-match race handed the Thumb Drive kart's own centre to
     the parked craft: the craft's hit volume stands in front of
     the kart and its projected rect — even with the pad's corners
     removed from it — still covers the kart's middle from the
     seat. Nearest-centre is also what a visitor means everywhere
     else: you tapped the thing whose middle you were closest to. */
  let best = null, bestD = Infinity;
  for (const h of hits) {
    const st = h.object === craftHitMesh ? ust : h.object.userData.station;
    if (!st) continue;
    const r = st === ust ? craftTapRect() : stationTapRect(st);
    if (!r || !inRect(r, e.clientX, e.clientY)) continue;
    const dx = (r.x0 + r.x1) / 2 - e.clientX, dy = (r.y0 + r.y1) / 2 - e.clientY;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = st; }
  }
  if (best) { tapStation(best); return; }
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
  camera.fov = ROOM_FOV; camera.updateProjectionMatrix();
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
  /* one-shot: run cb right after the next frame is actually
     rendered (the host's tab-return guard lifts the veil only
     once a real frame exists, never onto a black canvas) */
  onNextFrame: (cb) => { if (typeof cb === 'function') frameCbs.push(cb); },
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
  /* round 5: the tongues grow to the photo's fire — in the
     photo the flame stands ~55% of the opening's height over
     the logs; round 4's tongues topped out near 30% and the
     fire read as embers. Eight tongues across the log bed,
     taller and wider, over a brighter core */
  for (let i = 0; i < 8; i++) {
    const bx = 26 + i * 11 + Math.sin(now / 170 + i * 2.1) * 3;
    const h = 44 + Math.random() * 34 + Math.sin(now / 230 + i) * 7;
    const w = 8 + Math.random() * 6;
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
const frameCbs = [];
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
    /* parked craft hold their pad heights — still, one vehicle:
       the Disc hovering its one foot, Starman on its wheels
       (grounding pass, 2026-11-27 22:25). The only lift a parked
       craft ever makes is the swap's small rise-and-settle */
    const swapLift = swapAnim ? Math.sin(Math.min(swapAnim.t, 1) * Math.PI) * 0.12 : 0;
    if (flying !== 'disc') discWrap.position.y = DISC_REST_Y + swapLift;
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
  if (frameCbs.length) {
    const cbs = frameCbs.splice(0, frameCbs.length);
    for (const cb of cbs) { try { cb(); } catch (e) { /* a host callback never breaks the loop */ } }
  }
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
