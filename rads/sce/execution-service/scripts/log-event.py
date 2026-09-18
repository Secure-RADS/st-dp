import datetime
import json
import sys


def main() -> None:
    status, instance_id, algorithm_id, run_id = sys.argv[1:5]
    print(
        json.dumps(
            {
                "algorithmId": algorithm_id,
                "runId": run_id,
                "event": "executor-finished",
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "detail": {"status": "exit:" + status, "instanceId": instance_id},
            }
        )
    )


if __name__ == "__main__":
    main()
