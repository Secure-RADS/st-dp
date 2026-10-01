from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from lib.tree import Tree


class ServiceKind(StrEnum):
    API_GATEWAY = "api_gateway"
    EC2_HTTP = "ec2_http"


@dataclass(frozen=True)
class Service:
    kind: ServiceKind
    stack: str
    # EC2_HTTP: CFN output that holds the instance id; URL is built from the live public IP.
    instance_id_key: str = "CsavInstanceId"
    port: int = 8080
    scheme: str = "http"
    # False for stacks that only expose CFN outputs (e.g. Dynamo table names), not an HTTP API.
    has_url: bool = True


# Per-tree service catalog. Resolve once at flow start; no one-off include_* flags.
CATALOG: dict[Tree, dict[str, Service]] = {
    Tree.RADS: {
        "registry": Service(ServiceKind.API_GATEWAY, "rads-registry-service-dev"),
        "pdm": Service(ServiceKind.API_GATEWAY, "rads-pdm-service-dev"),
        "execution": Service(ServiceKind.API_GATEWAY, "rads-execution-service-dev"),
        "log": Service(ServiceKind.API_GATEWAY, "rads-log-service-dev"),
    },
    Tree.SECURE_RADS: {
        "registry": Service(ServiceKind.EC2_HTTP, "secure-rads-csav"),
        "pdm": Service(ServiceKind.API_GATEWAY, "secure-rads-pdm-service-dev"),
        "execution": Service(ServiceKind.API_GATEWAY, "secure-rads-execution-service-dev"),
        "log": Service(ServiceKind.API_GATEWAY, "secure-rads-log-service-dev"),
        "registry_storage": Service(
            ServiceKind.API_GATEWAY,
            "secure-rads-registry-service-storage",
            has_url=False,
        ),
    },
}
