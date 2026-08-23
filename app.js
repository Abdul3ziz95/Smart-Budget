// =============================================================
// 0. GOOGLE DRIVE CONFIGURATION + SYNC SETTINGS
// =============================================================
const CLIENT_ID = '110105567176-h191ogi1tl0bevvk0vo8jvnbf47re5q1.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const APP_FOLDER_NAME = 'ميزانيتك الذكية';
const SYNC_FILE_NAME = 'مزامنة_ميزانيتك_الذكية';
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

let autoSyncEnabled = localStorage.getItem('autoSyncEnabled') !== 'false';
let lastSyncTimestamp = localStorage.getItem('lastSyncTimestamp') || null;
let lastSyncRecordCount = parseInt(localStorage.getItem('lastSyncRecordCount')) || 0;
let lastSyncBalance = localStorage.getItem('lastSyncBalance') || '0';
let syncInProgress = false;
let pendingConflictData = null;
let deviceId = localStorage.getItem('deviceId') || generateDeviceId();

function generateDeviceId() {
    const id = 'device-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('deviceId', id);
    return id;
}

// =============================================================
// 1. INDEXED DB SETUP
// =============================================================
const IDB_NAME = "MySmartBudgetDB";
const IDB_VERSION = 6;
const STORE_NAMES = ["exp", "rig", "deb", "bal", "inc"];
let db = { exp: [], rig: [], deb: [], bal: { clientId: 1, amount: 0, changes: [] }, inc: [] };
let IDB_connection = null;
let currentBalance = 0;
let balanceHidden = localStorage.getItem('balanceHidden') === 'true';
let currentLog = '', editMode = null, balanceActionType = null;
let selectedImageFile = null;
let logFilters = { cat: 'all', status: 'all', period: 'all' };
let balanceFilters = { type: 'all' };
let statsPeriodFilter = localStorage.getItem('statsPeriodFilter') || 'all';

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
    'driveBackup': { elementId: 'driveBackupModal', type: 'modal' },
    'exportName': { elementId: 'exportNameModal', type: 'modal' },
    'language': { elementId: 'languageModal', type: 'modal' },
    'notifications': { elementId: 'notificationsModal', type: 'modal' },
    'syncConflict': { elementId: 'syncConflictModal', type: 'modal' }
};
let historyStack = [];

function _visualOpen(layerName, data = {}) {
    const layer = LAYERS[layerName];
    if (!layer) return;
    const el = document.getElementById(layer.elementId);
    if (!el) return;
    if (layer.type === 'modal') {
        el.style.display = 'flex';
        if (layerName === 'log') { currentLog = data.logType; buildLogFilters(); renderLog(); }
        else if (layerName === 'detail') {
            const o = db[data.logType]?.find(item => item.clientId === data.id || item.id === data.id);
            if (!o) { toastMsg(translate('notFound'), "error"); return; }
            const idx = db[data.logType].findIndex(item => item.clientId === data.id || item.id === data.id);
            editMode = { type: data.logType, index: idx };
            _renderDetailContent(o, data.logType);
        }
        else if (layerName === 'balanceAction') {
            balanceActionType = data.actionType;
            const titleEl = document.getElementById('actionModalTitle');
            if (titleEl) titleEl.textContent = balanceActionType === 'deposit' ? translate('depositTitle') : translate('withdrawTitle');
            const balanceEl = document.getElementById('currentBalanceInAction');
            if (balanceEl) balanceEl.innerHTML = formatCurrency(currentBalance);
            const amountEl = document.getElementById('bAmount'); if (amountEl) amountEl.value = '';
            const descEl = document.getElementById('bDesc'); if (descEl) descEl.value = '';
            const dateEl = document.getElementById('bDate'); if (dateEl) dateEl.value = getLocalDateTimeString();
        }
        else if (layerName === 'currency') { const s = document.getElementById('currencySearch'); if (s) s.value = ''; renderCurrencyList(); }
        else if (layerName === 'balanceLog') { buildBalanceFilters(); renderBalanceLog(); }
        else if (layerName === 'driveBackup') { renderDriveBackupList(); if (accessToken && appFolderId) loadBackupList(); }
        else if (layerName === 'exportName') { const f = document.getElementById('exportFileName'); if (f) { f.value = translate('defaultFileName'); f.focus(); f.select(); } }
        else if (layerName === 'language') { updateLanguageModalCheckmarks(); }
        else if (layerName === 'notifications') { cleanupExpiredReads(); renderNotifications(); }
        else if (layerName === 'syncConflict') { if (data.conflict) { pendingConflictData = data.conflict; showConflictDialog(); } }
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
        if (layerName === 'syncConflict') {
            const c = document.getElementById('conflictChoiceView'); if (c) c.style.display = 'block';
            const d = document.getElementById('conflictDetailsView'); if (d) d.style.display = 'none';
        }
    } else if (layer.type === 'menu') {
        el.classList.remove('open');
        const ov = document.querySelector(layerName === 'imageSource' ? '#imageSourceOverlay' : '.sidebar-overlay');
        if (ov) ov.classList.remove('open');
    }
}

function openLayer(layerName, data = {}) {
    const alreadyTop = historyStack.length && historyStack[historyStack.length - 1].layer === layerName;
    if (layerName === 'detail') {
        const o = db[data.logType]?.find(item => item.clientId === data.id || item.id === data.id);
        if (!o) { toastMsg(translate('notFound'), "error"); return; }
        const idx = db[data.logType].findIndex(item => item.clientId === data.id || item.id === data.id);
        editMode = { type: data.logType, index: idx };
    }
    if (!alreadyTop) { const state = { layer: layerName, data: data }; historyStack.push(state); history.pushState(state, null, `#${layerName}`); }
    _visualOpen(layerName, data);
}

function closeLayer(layerName, clearEdit = true) {
    const top = historyStack[historyStack.length - 1];
    if (top && top.layer === layerName) { history.back(); }
    else {
        const idx = historyStack.findIndex(s => s.layer === layerName);
        if (idx > -1) historyStack.splice(idx, 1);
        _visualClose(layerName, clearEdit);
    }
}

function closeAllLayers() {
    while (historyStack.length > 1) {
        const top = historyStack.pop();
        if (top.layer === 'main') { historyStack.push(top); break; }
        _visualClose(top.layer);
    }
    if (historyStack.length === 1) { history.replaceState({ layer: 'main' }, null, '#main'); }
}

window.onpopstate = (e) => {
    const closed = historyStack.pop();
    if (closed) _visualClose(closed.layer);
    if (historyStack.length === 0) {
        const st = { layer: 'main' }; historyStack.push(st); history.pushState(st, null, '#main');
        for (const n in LAYERS) _visualClose(n, false);
    } else {
        const top = historyStack[historyStack.length - 1];
        _visualOpen(top.layer, top.data);
    }
};

// =============================================================
// 3. TRANSLATION SYSTEM
// =============================================================
let translations = {};
let currentLang = localStorage.getItem('appLang') || 'ar';

function loadTranslations() {
    return fetch('lang.json').then(res => { if (!res.ok) throw new Error('Failed'); return res.json(); })
        .then(data => { translations = data; applyTranslations(currentLang); })
        .catch(err => { console.error(err); translations = { ar: {}, en: {}, ur: {} }; });
}

const PLACEHOLDER_I18N = { 'iAmount': 'amountPlaceholder', 'eAmount': 'amountPlaceholder', 'bAmount': 'amountPlaceholder', 'iDesc': 'notesOptional', 'eDesc': 'descriptionNotes', 'rDesc': 'additionalNotes', 'dDesc': 'additionalNotes', 'rAmount': 'totalDueAmount', 'rEntity': 'entityDebtor', 'dAmount': 'billAmount', 'dEntity': 'entityCreditor', 'search': 'searchLog', 'balanceSearch': 'searchLog', 'currencySearch': 'searchCurrency', 'exportFileName': 'fileName' };

const OPTION_I18N = {
    'راتب': 'incomeSalary', 'عمل حر': 'incomeFreelance', 'تجارة': 'incomeBusiness', 'استثمار': 'incomeInvestment', 'عمولة': 'incomeCommission', 'هدية': 'incomeGift', 'مكافأة': 'incomeBonus', 'الضمان الاجتماعي': 'incomeSocialSecurity', 'المعاش التقاعدي': 'incomePension', 'دخل آخر': 'incomeOther',
    'طعام': 'expenseFood', 'مواصلات': 'expenseTransport', 'وقود': 'expenseFuel', 'مقاهي': 'expenseCafe', 'رعاية شخصية': 'expensePersonalCare', 'أجهزة إلكترونية': 'expenseElectronics', 'صحة': 'expenseHealth', 'ترفيه': 'expenseEntertainment', 'تسوق': 'expenseShopping', 'تعليم': 'expenseEducation', 'صيانة وإصلاح': 'expenseMaintenance', 'أخرى': 'expenseOther',
    'بيع آجل': 'rightCreditSale', 'سلفة': 'rightLoan', 'إيجار مستحق': 'rightRentDue', 'شراكة': 'rightPartnership', 'حق آخر': 'rightOther',
    '🏠 إيجار': 'debtRent', '💡 كهرباء': 'debtElectricity', '💧 ماء': 'debtWater', '💡 فواتير الخدمات': 'debtUtilities', '📱 الاتصالات والإنترنت': 'debtInternet', '🏦 قروض وتمويل': 'debtLoans', '👤 دين شخصي': 'debtPersonal', '🛒 مشتريات بالتقسيط': 'debtInstallments', '🎓 رسوم تعليمية': 'debtTuition', '🏥 مصاريف طبية مستحقة': 'debtMedical', '🚗 تمويل السيارة': 'debtCarFinance', '👨‍👩 التزامات عائلية': 'debtFamily', '📅 اشتراكات دورية': 'debtSubscriptions', '👨‍💼 رواتب': 'debtSalaries', '📦 أخرى': 'debtOther',
    'مدفوع': 'statusPaid', 'مدفوع جزئياً': 'statusPartiallyPaid', 'غير مدفوع': 'statusUnpaid', 'متأخر': 'statusOverdue',
    '📂 فئة الدخل': 'incomeCategoryPlaceholder', '🛒 الفئة (نفقات متغيرة)': 'expenseCategoryPlaceholder', '🤝 نوع الحق': 'rightTypePlaceholder', '🧾 نوع الالتزام': 'debtTypePlaceholder', '✅ الحالة': 'statusPlaceholder', '⏱️ التنبيه قبل الاستحقاق (اختياري)': 'notifTimingPlaceholder',
    '⏱️ قبل ساعة': 'notif1Hour', '⏱️ قبل 24 ساعة': 'notif24Hours', '⏱️ قبل 7 أيام': 'notif7Days'
};

function translateStoredValue(val) { if (!val || typeof val !== 'string') return val || ''; const key = OPTION_I18N[val.trim()]; return key ? translate(key) : val; }

const FIELD_LABELS = { 'النوع': { ar: 'النوع', en: 'Type', ur: 'قسم' }, 'الفئة': { ar: 'الفئة', en: 'Category', ur: 'زمرہ' }, 'المبلغ': { ar: 'المبلغ', en: 'Amount', ur: 'رقم' }, 'الجهة': { ar: 'الجهة', en: 'Entity', ur: 'فریق' }, 'تاريخ_الاستحقاق': { ar: 'تاريخ الاستحقاق', en: 'Due Date', ur: 'تاریخِ ادائیگی' }, 'التاريخ': { ar: 'التاريخ', en: 'Date', ur: 'تاریخ' }, 'الوصف': { ar: 'الوصف', en: 'Description', ur: 'تفصیل' }, 'المبلغ_المدفوع': { ar: 'المبلغ المدفوع', en: 'Paid Amount', ur: 'ادا شدہ رقم' }, 'المبلغ_المدفوع_جزئياً': { ar: 'المدفوع جزئياً', en: 'Partially Paid Amount', ur: 'جزوی ادا شدہ رقم' }, 'وقت_التنبيه': { ar: 'وقت التنبيه', en: 'Notification Timing', ur: 'اطلاع کا وقت' }, 'المتبقي': { ar: 'المتبقي', en: 'Remaining', ur: 'باقی' }, 'الحالة': { ar: 'الحالة', en: 'Status', ur: 'حیثیت' }, 'المبلغ_الكلي_للالتزام': { ar: 'المبلغ الكلي', en: 'Total Amount', ur: 'کل رقم' }, 'إجمالي_المدفوع': { ar: 'إجمالي المدفوع', en: 'Total Paid', ur: 'کل ادا شدہ' }, 'المتبقي_للالتزام': { ar: 'المتبقي', en: 'Remaining', ur: 'باقی رقم' }, 'عدد_الاقساط': { ar: 'عدد الأقساط', en: 'Total Installments', ur: 'اقساط کی تعداد' }, 'قيمة_القسط': { ar: 'قيمة القسط', en: 'Installment Value', ur: 'قسط کی مالیت' }, 'الأقساط_المدفوعة': { ar: 'الأقساط المدفوعة', en: 'Paid Installments', ur: 'ادا شدہ اقساط' } };

function translateFieldLabel(key) { const e = FIELD_LABELS[key]; if (!e) return key.replace(/_/g, ' '); return e[currentLang] || e.ar; }
function translateStatusValue(val) { if (!val || typeof val !== 'string') return val; if (/مدفوع بالكامل|Fully Paid/.test(val)) return translate('statusFullyPaid'); if (/مدفوع جزئياً|Partially Paid/.test(val)) return translate('statusPartiallyPaid'); if (/غير مدفوع|Unpaid/.test(val)) return translate('statusUnpaid'); if (/متأخر|Overdue/.test(val)) return translate('statusOverdue'); if (/^مدفوع$|^Paid$/.test(val)) return translate('statusPaid'); return translateStoredValue(val); }
function translateTimingValue(val) { const s = String(val); if (s === '1') return translate('notif1Hour'); if (s === '24') return translate('notif24Hours'); if (s === '168') return translate('notif7Days'); return s; }
function formatFieldValue(key, val) { if (key === 'الحالة') return translateStatusValue(val); if (key === 'وقت_التنبيه') return translateTimingValue(val); if ((key === 'تاريخ_الاستحقاق' || key === 'التاريخ') && /^\d{4}-\d{2}-\d{2}$/.test(String(val))) return formatDateTime(val); const isAmt = key.includes('المبلغ') || key.includes('المدفوع') || key.includes('المتبقي') || key.includes('القسط') || key.includes('إجمالي'); return isAmt ? formatCurrency(val, true) : translateStoredValue(val); }

function translateAllOptions() {
    document.querySelectorAll('select option').forEach(op => {
        const key = op.getAttribute('data-i18n') || op.dataset.i18nKey || OPTION_I18N[op.value] || OPTION_I18N[op.textContent.trim()] || '';
        if (key) { op.dataset.i18nKey = key; const t = translate(key); if (t && t !== key) op.textContent = t; }
    });
}
function translatePlaceholders() { for (const [id, key] of Object.entries(PLACEHOLDER_I18N)) { const el = document.getElementById(id); if (el) el.placeholder = translate(key); } }

function applyTranslations(lang) {
    if (!translations[lang]) lang = 'ar';
    const t = translations[lang] || {};
    currentLang = lang;
    const html = document.documentElement;
    if (lang === 'ar' || lang === 'ur') { html.dir = 'rtl'; html.lang = lang; } else { html.dir = 'ltr'; html.lang = 'en'; }
    document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.getAttribute('data-i18n'); if (t[k] !== undefined) el.textContent = t[k]; });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { const k = el.getAttribute('data-i18n-placeholder'); if (t[k] !== undefined) el.placeholder = t[k]; });
    translatePlaceholders(); translateAllOptions();
    const langLabel = document.getElementById('sidebarLanguageLabel');
    if (langLabel) { const n = { ar: '🇸🇦 العربية', en: '🇬 English', ur: '🇵🇰 اردو' }; langLabel.textContent = n[lang] || '🇸 العربية'; }
    updateBalanceDisplay(); updateStats(); updateAutoSyncUI();
    const lm = document.getElementById('logModal'); if (lm && lm.style.display === 'flex') { buildLogFilters(); renderLog(); }
    const bl = document.getElementById('balanceLogModal'); if (bl && bl.style.display === 'flex') { buildBalanceFilters(); renderBalanceLog(); }
    const dbm = document.getElementById('driveBackupModal'); if (dbm && dbm.style.display === 'flex') renderDriveBackupList();
    const cm = document.getElementById('currencyModal'); if (cm && cm.style.display === 'flex') renderCurrencyList();
    const nm = document.getElementById('notificationsModal'); if (nm && nm.style.display === 'flex') renderNotifications();
    const dm = document.getElementById('detailModal'); if (dm && dm.style.display === 'flex' && editMode) { const o = db[editMode.type] && db[editMode.type][editMode.index]; if (o) _renderDetailContent(o, editMode.type); }
    const rDyn = document.getElementById('rDynamicFields'); if (rDyn && rDyn.innerHTML.trim() !== '') { const r = document.getElementById('rType'); updateRightFields(r ? r.value : '', (editMode && editMode.type === 'rig') ? db.rig[editMode.index] : null); }
    const dDyn = document.getElementById('dDynamicFields'); if (dDyn && dDyn.innerHTML.trim() !== '') { const d = document.getElementById('dType'); updateDebtFields(d ? d.value : '', (editMode && editMode.type === 'deb') ? db.deb[editMode.index] : null); }
    const bam = document.getElementById('balanceActionModal'); if (bam && bam.style.display === 'flex' && balanceActionType) { const tEl = document.getElementById('actionModalTitle'); if (tEl) tEl.textContent = balanceActionType === 'deposit' ? translate('depositTitle') : translate('withdrawTitle'); }
    const countEl = document.getElementById('driveBackupCount'); if (countEl) countEl.textContent = translate('backupCountLabel') + ' ' + (backupFiles ? backupFiles.length : 0);
    updateLanguageModalCheckmarks();
    localStorage.setItem('appLang', lang);
}

function translate(key) { if (!translations[currentLang] || translations[currentLang][key] === undefined) return translations['ar']?.[key] || key; return translations[currentLang][key]; }
function setLanguage(lang) { if (lang === currentLang) { closeLayer('language'); return; } applyTranslations(lang); closeLayer('language'); toastMsg(translate('languageChanged') || 'Language changed', 'success'); }
function openLanguageModal() { openLayer('language'); }
function updateLanguageModalCheckmarks() { const c = { ar: document.getElementById('langCheckAr'), en: document.getElementById('langCheckEn'), ur: document.getElementById('langCheckUr') }; for (const [l, el] of Object.entries(c)) if (el) el.style.display = (l === currentLang) ? 'inline' : 'none'; }

// =============================================================
// 4. GOOGLE DRIVE API (اتصال مباشر بدون شاشة تأكيد)
// =============================================================
function startTokenRefresh() { if (tokenRefreshInterval) clearInterval(tokenRefreshInterval); tokenRefreshInterval = setInterval(async () => { if (isDriveConnected && accessToken) { try { if (tokenClient) tokenClient.requestAccessToken({ prompt: '' }); } catch (e) {} } }, 50 * 60 * 1000); }
function stopTokenRefresh() { if (tokenRefreshInterval) { clearInterval(tokenRefreshInterval); tokenRefreshInterval = null; } }

function restoreDriveState() {
    const savedToken = localStorage.getItem('drive_token');
    const savedEmail = localStorage.getItem('drive_email');
    const tokenExpiry = localStorage.getItem('drive_token_expiry');
    if (savedToken && savedEmail) {
        const expiry = parseInt(tokenExpiry) || 0;
        if (expiry > Date.now()) {
            accessToken = savedToken; userEmail = savedEmail;
            isDriveConnected = true;
            updateDriveUI(); updateAutoSyncUI(); startTokenRefresh();
            setTimeout(() => { if (accessToken) { ensureAppFolder().then(() => { loadBackupList(); checkAndHandleSync(); }); verifyTokenValidity(); } }, 800);
        } else { if (tokenClient) tokenClient.requestAccessToken({ prompt: '' }); }
    } else { updateAutoSyncUI(); }
}

async function verifyTokenValidity() { if (!accessToken) return; try { const r = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + accessToken); if (!r.ok && tokenClient) tokenClient.requestAccessToken({ prompt: '' }); } catch (e) {} }

function initGapi() {
    if (gapiInitAttempts >= MAX_INIT_ATTEMPTS) return; gapiInitAttempts++;
    if (typeof gapi === 'undefined') { setTimeout(initGapi, 500); return; }
    try { gapi.load('client', async () => { try { await gapi.client.init({ discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'] }); restoreDriveState(); } catch (e) { console.error(e); } }); } catch (e) { setTimeout(initGapi, 500); }
}

function initGis() {
    if (gisInitAttempts >= MAX_INIT_ATTEMPTS) return; gisInitAttempts++;
    if (typeof google === 'undefined' || !google.accounts) { setTimeout(initGis, 500); return; }
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID, scope: SCOPES,
            callback: async (resp) => {
                if (resp.error) { toastMsg(translate('loginFailed') + ': ' + resp.error, "error"); return; }
                accessToken = resp.access_token;
                localStorage.setItem('drive_token', accessToken);
                localStorage.setItem('drive_token_expiry', Date.now() + 3600 * 1000);
                try {
                    const ui = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', { headers: { 'Authorization': `Bearer ${accessToken}` } });
                    const ud = await ui.json();
                    userEmail = ud.email || '';
                    localStorage.setItem('drive_email', userEmail);
                    await ensureAppFolder();
                    isDriveConnected = true;
                    updateDriveUI(); updateAutoSyncUI();
                    toastMsg(translate('driveConnected'), "success");
                    startTokenRefresh();
                    await loadBackupList();
                    openLayer('driveBackup');
                    checkAndHandleSync();
                } catch (e) { console.error(e); toastMsg(translate('loginError'), "error"); }
            }
        });
    } catch (e) { setTimeout(initGis, 500); }
}

// البحث عن المجلد أو إنشاؤه (مشترك بين الأجهزة)
async function ensureAppFolder() {
    if (!accessToken) return;
    if (appFolderId) return;
    try {
        const q = encodeURIComponent(`name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
        const s = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const r = await s.json();
        if (r.files && r.files.length > 0) { appFolderId = r.files[0].id; localStorage.setItem('drive_folder_id', appFolderId); return; }
        const c = await fetch('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) });
        const f = await c.json();
        appFolderId = f.id; localStorage.setItem('drive_folder_id', appFolderId);
    } catch (e) { console.error(e); }
}

// ✔✔✔ البحث عن ملف المزامنة على مستوى الدرايف كاملاً (يعمل على أي جهاز)
async function findSyncFile() {
    try {
        const q = encodeURIComponent(`name='${SYNC_FILE_NAME}.json' and trashed=false`);
        const s = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const r = await s.json();
        return (r.files && r.files.length) ? r.files[0].id : null;
    } catch (e) { console.error(e); return null; }
}

async function createSyncFile(fileData) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: `${SYNC_FILE_NAME}.json`, mimeType: 'application/json' })], { type: 'application/json' }));
    form.append('file', fileData);
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }, body: form });
    if (!r.ok) throw new Error('Create sync failed: ' + r.status);
    return r.json();
}

async function updateSyncFile(fileId, fileData) {
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: fileData });
    if (!r.ok) throw new Error('Update sync failed: ' + r.status);
    return r.json();
}

function handleDriveClick() {
    // ✔ اتصال مباشر بدون شاشة التأكيد
    if (isDriveConnected) { openLayer('driveBackup'); return; }
    const savedToken = localStorage.getItem('drive_token');
    const tokenExpiry = localStorage.getItem('drive_token_expiry');
    if (savedToken && parseInt(tokenExpiry) > Date.now()) {
        accessToken = savedToken; userEmail = localStorage.getItem('drive_email') || '';
        isDriveConnected = true; updateDriveUI(); updateAutoSyncUI(); startTokenRefresh();
        ensureAppFolder().then(() => { loadBackupList(); checkAndHandleSync(); });
        openLayer('driveBackup');
        return;
    }
    if (!tokenClient) { toastMsg(translate('loadingAuth'), "info"); return; }
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleViewBackups() { handleDriveClick(); }
function handleDriveBackup() { if (!isDriveConnected) { toastMsg(translate('driveNotConnected'), "error"); return; } performBackup(); }

function signOut() {
    if (!confirm(translate('confirmSignOut'))) return;
    stopTokenRefresh(); accessToken = null;
    localStorage.removeItem('drive_token'); localStorage.removeItem('drive_email'); localStorage.removeItem('drive_folder_id'); localStorage.removeItem('drive_token_expiry');
    isDriveConnected = false; userEmail = ''; appFolderId = null; backupFiles = [];
    updateDriveUI(); updateAutoSyncUI();
    toastMsg(translate('signedOut'), "info");
}

function updateDriveUI() {
    const menuItem = document.getElementById('driveMenuItem');
    const menuText = document.getElementById('driveMenuText');
    const dot = document.getElementById('driveStatusDot');
    const emailLine = document.getElementById('driveEmailLine');
    const emailFull = document.getElementById('driveMenuEmail');
    const logoutBtn = document.getElementById('driveLogoutBtn');
    const modalStatus = document.getElementById('driveModalStatus');
    if (menuItem) {
        if (isDriveConnected) {
            menuItem.classList.add('connected');
            if (menuText) menuText.textContent = translate('googleDrive');
            if (dot) { dot.style.display = 'inline-block'; dot.style.background = 'var(--success)'; }
            if (emailLine) emailLine.style.display = 'flex';
            if (emailFull) emailFull.textContent = userEmail || '';
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
        } else {
            menuItem.classList.remove('connected');
            if (menuText) menuText.textContent = translate('googleDrive');
            if (dot) { dot.style.display = 'inline-block'; dot.style.background = '#999'; }
            if (emailLine) emailLine.style.display = 'none';
            if (emailFull) emailFull.textContent = '';
            if (logoutBtn) logoutBtn.style.display = 'none';
        }
    }
    if (modalStatus) { if (isDriveConnected) { modalStatus.className = 'status connected'; modalStatus.textContent = translate('driveConnectedStatus'); } else { modalStatus.className = 'status disconnected'; modalStatus.textContent = translate('driveDisconnectedStatus'); } }
}

async function loadBackupList() {
    if (!accessToken || !appFolderId) { backupFiles = []; renderDriveBackupList(); return; }
    try {
        const s = await fetch(`https://www.googleapis.com/drive/v3/files?q='${appFolderId}' in parents and trashed=false and (mimeType='application/json' or name contains '.json')&fields=files(id,name,size,createdTime)&orderBy=createdTime desc`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const r = await s.json();
        backupFiles = r.files || [];
        renderDriveBackupList();
    } catch (e) { console.error(e); toastMsg(translate('backupListLoadFailed'), "error"); }
}

function parseBackupNumber(name) { const m = (name || '').match(/^(\d+)/); if (!m) return null; const n = parseInt(m[1], 10); return isNaN(n) ? null : n; }
function getNextBackupNumber() { let m = 0; (backupFiles || []).forEach(f => { const n = parseBackupNumber(f.name); if (n && n > m) m = n; }); return m + 1; }

function renderDriveBackupList() {
    const container = document.getElementById('driveBackupList');
    const countEl = document.getElementById('driveBackupCount');
    if (!container) return;
    if (!isDriveConnected) { container.innerHTML = `<div class="drive-empty"><i class="fab fa-google-drive"></i><p>${translate('driveConnectPrompt')}</p></div>`; if (countEl) countEl.textContent = translate('backupCountLabel') + ' 0'; return; }
    if (backupFiles.length === 0) { container.innerHTML = `<div class="drive-empty"><i class="fas fa-cloud-upload-alt"></i><p>${translate('noBackups')}</p></div>`; if (countEl) countEl.textContent = translate('backupCountLabel') + ' 0'; return; }
    const locale = (currentLang === 'ur') ? 'ur-PK' : (currentLang || 'ar');
    const sorted = [...backupFiles].sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
    let fb = 1;
    const numbered = sorted.map(f => { const p = parseBackupNumber(f.name); return { ...f, number: p || fb++ }; }).sort((a, b) => a.number - b.number);
    let html = `<table class="backup-table"><thead><tr><th>${translate('backupName')}</th><th>${translate('backupDate')}</th><th>${translate('backupSize')}</th><th style="text-align:left;">${translate('actions')}</th></tr></thead><tbody>`;
    numbered.forEach(f => {
        const d = new Date(f.createdTime).toLocaleString(locale, { numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const size = f.size ? (parseInt(f.size) / 1024).toFixed(1) + 'KB' : translate('unknown');
        html += `<tr><td class="file-name">${translate('backupCopy')} ${f.number}</td><td class="file-date">${d}</td><td class="file-size">${size}</td><td><div class="file-actions"><button class="restore-btn" onclick="restoreBackup('${f.id}')"><i class="fas fa-download"></i></button><button class="delete-btn" onclick="deleteBackup('${f.id}')"><i class="fas fa-trash"></i></button></div></td></tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
    if (countEl) countEl.textContent = translate('backupCountLabel') + ' ' + backupFiles.length;
}

function refreshBackupList() { loadBackupList(); toastMsg(translate('refreshingList'), "info"); }

async function performBackup() {
    if (!accessToken || !appFolderId) { toastMsg(translate('driveNotConnected'), "error"); return; }
    showLoading(translate('savingBackup'));
    try {
        const data = { exp: db.exp, rig: db.rig, deb: db.deb, bal: db.bal, inc: db.inc, currency: currentCurrency, backupDate: new Date().toISOString() };
        const now = new Date(); const pad = n => String(n).padStart(2, '0');
        const fileName = `${String(getNextBackupNumber()).padStart(3, '0')}_${translate('backupFileNamePrefix')}_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.json`;
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify({ name: fileName, parents: [appFolderId], mimeType: 'application/json' })], { type: 'application/json' }));
        form.append('file', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }, body: form });
        if (!r.ok) throw new Error('Upload failed');
        hideLoading(); toastMsg(translate('backupSaved'), "success");
        await loadBackupList();
    } catch (e) { hideLoading(); console.error(e); toastMsg(translate('backupFailed'), "error"); }
}

async function restoreBackup(fileId) {
    if (!confirm(translate('confirmRestore'))) return;
    showLoading(translate('restoringData'));
    try {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!r.ok) throw new Error('Download failed');
        const imported = JSON.parse(await r.text());
        await clearAllStores();
        if (imported.bal && imported.bal.changes) { imported.bal.clientId = 1; await bulkAddToStore('bal', [imported.bal]); }
        for (const sn of ['exp', 'rig', 'deb', 'inc']) if (imported[sn] && Array.isArray(imported[sn])) await bulkAddToStore(sn, imported[sn]);
        if (imported.currency) { currentCurrency = imported.currency; localStorage.setItem('currencyCode', currentCurrency.code); }
        await loadAllData();
        hideLoading(); updateStats(); updateBalanceDisplay();
        toastMsg(translate('dataRestored'), "success");
        await loadBackupList();
        scheduleAutoSync();
    } catch (e) { hideLoading(); console.error(e); toastMsg(translate('restoreFailed'), "error"); }
}

async function deleteBackup(fileId) {
    if (!confirm(translate('confirmDeleteBackup'))) return;
    try {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!r.ok) throw new Error('Delete failed');
        toastMsg(translate('backupDeleted'), "success");
        await loadBackupList();
    } catch (e) { toastMsg(translate('deleteFailed'), "error"); }
}

// =============================================================
// 5. SYNC SYSTEM (مزامنة + كشف تعارض يعمل على أي جهاز)
// =============================================================
function getTotalRecordCount() { return (db.exp?.length || 0) + (db.rig?.length || 0) + (db.deb?.length || 0) + (db.inc?.length || 0); }

function updateAutoSyncUI() {
    const toggle = document.getElementById('autoSyncToggle');
    const statusEl = document.getElementById('autoSyncStatus');
    const syncNowBtn = document.getElementById('syncNowBtn');
    if (toggle) toggle.checked = autoSyncEnabled;
    if (statusEl) {
        if (!isDriveConnected) { statusEl.textContent = translate('autoSyncReadyNotConnected'); statusEl.className = 'auto-sync-status'; }
        else if (syncInProgress) { statusEl.textContent = translate('syncingNow'); statusEl.className = 'auto-sync-status syncing'; }
        else if (lastSyncTimestamp) { const d = new Date(parseInt(lastSyncTimestamp)); statusEl.textContent = `${translate('lastSyncLabel')}: ${d.toLocaleString((currentLang === 'ur') ? 'ur-PK' : (currentLang || 'ar'), { numberingSystem: 'latn', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`; statusEl.className = 'auto-sync-status success'; }
        else { statusEl.textContent = translate('lastSyncNever'); statusEl.className = 'auto-sync-status'; }
    }
    if (syncNowBtn) syncNowBtn.disabled = syncInProgress || !isDriveConnected;
}

function toggleAutoSync(checked) { autoSyncEnabled = checked; localStorage.setItem('autoSyncEnabled', checked ? 'true' : 'false'); updateAutoSyncUI(); if (checked && isDriveConnected) scheduleAutoSync(); }
function manualSyncNow() { if (!isDriveConnected) { toastMsg(translate('driveNotConnected'), "error"); return; } performSync(); }
function scheduleAutoSync() { if (!autoSyncEnabled || !isDriveConnected || syncInProgress) return; setTimeout(() => performSync(), 3000); }

function setLastSync(ts, count, balance) {
    lastSyncTimestamp = String(ts); lastSyncRecordCount = count; lastSyncBalance = String(balance);
    localStorage.setItem('lastSyncTimestamp', lastSyncTimestamp);
    localStorage.setItem('lastSyncRecordCount', String(lastSyncRecordCount));
    localStorage.setItem('lastSyncBalance', lastSyncBalance);
}

async function performSync() {
    if (!accessToken || syncInProgress) return;
    syncInProgress = true; updateAutoSyncUI();
    try {
        const syncFileId = await findSyncFile();
        const count = getTotalRecordCount();
        const syncData = { meta: { lastModified: new Date().toISOString(), deviceId: deviceId, recordCount: count, balance: String(currentBalance), schemaVersion: 1 }, data: { exp: db.exp, rig: db.rig, deb: db.deb, bal: db.bal, inc: db.inc, currency: currentCurrency } };
        const fileData = new Blob([JSON.stringify(syncData, null, 2)], { type: 'application/json' });
        if (syncFileId) await updateSyncFile(syncFileId, fileData); else await createSyncFile(fileData);
        setLastSync(Date.now(), count, currentBalance);
        syncInProgress = false; updateAutoSyncUI();
        toastMsg(translate('syncSuccess'), "success");
    } catch (e) { syncInProgress = false; updateAutoSyncUI(); console.error(e); toastMsg(translate('syncFailed'), "error"); }
}

// ✔✔✔ المنطق الجديد: يظهر التعارض على الهاتف الجديد أيضاً
async function checkAndHandleSync() {
    if (!accessToken || !autoSyncEnabled) return;
    try {
        const syncFileId = await findSyncFile();
        const localCount = getTotalRecordCount();
        if (!syncFileId) { if (localCount > 0) await performSync(); return; }
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${syncFileId}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!r.ok) return;
        const remote = JSON.parse(await r.text());
        const meta = remote.meta || {};
        const remoteTs = meta.lastModified ? new Date(meta.lastModified).getTime() : 0;
        const localTs = lastSyncTimestamp ? parseInt(lastSyncTimestamp) : 0;
        const remoteCount = meta.recordCount || 0;
        const hasLocalChanges = (localCount !== lastSyncRecordCount) || (String(currentBalance) !== lastSyncBalance);
        const remoteNewer = remoteTs > localTs;
        if (localCount === 0 && remoteCount > 0) {
            openConflict(syncFileId, remote, meta, localCount, remoteCount);
        } else if (remoteNewer && hasLocalChanges) {
            openConflict(syncFileId, remote, meta, localCount, remoteCount);
        } else if (remoteNewer && !hasLocalChanges) {
            await applyRemoteData(remote.data);
            setLastSync(remoteTs, remoteCount, meta.balance);
            updateAutoSyncUI();
            toastMsg(translate('syncUpdated'), "success");
        } else if (!remoteNewer && hasLocalChanges) {
            await performSync();
        }
    } catch (e) { console.error('Sync check error:', e); }
}

function openConflict(syncFileId, remote, meta, localCount, remoteCount) {
    pendingConflictData = { syncFileId, remoteData: remote.data, remoteMeta: meta, localRecordCount: localCount, remoteRecordCount: remoteCount };
    openLayer('syncConflict', { conflict: pendingConflictData });
}

async function applyRemoteData(remoteData) {
    if (!remoteData) return;
    await clearAllStores();
    if (remoteData.bal && remoteData.bal.changes) { remoteData.bal.clientId = 1; await bulkAddToStore('bal', [remoteData.bal]); }
    for (const sn of ['exp', 'rig', 'deb', 'inc']) if (remoteData[sn] && Array.isArray(remoteData[sn])) await bulkAddToStore(sn, remoteData[sn]);
    if (remoteData.currency) { currentCurrency = remoteData.currency; localStorage.setItem('currencyCode', currentCurrency.code); const l = document.getElementById('sidebarCurrencyLabel'); if (l) l.textContent = currentCurrency.symbol; }
    await loadAllData(); updateStats(); updateBalanceDisplay();
}

function showConflictDialog() {
    const c = document.getElementById('conflictChoiceView'); if (c) c.style.display = 'block';
    const d = document.getElementById('conflictDetailsView'); if (d) d.style.display = 'none';
}

function dismissConflict() { pendingConflictData = null; closeLayer('syncConflict'); toastMsg(translate('conflictPendingReminder'), "info"); }

async function resolveConflict(choice) {
    if (!pendingConflictData) return;
    showLoading(translate('processing'));
    try {
        if (choice === 'local') { await performSync(); }
        else {
            await applyRemoteData(pendingConflictData.remoteData);
            const m = pendingConflictData.remoteMeta;
            setLastSync(m.lastModified ? new Date(m.lastModified).getTime() : Date.now(), m.recordCount || getTotalRecordCount(), m.balance || currentBalance);
            updateAutoSyncUI();
        }
        pendingConflictData = null;
        hideLoading(); closeLayer('syncConflict');
        toastMsg(translate('dataRestored'), "success");
    } catch (e) { hideLoading(); console.error(e); toastMsg(translate('syncFailed'), "error"); }
}

function showConflictDetails() {
    const c = document.getElementById('conflictChoiceView'); if (c) c.style.display = 'none';
    const d = document.getElementById('conflictDetailsView'); if (d) d.style.display = 'block';
    if (pendingConflictData) {
        const m = pendingConflictData.remoteMeta || {};
        const lc = document.getElementById('localRecordCount'); if (lc) lc.textContent = pendingConflictData.localRecordCount || 0;
        const rc = document.getElementById('remoteRecordCount'); if (rc) rc.textContent = pendingConflictData.remoteRecordCount || 0;
        const rm = document.getElementById('remoteLastModified'); if (rm && m.lastModified) rm.textContent = new Date(m.lastModified).toLocaleString((currentLang === 'ur') ? 'ur-PK' : (currentLang || 'ar'), { numberingSystem: 'latn', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const eb = document.getElementById('remoteEditedBy'); if (eb) eb.textContent = (m.deviceId && m.deviceId !== deviceId) ? translate('conflictAnotherDevice') : translate('conflictThisPhone');
    }
}

function backToConflictChoice() { const c = document.getElementById('conflictChoiceView'); if (c) c.style.display = 'block'; const d = document.getElementById('conflictDetailsView'); if (d) d.style.display = 'none'; }

// =============================================================
// 6. EXPORT / IMPORT + DB HELPERS
// =============================================================
function openExportNameModal() { openLayer('exportName'); }
function performExport() {
    const f = document.getElementById('exportFileName'); const name = f ? f.value.trim() : '';
    if (!name) { toastMsg(translate('enterFileName'), "error"); return; }
    closeLayer('exportName');
    const blob = new Blob([JSON.stringify({ exp: db.exp, rig: db.rig, deb: db.deb, bal: db.bal, inc: db.inc, currency: currentCurrency }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `${name}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    toastMsg(translate('exportSuccess'), "success");
}

async function importData(event) {
    const file = event.target.files[0]; if (!file) return;
    if (!confirm(translate('confirmImport'))) { event.target.value = null; return; }
    showLoading(translate('importingData'));
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const im = JSON.parse(e.target.result);
            await clearAllStores();
            if (im.bal && im.bal.changes) { im.bal.clientId = 1; await bulkAddToStore('bal', [im.bal]); }
            for (const sn of ['exp', 'rig', 'deb', 'inc']) if (im[sn] && Array.isArray(im[sn])) await bulkAddToStore(sn, im[sn]);
            if (im.currency) { currentCurrency = im.currency; localStorage.setItem('currencyCode', currentCurrency.code); }
            await loadAllData(); hideLoading(); updateStats(); updateBalanceDisplay();
            toastMsg(translate('importSuccess'), "success"); scheduleAutoSync();
        } catch (err) { hideLoading(); toastMsg(translate('importFailed'), "error"); }
        finally { event.target.value = null; }
    };
    reader.readAsText(file);
}

function clearAllStores() {
    return new Promise((resolve, reject) => {
        if (!IDB_connection) return resolve();
        const tx = IDB_connection.transaction(STORE_NAMES, 'readwrite');
        let done = 0, err = false;
        STORE_NAMES.forEach(sn => { const r = tx.objectStore(sn).clear(); r.onsuccess = () => { done++; if (done === STORE_NAMES.length && !err) resolve(); }; r.onerror = () => { if (!err) { err = true; reject(r.error); } }; });
    });
}

function bulkAddToStore(storeName, arr) {
    return new Promise((resolve, reject) => {
        if (!IDB_connection || !arr || !arr.length) return resolve();
        const tx = IDB_connection.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        arr.forEach(item => { if (storeName === 'bal') store.put(item); else { const s = { ...item }; delete s.id; store.add(s); } });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
}

// =============================================================
// 7. LOADING / TOAST
// =============================================================
function showLoading(m = translate('processing')) { const o = document.getElementById('loadingOverlay'); const msg = document.getElementById('loadingMessage'); if (msg) msg.textContent = m; if (o) o.classList.add('show'); }
function hideLoading() { const o = document.getElementById('loadingOverlay'); if (o) o.classList.remove('show'); }
function toastMsg(message, type = "info") { const t = document.getElementById('toast'); if (!t) return; t.className = 'toast ' + type; const im = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' }; t.innerHTML = `<span class="toast-icon ${type}"><i class="fas ${im[type] || 'fa-info-circle'}"></i></span> ${message}`; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); }

// =============================================================
// 8. FORMATTING + CURRENCIES
// =============================================================
const ARABIC_CURRENCIES = [
    { code: 'SAR', symbol: '﷼', flag: '🇸🇦', name: { ar: 'الريال السعودي', en: 'Saudi Riyal', ur: 'سعودی ریال' } },
    { code: 'SDG', symbol: 'ج.س', flag: '🇸🇩', name: { ar: 'الجنيه السوداني', en: 'Sudanese Pound', ur: 'سوڈانی پاؤنڈ' } },
    { code: 'AED', symbol: 'د.إ', flag: '🇦🇪', name: { ar: 'الدرهم الإماراتي', en: 'UAE Dirham', ur: 'اماراتی درہم' } },
    { code: 'QAR', symbol: 'ر.ق', flag: '🇶🇦', name: { ar: 'الريال القطري', en: 'Qatari Riyal', ur: 'قطری ریال' } },
    { code: 'KWD', symbol: 'د.ك', flag: '🇰🇼', name: { ar: 'الدينار الكويتي', en: 'Kuwaiti Dinar', ur: 'کویتی دینار' } },
    { code: 'BHD', symbol: 'د.ب', flag: '🇧🇭', name: { ar: 'الدينار البحريني', en: 'Bahraini Dinar', ur: 'بحرینی دینار' } },
    { code: 'OMR', symbol: 'ر.ع', flag: '🇴🇲', name: { ar: 'الريال العُماني', en: 'Omani Rial', ur: 'عمانی ریال' } },
    { code: 'YER', symbol: 'ر.ي', flag: '🇾', name: { ar: 'الريال اليمني', en: 'Yemeni Rial', ur: 'یمنی ریال' } },
    { code: 'IQD', symbol: 'ع.د', flag: '🇮🇶', name: { ar: 'الدينار العراقي', en: 'Iraqi Dinar', ur: 'عراقی دینار' } },
    { code: 'JOD', symbol: 'د.أ', flag: '🇯🇴', name: { ar: 'الدينار الأردني', en: 'Jordanian Dinar', ur: 'اردنی دینار' } },
    { code: 'LBP', symbol: 'ل.ل', flag: '🇱🇧', name: { ar: 'الليرة اللبنانية', en: 'Lebanese Lira', ur: 'لبنانی لیرا' } },
    { code: 'SYP', symbol: 'ل.س', flag: '🇸🇾', name: { ar: 'الليرة السورية', en: 'Syrian Lira', ur: 'شامی لیرا' } },
    { code: 'ILS', symbol: '₪', flag: '🇵🇸', name: { ar: 'الشيكل الفلسطيني', en: 'Israeli Shekel', ur: 'اسرائیلی شیکل' } },
    { code: 'EGP', symbol: 'ج.م', flag: '🇪🇬', name: { ar: 'الجنيه المصري', en: 'Egyptian Pound', ur: 'مصری پاؤنڈ' } },
    { code: 'LYD', symbol: 'ل.د', flag: '🇱🇾', name: { ar: 'الدينار الليبي', en: 'Libyan Dinar', ur: 'لیبیائی دینار' } },
    { code: 'TND', symbol: 'د.ت', flag: '🇹', name: { ar: 'الدينار التونسي', en: 'Tunisian Dinar', ur: 'تونسی دینار' } },
    { code: 'DZD', symbol: 'دج', flag: '🇩🇿', name: { ar: 'الدينار الجزائري', en: 'Algerian Dinar', ur: 'الجزائری دینار' } },
    { code: 'MAD', symbol: 'د.م', flag: '🇲🇦', name: { ar: 'الدرهم المغربي', en: 'Moroccan Dirham', ur: 'مراکشی درہم' } },
    { code: 'MRU', symbol: 'أ.م', flag: '🇲🇷', name: { ar: 'الأوقية الموريتانية', en: 'Mauritanian Ouguiya', ur: 'موریطانی اوگوئیا' } },
    { code: 'SOS', symbol: 'ش.ص', flag: '🇸🇴', name: { ar: 'الشلن الصومالي', en: 'Somali Shilling', ur: 'صومالی شلنگ' } },
    { code: 'DJF', symbol: 'ف.ج', flag: '🇩🇯', name: { ar: 'الفرنك الجيبوتي', en: 'Djiboutian Franc', ur: 'جبوتی فرینک' } },
    { code: 'KMF', symbol: 'ف.ق', flag: '🇰🇲', name: { ar: 'الفرنك القمري', en: 'Comorian Franc', ur: 'قموری فرینک' } },
    { code: 'SSP', symbol: 'ج.س.ج', flag: '🇸🇸', name: { ar: 'جنيه جنوب السودان', en: 'South Sudanese Pound', ur: 'جنوب سوڈانی پاؤنڈ' } },
    { code: 'USD', symbol: '$', flag: '🇺🇸', name: { ar: 'الدولار الأمريكي', en: 'US Dollar', ur: 'امریکی ڈالر' } },
    { code: 'EUR', symbol: '€', flag: '🇪', name: { ar: 'اليورو', en: 'Euro', ur: 'یورو' } },
    { code: 'BDT', symbol: '৳', flag: '🇧🇩', name: { ar: 'التاكا البنغلاديشي', en: 'Bangladeshi Taka', ur: 'بنگلادیشی ٹاکا' } },
    { code: 'INR', symbol: '₹', flag: '🇮', name: { ar: 'الروبية الهندية', en: 'Indian Rupee', ur: 'بھارتی روپیہ' } },
    { code: 'PKR', symbol: '₨', flag: '🇵🇰', name: { ar: 'الروبية الباكستانية', en: 'Pakistani Rupee', ur: 'پاکستانی روپیہ' } },
    { code: 'PHP', symbol: '₱', flag: '🇵🇭', name: { ar: 'البيزو الفلبيني', en: 'Philippine Peso', ur: 'فلپائنی پیسو' } },
    { code: 'CNY', symbol: '¥', flag: '🇨🇳', name: { ar: 'اليوان الصيني', en: 'Chinese Yuan', ur: 'چینی یوآن' } }
];
let currentCurrency = ARABIC_CURRENCIES.find(c => c.code === (localStorage.getItem('currencyCode') || 'SAR')) || ARABIC_CURRENCIES[0];

function getCurrencyName(c) { const l = (c.name && c.name[currentLang]) ? currentLang : 'ar'; return (c.name && c.name[l]) || c.code; }
function formatAmount(input) { if (!input) return; let v = input.value.replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632 + 48)); v = v.replace(/[^\d.]/g, ''); const p = v.split('.'); if (p.length > 2) v = p[0] + '.' + p.slice(1).join(''); const num = parseFloat(p[0].replace(/,/g, '')); let f = isNaN(num) ? '' : num.toLocaleString('en-US'); if (input.value.endsWith('.') && !(p[1])) f += '.'; input.value = f + (p[1] ? '.' + p[1] : ''); }
function parseAmount(a) { if (a === null || a === undefined) return 0; let s = String(a).trim(); let neg = false; if (s.charAt(0) === '-') { neg = true; s = s.substring(1); } s = s.replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632 + 48)); s = s.replace(/٫/g, '.').replace(/٬/g, '').replace(/[،,\s]/g, '').replace(/[^\d.]/g, ''); const p = s.split('.'); if (p.length > 2) s = p[0] + '.' + p.slice(1).join(''); const v = parseFloat(s); if (isNaN(v)) return 0; return neg ? -v : v; }
function getFormattedAmount(n) { const a = Math.abs(n); const f = a.toLocaleString('en-US', { minimumFractionDigits: a % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }); return n < 0 ? '-' + f : f; }
function getLocalDateString(d = new Date()) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function getLocalDateTimeString(d = new Date()) { const p = n => String(n).padStart(2, '0'); return `${getLocalDateString(d)}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function formatCurrency(a, wc = false) { const n = parseAmount(a); const f = getFormattedAmount(n); let c = ''; if (wc) c = n > 0 ? 'balance-positive' : (n < 0 ? 'balance-negative' : 'balance-zero'); return `<span class="${c}">${f} <span class="currency-symbol">${currentCurrency.symbol}</span></span>`; }
function formatBalance(a) { if (balanceHidden) return '<span class="hidden-balance">***</span>'; const n = parseAmount(a); const f = getFormattedAmount(n); const c = n > 0 ? 'balance-positive' : (n < 0 ? 'balance-negative' : 'balance-zero'); return `<span class="${c}">${f} <span class="currency-symbol">${currentCurrency.symbol}</span></span>`; }
function formatDateTime(ds) { if (!ds) return '—'; const loc = (currentLang === 'ur') ? 'ur-PK' : (currentLang || 'ar'); if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) { const [y, m, d] = ds.split('-').map(Number); const dt = new Date(y, m - 1, d); if (isNaN(dt)) return translate('invalidDate'); return dt.toLocaleDateString(loc, { numberingSystem: 'latn', year: 'numeric', month: 'short', day: 'numeric' }); } const d = new Date(ds); if (isNaN(d)) return translate('invalidDate'); return d.toLocaleString(loc, { numberingSystem: 'latn', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }); }
function clearFields() { ['iAmount', 'iDesc', 'iType', 'iDate', 'eAmount', 'eDesc', 'eType', 'eDate', 'rAmount', 'rDesc', 'rType', 'rEntity', 'rDueDate', 'rNotifTiming', 'dType', 'dAmount', 'dDesc', 'dStatus', 'dEntity', 'dDueDate', 'dNotifTiming'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); clearSelectedImage(); const r = document.getElementById('rDynamicFields'); if (r) r.innerHTML = ''; const d = document.getElementById('dDynamicFields'); if (d) d.innerHTML = ''; const p = document.getElementById('dPartialPaidContainer'); if (p) p.remove(); document.querySelectorAll('.edit-indicator').forEach(el => el.style.display = 'none'); const de = document.getElementById('dEntity'); if (de) de.style.display = 'none'; }

// =============================================================
// 9-10. TABS + BALANCE
// =============================================================
function openTab(id, keepEdit = false) { document.querySelectorAll('.section').forEach(s => s.classList.remove('active')); const s = document.getElementById(id); if (s) s.classList.add('active'); document.querySelectorAll('.bottom-nav .nav-item').forEach(b => { b.classList.remove('active'); if (b.dataset.tab === id) b.classList.add('active'); }); if (!keepEdit) { editMode = null; clearFields(); } if (id === 'overview') updateStats(); if (editMode) { const m = { inc: 'incEditIndicator', exp: 'expEditIndicator', rig: 'rigEditIndicator', deb: 'debEditIndicator' }; const i = document.getElementById(m[editMode.type]); if (i) i.style.display = 'inline-block'; } }
function openTabFromNav(t) { const e = document.getElementById(t); if (!e || e.classList.contains('active')) return; closeAllLayers(); openTab(t); }
function toggleBalanceVisibility() { balanceHidden = !balanceHidden; localStorage.setItem('balanceHidden', balanceHidden); updateBalanceDisplay(); updateStats(); }
function updateBalanceDisplay() { const el = document.getElementById('currentBalanceDisplay'); if (el) el.innerHTML = formatBalance(currentBalance); const a = document.getElementById('currentBalanceInAction'); if (a) a.innerHTML = formatBalance(currentBalance); const i = document.querySelector('#balanceVisibilityToggle i'); if (i) i.className = balanceHidden ? 'fas fa-eye-slash' : 'fas fa-eye'; const b = document.getElementById('balanceLogModal'); if (b && b.style.display === 'flex') renderBalanceLog(); }

async function processBalanceChange(amount, type, description, recordId = null, isEdit = false, oldAmount = 0) {
    if (!recordId) recordId = `bal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const ch = parseAmount(amount); let net = ch;
    if (['expense', 'debt_payment', 'withdraw', 'revert_expense_debt'].includes(type)) net *= -1;
    let eff = net; if (isEdit) eff = net - oldAmount;
    currentBalance = parseAmount(currentBalance) + eff; db.bal.amount = currentBalance;
    const entry = { id: recordId, التاريخ: getLocalDateTimeString(), النوع: description, المبلغ: ch, التأثير: (net > 0 ? translate('depositEffect') : (net < 0 ? translate('withdrawEffect') : translate('editEffect'))), القيمة_الصافية: net, الرصيد_بعد_العملية: currentBalance };
    const idx = db.bal.changes.findIndex(c => c.id === recordId);
    if (idx > -1) db.bal.changes[idx] = entry; else db.bal.changes.unshift(entry);
    try { await saveData('bal', db.bal); updateBalanceDisplay(); return true; }
    catch (e) { currentBalance -= eff; toastMsg(translate('balanceUpdateFailed'), "error"); return false; }
}

async function processBalanceAction() {
    const a = document.getElementById('bAmount'); const d = document.getElementById('bDesc');
    const amt = a ? a.value : ''; const desc = (d && d.value) ? d.value : (balanceActionType === 'deposit' ? translate('generalDeposit') : translate('generalWithdraw'));
    if (!amt) return toastMsg(translate('enterAmount'), "error");
    const ok = await processBalanceChange(amt, balanceActionType, desc, `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    if (ok) { toastMsg(balanceActionType === 'deposit' ? translate('depositSuccess') : translate('withdrawSuccess'), "success"); closeLayer('balanceAction'); scheduleAutoSync(); }
}

function renderBalanceLog() {
    const el = document.getElementById('balanceLogContent'); if (!el) return;
    let list = db.bal.changes || [];
    const q = (document.getElementById('balanceSearch')?.value || '').toLowerCase();
    if (q) list = list.filter(i => String(i.النوع).toLowerCase().includes(q));
    if (balanceFilters.type === 'deposit') list = list.filter(i => i.القيمة_الصافية > 0);
    if (balanceFilters.type === 'withdraw') list = list.filter(i => i.القيمة_الصافية < 0);
    let dep = 0, wit = 0; list.forEach(i => { if (i.القيمة_الصافية > 0) dep += i.القيمة_الصافية; else if (i.القيمة_الصافية < 0) wit += Math.abs(i.القيمة_الصافية); });
    const bar = document.getElementById('balanceStatsBar');
    if (bar) bar.innerHTML = `<div class="log-stat-chip"><span class="stat-label">${translate('movementsCount')}</span><span class="stat-value">${list.length}</span></div><div class="log-stat-chip"><span class="stat-label">${translate('totalDeposits')}</span><span class="stat-value" style="color:var(--success)">${getFormattedAmount(dep)}</span></div><div class="log-stat-chip"><span class="stat-label">${translate('totalWithdrawals')}</span><span class="stat-value" style="color:var(--danger)">${getFormattedAmount(wit)}</span></div>`;
    if (!list.length) { el.innerHTML = `<p style="text-align:center;color:#999;padding:30px 0;">${translate('noBalanceLog')}</p>`; return; }
    el.innerHTML = list.map(i => {
        const dep_ = i.القيمة_الصافية > 0; const color = dep_ ? 'var(--success)' : (i.القيمة_الصافية < 0 ? 'var(--danger)' : '#999');
        const icon = dep_ ? 'fa-arrow-up' : (i.القيمة_الصافية < 0 ? 'fa-arrow-down' : 'fa-minus');
        return `<div class="list-item" style="border-right-color:${color};"><div style="font-weight:bold;display:flex;justify-content:space-between;"><span><i class="fas ${icon}" style="margin-left:8px;color:${color};"></i>${i.النوع}</span><span style="color:${color};">${(i.القيمة_الصافية < 0 ? '-' : '') + formatCurrency(Math.abs(i.المبلغ))}</span></div><div class="details"><span>${translate('balanceAfter')}: ${formatBalance(i.الرصيد_بعد_العملية)}</span><span>${formatDateTime(i.التاريخ)}</span></div></div>`;
    }).join('');
}

// =============================================================
// 11. CRUD
// =============================================================
async function addIncome() {
    const A = document.getElementById('iAmount'), T = document.getElementById('iType'), D = document.getElementById('iDate'), De = document.getElementById('iDesc');
    if (!A.value || !T.value || !D.value) return toastMsg(translate('fillRequired'), "error");
    const isE = editMode && editMode.type === 'inc'; const old = isE ? db.inc[editMode.index] : {}; const oldAmt = isE ? parseAmount(old.المبلغ) : 0;
    const amt = parseAmount(A.value); if (amt === 0) return toastMsg(translate('amountMustBePositive'), "error");
    const data = isE ? { ...old } : {}; data.المبلغ = getFormattedAmount(amt); data.الفئة = T.value; data.الوصف = (De && De.value) ? De.value : '—'; data.التاريخ = D.value;
    data.clientId = isE ? old.clientId : `inc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    try { await saveData('inc', data); await processBalanceChange(amt, 'income', `${translate('incomeLogPrefix')}: ${translateStoredValue(data.الفئة)} (${data.الوصف})`, data.clientId, isE, oldAmt); toastMsg(isE ? translate('incomeEdited') : translate('incomeSaved'), "success"); postSaveCleanup(); } catch (e) { toastMsg(translate('saveFailed'), "error"); }
}

async function addExpense() {
    const A = document.getElementById('eAmount'), T = document.getElementById('eType'), D = document.getElementById('eDate'), De = document.getElementById('eDesc');
    if (!A.value || !T.value || !D.value) return toastMsg(translate('fillRequired'), "error");
    const isE = editMode && editMode.type === 'exp'; const old = isE ? db.exp[editMode.index] : {}; const oldAmt = isE ? parseAmount(old.المبلغ) * -1 : 0;
    const amt = parseAmount(A.value); if (amt === 0) return toastMsg(translate('amountMustBePositive'), "error");
    const data = isE ? { ...old } : {}; data.المبلغ = getFormattedAmount(amt); data.الفئة = T.value; data.الوصف = (De && De.value) ? De.value : '—'; data.التاريخ = D.value;
    data.clientId = isE ? old.clientId : `exp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const img = getSelectedImage();
    if (img && typeof img === 'string' && img.startsWith('data:image')) data.صورة = img; else if (!isE) delete data.صورة; else if (old.صورة) data.صورة = old.صورة;
    try { await saveData('exp', data); await processBalanceChange(amt, 'expense', `${translate('expenseLogPrefix')}: ${translateStoredValue(data.الفئة)} (${data.الوصف})`, data.clientId, isE, oldAmt); toastMsg(isE ? translate('expenseEdited') : translate('expenseSaved'), "success"); postSaveCleanup(); } catch (e) { toastMsg(translate('saveFailed'), "error"); }
}

function updateRightFields(type, cur = null) {
    const c = document.getElementById('rDynamicFields'); if (!c) return;
    c.innerHTML = `<input id="rPaidAmount" type="text" placeholder="💰 ${translate('collectedAmount')}" oninput="formatAmount(this)" inputmode="decimal" value="${cur && cur.المبلغ_المدفوع ? parseAmount(cur.المبلغ_المدفوع).toLocaleString('en-US') : ''}" /><span class="field-hint">${translate('collectedAmountHint')}</span>`;
}

async function addRight() {
    const A = document.getElementById('rAmount'), T = document.getElementById('rType'), E = document.getElementById('rEntity'), D = document.getElementById('rDueDate'), De = document.getElementById('rDesc'), P = document.getElementById('rPaidAmount');
    if (!A.value || !T.value || !D.value) return toastMsg(translate('fillRequired'), "error");
    const isE = editMode && editMode.type === 'rig'; const old = isE ? db.rig[editMode.index] : {};
    const total = parseAmount(A.value); if (total === 0) return toastMsg(translate('amountMustBePositive'), "error");
    const paid = parseAmount(P ? P.value : 0); if (paid > total) return toastMsg(translate('paidExceedsTotal'), "error");
    const data = isE ? { ...old } : {}; data.clientId = isE ? old.clientId : `rig-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    data.النوع = T.value; data.المبلغ = getFormattedAmount(total); data.الجهة = (E && E.value) ? E.value : '—'; data.تاريخ_الاستحقاق = D.value; data.الوصف = (De && De.value) ? De.value : '—'; data.المبلغ_المدفوع = getFormattedAmount(paid);
    const nt = document.getElementById('rNotifTiming'); data.وقت_التنبيه = nt ? (nt.value || '168') : '168';
    const rem = total - paid; data.المتبقي = getFormattedAmount(rem);
    data.الحالة = rem <= 0 ? translate('statusFullyPaid') : (paid > 0 ? translate('statusPartiallyPaid') : translate('statusUnpaid'));
    data.المبلغ_المضاف_للرصيد = paid;
    const oldPaid = isE ? parseAmount(old.المبلغ_المضاف_للرصيد || 0) : 0;
    try { await saveData('rig', data); await processBalanceChange(paid, 'right_collection', `${translate('rightLogPrefix')}: ${translateStoredValue(data.النوع)} (${data.الجهة})`, data.clientId, isE, oldPaid); toastMsg(isE ? translate('rightEdited') : translate('rightSaved'), "success"); postSaveCleanup(); } catch (e) { toastMsg(translate('saveFailed'), "error"); }
}

function updateDebtFields(type, cur = null) {
    const c = document.getElementById('dDynamicFields'); if (!c) return; c.innerHTML = '';
    const aI = document.getElementById('dAmount'), sS = document.getElementById('dStatus'), eI = document.getElementById('dEntity');
    const entityTypes = ['🏠 إيجار', '👤 دين شخصي', '📱 الاتصالات والإنترنت', '🎓 رسوم تعليمية', '🏥 مصاريف طبية مستحقة', '🚗 تمويل السيارة', '👨‍👩 التزامات عائلية', '📅 اشتراكات دورية', '👨‍💼 رواتب', '💡 كهرباء', '💧 ماء'];
    if (entityTypes.includes(type)) { if (eI) { eI.style.display = 'block'; if (cur && cur.الجهة) eI.value = cur.الجهة; } }
    else if (eI) { eI.style.display = 'none'; eI.value = ''; }
    const masterTypes = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة'];
    if (masterTypes.includes(type)) {
        if (aI) { aI.style.display = 'none'; aI.value = ''; }
        if (sS) { sS.style.display = 'none'; sS.value = ''; }
        let h = `<input id="dTotalAmount" type="text" placeholder="💵 ${translate('totalAmount')}" oninput="formatAmount(this)" inputmode="decimal" value="${cur && cur.المبلغ_الكلي_للالتزام ? parseAmount(cur.المبلغ_الكلي_للالتزام).toLocaleString('en-US') : ''}" /><span class="field-hint">${translate('totalAmountHint')}</span>`;
        if (type !== '👤 دين شخصي') h += `<input id="dInstallments" type="number" placeholder="${translate('totalInstallments')}" value="${cur && cur.عدد_الاقساط ? cur.عدد_الاقساط : ''}" /><input id="dPaidInstallments" type="number" placeholder="${translate('paidInstallments')}" value="${cur && cur.الأقساط_المدفوعة ? cur.الأقساط_المدفوعة : ''}" />`;
        else h += `<input id="dPaidAmount" type="text" placeholder="💰 ${translate('totalPaidSoFar')}" oninput="formatAmount(this)" inputmode="decimal" value="${cur && cur.إجمالي_المدفوع ? parseAmount(cur.إجمالي_المدفوع).toLocaleString('en-US') : ''}" />`;
        c.innerHTML = h;
    } else {
        if (aI) { aI.style.display = 'block'; if (cur) aI.value = parseAmount(cur.المبلغ || 0).toLocaleString('en-US'); }
        if (sS) { sS.style.display = 'block'; if (cur) sS.value = cur.الحالة || ''; }
    }
    if (!masterTypes.includes(type) && sS) {
        sS.onchange = function () {
            const st = sS.value; const pc = document.getElementById('dPartialPaidContainer');
            if (st === 'مدفوع جزئياً') { if (!pc) { const d = document.createElement('div'); d.id = 'dPartialPaidContainer'; d.innerHTML = `<input id="dPartialPaidAmount" type="text" placeholder="💰 ${translate('partialPaidAmount')}" oninput="formatAmount(this)" inputmode="decimal" /><span class="field-hint">${translate('partialPaidHint')}</span>`; sS.parentNode.insertBefore(d, sS.nextSibling); } }
            else if (pc) pc.remove();
        };
        sS.onchange();
        if (cur && cur.الحالة === 'مدفوع جزئياً' && cur.المبلغ_المدفوع_جزئياً) { const p = document.getElementById('dPartialPaidAmount'); if (p) p.value = parseAmount(cur.المبلغ_المدفوع_جزئياً).toLocaleString('en-US'); }
    }
}

async function addDebt() {
    const T = document.getElementById('dType'), A = document.getElementById('dAmount'), E = document.getElementById('dEntity'), D = document.getElementById('dDueDate'), De = document.getElementById('dDesc'), S = document.getElementById('dStatus');
    if (!T.value || !D.value) return toastMsg(translate('fillRequired'), "error");
    const isE = editMode && editMode.type === 'deb'; const old = isE ? db.deb[editMode.index] : {};
    const masterTypes = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة'];
    const isM = masterTypes.includes(T.value);
    const data = isE ? { ...old } : {}; data.clientId = isE ? old.clientId : `deb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    data.النوع = T.value; data.تاريخ_الاستحقاق = D.value; data.الوصف = (De && De.value) ? De.value : '—';
    data.الجهة = (E && E.style.display !== 'none' && E.value) ? E.value : '—';
    const nt = document.getElementById('dNotifTiming'); data.وقت_التنبيه = nt ? (nt.value || '168') : '168';
    let paid = 0; const oldPaid = isE ? parseAmount(old.المبلغ_المخصوم_للرصيد || 0) : 0;
    if (isM) {
        const tI = document.getElementById('dTotalAmount'); if (!tI || !tI.value) return toastMsg(translate('enterTotalAmount'), "error");
        const total = parseAmount(tI.value); if (total === 0) return toastMsg(translate('amountMustBePositive'), "error");
        data.المبلغ_الكلي_للالتزام = getFormattedAmount(total);
        let tp = 0;
        if (T.value !== '👤 دين شخصي') {
            const iI = document.getElementById('dInstallments'), pI = document.getElementById('dPaidInstallments');
            if (!iI || !iI.value) return toastMsg(translate('enterInstallments'), "error");
            const inst = parseInt(iI.value) || 0; const pinst = parseInt(pI ? pI.value : 0) || 0;
            if (inst <= 0) return toastMsg(translate('installmentsPositive'), "error");
            if (pinst > inst) return toastMsg(translate('paidInstallmentsExceed'), "error");
            tp = pinst * (total / inst);
            data.عدد_الاقساط = inst; data.قيمة_القسط = getFormattedAmount(total / inst); data.الأقساط_المدفوعة = pinst;
        } else { const pI = document.getElementById('dPaidAmount'); if (pI) tp = parseAmount(pI.value); if (tp > total) return toastMsg(translate('paidExceedsTotalDebt'), "error"); }
        data.إجمالي_المدفوع = getFormattedAmount(tp); data.المتبقي_للالتزام = getFormattedAmount(total - tp); data.المبلغ = '—';
        data.الحالة = (total - tp) <= 0 ? translate('statusPaid') : translate('statusPartiallyPaid');
        paid = tp;
    } else {
        if (!A.value || !S.value) return toastMsg(translate('fillRequired'), "error");
        const amt = parseAmount(A.value); if (amt === 0) return toastMsg(translate('amountMustBePositive'), "error");
        data.المبلغ = getFormattedAmount(amt); data.الحالة = S.value;
        if (S.value === 'مدفوع جزئياً') { const p = document.getElementById('dPartialPaidAmount'); if (!p || !p.value) return toastMsg(translate('enterPartialPaid'), "error"); const pp = parseAmount(p.value); if (pp <= 0) return toastMsg(translate('partialPaidPositive'), "error"); if (pp >= amt) return toastMsg(translate('partialPaidLessThanTotal'), "error"); paid = pp; data.المبلغ_المدفوع_جزئياً = getFormattedAmount(pp); }
        else if (S.value === 'مدفوع' || S.value === 'مدفوع بالكامل') paid = amt; else paid = 0;
        ['المبلغ_الكلي_للالتزام', 'إجمالي_المدفوع', 'المتبقي_للالتزام', 'عدد_الاقساط', 'قيمة_القسط', 'الأقساط_المدفوعة'].forEach(k => delete data[k]);
        if (S.value !== 'مدفوع جزئياً') delete data.المبلغ_المدفوع_جزئياً;
    }
    data.المبلغ_المخصوم_للرصيد = paid;
    const oldNet = isE ? -oldPaid : 0;
    try { await saveData('deb', data); await processBalanceChange(paid, 'debt_payment', `${translate('debtLogPrefix')}: ${translateStoredValue(data.النوع)} (${data.الجهة})`, data.clientId, isE, oldNet); toastMsg(isE ? translate('debtEdited') : translate('debtSaved'), "success"); postSaveCleanup(); } catch (e) { toastMsg(translate('saveFailed'), "error"); }
}

function postSaveCleanup() { closeAllLayers(); loadAllData().then(() => { updateStats(); updateBalanceDisplay(); }); editMode = null; clearFields(); scheduleAutoSync(); }

// =============================================================
// 12. LOGS / DETAIL
// =============================================================
function inPeriod(ds, p) { if (p === 'all' || !ds) return true; const d = new Date(ds); if (isNaN(d)) return true; const n = new Date(); if (p === 'today') return d.toDateString() === n.toDateString(); if (p === 'week') { const w = new Date(n); w.setDate(n.getDate() - 7); return d >= w; } if (p === 'month') return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); if (p === 'year') return d.getFullYear() === n.getFullYear(); return true; }
function matchStatus(st, f) { st = st || ''; if (f === 'paid') return (/مدفوع بالكامل/.test(st) || /مدفوع$/.test(st) || /Fully Paid/.test(st) || /^Paid$/.test(st)) && !/جزئ|Partial/.test(st) && !/غير|Unpaid/.test(st); if (f === 'partial') return /جزئياً|Partial/.test(st); if (f === 'unpaid') return /غير مدفوع|Unpaid/.test(st); if (f === 'late') return /متأخر|Overdue/.test(st); return true; }
function setLogFilter(k, v) { logFilters[k] = v; renderLog(); }
function setBalanceFilter(k, v) { balanceFilters[k] = v; renderBalanceLog(); }

function buildLogFilters() {
    const c = document.getElementById('logFilterCat'), s = document.getElementById('logFilterStatus'), p = document.getElementById('logFilterPeriod');
    if (!c || !s || !p) return;
    logFilters = { cat: 'all', status: 'all', period: 'all' };
    let opts = '';
    if (currentLog === 'inc' || currentLog === 'exp') { const src = document.getElementById(currentLog === 'inc' ? 'iType' : 'eType'); if (src) opts = Array.from(src.options).filter(o => o.value).map(o => `<option value="${o.value}">${o.textContent}</option>`).join(''); c.style.display = 'block'; }
    else if (currentLog === 'rig' || currentLog === 'deb') { const src = document.getElementById(currentLog === 'rig' ? 'rType' : 'dType'); if (src) opts = Array.from(src.options).filter(o => o.value).map(o => `<option value="${o.value}">${o.textContent}</option>`).join(''); c.style.display = 'block'; }
    else c.style.display = 'none';
    c.innerHTML = `<option value="all">${translate('allCategories')}</option>` + opts;
    if (currentLog === 'rig' || currentLog === 'deb') { s.style.display = 'block'; s.innerHTML = `<option value="all">${translate('allStatuses')}</option><option value="paid">${translate('statusPaid')}</option><option value="partial">${translate('statusPartiallyPaidShort')}</option><option value="unpaid">${translate('statusUnpaid')}</option><option value="late">${translate('statusOverdue')}</option>`; }
    else s.style.display = 'none';
    p.innerHTML = `<option value="all">${translate('periodAll')}</option><option value="today">${translate('periodToday')}</option><option value="week">${translate('periodWeek')}</option><option value="month">${translate('periodMonth')}</option><option value="year">${translate('periodYear')}</option>`;
}
function buildBalanceFilters() { const t = document.getElementById('balanceFilterType'); if (!t) return; t.innerHTML = `<option value="all">${translate('allTypes')}</option><option value="deposit">${translate('deposit')}</option><option value="withdraw">${translate('withdraw')}</option>`; t.value = balanceFilters.type || 'all'; }

function renderLogStats(list, field) {
    const bar = document.getElementById('logStatsBar'); if (!bar) return;
    let total = 0; const by = {};
    list.forEach(i => { const v = (currentLog === 'deb') ? parseAmount(i.المبلغ_الكلي_للالتزام || i.المبلغ || 0) : parseAmount(i.المبلغ); total += v; const c = i[field] || '—'; by[c] = (by[c] || 0) + v; });
    let tn = '—', tv = 0; Object.entries(by).forEach(([n, v]) => { if (v > tv) { tv = v; tn = n; } });
    const titles = { inc: translate('topIncomeSource'), exp: translate('topExpenseCategory'), rig: translate('topRightsType'), deb: translate('topDebtsType') };
    bar.innerHTML = `<div class="log-stat-chip"><span class="stat-label">${translate('operationsCount')}</span><span class="stat-value">${list.length}</span></div><div class="log-stat-chip"><span class="stat-label">${translate('totalAmountStat')}</span><span class="stat-value">${getFormattedAmount(total)}</span></div><div class="log-stat-chip"><span class="stat-label">${titles[currentLog] || ''}</span><span class="stat-value">${translateStoredValue(tn)} (${getFormattedAmount(tv)})</span></div>`;
}

function _renderDetailContent(o, type) {
    const el = document.getElementById('detailContent'); if (!el) return;
    let h = `<div class="card" style="border-top-color:var(--p);"><h3 style="color:var(--p);">${translate('details')}</h3>`;
    for (const [k, v] of Object.entries(o)) { if (['id', 'clientId', 'صورة', 'المبلغ_المضاف_للرصيد', 'المبلغ_المخصوم_للرصيد'].includes(k)) continue; if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '' && k !== 'الوصف')) continue; h += `<p style="margin:6px 0;"><strong>${translateFieldLabel(k)}:</strong> <span>${formatFieldValue(k, v)}</span></p>`; }
    h += `</div>`;
    if (o.صورة && type === 'exp') h += `<div class="card" style="border-top-color:var(--s);"><h3 style="color:var(--s);">${translate('invoiceImage')}</h3><img src="${o.صورة}" style="width:100%;border-radius:10px;" /></div>`;
    h += `<div style="display:flex;gap:10px;margin-top:20px;"><button class="secondary" onclick="editTransaction()" style="flex:1;"><i class="fas fa-edit"></i> ${translate('edit')}</button><button class="action" onclick="deleteTransaction()" style="background:var(--danger);flex:1;"><i class="fas fa-trash"></i> ${translate('delete')}</button></div>`;
    el.innerHTML = h;
}

function renderLog() {
    const el = document.getElementById('logContent'); if (!el) return;
    const items = db[currentLog] || [];
    const q = (document.getElementById('search')?.value || '').toLowerCase();
    const field = (currentLog === 'inc' || currentLog === 'exp') ? 'الفئة' : 'النوع';
    let f = items.filter(i => Object.values(i).some(v => String(v).toLowerCase().includes(q)));
    if (logFilters.cat !== 'all') f = f.filter(i => i[field] === logFilters.cat);
    if ((currentLog === 'rig' || currentLog === 'deb') && logFilters.status !== 'all') f = f.filter(i => matchStatus(i.الحالة, logFilters.status));
    if (logFilters.period !== 'all') f = f.filter(i => inPeriod(i.التاريخ || i.تاريخ_الاستحقاق, logFilters.period));
    renderLogStats(f, field);
    if (!f.length) { el.innerHTML = `<p style="text-align:center;color:#999;padding:30px 0;">${translate('noTransactions')}</p>`; return; }
    el.innerHTML = f.map(i => {
        let av = 0, ad = '', bc = 'var(--s)', sb = '', ac = 'var(--text-dark)';
        const desc = i.الوصف || translateStoredValue(i.الفئة) || translateStoredValue(i.النوع) || '—';
        const date = formatDateTime(i.التاريخ || i.تاريخ_الاستحقاق);
        const entity = i.الجهة || '';
        if (currentLog === 'inc') { av = parseAmount(i.المبلغ); ad = '+' + formatCurrency(av); ac = 'var(--success)'; bc = 'var(--success)'; sb = `<span class="status-badge paid" style="background:var(--success);">${translate('income')}</span>`; }
        else if (currentLog === 'exp') { av = parseAmount(i.المبلغ); ad = formatCurrency(av); bc = 'var(--danger)'; ac = 'var(--danger)'; }
        else if (currentLog === 'rig') { const st = i.الحالة || ''; if (matchStatus(st, 'paid')) { bc = 'var(--success)'; sb = `<span class="status-badge paid">${translate('statusPaid')}</span>`; } else if (matchStatus(st, 'partial')) { bc = 'var(--warning)'; sb = `<span class="status-badge partial">${translate('statusPartiallyPaidShort')}</span>`; } else if (matchStatus(st, 'late')) { bc = '#e67e22'; sb = `<span class="status-badge late">${translate('statusOverdue')}</span>`; } else { bc = 'var(--danger)'; sb = `<span class="status-badge unpaid">${translate('statusUnpaid')}</span>`; } av = parseAmount(i.المبلغ); ad = formatCurrency(av); ac = 'var(--success)'; }
        else { const st = i.الحالة || ''; const mt = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة']; if (mt.includes(i.النوع)) { bc = 'var(--p)'; sb = `<span style="font-size:0.8em;color:var(--p);">${translate('remaining')}: ${formatCurrency(parseAmount(i.المتبقي_للالتزام || 0))}</span>`; ac = 'var(--p)'; av = parseAmount(i.المبلغ_الكلي_للالتزام); ad = formatCurrency(av); } else { if (matchStatus(st, 'paid')) { bc = 'var(--success)'; sb = `<span class="status-badge paid">${translate('statusPaid')}</span>`; } else if (matchStatus(st, 'partial')) { bc = 'var(--warning)'; sb = `<span class="status-badge partial">${translate('statusPartiallyPaidShort')}</span>`; } else if (matchStatus(st, 'late')) { bc = '#e67e22'; sb = `<span class="status-badge late">${translate('statusOverdue')}</span>`; } else { bc = 'var(--danger)'; sb = `<span class="status-badge unpaid">${translate('statusUnpaid')}</span>`; } ac = bc; av = parseAmount(i.المبلغ); ad = formatCurrency(av); } }
        const img = i.صورة ? '<i class="fas fa-camera" style="margin-left:5px;color:var(--p);"></i>' : '';
        const ed = entity && entity !== '—' ? `<span style="font-size:0.85em;color:#888;">${entity}</span>` : '';
        const id = i.clientId || i.id || `temp-${Date.now()}`;
        return `<div class="list-item" style="border-right-color:${bc};" onclick="showDetailById('${id}','${currentLog}')"><div style="font-weight:bold;display:flex;justify-content:space-between;flex-wrap:wrap;"><span>${img}${desc} ${ed}</span><span style="color:${ac};">${ad}</span></div><div class="details"><span>${translateStoredValue(i.النوع || i.الفئة)} ${sb}</span><span>${date}</span></div><div class="log-item-hint"><i class="fas fa-hand-pointer"></i> ${translate('clickForDetails')}</div></div>`;
    }).join('');
}

function showDetailById(id, type) { openLayer('detail', { logType: type, id: id }); }

function editTransaction() {
    if (!editMode) return;
    const se = { type: editMode.type, index: editMode.index }; const type = se.type; const data = db[type][se.index];
    if (!data) return toastMsg(translate('notFound'), "error");
    const tabs = { inc: 'income', exp: 'expenses', rig: 'rights', deb: 'debts' };
    closeAllLayers(); editMode = se; openTab(tabs[type], true);
    setTimeout(() => {
        if (type === 'inc') { const a = document.getElementById('iAmount'), t = document.getElementById('iType'), d = document.getElementById('iDesc'), dt = document.getElementById('iDate'); if (a) a.value = parseAmount(data.المبلغ).toLocaleString('en-US'); if (t) t.value = data.الفئة; if (d) d.value = data.الوصف; if (dt) dt.value = data.التاريخ; }
        else if (type === 'exp') { const a = document.getElementById('eAmount'), t = document.getElementById('eType'), d = document.getElementById('eDesc'), dt = document.getElementById('eDate'); if (a) a.value = parseAmount(data.المبلغ).toLocaleString('en-US'); if (t) t.value = data.الفئة; if (d) d.value = data.الوصف; if (dt) dt.value = data.التاريخ; const im = document.getElementById('eImgName'); if (data.صورة) { if (im) im.textContent = '📎 ' + translate('imageAttached'); selectedImageFile = data.صورة; } else { selectedImageFile = null; if (im) im.textContent = ''; } }
        else if (type === 'rig') { const t = document.getElementById('rType'), e = document.getElementById('rEntity'), a = document.getElementById('rAmount'), d = document.getElementById('rDueDate'), ds = document.getElementById('rDesc'); if (t) t.value = data.النوع; if (e) e.value = data.الجهة || ''; if (a) a.value = parseAmount(data.المبلغ).toLocaleString('en-US'); if (d) d.value = data.تاريخ_الاستحقاق || ''; if (ds) ds.value = data.الوصف; updateRightFields(data.النوع, data); const p = document.getElementById('rPaidAmount'); if (p) p.value = parseAmount(data.المبلغ_المدفوع || 0).toLocaleString('en-US'); const rt = document.getElementById('rNotifTiming'); if (rt) rt.value = data.وقت_التنبيه || '168'; }
        else { const t = document.getElementById('dType'), d = document.getElementById('dDueDate'), ds = document.getElementById('dDesc'), e = document.getElementById('dEntity'); if (t) t.value = data.النوع; if (d) d.value = data.تاريخ_الاستحقاق || ''; if (ds) ds.value = data.الوصف; if (e) { if (data.الجهة && data.الجهة !== '—') { e.value = data.الجهة; e.style.display = 'block'; } else { e.value = ''; e.style.display = 'none'; } } updateDebtFields(data.النوع, data); const mt = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة']; if (!mt.includes(data.النوع)) { const a = document.getElementById('dAmount'), s = document.getElementById('dStatus'); if (a) a.value = parseAmount(data.المبلغ).toLocaleString('en-US'); if (s) { s.value = data.الحالة || ''; s.dispatchEvent(new Event('change')); if (data.الحالة === 'مدفوع جزئياً' && data.المبلغ_المدفوع_جزئياً) { const p = document.getElementById('dPartialPaidAmount'); if (p) p.value = parseAmount(data.المبلغ_المدفوع_جزئياً).toLocaleString('en-US'); } } } const dt = document.getElementById('dNotifTiming'); if (dt) dt.value = data.وقت_التنبيه || '168'; }
        const m = { inc: 'incEditIndicator', exp: 'expEditIndicator', rig: 'rigEditIndicator', deb: 'debEditIndicator' }; const i = document.getElementById(m[type]); if (i) i.style.display = 'inline-block';
    }, 100);
}

async function deleteTransaction() {
    if (!editMode) return;
    if (!confirm(translate('confirmDeleteTransaction'))) return;
    const type = editMode.type; const txn = db[type][editMode.index]; if (!txn) return;
    const id = txn.id || txn.clientId;
    try {
        await deleteFromDB(type, id);
        if (txn.clientId) { const idx = db.bal.changes.findIndex(c => c.id === txn.clientId); if (idx > -1) { const on = db.bal.changes[idx].القيمة_الصافية; db.bal.changes.splice(idx, 1); currentBalance -= on; db.bal.amount = currentBalance; await saveData('bal', db.bal); } }
        editMode = null; await loadAllData();
        toastMsg(translate('deletedSuccess'), "success");
        updateStats(); updateBalanceDisplay(); closeAllLayers(); openTab('overview'); scheduleAutoSync();
    } catch (e) { toastMsg(translate('deleteFailed'), "error"); }
}

// =============================================================
// 12.5 NOTIFICATIONS
// =============================================================
function getReadNotifications() { try { const l = JSON.parse(localStorage.getItem('readNotifications') || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function saveReadNotifications(l) { localStorage.setItem('readNotifications', JSON.stringify(l)); }
function cleanupExpiredReads() { const r = getReadNotifications(); const n = Date.now(); const f = r.filter(i => (n - i.readAt) < 86400000); if (f.length !== r.length) saveReadNotifications(f); return f; }
function getNotificationId(i) { return `${i.type}|${i.id}|${i.date}`; }
function getUpcomingItems() {
    const now = new Date(); const read = cleanupExpiredReads(); const ids = read.map(r => r.id); const items = [];
    (db.rig || []).forEach(r => { const rem = parseAmount(r.المتبقي || 0); if (rem <= 0 || !r.تاريخ_الاستحقاق) return; const due = new Date(r.تاريخ_الاستحقاق); if (isNaN(due)) return; const th = parseAmount(r.وقت_التنبيه) || 168; const nf = new Date(due.getTime() - th * 3600000); if (now >= nf) { const it = { type: 'right', id: r.clientId || r.id || '', name: r.النوع, entity: r.الجهة, amount: rem, date: r.تاريخ_الاستحقاق, overdue: due < now }; it.read = ids.includes(getNotificationId(it)); items.push(it); } });
    (db.deb || []).forEach(d => { const rem = d.المتبقي_للالتزام !== undefined ? parseAmount(d.المتبقي_للالتزام) : (matchStatus(d.الحالة, 'paid') ? 0 : parseAmount(d.المبلغ || 0)); if (rem <= 0 || !d.تاريخ_الاستحقاق) return; const due = new Date(d.تاريخ_الاستحقاق); if (isNaN(due)) return; const th = parseAmount(d.وقت_التنبيه) || 168; const nf = new Date(due.getTime() - th * 3600000); if (now >= nf) { const it = { type: 'debt', id: d.clientId || d.id || '', name: d.النوع, entity: d.الجهة, amount: rem, date: d.تاريخ_الاستحقاق, overdue: due < now }; it.read = ids.includes(getNotificationId(it)); items.push(it); } });
    return items.sort((a, b) => new Date(a.date) - new Date(b.date));
}
function getUnreadCount() { return getUpcomingItems().filter(i => !i.read).length; }
function updateNotificationBadge() { const b = document.getElementById('notifBadge'); if (!b) return; const c = getUnreadCount(); b.textContent = c > 99 ? '99+' : c; b.style.display = c > 0 ? 'flex' : 'none'; }
function openNotifications() { openLayer('notifications'); }
function viewNotification(id) { const it = getUpcomingItems().find(i => getNotificationId(i) === id); if (!it) return; if (!it.read) { const r = getReadNotifications(); if (!r.find(x => x.id === id)) { r.push({ id: id, readAt: Date.now() }); saveReadNotifications(r); } updateNotificationBadge(); } renderNotificationDetail(it); }
function renderNotificationDetail(it) {
    const el = document.getElementById('notificationsContent'); if (!el) return;
    let src = null; if (it.type === 'right') src = db.rig.find(r => (r.clientId || r.id) === it.id); else src = db.deb.find(d => (d.clientId || d.id) === it.id);
    const tl = it.type === 'right' ? translate('rightLabel') : translate('debtLabel');
    const tc = it.type === 'right' ? 'var(--success)' : 'var(--danger)';
    const ti = it.type === 'right' ? 'fa-hand-holding-usd' : 'fa-file-invoice-dollar';
    const ai = it.type === 'right' ? 'fa-arrow-down' : 'fa-arrow-up';
    const st = it.overdue ? translate('statusOverdue') : translate('upcomingItems');
    const sc = it.overdue ? 'var(--danger)' : 'var(--warning)';
    let h = `<button class="secondary" onclick="renderNotifications()" style="margin-bottom:15px;"><i class="fas fa-arrow-right"></i> ${translate('backToNotifications')}</button><div class="card" style="border-top-color:${tc};"><div style="text-align:center;margin-bottom:18px;"><span style="display:inline-block;background:${tc};color:#fff;padding:8px 24px;border-radius:24px;font-weight:800;">${tl}</span></div><h3 style="color:${tc};">${translateStoredValue(it.name)}</h3><div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap;"><span style="background:${sc};color:#fff;padding:4px 14px;border-radius:14px;font-size:0.85em;font-weight:700;">${st}</span><span style="background:${tc};color:#fff;padding:4px 14px;border-radius:14px;font-size:0.85em;font-weight:700;">${formatCurrency(it.amount)}</span></div>`;
    if (src) { h += `<div style="border-top:1px solid var(--border-color);padding-top:12px;">`; for (const [k, v] of Object.entries(src)) { if (['id', 'clientId', 'صورة', 'المبلغ_المضاف_للرصيد', 'المبلغ_المخصوم_للرصيد'].includes(k)) continue; if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '' && k !== 'الوصف')) continue; h += `<p style="margin:8px 0;display:flex;justify-content:space-between;"><strong>${translateFieldLabel(k)}:</strong><span>${formatFieldValue(k, v)}</span></p>`; } h += `</div>`; }
    h += `</div>`; el.innerHTML = h;
}
function renderNotifications() {
    const el = document.getElementById('notificationsContent'); if (!el) return;
    const items = getUpcomingItems();
    if (!items.length) { el.innerHTML = `<div class="notif-empty-state"><i class="fas fa-bell-slash"></i><p>${translate('noNotifications')}</p><small>${translate('noNotificationsHint')}</small></div>`; return; }
    const unread = items.filter(i => !i.read); const read = items.filter(i => i.read);
    let h = `<div class="notif-summary"><div class="notif-sum-card overdue-card"><span class="sum-label">${translate('unreadNotifications')}</span><span class="sum-value">${unread.length}</span></div><div class="notif-sum-card upcoming-card"><span class="sum-label">${translate('readNotifications')}</span><span class="sum-value">${read.length}</span></div></div>`;
    const ri = (i) => {
        const nid = getNotificationId(i);
        const cls = i.read ? 'notif-item read' : (i.overdue ? 'notif-item overdue' : 'notif-item upcoming');
        const icon = i.type === 'right' ? 'fa-hand-holding-usd' : 'fa-file-invoice-dollar';
        const tl = i.type === 'right' ? translate('rightLabel') : translate('debtLabel');
        const tc = i.type === 'right' ? 'var(--success)' : 'var(--danger)';
        const ai = i.type === 'right' ? 'fa-arrow-down' : 'fa-arrow-up';
        const tag = i.overdue ? translate('statusOverdue') : translate('upcomingItems');
        const rb = i.read ? `<span class="notif-tag read-tag"><i class="fas fa-check"></i> ${translate('readNotification')}</span>` : `<span class="notif-tag">${tag}</span>`;
        const en = (i.entity && i.entity !== '—') ? `<span class="notif-entity"><i class="fas fa-user"></i> ${i.entity}</span>` : '';
        const ca = i.read ? '' : `onclick="viewNotification('${nid}')"`;
        return `<div class="${cls}" ${ca}><div class="notif-head"><span class="notif-name"><i class="fas ${icon}"></i> ${translateStoredValue(i.name)}</span>${rb}</div><span class="notif-type-badge" style="background:${tc};"><i class="fas ${ai}"></i> ${tl}</span><div class="notif-body"><span class="notif-amount">${formatCurrency(i.amount)}</span><span class="notif-date"><i class="far fa-clock"></i> ${formatDateTime(i.date)}</span></div>${en}${i.read ? '' : `<div class="notif-read-hint"><i class="fas fa-hand-pointer"></i> ${translate('clickToRead')}</div>`}</div>`;
    };
    if (unread.length) { h += `<div class="notif-group-title unread-title"><i class="fas fa-bell"></i> ${translate('unreadNotifications')} <span class="count-pill">${unread.length}</span></div>` + unread.map(ri).join(''); }
    if (read.length) { h += `<div class="notif-group-title read-title"><i class="fas fa-check-circle"></i> ${translate('readNotifications')} <span class="count-pill">${read.length}</span></div>` + read.map(ri).join(''); }
    el.innerHTML = h;
}

// =============================================================
// 13. UPDATE STATS
// =============================================================
const ADVISOR = {
    ar: { good: 'وضعك المالي جيد: مصروفاتك أقل من دخلك.', over: 'تنبيه: مصروفاتك أعلى من دخلك؛ راجع قسم المصروفات.', noIncome: 'لا يوجد دخل مسجل مع وجود مصروفات؛ أضف دخلك من قسم الدخل.', noData: 'لا توجد عمليات في هذه الفترة بعد؛ ابدأ بتسجيل دخل أو مصروف.', tipR: 'لديك حقوق غير محصلة بقيمة', tipD: 'لديك التزامات غير مدفوعة بقيمة' },
    en: { good: 'Your status is good: expenses are less than income.', over: 'Alert: expenses exceed income; review Expenses.', noIncome: 'No income recorded but you have expenses; add income.', noData: 'No transactions in this period yet; start by adding income or expense.', tipR: 'You have uncollected rights of', tipD: 'You have unpaid obligations of' },
    ur: { good: 'آپ کی صورتحال اچھی ہے: اخراجات آمدنی سے کم ہیں۔', over: 'انتباہ: اخراجات آمدنی سے زیادہ ہیں۔', noIncome: 'آمدنی درج نہیں مگر اخراجات ہیں۔', noData: 'اس مدت میں ابھی کوئی عمل نہیں۔', tipR: 'وصولی کے بقایا حقوق ہیں بذریعہ', tipD: 'غیر ادا شدہ ذمہ داریاں ہیں بذریعہ' }
};

function updateStats() {
    const sum = (l, f) => l.reduce((a, i) => a + parseAmount(i[f] || 0), 0);
    const p = statsPeriodFilter;
    const incList = db.inc.filter(i => inStatsPeriod(i.التاريخ, p));
    const expList = db.exp.filter(i => inStatsPeriod(i.التاريخ, p));
    const rigList = db.rig.filter(i => inStatsPeriod(i.تاريخ_الاستحقاق || i.التاريخ, p));
    const debList = db.deb.filter(i => inStatsPeriod(i.تاريخ_الاستحقاق || i.التاريخ, p));
    const incTotal = sum(incList, 'المبلغ'); const expTotal = sum(expList, 'المبلغ');
    const rigTotal = sum(rigList, 'المبلغ'); const rigPaid = sum(rigList, 'المبلغ_المضاف_للرصيد');
    const debTotal = debList.reduce((a, i) => a + (i.المبلغ_الكلي_للالتزام ? parseAmount(i.المبلغ_الكلي_للالتزام) : parseAmount(i.المبلغ || 0)), 0);
    const debPaid = sum(debList, 'المبلغ_المخصوم_للرصيد');
    const net = incTotal - expTotal;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.innerHTML = v; };
    const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const setBar = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = v + '%'; };
    const pct = (a, b) => (b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0);
    const cur = (currentLang === 'ur') ? 'ur' : (currentLang === 'en') ? 'en' : 'ar';
    const A = ADVISOR[cur]; const money = x => `${getFormattedAmount(x)} ${currentCurrency.symbol}`;
    if (document.getElementById('sIncTotal')) {
        set('sIncTotal', formatCurrency(incTotal, true));
        const ib = document.getElementById('sIncBar'); if (ib && ib.parentElement) ib.parentElement.style.display = 'none';
        const ip = document.getElementById('sIncPct'); if (ip) ip.style.display = 'none';
        const isub = document.getElementById('sIncSub'); if (isub) isub.style.display = 'none';
        set('sExpTotal', formatCurrency(expTotal, true)); setBar('sExpBar', pct(expTotal, incTotal)); setText('sExpPct', pct(expTotal, incTotal) + '%');
        const esub = document.getElementById('sExpSub'); if (esub) esub.style.display = 'none';
        set('sDebPaid', formatCurrency(debPaid, true)); setBar('sDebBar', pct(debPaid, debTotal)); setText('sDebPct', pct(debPaid, debTotal) + '%'); set('sDebSub', `${translate('totalDebts')}: <strong>${money(debTotal)}</strong>`);
        set('sRigPaid', formatCurrency(rigPaid, true)); setBar('sRigBar', pct(rigPaid, rigTotal)); setText('sRigPct', pct(rigPaid, rigTotal) + '%'); set('sRigSub', `${translate('totalRights')}: <strong>${money(rigTotal)}</strong>`);
        let aKey, aType;
        if (incTotal === 0 && expTotal === 0) { aKey = 'noData'; aType = 'good'; }
        else if (incTotal === 0) { aKey = 'noIncome'; aType = 'bad'; }
        else if (net < 0) { aKey = 'over'; aType = 'bad'; }
        else { aKey = 'good'; aType = 'good'; }
        let msg = A[aKey];
        const ru = rigTotal - rigPaid, du = debTotal - debPaid;
        if (ru > 0) msg += ' • ' + A.tipR + ' ' + money(ru);
        if (du > 0) msg += ' • ' + A.tipD + ' ' + money(du);
        const b = document.getElementById('sStatusBanner'); const s = document.getElementById('sStatusIcon');
        if (b) b.className = 'stat-status ' + (aType === 'good' ? 'good' : 'bad');
        if (s) s.className = 'fas ' + (aType === 'good' ? 'fa-check-circle' : 'fa-exclamation-circle');
        setText('sStatusTitle', aType === 'good' ? translate('goodTitle') : translate('badTitle'));
        setText('sStatusMsg', msg);
    }
}
function inStatsPeriod(ds, p) { if (p === 'all' || !ds) return true; const d = new Date(ds); if (isNaN(d)) return true; const n = new Date(); if (p === 'today') return d.toDateString() === n.toDateString(); if (p === 'week') { const r = getWeekRange(); return d >= r.start && d <= r.end; } if (p === 'month') return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); if (p === 'year') return d.getFullYear() === n.getFullYear(); return true; }
function getWeekRange() { const n = new Date(); const dw = n.getDay(); const s = new Date(n); s.setDate(n.getDate() - dw); s.setHours(0, 0, 0, 0); const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999); return { start: s, end: e }; }
function setStatsPeriod(p) { statsPeriodFilter = p; localStorage.setItem('statsPeriodFilter', p); updateStats(); }

// =============================================================
// 14. OTHER
// =============================================================
function renderCurrencyList() {
    const l = document.getElementById('currencyList'); if (!l) return;
    const q = (document.getElementById('currencySearch')?.value || '').toLowerCase();
    const f = ARABIC_CURRENCIES.filter(c => getCurrencyName(c).toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || (c.name.ar || '').includes(q) || (c.name.en || '').toLowerCase().includes(q) || (c.name.ur || '').includes(q));
    l.innerHTML = f.map(c => `<button class="secondary" style="margin:5px 0;display:flex;justify-content:space-between;align-items:center;border:1px solid ${c.code === currentCurrency.code ? 'var(--p)' : 'var(--border-color)'};" onclick="setCurrency('${c.code}')"><span>${c.flag} <strong>${c.symbol}</strong> ${getCurrencyName(c)} (${c.code})</span>${c.code === currentCurrency.code ? '<i class="fas fa-check" style="color:var(--success);"></i>' : ''}</button>`).join('');
}
function setCurrency(code) { const s = ARABIC_CURRENCIES.find(c => c.code === code); if (s) { currentCurrency = s; localStorage.setItem('currencyCode', code); const l = document.getElementById('sidebarCurrencyLabel'); if (l) l.textContent = s.symbol; updateBalanceDisplay(); updateStats(); closeLayer('currency'); toastMsg(`${translate('currencySet')} ${getCurrencyName(s)} 💱`, "success"); } }
function confirmResetData() { closeLayer('sidebar'); if (confirm(translate('confirmReset'))) resetAllData(); }
function resetAllData() {
    if (!IDB_connection) return toastMsg(translate('dbError'), "error");
    const tx = IDB_connection.transaction(STORE_NAMES, 'readwrite'); let done = 0;
    STORE_NAMES.forEach(sn => { const r = tx.objectStore(sn).clear(); r.onsuccess = () => { done++; if (done === STORE_NAMES.length) { db.exp = db.rig = db.deb = db.inc = []; db.bal = { clientId: 1, amount: 0, changes: [] }; saveData('bal', db.bal).then(() => loadAllData().then(() => { updateStats(); updateBalanceDisplay(); toastMsg(translate('dataReset'), "success"); scheduleAutoSync(); })); } }; r.onerror = () => toastMsg(translate('resetFailed'), "error"); });
}

// =============================================================
// 15. SIDEBAR
// =============================================================
function openSidebar() {
    if (!isDriveConnected && localStorage.getItem('drive_token') && parseInt(localStorage.getItem('drive_token_expiry')) > Date.now()) {
        accessToken = localStorage.getItem('drive_token'); userEmail = localStorage.getItem('drive_email') || ''; isDriveConnected = true;
    }
    updateDriveUI(); updateAutoSyncUI(); openLayer('sidebar');
}
function openCurrencyModal() { openLayer('currency'); }
function openAboutModal() { openLayer('about'); }
function openBalanceActionModal(t) { openLayer('balanceAction', { actionType: t }); }
function openBalanceLogModal() { openLayer('balanceLog'); }
function openLog(t) { currentLog = t; openLayer('log', { logType: t }); }
function showImageSourceModal() { openLayer('imageSource'); }
function closeImageSource() { closeLayer('imageSource'); }
function openCameraInput() { closeImageSource(); const i = document.getElementById('eImgCamera'); if (!i) return; i.value = null; i.setAttribute('capture', 'environment'); i.click(); }
function openGalleryInput() { closeImageSource(); const i = document.getElementById('eImgGallery'); if (!i) return; i.value = null; i.removeAttribute('capture'); i.click(); }
function handleImageSelect(input) { if (input.files && input.files.length > 0) { const f = input.files[0]; selectedImageFile = f; const n = document.getElementById('eImgName'); if (n) n.textContent = `✅ ${f.name}`; const r = new FileReader(); r.onload = e => { selectedImageFile = e.target.result; }; r.readAsDataURL(f); } else { const n = document.getElementById('eImgName'); if (n) n.textContent = ''; selectedImageFile = null; } }
function getSelectedImage() { return selectedImageFile; }
function clearSelectedImage() { selectedImageFile = null; const n = document.getElementById('eImgName'); if (n) n.textContent = ''; const c = document.getElementById('eImgCamera'); if (c) c.value = null; const g = document.getElementById('eImgGallery'); if (g) g.value = null; }

// =============================================================
// 16. INDEXED DB
// =============================================================
function initDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) { toastMsg(translate('indexedDBUnsupported'), "error"); return reject(new Error("IndexedDB not supported.")); }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onerror = e => { reject(e.target.error); };
        req.onupgradeneeded = e => {
            IDB_connection = e.target.result;
            STORE_NAMES.forEach(sn => { if (IDB_connection.objectStoreNames.contains(sn)) IDB_connection.deleteObjectStore(sn); const kp = (sn === 'bal') ? 'clientId' : 'id'; const st = IDB_connection.createObjectStore(sn, { keyPath: kp, autoIncrement: (sn !== 'bal') }); if (sn === 'bal') st.add({ clientId: 1, amount: 0, changes: [] }); });
        };
        req.onsuccess = e => { IDB_connection = e.target.result; resolve(IDB_connection); loadAllData().then(() => { updateStats(); updateBalanceDisplay(); }); };
    });
}
initDB();
function saveData(sn, d) { return new Promise((res, rej) => { if (!IDB_connection) return rej(new Error("DB not connected.")); const tx = IDB_connection.transaction([sn], "readwrite"); const r = tx.objectStore(sn).put(d); r.onsuccess = () => res(r.result); r.onerror = e => rej(e.target.error); }); }
function deleteFromDB(sn, id) { return new Promise((res, rej) => { if (!IDB_connection) return rej(new Error("DB not connected.")); const tx = IDB_connection.transaction([sn], "readwrite"); const r = tx.objectStore(sn).delete(id); r.onsuccess = () => res(); r.onerror = e => rej(e.target.error); }); }
function loadStoreData(sn) { return new Promise(res => { if (!IDB_connection) return res(sn === 'bal' ? { clientId: 1, amount: 0, changes: [] } : []); const tx = IDB_connection.transaction([sn], "readonly"); const r = tx.objectStore(sn).getAll(); r.onsuccess = e => { if (sn === 'bal') { return res(e.target.result[0] || { clientId: 1, amount: 0, changes: [] }); } res(e.target.result.reverse()); }; r.onerror = () => res(sn === 'bal' ? { clientId: 1, amount: 0, changes: [] } : []); }); }
async function loadAllData() { const [e, r, d, b, i] = await Promise.all([loadStoreData('exp'), loadStoreData('rig'), loadStoreData('deb'), loadStoreData('bal'), loadStoreData('inc')]); db.exp = e; db.rig = r; db.deb = d; db.bal = b; db.inc = i; currentBalance = parseAmount(db.bal.amount || 0); updateNotificationBadge(); }

// =============================================================
// 17. DARK MODE
// =============================================================
function loadDarkModePreference() { if (localStorage.getItem('darkMode') === 'true') { document.body.classList.add('dark-mode'); const t = document.getElementById('darkModeToggle'); if (t) t.checked = true; } }
function toggleDarkMode() { const d = document.body.classList.toggle('dark-mode'); localStorage.setItem('darkMode', d); toastMsg(d ? translate('darkModeOn') : translate('darkModeOff'), "info"); }
loadDarkModePreference();

// =============================================================
// 18. INIT
// =============================================================
window.onload = () => {
    if (!history.state || history.state.layer === undefined) { history.replaceState({ layer: 'main' }, null, '#main'); historyStack.push({ layer: 'main' }); }
    else historyStack.push(history.state);
    loadTranslations().then(() => applyTranslations(currentLang));
    const now = getLocalDateString();
    ['eDate', 'rDueDate', 'dDueDate', 'iDate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = now; });
    const sp = document.getElementById('statsPeriod'); if (sp) sp.value = statsPeriodFilter;
    const cl = document.getElementById('sidebarCurrencyLabel'); if (cl) cl.textContent = currentCurrency.symbol;
    const at = document.getElementById('autoSyncToggle'); if (at) at.checked = autoSyncEnabled;
    updateBalanceDisplay(); updateStats(); updateDriveUI(); updateAutoSyncUI(); updateNotificationBadge();
    setTimeout(() => { initGapi(); initGis(); restoreDriveState(); }, 1000);
};
console.log('ميزانيتك الذكية جاهزة ✅');
