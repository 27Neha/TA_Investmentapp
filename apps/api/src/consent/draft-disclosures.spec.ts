import { DRAFT_DISCLOSURES, DRAFT_VERSION } from './draft-disclosures';

describe('draft legal documents', () => {
  it('are clearly labelled drafts, never claim approval, and leave legal clauses blank for counsel', () => {
    expect(DRAFT_VERSION).toMatch(/draft/);
    for (const d of DRAFT_DISCLOSURES) {
      expect(d.title).toMatch(/DRAFT/);
      expect(d.body.startsWith('DRAFT FOR LEGAL REVIEW')).toBe(true);
      expect(d.body).toMatch(/\[LEGAL TO /);
      expect(d.body).not.toMatch(/approved by (our|the) (lawyer|counsel|regulator)|legally (approved|reviewed)\b(?!.*not)/i);
      expect(d.body.length).toBeGreaterThan(900);
      expect((d.body.match(/^# /gm) ?? []).length).toBeGreaterThanOrEqual(6); // real headings, readable structure
    }
  });
  it('do not contain secrets, ids or invented registration numbers', () => {
    for (const d of DRAFT_DISCLOSURES) expect(d.body).not.toMatch(/ARN-?\d|\b\d{10,}\b|password=|secret/i);
  });
});
