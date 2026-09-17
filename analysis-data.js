/* Load the same explicit selection, or reproduce the simple viewer's automatic selection. */
globalThis.loadAnalysisData=async function(params,progress=()=>{}){
 const core=EventAnalysis,db=params.get('db')||'ARCH',sample=params.get('sample')==='1';
 async function fetchChecked(url,json=false){const response=await fetch(url);if(!response.ok)throw Error(`${response.status}: ${url}`);return json?response.json():response.arrayBuffer()}
 const api=q=>'stfyhotspot.php?'+new URLSearchParams({...q,db});
 async function parallel(items,fn){let next=0;const out=new Array(items.length);await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i])}}));return out}
 if(sample){const manifest=await fetchChecked('sampledata/manifest.json',true),ids=new Set(manifest.selectedEventIds),files=manifest.files.filter(f=>ids.has(f.id));let loaded=0;const arrays=await parallel(files,async f=>{const records=core.decode(await fetchChecked('sampledata/'+f.path),f.id);progress(`Loading local clusters ${++loaded}/${files.length}`);return records});return{records:arrays.flat(),ids:[...ids],key:manifest.resolved.key,sample:true}}
 let id=params.get('id'),key=params.get('key');if(!id&&key){const resolved=await fetchChecked(api({api:'resolve',key}),true);if(resolved.error)throw Error(resolved.error);id=resolved.id;key=resolved.key}if(!id)throw Error('Open Analysis from an event’s More menu, or choose Local sample.');
 let loaded=0;const get=async id=>{const records=core.decode(await fetchChecked(api({api:'event',id})),id).sort((a,b)=>a.time-b.time);progress(`Loaded ${++loaded} cluster${loaded===1?'':'s'}`);return{id,records}};
 const primary=await get(id);if(!primary.records.length)throw Error('The primary event is empty');let events=[primary];
 if(params.get('selection')==='explicit'||params.has('events')){const ids=[...new Set((params.get('events')||'').split(',').filter(x=>x&&x!==id))];events.push(...await parallel(ids,get))}
 else{
  const h5s=h3.gridDisk(h3.cellToParent(primary.records[0].h3,5),1),buffer=await fetchChecked(api({api:'nearby_events',h5:h5s.join(','),sort:'latest'})),v=new DataView(buffer);if(buffer.byteLength<16||new TextDecoder().decode(new Uint8Array(buffer,0,4))!=='ELS1'||v.getUint8(4)!==1)throw Error('Invalid nearby event list');const count=v.getUint32(8,true),tableEnd=16+count*56;if(buffer.byteLength!==tableEnd+v.getUint32(12,true))throw Error('Truncated nearby list');const decoder=new TextDecoder(),nearby=[];
  const tixSlot=t=>{const x=BigInt('0x'+t),l=Number(x>>42n),pos=(x&((1n<<42n)-1n))>>BigInt(42-l);return Math.floor(Number(pos)*2**(40-l)/2**17)};
  const first=core.bucket(primary.records[0].time,23)-1,last=core.bucket(primary.records.at(-1).time,23)+1;
  for(let i=0,o=16;i<count;i++,o+=56){const offset=v.getUint32(o+44,true),length=v.getUint32(o+48,true);if(offset+length>buffer.byteLength-tableEnd)throw Error('Invalid nearby string');const other=decoder.decode(new Uint8Array(buffer,tableEnd+offset,length));if(other!==id&&tixSlot(v.getBigUint64(o+16,true).toString(16))>=first&&tixSlot(v.getBigUint64(o+8,true).toString(16))<=last)nearby.push(other)}
  let pending=await parallel(nearby,get),total=primary.records.length;const footprint=new Set(primary.records.map(r=>h3.cellToParent(r.h3,6)));
  while(pending.length){const radius=total>=10000?2:total>=500?1:0,reachable=new Set([...footprint].flatMap(c=>h3.gridDisk(c,radius))),next=[],accepted=[];for(const e of pending)(e.records.some(r=>reachable.has(h3.cellToParent(r.h3,6)))?accepted:next).push(e);if(!accepted.length)break;for(const e of accepted){events.push(e);total+=e.records.length;for(const r of e.records)footprint.add(h3.cellToParent(r.h3,6))}pending=next}
 }
 return{records:events.flatMap(e=>e.records),ids:events.map(e=>e.id),key:key||id.split('/').at(-1).replace(/\.stfy$/,''),sample:false};
};
