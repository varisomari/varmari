// api/g8.js — Vercel serverless function
// Scrapes TradingEconomics indicator pages for 8 G8 currencies

const COUNTRIES = [
  { name: 'United States', path: 'united-states' },
  { name: 'United Kingdom', path: 'united-kingdom' },
  { name: 'Euro Area', path: 'euro-area' },
  { name: 'Canada', path: 'canada' },
  { name: 'Australia', path: 'australia' },
  { name: 'Japan', path: 'japan' },
  { name: 'Switzerland', path: 'switzerland' },
  { name: 'New Zealand', path: 'new-zealand' }
];

// Indicators we want to extract (exact label match from TE pages)
const INDICATORS = [
  'Interest Rate',
  'Inflation Rate',
  'Core Inflation Rate',
  'Inflation Rate MoM',
  'Producer Prices Change',
  'Unemployment Rate',
  'GDP Growth Rate',
  'GDP Annual Growth Rate',
  'Balance of Trade',
  'Current Account',
  'Services PMI',
  'Manufacturing PMI',
  'Retail Sales MoM',
  'Retail Sales YoY',
  'Government Debt to GDP',
  'Government Budget',
  'Wage Growth'
];

async function scrapeCountry(path) {
  const url = 'https://tradingeconomics.com/' + path + '/indicators';
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });

  if (!response.ok) {
    throw new Error(path + ' fetch failed: ' + response.status);
  }

  const html = await response.text();
  return parseIndicators(html);
}

function parseIndicators(html) {
  const result = {};

  // TradingEconomics table rows: <tr>...<td>Last</td><td>Previous</td>...<td>date</td></tr>
  // Each row starts with an indicator name in an <a> tag
  // We match by indicator label, then grab the next few <td> cells

  for (const indicator of INDICATORS) {
    // Escape regex special chars
    const escaped = indicator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Look for: <a href="...">IndicatorName</a></td><td>LAST</td><td>PREV</td>...<td>DATE</td>
    // The pattern is flexible — TE sometimes has slightly different HTML
    const pattern = new RegExp(
      '<a[^>]*>' + escaped + '</a>[\\s\\S]{0,200}?' +
      '<td[^>]*>\\s*([\\d\\.\\-,]+)\\s*</td>\\s*' +
      '<td[^>]*>\\s*([\\d\\.\\-,]+)\\s*</td>' +
      '[\\s\\S]{0,500}?' +
      '<td[^>]*>\\s*([A-Za-z]{3}/\\d{2})\\s*</td>',
      'i'
    );

    const match = html.match(pattern);
    if (match) {
      result[indicator] = {
        last: match[1],
        prev: match[2],
        date: match[3]
      };
    }
  }

  return result;
}

export default async function handler(req, res) {
  try {
    const data = {};

    // Fetch all 8 countries in parallel
    const promises = COUNTRIES.map(async (c) => {
      try {
        const indicators = await scrapeCountry(c.path);
        return { name: c.name, indicators: indicators, ok: true };
      } catch (err) {
        return { name: c.name, error: err.message, ok: false };
      }
    });

    const results = await Promise.all(promises);

    for (const r of results) {
      if (r.ok) {
        data[r.name] = r.indicators;
      } else {
        data[r.name] = { _error: r.error };
      }
    }

    // Cache for 30 minutes at the edge
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      updated: new Date().toISOString(),
      ...data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
