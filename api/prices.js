// api/prices.js — Vercel serverless function
// Fetches live prices from Yahoo Finance (no API key needed)

const SYMBOLS = [
  'DX-Y.NYB',   // DXY
  '^TNX',       // US 10Y yield
  '^VIX',       // VIX
  '^GSPC',      // S&P 500
  '^IXIC',      // Nasdaq
  '^DJI',       // Dow
  'GC=F',       // Gold futures
  'SI=F',       // Silver futures
  'BZ=F',       // Brent
  'CL=F',       // WTI
  'BTC-USD',    // Bitcoin
  'ETH-USD',    // Ethereum
  'EURUSD=X',
  'GBPUSD=X',
  'JPY=X',      // USDJPY
  'AUDUSD=X',
  'CAD=X',      // USDCAD
  'CHF=X',      // USDCHF
  'NZDUSD=X',
  'EURGBP=X',
  'EURJPY=X',
  'GBPJPY=X',
  'AUDJPY=X',
  'CADJPY=X'
];

export default async function handler(req, res) {
  try {
    const symbolParam = SYMBOLS.join(',');
    const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbolParam);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'Yahoo fetch failed: ' + response.status });
    }

    const data = await response.json();
    const results = data.quoteResponse?.result || [];

    const quotes = {};
    for (const q of results) {
      quotes[q.symbol] = {
        price: q.regularMarketPrice,
        change: q.regularMarketChange,
        changePct: q.regularMarketChangePercent,
        prevClose: q.regularMarketPreviousClose,
        name: q.shortName || q.longName || q.symbol
      };
    }

    // Cache for 30 seconds at the edge
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.status(200).json({
      updated: new Date().toISOString(),
      quotes: quotes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
