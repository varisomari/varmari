const SYMBOLS = [
  'DX-Y.NYB','^TNX','^VIX','^GSPC','^IXIC','^DJI',
  'GC=F','SI=F','BZ=F','CL=F','BTC-USD','ETH-USD',
  'EURUSD=X','GBPUSD=X','JPY=X','AUDUSD=X','CAD=X','CHF=X',
  'NZDUSD=X','EURGBP=X','EURJPY=X','GBPJPY=X','AUDJPY=X','CADJPY=X'
];

export default async function handler(req, res) {
  try {
    const symbolParam = SYMBOLS.join(',');
    const url = 'https://query2.finance.yahoo.com/v6/finance/quote?symbols=' + encodeURIComponent(symbolParam);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://finance.yahoo.com',
        'Referer': 'https://finance.yahoo.com/'
      }
    });

    if (!response.ok) {
      const url2 = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbolParam);
      const r2 = await fetch(url2, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
        }
      });
      if (!r2.ok) return res.status(500).json({ error: 'Yahoo unavailable, try again in 60s' });
      const d2 = await r2.json();
      const results = d2.quoteResponse?.result || [];
      return sendQuotes(res, results);
    }

    const data = await response.json();
    const results = data.quoteResponse?.result || [];
    return sendQuotes(res, results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function sendQuotes(res, results) {
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
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  res.status(200).json({ updated: new Date().toISOString(), quotes });
}
