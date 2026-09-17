/* Browser/CommonJS math for the simple event viewer. No build step. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EventMetrics=api})(typeof self!=='undefined'?self:globalThis,()=>{
 'use strict';
 const NOMINAL_AREA_KM2=Object.freeze({F:1,M:1,S:.375**2,'1':.375**2,'2':.375**2,E:4,W:4,H:4});
 const COOBSERVATION_MS=600000,ROS_WINDOW_MS=1800000;
 function pixelArea(record){
  if(Number.isFinite(record.pixelAreaKm2)&&record.pixelAreaKm2>0)return{area:record.pixelAreaKm2,nominal:false};
  if(Number.isFinite(record.scan)&&record.scan>0&&Number.isFinite(record.track)&&record.track>0)return{area:record.scan*record.track,nominal:false};
  const area=NOMINAL_AREA_KM2[record.source];return area?{area,nominal:true}:null;
 }
 function fluxDensity(record){const area=pixelArea(record);return area&&Number.isFinite(record.frp)&&record.frp>=0?record.frp*.001/area.area:null}
 function localFlux(records,h3,{level=9,intervalMs=COOBSERVATION_MS}={}){
  const cells=new Map(),parents=new Map(),cellAreas=new Map();let nominal=0,invalid=0;
  for(const r of records){const area=pixelArea(r);if(!area||!Number.isFinite(r.frp)||r.frp<0||!Number.isFinite(r.time)){invalid++;continue}if(area.nominal)nominal++;
   let cell=parents.get(r.h3);if(!cell){cell=h3.cellToParent(r.h3,Math.min(level,h3.getResolution(r.h3)));parents.set(r.h3,cell)}
   const slot=Math.floor(r.time/intervalMs),key=cell+'/'+slot;let group=cells.get(key);if(!group){group={cell,slot,time:(slot+.5)*intervalMs,sources:new Map()};cells.set(key,group)}
   if(!group.sources.has(r.source))group.sources.set(r.source,new Map());const times=group.sources.get(r.source);if(!times.has(r.time))times.set(r.time,{power:0,area:0});const observation=times.get(r.time);observation.power+=r.frp;observation.area+=area.area;
  }
  const points=[],peakByCell=new Map();
  for(const group of cells.values()){
   // Mean across acquisitions within each source, then equal weight per source.
   const sourceValues=[...group.sources.values()].map(times=>[...times.values()].reduce((sum,o)=>sum+o.power*.001/o.area,0)/times.size),density=sourceValues.reduce((a,b)=>a+b,0)/sourceValues.length;
   if(!cellAreas.has(group.cell))cellAreas.set(group.cell,h3.cellArea(group.cell,'m2'));points.push({cell:group.cell,time:group.time,slot:group.slot,density,areaM2:cellAreas.get(group.cell),sources:sourceValues.length});peakByCell.set(group.cell,Math.max(peakByCell.get(group.cell)||0,density));
  }
  points.sort((a,b)=>a.time-b.time);return{points,peakByCell,nominal,invalid,intervalMs,level};
 }
 function binFlux(flux,start,end,count){
  const bins=Array.from({length:count},()=>({weighted:0,weight:0,max:null,mean:null})),span=Math.max(1,end-start);
  // First form spatial averages within co-observation slots, then average those
  // slot means in display bins. More detections/satellites never add MW together.
  const times=new Map();for(const p of flux.points){if(!times.has(p.slot))times.set(p.slot,{time:p.time,weighted:0,weight:0,max:0});const t=times.get(p.slot);t.weighted+=p.density*p.areaM2;t.weight+=p.areaM2;t.max=Math.max(t.max,p.density)}
  for(const t of times.values()){const i=Math.max(0,Math.min(count-1,Math.floor((t.time-start)/span*count))),b=bins[i];b.weighted+=t.weighted/t.weight;b.weight++;b.max=Math.max(b.max??0,t.max)}
  for(const b of bins)b.mean=b.weight?b.weighted/b.weight:null;return bins;
 }
 function areaPerimeterHistory(cells,h3){
  const ordered=[...cells].sort((a,b)=>a[1].time-b[1].time),active=new Set(),edges=new Map(),history=[];let areaM2=0,perimeterM=0;
  for(const[cell,v]of ordered){if(active.has(cell))continue;active.add(cell);areaM2+=h3.cellArea(cell,'m2');
   for(const edge of h3.originToDirectedEdges(cell)){const destination=h3.getDirectedEdgeDestination(edge),key=cell<destination?cell+'/'+destination:destination+'/'+cell;
    if(edges.has(key)){perimeterM-=edges.get(key);edges.delete(key)}else{const length=h3.edgeLength(edge,'m');edges.set(key,length);perimeterM+=length}
   }
   const point={time:v.time,areaM2,perimeterM:Math.max(0,perimeterM)};if(history.length&&history.at(-1).time===v.time)history[history.length-1]=point;else history.push(point);
  }
  return history;
 }
 function rateBetween(a,b){const seconds=(b.time-a.time)/1000,perimeter=(a.perimeterM+b.perimeterM)/2;return seconds>0&&a.areaM2>0&&perimeter>0?Math.max(0,b.areaM2-a.areaM2)/(seconds*perimeter):null}
 function rosSeries(history,start,end,{windowMs=ROS_WINDOW_MS,stepMs=COOBSERVATION_MS}={}){
  if(!(windowMs>0)||!(stepMs>0))throw Error('ROS intervals must be positive');
  // Never use observations beyond the available-data cutoff. start only crops output.
  history=history.filter(p=>p.time<=end);
  if(history.length<2)return[];
  const times=history.map(p=>p.time),integral=[0];
  for(let i=1;i<history.length;i++)integral.push(integral[i-1]+(history[i-1].perimeterM+history[i].perimeterM)/2*(times[i]-times[i-1])/1000);
  function at(time){
   let lo=0,hi=history.length;while(lo<hi){const mid=(lo+hi)>>1;if(times[mid]<=time)lo=mid+1;else hi=mid}
   const i=Math.max(0,lo-1),p=history[i],next=history[i+1];
   if(!next)return{areaM2:p.areaM2,integral:integral[i]};
   const fraction=(time-p.time)/(next.time-p.time),perimeter=p.perimeterM+(next.perimeterM-p.perimeterM)*fraction;
   return{areaM2:p.areaM2+(next.areaM2-p.areaM2)*fraction,integral:integral[i]+(p.perimeterM+perimeter)/2*(time-p.time)/1000};
  }
  const first=times[0],last=times.at(-1),sampleTimes=[];
  for(let time=first;time<=last;time+=stepMs)if(time>=start)sampleTimes.push(time);
  if(last>=start&&sampleTimes.at(-1)!==last)sampleTimes.push(last);
  return sampleTimes.map(time=>{
   // Shift the trailing window into available history at startup. Until minute 30,
   // this is the same first-window average, retrospectively drawn at early times.
   const from=Math.max(first,time-windowMs),to=Math.min(last,from+windowMs),a=at(from),b=at(to),duration=to-from;
   return{time,ros:duration>0&&b.integral>a.integral?Math.max(0,b.areaM2-a.areaM2)/(b.integral-a.integral):null,
    windowMs:duration,warmup:duration<windowMs,from,to,lookahead:to>time};
  });
 }

 return{NOMINAL_AREA_KM2,COOBSERVATION_MS,ROS_WINDOW_MS,pixelArea,fluxDensity,localFlux,binFlux,areaPerimeterHistory,rateBetween,rosSeries};
});
