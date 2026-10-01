#!/usr/bin/env python3
"""Render cloudformation.yaml with UserData from userdata.sh.tmpl + repo compose/unit files."""

from __future__ import annotations

import argparse
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLACEHOLDER = "          @@USERDATA@@"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("/tmp/secure-rads-csav-cloudformation.yaml"),
        help="rendered template path (default: /tmp/secure-rads-csav-cloudformation.yaml)",
    )
    args = parser.parse_args()

    compose = (HERE / "docker-compose.yml").read_text()
    unit = (HERE / "csav-registry.service").read_text()
    script = (HERE / "userdata.sh.tmpl").read_text()
    script = script.replace("@@DOCKER_COMPOSE@@", compose.rstrip("\n"))
    script = script.replace("@@SYSTEMD_UNIT@@", unit.rstrip("\n"))

    # Indent for the YAML block scalar under UserData / Fn::Base64.
    indented = "\n".join(
        f"          {line}" if line else "" for line in script.splitlines()
    )

    tmpl = (HERE / "cloudformation.yaml.tmpl").read_text()
    if PLACEHOLDER not in tmpl:
        raise SystemExit(f"missing {PLACEHOLDER!r} in cloudformation.yaml.tmpl")
    rendered = tmpl.replace(PLACEHOLDER, indented)

    args.out.write_text(rendered + ("" if rendered.endswith("\n") else "\n"))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
