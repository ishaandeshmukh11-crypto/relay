import { COMPANY, missingCompanyFields } from "@/lib/company";

export const metadata = { title: "Privacy Policy · Relay" };

export default function PrivacyPage() {
  const missing = missingCompanyFields();
  return (
    <section className="lt full sec" style={{ paddingTop: 120 }}>
      <div className="wrap" style={{ maxWidth: 760 }}>
        <div className="mono">Legal</div>
        <h1 className="mid" style={{ margin: "12px 0 20px" }}>Privacy Policy</h1>
        <p className="mu">Relay processes account data, contact lists you upload, WhatsApp delivery events, and billing records needed to operate the service.</p>
        {missing.length > 0 && (
          <p className="mu" style={{ border: "1px solid #f59e0b", padding: 12, borderRadius: 8 }}>
            Missing company facts required before publication: {missing.join(", ")}.
          </p>
        )}
        <h2>Data we process</h2>
        <ul className="mu">
          <li>Account email, company name, and authentication secrets (hashed)</li>
          <li>Contact names, phone numbers, consent source, and opt-out status</li>
          <li>Campaign content references, delivery statuses, and inbox messages</li>
          <li>Encrypted WhatsApp access tokens and billing identifiers</li>
        </ul>
        <h2>Your rights</h2>
        <p className="mu">You may export operational data through the product where available, opt contacts out, and request account deletion from the app. Meta users may use the data-deletion callback documented on the data deletion page.</p>
        <h2>Controller</h2>
        <p className="mu">
          {COMPANY.legalName || "[COMPANY LEGAL NAME REQUIRED]"} · {COMPANY.address || "[ADDRESS REQUIRED]"} · {COMPANY.email || "[EMAIL REQUIRED]"}
        </p>
      </div>
    </section>
  );
}
