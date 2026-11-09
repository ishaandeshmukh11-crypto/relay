import Script from "next/script";
import P from "@/lib/product.json";
export const metadata = { title: "TWWIOS " + P.name, description: P.line };
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };
export default function SiteLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" />
        <link rel="stylesheet" href="/site.css" />
      </head>
      <body>
        <header className="nav full"><div className="in">
          <a className="logo" href="/"><i></i>TWWIOS {P.name}</a>
          <nav className="links" aria-label="Main">
            <a href="/">Overview</a>
            <a href="/#pricing">Pricing</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/app">Open app</a>
          </nav>
          <button className="nav-toggle" type="button" aria-label="Menu" data-nav-toggle>Menu</button>
          <a className="btn w" href="/app">Get started</a>
        </div></header>
        <main id="app">{children}</main>
        <footer className="dk full"><div className="wrap">
          <p className="legal">© TWWIOS · {P.name}</p>
          <p className="mu" style={{ fontSize: 13 }}>
            <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/dpa">DPA</a> · <a href="/data-deletion">Data deletion</a>
          </p>
          <p className="mu" style={{ fontSize: 12 }}>Marketing design file <code>design/website-final.html</code> was not supplied in this package. Site content follows product copy only; do not treat this as the final branded marketing design.</p>
        </div></footer>
        <Script id="nav-toggle">{`document.querySelector('[data-nav-toggle]')?.addEventListener('click',()=>document.querySelector('.nav')?.classList.toggle('open'))`}</Script>
      </body>
    </html>
  );
}
