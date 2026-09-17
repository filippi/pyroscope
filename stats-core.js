/* Pure archive statistics helpers, shared by the worker and tests. */
(function(root){
'use strict';
function epoch(tix){const level=Number(tix>>42n);if(level<0||level>40)throw Error('Invalid time index');return Number((((tix&((1n<<42n)-1n))>>BigInt(42-level))<<BigInt(40-level))-549755813888n);}
function ringContains(ring,x,y){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function countryLocator(features){
 const cells=new Map();
 features.forEach((f,id)=>{const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;for(const poly of polygons){const xs=poly[0].map(p=>p[0]),ys=poly[0].map(p=>p[1]);const box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];const item={id,poly,box};for(let x=Math.floor(box[0]/10);x<=Math.floor(box[2]/10);x++)for(let y=Math.floor(box[1]/10);y<=Math.floor(box[3]/10);y++){const key=x+','+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);}}});
 return (lat,lon)=>{for(const {id,poly,box} of cells.get(Math.floor(lon/10)+','+Math.floor(lat/10))||[]){if(lon<box[0]||lon>box[2]||lat<box[1]||lat>box[3])continue;if(ringContains(poly[0],lon,lat)&&!poly.slice(1).some(r=>ringContains(r,lon,lat)))return id;}return features.length;};
}
function distribution(values){
 const sorted=values.slice().sort((a,b)=>a-b), bins=new Map(),ccdf=[];
 // Powers of two give explicit [lower, upper) bins, starting at one observation.
 for(const v of sorted){const lo=2**Math.floor(Math.log2(v));bins.set(lo,(bins.get(lo)||0)+1);}
 for(let i=0;i<sorted.length;){const v=sorted[i];ccdf.push([v,(sorted.length-i)/sorted.length]);while(i<sorted.length&&sorted[i]===v)i++;}
 // Retain extrema; logarithmically sample long exact survival curves for rendering.
 const sampled=ccdf.length<=300?ccdf:Array.from(new Set(Array.from({length:300},(_,i)=>Math.round((ccdf.length-1)*i/299)))).map(i=>ccdf[i]);
 return {bins:[...bins].sort((a,b)=>a[0]-b[0]).map(([lo,n])=>[Math.sqrt(lo*lo*2),n/(sorted.length*lo),n,lo,lo*2]),ccdf:sampled};
}
function aggregate(d,f){
 const annual=new Map(),byYear=new Map(),months=Array(12).fill(0),latitude=Array(18).fill(0),countries=new Map(),durations=Array(8).fill(0),sizes=[];
 const selected=new Set(f.years.map(Number));let hotspots=0,clusters=0,minTime=Infinity,maxTime=-Infinity;
 for(let i=0;i<d.count.length;i++){
  const lat=d.lat[i];if(!Number.isFinite(lat)||lat<f.minLat||lat>f.maxLat||d.count[i]<f.minCount)continue;
  if(f.hemisphere==='north'&&lat<0||f.hemisphere==='south'&&lat>=0)continue;
  if(f.country!==''&&d.country[i]!==Number(f.country))continue;
  const date=new Date((f.basis==='end'?d.end[i]:d.start[i])*1000),year=date.getUTCFullYear();
  if(!annual.has(year))annual.set(year,[year,0,0]);const a=annual.get(year);a[1]++;a[2]+=d.count[i];
  if(!selected.has(year))continue;
  const n=d.count[i];clusters++;hotspots+=n;sizes.push(n);if(!byYear.has(year))byYear.set(year,[]);byYear.get(year).push(n);
  months[date.getUTCMonth()]++;latitude[Math.min(17,Math.floor((lat+90)/10))]++;countries.set(d.country[i],(countries.get(d.country[i])||0)+1);
  const days=(d.end[i]-d.start[i])/86400;const cut=[1/24,1,3,7,30,90,365];let k=0;while(k<cut.length&&days>=cut[k])k++;durations[k]++;
  minTime=Math.min(minTime,d.start[i]);maxTime=Math.max(maxTime,d.end[i]);
 }
 sizes.sort((a,b)=>b-a);const topN=Math.ceil(clusters*.01),topShare=hotspots?sizes.slice(0,topN).reduce((a,b)=>a+b,0)/hotspots:0;
 return {annual:[...annual.values()].sort((a,b)=>a[0]-b[0]),clusters,hotspots,months,latitude,durations,countries:[...countries].sort((a,b)=>b[1]-a[1]),distribution:distribution(sizes),years:[...byYear].sort((a,b)=>a[0]-b[0]).map(([year,v])=>({year,n:v.length,...distribution(v)})),topShare,topN,minTime,maxTime};
}
const api={epoch,countryLocator,distribution,aggregate};if(typeof module!=='undefined')module.exports=api;else root.ArchiveStats=api;
})(globalThis);
