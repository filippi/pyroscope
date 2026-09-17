'use strict';
const $=id=>document.getElementById(id),number=n=>n.toLocaleString(),compact=n=>Intl.NumberFormat('en',{notation:'compact',maximumSignificantDigits:3}).format(n);
const palette=['#ffbf48','#65baff','#63d8b0','#eb86ac','#bc9aff','#ef9b62','#7cd7e8','#c4d97d'];
const chartIds=['annualClusters','annualHotspots','sizes','exceedance','season','duration','latitude','countries'];
const charts=Object.fromEntries(chartIds.map(id=>[id,echarts.init($(id),null,{renderer:'canvas'})]));
let worker,names=[],allYears=[],requestId=0,lastResult=null,lastFilters=null,debounce;
function base(){return {animationDuration:250,color:palette,backgroundColor:'transparent',textStyle:{fontFamily:'system-ui',color:'#9eafbd'},aria:{enabled:true},tooltip:{trigger:'axis',confine:true,backgroundColor:'#0c1620',borderColor:'#354959',textStyle:{color:'#eaf0f5'}},toolbox:{right:18,top:2,iconStyle:{borderColor:'#8197aa'},feature:{saveAsImage:{title:'Save chart as PNG',pixelRatio:2,backgroundColor:'#101923'}}},grid:{left:68,right:30,top:40,bottom:64,containLabel:true},xAxis:{type:'category',axisLine:{lineStyle:{color:'#425462'}},axisLabel:{color:'#9eafbd'},axisTick:{show:false}},yAxis:{type:'value',minInterval:1,axisLabel:{formatter:compact},splitLine:{lineStyle:{color:'#253542'}},nameTextStyle:{color:'#9eafbd'}}};}
function bar(id,labels,values,options={}){const o=base();o.xAxis.data=labels;o.yAxis.name=options.name||'Clusters';o.series=[{name:options.name||'Clusters',type:'bar',data:values,itemStyle:{color:options.color||'#65baff',borderRadius:[3,3,0,0]},barMaxWidth:35}];if(options.zoom)o.dataZoom=[{type:'inside'},{type:'slider',height:14,bottom:6,borderColor:'#2b3b49'}];if(options.rotate)o.xAxis.axisLabel.rotate=35;charts[id].setOption(o,true);}
function selectedYears(){return [...$('years').querySelectorAll('input:checked')].map(e=>Number(e.value));}
function filters(){return {years:selectedYears(),country:$('country').value,hemisphere:$('hemisphere').value,minLat:Number($('minLat').value),maxLat:Number($('maxLat').value),minCount:Number($('minCount').value),basis:$('basis').value};}
function query(){clearTimeout(debounce);const f=filters();requestId++;$('export').disabled=true;if(!['minLat','maxLat','minCount'].every(id=>$(id).value!==''&&$(id).checkValidity())||f.minLat>f.maxLat){$('selection').textContent='Enter valid limits: latitude −90 to 90, lower ≤ upper, and at least one observation.';return;}$('selection').textContent='Calculating selection…';worker.postMessage({type:'query',id:requestId,filters:f});lastFilters=f;}
function chooseYears(years){const chosen=new Set(years);for(const input of $('years').querySelectorAll('input'))input.checked=chosen.has(Number(input.value));query();}
function render(r){
 lastResult=r;$('clusterTotal').textContent=number(r.clusters);$('hotspotTotal').textContent=number(r.hotspots);$('topShare').textContent=r.clusters?(r.topShare*100).toFixed(1)+'%':'—';$('topDetail').textContent=r.clusters?number(r.topN)+' largest clusters’ share of observations':'No clusters in this selection';
 $('selection').textContent=r.clusters?number(r.clusters)+' clusters · '+lastFilters.years.length+' selected years · '+($('country').selectedOptions[0]?.textContent||'All locations'):'No clusters match this selection. Choose years or broaden the filters.';$('export').disabled=false;
 const selected=new Set(lastFilters.years),annual=r.annual.map(a=>String(a[0]));
 for(const [id,index,label] of [['annualClusters',1,'Clusters'],['annualHotspots',2,'Observations']])bar(id,annual,r.annual.map(a=>({value:a[index],itemStyle:{color:selected.has(a[0])?(index===1?'#ffbf48':'#65baff'):'#344653'}})),{name:label,zoom:true});
 for(const [id,key,ylabel] of [['sizes','bins','Probability density'],['exceedance','ccdf','Fraction ≥ size']]){
  const o=base();o.grid.top=66;o.grid.bottom=65;o.legend={type:'scroll',top:5,right:60,left:20,textStyle:{color:'#c9d5de'}};o.tooltip.trigger='item';
  o.tooltip.formatter=p=>{const d=p.data;return key==='bins'?p.seriesName+'<br>Size ['+number(d[3])+', '+number(d[4])+')<br>'+number(d[2])+' clusters<br>Density: '+d[1].toPrecision(3):p.seriesName+'<br>At least '+number(d[0])+' observations<br>'+(d[1]*100).toPrecision(3)+'% of clusters';};
  o.xAxis={...o.xAxis,type:'log',logBase:10,min:1,name:'Hotspot observations per cluster',nameLocation:'middle',nameGap:35,axisLabel:{formatter:compact},splitLine:{show:false}};
  o.yAxis={...o.yAxis,type:'log',logBase:10,name:ylabel,axisLabel:{formatter:v=>key==='ccdf'?compact(v*100)+'%':Number(v.toPrecision(2)).toString()}};delete o.yAxis.minInterval;
  const cohorts=[{year:'All selected',n:r.clusters,...r.distribution},...r.years];
  o.series=cohorts.map((c,i)=>({name:c.year+' · n='+number(c.n),type:'line',data:c[key],showSymbol:c[key].length<12,symbolSize:5,lineStyle:{width:i===0?3:1.6,opacity:i===0?1:.8},itemStyle:i===0?{color:'#f4f6f8'}:undefined,emphasis:{focus:'series'},connectNulls:false}));
  if(!r.clusters){o.xAxis={type:'value',show:false,min:0,max:1};o.yAxis={type:'value',show:false,min:0,max:1};o.series=[];o.legend.show=false;o.graphic={type:'text',left:'center',top:'middle',style:{text:'No clusters in this selection',fill:'#9eafbd'}};}
  charts[id].setOption(o,true);
 }
 bar('season',['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],r.months,{color:'#63d8b0'});
 bar('duration',['< 1 hour','1h–1d','1–3d','3–7d','7–30d','30–90d','90–365d','≥ 365d'],r.durations,{color:'#bc9aff',rotate:true});
 bar('latitude',r.latitude.map((_,i)=>`${i*10-90}° to ${i*10-80}°`),r.latitude,{color:'#7cd7e8',rotate:true});
 const top=r.countries.slice(0,15).reverse(),o=base();o.grid={left:15,right:48,top:30,bottom:30,containLabel:true};o.xAxis={...o.yAxis,name:'Clusters',nameLocation:'middle',nameGap:22};o.yAxis={type:'category',data:top.map(([id])=>names[id]),axisLabel:{color:'#9eafbd',width:140,overflow:'truncate'},axisTick:{show:false},axisLine:{show:false}};o.series=[{name:'Clusters',type:'bar',data:top.map(([id,n])=>({value:n,country:id})),itemStyle:{color:'#eb86ac'},barMaxWidth:17}];charts.countries.setOption(o,true);
}
for(const id of ['annualClusters','annualHotspots'])charts[id].on('click',p=>{if(p.componentType!=='series')return;const year=Number(p.name),selected=new Set(selectedYears());if(p.event?.event?.shiftKey){if(selected.has(year))selected.delete(year);else selected.add(year);chooseYears([...selected]);}else chooseYears([year]);});
charts.countries.on('click',p=>{if(p.data?.country!==undefined){$('country').value=String(p.data.country);query();}});
function start(){
 worker?.terminate();worker=new Worker('stats-worker.js');$('retry').hidden=true;$('filters').disabled=true;$('progress').hidden=false;$('progress').value=0;
 worker.onmessage=({data:m})=>{
  if(m.type==='progress'){$('status').textContent=m.message;$('progress').value=m.value;}
  if(m.type==='ready'){
   names=m.names;allYears=m.years;$('years').replaceChildren();for(const year of allYears){const label=document.createElement('label');label.className='year';const input=document.createElement('input');input.type='checkbox';input.value=year;input.checked=true;const span=document.createElement('span');span.textContent=year;label.append(input,span);$('years').append(label);}
   $('country').replaceChildren(new Option('All locations',''));for(const c of m.countries)$('country').add(new Option(c.name+' ('+number(c.n)+')',c.id));
   $('filters').disabled=false;$('progress').value=1;$('status').textContent='Archive ready · '+number(m.records)+' clusters';$('archiveInfo').textContent=(m.bytes/1048576).toFixed(1)+' MB downloaded · '+new Date().toLocaleString()+' · '+m.skipped+' invalid or empty records excluded · reload to fetch the latest index';query();
  }
  if(m.type==='result'&&m.id===requestId)render(m.result);
  if(m.type==='error'&&(m.id===undefined||m.id===requestId))fail(m.message);
 };
 worker.onerror=e=>fail(e.message||'Archive worker failed');worker.postMessage({type:'load'});
}
function fail(message){$('status').textContent='Unable to complete archive analysis: '+message;$('retry').hidden=false;$('progress').hidden=true;$('export').disabled=true;}
$('retry').onclick=start;$('allYears').onclick=()=>chooseYears(allYears);$('noYears').onclick=()=>chooseYears([]);
$('reset').onclick=()=>{for(const [id,value] of Object.entries({country:'',hemisphere:'',minLat:-90,maxLat:90,minCount:1,basis:'start'}))$(id).value=value;chooseYears(allYears);};
$('filters').addEventListener('change',e=>{if(e.target.matches('input,select'))query();});
$('export').onclick=()=>{if(!lastResult)return;const f=lastFilters;const rows=[['# Archive cohort totals; observations assigned to '+f.basis+' year'],['# Country',f.country===''?'All':names[Number(f.country)]],['# Hemisphere',f.hemisphere||'Both'],['# Latitude range',f.minLat,f.maxLat],['# Minimum observations',f.minCount],['year','selected','clusters','hotspot_observations'],...lastResult.annual.map(a=>[a[0],f.years.includes(a[0]),a[1],a[2]])];const csv=rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='tabula-caloris-archive-statistics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const resize=new ResizeObserver(()=>Object.values(charts).forEach(c=>c.resize()));chartIds.forEach(id=>resize.observe($(id)));
start();
