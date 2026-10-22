// What each mode shows, what each control changes, and the instrument readout.
import * as P from './physics.js';
import { lamQuality, LAM_STEPS } from './mill.js';

export const fmtLen = (um) => (um >= 1000 ? `${+(um / 1000).toFixed(2)} mm` : um >= 1 ? `${+um.toFixed(um < 10 ? 2 : 0)} µm` : `${+(um * 1000).toFixed(um < 0.01 ? 1 : 0)} nm`);
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const underKey = (sim) => { const s = sim.sampleAt(sim.S.cx, sim.S.cy); return P.MAT[s.mat].rho ? s.mat : 'C'; };
const under = (sim) => P.MAT[underKey(sim)];
const I = (pA) => P.fmtCurrent(pA);

export function modeInfo(S, sim) {
  const pr = sim.probe, m = under(sim), R = P.rangeKO(m, S.kV);
  const M = sim.map;
  switch (S.mode) {
    case 'se': return {
      title: 'Seeing <em>topography</em>',
      body: `The probe knocks <b>secondary electrons</b> (SE, below 50 eV) out of the top few nanometres. Their yield follows the <b>secant law</b>: tilted faces and edges emit more, so the image reads like a lit landscape. The <b>Everhart–Thornley detector</b> pulls them in with a positively biased Faraday cage. Surfaces facing it look brighter, and faces hidden behind features are shadowed: that’s where the “lighting” comes from. Uncoated insulators charge when the beam deposits more electrons than leave (above the <b>E2</b> crossover, right).`,
      stats: [['Probe size', `${f1(pr.d)} nm`, 'sets the ultimate resolution'], ['Magnification', `×${Math.round(127000 / S.fov).toLocaleString()}`, `field of view ${fmtLen(S.fov)}`], ['Interaction range', fmtLen(R), `${m.name}, Kanaya–Okayama`]],
    };
    case 'inlens': return {
      title: 'Surface detail <em>through the lens</em>',
      body: `An <b>in-lens</b> (through-the-lens) detector sits inside the column. The objective’s magnetic field captures the lowest-energy secondaries emitted right under the probe (SE1) and spirals them up to the detector, so it sees mostly the <b>true surface signal</b>, with little shadowing and little of the blurry SE2 excited by backscattered electrons far from the probe. It needs a <b>short working distance</b>: the collection efficiency drops fast beyond ~5 mm. Right: how aberrations, diffraction and the source set the probe size.`,
      stats: [['Probe size', `${f1(pr.d)} nm`, `α = ${f1(pr.alpha * 1000)} mrad`], ['Working distance', `${S.wd} mm`, 'shorter is better here'], ['Depth of field', fmtLen(2 * Math.max(S.fov / 256, pr.d / 1000) / pr.alpha), 'grows as α shrinks']],
    };
    case 'bse': return {
      title: 'Seeing <em>atomic number</em>',
      body: `<b>Backscattered electrons</b> (BSE) are primary electrons that bounce back out after elastic scattering from nuclei, still carrying much of their energy. Heavier atoms send more back: η rises with Z (right), so brightness maps <b>composition</b>. A four-quadrant solid-state detector under the pole piece adds all segments for composition (A+B+C+D) or subtracts opposite ones for <b>topography</b> (A−B). In crystals the backscatter yield also depends on how the beam lines up with atomic rows: <b>channelling contrast</b> makes grains in polished metals light up differently.`,
      stats: [['η here', f2(P.eta(m.Z, (S.tilt * Math.PI) / 180)), `${m.name}`], ['BSE escape depth', fmtLen(0.3 * R), '≈ 0.3 × range'], ['Segments', P.segLabel(S.seg), P.segKind(S.seg)]],
    };
    case 'ebsd': return {
      title: 'Crystal orientation <em>from Kikuchi bands</em>',
      body: `The specimen is tilted to <b>70°</b> so backscattered electrons leave toward a phosphor screen. Electrons diffracted by each lattice plane form a <b>Kikuchi band</b> whose centre line is the plane’s trace and whose width is 2θ<sub>B</sub>. A <b>Hough transform</b> finds the bands, their mutual angles are matched against the crystal’s interplanar angles, and the orientation drops out. Every pixel of the map is a full pattern, indexed live here. The colours (inverse pole figure) show which crystal direction points out of the surface. At grain boundaries and in fine grains, patterns from neighbours overlap and indexing fails.`,
      stats: [['Indexed', M ? `${M.done ? Math.round((100 * M.ok) / M.done) : 0} %` : '—', M ? `${M.done} / ${M.N * M.N} points` : ''], ['Mean error', M && M.ok ? `${(M.errSum / M.ok).toFixed(2)}°` : '—', 'vs the true orientation'], ['Spatial resolution', fmtLen(0.02 * R) + ' × ' + fmtLen((0.02 * R) / Math.cos(1.22)), 'across × along the tilt']],
    };
    case 'tkd': return {
      title: 'Kikuchi patterns <em>in transmission</em>',
      body: `<b>Transmission Kikuchi diffraction</b> (TKD, or t-EBSD) uses an electron-transparent lamella (~50–150 nm) held flat, with the detector <b>below</b> it. Patterns form from electrons diffracted as they leave the bottom surface, so the source volume is tiny, about <b>5–10 nm</b> laterally instead of tens of nm along a 70° slope. That resolves nanograins, like those in these copper interconnects, which conventional EBSD blurs into overlapping patterns. Same bands, same indexing, much smaller interaction volume.`,
      stats: [['Indexed', M ? `${M.done ? Math.round((100 * M.ok) / M.done) : 0} %` : '—', M ? `${M.done} / ${M.N * M.N}` : ''], ['Foil thickness', `${S.tkdThick} nm`, 'thin: sharp; thick: diffuse'], ['Lateral resolution', fmtLen(0.004 + (S.tkdThick / 1000) * 0.06), 'vs ~tens of nm in EBSD']],
    };
    case 'eds': {
      const e = sim.eds;
      return {
        title: 'Chemistry from <em>characteristic X-rays</em>',
        body: `Ionised atoms relax by emitting X-rays at element-specific energies. In a bulk sample they come from the whole <b>X-ray generation volume</b>, often a micrometre across at 15–20 kV, which sets the spatial resolution (not the probe size!). Each line needs <b>overvoltage</b> U = E₀/E<sub>c</sub> above ~1.5–2 to be excited efficiently, and low-energy lines are absorbed on their way out. The continuous background (bremsstrahlung) ends exactly at the beam energy: the <b>Duane–Hunt limit</b>, a direct check of the true kV.`,
        stats: [['X-ray range', e ? fmtLen(e.Rx) : '—', e?.mainLine ? `${e.mainLine.el} ${e.mainLine.line} in ${e.dom.name}` : ''], ['Counts', sim.acc ? Math.round(sim.acc.total).toLocaleString() : '—', sim.acc ? `${f1(sim.acc.t)} s` : ''], ['Resolution (Mn Kα)', '128 eV', 'silicon drift detector']],
      };
    }
    case 'mc': {
      const mc = sim.mc;
      if (mc?.kind === 'ion') {
        const st = mc.stats();
        return {
          title: 'Inside an <em>ion collision cascade</em>',
          body: `A <b>binary-collision Monte Carlo</b>, run live, like SRIM/TRIM: each ${P.ION[S.ion].name} ion slows down through nuclear collisions with target atoms (the Ziegler–Biersack–Littmark potential) and electronic drag. Unlike an electron it loses most of its energy to the atoms it hits: each <b>recoil</b> above the displacement energy starts its own cascade, so a single 30 keV ion knocks hundreds of atoms off their sites. Atoms that reach the surface with enough energy to break free are <b>sputtered</b>: that is how a FIB mills. The ion itself stops within a few tens of nanometres and stays there: <b>implantation</b>. Compare gallium with xenon (heavier: shorter range, more sputtering) and nitrogen or oxygen (lighter: deeper, gentler).`,
          stats: [['Sputter yield (MC)', f2(mc.Y), `atoms/ion · table ${f2(P.sputter(S.ion, mc.mKey, S.ikV).Y)}`], ['Projected range', `${f1(st.Rp)} nm`, `± ${f1(st.dRp)} nm straggle`], ['Displacements', mc.n ? Math.round(mc.vac / mc.n).toLocaleString() : '—', 'per ion (Kinchin–Pease-like)']],
        };
      }
      return {
        title: 'Inside the <em>interaction volume</em>',
        body: `A <b>Monte Carlo</b> simulation, run live: each electron takes random steps between elastic collisions with nuclei (screened Rutherford cross-section) while losing energy continuously to the electrons (Bethe/Joy–Luo stopping power). Hundreds of trajectories build the pear-shaped <b>interaction volume</b>. Those that escape through the surface are the backscattered electrons (orange). Raise the voltage and the volume balloons; switch to a heavier material and it shrinks and backscatters more. Switch the beam to <b>ions</b> to compare: an ion's cascade is a hundred times smaller.`,
        stats: [['η measured', mc ? f2(mc.eta) : '—', mc ? `Reuter: ${f2(P.eta(mc.m.Z, (S.tilt * Math.PI) / 180))}` : ''], ['Range', mc ? fmtLen(mc.R / 1000) : '—', 'Kanaya–Okayama'], ['Trajectories', mc ? mc.n.toLocaleString() : '—', mc ? mc.m.name : 'no material']],
      };
    }
    case 'fib': {
      const pr = sim.iprobe, mk = underKey(sim), y = P.sputter(S.ion, mk, S.ikV), ion = P.ION[S.ion];
      return {
        title: 'Seeing with <em>ions</em>',
        body: `A focused beam of ${ion.long} ions (${ion.name}, ${ion.src}) scans the surface like an electron probe, and each ion knocks out secondary electrons (<b>ISE</b>) and secondary ions (<b>SI</b>). The contrast differs from the SEM: grains whose open crystal directions face the beam let ions <b>channel</b> deep and look dark, so grain contrast is dramatic; oxides look dark in ISE and bright in SI; insulators charge positive. But the probe is a <b>sculptor</b>: every image sputters ~${f1(y.Y)} atoms per ion from ${P.MAT[mk].name.toLowerCase()} and implants the rest. Zoom in and watch small features erode.`,
        stats: [['Ion probe', `${f1(pr.d)} nm`, `${I(S.icur)} at ${S.ikV} kV`], ['Sputter yield', `${f2(y.Y)} atoms/ion`, `${f2(y.Yv)} µm³/nC · ${P.MAT[mk].name}`], ['Imaging erosion', sim.imgRemoved ? `${f1(sim.imgRemoved)} nm` : '—', 'removed at the field centre so far']],
      };
    }
    case 'mill': {
      const a = sim.mill.active ?? [...sim.mill.patterns].reverse().find((p) => p.kind === 'mill'), mk = underKey(sim), y = P.sputter(S.ion, mk, S.ikV);
      return {
        title: 'Sculpting with a <em>beam of ions</em>',
        body: `At ${I(S.icur)} the ${P.ION[S.ion].name} beam removes about <b>${f2(y.Yv * S.icur / 1000)} µm³ per second</b> of ${P.MAT[mk].name.toLowerCase()}. Draw a pattern on the ion image (drag) and start it. A <b>regular cross-section</b> mills a staircase, deepest at the face; a <b>cleaning cross-section</b> polishes the face line by line. The stage sits at 52° so the ion beam is normal to the surface while the electron beam (right) sees the trench face. Watch for the physics: the depth asked for assumes silicon, so other materials mill faster or slower; sputtered atoms <b>redeposit</b> on the walls of deep, narrow trenches; channelling grains mill unevenly; and milling through materials of different yield leaves <b>curtains</b> down the face, which a Pt cap and a rocking stage reduce.`,
        stats: [['Removal rate', `${f2(y.Yv * S.icur / 1000)} µm³/s`, `${f2(y.Yv)} µm³/nC in ${P.MAT[mk].name}`], ['Pattern', a ? `${a.shape} #${a.id}` : '—', a ? `${Math.round(a.done * 100)} % · ${f1(a.tEst)} s estimated` : 'drag on the ion image'], ['Instrument time', `${f1(sim.mill.time / 60)} min`, sim.millAccel > 1.5 ? `shown ${Math.round(sim.millAccel)}× faster` : 'real time']],
      };
    }
    case 'gis': {
      const J = S.icur / Math.max(1e-3, S.patW * S.patH), d = P.depositRate(S.depGas, S.depBeam, S.ion, S.depBeam === 'e' ? S.kV : S.ikV, S.depBeam === 'e' ? S.current / Math.max(1e-3, S.patW * S.patH) : J);
      return {
        title: 'Building with <em>gas and beam</em>',
        body: `The gas injection needle puffs a precursor (${P.DEP_GAS[S.depGas].name}) over the surface. Molecules stick, and the beam's secondary electrons break them: the metal stays behind in a carbon matrix. How fast it grows depends on the <b>current density</b> (right): at low density every molecule that arrives gets used (reaction-limited), at high density the beam runs out of molecules (precursor-limited), and beyond that the ions <b>sputter</b> the deposit faster than it grows. The ${S.depBeam === 'e' ? 'electron beam deposits slowly but implants nothing: the gentle first layer of a protective cap' : 'ion beam deposits fast, but implants gallium and damages the surface underneath'}.`,
        stats: [['Current density', `${f2(S.depBeam === 'e' ? S.current / Math.max(1e-3, S.patW * S.patH) : J)} pA/µm²`, S.depBeam === 'e' ? 'electron beam' : `${P.ION[S.ion].name} beam`], ['Net growth', `${f2(d.net)} µm³/nC`, d.net < 0 ? 'milling, not growing!' : `deposit ${f2(d.Yd)} − sputter ${f2(d.Ys)}`], ['Growth rate', `${f1(Math.max(0, d.net) * (S.depBeam === 'e' ? S.current : S.icur) / 1000 / Math.max(1e-3, S.patW * S.patH) * 1000)} nm/s`, `${S.patW} × ${S.patH} µm pattern`]],
      };
    }
    case 'sv': {
      const sv = sim.sv, f = sim.svFractions();
      return {
        title: 'Slice <em>and view</em>',
        body: `<b>FIB-SEM tomography</b>: the ion beam mills away a ${S.svSlice} nm slice of the face, the electron beam images the fresh face (${S.svDet.toUpperCase()} at ${S.kV} kV), and it repeats, hundreds of times, overnight. Stacking the images rebuilds the volume (right: orthogonal slices through the stack). The physics shows up as artefacts: <b>curtains</b> from milling through hard and soft phases, <b>shine-through</b> where the beam sees into pores (they look partly filled, so porosity is underestimated), and the 52° view foreshortens the face by sin 52° unless tilt-corrected.`,
        stats: [['Slices', sv ? `${sv.k} / ${S.svN}` : '—', sv ? `${fmtLen(sv.W)} × ${fmtLen(sv.Hz)} face` : ''], ['Instrument time', sv ? `${f1(sv.t / 60)} min` : '—', sv ? `mill ${f1(sv.mill / 60)} · image ${f1(sv.img / 60)} min` : ''], ['Porosity', f ? `${Math.round(f.measured[0] * 100)} % measured` : '—', f ? `true ${Math.round(f.truth[0] * 100)} %` : '']],
      };
    }
    case 'lam': {
      const L = sim.lam, q = lamQuality(L), st = LAM_STEPS[Math.min(L.step, LAM_STEPS.length - 1)], hide = !!S.mis?.hideTruth;
      return {
        title: 'Preparing a <em>TEM lamella</em>',
        body: `The FIB's signature job: cut a slice ~100 nm thin out of a chosen spot, so a transmission electron microscope can see through it. Step ${Math.min(L.step + 1, 8)} of 8: <b>${st.title}</b>. ${st.text} Thinner lamellae show more, but every pass at 30 kV leaves ~${f1(P.ionRange(S.ion, 'Si', 30).damage * 0.5)} nm of amorphous damage on each face, so the last passes are made at 5 and 2 kV. Too much current on a thin lamella bends it; misjudge the thickness and you punch through.`,
        stats: hide ? [['Step', `${Math.min(L.step + 1, 8)} / 8`, st.title], ['Time', `${f1(L.time / 60)} min`, 'instrument time'], ['Thickness', 'hidden', 'judge it from the SEM view']] : [['Thickness', `${q.t_top} nm`, `top of window · ${q.t_bottom} nm 3 µm down`], ['Damage', `${q.amorph[0]} / ${q.amorph[1]} nm`, `amorphous on each face · ${q.crystalline} nm crystal left`], ['Time', `${f1(L.time / 60)} min`, `${L.bent ? 'BENT · ' : ''}${L.hole ? 'HOLED · ' : ''}step ${Math.min(L.step + 1, 8)} / 8`]],
      };
    }
  }
}

export function changeText(key, S, sim) {
  const pr = sim.probe, m = under(sim), R = P.rangeKO(m, S.kV);
  switch (key) {
    case 'kV': return ['Accelerating voltage', `<b>${S.kV} kV</b>. Higher voltage gives a smaller probe (less chromatic blur, more brightness) but the electrons penetrate deeper: the range in ${m.name.toLowerCase()} is now <b>${fmtLen(R)}</b>. Surface detail washes out, edges glow, and BSE and X-ray resolution worsen. Low kV (1–5) is surface-sensitive and avoids charging on insulators; high kV is needed to excite K-lines of heavier elements for EDS and to get strong EBSD patterns.`];
    case 'current': return ['Probe current', `<b>${S.current >= 1000 ? f1(S.current / 1000) + ' nA' : Math.round(S.current) + ' pA'}</b>. More current means more signal and less noise, but the source must be imaged larger to deliver it: the probe grows to <b>${f1(pr.d)} nm</b>. Imaging uses pA to ~100 pA; EDS and EBSD use nA for count rate.`];
    case 'aperture': return ['Aperture', `A <b>${S.aperture} µm</b> aperture gives a convergence α = <b>${f1(pr.alpha * 1000)} mrad</b>. Small α: less aberration, larger depth of field, but the diffraction limit and lower current. Large α: more current, bigger aberration disks. The curve in In-lens mode shows the optimum.`];
    case 'wd': return ['Working distance', `<b>${S.wd} mm</b>. A shorter working distance reduces the objective’s aberrations (C<sub>s</sub> ∝ WD<sup>~1.5</sup>) and improves in-lens collection; a longer one increases depth of field and leaves room for tilting, EDS and EBSD geometry (EBSD typically uses 10–20 mm).`];
    case 'fov': return ['Magnification', `Field of view <b>${fmtLen(S.fov)}</b>, ×${Math.round(127000 / S.fov).toLocaleString()} on a 127 mm display. Each pixel is ${fmtLen(S.fov / 256)}. SEM magnification is just the ratio of display size to scanned size, so it must be calibrated against a certified pitch standard.`];
    case 'tilt': return ['Stage tilt', `Tilted <b>${S.tilt}°</b>: the electron beam meets the surface at ${S.tilt}° and the ion beam at ${Math.abs(S.tilt - P.ION_TILT)}°. At 52° the ion beam is normal to the surface and the SEM looks into milled trenches at 52°, seeing their faces. Tilting increases SE yield (secant law) and foreshortens the image by cos θ. EBSD needs ~70°.`];
    case 'coated': return ['Carbon coating', S.coated ? 'A few nm of evaporated carbon now drains the charge from insulators to ground. Charging vanishes at any kV, at the cost of burying the finest surface detail.' : 'Uncoated: insulators (alumina, silica) will charge above their second crossover E2 unless you drop the voltage.'];
    case 'focus': return ['Focus', `Defocus <b>${S.focus >= 0 ? '+' : ''}${f2(S.focus)} µm</b> spreads the probe into a disk of diameter 2α·Δf. At this α that’s <b>${fmtLen(2 * pr.alpha * Math.abs(S.focus))}</b>. Tall features also go out of focus: depth of field ≈ 2×(pixel or probe)/α.`];
    case 'stig': return ['Stigmator', `Astigmatism focuses the beam at two different heights in two directions, so under- and over-focus smear the image in perpendicular directions. The stigmator’s quadrupole field cancels it. Correct when the image is sharpest, and when going through focus no longer streaks features sideways.`];
    case 'autofocus': return ['Auto focus & stigmation', 'The software swept the focus and stigmator to maximise image sharpness (the gradient/FFT metric shown on the image), the same principle as SMART resolution measurement on a gold-on-carbon standard.'];
    case 'dwell': return ['Dwell time', `<b>${S.dwell} µs</b> per pixel: ${Math.round(S.current * 6.24 * S.dwell)} primary electrons land on each pixel. Signal-to-noise grows as √(dwell); slow scans also give insulators more time to charge and let drift smear the image.`];
    case 'etdBias': return ['ETD grid bias', S.etdBias >= 0 ? `<b>+${S.etdBias} V</b> on the Faraday cage attracts low-energy secondaries from all around, even from behind obstacles: soft shadows, mostly SE contrast.` : `<b>${S.etdBias} V</b> repels secondaries: only backscattered electrons flying straight at the detector are counted. Hard shadows, like side-lit topography.`];
    case 'bseMode':
    case 'seg': {
      const k = P.segKind(S.seg), lab = P.segLabel(S.seg);
      const txt = {
        composition: 'Summing opposite segments cancels the slope effects (a tilted facet sends more electrons to one side and fewer to the other), leaving <b>atomic-number</b> and <b>channelling</b> contrast.',
        'topography (difference)': 'Subtracting segments cancels what they have in common, atomic-number contrast, and keeps the imbalance caused by <b>surface slopes</b>: a shaded-relief image lit from the direction of the positive segment(s).',
        'mixed: composition + shading': 'An unbalanced combination: composition contrast plus a directional shading from the segments that don’t cancel. A single segment behaves like an oblique light source.',
        'no signal': 'All segments are off: nothing is detected. Click a quadrant to switch it on.',
      }[k];
      return ['BSE segments', `<b>${lab}</b>. ${txt}`];
    }
    case 'spec': return ['Specimen', sim.spec.note];
    case 'clarity': return S.clarity === 'real' ? ['Physically realistic', 'Grayscale, true shot noise at the chosen current and dwell, raw Kikuchi patterns with background, accumulated EDS counts.'] : ['Educational clarity', 'Tinted images with 12× less noise, background-corrected patterns with zone axes labelled, and clean element maps.'];
    case 'mapN': return ['Map size', `${S.mapN}×${S.mapN} points, a step of ${fmtLen(S.fov / S.mapN)}. Real EBSD maps run at hundreds to thousands of patterns per second.`];
    case 'expo': return ['Exposure', `<b>${S.expo} ms</b> per pattern. Longer exposure gives cleaner bands and higher indexing rates, but slower maps and more drift.`];
    case 'mapView': return ['Map display', { ipf: 'Inverse pole figure: colour shows which crystal direction points along the surface normal (red [001], green [101], blue [111]). Twins show as colour jumps across straight boundaries.', bc: 'Band contrast: how strong the Kikuchi bands are. It looks like an image of the microstructure: dark at boundaries, scratches and strained regions.', mad: 'Mean angular deviation: how well the detected bands fit the solution. Green is < 0.5°, red is poor.' }[S.mapView]];
    case 'tkdThick': return ['Foil thickness', `<b>${S.tkdThick} nm</b>. Too thin: few diffracted electrons and weak bands. Too thick: electrons scatter many times and patterns become diffuse. TKD works best around 50–150 nm for metals.`];
    case 'edsSel': return ['Element map', S.edsSel === 'all' ? 'All elements overlaid.' : `Mapping <b>${S.edsSel}</b>. The map is blurred by the X-ray generation volume, not the probe. Drop the kV (keeping enough overvoltage) to sharpen it.`];
    case 'mcMax': return ['Trajectories', `Up to <b>${S.mcMax.toLocaleString()}</b> electrons. The statistics (η, depth profiles) settle as √N.`];
    case 'ion': { const ion = P.ION[S.ion]; return ['Ion species', `<b>${ion.name}</b> from ${ion.src === 'LMIS' ? 'the gallium liquid-metal source: the smallest probes (~2.5 nm), but it implants and amorphises' : `the plasma source (${ion.long}): ${S.ion === 'Xe' ? 'heavy, so it sputters ~1.5–2× faster than gallium and stops in the top ~20 nm; currents to 2.5 µA for big volumes' : S.ion === 'Ar' ? 'lighter and inert: slower milling, a thinner damaged layer, popular for final polishing' : S.ion === 'O' ? 'chemically active: it burns carbon and polymers away several times faster, and boosts secondary-ion yields' : 'light and inert: slow milling, deep but gentle'}`}. Sputter yield here ${f2(P.sputter(S.ion, underKey(sim), S.ikV).Y)} atoms/ion.`]; }
    case 'icur': return ['Ion beam current', `<b>${I(S.icur)}</b> (an aperture on the strip): probe ${f1(sim.iprobe.d)} nm. Imaging and polishing use picoamps; bulk trenches use nanoamps (Ga) or hundreds of nanoamps (plasma). Material removed per second scales with current, but so does the probe size.`];
    case 'ikV': return ['Ion voltage', `<b>${S.ikV} kV</b>. Lower voltage: a larger probe, but a much thinner damaged layer (projected range ${f1(P.ionRange(S.ion, 'Si', S.ikV).Rp)} nm in Si at this energy) and fewer implanted ions. Lamellae are finished at 5 and 2 kV.`];
    case 'ifocus': return ['Ion focus', `<b>${f1(S.ifocus)} µm</b>. The ion probe converges at only ~${f2(sim.iprobe.alpha * 1000)} mrad, so its depth of field is long; focus errors show up only at high magnification, where every frame also erodes the sample.`];
    case 'istig': return ['Ion stigmator', 'An octupole corrects two-fold astigmatism of the ion probe. As with electrons, astigmatism smears the image in perpendicular directions either side of focus.'];
    case 'idwell': return ['Ion dwell', `<b>${S.idwell} µs</b> per pixel: ${f1(S.icur * 6.24 * S.idwell)} ions land on each pixel per frame. Longer dwell gives less noise but more damage.`];
    case 'fibDet': return ['Ion detector', S.fibDet === 'si' ? 'Collecting <b>secondary ions</b>: oxides and oxygen-rich surfaces light up (oxygen enhances positive-ion emission); metals look dark.' : 'Collecting <b>ion-induced secondary electrons</b>: metals bright, oxides and insulators dark, strong channelling contrast between grains.'];
    case 'flood': return ['Electron flood', S.flood ? 'A low-energy electron flood neutralises the positive charge the ions leave on insulators: oxides become visible and stop drifting.' : 'No charge neutralisation: insulators charge positive under the ion beam and hold their secondary electrons back (dark).'];
    case 'pattern': case 'patW': case 'patH': case 'patDepth': case 'shape': return ['Pattern', `<b>${({ rect: 'Rectangle', rcs: 'Regular cross-section', ccs: 'Cleaning cross-section', line: 'Line', circle: 'Circle' })[S.shape]}</b>, ${S.patW} × ${S.patH} µm, ${S.patDepth} µm deep (in silicon). Estimated ${f1((S.patDepth * S.patW * S.patH * (S.shape === 'rcs' ? 0.56 : 1)) / ((S.icur / 1000) * P.sputter(S.ion, 'Si', S.ikV, 0, S.gas === 'none' ? null : S.gas).Yv))} s at ${I(S.icur)}.`];
    case 'gas': return ['Etch gas', S.gas === 'none' ? 'Gas needle retracted: pure physical sputtering.' : S.gas === 'XeF2' ? 'XeF₂ adsorbs and the beam turns silicon, oxide and tungsten into volatile fluorides: up to ~5–10× faster milling and less redeposition. Aluminium forms a passivating fluoride and slows.' : 'Water vapour oxidises carbon to CO under the beam: carbon and polymers mill several times faster, metals hardly change.'];
    case 'depGas': case 'depBeam': case 'depThick': return ['Deposition', `${P.DEP_GAS[S.depGas].name} with the <b>${S.depBeam === 'e' ? 'electron' : 'ion'} beam</b>, ${S.depThick} µm thick. ${S.depBeam === 'e' ? 'Electron-beam deposition is ~50× slower, but implants nothing and does not damage the surface: always the first layer over a delicate site.' : 'Ion-beam deposition is fast, but the first ions sputter and implant the surface before the layer protects it.'}`];
    case 'rocking': return ['Rocking mill', S.rocking ? 'The stage rocks a few degrees either side while milling, so the beam reaches each part of the face from several directions: the curtains of one direction fill in. Standard on plasma FIBs.' : 'Rocking off: milling from one direction only.'];
    case 'realTime': return ['Time', S.realTime ? 'Patterns run in <b>real time</b>: a large trench can take an hour.' : 'Patterns run sped up so each takes ~12 s on screen; the instrument time is shown in the readout.'];
    case 'ez': return ['Stage height', `${S.ez >= 0 ? '+' : ''}${f1(S.ez)} µm from the coincidence point. Off this height the ion beam hits ${f2(Math.abs(S.ez) * Math.sin(P.ION_TILT * P.DEG))} µm away from where the electron image shows, and tilting moves the image.`];
    case 'svSlice': case 'svN': case 'svDet': return ['Slice & view', `${S.svN} slices of <b>${S.svSlice} nm</b> (voxel ${S.svSlice} nm deep), imaged with ${S.svDet.toUpperCase()} at ${S.kV} kV. Thinner slices resolve finer structure but take longer and suffer more from drift; at low kV the electrons sample only the top tens of nanometres of each face.`];
    case 'lamI': case 'lamKV': case 'lamTarget': case 'lamOver': return ['Thinning settings', `Next pass: ${I(S.lamI)} at ${S.lamKV} kV toward <b>${S.lamTarget} nm</b>, over-tilt ±${S.lamOver}°. The over-tilt makes each face's wall steeper, cancelling the natural ~1.5° taper that leaves lamellae wedge-shaped.`];
    case 'mcBeam': return ['Monte Carlo', S.mcBeam === 'ion' ? `Ions: ${P.ION[S.ion].name} at ${S.ikV} keV into the material under the beam. Nuclear collisions and recoil cascades, sputtering and implantation.` : `Electrons at ${S.kV} keV: elastic scattering and continuous energy loss build the interaction volume.`];
    case 'mcIons': return ['Ions', `Up to <b>${S.mcIons}</b> ions with their full recoil cascades.`];
    case 'mode': return null;
  }
  return null;
}

export function dataRows(S, sim) {
  const pr = sim.probe, m = under(sim);
  const rows = [
    ['Accelerating voltage', `${S.kV} kV`],
    ['Probe current', S.current >= 1000 ? `${f1(S.current / 1000)} nA` : `${Math.round(S.current)} pA`],
    ['Convergence α', `${f1(pr.alpha * 1000)} mrad`],
    ['Probe diameter', `${f1(pr.d)} nm`],
    ['  source / Cs / Cc / diffr.', `${f1(pr.dg)} / ${f1(pr.ds)} / ${f1(pr.dc)} / ${f1(pr.dd)}`],
    ['Cs / Cc at this WD', `${f2(pr.Cs * 1000)} / ${f2(pr.Cc * 1000)} mm`],
    ['Depth of field', fmtLen(2 * Math.max(S.fov / 256, pr.d / 1000) / pr.alpha)],
    ['Magnification', `×${Math.round(127000 / S.fov).toLocaleString()}`],
    ['Pixel size', fmtLen(S.fov / 256)],
    ['Material under beam', m.name],
    ['Range (K–O)', fmtLen(P.rangeKO(m, S.kV))],
    ['η / δ', `${f2(P.eta(m.Z))} / ${f2(P.delta(m, S.kV))}`],
    ['Electrons per pixel', Math.round(S.current * 6.24 * S.dwell).toLocaleString()],
  ];
  if (!m.cond) rows.push(['Charging (E2)', P.charges(m, S.kV, S.coated) ? `yes: ${S.kV} > ${m.E2} kV` : 'no']);
  const pi = sim.iprobe, y = P.sputter(S.ion, underKey(sim), S.ikV), rg = P.ionRange(S.ion, underKey(sim), S.ikV);
  rows.push(['Ion beam', `${P.ION[S.ion].name} ${S.ikV} kV, ${I(S.icur)}`], ['Ion probe', `${f1(pi.d)} nm (α ${f2(pi.alpha * 1000)} mrad)`], ['Sputter yield', `${f2(y.Y)} atoms/ion · ${f2(y.Yv)} µm³/nC`], ['Ion range / damage', `${f1(rg.Rp)} ± ${f1(rg.dRp)} nm / ${f1(rg.damage)} nm`], ['Stage', `tilt ${S.tilt}°, Z ${S.ez >= 0 ? '+' : ''}${f1(S.ez)} µm`]);
  if (sim.mill.patterns.length) rows.push(['Patterns', `${sim.mill.patterns.filter((p) => p.kind !== 'img').length} · ${f2(sim.mill.charge)} nC delivered`]);
  return rows;
}
