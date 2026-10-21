const format=n=>n===null||n===undefined?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:1});
const pct=n=>n===null||n===undefined?'—':format(n)+'%';
export const sourceLabels={native:'Shopify native',octane:'Octane CSV',klaviyo_octane:'Klaviyo completion history'};
const span=(first,last)=>first?first===last?first:first+' — '+last:'No records';

export function comparisonText(r){
  if(r.comparison?.status==='unavailable')return r.comparison.message+' · '+r.window.timezone;
  if(r.comparison?.status==='off')return (r.comparison.message?r.comparison.message+' · ':'')+r.window.timezone;
  return r.previous?'Compared with '+r.previous.window.from+' — '+r.previous.window.to+' · '+r.window.timezone:r.window.timezone;
}

export function renderSummary(r,doc=document){
  const el=(tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const card=(label,value,sub)=>{const c=el('div',undefined,'kpi');c.append(el('div',label,'label'),el('div',format(value),'value'),el('div',sub,'sub'));return c;};
  const group=(title,description)=>{const section=el('section',undefined,'metric-group');section.append(el('h3',title),el('p',description,'metric-description'));const grid=el('div',undefined,'metric-grid');section.append(grid);return {section,grid};};
  const root=doc.getElementById('kpis'),s=r.summary,c=r.reconciliation;
  root.replaceChildren();
  if(!c){root.append(el('p','Refresh this report to load the completion breakdown.','empty'));return;}
  if(!s.sessions){root.append(el('p','No recorded quiz activity for these dates and source. Completion rate is unavailable.','empty'));return;}

  const all=group('All recorded completions','Sessions selected by their recorded date and source. One person can complete more than once.');
  const delta=r.changes?.completions_pct;
  all.grid.append(card('Completed quiz sessions',s.completions,delta===null||delta===undefined?'Includes completions with and without start records.':(delta>=0?'+':'')+format(delta)+'% recorded completions vs. previous period'),card('Identified completers',c.identified_completers,'Distinct available profile IDs among completed sessions.'),card('Repeat completions',s.repeat_identified_completions,'Additional completions by those same identified profiles.'));
  all.section.append(el('p',format(c.identified_completers)+' identified completers + '+format(s.repeat_identified_completions)+' repeat completions + '+format(c.unidentified_completions)+' completions without a profile ID = '+format(s.completions)+' total completions.','metric-equation'));
  root.append(all.section);

  const sources=r.source_coverage||[],started=sources.filter(x=>x.starts),first=started.map(x=>x.first_start_date).sort()[0],last=started.map(x=>x.last_start_date).sort().at(-1);
  const tracked=group('Sessions with recorded starts',started.length?'Start records appear '+span(first,last)+'. These dates do not establish continuous tracking coverage.':'Start tracking is unavailable for this selection. A completion rate cannot be calculated.');
  tracked.grid.append(card('Recorded starts',s.starts||0,'Native start events or Octane welcome responses.'),card('Completed from those starts',s.observed_completions,format(c.started_without_completion)+' recorded starts have no recorded completion.'));
  const rate=card('Completion rate among tracked starts',s.observed_completion_rate,s.starts?format(s.observed_completions)+' completions ÷ '+format(s.starts)+' recorded starts':'No recorded starts; rate unavailable.');
  rate.querySelector('.value').textContent=pct(s.observed_completion_rate);tracked.grid.append(rate);
  if(c.completed_without_start)tracked.section.append(el('p',format(c.completed_without_start)+' additional completion'+(c.completed_without_start===1?'':'s')+' excluded because start data is unavailable. '+format(s.observed_completions)+' tracked + '+format(c.completed_without_start)+' without a recorded start = '+format(s.completions)+' total completions.','metric-equation'));
  root.append(tracked.section);

  const details=el('details',undefined,'record-reconciliation');
  details.append(el('summary',format(s.sessions)+' recorded rows = '+format(s.completions)+' completed + '+format(c.without_completion)+' without a recorded completion'));
  details.append(el('p','Recorded rows are not unique visitors. Rows without completion evidence are not automatically abandoned quizzes. Linked duplicates are excluded in the combined view.','muted'));
  const list=el('dl',undefined,'record-counts');
  for(const [label,count]of [['Completed, with a recorded start',c.completed_with_start],['Started, without a recorded completion',c.started_without_completion],['Completed, without a recorded start',c.completed_without_start],['Neither a recorded start nor a recorded completion',c.neither_start_nor_completion]])list.append(el('dt',label),el('dd',format(count)));
  details.append(list,el('h4','Records included by source'));
  const wrap=el('div',undefined,'table-scroll'),table=el('table'),head=el('thead'),tr=el('tr');
  for(const label of ['Source','Record dates','Rows','Recorded starts','Completions','Without a start'])tr.append(el('th',label));head.append(tr);table.append(head);
  const body=el('tbody');
  for(const source of sources){const row=el('tr');for(const value of [sourceLabels[source.source]||source.source,span(source.first_record_date,source.last_record_date),format(source.records),format(source.starts),format(source.completions),format(source.completion_only)])row.append(el('td',value));body.append(row);}
  table.append(body);wrap.append(table);details.append(wrap,el('p','Date ranges show the earliest and latest included records, not proof that every visit was captured.','muted small'));root.append(details);
}
