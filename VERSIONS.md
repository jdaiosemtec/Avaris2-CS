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
- v2.0.0 — First V2.0 build: 2D Flood module (Options → 2D Flood, Create Meshes, 1D-2D run to .finp/.frpt/.fout, Meshes layer coloured by depth / max depth / time ponded / time to recede / elevation, cell properties + graph, mesh shapefile export, Avaris DS .ini [2D] import). Mesh rules reproduce Avaris DS (verified on demo3: 1497 cells, 2852 surface links, 551 manhole couplings, 15 water-front outfalls, identical cell elevations and link lengths). Fix: Avaris .ini [Reference] coordinate system index.
