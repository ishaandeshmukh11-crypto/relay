import { COMPANY, missingCompanyFields } from "@/lib/company";

export const metadata = { title: "Data Processing Addendum · Relay" };

export default function DpaPage() {
  const missing = missingCompanyFields();
  return (
    <section className="lt full sec" style={{ paddingTop: 120 }}>
      <div className="wrap" style={{ maxWidth: 760 }}>
        <div className="mono">Legal</div>
        <h1 className="mid" style={{ margin: "12px 0 20px" }}>Data Processing Addendum</h1>
        <p className="mu">This DPA scaffold describes how TWWIOS processes customer personal data as a processor when you use Relay. Replace with counsel-approved language before signing with customers.</p>
        {missing.length > 0 && (
          <p className="mu" style={{ border: "1px solid #f59e0b", padding: 12, borderRadius: 8 }}>
            Missing company facts required before publication: {missing.join(", ")}.
          </p>
        )}
        <h2>Roles</h2>
        <p className="mu">You are the controller of your contact and conversation data. {COMPANY.legalName || "[COMPANY LEGAL NAME REQUIRED]"} acts as processor for hosting, sending orchestration, and storage.</p>
        <h2>Subprocessors</h2>
        <p className="mu">Typical subprocessors include MongoDB Atlas (database), Meta (WhatsApp / social graph), Stripe and/or Razorpay (payments), and Resend (transactional email). Confirm the live list before customer signature.</p>
        <h2>Deletion</h2>
        <p className="mu">Account deletion cancels billing where configured and removes organization-scoped operational collections. Backup retention windows must be documented operationally before production launch.</p>
      </div>
    </section>
  );
}
