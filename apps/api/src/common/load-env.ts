import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parseEnv } from 'util';

/**
 * Load a local `.env` file for development/test convenience (Node 22 built-in parser, no dependency).
 * - Never in production (NODE_ENV=production): real environments must inject variables explicitly.
 * - Never overrides a variable that is already set (including set to an empty string).
 * - A missing file is fine. Returns true only if a file was read.
 */
export function loadLocalEnv(env: NodeJS.ProcessEnv = process.env, file = resolve(process.cwd(), '.env')): boolean {
  if (env.NODE_ENV === 'production') return false;
  if (!existsSync(file)) return false;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (env[k] === undefined) env[k] = v;
  }
  return true;
}
