// =============================================================
// 🔄 LIVE SYNC — مزامنة فورية + تنبيهات بين الأجهزة (بدون تحديث الصفحة)
// =============================================================
(function(){
if (window.__liveSyncLoaded) return; window.__liveSyncLoaded = true;

const SYNC_NAME = 'ميزانيتك_الذكية_مزامنة.json';
const POLL_MS = 10000; // فحص كل 10 ثوانٍ
let deviceId = localStorage.getItem('deviceId');
if (!deviceId) { deviceId = 'dev-' + Date.now() + '-' + Math.random().toString(36).substr(2,6); localStorage.setItem('deviceId', deviceId); }
let autoSync = localStorage.getItem('autoSyncEnabled') !== 'false';
let lastPushedChangeId = null;      // آخر تغيير محلي تم رفعه
let lastRemoteChangeId = null;      // آخر تغيير بعيد تم تطبيقه/رؤيته
let polling = null;

// ---------- أدوات ----------
function newestChange(){ return (db.bal && db.bal.changes && db.bal.changes[0]) || null; }
function liveData(){
  const lc = newestChange();
  return { dev: deviceId, t: Date.now(), lastChangeId: lc ? lc.id : null, lastChange: lc,
    data: { exp: db.exp, rig: db.rig, deb: db.deb, bal: db.bal, inc: db.inc, currency: currentCurrency } };
}
async function liveFind(){
  if (!isDriveConnected || !accessToken) return null;
  const q = encodeURIComponent("name='" + SYNC_NAME + "' and trashed=false");
  const r = await fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,modifiedTime)', { headers: { 'Authorization': 'Bearer ' + accessToken } });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.files && j.files[0]) || null;
}
function fmtLast(){ const el=document.getElementById('lastSyncLine'); if(!el)return;
  if (lastRemoteChangeId || lastPushedChangeId){ const d=new Date(); el.textContent='آخر تحديث: '+d.toLocaleString('ar',{hour:'numeric',minute:'2-digit',day:'numeric',month:'short'}); }
  else el.textContent='آخر تحديث: —'; }
function markSynced(){ lastPushedChangeId = (newestChange()||{}).id || null; fmtLast(); }

// ---------- رفع ----------
async function pushSync(){
  if (!autoSync || !isDriveConnected || !accessToken) return;
  try{
    const f = await liveFind(); const body = JSON.stringify(liveData());
    if (f){ await fetch('https://www.googleapis.com/upload/drive/v3/files/'+f.id+'?uploadType=media',{method:'PATCH',headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json'},body}); }
    else { const form=new FormData(); form.append('metadata',new Blob([JSON.stringify({name:SYNC_NAME,mimeType:'application/json'})],{type:'application/json'})); form.append('file',new Blob([body],{type:'application/json'})); await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{method:'POST',headers:{'Authorization':'Bearer '+accessToken},body:form}); }
    markSynced();
  }catch(e){ console.log('pushSync:', e); }
}

// ---------- تطبيق بعيد ----------
async function applyRemote(file){
  await new Promise(res=>{ const tx=IDB_connection.transaction(STORE_NAMES,'readwrite'); let d=0;
    STORE_NAMES.forEach(sn=>{ const r=tx.objectStore(sn).clear(); r.onsuccess=()=>{ d++; if(d===STORE_NAMES.length) res(); }; }); });
  const im = file.data;
  if (im.bal && im.bal.changes){ im.bal.clientId=1; await addDataToStore('bal',[im.bal]); }
  for (const sn of ['exp','rig','deb','inc']) if (im[sn]) await addDataToStore(sn, im[sn]);
  if (im.currency){ currentCurrency = im.currency; localStorage.setItem('currencyCode', currentCurrency.code); }
  await loadAllData(); updateStats(); updateBalanceDisplay();
  lastRemoteChangeId = file.lastChangeId; lastPushedChangeId = file.lastChangeId;
}

// ---------- تنبيه بتفاصيل الإجراء ----------
function notifyAction(file){
  const lc = file.lastChange;
  if (!lc) { toastMsg('🔄 تحديث جديد من جهاز آخر','info'); return; }
  const amt = (lc.القيمة_الصافية < 0 ? '-' : '+') + (Math.abs(lc.المبلغ||0)).toLocaleString('en-US') + ' ' + currentCurrency.symbol;
  toastMsg('🔄 جهاز آخر: ' + lc.النوع + ' (' + amt + ')', 'info');
}

// ---------- نافذة تعارض ----------
function showConflict(file){
  let m = document.getElementById('syncConflictModal');
  if (!m){
    m = document.createElement('div'); m.id='syncConflictModal'; m.className='modal';
    m.innerHTML = '<header><button onclick="closeLayer(\'syncConflict\')"><i class="fas fa-times"></i></button><div class="title">⚠️ تعارض بين جهازين</div></header>' +
      '<div class="modal-content"><p id="syncConflictMsg" style="line-height:1.8;"></p>' +
      '<button class="action" id="scRemote">☁️ اعتماد بيانات الجهاز الآخر</button>' +
      '<button class="secondary" id="scLocal">📱 الإبقاء على بياناتي ورفعها</button></div>';
    document.body.appendChild(m);
    if (!window.LAYERS['syncConflict']) window.LAYERS['syncConflict'] = { elementId:'syncConflictModal', type:'modal' };
  }
  const lc = file.lastChange;
  const amt = lc ? ((lc.القيمة_الصافية<0?'-':'+') + Math.abs(lc.المبلغ||0).toLocaleString('en-US') + ' ' + currentCurrency.symbol) : '';
  document.getElementById('syncConflictMsg').textContent = 'وصل إجراء جديد من جهاز آخر: ' + (lc ? lc.النوع + ' ('+amt+')' : 'تحديث') + '، ولديك تغييرات محلية غير مرفوعة. اختر الإجراء:';
  document.getElementById('scRemote').onclick = async function(){ await applyRemote(file); closeLayer('syncConflict'); toastMsg('✅ تم اعتماد بيانات الجهاز الآخر','success'); pushSync(); };
  document.getElementById('scLocal').onclick = async function(){ closeLayer('syncConflict'); await pushSync(); toastMsg('✅ تم رفع بياناتك','success'); };
  openLayer('syncConflict');
}

// ---------- الفحص الدوري ----------
async function pullSync(){
  if (!autoSync || !isDriveConnected || !accessToken) return;
  try{
    const f = await liveFind(); if (!f) return;
    const r = await fetch('https://www.googleapis.com/drive/v3/files/'+f.id+'?alt=media', { headers: { 'Authorization':'Bearer '+accessToken } });
    if (!r.ok) return;
    const file = JSON.parse(await r.text());
    const localNew = (newestChange()||{}).id !== lastPushedChangeId;      // عندي تغيير لم أرفعه
    const remoteNew = file.lastChangeId && file.lastChangeId !== lastRemoteChangeId; // وصل تغيير جديد
    if (file.dev !== deviceId && remoteNew){
      if (localNew) { showConflict(file); return; }        // تعارض
      await applyRemote(file);                              // تطبيق + تحديث بدون تحديث الصفحة
      notifyAction(file);
    } else if (localNew) {
      await pushSync();                                     // ارفع تغييراتي فقط
    } else {
      lastRemoteChangeId = file.lastChangeId || lastRemoteChangeId; fmtLast();
    }
  }catch(e){ console.log('pullSync:', e); }
}

// ---------- حقن واجهة ----------
function injectUI(){
  const driveBtn = document.getElementById('driveMenuItem'); if (!driveBtn) return;
  if (!document.getElementById('autoSyncToggle')){
    const row=document.createElement('div'); row.className='sidebar-switch-item';
    row.innerHTML='<i class="fas fa-sync-alt"></i><span>المزامنة التلقائية</span><label class="switch"><input type="checkbox" id="autoSyncToggle"><span class="slider"></span></label>';
    driveBtn.insertAdjacentElement('afterend', row);
    const line=document.createElement('div'); line.id='lastSyncLine'; line.style.cssText='padding:0 20px 10px;font-size:0.8em;color:#888;';
    row.insertAdjacentElement('afterend', line);
    const t=row.querySelector('#autoSyncToggle'); t.checked=autoSync;
    t.onchange=function(){ autoSync=t.checked; localStorage.setItem('autoSyncEnabled', t.checked?'true':'false'); if(t.checked&&isDriveConnected) pushSync(); toastMsg(t.checked?'🔄 تم تفعيل المزامنة':'⏸️ تم إيقاف المزامنة','info'); };
  }
  fmtLast();
}

// ---------- بدء ----------
function start(){
  injectUI();
  // عند أول تحميل: خذ الحالة الحالية بدون تطبيق/تعارض
  (async()=>{ const f=await liveFind(); if(f){ try{ const r=await fetch('https://www.googleapis.com/drive/v3/files/'+f.id+'?alt=media',{headers:{'Authorization':'Bearer '+accessToken}}); if(r.ok){ const file=JSON.parse(await r.text()); lastRemoteChangeId=file.lastChangeId; } }catch(e){} } lastPushedChangeId=(newestChange()||{}).id||null; })();
  if (polling) clearInterval(polling);
  polling = setInterval(pullSync, POLL_MS);
}
const _udui = window.updateDriveUI;
window.updateDriveUI = function(){ _udui(); injectUI(); if (isDriveConnected && !polling) start(); };
setTimeout(start, 1500);
})();
