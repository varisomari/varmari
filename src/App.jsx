import { useState, useEffect, useMemo, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, CartesianGrid, ReferenceLine, LineChart, Line } from "recharts";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// ── Supabase client ──
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Constants ──
const DEFAULT_PAIRS = [
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

// Parse "1:2.5" or "2.5" → numeric reward multiple. Returns null if unparseable.
const parseRR = (rr) => {
  if (rr == null) return null;
  const s = String(rr).trim();
  if (!s) return null;
  if (s.indexOf(":") !== -1) {
    const parts = s.split(":").map(p => parseFloat(p.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] !== 0) return parts[1] / parts[0];
    return null;
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

// Realized R = pnl_pct / risk%. e.g. risk 1%, gained 2.5% → +2.5R
const realizedR = (t) => {
  const risk = parseFloat(t.risk);
  const pnl = parseFloat(t.pnl_pct);
  if (!risk || isNaN(pnl)) return null;
  return pnl / risk;
};

// Date helpers — operate strictly in LOCAL time to avoid UTC drift.
// Critical: never use toISOString() on a Date because that converts to UTC,
// which can shift the date by 1 in non-UTC timezones (e.g. Dubai is UTC+4 → late evening flips a day).
const pad2 = n => String(n).padStart(2, "0");
const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Parse a "YYYY-MM-DD" date string into a Date object at LOCAL noon (avoids DST/timezone edge cases).
const parseLocalDate = (s) => {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate(), 12, 0, 0, 0);
  if (typeof s !== "string") return new Date();
  const parts = s.split("-");
  if (parts.length !== 3) return new Date(s);
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0, 0);
};

const startOfWeek = (date) => {
  // Take the date, set it to local noon, then walk back to the Monday of that week.
  const d = (date instanceof Date) ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0) : parseLocalDate(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d;
};
const endOfWeek = (date) => {
  const s = startOfWeek(date);
  const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6, 12, 0, 0, 0);
  return e;
};
const startOfMonth = (date) => {
  const d = (date instanceof Date) ? date : parseLocalDate(date);
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0);
};
const endOfMonth = (date) => {
  const d = (date instanceof Date) ? date : parseLocalDate(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0, 0);
};
const formatPeriodLabel = (type, startISO) => {
  const d = parseLocalDate(startISO);
  if (type === "week") {
    // Re-derive Monday and Sunday from the saved start date in case it drifted before.
    const monday = startOfWeek(d);
    const sunday = endOfWeek(d);
    const sM = monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const eM = sunday.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return `Week of ${sM} – ${eM}`;
  }
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

const emptyTrade = () => ({
  date: new Date().toISOString().split("T")[0],
  session: "London", pair: "EUR/USD", risk: 1, direction: "Long",
  entry: "", exit: "", rr: "", max_r: "", pnl_pct: "", result: "Win",
  bias_type: "Confirmation", rating: 3, exec_link: "", bias_link: "",
  notes_technical: "", notes_fundamental: "", notes_mistakes: "",
});

const emptyRecap = () => ({
  worked_text: "", didnt_work_text: "", pattern_text: "", change_text: "", conviction: 3,
});

// ── Reusable styles ──
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

// ══════════════════════════════════════════
// REUSABLE COMPONENTS
// ══════════════════════════════════════════
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
// LOGIN SCREEN
// ══════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setLoading(true); setError("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    onLogin(data.user);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, ...center, fontFamily: font, padding: 20 }}>
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ ...cardS, padding: 36, width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.accent, boxShadow: `0 0 10px ${T.accent}88` }} />
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, fontFamily: font }}>VARMARI</span>
          </div>
          <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: mono }}>Sign in to continue</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputS} placeholder="you@example.com" /></Field>
          <Field label="Password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} style={inputS} placeholder="••••••••" /></Field>
          {error && <div style={{ fontSize: 12, color: T.red, background: T.redBg, padding: 10, borderRadius: 8, fontFamily: mono }}>{error}</div>}
          <button onClick={handleLogin} disabled={loading || !email || !password} style={{ ...btnP, padding: "12px", marginTop: 6, opacity: loading ? 0.6 : 1 }}>{loading ? "Signing in..." : "Sign In"}</button>
        </div>
        <div style={{ marginTop: 18, fontSize: 10, color: T.textLight, fontFamily: mono, textAlign: "center", lineHeight: 1.6 }}>
          Invite-only. Contact admin for access.
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// POSITION SIZE CALCULATOR (UNCHANGED)
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
        <div ref={wrapRef} style={{ position: "relative" }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Instrument</label>
          <div style={{ display: "flex", alignItems: "center", background: T.cardAlt, border: `1px solid ${T.border}`, borderRadius: dropOpen ? "10px 10px 0 0" : 10, padding: "0 12px" }}>
            <input type="text" value={dropOpen ? search : (selected?.label || "")} placeholder="Search..."
              onFocus={() => { setDropOpen(true); setSearch(""); }}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: T.text, fontFamily: mono, fontSize: 15, padding: "12px 0", width: "100%" }} />
            <span style={{ color: T.textLight, fontSize: 10, transform: dropOpen ? "rotate(180deg)" : "none" }}>▼</span>
          </div>
          {dropOpen && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: T.card, border: `1px solid ${T.border}`, borderTop: "none", borderRadius: "0 0 10px 10px", maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
              {filteredInst.length === 0 ? <div style={{ padding: "12px 14px", color: T.textLight, fontSize: 13 }}>No results</div>
               : filteredInst.map(inst => (
                <div key={inst.id} onMouseDown={(ev) => { ev.preventDefault(); setSelected(inst); setSearch(inst.label); setDropOpen(false); }}
                  style={{ padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: selected?.id === inst.id ? T.cardAlt : "transparent" }}>
                  <span style={{ fontFamily: mono, fontSize: 13, color: T.text }}>{inst.label}</span>
                  <span style={{ fontSize: 10, color: catColor[inst.cat] || T.textLight, fontFamily: mono, letterSpacing: 0.5 }}>{inst.cat}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Entry Price</label>
          <input type="number" inputMode="decimal" value={entry} onChange={e => setEntry(e.target.value)} placeholder="0" style={{ ...inputS, padding: "12px" }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Stop Loss</label>
          <input type="number" inputMode="decimal" value={sl} onChange={e => setSl(e.target.value)} placeholder="0" style={{ ...inputS, padding: "12px" }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Risk Amount ($)</label>
          <input type="number" inputMode="decimal" value={risk} onChange={e => setRisk(e.target.value)} placeholder="0" style={{ ...inputS, padding: "12px" }} />
        </div>
      </div>
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
            <div style={{ background: T.cardAlt, borderRadius: 10, padding: "11px 13px" }}><div style={{ fontSize: 11, color: T.textLight, marginBottom: 3 }}>SL Pips</div><div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: T.red }}>{fmtN(slPips, 1)}</div></div>
            <div style={{ background: T.cardAlt, borderRadius: 10, padding: "11px 13px" }}><div style={{ fontSize: 11, color: T.textLight, marginBottom: 3 }}>SL %</div><div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: T.red }}>{fmtN(slPct)}%</div></div>
            <div style={{ background: T.cardAlt, borderRadius: 10, padding: "11px 13px" }}><div style={{ fontSize: 11, color: T.textLight, marginBottom: 3 }}>$ at Risk</div><div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: T.accent }}>${fmtN(r)}</div></div>
            <div style={{ background: T.cardAlt, borderRadius: 10, padding: "11px 13px" }}><div style={{ fontSize: 11, color: T.textLight, marginBottom: 3 }}>Pip Value</div><div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: T.textMid }}>${selected.pipVal}/lot</div></div>
          </div>
        </div>
      )}
      <div style={{ textAlign: "center", marginTop: 14, fontSize: 10, color: T.textLight, fontFamily: mono }}>Pip values approximate. Verify with broker.</div>
    </div>
  );
}

// ══════════════════════════════════════════
// ACCOUNT MANAGER MODAL (UNCHANGED)
// ══════════════════════════════════════════
function AccountModal({ accounts, activeId, onClose, onCreate, onDelete, onSelect }) {
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("100000");

  const handleCreate = async () => {
    if (!name.trim()) return;
    await onCreate(name.trim(), parseFloat(balance) || 100000);
    setName(""); setBalance("100000");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", ...center, zIndex: 1000, padding: 20 }}>
      <div style={{ ...cardS, padding: 24, width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Manage Accounts</span>
          <button onClick={onClose} style={btnG}>✕</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>Your Accounts</div>
          {accounts.length === 0 ? <div style={{ color: T.textLight, fontSize: 13, padding: 12 }}>No accounts yet. Create one below.</div>
           : accounts.map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: a.id === activeId ? T.accentBg : T.cardAlt, borderRadius: 8, marginBottom: 6, border: a.id === activeId ? `1px solid ${T.accent}` : `1px solid transparent` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{a.name}</div>
                <div style={{ fontSize: 11, color: T.textLight, fontFamily: mono }}>Starting: ${a.starting_balance.toLocaleString()}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {a.id !== activeId && <button onClick={() => onSelect(a.id)} style={{ ...btnG, fontSize: 10, padding: "5px 10px" }}>Select</button>}
                {a.id === activeId && <span style={{ fontSize: 10, color: T.accent, fontFamily: mono, fontWeight: 600, padding: "5px 10px" }}>ACTIVE</span>}
                <button onClick={() => onDelete(a.id)} style={{ ...btnG, fontSize: 10, padding: "5px 10px", color: T.red, borderColor: T.red + "40" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
          <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>Create New Account</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 10 }}>
            <Field label="Name"><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Prop $100k" style={inputS} /></Field>
            <Field label="Starting Balance"><input type="number" value={balance} onChange={e => setBalance(e.target.value)} style={inputS} /></Field>
          </div>
          <button onClick={handleCreate} style={{ ...btnP, width: "100%" }}>+ Create Account</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// PAIRS MANAGER MODAL (NEW)
// ══════════════════════════════════════════
function PairsModal({ pairs, onClose, onAdd, onUpdate, onDelete, onResetDefaults }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    await onAdd(name);
    setNewName("");
  };

  const handleStartEdit = (p) => { setEditingId(p.id); setEditValue(p.name); };
  const handleSaveEdit = async () => {
    if (!editValue.trim()) return;
    await onUpdate(editingId, editValue.trim());
    setEditingId(null); setEditValue("");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", ...center, zIndex: 1000, padding: 20 }}>
      <div style={{ ...cardS, padding: 24, width: "100%", maxWidth: 540, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Manage Pairs</span>
          <button onClick={onClose} style={btnG}>✕</button>
        </div>

        <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>Add New Pair</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAdd()} placeholder="e.g. EUR/USD or XAU/USD" style={inputS} />
            <button onClick={handleAdd} style={{ ...btnP, padding: "9px 16px", whiteSpace: "nowrap" }}>+ Add</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>Your Pairs ({pairs.length})</div>
          {pairs.length === 0 ? (
            <div style={{ color: T.textLight, fontSize: 13, padding: 16, textAlign: "center" }}>
              No pairs yet. Click "Restore Default List" or add your own above.
            </div>
          ) : pairs.map(p => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: T.cardAlt, borderRadius: 8, marginBottom: 4 }}>
              {editingId === p.id ? (
                <>
                  <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") { setEditingId(null); setEditValue(""); } }} autoFocus style={{ ...inputS, flex: 1, marginRight: 8 }} />
                  <button onClick={handleSaveEdit} style={{ ...btnG, fontSize: 11, padding: "5px 12px", color: T.green, borderColor: T.green + "40" }}>Save</button>
                  <button onClick={() => { setEditingId(null); setEditValue(""); }} style={{ ...btnG, fontSize: 11, padding: "5px 10px", marginLeft: 4 }}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ fontFamily: mono, fontSize: 13, color: T.text }}>{p.name}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handleStartEdit(p)} style={{ ...btnG, fontSize: 10, padding: "4px 10px" }}>Edit</button>
                    <button onClick={() => onDelete(p.id)} style={{ ...btnG, fontSize: 10, padding: "4px 10px", color: T.red, borderColor: T.red + "40" }}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <button onClick={onResetDefaults} style={{ ...btnG, fontSize: 11, color: T.textMid }}>Restore Default List</button>
          <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>Existing trades keep their pair names</span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// RECAP TAB (NEW) — declared before Journal so it's in scope
// ══════════════════════════════════════════
function RecapTab({ user, accounts, activeAccount }) {
  const [periodType, setPeriodType] = useState("week");
  const [periodDate, setPeriodDate] = useState(new Date());
  const [recap, setRecap] = useState(emptyRecap());
  const [recapId, setRecapId] = useState(null);
  const [periodTrades, setPeriodTrades] = useState([]);
  const [pastRecaps, setPastRecaps] = useState([]);
  const [scope, setScope] = useState("active"); // "active" | "all" | account.id
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [expandedTrades, setExpandedTrades] = useState({});
  const [neighborCounts, setNeighborCounts] = useState({ prev: null, next: null });

  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    const s = periodType === "week" ? startOfWeek(periodDate) : startOfMonth(periodDate);
    const e = periodType === "week" ? endOfWeek(periodDate) : endOfMonth(periodDate);
    return { periodStart: isoDate(s), periodEnd: isoDate(e), periodLabel: formatPeriodLabel(periodType, isoDate(s)) };
  }, [periodType, periodDate]);

  const effectiveAccountId = useMemo(() => {
    if (scope === "all") return null;
    if (scope === "active") return activeAccount?.id || null;
    return scope;
  }, [scope, activeAccount]);

  // Load trades + existing recap for this period
  useEffect(() => {
    const load = async () => {
      let q = supabase.from("trades").select("*").gte("date", periodStart).lte("date", periodEnd).order("date", { ascending: true });
      if (effectiveAccountId) q = q.eq("account_id", effectiveAccountId);
      else q = q.eq("user_id", user.id);
      const { data: tx } = await q;
      setPeriodTrades(tx || []);

      let rq = supabase.from("recaps").select("*").eq("period_type", periodType).eq("period_start", periodStart).eq("user_id", user.id);
      if (effectiveAccountId) rq = rq.eq("account_id", effectiveAccountId);
      else rq = rq.is("account_id", null);
      const { data: rRows } = await rq;
      const rRow = rRows && rRows.length > 0 ? rRows[0] : null;
      if (rRow) {
        setRecap({
          worked_text: rRow.worked_text || "",
          didnt_work_text: rRow.didnt_work_text || "",
          pattern_text: rRow.pattern_text || "",
          change_text: rRow.change_text || "",
          conviction: rRow.conviction || 3,
        });
        setRecapId(rRow.id);
        setSavedAt(rRow.updated_at || rRow.created_at);
      } else {
        setRecap(emptyRecap());
        setRecapId(null);
        setSavedAt(null);
      }
      setExpandedTrades({});
    };
    load();
  }, [periodStart, periodEnd, periodType, effectiveAccountId, user.id]);

  // Load past recaps list
  useEffect(() => {
    const loadPast = async () => {
      let q = supabase.from("recaps").select("*").eq("period_type", periodType).eq("user_id", user.id).order("period_start", { ascending: false }).limit(30);
      if (effectiveAccountId) q = q.eq("account_id", effectiveAccountId);
      else q = q.is("account_id", null);
      const { data } = await q;
      setPastRecaps(data || []);
    };
    loadPast();
  }, [periodType, effectiveAccountId, savedAt, user.id]);

  const periodStats = useMemo(() => {
    const n = periodTrades.length;
    if (n === 0) return null;
    const w = periodTrades.filter(t => t.result === "Win"), l = periodTrades.filter(t => t.result === "Loss"), b = periodTrades.filter(t => t.result === "Breakeven");
    const wr = (w.length + l.length) > 0 ? (w.length / (w.length + l.length)) * 100 : 0;
    const tPnl = periodTrades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
    const tUsd = periodTrades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
    const best = periodTrades.reduce((m, t) => Math.max(m, parseFloat(t.pnl_pct) || -Infinity), -Infinity);
    const worst = periodTrades.reduce((m, t) => Math.min(m, parseFloat(t.pnl_pct) || Infinity), Infinity);
    const rValues = periodTrades.map(realizedR).filter(v => v != null);
    const totalR = rValues.reduce((s, v) => s + v, 0);
    const pairCounts = {};
    periodTrades.forEach(t => { if (t.pair) pairCounts[t.pair] = (pairCounts[t.pair] || 0) + 1; });
    const topPair = Object.entries(pairCounts).sort((a, b) => b[1] - a[1])[0];

    // Period MFE / Exit Quality — winners only
    const mfePairs = periodTrades.filter(t => t.result === "Win").map(t => {
      const mfe = parseRR(t.max_r);
      const real = realizedR(t);
      if (mfe == null || real == null) return null;
      return { mfe, real, left: Math.max(0, mfe - real) };
    }).filter(x => x != null);
    let totalLeftOnTable = null, captureRate = null, mfeCount = mfePairs.length;
    if (mfeCount > 0) {
      totalLeftOnTable = mfePairs.reduce((s, x) => s + x.left, 0);
      const totalMFE = mfePairs.reduce((s, x) => s + x.mfe, 0);
      const totalReal = mfePairs.reduce((s, x) => s + x.real, 0);
      if (totalMFE > 0) captureRate = (totalReal / totalMFE) * 100;
    }

    return { n, w: w.length, l: l.length, be: b.length, wr, tPnl, tUsd, best: isFinite(best) ? best : null, worst: isFinite(worst) ? worst : null, totalR, topPair, totalLeftOnTable, captureRate, mfeCount };
  }, [periodTrades]);

  // Trades that have at least one note filled in
  const tradesWithNotes = useMemo(() => {
    return periodTrades.filter(t => (t.notes_technical || "").trim() || (t.notes_fundamental || "").trim() || (t.notes_mistakes || "").trim());
  }, [periodTrades]);

  // Auto-expand if 10 or fewer trades with notes
  useEffect(() => {
    if (tradesWithNotes.length > 0 && tradesWithNotes.length <= 10 && Object.keys(expandedTrades).length === 0) {
      const all = {};
      tradesWithNotes.forEach(t => { all[t.id] = true; });
      setExpandedTrades(all);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradesWithNotes.length]);

  const toggleTradeExpanded = (id) => setExpandedTrades(p => ({ ...p, [id]: !p[id] }));
  const expandAll = () => { const all = {}; tradesWithNotes.forEach(t => { all[t.id] = true; }); setExpandedTrades(all); };
  const collapseAll = () => setExpandedTrades({});

  // Compute prev/next period boundaries and fetch trade counts for them
  useEffect(() => {
    const computeBoundaries = (offsetUnits) => {
      const d = new Date(periodDate.getFullYear(), periodDate.getMonth(), periodDate.getDate(), 12, 0, 0, 0);
      if (periodType === "week") d.setDate(d.getDate() + offsetUnits * 7);
      else d.setMonth(d.getMonth() + offsetUnits);
      const s = periodType === "week" ? startOfWeek(d) : startOfMonth(d);
      const e = periodType === "week" ? endOfWeek(d) : endOfMonth(d);
      return { start: isoDate(s), end: isoDate(e) };
    };
    const fetchCount = async (range) => {
      let q = supabase.from("trades").select("id", { count: "exact", head: true }).gte("date", range.start).lte("date", range.end);
      if (effectiveAccountId) q = q.eq("account_id", effectiveAccountId);
      else q = q.eq("user_id", user.id);
      const { count } = await q;
      return count || 0;
    };
    const load = async () => {
      const prev = computeBoundaries(-1);
      const next = computeBoundaries(1);
      const [pc, nc] = await Promise.all([fetchCount(prev), fetchCount(next)]);
      setNeighborCounts({ prev: pc, next: nc });
    };
    load();
  }, [periodStart, periodEnd, periodType, effectiveAccountId, user.id]);

  // Jump helpers: This Week / Last Week / This Month / Last Month
  const jumpToCurrent = () => setPeriodDate(new Date());
  const jumpToPrevious = () => {
    const d = new Date();
    if (periodType === "week") d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setPeriodDate(d);
  };

  // Determine if currently viewing the "current" period (this week or this month)
  const todayISO = isoDate(new Date());
  const isViewingCurrent = todayISO >= periodStart && todayISO <= periodEnd;

  const saveRecap = async () => {
    setSaving(true);
    const payload = {
      user_id: user.id,
      account_id: effectiveAccountId,
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      worked_text: recap.worked_text,
      didnt_work_text: recap.didnt_work_text,
      pattern_text: recap.pattern_text,
      change_text: recap.change_text,
      conviction: recap.conviction,
      updated_at: new Date().toISOString(),
    };
    let result;
    if (recapId) {
      result = await supabase.from("recaps").update(payload).eq("id", recapId).select().single();
    } else {
      result = await supabase.from("recaps").insert(payload).select().single();
    }
    setSaving(false);
    if (result.error) { alert("Save failed: " + result.error.message); return; }
    setRecapId(result.data.id);
    setSavedAt(result.data.updated_at || result.data.created_at);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const shiftPeriod = (dir) => {
    const d = new Date(periodDate.getFullYear(), periodDate.getMonth(), periodDate.getDate(), 12, 0, 0, 0);
    if (periodType === "week") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setPeriodDate(d);
  };

  const jumpTo = (recapRow) => {
    setPeriodType(recapRow.period_type);
    setPeriodDate(parseLocalDate(recapRow.period_start));
  };

  const scopeLabel = scope === "all" ? "All Accounts" : (scope === "active" ? `${activeAccount?.name || "—"}` : (accounts.find(a => a.id === scope)?.name || "—"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Period selector */}
      <div style={{ ...cardS, padding: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 0 }}>
            <button onClick={() => setPeriodType("week")} style={{ ...btnG, background: periodType === "week" ? T.accent : "transparent", color: periodType === "week" ? "#fff" : T.textMid, borderColor: periodType === "week" ? T.accent : T.border, borderRadius: "8px 0 0 8px" }}>Weekly</button>
            <button onClick={() => setPeriodType("month")} style={{ ...btnG, background: periodType === "month" ? T.accent : "transparent", color: periodType === "month" ? "#fff" : T.textMid, borderColor: periodType === "month" ? T.accent : T.border, borderRadius: "0 8px 8px 0", borderLeft: "none" }}>Monthly</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => shiftPeriod(-1)} style={{ ...btnG, padding: "6px 12px" }}>← Prev</button>
            <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, padding: "0 12px", minWidth: 220, textAlign: "center" }}>{periodLabel}</div>
            <button onClick={() => shiftPeriod(1)} style={{ ...btnG, padding: "6px 12px" }}>Next →</button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={jumpToPrevious} style={{ ...btnG, padding: "6px 12px", fontSize: 11, color: T.textMid }}>← {periodType === "week" ? "Last Week" : "Last Month"}</button>
            <button onClick={jumpToCurrent} style={{ ...btnG, padding: "6px 12px", fontSize: 11, color: isViewingCurrent ? T.textLight : T.accent, borderColor: isViewingCurrent ? T.border : T.accent + "60", fontWeight: 600 }}>{periodType === "week" ? "This Week" : "This Month"}</button>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono, letterSpacing: 1 }}>SCOPE:</span>
            <select value={scope} onChange={e => setScope(e.target.value)} style={{ ...selectS, fontSize: 11, padding: "7px 10px", width: "auto" }}>
              <option value="active">Active: {activeAccount?.name || "—"}</option>
              <option value="all">All Accounts Combined</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        {/* Trade count status row — shows where the trades are */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.borderLight}`, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", fontSize: 11, fontFamily: mono, color: T.textMid }}>
          <span style={{ color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontSize: 9 }}>Trade Counts:</span>
          <button onClick={() => shiftPeriod(-1)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: T.textMid, fontFamily: mono, fontSize: 11 }}>
            ← Previous: <span style={{ color: neighborCounts.prev > 0 ? T.text : T.textLight, fontWeight: 600 }}>{neighborCounts.prev == null ? "…" : `${neighborCounts.prev} trade${neighborCounts.prev === 1 ? "" : "s"}`}</span>
          </button>
          <span>·</span>
          <span>
            Viewing: <span style={{ color: periodTrades.length > 0 ? T.accent : T.textLight, fontWeight: 700 }}>{periodTrades.length} trade{periodTrades.length === 1 ? "" : "s"}</span>
            {isViewingCurrent && <span style={{ color: T.green, marginLeft: 6, fontWeight: 600 }}>· this {periodType === "week" ? "week" : "month"}</span>}
          </span>
          <span>·</span>
          <button onClick={() => shiftPeriod(1)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: T.textMid, fontFamily: mono, fontSize: 11 }}>
            Next: <span style={{ color: neighborCounts.next > 0 ? T.text : T.textLight, fontWeight: 600 }}>{neighborCounts.next == null ? "…" : `${neighborCounts.next} trade${neighborCounts.next === 1 ? "" : "s"}`}</span> →
          </button>
        </div>
      </div>

      {/* Period stats */}
      <div style={{ ...cardS, padding: 18 }}>
        <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 12 }}>
          Period Stats · {scopeLabel}
        </div>
        {periodStats ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            <Stat label="Trades" value={periodStats.n} sub={`${periodStats.w}W / ${periodStats.l}L / ${periodStats.be}BE`} />
            <Stat label="Win Rate" value={`${periodStats.wr.toFixed(1)}%`} color={periodStats.wr >= 50 ? T.green : T.red} />
            <Stat label="Total PnL %" value={fP(periodStats.tPnl)} color={cP(periodStats.tPnl)} />
            <Stat label="Total PnL $" value={fU(periodStats.tUsd)} color={cP(periodStats.tUsd)} />
            <Stat label="Best Trade" value={periodStats.best != null ? fP(periodStats.best) : "—"} color={T.green} />
            <Stat label="Worst Trade" value={periodStats.worst != null ? fP(periodStats.worst) : "—"} color={T.red} />
            <Stat label="Most Traded" value={periodStats.topPair ? periodStats.topPair[0] : "—"} sub={periodStats.topPair ? `${periodStats.topPair[1]} trades` : ""} />
            {periodStats.mfeCount > 0 && (
              <>
                <Stat label="Capture Rate" value={periodStats.captureRate != null ? `${periodStats.captureRate.toFixed(0)}%` : "—"} color={periodStats.captureRate != null && periodStats.captureRate >= 60 ? T.green : periodStats.captureRate != null && periodStats.captureRate >= 40 ? T.amber : T.red} sub={`${periodStats.mfeCount} winner${periodStats.mfeCount === 1 ? "" : "s"} w/ MFE`} />
                <Stat label="Left on Table" value={`-${periodStats.totalLeftOnTable.toFixed(2)}R`} color={T.red} sub="missed gains" />
              </>
            )}
          </div>
        ) : (
          <div style={{ color: T.textLight, fontSize: 13, padding: 20, textAlign: "center" }}>No trades in this period.</div>
        )}
      </div>

      {/* TRADE NOTES FROM PERIOD (NEW) */}
      <div style={{ ...cardS, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>
            Trade Notes from this Period · {tradesWithNotes.length} trade{tradesWithNotes.length === 1 ? "" : "s"} with notes
          </span>
          {tradesWithNotes.length > 0 && (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={expandAll} style={{ ...btnG, fontSize: 10, padding: "4px 10px" }}>Expand All</button>
              <button onClick={collapseAll} style={{ ...btnG, fontSize: 10, padding: "4px 10px" }}>Collapse All</button>
            </div>
          )}
        </div>
        {tradesWithNotes.length === 0 ? (
          <div style={{ color: T.textLight, fontSize: 13, padding: 24, textAlign: "center", fontStyle: "italic" }}>
            {periodTrades.length === 0 ? "No trades in this period." : "No trades in this period have notes filled in."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tradesWithNotes.map(t => {
              const open = !!expandedTrades[t.id];
              return (
                <div key={t.id} style={{ background: T.cardAlt, borderRadius: 8, border: `1px solid ${T.borderLight}`, overflow: "hidden" }}>
                  <div onClick={() => toggleTradeExpanded(t.id)} style={{ padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono, minWidth: 70 }}>{t.date}</span>
                      <Pill text={t.pair} type="pair" />
                      <Pill text={t.direction} />
                      <Pill text={t.result} />
                      {t.session && <span style={{ fontSize: 10, color: T.textMid, fontFamily: mono }}>{t.session}</span>}
                      {t.bias_type && t.bias_type !== "None" && <span style={{ fontSize: 10, color: T.purple, fontFamily: mono }}>{t.bias_type}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, color: cP(t.pnl_pct) }}>{fP(t.pnl_pct)}</span>
                      <span style={{ fontSize: 11, color: T.textLight, fontFamily: mono }}>{fU(t.pnl_usd)}</span>
                      <span style={{ fontSize: 11, color: T.amber }}>{"★".repeat(t.rating || 0)}</span>
                      <span style={{ fontSize: 12, color: T.textMid, transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>›</span>
                    </div>
                  </div>
                  {open && (
                    <div style={{ padding: "0 14px 14px 14px", display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${T.borderLight}` }}>
                      {(() => {
                        const real = realizedR(t);
                        // For wins: show full Intended → Realized → MFE → Left on table breakdown
                        // For losses/BE: show just Intended and Realized (no MFE row — that's noise)
                        if (t.result === "Win") {
                          const mfe = parseRR(t.max_r);
                          if (mfe == null && real == null && !t.rr) return null;
                          const left = (mfe != null && real != null) ? Math.max(0, mfe - real) : null;
                          return (
                            <div style={{ marginTop: 10, padding: "8px 10px", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: 6, display: "flex", gap: 14, flexWrap: "wrap", fontFamily: mono, fontSize: 11 }}>
                              {t.rr && <span><span style={{ color: T.textLight, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" }}>Intended:</span> <span style={{ color: T.text, fontWeight: 600 }}>{t.rr}</span></span>}
                              {real != null && <span><span style={{ color: T.textLight, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" }}>Realized:</span> <span style={{ color: cP(real), fontWeight: 600 }}>{real >= 0 ? "+" : ""}{real.toFixed(2)}R</span></span>}
                              {mfe != null && <span><span style={{ color: T.textLight, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" }}>MFE:</span> <span style={{ color: T.green, fontWeight: 600 }}>+{mfe.toFixed(2)}R</span></span>}
                              {left != null && left > 0.1 && <span style={{ color: T.red, fontWeight: 700 }}>← left {left.toFixed(2)}R on table</span>}
                              {left != null && left <= 0.1 && mfe > 0 && <span style={{ color: T.green, fontWeight: 700 }}>✓ captured fully</span>}
                            </div>
                          );
                        }
                        // Non-win: simple intended vs realized
                        if (!t.rr && real == null) return null;
                        return (
                          <div style={{ marginTop: 10, padding: "8px 10px", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: 6, display: "flex", gap: 14, flexWrap: "wrap", fontFamily: mono, fontSize: 11 }}>
                            {t.rr && <span><span style={{ color: T.textLight, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" }}>Intended:</span> <span style={{ color: T.text, fontWeight: 600 }}>{t.rr}</span></span>}
                            {real != null && <span><span style={{ color: T.textLight, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" }}>Realized:</span> <span style={{ color: cP(real), fontWeight: 600 }}>{real >= 0 ? "+" : ""}{real.toFixed(2)}R</span></span>}
                          </div>
                        );
                      })()}
                      {(t.notes_technical || "").trim() && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 9, color: T.blue, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, fontWeight: 700, marginBottom: 4 }}>Technical</div>
                          <div style={{ fontSize: 12, color: T.text, whiteSpace: "pre-wrap", lineHeight: 1.55, padding: "8px 10px", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>{t.notes_technical}</div>
                        </div>
                      )}
                      {(t.notes_fundamental || "").trim() && (
                        <div>
                          <div style={{ fontSize: 9, color: T.purple, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, fontWeight: 700, marginBottom: 4 }}>Fundamental</div>
                          <div style={{ fontSize: 12, color: T.text, whiteSpace: "pre-wrap", lineHeight: 1.55, padding: "8px 10px", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>{t.notes_fundamental}</div>
                        </div>
                      )}
                      {(t.notes_mistakes || "").trim() && (
                        <div>
                          <div style={{ fontSize: 9, color: T.red, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, fontWeight: 700, marginBottom: 4 }}>Mistakes</div>
                          <div style={{ fontSize: 12, color: T.text, whiteSpace: "pre-wrap", lineHeight: 1.55, padding: "8px 10px", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>{t.notes_mistakes}</div>
                        </div>
                      )}
                      {(t.exec_link || t.bias_link) && (
                        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                          {t.exec_link && <a href={t.exec_link} target="_blank" rel="noreferrer" style={{ color: T.blue, fontSize: 10, textDecoration: "none", fontWeight: 600, fontFamily: mono }}>→ Chart</a>}
                          {t.bias_link && <a href={t.bias_link} target="_blank" rel="noreferrer" style={{ color: T.purple, fontSize: 10, textDecoration: "none", fontWeight: 600, fontFamily: mono }}>→ Bias</a>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reflection form */}
      <div style={{ ...cardS, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Reflection</span>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {savedAt && <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>Saved {new Date(savedAt).toLocaleString()}</span>}
            <button onClick={saveRecap} disabled={saving} style={{ ...btnP, opacity: saving ? 0.6 : 1, background: justSaved ? T.green : T.accent, transition: "background 200ms" }}>{saving ? "Saving..." : justSaved ? "✓ Saved" : (recapId ? "Update Recap" : "Save Recap")}</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
          <Field label="What worked? (setups, decisions, discipline)">
            <textarea value={recap.worked_text} onChange={e => setRecap({ ...recap, worked_text: e.target.value })} rows={6} placeholder="Best decisions, setups that paid off, rules followed..." style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 130 }} />
          </Field>
          <Field label="What didn't work? (mistakes, broken rules, emotions)">
            <textarea value={recap.didnt_work_text} onChange={e => setRecap({ ...recap, didnt_work_text: e.target.value })} rows={6} placeholder="Costly mistakes, rules broken, FOMO, revenge trades..." style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 130 }} />
          </Field>
          <Field label="Patterns recognized (good or bad)">
            <textarea value={recap.pattern_text} onChange={e => setRecap({ ...recap, pattern_text: e.target.value })} rows={6} placeholder="Recurring behaviors, market patterns, setup tendencies..." style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 130 }} />
          </Field>
          <Field label="One thing to change next period">
            <textarea value={recap.change_text} onChange={e => setRecap({ ...recap, change_text: e.target.value })} rows={6} placeholder="The single most important change to make..." style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 130 }} />
          </Field>
        </div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono }}>Conviction for next period:</span>
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3, 4, 5].map(r => (<button key={r} onClick={() => setRecap({ ...recap, conviction: r })} style={{ width: 36, height: 36, borderRadius: 6, border: `1px solid ${T.border}`, background: recap.conviction >= r ? T.accentBg : T.cardAlt, color: recap.conviction >= r ? T.accent : T.textLight, cursor: "pointer", fontSize: 16 }}>★</button>))}
          </div>
          <span style={{ fontSize: 11, color: T.textMid, fontFamily: mono }}>{["Low", "Cautious", "Neutral", "Confident", "Highest"][recap.conviction - 1]}</span>
        </div>
      </div>

      {/* Past recaps */}
      <div style={{ ...cardS, padding: 18 }}>
        <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 12 }}>Past {periodType === "week" ? "Weekly" : "Monthly"} Recaps · {scopeLabel}</div>
        {pastRecaps.length === 0 ? (
          <div style={{ color: T.textLight, fontSize: 13, padding: 16, textAlign: "center" }}>No past recaps yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pastRecaps.map(r => (
              <div key={r.id} onClick={() => jumpTo(r)} style={{ cursor: "pointer", padding: "10px 12px", background: r.id === recapId ? T.accentBg : T.cardAlt, borderRadius: 8, border: r.id === recapId ? `1px solid ${T.accent}` : "1px solid transparent", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{formatPeriodLabel(r.period_type, r.period_start)}</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: T.amber }}>{"★".repeat(r.conviction || 0)}</span>
                  <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>{new Date(r.updated_at || r.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// JOURNAL (MAIN)
// ══════════════════════════════════════════
function Journal({ user, onLogout }) {
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [trades, setTrades] = useState([]);
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showPairsModal, setShowPairsModal] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [page, setPage] = useState("journal");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyTrade());
  const [editId, setEditId] = useState(null);
  const [fPair, setFPair] = useState("All");
  const [fResult, setFResult] = useState("All");
  const [fDay, setFDay] = useState("All");
  const [fSess, setFSess] = useState("All");
  const [fDir, setFDir] = useState("All");
  const [fBias, setFBias] = useState("All");
  const [fRating, setFRating] = useState("All");
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch] = useState("");

  // Load accounts + pairs on mount
  useEffect(() => {
    const loadAll = async () => {
      const { data: accData } = await supabase.from("accounts").select("*").order("created_at", { ascending: true });
      setAccounts(accData || []);
      if (accData && accData.length > 0) setActiveAccount(accData[0]);
      else setShowAccountModal(true);

      const { data: pairData } = await supabase.from("user_pairs").select("*").order("sort_order", { ascending: true });
      if (pairData && pairData.length > 0) {
        setPairs(pairData);
      } else {
        const seedRows = DEFAULT_PAIRS.map((name, i) => ({ user_id: user.id, name, sort_order: i }));
        const { data: seeded } = await supabase.from("user_pairs").insert(seedRows).select();
        setPairs((seeded || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
      }

      setLoading(false);
    };
    loadAll();
  }, [user.id]);

  // Load trades when active account changes
  useEffect(() => {
    if (!activeAccount) { setTrades([]); return; }
    const loadTrades = async () => {
      const { data } = await supabase.from("trades").select("*").eq("account_id", activeAccount.id).order("date", { ascending: false });
      setTrades((data || []).map(t => ({ ...t, day: t.day || getDay(t.date) })));
    };
    loadTrades();
  }, [activeAccount]);

  const pairNames = useMemo(() => pairs.map(p => p.name), [pairs]);

  const createAccount = async (name, starting_balance) => {
    const { data, error } = await supabase.from("accounts").insert({ name, starting_balance, user_id: user.id }).select().single();
    if (error) { alert("Error: " + error.message); return; }
    setAccounts(p => [...p, data]);
    if (!activeAccount) setActiveAccount(data);
  };

  const deleteAccount = async (id) => {
    if (!confirm("Delete this account and ALL its trades? Cannot undo.")) return;
    await supabase.from("accounts").delete().eq("id", id);
    const remaining = accounts.filter(a => a.id !== id);
    setAccounts(remaining);
    if (activeAccount?.id === id) setActiveAccount(remaining[0] || null);
  };

  const selectAccount = (id) => {
    const a = accounts.find(x => x.id === id);
    if (a) { setActiveAccount(a); setShowAccountModal(false); }
  };

  // PAIR HANDLERS
  const addPair = async (name) => {
    if (pairs.some(p => p.name.toLowerCase() === name.toLowerCase())) { alert("That pair already exists."); return; }
    const nextOrder = pairs.length > 0 ? Math.max(...pairs.map(p => p.sort_order || 0)) + 1 : 0;
    const { data, error } = await supabase.from("user_pairs").insert({ user_id: user.id, name, sort_order: nextOrder }).select().single();
    if (error) { alert("Error: " + error.message); return; }
    setPairs(p => [...p, data]);
  };
  const updatePair = async (id, newName) => {
    if (pairs.some(p => p.id !== id && p.name.toLowerCase() === newName.toLowerCase())) { alert("That pair name already exists."); return; }
    const { data, error } = await supabase.from("user_pairs").update({ name: newName }).eq("id", id).select().single();
    if (error) { alert("Error: " + error.message); return; }
    setPairs(p => p.map(x => x.id === id ? data : x));
  };
  const deletePair = async (id) => {
    if (!confirm("Delete this pair from your list? Existing trades with this pair are NOT affected.")) return;
    await supabase.from("user_pairs").delete().eq("id", id);
    setPairs(p => p.filter(x => x.id !== id));
  };
  const resetPairsToDefaults = async () => {
    if (!confirm("Replace your current list with the full default pair list? Your existing trades are NOT affected.")) return;
    await supabase.from("user_pairs").delete().eq("user_id", user.id);
    const seedRows = DEFAULT_PAIRS.map((name, i) => ({ user_id: user.id, name, sort_order: i }));
    const { data: seeded } = await supabase.from("user_pairs").insert(seedRows).select();
    setPairs((seeded || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
  };

  const saveTrade = async () => {
    if (!activeAccount) return;
    const pnl = parseFloat(form.pnl_pct) || 0;
    const payload = {
      account_id: activeAccount.id, user_id: user.id,
      date: form.date, day: getDay(form.date), session: form.session, pair: form.pair,
      risk: parseFloat(form.risk) || 0, direction: form.direction,
      entry: form.entry, exit: form.exit, rr: form.rr, max_r: form.max_r,
      pnl_pct: pnl, pnl_usd: (pnl / 100) * activeAccount.starting_balance,
      result: form.result, bias_type: form.bias_type, rating: form.rating,
      exec_link: form.exec_link, bias_link: form.bias_link,
      notes_technical: form.notes_technical, notes_fundamental: form.notes_fundamental, notes_mistakes: form.notes_mistakes,
    };
    if (editId) {
      const { data, error } = await supabase.from("trades").update(payload).eq("id", editId).select().single();
      if (error) { alert("Error: " + error.message); return; }
      setTrades(p => p.map(x => x.id === editId ? data : x));
    } else {
      const { data, error } = await supabase.from("trades").insert(payload).select().single();
      if (error) { alert("Error: " + error.message); return; }
      setTrades(p => [data, ...p]);
    }
    setForm(emptyTrade()); setShowForm(false); setEditId(null);
  };

  const editTrade = t => { setForm({ ...t, risk: t.risk || 1, rating: t.rating || 3 }); setEditId(t.id); setShowForm(true); setTab("log"); };
  const deleteTrade = async id => {
    if (!confirm("Delete this trade?")) return;
    await supabase.from("trades").delete().eq("id", id);
    setTrades(p => p.filter(x => x.id !== id));
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const tradeRows = trades.map(t => ({
      Date: t.date, Day: t.day, Session: t.session, Pair: t.pair,
      "Risk %": t.risk, Direction: t.direction, Entry: t.entry, Exit: t.exit, "R:R": t.rr, "Max R": t.max_r,
      "PnL %": t.pnl_pct, "PnL $": t.pnl_usd, Result: t.result, Bias: t.bias_type, Rating: t.rating,
      "Technical Notes": t.notes_technical, "Fundamental Notes": t.notes_fundamental, "Mistakes": t.notes_mistakes,
      "Exec Link": t.exec_link, "Bias Link": t.bias_link,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tradeRows), "Trades");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Account: activeAccount.name, "Starting Balance": activeAccount.starting_balance, "Total Trades": trades.length }]), "Summary");
    XLSX.writeFile(wb, `varmari_${activeAccount.name.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const exportAllBackup = async () => {
    const wb = XLSX.utils.book_new();
    for (const acc of accounts) {
      const { data } = await supabase.from("trades").select("*").eq("account_id", acc.id).order("date", { ascending: true });
      const rows = (data || []).map(t => ({
        Date: t.date, Day: t.day, Session: t.session, Pair: t.pair,
        "Risk %": t.risk, Direction: t.direction, Entry: t.entry, Exit: t.exit, "R:R": t.rr, "Max R": t.max_r,
        "PnL %": t.pnl_pct, "PnL $": t.pnl_usd, Result: t.result, Bias: t.bias_type, Rating: t.rating,
        "Technical Notes": t.notes_technical, "Fundamental Notes": t.notes_fundamental, "Mistakes": t.notes_mistakes,
        "Exec Link": t.exec_link, "Bias Link": t.bias_link,
      }));
      const sheetName = acc.name.substring(0, 28).replace(/[\\/\[\]\*\?:]/g, "_");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: "No trades" }]), sheetName);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(accounts.map(a => ({ Name: a.name, "Starting Balance": a.starting_balance, Created: a.created_at }))), "Accounts");
    XLSX.writeFile(wb, `varmari_FULL_BACKUP_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // Stats
  const S = useMemo(() => {
    if (!activeAccount || !trades.length) return null;
    const base = activeAccount.starting_balance;
    const n = trades.length;
    const w = trades.filter(t => t.result === "Win"), l = trades.filter(t => t.result === "Loss"), b = trades.filter(t => t.result === "Breakeven");
    const wr = w.length / (w.length + l.length || 1) * 100;
    const tPnl = trades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
    const tUsd = trades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
    const avgW = w.length ? w.reduce((s, t) => s + parseFloat(t.pnl_pct || 0), 0) / w.length : 0;
    const avgL = l.length ? l.reduce((s, t) => s + parseFloat(t.pnl_pct || 0), 0) / l.length : 0;
    const pf = Math.abs(avgL) > 0 ? Math.abs(avgW / avgL) : 0;
    const best = Math.max(...trades.map(t => parseFloat(t.pnl_pct) || 0));
    const worst = Math.min(...trades.map(t => parseFloat(t.pnl_pct) || 0));
    let streak = 0, maxS = 0;
    [...trades].sort((a, b) => a.date.localeCompare(b.date)).forEach(t => { if (t.result === "Win") { streak++; maxS = Math.max(maxS, streak); } else streak = 0; });

    const day = {}; DAYS_W.forEach(d => { day[d] = { n: 0, w: 0, l: 0, be: 0, pnl: 0 }; });
    trades.forEach(t => { if (day[t.day]) { day[t.day].n++; if (t.result === "Win") day[t.day].w++; else if (t.result === "Loss") day[t.day].l++; else day[t.day].be++; day[t.day].pnl += parseFloat(t.pnl_pct) || 0; } });

    const sess = {}; SESSIONS.forEach(s => { sess[s] = { n: 0, w: 0, l: 0, pnl: 0 }; });
    trades.forEach(t => { if (sess[t.session]) { sess[t.session].n++; if (t.result === "Win") sess[t.session].w++; else if (t.result === "Loss") sess[t.session].l++; sess[t.session].pnl += parseFloat(t.pnl_pct) || 0; } });

    // Build pair map dynamically — include any pair with trades, even legacy ones not in current list
    const pair = {};
    pairNames.forEach(p => { if (!pair[p]) pair[p] = { n: 0, w: 0, l: 0, be: 0, pnl: 0, usd: 0 }; });
    trades.forEach(t => {
      if (!t.pair) return;
      if (!pair[t.pair]) pair[t.pair] = { n: 0, w: 0, l: 0, be: 0, pnl: 0, usd: 0 };
      pair[t.pair].n++;
      if (t.result === "Win") pair[t.pair].w++;
      else if (t.result === "Loss") pair[t.pair].l++;
      else pair[t.pair].be++;
      pair[t.pair].pnl += parseFloat(t.pnl_pct) || 0;
      pair[t.pair].usd += parseFloat(t.pnl_usd) || 0;
    });

    const dir = { Long: { n: 0, w: 0, l: 0, pnl: 0 }, Short: { n: 0, w: 0, l: 0, pnl: 0 } };
    trades.forEach(t => { if (dir[t.direction]) { dir[t.direction].n++; if (t.result === "Win") dir[t.direction].w++; else if (t.result === "Loss") dir[t.direction].l++; dir[t.direction].pnl += parseFloat(t.pnl_pct) || 0; } });

    const mo = {};
    trades.forEach(t => { const m = t.date?.substring(0, 7); if (m) { if (!mo[m]) mo[m] = { n: 0, w: 0, l: 0, pnl: 0, usd: 0 }; mo[m].n++; if (t.result === "Win") mo[m].w++; else if (t.result === "Loss") mo[m].l++; mo[m].pnl += parseFloat(t.pnl_pct) || 0; mo[m].usd += parseFloat(t.pnl_usd) || 0; } });

    // Equity curve + drawdown
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    let bal = base;
    const eq = [{ date: "Start", balance: base }];
    let peak = base;
    let maxDD = 0, maxDDpct = 0;
    let lastPeakDate = "Start";
    sorted.forEach(t => {
      bal += parseFloat(t.pnl_usd) || 0;
      eq.push({ date: t.date, balance: Math.round(bal * 100) / 100 });
      if (bal > peak) { peak = bal; lastPeakDate = t.date; }
      const dd = peak - bal;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDD) { maxDD = dd; maxDDpct = ddPct; }
    });
    const currentDD = peak - bal;
    const currentDDpct = peak > 0 ? (currentDD / peak) * 100 : 0;
    let daysSincePeak = 0;
    if (lastPeakDate !== "Start") {
      const today = new Date();
      const peakD = new Date(lastPeakDate + "T12:00:00");
      daysSincePeak = Math.max(0, Math.floor((today - peakD) / (1000 * 60 * 60 * 24)));
    }

    // Cumulative R curve
    let cumR = 0;
    const rCurve = [{ date: "Start", r: 0 }];
    sorted.forEach(t => { const r = realizedR(t); if (r != null) { cumR += r; rCurve.push({ date: t.date, r: Math.round(cumR * 100) / 100 }); } });
    const totalR = cumR;

    // By rating
    const byRating = {};
    [1,2,3,4,5].forEach(r => { byRating[r] = { n: 0, w: 0, l: 0, pnl: 0, sumR: 0, rCount: 0 }; });
    trades.forEach(t => {
      const r = t.rating || 0;
      if (byRating[r]) {
        byRating[r].n++;
        if (t.result === "Win") byRating[r].w++;
        else if (t.result === "Loss") byRating[r].l++;
        byRating[r].pnl += parseFloat(t.pnl_pct) || 0;
        const rR = realizedR(t);
        if (rR != null) { byRating[r].sumR += rR; byRating[r].rCount++; }
      }
    });

    // R distribution
    const rValues = trades.map(realizedR).filter(v => v != null);
    const buckets = [
      { label: "≤ -2R", min: -Infinity, max: -2, count: 0 },
      { label: "-2 to -1R", min: -2, max: -1, count: 0 },
      { label: "-1 to 0R", min: -1, max: 0, count: 0 },
      { label: "0 to 1R", min: 0, max: 1, count: 0 },
      { label: "1 to 2R", min: 1, max: 2, count: 0 },
      { label: "2 to 3R", min: 2, max: 3, count: 0 },
      { label: "≥ 3R", min: 3, max: Infinity, count: 0 },
    ];
    rValues.forEach(v => {
      if (v === 0) { buckets[3].count++; return; }
      for (const b of buckets) { if (v > b.min && v <= b.max) { b.count++; break; } }
    });
    const intendedRs = trades.map(t => parseRR(t.rr)).filter(v => v != null);
    const avgIntendedR = intendedRs.length ? intendedRs.reduce((s,v) => s+v, 0) / intendedRs.length : null;
    const avgRealizedR = rValues.length ? rValues.reduce((s,v) => s+v, 0) / rValues.length : null;

    // MFE / Exit Quality — only for WINNING trades where max_r was filled in
    // (MFE on losers is noise — the question we're answering is "did I close winners too early")
    const mfeTrades = trades.filter(t => t.result === "Win").map(t => {
      const mfe = parseRR(t.max_r);
      const realized = realizedR(t);
      if (mfe == null || realized == null) return null;
      return { id: t.id, date: t.date, pair: t.pair, direction: t.direction, result: t.result, mfe, realized, leftOnTable: Math.max(0, mfe - realized) };
    }).filter(x => x != null);

    let exitQuality = null;
    const totalWins = trades.filter(t => t.result === "Win").length;
    if (mfeTrades.length > 0) {
      const totalMFE = mfeTrades.reduce((s, x) => s + x.mfe, 0);
      const totalRealized = mfeTrades.reduce((s, x) => s + x.realized, 0);
      const totalLeftOnTable = mfeTrades.reduce((s, x) => s + x.leftOnTable, 0);
      const avgMFE = totalMFE / mfeTrades.length;
      const avgRealized2 = totalRealized / mfeTrades.length;
      // Capture rate: realized R as % of MFE — across all logged winners
      const captureRate = totalMFE > 0 ? (totalRealized / totalMFE) * 100 : null;
      // Worst "left on table" — top 5 winners where MFE - realized was biggest
      const worstLeft = [...mfeTrades].sort((a, b) => b.leftOnTable - a.leftOnTable).slice(0, 5).filter(x => x.leftOnTable > 0.1);
      exitQuality = {
        n: mfeTrades.length,
        coverage: totalWins > 0 ? (mfeTrades.length / totalWins) * 100 : 0,
        avgMFE,
        avgRealized: avgRealized2,
        captureRate,
        totalLeftOnTable,
        worstLeft,
      };
    }

    const yMin = Math.round(base * 0.88);
    const yMax = Math.round(base * 1.30);

    return { n, w: w.length, l: l.length, be: b.length, wr, tPnl, tUsd, avgW, avgL, pf, best, worst, maxS, day, sess, pair, dir, mo, eq, yMin, yMax, base,
      maxDD, maxDDpct, currentDD, currentDDpct, daysSincePeak, peak,
      rCurve, totalR, byRating, buckets, avgIntendedR, avgRealizedR, exitQuality };
  }, [trades, activeAccount, pairNames]);

  const filtered = useMemo(() => {
    let list = [...trades];
    if (fPair !== "All") list = list.filter(t => t.pair === fPair);
    if (fResult !== "All") list = list.filter(t => t.result === fResult);
    if (fDay !== "All") list = list.filter(t => t.day === fDay);
    if (fSess !== "All") list = list.filter(t => t.session === fSess);
    if (fDir !== "All") list = list.filter(t => t.direction === fDir);
    if (fBias !== "All") list = list.filter(t => t.bias_type === fBias);
    if (fRating !== "All") list = list.filter(t => String(t.rating) === String(fRating));
    if (search) { const s = search.toLowerCase(); list = list.filter(t => [t.pair, t.session, t.direction, t.bias_type, t.notes_technical, t.notes_fundamental, t.notes_mistakes, t.date, t.day].some(f => (f || "").toLowerCase().includes(s))); }
    list.sort((a, b) => { let va = a[sortCol], vb = b[sortCol]; if (sortCol === "pnl_pct" || sortCol === "risk") { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; } if (va < vb) return sortDir === "asc" ? -1 : 1; if (va > vb) return sortDir === "asc" ? 1 : -1; return 0; });
    return list;
  }, [trades, fPair, fResult, fDay, fSess, fDir, fBias, fRating, search, sortCol, sortDir]);

  const clearFilters = () => { setFPair("All"); setFResult("All"); setFDay("All"); setFSess("All"); setFDir("All"); setFBias("All"); setFRating("All"); setSearch(""); };
  const hasActiveFilters = fPair !== "All" || fResult !== "All" || fDay !== "All" || fSess !== "All" || fDir !== "All" || fBias !== "All" || fRating !== "All" || search !== "";

  const toggleSort = col => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("desc"); } };

  const tabs = [
    { k: "dashboard", l: "Dashboard", i: "◈" },
    { k: "log", l: "Trade Log", i: "☰" },
    { k: "pairs", l: "Pairs", i: "⟡" },
    { k: "monthly", l: "Monthly", i: "▣" },
    { k: "recap", l: "Recap", i: "✎" },
  ];

  const navStyle = (active) => ({
    background: "none", border: "none", color: active ? "#fff" : "rgba(255,255,255,0.5)",
    padding: "10px 16px", fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer",
    fontFamily: font, letterSpacing: 0.3, borderBottom: active ? `2px solid ${T.accent}` : "2px solid transparent",
  });

  if (loading) return <div style={{ minHeight: "100vh", background: T.bg, ...center, color: T.textMid, fontFamily: mono }}>Loading...</div>;

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: font, color: T.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Top Nav */}
      <div style={{ background: T.headerBg, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 0" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: T.accent, boxShadow: `0 0 8px ${T.accent}66` }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: 1.5 }}>VARMARI</span>
          </div>
          <div style={{ display: "flex", gap: 0 }}>
            <button onClick={() => setPage("journal")} style={navStyle(page === "journal")}>Trading Journal</button>
            <button onClick={() => setPage("calculator")} style={navStyle(page === "calculator")}>Position Calculator</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 0", flexWrap: "wrap" }}>
          {page === "journal" && activeAccount && (
            <>
              <button onClick={() => setShowPairsModal(true)} title="Manage Pairs" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", padding: "6px 12px", borderRadius: 8, fontSize: 11, fontFamily: mono, cursor: "pointer" }}>
                ⟡ Pairs ({pairs.length})
              </button>
              <button onClick={() => setShowAccountModal(true)} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", padding: "6px 12px", borderRadius: 8, fontSize: 11, fontFamily: mono, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: T.accent }}>●</span> {activeAccount.name} <span style={{ color: "rgba(255,255,255,0.5)" }}>▼</span>
              </button>
            </>
          )}
          <button onClick={onLogout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", padding: "6px 12px", borderRadius: 8, fontSize: 11, fontFamily: mono, cursor: "pointer" }}>Sign Out</button>
        </div>
      </div>

      {showAccountModal && <AccountModal accounts={accounts} activeId={activeAccount?.id} onClose={() => activeAccount && setShowAccountModal(false)} onCreate={createAccount} onDelete={deleteAccount} onSelect={selectAccount} />}
      {showPairsModal && <PairsModal pairs={pairs} onClose={() => setShowPairsModal(false)} onAdd={addPair} onUpdate={updatePair} onDelete={deletePair} onResetDefaults={resetPairsToDefaults} />}

      {page === "calculator" && <PositionCalc />}

      {page === "journal" && !activeAccount && !showAccountModal && (
        <div style={{ ...cardS, padding: 40, margin: 28, textAlign: "center" }}>
          <div style={{ fontSize: 14, marginBottom: 12 }}>No account selected</div>
          <button onClick={() => setShowAccountModal(true)} style={btnP}>Create or Select Account</button>
        </div>
      )}

      {page === "journal" && activeAccount && (
        <>
          {/* Sub-header */}
          <div style={{ display: "flex", gap: 8, padding: "12px 20px", alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, background: T.card }}>
            <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
              {tabs.map(t => (
                <button key={t.k} onClick={() => setTab(t.k)} style={{
                  background: "none", border: "none", color: tab === t.k ? T.accent : T.textLight,
                  padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
                  borderBottom: tab === t.k ? `2px solid ${T.accent}` : "2px solid transparent",
                }}><span style={{ fontSize: 13, marginRight: 4 }}>{t.i}</span>{t.l}</button>
              ))}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => { setForm(emptyTrade()); setEditId(null); setShowForm(true); setTab("log"); }} style={{ ...btnP, fontSize: 11, padding: "6px 14px" }}>+ New Trade</button>
              <button onClick={exportExcel} style={{ ...btnG, fontSize: 10, padding: "5px 10px" }}>Export Excel</button>
              <button onClick={exportAllBackup} style={{ ...btnG, fontSize: 10, padding: "5px 10px", color: T.accent, borderColor: T.accent + "60" }}>⬇ Full Backup</button>
            </div>
          </div>

          <div style={{ padding: "20px", maxWidth: 1280, margin: "0 auto" }}>

            {/* DASHBOARD */}
            {tab === "dashboard" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {!S ? (
                  <div style={{ ...cardS, padding: 60, textAlign: "center" }}>
                    <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>◈</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No trades yet in {activeAccount.name}</div>
                    <div style={{ color: T.textMid, fontSize: 13, marginBottom: 20 }}>Starting Balance: ${activeAccount.starting_balance.toLocaleString()}</div>
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
                    <Stat icon="◆" label="Balance" value={`$${(S.base + S.tUsd).toFixed(0)}`} color={T.accent} sub={`Streak: ${S.maxS}`} />
                  </div>

                  {/* Risk row */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
                    <Stat icon="▼" label="Max Drawdown" value={fU(-S.maxDD)} color={T.red} sub={`${S.maxDDpct.toFixed(1)}% from peak`} />
                    <Stat icon="◊" label="Current DD" value={S.currentDD > 0.01 ? fU(-S.currentDD) : "—"} color={S.currentDD > 0.01 ? T.red : T.green} sub={S.currentDD > 0.01 ? `${S.currentDDpct.toFixed(1)}% off peak` : "At peak"} />
                    <Stat icon="◷" label="Days Since Peak" value={S.daysSincePeak} sub={S.daysSincePeak === 0 ? "New peak today" : "days"} />
                    <Stat icon="≈" label="Avg Intended RR" value={S.avgIntendedR != null ? `1:${S.avgIntendedR.toFixed(2)}` : "—"} sub={S.avgRealizedR != null ? `Realized ${S.avgRealizedR >= 0 ? "+" : ""}${S.avgRealizedR.toFixed(2)}R` : "—"} />
                  </div>

                  {/* Equity */}
                  <div style={{ ...cardS, padding: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>Equity Curve</span>
                      <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>Range: ${(S.yMin/1000).toFixed(0)}k – ${(S.yMax/1000).toFixed(0)}k</span>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={S.eq}>
                        <defs><linearGradient id="eqG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={S.tUsd >= 0 ? T.green : T.red} stopOpacity={0.2} /><stop offset="95%" stopColor={S.tUsd >= 0 ? T.green : T.red} stopOpacity={0} /></linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={T.borderLight} />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: T.textLight, fontFamily: mono }} tickLine={false} axisLine={{ stroke: T.border }} />
                        <YAxis domain={[S.yMin, S.yMax]} tick={{ fontSize: 9, fill: T.textLight, fontFamily: mono }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, fontFamily: mono, fontSize: 11 }} formatter={v => [`$${v.toFixed(2)}`, "Balance"]} />
                        <ReferenceLine y={S.base} stroke={T.textLight} strokeDasharray="4 4" label={{ value: `Start $${(S.base/1000).toFixed(0)}k`, position: "right", fontSize: 9, fill: T.textLight, fontFamily: mono }} />
                        <Area type="monotone" dataKey="balance" stroke={S.tUsd >= 0 ? T.green : T.red} strokeWidth={2} fill="url(#eqG)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Performance by Rating */}
                  <div style={{ ...cardS, padding: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>Performance by Rating</span>
                      <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>Are your high-conviction setups actually better?</span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: mono }}>
                        <thead><tr style={{ background: T.cardAlt }}>
                          {["Rating", "Trades", "W", "L", "WR%", "Total PnL%", "Avg PnL%"].map(h => <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: T.textLight, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {[5,4,3,2,1].map((r, i) => {
                            const br = S.byRating[r];
                            const wr = (br.w + br.l) > 0 ? (br.w / (br.w + br.l)) * 100 : 0;
                            const avgPnl = br.n > 0 ? br.pnl / br.n : 0;
                            return (
                              <tr key={r} style={{ background: i % 2 === 0 ? T.card : T.cardAlt, opacity: br.n === 0 ? 0.4 : 1 }}>
                                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.borderLight}`, color: T.amber }}>{"★".repeat(r)}</td>
                                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.borderLight}` }}>{br.n}</td>
                                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.borderLight}`, color: T.green }}>{br.w}</td>
                                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.borderLight}`, color: T.red }}>{br.l}</td>
                                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.borderLight}`, color: br.n > 0 && wr >= 50 ? T.green : br.n > 0 ? T.red : T.textLight, fontWeight: 600 }}>{br.n > 0 ? `${wr.toFixed(0)}%` : "—"}</td>
                                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.borderLight}`, color: cP(br.pnl), fontWeight: 600 }}>{br.n > 0 ? fP(br.pnl) : "—"}</td>
                                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.borderLight}`, color: cP(avgPnl) }}>{br.n > 0 ? fP(avgPnl) : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Exit Quality (MFE) — NEW — winners only */}
                  <div style={{ ...cardS, padding: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>Exit Quality (Winners Only)</span>
                      <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>Did you close your winning trades too early?</span>
                    </div>
                    {!S.exitQuality ? (
                      <div style={{ color: T.textLight, fontSize: 12, padding: 20, textAlign: "center", lineHeight: 1.6 }}>
                        On your winning trades, fill in the <strong>"Max R Reached"</strong> field to see exit quality stats.<br />
                        <span style={{ fontSize: 11, opacity: 0.7 }}>Tracks the gap between how far each winner went vs. where you actually exited.</span>
                      </div>
                    ) : (<>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
                        <Stat icon="↗" label="Avg Win Peak" value={`${S.exitQuality.avgMFE >= 0 ? "+" : ""}${S.exitQuality.avgMFE.toFixed(2)}R`} color={T.green} sub="How far wins go" />
                        <Stat icon="✓" label="Avg Win Exit" value={`${S.exitQuality.avgRealized >= 0 ? "+" : ""}${S.exitQuality.avgRealized.toFixed(2)}R`} color={cP(S.exitQuality.avgRealized)} sub="Where you closed" />
                        <Stat icon="%" label="Capture Rate" value={S.exitQuality.captureRate != null ? `${S.exitQuality.captureRate.toFixed(0)}%` : "—"} color={S.exitQuality.captureRate != null && S.exitQuality.captureRate >= 60 ? T.green : S.exitQuality.captureRate != null && S.exitQuality.captureRate >= 40 ? T.amber : T.red} sub="of available move" />
                        <Stat icon="✕" label="Left on Table" value={`-${S.exitQuality.totalLeftOnTable.toFixed(2)}R`} color={T.red} sub="total across trades" />
                        <Stat icon="◧" label="Coverage" value={`${S.exitQuality.coverage.toFixed(0)}%`} sub={`${S.exitQuality.n} of ${S.w} wins logged`} />
                      </div>

                      {S.exitQuality.worstLeft.length > 0 && (
                        <>
                          <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>
                            Biggest Misses · Trades where you exited furthest from peak
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {S.exitQuality.worstLeft.map(t => {
                              const pct = (t.leftOnTable / t.mfe) * 100;
                              return (
                                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: T.cardAlt, borderRadius: 8, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono, minWidth: 70 }}>{t.date}</span>
                                  <Pill text={t.pair} type="pair" />
                                  <Pill text={t.direction} />
                                  <Pill text={t.result} />
                                  <div style={{ flex: 1, minWidth: 200, display: "flex", alignItems: "center", gap: 6, fontFamily: mono, fontSize: 11 }}>
                                    <span style={{ color: T.green, fontWeight: 600 }}>MFE +{t.mfe.toFixed(2)}R</span>
                                    <span style={{ color: T.textLight }}>→</span>
                                    <span style={{ color: cP(t.realized), fontWeight: 600 }}>{t.realized >= 0 ? "+" : ""}{t.realized.toFixed(2)}R</span>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: T.red, fontFamily: mono }}>−{t.leftOnTable.toFixed(2)}R left</span>
                                    <span style={{ fontSize: 9, color: T.textLight, fontFamily: mono }}>({pct.toFixed(0)}% missed)</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>)}
                  </div>

                  {/* Day + Session */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
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
                          <div style={{ width: 80, fontSize: 11, fontWeight: 600, color: T.textMid, flexShrink: 0 }}>{s}</div>
                          <div style={{ flex: 1, height: 5, background: T.cardAlt, borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${(ss.n / maxN) * 100}%`, height: "100%", background: cP(ss.pnl), borderRadius: 3 }} /></div>
                          <div style={{ fontSize: 10, fontFamily: mono, color: T.textMid, width: 25, textAlign: "right" }}>{ss.n}</div>
                          <div style={{ fontSize: 10, fontFamily: mono, color: wr >= 50 ? T.green : ss.n > 0 ? T.red : T.textLight, width: 32, textAlign: "right" }}>{ss.n > 0 ? `${wr.toFixed(0)}%` : "—"}</div>
                        </div>
                      ); })}
                    </div>
                  </div>

                  {/* Direction + Monthly */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                    <div style={{ ...cardS, padding: 18 }}>
                      <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 12 }}>Direction</div>
                      {["Long", "Short"].map(d => { const dd = S.dir[d]; const wr = dd.n > 0 ? (dd.w / (dd.w + dd.l || 1) * 100) : 0; return (
                        <div key={d} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: d === "Long" ? `1px solid ${T.borderLight}` : "none", flexWrap: "wrap", gap: 6 }}>
                          <Pill text={d} />
                          <div style={{ display: "flex", gap: 10, fontSize: 11, fontFamily: mono, flexWrap: "wrap" }}>
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
                          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, color: cP(t.pnl_pct) }}>{fP(t.pnl_pct)}</span>
                          <Pill text={t.result} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>)}
              </div>
            )}

            {/* TRADE LOG */}
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
                      <Field label="Pair">
                        <select value={form.pair} onChange={e => setForm({ ...form, pair: e.target.value })} style={selectS}>
                          {pairNames.map(p => <option key={p}>{p}</option>)}
                          {form.pair && !pairNames.includes(form.pair) && <option key={form.pair} value={form.pair}>{form.pair} (legacy)</option>}
                        </select>
                      </Field>
                      <Field label="Risk %"><input type="number" step="0.25" value={form.risk} onChange={e => setForm({ ...form, risk: e.target.value })} style={inputS} /></Field>
                      <Field label="Direction"><select value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })} style={selectS}><option>Long</option><option>Short</option></select></Field>
                      <Field label="Entry"><input type="text" value={form.entry} onChange={e => setForm({ ...form, entry: e.target.value })} style={inputS} /></Field>
                      <Field label="Exit"><input type="text" value={form.exit} onChange={e => setForm({ ...form, exit: e.target.value })} style={inputS} /></Field>
                      <Field label="R:R"><input type="text" value={form.rr} onChange={e => setForm({ ...form, rr: e.target.value })} placeholder="1:2.5" style={inputS} /></Field>
                      {form.result === "Win" && (
                        <Field label="Max R Reached"><input type="text" value={form.max_r} onChange={e => setForm({ ...form, max_r: e.target.value })} placeholder="1:5 or 4" style={inputS} /></Field>
                      )}
                      <Field label="PnL %"><input type="number" step="0.01" value={form.pnl_pct} onChange={e => setForm({ ...form, pnl_pct: e.target.value })} style={inputS} /></Field>
                      <Field label="Result"><select value={form.result} onChange={e => { const newResult = e.target.value; setForm({ ...form, result: newResult, max_r: newResult === "Win" ? form.max_r : "" }); }} style={selectS}><option>Win</option><option>Loss</option><option>Breakeven</option></select></Field>
                      <Field label="Bias Type"><select value={form.bias_type} onChange={e => setForm({ ...form, bias_type: e.target.value })} style={selectS}>{BIAS_TYPES.map(b => <option key={b}>{b}</option>)}</select></Field>
                      <Field label="Rating">
                        <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                          {[1, 2, 3, 4, 5].map(r => (<button key={r} onClick={() => setForm({ ...form, rating: r })} style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${T.border}`, background: form.rating >= r ? T.accentBg : T.cardAlt, color: form.rating >= r ? T.accent : T.textLight, cursor: "pointer", fontSize: 14 }}>★</button>))}
                        </div>
                      </Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 12 }}>
                      <Field label="Execution Link"><input type="url" value={form.exec_link} onChange={e => setForm({ ...form, exec_link: e.target.value })} placeholder="https://tradingview.com/..." style={inputS} /></Field>
                      <Field label="Bias Link"><input type="url" value={form.bias_link} onChange={e => setForm({ ...form, bias_link: e.target.value })} placeholder="https://..." style={inputS} /></Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 12 }}>
                      <Field label="Technical Notes"><textarea value={form.notes_technical} onChange={e => setForm({ ...form, notes_technical: e.target.value })} rows={6} placeholder="Setup, entry trigger, levels..." style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 130 }} /></Field>
                      <Field label="Fundamental Notes"><textarea value={form.notes_fundamental} onChange={e => setForm({ ...form, notes_fundamental: e.target.value })} rows={6} placeholder="Macro thesis, news, positioning..." style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 130 }} /></Field>
                      <Field label="Mistakes"><textarea value={form.notes_mistakes} onChange={e => setForm({ ...form, notes_mistakes: e.target.value })} rows={6} placeholder="What went wrong, what to improve..." style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 130 }} /></Field>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                      <button onClick={saveTrade} style={btnP}>{editId ? "Update" : "Save Trade"}</button>
                      <button onClick={() => { setShowForm(false); setEditId(null); }} style={btnG}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Filters bar — expanded */}
                <div style={{ ...cardS, padding: 12 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ ...inputS, width: 160, fontSize: 11, padding: "7px 10px" }} />
                    <select value={fPair} onChange={e => setFPair(e.target.value)} style={{ ...selectS, width: 120, fontSize: 11, padding: "7px 10px" }}><option value="All">All Pairs</option>{pairNames.map(p => <option key={p} value={p}>{p}</option>)}</select>
                    <select value={fResult} onChange={e => setFResult(e.target.value)} style={{ ...selectS, width: 110, fontSize: 11, padding: "7px 10px" }}><option value="All">All Results</option><option>Win</option><option>Loss</option><option>Breakeven</option></select>
                    <select value={fDir} onChange={e => setFDir(e.target.value)} style={{ ...selectS, width: 110, fontSize: 11, padding: "7px 10px" }}><option value="All">All Direction</option><option>Long</option><option>Short</option></select>
                    <select value={fSess} onChange={e => setFSess(e.target.value)} style={{ ...selectS, width: 120, fontSize: 11, padding: "7px 10px" }}><option value="All">All Sessions</option>{SESSIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                    <select value={fDay} onChange={e => setFDay(e.target.value)} style={{ ...selectS, width: 110, fontSize: 11, padding: "7px 10px" }}><option value="All">All Days</option>{DAYS_W.map(d => <option key={d} value={d}>{d}</option>)}</select>
                    <select value={fBias} onChange={e => setFBias(e.target.value)} style={{ ...selectS, width: 130, fontSize: 11, padding: "7px 10px" }}><option value="All">All Bias</option>{BIAS_TYPES.map(b => <option key={b} value={b}>{b}</option>)}</select>
                    <select value={fRating} onChange={e => setFRating(e.target.value)} style={{ ...selectS, width: 120, fontSize: 11, padding: "7px 10px" }}><option value="All">All Ratings</option>{[5,4,3,2,1].map(r => <option key={r} value={r}>{"★".repeat(r)} ({r})</option>)}</select>
                    {hasActiveFilters && <button onClick={clearFilters} style={{ ...btnG, fontSize: 10, padding: "6px 12px", color: T.red, borderColor: T.red + "40" }}>✕ Clear</button>}
                    <div style={{ marginLeft: "auto", fontSize: 10, color: T.textLight, fontFamily: mono, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{filtered.length} of {trades.length} trades</span>
                      {!showForm && <button onClick={() => { setForm(emptyTrade()); setEditId(null); setShowForm(true); }} style={{ ...btnP, fontSize: 11, padding: "6px 14px" }}>+ Add</button>}
                    </div>
                  </div>
                </div>

                <div style={{ ...cardS, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: mono }}>
                    <thead><tr style={{ background: T.cardAlt }}>
                      {[{ k: "date", l: "Date" }, { k: "day", l: "Day" }, { k: "session", l: "Session" }, { k: "pair", l: "Pair" }, { k: "direction", l: "Dir" }, { k: "risk", l: "Risk" }, { k: "entry", l: "Entry" }, { k: "exit", l: "Exit" }, { k: "rr", l: "R:R" }, { k: "max_r", l: "Max R" }, { k: "pnl_pct", l: "PnL" }, { k: "result", l: "Result" }, { k: "bias_type", l: "Bias" }, { k: "rating", l: "★" }].map(c => (
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
                          <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, color: t.result === "Win" && t.max_r ? T.green : T.textLight }}>{t.result === "Win" ? (t.max_r || "—") : "—"}</td>
                          <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, fontWeight: 600 }}>
                            <span style={{ color: cP(t.pnl_pct) }}>{fP(t.pnl_pct)}</span><br />
                            <span style={{ fontSize: 9, color: T.textLight }}>{fU(t.pnl_usd)}</span>
                          </td>
                          <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}><Pill text={t.result} /></td>
                          <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, fontSize: 10, color: T.textMid }}>{t.bias_type}</td>
                          <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, color: T.amber }}>{"★".repeat(t.rating || 0)}</td>
                          <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, whiteSpace: "nowrap" }}>
                            {t.exec_link && <a href={t.exec_link} target="_blank" rel="noreferrer" style={{ color: T.blue, fontSize: 9, marginRight: 5, textDecoration: "none", fontWeight: 600 }}>Chart</a>}
                            {t.bias_link && <a href={t.bias_link} target="_blank" rel="noreferrer" style={{ color: T.purple, fontSize: 9, textDecoration: "none", fontWeight: 600 }}>Bias</a>}
                          </td>
                          <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}>
                            <button onClick={() => editTrade(t)} style={{ background: "none", border: "none", cursor: "pointer", color: T.amber, fontSize: 12, padding: "2px" }}>✎</button>
                            <button onClick={() => deleteTrade(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: 12, padding: "2px" }}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && <div style={{ textAlign: "center", padding: 40, color: T.textLight }}>{hasActiveFilters ? "No trades match filters" : "No trades"}</div>}
                </div>
              </div>
            )}

            {/* PAIRS */}
            {tab === "pairs" && S && (() => {
              const active = Object.keys(S.pair).filter(p => S.pair[p].n > 0).sort((a, b) => S.pair[b].pnl - S.pair[a].pnl);
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

            {/* MONTHLY */}
            {tab === "monthly" && S && Object.keys(S.mo).length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {Object.keys(S.mo).sort().reverse().map(m => { const mm = S.mo[m]; const wr = mm.w / (mm.w + mm.l || 1) * 100; const monthTrades = trades.filter(t => t.date?.startsWith(m)).sort((a, b) => a.date.localeCompare(b.date)); return (
                  <div key={m} style={{ ...cardS, padding: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, fontFamily: mono }}>{m}</span>
                      <div style={{ display: "flex", gap: 14, fontSize: 11, fontFamily: mono, flexWrap: "wrap" }}>
                        <span>{mm.n}T</span><span style={{ color: T.green }}>{mm.w}W</span><span style={{ color: T.red }}>{mm.l}L</span>
                        <span style={{ color: wr >= 50 ? T.green : T.red, fontWeight: 600 }}>{wr.toFixed(0)}%</span>
                        <span style={{ color: cP(mm.pnl), fontWeight: 700 }}>{fP(mm.pnl)}</span>
                        <span style={{ color: cP(mm.usd), fontWeight: 600 }}>{fU(mm.usd)}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {monthTrades.map(t => (
                        <div key={t.id} title={`${t.date} ${t.pair} ${t.direction} ${fP(t.pnl_pct)}`} onClick={() => editTrade(t)} style={{
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

            {/* RECAP TAB */}
            {tab === "recap" && <RecapTab user={user} accounts={accounts} activeAccount={activeAccount} />}

          </div>
        </>
      )}

      <div style={{ padding: "16px 20px", textAlign: "center", fontSize: 10, color: T.textLight, fontFamily: mono, borderTop: `1px solid ${T.border}`, marginTop: 20 }}>
        VARMARI · Macro Intelligence & Trading Infrastructure
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => { await supabase.auth.signOut(); setUser(null); };

  if (checking) return <div style={{ minHeight: "100vh", background: T.bg, ...center, color: T.textMid, fontFamily: mono }}>Loading...</div>;
  if (!user) return <LoginScreen onLogin={setUser} />;
  return <Journal user={user} onLogout={handleLogout} />;
}
