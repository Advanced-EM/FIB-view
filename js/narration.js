// Voice narration with the browser's speech synthesis: a speaker button on the mode panel and on every component
// card, and an Auto-narrate toggle (N) that reads each mode and component as you open it. Two levels, General (for a
// broad audience) and Physics (the card's physics and metrology), in a female or a male voice when the system has both.
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
const plain = (html) => String(html).replace(/<sub>(.*?)<\/sub>/g, ' $1').replace(/<sup>(.*?)<\/sup>/g, ' to the $1').replace(/<[^>]+>/g, '').replace(/&amp;/g, 'and')
  .replace(/≈/g, 'about ').replace(/×/g, ' times ').replace(/µm/g, ' micrometres').replace(/\bnm\b/g, ' nanometres').replace(/\bkV\b/g, ' kilovolts').replace(/\bpA\b/g, ' picoamps').replace(/\bnA\b/g, ' nanoamps')
  .replace(/Ga⁺/g, 'gallium ions').replace(/Xe⁺/g, 'xenon ions').replace(/→/g, ' to ').replace(/\s+/g, ' ').trim();

const FEMALE = /(female|samantha|victoria|karen|moira|tessa|serena|zira|aria|jenny|susan|fiona|allison|ava|google us english|google uk english female)/i;
const MALE = /(male|daniel|alex|fred|oliver|arthur|guy|david|mark|george|ryan|google uk english male|tom)/i;

export class Narrator {
  // text(key, level) → html to read; onState(key | null) when playback starts or ends
  constructor({ text, onState }) {
    this.text = text; this.onState = onState;
    this.level = store('fib-narr-level') ?? 'general';
    this.voice = store('fib-narr-voice') ?? 'female';
    this.cur = null;
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  }
  get supported() { return !!this.synth; }
  setLevel(l) { this.level = l; store('fib-narr-level', l); }
  setVoice(v) { this.voice = v; store('fib-narr-voice', v); }
  pickVoice() {
    const vs = this.synth?.getVoices().filter((v) => /^en/i.test(v.lang)) ?? [];
    const re = this.voice === 'male' ? MALE : FEMALE;
    return vs.find((v) => re.test(v.name) && !(this.voice === 'female' && /male/i.test(v.name) && !/female/i.test(v.name))) ?? vs[0] ?? null;
  }
  speak(key) {
    if (!this.synth) return;
    if (this.cur === key) { this.stop(); return; }
    const t = plain(this.text(key, this.level) ?? '');
    if (!t) return;
    this.sayText(t, key);
  }
  sayText(text, key = 'text') {
    if (!this.synth) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(plain(text));
    const v = this.pickVoice();
    if (v) u.voice = v;
    u.rate = 1.02; u.pitch = this.voice === 'male' ? 0.95 : 1.05;
    u.onend = u.onerror = () => { if (this.cur === key) { this.cur = null; this.onState?.(null); } };
    this.cur = key; this.onState?.(key);
    this.synth.speak(u);
  }
  stop() { this.synth?.cancel(); const k = this.cur; this.cur = null; if (k) this.onState?.(null); }
  playing() { return this.cur; }
}
