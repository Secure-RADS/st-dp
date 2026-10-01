from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from lib.tree import Tree


class ServiceKind(StrEnum):
    API_GATEWAY = "api_gateway"
    EC2_HTTP = "ec2_http"


class ApiGatewayService(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal[ServiceKind.API_GATEWAY] = ServiceKind.API_GATEWAY
    stack: str
    # False for stacks that only expose CFN outputs (e.g. Dynamo table names), not an HTTP API.
    has_url: bool = True


class Ec2HttpService(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal[ServiceKind.EC2_HTTP] = ServiceKind.EC2_HTTP
    stack: str
    # CFN output that holds the instance id; URL is built from the live public IP.
    instance_id_key: str
    port: int
    scheme: str
    has_url: bool = True


Service = Annotated[ApiGatewayService | Ec2HttpService, Field(discriminator="kind")]


# Per-tree service catalog. Resolve once at flow start; no one-off include_* flags.
CATALOG: dict[Tree, dict[str, ApiGatewayService | Ec2HttpService]] = {
    Tree.RADS: {
        "registry": ApiGatewayService(stack="rads-registry-service-dev"),
        "pdm": ApiGatewayService(stack="rads-pdm-service-dev"),
        "execution": ApiGatewayService(stack="rads-execution-service-dev"),
        "log": ApiGatewayService(stack="rads-log-service-dev"),
    },
    Tree.SECURE_RADS: {
        "registry": Ec2HttpService(
            stack="secure-rads-csav",
            instance_id_key="CsavInstanceId",
            port=8080,
            scheme="http",
        ),
        "pdm": ApiGatewayService(stack="secure-rads-pdm-service-dev"),
        "execution": ApiGatewayService(stack="secure-rads-execution-service-dev"),
        "log": ApiGatewayService(stack="secure-rads-log-service-dev"),
        "registry_storage": ApiGatewayService(
            stack="secure-rads-registry-service-storage",
            has_url=False,
        ),
    },
}
