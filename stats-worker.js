'use strict';
importScripts('vendor/stats/fzstd.js','vendor/stats/h3-js.umd.js','stats-core.js');
let dataset;
const progress=(message,value)=>postMessage({type:'progress',message,value});
async function load(){
 progress('Downloading archive index…',0);
 const [response,borders]=await Promise.all([fetch('ARCH/H3TI/ARCHIVE.h3ti.zst',{cache:'no-cache'}),fetch('data/countries-110m.json')]);
 if(!response.ok)throw Error('Archive index: HTTP '+response.status);if(!borders.ok)throw Error('Country boundaries: HTTP '+borders.status);
 const total=Number(response.headers.get('content-length')),reader=response.body.getReader(),parts=[];let loaded=0;
 for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);loaded+=value.length;progress('Downloading archive · '+(loaded/1048576).toFixed(1)+' MB',total?loaded/total*.45:0);}
 let compressed=new Uint8Array(loaded),offset=0;for(const p of parts){compressed.set(p,offset);offset+=p.length;}parts.length=0;
 progress('Decompressing archive…',.48);const raw=fzstd.decompress(compressed);compressed=null;
 if(raw.byteLength%32)throw Error('Invalid archive: incomplete 32-byte record');
 const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),n=raw.byteLength/32,features=(await borders.json()).features;
 const locate=ArchiveStats.countryLocator(features),names=features.map(f=>f.properties.name);names.push('Offshore / unmatched');
 const d={count:new Uint32Array(n),start:new Float64Array(n),end:new Float64Array(n),lat:new Float32Array(n),country:new Uint16Array(n)};
 const locations=new Map(),years=new Set();let used=0,skipped=0;
 for(let i=0;i<n;i++){
  const off=i*32;try{
   const id=view.getBigUint64(off,true).toString(16),start=ArchiveStats.epoch(view.getBigUint64(off+8,true)),end=ArchiveStats.epoch(view.getBigUint64(off+16,true)),count=view.getUint32(off+24,true);
   if(!count||end<start||!Number.isFinite(new Date(start*1000).getTime())||!Number.isFinite(new Date(end*1000).getTime())){skipped++;continue;}
   let location=locations.get(id);if(!location){const [lat,lon]=h3.cellToLatLng(id);location=[lat,locate(lat,lon)];locations.set(id,location);}
   d.count[used]=count;d.start[used]=start;d.end[used]=end;d.lat[used]=location[0];d.country[used]=location[1];used++;
   years.add(new Date(start*1000).getUTCFullYear());years.add(new Date(end*1000).getUTCFullYear());
  }catch(e){skipped++;}
  if(i%10000===0)progress('Locating and reading clusters · '+i.toLocaleString()+' / '+n.toLocaleString(),.5+.49*i/n);
 }
 for(const key of Object.keys(d))d[key]=d[key].subarray(0,used);dataset=d;
 const counts=new Map();for(const c of d.country)counts.set(c,(counts.get(c)||0)+1);
 postMessage({type:'ready',years:[...years].sort((a,b)=>a-b),countries:names.map((name,id)=>({id,name,n:counts.get(id)||0})).filter(c=>c.n).sort((a,b)=>a.name.localeCompare(b.name)),names,records:used,skipped,bytes:loaded});
}
onmessage=async({data})=>{try{if(data.type==='load')await load();else if(data.type==='query'){if(!dataset)throw Error('Archive not loaded');postMessage({type:'result',id:data.id,result:ArchiveStats.aggregate(dataset,data.filters)});}}catch(e){postMessage({type:'error',message:e.message,id:data.id});}};
