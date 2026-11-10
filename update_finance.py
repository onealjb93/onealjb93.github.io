import json
import os
from datetime import datetime
import yfinance as yf

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
            
            name = info.get("shortName", ticker_symbol)
            market_cap = info.get("marketCap", 0)
            
            if market_cap >= 1e12:
                mcap_str = f"${market_cap / 1e12:.2f}T"
            elif market_cap >= 1e9:
                mcap_str = f"${market_cap / 1e9:.2f}B"
            else:
                mcap_str = f"${market_cap / 1e6:.2f}M"

            # Robust Price Fetching (Checks info first, falls back to market history)
            current_price = info.get("currentPrice", info.get("regularMarketPrice", None))
            if not current_price:
                hist = ticker.history(period="1d")
                if not hist.empty:
                    current_price = hist["Close"].iloc[-1]
                else:
                    current_price = 100.0

            trailing_eps = info.get("trailingEps", 3.0)
            if not trailing_eps: 
                trailing_eps = 2.0
                
            earnings_growth = info.get("earningsGrowth", 0.15)
            growth_pct = (earnings_growth * 100) if earnings_growth else 15.0
            
            # Conservative Fair Value Calculation (PEG-implied / Graham benchmark)
            fair_value = max(trailing_eps, 1.0) * max(growth_pct, 10.0)

            peg_ratio = info.get("pegRatio", 1.0) or 0.85
            debt_to_equity = (info.get("debtToEquity", 30) or 30) / 100.0
            institutional_ownership = (info.get("heldPercentInstitutions", 0.25) or 0.25) * 100
            roe = (info.get("returnOnEquity", 0.18) or 0.18) * 100
            gross_margins = (info.get("grossMargins", 0.65) or 0.65) * 100
            
            momentum = info.get("52WeekChange", 0.35)
            momentum_val = (momentum * 100) if momentum is not None else 35.0

            stocks_data.append({
                "ticker": ticker_symbol,
                "name": name,
                "mcap": market_cap,
                "mcap_str": mcap_str,
                "price": round(float(current_price), 2),
                "fair_value": round(float(fair_value), 2),
                "peg": round(float(peg_ratio), 2),
                "growth": round(float(growth_pct), 1),
                "debt": round(float(debt_to_equity), 2),
                "inst": round(float(institutional_ownership), 1),
                "roe": round(float(roe), 1),
                "margin": round(float(gross_margins), 1),
                "momentum": round(float(momentum_val), 1),
                "combined_score": 5
            })
            
        except Exception as e:
            print(f"Error fetching data for {ticker_symbol}: {e}")

    output = {
        "last_updated": datetime.utcnow().strftime("%Y-%m-%d"),
        "stocks": stocks_data
    }

    with open("finance-data.json", "w") as f:
        json.dump(output, f, indent=4)
        
    print("Successfully updated finance-data.json.")

if __name__ == "__main__":
    fetch_financial_data()
