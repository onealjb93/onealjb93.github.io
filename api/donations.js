function loadDonationHistory() {
    const feedList = document.getElementById('donation-feed-list');
    if (!feedList) return;

    fetch('https://your-vercel-project-name.vercel.app/api/donations') 
        .then(response => response.json())
        .then(donations => {
            feedList.innerHTML = '';
            if (!donations || donations.length === 0) {
                feedList.innerHTML = '<li class="donation-empty">No donations yet</li>';
                return;
            }
            donations.forEach(d => {
                const li = document.createElement('li');
                li.className = 'donation-item';
                li.innerHTML = `<span><strong>${d.amount}</strong> (${d.memo || 'General Support'})</span><span style="font-size:0.75rem; color:var(--subtext-color);">${d.date}</span>`;
                feedList.appendChild(li);
            });
        })
        .catch(() => {
            feedList.innerHTML = '<li class="donation-empty">No donations yet</li>';
        });
}
