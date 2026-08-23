// =============================================================
// 🔴 LIVE SYNC — مزامنة حيّة + مفتاح تشغيل + آخر تحديث
// (ملف مستقل — يُحمّل بعد app.js)
// =============================================================
(function(){
if (window.__syncLoaded) return; window.__syncLoaded = true;
const SYNC_NAME='ميزانيتك_الذكية_مزامنة.json';
let deviceId=localStorage.getItem('deviceId');
if(!deviceId){deviceId='dev-'+Date.now()+'-'+Math.random().toString(36).substr(2,6);localStorage.setItem('deviceId',deviceId);}
let autoSync=localStorage.getItem('autoSyncEnabled')!=='false';
let lastSync=localStorage.getItem('lastSyncTimestamp')||null;
let liveSeenTs=null;

function recCount(){return (db.exp?db.exp.length:0)+(db.rig?db.rig.length:0)+(db.deb?db.deb.length:0)+(db.inc?db.inc.length:0);}
function liveData(){return JSON.stringify({dev:deviceId,t:Date.now(),data:{exp:db.exp,rig:db.rig,deb:db.deb,bal:db.bal,inc:db.inc,currency:currentCurrency}});}
async function liveFind(){
 if(!isDriveConnected||!accessToken)return null;
 const q=encodeURIComponent("name='"+SYNC_NAME+"' and trashed=false");
 const r=await fetch('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,modifiedTime)',{headers:{'Authorization':'Bearer '+accessToken}});
 if(!r.ok)return null;
 const j=await r.json();
 return (j.files&&j.files[0])||null;
}
function fmtLast(){
 const el=document.getElementById('lastSyncLine');
 if(!el)return;
 if(lastSync){const d=new Date(parseInt(lastSync));el.textContent='آخر تحديث: '+d.toLocaleString('ar',{hour:'numeric',minute:'2-digit',day:'numeric',month:'short'});}
 else el.textContent='آخر تحديث: —';
}
function markSynced(){lastSync=Date.now();localStorage.setItem('lastSyncTimestamp',String(lastSync));fmtLast();}

// حقن مفتاح المزامنة + سطر آخر تحديث داخل القائمة تلقائياً
function injectSyncUI(){
 const driveBtn=document.getElementById('driveMenuItem');
 if(!driveBtn){return;}
 if(!document.getElementById('autoSyncToggle')){
  const row=document.createElement('div');
  row.className='sidebar-switch-item';
  row.innerHTML='<i class="fas fa-sync-alt"></i><span>المزامنة التلقائية</span><label class="switch"><input type="checkbox" id="autoSyncToggle"><span class="slider"></span></label>';
  driveBtn.insertAdjacentElement('afterend',row);
  const line=document.createElement('div');
  line.id='lastSyncLine';
  line.style.cssText='padding:0 20px 10px;font-size:0.8em;color:#888;';
  row.insertAdjacentElement('afterend',line);
  const t=row.querySelector('#autoSyncToggle');
  t.checked=autoSync;
  t.onchange=function(){autoSync=t.checked;localStorage.setItem('autoSyncEnabled',t.checked?'true':'false');fmtLast();if(t.checked&&isDriveConnected)pushSync();toastMsg(t.checked?'🔄 تم تفعيل المزامنة التلقائية':'⏸️ تم إيقاف المزامنة التلقائية','info');};
 }
 fmtLast();
}

async function pushSync(){
 if(!autoSync||!isDriveConnected||!accessToken)return;
 try{
  const f=await liveFind();
  const body=liveData();
  if(f){
   await fetch('https://www.googleapis.com/upload/drive/v3/files/'+f.id+'?uploadType=media',{method:'PATCH',headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json'},body});
  }else{
   const form=new FormData();
   form.append('metadata',new Blob([JSON.stringify({name:SYNC_NAME,mimeType:'application/json'})],{type:'application/json'}));
   form.append('file',new Blob([body],{type:'application/json'}));
   await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{method:'POST',headers:{'Authorization':'Bearer '+accessToken},body:form});
  }
  markSynced();
 }catch(e){console.log('pushSync:',e);}
}

async function applyRemote(remote){
 await new Promise(res=>{const tx=IDB_connection.transaction(STORE_NAMES,'readwrite');let d=0;STORE_NAMES.forEach(sn=>{const r=tx.objectStore(sn).clear();r.onsuccess=()=>{d++;if(d===STORE_NAMES.length)res();};});});
 if(remote.data.bal){remote.data.bal.clientId=1;await addDataToStore('bal',[remote.data.bal]);}
 for(const sn of['exp','rig','deb','inc'])if(remote.data[sn])await addDataToStore(sn,remote.data[sn]);
 if(remote.data.currency){currentCurrency=remote.data.currency;localStorage.setItem('currencyCode',currentCurrency.code);}
 await loadAllData();updateStats();updateBalanceDisplay();
}

// إشعار فوري عند وجود تعديل من جهاز آخر + تحديث البيانات
async function pullSync(){
 if(!autoSync||!isDriveConnected||!accessToken)return;
 try{
  const f=await liveFind();
  if(!f)return;
  const ts=new Date(f.modifiedTime).getTime();
  if(liveSeenTs===null){liveSeenTs=ts;return;}
  if(ts>liveSeenTs+2000){
   liveSeenTs=ts;
   const r=await fetch('https://www.googleapis.com/drive/v3/files/'+f.id+'?alt=media',{headers:{'Authorization':'Bearer '+accessToken}});
   if(!r.ok)return;
   const remote=JSON.parse(await r.text());
   if(remote.dev===deviceId)return;
   toastMsg('🔄 تعديل جديد من جهاز آخر — جارٍ التحديث...','info');
   await applyRemote(remote);
   markSynced();
   toastMsg('✅ تم تحديث بياناتك بآخر التغييرات','success');
  }
 }catch(e){console.log('pullSync:',e);}
}

// عند الاتصال: استعادة البيانات إن كان هذا جهازاً جديداً + ضبط آخر تحديث
async function initialSyncCheck(){
 if(!autoSync||!isDriveConnected||!accessToken)return;
 try{
  const f=await liveFind();
  if(!f){if(recCount()>0)pushSync();return;}
  const r=await fetch('https://www.googleapis.com/drive/v3/files/'+f.id+'?alt=media',{headers:{'Authorization':'Bearer '+accessToken}});
  if(!r.ok)return;
  const remote=JSON.parse(await r.text());
  const local=recCount();
  const rc=(remote.data.exp?remote.data.exp.length:0)+(remote.data.rig?remote.data.rig.length:0)+(remote.data.deb?remote.data.deb.length:0)+(remote.data.inc?remote.data.inc.length:0);
  if(local===0&&rc>0&&remote.dev!==deviceId){
   toastMsg('☁️ وُجدت بياناتك على جهاز آخر — جارٍ الاستعادة...','info');
   await applyRemote(remote);
   toastMsg('✅ تم استعادة بياناتك','success');
  }
  liveSeenTs=new Date(f.modifiedTime).getTime();
  markSynced();
 }catch(e){console.log('initialSyncCheck:',e);}
}

// زر درايف يتصل مباشرة (بدون شاشة التأكيد)
window.handleDriveClick=function(){
 if(isDriveConnected){openLayer('driveBackup');return;}
 const st=localStorage.getItem('drive_token'),ex=localStorage.getItem('drive_token_expiry');
 if(st&&parseInt(ex)>Date.now()){
  accessToken=st;userEmail=localStorage.getItem('drive_email')||'';appFolderId=localStorage.getItem('drive_folder_id')||null;
  isDriveConnected=true;updateDriveUI();startTokenRefresh();
  openLayer('driveBackup');loadBackupList();initialSyncCheck();
  return;
 }
 if(!tokenClient){toastMsg('جاري تحميل المصادقة...','info');return;}
 tokenClient.requestAccessToken({prompt:'consent'});
};

// حقن الواجهة عند فتح القائمة وعند تحديث حالة درايف
const _osb=window.openSidebar;
window.openSidebar=function(){if(_osb)_osb();injectSyncUI();};
const _udui=window.updateDriveUI;
window.updateDriveUI=function(){_udui();injectSyncUI();if(isDriveConnected)initialSyncCheck();};

// دفع تلقائي عند كل حفظ / حذف / إيداع / سحب
const _psc=window.postSaveCleanup;
window.postSaveCleanup=function(){const r=_psc.apply(this,arguments);pushSync();return r;};
const _dt=window.deleteTransaction;
window.deleteTransaction=async function(){const r=await _dt.apply(this,arguments);pushSync();return r;};
const _pb=window.processBalanceAction;
window.processBalanceAction=async function(){const r=await _pb.apply(this,arguments);pushSync();return r;};

// فحص التغييرات القادمة كل 25 ثانية
setInterval(pullSync,25000);
setTimeout(function(){injectSyncUI();fmtLast();},1500);
})();
