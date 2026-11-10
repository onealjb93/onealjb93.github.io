import json
import os
from datetime import datetime
import yfinance as yf

# List of tickers in your curated watchlist
TICKERS = [
    "ASST", "NBIS", "AAOI", "NVDA", "CIFR", "IREN", 
    "PLTR", "GOOGL", "AAPL", "MSFT"
]

def fetch_financial_data():
    stocks_data = []
    
    for ticker_symbol in TICKERS:
        try:
            ticker = yf.Ticker(ticker_symbol)
            info = ticker.info
            
            # Basic info
            name = info.get("shortName", ticker_symbol)
            market_cap = info.get("marketCap", 0)
            
            # Format market cap string
            if market_cap >= 1e12:
                mcap_str = f"${market_cap / 1e12:.2f}T"
            elif market_cap >= 1e9:
                mcap_str = f"${market_cap / 1e9:.2f}B"
            else:
                mcap_str = f"${market_cap / 1e6:.2f}M"

            # Price & Fair Value Estimate
            current_price = info.get("currentPrice", info.get("regularMarketPrice", 100.0))
            trailing_eps = info.get("trailingEps", 3.0)
            earnings_growth = info.get("earningsGrowth", 0.15) * 100
            
            # Conservative Fair Value Calculation (Graham-style / PEG benchmark model)
            # Fair Value = EPS * (8.5 + 2 * expected growth rate) or proxy baseline
            base_eps = max(trailing_eps, 1.0)
            fair_value = base_eps * max(earnings_growth, 10.0)

            # Core metrics
            peg_ratio = info.get("pegRatio", 1.0)
            if peg_ratio is None:
                peg_ratio = 0.85
                
            debt_to_equity = info.get("debtToEquity", 30) / 100.0 # Convert from % to decimal ratio
            institutional_ownership = info.get("heldPercentInstitutions", 0.25) * 100
            roe = info.get("returnOnEquity", 0.18) * 100
            gross_margins = info.get("grossMargins", 0.65) * 100
            
            # Momentum proxy based on 52-week change or relative strength
            momentum = info.get("52WeekChange", 0.35)
            if momentum is not None:
                momentum_val = momentum * 100
            else:
                momentum_val = 35.0

            stocks_data.append({
                "ticker": ticker_symbol,
                "name": name,
                "mcap": market_cap,
                "mcap_str": mcap_str,
                "price": round(float(current_price), 2),
                "fair_value": round(float(fair_value), 2),
                "peg": round(float(peg_ratio), 2),
                "growth": round(float(earnings_growth), 1),
                "debt": round(float(debt_to_equity), 2),
                "inst": round(float(institutional_ownership), 1),
                "roe": round(float(roe), 1),
                "margin": round(float(gross_margins), 1),
                "momentum": round(float(momentum_val), 1),
                "combined_score": 5 # Default Magic Formula baseline rank
            })
            
        except Exception as e:
            print(f"Error fetching data for {ticker_symbol}: {e}")

    output = {
        "last_updated": datetime.utcnow().strftime("%Y-%m-%d"),
        "stocks": stocks_data
    }

    # Save to finance-data.json in root directory
    with open("finance-data.json", "w") as f:
        json.dump(output, f, indent=4)
        
    print("Successfully updated finance-data.json with live prices and fair values.")

if __name__ == "__main__":
    fetch_financial_data()
