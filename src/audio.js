// Procedural sound design — everything is synthesized with WebAudio,
// no external audio files.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.combat = 0; // 0..1 combat intensity, drives the music
    this._musicTimer = null;
    this._step = 0;
  }

  init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.master);
    this._noiseBuf = this._makeNoise();
    this._startAmbience();
    this._startMusic();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _makeNoise() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noise(dur, { freq = 1200, q = 1, gain = 0.5, type = 'lowpass', attack = 0.002 } = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + dur + 0.05);
  }

  _tone(dur, { from = 440, to = null, type = 'square', gain = 0.3, attack = 0.002 } = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---- SFX ----
  revolver() {
    this._noise(0.16, { freq: 2600, gain: 0.8, type: 'bandpass', q: 0.6 });
    this._noise(0.3, { freq: 300, gain: 0.6 });
    this._tone(0.08, { from: 900, to: 120, type: 'sawtooth', gain: 0.25 });
  }
  charged() {
    this._noise(0.35, { freq: 3200, gain: 0.9, type: 'bandpass', q: 0.5 });
    this._tone(0.35, { from: 1600, to: 60, type: 'sawtooth', gain: 0.4 });
    this._noise(0.5, { freq: 200, gain: 0.7 });
  }
  charging(t01) {
    this._tone(0.06, { from: 300 + t01 * 900, type: 'sine', gain: 0.12 });
  }
  shotgun() {
    this._noise(0.45, { freq: 500, gain: 1.0 });
    this._noise(0.15, { freq: 2000, gain: 0.7, type: 'bandpass', q: 0.4 });
    this._tone(0.2, { from: 300, to: 50, type: 'sawtooth', gain: 0.4 });
  }
  pump() {
    this._noise(0.06, { freq: 1500, gain: 0.25, type: 'highpass' });
    setTimeout(() => this._noise(0.06, { freq: 1200, gain: 0.3, type: 'highpass' }), 90);
  }
  hitmarker() { this._tone(0.05, { from: 2200, to: 1800, type: 'square', gain: 0.14 }); }
  kill() { this._tone(0.12, { from: 1400, to: 500, type: 'square', gain: 0.2 }); }
  enemyHurt() { this._noise(0.15, { freq: 700, gain: 0.3, type: 'bandpass', q: 2 }); this._tone(0.15, { from: 300, to: 150, type: 'sawtooth', gain: 0.12 }); }
  enemyDie() {
    this._noise(0.4, { freq: 400, gain: 0.5 });
    this._tone(0.35, { from: 260, to: 40, type: 'sawtooth', gain: 0.25 });
  }
  playerHurt() {
    this._tone(0.2, { from: 220, to: 90, type: 'square', gain: 0.35 });
    this._noise(0.25, { freq: 350, gain: 0.4 });
  }
  dash() { this._noise(0.18, { freq: 2500, gain: 0.3, type: 'highpass', attack: 0.01 }); }
  jump() { this._noise(0.08, { freq: 900, gain: 0.12 }); }
  land() { this._noise(0.1, { freq: 250, gain: 0.2 }); }
  slam() { this._noise(0.4, { freq: 180, gain: 0.9 }); this._tone(0.3, { from: 140, to: 30, type: 'sine', gain: 0.6 }); }
  slide() { this._noise(0.25, { freq: 1400, gain: 0.15, type: 'highpass', attack: 0.03 }); }
  door() {
    this._noise(0.7, { freq: 220, gain: 0.35, attack: 0.05 });
    this._tone(0.7, { from: 70, to: 110, type: 'sawtooth', gain: 0.12, attack: 0.05 });
  }
  pickup() {
    this._tone(0.1, { from: 700, to: 900, type: 'square', gain: 0.2 });
    setTimeout(() => this._tone(0.15, { from: 1100, to: 1400, type: 'square', gain: 0.2 }), 90);
  }
  secret() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this._tone(0.18, { from: f, type: 'triangle', gain: 0.25 }), i * 110));
  }
  rankUp(i) { this._tone(0.15, { from: 500 + i * 160, to: 700 + i * 200, type: 'square', gain: 0.22 }); }
  wardenRoar() {
    this._tone(0.9, { from: 90, to: 45, type: 'sawtooth', gain: 0.5, attack: 0.08 });
    this._noise(0.9, { freq: 300, gain: 0.5, attack: 0.08 });
  }
  projShoot() { this._tone(0.15, { from: 800, to: 300, type: 'sawtooth', gain: 0.18 }); }
  parryBreak() { this._noise(0.12, { freq: 3000, gain: 0.3, type: 'bandpass', q: 1.5 }); }
  punchWhoosh() { this._noise(0.12, { freq: 1200, gain: 0.22, type: 'bandpass', q: 0.8, attack: 0.01 }); }
  punchHit() {
    this._noise(0.1, { freq: 450, gain: 0.5 });
    this._tone(0.09, { from: 220, to: 90, type: 'square', gain: 0.2 });
  }
  parry() {
    // bright triumphant ding
    this._tone(0.25, { from: 1320, type: 'triangle', gain: 0.35 });
    this._tone(0.3, { from: 1980, type: 'sine', gain: 0.22 });
    this._noise(0.15, { freq: 5000, gain: 0.25, type: 'highpass' });
    setTimeout(() => this._tone(0.22, { from: 1760, to: 2200, type: 'triangle', gain: 0.25 }), 70);
  }
  parryPing() { this._tone(0.12, { from: 1500, to: 1900, type: 'sine', gain: 0.2 }); }
  glassBreak() {
    this._noise(0.3, { freq: 4500, gain: 0.5, type: 'highpass' });
    this._noise(0.15, { freq: 2500, gain: 0.35, type: 'bandpass', q: 1.2 });
    setTimeout(() => this._noise(0.12, { freq: 5000, gain: 0.2, type: 'highpass' }), 90);
  }
  plankBreak() {
    this._noise(0.2, { freq: 500, gain: 0.55 });
    this._noise(0.12, { freq: 1400, gain: 0.3, type: 'bandpass', q: 1.5 });
    this._tone(0.12, { from: 180, to: 70, type: 'square', gain: 0.2 });
  }
  checkpoint() { this._tone(0.3, { from: 440, to: 880, type: 'triangle', gain: 0.25 }); }

  // ---- ambience: low rumbling drone ----
  _startAmbience() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.05; g.connect(this.master);
    for (const f of [40, 55, 41.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120;
      o.connect(lp); lp.connect(g); o.start();
    }
  }

  // ---- combat music: simple driving synth loop, intensity follows this.combat ----
  _startMusic() {
    const bpm = 148;
    const stepDur = 60 / bpm / 2; // 8th notes
    // Phrygian-ish bass line for menace
    const bass = [0, 0, 1, 0, 3, 0, 1, 0, 0, 0, -2, 0, 3, 5, 3, 1];
    const root = 41.2; // E1
    this._musicTimer = setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const amt = this.combat;
      this.musicGain.gain.setTargetAtTime(0.12 + amt * 0.3, ctx.currentTime, 0.4);
      if (amt < 0.05) { this._step = 0; return; }
      const s = this._step++ % 16;
      const t = ctx.currentTime;
      // kick on quarters
      if (s % 4 === 0) {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.9 * amt, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.2);
      }
      // hat on off-beats
      if (s % 2 === 1 && amt > 0.4) {
        const src = ctx.createBufferSource(); src.buffer = this._noiseBuf;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.15 * amt, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(hp); hp.connect(g); g.connect(this.musicGain);
        src.start(t); src.stop(t + 0.08);
      }
      // bass
      const semis = bass[s];
      const f = root * Math.pow(2, semis / 12);
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = 200 + amt * 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22 * amt, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.9);
      o.connect(lp); lp.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + stepDur);
    }, stepDur * 1000);
  }
}
