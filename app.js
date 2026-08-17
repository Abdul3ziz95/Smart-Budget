// =============================================================
// 0. GOOGLE DRIVE CONFIGURATION
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
// 1. INDEXED DB SETUP
// =============================================================
const IDB_NAME = 'MySmartBudgetDB';
const IDB_VERSION = 7;

const STORE_NAMES = ['exp', 'rig', 'deb', 'bal', 'inc'];
const NOTIFICATIONS_STORE = 'not';
const ALL_STORES = [...STORE_NAMES, NOTIFICATIONS_STORE];

let db = {
  exp: [],
  rig: [],
  deb: [],
  bal: { clientId: 1, amount: 0, changes: [] },
  inc: [],
  not: []
};

let IDB_connection = null;
let currentBalance = 0;
let balanceHidden = localStorage.getItem('balanceHidden') === 'true';

let currentLog = '';
let editMode = null;
let balanceActionType = null;
let selectedImageFile = null;

let logFilters = { cat: 'all', status: 'all', period: 'all' };
let balanceFilters = { type: 'all' };

let notificationSyncInProgress = false;

// =============================================================
// 2. NAVIGATION / LAYERS
// =============================================================
const LAYERS = {
  'sidebar': { elementId: 'appSidebar', type: 'menu' },
  'log': { elementId: 'logModal', type: 'modal' },
  'detail': { elementId: 'detailModal', type: 'modal' },
  'currency': { elementId: 'currencyModal', type: 'modal' },
  'about': { elementId: 'aboutModal', type: 'modal' },
  'balanceAction': { elementId: 'balanceActionModal', type: 'modal' },
  'balanceLog': { elementId: 'balanceLogModal', type: 'modal' },
  'imageSource': { elementId: 'imageSourceModal', type: 'menu' },
  'confirmBackup': { elementId: 'confirmBackupModal', type: 'modal' },
  'driveBackup': { elementId: 'driveBackupModal', type: 'modal' },
  'exportName': { elementId: 'exportNameModal', type: 'modal' },
  'language': { elementId: 'languageModal', type: 'modal' },
  'notifications': { elementId: 'notificationsModal', type: 'modal' }
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
      if (!o) {
        toastMsg(translate('notFound'), 'error');
        return;
      }

      const idx = db[data.logType].findIndex(item => item.clientId === data.id || item.id === data.id);
      editMode = { type: data.logType, index: idx };
      _renderDetailContent(o, data.logType);
    } else if (layerName === 'balanceAction') {
      balanceActionType = data.actionType;

      const titleEl = document.getElementById('actionModalTitle');
      if (titleEl) {
        titleEl.textContent = balanceActionType === 'deposit'
          ? translate('depositTitle')
          : translate('withdrawTitle');
      }

      const balanceEl = document.getElementById('currentBalanceInAction');
      if (balanceEl) balanceEl.innerHTML = formatCurrency(currentBalance);

      const amountEl = document.getElementById('bAmount');
      if (amountEl) amountEl.value = '';

      const descEl = document.getElementById('bDesc');
      if (descEl) descEl.value = '';

      const dateEl = document.getElementById('bDate');
      if (dateEl) dateEl.value = getLocalDateTimeString();
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
    } else if (layerName === 'notifications') {
      renderNotifications();
    }
  } else if (layer.type === 'menu') {
    el.classList.add('open');

    const ov = document.querySelector(
      layerName === 'imageSource' ? '#imageSourceOverlay' : '.sidebar-overlay'
    );

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

    if (clearEdit && (layerName === 'detail' || layerName === 'log')) {
      editMode = null;
    }
  } else if (layer.type === 'menu') {
    el.classList.remove('open');

    const ov = document.querySelector(
      layerName === 'imageSource' ? '#imageSourceOverlay' : '.sidebar-overlay'
    );

    if (ov) ov.classList.remove('open');
  }
}

function openLayer(layerName, data = {}) {
  if (historyStack.length && historyStack[historyStack.length - 1].layer === layerName) return;

  if (layerName === 'detail') {
    const o = db[data.logType]?.find(item => item.clientId === data.id || item.id === data.id);
    if (!o) {
      toastMsg(translate('notFound'), 'error');
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

  if (top && top.layer === layerName) {
    history.back();
  } else {
    _visualClose(layerName, clearEdit);
  }
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
// 3. TRANSLATION SYSTEM (i18n)
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

  const langLabel = document.getElementById('sidebarLanguageLabel');
  if (langLabel) {
    const langNames = {
      ar: '🇸🇦 العربية',
      en: '🇬🇧 English',
      ur: '🇵🇰 اردو'
    };
    langLabel.textContent = langNames[lang] || '🇸🇦 العربية';
  }

  updateBalanceDisplay();
  updateStats();

  if (document.getElementById('logModal').style.display === 'flex') {
    buildLogFilters();
    renderLog();
  }

  if (document.getElementById('balanceLogModal').style.display === 'flex') {
    buildBalanceFilters();
    renderBalanceLog();
  }

  if (document.getElementById('driveBackupModal').style.display === 'flex') {
    renderDriveBackupList();
  }

  if (document.getElementById('currencyModal').style.display === 'flex') {
    renderCurrencyList();
  }

  const notificationsModal = document.getElementById('notificationsModal');
  if (
    notificationsModal &&
    notificationsModal.style.display === 'flex' &&
    typeof renderNotifications === 'function'
  ) {
    renderNotifications();
  }

  if (typeof updateNotificationBadge === 'function') {
    updateNotificationBadge();
  }

  updateLanguageModalCheckmarks();

  localStorage.setItem('appLang', lang);
  currentLang = lang;
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
// 4. GOOGLE DRIVE API FUNCTIONS
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
            toastMsg(translate('sessionExpired'), 'info');

            setTimeout(() => {
              if (tokenClient) {
                tokenClient.requestAccessToken({ prompt: '' });
              }
            }, 2000);
          } else {
            toastMsg(translate('loginFailed') + ': ' + resp.error, 'error');
          }

          return;
        }

        accessToken = resp.access_token;

        localStorage.setItem('drive_token', accessToken);
        localStorage.setItem('drive_token_expiry', Date.now() + 3600 * 1000);

        try {
          const userInfo = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          });

          const userData = await userInfo.json();

          userEmail = userData.email || '';
          localStorage.setItem('drive_email', userEmail);

          await createAppFolder();

          isDriveConnected = true;

          updateDriveUI();
          toastMsg(translate('driveConnected'), 'success');

          startTokenRefresh();

          await loadBackupList();

          if (document.getElementById('confirmBackupModal').style.display === 'flex') {
            closeLayer('confirmBackup');
          }

          openLayer('driveBackup');
        } catch (e) {
          console.error('Error getting user info:', e);
          userEmail = '';
          toastMsg(translate('loginError'), 'error');
        }
      }
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
    const searchQuery = `name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQuery)}&fields=files(id)`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
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
    toastMsg(translate('folderCreated'), 'success');
  } catch (error) {
    console.error('Error creating folder:', error);
    toastMsg(translate('folderCreateFailed'), 'error');
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
    toastMsg(translate('loadingAuth'), 'info');
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
    toastMsg(translate('loadingAuth'), 'info');
    return;
  }

  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleDriveBackup() {
  if (!isDriveConnected) {
    toastMsg(translate('driveNotConnected'), 'error');
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

  toastMsg(translate('signedOut'), 'info');
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
    const query = `'${appFolderId}' in parents and trashed=false and (mimeType='application/json' or name contains '.json')`;

    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,size,createdTime)&orderBy=${encodeURIComponent('createdTime desc')}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    const result = await searchResponse.json();

    backupFiles = result.files || [];
    renderDriveBackupList();
  } catch (error) {
    console.error('Error loading backup list:', error);
    toastMsg(translate('backupListLoadFailed'), 'error');
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
    container.innerHTML = `
      <div class="drive-empty">
        <i class="fab fa-google-drive"></i>
        <p>${translate('driveConnectPrompt')}</p>
      </div>
    `;

    if (countEl) countEl.textContent = translate('backupCountLabel') + ' 0';
    return;
  }

  if (backupFiles.length === 0) {
    container.innerHTML = `
      <div class="drive-empty">
        <i class="fas fa-cloud-upload-alt"></i>
        <p>${translate('noBackups')}</p>
        <p style="font-size:0.85em;color:#888;">${translate('newBackupPrompt')}</p>
      </div>
    `;

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

  let tableHtml = `
    <table class="backup-table">
      <thead>
        <tr>
          <th>${translate('backupName')}</th>
          <th>${translate('backupDate')}</th>
          <th>${translate('backupSize')}</th>
          <th style="text-align:left;">${translate('actions')}</th>
        </tr>
      </thead>
      <tbody>
  `;

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

    tableHtml += `
      <tr>
        <td class="file-name">${name}</td>
        <td class="file-date">${formattedDate}</td>
        <td class="file-size">${size}</td>
        <td>
          <div class="file-actions">
            <button class="restore-btn" onclick="restoreBackup('${file.id}')" title="${translate('restore')}">
              <i class="fas fa-download"></i>
            </button>
            <button class="delete-btn" onclick="deleteBackup('${file.id}')" title="${translate('delete')}">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  tableHtml += `</tbody></table>`;

  container.innerHTML = tableHtml;

  if (countEl) countEl.textContent = translate('backupCountLabel') + ' ' + backupFiles.length;
}

function refreshBackupList() {
  loadBackupList();
  toastMsg(translate('refreshingList'), 'info');
}

async function performBackup() {
  if (!accessToken || !appFolderId) {
    toastMsg(translate('driveNotConnected'), 'error');
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
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }

    hideLoading();
    toastMsg(translate('backupSaved'), 'success');

    await loadBackupList();
    renderDriveBackupList();

    if (document.getElementById('driveBackupModal').style.display !== 'flex') {
      openLayer('driveBackup');
    }
  } catch (error) {
    hideLoading();
    console.error('Error uploading backup:', error);
    toastMsg(translate('backupFailed') + ': ' + error.message, 'error');
  }
}

async function restoreBackup(fileId) {
  if (!confirm(translate('confirmRestore'))) return;

  showLoading(translate('restoringData'));

  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
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

    if (imported.currency) {
      currentCurrency = imported.currency;
      localStorage.setItem('currencyCode', currentCurrency.code);

      const label = document.getElementById('sidebarCurrencyLabel');
      if (label) label.textContent = currentCurrency.symbol;
    }

    await loadAllData();

    if (typeof syncDueNotifications === 'function') {
      await syncDueNotifications();
    }

    hideLoading();

    updateStats();
    updateBalanceDisplay();

    toastMsg(translate('dataRestored'), 'success');

    await loadBackupList();
    renderDriveBackupList();
  } catch (error) {
    hideLoading();
    console.error('Error restoring backup:', error);
    toastMsg(translate('restoreFailed') + ': ' + error.message, 'error');
  }
}

async function deleteBackup(fileId) {
  if (!confirm(translate('confirmDeleteBackup'))) return;

  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }

    toastMsg(translate('backupDeleted'), 'success');

    await loadBackupList();
    renderDriveBackupList();
  } catch (error) {
    console.error('Error deleting backup:', error);
    toastMsg(translate('deleteFailed') + ': ' + error.message, 'error');
  }
}

// =============================================================
// 5. EXPORT / IMPORT
// =============================================================
function openExportNameModal() {
  openLayer('exportName');
}

function performExport() {
  const fileName = document.getElementById('exportFileName').value.trim();

  if (!fileName) {
    toastMsg(translate('enterFileName'), 'error');
    return;
  }

  closeLayer('exportName');

  if (!IDB_connection) {
    toastMsg(translate('dbError'), 'error');
    return;
  }

  const data = {
    exp: db.exp,
    rig: db.rig,
    deb: db.deb,
    bal: db.bal,
    inc: db.inc,
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

  toastMsg(translate('exportSuccess'), 'success');
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

      if (imported.currency) {
        currentCurrency = imported.currency;
        localStorage.setItem('currencyCode', currentCurrency.code);

        const label = document.getElementById('sidebarCurrencyLabel');
        if (label) label.textContent = currentCurrency.symbol;
      }

      await loadAllData();

      if (typeof syncDueNotifications === 'function') {
        await syncDueNotifications();
      }

      hideLoading();

      updateStats();
      updateBalanceDisplay();

      toastMsg(translate('importSuccess'), 'success');
    } catch (err) {
      hideLoading();
      toastMsg(translate('importFailed'), 'error');
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
      if (storeName === 'bal') {
        store.put(item).onsuccess = resolve;
      } else {
        const toSave = { ...item };
        delete toSave.id;

        toSave.clientId = item.clientId || `${storeName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        store.add(toSave).onsuccess = resolve;
      }
    });
  }
}

// =============================================================
// 6. LOADING OVERLAY
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
// 7. TOAST NOTIFICATION
// =============================================================
function toastMsg(message, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;

  t.className = 'toast ' + type;

  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle'
  };

  t.innerHTML = `<span class="toast-icon ${type}"><i class="fas ${iconMap[type] || 'fa-info-circle'}"></i></span> ${message}`;

  t.classList.add('show');

  setTimeout(() => {
    t.classList.remove('show');
  }, 3500);
}
// =============================================================
// 8. FORMATTING HELPERS + MULTI-LANGUAGE CURRENCIES
// =============================================================
const ARABIC_CURRENCIES = [
  { code: 'SAR', symbol: '﷼', flag: '🇸🇦', name: { ar: 'الريال السعودي', en: 'Saudi Riyal', ur: 'سعودی ریال' } },
  { code: 'SDG', symbol: 'ج.س', flag: '🇸🇩', name: { ar: 'الجنيه السوداني', en: 'Sudanese Pound', ur: 'سوڈانی پاؤنڈ' } },
  { code: 'AED', symbol: 'د.إ', flag: '🇦🇪', name: { ar: 'الدرهم الإماراتي', en: 'UAE Dirham', ur: 'اماراتی درہم' } },
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
  { code: 'BDT', symbol: '৳', flag: '🇧🇩', name: { ar: 'التاكا البنغلاديشي', en: 'Bangladeshi Taka', ur: 'بنگلادیشی ٹاکا' } },
  { code: 'INR', symbol: '₹', flag: '🇮🇳', name: { ar: 'الروبية الهندية', en: 'Indian Rupee', ur: 'بھارتی روپیہ' } },
  { code: 'PKR', symbol: '₨', flag: '🇵🇰', name: { ar: 'الروبية الباكستانية', en: 'Pakistani Rupee', ur: 'پاکستانی روپیہ' } },
  { code: 'PHP', symbol: '₱', flag: '🇵🇭', name: { ar: 'البيزو الفلبيني', en: 'Philippine Peso', ur: 'فلپائنی پیسو' } },
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
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });

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
  if (balanceHidden) {
    return '<span class="hidden-balance">***</span>';
  }

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

    return date.toLocaleDateString('ar', {
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  const d = new Date(dateString);

  if (isNaN(d)) return translate('invalidDate');

  return d.toLocaleString('ar', {
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function clearFields() {
  [
    'iAmount', 'iDesc', 'iType', 'iDate',
    'eAmount', 'eDesc', 'eType', 'eDate',
    'rAmount', 'rDesc', 'rType', 'rEntity', 'rDueDate',
    'dType', 'dAmount', 'dDesc', 'dStatus', 'dEntity', 'dDueDate'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  clearSelectedImage();

  const rDynamic = document.getElementById('rDynamicFields');
  if (rDynamic) rDynamic.innerHTML = '';

  const dDynamic = document.getElementById('dDynamicFields');
  if (dDynamic) dDynamic.innerHTML = '';

  document.querySelectorAll('.edit-indicator').forEach(el => el.style.display = 'none');

  const dEntity = document.getElementById('dEntity');
  if (dEntity) dEntity.style.display = 'none';
}

// =============================================================
// 9. TAB NAVIGATION
// =============================================================
function openTab(id, keepEdit = false) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

  const activeSection = document.getElementById(id);
  if (activeSection) activeSection.classList.add('active');

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

  if (id === 'overview') {
    updateStats();
  }

  if (editMode) {
    const indicatorMap = {
      inc: 'incEditIndicator',
      exp: 'expEditIndicator',
      rig: 'rigEditIndicator',
      deb: 'debEditIndicator'
    };

    const ind = document.getElementById(indicatorMap[editMode.type]);
    if (ind) ind.style.display = 'inline-block';
  }
}

function openTabFromNav(tabId) {
  const tab = document.getElementById(tabId);

  if (tab && tab.classList.contains('active')) return;

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
  if (el) el.innerHTML = formatBalance(currentBalance);

  const act = document.getElementById('currentBalanceInAction');
  if (act) act.innerHTML = formatBalance(currentBalance);

  const icon = document.querySelector('#balanceVisibilityToggle i');
  if (icon) icon.className = balanceHidden ? 'fas fa-eye-slash' : 'fas fa-eye';

  const balanceLogModal = document.getElementById('balanceLogModal');
  if (balanceLogModal && balanceLogModal.style.display === 'flex') {
    renderBalanceLog();
  }
}

async function processBalanceChange(amount, type, description, recordId = null, isEdit = false, oldAmount = 0) {
  if (!recordId) {
    recordId = `bal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  const changeAmount = parseAmount(amount);
  let netChange = changeAmount;

  if (['expense', 'debt_payment', 'withdraw', 'revert_expense_debt'].includes(type)) {
    netChange *= -1;
  }

  let effectiveChange = netChange;

  if (isEdit) {
    effectiveChange = netChange - oldAmount;
  }

  currentBalance = parseAmount(currentBalance) + effectiveChange;
  db.bal.amount = currentBalance;

  const entry = {
    id: recordId,
    التاريخ: getLocalDateTimeString(),
    النوع: description,
    المبلغ: changeAmount,
    التأثير: (
      netChange > 0
        ? translate('depositEffect')
        : (netChange < 0 ? translate('withdrawEffect') : translate('editEffect'))
    ),
    القيمة_الصافية: netChange,
    الرصيد_بعد_العملية: currentBalance
  };

  const idx = db.bal.changes.findIndex(c => c.id === recordId);

  if (idx > -1) {
    db.bal.changes[idx] = entry;
  } else {
    db.bal.changes.unshift(entry);
  }

  try {
    await saveData('bal', db.bal);
    updateBalanceDisplay();
    return true;
  } catch (e) {
    console.error('Balance save failed', e);

    currentBalance -= effectiveChange;

    toastMsg(translate('balanceUpdateFailed'), 'error');
    return false;
  }
}

async function processBalanceAction() {
  const amt = document.getElementById('bAmount').value;

  const desc = document.getElementById('bDesc').value ||
    (balanceActionType === 'deposit' ? translate('generalDeposit') : translate('generalWithdraw'));

  if (!amt) {
    toastMsg(translate('enterAmount'), 'error');
    return;
  }

  const ok = await processBalanceChange(
    amt,
    balanceActionType,
    desc,
    `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );

  if (ok) {
    toastMsg(
      balanceActionType === 'deposit'
        ? translate('depositSuccess')
        : translate('withdrawSuccess'),
      'success'
    );

    closeLayer('balanceAction');
  }
}

function renderBalanceLog() {
  const el = document.getElementById('balanceLogContent');
  if (!el) return;

  const changes = db.bal.changes || [];

  const qEl = document.getElementById('balanceSearch');
  const q = qEl ? qEl.value.toLowerCase() : '';

  let list = changes;

  if (q) {
    list = list.filter(i => String(i.النوع).toLowerCase().includes(q));
  }

  if (balanceFilters.type === 'deposit') {
    list = list.filter(i => i.القيمة_الصافية > 0);
  }

  if (balanceFilters.type === 'withdraw') {
    list = list.filter(i => i.القيمة_الصافية < 0);
  }

  let dep = 0;
  let wit = 0;

  list.forEach(i => {
    if (i.القيمة_الصافية > 0) dep += i.القيمة_الصافية;
    else if (i.القيمة_الصافية < 0) wit += Math.abs(i.القيمة_الصافية);
  });

  const bar = document.getElementById('balanceStatsBar');

  if (bar) {
    bar.innerHTML = `
      <div class="log-stat-chip">
        <span class="stat-label">${translate('movementsCount')}</span>
        <span class="stat-value">${list.length}</span>
      </div>
      <div class="log-stat-chip">
        <span class="stat-label">${translate('totalDeposits')}</span>
        <span class="stat-value" style="color:var(--success);">${getFormattedAmount(dep)}</span>
      </div>
      <div class="log-stat-chip">
        <span class="stat-label">${translate('totalWithdrawals')}</span>
        <span class="stat-value" style="color:var(--danger);">${getFormattedAmount(wit)}</span>
      </div>
    `;
  }

  if (!list.length) {
    el.innerHTML = `
      <p style="text-align:center;color:#999;padding:30px 0;">
        <i class="fas fa-inbox" style="font-size:2em;display:block;margin-bottom:10px;"></i>
        ${translate('noBalanceLog')}
      </p>
    `;
    return;
  }

  el.innerHTML = list.map(i => {
    const isDep = i.القيمة_الصافية > 0;

    const color = isDep ? 'var(--success)' : (i.القيمة_الصافية < 0 ? 'var(--danger)' : '#999');
    const icon = isDep ? 'fa-arrow-up' : (i.القيمة_الصافية < 0 ? 'fa-arrow-down' : 'fa-minus');

    const displayAmount = (i.القيمة_الصافية < 0 ? '-' : '') + formatCurrency(Math.abs(i.المبلغ));

    return `
      <div class="list-item" style="border-right-color:${color};">
        <div style="font-weight:bold;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;">
          <span>
            <i class="fas ${icon}" style="margin-left:8px;color:${color};"></i>
            ${i.النوع}
          </span>
          <span style="color:${color};">${displayAmount}</span>
        </div>

        <div class="details">
          <span>${translate('balanceAfter')}: ${formatBalance(i.الرصيد_بعد_العملية)}</span>
          <span>
            <i class="far fa-clock" style="margin-left:4px;"></i>
            ${formatDateTime(i.التاريخ)}
          </span>
        </div>
      </div>
    `;
  }).join('');
}
// =============================================================
// 8. FORMATTING HELPERS + MULTI-LANGUAGE CURRENCIES
// =============================================================
const ARABIC_CURRENCIES = [
  { code: 'SAR', symbol: '﷼', flag: '🇸🇦', name: { ar: 'الريال السعودي', en: 'Saudi Riyal', ur: 'سعودی ریال' } },
  { code: 'SDG', symbol: 'ج.س', flag: '🇸🇩', name: { ar: 'الجنيه السوداني', en: 'Sudanese Pound', ur: 'سوڈانی پاؤنڈ' } },
  { code: 'AED', symbol: 'د.إ', flag: '🇦🇪', name: { ar: 'الدرهم الإماراتي', en: 'UAE Dirham', ur: 'اماراتی درہم' } },
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
  { code: 'BDT', symbol: '৳', flag: '🇧🇩', name: { ar: 'التاكا البنغلاديشي', en: 'Bangladeshi Taka', ur: 'بنگلادیشی ٹاکا' } },
  { code: 'INR', symbol: '₹', flag: '🇮🇳', name: { ar: 'الروبية الهندية', en: 'Indian Rupee', ur: 'بھارتی روپیہ' } },
  { code: 'PKR', symbol: '₨', flag: '🇵🇰', name: { ar: 'الروبية الباكستانية', en: 'Pakistani Rupee', ur: 'پاکستانی روپیہ' } },
  { code: 'PHP', symbol: '₱', flag: '🇵🇭', name: { ar: 'البيزو الفلبيني', en: 'Philippine Peso', ur: 'فلپائنی پیسو' } },
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

  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });

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
  if (balanceHidden) {
    return '<span class="hidden-balance">***</span>';
  }

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

    return date.toLocaleDateString('ar', {
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  const d = new Date(dateString);

  if (isNaN(d)) return translate('invalidDate');

  return d.toLocaleString('ar', {
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function clearFields() {
  [
    'iAmount', 'iDesc', 'iType', 'iDate',
    'eAmount', 'eDesc', 'eType', 'eDate',
    'rAmount', 'rDesc', 'rType', 'rEntity', 'rDueDate',
    'dType', 'dAmount', 'dDesc', 'dStatus', 'dEntity', 'dDueDate'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  clearSelectedImage();

  const rDynamic = document.getElementById('rDynamicFields');
  if (rDynamic) rDynamic.innerHTML = '';

  const dDynamic = document.getElementById('dDynamicFields');
  if (dDynamic) dDynamic.innerHTML = '';

  document.querySelectorAll('.edit-indicator').forEach(el => el.style.display = 'none');

  const dEntity = document.getElementById('dEntity');
  if (dEntity) dEntity.style.display = 'none';
}

// =============================================================
// 9. TAB NAVIGATION
// =============================================================
function openTab(id, keepEdit = false) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

  const activeSection = document.getElementById(id);
  if (activeSection) activeSection.classList.add('active');

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

  if (id === 'overview') {
    updateStats();
  }

  if (editMode) {
    const indicatorMap = {
      inc: 'incEditIndicator',
      exp: 'expEditIndicator',
      rig: 'rigEditIndicator',
      deb: 'debEditIndicator'
    };

    const ind = document.getElementById(indicatorMap[editMode.type]);
    if (ind) ind.style.display = 'inline-block';
  }
}

function openTabFromNav(tabId) {
  const tab = document.getElementById(tabId);

  if (tab && tab.classList.contains('active')) return;

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
  if (el) el.innerHTML = formatBalance(currentBalance);

  const act = document.getElementById('currentBalanceInAction');
  if (act) act.innerHTML = formatBalance(currentBalance);

  const icon = document.querySelector('#balanceVisibilityToggle i');
  if (icon) icon.className = balanceHidden ? 'fas fa-eye-slash' : 'fas fa-eye';

  const balanceLogModal = document.getElementById('balanceLogModal');
  if (balanceLogModal && balanceLogModal.style.display === 'flex') {
    renderBalanceLog();
  }
}

async function processBalanceChange(amount, type, description, recordId = null, isEdit = false, oldAmount = 0) {
  if (!recordId) {
    recordId = `bal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  const changeAmount = parseAmount(amount);
  let netChange = changeAmount;

  if (['expense', 'debt_payment', 'withdraw', 'revert_expense_debt'].includes(type)) {
    netChange *= -1;
  }

  let effectiveChange = netChange;

  if (isEdit) {
    effectiveChange = netChange - oldAmount;
  }

  currentBalance = parseAmount(currentBalance) + effectiveChange;
  db.bal.amount = currentBalance;

  const entry = {
    id: recordId,
    التاريخ: getLocalDateTimeString(),
    النوع: description,
    المبلغ: changeAmount,
    التأثير: (
      netChange > 0
        ? translate('depositEffect')
        : (netChange < 0 ? translate('withdrawEffect') : translate('editEffect'))
    ),
    القيمة_الصافية: netChange,
    الرصيد_بعد_العملية: currentBalance
  };

  const idx = db.bal.changes.findIndex(c => c.id === recordId);

  if (idx > -1) {
    db.bal.changes[idx] = entry;
  } else {
    db.bal.changes.unshift(entry);
  }

  try {
    await saveData('bal', db.bal);
    updateBalanceDisplay();
    return true;
  } catch (e) {
    console.error('Balance save failed', e);

    currentBalance -= effectiveChange;

    toastMsg(translate('balanceUpdateFailed'), 'error');
    return false;
  }
}

async function processBalanceAction() {
  const amt = document.getElementById('bAmount').value;

  const desc = document.getElementById('bDesc').value ||
    (balanceActionType === 'deposit' ? translate('generalDeposit') : translate('generalWithdraw'));

  if (!amt) {
    toastMsg(translate('enterAmount'), 'error');
    return;
  }

  const ok = await processBalanceChange(
    amt,
    balanceActionType,
    desc,
    `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );

  if (ok) {
    toastMsg(
      balanceActionType === 'deposit'
        ? translate('depositSuccess')
        : translate('withdrawSuccess'),
      'success'
    );

    closeLayer('balanceAction');
  }
}

function renderBalanceLog() {
  const el = document.getElementById('balanceLogContent');
  if (!el) return;

  const changes = db.bal.changes || [];

  const qEl = document.getElementById('balanceSearch');
  const q = qEl ? qEl.value.toLowerCase() : '';

  let list = changes;

  if (q) {
    list = list.filter(i => String(i.النوع).toLowerCase().includes(q));
  }

  if (balanceFilters.type === 'deposit') {
    list = list.filter(i => i.القيمة_الصافية > 0);
  }

  if (balanceFilters.type === 'withdraw') {
    list = list.filter(i => i.القيمة_الصافية < 0);
  }

  let dep = 0;
  let wit = 0;

  list.forEach(i => {
    if (i.القيمة_الصافية > 0) dep += i.القيمة_الصافية;
    else if (i.القيمة_الصافية < 0) wit += Math.abs(i.القيمة_الصافية);
  });

  const bar = document.getElementById('balanceStatsBar');

  if (bar) {
    bar.innerHTML = `
      <div class="log-stat-chip">
        <span class="stat-label">${translate('movementsCount')}</span>
        <span class="stat-value">${list.length}</span>
      </div>
      <div class="log-stat-chip">
        <span class="stat-label">${translate('totalDeposits')}</span>
        <span class="stat-value" style="color:var(--success);">${getFormattedAmount(dep)}</span>
      </div>
      <div class="log-stat-chip">
        <span class="stat-label">${translate('totalWithdrawals')}</span>
        <span class="stat-value" style="color:var(--danger);">${getFormattedAmount(wit)}</span>
      </div>
    `;
  }

  if (!list.length) {
    el.innerHTML = `
      <p style="text-align:center;color:#999;padding:30px 0;">
        <i class="fas fa-inbox" style="font-size:2em;display:block;margin-bottom:10px;"></i>
        ${translate('noBalanceLog')}
      </p>
    `;
    return;
  }

  el.innerHTML = list.map(i => {
    const isDep = i.القيمة_الصافية > 0;

    const color = isDep ? 'var(--success)' : (i.القيمة_الصافية < 0 ? 'var(--danger)' : '#999');
    const icon = isDep ? 'fa-arrow-up' : (i.القيمة_الصافية < 0 ? 'fa-arrow-down' : 'fa-minus');

    const displayAmount = (i.القيمة_الصافية < 0 ? '-' : '') + formatCurrency(Math.abs(i.المبلغ));

    return `
      <div class="list-item" style="border-right-color:${color};">
        <div style="font-weight:bold;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;">
          <span>
            <i class="fas ${icon}" style="margin-left:8px;color:${color};"></i>
            ${i.النوع}
          </span>
          <span style="color:${color};">${displayAmount}</span>
        </div>

        <div class="details">
          <span>${translate('balanceAfter')}: ${formatBalance(i.الرصيد_بعد_العملية)}</span>
          <span>
            <i class="far fa-clock" style="margin-left:4px;"></i>
            ${formatDateTime(i.التاريخ)}
          </span>
        </div>
      </div>
    `;
  }).join('');
}
// =============================================================
// 8. FORMATTING HELPERS + MULTI-LANGUAGE CURRENCIES
// =============================================================
const ARABIC_CURRENCIES = [
  { code: 'SAR', symbol: '﷼', flag: '🇸🇦', name: { ar: 'الريال السعودي', en: 'Saudi Riyal', ur: 'سعودی ریال' } },
  { code: 'SDG', symbol: 'ج.س', flag: '🇸🇩', name: { ar: 'الجنيه السوداني', en: 'Sudanese Pound', ur: 'سوڈانی پاؤنڈ' } },
  { code: 'AED', symbol: 'د.إ', flag: '🇦🇪', name: { ar: 'الدرهم الإماراتي', en: 'UAE Dirham', ur: 'اماراتی درہم' } },
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
  { code: 'BDT', symbol: '৳', flag: '🇧🇩', name: { ar: 'التاكا البنغلاديشي', en: 'Bangladeshi Taka', ur: 'بنگلادیشی ٹاکا' } },
  { code: 'INR', symbol: '₹', flag: '🇮🇳', name: { ar: 'الروبية الهندية', en: 'Indian Rupee', ur: 'بھارتی روپیہ' } },
  { code: 'PKR', symbol: '₨', flag: '🇵🇰', name: { ar: 'الروبية الباكستانية', en: 'Pakistani Rupee', ur: 'پاکستانی روپیہ' } },
  { code: 'PHP', symbol: '₱', flag: '🇵🇭', name: { ar: 'البيزو الفلبيني', en: 'Philippine Peso', ur: 'فلپائنی پیسو' } },
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

  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });

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
  if (balanceHidden) {
    return '<span class="hidden-balance">***</span>';
  }

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

    return date.toLocaleDateString('ar', {
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  const d = new Date(dateString);

  if (isNaN(d)) return translate('invalidDate');

  return d.toLocaleString('ar', {
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function clearFields() {
  [
    'iAmount', 'iDesc', 'iType', 'iDate',
    'eAmount', 'eDesc', 'eType', 'eDate',
    'rAmount', 'rDesc', 'rType', 'rEntity', 'rDueDate',
    'dType', 'dAmount', 'dDesc', 'dStatus', 'dEntity', 'dDueDate'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  clearSelectedImage();

  const rDynamic = document.getElementById('rDynamicFields');
  if (rDynamic) rDynamic.innerHTML = '';

  const dDynamic = document.getElementById('dDynamicFields');
  if (dDynamic) dDynamic.innerHTML = '';

  document.querySelectorAll('.edit-indicator').forEach(el => el.style.display = 'none');

  const dEntity = document.getElementById('dEntity');
  if (dEntity) dEntity.style.display = 'none';
}

// =============================================================
// 9. TAB NAVIGATION
// =============================================================
function openTab(id, keepEdit = false) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

  const activeSection = document.getElementById(id);
  if (activeSection) activeSection.classList.add('active');

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

  if (id === 'overview') {
    updateStats();
  }

  if (editMode) {
    const indicatorMap = {
      inc: 'incEditIndicator',
      exp: 'expEditIndicator',
      rig: 'rigEditIndicator',
      deb: 'debEditIndicator'
    };

    const ind = document.getElementById(indicatorMap[editMode.type]);
    if (ind) ind.style.display = 'inline-block';
  }
}

function openTabFromNav(tabId) {
  const tab = document.getElementById(tabId);

  if (tab && tab.classList.contains('active')) return;

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
  if (el) el.innerHTML = formatBalance(currentBalance);

  const act = document.getElementById('currentBalanceInAction');
  if (act) act.innerHTML = formatBalance(currentBalance);

  const icon = document.querySelector('#balanceVisibilityToggle i');
  if (icon) icon.className = balanceHidden ? 'fas fa-eye-slash' : 'fas fa-eye';

  const balanceLogModal = document.getElementById('balanceLogModal');
  if (balanceLogModal && balanceLogModal.style.display === 'flex') {
    renderBalanceLog();
  }
}

async function processBalanceChange(amount, type, description, recordId = null, isEdit = false, oldAmount = 0) {
  if (!recordId) {
    recordId = `bal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  const changeAmount = parseAmount(amount);
  let netChange = changeAmount;

  if (['expense', 'debt_payment', 'withdraw', 'revert_expense_debt'].includes(type)) {
    netChange *= -1;
  }

  let effectiveChange = netChange;

  if (isEdit) {
    effectiveChange = netChange - oldAmount;
  }

  currentBalance = parseAmount(currentBalance) + effectiveChange;

  if (!db.bal) {
    db.bal = { clientId: 1, amount: 0, changes: [] };
  }

  if (!Array.isArray(db.bal.changes)) {
    db.bal.changes = [];
  }

  db.bal.amount = currentBalance;

  const entry = {
    id: recordId,
    التاريخ: getLocalDateTimeString(),
    النوع: description,
    المبلغ: changeAmount,
    التأثير: (
      netChange > 0
        ? translate('depositEffect')
        : (netChange < 0 ? translate('withdrawEffect') : translate('editEffect'))
    ),
    القيمة_الصافية: netChange,
    الرصيد_بعد_العملية: currentBalance
  };

  const idx = db.bal.changes.findIndex(c => c.id === recordId);

  if (idx > -1) {
    db.bal.changes[idx] = entry;
  } else {
    db.bal.changes.unshift(entry);
  }

  try {
    await saveData('bal', db.bal);
    updateBalanceDisplay();
    return true;
  } catch (e) {
    console.error('Balance save failed', e);

    currentBalance -= effectiveChange;

    toastMsg(translate('balanceUpdateFailed'), 'error');
    return false;
  }
}

async function processBalanceAction() {
  const amt = document.getElementById('bAmount').value;

  const desc = document.getElementById('bDesc').value ||
    (balanceActionType === 'deposit' ? translate('generalDeposit') : translate('generalWithdraw'));

  if (!amt) {
    toastMsg(translate('enterAmount'), 'error');
    return;
  }

  const ok = await processBalanceChange(
    amt,
    balanceActionType,
    desc,
    `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );

  if (ok) {
    toastMsg(
      balanceActionType === 'deposit'
        ? translate('depositSuccess')
        : translate('withdrawSuccess'),
      'success'
    );

    closeLayer('balanceAction');
  }
}

function renderBalanceLog() {
  const el = document.getElementById('balanceLogContent');
  if (!el) return;

  const changes = (db.bal && Array.isArray(db.bal.changes)) ? db.bal.changes : [];

  const qEl = document.getElementById('balanceSearch');
  const q = qEl ? qEl.value.toLowerCase() : '';

  let list = changes;

  if (q) {
    list = list.filter(i => String(i.النوع).toLowerCase().includes(q));
  }

  if (balanceFilters.type === 'deposit') {
    list = list.filter(i => i.القيمة_الصافية > 0);
  }

  if (balanceFilters.type === 'withdraw') {
    list = list.filter(i => i.القيمة_الصافية < 0);
  }

  let dep = 0;
  let wit = 0;

  list.forEach(i => {
    if (i.القيمة_الصافية > 0) dep += i.القيمة_الصافية;
    else if (i.القيمة_الصافية < 0) wit += Math.abs(i.القيمة_الصافية);
  });

  const bar = document.getElementById('balanceStatsBar');

  if (bar) {
    bar.innerHTML = `
      <div class="log-stat-chip">
        <span class="stat-label">${translate('movementsCount')}</span>
        <span class="stat-value">${list.length}</span>
      </div>
      <div class="log-stat-chip">
        <span class="stat-label">${translate('totalDeposits')}</span>
        <span class="stat-value" style="color:var(--success);">${getFormattedAmount(dep)}</span>
      </div>
      <div class="log-stat-chip">
        <span class="stat-label">${translate('totalWithdrawals')}</span>
        <span class="stat-value" style="color:var(--danger);">${getFormattedAmount(wit)}</span>
      </div>
    `;
  }

  if (!list.length) {
    el.innerHTML = `
      <p style="text-align:center;color:#999;padding:30px 0;">
        <i class="fas fa-inbox" style="font-size:2em;display:block;margin-bottom:10px;"></i>
        ${translate('noBalanceLog')}
      </p>
    `;
    return;
  }

  el.innerHTML = list.map(i => {
    const isDep = i.القيمة_الصافية > 0;

    const color = isDep ? 'var(--success)' : (i.القيمة_الصافية < 0 ? 'var(--danger)' : '#999');
    const icon = isDep ? 'fa-arrow-up' : (i.القيمة_الصافية < 0 ? 'fa-arrow-down' : 'fa-minus');

    const displayAmount = (i.القيمة_الصافية < 0 ? '-' : '') + formatCurrency(Math.abs(i.المبلغ));

    return `
      <div class="list-item" style="border-right-color:${color};">
        <div style="font-weight:bold;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;">
          <span>
            <i class="fas ${icon}" style="margin-left:8px;color:${color};"></i>
            ${i.النوع}
          </span>
          <span style="color:${color};">${displayAmount}</span>
        </div>

        <div class="details">
          <span>${translate('balanceAfter')}: ${formatBalance(i.الرصيد_بعد_العملية)}</span>
          <span>
            <i class="far fa-clock" style="margin-left:4px;"></i>
            ${formatDateTime(i.التاريخ)}
          </span>
        </div>
      </div>
    `;
  }).join('');
}
// =============================================================
// 4. GOOGLE DRIVE API FUNCTIONS
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
            toastMsg(translate('sessionExpired'), 'info');

            setTimeout(() => {
              if (tokenClient) {
                tokenClient.requestAccessToken({ prompt: '' });
              }
            }, 2000);
          } else {
            toastMsg(translate('loginFailed') + ': ' + resp.error, 'error');
          }

          return;
        }

        accessToken = resp.access_token;

        localStorage.setItem('drive_token', accessToken);
        localStorage.setItem('drive_token_expiry', Date.now() + 3600 * 1000);

        try {
          const userInfo = await fetch(
            'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`
              }
            }
          );

          const userData = await userInfo.json();

          userEmail = userData.email || '';
          localStorage.setItem('drive_email', userEmail);

          await createAppFolder();

          isDriveConnected = true;

          updateDriveUI();
          toastMsg(translate('driveConnected'), 'success');

          startTokenRefresh();

          await loadBackupList();

          if (document.getElementById('confirmBackupModal').style.display === 'flex') {
            closeLayer('confirmBackup');
          }

          openLayer('driveBackup');
        } catch (e) {
          console.error('Error getting user info:', e);

          userEmail = '';
          toastMsg(translate('loginError'), 'error');
        }
      }
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
    const query = `name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const params = new URLSearchParams({
      q: query,
      fields: 'files(id)'
    });

    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
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
    toastMsg(translate('folderCreated'), 'success');
  } catch (error) {
    console.error('Error creating folder:', error);
    toastMsg(translate('folderCreateFailed'), 'error');
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
    toastMsg(translate('loadingAuth'), 'info');
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
    toastMsg(translate('loadingAuth'), 'info');
    return;
  }

  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleDriveBackup() {
  if (!isDriveConnected) {
    toastMsg(translate('driveNotConnected'), 'error');
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

  toastMsg(translate('signedOut'), 'info');
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
    const query = `'${appFolderId}' in parents and trashed=false and (mimeType='application/json' or name contains '.json')`;

    const params = new URLSearchParams({
      q: query,
      fields: 'files(id,name,size,createdTime)',
      orderBy: 'createdTime desc'
    });

    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    const result = await searchResponse.json();

    backupFiles = result.files || [];
    renderDriveBackupList();
  } catch (error) {
    console.error('Error loading backup list:', error);
    toastMsg(translate('backupListLoadFailed'), 'error');
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
    container.innerHTML = `
      <div class="drive-empty">
        <i class="fab fa-google-drive"></i>
        <p>${translate('driveConnectPrompt')}</p>
      </div>
    `;

    if (countEl) countEl.textContent = translate('backupCountLabel') + ' 0';
    return;
  }

  if (backupFiles.length === 0) {
    container.innerHTML = `
      <div class="drive-empty">
        <i class="fas fa-cloud-upload-alt"></i>
        <p>${translate('noBackups')}</p>
        <p style="font-size:0.85em;color:#888;">${translate('newBackupPrompt')}</p>
      </div>
    `;

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

  let tableHtml = `
    <table class="backup-table">
      <thead>
        <tr>
          <th>${translate('backupName')}</th>
          <th>${translate('backupDate')}</th>
          <th>${translate('backupSize')}</th>
          <th style="text-align:left;">${translate('actions')}</th>
        </tr>
      </thead>
      <tbody>
  `;

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

    tableHtml += `
      <tr>
        <td class="file-name">${name}</td>
        <td class="file-date">${formattedDate}</td>
        <td class="file-size">${size}</td>
        <td>
          <div class="file-actions">
            <button class="restore-btn" onclick="restoreBackup('${file.id}')" title="${translate('restore')}">
              <i class="fas fa-download"></i>
            </button>
            <button class="delete-btn" onclick="deleteBackup('${file.id}')" title="${translate('delete')}">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  tableHtml += `</tbody></table>`;

  container.innerHTML = tableHtml;

  if (countEl) countEl.textContent = translate('backupCountLabel') + ' ' + backupFiles.length;
}

function refreshBackupList() {
  loadBackupList();
  toastMsg(translate('refreshingList'), 'info');
}

async function performBackup() {
  if (!accessToken || !appFolderId) {
    toastMsg(translate('driveNotConnected'), 'error');
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
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }

    hideLoading();
    toastMsg(translate('backupSaved'), 'success');

    await loadBackupList();
    renderDriveBackupList();

    if (document.getElementById('driveBackupModal').style.display !== 'flex') {
      openLayer('driveBackup');
    }
  } catch (error) {
    hideLoading();
    console.error('Error uploading backup:', error);
    toastMsg(translate('backupFailed') + ': ' + error.message, 'error');
  }
}

async function restoreBackup(fileId) {
  if (!confirm(translate('confirmRestore'))) return;

  showLoading(translate('restoringData'));

  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
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

    if (imported.currency) {
      currentCurrency = imported.currency;
      localStorage.setItem('currencyCode', currentCurrency.code);

      const label = document.getElementById('sidebarCurrencyLabel');
      if (label) label.textContent = currentCurrency.symbol;
    }

    await loadAllData();

    if (typeof syncDueNotifications === 'function') {
      await syncDueNotifications();
    }

    hideLoading();

    updateStats();
    updateBalanceDisplay();

    toastMsg(translate('dataRestored'), 'success');

    await loadBackupList();
    renderDriveBackupList();
  } catch (error) {
    hideLoading();
    console.error('Error restoring backup:', error);
    toastMsg(translate('restoreFailed') + ': ' + error.message, 'error');
  }
}

async function deleteBackup(fileId) {
  if (!confirm(translate('confirmDeleteBackup'))) return;

  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }

    toastMsg(translate('backupDeleted'), 'success');

    await loadBackupList();
    renderDriveBackupList();
  } catch (error) {
    console.error('Error deleting backup:', error);
    toastMsg(translate('deleteFailed') + ': ' + error.message, 'error');
  }
}

// =============================================================
// 5. EXPORT / IMPORT
// =============================================================
function openExportNameModal() {
  openLayer('exportName');
}

function performExport() {
  const fileName = document.getElementById('exportFileName').value.trim();

  if (!fileName) {
    toastMsg(translate('enterFileName'), 'error');
    return;
  }

  closeLayer('exportName');

  if (!IDB_connection) {
    toastMsg(translate('dbError'), 'error');
    return;
  }

  const data = {
    exp: db.exp,
    rig: db.rig,
    deb: db.deb,
    bal: db.bal,
    inc: db.inc,
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

  toastMsg(translate('exportSuccess'), 'success');
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

      if (imported.currency) {
        currentCurrency = imported.currency;
        localStorage.setItem('currencyCode', currentCurrency.code);

        const label = document.getElementById('sidebarCurrencyLabel');
        if (label) label.textContent = currentCurrency.symbol;
      }

      await loadAllData();

      if (typeof syncDueNotifications === 'function') {
        await syncDueNotifications();
      }

      hideLoading();

      updateStats();
      updateBalanceDisplay();

      toastMsg(translate('importSuccess'), 'success');
    } catch (err) {
      hideLoading();
      toastMsg(translate('importFailed'), 'error');
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
      if (storeName === 'bal') {
        store.put(item).onsuccess = resolve;
      } else {
        const toSave = { ...item };
        delete toSave.id;

        toSave.clientId = item.clientId || `${storeName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        store.add(toSave).onsuccess = resolve;
      }
    });
  }
}

// =============================================================
// 6. LOADING OVERLAY
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
// 7. TOAST NOTIFICATION
// =============================================================
function toastMsg(message, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;

  t.className = 'toast ' + type;

  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle'
  };

  t.innerHTML = `<span class="toast-icon ${type}"><i class="fas ${iconMap[type] || 'fa-info-circle'}"></i></span> ${message}`;

  t.classList.add('show');

  setTimeout(() => {
    t.classList.remove('show');
  }, 3500);
}
