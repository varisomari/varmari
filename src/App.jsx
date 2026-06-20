import { useState, useEffect, useMemo, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, CartesianGrid, ReferenceLine } from "recharts";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

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

const T = {
  bg: "#FBFAF6", card: "#FFFFFF", cardAlt: "#FAFAF7", border: "#E8E2D5",
  borderLight: "#F0EDE3", text: "#1A1A1A", textMid: "#6B6557", textLight: "#A8A293",
  accent: "#C97140", accentBg: "#FCF7EF", green: "#1F7A48", greenBg: "#ECF7F0",
  red: "#B73A2C", redBg: "#FBEEEC", blue: "#2563EB", blueBg: "#EFF4FF",
  purple: "#7C3AED", purpleBg: "#F3EEFF", amber: "#B45309", amberBg: "#FEF9E8",
  headerBg: "#FFFFFF",
};
const font = `'Inter', -apple-system, 'SF Pro Display', system-ui, sans-serif`;
const mono = `'Inter', -apple-system, system-ui, sans-serif`;

const fP = v => { if (v == null || v === "") return "—"; const s = v >= 0 ? "+" : ""; return `${s}${Number(v).toFixed(2)}%`; };
const fU = v => { if (v == null || v === "") return "—"; const s = v >= 0 ? "+" : "−"; return `${s}$${Math.abs(v).toFixed(2)}`; };
const cP = v => v > 0 ? T.green : v < 0 ? T.red : T.textMid;
const getDay = d => { const dt = new Date(d + "T12:00:00"); return DAYS_W[dt.getDay() - 1] || "Friday"; };

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

const realizedR = (t) => {
  const risk = parseFloat(t.risk);
  const pnl = parseFloat(t.pnl_pct);
  if (!risk || isNaN(pnl)) return null;
  return pnl / risk;
};

// Adherence score: ticked checklist items / total. Returns null if user has no rules defined.
const computeAdherence = (trade, checklistItems) => {
  if (!checklistItems || checklistItems.length === 0) return null;
  const checks = trade.adherence_checks || {};
  let ticked = 0;
  checklistItems.forEach(c => { if (checks[c.id] === true) ticked++; });
  return { ticked, total: checklistItems.length, pct: (ticked / checklistItems.length) * 100 };
};

const pad2 = n => String(n).padStart(2, "0");
const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const parseLocalDate = (s) => {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate(), 12, 0, 0, 0);
  if (typeof s !== "string") return new Date();
  const parts = s.split("-");
  if (parts.length !== 3) return new Date(s);
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0, 0);
};

const startOfWeek = (date) => {
  const d = (date instanceof Date) ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0) : parseLocalDate(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d;
};
// CHANGE #1: week ends FRIDAY (Mon + 4) instead of Sunday
const endOfWeek = (date) => {
  const s = startOfWeek(date);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 4, 12, 0, 0, 0);
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
    const monday = startOfWeek(d);
    const friday = endOfWeek(d);
    const sM = monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const eM = friday.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return `Week of ${sM} – ${eM}`;
  }
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

// PDF Export — opens a new window with print-styled A4 layout for a given day.
// Used by both DailyPlanPage (already has plan/trades in state) and TradeLog (fetches fresh).
async function exportDailyPDF({ user, activeAccount, dateISO, dayTrades, plan }) {
  // If plan/dayTrades not provided, fetch from Supabase
  let p = plan;
  let trades = dayTrades;
  if (!p) {
    const { data } = await supabase.from("daily_plans").select("*").eq("user_id", user.id).eq("account_id", activeAccount.id).eq("date", dateISO).maybeSingle();
    p = data || {};
  }
  if (!trades) {
    const { data } = await supabase.from("trades").select("*").eq("account_id", activeAccount.id).eq("date", dateISO).order("created_at", { ascending: true });
    trades = data || [];
  }
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "<br>");
  const d = parseLocalDate(dateISO);
  const dateStr = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const tradeStats = trades.length > 0 ? {
    n: trades.length,
    w: trades.filter(t => t.result === "Win").length,
    l: trades.filter(t => t.result === "Loss").length,
    pnlPct: trades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0),
    pnlUsd: trades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0),
  } : null;

  const tradesHTML = trades.map(t => {
    const pnlPct = parseFloat(t.pnl_pct) || 0;
    const pnlUsd = parseFloat(t.pnl_usd) || 0;
    const types = (t.trade_types || "").split(",").map(s => s.trim()).filter(Boolean);
    return `<tr>
      <td class="mono">${esc(t.session)}</td>
      <td class="mono"><strong>${esc(t.pair)}</strong></td>
      <td><span class="pill pill-${t.direction === "Long" ? "long" : "short"}">${esc(t.direction)}</span></td>
      <td><span class="pill pill-${(t.result || "").toLowerCase()}">${esc(t.result)}</span></td>
      <td class="mono">${esc(t.entry || "—")}</td>
      <td class="mono">${esc(t.exit || "—")}</td>
      <td class="mono">${esc(t.rr || "—")}R</td>
      <td class="mono pnl ${pnlPct >= 0 ? "pos" : "neg"}">${pnlPct >= 0 ? "+" : "−"}${Math.abs(pnlPct).toFixed(2)}%</td>
      <td class="mono pnl ${pnlUsd >= 0 ? "pos" : "neg"}">${pnlUsd >= 0 ? "+" : "−"}$${Math.abs(pnlUsd).toFixed(0)}</td>
      <td class="types">${types.map(tt => `<span class="type-pill">${esc(tt)}</span>`).join("")}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Varmari Daily · ${esc(dateISO)}</title>
<style>
  @page { size: A4; margin: 12mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, sans-serif; color: #2C2418; margin: 0; padding: 0; line-height: 1.45; font-size: 10.5pt; }
  .page { max-width: 186mm; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 8px; border-bottom: 2px solid #C97140; margin-bottom: 10px; }
  .header h1 { font-size: 16pt; margin: 0; font-weight: 700; }
  .header .date { font-size: 10pt; color: #6B5D4F; font-family: 'Courier New', monospace; }
  .section { margin-bottom: 9px; page-break-inside: avoid; }
  .section-title { font-size: 8pt; letter-spacing: 1.5px; text-transform: uppercase; color: #C97140; margin: 0 0 4px 0; font-weight: 700; }
  .section-body { font-size: 9.5pt; white-space: pre-wrap; padding: 6px 8px; background: #FAF8F4; border-left: 3px solid #E8E0D4; border-radius: 2px; line-height: 1.5; }
  .pre-block { border-left-color: #2563EB; }
  .post-block { border-left-color: #7C3AED; }
  .mistakes-block { border-left-color: #B73A2C; background: #FDF0EF; }
  .empty { color: #9C8E7E; font-style: italic; font-size: 9pt; }
  table.trades { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 4px; }
  table.trades th { text-align: left; padding: 4px 5px; background: #FAF8F4; border-bottom: 1px solid #E8E0D4; font-weight: 700; color: #6B5D4F; text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.5px; }
  table.trades td { padding: 4px 5px; border-bottom: 1px solid #F0E8DA; }
  .mono { font-family: 'Courier New', monospace; }
  .pill { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 7.5pt; font-weight: 700; font-family: 'Courier New', monospace; }
  .pill-long, .pill-win { background: #E8F5EE; color: #1F7A48; }
  .pill-short, .pill-loss { background: #FDF0EF; color: #B73A2C; }
  .pill-breakeven { background: #FAF8F4; color: #6B5D4F; }
  .pnl { font-weight: 700; } .pos { color: #1F7A48; } .neg { color: #B73A2C; }
  .types { font-size: 7.5pt; }
  .type-pill { display: inline-block; background: #F3E8FF; color: #7C3AED; padding: 1px 5px; border-radius: 3px; margin: 0 2px 2px 0; font-weight: 600; }
  .stat-bar { display: flex; gap: 16px; font-size: 9pt; font-family: 'Courier New', monospace; margin: 4px 0 0 0; padding: 5px 8px; background: #FAF8F4; border-radius: 4px; }
  .stat-bar span { color: #6B5D4F; }
  .stat-bar strong { color: #2C2418; }
  .no-trade { padding: 12px; text-align: center; background: #FAF8F4; border-radius: 4px; color: #6B5D4F; font-style: italic; font-size: 9.5pt; }
  .footer { margin-top: 14px; padding-top: 6px; border-top: 1px solid #E8E0D4; font-size: 7.5pt; color: #9C8E7E; font-family: 'Courier New', monospace; text-align: center; }
  @media print { body { padding: 0; } .page { max-width: 100%; } }
</style></head><body>
<div class="page">
  <div class="header">
    <h1>Daily Journal · ${esc(dateStr)}</h1>
    <div class="date">${esc(dateISO)}</div>
  </div>

  <div class="section">
    <div class="section-title">Pre-market · Fundamentals</div>
    <div class="section-body pre-block">${(p.pre_fundamentals || "").trim() ? esc(p.pre_fundamentals) : '<span class="empty">No fundamentals written.</span>'}</div>
  </div>

  <div class="section">
    <div class="section-title">Pre-market · Technicals</div>
    <div class="section-body pre-block">${(p.pre_technicals || "").trim() ? esc(p.pre_technicals) : '<span class="empty">No technicals written.</span>'}</div>
  </div>

  ${p.trade_taken === false ? `
  <div class="section">
    <div class="section-title">Result</div>
    <div class="no-trade">✓ No-trade day — sat on hands.</div>
  </div>
  ` : ""}

  ${p.trade_taken === true || trades.length > 0 ? `
  <div class="section">
    <div class="section-title">Trades · ${trades.length}</div>
    ${tradeStats ? `
    <div class="stat-bar">
      <span>Wins: <strong>${tradeStats.w}</strong></span>
      <span>Losses: <strong>${tradeStats.l}</strong></span>
      <span>Day PnL: <strong class="${tradeStats.pnlPct >= 0 ? "pos" : "neg"}">${tradeStats.pnlPct >= 0 ? "+" : "−"}${Math.abs(tradeStats.pnlPct).toFixed(2)}%</strong></span>
      <span>Day $: <strong class="${tradeStats.pnlUsd >= 0 ? "pos" : "neg"}">${tradeStats.pnlUsd >= 0 ? "+" : "−"}$${Math.abs(tradeStats.pnlUsd).toFixed(0)}</strong></span>
    </div>
    ` : ""}
    ${trades.length > 0 ? `
    <table class="trades">
      <thead><tr><th>Session</th><th>Pair</th><th>Dir</th><th>Result</th><th>Entry</th><th>Exit</th><th>R:R</th><th>P&amp;L %</th><th>P&amp;L $</th><th>Types</th></tr></thead>
      <tbody>${tradesHTML}</tbody>
    </table>
    ` : '<div class="empty">No trades logged for this day.</div>'}
  </div>

  <div class="section">
    <div class="section-title">What happened to the market</div>
    <div class="section-body post-block">${(p.post_what_happened || "").trim() ? esc(p.post_what_happened) : '<span class="empty">Not yet written.</span>'}</div>
  </div>

  <div class="section">
    <div class="section-title">Mistakes</div>
    <div class="section-body mistakes-block">${(p.post_deviations || "").trim() ? esc(p.post_deviations) : '<span class="empty">No mistakes logged.</span>'}</div>
  </div>
  ` : ""}

  <div class="footer">Varmari · Generated ${new Date().toLocaleString()}</div>
</div>
<script>setTimeout(() => window.print(), 250);</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked — please allow popups for this site."); return; }
  w.document.write(html);
  w.document.close();
}

const emptyTrade = () => ({
  date: new Date().toISOString().split("T")[0],
  session: "London", pair: "EUR/USD", risk: 1, direction: "Long",
  entry: "", exit: "", rr: "", max_r: "", max_adverse_r: "", pnl_pct: "", result: "Win",
  exec_link: "", bias_link: "",
  notes_trade: "", notes_market: "", notes_mistakes: "",
  trade_types: "",
});

// Recap = 2 fields: positives (green) + negatives (red).
// Mapped to existing DB columns: positives → worked_text, negatives → didnt_work_text
// (pattern_text + change_text stay empty; old data still loads if present)
const emptyRecap = () => ({ positives: "", negatives: "" });

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
// RISK GAUGES — running totals for today / week / month
// Self-monitoring: no caps, just visibility
// ══════════════════════════════════════════
function RiskGauges({ gauges, compact }) {
  if (!gauges) return null;
  const { td, wk, mo } = gauges;
  // Color logic:
  // - Green if positive
  // - Amber if 0 to -1% today / -3% week / -5% month
  // - Red if worse
  const colorFor = (pnl, redThr) => {
    if (pnl > 0) return T.green;
    if (pnl === 0) return T.textMid;
    if (pnl >= -redThr / 2) return T.amber;
    return T.red;
  };
  const fmt = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
  const fmtUsd = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(0)}`;
  const tdColor = colorFor(td.pnl, 2);
  const wkColor = colorFor(wk.pnl, 5);
  const moColor = colorFor(mo.pnl, 8);

  if (compact) {
    return (
      <div style={{ display: "flex", gap: 16, padding: "8px 12px", background: T.cardAlt, border: `0.5px solid ${T.border}`, borderRadius: 8, fontSize: 12, fontFamily: font, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>P&L Today / Wk / Mo</span>
        <span style={{ color: tdColor, fontWeight: 700 }}>{fmt(td.pnl)}</span>
        <span style={{ color: T.textLight }}>·</span>
        <span style={{ color: wkColor, fontWeight: 700 }}>{fmt(wk.pnl)}</span>
        <span style={{ color: T.textLight }}>·</span>
        <span style={{ color: moColor, fontWeight: 700 }}>{fmt(mo.pnl)}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
      {[
        { label: "Today", data: td, color: tdColor },
        { label: "This week", data: wk, color: wkColor },
        { label: "This month", data: mo, color: moColor },
      ].map(({ label, data, color }) => (
        <div key={label} style={{ background: T.card, border: `0.5px solid ${T.border}`, borderLeft: `3px solid ${color}`, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 11, color: T.textMid, marginTop: 2 }}>{data.n} {data.n === 1 ? "trade" : "trades"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 17, color, fontWeight: 700, lineHeight: 1, letterSpacing: -0.3 }}>{fmt(data.pnl)}</div>
            <div style={{ fontSize: 10, color: T.textLight, fontFamily: mono, marginTop: 3 }}>{fmtUsd(data.usd)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

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
        <div style={{ marginTop: 18, fontSize: 10, color: T.textLight, fontFamily: mono, textAlign: "center", lineHeight: 1.6 }}>Invite-only. Contact admin for access.</div>
      </div>
    </div>
  );
}

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
        <div><label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Entry Price</label><input type="number" inputMode="decimal" value={entry} onChange={e => setEntry(e.target.value)} placeholder="0" style={{ ...inputS, padding: "12px" }} /></div>
        <div><label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Stop Loss</label><input type="number" inputMode="decimal" value={sl} onChange={e => setSl(e.target.value)} placeholder="0" style={{ ...inputS, padding: "12px" }} /></div>
        <div><label style={{ fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5, display: "block" }}>Risk Amount ($)</label><input type="number" inputMode="decimal" value={risk} onChange={e => setRisk(e.target.value)} placeholder="0" style={{ ...inputS, padding: "12px" }} /></div>
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

function PairsModal({ pairs, onClose, onAdd, onUpdate, onDelete, onResetDefaults }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const handleAdd = async () => { const name = newName.trim(); if (!name) return; await onAdd(name); setNewName(""); };
  const handleStartEdit = (p) => { setEditingId(p.id); setEditValue(p.name); };
  const handleSaveEdit = async () => { if (!editValue.trim()) return; await onUpdate(editingId, editValue.trim()); setEditingId(null); setEditValue(""); };
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
          {pairs.length === 0 ? <div style={{ color: T.textLight, fontSize: 13, padding: 16, textAlign: "center" }}>No pairs yet. Click "Restore Default List" or add your own above.</div>
           : pairs.map(p => (
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
// TRADE TYPES MANAGER MODAL — editable list, same pattern as PairsModal
// ══════════════════════════════════════════
function TradeTypesModal({ types, onClose, onAdd, onUpdate, onDelete }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const handleAdd = async () => { const name = newName.trim(); if (!name) return; await onAdd(name); setNewName(""); };
  const handleStartEdit = (t) => { setEditingId(t.id); setEditValue(t.name); };
  const handleSaveEdit = async () => { if (!editValue.trim()) return; await onUpdate(editingId, editValue.trim()); setEditingId(null); setEditValue(""); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", ...center, zIndex: 1000, padding: 20 }}>
      <div style={{ ...cardS, padding: 24, width: "100%", maxWidth: 580, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Trade Types</span>
          <button onClick={onClose} style={btnG}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: T.textMid, marginBottom: 16, lineHeight: 1.5 }}>
          Categories you tag each trade with. Multi-select on the trade form — a trade can be both "Transition" AND "Fundamental".
        </div>

        <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>Add New Type</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAdd()} placeholder="e.g. Confirmation" style={inputS} />
            <button onClick={handleAdd} style={{ ...btnP, padding: "9px 16px", whiteSpace: "nowrap" }}>+ Add</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>Your Types ({types.length})</div>
          {types.length === 0 ? <div style={{ color: T.textLight, fontSize: 13, padding: 20, textAlign: "center", background: T.cardAlt, borderRadius: 8, lineHeight: 1.6 }}>
            No types yet.<br /><span style={{ fontSize: 11, opacity: 0.7 }}>Examples: Transition, Re-Transition, Confirmation, Continuation, Fundamental, Technical.</span>
          </div>
           : types.map((t, idx) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: T.cardAlt, borderRadius: 8, marginBottom: 4 }}>
              {editingId === t.id ? (
                <>
                  <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono, marginRight: 8 }}>{idx + 1}.</span>
                  <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") { setEditingId(null); setEditValue(""); } }} autoFocus style={{ ...inputS, flex: 1, marginRight: 8 }} />
                  <button onClick={handleSaveEdit} style={{ ...btnG, fontSize: 11, padding: "5px 12px", color: T.green, borderColor: T.green + "40" }}>Save</button>
                  <button onClick={() => { setEditingId(null); setEditValue(""); }} style={{ ...btnG, fontSize: 11, padding: "5px 10px", marginLeft: 4 }}>Cancel</button>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                    <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>{idx + 1}.</span>
                    <span style={{ fontSize: 13, color: T.text }}>{t.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handleStartEdit(t)} style={{ ...btnG, fontSize: 10, padding: "4px 10px" }}>Edit</button>
                    <button onClick={() => onDelete(t.id)} style={{ ...btnG, fontSize: 10, padding: "4px 10px", color: T.red, borderColor: T.red + "40" }}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════
// GLOBAL SEARCH MODAL — searches across trades, daily plans, recaps
// ══════════════════════════════════════════
function GlobalSearchModal({ user, activeAccount, onClose, onOpenTrade, onOpenDay, onOpenRecap }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const runSearch = async (query) => {
    if (!activeAccount || !query.trim() || query.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    const term = query.trim();
    const ilike = `%${term.replace(/[%_]/g, "\\$&")}%`;

    // Search trades
    const tradesP = supabase.from("trades")
      .select("*")
      .eq("account_id", activeAccount.id)
      .or(`notes_technical.ilike.${ilike},notes_fundamental.ilike.${ilike},notes_mistakes.ilike.${ilike},tags.ilike.${ilike},trade_types.ilike.${ilike},pair.ilike.${ilike}`)
      .order("date", { ascending: false })
      .limit(40);

    // Search daily plans
    const plansP = supabase.from("daily_plans")
      .select("*")
      .eq("user_id", user.id)
      .eq("account_id", activeAccount.id)
      .or(`pre_fundamentals.ilike.${ilike},pre_technicals.ilike.${ilike},post_what_happened.ilike.${ilike},post_deviations.ilike.${ilike}`)
      .order("date", { ascending: false })
      .limit(40);

    // Search recaps
    const recapsP = supabase.from("recaps")
      .select("*")
      .eq("user_id", user.id)
      .or(`positives_text.ilike.${ilike},negatives_text.ilike.${ilike},worked_text.ilike.${ilike},didnt_work_text.ilike.${ilike},pattern_text.ilike.${ilike},change_text.ilike.${ilike}`)
      .order("period_date", { ascending: false })
      .limit(20);

    const [tradesR, plansR, recapsR] = await Promise.all([tradesP, plansP, recapsP]);
    setResults({
      trades: tradesR.data || [],
      plans: plansR.data || [],
      recaps: recapsR.data || [],
      term,
    });
    setSearching(false);
  };

  useEffect(() => {
    const t = setTimeout(() => runSearch(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Highlight matching text
  const highlight = (text, term) => {
    if (!text || !term) return text;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, "gi"));
    return parts.map((p, i) => p.toLowerCase() === term.toLowerCase()
      ? <mark key={i} style={{ background: T.accentBg, color: T.accent, padding: "0 2px", fontWeight: 700 }}>{p}</mark>
      : p);
  };

  // Pull a snippet from text around the term
  const snippet = (text, term, len = 140) => {
    if (!text) return "";
    const lower = text.toLowerCase();
    const idx = lower.indexOf(term.toLowerCase());
    if (idx === -1) return text.slice(0, len) + (text.length > len ? "..." : "");
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + term.length + 100);
    return (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
  };

  const findMatchField = (obj, term, fields) => {
    for (const f of fields) {
      const v = obj[f];
      if (v && v.toLowerCase().includes(term.toLowerCase())) return { field: f, text: v };
    }
    return null;
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", ...center, zIndex: 1000, padding: 20 }}>
      <div style={{ ...cardS, padding: 0, width: "100%", maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header with input */}
        <div style={{ padding: "14px 18px", borderBottom: `0.5px solid ${T.border}`, background: T.card }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 16, color: T.textMid }}>⌕</span>
            <input
              type="text"
              autoFocus
              placeholder="Search trades, plans, recaps..."
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") onClose(); }}
              style={{
                flex: 1,
                border: "none", background: "transparent",
                fontSize: 16, fontFamily: font, color: T.text,
                outline: "none", padding: "6px 0",
              }}
            />
            <button onClick={onClose} style={btnG}>✕</button>
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {!q.trim() ? (
            <div style={{ textAlign: "center", color: T.textLight, fontSize: 13, padding: 32 }}>
              <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>⌕</div>
              Type at least 2 characters to search.
              <div style={{ fontSize: 11, marginTop: 8, fontStyle: "italic" }}>Searches trade notes, daily plans, weekly/monthly recaps</div>
            </div>
          ) : searching ? (
            <div style={{ textAlign: "center", color: T.textLight, fontSize: 12, padding: 32 }}>Searching...</div>
          ) : !results ? null : (
            <>
              {/* Trades section */}
              {results.trades.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>Trades · {results.trades.length}</div>
                  {results.trades.map(t => {
                    const m = findMatchField(t, results.term, ["notes_technical", "notes_fundamental", "notes_mistakes", "tags", "trade_types", "pair"]);
                    const fieldLabel = m ? { notes_technical: "Technical", notes_fundamental: "Fundamental", notes_mistakes: "Mistakes", tags: "Tags", trade_types: "Types", pair: "Pair" }[m.field] : "";
                    return (
                      <div key={t.id} onClick={() => { onOpenTrade(t); onClose(); }} style={{ background: T.cardAlt, border: `0.5px solid ${T.borderLight}`, borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10, color: T.purple, fontFamily: mono, fontWeight: 700, background: T.purpleBg, padding: "2px 6px", borderRadius: 3 }}>{fieldLabel}</span>
                            <span style={{ fontSize: 11, fontFamily: mono, color: T.text, fontWeight: 600 }}>{t.date} · {t.pair} · {t.direction}</span>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: mono, color: (parseFloat(t.pnl_pct) || 0) >= 0 ? T.green : T.red }}>
                            {(parseFloat(t.pnl_pct) || 0) >= 0 ? "+" : "−"}{Math.abs(parseFloat(t.pnl_pct) || 0).toFixed(2)}%
                          </span>
                        </div>
                        {m && <div style={{ fontSize: 12, color: T.textMid, lineHeight: 1.5 }}>{highlight(snippet(m.text, results.term), results.term)}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Plans section */}
              {results.plans.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>Daily plans · {results.plans.length}</div>
                  {results.plans.map(p => {
                    const m = findMatchField(p, results.term, ["pre_fundamentals", "pre_technicals", "post_what_happened", "post_deviations"]);
                    const fieldLabel = m ? { pre_fundamentals: "Pre · Fundamentals", pre_technicals: "Pre · Technicals", post_what_happened: "Post · What happened", post_deviations: "Post · Mistakes" }[m.field] : "";
                    return (
                      <div key={p.id} onClick={() => { onOpenDay(p.date); onClose(); }} style={{ background: T.cardAlt, border: `0.5px solid ${T.borderLight}`, borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer" }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, color: T.blue, fontFamily: mono, fontWeight: 700, background: T.blueBg, padding: "2px 6px", borderRadius: 3 }}>{fieldLabel}</span>
                          <span style={{ fontSize: 11, fontFamily: mono, color: T.text, fontWeight: 600 }}>{p.date}</span>
                        </div>
                        {m && <div style={{ fontSize: 12, color: T.textMid, lineHeight: 1.5 }}>{highlight(snippet(m.text, results.term), results.term)}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Recaps section */}
              {results.recaps.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>Recaps · {results.recaps.length}</div>
                  {results.recaps.map(r => {
                    const m = findMatchField(r, results.term, ["positives_text", "negatives_text", "worked_text", "didnt_work_text", "pattern_text", "change_text"]);
                    return (
                      <div key={r.id} onClick={() => { onOpenRecap(r); onClose(); }} style={{ background: T.cardAlt, border: `0.5px solid ${T.borderLight}`, borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer" }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, color: T.accent, fontFamily: mono, fontWeight: 700, background: T.accentBg, padding: "2px 6px", borderRadius: 3 }}>{(r.period_type || "").toUpperCase()}</span>
                          <span style={{ fontSize: 11, fontFamily: mono, color: T.text, fontWeight: 600 }}>{r.period_date}</span>
                        </div>
                        {m && <div style={{ fontSize: 12, color: T.textMid, lineHeight: 1.5 }}>{highlight(snippet(m.text, results.term), results.term)}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {results.trades.length === 0 && results.plans.length === 0 && results.recaps.length === 0 && (
                <div style={{ textAlign: "center", color: T.textLight, fontSize: 13, padding: 32 }}>
                  No results for "<strong>{results.term}</strong>".
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}



// ══════════════════════════════════════════
// TRADE REPLAY MODAL — read-only review of a trade with full day context
// ══════════════════════════════════════════
function TradeReplayModal({ trade, user, activeAccount, allTrades, onClose, onEdit }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!trade?.date || !activeAccount) return;
    let cancelled = false;
    setLoading(true);
    supabase.from("daily_plans")
      .select("*")
      .eq("user_id", user.id)
      .eq("account_id", activeAccount.id)
      .eq("date", trade.date)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setPlan(data || null);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [trade?.date, user.id, activeAccount?.id]);

  if (!trade) return null;

  const sameDayTrades = (allTrades || []).filter(t => t.date === trade.date && t.id !== trade.id);
  const preF = (plan?.pre_fundamentals || "").trim();
  const preT = (plan?.pre_technicals || "").trim();
  const postW = (plan?.post_what_happened || "").trim();
  const postM = (plan?.post_deviations || "").trim();
  const hasPre = preF || preT;
  const hasPost = postW || postM;

  const dayLabel = parseLocalDate(trade.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const fmtP = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(parseFloat(n) || 0).toFixed(2)}%`;
  const fmtU = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(parseFloat(n) || 0).toFixed(2)}`;
  const pnlColor = (parseFloat(trade.pnl_pct) || 0) >= 0 ? T.green : T.red;

  const sectionTitle = (color, label) => (
    <div style={{ fontSize: 10, color, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, marginBottom: 8, fontFamily: font }}>{label}</div>
  );
  const textBlock = (text) => (
    <div style={{ background: T.card, border: `0.5px solid ${T.borderLight}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: T.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{text}</div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", ...center, zIndex: 1000, padding: 16 }}>
      <div style={{ ...cardS, padding: 0, width: "100%", maxWidth: 880, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Sticky header */}
        <div style={{ padding: "16px 20px", borderBottom: `0.5px solid ${T.border}`, background: T.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>▶ Trade Replay</span>
              <span style={{ fontSize: 11, color: T.textMid }}>{dayLabel}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { onEdit(trade); onClose(); }} style={{ ...btnG, padding: "6px 12px", fontSize: 11, color: T.amber, borderColor: T.amber + "60" }}>✎ Edit</button>
              <button onClick={onClose} style={btnG}>✕</button>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>

          {/* TRADE SUMMARY */}
          <div style={{ background: T.cardAlt, borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                  <Pill text={trade.pair} type="pair" />
                  <Pill text={trade.direction} />
                  <Pill text={trade.result} />
                  <span style={{ fontSize: 11, color: T.textMid, fontFamily: mono }}>{trade.session}</span>
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, color: pnlColor, letterSpacing: -0.8, lineHeight: 1 }}>{fmtP(trade.pnl_pct)}</div>
                <div style={{ fontSize: 13, color: T.textMid, marginTop: 4, fontFamily: mono }}>{fmtU(trade.pnl_usd)}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 14px", fontSize: 11, fontFamily: mono, color: T.text }}>
                <span style={{ color: T.textLight }}>Risk:</span><span>{trade.risk}%</span>
                <span style={{ color: T.textLight }}>Entry:</span><span>{trade.entry || "—"}</span>
                <span style={{ color: T.textLight }}>Exit:</span><span>{trade.exit || "—"}</span>
                <span style={{ color: T.textLight }}>R:R:</span><span>{trade.rr || "—"}</span>
                {trade.result === "Win" && (<><span style={{ color: T.textLight }}>Max R:</span><span>{trade.max_r || "—"}</span></>)}
              </div>
            </div>
            {(trade.trade_types || "").trim() && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                {(trade.trade_types || "").split(",").map(s => s.trim()).filter(Boolean).map(tt => (
                  <span key={tt} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: T.purpleBg, color: T.purple, fontWeight: 600 }}>{tt}</span>
                ))}
              </div>
            )}
            {trade.result === "Loss" && String(trade.max_adverse_r || "").trim() && (
              <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono, marginTop: 6 }}>
                <span style={{ color: T.textLight }}>Max R Reversed: </span>
                <span style={{ color: T.red, fontWeight: 700 }}>−{trade.max_adverse_r}R</span>
                <span style={{ color: T.textLight, marginLeft: 6, fontStyle: "italic" }}>past my stop</span>
              </div>
            )}
            {(trade.exec_link || trade.bias_link) && (
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                {trade.exec_link && <a href={trade.exec_link} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.blue, fontFamily: mono }}>↗ Exec link</a>}
                {trade.bias_link && <a href={trade.bias_link} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.blue, fontFamily: mono }}>↗ Bias link</a>}
              </div>
            )}
          </div>

          {/* TWO COLUMNS: Trade Notes | Day Plan */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>

            {/* LEFT: Trade Notes */}
            <div>
              <div style={{ background: T.card, border: `0.5px solid ${T.border}`, borderTop: `3px solid ${T.accent}`, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, color: T.accent, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>◆ Trade Notes</div>
                {(() => {
                  // New schema first, fallback to old fields for legacy trades
                  const tradeNotes = trade.notes_trade || [trade.notes_technical, trade.notes_fundamental].filter(Boolean).join("\n\n");
                  const market = trade.notes_market;
                  const mistakes = trade.notes_mistakes;
                  if (!tradeNotes && !market && !mistakes) {
                    return <div style={{ fontSize: 12, color: T.textLight, fontStyle: "italic" }}>No trade notes.</div>;
                  }
                  return (
                    <>
                      {tradeNotes && (<div style={{ marginBottom: 12 }}>{sectionTitle(T.textMid, "Trade Notes")}{textBlock(tradeNotes)}</div>)}
                      {market && (<div style={{ marginBottom: 12 }}>{sectionTitle(T.blue, "What Happened to the Market")}{textBlock(market)}</div>)}
                      {mistakes && (<div>{sectionTitle(T.red, "Mistakes")}{textBlock(mistakes)}</div>)}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* RIGHT: Day Plan */}
            <div>
              <div style={{ background: T.card, border: `0.5px solid ${T.border}`, borderTop: `3px solid ${T.blue}`, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, color: T.blue, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>◧ Day Plan & Review</div>
                {loading ? <div style={{ fontSize: 12, color: T.textLight, fontStyle: "italic" }}>Loading plan...</div>
                  : (!hasPre && !hasPost) ? <div style={{ fontSize: 12, color: T.textLight, fontStyle: "italic" }}>No plan written for this day.</div>
                  : (
                    <>
                      {preF && (<div style={{ marginBottom: 12 }}>{sectionTitle(T.blue, "Pre · Fundamentals")}{textBlock(preF)}</div>)}
                      {preT && (<div style={{ marginBottom: 12 }}>{sectionTitle(T.blue, "Pre · Technicals")}{textBlock(preT)}</div>)}
                      {postW && (<div style={{ marginBottom: 12 }}>{sectionTitle(T.purple, "Post · What happened")}{textBlock(postW)}</div>)}
                      {postM && (<div>{sectionTitle(T.purple, "Post · Mistakes")}{textBlock(postM)}</div>)}
                    </>
                  )}
              </div>
            </div>
          </div>

          {/* SAME-DAY TRADES */}
          {sameDayTrades.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>Other trades that day · {sameDayTrades.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {sameDayTrades.map(t => (
                  <div key={t.id} style={{ background: T.cardAlt, border: `0.5px solid ${T.borderLight}`, borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <Pill text={t.pair} type="pair" />
                    <Pill text={t.direction} />
                    <Pill text={t.result} />
                    <span style={{ fontSize: 10, color: T.textMid, fontFamily: mono }}>{t.session}</span>
                    <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, fontFamily: mono, color: (parseFloat(t.pnl_pct) || 0) >= 0 ? T.green : T.red }}>{fmtP(t.pnl_pct)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════
// DAY CONTEXT BLOCK — read-only embed of that day's plan, shown inside the Trade Form.
// Lets you see your pre-trade plan & post-trade review while you log a trade.
// ══════════════════════════════════════════
function DayContextBlock({ user, activeAccount, dateISO }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!activeAccount || !dateISO) { setPlan(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    supabase.from("daily_plans")
      .select("*")
      .eq("user_id", user.id)
      .eq("account_id", activeAccount.id)
      .eq("date", dateISO)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setPlan(data || null);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user.id, activeAccount?.id, dateISO]);

  if (loading) return null;
  if (!plan) return (
    <div style={{ background: T.cardAlt, border: `1px dashed ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 11, color: T.textMid, fontStyle: "italic" }}>
      No daily plan written for {dateISO}. Trades work without a plan, but writing one gives this trade context.
    </div>
  );

  const preF = (plan.pre_fundamentals || "").trim();
  const preT = (plan.pre_technicals || "").trim();
  const preB = (plan.pre_bias || plan.bias_text || "").trim();
  const postW = (plan.post_what_happened || "").trim();
  const postD = (plan.post_deviations || "").trim();
  const postL = (plan.post_lessons || plan.plan_text || "").trim();
  const hasPre = preF || preT || preB;
  const hasPost = postW || postD || postL;

  if (!hasPre && !hasPost) return null;

  const itemStyle = { background: T.card, border: `0.5px solid ${T.borderLight}`, borderRadius: 8, padding: "10px 12px", marginBottom: 6 };
  const itemLabel = (color) => ({ fontSize: 9, color, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 4, fontFamily: mono });
  const itemBody = { fontSize: 12, color: T.text, lineHeight: 1.55, whiteSpace: "pre-wrap", maxHeight: 140, overflowY: "auto" };

  return (
    <div style={{ background: T.cardAlt, border: `0.5px solid ${T.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div onClick={() => setCollapsed(c => !c)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: collapsed ? 0 : 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.textMid, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>📖 Day Context · {dateISO}</span>
          {hasPre && <span style={{ fontSize: 9, color: T.blue, fontFamily: mono, fontWeight: 700, background: T.blueBg, padding: "2px 8px", borderRadius: 3 }}>PRE</span>}
          {hasPost && <span style={{ fontSize: 9, color: T.purple, fontFamily: mono, fontWeight: 700, background: T.purpleBg, padding: "2px 8px", borderRadius: 3 }}>POST</span>}
        </div>
        <span style={{ fontSize: 14, color: T.textMid, transform: collapsed ? "none" : "rotate(90deg)", transition: "transform 150ms" }}>›</span>
      </div>
      {!collapsed && (
        <div>
          {hasPre && (
            <div style={{ marginBottom: hasPost ? 12 : 0 }}>
              <div style={{ fontSize: 10, color: T.blue, fontFamily: mono, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${T.borderLight}` }}>◧ Pre-Trade · written before</div>
              {preF && <div style={itemStyle}><div style={itemLabel(T.blue)}>Fundamentals</div><div style={itemBody}>{preF}</div></div>}
              {preT && <div style={itemStyle}><div style={itemLabel(T.blue)}>Technicals</div><div style={itemBody}>{preT}</div></div>}
              {preB && <div style={itemStyle}><div style={itemLabel(T.blue)}>Bias</div><div style={itemBody}>{preB}</div></div>}
            </div>
          )}
          {hasPost && (
            <div>
              <div style={{ fontSize: 10, color: T.purple, fontFamily: mono, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${T.borderLight}` }}>◨ Post-Trade · written after</div>
              {postW && <div style={itemStyle}><div style={itemLabel(T.purple)}>What happened</div><div style={itemBody}>{postW}</div></div>}
              {postD && <div style={itemStyle}><div style={itemLabel(T.purple)}>Deviations</div><div style={itemBody}>{postD}</div></div>}
              {postL && <div style={itemStyle}><div style={itemLabel(T.purple)}>Lessons</div><div style={itemBody}>{postL}</div></div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════
// DAILY PLAN PAGE — single-page journal
// Fundamentals + Technicals · Yes/No trade toggle · (when Yes) trade list + new trade + What happened + Mistakes
// ══════════════════════════════════════════
function DailyPlanPage({ user, activeAccount, accountTrades, riskGauges, onNewTrade, onEditTrade }) {
  const [viewDate, setViewDate] = useState(new Date());
  const viewDateISO = isoDate(viewDate);
  const todayISO = isoDate(new Date());
  const isToday = viewDateISO === todayISO;
  const isFuture = viewDateISO > todayISO;

  const [plan, setPlan] = useState({
    pre_fundamentals: "",
    pre_technicals: "",
    post_what_happened: "",
    post_deviations: "",
    trade_taken: null,
  });
  const [planId, setPlanId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [pastDays, setPastDays] = useState([]);
  const [pastLoaded, setPastLoaded] = useState(false);
  const [showPastList, setShowPastList] = useState(false);

  // Load plan for the viewed day
  useEffect(() => {
    if (!activeAccount) return;
    const load = async () => {
      const { data: planRow } = await supabase.from("daily_plans")
        .select("*")
        .eq("user_id", user.id)
        .eq("account_id", activeAccount.id)
        .eq("date", viewDateISO)
        .maybeSingle();
      if (planRow) {
        setPlan({
          pre_fundamentals: planRow.pre_fundamentals || "",
          pre_technicals: planRow.pre_technicals || "",
          post_what_happened: planRow.post_what_happened || "",
          post_deviations: planRow.post_deviations || "",
          trade_taken: planRow.trade_taken !== undefined ? planRow.trade_taken : null,
        });
        setPlanId(planRow.id);
      } else {
        setPlan({ pre_fundamentals: "", pre_technicals: "", post_what_happened: "", post_deviations: "", trade_taken: null });
        setPlanId(null);
      }
      setDirty(false);
    };
    load();
  }, [user.id, activeAccount?.id, viewDateISO]);

  // Past days list
  const loadPast = async () => {
    if (!activeAccount) return;
    setPastLoaded(false);
    const start = new Date();
    start.setDate(start.getDate() - 60);
    const startISO = isoDate(start);
    const { data: planRows } = await supabase.from("daily_plans")
      .select("*")
      .eq("user_id", user.id)
      .eq("account_id", activeAccount.id)
      .gte("date", startISO)
      .order("date", { ascending: false });
    const list = (planRows || []).map(p => {
      const hasPre = (p.pre_fundamentals || "").trim() || (p.pre_technicals || "").trim();
      const hasPost = (p.post_what_happened || "").trim() || (p.post_deviations || "").trim();
      return { date: p.date, hasPre, hasPost, trade_taken: p.trade_taken };
    });
    setPastDays(list);
    setPastLoaded(true);
  };
  useEffect(() => { if (showPastList) loadPast(); }, [showPastList, planId, justSaved]);

  const shiftDay = (dir) => {
    const d = parseLocalDate(viewDateISO);
    d.setDate(d.getDate() + dir);
    if (isoDate(d) > todayISO) return;
    setViewDate(d);
  };
  const goToday = () => setViewDate(new Date());

  const updateField = (field, value) => {
    setPlan(p => ({ ...p, [field]: value }));
    setDirty(true);
  };

  const save = async (extra = {}) => {
    if (!activeAccount) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      account_id: activeAccount.id,
      date: viewDateISO,
      pre_fundamentals: plan.pre_fundamentals,
      pre_technicals: plan.pre_technicals,
      post_what_happened: plan.post_what_happened,
      post_deviations: plan.post_deviations,
      trade_taken: plan.trade_taken,
      updated_at: new Date().toISOString(),
      ...extra,
    };
    let res;
    if (planId) res = await supabase.from("daily_plans").update(payload).eq("id", planId).select().single();
    else res = await supabase.from("daily_plans").insert(payload).select().single();
    setSaving(false);
    if (res.error) { alert("Plan save failed: " + res.error.message); return; }
    setPlanId(res.data.id);
    setDirty(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
  };

  // Toggle: trade taken / no trade
  const setTradeTaken = async (val) => {
    setPlan(p => ({ ...p, trade_taken: val }));
    setDirty(true);
    await save({ trade_taken: val });
  };

  const handleBlur = () => { if (dirty) save(); };

  // PDF Export — use shared helper, pass current plan + trades
  const exportPDF = () => {
    exportDailyPDF({ user, activeAccount, dateISO: viewDateISO, dayTrades, plan });
  };

  const dayLabel = (iso) => {
    const d = parseLocalDate(iso);
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };
  const shortDayLabel = (iso) => {
    const d = parseLocalDate(iso);
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };

  // Trades taken for this day
  const dayTrades = useMemo(() => {
    return (accountTrades || []).filter(t => t.date === viewDateISO).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  }, [accountTrades, viewDateISO]);

  const dayStats = useMemo(() => {
    if (dayTrades.length === 0) return null;
    const wins = dayTrades.filter(t => t.result === "Win").length;
    const losses = dayTrades.filter(t => t.result === "Loss").length;
    const be = dayTrades.filter(t => t.result === "Breakeven").length;
    const pnl = dayTrades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
    const usd = dayTrades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
    const wr = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : null;
    return { wins, losses, be, pnl, usd, wr };
  }, [dayTrades]);

  const hasPre = (plan.pre_fundamentals || "").trim() || (plan.pre_technicals || "").trim();
  const hasPost = (plan.post_what_happened || "").trim() || (plan.post_deviations || "").trim();

  const bigTA = {
    width: "100%",
    minHeight: 220,
    padding: "14px 16px",
    border: `0.5px solid ${T.border}`,
    borderRadius: 10,
    background: T.card,
    color: T.text,
    fontFamily: font,
    fontSize: 14,
    lineHeight: 1.65,
    resize: "vertical",
    outline: "none",
    boxSizing: "border-box",
  };
  const sectionLabel = (color) => ({
    fontSize: 11, color, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, marginBottom: 8, fontFamily: font,
  });
  const hintStyle = { fontSize: 11, color: T.textLight, marginBottom: 10, fontStyle: "italic", lineHeight: 1.5 };

  // Auto-set trade_taken=true if user has logged trades for this day and toggle wasn't set
  useEffect(() => {
    if (plan.trade_taken === null && dayTrades.length > 0 && planId) {
      // Soft auto-correct: if there are trades, mark trade_taken true
      setPlan(p => ({ ...p, trade_taken: true }));
    }
  }, [dayTrades.length, planId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* HEADER */}
      <div style={{ ...cardS, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => shiftDay(-1)} style={{ ...btnG, padding: "6px 12px" }}>← Prev</button>
            <input type="date" value={viewDateISO} max={todayISO} onChange={e => { if (e.target.value) setViewDate(parseLocalDate(e.target.value)); }}
              style={{ ...inputS, width: "auto", padding: "7px 10px", fontSize: 12, fontWeight: 600, minWidth: 150 }} />
            <button onClick={() => shiftDay(1)} disabled={isToday || isFuture} style={{ ...btnG, padding: "6px 12px", opacity: (isToday || isFuture) ? 0.4 : 1, cursor: (isToday || isFuture) ? "not-allowed" : "pointer" }}>Next →</button>
            <button onClick={goToday} disabled={isToday} style={{ ...btnG, padding: "6px 12px", fontSize: 11, color: isToday ? T.textLight : T.accent, borderColor: isToday ? T.border : T.accent + "60", marginLeft: 4 }}>TODAY</button>
            <button onClick={() => setShowPastList(s => !s)} style={{ ...btnG, padding: "6px 12px", fontSize: 11, color: T.purple, borderColor: T.purple + "40", marginLeft: 4 }}>
              {showPastList ? "Hide past plans ↑" : "Past plans ↓"}
            </button>
            <button onClick={exportPDF} title="Export this day as PDF (A4)" style={{ ...btnG, padding: "6px 12px", fontSize: 11, color: T.accent, borderColor: T.accent + "40", marginLeft: 4 }}>⏷ PDF</button>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {dirty && <span style={{ fontSize: 11, color: T.amber, fontStyle: "italic" }}>unsaved</span>}
            <button onClick={() => save()} disabled={saving} style={{ ...btnP, padding: "8px 18px", fontSize: 12, opacity: saving ? 0.6 : 1, background: justSaved ? T.green : T.accent, transition: "background 200ms" }}>
              {saving ? "Saving..." : justSaved ? "✓ Saved" : (planId ? "Update" : "Save")}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontFamily: font, fontSize: 16, fontWeight: 700, color: T.text }}>{dayLabel(viewDateISO)}</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {isToday && <span style={{ fontSize: 10, color: T.accent, fontWeight: 700, fontFamily: mono, background: T.accentBg, padding: "3px 10px", borderRadius: 4 }}>● TODAY</span>}
            {hasPre && <span style={{ fontSize: 10, color: T.blue, fontWeight: 700, fontFamily: mono, background: T.blueBg, padding: "3px 10px", borderRadius: 4 }}>✓ PLAN</span>}
            {plan.trade_taken === true && <span style={{ fontSize: 10, color: T.green, fontWeight: 700, fontFamily: mono, background: T.greenBg, padding: "3px 10px", borderRadius: 4 }}>TRADE TAKEN</span>}
            {plan.trade_taken === false && <span style={{ fontSize: 10, color: T.textMid, fontWeight: 700, fontFamily: mono, background: T.cardAlt, padding: "3px 10px", borderRadius: 4 }}>NO TRADE</span>}
            {hasPost && <span style={{ fontSize: 10, color: T.purple, fontWeight: 700, fontFamily: mono, background: T.purpleBg, padding: "3px 10px", borderRadius: 4 }}>✓ REVIEWED</span>}
          </div>
        </div>
      </div>

      {/* RISK GAUGES — self-monitoring totals */}
      {riskGauges && <RiskGauges gauges={riskGauges} />}

      {/* PAST PLANS LIST (collapsible) */}
      {showPastList && (
        <div style={{ ...cardS, padding: 14 }}>
          <div style={{ fontSize: 11, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 10 }}>Past 60 Days · click to open</div>
          {!pastLoaded ? <div style={{ padding: 16, color: T.textLight, fontSize: 12, textAlign: "center" }}>Loading...</div>
            : pastDays.length === 0 ? <div style={{ padding: 16, color: T.textLight, fontSize: 12, textAlign: "center" }}>No past plans yet.</div>
            : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                {pastDays.map(d => {
                  const selected = d.date === viewDateISO;
                  return (
                    <div key={d.date} onClick={() => { setViewDate(parseLocalDate(d.date)); setShowPastList(false); }} style={{
                      padding: "8px 12px",
                      background: selected ? T.accentBg : T.cardAlt,
                      border: `0.5px solid ${selected ? T.accent : T.borderLight}`,
                      borderRadius: 8,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, fontFamily: mono }}>{shortDayLabel(d.date)}</div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {d.hasPre && <span style={{ fontSize: 9, color: T.blue, fontFamily: mono, fontWeight: 700, background: T.blueBg, padding: "1px 6px", borderRadius: 3 }}>PLAN</span>}
                        {d.trade_taken === true && <span style={{ fontSize: 9, color: T.green, fontFamily: mono, fontWeight: 700 }}>● T</span>}
                        {d.trade_taken === false && <span style={{ fontSize: 9, color: T.textMid, fontFamily: mono, fontWeight: 700 }}>○</span>}
                        {d.hasPost && <span style={{ fontSize: 9, color: T.purple, fontFamily: mono, fontWeight: 700, background: T.purpleBg, padding: "1px 6px", borderRadius: 3 }}>REV</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      )}

      {/* PRE-MARKET — Fundamentals + Technicals · big editable cards */}
      <div style={{ ...cardS, padding: 16, borderTop: `3px solid ${T.blue}` }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: T.blue, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 6, fontFamily: font }}>Fundamentals</div>
          <textarea
            value={plan.pre_fundamentals}
            onChange={e => updateField("pre_fundamentals", e.target.value)}
            onBlur={handleBlur}
            placeholder="Macro context, data releases, central banks, sentiment, capital flows..."
            style={{ ...bigTA, minHeight: 240 }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T.blue, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 6, fontFamily: font }}>Technicals</div>
          <textarea
            value={plan.pre_technicals}
            onChange={e => updateField("pre_technicals", e.target.value)}
            onBlur={handleBlur}
            placeholder="EURUSD: daily broken at 1.0850, watching retest. GBPJPY: trending, pullback to 190.50..."
            style={{ ...bigTA, minHeight: 240 }}
          />
        </div>
      </div>

      {/* TOGGLE: Trade taken? — slim */}
      <div style={{ ...cardS, padding: 10, borderTop: `3px solid ${T.accent}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 11, color: T.text, fontWeight: 600, fontFamily: mono, letterSpacing: 0.5 }}>Trade taken today?</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setTradeTaken(true)} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: font,
              cursor: "pointer",
              border: `1px solid ${plan.trade_taken === true ? T.green : T.border}`,
              background: plan.trade_taken === true ? T.green : T.card,
              color: plan.trade_taken === true ? "#fff" : T.text,
            }}>✓ Yes</button>
            <button onClick={() => setTradeTaken(false)} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: font,
              cursor: "pointer",
              border: `1px solid ${plan.trade_taken === false ? T.textMid : T.border}`,
              background: plan.trade_taken === false ? T.textMid : T.card,
              color: plan.trade_taken === false ? "#fff" : T.text,
            }}>✕ No</button>
          </div>
        </div>
      </div>

      {/* IF TRADE TAKEN: trades list + what happened + mistakes all in one card, compact */}
      {plan.trade_taken === true && (
        <div style={{ ...cardS, padding: 14, borderTop: `3px solid ${T.purple}` }}>
          {/* Trades row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textMid, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>
              {dayTrades.length === 0 ? "No trades logged yet" : `Trades · ${dayTrades.length}`}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {dayStats && (
                <div style={{ display: "flex", gap: 8, fontSize: 11, fontFamily: mono }}>
                  <span style={{ color: T.green }}>{dayStats.wins}W</span>
                  <span style={{ color: T.red }}>{dayStats.losses}L</span>
                  {dayStats.wr != null && <span style={{ color: dayStats.wr >= 50 ? T.green : T.red, fontWeight: 600 }}>{dayStats.wr.toFixed(0)}%</span>}
                  <span style={{ color: cP(dayStats.pnl), fontWeight: 700 }}>{fP(dayStats.pnl)}</span>
                </div>
              )}
              <button onClick={() => { onNewTrade(viewDateISO); }} style={{ ...btnP, padding: "6px 12px", fontSize: 11 }}>+ Trade</button>
            </div>
          </div>

          {dayTrades.length === 0 ? (
            <div style={{ padding: "10px 12px", background: T.cardAlt, borderRadius: 6, border: `1px dashed ${T.border}`, textAlign: "center", fontSize: 11, color: T.textMid, marginBottom: 12 }}>
              Click "+ Trade" to log a trade for {viewDateISO}.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
              {dayTrades.map(t => (
                <div key={t.id} style={{ background: T.cardAlt, border: `0.5px solid ${T.borderLight}`, borderRadius: 6, padding: "6px 10px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <Pill text={t.pair} type="pair" />
                    <Pill text={t.direction} />
                    <Pill text={t.result} />
                    <span style={{ fontSize: 10, color: T.textMid, fontFamily: mono }}>{t.session}</span>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: mono, color: cP(t.pnl_pct) }}>{fP(t.pnl_pct)}</span>
                    <span style={{ fontSize: 10, fontFamily: mono, color: cP(t.pnl_usd) }}>{fU(t.pnl_usd)}</span>
                    <button onClick={() => { onEditTrade(t); }} style={{ background: "none", border: "none", color: T.amber, fontSize: 11, padding: "2px 4px", cursor: "pointer" }}>✎</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 10, color: T.textLight, fontStyle: "italic", textAlign: "center", padding: "8px 4px", lineHeight: 1.5 }}>
            Trade notes, market recap, and mistakes are logged per-trade — open any trade to edit.
          </div>
        </div>
      )}

      {/* IF NO TRADE: short message */}
      {plan.trade_taken === false && (
        <div style={{ ...cardS, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: T.text, fontWeight: 600, marginBottom: 6 }}>✓ No-trade day logged</div>
          <div style={{ fontSize: 12, color: T.textMid, fontStyle: "italic", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
            Discipline often looks like sitting on your hands. If the setup wasn't there, this is a win.
          </div>
        </div>
      )}

    </div>
  );
}

// ══════════════════════════════════════════
// DISCIPLINE TRACKER — month-paginated daily habit grid
// Default fields: discipline, happy, confident, tactical
// User can add/remove custom fields (pray, gym, etc.) via Manage modal
// ══════════════════════════════════════════
const DEFAULT_DISCIPLINE_FIELDS = [
  { key: "discipline", label: "Discipline" },
  { key: "happy", label: "Happy" },
  { key: "confident", label: "Confident" },
  { key: "tactical", label: "Tactical" },
];

// ══════════════════════════════════════════
// YEAR PAGE — 12 mini calendars + year stats + yearly recap
// ══════════════════════════════════════════
function YearPage({ user, activeAccount, accountTrades }) {
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [recap, setRecap] = useState("");
  const [recapId, setRecapId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load yearly recap
  useEffect(() => {
    if (!activeAccount) return;
    const load = async () => {
      const { data } = await supabase.from("yearly_recaps")
        .select("*")
        .eq("user_id", user.id)
        .eq("account_id", activeAccount.id)
        .eq("year", viewYear)
        .maybeSingle();
      if (data) { setRecap(data.recap_text || ""); setRecapId(data.id); }
      else { setRecap(""); setRecapId(null); }
      setDirty(false);
    };
    load();
  }, [user.id, activeAccount?.id, viewYear]);

  const save = async () => {
    if (!activeAccount) return;
    setSaving(true);
    const payload = {
      user_id: user.id, account_id: activeAccount.id, year: viewYear,
      recap_text: recap, updated_at: new Date().toISOString(),
    };
    let res;
    if (recapId) res = await supabase.from("yearly_recaps").update(payload).eq("id", recapId).select().single();
    else res = await supabase.from("yearly_recaps").insert(payload).select().single();
    setSaving(false);
    if (res.error) { alert("Save failed: " + res.error.message); return; }
    setRecapId(res.data.id);
    setDirty(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
  };

  // Filter trades for the year
  const yearTrades = useMemo(() =>
    (accountTrades || []).filter(t => t.date && t.date.startsWith(String(viewYear))),
    [accountTrades, viewYear]);

  // Year stats
  const yearStats = useMemo(() => {
    if (yearTrades.length === 0) return null;
    const wins = yearTrades.filter(t => t.result === "Win").length;
    const losses = yearTrades.filter(t => t.result === "Loss").length;
    const be = yearTrades.filter(t => t.result === "Breakeven").length;
    const pnl = yearTrades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
    const usd = yearTrades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
    const wr = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
    // Best and worst month
    const byMonth = {};
    yearTrades.forEach(t => {
      const m = t.date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = 0;
      byMonth[m] += parseFloat(t.pnl_pct) || 0;
    });
    const monthEntries = Object.entries(byMonth);
    const bestMonth = monthEntries.length > 0 ? monthEntries.reduce((a, b) => b[1] > a[1] ? b : a) : null;
    const worstMonth = monthEntries.length > 0 ? monthEntries.reduce((a, b) => b[1] < a[1] ? b : a) : null;
    // Trading days
    const tradingDays = new Set(yearTrades.map(t => t.date)).size;
    return { n: yearTrades.length, wins, losses, be, pnl, usd, wr, bestMonth, worstMonth, tradingDays };
  }, [yearTrades]);

  // Build day-level PnL map for the year
  const dayPnLMap = useMemo(() => {
    const map = {};
    yearTrades.forEach(t => {
      if (!map[t.date]) map[t.date] = 0;
      map[t.date] += parseFloat(t.pnl_pct) || 0;
    });
    return map;
  }, [yearTrades]);

  // Find max abs PnL for intensity scaling
  const maxAbsPnL = useMemo(() => {
    const values = Object.values(dayPnLMap).map(Math.abs);
    return values.length > 0 ? Math.max(...values) : 1;
  }, [dayPnLMap]);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const currentYear = new Date().getFullYear();
  const isCurrentYear = viewYear === currentYear;
  const todayISO = isoDate(new Date());

  // Render mini-calendar for a month
  const renderMiniMonth = (monthIdx) => {
    const firstDay = new Date(viewYear, monthIdx, 1);
    const lastDay = new Date(viewYear, monthIdx + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday
    const cells = [];
    // Blanks before first day
    for (let i = 0; i < startDayOfWeek; i++) cells.push(null);
    // Days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateISO = isoDate(new Date(viewYear, monthIdx, d, 12, 0, 0, 0));
      cells.push({ day: d, dateISO, pnl: dayPnLMap[dateISO] });
    }
    // Calculate month total
    let monthPnL = 0;
    cells.forEach(c => { if (c && c.pnl) monthPnL += c.pnl; });
    return (
      <div style={{ background: T.card, border: `0.5px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{monthNames[monthIdx]}</span>
          {monthPnL !== 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: monthPnL >= 0 ? T.green : T.red, fontFamily: mono }}>
              {monthPnL >= 0 ? "+" : "−"}{Math.abs(monthPnL).toFixed(1)}%
            </span>
          )}
        </div>
        {/* Weekday header */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: 8, color: T.textLight, fontFamily: mono, fontWeight: 600 }}>{d}</div>
          ))}
        </div>
        {/* Day grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {cells.map((c, i) => {
            if (!c) return <div key={i} style={{ aspectRatio: "1", background: "transparent" }} />;
            const hasTrades = c.pnl !== undefined && c.pnl !== 0;
            const isToday = c.dateISO === todayISO;
            let bg = T.cardAlt;
            let textColor = T.textLight;
            if (hasTrades) {
              const intensity = Math.min(1, Math.abs(c.pnl) / maxAbsPnL);
              const baseAlpha = 0.25 + intensity * 0.55;
              if (c.pnl > 0) {
                bg = `rgba(31, 122, 72, ${baseAlpha})`;
                textColor = intensity > 0.5 ? "#fff" : T.green;
              } else {
                bg = `rgba(183, 58, 44, ${baseAlpha})`;
                textColor = intensity > 0.5 ? "#fff" : T.red;
              }
            }
            return (
              <div key={i} title={hasTrades ? `${c.dateISO}: ${c.pnl >= 0 ? "+" : ""}${c.pnl.toFixed(2)}%` : c.dateISO} style={{
                aspectRatio: "1",
                background: bg,
                borderRadius: 3,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: hasTrades ? 700 : 500, fontFamily: mono,
                color: textColor,
                border: isToday ? `1.5px solid ${T.accent}` : "none",
              }}>{c.day}</div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* HEADER */}
      <div style={{ ...cardS, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setViewYear(y => y - 1)} style={{ ...btnG, padding: "6px 12px" }}>← {viewYear - 1}</button>
            <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, padding: "0 12px", minWidth: 80, textAlign: "center" }}>{viewYear}</span>
            <button onClick={() => setViewYear(y => y + 1)} disabled={viewYear >= currentYear} style={{ ...btnG, padding: "6px 12px", opacity: viewYear >= currentYear ? 0.4 : 1 }}>{viewYear + 1} →</button>
            <button onClick={() => setViewYear(currentYear)} disabled={isCurrentYear} style={{ ...btnG, padding: "6px 12px", fontSize: 11, color: isCurrentYear ? T.textLight : T.accent, borderColor: isCurrentYear ? T.border : T.accent + "60", marginLeft: 4 }}>THIS YEAR</button>
          </div>
          <span style={{ fontSize: 12, color: T.textMid, fontFamily: mono }}>{yearTrades.length} {yearTrades.length === 1 ? "trade" : "trades"} in {viewYear}</span>
        </div>
      </div>

      {/* YEAR STATS */}
      {yearStats && (
        <div style={{ ...cardS, padding: 18 }}>
          <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 14 }}>Year overview · {viewYear}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Total PnL %</div>
              <div style={{ fontSize: 22, color: yearStats.pnl >= 0 ? T.green : T.red, fontWeight: 700, letterSpacing: -0.5 }}>{yearStats.pnl >= 0 ? "+" : "−"}{Math.abs(yearStats.pnl).toFixed(2)}%</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Total PnL $</div>
              <div style={{ fontSize: 22, color: yearStats.usd >= 0 ? T.green : T.red, fontWeight: 700, letterSpacing: -0.5 }}>{yearStats.usd >= 0 ? "+" : "−"}${Math.abs(yearStats.usd).toFixed(0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Trades</div>
              <div style={{ fontSize: 22, color: T.text, fontWeight: 700 }}>{yearStats.n}</div>
              <div style={{ fontSize: 10, color: T.textMid, marginTop: 2 }}>{yearStats.tradingDays} trading days</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Win rate</div>
              <div style={{ fontSize: 22, color: yearStats.wr >= 50 ? T.green : T.red, fontWeight: 700 }}>{yearStats.wr.toFixed(0)}%</div>
              <div style={{ fontSize: 10, color: T.textMid, marginTop: 2 }}>{yearStats.wins}W · {yearStats.losses}L{yearStats.be > 0 ? ` · ${yearStats.be}BE` : ""}</div>
            </div>
            {yearStats.bestMonth && (
              <div>
                <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Best month</div>
                <div style={{ fontSize: 16, color: T.green, fontWeight: 700 }}>+{yearStats.bestMonth[1].toFixed(1)}%</div>
                <div style={{ fontSize: 10, color: T.textMid, marginTop: 2 }}>{monthNames[parseInt(yearStats.bestMonth[0].slice(5)) - 1]}</div>
              </div>
            )}
            {yearStats.worstMonth && (
              <div>
                <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Worst month</div>
                <div style={{ fontSize: 16, color: T.red, fontWeight: 700 }}>{yearStats.worstMonth[1].toFixed(1)}%</div>
                <div style={{ fontSize: 10, color: T.textMid, marginTop: 2 }}>{monthNames[parseInt(yearStats.worstMonth[0].slice(5)) - 1]}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 12 MINI-MONTH GRID */}
      <div style={{ ...cardS, padding: 18 }}>
        <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 14 }}>Year at a glance · {viewYear}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {monthNames.map((_, i) => <div key={i}>{renderMiniMonth(i)}</div>)}
        </div>
      </div>

      {/* YEARLY RECAP */}
      <div style={{ ...cardS, padding: 22, borderTop: `3px solid ${T.purple}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div>
            <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Yearly Recap · {viewYear}</span>
            <div style={{ fontSize: 11, color: T.textLight, fontStyle: "italic", marginTop: 2 }}>Sit down end-of-year. What worked. What didn't. What changes next year.</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {dirty && <span style={{ fontSize: 11, color: T.amber, fontStyle: "italic" }}>unsaved</span>}
            <button onClick={save} disabled={saving} style={{ ...btnP, padding: "8px 18px", fontSize: 12, opacity: saving ? 0.6 : 1, background: justSaved ? T.green : T.accent, transition: "background 200ms" }}>
              {saving ? "Saving..." : justSaved ? "✓ Saved" : (recapId ? "Update" : "Save recap")}
            </button>
          </div>
        </div>
        <textarea
          value={recap}
          onChange={e => { setRecap(e.target.value); setDirty(true); }}
          onBlur={() => { if (dirty) save(); }}
          placeholder="Looking back at the year: biggest wins, biggest losses, what I learned about myself, what setups worked, what didn't, what I'm changing next year..."
          style={{
            width: "100%", minHeight: 280, padding: "14px 16px",
            border: `0.5px solid ${T.border}`, borderRadius: 10,
            background: T.card, color: T.text, fontFamily: font, fontSize: 14, lineHeight: 1.65,
            resize: "vertical", outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

    </div>
  );
}

function DisciplineFieldsModal({ fields, onClose, onAdd, onUpdate, onDelete }) {
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const handleAdd = async () => {
    const label = newLabel.trim();
    if (!label) return;
    await onAdd(label);
    setNewLabel("");
  };
  const handleStartEdit = (f) => { setEditingId(f.id); setEditValue(f.label); };
  const handleSaveEdit = async () => { if (!editValue.trim()) return; await onUpdate(editingId, editValue.trim()); setEditingId(null); setEditValue(""); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", ...center, zIndex: 1000, padding: 20 }}>
      <div style={{ ...cardS, padding: 24, width: "100%", maxWidth: 540, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Discipline Fields</span>
          <button onClick={onClose} style={btnG}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: T.textMid, marginBottom: 16, lineHeight: 1.5, fontFamily: mono }}>
          Add or rename the daily checkboxes you want to track. Examples: Pray, Gym, Read, Meditate, No-screen-morning, Journal.
        </div>
        <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>Add New Field</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAdd()} placeholder="e.g. Gym" style={inputS} />
            <button onClick={handleAdd} style={{ ...btnP, padding: "9px 16px", whiteSpace: "nowrap" }}>+ Add</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>Your Fields ({fields.length})</div>
          {fields.map((f, idx) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: T.cardAlt, borderRadius: 8, marginBottom: 4 }}>
              {editingId === f.id ? (
                <>
                  <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono, marginRight: 8 }}>{idx + 1}.</span>
                  <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") { setEditingId(null); setEditValue(""); } }} autoFocus style={{ ...inputS, flex: 1, marginRight: 8 }} />
                  <button onClick={handleSaveEdit} style={{ ...btnG, fontSize: 11, padding: "5px 12px", color: T.green, borderColor: T.green + "40" }}>Save</button>
                  <button onClick={() => { setEditingId(null); setEditValue(""); }} style={{ ...btnG, fontSize: 11, padding: "5px 10px", marginLeft: 4 }}>Cancel</button>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                    <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>{idx + 1}.</span>
                    <span style={{ fontSize: 13, color: T.text }}>{f.label}</span>
                    <span style={{ fontSize: 9, color: T.textLight, fontFamily: mono }}>({f.key})</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handleStartEdit(f)} style={{ ...btnG, fontSize: 10, padding: "4px 10px" }}>Edit</button>
                    <button onClick={() => onDelete(f.id)} style={{ ...btnG, fontSize: 10, padding: "4px 10px", color: T.red, borderColor: T.red + "40" }}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DisciplinePage({ user }) {
  const [viewMonth, setViewMonth] = useState(new Date()); // first of viewed month
  const [fields, setFields] = useState([]);
  const [showFieldsModal, setShowFieldsModal] = useState(false);
  const [days, setDays] = useState({}); // { 'YYYY-MM-DD': { checks: {...}, id } }
  const [loading, setLoading] = useState(true);

  const year = viewMonth.getFullYear();
  const monthIdx = viewMonth.getMonth();
  const monthLabel = viewMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const today = new Date();
  const todayISO = isoDate(today);
  const isCurrentMonth = year === today.getFullYear() && monthIdx === today.getMonth();

  // Load fields (seed defaults if empty)
  useEffect(() => {
    const loadFields = async () => {
      const { data } = await supabase.from("discipline_fields")
        .select("*")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true });
      if (data && data.length > 0) {
        setFields(data);
      } else {
        // Seed default 4 fields
        const seed = DEFAULT_DISCIPLINE_FIELDS.map((f, i) => ({
          user_id: user.id, key: f.key, label: f.label, sort_order: i,
        }));
        const { data: seeded } = await supabase.from("discipline_fields").insert(seed).select();
        setFields((seeded || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
      }
    };
    loadFields();
  }, [user.id]);

  // Load days for the current viewed month
  useEffect(() => {
    const loadDays = async () => {
      setLoading(true);
      const firstISO = isoDate(new Date(year, monthIdx, 1));
      const lastISO = isoDate(new Date(year, monthIdx + 1, 0));
      const { data } = await supabase.from("discipline_days")
        .select("*")
        .eq("user_id", user.id)
        .gte("date", firstISO)
        .lte("date", lastISO);
      const map = {};
      (data || []).forEach(row => { map[row.date] = { id: row.id, checks: row.checks || {} }; });
      setDays(map);
      setLoading(false);
    };
    loadDays();
  }, [user.id, year, monthIdx]);

  // Toggle a checkbox for a specific date + field
  const toggleCheck = async (dateISO, fieldKey) => {
    const current = days[dateISO] || { id: null, checks: {} };
    const newChecks = { ...current.checks, [fieldKey]: !current.checks[fieldKey] };
    // Optimistic update
    setDays(d => ({ ...d, [dateISO]: { ...current, checks: newChecks } }));
    // Persist
    if (current.id) {
      const { data, error } = await supabase.from("discipline_days")
        .update({ checks: newChecks, updated_at: new Date().toISOString() })
        .eq("id", current.id)
        .select()
        .single();
      if (error) {
        alert("Save failed: " + error.message);
        // Revert
        setDays(d => ({ ...d, [dateISO]: current }));
        return;
      }
      // Confirm in-memory state matches DB
      if (data) setDays(d => ({ ...d, [dateISO]: { id: data.id, checks: data.checks } }));
    } else {
      const { data, error } = await supabase.from("discipline_days").insert({
        user_id: user.id, date: dateISO, checks: newChecks,
      }).select().single();
      if (error) {
        alert("Save failed: " + error.message);
        // Revert
        setDays(d => { const copy = { ...d }; delete copy[dateISO]; return copy; });
        return;
      }
      if (data) setDays(d => ({ ...d, [dateISO]: { id: data.id, checks: data.checks } }));
    }
  };

  // Field CRUD
  const addField = async (label) => {
    // Generate a key from label
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
    if (!key) { alert("Field name must contain letters or numbers."); return; }
    if (fields.some(f => f.key === key)) { alert("A field with that name already exists."); return; }
    const nextOrder = fields.length > 0 ? Math.max(...fields.map(f => f.sort_order || 0)) + 1 : 0;
    const { data, error } = await supabase.from("discipline_fields").insert({
      user_id: user.id, key, label, sort_order: nextOrder,
    }).select().single();
    if (error) { alert("Error: " + error.message); return; }
    setFields(p => [...p, data]);
  };
  const updateField = async (id, newLabel) => {
    const { data, error } = await supabase.from("discipline_fields").update({ label: newLabel }).eq("id", id).select().single();
    if (error) { alert("Error: " + error.message); return; }
    setFields(p => p.map(x => x.id === id ? data : x));
  };
  const deleteField = async (id) => {
    const f = fields.find(x => x.id === id);
    if (!confirm(`Delete "${f?.label}"? Historical checks for this field stay in the database but won't show in the grid.`)) return;
    await supabase.from("discipline_fields").delete().eq("id", id);
    setFields(p => p.filter(x => x.id !== id));
  };

  const shiftMonth = (dir) => setViewMonth(new Date(year, monthIdx + dir, 1));
  const goCurrent = () => setViewMonth(new Date());

  // Build rows for the viewed month
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const monthRows = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, monthIdx, d, 12, 0, 0, 0);
    const iso = isoDate(date);
    const dow = date.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dow === 0 || dow === 6;
    const isFuture = iso > todayISO;
    monthRows.push({ iso, date, dow, isWeekend, isToday: iso === todayISO, isFuture });
  }

  // Month-level progress (only count days up to today within the viewed month)
  const monthProgress = useMemo(() => {
    if (fields.length === 0) return null;
    const relevant = monthRows.filter(r => !r.isFuture);
    if (relevant.length === 0) return null;
    let ticked = 0;
    const total = relevant.length * fields.length;
    relevant.forEach(r => {
      const checks = (days[r.iso] || {}).checks || {};
      fields.forEach(f => { if (checks[f.key]) ticked++; });
    });
    return { ticked, total, pct: total > 0 ? (ticked / total) * 100 : 0, daysCounted: relevant.length };
  }, [monthRows, fields, days]);

  // Year-level progress (only count days up to today across the whole year)
  // Note: this only loads the current month into `days`; we'd need a separate query for full-year.
  // For simplicity, we show month progress only. Year metric would require another endpoint.

  // Per-field streak for current month (consecutive days ticked, working back from today)
  const fieldStreaks = useMemo(() => {
    const result = {};
    fields.forEach(f => {
      // Build a sorted list of days in viewed month with their checked status
      const monthDays = [];
      for (let day = 1; day <= new Date(year, monthIdx + 1, 0).getDate(); day++) {
        const iso = isoDate(new Date(year, monthIdx, day, 12, 0, 0, 0));
        // Skip future days when calculating current month
        if (iso > isoDate(new Date())) continue;
        const checks = (days[iso] || {}).checks || {};
        monthDays.push({ iso, checked: !!checks[f.key] });
      }
      // Total ticked
      const total = monthDays.filter(d => d.checked).length;
      // Best streak in this month (longest consecutive run of checked days)
      let bestStreak = 0;
      let currentRun = 0;
      monthDays.forEach(d => {
        if (d.checked) {
          currentRun++;
          if (currentRun > bestStreak) bestStreak = currentRun;
        } else {
          currentRun = 0;
        }
      });
      // Current ongoing streak (from latest counted day, going back)
      let ongoing = 0;
      for (let i = monthDays.length - 1; i >= 0; i--) {
        if (monthDays[i].checked) ongoing++;
        else break;
      }
      result[f.key] = { total, bestStreak, ongoing };
    });
    return result;
  }, [fields, days, year, monthIdx]);

  const dayNameShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {showFieldsModal && (
        <DisciplineFieldsModal
          fields={fields}
          onClose={() => setShowFieldsModal(false)}
          onAdd={addField}
          onUpdate={updateField}
          onDelete={deleteField}
        />
      )}

      {/* HEADER: month nav + progress + manage button */}
      <div style={{ ...cardS, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => shiftMonth(-1)} style={{ ...btnG, padding: "6px 12px" }}>←</button>
            <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, padding: "0 12px", minWidth: 180, textAlign: "center" }}>{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} style={{ ...btnG, padding: "6px 12px" }}>→</button>
            <button onClick={goCurrent} disabled={isCurrentMonth} style={{ ...btnG, padding: "6px 12px", fontSize: 11, color: isCurrentMonth ? T.textLight : T.accent, borderColor: isCurrentMonth ? T.border : T.accent + "60", marginLeft: 6 }}>THIS MONTH</button>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {monthProgress && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: mono, fontSize: 12 }}>
                <span style={{ color: T.textLight }}>Progress:</span>
                <span style={{ color: monthProgress.pct >= 70 ? T.green : monthProgress.pct >= 40 ? T.amber : T.red, fontWeight: 700 }}>
                  {monthProgress.ticked} / {monthProgress.total}
                </span>
                <span style={{ color: monthProgress.pct >= 70 ? T.green : monthProgress.pct >= 40 ? T.amber : T.red, fontWeight: 700 }}>
                  ({monthProgress.pct.toFixed(0)}%)
                </span>
                <span style={{ color: T.textLight, fontSize: 10 }}>· {monthProgress.daysCounted} days counted</span>
              </div>
            )}
            <button onClick={() => setShowFieldsModal(true)} style={{ ...btnG, padding: "6px 12px", fontSize: 11 }}>⚙ Manage Fields ({fields.length})</button>
          </div>
        </div>
      </div>

      {/* PER-FIELD STATS — visible on any month */}
      {fields.length > 0 && (
        <div style={{ ...cardS, padding: 14 }}>
          <div style={{ fontSize: 10, color: T.textMid, letterSpacing: 1, textTransform: "uppercase", fontFamily: font, fontWeight: 700, marginBottom: 10 }}>
            {isCurrentMonth ? "This month · running totals" : `${monthLabel} · final totals`}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {fields.map(f => {
              const s = fieldStreaks[f.key] || { total: 0, bestStreak: 0, ongoing: 0 };
              const totalColor = s.total >= 15 ? T.green : s.total >= 7 ? T.amber : s.total > 0 ? T.text : T.textLight;
              return (
                <div key={f.key} style={{ background: T.cardAlt, borderRadius: 10, padding: "10px 12px", border: `0.5px solid ${T.borderLight}` }}>
                  <div style={{ fontSize: 10, color: T.textMid, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: font, fontWeight: 700, marginBottom: 6 }}>{f.label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, fontFamily: mono, color: totalColor, lineHeight: 1 }}>{s.total}</span>
                    <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>days ticked</span>
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 10, color: T.textMid, fontFamily: mono }}>
                    <span title="Longest consecutive run in this month">Best: <strong style={{ color: T.text }}>{s.bestStreak}</strong></span>
                    {isCurrentMonth && <span title="Current consecutive run from latest day">Now: <strong style={{ color: s.ongoing > 0 ? T.green : T.textLight }}>{s.ongoing}</strong></span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MAIN GRID */}
      <div style={{ ...cardS, padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: T.textLight, fontSize: 12 }}>Loading...</div>
        ) : fields.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: T.textLight, fontSize: 13 }}>
            No fields defined. Click <strong>⚙ Manage Fields</strong> to add some.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: mono, minWidth: 400 + fields.length * 80 }}>
              <thead>
                <tr style={{ background: T.cardAlt, borderBottom: `1px solid ${T.border}` }}>
                  <th style={{ textAlign: "left", padding: "12px 16px", color: T.textMid, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, position: "sticky", top: 0, background: T.cardAlt, minWidth: 160 }}>Date</th>
                  {fields.map(f => (
                    <th key={f.key} style={{ textAlign: "center", padding: "12px 8px", color: T.text, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, position: "sticky", top: 0, background: T.cardAlt, minWidth: 80 }}>
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthRows.map(r => {
                  const checks = (days[r.iso] || {}).checks || {};
                  const rowBg = r.isToday ? T.accentBg : r.isWeekend ? T.cardAlt : T.card;
                  const dateColor = r.isToday ? T.accent : r.isFuture ? T.textLight : r.isWeekend ? T.textMid : T.text;
                  return (
                    <tr key={r.iso} style={{ background: rowBg, borderBottom: `1px solid ${T.borderLight}` }}>
                      <td style={{ padding: "10px 16px", fontWeight: r.isToday ? 700 : 500, color: dateColor }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontFamily: mono, fontSize: 11, color: T.textLight, minWidth: 30 }}>{dayNameShort[r.dow]}</span>
                          <span style={{ fontFamily: mono, fontSize: 13 }}>{String(r.date.getDate()).padStart(2, "0")}</span>
                          {r.isToday && <span style={{ fontSize: 9, color: T.accent, fontWeight: 700, fontFamily: mono, background: T.card, padding: "1px 6px", borderRadius: 3, marginLeft: 4 }}>● TODAY</span>}
                          {r.isWeekend && !r.isToday && <span style={{ fontSize: 9, color: T.textLight, fontFamily: mono, marginLeft: 4 }}>weekend</span>}
                        </div>
                      </td>
                      {fields.map(f => {
                        const isChecked = !!checks[f.key];
                        return (
                          <td key={f.key} style={{ textAlign: "center", padding: "10px 8px" }}>
                            <div
                              onClick={() => !r.isFuture && toggleCheck(r.iso, f.key)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center", justifyContent: "center",
                                width: 22, height: 22,
                                borderRadius: 5,
                                background: isChecked ? T.green : (r.isFuture ? T.cardAlt : T.card),
                                border: `1.5px solid ${isChecked ? T.green : (r.isFuture ? T.borderLight : T.border)}`,
                                cursor: r.isFuture ? "not-allowed" : "pointer",
                                color: "#fff", fontSize: 13, fontWeight: 700,
                                opacity: r.isFuture ? 0.4 : 1,
                                transition: "all 120ms",
                              }}
                            >
                              {isChecked ? "✓" : ""}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// RECAP TAB
// ══════════════════════════════════════════
function RecapTab({ user, accounts, activeAccount, lockedPeriodType }) {
  const [periodType, setPeriodType] = useState(lockedPeriodType || "week");
  // When locked, force the period type whenever the lock changes
  useEffect(() => { if (lockedPeriodType) setPeriodType(lockedPeriodType); }, [lockedPeriodType]);
  const [periodDate, setPeriodDate] = useState(new Date());
  const [recap, setRecap] = useState(emptyRecap());
  const [recapId, setRecapId] = useState(null);
  const [periodTrades, setPeriodTrades] = useState([]);
  const [pastRecaps, setPastRecaps] = useState([]);
  const [scope, setScope] = useState("active");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [expandedTrades, setExpandedTrades] = useState({});

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
        // Merge old 4-field data into 2-field structure: pattern_text + change_text fold into negatives
        const oldNegativeParts = [
          rRow.didnt_work_text || "",
          rRow.pattern_text || "",
          rRow.change_text || "",
        ].filter(s => s.trim());
        setRecap({
          positives: rRow.worked_text || "",
          negatives: oldNegativeParts.join("\n\n"),
        });
        setRecapId(rRow.id);
        setSavedAt(rRow.updated_at || rRow.created_at);
      } else {
        setRecap(emptyRecap());
        setRecapId(null);
        setSavedAt(null);
      }
      setExpandedTrades({});
      setNotesOpen(false);
    };
    load();
  }, [periodStart, periodEnd, periodType, effectiveAccountId, user.id]);

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
    const pairCounts = {};
    periodTrades.forEach(t => { if (t.pair) pairCounts[t.pair] = (pairCounts[t.pair] || 0) + 1; });
    const topPair = Object.entries(pairCounts).sort((a, b) => b[1] - a[1])[0];
    return { n, w: w.length, l: l.length, be: b.length, wr, tPnl, tUsd, topPair };
  }, [periodTrades]);

  const tradesWithNotes = useMemo(() => periodTrades.filter(t => (t.notes_technical || "").trim() || (t.notes_fundamental || "").trim() || (t.notes_mistakes || "").trim()), [periodTrades]);
  const toggleTradeExpanded = (id) => setExpandedTrades(p => ({ ...p, [id]: !p[id] }));

  const jumpToCurrent = () => setPeriodDate(new Date());
  const jumpToPrevious = () => {
    const d = new Date();
    if (periodType === "week") d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setPeriodDate(d);
  };
  const todayISO = isoDate(new Date());
  const isViewingCurrent = todayISO >= periodStart && todayISO <= periodEnd;

  const saveRecap = async () => {
    setSaving(true);
    const payload = {
      user_id: user.id, account_id: effectiveAccountId,
      period_type: periodType, period_start: periodStart, period_end: periodEnd,
      worked_text: recap.positives, didnt_work_text: recap.negatives,
      pattern_text: "", change_text: "",
      conviction: 3, updated_at: new Date().toISOString(),
    };
    let result;
    if (recapId) result = await supabase.from("recaps").update(payload).eq("id", recapId).select().single();
    else result = await supabase.from("recaps").insert(payload).select().single();
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
  const jumpTo = (recapRow) => { setPeriodType(recapRow.period_type); setPeriodDate(parseLocalDate(recapRow.period_start)); };
  const scopeLabel = scope === "all" ? "All Accounts" : (scope === "active" ? `${activeAccount?.name || "—"}` : (accounts.find(a => a.id === scope)?.name || "—"));

  // Print mistakes to PDF via browser print dialog
  const printMistakes = () => {
    const tradeMistakes = periodTrades
      .filter(t => (t.notes_mistakes || "").trim())
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "<br>");
    const headerLine = `${periodLabel} · ${scopeLabel}`;
    const refineText = (recap.positives || "").trim();
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Mistakes Review — ${esc(periodLabel)}</title>
<style>
  @page { margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, sans-serif; color: #2C2418; margin: 0; padding: 24px; line-height: 1.55; }
  h1 { font-size: 22px; margin: 0 0 4px 0; font-weight: 700; }
  .sub { font-size: 12px; color: #6B5D4F; letter-spacing: 0.5px; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid #E8E0D4; }
  .section-title { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #9C8E7E; margin: 22px 0 10px 0; font-weight: 700; }
  .mistake { margin-bottom: 14px; padding: 12px 14px; background: #FDF0EF; border-left: 4px solid #C4342A; border-radius: 4px; page-break-inside: avoid; }
  .mistake-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; font-size: 11px; }
  .date { font-family: 'Courier New', monospace; color: #6B5D4F; font-weight: 600; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Courier New', monospace; }
  .pill-pair { background: #FDF3E8; color: #C47A3B; }
  .pill-long, .pill-win { background: #E8F5EE; color: #1A8754; }
  .pill-short, .pill-loss { background: #FDF0EF; color: #C4342A; }
  .pill-breakeven { background: #FAF8F4; color: #6B5D4F; }
  .pnl { margin-left: auto; font-family: 'Courier New', monospace; font-weight: 700; }
  .pnl.pos { color: #1A8754; } .pnl.neg { color: #C4342A; }
  .body { font-size: 13px; color: #2C2418; white-space: pre-wrap; }
  .refine { background: #E8F5EE; border-left: 4px solid #1A8754; padding: 14px 16px; border-radius: 4px; font-size: 13px; white-space: pre-wrap; page-break-inside: avoid; }
  .empty { color: #9C8E7E; font-style: italic; padding: 16px 0; }
  .footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #E8E0D4; font-size: 10px; color: #9C8E7E; font-family: 'Courier New', monospace; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>Mistakes Review</h1>
<div class="sub">${esc(headerLine)} · Generated ${new Date().toLocaleString()}</div>

${refineText ? `
<div class="section-title">✓ What to Refine / Keep Doing</div>
<div class="refine">${esc(refineText)}</div>
` : ""}

<div class="section-title">✕ Mistakes from Trades · ${tradeMistakes.length} ${tradeMistakes.length === 1 ? "entry" : "entries"}</div>
${tradeMistakes.length === 0 ? '<div class="empty">No trade mistakes logged in this period.</div>' :
  tradeMistakes.map(t => {
    const pnlClass = (parseFloat(t.pnl_pct) || 0) >= 0 ? "pos" : "neg";
    const pnlVal = (parseFloat(t.pnl_pct) || 0);
    const pnlStr = `${pnlVal >= 0 ? "+" : ""}${pnlVal.toFixed(2)}%`;
    return `
    <div class="mistake">
      <div class="mistake-head">
        <span class="date">${esc(t.date)}</span>
        <span class="pill pill-pair">${esc(t.pair)}</span>
        <span class="pill pill-${(t.direction || '').toLowerCase()}">${esc(t.direction)}</span>
        <span class="pill pill-${(t.result || '').toLowerCase()}">${esc(t.result)}</span>
        <span class="pnl ${pnlClass}">${pnlStr}</span>
      </div>
      <div class="body">${esc(t.notes_mistakes)}</div>
    </div>`;
  }).join("")
}

<div class="footer">VARMARI · Mistakes review · Use browser Print → Save as PDF</div>
<script>window.onload = () => setTimeout(() => window.print(), 250);</script>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow popups for varmari.com to print."); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const sectionStyle = (color) => ({ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${color}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column" });
  const sectionLabel = (color) => ({ fontSize: 11, fontWeight: 700, color, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 8 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* COMPACT TOP BAR */}
      <div style={{ ...cardS, padding: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {!lockedPeriodType && (
            <div style={{ display: "flex", gap: 0 }}>
              <button onClick={() => setPeriodType("week")} style={{ ...btnG, padding: "7px 14px", background: periodType === "week" ? T.accent : "transparent", color: periodType === "week" ? "#fff" : T.textMid, borderColor: periodType === "week" ? T.accent : T.border, borderRadius: "8px 0 0 8px" }}>Weekly</button>
              <button onClick={() => setPeriodType("month")} style={{ ...btnG, padding: "7px 14px", background: periodType === "month" ? T.accent : "transparent", color: periodType === "month" ? "#fff" : T.textMid, borderColor: periodType === "month" ? T.accent : T.border, borderRadius: "0 8px 8px 0", borderLeft: "none" }}>Monthly</button>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => shiftPeriod(-1)} style={{ ...btnG, padding: "6px 10px" }}>←</button>
            <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, padding: "0 10px", minWidth: 220, textAlign: "center" }}>
              {periodLabel}
              {isViewingCurrent && <span style={{ marginLeft: 6, fontSize: 9, color: T.green, fontWeight: 700 }}>● CURRENT</span>}
            </div>
            <button onClick={() => shiftPeriod(1)} style={{ ...btnG, padding: "6px 10px" }}>→</button>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={jumpToPrevious} style={{ ...btnG, padding: "6px 10px", fontSize: 11 }}>{periodType === "week" ? "Last Week" : "Last Month"}</button>
            <button onClick={jumpToCurrent} style={{ ...btnG, padding: "6px 10px", fontSize: 11, color: isViewingCurrent ? T.textLight : T.accent, borderColor: isViewingCurrent ? T.border : T.accent + "60" }}>{periodType === "week" ? "This Week" : "This Month"}</button>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <select value={scope} onChange={e => setScope(e.target.value)} style={{ ...selectS, fontSize: 11, padding: "6px 10px", width: "auto" }}>
              <option value="active">Account: {activeAccount?.name || "—"}</option>
              <option value="all">All Accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* PERIOD STATS */}
      {periodStats ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <Stat label="Trades" value={periodStats.n} sub={`${periodStats.w}W / ${periodStats.l}L / ${periodStats.be}BE`} />
          <Stat label="Win Rate" value={`${periodStats.wr.toFixed(0)}%`} color={periodStats.wr >= 50 ? T.green : T.red} />
          <Stat label="PnL %" value={fP(periodStats.tPnl)} color={cP(periodStats.tPnl)} />
          <Stat label="PnL $" value={fU(periodStats.tUsd)} color={cP(periodStats.tUsd)} />
          <Stat label="Most Traded" value={periodStats.topPair ? periodStats.topPair[0] : "—"} sub={periodStats.topPair ? `${periodStats.topPair[1]}x` : ""} />
        </div>
      ) : (
        <div style={{ ...cardS, padding: 24, textAlign: "center", color: T.textLight, fontSize: 13 }}>No trades in this period. Use the reflection sections below for planning notes.</div>
      )}

      {/* REFLECTION 2x2 */}
      <div style={{ ...cardS, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Reflection</span>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {savedAt && <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>Saved {new Date(savedAt).toLocaleString()}</span>}
            <button onClick={saveRecap} disabled={saving} style={{ ...btnP, padding: "8px 18px", opacity: saving ? 0.6 : 1, background: justSaved ? T.green : T.accent, transition: "background 200ms" }}>{saving ? "Saving..." : justSaved ? "✓ Saved" : (recapId ? "Update" : "Save Recap")}</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          {/* REFINE (was Positives) — saves to recap.positives */}
          <div style={sectionStyle(T.green)}>
            <div style={sectionLabel(T.green)}>✓ Refine</div>
            <textarea value={recap.positives} onChange={e => setRecap({ ...recap, positives: e.target.value })} rows={10} placeholder="What's working that you want to keep doing — strong setups, good discipline, profitable patterns to refine and build on..." style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 220, background: T.cardAlt }} />
          </div>
          {/* MISTAKES — auto-filled trade mistakes (read-only) + editable area for period-level notes */}
          <div style={sectionStyle(T.red)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ ...sectionLabel(T.red), marginBottom: 0 }}>✕ Mistakes</div>
              <button onClick={printMistakes} title="Print / Save as PDF" style={{ ...btnG, fontSize: 10, padding: "4px 10px", color: T.red, borderColor: T.red + "40" }}>📄 PDF</button>
            </div>
            {(() => {
              const tradeMistakes = periodTrades
                .filter(t => (t.notes_mistakes || "").trim())
                .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
              if (tradeMistakes.length === 0) {
                return <div style={{ fontSize: 11, color: T.textLight, fontFamily: mono, padding: "10px 12px", background: T.cardAlt, border: `1px dashed ${T.border}`, borderRadius: 6, marginBottom: 10 }}>No trade mistakes logged this period.</div>;
              }
              return (
                <div style={{ marginBottom: 10, background: T.redBg, border: `1px solid ${T.red}30`, borderRadius: 6, padding: 12, maxHeight: 550, overflowY: "auto" }}>
                  <div style={{ fontSize: 9, color: T.red, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, fontWeight: 700, marginBottom: 8 }}>From trades · {tradeMistakes.length} {tradeMistakes.length === 1 ? "entry" : "entries"} (auto)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {tradeMistakes.map(t => (
                      <div key={t.id} style={{ background: T.card, borderRadius: 5, padding: "8px 10px", border: `1px solid ${T.borderLight}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 9, fontFamily: mono, color: T.textLight, fontWeight: 600 }}>{t.date}</span>
                          <Pill text={t.pair} type="pair" />
                          <Pill text={t.direction} />
                          <Pill text={t.result} />
                          <span style={{ fontSize: 10, fontFamily: mono, color: cP(t.pnl_pct), fontWeight: 600, marginLeft: "auto" }}>{fP(t.pnl_pct)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: T.text, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{t.notes_mistakes}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div style={{ fontSize: 10, color: T.textLight, fontFamily: mono, fontStyle: "italic", textAlign: "center", padding: "4px 0" }}>Period-level reflections go in the Refine box →</div>
          </div>
        </div>
      </div>

      {/* COLLAPSIBLE TRADE NOTES */}
      {tradesWithNotes.length > 0 && (
        <div style={{ ...cardS, overflow: "hidden" }}>
          <div onClick={() => setNotesOpen(!notesOpen)} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: notesOpen ? `1px solid ${T.border}` : "none" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.textMid, fontFamily: mono, letterSpacing: 0.5 }}>📋 Trade Notes from this Period · {tradesWithNotes.length} trade{tradesWithNotes.length === 1 ? "" : "s"}</span>
            <span style={{ fontSize: 16, color: T.textMid, transform: notesOpen ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>›</span>
          </div>
          {notesOpen && (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
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
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, color: cP(t.pnl_pct) }}>{fP(t.pnl_pct)}</span>
                        <span style={{ fontSize: 12, color: T.textMid, transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>›</span>
                      </div>
                    </div>
                    {open && (
                      <div style={{ padding: "0 14px 14px 14px", display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${T.borderLight}` }}>
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* PAST RECAPS */}
      <div style={{ ...cardS, padding: 16 }}>
        <div style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, marginBottom: 10 }}>Past {periodType === "week" ? "Weekly" : "Monthly"} Recaps · {scopeLabel}</div>
        {pastRecaps.length === 0 ? (
          <div style={{ color: T.textLight, fontSize: 13, padding: 12, textAlign: "center" }}>No past recaps yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {pastRecaps.map(r => (
              <div key={r.id} onClick={() => jumpTo(r)} style={{ cursor: "pointer", padding: "8px 12px", background: r.id === recapId ? T.accentBg : T.cardAlt, borderRadius: 6, border: r.id === recapId ? `1px solid ${T.accent}` : "1px solid transparent", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{formatPeriodLabel(r.period_type, r.period_start)}</div>
                <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>{new Date(r.updated_at || r.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Journal({ user, onLogout }) {
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [trades, setTrades] = useState([]);
  const [pairs, setPairs] = useState([]);
  const [tradeTypes, setTradeTypes] = useState([]);
  const [showTradeTypesModal, setShowTradeTypesModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showPairsModal, setShowPairsModal] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [dailySubTab, setDailySubTab] = useState("daily"); // daily | weekly | monthly
  const [moreStatsOpen, setMoreStatsOpen] = useState(false);
  const [page, setPage] = useState("journal");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyTrade());
  const [editId, setEditId] = useState(null);
  const [fPair, setFPair] = useState("All");
  const [fResult, setFResult] = useState("All");
  const [fDay, setFDay] = useState("All");
  const [fSess, setFSess] = useState("All");
  const [fDir, setFDir] = useState("All");
  const [fTag, setFTag] = useState("All");
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("none"); // none | week | month
  const [calMonth, setCalMonth] = useState(new Date()); // month displayed on dashboard calendar
  const [dayModal, setDayModal] = useState(null); // { dateISO, trades } or null
  const [replayTrade, setReplayTrade] = useState(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [dashboardPeriod, setDashboardPeriod] = useState("all"); // all | year | month | week
  const [exportingHTML, setExportingHTML] = useState(false);

  useEffect(() => {
    const loadAll = async () => {
      const { data: accData } = await supabase.from("accounts").select("*").order("created_at", { ascending: true });
      setAccounts(accData || []);
      if (accData && accData.length > 0) setActiveAccount(accData[0]);
      else setShowAccountModal(true);
      const { data: pairData } = await supabase.from("user_pairs").select("*").order("sort_order", { ascending: true });
      if (pairData && pairData.length > 0) setPairs(pairData);
      else {
        const seedRows = DEFAULT_PAIRS.map((name, i) => ({ user_id: user.id, name, sort_order: i }));
        const { data: seeded } = await supabase.from("user_pairs").insert(seedRows).select();
        setPairs((seeded || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
      }
      const { data: typeData } = await supabase.from("user_trade_types").select("*").order("sort_order", { ascending: true });
      if (typeData && typeData.length > 0) setTradeTypes(typeData);
      else {
        const DEFAULT_TYPES = ["Transition", "Re-Transition", "Confirmation", "Continuation", "Fundamental", "Technical", "Fundamental + Technical"];
        const seedRows = DEFAULT_TYPES.map((name, i) => ({ user_id: user.id, name, sort_order: i }));
        const { data: seeded } = await supabase.from("user_trade_types").insert(seedRows).select();
        setTradeTypes((seeded || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
      }
      setLoading(false);
    };
    loadAll();
  }, [user.id]);

  useEffect(() => {
    if (!activeAccount) { setTrades([]); return; }
    const loadTrades = async () => {
      const { data } = await supabase.from("trades").select("*").eq("account_id", activeAccount.id).order("date", { ascending: false });
      setTrades((data || []).map(t => ({ ...t, day: t.day || getDay(t.date) })));
    };
    loadTrades();
  }, [activeAccount]);

  const pairNames = useMemo(() => pairs.map(p => p.name), [pairs]);
  const allTags = useMemo(() => {
    const set = new Set();
    trades.forEach(t => {
      (t.tags || "").split(",").map(s => s.trim().toLowerCase()).filter(s => s).forEach(tag => set.add(tag));
    });
    return [...set].sort();
  }, [trades]);

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
  const selectAccount = (id) => { const a = accounts.find(x => x.id === id); if (a) { setActiveAccount(a); setShowAccountModal(false); } };

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

  // Trade Types CRUD
  const addTradeType = async (name) => {
    if (tradeTypes.some(t => t.name.toLowerCase() === name.toLowerCase())) { alert("That type already exists."); return; }
    const nextOrder = tradeTypes.length > 0 ? Math.max(...tradeTypes.map(t => t.sort_order || 0)) + 1 : 0;
    const { data, error } = await supabase.from("user_trade_types").insert({ user_id: user.id, name, sort_order: nextOrder }).select().single();
    if (error) { alert("Error: " + error.message); return; }
    setTradeTypes(p => [...p, data]);
  };
  const updateTradeType = async (id, newName) => {
    if (tradeTypes.some(t => t.id !== id && t.name.toLowerCase() === newName.toLowerCase())) { alert("That type name already exists."); return; }
    const { data, error } = await supabase.from("user_trade_types").update({ name: newName }).eq("id", id).select().single();
    if (error) { alert("Error: " + error.message); return; }
    setTradeTypes(p => p.map(x => x.id === id ? data : x));
  };
  const deleteTradeType = async (id) => {
    if (!confirm("Delete this type? Existing trades keep their type tags (historical).")) return;
    await supabase.from("user_trade_types").delete().eq("id", id);
    setTradeTypes(p => p.filter(x => x.id !== id));
  };

  const saveTrade = async () => {
    if (!activeAccount) return;
    const pnl = parseFloat(form.pnl_pct) || 0;
    const payload = {
      account_id: activeAccount.id, user_id: user.id,
      date: form.date, day: getDay(form.date), session: form.session, pair: form.pair,
      risk: parseFloat(form.risk) || 0, direction: form.direction,
      entry: form.entry, exit: form.exit, rr: form.rr, max_r: form.max_r,
      max_adverse_r: form.max_adverse_r || "",
      pnl_pct: pnl, pnl_usd: (pnl / 100) * activeAccount.starting_balance,
      result: form.result,
      exec_link: form.exec_link, bias_link: form.bias_link,
      notes_trade: form.notes_trade || "", notes_market: form.notes_market || "", notes_mistakes: form.notes_mistakes || "",
      trade_types: form.trade_types || "",
    };
    if (editId) {
      let { data, error } = await supabase.from("trades").update(payload).eq("id", editId).select().single();
      // If column doesn't exist (user hasn't run new SQL), drop the new cols and retry
      if (error && /column .* does not exist/i.test(error.message || "")) {
        const fallback = { ...payload };
        delete fallback.notes_trade; delete fallback.notes_market; delete fallback.max_adverse_r;
        // Keep old field names so legacy schema still saves something
        fallback.notes_technical = form.notes_trade || "";
        fallback.notes_fundamental = "";
        const r2 = await supabase.from("trades").update(fallback).eq("id", editId).select().single();
        data = r2.data; error = r2.error;
      }
      if (error) { alert("Update failed: " + (error.message || JSON.stringify(error)) + "\n\nIf this mentions a column, you need to run the new SQL migration in Supabase first."); return; }
      if (!data) { alert("Update returned no data — the trade may have been deleted, or you don't have permission."); return; }
      setTrades(p => p.map(x => x.id === editId ? data : x));
    } else {
      let { data, error } = await supabase.from("trades").insert(payload).select().single();
      if (error && /column .* does not exist/i.test(error.message || "")) {
        const fallback = { ...payload };
        delete fallback.notes_trade; delete fallback.notes_market; delete fallback.max_adverse_r;
        fallback.notes_technical = form.notes_trade || "";
        fallback.notes_fundamental = "";
        const r2 = await supabase.from("trades").insert(fallback).select().single();
        data = r2.data; error = r2.error;
      }
      if (error) { alert("Save failed: " + (error.message || JSON.stringify(error)) + "\n\nIf this mentions a column, you need to run the new SQL migration in Supabase first."); return; }
      setTrades(p => [data, ...p]);
    }
    setForm(emptyTrade()); setShowForm(false); setEditId(null);
  };
  const editTrade = t => {
    setForm({
      ...t,
      risk: t.risk || 1,
      trade_types: t.trade_types || "",
      // Backward-compat: map old field names to new structure
      notes_trade: t.notes_trade || [t.notes_technical, t.notes_fundamental].filter(Boolean).join("\n\n") || "",
      notes_market: t.notes_market || "",
      notes_mistakes: t.notes_mistakes || "",
      max_adverse_r: t.max_adverse_r || "",
    });
    setEditId(t.id);
    setShowForm(true);
  };
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
      "PnL %": t.pnl_pct, "PnL $": t.pnl_usd, Result: t.result, Tags: t.tags,
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
        "PnL %": t.pnl_pct, "PnL $": t.pnl_usd, Result: t.result, Tags: t.tags,
        "Technical Notes": t.notes_technical, "Fundamental Notes": t.notes_fundamental, "Mistakes": t.notes_mistakes,
        "Exec Link": t.exec_link, "Bias Link": t.bias_link,
      }));
      const sheetName = acc.name.substring(0, 28).replace(/[\\/\[\]\*\?:]/g, "_");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: "No trades" }]), sheetName);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(accounts.map(a => ({ Name: a.name, "Starting Balance": a.starting_balance, Created: a.created_at }))), "Accounts");
    XLSX.writeFile(wb, `varmari_FULL_BACKUP_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // CHANGE #4: Self-contained HTML backup with embedded JSON for full restore
  const exportHTMLBackup = async () => {
    setExportingHTML(true);
    try {
      const [accRes, tradesRes, pairsRes, recapsRes] = await Promise.all([
        supabase.from("accounts").select("*").order("created_at", { ascending: true }),
        supabase.from("trades").select("*").order("date", { ascending: true }),
        supabase.from("user_pairs").select("*").order("sort_order", { ascending: true }),
        supabase.from("recaps").select("*").order("period_start", { ascending: false }),
      ]);
      const allAccounts = accRes.data || [];
      const allTrades = tradesRes.data || [];
      const allPairs = pairsRes.data || [];
      const allRecaps = recapsRes.data || [];

      const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const fmtPct = v => (v == null || v === "") ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
      const fmtUsd = v => (v == null || v === "") ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;

      const accountSections = allAccounts.map(acc => {
        const accTrades = allTrades.filter(t => t.account_id === acc.id);
        const accRecaps = allRecaps.filter(r => r.account_id === acc.id);
        const totalPnl = accTrades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
        const totalUsd = accTrades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
        const wins = accTrades.filter(t => t.result === "Win").length;
        const losses = accTrades.filter(t => t.result === "Loss").length;
        const wr = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

        const tradeRows = accTrades.map(t => `
          <tr>
            <td>${esc(t.date)}</td><td>${esc(t.day || '')}</td><td>${esc(t.session || '')}</td>
            <td><b>${esc(t.pair)}</b></td><td>${esc(t.direction)}</td><td>${esc(t.risk)}%</td>
            <td>${esc(t.entry)}</td><td>${esc(t.exit)}</td><td>${esc(t.rr || '—')}</td>
            <td>${esc(t.max_r || '—')}</td>
            <td class="pnl ${(t.pnl_pct || 0) >= 0 ? 'pos' : 'neg'}">${fmtPct(t.pnl_pct)}</td>
            <td class="pnl ${(t.pnl_usd || 0) >= 0 ? 'pos' : 'neg'}">${fmtUsd(t.pnl_usd)}</td>
            <td><span class="pill pill-${(t.result||'').toLowerCase()}">${esc(t.result)}</span></td>
            <td>${esc(t.tags || '')}</td>
            <td class="notes-cell">
              ${(t.notes_technical || '').trim() ? `<div class="note"><b>Tech:</b> ${esc(t.notes_technical)}</div>` : ''}
              ${(t.notes_fundamental || '').trim() ? `<div class="note"><b>Fund:</b> ${esc(t.notes_fundamental)}</div>` : ''}
              ${(t.notes_mistakes || '').trim() ? `<div class="note err"><b>Mistakes:</b> ${esc(t.notes_mistakes)}</div>` : ''}
            </td>
          </tr>`).join('');

        const recapBlocks = accRecaps.map(r => {
          const negParts = [r.didnt_work_text, r.pattern_text, r.change_text].filter(s => (s || '').trim()).map(esc).join('<br><br>');
          return `
          <div class="recap">
            <div class="recap-head">
              <span class="recap-period">${r.period_type === 'week' ? '📅 Week' : '🗓️ Month'} starting ${esc(r.period_start)}</span>
              <span class="recap-saved">Saved ${new Date(r.updated_at || r.created_at).toLocaleDateString()}</span>
            </div>
            <div class="recap-grid">
              ${r.worked_text ? `<div class="rsec rsec-pos"><div class="rsec-label">✓ Positives</div><div class="rsec-body">${esc(r.worked_text).replace(/\n/g, '<br>')}</div></div>` : ''}
              ${negParts ? `<div class="rsec rsec-mist"><div class="rsec-label">✕ Negatives</div><div class="rsec-body">${negParts.replace(/\n/g, '<br>')}</div></div>` : ''}
            </div>
          </div>`;
        }).join('');

        return `
          <section class="account">
            <div class="acc-head">
              <h2>${esc(acc.name)}</h2>
              <div class="acc-stats">
                <span>Start: <b>$${(acc.starting_balance || 0).toLocaleString()}</b></span>
                <span>Trades: <b>${accTrades.length}</b></span>
                <span>WR: <b>${wr.toFixed(0)}%</b></span>
                <span>PnL: <b class="${totalPnl >= 0 ? 'pos' : 'neg'}">${fmtPct(totalPnl)}</b></span>
                <span>PnL$: <b class="${totalUsd >= 0 ? 'pos' : 'neg'}">${fmtUsd(totalUsd)}</b></span>
                <span>Balance: <b>$${((acc.starting_balance || 0) + totalUsd).toFixed(2)}</b></span>
              </div>
            </div>
            ${accTrades.length === 0 ? '<p class="empty">No trades in this account.</p>' : `
              <h3>Trades (${accTrades.length})</h3>
              <div class="table-wrap">
                <table class="trades">
                  <thead><tr>
                    <th>Date</th><th>Day</th><th>Session</th><th>Pair</th><th>Dir</th><th>Risk</th>
                    <th>Entry</th><th>Exit</th><th>R:R</th><th>Max R</th><th>PnL %</th><th>PnL $</th>
                    <th>Result</th><th>Tags</th><th>Notes</th>
                  </tr></thead>
                  <tbody>${tradeRows}</tbody>
                </table>
              </div>`}
            ${accRecaps.length > 0 ? `<h3>Recaps (${accRecaps.length})</h3>${recapBlocks}` : ''}
          </section>`;
      }).join('');

      const sharedRecaps = allRecaps.filter(r => r.account_id == null);
      const sharedRecapBlocks = sharedRecaps.length === 0 ? '' : `
        <section class="account">
          <div class="acc-head"><h2>Cross-Account Recaps</h2></div>
          ${sharedRecaps.map(r => {
            const negParts = [r.didnt_work_text, r.pattern_text, r.change_text].filter(s => (s || '').trim()).map(esc).join('<br><br>');
            return `
            <div class="recap">
              <div class="recap-head">
                <span class="recap-period">${r.period_type === 'week' ? '📅 Week' : '🗓️ Month'} starting ${esc(r.period_start)}</span>
                <span class="recap-saved">Saved ${new Date(r.updated_at || r.created_at).toLocaleDateString()}</span>
              </div>
              <div class="recap-grid">
                ${r.worked_text ? `<div class="rsec rsec-pos"><div class="rsec-label">✓ Positives</div><div class="rsec-body">${esc(r.worked_text).replace(/\n/g, '<br>')}</div></div>` : ''}
                ${negParts ? `<div class="rsec rsec-mist"><div class="rsec-label">✕ Negatives</div><div class="rsec-body">${negParts.replace(/\n/g, '<br>')}</div></div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </section>`;

      const fullDataJSON = JSON.stringify({
        exported_at: new Date().toISOString(), version: 1,
        accounts: allAccounts, trades: allTrades, pairs: allPairs, recaps: allRecaps,
      }, null, 2);

      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Varmari Backup · ${new Date().toLocaleDateString()}</title>
<style>
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F5F0E8; color: #2C2418; margin: 0; padding: 24px; line-height: 1.5; }
.container { max-width: 1400px; margin: 0 auto; }
h1 { font-size: 28px; margin: 0 0 4px 0; } h2 { font-size: 20px; margin: 0; }
h3 { font-size: 14px; color: #6B5D4F; text-transform: uppercase; letter-spacing: 1px; margin: 20px 0 10px 0; }
.header { background: #2C2418; color: #fff; padding: 18px 24px; border-radius: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.header .meta { font-size: 12px; color: rgba(255,255,255,0.7); font-family: 'Courier New', monospace; }
.summary { background: #fff; border-radius: 12px; padding: 18px; margin-bottom: 20px; border: 1px solid #E8E0D4; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.summary-grid div { padding: 10px; background: #FAF8F4; border-radius: 8px; }
.summary-grid .label { font-size: 10px; color: #9C8E7E; text-transform: uppercase; letter-spacing: 1px; }
.summary-grid .value { font-size: 20px; font-weight: 700; color: #2C2418; font-family: 'Courier New', monospace; margin-top: 4px; }
.account { background: #fff; border: 1px solid #E8E0D4; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
.acc-head { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid #E8E0D4; }
.acc-stats { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: #6B5D4F; font-family: 'Courier New', monospace; }
.pos { color: #1A8754; } .neg { color: #C4342A; }
.table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid #E8E0D4; }
table.trades { width: 100%; border-collapse: collapse; font-size: 11px; font-family: 'Courier New', monospace; }
table.trades th { background: #FAF8F4; padding: 8px 6px; text-align: left; border-bottom: 1px solid #E8E0D4; font-size: 9px; text-transform: uppercase; color: #9C8E7E; letter-spacing: 0.5px; white-space: nowrap; }
table.trades td { padding: 7px 6px; border-bottom: 1px solid #F0EBE3; vertical-align: top; }
table.trades tr:nth-child(even) td { background: #FAF8F4; }
table.trades .pnl { font-weight: 600; }
.pill { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
.pill-win { background: #E8F5EE; color: #1A8754; } .pill-loss { background: #FDF0EF; color: #C4342A; } .pill-breakeven { background: #FAF8F4; color: #6B5D4F; }
.notes-cell { max-width: 280px; }
.notes-cell .note { font-size: 10px; padding: 4px 6px; background: #fff; margin: 2px 0; border-left: 2px solid #2563EB; border-radius: 3px; line-height: 1.4; word-break: break-word; }
.notes-cell .note.err { border-left-color: #C4342A; }
.recap { background: #FAF8F4; border: 1px solid #E8E0D4; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
.recap-head { display: flex; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid #E8E0D4; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.recap-period { font-weight: 600; font-size: 13px; }
.recap-saved { font-size: 10px; color: #9C8E7E; font-family: 'Courier New', monospace; }
.recap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
.rsec { background: #fff; border-radius: 8px; padding: 12px; border-top: 3px solid #ccc; }
.rsec-pos { border-top-color: #1A8754; } .rsec-tech { border-top-color: #2563EB; } .rsec-fund { border-top-color: #7C3AED; } .rsec-mist { border-top-color: #C4342A; }
.rsec-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.rsec-pos .rsec-label { color: #1A8754; } .rsec-tech .rsec-label { color: #2563EB; } .rsec-fund .rsec-label { color: #7C3AED; } .rsec-mist .rsec-label { color: #C4342A; }
.rsec-body { font-size: 12px; line-height: 1.5; color: #2C2418; }
.empty { color: #9C8E7E; font-style: italic; padding: 12px 0; }
.footer { text-align: center; padding: 30px 0 10px 0; color: #9C8E7E; font-size: 11px; font-family: 'Courier New', monospace; }
.restore-section { background: #fff; border: 2px dashed #C47A3B; border-radius: 12px; padding: 20px; margin: 20px 0; }
.restore-section h2 { color: #C47A3B; margin-bottom: 8px; font-size: 16px; }
.restore-section p { font-size: 13px; color: #6B5D4F; margin: 6px 0; }
.restore-section button { background: #C47A3B; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; margin-right: 8px; margin-top: 8px; font-size: 13px; }
.restore-section button:hover { background: #a86530; }
details { margin-top: 12px; } details summary { cursor: pointer; font-size: 12px; color: #6B5D4F; padding: 6px 0; }
details pre { background: #2C2418; color: #E8F5EE; padding: 14px; border-radius: 8px; font-size: 10px; overflow-x: auto; max-height: 400px; }
</style></head><body>
<div class="container">
  <div class="header">
    <div><h1>VARMARI · Full Backup</h1><div class="meta">Exported ${new Date().toLocaleString()} · User: ${esc(user.email || user.id)}</div></div>
    <div class="meta">${allAccounts.length} accounts · ${allTrades.length} trades · ${allRecaps.length} recaps</div>
  </div>
  <div class="restore-section">
    <h2>⚠️ How to restore from this backup</h2>
    <p><b>This file is a complete frozen snapshot of your trading data.</b> Open it in any browser to read everything.</p>
    <p>If your live website ever breaks, the embedded JSON below contains every record. Send this file to whoever rebuilds your app — they can reload all data into Supabase from it.</p>
    <button onclick="copyJSON()">📋 Copy Full Data as JSON</button>
    <button onclick="downloadJSON()">💾 Download JSON file</button>
    <details><summary>Show raw JSON data</summary><pre id="json-data">${esc(fullDataJSON)}</pre></details>
  </div>
  <div class="summary"><div class="summary-grid">
    <div><div class="label">Accounts</div><div class="value">${allAccounts.length}</div></div>
    <div><div class="label">Total Trades</div><div class="value">${allTrades.length}</div></div>
    <div><div class="label">Total Recaps</div><div class="value">${allRecaps.length}</div></div>
    <div><div class="label">Pairs Tracked</div><div class="value">${allPairs.length}</div></div>
  </div></div>
  ${accountSections}${sharedRecapBlocks}
  <div class="footer">VARMARI · Self-contained backup · Open this file anytime to view your trading history</div>
</div>
<script>
const FULL_DATA = ${fullDataJSON};
function copyJSON() {
  navigator.clipboard.writeText(JSON.stringify(FULL_DATA, null, 2)).then(() => {
    alert('JSON copied. ' + FULL_DATA.trades.length + ' trades, ' + FULL_DATA.recaps.length + ' recaps.');
  });
}
function downloadJSON() {
  const blob = new Blob([JSON.stringify(FULL_DATA, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'varmari_data_${new Date().toISOString().split('T')[0]}.json';
  a.click(); URL.revokeObjectURL(url);
}
</script></body></html>`;

      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `varmari_FULL_BACKUP_${new Date().toISOString().split("T")[0]}.html`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("HTML backup failed: " + err.message);
    } finally {
      setExportingHTML(false);
    }
  };

  // Risk running totals — separate lightweight memo so it's available even with 0 trades and on every tab
  const riskGauges = useMemo(() => {
    if (!activeAccount) return null;
    const todayISO = isoDate(new Date());
    const today = new Date();
    const sowISO = isoDate(startOfWeek(today));
    const eowISO = isoDate(endOfWeek(today));
    const somISO = isoDate(startOfMonth(today));
    const eomISO = isoDate(endOfMonth(today));
    const compute = (list) => {
      const pnl = list.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
      const usd = list.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
      return { pnl, usd, n: list.length };
    };
    const td = compute(trades.filter(t => t.date === todayISO));
    const wk = compute(trades.filter(t => t.date >= sowISO && t.date <= eowISO));
    const mo = compute(trades.filter(t => t.date >= somISO && t.date <= eomISO));
    return { td, wk, mo };
  }, [trades, activeAccount]);

  const S = useMemo(() => {
    if (!activeAccount || !trades.length) return null;
    // Apply dashboard period filter — fixed-period scope for the whole dashboard
    let _trades = trades;
    if (dashboardPeriod !== "all") {
      const now = new Date();
      let startISO, endISO;
      if (dashboardPeriod === "year") {
        startISO = `${now.getFullYear()}-01-01`;
        endISO = `${now.getFullYear()}-12-31`;
      } else if (dashboardPeriod === "month") {
        startISO = isoDate(startOfMonth(now));
        endISO = isoDate(endOfMonth(now));
      } else if (dashboardPeriod === "week") {
        startISO = isoDate(startOfWeek(now));
        endISO = isoDate(endOfWeek(now));
      }
      _trades = _trades.filter(t => t.date >= startISO && t.date <= endISO);
    }
    if (_trades.length === 0) return null;
    const base = activeAccount.starting_balance;
    const n = _trades.length;
    const w = _trades.filter(t => t.result === "Win"), l = _trades.filter(t => t.result === "Loss"), b = _trades.filter(t => t.result === "Breakeven");
    const wr = w.length / (w.length + l.length || 1) * 100;
    const tPnl = _trades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
    const tUsd = _trades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
    const avgW = w.length ? w.reduce((s, t) => s + parseFloat(t.pnl_pct || 0), 0) / w.length : 0;
    const avgL = l.length ? l.reduce((s, t) => s + parseFloat(t.pnl_pct || 0), 0) / l.length : 0;
    const pf = Math.abs(avgL) > 0 ? Math.abs(avgW / avgL) : 0;
    const best = Math.max(..._trades.map(t => parseFloat(t.pnl_pct) || 0));
    const worst = Math.min(..._trades.map(t => parseFloat(t.pnl_pct) || 0));
    let streak = 0, maxS = 0;
    [..._trades].sort((a, b) => a.date.localeCompare(b.date)).forEach(t => { if (t.result === "Win") { streak++; maxS = Math.max(maxS, streak); } else streak = 0; });
    const day = {}; DAYS_W.forEach(d => { day[d] = { n: 0, w: 0, l: 0, be: 0, pnl: 0 }; });
    _trades.forEach(t => { if (day[t.day]) { day[t.day].n++; if (t.result === "Win") day[t.day].w++; else if (t.result === "Loss") day[t.day].l++; else day[t.day].be++; day[t.day].pnl += parseFloat(t.pnl_pct) || 0; } });
    const sess = {}; SESSIONS.forEach(s => { sess[s] = { n: 0, w: 0, l: 0, pnl: 0 }; });
    _trades.forEach(t => { if (sess[t.session]) { sess[t.session].n++; if (t.result === "Win") sess[t.session].w++; else if (t.result === "Loss") sess[t.session].l++; sess[t.session].pnl += parseFloat(t.pnl_pct) || 0; } });
    const pair = {};
    pairNames.forEach(p => { if (!pair[p]) pair[p] = { n: 0, w: 0, l: 0, be: 0, pnl: 0, usd: 0 }; });
    _trades.forEach(t => {
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
    _trades.forEach(t => { if (dir[t.direction]) { dir[t.direction].n++; if (t.result === "Win") dir[t.direction].w++; else if (t.result === "Loss") dir[t.direction].l++; dir[t.direction].pnl += parseFloat(t.pnl_pct) || 0; } });
    const mo = {};
    _trades.forEach(t => { const m = t.date?.substring(0, 7); if (m) { if (!mo[m]) mo[m] = { n: 0, w: 0, l: 0, pnl: 0, usd: 0 }; mo[m].n++; if (t.result === "Win") mo[m].w++; else if (t.result === "Loss") mo[m].l++; mo[m].pnl += parseFloat(t.pnl_pct) || 0; mo[m].usd += parseFloat(t.pnl_usd) || 0; } });
    const sorted = [..._trades].sort((a, b) => a.date.localeCompare(b.date));
    let bal = base;
    const eq = [{ date: "Start", balance: base }];
    let peak = base, maxDD = 0, maxDDpct = 0, lastPeakDate = "Start";
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
    const rValues = _trades.map(realizedR).filter(v => v != null);
    const intendedRs = _trades.map(t => parseRR(t.rr)).filter(v => v != null);
    const avgIntendedR = intendedRs.length ? intendedRs.reduce((s,v) => s+v, 0) / intendedRs.length : null;
    const avgRealizedR = rValues.length ? rValues.reduce((s,v) => s+v, 0) / rValues.length : null;
    const mfeTrades = _trades.filter(t => t.result === "Win").map(t => {
      const mfe = parseRR(t.max_r);
      const realized = realizedR(t);
      if (mfe == null || realized == null) return null;
      return { id: t.id, date: t.date, pair: t.pair, direction: t.direction, result: t.result, mfe, realized, leftOnTable: Math.max(0, mfe - realized) };
    }).filter(x => x != null);
    let exitQuality = null;
    const totalWins = _trades.filter(t => t.result === "Win").length;
    if (mfeTrades.length > 0) {
      const totalMFE = mfeTrades.reduce((s, x) => s + x.mfe, 0);
      const totalRealized = mfeTrades.reduce((s, x) => s + x.realized, 0);
      const totalLeftOnTable = mfeTrades.reduce((s, x) => s + x.leftOnTable, 0);
      const avgMFE = totalMFE / mfeTrades.length;
      const avgRealized2 = totalRealized / mfeTrades.length;
      const captureRate = totalMFE > 0 ? (totalRealized / totalMFE) * 100 : null;
      const worstLeft = [...mfeTrades].sort((a, b) => b.leftOnTable - a.leftOnTable).slice(0, 5).filter(x => x.leftOnTable > 0.1);
      exitQuality = { n: mfeTrades.length, coverage: totalWins > 0 ? (mfeTrades.length / totalWins) * 100 : 0, avgMFE, avgRealized: avgRealized2, captureRate, totalLeftOnTable, worstLeft };
    }

    // TILT DETECTION — trade immediately after a loss
    const chrono = [..._trades].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.created_at || "").localeCompare(b.created_at || ""));
    const postLossTrades = [];
    for (let i = 1; i < chrono.length; i++) {
      if (chrono[i - 1].result === "Loss") postLossTrades.push(chrono[i]);
    }
    let tilt = null;
    if (postLossTrades.length >= 5) { // need at least 5 to mean anything
      const w = postLossTrades.filter(t => t.result === "Win").length;
      const l = postLossTrades.filter(t => t.result === "Loss").length;
      const wr = (w + l) > 0 ? (w / (w + l)) * 100 : null;
      const pnl = postLossTrades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
      const avgPnl = pnl / postLossTrades.length;
      // Baseline: overall WR for comparison
      const baselineWR = wr; // we'll compute the diff against full S.wr where it's rendered
      tilt = { n: postLossTrades.length, w, l, wr, pnl, avgPnl };
    }

    // PRESSED WINNERS — % of winners held to ≥80% of MFE
    let pressed = null;
    if (mfeTrades.length >= 5) {
      const pressedHard = mfeTrades.filter(x => x.mfe > 0 && (x.realized / x.mfe) >= 0.8).length;
      const pressedSoft = mfeTrades.filter(x => x.mfe > 0 && (x.realized / x.mfe) >= 0.5 && (x.realized / x.mfe) < 0.8).length;
      const cutEarly = mfeTrades.length - pressedHard - pressedSoft;
      const pressedPct = (pressedHard / mfeTrades.length) * 100;
      pressed = { n: mfeTrades.length, pressedHard, pressedSoft, cutEarly, pressedPct };
    }

    const yMin = Math.round(base * 0.88);
    const yMax = Math.round(base * 1.30);

    // Trade Type stats: per-type W/L/WR/PnL across all trades
    let typeStats = null;
    if (tradeTypes.length > 0) {
      const byType = {};
      tradeTypes.forEach(tt => { byType[tt.name] = { name: tt.name, n: 0, w: 0, l: 0, pnl: 0, usd: 0 }; });
      let untaggedN = 0, untaggedW = 0, untaggedL = 0, untaggedPnl = 0, untaggedUsd = 0;
      _trades.forEach(t => {
        const types = (t.trade_types || "").split(",").map(s => s.trim()).filter(Boolean);
        if (types.length === 0) {
          untaggedN++;
          if (t.result === "Win") untaggedW++;
          else if (t.result === "Loss") untaggedL++;
          untaggedPnl += parseFloat(t.pnl_pct) || 0;
          untaggedUsd += parseFloat(t.pnl_usd) || 0;
          return;
        }
        types.forEach(name => {
          if (!byType[name]) byType[name] = { name, n: 0, w: 0, l: 0, pnl: 0, usd: 0 };
          byType[name].n++;
          if (t.result === "Win") byType[name].w++;
          else if (t.result === "Loss") byType[name].l++;
          byType[name].pnl += parseFloat(t.pnl_pct) || 0;
          byType[name].usd += parseFloat(t.pnl_usd) || 0;
        });
      });
      const list = Object.values(byType).map(x => ({
        ...x,
        wr: (x.w + x.l) > 0 ? (x.w / (x.w + x.l)) * 100 : null,
        avgPnl: x.n > 0 ? x.pnl / x.n : 0,
      })).filter(x => x.n > 0).sort((a, b) => b.pnl - a.pnl);
      typeStats = {
        list,
        untagged: untaggedN > 0 ? {
          name: "Untagged", n: untaggedN, w: untaggedW, l: untaggedL,
          wr: (untaggedW + untaggedL) > 0 ? (untaggedW / (untaggedW + untaggedL)) * 100 : null,
          pnl: untaggedPnl, usd: untaggedUsd, avgPnl: untaggedN > 0 ? untaggedPnl / untaggedN : 0,
        } : null,
      };
    }

    // ADVERSE R STATS — measure on wins (how lucky) and losses (how wrong)
    let adverseStats = null;
    const winsWithAdverse = _trades.filter(t => t.result === "Win" && t.max_adverse_r != null && String(t.max_adverse_r).trim() !== "");
    const lossesWithAdverse = _trades.filter(t => t.result === "Loss" && t.max_adverse_r != null && String(t.max_adverse_r).trim() !== "");
    if (winsWithAdverse.length > 0 || lossesWithAdverse.length > 0) {
      const winAdvR = winsWithAdverse.map(t => parseFloat(t.max_adverse_r) || 0);
      const lossAdvR = lossesWithAdverse.map(t => parseFloat(t.max_adverse_r) || 0);
      const avgWinAdverse = winAdvR.length > 0 ? winAdvR.reduce((s, v) => s + v, 0) / winAdvR.length : null;
      const avgLossAdverse = lossAdvR.length > 0 ? lossAdvR.reduce((s, v) => s + v, 0) / lossAdvR.length : null;
      const maxWinAdverse = winAdvR.length > 0 ? Math.max(...winAdvR) : null;
      const maxLossAdverse = lossAdvR.length > 0 ? Math.max(...lossAdvR) : null;
      // "Lucky" wins: where adverse R was > 0.5 (over half their stop got hit before reversing)
      const luckyWins = winsWithAdverse.filter(t => (parseFloat(t.max_adverse_r) || 0) > 0.5).length;
      // "Bias completely wrong" losses: trade went > 1.5R past their stop
      const veryWrongLosses = lossesWithAdverse.filter(t => (parseFloat(t.max_adverse_r) || 0) > 1.5).length;
      // Clean stops: loss with adverse ≈ 1.0 (between 0.9 and 1.2)
      const cleanStops = lossesWithAdverse.filter(t => { const v = parseFloat(t.max_adverse_r) || 0; return v >= 0.9 && v <= 1.2; }).length;
      adverseStats = {
        winsN: winsWithAdverse.length, lossesN: lossesWithAdverse.length,
        avgWinAdverse, avgLossAdverse, maxWinAdverse, maxLossAdverse,
        luckyWins, veryWrongLosses, cleanStops,
        totalWins: w.length, totalLosses: l.length,
      };
    }

    return { n, w: w.length, l: l.length, be: b.length, wr, tPnl, tUsd, avgW, avgL, pf, best, worst, maxS, day, sess, pair, dir, mo, eq, yMin, yMax, base, maxDD, maxDDpct, currentDD, currentDDpct, daysSincePeak, peak, avgIntendedR, avgRealizedR, exitQuality, typeStats, tilt, pressed, adverseStats };
  }, [trades, activeAccount, pairNames, tradeTypes, dashboardPeriod]);

  const filtered = useMemo(() => {
    let list = [...trades];
    if (fPair !== "All") list = list.filter(t => t.pair === fPair);
    if (fResult !== "All") list = list.filter(t => t.result === fResult);
    if (fDay !== "All") list = list.filter(t => t.day === fDay);
    if (fSess !== "All") list = list.filter(t => t.session === fSess);
    if (fDir !== "All") list = list.filter(t => t.direction === fDir);
    if (fTag !== "All") list = list.filter(t => (t.tags || "").split(",").map(s => s.trim().toLowerCase()).includes(fTag));
    if (search) { const s = search.toLowerCase(); list = list.filter(t => [t.pair, t.session, t.direction, t.notes_technical, t.notes_fundamental, t.notes_mistakes, t.date, t.day, t.tags].some(f => (f || "").toLowerCase().includes(s))); }
    list.sort((a, b) => { let va = a[sortCol], vb = b[sortCol]; if (sortCol === "pnl_pct" || sortCol === "risk") { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; } if (va < vb) return sortDir === "asc" ? -1 : 1; if (va > vb) return sortDir === "asc" ? 1 : -1; return 0; });
    return list;
  }, [trades, fPair, fResult, fDay, fSess, fDir, fTag, search, sortCol, sortDir]);

  const clearFilters = () => { setFPair("All"); setFResult("All"); setFDay("All"); setFSess("All"); setFDir("All"); setFTag("All"); setSearch(""); };
  const hasActiveFilters = fPair !== "All" || fResult !== "All" || fDay !== "All" || fSess !== "All" || fDir !== "All" || fTag !== "All" || search !== "";
  const toggleSort = col => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("desc"); } };

  const tabs = [
    { k: "dashboard", l: "Dashboard", i: "◈" },
    { k: "log", l: "Trade Log", i: "☰" },
    { k: "recap", l: "Daily", i: "📋" },
    { k: "discipline", l: "Discipline", i: "✓" },
  ];
  const navStyle = (active) => ({
    background: "none", border: "none", color: active ? T.text : T.textLight,
    padding: "16px 4px", fontSize: 13, fontWeight: active ? 600 : 500, cursor: "pointer",
    fontFamily: font, letterSpacing: 0.3, borderBottom: active ? `2px solid ${T.accent}` : "2px solid transparent",
    marginRight: 22,
  });

  if (loading) return <div style={{ minHeight: "100vh", background: T.bg, ...center, color: T.textMid, fontFamily: mono }}>Loading...</div>;

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: font, color: T.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ background: T.headerBg, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, borderBottom: `0.5px solid ${T.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 0" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: T.text, letterSpacing: 1.5 }}>VARMARI</span>
          </div>
          <div style={{ display: "flex" }}>
            <button onClick={() => setPage("journal")} style={navStyle(page === "journal")}>Trading Journal</button>
            <button onClick={() => setPage("calculator")} style={navStyle(page === "calculator")}>Position Calculator</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 0", flexWrap: "wrap" }}>
          {page === "journal" && activeAccount && (
            <>
              <button onClick={() => setShowSearchModal(true)} title="Search trades, plans, recaps (⌘K)" style={{ background: T.card, border: `0.5px solid ${T.border}`, color: T.textMid, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontFamily: font, cursor: "pointer" }}>⌕ Search</button>
              <button onClick={() => setShowPairsModal(true)} title="Manage Pairs" style={{ background: T.card, border: `0.5px solid ${T.border}`, color: T.textMid, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontFamily: font, cursor: "pointer" }}>⟡ Pairs ({pairs.length})</button>
              <button onClick={() => setShowTradeTypesModal(true)} title="Manage Trade Types" style={{ background: T.card, border: `0.5px solid ${T.border}`, color: T.textMid, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontFamily: font, cursor: "pointer" }}>⊞ Types ({tradeTypes.length})</button>
              <button onClick={() => setShowAccountModal(true)} style={{ background: T.card, border: `0.5px solid ${T.border}`, color: T.textMid, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontFamily: font, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.green, display: "inline-block" }}></span>
                <span style={{ color: T.text, fontWeight: 500 }}>{activeAccount.name}</span>
                <span style={{ color: T.textLight }}>▼</span>
              </button>
            </>
          )}
          <button onClick={onLogout} style={{ background: "transparent", border: `0.5px solid ${T.border}`, color: T.textMid, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontFamily: font, cursor: "pointer" }}>Sign Out</button>
        </div>
      </div>

      {showAccountModal && <AccountModal accounts={accounts} activeId={activeAccount?.id} onClose={() => activeAccount && setShowAccountModal(false)} onCreate={createAccount} onDelete={deleteAccount} onSelect={selectAccount} />}
      {showPairsModal && <PairsModal pairs={pairs} onClose={() => setShowPairsModal(false)} onAdd={addPair} onUpdate={updatePair} onDelete={deletePair} onResetDefaults={resetPairsToDefaults} />}
      {showTradeTypesModal && <TradeTypesModal types={tradeTypes} onClose={() => setShowTradeTypesModal(false)} onAdd={addTradeType} onUpdate={updateTradeType} onDelete={deleteTradeType} />}
      {replayTrade && <TradeReplayModal trade={replayTrade} user={user} activeAccount={activeAccount} allTrades={trades} onClose={() => setReplayTrade(null)} onEdit={(t) => { setReplayTrade(null); editTrade(t); setTab("log"); }} />}
      {showSearchModal && <GlobalSearchModal
        user={user}
        activeAccount={activeAccount}
        onClose={() => setShowSearchModal(false)}
        onOpenTrade={(t) => setReplayTrade(t)}
        onOpenDay={(dateISO) => { setTab("recap"); setDailySubTab("daily"); }}
        onOpenRecap={(r) => { setTab("recap"); setDailySubTab(r.period_type === "monthly" ? "monthly" : "weekly"); }}
      />}
      {dayModal && (
        <div onClick={() => setDayModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", ...center, zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...cardS, width: "100%", maxWidth: 900, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {dayModal.dateISO.startsWith("Week ")
                    ? dayModal.dateISO
                    : parseLocalDate(dayModal.dateISO).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </div>
                <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono, marginTop: 2 }}>
                  {dayModal.trades.length} {dayModal.trades.length === 1 ? "trade" : "trades"} ·
                  {" "}<span style={{ color: T.green }}>{dayModal.trades.filter(t => t.result === "Win").length}W</span> ·
                  {" "}<span style={{ color: T.red }}>{dayModal.trades.filter(t => t.result === "Loss").length}L</span> ·
                  {" "}<span style={{ color: cP(dayModal.trades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0)), fontWeight: 700 }}>{fU(dayModal.trades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0))}</span> ·
                  {" "}<span style={{ color: cP(dayModal.trades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0)) }}>{fP(dayModal.trades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0))}</span>
                </div>
              </div>
              <button onClick={() => setDayModal(null)} style={btnG}>✕ Close</button>
            </div>
            {/* Trade list */}
            <div style={{ overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {dayModal.trades.map(t => (
                <div key={t.id} style={{ background: T.cardAlt, border: `1px solid ${T.borderLight}`, borderRadius: 10, padding: 14 }}>
                  {/* Top row: pair, dir, result, PnL, rating */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Pill text={t.pair} type="pair" />
                      <Pill text={t.direction} />
                      <Pill text={t.result} />
                      <span style={{ fontSize: 10, color: T.textMid, fontFamily: mono }}>{t.session}</span>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: cP(t.pnl_pct) }}>{fP(t.pnl_pct)}</span>
                      <span style={{ fontSize: 12, fontFamily: mono, color: cP(t.pnl_usd) }}>{fU(t.pnl_usd)}</span>
                      <button onClick={() => { setDayModal(null); setReplayTrade(t); }} style={{ ...btnG, fontSize: 10, padding: "4px 10px", color: T.purple, borderColor: T.purple + "60" }}>▶ Replay</button>
                      <button onClick={() => { setDayModal(null); editTrade(t); setTab("log"); }} style={{ ...btnG, fontSize: 10, padding: "4px 10px", color: T.amber, borderColor: T.amber + "60" }}>✎ Edit</button>
                    </div>
                  </div>
                  {/* Trade details */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, fontSize: 11, fontFamily: mono, color: T.textMid, marginBottom: (t.notes_technical || t.notes_fundamental || t.notes_mistakes) ? 10 : 0 }}>
                    <div><span style={{ color: T.textLight }}>Risk:</span> {t.risk}%</div>
                    <div><span style={{ color: T.textLight }}>Entry:</span> {t.entry || "—"}</div>
                    <div><span style={{ color: T.textLight }}>Exit:</span> {t.exit || "—"}</div>
                    <div><span style={{ color: T.textLight }}>R:R:</span> {t.rr || "—"}</div>
                    {t.result === "Win" && <div><span style={{ color: T.textLight }}>Max R:</span> {t.max_r || "—"}</div>}
                  </div>
                  {/* Trade Types */}
                  {(t.trade_types || "").trim() && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                      {(t.trade_types || "").split(",").map(s => s.trim()).filter(s => s).map(tt => (
                        <span key={tt} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: T.purpleBg, color: T.purple, fontWeight: 600 }}>{tt}</span>
                      ))}
                    </div>
                  )}
                  {/* Max R Reversed — losses only */}
                  {t.result === "Loss" && String(t.max_adverse_r || "").trim() && (
                    <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono, marginTop: 8 }}>
                      <span style={{ color: T.textLight }}>Max R Reversed: </span>
                      <span style={{ color: T.red, fontWeight: 700 }}>−{t.max_adverse_r}R</span>
                      <span style={{ color: T.textLight, marginLeft: 6, fontStyle: "italic" }}>past my stop</span>
                    </div>
                  )}
                  {/* Notes — new structure with old-field fallback */}
                  {(() => {
                    const tradeNotes = (t.notes_trade || "").trim() || [t.notes_technical, t.notes_fundamental].filter(Boolean).join("\n\n").trim();
                    const market = (t.notes_market || "").trim();
                    const mistakes = (t.notes_mistakes || "").trim();
                    return <>
                      {tradeNotes && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontSize: 9, color: T.accent, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, fontWeight: 700, marginBottom: 3 }}>Trade Notes</div>
                          <div style={{ fontSize: 12, color: T.text, whiteSpace: "pre-wrap", lineHeight: 1.5, padding: "8px 10px", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>{tradeNotes}</div>
                        </div>
                      )}
                      {market && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontSize: 9, color: T.blue, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, fontWeight: 700, marginBottom: 3 }}>What Happened to the Market</div>
                          <div style={{ fontSize: 12, color: T.text, whiteSpace: "pre-wrap", lineHeight: 1.5, padding: "8px 10px", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>{market}</div>
                        </div>
                      )}
                      {mistakes && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontSize: 9, color: T.red, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, fontWeight: 700, marginBottom: 3 }}>Mistakes</div>
                          <div style={{ fontSize: 12, color: T.text, whiteSpace: "pre-wrap", lineHeight: 1.5, padding: "8px 10px", background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>{mistakes}</div>
                        </div>
                      )}
                    </>;
                  })()}
                  {/* Links */}
                  {(t.exec_link || t.bias_link) && (
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      {t.exec_link && <a href={t.exec_link} target="_blank" rel="noreferrer" style={{ color: T.blue, fontSize: 11, fontWeight: 600, fontFamily: mono, textDecoration: "none" }}>↗ Chart</a>}
                      {t.bias_link && <a href={t.bias_link} target="_blank" rel="noreferrer" style={{ color: T.purple, fontSize: 11, fontWeight: 600, fontFamily: mono, textDecoration: "none" }}>↗ Bias</a>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {page === "calculator" && <PositionCalc />}

      {page === "journal" && !activeAccount && !showAccountModal && (
        <div style={{ ...cardS, padding: 40, margin: 28, textAlign: "center" }}>
          <div style={{ fontSize: 14, marginBottom: 12 }}>No account selected</div>
          <button onClick={() => setShowAccountModal(true)} style={btnP}>Create or Select Account</button>
        </div>
      )}

      {page === "journal" && activeAccount && (
        <>
          <div style={{ display: "flex", gap: 8, padding: "12px 20px", alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, background: T.card }}>
            <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
              {tabs.map(t => (
                <button key={t.k} onClick={() => setTab(t.k)} style={{ background: "none", border: "none", color: tab === t.k ? T.accent : T.textLight, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font, borderBottom: tab === t.k ? `2px solid ${T.accent}` : "2px solid transparent" }}><span style={{ fontSize: 13, marginRight: 4 }}>{t.i}</span>{t.l}</button>
              ))}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => { setForm(emptyTrade()); setEditId(null); setShowForm(true); setTab("log"); }} style={{ ...btnP, fontSize: 11, padding: "6px 14px" }}>+ New Trade</button>
              <button onClick={exportExcel} style={{ ...btnG, fontSize: 10, padding: "5px 10px" }}>Export Excel</button>
              <button onClick={exportAllBackup} style={{ ...btnG, fontSize: 10, padding: "5px 10px", color: T.accent, borderColor: T.accent + "60" }}>⬇ Excel Backup</button>
              <button onClick={exportHTMLBackup} disabled={exportingHTML} style={{ ...btnG, fontSize: 10, padding: "5px 10px", color: T.green, borderColor: T.green + "60", opacity: exportingHTML ? 0.6 : 1 }}>{exportingHTML ? "Building..." : "⬇ HTML Backup"}</button>
            </div>
          </div>

          <div style={{ padding: "20px", maxWidth: 1280, margin: "0 auto" }}>

            {tab === "dashboard" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* PERIOD FILTER — visible whenever there's at least 1 trade in the account */}
                {trades.length > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
                    <div style={{ display: "flex", gap: 4, background: T.cardAlt, border: `0.5px solid ${T.border}`, borderRadius: 8, padding: 3 }}>
                      {[
                        { k: "all", l: "All time" },
                        { k: "year", l: "Year" },
                        { k: "month", l: "Month" },
                        { k: "week", l: "Week" },
                      ].map(p => {
                        const active = dashboardPeriod === p.k;
                        return (
                          <button key={p.k} onClick={() => setDashboardPeriod(p.k)} style={{
                            padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                            fontSize: 11, fontWeight: active ? 700 : 500, fontFamily: font,
                            background: active ? T.card : "transparent",
                            color: active ? T.accent : T.textMid,
                            boxShadow: active ? `0 1px 3px rgba(0,0,0,0.06)` : "none",
                          }}>{p.l}</button>
                        );
                      })}
                    </div>
                    {dashboardPeriod !== "all" && (
                      <span style={{ fontSize: 11, color: T.textLight, fontStyle: "italic", fontFamily: mono }}>
                        Stats below filtered to: {dashboardPeriod === "year" ? new Date().getFullYear() : dashboardPeriod === "month" ? new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "current week"}
                      </span>
                    )}
                  </div>
                )}

                {!S ? (
                  <div style={{ ...cardS, padding: 60, textAlign: "center" }}>
                    <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>◈</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
                      {trades.length === 0 ? `No trades yet in ${activeAccount.name}` : `No trades in selected ${dashboardPeriod}`}
                    </div>
                    <div style={{ color: T.textMid, fontSize: 13, marginBottom: 20 }}>
                      {trades.length === 0 ? `Starting Balance: $${activeAccount.starting_balance.toLocaleString()}` : `Switch to "All time" to see all ${trades.length} trades.`}
                    </div>
                    {trades.length === 0 ? (
                      <button onClick={() => { setForm(emptyTrade()); setEditId(null); setShowForm(true); setTab("log"); }} style={btnP}>+ New Trade</button>
                    ) : (
                      <button onClick={() => setDashboardPeriod("all")} style={btnP}>Show all trades</button>
                    )}
                  </div>
                ) : (<>
                  {/* HERO STRIP: Today / This Week / This Month */}
                  {(() => {
                    const todayISO = isoDate(new Date());
                    const today = new Date();
                    const sow = startOfWeek(today);
                    const eow = endOfWeek(today);
                    const som = startOfMonth(today);
                    const eom = endOfMonth(today);
                    const sowISO = isoDate(sow);
                    const eowISO = isoDate(eow);
                    const somISO = isoDate(som);
                    const eomISO = isoDate(eom);

                    const todayTrades = trades.filter(t => t.date === todayISO);
                    const weekTrades = trades.filter(t => t.date >= sowISO && t.date <= eowISO);
                    const monthTrades = trades.filter(t => t.date >= somISO && t.date <= eomISO);

                    const sumStats = (list) => {
                      const w = list.filter(t => t.result === "Win").length;
                      const l = list.filter(t => t.result === "Loss").length;
                      const pnlPct = list.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
                      const pnlUsd = list.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
                      const wr = (w + l) > 0 ? (w / (w + l)) * 100 : null;
                      const tradingDays = new Set(list.map(t => t.date)).size;
                      return { n: list.length, w, l, pnlPct, pnlUsd, wr, tradingDays };
                    };
                    const td = sumStats(todayTrades);
                    const wk = sumStats(weekTrades);
                    const mo = sumStats(monthTrades);

                    const todayDate = today.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                    const todayPositive = td.pnlUsd >= 0;
                    const heroBg = td.n === 0 ? T.cardAlt : todayPositive ? T.greenBg : T.redBg;
                    const heroBorder = td.n === 0 ? T.border : todayPositive ? "#A4D9B8" : "#F0B5AE";
                    const heroAccent = td.n === 0 ? T.textMid : todayPositive ? T.green : T.red;
                    const heroAccentDark = td.n === 0 ? T.text : todayPositive ? "#1F7A48" : "#A02A1F";

                    const heroFmt = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
                    const heroFmtSmall = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(0)}`;

                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                        {/* TODAY — hero card with color */}
                        <div style={{ background: heroBg, border: `0.5px solid ${heroBorder}`, borderRadius: 14, padding: "18px 20px", flex: "1.6" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <div style={{ fontSize: 11, color: heroAccent, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>Today</div>
                            <div style={{ fontSize: 11, color: T.textMid }}>{todayDate}</div>
                          </div>
                          <div style={{ fontSize: 36, color: heroAccentDark, fontWeight: 600, letterSpacing: -1.2, lineHeight: 1 }}>
                            {td.n === 0 ? "$0.00" : heroFmt(td.pnlUsd)}
                          </div>
                          <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                            {td.n === 0 ? (
                              <span style={{ color: T.textMid, fontStyle: "italic" }}>No trades yet — plan first, trade later</span>
                            ) : (
                              <>
                                <span style={{ color: heroAccent }}>{fP(td.pnlPct)}</span>
                                <span style={{ color: T.textMid }}>·</span>
                                <span style={{ color: T.textMid }}>{td.n} {td.n === 1 ? "trade" : "trades"}</span>
                                {td.wr != null && (<>
                                  <span style={{ color: T.textMid }}>·</span>
                                  <span style={{ color: T.textMid }}>{td.wr.toFixed(0)}% win</span>
                                </>)}
                              </>
                            )}
                          </div>
                        </div>

                        {/* THIS WEEK */}
                        <div style={{ background: T.card, border: `0.5px solid ${T.border}`, borderRadius: 14, padding: "18px 20px" }}>
                          <div style={{ fontSize: 11, color: T.textLight, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10, fontWeight: 500 }}>This week</div>
                          <div style={{ fontSize: 26, color: wk.n === 0 ? T.textMid : (wk.pnlUsd >= 0 ? T.green : T.red), fontWeight: 600, letterSpacing: -0.8, lineHeight: 1 }}>
                            {wk.n === 0 ? "$0" : heroFmtSmall(wk.pnlUsd)}
                          </div>
                          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                            <span style={{ color: T.textMid }}>{wk.tradingDays} {wk.tradingDays === 1 ? "day" : "days"}</span>
                            <span style={{ color: T.textMid }}>·</span>
                            <span style={{ color: T.textMid }}>{wk.n} {wk.n === 1 ? "trade" : "trades"}</span>
                          </div>
                        </div>

                        {/* THIS MONTH */}
                        <div style={{ background: T.card, border: `0.5px solid ${T.border}`, borderRadius: 14, padding: "18px 20px" }}>
                          <div style={{ fontSize: 11, color: T.textLight, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10, fontWeight: 500 }}>This month</div>
                          <div style={{ fontSize: 26, color: mo.n === 0 ? T.textMid : (mo.pnlUsd >= 0 ? T.green : T.red), fontWeight: 600, letterSpacing: -0.8, lineHeight: 1 }}>
                            {mo.n === 0 ? "$0" : heroFmtSmall(mo.pnlUsd)}
                          </div>
                          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                            <span style={{ color: mo.pnlPct >= 0 ? T.green : T.red }}>{fP(mo.pnlPct)}</span>
                            {mo.wr != null && (<>
                              <span style={{ color: T.textMid }}>·</span>
                              <span style={{ color: mo.wr >= 50 ? T.green : T.red }}>{mo.wr.toFixed(0)}% WR</span>
                            </>)}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* DISCIPLINE STRIP: Streak / Avg RR / Drawdown · with More Stats expander */}
                  {(() => {
                    const currentStreak = S.maxS;
                    const avgRR = S.avgRealizedR;
                    const rrColor = avgRR == null ? T.textMid : avgRR >= 1.5 ? T.green : avgRR >= 1 ? T.amber : T.red;
                    return (
                      <div style={{ background: T.card, border: `0.5px solid ${T.border}`, borderRadius: 14, padding: "14px 20px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                          <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                              <span style={{ fontSize: 11, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, fontWeight: 500 }}>Best streak</span>
                              <span style={{ fontSize: 20, color: T.green, fontWeight: 600 }}>{currentStreak}</span>
                              <span style={{ fontSize: 11, color: T.textMid }}>wins</span>
                            </div>
                            <div style={{ width: 1, height: 22, background: T.border }}></div>
                            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                              <span style={{ fontSize: 11, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, fontWeight: 500 }}>Avg RR</span>
                              <span style={{ fontSize: 20, color: rrColor, fontWeight: 600 }}>{avgRR == null ? "—" : `${avgRR >= 0 ? "+" : ""}${avgRR.toFixed(2)}R`}</span>
                              <span style={{ fontSize: 11, color: T.textMid }}>realized</span>
                            </div>
                            <div style={{ width: 1, height: 22, background: T.border }}></div>
                            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                              <span style={{ fontSize: 11, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, fontWeight: 500 }}>Drawdown</span>
                              <span style={{ fontSize: 20, color: S.maxDDpct >= 5 ? T.red : T.text, fontWeight: 600 }}>{S.maxDD > 0 ? `-${S.maxDDpct.toFixed(1)}%` : "—"}</span>
                              <span style={{ fontSize: 11, color: T.textMid }}>max</span>
                            </div>
                          </div>
                          <button onClick={() => setMoreStatsOpen(o => !o)} style={{ background: T.purpleBg, border: `0.5px solid ${T.purple}40`, color: T.purple, padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
                            {moreStatsOpen ? "Hide stats" : "More stats"}
                            <span style={{ display: "inline-block", transform: moreStatsOpen ? "rotate(180deg)" : "none", transition: "transform 150ms" }}>↓</span>
                          </button>
                        </div>

                        {/* COLLAPSIBLE MORE STATS */}
                        {moreStatsOpen && (
                          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `0.5px solid ${T.border}`, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
                            <div>
                              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>All-time WR</div>
                              <div style={{ fontSize: 18, color: S.wr >= 50 ? T.green : T.red, fontWeight: 600 }}>{S.wr.toFixed(1)}%</div>
                              <div style={{ fontSize: 10, color: T.textMid, marginTop: 2 }}>{S.w}W · {S.l}L · {S.be}BE</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Profit factor</div>
                              <div style={{ fontSize: 18, color: S.pf >= 1.5 ? T.green : S.pf >= 1 ? T.amber : T.red, fontWeight: 600 }}>{S.pf.toFixed(2)}</div>
                              <div style={{ fontSize: 10, color: T.textMid, marginTop: 2 }}>{S.pf >= 1.5 ? "healthy" : S.pf >= 1 ? "marginal" : "losing"}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Avg win</div>
                              <div style={{ fontSize: 18, color: T.green, fontWeight: 600 }}>{fP(S.avgW)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Avg loss</div>
                              <div style={{ fontSize: 18, color: T.red, fontWeight: 600 }}>{fP(S.avgL)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Best trade</div>
                              <div style={{ fontSize: 18, color: T.green, fontWeight: 600 }}>{fP(S.best)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Worst trade</div>
                              <div style={{ fontSize: 18, color: T.red, fontWeight: 600 }}>{fP(S.worst)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Balance</div>
                              <div style={{ fontSize: 18, color: T.accent, fontWeight: 600 }}>${(S.base + S.tUsd).toFixed(0)}</div>
                              <div style={{ fontSize: 10, color: T.textMid, marginTop: 2 }}>start ${S.base.toFixed(0)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: T.textLight, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Avg RR (real)</div>
                              <div style={{ fontSize: 18, color: T.text, fontWeight: 600 }}>{S.avgRealizedR != null ? `${S.avgRealizedR >= 0 ? "+" : ""}${S.avgRealizedR.toFixed(2)}R` : "—"}</div>
                              <div style={{ fontSize: 10, color: T.textMid, marginTop: 2 }}>intended {S.avgIntendedR != null ? `1:${S.avgIntendedR.toFixed(2)}` : "—"}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* EQUITY CURVE — slim sparkline showing cumulative balance over time */}
                  {S.eq && S.eq.length > 1 && (
                    <div style={{ ...cardS, padding: "16px 20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>Equity Curve</span>
                          <span style={{ fontSize: 11, color: T.textMid, fontFamily: mono }}>{S.eq.length - 1} {S.eq.length - 1 === 1 ? "trade" : "trades"}</span>
                        </div>
                        <div style={{ display: "flex", gap: 14, fontSize: 11, fontFamily: mono, alignItems: "baseline" }}>
                          <div>
                            <span style={{ color: T.textLight }}>Start </span>
                            <span style={{ color: T.text, fontWeight: 600 }}>${S.base.toFixed(0)}</span>
                          </div>
                          <div>
                            <span style={{ color: T.textLight }}>Now </span>
                            <span style={{ color: S.tUsd >= 0 ? T.green : T.red, fontWeight: 700 }}>${(S.base + S.tUsd).toFixed(0)}</span>
                          </div>
                          <div>
                            <span style={{ color: T.textLight }}>P&L </span>
                            <span style={{ color: S.tUsd >= 0 ? T.green : T.red, fontWeight: 700 }}>{S.tUsd >= 0 ? "+" : "−"}${Math.abs(S.tUsd).toFixed(0)}</span>
                            <span style={{ color: S.tPnl >= 0 ? T.green : T.red, marginLeft: 4 }}>({S.tPnl >= 0 ? "+" : ""}{S.tPnl.toFixed(2)}%)</span>
                          </div>
                          {S.peak > 0 && (
                            <div>
                              <span style={{ color: T.textLight }}>Peak </span>
                              <span style={{ color: T.text, fontWeight: 600 }}>${(S.base + S.peak).toFixed(0)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={130}>
                        <AreaChart data={S.eq} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={S.tUsd >= 0 ? T.green : T.red} stopOpacity={0.25}/>
                              <stop offset="100%" stopColor={S.tUsd >= 0 ? T.green : T.red} stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" hide />
                          <YAxis domain={[S.yMin, S.yMax]} hide />
                          <Tooltip
                            contentStyle={{ background: T.card, border: `0.5px solid ${T.border}`, borderRadius: 6, fontSize: 11, padding: "6px 10px", fontFamily: mono }}
                            labelStyle={{ color: T.textMid, fontSize: 10 }}
                            formatter={(val) => [`$${val.toFixed(0)}`, "Balance"]}
                          />
                          <ReferenceLine y={S.base} stroke={T.border} strokeDasharray="3 3" strokeWidth={1} />
                          <Area type="monotone" dataKey="balance" stroke={S.tUsd >= 0 ? T.green : T.red} strokeWidth={1.8} fill="url(#eqGrad)" dot={false} activeDot={{ r: 3, fill: S.tUsd >= 0 ? T.green : T.red }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* CALENDAR VIEW — replaces Equity Curve, Performance by Rating, Exit Quality */}
                  {(() => {
                    const year = calMonth.getFullYear();
                    const monthIdx = calMonth.getMonth();
                    const monthLabel = calMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
                    const firstOfMonth = new Date(year, monthIdx, 1);
                    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
                    const startWeekday = firstOfMonth.getDay(); // 0=Sun

                    // Group this month's trades by day
                    const byDay = {};
                    trades.forEach(t => {
                      if (!t.date) return;
                      const d = parseLocalDate(t.date);
                      if (d.getFullYear() === year && d.getMonth() === monthIdx) {
                        const day = d.getDate();
                        if (!byDay[day]) byDay[day] = [];
                        byDay[day].push(t);
                      }
                    });

                    // Build a flat array of cells, Sun→Sat, including blanks before day 1 and after last day
                    const cells = [];
                    for (let i = 0; i < startWeekday; i++) cells.push({ blank: true, key: "pre-" + i });
                    for (let d = 1; d <= daysInMonth; d++) {
                      const dayTrades = byDay[d] || [];
                      const pnl = dayTrades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
                      const pnlPct = dayTrades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
                      const w = dayTrades.filter(t => t.result === "Win").length;
                      const l = dayTrades.filter(t => t.result === "Loss").length;
                      const wr = (w + l) > 0 ? (w / (w + l)) * 100 : 0;
                      cells.push({ day: d, trades: dayTrades, pnl, pnlPct, wr, key: "d-" + d });
                    }
                    while (cells.length % 7 !== 0) cells.push({ blank: true, key: "post-" + cells.length });

                    // Split into weeks (rows of 7); compute weekly summaries
                    const weeks = [];
                    for (let i = 0; i < cells.length; i += 7) {
                      const row = cells.slice(i, i + 7);
                      const wkTrades = row.filter(c => !c.blank).flatMap(c => c.trades);
                      const wkPnl = wkTrades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
                      const wkDays = row.filter(c => !c.blank && c.trades.length > 0).length;
                      weeks.push({ cells: row, pnl: wkPnl, days: wkDays, n: wkTrades.length });
                    }

                    // Month totals
                    const monthTrades = Object.values(byDay).flat();
                    const monthPnl = monthTrades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);
                    const monthPnlPct = monthTrades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
                    const monthDays = Object.keys(byDay).length;

                    const shiftMonth = (dir) => {
                      const d = new Date(year, monthIdx + dir, 1);
                      setCalMonth(d);
                    };
                    const today = new Date();
                    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === monthIdx;
                    const todayDate = today.getDate();

                    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

                    return (
                      <div style={{ ...cardS, padding: 18 }}>
                        {/* Header: month nav + month total */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <button onClick={() => shiftMonth(-1)} style={{ ...btnG, padding: "6px 12px" }}>←</button>
                            <button onClick={() => setCalMonth(new Date())} style={{ ...btnG, padding: "6px 12px", fontSize: 11, color: isCurrentMonth ? T.textLight : T.accent, borderColor: isCurrentMonth ? T.border : T.accent + "60" }}>TODAY</button>
                            <button onClick={() => shiftMonth(1)} style={{ ...btnG, padding: "6px 12px" }}>→</button>
                            <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, marginLeft: 8 }}>{monthLabel}</span>
                          </div>
                          <div style={{ display: "flex", gap: 14, fontSize: 12, fontFamily: mono, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ color: T.textLight }}>Month:</span>
                            <span style={{ color: cP(monthPnl), fontWeight: 700 }}>{fU(monthPnl)}</span>
                            <span style={{ color: cP(monthPnlPct) }}>{fP(monthPnlPct)}</span>
                            <span style={{ color: T.textMid }}>· {monthDays} trading {monthDays === 1 ? "day" : "days"}</span>
                            <span style={{ color: T.textMid }}>· {monthTrades.length} {monthTrades.length === 1 ? "trade" : "trades"}</span>
                          </div>
                        </div>

                        {/* Calendar grid + weekly summary column */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 16 }}>
                          {/* Calendar */}
                          <div>
                            {/* Weekday header */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
                              {dayNames.map(d => (
                                <div key={d} style={{ textAlign: "center", fontSize: 10, color: T.textLight, fontFamily: mono, letterSpacing: 1, textTransform: "uppercase", padding: "6px 0" }}>{d}</div>
                              ))}
                            </div>
                            {/* Week rows */}
                            {weeks.map((wk, wi) => (
                              <div key={"wk-" + wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
                                {wk.cells.map(c => {
                                  if (c.blank) return <div key={c.key} style={{ minHeight: 78, background: "transparent" }} />;
                                  const hasTrades = c.trades.length > 0;
                                  const isToday = isCurrentMonth && c.day === todayDate;
                                  const bg = !hasTrades ? T.cardAlt
                                    : c.pnl > 0 ? T.greenBg
                                    : c.pnl < 0 ? T.redBg
                                    : T.cardAlt;
                                  const borderC = isToday ? T.accent
                                    : !hasTrades ? T.borderLight
                                    : c.pnl > 0 ? T.green + "40"
                                    : c.pnl < 0 ? T.red + "40"
                                    : T.border;
                                  return (
                                    <div key={c.key} title={hasTrades ? `${c.trades.length} trades · ${fU(c.pnl)} · ${c.wr.toFixed(0)}% WR` : ""}
                                      style={{
                                        minHeight: 78, padding: "6px 8px",
                                        background: bg,
                                        border: `${isToday ? 2 : 1}px solid ${borderC}`,
                                        borderRadius: 8,
                                        display: "flex", flexDirection: "column", justifyContent: "space-between",
                                        cursor: hasTrades ? "pointer" : "default",
                                      }}
                                      onClick={() => hasTrades && setDayModal({ dateISO: `${year}-${pad2(monthIdx + 1)}-${pad2(c.day)}`, trades: c.trades })}
                                    >
                                      <div style={{ fontSize: 11, fontWeight: 700, fontFamily: mono, color: isToday ? T.accent : (hasTrades ? T.text : T.textLight) }}>
                                        {c.day}
                                      </div>
                                      {hasTrades && (
                                        <div>
                                          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: mono, color: c.pnl >= 0 ? T.green : T.red, lineHeight: 1.1 }}>
                                            {c.pnl >= 0 ? "+" : "−"}${Math.abs(c.pnl).toFixed(0)}
                                          </div>
                                          <div style={{ fontSize: 9, color: T.textMid, fontFamily: mono, marginTop: 2 }}>
                                            {c.trades.length} {c.trades.length === 1 ? "trade" : "trades"}
                                          </div>
                                          <div style={{ fontSize: 9, color: c.wr >= 50 ? T.green : T.red, fontFamily: mono, fontWeight: 600 }}>
                                            {(c.trades.filter(t => t.result === "Win").length + c.trades.filter(t => t.result === "Loss").length) > 0 ? `${c.wr.toFixed(0)}%` : ""}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                          {/* Weekly summary column — purple-tinted, separated by gap */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ textAlign: "center", fontSize: 10, color: T.purple, fontFamily: mono, letterSpacing: 1, textTransform: "uppercase", padding: "6px 0", fontWeight: 600 }}>Week</div>
                            {weeks.map((wk, wi) => {
                              const wkTrades = wk.cells.filter(c => !c.blank).flatMap(c => c.trades || []);
                              const wkCells = wk.cells.filter(c => !c.blank && c.day != null);
                              const wkStart = wkCells.length > 0 ? `${year}-${pad2(monthIdx + 1)}-${pad2(wkCells[0].day)}` : null;
                              const wkEnd = wkCells.length > 0 ? `${year}-${pad2(monthIdx + 1)}-${pad2(wkCells[wkCells.length - 1].day)}` : null;
                              const clickable = wk.n > 0;
                              return (
                              <div key={"wsum-" + wi}
                                onClick={() => clickable && setDayModal({ dateISO: `Week ${wi + 1} · ${wkStart} → ${wkEnd}`, trades: wkTrades })}
                                style={{
                                  minHeight: 78, padding: "10px 12px",
                                  background: wk.n === 0 ? T.card : `linear-gradient(135deg, ${T.purpleBg} 0%, #FAF7FF 100%)`,
                                  border: `0.5px ${wk.n === 0 ? "dashed" : "solid"} ${wk.n === 0 ? T.purple + "30" : T.purple + "30"}`,
                                  borderRadius: 8,
                                  display: "flex", flexDirection: "column", justifyContent: "center",
                                  opacity: wk.n === 0 ? 0.6 : 1,
                                  cursor: clickable ? "pointer" : "default",
                                  transition: "transform 120ms",
                                }}
                                onMouseEnter={e => { if (clickable) e.currentTarget.style.transform = "translateY(-1px)"; }}
                                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
                              >
                                <div style={{ fontSize: 9, color: T.purple, fontFamily: mono, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>Week {wi + 1}</div>
                                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: wk.n === 0 ? T.textLight : (wk.pnl >= 0 ? T.green : T.red), lineHeight: 1.1, marginTop: 4 }}>
                                  {wk.n === 0 ? "$0" : `${wk.pnl >= 0 ? "+" : "−"}$${Math.abs(wk.pnl).toFixed(0)}`}
                                </div>
                                <div style={{ fontSize: 10, color: T.textMid, fontFamily: mono, marginTop: 2 }}>
                                  {wk.days} {wk.days === 1 ? "day" : "days"} · {wk.n}T
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
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

                  {/* PERFORMANCE BY TRADE TYPE */}
                  {S.typeStats && (S.typeStats.list.length > 0 || S.typeStats.untagged) && (
                    <div style={{ ...cardS, padding: 18 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>Performance by Trade Type</span>
                        <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>Which kinds of trades make you money?</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                        {S.typeStats.list.map(t => {
                          const color = t.pnl >= 0 ? T.green : T.red;
                          return (
                            <div key={t.name} style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${color}`, borderRadius: 10, padding: 14 }}>
                              <div style={{ fontSize: 10, color: T.textMid, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>{t.name}</div>
                              <div style={{ fontSize: 20, fontWeight: 700, color: cP(t.pnl), fontFamily: mono, lineHeight: 1.1, marginBottom: 4 }}>{fP(t.pnl)}</div>
                              <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono, marginBottom: 2 }}>{t.n} {t.n === 1 ? "trade" : "trades"} · {t.wr != null ? `${t.wr.toFixed(0)}% WR` : "—"}</div>
                              <div style={{ fontSize: 11, color: cP(t.avgPnl), fontFamily: mono }}>Avg {fP(t.avgPnl)}</div>
                            </div>
                          );
                        })}
                        {S.typeStats.untagged && (
                          <div style={{ background: T.cardAlt, border: `1px dashed ${T.border}`, borderRadius: 10, padding: 14, opacity: 0.7 }}>
                            <div style={{ fontSize: 10, color: T.textLight, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Untagged</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: cP(S.typeStats.untagged.pnl), fontFamily: mono, lineHeight: 1.1, marginBottom: 4 }}>{fP(S.typeStats.untagged.pnl)}</div>
                            <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono, marginBottom: 2 }}>{S.typeStats.untagged.n} {S.typeStats.untagged.n === 1 ? "trade" : "trades"} · {S.typeStats.untagged.wr != null ? `${S.typeStats.untagged.wr.toFixed(0)}% WR` : "—"}</div>
                            <div style={{ fontSize: 11, color: cP(S.typeStats.untagged.avgPnl), fontFamily: mono }}>Avg {fP(S.typeStats.untagged.avgPnl)}</div>
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: T.textLight, fontFamily: mono, marginTop: 10, padding: "8px 10px", background: T.cardAlt, borderRadius: 6, lineHeight: 1.5 }}>
                        <strong style={{ color: T.amber }}>Read:</strong> Each trade can have multiple types — totals here may exceed your trade count. Compare types: which categories print money, which lose? The losers are where you stop trading or refine your edge.
                      </div>
                    </div>
                  )}

                  {/* R-MULTIPLES & WIN PEAK — how far winners actually go vs how much we capture */}
                  {S.exitQuality && S.exitQuality.n >= 3 && (() => {
                    const eq = S.exitQuality;
                    const captureColor = eq.captureRate >= 70 ? T.green : eq.captureRate >= 50 ? T.amber : T.red;
                    const leftPerTrade = eq.totalLeftOnTable / eq.n;
                    return (
                      <div style={{ ...cardS, padding: 18 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                          <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>R-Multiples · Win Peak vs Realized</span>
                          <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>Are you capturing your trades or cutting them?</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                          {/* Avg Win Peak (MFE) */}
                          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${T.green}`, borderRadius: 10, padding: 14 }}>
                            <div style={{ fontSize: 10, color: T.textMid, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Avg Win Peak</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: T.green, fontFamily: mono, lineHeight: 1.1 }}>{eq.avgMFE >= 0 ? "+" : ""}{eq.avgMFE.toFixed(2)}R</div>
                            <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono, marginTop: 4 }}>how far winners went</div>
                          </div>
                          {/* Avg Realized */}
                          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${T.accent}`, borderRadius: 10, padding: 14 }}>
                            <div style={{ fontSize: 10, color: T.textMid, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Avg Captured</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: T.accent, fontFamily: mono, lineHeight: 1.1 }}>{eq.avgRealized >= 0 ? "+" : ""}{eq.avgRealized.toFixed(2)}R</div>
                            <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono, marginTop: 4 }}>what you actually closed</div>
                          </div>
                          {/* Capture Rate */}
                          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${captureColor}`, borderRadius: 10, padding: 14 }}>
                            <div style={{ fontSize: 10, color: T.textMid, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Capture Rate</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: captureColor, fontFamily: mono, lineHeight: 1.1 }}>{eq.captureRate.toFixed(0)}%</div>
                            <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono, marginTop: 4 }}>realized / peak</div>
                          </div>
                          {/* Left on Table */}
                          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${T.red}`, borderRadius: 10, padding: 14 }}>
                            <div style={{ fontSize: 10, color: T.textMid, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Left on Table</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: T.red, fontFamily: mono, lineHeight: 1.1 }}>−{leftPerTrade.toFixed(2)}R</div>
                            <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono, marginTop: 4 }}>per trade avg ({eq.totalLeftOnTable.toFixed(1)}R total)</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: T.textLight, fontFamily: mono, marginTop: 12, padding: "8px 10px", background: T.cardAlt, borderRadius: 6, lineHeight: 1.5 }}>
                          <strong style={{ color: captureColor }}>Read:</strong> {eq.captureRate >= 70
                            ? "Strong capture — when you're right, you're pressing. Keep doing this."
                            : eq.captureRate >= 50
                            ? "Decent capture but room to let runners go further. Try letting 1 trade/week run past your usual TP."
                            : `You're capturing only ${eq.captureRate.toFixed(0)}% of your move. ${leftPerTrade.toFixed(1)}R left on table per trade. Cutting winners too early is bleeding your edge.`}
                          {eq.n >= 5 && ` Based on ${eq.n} wins with Max R logged.`}
                        </div>
                      </div>
                    );
                  })()}

                  {/* RIGHT vs WRONG — how far wins went past close, how far losses went past stop */}
                  {(() => {
                    // Compute on the fly so it follows the dashboard period filter
                    const _t = dashboardPeriod === "all" ? trades : (S ? null : trades);
                    // Use already-filtered trades from S if available; otherwise compute
                    const winsWithMaxR = (S ? trades : trades).filter(t => t.result === "Win" && t.max_r != null && String(t.max_r).trim() !== "");
                    const lossesWithRev = (S ? trades : trades).filter(t => t.result === "Loss" && t.max_adverse_r != null && String(t.max_adverse_r).trim() !== "");
                    // Filter to dashboard period
                    const inPeriod = (t) => {
                      if (dashboardPeriod === "all") return true;
                      const now = new Date();
                      if (dashboardPeriod === "year") return t.date.startsWith(String(now.getFullYear()));
                      if (dashboardPeriod === "month") { const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`; return t.date.startsWith(ym); }
                      if (dashboardPeriod === "week") { const sow = isoDate(startOfWeek(now)); const eow = isoDate(endOfWeek(now)); return t.date >= sow && t.date <= eow; }
                      return true;
                    };
                    const wins = winsWithMaxR.filter(inPeriod);
                    const losses = lossesWithRev.filter(inPeriod);
                    if (wins.length === 0 && losses.length === 0) return null;

                    const winRs = wins.map(t => parseRR(t.max_r)).filter(v => v != null && !isNaN(v));
                    const lossRs = losses.map(t => parseFloat(t.max_adverse_r)).filter(v => !isNaN(v));
                    const avgWin = winRs.length > 0 ? winRs.reduce((s, v) => s + v, 0) / winRs.length : null;
                    const maxWin = winRs.length > 0 ? Math.max(...winRs) : null;
                    const avgLoss = lossRs.length > 0 ? lossRs.reduce((s, v) => s + v, 0) / lossRs.length : null;
                    const maxLoss = lossRs.length > 0 ? Math.max(...lossRs) : null;

                    return (
                      <div style={{ ...cardS, padding: 18 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                          <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>Right vs Wrong · R Excursion</span>
                          <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>How far wins went · how far losses went</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                          {/* WINS — how far the trade went past close (max_r) */}
                          {avgWin != null && (
                            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${T.green}`, borderRadius: 10, padding: 14 }}>
                              <div style={{ fontSize: 10, color: T.textMid, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>On Wins · How Right</div>
                              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                                <div style={{ fontSize: 28, fontWeight: 700, color: T.green, fontFamily: mono, lineHeight: 1.1 }}>+{avgWin.toFixed(2)}R</div>
                                <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono }}>avg max R</div>
                              </div>
                              <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono }}>
                                Best: <strong style={{ color: T.green }}>+{maxWin.toFixed(2)}R</strong> · {wins.length} {wins.length === 1 ? "win" : "wins"} logged
                              </div>
                            </div>
                          )}
                          {/* LOSSES — how far the trade went past stop (max_adverse_r) */}
                          {avgLoss != null && (
                            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${T.red}`, borderRadius: 10, padding: 14 }}>
                              <div style={{ fontSize: 10, color: T.textMid, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>On Losses · How Wrong</div>
                              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                                <div style={{ fontSize: 28, fontWeight: 700, color: T.red, fontFamily: mono, lineHeight: 1.1 }}>−{avgLoss.toFixed(2)}R</div>
                                <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono }}>avg past stop</div>
                              </div>
                              <div style={{ fontSize: 11, color: T.textMid, fontFamily: mono }}>
                                Worst: <strong style={{ color: T.red }}>−{maxLoss.toFixed(2)}R</strong> · {losses.length} {losses.length === 1 ? "loss" : "losses"} logged
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* TILT DETECTION + PRESSED WINNERS — The two retail killers */}
                  {(S.tilt || S.pressed) && (
                    <div style={{ ...cardS, padding: 18 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono }}>Behavior Patterns · The Two Retail Killers</span>
                        <span style={{ fontSize: 10, color: T.textLight, fontFamily: mono }}>Revenge trading & cutting winners early</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>

                        {/* TILT */}
                        {S.tilt && (() => {
                          const wrDelta = S.tilt.wr - S.wr;
                          const isTilted = wrDelta < -10; // 10pp lower than baseline = tilt signal
                          const color = isTilted ? T.red : wrDelta < -5 ? T.amber : T.green;
                          return (
                            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${color}`, borderRadius: 10, padding: 14 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                                <span style={{ fontSize: 14 }}>🔥</span>
                                <span style={{ fontSize: 11, color: T.textMid, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, fontWeight: 700 }}>Tilt Check · Trade After a Loss</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                                <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: mono, lineHeight: 1 }}>{S.tilt.wr != null ? `${S.tilt.wr.toFixed(0)}%` : "—"}</div>
                                <div style={{ fontSize: 11, color: T.textLight, fontFamily: mono }}>WR · vs {S.wr.toFixed(0)}% baseline</div>
                              </div>
                              <div style={{ fontSize: 11, fontFamily: mono, color: T.textMid, marginBottom: 8 }}>
                                {S.tilt.n} trades · <span style={{ color: T.green }}>{S.tilt.w}W</span> · <span style={{ color: T.red }}>{S.tilt.l}L</span> · <span style={{ color: cP(S.tilt.pnl), fontWeight: 600 }}>{fP(S.tilt.pnl)}</span>
                              </div>
                              <div style={{ fontSize: 10, color: T.textLight, fontFamily: mono, padding: "6px 8px", background: T.cardAlt, borderRadius: 6, lineHeight: 1.5 }}>
                                {isTilted ? <><strong style={{ color: T.red }}>⚠ Tilted.</strong> Post-loss trades underperform by {Math.abs(wrDelta).toFixed(0)}pp. Consider a "1-loss pause" rule.</>
                                  : wrDelta < -5 ? <><strong style={{ color: T.amber }}>Caution.</strong> Slightly worse after losses ({wrDelta.toFixed(0)}pp). Watch this metric.</>
                                  : <><strong style={{ color: T.green }}>Healthy.</strong> No tilt signal — you handle losses well.</>}
                              </div>
                            </div>
                          );
                        })()}

                        {/* PRESSED WINNERS */}
                        {S.pressed && (() => {
                          const p = S.pressed;
                          const color = p.pressedPct >= 50 ? T.green : p.pressedPct >= 30 ? T.amber : T.red;
                          return (
                            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${color}`, borderRadius: 10, padding: 14 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                                <span style={{ fontSize: 14 }}>🎯</span>
                                <span style={{ fontSize: 11, color: T.textMid, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: mono, fontWeight: 700 }}>Pressed Winners · Held to ≥80% of MFE</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                                <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: mono, lineHeight: 1 }}>{p.pressedPct.toFixed(0)}%</div>
                                <div style={{ fontSize: 11, color: T.textLight, fontFamily: mono }}>of winners held strong</div>
                              </div>
                              <div style={{ fontSize: 11, fontFamily: mono, color: T.textMid, marginBottom: 8 }}>
                                <span style={{ color: T.green }}>{p.pressedHard} pressed</span> · <span style={{ color: T.amber }}>{p.pressedSoft} partial</span> · <span style={{ color: T.red }}>{p.cutEarly} cut early</span> · {p.n} logged
                              </div>
                              <div style={{ fontSize: 10, color: T.textLight, fontFamily: mono, padding: "6px 8px", background: T.cardAlt, borderRadius: 6, lineHeight: 1.5 }}>
                                {p.pressedPct < 30 ? <><strong style={{ color: T.red }}>⚠ Cutting too early.</strong> Most winners exit before MFE. Small wins + big losses = no edge.</>
                                  : p.pressedPct < 50 ? <><strong style={{ color: T.amber }}>Mixed.</strong> Some pressed, many cut. Try letting one runner per day go further.</>
                                  : <><strong style={{ color: T.green }}>Pressing well.</strong> You're capturing most of the move when you're right.</>}
                              </div>
                            </div>
                          );
                        })()}

                      </div>
                      {(!S.tilt || !S.pressed) && (
                        <div style={{ fontSize: 10, color: T.textLight, fontFamily: mono, marginTop: 10, fontStyle: "italic", textAlign: "center" }}>
                          {!S.tilt && "Tilt check needs 5+ post-loss trades. "}
                          {!S.pressed && "Pressed winners needs 5+ wins with Max R filled in."}
                        </div>
                      )}
                    </div>
                  )}

                </>)}
              </div>
            )}

            {/* TRADE FORM — modal popup, rendered above all tabs */}
            {showForm && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", ...center, zIndex: 1000, padding: 16, overflowY: "auto", alignItems: "flex-start" }}>
                <div style={{ ...cardS, padding: 22, marginTop: 24, marginBottom: 24, maxWidth: 1100, width: "100%", maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{editId ? "Edit Trade" : "Log New Trade"}</span>
                  <button onClick={() => { setShowForm(false); setEditId(null); }} style={btnG}>✕</button>
                </div>

                {/* RISK GAUGES — compact running totals shown before logging a trade */}
                <div style={{ marginBottom: 14 }}>
                  <RiskGauges gauges={riskGauges} compact />
                </div>

                {/* DAY CONTEXT — read-only embed of the daily plan for this trade's date */}
                <DayContextBlock user={user} activeAccount={activeAccount} dateISO={form.date} />

                {/* TRADE TYPE MULTI-SELECT */}
                    {tradeTypes.length > 0 ? (() => {
                      const selectedTypes = (form.trade_types || "").split(",").map(s => s.trim()).filter(Boolean);
                      const toggleType = (name) => {
                        const set = new Set(selectedTypes);
                        if (set.has(name)) set.delete(name); else set.add(name);
                        setForm({ ...form, trade_types: [...set].join(", ") });
                      };
                      return (
                        <div style={{ background: T.cardAlt, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                            <span style={{ fontSize: 11, color: T.textLight, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, fontWeight: 700 }}>Trade Type · pick all that apply</span>
                            <span style={{ fontSize: 11, color: T.textMid, fontFamily: mono }}>{selectedTypes.length} selected</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 6 }}>
                            {tradeTypes.map(tt => {
                              const isSel = selectedTypes.includes(tt.name);
                              return (
                                <div key={tt.id}
                                  onClick={() => toggleType(tt.name)}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 10,
                                    padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                                    background: isSel ? T.purpleBg : T.card,
                                    border: `1px solid ${isSel ? T.purple + "60" : T.border}`,
                                  }}
                                >
                                  <div style={{
                                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                    background: isSel ? T.purple : T.card,
                                    border: `1.5px solid ${isSel ? T.purple : T.textLight}`,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    color: "#fff", fontSize: 12, fontWeight: 700,
                                  }}>{isSel ? "✓" : ""}</div>
                                  <span style={{ fontSize: 12, color: isSel ? T.purple : T.text, fontWeight: isSel ? 600 : 400 }}>{tt.name}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })() : (
                      <div style={{ background: T.cardAlt, border: `1px dashed ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 11, color: T.textMid, fontFamily: mono, lineHeight: 1.5 }}>
                        No trade types defined yet. Click <strong style={{ color: T.accent }}>⊞ Types</strong> in the top header to add some.
                      </div>
                    )}

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
                      {form.result === "Loss" && (
                        <Field label="Max R Reversed"><input type="text" value={form.max_adverse_r} onChange={e => setForm({ ...form, max_adverse_r: e.target.value })} placeholder="3 = went 3R past my stop" style={inputS} /></Field>
                      )}
                      <Field label="PnL %"><input type="number" step="0.01" value={form.pnl_pct} onChange={e => setForm({ ...form, pnl_pct: e.target.value })} style={inputS} /></Field>
                      <Field label="Result"><select value={form.result} onChange={e => { const newResult = e.target.value; setForm({ ...form, result: newResult, max_r: newResult === "Win" ? form.max_r : "", max_adverse_r: newResult === "Loss" ? form.max_adverse_r : "" }); }} style={selectS}><option>Win</option><option>Loss</option><option>Breakeven</option></select></Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 12 }}>
                      <Field label="Execution Link"><input type="url" value={form.exec_link} onChange={e => setForm({ ...form, exec_link: e.target.value })} placeholder="https://tradingview.com/..." style={inputS} /></Field>
                      <Field label="Bias Link"><input type="url" value={form.bias_link} onChange={e => setForm({ ...form, bias_link: e.target.value })} placeholder="https://..." style={inputS} /></Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12, marginTop: 12 }}>
                      <Field label="Trade Notes — Setup, Thesis, What Happened"><textarea value={form.notes_trade} onChange={e => setForm({ ...form, notes_trade: e.target.value })} rows={10} placeholder="Why I took the trade (setup, levels, technical + fundamental thesis, entry trigger) AND how the market actually played out (targets hit, reversed at key levels, news moves...)" style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 240 }} /></Field>
                      <Field label="Mistakes"><textarea value={form.notes_mistakes} onChange={e => setForm({ ...form, notes_mistakes: e.target.value })} rows={10} placeholder="What went wrong, what to improve, deviations from plan..." style={{ ...inputS, resize: "vertical", fontFamily: font, minHeight: 240 }} /></Field>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                      <button onClick={saveTrade} style={btnP}>{editId ? "Update" : "Save Trade"}</button>
                      <button onClick={() => { setShowForm(false); setEditId(null); }} style={btnG}>Cancel</button>
                    </div>
              </div>
              </div>
            )}

            {tab === "log" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ ...cardS, padding: 12 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 0, marginRight: 4 }}>
                      <button onClick={() => setGroupBy("none")} style={{ ...btnG, padding: "7px 12px", fontSize: 11, background: groupBy === "none" ? T.accent : "transparent", color: groupBy === "none" ? "#fff" : T.textMid, borderColor: groupBy === "none" ? T.accent : T.border, borderRadius: "8px 0 0 8px" }}>All</button>
                      <button onClick={() => setGroupBy("week")} style={{ ...btnG, padding: "7px 12px", fontSize: 11, background: groupBy === "week" ? T.accent : "transparent", color: groupBy === "week" ? "#fff" : T.textMid, borderColor: groupBy === "week" ? T.accent : T.border, borderLeft: "none", borderRight: "none", borderRadius: 0 }}>By Week</button>
                      <button onClick={() => setGroupBy("month")} style={{ ...btnG, padding: "7px 12px", fontSize: 11, background: groupBy === "month" ? T.accent : "transparent", color: groupBy === "month" ? "#fff" : T.textMid, borderColor: groupBy === "month" ? T.accent : T.border, borderRadius: "0 8px 8px 0" }}>By Month</button>
                    </div>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ ...inputS, width: 160, fontSize: 11, padding: "7px 10px" }} />
                    <select value={fPair} onChange={e => setFPair(e.target.value)} style={{ ...selectS, width: 120, fontSize: 11, padding: "7px 10px" }}><option value="All">All Pairs</option>{pairNames.map(p => <option key={p} value={p}>{p}</option>)}</select>
                    <select value={fResult} onChange={e => setFResult(e.target.value)} style={{ ...selectS, width: 110, fontSize: 11, padding: "7px 10px" }}><option value="All">All Results</option><option>Win</option><option>Loss</option><option>Breakeven</option></select>
                    <select value={fDir} onChange={e => setFDir(e.target.value)} style={{ ...selectS, width: 110, fontSize: 11, padding: "7px 10px" }}><option value="All">All Direction</option><option>Long</option><option>Short</option></select>
                    <select value={fSess} onChange={e => setFSess(e.target.value)} style={{ ...selectS, width: 120, fontSize: 11, padding: "7px 10px" }}><option value="All">All Sessions</option>{SESSIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                    <select value={fDay} onChange={e => setFDay(e.target.value)} style={{ ...selectS, width: 110, fontSize: 11, padding: "7px 10px" }}><option value="All">All Days</option>{DAYS_W.map(d => <option key={d} value={d}>{d}</option>)}</select>
                    {allTags.length > 0 && <select value={fTag} onChange={e => setFTag(e.target.value)} style={{ ...selectS, width: 130, fontSize: 11, padding: "7px 10px" }}><option value="All">All Tags</option>{allTags.map(t => <option key={t} value={t}>#{t}</option>)}</select>}
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
                      {[{ k: "date", l: "Date" }, { k: "day", l: "Day" }, { k: "session", l: "Session" }, { k: "pair", l: "Pair" }, { k: "direction", l: "Dir" }, { k: "risk", l: "Risk" }, { k: "entry", l: "Entry" }, { k: "exit", l: "Exit" }, { k: "rr", l: "R:R" }, { k: "max_r", l: "Max R" }, { k: "max_adverse_r", l: "Rev R" }, { k: "pnl_pct", l: "PnL" }, { k: "result", l: "Result" }].map(c => (
                        <th key={c.k} onClick={() => toggleSort(c.k)} style={{ textAlign: "left", padding: "10px 7px", color: T.textLight, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", borderBottom: `1px solid ${T.border}`, fontFamily: mono }}>{c.l}{sortCol === c.k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</th>
                      ))}
                      <th style={{ padding: "10px 7px", color: T.textLight, fontSize: 9, borderBottom: `1px solid ${T.border}`, fontFamily: mono }}>LINKS</th>
                      <th style={{ padding: "10px 7px", width: 55, borderBottom: `1px solid ${T.border}` }}></th>
                    </tr></thead>
                    <tbody>
                      {(() => {
                        // Build group keys + labels for each trade
                        const keyFor = (t) => {
                          if (groupBy === "week") {
                            const monday = startOfWeek(parseLocalDate(t.date));
                            return isoDate(monday);
                          }
                          if (groupBy === "month") return (t.date || "").substring(0, 7);
                          return null;
                        };
                        const labelFor = (key) => {
                          if (groupBy === "week") {
                            const monday = parseLocalDate(key);
                            const friday = endOfWeek(monday);
                            return `Week of ${monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${friday.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
                          }
                          if (groupBy === "month") {
                            return parseLocalDate(key + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
                          }
                          return "";
                        };

                        // Group trades preserving sort order
                        const groups = [];
                        const groupMap = {};
                        if (groupBy === "none") {
                          groups.push({ key: "_all", trades: filtered });
                        } else {
                          filtered.forEach(t => {
                            const k = keyFor(t);
                            if (!groupMap[k]) {
                              groupMap[k] = { key: k, trades: [] };
                              groups.push(groupMap[k]);
                            }
                            groupMap[k].trades.push(t);
                          });
                        }

                        const rows = [];
                        let rowIndex = 0;
                        groups.forEach(g => {
                          if (groupBy !== "none") {
                            // Compute group stats
                            const gN = g.trades.length;
                            const gW = g.trades.filter(t => t.result === "Win").length;
                            const gL = g.trades.filter(t => t.result === "Loss").length;
                            const gBE = g.trades.filter(t => t.result === "Breakeven").length;
                            const gWR = (gW + gL) > 0 ? (gW / (gW + gL)) * 100 : 0;
                            const gPnl = g.trades.reduce((s, t) => s + (parseFloat(t.pnl_pct) || 0), 0);
                            const gUsd = g.trades.reduce((s, t) => s + (parseFloat(t.pnl_usd) || 0), 0);

                            rows.push(
                              <tr key={"hdr-" + g.key} style={{ background: T.cardAlt, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
                                <td colSpan={15} style={{ padding: "10px 12px", color: T.text, fontFamily: mono, fontSize: 11, letterSpacing: 0.5 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                                    <span style={{ fontWeight: 700 }}>
                                      {groupBy === "week" ? "📅 " : "🗓️ "}{labelFor(g.key)}
                                    </span>
                                    <div style={{ display: "flex", gap: 14, fontSize: 11, alignItems: "center", flexWrap: "wrap" }}>
                                      <span style={{ background: T.card, padding: "2px 8px", borderRadius: 4, color: T.textMid, border: `0.5px solid ${T.border}` }}>{gN} {gN === 1 ? "trade" : "trades"}</span>
                                      <span style={{ color: T.green }}>{gW}W</span>
                                      <span style={{ color: T.red }}>{gL}L</span>
                                      {gBE > 0 && <span style={{ color: T.textLight }}>{gBE}BE</span>}
                                      <span style={{ color: gWR >= 50 ? T.green : T.red, fontWeight: 600 }}>{(gW + gL) > 0 ? `${gWR.toFixed(0)}%` : "—"}</span>
                                      <span style={{ color: gPnl >= 0 ? T.green : T.red, fontWeight: 700 }}>{fP(gPnl)}</span>
                                      <span style={{ color: gUsd >= 0 ? T.green : T.red, fontWeight: 600 }}>{fU(gUsd)}</span>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                          g.trades.forEach(t => {
                            const i = rowIndex++;
                            rows.push(
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
                                <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}>
                                  {(() => {
                                    if (t.result !== "Loss") return <span style={{ color: T.textLight }}>—</span>;
                                    const v = parseFloat(t.max_adverse_r);
                                    if (isNaN(v) || String(t.max_adverse_r || "").trim() === "") return <span style={{ color: T.textLight }}>—</span>;
                                    return <span style={{ color: T.red, fontWeight: 600 }}>−{v.toFixed(2)}R</span>;
                                  })()}
                                </td>
                                <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, fontWeight: 600 }}>
                                  <span style={{ color: cP(t.pnl_pct) }}>{fP(t.pnl_pct)}</span><br />
                                  <span style={{ fontSize: 9, color: T.textLight }}>{fU(t.pnl_usd)}</span>
                                </td>
                                <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}><Pill text={t.result} /></td>
                                <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}`, whiteSpace: "nowrap" }}>
                                  {t.exec_link && <a href={t.exec_link} target="_blank" rel="noreferrer" style={{ color: T.blue, fontSize: 9, marginRight: 5, textDecoration: "none", fontWeight: 600 }}>Chart</a>}
                                  {t.bias_link && <a href={t.bias_link} target="_blank" rel="noreferrer" style={{ color: T.purple, fontSize: 9, textDecoration: "none", fontWeight: 600 }}>Bias</a>}
                                </td>
                                <td style={{ padding: "8px 7px", borderBottom: `1px solid ${T.borderLight}` }}>
                                  <button onClick={() => setReplayTrade(t)} title="Replay" style={{ background: "none", border: "none", cursor: "pointer", color: T.purple, fontSize: 12, padding: "2px", marginRight: 4 }}>▶</button>
                                  <button onClick={() => exportDailyPDF({ user, activeAccount, dateISO: t.date })} title="Export day as PDF" style={{ background: "none", border: "none", cursor: "pointer", color: T.accent, fontSize: 11, padding: "2px", marginRight: 4 }}>⏷</button>
                                  <button onClick={() => editTrade(t)} style={{ background: "none", border: "none", cursor: "pointer", color: T.amber, fontSize: 12, padding: "2px" }}>✎</button>
                                  <button onClick={() => deleteTrade(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: 12, padding: "2px" }}>✕</button>
                                </td>
                              </tr>
                            );
                          });
                        });
                        return rows;
                      })()}
                    </tbody>
                  </table>
                  {filtered.length === 0 && <div style={{ textAlign: "center", padding: 40, color: T.textLight }}>{hasActiveFilters ? "No trades match filters" : "No trades"}</div>}
                </div>
              </div>
            )}


            {tab === "recap" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Sub-tab navigation */}
                <div style={{ ...cardS, padding: 4, display: "flex", gap: 4, alignSelf: "flex-start" }}>
                  {[
                    { k: "daily", l: "📋 Daily Plan" },
                    { k: "weekly", l: "📅 Weekly Recap" },
                    { k: "monthly", l: "🗓️ Monthly Recap" },
                  ].map(s => (
                    <button key={s.k} onClick={() => setDailySubTab(s.k)} style={{
                      padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: font,
                      border: "none", borderRadius: 6, cursor: "pointer",
                      background: dailySubTab === s.k ? T.accent : "transparent",
                      color: dailySubTab === s.k ? "#fff" : T.textMid,
                    }}>{s.l}</button>
                  ))}
                </div>
                {dailySubTab === "daily" && <DailyPlanPage
                  user={user}
                  activeAccount={activeAccount}
                  accountTrades={trades}
                  riskGauges={riskGauges}
                  onNewTrade={(dateISO) => { setForm({ ...emptyTrade(), date: dateISO }); setEditId(null); setShowForm(true); }}
                  onEditTrade={(t) => { editTrade(t); }}
                />}
                {dailySubTab === "weekly" && <RecapTab user={user} accounts={accounts} activeAccount={activeAccount} lockedPeriodType="week" />}
                {dailySubTab === "monthly" && <RecapTab user={user} accounts={accounts} activeAccount={activeAccount} lockedPeriodType="month" />}
              </div>
            )}

            {tab === "discipline" && <DisciplinePage user={user} />}

          </div>
        </>
      )}

      <div style={{ padding: "16px 20px", textAlign: "center", fontSize: 10, color: T.textLight, fontFamily: mono, borderTop: `1px solid ${T.border}`, marginTop: 20 }}>
        VARMARI · Macro Intelligence & Trading Infrastructure
      </div>
    </div>
  );
}

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
