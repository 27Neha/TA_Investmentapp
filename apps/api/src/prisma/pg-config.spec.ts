import { buildPgConfig } from './pg-config';

describe('buildPgConfig', () => {
  it('requires a URL', () => expect(() => buildPgConfig(undefined, {})).toThrow());
  it('strips prisma-only params and maps connection_limit', () => {
    const c = buildPgConfig('postgresql://u:p@db.example.com:6543/postgres?pgbouncer=true&connection_limit=5', {});
    expect(c.max).toBe(5);
    expect(c.connectionString).not.toContain('pgbouncer');
    expect(c.connectionString).not.toContain('connection_limit');
  });
  it('verifies TLS for remote hosts by default', () => {
    const c = buildPgConfig('postgresql://u:p@db.example.com:5432/postgres', {});
    expect(c.ssl).toEqual({ rejectUnauthorized: true });
  });
  it('uses supplied CA with verification on', () => {
    const c = buildPgConfig('postgresql://u:p@db.example.com:5432/postgres', { DATABASE_SSL_CA: 'PEM\\nDATA' });
    expect(c.ssl).toEqual({ ca: 'PEM\nDATA', rejectUnauthorized: true });
  });
  it('refuses sslmode=disable for remote hosts', () => {
    expect(() => buildPgConfig('postgresql://u:p@db.example.com/postgres?sslmode=disable', {})).toThrow(/local/);
  });
  it('allows plain connection to localhost', () => {
    expect(buildPgConfig('postgresql://u:p@localhost:5432/ta_test', {}).ssl).toBe(false);
  });
});
