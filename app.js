// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
    APP_NAME: 'ميزانيتك الذكية',
    APP_VERSION: '6.0',
    IDB_NAME: 'MySmartBudgetDB',
    IDB_VERSION: 6,
    STORE_NAMES: ['exp', 'rig', 'deb', 'bal', 'inc', 'budget', 'goal', 'recurring'],
    CLIENT_ID: '110105567176-h191ogi1tl0bevvk0vo8jvnbf47re5q1.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/drive.file',
    APP_FOLDER_NAME: 'ميزانيتك الذكية',
    BACKUP_PREFIX: 'نسخة'
};

// ============================================================
// APPLICATION STATE
// ============================================================
const State = {
    db: { exp: [], rig: [], deb: [], bal: { clientId: 1, amount: 0, changes: [] }, inc: [], budget: [], goal: [], recurring: [] },
    connection: null,
    currentBalance: 0,
    balanceHidden: localStorage.getItem('balanceHidden') === 'true',
    currentTab: 'dashboard',
    currentSubTab: {},
    currentLog: '',
    editMode: null,
    balanceActionType: null,
    selectedImageFile: null,
    // Google Drive
    accessToken: null,
    isDriveConnected: false,
    backupFiles: [],
    userEmail: '',
    appFolderId: null,
    tokenClient: null,
    tokenRefreshInterval: null,
    // Calendar
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),
    // Currency
    currentCurrency: null
};

// ============================================================
// CURRENCY DATA
// ============================================================
const CURRENCIES = [
    { code: 'SDG', symbol: 'ج.س', name: 'جنيه سوداني' },
    { code: 'SAR', symbol: 'ر.س', name: 'ريال سعودي' },
    { code: 'EGP', symbol: 'ج.م', name: 'جنيه مصري' },
    { code: 'AED', symbol: 'د.إ', name: 'درهم إماراتي' },
    { code: 'KWD', symbol: 'د.ك', name: 'دينار كويتي' },
    { code: 'QAR', symbol: 'ر.ق', name: 'ريال قطري' },
    { code: 'OMR', symbol: 'ر.ع.', name: 'ريال عماني' },
    { code: 'JOD', symbol: 'د.ا', name: 'دينار أردني' },
    { code: 'BHD', symbol: 'د.ب', name: 'دينار بحريني' },
    { code: 'MAD', symbol: 'د.م', name: 'درهم مغربي' },
    { code: 'TND', symbol: 'د.ت', name: 'دينار تونسي' },
    { code: 'DZD', symbol: 'د.ج', name: 'دينار جزائري' },
    { code: 'LBP', symbol: 'ل.ل', name: 'ليرة لبنانية' },
    { code: 'YER', symbol: 'ر.ي', name: 'ريال يمني' },
    { code: 'USD', symbol: '$', name: 'دولار أمريكي' },
    { code: 'EUR', symbol: '€', name: 'يورو' },
    { code: 'INR', symbol: '₹', name: 'روبية هندية' },
    { code: 'PKR', symbol: 'Rs', name: 'روبية باكستانية' },
    { code: 'BDT', symbol: '৳', name: 'تاكا بنغلاديشي' }
];

// ============================================================
// INDEXEDDB
// ============================================================
function initDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            toastMsg('المتصفح لا يدعم IndexedDB.', 'error');
            return reject(new Error('IndexedDB not supported'));
        }
        const req = indexedDB.open(CONFIG.IDB_NAME, CONFIG.IDB_VERSION);
        req.onerror = (e) => {
            console.error('IDB error:', e.target.error);
            reject(e.target.error);
        };
        req.onupgradeneeded = (e) => {
            const conn = e.target.result;
            CONFIG.STORE_NAMES.forEach(sn => {
                if (conn.objectStoreNames.contains(sn)) conn.deleteObjectStore(sn);
                const keyPath = (sn === 'bal') ? 'clientId' : 'id';
                const autoIncrement = (sn !== 'bal');
                const store = conn.createObjectStore(sn, { keyPath, autoIncrement });
                if (sn === 'bal') store.add({ clientId: 1, amount: 0, changes: [] });
            });
            // Migration للبيانات القديمة
            migrateOldData(conn);
        };
        req.onsuccess = (e) => {
            State.connection = e.target.result;
            loadAllData().then(() => {
                updateAllUI();
                resolve(State.connection);
            });
        };
    });
}

async function migrateOldData(conn) {
    // التحقق من وجود مخازن قديمة وترحيلها
    const oldStores = ['exp', 'rig', 'deb', 'bal'];
    const newStores = ['inc', 'budget', 'goal', 'recurring'];
    
    for (const sn of oldStores) {
        if (conn.objectStoreNames.contains(sn)) {
            try {
                const tx = conn.transaction(sn, 'readonly');
                const store = tx.objectStore(sn);
                const data = await new Promise((resolve) => {
                    const req = store.getAll();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve([]);
                });
                if (data && data.length > 0) {
                    console.log(`Migrated ${data.length} items from ${sn}`);
                }
            } catch (e) {
                console.log(`Migration check for ${sn} failed:`, e);
            }
        }
    }
}

// ============================================================
// DATABASE OPERATIONS
// ============================================================
function saveData(storeName, data) {
    return new Promise((resolve, reject) => {
        if (!State.connection) return reject(new Error('DB not connected'));
        const tx = State.connection.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

function deleteFromDB(storeName, id) {
    return new Promise((resolve, reject) => {
        if (!State.connection) return reject(new Error('DB not connected'));
        const tx = State.connection.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

function loadStoreData(storeName) {
    return new Promise((resolve) => {
        if (!State.connection) {
            return resolve(storeName === 'bal' ? { clientId: 1, amount: 0, changes: [] } : []);
        }
        const tx = State.connection.transaction([storeName], 'readonly');
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
    const [exp, rig, deb, bal, inc, budget, goal, recurring] = await Promise.all([
        loadStoreData('exp'),
        loadStoreData('rig'),
        loadStoreData('deb'),
        loadStoreData('bal'),
        loadStoreData('inc'),
        loadStoreData('budget'),
        loadStoreData('goal'),
        loadStoreData('recurring')
    ]);
    State.db.exp = exp;
    State.db.rig = rig;
    State.db.deb = deb;
    State.db.bal = bal;
    State.db.inc = inc;
    State.db.budget = budget;
    State.db.goal = goal;
    State.db.recurring = recurring;
    State.currentBalance = State.db.bal.amount || 0;
}

// ============================================================
// CURRENCY
// ============================================================
function getCurrency() {
    if (!State.currentCurrency) {
        const code = localStorage.getItem('currencyCode') || 'SDG';
        State.currentCurrency = CURRENCIES.find(c => c.code === code) || CURRENCIES[0];
    }
    return State.currentCurrency;
}

function setCurrency(code) {
    const currency = CURRENCIES.find(c => c.code === code);
    if (currency) {
        State.currentCurrency = currency;
        localStorage.setItem('currencyCode', code);
        updateAllUI();
        toastMsg(`تم تعيين العملة إلى ${currency.name} 💱`, 'success');
    }
}

// ============================================================
// FORMATTING HELPERS
// ============================================================
function formatAmount(input) {
    let val = input.value.replace(/[^\d.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
    const num = parseFloat(parts[0].replace(/,/g, ''));
    let formatted = isNaN(num) ? '' : num.toLocaleString('ar');
    if (val.endsWith('.') && !parts[1]) formatted += '.';
    input.value = formatted + (parts[1] ? '.' + parts[1] : '');
}

function parseAmount(amount) {
    let str = String(amount).replace(/[،\u066c]/g, '').replace(/[^\d.]/g, '');
    str = str.replace(/([٠١٢٣٤٥٦٧٨٩])/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632 + 48));
    return parseFloat(str) || 0;
}

function formatNumber(num) {
    return num.toLocaleString('ar', { minimumFractionDigits: num % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

function formatCurrency(amount, withColor = false) {
    if (State.balanceHidden) return '<span class="hidden-balance">***</span>';
    const num = parseAmount(amount);
    const currency = getCurrency();
    const fmt = formatNumber(num);
    let colorStyle = '';
    if (withColor) {
        if (num > 0) colorStyle = 'style="color:var(--success);"';
        else if (num < 0) colorStyle = 'style="color:var(--danger);"';
    }
    return `<span ${colorStyle}>${fmt} <span class="currency-symbol">${currency.symbol}</span></span>`;
}

function formatDate(dateString) {
    if (!dateString) return '—';
    const d = new Date(dateString);
    if (isNaN(d)) return 'تاريخ غير صالح';
    return d.toLocaleString('ar-EG', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    });
}

function formatDateShort(dateString) {
    if (!dateString) return '—';
    const d = new Date(dateString);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function getToday() {
    return new Date().toISOString().slice(0, 10);
}

function getMonthRange(month, year) {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function toastMsg(message, type = 'info') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.className = 'toast ' + type;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    t.innerHTML = `<span class="toast-icon ${type}"><i class="fas ${icons[type] || 'fa-info-circle'}"></i></span> ${message}`;
    t.classList.add('show');
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.classList.remove('show'), 3000);
}

// ============================================================
// LOADING OVERLAY
// ============================================================
function showLoading(message = 'جاري المعالجة...') {
    const overlay = document.getElementById('loadingOverlay');
    const msg = document.getElementById('loadingMessage');
    if (msg) msg.textContent = message;
    if (overlay) overlay.classList.add('show');
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('show');
}

// ============================================================
// NAVIGATION
// ============================================================
function switchTab(tab) {
    // تحديث الأزرار
    document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.bottom-nav button[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');

    // تحديث الأقسام
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(`section-${tab}`);
    if (section) section.classList.add('active');

    State.currentTab = tab;

    // تحديث المحتوى حسب التاب
    if (tab === 'dashboard') updateDashboard();
    if (tab === 'money') updateMoneyTab();
    if (tab === 'rights-debts') updateRightsDebtsTab();
    if (tab === 'planning') updatePlanningTab();
    if (tab === 'more') updateMoreTab();

    // إغلاق السايد بار
    closeSidebar();
}

function switchSubTab(parent, sub) {
    // تحديث الأزرار
    const container = document.querySelector(`#section-${parent} .sub-tabs`);
    if (container) {
        container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        const btn = container.querySelector(`button[data-subtab="${sub}"]`);
        if (btn) btn.classList.add('active');
    }

    // تحديث الأقسام
    const parentSection = document.getElementById(`section-${parent}`);
    if (parentSection) {
        parentSection.querySelectorAll('.sub-section').forEach(s => s.classList.remove('active'));
        const subSection = document.getElementById(`sub-${parent}-${sub}`);
        if (subSection) subSection.classList.add('active');
    }

    State.currentSubTab[parent] = sub;
}

function openSidebar() {
    document.getElementById('appSidebar').classList.add('open');
    document.querySelector('.sidebar-overlay').classList.add('open');
}

function closeSidebar() {
    document.getElementById('appSidebar').classList.remove('open');
    document.querySelector('.sidebar-overlay').classList.remove('open');
}

function toggleSidebar() {
    if (document.getElementById('appSidebar').classList.contains('open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

function toggleSearch() {
    const bar = document.getElementById('searchBar');
    const input = document.getElementById('globalSearch');
    if (bar.style.display === 'none') {
        bar.style.display = 'flex';
        input.focus();
    } else {
        bar.style.display = 'none';
        input.value = '';
        globalSearch('');
    }
}

// ============================================================
// QUICK ADD
// ============================================================
function openQuickAdd() {
    openLayer('quickAdd');
}

function quickAdd(type) {
    closeLayer('quickAdd');
    switchTab('money');
    if (type === 'income') {
        switchSubTab('money', 'income');
        document.getElementById('incAmount').focus();
    } else if (type === 'expense') {
        switchSubTab('money', 'expenses');
        document.getElementById('eAmount').focus();
    } else if (type === 'right') {
        switchTab('rights-debts');
        switchSubTab('rights-debts', 'rights');
        document.getElementById('rAmount').focus();
    } else if (type === 'debt') {
        switchTab('rights-debts');
        switchSubTab('rights-debts', 'debts');
        document.getElementById('dAmount').focus();
    }
}

// ============================================================
// MODALS (LAYERS)
// ============================================================
const LAYERS = {
    sidebar: { elementId: 'appSidebar', type: 'menu' },
    log: { elementId: 'logModal', type: 'modal' },
    detail: { elementId: 'detailModal', type: 'modal' },
    currency: { elementId: 'currencyModal', type: 'modal' },
    about: { elementId: 'aboutModal', type: 'modal' },
    balanceAction: { elementId: 'balanceActionModal', type: 'modal' },
    balanceLog: { elementId: 'balanceLogModal', type: 'modal' },
    imageSource: { elementId: 'imageSourceModal', type: 'menu' },
    confirmBackup: { elementId: 'confirmBackupModal', type: 'modal' },
    driveBackup: { elementId: 'driveBackupModal', type: 'modal' },
    exportName: { elementId: 'exportNameModal', type: 'modal' },
    quickAdd: { elementId: 'quickAddModal', type: 'modal' }
};

let historyStack = [];

function openLayer(layerName, data = {}) {
    const layer = LAYERS[layerName];
    if (!layer) return;
    const el = document.getElementById(layer.elementId);
    if (!el) return;

    if (layer.type === 'modal') {
        el.style.display = 'flex';
        if (layerName === 'log') { State.currentLog = data.logType; renderLog(); }
        else if (layerName === 'detail') {
            const o = State.db[data.logType]?.find(item => item.clientId === data.id || item.id === data.id);
            if (!o) { toastMsg('لم يتم العثور على المعاملة.', 'error'); return; }
            const idx = State.db[data.logType].findIndex(item => item.clientId === data.id || item.id === data.id);
            State.editMode = { type: data.logType, index: idx };
            renderDetail(o, data.logType);
        }
        else if (layerName === 'balanceAction') {
            State.balanceActionType = data.actionType;
            document.getElementById('actionModalTitle').textContent = data.actionType === 'deposit' ? 'إيداع رصيد' : 'سحب رصيد';
            document.getElementById('currentBalanceInAction').innerHTML = formatCurrency(State.currentBalance);
            document.getElementById('bAmount').value = '';
            document.getElementById('bDesc').value = '';
            document.getElementById('bDate').value = new Date().toISOString().slice(0, 16);
        }
        else if (layerName === 'currency') {
            document.getElementById('currencySearch').value = '';
            renderCurrencyList();
        }
        else if (layerName === 'balanceLog') renderBalanceLog();
        else if (layerName === 'driveBackup') renderDriveBackupList();
        else if (layerName === 'exportName') {
            document.getElementById('exportFileName').value = 'بيانات_ميزانيتي';
            document.getElementById('exportFileName').focus();
            document.getElementById('exportFileName').select();
        }
    } else if (layer.type === 'menu') {
        el.classList.add('open');
        const ov = document.querySelector(layerName === 'imageSource' ? '#imageSourceOverlay' : '.sidebar-overlay');
        if (ov) ov.classList.add('open');
    }

    historyStack.push({ layer: layerName, data });
}

function closeLayer(layerName) {
    const layer = LAYERS[layerName];
    if (!layer) return;
    const el = document.getElementById(layer.elementId);
    if (!el) return;

    if (layer.type === 'modal') {
        el.style.display = 'none';
        if (layerName === 'detail' || layerName === 'log') State.editMode = null;
    } else if (layer.type === 'menu') {
        el.classList.remove('open');
        const ov = document.querySelector(layerName === 'imageSource' ? '#imageSourceOverlay' : '.sidebar-overlay');
        if (ov) ov.classList.remove('open');
    }

    historyStack = historyStack.filter(h => h.layer !== layerName);
}

// ============================================================
// SEARCH
// ============================================================
function globalSearch(query) {
    // سيتم تنفيذ البحث في جميع البيانات
    if (!query.trim()) {
        document.getElementById('searchBar').style.display = 'none';
        return;
    }
    // عرض النتائج في لوحة مؤقتة
    const results = searchAllData(query);
    showSearchResults(results);
}

function searchAllData(query) {
    const q = query.toLowerCase();
    const results = [];
    const types = [
        { key: 'exp', label: 'مصروف', icon: 'fa-arrow-down' },
        { key: 'inc', label: 'دخل', icon: 'fa-arrow-up' },
        { key: 'rig', label: 'حق', icon: 'fa-hand-holding-heart' },
        { key: 'deb', label: 'التزام', icon: 'fa-file-invoice' }
    ];
    for (const t of types) {
        const items = State.db[t.key] || [];
        for (const item of items) {
            const searchable = Object.values(item).join(' ').toLowerCase();
            if (searchable.includes(q)) {
                results.push({ ...item, _type: t.key, _label: t.label, _icon: t.icon });
            }
        }
    }
    return results.slice(0, 20);
}

function showSearchResults(results) {
    // عرض بسيط للنتائج - يمكن تحسينها لاحقاً
    if (results.length === 0) {
        toastMsg('لا توجد نتائج للبحث', 'info');
        return;
    }
    let msg = `🔍 تم العثور على ${results.length} نتيجة`;
    toastMsg(msg, 'info');
    // نفتح سجل العمليات مع التصفية
    if (results.length > 0) {
        const first = results[0];
        openLog(first._type);
    }
}

// ============================================================
// BALANCE
// ============================================================
function toggleBalanceVisibility() {
    State.balanceHidden = !State.balanceHidden;
    localStorage.setItem('balanceHidden', State.balanceHidden);
    updateBalanceDisplay();
}

function updateBalanceDisplay() {
    const display = document.getElementById('currentBalanceDisplay');
    if (display) display.innerHTML = formatCurrency(State.currentBalance);
    const act = document.getElementById('currentBalanceInAction');
    if (act) act.innerHTML = formatCurrency(State.currentBalance);
    const icon = document.querySelector('#balanceVisibilityToggle i');
    if (icon) icon.className = State.balanceHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
}

async function processBalanceChange(amount, type, description, recordId = null, isEdit = false, oldAmount = 0) {
    if (!recordId) recordId = `bal-${Date.now()}`;
    const changeAmount = parseAmount(amount);
    let netChange = changeAmount;
    if (['expense', 'debt_payment', 'withdraw', 'revert_expense_debt'].includes(type)) netChange *= -1;
    let effectiveChange = netChange;
    if (isEdit) effectiveChange = netChange - oldAmount;

    State.currentBalance = parseAmount(State.currentBalance) + effectiveChange;
    State.db.bal.amount = State.currentBalance;

    const entry = {
        id: recordId,
        التاريخ: new Date().toISOString().slice(0, 16),
        النوع: description,
        المبلغ: changeAmount,
        التأثير: (netChange > 0 ? 'إيداع' : (netChange < 0 ? 'خصم' : 'تعديل')),
        القيمة_الصافية: netChange,
        الرصيد_بعد_العملية: State.currentBalance
    };

    const idx = State.db.bal.changes.findIndex(c => c.id === recordId);
    if (idx > -1) State.db.bal.changes[idx] = entry;
    else State.db.bal.changes.unshift(entry);

    try {
        await saveData('bal', State.db.bal);
        updateBalanceDisplay();
        return true;
    } catch (e) {
        console.error('Balance save failed', e);
        State.currentBalance -= effectiveChange;
        toastMsg('فشل تحديث الرصيد.', 'error');
        return false;
    }
}

async function processBalanceAction() {
    const amt = document.getElementById('bAmount').value;
    const desc = document.getElementById('bDesc').value || (State.balanceActionType === 'deposit' ? 'إيداع' : 'سحب');
    if (!amt) return toastMsg('الرجاء إدخال المبلغ.', 'error');
    const ok = await processBalanceChange(amt, State.balanceActionType, desc, `manual-${Date.now()}`);
    if (ok) {
        toastMsg(State.balanceActionType === 'deposit' ? 'تم الإيداع بنجاح 💰' : 'تم السحب بنجاح 💰', 'success');
        closeLayer('balanceAction');
        updateDashboard();
    }
}

function renderBalanceLog() {
    const el = document.getElementById('balanceLogContent');
    if (!el) return;
    const changes = State.db.bal.changes || [];
    if (!changes.length) {
        el.innerHTML = '<p class="empty-state">لا توجد حركات رصيد.</p>';
        return;
    }
    el.innerHTML = changes.map(i => {
        const isDep = i.القيمة_الصافية > 0;
        const color = isDep ? 'var(--success)' : (i.القيمة_الصافية < 0 ? 'var(--danger)' : '#999');
        const icon = isDep ? 'fa-arrow-up' : (i.القيمة_الصافية < 0 ? 'fa-arrow-down' : 'fa-minus');
        return `
            <div class="log-item" style="border-right-color:${color};">
                <div class="log-header">
                    <span><i class="fas ${icon}" style="color:${color};"></i> ${i.النوع}</span>
                    <span style="color:${color};">${formatCurrency(i.المبلغ)}</span>
                </div>
                <div class="log-details">
                    <span>الرصيد بعد: ${formatCurrency(i.الرصيد_بعد_العملية)}</span>
                    <span>${formatDate(i.التاريخ)}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// INCOME
// ============================================================
async function addIncome() {
    const amount = document.getElementById('incAmount');
    const category = document.getElementById('incCategory');
    const source = document.getElementById('incSource');
    const date = document.getElementById('incDate');
    const desc = document.getElementById('incDesc');

    if (!amount.value || !category.value || !date.value) {
        return toastMsg('أكمل البيانات المطلوبة', 'error');
    }

    const isEditing = State.editMode && State.editMode.type === 'inc';
    const oldData = isEditing ? State.db.inc[State.editMode.index] : {};
    const amt = parseAmount(amount.value);
    if (amt === 0) return toastMsg('المبلغ يجب أن يكون أكبر من صفر.', 'error');

    const data = isEditing ? { ...oldData } : {};
    data.المبلغ = formatNumber(amt);
    data.الفئة = category.value;
    data.المصدر = source.value || '—';
    data.التاريخ = date.value;
    data.الوصف = desc.value || '—';
    data.clientId = isEditing ? oldData.clientId : `inc-${Date.now()}`;

    try {
        await saveData('inc', data);
        await processBalanceChange(amt, 'income', `دخل: ${data.الفئة} (${data.المصدر})`, data.clientId, isEditing,
            isEditing ? parseAmount(oldData.المبلغ) : 0);
        toastMsg(isEditing ? 'تم تعديل الدخل ✏️' : 'تم إضافة الدخل ✅', 'success');
        postSaveCleanup(isEditing, 'inc');
        updateDashboard();
    } catch (err) {
        toastMsg('فشل الحفظ.', 'error');
        console.error(err);
    }
}

// ============================================================
// EXPENSES
// ============================================================
async function addExpense() {
    const amount = document.getElementById('eAmount');
    const category = document.getElementById('eCategory');
    const date = document.getElementById('eDate');
    const desc = document.getElementById('eDesc');

    if (!amount.value || !category.value || !date.value) {
        return toastMsg('أكمل البيانات المطلوبة', 'error');
    }

    const isEditing = State.editMode && State.editMode.type === 'exp';
    const oldData = isEditing ? State.db.exp[State.editMode.index] : {};
    const amt = parseAmount(amount.value);
    if (amt === 0) return toastMsg('المبلغ يجب أن يكون أكبر من صفر.', 'error');

    const data = isEditing ? { ...oldData } : {};
    data.المبلغ = formatNumber(amt);
    data.الفئة = category.value;
    data.الوصف = desc.value || '—';
    data.التاريخ = date.value;
    data.clientId = isEditing ? oldData.clientId : `exp-${Date.now()}`;

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
        await processBalanceChange(amt, 'expense', `مصروف: ${data.الفئة}`, data.clientId, isEditing,
            isEditing ? parseAmount(oldData.المبلغ) : 0);
        toastMsg(isEditing ? 'تم تعديل المصروف ✏️' : 'تم إضافة المصروف ✅', 'success');
        postSaveCleanup(isEditing, 'exp');
        updateDashboard();
    } catch (err) {
        toastMsg('فشل الحفظ.', 'error');
        console.error(err);
    }
}

// ============================================================
// RIGHTS
// ============================================================
function updateRightFields(type, currentData = null) {
    const container = document.getElementById('rDynamicFields');
    if (!container) return;
    container.innerHTML = `
        <input id="rPaidAmount" type="text" placeholder="💰 المبلغ المحصل" oninput="formatAmount(this)" 
               value="${currentData && currentData.المبلغ_المدفوع ? parseAmount(currentData.المبلغ_المدفوع).toLocaleString('ar') : ''}" />
        <span class="field-hint">لا يمكن أن يتجاوز المبلغ الكلي</span>
    `;
}

async function addRight() {
    const amount = document.getElementById('rAmount');
    const type = document.getElementById('rType');
    const entity = document.getElementById('rEntity');
    const dueDate = document.getElementById('rDueDate');
    const desc = document.getElementById('rDesc');
    const paidAmount = document.getElementById('rPaidAmount');

    if (!amount.value || !type.value || !dueDate.value) {
        return toastMsg('أكمل البيانات المطلوبة', 'error');
    }

    const isEditing = State.editMode && State.editMode.type === 'rig';
    const oldData = isEditing ? State.db.rig[State.editMode.index] : {};
    const total = parseAmount(amount.value);
    if (total === 0) return toastMsg('المبلغ يجب أن يكون أكبر من صفر.', 'error');

    const paid = parseAmount(paidAmount ? paidAmount.value : 0);
    if (paid > total) {
        return toastMsg('⚠️ المبلغ المحصل لا يمكن أن يتجاوز المبلغ الكلي!', 'error');
    }

    const data = isEditing ? { ...oldData } : {};
    data.clientId = isEditing ? oldData.clientId : `rig-${Date.now()}`;
    data.النوع = type.value;
    data.المبلغ = formatNumber(total);
    data.الجهة = entity.value || '—';
    data.تاريخ_الاستحقاق = dueDate.value;
    data.الوصف = desc.value || '—';
    data.المبلغ_المدفوع = formatNumber(paid);
    data.المتبقي = formatNumber(total - paid);
    data.الحالة = paid >= total ? 'مدفوع بالكامل' : (paid > 0 ? 'مدفوع جزئياً' : 'غير مدفوع');
    data.المبلغ_المضاف_للرصيد = paid;

    try {
        await saveData('rig', data);
        await processBalanceChange(paid, 'right_collection', `تحصيل: ${data.النوع} (${data.الجهة})`, data.clientId, isEditing,
            isEditing ? parseAmount(oldData.المبلغ_المضاف_للرصيد || 0) : 0);
        toastMsg(isEditing ? 'تم تعديل الحق ✏️' : 'تم إضافة الحق ✅', 'success');
        postSaveCleanup(isEditing, 'rig');
        updateDashboard();
    } catch (err) {
        toastMsg('فشل الحفظ.', 'error');
        console.error(err);
    }
}

// ============================================================
// DEBTS (OBLIGATIONS)
// ============================================================
function updateDebtFields(type, currentData = null) {
    const container = document.getElementById('dDynamicFields');
    const amountInput = document.getElementById('dAmount');
    const statusSelect = document.getElementById('dStatus');
    if (!container) return;
    container.innerHTML = '';

    const masterTypes = ['🏦 قرض', '👤 دين شخصي', '📊 تقسيط فواتيري'];

    if (masterTypes.includes(type)) {
        if (amountInput) { amountInput.style.display = 'none'; amountInput.value = ''; }
        if (statusSelect) { statusSelect.style.display = 'none'; statusSelect.value = ''; }

        const isLoanOrInstallment = (type === '🏦 قرض' || type === '📊 تقسيط فواتيري');
        let html = `
            <input id="dTotalAmount" type="text" placeholder="💵 المبلغ الكلي" oninput="formatAmount(this)" 
                   value="${currentData && currentData.المبلغ_الكلي_للالتزام ? parseAmount(currentData.المبلغ_الكلي_للالتزام).toLocaleString('ar') : ''}" />
            <span class="field-hint">المبلغ الكلي للالتزام</span>
        `;
        if (isLoanOrInstallment) {
            html += `
                <input id="dInstallments" type="number" placeholder="عدد الأقساط الكلي" value="${currentData && currentData.عدد_الاقساط ? currentData.عدد_الاقساط : ''}" />
                <input id="dPaidInstallments" type="number" placeholder="الأقساط المدفوعة" value="${currentData && currentData.الأقساط_المدفوعة ? currentData.الأقساط_المدفوعة : ''}" />
            `;
        } else {
            html += `
                <input id="dPaidAmount" type="text" placeholder="💰 إجمالي المدفوع" oninput="formatAmount(this)" 
                       value="${currentData && currentData.إجمالي_المدفوع ? parseAmount(currentData.إجمالي_المدفوع).toLocaleString('ar') : ''}" />
            `;
        }
        container.innerHTML = html;
    } else {
        if (amountInput) amountInput.style.display = 'block';
        if (statusSelect) statusSelect.style.display = 'block';
    }
}

async function addDebt() {
    const dType = document.getElementById('dType');
    const dAmount = document.getElementById('dAmount');
    const dEntity = document.getElementById('dEntity');
    const dDueDate = document.getElementById('dDueDate');
    const dDesc = document.getElementById('dDesc');
    const dStatus = document.getElementById('dStatus');

    if (!dType.value || !dDueDate.value) return toastMsg('أكمل البيانات المطلوبة', 'error');

    const isEditing = State.editMode && State.editMode.type === 'deb';
    const oldData = isEditing ? State.db.deb[State.editMode.index] : {};
    const masterTypes = ['🏦 قرض', '👤 دين شخصي', '📊 تقسيط فواتيري'];
    const isMaster = masterTypes.includes(dType.value);

    const data = isEditing ? { ...oldData } : {};
    data.clientId = isEditing ? oldData.clientId : `deb-${Date.now()}`;
    data.النوع = dType.value;
    data.الجهة = dEntity.value || '—';
    data.تاريخ_الاستحقاق = dDueDate.value;
    data.الوصف = dDesc.value || '—';

    let paidAmount = 0;

    if (isMaster) {
        const totalInput = document.getElementById('dTotalAmount');
        if (!totalInput || !totalInput.value) return toastMsg('الرجاء إدخال المبلغ الكلي.', 'error');
        const total = parseAmount(totalInput.value);
        if (total === 0) return toastMsg('المبلغ الكلي يجب أن يكون أكبر من صفر.', 'error');
        data.المبلغ_الكلي_للالتزام = formatNumber(total);

        let totalPaid = 0;
        const isLoanOrInstallment = (dType.value === '🏦 قرض' || dType.value === '📊 تقسيط فواتيري');

        if (isLoanOrInstallment) {
            const installmentsInput = document.getElementById('dInstallments');
            const paidInstallmentsInput = document.getElementById('dPaidInstallments');
            if (!installmentsInput || !installmentsInput.value) return toastMsg('أدخل عدد الأقساط.', 'error');
            const installments = parseInt(installmentsInput.value) || 0;
            const paidInstallments = parseInt(paidInstallmentsInput ? paidInstallmentsInput.value : 0) || 0;
            if (installments <= 0) return toastMsg('عدد الأقساط يجب أن يكون أكبر من صفر.', 'error');
            if (paidInstallments > installments) return toastMsg('الأقساط المدفوعة لا تتجاوز الكلي.', 'error');
            const installmentVal = total / installments;
            totalPaid = paidInstallments * installmentVal;
            data.عدد_الاقساط = installments;
            data.قيمة_القسط = formatNumber(installmentVal);
            data.الأقساط_المدفوعة = paidInstallments;
        } else {
            const paidInput = document.getElementById('dPaidAmount');
            if (paidInput) totalPaid = parseAmount(paidInput.value);
            if (totalPaid > total) return toastMsg('المدفوع لا يمكن أن يتجاوز المبلغ الكلي.', 'error');
        }
        data.إجمالي_المدفوع = formatNumber(totalPaid);
        data.المتبقي_للالتزام = formatNumber(total - totalPaid);
        data.المبلغ = '—';
        data.الحالة = (total - totalPaid) <= 0 ? 'مدفوع' : 'مدفوع جزئياً';
        paidAmount = totalPaid;
    } else {
        if (!dAmount.value || !dStatus.value) return toastMsg('أكمل بيانات الفاتورة.', 'error');
        const amt = parseAmount(dAmount.value);
        if (amt === 0) return toastMsg('المبلغ يجب أن يكون أكبر من صفر.', 'error');
        data.المبلغ = formatNumber(amt);
        data.الحالة = dStatus.value;
        paidAmount = (dStatus.value === 'مدفوع' || dStatus.value === 'مدفوع بالكامل') ? amt : 0;
        delete data.المبلغ_الكلي_للالتزام;
        delete data.إجمالي_المدفوع;
        delete data.المتبقي_للالتزام;
        delete data.عدد_الاقساط;
        delete data.قيمة_القسط;
        delete data.الأقساط_المدفوعة;
    }

    data.المبلغ_المخصوم_للرصيد = paidAmount;

    try {
        await saveData('deb', data);
        await processBalanceChange(paidAmount, 'debt_payment', `دفعة: ${data.النوع} (${data.الجهة})`, data.clientId, isEditing,
            isEditing ? parseAmount(oldData.المبلغ_المخصوم_للرصيد || 0) : 0);
        toastMsg(isEditing ? 'تم تعديل الالتزام ✏️' : 'تم إضافة الالتزام ✅', 'success');
        postSaveCleanup(isEditing, 'deb');
        updateDashboard();
    } catch (err) {
        toastMsg('فشل الحفظ.', 'error');
        console.error(err);
    }
}

// ============================================================
// BUDGETS
// ============================================================
async function addBudget() {
    const category = document.getElementById('budgetCategory');
    const amount = document.getElementById('budgetAmount');
    const period = document.getElementById('budgetPeriod');
    const desc = document.getElementById('budgetDesc');

    if (!category.value || !amount.value) {
        return toastMsg('أكمل البيانات المطلوبة', 'error');
    }

    const isEditing = State.editMode && State.editMode.type === 'budget';
    const oldData = isEditing ? State.db.budget[State.editMode.index] : {};
    const amt = parseAmount(amount.value);
    if (amt === 0) return toastMsg('المبلغ يجب أن يكون أكبر من صفر.', 'error');

    const data = isEditing ? { ...oldData } : {};
    data.clientId = isEditing ? oldData.clientId : `budget-${Date.now()}`;
    data.الفئة = category.value;
    data.المبلغ = amt;
    data.الفترة = period.value || 'monthly';
    data.الوصف = desc.value || '';
    data.تاريخ_الإنشاء = getToday();

    try {
        await saveData('budget', data);
        toastMsg(isEditing ? 'تم تعديل الميزانية ✏️' : 'تم إضافة الميزانية ✅', 'success');
        postSaveCleanup(isEditing, 'budget');
        renderBudgetList();
        updateDashboard();
    } catch (err) {
        toastMsg('فشل الحفظ.', 'error');
        console.error(err);
    }
}

function renderBudgetList() {
    const container = document.getElementById('budgetList');
    if (!container) return;
    const budgets = State.db.budget || [];
    if (!budgets.length) {
        container.innerHTML = '<p class="empty-state">لا توجد ميزانيات محفوظة</p>';
        return;
    }

    container.innerHTML = budgets.map(b => {
        const spent = getCategorySpending(b.الفئة);
        const percent = b.المبلغ > 0 ? Math.min((spent / b.المبلغ) * 100, 100) : 0;
        const status = percent < 70 ? 'ok' : (percent < 90 ? 'warning' : 'danger');
        const statusText = percent < 70 ? 'ضمن الحد' : (percent < 90 ? 'اقتربت من الحد' : 'تجاوزت الحد');

        return `
            <div class="budget-item">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:600;">${b.الفئة}</span>
                    <span>${formatCurrency(spent)} / ${formatCurrency(b.المبلغ)}</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill ${status}" style="width:${percent}%;"></div>
                    </div>
                    <div class="progress-text">
                        <span>${percent.toFixed(0)}%</span>
                        <span class="${status}">${statusText}</span>
                    </div>
                </div>
                <div class="budget-actions">
                    <button class="edit-btn" onclick="editBudget('${b.clientId}')"><i class="fas fa-edit"></i> تعديل</button>
                    <button class="delete-btn" onclick="deleteBudget('${b.clientId}')"><i class="fas fa-trash"></i> حذف</button>
                </div>
            </div>
        `;
    }).join('');
}

function getCategorySpending(category) {
    const expenses = State.db.exp || [];
    const monthRange = getMonthRange(new Date().getMonth(), new Date().getFullYear());
    let total = 0;
    for (const exp of expenses) {
        if (exp.الفئة === category && exp.التاريخ >= monthRange.start && exp.التاريخ <= monthRange.end) {
            total += parseAmount(exp.المبلغ);
        }
    }
    return total;
}

async function deleteBudget(id) {
    if (!confirm('هل أنت متأكد من حذف هذه الميزانية؟')) return;
    try {
        await deleteFromDB('budget', id);
        State.db.budget = State.db.budget.filter(b => b.clientId !== id);
        renderBudgetList();
        toastMsg('تم حذف الميزانية 🗑️', 'success');
    } catch (err) {
        toastMsg('فشل الحذف.', 'error');
        console.error(err);
    }
}

function editBudget(id) {
    const budget = State.db.budget.find(b => b.clientId === id);
    if (!budget) return;
    State.editMode = { type: 'budget', index: State.db.budget.indexOf(budget) };
    document.getElementById('budgetCategory').value = budget.الفئة;
    document.getElementById('budgetAmount').value = budget.المبلغ.toLocaleString('ar');
    document.getElementById('budgetPeriod').value = budget.الفترة || 'monthly';
    document.getElementById('budgetDesc').value = budget.الوصف || '';
    document.getElementById('budgetEditIndicator').style.display = 'inline-block';
    switchTab('planning');
    switchSubTab('planning', 'budgets');
}

// ============================================================
// GOALS
// ============================================================
async function addGoal() {
    const name = document.getElementById('goalName');
    const target = document.getElementById('goalTarget');
    const current = document.getElementById('goalCurrent');
    const date = document.getElementById('goalDate');
    const desc = document.getElementById('goalDesc');

    if (!name.value || !target.value) {
        return toastMsg('أكمل البيانات المطلوبة', 'error');
    }

    const isEditing = State.editMode && State.editMode.type === 'goal';
    const oldData = isEditing ? State.db.goal[State.editMode.index] : {};
    const targetAmt = parseAmount(target.value);
    if (targetAmt === 0) return toastMsg('المبلغ المستهدف يجب أن يكون أكبر من صفر.', 'error');

    const data = isEditing ? { ...oldData } : {};
    data.clientId = isEditing ? oldData.clientId : `goal-${Date.now()}`;
    data.الاسم = name.value;
    data.المبلغ_المستهدف = targetAmt;
    data.المبلغ_الحالي = parseAmount(current.value) || 0;
    data.تاريخ_الهدف = date.value || null;
    data.الوصف = desc.value || '';
    data.تاريخ_الإنشاء = getToday();
    data.الحالة = 'نشط';

    try {
        await saveData('goal', data);
        toastMsg(isEditing ? 'تم تعديل الهدف ✏️' : 'تم إضافة الهدف 🎯', 'success');
        postSaveCleanup(isEditing, 'goal');
        renderGoalList();
        updateDashboard();
    } catch (err) {
        toastMsg('فشل الحفظ.', 'error');
        console.error(err);
    }
}

function renderGoalList() {
    const container = document.getElementById('goalList');
    if (!container) return;
    const goals = State.db.goal || [];
    if (!goals.length) {
        container.innerHTML = '<p class="empty-state">لا توجد أهداف محفوظة</p>';
        return;
    }

    container.innerHTML = goals.map(g => {
        const percent = g.المبلغ_المستهدف > 0 ? Math.min((g.المبلغ_الحالي / g.المبلغ_المستهدف) * 100, 100) : 0;
        const remaining = g.المبلغ_المستهدف - g.المبلغ_الحالي;

        return `
            <div class="goal-item">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:600;">🎯 ${g.الاسم}</span>
                    <span>${formatCurrency(g.المبلغ_الحالي)} / ${formatCurrency(g.المبلغ_المستهدف)}</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill ${percent >= 100 ? 'ok' : 'warning'}" style="width:${Math.min(percent, 100)}%;"></div>
                    </div>
                    <div class="progress-text">
                        <span>${percent.toFixed(0)}%</span>
                        <span>المتبقي: ${formatCurrency(remaining)}</span>
                    </div>
                </div>
                ${g.تاريخ_الهدف ? `<div style="font-size:12px;color:var(--text-muted);">📅 ${formatDate(g.تاريخ_الهدف)}</div>` : ''}
                <div class="goal-actions">
                    <button class="contribute-btn" onclick="contributeToGoal('${g.clientId}')"><i class="fas fa-plus"></i> مساهمة</button>
                    <button class="edit-btn" onclick="editGoal('${g.clientId}')"><i class="fas fa-edit"></i> تعديل</button>
                    <button class="delete-btn" onclick="deleteGoal('${g.clientId}')"><i class="fas fa-trash"></i> حذف</button>
                </div>
            </div>
        `;
    }).join('');
}

async function contributeToGoal(id) {
    const goal = State.db.goal.find(g => g.clientId === id);
    if (!goal) return;
    const amount = prompt(`المبلغ الحالي: ${formatCurrency(goal.المبلغ_الحالي)}\nأدخل مبلغ المساهمة:`);
    if (amount === null) return;
    const contrib = parseAmount(amount);
    if (contrib <= 0) return toastMsg('المبلغ يجب أن يكون أكبر من صفر.', 'error');
    if (goal.المبلغ_الحالي + contrib > goal.المبلغ_المستهدف) {
        return toastMsg('لا يمكن أن يتجاوز المبلغ المستهدف.', 'error');
    }
    goal.المبلغ_الحالي += contrib;
    if (goal.المبلغ_الحالي >= goal.المبلغ_المستهدف) goal.الحالة = 'مكتمل';
    try {
        await saveData('goal', goal);
        renderGoalList();
        updateDashboard();
        toastMsg(`تمت إضافة مساهمة بقيمة ${formatCurrency(contrib)} 🎉`, 'success');
    } catch (err) {
        toastMsg('فشل إضافة المساهمة.', 'error');
        console.error(err);
    }
}

async function deleteGoal(id) {
    if (!confirm('هل أنت متأكد من حذف هذا الهدف؟')) return;
    try {
        await deleteFromDB('goal', id);
        State.db.goal = State.db.goal.filter(g => g.clientId !== id);
        renderGoalList();
        toastMsg('تم حذف الهدف 🗑️', 'success');
    } catch (err) {
        toastMsg('فشل الحذف.', 'error');
        console.error(err);
    }
}

function editGoal(id) {
    const goal = State.db.goal.find(g => g.clientId === id);
    if (!goal) return;
    State.editMode = { type: 'goal', index: State.db.goal.indexOf(goal) };
    document.getElementById('goalName').value = goal.الاسم;
    document.getElementById('goalTarget').value = goal.المبلغ_المستهدف.toLocaleString('ar');
    document.getElementById('goalCurrent').value = goal.المبلغ_الحالي.toLocaleString('ar');
    document.getElementById('goalDate').value = goal.تاريخ_الهدف || '';
    document.getElementById('goalDesc').value = goal.الوصف || '';
    document.getElementById('goalEditIndicator').style.display = 'inline-block';
    switchTab('planning');
    switchSubTab('planning', 'goals');
}

// ============================================================
// RECURRING TRANSACTIONS
// ============================================================
async function addRecurring() {
    const type = document.getElementById('recType');
    const amount = document.getElementById('recAmount');
    const desc = document.getElementById('recDesc');
    const frequency = document.getElementById('recFrequency');
    const startDate = document.getElementById('recStartDate');
    const endDate = document.getElementById('recEndDate');
    const category = document.getElementById('recCategory');

    if (!type.value || !amount.value || !startDate.value) {
        return toastMsg('أكمل البيانات المطلوبة', 'error');
    }

    const isEditing = State.editMode && State.editMode.type === 'recurring';
    const oldData = isEditing ? State.db.recurring[State.editMode.index] : {};
    const amt = parseAmount(amount.value);
    if (amt === 0) return toastMsg('المبلغ يجب أن يكون أكبر من صفر.', 'error');

    const data = isEditing ? { ...oldData } : {};
    data.clientId = isEditing ? oldData.clientId : `rec-${Date.now()}`;
    data.النوع = type.value;
    data.المبلغ = amt;
    data.الوصف = desc.value || '—';
    data.التكرار = frequency.value;
    data.تاريخ_البداية = startDate.value;
    data.تاريخ_النهاية = endDate.value || null;
    data.الفئة = category.value || '';
    data.الحالة = 'نشط';
    data.تاريخ_الإنشاء = getToday();

    try {
        await saveData('recurring', data);
        toastMsg(isEditing ? 'تم تعديل العملية المتكررة ✏️' : 'تم إضافة العملية المتكررة ✅', 'success');
        postSaveCleanup(isEditing, 'recurring');
        renderRecurringList();
    } catch (err) {
        toastMsg('فشل الحفظ.', 'error');
        console.error(err);
    }
}

function renderRecurringList() {
    const container = document.getElementById('recurringList');
    if (!container) return;
    const items = State.db.recurring || [];
    if (!items.length) {
        container.innerHTML = '<p class="empty-state">لا توجد عمليات متكررة</p>';
        return;
    }

    const typeLabels = { income: '💰 دخل', expense: '💸 مصروف', debt: '🧾 التزام' };
    const freqLabels = { daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', yearly: 'سنوي' };

    container.innerHTML = items.map(r => `
        <div class="recurring-item">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;">${typeLabels[r.النوع] || r.النوع}</span>
                <span>${formatCurrency(r.المبلغ)}</span>
            </div>
            <div style="font-size:13px;color:var(--text-muted);">
                ${r.الوصف} · ${freqLabels[r.التكرار] || r.التكرار}
                ${r.تاريخ_البداية ? ` · من ${formatDateShort(r.تاريخ_البداية)}` : ''}
                ${r.تاريخ_النهاية ? ` إلى ${formatDateShort(r.تاريخ_النهاية)}` : ''}
                ${r.الفئة ? ` · ${r.الفئة}` : ''}
                <span style="color:${r.الحالة === 'نشط' ? 'var(--success)' : 'var(--danger)'};">
                    ${r.الحالة === 'نشط' ? '🟢 نشط' : '🔴 متوقف'}
                </span>
            </div>
            <div class="recurring-actions">
                <button class="toggle-btn" onclick="toggleRecurring('${r.clientId}')">
                    <i class="fas ${r.الحالة === 'نشط' ? 'fa-pause' : 'fa-play'}"></i> ${r.الحالة === 'نشط' ? 'إيقاف' : 'تشغيل'}
                </button>
                <button class="edit-btn" onclick="editRecurring('${r.clientId}')"><i class="fas fa-edit"></i> تعديل</button>
                <button class="delete-btn" onclick="deleteRecurring('${r.clientId}')"><i class="fas fa-trash"></i> حذف</button>
            </div>
        </div>
    `).join('');
}

async function toggleRecurring(id) {
    const item = State.db.recurring.find(r => r.clientId === id);
    if (!item) return;
    item.الحالة = item.الحالة === 'نشط' ? 'متوقف' : 'نشط';
    try {
        await saveData('recurring', item);
        renderRecurringList();
        toastMsg(item.الحالة === 'نشط' ? 'تم تشغيل العملية 🔄' : 'تم إيقاف العملية ⏸️', 'info');
    } catch (err) {
        toastMsg('فشل التحديث.', 'error');
        console.error(err);
    }
}

async function deleteRecurring(id) {
    if (!confirm('هل أنت متأكد من حذف هذه العملية المتكررة؟')) return;
    try {
        await deleteFromDB('recurring', id);
        State.db.recurring = State.db.recurring.filter(r => r.clientId !== id);
        renderRecurringList();
        toastMsg('تم الحذف 🗑️', 'success');
    } catch (err) {
        toastMsg('فشل الحذف.', 'error');
        console.error(err);
    }
}

function editRecurring(id) {
    const item = State.db.recurring.find(r => r.clientId === id);
    if (!item) return;
    State.editMode = { type: 'recurring', index: State.db.recurring.indexOf(item) };
    document.getElementById('recType').value = item.النوع;
    document.getElementById('recAmount').value = item.المبلغ.toLocaleString('ar');
    document.getElementById('recDesc').value = item.الوصف || '';
    document.getElementById('recFrequency').value = item.التكرار;
    document.getElementById('recStartDate').value = item.تاريخ_البداية || '';
    document.getElementById('recEndDate').value = item.تاريخ_النهاية || '';
    document.getElementById('recCategory').value = item.الفئة || '';
    document.getElementById('recurringEditIndicator').style.display = 'inline-block';
    switchTab('planning');
    switchSubTab('planning', 'recurring');
}

// ============================================================
// POST SAVE CLEANUP
// ============================================================
function postSaveCleanup(isEditing, type) {
    closeLayer('detail');
    if (document.getElementById('logModal').style.display === 'flex') {
        closeLayer('log');
    }
    loadAllData().then(() => {
        updateAllUI();
    });
    State.editMode = null;
    clearFields();
}

function clearFields() {
    const ids = [
        'incAmount', 'incCategory', 'incSource', 'incDate', 'incDesc',
        'eAmount', 'eCategory', 'eDesc', 'eDate',
        'rAmount', 'rType', 'rEntity', 'rDueDate', 'rDesc',
        'dAmount', 'dType', 'dEntity', 'dDueDate', 'dDesc', 'dStatus',
        'budgetCategory', 'budgetAmount', 'budgetPeriod', 'budgetDesc',
        'goalName', 'goalTarget', 'goalCurrent', 'goalDate', 'goalDesc',
        'recType', 'recAmount', 'recDesc', 'recFrequency', 'recStartDate', 'recEndDate', 'recCategory'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.querySelectorAll('.edit-indicator').forEach(el => el.style.display = 'none');
    document.getElementById('rDynamicFields').innerHTML = '';
    document.getElementById('dDynamicFields').innerHTML = '';
    clearSelectedImage();
}

// ============================================================
// IMAGE FUNCTIONS
// ============================================================
function showImageSourceModal() { openLayer('imageSource'); }
function closeImageSource() { closeLayer('imageSource'); }

function openCameraInput() {
    closeImageSource();
    const input = document.getElementById('eImgCamera');
    if (input) { input.value = null; input.setAttribute('capture', 'environment'); input.click(); }
}

function openGalleryInput() {
    closeImageSource();
    const input = document.getElementById('eImgGallery');
    if (input) { input.value = null; input.removeAttribute('capture'); input.click(); }
}

function handleImageSelect(input) {
    if (input.files && input.files.length > 0) {
        const file = input.files[0];
        State.selectedImageFile = file;
        document.getElementById('eImgName').textContent = `✅ ${file.name}`;
        const reader = new FileReader();
        reader.onload = (e) => { State.selectedImageFile = e.target.result; };
        reader.readAsDataURL(file);
    } else {
        document.getElementById('eImgName').textContent = '';
        State.selectedImageFile = null;
    }
}

function getSelectedImage() { return State.selectedImageFile; }
function clearSelectedImage() {
    State.selectedImageFile = null;
    document.getElementById('eImgName').textContent = '';
    document.getElementById('eImgCamera').value = null;
    document.getElementById('eImgGallery').value = null;
}

// ============================================================
// EXPORT / IMPORT
// ============================================================
function openExportNameModal() { openLayer('exportName'); }

function performExport() {
    const fileName = document.getElementById('exportFileName').value.trim();
    if (!fileName) { toastMsg('الرجاء إدخال اسم الملف', 'error'); return; }
    closeLayer('exportName');

    const data = {
        exp: State.db.exp,
        inc: State.db.inc,
        rig: State.db.rig,
        deb: State.db.deb,
        bal: State.db.bal,
        budget: State.db.budget,
        goal: State.db.goal,
        recurring: State.db.recurring,
        currency: getCurrency(),
        exportDate: new Date().toISOString(),
        version: CONFIG.APP_VERSION
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
    toastMsg('تم تصدير البيانات بنجاح! 📤', 'success');
}

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!confirm('تحذير: سيتم دمج البيانات المستوردة مع بياناتك الحالية.')) {
        event.target.value = null;
        return;
    }

    showLoading('جاري استيراد البيانات...');
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const imported = JSON.parse(e.target.result);

            if (imported.bal && Array.isArray(imported.bal.changes)) {
                imported.bal.clientId = 1;
                await addDataToStore('bal', [imported.bal]);
            }
            for (const sn of ['exp', 'inc', 'rig', 'deb', 'budget', 'goal', 'recurring']) {
                if (imported[sn] && Array.isArray(imported[sn])) {
                    await addDataToStore(sn, imported[sn]);
                }
            }
            if (imported.currency) {
                setCurrency(imported.currency.code);
            }

            await loadAllData();
            hideLoading();
            updateAllUI();
            toastMsg('تم استيراد البيانات بنجاح! 📥', 'success');
        } catch (err) {
            hideLoading();
            toastMsg('فشل الاستيراد. تأكد من صيغة الملف.', 'error');
            console.error(err);
        } finally {
            event.target.value = null;
        }
    };
    reader.readAsText(file);
}

async function addDataToStore(storeName, dataArray) {
    if (!State.connection) return;
    const tx = State.connection.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of dataArray) {
        await new Promise(resolve => {
            if (storeName === 'bal') { store.put(item).onsuccess = resolve; }
            else {
                const toSave = { ...item };
                delete toSave.id;
                toSave.clientId = item.clientId || `${storeName}-${Date.now()}`;
                store.add(toSave).onsuccess = resolve;
            }
        });
    }
}

// ============================================================
// LOG & DETAIL RENDERING
// ============================================================
function openLog(type) {
    State.currentLog = type;
    openLayer('log', { logType: type });
}

function renderLog() {
    const el = document.getElementById('logContent');
    if (!el) return;
    const items = State.db[State.currentLog] || [];
    const search = document.getElementById('search');
    const query = search?.value?.toLowerCase() || '';
    const filtered = items.filter(i => Object.values(i).some(v => String(v).toLowerCase().includes(query)));

    if (!filtered.length) {
        el.innerHTML = '<p class="empty-state">لا توجد معاملات.</p>';
        return;
    }

    const typeLabels = {
        exp: { label: 'مصروف', icon: 'fa-arrow-down', color: 'var(--danger)' },
        inc: { label: 'دخل', icon: 'fa-arrow-up', color: 'var(--success)' },
        rig: { label: 'حق', icon: 'fa-hand-holding-heart', color: 'var(--warning)' },
        deb: { label: 'التزام', icon: 'fa-file-invoice', color: '#e67e22' },
        budget: { label: 'ميزانية', icon: 'fa-chart-pie', color: 'var(--p)' },
        goal: { label: 'هدف', icon: 'fa-bullseye', color: '#8b5cf6' },
        recurring: { label: 'عملية متكررة', icon: 'fa-repeat', color: 'var(--s)' }
    };

    el.innerHTML = filtered.map(item => {
        const typeInfo = typeLabels[State.currentLog] || { label: '', icon: 'fa-file', color: 'var(--s)' };
        const amount = parseAmount(item.المبلغ || item.المبلغ_الكلي_للالتزام || 0);
        const desc = item.الوصف || item.الفئة || item.النوع || item.الاسم || '—';
        const date = item.التاريخ || item.تاريخ_الاستحقاق || item.تاريخ_الهدف || item.تاريخ_الإنشاء || '';
        const id = item.clientId || item.id;

        return `
            <div class="log-item" style="border-right-color:${typeInfo.color};" onclick="showDetail('${id}','${State.currentLog}')">
                <div class="log-header">
                    <span><i class="fas ${typeInfo.icon}" style="color:${typeInfo.color};"></i> ${desc}</span>
                    <span style="color:${typeInfo.color};">${formatCurrency(amount)}</span>
                </div>
                <div class="log-details">
                    <span>${typeInfo.label}</span>
                    <span>${formatDate(date)}</span>
                </div>
                <div class="log-hint"><i class="fas fa-hand-pointer"></i> اضغط للتفاصيل</div>
            </div>
        `;
    }).join('');
}

function showDetail(id, type) {
    const store = State.db[type];
    const item = store.find(entry => entry.clientId === id || entry.id === id);
    if (!item) { toastMsg('لم نعثر على هذه المعاملة', 'error'); return; }
    const index = store.findIndex(entry => entry.clientId === id || entry.id === id);
    if (index === -1) { toastMsg('خطأ في تحديد المعاملة', 'error'); return; }
    openLayer('detail', { logType: type, id: id });
    State.editMode = { type: type, index: index };
}

function renderDetail(item, type) {
    const el = document.getElementById('detailContent');
    if (!el) return;

    let html = `<div class="card"><h3 style="margin-top:0;"><i class="fas fa-info-circle"></i> التفاصيل</h3>`;
    for (const [key, val] of Object.entries(item)) {
        if (['id', 'clientId', 'صورة', 'المبلغ_المضاف_للرصيد', 'المبلغ_المخصوم_للرصيد'].includes(key)) continue;
        if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '' && key !== 'الوصف')) continue;
        const isAmt = key.includes('المبلغ') || key.includes('المدفوع') || key.includes('المتبقي') ||
                      key.includes('القسط') || key.includes('إجمالي') || key.includes('الحالي') || key.includes('المستهدف');
        const display = isAmt ? formatCurrency(val, true) : val;
        const label = key.replace(/_/g, ' ');
        html += `<p style="margin:6px 0;"><strong>${label}:</strong> <span>${display}</span></p>`;
    }
    html += `</div>`;

    if (item.صورة && type === 'exp') {
        html += `
            <div class="card" style="border-top-color:var(--s);">
                <h3 style="margin-top:0;"><i class="fas fa-image"></i> صورة الفاتورة</h3>
                <img src="${item.صورة}" alt="الفاتورة" style="width:100%;border-radius:10px;margin-top:10px;" />
            </div>
        `;
    }

    html += `
        <div style="display:flex;gap:10px;margin-top:10px;">
            <button class="secondary" onclick="editTransaction()" style="flex:1;"><i class="fas fa-edit"></i> تعديل</button>
            <button class="action" onclick="deleteTransaction()" style="background:var(--danger);flex:1;"><i class="fas fa-trash"></i> حذف</button>
        </div>
    `;
    el.innerHTML = html;
}

function editTransaction() {
    if (!State.editMode) return;
    const type = State.editMode.type;
    const data = State.db[type][State.editMode.index];

    closeLayer('detail');
    if (document.getElementById('logModal').style.display === 'flex') closeLayer('log');

    // التوجيه للقسم المناسب مع تعبئة الحقول
    const map = {
        inc: { tab: 'money', sub: 'income', fields: { amount: 'incAmount', category: 'incCategory', source: 'incSource', date: 'incDate', desc: 'incDesc' } },
        exp: { tab: 'money', sub: 'expenses', fields: { amount: 'eAmount', category: 'eCategory', date: 'eDate', desc: 'eDesc' } },
        rig: { tab: 'rights-debts', sub: 'rights', fields: { amount: 'rAmount', type: 'rType', entity: 'rEntity', date: 'rDueDate', desc: 'rDesc' } },
        deb: { tab: 'rights-debts', sub: 'debts', fields: { amount: 'dAmount', type: 'dType', entity: 'dEntity', date: 'dDueDate', desc: 'dDesc', status: 'dStatus' } },
        budget: { tab: 'planning', sub: 'budgets', fields: { category: 'budgetCategory', amount: 'budgetAmount', period: 'budgetPeriod', desc: 'budgetDesc' } },
        goal: { tab: 'planning', sub: 'goals', fields: { name: 'goalName', target: 'goalTarget', current: 'goalCurrent', date: 'goalDate', desc: 'goalDesc' } },
        recurring: { tab: 'planning', sub: 'recurring', fields: { type: 'recType', amount: 'recAmount', desc: 'recDesc', frequency: 'recFrequency', start: 'recStartDate', end: 'recEndDate', category: 'recCategory' } }
    };

    const info = map[type];
    if (!info) return;

    switchTab(info.tab);
    switchSubTab(info.tab, info.sub);

    setTimeout(() => {
        const f = info.fields;
        if (f.amount) document.getElementById(f.amount).value = parseAmount(data.المبلغ || data.المبلغ_الكلي_للالتزام || 0).toLocaleString('ar');
        if (f.category) document.getElementById(f.category).value = data.الفئة || '';
        if (f.source) document.getElementById(f.source).value = data.المصدر || '';
        if (f.date) document.getElementById(f.date).value = data.التاريخ || data.تاريخ_الاستحقاق || data.تاريخ_الهدف || '';
        if (f.desc) document.getElementById(f.desc).value = data.الوصف || '';
        if (f.type) document.getElementById(f.type).value = data.النوع || '';
        if (f.entity) document.getElementById(f.entity).value = data.الجهة || '';
        if (f.status) document.getElementById(f.status).value = data.الحالة || '';
        if (f.period) document.getElementById(f.period).value = data.الفترة || 'monthly';
        if (f.name) document.getElementById(f.name).value = data.الاسم || '';
        if (f.target) document.getElementById(f.target).value = data.المبلغ_المستهدف ? data.المبلغ_المستهدف.toLocaleString('ar') : '';
        if (f.current) document.getElementById(f.current).value = data.المبلغ_الحالي ? data.المبلغ_الحالي.toLocaleString('ar') : '';
        if (f.start) document.getElementById(f.start).value = data.تاريخ_البداية || '';
        if (f.end) document.getElementById(f.end).value = data.تاريخ_النهاية || '';
        if (f.frequency) document.getElementById(f.frequency).value = data.التكرار || 'monthly';

        // تحديث الحقول الديناميكية للحقوق والالتزامات
        if (type === 'rig') updateRightFields(data.النوع, data);
        if (type === 'deb') updateDebtFields(data.النوع, data);

        // إظهار مؤشر التعديل
        const indicatorMap = {
            inc: 'incEditIndicator', exp: 'expEditIndicator',
            rig: 'rigEditIndicator', deb: 'debEditIndicator',
            budget: 'budgetEditIndicator', goal: 'goalEditIndicator',
            recurring: 'recurringEditIndicator'
        };
        const ind = document.getElementById(indicatorMap[type]);
        if (ind) ind.style.display = 'inline-block';
    }, 150);
}

async function deleteTransaction() {
    if (!State.editMode) return;
    if (!confirm('هل أنت متأكد من حذف هذه المعاملة؟')) return;

    const type = State.editMode.type;
    const item = State.db[type][State.editMode.index];
    const id = item.id || item.clientId;

    try {
        await deleteFromDB(type, id);
        if (item.clientId) {
            const idx = State.db.bal.changes.findIndex(c => c.id === item.clientId);
            if (idx > -1) {
                const oldNet = State.db.bal.changes[idx].القيمة_الصافية;
                State.db.bal.changes.splice(idx, 1);
                State.currentBalance -= oldNet;
                State.db.bal.amount = State.currentBalance;
                await saveData('bal', State.db.bal);
            }
        }
        await loadAllData();
        updateAllUI();
        toastMsg('تم الحذف بنجاح 🗑️', 'success');
        closeLayer('detail');
        closeLayer('log');
    } catch (err) {
        toastMsg('فشل الحذف.', 'error');
        console.error(err);
    }
}

// ============================================================
// CALENDAR
// ============================================================
function renderCalendar() {
    const monthYear = document.getElementById('calendarMonthYear');
    const grid = document.getElementById('calendarGrid');
    if (!monthYear || !grid) return;

    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    monthYear.textContent = `${monthNames[State.calendarMonth]} ${State.calendarYear}`;

    const firstDay = new Date(State.calendarYear, State.calendarMonth, 1).getDay();
    const daysInMonth = new Date(State.calendarYear, State.calendarMonth + 1, 0).getDate();
    const today = new Date();

    // أيام الأسبوع
    const dayNames = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
    let html = dayNames.map(d => `<div class="day-name">${d}</div>`).join('');

    // أيام فارغة
    const startOffset = (firstDay + 1) % 7;
    for (let i = 0; i < startOffset; i++) {
        html += `<div class="day empty"></div>`;
    }

    // أيام الشهر
    const events = getMonthEvents(State.calendarMonth, State.calendarYear);
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${State.calendarYear}-${String(State.calendarMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday = today.getFullYear() === State.calendarYear &&
                        today.getMonth() === State.calendarMonth &&
                        today.getDate() === d;
        const hasEvent = events.some(e => e.date === dateStr);
        const classes = ['day'];
        if (isToday) classes.push('today');
        if (hasEvent) classes.push('has-event');
        html += `<div class="${classes.join(' ')}" onclick="showDayEvents('${dateStr}')">${d}</div>`;
    }

    grid.innerHTML = html;
    document.getElementById('calendarEvents').innerHTML = '';
}

function getMonthEvents(month, year) {
    const events = [];
    const dateStr = (d) => `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const types = [
        { key: 'exp', label: 'مصروف', icon: 'fa-arrow-down', color: 'var(--danger)' },
        { key: 'inc', label: 'دخل', icon: 'fa-arrow-up', color: 'var(--success)' },
        { key: 'rig', label: 'حق', icon: 'fa-hand-holding-heart', color: 'var(--warning)' },
        { key: 'deb', label: 'التزام', icon: 'fa-file-invoice', color: '#e67e22' }
    ];

    for (const t of types) {
        const items = State.db[t.key] || [];
        for (const item of items) {
            const date = item.التاريخ || item.تاريخ_الاستحقاق;
            if (date) {
                const d = new Date(date);
                if (d.getMonth() === month && d.getFullYear() === year) {
                    events.push({
                        date: date,
                        label: t.label,
                        icon: t.icon,
                        color: t.color,
                        desc: item.الوصف || item.الفئة || item.النوع || '—',
                        amount: parseAmount(item.المبلغ || item.المبلغ_الكلي_للالتزام || 0)
                    });
                }
            }
        }
    }
    return events;
}

function showDayEvents(dateStr) {
    const container = document.getElementById('calendarEvents');
    if (!container) return;
    const events = getMonthEvents(State.calendarMonth, State.calendarYear).filter(e => e.date === dateStr);

    if (!events.length) {
        container.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:10px 0;">لا توجد عمليات في هذا اليوم</p>`;
        return;
    }

    container.innerHTML = `
        <div style="font-weight:600;margin-bottom:8px;">📅 عمليات ${formatDate(dateStr)}</div>
        ${events.map(e => `
            <div class="calendar-event-item">
                <span><i class="fas ${e.icon}" style="color:${e.color};"></i> ${e.desc}</span>
                <span style="color:${e.color};">${formatCurrency(e.amount)}</span>
            </div>
        `).join('')}
    `;
}

function changeMonth(delta) {
    State.calendarMonth += delta;
    if (State.calendarMonth < 0) { State.calendarMonth = 11; State.calendarYear--; }
    if (State.calendarMonth > 11) { State.calendarMonth = 0; State.calendarYear++; }
    renderCalendar();
}

// ============================================================
// CURRENCY MODAL
// ============================================================
function openCurrencyModal() { openLayer('currency'); }

function renderCurrencyList() {
    const list = document.getElementById('currencyList');
    if (!list) return;
    const q = document.getElementById('currencySearch')?.value?.toLowerCase() || '';
    const filtered = CURRENCIES.filter(c =>
        c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
    const current = getCurrency();
    list.innerHTML = filtered.map(c => `
        <button onclick="selectCurrency('${c.code}')">
            <span><strong>${c.symbol}</strong> ${c.name} (${c.code})</span>
            ${c.code === current.code ? '<span class="check"><i class="fas fa-check" style="color:var(--success);"></i></span>' : ''}
        </button>
    `).join('');
}

function selectCurrency(code) {
    setCurrency(code);
    closeLayer('currency');
}

// ============================================================
// DARK MODE
// ============================================================
function loadDarkMode() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        document.getElementById('darkModeToggle').checked = true;
    }
}

function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDark);
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = isDark;
    toastMsg(isDark ? 'تم التبديل للوضع الليلي 🌙' : 'تم التبديل للوضع النهاري ☀️', 'info');
}

// ============================================================
// RESET DATA
// ============================================================
function confirmResetData() {
    closeLayer('sidebar');
    if (!confirm('تحذير: هل أنت متأكد من حذف جميع البيانات؟ لا يمكن التراجع.')) return;
    if (!confirm('تأكيد نهائي: هل تريد حذف كل شيء؟')) return;
    resetAllData();
}

async function resetAllData() {
    if (!State.connection) return toastMsg('لا يمكن الاتصال بقاعدة البيانات.', 'error');
    const tx = State.connection.transaction(CONFIG.STORE_NAMES, 'readwrite');
    let done = 0;
    CONFIG.STORE_NAMES.forEach(sn => {
        const req = tx.objectStore(sn).clear();
        req.onsuccess = () => {
            done++;
            if (done === CONFIG.STORE_NAMES.length) {
                State.db.exp = State.db.rig = State.db.deb = State.db.inc = [];
                State.db.budget = State.db.goal = State.db.recurring = [];
                State.db.bal = { clientId: 1, amount: 0, changes: [] };
                State.currentBalance = 0;
                saveData('bal', State.db.bal).then(() => {
                    loadAllData().then(() => {
                        updateAllUI();
                        toastMsg('تم حذف جميع البيانات! 🗑️', 'success');
                    });
                });
            }
        };
        req.onerror = () => toastMsg('فشل حذف البيانات.', 'error');
    });
}

// ============================================================
// GOOGLE DRIVE
// ============================================================
let tokenClient = null;
let accessToken = null;
let isDriveConnected = false;
let backupFiles = [];
let userEmail = '';
let appFolderId = null;
let tokenRefreshInterval = null;

function initDrive() {
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
            setTimeout(() => { if (accessToken) loadBackupList(); }, 1000);
        }
    }
}

function initDriveAPIs() {
    // تهيئة GAPI
    if (typeof gapi !== 'undefined') {
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: '',
                    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
                });
                console.log('Google API loaded');
                initDrive();
            } catch (error) {
                console.error('Error loading GAPI:', error);
            }
        });
    }

    // تهيئة GIS
    if (typeof google !== 'undefined' && google.accounts) {
        try {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CONFIG.CLIENT_ID,
                scope: CONFIG.SCOPES,
                callback: async (resp) => {
                    if (resp.error) {
                        console.error('Auth error:', resp.error);
                        toastMsg('فشل تسجيل الدخول: ' + resp.error, 'error');
                        return;
                    }
                    accessToken = resp.access_token;
                    localStorage.setItem('drive_token', accessToken);
                    localStorage.setItem('drive_token_expiry', Date.now() + 3600 * 1000);

                    try {
                        const userInfo = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        const userData = await userInfo.json();
                        userEmail = userData.email || '';
                        localStorage.setItem('drive_email', userEmail);

                        await createAppFolder();
                        isDriveConnected = true;
                        updateDriveUI();
                        startTokenRefresh();
                        toastMsg('تم ربط حساب Google Drive ✅', 'success');
                        await loadBackupList();
                        if (document.getElementById('confirmBackupModal').style.display === 'flex') {
                            closeLayer('confirmBackup');
                        }
                        openLayer('driveBackup');
                    } catch (e) {
                        console.error('Error getting user info:', e);
                        toastMsg('حدث خطأ في تسجيل الدخول', 'error');
                    }
                }
            });
            console.log('GIS loaded');
        } catch (error) {
            console.error('Error initializing GIS:', error);
        }
    }
}

function startTokenRefresh() {
    if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = setInterval(() => {
        if (isDriveConnected && accessToken && tokenClient) {
            try { tokenClient.requestAccessToken({ prompt: '' }); } catch (e) {}
        }
    }, 50 * 60 * 1000);
}

async function createAppFolder() {
    if (!accessToken) return;
    try {
        const search = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name='${CONFIG.APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        const result = await search.json();
        if (result.files && result.files.length > 0) {
            appFolderId = result.files[0].id;
            localStorage.setItem('drive_folder_id', appFolderId);
            return;
        }
        const create = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: CONFIG.APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
        });
        const folder = await create.json();
        appFolderId = folder.id;
        localStorage.setItem('drive_folder_id', appFolderId);
        toastMsg('تم إنشاء مجلد التطبيق في Drive 📁', 'success');
    } catch (error) {
        console.error('Error creating folder:', error);
        toastMsg('فشل إنشاء مجلد التطبيق', 'error');
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
    if (isDriveConnected) {
        closeLayer('confirmBackup');
        performBackup();
        return;
    }
    if (!tokenClient) { toastMsg('جاري تحميل خدمة المصادقة...', 'info'); return; }
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleViewBackups() {
    closeLayer('confirmBackup');
    if (isDriveConnected) {
        openLayer('driveBackup');
        return;
    }
    if (!tokenClient) { toastMsg('جاري تحميل خدمة المصادقة...', 'info'); return; }
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleDriveBackup() {
    if (!isDriveConnected) { toastMsg('الرجاء ربط حساب Google Drive أولاً', 'error'); return; }
    performBackup();
}

function signOutDrive() {
    if (!confirm('هل تريد تسجيل الخروج من Google Drive؟')) return;
    if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
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
    toastMsg('تم تسجيل الخروج من Google Drive', 'info');
}

function updateDriveUI() {
    const status = document.getElementById('driveModalStatus');
    const dot = document.getElementById('driveStatusDotSettings');
    const userStatus = document.getElementById('driveUserStatus');
    const userEmailEl = document.getElementById('driveUserEmail');

    if (status) {
        status.className = 'status ' + (isDriveConnected ? 'connected' : 'disconnected');
        status.textContent = isDriveConnected ? '✅ متصل' : '❌ غير متصل';
    }
    if (dot) {
        dot.style.background = isDriveConnected ? 'var(--success)' : '#999';
    }
    if (userStatus) {
        userStatus.textContent = isDriveConnected ? '✅ متصل' : '❌ غير متصل';
    }
    if (userEmailEl) {
        userEmailEl.textContent = isDriveConnected ? userEmail : '';
    }
}

function openDriveBackupModal() { openLayer('driveBackup'); }

async function loadBackupList() {
    if (!accessToken || !appFolderId) {
        backupFiles = [];
        renderDriveBackupList();
        return;
    }
    try {
        const search = await fetch(
            `https://www.googleapis.com/drive/v3/files?q='${appFolderId}' in parents and trashed=false and (mimeType='application/json' or name contains '.json')&fields=files(id,name,size,createdTime)&orderBy=createdTime desc`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        const result = await search.json();
        backupFiles = result.files || [];
        renderDriveBackupList();
    } catch (error) {
        console.error('Error loading backup list:', error);
        toastMsg('فشل تحميل قائمة النسخ الاحتياطية', 'error');
    }
}

function renderDriveBackupList() {
    const container = document.getElementById('driveBackupList');
    const countEl = document.getElementById('driveBackupCount');
    if (!container) return;

    if (!isDriveConnected) {
        container.innerHTML = `<div class="drive-empty"><i class="fab fa-google-drive"></i><p>ربط حساب Google Drive لعرض النسخ</p></div>`;
        if (countEl) countEl.textContent = 'عدد النسخ : 0';
        return;
    }

    if (!backupFiles.length) {
        container.innerHTML = `<div class="drive-empty"><i class="fas fa-cloud-upload-alt"></i><p>لا توجد نسخ احتياطية</p></div>`;
        if (countEl) countEl.textContent = 'عدد النسخ : 0';
        return;
    }

    // ترتيب وعرض النسخ
    const sorted = [...backupFiles].sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
    const filesWithNumbers = sorted.map((f, i) => ({ ...f, number: i + 1 }));
    const display = [...filesWithNumbers].reverse();

    let html = `
        <table class="backup-table">
            <thead><tr>
                <th>اسم النسخة</th>
                <th>التاريخ</th>
                <th>الحجم</th>
                <th style="text-align:left;">الإجراءات</th>
            </tr></thead>
            <tbody>
    `;

    display.forEach(f => {
        const date = new Date(f.createdTime);
        const formatted = date.toLocaleString('ar-EG', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
        const size = f.size ? (parseInt(f.size) / 1024).toFixed(1) + 'KB' : 'غير معروف';
        html += `
            <tr>
                <td class="file-name">النسخة رقم ${f.number}</td>
                <td>${formatted}</td>
                <td class="file-size">${size}</td>
                <td>
                    <div class="file-actions">
                        <button class="restore-btn" onclick="restoreBackup('${f.id}')" title="استعادة"><i class="fas fa-download"></i></button>
                        <button class="delete-btn" onclick="deleteBackup('${f.id}')" title="حذف"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
    if (countEl) countEl.textContent = `عدد النسخ : ${backupFiles.length}`;
}

function refreshBackupList() { loadBackupList(); toastMsg('جاري تحديث القائمة...', 'info'); }

async function performBackup() {
    if (!accessToken || !appFolderId) { toastMsg('الرجاء ربط حساب Google Drive أولاً', 'error'); return; }
    showLoading('جاري حفظ النسخة الاحتياطية...');

    try {
        const data = {
            exp: State.db.exp,
            inc: State.db.inc,
            rig: State.db.rig,
            deb: State.db.deb,
            bal: State.db.bal,
            budget: State.db.budget,
            goal: State.db.goal,
            recurring: State.db.recurring,
            currency: getCurrency(),
            backupDate: new Date().toISOString(),
            version: CONFIG.APP_VERSION
        };

        const backupNumber = backupFiles.length + 1;
        const fileName = `${CONFIG.BACKUP_PREFIX} ${backupNumber}.json`;
        const jsonData = JSON.stringify(data, null, 2);
        const fileData = new Blob([jsonData], { type: 'application/json' });

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify({ name: fileName, parents: [appFolderId], mimeType: 'application/json' })], { type: 'application/json' }));
        form.append('file', fileData);

        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: form
        });

        if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
        hideLoading();
        toastMsg(`تم حفظ النسخة رقم ${backupNumber} بنجاح 💾`, 'success');
        await loadBackupList();
        renderDriveBackupList();
        if (document.getElementById('driveBackupModal').style.display !== 'flex') openLayer('driveBackup');
    } catch (error) {
        hideLoading();
        console.error('Error uploading backup:', error);
        toastMsg('فشل حفظ النسخة الاحتياطية: ' + error.message, 'error');
    }
}

async function restoreBackup(fileId) {
    if (!confirm('⚠️ هل أنت متأكد من استعادة هذه النسخة؟ سيتم استبدال جميع البيانات الحالية.')) return;
    showLoading('جاري استعادة البيانات...');

    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!response.ok) throw new Error(`Failed to download: ${response.status}`);

        const text = await response.text();
        const imported = JSON.parse(text);

        if (imported.bal && Array.isArray(imported.bal.changes)) {
            imported.bal.clientId = 1;
            await addDataToStore('bal', [imported.bal]);
        }
        for (const sn of ['exp', 'inc', 'rig', 'deb', 'budget', 'goal', 'recurring']) {
            if (imported[sn] && Array.isArray(imported[sn])) {
                await addDataToStore(sn, imported[sn]);
            }
        }
        if (imported.currency) setCurrency(imported.currency.code);

        await loadAllData();
        hideLoading();
        updateAllUI();
        toastMsg('تم استعادة البيانات بنجاح 🔄', 'success');
        await loadBackupList();
        renderDriveBackupList();
    } catch (error) {
        hideLoading();
        console.error('Error restoring backup:', error);
        toastMsg('فشل استعادة النسخة: ' + error.message, 'error');
    }
}

async function deleteBackup(fileId) {
    if (!confirm('هل أنت متأكد من حذف هذه النسخة الاحتياطية؟')) return;
    try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        toastMsg('تم حذف النسخة الاحتياطية 🗑️', 'success');
        await loadBackupList();
        renderDriveBackupList();
    } catch (error) {
        console.error('Error deleting backup:', error);
        toastMsg('فشل حذف النسخة: ' + error.message, 'error');
    }
}

// ============================================================
// UPDATE UI
// ============================================================
function updateAllUI() {
    updateBalanceDisplay();
    updateDashboard();
    updateStats();
    renderBudgetList();
    renderGoalList();
    renderRecurringList();
    renderCalendar();
}

function updateDashboard() {
    updateStats();
    updateRecentTransactions();
    updateAlerts();
    updateAssistant();
}

function updateStats() {
    const monthRange = getMonthRange(new Date().getMonth(), new Date().getFullYear());
    let totalIncome = 0, totalExpense = 0, rigTotal = 0, rigPaid = 0, debTotal = 0, debPaid = 0;

    State.db.inc.forEach(i => {
        if (i.التاريخ >= monthRange.start && i.التاريخ <= monthRange.end) {
            totalIncome += parseAmount(i.المبلغ);
        }
    });

    State.db.exp.forEach(i => {
        if (i.التاريخ >= monthRange.start && i.التاريخ <= monthRange.end) {
            totalExpense += parseAmount(i.المبلغ);
        }
    });

    State.db.rig.forEach(i => {
        rigTotal += parseAmount(i.المبلغ);
        rigPaid += parseAmount(i.المبلغ_المضاف_للرصيد || 0);
    });

    State.db.deb.forEach(i => {
        debTotal += parseAmount(i.المبلغ_الكلي_للالتزام || i.المبلغ || 0);
        debPaid += parseAmount(i.المبلغ_المخصوم_للرصيد || 0);
    });

    // Dashboard - Monthly Summary
    document.getElementById('monthIncome').innerHTML = formatCurrency(totalIncome);
    document.getElementById('monthExpense').innerHTML = formatCurrency(totalExpense);
    document.getElementById('monthRemaining').innerHTML = formatCurrency(totalIncome - totalExpense);

    // Net Worth
    document.getElementById('netBalance').innerHTML = formatCurrency(State.currentBalance);
    document.getElementById('netRights').innerHTML = formatCurrency(rigTotal - rigPaid);
    document.getElementById('netDebts').innerHTML = formatCurrency(debTotal - debPaid);
    document.getElementById('netTotal').innerHTML = formatCurrency(State.currentBalance + (rigTotal - rigPaid) - (debTotal - debPaid));

    // Quick Stats
    document.getElementById('qsIncome').innerHTML = formatCurrency(totalIncome);
    document.getElementById('qsExpenses').innerHTML = formatCurrency(totalExpense);
    document.getElementById('qsRightsPaid').innerHTML = formatCurrency(rigPaid);
    document.getElementById('qsDebtsPaid').innerHTML = formatCurrency(debPaid);

    // Analytics (More tab)
    document.getElementById('analyticsIncome').innerHTML = formatCurrency(totalIncome);
    document.getElementById('analyticsExpenses').innerHTML = formatCurrency(totalExpense);
    document.getElementById('analyticsNet').innerHTML = formatCurrency(totalIncome - totalExpense);

    const totalDays = new Date().getDate();
    const dailyAvg = totalDays > 0 ? totalExpense / totalDays : 0;
    document.getElementById('analyticsDaily').innerHTML = formatCurrency(dailyAvg);

    // Most spent category
    const categoryMap = {};
    State.db.exp.forEach(e => {
        if (e.التاريخ >= monthRange.start && e.التاريخ <= monthRange.end) {
            const cat = e.الفئة || 'أخرى';
            categoryMap[cat] = (categoryMap[cat] || 0) + parseAmount(e.المبلغ);
        }
    });
    let topCat = '—', topAmt = 0;
    for (const [cat, amt] of Object.entries(categoryMap)) {
        if (amt > topAmt) { topCat = cat; topAmt = amt; }
    }
    document.getElementById('analyticsTopCategory').textContent = topCat;

    const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome * 100) : 0;
    document.getElementById('analyticsSavings').textContent = savingsRate.toFixed(1) + '%';

    // Settings currency
    document.getElementById('settingsCurrencyDisplay').textContent = getCurrency().symbol;
}

function updateRecentTransactions() {
    const container = document.getElementById('recentTransactionsList');
    if (!container) return;

    // جمع آخر 5 عمليات من جميع الأنواع
    const all = [];
    const types = [
        { key: 'exp', label: 'مصروف', icon: 'fa-arrow-down', color: 'var(--danger)' },
        { key: 'inc', label: 'دخل', icon: 'fa-arrow-up', color: 'var(--success)' },
        { key: 'rig', label: 'حق', icon: 'fa-hand-holding-heart', color: 'var(--warning)' },
        { key: 'deb', label: 'التزام', icon: 'fa-file-invoice', color: '#e67e22' }
    ];

    for (const t of types) {
        const items = State.db[t.key] || [];
        for (const item of items) {
            const date = item.التاريخ || item.تاريخ_الاستحقاق || '';
            const amount = parseAmount(item.المبلغ || item.المبلغ_الكلي_للالتزام || 0);
            const desc = item.الوصف || item.الفئة || item.النوع || '—';
            const entity = item.الجهة || item.المصدر || '';
            all.push({
                date,
                amount,
                desc,
                entity,
                label: t.label,
                icon: t.icon,
                color: t.color,
                id: item.clientId || item.id,
                type: t.key
            });
        }
    }

    all.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = all.slice(0, 5);

    if (!recent.length) {
        container.innerHTML = '<p class="empty-state">لا توجد عمليات حديثة</p>';
        return;
    }

    container.innerHTML = recent.map(r => `
        <div class="transaction-item" onclick="showDetail('${r.id}','${r.type}')">
            <div class="info">
                <span class="desc"><i class="fas ${r.icon}" style="color:${r.color};"></i> ${r.desc}</span>
                <span class="meta">${r.label} ${r.entity ? '· ' + r.entity : ''} · ${formatDate(r.date)}</span>
            </div>
            <span class="amount ${r.type === 'exp' || r.type === 'deb' ? 'expense' : (r.type === 'inc' ? 'income' : 'right')}">
                ${r.type === 'exp' || r.type === 'deb' ? '-' : '+'}${formatCurrency(r.amount)}
            </span>
        </div>
    `).join('');
}

function updateAlerts() {
    const container = document.getElementById('quickAlertsList');
    if (!container) return;

    const alerts = [];
    const today = new Date();
    const monthRange = getMonthRange(today.getMonth(), today.getFullYear());

    // تنبيهات الالتزامات
    State.db.deb.forEach(d => {
        if (d.تاريخ_الاستحقاق) {
            const due = new Date(d.تاريخ_الاستحقاق);
            const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
            const remaining = parseAmount(d.المتبقي_للالتزام || d.المبلغ || 0);
            if (remaining > 0 && diff <= 3 && diff >= 0) {
                alerts.push({ text: `⏰ التزام "${d.النوع}" مستحق بعد ${diff} يوم`, type: 'warning' });
            }
            if (diff < 0 && remaining > 0) {
                alerts.push({ text: `⚠️ التزام "${d.النوع}" متأخر!`, type: 'danger' });
            }
        }
    });

    // تنبيهات الحقوق
    State.db.rig.forEach(r => {
        if (r.تاريخ_الاستحقاق) {
            const due = new Date(r.تاريخ_الاستحقاق);
            const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
            const remaining = parseAmount(r.المتبقي || 0);
            if (remaining > 0 && diff <= 3 && diff >= 0) {
                alerts.push({ text: `⏰ حق "${r.النوع}" مستحق بعد ${diff} يوم`, type: 'warning' });
            }
            if (diff < 0 && remaining > 0) {
                alerts.push({ text: `⚠️ حق "${r.النوع}" متأخر!`, type: 'danger' });
            }
        }
    });

    // تنبيهات الميزانية
    State.db.budget.forEach(b => {
        const spent = getCategorySpending(b.الفئة);
        const percent = b.المبلغ > 0 ? (spent / b.المبلغ) * 100 : 0;
        if (percent > 90 && percent <= 100) {
            alerts.push({ text: `⚠️ ميزانية "${b.الفئة}" اقتربت من الحد (${percent.toFixed(0)}%)`, type: 'warning' });
        }
        if (percent > 100) {
            alerts.push({ text: `🔴 تجاوزت ميزانية "${b.الفئة}" (${percent.toFixed(0)}%)`, type: 'danger' });
        }
    });

    if (!alerts.length) {
        container.innerHTML = '<p class="empty-state">✅ كل شيء على ما يرام</p>';
        return;
    }

    container.innerHTML = alerts.slice(0, 5).map(a =>
        `<div class="alert-item ${a.type}"><i class="fas fa-bell"></i> ${a.text}</div>`
    ).join('');
}

function updateAssistant() {
    const container = document.getElementById('assistantTips');
    if (!container) return;

    const tips = [];
    const monthRange = getMonthRange(new Date().getMonth(), new Date().getFullYear());

    let totalIncome = 0, totalExpense = 0;
    State.db.inc.forEach(i => {
        if (i.التاريخ >= monthRange.start && i.التاريخ <= monthRange.end) totalIncome += parseAmount(i.المبلغ);
    });
    State.db.exp.forEach(e => {
        if (e.التاريخ >= monthRange.start && e.التاريخ <= monthRange.end) totalExpense += parseAmount(e.المبلغ);
    });

    if (totalIncome > 0) {
        const savingsRate = ((totalIncome - totalExpense) / totalIncome * 100);
        if (savingsRate < 10) {
            tips.push('💰 نسبة الادخار منخفضة (أقل من 10%)، حاول تقليل الإنفاق غير الضروري.');
        } else if (savingsRate > 30) {
            tips.push('🌟 نسبة ادخار ممتازة! استمر في الحفاظ على هذه العادة.');
        }
    }

    // أكثر فئة إنفاقاً
    const catMap = {};
    State.db.exp.forEach(e => {
        if (e.التاريخ >= monthRange.start && e.التاريخ <= monthRange.end) {
            const cat = e.الفئة || 'أخرى';
            catMap[cat] = (catMap[cat] || 0) + parseAmount(e.المبلغ);
        }
    });
    let topCat = '—', topAmt = 0;
    for (const [cat, amt] of Object.entries(catMap)) {
        if (amt > topAmt) { topCat = cat; topAmt = amt; }
    }
    if (topCat !== '—') {
        tips.push(`📊 أكثر فئة إنفاقاً هي "${topCat}" بمبلغ ${formatCurrency(topAmt)}.`);
    }

    // التزامات قادمة
    const upcoming = State.db.deb.filter(d => {
        if (!d.تاريخ_الاستحقاق) return false;
        const due = new Date(d.تاريخ_الاستحقاق);
        const diff = Math.ceil((due - new Date()) / (1000 * 60 * 60 * 24));
        return diff >= 0 && diff <= 7 && parseAmount(d.المتبقي_للالتزام || d.المبلغ || 0) > 0;
    });
    if (upcoming.length) {
        tips.push(`📅 لديك ${upcoming.length} التزاماً قادماً خلال الأيام القادمة.`);
    }

    // حقوق مستحقة
    const dueRights = State.db.rig.filter(r => {
        if (!r.تاريخ_الاستحقاق) return false;
        const due = new Date(r.تاريخ_الاستحقاق);
        const diff = Math.ceil((due - new Date()) / (1000 * 60 * 60 * 24));
        return diff >= 0 && diff <= 7 && parseAmount(r.المتبقي || 0) > 0;
    });
    if (dueRights.length) {
        tips.push(`💰 لديك ${dueRights.length} حقاً سيستحق قريباً.`);
    }

    if (!tips.length) {
        container.innerHTML = '<p class="empty-state">💡 أضف المزيد من البيانات للحصول على نصائح مخصصة</p>';
        return;
    }

    container.innerHTML = tips.slice(0, 4).map(t =>
        `<div class="assistant-tip"><i class="fas fa-lightbulb"></i> ${t}</div>`
    ).join('');
}

function updateMoneyTab() {
    // تحديث التاريخ الافتراضي
    const date = getToday();
    ['incDate', 'eDate'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = date;
    });
}

function updateRightsDebtsTab() {
    const date = getToday();
    ['rDueDate', 'dDueDate'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = date;
    });
}

function updatePlanningTab() {
    const date = getToday();
    ['budgetDate', 'goalDate', 'recStartDate'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = date;
    });
    renderBudgetList();
    renderGoalList();
    renderRecurringList();
}

function updateMoreTab() {
    renderCalendar();
}

// ============================================================
// PWA SERVICE WORKER REGISTRATION
// ============================================================
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW registered:', reg))
            .catch(err => console.log('SW registration failed:', err));
    }
}

// ============================================================
// ABOUT MODAL
// ============================================================
function openAboutModal() { openLayer('about'); }

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    // تحميل الوضع الداكن
    loadDarkMode();

    // تعيين التاريخ الافتراضي
    const today = getToday();
    ['incDate', 'eDate', 'rDueDate', 'dDueDate', 'goalDate', 'recStartDate'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = today;
    });

    // تهيئة قاعدة البيانات
    await initDB();

    // تهيئة Google Drive
    initDriveAPIs();

    // تحديث الواجهة
    updateAllUI();

    // تسجيل Service Worker
    registerSW();

    // إخفاء التحميل
    hideLoading();

    console.log(`🚀 ${CONFIG.APP_NAME} v${CONFIG.APP_VERSION} initialized`);
});

// ============================================================
// EXPOSE FUNCTIONS TO GLOBAL SCOPE
// ============================================================
window.switchTab = switchTab;
window.switchSubTab = switchSubTab;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.toggleSidebar = toggleSidebar;
window.toggleSearch = toggleSearch;
window.openQuickAdd = openQuickAdd;
window.quickAdd = quickAdd;
window.openLayer = openLayer;
window.closeLayer = closeLayer;
window.toggleBalanceVisibility = toggleBalanceVisibility;
window.openBalanceActionModal = (type) => openLayer('balanceAction', { actionType: type });
window.openBalanceLogModal = () => openLayer('balanceLog');
window.processBalanceAction = processBalanceAction;
window.addIncome = addIncome;
window.addExpense = addExpense;
window.addRight = addRight;
window.addDebt = addDebt;
window.addBudget = addBudget;
window.addGoal = addGoal;
window.addRecurring = addRecurring;
window.editBudget = editBudget;
window.deleteBudget = deleteBudget;
window.editGoal = editGoal;
window.deleteGoal = deleteGoal;
window.contributeToGoal = contributeToGoal;
window.editRecurring = editRecurring;
window.deleteRecurring = deleteRecurring;
window.toggleRecurring = toggleRecurring;
window.openLog = openLog;
window.renderLog = renderLog;
window.showDetail = showDetail;
window.editTransaction = editTransaction;
window.deleteTransaction = deleteTransaction;
window.openExportNameModal = openExportNameModal;
window.performExport = performExport;
window.importData = importData;
window.formatAmount = formatAmount;
window.showImageSourceModal = showImageSourceModal;
window.closeImageSource = closeImageSource;
window.openCameraInput = openCameraInput;
window.openGalleryInput = openGalleryInput;
window.handleImageSelect = handleImageSelect;
window.openCurrencyModal = openCurrencyModal;
window.selectCurrency = selectCurrency;
window.renderCurrencyList = renderCurrencyList;
window.toggleDarkMode = toggleDarkMode;
window.confirmResetData = confirmResetData;
window.openAboutModal = openAboutModal;
window.handleDriveClick = handleDriveClick;
window.handleBackupConfirm = handleBackupConfirm;
window.handleViewBackups = handleViewBackups;
window.handleDriveBackup = handleDriveBackup;
window.signOutDrive = signOutDrive;
window.openDriveBackupModal = openDriveBackupModal;
window.refreshBackupList = refreshBackupList;
window.restoreBackup = restoreBackup;
window.deleteBackup = deleteBackup;
window.renderCalendar = renderCalendar;
window.changeMonth = changeMonth;
window.showDayEvents = showDayEvents;
window.getCurrency = getCurrency;
window.formatCurrency = formatCurrency;
window.toastMsg = toastMsg;
