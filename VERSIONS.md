# OsemCM version record

| Line | Version | Installer | Source | Notes |
|---|---|---|---|---|
| **V1.0** (1D) | 1.23.0 | `OsemCM-Setup-1.23.0.exe` | git tag `v1.0` (branch `v1`) | Final 1D release: SWMM 5.2.4 + Avaris mods engine, Avaris-style parameter editors, GIS, scenarios, profile ... Base for any further 1D-only work ("基于 OsemCMV1.0"). |
| **V2.0** (1D + 2D) | 2.0.x | `OsemCMV2.0-Setup-2.0.x.exe` | branch `main` (tags `v2.0.x`) | Adds the 2D surface flood module (mesh from boundary + DEM, 1D-2D coupling, flood animation). |

Rules
- 1D fixes requested "based on OsemCMV1.0" are made on branch `v1` (versions 1.23.x) and can be merged into `main`.
- 2D work is done on `main` only.
- Every installer that is sent out gets a tag (`v1.23.x` / `v2.0.x`) and a line in CHANGELOG below.

## CHANGELOG
- v1.23.0 — V1.0 baseline (last 1D-only build).
