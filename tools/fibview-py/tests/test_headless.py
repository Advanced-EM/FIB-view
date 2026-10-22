"""Run with: pytest tools/fibview-py/tests (needs Node 20+)."""
import shutil

import numpy as np
import pytest

import fibview as fv

pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="Node.js is needed for the headless backend")


@pytest.fixture(scope="module")
def fib():
    with fv.connect("headless") as m:
        yield m


def test_info(fib):
    i = fib.info()
    assert "mill" in i["modes"] and "Xe" in i["ions"]


def test_ion_image(fib):
    fib.set(mode="fib", specimen="ni", ion="Ga", ion_current_pA=25)
    a = fib.acquire()
    assert a.image.shape == (256, 256) and np.isfinite(a.image).all()
    assert a.calibration["ion"] == "Ga"


def test_mill_xenon_faster_than_gallium(fib):
    fib.set(mode="mill", specimen="chip")
    fib.set(ion="Ga", ion_current_pA=4000)
    ga = fib.mill(shape="rect", w=5, h=5, depth=1, x=-10, y=0)
    fib.set(ion="Xe", ion_current_pA=4000)
    xe = fib.mill(shape="rect", w=5, h=5, depth=1, x=10, y=0)
    assert xe["Yv"] > ga["Yv"] > 0


def test_challenge(fib):
    c = fib.challenge("eucentric", seed=3)
    assert c["id"] == "eucentric"
    fib.set(stage_z_um=0)
    assert fib.score()["score"] == 100
    fib.end_challenge()
