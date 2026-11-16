/**
 * LOCALE REGISTRY — the single place to add a language.
 *
 * Only languages confirmed by the product owner belong here. The remaining ~13-language list is PENDING APPROVAL:
 * do not add, name or advertise any language until that list is supplied. To add one: create `<code>.ts` (Partial catalog),
 * import it in index.tsx's `catalogs`, add one entry below, run `npm run i18n:check`, then get legal/financial strings human-reviewed.
 */
export interface LocaleMeta {
  code: string;
  nativeName: string;          // shown in the language picker (never translated)
  rtl?: boolean;
  status: 'complete' | 'draft'; // draft = machine-assisted, not yet human-reviewed
  legalReviewed: boolean;       // risk disclosures / consent / financial warnings reviewed by a human translator
}

export const LOCALE_REGISTRY: LocaleMeta[] = [
  { code: 'en', nativeName: 'English', status: 'complete', legalReviewed: false },
  { code: 'hi', nativeName: 'हिन्दी', status: 'draft', legalReviewed: false },
  { code: 'mr', nativeName: 'मराठी', status: 'draft', legalReviewed: false },
];

/** Keys whose text is legally/financially material. These must never ship machine-translated. */
export const LEGAL_KEY_PREFIXES = ['disclosure.', 'consent.', 'risk.', 'legal.', 'signup.accept', 'signup.legalUnavailable'];
