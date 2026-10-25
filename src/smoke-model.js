/*
 * A deterministic Gaussian-puff approximation, not a CFD or weather forecast.
 * Metres: x = east, y = altitude, z = north. Wind directions describe flow TO.
 * Smoke is released at positions supplied by the same ballistic fireworks model.
 * Diffusion increases variance by 2 K t. After each short source emission ends,
 * optical amount is conserved for the first 60 seconds: column optical depth
 * falls as 1 / variance. Faint older puffs smoothly retire over 15 seconds to
 * bound the visualization history; that retirement is a rendering approximation.
 * The displayed density multiplier changes optical amount, with Beer–Lambert
 * opacity (1 - exp(-optical depth)); 500% therefore need not be 5 times alpha.
 */
(function (root) {
  'use strict';

  const MAX_PUFFS = 768;
  const MAX_AGE = 75;
  const descriptorCaches = new WeakMap();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const kinds = {
    ascent: { sigma: 2.8, opticalDepth: 0.14, diffusion: 1.2, buoyancy: 0.7, cooling: 6, emission: 0.35 },
    burst: { sigma: 7, opticalDepth: 0.22, diffusion: 2.2, buoyancy: 1.5, cooling: 10, emission: 0.25 },
    child: { sigma: 4.2, opticalDepth: 0.17, diffusion: 1.8, buoyancy: 1.1, cooling: 8, emission: 0.25 },
    star: { sigma: 3.6, opticalDepth: 0.16, diffusion: 1.5, buoyancy: 0.8, cooling: 7, emission: 0.55 }
  };

  function seedFor(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return hash >>> 0;
  }

  function windSettings(options) {
    const windSpeed = clamp(finite(options.windSpeed, 4), 0, 20);
    const windDirection = ((finite(options.windDirection, 90) % 360) + 360) % 360;
    return { windSpeed, windDirection };
  }

  function descriptors(events, wind, time) {
    const model = root.FireworksModel;
    if (!model || typeof model.smokeSources !== 'function') return [];
    let cache = descriptorCaches.get(events);
    if (!cache) { cache = new Map(); descriptorCaches.set(events, cache); }
    const key = `${wind.windSpeed}/${wind.windDirection}`;
    let eventCache = cache.get(key);
    if (!eventCache) { eventCache = new Map(); cache.set(key, eventCache); }
    while (cache.size > 3) cache.delete(cache.keys().next().value);
    const result = [];
    for (const event of events) {
      const launch = finite(event.launch, 0);
      const lastEmission = finite(event.burst, launch + 30) + finite(event.life, 0);
      if (launch > time || lastEmission + MAX_AGE < time) continue;
      if (eventCache.has(event.id)) { result.push(...eventCache.get(event.id)); continue; }
      const eventPuffs = [];
      // No independently prescribed ascent curve: both trails and delayed child
      // bursts use their real trajectory and velocity at the emission instant.
      for (const source of model.smokeSources(event, wind)) {
        if (![source.birth, source.x, source.y, source.z].every(Number.isFinite)) continue;
        const profile = kinds[source.kind] || kinds.star;
        const seed = seedFor(`${event.id}/${source.id}`);
        const variation = 0.9 + (seed % 1000) / 5000;
        const variance = (profile.sigma * variation) ** 2;
        const strength = Math.max(0, finite(source.strength, 1));
        eventPuffs.push({
          id: `${event.id}-smoke-${source.id}`, eventId: event.id,
          birth: source.birth, x: source.x, y: source.y, z: source.z,
          vx: finite(source.vx, Math.sin(wind.windDirection * Math.PI / 180) * wind.windSpeed),
          vy: finite(source.vy, 0),
          vz: finite(source.vz, Math.cos(wind.windDirection * Math.PI / 180) * wind.windSpeed),
          variance, opticalAmount: profile.opticalDepth * variance * strength,
          diffusion: profile.diffusion * variation,
          buoyancy: profile.buoyancy * variation, cooling: profile.cooling,
          emission: profile.emission, momentumTime: 0.22, seed
        });
      }
      eventCache.set(event.id, eventPuffs);
      result.push(...eventPuffs);
    }
    // Generate only events whose smoke can exist at this time, caching each
    // independently. Seeking and wind changes never simulate future launches.
    return result;
  }

  function sample(time, events, options = {}) {
    if (!Array.isArray(events)) return [];
    options = options || {};
    const t = clamp(finite(time, 0), 0, finite(root.FireworksModel && root.FireworksModel.duration, 300));
    const density = clamp(finite(options.density, 1), 0, 5);
    if (density === 0) return [];
    const wind = windSettings(options);
    const direction = wind.windDirection * Math.PI / 180;
    const windX = Math.sin(direction) * wind.windSpeed;
    const windZ = Math.cos(direction) * wind.windSpeed;
    const puffs = [];
    for (const puff of descriptors(events, wind, t)) {
      const age = t - puff.birth;
      if (age < 0) continue;
      if (age > MAX_AGE) continue;
      const variance = puff.variance + 2 * puff.diffusion * age;
      const emission = clamp(age / puff.emission, 0, 1);
      const retirementProgress = clamp((age - 60) / 15, 0, 1);
      const retirement = 1 - retirementProgress * retirementProgress * (3 - 2 * retirementProgress);
      const opticalDepth = density * puff.opticalAmount * emission * retirement / variance;
      const opacity = -Math.expm1(-opticalDepth);
      if (opacity < 0.0005) continue;
      // Rapid entrainment relaxes the emitted smoke toward the ambient wind.
      // Its inherited momentum is integrated analytically, as is a decaying
      // buoyant velocity that approximates cooling of the hot plume.
      const momentum = puff.momentumTime * -Math.expm1(-age / puff.momentumTime);
      const buoyantRise = puff.buoyancy * puff.cooling * -Math.expm1(-age / puff.cooling);
      puffs.push({
        id: puff.id, eventId: puff.eventId,
        x: puff.x + windX * age + (puff.vx - windX) * momentum,
        y: Math.max(0, puff.y + puff.vy * momentum + buoyantRise),
        z: puff.z + windZ * age + (puff.vz - windZ) * momentum,
        radius: 3 * Math.sqrt(variance), opacity, seed: puff.seed
      });
    }
    // A practical rendering bound, retaining the most optically visible puffs.
    // Normally the full 75-second history fits; no density- or wind-randomness.
    if (puffs.length > MAX_PUFFS) {
      puffs.sort((a, b) => b.opacity - a.opacity || a.id.localeCompare(b.id));
      puffs.length = MAX_PUFFS;
    }
    return puffs;
  }

  root.HanabiSmoke = Object.freeze({ sample });
})(typeof window !== 'undefined' ? window : globalThis);
