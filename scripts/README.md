# Scripts

Offline tools for data, storage and admin tasks. None of these run in the app.
Run them from anywhere — paths resolve from the repo root — e.g.
`node scripts/storage/upload-cogs-vercel.js <folder> <prefix>`.

| Folder | What's in it |
|---|---|
| `storage/` | Publishing to Vercel Blob: COG uploads (`upload-cogs-vercel.js`), static data and biomass tiles (`upload-data-vercel.js`), the COG availability manifest (`generate-cog-manifest-vercel.js`), and the one-off R2 → Blob migration. |
| `stats/` | Precomputed chart statistics in `client/public/data/`. `refresh-stats.js` runs the right generator for a module. |
| `data/` | FMU boundary download (`pull_ontario_fmu_boundaries.py`) and simplification. |
| `admin/` | Account maintenance: `reset-password.js` (any account, including the admin). |
| `alerts/` | Disturbance Alerts data. `seed-mock-alerts.js --db <name>` loads demo alerts (DIST-ALERT-shaped, flagged `mock: true`) into `disturbance_alerts`; `--remove` deletes only the mock ones. |
| `legacy/` | The Cloudflare R2 and PNG-tile era, kept for reference. Not part of the current workflow. |

## When a module's data changes

The charts read precomputed JSON, not the rasters, so they go stale whenever a
module's COGs are regenerated or gain a region or year.

Uploading COGs with `storage/upload-cogs-vercel.js` refreshes them automatically
for the regions in the upload (`--no-stats` to skip). To refresh by hand:

```bash
node scripts/stats/refresh-stats.js clearcut --region wabigoon
node scripts/stats/refresh-stats.js clearcut --region wabigoon -- --dry-run   # preview only
node scripts/stats/refresh-stats.js wildfire
```

| Module | Stats files | Generator | Inputs (`.env`) |
|---|---|---|---|
| Clearcut (AI model) | `clearcut_stats.json` | `compute_clearcut_stats_cog.py` in **boreal-canada-mapping**, from the classified rasters the COGs are made from | `BOREAL_REPO_DIR`, `CLEARCUT_RESULTS_DIR` (default: sibling repo and its `results/`), `PYTHON` (an environment with rasterio) |
| Wildfire | `wildfire_stats.json`, `wildfire_years.json` | `stats/generate-wildfire-stats.js`, `stats/generate-wildfire-years.js` | `WILDFIRE_PLAN_CSV`, `WILDFIRE_TILES_DIR` |
| Clearcut (ARI inventory) | — | none; the chart uses the AI model's stats | — |
| Caribou | `caribou_stats.json`, `caribou_years.json` | none in either repo; update by hand | — |

The stats files are served from the deployment, so **commit and push** them to
publish.

`legacy/compute-clearcut-stats.js` and `legacy/precompute_clearcut_stats.py`
count pixels in the old PNG tiles. Don't use them: they would overwrite the
chart's stats with tile-based numbers and none of the window/entering fields.
