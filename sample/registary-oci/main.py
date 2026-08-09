import grp
import json
import os
import pwd
import socket
import subprocess

SOCKET_PATH = "/run/sce/dc.sock"


def decode_caps(hex_mask):
    # capsh knows the real capability set for this kernel/libcap - no hardcoded list to keep in sync.
    out = subprocess.run(
        ["capsh", "--decode=" + hex_mask], capture_output=True, text=True, check=True
    ).stdout.strip()
    names = out.split("=", 1)[1] if "=" in out else ""
    return [n.upper() for n in names.split(",") if n]


def read_status():
    fields = {}
    with open("/proc/self/status") as f:
        for line in f:
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip()
    return fields


def read_mounts():
    with open("/proc/mounts") as f:
        return [line.split()[1] for line in f]


def username(uid):
    try:
        return pwd.getpwuid(uid).pw_name
    except KeyError:
        return None


def groupname(gid):
    try:
        return grp.getgrgid(gid).gr_name
    except KeyError:
        return None


def probe_writable(paths):
    writable = []
    for path in paths:
        try:
            probe = os.path.join(path, ".registary-oci-write-probe")
            with open(probe, "w"):
                pass
            os.remove(probe)
            writable.append(path)
        except OSError:
            pass
    return writable


def build_report():
    status = read_status()
    uid = os.getuid()
    gid = os.getgid()

    return {
        "uid": uid,
        "gid": gid,
        "user": username(uid),
        "group": groupname(gid),
        "groups": [
            {"gid": g, "name": groupname(g)} for g in os.getgroups()
        ],
        "is_root": uid == 0,
        "writable_paths": probe_writable(["/", "/etc", "/root", "/tmp", "/var"]),
        "capabilities": {
            "effective": decode_caps(status.get("CapEff", "0")),
            "permitted": decode_caps(status.get("CapPrm", "0")),
            "inheritable": decode_caps(status.get("CapInh", "0")),
            "bounding": decode_caps(status.get("CapBnd", "0")),
        },
        "seccomp": status.get("Seccomp"),
        "mounts": read_mounts(),
        "env": dict(os.environ),
    }


def main():
    # /run/sce is bind-mounted in by nsjail (shared with the SCE Unit
    # outside the jail) - the socket file itself is created here, once we're
    # actually running, since nsjail's mounts are set up before this starts.
    if os.path.exists(SOCKET_PATH):
        os.remove(SOCKET_PATH)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET_PATH)
    server.listen(1)

    conn, _ = server.accept()
    with conn:
        request = conn.recv(4096)
        if not request:
            return
        response = json.dumps(build_report()) + "\n"
        conn.sendall(response.encode())


if __name__ == "__main__":
    main()
