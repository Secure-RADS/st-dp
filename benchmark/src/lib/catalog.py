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
    # Env var holding the caller-facing hostname, for stacks whose URL is a custom domain.
    host_env: str | None = None
    # Stack output that holds the URL, when it is not HttpApiUrl.
    url_output: str = "HttpApiUrl"


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
        "telemetry": ApiGatewayService(
            stack="rads-telemetry-service-dev",
            host_env="TELEMETRY_HOST_RADS",
        ),
        "cost": ApiGatewayService(stack="rads-cost-service-dev"),
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
        "result_consumer": ApiGatewayService(
            stack="secure-rads-result-consumer-dev",
            url_output="ResultWebhookUrl",
        ),
        "log": ApiGatewayService(
            stack="secure-rads-log-service-dev",
            host_env="LOG_HOST_SECURE_RADS",
        ),
        "telemetry": ApiGatewayService(
            stack="secure-rads-telemetry-service-dev",
            host_env="TELEMETRY_HOST_SECURE_RADS",
        ),
        "cost": ApiGatewayService(stack="secure-rads-cost-service-dev"),
        "registry_storage": ApiGatewayService(
            stack="secure-rads-registry-service-storage",
            has_url=False,
        ),
    },
}
