import type { PoolConfig } from 'pg';

/**
 * Builds node-postgres pool config from a Prisma-style DATABASE_URL.
 * - Strips Prisma-only query params (pgbouncer, connection_limit, pool_timeout, schema)
 *   that node-postgres does not understand; connection_limit -> pool max.
 * - TLS: verified by default for any non-local host. Supabase's CA is not in the default
 *   trust store, so supply it via DATABASE_SSL_CA (PEM). Verification is never silently
 *   disabled; sslmode=disable is honoured only for localhost/unix-socket targets.
 */
export function buildPgConfig(
  rawUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  if (!rawUrl) throw new Error('DATABASE_URL is not set');
  const url = new URL(rawUrl);
  const params = url.searchParams;
  const limit = Number(params.get('connection_limit'));
  const sslmode = params.get('sslmode');
  for (const k of ['pgbouncer', 'connection_limit', 'pool_timeout', 'schema', 'sslmode', 'connect_timeout']) {
    params.delete(k);
  }
  const host = url.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '' || rawUrl.includes('host=/');
  const cfg: PoolConfig = {
    connectionString: url.toString(),
    max: Number.isFinite(limit) && limit > 0 ? limit : Number(env.DATABASE_POOL_MAX) || 10,
    connectionTimeoutMillis: Number(env.DATABASE_CONNECT_TIMEOUT_MS) || 10_000,
    idleTimeoutMillis: 30_000,
  };
  if (local && (sslmode === 'disable' || sslmode === null)) {
    cfg.ssl = false;
  } else if (sslmode === 'disable') {
    throw new Error('sslmode=disable is only allowed for local databases');
  } else {
    cfg.ssl = env.DATABASE_SSL_CA
      ? { ca: env.DATABASE_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
      : { rejectUnauthorized: true };
  }
  return cfg;
}
