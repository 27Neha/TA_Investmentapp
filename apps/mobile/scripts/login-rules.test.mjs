// Plain-Node checks for the login rules. Run: npm run test:signup
import test from 'node:test';
import assert from 'node:assert/strict';
import { loginErrorKey, validateLogin } from '../src/lib/login-rules.ts';
import { legalLoadFailure, signupErrorKey } from '../src/lib/signup-rules.ts';

test('login validates email and password before any request', () => {
  assert.deepEqual(validateLogin('a@b.co', 'x'), {});
  assert.deepEqual(validateLogin('', ''), { email: 'login.err.emailRequired', password: 'login.err.passwordRequired' });
  assert.deepEqual(validateLogin('not-an-email', 'x'), { email: 'signup.err.email' });
  assert.deepEqual(validateLogin('  a@b.co  ', 'x'), {});
});
test('login failures map to friendly messages; wrong credentials keep the server message', () => {
  assert.equal(loginErrorKey(0), 'common.error.network');
  assert.equal(loginErrorKey(404, 'ROUTE_NOT_FOUND'), 'common.error.staleBackend');
  assert.equal(loginErrorKey(429), 'signup.err.rate'); assert.equal(loginErrorKey(503), 'signup.err.generic');
  assert.equal(loginErrorKey(400), 'login.err.badInput');
  assert.equal(loginErrorKey(401), null); assert.equal(loginErrorKey(403, 'EMAIL_NOT_VERIFIED'), null);
});
test('a backend without the route is recognised on signup and document loading too', () => {
  assert.equal(signupErrorKey(404, 'ROUTE_NOT_FOUND'), 'common.error.staleBackend');
  assert.equal(legalLoadFailure(404, 'ROUTE_NOT_FOUND'), 'stale');
  assert.equal(legalLoadFailure(404, 'LEGAL_NOT_AVAILABLE'), 'unavailable');
});
