// Shared site script: finance data + the one theme implementation.
//
// Theme rules: the visitor's stored choice always wins; with no stored
// choice the site defaults to dark. The OS light/dark setting is never
// followed, and toggling never reloads the page. All storage access is
// guarded, so a blocked localStorage (sandboxed iframe, blocking
// extension) can never break this script or any other script on the page.

var __themeMemory = null; // in-memory fallback when storage is unavailable

function themeGetStored() {
    try {
        return window.localStorage.getItem('theme');
    } catch (e) {
        return __themeMemory;
    }
}

function themeSave(value) {
    __themeMemory = value;
    try {
        window.localStorage.setItem('theme', value);
    } catch (e) {
        // Storage unavailable: the in-memory value keeps this session consistent.
    }
}

function applyTheme() {
    var light = themeGetStored() === 'light';
    document.body.classList.toggle('light-mode', light);
    try {
        document.documentElement.style.colorScheme = light ? 'light' : 'dark';
    } catch (e) {}
    var toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = !light; // checked = dark (site convention)
}

function initThemeToggle() {
    applyTheme();
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('change', function (e) {
            var light = !e.target.checked;
            document.body.classList.toggle('light-mode', light);
            try {
                document.documentElement.style.colorScheme = light ? 'light' : 'dark';
            } catch (e) {}
            themeSave(light ? 'light' : 'dark');
        });
    }
}

function initNavDropdown() {
    var toggle = document.getElementById('nav-toggle');
    var menu = document.getElementById('nav-menu');
    if (!toggle || !menu) return;
    function closeMenu() {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
    }
    toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = menu.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
        if (!menu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeMenu(); toggle.focus(); }
    });
}

async function loadFinancialData() {
    try {
        const response = await fetch('finance-data.json');
        const data = await response.json();

        // Update the last synced date text if you have an element for it
        const dateEl = document.getElementById('last-updated');
        if (dateEl) dateEl.innerText = data.last_updated;

        // Loop through stocks and populate your table cells dynamically
        data.stocks.forEach(stock => {
            // Find your table row or cell elements matching the ticker
            // e.g., mapping stock.price and stock.fair_value directly into your HTML cells
            console.log(`Ticker: ${stock.ticker}, Price: $${stock.price}, Fair Value: $${stock.fair_value}`);
        });

    } catch (error) {
        console.error("Error loading financial data:", error);
    }
}

/* Golden indicator: the header's link to the Bitcoin indicator
   section. Exactly one of its three anchors shows, chosen by the
   nightly btc-state.json: a green dot while Johnny's combined
   score is in its buy band (the golden state), a red dot in its
   sell band (the top state), an amber dot between the bands
   (Hold). Every
   caption carries the published score itself (score.value, one
   decimal) — the same number the alert emails carry. The writer
   runs on weekdays, so freshness allows 96 hours — a long weekend
   plus one missed run; anything older, missing, malformed or
   future-dated, or a state file with no usable score, leaves all
   three anchors hidden. The homepage card's price dot
   (.live-pulse) is driven by the same state and hides with
   them. Fail-safe in every direction: a wrong
   indicator can never appear. */
function initGoldenStar() {
    var star = document.querySelector('.golden-star:not(.top-star):not(.hold-star)');
    var topStar = document.querySelector('.top-star');
    var holdStar = document.querySelector('.hold-star');
    if ((!star && !topStar && !holdStar) || !window.fetch) return;
    var MAX_AGE_MS = 96 * 60 * 60 * 1000;
    /* One decimal, rounded half-to-even on the decimal the state
       file prints — the alert emails format the same value with
       Python's "%.1f", which rounds the same way (47.25 -> "47.2");
       JavaScript's toFixed(1) would print "47.3" there. */
    function fmtScore(v) {
        if (typeof v !== 'number' || !isFinite(v)) return null;
        var s = String(Math.abs(v));
        if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) return null;
        var parts = s.split('.');
        var whole = parts[0];
        var frac = parts[1] || '';
        var d1 = frac.length ? +frac.charAt(0) : 0;
        var rest = frac.slice(1);
        if (rest.length) {
            var first = +rest.charAt(0);
            if (first > 5 || (first === 5 && /[1-9]/.test(rest.slice(1)))) d1++;
            else if (first === 5 && d1 % 2 === 1) d1++;
        }
        if (d1 === 10) { d1 = 0; whole = String(+whole + 1); }
        return (v < 0 ? '-' : '') + whole + '.' + d1;
    }
    fetch('btc-state.json').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }).then(function (s) {
        if (!s) return;
        var t = Date.parse(s.as_of || '');
        if (!isFinite(t)) return;
        var age = Date.now() - t;
        if (age < -60 * 60 * 1000 || age > MAX_AGE_MS) return;
        var num = fmtScore(s.score && s.score.value);
        if (num === null) return;
        var target = s.golden === true ? star : (s.top === true ? topStar : holdStar);
        if (!target) return;
        target.hidden = false;
        var cardDot = document.querySelector('.live-pulse');
        if (cardDot) {
            if (s.top === true) cardDot.classList.add('band-sell');
            else if (s.golden !== true) cardDot.classList.add('band-hold');
            cardDot.hidden = false;
        }
    }).catch(function () { /* no state file, no indicator */ });
}

document.addEventListener('DOMContentLoaded', function () {
    initThemeToggle();
    initNavDropdown();
    initGoldenStar();
    initLogoIntro();
    loadFinancialData();
});

/* Homepage logo intro: one-shot opening animation (index.html only — runs
   only when #logo-intro exists). On load the full-viewport green screen
   shows the JBO logo centered. The visitor can play with it: a touch
   drag (or the mouse wheel) drives the morph DIRECTLY — the logo
   shrinks into the header under the finger, at the finger's speed,
   freely reversible any number of times, over a short drag range
   (~20% of the viewport height, clamped to 140–180 px — never the old
   ~760 px swipe). Nothing commits while a finger is down: letting go
   past halfway settles the logo into the header, letting go before
   halfway settles it back open, and a flick carries through in its own
   direction; the settle starts at the release speed, so there is no
   speed step at the handoff. A tap (or a scroll key) instead plays the
   choreographed 720 ms time-based glide from the v2 rebuild. Either
   way the page stays pinned at scrollY 0 until the logo lands, so
   normal scrolling then starts from the very top of the page (header,
   name, About Me). Once the logo has landed the intro is done for the
   session and never comes back — scrolling back to the top does not
   re-trigger it. If the page loads already scrolled (refresh mid-page,
   anchor, back / forward), the intro is skipped entirely and the logo
   is already in the header. Skipped when the visitor prefers reduced
   motion. The header logo's landing spot is measured at runtime (its
   at-rest position at the top of the page), so it lands exactly on the
   header logo in both themes and on mobile. The green overlay fades
   across most of the morph (gone by ~75% of progress, ease-out cubic)
   while the logo keeps shrinking across the full range and stays fully
   opaque, so the page shows through almost as soon as the morph starts
   but the green melts away instead of snapping off.
   Motion model (v2, 2026-11-24; drag path added the same day at
   Johnny's request — "I want to be able to scroll it too… if i scroll
   it needs to feel perfectly smooth too"): there is ONE morph, a pure
   function of a master progress p, sampled from the spatial curves the
   original scrub used (smoothstep on the logo's path, ease-out cubic
   on the green, the hint gone by 35%). Two drivers move p. The glide
   driver is time-based: keyframes sampled once from the morph and
   played by the Web Animations engine, no per-frame JS. The drag
   driver is the visitor's own hand: drag distance maps 1:1 onto p
   through the same sampled curve, and the only work on the frame path
   is writing transform + opacity + border-radius from that curve —
   geometry frozen for the gesture, no layout reads, no observers.
   What the first scroll-scrub died of (Johnny's videos, 2026-11-24)
   was never direct manipulation itself; it was coupling the morph to
   the PAGE's scroll position, so iOS scroll physics — rubber-band
   easing, momentum steps, toolbar resizes, refresh stepping — printed
   into the animation. Here the page cannot scroll at all while the
   intro runs, and p answers to the finger alone. EVERY property of
   the landing mark rides the morph — the corner radius included: the
   logo art is an opaque green square and the header mark is that
   square with rounded corners (8px; 6px on small screens), so the
   radius interpolates from square to the header's exact radius across
   the last two-thirds of progress and the mark arrives already in its
   final shape — the end-state class swap then changes nothing visible.
   The landing geometry is measured once at rest and frozen at the
   first interaction, and the logo and hint are pinned to pixel
   anchors, so an iOS toolbar resize mid-gesture cannot move the
   anchors and jump the logo. The "Scroll to start" hint is sampled
   from the same master progress (no MutationObserver re-deriving it).
   A 'jbo:introglide' window event, fired once when the morph first
   moves forward in earnest, tells the hero photo's focus effect to
   sharpen in step, so the photo is sharp at the landing instead of
   waiting on scroll the intro has been holding at zero. NO timer ever
   acts while a touch is held — the intro is a little game the visitor
   plays at their own pace; the only idle timer belongs to the desktop
   wheel, and a touch cancels it. */
function initLogoIntro() {
    var intro = document.getElementById('logo-intro');
    if (!intro) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Late-load guard: if script.js arrived after the boot failsafe had
    // already hidden the intro, never pop it in over the page — the
    // visitor already has the normal header.
    if (window.__logoIntroLate) {
        document.documentElement.classList.remove('logo-intro-on');
        window.__logoIntroReady = true;
        return;
    }
    // One-shot: if the page loads already scrolled, skip the intro — the
    // logo is already in the header.
    if ((window.scrollY || window.pageYOffset || 0) > 0) {
        document.documentElement.classList.remove('logo-intro-on');
        window.__logoIntroReady = true;
        return;
    }
    var logo = document.getElementById('logo-intro-logo');
    var bg = intro.querySelector('.logo-intro-bg');
    var hint = document.getElementById('logo-intro-hint');
    var brand = document.querySelector('.site-brand-logo');
    if (!logo || !bg || !brand) return;
    document.documentElement.classList.add('logo-intro-on');
    var GLIDE_MS = 720;   // the tap glide, trigger to landing
    var GLIDE_RATE = 1000 / GLIDE_MS; // the glide's progress rate (p per second)
    // One full drag of the morph: a fifth of the viewport height,
    // clamped so it stays a short, playable pull on any screen — and
    // never the ~760 px swipe the first version demanded.
    var DRAG_RANGE = Math.round(Math.min(180, Math.max(140, window.innerHeight * 0.20)));
    var COMMIT_P = 0.5;   // release at or past halfway lands; before, reopens
    var FLICK_V = 1.4;    // release speed (p/second) that carries its own direction
                          // (~240 px/s of finger travel: a real flick, never a gentle release)
    var MIN_RATE = 0.9;   // a dead-slow release still settles promptly
    var WHEEL_IDLE_MS = 150; // desktop wheel: input stopped -> settle
    var start = null, target = null, brandRadius = 0, hintPin = null;
    var done = false;     // one-shot: once landed, the intro never re-engages
    var gliding = false;  // a time-based settle/glide is playing
    var started = false;  // first interaction freezes the measured geometry
    var prog = 0;         // the master progress: the morph is a pure function of it
    var anims = [], rafId = null;
    var settleInfo = null;   // {from, to, dur} of the running WAAPI settle
    var settleTimer = null;  // force-land safety net for a running settle
    var scrubRaf = null, pendingP = null; // drag writes, coalesced to one per frame
    var wheelIdleTimer = null;
    var heroSignaled = false;
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function measure() {
        // Start = the logo's centered position, read from the overlay's
        // own rect (robust to viewport/scrollbar quirks — never assume
        // innerWidth / 2 is the visual center).
        var ir = intro.getBoundingClientRect();
        start = { cx: ir.left + ir.width / 2, cy: ir.top + ir.height / 2, size: logo.offsetWidth };
        // The page stays pinned at scrollY 0 while the intro runs, so the
        // landing spot is the brand's at-rest position in the viewport at
        // the top of the page (not its stuck position once the nav pins
        // on scroll — the nav only sticks after the intro is done). The
        // brand's corner radius is measured too: the flying mark must
        // arrive wearing it, not receive it in the settle swap.
        var b = brand.getBoundingClientRect();
        target = {
            cx: b.left + b.width / 2,
            cy: b.top + b.height / 2,
            size: b.width
        };
        brandRadius = parseFloat(window.getComputedStyle(brand).borderTopLeftRadius) || 0;
        // The hint's anchor is measured here too, at rest, so pinning it
        // at the first interaction needs no layout read on the gesture
        // path — the frame path stays writes-only from the first touch.
        if (hint) {
            var hr0 = hint.getBoundingClientRect();
            hintPin = { left: hr0.left, top: hr0.top };
        }
        applyAt(0);
    }
    // The morph as a pure function of progress p (0 = at rest, 1 =
    // landed) — the spatial curves the old scroll-scrub sampled, kept
    // identical so the glide passes through the same compositions:
    // smoothstep on the logo's path; the green phased on an ease-out
    // cubic over the first ~75% of progress (it starts fading
    // immediately — at p = 0.1 the green is already ~65%, so the page
    // shows through right away — but the tail's slope is 0, so the last
    // of the green melts away with no hard edge at zero); the hint gone
    // by p = 0.35. The corner radius joins at p = 0.35 and reaches the
    // header mark's exact radius at the landing, expressed in element
    // px (visual radius divided by the current scale) so the settle
    // swap to the real header logo changes neither the mark's shape
    // nor its box.
    function stateAt(p) {
        var e = smooth(p);
        var scale = 1 + (target.size / start.size - 1) * e;
        var dx = (target.cx - start.cx) * e;
        var dy = (target.cy - start.cy) * e;
        var rVis = brandRadius * smooth(clamp01((p - 0.35) / 0.65));
        return {
            transform: 'translate3d(' + (-start.size / 2 + dx).toFixed(1) + 'px, ' +
                (-start.size / 2 + dy).toFixed(1) + 'px, 0) scale(' + scale.toFixed(4) + ')',
            borderRadius: (rVis / scale).toFixed(1) + 'px',
            bgOpacity: (1 - easeOutCubic(clamp01(p / 0.75))).toFixed(3),
            hintOpacity: (0.75 * (1 - clamp01(p / 0.35))).toFixed(3)
        };
    }
    function signalHero() {
        if (heroSignaled) return;
        heroSignaled = true;
        // The hero photo sharpens in step with the morph (its focus
        // effect in index.html listens for this): sharp at the landing,
        // not after scroll the intro has been holding at zero.
        try { window.dispatchEvent(new CustomEvent('jbo:introglide')); } catch (e) { /* older engine: the hero keeps its scroll sharpening */ }
    }
    // The ONLY writer on the morph's frame path, for every driver: the
    // tap glide's fallback, a settle, and the visitor's own drag. Three
    // style writes from the precomputed curve — no layout reads, no
    // measurements, nothing else per frame.
    function applyAt(p) {
        if (!start || !target) return;
        prog = p;
        if (p >= 0.04) signalHero();
        var s = stateAt(p);
        logo.style.transform = s.transform;
        logo.style.borderRadius = s.borderRadius;
        bg.style.opacity = s.bgOpacity;
        if (hint) hint.style.opacity = s.hintOpacity;
    }
    // First interaction of any kind freezes the measured geometry and
    // pins the anchors, so nothing later — a resize, the iOS toolbar —
    // can move the morph's path mid-gesture or mid-glide.
    function freeze() {
        if (started) return;
        started = true;
        pinAnchors();
    }
    // Time-based motion: keyframes sampled once from stateAt() over
    // the span being travelled and handed to the Web Animations
    // engine, which runs them on the compositor — while one plays
    // there is no JS on the frame path at all. Progress advances at a
    // constant rate through the sampled curve (the curve itself
    // carries all the easing, exactly as in the v2 glide), so a settle
    // that starts at the visitor's release speed has no speed step at
    // the handoff: the morph's own velocity is the curve's slope times
    // the progress rate, and the rate is continuous. The fallback (no
    // WAAPI) is an rAF tween over the same curve at the same rate.
    function buildKeyframes(from, to) {
        var N = 24, logoK = [], bgK = [], hintK = [];
        for (var i = 0; i <= N; i++) {
            var off = i / N, s = stateAt(from + (to - from) * off);
            logoK.push({ transform: s.transform, borderRadius: s.borderRadius, offset: off });
            bgK.push({ opacity: s.bgOpacity, offset: off });
            hintK.push({ opacity: s.hintOpacity, offset: off });
        }
        return { logo: logoK, bg: bgK, hint: hintK };
    }
    function startSettle(to, rate) {
        if (done) return;
        cancelSettle(true);
        flushScrub();
        freeze();
        if (Math.abs(to - prog) < 0.0015) {
            applyAt(to);
            if (to === 1) completeGlide();
            return;
        }
        gliding = true;
        var from = prog, dur = Math.abs(to - from) / rate * 1000;
        // Safety net: whatever happens to the animation, the page must
        // never stay locked — land the intro by hand if a landing
        // overruns. (A reopen that overruns simply stops at rest.)
        if (settleTimer !== null) clearTimeout(settleTimer);
        settleTimer = setTimeout(function () {
            settleTimer = null;
            if (gliding && !done) { if (to === 1) completeGlide(); else settleDone(0); }
        }, dur + 500);
        if (logo.animate && bg.animate) {
            var k = buildKeyframes(from, to);
            var timing = { duration: dur, easing: 'linear', fill: 'forwards' };
            settleInfo = { from: from, to: to, dur: dur };
            anims = [logo.animate(k.logo, timing), bg.animate(k.bg, timing)];
            if (hint && hint.animate) anims.push(hint.animate(k.hint, timing));
            anims[0].onfinish = function () { settleDone(to); };
        } else {
            var t0 = null, dir = to > from ? 1 : -1;
            var step = function (ts) {
                if (done || !gliding) { rafId = null; return; }
                if (t0 === null) t0 = ts;
                var p = from + dir * (ts - t0) / 1000 * rate;
                if ((dir > 0 && p >= to) || (dir < 0 && p <= to)) {
                    rafId = null;
                    applyAt(to);
                    settleDone(to);
                    return;
                }
                applyAt(p);
                rafId = requestAnimationFrame(step);
            };
            rafId = requestAnimationFrame(step);
        }
    }
    function settleDone(to) {
        if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
        settleInfo = null;
        if (to === 1) { completeGlide(); return; }
        // Back at rest: the intro is armed again, exactly as it loaded.
        // Write the rest frame inline, then cancel the animations — a
        // finished fill-forwards animation would otherwise override
        // the inline styles of the visitor's next drag.
        gliding = false;
        applyAt(0);
        for (var i = 0; i < anims.length; i++) { try { anims[i].cancel(); } catch (e) {} }
        anims = [];
    }
    // Stop a running settle where it stands: adopt the frame the
    // compositor is currently showing as inline styles, so taking the
    // morph back into the hand (or into a new settle) never jumps.
    function cancelSettle(adopt) {
        if (!gliding) return;
        var pNow = prog;
        if (settleInfo && anims.length && anims[0].currentTime !== null && anims[0].currentTime !== undefined) {
            pNow = settleInfo.from + (settleInfo.to - settleInfo.from) *
                clamp01(anims[0].currentTime / settleInfo.dur);
        }
        if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
        settleInfo = null;
        gliding = false;
        for (var i = 0; i < anims.length; i++) { try { anims[i].cancel(); } catch (e) {} }
        anims = [];
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        if (adopt) applyAt(pNow);
    }
    // The tap glide: the v2 choreography — the whole morph at the
    // glide's own rate. From rest that is exactly 720 ms.
    function startGlide() {
        if (done) return;
        signalHero();
        startSettle(1, GLIDE_RATE);
    }
    function completeGlide() {
        if (done) return;
        // Write the final frame as inline styles first, then cancel the
        // animations: the mark on screen does not move a fraction when
        // control passes from the animation to the settled state, and
        // finish()'s class swap (overlay hides, header logo shows) is
        // invisible because the flying mark already wears the header
        // mark's exact box and corner radius.
        if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
        settleInfo = null;
        gliding = false;
        applyAt(1);
        for (var i = 0; i < anims.length; i++) { try { anims[i].cancel(); } catch (e) {} }
        anims = [];
        finish();
    }
    // Drag writes are coalesced to one per animation frame: however
    // many move events a gesture delivers, the frame path renders the
    // latest progress once — applyAt() and nothing else.
    function queueScrub(pT) {
        pendingP = pT;
        if (scrubRaf === null) {
            scrubRaf = requestAnimationFrame(function () {
                scrubRaf = null;
                if (pendingP !== null) { var p = pendingP; pendingP = null; applyAt(p); }
            });
        }
    }
    function flushScrub() {
        if (scrubRaf !== null) { cancelAnimationFrame(scrubRaf); scrubRaf = null; }
        if (pendingP !== null) { var p = pendingP; pendingP = null; applyAt(p); }
    }
    // Release speed from the gesture's own final samples (the last
    // ~100 ms — the horizon velocity trackers use, because a flick
    // accelerates into liftoff and a longer average understates the
    // speed the hand actually let go at): a hold still before letting
    // go reads as zero, however fast the drag was earlier.
    function releaseVelocity(samples) {
        var now = performance.now();
        var s = [];
        for (var i = 0; i < samples.length; i++) {
            if (now - samples[i].t <= 100) s.push(samples[i]);
        }
        if (s.length < 2) return 0;
        var dt = (s[s.length - 1].t - s[0].t) / 1000;
        if (dt <= 0.016) return 0;
        return (s[s.length - 1].p - s[0].p) / dt;
    }
    // Letting go: a flick carries through in its own direction;
    // otherwise the halfway rule decides. Either way the settle starts
    // at the release speed (never slower than a prompt minimum), so
    // the handoff has no speed step.
    function releaseSettle(samples) {
        var v = releaseVelocity(samples);
        var to;
        if (v >= FLICK_V) to = 1;
        else if (v <= -FLICK_V) to = 0;
        else to = prog >= COMMIT_P ? 1 : 0;
        startSettle(to, Math.max(Math.abs(v), MIN_RATE));
    }
    function setLocked(on) {
        document.documentElement.classList.toggle('logo-intro-locked', on);
    }
    function finish() {
        if (done) return;
        done = true;
        gliding = false;
        if (wheelIdleTimer !== null) { clearTimeout(wheelIdleTimer); wheelIdleTimer = null; }
        if (scrubRaf !== null) { cancelAnimationFrame(scrubRaf); scrubRaf = null; }
        pendingP = null;
        setLocked(false);
        document.documentElement.classList.add('logo-intro-done');
        intro.style.pointerEvents = 'none';
        detach();
    }
    // Glide start pins the logo (and the hint) to pixel anchors. Both are
    // CSS-centred (left/top 50%), so a viewport-height change mid-gesture
    // — the iOS toolbar showing or hiding — would otherwise re-centre
    // them in the new box and jump the logo even with the morph maths
    // frozen. The pin writes exactly the box each element already
    // occupies, so the frame it lands on is unchanged; from then on only
    // the transform moves the logo.
    function pinAnchors() {
        if (start) {
            logo.style.left = start.cx + 'px';
            logo.style.top = start.cy + 'px';
        }
        if (hint) {
            var hr = hintPin || hint.getBoundingClientRect();
            hint.style.left = hr.left + 'px';
            hint.style.top = hr.top + 'px';
            hint.style.marginTop = '0';
            hint.style.transform = 'none';
        }
    }
    // Direct manipulation. The drag is ABSOLUTE, not incremental:
    // progress is a pure function of where the finger is relative to
    // where the drag began (dragStartP + (dragStartY - y) / range),
    // so reversing direction retraces the exact same mapping — no
    // hysteresis, no ratchet, no accumulated error, any number of
    // times, and nothing of any kind commits while the finger is down.
    // Holding the morph perfectly still mid-way is just a drag that
    // isn't moving: no timer runs on the touch path at all.
    var touchId = null, dragStartY = 0, dragStartP = 0, velSamples = [];
    function findTouch(e) {
        if (!e.changedTouches) return null;
        for (var i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === touchId) return e.changedTouches[i];
        }
        return null;
    }
    function onTouchStart(e) {
        if (done || touchId !== null || !e.changedTouches || !e.changedTouches.length) return;
        // A touch owns the morph outright: the wheel's idle timer dies
        // here and cannot fire while any finger is down.
        if (wheelIdleTimer !== null) { clearTimeout(wheelIdleTimer); wheelIdleTimer = null; }
        if (gliding) cancelSettle(true); // grab the morph mid-settle, no jump
        freeze();
        var t = e.changedTouches[0];
        touchId = t.identifier;
        dragStartY = t.clientY;
        dragStartP = prog;
        velSamples = [{ t: performance.now(), p: prog }];
    }
    function onTouchMove(e) {
        if (done || touchId === null) return;
        var t = findTouch(e);
        if (!t) return;
        e.preventDefault();
        var pT = clamp01(dragStartP + (dragStartY - t.clientY) / DRAG_RANGE);
        queueScrub(pT);
        velSamples.push({ t: performance.now(), p: pT });
        if (velSamples.length > 60) velSamples.shift();
    }
    function onTouchEnd(e) {
        if (touchId === null || !findTouch(e)) return;
        touchId = null;
        flushScrub(); // the release frame is the finger's exact last position
        if (done) return;
        releaseSettle(velSamples);
        velSamples = [];
    }
    // The wheel scrubs the same progress while it flows — deltas land
    // on the same 1:1 mapping — and when the flow stops (a short idle,
    // desktop only) the same release rule settles it. One synthetic
    // event is not a wheel at all: the tap-to-finish feed in index.html
    // dispatches a single wheel event with deltaY 10000, which no real
    // device emits — that is a tap, and it plays the glide.
    var wheelSamples = [];
    function normDelta(e) {
        var d = e.deltaY || 0;
        if (e.deltaMode === 1) d *= 16;                       // lines -> px
        else if (e.deltaMode === 2) d *= window.innerHeight;  // pages -> px
        return d;
    }
    function onWheel(e) {
        if (done) return; // normal scrolling resumes after the intro
        e.preventDefault();
        var d = normDelta(e);
        if (Math.abs(d) >= 1000) { startGlide(); return; }
        if (touchId !== null) return; // a held finger owns the morph
        if (gliding) cancelSettle(true);
        freeze();
        var base = pendingP !== null ? pendingP : prog;
        var pT = clamp01(base + d / DRAG_RANGE);
        queueScrub(pT);
        wheelSamples.push({ t: performance.now(), p: pT });
        if (wheelSamples.length > 60) wheelSamples.shift();
        if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
        wheelIdleTimer = setTimeout(onWheelIdle, WHEEL_IDLE_MS);
    }
    function onWheelIdle() {
        wheelIdleTimer = null;
        // Desktop wheel only: a touch that arrived meanwhile owns the
        // morph, and a running settle is already the answer.
        if (done || touchId !== null || gliding) return;
        flushScrub();
        releaseSettle(wheelSamples);
        wheelSamples = [];
    }
    function isFormTarget(t) {
        return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
            t.tagName === 'TEXTAREA' || t.isContentEditable);
    }
    function onKey(e) {
        if (done || isFormTarget(e.target)) return;
        switch (e.key) {
            case 'ArrowDown': case 'PageDown': case ' ': case 'End':
                e.preventDefault();
                startGlide();
                break;
            case 'ArrowUp': case 'PageUp': case 'Home':
                e.preventDefault();
                // After wheel play there is something to reverse: the
                // morph settles back open. At rest it stays at rest.
                if (gliding || prog > 0) startSettle(0, GLIDE_RATE);
                break;
            default: return;
        }
    }
    function onScroll() {
        // Safety net: the page must stay pinned while the intro runs. The
        // overflow lock normally makes scrolling impossible; if anything
        // still moves it (focus scroll, scrollbar drag), put it back.
        if (!done && (window.scrollY || window.pageYOffset || 0) !== 0) {
            window.scrollTo(0, 0);
        }
    }
    function onResize() {
        // iOS fires resize when the Safari toolbar shows or hides. The
        // geometry is measured once at rest and frozen when the glide
        // starts — the glide's keyframes are already computed, so a
        // resize mid-glide recomputes nothing and the logo's path
        // cannot jump. A resize before the glide (a genuine orientation
        // change) still re-measures and lands the logo correctly.
        if (started) return;
        measure();
    }
    function detach() {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        window.removeEventListener('wheel', onWheel);
        window.removeEventListener('touchstart', onTouchStart);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('touchcancel', onTouchEnd);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
    }
    measure();
    setLocked(true);
    window.__logoIntroReady = true;
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
}

/* Grab-to-scroll (2026-11-18): every plain sideways-scrolling surface
   marked data-grab-scroll can be dragged sideways with the mouse, the
   way you drag a map. Mouse only — touch and pen keep their native
   scrolling. A press that moves less than the threshold is an ordinary
   click, so badges, buttons and links inside keep working exactly as
   before; only a real drag eats the click its release would fire. The
   grab cursor shows only while the surface actually overflows. */
(function () {
    'use strict';
    var THRESHOLD = 5;

    var style = document.createElement('style');
    style.textContent =
        '[data-grab-scroll].gs-overflow{cursor:grab}' +
        '[data-grab-scroll].gs-dragging{cursor:grabbing!important;-webkit-user-select:none;user-select:none}' +
        '[data-grab-scroll].gs-dragging *{cursor:grabbing!important}';
    document.head.appendChild(style);

    function refresh(el) {
        el.classList.toggle('gs-overflow', el.scrollWidth - el.clientWidth > 1);
    }

    function arm(el) {
        var down = null;
        refresh(el);
        if (window.MutationObserver) {
            new MutationObserver(function () { refresh(el); }).observe(el, { childList: true, subtree: true });
        }
        el.addEventListener('pointerdown', function (e) {
            if (e.pointerType !== 'mouse' || e.button !== 0 || !e.isPrimary) return;
            down = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: el.scrollLeft, dragging: false };
        });
        el.addEventListener('pointermove', function (e) {
            if (!down || e.pointerId !== down.id) return;
            var dx = e.clientX - down.x;
            var dy = e.clientY - down.y;
            if (!down.dragging) {
                if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
                if (Math.abs(dy) > Math.abs(dx)) { down = null; return; }
                down.dragging = true;
                el.classList.add('gs-dragging');
                try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety, not a requirement */ }
            }
            el.scrollLeft = down.sl - dx;
            if (e.cancelable) e.preventDefault();
        });
        function end(e) {
            if (!down || e.pointerId !== down.id) return;
            var wasDragging = down.dragging;
            down = null;
            el.classList.remove('gs-dragging');
            if (!wasDragging) return;
            // Eat the click this release would otherwise fire (it lands on
            // the container or its content), and only that click.
            var eat = function (ev) {
                if (ev.target === el || el.contains(ev.target)) {
                    ev.stopPropagation();
                    ev.preventDefault();
                }
                document.removeEventListener('click', eat, true);
            };
            document.addEventListener('click', eat, true);
            setTimeout(function () { document.removeEventListener('click', eat, true); }, 350);
        }
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('dragstart', function (e) { if (down) e.preventDefault(); });
    }

    function init() {
        var els = document.querySelectorAll('[data-grab-scroll]');
        var i;
        for (i = 0; i < els.length; i++) arm(els[i]);
        window.addEventListener('resize', function () {
            for (var j = 0; j < els.length; j++) refresh(els[j]);
        });
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                for (var k = 0; k < els.length; k++) refresh(els[k]);
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

/* Scroll anchor (2026-11-23): ONE mechanism for the whole site --
   true scrolling for every in-flow expander, collapsible and panel.
   When a toggle opens or closes a block in the page flow, the
   document's height changes around the reader; without an anchor,
   collapsing a tall block shrinks the page and the browser clamps
   the scroll position, dumping the reader at the page bottom (the
   Finance "Under 20 trading days" recording). The mechanism: on a
   toggle click (capture phase, before anything changes), record
   the viewport position of the toggling control and of the
   fallbacks that identify the same section (its panel, every
   control wired to that panel, the section's own header). After
   the change -- across the frames and the height transitions that
   follow -- correct the scroll by the first surviving anchor's
   delta, so the point the reader is looking at sits exactly where
   it sat (±1px). A reader who grabs the scroll themselves (wheel
   or touch) cancels the correction at once; the mechanism never
   fights a deliberate scroll. Door cards are navigation, not
   expanders -- they are excluded, and panels that float (fixed or
   absolute) never change the document's height, so the mechanism
   measures a zero delta and stays inert for them. */
(function () {
    'use strict';
    var TOGGLE_SEL = 'summary, .info-toggle, button[aria-expanded], [data-anchor-toggle]';
    function visible(el) {
        if (!el || !el.isConnected) return false;
        var cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
    }
    function panelFor(t) {
        var panel = null;
        var cid = t.getAttribute ? t.getAttribute('aria-controls') : null;
        if (cid) panel = document.getElementById(cid);
        if (!panel && t.tagName === 'SUMMARY') panel = t.parentElement;
        if (!panel) {
            var oc = t.getAttribute ? t.getAttribute('onclick') : null;
            var m = oc ? oc.match(/'([A-Za-z0-9_-]+)'/) : null;
            if (m) panel = document.getElementById(m[1]);
        }
        return panel;
    }
    function candidatesFor(t) {
        var list = [];
        function push(el) { if (el && list.indexOf(el) === -1) list.push(el); }
        push(t);
        var panel = panelFor(t);
        push(panel);
        if (panel && panel.id) {
            var ctrls = document.querySelectorAll('[aria-controls="' + panel.id + '"]');
            for (var i = 0; i < ctrls.length; i++) push(ctrls[i]);
            var wrap = panel.closest ? panel.closest('.explainer-wrapper, section, details, .card') : null;
            if (wrap) {
                push(wrap.querySelector('.info-toggle, summary'));
                push(wrap);
            }
        }
        return list;
    }
    document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest(TOGGLE_SEL) : null;
        if (!t) return;
        if (t.classList.contains('door-card') || t.closest('[data-anchor-skip]')) return;
        /* A door's section toggle is clicked synthetically by its door
           card, so the click that reaches this handler names the inner
           toggle, not the door -- resolve the panel and apply the same
           door exclusion, or the corrections fight the door's own
           glide and close-restore on every door toggle. */
        var doorPanel = panelFor(t);
        if (doorPanel && doorPanel.id && document.querySelector('.door-card[aria-controls="' + doorPanel.id + '"]')) return;
        var cands = [];
        candidatesFor(t).forEach(function (el) {
            if (visible(el)) cands.push({ el: el, top: el.getBoundingClientRect().top });
        });
        if (!cands.length) return;
        var cancelled = false;
        function cancel() { cancelled = true; }
        window.addEventListener('wheel', cancel, { passive: true });
        window.addEventListener('touchmove', cancel, { passive: true });
        [0, 60, 180, 360, 560].forEach(function (delay) {
            setTimeout(function () {
                if (cancelled) return;
                for (var i = 0; i < cands.length; i++) {
                    if (!visible(cands[i].el)) continue;
                    var d = cands[i].el.getBoundingClientRect().top - cands[i].top;
                    if (Math.abs(d) > 0.5) window.scrollBy(0, d);
                    break;
                }
            }, delay);
        });
        setTimeout(function () {
            window.removeEventListener('wheel', cancel);
            window.removeEventListener('touchmove', cancel);
        }, 750);
    }, true);
})();
