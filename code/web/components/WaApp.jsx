"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import "./wa.css";
import "./product-theme.css";
import ART from "@/lib/art.json";

const REASON = { no_consent: "No consent on file", opted_out: "Opted out (STOP)", frequency_24h: "Messaged in last 24h", frequency_7d: "Weekly limit reached", fatigued: "Stopped reading (fatigued)", invalid_number: "Invalid number", same_company: "Same company (one per company)" };
const SAMPLE = "name,phone,company,amount\nAarav Mehta,98765 43210,Mehta Textiles,12400\nPriya Nair,90000 11122,Nair Traders,8250\nRohan Gupta,9811122233,Gupta Electricals,31900";
const tok = () => { try { return localStorage.getItem("wa_token") || ""; } catch { return ""; } };
async function call(path, { method, body } = {}) {
  const r = await fetch("/api/relay" + path, { method: method || (body ? "POST" : "GET"), headers: { "content-type": "application/json", ...(tok() ? { authorization: "Bearer " + tok() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && tok()) { try { localStorage.removeItem("wa_token"); } catch {} window.dispatchEvent(new Event("wa-out")); }
  if (!r.ok) throw Object.assign(new Error(j.error || "Something went wrong"), { data: j });
  return j;
}
function parseCsv(txt) {
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); if (!lines.length) return [];
  let head = ["name", "phone"]; if (/name|phone|mobile/i.test(lines[0])) head = lines.shift().split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_")).map((h) => (h === "mobile" || h === "number" ? "phone" : h));
  return lines.map((l) => { const c = l.split(",").map((x) => x.trim()), o = {}; head.forEach((h, i) => (o[h] = c[i] || "")); return o; });
}
const qc = (q) => (q === "GREEN" ? "g" : q === "YELLOW" ? "y" : q === "RED" ? "r" : "");
const stc = (s) => (["read", "replied", "done", "APPROVED"].includes(s) ? "g" : ["failed", "paused", "REJECTED", "skipped"].includes(s) ? "r" : ["delivered", "PENDING", "running"].includes(s) ? "y" : "");

function Auth({ onIn }) {
  const [mode, setMode] = useState("login"), [f, setF] = useState({ email: "", password: "", company: "" }), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams(), rt = q.get("reset");
  const [note, setNote] = useState("");
  useEffect(() => { const v = q.get("verify"); if (v) call("/auth/verify", { body: { token: v } }).then(() => setNote("Email confirmed. You can sign in.")).catch((x) => setErr(x.message)); }, []);
  async function go(e) { e.preventDefault(); setBusy(true); setErr(""); setNote(""); try {
    if (rt) { await call("/auth/reset", { body: { token: rt, password: f.password } }); setNote("Password changed. Sign in with your new password."); window.history.replaceState({}, "", window.location.pathname); setMode("login"); setBusy(false); return; }
    if (mode === "forgot") { const j = await call("/auth/forgot", { body: { email: f.email } }); setNote(j.note); setBusy(false); return; } const j = await call("/auth/" + mode, { body: f }); localStorage.setItem("wa_token", j.token); onIn(); } catch (x) { setErr(x.message); } setBusy(false); }
  return (<form className="wa-card wa-auth" onSubmit={go} style={{ marginBottom: 0 }}>
    <h2>{rt ? "Set a new password" : mode === "login" ? "Sign in" : mode === "forgot" ? "Reset password" : "Create your account"}</h2><p className="wa-note">WhatsApp messaging for your business, with safety built in.</p>
    {mode === "signup" && <><label className="l" htmlFor="co">Company</label><input id="co" type="text" value={f.company} onChange={set("company")} required /></>}
    {!rt && <><label className="l" htmlFor="em">Work email</label><input id="em" type="email" value={f.email} onChange={set("email")} required /></>}
    {mode !== "forgot" && <><label className="l" htmlFor="pw">{rt ? "New password" : "Password"}</label><input id="pw" type="password" value={f.password} onChange={set("password")} minLength={8} required /></>}
    {note && <div className="wa-ok">{note}</div>}
    {err && <div className="wa-err">{err}</div>}
    <div className="wa-row" style={{ marginTop: 16 }}><button className="wa-btn" disabled={busy}>{rt ? "Save password" : mode === "login" ? "Sign in" : mode === "forgot" ? "Send reset link" : "Start free trial"}</button><button type="button" className="wa-btn g" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "New here? Sign up" : "Have an account?"}</button>{mode === "login" && !rt && <button type="button" className="wa-btn g" onClick={() => setMode("forgot")}>Forgot password?</button>}</div>
  </form>);
}

function Overview({ me, go, camps }) {
  const w = me.wa, steps = [["Connect WhatsApp", w.connected, "settings"], ["Import contacts with consent", me.usage.contacts > 0, "contacts"], ["Create a template", true, "templates"], ["Send your first campaign", camps.length > 0, "campaigns"]];
  const [sent, setSent] = useState(false);
  return (<>
    {me.verified === false && <div className="wa-card" style={{ background: "#fff8eb" }}><b>Confirm your email.</b> We sent a link to {me.email}. <button className="wa-btn g sm" onClick={() => call("/auth/resend", { body: {} }).then(() => setSent(true))}>{sent ? "Sent" : "Resend"}</button></div>}
    <div className="wa-grid">
      <div className="wa-stat"><b>{w.connected ? w.quality : "Demo"}</b><span>Number health</span></div>
      <div className="wa-stat"><b>{w.connected ? (w.limit === null || w.limit === Infinity ? "Unlimited" : w.limit.toLocaleString()) : "1,000"}</b><span>People per 24h limit</span></div>
      <div className="wa-stat"><b>{me.usage.contacts}/{me.plan.contacts}</b><span>Contacts on plan</span></div>
      <div className="wa-stat"><b>{me.usage.marketingThisMonth}/{me.plan.marketingPerMonth}</b><span>Messages this month</span></div>
    </div>
    <div className="wa-card" style={{ marginTop: 16 }}><h2>Get live</h2>
      {steps.map(([t, d, tab]) => <div key={t} className={"wa-step" + (d ? " on" : "")}><i>{d ? "✓" : ""}</i><span>{t}</span>{!d && <button className="wa-btn g sm" onClick={() => go(tab)}>Open</button>}</div>)}
      {!w.connected && <FbConnect reload={() => go("overview")} inline />}
      {!w.connected && <p className="wa-note">You are in demo mode: sending is simulated so you can try everything. Connect your WhatsApp number to send for real.</p>}
    </div>
    <div className="wa-card"><h2>Shield is on</h2><p className="wa-note" style={{ marginTop: 0 }}>These run on every campaign, automatically:</p>
      {["Only people with a recorded opt-in can be messaged", "STOP, band karo and रोको unsubscribe people instantly", "A small test wave goes first. Spam or failure signals pause the rest", "Sending stays inside your WhatsApp daily limit, best-engaged people first", "No one gets more than one marketing message a day or two a week", "People who stop reading are rested automatically"].map((t) => <div className="wa-step on" key={t}><i>✓</i><span>{t}</span></div>)}
    </div></>);
}

const PHONE_RE = /phone|mobile|whatsapp|number|contact|मोबाइल|फ़ोन|फोन/i, NAME_RE = /^(name|full.?name|customer|नाम)/i;
// Turn a spreadsheet (array of rows, first row = header) into the CSV text the importer uses.
function sheetToCsv(rows) {
  const clean = (v) => String(v ?? "").replace(/[\r\n,]+/g, " ").trim();
  const head = rows[0].map(clean); let pi = head.findIndex((h) => PHONE_RE.test(h));
  if (pi < 0) { // no header names it: pick the column where most cells look like phone numbers
    const score = head.map((_, c) => rows.slice(1, 30).filter((r) => String(r[c] ?? "").replace(/\D/g, "").length >= 10).length); pi = score.indexOf(Math.max(...score)); }
  const ni = head.findIndex((h, i) => i !== pi && NAME_RE.test(h));
  const keys = head.map((h, i) => i === pi ? "phone" : i === ni ? "name" : (h || "col" + (i + 1)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, ""));
  return [keys.join(","), ...rows.slice(1).filter((r) => r.some((c) => c !== null && c !== "")).map((r) => keys.map((_, i) => clean(r[i])).join(","))].join("\n");
}

function Contacts({ me, reload, go }) {
  const [csv, setCsv] = useState(SAMPLE), [src, setSrc] = useState("website_form"), [proof, setProof] = useState(""), [att, setAtt] = useState(false), [msg, setMsg] = useState(""), [err, setErr] = useState(""), [list, setList] = useState({ contacts: [], total: 0, optedOut: 0, page: 1, pages: 1 }), [q, setQ] = useState(""), [page, setPage] = useState(1), [country, setCountry] = useState("");
  const load = useCallback(() => call(`/contacts?page=${page}&limit=50&q=${encodeURIComponent(q)}`).then(setList).catch(() => {}), [page, q]); useEffect(() => { load(); }, [load]);
  const [fileMsg, setFileMsg] = useState("");
  async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return; setErr(""); setMsg(""); setFileMsg("");
    try {
      let text;
      if (/\.xlsx$/i.test(f.name)) { const { default: readXlsxFile } = await import("read-excel-file"); const rows = await readXlsxFile(f); if (rows.length < 2) throw new Error("The sheet has no rows."); text = sheetToCsv(rows); }
      else if (/\.csv$|\.txt$/i.test(f.name)) text = await f.text();
      else throw new Error("Please upload an Excel (.xlsx) or CSV file. For an old .xls file, open it in Excel and Save As .xlsx.");
      setCsv(text); const n = parseCsv(text).length; setFileMsg(`Read ${n} rows from ${f.name}. Check the table below, tick consent and import.`);
    } catch (x) { setErr(x.message || "Could not read this file."); }
    e.target.value = "";
  }
  async function imp() {
    setErr(""); setMsg("");
    try {
      if (!country) throw new Error("Choose the default country for local numbers, or put full international numbers (with country code) in the sheet.");
      const j = await call("/contacts/import", { body: { contacts: parseCsv(csv), source: src, proof, attest: att, country } });
      setMsg(`Added ${j.added}, updated ${j.updated}, skipped ${j.invalid} invalid${j.needCountry ? ` (${j.needCountry} need a country)` : ""}${j.overPlanLimit ? `, ${j.overPlanLimit} over your plan limit` : ""}.`);
      load(); reload();
    } catch (x) { setErr(x.message); }
  }
  return (<>
    <div className="wa-card"><h2>Import contacts</h2><p className="wa-note" style={{ marginTop: 0 }}>First line is the header. Local numbers need an explicit country. Full international numbers (E.164) are accepted as-is.</p>
      <div className="wa-row" style={{ marginBottom: 6 }}><label className="wa-btn" htmlFor="xl" style={{ cursor: "pointer" }}>Upload Excel or CSV</label><input id="xl" type="file" accept=".xlsx,.csv,.txt" onChange={onFile} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} /><span className="wa-note" style={{ margin: 0 }}>We find the phone and name columns for you.</span></div>
      {fileMsg && <div className="wa-ok">{fileMsg}</div>}
      <label className="l" htmlFor="csv">Or paste rows</label><textarea id="csv" value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} />
      <div className="wa-row"><div style={{ flex: 1, minWidth: 160 }}><label className="l" htmlFor="cc">Default country for local numbers</label><select id="cc" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">Select country…</option>{[["IN","India (+91)"],["US","United States (+1)"],["GB","United Kingdom (+44)"],["AE","UAE (+971)"],["SG","Singapore (+65)"],["AU","Australia (+61)"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div style={{ flex: 1, minWidth: 200 }}><label className="l" htmlFor="src">Where did they opt in?</label><select id="src" value={src} onChange={(e) => setSrc(e.target.value)}>{[["website_form", "Website form"], ["checkout", "Checkout tick-box"], ["in_store", "In store / event"], ["existing_customers", "Existing customers who agreed"], ["click_to_whatsapp", "Click-to-WhatsApp ad"], ["trade_show", "Trade show / meeting"], ["crm", "Our CRM (consent recorded)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div style={{ flex: 1, minWidth: 200 }}><label className="l" htmlFor="pf">Proof (optional)</label><input id="pf" type="text" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="e.g. Checkout page, Oct 2026" /></div></div>
      <label className="wa-chk"><input type="checkbox" checked={att} onChange={(e) => setAtt(e.target.checked)} /><span>Everyone in this list agreed to receive WhatsApp messages from us. We keep the proof.</span></label>
      <div className="wa-row" style={{ marginTop: 14 }}><button className="wa-btn" disabled={!att} onClick={imp}>Import</button></div>
      {msg && <div className="wa-ok">{msg}</div>}{err && <div className="wa-err">{err}</div>}{msg && go && <div className="wa-row" style={{ marginTop: 12 }}><button className="wa-btn" onClick={() => go("campaigns")}>Next: send a campaign →</button></div>}</div>
    <div className="wa-card"><h2>{list.total} contacts</h2><p className="wa-note" style={{ marginTop: 0 }}>{list.optedOut} opted out</p>
      <div className="wa-row" style={{ marginBottom: 10 }}><input type="search" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="Search name, phone, company" style={{ flex: 1, minWidth: 180 }} /></div>
      <div className="wa-tw"><table><thead><tr><th>Name</th><th>Phone</th><th>Opt-in</th><th>Status</th><th></th></tr></thead><tbody>{list.contacts.map((c) => <tr key={c.id}><td>{c.name || "—"}</td><td>{c.phone}</td><td>{c.source}</td><td>{c.optedOut ? <span className="wa-pill r">Opted out</span> : c.fatigued ? <span className="wa-pill y">Resting</span> : <span className="wa-pill g">Active</span>}</td><td>{!c.optedOut && <button className="wa-btn g sm" onClick={() => call(`/contacts/${c.id}/optout`, { method: "POST", body: {} }).then(load)}>Opt out</button>}</td></tr>)}</tbody></table></div>
      <div className="wa-row" style={{ marginTop: 10 }}><button className="wa-btn g sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button><span className="wa-note">Page {list.page || page} / {list.pages || 1}</span><button className="wa-btn g sm" disabled={page >= (list.pages || 1)} onClick={() => setPage((p) => p + 1)}>Next</button></div></div></>);
}

function Templates() {
  const [d, setD] = useState({ templates: [], demo: true }), [f, setF] = useState({ name: "order_update", category: "UTILITY", language: "en", body: "Hi {{1}}, your order from {{2}} has shipped and will arrive in 2 days." }), [lint, setLint] = useState(null), [err, setErr] = useState(""), [ok, setOk] = useState("");
  const load = () => call("/templates").then(setD).catch((x) => setErr(x.message)); useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => call("/templates/lint", { body: f }).then(setLint).catch(() => {}), 350); return () => clearTimeout(t); }, [f]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function create() { setErr(""); setOk(""); try { const j = await call("/templates", { body: f }); setOk(`Submitted. Status: ${j.status}`); load(); } catch (x) { setErr(x.message); } }
  return (<>
    <div className="wa-card"><h2>Templates</h2><p className="wa-note" style={{ marginTop: 0 }}>WhatsApp only lets you start a conversation with an approved template. {d.demo && "Demo templates shown."}</p>
      <div className="wa-tw"><table><thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Message</th></tr></thead><tbody>{d.templates.map((t) => <tr key={t.name}><td>{t.name}</td><td>{t.category}</td><td><span className={"wa-pill " + stc(t.status)}>{t.status}</span></td><td>{t.body}{t.reason && t.reason !== "NONE" ? <div className="wa-err">{t.reason}</div> : null}</td></tr>)}</tbody></table></div></div>
    <div className="wa-card"><h2>New template</h2>
      <div className="wa-row"><div style={{ flex: 1, minWidth: 180 }}><label className="l" htmlFor="tn">Name</label><input id="tn" type="text" value={f.name} onChange={set("name")} /></div>
        <div style={{ flex: 1, minWidth: 140 }}><label className="l" htmlFor="tc">Category</label><select id="tc" value={f.category} onChange={set("category")}><option>UTILITY</option><option>MARKETING</option></select></div>
        <div style={{ flex: 1, minWidth: 100 }}><label className="l" htmlFor="tl">Language</label><input id="tl" type="text" value={f.language} onChange={set("language")} /></div></div>
      <label className="l" htmlFor="tb">Message. Use {"{{1}}"}, {"{{2}}"} for fields</label><textarea id="tb" style={{ fontFamily: "Manrope", fontSize: 15 }} value={f.body} onChange={set("body")} />
      {lint && <div style={{ marginTop: 10 }}>{lint.errors.map((x) => <div key={x} className="wa-err">✕ {x}</div>)}{lint.warnings.map((x) => <div key={x} className="wa-note" style={{ color: "#b45309" }}>! {x}</div>)}{lint.ok && !lint.warnings.length && <div className="wa-ok">✓ Looks good for approval</div>}</div>}
      <div className="wa-row" style={{ marginTop: 14 }}><button className="wa-btn" disabled={lint && !lint.ok} onClick={create}>Submit for approval</button></div>{ok && <div className="wa-ok">{ok}</div>}{err && <div className="wa-err">{err}</div>}</div></>);
}

function Campaigns({ me, reload }) {
  const [tpls, setTpls] = useState([]), [cols, setCols] = useState([]), [list, setList] = useState([]), [open, setOpen] = useState(null), [detail, setDetail] = useState(null), [pv, setPv] = useState(null), [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", templateName: "", varCols: [], onePerCompany: true, consent: false });
  const loadList = useCallback(() => call("/campaigns").then((j) => setList(j.campaigns)).catch(() => {}), []);
  useEffect(() => { call("/templates").then((j) => { const ok = j.templates.filter((t) => t.status === "APPROVED"); setTpls(ok); if (ok[0]) setF((x) => ({ ...x, templateName: x.templateName || ok[0].name })); }); call("/contacts").then((j) => setCols(["name", ...j.columns])); loadList(); }, [loadList]);
  useEffect(() => { call("/campaigns/preview", { body: { onePerCompany: f.onePerCompany } }).then(setPv).catch(() => {}); }, [f.onePerCompany, list.length]);
  useEffect(() => { const t = setInterval(() => { loadList(); if (open) call("/campaigns/" + open).then(setDetail).catch(() => {}); }, 2500); return () => clearInterval(t); }, [open, loadList]);
  useEffect(() => { if (open) call("/campaigns/" + open).then(setDetail).catch(() => {}); }, [open]);
  const tpl = tpls.find((t) => t.name === f.templateName), nv = tpl ? (tpl.body.match(/\{\{\d+\}\}/g) || []).length : 0;
  const pick = (i, v) => { const a = [...f.varCols]; a[i] = v; setF({ ...f, varCols: a }); };
  async function start() { setErr(""); try { const j = await call("/campaigns", { body: { ...f, lang: tpl?.language || "en", varCols: Array.from({ length: nv }, (_, i) => f.varCols[i] || cols[i] || "name") } }); setOpen(j.id); loadList(); reload(); } catch (x) { setErr(x.message + (x.data?.reasons ? " " + Object.entries(x.data.reasons).map(([k, v]) => `${REASON[k] || k}: ${v}`).join(", ") : "")); } }
  return (<>
    <div className="wa-card"><h2>New campaign</h2>
      <div className="wa-row"><div style={{ flex: 1, minWidth: 200 }}><label className="l" htmlFor="cn">Campaign name</label><input id="cn" type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="October reminders" /></div>
        <div style={{ flex: 1, minWidth: 200 }}><label className="l" htmlFor="ct">Approved template</label><select id="ct" value={f.templateName} onChange={(e) => setF({ ...f, templateName: e.target.value, varCols: [] })}>{tpls.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</select></div></div>
      {tpl && <p className="wa-note">{tpl.body}</p>}
      {Array.from({ length: nv }, (_, i) => <div key={i} className="wa-row" style={{ marginTop: 8 }}><code>{`{{${i + 1}}}`}</code><select aria-label={`Field for variable ${i + 1}`} style={{ maxWidth: 240 }} value={f.varCols[i] || cols[i] || "name"} onChange={(e) => pick(i, e.target.value)}>{cols.map((c) => <option key={c}>{c}</option>)}</select></div>)}
      <label className="wa-chk"><input type="checkbox" checked={f.onePerCompany} onChange={(e) => setF({ ...f, onePerCompany: e.target.checked })} /><span>One message per company. If five people from one company are on your list, only one is messaged. Best for B2B.</span></label>
      {pv && <div className="wa-shield"><b>Shield check</b>
        <div className="wa-row" style={{ marginTop: 8, gap: 18 }}><span><b style={{ fontSize: 22 }}>{pv.eligible}</b> will be sent</span><span><b style={{ fontSize: 22 }}>{pv.blocked}</b> held back</span><span>first wave: {pv.canary}</span><span>{pv.daysNeeded > 1 ? `${pv.daysNeeded} days at your daily limit` : "today"}</span></div>
        {Object.entries(pv.reasons).map(([k, v]) => <div key={k} className="wa-note">• {v} {REASON[k] || k}</div>)}</div>}
      <label className="wa-chk"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /><span>Everyone who will receive this agreed to get these messages.</span></label>
      <div className="wa-row" style={{ marginTop: 14 }}><button className="wa-btn" disabled={!f.consent || f.name.length < 2 || !tpl || !pv?.eligible} onClick={start}>Start campaign</button></div>{err && <div className="wa-err">{err}</div>}</div>
    <div className="wa-card"><h2>Campaigns</h2>{!list.length && <p className="wa-note">None yet.</p>}
      {list.map((c) => { const pct = c.total ? Math.round(c.counts.sent / c.total * 100) : 0; return (<div key={c.id} style={{ padding: "12px 0", borderTop: "1px solid rgba(255,255,255,.08)" }}>
        <div className="wa-row" style={{ justifyContent: "space-between" }}><b>{c.name}</b><span className={"wa-pill " + stc(c.status)}>{c.status}{c.stage === "canary" || c.stage === "canary_wait" ? " · test wave" : ""}</span></div>
        <div className="wa-bar"><i style={{ width: pct + "%" }} /></div>
        <div className="wa-note" style={{ marginTop: 0 }}>{c.counts.sent}/{c.total} sent · {c.counts.delivered} delivered · {c.counts.read} read · {c.counts.replied} replied · {c.counts.failed} failed{c.demo ? " · demo" : ""}</div>
        {(c.pauseReason || c.note) && <div className="wa-note" style={{ color: "#b45309" }}>{c.pauseReason || c.note}</div>}
        <div className="wa-row" style={{ marginTop: 8 }}><button className="wa-btn g sm" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Hide" : "Details"}</button>
          {c.status === "running" && <button className="wa-btn g sm" onClick={() => call(`/campaigns/${c.id}/pause`, { method: "POST", body: {} }).then(loadList)}>Pause</button>}
          {c.status === "paused" && <button className="wa-btn g sm" onClick={() => call(`/campaigns/${c.id}/resume`, { method: "POST", body: {} }).then(loadList)}>Resume</button>}</div>
        {open === c.id && detail && <div className="wa-tw" style={{ marginTop: 10 }}><table><thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Reply / error</th></tr></thead><tbody>{detail.messages.map((m, i) => <tr key={i}><td>{m.name || "—"}</td><td>{m.phone}</td><td><span className={"wa-pill " + stc(m.status)}>{m.status}</span></td><td>{m.reply || m.error || ""}</td></tr>)}</tbody></table></div>}</div>); })}</div></>);
}

function Replies() {
  const [leads, setLeads] = useState([]), [rules, setRules] = useState([]), [inbox, setInbox] = useState([]), [saved, setSaved] = useState(false);
  useEffect(() => { const l = () => { call("/leads").then((j) => setLeads(j.leads)).catch(() => {}); call("/inbox").then((j) => setInbox(j.messages)).catch(() => {}); }; l(); call("/rules").then((j) => setRules(j.rules.length ? j.rules : [{ keyword: "price", reply: "Thanks {{name}}! Our catalogue: example.com/catalogue" }])); const t = setInterval(l, 4000); return () => clearInterval(t); }, []);
  const ic = { hot: "g", later: "y", cold: "r" };
  return (<>
    <div className="wa-card"><h2>Hot leads</h2><p className="wa-note" style={{ marginTop: 0 }}>Replies sorted by buying intent, so your sales team calls the right people first.</p>
      <div className="wa-tw"><table><thead><tr><th>Intent</th><th>Name</th><th>Company</th><th>Phone</th><th>They said</th></tr></thead><tbody>{leads.map((l) => <tr key={l.phone}><td><span className={"wa-pill " + ic[l.intent]}>{l.intent}</span></td><td>{l.name || "—"}</td><td>{l.company}</td><td>{l.phone}</td><td>{l.text}</td></tr>)}{!leads.length && <tr><td colSpan={5} className="wa-note">No replies yet.</td></tr>}</tbody></table></div></div>
    <div className="wa-card"><h2>Auto-replies</h2><p className="wa-note" style={{ marginTop: 0 }}>Free-form replies are sent instantly when a customer writes back. STOP is always handled.</p>
      {rules.map((r, i) => <div key={i} className="wa-row" style={{ marginBottom: 8 }}><input aria-label="Keyword" style={{ maxWidth: 140 }} type="text" value={r.keyword} placeholder="keyword" onChange={(e) => { const a = [...rules]; a[i] = { ...r, keyword: e.target.value }; setRules(a); }} /><input aria-label="Reply" style={{ flex: 1, minWidth: 200 }} type="text" value={r.reply} placeholder="reply (use {{name}})" onChange={(e) => { const a = [...rules]; a[i] = { ...r, reply: e.target.value }; setRules(a); }} /><button className="wa-btn g sm" onClick={() => setRules(rules.filter((_, j) => j !== i))}>×</button></div>)}
      <div className="wa-row"><button className="wa-btn g" onClick={() => setRules([...rules, { keyword: "", reply: "" }])}>+ Add rule</button><button className="wa-btn" onClick={() => call("/rules", { method: "PUT", body: { rules } }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })}>Save rules</button>{saved && <span className="wa-ok">Saved</span>}</div></div>
    <div className="wa-card"><h2>Inbox</h2><div className="wa-tw"><table><thead><tr><th></th><th>Phone</th><th>Message</th></tr></thead><tbody>{inbox.map((m) => <tr key={m._id}><td>{m.direction === "in" ? "←" : "→ auto"}</td><td>{m.phone}</td><td>{m.text}</td></tr>)}</tbody></table></div></div></>);
}

function FbConnect({ reload, inline }) {
  const [cfg, setCfg] = useState(null), [msg, setMsg] = useState(""), [err, setErr] = useState(""), ids = useRef({});
  useEffect(() => { call("/config").then(setCfg).catch(() => {}); }, []);
  useEffect(() => {
    if (!cfg?.fbAppId || !cfg?.configId) return;
    const onMsg = (e) => { try { if (!new URL(e.origin).hostname.endsWith("facebook.com")) return; const d = JSON.parse(e.data); if (d.type === "WA_EMBEDDED_SIGNUP" && d.event === "FINISH") ids.current = d.data; } catch {} };
    window.addEventListener("message", onMsg);
    if (!window.FB) { window.fbAsyncInit = () => window.FB.init({ appId: cfg.fbAppId, autoLogAppEvents: true, xfbml: true, version: cfg.graphVersion }); const s = document.createElement("script"); s.src = "https://connect.facebook.net/en_US/sdk.js"; s.async = true; document.body.appendChild(s); }
    return () => window.removeEventListener("message", onMsg);
  }, [cfg]);
  if (!cfg?.fbAppId || !cfg?.configId) return null;
  const go = () => { setErr(""); setMsg(""); window.FB.login((r) => { const code = r.authResponse?.code; if (!code) return setErr("Facebook sign-in was cancelled."); let n = 0; const t = setInterval(async () => { n++; const d = ids.current; if (d.phone_number_id || n > 20) { clearInterval(t); if (!d.phone_number_id) return setErr("Setup did not finish. Please try again."); try { const j = await call("/wa/embedded", { body: { code, wabaId: d.waba_id, phoneId: d.phone_number_id } }); setMsg(`Connected ${j.number}.`); reload(); } catch (x) { setErr(x.message); } } }, 300); }, { config_id: cfg.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } }); };
  const Wrap = inline ? ({ children }) => <div style={{ margin: "10px 0 4px" }}>{children}</div> : ({ children }) => <div className="wa-card">{children}</div>;
  return (<Wrap><h2>Connect in one click</h2><p className="wa-note" style={{ marginTop: 0 }}>Sign in with Facebook, pick or create your WhatsApp Business account and number. No tokens to copy.</p><button className="wa-btn" onClick={go}>Connect WhatsApp</button>{msg && <div className="wa-ok">{msg}</div>}{err && <div className="wa-err">{err}</div>}</Wrap>);
}

function DeleteAccount() {
  const [pw, setPw] = useState(""), [err, setErr] = useState(""), [open, setOpen] = useState(false);
  return (<div className="wa-card"><h2>Delete account</h2><p className="wa-note" style={{ marginTop: 0 }}>Permanently removes your contacts, messages, campaigns, WhatsApp connection and login. This cannot be undone.</p>
    {!open ? <button className="wa-btn g" onClick={() => setOpen(true)}>Delete my account and data</button> : <><label className="l" htmlFor="dp">Enter your password to confirm</label><input id="dp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /><div className="wa-row" style={{ marginTop: 12 }}><button className="wa-btn" style={{ background: "#dc2626" }} onClick={async () => { try { await call("/account", { method: "DELETE", body: { password: pw } }); try { localStorage.removeItem("wa_token"); } catch {} window.location.reload(); } catch (x) { setErr(x.message); } }}>Delete everything</button><button className="wa-btn g" onClick={() => setOpen(false)}>Cancel</button></div></>}{err && <div className="wa-err">{err}</div>}</div>);
}

function Billing({ me, reload }) {
  const [b, setB] = useState(null), [err, setErr] = useState(""), [msg, setMsg] = useState("");
  const [d, setD] = useState({ legalName: "", gstin: "", address: "", state: "", phone: "" }), [dm, setDm] = useState("");
  const load = () => call("/billing").then(setB).catch(() => {});
  useEffect(() => { load(); call("/billing/details").then((j) => setD((x) => ({ ...x, ...j.details }))).catch(() => {}); }, []);
  const saveD = () => { setErr(""); setDm(""); call("/billing/details", { method: "PUT", body: d }).then(() => setDm("Saved. These appear on your invoices.")).catch((x) => setErr(x.message)); };
  async function buy(plan) {
    setErr(""); setMsg("");
    try {
      const j = await call("/billing/checkout", { body: { plan } });
      await new Promise((ok, no) => { if (window.Razorpay) return ok(); const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = ok; s.onerror = () => no(new Error("Could not load the payment window.")); document.body.appendChild(s); });
      new window.Razorpay({ key: j.keyId, subscription_id: j.subscriptionId, name: "Relay by TWWIOS", description: plan + " plan, monthly", handler: () => { setMsg("Payment received. Your plan activates in a few seconds."); setTimeout(() => { reload(); load(); }, 4000); }, theme: { color: "#2457f5" } }).open();
    } catch (x) { setErr(x.message); }
  }
  if (!b) return null;
  const until = b.paidUntil ? new Date(b.paidUntil).toLocaleDateString() : null;
  return (<div className="wa-card"><h2>Your plan</h2>
    <p className="wa-note" style={{ marginTop: 0 }}>Current plan: <b>{b.plan}</b>{until ? ` · paid until ${until}` : " · free trial"}{b.cancelling ? " · will not renew" : ""}</p>
    <details style={{ margin: "10px 0" }}><summary style={{ cursor: "pointer", fontWeight: 600 }}>Billing details (for GST invoice)</summary>
      <label className="l" htmlFor="bl">Company legal name</label><input id="bl" value={d.legalName} onChange={(e) => setD({ ...d, legalName: e.target.value })} />
      <label className="l" htmlFor="bg">GSTIN (optional)</label><input id="bg" value={d.gstin} onChange={(e) => setD({ ...d, gstin: e.target.value.toUpperCase() })} maxLength={15} />
      <label className="l" htmlFor="ba">Billing address</label><input id="ba" value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} />
      <label className="l" htmlFor="bs">State</label><input id="bs" value={d.state} onChange={(e) => setD({ ...d, state: e.target.value })} />
      <div style={{ marginTop: 10 }}><button className="wa-btn g sm" onClick={saveD}>Save billing details</button></div>{dm && <div className="wa-ok">{dm}</div>}</details>
    <div className="wa-row">{["starter", "growth"].map((p) => <button key={p} className="wa-btn" onClick={() => buy(p)}>{p === b.plan && until ? "Renew " : "Choose "}{p} · Rs {b.prices[p]}/month</button>)}
      {b.plan !== "trial" && !b.cancelling && <button className="wa-btn g" onClick={() => call("/billing/cancel", { body: {} }).then((j) => { setMsg(j.note); load(); }).catch((x) => setErr(x.message))}>Cancel renewal</button>}</div>
    {msg && <div className="wa-ok">{msg}</div>}{err && <div className="wa-err">{err}</div>}
    <p className="wa-note">Billed monthly through Razorpay (UPI, cards, netbanking). Prices exclude GST.</p></div>);
}

function Settings({ me, reload }) {
  const [f, setF] = useState({ phoneId: "", wabaId: "", token: "" }), [msg, setMsg] = useState(""), [err, setErr] = useState(""), [key, setKey] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function conn() { setErr(""); setMsg(""); try { const j = await call("/wa/connect", { body: f }); setMsg(`Connected ${j.number} (${j.name}). Quality ${j.quality}, limit ${j.limit?.toLocaleString?.() ?? "unlimited"} people per day.`); setF({ phoneId: "", wabaId: "", token: "" }); reload(); } catch (x) { setErr(x.message); } }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [oneClick, setOneClick] = useState(false);
  useEffect(() => { call("/config").then((c) => setOneClick(!!(c.fbAppId && c.configId))).catch(() => {}); }, []);
  return (<>
    <Billing me={me} reload={reload} />
    <FbConnect reload={reload} />
    <details className="wa-card" open={!oneClick || me.wa.connected} style={{ display: "block" }}><summary style={{ cursor: "pointer", fontWeight: 700 }}>WhatsApp connection{oneClick ? " (advanced: connect with tokens)" : ""}</summary>
      {me.wa.connected ? <p className="wa-ok">Connected: {me.wa.number} · {me.wa.name} · quality {me.wa.quality}</p> : <p className="wa-note" style={{ marginTop: 0 }}>Not connected. You are in demo mode.</p>}
      <p className="wa-note">In Meta Business Suite → WhatsApp → API setup, copy the Phone number ID, the WhatsApp Business Account ID and a permanent access token (system user).</p>
      <label className="l" htmlFor="pi">Phone number ID</label><input id="pi" type="text" value={f.phoneId} onChange={set("phoneId")} />
      <label className="l" htmlFor="wi">WhatsApp Business Account ID</label><input id="wi" type="text" value={f.wabaId} onChange={set("wabaId")} />
      <label className="l" htmlFor="tk">Access token</label><input id="tk" type="password" value={f.token} onChange={set("token")} autoComplete="off" />
      <div className="wa-row" style={{ marginTop: 14 }}><button className="wa-btn" onClick={conn}>Connect</button>{me.wa.connected && <button className="wa-btn g" onClick={() => call("/wa", { method: "DELETE" }).then(reload)}>Disconnect</button>}</div>
      {msg && <div className="wa-ok">{msg}</div>}{err && <div className="wa-err">{err}</div>}
      <p className="wa-note">The token is encrypted before it is stored. Webhook URL to enter in Meta: <code>{origin}/api/relay/webhook</code> (subscribe to <code>messages</code>).</p></details>
    <div className="wa-card"><h2>Send from your own system</h2><p className="wa-note" style={{ marginTop: 0 }}>Trigger a template from your ERP, billing or CRM, for example when an invoice becomes due. Consent and STOP are still enforced.</p>
      <button className="wa-btn g" onClick={() => call("/api-key", { method: "POST", body: {} }).then((j) => setKey(j.key))}>Generate API key</button>
      {key && <><div className="wa-ok">Copy it now, it is shown once: <code>{key}</code></div><pre>{`curl -X POST ${origin}/api/relay/v1/send \\\n  -H "x-api-key: ${key}" -H "content-type: application/json" \\\n  -d '{"to":"9876543210","template":"payment_reminder","lang":"en","vars":["Aarav","12400"]}'`}</pre></>}</div>
    <DeleteAccount /></>);
}

function Social({ me }) {
  const [s, setS] = useState(null), [cfg, setCfg] = useState(null), [pages, setPages] = useState(null), [ut, setUt] = useState(""), [man, setMan] = useState({ pageId: "", token: "" });
  const [msg, setMsg] = useState(""), [err, setErr] = useState(""), [th, setTh] = useState([]), [rep, setRep] = useState({});
  const blank = { type: "comment_to_dm", channel: "both", name: "", keywords: "", postId: "", reply: "Hi {{name}}, thanks for your interest! Here are the details: https://yourshop.in/offer. Reply STOP to opt out.", publicReply: "Sent you a DM!" };
  const [f, setF] = useState(blank), [sim, setSim] = useState({ kind: "comment", text: "price", username: "ravi_k" }), [simOut, setSimOut] = useState("");
  const load = () => { call("/social").then(setS).catch((x) => setErr(x.message)); call("/social/inbox").then((j) => setTh(j.threads)).catch(() => {}); };
  useEffect(() => { load(); call("/config").then(setCfg).catch(() => {}); }, []);
  const fbLogin = () => {
    setErr(""); const run = () => window.FB.login((r) => { const t = r.authResponse?.accessToken; if (!t) return setErr("Facebook sign-in was cancelled."); setUt(t); call("/social/fb/pages", { body: { userToken: t } }).then((j) => setPages(j.pages)).catch((x) => setErr(x.message)); }, { scope: "pages_show_list,pages_messaging,pages_manage_metadata,pages_read_engagement,pages_manage_engagement,instagram_basic,instagram_manage_messages,instagram_manage_comments,business_management" });
    if (window.FB) return run();
    window.fbAsyncInit = () => { window.FB.init({ appId: cfg.fbAppId, version: cfg.graphVersion, xfbml: false }); run(); };
    const sc = document.createElement("script"); sc.src = "https://connect.facebook.net/en_US/sdk.js"; sc.async = true; document.body.appendChild(sc);
  };
  const pick = (id) => call("/social/connect", { body: { pageId: id, userToken: ut } }).then((j) => { setMsg(`Connected ${j.page}${j.instagram ? " and Instagram @" + j.instagram : " (no Instagram linked to this Page)"}.`); setPages(null); load(); }).catch((x) => setErr(x.message));
  const manual = () => call("/social/connect", { body: man }).then((j) => { setMsg(`Connected ${j.page}.`); load(); }).catch((x) => setErr(x.message));
  const add = () => { setErr(""); call("/social/autos", { body: { type: f.type, channel: f.channel, name: f.name, keywords: f.keywords.split(",").map((x) => x.trim()).filter(Boolean), postId: f.postId, reply: f.reply, publicReply: f.publicReply } }).then(() => { setF(blank); load(); }).catch((x) => setErr(x.message)); };
  if (!s) return <div className="wa-card">Loading…</div>;
  const kind = { comment_to_dm: "Comment → DM", dm_keyword: "DM keyword reply", welcome: "Welcome reply" };
  return (<>
    <div className="wa-card"><h2>Instagram and Facebook</h2>
      <p className="wa-note" style={{ marginTop: 0 }}>Included in your plan. When someone comments a keyword on your post, they get your message in their DMs. When someone messages you, they get an instant reply. Meta allows replies only to people who comment or message you first, so there are no cold bulk DMs here, and that is what keeps your account safe.</p>
      <div className="wa-row"><span className="wa-chip">{s.quota.used}/{s.quota.cap} automated messages this month</span><span className={"wa-chip " + (s.connected ? "g" : "y")}>{s.connected ? `Connected: ${s.page.name}${s.page.igUsername ? " · @" + s.page.igUsername : ""}` : "Demo mode"}</span></div>
      {!s.connected && cfg?.fbAppId && <div style={{ marginTop: 12 }}><button className="wa-btn" onClick={fbLogin}>Connect Facebook and Instagram</button></div>}
      {pages && <div style={{ marginTop: 12 }}><b>Choose your Page</b>{pages.length === 0 && <p className="wa-note">No Pages found for this login.</p>}{pages.map((p) => <div key={p.id} className="wa-step"><i></i><span>{p.name}{p.ig ? ` · Instagram @${p.ig}` : " · no Instagram linked"}</span><button className="wa-btn g sm" onClick={() => pick(p.id)}>Use this</button></div>)}</div>}
      {s.connected && <div style={{ marginTop: 12 }}><button className="wa-btn g sm" onClick={() => call("/social/connect", { method: "DELETE" }).then(load)}>Disconnect</button></div>}
      {!s.connected && <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", fontWeight: 600 }}>Connect with a Page token (advanced)</summary>
        <label className="l" htmlFor="sp">Facebook Page ID</label><input id="sp" value={man.pageId} onChange={(e) => setMan({ ...man, pageId: e.target.value })} />
        <label className="l" htmlFor="st">Page access token</label><input id="st" type="password" value={man.token} onChange={(e) => setMan({ ...man, token: e.target.value })} autoComplete="off" />
        <div style={{ marginTop: 10 }}><button className="wa-btn" onClick={manual}>Connect</button></div>
        <p className="wa-note">In your Meta app webhooks, use callback <code>{typeof window !== "undefined" ? window.location.origin : ""}/api/relay/social/webhook</code>. Instagram: comments, messages. Page: feed, messages.</p></details>}
      {msg && <div className="wa-ok">{msg}</div>}{err && <div className="wa-err">{err}</div>}
    </div>
    <div className="wa-card"><h2>Automations</h2>
      {s.autos.length === 0 && <p className="wa-note" style={{ marginTop: 0 }}>None yet. Add your first below.</p>}
      {s.autos.map((x) => <div key={x._id} className={"wa-step" + (x.enabled ? " on" : "")}><i>{x.enabled ? "✓" : ""}</i><span><b>{x.name}</b> · {kind[x.type]} · {x.channel}{x.keywords?.length ? ` · "${x.keywords.join('", "')}"` : ""} · sent {x.sent || 0}{x.lastError ? <em style={{ color: "#dc2626" }}> · {x.lastError}</em> : null}</span>
        <button className="wa-btn g sm" onClick={() => call("/social/autos/" + x._id, { method: "PUT", body: { enabled: !x.enabled } }).then(load)}>{x.enabled ? "Pause" : "Turn on"}</button><button className="wa-btn g sm" onClick={() => call("/social/autos/" + x._id + "/delete", { body: {} }).then(load)}>Delete</button></div>)}
      <h3 style={{ margin: "18px 0 4px" }}>New automation</h3>
      <label className="l" htmlFor="at">Type</label><select id="at" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="comment_to_dm">Comment → DM (someone comments a keyword on your post)</option><option value="dm_keyword">DM keyword reply (someone messages a keyword)</option><option value="welcome">Welcome reply (first message of the day)</option></select>
      <label className="l" htmlFor="ac">Where</label><select id="ac" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="both">Instagram and Facebook</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select>
      <label className="l" htmlFor="an">Name</label><input id="an" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Price request" />
      {f.type !== "welcome" && <><label className="l" htmlFor="ak">Keywords, comma separated {f.type === "comment_to_dm" ? "(leave empty to reply to every comment)" : ""}</label><input id="ak" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} placeholder="price, link, details" /></>}
      {f.type === "comment_to_dm" && <><label className="l" htmlFor="ap">Only for one post (optional post ID)</label><input id="ap" value={f.postId} onChange={(e) => setF({ ...f, postId: e.target.value })} /></>}
      <label className="l" htmlFor="ar">Message to send</label><textarea id="ar" rows={3} value={f.reply} onChange={(e) => setF({ ...f, reply: e.target.value })} />
      {f.type === "comment_to_dm" && <><label className="l" htmlFor="au">Public reply under the comment (optional)</label><input id="au" value={f.publicReply} onChange={(e) => setF({ ...f, publicReply: e.target.value })} /></>}
      <p className="wa-note">Use {"{{name}}"} for their first name. Everyone who sends STOP is never messaged again.</p>
      <button className="wa-btn" onClick={add}>Add automation</button>
    </div>
    <div className="wa-card"><h2>Try it</h2><p className="wa-note" style={{ marginTop: 0 }}>Pretend a customer comments or messages. Nothing is sent to Meta.</p>
      <div className="wa-row"><select aria-label="Event" value={sim.kind} onChange={(e) => setSim({ ...sim, kind: e.target.value })}><option value="comment">Comments on a post</option><option value="dm">Sends a DM</option></select><input aria-label="Text" value={sim.text} onChange={(e) => setSim({ ...sim, text: e.target.value })} /><input aria-label="Username" value={sim.username} onChange={(e) => setSim({ ...sim, username: e.target.value })} style={{ maxWidth: 140 }} />
        <button className="wa-btn" onClick={() => call("/social/simulate", { body: { ...sim, channel: "instagram" } }).then((j) => { setSimOut(j.handled ? "Reply sent (demo)." : "No message sent: " + j.reason.replace(/_/g, " ")); load(); }).catch((x) => setSimOut(x.message))}>Run</button></div>{simOut && <div className="wa-ok">{simOut}</div>}</div>
    <div className="wa-card"><h2>Conversations</h2>
      {th.length === 0 && <p className="wa-note" style={{ marginTop: 0 }}>No conversations yet.</p>}
      {th.map((t) => <div key={t._id} style={{ borderTop: "1px solid var(--line, #e2e8f0)", padding: "10px 0" }}><b>{t.username}</b> <span className="wa-chip">{t.channel}</span>{t.intent && t.intent !== "other" && <span className="wa-chip y">{t.intent}</span>}{t.lead?.phone && <span className="wa-chip g">{t.lead.phone}</span>}{t.lead?.email && <span className="wa-chip g">{t.lead.email}</span>}{t.optedOut && <span className="wa-chip">stopped</span>}
        {t.messages.map((m, i) => <div key={i} className="wa-note" style={{ margin: "3px 0" }}>{m.dir === "in" ? "Customer: " : "You: "}{m.text}</div>)}
        {t.canReply ? <div className="wa-row" style={{ marginTop: 6 }}><input aria-label={"Reply to " + t.username} value={rep[t._id] || ""} onChange={(e) => setRep({ ...rep, [t._id]: e.target.value })} placeholder="Reply (allowed for 24 hours)" /><button className="wa-btn g sm" onClick={() => call("/social/reply", { body: { threadId: t._id, text: rep[t._id] } }).then(() => { setRep({ ...rep, [t._id]: "" }); load(); }).catch((x) => setErr(x.message))}>Send</button></div> : <p className="wa-note">{t.optedOut ? "Stopped by the customer." : "Reply window closed (24 hours)."}</p>}</div>)}
    </div></>);
}

export default function WaApp() {
  const [authed, setAuthed] = useState(null), [me, setMe] = useState(null), [tab, setTab] = useState("overview"), [camps, setCamps] = useState([]);
  const reload = useCallback(() => call("/me").then((j) => { setMe(j); setAuthed(true); }).catch(() => setAuthed(false)), []);
  useEffect(() => { reload(); const o = () => setAuthed(false); window.addEventListener("wa-out", o); return () => window.removeEventListener("wa-out", o); }, [reload]);
  useEffect(() => { if (authed) call("/campaigns").then((j) => setCamps(j.campaigns)).catch(() => {}); }, [authed, tab]);
  const tabs = [["overview", "Overview"], ["contacts", "Contacts"], ["templates", "Templates"], ["campaigns", "Campaigns"], ["replies", "Replies & leads"], ["social", "Instagram & Facebook"], ["settings", "Settings"]];
  return (<div className="wa"><div className="wa-in">
    <div className="wa-top"><a className="wa-brand" href="/"><i></i>Relay <span style={{fontWeight:600,color:"#64748b",fontSize:13,textTransform:"none",letterSpacing:0}}>WhatsApp by TWWIOS</span></a>
      {me && authed && <div className="wa-row"><span className="wa-chip">{me.company} · {me.plan.label}</span><span className={"wa-chip " + (me.wa.connected ? qc(me.wa.quality) : "y")}>{me.wa.connected ? `WhatsApp ${me.wa.quality}` : "Demo mode"}</span><button className="wa-btn g sm" onClick={() => { try { localStorage.removeItem("wa_token"); } catch {} setAuthed(false); }}>Sign out</button></div>}</div>
    {authed === null && <p className="wa-note">Loading…</p>}
    {authed === false && <>
      <div className="wa-hero">
        <div>
          <h1>Message every customer. <em>Safely.</em></h1>
          <p className="wa-lead">Upload your customer sheet, pick an approved message, and send it on WhatsApp. Relay keeps your number safe, handles replies and unsubscribes, and shows you who is ready to buy.</p>
          <Auth onIn={reload} />
        </div>
        <div className="wa-art"><div dangerouslySetInnerHTML={{ __html: ART.orbs }} />
          <div className="wa-phone" aria-hidden="true"><div className="wa-ph-h"><i>A</i>Acme Traders</div><div className="wa-ph-b">
            <div className="wa-bub">Hi Ravi, a reminder from Acme: invoice of Rs 15,000 is due. Reply YES if already paid.<small>10:02 ✓✓</small></div>
            <div className="wa-bub in">YES, paid today<small>10:04</small></div>
            <div className="wa-bub">Thank you Ravi! Noted.<small>10:04 ✓✓</small></div></div></div></div>
      </div>
      <div className="wa-steps3">{[["1", "Upload your sheet", "Excel or CSV. We find the phone and name columns.", "grid"], ["2", "Choose a message", "Approved templates with personal fields.", "wave"], ["3", "Send and track", "Delivered, read and replied, live.", "lines"]].map(([n, t, d, k]) => <div className="wa-s3" key={n}><div className="im"><div dangerouslySetInnerHTML={{ __html: ART[k] }} /><b>{n}</b></div><div className="t"><h3>{t}</h3><p>{d}</p></div></div>)}</div>
      <div className="wa-feats">{[["Consent first", "Only people who opted in can be messaged."], ["Test wave", "A small batch goes first. Problems pause the rest."], ["STOP handled", "Unsubscribes work in English, Hinglish and Hindi."], ["Hot leads", "Replies sorted by buying intent."]].map(([t, d]) => <div className="wa-feat" key={t}><b>{t}</b><span>{d}</span></div>)}</div></>}
    {authed && me && <><div className="wa-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={"wa-tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "overview" && <Overview me={me} go={setTab} camps={camps} />}{tab === "contacts" && <Contacts me={me} reload={reload} go={setTab} />}{tab === "templates" && <Templates />}{tab === "campaigns" && <Campaigns me={me} reload={reload} />}{tab === "replies" && <Replies />}{tab === "social" && <Social me={me} />}{tab === "settings" && <Settings me={me} reload={reload} />}</>}
  </div></div>);
}
