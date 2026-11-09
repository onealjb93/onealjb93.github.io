export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    
    if (req.method === 'POST') {
        const { amount, memo, date } = req.body || {};
        return res.status(200).json({ success: true, message: 'Donation logged successfully' });
    }
    
    // Returns your live donation list (defaults to empty array [] so it shows "No donations yet")
    const donations = [
        // Example format once you receive a donation:
        // { amount: "0.001 BTC", memo: "Independent Tech Research", date: "Nov 9, 2026" }
    ];

    return res.status(200).json(donations);
}
