from __future__ import annotations

import subprocess

REGION = "ap-southeast-2"
OUTPUT_PAIR_FIELDS = 2

# One algorithmId reused across sizes; only the record count changes.
TRIAL_SAMPLE = "trial-eligibility-python"
TRIAL_ALGORITHM_ID = "e587067e-47dc-4835-8f87-5e66fc979adf"
TRIAL_SIZES = [10_000, 25_000, 50_000, 75_000, 100_000]

TREES = ("rads", "secure-rads")

STACKS = {
    "rads": {
        "registry": "rads-registry-service-dev",
        "pdm": "rads-pdm-service-dev",
        "execution": "rads-execution-service-dev",
    },
    "secure-rads": {
        "pdm": "secure-rads-pdm-service-dev",
        "execution": "secure-rads-execution-service-dev",
    },
}


def trial_dataset(size: int) -> str:
    return f"ehealth-{size // 1000}k"


def _aws(*args: str) -> str:
    out = subprocess.run(
        ["aws", *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def stack_outputs(stack: str) -> dict[str, str]:
    raw = _aws(
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        stack,
        "--region",
        REGION,
        "--query",
        "Stacks[0].Outputs[].[OutputKey,OutputValue]",
        "--output",
        "text",
    )
    outputs: dict[str, str] = {}
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) == OUTPUT_PAIR_FIELDS:
            outputs[parts[0]] = parts[1]
    return outputs


def csav_registry_url() -> str:
    # Stack public-IP output goes stale across stop/start; read the instance itself.
    instance_id = stack_outputs("secure-rads-csav").get("CsavInstanceId", "")
    if not instance_id:
        msg = "secure-rads-csav stack has no CsavInstanceId output"
        raise RuntimeError(msg)
    ip = _aws(
        "ec2",
        "describe-instances",
        "--region",
        REGION,
        "--instance-ids",
        instance_id,
        "--query",
        "Reservations[0].Instances[0].PublicIpAddress",
        "--output",
        "text",
    )
    if not ip or ip == "None":
        msg = f"CSAV instance {instance_id} has no public IP (is it running?)"
        raise RuntimeError(msg)
    return f"http://{ip}:8080"


def resolve_endpoints(*, include_secure_registry: bool = True) -> dict[str, dict[str, str]]:
    endpoints: dict[str, dict[str, str]] = {}
    for tree, stacks in STACKS.items():
        endpoints[tree] = {}
        for service, stack in stacks.items():
            outputs = stack_outputs(stack)
            endpoints[tree][service] = outputs.get("HttpApiUrl") or f"https://{outputs['ApiRegionalDomainName']}"
    if include_secure_registry:
        endpoints["secure-rads"]["registry"] = csav_registry_url()
    return endpoints
