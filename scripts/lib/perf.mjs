// Shared, noise-resistant performance helpers for QA scripts.
// Headless Chrome FPS is noisy (GPU scheduling, GC, shader compile, warm-up), so:
//  - always warm up before sampling,
//  - take several samples and use the median of sample medians,
//  - gate regressions on draw calls / triangles (deterministic); keep FPS floors tolerant,
//  - compare "before vs after" only through interleaved A/B rounds (see compareInterleaved).

const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

/** Warm up with rAF for warmupMs, then take `samples` x `framesPerSample` frame-time samples. */
export async function measureFps(page, { warmupMs = 1500, samples = 5, framesPerSample = 120 } = {}) {
  const r = await page.evaluate(async ({ warmupMs, samples, framesPerSample }) => {
    const raf = () => new Promise(res => window.requestAnimationFrame(res));
    const w0 = window.performance.now();
    while (window.performance.now() - w0 < warmupMs) await raf();
    const sampleMed = []; const all = [];
    for (let s = 0; s < samples; s++) {
      const t = []; let last = window.performance.now();
      for (let i = 0; i < framesPerSample; i++) { await raf(); const n = window.performance.now(); t.push(n - last); last = n; }
      all.push(...t);
      t.sort((a, b) => a - b);
      sampleMed.push(t[Math.floor(t.length / 2)]);
    }
    all.sort((a, b) => a - b);
    return { sampleMed, p95Ms: all[Math.floor(all.length * 0.95)] };
  }, { warmupMs, samples, framesPerSample });
  const fpsList = r.sampleMed.map(ms => 1000 / ms);
  return {
    fps: +median(fpsList).toFixed(1),
    p95Ms: +r.p95Ms.toFixed(1),
    min: +Math.min(...fpsList).toFixed(1),
    max: +Math.max(...fpsList).toFixed(1),
    spread: +(Math.max(...fpsList) - Math.min(...fpsList)).toFixed(1),
    samples: fpsList.map(f => +f.toFixed(1)),
  };
}

/**
 * Interleaved A/B comparison on one page. `setA`/`setB` switch the page state;
 * each round measures A then B (order alternates to cancel drift). Returns medians and noise.
 */
export async function compareInterleaved(page, setA, setB, { rounds = 3, ...opts } = {}) {
  const a = []; const b = [];
  for (let i = 0; i < rounds; i++) {
    const order = i % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
    for (const k of order) {
      await (k === 'A' ? setA() : setB());
      (k === 'A' ? a : b).push(await measureFps(page, opts));
    }
  }
  const fa = a.map(x => x.fps); const fb = b.map(x => x.fps);
  return {
    fpsA: +median(fa).toFixed(1), fpsB: +median(fb).toFixed(1), drop: +(median(fa) - median(fb)).toFixed(1),
    spreadA: +(Math.max(...fa) - Math.min(...fa)).toFixed(1), spreadB: +(Math.max(...fb) - Math.min(...fb)).toFixed(1),
    roundsA: fa, roundsB: fb,
  };
}
