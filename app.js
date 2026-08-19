// =============================================================
// 0.  GOOGLE DRIVE CONFIGURATION
// =============================================================
const CLIENT_ID = '110105567176-h191ogi1tl0bevvk0vo8jvnbf47re5q1.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const APP_FOLDER_NAME = 'ميزانيتك الذكية';
let tokenClient;
let accessToken = null;
let isDriveConnected = false;
let backupFiles = [];
let userEmail = '';
let appFolderId = null;
let gapiInitAttempts = 0;
let gisInitAttempts = 0;
const MAX_INIT_ATTEMPTS = 10;
let tokenRefreshInterval = null;

// =============================================================
// 1.  INDEXED DB SETUP
// =============================================================
const IDB_NAME = "MySmartBudgetDB";
const IDB_VERSION = 6;
const STORE_NAMES = ["exp", "rig", "deb", "bal", "inc"];
let db = { exp: [], rig: [], deb: [], bal: { clientId: 1, amount: 0, changes: [] }, inc: [] };
let IDB_connection = null;
let currentBalance = 0;
let balanceHidden = localStorage.getItem('balanceHidden') === 'true';
let currentLog = '',
    editMode = null,
    balanceActionType = null;
let selectedImageFile = null;
let logFilters = { cat: 'all', status: 'all', period: 'all' };
let balanceFilters = { type: 'all' };

// =============================================================
// 2.  NAVIGATION / LAYERS
// =============================================================
const LAYERS = {
  'sidebar':       { elementId: 'appSidebar', type: 'menu' },
  'log':           { elementId: 'logModal', type: 'modal' },
  'detail':        { elementId: 'detailModal', type: 'modal' },
  'currency':      { elementId: 'currencyModal', type: 'modal' },
  'about':         { elementId: 'aboutModal', type: 'modal' },
  'balanceAction': { elementId: 'balanceActionModal', type: 'modal' },
  'balanceLog':    { elementId: 'balanceLogModal', type: 'modal' },
  'imageSource':   { elementId: 'imageSourceModal', type: 'menu' },
  'confirmBackup': { elementId: 'confirmBackupModal', type: 'modal' },
  'driveBackup':   { elementId: 'driveBackupModal', type: 'modal' },
  'exportName':    { elementId: 'exportNameModal', type: 'modal' },
  'language':      { elementId: 'languageModal', type: 'modal' },
  'goal':          { elementId: 'goalModal', type: 'modal' } // ✔ جديد: نافذة الأهداف
};
let historyStack = [];

function _visualOpen(layerName, data = {}) {
  const layer = LAYERS[layerName];
  if (!layer) return;
  const el = document.getElementById(layer.elementId);
  if (!el) return;
  if (layer.type === 'modal') {
    el.style.display = 'flex';
    if (layerName === 'log') {
      currentLog = data.logType;
      buildLogFilters();
      renderLog();
    } else if (layerName === 'detail') {
      const o = db[data.logType]?.find(item => item.clientId === data.id || item.id === data.id);
      if (!o) { toastMsg(translate('notFound'), "error"); return; }
      const idx = db[data.logType].findIndex(item => item.clientId === data.id || item.id === data.id);
      editMode = { type: data.logType, index: idx };
      _renderDetailContent(o, data.logType);
    } else if (layerName === 'balanceAction') {
      balanceActionType = data.actionType;
      const titleEl = document.getElementById('actionModalTitle');
      if (titleEl) titleEl.textContent = balanceActionType === 'deposit' ? translate('depositTitle') : translate('withdrawTitle');
      const balanceEl = document.getElementById('currentBalanceInAction');
      if (balanceEl) balanceEl.innerHTML = formatCurrency(currentBalance);
      const amountEl = document.getElementById('bAmount');
      if (amountEl) amountEl.value = '';
      const descEl = document.getElementById('bDesc');
      if (descEl) descEl.value = '';
      const dateEl = document.getElementById('bDate');
      if (dateEl) dateEl.value = getLocalDateTimeString();
    } else if (layerName === 'goal') {
      // ✔ جديد: تهيئة نافذة الهدف (إضافة أو تعديل)
      goalEditMode = data.goalId || null;
      const titleEl = document.getElementById('goalModalTitle');
      if (titleEl) titleEl.textContent = goalEditMode ? translate('editGoalTitle') : translate('addGoalTitle');
      const gType = document.getElementById('gType');
      const gName = document.getElementById('gName');
      const gTarget = document.getElementById('gTarget');
      const gDeadline = document.getElementById('gDeadline');
      if (goalEditMode) {
        const g = goals.find(x => x.id === goalEditMode);
        if (g) {
          if (gType) gType.value = g.type;
          if (gName) gName.value = g.name || '';
          if (gTarget) gTarget.value = parseAmount(g.target).toLocaleString('en-US');
          if (gDeadline) gDeadline.value = g.deadline || '';
        }
      } else {
        if (gType) gType.value = '';
        if (gName) gName.value = '';
        if (gTarget) gTarget.value = '';
        if (gDeadline) gDeadline.value = '';
      }
      updateGoalFields();
    } else if (layerName === 'currency') {
      const searchEl = document.getElementById('currencySearch');
      if (searchEl) searchEl.value = '';
      renderCurrencyList();
    } else if (layerName === 'balanceLog') {
      buildBalanceFilters();
      renderBalanceLog();
    } else if (layerName === 'driveBackup') {
      renderDriveBackupList();
    } else if (layerName === 'exportName') {
      const fileNameEl = document.getElementById('exportFileName');
      if (fileNameEl) {
        fileNameEl.value = translate('defaultFileName');
        fileNameEl.focus();
        fileNameEl.select();
      }
    } else if (layerName === 'language') {
      updateLanguageModalCheckmarks();
    }
  } else if (layer.type === 'menu') {
    el.classList.add('open');
    const ov = document.querySelector(layerName === 'imageSource' ? '#imageSourceOverlay' : '.sidebar-overlay');
    if (ov) ov.classList.add('open');
  }
}

function _visualClose(layerName, clearEdit = true) {
  const layer = LAYERS[layerName];
  if (!layer) return;
  const el = document.getElementById(layer.elementId);
  if (!el) return;
  if (layer.type === 'modal') {
    el.style.display = 'none';
    if (clearEdit && (layerName === 'detail' || layerName === 'log')) editMode = null;
  } else if (layer.type === 'menu') {
    el.classList.remove('open');
    const ov = document.querySelector(layerName === 'imageSource' ? '#imageSourceOverlay' : '.sidebar-overlay');
    if (ov) ov.classList.remove('open');
  }
}

function openLayer(layerName, data = {}) {
  if (historyStack.length && historyStack[historyStack.length - 1].layer === layerName) return;
  if (layerName === 'detail') {
    const o = db[data.logType]?.find(item => item.clientId === data.id || item.id === data.id);
    if (!o) {
      toastMsg(translate('notFound'), "error");
      return;
    }
  }
  const state = { layer: layerName, data: data };
  historyStack.push(state);
  history.pushState(state, null, `#${layerName}`);
  _visualOpen(layerName, data);
}

function closeLayer(layerName, clearEdit = true) {
  const top = historyStack[historyStack.length - 1];
  if (top && top.layer === layerName) { history.back(); } else { _visualClose(layerName, clearEdit); }
}

function closeAllLayers() {
  while (historyStack.length > 1) {
    const top = historyStack.pop();
    if (top.layer === 'main') {
      historyStack.push(top);
      break;
    }
    _visualClose(top.layer);
  }
  if (historyStack.length === 1) {
    history.replaceState({ layer: 'main' }, null, '#main');
  }
}

window.onpopstate = (e) => {
  const closed = historyStack.pop();
  if (closed) _visualClose(closed.layer);
  if (historyStack.length === 0) {
    const st = { layer: 'main' };
    historyStack.push(st);
    history.pushState(st, null, '#main');
    for (const n in LAYERS) _visualClose(n, false);
  } else {
    const top = historyStack[historyStack.length - 1];
    _visualOpen(top.layer, top.data);
  }
};

// =============================================================
// 3.  TRANSLATION SYSTEM (i18n)
// =============================================================
let translations = {};
let currentLang = localStorage.getItem('appLang') || 'ar';

function loadTranslations() {
  return fetch('lang.json')
    .then(res => {
      if (!res.ok) throw new Error('Failed to load lang.json');
      return res.json();
    })
    .then(data => {
      translations = data;
      applyTranslations(currentLang);
    })
    .catch(err => {
      console.error('Error loading translations:', err);
      translations = { ar: {}, en: {}, ur: {} };
    });
}

function applyTranslations(lang) {
  if (!translations[lang]) {
    lang = 'ar';
  }
  // ✔ إصلاح: تعيين اللغة فوراً حتى تعمل translate() بشكل صحيح داخل دوال التحديث
  currentLang = lang;
  localStorage.setItem('appLang', lang);

  const t = translations[lang] || {};
  const html = document.documentElement;
  if (lang === 'ar' || lang === 'ur') {
    html.dir = 'rtl';
    html.lang = lang;
  } else {
    html.dir = 'ltr';
    html.lang = 'en';
  }
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key] !== undefined) {
      el.textContent = t[key];
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (t[key] !== undefined) {
      el.placeholder = t[key];
    }
  });
  // ✔ جديد: دعم ترجمة خاصية title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (t[key] !== undefined) {
      el.title = t[key];
    }
  });
  const langLabel = document.getElementById('sidebarLanguageLabel');
  if (langLabel) {
    const langNames = { ar: '🇸🇦 العربية', en: '🇬🇧 English', ur: '🇵 اردو' };
    langLabel.textContent = langNames[lang] || '🇸🇦 العربية';
  }
  updateBalanceDisplay();
  updateStats();
  // ✔ إعادة بناء الفلاتر عند تغيير اللغة
  if (document.getElementById('logModal').style.display === 'flex') { buildLogFilters(); renderLog(); }
  if (document.getElementById('balanceLogModal').style.display === 'flex') { buildBalanceFilters(); renderBalanceLog(); }
  if (document.getElementById('driveBackupModal').style.display === 'flex') renderDriveBackupList();
  if (document.getElementById('currencyModal').style.display === 'flex') renderCurrencyList();
  // ✔ جديد: تحديث نافذة الهدف المفتوحة عند تغيير اللغة
  if (document.getElementById('goalModal').style.display === 'flex') {
    const gt = document.getElementById('goalModalTitle');
    if (gt) gt.textContent = goalEditMode ? translate('editGoalTitle') : translate('addGoalTitle');
    updateGoalFields();
  }
  updateLanguageModalCheckmarks();
}

function translate(key) {
  if (!translations[currentLang] || translations[currentLang][key] === undefined) {
    return translations['ar']?.[key] || key;
  }
  return translations[currentLang][key];
}

function setLanguage(lang) {
  if (lang === currentLang) {
    closeLayer('language');
    return;
  }
  applyTranslations(lang);
  closeLayer('language');
  toastMsg(translate('languageChanged') || 'Language changed', 'success');
}

function openLanguageModal() {
  openLayer('language');
}

function updateLanguageModalCheckmarks() {
  const checks = {
    ar: document.getElementById('langCheckAr'),
    en: document.getElementById('langCheckEn'),
    ur: document.getElementById('langCheckUr')
  };
  for (const [lang, el] of Object.entries(checks)) {
    if (el) el.style.display = (lang === currentLang) ? 'inline' : 'none';
  }
}

// =============================================================
// 4.  GOOGLE DRIVE API FUNCTIONS
// =============================================================
function startTokenRefresh() {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }
  tokenRefreshInterval = setInterval(async () => {
    if (isDriveConnected && accessToken) {
      try {
        if (tokenClient) {
          tokenClient.requestAccessToken({ prompt: '' });
        }
      } catch (e) {
        console.log('Token refresh failed, will retry later');
      }
    }
  }, 50 * 60 * 1000);
}

function stopTokenRefresh() {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = null;
  }
}

function restoreDriveState() {
  const savedToken = localStorage.getItem('drive_token');
  const savedEmail = localStorage.getItem('drive_email');
  const savedFolderId = localStorage.getItem('drive_folder_id');
  const tokenExpiry = localStorage.getItem('drive_token_expiry');
  if (savedToken && savedEmail) {
    const now = Date.now();
    const expiry = parseInt(tokenExpiry) || 0;
    if (expiry > now) {
      accessToken = savedToken;
      userEmail = savedEmail;
      appFolderId = savedFolderId || null;
      isDriveConnected = true;
      updateDriveUI();
      startTokenRefresh();
      setTimeout(() => {
        if (accessToken) {
          loadBackupList();
          verifyTokenValidity();
        }
      }, 1000);
    } else {
      console.log('Token expired, attempting to refresh...');
      if (tokenClient) {
        tokenClient.requestAccessToken({ prompt: '' });
      } else {
        setTimeout(() => {
          if (tokenClient) {
            tokenClient.requestAccessToken({ prompt: '' });
          }
        }, 2000);
      }
    }
  }
}

async function verifyTokenValidity() {
  if (!accessToken) return;
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + accessToken);
    if (!response.ok) {
      console.log('Token invalid, attempting to refresh...');
      if (tokenClient) {
        tokenClient.requestAccessToken({ prompt: '' });
      }
    }
  } catch (error) {
    console.log('Token verification failed:', error);
  }
}

function initGapi() {
  if (gapiInitAttempts >= MAX_INIT_ATTEMPTS) {
    console.warn('GAPI init max attempts reached');
    return;
  }
  gapiInitAttempts++;
  if (typeof gapi === 'undefined') {
    console.warn('gapi not loaded yet, retrying...');
    setTimeout(initGapi, 500);
    return;
  }
  try {
    gapi.load('client', async () => {
      try {
        await gapi.client.init({
          apiKey: '',
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
        });
        console.log('Google API loaded');
        restoreDriveState();
      } catch (error) {
        console.error('Error loading GAPI client:', error);
      }
    });
  } catch (error) {
    console.error('Error in GAPI init:', error);
    setTimeout(initGapi, 500);
  }
}

function initGis() {
  if (gisInitAttempts >= MAX_INIT_ATTEMPTS) {
    console.warn('GIS init max attempts reached');
    return;
  }
  gisInitAttempts++;
  if (typeof google === 'undefined' || !google.accounts) {
    console.warn('GIS not loaded yet, retrying...');
    setTimeout(initGis, 500);
    return;
  }
  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: async (resp) => {
        if (resp.error) {
          console.error('Auth error:', resp.error);
          if (resp.error === 'access_denied' || resp.error === 'invalid_token') {
            toastMsg(translate('sessionExpired'), "info");
            setTimeout(() => {
              if (tokenClient) {
                tokenClient.requestAccessToken({ prompt: '' });
              }
            }, 2000);
          } else {
            toastMsg(translate('loginFailed') + ': ' + resp.error, "error");
          }
          return;
        }
        accessToken = resp.access_token;
        localStorage.setItem('drive_token', accessToken);
        localStorage.setItem('drive_token_expiry', Date.now() + 3600 * 1000);
        try {
          const userInfo = await fetch(
            'https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
          const userData = await userInfo.json();
          userEmail = userData.email || '';
          localStorage.setItem('drive_email', userEmail);
          await createAppFolder();
          isDriveConnected = true;
          updateDriveUI();
          toastMsg(translate('driveConnected'), "success");
          startTokenRefresh();
          await loadBackupList();
          if (document.getElementById('confirmBackupModal').style.display === 'flex') {
            closeLayer('confirmBackup');
          }
          openLayer('driveBackup');
        } catch (e) {
          console.error('Error getting user info:', e);
          userEmail = '';
          toastMsg(translate('loginError'), "error");
        }
      },
    });
    console.log('GIS loaded');
  } catch (error) {
    console.error('Error initializing GIS:', error);
    setTimeout(initGis, 500);
  }
}

async function createAppFolder() {
  if (!accessToken) return;
  try {
    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );
    const result = await searchResponse.json();
    if (result.files && result.files.length > 0) {
      appFolderId = result.files[0].id;
      localStorage.setItem('drive_folder_id', appFolderId);
      console.log('Folder exists:', appFolderId);
      return;
    }
    const metadata = {
      name: APP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    };
    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    });
    if (!createResponse.ok) {
      throw new Error(`Failed to create folder: ${createResponse.status}`);
    }
    const folderData = await createResponse.json();
    appFolderId = folderData.id;
    localStorage.setItem('drive_folder_id', appFolderId);
    console.log('Folder created:', appFolderId);
    toastMsg(translate('folderCreated'), "success");
  } catch (error) {
    console.error('Error creating folder:', error);
    toastMsg(translate('folderCreateFailed'), "error");
  }
}

function handleDriveClick() {
  const savedToken = localStorage.getItem('drive_token');
  const tokenExpiry = localStorage.getItem('drive_token_expiry');
  if (savedToken && tokenExpiry) {
    const now = Date.now();
    const expiry = parseInt(tokenExpiry) || 0;
    if (expiry > now && !isDriveConnected) {
      accessToken = savedToken;
      userEmail = localStorage.getItem('drive_email') || '';
      appFolderId = localStorage.getItem('drive_folder_id') || null;
      isDriveConnected = true;
      updateDriveUI();
      startTokenRefresh();
      openLayer('driveBackup');
      return;
    }
  }
  openLayer('confirmBackup');
}

function handleBackupConfirm() {
  const savedToken = localStorage.getItem('drive_token');
  const tokenExpiry = localStorage.getItem('drive_token_expiry');
  if (savedToken && tokenExpiry) {
    const now = Date.now();
    const expiry = parseInt(tokenExpiry) || 0;
    if (expiry > now && !isDriveConnected) {
      accessToken = savedToken;
      userEmail = localStorage.getItem('drive_email') || '';
      appFolderId = localStorage.getItem('drive_folder_id') || null;
      isDriveConnected = true;
      updateDriveUI();
      startTokenRefresh();
      closeLayer('confirmBackup');
      performBackup();
      return;
    } else if (expiry > now && isDriveConnected) {
      closeLayer('confirmBackup');
      performBackup();
      return;
    }
  }
  if (!tokenClient) {
    toastMsg(translate('loadingAuth'), "info");
    return;
  }
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleViewBackups() {
  closeLayer('confirmBackup');
  const savedToken = localStorage.getItem('drive_token');
  const tokenExpiry = localStorage.getItem('drive_token_expiry');
  if (savedToken && tokenExpiry) {
    const now = Date.now();
    const expiry = parseInt(tokenExpiry) || 0;
    if (expiry > now) {
      if (!isDriveConnected) {
        accessToken = savedToken;
        userEmail = localStorage.getItem('drive_email') || '';
        appFolderId = localStorage.getItem('drive_folder_id') || null;
        isDriveConnected = true;
        updateDriveUI();
        startTokenRefresh();
      }
      openLayer('driveBackup');
      return;
    }
  }
  if (!tokenClient) {
    toastMsg(translate('loadingAuth'), "info");
    return;
  }
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleDriveBackup() {
  if (!isDriveConnected) {
    toastMsg(translate('driveNotConnected'), "error");
    return;
  }
  performBackup();
}

function signOut() {
  if (!confirm(translate('confirmSignOut'))) return;
  stopTokenRefresh();
  accessToken = null;
  localStorage.removeItem('drive_token');
  localStorage.removeItem('drive_email');
  localStorage.removeItem('drive_folder_id');
  localStorage.removeItem('drive_token_expiry');
  isDriveConnected = false;
  userEmail = '';
  appFolderId = null;
  backupFiles = [];
  updateDriveUI();
  toastMsg(translate('signedOut'), "info");
}

function updateDriveUI() {
  const menuItem = document.getElementById('driveMenuItem');
  const menuText = document.getElementById('driveMenuText');
  const dot = document.getElementById('driveStatusDot');
  const email = document.getElementById('driveMenuEmail');
  const logoutBtn = document.getElementById('driveLogoutBtn');
  const modalStatus = document.getElementById('driveModalStatus');
  if (menuItem) {
    if (isDriveConnected) {
      menuItem.classList.add('connected');
      if (menuText) menuText.textContent = translate('googleDrive');
      if (dot) {
        dot.style.display = 'inline-block';
        dot.style.background = 'var(--success)';
      }
      if (email) email.textContent = userEmail || '';
      if (logoutBtn) logoutBtn.style.display = 'inline-block';
    } else {
      menuItem.classList.remove('connected');
      if (menuText) menuText.textContent = translate('googleDrive');
      if (dot) {
        dot.style.display = 'inline-block';
        dot.style.background = '#999';
      }
      if (email) email.textContent = '';
      if (logoutBtn) logoutBtn.style.display = 'none';
    }
  }
  if (modalStatus) {
    if (isDriveConnected) {
      modalStatus.className = 'status connected';
      modalStatus.textContent = translate('driveConnectedStatus');
    } else {
      modalStatus.className = 'status disconnected';
      modalStatus.textContent = translate('driveDisconnectedStatus');
    }
  }
}

async function loadBackupList() {
  if (!accessToken || !appFolderId) {
    backupFiles = [];
    renderDriveBackupList();
    return;
  }
  try {
    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${appFolderId}' in parents and trashed=false and (mimeType='application/json' or name contains '.json')&fields=files(id,name,size,createdTime)&orderBy=createdTime desc`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );
    const result = await searchResponse.json();
    backupFiles = result.files || [];
    renderDriveBackupList();
  } catch (error) {
    console.error('Error loading backup list:', error);
    toastMsg(translate('backupListLoadFailed'), "error");
  }
}

function parseBackupNumber(name) {
  const m = (name || '').match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return isNaN(n) ? null : n;
}

function getNextBackupNumber() {
  let max = 0;
  (backupFiles || []).forEach(f => {
    const n = parseBackupNumber(f.name);
    if (n && n > max) max = n;
  });
  return max + 1;
}

function renderDriveBackupList() {
  const container = document.getElementById('driveBackupList');
  const countEl = document.getElementById('driveBackupCount');
  if (!container) return;
  if (!isDriveConnected) {
    container.innerHTML = `<div class="drive-empty"><i class="fab fa-google-drive"></i><p>${translate('driveConnectPrompt')}</p></div>`;
    if (countEl) countEl.textContent = translate('backupCountLabel') + ' 0';
    return;
  }
  if (backupFiles.length === 0) {
    container.innerHTML = `<div class="drive-empty"><i class="fas fa-cloud-upload-alt"></i><p>${translate('noBackups')}</p><p style="font-size:0.85em;color:#888;">${translate('newBackupPrompt')}</p></div>`;
    if (countEl) countEl.textContent = translate('backupCountLabel') + ' 0';
    return;
  }
  const sortedByDate = [...backupFiles].sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
  let fallback = 1;
  const filesWithNumbers = sortedByDate.map(file => {
    const parsed = parseBackupNumber(file.name);
    return { ...file, number: parsed || fallback++ };
  });
  const displayFiles = filesWithNumbers.sort((a, b) => a.number - b.number);
  let tableHtml = `<table class="backup-table"><thead><tr><th>${translate('backupName')}</th><th>${translate('backupDate')}</th><th>${translate('backupSize')}</th><th style="text-align:left;">${translate('actions')}</th></tr></thead><tbody>`;
  displayFiles.forEach((file) => {
    const date = new Date(file.createdTime);
    const formattedDate = date.toLocaleString('ar', {
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    const size = file.size ? (parseInt(file.size) / 1024).toFixed(1) + 'KB' : translate('unknown');
    const name = `${translate('backupCopy')} رقم ${file.number}`;
    tableHtml += `<tr><td class="file-name">${name}</td><td class="file-date">${formattedDate}</td><td class="file-size">${size}</td><td><div class="file-actions"><button class="restore-btn" onclick="restoreBackup('${file.id}')" title="${translate('restore')}"><i class="fas fa-download"></i></button><button class="delete-btn" onclick="deleteBackup('${file.id}')" title="${translate('delete')}"><i class="fas fa-trash"></i></button></div></td></tr>`;
  });
  tableHtml += `</tbody></table>`;
  container.innerHTML = tableHtml;
  if (countEl) countEl.textContent = translate('backupCountLabel') + ' ' + backupFiles.length;
}

function refreshBackupList() {
  loadBackupList();
  toastMsg(translate('refreshingList'), "info");
}

async function performBackup() {
  if (!accessToken || !appFolderId) {
    toastMsg(translate('driveNotConnected'), "error");
    return;
  }
  showLoading(translate('savingBackup'));
  try {
    const data = {
      exp: db.exp,
      rig: db.rig,
      deb: db.deb,
      bal: db.bal,
      inc: db.inc,
      goals: goals, // ✔ جديد: الأهداف ضمن النسخة الاحتياطية
      currency: currentCurrency,
      backupDate: new Date().toISOString()
    };
    const nextNumber = getNextBackupNumber();
    const numStr = String(nextNumber).padStart(3, '0');
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const fileName = `${numStr}_${translate('backupFileNamePrefix')}_${dateTime}.json`;
    const jsonData = JSON.stringify(data, null, 2);
    const fileData = new Blob([jsonData], { type: 'application/json' });
    const metadata = {
      name: fileName,
      parents: [appFolderId],
      mimeType: 'application/json'
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileData);
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: form
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }
    hideLoading();
    toastMsg(translate('backupSaved'), "success");
    await loadBackupList();
    renderDriveBackupList();
    if (document.getElementById('driveBackupModal').style.display !== 'flex') {
      openLayer('driveBackup');
    }
  } catch (error) {
    hideLoading();
    console.error('Error uploading backup:', error);
    toastMsg(translate('backupFailed') + ': ' + error.message, "error");
  }
}

async function restoreBackup(fileId) {
  if (!confirm(translate('confirmRestore'))) return;
  showLoading(translate('restoringData'));
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }
    const text = await response.text();
    const imported = JSON.parse(text);
    if (imported.bal && Array.isArray(imported.bal.changes)) {
      imported.bal.clientId = 1;
      await addDataToStore('bal', [imported.bal]);
    }
    for (const sn of ['exp', 'rig', 'deb', 'inc']) {
      if (imported[sn] && Array.isArray(imported[sn])) {
        await addDataToStore(sn, imported[sn]);
      }
    }
    // ✔ جديد: استعادة الأهداف
    if (imported.goals && Array.isArray(imported.goals)) {
      goals = imported.goals;
      saveGoalsToStorage();
    }
    if (imported.currency) {
      currentCurrency = imported.currency;
      localStorage.setItem('currencyCode', currentCurrency.code);
      const label = document.getElementById('sidebarCurrencyLabel');
      if (label) label.textContent = currentCurrency.symbol;
    }
    await loadAllData();
    hideLoading();
    updateStats();
    updateBalanceDisplay();
    toastMsg(translate('dataRestored'), "success");
    await loadBackupList();
    renderDriveBackupList();
  } catch (error) {
    hideLoading();
    console.error('Error restoring backup:', error);
    toastMsg(translate('restoreFailed') + ': ' + error.message, "error");
  }
}

async function deleteBackup(fileId) {
  if (!confirm(translate('confirmDeleteBackup'))) return;
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );
    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }
    toastMsg(translate('backupDeleted'), "success");
    await loadBackupList();
    renderDriveBackupList();
  } catch (error) {
    console.error('Error deleting backup:', error);
    toastMsg(translate('deleteFailed') + ': ' + error.message, "error");
  }
}

// =============================================================
// 5.  EXPORT / IMPORT
// =============================================================
function openExportNameModal() {
  openLayer('exportName');
}

function performExport() {
  const fileName = document.getElementById('exportFileName').value.trim();
  if (!fileName) {
    toastMsg(translate('enterFileName'), "error");
    return;
  }
  closeLayer('exportName');
  if (!IDB_connection) return toastMsg(translate('dbError'), "error");
  const data = {
    exp: db.exp,
    rig: db.rig,
    deb: db.deb,
    bal: db.bal,
    inc: db.inc,
    goals: goals, // ✔ جديد: الأهداف ضمن ملف التصدير
    currency: currentCurrency
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toastMsg(translate('exportSuccess'), "success");
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm(translate('confirmImport'))) {
    event.target.value = null;
    return;
  }
  showLoading(translate('importingData'));
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported.bal && Array.isArray(imported.bal.changes)) {
        imported.bal.clientId = 1;
        await addDataToStore('bal', [imported.bal]);
      }
      for (const sn of ['exp', 'rig', 'deb', 'inc']) {
        if (imported[sn] && Array.isArray(imported[sn])) {
          await addDataToStore(sn, imported[sn]);
        }
      }
      // ✔ جديد: استيراد الأهداف
      if (imported.goals && Array.isArray(imported.goals)) {
        goals = imported.goals;
        saveGoalsToStorage();
      }
      if (imported.currency) {
        currentCurrency = imported.currency;
        localStorage.setItem('currencyCode', currentCurrency.code);
        const label = document.getElementById('sidebarCurrencyLabel');
        if (label) label.textContent = currentCurrency.symbol;
      }
      await loadAllData();
      hideLoading();
      updateStats();
      updateBalanceDisplay();
      toastMsg(translate('importSuccess'), "success");
    } catch (err) {
      hideLoading();
      toastMsg(translate('importFailed'), "error");
      console.error(err);
    } finally {
      event.target.value = null;
    }
  };
  reader.readAsText(file);
}

async function addDataToStore(storeName, dataArray) {
  if (!IDB_connection) return;
  const tx = IDB_connection.transaction([storeName], 'readwrite');
  const store = tx.objectStore(storeName);
  for (const item of dataArray) {
    await new Promise(resolve => {
      if (storeName === 'bal') { store.put(item).onsuccess = resolve; } else {
        const toSave = { ...item };
        delete toSave.id;
        toSave.clientId = item.clientId || `${storeName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        store.add(toSave).onsuccess = resolve;
      }
    });
  }
}

// =============================================================
// 6.  LOADING OVERLAY
// =============================================================
function showLoading(message = translate('processing')) {
  const overlay = document.getElementById('loadingOverlay');
  const msg = document.getElementById('loadingMessage');
  if (msg) msg.textContent = message;
  if (overlay) overlay.classList.add('show');
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.remove('show');
}

// =============================================================
// 7.  TOAST NOTIFICATION
// =============================================================
function toastMsg(message, type = "info") {
  const t = document.getElementById('toast');
  if (!t) return;
  t.className = 'toast ' + type;
  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle'
  };
  t.innerHTML =
    `<span class="toast-icon ${type}"><i class="fas ${iconMap[type] || 'fa-info-circle'}"></i></span> ${message}`;
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
  }, 3500);
}

// =============================================================
// 8.  FORMATTING HELPERS + MULTI-LANGUAGE CURRENCIES
// =============================================================
const ARABIC_CURRENCIES = [
  { code: 'SAR', symbol: '﷼', flag: '🇸🇦', name: { ar: 'الريال السعودي', en: 'Saudi Riyal', ur: 'سعودی ریال' } },
  { code: 'SDG', symbol: 'ج.س', flag: '🇸🇩', name: { ar: 'الجنيه السوداني', en: 'Sudanese Pound', ur: 'سوڈانی پاؤنڈ' } },
  { code: 'AED', symbol: 'د.إ', flag: '🇦', name: { ar: 'الدرهم الإماراتي', en: 'UAE Dirham', ur: 'اماراتی درہم' } },
  { code: 'QAR', symbol: 'ر.ق', flag: '🇶🇦', name: { ar: 'الريال القطري', en: 'Qatari Riyal', ur: 'قطری ریال' } },
  { code: 'KWD', symbol: 'د.ك', flag: '🇰🇼', name: { ar: 'الدينار الكويتي', en: 'Kuwaiti Dinar', ur: 'کویتی دینار' } },
  { code: 'BHD', symbol: 'د.ب', flag: '🇧🇭', name: { ar: 'الدينار البحريني', en: 'Bahraini Dinar', ur: 'بحرینی دینار' } },
  { code: 'OMR', symbol: 'ر.ع', flag: '🇴🇲', name: { ar: 'الريال العُماني', en: 'Omani Rial', ur: 'عمانی ریال' } },
  { code: 'YER', symbol: 'ر.ي', flag: '🇾🇪', name: { ar: 'الريال اليمني', en: 'Yemeni Rial', ur: 'یمنی ریال' } },
  { code: 'IQD', symbol: 'ع.د', flag: '🇮🇶', name: { ar: 'الدينار العراقي', en: 'Iraqi Dinar', ur: 'عراقی دینار' } },
  { code: 'JOD', symbol: 'د.أ', flag: '🇯🇴', name: { ar: 'الدينار الأردني', en: 'Jordanian Dinar', ur: 'اردنی دینار' } },
  { code: 'LBP', symbol: 'ل.ل', flag: '🇱🇧', name: { ar: 'الليرة اللبنانية', en: 'Lebanese Lira', ur: 'لبنانی لیرا' } },
  { code: 'SYP', symbol: 'ل.س', flag: '🇸🇾', name: { ar: 'الليرة السورية', en: 'Syrian Lira', ur: 'شامی لیرا' } },
  { code: 'ILS', symbol: '₪', flag: '🇵🇸', name: { ar: 'الشيكل الفلسطيني', en: 'Israeli Shekel', ur: 'اسرائیلی شیکل' } },
  { code: 'EGP', symbol: 'ج.م', flag: '🇪🇬', name: { ar: 'الجنيه المصري', en: 'Egyptian Pound', ur: 'مصری پاؤنڈ' } },
  { code: 'LYD', symbol: 'ل.د', flag: '🇱🇾', name: { ar: 'الدينار الليبي', en: 'Libyan Dinar', ur: 'لیبیائی دینار' } },
  { code: 'TND', symbol: 'د.ت', flag: '🇹🇳', name: { ar: 'الدينار التونسي', en: 'Tunisian Dinar', ur: 'تونسی دینار' } },
  { code: 'DZD', symbol: 'دج', flag: '🇩🇿', name: { ar: 'الدينار الجزائري', en: 'Algerian Dinar', ur: 'الجزائری دینار' } },
  { code: 'MAD', symbol: 'د.م', flag: '🇲🇦', name: { ar: 'الدرهم المغربي', en: 'Moroccan Dirham', ur: 'مراکشی درہم' } },
  { code: 'MRU', symbol: 'أ.م', flag: '🇲🇷', name: { ar: 'الأوقية الموريتانية', en: 'Mauritanian Ouguiya', ur: 'موریطانی اوگوئیا' } },
  { code: 'SOS', symbol: 'ش.ص', flag: '🇸🇴', name: { ar: 'الشلن الصومالي', en: 'Somali Shilling', ur: 'صومالی شلنگ' } },
  { code: 'DJF', symbol: 'ف.ج', flag: '🇩🇯', name: { ar: 'الفرنك الجيبوتي', en: 'Djiboutian Franc', ur: 'جبوتی فرینک' } },
  { code: 'KMF', symbol: 'ف.ق', flag: '🇰🇲', name: { ar: 'الفرنك القمري', en: 'Comorian Franc', ur: 'قموری فرینک' } },
  { code: 'SSP', symbol: 'ج.س.ج', flag: '🇸🇸', name: { ar: 'جنيه جنوب السودان', en: 'South Sudanese Pound', ur: 'جنوب سوڈانی پاؤنڈ' } },
  { code: 'USD', symbol: '$', flag: '🇺🇸', name: { ar: 'الدولار الأمريكي', en: 'US Dollar', ur: 'امریکی ڈالر' } },
  { code: 'EUR', symbol: '€', flag: '🇪🇺', name: { ar: 'اليورو', en: 'Euro', ur: 'یورو' } },
  { code: 'BDT', symbol: '৳', flag: '🇧', name: { ar: 'التاكا البنغلاديشي', en: 'Bangladeshi Taka', ur: 'بنگلادیشی ٹاکا' } },
  { code: 'INR', symbol: '₹', flag: '🇮🇳', name: { ar: 'الروبية الهندية', en: 'Indian Rupee', ur: 'بھارتی روپیہ' } },
  { code: 'PKR', symbol: '₨', flag: '🇵🇰', name: { ar: 'الروبية الباكستانية', en: 'Pakistani Rupee', ur: 'پاکستانی روپیہ' } },
  { code: 'PHP', symbol: '₱', flag: '🇵', name: { ar: 'البيزو الفلبيني', en: 'Philippine Peso', ur: 'فلپائنی پیسو' } },
  { code: 'CNY', symbol: '¥', flag: '🇨🇳', name: { ar: 'اليوان الصيني', en: 'Chinese Yuan', ur: 'چینی یوآن' } }
];
let currentCurrency = ARABIC_CURRENCIES.find(c => c.code === (localStorage.getItem('currencyCode') || 'SAR')) ||
  ARABIC_CURRENCIES[0];

function getCurrencyName(c) {
  const lang = (c.name && c.name[currentLang]) ? currentLang : 'ar';
  return (c.name && c.name[lang]) || c.code;
}

function formatAmount(input) {
  let val = input.value.replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632 + 48));
  val = val.replace(/[^\d.]/g, '');
  const parts = val.split('.');
  if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
  const intPart = parts[0];
  const decPart = parts[1] ? '.' + parts[1] : '';
  const num = parseFloat(intPart.replace(/,/g, ''));
  let formatted = isNaN(num) ? '' : num.toLocaleString('en-US');
  if (input.value.endsWith('.') && !decPart) formatted += '.';
  input.value = formatted + decPart;
}

function parseAmount(amount) {
  if (amount === null || amount === undefined) return 0;
  let str = String(amount).trim();
  let negative = false;
  if (str.charAt(0) === '-') {
    negative = true;
    str = str.substring(1);
  }
  str = str.replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632 + 48));
  str = str.replace(/٫/g, '.');
  str = str.replace(/٬/g, '');
  str = str.replace(/[،,\s]/g, '');
  str = str.replace(/[^\d.]/g, '');
  const parts = str.split('.');
  if (parts.length > 2) str = parts[0] + '.' + parts.slice(1).join('');
  const val = parseFloat(str);
  if (isNaN(val)) return 0;
  return negative ? -val : val;
}

function getFormattedAmount(num) {
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  return num < 0 ? '-' + formatted : formatted;
}

function getLocalDateString(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getLocalDateTimeString(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${getLocalDateString(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCurrency(amount, withColor = false) {
  const num = parseAmount(amount);
  const fmt = getFormattedAmount(num);
  let colorClass = '';
  if (withColor) {
    if (num > 0) colorClass = 'balance-positive';
    else if (num < 0) colorClass = 'balance-negative';
    else colorClass = 'balance-zero';
  }
  return `<span class="${colorClass}">${fmt} <span class="currency-symbol">${currentCurrency.symbol}</span></span>`;
}

function formatBalance(amount) {
  if (balanceHidden) return '<span class="hidden-balance">***</span>';
  const num = parseAmount(amount);
  const fmt = getFormattedAmount(num);
  let colorClass = '';
  if (num > 0) colorClass = 'balance-positive';
  else if (num < 0) colorClass = 'balance-negative';
  else colorClass = 'balance-zero';
  return `<span class="${colorClass}">${fmt} <span class="currency-symbol">${currentCurrency.symbol}</span></span>`;
}

function formatDateTime(dateString) {
  if (!dateString) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [y, m, d] = dateString.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (isNaN(date)) return translate('invalidDate');
    return date.toLocaleDateString('ar', { numberingSystem: 'latn', year: 'numeric', month: 'short', day: 'numeric' });
  }
  const d = new Date(dateString);
  if (isNaN(d)) return translate('invalidDate');
  return d.toLocaleString('ar', {
    numberingSystem: 'latn', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric',
    minute: '2-digit', hour12: true
  });
}

function clearFields() {
  ['iAmount', 'iDesc', 'iType', 'iDate',
    'eAmount', 'eDesc', 'eType', 'eDate',
    'rAmount', 'rDesc', 'rType', 'rEntity', 'rDueDate',
    'dType', 'dAmount', 'dDesc', 'dStatus', 'dEntity', 'dDueDate'
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  clearSelectedImage();
  document.getElementById('rDynamicFields').innerHTML = '';
  document.getElementById('dDynamicFields').innerHTML = '';
  document.querySelectorAll('.edit-indicator').forEach(el => el.style.display = 'none');
  document.getElementById('dEntity').style.display = 'none';
}

// =============================================================
// 9.  TAB NAVIGATION
// =============================================================
function openTab(id, keepEdit = false) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.tab === id) {
      btn.classList.add('active');
    }
  });
  if (!keepEdit) {
    editMode = null;
    clearFields();
  }
  if (id === 'overview') updateStats();
  if (editMode) {
    const indicatorMap = { inc: 'incEditIndicator', exp: 'expEditIndicator', rig: 'rigEditIndicator', deb: 'debEditIndicator' };
    const ind = document.getElementById(indicatorMap[editMode.type]);
    if (ind) ind.style.display = 'inline-block';
  }
}

function openTabFromNav(tabId) {
  if (document.getElementById(tabId).classList.contains('active')) return;
  closeAllLayers();
  openTab(tabId);
}

// =============================================================
// 10. BALANCE
// =============================================================
function toggleBalanceVisibility() {
  balanceHidden = !balanceHidden;
  localStorage.setItem('balanceHidden', balanceHidden);
  updateBalanceDisplay();
  updateStats();
}

function updateBalanceDisplay() {
  const el = document.getElementById('currentBalanceDisplay');
  el.innerHTML = formatBalance(currentBalance);
  const act = document.getElementById('currentBalanceInAction');
  if (act) act.innerHTML = formatBalance(currentBalance);
  const icon = document.querySelector('#balanceVisibilityToggle i');
  if (icon) icon.className = balanceHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
  if (document.getElementById('balanceLogModal').style.display === 'flex') renderBalanceLog();
  // ✔ جديد: تحديث الأهداف تلقائياً مع كل تغيّر في الرصيد
  renderGoals();
}

async function processBalanceChange(amount, type, description, recordId = null, isEdit = false, oldAmount = 0) {
  if (!recordId) recordId = `bal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const changeAmount = parseAmount(amount);
  let netChange = changeAmount;
  if (['expense', 'debt_payment', 'withdraw', 'revert_expense_debt'].includes(type)) netChange *= -1;
  let effectiveChange = netChange;
  if (isEdit) effectiveChange = netChange - oldAmount;
  currentBalance = parseAmount(currentBalance) + effectiveChange;
  db.bal.amount = currentBalance;
  const entry = {
    id: recordId,
    التاريخ: getLocalDateTimeString(),
    النوع: description,
    المبلغ: changeAmount,
    التأثير: (netChange > 0 ? translate('depositEffect') : (netChange < 0 ? translate('withdrawEffect') : translate('editEffect'))),
    القيمة_الصافية: netChange,
    الرصيد_بعد_العملية: currentBalance
  };
  const idx = db.bal.changes.findIndex(c => c.id === recordId);
  if (idx > -1) db.bal.changes[idx] = entry;
  else db.bal.changes.unshift(entry);
  try {
    await saveData('bal', db.bal);
    updateBalanceDisplay();
    return true;
  } catch (e) {
    console.error('Balance save failed', e);
    currentBalance -= effectiveChange;
    toastMsg(translate('balanceUpdateFailed'), "error");
    return false;
  }
}

async function processBalanceAction() {
  const amt = document.getElementById('bAmount').value;
  const desc = document.getElementById('bDesc').value || (balanceActionType === 'deposit' ? translate('generalDeposit') : translate('generalWithdraw'));
  if (!amt) return toastMsg(translate('enterAmount'), "error");
  const ok = await processBalanceChange(amt, balanceActionType, desc, `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  if (ok) {
    toastMsg(balanceActionType === 'deposit' ? translate('depositSuccess') : translate('withdrawSuccess'), "success");
    closeLayer('balanceAction');
  }
}

function renderBalanceLog() {
  const el = document.getElementById('balanceLogContent');
  const changes = db.bal.changes || [];
  const qEl = document.getElementById('balanceSearch');
  const q = qEl ? qEl.value.toLowerCase() : '';
  let list = changes;
  if (q) list = list.filter(i => String(i.النوع).toLowerCase().includes(q));
  if (balanceFilters.type === 'deposit') list = list.filter(i => i.القيمة_الصافية > 0);
  if (balanceFilters.type === 'withdraw') list = list.filter(i => i.القيمة_الصافية < 0);
  let dep = 0, wit = 0;
  list.forEach(i => { if (i.القيمة_الصافية > 0) dep += i.القيمة_الصافية; else if (i.القيمة_الصافية < 0) wit += Math.abs(i.القيمة_الصافية); });
  const bar = document.getElementById('balanceStatsBar');
  if (bar) bar.innerHTML = `
    <div class="log-stat-chip"><span class="stat-label">${translate('movementsCount')}</span><span class="stat-value">${list.length}</span></div>
    <div class="log-stat-chip"><span class="stat-label">${translate('totalDeposits')}</span><span class="stat-value" style="color:var(--success)">${getFormattedAmount(dep)}</span></div>
    <div class="log-stat-chip"><span class="stat-label">${translate('totalWithdrawals')}</span><span class="stat-value" style="color:var(--danger)">${getFormattedAmount(wit)}</span></div>`;
  if (!list.length) {
    el.innerHTML =
      `<p style="text-align:center;color:#999;padding:30px 0;"><i class="fas fa-inbox" style="font-size:2em;display:block;margin-bottom:10px;"></i>${translate('noBalanceLog')}</p>`;
    return;
  }
  el.innerHTML = list.map(i => {
    const isDep = i.القيمة_الصافية > 0;
    const color = isDep ? 'var(--success)' : (i.القيمة_الصافية < 0 ? 'var(--danger)' : '#999');
    const icon = isDep ? 'fa-arrow-up' : (i.القيمة_الصافية < 0 ? 'fa-arrow-down' : 'fa-minus');
    const displayAmount = (i.القيمة_الصافية < 0 ? '-' : '') + formatCurrency(Math.abs(i.المبلغ));
    return `<div class="list-item" style="border-right-color:${color};">
      <div style="font-weight:bold;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;">
        <span><i class="fas ${icon}" style="margin-left:8px;color:${color};"></i> ${i.النوع}</span>
        <span style="color:${color};">${displayAmount}</span>
      </div>
      <div class="details">
        <span>${translate('balanceAfter')}: ${formatBalance(i.الرصيد_بعد_العملية)}</span>
        <span><i class="far fa-clock" style="margin-left:4px;"></i>${formatDateTime(i.التاريخ)}</span>
      </div>
    </div>`;
  }).join('');
}

// =============================================================
// 11. CRUD — INCOME, EXPENSES, RIGHTS, DEBTS
// =============================================================
// 11.1 INCOME
async function addIncome() {
  const iAmount = document.getElementById('iAmount');
  const iType = document.getElementById('iType');
  const iDate = document.getElementById('iDate');
  const iDesc = document.getElementById('iDesc');
  if (!iAmount.value || !iType.value || !iDate.value) return toastMsg(translate('fillRequired'), "error");
  const isEditing = editMode && editMode.type === 'inc';
  const oldData = isEditing ? db.inc[editMode.index] : {};
  const oldAmount = isEditing ? parseAmount(oldData.المبلغ) : 0;
  const amount = parseAmount(iAmount.value);
  if (amount === 0) return toastMsg(translate('amountMustBePositive'), "error");
  const data = isEditing ? { ...oldData } : {};
  data.المبلغ = getFormattedAmount(amount);
  data.الفئة = iType.value;
  data.الوصف = iDesc.value || '—';
  data.التاريخ = iDate.value;
  data.clientId = isEditing ? oldData.clientId : `inc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  try {
    await saveData('inc', data);
    await processBalanceChange(amount, 'income', `${translate('incomeLogPrefix')}: ${data.الفئة} (${data.الوصف})`, data.clientId,
      isEditing, oldAmount);
    toastMsg(isEditing ? translate('incomeEdited') : translate('incomeSaved'), "success");
    postSaveCleanup(isEditing, 'inc');
  } catch (err) { toastMsg(translate('saveFailed'), "error"); console.error(err); }
}

// 11.2 EXPENSES
async function addExpense() {
  const eAmount = document.getElementById('eAmount');
  const eType = document.getElementById('eType');
  const eDate = document.getElementById('eDate');
  const eDesc = document.getElementById('eDesc');
  if (!eAmount.value || !eType.value || !eDate.value) return toastMsg(translate('fillRequired'), "error");
  const isEditing = editMode && editMode.type === 'exp';
  const oldData = isEditing ? db.exp[editMode.index] : {};
  const oldAmount = isEditing ? parseAmount(oldData.المبلغ) * -1 : 0;
  const amount = parseAmount(eAmount.value);
  if (amount === 0) return toastMsg(translate('amountMustBePositive'), "error");
  const data = isEditing ? { ...oldData } : {};
  data.المبلغ = getFormattedAmount(amount);
  data.الفئة = eType.value;
  data.الوصف = eDesc.value || '—';
  data.التاريخ = eDate.value;
  data.clientId = isEditing ? oldData.clientId : `exp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const img = getSelectedImage();
  if (img && typeof img === 'string' && img.startsWith('data:image')) {
    data.صورة = img;
  } else if (!isEditing) {
    delete data.صورة;
  } else {
    if (oldData.صورة) data.صورة = oldData.صورة;
    else delete data.صورة;
  }
  try {
    await saveData('exp', data);
    await processBalanceChange(amount, 'expense', `${translate('expenseLogPrefix')}: ${data.الفئة} (${data.الوصف})`, data.clientId,
      isEditing, oldAmount);
    toastMsg(isEditing ? translate('expenseEdited') : translate('expenseSaved'), "success");
    postSaveCleanup(isEditing, 'exp');
  } catch (err) { toastMsg(translate('saveFailed'), "error"); console.error(err); }
}

// 11.3 RIGHTS
function updateRightFields(type, currentData = null) {
  const container = document.getElementById('rDynamicFields');
  container.innerHTML = '';
  let paidHtml = `
    <input id="rPaidAmount" type="text" placeholder="💰 ${translate('collectedAmount')}" oninput="formatAmount(this)" inputmode="decimal" pattern="[0-9]*" value="${currentData && currentData.المبلغ_المدفوع ? parseAmount(currentData.المبلغ_المدفوع).toLocaleString('en-US') : ''}" />
    <span class="field-hint">${translate('collectedAmountHint')}</span>
  `;
  container.innerHTML = paidHtml;
}

async function addRight() {
  const rAmount = document.getElementById('rAmount');
  const rType = document.getElementById('rType');
  const rEntity = document.getElementById('rEntity');
  const rDueDate = document.getElementById('rDueDate');
  const rDesc = document.getElementById('rDesc');
  const rPaidAmount = document.getElementById('rPaidAmount');
  if (!rAmount.value || !rType.value || !rDueDate.value) return toastMsg(translate('fillRequired'), "error");
  const isEditing = editMode && editMode.type === 'rig';
  const oldData = isEditing ? db.rig[editMode.index] : {};
  const total = parseAmount(rAmount.value);
  if (total === 0) return toastMsg(translate('amountMustBePositive'), "error");
  const paid = parseAmount(rPaidAmount ? rPaidAmount.value : 0);
  if (paid > total) {
    toastMsg(translate('paidExceedsTotal'), "error");
    return;
  }
  const data = isEditing ? { ...oldData } : {};
  data.clientId = isEditing ? oldData.clientId : `rig-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  data.النوع = rType.value;
  data.المبلغ = getFormattedAmount(total);
  data.الجهة = rEntity.value || '—';
  data.تاريخ_الاستحقاق = rDueDate.value;
  data.الوصف = rDesc.value || '—';
  data.المبلغ_المدفوع = getFormattedAmount(paid);
  const remaining = total - paid;
  data.المتبقي = getFormattedAmount(remaining);
  let status = translate('statusUnpaid');
  if (remaining <= 0) status = translate('statusFullyPaid');
  else if (paid > 0) status = translate('statusPartiallyPaid');
  else status = translate('statusUnpaid');
  data.الحالة = status;
  data.المبلغ_المضاف_للرصيد = paid;
  const oldPaid = isEditing ? parseAmount(oldData.المبلغ_المضاف_للرصيد || 0) : 0;
  try {
    await saveData('rig', data);
    await processBalanceChange(paid, 'right_collection', `${translate('rightLogPrefix')}: ${data.النوع} (${data.الجهة})`, data.clientId,
      isEditing, oldPaid);
    toastMsg(isEditing ? translate('rightEdited') : translate('rightSaved'), "success");
    postSaveCleanup(isEditing, 'rig');
  } catch (err) { toastMsg(translate('saveFailed'), "error"); console.error(err); }
}

// 11.4 DEBTS
function updateDebtFields(type, currentData = null) {
  const container = document.getElementById('dDynamicFields');
  const amountInput = document.getElementById('dAmount');
  const statusSelect = document.getElementById('dStatus');
  const entityInput = document.getElementById('dEntity');
  container.innerHTML = '';
  const entityTypes = ['🏠 إيجار', '👤 دين شخصي', '📱 الاتصالات والإنترنت', '🎓 رسوم تعليمية', '🏥 مصاريف طبية مستحقة', '🚗 تمويل السيارة', '👨‍‍👧 التزامات عائلية', '📅 اشتراكات دورية', '👨‍💼 رواتب', '💡 كهرباء', '💧 ماء'];
  if (entityTypes.includes(type)) {
    entityInput.style.display = 'block';
    if (currentData && currentData.الجهة) {
      entityInput.value = currentData.الجهة;
    }
  } else {
    entityInput.style.display = 'none';
    entityInput.value = '';
  }
  const masterTypes = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة'];
  if (masterTypes.includes(type)) {
    amountInput.style.display = 'none';
    statusSelect.style.display = 'none';
    amountInput.value = '';
    statusSelect.value = '';
    let html = `
      <input id="dTotalAmount" type="text" placeholder="💵 ${translate('totalAmount')}" oninput="formatAmount(this)" inputmode="decimal" pattern="[0-9]*" value="${currentData && currentData.المبلغ_الكلي_للالتزام ? parseAmount(currentData.المبلغ_الكلي_للالتزام).toLocaleString('en-US') : ''}" />
      <span class="field-hint">${translate('totalAmountHint')}</span>
    `;
    if (type === '🏦 قروض وتمويل' || type === '🛒 مشتريات بالتقسيط' || type === '🚗 تمويل السيارة') {
      html += `
        <input id="dInstallments" type="number" placeholder="${translate('totalInstallments')}" value="${currentData && currentData.عدد_الاقساط ? currentData.عدد_الاقساط : ''}" />
        <input id="dPaidInstallments" type="number" placeholder="${translate('paidInstallments')}" value="${currentData && currentData.الأقساط_المدفوعة ? currentData.الأقساط_المدفوعة : ''}" />
      `;
    } else {
      html += `
        <input id="dPaidAmount" type="text" placeholder="💰 ${translate('totalPaidSoFar')}" oninput="formatAmount(this)" inputmode="decimal" pattern="[0-9]*" value="${currentData && currentData.إجمالي_المدفوع ? parseAmount(currentData.إجمالي_المدفوع).toLocaleString('en-US') : ''}" />
      `;
    }
    container.innerHTML = html;
  } else {
    amountInput.style.display = 'block';
    statusSelect.style.display = 'block';
    if (currentData) {
      amountInput.value = parseAmount(currentData.المبلغ || 0).toLocaleString('en-US');
      statusSelect.value = currentData.الحالة || '';
    }
  }
  if (!masterTypes.includes(type)) {
    statusSelect.onchange = function () {
      const status = statusSelect.value;
      const partialPaidContainer = document.getElementById('dPartialPaidContainer');
      if (status === 'مدفوع جزئياً') {
        if (!partialPaidContainer) {
          const paidInput = document.createElement('div');
          paidInput.id = 'dPartialPaidContainer';
          paidInput.innerHTML = `
            <input id="dPartialPaidAmount" type="text" placeholder="💰 ${translate('partialPaidAmount')}" oninput="formatAmount(this)" inputmode="decimal" pattern="[0-9]*" />
            <span class="field-hint">${translate('partialPaidHint')}</span>
          `;
          statusSelect.parentNode.insertBefore(paidInput, statusSelect.nextSibling);
        }
      } else {
        if (partialPaidContainer) partialPaidContainer.remove();
      }
    };
    statusSelect.onchange();
    if (currentData && currentData.الحالة === 'مدفوع جزئياً' && currentData.المبلغ_المدفوع_جزئياً) {
      const paidInput = document.getElementById('dPartialPaidAmount');
      if (paidInput) paidInput.value = parseAmount(currentData.المبلغ_المدفوع_جزئياً).toLocaleString('en-US');
    }
  }
}

async function addDebt() {
  const dType = document.getElementById('dType');
  const dAmount = document.getElementById('dAmount');
  const dEntity = document.getElementById('dEntity');
  const dDueDate = document.getElementById('dDueDate');
  const dDesc = document.getElementById('dDesc');
  const dStatus = document.getElementById('dStatus');
  if (!dType.value || !dDueDate.value) return toastMsg(translate('fillRequired'), "error");
  const isEditing = editMode && editMode.type === 'deb';
  const oldData = isEditing ? db.deb[editMode.index] : {};
  const masterTypes = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة'];
  const isMaster = masterTypes.includes(dType.value);
  const data = isEditing ? { ...oldData } : {};
  data.clientId = isEditing ? oldData.clientId : `deb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  data.النوع = dType.value;
  data.تاريخ_الاستحقاق = dDueDate.value;
  data.الوصف = dDesc.value || '—';
  if (dEntity.style.display !== 'none' && dEntity.value) {
    data.الجهة = dEntity.value;
  } else {
    data.الجهة = '—';
  }
  let paidAmount = 0;
  let oldPaid = isEditing ? parseAmount(oldData.المبلغ_المخصوم_للرصيد || 0) : 0;
  if (isMaster) {
    const totalInput = document.getElementById('dTotalAmount');
    if (!totalInput || !totalInput.value) return toastMsg(translate('enterTotalAmount'), "error");
    const total = parseAmount(totalInput.value);
    if (total === 0) return toastMsg(translate('amountMustBePositive'), "error");
    data.المبلغ_الكلي_للالتزام = getFormattedAmount(total);
    let totalPaid = 0;
    const isLoanOrInstallment = (dType.value === '🏦 قروض وتمويل' || dType.value === '🛒 مشتريات بالتقسيط' || dType.value === '🚗 تمويل السيارة');
    if (isLoanOrInstallment) {
      const installmentsInput = document.getElementById('dInstallments');
      const paidInstallmentsInput = document.getElementById('dPaidInstallments');
      if (!installmentsInput || !installmentsInput.value) return toastMsg(translate('enterInstallments'), "error");
      const installments = parseInt(installmentsInput.value) || 0;
      const paidInstallments = parseInt(paidInstallmentsInput ? paidInstallmentsInput.value : 0) || 0;
      if (installments <= 0) return toastMsg(translate('installmentsPositive'), "error");
      if (paidInstallments > installments) return toastMsg(translate('paidInstallmentsExceed'), "error");
      const installmentVal = total / installments;
      totalPaid = paidInstallments * installmentVal;
      data.عدد_الاقساط = installments;
      data.قيمة_القسط = getFormattedAmount(installmentVal);
      data.الأقساط_المدفوعة = paidInstallments;
    } else {
      const paidInput = document.getElementById('dPaidAmount');
      if (paidInput) totalPaid = parseAmount(paidInput.value);
      if (totalPaid > total) return toastMsg(translate('paidExceedsTotalDebt'), "error");
    }
    data.إجمالي_المدفوع = getFormattedAmount(totalPaid);
    data.المتبقي_للالتزام = getFormattedAmount(total - totalPaid);
    data.المبلغ = '—';
    data.الحالة = (total - totalPaid) <= 0 ? translate('statusPaid') : translate('statusPartiallyPaid');
    paidAmount = totalPaid;
  } else {
    if (!dAmount.value || !dStatus.value) return toastMsg(translate('fillRequired'), "error");
    const amt = parseAmount(dAmount.value);
    if (amt === 0) return toastMsg(translate('amountMustBePositive'), "error");
    data.المبلغ = getFormattedAmount(amt);
    data.الحالة = dStatus.value;
    if (dStatus.value === 'مدفوع جزئياً') {
      const partialPaidInput = document.getElementById('dPartialPaidAmount');
      if (!partialPaidInput || !partialPaidInput.value) return toastMsg(translate('enterPartialPaid'), "error");
      const partialPaid = parseAmount(partialPaidInput.value);
      if (partialPaid <= 0) return toastMsg(translate('partialPaidPositive'), "error");
      if (partialPaid >= amt) return toastMsg(translate('partialPaidLessThanTotal'), "error");
      paidAmount = partialPaid;
      data.المبلغ_المدفوع_جزئياً = getFormattedAmount(partialPaid);
    } else if (dStatus.value === 'مدفوع' || dStatus.value === 'مدفوع بالكامل') {
      paidAmount = amt;
    } else {
      paidAmount = 0;
    }
    delete data.المبلغ_الكلي_للالتزام;
    delete data.إجمالي_المدفوع;
    delete data.المتبقي_للالتزام;
    delete data.عدد_الاقساط;
    delete data.قيمة_القسط;
    delete data.الأقساط_المدفوعة;
    if (dStatus.value !== 'مدفوع جزئياً') {
      delete data.المبلغ_المدفوع_جزئياً;
    }
  }
  data.المبلغ_المخصوم_للرصيد = paidAmount;
  const oldNetChange = isEditing ? -oldPaid : 0;
  try {
    await saveData('deb', data);
    await processBalanceChange(paidAmount, 'debt_payment', `${translate('debtLogPrefix')}: ${data.النوع} (${data.الجهة})`, data.clientId,
      isEditing, oldNetChange);
    toastMsg(isEditing ? translate('debtEdited') : translate('debtSaved'), "success");
    postSaveCleanup(isEditing, 'deb');
  } catch (err) { toastMsg(translate('saveFailed'), "error"); console.error(err); }
}

function postSaveCleanup(isEditing, type) {
  closeAllLayers();
  loadAllData().then(() => {
    updateStats();
    updateBalanceDisplay();
  });
  editMode = null;
  clearFields();
}

// =============================================================
// 12. DETAIL & LOG RENDERING + FILTERS
// =============================================================
function inPeriod(dateStr, period) {
  if (period === 'all' || !dateStr) return true;
  const d = new Date(dateStr);
  if (isNaN(d)) return true;
  const now = new Date();
  if (period === 'today') return d.toDateString() === now.toDateString();
  if (period === 'week') { const w = new Date(now); w.setDate(now.getDate() - 7); return d >= w; }
  if (period === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (period === 'year') return d.getFullYear() === now.getFullYear();
  return true;
}

function matchStatus(st, f) {
  st = st || '';
  if (f === 'paid') return (/مدفوع بالكامل/.test(st) || /مدفوع$/.test(st) || /Fully Paid/.test(st) || /^Paid$/.test(st)) && !/جزئ|Partial/.test(st) && !/غير|Unpaid/.test(st);
  if (f === 'partial') return /جزئياً|Partial/.test(st);
  if (f === 'unpaid') return /غير مدفوع|Unpaid/.test(st);
  if (f === 'late') return /متأخر|Overdue/.test(st);
  return true;
}

function setLogFilter(kind, value) { logFilters[kind] = value; renderLog(); }
function setBalanceFilter(kind, value) { balanceFilters[kind] = value; renderBalanceLog(); }

function buildLogFilters() {
  const catSel = document.getElementById('logFilterCat');
  const statusSel = document.getElementById('logFilterStatus');
  const periodSel = document.getElementById('logFilterPeriod');
  if (!catSel || !statusSel || !periodSel) return;
  logFilters = { cat: 'all', status: 'all', period: 'all' };
  let catOptions = '';
  if (currentLog === 'inc' || currentLog === 'exp') {
    const src = document.getElementById(currentLog === 'inc' ? 'iType' : 'eType');
    catOptions = Array.from(src.options).filter(o => o.value).map(o => `<option value="${o.value}">${o.textContent}</option>`).join('');
    catSel.style.display = 'block';
  } else if (currentLog === 'rig' || currentLog === 'deb') {
    const src = document.getElementById(currentLog === 'rig' ? 'rType' : 'dType');
    catOptions = Array.from(src.options).filter(o => o.value).map(o => `<option value="${o.value}">${o.textContent}</option>`).join('');
    catSel.style.display = 'block';
  } else { catSel.style.display = 'none'; }
  catSel.innerHTML = `<option value="all">${translate('allCategories')}</option>` + catOptions;
  if (currentLog === 'rig' || currentLog === 'deb') {
    statusSel.style.display = 'block';
    statusSel.innerHTML = `<option value="all">${translate('allStatuses')}</option><option value="paid">${translate('statusPaid')}</option><option value="partial">${translate('statusPartiallyPaidShort')}</option><option value="unpaid">${translate('statusUnpaid')}</option><option value="late">${translate('statusOverdue')}</option>`;
  } else { statusSel.style.display = 'none'; }
  periodSel.innerHTML = `<option value="all">${translate('periodAll')}</option><option value="today">${translate('periodToday')}</option><option value="week">${translate('periodWeek')}</option><option value="month">${translate('periodMonth')}</option><option value="year">${translate('periodYear')}</option>`;
}

function buildBalanceFilters() {
  const typeSel = document.getElementById('balanceFilterType');
  if (!typeSel) return;
  typeSel.innerHTML = `<option value="all">${translate('allTypes')}</option><option value="deposit">${translate('deposit')}</option><option value="withdraw">${translate('withdraw')}</option>`;
  typeSel.value = balanceFilters.type || 'all';
}

function renderLogStats(list, field) {
  const bar = document.getElementById('logStatsBar');
  if (!bar) return;
  let total = 0;
  const byCat = {};
  list.forEach(i => {
    const v = (currentLog === 'deb') ? parseAmount(i.المبلغ_الكلي_للالتزام || i.المبلغ || 0) : parseAmount(i.المبلغ);
    total += v;
    const c = i[field] || '—';
    byCat[c] = (byCat[c] || 0) + v;
  });
  let topName = '—', topVal = 0;
  Object.entries(byCat).forEach(([n, v]) => { if (v > topVal) { topVal = v; topName = n; } });
  const titles = { inc: translate('topIncomeSource'), exp: translate('topExpenseCategory'), rig: translate('topRightsType'), deb: translate('topDebtsType') };
  bar.innerHTML = `
    <div class="log-stat-chip"><span class="stat-label">${translate('operationsCount')}</span><span class="stat-value">${list.length}</span></div>
    <div class="log-stat-chip"><span class="stat-label">${translate('totalAmountStat')}</span><span class="stat-value">${getFormattedAmount(total)}</span></div>
    <div class="log-stat-chip"><span class="stat-label">${titles[currentLog] || ''}</span><span class="stat-value">${topName} (${getFormattedAmount(topVal)})</span></div>`;
}

function _renderDetailContent(o, type) {
  const el = document.getElementById('detailContent');
  let html = `<div class="card" style="border-top-color:var(--p);"><h3 style="color:var(--p);margin-top:0;"><i class="fas fa-info-circle" style="margin-left:5px;"></i> ${translate('details')}</h3>`;
  for (const [key, val] of Object.entries(o)) {
    if (['id', 'clientId', 'صورة', 'المبلغ_المضاف_للرصيد', 'المبلغ_المخصوم_للرصيد'].includes(key)) continue;
    if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '' && key !== 'الوصف'))
      continue;
    const isAmt = key.includes('المبلغ') || key.includes('المدفوع') || key.includes('المتبقي') || key.includes('القسط') || key.includes('إجمالي');
    const display = isAmt ? formatCurrency(val, true) : val;
    html += `<p style="margin:6px 0;"><strong>${key.replace(/_/g, ' ')}:</strong> <span>${display}</span></p>`;
  }
  html += `</div>`;
  if (o.صورة && type === 'exp') {
    html += `<div class="card" style="border-top-color:var(--s);"><h3 style="color:var(--s);margin-top:0;"><i class="fas fa-image" style="margin-left:5px;"></i> ${translate('invoiceImage')}</h3><img src="${o.صورة}" alt="${translate('invoice')}" style="width:100%;border-radius:10px;margin-top:10px;box-shadow:var(--shadow-light);" /></div>`;
  }
  html += `<div style="display:flex;gap:10px;margin-top:20px;"><button class="secondary" onclick="editTransaction()" style="flex:1;"><i class="fas fa-edit" style="margin-left:5px;"></i> ${translate('edit')}</button><button class="action" onclick="deleteTransaction()" style="background:var(--danger);flex:1;"><i class="fas fa-trash" style="margin-left:5px;"></i> ${translate('delete')}</button></div>`;
  el.innerHTML = html;
}

function renderLog() {
  const el = document.getElementById('logContent');
  const items = db[currentLog] || [];
  const search = document.getElementById('search').value.toLowerCase();
  const field = (currentLog === 'inc' || currentLog === 'exp') ? 'الفئة' : 'النوع';
  let filtered = items.filter(i => Object.values(i).some(v => String(v).toLowerCase().includes(search)));
  if (logFilters.cat !== 'all') filtered = filtered.filter(i => i[field] === logFilters.cat);
  if ((currentLog === 'rig' || currentLog === 'deb') && logFilters.status !== 'all') filtered = filtered.filter(i => matchStatus(i.الحالة, logFilters.status));
  if (logFilters.period !== 'all') filtered = filtered.filter(i => inPeriod(i.التاريخ || i.تاريخ_الاستحقاق, logFilters.period));
  renderLogStats(filtered, field);
  if (!filtered.length) {
    el.innerHTML =
      `<p style="text-align:center;color:#999;padding:30px 0;"><i class="fas fa-inbox" style="font-size:2em;display:block;margin-bottom:10px;"></i>${translate('noTransactions')}</p>`;
    return;
  }
  el.innerHTML = filtered.map(i => {
    const isInc = currentLog === 'inc';
    const isExp = currentLog === 'exp';
    const isRig = currentLog === 'rig';
    const isDeb = currentLog === 'deb';
    let amountVal = 0;
    let amountDisplay = '';
    let desc = i.الوصف || i.الفئة || i.النوع || '—';
    let date = formatDateTime(i.التاريخ || i.تاريخ_الاستحقاق);
    let borderColor = 'var(--s)';
    let statusBadge = '';
    let amountColor = 'var(--text-dark)';
    let entity = i.الجهة || '';
    if (isInc) {
      amountVal = parseAmount(i.المبلغ);
      amountDisplay = '+' + formatCurrency(amountVal);
      amountColor = 'var(--success)';
      borderColor = 'var(--success)';
      statusBadge = `<span class="status-badge paid" style="background:var(--success);">${translate('income')}</span>`;
    } else if (isExp) {
      amountVal = parseAmount(i.المبلغ);
      amountDisplay = formatCurrency(amountVal);
      borderColor = 'var(--danger)';
      amountColor = 'var(--danger)';
    } else if (isRig) {
      const st = i.الحالة || '';
      if (st.includes('كامل') || st === 'مدفوع بالكامل') {
        borderColor = 'var(--success)';
        statusBadge = `<span class="status-badge paid">${translate('statusPaid')}</span>`;
      } else if (st.includes('جزئياً') || st === 'مدفوع جزئياً') {
        borderColor = 'var(--warning)';
        statusBadge = `<span class="status-badge partial">${translate('statusPartiallyPaidShort')}</span>`;
      } else if (st === 'متأخر') {
        borderColor = '#e67e22';
        statusBadge = `<span class="status-badge late">${translate('statusOverdue')}</span>`;
      } else {
        borderColor = 'var(--danger)';
        statusBadge = `<span class="status-badge unpaid">${translate('statusUnpaid')}</span>`;
      }
      amountVal = parseAmount(i.المبلغ);
      amountDisplay = formatCurrency(amountVal);
      amountColor = 'var(--success)';
    } else if (isDeb) {
      const st = i.الحالة || '';
      const masterTypes = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة'];
      const isMaster = masterTypes.includes(i.النوع);
      if (isMaster) {
        borderColor = 'var(--p)';
        const rem = parseAmount(i.المتبقي_للالتزام || 0);
        statusBadge = `<span style="font-size:0.8em;color:var(--p);">${translate('remaining')}: ${formatCurrency(rem)}</span>`;
        amountColor = 'var(--p)';
        amountVal = parseAmount(i.المبلغ_الكلي_للالتزام);
        amountDisplay = formatCurrency(amountVal);
      } else {
        if (st === 'مدفوع' || st === 'مدفوع بالكامل') {
          borderColor = 'var(--success)';
          statusBadge = `<span class="status-badge paid">${translate('statusPaid')}</span>`;
        } else if (st === 'مدفوع جزئياً') {
          borderColor = 'var(--warning)';
          statusBadge = `<span class="status-badge partial">${translate('statusPartiallyPaidShort')}</span>`;
        } else if (st === 'متأخر') {
          borderColor = '#e67e22';
          statusBadge = `<span class="status-badge late">${translate('statusOverdue')}</span>`;
        } else {
          borderColor = 'var(--danger)';
          statusBadge = `<span class="status-badge unpaid">${translate('statusUnpaid')}</span>`;
        }
        amountColor = borderColor;
        amountVal = parseAmount(i.المبلغ);
        amountDisplay = formatCurrency(amountVal);
      }
    }
    const imgIcon = i.صورة ? '<i class="fas fa-camera" style="margin-left:5px;color:var(--p);"></i>' : '';
    const entityDisplay = entity && entity !== '—' ?
      `<span style="font-size:0.85em;color:#888;">${entity}</span>` : '';
    const itemId = i.clientId || i.id || `temp-${Date.now()}`;
    return `
      <div class="list-item" style="border-right-color:${borderColor};" onclick="showDetailById('${itemId}','${currentLog}')">
        <div style="font-weight:bold;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
          <span>${imgIcon} ${desc} ${entityDisplay}</span>
          <span style="color:${amountColor};">${amountDisplay}</span>
        </div>
        <div class="details">
          <span>${i.النوع || i.الفئة || ''} ${statusBadge}</span>
          <span><i class="far fa-clock" style="margin-left:4px;"></i>${date}</span>
        </div>
        <div class="log-item-hint"><i class="fas fa-hand-pointer"></i> ${translate('clickForDetails')}</div>
      </div>
    `;
  }).join('');
}

function showDetailById(id, type) {
  openLayer('detail', { logType: type, id: id });
}

function editTransaction() {
  if (!editMode) return;
  const type = editMode.type;
  const data = db[type][editMode.index];
  const tabMap = { inc: 'income', exp: 'expenses', rig: 'rights', deb: 'debts' };
  const tabId = tabMap[type];
  closeAllLayers();
  openTab(tabId, true);
  setTimeout(() => {
    if (type === 'inc') {
      document.getElementById('iAmount').value = parseAmount(data.المبلغ).toLocaleString('en-US');
      document.getElementById('iType').value = data.الفئة;
      document.getElementById('iDesc').value = data.الوصف;
      document.getElementById('iDate').value = data.التاريخ;
    } else if (type === 'exp') {
      document.getElementById('eAmount').value = parseAmount(data.المبلغ).toLocaleString('en-US');
      document.getElementById('eType').value = data.الفئة;
      document.getElementById('eDesc').value = data.الوصف;
      document.getElementById('eDate').value = data.التاريخ;
      if (data.صورة) {
        document.getElementById('eImgName').textContent = '📎 ' + translate('imageAttached');
        selectedImageFile = data.صورة;
      } else {
        selectedImageFile = null;
        document.getElementById('eImgName').textContent = '';
      }
    } else if (type === 'rig') {
      document.getElementById('rType').value = data.النوع;
      document.getElementById('rEntity').value = data.الجهة || '';
      document.getElementById('rAmount').value = parseAmount(data.المبلغ).toLocaleString('en-US');
      document.getElementById('rDueDate').value = data.تاريخ_الاستحقاق || '';
      document.getElementById('rDesc').value = data.الوصف;
      updateRightFields(data.النوع, data);
      const paidInput = document.getElementById('rPaidAmount');
      if (paidInput) paidInput.value = parseAmount(data.المبلغ_المدفوع || 0).toLocaleString('en-US');
    } else if (type === 'deb') {
      document.getElementById('dType').value = data.النوع;
      document.getElementById('dDueDate').value = data.تاريخ_الاستحقاق || '';
      document.getElementById('dDesc').value = data.الوصف;
      const entityInput = document.getElementById('dEntity');
      if (data.الجهة && data.الجهة !== '—') {
        entityInput.value = data.الجهة;
        entityInput.style.display = 'block';
      } else {
        entityInput.value = '';
        entityInput.style.display = 'none';
      }
      updateDebtFields(data.النوع, data);
      const masterTypes = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة'];
      const isMaster = masterTypes.includes(data.النوع);
      if (!isMaster) {
        document.getElementById('dAmount').value = parseAmount(data.المبلغ).toLocaleString('en-US');
        document.getElementById('dStatus').value = data.الحالة || '';
        const event = new Event('change');
        document.getElementById('dStatus').dispatchEvent(event);
        if (data.الحالة === 'مدفوع جزئياً' && data.المبلغ_المدفوع_جزئياً) {
          const paidInput = document.getElementById('dPartialPaidAmount');
          if (paidInput) paidInput.value = parseAmount(data.المبلغ_المدفوع_جزئياً).toLocaleString('en-US');
        }
      }
    }
    const indicatorMap = { inc: 'incEditIndicator', exp: 'expEditIndicator', rig: 'rigEditIndicator', deb: 'debEditIndicator' };
    const ind = document.getElementById(indicatorMap[type]);
    if (ind) ind.style.display = 'inline-block';
  }, 100);
}

async function deleteTransaction() {
  if (!editMode) return;
  if (!confirm(translate('confirmDeleteTransaction'))) return;
  const type = editMode.type;
  const txn = db[type][editMode.index];
  const id = txn.id || txn.clientId;
  try {
    await deleteFromDB(type, id);
    if (txn.clientId) {
      const idx = db.bal.changes.findIndex(c => c.id === txn.clientId);
      if (idx > -1) {
        const oldNet = db.bal.changes[idx].القيمة_الصافية;
        db.bal.changes.splice(idx, 1);
        currentBalance -= oldNet;
        db.bal.amount = currentBalance;
        await saveData('bal', db.bal);
      }
    }
    editMode = null;
    await loadAllData();
    toastMsg(translate('deletedSuccess'), "success");
    updateStats();
    updateBalanceDisplay();
    closeAllLayers();
    openTab('overview');
  } catch (err) { toastMsg(translate('deleteFailed'), "error"); console.error(err); }
}

// =============================================================
// 13. UPDATE STATS — أشرطة مالية عصرية + منتقي الفترة + صافي الوضع
// =============================================================
let statsPeriod = 'month';

function setStatsPeriod(v) {
  statsPeriod = v;
  updateStats();
}

function setStatRow(barId, pctId, refId, pct, refVal) {
  const v = Math.max(0, Math.min(100, pct || 0));
  const bar = document.getElementById(barId);
  if (bar) bar.style.width = v + '%';
  const p = document.getElementById(pctId);
  if (p) p.textContent = Math.round(v) + '%';
  const r = document.getElementById(refId);
  if (r) r.innerHTML = translate('statOf') + ' ' + formatCurrency(refVal);
}

function updateStats() {
  let incTotal = 0, expTotal = 0, rigTotal = 0, debTotal = 0, rigPaid = 0, debPaid = 0;
  const inP = (d) => inPeriod(d, statsPeriod);
  db.inc.forEach(i => { if (inP(i.التاريخ)) incTotal += parseAmount(i.المبلغ); });
  db.exp.forEach(i => { if (inP(i.التاريخ)) expTotal += parseAmount(i.المبلغ); });
  db.rig.forEach(i => {
    if (inP(i.التاريخ || i.تاريخ_الاستحقاق)) {
      rigTotal += parseAmount(i.المبلغ);
      rigPaid += parseAmount(i.المبلغ_المضاف_للرصيد || 0);
    }
  });
  db.deb.forEach(i => {
    if (inP(i.التاريخ || i.تاريخ_الاستحقاق)) {
      debTotal += parseAmount(i.المبلغ_الكلي_للالتزام || i.المبلغ || 0);
      debPaid += parseAmount(i.المبلغ_المخصوم_للرصيد || 0);
    }
  });

  document.getElementById('sIncTotal').innerHTML = '<span class="pulse-dot"></span>' + formatCurrency(incTotal, true);
  document.getElementById('sExpTotal').innerHTML = formatCurrency(expTotal, true);
  document.getElementById('sRigTotal').innerHTML = formatCurrency(rigTotal, rigTotal > 0);
  document.getElementById('sRigPaid').innerHTML = '<span class="pulse-dot"></span>' + formatCurrency(rigPaid, true);
  document.getElementById('sDebTotal').innerHTML = formatCurrency(debTotal, debTotal > 0);
  document.getElementById('sDebPaid').innerHTML = formatCurrency(debPaid, false);

  // ✔ الأشرطة المالية المتحركة
  const flow = incTotal + expTotal;
  setStatRow('barInc', 'pctInc', 'refInc', flow > 0 ? (incTotal / flow) * 100 : 0, flow);
  setStatRow('barExp', 'pctExp', 'refExp', flow > 0 ? (expTotal / flow) * 100 : 0, flow);
  setStatRow('barRigPaid', 'pctRigPaid', 'refRigPaid', rigTotal > 0 ? (rigPaid / rigTotal) * 100 : 0, rigTotal);
  setStatRow('barRigTotal', 'pctRigTotal', 'refRigTotal', rigTotal > 0 ? ((rigTotal - rigPaid) / rigTotal) * 100 : 0, rigTotal);
  setStatRow('barDebPaid', 'pctDebPaid', 'refDebPaid', debTotal > 0 ? (debPaid / debTotal) * 100 : 0, debTotal);
  setStatRow('barDebTotal', 'pctDebTotal', 'refDebTotal', debTotal > 0 ? ((debTotal - debPaid) / debTotal) * 100 : 0, debTotal);

  // ✔ بطاقة صافي الوضع المالي
  const netEl = document.getElementById('netAmount');
  if (netEl) netEl.innerHTML = formatBalance(currentBalance);
  const netPct = flow > 0 ? Math.round((incTotal / flow) * 100) : (parseAmount(currentBalance) > 0 ? 100 : 0);
  const pctEl = document.getElementById('netStatusPct');
  if (pctEl) pctEl.textContent = netPct + '% ' + translate('ofTarget');
  const chip = document.getElementById('netStatusChip');
  if (chip) {
    let cls = 'bad', txt = translate('netBad');
    if (netPct >= 80) { cls = 'excellent'; txt = translate('netExcellent'); }
    else if (netPct >= 50) { cls = 'good'; txt = translate('netGood'); }
    else if (netPct >= 25) { cls = 'medium'; txt = translate('netMedium'); }
    chip.className = 'net-chip ' + cls;
    chip.innerHTML = '<span class="net-dot"></span>' + txt;
  }
}

// =============================================================
// 13.5 ✔ نظام الأهداف المالية التلقائي (FINANCIAL GOALS SYSTEM)
// =============================================================
const GOALS_STORAGE_KEY = 'smartBudgetGoals';
let goals = [];
let goalEditMode = null;

function loadGoals() {
  try { goals = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY)) || []; }
  catch (e) { goals = []; }
}

function saveGoalsToStorage() {
  localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getGoalTypes() {
  return {
    savings:       { icon: 'fa-piggy-bank',          color: '#2a9d8f', label: translate('goalTypeSavings'),      defaultName: translate('goalDefaultSavings'),      targetHint: translate('goalTargetHintSavings') },
    rights:        { icon: 'fa-hand-holding-usd',    color: '#3b82f6', label: translate('goalTypeRights'),       defaultName: translate('goalDefaultRights'),       targetHint: translate('goalTargetHintRights') },
    debts:         { icon: 'fa-file-invoice-dollar', color: '#f59e0b', label: translate('goalTypeDebts'),        defaultName: translate('goalDefaultDebts'),        targetHint: translate('goalTargetHintDebts') },
    expense_limit: { icon: 'fa-chart-line',          color: '#ef476f', label: translate('goalTypeExpenseLimit'), defaultName: translate('goalDefaultExpenseLimit'), targetHint: translate('goalTargetHintExpense') }
  };
}

// ✔ القيمة الحالية للهدف تُحسب تلقائياً من بيانات التطبيق
function goalCurrentValue(goal) {
  switch (goal.type) {
    case 'savings':
      return parseAmount(currentBalance);
    case 'rights': {
      let t = 0;
      db.rig.forEach(i => t += parseAmount(i.المبلغ_المضاف_للرصيد || 0));
      return t;
    }
    case 'debts': {
      let t = 0;
      db.deb.forEach(i => t += parseAmount(i.المبلغ_المخصوم_للرصيد || 0));
      return t;
    }
    case 'expense_limit': {
      const now = new Date();
      let t = 0;
      db.exp.forEach(i => {
        const d = new Date(i.التاريخ);
        if (!isNaN(d) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) t += parseAmount(i.المبلغ);
      });
      return t;
    }
  }
  return 0;
}

function goalStatus(goal, pct) {
  if (goal.type === 'expense_limit') {
    return (goalCurrentValue(goal) <= parseAmount(goal.target))
      ? { text: translate('goalStatusWithinLimit'), bg: 'var(--success)' }
      : { text: translate('goalStatusOverLimit'), bg: 'var(--danger)' };
  }
  if (pct >= 100) return { text: translate('goalStatusDone'), bg: 'var(--success)' };
  if (goal.deadline) {
    const d = new Date(goal.deadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!isNaN(d) && d < today) return { text: translate('goalStatusLate'), bg: '#e67e22' };
  }
  return { text: translate('goalStatusInProgress'), bg: 'var(--p)' };
}

function renderGoals() {
  const list = document.getElementById('goalsList');
  if (!list) return;
  if (!translations.ar) return; // انتظار تحميل الترجمات
  if (!goals.length) {
    list.innerHTML = `<div class="goals-empty"><i class="fas fa-bullseye"></i><p>${translate('noGoals')}</p></div>`;
    return;
  }
  const types = getGoalTypes();
  list.innerHTML = goals.map(g => {
    const t = types[g.type] || types.savings;
    const target = parseAmount(g.target);
    const current = goalCurrentValue(g);
    const isLimit = g.type === 'expense_limit';
    const pct = target > 0 ? (current / target) * 100 : 0;
    const displayPct = Math.round(pct);
    const width = Math.max(0, Math.min(100, pct));
    let fillColor = t.color;
    if (isLimit) fillColor = current > target ? 'var(--danger)' : (pct >= 80 ? 'var(--warning)' : 'var(--success)');
    else if (pct >= 100) fillColor = 'var(--success)';
    const st = goalStatus(g, pct);
    const deadlineTxt = g.deadline ? ` • <i class="far fa-clock"></i> ${formatDateTime(g.deadline)}` : '';
    const shownCurrent = (g.type === 'savings') ? formatBalance(current) : formatCurrency(current);
    // ✔ إشعار تلقائي عند تحقيق الهدف (مرة واحدة فقط)
    if (!isLimit && pct >= 100 && !g.achievedNotified) {
      g.achievedNotified = true;
      saveGoalsToStorage();
      setTimeout(() => toastMsg(`${translate('goalAchieved')}: ${g.name || t.defaultName}`, 'success'), 300);
    }
    return `
      <div class="goal-item">
        <div class="goal-top">
          <div class="goal-icon" style="color:${t.color};background:${t.color}1a;"><i class="fas ${t.icon}"></i></div>
          <div class="goal-info">
            <div class="goal-name">${escapeHtml(g.name || t.defaultName)}</div>
            <div class="goal-meta">${t.label}${deadlineTxt}</div>
          </div>
          <div class="goal-actions">
            <button class="goal-edit" onclick="openGoalModal('${g.id}')" title="${translate('edit')}"><i class="fas fa-edit"></i></button>
            <button class="goal-delete" onclick="deleteGoal('${g.id}')" title="${translate('delete')}"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="goal-bar"><div class="goal-bar-fill" data-w="${width}" style="background:${fillColor}"></div></div>
        <div class="goal-bottom">
          <span class="goal-amounts">${shownCurrent} ${translate('goalOf')} ${formatCurrency(target)} • <strong style="color:${fillColor}">${displayPct}%</strong></span>
          <span class="goal-status" style="background:${st.bg}">${st.text}</span>
        </div>
      </div>`;
  }).join('');
  // ✔ تحريك الأشرطة عند الظهور
  requestAnimationFrame(() => requestAnimationFrame(() => {
    list.querySelectorAll('.goal-bar-fill').forEach(f => f.style.width = f.dataset.w + '%');
  }));
}

function openGoalModal(goalId = null) {
  openLayer('goal', { goalId: goalId });
}

function updateGoalFields() {
  const type = document.getElementById('gType').value;
  const hint = document.getElementById('gTargetHint');
  const gTarget = document.getElementById('gTarget');
  const types = getGoalTypes();
  if (hint) hint.textContent = (type && types[type]) ? types[type].targetHint : '';
  if (gTarget) gTarget.placeholder = (type === 'expense_limit') ? translate('goalLimitPlaceholder') : translate('goalTargetPlaceholder');
}

function saveGoal() {
  const type = document.getElementById('gType').value;
  const name = document.getElementById('gName').value.trim();
  const targetVal = document.getElementById('gTarget').value;
  const deadline = document.getElementById('gDeadline').value;
  if (!type) return toastMsg(translate('fillRequired'), "error");
  const target = parseAmount(targetVal);
  if (target <= 0) return toastMsg(translate('amountMustBePositive'), "error");
  if (goalEditMode) {
    const g = goals.find(x => x.id === goalEditMode);
    if (g) {
      const typeChanged = g.type !== type;
      g.type = type;
      g.name = name;
      g.target = target;
      g.deadline = deadline;
      if (typeChanged) g.achievedNotified = false;
      if (type !== 'expense_limit') {
        const pct = target > 0 ? (goalCurrentValue(g) / target) * 100 : 0;
        if (pct < 100) g.achievedNotified = false;
      }
    }
    toastMsg(translate('goalEdited'), 'success');
  } else {
    goals.push({
      id: 'goal-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      type: type,
      name: name,
      target: target,
      deadline: deadline,
      createdAt: getLocalDateString(),
      achievedNotified: false
    });
    toastMsg(translate('goalSaved'), 'success');
  }
  saveGoalsToStorage();
  closeLayer('goal');
  renderGoals();
}

function deleteGoal(id) {
  if (!confirm(translate('confirmDeleteGoal'))) return;
  goals = goals.filter(g => g.id !== id);
  saveGoalsToStorage();
  renderGoals();
  toastMsg(translate('goalDeleted'), 'info');
}

// =============================================================
// 14. OTHER FUNCTIONS (currency, reset, sidebar, etc.)
// =============================================================
function renderCurrencyList() {
  const list = document.getElementById('currencyList');
  const q = document.getElementById('currencySearch').value.toLowerCase();
  const filtered = ARABIC_CURRENCIES.filter(c =>
    getCurrencyName(c).toLowerCase().includes(q) || c.code.toLowerCase().includes(q) ||
    (c.name.ar || '').includes(q) || (c.name.en || '').toLowerCase().includes(q) || (c.name.ur || '').includes(q)
  );
  list.innerHTML = filtered.map(c => `<button class="secondary" style="margin:5px 0;border:1px solid ${c.code === currentCurrency.code ? 'var(--p)' : 'var(--border-color)'};display:flex;justify-content:space-between;align-items:center;" onclick="setCurrency('${c.code}')">
    <span>${c.flag} <strong>${c.symbol}</strong> ${getCurrencyName(c)} (${c.code})</span> ${c.code === currentCurrency.code ? '<i class="fas fa-check" style="color:var(--success);"></i>' : ''}
  </button>`).join('');
}

function setCurrency(code) {
  const sel = ARABIC_CURRENCIES.find(c => c.code === code);
  if (sel) {
    currentCurrency = sel;
    localStorage.setItem('currencyCode', code);
    document.getElementById('sidebarCurrencyLabel').textContent = sel.symbol;
    updateBalanceDisplay();
    updateStats();
    closeLayer('currency');
    toastMsg(`${translate('currencySet')} ${getCurrencyName(sel)} 💱`, "success");
  }
}

function confirmResetData() {
  closeLayer('sidebar');
  if (confirm(translate('confirmReset'))) resetAllData();
}

function resetAllData() {
  if (!IDB_connection) return toastMsg(translate('dbError'), "error");
  const tx = IDB_connection.transaction(STORE_NAMES, 'readwrite');
  let done = 0;
  STORE_NAMES.forEach(sn => {
    const req = tx.objectStore(sn).clear();
    req.onsuccess = () => {
      done++;
      if (done === STORE_NAMES.length) {
        db.exp = db.rig = db.deb = db.inc = [];
        db.bal = { clientId: 1, amount: 0, changes: [] };
        // ✔ جديد: مسح الأهداف أيضاً عند إعادة التعيين
        goals = [];
        saveGoalsToStorage();
        saveData('bal', db.bal).then(() => {
          loadAllData().then(() => {
            updateStats();
            updateBalanceDisplay();
            toastMsg(translate('dataReset'), "success");
          });
        });
      }
    };
    req.onerror = () => toastMsg(translate('resetFailed'), "error");
  });
}

// =============================================================
// 15. SIDEBAR FUNCTIONS
// =============================================================
function openSidebar() { openLayer('sidebar'); }
function openCurrencyModal() { openLayer('currency'); }
function openAboutModal() { openLayer('about'); }
function openBalanceActionModal(actionType) { openLayer('balanceAction', { actionType: actionType }); }
function openBalanceLogModal() { openLayer('balanceLog'); }
function openLog(type) { currentLog = type; openLayer('log', { logType: type }); }
function showImageSourceModal() { openLayer('imageSource'); }
function closeImageSource() { closeLayer('imageSource'); }

function openCameraInput() {
  closeImageSource();
  const input = document.getElementById('eImgCamera');
  input.value = null;
  input.setAttribute('capture', 'environment');
  input.click();
}

function openGalleryInput() {
  closeImageSource();
  const input = document.getElementById('eImgGallery');
  input.value = null;
  input.removeAttribute('capture');
  input.click();
}

function handleImageSelect(input) {
  if (input.files && input.files.length > 0) {
    const file = input.files[0];
    selectedImageFile = file;
    document.getElementById('eImgName').textContent = `✅ ${file.name}`;
    const reader = new FileReader();
    reader.onload = function (e) {
      selectedImageFile = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    document.getElementById('eImgName').textContent = '';
    selectedImageFile = null;
  }
}

function getSelectedImage() { return selectedImageFile; }

function clearSelectedImage() {
  selectedImageFile = null;
  document.getElementById('eImgName').textContent = '';
  document.getElementById('eImgCamera').value = null;
  document.getElementById('eImgGallery').value = null;
}

// =============================================================
// 16. INDEXED DB OPERATIONS
// =============================================================
function initDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { toastMsg(translate('indexedDBUnsupported'), "error"); return reject(new Error("IndexedDB not supported.")); }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = (e) => { console.error("IDB error:", e.target.error); reject(e.target.error); };
    req.onupgradeneeded = (e) => {
      IDB_connection = e.target.result;
      STORE_NAMES.forEach(sn => {
        if (IDB_connection.objectStoreNames.contains(sn)) IDB_connection.deleteObjectStore(sn);
        const kp = (sn === 'bal') ? 'clientId' : 'id';
        const auto = (sn !== 'bal');
        const store = IDB_connection.createObjectStore(sn, { keyPath: kp, autoIncrement: auto });
        if (sn === 'bal') store.add({ clientId: 1, amount: 0, changes: [] });
      });
    };
    req.onsuccess = (e) => {
      IDB_connection = e.target.result;
      resolve(IDB_connection);
      loadAllData().then(() => {
        updateStats();
        updateBalanceDisplay();
      });
    };
  });
}
initDB();

function saveData(storeName, data) {
  return new Promise((resolve, reject) => {
    if (!IDB_connection) return reject(new Error("DB not connected."));
    const tx = IDB_connection.transaction([storeName], "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function deleteFromDB(storeName, id) {
  return new Promise((resolve, reject) => {
    if (!IDB_connection) return reject(new Error("DB not connected."));
    const tx = IDB_connection.transaction([storeName], "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

function loadStoreData(storeName) {
  return new Promise((resolve) => {
    if (!IDB_connection) return resolve(storeName === 'bal' ? { clientId: 1, amount: 0, changes: [] } : []);
    const tx = IDB_connection.transaction([storeName], "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = (e) => {
      if (storeName === 'bal') {
        const res = e.target.result[0];
        return resolve(res || { clientId: 1, amount: 0, changes: [] });
      }
      resolve(e.target.result.reverse());
    };
    req.onerror = () => resolve(storeName === 'bal' ? { clientId: 1, amount: 0, changes: [] } : []);
  });
}

async function loadAllData() {
  const [exp, rig, deb, bal, inc] = await Promise.all([
    loadStoreData('exp'),
    loadStoreData('rig'),
    loadStoreData('deb'),
    loadStoreData('bal'),
    loadStoreData('inc')
  ]);
  db.exp = exp;
  db.rig = rig;
  db.deb = deb;
  db.bal = bal;
  db.inc = inc;
  currentBalance = parseAmount(db.bal.amount || 0);
}

// =============================================================
// 17. DARK MODE
// =============================================================
function loadDarkModePreference() {
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    document.getElementById('darkModeToggle').checked = true;
  }
}

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark);
  toastMsg(isDark ? translate('darkModeOn') : translate('darkModeOff'), "info");
}
loadDarkModePreference();

// =============================================================
// 18. INITIALIZATION
// =============================================================
window.onload = () => {
  if (!history.state || history.state.layer === undefined) {
    history.replaceState({ layer: 'main' }, null, '#main');
    historyStack.push({ layer: 'main' });
  } else {
    historyStack.push(history.state);
  }
  // ✔ جديد: تحميل الأهداف المحفوظة
  loadGoals();
  loadTranslations().then(() => {
    applyTranslations(currentLang);
  });
  const now = getLocalDateString();
  ['eDate', 'rDueDate', 'dDueDate', 'iDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = now;
  });
  const currencyLabel = document.getElementById('sidebarCurrencyLabel');
  if (currencyLabel) currencyLabel.textContent = currentCurrency.symbol;
  updateBalanceDisplay();
  updateStats();
  updateDriveUI();
  setTimeout(() => {
    initGapi();
    initGis();
    restoreDriveState();
  }, 1000);
};

console.log('ميزانيتك الذكية جاهزة ✅');
