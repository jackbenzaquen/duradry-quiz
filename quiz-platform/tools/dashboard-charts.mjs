const $=id=>document.getElementById(id);
const fmt=n=>n==null?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:1});
const pct=n=>n==null?'—':fmt(n)+'%';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const money=(n,c)=>new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(n);

export function renderFunnel(f){
  const container=$('conversion-funnel');if(!container)return;
  container.replaceChildren();
  $('conversion-rate').textContent=pct(f?.start_to_order_rate);
  $('conversion-detail').textContent=f?`${fmt(f.converted_sessions)} converted sessions / ${fmt(f.starts)} starts · ${f.attribution_days}-day attribution`:'No native tracking available.';
  if(!f?.starts){container.append(el('p','No native quiz starts were observed in these dates. Historical answers and submissions without analytics consent cannot establish step drop-off.','empty'));return;}
  for(const s of f.steps){
    const row=el('div',null,'funnel-row'),label=el('div',s.label,'funnel-label');
    if(s.optional)label.append(el('small','Optional · skips continue'));
    if(s.conditional)label.append(el('small','Conditional step'));
    const track=el('div',null,'funnel-track');track.setAttribute('role','img');
    track.setAttribute('aria-label',`${s.label}: ${fmt(s.reached)} reached, ${pct(s.share_of_starts)} of starts, ${pct(s.drop_off_rate)} drop-off`);
    const reached=s.reached??0,loss=s.drop_off??0;
    const keep=el('span',null,'funnel-continued'),drop=el('span',null,'funnel-dropped');
    keep.style.width=Math.max(0,reached-loss)/f.starts*100+'%';drop.style.width=loss/f.starts*100+'%';
    track.append(keep,drop);
    const metrics=el('div',null,'funnel-metrics');
    metrics.append(el('strong',`${fmt(s.reached)} · ${pct(s.share_of_starts)} of starts`),el('small',s.kind==='order'?'Converted sessions':s.drop_off_rate==null?'Drop-off unavailable':`${pct(s.drop_off_rate)} drop-off · ${fmt(s.drop_off)} sessions`));
    row.append(label,track,metrics);container.append(row);
  }
  $('funnel-note').textContent=`Native sessions only. Bars show share of starts; coral shows sessions that have not continued from that step. Drop-off % uses that step’s viewers. Submission drop-off means no order yet. ${fmt(f.open_conversion_windows)} sessions still have an open 30-day purchase window. ${fmt(f.completion_only_excluded)} submissions without an observed start excluded.`;
}

function lineChart(container,data,currency){
  const NS='http://www.w3.org/2000/svg';const svg=document.createElementNS(NS,'svg');
  const W=960,H=310,left=88,right=24,top=22,bottom=68,plotW=W-left-right,plotH=H-top-bottom;
  const max=Math.max(1,...data.map(d=>d.value??0));
  const make=(tag,attrs,text)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!=null)n.textContent=text;svg.append(n);return n;};
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`Quiz-attributed revenue in ${currency} by date; gaps have no import coverage.`);
  for(let i=0;i<=4;i++){const y=top+plotH*i/4;make('line',{x1:left,x2:W-right,y1:y,y2:y,stroke:'#e3e5db'});make('text',{x:left-12,y:y+4,'text-anchor':'end',fill:'#75776d','font-size':12},money(max*(4-i)/4,currency));}
  const x=i=>left+i*plotW/Math.max(1,data.length-1),y=v=>top+plotH-v/max*plotH;
  let d='',gap=true;
  data.forEach((point,i)=>{if(point.value==null){gap=true;return;}d+=(gap?'M':'L')+x(i)+','+y(point.value)+' ';gap=false;});
  make('path',{d,fill:'none',stroke:'#b82642','stroke-width':3,'stroke-linejoin':'round'});
  data.forEach((point,i)=>{if(point.value==null)return;const c=make('circle',{cx:x(i),cy:y(point.value),r:data.length>100?2:4,fill:'#b82642',tabindex:'0'});const title=document.createElementNS(NS,'title');title.textContent=`${point.date}: ${money(point.value,currency)}`;c.append(title);});
  for(const i of [...new Set([0,Math.floor((data.length-1)/4),Math.floor((data.length-1)/2),Math.floor((data.length-1)*3/4),data.length-1])])if(i>=0)make('text',{x:x(i),y:H-35,'text-anchor':i===0?'start':i===data.length-1?'end':'middle',fill:'#75776d','font-size':12},data[i].date);
  make('text',{x:left+plotW/2,y:H-8,'text-anchor':'middle',fill:'#75776d','font-size':12},'Order date');
  container.replaceChildren(svg);
}

let revenue;
function drawRevenue(){
  if(!revenue)return;
  const c=$('revenue-currency').value||'USD',group=$('revenue-interval').value;
  const rows=revenue.daily||[],data=[];const buckets=new Map();
  for(const r of rows){const date=group==='month'?r.date.slice(0,7):r.date;const covered=(!revenue.coverage_from||r.date>=(revenue.coverage_start_date||revenue.coverage_from.slice(0,10)))&&!!revenue.synced_through&&r.date<=(revenue.coverage_end_date||revenue.synced_through.slice(0,10));
    const value=covered?(r.revenue[c]||0):null;
    if(!buckets.has(date)){const item={date,value};buckets.set(date,item);data.push(item);}else if(value!=null){const item=buckets.get(date);item.value=(item.value||0)+value;}
  }
  $('revenue-total').textContent=money(revenue.totals?.[c]||0,c);
  if(!revenue.available&&!revenue.orders){$('revenue-chart').replaceChildren(el('p','Order attribution is not verified yet. Check System health below; unavailable data is not shown as zero revenue.','empty'));return;}
  lineChart($('revenue-chart'),data,c);
}
export function renderRevenue(r){
  revenue=r;if(!r)return;
  const selected=$('revenue-currency').value;$('revenue-currency').replaceChildren();
  for(const c of r.currencies?.length?r.currencies:['USD']){const o=el('option',c);o.value=c;$('revenue-currency').append(o);}
  if(r.currencies?.includes(selected))$('revenue-currency').value=selected;
  $('revenue-note').textContent=r.basis+' '+(r.scope||'')+(r.coverage_from?' Import coverage begins '+r.coverage_from.slice(0,10)+'.':'')+(r.synced_through?' Last complete import: '+r.synced_through+'.':'')+(!r.available?' Latest import is incomplete or unavailable; shown values may be partial.':'');
  drawRevenue();
}

export function renderHealth(h){
  const container=$('health-checks');if(!container)return;container.replaceChildren();
  $('health-status').textContent=h?h.status==='ok'?'All checks passing':h.status==='error'?'Action needed':'Review checks':'Not checked';
  $('health-status').className='health-badge '+(h?.status||'unknown');
  $('health-updated').textContent=h?'Checked '+new Date(h.checked_at).toLocaleString('en-US',{timeZone:$('timezone').value})+' · automatic checks every 5 minutes':'';
  for(const c of h?.checks||[]){const row=el('div',null,'health-row');const title=el('div',null,'health-title');title.append(el('strong',c.label),el('span',c.status,'health-badge '+c.status));row.append(title,el('p',c.detail));container.append(row);}
}

export function bindMonitoring(){
  $('revenue-currency')?.addEventListener('change',drawRevenue);$('revenue-interval')?.addEventListener('change',drawRevenue);
  $('health-refresh')?.addEventListener('click',async()=>{const button=$('health-refresh');button.disabled=true;button.textContent='Checking…';try{const response=await fetch('/api/health',{method:'POST',credentials:'same-origin'});const data=await response.json();if(!response.ok)throw Error(data.error||'Check failed');renderHealth(data);}catch(e){$('health-updated').textContent=e.message;}finally{button.disabled=false;button.textContent='Run checks now';}});
}
