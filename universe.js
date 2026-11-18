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
   see them (a real star at these distances is a dimensionless point), and
   flight is faster than light — the HUD says by how much. Those are the
   only liberties, and the game states them.

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
    for (var i = 0; i < starCount; i++) {
        starMag[i] = magQ[i] / 10 - 5;
        starCi[i] = ciQ[i] / 1000;
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
        starPos: starPos, starMag: starMag, starCi: starCi,
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
    'attribute float aMag;',
    'attribute float aCi;',
    'uniform float uScaleH;',   /* (height px * 0.5 * proj[1][1]) * dpr */
    'uniform float uDpr;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'vec3 ciColor(float ci) {',
    '    vec3 c1 = vec3(0.61, 0.69, 1.00);',  /* -0.33 blue-white      */
    '    vec3 c2 = vec3(0.82, 0.87, 1.00);',  /*  0.00 white-blue      */
    '    vec3 c3 = vec3(1.00, 0.97, 0.90);',  /*  0.32 white           */
    '    vec3 c4 = vec3(1.00, 0.88, 0.68);',  /*  0.65 yellow-white    */
    '    vec3 c5 = vec3(1.00, 0.72, 0.44);',  /*  1.15 orange          */
    '    vec3 c6 = vec3(1.00, 0.55, 0.30);',  /*  1.65 red-orange      */
    '    vec3 col = c1;',
    '    col = mix(col, c2, smoothstep(-0.33, 0.00, ci));',
    '    col = mix(col, c3, smoothstep( 0.00, 0.32, ci));',
    '    col = mix(col, c4, smoothstep( 0.32, 0.65, ci));',
    '    col = mix(col, c5, smoothstep( 0.65, 1.15, ci));',
    '    col = mix(col, c6, smoothstep( 1.15, 1.65, ci));',
    '    return col;',
    '}',
    'void main() {',
    '    vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '    float dist = max(0.0005, -mv.z);',
    '    float bright = pow(10.0, -0.20 * (aMag - 1.0));',
    '    float sz = 3.1 * bright * pow(16.0 / dist, 0.30);',
    '    gl_PointSize = clamp(sz, 1.0, 30.0) * uDpr;',
    '    vCol = ciColor(aCi);',
    '    float a = 0.30 + 0.70 * clamp(bright, 0.0, 1.0);',
    '    a *= clamp(pow(16.0 / dist, 0.10), 0.45, 1.0);',
    '    vAlpha = a;',
    '    gl_Position = projectionMatrix * mv;',
    '}'
].join('\n');
var STAR_FRAG = [
    'precision mediump float;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'void main() {',
    '    vec2 q = gl_PointCoord - 0.5;',
    '    float d = length(q) * 2.0;',
    '    float core = exp(-d * d * 9.0);',
    '    float halo = exp(-d * d * 3.0) * 0.35;',
    '    float a = clamp(core + halo, 0.0, 1.0) * vAlpha;',
    '    if (a < 0.004) discard;',
    '    gl_FragColor = vec4(vCol, a);',
    '}'
].join('\n');
var GAL_VERT = [
    'attribute vec3 aMajor;',
    'attribute float aDiam;',
    'attribute float aAxis;',
    'attribute float aBright;',
    'attribute float aTint;',
    'uniform float uScaleH;',
    'uniform float uDpr;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vAng;',
    'varying float vAxis;',
    'void main() {',
    '    vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '    float dist = max(1.0, -mv.z);',
    '    float px = aDiam * uScaleH / dist;',
    '    gl_PointSize = clamp(px, 1.5, 460.0) * uDpr;',
    '    vec3 majView = (modelViewMatrix * vec4(aMajor, 0.0)).xyz;',
    '    vAng = atan(majView.y, majView.x);',
    '    vAxis = aAxis;',
    '    vec3 warm = vec3(1.00, 0.84, 0.64);',
    '    vec3 spiral = vec3(0.84, 0.89, 1.00);',
    '    vec3 irreg = vec3(0.64, 0.76, 1.00);',
    '    vCol = aTint < 0.5 ? warm : (aTint < 1.5 ? spiral : irreg);',
    '    float a = aBright;',
    '    a *= smoothstep(0.10, 0.55, dist / aDiam);',  /* fade when flying through */
    '    a *= clamp(px / 3.0, 0.25, 1.0);',           /* far specks stay faint   */
    '    vAlpha = a;',
    '    gl_Position = projectionMatrix * mv;',
    '}'
].join('\n');
var GAL_FRAG = [
    'precision mediump float;',
    'varying vec3 vCol;',
    'varying float vAlpha;',
    'varying float vAng;',
    'varying float vAxis;',
    'void main() {',
    '    vec2 q = gl_PointCoord - 0.5;',
    '    float ca = cos(vAng), sa = sin(vAng);',
    '    vec2 r = mat2(ca, -sa, sa, ca) * q;',
    '    r.y /= max(0.10, vAxis);',
    '    float d = length(r) * 2.0;',
    '    float disk = exp(-d * d * 4.5);',
    '    float core = exp(-d * d * 22.0) * 0.9;',
    '    float a = clamp(disk * 0.55 + core, 0.0, 1.0) * vAlpha;',
    '    if (a < 0.004) discard;',
    '    gl_FragColor = vec4(vCol, a);',
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
    var rafId = 0, lastT = 0;
    var camPos = new THREE.Vector3();
    var yaw = 0, pitch = 0;
    var F0 = null;             /* initial forward = toward the galactic center */
    var keys = {};
    var thrust = false, dragging = false;
    var speedT = 0.373;        /* ~2.5 pc/s default */
    var labelsOn = true;
    var nearestName = '', nearestDist = Infinity;
    var flyAnim = null;        /* jump-to flight */
    var tour = { on: false, index: 0, t: 0, dwell: 0, keys: [] };
    var pointers = new Map();
    var pinchDist = 0;
    var dprCap = Math.min(window.devicePixelRatio || 1, 3);
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
        sg.setAttribute('aMag', new THREE.BufferAttribute(data.starMag, 1));
        sg.setAttribute('aCi', new THREE.BufferAttribute(data.starCi, 1));
        var sm = new THREE.ShaderMaterial({
            vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
            uniforms: { uScaleH: { value: 1 }, uDpr: { value: 1 } },
            transparent: true, depthWrite: false, blending: THREE.NormalBlending
        });
        starPoints = new THREE.Points(sg, sm);
        starPoints.frustumCulled = false;
        scene.add(starPoints);

        /* galaxies — named set and redshift cloud as separate clouds so the
           cloud can be toggled without touching the named set. The named
           set was baked first (indices 0..namedGalCount-1). */
        function galPoints(from, to) {
            var n = to - from;
            var g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(data.galPos.slice(from * 3, to * 3), 3));
            g.setAttribute('aMajor', new THREE.BufferAttribute(data.galMajor.slice(from * 3, to * 3), 3));
            g.setAttribute('aDiam', new THREE.BufferAttribute(data.galDiam.slice(from, to), 1));
            var axis = new Float32Array(n), bright = new Float32Array(n), tint = new Float32Array(n);
            for (var i = 0; i < n; i++) {
                axis[i] = data.galAxis[from + i] / 255;
                bright[i] = data.galBright[from + i] / 255;
                tint[i] = data.galTint[from + i];
            }
            g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 1));
            g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
            g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
            var m = new THREE.ShaderMaterial({
                vertexShader: GAL_VERT, fragmentShader: GAL_FRAG,
                uniforms: { uScaleH: { value: 1 }, uDpr: { value: 1 } },
                transparent: true, depthWrite: false, blending: THREE.NormalBlending
            });
            var pts = new THREE.Points(g, m);
            pts.frustumCulled = false;
            return pts;
        }
        galNamedPoints = galPoints(0, data.namedGalCount);
        galCloudPoints = galPoints(data.namedGalCount, data.galCount);
        scene.add(galNamedPoints); scene.add(galCloudPoints);

        /* the Sun — one extra point at the origin, run through the star
           shader with a brilliant magnitude so it reads as a bright star
           with a halo at any range and never engulfs the camera. */
        var sunG = new THREE.BufferGeometry();
        sunG.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
        sunG.setAttribute('aMag', new THREE.BufferAttribute(new Float32Array([-14]), 1));
        sunG.setAttribute('aCi', new THREE.BufferAttribute(new Float32Array([0.35]), 1));
        sunPoints = new THREE.Points(sunG, sm);
        sunPoints.frustumCulled = false;
        scene.add(sunPoints);

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
        if (tmpV.lengthSq() < 1e-12) return;
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
        if (tour.on) {
            stopTour(false);
            setCaption('You have the controls. Drag to look around; hold Fly \u2014 or press W \u2014 to move.');
        }
        flyAnim = null;
    }

    /* ---------------- free flight ---------------- */
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
            move.normalize().multiplyScalar(speedPc() * dt);
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
        nearestDist = Math.sqrt(best);
        nearestName = bi >= 0 ? data.named[bi].n : '';
        hudNear.textContent = nearestName ? ('Nearest: ' + nearestName + ' \u2014 ' + fmtDist(nearestDist)) : '';
    }
    var labelTick = 0;
    function updateLabels(w, h) {
        if (!labelsOn) { labelPool.forEach(function (d) { d.style.display = 'none'; }); return; }
        var cands = [];
        for (var i = 0; i < data.named.length; i++) {
            var e = data.named[i];
            if (!e.l) continue;
            var p = e._pos;
            var dx = p[0] - camPos.x, dy = p[1] - camPos.y, dz = p[2] - camPos.z;
            var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
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
        else flyFrame(dt);

        /* dynamic clip planes: near/far follow the local scale */
        var alt = camPos.length();
        camera.near = Math.max(1e-6, Math.min(0.05, alt * 1e-4 + 1e-6));
        camera.far = Math.max(2e9, alt * 30);
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
        [starPoints, galNamedPoints, galCloudPoints].forEach(function (p) {
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
                return;
            }
            if (!dragging) return;
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
        setCaption('You are at the Sun \u2014 home. Every light around you is a real star at its true position. Fly the tour, or take the controls yourself.');
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
