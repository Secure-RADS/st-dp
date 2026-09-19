# registry-oci

Sample OCI image that reports its own runtime permissions: resolved
user/group name, supplementary groups, Linux capabilities
(effective/permitted/inheritable/bounding), an actual filesystem write probe
(not just theoretical capability flags), seccomp status, mounts, and env —
as JSON to stdout.

Stands in for a Data Controller's OCI image to test the registry-service
upload path and, later, to sanity-check nsjail's privilege boundary (the
report should look a lot more locked-down once nsjail is in front of it).

Must declare a `PATH` env var (`ENV PATH=...` or inherited from a base image
that sets one) - registry-service resolves the entrypoint binary using the
image's own declared `PATH`, not a guessed list of directories, since
directory layout for `/bin`, `/sbin`, etc. differs across distros (Alpine
keeps them separate, Debian/Ubuntu/Fedora symlink into `/usr`). No `PATH`
declared means the build fails outright rather than guessing.

Build + test locally:

```
docker build -t registry-oci sample/registry-oci
docker run --rm registry-oci
```

Build + save as a .tar to send through the registry-service `/upload`
endpoint:

```
docker build -t registry-oci sample/registry-oci
docker save registry-oci -o /tmp/registry-oci.tar
make -C secure-rads/csav/registry-service upload FILE=/tmp/registry-oci.tar
```
