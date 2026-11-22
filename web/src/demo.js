// Génère une courbe de charge fictive (pas 30 min) pour essayer l'application sans compte.
// Profil : talon ~250 W, pics matin/soir, chauffe-eau la nuit en heures creuses, chauffage l'hiver.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function demoPoints({ days = 365, end = new Date() } = {}) {
  const rand = rng(42);
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  const start = endUtc - days * 86_400_000;
  const points = [];
  for (let t = start + 30 * 60_000; t <= endUtc; t += 30 * 60_000) {
    const d = new Date(t - 60_000);
    const h = d.getUTCHours() + d.getUTCMinutes() / 60;
    const doy = (d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000;
    const winter = Math.max(0, Math.cos((2 * Math.PI * (doy - 15)) / 365)); // 1 en janvier, 0 en été
    const weekend = [0, 6].includes(d.getUTCDay());
    let w = 250 + 80 * rand();
    if (h >= 6.5 && h < 8.5 && !weekend) w += 900 * rand() + 400;
    if (h >= 11.5 && h < 13.5 && weekend) w += 1200 * rand();
    if (h >= 18.5 && h < 21.5) w += 1100 * rand() + 500;
    if (h >= 1 && h < 4) w += 2000; // chauffe-eau en heures creuses
    if (h >= 6 && h < 23) w += winter * (1500 + 1500 * rand());
    if (rand() < 0.01) w += 3500 * rand(); // four, lave-linge...
    points.push({ t: new Date(t), v: Math.round(w) });
  }
  return points;
}
