const $=id=>document.getElementById(id);
const recBtn=$('recordBtn'), timer=$('timer'), meterFill=$('meterFill'),
quality=$('quality'), qualityNote=$('qualityNote'), statusEl=$('status'),
afterCard=$('afterCard'), player=$('player'), note=$('note'), heard=$('heard'),
sttSupport=$('sttSupport'), backendUrl=$('backendUrl'), syncForm=$('syncForm'),
payloadField=$('payloadField');

let stream=null,mr=null,chunks=[],blob=null,objectUrl=null;
let ctx=null,analyser=null,meterTimer=null,clockTimer=null,startAt=0;
let qualitySamples=[],currentCapture=null,confirmationTimer=null;
let recognition=null,recognitionActive=false,finalTranscript='';

const DB_NAME='DKB_CAPTURE_DB', STORE='captures';

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(STORE)){
        req.result.createObjectStore(STORE,{keyPath:'id'});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function putCapture(c){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(c);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
async function deleteCapture(id){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
async function getPending(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess=()=>resolve(req.result.filter(x=>x.status!=='Synced'));
    req.onerror=()=>reject(req.error);
  });
}

function setupSpeechRecognition(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    sttSupport.textContent='(automatic transcription not available on this browser — audio is still saved)';
    return;
  }
  sttSupport.textContent='(automatic transcription available)';
  recognition=new SR();
  recognition.lang='en-AU';
  recognition.continuous=true;
  recognition.interimResults=true;

  recognition.onresult=e=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const text=e.results[i][0].transcript;
      if(e.results[i].isFinal){
        finalTranscript+=(finalTranscript?' ':'')+text.trim();
      }else{
        interim+=text;
      }
    }
    heard.value=(finalTranscript+(interim?' '+interim:'')).trim();
  };
  recognition.onerror=e=>{
    if(e.error!=='no-speech' && e.error!=='aborted'){
      sttSupport.textContent='(transcription issue: '+e.error+' — audio is still safe)';
    }
  };
  recognition.onend=()=>{
    recognitionActive=false;
    if(mr&&mr.state==='recording'){
      try{recognition.start();recognitionActive=true}catch(e){}
    }
  };
}
setupSpeechRecognition();

recBtn.onclick=async()=>{
  if(mr&&mr.state==='recording')stopRecording();
  else await startRecording();
};

async function startRecording(){
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone recording is not supported here.');

    stream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
    });

    const mime=MediaRecorder.isTypeSupported('audio/mp4')?'audio/mp4'
      :MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus'
      :'audio/webm';

    mr=new MediaRecorder(stream,{mimeType:mime});
    chunks=[];qualitySamples=[];blob=null;finalTranscript='';heard.value='';

    mr.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
    mr.onstop=finishRecording;
    mr.start(250);

    if(recognition){
      try{recognition.start();recognitionActive=true}catch(e){}
    }

    recBtn.classList.add('on');
    recBtn.textContent='■ RECORDING — TAP TO STOP';
    statusEl.textContent='RECORDING';
    startAt=Date.now();
    clockTimer=setInterval(updateClock,250);
    startMeter(stream);

  }catch(err){
    quality.textContent='MIC ERROR';
    qualityNote.textContent=err.message||String(err);
    statusEl.textContent='MICROPHONE BLOCKED';
  }
}

function stopRecording(){
  if(mr?.state==='recording')mr.stop();
  if(recognition&&recognitionActive){
    try{recognition.stop()}catch(e){}
  }
}

function updateClock(){
  const s=Math.floor((Date.now()-startAt)/1000);
  timer.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}

function startMeter(s){
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  const src=ctx.createMediaStreamSource(s);
  analyser=ctx.createAnalyser();analyser.fftSize=2048;src.connect(analyser);
  const data=new Uint8Array(analyser.fftSize);

  meterTimer=setInterval(()=>{
    analyser.getByteTimeDomainData(data);
    let sum=0,peak=0;
    for(const x of data){
      const v=(x-128)/128;sum+=v*v;peak=Math.max(peak,Math.abs(v));
    }
    const rms=Math.sqrt(sum/data.length);
    qualitySamples.push({rms,peak});
    meterFill.style.width=Math.min(100,Math.round(rms*360))+'%';

    if(peak>.98){quality.textContent='POOR';qualityNote.textContent='Too loud/clipping.'}
    else if(rms<.018){quality.textContent='POOR';qualityNote.textContent='Too quiet.'}
    else if(rms<.04){quality.textContent='FAIR';qualityNote.textContent='Understandable, but a little quiet.'}
    else{quality.textContent='GOOD';qualityNote.textContent='Voice level looks good.'}
  },100);
}

function finalQuality(){
  if(!qualitySamples.length)return'UNKNOWN';
  const avg=qualitySamples.reduce((a,b)=>a+b.rms,0)/qualitySamples.length;
  const clipped=qualitySamples.filter(x=>x.peak>.98).length/qualitySamples.length;
  if(clipped>.08||avg<.015)return'POOR';
  if(avg<.035)return'FAIR';
  return'GOOD';
}

async function finishRecording(){
  clearInterval(clockTimer);clearInterval(meterTimer);
  try{await ctx?.close()}catch(e){}
  stream?.getTracks().forEach(t=>t.stop());

  blob=new Blob(chunks,{type:mr.mimeType});
  if(objectUrl)URL.revokeObjectURL(objectUrl);
  objectUrl=URL.createObjectURL(blob);player.src=objectUrl;

  recBtn.classList.remove('on');recBtn.textContent='● RECORD';

  const id='CAP-'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+Math.floor(Math.random()*900+100);

  currentCapture={
    id,
    createdAt:new Date().toISOString(),
    quality:finalQuality(),
    transcript:heard.value.trim(),
    note:note.value||'',
    mimeType:blob.type,
    blob,
    status:'Saved on device'
  };

  await putCapture(currentCapture);

  quality.textContent=currentCapture.quality;
  qualityNote.textContent=currentCapture.transcript
    ? 'Recording and transcript stored safely on this device.'
    : 'Recording stored safely. Transcript can be typed/corrected above.';
  statusEl.textContent=navigator.onLine?'SAVED — SYNCING':'SAVED ON DEVICE — WAITING FOR INTERNET';
  afterCard.classList.remove('hidden');

  if(navigator.onLine)await syncCapture(currentCapture);
}

$('replayBtn').onclick=()=>player.play();

$('deleteBtn').onclick=async()=>{
  if(!currentCapture)return;
  clearTimeout(confirmationTimer);
  await deleteCapture(currentCapture.id);
  currentCapture=null;blob=null;player.removeAttribute('src');
  afterCard.classList.add('hidden');statusEl.textContent='DELETED';
  note.value='';heard.value='';timer.textContent='00:00';meterFill.style.width='0%';
  quality.textContent='READY';qualityNote.textContent='Ready for the next capture.';
};

$('syncBtn').onclick=async()=>{
  if(currentCapture){
    currentCapture.transcript=heard.value.trim();
    currentCapture.note=note.value||'';
    await putCapture(currentCapture);
    await syncCapture(currentCapture);
  }
};

function blobToBase64(b){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onloadend=()=>resolve(String(r.result).split(',')[1]||'');
    r.onerror=reject;r.readAsDataURL(b);
  });
}

async function syncCapture(c){
  const url=localStorage.getItem('dkb_backend_url')||backendUrl.value.trim();
  if(!url){statusEl.textContent='SAVED ON DEVICE — BACKEND NOT SET';return}

  try{
    clearTimeout(confirmationTimer);
    statusEl.textContent='SYNCING...';

    payloadField.value=JSON.stringify({
      id:c.id,
      capturedAt:c.createdAt,
      quality:c.quality,
      transcript:c.transcript||heard.value.trim(),
      notes:c.note||note.value||'',
      mimeType:c.mimeType,
      audioBase64:await blobToBase64(c.blob)
    });

    syncForm.action=url;syncForm.submit();
    statusEl.textContent='SENT — CHECKING...';
    confirmationTimer=setTimeout(()=>checkConfirmation(c.id,1),1200);
  }catch(e){
    statusEl.textContent='SAVED ON DEVICE — SYNC FAILED';
  }
}

function checkConfirmation(captureId,attempt){
  const url=localStorage.getItem('dkb_backend_url')||backendUrl.value.trim();
  if(!url)return;

  const callback='DKB_CONFIRM_'+Date.now()+'_'+Math.floor(Math.random()*10000);
  const script=document.createElement('script');
  let cleaned=false;

  const cleanup=()=>{
    if(cleaned)return;cleaned=true;
    try{delete window[callback]}catch(e){}
    try{script.remove()}catch(e){}
  };

  window[callback]=async result=>{
    if(result?.ok&&result?.found){
      statusEl.textContent='✓ SAVED & SYNCED';
      if(currentCapture&&currentCapture.id===captureId){
        currentCapture.status='Synced';await putCapture(currentCapture);
      }
      cleanup();
    }else{
      cleanup();
      if(attempt<8)confirmationTimer=setTimeout(()=>checkConfirmation(captureId,attempt+1),1200);
      else statusEl.textContent='SENT — NOT YET CONFIRMED';
    }
  };

  const sep=url.includes('?')?'&':'?';
  script.src=url+sep+'check='+encodeURIComponent(captureId)+'&callback='+encodeURIComponent(callback)+'&t='+Date.now();
  script.async=true;document.body.appendChild(script);

  setTimeout(()=>{
    if(!cleaned){
      cleanup();
      if(attempt<8)confirmationTimer=setTimeout(()=>checkConfirmation(captureId,attempt+1),1200);
      else statusEl.textContent='SENT — NOT YET CONFIRMED';
    }
  },4000);
}

window.addEventListener('online',async()=>{
  const pending=await getPending();
  if(pending.length)await syncCapture(pending[0]);
});

$('saveSettings').onclick=()=>{
  localStorage.setItem('dkb_backend_url',backendUrl.value.trim());
  statusEl.textContent='SETTINGS SAVED';
};
backendUrl.value=localStorage.getItem('dkb_backend_url')||'';

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
