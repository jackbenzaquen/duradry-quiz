const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const test=require('node:test');
const config=require('../config/duradry-routine.json');
const runtime=fs.readFileSync(path.join(__dirname,'../shopify-runtime.js'),'utf8');
function setup(data=config) {
  const dom=new JSDOM(`<duradry-native-quiz id="test" data-mode="preview"><div data-dq-panel></div><p data-dq-message></p><div data-dq-capture hidden><form><div data-dq-status></div><input type="email" data-dq-email><input type="checkbox" data-dq-consent><span data-dq-consent-label></span><p data-dq-privacy></p><button data-dq-native></button><button data-dq-proxy></button><button data-dq-without></button></form></div><script type="application/json" data-dq-config>${JSON.stringify(data).replaceAll('<','\\u003c')}</script></duradry-native-quiz>`,{url:'https://duradry.com/pages/native-quiz-test',runScripts:'outside-only'});
  dom.window.fetch=()=>{throw new Error('Preview attempted network request');};
  dom.window.eval(runtime);
  const element=dom.window.document.querySelector('duradry-native-quiz');
  const click=label=>{const button=[...element.querySelectorAll('button')].find(b=>b.textContent===label);assert(button,label);button.click();};
  const select=value=>{const input=element.querySelector(`input[value="${value}"]`);assert(input,value);input.click();};
  const fill=value=>{const input=element.querySelector('[data-dq-panel] input');input.value=value;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  return {dom,element,click,select,fill};
}
test('visible controls complete the preview without submitting personal information',()=>{
  const {dom,element,click,select,fill}=setup();
  click('I AM READY');select('red');click('Skip');
  assert(element.nextButton.disabled);select('underarms');select('body');click('CONTINUE');
  select('41-50');select('feet');click('CONTINUE');select('male');
  fill('not an email');assert(element.nextButton.disabled);
  fill('tester@example.invalid');click('CONTINUE');fill('Test');click('CONTINUE');
  assert.equal(element.result.key,'signature-red');
  assert(element.textContent.includes('Nothing is submitted'));
  assert.equal(dom.window.sessionStorage.length,0);
  click('Start again');assert.equal(element.index,-1);assert.equal(Object.keys(element.answers).length,0);
  dom.window.close();
});
test('back preserves answers until an earlier answer changes, then clears dependent answers',()=>{
  const {dom,element,click,select}=setup();
  click('I AM READY');select('cream');click('Skip');select('underarms');click('CONTINUE');select('30-34');
  select('underarms');click('← BACK');click('← BACK');
  assert.deepEqual(Array.from(element.answers.age),['30-34']);
  select('body');assert.equal(element.answers.age,undefined);assert.equal(element.answers.odor,undefined);
  assert.deepEqual(Array.from(element.answers.dry),['underarms','body']);
  dom.window.close();
});
test('merchant text is rendered as text, not executable markup',()=>{
  const injected=structuredClone(config);injected.title='<img src=x onerror="window.pwned=true">';
  const {dom,element}=setup(injected);
  assert.equal(element.querySelector('h1').textContent,injected.title);assert.equal(element.querySelector('h1 img'),null);
  assert.equal(dom.window.pwned,undefined);dom.window.close();
});

test('app proxy sends answer snapshots and a stable completion ID with consent separate',async()=>{
  const {webcrypto,createHash}=require('node:crypto');
  const {dom,element,click,select,fill}=setup();
  Object.defineProperty(dom.window,'crypto',{value:webcrypto});dom.window.TextEncoder=TextEncoder;
  dom.window.Shopify={customerPrivacy:{analyticsProcessingAllowed:()=>true}};
  element.mode='app_proxy';element.dataset.endpoint='/apps/duradry-quiz';
  const requests=[];dom.window.fetch=async(url,options)=>{requests.push({url,payload:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})};};
  let navigated=false;element.goToResult=()=>{navigated=true;};
  click('I AM READY');select('red');click('Skip');select('underarms');click('CONTINUE');select('41-50');select('feet');click('CONTINUE');select('male');fill('qa@example.invalid');click('CONTINUE');fill('QA');click('CONTINUE');
  await element.submitProxy();
  assert(navigated);const complete=requests.filter(r=>r.payload.kind==='completed');assert.equal(complete.length,1);assert.equal(complete[0].payload.email_marketing_consent,false);assert.equal(complete[0].payload.answers.email,'qa@example.invalid');
  for(const r of requests.filter(r=>r.payload.kind!=='completed')){assert(!JSON.stringify(r.payload.answers).includes('qa@example.invalid'));assert.equal(r.payload.answers['first-name'],undefined);}
  const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
  assert.equal(new URL(complete[0].url,'https://duradry.com').searchParams.get('body_hash'),createHash('sha256').update(stable(complete[0].payload)).digest('hex'));
  await element.submitProxy();assert.equal(requests.filter(r=>r.payload.kind==='completed')[1].payload.event_id,complete[0].payload.event_id);
  dom.window.close();
});
