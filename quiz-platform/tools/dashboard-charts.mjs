const $=id=>document.getElementById(id);
const fmt=n=>n==null?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:1});
const pct=n=>n==null?'—':fmt(n)+'%';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const money=(n,c)=>new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(n);

export function renderFunnelReport(report){
  const views=report.conversion_funnels||[],select=$('funnel-source');
  const previous=select.value;select.replaceChildren();
  for(const view of views){const option=el('option',view.label);option.value=view.key;select.append(option);}
  const initial=views.find(v=>v.funnel.kind===report.conversion_funnel?.kind)?.key;
  select.value=views.some(v=>v.key===previous)?previous:initial||views[0]?.key||'';
  $('funnel-source-label').hidden=views.length<2;
  select.onchange=()=>renderFunnel(views.find(v=>v.key===select.value)?.funnel||report.conversion_funnel);
  select.onchange();
  const snapshot=report.reference_snapshot||window.DQ_REFERENCE,box=$('octane-outcomes');
  box.replaceChildren();box.hidden=!snapshot||report.source==='native';
  if(box.hidden)return;
  const captured=new Date(snapshot.captured_at).toLocaleDateString('en-US',{timeZone:'UTC',year:'numeric',month:'long',day:'numeric'});
  box.append(el('h3','Historical Octane outcomes'),el('p',snapshot.period_label+' · fixed report captured '+captured+'; separate from the selected date range.','muted'));
  const metrics=el('div',null,'octane-outcome-metrics');
  for(const [label,value]of [['Unique starts',snapshot.metrics.unique_starts],['Quiz submitted',snapshot.metrics.unique_completions],['Order placed',snapshot.metrics.orders]]){const item=el('div');item.append(el('strong',fmt(value)),el('span',label+(label==='Order placed'?' · orders':'')));metrics.append(item);}
  box.append(metrics,el('p','These are Octane-reported totals. The snapshot cannot be assigned to individual CSV sessions or other dates; its order count is not a verified count of unique purchasers.','small muted'));
}

export function renderFunnel(f){
  const container=$('conversion-funnel');if(!container)return;
  container.replaceChildren();
  $('funnel-note').textContent='';
  const historical=f?.kind==='octane_csv';
  $('funnel-basis').textContent=f?.basis||'';
  const legend=$('funnel-legend');legend.replaceChildren();
  for(const [label,cls]of historical?[['Recorded responses / submissions','legend-keep']]:[['Continued / converted','legend-keep'],['Not continued yet','legend-loss']]){const item=el('span');item.append(el('i',null,cls),document.createTextNode(label));legend.append(item);}
  legend.append(el('span','Bar height = % of quiz starters'));
  $('conversion-rate').textContent=pct(f?.start_to_order_rate);
  $('conversion-detail').textContent=f?historical?`${fmt(f.submitted)} submissions / ${fmt(f.starts)} recorded starts · purchase attribution unavailable`:`${fmt(f.converted_sessions)} converted sessions / ${fmt(f.starts)} starts · ${f.attribution_days||30}-day attribution`:'No tracking available.';
  if(!f?.starts){container.append(el('p',`${fmt(f?.reported_submissions??f?.completion_only_excluded??0)} submissions have no observed start in this view. They remain in Completed quizzes above; a percentage of starters cannot be calculated.`,'empty'));return;}
  const wrap=label=>{const lines=[''];for(const word of label.split(/\s+/)){const last=lines.length-1;if(lines[last]&&lines[last].length+word.length+1>16)lines.push(word);else lines[last]+=(lines[last]?' ':'')+word;}return lines;};
  const labels=f.steps.map(s=>wrap(s.label)),labelLines=Math.max(1,...labels.map(lines=>lines.length));
  const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');
  const left=76,right=18,top=40,plotH=260,W=Math.max(680,left+right+f.steps.length*100),base=top+plotH,H=base+labelLines*16+104;
  const make=(tag,attrs,text,parent=svg)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!=null)n.textContent=text;parent.append(n);return n;};
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','group');svg.setAttribute('aria-label','Quiz steps on the X axis; percentage of quiz starters on the Y axis, from 0 to 100 percent.');svg.style.minWidth=W+'px';
  for(let value=0;value<=100;value+=20){const y=base-value/100*plotH;make('line',{x1:left,x2:W-right,y1:y,y2:y,class:'funnel-gridline'});make('text',{x:left-12,y:y+4,'text-anchor':'end',class:'funnel-tick'},value+'%');}
  make('text',{x:18,y:top+plotH/2,transform:`rotate(-90 18 ${top+plotH/2})`,'text-anchor':'middle',class:'funnel-axis'},'% of quiz starters');
  const slot=(W-left-right)/f.steps.length,barW=Math.min(56,slot*.6);
  f.steps.forEach((s,i)=>{
    const known=s.reached!=null&&s.share_of_starts!=null;
    const x=left+slot*(i+.5),reached=Math.max(0,Math.min(f.starts,s.reached??0)),loss=Math.max(0,Math.min(reached,s.drop_off??0));
    const totalH=reached/f.starts*plotH,lossH=loss/f.starts*plotH,keepH=totalH-lossH;
    const detail=known?`${s.label}: ${fmt(s.reached)} ${historical&&s.kind==='question'?'recorded responses':'sessions'}, ${pct(s.share_of_starts)} of quiz starters. `+(s.kind==='order'?'Converted sessions.':s.drop_off_rate==null?'Drop-off unavailable.':`${pct(s.drop_off_rate)} drop-off (${fmt(s.drop_off)} sessions).`)+(s.optional?historical?' Optional; a blank answer may be a skip.':' Optional; skips continue.':'')+(s.conditional?' Conditional step.':''):`${s.label}: unavailable. ${s.unavailable_reason||'Order attribution is not verified.'}`;
    const group=make('g',{class:'funnel-step',tabindex:0,role:'img','aria-label':detail});make('title',{},detail,group);
    // The total height is reach; its coral segment is loss at that step.
    if(known){
      make('rect',{x:x-barW/2,y:top,width:barW,height:plotH,class:'funnel-background'},null,group);
      make('rect',{x:x-barW/2,y:base-keepH,width:barW,height:keepH,class:'funnel-continued'},null,group);
      make('rect',{x:x-barW/2,y:base-totalH,width:barW,height:lossH,class:'funnel-dropped'},null,group);
      make('text',{x,y:base-totalH-17,'text-anchor':'middle',class:'funnel-value'},pct(s.share_of_starts),group);
      make('text',{x,y:base-totalH-5,'text-anchor':'middle',class:'funnel-count'},fmt(s.reached),group);
    }else{
      make('rect',{x:x-barW/2,y:top,width:barW,height:plotH,class:'funnel-unavailable'},null,group);
      make('text',{x,y:top+plotH/2,'text-anchor':'middle',class:'funnel-drop-label'},'Unavailable',group);
    }
    const label=make('text',{x,y:base+24,'text-anchor':'middle',class:'funnel-label'},null,group);
    labels[i].forEach((line,j)=>make('tspan',{x,dy:j?16:0},line,label));
    const annotation=s.optional?historical?'Optional · may be skipped':'Optional · skips count':s.conditional?'Conditional step':'';
    if(annotation)make('text',{x,y:base+labelLines*16+28,'text-anchor':'middle',class:'funnel-annotation'},annotation,group);
    make('text',{x,y:base+labelLines*16+46,'text-anchor':'middle',class:'funnel-drop-label'},!known?historical?'Not in CSV':'Not verified':historical?s.kind==='submission'?'Result / completion':s.kind==='start'?'Welcome recorded':'Answer recorded':s.kind==='order'?'Converted':s.drop_off_rate==null?'Drop-off unavailable':pct(s.drop_off_rate)+' drop-off',group);
  });
  make('text',{x:left+(W-left-right)/2,y:H-10,'text-anchor':'middle',class:'funnel-axis'},'Quiz step');
  container.append(svg);
  $('funnel-note').textContent=historical?`Quiz submitted includes a recorded result page or an exactly matched Octane completion. Blank optional answers do not prove abandonment, so historical per-step drop-off is not calculated. ${f.orders_unavailable_reason} ${fmt(f.completion_only_excluded)} submissions without an observed start are excluded from percentages.`:`Native sessions only. Each bar shows the percentage of quiz starters who reached that step; coral shows those who have not continued. Drop-off % uses that step’s viewers. Submission drop-off means no order yet. ${fmt(f.open_conversion_windows)} sessions still have an open 30-day purchase window. ${fmt(f.completion_only_excluded)} submissions without an observed start excluded.`;
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
