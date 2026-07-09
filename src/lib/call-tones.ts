// Tons de chamada sintetizados via Web Audio API
// - Ringtone (entrante): dois tons alternando (estilo telefone), loop com pausa
// - Dial tone (saindo): tom duplo 440/480Hz padrão americano, com cadência de ring

type Stoppable = { stop: () => void };

function createCtx(): AudioContext | null {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    return new AC();
  } catch {
    return null;
  }
}

/** Ringtone estilo celular para chamada entrante. */
export function playIncomingRingtone(): Stoppable {
  const ctx = createCtx();
  if (!ctx) return { stop: () => {} };

  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = "sine";
  osc2.type = "sine";
  osc1.frequency.value = 800;
  osc2.frequency.value = 1000;
  osc1.connect(gain);
  osc2.connect(gain);
  osc1.start();
  osc2.start();

  let stopped = false;
  const start = ctx.currentTime;
  const cycle = 2.0; // 2s: 1s tocando (alternando), 1s silêncio
  const totalCycles = 60; // ~2 min máx

  for (let i = 0; i < totalCycles; i++) {
    const t0 = start + i * cycle;
    // 4 batidas curtas alternando os osciladores
    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * 0.22;
      gain.gain.setValueAtTime(0.0001, tb);
      gain.gain.exponentialRampToValueAtTime(0.25, tb + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, tb + 0.18);
    }
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { gain.gain.cancelScheduledValues(ctx.currentTime); } catch {}
      try { gain.gain.setValueAtTime(0, ctx.currentTime); } catch {}
      try { osc1.stop(); osc2.stop(); } catch {}
      try { ctx.close(); } catch {}
    },
  };
}

/** Dial tone com cadência de "chamando" para chamada de saída. */
export function playOutgoingDialTone(): Stoppable {
  const ctx = createCtx();
  if (!ctx) return { stop: () => {} };

  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = "sine";
  osc2.type = "sine";
  osc1.frequency.value = 440;
  osc2.frequency.value = 480;
  osc1.connect(gain);
  osc2.connect(gain);
  osc1.start();
  osc2.start();

  let stopped = false;
  const start = ctx.currentTime;
  const cycle = 6.0; // padrão BR: ~1s tom, ~4s silêncio
  const totalCycles = 20;

  for (let i = 0; i < totalCycles; i++) {
    const t0 = start + i * cycle;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.05);
    gain.gain.setValueAtTime(0.2, t0 + 1.0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { gain.gain.cancelScheduledValues(ctx.currentTime); } catch {}
      try { gain.gain.setValueAtTime(0, ctx.currentTime); } catch {}
      try { osc1.stop(); osc2.stop(); } catch {}
      try { ctx.close(); } catch {}
    },
  };
}
