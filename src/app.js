(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('world'), ctx = canvas.getContext('2d', { alpha: false });
  const map = $('map'), mc = map.getContext('2d');
  const model = window.FireworksModel, TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const wrap = n => (n % 360 + 360) % 360;
  const state = { time:0, playing:!matchMedia('(prefers-reduced-motion: reduce)').matches, speed:1, distance:1100, height:25, azimuth:0, pitch:14, tracking:true, guides:false, grid:true, map:true, smoke:false, smokeDensity:1, windSpeed:4, windDirection:90, selectedType:'sphere', studyEventId:null };
  const presets = {shore:[1100,25,0],air:[500,1100,25],side:[1100,80,90],near:[350,300,90]};
  const presetNames = {shore:'湾岸から',air:'上空から',side:'真横から',near:'花火のそばから'};
  const typeById=new Map(model.types.map(type=>[type.id,type]));
  for(const type of model.types){const option=document.createElement('option');option.value=type.id;option.textContent=`${type.name} · ${type.dimension}`;$('fireworkType').appendChild(option);}
  $('typeCount').textContent=`${model.types.length} TYPES`;
  const keys = new Set(); let heldAction=null, holdSince=0, lastFrame=0, lastUI=-1, dirty=true, width=0,height=0,dpr=1, camera;
  let worldSample=model.sample(0), sampleKey='', smokeSample=[], smokeKey='';
  const rng = seed => {let s=seed;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;}};
  const random=rng(4621), skyStars=[], buildings=[], waves=[];
  for(let i=0;i<120;i++){const a=random()*TAU,e=.08+random()*1.4;skyStars.push({x:Math.sin(a)*Math.cos(e)*60000,y:Math.sin(e)*60000,z:Math.cos(a)*Math.cos(e)*60000,size:.4+random()*.65,alpha:.1+random()*.35});}
  for(let i=0;i<180;i++){const a=i/180*TAU, r=3900+random()*350;buildings.push({x:Math.sin(a)*r,z:Math.cos(a)*r,h:25+random()**2*180,w:30+random()*70,d:25+random()*50,seed:i});}
  for(let i=0;i<560;i++){waves.push({x:(random()-.5)*7500,z:(random()-.5)*7500,len:8+random()*35,alpha:.08+random()*.2});}
  const sprites=new Map();
  function sprite(color){const key=color.join(',');if(sprites.has(key))return sprites.get(key);const c=document.createElement('canvas');c.width=c.height=48;const g=c.getContext('2d'),r=g.createRadialGradient(24,24,0,24,24,24);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.12,`rgba(${key},.9)`);r.addColorStop(.32,`rgba(${key},.3)`);r.addColorStop(1,`rgba(${key},0)`);g.fillStyle=r;g.fillRect(0,0,48,48);sprites.set(key,c);return c;}
  for(const e of model.events)sprite(e.color);
  const smokeSprites=new Map();
  function smokeSprite(color){
    const rgb=color.map(v=>clamp(Math.round(v/16)*16,0,255)),key=rgb.join(',');
    if(smokeSprites.has(key))return smokeSprites.get(key);
    const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d');
    // Soft overlapping lobes avoid a hard-edged circle around each 3D puff.
    for(const [x,y,r,a] of [[48,48,47,.85],[36,41,31,.34],[62,38,29,.3],[49,62,32,.25]]){
      const grad=g.createRadialGradient(x,y,0,x,y,r);grad.addColorStop(0,`rgba(${key},${a})`);grad.addColorStop(.35,`rgba(${key},${a*.75})`);grad.addColorStop(.7,`rgba(${key},${a*.28})`);grad.addColorStop(1,`rgba(${key},0)`);g.fillStyle=grad;g.fillRect(0,0,96,96);
    }
    smokeSprites.set(key,c);return c;
  }
  function refreshSmoke(){
    const key=[state.time,state.smoke,state.smokeDensity,state.windSpeed,state.windDirection].join('/');
    if(key===smokeKey)return;smokeKey=key;
    smokeSample=state.smoke?window.HanabiSmoke.sample(state.time,model.events,{density:state.smokeDensity,windSpeed:state.windSpeed,windDirection:state.windDirection}):[];
  }
  function smokeColor(puff){
    const rgb=[63,76,94];
    // Nearby live shells illuminate the smoke. Old clouds remain neutral.
    for(const b of worldSample.bursts){
      const d2=(b.x-puff.x)**2+(b.y-puff.y)**2+(b.z-puff.z)**2;
      const intensity=Math.max(0,1-b.age/b.life)*Math.exp(-d2/(2*(b.radius+95)**2))*.7;
      for(let i=0;i<3;i++)rgb[i]+=b.color[i]*intensity;
    }
    return rgb;
  }
  function drawSmokePuff(puff,p){
    const radius=Math.min(puff.radius*p.scale,Math.max(width,height)*2);if(radius<.3)return;
    // Blend nearby clouds into local haze before their centres cross the camera.
    const nearFade=clamp((p.z-3)/(puff.radius*.7),0,1);
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=puff.opacity*nearFade;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(puff.seed%628/100);ctx.drawImage(smokeSprite(smokeColor(puff)),-radius,-radius,2*radius,2*radius);ctx.restore();
  }
  function drawLocalSmoke(){
    if(!state.smoke)return;
    ctx.save();ctx.globalCompositeOperation='source-over';
    for(const puff of smokeSample){
      const d=Math.hypot(puff.x-camera.x,puff.y-camera.y,puff.z-camera.z);
      const inside=clamp(1-d/(puff.radius*1.15),0,1);if(inside<=0)continue;
      ctx.globalAlpha=puff.opacity*inside;ctx.fillStyle=`rgb(${smokeColor(puff).map(v=>Math.round(clamp(v,0,255))).join(',')})`;ctx.fillRect(0,0,width,height);
    }
    ctx.restore();
  }
  function announce(text){$('announcement').textContent=text;}
  function centerPitch(){return Math.atan2(300-state.height,state.distance)/DEG;}
  function cameraFor(s=state){const a=s.azimuth*DEG,p=s.pitch*DEG,sa=Math.sin(a),ca=Math.cos(a),sp=Math.sin(p),cp=Math.cos(p);return{x:sa*s.distance,y:s.height,z:ca*s.distance,right:[ca,0,-sa],up:[sa*sp,cp,ca*sp],forward:[-sa*cp,sp,-ca*cp],f:Math.min(height/(2*Math.tan(24*DEG)),width/(2*Math.tan(32*DEG))),cx:width/2,cy:height*.52};}
  function view(x,y,z){const dx=x-camera.x,dy=y-camera.y,dz=z-camera.z;return{x:dx*camera.right[0]+dz*camera.right[2],y:dx*camera.up[0]+dy*camera.up[1]+dz*camera.up[2],z:dx*camera.forward[0]+dy*camera.forward[1]+dz*camera.forward[2]};}
  function screen(v){return{x:camera.cx+v.x*camera.f/v.z,y:camera.cy-v.y*camera.f/v.z,z:v.z,scale:camera.f/v.z};}
  function project(x,y,z){const v=view(x,y,z);return v.z>3?screen(v):null;}
  function inView(p,margin=100){return p&&p.x>-margin&&p.x<width+margin&&p.y>-margin&&p.y<height+margin;}
  function line(a,b,color,lw=1){let av=view(...a),bv=view(...b);if(av.z<=3&&bv.z<=3)return;if(av.z<=3||bv.z<=3){const t=(3-av.z)/(bv.z-av.z),v={x:av.x+(bv.x-av.x)*t,y:av.y+(bv.y-av.y)*t,z:3};if(av.z<=3)av=v;else bv=v;}const aa=screen(av),bb=screen(bv);ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(aa.x,aa.y);ctx.lineTo(bb.x,bb.y);ctx.stroke();}
  function polygon(points,color){let verts=points.map(p=>view(...p)),out=[];for(let i=0;i<verts.length;i++){const a=verts[i],b=verts[(i+1)%verts.length],ai=a.z>3,bi=b.z>3;if(ai)out.push(a);if(ai!==bi){const t=(3-a.z)/(b.z-a.z);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:3});}}if(out.length<3)return;ctx.fillStyle=color;ctx.beginPath();out.forEach((v,i)=>{const p=screen(v);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.closePath();ctx.fill();}
  function path3(points,color,lw=1,close=false){ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.beginPath();let pen=false;for(const xyz of points){const p=project(...xyz);if(!p){pen=false;continue;}if(pen)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);pen=true;}if(close)ctx.closePath();ctx.stroke();}
  function label(text,x,y,z,color='#b3c5dc',dy=0){const p=project(x,y,z);if(!inView(p,0)||(p.y<150&&p.x<Math.min(430,width*.68)))return;ctx.font='11px -apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN",sans-serif';ctx.textAlign='center';const tw=ctx.measureText(text).width;ctx.fillStyle='rgba(7,16,30,.8)';ctx.fillRect(p.x-tw/2-7,p.y-9+dy,tw+14,19);ctx.fillStyle=color;ctx.fillText(text,p.x,p.y+4+dy);}
  function drawEnvironment(){
    const sky=ctx.createLinearGradient(0,0,0,height);sky.addColorStop(0,'#040814');sky.addColorStop(.6,'#0b1830');sky.addColorStop(1,'#10273c');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
    for(const star of skyStars){const p=project(star.x,star.y,star.z);if(!inView(p,2))continue;ctx.fillStyle=`rgba(187,207,231,${star.alpha})`;ctx.beginPath();ctx.arc(p.x,p.y,star.size,0,TAU);ctx.fill();}
    polygon([[-70000,0,-70000],[70000,0,-70000],[70000,0,70000],[-70000,0,70000]],'#091929');
    if(state.grid){for(let i=-3000;i<=3000;i+=200){const major=i%1000===0;line([i,0,-3000],[i,0,3000],major?'rgba(83,131,161,.22)':'rgba(77,123,154,.10)');line([-3000,0,i],[3000,0,i],major?'rgba(83,131,161,.22)':'rgba(77,123,154,.10)');}const ring=[];for(let i=0;i<=100;i++)ring.push([Math.sin(i/100*TAU)*state.distance,.2,Math.cos(i/100*TAU)*state.distance]);path3(ring,'rgba(137,182,208,.15)');}
    for(const w of waves)line([w.x,.4,w.z],[w.x+w.len,.4,w.z],`rgba(66,110,143,${w.alpha})`,.7);
    buildings.sort((a,b)=>Math.hypot(b.x-camera.x,b.z-camera.z)-Math.hypot(a.x-camera.x,a.z-camera.z));
    for(const b of buildings){const x=b.x,z=b.z,w=b.w/2,d=b.d/2,h=b.h;const center=project(x,h/2,z);if(!inView(center,80))continue;polygon([[x-w,0,z-d],[x+w,0,z-d],[x+w,h,z-d],[x-w,h,z-d]],'#0b1424');polygon([[x-w,0,z+d],[x+w,0,z+d],[x+w,h,z+d],[x-w,h,z+d]],'#101c2e');polygon([[x-w,0,z-d],[x-w,0,z+d],[x-w,h,z+d],[x-w,h,z-d]],'#121e30');polygon([[x+w,0,z-d],[x+w,0,z+d],[x+w,h,z+d],[x+w,h,z-d]],'#142136');polygon([[x-w,h,z-d],[x+w,h,z-d],[x+w,h,z+d],[x-w,h,z+d]],'#18263b');for(let j=0;j<Math.floor(h/16);j++){const y=8+j*15;const p=project(x,y,z+Math.sign(camera.z-z)*(d+.1));if(p){ctx.fillStyle=(j+b.seed)%4===0?'#948774':'#385473';ctx.globalAlpha=.5;ctx.fillRect(p.x-1,p.y,2,1);ctx.globalAlpha=1;}}}
    for(const site of model.sites){const {x,z}=site;polygon([[x-31,2,z-15],[x+31,2,z-15],[x+31,2,z+15],[x-31,2,z+15]],'#364959');line([x-31,3,z+15],[x+31,3,z+15],'#b9aa88',1.7);const p=project(x,6,z);if(p){ctx.fillStyle=site.id==='A'?'#8bd0ed':'#f2b0c3';ctx.beginPath();ctx.arc(p.x,p.y,2,0,TAU);ctx.fill();}label(`打上 ${site.id}`,x,10,z,site.id==='A'?'#a7d9f3':'#f2bdd0',20);}
    if(state.guides){line([-230,1,0],[230,1,0],'rgba(213,224,237,.55)');label('460 m',0,2,0,'#ced9e6',18);line([-420,0,0],[-420,600,0],'rgba(160,192,218,.35)');for(let h=100;h<=600;h+=100){line([-430,h,0],[-410,h,0],'#68839e');label(`${h} m`,-455,h,0,'#9eb5cc');}}
  }
  function drawReflection(){if(state.height>900)return;ctx.save();ctx.globalCompositeOperation='lighter';const strength=.26*(1-state.height/1100);for(let i=0;i<worldSample.sparks.length;i+=5){const s=worldSample.sparks[i],p=project(s.x,-s.y,s.z);if(!inView(p,10))continue;const c=s.color;ctx.fillStyle=`rgba(${c.join(',')},${s.alpha*strength})`;const jitter=Math.sin(s.x*.3+s.y*.12)*4;ctx.fillRect(p.x-2+jitter,p.y,4+Math.min(12,1200/p.z),1.1);}ctx.restore();}
  function drawGuides(){
    if(!state.guides)return;
    for(const b of worldSample.bursts){
      if(b.secondary||b.age<.3||b.age>b.life*.83)continue;
      const opacity=Math.min(.65,(1-b.age/b.life)*1.1),r=b.radius,meta=typeById.get(b.type);
      // These paths follow simulated particle positions, including wind and
      // unequal drag. An ideal sphere would hide the very deformation we study.
      for(const guide of b.guidePaths||[])path3(guide.points,`rgba(192,217,238,${opacity*.65})`,.7,guide.closed);
      label(`${b.site} · ${meta.name}`,b.x,b.y+r+22,b.z,b.id===state.studyEventId?'#ffe0ac':'#d4e3ef',-5);
    }
  }
  function drawFireworks(){
    // Painter order across BOTH light and smoke: a cloud in front veils a spark;
    // a spark in front stays bright. Sorting is recalculated for every viewpoint.
    const layers=[];
    for(const puff of smokeSample){const p=project(puff.x,puff.y,puff.z);if(inView(p,p?puff.radius*p.scale:0))layers.push({kind:'smoke',item:puff,p});}
    for(const b of worldSample.bursts){if(b.age>.24)continue;const p=project(b.x,b.y,b.z);if(inView(p))layers.push({kind:'flash',item:b,p});}
    for(const spark of worldSample.sparks){const p=project(spark.x,spark.y,spark.z);if(inView(p,20))layers.push({kind:'spark',item:spark,p});}
    for(const rocket of worldSample.rockets){const p=project(rocket.x,rocket.y,rocket.z);if(inView(p))layers.push({kind:'rocket',item:rocket,p});}
    layers.sort((a,b)=>b.p.z-a.p.z);
    ctx.save();
    for(const layer of layers){
      const {kind,item:s,p}=layer;
      if(kind==='smoke'){drawSmokePuff(s,p);continue;}
      ctx.globalCompositeOperation='lighter';ctx.globalAlpha=1;
      if(kind==='flash'){const a=1-s.age/.24;ctx.globalAlpha=a*.85;const r=clamp(25*p.scale,8,60);ctx.drawImage(sprite(s.color),p.x-r,p.y-r,r*2,r*2);continue;}
      if(kind==='spark'){
        const size=clamp(s.size*camera.f*1.13/p.z,.35,5);
        const q=project(s.px,s.py,s.pz);
        if(q){ctx.strokeStyle=`rgba(${s.color.join(',')},${s.alpha*.64})`;ctx.lineWidth=Math.max(.5,size*.55);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(p.x,p.y);ctx.stroke();}
        ctx.globalAlpha=s.alpha*.66;const glow=size*3.8;ctx.drawImage(sprite(s.color.map(c=>Math.min(255,Math.round(c/24)*24))),p.x-glow,p.y-glow,glow*2,glow*2);
        ctx.globalAlpha=s.alpha;ctx.fillStyle=`rgb(${s.color.join(',')})`;ctx.beginPath();ctx.arc(p.x,p.y,size*.56,0,TAU);ctx.fill();
      }else{
        ctx.globalAlpha=s.alpha??.85;
        const q=project(s.prevX,s.prevY,s.prevZ);
        if(q){const g=ctx.createLinearGradient(q.x,q.y,p.x,p.y);g.addColorStop(0,'rgba(255,180,85,0)');g.addColorStop(1,'rgba(255,216,145,.9)');ctx.strokeStyle=g;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(p.x,p.y);ctx.stroke();}
        const sz=clamp((s.child?2:5)*p.scale,s.child?1.5:3,10);ctx.drawImage(sprite(s.color||[255,191,76]),p.x-sz,p.y-sz,sz*2,sz*2);
      }
    }
    ctx.restore();
  }
  function drawMap(){if(!state.map)return;mc.setTransform(2,0,0,2,0,0);const w=174,h=140,cx=87,cy=71,scale=53/(Math.max(state.distance,650)*1.15);mc.clearRect(0,0,w,h);const xy=(x,z)=>[cx+x*scale,cy-z*scale];mc.strokeStyle='#2c4258';mc.lineWidth=.7;mc.beginPath();mc.moveTo(cx,9);mc.lineTo(cx,133);mc.moveTo(14,cy);mc.lineTo(160,cy);mc.stroke();mc.setLineDash([2,4]);mc.beginPath();mc.arc(cx,cy,state.distance*scale,0,TAU);mc.stroke();mc.setLineDash([]);const cp=xy(camera.x,camera.z);mc.strokeStyle='#cfbd9c';mc.beginPath();mc.moveTo(...cp);mc.lineTo(cx,cy);mc.stroke();mc.fillStyle='rgba(210,188,151,.07)';mc.beginPath();mc.moveTo(...cp);const facing=Math.atan2(cy-cp[1],cx-cp[0]);mc.arc(...cp,Math.min(75,state.distance*scale),facing-.45,facing+.45);mc.closePath();mc.fill();for(const s of model.sites){const p=xy(s.x,s.z);mc.fillStyle=s.id==='A'?'#97cfea':'#e9acc3';mc.beginPath();mc.arc(...p,3,0,TAU);mc.fill();mc.font='10px sans-serif';mc.textAlign=s.id==='A'?'right':'left';mc.fillText(s.id,p[0]+(s.id==='A'?-6:6),p[1]+4);}mc.save();mc.translate(...cp);mc.rotate(facing);mc.fillStyle='#f3ce98';mc.beginPath();mc.moveTo(6,0);mc.lineTo(-4,-4);mc.lineTo(-2,0);mc.lineTo(-4,4);mc.closePath();mc.fill();mc.restore();mc.fillStyle='#93a9c0';mc.font='9px sans-serif';mc.textAlign='right';mc.fillText(`${Math.round(state.azimuth)}°`,163,131);drawWindMap();}
  function drawWindMap(){
    const a=state.windDirection*DEG,dx=Math.sin(a),dy=-Math.cos(a),cx=25,cy=22;
    mc.fillStyle='#c4c9d1';mc.strokeStyle='#c4c9d1';mc.lineWidth=1.3;
    if(state.windSpeed===0){mc.beginPath();mc.arc(cx,cy,3,0,TAU);mc.stroke();}
    else {const tip=[cx+dx*9,cy+dy*9];mc.beginPath();mc.moveTo(cx-dx*9,cy-dy*9);mc.lineTo(...tip);mc.lineTo(tip[0]-dx*4+dy*3,tip[1]-dy*4-dx*3);mc.moveTo(...tip);mc.lineTo(tip[0]-dx*4-dy*3,tip[1]-dy*4+dx*3);mc.stroke();}
    mc.font='9px sans-serif';mc.textAlign='left';mc.fillText(state.windSpeed===0?'無風':`風 ${state.windSpeed.toFixed(1)} m/s`,42,25);
  }
  function updateSmokeUI(){
    $('smoke').checked=state.smoke;$('smokeControls').hidden=!state.smoke;$('smokeStatus').hidden=false;
    $('smokeDensityValue').innerHTML=`${Math.round(state.smokeDensity*100)}<small>%</small>`;
    $('windSpeedValue').innerHTML=`${state.windSpeed.toFixed(1)}<small>m/s</small>`;
    $('windDirectionValue').innerHTML=`${Math.round(state.windDirection)}<small>°</small>`;
    const flow=state.windSpeed===0?'無風':`風 ${state.windSpeed.toFixed(1)} m/s · 流れる先 ${Math.round(state.windDirection)}°`;
    $('smokeStatus').textContent=`${state.smoke?'煙 ON · ':''}${flow}`;
  }
  function toggleSmoke(on){state.smoke=on;dirty=true;updateUI();announce(on?'煙を表示しました':'煙を非表示にしました。風は花火の運動に引き続き作用します');}
  function updateTypeUI(){
    const meta=typeById.get(state.selectedType);if($('shapeDescription').textContent!==meta.description)$('shapeDescription').textContent=meta.description;
    const names=[];
    for(const site of model.sites){
      const live=[...new Set(worldSample.bursts.filter(b=>b.site===site.id&&b.age<b.life*.76).map(b=>typeById.get(b.type).name))];
      if(live.length)names.push(`${site.id}：${live.slice(-2).join('・')}`);
    }
    const caption=names.length?names.join('　 /　 '):state.time>=180?'打ち上げ終了':'開花を待っています';if($('activeTypes').textContent!==caption)$('activeTypes').textContent=caption;
  }
  function inspectType(){
    const selected=model.studyTimes[state.selectedType],meta=typeById.get(state.selectedType);
    state.time=selected.time;state.playing=false;state.studyEventId=selected.eventId;state.guides=true;
    state.distance=950;state.height=65;state.azimuth=wrap(selected.azimuth);state.tracking=true;
    changed();$('viewName').textContent=`${meta.name}の観察`;
    announce(`${meta.name}が開いた時刻で一時停止しました。左右キーで周回して観察できます`);
  }
  function draw(){camera=cameraFor();const key=[state.time,state.windSpeed,state.windDirection].join('/');if(sampleKey!==key){worldSample=model.sample(state.time,{windSpeed:state.windSpeed,windDirection:state.windDirection});sampleKey=key;updateTypeUI();}refreshSmoke();drawEnvironment();drawReflection();drawGuides();drawFireworks();drawLocalSmoke();drawMap();const target=project(0,300,0);$('offscreen').hidden=state.time>=180||inView(target,-40);dirty=false;}
  function resize(){const rect=$('scene').getBoundingClientRect();width=rect.width;height=rect.height;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);dirty=true;}
  function updateUI(){
    for(const name of ['distance','height','azimuth','pitch']){const n=Math.round(state[name]);$(name).value=n;$(`${name}Value`).innerHTML=`${n.toLocaleString('ja-JP')}<small>${name==='height'||name==='distance'?'m':'°'}</small>`;}
    $('hudDistance').textContent=`${Math.round(state.distance).toLocaleString('ja-JP')} m`;$('hudHeight').textContent=`${Math.round(state.height).toLocaleString('ja-JP')} m`;$('hudAzimuth').textContent=`${Math.round(state.azimuth)}°`;$('tracking').checked=state.tracking;$('guides').checked=state.guides;updateSmokeUI();updateTypeUI();
    $('time').value=state.time;const sec=Math.floor(state.time);$('clock').textContent=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;$('time').setAttribute('aria-valuetext',`${Math.floor(sec/60)}分${sec%60}秒`);
    $('play').textContent=state.playing?'Ⅱ 一時停止':state.time>=180?'▶ もう一度':'▶ 再生';$('play').setAttribute('aria-label',state.playing?'一時停止':'再生');document.body.classList.toggle('paused',!state.playing);$('finished').hidden=state.time<180;
    $('phase').textContent=state.time>=180?'FIN / 終幕':state.time>=150?'04 / フィナーレ':state.time>=120?'03 / 輪と球':state.time>=60?'02 / 広がり':'01 / 開幕';
    if(state.smoke){$('insightTitle').textContent='煙が手前に重なると、花火がかすんで見える。';$('insightText').textContent='同じ時刻で周回したり、風の向き・強さを変えたりして、煙の位置と見え方を比べてみましょう。';}
    else if(state.height>600){$('insightTitle').textContent='上から見ると、花火の奥行きが現れる。';$('insightText').textContent='水面と花火の高さを比べてみましょう。高度を変えても、水平距離は一定です。';}
    else if(Math.abs(Math.cos(state.azimuth*DEG))<.3){$('insightTitle').textContent='2地点が重なると、遠近の違いが見える。';$('insightText').textContent='AとBを結ぶ方向から見ると、手前の花火は大きく、奥の花火は小さく見えます。';}
    else if(state.guides){$('insightTitle').textContent='花火の光は、三次元に広がっている。';$('insightText').textContent='補助線を手がかりに周回して、光の粒がどの方向に広がっているか観察してみましょう。';}
    else{$('insightTitle').textContent='距離が変わると、見かけの大きさが変わる。';$('insightText').textContent='一時停止してから回り込むと、同じ花火を別の角度から観察できます。';}
  }
  function changed(custom=true){if(state.tracking)state.pitch=centerPitch();if(custom){document.querySelectorAll('[data-preset]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});$('viewName').textContent='自由な視点';}dirty=true;updateUI();}
  function setView(name){const p=presets[name];[state.distance,state.height,state.azimuth]=p;state.tracking=true;state.pitch=centerPitch();document.querySelectorAll('[data-preset]').forEach(b=>{const yes=b.dataset.preset===name;b.classList.toggle('active',yes);b.setAttribute('aria-pressed',String(yes));});$('viewName').textContent=presetNames[name];changed(false);announce(`${presetNames[name]}の視点に変更しました`);}
  function move(action,dt,boost=1){const linear=dt*boost,radialSpeed=clamp(state.distance*.4,10,260);switch(action){case'near':state.distance=clamp(state.distance-radialSpeed*linear,10,3000);break;case'far':state.distance=clamp(state.distance+radialSpeed*linear,10,3000);break;case'up':state.height=clamp(state.height+180*linear,5,1600);break;case'down':state.height=clamp(state.height-180*linear,5,1600);break;case'left':state.azimuth=wrap(state.azimuth-32*linear);break;case'right':state.azimuth=wrap(state.azimuth+32*linear);break;case'lookUp':state.tracking=false;state.pitch=clamp(state.pitch+28*linear,-90,90);break;case'lookDown':state.tracking=false;state.pitch=clamp(state.pitch-28*linear,-90,90);break;}changed();}
  function playToggle(){if(state.time>=180)state.time=0;state.playing=!state.playing;dirty=true;updateUI();announce(state.playing?'再生しました':'一時停止しました。視点を変更できます');}
  function restart(){state.time=0;state.playing=true;dirty=true;updateUI();announce('最初から3分間の再生を開始しました');}
  const keyActions={ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',ArrowRight:'right',KeyA:'near',KeyZ:'far',KeyE:'lookUp',KeyD:'lookDown'};
  function isEditing(target){return target&&(/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)||target.isContentEditable);}
  document.addEventListener('keydown',e=>{if(isEditing(e.target)||e.metaKey||e.ctrlKey||e.altKey)return;if(keyActions[e.code]){e.preventDefault();keys.add(e.code);}else if(e.code==='ShiftLeft'||e.code==='ShiftRight'){keys.add(e.code);}else if(e.code==='Space'&&e.target.tagName!=='BUTTON'){e.preventDefault();if(!e.repeat)playToggle();}else if(e.code==='KeyH'&&!e.repeat){e.preventDefault();toggleSmoke(!state.smoke);}else if(e.code==='KeyR'&&!e.repeat){e.preventDefault();restart();}});
  document.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>{keys.clear();heldAction=null;});
  document.addEventListener('visibilitychange',()=>{keys.clear();heldAction=null;if(document.hidden&&state.playing){state.playing=false;updateUI();announce('画面が非表示になったため一時停止しました');}lastFrame=0;});
  document.querySelectorAll('[data-action]').forEach(button=>{button.addEventListener('pointerdown',e=>{if(e.button!==0)return;button.setPointerCapture(e.pointerId);heldAction=button.dataset.action;holdSince=performance.now();move(heldAction,.15);});const stop=()=>{heldAction=null;};button.addEventListener('pointerup',stop);button.addEventListener('pointercancel',stop);button.addEventListener('lostpointercapture',stop);button.addEventListener('click',e=>{if(e.detail===0)move(button.dataset.action,.15);});});
  document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.preset)));
  for(const name of ['distance','height','azimuth','pitch'])$(name).addEventListener('input',()=>{state[name]=name==='azimuth'?wrap(+$(name).value):+$(name).value;if(name==='pitch')state.tracking=false;changed();});
  $('play').addEventListener('click',playToggle);$('restart').addEventListener('click',restart);$('time').addEventListener('input',()=>{state.time=+$('time').value;state.playing=false;dirty=true;updateUI();});$('time').addEventListener('change',()=>announce(`${$('clock').textContent}で一時停止しました`));$('speed').addEventListener('change',()=>{state.speed=+$('speed').value;});
  function recenter(){state.tracking=true;changed();announce('花火の中心に視線を合わせました');}
  $('recenter').addEventListener('click',recenter);$('recenterOverlay').addEventListener('click',recenter);$('tracking').addEventListener('change',()=>{state.tracking=$('tracking').checked;changed();});
  $('guides').addEventListener('change',()=>{state.guides=$('guides').checked;dirty=true;updateUI();});$('grid').addEventListener('change',()=>{state.grid=$('grid').checked;dirty=true;});$('showMap').addEventListener('change',()=>{state.map=$('showMap').checked;$('mapbox').hidden=!state.map;dirty=true;});
  $('smoke').addEventListener('change',()=>toggleSmoke($('smoke').checked));
  for(const name of ['smokeDensity','windSpeed','windDirection'])$(name).addEventListener('input',()=>{state[name]=+$(name).value/(name==='smokeDensity'?100:1);dirty=true;updateUI();});
  $('fireworkType').addEventListener('change',()=>{state.selectedType=$('fireworkType').value;updateTypeUI();});
  $('inspectType').addEventListener('click',inspectType);
  $('study').addEventListener('click',()=>{state.time=model.comparisonTime;state.playing=false;state.studyEventId=null;state.guides=true;setView('shore');announce('球と輪が見える時刻で一時停止しました。左右キーで回り込んで観察できます');});
  $('toggleControls').addEventListener('click',()=>{const hidden=document.body.classList.toggle('hide-controls');$('toggleControls').textContent=hidden?'操作パネルを表示':'操作パネルを隠す';$('toggleControls').setAttribute('aria-pressed',String(hidden));resize();});
  $('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{announce('このブラウザーでは全画面を利用できません');}});document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'全画面を終了':'全画面';resize();});
  let drag=null;canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY};});canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;state.azimuth=wrap(state.azimuth-dx*.16);state.pitch=clamp(state.pitch+dy*.12,-90,90);state.tracking=false;drag={x:e.clientX,y:e.clientY};changed();});const release=()=>{drag=null;};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);canvas.addEventListener('wheel',e=>{e.preventDefault();state.distance=clamp(state.distance+e.deltaY*clamp(state.distance*.0009,.025,.65),10,3000);changed();},{passive:false});
  function frame(now){const elapsed=lastFrame?Math.max((now-lastFrame)/1000,0):0,dt=Math.min(elapsed,.1);lastFrame=now;const boost=keys.has('ShiftLeft')||keys.has('ShiftRight')?3:1;const actions=new Set([...keys].map(k=>keyActions[k]).filter(Boolean));for(const action of actions)move(action,dt,boost);if(heldAction&&now-holdSince>220)move(heldAction,dt);if(state.playing){state.time=Math.min(180,state.time+elapsed*state.speed);dirty=true;if(state.time>=180){state.playing=false;announce('3分間の打ち上げが終了しました');}}if(now-lastUI>100){updateUI();lastUI=now;}if(dirty)draw();requestAnimationFrame(frame);}
  new ResizeObserver(resize).observe($('scene'));state.pitch=centerPitch();resize();updateUI();requestAnimationFrame(frame);
  // A small read-only inspection hook makes the coordinate system auditable.
  window.Hanabi = Object.freeze({getState:()=>({...state}),getCamera:()=>({...camera,right:[...camera.right],up:[...camera.up],forward:[...camera.forward]}),project:(x,y,z)=>project(x,y,z),model});
})();
