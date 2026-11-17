// Plain-Node checks for the signup rules and legal formatting. Run: npm run test:signup
import test from 'node:test';
import assert from 'node:assert/strict';
import { asDisclosure, cleanMobile, consentFromReader, continueState, fieldError, legalLoadFailure, signupErrorKey, signupPayload, validateSignup } from '../src/lib/signup-rules.ts';
import { hasLegalPlaceholders, parseLegalBody } from '../src/lib/legal-format.ts';

const good = { fullName: 'Asha Patil', email: 'asha@example.com', mobile: '98765 43210', dob: '1990-05-20', password: 'Correct#Horse9', confirm: 'Correct#Horse9' };
const NOW = new Date('2026-11-17T00:00:00Z');
const docs = { terms: { version: '0.2-draft' }, privacy: { version: '0.2-draft' } };

test('a fully valid form has no field errors', () => assert.deepEqual(validateSignup(good, NOW), {}));

test('each field reports its own error key', () => {
  const bad = { fullName: ' A ', email: 'nope', mobile: '12345', dob: '2090-01-01', password: 'short', confirm: 'x' };
  assert.deepEqual(validateSignup(bad, NOW), { fullName: 'signup.err.fullName', email: 'signup.err.email', mobile: 'signup.err.mobile', dob: 'signup.invalidDob', password: 'signup.passwordHint', confirm: 'signup.mismatch' });
});

test('mobile accepts the formats the server accepts and rejects the rest', () => {
  for (const m of ['9876543210', '98765 43210', '+91 98765-43210', '09876543210', '919876543210']) assert.equal(fieldError('mobile', { ...good, mobile: m }, NOW), null, m);
  for (const m of ['5876543210', '987654321', '98765432101', '', 'abcdefghij']) assert.equal(fieldError('mobile', { ...good, mobile: m }, NOW), 'signup.err.mobile', m);
  assert.equal(cleanMobile('+91 98765-43210'), '+919876543210');
});

test('date of birth must be a real past date in YYYY-MM-DD', () => {
  for (const d of ['1990-02-30', '31-12-1990', '2090-01-01', '', '1800-01-01']) assert.equal(fieldError('dob', { ...good, dob: d }, NOW), 'signup.invalidDob', d);
  assert.equal(fieldError('dob', { ...good, dob: '2000-02-29' }, NOW), null);
});

test('password follows the server policy and the confirmation must match', () => {
  for (const p of ['alllowercase1!', 'ALLUPPERCASE1!', 'NoDigitsHere!!', 'NoSymbol12345', 'Sh0rt!']) assert.equal(fieldError('password', { ...good, password: p }, NOW), 'signup.passwordHint', p);
  assert.equal(fieldError('confirm', { ...good, confirm: '' }, NOW), 'signup.mismatch');
});

test('Continue is enabled ONLY with valid fields, loaded documents and both explicit consents', () => {
  const on = { terms: true, privacy: true, docsReady: true };
  assert.equal(continueState(good, on, NOW).ok, true);
  assert.deepEqual(continueState(good, { ...on, terms: false }, NOW).missing, ['terms']);
  assert.deepEqual(continueState(good, { ...on, privacy: false }, NOW).missing, ['privacy']);
  assert.deepEqual(continueState(good, { terms: false, privacy: false, docsReady: true }, NOW).missing, ['terms', 'privacy']);
  assert.deepEqual(continueState(good, { ...on, docsReady: false }, NOW).missing, ['docs']);
  const s = continueState({ ...good, mobile: '1' }, on, NOW);
  assert.equal(s.ok, false); assert.deepEqual(s.invalidFields, ['mobile']); assert.deepEqual(s.missing, ['fields']);
  assert.equal(continueState({ fullName: '', email: '', mobile: '', dob: '', password: '', confirm: '' }, on, NOW).ok, false);
});

test('an empty object or missing body is not a loaded document', () => {
  assert.equal(asDisclosure({}), null); assert.equal(asDisclosure(null), null); assert.equal(asDisclosure(undefined), null);
  assert.equal(asDisclosure({ version: '1', body: '   ' }), null); assert.equal(asDisclosure({ version: 5, body: 'x' }), null);
  assert.deepEqual(asDisclosure({ version: '0.2-draft', title: 'T', body: 'B', reviewed: false }), { kind: undefined, version: '0.2-draft', title: 'T', body: 'B', reviewed: false, effectiveFrom: undefined });
});

test('the payload carries the exact versions, cleaned values, and explicit consent flags', () => {
  const p = signupPayload({ ...good, email: ' Asha@Example.com ' }, { locale: 'hi', termsVersion: 'T1', privacyVersion: 'P1' });
  assert.deepEqual(p, { fullName: 'Asha Patil', email: 'asha@example.com', mobile: '9876543210', dateOfBirth: '1990-05-20', password: 'Correct#Horse9', locale: 'hi', acceptTerms: true, acceptPrivacy: true, termsVersion: 'T1', privacyVersion: 'P1' });
});

test('API failures map to friendly messages; ordinary validation errors keep the server text', () => {
  assert.equal(signupErrorKey(0), 'signup.err.server'); assert.equal(signupErrorKey(403, 'LEGAL_NOT_APPROVED'), 'signup.err.legalNotApproved');
  assert.equal(signupErrorKey(429), 'signup.err.rate'); assert.equal(signupErrorKey(500), 'signup.err.generic');
  assert.equal(signupErrorKey(400), null); assert.equal(signupErrorKey(409), null);
  assert.equal(legalLoadFailure(0), 'network'); assert.equal(legalLoadFailure(404, 'LEGAL_NOT_AVAILABLE'), 'unavailable'); assert.equal(legalLoadFailure(500), 'error');
});

test('consent from the reader counts only for the exact version held by signup', () => {
  assert.equal(consentFromReader({ kind: 'TERMS', version: '0.2-draft' }, docs), 'TERMS');
  assert.equal(consentFromReader({ kind: 'PRIVACY', version: '0.2-draft' }, docs), 'PRIVACY');
  assert.equal(consentFromReader({ kind: 'TERMS', version: '0.1-draft' }, docs), null);
  assert.equal(consentFromReader({ kind: 'TERMS', version: '0.2-draft' }, null), null);
  assert.equal(consentFromReader(undefined, docs), null);
});

test('legal body formats into headings, bullets and paragraphs', () => {
  const b = parseLegalBody('DRAFT line one\ncontinues.\n\n# 1. Heading\nPara a\nPara b\n- item one\n- item two\n\n## Sub\r\nText');
  assert.deepEqual(b.map((x) => x.type), ['p', 'h1', 'p', 'li', 'li', 'h2', 'p']);
  assert.equal(b[0].text, 'DRAFT line one continues.'); assert.equal(b[2].text, 'Para a Para b');
  assert.deepEqual(parseLegalBody(''), []); assert.deepEqual(parseLegalBody(undefined), []);
  assert.equal(hasLegalPlaceholders('x [LEGAL TO SUPPLY: y]'), true); assert.equal(hasLegalPlaceholders('final text'), false);
});
