import json
import sys


def read(path: str) -> str:
    try:
        with open(path, "rb") as handle:
            return handle.read().decode("utf-8", "replace")
    except FileNotFoundError:
        return ""


def main() -> None:
    status, instance_id, result_path, output_path, load_path, run_id, algorithm_id = sys.argv[1:8]
    output = read(result_path) or read(output_path)
    diag = {"dockerLoad": read(load_path)} if not output else {}
    print(
        json.dumps(
            {
                "runId": run_id,
                "algorithmId": algorithm_id,
                "instanceId": instance_id,
                "status": "exit:" + status,
                "output": output,
                "diag": diag,
            }
        )
    )


if __name__ == "__main__":
    main()
