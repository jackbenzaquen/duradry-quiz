(() => {
  const list = value => Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  const matches = (condition, answers) => {
    const actual = list(answers[condition.key]);
    const expected = list(condition.values);
    if (!actual.length || !expected.length) return false;
    if (condition.mode === 'any') return expected.some(value => actual.includes(value));
    if (condition.mode === 'all') return expected.every(value => actual.includes(value));
    if (condition.mode === 'none') return expected.every(value => !actual.includes(value));
    if (condition.mode === 'exact') return actual.length === expected.length && expected.every(value => actual.includes(value));
    return false;
  };
  const visible = (question, answers) => (question.when || []).every(condition => matches(condition, answers));
  const resolve = (config, answers) => config.rules.find(rule => rule.conditions.length && rule.conditions.every(condition => matches(condition, answers)))?.result || null;
  const safePath = path => typeof path === 'string' && /^\/(?!\/)[^\\\s]*$/.test(path) ? path : null;
  const validate = config => {
    if (!config || !config.id || !config.version || !config.title || !config.labels || !Array.isArray(config.questions) || !config.questions.length || config.questions.length > 50 || !Array.isArray(config.rules) || !config.rules.length || config.rules.length > 50) throw new Error('Invalid quiz configuration');
    const keys = new Set();
    const roles = new Set();
    for (const q of config.questions) {
      if (!/^[a-z0-9_-]+$/.test(q.key) || keys.has(q.key) || !q.title || !['single','multiple','text','email'].includes(q.kind)) throw new Error('Invalid question');
      for (const c of q.when || []) if (!keys.has(c.key) || !['any','all','none','exact'].includes(c.mode) || !list(c.values).length) throw new Error('Question visibility must reference an earlier answer');
      keys.add(q.key);
      if (q.role && q.role !== 'none') {
        if (!['email','first_name'].includes(q.role) || roles.has(q.role)) throw new Error('Invalid contact role');
        roles.add(q.role);
      }
      if (['single','multiple'].includes(q.kind)) {
        if (!q.options?.length || q.options.length > 50 || new Set(q.options.map(o => o.value)).size !== q.options.length || q.options.some(o => !o.value || !o.label)) throw new Error('Invalid options');
      }
    }
    for (const r of config.rules) {
      if (!r.conditions?.length || !r.result?.title || !safePath(r.result.url)) throw new Error('Invalid result rule');
      for (const c of r.conditions) {
        const q = config.questions.find(q => q.key === c.key);
        if (!q || !['any','all','none','exact'].includes(c.mode) || !list(c.values).length) throw new Error('Invalid rule condition');
        if (['single','multiple'].includes(q.kind) && c.values.some(value => !q.options.some(o => o.value === value))) throw new Error('Unknown option in rule');
      }
    }
    return config;
  };
  const core = { list, matches, visible, resolve, safePath, validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof customElements === 'undefined' || customElements.get('duradry-native-quiz')) return;
  class DuradryNativeQuiz extends HTMLElement {
    connectedCallback() {
      if (this.ready) return;
      this.ready = true;
      this.controller = new AbortController();
      this.answers = Object.create(null);
      this.index = -1;
      this.busy = false;
      this.result = null;
      this.mode = this.dataset.mode || 'preview';
      this.panel = this.querySelector('[data-dq-panel]');
      this.message = this.querySelector('[data-dq-message]');
      this.capture = this.querySelector('[data-dq-capture]');
      try {
        this.config = validate(JSON.parse(this.querySelector('[data-dq-config]').textContent));
        this.labels = this.config.labels;
        this.storageKey = 'dd-quiz-pending:' + this.config.id;
        this.bindCapture();
        this.render();
        this.restorePending();
      } catch (error) {
        this.message.textContent = this.config?.labels?.configuration_error || this.dataset.error;
        this.querySelectorAll('button').forEach(button => { button.disabled = true; });
      }
    }
    disconnectedCallback() { this.controller?.abort(); this.ready = false; }
    node(tag, text, attrs = {}) {
      const el = document.createElement(tag);
      if (text != null) el.textContent = text;
      for (const [key,value] of Object.entries(attrs)) if (value != null) el.setAttribute(key, String(value));
      return el;
    }
    button(label, action, className = '') {
      const button = this.node('button', label, {type:'button',class:'dq-button '+className});
      button.addEventListener('click', action);
      return button;
    }
    setMessage(text = '') { this.message.textContent = text; }
    focusHeading() { this.panel.querySelector('h1,h2,legend')?.focus({preventScroll:true}); }
    track(name, question = null) {
      if (this.mode === 'preview') return;
      const privacy = window.Shopify?.customerPrivacy;
      if (!privacy?.analyticsProcessingAllowed?.()) return;
      window.Shopify?.analytics?.publish?.(name, {quiz_id:this.config.id,version:this.config.version,question_id:question});
    }
    render() {
      this.setMessage();
      this.panel.replaceChildren();
      this.capture.hidden = true;
      if (this.index < 0) {
        this.panel.append(this.node('h1',this.config.title,{tabindex:'-1'}),this.node('p',this.config.subtitle));
        this.panel.append(this.button(this.labels.start_label,()=>{this.track('duradry_quiz_started');this.advance();}));
        return;
      }
      const q = this.config.questions[this.index];
      const visibleQuestions = this.config.questions.filter(question=>visible(question,this.answers));
      const pos = visibleQuestions.indexOf(q)+1;
      const progress = this.node('p', `${this.labels.progress_label} ${pos} / ${visibleQuestions.length}`,{class:'dq-progress'});
      const fieldset = this.node('fieldset');
      fieldset.append(this.node('legend',q.title,{tabindex:'-1'}));
      if (q.helper) fieldset.append(this.node('p',q.helper,{class:'dq-helper'}));
      this.panel.append(progress,fieldset);
      if (['single','multiple'].includes(q.kind)) {
        const group = this.node('div',null,{class:'dq-options'});
        for (const option of q.options) {
          const label = this.node('label',null,{class:'dq-option'});
          const input = this.node('input',null,{type:q.kind==='single'?'radio':'checkbox',name:this.id+'-'+q.key,value:option.value});
          input.checked = list(this.answers[q.key]).includes(option.value);
          input.addEventListener('change',()=>{
            this.update(q,Array.from(group.querySelectorAll('input:checked')).map(input=>input.value));
            if (q.kind === 'single' && q.auto) this.advance();
          });
          label.append(input);
          if (option.image) label.append(this.node('img',null,{src:option.image,alt:'',width:'240',height:'180',loading:'eager',decoding:'async'}));
          label.append(this.node('span',option.label));
          group.append(label);
        }
        fieldset.append(group);
      } else {
        const input = this.node('input',null,{type:q.kind==='email'?'email':'text',placeholder:q.placeholder || '',maxlength:q.kind==='email'?'254':'200','aria-label':q.title,autocomplete:q.role==='email'?'email':q.role==='first_name'?'given-name':'off',class:'dq-text'});
        input.value = this.answers[q.key] || '';
        input.required = q.required;
        input.addEventListener('input',()=>this.update(q,input.value.trim()));
        input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();this.advance();}});
        fieldset.append(input);
      }
      const controls = this.node('div',null,{class:'dq-controls'});
      controls.append(this.button(this.labels.back_label,()=>this.back(),'dq-secondary'));
      if (!q.required) controls.append(this.button(this.labels.skip_label,()=>{this.update(q,'');this.advance(true);},'dq-secondary'));
      this.nextButton = this.button(q.button || this.labels.next_label,()=>this.advance());
      controls.append(this.nextButton);
      this.panel.append(controls);
      this.refreshNext();
      this.focusHeading();
      this.track('duradry_quiz_question_viewed',q.key);
    }
    update(q,value) {
      const before = JSON.stringify(this.answers[q.key]);
      this.answers[q.key] = value;
      if (before !== JSON.stringify(value)) for (let i=this.index+1;i<this.config.questions.length;i++) delete this.answers[this.config.questions[i].key];
      this.result = null;
      this.setMessage();
      this.refreshNext();
    }
    valid(q) {
      const value = this.answers[q.key];
      if (q.required && !list(value).length) return false;
      if (q.kind === 'email' && value) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
      return true;
    }
    refreshNext() { if(this.nextButton) this.nextButton.disabled = !this.valid(this.config.questions[this.index]); }
    advance(skip = false) {
      if(this.busy) return;
      const q = this.config.questions[this.index];
      if(q && !skip && !this.valid(q)){this.setMessage(this.labels.required_error);return;}
      if(q) this.track('duradry_quiz_question_answered',q.key);
      let next=this.index+1;
      while(next<this.config.questions.length && !visible(this.config.questions[next],this.answers)) next++;
      if(next===this.config.questions.length){this.complete();return;}
      this.index=next;
      this.render();
    }
    back() {
      let previous=this.index-1;
      while(previous>=0&&!visible(this.config.questions[previous],this.answers)) previous--;
      this.index=previous;
      this.render();
    }
    contact(role) {
      const q=this.config.questions.find(question=>question.role===role);
      return q?String(this.answers[q.key]||(role==='first_name'?this.pendingName:'')||''):'';
    }
    complete() {
      this.result=resolve(this.config,this.answers);
      if(!this.result){this.setMessage(this.labels.configuration_error);return;}
      this.panel.replaceChildren(this.node('h2',this.labels.result_heading,{tabindex:'-1'}));
      if(this.mode==='preview') {
        this.panel.append(this.node('p',this.labels.preview_notice),this.node('h3',this.result.title),this.node('p',this.result.url,{class:'dq-path'}));
        this.panel.append(this.button(this.labels.restart_label,()=>this.restart()));
      } else {
        this.capture.hidden=false;
        this.capture.querySelector('[data-dq-email]').value=this.contact('email');
        this.capture.querySelector('[data-dq-consent]').checked=false;
        this.capture.querySelector('[data-dq-consent]').required=this.mode==='newsletter';
        this.capture.querySelector('[data-dq-native]').hidden=this.mode!=='newsletter';
        this.capture.querySelector('[data-dq-proxy]').hidden=this.mode!=='app_proxy';
        this.capture.querySelector('[data-dq-without]').hidden=this.mode!=='newsletter';
        this.capture.querySelector('[data-dq-privacy]').textContent=this.labels.privacy_note;
        this.capture.querySelector('[data-dq-consent-label]').textContent=this.labels.consent_label;
        this.capture.querySelector('[data-dq-native]').textContent=this.labels.finish_label;
        this.capture.querySelector('[data-dq-proxy]').textContent=this.labels.finish_label;
        this.capture.querySelector('[data-dq-without]').textContent=this.labels.result_button;
      }
      this.focusHeading();
    }
    bindCapture() {
      const signal=this.controller.signal;
      const form=this.capture.querySelector('form');
      this.capture.querySelector('[data-dq-email]').addEventListener('input',event=>{
        const q=this.config.questions.find(question=>question.role==='email');
        if(q)this.answers[q.key]=event.target.value.trim();
      },{signal});
      form.addEventListener('submit',event=>{
        if(this.mode!=='newsletter'||!this.result||this.busy){event.preventDefault();return;}
        if(!this.capture.querySelector('[data-dq-consent]').checked){event.preventDefault();this.setMessage(this.labels.required_error);return;}
        if(!this.savePending()){event.preventDefault();this.setMessage(this.labels.submit_error);return;}
        this.busy=true;
        this.capture.querySelector('[data-dq-native]').disabled=true;
      },{signal});
      this.capture.querySelector('[data-dq-proxy]').addEventListener('click',()=>this.submitProxy(),{signal});
      this.capture.querySelector('[data-dq-without]').addEventListener('click',()=>this.goToResult(),{signal});
    }
    savePending() {
      try{sessionStorage.setItem(this.storageKey,JSON.stringify({version:this.config.version,key:this.result.key,name:this.contact('first_name'),expires:Date.now()+30*60*1000}));return true;}catch{return false;}
    }
    restorePending() {
      let pending;
      try{pending=JSON.parse(sessionStorage.getItem(this.storageKey));}catch{return;}
      if(!pending)return;
      if(pending.expires<Date.now()||pending.version!==this.config.version){sessionStorage.removeItem(this.storageKey);return;}
      this.result=this.config.rules.map(rule=>rule.result).find(result=>result.key===pending.key);
      if(!this.result)return;
      this.pendingName=pending.name;
      const status=this.capture.querySelector('[data-dq-status]');
      if(status.dataset.success==='true'){this.goToResult(pending.name);return;}
      if(status.dataset.errors==='true'){
        this.panel.replaceChildren(this.node('h2',this.labels.submit_error,{tabindex:'-1'}));
        this.capture.hidden=false;
        this.capture.querySelector('[data-dq-proxy]').hidden=true;
        this.capture.querySelector('[data-dq-native]').textContent=this.labels.finish_label;
        this.capture.querySelector('[data-dq-without]').textContent=this.labels.result_button;
        this.capture.querySelector('[data-dq-consent-label]').textContent=this.labels.consent_label;
        this.capture.querySelector('[data-dq-privacy]').textContent=this.labels.privacy_note;
      }
    }
    async submitProxy() {
      if(this.busy||!this.result)return;
      if(!this.capture.querySelector('[data-dq-email]').reportValidity())return;
      const endpoint=safePath(this.dataset.endpoint);
      if(!endpoint?.startsWith('/apps/')){this.setMessage(this.labels.configuration_error);return;}
      this.busy=true;
      const button=this.capture.querySelector('[data-dq-proxy]');button.disabled=true;button.textContent=this.labels.busy_label;
      try{
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',signal:AbortSignal.timeout(15000),body:JSON.stringify({quiz_id:this.config.id,version:this.config.version,submission_id:this.submissionId||(this.submissionId=crypto.randomUUID()),answers:this.answers,result_key:this.result.key,email:this.contact('email'),first_name:this.contact('first_name'),email_marketing_consent:this.capture.querySelector('[data-dq-consent]').checked})});
        if(!response.ok)throw new Error('Save failed');
        const data=await response.json();if(data.ok!==true)throw new Error('Save failed');
        this.goToResult();
      }catch{this.setMessage(this.labels.submit_error);}
      finally{this.busy=false;button.disabled=false;button.textContent=this.labels.finish_label;}
    }
    goToResult(name=this.contact('first_name')) {
      const path=safePath(this.result?.url);if(!path){this.setMessage(this.labels.configuration_error);return;}
      try{sessionStorage.setItem('octaneQuizResults',JSON.stringify({answers:{Octane_first_name:name}}));sessionStorage.removeItem(this.storageKey);}catch{}
      this.track('duradry_quiz_completed');
      window.location.assign(path);
    }
    restart() {this.answers=Object.create(null);this.index=-1;this.result=null;this.submissionId=null;this.render();}
  }
  customElements.define('duradry-native-quiz',DuradryNativeQuiz);
})();
