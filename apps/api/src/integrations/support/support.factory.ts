import { SupportPort, UnconfiguredSupport } from './support.port';
import { ZohoDeskAdapter } from './zoho-desk.adapter';

const REQUIRED = ['ZOHO_DESK_ORG_ID', 'ZOHO_DESK_CLIENT_ID', 'ZOHO_DESK_CLIENT_SECRET', 'ZOHO_DESK_REFRESH_TOKEN', 'ZOHO_DESK_ACCOUNTS_URL', 'ZOHO_DESK_API_URL', 'ZOHO_DESK_DEPARTMENT_ID'] as const;

/**
 * Selects the support adapter from configuration. Rules: default is "none" (fails closed); a partial Zoho configuration
 * is a startup error in production and an "unconfigured" adapter elsewhere; test fakes are never constructed here.
 */
export function createSupportPort(env: NodeJS.ProcessEnv, isProd: boolean): SupportPort {
  const provider = env.SUPPORT_PROVIDER ?? 'none';
  if (provider === 'none') return new UnconfiguredSupport();
  if (provider !== 'zoho_desk') throw new Error(`Unknown SUPPORT_PROVIDER "${provider}" (use none | zoho_desk)`);
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    if (isProd) throw new Error(`SUPPORT_PROVIDER=zoho_desk requires: ${missing.join(', ')}`);
    return new UnconfiguredSupport();
  }
  return new ZohoDeskAdapter({
    orgId: env.ZOHO_DESK_ORG_ID!, clientId: env.ZOHO_DESK_CLIENT_ID!, clientSecret: env.ZOHO_DESK_CLIENT_SECRET!, refreshToken: env.ZOHO_DESK_REFRESH_TOKEN!,
    accountsUrl: env.ZOHO_DESK_ACCOUNTS_URL!.replace(/\/$/, ''), apiUrl: env.ZOHO_DESK_API_URL!.replace(/\/$/, ''), departmentId: env.ZOHO_DESK_DEPARTMENT_ID!,
    webhookId: env.ZOHO_DESK_WEBHOOK_ID || undefined, webhookEnabled: env.ZOHO_DESK_WEBHOOK_ENABLED === 'true',
  });
}
