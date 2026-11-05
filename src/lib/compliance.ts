/** Pure compliance rules (no imports; unit-tested). Age of digital consent differs per market. */
export const TERMS_VERSION = "2026-10";

/** Age below which guardian consent is required. Conservative default 18 for the Gulf/Arab markets (PDPL-style regimes); GDPR countries use 16 (13-16 member-state choice). */
const MINOR_AGE_BY_COUNTRY: Record<string, number> = {
  SA: 18, AE: 18, KW: 18, QA: 18, BH: 18, OM: 18, JO: 18, EG: 18, MA: 18, DZ: 18, TN: 18, IQ: 18, LB: 18,
  DE: 16, FR: 15, ES: 14, IT: 14, NL: 16, IE: 16, GB: 13, US: 13,
};
export const DEFAULT_MINOR_AGE = 18;

export function minorAgeFor(country?: string | null): number {
  return MINOR_AGE_BY_COUNTRY[(country ?? "").toUpperCase()] ?? DEFAULT_MINOR_AGE;
}

export function isMinor(birthYear: number, country?: string | null, now = new Date()): boolean {
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > now.getFullYear()) throw new RangeError("INVALID_BIRTH_YEAR");
  // Year-only is conservative: a person born in year Y may still be a year younger.
  return now.getFullYear() - birthYear - 1 < minorAgeFor(country);
}

export function canUpload(c: { is_minor: boolean; guardian_consent_at: string | null; terms_accepted_at: string | null } | null): boolean {
  if (!c) return true; // legacy accounts are prompted by the gate, not locked out
  if (c.is_minor && !c.guardian_consent_at) return false;
  return true;
}
