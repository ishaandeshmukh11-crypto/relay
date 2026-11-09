import { COMPANY, missingCompanyFields } from "@/lib/company";

export const metadata = { title: "Data deletion · Relay" };

export default async function DataDeletionPage({ searchParams }) {
  const missing = missingCompanyFields();
  const sp = await searchParams;
  const code = sp?.code;
  return (
    <section className="lt full sec" style={{ paddingTop: 120 }}>
      <div className="wrap" style={{ maxWidth: 760 }}>
        <div className="mono">Privacy</div>
        <h1 className="mid" style={{ margin: "12px 0 20px" }}>Data deletion</h1>
        <p className="mu">Signed-in customers can delete their Relay account from the app settings. That cancels active subscriptions where billing is configured and removes organization data from the live database.</p>
        {code && <p className="mu">Meta deletion confirmation code: <strong>{code}</strong>. Status can be checked with the API using this code.</p>}
        {missing.length > 0 && (
          <p className="mu" style={{ border: "1px solid #f59e0b", padding: 12, borderRadius: 8 }}>
            Missing company facts required before publication: {missing.join(", ")}.
          </p>
        )}
        <h2>Meta callback</h2>
        <p className="mu">Facebook/Meta data-deletion callbacks are accepted at <code>/api/relay/meta/data-deletion</code> on the API host. Configure that URL in the Meta app dashboard.</p>
        <h2>Contact</h2>
        <p className="mu">{COMPANY.dataDeletionEmail || COMPANY.email || "[DATA DELETION CONTACT EMAIL REQUIRED]"}</p>
      </div>
    </section>
  );
}
