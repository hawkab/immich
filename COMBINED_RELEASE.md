# Combined photo tools for Immich 3.4.1

This branch combines the partner editing permission, face editing fixes,
person-aware scene search and automatic head-up photo orientation.

The release base is the already deployed `feature/partner-edit-v3.4.1` branch.
The original `feature/partner-edit-permission` branch is a merge parent; its
feature was already backported and corrected on this release base. The
`feature/automatic-head-up-orientation` branch is also a merge parent, with its
feature changes integrated on the stable base. Its unrelated upstream `main`
changes are deliberately excluded. The application version, dependency lock and
existing migration order stay on 3.4.1.

The image includes the ordinary Immich server/web application and a separate,
on-demand `immich-auto-orient` command. The command uses owner-authenticated APIs
and the existing ML service; it requires no mounted photo library. Rotations use
Immich's reversible editor, preserving originals and capture dates. Existing
manual edits and ambiguous/artistic compositions are retained.

The common Proxmox installer pins this image and installs the protected owner
profiles, durable receipts and single-consumer systemd job. It does not replace
the photo VM, disks, users, partner grants or previously restored capture dates.
