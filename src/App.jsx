import { useState, useEffect, useMemo, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, CartesianGrid } from "recharts";

// ── Constants ──
const PAIRS = [
  "EUR/USD","GBP/USD","USD/JPY","USD/CHF","AUD/USD","NZD/USD","USD/CAD",
  "EUR/GBP","EUR/JPY","EUR/CHF","EUR/AUD","EUR/NZD","EUR/CAD",
  "GBP/JPY","GBP/CHF","GBP/AUD","GBP/NZD","GBP/CAD",
  "AUD/JPY","AUD/CHF","AUD/NZD","AUD/CAD",
  "NZD/JPY","NZD/CHF","NZD/CAD",
  "CAD/JPY","CAD/CHF","CHF/JPY",
  "XAU/USD","XAG/USD","US30","NAS100","SPX500","GER40"
];
const SESSIONS = ["London","New York","Tokyo"];
const DAYS_W = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
const BIAS_TYPES = ["Transition","Re-Transition","Confirmation","Continuation","None"];
const SK = "varmari-trades";
const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6);

// ── Theme ──
const T = {
  bg: "#F5F0E8", card: "#FFFFFF", cardAlt: "#FAF8F4", border: "#E8E0D4",
  borderLight: "#F0EBE3", text: "#2C2418", textMid: "#6B5D4F", textLight: "#9C8E7E",
  accent: "#C47A3B", accentBg: "#FDF3E8", green: "#1A8754", greenBg: "#E8F5EE",
  red: "#C4342A", redBg: "#FDF0EF", blue: "#2563EB", blueBg: "#EFF4FF",
  purple: "#7C3AED", purpleBg: "#F3EEFF", amber: "#B45309", amberBg: "#FEF9E8",
  headerBg: "#2C2418",
};
const font = `'Instrument Sans', 'SF Pro Display', -apple-system, sans-serif`;
const mono = `'JetBrains Mono', 'SF Mono', monospace`;

// ── Helpers ──
const fP = v => { if (v == null || v === "") return "—"; const s = v >= 0 ? "+" : ""; return `${s}${Number(v).toFixed(2)}%`; };
const fU = v => { if (v == null || v === "") return "—"; const s = v >= 0 ? "+" : "−"; return `${s}$${Math.abs(v).toFixed(2)}`; };
const cP = v => v > 0 ? T.green : v < 0 ? T.red : T.textMid;
const getDay = d => { const dt = new Date(d + "T12:00:00"); return DAYS_W[dt.getDay() - 1] || "Friday"; };

const emptyTrade = () => ({
  id: uid(), date: new Date().toISOString().split("T")[0],
  session: "London", pair: "EUR/USD", risk: 1, direction: "Long",
  entry: "", exit: "", rr: "", pnlPct: "", result: "Win",
  biasType: "Confirmation", rating: 3, execLink: "", biasLink: "", notes: "",
});

// ── Storage ──
const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

// ── Reusable Components ──
const cardS = { background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, overflow: "hidden" };
const inputS = {
  width: "100%", padding: "8px 10px", fontSize: 13, fontFamily: mono, color: T.text,
  background: T.cardAlt, border: `1px solid ${T.border}`, borderRadius: 8, outline: "none", boxSizing: "border-box",
};
const selectS = {
  ...inputS, cursor: "pointer", appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%239C8E7E'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 26,
};
const btnP = { padding: "9px 20px", fontSize: 12, fontWeight: 600, fontFamily: font, color: "#fff", background: T.accent, border: "none", borderRadius: 8, cursor: "pointer" };
const btnG = { padding: "8px 14px", fontSize: 12, fontWeight: 500, fontFamily: font, color: T.textMid, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, cursor: "pointer" };
const center = { display: "flex", alignItems: "center", justifyContent: "center" };

function Pill({ text, type }) {
  const m = { Win: [T.greenBg, T.green], Loss: [T.redBg, T.red], Breakeven: [T.cardAlt, T.textMid], Long: [T.greenBg, T.green], Short: [T.redBg, T.red], pair: [T.accentBg, T.accent], session: [T.blueBg, T.blue], bias: [T.purpleBg, T.purple] };
  const [bg, fg] = m[text] || m[type] || [T.cardAlt, T.textMid];
  return <span style={{ display: "inline-block", fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: bg, color: fg, letterSpacing: 0.4, textTransform: "uppercase", fontFamily: mono, whiteSpace: "nowrap" }}>{text}</span>;
}

function Field({ label, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <label style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono }}>{label}</label>
    {children}
  </div>;
}

function Stat({ label, value, color, sub, icon }) {
  return <div style={{ ...cardS, padding: "16px 18px", flex: 1, minWidth: 140 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
      {icon && <span style={{ fontSize: 14, opacity: 0.5 }}>{icon}</span>}
      <span style={{ fontSize: 10, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>{label}</span>
    </div>
    <div style={{ fontSize: 24, fontWeight: 700, color: color || T.text, fontFamily: mono, lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: T.textLight, marginTop: 4, fontFamily: mono }}>{sub}</div>}
  </div>;
}

// ══════════════════════════════════════════
// POSITION SIZE CALCULATOR (85 instruments)
// ══════════════════════════════════════════
const INSTRUMENTS = [
  {id:"EURUSD",label:"EUR/USD",cat:"Forex",pipSize:0.0001,pipVal:10,cs:100000,unit:"units"},
  {id:"GBPUSD",label:"GBP/USD",cat:"Forex",pipSize:0.0001,pipVal:10,cs:100000,unit:"units"},
  {id:"AUDUSD",label:"AUD/USD",cat:"Forex",pipSize:0.0001,pipVal:10,cs:100000,unit:"units"},
  {id:"NZDUSD",label:"NZD/USD",cat:"Forex",pipSize:0.0001,pipVal:10,cs:100000,unit:"units"},
  {id:"USDJPY",label:"USD/JPY",cat:"Forex",pipSize:0.01,pipVal:6.67,cs:100000,unit:"units"},
  {id:"USDCAD",label:"USD/CAD",cat:"Forex",pipSize:0.0001,pipVal:7.2,cs:100000,unit:"units"},
  {id:"USDCHF",label:"USD/CHF",cat:"Forex",pipSize:0.0001,pipVal:11.2,cs:100000,unit:"units"},
  {id:"EURJPY",label:"EUR/JPY",cat:"Forex",pipSize:0.01,pipVal:6.67,cs:100000,unit:"units"},
  {id:"GBPJPY",label:"GBP/JPY",cat:"Forex",pipSize:0.01,pipVal:6.67,cs:100000,unit:"units"},
  {id:"AUDJPY",label:"AUD/JPY",cat:"Forex",pipSize:0.01,pipVal:6.67,cs:100000,unit:"units"},
  {id:"NZDJPY",label:"NZD/JPY",cat:"Forex",pipSize:0.01,pipVal:6.67,cs:100000,unit:"units"},
  {id:"CADJPY",label:"CAD/JPY",cat:"Forex",pipSize:0.01,pipVal:6.67,cs:100000,unit:"units"},
  {id:"CHFJPY",label:"CHF/JPY",cat:"Forex",pipSize:0.01,pipVal:6.67,cs:100000,unit:"units"},
  {id:"EURGBP",label:"EUR/GBP",cat:"Forex",pipSize:0.0001,pipVal:12.5,cs:100000,unit:"units"},
  {id:"GBPAUD",label:"GBP/AUD",cat:"Forex",pipSize:0.0001,pipVal:6.5,cs:100000,unit:"units"},
  {id:"GBPNZD",label:"GBP/NZD",cat:"Forex",pipSize:0.0001,pipVal:6.0,cs:100000,unit:"units"},
  {id:"GBPCAD",label:"GBP/CAD",cat:"Forex",pipSize:0.0001,pipVal:7.2,cs:100000,unit:"units"},
  {id:"GBPCHF",label:"GBP/CHF",cat:"Forex",pipSize:0.0001,pipVal:11.2,cs:100000,unit:"units"},
  {id:"EURAUD",label:"EUR/AUD",cat:"Forex",pipSize:0.0001,pipVal:6.5,cs:100000,unit:"units"},
  {id:"EURNZD",label:"EUR/NZD",cat:"Forex",pipSize:0.0001,pipVal:6.0,cs:100000,unit:"units"},
  {id:"EURCAD",label:"EUR/CAD",cat:"Forex",pipSize:0.0001,pipVal:7.2,cs:100000,unit:"units"},
  {id:"EURCHF",label:"EUR/CHF",cat:"Forex",pipSize:0.0001,pipVal:11.2,cs:100000,unit:"units"},
  {id:"AUDNZD",label:"AUD/NZD",cat:"Forex",pipSize:0.0001,pipVal:6.0,cs:100000,unit:"units"},
  {id:"AUDCAD",label:"AUD/CAD",cat:"Forex",pipSize:0.0001,pipVal:7.2,cs:100000,unit:"units"},
  {id:"AUDCHF",label:"AUD/CHF",cat:"Forex",pipSize:0.0001,pipVal:11.2,cs:100000,unit:"units"},
  {id:"NZDCAD",label:"NZD/CAD",cat:"Forex",pipSize:0.0001,pipVal:7.2,cs:100000,unit:"units"},
  {id:"NZDCHF",label:"NZD/CHF",cat:"Forex",pipSize:0.0001,pipVal:11.2,cs:100000,unit:"units"},
  {id:"CADCHF",label:"CAD/CHF",cat:"Forex",pipSize:0.0001,pipVal:11.2,cs:100000,unit:"units"},
  {id:"USDSGD",label:"USD/SGD",cat:"Forex",pipSize:0.0001,pipVal:7.5,cs:100000,unit:"units"},
  {id:"USDSEK",label:"USD/SEK",cat:"Forex",pipSize:0.0001,pipVal:0.95,cs:100000,unit:"units"},
  {id:"USDNOK",label:"USD/NOK",cat:"Forex",pipSize:0.0001,pipVal:0.93,cs:100000,unit:"units"},
  {id:"USDMXN",label:"USD/MXN",cat:"Forex",pipSize:0.0001,pipVal:0.58,cs:100000,unit:"units"},
  {id:"USDZAR",label:"USD/ZAR",cat:"Forex",pipSize:0.0001,pipVal:0.55,cs:100000,unit:"units"},
  {id:"USDTRY",label:"USD/TRY",cat:"Forex",pipSize:0.0001,pipVal:0.31,cs:100000,unit:"units"},
  {id:"USDCNH",label:"USD/CNH",cat:"Forex",pipSize:0.0001,pipVal:1.38,cs:100000,unit:"units"},
  {id:"XAUUSD",label:"XAU/USD (Gold)",cat:"Metals",pipSize:0.01,pipVal:1,cs:100,unit:"oz"},
  {id:"XAGUSD",label:"XAG/USD (Silver)",cat:"Metals",pipSize:0.001,pipVal:5,cs:5000,unit:"oz"},
  {id:"XPTUSD",label:"XPT/USD (Platinum)",cat:"Metals",pipSize:0.01,pipVal:1,cs:100,unit:"oz"},
  {id:"XPDUSD",label:"XPD/USD (Palladium)",cat:"Metals",pipSize:0.01,pipVal:1,cs:100,unit:"oz"},
  {id:"WTI",label:"WTI Crude Oil",cat:"Energy",pipSize:0.01,pipVal:10,cs:1000,unit:"bbl"},
  {id:"BRENT",label:"Brent Crude Oil",cat:"Energy",pipSize:0.01,pipVal:10,cs:1000,unit:"bbl"},
  {id:"NATGAS",label:"Natural Gas",cat:"Energy",pipSize:0.001,pipVal:10,cs:10000,unit:"mmBtu"},
  {id:"US30",label:"US30 (Dow Jones)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"NAS100",label:"NAS100 (Nasdaq)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"SPX500",label:"SPX500 (S&P 500)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"US2000",label:"US2000 (Russell)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"GER40",label:"GER40 (DAX)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"UK100",label:"UK100 (FTSE)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"FRA40",label:"FRA40 (CAC 40)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"JPN225",label:"JPN225 (Nikkei)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"AUS200",label:"AUS200 (ASX 200)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"HK50",label:"HK50 (Hang Seng)",cat:"Indices",pipSize:1,pipVal:1,cs:1,unit:"contracts"},
  {id:"BTCUSD",label:"BTC/USD (Bitcoin)",cat:"Crypto",pipSize:0.01,pipVal:1,cs:1,unit:"BTC"},
  {id:"ETHUSD",label:"ETH/USD (Ethereum)",cat:"Crypto",pipSize:0.01,pipVal:1,cs:1,unit:"ETH"},
  {id:"SOLUSD",label:"SOL/USD (Solana)",cat:"Crypto",pipSize:0.01,pipVal:1,cs:1,unit:"SOL"},
];

function PositionCalc() {
  const [selected, setSelected] = useState(INSTRUMENTS.find(i => i.id === "XAUUSD"));
  const [search, setSearch] = useState("XAU/USD (Gold)");
  const [dropOpen, setDropOpen] = useState(false);
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [risk, setRisk] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setDropOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredInst = useMemo(() => {
    if (!dropOpen) return INSTRUMENTS;
    const q = search.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!q) return INSTRUMENTS;
    return INSTRUMENTS.filter(i => i.id.toLowerCase().includes(q) || i.label.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q) || i.cat.toLowerCase().includes(q));
  }, [search, dropOpen]);

  const e = parseFloat(entry), s = parseFloat(sl), r = parseFloat(risk);
  const valid = selected && !isNaN(e) && !isNaN(s) && !isNaN(r) && e !== s && r > 0;
  const isLong = valid ? e > s : true;
  const slDist = valid ? Math.abs(e - s) : 0;
  const slPct = valid ? (slDist / e) * 100 : 0;
  const slPips = valid ? slDist / selected.pipSize : 0;
  const lots = valid ? r / (slPips * selected.pipVal) : 0;
  const units = lots * (selected?.cs || 1);
  const posValue = units * (e || 0);
  const fmtN = (n, d = 2) => isNaN(n) ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

  const catColor = { Forex: T.accent, Metals: T.amber, Energy: T.green, Indices: T.blue, Crypto: T.purple };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "36px 20px" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: T.text, fontFamily: "'Instrument Serif', Georgia, serif" }}>Position Sizer</h2>
        <div style={{ fontSize: 11, letterSpacing: 2, color: T.textLight, textTransform: "uppercase", fontFamily: mono, marginTop: 4 }}>{INSTRUMENTS.length} instruments · Risk → Lots</div>
      </div>

      <div style={{ ...cardS, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Searchable Dropdown */}
        <div ref={wrapRef} style={{ position: "relative" }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Instrument</label>
          <div style={{ display: "flex", alignItems: "center", background: T.cardAlt, border: `1px solid ${T.border}`, borderRadius: dropOpen ? "10px 10px 0 0" : 10, padding: "0 12px" }}>
            <input type="text" value={dropOpen ? search : (selected?.label || "")} placeholder="Search... e.g. GBP, Gold, NAS"
              onFocus={() => { setDropOpen(true); setSearch(""); }}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: T.text, fontFamily: mono, fontSize: 15, padding: "12px 0", width: "100%" }} />
            <span style={{ color: T.textLight, fontSize: 10, transition: "transform 0.2s", transform: dropOpen ? "rotate(180deg)" : "none" }}>▼</span>
          </div>
          {dropOpen && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: T.card, border: `1px solid ${T.border}`, borderTop: "none", borderRadius: "0 0 10px 10px", maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
              {filteredInst.length === 0 ? (
                <div style={{ padding: "12px 14px", color: T.textLight, fontSize: 13 }}>No results</div>
              ) : filteredInst.map(inst => (
                <div key={inst.id} onMouseDown={(ev) => { ev.preventDefault(); setSelected(inst); setSearch(inst.label); setDropOpen(false); }}
                  style={{ padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: selected?.id === inst.id ? T.cardAlt : "transparent", transition: "background 0.15s" }}
                  onMouseEnter={ev => ev.currentTarget.style.background = T.cardAlt} onMouseLeave={ev => ev.currentTarget.style.background = selected?.id === inst.id ? T.cardAlt : "transparent"}>
                  <span style={{ fontFamily: mono, fontSize: 13, color: T.text }}>{inst.label}</span>
                  <span style={{ fontSize: 10, color: catColor[inst.cat] || T.textLight, fontFamily: mono, letterSpacing: 0.5 }}>{inst.cat}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Entry Price</label>
          <div style={{ display: "flex", alignItems: "center", background: T.cardAlt, border: `1px solid ${T.border}`, borderRadius: 10, padding: "0 12px" }}>
            <input type="number" inputMode="decimal" value={entry} onChange={e => setEntry(e.target.value)} placeholder="0" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: T.text, fontFamily: mono, fontSize: 15, padding: "12px 0", width: "100%" }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Stop Loss</label>
          <div style={{ display: "flex", alignItems: "center", background: T.cardAlt, border: `1px solid ${T.border}`, borderRadius: 10, padding: "0 12px" }}>
            <input type="number" inputMode="decimal" value={sl} onChange={e => setSl(e.target.value)} placeholder="0" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: T.text, fontFamily: mono, fontSize: 15, padding: "12px 0", width: "100%" }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Risk Amount</label>
          <div style={{ display: "flex", alignItems: "center", background: T.cardAlt, border: `1px solid ${T.border}`, borderRadius: 10, padding: "0 12px" }}>
            <span style={{ fontFamily: mono, fontSize: 14, color: T.textLight, marginRight: 4 }}>$</span>
            <input type="number" inputMode="decimal" value={risk} onChange={e => setRisk(e.target.value)} placeholder="0" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: T.text, fontFamily: mono, fontSize: 15, padding: "12px 0", width: "100%" }} />
          </div>
        </div>
      </div>

      {/* Results */}
      {valid && (
        <div style={{ ...cardS, padding: 22, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6, background: isLong ? T.greenBg : T.redBg, color: isLong ? T.green : T.red }}>{isLong ? "LONG" : "SHORT"}</span>
          </div>
          <div style={{ textAlign: "center", padding: "8px 0 18px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 12, color: T.textLight, marginBottom: 6 }}>Lot Size</div>
            <div style={{ fontFamily: mono, fontSize: 40, fontWeight: 700, color: T.text }}>{fmtN(lots, lots < 0.1 ? 3 : 2)}</div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.accent, marginTop: 5 }}>{fmtN(units, units < 10 ? 4 : 0)} {selected.unit} · ${fmtN(posValue)} notional</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
            <div style={{ background: T.cardAlt, borderRadius: 10, padding: "11px 13px" }}>
              <div style={{ fontSize: 11, color: T.textLight, marginBottom: 3 }}>SL Pips</div>
              <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: T.red }}>{fmtN(slPips, 1)}</div>
            </div>
            <div style={{ background: T.cardAlt, borderRadius: 10, padding: "11px 13px" }}>
              <div style={{ fontSize: 11, color: T.textLight, marginBottom: 3 }}>SL %</div>
              <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: T.red }}>{fmtN(slPct)}%</div>
            </div>
            <div style={{ background: T.cardAlt, borderRadius: 10, padding: "11px 13px" }}>
              <div style={{ fontSize: 11, color: T.textLight, marginBottom: 3 }}>$ at Risk</div>
              <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: T.accent }}>${fmtN(r)}</div>
            </div>
            <div style={{ background: T.cardAlt, borderRadius: 10, padding: "11px 13px" }}>
              <div style={{ fontSize: 11, color: T.textLight, marginBottom: 3 }}>Pip Value</div>
              <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: T.textMid }}>${selected.pipVal}/lot</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 14, fontSize: 10, color: T.textLight, fontFamily: mono }}>Pip values approximate for cross pairs. Verify with broker.</div>
    </div>
  );
}

// ══════════════════════════════════════════
// TRADE LOG + DASHBOARD
// ══════════════════════════════════════════
function Journal() {
  const [trades, setTrades] = useState(() => load(SK, []));
  const [acct, setAcct] = useState(() => load(SK + "-acct", 10000));
  const [tab, setTab] = useState("dashboard");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyTrade());
  const [editId, setEditId] = useState(null);
  const [fPair, setFPair] = useState("All");
  const [fResult, setFResult] = useState("All");
  const [fDay, setFDay] = useState("All");
  const [fSess, setFSess] = useState("All");
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch] = useState("");
  const [editAcct, setEditAcct] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { save(SK, trades); }, [trades]);
  useEffect(() => { save(SK + "-acct", acct); }, [acct]);

  const saveTrade = () => {
    const pnl = parseFloat(form.pnlPct) || 0;
    const t = { ...form, pnlPct: pnl, pnlUsd: (pnl / 100) * acct, day: getDay(form.date) };
    if (editId) setTrades(p => p.map(x => x.id === editId ? { ...t, id: editId } : x));
    else setTrades(p => [t, ...p]);
    setForm(emptyTrade()); setShowForm(false); setEditId(null);
  };

  const editTrade = t => { setForm({ ...t }); setEditId(t.id); setShowForm(true); setTab("log"); };
  const deleteTrade = id => { if (confirm("Delete this trade?")) setTrades(p => p.filter(x => x.id !== id)); };
  const resetAll = () => { if (confirm("Delete ALL trades? Cannot undo.")) setTrades([]); };

  const exportCSV = () => {
    const h = "Date,Day,Session,Pair,Risk%,Direction,Entry,Exit,R:R,PnL%,PnL$,Result,Bias,Rating,Execution,BiasLink,Notes";
    const rows = trades.map(t => [t.date, t.day, t.session, t.pair, t.risk, t.direction, t.entry, t.exit, t.rr, t.pnlPct, (t.pnlUsd || 0).toFixed(2), t.result, t.biasType, t.rating, t.execLink, t.biasLink, `"${(t.notes || "").replace(/"/g, '""')}"`].join(","));
    const blob = new Blob([h + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `varmari_journal_${new Date().toISOString().split("T")[0]}.csv`; a.click();
  };

  const importCSV = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const lines = ev.target.result.split("\n").slice(1).filter(l => l.trim());
      const imported = lines.map(line => {
        const p = line.match(/(".*?"|[^,]*)/g) || [];
        const c = p.map(v => v.replace(/^"|"$/g, "").trim());
        return { id: uid(), date: c[0] || "", day: c[1] || "", session: c[2] || "", pair: c[3] || "", risk: parseFloat(c[4]) || 1, direction: c[5] || "Long", entry: c[6] || "", exit: c[7] || "", rr: c[8] || "", pnlPct: parseFloat(c[9]) || 0, pnlUsd: parseFloat(c[10]) || 0, result: c[11] || "Win", biasType: c[12] || "Technical", rating: parseInt(c[13]) || 3, execLink: c[14] || "", biasLink: c[15] || "", notes: c[16] || "" };
      });
      setTrades(prev => [...imported, ...prev]);
    };
    reader.readAsText(file); e.target.value = "";
  };

  // Stats
  const S = useMemo(() => {
    const n = trades.length; if (!n) return null;
    const w = trades.filter(t => t.result === "Win"), l = trades.filter(t => t.result === "Loss"), b = trades.filter(t => t.result === "Breakeven");
    const wr = w.length / (w.length + l.length || 1) * 100;
    const tPnl = trades.reduce((s, t) => s + (t.pnlPct || 0), 0);
    const tUsd = trades.reduce((s, t) => s + (t.pnlUsd || 0), 0);
    const avgW = w.length ? w.reduce((s, t) => s + t.pnlPct, 0) / w.length : 0;
    const avgL = l.length ? l.reduce((s, t) => s + t.pnlPct, 0) / l.length : 0;
    const pf = Math.abs(avgL) > 0 ? Math.abs(avgW / avgL) : 0;
    const best = Math.max(...trades.map(t => t.pnlPct || 0));
    const worst = Math.min(...trades.map(t => t.pnlPct || 0));
    let streak = 0, maxS = 0; [...trades].sort((a, b) => a.date.localeCompare(b.date)).forEach(t => { if (t.result === "Win") { streak++; maxS = Math.max(maxS, streak); } else streak = 0; });

    const day = {}; DAYS_W.forEach(d => { day[d] = { n: 0, w: 0, l: 0, be: 0, pnl: 0 }; }); trades.forEach(t => { if (day[t.day]) { day[t.day].n++; if (t.result === "Win") day[t.day].w++; else if (t.result === "Loss") day[t.day].l++; else day[t.day].be++; day[t.day].pnl += t.pnlPct || 0; } });
    const sess = {}; SESSIONS.forEach(s => { sess[s] = { n: 0, w: 0, l: 0, pnl: 0 }; }); trades.forEach(t => { if (sess[t.session]) { sess[t.session].n++; if (t.result === "Win") sess[t.session].w++; else if (t.result === "Loss") sess[t.session].l++; sess[t.session].pnl += t.pnlPct || 0; } });
    const pair = {}; PAIRS.forEach(p => { pair[p] = { n: 0, w: 0, l: 0, be: 0, pnl: 0, usd: 0 }; }); trades.forEach(t => { if (pair[t.pair]) { pair[t.pair].n++; if (t.result === "Win") pair[t.pair].w++; else if (t.result === "Loss") pair[t.pair].l++; else pair[t.pair].be++; pair[t.pair].pnl += t.pnlPct || 0; pair[t.pair].usd += t.pnlUsd || 0; } });
    const bias = {}; BIAS_TYPES.forEach(b => { bias[b] = { n: 0, w: 0, l: 0, pnl: 0 }; }); trades.forEach(t => { if (bias[t.biasType]) { bias[t.biasType].n++; if (t.result === "Win") bias[t.biasType].w++; else if (t.result === "Loss") bias[t.biasType].l++; bias[t.biasType].pnl += t.pnlPct || 0; } });
    const dir = { Long: { n: 0, w: 0, l: 0, pnl: 0 }, Short: { n: 0, w: 0, l: 0, pnl: 0 } }; trades.forEach(t => { if (dir[t.direction]) { dir[t.direction].n++; if (t.result === "Win") dir[t.direction].w++; else if (t.result === "Loss") dir[t.direction].l++; dir[t.direction].pnl += t.pnlPct || 0; } });
    const mo = {}; trades.forEach(t => { const m = t.date?.substring(0, 7); if (m) { if (!mo[m]) mo[m] = { n: 0, w: 0, l: 0, pnl: 0, usd: 0 }; mo[m].n++; if (t.result === "Win") mo[m].w++; else if (t.result === "Loss") mo[m].l++; mo[m].pnl += t.pnlPct || 0; mo[m].usd += t.pnlUsd || 0; } });

    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    let bal = acct; const eq = sorted.map(t => { bal += (t.pnlUsd || 0); return { date: t.date, balance: Math.round(bal * 100) / 100 }; });

    return { n, w: w.length, l: l.length, be: b.length, wr, tPnl, tUsd, avgW, avgL, pf, best, worst, maxS, day, sess, pair, bias, dir, mo, eq };
  }, [trades, acct]);

  const filtered = useMemo(() => {
    let list = [...trades];
    if (fPair !== "All") list = list.filter(t => t.pair === fPair);
    if (fResult !== "All") list = list.filter(t => t.result === fResult);
    if (fDay !== "All") list = list.filter(t => t.day === fDay);
    if (fSess !== "All") list = list.filter(t => t.session === fSess);
    if (search) { const s = search.toLowerCase(); list = list.filter(t => [t.pair, t.session, t.direction, t.biasType, t.notes, t.date, t.day].some(f => (f || "").toLowerCase().includes(s))); }
    list.sort((a, b) => { let va = a[sortCol], vb = b[sortCol]; if (sortCol === "pnlPct" || sortCol === "risk") { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; } if (va < vb) return sortDir === "asc" ? -1 : 1; if (va > vb) return sortDir === "asc" ? 1 : -1; return 0; });
    return list;
  }, [trades, fPair, fResult, fDay, fSess, search, sortCol, sortDir]);

  const toggleSort = col => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("desc"); } };

  const tabs = [{ k: "dashboard", l: "Dashboard", i: "◈" }, { k: "log", l: "Trade Log", i: "☰" }, { k: "pairs", l: "Pairs", i: "⟡" }, { k: "monthly", l: "Monthly", i: "▣" }];

  return (
    <div>
      <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={importCSV} />

      {/* Sub-header */}
      <div style={{ display: "flex", gap: 8, padding: "12px 28px", alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, background: T.card }}>
        <div style={{ display: "flex", gap: 0 }}>
          {tabs.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              background: "none", border: "none", color: tab === t.k ? T.accent : T.textLight,
              padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
              borderBottom: tab === t.k ? `2px solid ${T.accent}` : "2px solid transparent",
            }}><span style={{ fontSize: 13, marginRight: 4 }}>{t.i}</span>{t.l}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {editAcct ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>ACCT</span>
              <input type="number" value={acct} onChange={e => setAcct(parseFloat(e.target.value) || 0)} style={{ ...inputS, width: 90, padding: "4px 8px", fontSize: 11 }} />
              <button onClick={() => setEditAcct(false)} style={{ ...btnG, padding: "4px 8px", fontSize: 10, color: T.green }}>✓</button>
            </div>
          ) : (
            <button onClick={() => setEditAcct(true)} style={{ ...btnG, fontSize: 10, padding: "5px 10px" }}>Account: ${acct.toLocaleString()}</button>
          )}
          <button onClick={() => { setForm(emptyTrade()); setEditId(null); setShowForm(true); setTab("log"); }} style={{ ...btnP, fontSize: 11, padding: "6px 14px" }}>+ New Trade</button>
          <button onClick={exportCSV} style={{ ...btnG, fontSize: 10, padding: "5px 10px" }}>Export</button>
          <button onClick={() => fileRef.current?.click()} style={{ ...btnG, fontSize: 10, padding: "5px 10px" }}>Import</button>
        </div>
      </div>

      <div style={{ padding: "20px 28px", maxWidth: 1280, margin: "0 auto" }}>

        {/* ═══ DASHBOARD ═══ */}
        {tab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!S ? (
              <div style={{ ...cardS, padding: 60, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>◈</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No trades yet</div>
                <div style={{ color: T.textMid, fontSize: 13, marginBottom: 20 }}>Click "+ New Trade" to start logging</div>
                <button onClick={() => { setForm(emptyTrade()); setEditId(null); setShowForm(true); setTab("log"); }} style={btnP}>+ New Trade</button>
              </div>
            ) : (<>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
                <Stat icon="◎" label="Win Rate" value={`${S.wr.toFixed(1)}%`} color={S.wr >= 50 ? T.green : T.red} sub={`${S.w}W / ${S.l}L`} />
                <Stat icon="Σ" label="Total Trades" value={S.n} sub={`${S.be} BE`} />
                <Stat icon="△" label="Total PnL %" value={fP(S.tPnl)} color={cP(S.tPnl)} />
                <Stat icon="$" label="Total PnL $" value={fU(S.tUsd)} color={cP(S.tUsd)} />
                <Stat icon="⚖" label="Profit Factor" value={S.pf.toFixed(2)} color={S.pf >= 1.5 ? T.green : S.pf >= 1 ? T.amber : T.red} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
                <Stat icon="↑" label="Avg Win" value={fP(S.avgW)} color={T.green} />
                <Stat icon="↓" label="Avg Loss" value={fP(S.avgL)} color={T.red} />
                <Stat icon="★" label="Best" value={fP(S.best)} color={T.green} />
                <Stat icon="✦" label="Worst" value={fP(S.worst)} color={T.red} />
                <Stat icon="◆" label="Balance" value={`$${(acct + S.tUsd).toFixed(0)}`} color={T.accent} sub={`Streak: ${S.maxS}`} />
              </div>

              {/* Equity */}
              <div style={{ ...cardS, padding: 18 }}>
                <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 10 }}>Equity Curve</div>
                {S.eq.length >= 2 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={S.eq}>
                      <defs><linearGradient id="eqG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={S.tUsd >= 0 ? T.green : T.red} stopOpacity={0.15} /><stop offset="95%" stopColor={S.tUsd >= 0 ? T.green : T.red} stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.borderLight} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: T.textLight, fontFamily: mono }} tickLine={false} axisLine={{ stroke: T.border }} />
                      <YAxis tick={{ fontSize: 9, fill: T.textLight, fontFamily: mono }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                      <Tooltip contentStyle={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, fontFamily: mono, fontSize: 11 }} formatter={v => [`$${v.toFixed(2)}`, "Balance"]} />
                      <Area type="monotone" dataKey="balance" stroke={S.tUsd >= 0 ? T.green : T.red} strokeWidth={2} fill="url(#eqG)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <div style={{ color: T.textLight, fontSize: 12, textAlign: "center", padding: 20 }}>Add 2+ trades for equity curve</div>}
              </div>

              {/* Day + Session */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ ...cardS, padding: 18 }}>
                  <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 12 }}>By Day</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                    {DAYS_W.map(d => { const ds = S.day[d]; const wr = ds.n > 0 ? (ds.w / (ds.w + ds.l || 1) * 100) : 0; return (
                      <div key={d} style={{ textAlign: "center", padding: "10px 4px", background: T.cardAlt, borderRadius: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: T.textMid }}>{d.substring(0, 3)}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: mono, color: cP(ds.pnl), marginTop: 4 }}>{ds.n}</div>
                        <div style={{ fontSize: 9, color: T.textLight, fontFamily: mono }}>{ds.w}W·{ds.l}L</div>
                        <div style={{ fontSize: 9, color: wr >= 50 ? T.green : ds.n > 0 ? T.red : T.textLight, fontFamily: mono, fontWeight: 600 }}>{ds.n > 0 ? `${wr.toFixed(0)}%` : "—"}</div>
                      </div>
                    ); })}
                  </div>
                </div>
                <div style={{ ...cardS, padding: 18 }}>
                  <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 12 }}>By Session</div>
                  {SESSIONS.map((s, i) => { const ss = S.sess[s]; const wr = ss.n > 0 ? (ss.w / (ss.w + ss.l || 1) * 100) : 0; const maxN = Math.max(...Object.values(S.sess).map(x => x.n), 1); return (
                    <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: i < SESSIONS.length - 1 ? `1px solid ${T.borderLight}` : "none" }}>
                      <div style={{ width: 100, fontSize: 11, fontWeight: 600, color: T.textMid, flexShrink: 0 }}>{s}</div>
                      <div style={{ flex: 1, height: 5, background: T.cardAlt, borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${(ss.n / maxN) * 100}%`, height: "100%", background: cP(ss.pnl), borderRadius: 3 }} /></div>
                      <div style={{ fontSize: 10, fontFamily: mono, color: T.textMid, width: 25, textAlign: "right" }}>{ss.n}</div>
                      <div style={{ fontSize: 10, fontFamily: mono, color: wr >= 50 ? T.green : ss.n > 0 ? T.red : T.textLight, width: 32, textAlign: "right" }}>{ss.n > 0 ? `${wr.toFixed(0)}%` : "—"}</div>
                    </div>
                  ); })}
                </div>
              </div>

              {/* Direction + Monthly chart */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ ...cardS, padding: 18 }}>
                  <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 12 }}>Direction</div>
                  {["Long", "Short"].map(d => { const dd = S.dir[d]; const wr = dd.n > 0 ? (dd.w / (dd.w + dd.l || 1) * 100) : 0; return (
                    <div key={d} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: d === "Long" ? `1px solid ${T.borderLight}` : "none" }}>
                      <Pill text={d} />
                      <div style={{ display: "flex", gap: 14, fontSize: 11, fontFamily: mono }}>
                        <span>{dd.n}T</span><span style={{ color: T.green }}>{dd.w}W</span><span style={{ color: T.red }}>{dd.l}L</span>
                        <span style={{ color: wr >= 50 ? T.green : dd.n > 0 ? T.red : T.textLight, fontWeight: 600 }}>{dd.n > 0 ? `${wr.toFixed(0)}%` : "—"}</span>
                        <span style={{ color: cP(dd.pnl), fontWeight: 600 }}>{fP(dd.pnl)}</span>
                      </div>
                    </div>
                  ); })}
                </div>
                <div style={{ ...cardS, padding: 18 }}>
                  <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 10 }}>Monthly PnL</div>
                  {Object.keys(S.mo).length > 0 ? (
                    <ResponsiveContainer width="100%" height={110}>
                      <BarChart data={Object.entries(S.mo).sort().map(([m, d]) => ({ month: m.substring(5), pnl: Math.round(d.pnl * 100) / 100 }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke={T.borderLight} />
                        <XAxis dataKey="month" tick={{ fontSize: 9, fill: T.textLight, fontFamily: mono }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 9, fill: T.textLight, fontFamily: mono }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, fontFamily: mono, fontSize: 11 }} />
                        <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>{Object.entries(S.mo).sort().map(([, d], i) => <Cell key={i} fill={d.pnl >= 0 ? T.green : T.red} opacity={0.8} />)}</Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <div style={{ color: T.textLight, fontSize: 12, textAlign: "center", padding: 20 }}>No data</div>}
                </div>
              </div>

              {/* Recent */}
              <div style={{ ...cardS, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>Recent Trades</span>
                  <button onClick={() => setTab("log")} style={{ ...btnG, padding: "4px 10px", fontSize: 10 }}>View All →</button>
                </div>
                {trades.slice(0, 7).map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${T.borderLight}`, gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono, width: 70 }}>{t.date}</span>
                      <Pill text={t.pair} type="pair" /><Pill text={t.direction} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, color: cP(t.pnlPct) }}>{fP(t.pnlPct)}</span>
                      <Pill text={t.result} />
                    </div>
                  </div>
                ))}
              </div>
            </>)}
          </div>
        )}

        {/* ═══ TRADE LOG ═══ */}
        {tab === "log" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {showForm && (
              <div style={{ ...cardS, padding: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{editId ? "Edit Trade" : "Log New Trade"}</span>
                  <button onClick={() => { setShowForm(false); setEditId(null); }} style={btnG}>✕</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                  <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inputS} /></Field>
                  <Field label="Session"><select value={form.session} onChange={e => setForm({ ...form, session: e.target.value })} style={selectS}>{SESSIONS.map(s => <option key={s}>{s}</option>)}</select></Field>
                  <Field label="Pair"><select value={form.pair} onChange={e => setForm({ ...form, pair: e.target.value })} style={selectS}>{PAIRS.map(p => <option key={p}>{p}</option>)}</select></Field>
                  <Field label="Risk %"><input type="number" step="0.25" value={form.risk} onChange={e => setForm({ ...form, risk: e.target.value })} style={inputS} /></Field>
                  <Field label="Direction"><select value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })} style={selectS}><option>Long</option><option>Short</option></select></Field>
                  <Field label="Entry"><input type="text" value={form.entry} onChange={e => setForm({ ...form, entry: e.target.value })} placeholder="1.0850" style={inputS} /></Field>
                  <Field label="Exit"><input type="text" value={form.exit} onChange={e => setForm({ ...form, exit: e.target.value })} placeholder="1.0920" style={inputS} /></Field>
                  <Field label="R:R"><input type="text" value={form.rr} onChange={e => setForm({ ...form, rr: e.target.value })} placeholder="1:2.5" style={inputS} /></Field>
                  <Field label="PnL %"><input type="number" step="0.01" value={form.pnlPct} onChange={e => setForm({ ...form, pnlPct: e.target.value })} style={inputS} /></Field>
                  <Field label="Result"><select value={form.result} onChange={e => setForm({ ...form, result: e.target.value })} style={selectS}><option>Win</option><option>Loss</option><option>Breakeven</option></select></Field>
                  <Field label="Bias Type"><select value={form.biasType} onChange={e => setForm({ ...form, biasType: e.target.value })} style={selectS}>{BIAS_TYPES.map(b => <option key={b}>{b}</option>)}</select></Field>
                  <Field label="Rating">
                    <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                      {[1, 2, 3, 4, 5].map(r => (<button key={r} onClick={() => setForm({ ...form, rating: r })} style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${T.border}`, background: form.rating >= r ? T.accentBg : T.cardAlt, color: form.rating >= r ? T.accent : T.textLight, cursor: "pointer", fontSize: 14 }}>★</button>))}
                    </div>
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                  <Field label="Execution Link"><input type="url" value={form.execLink} onChange={e => setForm({ ...form, execLink: e.target.value })} placeholder="https://tradingview.com/..." style={inputS} /></Field>
                  <Field label="Bias Link"><input type="url" value={form.biasLink} onChange={e => setForm({ ...form, biasLink: e.target.value })} placeholder="https://..." style={inputS} /></Field>
                </div>
                <Field label="Notes" style={{ marginTop: 12 }}><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Trade review..." style={{ ...inputS, resize: "vertical" }} /></Field>
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={saveTrade} style={btnP}>{editId ? "Update" : "Save Trade"}</button>
                  <button onClick={() => { setShowForm(false); setEditId(null); }} style={btnG}>Cancel</button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ ...inputS, width: 160, fontSize: 11, padding: "7px 10px" }} />
              <select value={fPair} onChange={e => setFPair(e.target.value)} style={{ ...selectS, width: 110, fontSize: 11, padding: "7px 10px" }}><option value="All">All Pairs</option>{PAIRS.map(p => <option key={p} value={p}>{p}</option>)}</select>
              <select value={fResult} onChange={e => setFResult(e.target.value)} style={{ ...selectS, width: 100, fontSize: 11, padding: "7px 10px" }}><option value="All">All Results</option><option>Win</option><option>Loss</option><option>Breakeven</option></select>
              <select value={fDay} onChange={e => setFDay(e.target.value)} style={{ ...selectS, width: 110, fontSize: 11, padding: "7px 10px" }}><option value="All">All Days</option>{DAYS_W.map(d => <option key={d} value={d}>{d}</option>)}</select>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {!showForm && <button onClick={() => { setForm(emptyTrade()); setEditId(null); setShowForm(true); }} style={{ ...btnP, fontSize: 11, padding: "6px 14px" }}>+ Add</button>}
                <button onClick={resetAll} style={{ ...btnG, color: T.red, borderColor: T.red + "40", fontSize: 10 }}>Reset</button>
              </div>
            </div>

            <div style={{ ...cardS, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: mono }}>
                <thead><tr style={{ background: T.cardAlt }}>
                  {[{ k: "date", l: "Date" }, { k: "day", l: "Day" }, { k: "session", l: "Session" }, { k: "pair", l: "Pair" }, { k: "direction", l: "Dir" }, { k: "risk", l: "Risk" }, { k: "entry", l: "Entry" }, { k: "exit", l: "Exit" }, { k: "rr", l: "R:R" }, { k: "pnlPct", l: "PnL" }, { k: "result", l: "Result" }, { k: "biasType", l: "Bias" }, { k: "rating", l: "★" }].map(c => (
                    <th key={c.k} onClick={() => toggleSort(c.k)} style={{ textAlign: "left", padding: "10px 7px", color: T.textLight, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", borderBottom: `1px solid ${T.border}`, fontFamily: mono }}>{c.l}{sortCol === c.k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</th>
                  ))}
                  <th style={{ padding: "10px 7px", color: T.textLight, fontSize: 9, borderBottom: `1px solid ${T.border}`, fontFamily: mono }}>LINKS</th>
                  <th style={{ padding: "10px 7px", width: 55, borderBottom: `1px solid ${T.border}` }}></th>
                </tr></thead>
                <tbody>
                  {filtered.map((t, i) => (
                    <tr key={t.id} style={{ background: i % 2 === 0 ? T.card : T.cardAlt }}>
                      <td style={{ padding: "8px 7px", whiteSpace: "nowrap", borderBottom: `1px solid ${T.borderLight}` }}>{t.date}</td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, fontSize: 10, color: T.textMid }}>{t.day?.substring(0, 3)}</td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, fontSize: 10, color: T.textMid }}>{t.session}</td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}><Pill text={t.pair} type="pair" /></td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}><Pill text={t.direction} /></td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}>{t.risk}%</td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}>{t.entry}</td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}>{t.exit}</td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}>{t.rr || "—"}</td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, fontWeight: 600 }}>
                        <span style={{ color: cP(t.pnlPct) }}>{fP(t.pnlPct)}</span><br />
                        <span style={{ fontSize: 9, color: T.textLight }}>{fU(t.pnlUsd)}</span>
                      </td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}><Pill text={t.result} /></td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, fontSize: 10, color: T.textMid }}>{t.biasType}</td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, color: T.amber }}>{"★".repeat(t.rating || 0)}</td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, whiteSpace: "nowrap" }}>
                        {t.execLink && <a href={t.execLink} target="_blank" rel="noreferrer" style={{ color: T.blue, fontSize: 9, marginRight: 5, textDecoration: "none", fontWeight: 600 }}>Chart</a>}
                        {t.biasLink && <a href={t.biasLink} target="_blank" rel="noreferrer" style={{ color: T.purple, fontSize: 9, textDecoration: "none", fontWeight: 600 }}>Bias</a>}
                      </td>
                      <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}>
                        <button onClick={() => editTrade(t)} style={{ background: "none", border: "none", cursor: "pointer", color: T.amber, fontSize: 12, padding: "2px" }}>✎</button>
                        <button onClick={() => deleteTrade(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: 12, padding: "2px" }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div style={{ textAlign: "center", padding: 40, color: T.textLight }}>No trades</div>}
            </div>
          </div>
        )}

        {/* ═══ PAIRS ═══ */}
        {tab === "pairs" && S && (() => {
          const active = PAIRS.filter(p => S.pair[p].n > 0).sort((a, b) => S.pair[b].pnl - S.pair[a].pnl);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {active.length > 0 && (
                <div style={{ ...cardS, padding: 18 }}>
                  <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 10 }}>PnL by Pair</div>
                  <ResponsiveContainer width="100%" height={Math.max(active.length * 28, 80)}>
                    <BarChart data={active.map(p => ({ pair: p, pnl: Math.round(S.pair[p].pnl * 100) / 100 }))} layout="vertical" margin={{ left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.borderLight} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: T.textLight, fontFamily: mono }} tickLine={false} axisLine={false} />
                      <YAxis dataKey="pair" type="category" tick={{ fontSize: 10, fill: T.textMid, fontFamily: mono }} tickLine={false} axisLine={false} width={55} />
                      <Tooltip contentStyle={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, fontFamily: mono, fontSize: 11 }} />
                      <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>{active.map((p, i) => <Cell key={i} fill={S.pair[p].pnl >= 0 ? T.green : T.red} opacity={0.75} />)}</Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div style={{ ...cardS, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: mono }}>
                  <thead><tr style={{ background: T.cardAlt }}>
                    {["Pair", "Trades", "W", "L", "BE", "WR%", "PnL %", "PnL $", "Avg"].map(h => <th key={h} style={{ textAlign: "left", padding: "10px 8px", color: T.textLight, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {active.map((p, i) => { const ps = S.pair[p]; const wr = ps.w / (ps.w + ps.l || 1) * 100; return (
                      <tr key={p} style={{ background: i % 2 === 0 ? T.card : T.cardAlt }}>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${T.borderLight}` }}><Pill text={p} type="pair" /></td>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${T.borderLight}` }}>{ps.n}</td>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${T.borderLight}`, color: T.green }}>{ps.w}</td>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${T.borderLight}`, color: T.red }}>{ps.l}</td>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${T.borderLight}`, color: T.textMid }}>{ps.be}</td>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${T.borderLight}`, color: wr >= 50 ? T.green : T.red, fontWeight: 600 }}>{wr.toFixed(1)}%</td>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${T.borderLight}`, color: cP(ps.pnl), fontWeight: 600 }}>{fP(ps.pnl)}</td>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${T.borderLight}`, color: cP(ps.usd) }}>{fU(ps.usd)}</td>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${T.borderLight}`, color: cP(ps.pnl / Math.max(ps.n, 1)) }}>{fP(ps.pnl / Math.max(ps.n, 1))}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
              {active.length === 0 && <div style={{ ...cardS, padding: 40, textAlign: "center", color: T.textLight }}>No pair data yet</div>}
            </div>
          );
        })()}
        {tab === "pairs" && !S && <div style={{ ...cardS, padding: 40, textAlign: "center", color: T.textLight }}>No data yet</div>}

        {/* ═══ MONTHLY ═══ */}
        {tab === "monthly" && S && Object.keys(S.mo).length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Object.keys(S.mo).sort().reverse().map(m => { const mm = S.mo[m]; const wr = mm.w / (mm.w + mm.l || 1) * 100; const monthTrades = trades.filter(t => t.date?.startsWith(m)).sort((a, b) => a.date.localeCompare(b.date)); return (
              <div key={m} style={{ ...cardS, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, fontFamily: mono }}>{m}</span>
                  <div style={{ display: "flex", gap: 14, fontSize: 11, fontFamily: mono }}>
                    <span>{mm.n}T</span><span style={{ color: T.green }}>{mm.w}W</span><span style={{ color: T.red }}>{mm.l}L</span>
                    <span style={{ color: wr >= 50 ? T.green : T.red, fontWeight: 600 }}>{wr.toFixed(0)}%</span>
                    <span style={{ color: cP(mm.pnl), fontWeight: 700 }}>{fP(mm.pnl)}</span>
                    <span style={{ color: cP(mm.usd), fontWeight: 600 }}>{fU(mm.usd)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {monthTrades.map(t => (
                    <div key={t.id} title={`${t.date} ${t.pair} ${t.direction} ${fP(t.pnlPct)}`} onClick={() => editTrade(t)} style={{
                      width: 30, height: 30, borderRadius: 6, ...center, fontSize: 8, fontFamily: mono, fontWeight: 600, cursor: "pointer",
                      background: t.result === "Win" ? T.greenBg : t.result === "Loss" ? T.redBg : T.cardAlt,
                      color: t.result === "Win" ? T.green : t.result === "Loss" ? T.red : T.textMid,
                      border: `1px solid ${t.result === "Win" ? T.green + "30" : t.result === "Loss" ? T.red + "30" : T.border}`,
                    }}>{t.date.split("-")[2]}</div>
                  ))}
                </div>
              </div>
            ); })}
          </div>
        ) : tab === "monthly" && <div style={{ ...cardS, padding: 40, textAlign: "center", color: T.textLight }}>No monthly data</div>}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════
export default function App() {
  const [page, setPage] = useState("journal");

  const navStyle = (active) => ({
    background: "none", border: "none", color: active ? "#fff" : "rgba(255,255,255,0.5)",
    padding: "10px 16px", fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer",
    fontFamily: font, letterSpacing: 0.3, transition: "all 0.2s",
    borderBottom: active ? `2px solid ${T.accent}` : "2px solid transparent",
  });

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: font, color: T.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Top Nav */}
      <div style={{ background: T.headerBg, padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 0" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: T.accent, boxShadow: `0 0 8px ${T.accent}66` }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: 1.5, fontFamily: font }}>VARMARI</span>
          </div>
          <div style={{ display: "flex", gap: 0, marginLeft: 12 }}>
            <button onClick={() => setPage("journal")} style={navStyle(page === "journal")}>Trading Journal</button>
            <button onClick={() => setPage("calculator")} style={navStyle(page === "calculator")}>Position Calculator</button>
          </div>
        </div>
      </div>

      {page === "journal" && <Journal />}
      {page === "calculator" && <PositionCalc />}

      <div style={{ padding: "16px 28px", textAlign: "center", fontSize: 10, color: T.textLight, fontFamily: mono, borderTop: `1px solid ${T.border}`, marginTop: 20 }}>
        VARMARI · Macro Intelligence & Trading Infrastructure
      </div>
    </div>
  );
}

