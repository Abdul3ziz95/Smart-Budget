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

// ============ إعدادات المزامنة التلقائية ============
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
    'confirmBackup': { elementId: 'confirmBackupModal', type: 'modal' },
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
        } else if (layerName === 'currency') {
            const searchEl = document.getElementById('currencySearch');
            if (searchEl) searchEl.value = '';
            renderCurrencyList();
        } else if (layerName === 'balanceLog') {
            buildBalanceFilters();
            renderBalanceLog();
        } else if (layerName === 'driveBackup') {
            renderDriveBackupList();
            if (accessToken && appFolderId) { loadBackupList(); }
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
            cleanupExpiredReads();
            renderNotifications();
        } else if (layerName === 'syncConflict') {
            if (data.conflict) {
                pendingConflictData = data.conflict;
                showConflictDialog(data.conflict);
            }
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
        if (layerName === 'syncConflict') {
            const choiceView = document.getElementById('conflictChoiceView');
            const detailsView = document.getElementById('conflictDetailsView');
            if (choiceView) choiceView.style.display = 'block';
            if (detailsView) detailsView.style.display = 'none';
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
    if (!alreadyTop) {
        const state = { layer: layerName, data: data };
        historyStack.push(state);
        history.pushState(state, null, `#${layerName}`);
    }
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

const PLACEHOLDER_I18N = {
    'iAmount': 'amountPlaceholder', 'eAmount': 'amountPlaceholder', 'bAmount': 'amountPlaceholder',
    'iDesc': 'notesOptional', 'eDesc': 'descriptionNotes', 'rDesc': 'additionalNotes', 'dDesc': 'additionalNotes',
    'rAmount': 'totalDueAmount', 'rEntity': 'entityDebtor', 'dAmount': 'billAmount', 'dEntity': 'entityCreditor',
    'search': 'searchLog', 'balanceSearch': 'searchLog', 'currencySearch': 'searchCurrency', 'exportFileName': 'fileName'
};

const OPTION_I18N = {
    'راتب': 'incomeSalary', 'عمل حر': 'incomeFreelance', 'تجارة': 'incomeBusiness', 'استثمار': 'incomeInvestment', 'عمولة': 'incomeCommission', 'هدية': 'incomeGift', 'مكافأة': 'incomeBonus', 'الضمان الاجتماعي': 'incomeSocialSecurity', 'المعاش التقاعدي': 'incomePension', 'دخل آخر': 'incomeOther',
    'طعام': 'expenseFood', 'مواصلات': 'expenseTransport', 'وقود': 'expenseFuel', 'مقاهي': 'expenseCafe', 'رعاية شخصية': 'expensePersonalCare', 'أجهزة إلكترونية': 'expenseElectronics', 'صحة': 'expenseHealth', 'ترفيه': 'expenseEntertainment', 'تسوق': 'expenseShopping', 'تعليم': 'expenseEducation', 'صيانة وإصلاح': 'expenseMaintenance', 'أخرى': 'expenseOther',
    'بيع آجل': 'rightCreditSale', 'سلفة': 'rightLoan', 'إيجار مستحق': 'rightRentDue', 'شراكة': 'rightPartnership', 'حق آخر': 'rightOther',
    '🏠 إيجار': 'debtRent', '💡 كهرباء': 'debtElectricity', '💧 ماء': 'debtWater', '💡 فواتير الخدمات': 'debtUtilities', '📱 الاتصالات والإنترنت': 'debtInternet', '🏦 قروض وتمويل': 'debtLoans', '👤 دين شخصي': 'debtPersonal', '🛒 مشتريات بالتقسيط': 'debtInstallments', '🎓 رسوم تعليمية': 'debtTuition', '🏥 مصاريف طبية مستحقة': 'debtMedical', '🚗 تمويل السيارة': 'debtCarFinance', '👨‍👩 التزامات عائلية': 'debtFamily', '📅 اشتراكات دورية': 'debtSubscriptions', '👨‍💼 رواتب': 'debtSalaries', '📦 أخرى': 'debtOther',
    'مدفوع': 'statusPaid', 'مدفوع جزئياً': 'statusPartiallyPaid', 'غير مدفوع': 'statusUnpaid', 'متأخر': 'statusOverdue',
    '📂 فئة الدخل': 'incomeCategoryPlaceholder', '🛒 الفئة (نفقات متغيرة)': 'expenseCategoryPlaceholder', '🤝 نوع الحق': 'rightTypePlaceholder', '🧾 نوع الالتزام': 'debtTypePlaceholder', '✅ الحالة': 'statusPlaceholder', '⏱️ التنبيه قبل الاستحقاق (اختياري)': 'notifTimingPlaceholder',
    '⏱️ قبل ساعة': 'notif1Hour', '⏱️ قبل 24 ساعة': 'notif24Hours', '⏱️ قبل 7 أيام': 'notif7Days',
    '⏱️ 1 Hour before': 'notif1Hour', '⏱️ 24 Hours before': 'notif24Hours', '⏱️ 7 Days before': 'notif7Days',
    '⏱️ 1 گھنٹہ پہلے': 'notif1Hour', '⏱️ 24 گھنٹے پہلے': 'notif24Hours', '⏱️ 7 دن پہلے': 'notif7Days'
};

function translateStoredValue(val) {
    if (!val || typeof val !== 'string') return val || '';
    const key = OPTION_I18N[val.trim()];
    return key ? translate(key) : val;
}

const FIELD_LABELS = {
    'النوع': { ar: 'النوع', en: 'Type', ur: 'قسم' },
    'الفئة': { ar: 'الفئة', en: 'Category', ur: 'زمرہ' },
    'المبلغ': { ar: 'المبلغ', en: 'Amount', ur: 'رقم' },
    'الجهة': { ar: 'الجهة', en: 'Entity', ur: 'فریق' },
    'تاريخ_الاستحقاق': { ar: 'تاريخ الاستحقاق', en: 'Due Date', ur: 'تاریخِ ادائیگی' },
    'التاريخ': { ar: 'التاريخ', en: 'Date', ur: 'تاریخ' },
    'الوصف': { ar: 'الوصف', en: 'Description', ur: 'تفصیل' },
    'المبلغ_المدفوع': { ar: 'المبلغ المدفوع', en: 'Paid Amount', ur: 'ادا شدہ رقم' },
    'المبلغ_المدفوع_جزئياً': { ar: 'المدفوع جزئياً', en: 'Partially Paid Amount', ur: 'جزوی ادا شدہ رقم' },
    'وقت_التنبيه': { ar: 'وقت التنبيه', en: 'Notification Timing', ur: 'اطلاع کا وقت' },
    'المتبقي': { ar: 'المتبقي', en: 'Remaining', ur: 'باقی' },
    'الحالة': { ar: 'الحالة', en: 'Status', ur: 'حیثیت' },
    'المبلغ_الكلي_للالتزام': { ar: 'المبلغ الكلي', en: 'Total Amount', ur: 'کل رقم' },
    'إجمالي_المدفوع': { ar: 'إجمالي المدفوع', en: 'Total Paid', ur: 'کل ادا شدہ' },
    'المتبقي_للالتزام': { ar: 'المتبقي', en: 'Remaining', ur: 'باقی رقم' },
    'عدد_الاقساط': { ar: 'عدد الأقساط', en: 'Total Installments', ur: 'اقساط کی تعداد' },
    'قيمة_القسط': { ar: 'قيمة القسط', en: 'Installment Value', ur: 'قسط کی مالیت' },
    'الأقساط_المدفوعة': { ar: 'الأقساط المدفوعة', en: 'Paid Installments', ur: 'ادا شدہ اقساط' }
};

function translateFieldLabel(key) {
    const entry = FIELD_LABELS[key];
    if (!entry) return key.replace(/_/g, ' ');
    return entry[currentLang] || entry.ar;
}

function translateStatusValue(val) {
    if (!val || typeof val !== 'string') return val;
    if (/مدفوع بالكامل|Fully Paid/.test(val)) return translate('statusFullyPaid');
    if (/مدفوع جزئياً|Partially Paid/.test(val)) return translate('statusPartiallyPaid');
    if (/غير مدفوع|Unpaid/.test(val)) return translate('statusUnpaid');
    if (/متأخر|Overdue/.test(val)) return translate('statusOverdue');
    if (/^مدفوع$|^Paid$/.test(val)) return translate('statusPaid');
    return translateStoredValue(val);
}

function translateTimingValue(val) {
    const s = String(val);
    if (s === '1') return translate('notif1Hour');
    if (s === '24') return translate('notif24Hours');
    if (s === '168') return translate('notif7Days');
    return s;
}

function formatFieldValue(key, val) {
    if (key === 'الحالة') return translateStatusValue(val);
    if (key === 'وقت_التنبيه') return translateTimingValue(val);
    if ((key === 'تاريخ_الاستحقاق' || key === 'التاريخ') && /^\d{4}-\d{2}-\d{2}$/.test(String(val))) return formatDateTime(val);
    const isAmt = key.includes('المبلغ') || key.includes('المدفوع') || key.includes('المتبقي') || key.includes('القسط') || key.includes('إجمالي');
    return isAmt ? formatCurrency(val, true) : translateStoredValue(val);
}

function translateAllOptions() {
    document.querySelectorAll('select option').forEach(op => {
        const key = op.getAttribute('data-i18n') || op.dataset.i18nKey || OPTION_I18N[op.value] || OPTION_I18N[op.textContent.trim()] || '';
        if (key) {
            op.dataset.i18nKey = key;
            const t = translate(key);
            if (t && t !== key) op.textContent = t;
        }
    });
}

function translatePlaceholders() {
    for (const [id, key] of Object.entries(PLACEHOLDER_I18N)) {
        const el = document.getElementById(id);
        if (el) el.placeholder = translate(key);
    }
}

function applyTranslations(lang) {
    if (!translations[lang]) { lang = 'ar'; }
    const t = translations[lang] || {};
    currentLang = lang;
    const html = document.documentElement;
    if (lang === 'ar' || lang === 'ur') { html.dir = 'rtl'; html.lang = lang; } else { html.dir = 'ltr'; html.lang = 'en'; }
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key] !== undefined) el.textContent = t[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (t[key] !== undefined) el.placeholder = t[key];
    });
    translatePlaceholders();
    translateAllOptions();
    const langLabel = document.getElementById('sidebarLanguageLabel');
    if (langLabel) {
        const langNames = { ar: '🇸🇦 العربية', en: '🇬🇧 English', ur: '🇵🇰 اردو' };
        langLabel.textContent = langNames[lang] || '🇸🇦 العربية';
    }
    updateBalanceDisplay();
    updateStats();
    updateAutoSyncUI();
    const logModal = document.getElementById('logModal');
    if (logModal && logModal.style.display === 'flex') { buildLogFilters(); renderLog(); }
    const balanceLogModal = document.getElementById('balanceLogModal');
    if (balanceLogModal && balanceLogModal.style.display === 'flex') { buildBalanceFilters(); renderBalanceLog(); }
    const driveBackupModal = document.getElementById('driveBackupModal');
    if (driveBackupModal && driveBackupModal.style.display === 'flex') renderDriveBackupList();
    const currencyModal = document.getElementById('currencyModal');
    if (currencyModal && currencyModal.style.display === 'flex') renderCurrencyList();
    const notificationsModal = document.getElementById('notificationsModal');
    if (notificationsModal && notificationsModal.style.display === 'flex') renderNotifications();
    const detailModal = document.getElementById('detailModal');
    if (detailModal && detailModal.style.display === 'flex' && editMode) {
        const arr = db[editMode.type];
        const o = arr && arr[editMode.index];
        if (o) _renderDetailContent(o, editMode.type);
    }
    const rDyn = document.getElementById('rDynamicFields');
    if (rDyn && rDyn.innerHTML.trim() !== '') {
        const rType = document.getElementById('rType');
        const rCur = (editMode && editMode.type === 'rig') ? db.rig[editMode.index] : null;
        updateRightFields(rType ? rType.value : '', rCur);
    }
    const dDyn = document.getElementById('dDynamicFields');
    if (dDyn && dDyn.innerHTML.trim() !== '') {
        const dType = document.getElementById('dType');
        const dCur = (editMode && editMode.type === 'deb') ? db.deb[editMode.index] : null;
        updateDebtFields(dType ? dType.value : '', dCur);
    }
    const bam = document.getElementById('balanceActionModal');
    if (bam && bam.style.display === 'flex' && balanceActionType) {
        const tEl = document.getElementById('actionModalTitle');
        if (tEl) tEl.textContent = balanceActionType === 'deposit' ? translate('depositTitle') : translate('withdrawTitle');
    }
    const countEl = document.getElementById('driveBackupCount');
    if (countEl) countEl.textContent = translate('backupCountLabel') + ' ' + (backupFiles ? backupFiles.length : 0);
    updateLanguageModalCheckmarks();
    localStorage.setItem('appLang', lang);
}

function translate(key) {
    if (!translations[currentLang] || translations[currentLang][key] === undefined) {
        return translations['ar']?.[key] || key;
    }
    return translations[currentLang][key];
}

function setLanguage(lang) {
    if (lang === currentLang) { closeLayer('language'); return; }
    applyTranslations(lang);
    closeLayer('language');
    toastMsg(translate('languageChanged') || 'Language changed', 'success');
}

function openLanguageModal() { openLayer('language'); }

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
    if (tokenRefreshInterval) { clearInterval(tokenRefreshInterval); }
    tokenRefreshInterval = setInterval(async () => {
        if (isDriveConnected && accessToken) {
            try { if (tokenClient) { tokenClient.requestAccessToken({ prompt: '' }); } } catch (e) { console.log('Token refresh failed, will retry later'); }
        }
    }, 50 * 60 * 1000);
}

function stopTokenRefresh() {
    if (tokenRefreshInterval) { clearInterval(tokenRefreshInterval); tokenRefreshInterval = null; }
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
            updateAutoSyncUI();
            startTokenRefresh();
            setTimeout(() => {
                if (accessToken) {
                    loadBackupList();
                    verifyTokenValidity();
                    checkAndHandleSync();
                }
            }, 1000);
        } else {
            console.log('Token expired, attempting to refresh...');
            if (tokenClient) { tokenClient.requestAccessToken({ prompt: '' }); }
            else { setTimeout(() => { if (tokenClient) { tokenClient.requestAccessToken({ prompt: '' }); } }, 2000); }
        }
    } else {
        updateAutoSyncUI();
    }
}

async function verifyTokenValidity() {
    if (!accessToken) return;
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + accessToken);
        if (!response.ok) {
            console.log('Token invalid, attempting to refresh...');
            if (tokenClient) { tokenClient.requestAccessToken({ prompt: '' }); }
        }
    } catch (error) { console.log('Token verification failed:', error); }
}

function initGapi() {
    if (gapiInitAttempts >= MAX_INIT_ATTEMPTS) { console.warn('GAPI init max attempts reached'); return; }
    gapiInitAttempts++;
    if (typeof gapi === 'undefined') { console.warn('gapi not loaded yet, retrying...'); setTimeout(initGapi, 500); return; }
    try {
        gapi.load('client', async () => {
            try {
                await gapi.client.init({ discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'] });
                console.log('Google API loaded');
                restoreDriveState();
            } catch (error) { console.error('Error loading GAPI client:', error); }
        });
    } catch (error) { console.error('Error in GAPI init:', error); setTimeout(initGapi, 500); }
}

function initGis() {
    if (gisInitAttempts >= MAX_INIT_ATTEMPTS) { console.warn('GIS init max attempts reached'); return; }
    gisInitAttempts++;
    if (typeof google === 'undefined' || !google.accounts) { console.warn('GIS not loaded yet, retrying...'); setTimeout(initGis, 500); return; }
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: async (resp) => {
                if (resp.error) {
                    console.error('Auth error:', resp.error);
                    if (resp.error === 'access_denied' || resp.error === 'invalid_token') {
                        toastMsg(translate('sessionExpired'), "info");
                        setTimeout(() => { if (tokenClient) { tokenClient.requestAccessToken({ prompt: '' }); } }, 2000);
                    } else { toastMsg(translate('loginFailed') + ': ' + resp.error, "error"); }
                    return;
                }
                accessToken = resp.access_token;
                localStorage.setItem('drive_token', accessToken);
                localStorage.setItem('drive_token_expiry', Date.now() + 3600 * 1000);
                try {
                    const userInfo = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', { headers: { 'Authorization': `Bearer ${accessToken}` } });
                    const userData = await userInfo.json();
                    userEmail = userData.email || '';
                    localStorage.setItem('drive_email', userEmail);
                    await createAppFolder();
                    isDriveConnected = true;
                    updateDriveUI();
                    updateAutoSyncUI();
                    toastMsg(translate('driveConnected'), "success");
                    startTokenRefresh();
                    await loadBackupList();
                    const cbm = document.getElementById('confirmBackupModal');
                    if (cbm && cbm.style.display === 'flex') { closeLayer('confirmBackup'); }
                    openLayer('driveBackup');
                    checkAndHandleSync();
                } catch (e) {
                    console.error('Error getting user info:', e);
                    userEmail = '';
                    toastMsg(translate('loginError'), "error");
                }
            },
        });
        console.log('GIS loaded');
    } catch (error) { console.error('Error initializing GIS:', error); setTimeout(initGis, 500); }
}

async function createAppFolder() {
    if (!accessToken) return;
    try {
        const searchResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const result = await searchResponse.json();
        if (result.files && result.files.length > 0) {
            appFolderId = result.files[0].id;
            localStorage.setItem('drive_folder_id', appFolderId);
            return;
        }
        const metadata = { name: APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' };
        const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata)
        });
        if (!createResponse.ok) throw new Error(`Failed to create folder: ${createResponse.status}`);
        const folderData = await createResponse.json();
        appFolderId = folderData.id;
        localStorage.setItem('drive_folder_id', appFolderId);
        toastMsg(translate('folderCreated'), "success");
    } catch (error) { console.error('Error creating folder:', error); toastMsg(translate('folderCreateFailed'), "error"); }
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
            updateAutoSyncUI();
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
            updateAutoSyncUI();
            startTokenRefresh();
            closeLayer('confirmBackup');
            performBackup();
            return;
        } else if (expiry > now && isDriveConnected) { closeLayer('confirmBackup'); performBackup(); return; }
    }
    if (!tokenClient) { toastMsg(translate('loadingAuth'), "info"); return; }
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
                updateAutoSyncUI();
                startTokenRefresh();
            }
            openLayer('driveBackup');
            return;
        }
    }
    if (!tokenClient) { toastMsg(translate('loadingAuth'), "info"); return; }
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleDriveBackup() {
    if (!isDriveConnected) { toastMsg(translate('driveNotConnected'), "error"); return; }
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
    updateAutoSyncUI();
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
    if (modalStatus) {
        if (isDriveConnected) { modalStatus.className = 'status connected'; modalStatus.textContent = translate('driveConnectedStatus'); }
        else { modalStatus.className = 'status disconnected'; modalStatus.textContent = translate('driveDisconnectedStatus'); }
    }
}

async function loadBackupList() {
    if (!accessToken || !appFolderId) { backupFiles = []; renderDriveBackupList(); return; }
    try {
        const searchResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q='${appFolderId}' in parents and trashed=false and (mimeType='application/json' or name contains '.json')&fields=files(id,name,size,createdTime)&orderBy=createdTime desc`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const result = await searchResponse.json();
        backupFiles = result.files || [];
        renderDriveBackupList();
    } catch (error) { console.error('Error loading backup list:', error); toastMsg(translate('backupListLoadFailed'), "error"); }
}

function parseBackupNumber(name) {
    const m = (name || '').match(/^(\d+)/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return isNaN(n) ? null : n;
}

function getNextBackupNumber() {
    let max = 0;
    (backupFiles || []).forEach(f => { const n = parseBackupNumber(f.name); if (n && n > max) max = n; });
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
    const locale = (currentLang === 'ur') ? 'ur-PK' : (currentLang || 'ar');
    const sortedByDate = [...backupFiles].sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
    let fallback = 1;
    const filesWithNumbers = sortedByDate.map(file => { const parsed = parseBackupNumber(file.name); return { ...file, number: parsed || fallback++ }; });
    const displayFiles = filesWithNumbers.sort((a, b) => a.number - b.number);
    let tableHtml = `<table class="backup-table"><thead><tr><th>${translate('backupName')}</th><th>${translate('backupDate')}</th><th>${translate('backupSize')}</th><th style="text-align:left;">${translate('actions')}</th></tr></thead><tbody>`;
    displayFiles.forEach((file) => {
        const date = new Date(file.createdTime);
        const formattedDate = date.toLocaleString(locale, { numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const size = file.size ? (parseInt(file.size) / 1024).toFixed(1) + 'KB' : translate('unknown');
        const name = `${translate('backupCopy')} ${file.number}`;
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
    if (!accessToken || !appFolderId) { toastMsg(translate('driveNotConnected'), "error"); return; }
    showLoading(translate('savingBackup'));
    try {
        const data = { exp: db.exp, rig: db.rig, deb: db.deb, bal: db.bal, inc: db.inc, currency: currentCurrency, backupDate: new Date().toISOString() };
        const nextNumber = getNextBackupNumber();
        const numStr = String(nextNumber).padStart(3, '0');
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const fileName = `${numStr}_${translate('backupFileNamePrefix')}_${dateTime}.json`;
        const jsonData = JSON.stringify(data, null, 2);
        const fileData = new Blob([jsonData], { type: 'application/json' });
        const metadata = { name: fileName, parents: [appFolderId], mimeType: 'application/json' };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', fileData);
        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }, body: form });
        if (!response.ok) { const errorText = await response.text(); throw new Error(`Upload failed: ${response.status} - ${errorText}`); }
        hideLoading();
        toastMsg(translate('backupSaved'), "success");
        await loadBackupList();
        renderDriveBackupList();
        const dbm = document.getElementById('driveBackupModal');
        if (dbm && dbm.style.display !== 'flex') { openLayer('driveBackup'); }
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
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!response.ok) throw new Error(`Failed to download file: ${response.status}`);
        const text = await response.text();
        const imported = JSON.parse(text);
        await clearAllStores();
        if (imported.bal && Array.isArray(imported.bal.changes)) { imported.bal.clientId = 1; await bulkAddToStore('bal', [imported.bal]); }
        for (const sn of ['exp', 'rig', 'deb', 'inc']) { if (imported[sn] && Array.isArray(imported[sn])) await bulkAddToStore(sn, imported[sn]); }
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
        scheduleAutoSync();
    } catch (error) {
        hideLoading();
        console.error('Error restoring backup:', error);
        toastMsg(translate('restoreFailed') + ': ' + error.message, "error");
    }
}

async function deleteBackup(fileId) {
    if (!confirm(translate('confirmDeleteBackup'))) return;
    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
        toastMsg(translate('backupDeleted'), "success");
        await loadBackupList();
        renderDriveBackupList();
    } catch (error) { console.error('Error deleting backup:', error); toastMsg(translate('deleteFailed') + ': ' + error.message, "error"); }
}

// =============================================================
// 5. SYNC SYSTEM — نظام المزامنة التلقائية
// =============================================================

function getTotalRecordCount() {
    return (db.exp?.length || 0) + (db.rig?.length || 0) + (db.deb?.length || 0) + (db.inc?.length || 0);
}

function updateAutoSyncUI() {
    const toggle = document.getElementById('autoSyncToggle');
    const statusEl = document.getElementById('autoSyncStatus');
    const syncNowBtn = document.getElementById('syncNowBtn');
    if (toggle) toggle.checked = autoSyncEnabled;
    if (statusEl) {
        if (!isDriveConnected) {
            statusEl.textContent = translate('autoSyncReadyNotConnected');
            statusEl.className = 'auto-sync-status';
        } else if (syncInProgress) {
            statusEl.textContent = translate('syncingNow');
            statusEl.className = 'auto-sync-status syncing';
        } else if (lastSyncTimestamp) {
            const lastDate = new Date(parseInt(lastSyncTimestamp));
            const locale = (currentLang === 'ur') ? 'ur-PK' : (currentLang || 'ar');
            const formatted = lastDate.toLocaleString(locale, { numberingSystem: 'latn', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            statusEl.textContent = `${translate('lastSyncLabel')}: ${formatted}`;
            statusEl.className = 'auto-sync-status success';
        } else {
            statusEl.textContent = translate('lastSyncNever');
            statusEl.className = 'auto-sync-status';
        }
    }
    if (syncNowBtn) syncNowBtn.disabled = syncInProgress || !isDriveConnected;
}

function toggleAutoSync(checked) {
    autoSyncEnabled = checked;
    localStorage.setItem('autoSyncEnabled', checked ? 'true' : 'false');
    updateAutoSyncUI();
    if (checked && isDriveConnected) {
        scheduleAutoSync();
    }
}

function manualSyncNow() {
    if (!isDriveConnected) {
        toastMsg(translate('driveNotConnected'), "error");
        return;
    }
    performSync();
}

function scheduleAutoSync() {
    if (!autoSyncEnabled || !isDriveConnected || syncInProgress) return;
    setTimeout(() => { performSync(); }, 3000);
}

async function performSync() {
    if (!accessToken || !appFolderId || syncInProgress) return;
    syncInProgress = true;
    updateAutoSyncUI();
    try {
        const syncFileId = await findSyncFile();
        const currentRecordCount = getTotalRecordCount();
        const currentBalanceStr = String(currentBalance);
        const syncData = {
            meta: {
                lastModified: new Date().toISOString(),
                deviceId: deviceId,
                recordCount: currentRecordCount,
                balance: currentBalanceStr,
                schemaVersion: 1
            },
            data: {
                exp: db.exp,
                rig: db.rig,
                deb: db.deb,
                bal: db.bal,
                inc: db.inc,
                currency: currentCurrency
            }
        };
        const jsonData = JSON.stringify(syncData, null, 2);
        const fileData = new Blob([jsonData], { type: 'application/json' });
        if (syncFileId) {
            await updateSyncFile(syncFileId, fileData);
        } else {
            await createSyncFile(fileData);
        }
        lastSyncTimestamp = Date.now().toString();
        lastSyncRecordCount = currentRecordCount;
        lastSyncBalance = currentBalanceStr;
        localStorage.setItem('lastSyncTimestamp', lastSyncTimestamp);
        localStorage.setItem('lastSyncRecordCount', String(lastSyncRecordCount));
        localStorage.setItem('lastSyncBalance', lastSyncBalance);
        syncInProgress = false;
        updateAutoSyncUI();
        toastMsg(translate('syncSuccess'), "success");
    } catch (error) {
        syncInProgress = false;
        updateAutoSyncUI();
        console.error('Sync error:', error);
        toastMsg(translate('syncFailed'), "error");
    }
}

async function findSyncFile() {
    try {
        const searchResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q='${appFolderId}' in parents and name='${SYNC_FILE_NAME}.json' and trashed=false&fields=files(id,name)`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const result = await searchResponse.json();
        if (result.files && result.files.length > 0) {
            return result.files[0].id;
        }
        return null;
    } catch (error) {
        console.error('Error finding sync file:', error);
        return null;
    }
}

async function createSyncFile(fileData) {
    const metadata = { name: `${SYNC_FILE_NAME}.json`, parents: [appFolderId], mimeType: 'application/json' };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileData);
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }, body: form });
    if (!response.ok) throw new Error(`Create sync file failed: ${response.status}`);
    return response.json();
}

async function updateSyncFile(fileId, fileData) {
    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: fileData
    });
    if (!response.ok) throw new Error(`Update sync file failed: ${response.status}`);
    return response.json();
}

async function checkAndHandleSync() {
    if (!accessToken || !appFolderId || !autoSyncEnabled) return;
    try {
        const syncFileId = await findSyncFile();
        if (!syncFileId) {
            if (getTotalRecordCount() > 0) {
                await performSync();
            }
            return;
        }
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${syncFileId}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!response.ok) return;
        const text = await response.text();
        const remoteSync = JSON.parse(text);
        const remoteMeta = remoteSync.meta || {};
        const remoteTimestamp = remoteMeta.lastModified ? new Date(remoteMeta.lastModified).getTime() : 0;
        const localTimestamp = lastSyncTimestamp ? parseInt(lastSyncTimestamp) : 0;
        const currentRecordCount = getTotalRecordCount();
        const currentBalanceStr = String(currentBalance);
        const hasLocalChanges = (currentRecordCount !== lastSyncRecordCount) || (currentBalanceStr !== lastSyncBalance);
        const hasRemoteChanges = remoteTimestamp > localTimestamp;
        if (hasRemoteChanges && hasLocalChanges) {
            const conflictData = {
                syncFileId: syncFileId,
                remoteData: remoteSync.data,
                remoteMeta: remoteMeta,
                localRecordCount: currentRecordCount,
                remoteRecordCount: remoteMeta.recordCount || 0
            };
            pendingConflictData = conflictData;
            openLayer('syncConflict', { conflict: conflictData });
        } else if (hasRemoteChanges && !hasLocalChanges) {
            await applyRemoteData(remoteSync.data);
            lastSyncTimestamp = remoteTimestamp.toString();
            lastSyncRecordCount = remoteMeta.recordCount || getTotalRecordCount();
            lastSyncBalance = remoteMeta.balance || String(currentBalance);
            localStorage.setItem('lastSyncTimestamp', lastSyncTimestamp);
            localStorage.setItem('lastSyncRecordCount', String(lastSyncRecordCount));
            localStorage.setItem('lastSyncBalance', lastSyncBalance);
            updateAutoSyncUI();
            toastMsg(translate('syncUpdated'), "success");
        } else if (!hasRemoteChanges && hasLocalChanges) {
            await performSync();
        }
    } catch (error) {
        console.error('Error checking sync:', error);
    }
}

async function applyRemoteData(remoteData) {
    if (!remoteData) return;
    await clearAllStores();
    if (remoteData.bal && remoteData.bal.changes) {
        remoteData.bal.clientId = 1;
        await bulkAddToStore('bal', [remoteData.bal]);
    }
    for (const sn of ['exp', 'rig', 'deb', 'inc']) {
        if (remoteData[sn] && Array.isArray(remoteData[sn])) {
            await bulkAddToStore(sn, remoteData[sn]);
        }
    }
    if (remoteData.currency) {
        currentCurrency = remoteData.currency;
        localStorage.setItem('currencyCode', currentCurrency.code);
        const label = document.getElementById('sidebarCurrencyLabel');
        if (label) label.textContent = currentCurrency.symbol;
    }
    await loadAllData();
    updateStats();
    updateBalanceDisplay();
}

function showConflictDialog(conflictData) {
    const choiceView = document.getElementById('conflictChoiceView');
    const detailsView = document.getElementById('conflictDetailsView');
    if (choiceView) choiceView.style.display = 'block';
    if (detailsView) detailsView.style.display = 'none';
}

function dismissConflict() {
    pendingConflictData = null;
    closeLayer('syncConflict');
    toastMsg(translate('conflictPendingReminder'), "info");
}

async function resolveConflict(choice) {
    if (!pendingConflictData) return;
    showLoading(translate('processing'));
    try {
        if (choice === 'local') {
            await performSync();
        } else if (choice === 'remote') {
            await applyRemoteData(pendingConflictData.remoteData);
            const remoteMeta = pendingConflictData.remoteMeta;
            lastSyncTimestamp = remoteMeta.lastModified ? new Date(remoteMeta.lastModified).getTime().toString() : Date.now().toString();
            lastSyncRecordCount = remoteMeta.recordCount || getTotalRecordCount();
            lastSyncBalance = remoteMeta.balance || String(currentBalance);
            localStorage.setItem('lastSyncTimestamp', lastSyncTimestamp);
            localStorage.setItem('lastSyncRecordCount', String(lastSyncRecordCount));
            localStorage.setItem('lastSyncBalance', lastSyncBalance);
            updateAutoSyncUI();
        }
        pendingConflictData = null;
        hideLoading();
        closeLayer('syncConflict');
        toastMsg(translate('dataRestored'), "success");
    } catch (error) {
        hideLoading();
        console.error('Error resolving conflict:', error);
        toastMsg(translate('syncFailed'), "error");
    }
}

function showConflictDetails() {
    const choiceView = document.getElementById('conflictChoiceView');
    const detailsView = document.getElementById('conflictDetailsView');
    const localCountEl = document.getElementById('localRecordCount');
    const remoteCountEl = document.getElementById('remoteRecordCount');
    const remoteLastModEl = document.getElementById('remoteLastModified');
    const remoteEditedByEl = document.getElementById('remoteEditedBy');
    if (choiceView) choiceView.style.display = 'none';
    if (detailsView) detailsView.style.display = 'block';
    if (pendingConflictData) {
        const remoteMeta = pendingConflictData.remoteMeta || {};
        if (localCountEl) localCountEl.textContent = pendingConflictData.localRecordCount || 0;
        if (remoteCountEl) remoteCountEl.textContent = pendingConflictData.remoteRecordCount || 0;
        if (remoteLastModEl && remoteMeta.lastModified) {
            const lastDate = new Date(remoteMeta.lastModified);
            const locale = (currentLang === 'ur') ? 'ur-PK' : (currentLang || 'ar');
            remoteLastModEl.textContent = lastDate.toLocaleString(locale, { numberingSystem: 'latn', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        }
        if (remoteEditedByEl) {
            if (remoteMeta.deviceId && remoteMeta.deviceId !== deviceId) {
                remoteEditedByEl.textContent = translate('conflictAnotherDevice');
            } else {
                remoteEditedByEl.textContent = translate('conflictThisPhone');
            }
        }
    }
}

function backToConflictChoice() {
    const choiceView = document.getElementById('conflictChoiceView');
    const detailsView = document.getElementById('conflictDetailsView');
    if (choiceView) choiceView.style.display = 'block';
    if (detailsView) detailsView.style.display = 'none';
}

// =============================================================
// 6. EXPORT / IMPORT
// =============================================================
function openExportNameModal() { openLayer('exportName'); }

function performExport() {
    const fileNameEl = document.getElementById('exportFileName');
    const fileName = fileNameEl ? fileNameEl.value.trim() : '';
    if (!fileName) { toastMsg(translate('enterFileName'), "error"); return; }
    closeLayer('exportName');
    if (!IDB_connection) return toastMsg(translate('dbError'), "error");
    const data = { exp: db.exp, rig: db.rig, deb: db.deb, bal: db.bal, inc: db.inc, currency: currentCurrency };
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
    if (!confirm(translate('confirmImport'))) { event.target.value = null; return; }
    showLoading(translate('importingData'));
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            await clearAllStores();
            if (imported.bal && Array.isArray(imported.bal.changes)) { imported.bal.clientId = 1; await bulkAddToStore('bal', [imported.bal]); }
            for (const sn of ['exp', 'rig', 'deb', 'inc']) { if (imported[sn] && Array.isArray(imported[sn])) await bulkAddToStore(sn, imported[sn]); }
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
            scheduleAutoSync();
        } catch (err) {
            hideLoading();
            toastMsg(translate('importFailed'), "error");
            console.error(err);
        } finally { event.target.value = null; }
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

function clearAllStores() {
    return new Promise((resolve, reject) => {
        if (!IDB_connection) return resolve();
        const tx = IDB_connection.transaction(STORE_NAMES, 'readwrite');
        let completed = 0;
        let hasError = false;
        STORE_NAMES.forEach(sn => {
            const req = tx.objectStore(sn).clear();
            req.onsuccess = () => {
                completed++;
                if (completed === STORE_NAMES.length && !hasError) resolve();
            };
            req.onerror = () => {
                if (!hasError) { hasError = true; reject(req.error); }
            };
        });
    });
}

function bulkAddToStore(storeName, dataArray) {
    return new Promise((resolve, reject) => {
        if (!IDB_connection) return resolve();
        if (!dataArray || dataArray.length === 0) return resolve();
        const tx = IDB_connection.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        dataArray.forEach(item => {
            if (storeName === 'bal') {
                store.put(item);
            } else {
                const toSave = { ...item };
                delete toSave.id;
                store.add(toSave);
            }
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

// =============================================================
// 7. LOADING OVERLAY
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
// 8. TOAST NOTIFICATION
// =============================================================
function toastMsg(message, type = "info") {
    const t = document.getElementById('toast');
    if (!t) return;
    t.className = 'toast ' + type;
    const iconMap = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    t.innerHTML = `<span class="toast-icon ${type}"><i class="fas ${iconMap[type] || 'fa-info-circle'}"></i></span> ${message}`;
    t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); }, 3500);
}

// =============================================================
// 9. FORMATTING HELPERS + CURRENCIES
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
let currentCurrency = ARABIC_CURRENCIES.find(c => c.code === (localStorage.getItem('currencyCode') || 'SAR')) || ARABIC_CURRENCIES[0];

function getCurrencyName(c) {
    const lang = (c.name && c.name[currentLang]) ? currentLang : 'ar';
    return (c.name && c.name[lang]) || c.code;
}

function formatAmount(input) {
    if (!input) return;
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
    if (str.charAt(0) === '-') { negative = true; str = str.substring(1); }
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
    const locale = (currentLang === 'ur') ? 'ur-PK' : (currentLang || 'ar');
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        const [y, m, d] = dateString.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        if (isNaN(date)) return translate('invalidDate');
        return date.toLocaleDateString(locale, { numberingSystem: 'latn', year: 'numeric', month: 'short', day: 'numeric' });
    }
    const d = new Date(dateString);
    if (isNaN(d)) return translate('invalidDate');
    return d.toLocaleString(locale, { numberingSystem: 'latn', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function clearFields() {
    ['iAmount', 'iDesc', 'iType', 'iDate',
        'eAmount', 'eDesc', 'eType', 'eDate',
        'rAmount', 'rDesc', 'rType', 'rEntity', 'rDueDate', 'rNotifTiming',
        'dType', 'dAmount', 'dDesc', 'dStatus', 'dEntity', 'dDueDate', 'dNotifTiming'
    ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    clearSelectedImage();
    const rDyn = document.getElementById('rDynamicFields');
    if (rDyn) rDyn.innerHTML = '';
    const dDyn = document.getElementById('dDynamicFields');
    if (dDyn) dDyn.innerHTML = '';
    const dPartial = document.getElementById('dPartialPaidContainer');
    if (dPartial) dPartial.remove();
    document.querySelectorAll('.edit-indicator').forEach(el => el.style.display = 'none');
    const dEntity = document.getElementById('dEntity');
    if (dEntity) dEntity.style.display = 'none';
}

// =============================================================
// 10. TAB NAVIGATION
// =============================================================
function openTab(id, keepEdit = false) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(id);
    if (section) section.classList.add('active');
    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === id) btn.classList.add('active');
    });
    if (!keepEdit) { editMode = null; clearFields(); }
    if (id === 'overview') updateStats();
    if (editMode) {
        const indicatorMap = { inc: 'incEditIndicator', exp: 'expEditIndicator', rig: 'rigEditIndicator', deb: 'debEditIndicator' };
        const ind = document.getElementById(indicatorMap[editMode.type]);
        if (ind) ind.style.display = 'inline-block';
    }
}

function openTabFromNav(tabId) {
    const elem = document.getElementById(tabId);
    if (!elem || elem.classList.contains('active')) return;
    closeAllLayers();
    openTab(tabId);
}

// =============================================================
// 11. BALANCE
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
    const blm = document.getElementById('balanceLogModal');
    if (blm && blm.style.display === 'flex') renderBalanceLog();
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
    const amtEl = document.getElementById('bAmount');
    const descEl = document.getElementById('bDesc');
    const amt = amtEl ? amtEl.value : '';
    const desc = (descEl && descEl.value) ? descEl.value : (balanceActionType === 'deposit' ? translate('generalDeposit') : translate('generalWithdraw'));
    if (!amt) return toastMsg(translate('enterAmount'), "error");
    const ok = await processBalanceChange(amt, balanceActionType, desc, `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    if (ok) {
        toastMsg(balanceActionType === 'deposit' ? translate('depositSuccess') : translate('withdrawSuccess'), "success");
        closeLayer('balanceAction');
        scheduleAutoSync();
    }
}

function renderBalanceLog() {
    const el = document.getElementById('balanceLogContent');
    if (!el) return;
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
    if (bar) bar.innerHTML = `<div class="log-stat-chip"><span class="stat-label">${translate('movementsCount')}</span><span class="stat-value">${list.length}</span></div> <div class="log-stat-chip"><span class="stat-label">${translate('totalDeposits')}</span><span class="stat-value" style="color:var(--success)">${getFormattedAmount(dep)}</span></div> <div class="log-stat-chip"><span class="stat-label">${translate('totalWithdrawals')}</span><span class="stat-value" style="color:var(--danger)">${getFormattedAmount(wit)}</span></div>`;
    if (!list.length) {
        el.innerHTML = `<p style="text-align:center;color:#999;padding:30px 0;"><i class="fas fa-inbox" style="font-size:2em;display:block;margin-bottom:10px;"></i>${translate('noBalanceLog')}</p>`;
        return;
    }
    el.innerHTML = list.map(i => {
        const isDep = i.القيمة_الصافية > 0;
        const color = isDep ? 'var(--success)' : (i.القيمة_الصافية < 0 ? 'var(--danger)' : '#999');
        const icon = isDep ? 'fa-arrow-up' : (i.القيمة_الصافية < 0 ? 'fa-arrow-down' : 'fa-minus');
        const displayAmount = (i.القيمة_الصافية < 0 ? '-' : '') + formatCurrency(Math.abs(i.المبلغ));
        return `<div class="list-item" style="border-right-color:${color};"> <div style="font-weight:bold;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;"> <span><i class="fas ${icon}" style="margin-left:8px;color:${color};"></i> ${i.النوع}</span> <span style="color:${color};">${displayAmount}</span> </div> <div class="details"> <span>${translate('balanceAfter')}: ${formatBalance(i.الرصيد_بعد_العملية)}</span> <span><i class="far fa-clock" style="margin-left:4px;"></i> ${formatDateTime(i.التاريخ)}</span> </div> </div>`;
    }).join('');
}

// =============================================================
// 12. CRUD — INCOME, EXPENSES, RIGHTS, DEBTS
// =============================================================
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
    data.الوصف = (iDesc && iDesc.value) ? iDesc.value : '—';
    data.التاريخ = iDate.value;
    data.clientId = isEditing ? oldData.clientId : `inc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    try {
        await saveData('inc', data);
        await processBalanceChange(amount, 'income', `${translate('incomeLogPrefix')}: ${translateStoredValue(data.الفئة)} (${data.الوصف})`, data.clientId, isEditing, oldAmount);
        toastMsg(isEditing ? translate('incomeEdited') : translate('incomeSaved'), "success");
        postSaveCleanup(isEditing, 'inc');
    } catch (err) { toastMsg(translate('saveFailed'), "error"); console.error(err); }
}

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
    data.الوصف = (eDesc && eDesc.value) ? eDesc.value : '—';
    data.التاريخ = eDate.value;
    data.clientId = isEditing ? oldData.clientId : `exp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const img = getSelectedImage();
    if (img && typeof img === 'string' && img.startsWith('data:image')) { data.صورة = img; }
    else if (!isEditing) { delete data.صورة; }
    else { if (oldData.صورة) data.صورة = oldData.صورة; else delete data.صورة; }
    try {
        await saveData('exp', data);
        await processBalanceChange(amount, 'expense', `${translate('expenseLogPrefix')}: ${translateStoredValue(data.الفئة)} (${data.الوصف})`, data.clientId, isEditing, oldAmount);
        toastMsg(isEditing ? translate('expenseEdited') : translate('expenseSaved'), "success");
        postSaveCleanup(isEditing, 'exp');
    } catch (err) { toastMsg(translate('saveFailed'), "error"); console.error(err); }
}

function updateRightFields(type, currentData = null) {
    const container = document.getElementById('rDynamicFields');
    if (!container) return;
    container.innerHTML = `<input id="rPaidAmount" type="text" placeholder="💰 ${translate('collectedAmount')}" oninput="formatAmount(this)" inputmode="decimal" pattern="[0-9]*" value="${currentData && currentData.المبلغ_المدفوع ? parseAmount(currentData.المبلغ_المدفوع).toLocaleString('en-US') : ''}" /> <span class="field-hint">${translate('collectedAmountHint')}</span>`;
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
    if (paid > total) { toastMsg(translate('paidExceedsTotal'), "error"); return; }
    const data = isEditing ? { ...oldData } : {};
    data.clientId = isEditing ? oldData.clientId : `rig-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    data.النوع = rType.value;
    data.المبلغ = getFormattedAmount(total);
    data.الجهة = (rEntity && rEntity.value) ? rEntity.value : '—';
    data.تاريخ_الاستحقاق = rDueDate.value;
    data.الوصف = (rDesc && rDesc.value) ? rDesc.value : '—';
    data.المبلغ_المدفوع = getFormattedAmount(paid);
    const rNotifTiming = document.getElementById('rNotifTiming');
    data.وقت_التنبيه = rNotifTiming ? (rNotifTiming.value || '168') : '168';
    const remaining = total - paid;
    data.المتبقي = getFormattedAmount(remaining);
    let status;
    if (remaining <= 0) status = translate('statusFullyPaid');
    else if (paid > 0) status = translate('statusPartiallyPaid');
    else status = translate('statusUnpaid');
    data.الحالة = status;
    data.المبلغ_المضاف_للرصيد = paid;
    const oldPaid = isEditing ? parseAmount(oldData.المبلغ_المضاف_للرصيد || 0) : 0;
    try {
        await saveData('rig', data);
        await processBalanceChange(paid, 'right_collection', `${translate('rightLogPrefix')}: ${translateStoredValue(data.النوع)} (${data.الجهة})`, data.clientId, isEditing, oldPaid);
        toastMsg(isEditing ? translate('rightEdited') : translate('rightSaved'), "success");
        postSaveCleanup(isEditing, 'rig');
    } catch (err) { toastMsg(translate('saveFailed'), "error"); console.error(err); }
}

function updateDebtFields(type, currentData = null) {
    const container = document.getElementById('dDynamicFields');
    if (!container) return;
    container.innerHTML = '';
    const amountInput = document.getElementById('dAmount');
    const statusSelect = document.getElementById('dStatus');
    const entityInput = document.getElementById('dEntity');
    const entityTypes = ['🏠 إيجار', '👤 دين شخصي', '📱 الاتصالات والإنترنت', '🎓 رسوم تعليمية', '🏥 مصاريف طبية مستحقة', '🚗 تمويل السيارة', '👨‍👩 التزامات عائلية', '📅 اشتراكات دورية', '👨‍💼 رواتب', '💡 كهرباء', '💧 ماء'];
    if (entityTypes.includes(type)) {
        if (entityInput) {
            entityInput.style.display = 'block';
            if (currentData && currentData.الجهة) entityInput.value = currentData.الجهة;
        }
    } else {
        if (entityInput) { entityInput.style.display = 'none'; entityInput.value = ''; }
    }
    const masterTypes = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة'];
    if (masterTypes.includes(type)) {
        if (amountInput) { amountInput.style.display = 'none'; amountInput.value = ''; }
        if (statusSelect) { statusSelect.style.display = 'none'; statusSelect.value = ''; }
        let html = `<input id="dTotalAmount" type="text" placeholder="💵 ${translate('totalAmount')}" oninput="formatAmount(this)" inputmode="decimal" pattern="[0-9]*" value="${currentData && currentData.المبلغ_الكلي_للالتزام ? parseAmount(currentData.المبلغ_الكلي_للالتزام).toLocaleString('en-US') : ''}" /> <span class="field-hint">${translate('totalAmountHint')}</span>`;
        if (type === '🏦 قروض وتمويل' || type === '🛒 مشتريات بالتقسيط' || type === '🚗 تمويل السيارة') {
            html += `<input id="dInstallments" type="number" placeholder="${translate('totalInstallments')}" value="${currentData && currentData.عدد_الاقساط ? currentData.عدد_الاقساط : ''}" /> <input id="dPaidInstallments" type="number" placeholder="${translate('paidInstallments')}" value="${currentData && currentData.الأقساط_المدفوعة ? currentData.الأقساط_المدفوعة : ''}" />`;
        } else {
            html += `<input id="dPaidAmount" type="text" placeholder="💰 ${translate('totalPaidSoFar')}" oninput="formatAmount(this)" inputmode="decimal" pattern="[0-9]*" value="${currentData && currentData.إجمالي_المدفوع ? parseAmount(currentData.إجمالي_المدفوع).toLocaleString('en-US') : ''}" />`;
        }
        container.innerHTML = html;
    } else {
        if (amountInput) {
            amountInput.style.display = 'block';
            if (currentData) amountInput.value = parseAmount(currentData.المبلغ || 0).toLocaleString('en-US');
        }
        if (statusSelect) {
            statusSelect.style.display = 'block';
            if (currentData) statusSelect.value = currentData.الحالة || '';
        }
    }
    if (!masterTypes.includes(type) && statusSelect) {
        statusSelect.onchange = function () {
            const status = statusSelect.value;
            const partialPaidContainer = document.getElementById('dPartialPaidContainer');
            if (status === 'مدفوع جزئياً') {
                if (!partialPaidContainer) {
                    const paidInput = document.createElement('div');
                    paidInput.id = 'dPartialPaidContainer';
                    paidInput.innerHTML = `<input id="dPartialPaidAmount" type="text" placeholder="💰 ${translate('partialPaidAmount')}" oninput="formatAmount(this)" inputmode="decimal" pattern="[0-9]*" /> <span class="field-hint">${translate('partialPaidHint')}</span>`;
                    statusSelect.parentNode.insertBefore(paidInput, statusSelect.nextSibling);
                }
            } else { if (partialPaidContainer) partialPaidContainer.remove(); }
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
    data.الوصف = (dDesc && dDesc.value) ? dDesc.value : '—';
    if (dEntity && dEntity.style.display !== 'none' && dEntity.value) data.الجهة = dEntity.value;
    else data.الجهة = '—';
    const dNotifTiming = document.getElementById('dNotifTiming');
    data.وقت_التنبيه = dNotifTiming ? (dNotifTiming.value || '168') : '168';
    let paidAmount = 0;
    const oldPaid = isEditing ? parseAmount(oldData.المبلغ_المخصوم_للرصيد || 0) : 0;
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
        } else if (dStatus.value === 'مدفوع' || dStatus.value === 'مدفوع بالكامل') { paidAmount = amt; }
        else { paidAmount = 0; }
        delete data.المبلغ_الكلي_للالتزام;
        delete data.إجمالي_المدفوع;
        delete data.المتبقي_للالتزام;
        delete data.عدد_الاقساط;
        delete data.قيمة_القسط;
        delete data.الأقساط_المدفوعة;
        if (dStatus.value !== 'مدفوع جزئياً') { delete data.المبلغ_المدفوع_جزئياً; }
    }
    data.المبلغ_المخصوم_للرصيد = paidAmount;
    const oldNetChange = isEditing ? -oldPaid : 0;
    try {
        await saveData('deb', data);
        await processBalanceChange(paidAmount, 'debt_payment', `${translate('debtLogPrefix')}: ${translateStoredValue(data.النوع)} (${data.الجهة})`, data.clientId, isEditing, oldNetChange);
        toastMsg(isEditing ? translate('debtEdited') : translate('debtSaved'), "success");
        postSaveCleanup(isEditing, 'deb');
    } catch (err) { toastMsg(translate('saveFailed'), "error"); console.error(err); }
}

function postSaveCleanup(isEditing, type) {
    closeAllLayers();
    loadAllData().then(() => { updateStats(); updateBalanceDisplay(); });
    editMode = null;
    clearFields();
    scheduleAutoSync();
}

// =============================================================
// 13. DETAIL & LOG RENDERING + FILTERS
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
        if (src) catOptions = Array.from(src.options).filter(o => o.value).map(o => `<option value="${o.value}">${o.textContent}</option>`).join('');
        catSel.style.display = 'block';
    } else if (currentLog === 'rig' || currentLog === 'deb') {
        const src = document.getElementById(currentLog === 'rig' ? 'rType' : 'dType');
        if (src) catOptions = Array.from(src.options).filter(o => o.value).map(o => `<option value="${o.value}">${o.textContent}</option>`).join('');
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
    bar.innerHTML = `<div class="log-stat-chip"><span class="stat-label">${translate('operationsCount')}</span><span class="stat-value">${list.length}</span></div> <div class="log-stat-chip"><span class="stat-label">${translate('totalAmountStat')}</span><span class="stat-value">${getFormattedAmount(total)}</span></div> <div class="log-stat-chip"><span class="stat-label">${titles[currentLog] || ''}</span><span class="stat-value">${translateStoredValue(topName)} (${getFormattedAmount(topVal)})</span></div>`;
}

function _renderDetailContent(o, type) {
    const el = document.getElementById('detailContent');
    if (!el) return;
    let html = `<div class="card" style="border-top-color:var(--p);"><h3 style="color:var(--p);margin-top:0;"><i class="fas fa-info-circle" style="margin-left:5px;"></i> ${translate('details')}</h3>`;
    for (const [key, val] of Object.entries(o)) {
        if (['id', 'clientId', 'صورة', 'المبلغ_المضاف_للرصيد', 'المبلغ_المخصوم_للرصيد'].includes(key)) continue;
        if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '' && key !== 'الوصف')) continue;
        html += `<p style="margin:6px 0;"><strong>${translateFieldLabel(key)}:</strong> <span>${formatFieldValue(key, val)}</span></p>`;
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
    if (!el) return;
    const items = db[currentLog] || [];
    const searchEl = document.getElementById('search');
    const search = searchEl ? searchEl.value.toLowerCase() : '';
    const field = (currentLog === 'inc' || currentLog === 'exp') ? 'الفئة' : 'النوع';
    let filtered = items.filter(i => Object.values(i).some(v => String(v).toLowerCase().includes(search)));
    if (logFilters.cat !== 'all') filtered = filtered.filter(i => i[field] === logFilters.cat);
    if ((currentLog === 'rig' || currentLog === 'deb') && logFilters.status !== 'all') filtered = filtered.filter(i => matchStatus(i.الحالة, logFilters.status));
    if (logFilters.period !== 'all') filtered = filtered.filter(i => inPeriod(i.التاريخ || i.تاريخ_الاستحقاق, logFilters.period));
    renderLogStats(filtered, field);
    if (!filtered.length) {
        el.innerHTML = `<p style="text-align:center;color:#999;padding:30px 0;"><i class="fas fa-inbox" style="font-size:2em;display:block;margin-bottom:10px;"></i>${translate('noTransactions')}</p>`;
        return;
    }
    el.innerHTML = filtered.map(i => {
        const isInc = currentLog === 'inc';
        const isExp = currentLog === 'exp';
        const isRig = currentLog === 'rig';
        const isDeb = currentLog === 'deb';
        let amountVal = 0, amountDisplay = '', borderColor = 'var(--s)', statusBadge = '', amountColor = 'var(--text-dark)';
        let desc = i.الوصف || translateStoredValue(i.الفئة) || translateStoredValue(i.النوع) || '—';
        let date = formatDateTime(i.التاريخ || i.تاريخ_الاستحقاق);
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
            if (matchStatus(st, 'paid')) { borderColor = 'var(--success)'; statusBadge = `<span class="status-badge paid">${translate('statusPaid')}</span>`; }
            else if (matchStatus(st, 'partial')) { borderColor = 'var(--warning)'; statusBadge = `<span class="status-badge partial">${translate('statusPartiallyPaidShort')}</span>`; }
            else if (matchStatus(st, 'late')) { borderColor = '#e67e22'; statusBadge = `<span class="status-badge late">${translate('statusOverdue')}</span>`; }
            else { borderColor = 'var(--danger)'; statusBadge = `<span class="status-badge unpaid">${translate('statusUnpaid')}</span>`; }
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
                if (matchStatus(st, 'paid')) { borderColor = 'var(--success)'; statusBadge = `<span class="status-badge paid">${translate('statusPaid')}</span>`; }
                else if (matchStatus(st, 'partial')) { borderColor = 'var(--warning)'; statusBadge = `<span class="status-badge partial">${translate('statusPartiallyPaidShort')}</span>`; }
                else if (matchStatus(st, 'late')) { borderColor = '#e67e22'; statusBadge = `<span class="status-badge late">${translate('statusOverdue')}</span>`; }
                else { borderColor = 'var(--danger)'; statusBadge = `<span class="status-badge unpaid">${translate('statusUnpaid')}</span>`; }
                amountColor = borderColor;
                amountVal = parseAmount(i.المبلغ);
                amountDisplay = formatCurrency(amountVal);
            }
        }
        const imgIcon = i.صورة ? '<i class="fas fa-camera" style="margin-left:5px;color:var(--p);"></i>' : '';
        const entityDisplay = entity && entity !== '—' ? `<span style="font-size:0.85em;color:#888;">${entity}</span>` : '';
        const itemId = i.clientId || i.id || `temp-${Date.now()}`;
        return `<div class="list-item" style="border-right-color:${borderColor};" onclick="showDetailById('${itemId}','${currentLog}')"> <div style="font-weight:bold;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;"> <span>${imgIcon} ${desc} ${entityDisplay}</span> <span style="color:${amountColor};">${amountDisplay}</span> </div> <div class="details"> <span>${translateStoredValue(i.النوع || i.الفئة)} ${statusBadge}</span> <span><i class="far fa-clock" style="margin-left:4px;"></i>${date}</span> </div> <div class="log-item-hint"><i class="fas fa-hand-pointer"></i> ${translate('clickForDetails')}</div> </div>`;
    }).join('');
}

function showDetailById(id, type) { openLayer('detail', { logType: type, id: id }); }

function editTransaction() {
    if (!editMode) return;
    const savedEdit = { type: editMode.type, index: editMode.index };
    const type = savedEdit.type;
    const data = db[type][savedEdit.index];
    if (!data) { toastMsg(translate('notFound'), "error"); return; }
    const tabMap = { inc: 'income', exp: 'expenses', rig: 'rights', deb: 'debts' };
    const tabId = tabMap[type];
    closeAllLayers();
    editMode = savedEdit;
    openTab(tabId, true);
    setTimeout(() => {
        if (type === 'inc') {
            const a = document.getElementById('iAmount'), t = document.getElementById('iType'), d = document.getElementById('iDesc'), dt = document.getElementById('iDate');
            if (a) a.value = parseAmount(data.المبلغ).toLocaleString('en-US');
            if (t) t.value = data.الفئة;
            if (d) d.value = data.الوصف;
            if (dt) dt.value = data.التاريخ;
        } else if (type === 'exp') {
            const a = document.getElementById('eAmount'), t = document.getElementById('eType'), d = document.getElementById('eDesc'), dt = document.getElementById('eDate');
            if (a) a.value = parseAmount(data.المبلغ).toLocaleString('en-US');
            if (t) t.value = data.الفئة;
            if (d) d.value = data.الوصف;
            if (dt) dt.value = data.التاريخ;
            const imgName = document.getElementById('eImgName');
            if (data.صورة) { if (imgName) imgName.textContent = '📎 ' + translate('imageAttached'); selectedImageFile = data.صورة; }
            else { selectedImageFile = null; if (imgName) imgName.textContent = ''; }
        } else if (type === 'rig') {
            const t = document.getElementById('rType'), en = document.getElementById('rEntity'), a = document.getElementById('rAmount'), dd = document.getElementById('rDueDate'), dsc = document.getElementById('rDesc');
            if (t) t.value = data.النوع;
            if (en) en.value = data.الجهة || '';
            if (a) a.value = parseAmount(data.المبلغ).toLocaleString('en-US');
            if (dd) dd.value = data.تاريخ_الاستحقاق || '';
            if (dsc) dsc.value = data.الوصف;
            updateRightFields(data.النوع, data);
            const paidInput = document.getElementById('rPaidAmount');
            if (paidInput) paidInput.value = parseAmount(data.المبلغ_المدفوع || 0).toLocaleString('en-US');
            const rTiming = document.getElementById('rNotifTiming');
            if (rTiming) rTiming.value = data.وقت_التنبيه || '168';
        } else if (type === 'deb') {
            const t = document.getElementById('dType'), dd = document.getElementById('dDueDate'), dsc = document.getElementById('dDesc');
            const entityInput = document.getElementById('dEntity');
            if (t) t.value = data.النوع;
            if (dd) dd.value = data.تاريخ_الاستحقاق || '';
            if (dsc) dsc.value = data.الوصف;
            if (entityInput) {
                if (data.الجهة && data.الجهة !== '—') { entityInput.value = data.الجهة; entityInput.style.display = 'block'; }
                else { entityInput.value = ''; entityInput.style.display = 'none'; }
            }
            updateDebtFields(data.النوع, data);
            const masterTypes = ['🏦 قروض وتمويل', '👤 دين شخصي', '🛒 مشتريات بالتقسيط', '🚗 تمويل السيارة'];
            const isMaster = masterTypes.includes(data.النوع);
            if (!isMaster) {
                const a = document.getElementById('dAmount'), s = document.getElementById('dStatus');
                if (a) a.value = parseAmount(data.المبلغ).toLocaleString('en-US');
                if (s) {
                    s.value = data.الحالة || '';
                    s.dispatchEvent(new Event('change'));
                    if (data.الحالة === 'مدفوع جزئياً' && data.المبلغ_المدفوع_جزئياً) {
                        const paidInput = document.getElementById('dPartialPaidAmount');
                        if (paidInput) paidInput.value = parseAmount(data.المبلغ_المدفوع_جزئياً).toLocaleString('en-US');
                    }
                }
            }
            const dTiming = document.getElementById('dNotifTiming');
            if (dTiming) dTiming.value = data.وقت_التنبيه || '168';
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
    if (!txn) return;
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
        scheduleAutoSync();
    } catch (err) { toastMsg(translate('deleteFailed'), "error"); console.error(err); }
}

// =============================================================
// 14. NOTIFICATIONS
// =============================================================
function getReadNotifications() {
    try {
        const list = JSON.parse(localStorage.getItem('readNotifications') || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

function saveReadNotifications(list) { localStorage.setItem('readNotifications', JSON.stringify(list)); }

function cleanupExpiredReads() {
    const readList = getReadNotifications();
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const filtered = readList.filter(item => (now - item.readAt) < TWENTY_FOUR_HOURS);
    if (filtered.length !== readList.length) saveReadNotifications(filtered);
    return filtered;
}

function getNotificationId(item) { return `${item.type}|${item.id}|${item.date}`; }

function getUpcomingItems() {
    const now = new Date();
    const readList = cleanupExpiredReads();
    const readIds = readList.map(r => r.id);
    const items = [];
    (db.rig || []).forEach(r => {
        const remaining = parseAmount(r.المتبقي || 0);
        if (remaining <= 0) return;
        if (!r.تاريخ_الاستحقاق) return;
        const due = new Date(r.تاريخ_الاستحقاق);
        if (isNaN(due)) return;
        const timingHours = parseAmount(r.وقت_التنبيه) || 168;
        const notifyFrom = new Date(due.getTime() - timingHours * 60 * 60 * 1000);
        if (now >= notifyFrom) {
            const item = { type: 'right', id: r.clientId || r.id || '', name: r.النوع, entity: r.الجهة, amount: remaining, date: r.تاريخ_الاستحقاق, overdue: due < now };
            item.read = readIds.includes(getNotificationId(item));
            items.push(item);
        }
    });
    (db.deb || []).forEach(d => {
        const remaining = d.المتبقي_للالتزام !== undefined
            ? parseAmount(d.المتبقي_للالتزام)
            : (matchStatus(d.الحالة, 'paid') ? 0 : parseAmount(d.المبلغ || 0));
        if (remaining <= 0) return;
        if (!d.تاريخ_الاستحقاق) return;
        const due = new Date(d.تاريخ_الاستحقاق);
        if (isNaN(due)) return;
        const timingHours = parseAmount(d.وقت_التنبيه) || 168;
        const notifyFrom = new Date(due.getTime() - timingHours * 60 * 60 * 1000);
        if (now >= notifyFrom) {
            const item = { type: 'debt', id: d.clientId || d.id || '', name: d.النوع, entity: d.الجهة, amount: remaining, date: d.تاريخ_الاستحقاق, overdue: due < now };
            item.read = readIds.includes(getNotificationId(item));
            items.push(item);
        }
    });
    return items.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function getUnreadCount() { return getUpcomingItems().filter(i => !i.read).length; }

function updateNotificationBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const count = getUnreadCount();
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = count > 0 ? 'flex' : 'none';
}

function openNotifications() { openLayer('notifications'); }

function viewNotification(id) {
    const items = getUpcomingItems();
    const item = items.find(i => getNotificationId(i) === id);
    if (!item) return;
    if (!item.read) {
        const readList = getReadNotifications();
        if (!readList.find(r => r.id === id)) { readList.push({ id: id, readAt: Date.now() }); saveReadNotifications(readList); }
        updateNotificationBadge();
    }
    renderNotificationDetail(item);
}

function renderNotificationDetail(item) {
    const el = document.getElementById('notificationsContent');
    if (!el) return;
    let source = null;
    if (item.type === 'right') source = db.rig.find(r => (r.clientId || r.id) === item.id);
    else source = db.deb.find(d => (d.clientId || d.id) === item.id);
    const typeLabel = item.type === 'right' ? translate('rightLabel') : translate('debtLabel');
    const typeColor = item.type === 'right' ? 'var(--success)' : 'var(--danger)';
    const typeIcon = item.type === 'right' ? 'fa-hand-holding-usd' : 'fa-file-invoice-dollar';
    const arrowIcon = item.type === 'right' ? 'fa-arrow-down' : 'fa-arrow-up';
    const statusText = item.overdue ? translate('statusOverdue') : translate('upcomingItems');
    const statusColor = item.overdue ? 'var(--danger)' : 'var(--warning)';
    let html = `<button class="secondary" onclick="renderNotifications()" style="margin-bottom:15px;"> <i class="fas fa-arrow-right" style="margin-left:6px;"></i> ${translate('backToNotifications')} </button> <div class="card" style="border-top-color:${typeColor};"> <div style="text-align:center;margin-bottom:18px;"> <span style="display:inline-block;background:${typeColor};color:#fff;padding:8px 24px;border-radius:24px;font-weight:800;font-size:1.05em;"> <i class="fas ${typeIcon}" style="margin-left:8px;"></i> ${typeLabel} </span> </div> <h3 style="color:${typeColor};margin-top:0;display:flex;align-items:center;gap:8px;"> <i class="fas ${typeIcon}"></i> ${translateStoredValue(item.name)} </h3> <div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap;"> <span style="background:${statusColor};color:#fff;padding:4px 14px;border-radius:14px;font-size:0.85em;font-weight:700;"> ${item.overdue ? '⚠️' : '📅'} ${statusText} </span> <span style="background:${typeColor};color:#fff;padding:4px 14px;border-radius:14px;font-size:0.85em;font-weight:700;"> <i class="fas ${arrowIcon}" style="margin-left:4px;"></i> ${formatCurrency(item.amount)} </span> </div>`;
    if (source) {
        html += `<div style="border-top:1px solid var(--border-color);padding-top:12px;margin-top:8px;">`;
        for (const [key, val] of Object.entries(source)) {
            if (['id', 'clientId', 'صورة', 'المبلغ_المضاف_للرصيد', 'المبلغ_المخصوم_للرصيد'].includes(key)) continue;
            if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '' && key !== 'الوصف')) continue;
            html += `<p style="margin:8px 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;"> <strong style="color:#666;">${translateFieldLabel(key)}:</strong> <span style="font-weight:600;">${formatFieldValue(key, val)}</span> </p>`;
        }
        html += `</div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
}

function renderNotifications() {
    const el = document.getElementById('notificationsContent');
    if (!el) return;
    const items = getUpcomingItems();
    if (!items.length) {
        el.innerHTML = `<div class="notif-empty-state"> <i class="fas fa-bell-slash"></i> <p>${translate('noNotifications')}</p> <small>${translate('noNotificationsHint')}</small> </div>`;
        return;
    }
    const unread = items.filter(i => !i.read);
    const read = items.filter(i => i.read);
    let html = `<div class="notif-summary">
        <div class="notif-sum-card overdue-card"> <span class="sum-label">${translate('unreadNotifications')}</span> <span class="sum-value">${unread.length}</span> </div>
        <div class="notif-sum-card upcoming-card"> <span class="sum-label">${translate('readNotifications')}</span> <span class="sum-value">${read.length}</span> </div>
    </div>`;
    const renderItem = (i) => {
        const nid = getNotificationId(i);
        const cls = i.read ? 'notif-item read' : (i.overdue ? 'notif-item overdue' : 'notif-item upcoming');
        const icon = i.type === 'right' ? 'fa-hand-holding-usd' : 'fa-file-invoice-dollar';
        const typeLabel = i.type === 'right' ? translate('rightLabel') : translate('debtLabel');
        const typeColor = i.type === 'right' ? 'var(--success)' : 'var(--danger)';
        const arrowIcon = i.type === 'right' ? 'fa-arrow-down' : 'fa-arrow-up';
        const tag = i.overdue ? translate('statusOverdue') : translate('upcomingItems');
        const readBadge = i.read
            ? `<span class="notif-tag read-tag"><i class="fas fa-check"></i> ${translate('readNotification')}</span>`
            : `<span class="notif-tag">${tag}</span>`;
        const entity = (i.entity && i.entity !== '—') ? `<span class="notif-entity"><i class="fas fa-user"></i> ${i.entity}</span>` : '';
        const clickAttr = i.read ? '' : `onclick="viewNotification('${nid}')"`;
        return `<div class="${cls}" ${clickAttr}>
            <div class="notif-head">
                <span class="notif-name"><i class="fas ${icon}"></i> ${translateStoredValue(i.name)}</span>
                ${readBadge}
            </div>
            <span class="notif-type-badge" style="background:${typeColor};">
                <i class="fas ${arrowIcon}"></i> ${typeLabel}
            </span>
            <div class="notif-body">
                <span class="notif-amount">${formatCurrency(i.amount)}</span>
                <span class="notif-date"><i class="far fa-clock"></i> ${formatDateTime(i.date)}</span>
            </div>
            ${entity}
            ${i.read ? '' : `<div class="notif-read-hint"><i class="fas fa-hand-pointer"></i> ${translate('clickToRead')}</div>`}
        </div>`;
    };
    if (unread.length) {
        html += `<div class="notif-group-title unread-title"> <i class="fas fa-bell"></i> ${translate('unreadNotifications')} <span class="count-pill">${unread.length}</span> </div>`;
        html += unread.map(renderItem).join('');
    }
    if (read.length) {
        html += `<div class="notif-group-title read-title"> <i class="fas fa-check-circle"></i> ${translate('readNotifications')} <span class="count-pill">${read.length}</span> </div>`;
        html += read.map(renderItem).join('');
    }
    el.innerHTML = html;
}

// =============================================================
// 15. UPDATE STATS (مساعد مالي ذكي + فلتر الفترة)
// =============================================================
const ADVISOR = {
    ar: { good: 'وضعك المالي جيد: مصروفاتك أقل من دخلك.', over: 'تنبيه: مصروفاتك أعلى من دخلك؛ راجع قسم المصروفات.', noIncome: 'لا يوجد دخل مسجل مع وجود مصروفات؛ أضف دخلك من قسم الدخل.', noData: 'لا توجد عمليات في هذه الفترة بعد؛ ابدأ بتسجيل دخل أو مصروف.', tipR: 'لديك حقوق غير محصلة بقيمة', tipD: 'لديك التزامات غير مدفوعة بقيمة' },
    en: { good: 'Your status is good: expenses are less than income.', over: 'Alert: expenses exceed income; review Expenses.', noIncome: 'No income recorded but you have expenses; add income.', noData: 'No transactions in this period yet; start by adding income or expense.', tipR: 'You have uncollected rights of', tipD: 'You have unpaid obligations of' },
    ur: { good: 'آپ کی صورتحال اچھی ہے: اخراجات آمدنی سے کم ہیں۔', over: 'انتباہ: اخراجات آمدنی سے زیادہ ہیں؛ اخراجات کا جائزہ لیں۔', noIncome: 'آمدنی درج نہیں مگر اخراجات ہیں؛ آمدنی شامل کریں۔', noData: 'اس مدت میں ابھی کوئی عمل نہیں؛ آمدنی یا خرچ درج کریں۔', tipR: 'آپ کے پاس وصولی کے بقایا حقوق ہیں بذریعہ', tipD: 'آپ پر غیر ادا شدہ ذمہ داریاں ہیں بذریعہ' }
};

function updateStats() {
    const sum = (l, f) => l.reduce((a, i) => a + parseAmount(i[f] || 0), 0);
    const period = statsPeriodFilter;
    const incList = db.inc.filter(i => inStatsPeriod(i.التاريخ, period));
    const expList = db.exp.filter(i => inStatsPeriod(i.التاريخ, period));
    const rigList = db.rig.filter(i => inStatsPeriod(i.تاريخ_الاستحقاق || i.التاريخ, period));
    const debList = db.deb.filter(i => inStatsPeriod(i.تاريخ_الاستحقاق || i.التاريخ, period));
    const incTotal = sum(incList, 'المبلغ');
    const expTotal = sum(expList, 'المبلغ');
    const rigTotal = sum(rigList, 'المبلغ');
    const rigPaid = sum(rigList, 'المبلغ_المضاف_للرصيد');
    const debTotal = debList.reduce((a, i) => a + (i.المبلغ_الكلي_للالتزام ? parseAmount(i.المبلغ_الكلي_للالتزام) : parseAmount(i.المبلغ || 0)), 0);
    const debPaid = sum(debList, 'المبلغ_المخصوم_للرصيد');
    const net = incTotal - expTotal;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setBar = (id, p) => { const el = document.getElementById(id); if (el) el.style.width = p + '%'; };
    const pct = (a, b) => (b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0);
    const cur = (currentLang === 'ur') ? 'ur' : (currentLang === 'en') ? 'en' : 'ar';
    const A = ADVISOR[cur];
    const money = x => `${getFormattedAmount(x)} ${currentCurrency.symbol}`;
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
        const rigUnpaid = rigTotal - rigPaid, debUnpaid = debTotal - debPaid;
        if (rigUnpaid > 0) msg += ' • ' + A.tipR + ' ' + money(rigUnpaid);
        if (debUnpaid > 0) msg += ' • ' + A.tipD + ' ' + money(debUnpaid);
        const banner = document.getElementById('sStatusBanner');
        const sIcon = document.getElementById('sStatusIcon');
        if (banner) banner.className = 'stat-status ' + (aType === 'good' ? 'good' : 'bad');
        if (sIcon) sIcon.className = 'fas ' + (aType === 'good' ? 'fa-check-circle' : 'fa-exclamation-circle');
        setText('sStatusTitle', aType === 'good' ? translate('goodTitle') : translate('badTitle'));
        setText('sStatusMsg', msg);
    }
}

function inStatsPeriod(dateStr, period) {
    if (period === 'all' || !dateStr) return true;
    const d = new Date(dateStr);
    if (isNaN(d)) return true;
    const now = new Date();
    if (period === 'today') return d.toDateString() === now.toDateString();
    if (period === 'week') {
        const range = getWeekRange();
        return d >= range.start && d <= range.end;
    }
    if (period === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (period === 'year') return d.getFullYear() === now.getFullYear();
    return true;
}

function getWeekRange() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    return { start: startOfWeek, end: endOfWeek };
}

function setStatsPeriod(period) {
    statsPeriodFilter = period;
    localStorage.setItem('statsPeriodFilter', period);
    updateStats();
}

// =============================================================
// 16. OTHER FUNCTIONS
// =============================================================
function renderCurrencyList() {
    const list = document.getElementById('currencyList');
    if (!list) return;
    const searchEl = document.getElementById('currencySearch');
    const q = searchEl ? searchEl.value.toLowerCase() : '';
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
        const label = document.getElementById('sidebarCurrencyLabel');
        if (label) label.textContent = sel.symbol;
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
                saveData('bal', db.bal).then(() => {
                    loadAllData().then(() => {
                        updateStats();
                        updateBalanceDisplay();
                        toastMsg(translate('dataReset'), "success");
                        scheduleAutoSync();
                    });
                });
            }
        };
        req.onerror = () => toastMsg(translate('resetFailed'), "error");
    });
}

// =============================================================
// 17. SIDEBAR FUNCTIONS
// =============================================================
function openSidebar() {
    if (!isDriveConnected && localStorage.getItem('drive_token') && localStorage.getItem('drive_email')) {
        const tokenExpiry = localStorage.getItem('drive_token_expiry');
        const expiry = parseInt(tokenExpiry) || 0;
        if (expiry > Date.now()) {
            accessToken = localStorage.getItem('drive_token');
            userEmail = localStorage.getItem('drive_email') || '';
            appFolderId = localStorage.getItem('drive_folder_id') || null;
            isDriveConnected = true;
        }
    }
    updateDriveUI();
    updateAutoSyncUI();
    openLayer('sidebar');
}
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
    if (!input) return;
    input.value = null;
    input.setAttribute('capture', 'environment');
    input.click();
}

function openGalleryInput() {
    closeImageSource();
    const input = document.getElementById('eImgGallery');
    if (!input) return;
    input.value = null;
    input.removeAttribute('capture');
    input.click();
}

function handleImageSelect(input) {
    if (input.files && input.files.length > 0) {
        const file = input.files[0];
        selectedImageFile = file;
        const imgName = document.getElementById('eImgName');
        if (imgName) imgName.textContent = `✅ ${file.name}`;
        const reader = new FileReader();
        reader.onload = function (e) { selectedImageFile = e.target.result; };
        reader.readAsDataURL(file);
    } else {
        const imgName = document.getElementById('eImgName');
        if (imgName) imgName.textContent = '';
        selectedImageFile = null;
    }
}

function getSelectedImage() { return selectedImageFile; }

function clearSelectedImage() {
    selectedImageFile = null;
    const imgName = document.getElementById('eImgName');
    if (imgName) imgName.textContent = '';
    const camInput = document.getElementById('eImgCamera');
    if (camInput) camInput.value = null;
    const galInput = document.getElementById('eImgGallery');
    if (galInput) galInput.value = null;
}

// =============================================================
// 18. INDEXED DB OPERATIONS
// =============================================================
function initDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) { toastMsg(translate('indexedDBUnsupported'), "error"); return reject(new Error("IndexedDB not supported.")); }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onerror = (e) => { console.error("IDB error: ", e.target.error); reject(e.target.error); };
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
            loadAllData().then(() => { updateStats(); updateBalanceDisplay(); });
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
        loadStoreData('exp'), loadStoreData('rig'), loadStoreData('deb'), loadStoreData('bal'), loadStoreData('inc')
    ]);
    db.exp = exp; db.rig = rig; db.deb = deb; db.bal = bal; db.inc = inc;
    currentBalance = parseAmount(db.bal.amount || 0);
    updateNotificationBadge();
}

// =============================================================
// 19. DARK MODE
// =============================================================
function loadDarkModePreference() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const toggle = document.getElementById('darkModeToggle');
        if (toggle) toggle.checked = true;
    }
}

function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDark);
    toastMsg(isDark ? translate('darkModeOn') : translate('darkModeOff'), "info");
}
loadDarkModePreference();

// =============================================================
// 20. INITIALIZATION
// =============================================================
window.onload = () => {
    if (!history.state || history.state.layer === undefined) {
        history.replaceState({ layer: 'main' }, null, '#main');
        historyStack.push({ layer: 'main' });
    } else { historyStack.push(history.state); }
    loadTranslations().then(() => { applyTranslations(currentLang); });
    const now = getLocalDateString();
    ['eDate', 'rDueDate', 'dDueDate', 'iDate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = now; });
    const statsPeriodEl = document.getElementById('statsPeriod');
    if (statsPeriodEl) statsPeriodEl.value = statsPeriodFilter;
    const currencyLabel = document.getElementById('sidebarCurrencyLabel');
    if (currencyLabel) currencyLabel.textContent = currentCurrency.symbol;
    updateBalanceDisplay();
    updateStats();
    updateDriveUI();
    updateAutoSyncUI();
    updateNotificationBadge();
    setTimeout(() => { initGapi(); initGis(); restoreDriveState(); }, 1000);
};
console.log('ميزانيتك الذكية جاهزة ✅');
