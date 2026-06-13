const { invoke } = window.__TAURI__.core;

let entries = [];
let editingId = null;
let currentType = 'account';
let idleTimeout = null;
let idleTimeLeft = 300; // 5 minutes in seconds
let idleInterval = null;

// Elements
const el = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const exists = await invoke('check_vault_exists');
        if (exists) {
            el('screenLock').classList.remove('hidden');
            const exeDir = await invoke('get_exe_dir');
            el('exeDirLabel').innerText = `数据保存在: ${exeDir}`;
            el('exeDirBox').innerText = exeDir;
        } else {
            el('screenSetup').classList.remove('hidden');
        }
    } catch (e) {
        showToast(`初始化失败: ${e}`, 'error');
    }
    
    // Global Event Listeners
    setupEventListeners();
});

function setupEventListeners() {
    // Auth screens
    el('setupBtn').addEventListener('click', handleSetup);
    el('unlockBtn').addEventListener('click', handleUnlock);
    
    // Main UI
    el('addBtn').addEventListener('click', () => {
        el('addMenu').classList.toggle('open');
    });
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.add-menu-wrap')) {
            el('addMenu').classList.remove('open');
        }
        resetIdleTimer();
    });
    document.addEventListener('keypress', resetIdleTimer);
    
    // Add menu items
    document.querySelectorAll('.add-menu-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = e.target.getAttribute('data-type');
            openFormModal(null, type);
            el('addMenu').classList.remove('open');
        });
    });

    // Form Modal
    el('cancelBtn').addEventListener('click', closeFormModal);
    el('cancelBtn2').addEventListener('click', closeFormModal);
    el('saveBtn').addEventListener('click', handleSaveEntry);
    
    document.querySelectorAll('.type-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (editingId) return; // Prevent switching type while editing
            document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            switchType(e.target.getAttribute('data-type'));
        });
    });

    // Password features
    el('genPwd').addEventListener('click', () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';
        let pwd = '';
        for (let i = 0; i < 16; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
        el('fPassword').value = pwd;
        el('fPassword').type = 'text';
        updatePwdStrength(el('fPassword'), el('pwdBar'));
    });
    
    el('togglePwd').addEventListener('click', () => togglePwdVisibility('fPassword'));
    
    document.querySelectorAll('.pwd-eye').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            togglePwdVisibility(targetId);
        });
    });

    // Strength bars
    el('setupPwd').addEventListener('input', (e) => updatePwdStrength(e.target, el('setupPwdBar')));
    el('fPassword').addEventListener('input', (e) => updatePwdStrength(e.target, el('pwdBar')));
    el('sNewPwd').addEventListener('input', (e) => updatePwdStrength(e.target, el('sNewPwdBar')));

    // Toolbar
    el('searchInput').addEventListener('input', renderCards);
    el('typeFilter').addEventListener('change', renderCards);
    el('catFilter').addEventListener('change', renderCards);
    
    el('lockBtn').addEventListener('click', lockVault);
    el('settingsBtn').addEventListener('click', () => el('settingsModal').classList.add('open'));
    el('settingsClose').addEventListener('click', () => el('settingsModal').classList.remove('open'));
    el('settingsClose2').addEventListener('click', () => el('settingsModal').classList.remove('open'));
    
    el('changePwdBtn').addEventListener('click', handleChangePassword);
    
    el('viewHistoryBtn').addEventListener('click', openHistoryModal);
    el('historyClose').addEventListener('click', () => el('historyModal').classList.remove('open'));
    el('historyClose2').addEventListener('click', () => el('historyModal').classList.remove('open'));

    // Confirm Modal
    el('confirmNo').addEventListener('click', () => el('confirmOverlay').classList.remove('open'));

    // Import/Export
    el('importBtn').addEventListener('click', () => el('importFile').click());
    el('importFile').addEventListener('change', handleImport);
    el('exportBtn').addEventListener('click', handleExport);
    
    // Formats
    el('fCardNumber').addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        val = val.replace(/(.{4})/g, '$1 ').trim();
        e.target.value = val;
    });
}

function togglePwdVisibility(id) {
    const input = el(id);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
}

function scorePassword(pwd) {
    let score = 0;
    if (!pwd) return 0;
    if (pwd.length > 8) score += 1;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1;
    if (/\d/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
    if (pwd.length > 12) score += 1;
    return Math.min(4, Math.max(1, score));
}

function updatePwdStrength(input, barElement) {
    const score = scorePassword(input.value);
    barElement.setAttribute('data-strength', input.value ? score : '0');
}

async function handleSetup() {
    const pwd = el('setupPwd').value;
    const confirm = el('setupPwdConfirm').value;
    
    if (pwd.length < 6) return showToast('主密码至少需要 6 位字符', 'error');
    if (pwd !== confirm) return showToast('两次输入的密码不一致', 'error');
    
    try {
        el('setupBtn').disabled = true;
        await invoke('setup_master_password', { password: pwd });
        el('screenSetup').classList.add('hidden');
        enterMainApp([]);
    } catch (e) {
        showToast(e, 'error');
        el('setupBtn').disabled = false;
    }
}

async function handleUnlock() {
    const pwd = el('lockPwd').value;
    if (!pwd) return;
    
    el('lockError').classList.add('hidden');
    el('unlockSpinner').classList.remove('hidden');
    el('unlockBtnText').classList.add('hidden');
    el('unlockBtn').disabled = true;
    
    try {
        const data = await invoke('unlock_vault', { password: pwd });
        el('screenLock').classList.add('hidden');
        el('lockPwd').value = '';
        enterMainApp(data);
    } catch (e) {
        el('lockError').textContent = e;
        el('lockError').classList.remove('hidden');
    } finally {
        el('unlockSpinner').classList.add('hidden');
        el('unlockBtnText').classList.remove('hidden');
        el('unlockBtn').disabled = false;
    }
}

function enterMainApp(data) {
    entries = data || [];
    el('screenMain').classList.remove('hidden');
    startIdleTimer();
    updateCategories();
    renderCards();
}

function startIdleTimer() {
    resetIdleTimer();
    if (idleInterval) clearInterval(idleInterval);
    idleInterval = setInterval(() => {
        idleTimeLeft--;
        const m = Math.floor(idleTimeLeft / 60);
        const s = idleTimeLeft % 60;
        el('idleCountdown').textContent = `${m}:${s.toString().padStart(2, '0')}`;
        if (idleTimeLeft <= 0) lockVault();
    }, 1000);
}

function resetIdleTimer() {
    idleTimeLeft = 300;
}

async function lockVault() {
    try {
        await invoke('lock_vault');
    } catch(e) { console.error(e); }
    
    clearInterval(idleInterval);
    entries = [];
    el('screenMain').classList.add('hidden');
    el('screenLock').classList.remove('hidden');
    
    // Clear modals
    el('formModal').classList.remove('open');
    el('settingsModal').classList.remove('open');
    el('historyModal').classList.remove('open');
}

function updateCategories() {
    const cats = new Set(entries.map(e => e.category).filter(Boolean));
    const catArray = Array.from(cats).sort();
    
    // Update Filter Select
    const filter = el('catFilter');
    const currentVal = filter.value;
    filter.innerHTML = '<option value="">全部分类</option>';
    catArray.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        filter.appendChild(opt);
    });
    filter.value = currentVal;
    
    // Update Datalist
    const datalist = el('catList');
    datalist.innerHTML = '';
    catArray.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        datalist.appendChild(opt);
    });
    
    // Update Category Tabs
    const tabs = el('categoryTabs');
    const activeTab = tabs.querySelector('.active')?.textContent || '全部';
    tabs.innerHTML = `<button class="category-tab ${activeTab === '全部' ? 'active' : ''}">全部</button>`;
    catArray.forEach(c => {
        const btn = document.createElement('button');
        btn.className = `category-tab ${activeTab === c ? 'active' : ''}`;
        btn.textContent = c;
        tabs.appendChild(btn);
    });
    
    tabs.querySelectorAll('.category-tab').forEach(t => {
        t.addEventListener('click', (e) => {
            tabs.querySelectorAll('.category-tab').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            renderCards();
        });
    });
    
    el('catCount').textContent = catArray.length;
    el('totalCount').textContent = entries.length;
}

function renderCards() {
    const grid = el('cardGrid');
    grid.innerHTML = '';
    
    const search = el('searchInput').value.toLowerCase();
    const typeF = el('typeFilter').value;
    const catF = el('catFilter').value;
    const tabF = el('categoryTabs').querySelector('.active')?.textContent;
    
    let filtered = entries.filter(e => {
        if (typeF && e.type !== typeF) return false;
        if (catF && e.category !== catF) return false;
        if (tabF && tabF !== '全部' && e.category !== tabF) return false;
        
        if (search) {
            const text = [e.name, e.category, e.url, e.username, e.note, e.note_content, e.bank_name].join(' ').toLowerCase();
            if (!text.includes(search)) return false;
        }
        return true;
    });
    
    // Sort by created desc
    filtered.sort((a, b) => b.created_at - a.created_at);
    
    filtered.forEach(entry => {
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('data-type', entry.type);
        
        const typeIcon = entry.type === 'account' ? '🔑' : entry.type === 'secure_note' ? '📝' : '💳';
        
        let bodyHtml = '';
        if (entry.type === 'account') {
            bodyHtml = `
                ${entry.url ? `<div class="card-field"><span class="card-label">网址</span><span class="card-value" onclick="window.open('${entry.url.startsWith('http') ? entry.url : 'http://'+entry.url}')">${entry.url}</span></div>` : ''}
                ${entry.username ? `<div class="card-field"><span class="card-label">账号</span><span class="card-value" onclick="copyText('${entry.username}')">${entry.username}</span></div>` : ''}
                ${entry.password ? `<div class="card-field"><span class="card-label">密码</span><span class="card-value masked" id="pwd-${entry.id}">●●●●●●</span></div>` : ''}
            `;
        } else if (entry.type === 'secure_note') {
            bodyHtml = `<div class="card-field" style="flex-direction:column; align-items:flex-start; max-height:80px; overflow:hidden;"><span class="card-value" style="text-align:left; white-space:normal; -webkit-line-clamp: 3; display: -webkit-box; -webkit-box-orient: vertical;">${entry.note_content || ''}</span></div>`;
        } else if (entry.type === 'bank_card') {
            const maskedCard = entry.card_number ? `**** **** **** ${entry.card_number.slice(-4)}` : '';
            bodyHtml = `
                ${entry.bank_name ? `<div class="card-field"><span class="card-label">银行</span><span class="card-value">${entry.bank_name}</span></div>` : ''}
                ${entry.card_number ? `<div class="card-field"><span class="card-label">卡号</span><span class="card-value masked" id="card-${entry.id}">${maskedCard}</span></div>` : ''}
                ${entry.card_holder ? `<div class="card-field"><span class="card-label">持卡人</span><span class="card-value">${entry.card_holder}</span></div>` : ''}
            `;
        }

        card.innerHTML = `
            <div class="card-header">
                <div class="card-type-icon">${typeIcon}</div>
                <div class="card-meta">
                    <div class="card-name" title="${entry.name}">${entry.name}</div>
                    <div class="card-cat">${entry.category || '未分类'}</div>
                </div>
            </div>
            <div class="card-actions">
                <button class="card-btn edit-btn" title="编辑">✏️</button>
                <button class="card-btn del-btn" title="删除">🗑️</button>
            </div>
            <div class="card-body">
                ${bodyHtml}
                ${entry.note ? `<div style="font-size:12px; color:var(--text-muted); margin-top:8px;">备注: ${entry.note}</div>` : ''}
            </div>
        `;
        
        card.querySelector('.edit-btn').addEventListener('click', () => openFormModal(entry));
        card.querySelector('.del-btn').addEventListener('click', () => handleDelete(entry));
        
        // Setup toggles
        if (entry.type === 'account' && entry.password) {
            const pwdSpan = card.querySelector(`#pwd-${entry.id}`);
            pwdSpan.addEventListener('click', (e) => {
                if (pwdSpan.textContent === '●●●●●●') {
                    pwdSpan.textContent = entry.password;
                    pwdSpan.classList.remove('masked');
                    copyText(entry.password, true);
                } else {
                    pwdSpan.textContent = '●●●●●●';
                    pwdSpan.classList.add('masked');
                }
            });
        }
        if (entry.type === 'bank_card' && entry.card_number) {
            const cardSpan = card.querySelector(`#card-${entry.id}`);
            cardSpan.addEventListener('click', () => {
                if (cardSpan.classList.contains('masked')) {
                    cardSpan.textContent = entry.card_number;
                    cardSpan.classList.remove('masked');
                    copyText(entry.card_number.replace(/\s/g, ''));
                } else {
                    cardSpan.textContent = `**** **** **** ${entry.card_number.slice(-4)}`;
                    cardSpan.classList.add('masked');
                }
            });
        }

        grid.appendChild(card);
    });
}

function switchType(type) {
    currentType = type;
    el('fieldsAccount').classList.add('hidden');
    el('fieldsNote').classList.add('hidden');
    el('fieldsCard').classList.add('hidden');
    
    if (type === 'account') el('fieldsAccount').classList.remove('hidden');
    else if (type === 'secure_note') el('fieldsNote').classList.remove('hidden');
    else if (type === 'bank_card') el('fieldsCard').classList.remove('hidden');
}

function openFormModal(entry = null, defaultType = 'account') {
    editingId = entry ? entry.id : null;
    currentType = entry ? entry.type : defaultType;
    
    // Reset form
    document.querySelectorAll('#formModalInner input, #formModalInner textarea').forEach(el => el.value = '');
    el('fPassword').type = 'password';
    el('fCardCvv').type = 'password';
    updatePwdStrength(el('fPassword'), el('pwdBar'));
    
    if (entry) {
        el('modalTitleText').textContent = '编辑条目';
        el('typeTabs').classList.add('hidden');
        switchType(entry.type);
        
        el('fName').value = entry.name || '';
        el('fCategory').value = entry.category || '';
        el('fNote').value = entry.note || '';
        
        if (entry.type === 'account') {
            el('fUrl').value = entry.url || '';
            el('fUsername').value = entry.username || '';
            el('fPassword').value = entry.password || '';
            updatePwdStrength(el('fPassword'), el('pwdBar'));
            if (entry.password_history && entry.password_history.length > 0) {
                el('historyLink').classList.remove('hidden');
            } else {
                el('historyLink').classList.add('hidden');
            }
        } else if (entry.type === 'secure_note') {
            el('fNoteContent').value = entry.note_content || '';
        } else if (entry.type === 'bank_card') {
            el('fBankName').value = entry.bank_name || '';
            el('fCardHolder').value = entry.card_holder || '';
            el('fCardNumber').value = entry.card_number || '';
            el('fCardExpiry').value = entry.card_expiry || '';
            el('fCardCvv').value = entry.card_cvv || '';
        }
    } else {
        el('modalTitleText').textContent = '添加条目';
        el('typeTabs').classList.remove('hidden');
        document.querySelectorAll('.type-tab').forEach(t => {
            t.classList.toggle('active', t.getAttribute('data-type') === defaultType);
        });
        switchType(defaultType);
        el('historyLink').classList.add('hidden');
    }
    
    el('formModal').classList.add('open');
}

function closeFormModal() {
    el('formModal').classList.remove('open');
}

async function handleSaveEntry() {
    const name = el('fName').value.trim();
    const category = el('fCategory').value.trim() || '默认';
    
    if (!name) return showToast('请输入名称', 'error');
    
    let newEntry = {
        id: editingId || Math.random().toString(36).substr(2, 9),
        type: currentType,
        name,
        category,
        note: el('fNote').value.trim() || null,
        created_at: Date.now()
    };
    
    const oldEntry = editingId ? entries.find(e => e.id === editingId) : null;
    if (oldEntry) {
        newEntry.created_at = oldEntry.created_at;
        newEntry.updated_at = Date.now();
        newEntry.password_history = oldEntry.password_history || [];
    }
    
    if (currentType === 'account') {
        newEntry.url = el('fUrl').value.trim() || null;
        newEntry.username = el('fUsername').value.trim() || null;
        const newPwd = el('fPassword').value;
        newEntry.password = newPwd || null;
        
        if (oldEntry && oldEntry.password && oldEntry.password !== newPwd) {
            newEntry.password_history.unshift({
                password: oldEntry.password,
                changed_at: Date.now()
            });
            if (newEntry.password_history.length > 10) newEntry.password_history.pop();
        }
    } else if (currentType === 'secure_note') {
        const content = el('fNoteContent').value.trim();
        if (!content) return showToast('备忘录内容不能为空', 'error');
        newEntry.note_content = content;
    } else if (currentType === 'bank_card') {
        const cardNum = el('fCardNumber').value.trim();
        if (!cardNum) return showToast('请输入卡号', 'error');
        newEntry.bank_name = el('fBankName').value.trim() || null;
        newEntry.card_holder = el('fCardHolder').value.trim() || null;
        newEntry.card_number = cardNum;
        newEntry.card_expiry = el('fCardExpiry').value.trim() || null;
        newEntry.card_cvv = el('fCardCvv').value.trim() || null;
    }
    
    if (editingId) {
        const idx = entries.findIndex(e => e.id === editingId);
        if (idx !== -1) entries[idx] = newEntry;
    } else {
        entries.push(newEntry);
    }
    
    try {
        await invoke('save_vault', { entries });
        showToast('保存成功', 'success');
        closeFormModal();
        updateCategories();
        renderCards();
    } catch (e) {
        showToast(e, 'error');
    }
}

function handleDelete(entry) {
    el('confirmMsg').textContent = `确定要删除 "${entry.name}" 吗？此操作无法恢复。`;
    el('confirmOverlay').classList.add('open');
    
    const yesBtn = el('confirmYes');
    const newYes = yesBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newYes, yesBtn);
    
    newYes.addEventListener('click', async () => {
        entries = entries.filter(e => e.id !== entry.id);
        try {
            await invoke('save_vault', { entries });
            showToast('已删除', 'success');
            el('confirmOverlay').classList.remove('open');
            updateCategories();
            renderCards();
        } catch (e) {
            showToast(`删除失败: ${e}`, 'error');
        }
    });
}

function openHistoryModal() {
    const entry = entries.find(e => e.id === editingId);
    if (!entry || !entry.password_history || entry.password_history.length === 0) return;
    
    const list = el('historyList');
    list.innerHTML = '';
    
    entry.password_history.forEach(h => {
        const div = document.createElement('div');
        div.className = 'history-item';
        const date = new Date(h.changed_at).toLocaleString();
        div.innerHTML = `
            <div>
                <div class="pwd">${h.password}</div>
                <div class="date">${date}</div>
            </div>
            <button>复制</button>
        `;
        div.querySelector('button').addEventListener('click', () => copyText(h.password, true));
        list.appendChild(div);
    });
    
    el('historyModal').classList.add('open');
}

async function handleChangePassword() {
    const oldPwd = el('sOldPwd').value;
    const newPwd = el('sNewPwd').value;
    const confirm = el('sNewPwdConfirm').value;
    
    if (!oldPwd) return showToast('请输入当前主密码', 'error');
    if (newPwd.length < 6) return showToast('新主密码至少需要 6 位', 'error');
    if (newPwd !== confirm) return showToast('新密码两次输入不一致', 'error');
    
    try {
        el('changePwdBtn').disabled = true;
        await invoke('change_master_password', { oldPassword: oldPwd, newPassword: newPwd });
        showToast('主密码已修改', 'success');
        el('settingsModal').classList.remove('open');
        el('sOldPwd').value = ''; el('sNewPwd').value = ''; el('sNewPwdConfirm').value = '';
    } catch (e) {
        showToast(e, 'error');
    } finally {
        el('changePwdBtn').disabled = false;
    }
}

async function copyText(text, isPassword = false) {
    try {
        if (isPassword) {
            await invoke('copy_password', { text });
            showToast('密码已复制（30秒后自动清除剪贴板）', 'success');
        } else {
            await navigator.clipboard.writeText(text);
            showToast('已复制', 'success');
        }
    } catch (e) {
        showToast('复制失败', 'error');
    }
}

async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        // file.path contains the absolute path in Tauri
        const updatedEntries = await invoke('import_vault_json', { importPath: file.path });
        const addedCount = updatedEntries.length - entries.length;
        entries = updatedEntries;
        showToast(`成功导入 ${addedCount} 个新条目`, 'success');
        updateCategories();
        renderCards();
    } catch (err) {
        showToast(err, 'error');
    }
    e.target.value = ''; // Reset
}

async function handleExport() {
    const defaultName = `keyvault_export_${new Date().toISOString().slice(0,10)}.json`;
    const path = prompt('请输入导出文件的绝对路径（如 C:\\Users\\Public\\backup.json）：\n\n警告：导出文件未加密，请妥善保管！', defaultName);
    if (!path) return;
    
    try {
        await invoke('export_vault_json', { exportPath: path });
        showToast(`已导出至 ${path}`, 'success');
    } catch (err) {
        showToast(err, 'error');
    }
}

function showToast(msg, type = 'info') {
    const container = el('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = typeof msg === 'object' ? JSON.stringify(msg) : msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
