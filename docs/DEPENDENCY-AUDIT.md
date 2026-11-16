# Dependency audit status

Last checked 16 Nov 2026 with `npm audit --omit=dev` on commit `ed09ba9`. **Not security-clean: 8 findings remain (3 high, 5 moderate), all deliberately deferred.**
CI runs `npm audit` report-only; it does not fail the build.

## Overrides in the root `package.json` (why they exist)
| Override | Reason | Remove when |
|---|---|---|
| `@nestjs/platform-express` → `express` 4.22.3, `body-parser` 1.20.9, `multer` 2.5.0 | NestJS 10 pins exact vulnerable versions (express 4.22.1, body-parser 1.20.4, multer 2.0.2). `qs` follows via express (6.16.2). | NestJS is upgraded to a release that pins patched versions |
| `@nestjs/common` → `file-type` 21.3.4 | Nest 10.4.22 pins `file-type` 20.4.1 (vulnerable). Nest's `FileTypeValidator` was verified identical on both versions; the API does not use it. Deviates from Nest's declared exact pin. | NestJS upgrade |
| `next` → `postcss` 8.5.33 | Next 15.5.29 pins `postcss` 8.4.31 (vulnerable). Next 16 itself pins 8.5.23. Admin has no CSS pipeline of its own. | Next upgrade |

`@nestjs/config` was removed: it was never imported (the API has its own `ConfigModule` in `app.module.ts`).

## Remaining findings (8)
| Package | Severity | Cause | Why not fixed now |
|---|---|---|---|
| `@nestjs/core` 10.4.22 | moderate | GHSA-36xv-jgw5-4q75 (injection in output; fixed in 11.1.18+) | Needs NestJS 11 major upgrade (separate approval). Advisory text not reviewed in the sandbox. |
| `@nestjs/platform-express` 10.4.22 | moderate | depends on `@nestjs/core` | same |
| `prisma` 6.19.3, `@prisma/config` 6.19.3, `deepmerge-ts` 7.1.5 | high (3) | GHSA-ggr8-5vv4-36mx, stack exhaustion merging recursive objects; Prisma CLI/config time only | Needs `deepmerge-ts` 8 override (deferred; tested only with `prisma validate`) or Prisma 7 |
| `expo` 58.0.25, `@expo/fingerprint` 0.21.10, `minimatch` 10.2.6 | moderate (3) | GHSA-g3hv-75wg-m249; build tooling only | `minimatch` 11 is outside `@expo/fingerprint`'s accepted range; wait for upstream |
