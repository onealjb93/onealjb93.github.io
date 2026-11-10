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

document.addEventListener('DOMContentLoaded', loadFinancialData);
