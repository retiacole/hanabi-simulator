const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const smokeCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'smoke-model.js'), 'utf8');
const fixtures = [{id:'fixture',launch:0,burst:1,life:60}];
const fixtureSource = {id:'one', birth:1, x:100, y:300, z:-20, vx:40, vy:12, vz:-5, strength:1, kind:'burst'};
const context = vm.createContext({FireworksModel:{smokeSources: () => [fixtureSource, {...fixtureSource, id:'child', birth:50, kind:'child'}]}});
vm.runInContext(smokeCode, context);
const sample = (time, options={}) => context.HanabiSmoke.sample(time, fixtures, {windSpeed:6,windDirection:90,density:1,...options});
const almost = (a,b,tolerance=1e-9) => assert(Math.abs(a-b)<tolerance, `${a} != ${b}`);
assert.equal(sample(0).length,0);
assert.equal(sample(1).length,0);
assert.equal(sample(5).length,1);
const a=sample(5)[0], b=sample(15)[0], c=sample(25)[0];
assert(a.radius<b.radius&&b.radius<c.radius,'diffusion increases the cloud radius');
almost(b.radius*b.radius-a.radius*a.radius,c.radius*c.radius-b.radius*b.radius,1e-8);
const amount = puff => -Math.log1p(-puff.opacity)*puff.radius*puff.radius;
almost(amount(a),amount(b),1e-8);
almost(amount(b),amount(c),1e-8);
assert(a.opacity>b.opacity&&b.opacity>c.opacity,'expansion dilutes optical depth');
almost(c.x-b.x,60,1e-9);
almost(c.z-b.z,0,1e-9);
assert(b.y-a.y>c.y-b.y&&c.y>b.y,'buoyancy rises more slowly as the smoke cools');
const thick=sample(15,{density:5})[0];
almost(-Math.log1p(-thick.opacity),5*-Math.log1p(-b.opacity),1e-12);
assert(thick.opacity<5*b.opacity&&thick.opacity<1,'optical opacity saturates instead of exceeding one');
const northA=sample(15,{windDirection:0})[0], northB=sample(25,{windDirection:0})[0];
almost(northB.x-northA.x,0,1e-9);almost(northB.z-northA.z,60,1e-9);
assert.equal(sample(15,{density:0}).length,0);
assert.equal(sample(49).length,1);assert.equal(sample(51).length,2,'child puff starts only at actual child burst');
const direct=JSON.stringify(sample(15));sample(130);sample(2);sample(40,{windDirection:270});
assert.equal(JSON.stringify(sample(15)),direct,'seeking has no integration history');
assert.equal(sample(77).filter(p=>p.id.includes('one')).length,0,'finite rendering lifetime');
const retiring=sample(75,{density:5}).find(p=>p.id.endsWith('-one'));
assert(!retiring||retiring.opacity<0.002,'old puff fades smoothly to invisibility before removal');
for(const time of [0,1,1.1,5,70,180]) for(const puff of sample(time,{density:5})) {
  for(const key of ['x','y','z','radius','opacity']) assert(Number.isFinite(puff[key]),key);
  assert(puff.radius>0&&puff.opacity>0&&puff.opacity<1);
}
const report = {passed:true, unit:['ballistic API origins only','no source before emission','diffusion variance linear in time','conserved optical amount after emission through60s','decaying buoyancy','ambient wind after momentum relaxation','500% Beer–Lambert saturation','delayed child emission','deterministic seeking','finite output']};
if(!process.argv.includes('--unit-only')) {
  const real = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'fireworks-model.js'), 'utf8'), real);
  vm.runInContext(smokeCode, real);
  assert.equal(typeof real.FireworksModel.smokeSources,'function');
  let maxPuffs=0;
  for(const time of [10,30,60,100,140,165,180]) {
    const puffs=real.HanabiSmoke.sample(time,real.FireworksModel.events,{windSpeed:12,windDirection:270,density:5});
    maxPuffs=Math.max(maxPuffs,puffs.length);
    assert(puffs.length>0&&puffs.length<=768);
    for(const puff of puffs) for(const key of ['x','y','z','radius','opacity']) assert(Number.isFinite(puff[key]),key);
  }
  const event=real.FireworksModel.events.find(e=>e.type==='bouquet');
  const sources=real.FireworksModel.smokeSources(event,{windSpeed:4,windDirection:90});
  assert(sources.some(s=>s.kind==='child'),'bouquet has physical child burst smoke sources');
  const source=sources.find(s=>s.kind==='child');
  const shortly=real.HanabiSmoke.sample(source.birth+0.01,real.FireworksModel.events,{windSpeed:4,windDirection:90,density:1});
  const matching=shortly.find(p=>p.id===`${event.id}-smoke-${source.id}`);
  assert(matching,'a smoke puff is present at the child burst time');
  assert(Math.hypot(matching.x-source.x,matching.y-source.y,matching.z-source.z)<2,'source location agrees with the physical child');
  report.integration={sampleTimes:[10,30,60,100,140,165,180],maxPuffs,childSource:true};
}
console.log(JSON.stringify(report,null,2));
