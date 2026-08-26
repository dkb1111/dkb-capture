const $=id=>document.getElementById(id);
let mr,stream,chunks=[],blob,ctx,an,meter,clock,start,qs=[],speech,finalText='',interim='';
let currentMatterId='',pendingCapture=null,saving=false,confirmTimer=null;
let selectedMatters=new Set();
const rec=$('recordBtn'),statusEl=$('status'),player=$('player');
const DB_NAME='DKB_CAPTURE_DB_V036',STORE='pending';

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function putPending(c){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(c);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
async function deletePending(id){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}

$('captureTab').onclick=()=>panel('capture');
$('notesTab').onclick=()=>{if(!saving){panel('notes');loadNotes()}};
function panel(x){$('capturePanel').classList.toggle('on',x==='capture');$('notesPanel').classList.toggle('on',x==='notes');$('captureTab').classList.toggle('active',x==='capture');$('notesTab').classList.toggle('active',x==='notes')}
function setLocked(on){saving=on;['notesTab','captureTab','recordBtn','saveActionBtn','discardBeforeSaveBtn','refreshNotes'].forEach(id=>{if($(id))$(id).disabled=on})}

rec.onclick=async()=>{if(mr&&mr.state==='recording')mr.stop();else if(!saving)await startRec()};

async function startRec(){
  clearForNext();
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{noiseSuppression:true,echoCancellation:true,autoGainControl:true}});
    const mime=MediaRecorder.isTypeSupported('audio/mp4')?'audio/mp4':MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';
    mr=new MediaRecorder(stream,{mimeType:mime});chunks=[];qs=[];finalText='';interim='';$('heardEdit').value='';
    mr.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};mr.onstop=finishRecording;mr.start(250);
    startSpeech();startMeter();startClock();
    rec.classList.add('rec');rec.textContent='■ RECORDING — TAP TO STOP';statusEl.textContent='RECORDING';
  }catch(e){statusEl.textContent='MICROPHONE BLOCKED'}
}

function startSpeech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return;
  try{
    speech=new SR();speech.continuous=true;speech.interimResults=true;speech.lang='en-AU';
    speech.onresult=e=>{interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)finalText+=(finalText?' ':'')+t;else interim+=t}$('heardEdit').value=(finalText+' '+interim).trim()};
    speech.start();
  }catch(e){}
}

function startClock(){start=Date.now();clock=setInterval(()=>{const s=Math.floor((Date.now()-start)/1000);$('timer').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')},250)}
function startMeter(){ctx=new (window.AudioContext||window.webkitAudioContext)();const src=ctx.createMediaStreamSource(stream);an=ctx.createAnalyser();an.fftSize=2048;src.connect(an);const d=new Uint8Array(an.fftSize);meter=setInterval(()=>{an.getByteTimeDomainData(d);let sum=0;for(const x of d){const v=(x-128)/128;sum+=v*v}const rms=Math.sqrt(sum/d.length);qs.push(rms);$('meterFill').style.width=Math.min(100,Math.round(rms*360))+'%';$('quality').textContent=rms<.018?'POOR':rms<.04?'FAIR':'GOOD'},100)}

async function finishRecording(){
  clearInterval(clock);clearInterval(meter);try{speech?.stop()}catch(e){}try{await ctx?.close()}catch(e){}stream?.getTracks().forEach(t=>t.stop());
  blob=new Blob(chunks,{type:mr.mimeType});player.src=URL.createObjectURL(blob);
  rec.classList.remove('rec');rec.textContent='● RECORD';
  const avg=qs.reduce((a,b)=>a+b,0)/Math.max(qs.length,1);
  pendingCapture={id:'CAP-'+Date.now(),createdAt:new Date().toISOString(),quality:avg<.018?'POOR':avg<.04?'FAIR':'GOOD',transcript:(finalText||$('heardEdit').value||'').trim(),notes:'',mimeType:blob.type,blob,matterId:currentMatterId||'',status:'REVIEW'};
  $('heardEdit').value=pendingCapture.transcript;await putPending(pendingCapture);
  $('reviewCard').classList.remove('hidden');$('afterCard').classList.remove('hidden');$('failureCard').classList.add('hidden');$('savingCard').classList.add('hidden');
  $('officeResponse').textContent='Review the transcript, edit if needed, then press SAVE / ACTION.';statusEl.textContent='READY TO SAVE';
}

$('saveActionBtn').onclick=async()=>{if(!pendingCapture||saving)return;pendingCapture.transcript=$('heardEdit').value.trim();pendingCapture.notes=$('note').value.trim();pendingCapture.status='PENDING_SYNC';await putPending(pendingCapture);await sendPending()};
$('discardBeforeSaveBtn').onclick=async()=>{if(pendingCapture){await deletePending(pendingCapture.id);pendingCapture=null}clearReview();statusEl.textContent='DELETED'};
$('retryBtn').onclick=()=>{if(pendingCapture&&!saving)sendPending()};
$('editBtn').onclick=()=>{$('failureCard').classList.add('hidden');$('reviewCard').classList.remove('hidden');statusEl.textContent='EDIT BEFORE RETRY'};
$('deletePendingBtn').onclick=async()=>{if(pendingCapture){await deletePending(pendingCapture.id);pendingCapture=null}clearReview();statusEl.textContent='DELETED'};
$('replayBtn').onclick=()=>player.play();

function clearReview(){['reviewCard','savingCard','failureCard','afterCard'].forEach(id=>$(id).classList.add('hidden'));$('heardEdit').value='';$('note').value='';$('officeResponse').textContent='';$('timer').textContent='00:00';$('meterFill').style.width='0%';$('quality').textContent='READY'}
function clearForNext(){if(!saving){$('failureCard').classList.add('hidden');$('savingCard').classList.add('hidden')}}
function b64(b){return new Promise((res,rej)=>{const r=new FileReader();r.onloadend=()=>res(String(r.result).split(',')[1]||'');r.onerror=rej;r.readAsDataURL(b)})}

async function sendPending(){
  const url=localStorage.getItem('dkb_backend_url')||$('backendUrl').value.trim();if(!url){statusEl.textContent='BACKEND NOT SET';return}
  try{
    setLocked(true);$('savingCard').classList.remove('hidden');$('failureCard').classList.add('hidden');$('reviewCard').classList.add('hidden');$('savingMessage').textContent='SAVING — DO NOT CLOSE YET';statusEl.textContent='SAVING';
    const payload={op:'capture',id:pendingCapture.id,capturedAt:pendingCapture.createdAt,quality:pendingCapture.quality,transcript:pendingCapture.transcript,notes:pendingCapture.notes||'',mimeType:pendingCapture.mimeType,audioBase64:await b64(pendingCapture.blob),matterId:pendingCapture.matterId||'',tv1BridgeUrl:localStorage.getItem('dkb_tv1_url')||$('tv1BridgeUrl').value.trim()};
    $('payloadField').value=JSON.stringify(payload);$('syncForm').action=url;$('syncForm').submit();
    statusEl.textContent='SENT — CHECKING';$('savingMessage').textContent='SENT — CHECKING';
    clearTimeout(confirmTimer);confirmTimer=setTimeout(()=>confirmCapture(pendingCapture.id,url,1),1200);
  }catch(e){failConfirm()}
}

function confirmCapture(id,url,attempt){
  const cb='DKB_CONFIRM_'+Date.now()+'_'+Math.floor(Math.random()*10000),script=document.createElement('script');let done=false;
  const cleanup=()=>{try{delete window[cb]}catch(e){};try{script.remove()}catch(e){}};
  window[cb]=async data=>{done=true;if(data?.found){cleanup();await confirmedSaved(id);return}cleanup();attempt<8?confirmTimer=setTimeout(()=>confirmCapture(id,url,attempt+1),1200):failConfirm()};
  const sep=url.includes('?')?'&':'?';script.src=url+sep+'check='+encodeURIComponent(id)+'&callback='+encodeURIComponent(cb)+'&t='+Date.now();script.async=true;
  script.onerror=()=>{if(done)return;done=true;cleanup();attempt<8?confirmTimer=setTimeout(()=>confirmCapture(id,url,attempt+1),1200):failConfirm()};
  document.body.appendChild(script);
  setTimeout(()=>{if(done)return;done=true;cleanup();attempt<8?confirmTimer=setTimeout(()=>confirmCapture(id,url,attempt+1),1200):failConfirm()},3500);
}

async function confirmedSaved(id){await deletePending(id);statusEl.textContent='✓ SAVED TO NOTES';$('savingMessage').textContent='✓ SAVED TO NOTES';$('officeResponse').textContent='Saved successfully. Open NOTES to see the item.';pendingCapture=null;currentMatterId='';setLocked(false);setTimeout(()=>$('savingCard').classList.add('hidden'),1800)}
function failConfirm(){clearTimeout(confirmTimer);setLocked(false);statusEl.textContent='NOT CONFIRMED';$('savingCard').classList.add('hidden');$('failureCard').classList.remove('hidden');$('reviewCard').classList.add('hidden')}

$('saveSettings').onclick=()=>{localStorage.setItem('dkb_backend_url',$('backendUrl').value.trim());localStorage.setItem('dkb_tv1_url',$('tv1BridgeUrl').value.trim());statusEl.textContent='SETTINGS SAVED'};
$('backendUrl').value=localStorage.getItem('dkb_backend_url')||'';$('tv1BridgeUrl').value=localStorage.getItem('dkb_tv1_url')||'';

$('refreshNotes').onclick=loadNotes;
$('clearSelectionBtn').onclick=()=>{selectedMatters.clear();updateSelectionBar();document.querySelectorAll('.noteCheck').forEach(x=>x.checked=false);document.querySelectorAll('.matter').forEach(x=>x.classList.remove('selected'))};
$('archiveSelectedBtn').onclick=archiveSelected;

function loadNotes(){
  if(saving)return;selectedMatters.clear();updateSelectionBar();
  const url=localStorage.getItem('dkb_backend_url')||'',list=$('notesList');list.innerHTML='<div class="card">Loading…</div>';
  if(!url){list.innerHTML='<div class="card">Backend not set.</div>';return}
  const cb='DKB_NOTES_'+Date.now(),script=document.createElement('script');let done=false;
  const cleanup=()=>{try{delete window[cb]}catch(e){};try{script.remove()}catch(e){}};
  window[cb]=data=>{done=true;renderNotes(data?.matters||[]);cleanup()};
  const sep=url.includes('?')?'&':'?';script.src=url+sep+'listMyDay=1&callback='+encodeURIComponent(cb)+'&t='+Date.now();script.async=true;
  script.onerror=()=>{if(done)return;done=true;list.innerHTML='<div class="card">NOTES connection error.</div>';cleanup()};
  document.body.appendChild(script);
  setTimeout(()=>{if(done)return;done=true;list.innerHTML='<div class="card">NOTES did not respond.</div>';cleanup()},10000);
}

function renderNotes(matters){
  const list=$('notesList');list.innerHTML='';
  const active=matters.filter(m=>!['archived','deleted','completed','done'].includes(String(m.status||'').toLowerCase()));
  if(!active.length){list.innerHTML='<div class="card">No active notes.</div>';return}
  active.forEach(m=>{
    const d=document.createElement('div');d.className='matter';
    const visibleText=(m.latest&&String(m.latest).trim())||(m.understood&&String(m.understood).trim())||(m.title&&String(m.title).trim())||'Voice recording — transcript unavailable';
    const title=(m.title&&String(m.title).trim()&&m.title!=='Voice note')?m.title:visibleText.slice(0,80);
    d.innerHTML='<div class="noteTop"><input class="noteCheck" type="checkbox" aria-label="Mark note for delete"><div class="noteBody"><div class="noteTitle">'+esc(title)+'</div><div class="noteStatus">'+esc(m.status||'Active')+'</div><div class="noteText">'+esc(visibleText)+'</div><div class="response">'+esc(m.officeResponse||'')+'</div><div class="row"><button class="btn updateBtn">🎤 UPDATE</button></div></div></div>';
    const cb=d.querySelector('.noteCheck');
    cb.onchange=()=>{if(cb.checked){selectedMatters.add(m.matterId);d.classList.add('selected')}else{selectedMatters.delete(m.matterId);d.classList.remove('selected')}updateSelectionBar()};
    d.querySelector('.updateBtn').onclick=()=>{currentMatterId=m.matterId;panel('capture');$('officeResponse').textContent='Updating '+title};
    list.appendChild(d);
  });
}

function updateSelectionBar(){const n=selectedMatters.size;$('selectedCount').textContent=String(n);$('archiveBar').classList.toggle('hidden',n===0)}

function archiveSelected(){
  if(!selectedMatters.size||saving)return;
  const url=localStorage.getItem('dkb_backend_url')||'';if(!url)return;
  const ids=[...selectedMatters];setLocked(true);
  $('notesList').insertAdjacentHTML('afterbegin','<div id="archiveProgress" class="card"><b>REMOVING MARKED NOTES…</b></div>');
  $('payloadField').value=JSON.stringify({op:'archiveMatters',matterIds:ids});$('syncForm').action=url;$('syncForm').submit();
  pollArchive(ids,url,1);
}

function pollArchive(ids,url,attempt){
  const cb='DKB_ARCHIVE_CHECK_'+Date.now()+'_'+attempt,script=document.createElement('script');let done=false;
  const cleanup=()=>{try{delete window[cb]}catch(e){};try{script.remove()}catch(e){}};
  window[cb]=data=>{done=true;cleanup();const remaining=new Set((data?.matters||[]).map(m=>m.matterId));const stillThere=ids.some(id=>remaining.has(id)&&!['archived','deleted','completed','done'].includes(String((data.matters.find(x=>x.matterId===id)||{}).status||'').toLowerCase()));if(!stillThere){setLocked(false);selectedMatters.clear();updateSelectionBar();loadNotes();return}if(attempt<8)setTimeout(()=>pollArchive(ids,url,attempt+1),1000);else{setLocked(false);const p=$('archiveProgress');if(p)p.innerHTML='<b>NOT CONFIRMED — press REFRESH NOTES and check the marked items.</b>'}};
  const sep=url.includes('?')?'&':'?';script.src=url+sep+'listMyDay=1&callback='+encodeURIComponent(cb)+'&t='+Date.now();script.async=true;
  script.onerror=()=>{if(done)return;done=true;cleanup();if(attempt<8)setTimeout(()=>pollArchive(ids,url,attempt+1),1000);else setLocked(false)};
  document.body.appendChild(script);
  setTimeout(()=>{if(done)return;done=true;cleanup();if(attempt<8)setTimeout(()=>pollArchive(ids,url,attempt+1),1000);else setLocked(false)},3000);
}

function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
window.addEventListener('beforeunload',e=>{if(saving){e.preventDefault();e.returnValue=''}});
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
