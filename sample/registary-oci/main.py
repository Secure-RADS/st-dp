import grp
import json
import os
import pwd

# Linux capability bit -> name, per include/uapi/linux/capability.h.
CAPABILITIES = [
    "CAP_CHOWN", "CAP_DAC_OVERRIDE", "CAP_DAC_READ_SEARCH", "CAP_FOWNER",
    "CAP_FSETID", "CAP_KILL", "CAP_SETGID", "CAP_SETUID", "CAP_SETPCAP",
    "CAP_LINUX_IMMUTABLE", "CAP_NET_BIND_SERVICE", "CAP_NET_BROADCAST",
    "CAP_NET_ADMIN", "CAP_NET_RAW", "CAP_IPC_LOCK", "CAP_IPC_OWNER",
    "CAP_SYS_MODULE", "CAP_SYS_RAWIO", "CAP_SYS_CHROOT", "CAP_SYS_PTRACE",
    "CAP_SYS_PACCT", "CAP_SYS_ADMIN", "CAP_SYS_BOOT", "CAP_SYS_NICE",
    "CAP_SYS_RESOURCE", "CAP_SYS_TIME", "CAP_SYS_TTY_CONFIG", "CAP_MKNOD",
    "CAP_LEASE", "CAP_AUDIT_WRITE", "CAP_AUDIT_CONTROL", "CAP_SETFCAP",
    "CAP_MAC_OVERRIDE", "CAP_MAC_ADMIN", "CAP_SYSLOG", "CAP_WAKE_ALARM",
    "CAP_BLOCK_SUSPEND", "CAP_AUDIT_READ", "CAP_PERFMON", "CAP_BPF",
    "CAP_CHECKPOINT_RESTORE",
]


def decode_caps(hex_mask):
    mask = int(hex_mask, 16)
    return [name for i, name in enumerate(CAPABILITIES) if mask & (1 << i)]


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


def main():
    status = read_status()
    uid = os.getuid()
    gid = os.getgid()

    report = {
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

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
