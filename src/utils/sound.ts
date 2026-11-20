import type { Role } from '../shared/types.ts';

class NoirSoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  playPhaseChime(type: 'night' | 'dawn' | 'day' | 'vote' | 'win') {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const freqs =
      type === 'night'
        ? [220, 164.8]
        : type === 'dawn'
          ? [293.6, 369.9, 440]
          : type === 'vote'
            ? [330, 392]
            : type === 'win'
              ? [261.6, 329.6, 392, 523.2]
              : [261.6, 329.6];

    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type === 'night' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.09);
      gain.gain.setValueAtTime(0.001, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.06, now + idx * 0.09 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.09 + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.6);
    });
  }

  playClick() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.05);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playSavedPulse() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [392, 523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.11);
      gain.gain.setValueAtTime(0.001, now + i * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.07, now + i * 0.11 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.65);
    });
  }

  playDeathSequence(role: Role | 'unknown') {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (role === 'doctor') {
      // Heartbeat pulse followed by eerie flatline
      const beats = [0, 0.28];
      beats.forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(98, now + offset);
        osc.frequency.exponentialRampToValueAtTime(55, now + offset + 0.14);
        gain.gain.setValueAtTime(0.11, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.18);
      });
      const flat = ctx.createOscillator();
      const fgain = ctx.createGain();
      flat.type = 'sine';
      flat.frequency.setValueAtTime(880, now + 0.55);
      fgain.gain.setValueAtTime(0.001, now + 0.55);
      fgain.gain.linearRampToValueAtTime(0.055, now + 0.6);
      fgain.gain.exponentialRampToValueAtTime(0.0001, now + 2.1);
      flat.connect(fgain);
      fgain.connect(ctx.destination);
      flat.start(now + 0.55);
      flat.stop(now + 2.15);
      return;
    }

    if (role === 'detective') {
      // Glass shatter / descending minor chime
      [740, 622, 466, 311].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.07, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.55);
      });
      return;
    }

    // Mafia / Civilian / Unknown: low dramatic thud + descending noir chord
    const thud = ctx.createOscillator();
    const tGain = ctx.createGain();
    thud.type = 'sawtooth';
    thud.frequency.setValueAtTime(role === 'mafia' ? 140 : 110, now);
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.45);
    tGain.gain.setValueAtTime(0.1, now);
    tGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    thud.connect(tGain);
    tGain.connect(ctx.destination);
    thud.start(now);
    thud.stop(now + 0.55);

    const chord = role === 'mafia' ? [196, 233.08, 293.66] : [174.61, 207.65, 261.63];
    chord.forEach((f) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + 0.15);
      gain.gain.setValueAtTime(0.001, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + 0.15);
      osc.stop(now + 1.45);
    });
  }
}

export const soundEngine = new NoirSoundEngine();
