/**
 * LOCALE REGISTRY — the single place to add a language.
 *
 * Only languages confirmed by the product owner belong here. Owner-confirmed so far (11 of the 13 requested): en, hi, mr, gu, pa, bn, ta, te, as, kn, ml.
 * Odia (or) and Urdu (ur) are PROPOSED as the remaining two (proposed: true) until the owner confirms the final list; edit this registry to change them. To add one: create `<code>.ts` (Partial catalog),
 * import it in index.tsx's `catalogs`, add one entry below, run `npm run i18n:check`, then get legal/financial strings human-reviewed.
 */
export interface LocaleMeta {
  code: string;
  nativeName: string;          // shown in the language picker (never translated)
  rtl?: boolean;
  proposed?: boolean;           // proposed by the team, awaiting owner confirmation; the list stays configurable
  status: 'complete' | 'draft'; // draft = machine-assisted, not yet human-reviewed
  legalReviewed: boolean;       // risk disclosures / consent / financial warnings reviewed by a human translator
}

export const LOCALE_REGISTRY: LocaleMeta[] = [
  { code: 'en', nativeName: 'English', status: 'complete', legalReviewed: false },
  { code: 'hi', nativeName: 'हिन्दी', status: 'draft', legalReviewed: false },
  { code: 'mr', nativeName: 'मराठी', status: 'draft', legalReviewed: false },
  { code: 'gu', nativeName: 'ગુજરાતી', status: 'draft', legalReviewed: false },
  { code: 'pa', nativeName: 'ਪੰਜਾਬੀ', status: 'draft', legalReviewed: false },
  { code: 'bn', nativeName: 'বাংলা', status: 'draft', legalReviewed: false },
  { code: 'ta', nativeName: 'தமிழ்', status: 'draft', legalReviewed: false },
  { code: 'te', nativeName: 'తెలుగు', status: 'draft', legalReviewed: false },
  { code: 'as', nativeName: 'অসমীয়া', status: 'draft', legalReviewed: false },
  { code: 'kn', nativeName: 'ಕನ್ನಡ', status: 'draft', legalReviewed: false },
  { code: 'ml', nativeName: 'മലയാളം', status: 'draft', legalReviewed: false },
  { code: 'or', nativeName: 'ଓଡ଼ିଆ', proposed: true, status: 'draft', legalReviewed: false },
  { code: 'ur', nativeName: 'اردو', rtl: true, proposed: true, status: 'draft', legalReviewed: false },
];

/** Keys whose text is legally/financially material. These must never ship machine-translated. */
export const LEGAL_KEY_PREFIXES = ['disclosure.', 'consent.', 'risk.', 'legal.', 'signup.accept', 'signup.legalUnavailable'];
