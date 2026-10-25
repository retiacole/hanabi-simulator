// Independent regression checks for the actual fireworks integrator and event
// sampling. Numerical benchmarks below use closed-form limiting cases, rather
// than reproducing the implementation's numerical update equations.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const context = vm.createContext({ console, performance });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'fireworks-model.js'), 'utf8'), context);
const model = context.FireworksModel;
const checks = [];
const measurements = {};
const json = value => JSON.stringify(value);
const check = (name, fn) => { fn(); checks.push(name); };
const near = (value, expected, tolerance, label) => assert(Math.abs(value - expected) <= tolerance,
  `${label}: ${value} vs expected ${expected} (tolerance ${tolerance})`);
const options = { windSpeed: 4, windDirection: 90 };
const expectedTypes = ['sphere', 'ring', 'willow', 'doubleShell', 'palm', 'fan', 'saturn', 'bouquet', 'goldenWillow', 'multicolorPistil'];

check('exactly ten requested types; heart, star and helix removed', () => {
  assert.equal(model.types.length, 10);
  assert.equal(json(Array.from(model.types, type => type.id).sort()), json(expectedTypes.slice().sort()));
  assert.equal(new Set(model.events.map(event => event.id)).size, model.events.length);
  for (const event of model.events) assert(expectedTypes.includes(event.type), `unexpected event type ${event.type}`);
});

check('all ten forms repeat at both launch sites', () => {
  assert.equal(model.sites.length, 2);
  for (const type of expectedTypes) {
    for (const site of model.sites) {
      assert(model.events.some(event => event.site === site.id && event.type === type), `${type} missing from ${site.id}`);
    }
  }
});

check('inspection times contain the selected type', () => {
  for (const type of expectedTypes) {
    const study = model.studyTimes[type];
    assert(study && Number.isFinite(study.time));
    const event = model.events.find(event => event.id === study.eventId);
    assert.equal(event.type, type);
    const sample = model.sample(study.time, options);
    assert(sample.sparks.some(spark => spark.eventId === event.id), `${type} inspection has no live particles`);
  }
});

check('arbitrary forward/backward seeks are deterministic', () => {
  const times = [0, 8.125, 27.937, 64.3, 96.5, 151.777, 172.431, 179.999];
  const snapshots = times.map(time => json(model.sample(time, options)));
  for (let i = times.length - 1; i >= 0; i--) assert.equal(json(model.sample(times[i], options)), snapshots[i]);
  model.sample(94.12, { windSpeed: 12, windDirection: 270 });
  for (let i = 0; i < times.length; i++) assert.equal(json(model.sample(times[i], options)), snapshots[i], `seek at ${times[i]} after changing wind`);
});

check('sampled positions and alpha stay finite across the complete show', () => {
  let peakSparks = 0, peakRockets = 0;
  const started = performance.now();
  for (let time = 0; time <= model.duration; time += 0.5) {
    const sample = model.sample(time, options);
    peakSparks = Math.max(peakSparks, sample.sparks.length);
    peakRockets = Math.max(peakRockets, sample.rockets.length);
    for (const group of [sample.rockets, sample.sparks, sample.bursts]) {
      for (const particle of group) {
        for (const name of ['x', 'y', 'z']) assert(Number.isFinite(particle[name]), `${name} non-finite at ${time}`);
        if (particle.alpha !== undefined) assert(particle.alpha >= 0 && particle.alpha <= 1 && Number.isFinite(particle.alpha));
      }
    }
    for (const particle of sample.sparks) {
      for (const name of ['px', 'py', 'pz']) assert(Number.isFinite(particle[name]));
      assert(particle.y > 0, 'glowing star continues below sea level');
    }
  }
  measurements.fullShowSamplesMs = performance.now() - started;
  measurements.peakSparks = peakSparks;
  measurements.peakRockets = peakRockets;
});

check('three-minute endpoint clears active fireworks', () => {
  near(model.duration, 180, 0, 'show duration');
  for (const time of [180, 181, 999]) {
    const sample = model.sample(time, options);
    assert.equal(sample.rockets.length, 0);
    assert.equal(sample.sparks.length, 0);
    assert.equal(sample.bursts.length, 0);
  }
});

check('zero-drag numerical trajectory agrees with analytic gravity', () => {
  const initial = { x: 12, y: 700, z: -4, vx: 13, vy: 57, vz: -8 };
  const time = 4.37, gravity = 9.81;
  const result = model.physics.integrate(initial, time, { ballisticK: 0 }, { gravity, windSpeed: 12, windDirection: 270 });
  for (const axis of ['x', 'z']) {
    near(result[axis], initial[axis] + initial['v' + axis] * time, 1e-7, `zero-drag ${axis}`);
    near(result['v' + axis], initial['v' + axis], 1e-9, `zero-drag v${axis}`);
  }
  near(result.y, initial.y + initial.vy * time - gravity * time * time / 2, 1e-7, 'zero-drag y');
  near(result.vy, initial.vy - gravity * time, 1e-7, 'zero-drag vy');
});

check('quadratic drag against moving air agrees with exact one-dimensional solution', () => {
  const initial = { x: 4, y: 100, z: -3, vx: 63, vy: 0, vz: 0 };
  const wind = 8, k = 0.011, time = 3.2, relative = initial.vx - wind;
  const result = model.physics.integrate(initial, time, { ballisticK: k }, { gravity: 0, windSpeed: wind, windDirection: 90 });
  const expectedVelocity = wind + relative / (1 + k * Math.abs(relative) * time);
  const expectedPosition = initial.x + wind * time + Math.sign(relative) * Math.log1p(k * Math.abs(relative) * time) / k;
  near(result.vx, expectedVelocity, 0.002, 'wind-relative quadratic drag vx');
  near(result.x, expectedPosition, 0.006, 'wind-relative quadratic drag x');
  near(result.y, initial.y, 1e-9, 'no-gravity altitude');
  near(result.z, initial.z, 1e-8, 'orthogonal displacement');
  measurements.quadraticBenchmarkError = { position: Math.abs(result.x - expectedPosition), velocity: Math.abs(result.vx - expectedVelocity) };
});

check('vertical release agrees with exact quadratic-drag terminal approach', () => {
  const initial = { x: 0, y: 600, z: 0, vx: 0, vy: 0, vz: 0 };
  const g = 9.81, k = 0.009, time = 5.2, terminalSpeed = Math.sqrt(g / k);
  const result = model.physics.integrate(initial, time, { ballisticK: k }, { gravity: g, windSpeed: 0 });
  near(result.vy, -terminalSpeed * Math.tanh(Math.sqrt(g * k) * time), 0.003, 'quadratic falling velocity');
  near(result.y, initial.y - Math.log(Math.cosh(Math.sqrt(g * k) * time)) / k, 0.006, 'quadratic falling altitude');
  assert(Math.abs(result.vy) < terminalSpeed, 'release from rest exceeds terminal speed');
});

check('air drag entrains particles without creating relative kinetic energy', () => {
  const wind = 12;
  for (const initialVx of [-30, 0, wind, 50]) {
    const initial = { x: 0, y: 100, z: 0, vx: initialVx, vy: 0, vz: 0 };
    const result = model.physics.integrate(initial, 4, { ballisticK: 0.025 }, { gravity: 0, windSpeed: wind, windDirection: 90 });
    assert(Math.abs(result.vx - wind) <= Math.abs(initialVx - wind) + 1e-10);
    if (initialVx < wind) assert(result.vx >= initialVx && result.vx <= wind);
    if (initialVx > wind) assert(result.vx <= initialVx && result.vx >= wind);
    if (initialVx === wind) near(result.vx, wind, 1e-10, 'comoving air has no drag');
  }
});

check('fixed-step integration converges toward a finer independent run', () => {
  const initial = { x: 0, y: 600, z: 0, vx: 18, vy: 48, vz: -6 };
  const body = { ballisticK: 0.012, burnTime: 0 }, wind = { windSpeed: 8, windDirection: 123 };
  const integrate = step => model.physics.integrate(initial, 5.3, body, wind, step);
  const reference = integrate(1 / 1440), coarse = integrate(1 / 30), fine = integrate(1 / 60);
  const error = state => Math.hypot(...['x', 'y', 'z', 'vx', 'vy', 'vz'].map(key => state[key] - reference[key]));
  const coarseError = error(coarse), fineError = error(fine);
  assert(fineError < coarseError * 0.4, `halving dt should reduce midpoint error: ${coarseError} -> ${fineError}`);
  assert(fineError < 0.01, `1/60 step physical state error unexpectedly large: ${fineError}`);
  measurements.convergence = { coarseError, fineError, ratio: coarseError / fineError };
});

check('burning mass loss increases the drag acceleration per unit mass', () => {
  const initial = { x: 0, y: 500, z: 0, vx: 30, vy: 0, vz: 0 };
  const base = { ballisticK: 0.01 }, wind = { windSpeed: 0, gravity: 0 };
  const constant = model.physics.integrate(initial, 3, base, wind);
  const burning = model.physics.integrate(initial, 3, { ...base, burnTime: 4, residualMassFraction: 0.35 }, wind);
  assert(burning.vx < constant.vx, 'shrinking sphere should have higher area/mass drag factor');
  assert(burning.x < constant.x, 'burning particle should travel less than otherwise identical fixed mass particle');
});

check('shells, child shells and stars share continuous positions and inherited velocities', () => {
  let starsChecked = 0, childrenChecked = 0, groundChecked = 0;
  const selected = expectedTypes.map(type => model.events.find(event => event.type === type));
  for (const event of selected) {
    const diagnostic = model.physics.eventState(event, options);
    assert(diagnostic.stars.length > 0, `${event.type} has no simulated stars`);
    for (const star of diagnostic.stars) {
      const parent = star.parentState;
      assert(parent, `${event.type} diagnostics omitted parent state`);
      for (const axis of ['x', 'y', 'z']) {
        near(star.initial[axis], parent[axis], 1e-9, `${event.type} star birth ${axis}`);
        const velocity = 'v' + axis;
        near(star.initial[velocity], parent[velocity] + star.relativeVelocity[velocity], 1e-9, `${event.type} velocity inheritance ${velocity}`);
      }
      if (star.sourceKind === 'burst') {
        near(star.birth, diagnostic.burst.time, 1e-9, 'main burst birth time');
        for (const axis of ['x', 'y', 'z']) near(parent[axis], diagnostic.burst.state[axis], 1e-9, 'main shell burst origin');
      } else if (star.sourceKind === 'child') {
        const child = diagnostic.children[star.parentIndex];
        assert(child, 'child star points to a missing child shell');
        near(star.birth, child.burst, 1e-9, 'child burst birth time');
        for (const axis of ['x', 'y', 'z']) near(parent[axis], child.burstState[axis], 1e-9, 'child shell burst origin');
      } else if (star.sourceKind === 'ground') {
        assert.equal(event.type, 'fan', 'only the fan launches ground comets');
        near(star.birth, event.launch, 1e-9, 'ground comet launch time');
        near(star.initial.y, 2, 1e-9, 'ground comet launch altitude');
        groundChecked++;
      } else assert.fail(`unknown source kind ${star.sourceKind}`);
      starsChecked++;
    }
    for (const child of diagnostic.children) {
      assert(child.burst > child.birth, 'child shell must fly before opening');
      near(child.birth, diagnostic.burst.time, 1e-9, 'child shell emission time');
      for (const axis of ['x', 'y', 'z']) {
        near(child.initial[axis], diagnostic.burst.state[axis], 1e-9, 'child initial origin');
        const velocity = 'v' + axis;
        near(child.initial[velocity], diagnostic.burst.state[velocity] + child.relativeVelocity[velocity], 1e-9, 'child inherited velocity');
      }
      childrenChecked++;
    }
  }
  assert(starsChecked > 100, 'too few star births checked');
  assert(childrenChecked > 1, 'bouquet should contain multiple physical child shells');
  assert(groundChecked > 1, 'fan should contain multiple ground comets');
  measurements.birthContinuity = { starsChecked, childrenChecked, groundChecked };
});

check('bouquet opens children at separated locations and delayed times', () => {
  const event = model.events.find(event => event.type === 'bouquet');
  const diagnostic = model.physics.eventState(event, options);
  const childOrigins = diagnostic.children.map(child => child.burstState);
  const originSet = new Set(childOrigins.map(origin => [origin.x, origin.y, origin.z].map(value => value.toFixed(3)).join('/')));
  assert.equal(originSet.size, childOrigins.length, 'bouquet children must have different physical origins');
  const delays = diagnostic.children.map(child => child.burst - diagnostic.burst.time);
  assert(Math.min(...delays) > 0.1, 'bouquet child delay should be visible');
  assert(Math.max(...delays) - Math.min(...delays) > 0.05, 'children should open at different times');
  assert(childOrigins.some(origin => Math.hypot(origin.x - diagnostic.burst.state.x, origin.y - diagnostic.burst.state.y, origin.z - diagnostic.burst.state.z) > 5));
  measurements.bouquet = { children: childOrigins.length, minimumDelay: Math.min(...delays), maximumDelay: Math.max(...delays) };
});

check('wind changes the simulated launch and sparks with smoke-independent options', () => {
  const event = model.events.find(event => event.type === 'sphere');
  const calm = model.physics.eventState(event, { windSpeed: 0, windDirection: 90 });
  const east = model.physics.eventState(event, { windSpeed: 12, windDirection: 90 });
  const west = model.physics.eventState(event, { windSpeed: 12, windDirection: 270 });
  assert(east.burst.state.x > calm.burst.state.x, 'east wind should displace launch to east');
  assert(west.burst.state.x < calm.burst.state.x, 'west wind should displace launch to west');
  const time = event.burst + Math.min(event.life * 0.5, 2);
  const noWind = model.sample(time, { windSpeed: 0, windDirection: 90 });
  const wind = model.sample(time, { windSpeed: 12, windDirection: 90 });
  assert.notEqual(json(wind.sparks), json(noWind.sparks), 'wind must change fireworks even without smoke rendering');
});

check('rendered star coordinates follow the same integrated physical trajectories', () => {
  let maximumError = 0, count = 0;
  for (const type of expectedTypes) {
    const event = model.events.find(candidate => candidate.type === type);
    const diagnostic = model.physics.eventState(event, options), time = event.burst + 2.17;
    const visible = model.sample(time, options).sparks.filter(spark => spark.eventId === event.id && spark.kind === 'star');
    assert.equal(visible.length, diagnostic.stars.length, `${type} early sample should contain every primary star`);
    for (let i = 0; i < visible.length; i++) {
      const star = diagnostic.stars[i];
      const expected = model.physics.integrate(star.initial, time - star.birth, star.body, options);
      const error = Math.hypot(...['x', 'y', 'z'].map(axis => visible[i][axis] - expected[axis]));
      assert(error < 0.002, `${type} actual rendered particle disagrees with integrator by ${error} m`);
      maximumError = Math.max(maximumError, error); count++;
    }
  }
  measurements.renderedTrajectoryAgreement = { count, maximumError };
});

check('scheduled fireworks can finish burning naturally before show cutoff', () => {
  const latestLifetimeEnd = Math.max(...model.events.map(event => event.burst + event.life));
  assert(latestLifetimeEnd < model.duration, `the show truncates a physical burn at ${latestLifetimeEnd}`);
  measurements.latestLifetimeEnd = latestLifetimeEnd;
});

const report = { passed: true, checks, measurements };
console.log(JSON.stringify(report, null, 2));
