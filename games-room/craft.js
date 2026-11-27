/* Craft for the Games Room v2 mock — the Universe ships, extracted
   VERBATIM from ~/workspace/universe-starman-mock/universe.js lines
   2026-3304 (the Disc builder + Starman v3, photo-matched to SpaceX
   public-domain photography; see that mock's REPORT-V3.md). The only
   changes are this wrapper: THREE comes from the import, `renderer` is
   the factory argument (the two PMREM environment bakes read it as a
   free variable in the original), and shipMaterials() is called once
   before the builders are returned. No builder code was edited. */
import * as THREE from 'three';

export function makeCraft(renderer) {
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
    /* Starman maps: near-white metallic-flake map so the material colour
       carries the midnight-cherry red; fine weave bump for the suit;
       the dash screen; the Roadster's five-twin-spoke rim face. */
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
    /* V2 photo textures (ambientCG, CC0 1.0): photographic normal and
       roughness maps — fabric weave for the suit, leather grain for the
       seats, rubber micro-grain for the tyres. Colour stays procedural;
       the photographs carry the surface structure. Pending count is
       exposed so the stills harness can wait for real bytes. */
    function photoTex(url, rx, ry) {
        window.__starmanTexPending = (window.__starmanTexPending || 0) + 1;
        var t = new THREE.TextureLoader().load(url, function () {
            window.__starmanTexPending--;
        }, undefined, function () { window.__starmanTexPending--; });
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
        return t;
    }
    /* V2 car environment: a hard little sun, black sky, and a broad dim
       blue earthshine panel below — the light the real photos were taken
       in, so the cherry paint and the visor reflect space, not a studio. */
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
    /* V2 tyre tread bump: a performance tread drawn from the real thing —
       three circumferential grooves, angled block slashes, fine sipes.
       Canvas x wraps the circumference, y runs across the tread width. */
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
    /* V2 sidewall: molded rings and raised-style lettering drawn in the
       ring's own planar UV (the annulus samples the inscribed disc). */
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
    /* Headlight beam: plain axial-falloff cone, apex at the lamp, opening
       toward -Z (forward). Faint — a cue, not a searchlight. */
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
    var SHIP = { env: null, glowTex: null, mats: {} };
    function shipMaterials() {
        if (SHIP.mats.dart) return SHIP.mats;
        SHIP.env = shipEnvTexture(); SHIP.glowTex = shipGlowTexture();
        function std(o) { var mt = new THREE.MeshStandardMaterial(o); mt.envMap = SHIP.env; return mt; }
        function painted(set, metal, rough, ei) {
            return std({ map: set.map, bumpMap: set.bump, bumpScale: 0.6, roughnessMap: set.rough,
                metalness: metal, roughness: rough, envMapIntensity: ei || 0.7 });
        }
        var dartSet = hullTextureSet('#99a0a7', '#878e96', '#c33d21', 1201, 'UV-01 · DART');
        var haulSet = hullTextureSet('#7e868d', '#68727a', '#d06a1e', 3407, 'UV-02 · HAULER');
        var ringSet = hullTextureSet('#aab0b6', '#9299a0', '#20506e', 5211, 'UV-03 · MERIDIAN');
        var discSet = hullTextureSet('#a29d93', '#87837b', '#3c4a55', 7817, 'UV-04');
        var paintMaps = carPaintMaps(); var fabricBump = suitFabricBump();
        SHIP.dashTex = dashScreenTexture(); var rimTex = rimFaceTexture();
        /* V2: the car's own hard-sun environment + photographic surface
           maps (ambientCG, CC0). Normal/roughness only — colour is ours. */
        SHIP.carEnv = carEnvTexture();
        var fabricN = photoTex('games-room/assets-v2/fabric-normal.jpg', 3, 3), fabricR = photoTex('games-room/assets-v2/fabric-rough.jpg', 3, 3);
        var leatherN = photoTex('games-room/assets-v2/leather-normal.jpg', 2, 2), leatherR = photoTex('games-room/assets-v2/leather-rough.jpg', 2, 2);
        var treadBump = treadBumpTexture();
        SHIP.sidewallF = sidewallTexture('195/50 R16'); SHIP.sidewallR = sidewallTexture('225/45 R17');
        SHIP.mats = {
            dartHull: painted(dartSet, 0.25, 1.0, 0.55),
            haulHull: painted(haulSet, 0.2, 1.0),
            haulBox: painted(haulSet, 0.15, 1.0),
            ringHull: painted(ringSet, 0.3, 1.0),
            discHull: painted(discSet, 0.35, 1.0),
            darkMetal: std({ color: 0x2c3034, metalness: 0.78, roughness: 0.52, envMapIntensity: 0.55 }),
            flatMetal: std({ color: 0x3a3f45, metalness: 0.6, roughness: 0.58, envMapIntensity: 0.35 }),
            ringMetal: std({ color: 0x969da5, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.65 }),
            radMat: std({ color: 0x40241c, metalness: 0.25, roughness: 0.9, envMapIntensity: 0.0, side: THREE.DoubleSide }),
            dartWing: std({ color: 0x848b93, metalness: 0.35, roughness: 0.5, envMapIntensity: 0.7 }),
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
                normalMap: photoTex('games-room/assets-v2/rubber-normal.jpg', 6, 1), normalScale: new THREE.Vector2(0.6, 0.6),
                roughnessMap: photoTex('games-room/assets-v2/rubber-rough.jpg', 6, 1), envMapIntensity: 0.3 }),
            tireTread: std({ color: 0x1a1b1d, metalness: 0.0, roughness: 1.0, bumpMap: treadBump, bumpScale: 1.4,
                normalMap: photoTex('games-room/assets-v2/rubber-normal.jpg', 10, 1), normalScale: new THREE.Vector2(0.7, 0.7),
                roughnessMap: photoTex('games-room/assets-v2/rubber-rough.jpg', 10, 1), envMapIntensity: 0.3 }),
            tireSideF: std({ map: SHIP.sidewallF, metalness: 0.0, roughness: 1.0,
                normalMap: photoTex('games-room/assets-v2/rubber-normal.jpg', 1, 1), normalScale: new THREE.Vector2(0.45, 0.45),
                roughnessMap: photoTex('games-room/assets-v2/rubber-rough.jpg', 1, 1), envMapIntensity: 0.3 }),
            tireSideR: std({ map: SHIP.sidewallR, metalness: 0.0, roughness: 1.0,
                normalMap: photoTex('games-room/assets-v2/rubber-normal.jpg', 1, 1), normalScale: new THREE.Vector2(0.45, 0.45),
                roughnessMap: photoTex('games-room/assets-v2/rubber-rough.jpg', 1, 1), envMapIntensity: 0.3 }),
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
    /* ---- The Dart: needle interceptor, twin thrusters ---- */
    function buildDart() {
        var M = SHIP.mats, g = new THREE.Group();
        var prof = [[0.056, -0.24], [0.064, -0.15], [0.069, -0.02], [0.061, 0.08], [0.045, 0.17], [0.026, 0.25], [0.011, 0.315], [0.0015, 0.35]]
            .map(function (p) { return new THREE.Vector2(p[0], p[1]); });
        var bodyGeo = new THREE.LatheGeometry(prof, 56); bodyGeo.rotateX(Math.PI / 2); bodyGeo.rotateY(Math.PI);
        g.add(new THREE.Mesh(bodyGeo, M.dartHull));
        var canopy = new THREE.Mesh(new THREE.SphereGeometry(0.033, 40, 28), M.glass);
        canopy.scale.set(0.78, 0.55, 2.1); canopy.position.set(0, 0.048, -0.135); g.add(canopy);
        var tailCap = new THREE.Mesh(new THREE.CircleGeometry(0.056, 32), M.dartHull);
        tailCap.position.set(0, 0, 0.241); g.add(tailCap);
        var wingShape = new THREE.Shape();
        wingShape.moveTo(0.02, -0.07); wingShape.lineTo(0.27, 0.05); wingShape.lineTo(0.275, 0.185); wingShape.lineTo(0.03, 0.13); wingShape.closePath();
        var wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.007, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
        wingGeo.rotateX(Math.PI / 2);
        var wingMat = M.dartWing;
        var wr = new THREE.Mesh(wingGeo, wingMat); wr.position.y = -0.006; g.add(wr);
        var wl = new THREE.Mesh(wingGeo, wingMat); wl.scale.x = -1; wl.position.y = -0.006; g.add(wl);
        [-1, 1].forEach(function (sgn) {
            var finShape = new THREE.Shape();
            finShape.moveTo(0, 0); finShape.lineTo(0.085, 0.02); finShape.lineTo(0.10, 0.075); finShape.lineTo(0.025, 0.055); finShape.closePath();
            var finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.005, bevelEnabled: false });
            var fin = new THREE.Mesh(finGeo, M.dartWing);
            fin.scale.set(0.7, 0.66, 1);
            fin.position.set(sgn * 0.056, 0.010, 0.17); fin.rotation.y = sgn * 0.5; fin.rotation.z = sgn * -0.5; g.add(fin);
            var pod = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.020, 0.11, 16), M.darkMetal);
            pod.rotation.x = Math.PI / 2; pod.position.set(sgn * 0.058, -0.002, 0.20); g.add(pod);
            var noz = nozzleUnit(0.030, 0.055, 0xbfd9ff); noz.position.set(sgn * 0.058, -0.002, 0.252); g.add(noz);
            g.userData['throat' + sgn] = noz.userData.throat;
        });
        var spike = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0028, 0.075, 8), M.darkMetal);
        spike.rotation.x = Math.PI / 2; spike.position.set(0, 0, -0.385); g.add(spike);
        var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.045, 6), M.darkMetal);
        mast.position.set(0, 0.062, 0.10); g.add(mast);
        navLight(0xff2a22, -0.298, 0, 0.19, g); navLight(0x2aff5a, 0.298, 0, 0.19, g); navLight(0xffffff, 0, 0.03, 0.245, g);
        var plumes = [], sparks = [];
        [-1, 1].forEach(function (sgn) {
            var pl = makePlume(0xeaf4ff, 0x3d7bff, 0.52, 0.026); pl.group.position.set(sgn * 0.058, -0.002, 0.272); g.add(pl.group); plumes.push(pl);
            var sk = makeSparks(0x9fc2ff, 70, 0.012); sk.obj.position.set(sgn * 0.058, -0.002, 0.28); g.add(sk.obj); sparks.push(sk);
        });
        var light = new THREE.PointLight(0x6f9fff, 0, 1.6, 2); light.position.set(0, 0, 0.58); g.add(light);
        shadowed(g);
        return { group: g, update: function (r, sdt, t) {
            plumes.forEach(function (p) { p.set(r, t); }); sparks.forEach(function (s) { s.update(r, sdt); });
            light.intensity = r * 5;
            [-1, 1].forEach(function (sgn) { var th = g.userData['throat' + sgn]; if (th) th.material.color.setRGB(0.35 + r * 1.9, 0.5 + r * 1.8, 0.7 + r * 1.6); });
        } };
    }
    /* ---- The Hauler: rugged freighter, four engine pods, orange plumes ---- */
    function buildHauler() {
        var M = SHIP.mats, g = new THREE.Group();
        var prof = new THREE.Shape();
        prof.moveTo(-0.30, -0.055); prof.lineTo(0.16, -0.064); prof.lineTo(0.335, -0.026); prof.lineTo(0.318, 0.036);
        prof.lineTo(0.10, 0.062); prof.lineTo(-0.26, 0.058); prof.lineTo(-0.30, 0.028); prof.closePath();
        var hullGeo = new THREE.ExtrudeGeometry(prof, { depth: 0.15, bevelEnabled: true, bevelThickness: 0.011, bevelSize: 0.011, bevelSegments: 2 });
        hullGeo.rotateY(Math.PI / 2); hullGeo.translate(-0.075, 0, 0);
        g.add(new THREE.Mesh(hullGeo, M.haulHull));
        var cabGlass = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.020, 0.012), M.glass);
        cabGlass.position.set(0, 0.026, -0.322); cabGlass.rotation.x = -0.42; g.add(cabGlass);
        for (var w = -2; w <= 2; w++) {
            var win = new THREE.Mesh(new THREE.PlaneGeometry(0.011, 0.007), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
            win.position.set(w * 0.024, 0.0175, -0.3305); win.rotation.x = -0.42; win.rotation.y = Math.PI; g.add(win);
        }
        [-1, 1].forEach(function (sgn) {
            var box = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.078, 0.31), sgn < 0 ? M.haulBox : M.white);
            box.position.set(sgn * 0.118, -0.008, 0.03); g.add(box);
            for (var rb = 0; rb < 5; rb++) {
                var rib = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.080, 0.008), M.darkMetal);
                rib.position.set(sgn * 0.118, -0.008, -0.10 + rb * 0.065); g.add(rib);
            }
            var pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.34, 10), M.copper);
            pipe.rotation.x = Math.PI / 2; pipe.position.set(sgn * 0.083, 0.036, 0.05); g.add(pipe);
        });
        var hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.014, 32), M.darkMetal);
        hatch.position.set(0, 0.068, -0.04); g.add(hatch);
        var haulDark = M.haulHull.clone(); haulDark.map = null; haulDark.color.set(0x7a8087);
        var rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.158, 0.118, 0.014), haulDark);
        rearPlate.position.set(0, 0, 0.298); g.add(rearPlate);
        [-0.038, 0.038].forEach(function (vy) {
            var vent = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.007, 0.010), M.flatMetal);
            vent.position.set(0, vy, 0.307); g.add(vent);
        });
        var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.003, 0.075, 8), M.darkMetal);
        mast.position.set(0, 0.10, 0.16); g.add(mast);
        var dish = new THREE.Mesh(new THREE.SphereGeometry(0.032, 28, 14, 0, Math.PI * 2, 0, 0.85), M.white);
        dish.position.set(0, 0.145, 0.16); dish.rotation.x = -1.1; g.add(dish);
        var plumes = [], sparks = [], throats = [];
        [[-0.105, 0.045], [0.105, 0.045], [-0.105, -0.05], [0.105, -0.05]].forEach(function (pp) {
            var noz = nozzleUnit(0.021, 0.05, 0xffc9a0); noz.position.set(pp[0], pp[1], 0.315); g.add(noz); throats.push(noz.userData.throat);
            var pl = makePlume(0xfff1d6, 0xff7a26, 0.44, 0.024); pl.group.position.set(pp[0], pp[1], 0.335); g.add(pl.group); plumes.push(pl);
            var sk = makeSparks(0xffb37a, 45, 0.010); sk.obj.position.set(pp[0], pp[1], 0.34); g.add(sk.obj); sparks.push(sk);
        });
        navLight(0xff2a22, -0.148, 0, 0.10, g); navLight(0x2aff5a, 0.148, 0, 0.10, g);
        var light = new THREE.PointLight(0xff8a3d, 0, 1.8, 2); light.position.set(0, 0, 0.85); g.add(light);
        shadowed(g);
        return { group: g, update: function (r, sdt, t) {
            plumes.forEach(function (p) { p.set(r, t); }); sparks.forEach(function (s) { s.update(r, sdt); });
            light.intensity = r * 3;
            throats.forEach(function (th) { th.material.color.setRGB(0.45 + r * 1.9, 0.30 + r * 1.15, 0.12 + r * 0.4); });
        } };
    }
    /* ---- The Ring Ship: spine + rotating drive ring ---- */
    function buildRing() {
        var M = SHIP.mats, g = new THREE.Group();
        var prof = [[0.030, -0.30], [0.020, -0.12], [0.016, 0.05], [0.020, 0.18], [0.028, 0.27], [0.020, 0.315], [0.004, 0.33]]
            .map(function (p) { return new THREE.Vector2(p[0], p[1]); });
        var spineGeo = new THREE.LatheGeometry(prof, 40); spineGeo.rotateX(Math.PI / 2); spineGeo.rotateY(Math.PI);
        g.add(new THREE.Mesh(spineGeo, M.ringHull));
        var habMat = M.ringHull.clone(); habMat.envMapIntensity = 0.5;
        var hab = new THREE.Mesh(new THREE.SphereGeometry(0.052, 48, 32), habMat);
        hab.scale.set(1, 1, 1.3); hab.position.set(0, 0, -0.235); g.add(hab);
        var winBand = new THREE.Mesh(new THREE.TorusGeometry(0.0505, 0.0024, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
        winBand.position.set(0, 0, -0.272); g.add(winBand);
        var dock = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.026, 0.045, 24), M.darkMetal);
        dock.rotation.x = Math.PI / 2; dock.position.set(0, 0, -0.315); g.add(dock);
        for (var ti = 0; ti < 3; ti++) {
            var a = ti / 3 * Math.PI * 2;
            var truss = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.20, 8), M.flatMetal);
            truss.rotation.x = Math.PI / 2;
            truss.position.set(Math.cos(a) * 0.027, Math.sin(a) * 0.027, 0.045); g.add(truss);
        }
        var ring = new THREE.Group(); ring.position.z = 0.145; g.add(ring);
        var torus = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.021, 20, 96), M.ringMetal); ring.add(torus);
        var glowRingMat = new THREE.MeshBasicMaterial({ color: 0x2c5a78 });
        var glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.146, 0.005, 8, 96), glowRingMat); ring.add(glowRing);
        for (var si = 0; si < 4; si++) {
            var sub = new THREE.Group(); sub.rotation.z = si * Math.PI / 2; ring.add(sub);
            var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.148, 0.017, 0.017), M.flatMetal);
            spoke.position.x = 0.086; sub.add(spoke);
            var pod = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.022, 0.052), M.ringHull);
            pod.position.set(0.165, 0, 0); sub.add(pod);
            var podTip = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), new THREE.MeshBasicMaterial({ color: 0xbfe0ff }));
            podTip.position.set(0.165, 0, 0.03); sub.add(podTip);
        }
        [-1, 1].forEach(function (sgn) {
            var rad = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.05), M.radMat);
            rad.position.set(sgn * 0.108, 0, 0.25); rad.rotation.y = sgn * -0.28; g.add(rad);
        });
        var noz = nozzleUnit(0.026, 0.05, 0xbfd9ff); noz.position.set(0, 0, 0.335); g.add(noz);
        var pl = makePlume(0xeaf4ff, 0x3d7bff, 0.44, 0.023); pl.group.position.set(0, 0, 0.355); g.add(pl.group);
        var sk = makeSparks(0x9fc2ff, 60, 0.010); sk.obj.position.set(0, 0, 0.36); g.add(sk.obj);
        var beaconMat = new THREE.MeshBasicMaterial({ color: 0xff4438 });
        var beacon = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), beaconMat);
        beacon.position.set(0, 0.045, 0.05); g.add(beacon);
        navLight(0xff2a22, -0.165, 0, 0.145, g); navLight(0x2aff5a, 0.165, 0, 0.145, g);
        var light = new THREE.PointLight(0x6f9fff, 0, 1.6, 2); light.position.set(0, 0, 0.62); g.add(light);
        shadowed(g);
        return { group: g, ring: ring, update: function (r, sdt, t, bank) {
            ring.rotation.z -= sdt * (0.4 + r * 7.5);
            glowRingMat.color.setRGB(0.05 + r * 0.35, 0.12 + r * 0.55, 0.16 + r * 0.75);
            pl.set(r * 0.85, t); sk.update(r, sdt); light.intensity = r * 4;
            beaconMat.color.setRGB((Math.sin(t * 2.4) > 0.55 ? 1.6 : 0.25), 0.10, 0.08);
            noz.userData.throat.material.color.setRGB(0.35 + r * 1.7, 0.5 + r * 1.6, 0.7 + r * 1.5);
        } };
    }
    /* ---- The Disc: classic saucer, glow instead of plume ---- */
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
    shipMaterials();
    return { buildDisc: buildDisc, buildStarman: buildStarman };
}
