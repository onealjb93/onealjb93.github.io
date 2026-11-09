// Gravitational Cursor Effect Tracker
document.addEventListener('mousemove', (e) => {
    const x = e.clientX + 'px';
    const y = e.clientY + 'px';
    document.documentElement.style.setProperty('--x', x);
    document.documentElement.style.setProperty('--y', y);
});

// Replace with your exact receiving Bitcoin address
const MY_BTC_ADDRESS = "YOUR_ACTUAL_BITCOIN_ADDRESS_HERE";

async function fetchRealDonations() {
    const container = document.getElementById('supporters-list');
    
    try {
        const response = await fetch(`https://mempool.space/api/address/${MY_BTC_ADDRESS}/txs`);
        
        if (!response.ok) {
            throw new Error("Failed to fetch transaction data.");
        }

        const transactions = await response.json();
        const realDonations = [];
        
        transactions.forEach(tx => {
            if (tx.vout && Array.isArray(tx.vout)) {
                tx.vout.forEach(output => {
                    if (output.scriptpubkey_address === MY_BTC_ADDRESS) {
                        const amountBtc = output.value / 100000000; // Satoshis to BTC
                        const blockTime = tx.status && tx.status.block_time ? tx.status.block_time * 1000 : Date.now();
                        const date = new Date(blockTime).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                        });
                        
                        realDonations.push({
                            amount: `${amountBtc} BTC`,
                            date: date,
                            txid: tx.txid
                        });
                    }
                });
            }
        });

        if (realDonations.length === 0) {
            container.innerHTML = '<p class="no-donations">No donations yet.</p>';
            return;
        }

        let html = '<ul class="supporters-ul">';
        realDonations.slice(0, 5).forEach(don => {
            html += `<li>
                        <span>Donation: <strong>${don.amount}</strong></span>
                        <span class="tx-date">${don.date}</span>
                     </li>`;
        });
        html += '</ul>';
        
        container.innerHTML = html;

    } catch (error) {
        console.error("Error connecting to blockchain explorer:", error);
        container.innerHTML = '<p class="no-donations">No donations yet.</p>';
    }
}

// Run on load
fetchRealDonations();
