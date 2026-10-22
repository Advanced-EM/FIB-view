# fibview-mcp

An MCP server that lets an AI agent use the FIB-view dual-beam twin, headless or live in an open exhibit.

```bash
cd tools/fibview-mcp && npm install
claude mcp add fibview -- node /path/to/FIB-View/tools/fibview-mcp/server.mjs
```

| Tool | What it does |
| --- | --- |
| `simulate` | Run the simulator headless in any mode and save the detectors' data as `.npz` (optionally with an analysis) |
| `mill` | Mill one pattern with any ion species into a specimen, to completion: depth, volume, charge, measured yield, time, and the images |
| `ion_physics` | Sputter yield, projected range, straggle and damage depth for an ion, energy, material and angle |
| `exhibit_status` | What the open exhibit shows (both beams, stage, patterns, training task) |
| `exhibit_set` | Change mode, specimen, ion species, voltages, currents, tilt, field, gas, realistic view |
| `exhibit_pattern` | Add and start a milling pattern or a Pt/C/W deposition in the exhibit |
| `exhibit_action` | Autofocus, start/stop milling, clear, fresh specimen, eucentric height, next lamella step, blank, narrate |
| `exhibit_command` | A plain-language command with the exhibit's grammar ("mill a cross-section") |
| `exhibit_acquire` | Record the detectors; images back, `.npz` and `.png` saved with `save: true` |
| `exhibit_analyze` | measure_resolution, measure_mill, sputter_yield, fit_eds, ebsd_stats, sv_fractions, lamella_thickness, ion_range |
| `exhibit_say` | Caption and speak through the exhibit |
| `exhibit_wait_for_voice` | Wait for the visitor's next question |

The exhibit connects only when the visitor clicks **Connect agent** (Controls → Voice and agent), only to
`ws://127.0.0.1:8792` (or 8793), and refuses changes while a training task runs.

Environment: `FIBVIEW_PORT` (8792), `FIBVIEW_ORIGINS` (allowed page origins besides localhost),
`FIBVIEW_OUT` (where files go, default `./fibview-out`).

Test: `node test.mjs` (headless), `node test.mjs --live` (then click Connect agent in the exhibit).
