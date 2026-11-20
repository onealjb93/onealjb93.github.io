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
   slightly, and the view drifts very slowly when left alone. The
   bright nebulae ride along as soft coloured glows at their real
   OpenNGC positions and catalogued sizes, on published distances
   (universe-nebulae.json, baked by build_nebulae.py with its
   sources listed); their colours follow the catalogued type and
   their wispy shading is a convention, like the galaxy arms.
   Bright objects bloom — light spilling around the brightest
   stars, nebulae and galaxy cores — the way bright things bloom
   to an eye; the bloom is extracted from the rendered frame
   itself, so nothing blooms that is not bright in the data.
   Earth, alone among the planets, upgrades her own surface when
   you fly in to meet her: NASA's Blue Marble day map, the VIIRS
   night-lights map (city lights on the dark side, lit by the
   same sun that lights the day side), and the Visible Earth
   cloud composite on its own slowly-drifting sphere — all
   public-domain NASA imagery, fetched only on a first approach
   to the solar system and crossfaded over the plainer map, so
   nothing about the game's start changes for anyone who never
   flies in.
   Flight is faster than light — the HUD says by how much.
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
    /* QUALITY PASS: a glow-earning star also grows — up to 45%
       larger — so its halo covers real screen and the brightest
       stars read as orbs, not pinpricks. The 46px cap (a near
       giant must not fill the screen) is unchanged. */
    '    gl_PointSize = clamp(sz * (1.0 + 0.45 * vGlow + 0.05 * vGlow * shim), 2.0, 46.0) * uDpr;',
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
    /* QUALITY PASS: with the HDR final pass the authored colour
       is linearised here and the composite re-encodes it, so the
       frame's response is unchanged — but the core of a bright
       star is driven over the bloom threshold (1.0 in linear
       HDR) in proportion to the glow the star has earned from
       the camera's true distance. Bright stars bloom; the field
       of ordinary stars, whose cores stay under the threshold,
       does not. */
    '#if HDR_LINEAR',
    '    col = pow(max(col, vec3(0.0)), vec3(2.2));',
    '    col *= 1.0 + core * vGlow * 2.8;',
    '#endif',
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
    '    vec3 col = vCol;',
    '#if HDR_LINEAR',
    '    col = pow(max(col, vec3(0.0)), vec3(2.2));',
    '#endif',
    '    gl_FragColor = vec4(col, a);',
    '}'
].join('\n');
var GAL_VERT = [
    'attribute vec3 aPos;',
    'attribute vec3 aMajor;',
    'attribute float aDiam;',
    'attribute float aAxis;',
    'attribute float aBright;',
    'attribute float aTint;',
    'attribute float aSeed;',
    'uniform float uScaleH;',
    'uniform mediump float uHalo;',   /* mediump: must match the fragment stage's precision or strict drivers reject the program */
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vAng;',
    'varying float vAxis;',
    'varying float vTint;',
    'varying float vSeed;',
    'varying float vDetail;',
    'varying vec2 vQ;',
    'void main() {',
    '    vec4 mv = modelViewMatrix * vec4(aPos, 1.0);',
    '    float dist = max(1.0, -mv.z);',
    '    float px = aDiam * uScaleH / dist;',   /* true angular size */
    /* Billboarded quad, not a GL point (graphics fix, 2026-11-19):
       points are square and size-capped — 460 CSS px in the old code
       and far less in phone hardware — so a galaxy you flew toward
       froze as a flat square card, and the profile, which never
       reaches zero inside the square, printed a straight rim around
       every galaxy big enough to see (Johnny's Sagittarius Dwarf
       screenshot). The quad spans 1.5x the profile diameter — the
       true catalogued diameter, or the old point-size floor in world
       units when the true size is below it — so vQ is in profile
       units (0.5 = the catalogued edge) and the fragment profile
       always fades to zero well inside the quad, at any distance,
       with no size ceiling. position is the quad corner (+/-0.5). */
    '    float profD = max(aDiam, mix(2.6, 2.0, uHalo) * dist / uScaleH);',
    '    mv.xy += position.xy * (profD * 1.5);',
    '    vQ = position.xy * 1.5;',
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
    'varying vec2 vQ;',
    'void main() {',
    '    vec2 q = vQ;',                          /* profile units: 0.5 = catalogued edge; the quad reaches 0.75 */
    '    float ca = cos(vAng), sa = sin(vAng);',
    '    vec2 r = mat2(ca, -sa, sa, ca) * q;',   /* into the galaxy frame */
    '    r.y /= max(0.10, vAxis);',              /* undo the tilt squeeze */
    '    float d = length(r) * 2.0;',            /* 1.0 = catalogued edge */
    '    if (d > 1.52) discard;',                /* outside the feather — keeps the padded quad cheap */
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
    /* The feather: the exponentials above still carry light at the
       catalogued edge (~0.10 for a named elliptical), which is what
       printed the old square rim where the point sprite cut them
       off. The window takes the profile to exactly zero by d = 1.5,
       the quad's own edge, so no straight edge can ever show. */
    '    lum *= 1.0 - smoothstep(1.28, 1.5, d);',
    '    float a = clamp(lum, 0.0, 1.0) * vAlpha;',
    '    if (a < 0.004) discard;',
    /* QUALITY PASS: same HDR treatment as the stars — the
       authored colour linearises, and a core multiplier driven
       by the galaxy's own rendered luminance pushes only the
       brightest cores (Andromeda class) over the bloom
       threshold. */
    '#if HDR_LINEAR',
    '    col = pow(max(col, vec3(0.0)), vec3(2.2));',
    '    col *= 1.0 + pow(clamp(lum, 0.0, 1.0), 3.0) * 1.8;',
    '#endif',
    '    gl_FragColor = vec4(col, a);',
    '}'
].join('\n');

/* Bright nebulae — very soft diffuse sprites at the real OpenNGC
   positions in universe-nebulae.json. Colour family follows the
   catalogued type: 0 emission (pink-red), 1 planetary (teal),
   2 supernova remnant (violet), 3 reflection (blue). Sizes are
   the true angular sizes (catalogued major axis at the published
   distance) under the same pixel floor/cap discipline as the
   galaxies, and the sprite fades as you fly inside it. */
var NEB_VERT = [
    'attribute vec3 aPos;',
    'attribute float aDiam;',
    'attribute float aFam;',
    'attribute float aBright;',
    'attribute float aSeed;',
    'uniform float uScaleH;',
    'varying float vFam;',
    'varying float vBright;',
    'varying float vSeed;',
    'varying float vFade;',
    'varying vec2 vQ;',
    'void main() {',
    '    vec4 mv = modelViewMatrix * vec4(aPos, 1.0);',
    '    float rawDist = -mv.z;',
    '    float dist = max(1.0, rawDist);',
    /* Billboarded quad like the galaxies (graphics fix, 2026-11-19):
       the point version's 560 CSS px cap — and the lower hardware
       cap under it — froze a nebula's growth as you approached. The
       quad spans 1.25x the profile diameter (true size, or the old
       9 px floor in world units), so vQ is in profile units
       (0.5 = the profile edge, where the fragment reaches zero) and
       the d > 1 discard circle never touches the quad's edge. */
    '    float profD = max(aDiam, 9.0 * dist / uScaleH);',
    '    mv.xy += position.xy * (profD * 1.25);',
    '    vQ = position.xy * 1.25;',
    '    vFade = smoothstep(0.35, 1.4, rawDist / max(aDiam, 0.001));',
    '    vFam = aFam; vBright = aBright; vSeed = aSeed;',
    '    gl_Position = projectionMatrix * mv;',
    '}'
].join('\n');
var NEB_FRAG = [
    'precision mediump float;',
    'varying float vFam;',
    'varying float vBright;',
    'varying float vSeed;',
    'varying float vFade;',
    'varying vec2 vQ;',
    'uniform float uOpacity;',
    'vec3 famColor(float f) {',
    '    if (f < 0.5) return vec3(1.00, 0.42, 0.52);',   /* emission — pink-red */
    '    if (f < 1.5) return vec3(0.45, 0.95, 0.85);',   /* planetary — teal */
    '    if (f < 2.5) return vec3(0.78, 0.55, 1.00);',   /* remnant — violet */
    '    return vec3(0.55, 0.70, 1.00);',                /* reflection — blue */
    '}',
    'void main() {',
    '    vec2 q = vQ;',                          /* profile units: 0.5 = profile edge */
    '    float d = length(q) * 2.0;',
    '    if (d > 1.0) discard;',
    '    float g = max(0.0, 1.0 - d * d);',
    '    float body = g * g * g;',
    /* Soft internal structure: two low-frequency lobes seeded per
       object — a shading convention like the galaxy arms, not a
       map of the real cloud. */
    '    float w1 = sin(q.x * 3.4 + vSeed * 9.0 + q.y * 2.6);',
    '    float w2 = sin(q.y * 4.6 - vSeed * 7.0 - q.x * 1.8);',
    '    float structure = 0.82 + 0.18 * w1 * w2;',
    '    float core = g * g * g * g * g * g * g * g;',
    '    float a = clamp(body * structure + core * 0.55, 0.0, 1.0) * vBright * vFade * uOpacity;',
    '    if (a < 0.004) discard;',
    '    vec3 col = famColor(vFam);',
    /* With the HDR final pass the authored colour is linearised
       here and the composite re-encodes it; the core multiplier
       then operates in linear HDR, where the brightest cores
       (Orion class) cross the bloom threshold. */
    '#if HDR_LINEAR',
    '    col = pow(max(col, vec3(0.0)), vec3(2.2));',
    '#endif',
    '    col *= 0.55 + core * vBright * 2.6;',
    '    gl_FragColor = vec4(col, a);',
    '}'
].join('\n');

/* ------------------------------------------------------------------ *
 *  Final pass shaders — HDR bloom + grade                             *
 *                                                                     *
 *  The scene renders (tone mapping off, as it always has) into a      *
 *  half-float linear buffer. Bloom is extracted from that buffer:     *
 *  a bright pass at quarter resolution, blurred down a five-level     *
 *  mip chain, summed back in the composite. The composite applies     *
 *  the ACES filmic curve and the sRGB encode — together a gentle      *
 *  S-curve within a few percent of the game's previous response       *
 *  across the base range, with highlight detail instead of a hard     *
 *  clip, and whites free to pass 1.0 in the buffer so the bloom       *
 *  threshold can sit above everything except genuinely bright         *
 *  objects. All in-file: the vendored three.module.min.js ships       *
 *  no post-processing modules. If the float targets are not           *
 *  renderable (checked once, at setup), the game renders directly     *
 *  to the canvas exactly as before this pass.                         *
 * ------------------------------------------------------------------ */
var FX_VERT = [
    'varying vec2 vUv;',
    'void main() {',
    '    vUv = uv;',
    '    gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
].join('\n');
var FX_BRIGHT_FRAG = [
    'precision highp float;',
    'uniform sampler2D tSrc;',
    'uniform float uThresh;',
    'uniform float uKnee;',
    'varying vec2 vUv;',
    'void main() {',
    '    vec3 c = texture2D(tSrc, vUv).rgb;',
    '    float l = max(c.r, max(c.g, c.b));',
    /* soft knee: nothing at or below threshold - knee contributes,
       so the field of ordinary stars stays bloom-free */
    '    float w = smoothstep(uThresh - uKnee, uThresh + uKnee, l) * max(l - (uThresh - uKnee), 0.0);',
    '    gl_FragColor = vec4(c * (w / max(l, 1e-4)), 1.0);',
    '}'
].join('\n');
var FX_BLUR_FRAG = [
    'precision highp float;',
    'uniform sampler2D tSrc;',
    'uniform vec2 uTexel;',
    'uniform vec2 uDir;',
    'varying vec2 vUv;',
    'void main() {',
    /* 9-tap Gaussian in the linear-sampling form (two fetches per
       wing at the standard offsets) */
    '    vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;',
    '    vec2 o1 = uDir * uTexel * 1.3846153846;',
    '    vec2 o2 = uDir * uTexel * 3.2307692308;',
    '    c += texture2D(tSrc, vUv + o1).rgb * 0.3162162162;',
    '    c += texture2D(tSrc, vUv - o1).rgb * 0.3162162162;',
    '    c += texture2D(tSrc, vUv + o2).rgb * 0.0702702703;',
    '    c += texture2D(tSrc, vUv - o2).rgb * 0.0702702703;',
    '    gl_FragColor = vec4(c, 1.0);',
    '}'
].join('\n');
var FX_COPY_FRAG = [
    'precision highp float;',
    'uniform sampler2D tSrc;',
    'varying vec2 vUv;',
    'void main() {',
    '    gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0);',
    '}'
].join('\n');
var FX_COMP_FRAG = [
    'precision highp float;',
    'uniform sampler2D tSrc;',
    'uniform sampler2D tB0;',
    'uniform sampler2D tB1;',
    'uniform sampler2D tB2;',
    'uniform sampler2D tB3;',
    'uniform sampler2D tB4;',
    'uniform float uStrength;',
    'varying vec2 vUv;',
    /* ACES filmic approximation (Krzysztof Narkowicz) */
    'vec3 aces(vec3 x) {',
    '    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    'vec3 lin2srgb(vec3 c) {',
    '    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;',
    '    vec3 lo = c * 12.92;',
    '    return mix(lo, hi, step(vec3(0.0031308), c));',
    '}',
    'void main() {',
    '    vec3 bloom = texture2D(tB0, vUv).rgb * 0.32',
    '               + texture2D(tB1, vUv).rgb * 0.28',
    '               + texture2D(tB2, vUv).rgb * 0.20',
    '               + texture2D(tB3, vUv).rgb * 0.12',
    '               + texture2D(tB4, vUv).rgb * 0.08;',
    '    vec3 hdr = texture2D(tSrc, vUv).rgb + bloom * uStrength;',
    '    gl_FragColor = vec4(lin2srgb(aces(hdr)), 1.0);',
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
    var panelClose = $('.uv-panel-close');
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
    var nebPoints = null, nebulae = [];
    /* final pass (HDR bloom + grade) state — fxOK is decided once
       at setup; when false the game renders directly, as before */
    var fxOK = false, fxTarget = null, fxMips = [];
    var fxScene = null, fxCam = null, fxMesh = null;
    var fxBrightMat = null, fxBlurMat = null, fxCopyMat = null, fxCompMat = null;
    var glowFine = null, glowBroad = null;
    var backdrop = null;
    var solarGroup = null, solarBodies = null;
    var earthSys = null;   /* Earth texture-stack refs (set in buildSolarSystem) */
    var earthStackState = { started: false, ready: false, blend: 0 };
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
    /* Steering rebuild (2026-11-19): grab-the-sky drag + tap-to-fly.
       spin is the drag's release momentum (rad/s); gesture tracks the
       one-pointer press from landing to lift (drag vs tap, and the
       flick velocity); labelHits holds the boxes of the labels
       actually on screen, rebuilt by updateLabels every frame. */
    var spin = { yaw: 0, pitch: 0 };
    var gesture = null;
    var labelHits = [];
    var GRAB_SWEEP = 1.8326;   /* radians of turn per canvas width of drag — 105 degrees */
    var TAP_SLOP = 10;         /* px of travel that makes a press a drag, not a tap */
    var TAP_MS = 350;          /* longest press that still counts as a tap */
    var SPIN_TAU = 0.28;       /* momentum decay time constant, seconds */
    var SPIN_MAX = 7;          /* rad/s — a hard flick's ceiling */
    var SPIN_MIN = 0.15;       /* rad/s — a slower release is just a stop */
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

    /* The bright nebulae live in their own small file:
       universe-data.bin was baked from OpenNGC's galaxy rows
       only, so no nebula has ever been in the game. The add-on
       follows the named-galaxy precedent — direction and angular
       size from the OpenNGC row itself, distance a curated
       published value (sources in build_nebulae.py). A failed
       fetch simply leaves the layer out; the game runs without
       it. */
    function loadNebulae() {
        var url = new URL('./universe-nebulae.json', import.meta.url);
        return fetch(url).then(function (resp) { return resp.ok ? resp.json() : []; })
            .then(function (j) { if (Array.isArray(j)) nebulae = j; })
            .catch(function () { /* enhancement layer — never fatal */ });
    }
    function buildNebulae() {
        if (!nebulae.length) return;
        var n = nebulae.length;
        var pos = new Float32Array(n * 3), dia = new Float32Array(n),
            fam = new Float32Array(n), bri = new Float32Array(n), seed = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var e = nebulae[i];
            pos[i * 3] = e.p[0]; pos[i * 3 + 1] = e.p[1]; pos[i * 3 + 2] = e.p[2];
            dia[i] = e.d; fam[i] = e.f; bri[i] = e.b;
            var sh = (i + 1) * 0.61803398875;   /* the galaxies' own seed hash */
            seed[i] = sh - Math.floor(sh);
        }
        var base = new THREE.PlaneGeometry(1, 1);
        var g = new THREE.InstancedBufferGeometry();
        g.index = base.index;
        g.setAttribute('position', base.getAttribute('position'));
        g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
        g.setAttribute('aDiam', new THREE.InstancedBufferAttribute(dia, 1));
        g.setAttribute('aFam', new THREE.InstancedBufferAttribute(fam, 1));
        g.setAttribute('aBright', new THREE.InstancedBufferAttribute(bri, 1));
        g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
        g.instanceCount = n;
        var m = new THREE.ShaderMaterial({
            vertexShader: NEB_VERT, fragmentShader: NEB_FRAG,
            uniforms: { uScaleH: { value: 1 }, uDpr: { value: 1 }, uOpacity: { value: 0.9 } },
            defines: { HDR_LINEAR: fxOK ? 1 : 0 },
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        nebPoints = new THREE.Mesh(g, m);
        nebPoints.frustumCulled = false;
        scene.add(nebPoints);
    }

    /* ---------------- final pass: HDR bloom + grade ----------------
       One extra scene pass into a half-float target, a bright
       pass, ten small blur draws down a five-level mip chain, and
       one composite draw — about a dozen extra draws, all but one
       at quarter resolution or below, against a scene of ~10
       draws. The targets follow the drawing buffer, so the
       adaptive DPR ladder sheds this cost exactly as it sheds
       the scene's. */
    function fxMakeTargets() {
        if (!renderer) return;
        var size = new THREE.Vector2();
        renderer.getDrawingBufferSize(size);
        var w = Math.max(2, size.x), h = Math.max(2, size.y);
        if (fxTarget) fxTarget.dispose();
        fxMips.forEach(function (m) { m.a.dispose(); m.b.dispose(); });
        fxMips = [];
        fxTarget = new THREE.WebGLRenderTarget(w, h, {
            type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true
        });
        var mw = Math.max(2, w >> 2), mh = Math.max(2, h >> 2);
        for (var i = 0; i < 5; i++) {
            var opts = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false };
            fxMips.push({ a: new THREE.WebGLRenderTarget(mw, mh, opts), b: new THREE.WebGLRenderTarget(mw, mh, opts) });
            mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
        }
        if (fxCompMat) for (var k = 0; k < 5; k++) fxCompMat.uniforms['tB' + k].value = fxMips[k].a.texture;
    }
    function setupFinalPass() {
        try {
            if (!renderer.capabilities.isWebGL2) return;
            fxScene = new THREE.Scene();
            fxCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            fxMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
            fxMesh.frustumCulled = false;
            fxScene.add(fxMesh);
            fxBrightMat = new THREE.ShaderMaterial({
                uniforms: { tSrc: { value: null }, uThresh: { value: 1.0 }, uKnee: { value: 0.3 } },
                vertexShader: FX_VERT, fragmentShader: FX_BRIGHT_FRAG, depthTest: false, depthWrite: false
            });
            fxBlurMat = new THREE.ShaderMaterial({
                uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) }, uDir: { value: new THREE.Vector2(1, 0) } },
                vertexShader: FX_VERT, fragmentShader: FX_BLUR_FRAG, depthTest: false, depthWrite: false
            });
            fxCopyMat = new THREE.ShaderMaterial({
                uniforms: { tSrc: { value: null } },
                vertexShader: FX_VERT, fragmentShader: FX_COPY_FRAG, depthTest: false, depthWrite: false
            });
            fxCompMat = new THREE.ShaderMaterial({
                uniforms: {
                    tSrc: { value: null },
                    tB0: { value: null }, tB1: { value: null }, tB2: { value: null },
                    tB3: { value: null }, tB4: { value: null },
                    uStrength: { value: 0.85 }
                },
                vertexShader: FX_VERT, fragmentShader: FX_COMP_FRAG, depthTest: false, depthWrite: false
            });
            fxMakeTargets();
            /* The float targets must actually be renderable on
               this device — check the framebuffer status once;
               if incomplete, fall back to direct rendering. */
            var gl = renderer.getContext();
            renderer.setRenderTarget(fxTarget);
            var okA = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            renderer.setRenderTarget(fxMips[0].a);
            var okB = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            renderer.setRenderTarget(null);
            fxOK = !!(okA && okB);
        } catch (e) { fxOK = false; }
    }
    function renderWithBloom() {
        renderer.setRenderTarget(fxTarget);
        renderer.render(scene, camera);
        var n = fxMips.length, i, lvl;
        fxMesh.material = fxBrightMat;
        fxBrightMat.uniforms.tSrc.value = fxTarget.texture;
        renderer.setRenderTarget(fxMips[0].a);
        renderer.render(fxScene, fxCam);
        for (i = 0; i < n; i++) {
            lvl = fxMips[i];
            fxMesh.material = fxBlurMat;
            fxBlurMat.uniforms.uTexel.value.set(1 / lvl.a.width, 1 / lvl.a.height);
            fxBlurMat.uniforms.tSrc.value = lvl.a.texture;
            fxBlurMat.uniforms.uDir.value.set(1, 0);
            renderer.setRenderTarget(lvl.b); renderer.render(fxScene, fxCam);
            fxBlurMat.uniforms.tSrc.value = lvl.b.texture;
            fxBlurMat.uniforms.uDir.value.set(0, 1);
            renderer.setRenderTarget(lvl.a); renderer.render(fxScene, fxCam);
            if (i + 1 < n) {
                fxMesh.material = fxCopyMat;
                fxCopyMat.uniforms.tSrc.value = lvl.a.texture;
                renderer.setRenderTarget(fxMips[i + 1].a);
                renderer.render(fxScene, fxCam);
            }
        }
        fxMesh.material = fxCompMat;
        fxCompMat.uniforms.tSrc.value = fxTarget.texture;
        renderer.setRenderTarget(null);
        renderer.render(fxScene, fxCam);
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
            defines: { HDR_LINEAR: fxOK ? 1 : 0 },
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        var pts = new THREE.Points(g, m);
        pts.frustumCulled = false;
        return pts;
    }

    /* ---------------- the all-sky backdrop ----------------
       The glow above is positional: it lives inside the mapped
       star ball — every catalogued star sits within 990 pc of the
       Sun — so any flight past a few hundred parsecs leaves the
       lit sky behind, and the frame falls back to the bare clear
       colour. (Measured: at 3.3 kpc the frame is 80% near-black.)
       This backdrop is the same bake in DIRECTION space: every
       star's real light, and every galaxy's, summed into the
       direction it is seen in from home and painted onto a sky
       sphere that is re-centred on the camera every frame. It
       cannot be left behind; it carries light only where the
       catalog has light (the band across it is the Milky Way's
       own shape, the bright knot the Virgo Cluster's direction);
       and the true 3D field always draws in front of it. A floor,
       not a replacement sky — kept dim so that near home the real
       positional glow still leads. */
    function buildBackdrop() {
        var W = 4096, H = 2048;
        /* sphere UV for a world direction, matched to the mesh
           rotation below (pole onto +Z, the equatorial frame's
           own north): u = RA/2pi + 1/2, v = 1/2 + Dec/pi. */
        function skyXY(x, y, z, w2, h2) {
            var r = Math.sqrt(x * x + y * y + z * z);
            var ra = Math.atan2(y, x);
            var dec = Math.asin(z / r);
            return [(ra / (2 * Math.PI) + 0.5) * w2,
                    (0.5 - dec / Math.PI) * h2];
        }
        /* soft round stamps on the star shader's own B-V ramp —
           drawn with 'lighter', so overlapping light adds exactly
           as the additive scene adds it. */
        function stamp(r, g, b) {
            var c = document.createElement('canvas'); c.width = c.height = 64;
            var g2 = c.getContext('2d');
            var grad = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
            grad.addColorStop(0.4, 'rgba(' + r + ',' + g + ',' + b + ',0.45)');
            grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
            g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64);
            return c;
        }
        var STOPS = [
            [-0.33, stamp(128, 158, 255)], [0.00, stamp(184, 209, 255)],
            [0.32, stamp(255, 242, 214)], [0.65, stamp(255, 214, 140)],
            [1.15, stamp(255, 163, 77)], [1.65, stamp(255, 117, 48)],
            [2.40, stamp(255, 84, 31)]
        ];
        var GAL_STAMPS = [stamp(255, 214, 163), stamp(214, 227, 255), stamp(163, 194, 255)];
        function stampFor(ci) {
            for (var s = 0; s < STOPS.length; s++) if (ci <= STOPS[s][0]) return STOPS[s][1];
            return STOPS[STOPS.length - 1][1];
        }
        /* starlight weights: the glow bake's own log squeeze */
        var wArr = new Float32Array(data.starCount), maxLog = 0;
        for (var i = 0; i < data.starCount; i++) {
            var L = Math.pow(10, -0.4 * data.starAbsMag[i]);
            wArr[i] = Math.log10(1 + L);
            if (wArr[i] > maxLog) maxLog = wArr[i];
        }
        function splatAll(ctx, w2, h2, starSize, starAlpha, galSize, galAlpha, grainSize, grainAlpha) {
            function splat(x, y, img, size, alpha) {
                ctx.globalAlpha = alpha;
                ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
                if (x < size) ctx.drawImage(img, x + w2 - size / 2, y - size / 2, size, size);
                if (x > w2 - size) ctx.drawImage(img, x - w2 - size / 2, y - size / 2, size, size);
            }
            for (var i = 0; i < data.starCount; i++) {
                var w = maxLog > 0 ? wArr[i] / maxLog : 0;
                var p = skyXY(data.starPos[i * 3], data.starPos[i * 3 + 1], data.starPos[i * 3 + 2], w2, h2);
                splat(p[0], p[1], stampFor(data.starCi[i]),
                      starSize * (0.3 + 0.7 * w), starAlpha * (0.15 + 0.85 * w));
                /* QUALITY PASS: a second, much tighter stamp per
                   star in the same pass — the grain that keeps the
                   far sky reading as individual stars instead of
                   smooth wash, still the same catalog light. */
                if (grainSize > 0) splat(p[0], p[1], stampFor(data.starCi[i]),
                      grainSize * (0.3 + 0.7 * w), grainAlpha * (0.15 + 0.85 * w));
            }
            for (var j = 0; j < data.galCount; j++) {
                var bright = data.galBright[j] / 255;
                var dw = Math.min(1, Math.max(0, (Math.log10(Math.max(1, data.galDiam[j])) - 3.5) / 2));
                var q = skyXY(data.galPos[j * 3], data.galPos[j * 3 + 1], data.galPos[j * 3 + 2], w2, h2);
                splat(q[0], q[1], GAL_STAMPS[Math.min(2, data.galTint[j])],
                      galSize * (0.3 + 0.7 * dw), galAlpha * (0.25 + 0.75 * bright));
            }
        }
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        splatAll(ctx, W, H, 68, 0.32, 50, 0.24, 15, 0.30);
        /* the broad wash is the fine bake itself, drawn back
           scaled down and up, twice — a blur of the same light,
           never a second, hotter source (a per-star broad pass
           saturates: 100k stamps on a small canvas sum to white).
           Constants calibrated offline against the catalog with
           the bake simulator: against the previous bake the
           finished sky's mean lifts about +26%, the band +24%,
           the poles +29%, at an unchanged 99th-percentile peak —
           a denser floor the real field still outshines, with
           per-star grain so no patch of sky reads as empty. */
        ctx.globalAlpha = 0.31;
        ctx.drawImage(cv, 0, 0, 256, 128, 0, 0, W, H);
        ctx.globalAlpha = 0.23;
        ctx.drawImage(cv, 0, 0, 512, 256, 0, 0, W, H);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        var tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        var mat = new THREE.MeshBasicMaterial({
            map: tex, side: THREE.BackSide, depthWrite: false, fog: false
        });
        /* a floor, not a flood: the bake is summed real light, and
           the material dims it to ambient level so the true 3D
           field — stars, glow, planets — always leads */
        mat.color.setScalar(0.55);
        var mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
        mesh.rotation.x = Math.PI / 2;   /* the sphere's pole onto +Z */
        mesh.renderOrder = -1;           /* first: everything else draws over it */
        mesh.frustumCulled = false;
        return mesh;
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
        '    vec3 col = vec3(0.35, 0.58, 1.0);',
        '#if HDR_LINEAR',
        '    col = pow(max(col, vec3(0.0)), vec3(2.2));',
        '#endif',
        '    gl_FragColor = vec4(col, 1.0) * i * 0.9;',
        '}'
    ].join('\n');
    /* ---------------- Earth's texture stack ----------------
       Earth is drawn by a custom shader, not the Lambert the other
       planets use, because she has three maps to reconcile: the
       plain map every planet gets (planets/earth.jpg, 3840x1920),
       and — loaded lazily on a first approach to the solar system
       (startEarthStack, below) — NASA's Blue Marble day map, the
       VIIRS night-lights map, and the Visible Earth cloud
       composite (planets/earth-day.jpg / earth-night.jpg /
       earth-clouds.jpg, 4096x2048 renditions; fetch_earth_stack.py
       records the sources). The shader reproduces the game's
       Lambert terms exactly — the PointLight's 5.2/pi on the day
       side, the ambient's 0.22/pi whisper — so Earth sits in the
       same light as her neighbours in both render paths; the
       night lights are an emissive the sun's own direction
       switches on across the terminator. When the stack lands,
       uBlend crossfades the day map over ~1.6 s and fades the
       lights and clouds in with it: the plain map is the base
       until then, so there is no grey-ball window and no pop. */
    var EARTH_VERT = [
        'varying vec2 vUv;',
        'varying vec3 vNV;',
        'varying vec3 vVP;',
        'void main() {',
        '    vUv = uv;',
        '    vNV = normalize(normalMatrix * normal);',
        '    vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '    vVP = mv.xyz;',
        '    gl_Position = projectionMatrix * mv;',
        '}'
    ].join('\n');
    var SRGB_ENC_GLSL = [
        'vec3 srgbEnc(vec3 c) {',
        '    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666667)) - 0.055;',
        '    vec3 lo = c * 12.92;',
        '    return mix(lo, hi, step(vec3(0.0031308), c));',
        '}'
    ].join('\n');
    var EARTH_FRAG = [
        'precision mediump float;',
        'varying vec2 vUv;',
        'varying vec3 vNV;',
        'varying vec3 vVP;',
        'uniform sampler2D tLow;',
        'uniform sampler2D tDay;',
        'uniform sampler2D tNight;',
        'uniform float uBlend;',
        'uniform float uHasLow;',
        'uniform float uHasStack;',
        'uniform vec3 uSunVP;',
        SRGB_ENC_GLSL,
        'void main() {',
        '    vec3 N = normalize(vNV);',
        '    vec3 L = normalize(uSunVP - vVP);',
        '    float ndl = dot(N, L);',
        /* before any map lands, the same 0x888888 grey the Lambert
           planets show (0.2462 in linear working space) */
        '    vec3 day = vec3(0.2462);',
        '    if (uHasLow > 0.5) day = texture2D(tLow, vUv).rgb;',
        '    if (uHasStack > 0.5) day = mix(day, texture2D(tDay, vUv).rgb, uBlend);',
        '    vec3 col = day * (0.07003 + 1.6552 * clamp(ndl, 0.0, 1.0));',
        '    if (uHasStack > 0.5) {',
        /* city lights: an emissive the terminator switches — full
           deep in the night, gone by mid-morning, fading in with
           the stack's own blend so they never pop */
        '        float nightF = (1.0 - smoothstep(-0.18, 0.10, ndl)) * uBlend;',
        '        col += texture2D(tNight, vUv).rgb * nightF * 1.2;',
        '    }',
        '#if !HDR_LINEAR',
        '    col = srgbEnc(col);',
        '#endif',
        '    gl_FragColor = vec4(col, 1.0);',
        '}'
    ].join('\n');
    var CLOUD_FRAG = [
        'precision mediump float;',
        'varying vec2 vUv;',
        'varying vec3 vNV;',
        'varying vec3 vVP;',
        'uniform sampler2D tCov;',
        'uniform float uBlend;',
        'uniform vec3 uSunVP;',
        SRGB_ENC_GLSL,
        'void main() {',
        /* earth-clouds.jpg is a coverage map (alpha x gray of the
           Visible Earth composite, baked at fetch time): coverage
           in the red channel, data not colour — sampled raw */
        '    float cov = texture2D(tCov, vUv).r;',
        '    vec3 N = normalize(vNV);',
        '    vec3 L = normalize(uSunVP - vVP);',
        '    float ndl = dot(N, L);',
        /* clouds take the same sunlight as the ground, a touch
           dimmer; they thin to a whisper across the terminator
           instead of glowing on the night side */
        '    float light = (0.07003 + 1.6552 * clamp(ndl, 0.0, 1.0)) * 0.8;',
        '    float dayness = clamp(ndl * 1.6 + 0.35, 0.05, 1.0);',
        '    vec3 col = vec3(light);',
        '#if !HDR_LINEAR',
        '    col = srgbEnc(col);',
        '#endif',
        '    gl_FragColor = vec4(col, cov * uBlend * dayness * 0.96);',
        '}'
    ].join('\n');
    function startEarthStack() {
        if (!earthSys || earthStackState.started) return;
        earthStackState.started = true;
        var loader = new THREE.TextureLoader();
        var maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        var settled = 0, dayOK = false;
        function settle(ok, isDay) {
            if (isDay) dayOK = ok;
            settled++;
            /* blend only on a complete, day-bearing stack: if the
               day map failed, Earth keeps her plain map and the
               lights and clouds stay off — a partial stack would
               be worse than none */
            if (settled === 3 && dayOK) {
                earthStackState.ready = true;
                earthSys.uniforms.uHasStack.value = 1;
                earthSys.cloudMesh.visible = true;
            }
        }
        function grab(file, srgb, isDay) {
            var t = loader.load(new URL('./planets/' + file, import.meta.url).href,
                function () { settle(true, isDay); },
                undefined,
                function () { settle(false, isDay); });
            if (srgb) t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = maxAniso;
            return t;
        }
        earthSys.uniforms.tDay.value = grab('earth-day.jpg', true, true);
        earthSys.uniforms.tNight.value = grab('earth-night.jpg', true, false);
        earthSys.cloudUniforms.tCov.value = grab('earth-clouds.jpg', false, false);
    }

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
            /* QUALITY PASS: 64x48 segments (was 48x32) — the
               silhouette and the terminator stay smooth at the
               closest approaches the approach governor allows */
            var geo = new THREE.SphereGeometry(b.r, 64, 48);
            if (b.atmo) {
                /* Earth: the custom shader (see EARTH_FRAG above).
                   The sun's view-space position is one shared
                   uniform object across both Earth materials, kept
                   current once per frame. */
                var sunVP = { value: new THREE.Vector3(1, 0, 0) };
                var emat = new THREE.ShaderMaterial({
                    vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
                    uniforms: {
                        tLow: { value: null }, tDay: { value: null }, tNight: { value: null },
                        uBlend: { value: 0 }, uHasLow: { value: 0 }, uHasStack: { value: 0 },
                        uSunVP: sunVP
                    },
                    defines: { HDR_LINEAR: fxOK ? 1 : 0 }
                });
                var etex = loader.load(new URL('./planets/' + b.tex, import.meta.url).href,
                    function () { emat.uniforms.tLow.value = etex; emat.uniforms.uHasLow.value = 1; });
                etex.colorSpace = THREE.SRGBColorSpace;
                etex.anisotropy = maxAniso;
                grp.add(new THREE.Mesh(geo, emat));
                /* the cloud sphere: 1% proud of the surface, its
                   own material, hidden until the stack lands */
                var cmat = new THREE.ShaderMaterial({
                    vertexShader: EARTH_VERT, fragmentShader: CLOUD_FRAG,
                    uniforms: { tCov: { value: null }, uBlend: { value: 0 }, uSunVP: sunVP },
                    defines: { HDR_LINEAR: fxOK ? 1 : 0 },
                    transparent: true, depthWrite: false
                });
                var cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(b.r * 1.01, 64, 48), cmat);
                cloudMesh.renderOrder = 1;
                cloudMesh.visible = false;
                grp.add(cloudMesh);
                earthSys = {
                    pos: pos, uniforms: emat.uniforms, cloudUniforms: cmat.uniforms,
                    cloudMesh: cloudMesh, sunVP: sunVP
                };
            } else {
                var mat = b.sun
                    ? new THREE.MeshBasicMaterial({ color: 0xffdd88 })
                    : new THREE.MeshLambertMaterial({ color: 0x888888 });
                var tex = loader.load(new URL('./planets/' + b.tex, import.meta.url).href,
                    function () { mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true; });
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = maxAniso;
                grp.add(new THREE.Mesh(geo, mat));
            }
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
                var atmoMesh = new THREE.Mesh(
                    new THREE.SphereGeometry(b.r * 1.22, 64, 48),
                    new THREE.ShaderMaterial({
                        vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
                        defines: { HDR_LINEAR: fxOK ? 1 : 0 },
                        blending: THREE.AdditiveBlending, side: THREE.BackSide,
                        transparent: true, depthWrite: false
                    }));
                /* transparent order around Earth is fixed by hand:
                   surface (opaque) -> clouds (1) -> atmosphere (2) */
                atmoMesh.renderOrder = 2;
                grp.add(atmoMesh);
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
        /* the HDR final pass decides here, before any material
           compiles, so the custom shaders know whether their
           colours will be re-encoded by the composite */
        setupFinalPass();
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
            defines: { HDR_LINEAR: fxOK ? 1 : 0 },
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
            /* One instanced quad per galaxy (graphics fix, 2026-11-19):
               the base PlaneGeometry supplies the corner 'position'
               (+/-0.5) and the index; every catalog attribute rides
               as an instanced attribute, so both clouds stay a single
               draw call each, exactly as the points were. */
            var base = new THREE.PlaneGeometry(1, 1);
            var g = new THREE.InstancedBufferGeometry();
            g.index = base.index;
            g.setAttribute('position', base.getAttribute('position'));
            g.setAttribute('aPos', new THREE.InstancedBufferAttribute(data.galPos.slice(from * 3, to * 3), 3));
            g.setAttribute('aMajor', new THREE.InstancedBufferAttribute(data.galMajor.slice(from * 3, to * 3), 3));
            g.setAttribute('aDiam', new THREE.InstancedBufferAttribute(data.galDiam.slice(from, to), 1));
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
            g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 1));
            g.setAttribute('aBright', new THREE.InstancedBufferAttribute(bright, 1));
            g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
            g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
            g.instanceCount = n;
            var m = new THREE.ShaderMaterial({
                vertexShader: GAL_VERT, fragmentShader: GAL_FRAG,
                uniforms: { uScaleH: { value: 1 }, uDpr: { value: 1 }, uHalo: { value: halo } },
                defines: { HDR_LINEAR: fxOK ? 1 : 0 },
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
            });
            var pts = new THREE.Mesh(g, m);
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

        /* the all-sky backdrop — summed catalog light in direction
           space, on a sphere that follows the camera, so the lit
           sky is a floor under every position and speed */
        backdrop = buildBackdrop();
        scene.add(backdrop);

        /* the bright nebulae — soft coloured glows at their real
           catalog positions (universe-nebulae.json) */
        buildNebulae();

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
        spin.yaw = 0; spin.pitch = 0;
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
        spin.yaw = 0; spin.pitch = 0;
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
    /* Grab momentum: a flick's turn keeps going after the finger
       lets go, decaying exponentially (time constant SPIN_TAU) to a
       full stop inside about a second — never a dead stop, never an
       endless spin. Free flight only: the frame loop calls this only
       on the free branch, and any new input zeroes the spin (the
       pointerdown handler, interruptTour, the tour). */
    function spinFrame(dt) {
        if (!spin.yaw && !spin.pitch) return;
        yaw += spin.yaw * dt;
        if (spin.pitch) {
            var np = pitch + spin.pitch * dt;
            pitch = Math.max(-1.45, Math.min(1.45, np));
            if (pitch !== np) spin.pitch = 0;   /* pressed into the pole clamp — stop pushing */
        }
        var d = Math.exp(-dt / SPIN_TAU);
        spin.yaw *= d; spin.pitch *= d;
        if (Math.abs(spin.yaw) < 0.03 && Math.abs(spin.pitch) < 0.03) { spin.yaw = 0; spin.pitch = 0; }
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
        if (entry.k === 2 && entry.n === 'The Sun') startEarthStack();
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
        startEarthStack();   /* any jump into the system starts Earth's maps loading — the 3.2 s flight is the head start */
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
        if (!labelsOn) { labelHits = []; labelPool.forEach(function (d) { d.style.display = 'none'; }); return; }
        var cands = [];
        labelHits = [];
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
                cands.push({ e: { n: sb2.n }, b: sb2, sx: ssx, sy: ssy, eff: sdist * 0.4, dist: sdist });
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
            /* the tap-to-fly hit box: the label's own box, padded a
               few px for a fingertip, in the same labels-box
               coordinates — rank order, so a tap picks the most
               prominent label where padded boxes overlap */
            labelHits.push({ x0: x0 - 6, y0: y0 - 6, x1: x1 + 6, y1: y1 + 6, e: c.e, b: c.b || null });
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
           down; the catalog is light enough that this rarely engages.
           The ladder also climbs back when frames run fast again
           (graphics fix, 2026-11-19): it used to only descend, so one
           slow stretch — a dense field at full ratio — permanently
           softened the rest of the session, part of why the graphics
           "got worse" the longer Johnny flew. The wide hysteresis
           band (24 ms down, 12 ms up, one step per 90-frame window)
           keeps it from oscillating. */
        frameAcc += dt; frameN++;
        if (frameN >= 90) {
            var avg = frameAcc / frameN;
            if (avg > 0.024 && dprLevel < DPR_STEPS.length - 1) { dprLevel++; applyDpr(); }
            else if (avg < 0.012 && dprLevel > 0) { dprLevel--; applyDpr(); }
            frameAcc = 0; frameN = 0;
        }
        if (tour.on) tourFrame(dt);
        else if (flyAnim) flyAnimFrame(dt);
        else { idleDrift(now, dt); spinFrame(dt); flyFrame(dt); }

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
        /* the backdrop sphere rides on the camera — centred here,
           sized just inside the far plane — so it is a floor under
           the view, never a place flight can leave behind */
        if (backdrop) {
            backdrop.position.copy(camPos);
            var bs = camera.far * 0.45;
            backdrop.scale.set(bs, bs, bs);
        }
        /* the Sun's point sprite hands over to its textured sphere
           once you are close enough for the sphere to be the Sun */
        if (sunPoints) sunPoints.visible = alt > 3e-6;
        /* Earth's texture stack: the lazy trigger is a genuine
           approach — inside the planetary region (alt < 2e-4 pc,
           just outside Neptune's orbit; the home view starts at
           1.7e-3 pc, so a player who never flies in never pays
           for the maps) or closing on Earth herself — then the
           crossfade, the clouds' slow drift (a full turn in ~10
           minutes; one float add a frame), and the shared sun
           position for Earth's two shaders */
        if (earthSys) {
            if (!earthStackState.started && (alt < 2e-4 || camPos.distanceTo(earthSys.pos) < 2e-6)) startEarthStack();
            if (earthStackState.ready && earthStackState.blend < 1) {
                earthStackState.blend = Math.min(1, earthStackState.blend + dt / 1.6);
                var eb = earthStackState.blend;
                eb = eb * eb * (3 - 2 * eb);
                earthSys.uniforms.uBlend.value = eb;
                earthSys.cloudUniforms.uBlend.value = eb;
            }
            if (earthSys.cloudMesh.visible) earthSys.cloudMesh.rotation.y += dt * 0.01;
            camera.updateMatrixWorld();
            earthSys.sunVP.value.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
        }
        camera.updateProjectionMatrix();
        if (fxOK && fxTarget) renderWithBloom();
        else renderer.render(scene, camera);
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
        [starPoints, galNamedPoints, galCloudPoints, glowFine, glowBroad, nebPoints].forEach(function (p) {
            if (p) {
                p.material.uniforms.uScaleH.value = scaleH;
                p.material.uniforms.uDpr.value = dpr;
            }
        });
        /* the final-pass targets track the drawing buffer, so a
           resize or a DPR-ladder step re-makes them at the new
           size (a dozen small allocations, off the frame path) */
        if (fxOK) fxMakeTargets();
    }

    /* ---------------- events ---------------- */
    function bindEvents() {
        var box = canvas.parentElement;
        if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(box);
        window.addEventListener('resize', resize);

        /* ---------------- steering: grab the sky, tap to fly --------
           The old drag turned the view mouse-look style horizontally
           (drag right, look right — the sky slid against the finger)
           while the vertical already followed the finger, at a fixed
           0.0032 rad/px, and stopped dead the instant the finger
           lifted. The two axes disagreed with each other, which is
           most of why it felt wrong. Now one press does three jobs,
           told apart by how far and how long it travels:
             grab drag — the stars follow the finger: drag right and
               the view turns left, drag down and the view tips up, so
               the grabbed point stays under the fingertip. The rate
               is set from the canvas itself: one full width of drag
               turns the view GRAB_SWEEP radians (105 degrees), the
               same per-pixel rate on both axes, touch and mouse alike.
             flick — a drag that is still moving when it lifts hands
               its angular velocity to spinFrame, which decays it to
               a stop; a drag that had already slowed to a halt hands
               over nothing.
             tap — a press inside TAP_SLOP px and TAP_MS ms: if it
               lands on a visible name label, flyTo / flyToSolar run
               the same flight the search jumps use; if it lands on
               empty sky, nothing happens — a tap never jerks the view
               and never starts a flight by accident.
           Any press also interrupts the tour or a running flight
           (interruptTour, as before), so a second tap or a fresh
           grab mid-flight hands control straight back to the finger. */
        canvas.addEventListener('pointerdown', function (ev) {
            canvas.setPointerCapture(ev.pointerId);
            pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            if (pointers.size === 2) {
                var pts = Array.from(pointers.values());
                pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                gesture = null;
            } else if (pointers.size === 1) {
                var rect = canvas.getBoundingClientRect();
                gesture = {
                    id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, t0: ev.timeStamp,
                    lx: ev.clientX, ly: ev.clientY, lt: ev.timeStamp,
                    vx: 0, vy: 0, moved: false,
                    rate: GRAB_SWEEP / Math.max(1, rect.width)
                };
                spin.yaw = 0; spin.pitch = 0;
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
            if (!gesture || ev.pointerId !== gesture.id) return;
            /* flick velocity: a running blend of the recent per-event
               speeds (px/s), so the release inherits the motion the
               finger actually had, not one event's jitter */
            var mdt = (ev.timeStamp - gesture.lt) / 1000;
            if (mdt > 0.002 && mdt < 0.25) {
                gesture.vx = gesture.vx * 0.5 + (dx / mdt) * 0.5;
                gesture.vy = gesture.vy * 0.5 + (dy / mdt) * 0.5;
            }
            gesture.lx = ev.clientX; gesture.ly = ev.clientY; gesture.lt = ev.timeStamp;
            if (Math.hypot(ev.clientX - gesture.x0, ev.clientY - gesture.y0) > TAP_SLOP) gesture.moved = true;
            yaw -= dx * gesture.rate;
            pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * gesture.rate));
        });
        function endPointer(ev) {
            var g = (gesture && ev.pointerId === gesture.id) ? gesture : null;
            pointers.delete(ev.pointerId);
            if (pointers.size === 0) {
                dragging = false;
                if (g) {
                    if (ev.type === 'pointerup' && !g.moved && ev.timeStamp - g.t0 <= TAP_MS) {
                        tapAt(ev.clientX, ev.clientY);
                    } else if (ev.type === 'pointerup' && g.moved
                               && (ev.timeStamp - g.lt) / 1000 < 0.09) {
                        /* still moving at lift-off: hand the turn to
                           the momentum decay. The gap test is what
                           keeps a drag that paused before lifting
                           from flinging — its last move is stale. */
                        spin.yaw = -g.vx * g.rate;
                        spin.pitch = g.vy * g.rate;
                        var m = Math.hypot(spin.yaw, spin.pitch);
                        if (m > SPIN_MAX) { spin.yaw *= SPIN_MAX / m; spin.pitch *= SPIN_MAX / m; }
                        if (m < SPIN_MIN) { spin.yaw = 0; spin.pitch = 0; }
                    }
                    gesture = null;
                }
            } else if (pointers.size === 1) {
                /* one finger of a pinch lifted: the survivor keeps
                   steering from where it rests — re-seeded as an
                   already-moved gesture, so it can never become a tap */
                var left = Array.from(pointers.entries())[0];
                var rect2 = canvas.getBoundingClientRect();
                gesture = {
                    id: left[0], x0: left[1].x, y0: left[1].y, t0: ev.timeStamp,
                    lx: left[1].x, ly: left[1].y, lt: ev.timeStamp,
                    vx: 0, vy: 0, moved: true,
                    rate: GRAB_SWEEP / Math.max(1, rect2.width)
                };
            }
            pinchDist = 0;
        }
        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
        /* A tap on a visible name label flies to that object through
           the existing flight machinery (flyAnim and its standoff
           distances — the search jumps' own), never a second system.
           labelHits is rebuilt by updateLabels every frame from the
           labels actually on screen, in rank order, in labels-box
           coordinates. Labels toggled off means no hits, so no
           invisible tap targets. */
        function tapAt(cx, cy) {
            if (!labelsOn || !labelHits.length) return;
            var r = labelsEl.getBoundingClientRect();
            var x = cx - r.left, y = cy - r.top;
            for (var i = 0; i < labelHits.length; i++) {
                var hb = labelHits[i];
                if (x >= hb.x0 && x <= hb.x1 && y >= hb.y0 && y <= hb.y1) {
                    interruptTour();
                    if (hb.b) flyToSolar(hb.b); else flyTo(hb.e);
                    return;
                }
            }
        }
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
        function openPanel() {
            panel.hidden = false;
            moreBtn.setAttribute('aria-expanded', 'true');
            moreBtn.textContent = 'Fewer controls \u25B4';
        }
        function closePanel() {
            panel.hidden = true;
            moreBtn.setAttribute('aria-expanded', 'false');
            moreBtn.textContent = 'More controls \u25BE';
        }
        moreBtn.addEventListener('click', function () {
            if (panel.hidden) openPanel(); else closePanel();
            moreBtn.blur();
        });
        panelClose.addEventListener('click', function () { closePanel(); panelClose.blur(); });
        var searchFlown = '';
        function doSearch() {
            var name = searchInput.value.trim();
            if (!name) return;
            if (name.toLowerCase() === searchFlown) return;
            for (var i = 0; i < data.named.length; i++) {
                if (data.named[i].n.toLowerCase() === name.toLowerCase()) {
                    interruptTour();
                    flyTo(data.named[i]);
                    searchFlown = name.toLowerCase();
                    searchInput.blur();
                    closePanel();
                    return;
                }
            }
            for (var j = 0; j < SOLAR_BODIES.length; j++) {
                if (SOLAR_BODIES[j].n.toLowerCase() === name.toLowerCase()) {
                    interruptTour();
                    flyToSolar(SOLAR_BODIES[j]);
                    searchFlown = name.toLowerCase();
                    searchInput.blur();
                    closePanel();
                    return;
                }
            }
            setCaption('No match for \u201C' + name + '\u201D \u2014 try a name from the list as you type.');
        }
        searchGo.addEventListener('click', function () { doSearch(); searchGo.blur(); });
        searchInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doSearch(); } });
        searchInput.addEventListener('change', doSearch);
        searchInput.addEventListener('input', function () { searchFlown = ''; });
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
        return loadNebulae();
    }).then(function () {
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
