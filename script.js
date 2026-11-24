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
   shows the JBO logo centered; scrolling down shrinks it into the 32px
   header logo while the page stays pinned at scrollY 0, so when the logo
   lands, normal scrolling starts from the very top of the page (header,
   name, About Me). Once the logo has landed the intro is done for the
   session and never comes back — scrolling back to the top does not
   re-trigger it. If the page loads already scrolled (refresh mid-page,
   anchor, back / forward), the intro is skipped entirely and the logo is
   already in the header. transform/opacity only, via rAF. Skipped when
   the visitor prefers reduced motion. The header logo's landing spot is
   measured at runtime (its at-rest position at the top of the page), so
   it lands exactly on the header logo in both themes and on mobile. The green
   overlay fades across most of the morph (gone by ~75% of progress,
   ease-out cubic) while the logo keeps shrinking across the full range
   and stays fully opaque, so the page shows through almost as soon as
   scrolling starts but the green melts away instead of snapping off.
   Motion model: scroll input accumulates into a *target* progress; a
   continuous rAF loop eases the rendered progress toward it with
   frame-rate-independent damping (the Lenis / GSAP-scrub pattern), so
   stepped mouse-wheel notches become one smooth glide and the logo and
   the green move as a single gesture on one master progress.
   Settle-once (2026-11-24): the morph scrubs freely only up to a commit
   point at half the range — past it the target pins to the end of the
   range and the glide runs into the landing, so input can never reverse
   the intro back over content it had already revealed. The landing
   geometry is measured once at rest and frozen at the first input, and
   the logo and hint are pinned to pixel anchors, so an iOS toolbar
   resize mid-gesture cannot move the anchors and jump the logo. The
   "Scroll to start" hint is written from the same master progress on
   this frame path (no MutationObserver re-deriving it). */
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
    var range = 0, start = null, target = null;
    var vyTarget = 0; // virtual scroll px accumulated from input, 0..range
    var vy = 0;       // rendered progress: eased toward vyTarget every frame
    var done = false; // one-shot: once landed, the intro never re-engages
    var committed = false; // settle-once: past the commit point the morph
                           // only ever runs forward into its landing
    var started = false;   // first input freezes the measured geometry
    var rafId = null, lastTs = null;
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function measure() {
        range = Math.max(window.innerHeight * 0.16, 120);
        // Start = the logo's centered position, read from the overlay's
        // own rect (robust to viewport/scrollbar quirks — never assume
        // innerWidth / 2 is the visual center).
        var ir = intro.getBoundingClientRect();
        start = { cx: ir.left + ir.width / 2, cy: ir.top + ir.height / 2, size: logo.offsetWidth };
        // The page stays pinned at scrollY 0 while the intro runs, so the
        // landing spot is the brand's at-rest position in the viewport at
        // the top of the page (not its stuck position once the nav pins
        // on scroll — the nav only sticks after the intro is done).
        var b = brand.getBoundingClientRect();
        target = {
            cx: b.left + b.width / 2,
            cy: b.top + b.height / 2,
            size: b.width
        };
        apply();
    }
    function apply() {
        if (!start || !target) return;
        var p = clamp01(vy / range);
        var e = smooth(p);
        var scale = 1 + (target.size / start.size - 1) * e;
        var dx = (target.cx - start.cx) * e;
        var dy = (target.cy - start.cy) * e;
        logo.style.transform = 'translate3d(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + dy.toFixed(1) + 'px), 0) scale(' + scale.toFixed(4) + ')';
        // Green overlay fades across most of the morph, phased with the
        // logo on the same master progress: ease-out cubic over the first
        // ~75% of progress. It starts fading immediately (at p = 0.1 the
        // green is already ~65%, so the page shows through right away),
        // but the tail is gentle — ease-out cubic's slope is 0 at the end,
        // so the last of the green melts away with no hard edge at zero.
        // The old 25% window made one wheel notch drop the green from 1 to
        // ~0.5 in a single frame while the logo had barely moved: the pop
        // the user called glitchy.
        var bgOpacity = 1 - easeOutCubic(clamp01(p / 0.75));
        bg.style.opacity = bgOpacity.toFixed(3);
        // "Scroll to start" rides the same master progress: full at rest
        // (its CSS base opacity), gone by p = 0.35, early in the morph.
        // Written here on the frame path; the previous inline script
        // re-derived p from the bg opacity write via a MutationObserver
        // firing on every frame — observer work on the frame path.
        if (hint) hint.style.opacity = (0.75 * (1 - clamp01(p / 0.35))).toFixed(3);
        var pe = bgOpacity <= 0.02 ? 'none' : 'auto';
        if (intro.style.pointerEvents !== pe) intro.style.pointerEvents = pe;
    }
    // Damped render loop (Lenis / GSAP-scrub pattern): input sets the
    // target, the loop eases the rendered value toward it every frame,
    // scaled by frame delta so the feel is identical at 30/60/120 Hz.
    // lambda ~9/s: ~110 ms time constant, settles in ~250 ms — the
    // momentum-settle that makes stepped wheel notches read as one glide.
    function tick(ts) {
        rafId = null;
        if (done) return;
        if (lastTs === null) lastTs = ts;
        var dt = Math.max(0, Math.min(64, ts - lastTs));
        lastTs = ts;
        var k = 1 - Math.exp(-dt * 0.009);
        vy += (vyTarget - vy) * k;
        // Settle once: at half the range the green is ~96% gone and the
        // logo is more than halfway home — from there the morph commits.
        // The old code stayed reversible all the way to p = 1, so the
        // band between the green reaching zero (p = 0.75) and the finish
        // looked fully settled yet any upward swipe reversed it and the
        // whole intro — green, logo, hint — popped back over the page
        // (Johnny's video, 2026-11-24). Committing here closes that band:
        // the glide simply runs the remaining half into the landing.
        if (!committed && vy >= range * 0.5) {
            committed = true;
            vyTarget = range;
        }
        if (vyTarget >= range && range - vy < 0.5) {
            vy = range;
            apply();
            finish();
            return;
        }
        apply();
        if (Math.abs(vyTarget - vy) > 0.05) {
            rafId = requestAnimationFrame(tick);
        } else {
            vy = vyTarget;
            apply();
        }
    }
    function ensureLoop() {
        if (rafId === null && !done) {
            lastTs = null;
            rafId = requestAnimationFrame(tick);
        }
    }
    function setLocked(on) {
        document.documentElement.classList.toggle('logo-intro-locked', on);
    }
    function finish() {
        if (done) return;
        done = true;
        vy = range;
        apply();
        setLocked(false);
        document.documentElement.classList.add('logo-intro-done');
        intro.style.pointerEvents = 'none';
        detach();
    }
    // First input pins the logo (and the hint) to pixel anchors. Both are
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
            var hr = hint.getBoundingClientRect();
            hint.style.left = hr.left + 'px';
            hint.style.top = hr.top + 'px';
            hint.style.marginTop = '0';
            hint.style.transform = 'none';
        }
    }
    function advance(d) {
        if (done) return;
        if (!started) { started = true; pinAnchors(); } // geometry freezes
        if (committed) { // settled-ward only: input can no longer reverse
            vyTarget = range;
            ensureLoop();
            return;
        }
        vyTarget = Math.max(0, Math.min(range, vyTarget + d));
        ensureLoop();
    }
    function normDelta(e) {
        var d = e.deltaY || 0;
        if (e.deltaMode === 1) d *= 16;                       // lines -> px
        else if (e.deltaMode === 2) d *= window.innerHeight;  // pages -> px
        return d;
    }
    function onWheel(e) {
        if (done) return; // normal scrolling resumes after the intro
        e.preventDefault();
        advance(normDelta(e));
    }
    var lastTouchY = null;
    function onTouchStart(e) {
        if (done || !e.touches || !e.touches.length) return;
        lastTouchY = e.touches[0].clientY;
    }
    function onTouchMove(e) {
        if (done || lastTouchY === null || !e.touches || !e.touches.length) return;
        e.preventDefault();
        var y = e.touches[0].clientY;
        advance(lastTouchY - y); // swipe up = scroll down = morph forward
        lastTouchY = y;
    }
    function onTouchEnd() { lastTouchY = null; }
    function isFormTarget(t) {
        return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
            t.tagName === 'TEXTAREA' || t.isContentEditable);
    }
    function onKey(e) {
        if (done || isFormTarget(e.target)) return;
        var step = 0;
        switch (e.key) {
            case 'ArrowDown': step = 120; break;
            case 'PageDown': case ' ': step = Math.round(window.innerHeight * 0.9); break;
            case 'End': step = range; break;
            case 'ArrowUp': step = -120; break;
            case 'PageUp': step = -Math.round(window.innerHeight * 0.9); break;
            case 'Home': step = -range; break;
            default: return;
        }
        e.preventDefault();
        advance(step);
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
        // iOS fires resize when the Safari toolbar shows or hides during
        // a drag. Re-measuring then recomputes the range (a fraction of
        // innerHeight) and both anchor rects mid-morph, so the progress
        // and the logo's path jump in a single frame. The geometry is
        // measured once at rest and frozen at the first input; a resize
        // before any input (a genuine orientation change) still lands
        // the logo correctly.
        if (started) return;
        measure();
    }
    function detach() {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        window.removeEventListener('wheel', onWheel);
        window.removeEventListener('touchstart', onTouchStart);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
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
