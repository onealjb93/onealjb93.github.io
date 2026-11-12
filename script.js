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

/* Homepage logo intro: full-viewport JBO logo that scroll-scrubs into the
   32px header logo (index.html only — runs only when #logo-intro exists).
   Scrolling down shrinks the logo into the top-left header spot; scrolling
   back up grows it again. transform/opacity only, via rAF. Skipped when
   the visitor prefers reduced motion. The header logo's landing spot is
   measured at runtime (its stuck position once the nav pins), so it lands
   exactly on the header logo in both themes and on mobile. */
function initLogoIntro() {
    var intro = document.getElementById('logo-intro');
    if (!intro) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var logo = document.getElementById('logo-intro-logo');
    var bg = intro.querySelector('.logo-intro-bg');
    var brand = document.querySelector('.site-brand-logo');
    if (!logo || !bg || !brand) return;
    document.documentElement.classList.add('logo-intro-on');
    var nav = brand.closest('.site-nav');
    var range = 0, start = null, target = null, ticking = false;
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function measure() {
        range = Math.max(window.innerHeight * 0.9, 320);
        start = { cx: window.innerWidth / 2, cy: window.innerHeight / 2, size: logo.offsetWidth };
        var b = brand.getBoundingClientRect();
        var sy = window.scrollY || window.pageYOffset || 0;
        var navTop = nav ? nav.getBoundingClientRect().top + sy : 0;
        target = {
            cx: b.left + b.width / 2,
            cy: (b.top + sy + b.height / 2) - navTop,
            size: b.width
        };
        update();
    }
    function update() {
        ticking = false;
        if (!start || !target) return;
        var sy = window.scrollY || window.pageYOffset || 0;
        var p = clamp01(sy / range);
        var e = smooth(p);
        var scale = 1 + (target.size / start.size - 1) * e;
        var dx = (target.cx - start.cx) * e;
        var dy = (target.cy - start.cy) * e;
        logo.style.transform = 'translate3d(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + dy.toFixed(1) + 'px), 0) scale(' + scale.toFixed(4) + ')';
        var fade = clamp01((p - 0.45) / 0.5);
        var bgOpacity = 1 - smooth(fade);
        bg.style.opacity = bgOpacity.toFixed(3);
        intro.style.pointerEvents = bgOpacity <= 0 ? 'none' : 'auto';
    }
    function onScroll() {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    measure();
    window.__logoIntroReady = true;
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { measure(); });
}
