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
            
            # Fast-path for private or unique assets like SpaceX
            if ticker_symbol == "SPCX":
                item['mcap'] = 1930.0
                item['mcap_str'] = "$1.93T"
                continue

            # Pull live fast info or general info dictionary
            fi = stock.fast_info
            market_cap = getattr(fi, 'market_cap', None)
            
            # Fallback to standard info if fast_info is missing
            if not market_cap:
                info = stock.info
                market_cap = info.get('marketCap')
                if info.get('pegRatio'):
                    item['peg'] = round(info.get('pegRatio'), 2)
                if info.get('earningsGrowth'):
                    item['growth'] = round(info.get('earningsGrowth') * 100, 2)
                if info.get('debtToEquity'):
                    item['debt'] = round(info.get('debtToEquity') / 100, 2)
                if info.get('heldPercentInstitutions'):
                    item['inst'] = round(info.get('heldPercentInstitutions') * 100, 2)

            if market_cap:
                item['mcap'] = market_cap / 1e9
                if market_cap >= 1e12:
                    item['mcap_str'] = f"${market_cap/1e12:.2f}T"
                else:
                    item['mcap_str'] = f"${market_cap/1e9:.2f}B"
                
            print(f"Successfully updated {ticker_symbol} -> Market Cap: {item['mcap_str']}")
        except Exception as e:
            print(f"Error updating {ticker_symbol}: {e}")

    data['last_updated'] = datetime.datetime.utcnow().strftime('%Y-%m-%d')

    with open('finance-data.json', 'w') as f:
        json.dump(data, f, indent=2)

if __name__ == '__main__':
    update_data()
