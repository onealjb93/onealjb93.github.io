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
   you fly in to meet her: NASA's Blue Marble day map and the
   VIIRS night-lights map (city lights on the dark side, lit by
   the same sun that lights the day side) at 8192x4096, the
   Visible Earth cloud composite on its own slowly-drifting
   sphere, an ocean specular mask behind the sun-glint, and a
   terrain relief map shading the ranges — all public-domain
   NASA imagery, fetched only on a first approach to the solar
   system and crossfaded over the plainer map, so nothing about
   the game's start changes for anyone who never flies in. The
   Moon hangs beside her at her true direction and size, her
   distance compressed so the enlarged Earth does not swallow
   her (the About note states it). Twelve named galaxies resolve
   into real NASA/ESA/ESO/NOIRLab photographs as you close in,
   and near home the sky itself is ESO's photographic panorama
   of the real night sky, fading as you leave the neighbourhood.
   Flying fast stretches each star along its own motion and the
   renderer's resolution ladder is compensated, so nothing in
   the scene dims when you speed up.
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
    /* the camera's velocity in view space, scaled to a fixed
       1/60 s reference frame (parsecs per reference frame, from a
       true per-second velocity on the CPU): stars streak along
       it — see the stretch maths in main */
    'uniform vec3 uVelView;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vGlow;',
    'varying float vShim;',
    'varying float vStretch;',
    'varying float vAng;',
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
    '    float szPx = clamp(sz * (1.0 + 0.45 * vGlow + 0.05 * vGlow * shim), 2.0, 46.0);',
    '    gl_PointSize = szPx * uDpr;',
    /* VELOCITY STREAKS (quality pass, 2026-11-21): a star sprite is
       redrawn each frame wherever the star now is; it never smears.
       On a real retina — and on any sample-and-hold screen — a fast
       star crosses each pixel so briefly that the eye integrates
       less light from it, so a fast field reads DIMMER than the same
       field at rest (measured on the live game: at high speed
       everything goes dark). Nothing in the scene actually dims —
       the light per star is constant; it is the dwell time that
       shrinks. The honest fix is the one the sky itself uses:
       stretch the sprite along its own screen motion by the
       distance it travels per frame, so the light it sheds is
       spread over the path it truly crosses, and divide the alpha
       by the stretch so the star's total light is conserved —
       a streak, not a dimming and not a brightening. Direction is
       the star's own parallax motion (near stars streak long, the
       far field barely moves — exactly as in real flight). The
       elongation saturates at 9x so a warp-speed pass reads as
       streaks, not lines across the sky — and past a stretch of
       2.5 the fragment stage stops dividing the light down at the
       full rate (see STAR_FRAG): at the old 5x cap with full
       division, a warp pass spread each star to a fifth of its
       brightness across a capped sprite and the sky read BLACK
       at the top of the slider (Johnny, 2026-11-25). A streak at
       warp is a speed indicator first; its light is conserved
       where conservation is visible and held up where it is not. */
    '    vec2 velPx = uVelView.xy * (uScaleH / dist);',  /* this star's screen travel, CSS px per frame */
    '    float spd = length(velPx);',
    '    vStretch = clamp(spd * 0.55 / max(szPx, 2.0), 0.0, 9.0);',
    '    vAng = atan(-velPx.y, velPx.x);',   /* point-coord y runs down, view y up */
    '    if (spd < 0.05) { vStretch = 0.0; vAng = 0.0; }',
    /* a stretched sprite needs a bigger point to hold the streak */
    '    gl_PointSize = min(gl_PointSize * (1.0 + vStretch * 0.85), 300.0 * uDpr);',
    '    vCol = ciColor(aCi);',
    /* Brightness follows the same squeezed scale, floored so the
       faintest catalogued stars stay faint but never vanish. */
    '    vAlpha = clamp(pow(10.0, -0.145 * (mCam - 2.0)), 0.30, 1.0);',
    '    gl_Position = projectionMatrix * mv;',
    '}'
].join('\n');
var STAR_FRAG = [
    'precision mediump float;',
    'uniform float uPeakComp;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vGlow;',
    'varying float vShim;',
    'varying float vStretch;',
    'varying float vAng;',
    'void main() {',
    '    vec2 q = gl_PointCoord - 0.5;',
    /* velocity streaks: the vertex stage enlarged the point to hold
       the streak (grow) — undo that so the profile keeps its
       authored size across the track, then measure the radius with
       the along-track axis divided by the stretch, and spread the
       same total light over the longer sprite (the divisor on a) */
    '    vec2 qd = q * (1.0 + vStretch * 0.85) * 2.0;',
    '    float ca = cos(vAng), sa = sin(vAng);',
    '    float along = qd.x * ca + qd.y * sa;',
    '    float cross = -qd.x * sa + qd.y * ca;',
    '    float d = length(vec2(along / (1.0 + vStretch), cross));',
    /* Push the colour away from grey — starlight should read as
       colour (white, pale blue, yellow, orange, red), not as noise. */
    '    vec3 col = mix(vec3(dot(vCol, vec3(0.3333))), vCol, 1.30);',
    '    float g = max(0.0, 1.0 - d * d);',
    '    float g2 = g * g;',
    '    float core = g2 * g2 * g2 * g2 * g * (1.0 + 0.35 * vGlow);',
    '    float halo = g2 * (0.20 + 0.85 * vGlow);',
    /* light division: full conservation up to a stretch of 2.5
       (identical to the old divisor there), then a much slower
       rate — at warp the streak stays lit instead of spreading
       itself into invisibility (see STAR_VERT) */
    '    float a = clamp(core + halo, 0.0, 1.0) * vAlpha * vShim / (1.0 + min(vStretch, 2.5) * 0.8 + max(vStretch - 2.5, 0.0) * 0.12);',
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
    /* uPeakComp: the adaptive-resolution ladder trades buffer
       pixels for frame rate, and a star's core is the sharpest
       peak in the scene — at a lower buffer resolution the peak
       is sampled by fewer, larger pixels and the light that
       should cross the bloom threshold falls short of it, so
       the whole field reads dimmer exactly when the GPU is
       working hardest (fast flight through dense fields). The
       compensation raises the HDR core drive as the ladder
       descends, sized from the ladder measurement in the
       quality-pass report, so a star's bloomed brightness is
       the same at every rung. */
    '    col *= 1.0 + core * vGlow * 2.8 * uPeakComp;',
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
    '    gl_PointSize = clamp(px, 4.0, 320.0) * uDpr;',   /* cap 420 -> 320 (2026-11-25): a single haze sprite may not fill the frame */
    '    vCol = ciColor(aCiW);',
    /* A cell you are inside, or right beside, must not white out the
       view — the haze belongs to the distance. DEEP-FIELD PASS
       (2026-11-25): the fade now spans 0.45–1.5 diameters — cells
       within a diameter and a half of the camera contribute almost
       nothing. The old 0.06–0.70 span let the cells beside the
       camera paint the giant soft blobs that filled Johnny's
       deep-field recording with brown murk at every range. */
    '    float close = smoothstep(0.45, 1.50, dist / aDiam);',
    /* From far out the whole layer stacks into a small patch of sky;
       dim it so the island glows instead of blowing out. DEEP-FIELD
       PASS (2026-11-25): the falloff now bites much sooner and
       deeper (380 pc scale, 0.05 floor) — at intergalactic range
       thousands of these warm sprites stacked along the sightline
       into the muddy brown murk of Johnny's recording. The haze
       thins with distance; the galaxies carry the far field. */
    '    float far = clamp(380.0 / dist, 0.05, 1.0);',
    /* The fabric breathes: a slow undulation travelling across the
       field, phased by each cell's real position. */
    '    float und = 0.84 + 0.16 * sin(uTime * 0.12 + dot(position, vec3(0.011, 0.0073, 0.0091)));',
    '    vAlpha = uAlpha * (0.06 + 0.94 * aW) * close * far * und;',   /* floor 0.22 -> 0.06 (2026-11-25): every cell used to glow at a fifth strength even with almost no summed light in it — the murk's base coat */
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
    /* photographic hero tiles (quality pass, 2026-11-21): aHero is
       the tile number + 1 in universe-heroes.jpg (0 = no photo),
       aHeroRot the rotation that aligns the photograph with this
       galaxy's catalogued major axis; both filled in when the
       hero manifest lands (buildHeroes) */
    'attribute float aHero;',
    'attribute float aHeroRot;',
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
    'varying float vHero;',
    'varying float vHeroRot;',
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
    '    vHero = aHero;',
    '    vHeroRot = aHeroRot;',
    /* Procedural form (arms, clumps) only resolves once the sprite is
       big enough to carry it; far specks keep the smooth profile. */
    '    vDetail = clamp(px / 42.0, 0.0, 1.0);',
    '    float a = aBright;',
    /* No through-fade (Johnny, 2026-11-24): a galaxy you fly to
       stays — approaching, entering and passing its centre never
       dissolves it, and looking back shows it still there. The
       old smoothstep(0.10, 0.55, dist / aDiam) term erased a
       galaxy from inside half its own diameter outward: at
       0.19x Centaurus A's diameter it had already vanished. */
    /* DEEP-FIELD PASS (Johnny, 2026-11-25, over his phone
       recording): at intergalactic range the old floor (0.35–0.48
       of authored brightness) sank every distant galaxy into the
       glow haze and the field collapsed to muddy brown blur. A
       real deep field is dense and luminous: distant galaxies now
       keep most of their authored brightness (floor 0.85 named /
       0.70 cloud, reached sooner), so the far field reads as
       distinct galaxies, not smears. Same catalog, same positions
       — only the fade is lifted. */
    '    a *= clamp(px / 1.6, mix(0.85, 0.70, uHalo), 1.0);',
    '    vAlpha = a;',
    '    gl_Position = projectionMatrix * mv;',
    '}'
].join('\n');
var GAL_FRAG = [
    'precision mediump float;',
    'uniform float uHalo;',   /* 1 for the named set, 0 for the cloud */
    'uniform float uPeakComp;',
    'uniform float uHeroW;',   /* 0 until the hero atlas has landed */
    'uniform sampler2D tHeroes;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vAng;',
    'varying float vAxis;',
    'varying float vTint;',
    'varying float vSeed;',
    'varying float vDetail;',
    'varying vec2 vQ;',
    'varying float vHero;',
    'varying float vHeroRot;',
    'void main() {',
    '    vec2 q = vQ;',                          /* profile units: 0.5 = catalogued edge; the quad reaches 0.75 */
    '    float ca = cos(vAng), sa = sin(vAng);',
    '    vec2 p = mat2(ca, -sa, sa, ca) * q;',   /* into the galaxy frame (still tilt-squeezed — the frame a photograph lives in) */
    '    vec2 r = p;',
    '    r.y /= max(0.10, vAxis);',              /* undo the tilt squeeze */
    '    float d = length(r) * 2.0;',            /* 1.0 = catalogued edge */
    /* DEEP-FIELD PROFILE (2026-11-25): while a galaxy is a far
       speck, its light is drawn through a compressed profile
       (dP = d x 1.5) — a tight, bright-cored disc like a galaxy
       on a deep-field plate — relaxing to the true profile as
       the galaxy resolves (vDetail -> 1). The feather, the halo
       and the hero photo keep the true d. */
    '    float dP = d * mix(1.5, 1.0, vDetail);',
    '    if (d > 1.52) discard;',                /* outside the feather — keeps the padded quad cheap */
    '    float ang = atan(r.y, r.x);',
    '    vec3 col = vCol;',
    '    float lum;',
    '    if (vTint < 0.5) {',
    /* Elliptical: smooth and centrally concentrated (a de Vaucouleurs-
       like fall), warm throughout, whiter at the heart. */
    '        float lumFarE = exp(-pow(dP, 0.65) * 3.4) * 0.75 + exp(-dP * dP * 20.0) * 0.85;',
    '        lum = lumFarE * lumFarE * 1.35;',
    '        col = mix(vCol, vec3(1.0, 0.96, 0.90), exp(-d * d * 14.0) * 0.55);',
    '    } else if (vTint < 1.5) {',
    /* Spiral: a warm core, then two logarithmic arms winding out;
       the rim runs bluer than the heart — a rendering convention for
       young disk stars vs old core stars, not catalogued colour. */
    '        float armPh = 2.0 * (ang - 2.6 * log(d + 0.06) + vSeed * 6.2831);',
    '        float arms = pow(0.5 + 0.5 * cos(armPh), 3.0);',
    '        float diskL = exp(-dP * dP * 3.2) * (0.35 + 0.85 * arms * smoothstep(0.03, 0.30, dP));',
    '        float coreL = exp(-dP * dP * 18.0) * 1.1;',
    '        float lumFarS = exp(-dP * dP * 4.5) * 0.6 + coreL;',
    '        lum = mix(lumFarS * lumFarS * 0.55, diskL + coreL, vDetail);',
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
    '        float lumFarI = exp(-dP * dP * 4.5) * 0.6;',
    '        lum = mix(lumFarI * lumFarI * 1.4, clumps, vDetail);',
    '        col = mix(vCol, vec3(0.80, 0.88, 1.05), 0.35);',
    '    }',
    /* DEEP-FIELD NUCLEUS (2026-11-25): while a galaxy is still a
       far speck (vDetail near 0) give it the compact bright core a
       real galaxy shows in a deep-field plate — a tight nucleus
       the soft profile alone never draws — so distant galaxies
       read as bright-cored discs instead of fuzzy smears. Fades
       out as the galaxy resolves and its true form takes over. */
    '    lum += exp(-dP * dP * 30.0) * 0.95 * (1.0 - vDetail);',
    /* Named galaxies carry a wide, soft halo beyond their catalogued
       edge — the same starlight-glow treatment as the star field —
       so the showpieces (Andromeda, M87, the Magellanic Clouds) read
       with real presence instead of ending at a hard rim. */
    '    lum += exp(-d * d * 3.2) * 0.34 * uHalo;',
    '    lum *= 1.0 + 0.18 * uHalo;',
    /* The feather: the exponentials above still carry light at the
       catalogued edge (~0.10 for a named elliptical), which is what
       printed the old square rim where the point sprite cut them
       off. The window takes the profile to exactly zero by d = 1.5,
       the quad's own edge, so no straight edge can ever show. */
    '    lum *= 1.0 - smoothstep(1.28, 1.5, d);',
    '    float a = clamp(lum, 0.0, 1.0) * vAlpha;',
    /* PHOTOGRAPHIC HEROES (quality pass, 2026-11-21): for the
       named galaxies a real photograph exists of (universe-
       heroes.jpg — NASA/ESA/ESO/NOIRLab press images, sources
       and licences in the credits), the photograph takes over
       as the galaxy resolves: the procedural form is the far
       view and the stand-in wherever no photo exists, and the
       photo — fitted by its long edge to the catalogued
       diameter, rotated onto the catalogued major axis, its
       black sky contributing nothing under additive blending —
       fades in over it on approach. The wide named halo and
       the feather are the procedural layer's and stay. */
    '    if (uHalo > 0.5 && vHero > 0.5 && uHeroW > 0.001) {',
    '        float chr = cos(vHeroRot), shr = sin(vHeroRot);',
    '        vec2 hp = mat2(chr, -shr, shr, chr) * p;',
    '        vec2 huv = hp * 1.024 + 0.5;',   /* the tile holds the photo at 1000 of 1024 px */
    '        if (all(greaterThanEqual(huv, vec2(0.001))) && all(lessThanEqual(huv, vec2(0.999)))) {',
    '            float tile = vHero - 1.0;',
    '            vec2 auv = (vec2(mod(tile, 4.0), floor(tile / 4.0)) + vec2(huv.x, 1.0 - huv.y)) / vec2(4.0, 3.0);',
    '            vec3 ph = texture2D(tHeroes, auv).rgb;',
    '            float phLum = dot(ph, vec3(0.299, 0.587, 0.114));',
    '            float hw = uHeroW * smoothstep(0.20, 0.65, vDetail);',
    /* The photo hands back to the procedural layer before the
       tile's edge: inside the box the mix replaces the alpha
       that carries the wide halo, so an unfeathered box cut the
       halo off along the tile's straight rotated edge — a
       square outline around the galaxy, its corners standing
       in the view as translucent wedges (Johnny's screenshot,
       2026-11-24). Feathering hw to zero by |hp| = 0.487, the
       box edge, keeps the halo continuous across it. */
    '            hw *= 1.0 - smoothstep(0.40, 0.487, max(abs(hp.x), abs(hp.y)));',
    '            float heroA = clamp(phLum * 1.7, 0.0, 1.0) * vAlpha * (1.0 - smoothstep(1.28, 1.5, d));',
    '            col = mix(col, ph, hw);',
    '            a = mix(a, heroA, hw);',
    '            lum = mix(lum, phLum * 1.15, hw);',
    '        }',
    '    }',
    '    if (a < 0.004) discard;',
    /* QUALITY PASS: same HDR treatment as the stars — the
       authored colour linearises, and a core multiplier driven
       by the galaxy's own rendered luminance pushes only the
       brightest cores (Andromeda class) over the bloom
       threshold. uPeakComp is the resolution ladder's make-good
       (see STAR_FRAG). */
    '#if HDR_LINEAR',
    '    col = pow(max(col, vec3(0.0)), vec3(2.2));',
    '    col *= 1.0 + pow(clamp(lum, 0.0, 1.0), 3.0) * 1.8 * uPeakComp;',
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
    '    vFade = 1.0;',   /* no close-range fade (Johnny, 2026-11-24): a nebula persists as you arrive and pass through, like the galaxies — the old smoothstep(0.35, 1.4, dist / aDiam) dissolved it on approach */
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
    var hudGate = { t: 0, d: '', s: '', n: '' };   /* atomic-swap gate for the HUD readouts (see frame()) */
    var hudNearStr = '';   /* the nearest-object string, composed by updateNearest, written ONLY by frame()'s gated block */
    var captionEl = $('.uv-caption');
    var captionTextEl = $('.uv-caption-text');
    var captionCloseBtn = $('.uv-caption-close');
    var labelsEl = $('.uv-labels');
    var tourBtn = $('.uv-tour-btn'), flyBtn = $('.uv-fly-btn');
    var speedInput = $('.uv-speed');
    var moreBtn = $('.uv-more-btn'), panel = $('.uv-panel');
    var panelClose = $('.uv-panel-close');
    var searchInput = $('.uv-search'), searchGo = $('.uv-search-go'), dataList = $('.uv-datalist');
    var labelsToggle = $('.uv-labels-toggle'), cloudToggle = $('.uv-cloud-toggle');
    var mouseBtn = $('.uv-mouse-btn'), resetBtn = $('.uv-reset-btn');

    /* EARTH FIRST (Johnny, 2026-11-26): the opening view is aimed at
       Earth, so her maps are the critical path — start fetching them
       now, at init, ahead of the catalog and every beauty asset.
       Plain Image() preloads warm the HTTP cache; the TextureLoader
       calls that actually build her (buildSolarSystem for the plain
       map, startEarthStack for the stack) then complete from cache
       instead of queueing behind the other planets' maps in one
       burst. The array is kept so the browser cannot collect the
       preloads mid-flight. A failed preload costs nothing: the
       TextureLoader path still makes its own attempt. */
    var earthPreload = [];
    ['earth.jpg', 'earth-day.jpg', 'earth-night.jpg', 'earth-clouds.jpg', 'earth-spec.jpg', 'earth-normal.jpg']
        .forEach(function (f) {
            var im = new Image();
            im.src = new URL('./planets/' + f, import.meta.url).href;
            earthPreload.push(im);
        });

    var ctrl = {
        ready: false, active: false, mode: 'free',
        setActive: function (on) {
            ctrl.active = !!on;
            if (!ctrl.active && typeof lockSet === 'function') lockSet(false);   /* closing the game releases the lock */
            if (ctrl.active && ctrl.ready && !rafId) { lastT = performance.now(); rafId = requestAnimationFrame(frame); }
            if (!ctrl.active && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        },
        getState: function () {
            return {
                ready: ctrl.ready, mode: ctrl.mode,
                camPos: [camPos.x, camPos.y, camPos.z],
                speedPc: speedPc(), starCount: data ? data.starCount : 0,
                galCount: data ? data.galCount : 0,
                nearest: nearestName, tourShot: tour.index,
                lockOn: lockState.on, lockName: lockState.on ? lockState.name : ''
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
    /* quality pass (2026-11-21): the near-home photographic sky
       layer, the hero-galaxy manifest + named-cloud attributes,
       and the camera-velocity state behind the star streaks */
    var panoSky = null, panoTex = null;
    var heroesManifest = null, heroAttrs = null, heroTex = null;
    var prevCamPos = null, velViewSm = new THREE.Vector3();
    var solarGroup = null, solarBodies = null;
    var earthSys = null;   /* Earth texture-stack refs (set in buildSolarSystem) */
    var earthStackState = { started: false, ready: false, blend: 0 };
    var sysSurf = Infinity, sysRad = 0;   /* nearest solar-body surface distance + that body's radius */
    var sysBodyPos = null;                /* nearest solar body's centre (approach governor) */
    var govTmp = new THREE.Vector3();
    var popEdge = 0, popK = 0;                /* the mapped universe's edge (pc, from the catalog) + the edge governor's ease constant */
    var edgeTmp = new THREE.Vector3();
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
    var nearestName = '', nearestDist = Infinity, nearestBi = -1;
    var flyAnim = null;        /* jump-to flight */
    var tour = { on: false, index: 0, t: 0, dwell: 0, keys: [] };
    var markedName = '';       /* the last jump-to target — the place the marked-object caption claims */
    var captionClaim = null;   /* what the caption currently claims: null | {kind:'earth'} | {kind:'object', name} */
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
    var DPR_STEPS = [1, 0.92, 0.84, 0.76, 0.7];   /* fidelity pass, 2026-11-25: floor raised from 0.4 — see the ladder comment in frame() */
    var labelPool = [];
    var tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpM = new THREE.Matrix4();

    function speedPc() {
        return Math.pow(10, -2.7 + speedT * 8.3);   /* 0.002 .. 400,000 pc/s */
    }
    /* PROXIMITY SPEED REGIME (Johnny, 2026-11-26, after a real-
       browser session on the live game): the slider's slowest gear
       is 0.002 pc/s — some ten thousand Earth radii per second —
       so in real flight there was NO way to approach a planet
       slowly: a 3.2 s hold at minimum speed overshot Earth by
       ~1 AU, tile range could not be lingered in, and the tile
       layer was unreachable in practice even though it worked.
       The regime: within ~80 radii of the nearest body's surface,
       the effective speed crossfades (geometrically, in log space)
       from the slider's open-space speed to a BODY-SCALED speed —
       altitude x 10^(-1.6 + 2.4 x speedT) per second: at the
       default slider that is ~0.2 altitudes per second (a stately,
       controllable descent), at minimum a 0.025-altitudes-per-
       second creep (a true slow gear for inspecting tiles), at
       maximum ~6 altitudes per second. The slider keeps its full
       exponential authority in both regimes; in open space nothing
       changes at all. The HUD speed line reads this effective
       speed, so what it says is what you fly. The approach
       governor below still caps head-on dives on top of this. */
    function proxSpeed() {
        var sp = speedPc();
        if (!solarBodies || !solarBodies.length) return sp;
        var best = Infinity, br = 1;
        for (var i = 0; i < solarBodies.length; i++) {
            var gs = camPos.distanceTo(solarBodies[i].pos) - solarBodies[i].r;
            if (gs < best) { best = gs; br = solarBodies[i].r; }
        }
        var u = best / br;
        if (u >= 80) return sp;
        var t = (Math.log10(Math.max(u, 1e-3)) - Math.log10(20)) / (Math.log10(80) - Math.log10(20));
        t = Math.max(0, Math.min(1, t));
        var w = 1 - t * t * (3 - 2 * t);
        var spNear = Math.max(best, br * 1e-4) * Math.pow(10, -1.6 + 2.4 * speedT);
        return Math.exp((1 - w) * Math.log(sp) + w * Math.log(Math.max(spNear, 1e-12)));
    }
    /* The caption card is a brief transient explanation, never a
       fixture (Johnny, 2026-11-26: the boot card sat on the stage
       covering its bottom third, with no way off it — the old
       setCaption only ever swapped the words). A presented card
       dismisses three ways: its own timer (~6 s), the player's
       first real input, and its close button. setCaption presents
       by default; the silent form (present = false) only swaps the
       words — the reconciler's fallback and the grab-the-view path
       use it, because a grab is itself a dismissal, never a reason
       to raise a new card. While the tour or a jump flight owns the
       screen the timer waits: those paths set their own cards as
       their events unfold, and the arrival card at the end of a
       jump gets its own full read. */
    var capTimer = null;
    function presentCaption() {
        captionEl.classList.remove('uv-cap-off');
        if (capTimer) clearTimeout(capTimer);
        capTimer = setTimeout(capTimerFire, 6000);
    }
    function capTimerFire() {
        capTimer = null;
        if (tour.on || flyAnim) { capTimer = setTimeout(capTimerFire, 1000); return; }
        dismissCaption();
    }
    function dismissCaption() {
        if (capTimer) { clearTimeout(capTimer); capTimer = null; }
        captionEl.classList.add('uv-cap-off');
    }
    function setCaption(text, present) {
        /* every call is an event, so a presenting call presents even
           when the words repeat the card already showing — arriving
           at a second marked object carries the same sentence as the
           first, and it must still raise the card (the text-equality
           shortcut here once swallowed exactly that re-presentation) */
        if (captionTextEl.textContent !== text) captionTextEl.textContent = text;
        if (present !== false) presentCaption();
    }
    var EARTH_CAP = 'You are at Earth \u2014 home. Every light around you is a real star at its true position. Drag to look \u00B7 hold Fly (or press W) to fly anywhere \u00B7 scroll for speed. The tour is there when you want it.';
    var CONTROLS_CAP = 'You have the controls. Drag to look around; hold Fly \u2014 or press W \u2014 to move.';
    /* The caption is a place card, not a log: a caption that names
       where you are must stay true as you fly. Free flight moves
       the camera without ever touching the caption, so the boot
       card ("You are at Earth") used to stay on screen 12 million
       light-years out, contradicting both live readouts (Johnny's
       screenshot, 2026-11-24). The reconciler runs on the HUD's
       own cadence, in free flight only: a claim whose place no
       longer matches the live Nearest readout falls back to the
       neutral controls card, and flying home under your own power
       restores the Earth card. Tour and jump captions are events,
       set and cleared by the paths that own them. */
    function syncCaption() {
        if (tour.on || flyAnim) return;
        if (captionClaim && captionClaim.kind === 'earth' && nearestName !== 'Earth') {
            captionClaim = null; setCaption(CONTROLS_CAP, false);
        } else if (captionClaim && captionClaim.kind === 'object' &&
                   (nearestName !== captionClaim.name || nearestDist > captionClaim.dist * 2.5)) {
            /* flown to another object's neighbourhood, or flown
               away again — the arrival card has expired either way */
            captionClaim = null; setCaption(CONTROLS_CAP, false);
        } else if (!captionClaim && nearestName === 'Earth' && captionTextEl.textContent === CONTROLS_CAP) {
            captionClaim = { kind: 'earth' }; setCaption(EARTH_CAP);
        }
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
    /* The hero galaxies' photographs live in their own pair of
       files, on the nebulae precedent: universe-heroes.json maps
       catalog names to tiles of universe-heroes.jpg (real press
       photographs — NASA/ESA/ESO/NOIRLab; sources and licences
       in the site credits) with the rotation that aligns each
       photograph to its galaxy's catalogued major axis. A failed
       fetch simply leaves every galaxy procedural; the game runs
       without the layer. */
    function loadHeroes() {
        var url = new URL('./universe-heroes.json', import.meta.url);
        return fetch(url).then(function (resp) { return resp.ok ? resp.json() : null; })
            .then(function (j) { if (j && Array.isArray(j.tiles)) heroesManifest = j; })
            .catch(function () { /* enhancement layer — never fatal */ });
    }
    function buildHeroes() {
        if (!heroesManifest || !heroAttrs || !galNamedPoints) return;
        var byName = {};
        heroesManifest.tiles.forEach(function (t) { byName[t.name] = t; });
        var filled = 0;
        /* the named cloud's instances are the named galaxies in
           catalog order — each named entry carries its own galaxy
           index (e.i), which is the instance index to fill */
        data.named.forEach(function (e) {
            if (e.k !== 1 || e.i >= heroAttrs.count) return;
            var t = byName[e.n];
            if (t) {
                heroAttrs.hero.array[e.i] = t.tile + 1;
                heroAttrs.rot.array[e.i] = t.rot || 0;
                filled++;
            }
        });
        if (!filled) return;
        heroAttrs.hero.needsUpdate = true;
        heroAttrs.rot.needsUpdate = true;
        heroTex = new THREE.TextureLoader().load(
            new URL('./universe-heroes.jpg', import.meta.url).href,
            function () {
                galNamedPoints.material.uniforms.tHeroes.value = heroTex;
                galNamedPoints.material.uniforms.uHeroW.value = 1;
                if (galCloudPoints) {
                    galCloudPoints.material.uniforms.tHeroes.value = heroTex;
                }
            },
            undefined,
            function () { /* atlas failed — galaxies stay procedural */ });
        heroTex.colorSpace = THREE.SRGBColorSpace;
        heroTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
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

    /* ---------------- the near-home photographic sky ----------------
       The backdrop above is the catalog's own light summed into
       directions — honest, but smoothed: no photograph of the real
       sky has ever been in the game. Near home there IS a real sky
       to show: ESO's GigaGalaxy Zoom panorama (eso0932a, ESO /
       S. Brunier, CC BY 4.0) — the whole celestial sphere
       photographed from Earth's darkest sites, in galactic
       coordinates. This layer puts that photograph around the
       player, oriented by the true galactic frame (its centre
       toward the real galactic centre, its pole on the real north
       galactic pole), at full strength at home. It is a photograph
       OF HOME'S SKY, so it belongs only near home: it fades out
       between 1.5 and 25 kpc from the Sun, and beyond that the
       catalog floor — light that is really there in the data —
       is the sky again. The pano texture's own orientation inside
       its file (u direction, v sense, centre offset) was measured
       off the image itself at bake time (the galactic centre's and
       the Large Magellanic Cloud's pixel positions fix all three)
       and is carried in the texture transform below. */
    function buildPanoSky() {
        var mat = new THREE.MeshBasicMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false,
            transparent: true, opacity: 0
        });
        mat.color.setScalar(0.9);
        var mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
        mesh.renderOrder = -2;
        mesh.frustumCulled = false;
        /* the galactic frame in equatorial components (J2000):
           X toward the galactic centre (RA 17.7611h, Dec -29.0078),
           Z toward the north galactic pole (RA 12.8567h, +27.1284),
           Y completes the right-handed triad */
        function eq(raH, decD) {
            var ra = raH * Math.PI / 12, dec = decD * Math.PI / 180;
            return new THREE.Vector3(Math.cos(dec) * Math.cos(ra),
                                     Math.cos(dec) * Math.sin(ra),
                                     Math.sin(dec));
        }
        var gx = eq(17.7611, -29.0078), gz = eq(12.8567, 27.1284);
        var gy = new THREE.Vector3().crossVectors(gz, gx).normalize();
        gx = new THREE.Vector3().crossVectors(gy, gz).normalize();
        var m = new THREE.Matrix4().makeBasis(gx, gy, gz);
        mesh.quaternion.setFromRotationMatrix(m);
        mesh.quaternion.premultiply(new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
        panoTex = new THREE.TextureLoader().load(
            new URL('./milkyway-pano.jpg', import.meta.url).href,
            function () {
                mat.map = panoTex;
                mat.needsUpdate = true;
            },
            undefined,
            function () { panoTex = null; /* layer stays out */ });
        panoTex.colorSpace = THREE.SRGBColorSpace;
        /* measured off the source image at bake time: the panorama
           is centred on the galactic centre with longitude running
           right-to-left as published; the wrap and offset below put
           l=0 at the texture seam the sphere expects */
        panoTex.wrapS = THREE.RepeatWrapping;
        panoTex.repeat.x = -1;
        return mesh;
    }

    /* ---------------- the solar system ----------------
       The catalog's frame reaches down to the Sun, but the planets
       were never in it — Earth was not a place you could go. These
       ten bodies are placed at their true heliocentric positions
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
        /* The Moon (quality pass, 2026-11-21 — she was never in the
           game). Her direction from Earth and her size against
           Earth are true: the geocentric direction for this same
           epoch by Schlyter's lunar algorithm (true distance
           393,133 km that day), radius 0.2727x Earth's. Her DISTANCE
           cannot be true at the game's drawn scales — at true
           proportion she would sit inside the drawn Earth — so she
           stands 6 drawn Earth radii out in the true direction, the
           same class of liberty as the planets' 1,000x radii,
           stated in the About text. Texture: the Moon map of the
           same Solar System Scope set as the planets (built from
           NASA LRO/Clementine data), grey and cratered as she is. */
        { n: 'Moon',    p: [3.839893e-6, 3.192515e-6, 1.409463e-6],    r: 5.631e-8, tex: 'moon.jpg',    pole: [17.888, 65.64] },
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
       and — preloaded at init and started at scene build
       (startEarthStack, below; EARTH FIRST, 2026-11-26) — NASA's
       Blue Marble day map, the
       VIIRS night-lights map, and the Visible Earth cloud
       composite (planets/earth-day.jpg / earth-night.jpg /
       earth-clouds.jpg; fetch_earth_stack.py records the sources).
       The 2026-11-21 quality pass raises the day and night maps
       to 8192x4096 renditions and adds the stack's two physical
       layers: planets/earth-spec.jpg, the land/ocean specular
       mask behind the ocean's sun-glint, and planets/earth-
       normal.jpg, the terrain relief map (both Solar System
       Scope renditions of NASA data, CC BY 4.0). They gate only
       themselves — Earth never waits on them. The shader reproduces the game's
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
        'varying vec3 vTV;',
        'void main() {',
        '    vUv = uv;',
        '    vNV = normalize(normalMatrix * normal);',
        /* the east tangent of the sphere, from the geometry itself:
           for the sphere's own parametrisation the direction of
           increasing longitude at a vertex is (z, 0, x) of its
           object position — the frame the relief map is read in */
        '    vec3 tObj = vec3(position.z, 0.0, position.x);',
        '    vTV = normalize(normalMatrix * (length(tObj) > 0.001 ? tObj : vec3(1.0, 0.0, 0.0)));',
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
        'varying vec3 vTV;',
        'uniform sampler2D tLow;',
        'uniform sampler2D tDay;',
        'uniform sampler2D tNight;',
        'uniform sampler2D tSpec;',
        'uniform sampler2D tNrm;',
        'uniform float uBlend;',
        'uniform float uHasLow;',
        'uniform float uHasStack;',
        'uniform float uHasSpec;',
        'uniform float uHasNrm;',
        'uniform vec3 uSunVP;',
        SRGB_ENC_GLSL,
        'void main() {',
        '    vec3 N = normalize(vNV);',
        /* terrain relief (quality pass, 2026-11-21): the stack's
           normal map tilts the shading normal by the real terrain
           — mountain ranges and ocean trenches shade against the
           sun instead of the day map's baked suggestion of them.
           Fades in with the stack's own blend, like everything
           else in it, and only ever touches the stack's Earth. */
        '    if (uHasStack > 0.5 && uHasNrm > 0.5) {',
        '        vec3 tN = texture2D(tNrm, vUv).rgb * 2.0 - 1.0;',
        '        vec3 T = normalize(vTV);',
        '        vec3 B = cross(N, T);',
        '        N = normalize(N + (T * tN.x + B * tN.y) * (uBlend * 0.85));',
        '    }',
        '    vec3 L = normalize(uSunVP - vVP);',
        '    float ndl = dot(N, L);',
        /* before any map lands, a dark slate silhouette (Johnny,
           2026-11-26: the old 0x888888-equivalent grey, lit by the
           day term below, rendered ~0.78 sRGB — a featureless white
           ball that read almost like the sun). Deep blue-slate in
           linear space: the same lighting leaves it a dark planet
           silhouette against space — never white, never a light
           source, unmistakably a planet once the rim is on it. */
        '    vec3 day = vec3(0.010, 0.020, 0.038);',
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
        /* ocean sun-glint (quality pass, 2026-11-21): the specular
           map is the real land/ocean mask — land contributes
           nothing, open water throws a Blinn-Phong glint back at
           the camera around the sun's mirror point, the single
           strongest "this is a real planet" cue a still orbit
           view has. It rides the stack blend like the rest. */
        '    if (uHasStack > 0.5 && uHasSpec > 0.5) {',
        '        float ocean = texture2D(tSpec, vUv).r;',
        '        vec3 V = normalize(-vVP);',
        '        vec3 H = normalize(L + V);',
        '        float spec = pow(max(dot(N, H), 0.0), 42.0) * ocean;',
        '        col += vec3(1.0, 0.97, 0.92) * spec * 0.55 * uBlend;',
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
    /* ---------------- Earth's streamed tile layer ----------------
       From far away Earth is the fidelity-max globe texture, as
       always. Below about one Earth radius of altitude this layer
       streams Web-Mercator satellite/aerial tiles (Esri World
       Imagery — credits on credits.html) for the ground the screen
       actually shows, at the zoom whose ground resolution matches
       the screen, up to zoom 18 (about a foot per pixel over most
       US and European cities — individual rooftops, cars, trees).
       Discipline, by construction:
       - Tiles are patches of the same sphere, in Earth's own local
         frame (the frame the base texture is painted in), each
         level floated a hair above the level below it, so a parent
         tile is already on screen, stretched, before its sharper
         children arrive, and the globe itself is the ultimate
         parent under everything. There is never a hole.
       - Only the visible patch is fetched (screen corners and edge
         midpoints unprojected onto the sphere, plus a margin), the
         wanted set is bounded, and a bounded LRU cache keeps the
         session's ground with it.
       - If the tile source cannot be reached, or fails repeatedly,
         the layer quietly stops asking and today's globe remains,
         exactly as before this layer existed. */
    var ET_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/';
    /* Streamed survey tiles, one layer per surveyed body (Johnny,
       2026-11-26: "explore Earth... and also the Moon and Mars and
       other planets that we know exactly what they look like").
       Earth is the flagship: Esri World Imagery (Web Mercator
       slippy tiles, verified live 2026-11-25 — 200s, CORS *, the
       layer engages on descent and the parents hold until children
       arrive). The Moon and Mars ride the same engine on NASA Trek
       WMTS mosaics (equirectangular grid, 2^(z+1) x 2^z tiles of
       256px, top-left -180/90; endpoints verified 2026-11-26 the
       same way: real tile fetches 200, Access-Control-Allow-
       Origin: *, capabilities read for the matrix sets — Moon
       LRO WAC global mosaic z0-8, Mars Viking MDIM 2.1 colour
       mosaic z0-7; NASA/USGS public-domain survey data).
       Engagement widened the same day: the pump runs 12 concurrent
       fetches (was 6 — a fast descent outran the layer and the
       tiles never caught up), and inside 3 radii the entry-level
       set around the ground point is prefetched, so the first
       tiles are already on the globe when the layer engages. */
    function newTileLayer(cfg) {
        return {
            cfg: cfg, grp: null, sysPos: null, R: 0, cache: new Map(), queue: [], inflight: 0,
            meshes: new Map(), key: '', lastCheck: 0, dirty: false,
            dead: false, errRun: 0, wantN: 0, z: -1, lastH: -1, lastLat: 0, lastLon: 0,
            MAXC: 168, MAXSET: 96, MAXFLY: 12, SEG: 10
        };
    }
    var et = newTileLayer({
        grpName: 'earthTiles', proj: 'merc', zMin: 6, zMax: 18,
        url: function (z, y, x) { return ET_URL + z + '/' + y + '/' + x; }
    });
    var tileMoon = newTileLayer({
        grpName: 'moonTiles', proj: 'eq', zMin: 5, zMax: 8,
        url: function (z, y, x) {
            return 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/' + z + '/' + y + '/' + x + '.jpg';
        }
    });
    var tileMars = newTileLayer({
        grpName: 'marsTiles', proj: 'eq', zMin: 5, zMax: 7,
        url: function (z, y, x) {
            return 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/' + z + '/' + y + '/' + x + '.jpg';
        }
    });
    var tileMercury = newTileLayer({
        grpName: 'mercuryTiles', proj: 'eq', zMin: 5, zMax: 6,
        url: function (z, y, x) {
            return 'https://trek.nasa.gov/tiles/Mercury/EQ/Mercury_MESSENGER_MDIS_Basemap_EnhancedColor_Mosaic_Global_665m/1.0.0/default/default028mm/' + z + '/' + y + '/' + x + '.jpg';
        }
    });
    var tileLayers = [et, tileMoon, tileMars, tileMercury];
    /* ONE SOURCE OF TRUTH for high-definition coverage (Johnny,
       2026-11-26): a body carries the HD mark — beside its name in
       the HUD's Nearest line, in the Jump-to list, on its sky
       label, and on the Lock button — if and only if it has an
       entry here, and an entry exists if and only if a verified
       tile layer for that body is active in this build (the three
       layers above). The hint can never promise detail that is
       not there: add a layer, add its line here, and the mark
       follows everywhere on its own. */
    var TILE_COVERAGE = { Earth: et, Moon: tileMoon, Mars: tileMars, Mercury: tileMercury };
    function bodyHasHD(name) { return !!TILE_COVERAGE[name]; }
    var etQ = new THREE.Quaternion(), etV = new THREE.Vector3(), etV2 = new THREE.Vector3();

    function tileInit(L, grp, r, pos) {
        L.R = r; L.sysPos = pos;
        L.grp = new THREE.Group();
        L.grp.name = L.cfg.grpName;
        grp.add(L.grp);
    }
    function etKey(z, x, y) { return z + '/' + x + '/' + y; }
    function etTileY(lat, z) {
        var n = Math.pow(2, z);
        var m = Math.log(Math.tan(lat) + 1 / Math.cos(lat));
        return Math.max(0, Math.min(n - 1, Math.floor((1 - m / Math.PI) / 2 * n)));
    }
    function etTileYEq(lat, z) {
        var n = Math.pow(2, z);
        return Math.max(0, Math.min(n - 1, Math.floor((Math.PI / 2 - lat) / Math.PI * n)));
    }
    function etEntry(L, z, x, y) {
        var k = etKey(z, x, y), e = L.cache.get(k);
        if (!e) {
            e = { z: z, x: x, y: y, key: k, state: 'idle', tex: null, mat: null, geom: null, used: 0 };
            L.cache.set(k, e);
        }
        e.used = performance.now();
        return e;
    }
    function etGeom(L, z, x, y) {
        /* a patch of the sphere over the tile's lon range and its
           lat range, built in the body's local frame with the base
           sphere's own direction convention, so the imagery lands
           exactly where the globe's texture says it should. 'merc'
           rows follow Web Mercator (Earth/Esri); 'eq' rows are
           linear in latitude (the Trek grid: 2^(z+1) columns over
           360 degrees, 2^z rows over 180). */
        var SEG = L.SEG, n = Math.pow(2, z);
        var lonW, lonSpan, latOf;
        if (L.cfg.proj === 'eq') {
            lonW = (x / (2 * n)) * 2 * Math.PI - Math.PI; lonSpan = (2 * Math.PI) / (2 * n);
            var latT = Math.PI / 2 - (y / n) * Math.PI, latSpan = Math.PI / n;
            latOf = function (f) { return latT - latSpan * f; };
        } else {
            lonW = (x / n) * 2 * Math.PI - Math.PI; lonSpan = (2 * Math.PI) / n;
            var mT = Math.PI * (1 - 2 * y / n), mB = Math.PI * (1 - 2 * (y + 1) / n);
            latOf = function (f) { return Math.atan(Math.sinh(mT + (mB - mT) * f)); };
        }
        /* the lift above the globe is deliberately tiny: it only
           has to order the levels (polygonOffset does the rest of
           the separation work in depth space). A larger lift put
           the deepest patches exactly on the camera's near plane
           (0.4 x surface distance), which clipped the middle out
           of every patch — the first build's missing-tile seam.
           Counted from the layer's own entry zoom so a parent
           never sinks below the globe it covers. */
        var rad = L.R * (1 + (z - L.cfg.zMin + 1) * 3e-7);
        var pos = new Float32Array((SEG + 1) * (SEG + 1) * 3), nor = new Float32Array((SEG + 1) * (SEG + 1) * 3);
        var uv = new Float32Array((SEG + 1) * (SEG + 1) * 2), idx = [];
        var vi = 0, ui = 0;
        for (var j = 0; j <= SEG; j++) {
            var f = j / SEG, lat = latOf(f);
            var cl = Math.cos(lat), sl = Math.sin(lat);
            for (var i = 0; i <= SEG; i++) {
                var g = i / SEG, lon = lonW + lonSpan * g;
                var dx = cl * Math.cos(lon), dy = sl, dz = -cl * Math.sin(lon);
                pos[vi] = dx * rad; nor[vi] = dx; vi++;
                pos[vi] = dy * rad; nor[vi] = dy; vi++;
                pos[vi] = dz * rad; nor[vi] = dz; vi++;
                uv[ui++] = g; uv[ui++] = 1 - f;
            }
        }
        for (var j2 = 0; j2 < SEG; j2++) for (var i2 = 0; i2 < SEG; i2++) {
            var a = j2 * (SEG + 1) + i2, b2 = a + 1, c2 = a + SEG + 1, d2 = c2 + 1;
            idx.push(a, c2, b2, b2, c2, d2);
        }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(idx);
        return geo;
    }
    function etQueue(L, z, x, y, prio) {
        if (L.dead) return;
        var e = etEntry(L, z, x, y);
        if (e.state === 'idle') { e.state = 'queued'; L.queue.push({ e: e, p: prio }); }
    }
    function etPump(L) {
        if (L.dead) { L.queue.length = 0; return; }
        L.queue.sort(function (a, b) { return a.p - b.p; });
        while (L.inflight < L.MAXFLY && L.queue.length) {
            var item = L.queue.shift(), e = item.e;
            if (e.state !== 'queued') continue;
            e.state = 'loading'; L.inflight++;
            (function (en) {
                var img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () {
                    L.inflight--; en.state = 'ready'; L.errRun = 0;
                    var tex = new THREE.Texture(img);
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
                    tex.needsUpdate = true;
                    en.tex = tex; L.dirty = true; etPump(L); etEvict(L);
                };
                img.onerror = function () {
                    L.inflight--; en.state = 'failed';
                    /* only coarse tiles count toward giving up on the
                       source: deep-zoom gaps are regional (the parent
                       tile covers them), but if even the coarse world
                       fails two dozen times in a row the source is
                       unreachable — stop asking; the globe remains */
                    if (en.z <= L.cfg.zMin + 6 && ++L.errRun >= 24) L.dead = true;
                    etPump(L);
                };
                img.src = L.cfg.url(en.z, en.y, en.x);
            })(e);
        }
    }
    function etEvict(L) {
        if (L.cache.size <= L.MAXC) return;
        var arr = Array.from(L.cache.values()).filter(function (e) { return e.state === 'ready' || e.state === 'failed' || e.state === 'idle'; });
        arr.sort(function (a, b) { return a.used - b.used; });
        for (var i = 0; i < arr.length && L.cache.size > L.MAXC; i++) {
            var e = arr[i];
            if (L.meshes.has(e.key)) continue;   /* never evict what is on screen */
            if (e.tex) e.tex.dispose();
            if (e.geom) e.geom.dispose();
            if (e.mat) e.mat.dispose();
            L.cache.delete(e.key);
        }
    }
    function etWanted(L) {
        L.grp.getWorldQuaternion(etQ).invert();
        etV.copy(camPos).sub(L.sysPos).applyQuaternion(etQ);
        var d = etV.length(), R = L.R, h = d - R;
        L.lastH = h;
        if (d > 0) {
            L.lastLat = Math.asin(Math.max(-1, Math.min(1, etV.y / d)));
            L.lastLon = Math.atan2(-etV.z, etV.x);
        }
        if (!(h > 0) || h > R * 0.9) return null;
        var lat0 = L.lastLat;
        var lon0 = L.lastLon;
        var bufH = Math.max(200, renderer.domElement.height || 800);
        var visH = 2 * h * 0.52057;                    /* tan(27.5°): the camera's 55° vertical field */
        var z = Math.round(Math.log2((2 * Math.PI * R) / (256 * (visH / bufH))));
        /* the Trek grid packs the same 256px into half the angular
           span per tile (2^(z+1) columns), so its matched zoom sits
           one level lower for the same screen */
        if (L.cfg.proj === 'eq') z -= 1;
        z = Math.max(L.cfg.zMin, Math.min(L.cfg.zMax, z));
        var e = camera.matrixWorld.elements, tanV = 0.52057, tanH = tanV * camera.aspect;
        var pts = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0]];
        var laMin = Infinity, laMax = -Infinity, loMin = Infinity, loMax = -Infinity, miss = false;
        function grow(la, lo) {
            while (lo - lon0 > Math.PI) lo -= 2 * Math.PI;
            while (lo - lon0 < -Math.PI) lo += 2 * Math.PI;
            if (la < laMin) laMin = la; if (la > laMax) laMax = la;
            if (lo < loMin) loMin = lo; if (lo > loMax) loMax = lo;
        }
        grow(lat0, lon0);
        for (var pi = 0; pi < pts.length; pi++) {
            etV2.set(
                e[0] * pts[pi][0] * tanH + e[4] * pts[pi][1] * tanV - e[8],
                e[1] * pts[pi][0] * tanH + e[5] * pts[pi][1] * tanV - e[9],
                e[2] * pts[pi][0] * tanH + e[6] * pts[pi][1] * tanV - e[10]).normalize().applyQuaternion(etQ);
            var bq = etV.dot(etV2), cq = d * d - R * R, disc = bq * bq - cq;
            if (disc < 0) { miss = true; continue; }
            var t = -bq - Math.sqrt(disc);
            var hx = etV.x + etV2.x * t, hy = etV.y + etV2.y * t, hz = etV.z + etV2.z * t;
            var hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
            grow(Math.asin(Math.max(-1, Math.min(1, hy / hl))), Math.atan2(-hz, hx));
        }
        if (miss) {   /* some of the screen is sky: the horizon bounds the ground instead */
            var ah = Math.acos(Math.min(1, R / d));
            var dLon = Math.abs(Math.cos(lat0)) < 1e-6 ? Math.PI : Math.min(Math.PI, ah / Math.max(0.2, Math.cos(lat0)));
            grow(Math.max(-1.45, lat0 - ah), lon0 - dLon);
            grow(Math.min(1.45, lat0 + ah), lon0 + dLon);
        }
        var MERC = 1.4845;   /* Web Mercator ends at 85.0511°; the Trek grid runs to the poles */
        var laLim = L.cfg.proj === 'eq' ? 1.5707 : MERC;
        laMin = Math.max(-laLim, laMin); laMax = Math.min(laLim, laMax);
        var x0 = 0, x1 = 0, y0 = 0, y1 = 0;
        while (true) {
            /* margin: a quarter of the box, at least a third of a
               tile AT THIS ZOOM — a fixed angular floor here once
               forced the zoom five levels coarser than the screen
               needed, because a third of a degree is a hundred
               tiles at rooftop zoom */
            var n2 = Math.pow(2, z), nx2 = L.cfg.proj === 'eq' ? 2 * n2 : n2;
            var tSpan = (L.cfg.proj === 'eq' ? Math.PI : 2 * Math.PI) / n2;
            var tileY = L.cfg.proj === 'eq' ? etTileYEq : etTileY;
            var mLa2 = Math.max((laMax - laMin) * 0.25, tSpan * 0.35), mLo2 = Math.max((loMax - loMin) * 0.25, tSpan * 0.35);
            x0 = Math.floor((loMin - mLo2 + Math.PI) / (2 * Math.PI) * nx2);
            x1 = Math.floor((loMax + mLo2 + Math.PI) / (2 * Math.PI) * nx2);
            y0 = tileY(laMax + mLa2, z); y1 = tileY(laMin - mLa2, z);
            if ((x1 - x0 + 1) * (y1 - y0 + 1) > L.MAXSET) {
                /* an oblique, horizon-grazing view unprojects to a
                   box no bounded set can cover. Keep the zoom the
                   altitude calls for and take the CENTRED window of
                   that box instead — the ground nearest the camera,
                   which is the ground that fills the screen; the
                   far field keeps its parents and the globe. */
                var cxT = Math.floor((lon0 + Math.PI) / (2 * Math.PI) * nx2), cyT = tileY(lat0, z);
                x0 = Math.max(x0, cxT - 4); x1 = Math.min(x1, cxT + 4);
                y0 = Math.max(y0, cyT - 4); y1 = Math.min(y1, cyT + 4);
            }
            if ((x1 - x0 + 1) * (y1 - y0 + 1) <= L.MAXSET || z <= L.cfg.zMin) break;
            z--;
        }
        var n3 = L.cfg.proj === 'eq' ? Math.pow(2, z + 1) : Math.pow(2, z), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, tiles = [];
        for (var wx = x0; wx <= x1; wx++) for (var wy = y0; wy <= y1; wy++) {
            tiles.push({ z: z, x: ((wx % n3) + n3) % n3, y: wy, p: Math.max(Math.abs(wx - cx), Math.abs(wy - cy)) });
        }
        var parents = [];
        if (z >= L.cfg.zMin + 2) {
            var pz = z - 2, pn = L.cfg.proj === 'eq' ? Math.pow(2, pz + 1) : Math.pow(2, pz);
            var px0 = Math.floor(x0 / 4), px1 = Math.floor(x1 / 4), py0 = Math.floor(y0 / 4), py1 = Math.floor(y1 / 4);
            for (var qx = px0; qx <= px1; qx++) for (var qy = py0; qy <= py1; qy++) {
                parents.push({ z: pz, x: ((qx % pn) + pn) % pn, y: qy, p: Math.max(Math.abs(qx * 4 + 1.5 - cx), Math.abs(qy * 4 + 1.5 - cy)) / 4 });
            }
        }
        return { z: z, tiles: tiles, parents: parents, sig: z + ':' + x0 + ',' + y0 + ',' + x1 + ',' + y1 };
    }
    function etRebuild(L, w) {
        var want = new Map(), i, t, e;
        for (i = 0; i < w.parents.length; i++) { t = w.parents[i]; e = L.cache.get(etKey(t.z, t.x, t.y)); if (e && e.state === 'ready') want.set(e.key, e); }
        for (i = 0; i < w.tiles.length; i++) { t = w.tiles[i]; e = L.cache.get(etKey(t.z, t.x, t.y)); if (e && e.state === 'ready') want.set(e.key, e); }
        Array.from(L.meshes.keys()).forEach(function (k) {
            if (!want.has(k)) { L.grp.remove(L.meshes.get(k)); L.meshes.delete(k); }
        });
        want.forEach(function (en, k) {
            en.used = performance.now();
            if (L.meshes.has(k)) return;
            if (!en.geom) en.geom = etGeom(L, en.z, en.x, en.y);
            if (!en.mat) en.mat = new THREE.MeshLambertMaterial({ map: en.tex, polygonOffset: true, polygonOffsetFactor: -(en.z - 4), polygonOffsetUnits: -(en.z - 4) });
            var mesh = new THREE.Mesh(en.geom, en.mat);
            mesh.frustumCulled = false;
            L.grp.add(mesh);
            L.meshes.set(k, mesh);
        });
    }
    function etFrame(L, now) {
        if (!L.grp || !L.sysPos) return;
        if (now - L.lastCheck < 200) return;
        L.lastCheck = now;
        var w = etWanted(L);
        if (!w) {
            if (L.meshes.size) { L.meshes.forEach(function (m) { L.grp.remove(m); }); L.meshes.clear(); }
            L.key = ''; L.z = -1; L.wantN = 0;
            /* approach prefetch: inside 3 radii the layer is about
               to engage — warm the entry-level 3x3 around the ground
               point below the camera, so the first tiles are already
               on the globe at the moment of engagement instead of
               only starting their fetch there */
            if (!L.dead && L.lastH > 0 && L.lastH < 3 * L.R) {
                var pz = L.cfg.zMin, pn = Math.pow(2, pz);
                var pnx = L.cfg.proj === 'eq' ? 2 * pn : pn;
                var pcx = Math.floor((L.lastLon + Math.PI) / (2 * Math.PI) * pnx);
                var pcy = L.cfg.proj === 'eq' ? etTileYEq(L.lastLat, pz) : etTileY(L.lastLat, pz);
                for (var ax = -1; ax <= 1; ax++) for (var ay = -1; ay <= 1; ay++) {
                    var wy2 = pcy + ay; if (wy2 < 0 || wy2 >= pn) continue;
                    etQueue(L, pz, ((pcx + ax) % pnx + pnx) % pnx, wy2, 40);
                }
                etPump(L);
            }
            return;
        }
        L.z = w.z; L.wantN = w.tiles.length;
        if (w.sig !== L.key || L.dirty) {
            L.key = w.sig; L.dirty = false;
            var i, t;
            for (i = 0; i < w.parents.length; i++) { t = w.parents[i]; etQueue(L, t.z, t.x, t.y, t.p); }
            for (i = 0; i < w.tiles.length; i++) { t = w.tiles[i]; etQueue(L, t.z, t.x, t.y, 10 + t.p); }
            etPump(L);
            etEvict(L);
            etRebuild(L, w);
        }
    }
    function tileFrameAll(now) {
        for (var i = 0; i < tileLayers.length; i++) etFrame(tileLayers[i], now);
    }
    function etState(L) {
        return {
            on: !!(L.grp && L.meshes.size), z: L.z, shown: L.meshes.size,
            cached: L.cache.size, wanted: L.wantN, dead: L.dead,
            keys: Array.from(L.meshes.keys()).sort()
        };
    }

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
               be worse than none. The specular and relief maps
               settle in the same count but gate only themselves
               (uHasSpec / uHasNrm, set in their own callbacks):
               a missing glint must never cost Earth her day map */
            if (settled === 5 && dayOK) {
                earthStackState.ready = true;
                earthSys.uniforms.uHasStack.value = 1;
                earthSys.cloudMesh.visible = true;
            }
        }
        function grab(file, srgb, isDay, flag) {
            var t = loader.load(new URL('./planets/' + file, import.meta.url).href,
                function () { if (flag) earthSys.uniforms[flag].value = 1; settle(true, isDay); },
                undefined,
                function () { settle(false, isDay); });
            if (srgb) t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = maxAniso;
            return t;
        }
        earthSys.uniforms.tDay.value = grab('earth-day.jpg', true, true);
        earthSys.uniforms.tNight.value = grab('earth-night.jpg', true, false);
        earthSys.cloudUniforms.tCov.value = grab('earth-clouds.jpg', false, false);
        earthSys.uniforms.tSpec.value = grab('earth-spec.jpg', false, false, 'uHasSpec');
        earthSys.uniforms.tNrm.value = grab('earth-normal.jpg', false, false, 'uHasNrm');
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
                        tSpec: { value: null }, tNrm: { value: null },
                        uBlend: { value: 0 }, uHasLow: { value: 0 }, uHasStack: { value: 0 },
                        uHasSpec: { value: 0 }, uHasNrm: { value: 0 },
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
                    cloudMesh: cloudMesh, sunVP: sunVP, grp: grp, r: b.r
                };
                tileInit(et, grp, b.r, pos);   /* the streamed tile layer rides in Earth's own frame */
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
        /* the Moon's, Mars's and Mercury's streamed survey tiles
           ride in their own pole frames, exactly as Earth's do */
        solarBodies.forEach(function (sb) {
            if (sb.n === 'Moon') tileInit(tileMoon, sb.grp, sb.r, sb.pos);
            else if (sb.n === 'Mars') tileInit(tileMars, sb.grp, sb.r, sb.pos);
            else if (sb.n === 'Mercury') tileInit(tileMercury, sb.grp, sb.r, sb.pos);
        });
        scene.add(solarGroup);
    }

    /* ================= SHIP — third-person craft (Johnny's pick, 2026-11-26) ====
       Two procedural craft, rendered as a view-model pass over the game:
       small on screen (~8–10% of screen height), lower-centre, lit by their
       own key/rim lights plus a PMREM environment baked from a softbox
       scene, so the metal reflects like photographed hardware. The game's
       speed slider (speedT) drives every speed effect: the Disc's plume,
       glow and rim-light chase, and Starman's headlights, beams and
       tail-light glow. Banking comes from the yaw/pitch rates. The toggle in the
       control row only flips which craft group is visible — position,
       velocity, speed setting, camera and game state are never touched.
       The toggle is a two-slot framework: slot 1 is the Disc; slot 2 is a
       single registration point (SHIP_SLOT2 + SHIP_BUILDERS below) — swap
       the one config entry to swap which craft occupies slot 2. ============ */
    /* Slot 2 occupant: STARMAN — Elon Musk's red Tesla Roadster and its
       suited mannequin driver, photo-matched to SpaceX's own Falcon Heavy
       demo frames (approved by Johnny 2026-11-26, mock REPORT-V3). Swap
       this one config entry to swap which craft occupies slot 2. */
    var SHIP_SLOT2 = 'starman';
    var SHIP_PAIR = ['disc', SHIP_SLOT2];
    var SHIP_LABELS = { disc: 'Disc', starman: 'Starman' };
    var shipChoice = SHIP_PAIR[0];
    var shipRig = null;
    var shipToggleEl = null;
    function shipRand(seed) {
        var s = seed >>> 0;
        return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }
    function shipGlowTexture() {
        var c = document.createElement('canvas'); c.width = c.height = 128;
        var g = c.getContext('2d');
        var gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
        gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
    }
    /* Painted-hull texture set (colour + bump + roughness) drawn on canvas:
       panel seams, rivets, brushed streaks, restrained grime, decals. */
    function hullTextureSet(base, panel, accent, seed, label) {
        var rnd = shipRand(seed);
        function cnv() { var c = document.createElement('canvas'); c.width = 1024; c.height = 512; return c; }
        var mc = cnv(), bc = cnv(), rc = cnv();
        var m = mc.getContext('2d'), b = bc.getContext('2d'), r = rc.getContext('2d');
        m.fillStyle = base; m.fillRect(0, 0, 1024, 512);
        b.fillStyle = '#8a8a8a'; b.fillRect(0, 0, 1024, 512);
        r.fillStyle = '#969696'; r.fillRect(0, 0, 1024, 512);
        for (var i = 0; i < 2600; i++) {                       /* speckle / wear noise */
            var x = rnd() * 1024, y = rnd() * 512, a = rnd() * 0.05;
            m.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')';
            m.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
            var rv = 100 + Math.floor(rnd() * 60);
            r.fillStyle = 'rgb(' + rv + ',' + rv + ',' + rv + ')';
            r.fillRect(x, y, 2, 2);
        }
        for (var j = 0; j < 300; j++) {                        /* brushed-metal streaks */
            m.strokeStyle = 'rgba(255,255,255,' + (0.02 + rnd() * 0.03) + ')';
            m.beginPath(); var sy = rnd() * 512; m.moveTo(0, sy); m.lineTo(1024, sy + (rnd() - 0.5) * 6); m.stroke();
        }
        var panels = [];
        for (var p = 0; p < 30; p++) {
            var px = rnd() * 940, py = rnd() * 430, pw = 60 + rnd() * 190, ph = 40 + rnd() * 110;
            panels.push([px, py, pw, ph]);
            m.strokeStyle = 'rgba(10,12,14,0.5)'; m.lineWidth = 2; m.strokeRect(px, py, pw, ph);
            b.strokeStyle = 'rgba(20,20,20,0.85)'; b.lineWidth = 3; b.strokeRect(px, py, pw, ph);
            r.strokeStyle = 'rgba(190,190,190,0.5)'; r.lineWidth = 3; r.strokeRect(px, py, pw, ph);
            if (rnd() > 0.55) { m.fillStyle = 'rgba(255,255,255,0.045)'; m.fillRect(px, py, pw, ph); }
            if (rnd() > 0.6) {                                 /* rivet runs along one seam */
                m.fillStyle = 'rgba(15,17,20,0.55)'; b.fillStyle = 'rgba(0,0,0,0.9)';
                for (var d = 6; d < pw - 4; d += 11) { m.beginPath(); m.arc(px + d, py + 3, 1.6, 0, 7); m.fill(); b.beginPath(); b.arc(px + d, py + 3, 2, 0, 7); b.fill(); }
            }
        }
        for (var s2 = 0; s2 < 22; s2++) {                      /* faint grime streaks */
            var gx = rnd() * 1024; var gg = m.createLinearGradient(gx, 0, gx + 26, 0);
            gg.addColorStop(0, 'rgba(8,8,10,0)'); gg.addColorStop(0.5, 'rgba(8,8,10,' + (0.04 + rnd() * 0.05) + ')'); gg.addColorStop(1, 'rgba(8,8,10,0)');
            m.fillStyle = gg; m.fillRect(gx, rnd() * 300, 26, 120 + rnd() * 200);
        }
        m.fillStyle = accent; m.fillRect(0, 356, 1024, 15);    /* livery band */
        r.fillStyle = 'rgba(52,52,52,0.85)'; r.fillRect(0, 356, 1024, 15);
        m.fillStyle = 'rgba(16,18,22,0.88)'; m.font = '700 30px ui-monospace, monospace';
        m.fillText(label, 42, 346);
        m.font = '600 15px ui-monospace, monospace'; m.fillStyle = 'rgba(16,18,22,0.6)';
        m.fillText('CAUTION — EXHAUST', 700, 120); m.fillText('NO STEP', 120, 470); m.fillText('RESCUE', 830, 452);
        m.fillStyle = accent; m.fillRect(688, 128, 120, 7);
        var map = new THREE.CanvasTexture(mc); map.colorSpace = THREE.SRGBColorSpace;
        var bump = new THREE.CanvasTexture(bc), rough = new THREE.CanvasTexture(rc);
        [map, bump, rough].forEach(function (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; });
        return { map: map, bump: bump, rough: rough };
    }
    function shipEnvTexture() {
        var es = new THREE.Scene();
        function softbox(w, h, x, y, z, col, mult) {
            var mm = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({ color: new THREE.Color(col.r * mult, col.g * mult, col.b * mult), side: THREE.DoubleSide }));
            mm.position.set(x, y, z); mm.lookAt(0, 0, 0); es.add(mm);
        }
        softbox(7, 3.4, 4, 6, 2, { r: 1, g: 0.96, b: 0.9 }, 5.5);    /* warm key overhead */
        softbox(6, 1.1, -7, 1.2, -1, { r: 0.8, g: 0.88, b: 1 }, 2.6);/* cool strip, port side */
        softbox(8, 2.2, 0, -7, 1, { r: 0.3, g: 0.45, b: 0.85 }, 1.1);/* earthshine from below */
        softbox(4, 4, -1, 2, -8, { r: 0.9, g: 0.93, b: 1 }, 2.2);    /* forward fill */
        var pm = new THREE.PMREMGenerator(renderer);
        var tex = pm.fromScene(es, 0.05).texture; pm.dispose();
        return tex;
    }
    function carPaintMaps() {
        var rnd = shipRand(90210);
        var mc = document.createElement('canvas'); mc.width = mc.height = 512;
        var rc = document.createElement('canvas'); rc.width = rc.height = 512;
        var m = mc.getContext('2d'), r = rc.getContext('2d');
        m.fillStyle = '#f5f2f2'; m.fillRect(0, 0, 512, 512);
        r.fillStyle = '#3d3d3d'; r.fillRect(0, 0, 512, 512);
        for (var i = 0; i < 5200; i++) {
            var x = rnd() * 512, y = rnd() * 512, v = 200 + Math.floor(rnd() * 55);
            m.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.25 + rnd() * 0.5) + ')';
            m.fillRect(x, y, 1.3, 1.3);
            var rv = 48 + Math.floor(rnd() * 40);
            r.fillStyle = 'rgb(' + rv + ',' + rv + ',' + rv + ')'; r.fillRect(x, y, 2, 2);
        }
        for (var j = 0; j < 130; j++) {
            m.strokeStyle = 'rgba(255,255,255,' + (0.02 + rnd() * 0.03) + ')';
            m.beginPath(); var sy = rnd() * 512; m.moveTo(0, sy); m.lineTo(512, sy + (rnd() - 0.5) * 4); m.stroke();
        }
        var map = new THREE.CanvasTexture(mc); map.colorSpace = THREE.SRGBColorSpace;
        var rough = new THREE.CanvasTexture(rc);
        [map, rough].forEach(function (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; });
        return { map: map, rough: rough };
    }
    function suitFabricBump() {
        var rnd = shipRand(4242);
        var c = document.createElement('canvas'); c.width = c.height = 256;
        var g = c.getContext('2d');
        g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 256, 256);
        for (var y = 0; y < 256; y += 2) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, y, 256, 1); }
        for (var i = 0; i < 2600; i++) {
            var v = 90 + Math.floor(rnd() * 90);
            g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.5)';
            g.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
        }
        var t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
        return t;
    }
    function dashScreenTexture() {
        var c = document.createElement('canvas'); c.width = 512; c.height = 320;
        var g = c.getContext('2d');
        var grad = g.createLinearGradient(0, 0, 0, 320);
        grad.addColorStop(0, '#10151d'); grad.addColorStop(1, '#05080d');
        g.fillStyle = grad; g.fillRect(0, 0, 512, 320);
        g.strokeStyle = 'rgba(120,160,200,0.25)'; g.lineWidth = 3; g.strokeRect(8, 8, 496, 304);
        g.fillStyle = '#e8f1f8'; g.font = '900 76px Arial, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText("DON'T", 256, 116);
        g.fillText('PANIC!', 256, 206);
        g.fillStyle = 'rgba(140,180,220,0.5)'; g.font = '600 21px Arial, sans-serif';
        g.fillText('TESLA ROADSTER · STARMAN', 256, 282);
        var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
        return t;
    }
    function rimFaceTexture() {
        var c = document.createElement('canvas'); c.width = c.height = 256;
        var g = c.getContext('2d');
        g.fillStyle = '#17181a'; g.fillRect(0, 0, 256, 256);
        g.translate(128, 128);
        var ring = g.createRadialGradient(0, 0, 30, 0, 0, 126);
        ring.addColorStop(0, '#3a3d40'); ring.addColorStop(0.75, '#26282b'); ring.addColorStop(1, '#101112');
        g.fillStyle = ring; g.beginPath(); g.arc(0, 0, 126, 0, 7); g.fill();
        for (var i = 0; i < 5; i++) {
            for (var s = -1; s <= 1; s += 2) {
                g.save(); g.rotate(i / 5 * Math.PI * 2 + s * 0.10);
                var lg = g.createLinearGradient(0, -30, 0, -118);
                lg.addColorStop(0, '#d6d9de'); lg.addColorStop(1, '#878c93');
                g.fillStyle = lg;
                g.beginPath();
                g.moveTo(-7, -34); g.lineTo(7, -34); g.lineTo(10, -112); g.lineTo(-10, -112); g.closePath(); g.fill();
                g.restore();
            }
        }
        g.fillStyle = '#c9ccd1'; g.beginPath(); g.arc(0, 0, 34, 0, 7); g.fill();
        g.fillStyle = '#54575c'; g.beginPath(); g.arc(0, 0, 15, 0, 7); g.fill();
        var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
        return t;
    }
    function photoTex(url, rx, ry) {
        window.__starmanTexPending = (window.__starmanTexPending || 0) + 1;
        var t = new THREE.TextureLoader().load(url, function () {
            window.__starmanTexPending--;
        }, undefined, function () { window.__starmanTexPending--; });
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
        return t;
    }
    function carEnvTexture() {
        var es = new THREE.Scene();
        var room = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30),
            new THREE.MeshBasicMaterial({ color: 0x050608, side: THREE.BackSide }));
        es.add(room);
        function panel(w, h, x, y, z, col, mult) {
            var mm = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({ color: new THREE.Color(col.r * mult, col.g * mult, col.b * mult), side: THREE.DoubleSide }));
            mm.position.set(x, y, z); mm.lookAt(0, 0, 0); es.add(mm);
        }
        panel(2.2, 2.2, 5, 6.5, -3, { r: 1, g: 0.98, b: 0.94 }, 26);   /* the sun: small, brutal */
        panel(13, 4.5, 0, -7.5, 0.5, { r: 0.30, g: 0.48, b: 1.0 }, 1.5); /* earthshine from below */
        panel(7, 1.4, -7.5, 1.5, -1, { r: 0.75, g: 0.85, b: 1.0 }, 1.6); /* cool rim strip */
        panel(5, 3, -1, 1, -8, { r: 0.85, g: 0.9, b: 1.0 }, 0.9);        /* faint forward fill */
        var pm = new THREE.PMREMGenerator(renderer);
        var tex = pm.fromScene(es, 0.035).texture; pm.dispose();
        return tex;
    }
    function treadBumpTexture() {
        var c = document.createElement('canvas'); c.width = 512; c.height = 128;
        var g = c.getContext('2d');
        g.fillStyle = '#909090'; g.fillRect(0, 0, 512, 128);
        var rnd = shipRand(777);
        for (var i = 0; i < 5200; i++) {   /* rubber grain in the blocks */
            var v = 118 + Math.floor(rnd() * 50);
            g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
            g.fillRect(rnd() * 512, rnd() * 128, 1.6, 1.6);
        }
        g.fillStyle = '#262626';           /* circumferential grooves */
        [26, 60, 94].forEach(function (gy) { g.fillRect(0, gy - 4, 512, 8); });
        g.strokeStyle = '#2e2e2e'; g.lineWidth = 7; g.lineCap = 'round';
        for (var bx = 0; bx < 8; bx++) {   /* angled tread-block slashes */
            var x0 = bx * 64;
            g.beginPath(); g.moveTo(x0 + 8, 118); g.lineTo(x0 + 40, 70); g.stroke();
            g.beginPath(); g.moveTo(x0 + 40, 58); g.lineTo(x0 + 8, 10); g.stroke();
            g.beginPath(); g.moveTo(x0 + 56, 10); g.lineTo(x0 + 34, 52); g.stroke();
            g.beginPath(); g.moveTo(x0 + 34, 76); g.lineTo(x0 + 56, 118); g.stroke();
        }
        g.strokeStyle = 'rgba(40,40,40,0.75)'; g.lineWidth = 1.6;
        for (var sx2 = 0; sx2 < 46; sx2++) {  /* sipes */
            var px = rnd() * 512, py = rnd() * 128;
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + 7, py + 3); g.stroke();
        }
        var t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(22, 1); t.anisotropy = 8;
        return t;
    }
    function sidewallTexture(sizeLabel) {
        var c = document.createElement('canvas'); c.width = c.height = 512;
        var g = c.getContext('2d');
        g.fillStyle = '#131315'; g.fillRect(0, 0, 512, 512);
        var rnd = shipRand(sizeLabel.length * 131 + 7);
        for (var i = 0; i < 7000; i++) {
            var v = 14 + Math.floor(rnd() * 22);
            g.fillStyle = 'rgb(' + v + ',' + v + ',' + (v + 2) + ')';
            g.fillRect(rnd() * 512, rnd() * 512, 1.7, 1.7);
        }
        g.translate(256, 256);
        [0.97, 0.90, 0.70].forEach(function (rr, ri) {
            g.strokeStyle = ri === 1 ? 'rgba(210,210,215,0.20)' : 'rgba(0,0,0,0.55)';
            g.lineWidth = ri === 1 ? 2 : 3;
            g.beginPath(); g.arc(0, 0, 248 * rr, 0, 7); g.stroke();
        });
        function arcText(txt, radius, a0, a1, flip) {
            g.fillStyle = 'rgba(205,205,210,0.5)';
            g.font = '700 25px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            for (var i = 0; i < txt.length; i++) {
                var a = a0 + (a1 - a0) * (txt.length === 1 ? 0.5 : i / (txt.length - 1));
                g.save(); g.rotate(a); g.translate(0, -radius);
                if (flip) g.rotate(Math.PI);
                g.fillText(txt[i], 0, 0); g.restore();
            }
        }
        arcText('RADIAL · TUBELESS', 208, -1.15, 1.15, false);
        arcText(sizeLabel, 208, Math.PI - 0.85, Math.PI + 0.85, true);
        arcText('ROTATION', 158, -0.5, 0.5, false);
        var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        return t;
    }
    function makeBeam(len, rad) {
        var geo = new THREE.ConeGeometry(rad, len, 24, 1, true);
        geo.translate(0, -len / 2, 0); geo.rotateX(Math.PI / 2);
        var mat = new THREE.ShaderMaterial({
            uniforms: { uI: { value: 0 }, uLen: { value: len } },
            vertexShader: 'varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'varying vec3 vL; uniform float uI, uLen; void main(){ float a = clamp(1.0 + vL.z / uLen, 0.0, 1.0); float al = pow(a, 1.9) * uI; gl_FragColor = vec4(vec3(0.82, 0.90, 1.0) * al, al); }',
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        var mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
        return { mesh: mesh, mat: mat };
    }
    function shadowed(root) {
        root.traverse(function (o) {
            if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { o.castShadow = true; o.receiveShadow = true; }
        });
    }
    function navLight(color, x, y, z, parent) {
        var s = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: color }));
        s.position.set(x, y, z); parent.add(s); return s;
    }
    var SHIP = { env: null, glowTex: null, mats: {} };
    function shipMaterials() {
        if (SHIP.mats.discHull) return SHIP.mats;
        SHIP.env = shipEnvTexture(); SHIP.glowTex = shipGlowTexture();
        function std(o) { var mt = new THREE.MeshStandardMaterial(o); mt.envMap = SHIP.env; return mt; }
        function painted(set, metal, rough, ei) {
            return std({ map: set.map, bumpMap: set.bump, bumpScale: 0.6, roughnessMap: set.rough,
                metalness: metal, roughness: rough, envMapIntensity: ei || 0.7 });
        }
        var ringSet = hullTextureSet('#aab0b6', '#9299a0', '#20506e', 5211, 'UV-03 · MERIDIAN');
        var discSet = hullTextureSet('#a29d93', '#87837b', '#3c4a55', 7817, 'UV-04');
        var paintMaps = carPaintMaps(); var fabricBump = suitFabricBump();
        SHIP.dashTex = dashScreenTexture(); var rimTex = rimFaceTexture();
        /* V2: the car's own hard-sun environment + photographic surface
           maps (ambientCG, CC0). Normal/roughness only — colour is ours. */
        SHIP.carEnv = carEnvTexture();
        var fabricN = photoTex('starman/fabric-normal.jpg', 3, 3), fabricR = photoTex('starman/fabric-rough.jpg', 3, 3);
        var leatherN = photoTex('starman/leather-normal.jpg', 2, 2), leatherR = photoTex('starman/leather-rough.jpg', 2, 2);
        var treadBump = treadBumpTexture();
        SHIP.sidewallF = sidewallTexture('195/50 R16'); SHIP.sidewallR = sidewallTexture('225/45 R17');
        SHIP.mats = {
            ringHull: painted(ringSet, 0.3, 1.0),
            discHull: painted(discSet, 0.35, 1.0),
            darkMetal: std({ color: 0x2c3034, metalness: 0.78, roughness: 0.52, envMapIntensity: 0.55 }),
            flatMetal: std({ color: 0x3a3f45, metalness: 0.6, roughness: 0.58, envMapIntensity: 0.35 }),
            ringMetal: std({ color: 0x969da5, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.65 }),
            radMat: std({ color: 0x40241c, metalness: 0.25, roughness: 0.9, envMapIntensity: 0.0, side: THREE.DoubleSide }),
            nozzle: std({ color: 0x1d1f22, metalness: 0.95, roughness: 0.36, envMapIntensity: 0.8 }),
            copper: std({ color: 0x7d5230, metalness: 1.0, roughness: 0.4, envMapIntensity: 0.9 }),
            glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0e13, metalness: 0.1, roughness: 0.16,
                clearcoat: 1, clearcoatRoughness: 0.12, envMap: SHIP.env, envMapIntensity: 1.1 }),
            radiator: std({ color: 0x2e1a14, metalness: 0.3, roughness: 0.82, envMapIntensity: 0.15, side: THREE.DoubleSide }),
            white: std({ color: 0xb3aea4, metalness: 0.15, roughness: 0.62, envMapIntensity: 0.8 }),
            carPaint: new THREE.MeshPhysicalMaterial({ map: paintMaps.map, roughnessMap: paintMaps.rough,
                color: 0x8a1220, metalness: 0.45, roughness: 1.0, clearcoat: 1, clearcoatRoughness: 0.05,
                envMap: SHIP.carEnv, envMapIntensity: 1.35 }),
            suit: std({ color: 0xf4f6f8, metalness: 0.0, roughness: 1.0, normalMap: fabricN,
                normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: fabricR, envMapIntensity: 0.35 }),
            suitGray: std({ color: 0x43484e, metalness: 0.0, roughness: 1.0, normalMap: fabricN,
                normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: fabricR, envMapIntensity: 0.3 }),
            suitDark: std({ color: 0x2b2f34, metalness: 0.0, roughness: 1.0, normalMap: fabricN,
                normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: fabricR, envMapIntensity: 0.25 }),
            helmet: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.30,
                clearcoat: 0.7, clearcoatRoughness: 0.22, envMap: SHIP.carEnv, envMapIntensity: 0.95 }),
            visor: new THREE.MeshPhysicalMaterial({ color: 0x1c1508, metalness: 1.0, roughness: 0.03,
                clearcoat: 1, clearcoatRoughness: 0.03, envMap: SHIP.carEnv, envMapIntensity: 2.3 }),
            shieldGlass: new THREE.MeshPhysicalMaterial({ color: 0x9fb6c4, metalness: 0, roughness: 0.06,
                transparent: true, opacity: 0.30, clearcoat: 1, envMap: SHIP.carEnv, envMapIntensity: 1.5,
                side: THREE.DoubleSide, depthWrite: false }),
            tire: std({ color: 0x0b0b0c, metalness: 0.0, roughness: 0.94, envMapIntensity: 0.25 }),
            tireCarcass: std({ color: 0x17181a, metalness: 0.0, roughness: 1.0,
                normalMap: photoTex('starman/rubber-normal.jpg', 6, 1), normalScale: new THREE.Vector2(0.6, 0.6),
                roughnessMap: photoTex('starman/rubber-rough.jpg', 6, 1), envMapIntensity: 0.3 }),
            tireTread: std({ color: 0x1a1b1d, metalness: 0.0, roughness: 1.0, bumpMap: treadBump, bumpScale: 1.4,
                normalMap: photoTex('starman/rubber-normal.jpg', 10, 1), normalScale: new THREE.Vector2(0.7, 0.7),
                roughnessMap: photoTex('starman/rubber-rough.jpg', 10, 1), envMapIntensity: 0.3 }),
            tireSideF: std({ map: SHIP.sidewallF, metalness: 0.0, roughness: 1.0,
                normalMap: photoTex('starman/rubber-normal.jpg', 1, 1), normalScale: new THREE.Vector2(0.45, 0.45),
                roughnessMap: photoTex('starman/rubber-rough.jpg', 1, 1), envMapIntensity: 0.3 }),
            tireSideR: std({ map: SHIP.sidewallR, metalness: 0.0, roughness: 1.0,
                normalMap: photoTex('starman/rubber-normal.jpg', 1, 1), normalScale: new THREE.Vector2(0.45, 0.45),
                roughnessMap: photoTex('starman/rubber-rough.jpg', 1, 1), envMapIntensity: 0.3 }),
            brakeDisc: std({ color: 0x9ba0a4, metalness: 0.9, roughness: 0.38, envMapIntensity: 0.8 }),
            caliper: std({ color: 0x8c1410, metalness: 0.3, roughness: 0.45, envMapIntensity: 0.6 }),
            smokedLens: new THREE.MeshPhysicalMaterial({ color: 0x111317, metalness: 0.3, roughness: 0.26,
                clearcoat: 1, clearcoatRoughness: 0.08, envMap: SHIP.carEnv, envMapIntensity: 1.0 }),
            carpet: std({ color: 0x0d0d10, metalness: 0.0, roughness: 1.0, normalMap: fabricN,
                normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 0.12 }),
            rimFace: std({ map: rimTex, metalness: 0.65, roughness: 0.42, envMapIntensity: 0.9 }),
            rimSide: std({ color: 0x8f9399, metalness: 0.9, roughness: 0.35, envMapIntensity: 0.9 }),
            leather: std({ color: 0x17181b, metalness: 0.05, roughness: 1.0, normalMap: leatherN,
                normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: leatherR, envMapIntensity: 0.45 }),
            dashDark: std({ color: 0x131417, metalness: 0.2, roughness: 0.55, envMapIntensity: 0.4 }),
            wellDark: std({ color: 0x08080a, metalness: 0.0, roughness: 1.0, envMapIntensity: 0.05 })
        };
        return SHIP.mats;
    }
    /* Exhaust plume: two nested shader cones — bright core, Mach-diamond
       banding, soft axial falloff, animated flicker. Not a cartoon cone. */
    function makePlume(coreCol, edgeCol, len, rad) {
        var grp = new THREE.Group();
        function cone(l, rd, boost, corePow) {
            var geo = new THREE.ConeGeometry(rd, l, 28, 6, true);
            geo.translate(0, -l / 2, 0); geo.rotateX(-Math.PI / 2);   /* apex at origin, opens toward +Z */
            var mat = new THREE.ShaderMaterial({
                uniforms: { uI: { value: 0 }, uTime: { value: 0 }, uLen: { value: l },
                    uCore: { value: new THREE.Color(coreCol) }, uEdge: { value: new THREE.Color(edgeCol) },
                    uBoost: { value: boost }, uPow: { value: corePow } },
                vertexShader: 'varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
                fragmentShader: [
                    'varying vec3 vL; uniform float uI, uTime, uLen, uBoost, uPow; uniform vec3 uCore, uEdge;',
                    'void main(){',
                    ' float a = clamp(1.0 - vL.z / uLen, 0.0, 1.0);',   /* 1 at nozzle, 0 at tip */
                    ' float axial = pow(a, 1.45);',
                    ' float bands = 0.84 + 0.26 * sin(a * 46.0 - uTime * 26.0) * smoothstep(0.1, 0.85, a);',
                    ' float flick = 0.93 + 0.07 * sin(uTime * 41.0 + vL.x * 60.0) + 0.04 * sin(uTime * 97.0);',
                    ' vec3 col = mix(uEdge, uCore, pow(a, uPow));',
                    ' float al = axial * bands * flick * uI;',
                    ' gl_FragColor = vec4(col * al * uBoost, al); }'
                ].join('\n'),
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
            var mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; grp.add(mesh);
            return mat;
        }
        var mats = [cone(len, rad, 1.6, 1.6), cone(len * 0.6, rad * 0.48, 2.6, 2.6)];
        var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: SHIP.glowTex, color: coreCol,
            transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        spr.scale.set(rad * 3.2, rad * 3.2, 1); grp.add(spr);
        return { group: grp, mats: mats, spr: spr, baseLen: len,
            set: function (r, t) {
                var l = 0.30 + r * 1.25;
                grp.scale.set(0.55 + r * 0.6, 0.55 + r * 0.6, l * (1 + 0.028 * Math.sin(t * 39.0) + 0.02 * Math.sin(t * 61.0)));
                mats.forEach(function (mt) { mt.uniforms.uI.value = 0.10 + r * 0.95; mt.uniforms.uTime.value = t; });
                spr.material.opacity = 0.08 + r * 0.34;
                var ss = rad * (1.05 + r * 1.15); spr.scale.set(ss, ss, 1);
            } };
    }
    function makeSparks(color, count, spread) {
        var pos = new Float32Array(count * 3), age = new Float32Array(count), life = new Float32Array(count), vel = new Float32Array(count * 3);
        var rnd = shipRand(count * 7 + 13);
        for (var i = 0; i < count; i++) { age[i] = rnd() * 1.2; life[i] = 0.4 + rnd() * 0.8; }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        var mat = new THREE.PointsMaterial({ color: color, size: 0.02, map: SHIP.glowTex, transparent: true,
            opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
        var pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
        return { obj: pts, update: function (r, sdt) {
            mat.opacity = r < 0.25 ? 0 : (r - 0.25) * 0.85;
            if (r < 0.25) return;
            for (var i = 0; i < count; i++) {
                age[i] += sdt;
                if (age[i] > life[i]) {
                    age[i] = 0; life[i] = 0.4 + rnd() * 0.8;
                    pos[i * 3] = (rnd() - 0.5) * spread; pos[i * 3 + 1] = (rnd() - 0.5) * spread; pos[i * 3 + 2] = 0.02;
                    vel[i * 3] = (rnd() - 0.5) * 0.22; vel[i * 3 + 1] = (rnd() - 0.5) * 0.22; vel[i * 3 + 2] = 0.7 + rnd() * 1.5;
                }
                pos[i * 3] += vel[i * 3] * sdt; pos[i * 3 + 1] += vel[i * 3 + 1] * sdt; pos[i * 3 + 2] += vel[i * 3 + 2] * sdt * (0.6 + r);
            }
            geo.attributes.position.needsUpdate = true;
        } };
    }
    function nozzleUnit(rOut, len, innerCol) {
        var g = new THREE.Group();
        var bell = new THREE.Mesh(new THREE.CylinderGeometry(rOut * 0.72, rOut, len, 28, 1, true), SHIP.mats.nozzle);
        bell.rotation.x = Math.PI / 2; g.add(bell);
        var throat = new THREE.Mesh(new THREE.CircleGeometry(rOut * 0.7, 28),
            new THREE.MeshBasicMaterial({ color: innerCol }));
        throat.position.z = -len * 0.4; g.add(throat);
        g.userData.throat = throat;
        return g;
    }
    function shadowed(root) {
        root.traverse(function (o) {
            if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { o.castShadow = true; o.receiveShadow = true; }
        });
    }
    function navLight(color, x, y, z, parent) {
        var s = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: color }));
        s.position.set(x, y, z); parent.add(s); return s;
    }
    /* ---- Starman: the Falcon Heavy Roadster, top down, driver aboard ----
       Musk's midnight-cherry first-generation Roadster and the spacesuited
       mannequin, posed as in SpaceX's own public-domain photos: right hand
       on the wheel, left elbow on the open window sill, forearm resting
       along the driver's door. The body is a lofted shell (stations along
       the length, closed cross-sections, the cockpit stations dipped to
       form the open tub). No thrusters — a roadster has none. Speed reads
       through headlights and beams, tail-light glow, a faint light-smear
       at full chat, and the game's own star-streaks. When slow and not
       steering it takes up the real car's measured tumble: roll period
       4.7589 min (SOAR telescope light curve, Feb 2018). =============== */
    function buildStarman() {
        var M = SHIP.mats, g = new THREE.Group();
        function seg(a, b, r, mat) {
            var dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            var len = dir.length();
            var mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.004, len - r * 0.5), 6, 16), mat);
            mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
            return mesh;
        }
        function section(o) {
            /* V2 profile: a tucked lower body, the widest point low, a
               beltline that rolls inward to a real shoulder — pressed
               panels with tumblehome, not an inflated shell. 10 points
               per half, 18 around; the paint map's seams are drawn
               against these exact indices (see bodyPaintMaps).
               V3: o.peak lifts the shoulder roll (points 6–7) — the
               fender crowns that stand proud of the hood in SpaceX's
               front-camera frames, and the rear haunches. */
            var yMid = o.yBot + (o.yBelt - o.yBot) * 0.52;
            var pk = o.peak || 0;
            var half = [
                [0, o.yBot], [o.hw * 0.48, o.yBot + 0.004], [o.hw * 0.86, o.yBot + 0.020],
                [o.hw * 0.985, o.yBot + 0.052], [o.hw, yMid], [o.hw * 0.975, o.yBelt],
                [o.hw * 0.88, o.yBelt + (o.yTop - o.dip - o.yBelt) * 0.55 + pk * 0.0075],
                [o.hw * 0.60, o.yTop - o.dip * 0.55 + pk * 0.0035], [o.hw * 0.30, o.yTop - o.dip],
                [0, o.yTop - o.dip * 0.92]
            ];
            var pts = half.slice();
            for (var i = half.length - 2; i >= 1; i--) pts.push([-half[i][0], half[i][1]]);
            return pts;
        }
        /* V2 body paint maps: the loft's UV is (perimeter, length), so
           the panel gaps a real Roadster wears — door outlines, hood and
           decklid lines, fascia splits, the beltline crease — are drawn
           into the maps at their true places, over metallic flake.
           u: point i of 18 around the section (0 = bottom centre,
           0.278 = right belt, 0.5 = crown, 0.722 = left belt).
           v: (z + 0.365) / 0.725 along the car. */
        function bodyPaintMaps() {
            var W = 2048, H = 1024;
            var mc = document.createElement('canvas'); mc.width = W; mc.height = H;
            var rc = document.createElement('canvas'); rc.width = W; rc.height = H;
            var m = mc.getContext('2d'), r = rc.getContext('2d');
            var X = function (u) { return u * W; }, Y = function (v) { return (1 - v) * H; };
            m.fillStyle = '#f6f1f1'; m.fillRect(0, 0, W, H);
            r.fillStyle = '#2c2c2c'; r.fillRect(0, 0, W, H);
            var rnd = shipRand(5150);
            for (var b = 0; b < 46; b++) {          /* broad tonal drift in the paint */
                var bx = rnd() * W, by = rnd() * H, br = 130 + rnd() * 330;
                var bg = m.createRadialGradient(bx, by, 0, bx, by, br);
                var dark = rnd() > 0.5;
                bg.addColorStop(0, dark ? 'rgba(70,52,52,0.05)' : 'rgba(255,255,255,0.05)');
                bg.addColorStop(1, 'rgba(0,0,0,0)');
                m.fillStyle = bg; m.fillRect(bx - br, by - br, br * 2, br * 2);
                var rg = r.createRadialGradient(bx, by, 0, bx, by, br);
                rg.addColorStop(0, dark ? 'rgba(96,96,96,0.20)' : 'rgba(20,20,20,0.20)');
                rg.addColorStop(1, 'rgba(0,0,0,0)');
                r.fillStyle = rg; r.fillRect(bx - br, by - br, br * 2, br * 2);
            }
            for (var i = 0; i < 15000; i++) {       /* metallic flake */
                var fx = rnd() * W, fy = rnd() * H, v = 195 + Math.floor(rnd() * 60);
                m.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.3 + rnd() * 0.5) + ')';
                m.fillRect(fx, fy, 1.4, 1.4);
                if (fx < 3) m.fillRect(fx + W, fy, 1.4, 1.4); if (fx > W - 3) m.fillRect(fx - W, fy, 1.4, 1.4);
            }
            function seams(g2, dark, lite, wMul) {
                g2.lineJoin = 'round'; g2.lineCap = 'round';
                function line(u1, v1, u2, v2, w, alpha) {
                    g2.globalAlpha = alpha;
                    g2.strokeStyle = lite; g2.lineWidth = w * wMul;
                    g2.beginPath(); g2.moveTo(X(u1), Y(v1) + 2.2); g2.lineTo(X(u2), Y(v2) + 2.2); g2.stroke();
                    g2.strokeStyle = dark;
                    g2.beginPath(); g2.moveTo(X(u1), Y(v1)); g2.lineTo(X(u2), Y(v2)); g2.stroke();
                    g2.globalAlpha = 1;
                }
                function door(uTop, uBot, flip) {
                    var vf = 0.345, vr = 0.634;      /* door front / rear edges in v */
                    /* V3: the door outline is real geometry now (a tube
                       lying on the shell); the drawn line drops to a
                       faint shadow so the two never double up. */
                    g2.globalAlpha = 0.38; g2.strokeStyle = dark; g2.lineWidth = 3 * wMul;
                    g2.beginPath();
                    g2.moveTo(X(uBot), Y(vf)); g2.lineTo(X(uTop), Y(vf));
                    g2.lineTo(X(uTop), Y(vr)); g2.lineTo(X(uBot), Y(vr));
                    g2.closePath(); g2.stroke();
                    g2.globalAlpha = 1;
                }
                door(0.272, 0.135, 1); door(0.728, 0.865, -1);          /* both doors */
                line(0.360, 0.145, 0.640, 0.145, 3, 0.9);               /* hood front edge */
                line(0.365, 0.145, 0.365, 0.300, 2.4, 0.75);            /* hood sides */
                line(0.635, 0.145, 0.635, 0.300, 2.4, 0.75);
                line(0.370, 0.876, 0.630, 0.876, 3, 0.9);               /* decklid edge */
                line(0.030, 0.065, 0.970, 0.065, 2.4, 0.5);             /* fascia splits */
                line(0.030, 0.948, 0.970, 0.948, 2.4, 0.5);
                line(0.278, 0.100, 0.278, 0.900, 1.8, 0.32);            /* beltline crease */
                line(0.722, 0.100, 0.722, 0.900, 1.8, 0.32);
            }
            seams(m, 'rgba(12,4,4,0.88)', 'rgba(255,228,228,0.15)', 1);
            seams(r, '#787878', '#787878', 1.15);                       /* gaps are rougher */
            var map = new THREE.CanvasTexture(mc); map.colorSpace = THREE.SRGBColorSpace;
            var rough = new THREE.CanvasTexture(rc);
            [map, rough].forEach(function (t) { t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; });
            return { map: map, rough: rough };
        }
        function loft(stations) {
            /* V2: the seam vertex is duplicated (u = 0 and u = 1 at the
               bottom centre) so the paint map wraps exactly instead of
               smearing backward across the seam quad. */
            var n = stations[0].pts.length, pos = [], uvA = [], idx = [];
            var stride = n + 1;
            stations.forEach(function (st, si) {
                for (var pi = 0; pi <= n; pi++) {
                    var p = st.pts[pi % n];
                    pos.push(p[0], p[1], st.z); uvA.push(pi / n, si / (stations.length - 1));
                }
            });
            for (var si = 0; si < stations.length - 1; si++) for (var pi = 0; pi < n; pi++) {
                var a = si * stride + pi, b = a + 1, c = (si + 1) * stride + pi, d = c + 1;
                idx.push(a, b, c, b, d, c);
            }
            function cap(si, flip) {
                var st = stations[si], cx = 0, cy = 0;
                st.pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
                var ci = pos.length / 3;
                pos.push(cx / n, cy / n, st.z); uvA.push(0.5, si / (stations.length - 1));
                for (var pi = 0; pi < n; pi++) {
                    var a = si * stride + pi, b = si * stride + pi + 1;
                    if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
                }
            }
            cap(0, true); cap(stations.length - 1, false);
            var geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
            geo.setIndex(idx); geo.computeVertexNormals();
            var pa = geo.attributes.position, na = geo.attributes.normal, mi = -1, mx = -1;
            for (var vi = 0; vi < pa.count; vi++) { if (pa.getX(vi) > mx) { mx = pa.getX(vi); mi = vi; } }
            if (mi >= 0 && na.getX(mi) < 0) {   /* winding safety: side normals must point outward */
                var ia = geo.getIndex().array;
                for (var ti = 0; ti < ia.length; ti += 3) { var tmp = ia[ti + 1]; ia[ti + 1] = ia[ti + 2]; ia[ti + 2] = tmp; }
                geo.getIndex().needsUpdate = true; geo.computeVertexNormals();
            }
            return geo;
        }
        /* z, half-width, bottom, beltline, top, cockpit dip, fender peak.
           V3 proportions measured against the real car (Wikipedia /
           Tesla: length 3,946 mm, wheelbase 2,352 mm, width 1,873 mm
           incl. mirrors — body ≈1,852 — height 1,127 mm) and SpaceX's
           camera frames: v2's shell was ≈4% too narrow for its length
           (W/L 0.452 vs the real 0.469) and its rear deck sat low; the
           widths below are v2 × 1.04, the cowl and the whole rear deck
           are raised, and the front/rear shoulder peaks are on. Wheel-
           base stays 0.430 of 0.725 length = 0.593 (real: 0.596). */
        var rawStations = [
            [-0.365, 0.085, -0.044, -0.006, 0.002, 0, 0],
            [-0.335, 0.127, -0.058, 0.010, 0.018, 0, 0.8],
            [-0.275, 0.154, -0.068, 0.026, 0.035, 0, 1.0],
            [-0.215, 0.166, -0.071, 0.036, 0.043, 0, 0.9],
            [-0.150, 0.164, -0.072, 0.040, 0.045, 0, 0.55],
            [-0.105, 0.161, -0.072, 0.044, 0.050, 0, 0.25],
            [-0.055, 0.159, -0.072, 0.046, 0.051, 0.046, 0.1],
            [0.000, 0.160, -0.072, 0.047, 0.049, 0.047, 0],
            [0.060, 0.161, -0.072, 0.047, 0.049, 0.044, 0],
            [0.115, 0.162, -0.072, 0.048, 0.056, 0.024, 0.2],
            [0.170, 0.166, -0.072, 0.048, 0.059, 0, 0.55],
            [0.215, 0.171, -0.072, 0.049, 0.057, 0, 0.8],
            [0.280, 0.164, -0.068, 0.043, 0.050, 0, 0.5],
            [0.330, 0.150, -0.060, 0.036, 0.042, 0, 0.15],
            [0.360, 0.125, -0.046, 0.024, 0.032, 0, 0]
        ];
        var stations = rawStations.map(function (s) {
            return { z: s[0], pts: section({ hw: s[1], yBot: s[2], yBelt: s[3], yTop: s[4], dip: s[5], peak: s[6] }) };
        });
        /* V3 surface helpers: interpolate the station parameters at any
           z and read the loft's own section maths, so added geometry
           (carbon hood patch, cutline tubes, charge port) lies exactly
           on the shell rather than near it. */
        function sectionAt(z) {
            var a = rawStations[0], b = rawStations[rawStations.length - 1];
            for (var i = 0; i < rawStations.length - 1; i++) {
                if (z >= rawStations[i][0] && z <= rawStations[i + 1][0]) { a = rawStations[i]; b = rawStations[i + 1]; break; }
            }
            var t = (b[0] - a[0]) < 1e-9 ? 0 : (z - a[0]) / (b[0] - a[0]);
            var p = [];
            for (var k = 1; k <= 6; k++) p.push(a[k] + (b[k] - a[k]) * t);
            return section({ hw: p[0], yBot: p[1], yBelt: p[2], yTop: p[3], dip: p[4], peak: p[5] });
        }
        function surfY(z, x) {   /* height of the top arc at (z, x) */
            var pts = sectionAt(z);
            for (var i = 5; i < 13; i++) {
                var a = pts[i], b = pts[i + 1];
                if (x >= Math.min(a[0], b[0]) - 1e-9 && x <= Math.max(a[0], b[0]) + 1e-9 && Math.abs(b[0] - a[0]) > 1e-9) {
                    return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]));
                }
            }
            return pts[9][1];
        }
        function surfX(z, y) {   /* half-width of the flank at (z, y), right side */
            var pts = sectionAt(z);
            for (var i = 0; i < 9; i++) {
                var a = pts[i], b = pts[i + 1];
                if (y >= Math.min(a[1], b[1]) - 1e-9 && y <= Math.max(a[1], b[1]) + 1e-9 && Math.abs(b[1] - a[1]) > 1e-9) {
                    return a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1]));
                }
            }
            return pts[4][0];
        }
        /* V2: the lofted body wears the seam-drawn paint; everything
           else painted keeps the v1 flake material. */
        var bodyMaps = bodyPaintMaps();
        var bodyMat = new THREE.MeshPhysicalMaterial({ map: bodyMaps.map, roughnessMap: bodyMaps.rough,
            color: 0x8a1220, metalness: 0.5, roughness: 1.0, clearcoat: 1, clearcoatRoughness: 0.055,
            clearcoatRoughnessMap: bodyMaps.rough, envMap: SHIP.carEnv, envMapIntensity: 1.4 });
        g.add(new THREE.Mesh(loft(stations), bodyMat));
        /* ---- V3 photo-match geometry --------------------------------
           Built from SpaceX's own frames of the actual car:
           · the hood is a CARBON-FIBRE panel, not red paint — both
             front cameras show a dark woven panel with two louver
             banks, framed by the red fender crowns;
           · door and decklid shutlines are geometry lying on the
             shell, not lines drawn in the paint map;
           · the charge-port door is a ring on the left rear haunch
             (clearly visible in the driver's-side frame). */
        function carbonTexture() {
            var c = document.createElement('canvas'); c.width = c.height = 128;
            var g2 = c.getContext('2d');
            g2.fillStyle = '#17171a'; g2.fillRect(0, 0, 128, 128);
            var cell = 8;   /* 2x2 twill weave */
            for (var yy = 0; yy < 16; yy++) for (var xx = 0; xx < 16; xx++) {
                var horiz = ((xx + yy * 2) % 4) < 2;
                var grd = horiz ? g2.createLinearGradient(xx * cell, yy * cell, (xx + 1) * cell, yy * cell)
                                : g2.createLinearGradient(xx * cell, yy * cell, xx * cell, (yy + 1) * cell);
                grd.addColorStop(0, '#101013'); grd.addColorStop(0.5, '#33333a'); grd.addColorStop(1, '#0c0c0f');
                g2.fillStyle = grd; g2.fillRect(xx * cell, yy * cell, cell, cell);
            }
            var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
            t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 5); t.anisotropy = 8;
            return t;
        }
        var carbonMat = new THREE.MeshPhysicalMaterial({ map: carbonTexture(), color: 0xbdbdc4,
            metalness: 0.3, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.25,
            envMap: SHIP.carEnv, envMapIntensity: 1.0 });
        function hoodPatch(xHalf, z0, z1, lift) {
            var rows = 16, cols = 14, pos = [], uvA = [], idx = [];
            for (var ri = 0; ri <= rows; ri++) {
                var z = z0 + (z1 - z0) * (ri / rows);
                for (var ci = 0; ci <= cols; ci++) {
                    var x = -xHalf + 2 * xHalf * (ci / cols);
                    pos.push(x, surfY(z, x) + lift, z); uvA.push(ci / cols, ri / rows);
                }
            }
            for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
                var a = r2 * (cols + 1) + c2, b = a + 1, d = a + cols + 1, e = d + 1;
                idx.push(a, d, b, b, d, e);
            }
            var geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
            geo.setIndex(idx); geo.computeVertexNormals();
            return geo;
        }
        var hoodUnder = new THREE.Mesh(hoodPatch(0.098, -0.324, -0.092, 0.0007), M.wellDark);
        g.add(hoodUnder);   /* the dark shutline gap around the panel */
        var hood = new THREE.Mesh(hoodPatch(0.090, -0.318, -0.098, 0.0013), carbonMat);
        g.add(hood);
        [-1, 1].forEach(function (sx) {   /* louver banks, as on the real hood */
            for (var lv = 0; lv < 5; lv++) {
                var lz = -0.208 + lv * 0.020;
                var slat = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.0016, 0.010), M.wellDark);
                var yA = surfY(lz - 0.007, sx * 0.047), yB = surfY(lz + 0.007, sx * 0.047);
                slat.position.set(sx * 0.047, (yA + yB) / 2 + 0.0018, lz);
                slat.rotation.x = Math.atan2(yB - yA, 0.014) + 0.55;
                g.add(slat);
            }
        });
        /* shutline tubes: a dark bead lying in the panel gap */
        var grooveMat = new THREE.MeshStandardMaterial({ color: 0x12060a, metalness: 0.2,
            roughness: 0.9, envMap: SHIP.carEnv, envMapIntensity: 0.25 });
        function groove(pts3, closed) {
            var curve = new THREE.CatmullRomCurve3(pts3.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }), closed, 'catmullrom', 0.08);
            var tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.0011, 6, closed), grooveMat);
            g.add(tube); return tube;
        }
        [-1, 1].forEach(function (sx) {   /* both doors, at the paint map's own v edges */
            function dp(z, y) { return [sx * (surfX(z, y) + 0.0004), y, z]; }
            groove([dp(-0.112, 0.038), dp(-0.114, -0.006), dp(-0.110, -0.036),
                    dp(-0.012, -0.040), dp(0.086, -0.038), dp(0.092, -0.006),
                    dp(0.090, 0.038), dp(-0.010, 0.0415)], true);
        });
        (function () {   /* decklid outline on the raised rear deck */
            function tp(x, z) { return [x, surfY(z, x) + 0.0004, z]; }
            groove([tp(-0.102, 0.240), tp(0, 0.236), tp(0.102, 0.240), tp(0.106, 0.288),
                    tp(0.098, 0.330), tp(0, 0.334), tp(-0.098, 0.330), tp(-0.106, 0.288)], true);
        })();
        (function () {   /* charge-port door, left rear haunch */
            var cz = 0.252, cy = 0.024, cx = surfX(cz, cy);
            var ring = new THREE.Mesh(new THREE.TorusGeometry(0.0105, 0.0013, 8, 28), grooveMat);
            ring.position.set(-cx - 0.0004, cy, cz); ring.rotation.y = Math.PI / 2; g.add(ring);
            var doorDisc = new THREE.Mesh(new THREE.CircleGeometry(0.0102, 28), M.carPaint);
            doorDisc.position.set(-cx - 0.0003, cy, cz); doorDisc.rotation.y = -Math.PI / 2; g.add(doorDisc);
        })();
        var lip = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.0035, 0.013), M.carPaint);
        lip.position.set(0, surfY(0.350, 0) - 0.0005, 0.349); lip.rotation.x = -0.12; g.add(lip);
        var nose = new THREE.Mesh(new THREE.SphereGeometry(0.052, 28, 20), M.carPaint);
        nose.scale.set(1.45, 0.52, 0.35); nose.position.set(0, -0.024, -0.352); g.add(nose);
        var intake = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.020, 0.012), M.wellDark);
        intake.position.set(0, -0.036, -0.358); intake.rotation.x = 0.25; g.add(intake);
        /* wheels, V2: lathe carcass with photographic rubber micro-grain,
           a tread band with a drawn performance tread, lettered sidewall
           rings, geometric five-twin-spoke rims with depth, and brake
           hardware behind the spokes. Front and rear wear their real,
           different sizes (195/50 R16, 225/45 R17). sgn = outboard side. */
        function wheel(rOut, rimR, width, sgn, sideMat) {
            var w = new THREE.Group();
            var prof = [
                [rimR - 0.001, -width / 2 + 0.003], [rOut - 0.020, -width / 2],
                [rOut - 0.006, -width * 0.31], [rOut - 0.001, -width * 0.16],
                [rOut - 0.001, width * 0.16], [rOut - 0.006, width * 0.31],
                [rOut - 0.020, width / 2], [rimR - 0.001, width / 2 - 0.003]
            ].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
            var carcass = new THREE.Mesh(new THREE.LatheGeometry(prof, 52), M.tireCarcass);
            carcass.geometry.rotateZ(Math.PI / 2); w.add(carcass);
            var tread = new THREE.Mesh(new THREE.CylinderGeometry(rOut + 0.0006, rOut + 0.0006, width * 0.60, 56, 1, true), M.tireTread);
            tread.geometry.rotateZ(Math.PI / 2); w.add(tread);
            var sw = new THREE.Mesh(new THREE.RingGeometry(rimR + 0.001, rOut - 0.0035, 52), sideMat);
            sw.position.x = sgn * (width / 2 + 0.0004); sw.rotation.y = sgn * Math.PI / 2; w.add(sw);
            var barrelMat = M.rimSide.clone(); barrelMat.side = THREE.DoubleSide;
            var barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, width * 0.84, 36, 1, true), barrelMat);
            barrel.geometry.rotateZ(Math.PI / 2); w.add(barrel);
            var lip = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.0015, 0.0032, 10, 44), M.rimSide);
            lip.geometry.rotateY(Math.PI / 2); lip.position.x = sgn * (width / 2 - 0.002); w.add(lip);
            var disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.80, rimR * 0.80, 0.005, 36), M.brakeDisc);
            disc.geometry.rotateZ(Math.PI / 2); disc.position.x = sgn * width * 0.08; w.add(disc);
            var cal = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.019, 0.012), M.caliper);
            cal.position.set(sgn * width * 0.08, rimR * 0.50, rimR * 0.44); w.add(cal);
            var faceX = sgn * width * 0.27;
            for (var i = 0; i < 5; i++) {
                var a0 = i / 5 * Math.PI * 2;
                [-0.11, 0.11].forEach(function (off) {
                    var ang = a0 + off;
                    var sp = new THREE.Mesh(new THREE.BoxGeometry(0.0055, rimR - 0.004, 0.0105), M.rimSide);
                    sp.position.set(faceX, Math.cos(ang) * rimR * 0.50, Math.sin(ang) * rimR * 0.50);
                    sp.rotation.x = ang; w.add(sp);
                });
                var la = a0 + Math.PI / 5;
                var lug = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.004, 10), M.darkMetal);
                lug.geometry.rotateZ(Math.PI / 2);
                lug.position.set(sgn * (width * 0.27 + 0.003), Math.cos(la) * 0.0068, Math.sin(la) * 0.0068); w.add(lug);
            }
            var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.007, 20), M.rimSide);
            hub.geometry.rotateZ(Math.PI / 2); hub.position.x = faceX; w.add(hub);
            return w;
        }
        [-1, 1].forEach(function (sx) {
            var wf = wheel(0.056, 0.0365, 0.036, sx, M.tireSideF); wf.position.set(sx * 0.147, -0.044, -0.215); g.add(wf);
            var wr = wheel(0.0585, 0.0393, 0.042, sx, M.tireSideR); wr.position.set(sx * 0.147, -0.0415, 0.215); g.add(wr);
            [[-0.215, 0.069, -0.044], [0.215, 0.072, -0.0415]].forEach(function (wd) {
                var disc = new THREE.Mesh(new THREE.CircleGeometry(wd[1], 30), M.wellDark);
                disc.position.set(sx * 0.1545, wd[2], wd[0]); disc.rotation.y = sx * Math.PI / 2; g.add(disc);
            });
            /* door handle, just under the beltline at the door's rear */
            var handle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.005, 0.020), M.darkMetal);
            handle.position.set(sx * 0.1585, 0.038, 0.070); g.add(handle);
        });
        /* side intake scoops behind the doors — V3: smaller, higher
           and in dash-dark rather than void-black; v2's slab read as a
           missing panel in profile, where the real intake is a modest
           recessed vent ahead of the rear wheel. */
        [-1, 1].forEach(function (sx) {
            var scoop = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.019, 0.050), M.dashDark);
            scoop.position.set(sx * 0.1645, 0.002, 0.110); scoop.rotation.y = sx * 0.06; g.add(scoop);
        });
        /* cockpit: floor, console, dash, DON'T PANIC screen, toy Roadster */
        var floor = new THREE.Mesh(new THREE.BoxGeometry(0.225, 0.006, 0.185), M.carpet);
        floor.position.set(0, 0.000, 0.028); g.add(floor);
        var consol = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.026, 0.155), M.dashDark);
        consol.position.set(0, 0.012, 0.028); g.add(consol);
        var shifter = new THREE.Mesh(new THREE.SphereGeometry(0.006, 14, 10), M.darkMetal);
        shifter.scale.set(1, 0.8, 1.3); shifter.position.set(0, 0.028, -0.018); g.add(shifter);
        var dash = new THREE.Mesh(new THREE.BoxGeometry(0.232, 0.030, 0.052), M.dashDark);
        dash.position.set(0, 0.032, -0.058); dash.rotation.x = -0.12; g.add(dash);
        [-1, 1].forEach(function (sx) {   /* round dash vents */
            var vent = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.005, 18), M.darkMetal);
            vent.rotation.x = Math.PI / 2 - 0.12; vent.position.set(sx * 0.088, 0.041, -0.049); g.add(vent);
            var vring = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0013, 8, 20), M.rimSide);
            vring.position.set(sx * 0.088, 0.041, -0.0515); vring.rotation.x = -0.12; g.add(vring);
        });
        var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.060, 0.0375), new THREE.MeshBasicMaterial({ map: SHIP.dashTex }));
        screen.position.set(-0.004, 0.050, -0.040); screen.rotation.x = -1.05; g.add(screen);
        var mini = new THREE.Group(); mini.position.set(0.052, 0.0495, -0.058); mini.rotation.y = 0.15;
        var mb = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.0045, 0.030), M.carPaint); mini.add(mb);
        var mcab = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.0035, 0.014), M.dashDark); mcab.position.set(0, 0.0038, 0.002); mini.add(mcab);
        var mhelm = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 10, 8), M.helmet); mhelm.position.set(-0.002, 0.006, 0.004); mini.add(mhelm);
        [[-0.006, -0.009], [0.006, -0.009], [-0.006, 0.009], [0.006, 0.009]].forEach(function (mw) {
            var mwh = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.002, 10), M.wellDark);
            mwh.geometry.rotateZ(Math.PI / 2); mwh.position.set(mw[0], -0.0022, mw[1]); mini.add(mwh);
        });
        g.add(mini);
        /* steering wheel + column */
        var wheelG = new THREE.Group(); wheelG.position.set(-0.068, 0.052, -0.038); wheelG.rotation.x = -0.52;
        wheelG.add(new THREE.Mesh(new THREE.TorusGeometry(0.030, 0.0052, 10, 36), M.dashDark));
        var spoke1 = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.006, 0.004), M.flatMetal); wheelG.add(spoke1);
        var spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.028, 0.004), M.flatMetal); spoke2.position.y = -0.013; wheelG.add(spoke2);
        var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.010, 16), M.flatMetal);
        hub.rotation.x = Math.PI / 2; wheelG.add(hub);
        g.add(wheelG);
        g.add(seg([-0.068, 0.040, -0.056], [-0.068, 0.050, -0.040], 0.006, M.dashDark));
        /* seats, V2: built up from cushion, back, bolsters and headrest
           in photographic-grain leather instead of three blobs */
        function seat(x) {
            var s = new THREE.Group();
            var cushion = new THREE.Mesh(new THREE.BoxGeometry(0.090, 0.020, 0.098), M.leather);
            cushion.position.set(0, 0.014, 0.026); s.add(cushion);
            var lip = new THREE.Mesh(new THREE.SphereGeometry(0.048, 20, 14), M.leather);
            lip.scale.set(0.92, 0.30, 0.55); lip.position.set(0, 0.016, -0.020); s.add(lip);
            var shell = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.114, 0.008), M.dashDark);
            shell.position.set(0, 0.066, 0.0945); shell.rotation.x = 0.24; s.add(shell);
            var back = new THREE.Mesh(new THREE.BoxGeometry(0.090, 0.108, 0.022), M.leather);
            back.position.set(0, 0.066, 0.082); back.rotation.x = 0.24; s.add(back);
            [-1, 1].forEach(function (sx) {
                var bol = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.094, 0.030), M.leather);
                bol.position.set(sx * 0.041, 0.062, 0.078); bol.rotation.x = 0.24; bol.rotation.z = sx * -0.10; s.add(bol);
                var tbol = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.020, 0.070), M.leather);
                tbol.position.set(sx * 0.041, 0.020, 0.022); s.add(tbol);
            });
            var head = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.034, 0.024), M.leather);
            head.position.set(0, 0.130, 0.096); head.rotation.x = 0.24; s.add(head);
            s.position.x = x; return s;
        }
        g.add(seat(-0.068)); g.add(seat(0.068));
        /* windshield: curved glass + painted frame */
        var glassGeo = new THREE.PlaneGeometry(0.228, 0.070, 16, 1);
        var gp = glassGeo.attributes.position;
        for (var gi = 0; gi < gp.count; gi++) { var gx = gp.getX(gi); gp.setZ(gi, -Math.pow(Math.abs(gx) / 0.114, 2) * 0.007); }
        glassGeo.computeVertexNormals();
        var shield = new THREE.Mesh(glassGeo, M.shieldGlass);
        shield.position.set(0, 0.080, -0.082); shield.rotation.x = 0.50; shield.renderOrder = 5; g.add(shield);
        /* V3: the windshield surround on the real car reads black in
           every SpaceX frame — dark frame, not body colour. */
        g.add(seg([-0.113, 0.049, -0.103], [-0.106, 0.110, -0.071], 0.0048, M.darkMetal));
        g.add(seg([0.113, 0.049, -0.103], [0.106, 0.110, -0.071], 0.0048, M.darkMetal));
        g.add(seg([-0.106, 0.110, -0.071], [0.106, 0.110, -0.071], 0.0048, M.darkMetal));
        g.add(seg([-0.110, 0.050, -0.101], [0.110, 0.050, -0.101], 0.0048, M.darkMetal));
        /* rear-view mirror on the windshield frame */
        g.add(seg([0, 0.106, -0.072], [0, 0.095, -0.069], 0.0022, M.darkMetal));
        var rvm = new THREE.Mesh(new THREE.BoxGeometry(0.037, 0.012, 0.004), M.darkMetal);
        rvm.position.set(0, 0.092, -0.067); g.add(rvm);
        /* rear-deck headrest fairings + mirrors (V2: painted housings
           with a real glass face, not dark blobs) */
        [-0.068, 0.068].forEach(function (hx) {
            var hump = new THREE.Mesh(new THREE.SphereGeometry(0.036, 24, 16), M.carPaint);
            hump.scale.set(0.95, 0.38, 1.5); hump.position.set(hx, 0.052, 0.148); g.add(hump);
        });
        [-1, 1].forEach(function (sx) {
            /* V3: the real mirrors stand well clear of the body on
               their stalks (front-camera frames) — moved outboard. */
            g.add(seg([sx * 0.147, 0.050, -0.088], [sx * 0.163, 0.063, -0.091], 0.0032, M.darkMetal));
            var mir = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 18, 14), M.carPaint);
            mir.scale.set(0.72, 0.60, 1.25); mir.position.set(sx * 0.170, 0.067, -0.092); g.add(mir);
            var mglass = new THREE.Mesh(new THREE.CircleGeometry(0.0082, 20), M.glass);
            mglass.scale.set(0.72, 0.60, 1); mglass.position.set(sx * 0.170, 0.067, -0.0774); g.add(mglass);
        });
        /* ---- Starman himself, V2: the same verified pose, but the suit
           is built like a suit — seam rings at the joints, the ribbed
           dark panel ribbed for real, a chest unit, backpack volume
           behind the torso, and a metal helmet ring under the shell.
           The photographic fabric weave (ambientCG Fabric030, CC0)
           rides on every suit material. ---- */
        var man = new THREE.Group(); g.add(man);
        function ringAt(p, dir, r, tube, mat) {
            var m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 26), mat);
            m.position.set(p[0], p[1], p[2]);
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
                new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
            man.add(m); return m;
        }
        var pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.033, 24, 18), M.suit);
        pelvis.scale.set(1.1, 0.8, 0.95); pelvis.position.set(-0.068, 0.038, 0.048); man.add(pelvis);
        var torso = seg([-0.068, 0.040, 0.050], [-0.068, 0.116, 0.060], 0.0315, M.suit);
        torso.scale.set(1.18, 1, 0.80); man.add(torso);
        /* backpack volume + its ribbed centre strip, mostly seat-hidden */
        var pack = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.078, 0.022), M.suit);
        pack.position.set(-0.068, 0.086, 0.091); pack.rotation.x = 0.13; man.add(pack);
        var packRib = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.070, 0.004), M.suitGray);
        packRib.position.set(-0.068, 0.086, 0.103); packRib.rotation.x = 0.13; man.add(packRib);
        /* chest unit with two ports and a status dot; centre zipper */
        var chest = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.028, 0.013), M.suit);
        chest.position.set(-0.068, 0.097, 0.0275); chest.rotation.x = -0.13; man.add(chest);
        [-0.009, 0.009].forEach(function (ox) {
            var port = new THREE.Mesh(new THREE.CylinderGeometry(0.0036, 0.0036, 0.003, 12), M.darkMetal);
            port.rotation.x = Math.PI / 2 - 0.13; port.position.set(-0.068 + ox, 0.094, 0.0205); man.add(port);
        });
        var dot = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 10),
            new THREE.MeshBasicMaterial({ color: 0x7fd4ff }));
        dot.position.set(-0.068, 0.104, 0.0208); dot.rotation.x = -0.13; dot.rotation.y = Math.PI; man.add(dot);
        var zip = new THREE.Mesh(new THREE.BoxGeometry(0.0032, 0.058, 0.002), M.suitDark);
        zip.position.set(-0.068, 0.078, 0.0300); zip.rotation.x = -0.13; man.add(zip);
        [-0.086, -0.050].forEach(function (lx) {
            man.add(seg([lx, 0.032, 0.042], [lx, 0.022, -0.026], 0.0165, M.suit));
            man.add(seg([lx, 0.022, -0.026], [lx, -0.026, -0.016], 0.0135, M.suit));
            ringAt([lx, 0.022, -0.026], [0, -0.19, 0.98], 0.0168, 0.0018, M.suitGray);   /* knee seam */
            ringAt([lx, -0.024, -0.017], [0, -0.98, 0.19], 0.0138, 0.0018, M.suitGray);  /* ankle seam */
            var boot = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.014, 0.042), M.suitDark);
            boot.position.set(lx, -0.030, -0.026); man.add(boot);
            var toe = new THREE.Mesh(new THREE.SphereGeometry(0.0122, 14, 10), M.suitDark);
            toe.scale.set(0.98, 0.55, 1.0); toe.position.set(lx, -0.031, -0.046); man.add(toe);
        });
        /* right arm to the wheel; left arm along the door (grey forearm panel, as worn) */
        man.add(seg([-0.036, 0.114, 0.054], [-0.014, 0.058, -0.002], 0.0145, M.suit));
        man.add(seg([-0.014, 0.058, -0.002], [-0.043, 0.060, -0.033], 0.0125, M.suit));
        man.add(seg([-0.100, 0.114, 0.054], [-0.144, 0.062, 0.010], 0.0145, M.suit));
        man.add(seg([-0.144, 0.062, 0.010], [-0.147, 0.063, -0.066], 0.0128, M.suitGray));
        /* joint seams: shoulders, elbows, glove cuffs */
        ringAt([-0.036, 0.112, 0.054], [0.55, -0.83, 0.05], 0.0148, 0.0018, M.suitGray);
        ringAt([-0.100, 0.112, 0.054], [-0.62, -0.78, 0.06], 0.0148, 0.0018, M.suitGray);
        ringAt([-0.014, 0.058, -0.002], [0.62, 0.03, -0.90], 0.0128, 0.0018, M.suitGray);
        ringAt([-0.040, 0.060, -0.030], [0.62, 0.03, -0.90], 0.0122, 0.0022, M.suitDark);
        ringAt([-0.1465, 0.063, -0.062], [0.02, 0.01, -1], 0.0124, 0.0022, M.suitDark);
        /* the ribbed forearm panel, ribbed: six dark rings along the forearm */
        for (var rb = 0; rb < 6; rb++) {
            var rt = 0.14 + rb * 0.15;
            ringAt([-0.144 - 0.003 * rt, 0.062 + 0.001 * rt, 0.010 - 0.076 * rt], [0.02, 0.01, -1], 0.0132, 0.0016, M.suitDark);
        }
        [[-0.043, 0.060, -0.033], [-0.147, 0.063, -0.072]].forEach(function (h) {
            var gl = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 16, 12), M.suitGray);
            gl.scale.set(0.9, 0.78, 1.2); gl.position.set(h[0], h[1], h[2]); man.add(gl);
        });
        /* V3 joint construction: a real suit bunches and rounds at its
           joints — spheres at shoulders, elbows, hips and knees break
           the capsule-to-capsule smoothness v2 was called out for, and
           the elbow on the door side starts the dark forearm panel the
           photos show. Plus the grey shoulder yoke and the black
           harness straps the front-camera frames show over the chest. */
        function joint(p, r, mat, sy) {
            var j = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat);
            j.scale.set(1, sy || 1, 1); j.position.set(p[0], p[1], p[2]); man.add(j); return j;
        }
        joint([-0.036, 0.114, 0.054], 0.0172, M.suit);            /* shoulders */
        joint([-0.100, 0.114, 0.054], 0.0172, M.suit);
        joint([-0.014, 0.058, -0.002], 0.0138, M.suit);           /* right elbow */
        joint([-0.144, 0.062, 0.010], 0.0138, M.suitGray);        /* left elbow — dark panel begins */
        [-0.086, -0.050].forEach(function (lx) {
            joint([lx, 0.034, 0.040], 0.0200, M.suit, 0.9);       /* hips */
            joint([lx, 0.022, -0.026], 0.0178, M.suit);           /* knees */
        });
        var yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.041, 0.013, 20), M.suitGray);
        yoke.position.set(-0.068, 0.129, 0.058); yoke.rotation.x = 0.14; man.add(yoke);
        [-1, 1].forEach(function (ss) {
            var strap = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.088, 0.0025), M.suitDark);
            strap.position.set(-0.068 + ss * 0.0135, 0.083, 0.0265);
            strap.rotation.x = -0.10; strap.rotation.z = ss * 0.30; man.add(strap);
        });
        var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.0195, 0.022, 0.020, 20), M.suitGray);
        neck.position.set(-0.068, 0.144, 0.059); neck.rotation.x = 0.14; man.add(neck);
        var hRing = new THREE.Mesh(new THREE.TorusGeometry(0.0235, 0.0042, 10, 28), M.flatMetal);
        hRing.position.set(-0.068, 0.152, 0.058); hRing.rotation.x = Math.PI / 2 + 0.14; man.add(hRing);
        var helmet = new THREE.Group(); helmet.position.set(-0.068, 0.170, 0.056); helmet.rotation.x = -0.06; man.add(helmet);
        helmet.add(new THREE.Mesh(new THREE.SphereGeometry(0.0275, 48, 32), M.helmet));
        helmet.add(new THREE.Mesh(new THREE.SphereGeometry(0.0281, 48, 32, -Math.PI / 2 - 0.70, 1.40, 0.88, 1.14), M.darkMetal));
        helmet.add(new THREE.Mesh(new THREE.SphereGeometry(0.0286, 48, 32, -Math.PI / 2 - 0.60, 1.20, 0.98, 0.94), M.visor));
        /* headlights + beams, tail-lights + glow, high-speed light-smear.
           V2: the lamps sit in smoked housings sunk into the fenders and
           the rear panel — separate parts with lenses, like the real car. */
        var lensMat = new THREE.MeshPhysicalMaterial({ color: 0xd7e4ec, metalness: 0.15, roughness: 0.14,
            clearcoat: 1, clearcoatRoughness: 0.08, envMap: SHIP.carEnv, envMapIntensity: 1.3,
            emissive: 0x9fc4ee, emissiveIntensity: 0.25 });
        var beams = [];
        [-1, 1].forEach(function (sx) {
            var housing = new THREE.Mesh(new THREE.SphereGeometry(0.0175, 26, 18), M.smokedLens);
            /* V3: the lamps ride up on the fender crowns, as in the
               front-camera frames, not down on the fascia. */
            housing.scale.set(0.95, 0.42, 2.6); housing.position.set(sx * 0.099, 0.0345, -0.283);
            housing.rotation.x = -0.10; housing.rotation.y = sx * -0.06; g.add(housing);
            var lens = new THREE.Mesh(new THREE.SphereGeometry(0.0155, 24, 16), lensMat);
            lens.scale.set(0.88, 0.36, 2.3); lens.position.set(sx * 0.099, 0.0360, -0.291);
            lens.rotation.x = -0.14; lens.rotation.y = sx * -0.07; lens.castShadow = false; g.add(lens);
            var bm = makeBeam(0.85, 0.055); bm.mesh.position.set(sx * 0.099, 0.034, -0.325); g.add(bm.mesh); beams.push(bm);
        });
        var tailMat = new THREE.MeshStandardMaterial({ color: 0x2a0202, emissive: 0xff2a18, emissiveIntensity: 0.5,
            roughness: 0.3, metalness: 0.1, envMap: SHIP.carEnv });
        var rearPanel = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.034, 0.010), M.dashDark);
        rearPanel.position.set(0, 0.002, 0.3565); g.add(rearPanel);
        [-1, 1].forEach(function (sx) {
            [[0.080, 0.0138], [0.048, 0.0095]].forEach(function (lp) {
                var th = new THREE.Mesh(new THREE.CylinderGeometry(lp[1] + 0.0022, lp[1] + 0.0022, 0.009, 24), M.darkMetal);
                th.geometry.rotateX(Math.PI / 2); th.position.set(sx * lp[0], 0.006, 0.358); g.add(th);
                var ring = new THREE.Mesh(new THREE.TorusGeometry(lp[1] + 0.0012, 0.0014, 8, 26), M.rimSide);
                ring.position.set(sx * lp[0], 0.006, 0.3628); g.add(ring);
                var tl = new THREE.Mesh(new THREE.CircleGeometry(lp[1], 24), tailMat);
                tl.position.set(sx * lp[0], 0.006, 0.3626); g.add(tl);
            });
        });
        var brake = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.005, 0.004), tailMat);
        brake.position.set(0, 0.024, 0.3605); g.add(brake);
        var tailGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: SHIP.glowTex, color: 0xff4030,
            transparent: true, opacity: 0.10, depthWrite: false, blending: THREE.AdditiveBlending }));
        tailGlow.position.set(0, 0.010, 0.385); tailGlow.scale.set(0.34, 0.13, 1); g.add(tailGlow);
        var trailMat = new THREE.MeshBasicMaterial({ map: SHIP.glowTex, color: 0xff5030, transparent: true,
            opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        var trails = [];
        [-1, 1].forEach(function (sx) {
            var tr = new THREE.Mesh(new THREE.PlaneGeometry(0.030, 0.55), trailMat);
            tr.rotation.x = Math.PI / 2; tr.position.set(sx * 0.082, 0.012, 0.64); g.add(tr); trails.push(tr);
        });
        shadowed(g);
        shield.castShadow = false;
        var tumble = { a: 0, b: 0, w: 0 };
        g.scale.setScalar(0.82);
        return { group: g, update: function (r, sdt, t, bank) {
            lensMat.emissiveIntensity = 0.25 + r * 1.6;
            beams.forEach(function (bm) { bm.mat.uniforms.uI.value = Math.max(0, r - 0.18) * 0.16; });
            tailMat.emissiveIntensity = 0.5 + r * 1.3;
            tailGlow.material.opacity = 0.08 + r * 0.20;
            var tr2 = Math.max(0, (r - 0.55) / 0.45);
            trailMat.opacity = tr2 * 0.13;
            trails.forEach(function (tm) { tm.scale.set(1, 0.6 + tr2 * 0.9, 1); });
            /* the real car's tumble: full roll about the long axis at the
               measured period (285.5 s), a gentler secondary nod; fades
               out as speed or steering takes over */
            var steer = Math.min(1, (Math.abs(bank ? bank.roll : 0) + Math.abs(bank ? bank.pitch : 0)) * 5);
            var target = Math.max(0, 1 - r / 0.55) * (1 - steer);
            tumble.w += (target - tumble.w) * (1 - Math.exp(-sdt / 1.1));
            tumble.a += sdt * tumble.w * (Math.PI * 2 / 285.5);
            tumble.b += sdt * tumble.w * (Math.PI * 2 / 771.0);
            g.rotation.z = tumble.a * tumble.w + (bank ? bank.roll * 0.30 : 0);
            g.rotation.x = Math.sin(tumble.b) * 0.35 * tumble.w + (bank ? bank.pitch * 0.25 : 0);
        } };
    }
    /* ---- The Disc: classic saucer, glow instead of plume (Johnny's pick) ---- */
    function buildDisc() {
        var M = SHIP.mats, g = new THREE.Group();
        var prof = [[0.001, -0.030], [0.07, -0.031], [0.14, -0.026], [0.21, -0.016], [0.252, -0.004], [0.258, 0.002], [0.24, 0.010], [0.17, 0.020], [0.115, 0.027], [0.10, 0.030]]
            .map(function (p) { return new THREE.Vector2(p[0], p[1]); });
        g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 128), M.discHull));
        var dome = new THREE.Mesh(new THREE.SphereGeometry(0.088, 64, 40), M.glass);
        dome.scale.set(1, 0.60, 1); dome.position.y = 0.020; g.add(dome);
        var belly = new THREE.Mesh(new THREE.SphereGeometry(0.046, 40, 24), M.darkMetal);
        belly.scale.set(1, 0.55, 1); belly.position.y = -0.030; g.add(belly);
        var glowMat = new THREE.MeshBasicMaterial({ color: 0x39586b, transparent: true, opacity: 0.85 });
        var glowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.078, 48), glowMat);
        glowDisc.rotation.x = Math.PI / 2; glowDisc.position.y = -0.0315; g.add(glowDisc);
        var sensor = new THREE.Mesh(new THREE.SphereGeometry(0.020, 28, 18), M.glass);
        sensor.position.y = 0.082; g.add(sensor);
        var rimMats = [], rimLights = [];
        for (var i = 0; i < 14; i++) {
            var a2 = i / 14 * Math.PI * 2;
            var lm = new THREE.MeshBasicMaterial({ color: 0x554e40 });
            var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.0058, 12, 10), lm);
            bulb.position.set(Math.cos(a2) * 0.2505, -0.001, Math.sin(a2) * 0.2505);
            g.add(bulb); rimMats.push(lm); rimLights.push(bulb);
        }
        for (var bi = 0; bi < 3; bi++) {
            var ba = bi / 3 * Math.PI * 2 + 0.5;
            var bump = new THREE.Mesh(new THREE.SphereGeometry(0.009, 16, 12), M.discHull);
            bump.position.set(Math.cos(ba) * 0.13, 0.026, Math.sin(ba) * 0.13); g.add(bump);
        }
        var spill = new THREE.PointLight(0x8fd0ff, 0, 2.0, 2); spill.position.set(0, -0.14, 0); g.add(spill);
        var topLight = new THREE.PointLight(0xbfe0ff, 0, 1.4, 2); topLight.position.set(0, 0.16, 0); g.add(topLight);
        shadowed(g);
        return { group: g, update: function (r, sdt, t, bank) {
            var gl = 0.35 + r * 1.9;
            glowMat.color.setRGB(0.45 * gl, 0.60 * gl, 0.70 * gl);
            spill.intensity = 0.5 + r * 4; topLight.intensity = 0.6 + r * 2;
            var chase = t * (1.2 + r * 9);
            for (var i = 0; i < 14; i++) {
                var ph = Math.pow(0.5 + 0.5 * Math.sin(chase * 2.2 - i * (Math.PI * 2 / 14) * 3), 3);
                var b2 = 0.16 + ph * (0.5 + r * 1.6);
                rimMats[i].color.setRGB(1.0 * b2, 0.83 * b2, 0.55 * b2);
            }
            if (bank) { g.rotation.x = 0.28 + bank.pitch * 0.9; g.rotation.z = bank.roll * 0.9; }
        } };
    }
    /* CRAFT REGISTRY — the single registration point for the toggle's two
       slots: slot 1 is always the Disc; slot 2 is whichever builder
       SHIP_SLOT2 names. */
    var SHIP_BUILDERS = { disc: buildDisc, starman: buildStarman };
    function buildShipRig() {
        if (shipRig || !renderer || !scene || !camera) return;
        shipMaterials();
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        /* The ship renders as a view-model: its own scene and camera, drawn
           over the main pass with depth cleared. The universe spans 1e-6 pc
           (a planet's surface) to 1e9 pc (the catalog edge) — no single
           depth range holds both a 60 m ship and that world, and a ship
           parked parsecs from the camera would sit behind every planet. */
        var sScene = new THREE.Scene();
        var sCam = new THREE.PerspectiveCamera(55, 1.6, 0.05, 60);
        var root = new THREE.Group();
        root.position.set(0, -0.55, -3.05); root.rotation.x = -0.40; root.scale.setScalar(1.3);
        sScene.add(root);
        var key = new THREE.DirectionalLight(0xfff2e0, 1.55);
        key.position.set(2.6, 3.4, 1.6); key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.left = -0.7; key.shadow.camera.right = 0.7;
        key.shadow.camera.top = 0.7; key.shadow.camera.bottom = -0.7;
        key.shadow.camera.near = 0.5; key.shadow.camera.far = 9; key.shadow.bias = -0.0004;
        sScene.add(key); key.target.position.set(0, -0.55, -3.05); sScene.add(key.target);
        var rim = new THREE.DirectionalLight(0xbcd4ff, 0.9); rim.position.set(-3.2, 1.4, -2.6); sScene.add(rim);
        var fill = new THREE.HemisphereLight(0x8899bb, 0x1a1410, 0.32); sScene.add(fill);
        var camFill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
        camFill.position.set(0.5, 0.4, 5); sScene.add(camFill);
        camFill.target.position.set(0, -0.55, -3.05); sScene.add(camFill.target);
        /* Starman's hard sun — space light is one brutal source, not a
           studio. Off for the Disc; while Starman is current the soft
           fills drop away so his shadow side goes deep. */
        var sun = new THREE.DirectionalLight(0xffffff, 0);
        sun.position.set(-3.1, 2.9, -2.0); sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -0.85; sun.shadow.camera.right = 0.85;
        sun.shadow.camera.top = 0.85; sun.shadow.camera.bottom = -0.85;
        sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 10; sun.shadow.bias = -0.0003;
        sScene.add(sun); sun.target.position.set(0, -0.55, -3.05); sScene.add(sun.target);
        var crafts = {};
        SHIP_PAIR.forEach(function (k) { crafts[k] = SHIP_BUILDERS[k](); });
        Object.keys(crafts).forEach(function (k) { crafts[k].group.visible = false; root.add(crafts[k].group); });
        crafts[shipChoice].group.visible = true;
        shipRig = { root: root, scene: sScene, cam: sCam, crafts: crafts, current: shipChoice, py: yaw, pp: pitch, yawRate: 0, pitchRate: 0, roll: 0, pitchTilt: 0,
            sun: sun, key: key, hemi: fill, camFill: camFill };
        window.__uvShip = {
            set: function (name) { shipApplyCraft(name); return !!shipRig; },
            current: function () { return shipRig ? shipRig.current : shipChoice; },
            names: SHIP_PAIR.slice()
        };
    }
    /* The ONLY thing a craft swap touches: which group is visible, the
       rig's current-craft pointer, and the toggle's pressed states. The
       world — position, velocity, speed, camera — is never written here. */
    function shipApplyCraft(name) {
        if (SHIP_PAIR.indexOf(name) < 0) return;
        shipChoice = name;
        if (shipRig) {
            Object.keys(shipRig.crafts).forEach(function (k) { shipRig.crafts[k].group.visible = (k === name); });
            shipRig.current = name;
        }
        if (shipToggleEl) {
            Array.prototype.forEach.call(shipToggleEl.querySelectorAll('button'), function (b) {
                b.setAttribute('aria-pressed', b.getAttribute('data-craft') === name ? 'true' : 'false');
            });
        }
    }
    /* Segmented two-slot craft control in the game's own control row, built
       here so the whole feature ships inside universe.js. Chrome mirrors
       .uv-btn and the demo button's pressed state, in the page's theme
       variables, so it reads identically in light and dark. */
    function buildCraftToggle() {
        if (shipToggleEl || !stage) return;
        var controls = stage.querySelector('.uv-controls');
        if (!controls) return;
        if (!document.getElementById('uv-craft-style')) {
            var st = document.createElement('style');
            st.id = 'uv-craft-style';
            st.textContent = '.uv-craft-seg{display:inline-flex;border:1px solid var(--border-color);border-radius:999px;overflow:hidden;background:var(--card-bg)}'
                + '.uv-craft-btn{min-height:44px;padding:8px 16px;border:0;background:transparent;color:var(--text-color);font:inherit;font-size:0.92rem;cursor:pointer}'
                + '.uv-craft-btn + .uv-craft-btn{border-left:1px solid var(--border-color)}'
                + '.uv-craft-btn[aria-pressed="true"]{background:var(--accent-color);color:#fff}'
                + '.uv-craft-btn:focus-visible{outline:2px solid var(--link-color);outline-offset:-2px}'
                /* the Lock button: one fixed size for both its states,
                   so toggling it moves nothing (the toggle-anchor
                   rule); 'Locked' is the longest label it ever shows */
                + '.uv-lock-btn{min-width:124px;min-height:44px}'
                + '.uv-lock-btn[aria-pressed="true"]{background:var(--accent-color);color:#fff}';
            document.head.appendChild(st);
        }
        var seg = document.createElement('div');
        seg.className = 'uv-craft-seg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Ship');
        SHIP_PAIR.forEach(function (name) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'uv-craft-btn';
            b.setAttribute('data-craft', name);
            b.setAttribute('aria-pressed', name === shipChoice ? 'true' : 'false');
            b.textContent = SHIP_LABELS[name] || name;
            b.addEventListener('click', function () { shipApplyCraft(name); });
            seg.appendChild(b);
        });
        var moreBtn = controls.querySelector('.uv-more-btn');
        if (moreBtn) controls.insertBefore(seg, moreBtn); else controls.appendChild(seg);
        shipToggleEl = seg;
    }
    function updateShipRig(dt, tSec) {
        if (!shipRig || !shipRig.root.visible) return;
        var sdt = Math.min(dt, 0.05);
        var r = Math.pow(speedT, 1.35);
        var dyaw = yaw - shipRig.py, dpitch = pitch - shipRig.pp;
        if (dyaw > Math.PI) dyaw -= Math.PI * 2; if (dyaw < -Math.PI) dyaw += Math.PI * 2;
        shipRig.py = yaw; shipRig.pp = pitch;
        if (sdt > 0.001) {
            var blend = 1 - Math.exp(-sdt / 0.14);
            shipRig.yawRate += (Math.max(-3, Math.min(3, dyaw / sdt)) - shipRig.yawRate) * blend;
            shipRig.pitchRate += (Math.max(-3, Math.min(3, dpitch / sdt)) - shipRig.pitchRate) * blend;
        }
        var targetRoll = Math.max(-0.55, Math.min(0.55, -shipRig.yawRate * 0.38));
        var targetPitch = Math.max(-0.3, Math.min(0.3, shipRig.pitchRate * 0.30));
        var b2 = 1 - Math.exp(-sdt / 0.18);
        shipRig.roll += (targetRoll - shipRig.roll) * b2;
        shipRig.pitchTilt += (targetPitch - shipRig.pitchTilt) * b2;
        var root = shipRig.root;
        root.rotation.z = shipRig.roll + Math.sin(tSec * 0.7) * 0.016;
        root.rotation.x = -0.40 + shipRig.pitchTilt + Math.sin(tSec * 0.53) * 0.008;
        root.rotation.y = Math.max(-0.2, Math.min(0.2, -shipRig.yawRate * 0.10));
        root.position.y = -0.55 + Math.sin(tSec * 0.9) * 0.011;
        root.position.x = Math.sin(tSec * 0.47) * 0.007;
        /* Lighting switch: hard sun + starved fills for Starman only */
        var sm = shipRig.current === 'starman';
        if (shipRig.sun) {
            shipRig.sun.intensity = sm ? 3.4 : 0;
            shipRig.key.intensity = sm ? 0.5 : 1.55;
            shipRig.hemi.intensity = sm ? 0.10 : 0.32;
            shipRig.camFill.intensity = sm ? 0.12 : 0.5;
        }
        var c = shipRig.crafts[shipRig.current];
        if (c) c.update(r, sdt, tSec, { roll: shipRig.roll, pitch: shipRig.pitchTilt });
    }
    /* ================= end SHIP ================= */

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
        buildShipRig();
        buildCraftToggle(); buildLockButton();

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
            uniforms: { uScaleH: { value: 1 }, uDpr: { value: 1 }, uTime: { value: 0 },
                        uVelView: { value: new THREE.Vector3() }, uPeakComp: { value: 1 } },
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
            /* hero tiles: all zero (procedural) until the hero
               manifest lands and buildHeroes fills the named set */
            var heroA = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
            var heroR = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
            g.setAttribute('aHero', heroA);
            g.setAttribute('aHeroRot', heroR);
            if (from === 0) heroAttrs = { hero: heroA, rot: heroR, count: n };
            g.instanceCount = n;
            var m = new THREE.ShaderMaterial({
                vertexShader: GAL_VERT, fragmentShader: GAL_FRAG,
                uniforms: { uScaleH: { value: 1 }, uDpr: { value: 1 }, uHalo: { value: halo },
                            uPeakComp: { value: 1 }, uHeroW: { value: 0 }, tHeroes: { value: null } },
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
        glowBroad = buildGlowLayer(380, 1.8, 0.026);   /* alpha lowered 2026-11-25: deep-field murk (see GLOW_VERT) */
        glowFine = buildGlowLayer(110, 3.0, 0.040);
        scene.add(glowBroad); scene.add(glowFine);

        /* the all-sky backdrop — summed catalog light in direction
           space, on a sphere that follows the camera, so the lit
           sky is a floor under every position and speed */
        backdrop = buildBackdrop();
        scene.add(backdrop);

        /* the near-home photographic sky (ESO's panorama of the
           real sky, galactic frame) under the catalog floor */
        panoSky = buildPanoSky();
        scene.add(panoSky);

        /* the hero galaxies' photographs, matched to their
           catalog entries (attributes filled, atlas streamed) */
        buildHeroes();

        /* the bright nebulae — soft coloured glows at their real
           catalog positions (universe-nebulae.json) */
        buildNebulae();

        /* the solar system — textured worlds at true positions */
        buildSolarSystem();

        /* EARTH FIRST (Johnny, 2026-11-26): her full texture stack
           starts NOW, at scene build — not on the old first-approach
           trigger in frame(), which left the opening Earth sitting
           on the plain map while five maps queued. The files were
           preloaded at init, so this mostly settles from cache; the
           frame() trigger stays as a guarded backstop. */
        startEarthStack();

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
            o.value = b.n + (bodyHasHD(b.n) ? ' HD' : '');   /* the HD mark rides the Jump-to list; doSearch strips it back off */
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
        /* The start is Earth (Johnny, 2026-11-20): every game opens
           at home — just off Earth on the Sun's side, a little
           north, facing her — so the lit face fills the opening
           view and the HUD reads Earth. The standoff is 3.2 drawn
           radii, inside the 4.5 a jump to Earth arrives at: Venus
           sits only 0.35 AU from Earth in this era, and from 4.5
           radii out on the Sun's side she would be the nearer
           body and the readout would name her instead. The tour
           leaves from here, and its last key comes home to the
           same spot. */
        var earthBody = null;
        for (var eb = 0; eb < SOLAR_BODIES.length; eb++)
            if (SOLAR_BODIES[eb].n === 'Earth') earthBody = SOLAR_BODIES[eb];
        var earthPos = new THREE.Vector3(earthBody.p[0], earthBody.p[1], earthBody.p[2]);
        var start = earthPos.clone()
            .add(earthPos.clone().multiplyScalar(-1).normalize().multiplyScalar(earthBody.r * 3.2))
            .add(GAL_NORTH.clone().multiplyScalar(earthBody.r * 3.2 * 0.30));
        tour.keys = [
            { pos: start, tgt: earthPos, dur: 0, cap: '' },
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
        /* initial yaw/pitch: resetView(true) at the end of setup
           aims the camera from keys[0].pos to keys[0].tgt (Earth) */
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
            if (tour.dwell <= 0) { captionClaim = null; setCaption(nxt.cap); }
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
        lockSet(false);   /* the tour releases the lock rather than fighting it */
        tour.on = true; ctrl.mode = 'tour';
        spin.yaw = 0; spin.pitch = 0;
        if (!resume) { tour.index = 0; tour.t = 0; tour.dwell = 0; camPos.copy(tour.keys[0].pos); }
        tourBtn.textContent = '\u25A0 Stop the tour';
        captionClaim = null;
        setCaption(tour.keys[Math.min(tour.index + 1, tour.keys.length - 1)].cap ||
            'The tour is flying. Grab the view any time to take over.');
    }
    function stopTour(finished) {
        tour.on = false; ctrl.mode = 'free';
        tourBtn.textContent = '\u25B6 Resume the tour';
        if (finished) {
            tour.index = 0; tour.t = 0;
            tourBtn.textContent = '\u25B6 Fly the tour';
            captionClaim = null;
            setCaption('That is the tour. Fly anywhere you like \u2014 drag to look, hold Fly (or W) to move.');
        }
    }
    function interruptTour() {
        lastInputT = performance.now();
        spin.yaw = 0; spin.pitch = 0;
        /* a grab is the player's first real input: whatever card is
           up comes down (its words are swapped silently below, so
           the grab never raises a fresh card in its place) */
        dismissCaption();
        if (tour.on) {
            stopTour(false);
            captionClaim = null;
            setCaption(CONTROLS_CAP, false);
        } else if (flyAnim) {
            /* grabbing the view mid-jump cancels the flight — its
               "Flying to ..." card must not outlive the flight */
            captionClaim = null;
            setCaption(CONTROLS_CAP, false);
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
            var sp = proxSpeed();
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
            /* Universe-edge governor: the catalog ends, and beyond
               it there is nothing to see. At the old top of the
               slider (about 400,000 pc/s) a pilot crossed the whole
               mapped galaxy field in seconds and the sky went black
               (Johnny, 2026-11-25) — not a rendering failure, an
               empty universe: the stars were all behind him and the
               galaxies thinned to specks. The edge is measured from
               the catalog itself on first use. In the outer ease
               zone (beyond 45% of the edge) the OUTWARD radial
               speed is capped by an allowance that falls toward the
               edge, so flight at any slider setting stays among the
               galaxies and the view never empties; tangential flight
               keeps nearly all its speed and flying back inward is
               never capped at all. */
            if (!popEdge && data && data.galPos) {
                var pMax = 0;
                for (var pe2 = 0; pe2 < data.galPos.length; pe2 += 3) {
                    var px2 = data.galPos[pe2], py2 = data.galPos[pe2 + 1], pz2 = data.galPos[pe2 + 2];
                    var pd2 = px2 * px2 + py2 * py2 + pz2 * pz2;
                    if (pd2 > pMax) pMax = pd2;
                }
                popEdge = Math.sqrt(pMax);
                popK = 420000 / (0.55 * popEdge);   /* the allowance crosses the slider's top speed at the ease zone's inner edge */
            }
            if (popEdge > 0) {
                var rrE = camPos.length();
                if (rrE > popEdge * 0.45) {
                    edgeTmp.copy(move).normalize();
                    var outD = edgeTmp.dot(camPos) / rrE;   /* outward radial share of the heading, -1..1 */
                    if (outD > 0.05) {
                        var allow = Math.max(25, (popEdge - rrE) * popK);
                        sp = Math.min(sp, allow / outD);
                    }
                }
            }
            if (lockState.on) sp = lockCapSpeed(sp, move);   /* LOCK assist: cap only the escaping speed */
            move.normalize().multiplyScalar(sp * dt);
            camPos.add(move);
        }
        applyView();
    }
    /* ---------------- LOCK (Johnny, 2026-11-26) ----------------
       "What if we have a 'lock in to object' button? So you don't
       accidentally go through a planet like this and you can explore
       it better." — and his refinement, same morning: "I still want
       to be able to control speed, angle I'm flying, and look
       around. I just want it to help keep me in orbit or something
       while I'm exploring that object."
       So Lock is an ASSIST, never an autopilot. Every control keeps
       its free-flight mapping while locked — the speed slider sets
       his speed, steering sets his angle, look-around stays free;
       nothing is remapped, nothing flies for him. Lock adds exactly
       two things:
       (1) THE FLOOR. The camera can never cross into the locked
       body: lockClamp() runs after every mover, every frame, and
       holds the camera at or outside the floor distance. For the
       surveyed bodies (Earth, Moon, Mars) the floor sits at
       1.003 radii — inside the range where their deepest tiles
       read well, so lock + descend IS the explore mode; for the
       other globes 1.01 radii; for a catalog point (a star, a
       galaxy — no surface to stand over) a nominal stand-off.
       (2) THE ANCHOR. The engine's bodies are static and flight is
       thrust-driven (no inertia to cancel), so the anchor is a
       leash on the player's own motion, built the same way as the
       catalog-edge governor: beyond 80% of the vicinity radius
       (14 body radii), the OUTWARD radial share of each flight
       step eases toward zero at the vicinity edge. Tangential
       flight — orbiting — is never eased; flying back inward is
       never eased; the speed slider's pace is untouched in every
       direction the assist does not govern. A hard clamp at 1.5x
       the vicinity stands behind the ease as a guarantee.
       The target is the object the HUD already names as Nearest —
       the same search (updateNearest) maintains it, so the button
       locks exactly what the HUD is talking about. Unlocking is a
       pure mode change: position, heading and speed setting carry
       over exactly (the toggle itself moves nothing, Δ=0). A jump,
       a tour, or closing the game releases the lock rather than
       fighting it. */
    var lockState = { on: false, name: '', hd: false, pos: new THREE.Vector3(), floor: 0, vicinity: 0 };
    var lockBtn = null;
    var lockTmp = new THREE.Vector3();
    function lockResolve() {
        if (nearestBi <= -2 && solarBodies) {
            var b = solarBodies[-nearestBi - 2];
            if (!b) return false;
            var tiled = bodyHasHD(b.n);
            lockState.pos.copy(b.pos);
            lockState.name = b.n;
            lockState.hd = bodyHasHD(b.n);
            lockState.floor = b.r * (tiled ? 1.003 : 1.01);
            lockState.vicinity = b.r * 14;
            return true;
        }
        if (nearestBi >= 0 && data && data.namedPos) {
            lockState.pos.set(data.namedPos[nearestBi * 3], data.namedPos[nearestBi * 3 + 1], data.namedPos[nearestBi * 3 + 2]);
            lockState.name = data.named[nearestBi].n;
            lockState.hd = false;
            lockState.floor = 8e-4;
            lockState.vicinity = 0.05;
            return true;
        }
        return false;
    }
    var lockBtnStr = '';
    function lockBtnSync() {
        /* the button's face, from one writer: Lock/Locked, plus the
           HD mark when the body it would lock (or is locked on)
           carries real high-definition coverage — the promise is
           visible at the exact moment of locking. Change-gated like
           the HUD lines; called from lockSet and from frame()'s
           gated HUD block, so the mark follows the nearest body as
           you fly. */
        if (!lockBtn) return;
        var hd = lockState.on ? lockState.hd : (nearestBi <= -2 && bodyHasHD(nearestName));
        var s = (lockState.on ? 'Locked' : 'Lock') + (hd ? ' HD' : '');
        if (s !== lockBtnStr) { lockBtnStr = s; lockBtn.textContent = s; }
    }
    function lockSet(on) {
        lockState.on = !!on;
        if (lockBtn) {
            lockBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
            lockBtn.setAttribute('aria-label', on ? ('Locked on ' + lockState.name) : 'Lock on to the nearest object');
            lockBtnSync();
        }
    }
    function lockToggle() {
        if (lockState.on) lockSet(false);
        else if (lockResolve()) lockSet(true);
    }
    function lockCapSpeed(sp, move) {
        /* the catalog-edge governor's own shape, at body scale: the
           OUTWARD radial share of the heading is capped by an
           allowance that falls to zero at the vicinity edge, so an
           escape eases to a stop instead of hitting a wall.
           Tangential headings (dot ~ 0) and inward headings are
           never capped — orbiting and approaching keep the full
           speed the slider asks for. */
        lockTmp.copy(camPos).sub(lockState.pos);
        var d = lockTmp.length();
        if (d < 1e-12 || d <= lockState.vicinity * 0.8) return sp;
        lockTmp.divideScalar(d);
        govTmp.copy(move).normalize();
        var out = govTmp.dot(lockTmp);
        if (out <= 0.05) return sp;
        var allow = Math.max(0, (lockState.vicinity - d) * 2.5);
        return Math.min(sp, allow / out);
    }
    function lockClamp() {
        lockTmp.copy(camPos).sub(lockState.pos);
        var d = lockTmp.length();
        if (d < 1e-12) return;
        if (d < lockState.floor) camPos.copy(lockState.pos).addScaledVector(lockTmp.divideScalar(d), lockState.floor);
        else if (d > lockState.vicinity * 1.5) camPos.copy(lockState.pos).addScaledVector(lockTmp.divideScalar(d), lockState.vicinity * 1.5);
    }
    function buildLockButton() {
        var controls = stage.querySelector('.uv-controls');
        if (!controls || controls.querySelector('.uv-lock-btn')) return;
        lockBtn = document.createElement('button');
        lockBtn.type = 'button';
        lockBtn.className = 'uv-btn uv-lock-btn';
        lockBtn.textContent = 'Lock';
        lockBtn.setAttribute('aria-pressed', 'false');
        lockBtn.setAttribute('aria-label', 'Lock on to the nearest object');
        lockBtn.addEventListener('click', function () { dismissCaption(); lockToggle(); });
        var more = controls.querySelector('.uv-more-btn');
        if (more) controls.insertBefore(lockBtn, more); else controls.appendChild(lockBtn);
        window.__uvHD = { table: TILE_COVERAGE, has: bodyHasHD };
        window.__uvLock = {
            toggle: lockToggle, set: lockSet,
            state: function () {
                return {
                    on: lockState.on, name: lockState.name,
                    floor: lockState.floor, vicinity: lockState.vicinity,
                    pos: [lockState.pos.x, lockState.pos.y, lockState.pos.z],
                    dist: camPos.distanceTo(lockState.pos)
                };
            }
        };
    }

    function flyTo(entry) {
        lockSet(false);   /* a jump releases the lock rather than fighting it */
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
        markedName = entry.n; captionClaim = null;
        setCaption('Flying to ' + entry.n + '\u2026 grab the view to take over.');
    }
    function flyToSolar(b) {
        lockSet(false);   /* a jump releases the lock rather than fighting it */
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
        markedName = b.n; captionClaim = null;
        setCaption('Flying to ' + b.n + '\u2026 grab the view to take over.');
    }
    function flyAnimFrame(dt) {
        flyAnim.t += dt / flyAnim.dur;
        if (flyAnim.t >= 1) {
            camPos.copy(flyAnim.to);
            setViewFromTarget(flyAnim.target);
            var arrDist = camPos.distanceTo(flyAnim.target);
            flyAnim = null; ctrl.mode = 'free';
            setCaption('You are looking at the marked object. Drag to look around; hold Fly \u2014 or press W \u2014 to move.');
            /* the marked-object card claims the jump's target (the
               solar list calls the Sun 'Sun', the named list 'The
               Sun' — the claim uses the readout's own name) */
            captionClaim = { kind: 'object', name: (markedName === 'The Sun') ? 'Sun' : markedName,
                             dist: arrDist };
            return;
        }
        var t = smoother(flyAnim.t);
        logLerpPos(flyAnim.from, flyAnim.to, t, camPos);
        setViewFromTarget(flyAnim.target);
    }
    function resetView(instant) {
        var start = tour.keys[0];
        if (instant) {
            /* open facing the start key's own target (Earth), the
               same aim the tour's first dwell uses */
            camPos.copy(start.pos); setViewFromTarget(start.tgt);
            return;
        }
        flyAnim = { from: camPos.clone(), to: start.pos.clone(), target: start.tgt.clone(), t: 0, dur: 2.6 };
        ctrl.mode = 'jump';
        markedName = 'Earth'; captionClaim = null;
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
        nearestBi = bi;   /* the Lock button resolves its target from the same search */
        nearestName = bi >= 0 ? data.named[bi].n : (bi <= -2 ? solarBodies[-bi - 2].n : '');
        var nStr = nearestName ? ('Nearest: ' + nearestName + ((bi <= -2 && bodyHasHD(nearestName)) ? ' HD' : '') + ' \u2014 ' + fmtDist(nearestDist)) : '';
        hudNearStr = nStr;   /* composed here, written only by frame()'s single gated HUD block */
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
            el.textContent = c.e.n + (c.b && bodyHasHD(c.b.n) ? ' HD' : '');
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
        var dtRaw = (now - lastT) / 1000;
        if (!(dtRaw > 0)) dtRaw = 0.016;
        lastT = now;
        /* SPEED INTEGRITY (2026-11-25, Johnny's phone: "sometimes
           it's faster on slow speed than on high speed"): the old
           line clamped dt at 0.1 s and silently DISCARDED the rest
           of every longer frame, so the game's clock ran slower
           than the wall clock exactly when frames ran long — and
           frames run longest at high speed (streaks, bloom, the
           resolution ladder), which compressed the top of the
           slider until high settings could feel slower than low
           ones. Now the frame's real elapsed time is honoured up
           to a 0.5 s clamp (a tab-switch guard, nothing more — a
           visible frame longer than half a second is a frozen
           game, not a frame rate) and motion advances in substeps
           of at most 1/30 s of game time, so the flight maths and
           the approach governor see the same step at every frame
           rate: achieved speed is the slider's speed, strictly
           increasing with the slider, at 120 Hz, 60 Hz, or a
           struggling 20 Hz alike. */
        var dt = Math.min(dtRaw, 0.5);
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
           band (33 ms down, 12 ms up, one step per 90-frame window)
           keeps it from oscillating.
           FIDELITY PASS (2026-11-25): resolution is the LAST thing
           surrendered. The ladder now tolerates ~30 fps (a 33 ms
           average) before it touches the pixel ratio at all, the
           steps are shallow, and the floor is 0.7 of native density
           — what gives instead is frame-rate headroom in the densest
           fields: the game would rather run slower than go soft. */
        frameAcc += dtRaw; frameN++;   /* the ladder measures real frame cost, not the clamped game step */
        if (frameN >= 90) {
            var avg = frameAcc / frameN;
            if (avg > 0.033 && dprLevel < DPR_STEPS.length - 1) { dprLevel++; applyDpr(); }
            else if (avg < 0.012 && dprLevel > 0) { dprLevel--; applyDpr(); }
            frameAcc = 0; frameN = 0;
        }
        var mSteps = Math.max(1, Math.ceil(dt / (1 / 30)));
        var mDt = dt / mSteps;
        for (var mStep = 0; mStep < mSteps; mStep++) {
            if (tour.on) tourFrame(mDt);
            else if (flyAnim) flyAnimFrame(mDt);
            else {
                if (mStep === 0) idleDrift(now, dt);
                spinFrame(mDt); flyFrame(mDt);
            }
        }
        if (lockState.on) lockClamp();   /* LOCK assist: the floor and the outer hold apply against every mover, every frame */

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
            /* the floor used to be 1e-9 pc: below about 1e-9 pc of
               surface distance (~31 km at Earth's drawn scale) the
               ground itself fell inside the near plane and clipped
               away. The streamed-tile descent flies to a few metres,
               so the floor now follows the surface down (4e-14 pc);
               at every range the old floor governed (>= 2.5e-9 pc)
               the value is unchanged. */
            camera.near = Math.min(camera.near, Math.max(4e-14, Math.max(sysSurf, 1e-13) * 0.4));
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
        /* the photographic sky rides the camera the same way, a
           touch inside the catalog floor, and fades with distance
           from home: full at home, gone by 25 kpc — a photograph
           of Earth's sky is only the actual sky near Earth */
        if (panoSky) {
            panoSky.position.copy(camPos);
            var ps2 = camera.far * 0.44;
            panoSky.scale.set(ps2, ps2, ps2);
            if (panoTex && panoSky.material.map) {
                var homeF = 1 - Math.min(1, Math.max(0, (alt - 1500) / 23500));
                homeF = homeF * homeF * (3 - 2 * homeF);
                panoSky.material.opacity = 0.88 * homeF;
            }
        }
        /* star streaks: the camera's velocity in view space. The
           rotation transpose is the inverse rotation — world travel
           into the camera's own axes. SPEED INTEGRITY (2026-11-25):
           this used to hand the shader the raw PER-FRAME travel,
           so the same flight drew streaks twice as long at 60 Hz
           as at 120 Hz, and the smoothing blend was per-frame too.
           It is now a true per-second velocity, smoothed with a
           frame-rate-independent time constant (0.09 s — the old
           0.55 blend at 60 Hz), and scaled by a fixed 1/60 s
           reference frame on its way to the shader: a star's
           streak now depends on how fast you are flying, never on
           the refresh rate of the screen you fly on. */
        if (starPoints) {
            if (prevCamPos && dtRaw > 0.0005 && dtRaw < 1.0) {
                tmpV.copy(camPos).sub(prevCamPos).divideScalar(dtRaw);   /* parsecs per second */
                tmpM.extractRotation(camera.matrixWorld).transpose();
                tmpV.applyMatrix4(tmpM);
                velViewSm.lerp(tmpV, 1 - Math.exp(-dtRaw / 0.09));
            }
            if (prevCamPos) prevCamPos.copy(camPos); else prevCamPos = camPos.clone();
            starPoints.material.uniforms.uVelView.value.copy(velViewSm).multiplyScalar(1 / 60);
        }
        /* the Sun's point sprite hands over to its textured sphere
           once you are close enough for the sphere to be the Sun */
        if (sunPoints) sunPoints.visible = alt > 3e-6;
        /* Earth's texture stack: the lazy trigger is a genuine
           approach — inside the planetary region (alt < 2e-4 pc,
           just outside Neptune's orbit) or closing on Earth
           herself. The game starts at Earth, so the maps load
           with the opening view and the crossfade runs as the
           player settles in; the trigger also covers every later
           return. Then the crossfade, the clouds' slow drift (a
           full turn in ~10 minutes; one float add a frame), and
           the shared sun position for Earth's two shaders */
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
            try { tileFrameAll(now); } catch (etErr) { /* the tile layers are an enhancement: their failure never breaks a globe */ }
        }
        try { lodFrame(dt, tSec); } catch (e) { /* LOD is an enhancement layer */ }
        updateShipRig(dt, tSec);
        camera.updateProjectionMatrix();
        if (fxOK && fxTarget) renderWithBloom();
        else renderer.render(scene, camera);
        if (shipRig && shipRig.root.visible) {   /* SHIP view-model pass */
            shipRig.cam.aspect = camera.aspect; shipRig.cam.updateProjectionMatrix();
            renderer.autoClear = false; renderer.clearDepth();
            renderer.render(shipRig.scene, shipRig.cam);
            renderer.autoClear = true;
        }
        /* HUD readouts swap ATOMICALLY (Johnny, 2026-11-25, over
           his phone recording: mid-flight the Speed value showed
           two values at once and the Distance/Speed lines garbled
           into each other — the same disease as the Frequency
           readouts). This block is the ONLY writer of all three
           HUD nodes in the game — the distance, the speed, and
           (since the 2026-11-25 repair, which found updateNearest
           writing the third node on its own cadence beside this
           gate) the nearest-object line, whose string is now
           composed there and written here. At most one write per
           node per 100 ms, and only when the formatted string
           actually changed — a node holds exactly one complete
           value at every frame, and no other code path in the
           game can put a second value beside it. */
        var hudNow = performance.now();
        if (hudNow - hudGate.t >= 100) {
            hudGate.t = hudNow;
            var dStr = 'From the Sun: ' + fmtDist(alt);
            if (dStr !== hudGate.d) { hudGate.d = dStr; hudDist.textContent = dStr; }
            var sStr = 'Speed: ' + fmtSpeed(proxSpeed());   /* the effective speed: the proximity regime included, so the readout is the pace you actually fly */
            if (sStr !== hudGate.s) { hudGate.s = sStr; hudSpeed.textContent = sStr; }
            if (hudNearStr !== hudGate.n) { hudGate.n = hudNearStr; hudNear.textContent = hudNearStr; }
            lockBtnSync();   /* the Lock button's face (incl. the HD mark) follows the nearest body on the same gated cadence */
        }
        labelTick++;
        if (labelTick % 15 === 0) { updateNearest(); syncCaption(); }
        var rect = canvas.getBoundingClientRect();
        updateLabels(rect.width, rect.height);
    }
    function applyDpr() {
        /* The floor is the last DPR_STEPS entry — 0.7 of the device's
           native density (fidelity pass, 2026-11-25). The ladder still
           works on a DPR-1 screen (0.7 of 1), it just never trades
           away more than 30% of the density; below that, slower
           frames are accepted instead of a softer picture. The DOM
           HUD stays crisp regardless. */
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
        lodResize(scaleH, dpr);
        /* peak compensation for the resolution ladder (see
           STAR_FRAG): as the effective pixel ratio falls below the
           cap, the HDR core drive rises to hold bloomed brightness
           constant — exponent from the ladder measurement in the
           quality-pass report */
        var peakComp = Math.min(2.0, Math.pow(dprCap / Math.max(dpr, 0.01), 0.75));
        [starPoints, galNamedPoints, galCloudPoints].forEach(function (p) {
            if (p && p.material.uniforms.uPeakComp) p.material.uniforms.uPeakComp.value = peakComp;
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

        captionCloseBtn.addEventListener('click', function () { dismissCaption(); captionCloseBtn.blur(); });
        tourBtn.addEventListener('click', function () {
            lastInputT = performance.now();
            if (tour.on) { stopTour(false); captionClaim = null; setCaption('Tour stopped. You have the controls.'); }
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
            var name = searchInput.value.trim().replace(/\sHD$/i, '');   /* the Jump-to list marks HD worlds with a trailing HD — a mark, not part of the name */
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
            captionClaim = null;
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
        speedInput.style.setProperty('--uv-fill', (speedT * 100).toFixed(1) + '%');
        lastInputT = performance.now();
    }

/* ================= LOD + PERSISTENCE SYSTEM (full build) =========
       Johnny's law for this game (2026-11-24): every object resolves to
       the highest definition available as you approach it, and arriving
       never makes it fade away — you can fly into it, through it, and
       look back at it. This section adds that system to the engine as
       one enhancement layer (a failure here never stops the game):

       - PHOTO LAYER (named galaxies + nebulae with a real telescope
         photograph in universe-hd.json): a dedicated full-resolution
         photograph per object — not the 1000 px atlas tile — fitted by
         its long edge to the catalogued diameter in the same squeezed
         frame the game's own hero photographs live in, streamed in two
         stages (512 px on approach, full size when close) and swapped
         only when the sharper copy has landed, so detail grows
         continuously and nothing pops. For the twelve atlas heroes the
         atlas tile hands over to the dedicated photograph.
       - VOLUME LAYER (every galaxy and nebula, named or not, plus the
         Milky Way's centre): a real three-dimensional star/dust cloud
         built in the object's own frame — disc plane from the
         catalogued major axis and axis ratio, thickness and colours
         from its class (spiral / elliptical / irregular; emission /
         planetary / remnant / reflection for nebulae). Where a
         photograph exists, the cloud's points are seeded BY the
         photograph (positions rejection-sampled from its light, colours
         taken from its pixels), so the place you enter is the
         photograph you approached. The cloud is a place: it never
         fades on arrival, you can fly through it and turn around.
       - STAR SURFACES (every star in the catalog): the nearest star
         grows a real sphere as you close in — a procedural surface
         (granulation, limb darkening) coloured by the star's own
         colour index, with a corona shell — infinite resolution, no
         assets, and it stays there when you arrive.
       - Planets and the Moon already persist as textured spheres;
         this layer leaves them to the solar-system build.

       Assets stream only on approach: the manifest is one small JSON;
       a photograph's bytes move only when its object is the one being
       approached, the volume for an unnamed galaxy is built (seeded
       from its catalog row) only when it is the nearest one, and the
       far view pays nothing. */

    var LOD_PHOTO_VERT = [
        'attribute vec3 aCenter;',
        'uniform float uDiam;',
        'varying vec2 vQ;',
        'void main() {',
        '    vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);',
        '    mv.xy += position.xy * (uDiam * 1.5);',
        '    vQ = position.xy * 1.5;',
        '    gl_Position = projectionMatrix * mv;',
        '}'
    ].join('\n');
    var LOD_PHOTO_FRAG = [
        'precision mediump float;',
        'uniform sampler2D tPhoto;',
        'uniform float uAng;',      /* projected major-axis angle, as GAL_FRAG computes it */
        'uniform float uAxis;',
        'uniform float uRot;',       /* photograph's own alignment onto the major axis */
        'uniform vec2 uFill;',       /* the fraction of the photo frame the object spans (x, y) */
        'uniform float uOpacity;',
        'varying vec2 vQ;',
        'void main() {',
        '    vec2 q = vQ;',
        '    float ca = cos(uAng), sa = sin(uAng);',
        '    vec2 p = mat2(ca, -sa, sa, ca) * q;',
        '    vec2 r = p;',
        '    r.y /= max(0.10, uAxis);',
        '    float d = length(r) * 2.0;',
        '    if (d > 1.52) discard;',
        '    float chr = cos(uRot), shr = sin(uRot);',
        '    vec2 hp = mat2(chr, -shr, shr, chr) * p;',
        '    vec2 uv = vec2(0.5 + hp.x * uFill.x, 0.5 - hp.y * uFill.y);',
        '    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;',
        '    vec3 ph = texture2D(tPhoto, uv).rgb;',
        '    float phLum = dot(ph, vec3(0.299, 0.587, 0.114));',
        /* normal blending + a presence floor over the disc: the photo
           must be able to DARKEN the sprite behind it, or a dust lane
           can never appear (additive light cannot subtract). Bright
           structure is fully present; the black surround stays mostly
           see-through so the starfield behind is not blanked. */
        '    float a = mix(0.30, 1.0, clamp(phLum * 1.7, 0.0, 1.0)) * uOpacity * (1.0 - smoothstep(1.02, 1.5, d));',
        '    if (a < 0.004) discard;',
        '#if HDR_LINEAR',
        '    ph = pow(max(ph, vec3(0.0)), vec3(2.2));',
        '#endif',
        '    gl_FragColor = vec4(ph, a);',
        '}'
    ].join('\n');
    var LOD_VOL_VERT = [
        'attribute float aSize;',    /* world diameter of the mote, pc */
        'attribute vec3 aCol;',
        'uniform float uScaleH;',
        'uniform float uDpr;',
        'uniform float uOpacity;',
        'varying vec3 vCol;',
        'varying float vA;',
        'void main() {',
        '    vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '    float dist = max(1e-9, -mv.z);',
        '    float px = clamp(aSize * uScaleH / dist, 1.2, 18.0);',
        '    gl_PointSize = px * uDpr;',
        '    vCol = aCol;',
        /* a mote's light is conserved as it grows: alpha falls as the
           point spreads, so flying in does not white the place out */
        '    vA = uOpacity * clamp(90.0 / (px * px), 0.05, 1.0);',
        '    gl_Position = projectionMatrix * mv;',
        '}'
    ].join('\n');
    var LOD_VOL_FRAG = [
        'precision mediump float;',
        'uniform sampler2D tSprite;',
        'uniform float uDark;',      /* 1 for the dust cloud: dark motes, normal blending */
        'varying vec3 vCol;',
        'varying float vA;',
        'void main() {',
        '    float s = texture2D(tSprite, gl_PointCoord).r;',
        '    float a = s * vA;',
        '    if (a < 0.004) discard;',
        '    vec3 col = vCol;',
        '#if HDR_LINEAR',
        '    if (uDark < 0.5) col = pow(max(col, vec3(0.0)), vec3(2.2));',
        '#endif',
        '    gl_FragColor = vec4(col, a);',
        '}'
    ].join('\n');
    var LOD_STAR_VERT = [
        'varying vec3 vN;',
        'varying vec3 vWP;',
        'void main() {',
        '    vN = normalize(mat3(modelMatrix) * normal);',
        '    vec4 wp = modelMatrix * vec4(position, 1.0);',
        '    vWP = wp.xyz;',
        '    gl_Position = projectionMatrix * viewMatrix * wp;',
        '}'
    ].join('\n');
    var LOD_STAR_FRAG = [
        'precision mediump float;',
        'uniform vec3 uColHot;',     /* photosphere colour from the star colour index */
        'uniform vec3 uColLimb;',
        'uniform float uTime;',
        'uniform float uOpacity;',
        'uniform vec3 uCenterW;',
        'varying vec3 vN;',
        'varying vec3 vWP;',
        'float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }',
        'float noise(vec3 p) {',
        '    vec3 i = floor(p), f = fract(p);',
        '    f = f * f * (3.0 - 2.0 * f);',
        '    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),',
        '                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),',
        '               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),',
        '                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);',
        '}',
        'float fbm(vec3 p) {',
        '    float v = 0.0, a = 0.5;',
        '    for (int k = 0; k < 4; k++) { v += a * noise(p); p *= 2.17; a *= 0.5; }',
        '    return v;',
        '}',
        'void main() {',
        '    vec3 V = normalize(cameraPosition - vWP);',
        '    vec3 N = normalize(vN);',
        '    float mu = clamp(dot(N, V), 0.0, 1.0);',
        /* granulation: two scales of boiling cells, slowly evolving */
        '    vec3 sp = normalize(vWP - uCenterW);',
        '    float g1 = fbm(sp * 9.0 + vec3(0.0, uTime * 0.021, uTime * 0.013));',
        '    float g2 = fbm(sp * 26.0 - vec3(uTime * 0.017, 0.0, uTime * 0.011));',
        '    float gran = 0.72 + 0.55 * g1 + 0.28 * g2;',
        /* limb darkening: the edge of a star is genuinely dimmer */
        '    float limb = 0.38 + 0.62 * pow(mu, 0.55);',
        '    vec3 col = mix(uColLimb, uColHot, gran * limb);',
        '    col *= (0.55 + 0.75 * limb);',
        '#if HDR_LINEAR',
        '    col = pow(max(col, vec3(0.0)), vec3(2.2)) * 1.9;',  /* driven over the bloom threshold, like a star core */
        '#endif',
        '    gl_FragColor = vec4(col, uOpacity);',
        '}'
    ].join('\n');
    var LOD_CORONA_FRAG = [
        'precision mediump float;',
        'uniform vec3 uColHot;',
        'uniform float uOpacity;',
        'varying vec3 vN;',
        'varying vec3 vWP;',
        'void main() {',
        '    vec3 V = normalize(cameraPosition - vWP);',
        '    float f = pow(1.0 - abs(dot(normalize(vN), V)), 2.6);',
        '    vec3 col = uColHot;',
        '#if HDR_LINEAR',
        '    col = pow(max(col, vec3(0.0)), vec3(2.2));',
        '#endif',
        '    gl_FragColor = vec4(col, 1.0) * f * uOpacity * 0.55;',
        '}'
    ].join('\n');

    var lod = null;
    function lodSlug(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    function lodSeeded(seed) {   /* mulberry32 — same seed, same place, every visit */
        var a = (seed * 2654435761) >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function lodInit() {
        lod = {
            manifest: null, tick: 0,
            photo: null, photoFor: '', photoTex: null, photoFull: false, photoSpare: null,
            photoLoading: '', photoOpacity: 0, atlasHeld: -1,
            vol: null, volFor: '', volKind: '', volOpacity: 0, volCenter: new THREE.Vector3(),
            star: null, starFor: -1, starOpacity: 0,
            target: null, frameMs: [], lastFrameT: 0,
            stats: { photoLoads: [], volBuilds: [], starBuilds: 0 }
        };
        /* soft round sprite for the volume motes */
        var cv = document.createElement('canvas'); cv.width = cv.height = 64;
        var cx = cv.getContext('2d');
        var grad = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        cx.fillStyle = grad; cx.fillRect(0, 0, 64, 64);
        lod.spriteTex = new THREE.CanvasTexture(cv);
        /* photo plane — one quad, re-aimed at whatever is approached */
        var pg = new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
        /* aCenter must carry one copy PER VERTEX: a 1-vertex attribute on
           a 4-vertex geometry reads out of bounds for verts 1-3, which
           collapsed the quad to a speck in the first rendered drives */
        pg.setAttribute('aCenter', new THREE.BufferAttribute(new Float32Array(12), 3));
        pg.setIndex([0, 1, 2, 0, 2, 3]);
        lod.photoMat = new THREE.ShaderMaterial({
            vertexShader: LOD_PHOTO_VERT, fragmentShader: LOD_PHOTO_FRAG,
            uniforms: {
                tPhoto: { value: null }, uDiam: { value: 1 }, uAng: { value: 0 },
                uAxis: { value: 1 }, uRot: { value: 0 }, uFill: { value: new THREE.Vector2(1, 1) },
                uOpacity: { value: 0 }
            },
            defines: { HDR_LINEAR: fxOK ? 1 : 0 },
            transparent: true, depthWrite: false, blending: THREE.NormalBlending
        });
        lod.photoMesh = new THREE.Mesh(pg, lod.photoMat);
        lod.photoMesh.frustumCulled = false;
        lod.photoMesh.renderOrder = 4;
        lod.photoMesh.visible = false;
        scene.add(lod.photoMesh);
        /* volume clouds — one star cloud + one dust cloud, rebuilt per target */
        function makeCloud(dark) {
            var g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LOD_VOL_MAX * 3), 3));
            g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(LOD_VOL_MAX * 3), 3));
            g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(LOD_VOL_MAX), 1));
            var m = new THREE.ShaderMaterial({
                vertexShader: LOD_VOL_VERT, fragmentShader: LOD_VOL_FRAG,
                uniforms: {
                    uScaleH: { value: 1 }, uDpr: { value: 1 }, uOpacity: { value: 0 },
                    tSprite: { value: lod.spriteTex }, uDark: { value: dark ? 1 : 0 }
                },
                defines: { HDR_LINEAR: fxOK ? 1 : 0 },
                transparent: true, depthWrite: false,
                blending: dark ? THREE.NormalBlending : THREE.AdditiveBlending
            });
            var p = new THREE.Points(g, m);
            p.frustumCulled = false;
            p.renderOrder = dark ? 6 : 5;
            p.visible = false;
            scene.add(p);
            return p;
        }
        lod.volStars = makeCloud(false);
        lod.volDust = makeCloud(true);
        /* star surface + corona */
        lod.starMat = new THREE.ShaderMaterial({
            vertexShader: LOD_STAR_VERT, fragmentShader: LOD_STAR_FRAG,
            uniforms: {
                uColHot: { value: new THREE.Color(1, 0.95, 0.84) },
                uColLimb: { value: new THREE.Color(1, 0.64, 0.30) },
                uTime: { value: 0 }, uOpacity: { value: 0 },
                uCenterW: { value: new THREE.Vector3() }
            },
            defines: { HDR_LINEAR: fxOK ? 1 : 0 },
            transparent: true, depthWrite: false
        });
        lod.starMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), lod.starMat);
        lod.starMesh.frustumCulled = false;
        lod.starMesh.renderOrder = 3;
        lod.starMesh.visible = false;
        scene.add(lod.starMesh);
        lod.coronaMat = new THREE.ShaderMaterial({
            vertexShader: LOD_STAR_VERT, fragmentShader: LOD_CORONA_FRAG,
            uniforms: {
                uColHot: { value: new THREE.Color(1, 0.95, 0.84) },
                uOpacity: { value: 0 }, uCenterW: { value: new THREE.Vector3() },
                uTime: { value: 0 }
            },
            defines: { HDR_LINEAR: fxOK ? 1 : 0 },
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            side: THREE.BackSide
        });
        lod.coronaMesh = new THREE.Mesh(new THREE.SphereGeometry(1.6, 48, 32), lod.coronaMat);
        lod.coronaMesh.frustumCulled = false;
        lod.coronaMesh.renderOrder = 2;
        lod.coronaMesh.visible = false;
        scene.add(lod.coronaMesh);
        /* the manifest: one small JSON — names to photographs + credits */
        fetch(new URL('./universe-hd.json', import.meta.url))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) { if (j && j.objects) lod.manifest = j.objects; })
            .catch(function () { /* no manifest: volumes + star surfaces still apply */ });
        window.__uvLod = {
            state: function () {
                return {
                    camPos: [camPos.x, camPos.y, camPos.z],
                    target: lod.target ? lod.target.key : null,
                    photoFor: lod.photoFor, photoFull: lod.photoFull,
                    photoOpacity: +lod.photoOpacity.toFixed(3),
                    volFor: lod.volFor, volKind: lod.volKind,
                    volOpacity: +lod.volOpacity.toFixed(3),
                    starFor: lod.starFor, starOpacity: +lod.starOpacity.toFixed(3),
                    frameMsAvg: lod.frameMs.length ?
                        +(lod.frameMs.reduce(function (a, b) { return a + b; }, 0) / lod.frameMs.length).toFixed(2) : 0,
                    stats: lod.stats,
                    effSpeed: proxSpeed(),
                    earthTiles: etState(et),
                    moonTiles: etState(tileMoon),
                    marsTiles: etState(tileMars),
                    mercuryTiles: etState(tileMercury),
                    edgePc: popEdge
                };
            },
            earthPoint: function (latDeg, lonDeg, altR) {
                /* the world position altR radii above a lat/lon — the
                   placement proof flies the camera here */
                if (!earthSys || !earthSys.grp) return null;
                var la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180;
                var cl = Math.cos(la);
                etV.set(cl * Math.cos(lo), Math.sin(la), -cl * Math.sin(lo));
                earthSys.grp.getWorldQuaternion(etQ);
                etV.applyQuaternion(etQ).multiplyScalar(earthSys.r * (1 + altR)).add(earthSys.pos);
                return [etV.x, etV.y, etV.z];
            },
            posOf: function (name) {
                var e = namedEntry(name);
                return e ? [e._pos[0], e._pos[1], e._pos[2]] : null;
            },
            nebOf: function (name) {
                for (var i = 0; i < nebulae.length; i++)
                    if (nebulae[i].n === name) return { p: nebulae[i].p, d: nebulae[i].d, i: i };
                return null;
            },
            flyToName: function (name) {
                var e = namedEntry(name);
                if (e) { interruptTour(); flyTo(e); return true; }
                return false;
            },
            teleport: function (p, t) {
                interruptTour(); flyAnim = null; ctrl.mode = 'free';
                camPos.set(p[0], p[1], p[2]);
                setViewFromTarget(tmpV.set(t[0], t[1], t[2]));
                applyView();
            },
            setSpeedT: function (v) { setSpeedT(v); },
            setThrust: function (on) { thrust = !!on; if (on) interruptTour(); }
        };
    }
    var LOD_VOL_MAX = 14000;
    function lodResize(scaleH, dpr) {
        if (!lod) return;
        [lod.volStars, lod.volDust].forEach(function (p) {
            if (p) { p.material.uniforms.uScaleH.value = scaleH; p.material.uniforms.uDpr.value = dpr; }
        });
    }
    /* the disc frame of a galaxy: m = catalogued major axis; the normal
       n is solved so the disc, seen from home, projects with exactly the
       catalogued axis ratio — the same tilt the sprite fakes, made real */
    function lodDiscFrame(pos, major, axisQ) {
        var m = major.clone().normalize();
        var v = pos.clone().multiplyScalar(-1).normalize();   /* toward the Sun */
        var vm = v.dot(m);
        var u = v.clone().addScaledVector(m, -vm);
        var s = u.length();
        var n;
        if (s < 1e-4) {
            n = new THREE.Vector3(0, 0, 1).cross(m).normalize();
            if (n.lengthSq() < 0.5) n = new THREE.Vector3(0, 1, 0).cross(m).normalize();
        } else {
            u.multiplyScalar(1 / s);
            var a = Math.max(-1, Math.min(1, axisQ / s));
            var b = Math.sqrt(Math.max(0, 1 - a * a));
            var mxu = new THREE.Vector3().crossVectors(m, u);
            var n1 = u.clone().multiplyScalar(a).addScaledVector(mxu, b);
            var n2 = u.clone().multiplyScalar(a).addScaledVector(mxu, -b);
            n = n1.dot(GAL_NORTH) >= 0 ? n1 : n2;   /* the mirror ambiguity: keep the galactic-north side */
            n.normalize();
        }
        var e2 = new THREE.Vector3().crossVectors(n, m).normalize();
        return { m: m, e2: e2, n: n };
    }
    function lodPhotoGrid(tex) {
        /* sample a loaded photograph into a luminance+colour grid
           the volume is seeded from — the place matches the picture.
           The grid scales with the photograph actually streamed
           (fidelity pass, 2026-11-25): a sixteenth of its long edge,
           floored at the old 128 and capped at 384, so a
           native-resolution arrival photo seeds a proportionally
           finer volume instead of the same 128 grid for everything */
        var S = Math.max(128, Math.min(384,
            Math.round(Math.max(tex.image.width, tex.image.height) / 16)));
        var cv = document.createElement('canvas'); cv.width = cv.height = S;
        var cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(tex.image, 0, 0, S, S);
        var px;
        try { px = cx.getImageData(0, 0, S, S).data; } catch (e) { return null; }
        var lum = new Float32Array(S * S), col = new Float32Array(S * S * 3), sum = 0;
        for (var i = 0; i < S * S; i++) {
            var r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
            var l = 0.299 * r + 0.587 * g + 0.114 * b;
            lum[i] = l; col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
            sum += Math.pow(l, 1.6);
        }
        return { S: S, lum: lum, col: col, sum: sum };
    }
    function lodBuildVolume(spec) {
        /* spec: {key, kind, center, diam, frame|null, tint, fam, seed, photoTex} */
        var t0 = performance.now();
        var rnd = lodSeeded(spec.seed);
        var N = spec.kind === 'nebula' ? 9000 : 12000;
        var grid = spec.photoTex ? lodPhotoGrid(spec.photoTex) : null;
        var posA = lod.volStars.geometry.getAttribute('position');
        var colA = lod.volStars.geometry.getAttribute('aCol');
        var sizA = lod.volStars.geometry.getAttribute('aSize');
        var dPos = lod.volDust.geometry.getAttribute('position');
        var dCol = lod.volDust.geometry.getAttribute('aCol');
        var dSiz = lod.volDust.geometry.getAttribute('aSize');
        var R = spec.diam / 2;
        var thick = spec.kind === 'nebula' ?
            (spec.fam === 1 || spec.fam === 2 ? 0.16 : 0.34) :
            (spec.tint === 0 ? 0.42 : spec.tint === 2 ? 0.30 : 0.055);
        var shell = spec.kind === 'nebula' && (spec.fam === 1 || spec.fam === 2);
        var placed = 0, guard = 0;
        var tmp = new THREE.Vector3();
        function gauss(r) {
            return (r() + r() + r() + r() - 2) * 0.5;   /* ~N(0, 0.5) */
        }
        while (placed < N && guard++ < N * 30) {
            var lx, ly, lz, cr, cg, cb, bright;
            if (grid) {
                /* rejection-sample the photograph's own light */
                var cell = Math.floor(rnd() * grid.S * grid.S);
                var wgt = Math.pow(grid.lum[cell], 1.6) / Math.max(1e-6, grid.sum / (grid.S * grid.S));
                if (rnd() > Math.min(1, wgt * 0.14)) continue;
                var gx = (cell % grid.S) / grid.S - 0.5, gy = Math.floor(cell / grid.S) / grid.S - 0.5;
                lx = gx / Math.max(0.05, spec.fillX) * spec.diam;
                ly = -gy / Math.max(0.05, spec.fillY) * spec.diam;
                cr = grid.col[cell * 3]; cg = grid.col[cell * 3 + 1]; cb = grid.col[cell * 3 + 2];
                bright = 0.35 + rnd() * 0.9;
                if (shell) {
                    var rr = Math.sqrt(lx * lx + ly * ly) + 1e-6;
                    var push = (R * 0.86) / rr;
                    lx *= push; ly *= push;
                }
                lz = gauss(rnd) * thick * spec.diam * (1 - Math.min(1, Math.sqrt(lx * lx + ly * ly) / R) * 0.6);
            } else if (spec.kind === 'nebula') {
                var th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
                var rad = shell ? R * (0.78 + 0.30 * rnd()) : R * Math.pow(rnd(), 0.55);
                lx = rad * Math.sin(ph) * Math.cos(th); ly = rad * Math.sin(ph) * Math.sin(th); lz = rad * Math.cos(ph) * 0.8;
                if (spec.fam === 0) { cr = 1.0; cg = 0.45 + rnd() * 0.2; cb = 0.55 + rnd() * 0.25; }
                else if (spec.fam === 1) { cr = 0.45; cg = 0.95; cb = 0.85; }
                else if (spec.fam === 2) { cr = 0.72; cg = 0.55; cb = 1.0; }
                else { cr = 0.55; cg = 0.70; cb = 1.0; }
                bright = 0.3 + rnd() * 0.8;
            } else if (spec.tint === 0) {
                /* elliptical: concentrated spheroid */
                var radE = R * Math.pow(rnd(), 1.6);
                var thE = rnd() * Math.PI * 2;
                lx = Math.cos(thE) * radE; ly = Math.sin(thE) * radE;
                lz = gauss(rnd) * thick * spec.diam * (1 - radE / R * 0.5);
                cr = 1.0; cg = 0.86 - radE / R * 0.1; cb = 0.66 - radE / R * 0.08;
                bright = 0.35 + rnd() * 0.75;
            } else if (spec.tint === 2) {
                /* irregular: a few bright clumps — the sprite shader's
                   own clump offsets, so cloud and sprite agree */
                var cl = Math.floor(rnd() * 4);
                var cox = ((spec.seed * (7.13 + cl * 3.71)) % 1 - 0.5) * 0.45 * spec.diam;
                var coy = ((spec.seed * (3.97 + cl * 5.29)) % 1 - 0.5) * 0.45 * spec.diam;
                lx = cox + gauss(rnd) * R * 0.30; ly = coy + gauss(rnd) * R * 0.30;
                lz = gauss(rnd) * thick * spec.diam;
                cr = 0.72; cg = 0.82; cb = 1.0;
                bright = 0.4 + rnd() * 0.9;
            } else {
                /* spiral: warm core + two-arm disc (the sprite's own maths, in 3D) */
                var u = rnd();
                var radS = -Math.log(1 - u * 0.96) / 3.0 * R * 1.9;
                if (radS > R) radS = R * (0.55 + rnd() * 0.45);
                /* the sprite shader's arm ridge, solved for the angle:
                   arms crest where ang = 2.6*log(d+0.06) - seed*2PI + k*PI,
                   so the cloud's arms land on the sprite's arms */
                var armPh = 2.6 * Math.log(radS / R + 0.06) - spec.seed * 6.2831;
                var thS = armPh + (rnd() < 0.72 ? (Math.floor(rnd() * 2) * Math.PI) : rnd() * Math.PI * 2) + gauss(rnd) * 0.35;
                lx = Math.cos(thS) * radS; ly = Math.sin(thS) * radS;
                lz = gauss(rnd) * thick * spec.diam * (1 - radS / R * 0.55);
                var coreMix = Math.exp(-Math.pow(radS / R, 2) * 6.0);
                cr = 0.78 + 0.27 * coreMix; cg = 0.84 + 0.10 * coreMix; cb = 1.0 - 0.28 * coreMix;
                if (rnd() < 0.03) { cr = 1.0; cg = 0.45; cb = 0.55; }   /* HII knots */
                bright = 0.35 + rnd() * 0.85;
            }
            if (spec.frame) {
                tmp.copy(spec.center)
                    .addScaledVector(spec.frame.m, lx)
                    .addScaledVector(spec.frame.e2, ly)
                    .addScaledVector(spec.frame.n, lz);
            } else {
                tmp.set(spec.center.x + lx, spec.center.y + ly, spec.center.z + lz);
            }
            posA.setXYZ(placed, tmp.x, tmp.y, tmp.z);
            colA.setXYZ(placed, cr * bright, cg * bright, cb * bright);
            sizA.setX(placed, spec.diam * (0.0022 + rnd() * 0.0038));
            placed++;
        }
        lod.volStars.geometry.setDrawRange(0, placed);
        posA.needsUpdate = true; colA.needsUpdate = true; sizA.needsUpdate = true;
        /* dust: REMOVED in the second pass. The photo-sampled point
           distribution already carries the dark lanes (few points are
           placed where the photograph is dark), and separate dust motes
           stacked into polka dots at close range in the first drive. */
        var dustN = 0;
        if (false) {
            var dMax = 2600;
            while (dustN < dMax) {
                var rd = R * (0.12 + Math.pow(rnd(), 0.7) * 0.85);
                var thD = rnd() * Math.PI * 2;
                var dx = Math.cos(thD) * rd, dy = Math.sin(thD) * rd;
                var dz = gauss(rnd) * spec.diam * 0.012;
                if (spec.dustTilt) {   /* Centaurus A: the band is its own tilted disc */
                    var c = Math.cos(spec.dustTilt), s = Math.sin(spec.dustTilt);
                    var y2 = dy * c - dz * s, z2 = dy * s + dz * c;
                    dy = y2; dz = z2;
                }
                if (spec.frame) {
                    tmp.copy(spec.center).addScaledVector(spec.frame.m, dx)
                        .addScaledVector(spec.frame.e2, dy).addScaledVector(spec.frame.n, dz);
                } else tmp.set(spec.center.x + dx, spec.center.y + dy, spec.center.z + dz);
                dPos.setXYZ(dustN, tmp.x, tmp.y, tmp.z);
                dCol.setXYZ(dustN, 0.05, 0.035, 0.02);
                dSiz.setX(dustN, spec.diam * (0.008 + rnd() * 0.016));
                dustN++;
            }
        }
        lod.volDust.geometry.setDrawRange(0, dustN);
        dPos.needsUpdate = true; dCol.needsUpdate = true; dSiz.needsUpdate = true;
        lod.volFor = spec.key; lod.volKind = spec.kind;
        lod.volCenter.copy(spec.center);
        lod.volDiam = spec.diam;
        lod.stats.volBuilds.push({ key: spec.key, ms: +(performance.now() - t0).toFixed(1), points: placed });
    }
    function lodCiColor(ci) {
        var stops = [
            [-0.33, [0.50, 0.62, 1.00]], [0.00, [0.72, 0.82, 1.00]],
            [0.32, [1.00, 0.95, 0.84]], [0.65, [1.00, 0.84, 0.55]],
            [1.15, [1.00, 0.64, 0.30]], [1.65, [1.00, 0.46, 0.19]],
            [2.40, [1.00, 0.33, 0.12]]
        ];
        for (var i = 1; i < stops.length; i++) {
            if (ci <= stops[i][0]) {
                var t = (ci - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
                var a = stops[i - 1][1], b = stops[i][1];
                return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
            }
        }
        return stops[stops.length - 1][1];
    }
    function lodSstep(a, b, x) {
        var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    }
    function lodFrame(dt, tSec) {
        if (!lod || !data) return;
        var nowMs = performance.now();
        if (lod.lastFrameT) {
            lod.frameMs.push(nowMs - lod.lastFrameT);
            if (lod.frameMs.length > 180) lod.frameMs.shift();
        }
        lod.lastFrameT = nowMs;
        lod.tick++;
        /* ---- choose the volume target: nearest object by range ratio ---- */
        if (lod.tick % 4 === 1 || !lod.target) {
            var best = null;
            function consider(key, kind, x, y, z, diam, extra) {
                var dx = x - camPos.x, dy = y - camPos.y, dz = z - camPos.z;
                var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                var ratio = d / Math.max(diam, 1e-9);
                if (!best || ratio < best.ratio) {
                    best = {
                        key: key, kind: kind, center: new THREE.Vector3(x, y, z),
                        diam: diam, ratio: ratio, dist: d, extra: extra || {}
                    };
                }
            }
            var i, e;
            for (i = 0; i < data.named.length; i++) {
                e = data.named[i];
                if (e.k === 1) {
                    consider(e.n, 'galaxy', e._pos[0], e._pos[1], e._pos[2],
                        data.galDiam[e.i], { galIndex: e.i });
                }
            }
            for (i = 0; i < nebulae.length; i++) {
                e = nebulae[i];
                consider(e.n, 'nebula', e.p[0], e.p[1], e.p[2], e.d, { fam: e.f });
            }
            /* the Milky Way's centre is a 5,200 pc pseudo-object: on ratio
               alone it would out-compete every local nebula (from Orion it
               scores ~1.5 while contributing no points anywhere near the
               camera). It joins the contest only when nothing real is
               closer than 3 diameters, or when the camera is genuinely in
               the centre's own neighbourhood (ratio < 1.2). */
            if (!best || best.ratio >= 3) {
                for (i = 0; i < data.named.length; i++) {
                    e = data.named[i];
                    if (e.k === 2 && e.n !== 'The Sun') {
                        var sdx = e._pos[0] - camPos.x, sdy = e._pos[1] - camPos.y, sdz = e._pos[2] - camPos.z;
                        var sr = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz) / 5200;
                        if (sr < 1.2 || !best || sr < best.ratio) {
                            best = {
                                key: e.n, kind: 'galaxy',
                                center: new THREE.Vector3(e._pos[0], e._pos[1], e._pos[2]),
                                diam: 5200, ratio: sr, dist: sr * 5200,
                                extra: { tint: 0, seed: 7.7, mw: true }
                            };
                        }
                    }
                }
            }
            if (galCloudPoints && galCloudPoints.visible) {
                for (i = 0; i < data.galCount; i++) {
                    consider('gal#' + i, 'galaxy',
                        data.galPos[i * 3], data.galPos[i * 3 + 1], data.galPos[i * 3 + 2],
                        data.galDiam[i], { galIndex: i });
                }
            }
            lod.target = best;
        }
        var tgt = lod.target;
        /* ---- volume lifecycle: build inside 6 diameters, keep to 9 ---- */
        var wantVol = tgt && tgt.ratio < 6;
        if (wantVol && lod.volFor !== tgt.key) {
            var spec = {
                key: tgt.key, kind: tgt.kind, center: tgt.center, diam: tgt.diam,
                seed: 3.1, tint: 1, fam: 0, dust: false, fillX: 1, fillY: 1, photoTex: null
            };
            if (tgt.kind === 'galaxy' && tgt.extra.galIndex !== undefined) {
                var gi = tgt.extra.galIndex;
                spec.tint = data.galTint[gi];
                /* the sprite's own per-galaxy seed (golden-ratio hash of
                   the catalog index), so the cloud's arms and clumps are
                   the same ones the far view draws */
                var sh = (gi + 1) * 0.61803398875;
                spec.seed = sh - Math.floor(sh);
                spec.frame = lodDiscFrame(tgt.center,
                    tmpV.set(data.galMajor[gi * 3], data.galMajor[gi * 3 + 1], data.galMajor[gi * 3 + 2]),
                    data.galAxis[gi] / 255);
                spec.dust = spec.tint === 1;
            }
            if (tgt.extra.mw) { spec.tint = 0; spec.seed = 42.5; }
            if (tgt.kind === 'nebula') spec.fam = tgt.extra.fam || 0;
            if (tgt.key === 'Centaurus A') {
                spec.tint = 0; spec.dust = true; spec.dustTilt = 0.42; spec.seed = 94.25;
            }
            /* seed from the photograph when this object has one on hand */
            var man = lod.manifest && lod.manifest[lodSlug(tgt.key)];
            if (man) {
                spec.fillX = man.fill ? man.fill[0] : 1;
                spec.fillY = man.fill ? man.fill[1] : 1;
                if (lod.photoFor === tgt.key && lod.photoTex) spec.photoTex = lod.photoTex;
            }
            lodBuildVolume(spec);
            lod.volStars.visible = lod.volDust.visible = true;
        }
        if (lod.volFor) {
            var vd = camPos.distanceTo(lod.volCenter);
            var vr = vd / Math.max(lod.volDiam, 1e-9);
            lod.volOpacity += ((vr < 3.2 ? lodSstep(3.2, 1.5, vr) : 0) - lod.volOpacity) * Math.min(1, dt * 5);
            lod.volOpacity = Math.max(0, Math.min(1, lod.volOpacity));
            if (vr > 9) {
                lod.volFor = ''; lod.volKind = ''; lod.volOpacity = 0;
                lod.volStars.visible = lod.volDust.visible = false;
            }
            lod.volStars.material.uniforms.uOpacity.value =
                lod.volOpacity * (lod.volKind === 'nebula' ? 0.5 : 0.85);
            lod.volDust.material.uniforms.uOpacity.value = lod.volOpacity * 0.5;
        }
        /* ---- photo layer: nearest photographed object in its band ---- */
        if (lod.manifest && (lod.tick % 4 === 2 || !lod.photoTarget)) {
            var bp = null;
            for (var nm in lod.manifest) {
                var ent = lod.manifest[nm];
                var ctr = null, dm = 0;
                if (ent.galIndex !== undefined) {
                    ctr = tmpV.set(data.galPos[ent.galIndex * 3], data.galPos[ent.galIndex * 3 + 1], data.galPos[ent.galIndex * 3 + 2]);
                    dm = data.galDiam[ent.galIndex];
                } else if (ent.nebIndex !== undefined && nebulae[ent.nebIndex]) {
                    var nb = nebulae[ent.nebIndex];
                    ctr = tmpV.set(nb.p[0], nb.p[1], nb.p[2]); dm = nb.d;
                }
                if (!ctr) continue;
                var dd = camPos.distanceTo(ctr), rr = dd / dm;
                if (!bp || rr < bp.ratio) bp = { name: ent.name, ratio: rr, dist: dd, diam: dm, center: ctr.clone(), ent: ent };
            }
            lod.photoTarget = bp;
        }
        var pt = lod.photoTarget;
        if (pt && pt.ratio < 90) {
            if (lod.photoFor !== pt.name) {
                /* the outgoing texture becomes a one-deep spare: flying
                   back to the object you just left is instant */
                if (lod.photoTex) {
                    if (lod.photoSpare) lod.photoSpare.tex.dispose();
                    lod.photoSpare = { name: lod.photoFor, full: lod.photoFull, tex: lod.photoTex };
                    lod.photoTex = null;
                }
                lod.photoFor = pt.name; lod.photoFull = false; lod.photoLoading = '';
                lodSetAtlas(pt, false);
            }
            if (!lod.photoTex && lod.photoSpare && lod.photoSpare.name === pt.name &&
                (pt.ratio >= 26 || lod.photoSpare.full)) {
                lod.photoTex = lod.photoSpare.tex; lod.photoFull = lod.photoSpare.full;
                lod.photoMat.uniforms.tPhoto.value = lod.photoTex;
                lod.photoSpare = null;
                if (lod.photoFull) lodSetAtlas(pt, true);
                if (lod.volFor === pt.name) lod.volFor = '';
            }
            var wantFull = pt.ratio < 26;
            var stage = wantFull ? 'full' : 'small';
            if (lod.photoLoading !== stage && (wantFull ? !lod.photoFull : !lod.photoTex)) {
                lod.photoLoading = stage;
                var file = wantFull ? pt.ent.f : pt.ent.s;
                var tStart = performance.now();
                new THREE.TextureLoader().load(new URL('./' + file, import.meta.url).href,
                    function (tex) {
                        tex.colorSpace = THREE.SRGBColorSpace;
                        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
                        if (lod.photoFor !== pt.name) { tex.dispose(); return; }
                        if (lod.photoTex) {
                            if (lod.photoSpare) lod.photoSpare.tex.dispose();
                            lod.photoSpare = { name: pt.name, full: false, tex: lod.photoTex };
                        }
                        lod.photoTex = tex;
                        lod.photoMat.uniforms.tPhoto.value = tex;
                        if (wantFull) { lod.photoFull = true; lodSetAtlas(pt, true); }
                        lod.stats.photoLoads.push({
                            name: pt.name, stage: stage,
                            ms: +(performance.now() - tStart).toFixed(0)
                        });
                        /* a volume already built for this object was
                           seeded blind — rebuild it from the photograph */
                        if (lod.volFor === pt.name) lod.volFor = '';
                    },
                    undefined,
                    function () { lod.photoLoading = ''; });
            }
            if (lod.photoTex) {
                var ctrAttr = lod.photoMesh.geometry.getAttribute('aCenter');
                for (var cvI = 0; cvI < 4; cvI++) ctrAttr.setXYZ(cvI, pt.center.x, pt.center.y, pt.center.z);
                ctrAttr.needsUpdate = true;
                lod.photoMat.uniforms.uDiam.value = pt.diam;
                /* projected major-axis angle, the galaxy shader's own maths */
                if (pt.ent.galIndex !== undefined) {
                    var gi2 = pt.ent.galIndex;
                    tmpV.set(data.galMajor[gi2 * 3], data.galMajor[gi2 * 3 + 1], data.galMajor[gi2 * 3 + 2]);
                    tmpV.transformDirection(camera.matrixWorldInverse);
                    lod.photoMat.uniforms.uAng.value = Math.atan2(tmpV.y, tmpV.x);
                    lod.photoMat.uniforms.uAxis.value = Math.max(0.10, data.galAxis[gi2] / 255);
                } else {
                    lod.photoMat.uniforms.uAng.value = 0;
                    lod.photoMat.uniforms.uAxis.value = 1;
                }
                lod.photoMat.uniforms.uRot.value = pt.ent.rot || 0;
                lod.photoMat.uniforms.uFill.value.set(
                    pt.ent.fill ? pt.ent.fill[0] : 1, pt.ent.fill ? pt.ent.fill[1] : 1);
                var po = (1 - lodSstep(9, 24, pt.ratio)) * lodSstep(0.30, 1.05, pt.ratio);
                lod.photoOpacity += (po - lod.photoOpacity) * Math.min(1, dt * 5);
                lod.photoMat.uniforms.uOpacity.value = lod.photoOpacity;
                lod.photoMesh.visible = lod.photoOpacity > 0.004;
            }
        } else if (lod.photoFor) {
            lod.photoOpacity = Math.max(0, lod.photoOpacity - dt * 2);
            lod.photoMat.uniforms.uOpacity.value = lod.photoOpacity;
            if (lod.photoOpacity <= 0.004) {
                lod.photoMesh.visible = false;
                lodSetAtlas(null, false);
                if (lod.photoTex) {
                    if (lod.photoSpare) lod.photoSpare.tex.dispose();
                    lod.photoSpare = { name: lod.photoFor, full: lod.photoFull, tex: lod.photoTex };
                    lod.photoTex = null;
                }
                lod.photoFor = ''; lod.photoTarget = null;
            }
        }
        /* ---- star surface: the nearest star, when truly close ---- */
        if (lod.tick % 15 === 7 && camPos.length() < 20000) {
            var bs = Infinity, bi = -1;
            for (var si = 0; si < data.starCount; si++) {
                var sdx = data.starPos[si * 3] - camPos.x;
                var sdy = data.starPos[si * 3 + 1] - camPos.y;
                var sdz = data.starPos[si * 3 + 2] - camPos.z;
                var sq = sdx * sdx + sdy * sdy + sdz * sdz;
                if (sq < bs) { bs = sq; bi = si; }
            }
            lod.starNear = { i: bi, dist: Math.sqrt(bs) };
        }
        var sn = lod.starNear;
        if (sn && sn.i >= 0) {
            var ci = data.starCi[sn.i], absM = data.starAbsMag[sn.i];
            var lum = Math.pow(10, -0.4 * (absM - 4.83));
            var temp = 4600 * (1 / (0.92 * ci + 1.7) + 1 / (0.92 * ci + 0.62));
            var rSun = Math.sqrt(Math.max(lum, 1e-4)) / Math.pow(Math.max(temp, 800) / 5778, 2);
            /* a display radius in the game's own enlarged-symbol spirit:
               rooted in the star's real radius, scaled so an arrival
               meets a disc, not a point */
            var rDisp = Math.max(0.00035, Math.min(0.004, 0.0011 * Math.pow(Math.max(rSun, 0.05), 0.5)));
            var sPos = tmpV.set(data.starPos[sn.i * 3], data.starPos[sn.i * 3 + 1], data.starPos[sn.i * 3 + 2]);
            if (lod.starFor !== sn.i) {
                lod.starFor = sn.i;
                var cc = lodCiColor(ci);
                lod.starMat.uniforms.uColHot.value.setRGB(cc[0], cc[1], cc[2]);
                lod.starMat.uniforms.uColLimb.value.setRGB(cc[0] * 0.92, cc[1] * 0.62, cc[2] * 0.34);
                lod.coronaMat.uniforms.uColHot.value.setRGB(cc[0], cc[1], cc[2]);
                lod.starMesh.position.copy(sPos);
                lod.coronaMesh.position.copy(sPos);
                lod.starMesh.scale.setScalar(rDisp);
                lod.coronaMesh.scale.setScalar(rDisp);
                lod.starMat.uniforms.uCenterW.value.copy(sPos);
                lod.stats.starBuilds++;
            }
            var sTarget = sn.dist < rDisp * 110 ? lodSstep(rDisp * 110, rDisp * 45, sn.dist) : 0;
            lod.starOpacity += (sTarget - lod.starOpacity) * Math.min(1, dt * 4);
            lod.starMat.uniforms.uOpacity.value = lod.starOpacity;
            lod.coronaMat.uniforms.uOpacity.value = lod.starOpacity;
            lod.starMat.uniforms.uTime.value = tSec;
            lod.starMesh.visible = lod.coronaMesh.visible = lod.starOpacity > 0.004;
        } else if (lod.starOpacity > 0) {
            lod.starOpacity = Math.max(0, lod.starOpacity - dt * 2);
            lod.starMat.uniforms.uOpacity.value = lod.starOpacity;
            lod.coronaMat.uniforms.uOpacity.value = lod.starOpacity;
            lod.starMesh.visible = lod.coronaMesh.visible = lod.starOpacity > 0.004;
            if (lod.starOpacity <= 0.004) lod.starFor = -1;
        }
    }
    function lodSetAtlas(pt, hold) {
        /* for the twelve atlas heroes, the dedicated photograph takes
           over from the 1000 px tile once it has landed in full */
        if (!heroAttrs) return;
        if (lod.atlasHeld >= 0 && (!pt || pt.ent.galIndex !== lod.atlasHeld)) {
            heroAttrs.hero.array[lod.atlasHeld] = lod.atlasTile + 1;
            heroAttrs.hero.needsUpdate = true;
            lod.atlasHeld = -1;
        }
        if (hold && pt && pt.ent.heroTile !== undefined && pt.ent.galIndex !== undefined) {
            lod.atlasTile = pt.ent.heroTile;
            lod.atlasHeld = pt.ent.galIndex;
            heroAttrs.hero.array[lod.atlasHeld] = 0;
            heroAttrs.hero.needsUpdate = true;
        }
    }

    /* ---------------- boot ---------------- */
    loadMsg.textContent = 'Loading the real universe\u2026';
    loadData().then(function (d) {
        data = d;
        return Promise.all([loadNebulae(), loadHeroes()]);
    }).then(function () {
        try {
            buildScene();
        } catch (err) {
            loadingEl.hidden = true;
            fallbackEl.hidden = false;
            return;
        }
        try { lodInit(); } catch (e) { /* LOD is an enhancement layer */ }
        bindEvents();
        applyDpr();
        loadingEl.hidden = true;
        ctrl.ready = true;
        lastInputT = performance.now();
        setCaption(EARTH_CAP);
        captionClaim = { kind: 'earth' };
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
