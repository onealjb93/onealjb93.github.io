import json
import datetime
import os
import urllib.request

# Reads your API key securely from GitHub Actions environment secrets
API_KEY = os.environ.get('API_KEY', 'demo')

# Manual baselines for private or specialized assets where public APIs do not stream live tickers
MANUAL_OVERRIDES = {
    "SPCX": { "mcap": 1930.0, "mcap_str": "$1.93T", "peg": 1.15, "growth": 30.00, "debt": 0.05, "inst": 12.50 },
    "ASST": { "mcap": 2.7, "mcap_str": "$2.70B", "peg": 0.95, "growth": 42.10, "debt": 0.10, "inst": 18.20 }
}

def fetch_json(url):
    try:
        with urllib.request.urlopen(url) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Network error: {e}")
        return None

def update_data():
    with open('finance-data.json', 'r') as f:
        data = json.load(f)

    for item in data['stocks']:
        ticker = item['ticker']
        
        # Apply manual baselines for private/special assets immediately
        if ticker in MANUAL_OVERRIDES:
            item.update(MANUAL_OVERRIDES[ticker])
            print(f"Applied manual baseline for {ticker}")
            continue

        # Fetch real-time company overview from Alpha Vantage free endpoint
        url = f"https://www.alphavantage.co/query?function=OVERVIEW&symbol={ticker}&apikey={API_KEY}"
        result = fetch_json(url)

        if result and 'MarketCapitalization' in result and result['MarketCapitalization'] != 'None':
            try:
                market_cap = float(result['MarketCapitalization'])
                item['mcap'] = market_cap / 1e9
                if market_cap >= 1e12:
                    item['mcap_str'] = f"${market_cap/1e12:.2f}T"
                else:
                    item['mcap_str'] = f"${market_cap/1e9:.2f}B"

                if result.get('PEGRatio') and result['PEGRatio'] != 'None':
                    item['peg'] = round(float(result['PEGRatio']), 2)
                if result.get('QuarterlyEarningsGrowthYOY') and result['QuarterlyEarningsGrowthYOY'] != 'None':
                    item['growth'] = round(float(result['QuarterlyEarningsGrowthYOY']) * 100, 2)
                if result.get('DebtToEquityTTC') and result['DebtToEquityTTC'] != 'None':
                    item['debt'] = round(float(result['DebtToEquityTTC']) / 100, 2)
                if result.get('PercentInstitutions') and result['PercentInstitutions'] != 'None':
                    item['inst'] = round(float(result['PercentInstitutions']) * 100, 2)

                print(f"Successfully updated live data for {ticker}")
            except Exception as parse_err:
                print(f"Error parsing data fields for {ticker}: {parse_err}")
        else:
            print(f"API limit reached or invalid symbol returned for {ticker}. Keeping existing data.")

    data['last_updated'] = datetime.datetime.utcnow().strftime('%Y-%m-%d')

    with open('finance-data.json', 'w') as f:
        json.dump(data, f, indent=2)

if __name__ == '__main__':
    update_data()
