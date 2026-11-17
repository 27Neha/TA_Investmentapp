import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadLocalEnv } from './load-env';

describe('loadLocalEnv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ta-env-'));
  const file = join(dir, '.env');
  const keys: string[] = [];
  beforeEach(() => { keys.forEach((k) => delete process.env[k]); writeFileSync(file, 'TA_TEST_A=from-file\nTA_TEST_B=from-file\n'); });
  afterAll(() => { keys.forEach((k) => delete process.env[k]); rmSync(dir, { recursive: true, force: true }); });

  it('loads values outside production', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
    expect(loadLocalEnv(env, file)).toBe(true);
    expect(env.TA_TEST_A).toBe('from-file');
  });
  it('never overrides an explicitly supplied variable', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'development', TA_TEST_A: 'explicit', TA_TEST_C: '' };
    writeFileSync(file, 'TA_TEST_A=from-file\nTA_TEST_B=from-file\nTA_TEST_C=from-file\n');
    loadLocalEnv(env, file);
    expect(env.TA_TEST_A).toBe('explicit');
    expect(env.TA_TEST_C).toBe('');
    expect(env.TA_TEST_B).toBe('from-file');
  });
  it('does nothing in production, even if a file exists', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    expect(loadLocalEnv(env, file)).toBe(false);
    expect(env.TA_TEST_A).toBeUndefined();
  });
  it('is a no-op when the file is missing', () => {
    expect(loadLocalEnv({ NODE_ENV: 'development' }, join(dir, 'nope.env'))).toBe(false);
  });
});
