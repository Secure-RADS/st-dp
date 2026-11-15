# rads-transparency-portal

Vite + React + TypeScript + Tailwind + shadcn/ui SPA that gives two audiences visibility into the rads workflow:

- **Data subject** (`/subject`) - a person enters their `dataSubjectId` (the opaque UUID stored alongside each personal-data record) and sees which algorithms and runs used their records. It returns usage metadata only, never personal data.
- **Service authority** (`/authority`) - an EU-style regulator sees everything: per-algorithm run timelines, PDM subject-access events, a data-subject lookup, failed runs, aggregate stats, and CSV/JSON export.

## Data flow

The data-subject view deliberately goes through the PDM, not straight to the log service:

```text
browser -> GET https://pdm.r.secure-rads.org/subject/{dataSubjectId}
        -> GET https://log.r.secure-rads.org/subject-access/{dataSubjectId}
```

The authority view reads `log.r.secure-rads.org` directly (`/logs`, `/subject-access`). Both APIs send permissive CORS headers (`httpApi.cors: true` in each `serverless.yml`).

The rads host records a subject-access entry (algorithm, run, timestamp, data subject) after a successful DC app run, using the data subject ids PDM returned for that run, so the trail reflects runs that actually reached the application.

## Configuration

Build-time Vite variables, defaulting to the deployed domains if unset:

| Variable | Default |
| --- | --- |
| `VITE_LOG_SERVICE_URL` | `https://log.r.secure-rads.org` |
| `VITE_PDM_URL` | `https://pdm.r.secure-rads.org` |

## Develop

```sh
bun install
bun run dev
```

## Deploy

Hosted on S3 + CloudFront behind `transparency.r.secure-rads.org`, with a dedicated us-east-1 ACM certificate (see `CERT_ARN` in the `Makefile`).

```sh
make -C rads/transparency-portal deploy-infra   # one-time: S3 + CloudFront + DNS target
make -C rads/transparency-portal deploy         # build, upload, invalidate
```

Or from the repo root: `make rads-portal-deploy`.

After `deploy-infra`, create a DNS-only Cloudflare CNAME from `transparency.r.secure-rads.org` to the `DistributionDomainName` output.
