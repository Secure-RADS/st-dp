from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict

from lib.tree import Tree


class ServiceKind(StrEnum):
    API_GATEWAY = "api_gateway"
    EC2_HTTP = "ec2_http"


class Service(BaseModel):
    model_config = ConfigDict(frozen=True)

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
        "registry": Service(kind=ServiceKind.API_GATEWAY, stack="rads-registry-service-dev"),
        "pdm": Service(kind=ServiceKind.API_GATEWAY, stack="rads-pdm-service-dev"),
        "execution": Service(kind=ServiceKind.API_GATEWAY, stack="rads-execution-service-dev"),
        "log": Service(kind=ServiceKind.API_GATEWAY, stack="rads-log-service-dev"),
    },
    Tree.SECURE_RADS: {
        "registry": Service(kind=ServiceKind.EC2_HTTP, stack="secure-rads-csav"),
        "pdm": Service(kind=ServiceKind.API_GATEWAY, stack="secure-rads-pdm-service-dev"),
        "execution": Service(kind=ServiceKind.API_GATEWAY, stack="secure-rads-execution-service-dev"),
        "log": Service(kind=ServiceKind.API_GATEWAY, stack="secure-rads-log-service-dev"),
        "registry_storage": Service(
            kind=ServiceKind.API_GATEWAY,
            stack="secure-rads-registry-service-storage",
            has_url=False,
        ),
    },
}
