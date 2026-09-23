# trial-eligibility-python

Sample Data Controller app (Python, pydantic models). Listens on
`/run/sce/dc.sock`, receives one JSON line of health records (per-user PII,
demographics, conditions, medications, and lab values), and screens for a
synthetic type-2-diabetes trial: eligible iff age 40-75, HbA1c 7.0-10.0,
eGFR >= 45, no "ckd" condition, and BMI 25-40. Reports eligible count and
percentage, a per-criterion exclusion breakdown (each failed criterion
counted independently), and the first 50 eligible record ids. PII fields
are ignored by the computation.

`SCE_SOCKET_PATH` overrides the socket path for local testing.

Build:

```
docker build --platform linux/arm64 -t trial-eligibility-python sample/trial-eligibility-python
```
