# OsemCM — 1D / 2D feature split (internal record)

The UI is one product; this file records which functions belong to the **1D** part and which to the **2D** module,
so that licence editions can be switched on later without searching the code.
All 2D entry points already go through `AV.has2D(app)` (renderer/js/licence.js). Licensing is **not active**:
`AV.LICENSING = false` → `AV.has2D()` is always true and every function is available.

## 1D (base product)
Everything that existed in V1.0 (tag `v1.0`, branch `v1`): network editing, parameter editors, GIS / layers,
scenarios, simulation options (all tabs except "2D Flood"), 1D run (`.run.inp/.rpt/.out`), results, theme, profiles,
graphs, reports, export, history, users.

## 2D module (OsemCM 1D-2D)
| Function | Where in the UI | Code |
|---|---|---|
| 2D settings (boundary, DEM, water front, cut-off, exclusion, cell size, roughness, run units, routing step, flood depth) | Simulation → Options → tab "2D Flood"; Layer View 2D Flood group → "2D Flood Settings..." | `sim.js` optionsDialog (`tabs['2D Flood']`, `f2d_*` keys, stored as `;;@OSEM2D` in the .inp by `model.js`) |
| Import Avaris DS `.ini [2D]` | automatic on Open | `mesh2d.js` `AV.importAvaris2D`, called from `app.js` openFile |
| Create Meshes | Simulation → Create Meshes; Layer View 2D Flood group | `mesh2d.js` `AV.buildMesh2D`, `AV.createMeshes`; sidecar `<model>.mesh2d.json`; ribbon item `lic: '2D'` in `ribbon.js` |
| 1D-2D run (`.finp/.frpt/.fout`) | Simulation → Run (when 2D is enabled and a mesh exists) | `sim.js` run → `AV.mesh2DToINP`; `main.js` engine:run `flood2d` |
| 2D results (depth, max depth, time ponded, time to recede, elevation), animation, legend | Layer View → 2D Meshes (drag to reorder; Symbology pane); time slider | `mesh2d.js` computeMeshResults / drawMesh / drawMeshLegend / meshStyleDialog; `outreader.js` pondStats (`out:pondStats`) |
| Cell hover / click info, Graph Depth | map | `map.js` (meshHit hooks), `app.js` onHoverCell, `mesh2d.js` showCellInfo |
| Export mesh shapefile | Meshes layer menu | `mesh2d.js` exportMeshShapefile |
| Load `.fout` results | Catalog / Load results | `sim.js` loadResults, `catalog.js` |

## Licence hooks prepared (inactive)
- `renderer/js/licence.js`: editions, `AV.has2D`, `AV.need2D`, key activation dialog (used only when `AV.LICENSING = true`).
- `main.js` `license:verify`: offline Ed25519 key check (public key embedded).
- `license-tools/keygen.js` + `private_key.pem` (private key not in git; copy in releases/license).
- Ribbon items with `lic: '2D'` show a lock and ask for a licence when 2D is not licensed.
