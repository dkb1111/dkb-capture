// DKB Capture app.js v0.3.9 — full replacement — overlay reset fix
const $=id=>document.getElementById(id);

let mr=null,stream=null,chunks=[],ctx=null,an=null,meter=null,clock=null,start=0,qs=[],speech=null,finalText='',interim='';
let pending=null,confirmTimer=null;
let notesCache=[];
let selected=new Set();
let openedMatter=null;
let notesScroll=0;
let addToMatterId='';
let currentAudioObjectUrl='';

const rec=$('recordBtn');
const statusEl=$('status');

$('captureTab').onclick=()=>showFreshCapture();
$('notesTab').onclick=()=>openNotes();

function panel(name){
  $('capturePanel').classList.toggle('on',name==='capture');
  $('notesPanel').classList.toggle('on',name==='notes');
  $('openPanel').classList.toggle('on',name==='open');
  $('captureTab').classList.toggle('active',name==='capture');
  $('notesTab').classList.toggle('active',name==='notes');
}

function resetCaptureState(){
  try{speech?.stop()}catch(e){}
  try{ctx?.close()}catch(e){}
  try{stream?.getTracks().forEach(t=>t.stop())}catch(e){}
  clearInterval(clock);clearInterval(meter);
  mr=null;stream=null;chunks=[];ctx=null;an=null;meter=null;clock=null;qs=[];speech=null;finalText='';interim='';
  pending=null;
  rec.classList.remove('rec');
  rec.textContent='● RECORD';
  $('timer').textContent='00:00';
  $('meterFill').style.width='0%';
  $('quality').textContent='READY';
  statusEl.textContent='READY';
}

function showFreshCapture(){
  addToMatterId='';
  resetCaptureState();
  panel('capture');
  window.scrollTo(0,0);
}

rec.onclick=async()=>{
  if(mr&&mr.state==='recording')mr.stop();
  else await startRecording();
};

async function startRecording(){
  resetCaptureState();
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{noiseSuppression:true,echoCancellation:true,autoGainControl:true}});
    const mime=MediaRecorder.isTypeSupported('audio/mp4')?'audio/mp4':MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';
    mr=new MediaRecorder(stream,{mimeType:mime});
    chunks=[];qs=[];finalText='';interim='';
    mr.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
    mr.onstop=finishAndAutoSave;
    mr.start(250);
    startSpeech();startMeter();startClock();
    rec.classList.add('rec');rec.textContent='■ STOP';statusEl.textContent='RECORDING';
  }catch(e){statusEl.textContent='MICROPHONE BLOCKED'}
}

function startSpeech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR)return;
  try{
    speech=new SR();speech.continuous=true;speech.interimResults=true;speech.lang='en-AU';
    speech.onresult=e=>{interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)finalText+=(finalText?' ':'')+t;else interim+=t}};
    speech.start();
  }catch(e){}
}

function startClock(){
  start=Date.now();
  clock=setInterval(()=>{
    const s=Math.floor((Date.now()-start)/1000);
    $('timer').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  },250);
}

function startMeter(){
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  const src=ctx.createMediaStreamSource(stream);
  an=ctx.createAnalyser();an.fftSize=2048;src.connect(an);
  const d=new Uint8Array(an.fftSize);

  meter=setInterval(()=>{
    an.getByteTimeDomainData(d);
    let sum=0;
    for(const x of d){const v=(x-128)/128;sum+=v*v}
    const rms=Math.sqrt(sum/d.length);
    qs.push(rms);
    $('meterFill').style.width=Math.min(100,Math.round(rms*360))+'%';
    $('quality').textContent=rms<.018?'POOR':rms<.04?'FAIR':'GOOD';
  },100);
}

async function finishAndAutoSave(){
  clearInterval(clock);clearInterval(meter);
  try{speech?.stop()}catch(e){}
  try{await new Promise(r=>setTimeout(r,220))}catch(e){}
  try{await ctx?.close()}catch(e){}
  stream?.getTracks().forEach(t=>t.stop());

  const blob=new Blob(chunks,{type:mr.mimeType});
  const avg=qs.reduce((a,b)=>a+b,0)/Math.max(qs.length,1);

  pending={
    id:'CAP-'+Date.now(),
    capturedAt:new Date().toISOString(),
    quality:avg<.018?'POOR':avg<.04?'FAIR':'GOOD',
    transcript:(finalText+' '+interim).trim(),
    mimeType:blob.type,
    blob,
    matterId:addToMatterId||''
  };

  rec.classList.remove('rec');rec.textContent='● RECORD';
  await sendPending();
}

function toB64(b){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onloadend=()=>res(String(r.result).split(',')[1]||'');
    r.onerror=rej;
    r.readAsDataURL(b);
  });
}

async function sendPending(){
  const url=localStorage.getItem('dkb_backend_url')||$('backendUrl').value.trim();
  if(!url){statusEl.textContent='BACKEND NOT SET';return}

  const savingOverlay=$('savingOverlay');
  const savingText=$('savingText');

  // Reset any previous BLUE / GREEN / AMBER result before this new save starts.
  savingOverlay.style.background='#a9a9a9';
  if(savingText)savingText.textContent='SAVING…';
  savingOverlay.classList.remove('hidden');

  try{
    const payload={
      op:'capture',
      id:pending.id,
      capturedAt:pending.capturedAt,
      quality:pending.quality,
      transcript:pending.transcript,
      notes:'',
      mimeType:pending.mimeType,
      audioBase64:await toB64(pending.blob),
      matterId:pending.matterId||'',
      tv1BridgeUrl:localStorage.getItem('dkb_tv1_url')||$('tv1BridgeUrl').value.trim()
    };

    $('payloadField').value=JSON.stringify(payload);
    $('syncForm').action=url;
    $('syncForm').submit();

    clearTimeout(confirmTimer);
    confirmTimer=setTimeout(()=>confirmSaved(pending.id,url,1),800);
  }catch(e){
    emergencyExit();
  }
}

function confirmSaved(id,url,attempt){
  const cb='DKB_CONFIRM_'+Date.now()+'_'+attempt;
  const s=document.createElement('script');
  let done=false;
  const cleanup=()=>{try{delete window[cb]}catch(e){};try{s.remove()}catch(e){}};

  window[cb]=data=>{
    done=true;cleanup();
    if(data?.found)finishSaveSuccess(data);
    else if(attempt<10)confirmTimer=setTimeout(()=>confirmSaved(id,url,attempt+1),900);
  };

  const sep=url.includes('?')?'&':'?';
  s.src=url+sep+'check='+encodeURIComponent(id)+'&callback='+encodeURIComponent(cb)+'&t='+Date.now();
  s.async=true;
  s.onerror=()=>{if(done)return;done=true;cleanup();if(attempt<10)confirmTimer=setTimeout(()=>confirmSaved(id,url,attempt+1),900)};
  document.body.appendChild(s);
}

function finishReturnToFresh(){
  $('savingOverlay').classList.add('hidden');
  resetCaptureState();
  addToMatterId='';
  notesCache=[];
  panel('capture');
  statusEl.textContent='READY';
}

function finishSaveSuccess(data){
  clearTimeout(confirmTimer);

  const actionResult=String(
    data?.actionResult ||
    data?.result ||
    ''
  ).trim().toUpperCase();

  const msg=String(
    data?.officeResponse ||
    data?.message ||
    data?.msg ||
    data?.actionMessage ||
    'Saved'
  ).trim();

  const savingText=$('savingText');

  if(actionResult==='ACTIONED'){
    $('savingOverlay').style.background='#8fbe8f';
    if(savingText)savingText.textContent='✓ '+msg;
    setTimeout(()=>finishReturnToFresh(),3200);

  }else if(actionResult==='FOUND'){
    $('savingOverlay').style.background='#8fb5cf';
    if(savingText)savingText.textContent=msg;
    setTimeout(()=>finishReturnToFresh(),6500);

  }else if(actionResult==='NEEDS_REVIEW'){
    $('savingOverlay').style.background='#d8b56a';
    if(savingText)savingText.textContent=msg;
    setTimeout(()=>finishReturnToFresh(),6500);

  }else{
    finishReturnToFresh();
  }
}

$('savingExit').onclick=()=>emergencyExit();

function emergencyExit(){
  clearTimeout(confirmTimer);
  $('savingOverlay').classList.add('hidden');
  resetCaptureState();
  addToMatterId='';
  panel('capture');
}

$('saveSettings').onclick=()=>{
  localStorage.setItem('dkb_backend_url',$('backendUrl').value.trim());
  localStorage.setItem('dkb_tv1_url',$('tv1BridgeUrl').value.trim());
  statusEl.textContent='SETTINGS SAVED';
};
$('backendUrl').value=localStorage.getItem('dkb_backend_url')||'';
$('tv1BridgeUrl').value=localStorage.getItem('dkb_tv1_url')||'';

function openNotes(){
  notesScroll=0;
  selected.clear();
  updateDeleteBar();
  panel('notes');
  if(notesCache.length)renderNotes(notesCache);
  else loadNotes();
}

function loadNotes(){
  const url=localStorage.getItem('dkb_backend_url')||'';
  const list=$('notesList');
  list.innerHTML='<div class="card"><b>Loading notes…</b></div>';
  if(!url){list.innerHTML='<div class="card">Backend not set.</div>';return}

  jsonpList(url,data=>{
    notesCache=(data?.matters||[]).filter(m=>!['archived','deleted','completed','done'].includes(String(m.status||'').toLowerCase()));
    renderNotes(notesCache);
  },()=>{
    list.innerHTML='<div class="card"><b>Notes did not load.</b><div class="row"><button id="retryLoad" class="btn">RETRY</button></div></div>';
    setTimeout(()=>{if($('retryLoad'))$('retryLoad').onclick=loadNotes},0);
  });
}

function jsonpList(url,onOk,onFail){
  const cb='DKB_NOTES_'+Date.now()+'_'+Math.floor(Math.random()*10000);
  const s=document.createElement('script');
  let done=false;
  const cleanup=()=>{try{delete window[cb]}catch(e){};try{s.remove()}catch(e){}};

  window[cb]=data=>{done=true;cleanup();onOk(data)};
  const sep=url.includes('?')?'&':'?';
  s.src=url+sep+'listMyDay=1&callback='+encodeURIComponent(cb)+'&t='+Date.now();
  s.async=true;
  s.onerror=()=>{if(done)return;done=true;cleanup();onFail()};
  document.body.appendChild(s);
  setTimeout(()=>{if(done)return;done=true;cleanup();onFail()},10000);
}

function renderNotes(items){
  const list=$('notesList');list.innerHTML='';

  if(!items.length){
    list.innerHTML='<div class="card">No active notes.</div>';
    return;
  }

  items.forEach(m=>{
    const d=document.createElement('div');
    d.className='note';
    d.dataset.matterId=m.matterId;

    const text=(m.transcript||'').trim()||(m.hasAudio?'Audio available — no transcript':'No transcript available');
    const time=m.timeLabel||'';

    d.innerHTML=
      '<div class="noteTop">'+
      '<input class="noteCheck" type="checkbox" aria-label="Mark note for delete">'+
      '<div class="noteBody">'+
      '<div class="noteMeta">Voice note saved.'+(time?' · '+esc(time):'')+'</div>'+
      '<div class="noteText">'+esc(text)+'</div>'+
      '<div class="noteActions"><button class="btn openBtn">OPEN</button></div>'+
      '</div></div>';

    const chk=d.querySelector('.noteCheck');
    chk.checked=selected.has(m.matterId);
    chk.onchange=()=>{if(chk.checked)selected.add(m.matterId);else selected.delete(m.matterId);updateDeleteBar()};

    d.querySelector('.openBtn').onclick=()=>{
      openedMatter=m;
      notesScroll=window.scrollY;
      openMatter(m);
    };

    list.appendChild(d);
  });
}

function updateDeleteBar(){
  $('selectedCount').textContent=String(selected.size);
  $('deleteBar').classList.toggle('hidden',selected.size===0);
}

$('clearMarked').onclick=()=>{
  selected.clear();
  updateDeleteBar();
  document.querySelectorAll('.noteCheck').forEach(x=>x.checked=false);
};

$('deleteMarked').onclick=()=>{
  if(!selected.size)return;
  const ids=[...selected];
  const url=localStorage.getItem('dkb_backend_url')||'';

  $('payloadField').value=JSON.stringify({op:'archiveMatters',matterIds:ids});
  $('syncForm').action=url;
  $('syncForm').submit();

  notesCache=notesCache.filter(m=>!selected.has(m.matterId));
  selected.clear();
  updateDeleteBar();
  renderNotes(notesCache);
};

function b64ToObjectUrl(b64,mime){
  const bin=atob(b64);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes],{type:mime||'audio/webm'}));
}

function loadAudioJsonp(audioId,onOk,onFail){
  const backend=localStorage.getItem('dkb_backend_url')||'';
  if(!backend||!audioId){onFail();return}

  const cb='DKB_AUDIO_'+Date.now()+'_'+Math.floor(Math.random()*10000);
  const s=document.createElement('script');
  let done=false;
  const cleanup=()=>{try{delete window[cb]}catch(e){};try{s.remove()}catch(e){}};

  window[cb]=data=>{
    done=true;
    cleanup();
    if(data?.ok&&data.b64)onOk(data);
    else onFail();
  };

  const sep=backend.includes('?')?'&':'?';
  s.src=backend+sep+'audioId='+encodeURIComponent(audioId)+'&callback='+encodeURIComponent(cb)+'&t='+Date.now();
  s.async=true;
  s.onerror=()=>{if(done)return;done=true;cleanup();onFail()};
  document.body.appendChild(s);

  setTimeout(()=>{
    if(done)return;
    done=true;
    cleanup();
    onFail();
  },15000);
}

function openMatter(m){
  panel('open');
  $('openMeta').textContent='Voice note saved.'+(m.timeLabel?' · '+m.timeLabel:'');
  $('openText').textContent=(m.transcript||'').trim()||(m.hasAudio?'Audio available — no transcript':'No transcript available');

  const a=$('openAudio');
  try{a.pause()}catch(e){}

  if(currentAudioObjectUrl){
    try{URL.revokeObjectURL(currentAudioObjectUrl)}catch(e){}
    currentAudioObjectUrl='';
  }

  a.removeAttribute('src');
  a.load();

  if(m.audioId){
    a.classList.add('hidden');
    $('openNoAudio').classList.remove('hidden');
    $('openNoAudio').textContent='Loading audio…';

    loadAudioJsonp(
      m.audioId,
      data=>{
        try{
          currentAudioObjectUrl=b64ToObjectUrl(data.b64,data.mimeType);
          a.src=currentAudioObjectUrl;
          a.load();
          a.classList.remove('hidden');
          $('openNoAudio').classList.add('hidden');
        }catch(e){
          a.classList.add('hidden');
          $('openNoAudio').classList.remove('hidden');
          $('openNoAudio').textContent='Audio could not load.';
        }
      },
      ()=>{
        a.classList.add('hidden');
        $('openNoAudio').classList.remove('hidden');
        $('openNoAudio').textContent='Audio could not load.';
      }
    );

  }else{
    a.classList.add('hidden');
    $('openNoAudio').classList.remove('hidden');
    $('openNoAudio').textContent='Audio unavailable.';
  }
}

$('audioStop').onclick=()=>{
  const a=$('openAudio');
  try{a.pause();a.currentTime=0}catch(e){}
};

$('backToNotes').onclick=()=>{
  const id=openedMatter?.matterId||'';
  const a=$('openAudio');
  try{a.pause()}catch(e){}
  panel('notes');
  renderNotes(notesCache);

  requestAnimationFrame(()=>{
    window.scrollTo(0,notesScroll);
    if(id){
      const el=[...document.querySelectorAll('.note')].find(x=>x.dataset.matterId===id);
      if(el){
        el.classList.add('just-opened');
        setTimeout(()=>el.classList.remove('just-opened'),5000);
      }
    }
  });
};

$('addToNote').onclick=()=>{
  const a=$('openAudio');try{a.pause()}catch(e){}
  addToMatterId=openedMatter?.matterId||'';
  resetCaptureState();
  panel('capture');
  window.scrollTo(0,0);
};

function esc(s){
  return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

window.addEventListener('beforeunload',e=>{
  if(!$('savingOverlay').classList.contains('hidden')){
    e.preventDefault();e.returnValue='';
  }
});

showFreshCapture();

if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
