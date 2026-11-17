import { createSchemeRiskometer, FileSchemeRiskometer, SchemeRiskFileError, UnconfiguredSchemeRiskometer } from './scheme-riskometer';

const file = (over: any = {}) => ({ source: 'AMC factsheet Oct 2026', asOf: '2026-11-01', schemes: { '100': 'MODERATE', '200': 'VERY_HIGH' }, ...over });
describe('scheme riskometer', () => {
  it('returns the published level with its source and date, and nothing for unknown schemes', async () => {
    const r = new FileSchemeRiskometer(file(), () => Date.parse('2026-11-17'));
    expect(await r.get('100')).toEqual({ schemeCode: '100', level: 'MODERATE', asOf: '2026-11-01', source: 'AMC factsheet Oct 2026', stale: false });
    expect(await r.get('999')).toBeNull();
  });
  it('marks data older than ~2 months as stale', async () => {
    expect((await new FileSchemeRiskometer(file({ asOf: '2026-08-01' }), () => Date.parse('2026-11-17')).get('100'))!.stale).toBe(true);
  });
  it('rejects invalid files loudly instead of loading guesses', () => {
    for (const bad of [null, {}, file({ source: '' }), file({ asOf: 'yesterday' }), file({ schemes: {} }), file({ schemes: { '1': 'MODERATE' } }), file({ schemes: { '100': 'MEDIUM' } }), file({ schemes: [] })])
      expect(() => new FileSchemeRiskometer(bad)).toThrow(SchemeRiskFileError);
  });
  it('is unconfigured by default; a bad file fails startup in production only', () => {
    expect(createSchemeRiskometer({}, true)).toBeInstanceOf(UnconfiguredSchemeRiskometer);
    expect(createSchemeRiskometer({ SCHEME_RISKOMETER_FILE: '/nonexistent.json' }, false)).toBeInstanceOf(UnconfiguredSchemeRiskometer);
    expect(() => createSchemeRiskometer({ SCHEME_RISKOMETER_FILE: '/nonexistent.json' }, true)).toThrow(/SCHEME_RISKOMETER_FILE/);
  });
});
