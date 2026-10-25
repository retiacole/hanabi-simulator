/*
 * Educational two-barge fireworks model. Metres, seconds; x east, y up, z north.
 * Projectiles obey gravity and quadratic drag relative to a uniform wind.
 * Burning stars approximately shrink at constant material density: their area /
 * mass ratio increases as mass is consumed. No chemical combustion or measured
 * shell calibration is claimed. Pattern geometry only sets initial velocities.
 * All subsequent paths, including child shells and detached embers, are integrated.
 */
(function (root) {
  'use strict';
  const DURATION = 180, TAU = Math.PI * 2, GRAVITY = 9.81, STEP = 1 / 90;
  const SITES = [{ id: 'A', x: -230, y: 0, z: 0 }, { id: 'B', x: 230, y: 0, z: 0 }];
  const PALETTE = [[255,191,76], [103,226,255], [255,115,164], [166,136,255], [149,255,180], [255,235,179]];
  const TYPES = [
    { id:'sphere', name:'球形', description:'球状に飛び出した星が、重力と空気抵抗を受けて広がります。風で形と中心が変わります。', dimension:'立体' },
    { id:'ring', name:'輪形', description:'同じ平面内に飛び出す星の輪です。横からは細く見え、空気抵抗と風で次第にゆがみます。', dimension:'平面' },
    { id:'willow', name:'しだれ', description:'長く燃える星から小さな火花が離れ、別々に減速・落下して尾を作ります。', dimension:'立体' },
    { id:'doubleShell', name:'二重球', description:'異なる速さで飛び出す二組の星が、大小二つの球を作ります。', dimension:'立体' },
    { id:'palm', name:'ヤシ', description:'少数の明るい星が斜め上へ飛び出し、放出する火花と重力でヤシ状の尾を作ります。', dimension:'立体' },
    { id:'fan', name:'扇', description:'台船から扇状に打ち上げるコメットです。星そのものが弾道に沿って上昇し、火花を残します。', dimension:'平面' },
    { id:'saturn', name:'土星', description:'小さな球状の星と、傾いた平面内に飛び出す輪を組み合わせます。', dimension:'立体' },
    { id:'bouquet', name:'小花の群れ', description:'親玉から離れた子玉がそれぞれ弾道飛行し、時間差で別々の位置から小さく開きます。', dimension:'立体' },
    { id:'goldenWillow', name:'金の大しだれ', description:'長く燃える金色の星と、そこから離れる小さな火花が落下して大きなしだれを作ります。', dimension:'立体' },
    { id:'multicolorPistil', name:'彩色の光跡', description:'金色の小さな芯と、外側へ飛ぶ色の異なるコメット。筋は飛行中に放出される火花です。', dimension:'立体' }
  ];
  const SPEC = {
    sphere:{count:144,speed:67,life:3.8,k:.010,embers:0},
    ring:{count:104,speed:67,life:3.9,k:.010,embers:0},
    willow:{count:84,speed:61,life:7.4,k:.011,embers:1.6},
    doubleShell:{count:136,speed:69,life:3.9,k:.010,embers:0},
    palm:{count:10,speed:69,life:6.5,k:.007,embers:1.8},
    fan:{count:11,speed:91,life:7.1,k:.0045,embers:1.1},
    saturn:{count:148,speed:69,life:4.1,k:.010,embers:0},
    bouquet:{count:36,speed:37,life:3.4,k:.013,embers:0},
    goldenWillow:{count:92,speed:74,life:8.5,k:.009,embers:2.2},
    multicolorPistil:{count:24,speed:78,life:5.5,k:.008,embers:1.05}
  };
  function clamp(v,lo,hi) { return Math.max(lo,Math.min(hi,v)); }
  function random(seed) { let s=seed>>>0; return function(){s+=0x6D2B79F5;let v=s;v=Math.imul(v^(v>>>15),v|1);v^=v+Math.imul(v^(v>>>7),v|61);return ((v^(v>>>14))>>>0)/4294967296;}; }
  function finite(v,fallback) { return Number.isFinite(v)?v:fallback; }
  function windOptions(options={}) {
    const speed=Math.max(0,finite(options.windSpeed,4));
    const direction=finite(options.windDirection,90), angle=direction*Math.PI/180;
    return {windSpeed:speed,windDirection:direction,wx:Math.sin(angle)*speed,wz:Math.cos(angle)*speed,gravity:finite(options.gravity,GRAVITY)};
  }
  function state(x=0,y=0,z=0,vx=0,vy=0,vz=0) { return {x,y,z,vx,vy,vz}; }
  function copy(s) { return state(s.x,s.y,s.z,s.vx,s.vy,s.vz); }
  function accelerationRaw(s,age,body,wind) {
    const fraction=body.burnTime>0?1-(1-finite(body.residualMassFraction,.32))*clamp(age/body.burnTime,0,1):1;
    const k=finite(body.ballisticK,0)/Math.cbrt(Math.max(.05,fraction));
    const ux=s.vx-wind.wx, uy=s.vy, uz=s.vz-wind.wz, speed=Math.hypot(ux,uy,uz);
    return {ax:-k*speed*ux,ay:-wind.gravity-k*speed*uy,az:-k*speed*uz};
  }
  function advance(s,age,dt,body,wind) {
    const a=accelerationRaw(s,age,body,wind), half=dt*.5;
    const m=state(s.x+s.vx*half,s.y+s.vy*half,s.z+s.vz*half,s.vx+a.ax*half,s.vy+a.ay*half,s.vz+a.az*half);
    const b=accelerationRaw(m,age+half,body,wind);
    return state(s.x+m.vx*dt,s.y+m.vy*dt,s.z+m.vz*dt,s.vx+b.ax*dt,s.vy+b.ay*dt,s.vz+b.az*dt);
  }
  function integrate(initial,duration,body={},options={},step=STEP) {
    const wind=windOptions(options), h=Number.isFinite(step)&&step>0?step:STEP;
    let s=copy(initial), t=0;
    while(t<duration-1e-12) { const dt=Math.min(h,duration-t);s=advance(s,t,dt,body,wind);t+=dt; }
    return s;
  }
  function acceleration(s,age,body={},options={}) { return accelerationRaw(s,age,body,windOptions(options)); }
  function track(initial,duration,body,wind,ground=false) {
    const steps=Math.ceil(duration/STEP), data=new Float32Array((steps+1)*6);
    let s=copy(initial), actualDuration=duration, last=steps;
    function write(index,p){const j=index*6;data[j]=p.x;data[j+1]=p.y;data[j+2]=p.z;data[j+3]=p.vx;data[j+4]=p.vy;data[j+5]=p.vz;}
    write(0,s);
    for(let i=1;i<=steps;i++) {
      const time=(i-1)*STEP, dt=Math.min(STEP,duration-time), next=advance(s,time,dt,body,wind);
      if(ground&&next.y<=0) {const u=s.y/(s.y-next.y);next.x=s.x+(next.x-s.x)*u;next.z=s.z+(next.z-s.z)*u;next.y=0;actualDuration=time+dt*u;last=i;write(i,next);break;}
      s=next;write(i,s);
    }
    return {data,last,duration:actualDuration,plannedDuration:duration};
  }
  function at(path,time) {
    const t=clamp(time,0,path.duration), index=Math.min(Math.floor(t/STEP),path.last-1);
    if(path.last===0) return read(path,0);
    const i=Math.max(0,index), span=i+1===path.last?path.duration-i*STEP:STEP;
    const f=span>1e-9?clamp((t-i*STEP)/span,0,1):1;
    const a=i*6,b=(i+1)*6,d=path.data;
    return state(d[a]+(d[b]-d[a])*f,d[a+1]+(d[b+1]-d[a+1])*f,d[a+2]+(d[b+2]-d[a+2])*f,d[a+3]+(d[b+3]-d[a+3])*f,d[a+4]+(d[b+4]-d[a+4])*f,d[a+5]+(d[b+5]-d[a+5])*f);
  }
  function read(path,i){const j=i*6,d=path.data;return state(d[j],d[j+1],d[j+2],d[j+3],d[j+4],d[j+5]);}
  function rotate(p,yaw,tilt=0){const y=p[1]*Math.cos(tilt)-p[2]*Math.sin(tilt),z=p[1]*Math.sin(tilt)+p[2]*Math.cos(tilt);return [p[0]*Math.cos(yaw)+z*Math.sin(yaw),y,-p[0]*Math.sin(yaw)+z*Math.cos(yaw)];}
  function sphereDirection(i,n,yaw,tilt=0){const y=1-2*(i+.5)/n,a=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-y*y);return rotate([r*Math.cos(a),y,r*Math.sin(a)],yaw,tilt);}
  const events=[],siteSequence=[0,0];
  function addEvent(siteIndex,launch,sequence,finale,forcedType) {
    const rng=random(7319+sequence*92821+siteIndex*41047),site=SITES[siteIndex];
    const type=forcedType||TYPES[siteSequence[siteIndex]%TYPES.length].id;siteSequence[siteIndex]++;
    const spec=SPEC[type],yaw=rng()*TAU,tilt=(rng()-.5)*.18;
    const shellBody={ballisticK:.00044};
    const initial=state(site.x,2,site.z,(rng()-.5)*3,83+rng()*18+(finale?3:0),(rng()-.5)*3);
    let apex=copy(initial),flight=0;
    if(type!=='fan') while(apex.vy>0&&flight<13){apex=advance(apex,flight,STEP,shellBody,windOptions({windSpeed:0}));flight+=STEP;}
    else {flight=0;apex=state(site.x,2,site.z);initial.vx=0;initial.vy=0;initial.vz=0;}
    const event={id:'firework-'+sequence,site:site.id,launch,burst:launch+flight,type,seed:7319+sequence*92821+siteIndex*41047,
      life:spec.life+(type==='bouquet'?1.65:0)+spec.embers+.1,color:(['willow','palm','goldenWillow','multicolorPistil'].includes(type)?PALETTE[0]:PALETTE[(sequence+siteIndex*2)%6]).slice(),
      cx:apex.x,cy:apex.y,cz:apex.z,radius:140,speed:spec.speed,studyAzimuth:yaw/TAU*360,yaw,tilt,initial,shellBody,finale,particles:[],guidePaths:[]};
    events.push(event);
  }
  let sequence=0;
  addEvent(0,0,sequence++,false,'sphere');addEvent(1,.5,sequence++,false,'ring');
  for(let t=4.3,v=0;t<30;t+=3.9,v++){addEvent(v%2,t,sequence++,false);if(v%3===2)addEvent((v+1)%2,t+.62,sequence++,false);}
  for(let t=31.1,v=0;t<75;t+=3.05,v++){addEvent(v%2,t,sequence++,false);if(v%3!==1)addEvent((v+1)%2,t+.64,sequence++,false);}
  for(let t=76,v=0;t<120;t+=2.65,v++){addEvent(v%2,t,sequence++,false);if(v%2===0)addEvent((v+1)%2,t+.37,sequence++,false);}
  for(let t=121;t<145;t+=2.7){addEvent(0,t,sequence++,false);addEvent(1,t+.2,sequence++,false);}
  for(let t=146;t<=159.001;t+=1.1){addEvent(0,t,sequence++,true);addEvent(1,t+.22,sequence++,true);}
  events.sort((a,b)=>a.launch-b.launch);
  const eventMap=new Map(events.map(e=>[e.id,e]));
  function eventOf(value){return typeof value==='string'?eventMap.get(value):value;}
  const configs=new Map();
  function context(options={}) {
    const wind=windOptions(options),key=[wind.windSpeed,wind.windDirection,wind.gravity].join(':');
    if(configs.has(key)){const value=configs.get(key);configs.delete(key);configs.set(key,value);return value;}
    const value={wind,skeletons:new Map(),tracks:new Map(),embers:new Map()};configs.set(key,value);
    while(configs.size>2)configs.delete(configs.keys().next().value);
    return value;
  }
  function skeleton(event,ctx) {
    if(ctx.skeletons.has(event.id))return ctx.skeletons.get(event.id);
    const rng=random(event.seed+23117),spec=SPEC[event.type],flight=event.burst-event.launch;
    const shell=track(event.initial,flight,event.shellBody,ctx.wind);
    const burstState=event.type==='fan'?state(event.initial.x,2,event.initial.z):at(shell,flight);
    const result={event,shell,burstState,children:[],stars:[],smoke:null};
    function addStar(direction,color,speed=spec.speed,settings={}) {
      const parent=settings.parent||burstState,variation=1+(rng()-.5)*(settings.variation===undefined?.08:settings.variation),relative=direction.map(v=>v*speed*variation);
      const life=(settings.life||spec.life)*(.90+rng()*.10),body={ballisticK:(settings.k||spec.k)*(.94+rng()*.12),burnTime:life,residualMassFraction:.32};
      const initial=state(parent.x,parent.y,parent.z,parent.vx+relative[0],parent.vy+relative[1],parent.vz+relative[2]);
      result.stars.push({birth:settings.birth===undefined?event.burst:settings.birth,initial,relativeVelocity:{vx:relative[0],vy:relative[1],vz:relative[2]},parentState:copy(parent),parentIndex:settings.parentIndex===undefined?-1:settings.parentIndex,sourceKind:settings.sourceKind||(event.type==='fan'?'ground':'burst'),body,life,
        color:color.slice(),size:settings.size||1.5,emissionLife:settings.embers===undefined?spec.embers:settings.embers,emissionInterval:settings.interval||.20,phase:rng()*TAU,index:result.stars.length});
    }
    function addSphere(count,speed,color,settings={}){for(let i=0;i<count;i++)addStar(sphereDirection(i,count,event.yaw,.47),color,speed,settings);}
    function addRing(count,speed,color,tilt=event.tilt){for(let i=0;i<count;i++){const a=TAU*i/count;addStar(rotate([Math.cos(a),Math.sin(a),0],event.yaw,tilt),color,speed,{variation:.025});}}
    if(event.type==='sphere'||event.type==='willow')addSphere(spec.count,spec.speed,event.color,{size:event.type==='willow'?1.7:1.5,interval:event.type==='willow'?.15:.20});
    else if(event.type==='ring')addRing(spec.count,spec.speed,event.color);
    else if(event.type==='doubleShell'){addSphere(88,spec.speed,PALETTE[1]);addSphere(48,spec.speed*.45,PALETTE[2],{k:.012,life:3.5});}
    else if(event.type==='saturn'){addSphere(68,spec.speed*.43,PALETTE[1]);addRing(80,spec.speed,PALETTE[0],.95);}
    else if(event.type==='palm')for(let i=0;i<spec.count;i++){const a=TAU*i/spec.count+event.yaw,elevation=.32+(i%3)*.16;addStar([Math.cos(a)*Math.cos(elevation),Math.sin(elevation),Math.sin(a)*Math.cos(elevation)],event.color,spec.speed,{size:3.6,interval:.10});}
    else if(event.type==='fan')for(let i=0;i<spec.count;i++){const a=(i/(spec.count-1)-.5)*1.8;addStar(rotate([Math.sin(a),Math.cos(a),0],event.yaw,0),i%2?PALETTE[2]:PALETTE[0],spec.speed,{size:3.0,interval:.13});}
    else if(event.type==='goldenWillow'){addSphere(64,spec.speed,PALETTE[0],{size:2.2,interval:.14});addSphere(28,spec.speed*.33,PALETTE[5],{life:3.2,embers:0,size:1.2});}
    else if(event.type==='multicolorPistil'){addSphere(54,spec.speed*.22,PALETTE[0],{life:3.2,embers:0,size:1.2});for(let i=0;i<24;i++)addStar(sphereDirection(i,24,event.yaw,.36),PALETTE[1+i%4],spec.speed,{size:2.8,interval:.14});}
    else if(event.type==='bouquet')for(let group=0;group<9;group++){
      const d=sphereDirection(group,9,event.yaw,.23),speed=25+rng()*7,relative={vx:d[0]*speed,vy:d[1]*speed,vz:d[2]*speed};
      const initial=state(burstState.x,burstState.y,burstState.z,burstState.vx+relative.vx,burstState.vy+relative.vy,burstState.vz+relative.vz);
      const delay=.82+rng()*.75,body={ballisticK:.0032},path=track(initial,delay,body,ctx.wind),childState=at(path,delay);
      const child={birth:event.burst,burst:event.burst+delay,initial,burstState:childState,relativeVelocity:relative,body,path,index:group};result.children.push(child);
      addSphere(spec.count,spec.speed,PALETTE[(group+(event.site==='B'?1:0))%6],{parent:childState,birth:child.burst,parentIndex:group,sourceKind:'child',size:1.3,variation:.10});
    }
    ctx.skeletons.set(event.id,result);return result;
  }
  function trajectories(event,ctx) {
    if(ctx.tracks.has(event.id)){const v=ctx.tracks.get(event.id);ctx.tracks.delete(event.id);ctx.tracks.set(event.id,v);return v;}
    const sk=skeleton(event,ctx),paths=sk.stars.map(s=>track(s.initial,s.life,s.body,ctx.wind,true));
    const value={sk,paths};ctx.tracks.set(event.id,value);
    // Enough for the dense finale, while seeks cannot retain the entire show.
    while(ctx.tracks.size>14)ctx.tracks.delete(ctx.tracks.keys().next().value);
    return value;
  }
  function sourceAt(eventOrId,time,options={}) {
    const event=eventOf(eventOrId);if(!event)return null;
    const ctx=context(options),sk=skeleton(event,ctx);
    if(time<=event.burst)return event.type==='fan'?copy(sk.burstState):at(sk.shell,time-event.launch);
    return integrate(sk.burstState,time-event.burst,{ballisticK:.010},options);
  }
  function smokeSources(eventOrId,options={}) {
    const event=eventOf(eventOrId);if(!event)return [];
    const ctx=context(options),sk=skeleton(event,ctx);if(sk.smoke)return sk.smoke;
    const sources=[];
    function add(kind,index,birth,p,strength){sources.push({id:event.id+'-'+kind+'-'+index,eventId:event.id,birth,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,strength,kind});}
    if(event.type!=='fan') {
      const flight=event.burst-event.launch;
      for(let i=0;i<4;i++){const age=flight*(.15+i*.22);add('ascent',i,event.launch+age,at(sk.shell,age),.28);}
      add('burst',0,event.burst,sk.burstState,event.type==='bouquet'?.5:1);
    }
    for(const child of sk.children)add('child',child.index,child.burst,child.burstState,.38);
    const representatives=event.type==='fan'?[1,5,9]:[Math.floor(sk.stars.length*.24),Math.floor(sk.stars.length*.73)];
    let index=0;
    for(const id of representatives){const star=sk.stars[id];if(!star)continue;for(const fraction of [.28,.66]){const age=star.life*fraction,p=integrate(star.initial,age,star.body,ctx.wind);if(p.y>1)add('star',index++,star.birth+age,p,event.type==='goldenWillow'?.5:.30);}}
    sk.smoke=sources;return sources;
  }
  function emberPath(event,star,index,starPath,ctx) {
    const key=event.id+':'+star.index+':'+index;
    if(ctx.embers.has(key))return ctx.embers.get(key);
    const age=index*star.emissionInterval,p=at(starPath,age),rng=random(event.seed+star.index*20117+index*4327);
    const initial=state(p.x,p.y,p.z,p.vx+(rng()-.5)*2,p.vy+(rng()-.5)*2,p.vz+(rng()-.5)*2);
    const body={ballisticK:.045+rng()*.018,burnTime:star.emissionLife,residualMassFraction:.18};
    const path=track(initial,star.emissionLife,body,ctx.wind,true);ctx.embers.set(key,path);
    while(ctx.embers.size>6000)ctx.embers.delete(ctx.embers.keys().next().value);
    return path;
  }
  function fade(age,life){const remaining=1-age/life;return Math.min(1,age/.055)*Math.pow(clamp(remaining/.35,0,1),1.15);}
  function addLight(sparks,event,star,p,previous,alpha,size,kind='star') {
    if(p.y<=.3||alpha<.008)return;
    sparks.push({x:p.x,y:p.y,z:p.z,px:previous.x,py:previous.y,pz:previous.z,alpha,size,color:star.color,eventId:event.id,kind});
  }
  function sample(time,options={}) {
    const t=clamp(finite(time,0),0,DURATION),rockets=[],sparks=[],bursts=[];
    if(t>=DURATION)return {rockets,sparks,bursts};
    const ctx=context(options);
    for(const event of events) {
      if(event.launch>t)break;
      if(t>event.burst+event.life)continue;
      const sk=skeleton(event,ctx);
      if(t<event.burst) {
        const p=at(sk.shell,t-event.launch),prev=at(sk.shell,Math.max(0,t-event.launch-.035));
        rockets.push({...p,prevX:prev.x,prevY:prev.y,prevZ:prev.z,alpha:.85,color:[255,217,146],event});continue;
      }
      for(const child of sk.children)if(t<child.burst){const p=at(child.path,t-child.birth),prev=at(child.path,Math.max(0,t-child.birth-.02));rockets.push({...p,prevX:prev.x,prevY:prev.y,prevZ:prev.z,alpha:.24,color:[255,187,94],event,child:true});}
      const value=trajectories(event,ctx),positions=[],guidePaths=[];
      let cx=0,cy=0,cz=0,count=0;
      for(let i=0;i<sk.stars.length;i++) {
        const star=sk.stars[i],path=value.paths[i],age=t-star.birth;
        if(age<0)continue;
        const alive=age<Math.min(star.life,path.duration);
        if(alive){
          const p=at(path,age),prev=at(path,Math.max(0,age-.025));positions.push({p,star});cx+=p.x;cy+=p.y;cz+=p.z;count++;
          const flicker=.94+.06*Math.sin(age*16+star.phase);addLight(sparks,event,star,p,prev,fade(age,star.life)*flicker,star.size);
        }
        if(star.emissionLife>0){
          const first=Math.max(1,Math.ceil((age-star.emissionLife)/star.emissionInterval));
          const last=Math.min(Math.floor(age/star.emissionInterval),Math.floor(Math.min(star.life,path.duration)/star.emissionInterval));
          for(let k=first;k<=last;k++){
            const emitted=k*star.emissionInterval,ea=age-emitted;if(ea<0||ea>=star.emissionLife)continue;
            const ep=emberPath(event,star,k,path,ctx);if(ea>=ep.duration)continue;
            const p=at(ep,ea),prev=at(ep,Math.max(0,ea-.025));
            const luminosity=.72*Math.pow(1-ea/star.emissionLife,1.3)*Math.pow(Math.max(0,1-emitted/star.life),.25);
            addLight(sparks,event,star,p,prev,luminosity,Math.max(.8,star.size*.56),'ember');
          }
        }
      }
      if(!count){cx=sk.burstState.x;cy=sk.burstState.y;cz=sk.burstState.z;count=1;}else{cx/=count;cy/=count;cz/=count;}
      let radius=0;for(const item of positions)radius=Math.max(radius,Math.hypot(item.p.x-cx,item.p.y-cy,item.p.z-cz));
      // Guides connect actual current star positions for planar forms, and show
      // a few actual integrated trajectories for other forms. No ideal spheres.
      if(event.type==='ring')guidePaths.push({points:positions.map(q=>[q.p.x,q.p.y,q.p.z]),closed:true});
      else if(event.type==='saturn')guidePaths.push({points:positions.filter(q=>q.star.index>=68).map(q=>[q.p.x,q.p.y,q.p.z]),closed:true});
      else {
        const stride=Math.max(1,Math.floor(sk.stars.length/8));
        for(let i=0;i<sk.stars.length;i+=stride){const star=sk.stars[i],age=Math.min(t-star.birth,star.life,value.paths[i].duration);if(age<.05)continue;const points=[];for(let j=0;j<=20;j++){const p=at(value.paths[i],age*j/20);points.push([p.x,p.y,p.z]);}guidePaths.push({points,closed:false});}
      }
      if(event.type==='bouquet')for(const child of sk.children)if(t>=child.burst&&t<child.burst+SPEC.bouquet.life)bursts.push({id:event.id+'-child-'+child.index,parentId:event.id,x:child.burstState.x,y:child.burstState.y,z:child.burstState.z,radius:20,age:t-child.burst,life:SPEC.bouquet.life,type:event.type,site:event.site,color:PALETTE[child.index%6],secondary:true,guidePaths:[]});
      bursts.push({id:event.id,x:cx,y:cy,z:cz,radius,age:t-event.burst,life:event.life,type:event.type,site:event.site,color:event.color,guidePaths,origin:copy(sk.burstState),groundComets:event.type==='fan'});
    }
    return {rockets,sparks,bursts};
  }
  function eventState(eventOrId,options={}) {
    const event=eventOf(eventOrId);if(!event)return null;const sk=skeleton(event,context(options));
    return {launch:{time:event.launch,state:copy(event.initial)},burst:{time:event.burst,state:copy(sk.burstState)},
      children:sk.children.map(c=>({birth:c.birth,burst:c.burst,initial:copy(c.initial),burstState:copy(c.burstState),relativeVelocity:{...c.relativeVelocity},body:{...c.body}})),
      stars:sk.stars.map(s=>({birth:s.birth,initial:copy(s.initial),relativeVelocity:{...s.relativeVelocity},parentState:copy(s.parentState),sourceKind:s.sourceKind,parentIndex:s.parentIndex,body:{...s.body},life:s.life}))};
  }
  const studyTimes={};
  for(const type of TYPES){let best=null,bestScore=Infinity;const offset=type.id==='fan'?3.6:type.id==='goldenWillow'?4.3:type.id==='willow'?3.8:type.id==='bouquet'?2.7:2.1;
    for(const e of events){if(e.type!==type.id||e.burst>130)continue;const t=e.burst+offset;let score=e.launch*.002;for(const other of events){if(other===e||t<other.burst||t>other.burst+other.life)continue;score+=(other.site===e.site?3:.6)*(1-(t-other.burst)/other.life);}if(score<bestScore){best=e;bestScore=score;}}
    studyTimes[type.id]={time:best.burst+offset,eventId:best.id,azimuth:best.studyAzimuth};}
  const comparisonTime=Math.max(events[0].burst,events[1].burst)+1.5;
  root.FireworksModel={sites:SITES,duration:DURATION,types:TYPES,events,studyTimes,comparisonTime,sample,sourceAt,smokeSources,
    physics:{step:STEP,gravity:GRAVITY,dragLaw:'quadratic relative-air velocity',integrate,acceleration,eventState}};
})(typeof window!=='undefined'?window:globalThis);
