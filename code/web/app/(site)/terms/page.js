import { COMPANY, missingCompanyFields } from "@/lib/company";

export const metadata = { title: "Terms of Service · Relay" };

export default function TermsPage() {
  const missing = missingCompanyFields();
  return (
    <section className="lt full sec" style={{ paddingTop: 120 }}>
      <div className="wrap" style={{ maxWidth: 760 }}>
        <div className="mono">Legal</div>
        <h1 className="mid" style={{ margin: "12px 0 20px" }}>Terms of Service</h1>
        <p className="mu">These terms govern use of Relay by TWWIOS. This page is a publication scaffold. Replace placeholders with counsel-approved text before launch.</p>
        {missing.length > 0 && (
          <p className="mu" style={{ border: "1px solid #f59e0b", padding: 12, borderRadius: 8 }}>
            Missing company facts required before publication: {missing.join(", ")}.
          </p>
        )}
        <h2>1. Service</h2>
        <p className="mu">Relay provides WhatsApp campaign tooling, contact consent tracking, and optional social comment-to-message features. You must have a valid WhatsApp Business account and comply with Meta policies.</p>
        <h2>2. Accounts</h2>
        <p className="mu">You are responsible for account credentials, accurate billing details, and lawful use of customer contact data including consent and opt-out.</p>
        <h2>3. Billing</h2>
        <p className="mu">USD plans follow the published guide (Starter $49 / 1,000 conversations, Growth $149 / 10,000). Annual billing charges ten months. INR pricing is shown only when explicitly approved.</p>
        <h2>4. Provider</h2>
        <p className="mu">
          Legal entity: {COMPANY.legalName || "[COMPANY LEGAL NAME REQUIRED]"}<br />
          Address: {COMPANY.address || "[COMPANY ADDRESS REQUIRED]"}<br />
          GSTIN: {COMPANY.gstin || "[GSTIN REQUIRED IF APPLICABLE]"}<br />
          Contact: {COMPANY.email || "[OFFICIAL BUSINESS EMAIL REQUIRED]"} {COMPANY.phone ? `· ${COMPANY.phone}` : ""}
        </p>
      </div>
    </section>
  );
}
