from __future__ import annotations

import subprocess

from lib.catalog import CATALOG, ApiGatewayService, Ec2HttpService, ServiceKind
from lib.tree import Tree

REGION = "ap-southeast-2"
OUTPUT_PAIR_FIELDS = 2

# One algorithmId reused across sizes; only the record count changes at execute time.
TRIAL_SAMPLE = "trial-eligibility-python"
TRIAL_ALGORITHM_ID = "e587067e-47dc-4835-8f87-5e66fc979adf"
TRIAL_DATASET = "ehealth"
TRIAL_SIZES = list(range(10_000, 100_000 + 1, 10_000))

TREES = tuple(Tree)


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


def _api_gateway_url(outputs: dict[str, str]) -> str:
    if url := outputs.get("HttpApiUrl"):
        return url
    domain = outputs.get("ApiRegionalDomainName")
    if not domain:
        msg = "stack outputs missing HttpApiUrl and ApiRegionalDomainName"
        raise RuntimeError(msg)
    return f"https://{domain}"


def _ec2_http_url(service: Ec2HttpService, outputs: dict[str, str]) -> str:
    # Stack public-IP output goes stale across stop/start; read the instance itself.
    instance_id = outputs.get(service.instance_id_key, "")
    if not instance_id:
        msg = f"{service.stack} has no {service.instance_id_key} output"
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
    return f"{service.scheme}://{ip}:{service.port}"


def _service_url(service: ApiGatewayService | Ec2HttpService, outputs: dict[str, str]) -> str:
    if service.kind is ServiceKind.API_GATEWAY:
        return _api_gateway_url(outputs)
    if service.kind is ServiceKind.EC2_HTTP:
        return _ec2_http_url(service, outputs)
    msg = f"unknown service kind {service.kind!r}"
    raise ValueError(msg)


def resolve(
    trees: tuple[Tree, ...] | list[Tree] | None = None,
) -> tuple[dict[Tree, dict[str, str]], dict[Tree, dict[str, dict[str, str]]]]:
    """Resolve catalog entries once. Returns (urls_by_tree, outputs_by_tree_service)."""
    selected = tuple(trees) if trees is not None else TREES
    urls: dict[Tree, dict[str, str]] = {}
    outputs: dict[Tree, dict[str, dict[str, str]]] = {}
    for tree in selected:
        urls[tree] = {}
        outputs[tree] = {}
        for name, service in CATALOG[tree].items():
            stack_out = stack_outputs(service.stack)
            outputs[tree][name] = stack_out
            if service.has_url:
                urls[tree][name] = _service_url(service, stack_out)
    return urls, outputs
