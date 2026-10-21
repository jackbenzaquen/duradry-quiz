import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {aggregate,historyAvailability,compareReports} from '../lib/report.mjs';
import {range} from '../lib/dates.mjs';

const when='2026-10-20T12:00:00Z';
const windowRange=range({from:'2024-08-15',to:'2026-10-20'});
function screenshotRows(){
  const rows=Array.from({length:13337},(_,i)=>({id:'complete:'+i,source:i<4461?'octane':'klaviyo_octane',occurred_at:i===4461?'2024-08-15T12:00:00Z':when,start_observed:i<4461,completion_observed:true,subject_key:i<13310?'profile:'+(i%12220):null,answers:{}}));
  rows.push(...Array.from({length:5589},(_,i)=>({id:'other:'+i,source:'octane',occurred_at:when,start_observed:i<2484,answers:{}})));
  return rows;
}
test('all screenshot totals reconcile without inventing starts, people, or abandoned sessions',()=>{
  const r=aggregate(screenshotRows(),windowRange);
  assert.equal(r.summary.completions,13337);assert.equal(r.summary.starts,6945);assert.equal(r.summary.observed_completions,4461);
  assert.equal(r.summary.identified_people,12220);assert.equal(r.summary.repeat_identified_completions,1090);assert.equal(r.summary.sessions,18926);
  assert.deepEqual(r.reconciliation,{completed_with_start:4461,started_without_completion:2484,completed_without_start:8876,neither_start_nor_completion:3105,without_completion:5589,identified_completions:13310,unidentified_completions:27,identified_completers:12220});
  for(const key of ['records','starts','completions'])assert.equal(r.source_coverage.reduce((n,s)=>n+s[key],0),r.summary[key==='records'?'sessions':key]);
  const c=r.reconciliation;assert.equal(c.completed_with_start+c.started_without_completion+c.completed_without_start+c.neither_start_nor_completion,r.summary.sessions);
  assert.equal(c.identified_completers+r.summary.repeat_identified_completions+c.unidentified_completions,r.summary.completions);
});
test('comparison suppresses unavailable, partial, and source-mismatched baselines',()=>{
  const row={id:'c',source:'native',occurred_at:when,start_observed:true,completion_observed:true};
  const current=()=>aggregate([row],range({from:'2026-10-20',to:'2026-10-20'}));
  const before=[{...row,id:'p',occurred_at:'2026-10-19T12:00:00Z'}];
  const previous=()=>aggregate(before,range({from:'2026-10-19',to:'2026-10-19'}));
  const available={first_record_date:'2026-10-01',sources:[{source:'native',first_record_date:'2026-10-01'}]};
  let r=compareReports(current(),aggregate([],previous().window),available);assert.equal(r.comparison.reason,'no_prior_records');assert.equal(r.changes.completions_pct,null);
  r=compareReports(current(),previous(),{...available,first_record_date:'2026-10-20'});assert.equal(r.comparison.reason,'partial_prior_history');assert.equal(r.changes.completions_pct,null);
  const legacy=aggregate([{...before[0],source:'klaviyo_octane'}],previous().window);r=compareReports(current(),legacy,available);assert.equal(r.comparison.reason,'different_sources');
  r=compareReports(current(),previous(),available);assert.equal(r.comparison.status,'available');assert.equal(r.changes.completions_pct,0);
});
test('available history respects local dates, source, tests, and exact duplicate exclusions',()=>{
  const rows=[{id:'real',source:'native',occurred_at:'2026-10-20T01:00:00Z'},{id:'test',source:'native',occurred_at:'2020-01-01T12:00:00Z',is_test:true},{id:'linked',source:'klaviyo_octane',occurred_at:'2021-01-01T12:00:00Z',duplicate_of:'real'}];
  assert.equal(historyAvailability(rows).first_record_date,'2026-10-19');
  assert.equal(historyAvailability(rows,{source:'klaviyo_octane'}).first_record_date,'2021-01-01');
  assert.equal(historyAvailability(rows,{source:'octane'}).first_record_date,null);
});
const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
const bundle=await fs.readFile(new URL('../public/dashboard.js',import.meta.url),'utf8');
function browser(){return new JSDOM(html,{url:'https://quiz.test/',runScripts:'outside-only'});}
const change=(w,id,value)=>{const e=w.document.getElementById(id);e.value=value;e.dispatchEvent(new w.Event('change',{bubbles:true}));};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('dashboard separates populations, explains missing identities, and auto-applies filters',()=>{
  const dom=browser(),w=dom.window;
  try{
    w.DQ_DATA=screenshotRows();w.DQ_META={first:'2024-08-15T12:00:00Z',latest:when,exact_linked_events:0};w.eval(bundle);
    const doc=w.document,text=()=>doc.getElementById('kpis').textContent;
    assert.equal(doc.getElementById('status').textContent,'');assert.equal(doc.getElementById('report').hidden,false);
    assert.match(text(),/12,220 identified completers \+ 1,090 repeat completions \+ 27 completions without a profile ID = 13,337/);
    assert.match(text(),/8,876 additional completions excluded/);assert.match(text(),/18,926 recorded rows = 13,337 completed \+ 5,589/);
    assert.equal(doc.getElementById('compare').disabled,true);assert.equal(doc.getElementById('compare').value,'false');assert.doesNotMatch(doc.getElementById('comparison').textContent,/Compared with 2022/);
    change(w,'source','octane');assert.equal(doc.getElementById('from').value,'2026-10-20');assert.doesNotMatch(text(),/additional completions excluded/);assert.match(text(),/4,461 total completions/);
    change(w,'source','native');assert.match(text(),/No recorded quiz activity/);assert.doesNotMatch(text(),/0%/);
    change(w,'source','all');change(w,'from','2026-10-01');assert.equal(doc.getElementById('preset').value,'custom');assert.equal(doc.getElementById('compare').disabled,false);
    change(w,'compare','true');assert.match(doc.getElementById('comparison').textContent,/No recorded data in the previous period/);
  }finally{w.close();}
});
test('late API responses cannot overwrite the latest source filter',async()=>{
  const dom=browser(),w=dom.window,pending=[];
  try{
    w.fetch=()=>new Promise(resolve=>pending.push(resolve));w.eval(bundle);assert.equal(pending.length,1);
    change(w,'source','octane');assert.equal(pending.length,2);
    const fresh=aggregate(screenshotRows(),windowRange,{source:'octane'});fresh.comparison={status:'off'};
    pending[1]({status:200,ok:true,json:async()=>fresh});await tick();
    assert.equal(w.document.getElementById('status').textContent,'');assert.match(w.document.getElementById('kpis').textContent,/4,461 total completions/);
    pending[0]({status:200,ok:true,json:async()=>aggregate(screenshotRows(),windowRange)});await tick();
    assert.doesNotMatch(w.document.getElementById('kpis').textContent,/13,337 total completions/);
  }finally{w.close();}
});
