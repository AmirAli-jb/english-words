/* WordJB v2 — public browser code. Account data is stored in Supabase with RLS.
   Demo data is stored locally and is NEVER presented as a cloud account. */
(() => {
  'use strict';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEMO_KEY = 'wordjb-demo-v2';
  const THEME_KEY = 'wordjb-theme-v2';
  const THEMES = ['green', 'blue', 'navy'];
  const CADENCES = {daily: 1, weekly: 7, monthly: 30};
  const $ = id => document.getElementById(id);
  const state = {mode:'none', user:null, client:null, words:[], editingId:null, view:'add', scope:'all', queue:[], activeId:null, revealed:false, reviewed:0, busy:false, request:0, theme:'green'};
  let toastTimer;
  const str = (value, max=800) => typeof value === 'string' ? value.trim().slice(0,max) : '';
  const nowIso = () => new Date().toISOString();
  const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const isCadence = f => Object.hasOwn(CADENCES,f);
  const isDue = w =>  w.review_step < 7 && new Date(w.next_review).getTime() <= Date.now();
  const accountConfigured = () => {
    const cfg = window.WORDJB_CONFIG || {};
    return typeof cfg.supabaseUrl === 'string' && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.supabaseUrl)
      && typeof cfg.supabasePublishableKey === 'string' && /^(sb_publishable_|eyJ)[a-zA-Z0-9._-]+$/.test(cfg.supabasePublishableKey);
  };
  function notify(msg){
    const el=$('toast');el.textContent=msg;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500);
  }
  function errorMessage(err){return err && typeof err.message==='string' ? err.message : String(err || 'Something went wrong');}
  function showFeedback(msg){const el=$('authFeedback');el.textContent=msg;el.classList.remove('hidden');}
  function setBusy(flag){state.busy=flag;document.querySelectorAll('button[type="submit"],#correctButton,#forgotButton').forEach(b=>b.disabled=flag);}
  function toDb(w){return {id:w.id,user_id:state.user.id,term:w.term,meaning:w.meaning,example:w.example,frequency:w.frequency,score:w.score,review_step:w.review_step ?? 0,correct_count:w.correct_count,incorrect_count:w.incorrect_count,streak:w.streak,next_review:w.next_review,last_review:w.last_review,created_at:w.created_at,updated_at:nowIso()};}
  function normalize(input){
    if(!input || typeof input !== 'object') return null;
    if(!str(input.term,120)||!str(input.meaning,800))return null;
    const stamp = v => {const date=new Date(v);return Number.isFinite(date.getTime())?date.toISOString():nowIso();};
    const num = (v,min,max) => Number.isFinite(v)?Math.max(min,Math.min(max,Math.floor(v))):0;
    return {id:typeof input.id==='string' && /^[a-f\d]{8}-[a-f\d-]{27,}$/i.test(input.id)?input.id:uid(),term:str(input.term,120),meaning:str(input.meaning),example:str(input.example,800),frequency:isCadence(input.frequency)?input.frequency:'daily',score:num(input.score ?? ((input.reps || 0)*12),0,100),review_step:num(input.review_step ?? 0,0,7),correct_count:num(input.correct_count ?? input.reps,0,999999),incorrect_count:num(input.incorrect_count,0,999999),streak:num(input.streak,0,99999),next_review:stamp(input.next_review ?? input.due ?? Date.now()),last_review:input.last_review?stamp(input.last_review):null,created_at:stamp(input.created_at ?? input.created ?? Date.now()),updated_at:stamp(input.updated_at ?? Date.now())};
  }
  function loadDemo(){
    try{let data=JSON.parse(localStorage.getItem(DEMO_KEY)||localStorage.getItem('wordnest-demo-v2')||'[]');return Array.isArray(data)?data.map(normalize).filter(Boolean):[];}
    catch(e){notify('Could not read demo storage.');return []}
  }
  function saveDemo(){try{localStorage.setItem(DEMO_KEY,JSON.stringify(state.words));return true;}catch(e){notify('Browser storage is unavailable. Export a backup.');return false;}}
  function applyTheme(theme, save=true){
    const chosen=THEMES.includes(theme)?theme:'green';state.theme=chosen;document.body.dataset.theme=chosen;
    document.querySelectorAll('[data-theme-choice]').forEach(b=>{const selected=b.dataset.themeChoice===chosen;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
    if(save){try{localStorage.setItem(THEME_KEY,chosen)}catch(e){/* optional */}}
  }
  async function pickTheme(theme){
    applyTheme(theme);
    if(state.mode==='cloud' && state.user){
      const {error}=await state.client.from('profiles').update({theme}).eq('id',state.user.id);
      if(error)notify('Theme saved on this device; cloud sync was unavailable.');
    }
  }
  function chooseAuth(which){
    const signup=which==='signup';$('loginTab').classList.toggle('active',!signup);$('registerTab').classList.toggle('active',signup);
    $('loginTab').setAttribute('aria-selected',String(!signup));$('registerTab').setAttribute('aria-selected',String(signup));
    $('loginForm').classList.toggle('hidden',signup);$('signupForm').classList.toggle('hidden',!signup);$('authFeedback').classList.add('hidden');
  }
  function showApp(){
    $('authGate').classList.add('hidden');$('appShell').classList.remove('hidden');$('profileBadge').classList.remove('hidden');
    const display=state.mode==='cloud' ? (state.user?.user_metadata?.username || state.user?.email?.split('@')[0] || 'Learner') : 'Demo';
    $('profileBadge').textContent='✦ '+display;
    $('heroSubtitle').textContent=state.mode==='cloud'?`Your own vocabulary, saved to your account.`:'Explore the app with words stored only on this device.';
    $('accountInfo').textContent=state.mode==='cloud' ? `${display} · ${state.user?.email || 'Signed in'}` : 'Demo mode — only saved in this browser';
    $('signOut').textContent=state.mode==='cloud'?'Sign out':'Leave demo';
    $('storageNote').textContent=state.mode==='cloud'?'Your vocabulary is stored in your Supabase account. Export backups for extra safety.':'Demo mode stores words only in this browser. Export a backup before clearing Safari data.';
    updateStats();setView('add');
  }
  function showAuth(){
    $('authGate').classList.remove('hidden');$('appShell').classList.add('hidden');$('profileBadge').classList.add('hidden');
    $('authFeedback').classList.add('hidden');
  }
  async function loadCloud(){
    const generation=++state.request;
    const [wordsResult,profileResult]=await Promise.all([
      state.client.from('vocab_words').select('*').order('created_at',{ascending:false}),
      state.client.from('profiles').select('username, theme').eq('id',state.user.id).maybeSingle()
    ]);
    if(generation!==state.request || state.mode!=='cloud')return;
    if(wordsResult.error)throw wordsResult.error;
    state.words=wordsResult.data.map(normalize).filter(Boolean);
    if(profileResult.data?.username)state.user.user_metadata={...(state.user.user_metadata||{}),username:profileResult.data.username};
    if(THEMES.includes(profileResult.data?.theme))applyTheme(profileResult.data.theme);
    showApp();
  }
  async function enterCloud(session){
    if(!session?.user)return;
    state.mode='cloud';state.user=session.user;state.words=[];
    try{await loadCloud()}catch(e){showAuth();state.mode='none';state.user=null;showFeedback('Could not load your account data: '+errorMessage(e));}
  }
  async function handleSignUp(e){
    e.preventDefault();if(!state.client){showFeedback('Connect Supabase before creating an account. You can still try the demo.');return;}
    const username=$('signupUsername').value.trim().toLowerCase(),email=$('signupEmail').value.trim(),password=$('signupPassword').value;
    if(!/^[a-z0-9_]{3,20}$/.test(username)){showFeedback('Username must contain 3–20 letters, numbers or underscores.');return;}
    if(password.length<8){showFeedback('Please use a password with at least 8 characters.');return;}
    setBusy(true);
    try{
      const {data,error}=await state.client.auth.signUp({email,password,options:{data:{username,theme:state.theme},emailRedirectTo:location.origin+location.pathname}});
      if(error)throw error;
      if(data.session){showFeedback('Account created. Opening your vocabulary…');await enterCloud(data.session)}
      else showFeedback('Account requested. Check your email for a confirmation link, then return here and sign in. Your chosen username must be unique.');
    }catch(err){showFeedback('Could not create account: '+errorMessage(err)+'. Check that the username is available.');}
    finally{setBusy(false)}
  }
  async function handleSignIn(e){
    e.preventDefault();if(!state.client){showFeedback('Connect Supabase first, or use the demo.');return;}
    setBusy(true);
    try{
      const {data,error}=await state.client.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});
      if(error)throw error;
      await enterCloud(data.session);
    }catch(err){showFeedback('Sign in failed: '+errorMessage(err))}finally{setBusy(false)}
  }
  function startDemo(){state.request++;state.mode='demo';state.user=null;state.words=loadDemo();showApp();notify('Demo mode · Words are saved in this browser.');}
  async function exitApp(){
    if(state.mode==='cloud'){
      setBusy(true);
      try{const {error}=await state.client.auth.signOut();if(error)throw error;}
      catch(err){notify('Could not sign out: '+errorMessage(err));setBusy(false);return}
      finally{setBusy(false)}
    }
    state.request++;state.mode='none';state.user=null;state.words=[];state.activeId=null;state.queue=[];showAuth();
  }
  function dueWords(scope='all'){
    return state.words.filter(w=>isDue(w) && (scope==='all'||w.frequency===scope)).sort((a,b)=>Date.parse(a.next_review)-Date.parse(b.next_review));
  }
  function updateStats(){
    const d=dueWords();
    $('statTotal').textContent=state.words.length;
    $('statDue').textContent=d.length;  
    $('statMastered').textContent = state.words.filter(w => w.review_step === 7).length;
    $('statCorrect').textContent=state.words.reduce((n,w)=>n+w.correct_count,0);
    $('allDueCount').textContent=d.length;
    for(const frequency of Object.keys(CADENCES))$(frequency+'DueCount').textContent=d.filter(w=>w.frequency===frequency).length;
  }
  function setView(view){
    if(!['add','review','library','settings'].includes(view))return;
    state.view=view;
    for(const v of ['add','review','library','settings'])$('view'+v.charAt(0).toUpperCase()+v.slice(1)).classList.toggle('hidden',v!==view);
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    if(view==='review')startReview();if(view==='library')renderLibrary();updateStats();
    if(view==='add')$('term').focus({preventScroll:true});
  }

   
/* WordJB - Persian Meaning Suggestions */
   
   let meaningLookupVersion = 0;
   
   const OPENJAM_WORDS =
     'https://openjam.amirj4m.com/v1/words/';
   
   function appendMeaning(value) {
     const text = value.trim();
     const field = $('meaning');
   
     if (!text) return false;
   
     const original = field.value.trim();
   
     const existing = original
       .split(/[،;\n]/)
       .map(s => s.trim())
       .filter(Boolean);
   
     if (existing.includes(text)) return true;
   
     const next = original
       ? `${original}، ${text}`
       : text;
   
     if (next.length > 800) {
       notify('Meaning is too long.');
       return false;
     }
   
     field.value = next;
     return true;
   }
   
   function addSelectedMeanings() {
     const boxes = $('meaningSuggestions')
       .querySelectorAll('input[type="checkbox"]:checked');
   
     let count = 0;
   
     for (const box of boxes) {
       if (appendMeaning(box.value)) {
         box.checked = false;
         count++;
       }
     }
   
     if (count) {
       $('meaningLookupStatus').textContent =
         'Meanings added. You can edit them below.';
     }
   }
   
   function addCustomMeaning() {
     const field = $('customMeaning');
     const value = field.value.trim();
   
     if (!value) return;
   
     if (appendMeaning(value)) {
       field.value = '';
   
       $('meaningLookupStatus').textContent =
         'Your meaning has been added.';
     }
   }
   
   function clearMeaningSuggestions() {
     meaningLookupVersion++;
   
     $('meaningSuggestions').replaceChildren();
     $('meaningSuggestions').classList.add('hidden');
   
     $('meaningLookupStatus').textContent = '';
     $('suggestMeanings').disabled = false;
   }
   
   async function fetchMeaningSuggestions() {
     const term = $('term').value.trim();
   
     if (!term) {
       $('meaningLookupStatus').textContent =
         'Enter an English word first.';
       return;
     }
   
     const version = ++meaningLookupVersion;
     const container = $('meaningSuggestions');
   
     container.replaceChildren();
     container.classList.add('hidden');
   
     $('meaningLookupStatus').textContent =
       'Searching for Persian meanings...';
   
     $('suggestMeanings').disabled = true;
   
     try {
       const url = OPENJAM_WORDS +
         encodeURIComponent(term.toLowerCase());
   
       const response = await fetch(url, {
         headers: { Accept: 'application/json' }
       });
   
       if (
         version !== meaningLookupVersion ||
         $('term').value.trim() !== term
       ) return;
   
       if (response.status === 404) {
         $('meaningLookupStatus').textContent =
           'No suggestions found. Add your own meaning.';
         return;
       }
   
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}`);
       }
   
       const data = await response.json();
   
       if (
         version !== meaningLookupVersion ||
         $('term').value.trim() !== term
       ) return;
   
       const senses = Array.isArray(data.senses)
         ? data.senses
         : [];
   
       const translations = senses.flatMap(s =>
         Array.isArray(s.translations)
           ? s.translations
           : []
       );
   
       const meanings = [...new Set(
         translations
           .filter(t =>
             t &&
             t.language_code === 'fa' &&
             typeof t.meaning === 'string'
           )
           .map(t => t.meaning.trim())
           .filter(Boolean)
       )].slice(0, 12);
   
       if (!meanings.length) {
         $('meaningLookupStatus').textContent =
           'No Persian meanings found. Add yours below.';
         return;
       }
   
       for (const meaning of meanings) {
         const label = document.createElement('label');
         label.className = 'meaning-suggestion';
   
         const checkbox = document.createElement('input');
         checkbox.type = 'checkbox';
         checkbox.value = meaning;
   
         const text = document.createElement('span');
         text.textContent = meaning;
   
         label.append(checkbox, text);
         container.append(label);
       }
   
       container.classList.remove('hidden');
   
       $('meaningLookupStatus').textContent =
         `${meanings.length} suggestions found.`;
     } catch (error) {
       if (version === meaningLookupVersion) {
         $('meaningLookupStatus').textContent =
           'Dictionary unavailable. Add a meaning manually.';
       }
     } finally {
       if (version === meaningLookupVersion) {
         $('suggestMeanings').disabled = false;
       }
     }
   }

  function resetWordForm(){
    state.editingId=null;$('wordForm').reset();$('wordFormTitle').textContent='Save a new word';$('saveWord').innerHTML='Save word <span>→</span>';$('cancelEdit').classList.add('hidden');clearMeaningSuggestions();
  }
  async function saveWord(e){
    e.preventDefault();if(state.busy)return;
    addSelectedMeanings();
    addCustomMeaning();
    const term=$('term').value.trim(),meaning=$('meaning').value.trim(),example=$('example').value.trim(),frequency=$('frequency').value;
    if (!term || !meaning || !isCadence(frequency)) {
      notify('Please enter a word and at least one meaning.');
      return;
    }
    const duplicate=state.words.find(w=>w.id!==state.editingId&&w.term.toLowerCase()===term.toLowerCase());
    if(duplicate && !window.confirm(`You already have “${term}”. Save another card anyway?`))return;
    const original=state.words.find(w=>w.id===state.editingId);
    const w=original ? {...original,term,meaning,example,frequency} : normalize({id:uid(),term,meaning,example,frequency,next_review:new Date(Date.now()+DAY_MS).toISOString(),created_at:nowIso()});
    if(!w)return;
    setBusy(true);
    try{
      if(state.mode==='cloud'){
        let res;
        if(original)res=await state.client.from('vocab_words').update(toDb(w)).eq('id',w.id).select('*').single();
        else res=await state.client.from('vocab_words').insert(toDb(w)).select('*').single();
        if(res.error)throw res.error;
        const saved=normalize(res.data);
        state.words=original?state.words.map(item=>item.id===original.id?saved:item):[saved,...state.words];
      }else{
        const oldWords=state.words;
        state.words=original?state.words.map(item=>item.id===original.id?w:item):[w,...state.words];
        if(!saveDemo()){state.words=oldWords;return;}
      }
      resetWordForm();updateStats();notify(original?'Word updated successfully.':'Your new word is saved!');
    }catch(err){notify('Could not save word: '+errorMessage(err))}finally{setBusy(false)}
  }
  function beginEdit(id){
    const w=state.words.find(item=>item.id===id);if(!w)return;
    state.editingId=w.id;setView('add');$('wordFormTitle').textContent='Edit your word';clearMeaningSuggestions();$('term').value=w.term;$('meaning').value=w.meaning;$('example').value=w.example;$('frequency').value=w.frequency;
    $('saveWord').innerHTML='Update word <span>→</span>';$('cancelEdit').classList.remove('hidden');$('term').focus();
    $('viewAdd').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function deleteWord(id){
    const w=state.words.find(item=>item.id===id);if(!w||!window.confirm(`Delete “${w.term}” and its review history?`))return;
    try{
      if(state.mode==='cloud'){
        const {error}=await state.client.from('vocab_words').delete().eq('id',id);
        if(error)throw error;
      }
      const old=state.words;state.words=state.words.filter(item=>item.id!==id);
      if(state.mode==='demo'&&!saveDemo()){state.words=old;return;}
      renderLibrary();updateStats();notify('Word removed.');
    }catch(err){notify('Could not delete: '+errorMessage(err))}
  }
  function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el}
  function renderLibrary(){
    const query=$('search').value.trim().toLowerCase(),frequency=$('libraryFrequency').value;
    const filtered=state.words.filter(w=>(frequency==='all'||frequency===w.frequency) && [w.term,w.meaning,w.example].some(v=>v.toLowerCase().includes(query)));
    const list=$('wordList');list.replaceChildren();
    if(!filtered.length){list.append(element('p','empty-library',state.words.length?'No words match your filters.':'Your word collection is empty. Add a new word to begin!'));return}
    filtered.forEach(w=>{
      const item=element('article','word-row'),details=element('div','word-details'),heading=element('div','word-name');  
      heading.append(element('strong', '', w.term));
      details.append(heading, element('p', '', w.meaning));
      if(w.example)details.append(element('small','',w.example));
      const score=element('div','word-score'),bar=element('div','bar'),fill=element('i');fill.style.width=w.score+'%';bar.append(fill);
      const reviewLabel = w.review_step === 7
        ? 'Mastered'
        : isDue(w) ? 'Due now' : 'Next ' + new Date(w.next_review).toLocaleDateString();
      const stats = element('small', '',
        `✓ ${w.correct_count} · ✕ ${w.incorrect_count} · ${reviewLabel}`);
      const actions=element('div','word-actions');const edit=element('button','tiny-btn','Edit'),del=element('button','tiny-btn','Delete');edit.type='button';del.type='button';
      edit.addEventListener('click',()=>beginEdit(w.id));del.addEventListener('click',()=>deleteWord(w.id));actions.append(edit,del);
      score.append(element('strong','',`${w.score} / 100`),bar,stats,actions);item.append(details,score);list.append(item);
    });
  }
  function startReview(){
    state.queue=dueWords(state.scope).map(w=>w.id);state.reviewed=0;advanceReview();
  }
  function advanceReview(){
    state.activeId=null;
    while(state.queue.length&&!state.activeId){let id=state.queue.shift();if(state.words.find(w=>w.id===id))state.activeId=id;}
    const w=state.words.find(w=>w.id===state.activeId);
    $('reviewEmpty').classList.toggle('hidden',Boolean(w));$('reviewCardArea').classList.toggle('hidden',!w);
    if(!w){
      $('reviewEmpty').querySelector('h3').textContent=state.reviewed?'Nice work — session complete!':'You’re all caught up!';
      $('reviewEmpty').querySelector('p').textContent=state.reviewed?'You reviewed '+state.reviewed+' word'+(state.reviewed===1?'':'s')+'. Keep the habit going!':'Your words will appear here when they are ready for review.';
      return;
    }
    state.revealed=false;$('cardTerm').textContent=w.term;$('cardMeaning').textContent=w.meaning;$('cardExample').textContent=w.example;
    $('cardMeaning').classList.add('hidden');$('cardExample').classList.add('hidden');$('reviewRatings').classList.add('hidden');   
    $('cardSide').textContent = 'ENGLISH';
    $('reviewProgress').textContent='Card '+(state.reviewed+1)+' of '+(state.reviewed+state.queue.length+1);
    $('reviewScore').textContent='Mastery: '+w.score+' / 100';
  }
  function reveal(){if(!state.activeId||state.revealed)return;state.revealed=true;
    $('cardMeaning').classList.remove('hidden');if($('cardExample').textContent)$('cardExample').classList.remove('hidden');
    $('revealHint').textContent='How well did you remember?';$('reviewRatings').classList.remove('hidden');
  }
  
async function rate(correct) {
  if (!state.revealed || !state.activeId || state.busy) return;

  const old = state.words.find(w => w.id === state.activeId);
  if (!old) return;

  const previousStep = old.review_step ?? 0;

  // Correct: advance one stage
  // Incorrect: return to the last checkpoint
  const reviewStep = correct
    ? Math.min(7, previousStep + 1)
    : (previousStep >= 4 ? 4 : 0);

  // Intervals between reviews, in days
  const intervals = [1, 2, 2, 2, 7, 14, 14];

  // Forgotten words are reviewed again tomorrow
  const days = correct
    ? (reviewStep === 7 ? 14 : intervals[reviewStep])
    : 1;

  const newWord = {
    ...old,
    review_step: reviewStep,
    score: Math.round((reviewStep / 7) * 100),
    correct_count: old.correct_count + (correct ? 1 : 0),
    incorrect_count: old.incorrect_count + (correct ? 0 : 1),
    streak: correct ? old.streak + 1 : 0,
    last_review: nowIso(),
    next_review: new Date(Date.now() + days * DAY_MS).toISOString()
  };

  setBusy(true);

  try {
    let saved = newWord;

    if (state.mode === 'cloud') {
      const {data, error} = await state.client
        .from('vocab_words')
        .update(toDb(newWord))
        .eq('id', newWord.id)
        .select('*')
        .single();

      if (error) throw error;
      saved = normalize(data);
    }

    const prev = state.words;
    state.words = state.words.map(w =>
      w.id === newWord.id ? saved : w
    );

    if (state.mode === 'demo' && !saveDemo()) {
      state.words = prev;
      return;
    }

    state.reviewed++;
    updateStats();
    advanceReview();

  } catch (err) {
    notify('Could not save review: ' + errorMessage(err));
  } finally {
    setBusy(false);
  }
}

  function exportBackup(){
    const contents=JSON.stringify({app:'wordjb',version:2,exportedAt:nowIso(),words:state.words,theme:state.theme},null,2);
    const url=URL.createObjectURL(new Blob([contents],{type:'application/json'}));const a=document.createElement('a');a.href=url;
    a.download='wordjb-backup-'+nowIso().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function importBackup(e){
    const f=e.target.files?.[0];if(!f)return;
    try{
      if(f.size>3*1024*1024)throw new Error('Backup is larger than 3MB.');
      const data=JSON.parse(await f.text());if(!['wordjb','wordnest','my-english-words'].includes(data.app)||!Array.isArray(data.words)||data.words.length>5000)throw new Error('Unsupported backup format.');
      const imported=data.words.map(normalize);
      if(imported.some(w=>!w))throw new Error('Some words are invalid.');
      if(!window.confirm(`Import ${imported.length} words? Existing words with the same spelling will be kept.`))return;
      const existing=new Set(state.words.map(w=>w.term.trim().toLowerCase()));
      const filtered=imported.filter(w=>{const name=w.term.trim().toLowerCase();if(existing.has(name))return false;existing.add(name);return true;});
      if(!filtered.length){notify('All these words already exist.');return}
      setBusy(true);
      if(state.mode==='cloud'){
        // Generate new IDs and force the logged-in user's ID to prevent importing account ownership.
        const rows=filtered.map(w=>toDb({...w,id:crypto.randomUUID()}));
        const {data:result,error}=await state.client.from('vocab_words').insert(rows).select('*');
        if(error)throw error;state.words=[...result.map(normalize),...state.words];
      }else{
        const old=state.words;state.words=[...filtered.map(w=>({...w,id:uid()})),...state.words];
        if(!saveDemo()){state.words=old;return;}
      }
      updateStats();renderLibrary();notify('Imported '+filtered.length+' new words!');
    }catch(err){notify('Import failed: '+errorMessage(err))}finally{setBusy(false);e.target.value=''}
  }
  function attachEvents(){
    document.querySelectorAll('[data-theme-choice]').forEach(b=>b.addEventListener('click',()=>pickTheme(b.dataset.themeChoice)));
    $('loginTab').addEventListener('click',()=>chooseAuth('login'));$('registerTab').addEventListener('click',()=>chooseAuth('signup'));
    $('loginForm').addEventListener('submit',handleSignIn);$('signupForm').addEventListener('submit',handleSignUp);$('demoButton').addEventListener('click',startDemo);
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
    $('heroReview').addEventListener('click',()=>setView('review'));$('emptyAdd').addEventListener('click',()=>setView('add'));
    $('wordForm').addEventListener('submit',saveWord);$('cancelEdit').addEventListener('click',resetWordForm);
    $('search').addEventListener('input',renderLibrary);$('libraryFrequency').addEventListener('change',renderLibrary);
    document.querySelectorAll('[data-scope]').forEach(b=>b.addEventListener('click',()=>{state.scope=b.dataset.scope;document.querySelectorAll('[data-scope]').forEach(x=>x.classList.toggle('active',x===b));startReview();}));
    $('flashcard').addEventListener('click',reveal);$('forgotButton').addEventListener('click',()=>rate(false));$('correctButton').addEventListener('click',()=>rate(true));
    $('exportBackup').addEventListener('click',exportBackup);$('importBackup').addEventListener('click',()=>$('importFile').click());$('importFile').addEventListener('change',importBackup);
    $('signOut').addEventListener('click',exitApp);
    
    $('suggestMeanings').addEventListener(
        'click', fetchMeaningSuggestions
      );
      
    $('addSelectedMeanings').addEventListener(
        'click', addSelectedMeanings
      );
      
    $('addCustomMeaning').addEventListener(
        'click', addCustomMeaning
      );
      
    $('term').addEventListener(
        'input', clearMeaningSuggestions
      );
         
  }
  async function boot(){
    applyTheme((()=>{try{return (localStorage.getItem(THEME_KEY)||localStorage.getItem('wordnest-theme-v2'))}catch(e){return 'green'}})()||'green',false);
    attachEvents();chooseAuth('login');
    if(!accountConfigured()){$('cloudSetupNotice').classList.remove('hidden');return;}
    if(!window.supabase || !window.supabase.createClient){$('cloudSetupNotice').classList.remove('hidden');showFeedback('Cloud library could not load. Check your internet connection.');return;}
    const config=window.WORDJB_CONFIG;
    state.client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    state.client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT' && state.mode==='cloud')setTimeout(()=>{state.request++;state.mode='none';state.user=null;state.words=[];showAuth()},0);
      else if(event==='SIGNED_IN' && session && state.mode==='none')setTimeout(()=>enterCloud(session),0);
    });
    const {data,error}=await state.client.auth.getSession();
    if(error)showFeedback('Could not restore your session: '+errorMessage(error));
    else if(data.session && state.mode==='none')await enterCloud(data.session);
  }
  boot().catch(err=>{showAuth();showFeedback('Startup error: '+errorMessage(err))});
})();
