# Case read authentication hardening

The Vercel read endpoints `/api/cases` and `/api/cases/[recordId]` require a valid Supabase bearer token before using the server-side privileged client. Internal configuration details and raw exception messages are no longer returned to callers.
