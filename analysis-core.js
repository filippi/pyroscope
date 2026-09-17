/* Pure aggregation engine, shared by the browser worker and Node verification. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EventAnalysis=api})(typeof self!=='undefined'?self:globalThis,()=>{
 'use strict';
 const SPACE=Array.from({length:11},(_,i)=>i+5),TIME=Array.from({length:11},(_,i)=>i+22),OFFSET=549755813888;
 const sources={F:'MTG',M:'MODIS',S:'VIIRS Suomi NPP','1':'VIIRS NOAA-20','2':'VIIRS NOAA-21',E:'GOES East',W:'GOES West',H:'Himawari'};
 const sourceFamily=source=>['S','1','2'].includes(source)?'VIIRS':sources[source]||source;
 function decode(buffer,eventId=''){
  if(buffer.byteLength%24)throw Error('Truncated FRP1R event');const v=new DataView(buffer),records=[];
  for(let o=0;o<buffer.byteLength;o+=24){const t=v.getBigUint64(o+8),level=Number(t>>42n);if(level>40)throw Error('Invalid TIX level');const p=(t&((1n<<42n)-1n))>>BigInt(42-level),time=(Number(p)*2**(40-level)-OFFSET)*1000,frp=v.getFloat32(o+16,true);records.push({h3:v.getBigUint64(o).toString(16).padStart(15,'0'),time,tLevel:level,source:String.fromCharCode(v.getUint8(o+21)),frp:Number.isFinite(frp)&&frp>=0?frp:null,eventId})}return records;
 }
 const bucket=(time,level)=>Math.floor((time/1000+OFFSET)/2**(40-level));
 const bucketTime=(index,level)=>(index*2**(40-level)-OFFSET)*1000;
 function prepare(records,h3){
  const cache=new Map();let minH=15,minT=40;
  const sorted=[...records].sort((a,b)=>a.time-b.time),leaves=[...new Set(sorted.map(r=>r.h3))].sort(),rank=new Map(leaves.map((c,i)=>[c,i]));
  for(const r of sorted){if(!h3.isValidCell(r.h3))throw Error('Invalid H3 cell');const level=h3.getResolution(r.h3);minH=Math.min(minH,level);minT=Math.min(minT,r.tLevel);if(!cache.has(r.h3))cache.set(r.h3,Array.from({length:level+1},(_,i)=>h3.cellToParent(r.h3,i)));r.parents=cache.get(r.h3);r.rank=rank.get(r.h3)}
  const first=sorted[0]?.time||0,last=sorted.at(-1)?.time||first;
  let rootH=-1,rootT=0;
  if(sorted.length){for(let s=0;s<=minH;s++){const c=sorted[0].parents[s];if(sorted.every(r=>r.parents[s]===c))rootH=s;else break}for(let t=0;t<=minT;t++){if(bucket(first,t)===bucket(last,t))rootT=t;else break}}
  return{records:sorted,minH,minT,rootH,rootT,first,last,leafCount:leaves.length};
 }
 function distribution(map,total){if(!total)return{n:0,entropy:0,mean:0};let entropy=0;for(const count of map.values()){const p=count/total;entropy-=p*Math.log(p)}return{n:map.size,entropy,mean:total/map.size}}
 function dimension(a,b,scale){return a&&b&&a.n&&b.n?{d0:Math.log(b.n/a.n)/Math.log(scale),d1:(b.entropy-a.entropy)/Math.log(scale),ratio:b.n/a.n}:null}
 function aggregate(prepared,options={}){
  const {from=-Infinity,to=Infinity,excluded=[],mode='joint',depth=7,maxNodes=16000,powerLevel=9}=options,skip=new Set(excluded),sourceRecords=prepared.records.filter(r=>!skip.has(r.source)),records=sourceRecords.filter(r=>r.time>=from&&r.time<=to),n=records.length;
  if(sourceRecords.length)prepared={...prepared,minH:sourceRecords.reduce((v,r)=>Math.min(v,r.parents.length-1),15),minT:sourceRecords.reduce((v,r)=>Math.min(v,r.tLevel),40)};
  const space=SPACE.map(level=>level<=prepared.minH?new Map():null),time=TIME.map(level=>level<=prepared.minT?new Map():null),joint=SPACE.map(s=>TIME.map(t=>s<=prepared.minH&&t<=prepared.minT?new Set():null));
  for(const r of records){const ts=TIME.map(t=>bucket(r.time,t));SPACE.forEach((s,i)=>{if(space[i]){const cell=r.parents[s];space[i].set(cell,(space[i].get(cell)||0)+1);TIME.forEach((t,j)=>{if(joint[i][j])joint[i][j].add(cell+'/'+ts[j])})}});TIME.forEach((t,j)=>{if(time[j])time[j].set(ts[j],(time[j].get(ts[j])||0)+1)})}
  const spatial=space.map(m=>m?distribution(m,n):null),temporal=time.map(m=>m?distribution(m,n):null),sd=SPACE.slice(1).map((_,i)=>dimension(spatial[i],spatial[i+1],Math.sqrt(7))),td=TIME.slice(1).map((_,i)=>dimension(temporal[i],temporal[i+1],2));
  const coefficients=[...sd.map(x=>x?.d0??null),...sd.map(x=>x?.d1??null),...td.map(x=>x?.d0??null),...td.map(x=>x?.d1??null)];
  const graph=hierarchy(prepared,records,{mode,depth,maxNodes});
  return{n,power:observedPower(records,Math.min(prepared.minH,Math.max(0,powerLevel))),spatial,temporal,coefficients,joint:joint.map(row=>row.map(m=>m?m.size:null)),graph,limits:{h3:prepared.minH,tix:prepared.minT},root:{h3:prepared.rootH,tix:prepared.rootT},range:{from,to},sourceCounts:records.reduce((a,r)=>(a[r.source]=(a[r.source]||0)+1,a),{}),schema:'stfy-signature-v1-h5-15-t22-32'};
 }
 // Observation-only power: sum pixel FRP within a source/hex/time, then
 // average those sums over times with valid detections. Missing times are unknown.
 function observedPower(records,level){
  const groups=new Map();
  for(const r of records){const cell=r.parents[level],key=r.source+'/'+cell;let group=groups.get(key);if(!group){group={source:r.source,cell,level,detections:0,validDetections:0,invalidDetections:0,observations:new Map()};groups.set(key,group)}group.detections++;
   if(!Number.isFinite(r.frp)||r.frp<0){group.invalidDetections++;continue}group.validDetections++;group.observations.set(r.time,(group.observations.get(r.time)||0)+r.frp);
  }
  const rows=[...groups.values()].map(group=>{const values=[...group.observations.values()],sum=values.reduce((a,b)=>a+b,0),{observations,...base}=group;return{...base,observedTimes:values.length,meanObservedFrpMW:values.length?sum/values.length:null,maxObservedFrpMW:values.length?values.reduce((a,b)=>Math.max(a,b),0):null}}).sort((a,b)=>(b.meanObservedFrpMW??-1)-(a.meanObservedFrpMW??-1)||a.source.localeCompare(b.source)||a.cell.localeCompare(b.cell));
  return{level,rows,method:'mean of source-specific summed pixel FRP at stored detection times within each H3 cell',unit:'MW',areaNormalized:false,cloudCorrected:false,integratedEnergy:null};
 }
 function hierarchy(p,records,{mode,depth,maxNodes}){
  const baseH=p.rootH,baseT=p.rootT,maxDepth=mode==='space'?p.minH-baseH:mode==='time'?p.minT-baseT:Math.max(p.minH-baseH,p.minT-baseT),last=Math.min(Math.max(0,depth),maxDepth),layers=[],all=[],edges=[],layerNodes=[];let previous=null,fullNodes=0;
  for(let d=0;d<=last;d++){
   const s=mode==='time'?baseH:Math.min(p.minH,baseH+d),t=mode==='space'?baseT:Math.min(p.minT,baseT+d),groups=new Map();
   for(const r of records){const cell=s<0?'union':r.parents[s],tick=bucket(r.time,t),key=cell+'/'+tick;let node=groups.get(key);if(!node){const ps=mode==='time'?baseH:Math.min(p.minH,baseH+d-1),pt=mode==='space'?baseT:Math.min(p.minT,baseT+d-1);node={id:d+':'+key,parent:d?(d-1)+':'+(ps<0?'union':r.parents[ps])+'/'+bucket(r.time,pt):null,cell,tick,s,t,depth:d,count:0,rank:0,time:0};groups.set(key,node)}node.count++;node.rank+=r.rank;node.time+=r.time}
   const nodes=[...groups.values()];fullNodes+=nodes.length;for(const node of nodes){node.x=p.leafCount>1?(node.rank/node.count/(p.leafCount-1)-.5)*240:0;node.z=p.last>p.first?((node.time/node.count-p.first)/(p.last-p.first)-.5)*200:0;node.y=(last-d)*28;delete node.rank;delete node.time}
   layerNodes.push(nodes);layers.push({depth:d,h3:s,tix:t,nodes:nodes.length,drawn:0,count:records.length});
  }
  // Render everything below the limit; otherwise share the budget across depths.
  layerNodes.forEach((nodes,d)=>{
   const budget=fullNodes<=maxNodes?nodes.length:Math.max(1,Math.floor((maxNodes-all.length)/(last-d+1))),eligible=nodes.filter(node=>!previous||previous.has(node.parent)).sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id)),drawn=eligible.slice(0,budget);
   previous=new Set(drawn.map(x=>x.id));for(const node of drawn){all.push(node);if(node.parent)edges.push([node.parent,node.id])}layers[d].drawn=drawn.length;
  });
  return{nodes:all,edges,layers,fullNodes,maxDepth,truncated:all.length<fullNodes};
 }
 return{SPACE,TIME,OFFSET,sources,sourceFamily,decode,bucket,bucketTime,prepare,aggregate,dimension,observedPower};
});
