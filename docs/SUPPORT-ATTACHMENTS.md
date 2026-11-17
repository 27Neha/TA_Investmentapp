# Support attachments

Status: built and tested against a **fake** storage adapter. Not verified against the real Supabase project. No Zoho Desk forwarding.

## What the user can do (mobile, ticket detail screen)
Choose one PDF, PNG or JPEG (max 5 MB, max 3 files per request), see upload progress, cancel, see a specific error if it fails, and later open the file. The phone checks type and size first for quick feedback; the server re-checks everything.

## API
| Call | Behaviour |
|---|---|
| `POST /v1/me/support/tickets/:id/attachments` (multipart `file`, optional `messageId`) | Owner only. 404 for any ticket that is not yours, 409 `TICKET_CLOSED`, 409 `TOO_MANY_ATTACHMENTS`, 413 over 5 MB, 400 `ATTACHMENT_<CODE>`, 503 `STORAGE_NOT_CONFIGURED` / `STORAGE_ERROR` / `STORAGE_BUCKET_PUBLIC`. Throttled to 10/min. |
| `GET /v1/me/support/attachments/:id/url` | Owner only, STORED files only. Returns a signed URL valid 300 s; issuing it is audited (`SUPPORT_ATTACHMENT_LINK_ISSUED`). |
| `GET /v1/me/support/status` | `attachmentsAvailable`, limits and allowed types (the app hides upload when unavailable). |

Error codes: `TOO_LARGE`, `EMPTY`, `TYPE_NOT_ALLOWED`, `CONTENT_MISMATCH` (wrong signature), `CONTENT_INVALID` (truncated/damaged), `ACTIVE_CONTENT` (PDF with JavaScript, launch actions or embedded files), `BAD_NAME`.

## Security model
- Files live only in the existing **private** Supabase bucket. The adapter refuses to store or sign anything unless the bucket reports `public: false` (re-checked every 5 minutes).
- The Supabase service-role key exists only in the API environment. The app sends only the user's own access token to the API and receives only a short-lived signed URL.
- The storage key is built from server ids (`<userId>/<ticketId>/<uuid>.<ext>`); the client's file name is sanitised and kept only as a display label.
- Content validation is structural (signature, PNG chunks, JPEG markers, PDF header/trailer, active-content names including `#xx` obfuscation). **It is not malware scanning.** If you need AV scanning, that is a separate provider decision.
- Metadata (name, detected MIME, size, SHA-256, key, status) is in PostgreSQL (`SupportAttachment`), linked to a `SupportMessage` of the ticket. Detail responses never include the key or hash.
- Logs contain no file names, bytes, storage keys or signed URLs (covered by a test).
- If the object upload fails the new message is removed; if the metadata insert fails the stored object is removed.

## Not done / needs you
- Verify against the real bucket: upload, signed URL expiry, bucket-privacy endpoint response shape (`GET /storage/v1/bucket/<id>` is written from the documented API, unverified).
- Forwarding attachments to Zoho Desk (needs a verified Desk upload API and a decision on retention).
- Retention/deletion of stored files (documented in `RETENTION-CONFIGURATION.md`, no deletion job).
- Testing on a real Android device (file picker, share/open of signed URLs).
