# trial-eligibility-ruby

Sample rads Data Controller app (Ruby stdlib only). Reads `PDM_URL` and `ALGORITHM_ID` from
the environment, GETs every record for that algorithm from the PDM - following the `nextCursor`
pagination returned per page until there is none - and prints a single JSON summary to stdout.
The aggregation is identical to the secure-rads `trial-eligibility-ruby`; only the I/O differs:
it fetches its own records over plain HTTP instead of receiving them from sce-unit over a
Unix socket. Progress lines go to stderr so stdout holds exactly one JSON object.

```json
{"algorithmId": "e587067e-47dc-4835-8f87-5e66fc979adf", "userCount": 10000, "eligibleCount": 282, "eligiblePct": 2.82, "exclusionBreakdown": {}, "eligibleRecordIds": []}
```

Build and run:

```
docker build -t trial-eligibility-ruby .
docker run --rm -e PDM_URL=https://pdm.r.secure-rads.org \
                 -e ALGORITHM_ID=e587067e-47dc-4835-8f87-5e66fc979adf \
                 trial-eligibility-ruby
```