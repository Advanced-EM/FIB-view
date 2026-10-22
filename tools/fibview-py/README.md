# fibview: Python for the FIB-view dual beam

```python
import fibview as fv

fib = fv.connect()                        # headless (Node 20+), or this exhibit inside its Python IDE
fib.set(mode="mill", specimen="chip", ion="Xe", ion_current_pA=60000, tilt_deg=52)
r = fib.mill(shape="rcs", w=20, h=10, depth=8)     # runs to completion: depth, volume, measured yield, time
a = fib.acquire()                         # ion image, 52° SEM image, depth maps, calibrations
fv.show(a["sem_image"], "the cross-section face")
```

Install for a desktop: `pip install -e tools/fibview-py` (add `[live]` to drive an open exhibit with
`fv.connect("live")`, `[plot]` for `fv.show`). The headless backend runs `js/` in Node; set `FIBVIEW_ROOT` if the
package is not inside the repository.

| Call | |
| --- | --- |
| `set(**settings)` | mode, specimen, kV, current_pA, wd_mm, tilt_deg, fov_um, focus_um, stig, stage_z_um, ion, ion_kV, ion_current_pA, ion_focus_um, ion_stig, detector, gas, realistic, beam |
| `state()` | both beams, probe sizes, stage, patterns, the sputter yield under the beam |
| `command(text)` | the exhibit's grammar |
| `mill(shape, w, h, depth, x, y, gas, face)` | a pattern, run to completion |
| `deposit(gas, w, h, thickness, beam)` | Pt, C or W with the ion or electron beam |
| `lamella(action, target_nm, kV)` | the lift-out workflow: next, thin, polish |
| `acquire()` | an `Acquisition`: `.image`, `["sem_image"]`, `.arrays`, `.calibration`, `.save()` |
| `analyze(name)` | measure_resolution, measure_mill, sputter_yield, fit_eds, ebsd_stats, sv_fractions, lamella_thickness, ion_range |
| `challenge(id, seed)` / `score()` / `reveal()` / `end_challenge()` | sem-focus-stig, fib-focus-stig, eucentric |

Examples: `examples/quickstart.py`, `mill_rates.py`, `cross_section.py`, `auto_focus_ion.py`.
Tests: `pytest tools/fibview-py/tests`.
