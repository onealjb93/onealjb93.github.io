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

document.addEventListener('DOMContentLoaded', function () {
    initThemeToggle();
    initNavDropdown();
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
   overlay fades fast (gone by ~25% of progress, eased) while the logo
   keeps shrinking across the full range and stays fully opaque, so the
   page shows through almost as soon as scrolling starts. */
function initLogoIntro() {
    var intro = document.getElementById('logo-intro');
    if (!intro) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // One-shot: if the page loads already scrolled, skip the intro — the
    // logo is already in the header.
    if ((window.scrollY || window.pageYOffset || 0) > 0) {
        document.documentElement.classList.remove('logo-intro-on');
        window.__logoIntroReady = true;
        return;
    }
    var logo = document.getElementById('logo-intro-logo');
    var bg = intro.querySelector('.logo-intro-bg');
    var brand = document.querySelector('.site-brand-logo');
    if (!logo || !bg || !brand) return;
    document.documentElement.classList.add('logo-intro-on');
    var range = 0, start = null, target = null, ticking = false;
    var vy = 0;       // virtual scroll px accumulated from input, 0..range
    var done = false; // one-shot: once landed, the intro never re-engages
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function measure() {
        range = Math.max(window.innerHeight * 0.9, 320);
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
        ticking = false;
        if (!start || !target) return;
        var p = clamp01(vy / range);
        var e = smooth(p);
        var scale = 1 + (target.size / start.size - 1) * e;
        var dx = (target.cx - start.cx) * e;
        var dy = (target.cy - start.cy) * e;
        logo.style.transform = 'translate3d(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + dy.toFixed(1) + 'px), 0) scale(' + scale.toFixed(4) + ')';
        // Green overlay fades fast and is decoupled from the logo: gone by
        // ~25% of progress (eased). The logo keeps shrinking across the
        // full range and stays fully opaque throughout.
        var bgOpacity = 1 - smooth(clamp01(p / 0.25));
        bg.style.opacity = bgOpacity.toFixed(3);
        intro.style.pointerEvents = bgOpacity <= 0 ? 'none' : 'auto';
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
    function queue() {
        if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    }
    function advance(d) {
        if (done) return;
        vy = Math.max(0, Math.min(range, vy + d));
        queue();
        if (vy >= range) finish();
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
    function onResize() { measure(); }
    function detach() {
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
