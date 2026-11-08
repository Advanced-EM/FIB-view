// The dual beams at NUANCE (Northwestern University, EPIC-FIB facility), as digital twins.
// Sources: the NUANCE instrument pages (nuance.northwestern.edu/facilities/epic/epic-instruments/fib-instruments/) and
// the EPIC-FIB tech talks of 2024-11-21 (Hydra PFIB) and 2025-08-21 (Helios 5 UC). Values those sources state are
// used as given; values marked `typical` are the manufacturer's usual specification for that model, not stated by
// NUANCE. All three are Helios-family DualBeams: electron and ion columns 52° apart, coincidence point at 4 mm WD.
//
// semRes: best SEM resolution (nm) vs landing energy (kV); fibRes: best FIB resolution (nm) at 30 kV per ion, at the
// smallest current; ionCurrents: the aperture strip at 30 kV (pA). `modes` are the exhibit modes the hardware supports.
const ALL = ['se', 'inlens', 'bse', 'ebsd', 'tkd', 'eds', 'fib', 'mill', 'gis', 'sv', 'lam', 'cryo', 'mc'];

export const INSTRUMENTS = {
  h5uc: {
    key: 'h5uc', name: 'Thermo Scientific Helios 5 UC', short: 'Helios 5 UC', maker: 'Thermo Fisher Scientific', room: 'Technological Institute AG97', installed: '2025',
    role: 'Precision Ga⁺ milling, TEM lamellae and atom-probe tips, AutoTEM; small-volume tomography.',
    ecol: 'Elstar UC+ extreme-high-resolution FEG, monochromated (UC mode: energy spread < 0.2 eV below 5 kV and 100 pA); beam deceleration down to 20 eV',
    icol: 'Tomahawk HT Ga⁺ liquid-metal ion column', source: 'LMIS', ions: ['Ga'], ionKV: [0.5, 30],
    ionCurrents: { Ga: [1.1, 7.7, 24, 41, 80, 230, 430, 790, 2500, 9300, 21000, 47000, 65000, 100000] },
    fibRes: { Ga: 3.6 }, semRes: [[1, 0.7], [2, 0.6], [15, 0.6], [30, 0.6]], uc: true,
    detectors: { se: 'ETD (SE/BSE)', inlens: 'TLD (SE/BSE, immersion)', bse: 'ICD · DBS (CBS/ABS)', ion: 'ICE (SE/SI)', stem: 'Retractable STEM' },
    eds: { name: 'Oxford Ultim Max Infinity 170 mm²', area: 170 }, ebsd: null,
    gis: ['Pt', 'C', 'W'], gisName: 'MultiChem (C, Pt, W; mixed chemistries, flow control)', etch: [],
    manipulator: 'EasyLift micromanipulator; Kleindiek nanomanipulator', stage: 'Piezo stage', cryo: null,
    extras: ['Charge neutralizer (electron flood)', 'Integrated plasma cleaner'],
    software: ['AutoTEM 5', 'Auto Slice & View 5', 'Avizo 3D'],
    modes: ALL.filter((m) => !['ebsd', 'tkd', 'cryo'].includes(m)),
    spec: [['SEM resolution', '0.6 nm at 2–15 kV; < 0.7 nm at 1 kV (0.6 nm at 30 kV STEM)'], ['FIB resolution', '3.6 nm at 30 kV (4 nm on the instrument page)'], ['Ion beam', 'Ga⁺, 1 pA – 100 nA, 500 V – 30 kV'], ['EDS', 'Oxford Ultim Max Infinity, 170 mm²'], ['Gases', 'MultiChem: C, Pt, W'], ['Manipulator', 'EasyLift; Kleindiek'], ['Software', 'AutoTEM 5, Auto Slice & View 5']],
    typical: ['ion column name (Tomahawk HT)', 'the aperture-strip values between 1 pA and 100 nA'],
  },
  hydra: {
    key: 'hydra', name: 'Thermo Scientific Helios 5 Hydra CX', short: 'Hydra PFIB', maker: 'Thermo Fisher Scientific', room: 'Technological Institute AG98', installed: '',
    role: 'Large-volume plasma milling, bulk 3D tomography with 3D EDS/EBSD, Ga-free preparation, cryo milling.',
    ecol: 'Elstar UC+ extreme-high-resolution FEG, monochromated (UC mode: < 0.2 eV); beam deceleration',
    icol: 'Hydra multi-ion inductively coupled plasma column (Xe, Ar, O, N; < 10 min to switch)', source: 'ICP plasma', ions: ['Xe', 'Ar', 'O', 'N'], ionKV: [2, 30],
    ionCurrents: {
      Xe: [1, 10, 30, 100, 300, 1000, 4000, 15000, 60000, 200000, 500000, 1300000, 2500000],
      Ar: [1, 10, 30, 100, 300, 1000, 4000, 15000, 60000, 200000, 500000, 1300000, 2500000],
      O: [1, 10, 30, 100, 300, 1000, 4000, 15000, 60000, 200000, 500000, 1300000, 2500000],
      N: [1, 10, 30, 100, 300, 1000, 4000, 15000, 60000, 200000, 500000, 1300000, 2500000],
    },
    fibRes: { Xe: 20 }, semRes: [[1, 0.7], [2, 0.6], [15, 0.6], [30, 0.6]], uc: true,
    detectors: { se: 'ETD (SE/BSE)', inlens: 'TLD (SE/BSE, immersion)', bse: 'ICD · DBS (CBS/ABS)', ion: 'ICE (SE/SI)', stem: 'Retractable STEM (BF, DF2, DF4, HAADF)' },
    eds: { name: 'Oxford Ultim Max 100 mm²', area: 100 }, ebsd: 'Oxford Symmetry S3 (~5800 patterns/s at 156 × 128 px)',
    gis: ['Pt', 'C', 'W'], gisName: 'MultiChem (C, Pt, W; mixed chemistries, flow control)', etch: [],
    manipulator: 'EasyLift micromanipulator with rotation', stage: '', cryo: { minC: -183, note: 'Cryo stage, down to ~90 K' },
    extras: ['Charge neutralizer'],
    software: ['AutoTEM 5', 'Auto Slice & View 5 (3D EDS, 3D EBSD)', 'MAPS 3', 'Avizo 3D'],
    modes: ALL,
    spec: [['SEM resolution', '0.6 nm at 2–15 kV; 0.7 nm at 1 kV'], ['FIB resolution', '< 20 nm at 30 keV (Xe⁺)'], ['Ion beam', 'Xe⁺, Ar⁺, O⁺, N⁺; 1 pA – 2.5 µA; < 10 min to switch species'], ['EDS / EBSD', 'Oxford Ultim Max 100 mm²; Oxford Symmetry S3'], ['Gases', 'MultiChem: C, Pt, W'], ['Cryo', 'Cryo stage to ~90 K'], ['Benchmark (NUANCE)', 'Si, 1 h: 3.0 × 10⁶ µm³ at Xe⁺ 2.5 µA vs 6.4 × 10⁴ µm³ at Ga⁺ 21 nA (~50×)']],
    typical: ['ion voltage range (2–30 kV)', 'the aperture-strip values between 1 pA and 2.5 µA, the same strip for every species'],
  },
  h600: {
    key: 'h600', name: 'FEI Helios NanoLab 600', short: 'Helios 600', maker: 'FEI (now Thermo Fisher)', room: 'Technological Institute AG97', installed: '',
    role: 'Conventional Ga⁺ DualBeam: TEM and APT lift-out, ion-beam lithography (Raith ELPHY).',
    ecol: 'Elstar Schottky FEG with through-lens detection (no monochromator)', icol: 'Sidewinder Ga⁺ liquid-metal ion column', source: 'LMIS', ions: ['Ga'], ionKV: [0.5, 30],
    ionCurrents: { Ga: [1.5, 9.7, 28, 48, 93, 280, 460, 920, 2800, 6500, 21000] },
    fibRes: { Ga: 5 }, semRes: [[1, 1.4], [15, 0.9], [30, 0.9]], uc: false,
    detectors: { se: 'ETD (SE/BSE)', inlens: 'TLD (SE/BSE)', bse: 'BSE', ion: 'CDEM (SE/SI)', stem: 'STEM detector' },
    eds: null, ebsd: null,
    gis: ['Pt', 'C', 'W'], gisName: 'Five gas injection systems (etching and deposition)', etch: ['XeF2', 'H2O'],
    manipulator: 'Lift-out tools for TEM and APT', stage: '', cryo: null,
    extras: ['Raith ELPHY ion-beam lithography', 'ibss GV10x downstream plasma asher', 'Vibration isolation table'],
    software: [],
    modes: ALL.filter((m) => !['eds', 'ebsd', 'tkd', 'cryo'].includes(m)),
    spec: [['Ion beam', 'Ga⁺, up to 21 nA (NUANCE benchmark condition)'], ['Gases', 'five GIS for etching and deposition'], ['Detectors', 'STEM detector'], ['Extras', 'Raith ELPHY IBL; GV10x plasma asher; lift-out tools for TEM and APT']],
    typical: ['SEM resolution (0.9 nm at 15 kV, 1.4 nm at 1 kV)', 'FIB resolution (5 nm at 30 kV)', 'column names', 'the aperture strip', 'which five gases (assumed Pt, C, W, XeF₂, H₂O)'],
  },
  generic: {
    key: 'generic', name: 'Teaching dual beam (all ions)', short: 'Teaching', maker: '', room: '', installed: '',
    role: 'Not a real instrument: every ion species, detector and the cryo stage on one column, for teaching and comparisons.',
    ecol: 'Schottky FEG', icol: 'Ga⁺ LMIS and multi-ion plasma column', source: 'both', ions: ['Ga', 'Xe', 'Ar', 'N', 'O'], ionKV: [1, 30],
    ionCurrents: null, fibRes: null, semRes: null, uc: false,
    detectors: { se: 'ETD', inlens: 'In-lens', bse: '4-quadrant BSE', ion: 'ion detector (SE/SI)', stem: '' },
    eds: { name: 'SDD', area: 100 }, ebsd: 'EBSD camera',
    gis: ['Pt', 'C', 'W'], gisName: 'Pt, C, W deposition; XeF₂ and H₂O etch', etch: ['XeF2', 'H2O'],
    manipulator: 'Manipulator needle', stage: '', cryo: { minC: -196, note: 'Cryo stage' }, extras: [], software: [],
    modes: ALL, spec: [], typical: [],
  },
};
export const INST_KEYS = Object.keys(INSTRUMENTS);
// which NUANCE instrument offers an ion species or a mode (for switching when a visitor asks for it)
export function instrumentFor({ ion, mode, cryo } = {}, current = 'h5uc') {
  const ok = (k) => { const I = INSTRUMENTS[k]; return (!ion || I.ions.includes(ion)) && (!mode || I.modes.includes(mode)) && (!cryo || I.cryo); };
  if (ok(current)) return current;
  return ['h5uc', 'hydra', 'h600'].find(ok) ?? 'generic';
}
