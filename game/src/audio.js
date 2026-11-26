// Synthesised audio for Nusa Airlift — Web Audio only, zero audio files.
// Engine drone follows throttle, wind rush follows airspeed, plus small SFX.
export function createAudio() {
  const audio = {
    ctx: null, engineOsc: null, engineOsc2: null, engineGain: null,
    windSource: null, windGain: null, windFilter: null,
    muted: false, started: false,
  };

  function ensure() {
    if (audio.started) return true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      const ctx = new Ctx();
      audio.ctx = ctx;

      // Engine: two detuned saws through a low-pass, gain follows throttle.
      audio.engineGain = ctx.createGain();
      audio.engineGain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      audio.engineOsc = ctx.createOscillator();
      audio.engineOsc.type = 'sawtooth';
      audio.engineOsc.frequency.value = 62;
      audio.engineOsc2 = ctx.createOscillator();
      audio.engineOsc2.type = 'sawtooth';
      audio.engineOsc2.frequency.value = 93;
      const osc2Gain = ctx.createGain();
      osc2Gain.gain.value = 0.4;
      audio.engineOsc.connect(filter);
      audio.engineOsc2.connect(osc2Gain);
      osc2Gain.connect(filter);
      filter.connect(audio.engineGain);
      audio.engineGain.connect(ctx.destination);
      audio.engineOsc.start();
      audio.engineOsc2.start();

      // Wind: looped noise through a band-pass, gain follows airspeed.
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
      audio.windSource = ctx.createBufferSource();
      audio.windSource.buffer = buffer;
      audio.windSource.loop = true;
      audio.windFilter = ctx.createBiquadFilter();
      audio.windFilter.type = 'bandpass';
      audio.windFilter.frequency.value = 700;
      audio.windFilter.Q.value = 0.6;
      audio.windGain = ctx.createGain();
      audio.windGain.gain.value = 0;
      audio.windSource.connect(audio.windFilter);
      audio.windFilter.connect(audio.windGain);
      audio.windGain.connect(ctx.destination);
      audio.windSource.start();

      audio.started = true;
      return true;
    } catch {
      return false;
    }
  }

  function blip(freq, dur, type, gainValue, when = 0) {
    if (!audio.ctx || audio.muted) return;
    const t = audio.ctx.currentTime + when;
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(gainValue, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(audio.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  return {
    unlock() { ensure(); if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume(); },
    update(throttle, speed, stalled) {
      if (!audio.started || audio.muted || !audio.ctx) return;
      const t = audio.ctx.currentTime;
      const rpm = 55 + throttle * 95;
      audio.engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
      audio.engineOsc2.frequency.setTargetAtTime(rpm * 1.5, t, 0.08);
      audio.engineGain.gain.setTargetAtTime(0.05 + throttle * 0.11, t, 0.1);
      audio.windGain.gain.setTargetAtTime(Math.min(0.16, speed * 0.0016), t, 0.15);
      audio.windFilter.frequency.setTargetAtTime(400 + speed * 9, t, 0.15);
    },
    ring() { blip(880, 0.5, 'sine', 0.16); blip(1318, 0.6, 'sine', 0.12, 0.09); },
    stall() { blip(220, 0.18, 'square', 0.08); blip(220, 0.18, 'square', 0.08, 0.22); },
    touchdown() { blip(90, 0.25, 'sine', 0.22); },
    crash() { blip(70, 0.7, 'sawtooth', 0.2); },
    click() { blip(660, 0.08, 'sine', 0.1); },
    setMuted(m) { audio.muted = m; if (audio.ctx && audio.engineGain) audio.engineGain.gain.value = m ? 0 : 0.08; },
  };
}
