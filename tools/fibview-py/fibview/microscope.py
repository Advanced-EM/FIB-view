"""The Microscope object and its acquisitions. Every call goes to js/scripting.js through a transport, so a
script behaves the same headless, against an open exhibit, and inside the exhibit's Python IDE."""
from __future__ import annotations

import io
import json
import sys
import zipfile

import numpy as np


def in_browser() -> bool:
    """True inside the exhibit's Python IDE (Pyodide)."""
    return sys.platform == "emscripten"


class Acquisition:
    """What the detectors recorded: NumPy arrays by name, with metadata (calibrations, beams, patterns, state).

    acq.image          the main array (electron or ion image, map, spectrum, stack, ...)
    acq["sem_image"]   any array by name; acq.arrays lists them
    acq.calibration    pixel size, beams, pattern results, ... as recorded
    acq.save("x.npz")  the same .npz the exhibit's Export button writes
    """

    MAIN = ("image", "ion_image", "stack", "spectrum", "ipf_z", "implant_depth_hist", "bse_energy_hist")

    def __init__(self, npz: bytes, meta: dict | None = None):
        self.npz = bytes(npz)
        self.arrays: dict[str, np.ndarray] = {}
        with zipfile.ZipFile(io.BytesIO(self.npz)) as z:
            for name in z.namelist():
                if name.endswith(".npy"):
                    self.arrays[name[:-4]] = np.load(io.BytesIO(z.read(name)))
                elif name == "metadata.json":
                    meta = json.loads(z.read(name))
        self.meta: dict = meta or {}

    @property
    def image(self) -> np.ndarray:
        for k in self.MAIN:
            if k in self.arrays:
                return self.arrays[k]
        return next(iter(self.arrays.values()))

    @property
    def calibration(self) -> dict:
        return self.meta.get("calibration") or {}

    def __getitem__(self, name: str) -> np.ndarray:
        return self.arrays[name]

    def save(self, path: str) -> str:
        with open(path, "wb") as f:
            f.write(self.npz)
        return path

    def __repr__(self) -> str:
        shapes = ", ".join(f"{k} {tuple(v.shape)}" for k, v in self.arrays.items())
        return f"<Acquisition {self.meta.get('mode', '?')}: {shapes}>"


class Microscope:
    """One simulated dual beam. Get one with fibview.connect()."""

    def __init__(self, transport):
        self._t = transport

    def info(self) -> dict:
        """What this backend offers: modes, specimens, ions, settings, analyses, challenges."""
        return self._t.call("info")

    def state(self) -> dict:
        """Current settings: mode, specimen, both beams (voltage, current, probe size), stage, patterns, and the
        sputter yield of what is under the beam."""
        return self._t.call("state")

    def set(self, **settings) -> list:
        """Change settings, e.g. set(mode="mill", specimen="chip", ion="Xe", ion_current_pA=60000, tilt_deg=52), or the
        focus and stigmators: focus_um, stig, ion_focus_um, ion_stig.
        See info()["settings"] for the full list. Returns what was done."""
        return self._t.call("set", settings)

    def command(self, text: str) -> dict:
        """Run a plain-language command with the exhibit's grammar: "switch to xenon", "mill a cross-section"."""
        return self._t.call("command", {"text": text})

    def mill(self, shape: str = "rect", w: float = 5, h: float = 5, depth: float = 1, x: float | None = None,
             y: float | None = None, gas: str | None = None, face: int = 1) -> dict:
        """Mill a pattern with the current ion beam and run it to completion (instrument time passes at once).
        shape: rect, rcs (regular cross-section), ccs (cleaning cross-section), line, circle; sizes in µm; depth is
        in silicon (the application file). Returns the depth reached, volume, charge, measured volume yield, time."""
        a = {"shape": shape, "w": w, "h": h, "depth": depth, "face": face}
        if x is not None:
            a["x"] = x
        if y is not None:
            a["y"] = y
        if gas:
            a["gas"] = gas
        return self._t.call("mill", a)

    def deposit(self, gas: str = "Pt", w: float = 10, h: float = 2, thickness: float = 1, beam: str = "ion",
                x: float | None = None, y: float | None = None) -> dict:
        """Gas-assisted deposition of Pt, C or W with the ion or electron beam, run to completion."""
        a = {"gas": gas, "w": w, "h": h, "thickness": thickness, "beam": beam}
        if x is not None:
            a["x"] = x
        if y is not None:
            a["y"] = y
        return self._t.call("deposit", a)

    def lamella(self, action: str = "next", target_nm: float | None = None, kV: float | None = None) -> dict:
        """The lift-out workflow: action="next" runs the next step; "thin" thins toward target_nm; "polish" at kV."""
        a = {"action": action}
        if target_nm is not None:
            a["target_nm"] = target_nm
        if kV is not None:
            a["kV"] = kV
        return self._t.call("lamella", a)

    def acquire(self, steps: int | None = None) -> Acquisition:
        """Record the detectors. The simulator first advances `steps` frames of 50 ms (a sensible default by mode)."""
        r = self._t.call("acquire", {} if steps is None else {"steps": int(steps)})
        return Acquisition(r["npz"], r.get("meta"))

    def analyze(self, name: str | None = None) -> dict:
        """Measure the live data and compare it with the truth: measure_resolution, measure_mill, sputter_yield,
        fit_eds, ebsd_stats, sv_fractions, lamella_thickness, ion_range. None picks one for the current mode."""
        return self._t.call("analyze", {} if name is None else {"name": name})

    def step(self, n: int = 1) -> dict:
        """Advance the simulation n frames of 50 ms."""
        return self._t.call("step", {"n": int(n)})

    def challenge(self, id: str, seed: int | None = None) -> dict:
        """Start a training task as a challenge: sem-focus-stig, fib-focus-stig or eucentric. The readings no longer
        show the truth; score() says how well your script did."""
        return self._t.call("challenge", {"id": id} if seed is None else {"id": id, "seed": int(seed)})

    def score(self) -> dict:
        return self._t.call("score")

    def reveal(self) -> dict:
        return self._t.call("reveal")

    def end_challenge(self) -> dict:
        return self._t.call("end_challenge")

    def close(self) -> None:
        self._t.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __repr__(self) -> str:
        return f"<Microscope {self._t.name}>"


def connect(backend: str = "auto", **options) -> Microscope:
    """Open an instrument.

    backend="headless"  the simulator in a Node.js process (default on a desktop)
    backend="live"      an exhibit in a browser; options: port=8792, timeout=120 (seconds to wait for "Connect agent")
    backend="browser"   inside the exhibit's Python IDE (default there)
    """
    from . import transports

    if backend == "auto":
        backend = "browser" if in_browser() else "headless"
    if backend == "browser":
        return Microscope(transports.Browser())
    if backend == "headless":
        return Microscope(transports.Headless(**options))
    if backend == "live":
        return Microscope(transports.Live(**options))
    raise ValueError('backend must be "auto", "headless", "live" or "browser"')


def _as_array(x):
    return x.image if isinstance(x, Acquisition) else np.asarray(x)


def show(x, title: str | None = None):
    """Display an image (2D) or a profile (1D). Accepts an Acquisition or an array. In the IDE it draws in the output
    panel; on a desktop it uses matplotlib."""
    a = _as_array(x)
    if a.ndim == 3 and a.shape[-1] == 3:
        a = a.mean(axis=-1)
    if a.ndim == 3:
        a = a[-1]
    if a.ndim > 2:
        raise ValueError(f"show() takes a 1D or 2D array; this one is {a.shape}")
    if in_browser():
        from js import fibviewIDE  # provided by the exhibit's IDE
        from pyodide.ffi import to_js

        a = np.nan_to_num(a.astype(np.float64))
        if a.ndim == 2:
            lo, hi = np.percentile(a, [0.5, 99.5])
            g = np.clip((a - lo) / ((hi - lo) or 1) * 255, 0, 255).astype(np.uint8)
            fibviewIDE.showImage(to_js(g.tobytes()), g.shape[1], g.shape[0], title or "")
        else:
            fibviewIDE.showPlot(to_js(a.astype(np.float32).tobytes()), len(a), title or "")
        return None
    try:
        import matplotlib.pyplot as plt
    except ImportError as e:
        raise ImportError("show() needs matplotlib on a desktop: pip install matplotlib") from e
    plt.figure()
    if a.ndim == 2:
        plt.imshow(a, cmap="gray")
        plt.axis("off")
    else:
        plt.plot(a)
    if title:
        plt.title(title)
    plt.show()
