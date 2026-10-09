const MAP = process.argv[2] || "city"; process.argv = process.argv.slice(0, 2).concat(["--none"]);
const { P, simCity, simFarm, PLAYERS, sessions } = await import('./model.mjs');
const target = { 4: 0.5, 5: 1, 6: 2, 7: 3, 8: 4, 9: 5.5, 10: 7, 11: 9, 12: 12, 13: 15, 14: 18, 15: 22, 16: 26, 17: 30, 18: 35, 19: 42, 20: 50 };
const first = sessions(PLAYERS.thuong, 1)[0][0];
const sig2 = (x) => { const m = 10 ** (Math.floor(Math.log10(x)) - 1); return Math.round(x / m) * m; };
const map = MAP;
const fn = map === 'city' ? simCity : simFarm;
let cum = P.xpCumMap[map] ? [...P.xpCumMap[map]] : map === 'city'
  ? [0,0,40,150,340,1300,2600,3900,5200,6500,7800,11000,15000,21000,29000,40000,55000,73000,98000,140000,190000,380000]
  : [0,0,40,120,220,740,1700,3300,5300,8400,13000,21000,31000,43000,57000,73000,92000,110000,140000,180000,230000,460000];
for (let it = 0; it < 6; it++) {
  P.xpCumMap[map] = cum;
  const r = fn(PLAYERS.thuong, 55);
  const got = (L) => r.levelAt[L] != null ? (r.levelAt[L] - first) / 1440 : 60;
  // điều chỉnh nhân: cấp đến sớm hơn mục tiêu → tăng ngưỡng (theo tỉ lệ thời gian, có hãm)
  const n = [...cum];
  for (let L = 5; L <= 20; L++) { const ratio = (target[L] + 0.3) / (got(L) + 0.3); n[L] = cum[L] * Math.min(1.6, Math.max(0.6, ratio ** 0.6)); }
  for (let L = 5; L <= 20; L++) { const step = n[L - 1] - n[L - 2]; if (n[L] - n[L - 1] < step) n[L] = n[L - 1] + step; }
  for (let L = 5; L <= 20; L++) n[L] = Math.max(n[L - 1] + 10, sig2(n[L]));
  n[21] = n[20] * 2; cum = n;
  const err = Object.keys(target).reduce((s, L) => s + Math.abs(Math.log((got(L) + 0.3) / (target[L] + 0.3))), 0);
  console.log(it, err.toFixed(2), JSON.stringify(cum.slice(2, 21)));
}
