importScripts('https://unpkg.com/h3-js@4.1.0/dist/h3-js.umd.js','analysis-core.js');
let prepared;
onmessage=({data})=>{try{if(data.type==='init'){prepared=EventAnalysis.prepare(data.records,h3);postMessage({type:'ready',first:prepared.first,last:prepared.last,rootH:prepared.rootH,rootT:prepared.rootT,minH:prepared.minH,minT:prepared.minT})}else if(data.type==='compute')postMessage({type:'result',id:data.id,result:EventAnalysis.aggregate(prepared,data.options)})}catch(error){postMessage({type:'error',id:data.id,message:error.message})}};
