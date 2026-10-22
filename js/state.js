// The exhibit's state: defaults, and the keys a saved session (or a replay) restores.
export function defaultState() {
  return {
    mode: 'se', clarity: 'edu', spec: 'chip', fov: 40, cx: 0, cy: 0, tilt: 0, ez: 0, coated: false,
    // electron column
    kV: 2, current: 100, aperture: 30, wd: 4, focus: 0, stig: 0, dwell: 2,
    etdBias: 250, bseMode: 'comp', seg: { A: 1, B: 1, C: 1, D: 1 },
    mapN: 40, expo: 10, mapView: 'ipf', showHough: true, tkdThick: 90, tkdAmorph: 0,
    edsSel: 'all', mcMax: 2500, mcBeam: 'e', mcIons: 300,
    // ion column
    ion: 'Ga', ikV: 30, icur: 25, ifocus: 0, istig: 0, idwell: 1, fibDet: 'ise', flood: false,
    // patterning and gas injection
    shape: 'rcs', patW: 16, patH: 8, patDepth: 6, gas: 'none', depGas: 'Pt', depBeam: 'ion', depThick: 1, rocking: false, overtilt: 0, realTime: false,
    // slice & view
    svSlice: 100, svN: 60, svDet: 'bse', svView: 'xy', svZ: 0.5, svX: 0.5, svTiltCorr: true,
    // lamella
    lamI: 300, lamKV: 30, lamTarget: 300, lamOver: 1.5,
    // view
    speed: 1, paused: false, showLabels: true, showElectrons: true, showGlass: true, autoRotate: false,
    mis: null,
  };
}
export const SESSION_KEYS = Object.keys(defaultState()).filter((k) => !['paused', 'showLabels', 'showElectrons', 'showGlass', 'autoRotate', 'speed'].includes(k));
