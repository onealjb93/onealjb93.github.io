import json
import datetime
import yfinance as yf

# Manual overrides to lock in verified caps/metrics for micro-caps or private assets
MANUAL_OVERRIDES = {
    "ASST": { "mcap": 2.7, "mcap_str": "$2.70B" },
    "SPCX": { "mcap": 1930.0, "mcap_str": "$1.93T" }
}

def update_data():
    with open('finance-data.json', 'r') as f:
        data = json.load(f)

    for item in data['stocks']:
        ticker_symbol = item['ticker']
        
        # Apply overrides immediately if defined
        if ticker_symbol in MANUAL_OVERRIDES:
            item['mcap'] = MANUAL_OVERRIDES[ticker_symbol]['mcap']
            item['mcap_str'] = MANUAL_OVERRIDES[ticker_symbol]['mcap_str']

        try:
            stock = yf.Ticker(ticker_symbol)
            info = stock.info
            
            market_cap = info.get('marketCap')
            if market_cap and ticker_symbol not in MANUAL_OVERRIDES:
                item['mcap'] = market_cap / 1e9
                if market_cap >= 1e12:
                    item['mcap_str'] = f"${market_cap/1e12:.2f}T"
                else:
                    item['mcap_str'] = f"${market_cap/1e9:.2f}B"
            
            if info.get('pegRatio'):
                item['peg'] = round(info.get('pegRatio'), 2)
            if info.get('earningsGrowth'):
                item['growth'] = round(info.get('earningsGrowth') * 100, 2)
            if info.get('debtToEquity'):
                item['debt'] = round(info.get('debtToEquity') / 100, 2)
            if info.get('heldPercentInstitutions'):
                item['inst'] = round(info.get('heldPercentInstitutions') * 100, 2)
                
            print(f"Successfully updated {ticker_symbol}")
        except Exception as e:
            print(f"Skipping API fetch for {ticker_symbol} due to error: {e}")

    data['last_updated'] = datetime.datetime.utcnow().strftime('%Y-%m-%d')

    with open('finance-data.json', 'w') as f:
        json.dump(data, f, indent=2)

if __name__ == '__main__':
    update_data()
