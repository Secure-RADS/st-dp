# transparency-portal

Vite + React + TypeScript + Tailwind + shadcn/ui SPA that gives two audiences visibility into the Secure RADS workflow:

- **Data subject** (`/subject`) - a person enters their `dataSubjectId` (the opaque UUID stored alongside each personal-data record) and sees which algorithms and runs used their records. It returns usage metadata only, never personal data.
- **Service authority** (`/authority`) - an EU-style regulator sees everything: per-algorithm run timelines, PDM subject-access events, a data-subject lookup, failed runs, aggregate stats, and CSV/JSON export.

## Data flow

The data-subject view deliberately goes through the PDM, not straight to the log service:

```
browser -> GET https://pdm.sr.secure-rads.org/subject/{dataSubjectId}
        -> GET https://log.sr.secure-rads.org/subject-access?dataSubjectId=...
```

The authority view reads `log.sr.secure-rads.org` directly (`/logs`, `/subject-access`). Both APIs send permissive CORS headers (`httpApi.cors: true` in each `serverless.yml`).

`pdm-service` records a subject-access entry (algorithm, run, timestamp, data subject) every time it serves records to an enclave, so the trail is produced by the data access itself, not by the UI.

## Configuration

Build-time Vite variables, defaulting to the deployed domains if unset:

| Variable | Default |
| --- | --- |
| `VITE_LOG_SERVICE_URL` | `https://log.sr.secure-rads.org` |
| `VITE_PDM_URL` | `https://pdm.sr.secure-rads.org` |

## Develop

```
bun install
bun run dev
```

## Deploy

Hosted on S3 + CloudFront behind `transparency.sr.secure-rads.org`. The CloudFront certificate must exist in `us-east-1` (see `CERT_ARN` in the `Makefile`).

```
make -C secure/transparency-portal deploy-infra   # one-time: S3 + CloudFront + DNS target
make -C secure/transparency-portal deploy         # build, upload, invalidate
```

Or from the repo root: `make portal-deploy`.

After `deploy-infra`, create a DNS-only Cloudflare CNAME from `transparency.sr.secure-rads.org` to the `DistributionDomainName` output.
