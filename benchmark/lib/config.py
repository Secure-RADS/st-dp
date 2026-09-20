"""Shared configuration for the secure-rads vs rads benchmark.

Fleet-wide constants (algorithm ids, sample apps) mirror the root Makefile and
seeding/config.ts. Deployed endpoints are resolved from live CloudFormation
outputs at runtime, not hardcoded, so the harness follows the stacks.
"""

from __future__ import annotations

import subprocess

REGION = "ap-southeast-2"

# Field counts for the tab-separated `aws --output text` rows parsed below.
OUTPUT_PAIR_FIELDS = 2
INSTANCE_ROW_FIELDS = 3

# One algorithmId per dataset, fixed so seed/build/run line up (seeding/config.ts).
SAMPLES = [
    ("health-risk-python", "health", "662fa378-dc53-425d-9225-a187b11ea7dc"),
    ("spend-analysis-go", "finance", "c7cc14fa-e962-4548-aff4-a54148798cd8"),
    ("product-trends-node", "ecommerce", "3b8bba4a-8106-4309-9446-7bce99a1453a"),
    ("audience-segments-rust", "social", "e4082659-08d6-4f0a-9e60-327e9410c710"),
    ("trial-eligibility-ruby", "ehealth", "e587067e-47dc-4835-8f87-5e66fc979adf"),
]

DATASET_SIZES = {"health": 250, "finance": 1000, "ecommerce": 2500, "social": 5000, "ehealth": 10000}

TREES = ("rads", "secure-rads")

STACKS = {
    "rads": {
        "registry": "rads-registry-service-dev",
        "log": "rads-log-service-dev",
        "pdm": "rads-pdm-service-dev",
        "execution": "rads-execution-service-dev",
    },
    "secure-rads": {
        "log": "secure-rads-log-service-dev",
        "pdm": "secure-rads-pdm-service-dev",
        "execution": "secure-rads-execution-service-dev",
    },
}


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
    """secure-rads' registry-service is the Go service on the CSAV host, not a CFN stack.

    The stack's public-IP output goes stale across stop/start, so the IP is read from
    the instance itself.
    """
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
    """Resolve the live API URLs for both trees from CloudFormation outputs.

    Args:
        include_secure_registry: Secure-rads' registry is the Go service on the CSAV
            host, so resolving it requires that instance to be running. Read-only
            tooling passes False so it still works with the host stopped.

    Returns:
        Mapping of tree -> service -> URL.
    """
    endpoints: dict[str, dict[str, str]] = {}
    for tree, stacks in STACKS.items():
        endpoints[tree] = {}
        for service, stack in stacks.items():
            outputs = stack_outputs(stack)
            url = outputs.get("HttpApiUrl") or f"https://{outputs['ApiRegionalDomainName']}"
            endpoints[tree][service] = url
            if service == "registry":
                endpoints[tree]["registry_bucket"] = outputs["ImagesBucketName"]
    if include_secure_registry:
        endpoints["secure-rads"]["registry"] = csav_registry_url()
    return endpoints


def ec2_instances() -> list[dict[str, str]]:
    raw = _aws(
        "ec2",
        "describe-instances",
        "--region",
        REGION,
        "--filters",
        "Name=instance-state-name,Values=pending,running,stopping,stopped",
        "--query",
        "Reservations[].Instances[].[InstanceId,State.Name,Tags[?Key=='Name']|[0].Value]",
        "--output",
        "text",
    )
    rows = []
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) == INSTANCE_ROW_FIELDS:
            rows.append({"instanceId": parts[0], "state": parts[1], "name": parts[2]})
    return rows
