/* Explore the Known Universe — a fly-through of the real, mapped universe.
   Every star and galaxy sits at its true catalogued position:
     Stars    — HYG Database v4.0 (Hipparcos / Yale Bright Star / Gliese),
                x/y/z in parsecs from the Sun, equatorial J2000 frame.
     Galaxies — OpenNGC (built from NASA/IPAC NED): direction, size, tilt
                and type from the catalog; the named galaxies use published
                redshift-independent distances, the deep cloud uses
                Hubble-flow distances from redshift (H0 = 70) — approximate,
                and labelled as such in the game's About note.
   Positions and distances are real. The symbols are enlarged so the eye can
   see them (a real star at these distances is a dimensionless point):
   symbol sizes follow a logarithm of each object's real brightness or
   width, squeezed until everything catalogued registers, and a star's
   brightness is worked out from the camera's true distance to it, not
   from the Sun. A faint haze is summed from the catalog itself — where
   mapped stars crowd together their light is added into a soft glow,
   so the sky's texture is the catalog's own density and no light
   appears where no stars are mapped; the brightest stars shimmer
   slightly, and the view drifts very slowly when left alone. Flight
   is faster than light — the HUD says by how much.
   Those are the only liberties, and the game states them.

   Data file: universe-data.bin (baked by build_data.py; layout documented
   there). Three.js is vendored beside this file. Nothing here loads until
   the Games page shell first expands the Universe section. */
import * as THREE from './three.module.min.js';

var LY_PER_PC = 3.26156;
var C_PER_PC_S = 102927.0; /* 1 pc/s in multiples of light speed */

/* ------------------------------------------------------------------ *
 *  Data parsing (pure — unit-testable without WebGL)                  *
 * ------------------------------------------------------------------ */
export function parseUniverseData(buffer) {
    var dv = new DataView(buffer);
    var magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'UJBO') throw new Error('bad data file (magic ' + magic + ')');
    var starCount = dv.getUint32(8, true);
    var galCount = dv.getUint32(12, true);
    var namedLen = dv.getUint32(16, true);
    var off = 64;
    var starPos = new Float32Array(buffer, off, starCount * 3); off += starCount * 12;
    var magQ = new Uint8Array(buffer, off, starCount); off += starCount;
    var ciQ = new Int16Array(buffer, off, starCount); off += starCount * 2;
    var galPos = new Float32Array(buffer, off, galCount * 3); off += galCount * 12;
    var galMajor = new Float32Array(buffer, off, galCount * 3); off += galCount * 12;
    var galDiam = new Float32Array(buffer, off, galCount); off += galCount * 4;
    var galAxis = new Uint8Array(buffer, off, galCount); off += galCount;
    var galBright = new Uint8Array(buffer, off, galCount); off += galCount;
    var galTint = new Uint8Array(buffer, off, galCount); off += galCount;
    var named = JSON.parse(new TextDecoder('utf-8').decode(
        new Uint8Array(buffer, off, namedLen)));
    var namedGalCount = 0;
    named.forEach(function (e) { if (e.k === 1) namedGalCount++; });
    var starMag = new Float32Array(starCount);
    var starCi = new Float32Array(starCount);
    var starAbsMag = new Float32Array(starCount);
    for (var i = 0; i < starCount; i++) {
        starMag[i] = magQ[i] / 10 - 5;
        starCi[i] = ciQ[i] / 1000;
        /* Absolute magnitude from the distance modulus — exact, from the
           packed apparent magnitude and the packed position's length:
           M = m - 5*log10(d_pc) + 5. The renderer needs it so a star's
           brightness can be judged from wherever the camera is. */
        var sx = starPos[i * 3], sy = starPos[i * 3 + 1], sz = starPos[i * 3 + 2];
        var sd = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (sd < 0.01) sd = 0.01;
        starAbsMag[i] = starMag[i] - 5 * Math.log10(sd) + 5;
    }
    /* Resolve a position (parsecs, [x,y,z]) for every named entry. */
    var namedPos = new Float64Array(named.length * 3);
    named.forEach(function (e, k) {
        var p;
        if (e.k === 0) p = [starPos[e.i * 3], starPos[e.i * 3 + 1], starPos[e.i * 3 + 2]];
        else if (e.k === 1) p = [galPos[e.i * 3], galPos[e.i * 3 + 1], galPos[e.i * 3 + 2]];
        else p = e.p;
        namedPos[k * 3] = p[0]; namedPos[k * 3 + 1] = p[1]; namedPos[k * 3 + 2] = p[2];
        e._pos = p;
    });
    return {
        starCount: starCount, galCount: galCount,
        starPos: starPos, starMag: starMag, starCi: starCi, starAbsMag: starAbsMag,
        galPos: galPos, galMajor: galMajor, galDiam: galDiam,
        galAxis: galAxis, galBright: galBright, galTint: galTint,
        named: named, namedPos: namedPos, namedGalCount: namedGalCount
    };
}

/* Galactic north pole (J2000) as a unit vector in the equatorial frame —
   the tour and free flight keep it "up", so the Milky Way's disk lies
   flat when you rise above it. */
function equatorial(raHours, decDeg) {
    var ra = raHours * Math.PI / 12, dec = decDeg * Math.PI / 180;
    return new THREE.Vector3(
        Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
}
var GAL_NORTH = equatorial(12.8567, 27.1284);

function fmtDist(pc) {
    if (pc < 0.01) return Math.round(pc * 206265).toLocaleString('en-US') + ' AU';
    var ly = pc * LY_PER_PC;
    if (ly < 100) return (Math.round(ly * 10) / 10) + ' light-years';
    if (ly < 10000) return Math.round(ly).toLocaleString('en-US') + ' light-years';
    if (ly < 1e6) return Math.round(ly).toLocaleString('en-US') + ' light-years';
    if (ly < 1e9) return (Math.round(ly / 1e5) / 10) + ' million light-years';
    return (Math.round(ly / 1e8) / 10) + ' billion light-years';
}
function fmtSpeed(pcPerSec) {
    var xc = pcPerSec * C_PER_PC_S;
    if (xc < 10000) return Math.round(xc).toLocaleString('en-US') + ' × light speed';
    if (xc < 1e6) return Math.round(xc).toLocaleString('en-US') + ' × light speed';
    if (xc < 1e9) return (Math.round(xc / 1e5) / 10) + ' million × light speed';
    return (Math.round(xc / 1e8) / 10) + ' billion × light speed';
}


/* ------------------------------------------------------------------ *
 *  Shaders                                                            *
 * ------------------------------------------------------------------ */
var STAR_VERT = [
    'attribute float aAbsMag;',
    'attribute float aCi;',
    'attribute float aPhase;',
    'uniform float uScaleH;',   /* (height px * 0.5 * proj[1][1]) * dpr */
    'uniform float uDpr;',
    'uniform float uTime;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vGlow;',
    'varying float vShim;',
    'vec3 ciColor(float ci) {',
    '    vec3 c1 = vec3(0.50, 0.62, 1.00);',  /* -0.33 blue-white      */
    '    vec3 c2 = vec3(0.72, 0.82, 1.00);',  /*  0.00 white-blue      */
    '    vec3 c3 = vec3(1.00, 0.95, 0.84);',  /*  0.32 white           */
    '    vec3 c4 = vec3(1.00, 0.84, 0.55);',  /*  0.65 yellow-white    */
    '    vec3 c5 = vec3(1.00, 0.64, 0.30);',  /*  1.15 orange          */
    '    vec3 c6 = vec3(1.00, 0.46, 0.19);',  /*  1.65 red-orange      */
    '    vec3 c7 = vec3(1.00, 0.33, 0.12);',  /*  2.40 deepest red     */
    '    vec3 col = c1;',
    '    col = mix(col, c2, smoothstep(-0.33, 0.00, ci));',
    '    col = mix(col, c3, smoothstep( 0.00, 0.32, ci));',
    '    col = mix(col, c4, smoothstep( 0.32, 0.65, ci));',
    '    col = mix(col, c5, smoothstep( 0.65, 1.15, ci));',
    '    col = mix(col, c6, smoothstep( 1.15, 1.65, ci));',
    '    col = mix(col, c7, smoothstep( 1.65, 2.40, ci));',
    '    return col;',
    '}',
    'void main() {',
    '    vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '    float dist = max(0.0005, -mv.z);',   /* parsecs — scene units */
    /* Apparent magnitude from the camera, by the distance modulus on
       the star's real absolute magnitude: m = M + 5*log10(d) - 5.
       Fly close and a dwarf blazes; fall back and only the giants hold
       up — that is the real behaviour of light, then squeezed below. */
    '    float mCam = aAbsMag + 5.0 * (log(dist) * 0.4342945) - 5.0;',
    /* A stable per-star phase for the shimmer — a hash of the star's
       real position, so it invents nothing and never changes. */
    '    float phase = aPhase;',
    /* Size: a logarithm of real brightness. Each magnitude step shrinks
       the symbol by a fixed gentle ratio (10^-0.11) instead of the true
       2.512x flux step, and a 2px floor keeps every catalogued star
       registered; the cap keeps a near giant from filling the screen. */
    '    float sz = 9.0 * pow(10.0, -0.11 * mCam);',
    /* Glow is earned by brightness alone — only genuinely bright stars
       (from wherever you stand) carry a wide halo. */
    '    float szN = sz * 0.1111111;',
    '    vGlow = clamp(1.288 * szN * szN, 0.0, 1.0);',
    /* Shimmer: only halo-carrying stars breathe, by a few percent,
       each on its own slow phase — the field feels alive standing
       still without anything visibly twinkling. */
    '    float shim = sin(uTime * 0.8 + phase * 6.28318);',
    '    vShim = 1.0 + 0.13 * vGlow * shim;',
    '    gl_PointSize = clamp(sz * (1.0 + 0.05 * vGlow * shim), 2.0, 46.0) * uDpr;',
    '    vCol = ciColor(aCi);',
    /* Brightness follows the same squeezed scale, floored so the
       faintest catalogued stars stay faint but never vanish. */
    '    vAlpha = clamp(pow(10.0, -0.145 * (mCam - 2.0)), 0.30, 1.0);',
    '    gl_Position = projectionMatrix * mv;',
    '}'
].join('\n');
var STAR_FRAG = [
    'precision mediump float;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vGlow;',
    'varying float vShim;',
    'void main() {',
    '    vec2 q = gl_PointCoord - 0.5;',
    '    float d = length(q) * 2.0;',
    /* Push the colour away from grey — starlight should read as
       colour (white, pale blue, yellow, orange, red), not as noise. */
    '    vec3 col = mix(vec3(dot(vCol, vec3(0.3333))), vCol, 1.30);',
    '    float g = max(0.0, 1.0 - d * d);',
    '    float g2 = g * g;',
    '    float core = g2 * g2 * g2 * g2 * g * (1.0 + 0.35 * vGlow);',
    '    float halo = g2 * (0.20 + 0.85 * vGlow);',
    '    float a = clamp(core + halo, 0.0, 1.0) * vAlpha * vShim;',
    '    if (a < 0.004) discard;',
    '    gl_FragColor = vec4(col, a);',
    '}'
].join('\n');
/* Starlight glow — one sprite per occupied cell of a space grid,
   baked at runtime from the catalog itself (see buildGlowLayer).
   aW: the cell's summed real starlight, log-squeezed 0..1.
   aCiW: its light-weighted mean B-V colour. aDiam: sprite diameter
   in parsecs — world-sized like the galaxies, so the haze sits IN
   the space the stars occupy. */
var GLOW_VERT = [
    'attribute float aW;',
    'attribute float aCiW;',
    'attribute float aDiam;',
    'uniform float uScaleH;',
    'uniform float uDpr;',
    'uniform float uTime;',
    'uniform float uAlpha;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'vec3 ciColor(float ci) {',
    '    vec3 c1 = vec3(0.50, 0.62, 1.00);',
    '    vec3 c2 = vec3(0.72, 0.82, 1.00);',
    '    vec3 c3 = vec3(1.00, 0.95, 0.84);',
    '    vec3 c4 = vec3(1.00, 0.84, 0.55);',
    '    vec3 c5 = vec3(1.00, 0.64, 0.30);',
    '    vec3 c6 = vec3(1.00, 0.46, 0.19);',
    '    vec3 c7 = vec3(1.00, 0.33, 0.12);',
    '    vec3 col = c1;',
    '    col = mix(col, c2, smoothstep(-0.33, 0.00, ci));',
    '    col = mix(col, c3, smoothstep( 0.00, 0.32, ci));',
    '    col = mix(col, c4, smoothstep( 0.32, 0.65, ci));',
    '    col = mix(col, c5, smoothstep( 0.65, 1.15, ci));',
    '    col = mix(col, c6, smoothstep( 1.15, 1.65, ci));',
    '    col = mix(col, c7, smoothstep( 1.65, 2.40, ci));',
    '    return col;',
    '}',
    'void main() {',
    '    vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '    float dist = max(1.0, -mv.z);',
    '    float px = aDiam * uScaleH / dist;',
    '    gl_PointSize = clamp(px, 4.0, 420.0) * uDpr;',
    '    vCol = ciColor(aCiW);',
    /* A cell you are inside, or right beside, must not white out the
       view — the haze belongs to the distance. */
    '    float close = smoothstep(0.06, 0.70, dist / aDiam);',
    /* From far out the whole layer stacks into a small patch of sky;
       dim it so the island glows instead of blowing out. */
    '    float far = clamp(700.0 / dist, 0.12, 1.0);',
    /* The fabric breathes: a slow undulation travelling across the
       field, phased by each cell's real position. */
    '    float und = 0.84 + 0.16 * sin(uTime * 0.12 + dot(position, vec3(0.011, 0.0073, 0.0091)));',
    '    vAlpha = uAlpha * (0.22 + 0.78 * aW) * close * far * und;',
    '    gl_Position = projectionMatrix * mv;',
    '}'
].join('\n');
var GLOW_FRAG = [
    'precision mediump float;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'void main() {',
    '    vec2 q = gl_PointCoord - 0.5;',
    '    float d = length(q) * 2.0;',
    '    float g = max(0.0, 1.0 - d * d);',
    '    float a = g * g * vAlpha;',
    '    if (a < 0.003) discard;',
    '    gl_FragColor = vec4(vCol, a);',
    '}'
].join('\n');
var GAL_VERT = [
    'attribute vec3 aMajor;',
    'attribute float aDiam;',
    'attribute float aAxis;',
    'attribute float aBright;',
    'attribute float aTint;',
    'attribute float aSeed;',
    'uniform float uScaleH;',
    'uniform float uDpr;',
    'uniform mediump float uHalo;',   /* mediump: must match the fragment stage's precision or strict drivers reject the program */
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vAng;',
    'varying float vAxis;',
    'varying float vTint;',
    'varying float vSeed;',
    'varying float vDetail;',
    'void main() {',
    '    vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '    float dist = max(1.0, -mv.z);',
    '    float px = aDiam * uScaleH / dist;',   /* true angular size */
    '    gl_PointSize = clamp(px, mix(2.6, 2.0, uHalo), 460.0) * uDpr;',
    '    vec3 majView = (modelViewMatrix * vec4(aMajor, 0.0)).xyz;',
    '    vAng = atan(majView.y, majView.x);',
    '    vAxis = aAxis;',
    '    vec3 warm = vec3(1.00, 0.84, 0.64);',
    '    vec3 spiral = vec3(0.84, 0.89, 1.00);',
    '    vec3 irreg = vec3(0.64, 0.76, 1.00);',
    '    vCol = aTint < 0.5 ? warm : (aTint < 1.5 ? spiral : irreg);',
    '    vTint = aTint;',
    '    vSeed = aSeed;',
    /* Procedural form (arms, clumps) only resolves once the sprite is
       big enough to carry it; far specks keep the smooth profile. */
    '    vDetail = clamp(px / 42.0, 0.0, 1.0);',
    '    float a = aBright;',
    '    a *= smoothstep(0.10, 0.55, dist / aDiam);',  /* fade when flying through */
    '    a *= clamp(px / 2.5, mix(0.48, 0.35, uHalo), 1.0);',  /* far specks stay faint — the deep cloud's floor sits a touch higher, so its real walls and filaments survive full-catalog distance */
    '    vAlpha = a;',
    '    gl_Position = projectionMatrix * mv;',
    '}'
].join('\n');
var GAL_FRAG = [
    'precision mediump float;',
    'uniform float uHalo;',   /* 1 for the named set, 0 for the cloud */
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vAng;',
    'varying float vAxis;',
    'varying float vTint;',
    'varying float vSeed;',
    'varying float vDetail;',
    'void main() {',
    '    vec2 q = gl_PointCoord - 0.5;',
    '    float ca = cos(vAng), sa = sin(vAng);',
    '    vec2 r = mat2(ca, -sa, sa, ca) * q;',   /* into the galaxy frame */
    '    r.y /= max(0.10, vAxis);',              /* undo the tilt squeeze */
    '    float d = length(r) * 2.0;',            /* 1.0 = catalogued edge */
    '    float ang = atan(r.y, r.x);',
    '    vec3 col = vCol;',
    '    float lum;',
    '    if (vTint < 0.5) {',
    /* Elliptical: smooth and centrally concentrated (a de Vaucouleurs-
       like fall), warm throughout, whiter at the heart. */
    '        lum = exp(-pow(d, 0.65) * 3.4) * 0.75 + exp(-d * d * 20.0) * 0.85;',
    '        col = mix(vCol, vec3(1.0, 0.96, 0.90), exp(-d * d * 14.0) * 0.55);',
    '    } else if (vTint < 1.5) {',
    /* Spiral: a warm core, then two logarithmic arms winding out;
       the rim runs bluer than the heart — a rendering convention for
       young disk stars vs old core stars, not catalogued colour. */
    '        float armPh = 2.0 * (ang - 2.6 * log(d + 0.06) + vSeed * 6.2831);',
    '        float arms = pow(0.5 + 0.5 * cos(armPh), 3.0);',
    '        float diskL = exp(-d * d * 3.2) * (0.35 + 0.85 * arms * smoothstep(0.03, 0.30, d));',
    '        float coreL = exp(-d * d * 18.0) * 1.1;',
    '        lum = mix(exp(-d * d * 4.5) * 0.6 + coreL, diskL + coreL, vDetail);',
    '        col = mix(vec3(1.05, 0.92, 0.74), vec3(0.72, 0.82, 1.05), smoothstep(0.05, 0.75, d));',
    '    } else {',
    /* Irregular: no disk, no core — a handful of bright clumps
       scattered by the per-galaxy seed. */
    '        float clumps = 0.0;',
    '        for (int k = 0; k < 4; k++) {',
    '            float fk = float(k);',
    '            vec2 off = vec2(fract(vSeed * (7.13 + fk * 3.71)) - 0.5,',
    '                            fract(vSeed * (3.97 + fk * 5.29)) - 0.5) * 0.45;',
    '            float dd = length((r - off) * 2.0);',
    '            clumps += exp(-dd * dd * (5.0 + fk * 1.7)) * (0.75 - fk * 0.13);',
    '        }',
    '        lum = mix(exp(-d * d * 4.5) * 0.6, clumps, vDetail);',
    '        col = mix(vCol, vec3(0.80, 0.88, 1.05), 0.35);',
    '    }',
    /* Named galaxies carry a wide, soft halo beyond their catalogued
       edge — the same starlight-glow treatment as the star field —
       so the showpieces (Andromeda, M87, the Magellanic Clouds) read
       with real presence instead of ending at a hard rim. */
    '    lum += exp(-d * d * 1.6) * 0.38 * uHalo;',
    '    lum *= 1.0 + 0.18 * uHalo;',
    '    float a = clamp(lum, 0.0, 1.0) * vAlpha;',
    '    if (a < 0.004) discard;',
    '    gl_FragColor = vec4(col, a);',
    '}'
].join('\n');

/* ------------------------------------------------------------------ *
 *  The game                                                           *
 * ------------------------------------------------------------------ */
export function initUniverse(stage) {
    var $ = function (sel) { return stage.querySelector(sel); };
    var canvas = $('.uv-canvas');
    var loadingEl = $('.uv-loading'), loadMsg = $('.uv-load-msg'), loadBar = $('.uv-load-bar');
    var fallbackEl = $('.uv-fallback');
    var hudEl = $('.uv-hud');
    var hudDist = $('.uv-hud-dist'), hudSpeed = $('.uv-hud-speed'), hudNear = $('.uv-hud-near');
    var captionEl = $('.uv-caption');
    var labelsEl = $('.uv-labels');
    var tourBtn = $('.uv-tour-btn'), flyBtn = $('.uv-fly-btn');
    var speedInput = $('.uv-speed');
    var moreBtn = $('.uv-more-btn'), panel = $('.uv-panel');
    var searchInput = $('.uv-search'), searchGo = $('.uv-search-go'), dataList = $('.uv-datalist');
    var labelsToggle = $('.uv-labels-toggle'), cloudToggle = $('.uv-cloud-toggle');
    var mouseBtn = $('.uv-mouse-btn'), resetBtn = $('.uv-reset-btn');

    var ctrl = {
        ready: false, active: false, mode: 'free',
        setActive: function (on) {
            ctrl.active = !!on;
            if (ctrl.active && ctrl.ready && !rafId) { lastT = performance.now(); rafId = requestAnimationFrame(frame); }
            if (!ctrl.active && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        },
        getState: function () {
            return {
                ready: ctrl.ready, mode: ctrl.mode,
                camPos: [camPos.x, camPos.y, camPos.z],
                speedPc: speedPc(), starCount: data ? data.starCount : 0,
                galCount: data ? data.galCount : 0,
                nearest: nearestName, tourShot: tour.index
            };
        }
    };

    var data = null, renderer = null, scene = null, camera = null;
    var starPoints = null, galNamedPoints = null, galCloudPoints = null, sunPoints = null;
    var glowFine = null, glowBroad = null;
    var solarGroup = null, solarBodies = null;
    var sysSurf = Infinity, sysRad = 0;   /* nearest solar-body surface distance + that body's radius */
    var sysBodyPos = null;                /* nearest solar body's centre (approach governor) */
    var govTmp = new THREE.Vector3();
    var labelFwd = new THREE.Vector3();   /* camera forward, for the label behind-camera cull */
    var rafId = 0, lastT = 0;
    var camPos = new THREE.Vector3();
    var yaw = 0, pitch = 0;
    var F0 = null;             /* initial forward = toward the galactic center */
    var keys = {};
    var thrust = false, dragging = false;
    var lastInputT = 0;        /* last deliberate input — drives the idle drift */
    var speedT = 0.373;        /* ~2.5 pc/s default */
    var labelsOn = true;
    var nearestName = '', nearestDist = Infinity;
    var flyAnim = null;        /* jump-to flight */
    var tour = { on: false, index: 0, t: 0, dwell: 0, keys: [] };
    var pointers = new Map();
    var pinchDist = 0;
    var dprCap = Math.min(window.devicePixelRatio || 1, 4);
    var dprLevel = 0;          /* index into DPR_STEPS */
    var frameAcc = 0, frameN = 0;
    var DPR_STEPS = [1, 0.85, 0.7, 0.55, 0.4];
    var labelPool = [];
    var tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpM = new THREE.Matrix4();

    function speedPc() {
        return Math.pow(10, -2.7 + speedT * 8.3);   /* 0.002 .. 400,000 pc/s */
    }
    function setCaption(text) {
        if (captionEl.textContent !== text) captionEl.textContent = text;
    }

    /* ---------------- data load ---------------- */
    function loadData() {
        var url = new URL('./universe-data.bin', import.meta.url);
        return fetch(url).then(function (resp) {
            if (!resp.ok) throw new Error('data fetch ' + resp.status);
            var total = parseInt(resp.headers.get('Content-Length') || '0', 10);
            if (!resp.body || !resp.body.getReader) return resp.arrayBuffer();
            var reader = resp.body.getReader();
            var chunks = [], got = 0;
            function pump() {
                return reader.read().then(function (r) {
                    if (r.done) {
                        var buf = new Uint8Array(got), o = 0;
                        chunks.forEach(function (c) { buf.set(c, o); o += c.length; });
                        return buf.buffer;
                    }
                    chunks.push(r.value); got += r.value.length;
                    if (total) {
                        var pct = Math.round(got / total * 100);
                        loadBar.style.width = pct + '%';
                        loadMsg.textContent = 'Loading the real universe — ' + pct + '%';
                    }
                    return pump();
                });
            }
            return pump();
        }).then(function (buf) {
            loadMsg.textContent = 'Reading the star catalog…';
            return new Promise(function (res) {
                setTimeout(function () { res(parseUniverseData(buf)); }, 30);
            });
        });
    }

    /* ---------------- starlight glow ----------------
       The sky in the reference has no empty black in it: it is lit
       where stars crowd and dark where they do not, like folded
       fabric. That texture is baked here from the catalog itself —
       every star's real light (10^-0.4·M from its absolute magnitude)
       is summed into the cell of space it occupies, and each occupied
       cell gets one large, very faint sprite at the light-weighted
       centre of its stars, tinted by their light-weighted colour.
       No light appears where no stars are mapped; nothing external
       is brought in. Two scales of the same bake: a fine grain and a
       broad wash for the large tonal variation along the plane. */
    function buildGlowLayer(cell, diamMul, alphaMax) {
        var map = new Map();
        for (var i = 0; i < data.starCount; i++) {
            var x = data.starPos[i * 3], y = data.starPos[i * 3 + 1], z = data.starPos[i * 3 + 2];
            var key = Math.floor(x / cell) + ':' + Math.floor(y / cell) + ':' + Math.floor(z / cell);
            var L = Math.pow(10, -0.4 * data.starAbsMag[i]);
            var c = map.get(key);
            if (!c) { c = { L: 0, x: 0, y: 0, z: 0, ci: 0 }; map.set(key, c); }
            c.L += L; c.x += x * L; c.y += y * L; c.z += z * L; c.ci += data.starCi[i] * L;
        }
        var cells = Array.from(map.values());
        var n = cells.length;
        var pos = new Float32Array(n * 3), w = new Float32Array(n),
            ci = new Float32Array(n), dia = new Float32Array(n);
        var logs = new Float32Array(n), maxLog = 0;
        for (var j = 0; j < n; j++) {
            logs[j] = Math.log10(1 + cells[j].L);
            if (logs[j] > maxLog) maxLog = logs[j];
        }
        for (var k = 0; k < n; k++) {
            var cc = cells[k];
            pos[k * 3] = cc.x / cc.L; pos[k * 3 + 1] = cc.y / cc.L; pos[k * 3 + 2] = cc.z / cc.L;
            w[k] = maxLog > 0 ? logs[k] / maxLog : 0;
            ci[k] = cc.ci / cc.L;
            dia[k] = cell * diamMul;
        }
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aW', new THREE.BufferAttribute(w, 1));
        g.setAttribute('aCiW', new THREE.BufferAttribute(ci, 1));
        g.setAttribute('aDiam', new THREE.BufferAttribute(dia, 1));
        var m = new THREE.ShaderMaterial({
            vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
            uniforms: {
                uScaleH: { value: 1 }, uDpr: { value: 1 },
                uTime: { value: 0 }, uAlpha: { value: alphaMax }
            },
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        var pts = new THREE.Points(g, m);
        pts.frustumCulled = false;
        return pts;
    }

    /* ---------------- the solar system ----------------
       The catalog's frame reaches down to the Sun, but the planets
       were never in it — Earth was not a place you could go. These
       nine bodies are placed at their true heliocentric positions
       for 2026-11-18 12:00 UTC, computed from JPL's approximate
       Keplerian elements (Standish, Table 1) into this game's
       equatorial J2000 frame. Distances and directions are true;
       sizes are not — at true size the planets would be invisible
       points, so each planet is drawn 1,000x its real radius and
       the Sun 40x (at 1,000x the Sun would swallow the inner
       orbits). Planet-to-planet size ratios stay true. Surface
       textures: NASA (Earth) and Solar System Scope (CC BY 4.0).
       North poles point in their true IAU J2000 directions. */
    var SOLAR_BODIES = [
        /* n, position [pc], drawn radius [pc], texture, pole RA h / Dec deg (IAU J2000) */
        { n: 'Sun',     p: [0, 0, 0],                                  r: 9.019e-7, tex: 'sun.jpg',     pole: [19.074, 63.87], sun: true },
        { n: 'Mercury', p: [-9.467426e-7, 1.078693e-6, 6.743610e-7],   r: 7.906e-8, tex: 'mercury.jpg', pole: [18.734, 61.45] },
        { n: 'Venus',   p: [1.136007e-6, 3.040495e-6, 1.296272e-6],    r: 1.961e-7, tex: 'venus.jpg',   pole: [18.184, 67.16] },
        { n: 'Earth',   p: [2.695043e-6, 3.635981e-6, 1.576126e-6],    r: 2.065e-7, tex: 'earth.jpg',   pole: [0, 90], atmo: true },
        { n: 'Mars',    p: [-2.500337e-6, 6.705219e-6, 3.142969e-6],   r: 1.098e-7, tex: 'mars.jpg',    pole: [21.179, 52.89] },
        { n: 'Jupiter', p: [-1.824027e-5, 1.659686e-5, 7.557852e-6],   r: 2.266e-6, tex: 'jupiter.jpg', pole: [17.871, 64.49] },
        { n: 'Saturn',  p: [4.454207e-5, 9.860811e-6, 2.155511e-6],    r: 1.887e-6, tex: 'saturn.jpg',  pole: [2.706, 83.54], ring: true },
        { n: 'Uranus',  p: [4.245438e-5, 7.723189e-5, 3.322443e-5],    r: 8.219e-7, tex: 'uranus.jpg',  pole: [5.154, 15.18] },
        { n: 'Neptune', p: [1.446138e-4, 8.184898e-6, -2.500514e-7],   r: 7.979e-7, tex: 'neptune.jpg', pole: [19.957, 43.46] }
    ];
    var ATMO_VERT = [
        'varying vec3 vN;',
        'void main() {',
        '    vN = normalize(normalMatrix * normal);',
        '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
    ].join('\n');
    var ATMO_FRAG = [
        'precision mediump float;',
        'varying vec3 vN;',
        'void main() {',
        /* BackSide shell: brightness peaks at the limb and falls off
           outward — a thin rim of scattered light, nothing more. */
        '    float i = pow(max(0.0, 0.72 - dot(vN, vec3(0.0, 0.0, 1.0))), 3.5);',
        '    gl_FragColor = vec4(0.35, 0.58, 1.0, 1.0) * i * 0.9;',
        '}'
    ].join('\n');
    function buildSolarSystem() {
        solarGroup = new THREE.Group();
        var loader = new THREE.TextureLoader();
        var maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        /* sunlight from the Sun's own position; decay 0 — the light
           does not fade across 30 AU, so every planet's day side
           reads by its texture, and a whisper of ambient keeps night
           sides from going pitch black. */
        var light = new THREE.PointLight(0xffffff, 5.2, 0, 0);   /* exposure: physical light units divide by pi, and ocean albedo is near-black in linear space — 1.6 left the day side unreadable */
        solarGroup.add(light);
        solarGroup.add(new THREE.AmbientLight(0xffffff, 0.22));
        solarBodies = [];
        SOLAR_BODIES.forEach(function (b) {
            var pos = new THREE.Vector3(b.p[0], b.p[1], b.p[2]);
            var grp = new THREE.Group();
            grp.position.copy(pos);
            /* the sphere's texture pole (+Y) onto the body's true
               IAU J2000 north-pole direction */
            grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), equatorial(b.pole[0], b.pole[1]));
            var mat = b.sun
                ? new THREE.MeshBasicMaterial({ color: 0xffdd88 })
                : new THREE.MeshLambertMaterial({ color: 0x888888 });
            var tex = loader.load(new URL('./planets/' + b.tex, import.meta.url).href,
                function () { mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true; });
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = maxAniso;
            grp.add(new THREE.Mesh(new THREE.SphereGeometry(b.r, 48, 32), mat));
            if (b.ring) {
                var rIn = b.r * 1.24, rOut = b.r * 2.27;   /* the real ring span, in Saturn radii */
                var rg = new THREE.RingGeometry(rIn, rOut, 128, 1);
                /* RingGeometry UVs are planar; remap them radially so
                   the strip texture reads inner edge to outer edge. */
                var rp = rg.attributes.position, ruv = rg.attributes.uv;
                for (var i = 0; i < rp.count; i++) {
                    var rad = Math.hypot(rp.getX(i), rp.getY(i));
                    ruv.setXY(i, (rad - rIn) / (rOut - rIn), 0.5);
                }
                var rmat = new THREE.MeshBasicMaterial({
                    color: 0xcfc4ae, transparent: true, side: THREE.DoubleSide, depthWrite: false
                });
                var rtex = loader.load(new URL('./planets/saturn-ring.png', import.meta.url).href,
                    function () { rmat.map = rtex; rmat.color.set(0xffffff); rmat.needsUpdate = true; });
                rtex.colorSpace = THREE.SRGBColorSpace;
                var ring = new THREE.Mesh(rg, rmat);
                ring.rotation.x = Math.PI / 2;   /* into the group's equatorial plane */
                grp.add(ring);
            }
            if (b.atmo) {
                grp.add(new THREE.Mesh(
                    new THREE.SphereGeometry(b.r * 1.22, 48, 32),
                    new THREE.ShaderMaterial({
                        vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
                        blending: THREE.AdditiveBlending, side: THREE.BackSide,
                        transparent: true, depthWrite: false
                    })));
            }
            solarGroup.add(grp);
            solarBodies.push({ n: b.n, pos: pos, r: b.r, grp: grp });
        });
        scene.add(solarGroup);
    }

    /* ---------------- scene build ---------------- */
    function buildScene() {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'high-performance' });
        renderer.setClearColor(0x04070e, 1);
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(55, 1, 0.0001, 3e9);
        camera.up.copy(GAL_NORTH);

        /* stars */
        var sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(data.starPos, 3));
        sg.setAttribute('aAbsMag', new THREE.BufferAttribute(data.starAbsMag, 1));
        sg.setAttribute('aCi', new THREE.BufferAttribute(data.starCi, 1));
        /* Shimmer phase per star, baked on the CPU: the same stable
           hash of the star's real position the shader used to compute
           per-vertex per-frame — identical values, a fraction of the
           vertex cost (software renderers feel every transcendental). */
        var phaseArr = new Float32Array(data.starCount);
        for (var pi = 0; pi < data.starCount; pi++) {
            var ps = Math.sin(data.starPos[pi * 3] * 12.9898
                + data.starPos[pi * 3 + 1] * 78.233
                + data.starPos[pi * 3 + 2] * 37.719) * 43758.5453;
            phaseArr[pi] = ps - Math.floor(ps);
        }
        sg.setAttribute('aPhase', new THREE.BufferAttribute(phaseArr, 1));
        var sm = new THREE.ShaderMaterial({
            vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
            uniforms: { uScaleH: { value: 1 }, uDpr: { value: 1 }, uTime: { value: 0 } },
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        starPoints = new THREE.Points(sg, sm);
        starPoints.frustumCulled = false;
        scene.add(starPoints);

        /* galaxies — named set and redshift cloud as separate clouds so the
           cloud can be toggled without touching the named set. The named
           set was baked first (indices 0..namedGalCount-1). */
        function galPoints(from, to, halo) {
            var n = to - from;
            var g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(data.galPos.slice(from * 3, to * 3), 3));
            g.setAttribute('aMajor', new THREE.BufferAttribute(data.galMajor.slice(from * 3, to * 3), 3));
            g.setAttribute('aDiam', new THREE.BufferAttribute(data.galDiam.slice(from, to), 1));
            var axis = new Float32Array(n), bright = new Float32Array(n), tint = new Float32Array(n);
            var seed = new Float32Array(n);
            for (var i = 0; i < n; i++) {
                axis[i] = data.galAxis[from + i] / 255;
                bright[i] = data.galBright[from + i] / 255;
                tint[i] = data.galTint[from + i];
                /* Deterministic per-galaxy seed (golden-ratio hash of the
                   catalog index) — varies spiral arm phase and irregular
                   clump placement without inventing catalog data. */
                var sh = (from + i + 1) * 0.61803398875;
                seed[i] = sh - Math.floor(sh);
            }
            g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 1));
            g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
            g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
            g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
            var m = new THREE.ShaderMaterial({
                vertexShader: GAL_VERT, fragmentShader: GAL_FRAG,
                uniforms: { uScaleH: { value: 1 }, uDpr: { value: 1 }, uHalo: { value: halo } },
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
            });
            var pts = new THREE.Points(g, m);
            pts.frustumCulled = false;
            return pts;
        }
        galNamedPoints = galPoints(0, data.namedGalCount, 1.0);
        galCloudPoints = galPoints(data.namedGalCount, data.galCount, 0.0);
        scene.add(galNamedPoints); scene.add(galCloudPoints);

        /* the Sun — one extra point at the origin, run through the star
           shader with the Sun's real absolute magnitude (4.83), so it
           blazes at home ranges, fades like any star as you leave, and
           never engulfs the camera. */
        var sunG = new THREE.BufferGeometry();
        sunG.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
        sunG.setAttribute('aAbsMag', new THREE.BufferAttribute(new Float32Array([4.83]), 1));
        sunG.setAttribute('aCi', new THREE.BufferAttribute(new Float32Array([0.35]), 1));
        sunG.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array([0.3]), 1));
        sunPoints = new THREE.Points(sunG, sm);
        sunPoints.frustumCulled = false;
        scene.add(sunPoints);

        /* starlight glow — the broad wash first, then the fine grain
           (additive blending makes the order immaterial; the layering
           reads broad-to-fine). */
        glowBroad = buildGlowLayer(380, 1.8, 0.050);
        glowFine = buildGlowLayer(110, 3.0, 0.060);
        scene.add(glowBroad); scene.add(glowFine);

        /* the solar system — textured worlds at true positions */
        buildSolarSystem();

        /* label pool */
        for (var i = 0; i < 14; i++) {
            var d = document.createElement('div');
            d.className = 'uv-label';
            d.style.display = 'none';
            labelsEl.appendChild(d);
            labelPool.push(d);
        }
        /* search list */
        var frag = document.createDocumentFragment();
        data.named.forEach(function (e) {
            var o = document.createElement('option');
            o.value = e.n;
            frag.appendChild(o);
        });
        SOLAR_BODIES.forEach(function (b) {
            var o = document.createElement('option');
            o.value = b.n;
            frag.appendChild(o);
        });
        dataList.appendChild(frag);

        buildTour();
        resetView(true);
        resize();
    }

    function namedEntry(name) {
        for (var i = 0; i < data.named.length; i++)
            if (data.named[i].n === name) return data.named[i];
        return null;
    }
    function entryPos(e) { return tmpV.set(e._pos[0], e._pos[1], e._pos[2]); }

    /* ---------------- tour ---------------- */
    function buildTour() {
        var sun = new THREE.Vector3(0, 0, 0);
        var gcDir = entryPos(namedEntry('Center of the Milky Way')).clone().normalize();
        F0 = gcDir.clone();
        var lmc = entryPos(namedEntry('Large Magellanic Cloud')).clone();
        var m31 = entryPos(namedEntry('Andromeda Galaxy')).clone();
        var m87 = entryPos(namedEntry('M87 · heart of the Virgo Cluster')).clone();
        var mid = sun.clone().add(m31).multiplyScalar(0.5);
        function approach(target, backPc, upPc) {
            var away = target.clone().multiplyScalar(-1).normalize(); /* toward Sun side */
            return target.clone().add(away.multiplyScalar(backPc)).add(GAL_NORTH.clone().multiplyScalar(upPc));
        }
        var start = gcDir.clone().multiplyScalar(-0.0016).add(GAL_NORTH.clone().multiplyScalar(0.0005));
        tour.keys = [
            { pos: start, tgt: gcDir.clone().multiplyScalar(100), dur: 0, cap: '' },
            { pos: GAL_NORTH.clone().multiplyScalar(14).add(gcDir.clone().multiplyScalar(-6)), tgt: sun, dur: 11,
              cap: 'The Sun\u2019s neighborhood. Every star of your night sky is here \u2014 Sirius, Alpha Centauri, a few hundred more \u2014 each at its true distance.' },
            { pos: GAL_NORTH.clone().multiplyScalar(260).add(gcDir.clone().multiplyScalar(90)), tgt: sun, dur: 13,
              cap: 'A hundred thousand mapped stars. This is our patch of the Milky Way\u2019s disk \u2014 the full galaxy spans 100,000 light-years, and the catalog charts the part around the Sun.' },
            { pos: approach(lmc, 9000, 2600), tgt: lmc, dur: 15,
              cap: 'The Large Magellanic Cloud \u2014 a companion galaxy 163,000 light-years away. From the southern hemisphere you can see it with the naked eye.' },
            { pos: approach(m31, 65000, 22000), tgt: m31, dur: 16,
              cap: 'Andromeda \u2014 2.5 million light-years away, bigger than the Milky Way, and slowly coming toward us. In a few billion years the two will merge.' },
            { pos: mid.clone().add(GAL_NORTH.clone().multiplyScalar(1150000)), tgt: mid, dur: 14,
              cap: 'The Local Group: Andromeda, the Milky Way, Triangulum and dozens of dwarf galaxies, all bound together by gravity.' },
            { pos: approach(m87, 2600000, 1100000), tgt: m87, dur: 15,
              cap: 'The Virgo Cluster \u2014 over a thousand galaxies, 54 million light-years away. Our Local Group is slowly falling toward it.' },
            { pos: m87.clone().multiplyScalar(2.3).add(GAL_NORTH.clone().multiplyScalar(9000000)), tgt: sun, dur: 15,
              cap: 'Out here every point of light is a whole galaxy. The mapped cloud runs hundreds of millions of light-years deep \u2014 and this is still only the nearby universe.' },
            { pos: start, tgt: gcDir.clone().multiplyScalar(100), dur: 17,
              cap: 'Home again. Everything you flew past is real \u2014 measured, catalogued, and set at its true position.' }
        ];
        /* initial yaw/pitch: facing the galactic center */
        yaw = 0; pitch = 0;
        camPos.copy(start);
    }
    function smoother(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function logLerpPos(a, b, t, out) {
        /* Interpolate direction by slerp and radius geometrically, so a leg
           spanning parsecs-to-megaparsecs eases at both ends instead of
           spending its whole budget at the far end. Near a target the
           sun-centric arc still lands exactly on the keyframe. */
        var ra = a.length(), rb = b.length();
        if (ra < 1e-9 || rb < 1e-9) { out.copy(a).lerp(b, t); return out; }
        var da = a.clone().normalize(), db = b.clone().normalize();
        var ang = da.angleTo(db);
        var dir;
        if (ang < 1e-6) dir = da;
        else {
            var s = Math.sin(ang);
            dir = da.multiplyScalar(Math.sin((1 - t) * ang) / s)
                .add(db.multiplyScalar(Math.sin(t * ang) / s));
        }
        var r = ra * Math.pow(rb / ra, t);
        return out.copy(dir).multiplyScalar(r);
    }
    function tourFrame(dt) {
        var keys = tour.keys;
        var cur = keys[tour.index], nxt = keys[tour.index + 1];
        if (!nxt) { stopTour(); return; }
        if (tour.dwell > 0) {
            tour.dwell -= dt;
            camPos.copy(cur.pos);
            setViewFromTarget(cur.tgt);
            if (tour.dwell <= 0) setCaption(nxt.cap);
            return;
        }
        tour.t += dt / nxt.dur;
        if (tour.t >= 1) {
            tour.t = 0; tour.index++;
            camPos.copy(nxt.pos);
            setViewFromTarget(nxt.tgt);
            if (tour.index >= keys.length - 1) { stopTour(true); return; }
            tour.dwell = 2.2;
            return;
        }
        var t = smoother(tour.t);
        logLerpPos(cur.pos, nxt.pos, t, camPos);
        logLerpPos(cur.tgt, nxt.tgt, t, tmpV2);
        setViewFromTarget(tmpV2);
    }
    function setViewFromTarget(tgt) {
        tmpV.copy(tgt).sub(camPos);
        if (tmpV.lengthSq() < 1e-18) return;   /* was 1e-12: written for parsec-scale targets, it silently skipped aiming at the small planets (Mars standoff² ≈ 2e-13), leaving the view pointing wherever it had been */
        tmpV.normalize();
        /* keep yaw/pitch in sync so free flight continues seamlessly */
        var f = tmpV;
        pitch = Math.asin(Math.max(-1, Math.min(1, f.dot(GAL_NORTH))));
        var fx = f.clone().sub(GAL_NORTH.clone().multiplyScalar(Math.sin(pitch)));
        if (fx.lengthSq() > 1e-9) {
            fx.normalize();
            var rAxis = new THREE.Vector3().crossVectors(F0, GAL_NORTH).normalize();
            yaw = Math.atan2(fx.dot(rAxis), fx.dot(F0));
        }
        applyView();
    }
    function forwardVec() {
        var rAxis = new THREE.Vector3().crossVectors(F0, GAL_NORTH).normalize();
        return F0.clone().multiplyScalar(Math.cos(yaw) * Math.cos(pitch))
            .add(rAxis.multiplyScalar(Math.sin(yaw) * Math.cos(pitch)))
            .add(GAL_NORTH.clone().multiplyScalar(Math.sin(pitch)))
            .normalize();
    }
    function applyView() {
        var f = forwardVec();
        tmpM.lookAt(new THREE.Vector3(0, 0, 0), f, GAL_NORTH);
        camera.quaternion.setFromRotationMatrix(tmpM);
        camera.position.copy(camPos);
    }
    function startTour(resume) {
        if (!ctrl.ready) return;
        tour.on = true; ctrl.mode = 'tour';
        if (!resume) { tour.index = 0; tour.t = 0; tour.dwell = 0; camPos.copy(tour.keys[0].pos); }
        tourBtn.textContent = '\u25A0 Stop the tour';
        setCaption(tour.keys[Math.min(tour.index + 1, tour.keys.length - 1)].cap ||
            'The tour is flying. Grab the view any time to take over.');
    }
    function stopTour(finished) {
        tour.on = false; ctrl.mode = 'free';
        tourBtn.textContent = '\u25B6 Resume the tour';
        if (finished) {
            tour.index = 0; tour.t = 0;
            tourBtn.textContent = '\u25B6 Fly the tour';
            setCaption('That is the tour. Fly anywhere you like \u2014 drag to look, hold Fly (or W) to move.');
        }
    }
    function interruptTour() {
        lastInputT = performance.now();
        if (tour.on) {
            stopTour(false);
            setCaption('You have the controls. Drag to look around; hold Fly \u2014 or press W \u2014 to move.');
        }
        flyAnim = null;
    }

    /* ---------------- free flight ---------------- */
    /* Idle drift: left alone in free flight for a few seconds, the
       view turns very slowly and breathes a little in pitch — the
       scene feels alive standing still, the way the reference video
       never sits flat. Any deliberate input stops it instantly:
       interruptTour stamps lastInputT, as do drags and the speed
       control. It never runs during the tour, a jump-to flight, a
       drag, a pinch, or while any flight key is held. */
    function idleDrift(now, dt) {
        if (dragging || thrust || pointers.size > 0) return;
        for (var k in keys) if (keys[k]) return;
        if (now - lastInputT < 6000) return;
        yaw += dt * 0.0055;
        pitch = Math.max(-1.45, Math.min(1.45, pitch + Math.sin(now * 0.00013) * dt * 0.004));
    }
    function flyFrame(dt) {
        var move = new THREE.Vector3();
        var f = forwardVec();
        var rAxis = new THREE.Vector3().crossVectors(f, GAL_NORTH).normalize();
        if (keys['KeyW'] || keys['ArrowUp'] || thrust) move.add(f);
        if (keys['KeyS'] || keys['ArrowDown']) move.sub(f);
        if (keys['KeyD'] || keys['ArrowRight']) move.add(rAxis);
        if (keys['KeyA'] || keys['ArrowLeft']) move.sub(rAxis);
        if (keys['KeyR'] || keys['KeyE']) move.add(GAL_NORTH);
        if (keys['KeyF'] || keys['KeyQ']) move.sub(GAL_NORTH);
        if (move.lengthSq() > 0) {
            var sp = speedPc();
            /* Approach governor: for EVERY body the camera is clearly
               heading at and is close to, the approach slows as that
               surface nears and never slams (the tightest cap wins).
               Per-body, not just the nearest: on 2026-11-18 Venus sits
               0.35 AU from Earth and an Earth arrival is nearer Venus's
               surface than Earth's — a nearest-only governor left the
               Earth approach uncapped and W flew straight through the
               planet. Departures and flybys are never capped (the dot
               test fails for them), so leaving any planet is instant. */
            if (solarBodies) {
                for (var gb = 0; gb < solarBodies.length; gb++) {
                    var gSurf = camPos.distanceTo(solarBodies[gb].pos) - solarBodies[gb].r;
                    if (gSurf < 100 * solarBodies[gb].r) {
                        govTmp.copy(solarBodies[gb].pos).sub(camPos).normalize();
                        if (govTmp.dot(f) > 0.5) {
                            sp = Math.min(sp, 0.6 * Math.max(gSurf, 1e-12));
                        }
                    }
                }
            }
            move.normalize().multiplyScalar(sp * dt);
            camPos.add(move);
        }
        applyView();
    }
    function flyTo(entry) {
        var target = entryPos(entry).clone();
        var standoff;
        if (entry.k === 1) standoff = Math.max(data.galDiam[entry.i] * 1.5, 2500);
        else if (entry.k === 2 && entry.n === 'The Sun') standoff = 0.0016;
        else if (entry.k === 2) standoff = 2600;
        else standoff = 0.03;
        var away = camPos.clone().sub(target);
        if (away.lengthSq() < 1e-12) away.set(1, 0.3, 0.2);
        away.normalize();
        var dest = target.clone().add(away.multiplyScalar(standoff))
            .add(GAL_NORTH.clone().multiplyScalar(standoff * 0.22));
        flyAnim = { from: camPos.clone(), to: dest, target: target, t: 0, dur: 3.0 };
        ctrl.mode = 'jump';
        setCaption('Flying to ' + entry.n + '\u2026 grab the view to take over.');
    }
    function flyToSolar(b) {
        var target = new THREE.Vector3(b.p[0], b.p[1], b.p[2]);
        var standoff = b.r * 4.5;
        var away = camPos.clone().sub(target);
        if (away.lengthSq() < 1e-12) away.set(1, 0.3, 0.2);
        away.normalize();
        /* Arrive mostly from the Sun's side, so the visitor meets the
           planet's lit face — its detail — with a slice of terminator
           for depth, instead of landing on the night side. */
        if (target.length() > 1e-9) {
            var sunward = target.clone().multiplyScalar(-1).normalize();
            away.multiplyScalar(0.35).add(sunward).normalize();
        }
        var dest = target.clone().add(away.multiplyScalar(standoff))
            .add(GAL_NORTH.clone().multiplyScalar(standoff * 0.30));
        flyAnim = { from: camPos.clone(), to: dest, target: target, t: 0, dur: 3.2 };
        ctrl.mode = 'jump';
        setCaption('Flying to ' + b.n + '\u2026 grab the view to take over.');
    }
    function flyAnimFrame(dt) {
        flyAnim.t += dt / flyAnim.dur;
        if (flyAnim.t >= 1) {
            camPos.copy(flyAnim.to);
            setViewFromTarget(flyAnim.target);
            flyAnim = null; ctrl.mode = 'free';
            setCaption('You are looking at the marked object. Drag to look around; hold Fly \u2014 or press W \u2014 to move.');
            return;
        }
        var t = smoother(flyAnim.t);
        logLerpPos(flyAnim.from, flyAnim.to, t, camPos);
        setViewFromTarget(flyAnim.target);
    }
    function resetView(instant) {
        var start = tour.keys[0];
        if (instant) {
            camPos.copy(start.pos); yaw = 0; pitch = 0; applyView();
            return;
        }
        flyAnim = { from: camPos.clone(), to: start.pos.clone(), target: new THREE.Vector3(0, 0, 0), t: 0, dur: 2.6 };
        ctrl.mode = 'jump';
    }

    /* ---------------- HUD / labels ---------------- */
    function updateNearest() {
        var best = Infinity, bi = -1;
        var np = data.namedPos;
        for (var i = 0; i < data.named.length; i++) {
            var dx = np[i * 3] - camPos.x, dy = np[i * 3 + 1] - camPos.y, dz = np[i * 3 + 2] - camPos.z;
            var d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < best) { best = d2; bi = i; }
        }
        if (solarBodies && camPos.length() < 0.01) {
            for (var j = 0; j < solarBodies.length; j++) {
                var sp2 = solarBodies[j].pos;
                var sdx = sp2.x - camPos.x, sdy = sp2.y - camPos.y, sdz = sp2.z - camPos.z;
                var sdq = sdx * sdx + sdy * sdy + sdz * sdz;
                if (sdq < best) { best = sdq; bi = -2 - j; }
            }
        }
        nearestDist = Math.sqrt(best);
        nearestName = bi >= 0 ? data.named[bi].n : (bi <= -2 ? solarBodies[-bi - 2].n : '');
        hudNear.textContent = nearestName ? ('Nearest: ' + nearestName + ' \u2014 ' + fmtDist(nearestDist)) : '';
    }
    var labelTick = 0;
    function updateLabels(w, h) {
        if (!labelsOn) { labelPool.forEach(function (d) { d.style.display = 'none'; }); return; }
        var cands = [];
        /* project() mirrors points behind the camera back into the
           frame with plausible-looking NDC — cull by the view
           direction itself, or a body behind you labels the planet
           in front of you. */
        camera.getWorldDirection(labelFwd);
        for (var i = 0; i < data.named.length; i++) {
            var e = data.named[i];
            if (!e.l) continue;
            var p = e._pos;
            var dx = p[0] - camPos.x, dy = p[1] - camPos.y, dz = p[2] - camPos.z;
            var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dx * labelFwd.x + dy * labelFwd.y + dz * labelFwd.z <= 0) continue;
            var eff;
            if (e.k === 0) {
                var mag = data.starMag[e.i];
                eff = dist * Math.pow(10, 0.16 * mag);
                if (dist < 0.0015) continue;
            } else if (e.k === 1) {
                eff = dist / (data.galDiam[e.i] / 12000);
                if (dist < data.galDiam[e.i] * 0.4) continue;
            } else {
                eff = dist * 0.6;
                if (dist < 0.0012) continue;
            }
            tmpV.set(p[0], p[1], p[2]).project(camera);
            if (tmpV.z > 1 || tmpV.z < -1) continue;
            var sx = (tmpV.x * 0.5 + 0.5) * w, sy = (-tmpV.y * 0.5 + 0.5) * h;
            if (sx < -40 || sx > w + 40 || sy < -20 || sy > h + 20) continue;
            cands.push({ e: e, sx: sx, sy: sy, eff: eff, dist: dist });
        }
        /* solar-system bodies label too, while you are in their
           neighbourhood — same pool, same placement rules */
        if (solarBodies && camPos.length() < 0.05) {
            for (var s2 = 0; s2 < solarBodies.length; s2++) {
                var sb2 = solarBodies[s2];
                var sdx2 = sb2.pos.x - camPos.x, sdy2 = sb2.pos.y - camPos.y, sdz2 = sb2.pos.z - camPos.z;
                var sdist = Math.sqrt(sdx2 * sdx2 + sdy2 * sdy2 + sdz2 * sdz2);
                if (sdx2 * labelFwd.x + sdy2 * labelFwd.y + sdz2 * labelFwd.z <= 0) continue;
                if (sdist < sb2.r * 1.5) continue;
                tmpV.copy(sb2.pos).project(camera);
                if (tmpV.z > 1 || tmpV.z < -1) continue;
                var ssx = (tmpV.x * 0.5 + 0.5) * w, ssy = (-tmpV.y * 0.5 + 0.5) * h;
                if (ssx < -40 || ssx > w + 40 || ssy < -20 || ssy > h + 20) continue;
                cands.push({ e: { n: sb2.n }, sx: ssx, sy: ssy, eff: sdist * 0.4, dist: sdist });
            }
        }
        cands.sort(function (a, b) { return a.eff - b.eff; });
        /* Greedy de-collision in rank order: a label that would overlap
           one already placed (or slide under the caption) is hidden
           instead — a missing label beats two unreadable ones. */
        var placed = [];
        /* Obstacles measured with getBoundingClientRect: the caption is
           centered with a transform, which offsetLeft does not see. */
        var boxR = labelsEl.getBoundingClientRect();
        [captionEl, hudEl].forEach(function (o) {
            if (!o || !o.offsetWidth) return;
            var r = o.getBoundingClientRect();
            placed.push({
                x0: r.left - boxR.left - 4, y0: r.top - boxR.top - 4,
                x1: r.right - boxR.left + 4, y1: r.bottom - boxR.top + 4
            });
        });
        var maxLabels = Math.min(12, labelPool.length), used = 0;
        for (var j = 0; j < cands.length && used < maxLabels && j < 48; j++) {
            var c = cands[j];
            var el = labelPool[used];
            el.textContent = c.e.n;
            el.style.display = 'block';
            var lw = el.offsetWidth, lh = el.offsetHeight;
            var x0 = c.sx - lw / 2, y0 = c.sy - lh * 1.4, x1 = x0 + lw, y1 = y0 + lh;
            var hit = false;
            for (var k = 0; k < placed.length; k++) {
                var r = placed[k];
                if (x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0) { hit = true; break; }
            }
            if (hit) { el.style.display = 'none'; continue; }
            placed.push({ x0: x0 - 3, y0: y0 - 3, x1: x1 + 3, y1: y1 + 3 });
            el.style.transform = 'translate(-50%,-140%) translate(' + c.sx.toFixed(1) + 'px,' + c.sy.toFixed(1) + 'px)';
            el.style.opacity = used < 4 ? '0.95' : '0.75';
            used++;
        }
        for (var m = used; m < labelPool.length; m++) labelPool[m].style.display = 'none';
    }

    /* ---------------- main loop ---------------- */
    function frame(now) {
        if (!ctrl.active) { rafId = 0; return; }
        rafId = requestAnimationFrame(frame);
        var dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
        lastT = now;
        /* nearest solar-body surface — feeds the near plane and the
           system-zone speed cap (one frame of lag is fine) */
        sysSurf = Infinity; sysRad = 0;
        if (solarBodies) {
            for (var sb = 0; sb < solarBodies.length; sb++) {
                var sd2 = camPos.distanceTo(solarBodies[sb].pos) - solarBodies[sb].r;
                if (sd2 < sysSurf) { sysSurf = sd2; sysRad = solarBodies[sb].r; sysBodyPos = solarBodies[sb].pos; }
            }
        }
        /* adaptive resolution: if frames run slow, step the pixel ratio
           down; the catalog is light enough that this rarely engages. */
        frameAcc += dt; frameN++;
        if (frameN >= 90) {
            var avg = frameAcc / frameN;
            if (avg > 0.024 && dprLevel < DPR_STEPS.length - 1) { dprLevel++; applyDpr(); }
            frameAcc = 0; frameN = 0;
        }
        if (tour.on) tourFrame(dt);
        else if (flyAnim) flyAnimFrame(dt);
        else { idleDrift(now, dt); flyFrame(dt); }

        /* shader clocks — the star shimmer and the glow's slow
           undulation share the frame's timestamp */
        var tSec = now / 1000;
        if (starPoints) starPoints.material.uniforms.uTime.value = tSec;
        if (glowFine) {
            glowFine.material.uniforms.uTime.value = tSec;
            glowBroad.material.uniforms.uTime.value = tSec;
        }

        /* dynamic clip planes: near/far follow the local scale */
        var alt = camPos.length();
        camera.near = Math.max(1e-6, Math.min(0.05, alt * 1e-4 + 1e-6));
        /* Inside the solar system the alt-based near plane (never
           below 1e-6 pc) would clip a planet's surface long before
           you reach it — a drawn planet radius is ~1e-7 pc. Let the
           nearest body's surface set the near plane instead. */
        if (sysSurf < 0.001) {
            camera.near = Math.min(camera.near, Math.max(1e-9, Math.max(sysSurf, 1e-10) * 0.4));
        }
        camera.far = Math.max(2e9, alt * 30);
        /* the Sun's point sprite hands over to its textured sphere
           once you are close enough for the sphere to be the Sun */
        if (sunPoints) sunPoints.visible = alt > 3e-6;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        hudDist.textContent = 'From the Sun: ' + fmtDist(alt);
        hudSpeed.textContent = 'Speed: ' + fmtSpeed(speedPc());
        labelTick++;
        if (labelTick % 15 === 0) updateNearest();
        var rect = canvas.getBoundingClientRect();
        updateLabels(rect.width, rect.height);
    }
    function applyDpr() {
        /* No floor at 1: on a DPR-1 screen a floor would disable the
           ladder exactly where it is needed most. Trading sharpness for
           smoothness is the ladder's whole job; the DOM HUD stays crisp. */
        var dpr = dprCap * DPR_STEPS[dprLevel];
        renderer.setPixelRatio(dpr);
        resize();
    }
    function resize() {
        if (!renderer) return;
        var box = canvas.parentElement;   /* .uv-stage-box */
        var w = box.clientWidth, h = box.clientHeight;
        if (w < 2 || h < 2) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        var dpr = renderer.getPixelRatio();
        /* uScaleH is in CSS pixels; the shaders multiply by uDpr to reach
           device pixels for gl_PointSize. */
        var scaleH = h * 0.5 * camera.projectionMatrix.elements[5];
        [starPoints, galNamedPoints, galCloudPoints, glowFine, glowBroad].forEach(function (p) {
            if (p) {
                p.material.uniforms.uScaleH.value = scaleH;
                p.material.uniforms.uDpr.value = dpr;
            }
        });
    }

    /* ---------------- events ---------------- */
    function bindEvents() {
        var box = canvas.parentElement;
        if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(box);
        window.addEventListener('resize', resize);

        canvas.addEventListener('pointerdown', function (ev) {
            canvas.setPointerCapture(ev.pointerId);
            pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            if (pointers.size === 2) {
                var pts = Array.from(pointers.values());
                pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            }
            dragging = true;
            interruptTour();
        });
        canvas.addEventListener('pointermove', function (ev) {
            if (!pointers.has(ev.pointerId)) return;
            var prev = pointers.get(ev.pointerId);
            var dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
            pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            if (pointers.size === 2) {
                var pts = Array.from(pointers.values());
                var nd = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                if (pinchDist > 0) setSpeedT(speedT + (nd - pinchDist) * 0.0016);
                pinchDist = nd;
                lastInputT = performance.now();
                return;
            }
            if (!dragging) return;
            lastInputT = performance.now();
            yaw += dx * 0.0032;
            pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.0032));
        });
        function endPointer(ev) {
            pointers.delete(ev.pointerId);
            if (pointers.size === 0) dragging = false;
            pinchDist = 0;
        }
        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
        canvas.addEventListener('wheel', function (ev) {
            ev.preventDefault();
            interruptTour();
            setSpeedT(speedT - Math.sign(ev.deltaY) * 0.045);
        }, { passive: false });

        document.addEventListener('keydown', function (ev) {
            if (!ctrl.active) return;
            var t = ev.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
            if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE',
                 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(ev.code) >= 0) {
                keys[ev.code] = true;
                interruptTour();
                if (ev.code.indexOf('Arrow') === 0) ev.preventDefault();
            }
        });
        document.addEventListener('keyup', function (ev) { keys[ev.code] = false; });

        tourBtn.addEventListener('click', function () {
            lastInputT = performance.now();
            if (tour.on) { stopTour(false); setCaption('Tour stopped. You have the controls.'); }
            else startTour(tour.index > 0);
            tourBtn.blur();
        });
        flyBtn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); interruptTour(); thrust = true; });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) {
            flyBtn.addEventListener(t, function () { thrust = false; });
        });
        speedInput.addEventListener('input', function () { setSpeedT(parseFloat(speedInput.value)); });
        moreBtn.addEventListener('click', function () {
            var open = panel.hidden;
            panel.hidden = !open;
            moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            moreBtn.textContent = open ? 'Fewer controls \u25B4' : 'More controls \u25BE';
            moreBtn.blur();
        });
        function doSearch() {
            var name = searchInput.value.trim();
            if (!name) return;
            for (var i = 0; i < data.named.length; i++) {
                if (data.named[i].n.toLowerCase() === name.toLowerCase()) {
                    interruptTour();
                    flyTo(data.named[i]);
                    return;
                }
            }
            for (var j = 0; j < SOLAR_BODIES.length; j++) {
                if (SOLAR_BODIES[j].n.toLowerCase() === name.toLowerCase()) {
                    interruptTour();
                    flyToSolar(SOLAR_BODIES[j]);
                    return;
                }
            }
            setCaption('No match for \u201C' + name + '\u201D \u2014 try a name from the list as you type.');
        }
        searchGo.addEventListener('click', doSearch);
        searchInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doSearch(); } });
        searchInput.addEventListener('change', doSearch);
        labelsToggle.addEventListener('change', function () { labelsOn = labelsToggle.checked; });
        cloudToggle.addEventListener('change', function () { galCloudPoints.visible = cloudToggle.checked; });
        mouseBtn.addEventListener('click', function () {
            if (document.pointerLockElement === canvas) document.exitPointerLock();
            else canvas.requestPointerLock();
            mouseBtn.blur();
        });
        document.addEventListener('pointerlockchange', function () {
            mouseBtn.textContent = document.pointerLockElement === canvas ? 'Release the mouse' : 'Mouse flight';
        });
        document.addEventListener('mousemove', function (ev) {
            if (document.pointerLockElement !== canvas) return;
            interruptTour();
            yaw += ev.movementX * 0.0021;
            pitch = Math.max(-1.45, Math.min(1.45, pitch + ev.movementY * 0.0021));
        });
        resetBtn.addEventListener('click', function () { interruptTour(); resetView(false); resetBtn.blur(); });
    }
    function setSpeedT(v) {
        speedT = Math.max(0, Math.min(1, v));
        speedInput.value = String(speedT);
        lastInputT = performance.now();
    }

    /* ---------------- boot ---------------- */
    loadMsg.textContent = 'Loading the real universe\u2026';
    loadData().then(function (d) {
        data = d;
        try {
            buildScene();
        } catch (err) {
            loadingEl.hidden = true;
            fallbackEl.hidden = false;
            return;
        }
        bindEvents();
        applyDpr();
        loadingEl.hidden = true;
        ctrl.ready = true;
        lastInputT = performance.now();
        setCaption('You are at the Sun \u2014 home. Every light around you is a real star at its true position. Drag to look \u00B7 hold Fly (or press W) to fly anywhere \u00B7 scroll for speed. The tour is there when you want it.');
        updateNearest();
        if (ctrl.active) { lastT = performance.now(); rafId = requestAnimationFrame(frame); }
        if (window) window.__uv = ctrl;
    }).catch(function (err) {
        loadingEl.hidden = true;
        fallbackEl.hidden = false;
        var p = fallbackEl.querySelector('p');
        if (p) p.textContent = 'The universe could not be loaded (' + err.message + '). Check your connection and try again.';
    });
    return ctrl;
}
