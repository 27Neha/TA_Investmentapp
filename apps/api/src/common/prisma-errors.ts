/** True for a PostgreSQL unique-constraint violation surfaced by Prisma (code P2002), including via driver adapters. */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'P2002' || (e as { cause?: { originalCode?: string } } | null)?.cause?.originalCode === '23505';
}
