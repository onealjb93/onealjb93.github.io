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
    loadFinancialData();
});
