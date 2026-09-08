'use strict';

const STORAGE_KEY = 'flashnova.data.v1';
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const normalize = s => String(s ?? '').trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[.,!?;:()\[\]{}"']/g,'').replace(/\s+/g,' ');

let data = loadData();
let currentSetId = null;
let editingSetId = null;
let studySession = null;
let deferredInstallPrompt = null;
let matchTimer = null;
let toastTimer = null;

function defaultData(){
  return {
    version:1,
    settings:{theme:'system',ttsLang:'en-US'},
    sets:[{
      id:uid(), title:'English A1 – Bộ mẫu', description:'Bộ mẫu để thử Flashcards, Learn, Test và Match.', createdAt:Date.now(), updatedAt:Date.now(),
      cards:[
        ['visit','đi thăm'],['homework','bài tập về nhà'],['tomorrow','ngày mai'],['finish','hoàn thành'],['cook','nấu ăn'],['friend','bạn'],['work','làm việc'],['learn','học']
      ].map(([term,definition])=>({id:uid(),term,definition,starred:false,correct:0,wrong:0,seen:0,mastered:false}))
    }]
  };
}
function loadData(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultData();
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed.sets)) throw new Error('bad data');
    parsed.settings = {...{theme:'system',ttsLang:'en-US'}, ...(parsed.settings||{})};
    return parsed;
  }catch(e){ console.warn(e); return defaultData(); }
}
function saveData(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(data)); }
function getSet(id=currentSetId){ return data.sets.find(s=>s.id===id); }
function cardMastered(card){ return card.mastered || (card.correct >= 3 && card.correct >= card.wrong + 2); }
function setMastery(set){ if(!set?.cards?.length) return 0; return Math.round(set.cards.filter(cardMastered).length/set.cards.length*100); }
function showToast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2200); }

function applyTheme(){
  document.documentElement.dataset.theme=data.settings.theme || 'system';
  $('#themeSelect').value=data.settings.theme || 'system';
  $('#ttsLangSelect').value=data.settings.ttsLang || 'en-US';
  const dark = data.settings.theme==='dark' || (data.settings.theme==='system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#themeBtn').textContent = dark ? '☀' : '☾';
}

function showView(name){
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`#${name}View`)?.classList.add('active');
  $$('.bottom-nav button').forEach(b=>b.classList.toggle('active', b.dataset.nav===name));
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderHome(){
  const q=normalize($('#searchInput')?.value || '');
  const sets=data.sets.filter(s=>!q || normalize(`${s.title} ${s.description} ${s.cards.map(c=>`${c.term} ${c.definition}`).join(' ')}`).includes(q));
  $('#setGrid').innerHTML=sets.map(s=>{
    const preview=s.cards.slice(0,3).map(c=>c.term).join(' • ');
    return `<button class="set-card" data-set-id="${s.id}">
      <span class="pill">${s.cards.length} thẻ</span>
      <h3>${escapeHtml(s.title)}</h3>
      <div class="set-preview">${escapeHtml(s.description || preview || 'Chưa có mô tả')}</div>
      <div class="set-card-foot"><span>${setMastery(s)}% đã nắm</span><span>→</span></div>
    </button>`;
  }).join('');
  $('#setCountLabel').textContent=`${data.sets.length} bộ thẻ • ${data.sets.reduce((n,s)=>n+s.cards.length,0)} thẻ`;
  $('#emptyState').classList.toggle('hidden', data.sets.length!==0 || q);
  if(q && sets.length===0){
    $('#setGrid').innerHTML='<div class="card" style="padding:22px;grid-column:1/-1;text-align:center"><strong>Không tìm thấy bộ thẻ phù hợp.</strong></div>';
  }
  $$('.set-card').forEach(btn=>btn.addEventListener('click',()=>openSet(btn.dataset.setId)));
}

function openSet(id){
  currentSetId=id;
  const s=getSet(); if(!s) return;
  $('#setTitle').textContent=s.title;
  $('#setMeta').textContent=`${s.cards.length} thẻ${s.description ? ' • '+s.description : ''}`;
  const pct=setMastery(s); $('#masteryPct').textContent=pct+'%'; $('#masteryRing').style.setProperty('--p',`${pct*3.6}deg`);
  $('#termList').innerHTML=s.cards.map((c,i)=>`<div class="term-row">
    <div class="term-status">${i+1}</div>
    <div><div class="term">${escapeHtml(c.term)}</div><div class="small muted">${c.correct||0} đúng • ${c.wrong||0} sai</div></div>
    <div class="definition">${escapeHtml(c.definition)}</div>
    <button class="star-btn ${c.starred?'active':''}" data-card-id="${c.id}" title="Đánh dấu thẻ khó">${c.starred?'★':'☆'}</button>
  </div>`).join('');
  $$('.star-btn').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation(); const c=s.cards.find(x=>x.id===b.dataset.cardId); c.starred=!c.starred; s.updatedAt=Date.now(); saveData(); openSet(s.id);}));
  showView('set');
}

function createCardRow(term='',definition=''){
  const row=document.createElement('div'); row.className='card-edit-row';
  row.innerHTML=`<span class="idx"></span><input class="term-input" placeholder="Thuật ngữ" value="${escapeHtml(term)}"><input class="def-input" placeholder="Định nghĩa" value="${escapeHtml(definition)}"><button type="button" class="remove-row" title="Xóa thẻ">×</button>`;
  row.querySelector('.remove-row').addEventListener('click',()=>{row.remove(); renumberRows(); ensureMinRows();});
  return row;
}
function renumberRows(){ $$('.card-edit-row .idx',$('#cardsEditor')).forEach((el,i)=>el.textContent=i+1); }
function ensureMinRows(){ const ed=$('#cardsEditor'); while(ed.children.length<2) ed.appendChild(createCardRow()); renumberRows(); }
function openSetDialog(setId=null){
  editingSetId=setId;
  const s=setId?getSet(setId):null;
  $('#setDialogTitle').textContent=s?'Sửa bộ thẻ':'Tạo bộ thẻ';
  $('#setNameInput').value=s?.title||''; $('#setDescInput').value=s?.description||''; $('#cardsEditor').innerHTML='';
  (s?.cards || [{term:'',definition:''},{term:'',definition:''}]).forEach(c=>$('#cardsEditor').appendChild(createCardRow(c.term,c.definition)));
  ensureMinRows(); $('#setDialog').showModal(); setTimeout(()=>$('#setNameInput').focus(),50);
}
function saveSetFromDialog(){
  const title=$('#setNameInput').value.trim(); if(!title){showToast('Hãy nhập tên bộ thẻ.');return false;}
  const cards=$$('.card-edit-row',$('#cardsEditor')).map(row=>({term:$('.term-input',row).value.trim(),definition:$('.def-input',row).value.trim()})).filter(c=>c.term&&c.definition);
  if(cards.length<2){showToast('Cần ít nhất 2 thẻ có đủ từ và nghĩa.');return false;}
  if(editingSetId){
    const s=getSet(editingSetId); const oldMap=new Map(s.cards.map(c=>[`${c.term}\u0000${c.definition}`,c]));
    s.title=title; s.description=$('#setDescInput').value.trim(); s.cards=cards.map(c=>oldMap.get(`${c.term}\u0000${c.definition}`)||{id:uid(),...c,starred:false,correct:0,wrong:0,seen:0,mastered:false}); s.updatedAt=Date.now();
    currentSetId=s.id;
  } else {
    const s={id:uid(),title,description:$('#setDescInput').value.trim(),createdAt:Date.now(),updatedAt:Date.now(),cards:cards.map(c=>({id:uid(),...c,starred:false,correct:0,wrong:0,seen:0,mastered:false}))};
    data.sets.unshift(s); currentSetId=s.id;
  }
  saveData(); renderHome(); $('#setDialog').close(); openSet(currentSetId); showToast('Đã lưu bộ thẻ.'); return true;
}

function parsePairs(text){
  return text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    let parts=line.includes('\t')?line.split('\t'):line.includes(';')?line.split(';'):line.includes(',')?line.split(','):[];
    if(parts.length<2) return null;
    return {term:parts.shift().trim().replace(/^"|"$/g,''),definition:parts.join(line.includes('\t')?'\t':line.includes(';')?';':',').trim().replace(/^"|"$/g,'')};
  }).filter(x=>x?.term&&x?.definition);
}

function startStudy(mode){
  const s=getSet(); if(!s || s.cards.length<2){showToast('Bộ thẻ cần ít nhất 2 thẻ.');return;}
  clearInterval(matchTimer); matchTimer=null;
  studySession={mode,setId:s.id,order:s.cards.map(c=>c.id),index:0,score:0,answered:0};
  if(mode==='flash') studySession.order=shuffle(studySession.order);
  showView('study');
  renderStudy();
}
function renderStudy(){
  const s=getSet(studySession?.setId); if(!s||!studySession) return;
  const titles={flash:'Flashcards',learn:'Learn',test:'Test',match:'Match'};
  $('#studyModeTitle').textContent=titles[studySession.mode];
  $('#restartStudyBtn').textContent=studySession.mode==='match'?'Chơi lại':'Làm lại';
  if(studySession.mode==='flash') renderFlash(s);
  if(studySession.mode==='learn') renderLearn(s);
  if(studySession.mode==='test') renderTestSetup(s);
  if(studySession.mode==='match') renderMatch(s);
}
function updateProgress(current,total){
  $('#studyProgressLabel').textContent=`${current}/${total}`;
}
function statAnswer(card,isCorrect){
  card.seen=(card.seen||0)+1;
  if(isCorrect) card.correct=(card.correct||0)+1; else card.wrong=(card.wrong||0)+1;
  card.mastered=cardMastered(card);
  const s=getSet(studySession.setId); s.updatedAt=Date.now(); saveData();
}
function speak(text){
  if(!('speechSynthesis' in window)){showToast('Thiết bị này không hỗ trợ đọc văn bản.');return;}
  speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang=data.settings.ttsLang||'en-US'; u.rate=.9; speechSynthesis.speak(u);
}

function renderFlash(s){
  const ids=studySession.order; const i=clamp(studySession.index,0,ids.length-1); studySession.index=i; const c=s.cards.find(x=>x.id===ids[i]);
  updateProgress(i+1,ids.length);
  $('#studyContent').innerHTML=`<div class="study-panel">
    <div class="study-progress"><div style="width:${(i+1)/ids.length*100}%"></div></div>
    <div class="flash-card-wrap"><div class="flash-card" id="flashCard">
      <div class="flash-face front"><div class="flash-main">${escapeHtml(c.term)}</div><div class="flash-hint">Chạm để xem nghĩa</div></div>
      <div class="flash-face back"><div class="flash-main">${escapeHtml(c.definition)}</div><div class="flash-hint">Chạm để xem từ</div></div>
    </div></div>
    <div class="flash-controls">
      <button class="btn ghost" id="prevFlash">← Trước</button>
      <div class="center"><button class="btn ghost" id="speakFlash">🔊 Nghe</button><button class="btn ghost" id="starFlash">${c.starred?'★ Đã đánh dấu':'☆ Đánh dấu'}</button></div>
      <button class="btn primary right" id="nextFlash">Tiếp →</button>
    </div>
    <div class="study-actions" style="margin-top:14px"><button class="btn danger-soft" id="dontKnowBtn">Chưa nhớ</button><button class="btn ghost" id="knowBtn">✓ Đã nhớ</button></div>
  </div>`;
  $('#flashCard').addEventListener('click',e=>e.currentTarget.classList.toggle('flipped'));
  $('#prevFlash').addEventListener('click',()=>{studySession.index=(i-1+ids.length)%ids.length;renderFlash(s)});
  $('#nextFlash').addEventListener('click',()=>{studySession.index=(i+1)%ids.length;renderFlash(s)});
  $('#speakFlash').addEventListener('click',()=>speak(c.term));
  $('#starFlash').addEventListener('click',()=>{c.starred=!c.starred;saveData();renderFlash(s)});
  $('#dontKnowBtn').addEventListener('click',()=>{statAnswer(c,false);studySession.index=(i+1)%ids.length;renderFlash(s)});
  $('#knowBtn').addEventListener('click',()=>{statAnswer(c,true);studySession.index=(i+1)%ids.length;renderFlash(s)});
}

function makeChoices(s,card,field='definition'){
  const correct=card[field]; const pool=shuffle(s.cards.filter(c=>c.id!==card.id).map(c=>c[field])).slice(0,3); return shuffle([correct,...pool]);
}
function renderLearn(s){
  if(!studySession.learnQueue){ studySession.learnQueue=shuffle(s.cards.map(c=>c.id)); studySession.index=0; studySession.correct=0; }
  if(studySession.index>=studySession.learnQueue.length){
    const total=studySession.learnQueue.length; updateProgress(total,total);
    $('#studyContent').innerHTML=`<div class="card test-summary"><div class="score-big">${studySession.correct}/${total}</div><h2>Hoàn thành vòng Learn</h2><p class="muted">Thẻ trả lời sai sẽ vẫn được ghi vào thống kê để bạn ôn lại.</p><div class="study-actions"><button class="btn primary" id="learnAgain">Học lại</button><button class="btn ghost" id="learnStarred">Chỉ học thẻ đánh dấu</button></div></div>`;
    $('#learnAgain').onclick=()=>{studySession.learnQueue=shuffle(s.cards.map(c=>c.id));studySession.index=0;studySession.correct=0;renderLearn(s)};
    $('#learnStarred').onclick=()=>{const ids=s.cards.filter(c=>c.starred).map(c=>c.id);if(!ids.length){showToast('Chưa có thẻ nào được đánh dấu.');return;}studySession.learnQueue=shuffle(ids);studySession.index=0;studySession.correct=0;renderLearn(s)};
    return;
  }
  const c=s.cards.find(x=>x.id===studySession.learnQueue[studySession.index]); const useTyped=(studySession.index%3===2 || s.cards.length<4);
  updateProgress(studySession.index+1,studySession.learnQueue.length);
  if(useTyped){
    $('#studyContent').innerHTML=`<div class="study-panel"><div class="study-progress"><div style="width:${studySession.index/studySession.learnQueue.length*100}%"></div></div><div class="card question-card"><p class="eyebrow">NHẬP CÂU TRẢ LỜI</p><h2>${escapeHtml(c.term)}</h2><div class="answer-input-row"><input id="typedAnswer" autocomplete="off" placeholder="Nhập nghĩa..."><button class="btn primary" id="checkTyped">Kiểm tra</button></div><div id="learnFeedback"></div></div></div>`;
    const submit=()=>{
      if($('#checkTyped').disabled) return; const ans=$('#typedAnswer').value; const ok=normalize(ans)===normalize(c.definition); statAnswer(c,ok); if(ok) studySession.correct++;
      $('#learnFeedback').innerHTML=`<div class="feedback ${ok?'ok':'bad'}">${ok?'✓ Chính xác':'✗ Đáp án: '+escapeHtml(c.definition)}</div>`; $('#checkTyped').disabled=true; $('#typedAnswer').disabled=true;
      const next=document.createElement('button'); next.className='btn primary'; next.style.marginTop='12px'; next.textContent='Tiếp →'; next.onclick=()=>{studySession.index++;renderLearn(s)}; $('#learnFeedback').appendChild(next);
    };
    $('#checkTyped').onclick=submit; $('#typedAnswer').addEventListener('keydown',e=>{if(e.key==='Enter')submit()}); $('#typedAnswer').focus();
  } else {
    const choices=makeChoices(s,c);
    $('#studyContent').innerHTML=`<div class="study-panel"><div class="study-progress"><div style="width:${studySession.index/studySession.learnQueue.length*100}%"></div></div><div class="card question-card"><p class="eyebrow">CHỌN ĐÁP ÁN</p><h2>${escapeHtml(c.term)}</h2><div class="answer-grid">${choices.map(x=>`<button class="answer-btn" data-answer="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('')}</div><div id="learnFeedback"></div></div></div>`;
    $$('.answer-btn').forEach(btn=>btn.onclick=()=>{
      if($$('.answer-btn').some(b=>b.disabled)) return; const ok=normalize(btn.dataset.answer)===normalize(c.definition); statAnswer(c,ok); if(ok) studySession.correct++;
      $$('.answer-btn').forEach(b=>{b.disabled=true;if(normalize(b.dataset.answer)===normalize(c.definition))b.classList.add('correct');}); if(!ok)btn.classList.add('wrong');
      $('#learnFeedback').innerHTML=`<div class="feedback ${ok?'ok':'bad'}">${ok?'✓ Chính xác':'✗ Chưa đúng'}</div><button class="btn primary" id="nextLearn" style="margin-top:12px">Tiếp →</button>`;
      $('#nextLearn').onclick=()=>{studySession.index++;renderLearn(s)};
    });
  }
}

function renderTestSetup(s){
  updateProgress(0,0);
  const max=Math.min(30,s.cards.length);
  $('#studyContent').innerHTML=`<div class="card question-card"><p class="eyebrow">TẠO BÀI KIỂM TRA</p><h2>Kiểm tra ${escapeHtml(s.title)}</h2><p class="muted">Bài test trộn câu trắc nghiệm và tự nhập. Điểm chỉ được lưu vào thống kê sau khi bạn trả lời.</p><label class="field-label">Số câu<input id="testCount" type="number" min="2" max="${max}" value="${Math.min(10,max)}"></label><div class="study-actions"><button class="btn primary" id="startTestBtn">Bắt đầu test</button></div></div>`;
  $('#startTestBtn').onclick=()=>{const count=clamp(parseInt($('#testCount').value)||10,2,max);studySession.testQueue=shuffle(s.cards.map(c=>c.id)).slice(0,count);studySession.index=0;studySession.correct=0;studySession.review=[];renderTestQuestion(s)};
}
function renderTestQuestion(s){
  const q=studySession.testQueue; if(studySession.index>=q.length) return renderTestSummary(s);
  const c=s.cards.find(x=>x.id===q[studySession.index]); const typed=studySession.index%2===1 || s.cards.length<4; updateProgress(studySession.index+1,q.length);
  const progress=(studySession.index/q.length*100);
  if(typed){
    $('#studyContent').innerHTML=`<div class="study-panel"><div class="study-progress"><div style="width:${progress}%"></div></div><div class="card question-card"><p class="eyebrow">CÂU ${studySession.index+1}</p><h2>${escapeHtml(c.term)}</h2><div class="answer-input-row"><input id="testTyped" placeholder="Nhập nghĩa..." autocomplete="off"><button class="btn primary" id="submitTestTyped">Trả lời</button></div></div></div>`;
    const submit=()=>{const ans=$('#testTyped').value.trim();if(!ans)return;const ok=normalize(ans)===normalize(c.definition);statAnswer(c,ok);if(ok)studySession.correct++;studySession.review.push({term:c.term,correct:c.definition,user:ans,ok});studySession.index++;renderTestQuestion(s)};
    $('#submitTestTyped').onclick=submit; $('#testTyped').onkeydown=e=>{if(e.key==='Enter')submit()}; $('#testTyped').focus();
  } else {
    const choices=makeChoices(s,c);
    $('#studyContent').innerHTML=`<div class="study-panel"><div class="study-progress"><div style="width:${progress}%"></div></div><div class="card question-card"><p class="eyebrow">CÂU ${studySession.index+1}</p><h2>${escapeHtml(c.term)}</h2><div class="answer-grid">${choices.map(x=>`<button class="answer-btn" data-answer="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('')}</div></div></div>`;
    $$('.answer-btn').forEach(btn=>btn.onclick=()=>{const ans=btn.dataset.answer,ok=normalize(ans)===normalize(c.definition);statAnswer(c,ok);if(ok)studySession.correct++;studySession.review.push({term:c.term,correct:c.definition,user:ans,ok});studySession.index++;renderTestQuestion(s)});
  }
}
function renderTestSummary(s){
  const total=studySession.testQueue.length,pct=Math.round(studySession.correct/total*100); updateProgress(total,total);
  $('#studyContent').innerHTML=`<div class="card test-summary"><div class="score-big">${pct}%</div><h2>${studySession.correct}/${total} câu đúng</h2><p class="muted">${pct>=80?'Tốt! Bạn đang nhớ khá chắc bộ này.':pct>=60?'Khá ổn. Hãy ôn lại các câu sai.':'Nên quay lại Learn hoặc Flashcards một vòng.'}</p><div class="study-actions"><button class="btn primary" id="retryTest">Làm test khác</button><button class="btn ghost" id="backSetSummary">Về bộ thẻ</button></div></div><div class="review-list">${studySession.review.map(r=>`<div class="review-item ${r.ok?'ok':'bad'}"><strong>${escapeHtml(r.term)}</strong><div class="small muted">Bạn trả lời: ${escapeHtml(r.user)}</div>${r.ok?'':`<div class="small">Đúng: <b>${escapeHtml(r.correct)}</b></div>`}</div>`).join('')}</div>`;
  $('#retryTest').onclick=()=>renderTestSetup(s); $('#backSetSummary').onclick=()=>openSet(s.id);
}

function renderMatch(s){
  clearInterval(matchTimer); const pairs=shuffle(s.cards).slice(0,Math.min(6,s.cards.length)); const tiles=shuffle(pairs.flatMap(c=>[{id:uid(),pair:c.id,text:c.term},{id:uid(),pair:c.id,text:c.definition}]));
  studySession.match={tiles,selected:null,matched:new Set(),startedAt:Date.now(),finished:false}; updateProgress(0,pairs.length);
  $('#studyContent').innerHTML=`<div class="match-wrap"><div class="match-top"><div><strong>Ghép các cặp đúng</strong><div class="muted small">Chạm 2 ô để ghép.</div></div><div class="timer" id="matchTimer">0.0s</div></div><div class="match-grid">${tiles.map(t=>`<button class="match-tile" data-tile-id="${t.id}">${escapeHtml(t.text)}</button>`).join('')}</div><div id="matchDone"></div></div>`;
  matchTimer=setInterval(()=>{if(!studySession?.match||studySession.match.finished)return;const sec=(Date.now()-studySession.match.startedAt)/1000;$('#matchTimer')&&($('#matchTimer').textContent=sec.toFixed(1)+'s')},100);
  $$('.match-tile').forEach(btn=>btn.onclick=()=>handleMatchTile(btn,s,pairs.length));
}
function handleMatchTile(btn,s,totalPairs){
  const m=studySession.match; if(m.finished||btn.classList.contains('matched'))return; const t=m.tiles.find(x=>x.id===btn.dataset.tileId); if(!m.selected){m.selected=t;btn.classList.add('selected');return;}
  if(m.selected.id===t.id){btn.classList.remove('selected');m.selected=null;return;}
  const firstBtn=$(`.match-tile[data-tile-id="${m.selected.id}"]`); if(m.selected.pair===t.pair){firstBtn.classList.remove('selected');firstBtn.classList.add('matched');btn.classList.add('matched');m.matched.add(t.pair);m.selected=null;updateProgress(m.matched.size,totalPairs);if(m.matched.size===totalPairs){m.finished=true;clearInterval(matchTimer);const sec=(Date.now()-m.startedAt)/1000;$('#matchDone').innerHTML=`<div class="card test-summary" style="margin-top:16px"><div class="score-big">${sec.toFixed(1)}s</div><h2>Hoàn thành!</h2><div class="study-actions"><button class="btn primary" id="matchAgain">Chơi lại</button></div></div>`;$('#matchAgain').onclick=()=>renderMatch(s);}}
  else {firstBtn.classList.remove('selected'); firstBtn.classList.add('wrong'); btn.classList.add('wrong'); setTimeout(()=>{firstBtn.classList.remove('wrong');btn.classList.remove('wrong')},260); m.selected=null;}
}

function exportSetCSV(){
  const s=getSet(); if(!s)return; const esc=v=>`"${String(v).replace(/"/g,'""')}"`; const csv=['term,definition',...s.cards.map(c=>`${esc(c.term)},${esc(c.definition)}`)].join('\n'); downloadBlob(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),safeFilename(s.title)+'.csv');
}
function backupAll(){ downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`flashnova-backup-${new Date().toISOString().slice(0,10)}.json`); }
function safeFilename(s){return s.replace(/[\\/:*?"<>|]+/g,'-').slice(0,60)||'flashnova-set'}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function importFile(file,setName){
  const text=await file.text();
  if(file.name.toLowerCase().endsWith('.json')){
    const obj=JSON.parse(text); if(obj?.sets && Array.isArray(obj.sets)){ if(!confirm(`Khôi phục ${obj.sets.length} bộ thẻ? Dữ liệu hiện tại sẽ bị thay thế.`))return; data=obj; data.settings={...{theme:'system',ttsLang:'en-US'},...(data.settings||{})}; saveData();applyTheme();renderHome();showView('home');showToast('Đã khôi phục bản sao lưu.');return; }
    throw new Error('JSON không phải bản sao lưu FlashNova.');
  }
  const pairs=parsePairs(text); if(pairs.length<2) throw new Error('Không đọc được ít nhất 2 cặp từ/nghĩa.');
  const s={id:uid(),title:setName.trim()||file.name.replace(/\.[^.]+$/,''),description:`Nhập từ ${file.name}`,createdAt:Date.now(),updatedAt:Date.now(),cards:pairs.map(c=>({id:uid(),...c,starred:false,correct:0,wrong:0,seen:0,mastered:false}))}; data.sets.unshift(s);saveData();renderHome();openSet(s.id);showToast(`Đã nhập ${pairs.length} thẻ.`);
}

function handleInstall(){
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt.userChoice.finally(()=>{deferredInstallPrompt=null;$('#installBtn').classList.add('hidden')});}
  else { const ios=/iphone|ipad|ipod/i.test(navigator.userAgent); showToast(ios?'Safari → Chia sẻ → Thêm vào Màn hình chính.':'Mở menu trình duyệt → Cài ứng dụng / Thêm vào màn hình chính.'); }
}

function bindEvents(){
  $('#newSetBtn').onclick=()=>openSetDialog(); $('#newSetHero').onclick=()=>openSetDialog(); $('#emptyCreateBtn').onclick=()=>openSetDialog();
  $('#searchInput').addEventListener('input',renderHome);
  $$('[data-go-home]').forEach(b=>b.onclick=()=>{renderHome();showView('home')});
  $$('.bottom-nav button').forEach(b=>b.onclick=()=>{if(b.dataset.nav==='home'){renderHome();showView('home')}else showView('settings')});
  $('#themeBtn').onclick=()=>{data.settings.theme=(data.settings.theme==='dark'?'light':'dark');saveData();applyTheme()};
  $('#themeSelect').onchange=e=>{data.settings.theme=e.target.value;saveData();applyTheme()};
  $('#ttsLangSelect').onchange=e=>{data.settings.ttsLang=e.target.value;saveData()};
  $('#setForm').addEventListener('submit',e=>{e.preventDefault();saveSetFromDialog()});
  $('#closeSetDialog').onclick=$('#cancelSetDialog').onclick=()=>$('#setDialog').close();
  $('#addCardRowBtn').onclick=()=>{$('#cardsEditor').appendChild(createCardRow());renumberRows();$('#cardsEditor').lastElementChild.querySelector('input').focus()};
  $('#pasteImportBtn').onclick=()=>{$('#pasteArea').value='';$('#pasteDialog').showModal();setTimeout(()=>$('#pasteArea').focus(),50)};
  $('#closePasteDialog').onclick=$('#cancelPasteDialog').onclick=()=>$('#pasteDialog').close();
  $('#pasteForm').onsubmit=e=>{e.preventDefault();const pairs=parsePairs($('#pasteArea').value);if(!pairs.length){showToast('Không đọc được cặp từ/nghĩa.');return;}pairs.forEach(p=>$('#cardsEditor').appendChild(createCardRow(p.term,p.definition)));renumberRows();$('#pasteDialog').close();showToast(`Đã thêm ${pairs.length} thẻ.`)};
  $('#editSetBtn').onclick=()=>openSetDialog(currentSetId);
  $('#deleteSetBtn').onclick=()=>{const s=getSet();if(!s)return;if(confirm(`Xóa bộ “${s.title}”?`)){data.sets=data.sets.filter(x=>x.id!==s.id);saveData();renderHome();showView('home');showToast('Đã xóa bộ thẻ.')}};
  $('#exportSetBtn').onclick=exportSetCSV;
  $$('.mode-card').forEach(b=>b.onclick=()=>startStudy(b.dataset.mode));
  $('#backToSetBtn').onclick=()=>{clearInterval(matchTimer);openSet(studySession?.setId||currentSetId)};
  $('#restartStudyBtn').onclick=()=>{if(studySession)startStudy(studySession.mode)};
  $('#backupBtn').onclick=backupAll;
  $('#importBtn').onclick=()=>{$('#importFileInput').value='';$('#importFileName').textContent='Chưa chọn file';$('#importSetName').value='';$('#importDialog').showModal()};
  $('#closeImportDialog').onclick=$('#cancelImportDialog').onclick=()=>$('#importDialog').close();
  $('#importFileInput').onchange=e=>{$('#importFileName').textContent=e.target.files[0]?.name||'Chưa chọn file'};
  $('#importForm').onsubmit=async e=>{e.preventDefault();const f=$('#importFileInput').files[0];if(!f){showToast('Hãy chọn file.');return;}try{await importFile(f,$('#importSetName').value);$('#importDialog').close()}catch(err){showToast(err.message||'Không nhập được file.')}};
  $('#restoreBtn').onclick=()=>$('#restoreFileInput').click();
  $('#restoreFileInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importFile(f,'')}catch(err){showToast(err.message||'Không khôi phục được.')}e.target.value=''};
  $('#resetBtn').onclick=()=>{if(confirm('Xóa toàn bộ bộ thẻ và tiến độ trên thiết bị này?')){data={version:1,settings:{...data.settings},sets:[]};saveData();renderHome();showView('home');showToast('Đã xóa toàn bộ dữ liệu.')}};
  $('#installBtn').onclick=handleInstall; $('#installSettingsBtn').onclick=handleInstall;
}

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('#installBtn').classList.remove('hidden')});
window.addEventListener('appinstalled',()=>{showToast('FlashNova đã được cài.');$('#installBtn').classList.add('hidden')});

if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(console.warn);

applyTheme(); bindEvents(); renderHome(); showView('home');
