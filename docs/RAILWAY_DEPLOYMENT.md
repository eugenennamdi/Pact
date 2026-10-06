# Railway deployment baseline

Phase 7B prepares, but does not provision, a four-service Railway project:
`pact-web`, `pact-verifier`, `pact-relay`, and PostgreSQL 16. All application
services use this repository root. Run `npm run product:migrate` exactly once
before starting application services.

| Service         | Build command   | Start command                                     | Health path   |
| --------------- | --------------- | ------------------------------------------------- | ------------- |
| `pact-web`      | `npm run build` | `npm run web:start`                               | `/api/health` |
| `pact-verifier` | `npm run build` | `npm run start --workspace=@pact/worker-verifier` | `/health`     |
| `pact-relay`    | `npm run build` | `npm run start --workspace=@pact/worker-relay`    | `/health`     |

Railway supplies `PORT`; each service must use that variable. The web and both
worker listeners bind for Railway health checks. Do not create public domains
for worker services. Use restart-on-failure for all three processes.

Deploy exactly one web replica. The current HTTP rate limiter is process-local,
so horizontal web scaling requires a separately reviewed shared limiter. One web
process, one verifier, and one relay each retain the existing maximum pool of
five connections, for an application ceiling of 15. Provision at least 20 usable
PostgreSQL connections, preferably more for migration and administrative
headroom.

`PACT_PUBLIC_ORIGIN` remains an environment setting containing the actual HTTPS
origin. The same origin serves the web app and `/api/v1/*`; do not broaden CORS.
The web service has no signer keys. The verifier has only the verifier key and a
low-privilege server-side GitHub token. The relay has only the relay key and no
GitHub token. Both workers remain pinned to the certified Arc Testnet deployment
manifest and chain ID `5042002`.
