# registary-oci

Sample OCI image that reports its own runtime permissions: resolved
user/group name, supplementary groups, Linux capabilities
(effective/permitted/inheritable/bounding), an actual filesystem write probe
(not just theoretical capability flags), seccomp status, mounts, and env —
as JSON to stdout.

Stands in for a Data Controller's OCI image to test the registry-service
upload path and, later, to sanity-check nsjail's privilege boundary (the
report should look a lot more locked-down once nsjail is in front of it).

Build + test locally:

```
docker build -t registary-oci sample/registary-oci
docker run --rm registary-oci
```

Build + save as a .tar to send through the registry-service `/upload`
endpoint:

```
docker build -t registary-oci sample/registary-oci
docker save registary-oci -o /tmp/registary-oci.tar
make -C csav/registary-service upload FILE=/tmp/registary-oci.tar
```
