// Voice and typed commands: push to talk (hold M, the on-screen panel's Talk button, or the Console's talk key), or
// type in the command bar (AI mode). parseCommand() turns text into exhibit operations with a small grammar
// ("switch to xenon", "mill a cross-section", "deposit platinum", "tilt to 52", "acquire"); close misses are
// spell-corrected and confirmed first, and anything else goes to a connected AI agent (agent.js).
//
// parseCommand() is pure and runs in Node too, so the grammar is tested without a browser.

const MODES = [
  ['sv', /\b(slice\s*(and|&|n)?\s*view|serial section\w*|tomography|3\s*d reconstruction|fib\s*-?\s*sem tomography)\b/],
  ['cryo', /\b(cryo\s*-?\s*(lamella|lamellae|fib|et|mode|milling)|frozen cells? lamella|on\s*-?\s*grid lamella|cryo)\b/],
  ['lam', /\b(lamella|lamellae|lift\s*-?\s*out|tem prep\w*|tem sample)\b/],
  ['mc', /\b(monte\s*-?\s*carlo|interaction volume|collision cascade|cascade|trim|srim)\b/],
  ['tkd', /\b(tkd|transmission kikuchi|t\s*-?\s*ebsd)\b/],
  ['ebsd', /\b(ebsd|e\s*b\s*s\s*d|orientation maps?|electron backscatter diffraction)\b/],
  ['eds', /\b(eds|edx|e\s*d\s*s|x\s*-?\s*rays?|xray|element maps?)\b/],
  ['gis', /\b(deposition mode|gas injection|gis|deposit mode)\b/],
  ['mill', /\b(mill(ing)?( mode)?|patterning|sputtering mode)\b/],
  ['fib', /\b(ion image|ion imaging|fib image|ise|secondary ion image|ion beam image|focused ion beam)\b/],
  ['inlens', /\b(in\s*-?\s*lens|through\s*-?\s*the\s*-?\s*lens|tld)\b/],
  ['bse', /\b(bse|backscatter(ed)?( electrons?)?)\b/],
  ['se', /\b(se image|secondary electrons?|everhart|etd|sem image|electron image|sem mode)\b/],
];
const SPECS = [
  ['hpf', /\b(high\s*-?\s*pressure\s*-?\s*frozen|hpf|yeast paste|planchette)\b/],
  ['cell', /\b(frozen cells?|plunge\s*-?\s*frozen|yeast|vitreous|cells on (a|the) grid)\b/],
  ['nmc', /\b(battery|cathode|nmc|lithium)\b/],
  ['xs', /\b(lamella specimen|chip cross\s*-?\s*section|cross\s*-?\s*section specimen)\b/],
  ['chip', /\b(chip|microchip|integrated circuit|interconnects?|semiconductor device)\b/],
  ['ni', /\b(nickel|ni)\b/],
  ['sn', /\b(tin|sn|resolution standard)\b/],
];
const IONS = [['Ga', /\b(gallium|ga|liquid metal)\b/], ['Xe', /\b(xenon|xe)\b/], ['Ar', /\b(argon|ar)\b/], ['N', /\b(nitrogen)\b/], ['O', /\b(oxygen)\b/]];
const MODE_NAMES = { se: 'SE image', inlens: 'in-lens', bse: 'BSE', ebsd: 'EBSD', tkd: 'TKD', eds: 'EDS', fib: 'ion image', mill: 'milling', gis: 'deposition', sv: 'slice & view', lam: 'lamella', cryo: 'cryo lamella', mc: 'interaction volume' };
const SPEC_NAMES = { chip: 'the microchip', ni: 'polycrystalline nickel', sn: 'tin on carbon', nmc: 'the battery cathode', xs: 'the chip lamella', cell: 'frozen yeast cells on a grid', hpf: 'high-pressure-frozen yeast' };
const ION_NAMES = { Ga: 'gallium (LMIS)', Xe: 'xenon plasma', Ar: 'argon plasma', N: 'nitrogen plasma', O: 'oxygen plasma' };
const SHAPE_NAMES = { rect: 'rectangle', rcs: 'regular cross-section', ccs: 'cleaning cross-section', line: 'line', circle: 'circle' };

const SMALL = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordsToNumbers(text) {
  const tok = text.split(/\s+/), out = [];
  for (let i = 0; i < tok.length; i++) {
    let j = i, total = 0, cur = 0, any = false, frac = '';
    while (j < tok.length) {
      const w = tok[j];
      if (w in SMALL) cur += SMALL[w];
      else if (w in TENS) cur += TENS[w];
      else if (w === 'hundred' && any) cur *= 100;
      else if (w === 'thousand' && any) { total += cur * 1000; cur = 0; }
      else if ((w === 'point' || w === 'dot') && any && tok[j + 1] in SMALL) { while (tok[j + 1] in SMALL) { frac += SMALL[tok[j + 1]]; j++; } j++; break; }
      else if (w === 'and' && any && (tok[j + 1] in SMALL || tok[j + 1] in TENS)) { j++; continue; }
      else break;
      any = true; j++;
    }
    if (any) { out.push(String(total + cur) + (frac ? `.${frac}` : '')); i = j - 1; } else out.push(tok[i]);
  }
  return out.join(' ').replace(/\b(minus|negative)\s+(?=\d)/g, '-').replace(/\b(plus|positive)\s+(?=\d)/g, '+');
}
export function normalize(text) {
  return wordsToNumbers(String(text).toLowerCase().replace(/[−–—]/g, '-').replace(/[,!?]/g, ' ').replace(/(\d)\s*,\s*(\d)/g, '$1$2').replace(/µ/g, 'u').replace(/\s+/g, ' ').trim());
}
const NUM = String.raw`([-+]?\d+(?:\.\d+)?)`;
const num = (s) => +s;
const LEN = String.raw`\s*(nm|nanomet(?:er|re)s?|um|microns?|micromet(?:er|re)s?|mm)?`;
const toUm = (v, u) => (/^n/.test(u ?? '') ? v / 1000 : /^mm/.test(u ?? '') ? v * 1000 : v);
const CUR = String.raw`\s*(pa|pico\s*-?\s*amps?|picoamps?|na|nano\s*-?\s*amps?|nanoamps?|ua|micro\s*-?\s*amps?|microamps?)\b`;
const toPA = (v, u) => (/^n/.test(u) ? v * 1000 : /^(u|mi)/.test(u) ? v * 1e6 : v);

// text → { ops: [...] } or { ask: text }. ctx: { mode, beam ('e'|'ion'), paused }
export function parseCommand(raw, ctx = {}) {
  const t = normalize(raw);
  if (!t) return { ops: [] };
  const ops = [], has = (re) => re.test(t);
  let m;
  if (has(/^(help|what can i say|commands|voice commands)\b/)) return { ops: [{ op: 'help' }] };
  if (has(/^(stop|quiet|be quiet|stop talking|shut up|silence)$/)) return { ops: [{ op: 'stopSpeech' }] };
  if (has(/\b(what am i (looking at|seeing)|what is (this|that)|explain( this| that| it)?|describe( this| it)?|tell me about (this|it))\b/)) return { ops: [{ op: 'narrate' }] };

  // analyses: "measure the resolution", "what's the sputter yield", "how deep is the trench", "how thick is the lamella"
  const measureVerb = /\b(fit|measure|estimate|analy[sz]e|check|index|find|identify|calculate|determine|how)\b|^(what|which)\b/;
  if (measureVerb.test(t)) {
    if (/\b(resolution|probe size|sharpness|edge width)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'measure_resolution' }] };
    if (/\b(sputter(ing)? (yield|rate)|milling rate|mill rate|volume yield)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'sputter_yield' }] };
    if (/\b(depth|deep|trench|crater)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'measure_mill' }] };
    if (/\b(lamella|thick(ness)?|thin)\b/.test(t) && !/\bfoil\b/.test(t)) return { ops: [{ op: 'analyze', v: 'lamella_thickness' }] };
    if (/\b(porosity|pores|fractions?|volume fraction|phases)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'sv_fractions' }] };
    if (/\b(range|implant(ation|ed)?|damage|amorphous)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'ion_range' }] };
    if (/\b(grains?|grain size|indexing|orientations?)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'ebsd_stats' }] };
    if (/\b(eds|x\s*-?\s*ray|peaks|elements?|composition|gallium contamination)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'fit_eds' }] };
  }
  if (/^(analy[sz]e|analysis|run (an |the )?analysis|measure (this|it))\b/.test(t)) return { ops: [{ op: 'analyze', v: null }] };

  // cryo lamella: "next step", "sputter coat", "mill to 800 nm at 300 pA", "milling angle 12", "anticontaminator on"
  if (ctx.mode === 'cryo') {
    if ((m = t.match(new RegExp(String.raw`\b(?:mill|thin|polish)\w*(?:\s+(?:it|the lamella|both boxes|the boxes))?\s+(?:to|down to)\s+${NUM}${LEN}`)))) {
      const c = t.match(new RegExp(String.raw`${NUM}${CUR}`));
      return { ops: [{ op: 'cryo', v: 'mill', target: Math.round(toUm(num(m[1]), m[2] ?? 'nm') * 1000), I: c ? toPA(num(c[1]), c[2]) : undefined }] };
    }
    if (has(/\bnext step\b|\brun (the )?step\b/)) return { ops: [{ op: 'cryo', v: 'next' }] };
    if (has(/\b(sputter\s*-?\s*coat\w*|final coat\w*|coat (it|the lamella))\b/)) return { ops: [{ op: 'cryo', v: 'coat' }] };
    if (has(/\b(start over|new lamella|reset the lamella)\b/)) return { ops: [{ op: 'cryo', v: 'reset' }] };
  }
  if ((m = t.match(/\bmilling angle\s+(?:to\s+|of\s+)?(\d{1,2}(?:\.\d+)?)/))) return { ops: [{ op: 'set', k: 'cryoAngle', v: +m[1] }] };
  if (has(/\b(anti\s*-?\s*contaminator|cold shield|cryo shield)\b/)) return { ops: [{ op: 'set', k: 'anticontam', v: !has(/\b(off|out|retract|remove|disable)\b/) }] };
  if (has(/\b(relief cuts?|micro\s*-?\s*expansion joints?|expansion joints?|stress relief)\b/)) return { ops: [{ op: 'set', k: 'cryoRelief', v: !has(/\b(off|no|skip|without|disable)\b/) }] };

  // questions go to the agent
  if (has(/^(why|how|when|where|who|which|what|what's|whats|is|are|does|do|did|should|would|will|can|could|explain why|tell me (why|how|what))\b/) || /\?\s*$/.test(String(raw))) return { ask: String(raw).trim() };

  const ionHit = IONS.find(([, re]) => re.test(t));
  const specHit = SPECS.find(([, re]) => re.test(t));
  if (specHit && has(/\b(load|insert|put in|switch to|change to|use|specimen|sample|show me|go to)\b/)) ops.push({ op: 'spec', v: specHit[0] });
  // ion species: "switch to xenon", "use the oxygen plasma", "gallium beam"
  if (ionHit && !has(/\b(deposit|platinum|tungsten)\b/) && has(/\b(switch|use|change|go|select|ions?|plasma|beam|source|species|to)\b/)) ops.push({ op: 'chip', k: 'ion', v: ionHit[0] });

  // milling and deposition: "mill a cross-section", "mill a box 10 by 5 by 2 microns", "clean the face", "deposit 1 micron of platinum"
  const dims = t.match(new RegExp(String.raw`${NUM}\s*(?:by|x|×)\s*${NUM}(?:\s*(?:by|x|×)\s*${NUM})?${LEN}`));
  const dep = /\b(deposit|deposition|put down|lay down|grow)\b/.test(t) || /\b(protective (cap|layer)|pt cap|platinum cap)\b/.test(t) || /\b(electron|ion|e)\s*-?\s*beam (platinum|pt|carbon|tungsten)\b/.test(t);
  if (dep) {
    const gas = /\b(carbon)\b/.test(t) ? 'C' : /\b(tungsten|w)\b/.test(t) ? 'W' : 'Pt';
    const beam = /\b(electron|e\s*-?\s*beam|ebeam|ebid)\b/.test(t) ? 'e' : 'ion';
    const th = t.match(new RegExp(String.raw`${NUM}${LEN}\s*(?:of|thick)`));
    ops.push({ op: 'deposit', gas, beam, thick: th ? toUm(num(th[1]), th[2]) : null, w: dims ? +dims[1] : null, h: dims ? +dims[2] : null });
  } else if ((/\b(mill|cut|dig|sputter|etch|trench)\b/.test(t) || /\b(clean(ing)?|polish) (the )?(face|section|cross)/.test(t)) && !/\b(stop|pause|halt|abort)\b/.test(t)) {
    const shape = /\bcleaning\b|\bclean (the )?(face|section|cross)/.test(t) ? 'ccs' : /\bcross\s*-?\s*section|staircase|regular\b/.test(t) ? 'rcs' : /\bline\b/.test(t) ? 'line' : /\b(circle|hole|round)\b/.test(t) ? 'circle' : /\b(box|rectangle|square|pit)\b/.test(t) ? 'rect' : null;
    const gas = /\bxef2|xenon difluoride|enhanced etch\b/.test(t) ? 'XeF2' : /\b(water|h2o)\b/.test(t) ? 'H2O' : null;
    const dd = t.match(new RegExp(String.raw`${NUM}${LEN}\s*deep`)) ?? t.match(new RegExp(String.raw`\bdepth\s*(?:of\s*)?${NUM}${LEN}`));
    if (shape || dims || dd || /\b(start|begin|go|run)\b/.test(t)) {
      ops.push({ op: 'pattern', shape, gas, w: dims ? toUm(+dims[1], dims[4]) : null, h: dims ? toUm(+dims[2], dims[4]) : null, depth: dims?.[3] ? toUm(+dims[3], dims[4]) : dd ? toUm(num(dd[1]), dd[2]) : null, start: /\b(start|begin|go|run|now)\b/.test(t) || !!shape });
    }
  } else if (has(/\b(start|begin|resume)\s+(the\s+)?(milling|patterning|pattern|deposition)\b/)) ops.push({ op: 'action', v: 'millStart', said: 'Patterning started' });
  if (has(/\b(stop|pause|halt|abort)\s+(the\s+)?(milling|patterning|pattern|deposition)\b/)) ops.push({ op: 'action', v: 'millStop', said: 'Patterning stopped' });
  if (has(/\b(clear|delete|remove)\s+(the\s+|all\s+)?(patterns?|queue)\b/)) ops.push({ op: 'action', v: 'clearPatterns', said: 'Patterns cleared' });
  if (has(/\b(reset|restore|fresh|new) (the )?(specimen|sample|surface|area)\b/)) ops.push({ op: 'action', v: 'resetMill', said: 'Fresh specimen' });

  // mode (after milling so "mill a cross-section" stays a pattern)
  const modeHit = MODES.find(([, re]) => re.test(t));
  if (modeHit && !specHit && !ops.some((o) => o.op === 'pattern' || o.op === 'deposit' || o.op === 'action') && (has(/\b(switch|go|change|move|show|open|mode|take me|let's do|use|start)\b/) || t.split(' ').length <= 3)) ops.push({ op: 'mode', v: modeHit[0] });

  // lamella workflow: "next step", "thin to 100 nm", "polish at 2 kv"
  if (has(/\bnext step\b|\brun (the )?step\b/)) ops.push({ op: 'lam', v: 'next' });
  if ((m = t.match(new RegExp(String.raw`\bthin(?:\s+(?:it|the lamella))?\s+(?:to|down to)\s+${NUM}${LEN}`)))) ops.push({ op: 'lam', v: 'thin', target: Math.round(toUm(num(m[1]), m[2] ?? 'nm') * 1000) });
  if ((m = t.match(/\bpolish(?:\s+at)?\s+(\d+)\s*(?:kv|kilovolts?)\b/))) ops.push({ op: 'lam', v: 'polish', kV: +m[1] });

  // focus
  if (has(/\b(auto\s*-?\s*focus|autofocus|focus (it|the image|for me)|optimal focus)\b/)) ops.push({ op: 'action', v: 'autofocus', said: 'Auto focus' });
  else if ((m = t.match(new RegExp(String.raw`\bfocus(?:\s+(?:to|at))?\s+${NUM}${LEN}`)))) ops.push({ op: 'set', k: ctx.beam === 'ion' ? 'ifocus' : 'focus', v: toUm(num(m[1]), m[2]) });
  else if (has(/\bfocus down\b|\bunder\s*-?\s*focus\b/)) ops.push({ op: 'nudge', k: ctx.beam === 'ion' ? 'ifocus' : 'focus', d: -1 });
  else if (has(/\bfocus up\b|\bover\s*-?\s*focus\b/)) ops.push({ op: 'nudge', k: ctx.beam === 'ion' ? 'ifocus' : 'focus', d: 1 });

  // magnification
  if ((m = t.match(new RegExp(String.raw`\b(?:field of view|field|fov|horizontal field width|hfw)\s+(?:to\s+|of\s+)?${NUM}${LEN}`)))) ops.push({ op: 'set', k: 'fov', v: toUm(Math.abs(num(m[1])), m[2]) });
  else if (has(/\bzoom in\b|\b(more|increase|higher) magnification\b|\bmagnify\b/)) ops.push({ op: 'zoom', f: 1 / 1.6 });
  else if (has(/\bzoom out\b|\b(less|decrease|lower) magnification\b/)) ops.push({ op: 'zoom', f: 1.6 });

  // beam current: "ion current 300 pA", "current 1 nA", "9 nanoamps"
  if ((m = t.match(new RegExp(String.raw`${NUM}${CUR}`)))) {
    const ionBeam = /\b(ion|fib|gallium|xenon|argon|plasma|aperture)\b/.test(t) || (ctx.beam === 'ion' && !/\b(electron|e\s*-?\s*beam|sem)\b/.test(t));
    ops.push({ op: 'current', beam: ionBeam ? 'ion' : 'e', v: toPA(num(m[1]), m[2]) });
  } else if (has(/\b(more|increase|higher|raise) (the )?(current|beam current)\b/)) ops.push({ op: 'scaleCurrent', f: 1 });
  else if (has(/\b(less|decrease|lower|reduce) (the )?(current|beam current)\b/)) ops.push({ op: 'scaleCurrent', f: -1 });

  // accelerating voltage
  if ((m = t.match(/\b(\d{1,2}(?:\.\d)?)\s*-?\s*(kv|k v|kilo\s*-?\s*volts?|kilovolts?|kev)\b/))) {
    const ionBeam = /\b(ion|fib|gallium|xenon|argon|plasma|polish)\b/.test(t) || (ctx.beam === 'ion' && !/\b(electron|e\s*-?\s*beam|sem)\b/.test(t));
    if (!ops.some((o) => o.op === 'lam')) ops.push({ op: 'kv', beam: ionBeam ? 'ion' : 'e', v: +m[1] });
  }
  // stage: "tilt to 52", "eucentric height", "stage Z up 5 microns"
  if ((m = t.match(/\btilt(?:\s+(?:the\s+)?(?:stage|sample))?(?:\s+(?:to|at|by))?\s+(\d{1,2}(?:\.\d+)?)\s*(?:degrees?|°)?/))) ops.push({ op: 'set', k: 'tilt', v: +m[1] });
  else if (has(/\b(untilt|tilt (to )?(zero|flat)|flat stage)\b/)) ops.push({ op: 'set', k: 'tilt', v: 0 });
  if (has(/\b(eucentric|coincidence( point)?)\b/) && has(/\b(go|find|set|move|to|height)\b/)) ops.push({ op: 'action', v: 'eucentric', said: 'Eucentric height' });
  if ((m = t.match(new RegExp(String.raw`\b(?:stage\s+)?z\s+(up|down)\s+${NUM}${LEN}`)))) ops.push({ op: 'nudgeZ', d: (m[1] === 'up' ? 1 : -1) * toUm(num(m[2]), m[3]) });

  // gas, detector, charge neutraliser
  if (!ops.some((o) => o.op === 'pattern' || o.op === 'deposit')) {
    if (has(/\b(xef2|xenon difluoride|enhanced etch)\b/)) ops.push({ op: 'chip', k: 'gas', v: 'XeF2' });
    else if (has(/\b(water vapou?r|h2o)\b/)) ops.push({ op: 'chip', k: 'gas', v: 'H2O' });
    else if (has(/\b(no gas|gas off|retract (the )?(gis|needle))\b/)) ops.push({ op: 'chip', k: 'gas', v: 'none' });
  }
  if (has(/\b(secondary ions?|si detector|cdem)\b/) && !ops.some((o) => o.op === 'mode')) ops.push({ op: 'chip', k: 'fibDet', v: 'si' });
  else if (has(/\b(ion\s*-?\s*induced (secondary )?electrons?|ise detector)\b/)) ops.push({ op: 'chip', k: 'fibDet', v: 'ise' });
  if (has(/\b(flood gun|charge neutrali[sz]\w*|electron flood)\b/)) ops.push({ op: 'set', k: 'flood', v: !has(/\b(off|disable|stop)\b/) });
  if (has(/\brocking( mill| stage)?\b/)) ops.push({ op: 'set', k: 'rocking', v: !has(/\b(off|disable|stop|no)\b/) });

  // beam on/off
  if (has(/\b(unblank|resume|unpause|beam on|turn on the beam)\b/)) { if (ctx.paused) ops.push({ op: 'action', v: 'pause', said: 'Beam on' }); }
  else if (has(/\b(blank|turn off|block)( the)? beam\b|^pause$|\bbeam off\b/)) { if (!ctx.paused) ops.push({ op: 'action', v: 'pause', said: 'Beam blanked' }); }

  // view
  if (has(/\b(realistic|real mode|physically realistic|shot noise)\b/)) ops.push({ op: 'set', k: 'clarity', v: 'real' });
  else if (has(/\b(educational|clean view|clarity mode)\b/)) ops.push({ op: 'set', k: 'clarity', v: 'edu' });
  if (has(/\b(training|training mode|start a task)\b/)) ops.push({ op: 'training' });
  if (has(/\b(show|turn on) (the )?labels\b/)) ops.push({ op: 'set', k: 'showLabels', v: true });
  else if (has(/\b(hide|turn off) (the )?labels\b/)) ops.push({ op: 'set', k: 'showLabels', v: false });
  if (has(/\bnext mode\b/)) ops.push({ op: 'cycle', d: 1 });
  else if (has(/\bprevious mode\b|\blast mode\b/)) ops.push({ op: 'cycle', d: -1 });
  if (has(/\b(export|download)( the)? (data|numpy|npz)\b/)) ops.push({ op: 'export' });
  if (has(/\b(acquire|capture|snap)\b|\b(take|record|grab|save)\s+(an?\s+|the\s+|this\s+)?(image|picture|photo|frame|spectrum|pattern|shot|acquisition)\b/)) ops.push({ op: 'acquire' });
  return ops.length ? { ops } : { ask: String(raw).trim() };
}

export const HELP = 'Try: "cryo lamella", "mill to 800 nm at 300 pA", "switch to xenon", "ion current 1 nA", "tilt to 52", "mill a cross-section", "clean the face", "deposit 1 micron of platinum", "slice and view", "next step", "thin to 100 nm", "5 kV", "zoom in", "acquire". Measure: "what is the sputter yield?", "how deep is the trench?", "measure the resolution", "measure the porosity". Or ask a question.';
const ANALYSIS_NAMES = { measure_resolution: 'Measure the resolution', measure_mill: 'Measure the milled depth and volume', sputter_yield: 'Sputter yield of the last pattern', fit_eds: 'Fit the EDS peaks', ebsd_stats: 'EBSD statistics', sv_fractions: 'Phase fractions from slice & view', lamella_thickness: 'Lamella thickness', cryo_quality: 'Cryo lamella thickness and quality', ion_range: 'Ion range and damage depth' };
export const EXAMPLES = ['switch to xenon', 'use the oxygen plasma', 'ion current 1 nA', 'ion current 30 pA', 'tilt to 52', 'eucentric height', 'mill a cross-section', 'mill a box 10 by 5 by 2 microns', 'clean the face', 'stop milling', 'deposit 1 micron of platinum', 'electron beam platinum', 'enhanced etch', 'rocking mill on', 'flood gun on', 'secondary ions', 'slice and view', 'lamella', 'next step', 'thin to 100 nm', 'polish at 5 kV', 'cryo lamella', 'load the frozen cells', 'sputter coat', 'milling angle 12', 'mill to 800 nm at 300 pA', 'anticontaminator on', 'relief cuts on', 'ion image', 'monte carlo', 'load the battery cathode', 'load nickel', '5 kV', 'zoom in', 'field of view 20 microns', 'auto focus', 'acquire', 'measure the resolution', 'what is the sputter yield?', 'how deep is the trench?', 'how thick is the lamella?', 'measure the porosity', 'what is the ion range?', 'fit the EDS peaks', 'analyze', 'what am I looking at?', 'help'];

// ------------------------------------------------------------------ near misses: correct, suggest, then confirm
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'me', 'please', 'can', 'you', 'it', 'this', 'and', 'my', 'for', 'with', 'now']);
const EXTRA = ['cryo', 'frozen', 'vitreous', 'yeast', 'sputter', 'coat', 'angle', 'anticontaminator', 'relief', 'se', 'bse', 'ebsd', 'tkd', 'eds', 'ion', 'image', 'mill', 'milling', 'deposit', 'deposition', 'platinum', 'tungsten', 'carbon', 'gallium', 'xenon', 'argon', 'nitrogen', 'oxygen',
  'plasma', 'current', 'tilt', 'eucentric', 'cross', 'section', 'cleaning', 'clean', 'face', 'rectangle', 'box', 'circle', 'line', 'trench', 'lamella', 'thin', 'polish', 'slice', 'view',
  'tomography', 'monte', 'carlo', 'cascade', 'battery', 'cathode', 'nickel', 'tin', 'chip', 'microchip', 'focus', 'autofocus', 'zoom', 'magnification', 'field', 'acquire', 'capture',
  'measure', 'resolution', 'sputter', 'yield', 'depth', 'deep', 'thickness', 'porosity', 'range', 'analyze', 'fit', 'peaks', 'help', 'stop', 'start', 'next', 'step', 'previous',
  'mode', 'realistic', 'educational', 'labels', 'export', 'training', 'flood', 'rocking', 'etch', 'water', 'microns', 'nanometers', 'kv', 'pa', 'na', 'stage', 'beam', 'blank', 'unblank'];
let VOCAB = null;
const vocab = () => VOCAB ?? (VOCAB = new Set([...EXAMPLES.flatMap((e) => normalize(e).split(' ')), ...EXTRA].filter((w) => !/\d/.test(w))));
function lev(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const wsim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

// replace misspelled words by the closest vocabulary word ("swich to stm" → "switch to stem")
export function correct(raw) {
  const words = normalize(raw).split(' '), V = vocab();
  let changed = false;
  const out = words.map((w) => {
    if (w.length < 3 || /\d/.test(w) || STOP.has(w) || V.has(w)) return w;
    let best = w, bs = 0;
    for (const v of V) { const sc = wsim(w, v); if (sc > bs) { bs = sc; best = v; } }
    if (bs >= 0.6 && best !== w) { changed = true; return best; }
    return w;
  });
  return { text: out.join(' '), changed };
}

// the closest known commands, with the visitor's own numbers carried over
function closestExamples(raw, ctx, k = 3) {
  const inW = normalize(raw).split(' ').filter((w) => !STOP.has(w));
  const nums = inW.filter((w) => /^[-+]?\d/.test(w));
  const scored = EXAMPLES.map((ex) => {
    const exW = normalize(ex).split(' ').filter((w) => !STOP.has(w) && !/\d/.test(w));
    if (!exW.length) return [ex, 0];
    const sc = exW.reduce((a, w) => a + Math.max(0, ...inW.map((x) => wsim(w, x))), 0) / exW.length;
    let n = 0, text = ex;
    if (nums.length) text = ex.replace(/[-+]?\d+(\.\d+)?/g, (m) => (n < nums.length ? nums[n++] : m));
    return [text, sc];
  }).filter(([, sc]) => sc >= 0.55).sort((a, b) => b[1] - a[1]);
  const seen = new Set(), out = [];
  for (const [text] of scored) {
    if (seen.has(text)) continue; seen.add(text);
    const r = parseCommand(text, ctx);
    if (r.ops) out.push({ text, ops: r.ops });
    if (out.length >= k) break;
  }
  return out;
}

const QUESTION = /^(why|how|when|where|who|which|what|is|are|does|do|did|should|would|will|explain|tell me)\b/;
// exact command → run; near miss → options to confirm; otherwise a question for the agent
export function interpret(raw, ctx = {}) {
  const r = parseCommand(raw, ctx);
  if (r.ops) return { exact: true, ops: r.ops };
  const c = correct(raw);
  if (c.changed) { const r2 = parseCommand(c.text, ctx); if (r2.ops) return { exact: false, options: [{ text: c.text, ops: r2.ops }] }; }
  const isQuestion = QUESTION.test(normalize(raw)) || /\?\s*$/.test(raw);
  const options = isQuestion && ctx.agent ? [] : closestExamples(c.text, ctx);
  return options.length ? { exact: false, options, question: isQuestion } : { ask: String(raw).trim() };
}

// describe what an op did, for the caption under the microphone
export function describe(op) {
  const fmtI = (pA) => (pA >= 1e6 ? `${+(pA / 1e6).toFixed(2)} µA` : pA >= 1000 ? `${+(pA / 1000).toFixed(2)} nA` : `${+pA.toFixed(1)} pA`);
  switch (op.op) {
    case 'mode': return `Mode: ${MODE_NAMES[op.v]}`;
    case 'spec': return `Specimen: ${SPEC_NAMES[op.v]}`;
    case 'set': return op.k === 'fov' ? `Field of view ${op.v} µm` : op.k === 'tilt' ? `Stage tilt ${op.v}°` : op.k === 'focus' || op.k === 'ifocus' ? `Focus ${op.v} µm` : op.k === 'clarity' ? (op.v === 'real' ? 'Physically realistic view' : 'Educational view')
      : op.k === 'showLabels' ? (op.v ? 'Labels on' : 'Labels off') : op.k === 'flood' ? `Electron flood ${op.v ? 'on' : 'off'}` : op.k === 'rocking' ? `Rocking mill ${op.v ? 'on' : 'off'}` : op.k === 'cryoAngle' ? `Milling angle ${op.v}°` : op.k === 'anticontam' ? `Anticontaminator ${op.v ? 'in' : 'out'}` : op.k === 'cryoRelief' ? `Relief cuts ${op.v ? 'on' : 'off'}` : `${op.k} ${op.v}`;
    case 'chip': return op.k === 'ion' ? `Ion species: ${ION_NAMES[op.v]}` : op.k === 'gas' ? (op.v === 'none' ? 'Gas off' : `Gas: ${op.v === 'XeF2' ? 'XeF₂ enhanced etch' : 'water vapour'}`) : op.k === 'fibDet' ? (op.v === 'si' ? 'Detector: secondary ions' : 'Detector: ion-induced electrons') : `${op.k} ${op.v}`;
    case 'current': return `${op.beam === 'ion' ? 'Ion' : 'Electron'} current ${fmtI(op.v)}`;
    case 'scaleCurrent': return op.f > 0 ? 'More current' : 'Less current';
    case 'kv': return `${op.beam === 'ion' ? 'Ion' : 'Electron'} beam ${op.v} kV`;
    case 'nudge': return op.d < 0 ? 'Focus down' : 'Focus up';
    case 'nudgeZ': return `Stage Z ${op.d > 0 ? '+' : ''}${op.d} µm`;
    case 'zoom': return op.f < 1 ? 'Zoom in' : 'Zoom out';
    case 'pattern': return `Pattern: ${SHAPE_NAMES[op.shape] ?? 'as set'}${op.w ? ` ${op.w} × ${op.h} µm` : ''}${op.depth ? `, ${op.depth} µm deep` : ''}${op.gas ? `, ${op.gas}` : ''}${op.start ? ' · started' : ''}`;
    case 'deposit': return `Deposit ${op.gas}${op.thick ? ` ${op.thick} µm` : ''} with the ${op.beam === 'e' ? 'electron' : 'ion'} beam`;
    case 'cryo': return op.v === 'next' ? 'Cryo lamella: next step' : op.v === 'mill' ? `Mill both boxes to ${op.target} nm${op.I ? ` at ${fmtI(op.I)}` : ''}` : op.v === 'coat' ? 'Sputter coat' : 'New cryo lamella';
    case 'lam': return op.v === 'next' ? 'Lamella: next step' : op.v === 'thin' ? `Thin the lamella to ${op.target} nm` : `Polish at ${op.kV} kV`;
    case 'action': return op.said ?? op.v;
    case 'acquire': return 'Acquired';
    case 'narrate': return 'Explaining this mode';
    case 'training': return 'Training';
    case 'help': return HELP;
    case 'analyze': return op.result ? op.result.summary : op.error ?? ANALYSIS_NAMES[op.v] ?? 'Analyze what is on screen';
    case 'cycle': return op.d > 0 ? 'Next mode' : 'Previous mode';
    case 'export': return 'Exporting the data';
    case 'stopSpeech': return 'Stopped';
    default: return '';
  }
}

// ------------------------------------------------------------------------------------------------ browser side
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

export class Voice {
  // api: { ctx(), run(op), agent: { connected, utterance(text) }, onEvent(kind, data) }
  constructor(api) {
    this.api = api; this.rec = null; this.listening = false; this.text = ''; this.final = '';
    const R = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    this.Recognition = R || null;
  }
  get supported() { return !!this.Recognition; }

  // the first time: say what happens to the audio, and ask
  consent() {
    if (store('fib-voice-ok') === '1') return Promise.resolve(true);
    return new Promise((resolve) => {
      const m = this.bubble(`<b>Voice commands</b><p>Hold <kbd>M</kbd> (or the Talk key) and speak; release to send. Your browser's speech recognition turns it into text. In Chrome and Edge the audio is sent to Google's or Microsoft's speech service; Safari may process it on the device. Nothing is recorded by this exhibit, and the microphone is only on while you hold the key.</p>
        <div class="vrow"><button class="btn primary" id="vOk">Turn on voice</button><button class="btn" id="vNo">Not now</button></div>`, true);
      m.querySelector('#vOk').onclick = () => { store('fib-voice-ok', '1'); this.hide(); resolve(true); };
      m.querySelector('#vNo').onclick = () => { this.hide(); resolve(false); };
    });
  }

  async start() {
    if (this.listening) return;
    if (!this.supported) { this.bubble('<b>Voice commands</b><p>This browser has no speech recognition. Use Chrome, Edge or Safari, or type a command below.</p>' + this.typeBox()); this.wireType(); return; }
    if (!(await this.consent())) return;
    const rec = new this.Recognition();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    this.text = ''; this.final = ''; this.rec = rec; this.listening = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) this.final += r[0].transcript + ' '; else interim += r[0].transcript; }
      this.text = (this.final + interim).trim();
      this.bubble(`<span class="mic on"></span><i>${esc(this.text) || 'Listening…'}</i>`);
    };
    rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') this.bubble(`<b>Voice</b><p>${e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in the browser\'s site settings to use voice.' : `Speech recognition stopped (${esc(e.error)}).`}</p>`); this.listening = false; };
    rec.onend = () => { const said = (this.final || this.text).trim(); this.listening = false; this.rec = null; if (this.releasing) { this.releasing = false; this.handle(said); } };
    this.bubble('<span class="mic on"></span><i>Listening…</i>');
    this.api.onEvent?.('listening', true);
    try { rec.start(); } catch { this.listening = false; }
  }
  stop() {
    if (!this.rec) return;
    this.releasing = true;
    try { this.rec.stop(); } catch { /* already stopped */ }
    this.api.onEvent?.('listening', false);
  }

  // run a sentence: exact commands run; near misses are confirmed first; everything else goes to the agent
  handle(text, typed = false) {
    text = String(text ?? '').trim();
    if (!text) { if (!typed) this.flash('<i>Didn\'t hear anything.</i>'); return; }
    const t = normalize(text);
    if (this.pending && Date.now() < this.pending.until) {
      const p = this.pending, pick = /^(yes|yeah|yep|yup|correct|right|ok|okay|sure|do it|go( ahead)?|confirm|y|1|first( one)?|the first( one)?)$/.test(t) ? 0
        : /^(2|second( one)?|the second( one)?)$/.test(t) ? 1 : /^(3|third( one)?|the third( one)?)$/.test(t) ? 2 : -1;
      if (pick >= 0 && p.options[pick]) { this.pending = null; this.runOps(p.options[pick].ops, p.options[pick].text, typed); return; }
      if (/^(no|nope|n|cancel|never mind|nevermind|wrong|neither|none)$/.test(t)) { this.pending = null; this.flash('<i>Cancelled.</i>', 2000); return; }
      this.pending = null; // a new sentence replaces the question
    }
    const r = interpret(text, { ...this.api.ctx(), agent: !!this.api.agent?.connected });
    if (r.exact) { this.runOps(r.ops, text, typed); return; }
    if (r.options) { this.confirm(text, r.options, typed); return; }
    this.api.onEvent?.('voice', { intent: 'ask', ok: !!this.api.agent?.connected });
    if (this.api.agent?.connected) { this.api.agent.utterance(text); this.flash(`<span class="mic${typed ? ' typed' : ''}"></span><i>“${esc(text)}”</i><b>Asked the agent…</b>`, 4000); }
    else this.flash(`<span class="mic${typed ? ' typed' : ''}"></span><i>“${esc(text)}”</i><p>That isn't a command I know. ${esc(HELP)}</p>`, 9000);
  }

  runOps(ops, text, typed) {
    const lines = ops.map((op) => { this.api.run(op); return describe(op); }).filter(Boolean);
    this.api.onEvent?.('voice', { intent: ops.map((o) => o.op + (o.v !== undefined && o.v !== null ? `:${o.v}` : o.k ? `:${o.k}` : '')).join(','), ok: true });
    const long = ops.some((o) => o.op === 'help' || o.op === 'analyze');
    this.flash(`<span class="mic${typed ? ' typed' : ''}"></span><i>“${esc(text)}”</i><b>${esc(lines.join(' · '))}</b>`, long ? 12000 : 3500);
  }

  // "Did you mean …?" with buttons; answer by clicking, or by saying/typing yes, no, or "the second one"
  confirm(text, options, typed) {
    this.pending = { options, until: Date.now() + 30000 };
    const agentBtn = this.api.agent?.connected ? '<button class="btn" data-c="agent">Ask the agent instead</button>' : '';
    const el = this.bubble(`<span class="mic${typed ? ' typed' : ''}"></span><i>“${esc(text)}”</i><b>Did you mean${options.length > 1 ? ' one of these' : ''}?</b>
      <div class="vrow">${options.map((o, i) => `<button class="btn${i ? '' : ' primary'}" data-c="${i}">${esc(o.text)} <small>${esc(o.ops.map(describe).join(' · '))}</small></button>`).join('')}
      <button class="btn" data-c="no">No</button>${agentBtn}</div><p>Click, or say or type “yes”${options.length > 1 ? ', “the second one”' : ''} or “no”.</p>`, true);
    el.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => {
      const c = b.dataset.c, p = this.pending; this.pending = null;
      if (c === 'no') this.flash('<i>Cancelled.</i>', 2000);
      else if (c === 'agent') { this.api.agent.utterance(text); this.flash(`<i>“${esc(text)}”</i><b>Asked the agent…</b>`, 4000); }
      else if (p?.options[+c]) this.runOps(p.options[+c].ops, p.options[+c].text, typed);
    }; });
    this.tm = setTimeout(() => { if (this.pending) { this.pending = null; this.hide(); } }, 30000);
  }

  // Esc: cancel a question, stop listening, close the caption
  escape() {
    this.pending = null; clearTimeout(this.tm);
    if (this.rec) { this.releasing = false; try { this.rec.abort(); } catch { /* not running */ } this.rec = null; this.listening = false; this.api.onEvent?.('listening', false); }
    this.hide();
  }

  typeBox() { return '<form class="vtype"><input id="vText" type="text" placeholder="Type a command, e.g. mill a cross-section" autocomplete="off"><button class="btn">Send</button></form>'; }
  wireType() { const f = this.el?.querySelector('form.vtype'); if (f) f.onsubmit = (e) => { e.preventDefault(); const v = f.querySelector('input').value; this.handle(v); }; }

  bubble(html, sticky = false) {
    if (!this.el) { this.el = document.createElement('div'); this.el.id = 'voiceBubble'; this.el.className = 'card voicebubble'; this.el.setAttribute('role', 'status'); document.body.appendChild(this.el); }
    clearTimeout(this.tm); this.el.innerHTML = html; this.el.hidden = false; this.sticky = sticky;
    return this.el;
  }
  flash(html, ms = 3500) { this.bubble(html); this.tm = setTimeout(() => this.hide(), ms); }
  hide() { if (this.el) this.el.hidden = true; }
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
