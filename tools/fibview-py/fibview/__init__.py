"""fibview: script the FIB-view dual-beam (FIB-SEM) simulator from Python.

    import fibview as fv
    fib = fv.connect()                      # headless on a desktop; the open exhibit inside its Python IDE
    fib.set(mode="fib", specimen="ni", ion="Ga", ion_current_pA=25)
    img = fib.acquire()                     # NumPy arrays with calibrations
    fv.show(img)
    r = fib.mill(shape="rcs", w=16, h=8, depth=6)   # mill to completion; depth, volume, measured yield

Backends, all with the same calls:
    fv.connect("headless")   the simulator in a Node.js process, no browser (needs Node 20+)
    fv.connect("live")       an exhibit open in a browser: select "Connect agent" there (needs `websockets`)
    fv.connect("browser")    inside the exhibit's Python IDE (Pyodide); the default there
"""
from .microscope import Microscope, Acquisition, connect, show, in_browser

__all__ = ["Microscope", "Acquisition", "connect", "show", "in_browser"]
__version__ = "0.1.0"
