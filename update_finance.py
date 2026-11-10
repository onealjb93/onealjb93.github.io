import json
import datetime
import yfinance as yf

def update_data():
    with open('finance-data.json', 'r') as f:
        data = json.load(f)

    for item in data['stocks']:
        ticker_symbol = item['ticker']
        try:
            stock = yf.Ticker(ticker_symbol)
            info = stock.info
            
            # Fetch and update live metrics if available
            market_cap = info.get('marketCap')
            if market_cap:
                item['mcap'] = market_cap / 1e9 # stored in billions for sorting
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
            print(f"Skipping {ticker_symbol} due to error: {e}")

    data['last_updated'] = datetime.datetime.utcnow().strftime('%Y-%m-%d')

    with open('finance-data.json', 'w') as f:
        json.dump(data, f, indent=2)

if __name__ == '__main__':
    update_data()
