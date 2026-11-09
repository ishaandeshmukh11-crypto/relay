// Company legal facts. Do not invent values — leave null until confirmed for publication.
export const COMPANY = {
  legalName: process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME || null, // e.g. "TWWIOS Technologies Private Limited"
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || null,
  gstin: process.env.NEXT_PUBLIC_COMPANY_GSTIN || null,
  phone: process.env.NEXT_PUBLIC_COMPANY_PHONE || null,
  email: process.env.NEXT_PUBLIC_COMPANY_EMAIL || null, // official business email
  dataDeletionEmail: process.env.NEXT_PUBLIC_DATA_DELETION_EMAIL || null,
};

export function missingCompanyFields() {
  return Object.entries(COMPANY).filter(([, v]) => !v).map(([k]) => k);
}
