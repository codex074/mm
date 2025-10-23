import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getFirestore, collection, addDoc, onSnapshot, query, orderBy, Timestamp, doc,
    runTransaction, setLogLevel, deleteDoc, updateDoc, writeBatch, getDocs, where,
    getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
    signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAuquzlCs4RyYeMTwRNcSkSyNxyXizXp7M",
    authDomain: "moneymanagement-af731.firebaseapp.com",
    projectId: "moneymanagement-af731",
    storageBucket: "moneymanagement-af731.appspot.com",
    messagingSenderId: "578274480495",
    appId: "1:578274480495:web:939350f2d8b3cde4f7589a"
};


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
// setLogLevel('debug');

let state = {};
const resetState = () => {
    state = {
        accounts: [], transactions: [], categories: [], budgets: [], goals: [], recurring: [], debts: [], investments: [],
        currentUser: null, currentTransactionType: 'expense', editingItem: null, isDbReady: false,
    };
};
resetState();

let dbRefs = {};
let listeners = {};
let charts = { expensePie: null, incomeExpenseBar: null };

const formatCurrency = (amount, currency = 'THB') => {
    const locales = {
        THB: 'th-TH',
        USD: 'en-US'
    };
    return new Intl.NumberFormat(locales[currency], { style: 'currency', currency }).format(amount);
}
const formatDate = (date) => date.toISOString().split('T')[0];
const showToast = (message) => {
    const toast = document.getElementById('toast-notification');
    document.getElementById('toast-message').textContent = message;
    toast.classList.remove('hidden');
    toast.style.animation = 'none';
    toast.offsetHeight;
    toast.style.animation = null;
};
const openModal = (modal) => {
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('.modal-content').classList.remove('scale-95', 'opacity-0');
    }, 10);
};
const closeModal = (modal) => {
    modal.classList.add('opacity-0');
    modal.querySelector('.modal-content').classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};
const showConfirmModal = (title, message, onConfirm) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const okButton = document.getElementById('confirm-ok-button');
    const newOkButton = okButton.cloneNode(true);
    okButton.parentNode.replaceChild(newOkButton, okButton);
    newOkButton.addEventListener('click', () => { onConfirm(); closeModal(modal); });
    openModal(modal);
};
const switchView = (viewName) => {
    document.querySelectorAll('.view-content').forEach(v => v.classList.add('hidden'));
    const activeView = document.getElementById(`${viewName}-view`);
    if (activeView) activeView.classList.remove('hidden');
    else document.getElementById('dashboard-view').classList.remove('hidden');
    document.querySelectorAll('.nav-link').forEach(link => {
        const isActive = link.dataset.view === viewName;
        link.classList.toggle('bg-primary/10', isActive);
        link.classList.toggle('text-primary', isActive);
        link.classList.toggle('font-semibold', isActive);
    });
    const activeLink = document.querySelector(`.nav-link[data-view="${viewName}"]`);
    document.getElementById('view-title').textContent = activeLink ? activeLink.querySelector('.sidebar-text').textContent.trim() : 'ภาพรวม';
    
    // Updated code for mobile menu closing
    if (window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebar');
        const sidebarBackdrop = document.getElementById('sidebar-backdrop');
        
        sidebar.classList.add('-translate-x-full');
        sidebarBackdrop.classList.add('opacity-0');
        setTimeout(() => {
            sidebarBackdrop.classList.add('hidden');
        }, 300);
    }
    
    if(viewName === 'reports') renderReports();
};
const populateSelect = (id, data, options = {}) => {
    const { valueKey = 'id', textKey = 'name', selectedValue = null, placeholder = null } = options;
    const select = document.getElementById(id);
    select.innerHTML = '';
    if (placeholder) select.innerHTML += `<option value="">${placeholder}</option>`;
    select.innerHTML += data.map(item => `<option value="${item[valueKey]}" ${item[valueKey] === selectedValue ? 'selected' : ''}>${item[textKey]}</option>`).join('');
};
const createTransactionItemHTML = (tx, showActions = false) => {
    const account = state.accounts.find(a => a.id === tx.accountId);
    const category = state.categories.find(c => c.id === tx.categoryId);
    const date = tx.date.toDate().toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric'});
    let icon, color, title, details;

    let currency = 'THB'; // Default currency
    if (account) currency = account.currency;
    else if (tx.fromAccountId) {
        const fromAcc = state.accounts.find(a => a.id === tx.fromAccountId);
        if(fromAcc) currency = fromAcc.currency;
    }

    switch (tx.type) {
        case 'income': icon = `<i data-lucide="arrow-down-circle" class="w-10 h-10 text-green-500"></i>`; color = 'text-green-500'; title = category?.name || 'รายรับ'; details = `เข้า: ${account?.name || 'N/A'}`; break;
        case 'expense': icon = `<i data-lucide="arrow-up-circle" class="w-10 h-10 text-red-500"></i>`; color = 'text-red-500'; title = category?.name || 'รายจ่าย'; details = `จาก: ${account?.name || 'N/A'}`; break;
        case 'transfer': const fromAcc = state.accounts.find(a => a.id === tx.fromAccountId); const toAcc = state.accounts.find(a => a.id === tx.toAccountId); icon = `<i data-lucide="arrow-right-left" class="w-10 h-10 text-blue-500"></i>`; color = 'text-blue-500'; title = 'โอนเงิน'; details = `${fromAcc?.name || 'N/A'} -> ${toAcc?.name || 'N/A'}`; break;
    }
    return `<div class="flex items-center justify-between py-2 border-b border-default last:border-b-0">
            <div class="flex items-center overflow-hidden mr-2"><div class="mr-4 flex-shrink-0">${icon}</div><div class="truncate"><p class="font-semibold truncate">${title}</p><p class="text-sm opacity-60 truncate">${tx.notes || details}</p></div></div>
            <div class="flex items-center gap-2 md:gap-4 flex-shrink-0"><div class="text-right"><p class="font-semibold ${color}">${formatCurrency(tx.amount, currency)}</p><p class="text-sm opacity-60">${date}</p></div>
                ${showActions ? `<div class="flex flex-col md:flex-row gap-1"><button class="edit-transaction-btn p-2 hover:text-primary" data-id="${tx.id}"><i data-lucide="pencil" class="w-4 h-4 pointer-events-none"></i></button><button class="delete-transaction-btn p-2 hover:text-red-500" data-id="${tx.id}"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button></div>` : ''}
            </div></div>`;
};
const setupTransactionModal = (type, tx = null) => {
    state.editingItem = tx;
    state.currentTransactionType = type;
    const modal = document.getElementById('transaction-modal');
    const form = document.getElementById('transaction-form');
    form.reset();
    document.getElementById('transaction-modal-title').textContent = tx ? 'แก้ไขธุรกรรม' : 'เพิ่มธุรกรรม';
    document.getElementById('transaction-id').value = tx ? tx.id : '';

    document.querySelectorAll('.transaction-type-btn').forEach(btn => {
        const isActive = btn.dataset.type === type;
        btn.classList.toggle('bg-indigo-600', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('text-gray-500', !isActive);
        btn.classList.toggle('dark:text-gray-400', !isActive);
    });
    
    const show = (id, isVisible) => document.getElementById(id).classList.toggle('hidden', !isVisible);
    show('category-wrapper', type !== 'transfer');
    show('account-select-wrapper', type !== 'transfer');
    show('transfer-accounts-wrapper', type === 'transfer');
    populateSelect('transaction-account', state.accounts, { selectedValue: tx?.accountId });
    
    const fromAccountSelect = document.getElementById('transfer-from-account');
    populateSelect('transfer-from-account', state.accounts, { selectedValue: tx?.fromAccountId });
    fromAccountSelect.addEventListener('change', () => {
        const fromAccount = state.accounts.find(a => a.id === fromAccountSelect.value);
        if(fromAccount) {
            const compatibleToAccounts = state.accounts.filter(a => a.id !== fromAccount.id && a.currency === fromAccount.currency);
            populateSelect('transfer-to-account', compatibleToAccounts);
        }
    }, { once: true });
    
    if (tx?.fromAccountId) {
        const fromAccount = state.accounts.find(a => a.id === tx.fromAccountId);
        if (fromAccount) {
            const compatibleToAccounts = state.accounts.filter(a => a.id !== fromAccount.id && a.currency === fromAccount.currency);
            populateSelect('transfer-to-account', compatibleToAccounts, { selectedValue: tx.toAccountId });
        }
    } else {
        populateSelect('transfer-to-account', []);
    }
    
    const categories = state.categories.filter(c => c.type === type);
    populateSelect('transaction-category', categories, { selectedValue: tx?.categoryId });
    if (tx) {
        document.getElementById('transaction-amount').value = tx.amount;
        document.getElementById('transaction-date').value = formatDate(tx.date.toDate());
        document.getElementById('transaction-notes').value = tx.notes || '';
    } else {
        document.getElementById('transaction-date').value = formatDate(new Date());
    }
    openModal(modal);
};

const setupApp = async (user) => {
    state.currentUser = user;
    const basePath = `users/${user.uid}`;
    dbRefs = {
        accounts: collection(db, basePath, 'accounts'), transactions: collection(db, basePath, 'transactions'),
        categories: collection(db, basePath, 'categories'), budgets: collection(db, basePath, 'budgets'),
        goals: collection(db, basePath, 'goals'), recurring: collection(db, basePath, 'recurring'),
        debts: collection(db, basePath, 'debts'), investments: collection(db, basePath, 'investments'),
    };
    const userProfileRef = doc(db, "users", user.uid);
    const userProfileSnap = await getDoc(userProfileRef);
    if (userProfileSnap.exists()) {
        const userData = userProfileSnap.data();
        document.getElementById('user-profile-name').textContent = userData.username;
        document.getElementById('user-profile-email').textContent = userData.email;
        document.getElementById('user-profile').classList.remove('hidden');
    }
    
    Object.values(listeners).forEach(unsubscribe => unsubscribe());
    const collectionsToListen = ['accounts', 'categories', 'transactions', 'budgets', 'goals', 'recurring', 'debts', 'investments'];
    
    let collectionsLoaded = 0;
    const initialLoadPromise = new Promise(resolve => {
        collectionsToListen.forEach(name => {
            const q = query(dbRefs[name], orderBy('createdAt', 'desc'));
            listeners[name] = onSnapshot(q, snapshot => {
                state[name] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                
                if (!state.isDbReady) {
                    collectionsLoaded++;
                    if (collectionsLoaded === collectionsToListen.length) {
                        resolve();
                    }
                } else {
                    renderAll();
                }
            }, err => {
                console.error(`Error listening to ${name}:`, err);
            });
        });
    });

    await initialLoadPromise;
    state.isDbReady = true;
    renderAll();
};

const renderAll = () => {
    if (!state.isDbReady) return;
    const currentView = document.querySelector('.nav-link.font-semibold')?.dataset.view || 'dashboard';
    renderDashboard(); renderAccounts(); renderCategories(); renderHistory();
    renderBudgets(); renderGoals(); renderRecurring(); renderDebts(); renderInvestments();
    if (currentView === 'reports') renderReports();
};

function renderDashboard() {
    const totalsByCurrency = {};

    state.accounts.filter(a => a.type !== 'creditcard').forEach(acc => {
        if (!totalsByCurrency[acc.currency]) totalsByCurrency[acc.currency] = { liquid: 0, investments: 0, debts: 0 };
        totalsByCurrency[acc.currency].liquid += acc.balance;
    });
    state.investments.forEach(inv => {
        if (!totalsByCurrency[inv.currency]) totalsByCurrency[inv.currency] = { liquid: 0, investments: 0, debts: 0 };
        totalsByCurrency[inv.currency].investments += (inv.quantity * inv.pricePerUnit);
    });
    state.debts.filter(d => d.type === 'liability').forEach(debt => {
        if (!totalsByCurrency[debt.currency]) totalsByCurrency[debt.currency] = { liquid: 0, investments: 0, debts: 0 };
        totalsByCurrency[debt.currency].debts += debt.currentAmount;
    });
    
    const summaryContainer = document.getElementById('dashboard-summary-cards');
    summaryContainer.innerHTML = '';

    if (Object.keys(totalsByCurrency).length === 0) {
        summaryContainer.innerHTML = `<p class="col-span-full text-center opacity-70 py-8">เริ่มต้นใช้งานโดยการเพิ่มบัญชีของคุณ</p>`;
    } else {
        Object.entries(totalsByCurrency).forEach(([currency, totals]) => {
            const netWorth = totals.liquid + totals.investments - totals.debts;
            summaryContainer.innerHTML += `
                <div class="card p-6 rounded-xl relative overflow-hidden">
                    <div class="absolute -top-4 -right-4 text-cyan-500/10 dark:text-cyan-500/20"><i data-lucide="safe" class="w-24 h-24"></i></div>
                    <h3 class="opacity-70">สินทรัพย์สภาพคล่อง (${currency})</h3>
                    <p class="text-3xl font-bold mt-2 text-cyan-500">${formatCurrency(totals.liquid, currency)}</p>
                </div>
                <div class="card p-6 rounded-xl relative overflow-hidden">
                    <div class="absolute -top-4 -right-4 text-amber-500/10 dark:text-amber-500/20"><i data-lucide="bar-chart-3" class="w-24 h-24"></i></div>
                    <h3 class="opacity-70">สินทรัพย์ลงทุน (${currency})</h3>
                    <p class="text-3xl font-bold mt-2 text-amber-500">${formatCurrency(totals.investments, currency)}</p>
                </div>
                <div class="card p-6 rounded-xl relative overflow-hidden">
                    <div class="absolute -top-4 -right-4 text-red-500/10 dark:text-red-500/20"><i data-lucide="landmark" class="w-24 h-24"></i></div>
                    <h3 class="opacity-70">หนี้สินคงเหลือ (${currency})</h3>
                    <p class="text-3xl font-bold mt-2 text-red-500">${formatCurrency(totals.debts, currency)}</p>
                </div>
                <div class="card p-6 rounded-xl relative overflow-hidden">
                    <div class="absolute -top-4 -right-4 text-indigo-500/10 dark:text-indigo-500/20"><i data-lucide="gem" class="w-24 h-24"></i></div>
                    <h3 class="opacity-70">ความมั่งคั่งสุทธิ (${currency})</h3>
                    <p class="text-3xl font-bold mt-2 text-indigo-500">${formatCurrency(netWorth, currency)}</p>
                </div>
            `;
        });
    }

    const recentTxList = document.getElementById('recent-transactions-list');
    recentTxList.innerHTML = state.transactions.length === 0 ? `<p class="text-center py-4 opacity-60">ไม่มีธุรกรรมล่าสุด</p>` : state.transactions.slice(0, 3).map(tx => createTransactionItemHTML(tx)).join('');
    
    const investmentSummaryList = document.getElementById('investment-summary-list');
    investmentSummaryList.innerHTML = state.investments.length === 0 ? `<p class="text-center py-4 opacity-60">ไม่มีข้อมูลทรัพย์สิน</p>` : state.investments.slice(0, 4).map(i => `
        <div class="flex items-center justify-between py-2 border-b border-default last:border-b-0">
            <div><p class="font-semibold">${i.name}</p><p class="text-sm opacity-60">${i.quantity} หน่วย @ ${formatCurrency(i.pricePerUnit, i.currency)}</p></div>
            <p class="font-semibold text-amber-500">${formatCurrency(i.quantity * i.pricePerUnit, i.currency)}</p>
        </div>
    `).join('');

    lucide.createIcons();
}
function renderAccounts() {
    const list = document.getElementById('accounts-list');
    const typeNames = { bank: 'บัญชีธนาคาร', cash: 'เงินสด', creditcard: 'บัตรเครดิต'};
    list.innerHTML = state.accounts.length === 0 ? `<p class="opacity-60 col-span-full text-center py-8">ยังไม่มีบัญชี</p>` : state.accounts.map(acc => {
        const isCreditCard = acc.type === 'creditcard';
        const linkedDebt = isCreditCard ? state.debts.find(d => d.linkedAccountId === acc.id) : null;
        const displayBalance = isCreditCard ? (linkedDebt ? linkedDebt.currentAmount : 0) : acc.balance;

        let detailsHTML = '';
        if (acc.type === 'bank' && acc.accountNumber) {
            detailsHTML = `<p class="text-xs opacity-60 mt-1">เลขบัญชี: ${acc.accountNumber}</p>`;
        } else if (isCreditCard) {
            const statementDate = acc.statementDate ? `สรุปยอดวันที่ ${acc.statementDate} ของทุกเดือน` : '';
            detailsHTML = `<p class="text-xs opacity-60 mt-1">วงเงิน: ${formatCurrency(acc.creditLimit, acc.currency)}</p>
                        ${statementDate ? `<p class="text-xs opacity-60">${statementDate}</p>` : ''}`;
        }

        return `<div class="card p-6 rounded-xl flex flex-col justify-between">
            <div>
                <div class="flex justify-between items-start">
                    <h4 class="text-lg font-semibold">${acc.name}</h4>
                    <span class="text-xs font-semibold px-2 py-1 rounded-full ${isCreditCard ? 'bg-red-200 text-red-800 dark:bg-red-400 dark:text-red-900' : 'bg-blue-200 text-blue-800 dark:bg-blue-400 dark:text-blue-900'}">${typeNames[acc.type] || 'ไม่ระบุ'}</span>
                </div>
                <p class="text-2xl font-bold mt-2 ${isCreditCard ? 'text-red-500' : ''}">${formatCurrency(displayBalance, acc.currency)}</p>
                ${detailsHTML}
            </div>
            <div class="flex gap-2 mt-4 self-end"><button class="edit-account-btn p-2 hover:text-primary" data-id="${acc.id}"><i data-lucide="pencil" class="w-4 h-4 pointer-events-none"></i></button><button class="delete-account-btn p-2 hover:text-red-500" data-id="${acc.id}"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button></div>
        </div>`;
    }).join('');
    lucide.createIcons();
}
function getFilteredTransactions(filters = {}) {
    const searchTerm = (filters.searchTerm || '').toLowerCase();
    
    return state.transactions.filter(tx => {
        const date = tx.date.toDate();
        if (filters.dateFrom && date < filters.dateFrom) return false;
        if (filters.dateTo && date > filters.dateTo) return false;
        if (filters.type && tx.type !== filters.type) return false;
        if (filters.account && ![tx.accountId, tx.fromAccountId, tx.toAccountId].includes(filters.account)) return false;
        if (filters.category && tx.categoryId !== filters.category) return false;

        const cat = state.categories.find(c => c.id === tx.categoryId)?.name || '';
        const note = tx.notes || '';
        const fromAcc = tx.fromAccountId ? state.accounts.find(a => a.id === tx.fromAccountId)?.name || '' : '';
        const toAcc = tx.toAccountId ? state.accounts.find(a => a.id === tx.toAccountId)?.name || '' : '';
        const acc = tx.accountId ? state.accounts.find(a => a.id === tx.accountId)?.name || '' : '';

        return cat.toLowerCase().includes(searchTerm) || 
            note.toLowerCase().includes(searchTerm) ||
            fromAcc.toLowerCase().includes(searchTerm) ||
            toAcc.toLowerCase().includes(searchTerm) ||
            acc.toLowerCase().includes(searchTerm);
    });
}
function renderHistory(filters = {}) {
    const list = document.getElementById('history-list');
    const filtered = getFilteredTransactions(filters);
    list.innerHTML = filtered.length === 0 ? `<p class="text-center py-4 opacity-60">ไม่พบข้อมูลธุรกรรม</p>` : filtered.map(tx => createTransactionItemHTML(tx, true)).join('');
    lucide.createIcons();
}
function renderCategories() {
    const list = document.getElementById('categories-list');
    list.innerHTML = state.categories.length === 0 ? `<p class="text-center py-8 opacity-60">ยังไม่มีหมวดหมู่</p>` : state.categories.map(cat => {
        const color = cat.type === 'income' ? 'text-green-500' : 'text-red-500';
        return `<div class="flex items-center justify-between p-3 border-b border-default last:border-0"><div><p class="font-semibold">${cat.name}</p><p class="text-sm ${color}">${cat.type === 'income' ? 'รายรับ' : 'รายจ่าย'}</p></div><div class="flex gap-2">
            <button class="edit-category-btn p-2 hover:text-primary" data-id="${cat.id}"><i data-lucide="pencil" class="w-4 h-4 pointer-events-none"></i></button><button class="delete-category-btn p-2 hover:text-red-500" data-id="${cat.id}"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button></div></div>`;
    }).join('');
    lucide.createIcons();
}
function renderBudgets() {
    const list = document.getElementById('budgets-list');
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    list.innerHTML = state.budgets.length === 0 ? `<p class="text-center py-8 opacity-60">ยังไม่มีการตั้งงบประมาณ</p>` : state.budgets.map(b => {
        const cat = state.categories.find(c => c.id === b.categoryId);
        if (!cat) return '';
        const spent = state.transactions.filter(t => t.categoryId === b.categoryId && t.date.toDate() >= start).reduce((sum, t) => sum + t.amount, 0);
        const percent = b.amount > 0 ? (spent / b.amount) * 100 : 0;
        const progressColor = percent > 100 ? 'bg-red-500' : (percent > 80 ? 'bg-yellow-500' : 'bg-green-500');
        return `<div class="card p-4 rounded-xl">
            <div class="flex justify-between items-center mb-2"><span class="font-semibold">${cat.name}</span><div class="flex items-center gap-2"><span class="text-sm ${spent > b.amount ? 'text-red-500' : ''}">${formatCurrency(spent, b.currency)} / ${formatCurrency(b.amount, b.currency)}</span>
                <button class="delete-budget-btn p-1 hover:text-red-500" data-id="${b.id}"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button></div></div>
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5"><div class="${progressColor} h-2.5 rounded-full" style="width: ${Math.min(percent, 100)}%"></div></div>
            </div>`;
    }).join('');
    lucide.createIcons();
}
function renderGoals() {
    const list = document.getElementById('goals-list');
    list.innerHTML = state.goals.length === 0 ? `<p class="text-center py-8 col-span-full opacity-60">ยังไม่มีเป้าหมายการออม</p>` : state.goals.map(g => {
        const percent = g.targetAmount > 0 ? (g.currentAmount / g.targetAmount) * 100 : 0;
        return `<div class="card p-4 rounded-xl"><div class="flex justify-between items-start"><div><p class="font-semibold">${g.name}</p>
            <p class="text-sm opacity-80">${formatCurrency(g.currentAmount, g.currency)} / ${formatCurrency(g.targetAmount, g.currency)}</p></div><div class="flex gap-1">
            <button class="add-to-goal-btn bg-primary-gradient text-white text-xs px-2 py-1 rounded-md shadow-lg" data-id="${g.id}">ออมเพิ่ม</button>
            <button class="edit-goal-btn p-1" data-id="${g.id}"><i data-lucide="pencil" class="w-4 h-4"></i></button><button class="delete-goal-btn p-1" data-id="${g.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div>
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-2"><div class="bg-primary-gradient h-2.5 rounded-full" style="width: ${Math.min(percent, 100)}%"></div></div></div>`;
    }).join('');
    lucide.createIcons();
}

function renderRecurring() {
    const list = document.getElementById('recurring-list');
    
    const getFrequencyText = (r) => {
        const dayOfWeekMap = { '0': 'วันอาทิตย์', '1': 'วันจันทร์', '2': 'วันอังคาร', '3': 'วันพุธ', '4': 'วันพฤหัสบดี', '5': 'วันศุกร์', '6': 'วันเสาร์' };
        const monthMap = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
        
        switch(r.frequency) {
            case 'daily': return 'ทุกวัน';
            case 'weekly': return `ทุก${dayOfWeekMap[r.dayOfWeek] || 'สัปดาห์'}`;
            case 'monthly':
                const day = r.dayOfMonth === 'last' ? 'วันสิ้นเดือน' : `วันที่ ${r.dayOfMonth}`;
                return `ทุกๆ ${r.monthInterval > 1 ? `${r.monthInterval} ` : ''}เดือน, ${day}`;
            case 'yearly':
                const dayYearly = r.dayOfMonth === 'last' ? 'วันสิ้นเดือน' : `วันที่ ${r.dayOfMonth}`;
                return `ทุกๆ ${r.yearInterval > 1 ? `${r.yearInterval} ` : ''}ปี, ${dayYearly} ${monthMap[r.monthOfYear] || ''}`;
            default: return 'N/A';
        }
    };
    
    list.innerHTML = state.recurring.length === 0 ? `<p class="text-center py-8 opacity-60">ยังไม่มีรายการประจำ</p>` : state.recurring.map(r => {
        const cat = state.categories.find(c => c.id === r.categoryId);
        const acc = state.accounts.find(a => a.id === r.accountId);
        const freqText = getFrequencyText(r);

        let scheduleText = '';
        if (r.startDate) {
            const startDate = new Date(r.startDate);
            const start = startDate.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
            scheduleText = `เริ่มต้น ${start}`;
            if (r.endDate) {
                const endDate = new Date(r.endDate);
                const end = endDate.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
                scheduleText += `, สิ้นสุด ${end}`;
            }
        }

        return `<div class="flex items-center justify-between p-3 border-b border-default last:border-b-0">
            <div>
                <p class="font-semibold">${r.notes || (cat?.name || 'N/A')}</p>
                <p class="text-sm opacity-80">${formatCurrency(r.amount, acc?.currency)} | ${acc?.name || 'N/A'}</p>
                <p class="text-xs opacity-60 font-semibold text-primary">${freqText}</p>
                <p class="text-xs opacity-60">${scheduleText}</p>
            </div>
            <div class="flex items-center gap-2">
            <button class="record-recurring-btn bg-primary-gradient text-white text-sm px-3 py-1.5 rounded-lg shadow-lg" data-id="${r.id}">บันทึกวันนี้</button>
            <button class="edit-recurring-btn p-2 hover:text-primary" data-id="${r.id}"><i data-lucide="pencil" class="w-4 h-4 pointer-events-none"></i></button>
            <button class="delete-recurring-btn p-2 hover:text-red-500" data-id="${r.id}"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button></div></div>`;
    }).join('');
    lucide.createIcons();
}

function renderReports() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const expenseData = state.transactions
        .filter(t => t.type === 'expense' && t.date.toDate() >= startOfMonth)
        .reduce((acc, t) => {
            const category = state.categories.find(c => c.id === t.categoryId);
            const name = category ? category.name : 'ไม่มีหมวดหมู่';
            acc[name] = (acc[name] || 0) + t.amount;
            return acc;
        }, {});

    const pieCtx = document.getElementById('expense-pie-chart').getContext('2d');
    if (charts.expensePie) charts.expensePie.destroy();
    charts.expensePie = new Chart(pieCtx, {
        type: 'pie',
        data: {
            labels: Object.keys(expenseData),
            datasets: [{
                data: Object.values(expenseData),
                backgroundColor: ['#4f46e5', '#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#6b7280'],
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyData = state.transactions
        .filter(t => t.type !== 'transfer' && t.date.toDate() >= sixMonthsAgo)
        .reduce((acc, t) => {
            const month = t.date.toDate().toLocaleDateString('th-TH', { year: 'numeric', month: 'short' });
            if (!acc[month]) acc[month] = { income: 0, expense: 0 };
            acc[month][t.type] += t.amount;
            return acc;
        }, {});

    const sortedMonths = Object.keys(monthlyData).sort((a, b) => {
        const monthOrder = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
        const [monthA, yearA] = a.split(' ');
        const [monthB, yearB] = b.split(' ');
        if(yearA !== yearB) return parseInt(yearA) - parseInt(yearB);
        return monthOrder.indexOf(monthA) - monthOrder.indexOf(monthB);
    });

    const barCtx = document.getElementById('income-expense-bar-chart').getContext('2d');
    if (charts.incomeExpenseBar) charts.incomeExpenseBar.destroy();
    charts.incomeExpenseBar = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: sortedMonths,
            datasets: [
                { label: 'รายรับ', data: sortedMonths.map(m => monthlyData[m].income), backgroundColor: '#10b981' },
                { label: 'รายจ่าย', data: sortedMonths.map(m => monthlyData[m].expense), backgroundColor: '#ef4444' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });
}

function renderDebts() {
    const liabilitiesList = document.getElementById('liabilities-list');
    const assetsList = document.getElementById('assets-list');
    const liabilities = state.debts.filter(d => d.type === 'liability');
    const assets = state.debts.filter(d => d.type === 'asset');
    const createDebtItemHTML = (d) => {
        const percent = d.totalAmount > 0 ? ((d.totalAmount - d.currentAmount) / d.totalAmount) * 100 : 0;
        const isLiability = d.type === 'liability';
        return `<div class="card p-4 rounded-xl">
            <div class="flex justify-between items-start"><div><p class="font-semibold">${d.name}</p><p class="text-sm opacity-80">${formatCurrency(d.currentAmount, d.currency)} / ${formatCurrency(d.totalAmount, d.currency)}</p></div>
                <div class="flex gap-1">
                    <button class="pay-debt-btn bg-primary-gradient text-white text-xs px-2 py-1 rounded-md shadow-lg" data-id="${d.id}">${isLiability ? 'ชำระเงิน' : 'รับชำระ'}</button>
                    <button class="edit-debt-btn p-1" data-id="${d.id}"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                    <button class="delete-debt-btn p-1" data-id="${d.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </div></div>
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-2"><div class="bg-primary-gradient h-2.5 rounded-full" style="width: ${percent}%"></div></div>
        </div>`;
    };
    liabilitiesList.innerHTML = liabilities.length === 0 ? `<p class="text-center py-8 opacity-60">ไม่พบรายการหนี้สิน</p>` : liabilities.map(createDebtItemHTML).join('');
    assetsList.innerHTML = assets.length === 0 ? `<p class="text-center py-8 opacity-60">ไม่พบรายการให้ยืม</p>` : assets.map(createDebtItemHTML).join('');
    lucide.createIcons();
}

function renderInvestments() {
    const list = document.getElementById('investments-list');
    list.innerHTML = state.investments.length === 0 ? `<p class="text-center py-8 opacity-60">ไม่พบรายการทรัพย์สิน</p>` : state.investments.map(i => `
        <div class="card p-4 rounded-xl">
            <div class="flex justify-between items-center">
                <div>
                    <p class="font-semibold text-lg">${i.name}</p>
                    <p class="text-sm opacity-80">${i.quantity} หน่วย @ ${formatCurrency(i.pricePerUnit, i.currency)} / หน่วย</p>
                </div>
                <div class="text-right">
                    <p class="font-bold text-xl text-amber-500">${formatCurrency(i.quantity * i.pricePerUnit, i.currency)}</p>
                    <div class="flex gap-1 justify-end mt-1">
                        <button class="edit-investment-btn p-1 hover:text-primary" data-id="${i.id}"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                        <button class="delete-investment-btn p-1 hover:text-red-500" data-id="${i.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', () => {
    const html = document.documentElement;
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    
    const setSidebarState = (isCollapsed) => {
        sidebar.classList.toggle('w-20', isCollapsed);
        sidebar.classList.toggle('w-64', !isCollapsed);
        mainContent.classList.toggle('md:ml-20', isCollapsed);
        mainContent.classList.toggle('md:ml-64', !isCollapsed);
        document.querySelectorAll('.sidebar-text').forEach(el => el.classList.toggle('hidden', isCollapsed));
        document.querySelectorAll('.sidebar-icon').forEach(el => el.classList.toggle('hidden', !isCollapsed));
        document.querySelector('#sidebar-toggle i').classList.toggle('rotate-180', isCollapsed);
        localStorage.setItem('sidebarCollapsed', isCollapsed);
    };

    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        setSidebarState(true);
    }
    
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        const isCollapsed = sidebar.classList.contains('w-20');
        setSidebarState(!isCollapsed);
    });

    const themeToggle = document.getElementById('theme');
    const setTheme = (isDark) => {
        html.classList.toggle('dark', isDark);
        themeToggle.checked = isDark;
        localStorage.theme = isDark ? 'dark' : 'light';
        if(document.getElementById('reports-view').offsetParent !== null) renderReports();
    };
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedThemeIsDark = localStorage.theme === 'dark';
    const noSavedThemePrefersDark = !('theme' in localStorage) && prefersDark;
    setTheme(savedThemeIsDark || noSavedThemePrefersDark);

    themeToggle.addEventListener('change', (e) => {
        setTheme(e.target.checked);
    });

    document.getElementById('main-nav').addEventListener('click', e => { const link = e.target.closest('.nav-link'); if (link) { e.preventDefault(); switchView(link.dataset.view); } });
    
    // Updated code for mobile menu and backdrop
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    document.getElementById('menu-button').addEventListener('click', () => {
        sidebar.classList.remove('-translate-x-full');
        sidebarBackdrop.classList.remove('hidden');
        setTimeout(() => {
            sidebarBackdrop.classList.remove('opacity-0');
        }, 10);
    });

    sidebarBackdrop.addEventListener('click', () => {
        sidebar.classList.add('-translate-x-full');
        sidebarBackdrop.classList.add('opacity-0');
        setTimeout(() => {
            sidebarBackdrop.classList.add('hidden');
        }, 300);
    });

    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app');
    onAuthStateChanged(auth, user => {
        if (user) {
            authContainer.classList.add('hidden');
            appContainer.classList.remove('hidden', 'fade-in-start');
            appContainer.classList.add('app-fade-in');
            setupApp(user);
        } else {
            appContainer.classList.add('hidden', 'fade-in-start');
            appContainer.classList.remove('app-fade-in');
            authContainer.classList.remove('hidden');
            document.getElementById('user-profile').classList.add('hidden');
            Object.values(listeners).forEach(unsubscribe => unsubscribe());
            resetState();
        }
    });

    const handleAuthError = (error, el) => {
        let message = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
        if (error.code === 'auth/wrong-password') message = 'รหัสผ่านไม่ถูกต้อง';
        else if (error.code === 'auth/user-not-found' || error.message.includes('No user record')) message = 'ไม่พบข้อมูลผู้ใช้';
        else if (error.code === 'auth/email-already-in-use') message = 'อีเมลนี้ถูกใช้งานแล้ว';
        else if (error.code === 'auth/weak-password') message = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
        el.textContent = message;
    };

    document.getElementById('login-form').addEventListener('submit', async e => {
        e.preventDefault();
        const username = e.target['login-username'].value;
        const password = e.target['login-password'].value;
        const errorEl = document.getElementById('login-error');
        errorEl.textContent = '';
        try {
            const q = query(collection(db, "users"), where("username", "==", username));
            const querySnapshot = await getDocs(q);
            if (querySnapshot.empty) {
                errorEl.textContent = 'ไม่พบชื่อผู้ใช้นี้ในระบบ';
                return;
            }
            const email = querySnapshot.docs[0].data().email;
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            handleAuthError(error, errorEl);
        }
    });

    const submitLoginFormOnEnter = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('login-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
    };

    document.getElementById('login-username').addEventListener('keypress', submitLoginFormOnEnter);
    document.getElementById('login-password').addEventListener('keypress', submitLoginFormOnEnter);

    document.getElementById('signup-form').addEventListener('submit', async e => {
        e.preventDefault();
        const username = e.target['signup-username'].value.trim();
        const email = e.target['signup-email'].value.trim();
        const password = e.target['signup-password'].value;
        const confirmPassword = e.target['signup-password-confirm'].value;
        const errorEl = document.getElementById('signup-error');
        errorEl.textContent = '';
        if (password !== confirmPassword) {
            errorEl.textContent = 'รหัสผ่านไม่ตรงกัน';
            return;
        }
        if (!username || username.length < 3) {
            errorEl.textContent = 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร';
            return;
        }
        try {
            const q = query(collection(db, "users"), where("username", "==", username));
            if (!(await getDocs(q)).empty) {
                errorEl.textContent = 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว';
                return;
            }
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await setDoc(doc(db, "users", userCredential.user.uid), { username, email, createdAt: Timestamp.now() });
        } catch (error) {
            handleAuthError(error, errorEl);
        }
    });

    document.getElementById('forgot-password-link').addEventListener('click', e => { e.preventDefault(); openModal(document.getElementById('forgot-password-modal')); });
    document.getElementById('forgot-password-form').addEventListener('submit', e => {
        e.preventDefault();
        const email = e.target['reset-email'].value;
        sendPasswordResetEmail(auth, email)
            .then(() => {
                closeModal(document.getElementById('forgot-password-modal'));
                showToast('ส่งอีเมลสำหรับรีเซ็ตรหัสผ่านแล้ว!');
            })
            .catch(error => {
                showToast('เกิดข้อผิดพลาด: ไม่พบอีเมลนี้ในระบบ');
            });
    });
    document.getElementById('show-signup').addEventListener('click', e => { e.preventDefault(); document.getElementById('login-view').classList.add('hidden'); document.getElementById('signup-view').classList.remove('hidden'); });
    document.getElementById('show-login').addEventListener('click', e => { e.preventDefault(); document.getElementById('signup-view').classList.add('hidden'); document.getElementById('login-view').classList.remove('hidden'); });
    document.getElementById('auth-container').addEventListener('click', e => {
        const toggleButton = e.target.closest('[data-toggle-password]');
        if (!toggleButton) return;
        const input = toggleButton.previousElementSibling;
        const eyeIcon = toggleButton.querySelector('[data-lucide="eye"]');
        const eyeOffIcon = toggleButton.querySelector('[data-lucide="eye-off"]');
        if (input.type === 'password') {
            input.type = 'text';
            eyeIcon.classList.add('hidden');
            eyeOffIcon.classList.remove('hidden');
        } else {
            input.type = 'password';
            eyeIcon.classList.remove('hidden');
            eyeOffIcon.classList.add('hidden');
        }
    });
    document.getElementById('logout-button').addEventListener('click', () => signOut(auth));

    switchView('dashboard');
    lucide.createIcons();

    const modalOpeners = {
        'add-account-button': { modalId: 'account-modal', title: 'เพิ่มบัญชีใหม่', beforeOpen: () => {
            document.getElementById('account-balance').disabled = false;
            document.getElementById('account-type').disabled = false;
            document.getElementById('account-creditLimit').disabled = false;
            document.getElementById('account-currency').disabled = false;
            document.getElementById('account-type').dispatchEvent(new Event('change'));
        }},
        'add-category-button': { modalId: 'category-modal', title: 'เพิ่มหมวดหมู่' },
        'add-transaction-button': () => setupTransactionModal('expense'),
        'add-budget-button': { modalId: 'budget-modal', title: 'ตั้งงบประมาณ', beforeOpen: () => populateSelect('budget-category', state.categories.filter(c => c.type === 'expense')) },
        'add-goal-button': { modalId: 'goal-modal', title: 'สร้างเป้าหมายใหม่', beforeOpen: () => document.getElementById('goal-currentAmount').disabled = false },
        'add-recurring-button': { modalId: 'recurring-modal', title: 'เพิ่มรายการประจำ', beforeOpen: () => {
            populateSelect('recurring-account', state.accounts);
            populateSelect('recurring-category', state.categories.filter(c=>c.type === 'expense'));
            document.querySelector('#recurring-frequency-group .freq-btn[data-frequency="monthly"]').click();
            document.getElementById('recurring-startDate-picker').textContent = 'เลือกเดือน/ปี';
            document.getElementById('recurring-endDate-picker').textContent = 'เลือกเดือน/ปี';
            document.getElementById('recurring-dayOfWeek-picker').textContent = 'จันทร์';
            document.getElementById('recurring-dayOfWeek').value = '1';
        }},
        'add-debt-button': { modalId: 'debt-modal', title: 'เพิ่มรายการหนี้สิน' },
        'add-investment-button': { modalId: 'investment-modal', title: 'เพิ่มทรัพย์สิน' }
    };
    for(const [btnId, config] of Object.entries(modalOpeners)) {
        document.getElementById(btnId).addEventListener('click', () => {
            if (typeof config === 'function') { config(); return; }
            state.editingItem = null;
            const modal = document.getElementById(config.modalId);
            modal.querySelector('h3').textContent = config.title;
            const form = modal.querySelector('form');
            if(form) form.reset();
            const hiddenId = form.querySelector('input[type="hidden"]');
            if(hiddenId) hiddenId.value = '';
            config.beforeOpen?.();
            openModal(modal);
        });
    }

    const accountTypeSelect = document.getElementById('account-type');
    accountTypeSelect.addEventListener('change', (e) => {
        const type = e.target.value;
        document.getElementById('account-number-wrapper').classList.toggle('hidden', type !== 'bank');
        document.getElementById('credit-limit-wrapper').classList.toggle('hidden', type !== 'creditcard');
        document.getElementById('statement-date-wrapper').classList.toggle('hidden', type !== 'creditcard');
        document.getElementById('account-creditLimit').required = (type === 'creditcard');
        document.getElementById('account-balance-label').textContent = (type === 'creditcard') ? 'ยอดหนี้เริ่มต้น (ถ้ามี)' : 'ยอดเงินเริ่มต้น';
    });
    
    // Populate statement date select
    const statementDateSelect = document.getElementById('account-statementDate');
    for (let i = 1; i <= 31; i++) {
        statementDateSelect.innerHTML += `<option value="${i}">${i}</option>`;
    }

    document.getElementById('recurring-type').addEventListener('change', e => populateSelect('recurring-category', state.categories.filter(c => c.type === e.target.value)));

    const filtersPanel = document.getElementById('history-filters');
    document.getElementById('toggle-filters-btn').addEventListener('click', () => {
        filtersPanel.classList.toggle('hidden');
        if(!filtersPanel.classList.contains('hidden')) {
            populateSelect('filter-account', state.accounts, { placeholder: 'ทุกบัญชี' });
            populateSelect('filter-category', state.categories, { placeholder: 'ทุกหมวดหมู่' });
        }
    });

    const applyFilters = () => {
        const filters = {
            searchTerm: document.getElementById('history-search').value,
            dateFrom: document.getElementById('filter-date-from').value ? new Date(document.getElementById('filter-date-from').value) : null,
            dateTo: document.getElementById('filter-date-to').value ? new Date(document.getElementById('filter-date-to').value) : null,
            type: document.getElementById('filter-type').value,
            account: document.getElementById('filter-account').value,
            category: document.getElementById('filter-category').value,
        };
        if(filters.dateTo) filters.dateTo.setHours(23, 59, 59, 999);
        renderHistory(filters);
    };

    document.getElementById('apply-filters-btn').addEventListener('click', applyFilters);
    document.getElementById('history-search').addEventListener('input', applyFilters);
    document.getElementById('clear-filters-btn').addEventListener('click', () => {
        document.getElementById('history-search').value = '';
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
        document.getElementById('filter-type').value = '';
        document.getElementById('filter-account').value = '';
        document.getElementById('filter-category').value = '';
        applyFilters();
    });

    const ITEM_HEIGHT = 40;
    const PADDING_ITEMS = 2;

    const createWheel = (wheelId, items) => {
        const wheel = document.getElementById(wheelId);
        if (!wheel) return null;

        const allItems = [...Array(PADDING_ITEMS).fill({label:''}), ...items, ...Array(PADDING_ITEMS).fill({label:''})];
        wheel.innerHTML = allItems.map(item => `<div class="picker-item" data-value="${item.value}">${item.label}</div>`).join('');

        const wheelItems = wheel.querySelectorAll('.picker-item');
        let isDragging = false;
        let startY, startTranslate;

        const updateSelection = (translateY) => {
            const selectedIndex = Math.round(-translateY / ITEM_HEIGHT) + PADDING_ITEMS;
            wheelItems.forEach((item, index) => {
                item.classList.toggle('selected', index === selectedIndex);
            });
        };

        const setTranslate = (y, transition = false) => {
            wheel.style.transition = transition ? 'transform 0.2s ease-out' : 'none';
            wheel.style.transform = `translateY(${y}px)`;
            updateSelection(y);
        };

        const snap = () => {
            const currentTranslate = parseFloat(wheel.style.transform.replace('translateY(', '')) || 0;
            const targetIndex = Math.round(currentTranslate / ITEM_HEIGHT);
            let finalTranslate = targetIndex * ITEM_HEIGHT;

            const maxTranslate = 0;
            const minTranslate = -(items.length - 1) * ITEM_HEIGHT;
            finalTranslate = Math.max(minTranslate, Math.min(maxTranslate, finalTranslate));

            setTranslate(finalTranslate, true);
        };

        const onStart = (e) => {
            isDragging = true;
            startY = e.touches ? e.touches[0].clientY : e.clientY;
            startTranslate = parseFloat(wheel.style.transform.replace('translateY(', '')) || 0;
            wheel.style.transition = 'none';
            e.preventDefault();
        };

        const onMove = (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const currentY = e.touches ? e.touches[0].clientY : e.clientY;
            const deltaY = currentY - startY;
            setTranslate(startTranslate + deltaY);
        };

        const onEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            snap();
        };

        wheel.parentElement.addEventListener('mousedown', onStart);
        wheel.parentElement.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchend', onEnd);

        setTranslate(0);

        return {
            setValue: (value) => {
                const index = items.findIndex(item => String(item.value) === String(value));
                if (index > -1) {
                    const targetTranslate = -index * ITEM_HEIGHT;
                    setTranslate(targetTranslate, true);
                }
            },
            getValue: () => wheel.querySelector('.selected')?.dataset.value,
        };
    };

    const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    const monthItems = thaiMonths.map((label, index) => ({ label, value: index }));
    const currentYear = new Date().getFullYear();
    const yearItems = Array.from({ length: 21 }, (_, i) => {
        const year = currentYear - 10 + i;
        return { label: year + 543, value: year };
    });
    const dayOfWeekItems = [
        { label: 'จันทร์', value: '1' }, { label: 'อังคาร', value: '2' },
        { label: 'พุธ', value: '3' }, { label: 'พฤหัสบดี', value: '4' },
        { label: 'ศุกร์', value: '5' }, { label: 'เสาร์', value: '6' },
        { label: 'อาทิตย์', value: '0' }
    ];

    const monthWheel = createWheel('month-wheel', monthItems);
    const yearWheel = createWheel('year-wheel', yearItems);
    const dayOfWeekWheel = createWheel('day-of-week-wheel', dayOfWeekItems);

    let currentPicker = null;

    const openPicker = (config) => {
        currentPicker = config;
        openModal(config.modal);
    };

    document.getElementById('recurring-startDate-picker').addEventListener('click', (e) => {
        const targetButton = e.currentTarget;
        const targetInput = document.getElementById('recurring-startDate');
        const [year, month] = (targetInput.value || `${new Date().getFullYear()}-${new Date().getMonth()+1}`).split('-').map(Number);
        
        monthWheel.setValue(month - 1);
        yearWheel.setValue(year);

        openPicker({
            modal: document.getElementById('month-year-picker-modal'),
            targetButton, targetInput,
            onConfirm: () => {
                const selectedMonth = monthWheel.getValue();
                const selectedYear = yearWheel.getValue();
                targetInput.value = `${selectedYear}-${String(parseInt(selectedMonth) + 1).padStart(2, '0')}`;
                targetButton.textContent = `${thaiMonths[selectedMonth]} ${parseInt(selectedYear) + 543}`;
            }
        });
    });

    document.getElementById('recurring-endDate-picker').addEventListener('click', (e) => {
        const targetButton = e.currentTarget;
        const targetInput = document.getElementById('recurring-endDate');
        const [year, month] = (targetInput.value || `${new Date().getFullYear()}-${new Date().getMonth()+1}`).split('-').map(Number);
        
        monthWheel.setValue(month - 1);
        yearWheel.setValue(year);

        openPicker({
            modal: document.getElementById('month-year-picker-modal'),
            targetButton, targetInput,
            onConfirm: () => {
                const selectedMonth = monthWheel.getValue();
                const selectedYear = yearWheel.getValue();
                targetInput.value = `${selectedYear}-${String(parseInt(selectedMonth) + 1).padStart(2, '0')}`;
                targetButton.textContent = `${thaiMonths[selectedMonth]} ${parseInt(selectedYear) + 543}`;
            }
        });
    });

    document.getElementById('recurring-dayOfWeek-picker').addEventListener('click', (e) => {
        const targetButton = e.currentTarget;
        const targetInput = document.getElementById('recurring-dayOfWeek');
        
        dayOfWeekWheel.setValue(targetInput.value);

        openPicker({
            modal: document.getElementById('weekly-picker-modal'),
            targetButton, targetInput,
            onConfirm: () => {
                const selectedDay = dayOfWeekWheel.getValue();
                const selectedDayLabel = dayOfWeekItems.find(d => d.value === selectedDay)?.label;
                targetInput.value = selectedDay;
                targetButton.textContent = selectedDayLabel;
            }
        });
    });

    document.querySelectorAll('[data-action="picker-confirm"]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentPicker && typeof currentPicker.onConfirm === 'function') {
                currentPicker.onConfirm();
            }
            if (currentPicker) closeModal(currentPicker.modal);
            currentPicker = null;
        });
    });
    document.querySelectorAll('[data-action="picker-cancel"]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentPicker) closeModal(currentPicker.modal);
            currentPicker = null;
        });
    });

    const weeklyOptions = document.getElementById('weekly-options');
    const monthlyOptions = document.getElementById('monthly-options');
    const yearlyOptions = document.getElementById('yearly-options');
    const dayOfMonthSelect = document.getElementById('recurring-dayOfMonth');
    const dayOfMonthYearlySelect = document.getElementById('recurring-dayOfMonthYearly');
    let dayOptionsHTML = Array.from({length: 31}, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    dayOptionsHTML += `<option value="last">วันสิ้นเดือน</option>`;
    dayOfMonthSelect.innerHTML = dayOptionsHTML;
    dayOfMonthYearlySelect.innerHTML = dayOptionsHTML;
    const monthOfYearSelect = document.getElementById('recurring-monthOfYear');
    monthOfYearSelect.innerHTML = thaiMonths.map((month, index) => `<option value="${index}">${month}</option>`).join('');
    
    document.getElementById('recurring-frequency-group').addEventListener('click', (e) => {
        const btn = e.target.closest('.freq-btn');
        if (!btn) return;
        const selected = btn.dataset.frequency;

        document.querySelectorAll('#recurring-frequency-group .freq-btn').forEach(b => {
            const isActive = b === btn;
            b.classList.toggle('bg-indigo-600', isActive);
            b.classList.toggle('text-white', isActive);
            b.classList.toggle('text-gray-500', !isActive);
            b.classList.toggle('dark:text-gray-400', !isActive);
        });

        weeklyOptions.classList.toggle('hidden', selected !== 'weekly');
        monthlyOptions.classList.toggle('hidden', selected !== 'monthly');
        yearlyOptions.classList.toggle('hidden', selected !== 'yearly');
    });
    
    document.body.addEventListener('click', async e => {
        const target = e.target;
        const id = target.closest('[data-id]')?.dataset.id;
        
        if (!id && !target.closest('.close-modal-button') && !target.closest('[data-action]')) return;

        const editHandlers = {
            'edit-account-btn': { stateKey: 'accounts', modalId: 'account-modal', title: 'แก้ไขบัญชี', afterOpen: () => {
                document.getElementById('account-balance').disabled = true;
                document.getElementById('account-type').disabled = true;
                document.getElementById('account-creditLimit').disabled = true;
                document.getElementById('account-currency').disabled = true;
                document.getElementById('account-type').dispatchEvent(new Event('change'));
            }},
            'edit-category-btn': { stateKey: 'categories', modalId: 'category-modal', title: 'แก้ไขหมวดหมู่' },
            'edit-goal-btn': { stateKey: 'goals', modalId: 'goal-modal', title: 'แก้ไขเป้าหมาย', afterOpen: () => document.getElementById('goal-currentAmount').disabled = true },
            'edit-recurring-btn': {
                stateKey: 'recurring', modalId: 'recurring-modal', title: 'แก้ไขรายการประจำ',
                afterOpen: () => {
                    setTimeout(() => {
                        const form = document.getElementById('recurring-form');
                        const item = state.editingItem;
                        if (!item) return;
                        
                        document.querySelector(`#recurring-frequency-group .freq-btn[data-frequency="${item.frequency}"]`).click();

                        if(item.startDate) {
                            const startDate = new Date(item.startDate);
                            const startValue = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
                            form.querySelector('#recurring-startDate').value = startValue;
                            form.querySelector('#recurring-startDate-picker').textContent = `${thaiMonths[startDate.getMonth()]} ${startDate.getFullYear() + 543}`;
                        }
                        if(item.endDate) {
                            const endDate = new Date(item.endDate);
                            const endValue = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
                            form.querySelector('#recurring-endDate').value = endValue;
                            form.querySelector('#recurring-endDate-picker').textContent = `${thaiMonths[endDate.getMonth()]} ${endDate.getFullYear() + 543}`;
                        }

                        if (item.frequency === 'weekly') {
                            form['recurring-dayOfWeek'].value = item.dayOfWeek;
                            form['recurring-dayOfWeek-picker'].textContent = dayOfWeekItems.find(d => d.value === item.dayOfWeek)?.label || 'เลือกวัน';
                        } else if (item.frequency === 'monthly') {
                            form['recurring-monthInterval'].value = item.monthInterval || 1;
                            form['recurring-dayOfMonth'].value = item.dayOfMonth;
                        } else if (item.frequency === 'yearly') {
                            form['recurring-yearInterval'].value = item.yearInterval || 1;
                            form['recurring-monthOfYear'].value = item.monthOfYear;
                            form['recurring-dayOfMonthYearly'].value = item.dayOfMonth;
                        }
                    }, 0);
                }
            },
            'edit-debt-btn': { stateKey: 'debts', modalId: 'debt-modal', title: 'แก้ไขรายการหนี้สิน' },
            'edit-investment-btn': { stateKey: 'investments', modalId: 'investment-modal', title: 'แก้ไขทรัพย์สิน' }
        };
        for (const [btnClass, config] of Object.entries(editHandlers)) {
            if (target.closest(`.${btnClass}`)) {
                const item = state[config.stateKey].find(i => i.id === id); if (!item) return;
                state.editingItem = item;
                const modal = document.getElementById(config.modalId);
                modal.querySelector('h3').textContent = config.title;
                const form = modal.querySelector('form');
                if (form) form.reset();
                form.querySelector('input[type=hidden]')?.setAttribute('value', item.id);
                Object.entries(item).forEach(([key, value]) => {
                    const input = form.querySelector(`#${form.id.split('-')[0]}-${key}`);
                    if (input && input.type !== 'hidden') input.value = value;
                });
                if(config.stateKey === 'recurring') {
                    populateSelect('recurring-account', state.accounts, { selectedValue: item.accountId });
                    populateSelect('recurring-category', state.categories.filter(c=>c.type === item.type), { selectedValue: item.categoryId });
                }
                config.afterOpen?.();
                openModal(modal);
                return;
            }
        }
        if(target.closest('.edit-transaction-btn')) { const tx = state.transactions.find(t=>t.id===id); if(tx) setupTransactionModal(tx.type, tx); return; }
        const deleteHandlers = {
            'delete-account-btn': { msg: 'การลบบัญชีจะลบธุรกรรมและหนี้สินที่เกี่ยวข้องทั้งหมดด้วย?', onConfirm: async () => {
                const batch = writeBatch(db);
                const accountToDelete = state.accounts.find(a => a.id === id);
                if (accountToDelete.type === 'creditcard') {
                    const debtQuery = query(dbRefs.debts, where('linkedAccountId', '==', id));
                    const debtSnapshot = await getDocs(debtQuery);
                    debtSnapshot.forEach(doc => batch.delete(doc.ref));
                }
                const txsToDelete = await getDocs(query(dbRefs.transactions, where('accountId', '==', id)));
                txsToDelete.forEach(doc => batch.delete(doc.ref));
                batch.delete(doc(dbRefs.accounts, id));
                await batch.commit();
            }},
            'delete-category-btn': { msg: 'แน่ใจหรือไม่?', onConfirm: async () => await deleteDoc(doc(dbRefs.categories, id)) },
            'delete-transaction-btn': { msg: 'การลบจะคืนเงิน/หักเงินกลับเข้าบัญชี', onConfirm: async () => { const txToDelete = state.transactions.find(t=>t.id===id); if(txToDelete) await handleTransaction(txToDelete, true); }},
            'delete-budget-btn': { msg: 'แน่ใจหรือไม่?', onConfirm: async () => await deleteDoc(doc(dbRefs.budgets, id)) },
            'delete-goal-btn': { msg: 'แน่ใจหรือไม่?', onConfirm: async () => await deleteDoc(doc(dbRefs.goals, id)) },
            'delete-recurring-btn': { msg: 'แน่ใจหรือไม่?', onConfirm: async () => await deleteDoc(doc(dbRefs.recurring, id)) },
            'delete-debt-btn': { msg: 'แน่ใจหรือไม่?', onConfirm: async () => await deleteDoc(doc(dbRefs.debts, id)) },
            'delete-investment-btn': { msg: 'แน่ใจหรือไม่?', onConfirm: async () => await deleteDoc(doc(dbRefs.investments, id)) },
        };
        for (const [btnClass, config] of Object.entries(deleteHandlers)) { if (target.closest(`.${btnClass}`)) { showConfirmModal('ยืนยันการลบ', config.msg, async () => { try { await config.onConfirm(); showToast('ลบสำเร็จ!'); } catch (e) { showToast('เกิดข้อผิดพลาด: ' + e.message); console.error(e); }}); return; }}
        if(target.closest('.add-to-goal-btn')) { const goal = state.goals.find(g => g.id === id); if(!goal) return; document.getElementById('add-to-goal-modal-title').textContent = `ออมเงินเข้า "${goal.name}"`; document.getElementById('add-to-goal-id').value = id; populateSelect('add-to-goal-account', state.accounts.filter(a => a.type !== 'creditcard' && a.currency === goal.currency)); openModal(document.getElementById('add-to-goal-modal')); return; }
        if(target.closest('.record-recurring-btn')) {
            const recurringItem = state.recurring.find(item => item.id === id); if(!recurringItem) return;
            const account = state.accounts.find(a => a.id === recurringItem.accountId);
            const currency = account ? account.currency : 'THB';
            const confirmMessage = `คุณต้องการบันทึกรายการ '${recurringItem.notes || 'N/A'}' จำนวน ${formatCurrency(recurringItem.amount, currency)} สำหรับวันนี้หรือไม่?`;
            showConfirmModal('ยืนยันการบันทึก', confirmMessage, async () => {
                const txData = { amount: recurringItem.amount, accountId: recurringItem.accountId, categoryId: recurringItem.categoryId, type: recurringItem.type, notes: `รายการประจำ: ${recurringItem.notes || state.categories.find(c=>c.id === recurringItem.categoryId)?.name || ''}`, date: Timestamp.now(), createdAt: Timestamp.now() };
                try {
                    await runTransaction(db, async (t) => {
                        if (!account) throw new Error("ไม่พบบัญชี"); const accRef = doc(dbRefs.accounts, txData.accountId);
                        if (account.type === 'creditcard' && txData.type === 'expense') {
                            const debtQuery = query(dbRefs.debts, where('linkedAccountId', '==', account.id));
                            const debtSnapshot = await getDocs(debtQuery);
                            if (debtSnapshot.empty) throw new Error("ไม่พบบัตรเครดิตที่เชื่อมโยงกับหนี้สิน");
                            const debtRef = debtSnapshot.docs[0].ref;
                            const debtDoc = await t.get(debtRef);
                            t.update(debtRef, { currentAmount: debtDoc.data().currentAmount + txData.amount });
                        } else {
                            const accDoc = await t.get(accRef); const currentBalance = accDoc.data().balance;
                            if (txData.type === 'expense' && currentBalance < txData.amount) throw new Error("ยอดเงินไม่เพียงพอ");
                            t.update(accRef, { balance: txData.type === 'expense' ? currentBalance - txData.amount : currentBalance + txData.amount });
                        }
                        t.set(doc(dbRefs.transactions), txData);
                    });
                    showToast('บันทึกรายการประจำสำเร็จ!');
                } catch (err) { showToast('เกิดข้อผิดพลาด: ' + err.message); console.error(err); }
            });
            return;
        }
        if(target.closest('.pay-debt-btn')) {
            const debt = state.debts.find(d => d.id === id); if (!debt) return;
            const modal = document.getElementById('debt-payment-modal'); const isLiability = debt.type === 'liability';
            modal.querySelector('h3').textContent = isLiability ? `ชำระหนี้: ${debt.name}` : `รับชำระ: ${debt.name}`;
            modal.querySelector('#debt-payment-account-label').textContent = isLiability ? 'จากบัญชี' : 'เข้าบัญชี';
            modal.querySelector('#debt-payment-submit-button').textContent = isLiability ? 'ชำระเงิน' : 'รับชำระ';
            modal.querySelector('#debt-payment-id').value = id; populateSelect('debt-payment-account', state.accounts.filter(a => a.type !== 'creditcard' && a.currency === debt.currency));
            modal.querySelector('form').reset(); openModal(modal); return;
        }
    });

    const forms = {
        'category-form': { collectionName: 'categories', data: f => ({ name: f['category-name'].value, type: f['category-type'].value, createdAt: Timestamp.now() }) },
        'budget-form': { collectionName: 'budgets', data: f => ({ categoryId: f['budget-category'].value, amount: parseFloat(f['budget-amount'].value), currency: f['budget-currency'].value, createdAt: Timestamp.now() }) },
        'goal-form': { collectionName: 'goals', data: f => ({ name: f['goal-name'].value, currency: f['goal-currency'].value, targetAmount: parseFloat(f['goal-targetAmount'].value), currentAmount: parseFloat(f['goal-currentAmount'].value), createdAt: Timestamp.now() }), updateData: f => ({ name: f['goal-name'].value, targetAmount: parseFloat(f['goal-targetAmount'].value) }) },
        'recurring-form': {
            collectionName: 'recurring',
            data: (form) => {
                const activeBtn = form.querySelector('.freq-btn.bg-indigo-600');
                const frequency = activeBtn ? activeBtn.dataset.frequency : 'monthly';
                const getLastDayOfMonth = (year, month) => new Date(year, month, 0).getDate();
                
                const getFullDate = (dateStr, type) => {
                    if (!dateStr) return null;
                    const [year, month] = dateStr.split('-').map(Number);
                    if (type === 'start') return `${year}-${String(month).padStart(2, '0')}-01`;
                    const lastDay = getLastDayOfMonth(year, month);
                    return `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
                };

                const recurringData = {
                    type: form['recurring-type'].value,
                    categoryId: form['recurring-category'].value,
                    accountId: form['recurring-account'].value,
                    amount: parseFloat(form['recurring-amount'].value),
                    notes: form['recurring-notes'].value,
                    frequency: frequency,
                    startDate: getFullDate(form['recurring-startDate'].value, 'start'),
                    endDate: getFullDate(form['recurring-endDate'].value, 'end'),
                    dayOfWeek: frequency === 'weekly' ? form['recurring-dayOfWeek'].value : null,
                    monthInterval: frequency === 'monthly' ? parseInt(form['recurring-monthInterval'].value) : null,
                    dayOfMonth: (frequency === 'monthly' || frequency === 'yearly')
                        ? (frequency === 'monthly' ? form['recurring-dayOfMonth'].value : form['recurring-dayOfMonthYearly'].value)
                        : null,
                    yearInterval: frequency === 'yearly' ? parseInt(form['recurring-yearInterval'].value) : null,
                    monthOfYear: frequency === 'yearly' ? form['recurring-monthOfYear'].value : null,
                    createdAt: Timestamp.now()
                };
                return recurringData;
            },
            updateData: (form) => {
                const activeBtn = form.querySelector('.freq-btn.bg-indigo-600');
                const frequency = activeBtn ? activeBtn.dataset.frequency : 'monthly';
                const getLastDayOfMonth = (year, month) => new Date(year, month, 0).getDate();
                const getFullDate = (dateStr, type) => {
                if (!dateStr) return null;
                const [year, month] = dateStr.split('-').map(Number);
                if (type === 'start') return `${year}-${String(month).padStart(2, '0')}-01`;
                const lastDay = getLastDayOfMonth(year, month);
                return `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
            };

            return {
                    type: form['recurring-type'].value,
                    categoryId: form['recurring-category'].value,
                    accountId: form['recurring-account'].value,
                    amount: parseFloat(form['recurring-amount'].value),
                    notes: form['recurring-notes'].value,
                    frequency: frequency,
                    startDate: getFullDate(form['recurring-startDate'].value, 'start'),
                    endDate: getFullDate(form['recurring-endDate'].value, 'end'),
                    dayOfWeek: frequency === 'weekly' ? form['recurring-dayOfWeek'].value : null,
                    monthInterval: frequency === 'monthly' ? parseInt(form['recurring-monthInterval'].value) : null,
                    dayOfMonth: (frequency === 'monthly' || frequency === 'yearly')
                        ? (frequency === 'monthly' ? form['recurring-dayOfMonth'].value : form['recurring-dayOfMonthYearly'].value)
                        : null,
                    yearInterval: frequency === 'yearly' ? parseInt(form['recurring-yearInterval'].value) : null,
                    monthOfYear: frequency === 'yearly' ? form['recurring-monthOfYear'].value : null,
            };
            }
        },
        'debt-form': { collectionName: 'debts', data: f => ({ name: f['debt-name'].value, currency: f['debt-currency'].value, type: f['debt-type'].value, totalAmount: parseFloat(f['debt-totalAmount'].value), currentAmount: parseFloat(f['debt-currentAmount'].value), createdAt: Timestamp.now() }) },
        'investment-form': { collectionName: 'investments', data: f => ({ name: f['investment-name'].value, currency: f['investment-currency'].value, quantity: parseFloat(f['investment-quantity'].value), pricePerUnit: parseFloat(f['investment-pricePerUnit'].value), createdAt: Timestamp.now() }) },
    };
    for (const [formId, config] of Object.entries(forms)) {
        document.getElementById(formId).addEventListener('submit', async e => {
            e.preventDefault();
            if (!state.isDbReady) { showToast('Database not ready. Please wait.'); return; }
            const data = config.data(e.target);
            const updateData = config.updateData ? config.updateData(e.target) : data;
            const collectionRef = dbRefs[config.collectionName];
            try {
                if (state.editingItem) {
                    await updateDoc(doc(collectionRef, state.editingItem.id), updateData);
                } else {
                    await addDoc(collectionRef, data);
                }
                showToast('บันทึกสำเร็จ!');
                closeModal(e.target.closest('.modal-backdrop'));
            } catch (err) { showToast('เกิดข้อผิดพลาด'); console.error(err); }
        });
    }
    document.getElementById('account-form').addEventListener('submit', async e => {
        e.preventDefault();
        if (!state.isDbReady) { showToast('Database not ready. Please wait.'); return; }
        const form = e.target;
        const data = {
            name: form['account-name'].value,
            balance: parseFloat(form['account-balance'].value),
            type: form['account-type'].value,
            currency: form['account-currency'].value,
            accountNumber: form['account-accountNumber'].value || null,
            creditLimit: form['account-creditLimit'].value ? parseFloat(form['account-creditLimit'].value) : null,
            statementDate: form['account-statementDate'].value || null,
            createdAt: Timestamp.now()
        };

        try {
            if (state.editingItem) { 
                await updateDoc(doc(dbRefs.accounts, state.editingItem.id), { 
                    name: data.name,
                    accountNumber: data.accountNumber,
                    statementDate: data.statementDate
                    // We don't update creditLimit here for simplicity, could be added.
                }); 
            } else {
                const newAccountRef = doc(collection(db, `users/${state.currentUser.uid}/accounts`));
                if (data.type === 'creditcard') {
                    // Credit cards start with 0 balance in the account, the debt is tracked separately.
                    data.balance = 0;
                    const debtData = { name: `บัตรเครดิต: ${data.name}`, currency: data.currency, type: 'liability', totalAmount: data.creditLimit, currentAmount: parseFloat(form['account-balance'].value) || 0, linkedAccountId: newAccountRef.id, createdAt: Timestamp.now() };
                    await setDoc(newAccountRef, data);
                    await addDoc(dbRefs.debts, debtData);
                } else { 
                    await setDoc(newAccountRef, data); 
                }
            }
            showToast('บันทึกบัญชีสำเร็จ!'); 
            closeModal(document.getElementById('account-modal'));
        } catch (err) { 
            showToast('เกิดข้อผิดพลาด: ' + err.message); 
            console.error(err); 
        }
    });
    document.getElementById('add-to-goal-form').addEventListener('submit', async e => {
        e.preventDefault(); const goalId = e.target['add-to-goal-id'].value; const amount = parseFloat(e.target['add-to-goal-amount'].value);
        const accountId = e.target['add-to-goal-account'].value; const goal = state.goals.find(g=>g.id===goalId); if(!goal || !accountId) return;
        const txData = { amount, accountId, type: 'expense', notes: `ออมเงินเข้าเป้าหมาย: ${goal.name}`, date: Timestamp.now(), createdAt: Timestamp.now() };
        try {
            await runTransaction(db, async (t) => {
                const accRef = doc(dbRefs.accounts, accountId); const goalRef = doc(dbRefs.goals, goalId);
                const accDoc = await t.get(accRef); if(accDoc.data().balance < amount) throw new Error("ยอดเงินไม่เพียงพอ");
                t.update(accRef, { balance: accDoc.data().balance - amount });
                t.update(goalRef, { currentAmount: goal.currentAmount + amount });
                t.set(doc(dbRefs.transactions), txData);
            });
            showToast('ออมเงินสำเร็จ!'); closeModal(document.getElementById('add-to-goal-modal'));
        } catch(err) { showToast('เกิดข้อผิดพลาด: ' + err.message); console.error(err); }
    });
    document.getElementById('transaction-form').addEventListener('submit', e => { e.preventDefault(); handleTransaction(state.editingItem, false); });
    document.getElementById('debt-payment-form').addEventListener('submit', async e => {
        e.preventDefault(); const form = e.target; const debtId = form['debt-payment-id'].value; const amount = parseFloat(form['debt-payment-amount'].value);
        const accountId = form['debt-payment-account'].value; const debt = state.debts.find(d => d.id === debtId); if (!debt || !accountId || !amount) return;
        const isLiability = debt.type === 'liability';
        const txData = { amount, accountId, type: isLiability ? 'expense' : 'income', notes: `${isLiability ? 'ชำระหนี้' : 'รับชำระคืน'}: ${debt.name}`, date: Timestamp.now(), createdAt: Timestamp.now() };
        try {
            await runTransaction(db, async (t) => {
                const accRef = doc(dbRefs.accounts, accountId); const debtRef = doc(dbRefs.debts, debtId);
                const accDoc = await t.get(accRef); const currentBalance = accDoc.data().balance;
                if (isLiability && currentBalance < amount) throw new Error("ยอดเงินไม่เพียงพอ");
                t.update(accRef, { balance: isLiability ? currentBalance - amount : currentBalance + amount });
                t.update(debtRef, { currentAmount: Math.max(0, debt.currentAmount - amount) });
                t.set(doc(dbRefs.transactions), txData);
            });
            showToast('บันทึกสำเร็จ!'); closeModal(document.getElementById('debt-payment-modal'));
        } catch(err) { showToast('เกิดข้อผิดพลาด: ' + err.message); console.error(err); }
    });

    document.querySelector('#transaction-modal').addEventListener('click', e => { const btn = e.target.closest('.transaction-type-btn'); if(btn) setupTransactionModal(btn.dataset.type, state.editingItem); });
    document.getElementById('export-csv-button').addEventListener('click', () => {
        const filters = {
            searchTerm: document.getElementById('history-search').value,
            dateFrom: document.getElementById('filter-date-from').value ? new Date(document.getElementById('filter-date-from').value) : null,
            dateTo: document.getElementById('filter-date-to').value ? new Date(document.getElementById('filter-date-to').value) : null,
            type: document.getElementById('filter-type').value,
            account: document.getElementById('filter-account').value,
            category: document.getElementById('filter-category').value,
        };
        if(filters.dateTo) filters.dateTo.setHours(23, 59, 59, 999);
        
        const transactionsToExport = getFilteredTransactions(filters);
        
        if (transactionsToExport.length === 0) {
            showToast('ไม่มีข้อมูลสำหรับ Export');
            return;
        }

        const headers = ['Date', 'Type', 'Category', 'Amount', 'Currency', 'Account', 'Notes'];
        
        const rows = transactionsToExport.map(tx => {
            const date = tx.date.toDate().toISOString().split('T')[0];
            const category = state.categories.find(c => c.id === tx.categoryId)?.name || '';
            let accountName = '';
            let currency = 'THB';

            if (tx.type === 'transfer') {
                const fromAcc = state.accounts.find(a => a.id === tx.fromAccountId);
                const toAcc = state.accounts.find(a => a.id === tx.toAccountId);
                accountName = `From: ${fromAcc?.name || 'N/A'} To: ${toAcc?.name || 'N/A'}`;
                if (fromAcc) currency = fromAcc.currency;
            } else {
                const acc = state.accounts.find(a => a.id === tx.accountId);
                accountName = acc?.name || 'N/A';
                if (acc) currency = acc.currency;
            }
            
            const notes = tx.notes || '';

            return [date, tx.type, `"${category.replace(/"/g, '""')}"`, tx.amount, currency, `"${accountName.replace(/"/g, '""')}"`, `"${notes.replace(/"/g, '""')}"`];
        });

        const csvContent = "data:text/csv;charset=utf-8," 
            + "\uFEFF" // BOM for Excel
            + headers.join(',') + '\n' 
            + rows.map(e => e.join(',')).join('\n');

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `money_tracker_export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link); 
        link.click();
        document.body.removeChild(link);
    });
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.addEventListener('click', e => {
            if (e.target === modal || e.target.closest('.close-modal-button')) {
                closeModal(modal);
            }
        });
    });

    async function handleTransaction(originalTx, isDelete = false) {
        const form = document.getElementById('transaction-form');
        const newAmount = isDelete ? (originalTx?.amount || 0) : parseFloat(form['transaction-amount'].value);
        const newType = isDelete ? originalTx.type : state.currentTransactionType;
        const newData = isDelete ? {} : { amount: newAmount, type: newType, date: Timestamp.fromDate(new Date(form['transaction-date'].value)), notes: form['transaction-notes'].value };
        if (!isDelete && !originalTx) newData.createdAt = Timestamp.now();

        if (newType !== 'transfer' && !isDelete) { newData.accountId = form['transaction-account'].value; newData.categoryId = form['transaction-category'].value; }
        else if (!isDelete) { newData.fromAccountId = form['transfer-from-account'].value; newData.toAccountId = form['transfer-to-account'].value; }

        try {
            await runTransaction(db, async(t) => {
                const txRef = originalTx ? doc(dbRefs.transactions, originalTx.id) : doc(collection(db, `users/${state.currentUser.uid}/transactions`));
                const accountsToUpdate = new Map();
                const debtsToUpdate = new Map();

                const applyChange = (accId, amount, accType = 'normal', debtId = null) => {
                    if(accType === 'creditcard' && debtId) {
                        debtsToUpdate.set(debtId, (debtsToUpdate.get(debtId) || 0) + amount);
                    } else if (accId) {
                        accountsToUpdate.set(accId, (accountsToUpdate.get(accId) || 0) + amount);
                    }
                };

                if (originalTx) {
                    const acc = state.accounts.find(a => a.id === originalTx.accountId);
                    const debt = acc ? state.debts.find(d => d.linkedAccountId === acc.id) : null;
                    const fromAcc = state.accounts.find(a => a.id === originalTx.fromAccountId);
                    const toAcc = state.accounts.find(a => a.id === originalTx.toAccountId);
                    const toDebt = toAcc ? state.debts.find(d => d.linkedAccountId === toAcc.id) : null;

                    if(originalTx.type === 'expense') applyChange(originalTx.accountId, originalTx.amount, acc?.type, debt?.id);
                    else if(originalTx.type === 'income') applyChange(originalTx.accountId, -originalTx.amount, acc?.type);
                    else if(originalTx.type === 'transfer') {
                        applyChange(originalTx.fromAccountId, originalTx.amount, fromAcc?.type);
                        applyChange(originalTx.toAccountId, -originalTx.amount, toAcc?.type, toDebt?.id);
                    }
                }
                if (!isDelete) {
                    const acc = state.accounts.find(a => a.id === newData.accountId);
                    const debt = acc ? state.debts.find(d => d.linkedAccountId === acc.id) : null;
                    const fromAcc = state.accounts.find(a => a.id === newData.fromAccountId);
                    const toAcc = state.accounts.find(a => a.id === newData.toAccountId);
                    const toDebt = toAcc ? state.debts.find(d => d.linkedAccountId === toAcc.id) : null;

                    if (newType === 'expense') applyChange(newData.accountId, -newAmount, acc?.type, debt?.id);
                    else if (newType === 'income') applyChange(newData.accountId, newAmount, acc?.type);
                    else if (newType === 'transfer') {
                        applyChange(newData.fromAccountId, -newAmount, fromAcc?.type);
                        applyChange(newData.toAccountId, newAmount, toAcc?.type, toDebt?.id);
                    }
                }

                for (const [accId, change] of accountsToUpdate.entries()) {
                    const accRef = doc(dbRefs.accounts, accId);
                    const accDoc = await t.get(accRef);
                    t.update(accRef, { balance: accDoc.data().balance + change });
                }
                for (const [debtId, change] of debtsToUpdate.entries()) {
                    const debtRef = doc(dbRefs.debts, debtId);
                    const debtDoc = await t.get(debtRef);
                    t.update(debtRef, { currentAmount: debtDoc.data().currentAmount + change });
                }

                if(isDelete) t.delete(txRef);
                else if(originalTx) t.update(txRef, newData);
                else t.set(txRef, newData);
            });
            showToast(isDelete ? 'ลบสำเร็จ!' : 'บันทึกสำเร็จ!');
            closeModal(document.getElementById('transaction-modal'));
        } catch (err) { showToast('เกิดข้อผิดพลาด: ' + err.message); console.error(err); }
    }
});