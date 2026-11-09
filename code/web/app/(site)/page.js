import P from "@/lib/product.json";
export default function Home() {
  return (
    <>
      <section className="dk full sec" style={{ paddingTop: 150 }}><div className="wrap">
        <div className="mono">TWWIOS · Relay</div>
        <h1 className="big" style={{ margin: "18px 0 16px", maxWidth: "12ch" }}>{P.name}</h1>
        <p className="mu" style={{ fontSize: 20, maxWidth: 620 }}>{P.line}</p>
        <p className="mu" style={{ maxWidth: 620 }}>{P.desc}</p>
        <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}><a className="btn w" href="/app">Open {P.name}</a></div>
      </div></section>
      <section className="lt full sec"><div className="wrap">
        <div className="mono">How it works</div>
        <h2 className="mid" style={{ margin: "14px 0 28px" }}>From your data to results, step by step.</h2>
        <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {P.steps.map((s, i) => (<div className="card" key={i} style={{ padding: 22, gap: 8 }}><div className="mono">Step {i + 1}</div><h3 style={{ fontSize: 22 }}>{s[0]}</h3><p className="mu" style={{ fontSize: 14, margin: 0 }}>{s[1]}</p></div>))}
        </div>
      </div></section>
      <section className="dk full sec"><div className="wrap">
        <div className="mono">Current way vs with {P.name}</div>
        <div style={{ display: "grid", gap: 10, marginTop: 24, maxWidth: 900 }}>
          {P.ba.map((r, i) => (<div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div className="card" style={{ padding: 16, opacity: .6, textDecoration: "line-through" }}>{r[0]}</div><div className="card" style={{ padding: 16, borderColor: "#34d399" }}>✓ {r[1]}</div></div>))}
        </div>
        <h3 style={{ marginTop: 40 }}>Features</h3>
        <ul className="mu">{P.features.map((f, i) => <li key={i}>{f}</li>)}</ul>
      </div></section>
      <section className="lt full sec" id="pricing"><div className="wrap">
        <div className="mono">Pricing (USD)</div>
        <h2 className="mid" style={{ margin: "14px 0 12px" }}>Simple conversation plans</h2>
        <p className="mu">{P.pricing.note}</p>
        <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", marginTop: 24 }}>
          {P.pricing.plans.map((plan) => (
            <div className="card" key={plan.id} style={{ padding: 22 }}>
              <div className="mono">{plan.name}</div>
              <h3 style={{ fontSize: 36, margin: "8px 0" }}>${plan.price}<span style={{ fontSize: 14 }}>/mo</span></h3>
              <p className="mu" style={{ margin: 0 }}>{plan.conversations.toLocaleString()} conversations / month</p>
            </div>
          ))}
        </div>
        <p className="mu" style={{ marginTop: 18, fontSize: 13 }}>Annual billing: pay for 10 months, get 12. INR checkout stays disabled until prices are approved.</p>
      </div></section>
    </>
  );
}
