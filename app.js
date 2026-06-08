        // ==================== Supabase Cloud Storage ====================
        const SUPABASE_URL = 'https://aishmynicfrueempsbun.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpc2hteW5pY2ZydWVlbXBzYnVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MDczMTksImV4cCI6MjA5NjE4MzMxOX0.tNxiKnRADMDKJaDYaFpm6gTEg_Nv8bI8Ql05SdGsST4';
        // ⚠️ 替换为你的管理员邮箱
        const ADMIN_EMAIL = 'hvho1982@163.com';
        // 应用地址（邮箱验证回调用）
        const APP_URL = 'https://www.prompt-tool.dedyn.io';
        // Supabase Edge Function 地址（用户管理）
        const MANAGE_USERS_URL = 'https://aishmynicfrueempsbun.supabase.co/functions/v1/manage-users';

        let supabaseClient = null;
        let cloudReady = false;
        let cloudInitPromise = null;

        // 认证状态
        let currentUser = null;       // { id, email, user_metadata }
        let isAdmin = false;          // 是否为管理员
        let adminViewUserId = null;   // 管理员正在查看的用户ID（null=看自己的数据）
        let _adminUsersCache = null;  // 管理员面板用户列表缓存
        let _dataGen = 0;             // 数据代数计数器，切换用户时递增，防止异步保存覆盖
        let authTab = 'login';        // 当前认证标签页
        let _currentAdminTab = 'users'; // 管理员面板当前标签页
        let _confirmCallback = null;  // 确认弹窗回调
        let _adminFilterText = '';    // 用户列表筛选文本

        // 初始化 Supabase 客户端
        function initSupabase() {
            if (cloudInitPromise) return cloudInitPromise;
            cloudInitPromise = (async () => {
                try {
                    // 等待 SDK 加载（最多等 3 秒）
                    if (!window.supabase) {
                        let waited = 0;
                        while (!window.supabase && waited < 30) {
                            await new Promise(r => setTimeout(r, 100));
                            waited++;
                        }
                    }
                    if (!window.supabase) {
                        console.warn('[Supabase] SDK 未加载 (window.supabase 不存在)');
                        cloudReady = false;
                        updateCloudStatus(false);
                        return false;
                    }
                    console.log('[Supabase] SDK 已检测到，创建客户端...');
                    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                        auth: { persistSession: true, storageKey: 'prompt-tool-auth' },
                        global: { headers: { 'x-client-info': 'prompt-tool/2.0' } }
                    });

                    // 监听认证状态变化
                    supabaseClient.auth.onAuthStateChange(async (event, session) => {
                        if (event === 'SIGNED_IN' && session) {
                            // 检查是否被拉黑
                            const blocked = await checkUserBlocked(session.user.id);
                            if (blocked) {
                                await supabaseClient.auth.signOut();
                                updateAuthUI(null);
                                showToast('账户已被限制访问', 'error');
                                return;
                            }
                            const wasLoggedOut = !currentUser;
                            updateAuthUI(session.user);
                            // 新登录（包括邮箱验证后首次登录）自动同步数据
                            if (cloudReady && wasLoggedOut) {
                                reloadCloudData();
                                // 白名单用户加载 API Keys
                                loadWhitelistApiKeys();
                            }
                        } else if (event === 'SIGNED_OUT') {
                            updateAuthUI(null);
                        }
                    });

                    // 检查已有会话（尝试恢复登录状态）
                    let { data: { session } } = await supabaseClient.auth.getSession();
                    
                    // 如果 getSession 返回空，尝试从 localStorage 恢复并刷新
                    if (!session) {
                        try {
                            const stored = localStorage.getItem('prompt-tool-auth');
                            if (stored) {
                                const parsed = JSON.parse(stored);
                                if (parsed && parsed.refresh_token) {
                                    console.log('[Supabase] 发现本地存储的会话，尝试刷新...');
                                    const { data: refreshData, error: refreshErr } = await supabaseClient.auth.refreshSession({ refresh_token: parsed.refresh_token });
                                    if (!refreshErr && refreshData.session) {
                                        session = refreshData.session;
                                        console.log('[Supabase] ✅ 会话已恢复');
                                    } else {
                                        console.warn('[Supabase] 会话刷新失败，需要重新登录:', refreshErr?.message);
                                        // 清除过期的本地存储
                                        localStorage.removeItem('prompt-tool-auth');
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn('[Supabase] 会话恢复异常:', e.message);
                        }
                    }
                    
                    if (session && session.user) {
                        // 检查是否被拉黑
                        const blocked = await checkUserBlocked(session.user.id);
                        if (blocked) {
                            await supabaseClient.auth.signOut();
                            updateAuthUI(null);
                            session = null; // 防止后续验证回调误用
                            showToast('账户已被限制访问', 'error');
                        } else {
                            updateAuthUI(session.user);
                        }
                    } else {
                        // 确保清除旧的登录状态
                        updateAuthUI(null);
                    }
                    // 处理邮箱验证回调（从验证链接跳回）
                    try {
                        const urlParams = new URLSearchParams(window.location.search);
                        const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));
                        const isVerified = urlParams.get('verified') === '1';
                        const hasEmailToken = hashParams.get('type') === 'signup' || hashParams.get('type') === 'email_change';
                        
                        if (isVerified || hasEmailToken) {
                            if (session && session.user) {
                                console.log('[Auth] ✅ 邮箱验证成功，已自动登录');
                                showToast('邮箱验证成功！已自动登录，数据同步中...', 'success');
                                await reloadCloudData();
                            } else if (hasEmailToken) {
                                // Supabase 可能刚验证完但 session 还没就绪，稍等再尝试
                                setTimeout(async () => {
                                    const { data: { session: s2 } } = await supabaseClient.auth.getSession();
                                    if (s2 && s2.user) {
                                        updateAuthUI(s2.user);
                                        showToast('邮箱验证成功！已自动登录，数据同步中...', 'success');
                                        await reloadCloudData();
                                    }
                                }, 1000);
                            }
                            // 清除 URL 中的验证参数
                            if (window.history && window.history.replaceState) {
                                const cleanUrl = window.location.href.split('?')[0].split('#')[0];
                                window.history.replaceState({}, '', cleanUrl);
                            }
                        }
                    } catch (cbErr) {
                        console.warn('[Auth] 验证回调处理异常:', cbErr.message);
                    }

                    cloudReady = true;
                    console.log('[Supabase] ✅ 云端存储已就绪');
                    updateCloudStatus(true);
                    return true;
                } catch (e) {
                    console.warn('[Supabase] 初始化失败，回退到本地存储:', e.message, e);
                    cloudReady = false;
                    updateCloudStatus(false);
                    return false;
                }
            })();
            return cloudInitPromise;
        }



        // 等待云端就绪（带超时）
        async function waitForCloud(ms = 5000) {
            if (cloudReady) return true;
            try {
                const result = await Promise.race([
                    initSupabase(),
                    new Promise(r => setTimeout(() => r(false), ms))
                ]);
                return result === true;
            } catch {
                return false;
            }
        }

        // ==================== 认证模块 ====================
        function getEffectiveUserId() {
            // 返回当前操作的用户ID：管理员查看其他用户时返回目标用户ID
            if (isAdmin && adminViewUserId) return adminViewUserId;
            return currentUser ? currentUser.id : null;
        }

        // 检查用户是否被拉黑
        async function checkUserBlocked(userId) {
            if (!userId || !supabaseClient) return false;
            try {
                const { data } = await supabaseClient.from('user_profiles')
                    .select('status').eq('user_id', userId).maybeSingle();
                return data?.status === 'blocked';
            } catch { return false; }
        }

        function updateAuthUI(user) {
            const loginBtn = document.getElementById('loginBtn');
            const userBadge = document.getElementById('userBadge');
            const userNameEl = document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            const adminTag = document.getElementById('adminTag');
            const adminPanelBtn = document.getElementById('adminPanelBtn');

            if (user) {
                const prevUserId = currentUser?.id;
                currentUser = user;
                isAdmin = (user.email === ADMIN_EMAIL);

                if (loginBtn) loginBtn.style.display = 'none';
                if (userBadge) userBadge.style.display = 'flex';
                if (userNameEl) userNameEl.textContent = isAdmin ? '管理员' : (user.user_metadata?.display_name || user.email?.split('@')[0] || '用户');
                if (userAvatarEl) userAvatarEl.textContent = (user.email || 'U')[0].toUpperCase();
                if (adminTag) adminTag.style.display = isAdmin ? 'inline' : 'none';
                if (adminPanelBtn) adminPanelBtn.style.display = isAdmin ? 'block' : 'none';

                // 只在用户切换或首次登录时重置查看状态（防止 onAuthStateChange 回调打断管理员查看其他用户）
                if (prevUserId !== user.id) {
                    adminViewUserId = null;
                    updateViewingBadge();
                }

                console.log('[Auth] 已登录:', user.email, isAdmin ? '(管理员)' : '');
            } else {
                currentUser = null;
                isAdmin = false;
                adminViewUserId = null;
                updateViewingBadge();
                if (loginBtn) loginBtn.style.display = 'inline-flex';
                if (userBadge) userBadge.style.display = 'none';
                if (adminTag) adminTag.style.display = 'none';
                if (adminPanelBtn) adminPanelBtn.style.display = 'none';
                console.log('[Auth] 已登出');
            }
            closeAllMenus();
        }

        function toggleUserMenu() {
            const menu = document.getElementById('userMenu');
            if (menu) menu.classList.toggle('active');
        }

        function closeAllMenus() {
            const menu = document.getElementById('userMenu');
            if (menu) menu.classList.remove('active');
        }

        function openAuthModal() {
            closeAllMenus();
            document.getElementById('authOverlay').classList.add('active');
            document.getElementById('authError').textContent = '';
            switchAuthTab('login');
        }

        function closeAuthModal() {
            document.getElementById('authOverlay').classList.remove('active');
        }

        function switchAuthTab(tab) {
            authTab = tab;
            const tabs = document.querySelectorAll('.auth-tab');
            tabs.forEach(t => t.classList.remove('active'));
            if (tab === 'login') {
                tabs[0].classList.add('active');
                document.getElementById('authTitle').textContent = '登录';
                document.getElementById('authSub').textContent = '登录后你的公式和词库将云端同步';
                document.getElementById('authSubmitBtn').textContent = '登录';
                document.getElementById('authDisplayNameField').style.display = 'none';
            } else {
                tabs[1].classList.add('active');
                document.getElementById('authTitle').textContent = '注册';
                document.getElementById('authSub').textContent = '创建账号后，数据将自动云端同步';
                document.getElementById('authSubmitBtn').textContent = '注册';
                document.getElementById('authDisplayNameField').style.display = 'block';
            }
            document.getElementById('authError').textContent = '';
        }

        async function doAuth() {
            const email = document.getElementById('authEmail').value.trim();
            const password = document.getElementById('authPassword').value;
            const displayName = document.getElementById('authDisplayName').value.trim();
            const errorEl = document.getElementById('authError');
            const btn = document.getElementById('authSubmitBtn');

            if (!email || !password) {
                errorEl.textContent = '请填写邮箱和密码';
                return;
            }
            if (password.length < 6) {
                errorEl.textContent = '密码至少需要6位';
                return;
            }

            btn.disabled = true;
            btn.textContent = authTab === 'login' ? '登录中...' : '注册中...';
            errorEl.textContent = '';

            try {
                const ok = await waitForCloud();
                if (!ok) { errorEl.textContent = '云端连接失败，请稍后重试'; btn.disabled = false; btn.textContent = authTab === 'login' ? '登录' : '注册'; return; }

                if (authTab === 'login') {
                    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                    if (error) {
                        if (error.message.includes('Invalid login')) errorEl.textContent = '邮箱或密码错误';
                        else if (error.message.includes('Email not confirmed')) errorEl.textContent = '邮箱尚未验证，请查收验证邮件（含垃圾邮件箱）并点击链接。如未收到，请重新注册';
                        else errorEl.textContent = error.message;
                    } else {
                        // 检查用户是否被拉黑
                        const { data: profile } = await supabaseClient.from('user_profiles')
                            .select('status, api_keys').eq('user_id', data.user.id).maybeSingle();
                        
                        if (profile && profile.status === 'blocked') {
                            await supabaseClient.auth.signOut();
                            updateAuthUI(null);
                            errorEl.textContent = '您的账户已被管理员限制访问';
                            showToast('账户已被限制访问，请联系管理员', 'error');
                            btn.disabled = false;
                            btn.textContent = '登录';
                            return;
                        }

                        // 显式设置用户状态
                        updateAuthUI(data.user);
                        closeAuthModal();
                        showToast('登录成功！数据同步中...', 'success');
                        updateCloudStatus(true);
                        await reloadCloudData();

                        // 白名单用户自动加载管理员 API Keys
                        if (profile && profile.status === 'whitelist') {
                            await loadWhitelistApiKeys();
                        }
                        
                        showToast('登录成功！数据已同步', 'success');
                    }
                } else {
                    const { data, error } = await supabaseClient.auth.signUp({
                        email,
                        password,
                        options: {
                            emailRedirectTo: APP_URL + '?verified=1',
                            data: { display_name: displayName || email.split('@')[0] }
                        }
                    });
                    if (error) {
                        if (error.message.includes('already registered')) errorEl.textContent = '该邮箱已注册，请直接登录';
                        else errorEl.textContent = error.message;
                    } else {
                        if (data.user && data.user.identities && data.user.identities.length === 0) {
                            errorEl.textContent = '该邮箱已注册，请直接登录';
                        } else {
                            const needConfirm = data.user?.email_confirmed_at === null && data.session === null;
                            errorEl.textContent = '';
                            if (needConfirm) {
                                showToast('注册成功！验证邮件已发送，请检查邮箱（含垃圾邮件箱）并点击验证链接', 'success');
                            } else {
                                showToast('注册成功！已自动登录', 'success');
                            }
                            switchAuthTab('login');
                            document.getElementById('authEmail').value = email;
                            document.getElementById('authPassword').value = '';
                        }
                    }
                }
            } catch (e) {
                errorEl.textContent = '操作失败: ' + e.message;
            }
            btn.disabled = false;
            btn.textContent = authTab === 'login' ? '登录' : '注册';
        }

        async function doLogout() {
            closeAllMenus();
            await supabaseClient.auth.signOut();
            updateAuthUI(null);
            _formulasCache = null; _formulasLoaded = false;
            _thesaurusCache = null; _thesaurusLoaded = false;
            fallbackToLocalData();
            renderCategories(); renderFormulas(); renderTitleLayout(); renderHistory(); renderImageHistory();
            updateFormulaSelect();
            showToast('已退出登录，使用本地数据', 'warning');
        }

        // ==================== 管理员面板 ====================

        // 调用 Edge Function 管理用户
        async function callManageUsers(action, payload) {
            const ok = await waitForCloud();
            if (!ok) { showToast('云端连接失败', 'error'); return null; }

            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) { showToast('请先登录', 'error'); return null; }

            try {
                const resp = await fetch(MANAGE_USERS_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ action, payload }),
                });
                const result = await resp.json();
                if (!resp.ok) throw new Error(result.error || '操作失败');
                return result;
            } catch (e) {
                showToast('操作失败: ' + e.message, 'error');
                return null;
            }
        }

        // 确认弹窗
        function showConfirm(message, callback) {
            document.getElementById('confirmMessage').textContent = message;
            _confirmCallback = callback;
            document.getElementById('confirmOverlay').style.display = 'flex';
        }
        function closeConfirm() {
            document.getElementById('confirmOverlay').style.display = 'none';
            _confirmCallback = null;
        }
        function executeConfirm() {
            if (_confirmCallback) _confirmCallback();
            closeConfirm();
        }

        // 打开管理员面板
        async function openAdminPanel() {
            closeAllMenus();
            document.getElementById('adminPanelOverlay').classList.add('active');
            _currentAdminTab = 'users';
            resetAdminTabs();
            await loadAdminUsers();
            await loadAdminApiKeysIntoForm();
        }

        function closeAdminPanel() {
            document.getElementById('adminPanelOverlay').classList.remove('active');
            _adminFilterText = '';
            const filterInput = document.getElementById('adminUserFilter');
            if (filterInput) filterInput.value = '';
        }

        function resetAdminTabs() {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            const tabBtn = document.querySelector(`.admin-tab[onclick*="${_currentAdminTab}"]`);
            if (tabBtn) tabBtn.classList.add('active');
            const tabContent = document.getElementById('adminTab' + _currentAdminTab.charAt(0).toUpperCase() + _currentAdminTab.slice(1));
            if (tabContent) tabContent.classList.add('active');
        }

        async function switchAdminTab(tab, btn) {
            _currentAdminTab = tab;
            resetAdminTabs();
            if (tab === 'users') {
                await loadAdminUsers();
            } else if (tab === 'whitelist') {
                await loadWhitelistList();
            } else if (tab === 'apikeys') {
                await loadAdminApiKeysIntoForm();
            }
        }

        function filterAdminUsers() {
            _adminFilterText = (document.getElementById('adminUserFilter')?.value || '').toLowerCase().trim();
            renderAdminUserList();
        }

        async function loadAdminUsers() {
            const listEl = document.getElementById('adminUserList');
            if (!listEl) return;
            listEl.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">加载中...</p>';

            try {
                const { data, error } = await supabaseClient.from('user_profiles').select('*').order('created_at', { ascending: false });
                if (error) { listEl.innerHTML = '<p style="color: var(--error); text-align: center;">加载失败: ' + error.message + '</p>'; return; }

                if (!data || data.length === 0) {
                    _adminUsersCache = [];
                    listEl.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">暂无用户</p>';
                    return;
                }

                _adminUsersCache = data;
                renderAdminUserList();
            } catch (e) {
                listEl.innerHTML = '<p style="color: var(--error); text-align: center;">出错: ' + e.message + '</p>';
            }
        }

        function renderAdminUserList() {
            const listEl = document.getElementById('adminUserList');
            if (!listEl || !_adminUsersCache) return;

            const effectiveId = getEffectiveUserId();
            const currentUserId = currentUser?.id;

            let filtered = _adminUsersCache;
            if (_adminFilterText) {
                filtered = _adminUsersCache.filter(u =>
                    (u.email || '').toLowerCase().includes(_adminFilterText) ||
                    (u.display_name || '').toLowerCase().includes(_adminFilterText)
                );
            }

            const countEl = document.getElementById('adminFilterCount');
            if (countEl) countEl.textContent = `共 ${filtered.length} 人`;

            if (filtered.length === 0) {
                listEl.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">' + (_adminFilterText ? '无匹配用户' : '暂无用户') + '</p>';
                return;
            }

            listEl.innerHTML = filtered.map(u => {
                const isMe = u.user_id === currentUserId;
                const isViewing = u.user_id === effectiveId;
                const isBlocked = u.status === 'blocked';
                const isWhitelist = u.status === 'whitelist';
                const isAdminUser = u.email === ADMIN_EMAIL;
                const statusText = isBlocked ? '已拉黑' : (isWhitelist ? '白名单' : '正常');
                const statusClass = isBlocked ? 'status-blocked' : (isWhitelist ? 'status-whitelist' : 'status-active');

                let actionsHtml = '';
                if (!isMe && !isAdminUser) {
                    if (isBlocked) {
                        actionsHtml = `<button class="admin-btn-action" onclick="event.stopPropagation();unblockUser('${u.user_id}')" title="解除拉黑">解除</button>`;
                    } else {
                        actionsHtml = `<button class="admin-btn-action warn" onclick="event.stopPropagation();blockUser('${u.user_id}')" title="拉黑">拉黑</button>`;
                    }
                    actionsHtml += `<button class="admin-btn-action danger" onclick="event.stopPropagation();deleteUser('${u.user_id}','${escapeHtml(u.email || '')}')" title="删除">删除</button>`;
                }

                return `
                    <div class="admin-user-item${isViewing ? ' selected' : ''}${isBlocked ? ' blocked' : ''}" onclick="switchToUser('${u.user_id}')">
                        <div class="admin-user-left">
                            <div class="user-avatar" style="width:32px;height:32px;font-size:0.8rem;flex-shrink:0;">${(u.email || 'U')[0].toUpperCase()}</div>
                            <div class="admin-user-info">
                                <div class="admin-user-name">
                                    ${escapeHtml(u.display_name || u.email || '未知用户')}
                                    ${isMe ? '<span class="admin-current">（我）</span>' : ''}
                                    ${isAdminUser ? '<span class="admin-badge">管理员</span>' : ''}
                                    <span class="admin-user-status ${statusClass}">${statusText}</span>
                                </div>
                                <div class="admin-user-email">${escapeHtml(u.email || '')}</div>
                            </div>
                        </div>
                        ${actionsHtml ? `<div class="admin-user-actions">${actionsHtml}</div>` : ''}
                    </div>
                `;
            }).join('');
        }

        async function switchToUser(userId) {
            if (!isAdmin) return;
            // 选自己等同于切换回自己
            adminViewUserId = (userId === currentUser?.id) ? null : userId;
            closeAdminPanel();

            // 更新查看状态徽章
            updateViewingBadge();

            // 递增数据代数（仅用于防止过期数据渲染，不再用于取消保存）
            const gen = ++_dataGen;

            // 重置所有缓存（公式、词库、版本快照）
            _formulasCache = null; _formulasLoaded = false;
            _thesaurusCache = null; _thesaurusLoaded = false;
            _versionsCache = null; _versionsLoaded = false;

            // 重置运行时状态
            currentSelections = {};
            currentFormulaId = null;
            modelResults = {};
            modelFed = false;
            fedPromptHash = '';
            currentModelId = null;

            const targetUser = userId === currentUser.id ? '自己' : userId.substring(0, 8) + '...';
            showToast('已切换到用户: ' + targetUser + '，加载数据中...', 'success');

            try {
                const formulas = await getFormulasAsync();
                if (gen !== _dataGen) return;
                const thesaurus = await getThesaurusAsync();
                if (gen !== _dataGen) return;
                console.log('[Admin] 切换用户加载完成:', targetUser, '公式:', formulas.length, '词库:', thesaurus.length);
                if (formulas.length === 0) { saveFormulas(getDefaultFormulas()); }
                if (thesaurus.length === 0) { saveThesaurus(getDefaultThesaurus()); }
            } catch (e) { console.warn('切换用户加载失败:', e); }

            if (gen !== _dataGen) return;
            renderCategories(); renderFormulas(); renderTitleLayout(); renderHistory(); renderImageHistory();
            updateFormulaSelect();
            document.getElementById('resultTextarea').value = '';
            invalidateModelCache();
        }

        // 拉黑用户
        async function blockUser(userId) {
            const result = await callManageUsers('block_user', { user_id: userId });
            if (result) {
                // 刷新列表
                await loadAdminUsers();
                // 如果正在查看该用户的数据，切换回自己
                if (adminViewUserId === userId) {
                    adminViewUserId = null;
                    updateViewingBadge();
                }
            }
        }

        // 解除拉黑
        async function unblockUser(userId) {
            const result = await callManageUsers('unblock_user', { user_id: userId });
            if (result) {
                await loadAdminUsers();
            }
        }

        // 删除用户
        async function deleteUser(userId, email) {
            showConfirm(`确定要删除用户 ${email} 吗？此操作将永久删除该用户的账户和所有数据，不可恢复！`, async () => {
                const result = await callManageUsers('delete_user', { user_id: userId });
                if (result) {
                    // 如果正在查看该用户，切换回自己
                    if (adminViewUserId === userId) {
                        adminViewUserId = null;
                        updateViewingBadge();
                    }
                    await loadAdminUsers();
                    showToast('用户已删除', 'success');
                }
            });
        }

        // 添加白名单用户
        async function addWhitelistUser() {
            const email = document.getElementById('whitelistEmail').value.trim();
            const password = document.getElementById('whitelistPassword').value;
            const displayName = document.getElementById('whitelistDisplayName').value.trim();
            const errorEl = document.getElementById('whitelistError');

            if (!email || !password) { errorEl.textContent = '请填写邮箱和密码'; return; }
            if (password.length < 6) { errorEl.textContent = '密码至少需要6位'; return; }

            errorEl.textContent = '';

            // 收集管理员当前的 API Keys
            const apiKeys = collectCurrentApiKeys();

            const result = await callManageUsers('create_whitelist_user', {
                email,
                password,
                display_name: displayName || email.split('@')[0],
                api_keys: apiKeys,
            });

            if (result) {
                // 清空表单
                document.getElementById('whitelistEmail').value = '';
                document.getElementById('whitelistPassword').value = '';
                document.getElementById('whitelistDisplayName').value = '';
                showToast(result.message || '白名单用户已添加', 'success');
                await loadWhitelistList();
                await loadAdminUsers();
            } else {
                errorEl.textContent = '操作失败，请检查网络或 Edge Function 是否已部署';
            }
        }

        // 移除白名单用户
        async function removeWhitelistUser(userId) {
            const result = await callManageUsers('remove_whitelist', { user_id: userId });
            if (result) {
                showToast('已移出白名单', 'success');
                await loadWhitelistList();
                await loadAdminUsers();
            }
        }

        // 加载白名单列表
        async function loadWhitelistList() {
            const listEl = document.getElementById('whitelistUserList');
            if (!listEl) return;

            if (!_adminUsersCache) {
                const { data } = await supabaseClient.from('user_profiles').select('*').order('created_at', { ascending: false });
                _adminUsersCache = data || [];
            }

            const whitelistUsers = _adminUsersCache.filter(u => u.status === 'whitelist');

            if (whitelistUsers.length === 0) {
                listEl.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 1rem;font-size:0.8rem;">暂无白名单用户</p>';
                return;
            }

            listEl.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:0.35rem;">
                    ${whitelistUsers.map(u => `
                        <div class="admin-user-item" style="cursor:default;">
                            <div class="admin-user-left">
                                <div class="user-avatar" style="width:28px;height:28px;font-size:0.7rem;">${(u.email || 'U')[0].toUpperCase()}</div>
                                <div class="admin-user-info">
                                    <div class="admin-user-name" style="font-size:0.8rem;">
                                        ${escapeHtml(u.display_name || u.email || '未知')}
                                        <span class="admin-user-status status-whitelist">白名单</span>
                                        ${u.api_keys ? '<span style="font-size:0.65rem;color:#60a5fa;">🔑 有Key</span>' : '<span style="font-size:0.65rem;color:#fbbf24;">⚠ 无Key</span>'}
                                    </div>
                                    <div class="admin-user-email" style="font-size:0.7rem;">${escapeHtml(u.email || '')}</div>
                                </div>
                            </div>
                            <button class="admin-btn-action danger" onclick="removeWhitelistUser('${u.user_id}')">移出</button>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // 收集当前管理员浏览器中的 API Keys
        function collectCurrentApiKeys() {
            const keys = {};
            ['zhipu', 'gemini', 'kimi', 'qwen', 'groq'].forEach(p => {
                const key = localStorage.getItem(p + '_api_key');
                if (key) keys[p] = key;
            });
            return Object.keys(keys).length > 0 ? keys : null;
        }

        // 将管理员 API Keys 加载到表单
        async function loadAdminApiKeysIntoForm() {
            // 先从 localStorage 加载（最新数据）
            const localKeys = {};
            ['zhipu', 'gemini', 'kimi', 'qwen', 'groq'].forEach(p => {
                const key = localStorage.getItem(p + '_api_key');
                if (key) localKeys[p] = key;
            });

            // 如果有本地 keys，优先用本地
            if (Object.keys(localKeys).length > 0) {
                Object.entries(localKeys).forEach(([p, key]) => {
                    const el = document.getElementById('admin' + p.charAt(0).toUpperCase() + p.slice(1) + 'Key');
                    if (el && !el.value) el.value = key;
                });
            }

            // 也从云端加载（以防本地没有）
            try {
                const { data } = await supabaseClient.from('user_profiles')
                    .select('api_keys')
                    .eq('user_id', currentUser.id)
                    .maybeSingle();
                if (data?.api_keys) {
                    Object.entries(data.api_keys).forEach(([p, key]) => {
                        const el = document.getElementById('admin' + p.charAt(0).toUpperCase() + p.slice(1) + 'Key');
                        if (el && !el.value) el.value = key;
                    });
                }
            } catch (e) { /* 忽略 */ }
        }

        // 保存并同步 API Keys
        async function saveAndSyncApiKeys() {
            const apiKeys = {};
            ['zhipu', 'gemini', 'kimi', 'qwen', 'groq'].forEach(p => {
                const el = document.getElementById('admin' + p.charAt(0).toUpperCase() + p.slice(1) + 'Key');
                if (el && el.value.trim()) apiKeys[p] = el.value.trim();
            });

            if (Object.keys(apiKeys).length === 0) {
                showToast('请至少填写一个 API Key', 'warning');
                return;
            }

            // 先保存到本地
            Object.entries(apiKeys).forEach(([p, key]) => {
                localStorage.setItem(p + '_api_key', key);
            });

            // 同步到云端 Edge Function
            const result = await callManageUsers('sync_api_keys', { api_keys: apiKeys });
            if (result) {
                document.getElementById('apiKeysSyncStatus').innerHTML =
                    '<span style="color:#34d399;">✅ ' + result.message + '</span>';
                showToast(result.message, 'success');
            } else {
                document.getElementById('apiKeysSyncStatus').innerHTML =
                    '<span style="color:#fbbf24;">⚠ API Keys 已保存到本地，但云端同步失败（Edge Function 可能未部署）</span>';
            }
        }

        // 白名单用户登录后自动加载管理员 API Keys
        async function loadWhitelistApiKeys() {
            if (!currentUser) return;
            try {
                const { data } = await supabaseClient.from('user_profiles')
                    .select('status, api_keys')
                    .eq('user_id', currentUser.id)
                    .maybeSingle();

                if (data && data.status === 'whitelist' && data.api_keys) {
                    console.log('[Whitelist] 自动加载管理员 API Keys');
                    Object.entries(data.api_keys).forEach(([p, key]) => {
                        localStorage.setItem(p + '_api_key', key);
                    });
                    // 如果图片反推页面已渲染，刷新 API Key 输入框
                    refreshApiKeyInputs();
                    showToast('已自动加载管理员提供的 API Keys ✓', 'success');
                }
            } catch (e) {
                console.warn('[Whitelist] 加载 API Keys 失败:', e.message);
            }
        }

        // 刷新 API Key 输入框（如果在图片反推页面）
        function refreshApiKeyInputs() {
            ['zhipu', 'gemini', 'kimi', 'qwen', 'groq'].forEach(p => {
                const el = document.getElementById(p + 'ApiKey');
                if (el) {
                    const savedKey = localStorage.getItem(p + '_api_key');
                    if (savedKey && !el.value) el.value = savedKey;
                }
            });
            if (typeof updateApiKeyStatus === 'function') updateApiKeyStatus();
        }

        function updateViewingBadge() {
            const badge = document.getElementById('viewingBadge');
            const viewingName = document.getElementById('viewingUserName');
            const switchBtn = document.getElementById('switchToSelfBtn');
            if (!badge || !viewingName || !switchBtn) return;

            if (isAdmin && adminViewUserId && adminViewUserId !== currentUser?.id) {
                // 管理员正在查看其他用户
                let displayName = adminViewUserId.substring(0, 8) + '...';
                if (_adminUsersCache) {
                    const found = _adminUsersCache.find(u => u.user_id === adminViewUserId);
                    if (found) displayName = found.display_name || found.email || displayName;
                }
                badge.style.display = 'inline-flex';
                switchBtn.style.display = 'block';
                viewingName.textContent = displayName;
            } else {
                badge.style.display = 'none';
                switchBtn.style.display = 'none';
            }
        }

        async function switchToSelf() {
            adminViewUserId = null;
            updateViewingBadge();
            closeAllMenus();

            // 递增数据代数（仅用于防止过期数据渲染，不再用于取消保存）
            const gen = ++_dataGen;

            // 重置所有缓存（公式、词库、版本快照）
            _formulasCache = null; _formulasLoaded = false;
            _thesaurusCache = null; _thesaurusLoaded = false;
            _versionsCache = null; _versionsLoaded = false;

            // 重置运行时状态
            currentSelections = {};
            currentFormulaId = null;
            modelResults = {};
            modelFed = false;
            fedPromptHash = '';
            currentModelId = null;

            // 注意：不提前清除 localStorage！
            // getFormulasAsync 成功后会自己覆盖 localStorage

            showToast('已切换回自己，加载数据中...', 'success');

            try {
                const formulas = await getFormulasAsync();
                if (gen !== _dataGen) return;
                const thesaurus = await getThesaurusAsync();
                if (gen !== _dataGen) return;
                console.log('[Admin] 切换回自己完成, 公式:', formulas.length, '词库:', thesaurus.length);
                // 管理员自己也无数据时，初始化默认数据
                if (formulas.length === 0) {
                    saveFormulas(getDefaultFormulas());
                }
                if (thesaurus.length === 0) {
                    saveThesaurus(getDefaultThesaurus());
                }
            } catch (e) { console.warn('加载自己数据失败:', e); }

            if (gen !== _dataGen) return;
            renderCategories(); renderFormulas(); renderTitleLayout(); renderHistory(); renderImageHistory();
            updateFormulaSelect();
            document.getElementById('resultTextarea').value = '';
            invalidateModelCache();
            showToast('已切换回自己', 'success');
        }

        async function reloadCloudData() {
            _formulasCache = null; _formulasLoaded = false;
            _thesaurusCache = null; _thesaurusLoaded = false;
            try {
                const cloudFormulas = await getFormulasAsync();
                const cloudThesaurus = await getThesaurusAsync();
                
                if (cloudFormulas.length === 0) {
                    // 云端无数据：优先同步本地数据，否则用默认数据
                    const localFormulas = getFormulas();
                    if (localFormulas.length > 0) saveFormulas(localFormulas);
                    else saveFormulas(getDefaultFormulas());
                }
                if (cloudThesaurus.length === 0) {
                    const localThesaurus = getThesaurus();
                    if (localThesaurus.length > 0) saveThesaurus(localThesaurus);
                    else saveThesaurus(getDefaultThesaurus());
                }
            } catch (e) { console.warn('重新加载数据失败:', e); }
            renderCategories(); renderFormulas(); renderTitleLayout(); renderHistory(); renderImageHistory();
            updateFormulaSelect();
        }

        // 覆盖层点击关闭
        document.addEventListener('click', (e) => {
            if (e.target === document.getElementById('authOverlay')) closeAuthModal();
            if (e.target === document.getElementById('adminPanelOverlay')) closeAdminPanel();
            if (e.target === document.getElementById('confirmOverlay')) closeConfirm();
            const badge = document.getElementById('userBadge');
            const menu = document.getElementById('userMenu');
            if (badge && menu && !badge.contains(e.target)) menu.classList.remove('active');
        });

        // ==================== Data Management ====================
        const STORAGE_KEYS = {
            FORMULAS: 'prompt-formulas',
            THESAURUS: 'prompt-thesaurus',
            THESAURUS_DEFAULTS: 'prompt-thesaurus-defaults',
            HISTORY: 'prompt-history',
            IMAGE_HISTORY: 'prompt-image-history',
            SIZE_TABS: 'prompt-size-tabs',
            TITLE_LAYOUT: 'prompt-title-layout',
            AI_CONFIG: 'prompt-ai-config'
        };

        // 登录后按用户ID隔离 localStorage 键，未登录共享同一份
        function getStorageKey(baseKey) {
            const uid = getEffectiveUserId();
            return uid ? `${baseKey}_${uid}` : baseKey;
        }

        let editingFormulaId = null;
        let currentFormulaId = null; // 当前选中的公式ID

        function generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        }

        // 本地存储读写（保留作为离线缓存）
        function loadData(key, defaultValue = []) {
            try {
                const data = localStorage.getItem(key);
                return data ? JSON.parse(data) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        }

        function saveData(key, data) {
            try {
                localStorage.setItem(key, JSON.stringify(data));
            } catch (e) {
                console.error('[saveData] localStorage 写入失败:', e);
            }
        }

        // ==================== Formula Management (Cloud + Local) ====================
        // 公式数据：优先从云端读取，本地作为缓存
        let _formulasCache = null;
        let _formulasLoaded = false;

        // 按用户排队异步保存，防止同一用户的多份保存互相覆盖
        const _saveQueue = {};

        async function getFormulasAsync() {
            if (_formulasLoaded && _formulasCache !== null) return [..._formulasCache];
            const ok = await waitForCloud();
            const userId = getEffectiveUserId();
            if (ok && userId) {
                try {
                    const { data, error } = await supabaseClient
                        .from('formulas')
                        .select('*')
                        .eq('user_id', userId)
                        .order('created_at', { ascending: true });
                    if (!error && data && data.length > 0) {
                        _formulasCache = data.map(r => ({
                            id: r.id,
                            name: r.name,
                            template: r.template,
                            createdAt: r.created_at,
                            updatedAt: r.updated_at
                        }));
                        _formulasLoaded = true;
                        // 同步到本地缓存
                        saveData(getStorageKey(STORAGE_KEYS.FORMULAS), _formulasCache);
                        return [..._formulasCache];
                    }
                    // 云端确认为空：不覆盖本地缓存，避免丢失尚未同步的数据
                } catch (e) {
                    console.warn('[Formulas] 云端读取失败，使用本地缓存:', e.message);
                }
            }
            // 回退到本地（按用户隔离）
            _formulasCache = loadData(getStorageKey(STORAGE_KEYS.FORMULAS), []);
            _formulasLoaded = true;
            return [..._formulasCache];
        }

        // 同步版本：用于需要立即返回的场景
        function getFormulas() {
            if (_formulasLoaded && _formulasCache !== null) return [..._formulasCache];
            return loadData(getStorageKey(STORAGE_KEYS.FORMULAS), []);
        }

        async function saveFormulasAsync(formulas) {
            // 捕获目标用户ID（调用时的用户），确保数据保存到正确的账户
            const userId = getEffectiveUserId();
            if (!userId) return;
            // 排队保存：同一用户的后一次保存一定等前一次完成后再执行
            if (!_saveQueue[userId]) _saveQueue[userId] = Promise.resolve();
            _saveQueue[userId] = _saveQueue[userId].then(async () => {
                const ok = await waitForCloud(3000);
                if (!ok) return;
                try {
                    // 删除该用户的所有旧公式
                    await supabaseClient.from('formulas').delete().eq('user_id', userId);
                    // 批量插入新公式
                    const rows = formulas.map(f => ({
                        id: f.id,
                        user_id: userId,
                        name: f.name,
                        template: f.template,
                        created_at: f.createdAt || Date.now(),
                        updated_at: f.updatedAt || Date.now()
                    }));
                    if (rows.length > 0) {
                        const { error } = await supabaseClient.from('formulas').insert(rows);
                        if (error) console.warn('[Formulas] 云端保存失败:', error.message);
                    }
                } catch (e) {
                    console.warn('[Formulas] 云端保存异常:', e.message);
                }
            });
        }

        function saveFormulas(formulas) {
            _formulasCache = formulas.map(f => ({ ...f }));
            _formulasLoaded = true;
            saveData(getStorageKey(STORAGE_KEYS.FORMULAS), formulas);
            // 异步同步到云端（不阻塞UI）
            saveFormulasAsync(formulas).catch(() => {});
        }

        function renderFormulas() {
            const formulas = getFormulas();
            const container = document.getElementById('formulaList');

            if (formulas.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p class="empty-state-text">暂无公式</p>
                        <button class="btn btn-primary btn-sm" onclick="openFormulaModal()">添加第一个公式</button>
                    </div>
                `;
                return;
            }

            container.innerHTML = formulas.map(formula => `
                <div class="form-item">
                    <div class="form-item-header">
                        <div class="form-item-name">${escapeHtml(formula.name)}</div>
                        <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteFormula('${formula.id}')" title="删除">×</button>
                    </div>
                    <div class="form-item-template">${highlightTemplate(formula.template)}</div>
                    <div class="form-item-actions">
                        <button class="btn btn-secondary btn-sm" onclick="useFormula('${formula.id}')">使用</button>
                        <button class="btn btn-ghost btn-sm" onclick="editFormula('${formula.id}')">编辑</button>
                    </div>
                </div>
            `).join('');

            // Update formula select dropdown (silent: don't clear selections on edit/delete)
            updateFormulaSelect(true);
        }

        function highlightTemplate(template) {
            // 支持两种格式：{{分类:字段}} 和 {{分类}}
            return template.replace(/\{\{([^:}]+):([^}]+)\}\}/g, '<span class="var">{{$1:$2}}</span>')
                            .replace(/\{\{([^:}]+)\}\}/g, '<span class="var">{{$1}}</span>');
        }

        function openFormulaModal() {
            editingFormulaId = null;
            document.getElementById('formulaModalTitle').textContent = '添加公式';
            document.getElementById('formulaName').value = '';
            document.getElementById('formulaTemplate').value = '';
            document.getElementById('formulaModal').classList.add('active');
        }

        function closeFormulaModal() {
            document.getElementById('formulaModal').classList.remove('active');
        }

        function editFormula(id) {
            const formulas = getFormulas();
            const formula = formulas.find(f => f.id === id);
            if (!formula) return;

            editingFormulaId = id;
            document.getElementById('formulaModalTitle').textContent = '编辑公式';
            document.getElementById('formulaName').value = formula.name;
            document.getElementById('formulaTemplate').value = formula.template;
            document.getElementById('formulaModal').classList.add('active');
        }

        function saveFormula() {
            const name = document.getElementById('formulaName').value.trim();
            const template = document.getElementById('formulaTemplate').value.trim();

            if (!name) {
                showToast('请输入公式名称', 'error');
                return;
            }

            if (!template) {
                showToast('请输入模板内容', 'error');
                return;
            }

            const formulas = getFormulas();
            const variables = parseVariables(template);
            const newCategories = [...new Set(variables.map(v => v.category))];

            if (editingFormulaId) {
                // 编辑：获取旧模板的变量，对比差异
                const oldFormula = formulas.find(f => f.id === editingFormulaId);
                const oldVariables = oldFormula ? parseVariables(oldFormula.template) : [];
                const oldCategories = [...new Set(oldVariables.map(v => v.category))];
                
                const index = formulas.findIndex(f => f.id === editingFormulaId);
                if (index !== -1) {
                    formulas[index] = { ...formulas[index], name, template };
                }

                // 移除不再需要的分类
                const removedCategories = oldCategories.filter(c => !newCategories.includes(c));
                if (removedCategories.length > 0) {
                    syncThesaurusCategories(newCategories, removedCategories);
                } else {
                    syncThesaurusCategories(newCategories, []);
                }
            } else {
                // 新建公式
                formulas.push({
                    id: generateId(),
                    name,
                    template,
                    createdAt: Date.now()
                });
                // 自动创建词库分类
                syncThesaurusCategories(newCategories, []);
            }

            saveFormulas(formulas);
            renderFormulas();
            renderCategories();
            closeFormulaModal();
            createVersionSnapshotSilent(); // 自动创建版本快照
            showToast(editingFormulaId ? '公式已更新' : '公式已添加', 'success');
        }

        // 同步词库分类：根据公式变量自动创建/移除分类
        function syncThesaurusCategories(newCategories, removedCategories) {
            const thesaurus = getThesaurus();
            
            // 为新变量创建分类（如果不存在）
            newCategories.forEach(catName => {
                if (!thesaurus.find(c => c.name === catName)) {
                    const defaultWords = getCategoryDefaultWords(catName);
                    thesaurus.push({
                        id: generateId(),
                        name: catName,
                        words: [...defaultWords]
                    });
                }
            });
            
            // 移除孤立分类（仅当该分类在所有公式中都不再使用）
            if (removedCategories.length > 0) {
                const formulas = getFormulas();
                const allUsedCategories = new Set();
                formulas.forEach(f => {
                    parseVariables(f.template).forEach(v => allUsedCategories.add(v.category));
                });
                
                removedCategories.forEach(catName => {
                    if (!allUsedCategories.has(catName)) {
                        const idx = thesaurus.findIndex(c => c.name === catName);
                        if (idx !== -1) {
                            thesaurus.splice(idx, 1);
                            // 清除该分类的选中状态
                            delete currentSelections[catName];
                        }
                    }
                });
            }
            
            saveThesaurus(thesaurus);
            renderCategories();
        }

        function deleteFormula(id) {
            if (!confirm('确定要删除这个公式吗？')) return;

            const formulas = getFormulas();
            const formula = formulas.find(f => f.id === id);
            
            // 移除公式
            const updatedFormulas = formulas.filter(f => f.id !== id);
            saveFormulas(updatedFormulas);
            
            // 清理不再被任何公式使用的词库分类
            if (formula) {
                const deletedVars = parseVariables(formula.template);
                const deletedCategories = [...new Set(deletedVars.map(v => v.category))];
                const allUsed = new Set();
                updatedFormulas.forEach(f => {
                    parseVariables(f.template).forEach(v => allUsed.add(v.category));
                });
                const toRemove = deletedCategories.filter(c => !allUsed.has(c));
                if (toRemove.length > 0) {
                    const thesaurus = getThesaurus();
                    toRemove.forEach(catName => {
                        const idx = thesaurus.findIndex(c => c.name === catName);
                        if (idx !== -1) thesaurus.splice(idx, 1);
                        delete currentSelections[catName];
                    });
                    saveThesaurus(thesaurus);
                    renderCategories();
                }
            }
            
            renderFormulas();
            createVersionSnapshotSilent(); // 自动创建版本快照
            showToast('公式已删除', 'success');
        }

        function useFormula(id) {
            document.getElementById('formulaSelect').value = id;
            onFormulaChange();
        }

        function updateFormulaSelect(silent = false) {
            const formulas = getFormulas();
            const select = document.getElementById('formulaSelect');
            
            select.innerHTML = '<option value="">-- 选择公式 --</option>' + 
                formulas.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
            
            // 如果有之前选中的公式，保持选中
            if (currentFormulaId && formulas.some(f => f.id === currentFormulaId)) {
                select.value = currentFormulaId;
                // 静默模式：不触发onFormulaChange（避免清空用户选择）
                if (!silent) {
                    onFormulaChange();
                }
            } else if (formulas.length > 0) {
                // 默认选中第一个
                select.value = formulas[0].id;
                currentFormulaId = formulas[0].id;
                if (!silent) {
                    onFormulaChange();
                }
            } else {
                // 公式列表为空
                currentFormulaId = null;
                if (!silent) {
                    onFormulaChange();
                }
            }
        }

        function onFormulaChange() {
            const select = document.getElementById('formulaSelect');
            const formulaId = select.value;
            currentFormulaId = formulaId || null;
            
            const formulas = getFormulas();
            const formula = formulas.find(f => f.id === formulaId);
            
            // 只清除新公式中不存在的变量分类，保留共享分类的选择
            if (formula) {
                const newVars = parseVariables(formula.template);
                const newCategories = new Set(newVars.map(v => v.category));
                Object.keys(currentSelections).forEach(cat => {
                    if (!newCategories.has(cat)) {
                        delete currentSelections[cat];
                    }
                });
                
                // 同步词库：为新公式中缺少的分类自动创建
                const thesaurus = getThesaurus();
                let thesaurusChanged = false;
                newCategories.forEach(catName => {
                    if (!thesaurus.find(c => c.name === catName)) {
                        const defaultWords = getCategoryDefaultWords(catName);
                        thesaurus.push({
                            id: generateId(),
                            name: catName,
                            words: [...defaultWords]
                        });
                        thesaurusChanged = true;
                    }
                });
                if (thesaurusChanged) {
                    saveThesaurus(thesaurus);
                }
            } else {
                currentSelections = {};
            }
            
            renderCategories();
            updateResult();
        }

        function getCurrentFormula() {
            const formulas = getFormulas();
            return formulas.find(f => f.id === currentFormulaId) || formulas[0] || null;
        }

        // ==================== Title Layout Management ====================
        const DEFAULT_TITLE_LAYOUT = {
            style: 'banner',
            mainTitlePos: 'top-center',
            subtitlePos: 'below-main',
            fontSize: 'large-small',
            colorScheme: 'white-dark-bg',
            fontStyle: 'sans-bold',
            textEffect: 'none',
            enabled: true
        };

        const TITLE_LAYOUT_STYLES = [
            { id: 'banner', label: '横幅式', desc: '顶部居中 + 底条衬托' },
            { id: 'poster', label: '海报式', desc: '侧边大标题 + 底标' },
            { id: 'badge', label: '角标式', desc: '左上标签 + 右下角标' },
            { id: 'minimal', label: '简约式', desc: '底部居中 + 纤细字体' },
            { id: 'vertical', label: '竖排式', desc: '竖排文字 + 侧边排列' },
            { id: 'magazine', label: '杂志式', desc: '大字压图 + 多层排版' },
            { id: 'tag-array', label: '标签阵', desc: '多标签排列 + 错落布局' },
            { id: 'wrap', label: '环绕式', desc: '文字环绕主体排列' }
        ];

        // 每种排版风格的联动规则：定义了该风格兼容的细节配置选项 + 切换风格时的默认值
        // compatiblePos: 该风格允许的主标题位置选项（null表示全部允许）
        // defaultPos: 切换到此风格时自动设置的主标题位置
        // 副标题位置、字号、字体风格同理
        const TITLE_STYLE_LINKAGE = {
            banner: {
                defaultPos: 'top-center',
                compatiblePos: ['top-center'],           // 横幅式只能顶部居中
                defaultSubPos: 'below-main',
                compatibleSubPos: ['below-main', 'inline'],
                defaultFontSize: 'large-small',
                compatibleFontSize: ['large-small', 'medium-equal'],
                defaultFontStyle: 'sans-bold',
                compatibleFontStyle: ['sans-bold', 'black-heavy', 'serif'],
                defaultColor: 'white-dark-bg',
            },
            poster: {
                defaultPos: 'top-left',
                compatiblePos: ['top-left', 'mid-horizontal'], // 海报式侧边位置
                defaultSubPos: 'bottom-strip',
                compatibleSubPos: ['bottom-strip', 'corner-tag'],
                defaultFontSize: 'large-small',
                compatibleFontSize: ['large-small', 'large-only'],
                defaultFontStyle: 'black-heavy',
                compatibleFontStyle: ['black-heavy', 'sans-bold', 'serif'],
                defaultColor: 'white-dark-bg',
            },
            badge: {
                defaultPos: 'top-left',
                compatiblePos: ['top-left', 'top-center'],    // 角标式左上角
                defaultSubPos: 'corner-tag',
                compatibleSubPos: ['corner-tag', 'below-main'],
                defaultFontSize: 'medium-equal',
                compatibleFontSize: ['medium-equal', 'large-small'],
                defaultFontStyle: 'sans-bold',
                compatibleFontStyle: ['sans-bold', 'black-heavy', 'handwrite'],
                defaultColor: 'brand-match',
            },
            minimal: {
                defaultPos: 'bottom-center',
                compatiblePos: ['bottom-center'],             // 简约式只能底部居中
                defaultSubPos: 'below-main',
                compatibleSubPos: ['below-main', 'inline'],
                defaultFontSize: 'medium-equal',
                compatibleFontSize: ['medium-equal', 'large-small'],
                defaultFontStyle: 'light-elegant',
                compatibleFontStyle: ['light-elegant', 'sans-bold', 'serif'],
                defaultColor: 'black-light-bg',
            },
            vertical: {
                defaultPos: 'top-left',
                compatiblePos: ['top-left', 'mid-horizontal'], // 竖排式侧边
                defaultSubPos: 'bottom-strip',
                compatibleSubPos: ['bottom-strip', 'corner-tag'],
                defaultFontSize: 'large-small',
                compatibleFontSize: ['large-small', 'large-only'],
                defaultFontStyle: 'calligraphy',
                compatibleFontStyle: ['calligraphy', 'serif', 'handwrite'],
                defaultColor: 'gold-gradient',
            },
            magazine: {
                defaultPos: 'mid-horizontal',
                compatiblePos: ['mid-horizontal', 'top-center'], // 杂志式中央压图
                defaultSubPos: 'below-main',
                compatibleSubPos: ['below-main', 'inline', 'corner-tag'],
                defaultFontSize: 'large-small',
                compatibleFontSize: ['large-small', 'large-only'],
                defaultFontStyle: 'black-heavy',
                compatibleFontStyle: ['black-heavy', 'serif', 'sans-bold'],
                defaultColor: 'white-dark-bg',
            },
            'tag-array': {
                defaultPos: 'top-left',
                compatiblePos: null,                           // 标签阵位置自由（本身就是散布式）
                defaultSubPos: 'corner-tag',
                compatibleSubPos: null,                        // 副标题也自由
                defaultFontSize: 'medium-equal',
                compatibleFontSize: null,
                defaultFontStyle: 'handwrite',
                compatibleFontStyle: null,                     // 标签阵字体自由
                defaultColor: 'brand-match',
            },
            wrap: {
                defaultPos: 'mid-horizontal',
                compatiblePos: ['mid-horizontal', 'bottom-center'], // 环绕式沿轮廓
                defaultSubPos: 'inline',
                compatibleSubPos: ['inline', 'below-main'],
                defaultFontSize: 'large-small',
                compatibleFontSize: ['large-small', 'medium-equal'],
                defaultFontStyle: 'light-elegant',
                compatibleFontStyle: ['light-elegant', 'handwrite', 'sans-bold'],
                defaultColor: 'brand-match',
            },
        };

        const TITLE_LAYOUT_COLORS = [
            { id: 'white-dark-bg', label: '白字 + 深色底条' },
            { id: 'brand-match', label: '跟随画面色调' },
            { id: 'black-light-bg', label: '黑字 + 浅色背景' },
            { id: 'gold-gradient', label: '金色渐变' }
        ];

        const TITLE_FONT_STYLES = [
            { id: 'sans-bold', label: '粗体无衬线' },
            { id: 'serif', label: '衬线体' },
            { id: 'calligraphy', label: '书法体' },
            { id: 'handwrite', label: '手写体' },
            { id: 'black-heavy', label: '特粗黑体' },
            { id: 'light-elegant', label: '纤细优雅体' }
        ];

        const TITLE_TEXT_EFFECTS = [
            { id: 'none', label: '无特效' },
            { id: 'outline', label: '文字描边' },
            { id: 'shadow', label: '投影效果' },
            { id: 'glow', label: '外发光' },
            { id: 'gradient-fill', label: '渐变填充' },
            { id: 'emboss', label: '浮雕效果' }
        ];

        function getTitleLayout() {
            return loadData(STORAGE_KEYS.TITLE_LAYOUT, { ...DEFAULT_TITLE_LAYOUT });
        }

        function saveTitleLayout(layout) {
            saveData(STORAGE_KEYS.TITLE_LAYOUT, layout);
            renderTitleLayout();
            updateResult();
        }

        // 辅助函数：根据联动规则生成过滤后的 option 列表
        // compatibleList 为 null 表示全部允许；否则只显示列表中的选项
        // 不在兼容列表中的选项显示为灰色禁用态，并标注「不兼容」
        function _buildFilteredOptions(allOptions, currentValue, compatibleList, valueKey, labelKey) {
            const k = valueKey || 'id';
            const l = labelKey || 'label';
            return allOptions.map(opt => {
                const isCompat = compatibleList === null || compatibleList.includes(opt[k]);
                const selected = currentValue === opt[k] ? ' selected' : '';
                if (isCompat) {
                    return `<option value="${opt[k]}"${selected}>${opt[l]}</option>`;
                } else {
                    return `<option value="${opt[k]}" disabled style="color:#999">${opt[l]}（与当前风格不兼容）</option>`;
                }
            }).join('');
        }

        function renderTitleLayout() {
            const layout = getTitleLayout();
            const linkage = TITLE_STYLE_LINKAGE[layout.style] || {};

            // Render style presets grid (8种风格)
            const grid = document.getElementById('titleLayoutGrid');
            grid.innerHTML = TITLE_LAYOUT_STYLES.map(s => `
                <div class="title-layout-preset ${layout.style === s.id ? 'active' : ''}" onclick="setTitleLayout('style', '${s.id}')">
                    <span class="preset-label">${s.label}</span>
                    <span class="preset-desc">${s.desc}</span>
                </div>
            `).join('');

            // 主标题位置选项
            const posOptions = [
                { id: 'top-center', label: '顶部居中' },
                { id: 'top-left', label: '顶部左侧' },
                { id: 'mid-horizontal', label: '中部横排' },
                { id: 'bottom-center', label: '底部居中' }
            ];
            const subPosOptions = [
                { id: 'below-main', label: '主标题下方' },
                { id: 'corner-tag', label: '右下角标签' },
                { id: 'bottom-strip', label: '底部独立底条' },
                { id: 'inline', label: '与主标题同行' }
            ];
            const fontSizeOptions = [
                { id: 'large-small', label: '大标题 + 小副标' },
                { id: 'large-only', label: '仅大标题' },
                { id: 'medium-equal', label: '等大字号' }
            ];

            // Render options row 1: 位置 + 副标题位置 + 字号 + 配色
            const options = document.getElementById('titleLayoutOptions');
            options.innerHTML = `
                <div class="title-layout-row">
                    <span class="row-label">位置</span>
                    <select onchange="setTitleLayout('mainTitlePos', this.value)">
                        ${_buildFilteredOptions(posOptions, layout.mainTitlePos, linkage.compatiblePos)}
                    </select>
                </div>
                <div class="title-layout-row">
                    <span class="row-label">副标题</span>
                    <select onchange="setTitleLayout('subtitlePos', this.value)">
                        ${_buildFilteredOptions(subPosOptions, layout.subtitlePos, linkage.compatibleSubPos)}
                    </select>
                </div>
                <div class="title-layout-row">
                    <span class="row-label">字号</span>
                    <select onchange="setTitleLayout('fontSize', this.value)">
                        ${_buildFilteredOptions(fontSizeOptions, layout.fontSize, linkage.compatibleFontSize)}
                    </select>
                </div>
                <div class="title-layout-row">
                    <span class="row-label">配色</span>
                    <select onchange="setTitleLayout('colorScheme', this.value)">
                        ${TITLE_LAYOUT_COLORS.map(c =>
                            `<option value="${c.id}" ${layout.colorScheme === c.id ? 'selected' : ''}>${c.label}</option>`
                        ).join('')}
                    </select>
                </div>
            `;

            // Render options row 2: 字体风格 + 文字特效
            const options2 = document.getElementById('titleLayoutOptions2');
            options2.innerHTML = `
                <div class="title-layout-row">
                    <span class="row-label">字体</span>
                    <select onchange="setTitleLayout('fontStyle', this.value)">
                        ${_buildFilteredOptions(TITLE_FONT_STYLES, layout.fontStyle, linkage.compatibleFontStyle)}
                    </select>
                </div>
                <div class="title-layout-row">
                    <span class="row-label">特效</span>
                    <select onchange="setTitleLayout('textEffect', this.value)">
                        ${TITLE_TEXT_EFFECTS.map(e =>
                            `<option value="${e.id}" ${layout.textEffect === e.id ? 'selected' : ''}>${e.label}</option>`
                        ).join('')}
                    </select>
                </div>
            `;

            // Update enabled checkbox
            document.getElementById('titleLayoutEnabled').checked = layout.enabled;

            // Update preview
            updateTitlePreview();
        }

        function setTitleLayout(key, value) {
            const layout = getTitleLayout();
            layout[key] = value;

            // 当切换排版风格时，自动联动调整细节配置为该风格的推荐默认值
            if (key === 'style') {
                const linkage = TITLE_STYLE_LINKAGE[value];
                if (linkage) {
                    // 只在当前值不在兼容范围内时才自动调整（避免覆盖用户手动调整）
                    if (linkage.defaultPos && (!linkage.compatiblePos || !linkage.compatiblePos.includes(layout.mainTitlePos))) {
                        layout.mainTitlePos = linkage.defaultPos;
                    }
                    if (linkage.defaultSubPos && (!linkage.compatibleSubPos || !linkage.compatibleSubPos.includes(layout.subtitlePos))) {
                        layout.subtitlePos = linkage.defaultSubPos;
                    }
                    if (linkage.defaultFontSize && (!linkage.compatibleFontSize || !linkage.compatibleFontSize.includes(layout.fontSize))) {
                        layout.fontSize = linkage.defaultFontSize;
                    }
                    if (linkage.defaultFontStyle && (!linkage.compatibleFontStyle || !linkage.compatibleFontStyle.includes(layout.fontStyle))) {
                        layout.fontStyle = linkage.defaultFontStyle;
                    }
                    if (linkage.defaultColor) {
                        layout.colorScheme = linkage.defaultColor;
                    }
                }
            }

            saveTitleLayout(layout);
        }

        function toggleTitleLayout() {
            const layout = getTitleLayout();
            layout.enabled = document.getElementById('titleLayoutEnabled').checked;
            saveTitleLayout(layout);
        }

        function updateTitlePreview() {
            const layout = getTitleLayout();
            const headline = currentSelections['广告标题'];
            const promo = currentSelections['促销文案'];
            const preview = document.getElementById('titleLayoutPreview');

            // 将数组转为字符串判断
            const hasHeadline = headline && (Array.isArray(headline) ? headline.length > 0 : true);
            const hasPromo = promo && (Array.isArray(promo) ? promo.length > 0 : true);

            if (!layout.enabled || (!hasHeadline && !hasPromo)) {
                preview.textContent = layout.enabled ? '请先在词库中选择广告标题或促销文案' : '排版指令已关闭';
                return;
            }

            const instruction = generateTitleLayoutInstruction(layout, headline, promo);
            preview.textContent = '预览：「' + instruction + '」';
        }

        function generateTitleLayoutInstruction(layout, headline, promo) {
            if (!layout.enabled) return '';

            const headlines = Array.isArray(headline) ? headline.filter(Boolean) : (headline ? [headline] : []);
            const promos = Array.isArray(promo) ? promo.filter(Boolean) : (promo ? [promo] : []);
            if (headlines.length === 0 && promos.length === 0) return '';

            const parts = [];

            // === 第1层：排版风格（只描述形态特征，不硬编码位置，位置由细节配置补充） ===
            const styleKeywords = {
                banner: '文字横幅排版，横幅底条衬托',
                poster: '海报式文字排版，大字压图',
                badge: '角标式文字排版，圆角标签形式',
                minimal: '简约文字排版',
                vertical: '竖排文字排版，文字竖向排列',
                magazine: '杂志封面式排版，多层文字叠排',
                'tag-array': '标签阵列式排版，文字标签错落散布',
                wrap: '环绕式文字排版，文字沿画面主体轮廓排列'
            };
            if (styleKeywords[layout.style]) {
                parts.push(styleKeywords[layout.style]);
            }

            // === 第2层：位置描述（由细节配置决定，与风格互补而非冲突） ===
            const posKeywords = {
                'top-center': '标题文字置于画面顶部居中',
                'top-left': '标题文字置于画面顶部左侧',
                'mid-horizontal': '标题文字横向排列于画面中部',
                'bottom-center': '标题文字置于画面底部居中'
            };
            if (posKeywords[layout.mainTitlePos]) {
                parts.push(posKeywords[layout.mainTitlePos]);
            }

            // === 第3层：副标题位置 ===
            const subPosKeywords = {
                'below-main': '副标题位于主标题下方',
                'corner-tag': '副标题以角标形式置于右下角',
                'bottom-strip': '副标题置于底部独立底条',
                'inline': '副标题与主标题同行排列'
            };
            if (headlines.length > 1 && subPosKeywords[layout.subtitlePos]) {
                parts.push(subPosKeywords[layout.subtitlePos]);
            }

            // === 第4层：字号关系 ===
            const fontSizeKeywords = {
                'large-small': '主标题大字，副标题小字',
                'large-only': '仅显示大标题',
                'medium-equal': '标题与副标题字号接近'
            };
            if (fontSizeKeywords[layout.fontSize]) {
                parts.push(fontSizeKeywords[layout.fontSize]);
            }

            // === 第5层：字体风格 ===
            const fontKeywords = {
                'sans-bold': '粗体无衬线字体',
                'serif': '优雅衬线字体',
                'calligraphy': '书法字体',
                'handwrite': '手写风格字体',
                'black-heavy': '特粗黑体字',
                'light-elegant': '纤细优雅字体'
            };
            if (fontKeywords[layout.fontStyle]) {
                parts.push(fontKeywords[layout.fontStyle]);
            }

            // === 第6层：文字特效 ===
            const effectKeywords = {
                'outline': '文字带有描边效果',
                'shadow': '文字带有投影效果',
                'glow': '文字带有外发光效果',
                'gradient-fill': '文字采用渐变填充效果',
                'emboss': '文字带有浮雕立体效果'
            };
            if (layout.textEffect !== 'none' && effectKeywords[layout.textEffect]) {
                parts.push(effectKeywords[layout.textEffect]);
            }

            // === 第7层：配色方案 ===
            const colorKeywords = {
                'white-dark-bg': '白色文字配深色半透明背景条',
                'brand-match': '文字颜色跟随画面主色调',
                'black-light-bg': '黑色文字配浅色背景',
                'gold-gradient': '金色渐变文字'
            };
            if (colorKeywords[layout.colorScheme]) {
                parts.push(colorKeywords[layout.colorScheme]);
            }

            // === 第8层：标题内容描述 ===
            if (headlines.length > 0) {
                const mainTitle = headlines[0];
                const titleDesc = headlines.length > 1
                    ? `主标题显示"${mainTitle}"，副标题显示"${headlines.slice(1).join('、')}"`
                    : `标题显示"${mainTitle}"`;
                parts.push(titleDesc);
            }

            // === 第9层：促销文案 ===
            if (promos.length > 0 && layout.fontSize !== 'large-only') {
                const promoDesc = promos.length > 1
                    ? `促销信息"${promos.join('、')}"以小字显示于下方`
                    : `促销信息"${promos[0]}"以小字显示`;
                parts.push(promoDesc);
            }

            // 组装为自然语言描述，用逗号连接
            return parts.join('，') + '。';
        }

        // ==================== Thesaurus Management (Cloud + Local) ====================
        let _thesaurusCache = null;
        let _thesaurusLoaded = false;

        async function getThesaurusAsync() {
            if (_thesaurusLoaded && _thesaurusCache !== null) return JSON.parse(JSON.stringify(_thesaurusCache));
            const ok = await waitForCloud();
            const userId = getEffectiveUserId();
            if (ok && userId) {
                try {
                    const { data: cats, error: catErr } = await supabaseClient
                        .from('thesaurus_categories')
                        .select('*')
                        .eq('user_id', userId)
                        .order('sort_order', { ascending: true });
                    if (!catErr && cats && cats.length > 0) {
                        const result = [];
                        for (const cat of cats) {
                            const { data: words, error: wordErr } = await supabaseClient
                                .from('thesaurus_words')
                                .select('word')
                                .eq('category_id', cat.id)
                                .order('sort_order', { ascending: true });
                            result.push({
                                id: cat.id,
                                name: cat.name,
                                words: (words && !wordErr) ? words.map(w => {
                                    // 尝试反序列化分层词对象（以 { 开头的 JSON 字符串）
                                    const raw = w.word;
                                    if (typeof raw === 'string' && raw.startsWith('{')) {
                                        try { return JSON.parse(raw); } catch(e) {}
                                    }
                                    return raw;
                                }) : []
                            });
                        }
                        _thesaurusCache = result;
                        _thesaurusLoaded = true;
                        saveData(getStorageKey(STORAGE_KEYS.THESAURUS), result);
                        return JSON.parse(JSON.stringify(result));
                    }
                    // 云端确认为空：不覆盖本地缓存
                } catch (e) {
                    console.warn('[Thesaurus] 云端读取失败，使用本地缓存:', e.message);
                }
            }
            _thesaurusCache = loadData(getStorageKey(STORAGE_KEYS.THESAURUS), []);
            _thesaurusLoaded = true;
            return JSON.parse(JSON.stringify(_thesaurusCache));
        }

        function getThesaurus() {
            if (_thesaurusLoaded && _thesaurusCache !== null) return JSON.parse(JSON.stringify(_thesaurusCache));
            return loadData(getStorageKey(STORAGE_KEYS.THESAURUS), []);
        }

        async function saveThesaurusAsync(thesaurus) {
            // 捕获目标用户ID（调用时的用户），确保数据保存到正确的账户
            const userId = getEffectiveUserId();
            if (!userId) return;
            // 排队保存：同一用户的后一次保存一定等前一次完成后再执行
            if (!_saveQueue[userId]) _saveQueue[userId] = Promise.resolve();
            _saveQueue[userId] = _saveQueue[userId].then(async () => {
                const ok = await waitForCloud(3000);
                if (!ok) return;
                try {
                    // 先获取旧分类ID列表，用于删除关联的words
                    const { data: oldCats } = await supabaseClient
                        .from('thesaurus_categories')
                        .select('id')
                        .eq('user_id', userId);
                    if (oldCats && oldCats.length > 0) {
                        const oldIds = oldCats.map(c => c.id);
                        await supabaseClient.from('thesaurus_words').delete().in('category_id', oldIds);
                    }
                    await supabaseClient.from('thesaurus_categories').delete().eq('user_id', userId);
                    // 批量插入
                    for (let i = 0; i < thesaurus.length; i++) {
                        const cat = thesaurus[i];
                        const { error: catErr } = await supabaseClient.from('thesaurus_categories').insert({
                            id: cat.id,
                            user_id: userId,
                            name: cat.name,
                            sort_order: i,
                            created_at: cat.createdAt || Date.now()
                        });
                        if (!catErr && cat.words && cat.words.length > 0) {
                            const wordRows = cat.words.map((w, wi) => ({
                                category_id: cat.id,
                                user_id: userId,
                                word: isWordObject(w) ? JSON.stringify(w) : w,
                                sort_order: wi
                            }));
                            await supabaseClient.from('thesaurus_words').insert(wordRows);
                        }
                    }
                } catch (e) {
                    console.warn('[Thesaurus] 云端保存异常:', e.message);
                }
            });
        }

        function saveThesaurus(thesaurus) {
            _thesaurusCache = JSON.parse(JSON.stringify(thesaurus));
            _thesaurusLoaded = true;
            saveData(getStorageKey(STORAGE_KEYS.THESAURUS), thesaurus);
            saveThesaurusAsync(thesaurus).catch(() => {});
        }

        function getThesaurusDefaults() {
            return loadData(STORAGE_KEYS.THESAURUS_DEFAULTS, {});
        }

        function saveThesaurusDefaults(defaults) {
            saveData(STORAGE_KEYS.THESAURUS_DEFAULTS, defaults);
        }

        // 硬编码系统默认词库（按分类名称索引）
        const SYSTEM_THESAURUS_DEFAULTS = {
            // ==================== 电商广告设计公式词库 ====================
            '广告背景': ['纯白极简背景', '渐变色彩背景', '大理石纹理台面', '镜面反射展台', '丝绸布料衬底', '自然光影窗台', '霓虹灯城市夜景', '水波纹动态背景', '金色奢华幕布', '粉色梦幻空间', '水泥工业风墙面', '热带植物丛林', '沙滩海岸线', '雪山冰川背景', '赛博朋克都市', '古典欧式宫殿', '日式禅意庭院', '科技感数字空间', '深色产品棚拍背景', '糖果色几何背景'],
            '广告氛围': ['轻奢高级感', '清新自然感', '科技未来感', '温馨治愈感', '青春活力感', '奢华典雅感', '冷酷工业感', '甜美梦幻感', '复古怀旧感', '运动能量感', '神秘诱惑感', '纯净透明感', '热闹狂欢感', '简约冷淡感', '温暖舒适感', '优雅知性感', '潮流街头感', '艺术殿堂感', '浪漫情人节', '春节喜庆氛围'],
            '主要内容': [
                // === 美妆个护 ===
                {text: '美妆', children: ['口红', '唇釉', '唇泥', '粉底液', '气垫', '散粉', '定妆喷雾', '眼影盘', '眼线笔', '睫毛膏', '腮红', '高光', '修容盘', '眉笔', '染眉膏', '妆前乳', '隔离霜', '遮瑕膏', '卸妆油', '卸妆水', '化妆刷套装', '美妆蛋', '粉扑']},
                {text: '护肤', children: ['面膜', '精华液', '面霜', '眼霜', '爽肤水', '乳液', '防晒霜', '洁面乳', '卸妆膏', '安瓶', '冻干粉', '精油', '颈霜', '唇膜', '睡眠面膜', '清洁泥膜', '去角质', '水乳套装', '旅行装']},
                {text: '个护清洁', children: ['洗发水', '护发素', '发膜', '护发精油', '沐浴露', '身体乳', '磨砂膏', '沐浴油', '洗手液', '护手霜', '牙膏', '漱口水', '电动牙刷', '冲牙器', '剃须刀', '脱毛仪', '私处护理', '卫生巾']},
                {text: '香水香氛', children: ['花香调香水', '木质调香水', '柑橘调香水', '东方调香水', '果香调香水', '清新调香水', '美食调香水', '香水小样套装', '香薰蜡烛', '无火香薰', '藤条香薰', '车载香薰', '衣物香氛喷雾', '固体香膏', '香薰机', '精油套装', '香挂', '衣柜香包']},
                // === 服饰鞋包 ===
                {text: '女装', children: ['连衣裙', '半身裙', 'T恤', '衬衫', '卫衣', '毛衣', '针织开衫', '风衣', '西装外套', '牛仔外套', '羽绒服', '大衣', '吊带', '背心', '阔腿裤', '牛仔裤', '烟管裤', '休闲裤', '短裤', '瑜伽裤', '家居服', '睡衣', '旗袍', '新中式', '运动内衣']},
                {text: '男装', children: ['T恤', 'Polo衫', '衬衫', '卫衣', '夹克', '西装', '风衣', '羽绒服', '牛仔裤', '休闲裤', '西裤', '工装裤', '短裤', '运动套装', '冲锋衣', '针织衫', '棒球服', '棉服', '马甲', '商务正装']},
                {text: '鞋靴', children: ['运动鞋', '跑鞋', '篮球鞋', '板鞋', '帆布鞋', '高跟鞋', '平底鞋', '乐福鞋', '马丁靴', '切尔西靴', '雪地靴', '凉鞋', '拖鞋', '洞洞鞋', '老爹鞋', '德训鞋', '玛丽珍鞋', '穆勒鞋', '乐福拖鞋', '厚底鞋', '尖头鞋', '方头鞋']},
                {text: '箱包', children: ['托特包', '斜挎包', '链条包', '水桶包', '双肩包', '手提包', '腋下包', '剑桥包', '马鞍包', '流浪包', '邮差包', '饺子包', '云朵包', '法棍包', '枕头包', '行李箱', '登机箱', '卡包', '钱包', '帆布袋', '腰包', '胸包', '妈咪包', '公文包']},
                {text: '配饰', children: ['项链', '耳环', '耳钉', '手链', '戒指', '手镯', '胸针', '发夹', '发箍', '丝巾', '围巾', '帽子', '棒球帽', '渔夫帽', '墨镜', '腰带', '手套', '袜子', '领带', '领结', '袖扣', '头饰', 'Choker', '脚链', '手机壳', '挂件']},
                // === 珠宝腕表 ===
                {text: '珠宝首饰', children: ['钻石项链', '珍珠耳环', '黄金手镯', '铂金戒指', '翡翠吊坠', '彩宝戒指', 'K金项链', '银饰套装', '婚戒', '对戒', '情侣手链', '生肖吊坠', '转运珠', '锁骨链', '叠戴戒指', '开口镯', '锆石饰品', '玉石手串', '蜜蜡', '南红', '碧玺']},
                {text: '腕表', children: ['机械表', '石英表', '智能手表', '运动腕表', '时装表', '商务表', '潜水表', '飞行员表', '镂空表', '情侣对表', '复古表', '儿童手表', '表带', '表盒', '摇表器']},
                // === 3C数码 ===
                {text: '手机', children: ['旗舰手机', '折叠屏手机', '游戏手机', '拍照手机', '5G手机', '手机壳', '手机膜', '充电器', '数据线', '无线充电器', '充电宝', '手机支架', '手机挂绳', '指环扣', 'MagSafe配件', 'OTG转接头']},
                {text: '电脑平板', children: ['笔记本电脑', '游戏本', '轻薄本', '平板电脑', 'iPad', '显示器', '曲面屏', '机械键盘', '鼠标', 'U盘', '移动硬盘', '扩展坞', '电脑包', '屏幕膜', '散热支架', '笔记本支架', '手写笔', '键盘膜']},
                {text: '影音数码', children: ['蓝牙耳机', '头戴耳机', '降噪耳机', 'TWS耳机', '骨传导耳机', '蓝牙音箱', '智能音箱', '相机', '微单', '拍立得', '无人机', '投影仪', 'Switch', 'PS5', '游戏手柄', 'VR眼镜', '智能手环', '智能手表', '阅读器', '翻译机', '录音笔']},
                // === 食品生鲜 ===
                {text: '零食糕点', children: ['薯片', '饼干', '巧克力', '糖果', '坚果', '肉脯', '果冻', '膨化食品', '曲奇', '威化', '蛋糕', '面包', '蛋黄酥', '凤梨酥', '麻薯', '蛋卷', '海苔', '辣条', '豆干', '魔芋爽', '牛肉干', '鱿鱼丝', '果蔬脆']},
                {text: '饮品冲调', children: ['咖啡豆', '挂耳咖啡', '速溶咖啡', '咖啡液', '茶叶', '茶包', '奶茶粉', '可可粉', '蜂蜜', '麦片', '代餐粉', '蛋白粉', '豆浆粉', '芝麻糊', '藕粉', '椰子粉', '抹茶粉']},
                {text: '饮料', children: ['气泡水', '苏打水', '椰子水', '果汁', '果蔬汁', '酸奶', '乳酸菌', '牛奶', '豆奶', '椰奶', '杏仁奶', '燕麦奶', '可乐', '雪碧', '运动饮料', '功能饮料', '凉茶', '酸梅汤', '柠檬茶']},
                {text: '水果生鲜', children: ['苹果', '香蕉', '橙子', '草莓', '蓝莓', '车厘子', '芒果', '榴莲', '山竹', '牛油果', '猕猴桃', '葡萄', '水蜜桃', '荔枝', '龙眼', '柚子', '柠檬', '百香果', '菠萝', '火龙果', '哈密瓜', '西瓜']},
                {text: '滋补保健', children: ['燕窝', '阿胶', '枸杞', '人参', '灵芝', '鱼油', '维生素', '钙片', '褪黑素', '益生菌', '蛋白粉', '辅酶Q10', '叶黄素', '铁剂', '即食花胶', '黑芝麻丸', '阿胶糕', '黄芪', '当归', '石斛', '冬虫夏草']},
                // === 家居生活 ===
                {text: '家纺布艺', children: ['四件套', '蚕丝被', '羽绒被', '乳胶枕', '记忆枕', '凉席', '蚊帐', '毛毯', '地毯', '窗帘', '靠垫', '抱枕', '沙发垫', '桌布', '浴巾', '毛巾套装', '床笠', '床垫保护罩', '夏凉被']},
                {text: '厨房用具', children: ['不粘锅', '炒锅', '汤锅', '蒸锅', '空气炸锅', '破壁机', '电饭煲', '烤箱', '微波炉', '咖啡机', '榨汁机', '刀具套装', '砧板', '保温杯', '焖烧杯', '饭盒', '餐具套装', '调味罐', '油壶', '密封罐', '硅胶铲', '厨房秤']},
                {text: '家居装饰', children: ['花瓶', '装饰画', '摆件', '香薰', '挂钟', '镜子', '台灯', '落地灯', '收纳盒', '置物架', '相框', '绿植', '多肉', '花盆', '壁纸', '墙贴', '门帘', '挂毯', '照片墙', '烛台', '托盘']},
                {text: '清洁日用', children: ['洗衣液', '洗洁精', '洗手液', '消毒液', '纸巾', '湿巾', '拖把', '扫地机器人', '吸尘器', '洗地机', '垃圾桶', '保鲜袋', '垃圾袋', '收纳箱', '衣架', '粘毛器', '除湿盒', '樟脑丸', '马桶清洁剂', '玻璃清洁剂', '静电除尘掸']},
                // === 母婴宠物 ===
                {text: '母婴用品', children: ['纸尿裤', '拉拉裤', '奶粉', '奶瓶', '婴儿车', '安全座椅', '婴儿床', '爬行垫', '早教玩具', '婴儿服装', '睡袋', '包被', '哺乳内衣', '吸奶器', '温奶器', '消毒器', '辅食机', '婴儿湿巾', '护臀膏', '婴儿沐浴露', '儿童水杯', '牙胶', '摇铃']},
                {text: '宠物用品', children: ['猫粮', '狗粮', '猫砂', '宠物零食', '冻干', '猫条', '宠物玩具', '逗猫棒', '猫抓板', '猫爬架', '狗窝', '猫窝', '宠物牵引绳', '宠物衣服', '宠物梳子', '宠物沐浴露', '宠物食盆', '饮水机', '猫包', '航空箱', '猫砂盆', '尿垫', '拾便袋', '宠物推车']},
                // === 运动户外 ===
                {text: '运动健身', children: ['跑步机', '动感单车', '哑铃', '壶铃', '弹力带', '瑜伽垫', '瑜伽球', '泡沫轴', '跳绳', '健腹轮', '拉力器', '俯卧撑板', '筋膜枪', '运动护具', '运动水壶', '运动毛巾', '速干衣', '压缩裤']},
                {text: '户外露营', children: ['帐篷', '天幕', '睡袋', '防潮垫', '露营椅', '折叠桌', '露营灯', '烧烤炉', '卡式炉', '户外电源', '保温箱', '登山包', '登山杖', '冲锋衣', '速干裤', '徒步鞋', '渔具', '望远镜', '指南针', '多功能工兵铲']},
                // === 独立词（不需要子分类的热门品类） ===
                '玩具', '盲盒', '手办', '潮玩', '积木', '毛绒公仔', '模型',
                '文具', '手账本', '钢笔', '马克笔', '贴纸', '胶带',
                '文创礼品', '明信片', '书签', '日历', '贺卡',
                '鲜花', '花束', '永生花', '绿植盆栽', '多肉组合',
                '节日礼盒', '圣诞礼盒', '新年礼盒', '情人节礼盒', '母亲节礼盒',
                '明星同款', '联名限定款', '季节限定品', '限量发售', '首发新品',
                '电子产品', '小家电', '灯具', '雨伞', '保温杯', '行李箱'
            ],
            '展示状态': ['产品悬浮展示', '模特手持产品', '产品45度展示', '产品拆解爆炸图', '微距特写细节', '产品组合阵列', '动态飞溅效果', '产品切开截面', '光影穿过产品', '水面倒影展示', '产品旋转动感', '层叠排列造型', '产品与自然元素融合', '产品悬浮于光晕中', '镜面多重反射', '产品结冰或燃烧特效', '半透明透视展示', '产品与几何图形互动'],
            '广告标题': ['新品尝鲜', '限时特惠', '爆款返场', '明星同款', '人手必备', '品质之选', '匠心之作', '解锁美丽', '焕新升级', '年度重磅', '王炸单品', '必buy清单', '高阶玩家', '一步到位', '颜值担当', '实力派', '闭眼入', '不买后悔'],
            '促销文案': ['全场5折起', '买一送一', '第2件0元', '满300减50', '新人专享价', '限时24小时', '前100名半价', '领券立减100', '加购送赠品', '第二件半价', '每日秒杀', '拼团更优惠', '会员专享折扣', '清仓一口价', '首单包邮', '付定金翻倍', '下单抽免单', '集卡换好礼'],
            '场景': ['专业摄影棚', '极简白空间', '豪华酒店套房', '户外花园', '城市街头', '海边沙滩', '雪地场景', '森林深处', '咖啡厅一角', '卧室梳妆台', '浴室水流中', '办公桌面', '健身房', '厨房台面', '美术馆展厅', '飞机头等舱', '游艇甲板', '落日天台', '荧光派对', '直播间背景'],
            '风格': ['极简主义', '轻奢质感风', '赛博朋克风', '复古胶片感', '孟菲斯风格', '波普艺术', '日系小清新', '欧美时尚大片', '国潮新中式', '3D写实渲染', '扁平化插画', '线描手绘风', '水彩晕染', '酸性设计', '弥散光感', 'Y2K千禧风', '蒸汽波', '包豪斯现代', '自然有机风', '波西米亚'],
            '色彩': ['莫兰迪色系', '马卡龙色系', '高饱和撞色', '黑白极简', '金色奢华风', '蒂芙尼蓝', '爱马仕橙', '克莱因蓝', '千禧粉', '荧光绿', '金属色渐变', '紫蓝渐变', '温暖大地色', '清新薄荷绿', '经典红金配', '赛博霓虹灯色', '奶油白', '高级灰', '深海蓝', '樱花粉'],
            '质感': ['金属拉丝', '磨砂哑光', '亮面高光', '玻璃通透', '陶瓷釉面', '皮革纹理', '丝绸柔滑', '珠光贝母', '液态流动', '冰晶透明', '天鹅绒', '大理石纹', '木纹肌理', '钻石切割面', '水光镜面', '植绒柔雾', '珐琅彩', '拉丝不锈钢', '液态金属', '碳纤维纹理'],
            '光影': ['柔光漫射', '硬光侧打', '逆光轮廓光', '顶光聚焦', '蝴蝶光', '伦勃朗光', '环形光', '霓虹光晕', '自然窗光', '黄金时刻暖光', '冷白棚拍光', '氛围灯带', '光斑散景效果', '电影级三点布光', '隧道光效', '聚光灯舞台光', '左右夹光', '底光戏剧光'],
            '构图': ['居中对称构图', '三分法构图', '对角线构图', '引导线构图', '框架式构图', '大面积留白', '俯拍鸟瞰视角', '仰拍仰视视角', '微距特写', '45度产品视角', '平视标准视角', '散点分布构图', 'S形曲线构图', '三角形稳定构图', '前后景深层次', '镜面倒影构图'],
            '画质': ['8K超高清', '电影级画质', 'HDR高动态范围', '超写实渲染', 'Octane渲染器', '虚幻引擎5', '光线追踪', '超细节纹理', '景深虚化效果', '锐利焦点', '皮肤毛孔可见', '布料纹理清晰', '微距级细节', '商业级修图品质', 'C4D渲染', '照片级真实感', '高精度建模', '细腻毛发渲染'],
            '后期': ['高对比度', '低饱和度', '电影色调', '青橙色调', '赛博朋克调色', '奶油暖色调', '暗角效果', '颗粒胶片感', '清新通透调色', '高级灰调', '色彩分级', '柔光滤镜', '锐化增强', '暗部提亮', '高光压缩', '朦胧柔焦', '黑白单色', '复古褪色'],
            '负面提示词': ['模糊', '变形', '扭曲', '多指', '缺指', '低画质', '水印', '文字错误', '噪点', '压缩伪影', '过曝', '欠曝', '色彩偏移', '不协调比例', '解剖结构错误', '杂乱背景', '重复物体', '怪异人脸', '像素化', 'JPEG artifacts', '低分辨率纹理', '比例失衡'],

            // ==================== 图标设计公式词库 ====================
            '图标主体': [
                {text: '商业金融', children: ['钱包', '信用卡', '货币符号', '股票K线', '银行', '保险', '交易', '收据', '账本', '百分比', '金库', '存钱罐']},
                {text: '社交沟通', children: ['聊天气泡', '消息', '邮件', '电话', '联系人', '群组', '分享', '评论', '@提及', '点赞']},
                {text: '媒体播放', children: ['播放按钮', '暂停', '快进', '音量', '麦克风', '相机', '视频', '音乐音符', '播客']},
                {text: '工具设置', children: ['设置齿轮', '扳手', '螺丝刀', '调色板', '画笔', '剪刀', '尺子', '放大镜', '铅笔', '橡皮擦', '计算器']},
                {text: '文件文档', children: ['文件夹', '文档', 'PDF', '图片', '表格', '压缩包', '云存储', '上传', '下载']},
                {text: '导航地图', children: ['地图标记', '指南针', 'GPS定位', '路线', '起点', '终点', '红绿灯', '方向箭头', '地球', '导航']},
                {text: '天气自然', children: ['太阳', '月亮', '云朵', '雨滴', '雪花', '闪电', '彩虹', '星星', '温度计', '风']},
                {text: '时间日历', children: ['时钟', '日历', '闹钟', '秒表', '沙漏', '日程', '倒计时', '历史记录']},
                {text: '购物电商', children: ['购物车', '购物袋', '条形码', '标签', '礼物', '优惠券', '快递', '店铺', '价格标签', '扫码', '退货']},
                {text: '教育学习', children: ['书本', '毕业帽', '奖杯', '黑板', '铅笔', '书包', '证书', '图书馆', '显微镜']},
                {text: '医疗健康', children: ['十字医疗', '心形', '药丸', '急救箱', '听诊器', '注射器', 'DNA', '口罩', '血压计', '牙齿']},
                {text: '美食餐饮', children: ['餐具', '咖啡杯', '酒杯', '汉堡', '披萨', '蛋糕', '冰淇淋', '茶壶', '围裙', '厨师帽']},
                {text: '旅行交通', children: ['飞机', '汽车', '火车', '轮船', '自行车', '行李箱', '护照', '机票', '酒店', '地标', '背包']},
                {text: '安全防护', children: ['盾牌', '锁', '钥匙', '指纹', '人脸识别', '警报', '防火墙', '监控', '密码']},
                {text: '游戏娱乐', children: ['游戏手柄', '骰子', '扑克', '棋子', '靶心', '奖牌', '拼图', '魔方', 'VR眼镜', '街机']},
                {text: '家居生活', children: ['房屋', '灯泡', '沙发', '床', '洗衣机', '钥匙', '门铃', '温度', '窗帘']},
                {text: '运动健身', children: ['足球', '篮球', '跑步', '游泳', '瑜伽', '自行车', '拳击', '高尔夫']},
                {text: '品牌Logo', children: ['苹果', '安卓', 'Windows', 'Linux', 'Chrome', 'Twitter鸟', 'GitHub']},
                '火箭', '盾牌', '皇冠', '钻石', '星星', '火焰', '爱心', '齿轮', '灯泡', '钥匙'
            ],
            '图标类型': ['独立App图标', '功能按钮图标', '导航栏图标', 'Tab栏图标', '状态栏图标', '品牌标识图标', '空状态插画图标', '加载动画图标', '通知徽章图标', '设置面板图标', '文件类型图标', '启动屏图标'],
            '设计风格': ['线性极简风', '面性扁平风', '线面结合风', '玻璃拟态', '新拟物化', '3D写实渲染', '等距视角', '赛博朋克', '像素复古', '手绘涂鸦风', '孟菲斯风格', '酸性设计', 'Material Design', 'iOS圆角风', '渐变弥散风', '霓虹发光风', '剪纸层叠风', '水彩手绘', '金属质感', '极简黑白'],
            '色彩方案': ['单色渐变', '双色撞色', '彩虹渐变', '莫兰迪色系', '黑白极简', '蓝紫渐变', '粉橙暖色调', '青蓝冷色调', '金色奢华', '荧光霓虹', '自然大地色', '薄荷清新绿', '深海蓝', '暗夜模式', '纯白背景', '品牌主色', '克莱因蓝', '爱马仕橙'],
            '线条粗细': ['极细线 1px', '细线 2px', '标准线 3px', '中等线 4px', '粗线 5px', '超粗线 6px', '可变粗细', '无描边纯色'],
            '细节程度': ['极致简约', '简洁概括', '适中细节', '精细刻画', '超写实细节', '圆角柔和', '尖角硬朗', '混合圆角'],
            '背景处理': ['纯色圆角背景', '渐变圆形底', '无背景透明', '毛玻璃背景', '网格辅助背景', '光影投射背景', '双层底叠加', '暗色模式背景', '品牌色底', '3D场景背景'],
            '视角角度': ['正面正视', '45度等距', '俯视鸟瞰', '轻微侧视', '3D透视', '极简正投影', '仰视角度', '动态旋转'],
            '特殊效果': ['长投影', '内阴影', '发光描边', '渐变叠加', '磨砂质感', '玻璃折射', '光晕弥散', '描边断点', '双色叠加', '微动效暗示', '金属反射', '粒子点缀'],
            '画质输出': ['1024x1024方形', '512x512标准', 'SVG矢量感', '4K超清渲染', 'PNG透明通道', '2倍图@2x', '3倍图@3x', '自适应多尺寸'],

            // ==================== 创意海报设计公式词库 ====================
            '海报主题': ['音乐节海报', '电影宣传海报', '新品发布海报', '促销活动海报', '艺术展览海报', '公益宣传海报', '品牌形象海报', '文化节日海报', '旅行目的地海报', '美食餐厅海报', '运动赛事海报', '科技大会海报', '时尚潮流海报', '招聘招新海报', '课程培训海报', '电商促销海报', '文艺演出海报', '毕业季海报'],
            '视觉风格': ['孟菲斯风格', '酸性设计', '赛博朋克', '波普艺术', '极简主义', '弥散光感', 'Y2K千禧风', '蒸汽波', '复古胶片', '国潮新中式', '包豪斯现代', '日系小清新', '3D超现实', '故障艺术', '涂鸦街头风', '拼贴艺术', '超现实梦境', '扁平化插画', '瑞士国际主义', '新丑风', '水彩手绘', '剪纸艺术'],
            '主体元素': [
                {text: '人物', children: ['单人模特', '群体人物', '剪影人物', '名人肖像', '舞者', '运动员', '艺术家', '儿童', '老人', '情侣']},
                {text: '产品', children: ['电子产品', '美妆产品', '饮料瓶', '运动鞋', '食品包装', '珠宝首饰', '香水瓶', '手机']},
                {text: '动物', children: ['老虎', '狮子', '鹰', '鹿', '猫', '狗', '蝴蝶', '鲸鱼', '熊猫', '狼']},
                {text: '建筑地标', children: ['城市天际线', '埃菲尔铁塔', '长城', '金字塔', '古堡', '摩天大楼', '桥梁', '寺庙', '博物馆']},
                {text: '自然景观', children: ['山脉', '海洋', '瀑布', '极光', '星空', '沙漠', '森林', '冰川', '日落']},
                {text: '科技元素', children: ['芯片', '电路板', '数据流', 'AI大脑', '机器人', '全息投影', 'VR眼镜', '无人机']},
                {text: '太空宇宙', children: ['星球', '宇航员', '火箭', '银河', '黑洞', 'UFO', '星云', '空间站']},
                {text: '美食饮品', children: ['汉堡', '披萨', '寿司', '咖啡', '奶茶', '蛋糕', '红酒', '冰淇淋', '火锅', '鸡尾酒']},
                {text: '抽象图形', children: ['圆环', '三角', '方块', '波浪线', '点阵', '流体形状']},
                {text: '文字排版', children: ['大字标题', '字母组合', '中文书法', '数字', '标点符号', '多语言文字']},
                {text: '植物花卉', children: ['玫瑰', '樱花', '向日葵', '竹子', '荷叶', '仙人掌', '藤蔓', '银杏叶', '薰衣草']},
                {text: '乐器', children: ['吉他', '钢琴', '架子鼓', '萨克斯', '小提琴', '电子琴', '琵琶', '二胡']},
                {text: '交通工具', children: ['跑车', '摩托车', '帆船', '直升机', '热气球', '自行车', '滑板', '复古汽车']},
                {text: '运动', children: ['篮球', '足球', '滑雪', '冲浪', '拳击', '攀岩', '瑜伽', '马拉松']},
                '几何装置', '液态金属'
            ],
            '色彩搭配': ['高饱和撞色', '莫兰迪低饱和', '黑白红三色', '霓虹灯配色', '暖橙渐变', '蓝紫冷色调', '自然大地色', '粉紫梦幻', '黑白灰极简', '彩虹渐变', '荧光撞色', '复古暖调', '赛博暗夜', '马卡龙色系', '金色典雅', '蒂芙尼蓝', '克莱因蓝', '爱马仕橙'],
            '排版布局': ['居中对称', '左文右图', '上图下文', '散点自由', '满版出血', '网格系统', '对角线分割', '上下分割', '包围式', '阶梯式', '倾斜构图', '拼贴组合'],
            '文字设计': ['粗体大字标题', '衬线优雅字体', '无衬线现代字体', '手写书法体', '3D立体字', '霓虹发光字', '金属质感字', '镂空描边字', '像素风字体', '中英文混排', '竖排文字', '文字环绕图形', '大小对比排版', '文字蒙版'],
            '背景氛围': ['渐变弥散光', '网格纹理', '噪点肌理', '模糊光斑', '几何图形阵列', '动态线条', '水墨晕染', '星空宇宙', '植物剪影', '水波纹', '城市剪影', '烟雾效果', '纸张纹理', '纯色留白', '照片叠加', '色彩流体'],
            '图形元素': ['几何圆形', '不规则形状', '线条装饰', '箭头引导', '网格线框', '色块拼接', '圆环嵌套', '三角组合', '点阵装饰', '波纹曲线', '星形元素', '箭头标签', '贴纸风格', '数字编号'],
            '装饰点缀': ['光晕效果', '粒子飘散', '火花四溅', '花瓣飘落', '水珠气泡', '闪粉碎屑', '火焰烟雾', '霓虹描边', '投影立体', '毛边撕纸', '邮票齿孔', '胶带贴纸'],
            '光影效果': ['舞台聚光', '逆光剪影', '霓虹灯带', '窗户投影', '柔光漫射', '光柱穿透', '反射高光', '暗角氛围', '长阴影', '双光源'],
            '质感材质': ['磨砂质感', '金属光泽', '玻璃透明', '纸张肌理', '塑料光滑', '液态流动', '布料纹理', '大理石纹', '木纹肌理', '陶瓷釉面', '天鹅绒', '钻石切割'],

            // ==================== Logo设计公式词库 ====================
            'Logo类型': ['图形Logo', '文字Logo', '图文组合Logo', '字母缩写Logo', '徽章Logo', '吉祥物Logo', '抽象符号Logo', '负空间Logo', '动态Logo', '极简标记Logo'],
            '品牌名称': ['示例：TechFlow', '示例：花间集', '示例：PixelLab', '示例：星辰科技', '示例：云栖茶社'],
            '图形元素': [
                {text: '动物', children: ['狮子', '鹰', '鹿', '狼', '猫头鹰', '狐狸', '蛇', '熊', '蜂鸟', '海豚', '孔雀', '熊猫']},
                {text: '植物', children: ['玫瑰', '莲花', '竹子', '橄榄枝', '松树', '银杏', '樱花', '四叶草', '藤蔓', '小麦']},
                {text: '几何图形', children: ['圆形', '方形', '三角形', '六边形', '菱形', '星形', '螺旋', '椭圆', '八边形']},
                {text: '天文星象', children: ['太阳', '月亮', '星星', '彗星', '星座', '银河', '日食', '北斗七星']},
                {text: '山峦自然', children: ['山峰', '火山', '雪山', '丘陵', '悬崖', '岛屿', '波浪']},
                {text: '水波纹', children: ['水滴', '波浪', '漩涡', '河流', '海洋']},
                {text: '建筑', children: ['拱门', '柱子', '穹顶', '塔楼', '城堡', '桥梁', '金字塔']},
                {text: '字母组合', children: ['A', 'M', 'S', 'N', 'X', 'O']},
                {text: '科技符号', children: ['芯片', '齿轮', '电路', '原子', '分子', '二进制', '雷达', '天线']},
                {text: '皇冠盾牌', children: ['皇冠', '盾牌', '宝剑', '盔甲', '旗帜', '勋章']},
                {text: '爱心', children: ['实心爱心', '空心爱心', '双爱心', '心形飘带']},
                {text: '火焰', children: ['火苗', '烈焰', '火花', '烛火', '凤凰']},
                {text: '箭头', children: ['向上箭头', '向右箭头', '循环箭头', '十字箭头', '折线箭头', '方向指针']},
                {text: '眼睛', children: ['写实眼睛', '几何眼睛', '埃及之眼', '猫眼']},
                '无限符号', '莫比乌斯环', '拼图', '指纹', '羽翼', '十字'
            ],
            '字体风格': ['无衬线现代', '衬线经典', '手写书法', '粗黑体', '细线优雅', '圆体可爱', '等宽科技', '定制字体', '字母变形', '镂空描边', '连笔签名', '哥特复古'],
            '构成方式': ['正负形', '对称镜像', '旋转重复', '渐变融合', '层叠嵌套', '黄金比例', '网格模数', '一笔画成', '留白暗示', '破形设计'],
            '造型手法': ['几何化概括', '线条化简化', '块面化处理', '圆角柔化', '断笔处理', '共用笔画', '图形替换', '透视变形', '重复构成', '渐变过渡'],
            '背景底衬': ['纯白背景', '纯黑背景', '渐变圆形底', '透明背景', '纹理纸张', '金属质感', '网格展示', '品牌色背景'],
            '质感效果': ['扁平纯色', '渐变光泽', '金属烫金', '磨砂哑光', '浮雕凹凸', '霓虹发光', '水彩晕染', '印章效果', '刺绣纹理', '玻璃透明'],

            // ==================== 人像写真公式词库 ====================
            '人物特征': ['亚洲女性', '欧美女性', '亚洲男性', '欧美男性', '少女', '成熟女性', '儿童', '老年人', '双人合影', '家庭合影', '情侣写真', '闺蜜合照', '孕妇写真', '新生儿', '宠物合影', '职业形象'],
            '姿势动作': ['站立正面', '侧身回眸', '坐姿优雅', '行走动态', '躺卧放松', '跳跃动感', '手托下巴思考', '撩发动作', '闭眼微笑', '手扶帽檐', '舞动瞬间', '抱膝而坐', '双手交叉', '倚靠墙壁', '手捧花束', '奔跑追逐', '手遮阳光', '半身特写', '全身展示', '背影意境'],
            '服装造型': [
                {text: '日常休闲', children: ['白T恤', '牛仔裤', '卫衣', '运动鞋', '帆布鞋', '针织衫', '宽松衬衫', '短裤', '连衣裙', '背带裤']},
                {text: '职场通勤', children: ['西装套装', '白衬衫', '西装裙', '阔腿裤', '风衣', '乐福鞋', '丝巾', '公文包']},
                {text: '礼服正装', children: ['晚礼服', '燕尾服', '小黑裙', '鱼尾裙', '西装三件套', '领结', '手拿包', '高跟鞋']},
                {text: '中式汉服', children: ['齐胸襦裙', '对襟衫裙', '明制马面裙', '圆领袍', '曲裾', '披帛', '发簪', '团扇']},
                {text: '和服韩服', children: ['振袖和服', '浴衣', '韩服赤古里', '腰带', '木屐', '发饰']},
                {text: '运动健身', children: ['运动背心', '瑜伽裤', '跑步鞋', '运动发带', '护腕', '速干T恤']},
                {text: '街头潮流', children: ['oversize卫衣', '工装裤', '棒球帽', 'AJ球鞋', '链条配饰', '渔夫帽', '涂鸦T恤', '机能马甲']},
                {text: '学院风', children: ['格纹短裙', 'V领毛衣', '领结', '百褶裙', '牛津鞋', '西装外套']},
                {text: '波西米亚', children: ['印花长裙', '流苏马甲', '编织腰带', '宽檐帽', '民族风饰品']},
                {text: '甜美少女', children: ['蕾丝连衣裙', '泡泡袖', '蝴蝶结发饰', '玛丽珍鞋', '碎花裙', '贝雷帽']},
                {text: '复古港风', children: ['高腰牛仔裤', '垫肩西装', '红唇妆容', '大耳环', '波浪卷发', '印花衬衫']},
                {text: '婚纱礼服', children: ['白婚纱', '头纱', '花环', '手捧花', '晨袍', '中式秀禾', '龙凤褂']},
                {text: '泳装', children: ['比基尼', '连体泳衣', '沙滩裙', '草帽']},
                {text: '睡衣家居', children: ['丝绸睡衣', '毛绒睡袍', '眼罩', '拖鞋']},
                {text: '赛博朋克', children: ['发光外套', '护目镜', '机械臂', 'LED线缆', '金属面罩', '荧光纹身']},
                {text: '洛丽塔', children: ['甜系Lo裙', '哥特Lo裙', '裙撑', '头饰KC', '圆头鞋']},
                {text: 'JK制服', children: ['水手服', '西装制服', '格裙', '领结', '制服包']},
                '极简白T', '皮衣夹克', '毛呢大衣', '旗袍', '古装侠客'
            ],
            '妆发造型': ['自然裸妆', '韩系水光妆', '日系元气妆', '欧美立体妆', '复古红唇妆', '烟熏妆', '素颜感', '长直发', '大波浪卷发', '丸子头', '马尾辫', '短发清爽', '盘发典雅', '湿发造型', '编发辫子', '双马尾'],
            '场景环境': ['纯色影棚', '白墙极简', '自然花海', '海边沙滩', '森林秘境', '城市街拍', '天台落日', '咖啡馆', '图书馆', '画室艺术', '古典园林', '日式庭院', '雪景冬日', '樱花树下', '芦苇荡', '工业废墟', '老洋房', '地铁站', '游乐园', '麦田', '薰衣草田', '镜面空间'],
            '光线布光': ['柔光漫射', '黄金时刻暖光', '逆光轮廓光', '侧光立体', '蝴蝶光', '伦勃朗光', '环形光', '自然窗光', '霓虹灯光', '烛光氛围', '棚拍三点布光', '阴天柔光', '顶光戏剧', '底光诡异', '光斑散景', '隧道光', '暮光蓝调', '日光直射'],
            '拍摄角度': ['平视中景', '半身近景', '面部特写', '全身远景', '俯拍45度', '仰拍英雄视角', '侧拍45度', '低角度', '高角度', '肩部特写', '眼部特写', '背影远景'],
            '镜头焦段': ['35mm人文视角', '50mm标准镜头', '85mm人像王', '135mm长焦压缩', '200mm空气切割', '24mm广角张力', '大光圈f1.4', '大光圈f1.8', '大光圈f2.8', '鱼眼夸张'],
            '色调风格': ['日系胶片', '电影感色调', '清新通透', '复古暖调', '冷白高级感', '黑白人像', '奶油肤色', '青橙色调', '柯达胶片', '富士胶片', '港风暖黄', 'INS风格', '暗调情绪', '高调唯美', '赛博色调', '莫兰迪色调'],
            '情绪氛围': ['开心笑容', '忧郁沉思', '酷感冷峻', '温柔恬静', '性感妩媚', '青春活力', '霸气自信', '慵懒随性', '纯真可爱', '神秘深邃', '浪漫唯美', '知性优雅', '街头叛逆', '安静内敛', '自由洒脱', '温暖治愈'],
            '构图方式': ['居中构图', '三分法构图', '对角线构图', '引导线构图', '框架式构图', '留白构图', '前景虚化', '对称构图', '三角形构图', '包围式构图'],

            // ==================== 封面包装设计公式词库 ====================
            '包装类型': ['盒装包装', '袋装包装', '瓶装容器', '罐装包装', '管状包装', '礼盒套装', '化妆品瓶罐', '食品包装袋', '电子产品盒', '饮料瓶身', '书本封面', '唱片封面', '手提袋', '信封卡片', '茶叶罐', '香薰蜡烛罐'],
            '产品类别': [
                {text: '美妆护肤', children: ['面霜', '精华液', '口红', '眼影盘', '粉底液', '面膜', '防晒霜', '香水瓶', '卸妆油', '护手霜', '沐浴露', '洗发水']},
                {text: '食品零食', children: ['巧克力', '饼干', '糖果', '坚果', '蛋糕', '薯片', '果冻', '曲奇', '蛋黄酥', '牛肉干']},
                {text: '饮品酒类', children: ['红酒', '威士忌', '清酒', '精酿啤酒', '气泡水', '果汁', '咖啡豆', '茶叶', '奶茶', '椰子水']},
                {text: '健康保健', children: ['维生素', '蛋白粉', '益生菌', '鱼油', '钙片', '褪黑素', '代餐奶昔', '中药饮片']},
                {text: '电子数码', children: ['手机盒', '耳机盒', '充电宝', '智能手表', '键盘', '鼠标', '音箱', '平板电脑']},
                {text: '香氛蜡烛', children: ['香薰蜡烛', '无火香薰', '精油套装', '车载香薰', '线香', '香挂']},
                {text: '茶叶咖啡', children: ['龙井茶', '普洱', '大红袍', '白茶', '挂耳咖啡', '咖啡豆', '速溶咖啡', '花草茶']},
                {text: '珠宝首饰', children: ['项链礼盒', '戒指盒', '手镯', '耳环', '胸针', '手表']},
                {text: '文创文具', children: ['手账本', '钢笔', '墨水', '印章', '贴纸', '日历', '书签', '贺卡']},
                {text: '服装服饰', children: ['T恤包装', '袜子套装', '围巾', '领带', '内衣', '帽子']},
                {text: '母婴用品', children: ['奶粉罐', '奶瓶', '婴儿护肤品', '辅食', '玩具包装', '纸尿裤']},
                {text: '宠物食品', children: ['猫粮袋', '狗粮袋', '宠物零食', '冻干', '猫罐头']},
                {text: '鲜花礼品', children: ['花束包装', '永生花盒', '礼盒套装', '贺卡', '丝带']},
                {text: '书籍唱片', children: ['精装书', '平装书', '黑胶唱片', 'CD', '画册']},
                {text: '运动户外', children: ['运动水壶', '瑜伽垫', '跳绳', '护具', '速干衣']},
                '节日限定礼盒', '联名合作款', '盲盒潮玩', '品牌周边'
            ],
            '材质工艺': ['哑光磨砂', '亮面高光', '烫金工艺', '烫银工艺', 'UV局部上光', '浮雕凹凸', '金属拉丝', '玻璃通透', '皮革纹理', '木纹肌理', '珠光贝母', '天鹅绒', '大理石纹', '压纹纹理', '磨砂玻璃', '镭射幻彩', '陶瓷釉面', '碳纤维纹理'],
            '图案元素': ['几何图形', '花卉植物', '抽象线条', '插画图案', '渐变弥散', '纹理底纹', '波点条纹', '品牌Logo', '手绘涂鸦', '中式纹样', '日式海浪', '欧式巴洛克', '星月宇宙', '热带植物', '动物剪影', '像素图案'],
            '文字排版': ['居中大标题', '左对齐排版', '竖排中文', '环绕式文字', '衬线优雅字体', '无衬线现代字体', '手写书法体', '粗体大字', '镂空描边字', '大小对比排版', '标签式排版', '信息层级清晰'],
            '展示角度': ['正面平视', '45度展示', '俯拍鸟瞰', '3/4侧视', '产品悬浮', '组合阵列', '开盒展示', '手持展示', '微距特写', '场景融入'],
            '背景环境': ['纯白棚拍', '渐变色彩', '大理石台面', '木纹桌面', '镜面反射', '丝绸衬底', '水泥工业风', '自然植物', '金色幕布', '深色背景', '水波纹', '场景化环境', '纸张纹理', '糖果色几何']
        };

        // 获取某个分类的有效默认词库（优先自定义默认，回退系统默认，再回退空数组）
        function getCategoryDefaultWords(categoryName) {
            const customDefaults = getThesaurusDefaults();
            if (customDefaults[categoryName] && customDefaults[categoryName].length > 0) {
                return customDefaults[categoryName];
            }
            return SYSTEM_THESAURUS_DEFAULTS[categoryName] || [];
        }

        // ========== 分层词库辅助函数 ==========
        // word 可以是字符串 "水果" 或对象 {text:"水果", children:["香蕉","葡萄"]}
        // 以下函数统一处理两种格式

        // 获取词的显示文本
        function getWordText(word) {
            return (typeof word === 'object' && word !== null) ? (word.text || '') : String(word || '');
        }

        // 获取词的子词汇数组
        function getWordChildren(word) {
            if (typeof word === 'object' && word !== null && Array.isArray(word.children)) {
                return word.children.filter(c => typeof c === 'string' && c.trim());
            }
            return [];
        }

        // 判断词是否有子词汇
        function hasWordChildren(word) {
            return getWordChildren(word).length > 0;
        }

        // 判断一个值是否是分层词对象
        function isWordObject(word) {
            return typeof word === 'object' && word !== null && typeof word.text === 'string';
        }

        // 获取一个词的所有可选值（包括自身和子词汇）
        function getWordOptions(word) {
            const text = getWordText(word);
            const children = getWordChildren(word);
            if (children.length > 0) {
                return [text, ...children];
            }
            return [text];
        }

        function renderCategories() {
            const thesaurus = getThesaurus();
            const container = document.getElementById('categoryList');

            // 获取当前公式的变量分类，只显示相关分类
            const formula = getCurrentFormula();
            const formulaCategories = formula
                ? new Set(parseVariables(formula.template).map(v => v.category))
                : null;

            // 过滤：有公式时只显示公式用到的分类，没有公式时显示全部
            let visibleCategories = formulaCategories
                ? thesaurus.filter(cat => formulaCategories.has(cat.name))
                : thesaurus;

            // 当有公式选中时，按照公式template中变量的顺序排列词库分类
            if (formula && formulaCategories) {
                const varOrder = parseVariables(formula.template).map(v => v.category);
                const catMap = {};
                visibleCategories.forEach(cat => { catMap[cat.name] = cat; });
                visibleCategories = varOrder.map(name => catMap[name]).filter(Boolean);
            }

            if (visibleCategories.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p class="empty-state-text">${thesaurus.length === 0 ? '暂无词库分类' : '当前公式没有对应的词库分类'}</p>
                    </div>
                `;
                return;
            }

            const customDefaults = getThesaurusDefaults();

            container.innerHTML = visibleCategories.map(cat => {
                const multiVal = currentSelections[cat.name];
                const selectedCount = Array.isArray(multiVal) ? multiVal.length : 0;
                const countBadge = selectedCount > 0 ? `<span class="badge sel-badge">已选${selectedCount}</span>` : '';
                const hasCustomDefault = customDefaults[cat.name] && customDefaults[cat.name].length > 0;
                const defaultBadge = hasCustomDefault ? '<span class="badge" style="background:#f59e0b;color:#fff;" title="已设置自定义默认值">默认</span>' : '';

                // 渲染词汇标签（支持分层词汇）
                const wordTags = cat.words.map(word => renderWordTag(cat, word)).join('');

                return `
                <div class="category-item">
                    <div class="category-header">
                        <div class="category-name">
                            ${escapeHtml(cat.name)}
                            ${countBadge}
                            <span class="badge">${cat.words.length}</span>
                            ${defaultBadge}
                        </div>
                        <div style="display: flex; gap: 0.25rem; align-items: center;">
                            <button class="btn btn-smart-search" onclick="openSmartSearch('${cat.id}')" title="智能搜索相关词汇">🔍 智能推荐</button>
                            <button class="btn btn-ghost btn-sm" onclick="openAddWordModal('${cat.id}')" title="添加词汇">添加词汇</button>
                            <button class="btn btn-ghost btn-sm" onclick="saveCategoryAsDefault('${cat.id}')" title="将当前词库保存为默认值">设为默认</button>
                            <button class="btn btn-ghost btn-sm" onclick="resetSingleCategoryToDefault('${cat.id}')" title="恢复此分类到默认值">恢复</button>
                        </div>
                    </div>
                    <div class="words-grid">
                        ${wordTags}
                    </div>
                </div>
            `}).join('');
        }

        // 渲染单个词汇标签（支持分层词汇）
        function renderWordTag(cat, word) {
            const text = getWordText(word);
            const children = getWordChildren(word);
            const wordId = cat.id + '_' + encodeURIComponent(text);
            const isParentSelected = isWordSelected(cat.name, text);

            let html = '';
            if (children.length > 0) {
                // 统计子词中被选中的数量
                const selectedChildrenCount = children.filter(c => isWordSelected(cat.name, c)).length;
                const selBadge = selectedChildrenCount > 0 ? `<span class="word-parent-count" style="color:#818cf8;">${selectedChildrenCount}选</span>` : '';

                // 父词标签：左侧色条指示 + 名称 + 子词数 + 选中数 + 展开箭头 + 删除
                html += `<span class="word-tag word-parent ${isParentSelected ? 'selected' : ''}" 
                    onclick="toggleWordSelection(\`${escapeAttr(cat.name)}\`, \`${escapeAttr(text)}\`)" 
                    title="点击选中父词，或点击▼展开${children.length}个子商品">
                    <span class="word-parent-dot"></span>
                    ${escapeHtml(text)}
                    <span class="word-parent-count">${children.length}</span>
                    ${selBadge}
                    <span class="word-expand-arrow" onclick="event.stopPropagation(); toggleWordChildren(this)" title="展开/收起子商品">▼</span>
                    <span class="remove" onclick="event.stopPropagation(); deleteWord(\`${cat.id}\`, \`${escapeAttr(text)}\`)">✕</span>
                </span>`;

                // 子词汇面板
                html += `<span class="word-children-panel" data-parent="${escapeAttr(text)}">`;
                children.forEach(child => {
                    const isChildSelected = isWordSelected(cat.name, child);
                    html += `<span class="word-tag word-child ${isChildSelected ? 'selected' : ''}" 
                        onclick="toggleWordSelection(\`${escapeAttr(cat.name)}\`, \`${escapeAttr(child)}\`)" 
                        title="选择：${escapeHtml(child)}">
                        ${escapeHtml(child)}
                        <span class="remove" onclick="event.stopPropagation(); deleteWordChild(\`${cat.id}\`, \`${escapeAttr(text)}\`, \`${escapeAttr(child)}\`)">✕</span>
                    </span>`;
                });
                html += `</span>`;
            } else {
                // 普通词汇
                html += `<span class="word-tag ${isParentSelected ? 'selected' : ''}" 
                    onclick="toggleWordSelection(\`${escapeAttr(cat.name)}\`, \`${escapeAttr(text)}\`)" 
                    title="点击添加/移除此词汇">
                    ${escapeHtml(text)}
                    <span class="remove" onclick="event.stopPropagation(); deleteWord(\`${cat.id}\`, \`${escapeAttr(text)}\`)">✕</span>
                </span>`;
            }
            return html;
        }

        // 存储当前选择 { category: [words] }（全部多选）
        let currentSelections = {};

        function isWordSelected(category, word) {
            const val = currentSelections[category];
            if (val === undefined) return false;
            return val.includes(word);
        }

        function toggleWordSelection(category, word) {
            const formula = getCurrentFormula();
            if (!formula) {
                showToast('请先选择一个公式', 'warning');
                return;
            }

            const variables = parseVariables(formula.template);
            
            // 验证这个分类是否在公式中存在
            const hasMatch = variables.some(v => v.category === category);
            if (!hasMatch) {
                showToast(`当前公式中没有「${category}」变量`, 'warning');
                return;
            }

            // 全部多选：增删数组
            let arr = currentSelections[category];
            if (!Array.isArray(arr)) arr = [];
            const idx = arr.indexOf(word);
            if (idx > -1) {
                arr.splice(idx, 1);
            } else {
                arr.push(word);
            }
            if (arr.length === 0) {
                delete currentSelections[category];
            } else {
                currentSelections[category] = arr;
            }

            // 更新UI
            renderCategories();
            updateResult();
        }

        function clearSelections() {
            currentSelections = {};
            renderCategories();
            updateResult();
        }
        function updateResult() {
            const formula = getCurrentFormula();
            if (!formula) {
                document.getElementById('resultTextarea').value = '';
                return;
            }

            let result = formula.template;

            // 替换已选择的变量（全部多选，用"、"拼接）
            Object.keys(currentSelections).forEach(category => {
                const val = currentSelections[category];
                let replacement;
                // 广告标题：加「标题："xx"」格式
                if (category === '广告标题') {
                    replacement = '标题："' + val.join('"、"') + '"';
                }
                // 促销文案：加「副标题："xx"」格式
                else if (category === '促销文案') {
                    replacement = '副标题："' + val.join('"、"') + '"';
                } else {
                    replacement = val.join('、');
                }
                result = result.replace(new RegExp(`\\{\\{${category}\\}\\}`, 'g'), replacement);
            });

            // 移除未选择的 {{变量}} 及周围的逗号分隔符
            result = result.replace(/\s*[,，]\s*\{\{[^}]+\}\}/g, '');  // 带前置逗号的
            result = result.replace(/\{\{[^}]+\}\}\s*[,，]\s*/g, '');  // 带后置逗号的
            result = result.replace(/\{\{[^}]+\}\}/g, '');              // 孤立变量

            // 清理可能残留的多余逗号
            result = result.replace(/[,，]{2,}/g, '，');
            result = result.replace(/^[,，]\s*/, '');
            result = result.replace(/\s*[,，]\s*$/, '');

            // 附加标题排版指令（自然语言融入提示词）
            const layout = getTitleLayout();
            const headline = currentSelections['广告标题'];
            const promo = currentSelections['促销文案'];
            if (layout.enabled && (headline || promo)) {
                const instruction = generateTitleLayoutInstruction(layout, headline, promo);
                if (instruction) {
                    result = result.trim();
                    if (result) result += '，';
                    result += instruction;
                }
            }

            // 附加尺寸设定
            if (currentSize) {
                const tabs = getSizeTabs();
                const tab = tabs.find(t => t.id === currentSizeTabId);
                const isRatio = currentSizeIsCustom ? false : (tab && tab.type === 'ratio');
                const label = isRatio ? '比例' : '尺寸';
                result = result.trim() + '\n\n' + label + '：' + currentSize;
            }

            document.getElementById('resultTextarea').value = result.trim();
            invalidateModelCache(); // 内部已调用 renderOptStatusBar
            updateTitlePreview();
        }

        // deleteCategory 已移除：词库分类不能单独删除，需通过编辑公式模板移除 {{分类}} 占位符。
        // 当分类不再被任何公式引用时，deleteFormula 会自动清理该分类。

        function openAddWordModal(categoryId = null) {
            document.getElementById('wordCategory').value = categoryId || '';
            document.getElementById('newWord').value = '';
            document.getElementById('wordChildren').value = '';
            document.getElementById('batchWords').value = '';
            document.getElementById('batchHint').textContent = '';
            // 重置分隔符为自动识别
            const autoRadio = document.querySelector('input[name="batchSep"][value="auto"]');
            if (autoRadio) autoRadio.checked = true;

            // Populate category dropdown
            const select = document.getElementById('wordCategory');
            const thesaurus = getThesaurus();
            select.innerHTML = thesaurus.map(c =>
                `<option value="${c.id}">${escapeHtml(c.name)}</option>`
            ).join('');

            if (categoryId) {
                select.value = categoryId;
            }

            document.getElementById('addWordModal').classList.add('active');
        }

        function closeAddWordModal() {
            document.getElementById('addWordModal').classList.remove('active');
            document.getElementById('newWord').value = '';
            document.getElementById('wordChildren').value = '';
            document.getElementById('batchWords').value = '';
            document.getElementById('batchHint').textContent = '';
        }

        // ==================== Smart Search ====================
        let smartSearchTargetCategoryId = null;
        let smartSearchSelectedWords = new Set();
        let _smartSearchDisplayPool = [];   // 展示池：已排重+打乱的候选词，直接切片使用
        let _smartSearchPage = 0;           // 当前页码
        const SMART_BATCH_SIZE = 20;        // 每批展示数量

        function openSmartSearch(categoryId) {
            smartSearchTargetCategoryId = categoryId;
            smartSearchSelectedWords = new Set();
            _smartSearchDisplayPool = [];
            _smartSearchPage = 0;
            window._smartSearchAIWords = [];
            window._smartSearchPresetWords = [];

            const thesaurus = getThesaurus();
            const category = thesaurus.find(c => c.id === categoryId);
            if (!category) return;

            // 排除已有词汇（使用归一化后的key做比对，兼容分层词对象）
            window._smartSearchExisting = new Set();
            category.words.forEach(w => {
                const text = getWordText(w);
                window._smartSearchExisting.add(normalizeWord(text));
                // 同时排除子词汇
                getWordChildren(w).forEach(child => {
                    window._smartSearchExisting.add(normalizeWord(child));
                });
            });

            // 从公式模板中提取关联的分类名，用于更精准的推荐上下文
            const formulas = getFormulas();
            const allFormulaCategories = new Set();
            formulas.forEach(f => {
                const vars = parseVariables(f.template);
                vars.forEach(v => allFormulaCategories.add(v.category));
            });
            window._smartSearchFormulaCategories = allFormulaCategories;

            document.getElementById('smartSearchTitle').textContent = `智能推荐 · ${escapeHtml(category.name)}`;
            document.getElementById('smartSearchKeyword').value = category.name;
            document.getElementById('smartSearchResults').innerHTML =
                '<div class="loading">正在理解「' + escapeHtml(category.name) + '」的语义，为你推荐相关词汇...</div>';
            document.getElementById('smartSearchInfoBar').style.display = 'none';
            updateSelectionCount();
            document.getElementById('smartSearchModal').classList.add('active');

            // 初始化 AI 配置 UI
            initAIConfigUI();

            // 自动搜索
            doSmartSearch();
        }

        function closeSmartSearchModal() {
            document.getElementById('smartSearchModal').classList.remove('active');
            smartSearchTargetCategoryId = null;
            smartSearchSelectedWords = new Set();
            _smartSearchDisplayPool = [];
            _smartSearchPage = 0;
            window._smartSearchAIWords = [];
            window._smartSearchPresetWords = [];
            // 重置为占位引导状态
            document.getElementById('smartSearchResults').innerHTML = `
                <div class="smart-search-placeholder">
                    <div class="placeholder-icon">🔍</div>
                    <div class="placeholder-title">智能词汇推荐</div>
                    <div class="placeholder-desc">点击分类旁的「智能推荐」按钮，AI 将分析分类语义，为你精准推荐相关设计词汇</div>
                </div>`;
            document.getElementById('smartSearchInfoBar').style.display = 'none';
            updateSelectionCount();
        }

        async function doSmartSearch() {
            const keyword = document.getElementById('smartSearchKeyword').value.trim();
            if (!keyword) {
                showToast('请输入搜索关键词', 'warning');
                return;
            }

            const resultsContainer = document.getElementById('smartSearchResults');
            resultsContainer.innerHTML = '<div class="loading">正在理解分类语义，生成精准推荐...</div>';

            // 显示信息栏
            const infoBar = document.getElementById('smartSearchInfoBar');
            infoBar.style.display = 'flex';
            updateSourceInfo('loading', '正在分析...');

            smartSearchSelectedWords = new Set();
            _smartSearchDisplayPool = [];
            _smartSearchPage = 0;
            updateSelectionCount();

            const existing = window._smartSearchExisting || new Set();
            const formulaCategories = window._smartSearchFormulaCategories || new Set();

            // 获取分类已有词库（给 AI 提供上下文避免重复）
            const thesaurus = getThesaurus();
            const category = thesaurus.find(c => c.name === keyword || c.id === smartSearchTargetCategoryId);
            const categoryWords = category ? category.words : [];

            // 用于跟踪词汇来源（分组渲染用）
            window._smartSearchAIWords = [];
            window._smartSearchPresetWords = [];

            // === 第一步：AI 语义理解推荐（主推荐源） ===
            let rawCandidates = [];
            let aiStatus = '';

            const aiConfig = getAIConfig();
            if (aiConfig.enabled && aiConfig.apiKey) {
                try {
                    const aiWords = await fetchAIRecommendations(keyword, categoryWords, formulaCategories);
                    if (aiWords.length > 0) {
                        rawCandidates.push(...aiWords);
                        window._smartSearchAIWords = [...aiWords];
                        aiStatus = 'ai';
                    }
                } catch (e) {
                    console.warn('[智能推荐] AI 调用异常，使用降级方案');
                }
            }

            // === 第二步：内置预设词库（作为补充/降级） ===
            const presetWords = getPresetWordsByCategory(keyword);
            if (presetWords.length > 0) {
                rawCandidates.push(...presetWords);
                window._smartSearchPresetWords = [...presetWords];
                if (!aiStatus) aiStatus = 'preset';
            }

            // === 第三步：基础生成词（最终降级，仅在候选词不足时启用） ===
            if (rawCandidates.length < 10) {
                rawCandidates.push(...generateBasicWords(keyword));
                if (!aiStatus) aiStatus = 'fallback';
            }

            // === 第四步：分层排重 ===
            _smartSearchDisplayPool = deduplicateCandidates(rawCandidates, existing, {
                fuzzyThreshold: 1,
                minLen: 1,
                maxLen: 20
            });

            // 随机打乱展示池
            shuffleArray(_smartSearchDisplayPool);

            // === 第五步：更新来源信息 ===
            if (aiStatus === 'ai') {
                updateSourceInfo('ai', 'AI 语义分析');
            } else if (aiStatus === 'preset') {
                updateSourceInfo('preset', '内置词库推荐');
            } else {
                updateSourceInfo('fallback', '基础词汇生成');
            }

            // === 第六步：取第一页展示 ===
            const batch = _smartSearchDisplayPool.slice(0, SMART_BATCH_SIZE);

            if (batch.length > 0) {
                renderSmartSearchResults(batch);
            } else {
                resultsContainer.innerHTML = '<div class="loading">未找到推荐词汇，请尝试修改搜索词</div>';
            }

            // === 第七步：后台在线搜索补充（候选词不够时） ===
            if (batch.length < SMART_BATCH_SIZE || _smartSearchDisplayPool.length < SMART_BATCH_SIZE * 2) {
                fetchOnlineWords(keyword).then(onlineWords => {
                    if (!onlineWords.length) return;
                    const poolNormSet = new Set(_smartSearchDisplayPool.map(normalizeWord));
                    const freshOnline = onlineWords.filter(w => {
                        const nk = normalizeWord(w);
                        return !existing.has(nk) && !poolNormSet.has(nk);
                    });
                    if (freshOnline.length > 0) {
                        shuffleArray(freshOnline);
                        _smartSearchDisplayPool = [..._smartSearchDisplayPool, ...freshOnline];
                        if (batch.length < SMART_BATCH_SIZE) {
                            const refill = _smartSearchDisplayPool.slice(0, SMART_BATCH_SIZE);
                            if (refill.length > 0) {
                                renderSmartSearchResults(refill);
                            }
                        }
                    }
                }).catch(() => {});
            }
        }

        // 更新来源信息栏
        function updateSourceInfo(status, text) {
            const sourceEl = document.getElementById('smartSearchSource');
            sourceEl.className = 'smart-search-source ' + status + '-source';
            const dotEl = sourceEl.querySelector('.source-dot');
            const textEl = sourceEl.querySelector('.source-text');
            if (textEl) textEl.textContent = text;
        }

        // 更新已选计数
        function updateSelectionCount() {
            const count = smartSearchSelectedWords.size;
            const numEl = document.getElementById('smartSearchCountNum');
            const labelEl = document.getElementById('smartSearchCountLabel');
            if (numEl) {
                numEl.textContent = count;
                numEl.className = 'count-number' + (count > 0 ? ' has-selection' : '');
            }
            if (labelEl) {
                labelEl.textContent = count > 0 ? '已选' : '已选';
            }
        }

        // 换一批：基于展示池 + 页码翻页，简单可靠
        function doNextBatch() {
            if (_smartSearchDisplayPool.length === 0) {
                _smartSearchPage = 0;
                doSmartSearch();
                return;
            }

            _smartSearchPage++;
            const start = _smartSearchPage * SMART_BATCH_SIZE;

            // 如果超出范围，回到开头并重新打乱
            if (start >= _smartSearchDisplayPool.length) {
                _smartSearchPage = 0;
                shuffleArray(_smartSearchDisplayPool);
            }

            const batch = _smartSearchDisplayPool.slice(
                _smartSearchPage * SMART_BATCH_SIZE,
                (_smartSearchPage + 1) * SMART_BATCH_SIZE
            );

            if (batch.length > 0) {
                renderSmartSearchResults(batch);
            } else {
                document.getElementById('smartSearchResults').innerHTML =
                    '<div class="loading">没有更多推荐了，请尝试其他关键词</div>';
                _smartSearchPage = 0;
            }
        }

        // 数组随机打乱（Fisher-Yates）
        function shuffleArray(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        // ========== 排重工具函数 ==========

        // 文本归一化：统一小写、合并多余空格、全半角转换
        function normalizeWord(w) {
            let s = String(w || '').trim().replace(/\s+/g, ' ');
            // 全角字母数字转半角
            s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
                String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
            );
            // 全角符号转半角（常见）
            s = s.replace(/[！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～]/g, ch =>
                String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
            );
            return s.toLowerCase();
        }

        // 编辑距离（Levenshtein），用于模糊去重
        function levenshteinDistance(a, b) {
            const m = a.length, n = b.length;
            if (m === 0) return n;
            if (n === 0) return m;
            // 用单行数组节省内存
            let prev = new Array(n + 1);
            let curr = new Array(n + 1);
            for (let j = 0; j <= n; j++) prev[j] = j;
            for (let i = 1; i <= m; i++) {
                curr[0] = i;
                for (let j = 1; j <= n; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    curr[j] = Math.min(
                        prev[j] + 1,       // 删除
                        curr[j - 1] + 1,   // 插入
                        prev[j - 1] + cost // 替换
                    );
                }
                [prev, curr] = [curr, prev];
            }
            return prev[n];
        }

        // 分层排重：归一化去重 + 排除已有 + 可选模糊去重
        // 返回 { displayPool: 原始展示形式数组, normalizedSet: 已用归一化key的Set }
        function deduplicateCandidates(rawCandidates, existingSet, options = {}) {
            const { fuzzyThreshold = 1, minLen = 1, maxLen = 20 } = options;
            const normMap = new Map();   // normalizedKey -> 原始展示形式（优先保留较短的）
            const result = [];

            for (const raw of rawCandidates) {
                const w = String(raw || '').trim();
                if (w.length < minLen || w.length > maxLen) continue;

                const normKey = normalizeWord(w);
                // 排除已有词汇（归一化比对）
                if (existingSet.has(normKey)) continue;
                // 内部去重：同一归一化key只保留第一个（较短的优先）
                if (normMap.has(normKey)) {
                    const existing = normMap.get(normKey);
                    if (w.length < existing.length) {
                        normMap.set(normKey, w);
                    }
                    continue;
                }
                normMap.set(normKey, w);
                result.push(w);
            }

            // 模糊去重：编辑距离 <= fuzzyThreshold 的只保留一个
            if (fuzzyThreshold > 0 && result.length > 1) {
                const fuzzyFiltered = [];
                const usedNormKeys = new Set();
                for (let i = 0; i < result.length; i++) {
                    const normI = normalizeWord(result[i]);
                    if (usedNormKeys.has(normI)) continue;
                    let isDuplicate = false;
                    for (let j = 0; j < fuzzyFiltered.length; j++) {
                        const normJ = normalizeWord(fuzzyFiltered[j]);
                        if (levenshteinDistance(normI, normJ) <= fuzzyThreshold) {
                            isDuplicate = true;
                            break;
                        }
                    }
                    if (!isDuplicate) {
                        fuzzyFiltered.push(result[i]);
                        usedNormKeys.add(normI);
                    }
                }
                return fuzzyFiltered;
            }

            return result;
        }

        function renderSmartSearchResults(words) {
            const resultsContainer = document.getElementById('smartSearchResults');
            const aiWords = new Set((window._smartSearchAIWords || []).map(normalizeWord));
            const presetWords = new Set((window._smartSearchPresetWords || []).map(normalizeWord));

            // 分类词汇来源
            const aiGroup = [];
            const presetGroup = [];
            const otherGroup = [];

            words.forEach(word => {
                const nk = normalizeWord(word);
                if (aiWords.has(nk)) {
                    aiGroup.push(word);
                } else if (presetWords.has(nk)) {
                    presetGroup.push(word);
                } else {
                    otherGroup.push(word);
                }
            });

            let html = '';

            if (aiGroup.length > 0) {
                html += '<div class="smart-source-group-label">🤖 AI 推荐</div>';
                html += aiGroup.map(word =>
                    `<span class="smart-word-chip ai-source" onclick="toggleSmartWord(this, \`${escapeAttr(word)}\`)" data-word="${escapeHtml(word)}">${escapeHtml(word)}</span>`
                ).join('');
            }

            if (presetGroup.length > 0) {
                html += '<div class="smart-source-group-label">📚 内置词库</div>';
                html += presetGroup.map(word =>
                    `<span class="smart-word-chip preset-source" onclick="toggleSmartWord(this, \`${escapeAttr(word)}\`)" data-word="${escapeHtml(word)}">${escapeHtml(word)}</span>`
                ).join('');
            }

            if (otherGroup.length > 0) {
                html += '<div class="smart-source-group-label">💡 更多推荐</div>';
                html += otherGroup.map(word =>
                    `<span class="smart-word-chip" onclick="toggleSmartWord(this, \`${escapeAttr(word)}\`)" data-word="${escapeHtml(word)}">${escapeHtml(word)}</span>`
                ).join('');
            }

            resultsContainer.innerHTML = html;

            // 恢复已选状态
            resultsContainer.querySelectorAll('.smart-word-chip').forEach(chip => {
                const word = chip.getAttribute('data-word');
                if (smartSearchSelectedWords.has(word)) {
                    chip.classList.add('checked');
                }
            });
        }

        function mergeAndDedupe(sources, maxCount) {
            const allWords = new Set();
            for (const source of sources) {
                for (const word of source) {
                    if (typeof word === 'string' && word.trim().length >= 1 && word.trim().length <= 20) {
                        allWords.add(word.trim());
                    }
                    if (allWords.size >= maxCount) break;
                }
                if (allWords.size >= maxCount) break;
            }
            return Array.from(allWords).slice(0, maxCount);
        }

        async function fetchOnlineWords(keyword) {
            const words = [];
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const resp = await fetch(
                    `https://api.duckduckgo.com/?q=${encodeURIComponent(keyword + ' 相关词汇 电商广告设计')}&format=json&no_html=1`,
                    { signal: controller.signal }
                );
                clearTimeout(timeoutId);
                if (resp.ok) {
                    const data = await resp.json();
                    const relatedTopics = (data.RelatedTopics || [])
                        .filter(t => t.Text)
                        .map(t => {
                            const text = t.Text.split(' - ')[0].trim();
                            return text.length <= 15 ? text : text.slice(0, 15);
                        })
                        .filter(t => t.length >= 1);
                    words.push(...relatedTopics);
                }
            } catch (e) { /* 忽略 */ }
            return [...new Set(words)];
        }

        // ==================== AI 智能推荐引擎 ====================
        // 使用 Groq API（免费 tier，速度极快）对分类语义进行理解并生成精准推荐词
        // 降级策略：Groq 不可用时 → 回退到预设词库 + 基础生成词

        function getAIConfig() {
            return loadData(STORAGE_KEYS.AI_CONFIG, {
                provider: 'groq',          // 'groq' | 'none'
                apiKey: '',                // Groq API Key（免费注册获取）
                model: 'llama-3.3-70b-versatile',
                enabled: true
            });
        }

        function saveAIConfig(config) {
            saveData(STORAGE_KEYS.AI_CONFIG, config);
        }

        // 构建 AI 推荐 prompt：根据分类语义精准理解并生成相关词汇
        function buildAIRecommendPrompt(categoryName, categoryWords, formulaCategories) {
            // 获取该分类的系统默认词作为参考样本
            const sampleWords = (SYSTEM_THESAURUS_DEFAULTS[categoryName] || []).slice(0, 10);
            const sampleStr = sampleWords.length > 0
                ? `参考示例：${sampleWords.join('、')}`
                : '';

            // 关联分类上下文（同一公式中的其他分类，帮助理解场景）
            const contextCategories = formulaCategories
                ? Array.from(formulaCategories).filter(c => c !== categoryName)
                : [];
            const contextStr = contextCategories.length > 0
                ? `该分类用于电商广告设计提示词中，关联的分类有：${contextCategories.join('、')}。`
                : '该分类用于电商广告设计提示词中。';

            return `你是电商广告设计提示词专家。

任务：为分类「${categoryName}」生成精准的相关词汇推荐。

${contextStr}
${sampleStr}

要求：
1. 深入理解「${categoryName}」在电商广告设计中的语义含义，生成符合该分类场景的专业词汇
2. 每个词汇2-8个字，简洁有力，风格统一
3. 覆盖不同维度（如背景分类覆盖材质、场景、风格、氛围等维度）
4. 只输出词汇，每行一个，不要编号、不要解释、不要任何额外文字
5. 输出15-20个词汇
6. 词汇之间不要重复、不要过于相似`;
        }

        // 调用 Groq API 获取 AI 推荐词
        async function fetchAIRecommendations(categoryName, categoryWords, formulaCategories) {
            const config = getAIConfig();
            if (!config.enabled || !config.apiKey) return [];

            const prompt = buildAIRecommendPrompt(categoryName, categoryWords, formulaCategories);

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 12000);

                const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.apiKey}`
                    },
                    body: JSON.stringify({
                        model: config.model,
                        messages: [
                            { role: 'system', content: '你是一个专业的电商广告设计提示词助手，只输出词汇，不做任何解释。' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.8,
                        max_tokens: 500
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!resp.ok) {
                    const errText = await resp.text();
                    console.warn('[AI推荐] Groq API 返回错误:', resp.status, errText);
                    return [];
                }

                const data = await resp.json();
                const content = data.choices?.[0]?.message?.content || '';

                // 解析返回的词汇：每行一个，过滤空行和过短/过长的词
                const words = content
                    .split('\n')
                    .map(line => line.replace(/^[\d\.\-\s、，]+/, '').trim()) // 去掉可能的编号
                    .filter(w => w.length >= 2 && w.length <= 15)
                    .slice(0, 25);

                console.log('[AI推荐] 成功获取', words.length, '个推荐词:', words.slice(0, 5), '...');
                return words;
            } catch (e) {
                if (e.name === 'AbortError') {
                    console.warn('[AI推荐] 请求超时');
                } else {
                    console.warn('[AI推荐] 调用失败:', e.message);
                }
                return [];
            }
        }

        // === AI 配置 UI 交互 ===
        function initAIConfigUI() {
            const config = getAIConfig();
            const providerSelect = document.getElementById('aiProviderSelect');
            const apiKeyInput = document.getElementById('aiApiKey');
            const groqConfig = document.getElementById('aiGroqConfig');
            const statusHint = document.getElementById('aiStatusHint');

            if (providerSelect) providerSelect.value = config.provider || 'groq';
            if (apiKeyInput) apiKeyInput.value = config.apiKey || '';

            // 根据是否有 API Key 显示状态
            if (statusHint) {
                if (config.apiKey) {
                    statusHint.innerHTML = '<span style="color:#34d399;">✅ AI 推荐已就绪（Groq 免费 API）</span>';
                } else {
                    statusHint.innerHTML = '<a href="https://console.groq.com/keys" target="_blank" style="color:#818cf8;">🔑 获取免费 API Key →</a> 未配置则使用内置词库';
                }
            }

            // 处理 Groq 配置区域显示
            if (config.provider === 'none') {
                if (groqConfig) groqConfig.style.display = 'none';
            } else {
                if (groqConfig) groqConfig.style.display = 'flex';
            }
        }

        function toggleAIConfig() {
            const panel = document.getElementById('smartSearchAIConfig');
            if (panel) {
                const isVisible = panel.style.display !== 'none';
                panel.style.display = isVisible ? 'none' : 'block';
                if (!isVisible) initAIConfigUI();
            }
        }

        function handleAIProviderChange() {
            const provider = document.getElementById('aiProviderSelect').value;
            const config = getAIConfig();
            config.provider = provider;
            if (provider === 'none') config.enabled = false;
            else config.enabled = true;
            saveAIConfig(config);
            initAIConfigUI();
        }

        function saveAIKey() {
            const apiKey = document.getElementById('aiApiKey').value.trim();
            const config = getAIConfig();
            config.apiKey = apiKey;
            config.enabled = !!apiKey;
            saveAIConfig(config);
            initAIConfigUI();
            if (apiKey) {
                showToast('AI API Key 已保存，智能推荐将使用 AI 引擎', 'success');
            } else {
                showToast('API Key 已清除，将使用内置词库推荐', 'warning');
            }
        }

        function getPresetWordsByCategory(keyword) {
            const kw = keyword.toLowerCase().replace(/\s+/g, '');
            const presets = {
                '角色': ['都市白领', '精英律师', '时尚博主', '健身达人', '文艺青年', '职场新人', '甜酷少女', '潮流先锋', '运动健将', '美食家', '旅行者', '设计师', '艺术家', '模特', '明星', '网红', '学生', '职场精英', '商务人士', '创业者', '宝妈', '辣妈', '奶爸', '二次元', '国风少年'],
                '风格': ['极简主义', '复古风', '赛博朋克', '蒸汽波', '孟菲斯', '波普艺术', '包豪斯', '新中式', '日系清新', '韩系简约', '欧美大气', '国潮', '轻奢', '北欧风', '工业风', '波西米亚', '文艺清新', '街头潮牌', '高定感', '科技感', '未来感', '自然原生态', 'ins风', '小红书风', '莫兰迪色系'],
                '场景': ['都市街景', '咖啡馆', '图书馆', '海滩', '雪山', '森林', '沙漠', '花海', '天台', '地铁站', '机场', '酒店大堂', '健身房', '办公室', '居家客厅', '庭院', '古镇', '摩天大楼', '霓虹街道', '美术馆', '音乐会', '泳池边', '花园', '露台', '阁楼'],
                '色彩': ['莫兰迪灰', '克莱因蓝', '爱马仕橙', '蒂芙尼蓝', '芭比粉', '薄荷绿', '香槟金', '玫瑰金', '雾霾蓝', '焦糖色', '奶咖色', '勃艮第红', '牛油果绿', '薰衣草紫', '珊瑚橘', '经典黑白', '高级灰', '奶茶色', '星空蓝', '森林绿', '落日橙', '樱花粉', '深空黑', '月光银', '象牙白'],
                '光影': ['自然光', '逆光', '侧光', '柔光', '硬光', '蝴蝶光', '伦勃朗光', '环形光', '分割光', '顺光', '晨光', '暮光', '黄金时刻', '蓝调时刻', '霓虹光', '烛光', '窗光', '顶光', '底光', '漫射光', '聚光', '散射光', '轮廓光', '眼神光', '氛围光'],
                '构图': ['中心构图', '三分法', '对角线', '框架式', '引导线', '对称式', '黄金分割', '留白', '特写', '俯拍', '仰拍', '平视', '鱼眼', '广角', '长焦', '微距', '全景', '中景', '近景', '极简构图', '动态构图', '倾斜构图', '鸟瞰', '低角度', '双人互动'],
                '质感': ['丝绸', '棉麻', '皮革', '金属', '玻璃', '陶瓷', '木质', '大理石', '亚克力', '磨砂', '亮面', '哑光', '绒面', '网纱', '蕾丝', '针织', '毛呢', '缎面', '雪纺', '牛仔', '漆皮', '植绒', '水洗', '拉丝', '镜面'],
                '画质': ['8K超清', 'RAW格式', 'HDR', '电影级调色', '高饱和度', '低饱和度', '柔焦', '锐利', '颗粒感', '胶片质感', '宝丽来', '拍立得', '老照片', '褪色', '高对比度', '低对比度', '过曝', '欠曝', '正常曝光', '电影画幅', '16:9', '4:3', '方形', '竖屏', '全景'],
                '广告背景': ['纯色背景', '渐变背景', '场景化背景', '抽象几何', '光影背景', '纹理背景', '模糊背景', '留白背景', '品牌色背景', '自然景观', '城市天际线', '室内空间', '虚拟空间', '产品使用场景', '生活方式场景', '节日氛围', '季节主题', '科技感背景', '艺术化背景', '简约工作室'],
                '广告氛围': ['高端大气', '温馨治愈', '活力四射', '静谧优雅', '潮流前卫', '甜美可爱', '酷感十足', '清新自然', '奢华尊贵', '文艺复古', '科技未来', '浪漫梦幻', '简约干净', '热闹促销', '节日喜庆', '专业严谨', '轻松休闲', '运动活力', '性感魅惑', '知性优雅'],
                '主要内容': ['人物模特', '产品特写', '场景展示', '文字标题', '品牌Logo', '促销标签', '产品组合', '使用效果', '对比展示', '开箱体验', '搭配推荐', '明星代言', '素人体验', '场景模拟', '动画效果', '实物拍摄', '3D渲染', '插画风格', '手绘风格', '素材拼贴'],
                '展示状态': ['静态展示', '动态抓拍', '悬浮效果', '透视效果', '爆炸分解', '旋转展示', '360°全景', '特写放大', '远近对比', '前后对比', '使用中', '穿戴中', '手持展示', '平铺展示', '悬挂展示', '堆叠效果', '散落效果', '排列组合', '透视网格', '剖面展示'],
                '广告标题': ['限时特惠', '新品首发', '爆款返场', '明星同款', '人手必备', '品质之选', '年度必入', '口碑推荐', '买一送一', '满减优惠', '会员专享', '独家定制', '全球首发', '限量发售', '清仓特卖', '节日献礼', '送礼首选', '自用推荐', '性价比之王', '好评如潮'],
                '促销文案': ['全场5折起', '满300减50', '前100名半价', '买2送1', '领券立减', '加1元换购', '第二件0元', '下单即赠', '包邮到家', '7天无理由', '正品保证', '急速发货', '售后无忧', '30天价保', '以旧换新', '免费试用', '不满意包退', '终身质保', '限时秒杀', '拼团更优惠'],
                '后期': ['色彩校正', '皮肤精修', '背景虚化', '添加阴影', '高光增强', '对比度调整', '饱和度微调', '锐化处理', '噪点去除', '裁剪优化', '透视矫正', '去除瑕疵', '光影重塑', '色调统一', '添加滤镜', 'HDR合成', '景深合成', '焦点堆栈', '液化微调', '细节增强'],
                '负面提示词': ['模糊', '失真', '变形', '噪点', '过曝', '欠曝', '偏色', '伪影', '锯齿', '马赛克', '水印', '文字', 'Logo', '低分辨率', '压缩痕迹', '色块', '摩尔纹', '紫边', '暗角', '鬼影', '手指畸形', '多余肢体', '不自然姿势', '表情僵硬', '杂乱背景'],
            };

            // 精确匹配
            if (presets[kw]) return presets[kw];

            // 模糊匹配
            for (const [key, words] of Object.entries(presets)) {
                if (kw.includes(key) || key.includes(kw)) {
                    return words;
                }
            }

            return [];
        }

        function generateRelatedWords(keyword) {
            const kw = keyword.replace(/[广告电商]/g, '');
            const prefixes = ['经典', '现代', '高端', '简约', '创意', '时尚', '个性', '专业', '精致', '轻奢'];
            const suffixes = ['版', '式', '型', '感', '系', '风', '派', '范', '款', '级'];
            const words = [];

            // 前缀 + 关键词
            for (const p of prefixes) {
                const w = p + kw;
                if (w.length <= 15) words.push(w);
            }

            // 关键词 + 后缀
            for (const s of suffixes) {
                const w = kw + s;
                if (w.length <= 15) words.push(w);
            }

            return [...new Set(words)];
        }

        function generateBasicWords(keyword) {
            const baseWords = [
                `经典${keyword}`, `现代${keyword}`, `${keyword}风格`, `简约${keyword}`,
                `${keyword}设计`, `创意${keyword}`, `高端${keyword}`, `时尚${keyword}`,
                `个性${keyword}`, `${keyword}元素`, `专业${keyword}`, `轻奢${keyword}`,
                `自然${keyword}`, `艺术${keyword}`, `复古${keyword}`, `未来${keyword}`,
                `动感${keyword}`, `优雅${keyword}`, `清新${keyword}`, `暗黑${keyword}`
            ];
            return baseWords.filter(w => w.length <= 20);
        }

        function toggleSmartWord(chip, word) {
            if (smartSearchSelectedWords.has(word)) {
                smartSearchSelectedWords.delete(word);
                chip.classList.remove('checked');
            } else {
                smartSearchSelectedWords.add(word);
                chip.classList.add('checked');
            }
            updateSelectionCount();
        }

        // 全选/清空当前页
        function toggleAllSmartWords(select) {
            const resultsContainer = document.getElementById('smartSearchResults');
            const chips = resultsContainer.querySelectorAll('.smart-word-chip');
            chips.forEach(chip => {
                const word = chip.getAttribute('data-word');
                if (select) {
                    smartSearchSelectedWords.add(word);
                    chip.classList.add('checked');
                } else {
                    smartSearchSelectedWords.delete(word);
                    chip.classList.remove('checked');
                }
            });
            updateSelectionCount();
        }

        function addSmartSearchWords() {
            if (smartSearchSelectedWords.size === 0) {
                showToast('请先选择词汇', 'warning');
                return;
            }

            const thesaurus = getThesaurus();
            const category = thesaurus.find(c => c.id === smartSearchTargetCategoryId);
            if (!category) {
                showToast('分类不存在', 'error');
                return;
            }

            // 构建已有词汇文本集合（兼容字符串和对象格式）
            const existingTexts = new Set(category.words.map(w => getWordText(w)));

            let addedCount = 0;
            let skippedCount = 0;
            smartSearchSelectedWords.forEach(word => {
                if (existingTexts.has(word)) {
                    skippedCount++;
                } else {
                    category.words.push(word);
                    existingTexts.add(word);
                    addedCount++;
                }
            });

            if (addedCount === 0) {
                showToast(skippedCount > 0 ? '所选词汇已全部存在' : '没有可添加的词汇', 'warning');
                return;
            }

            saveThesaurus(thesaurus);
            renderCategories();
            closeSmartSearchModal();

            let msg = `成功添加 ${addedCount} 个词汇`;
            if (skippedCount > 0) msg += `，${skippedCount} 个已存在`;
            showToast(msg, 'success');
        }

        function saveWord() {
            const categoryId = document.getElementById('wordCategory').value;
            const singleWord = document.getElementById('newWord').value.trim();
            const childrenText = document.getElementById('wordChildren').value.trim();
            const batchText = document.getElementById('batchWords').value.trim();

            if (!categoryId) {
                showToast('请选择分类', 'error');
                return;
            }

            // 解析子词汇
            let childrenList = [];
            if (childrenText) {
                childrenList = parseBatchWords(childrenText, 'auto')
                    .map(w => w.trim())
                    .filter(w => w.length > 0);
            }

            // 收集所有待添加的词
            let wordsToAdd = [];

            // 单个词汇（可能带子词汇）
            if (singleWord) {
                if (childrenList.length > 0) {
                    // 分层词对象
                    wordsToAdd.push({ text: singleWord, children: childrenList });
                } else {
                    wordsToAdd.push(singleWord);
                }
            }

            // 批量词汇（不支持子词汇）
            if (batchText) {
                const sepMode = document.querySelector('input[name="batchSep"]:checked')?.value || 'auto';
                const batchWords = parseBatchWords(batchText, sepMode);
                wordsToAdd = wordsToAdd.concat(batchWords);
            }

            if (wordsToAdd.length === 0) {
                showToast('请输入词汇', 'error');
                return;
            }

            const thesaurus = getThesaurus();
            const category = thesaurus.find(c => c.id === categoryId);

            if (!category) {
                showToast('分类不存在', 'error');
                return;
            }

            // 构建已有词汇的文本集合（用于去重）
            const existingTexts = new Set(category.words.map(w => getWordText(w)));

            let addedCount = 0;
            let skippedCount = 0;

            wordsToAdd.forEach(word => {
                const text = getWordText(word);
                if (!text) return;
                if (existingTexts.has(text)) {
                    skippedCount++;
                } else {
                    category.words.push(word);
                    existingTexts.add(text);
                    addedCount++;
                }
            });

            if (addedCount === 0) {
                showToast(skippedCount > 0 ? `${skippedCount}个词汇已存在` : '没有可添加的词汇', 'warning');
                return;
            }

            saveThesaurus(thesaurus);
            renderCategories();
            closeAddWordModal();

            let msg = `成功添加 ${addedCount} 个词汇`;
            if (skippedCount > 0) msg += `，${skippedCount} 个已存在`;
            showToast(msg, 'success');
        }

        // 解析批量词汇文本
        function parseBatchWords(text, sepMode) {
            if (!text) return [];

            let words = [];

            if (sepMode === 'auto') {
                // 自动识别：检测主要分隔符
                const hasLineBreak = text.includes('\n');
                const hasComma = /[,，、]/.test(text);
                const hasPipe = text.includes('|');

                if (hasLineBreak) {
                    // 按行拆分，每行内再用逗号/顿号拆分
                    text.split('\n').forEach(line => {
                        const trimmed = line.trim();
                        if (trimmed) {
                            if (/[,，、|]/.test(trimmed)) {
                                words.push(...trimmed.split(/[,，、|]+/).map(w => w.trim()).filter(Boolean));
                            } else {
                                words.push(trimmed);
                            }
                        }
                    });
                } else if (hasPipe) {
                    words = text.split('|').map(w => w.trim()).filter(Boolean);
                } else if (hasComma) {
                    words = text.split(/[,，、]+/).map(w => w.trim()).filter(Boolean);
                } else {
                    words = [text.trim()];
                }
            } else if (sepMode === 'comma') {
                words = text.split(/[,，、]+/).map(w => w.trim()).filter(Boolean);
            } else if (sepMode === 'pipe') {
                words = text.split('|').map(w => w.trim()).filter(Boolean);
            } else if (sepMode === 'line') {
                words = text.split('\n').map(w => w.trim()).filter(Boolean);
            }

            return [...new Set(words)]; // 去重
        }

        function updateBatchHint() {
            const sepMode = document.querySelector('input[name="batchSep"]:checked')?.value || 'auto';
            const batchText = document.getElementById('batchWords').value.trim();
            const hint = document.getElementById('batchHint');
            if (!batchText) {
                hint.textContent = sepMode === 'auto' ? '自动识别逗号、顿号、竖线、换行等分隔符' : '';
                return;
            }
            const words = parseBatchWords(batchText, sepMode);
            hint.textContent = `将识别 ${words.length} 个词汇：${words.slice(0, 8).join('、')}${words.length > 8 ? '…' : ''}`;
        }

        function deleteWord(categoryId, word) {
            const thesaurus = getThesaurus();
            const category = thesaurus.find(c => c.id === categoryId);

            if (category) {
                // 支持删除分层词对象和普通字符串
                category.words = category.words.filter(w => {
                    if (typeof w === 'string') return w !== word;
                    if (isWordObject(w)) return getWordText(w) !== word;
                    return true;
                });
                saveThesaurus(thesaurus);
                renderCategories();
                showToast('词汇已删除', 'success');
            }
        }

        // 删除分层词的子词汇
        function deleteWordChild(categoryId, parentText, childText) {
            const thesaurus = getThesaurus();
            const category = thesaurus.find(c => c.id === categoryId);
            if (!category) return;

            for (const w of category.words) {
                if (isWordObject(w) && getWordText(w) === parentText) {
                    w.children = (w.children || []).filter(c => c !== childText);
                    // 如果子词汇被清空了，转换为普通字符串
                    if (w.children.length === 0) {
                        const idx = category.words.indexOf(w);
                        category.words[idx] = parentText;
                    }
                    break;
                }
            }
            saveThesaurus(thesaurus);
            renderCategories();
            showToast('子词汇已删除', 'success');
        }

        // 展开/收起分层词的子词汇面板
        function toggleWordChildren(arrowEl) {
            const parentTag = arrowEl.closest('.word-tag');
            const panel = parentTag.nextElementSibling;
            if (panel && panel.classList.contains('word-children-panel')) {
                const isVisible = panel.classList.contains('visible');
                if (isVisible) {
                    panel.classList.remove('visible');
                    arrowEl.classList.remove('expanded');
                } else {
                    panel.classList.add('visible');
                    arrowEl.classList.add('expanded');
                }
            }
        }

        // 将当前分类的词库保存为自定义默认值
        function saveCategoryAsDefault(categoryId) {
            const thesaurus = getThesaurus();
            const category = thesaurus.find(c => c.id === categoryId);
            if (!category) {
                showToast('分类不存在', 'error');
                return;
            }
            if (category.words.length === 0) {
                showToast('词库为空，无法设为默认', 'warning');
                return;
            }

            const defaults = getThesaurusDefaults();
            defaults[category.name] = [...category.words];
            saveThesaurusDefaults(defaults);
            renderCategories();
            showToast(`「${category.name}」已设为默认（${category.words.length}个词）`, 'success');
        }

        // 将单个分类恢复到其默认值（自定义默认优先，回退系统默认）
        function resetSingleCategoryToDefault(categoryId) {
            const thesaurus = getThesaurus();
            const category = thesaurus.find(c => c.id === categoryId);
            if (!category) {
                showToast('分类不存在', 'error');
                return;
            }

            const defaultWords = getCategoryDefaultWords(category.name);
            if (defaultWords.length === 0) {
                showToast(`「${category.name}」暂无默认数据`, 'warning');
                return;
            }

            const customDefaults = getThesaurusDefaults();
            const isCustom = customDefaults[category.name] && customDefaults[category.name].length > 0;
            const source = isCustom ? '自定义默认值' : '系统默认值';

            category.words = [...defaultWords];
            saveThesaurus(thesaurus);
            renderCategories();
            showToast(`「${category.name}」已恢复（${source}，${defaultWords.length}个词）`, 'success');
        }

        // ==================== Workspace ====================
        function parseVariables(template) {
            // 支持两种格式：{{分类:字段}} 和 {{分类}}
            const regex = /\{\{([^:}]+)(?::([^}]+))?\}\}/g;
            const variables = [];
            let match;

            while ((match = regex.exec(template)) !== null) {
                variables.push({
                    category: match[1],
                    field: match[2] || match[1]
                });
            }

            return variables;
        }

        // 通用复制函数（Clipboard API + execCommand 双保险）
        function copyText(text, successMsg = '已复制到剪贴板', fallbackElem = null) {
            if (!text) { showToast('没有内容可复制', 'warning'); return; }

            const doExecCopy = () => {
                // 尝试用传入的 fallbackElem
                if (fallbackElem && fallbackElem.tagName === 'TEXTAREA') {
                    try {
                        // 如果是 readonly 的 textarea，临时去掉 readonly
                        const wasReadOnly = fallbackElem.readOnly;
                        if (wasReadOnly) fallbackElem.readOnly = false;
                        fallbackElem.focus();
                        fallbackElem.select();
                        document.execCommand('copy');
                        if (wasReadOnly) fallbackElem.readOnly = true;
                        showToast(successMsg, 'success');
                        return true;
                    } catch (e) {}
                }
                // 创建临时 textarea 作为终极 fallback
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.left = '0';
                    ta.style.top = '0';
                    ta.style.opacity = '0';
                    ta.style.pointerEvents = 'none';
                    ta.style.width = '1px';
                    ta.style.height = '1px';
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    showToast(successMsg, 'success');
                    return true;
                } catch (e) {
                    return false;
                }
            };

            // 优先尝试 Clipboard API
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(text).then(() => {
                    showToast(successMsg, 'success');
                }).catch(() => {
                    if (!doExecCopy()) {
                        showToast('复制失败，请手动复制', 'error');
                    }
                });
            } else {
                // 没有 Clipboard API，直接用 execCommand
                if (!doExecCopy()) {
                    showToast('复制失败，请手动复制', 'error');
                }
            }
        }

        function copyResult() {
            const textarea = document.getElementById('resultTextarea');
            copyText(textarea.value, '已复制到剪贴板', textarea);
        }

        // ==================== Model Optimization ====================
        // ---- 通用优化工具 ----
        const OPT_UTILS = {
            // 关键词分类词典：用于识别提示词各部分的语义类别（覆盖全部15个词库分类）
            CLASSIFIER: {
                // 背景/场景（对应：广告背景、场景）
                scene: ['纯白极简背景', '渐变色彩背景', '大理石纹理台面', '镜面反射展台',
                    '丝绸布料衬底', '自然光影窗台', '霓虹灯城市夜景', '水波纹动态背景',
                    '金色奢华幕布', '粉色梦幻空间', '水泥工业风墙面', '热带植物丛林',
                    '沙滩海岸线', '雪山冰川背景', '赛博朋克都市', '古典欧式宫殿',
                    '日式禅意庭院', '科技感数字空间', '深色产品棚拍背景', '糖果色几何背景',
                    '专业摄影棚', '极简白空间', '豪华酒店套房', '户外花园', '城市街头',
                    '海边沙滩', '雪地场景', '森林深处', '咖啡厅一角', '卧室梳妆台',
                    '浴室水流中', '办公桌面', '健身房', '厨房台面', '美术馆展厅',
                    '飞机头等舱', '游艇甲板', '落日天台', '荧光派对', '直播间背景',
                    '背景', '场景', '展台', '衬底'],
                // 氛围/基调（对应：广告氛围）
                atmosphere: ['轻奢高级感', '清新自然感', '科技未来感', '温馨治愈感',
                    '青春活力感', '奢华典雅感', '冷酷工业感', '甜美梦幻感', '复古怀旧感',
                    '运动能量感', '神秘诱惑感', '纯净透明感', '热闹狂欢感', '简约冷淡感',
                    '温暖舒适感', '优雅知性感', '潮流街头感', '艺术殿堂感', '浪漫情人节',
                    '春节喜庆氛围', '电商促销感', '促销氛围', '大促气氛', '购物节氛围',
                    '氛围', '高级感', '自然感', '治愈感', '活力感', '促销感', '促销'],
                // 主体/内容（对应：主要内容）
                subject: ['化妆品套装', '护肤品礼盒', '香水瓶', '手表', '运动鞋', '连衣裙',
                    '珠宝首饰', '数码产品', '家居用品', '食品饮料', '母婴产品', '箱包皮具',
                    '美妆工具', '健康保健品', '宠物用品', '文创礼品', '季节限定品', '联名款产品',
                    '年轻女性', '时尚模特', '自然风光', '城市建筑', '静物特写', '宠物动物',
                    '冰镇饮料', '产品', '套装', '礼盒', '女性', '男性', '模特', '人像'],
                // 展示状态/动作（对应：展示状态）
                display: ['产品悬浮展示', '模特手持产品', '产品45度展示', '产品拆解爆炸图',
                    '微距特写细节', '产品组合阵列', '动态飞溅效果', '产品切开截面',
                    '光影穿过产品', '水面倒影展示', '产品旋转动感', '层叠排列造型',
                    '产品与自然元素融合', '产品悬浮于光晕中', '镜面多重反射',
                    '产品结冰或燃烧特效', '半透明透视展示', '产品与几何图形互动',
                    '悬浮', '展示', '特写', '阵列', '动态'],
                // 广告标题（对应：广告标题）
                headline: ['新品尝鲜', '限时特惠', '爆款返场', '明星同款', '人手必备',
                    '品质之选', '匠心之作', '解锁美丽', '焕新升级', '年度重磅', '王炸单品',
                    '必buy清单', '高阶玩家', '一步到位', '颜值担当', '实力派', '闭眼入',
                    '不买后悔'],
                // 促销文案（对应：促销文案）
                promo: ['全场5折起', '买一送一', '第2件0元', '满300减50', '新人专享价',
                    '限时24小时', '前100名半价', '领券立减100', '加购送赠品', '第二件半价',
                    '每日秒杀', '拼团更优惠', '会员专享折扣', '清仓一口价', '首单包邮',
                    '付定金翻倍', '下单抽免单', '集卡换好礼', '5折', '买一送一', '半价',
                    '包邮', '免单', '秒杀'],
                // 风格（对应：风格）
                style: ['极简主义', '轻奢质感风', '赛博朋克风', '复古胶片感', '孟菲斯风格',
                    '波普艺术', '日系小清新', '欧美时尚大片', '国潮新中式', '3D写实渲染',
                    '扁平化插画', '线描手绘风', '水彩晕染', '酸性设计', '弥散光感',
                    'Y2K千禧风', '蒸汽波', '包豪斯现代', '自然有机风', '波西米亚',
                    '韩系画报', '欧美时尚', '中式古风', 'ins风', '唯美浪漫', '冷酷高级',
                    '写实', '摄影', '胶片', '电影', '艺术', '风格', '主义', '画风'],
                // 色彩（对应：色彩）
                color: ['莫兰迪色系', '马卡龙色系', '高饱和撞色', '黑白极简', '金色奢华风',
                    '蒂芙尼蓝', '爱马仕橙', '克莱因蓝', '千禧粉', '荧光绿', '金属色渐变',
                    '紫蓝渐变', '温暖大地色', '清新薄荷绿', '经典红金配', '赛博霓虹灯色',
                    '奶油白', '高级灰', '深海蓝', '樱花粉', '暖色调', '冷色调', '黑白单色',
                    '高饱和', '低饱和', '大地色系', '霓虹色调', '色调', '色系', '色'],
                // 质感（对应：质感）
                texture: ['金属拉丝', '磨砂哑光', '亮面高光', '玻璃通透', '陶瓷釉面',
                    '皮革纹理', '丝绸柔滑', '珠光贝母', '液态流动', '冰晶透明', '天鹅绒',
                    '大理石纹', '木纹肌理', '钻石切割面', '水光镜面', '植绒柔雾', '珐琅彩',
                    '拉丝不锈钢', '液态金属', '碳纤维纹理', 'Kodak Portra', 'Kodak Gold',
                    'Fuji Pro', '胶片质感', 'RAW格式质感', '颗粒感', '纹理', '质感',
                    '磨砂', '哑光', '高光', '通透', '丝绸', '柔滑'],
                // 光影（对应：光影）
                lighting: ['柔光漫射', '硬光侧打', '逆光轮廓光', '顶光聚焦', '蝴蝶光',
                    '伦勃朗光', '环形光', '霓虹光晕', '自然窗光', '黄金时刻暖光',
                    '冷白棚拍光', '氛围灯带', '光斑散景效果', '电影级三点布光', '隧道光效',
                    '聚光灯舞台光', '左右夹光', '底光戏剧光', '柔光', '硬光', '逆光',
                    '顶光', '光晕', '三点布光', '舞台光', 'cinematic lighting'],
                // 构图（对应：构图）
                camera: ['居中对称构图', '三分法构图', '对角线构图', '引导线构图',
                    '框架式构图', '大面积留白', '俯拍鸟瞰视角', '仰拍仰视视角',
                    '微距特写', '45度产品视角', '平视标准视角', '散点分布构图',
                    'S形曲线构图', '三角形稳定构图', '前后景深层次', '镜面倒影构图',
                    '三分法', '中心构图', '对称构图', '引导线', '留白', '景深',
                    '构图', '视角', '广角', '长焦', '微距', '锐利对焦'],
                // 画质（对应：画质）
                quality: ['8K超高清', '电影级画质', 'HDR高动态范围', '超写实渲染',
                    'Octane渲染器', '虚幻引擎5', '光线追踪', '超细节纹理', '景深虚化效果',
                    '锐利焦点', '皮肤毛孔可见', '布料纹理清晰', '微距级细节', '商业级修图品质',
                    'C4D渲染', '照片级真实感', '高精度建模', '细腻毛发渲染',
                    '杰作', 'masterpiece', '超高画质', '超精细细节', 'best quality',
                    'high quality', '4k', '8k', 'hdr', '超高分辨率', '顶级画质',
                    '超写实', '极致清晰', '大师级作品', '商业级画质', '专业摄影级'],
                // 后期（对应：后期）
                post: ['高对比度', '低饱和度', '电影色调', '青橙色调', '赛博朋克调色',
                    '奶油暖色调', '暗角效果', '颗粒胶片感', '清新通透调色', '高级灰调',
                    '色彩分级', '柔光滤镜', '锐化增强', '暗部提亮', '高光压缩', '朦胧柔焦',
                    '黑白单色', '复古褪色', '对比度', '饱和度', '色调', '调色', '滤镜',
                    '暗角', '胶片感'],
                // 负面提示词
                negative: ['模糊', '变形', '扭曲', '多指', '缺指', '低画质', '水印',
                    '文字错误', '噪点', '压缩伪影', '过曝', '欠曝', '色彩偏移',
                    '不协调比例', '解剖结构错误', '杂乱背景', '重复物体', '怪异人脸',
                    '像素化', 'JPEG artifacts', '低分辨率纹理', '比例失衡',
                    '多余手指', '坏手', '丑陋', '畸形', '拼接痕迹', 'jpeg伪影',
                    '画质', '伪影', '怪']
            },

            // 将分词并分类（含智能兜底启发式）
            classifyToken(token) {
                const t = token.toLowerCase().trim();
                for (const [category, keywords] of Object.entries(this.CLASSIFIER)) {
                    for (const kw of keywords) {
                        if (t.includes(kw.toLowerCase())) {
                            // 二次修正：含"超细节"、"细节纹理"等画质特征，优先归为 quality
                            if (category === 'texture' && (t.includes('超细节') || t.includes('细节纹理') || t.includes('超精细') || t.includes('超高清'))) {
                                return 'quality';
                            }
                            return category;
                        }
                    }
                }
                // 兜底启发式：根据关键词特征智能归类
                if (t.includes('背景') || t.includes('台面') || t.includes('衬底') || t.includes('场景') || t.includes('空间') || t.includes('地点') || t.includes('环境')) return 'scene';
                if (t.includes('氛围') || t.includes('促销感') || t.includes('大促') || (t.includes('感') && (t.includes('高级') || t.includes('治愈') || t.includes('活力') || t.includes('清新') || t.includes('促销') || t.includes('奢') || t.includes('雅') || t.includes('暖') || t.includes('冷') || t.includes('甜') || t.includes('酷') || t.includes('幻')))) return 'atmosphere';
                if (t.includes('产品') || t.includes('套装') || t.includes('礼盒') || t.includes('化妆品') || t.includes('护肤品') || t.includes('数码') || t.includes('商品') || t.includes('香水') || t.includes('手表') || t.includes('珠宝') || t.includes('饮料') || t.includes('食品') || t.includes('鞋') || t.includes('衣服') || t.includes('裙子') || t.includes('包包') || t.includes('手机') || t.includes('电脑') || t.includes('家电') || t.includes('零食') || t.includes('玩具') || t.includes('家具') || t.includes('车') || t.includes('运动') || t.includes('水果') || t.includes('蔬菜') || t.includes('鲜花') || t.includes('蛋糕') || t.includes('甜品') || t.includes('咖啡') || t.includes('茶叶')) return 'subject';
                if (t.includes('展示') || t.includes('悬浮') || t.includes('飞溅') || t.includes('特写') || t.includes('阵列') || t.includes('旋转') || t.includes('倒影')) return 'display';
                if (t.includes('新品') || t.includes('限时') || t.includes('爆款') || t.includes('限量') || t.includes('首发') || t.includes('明星同款')) return 'headline';
                if (t.includes('折') || t.includes('买') || t.includes('送') || t.includes('减') || t.includes('免') || t.includes('秒杀') || t.includes('包邮') || t.includes('券') || t.includes('赠') || t.includes('满')) return 'promo';
                if (t.includes('构图') || t.includes('视角') || t.includes('景深') || t.includes('留白') || t.includes('对焦') || t.includes('广角') || t.includes('长焦') || t.includes('微距')) return 'camera';
                if (t.includes('光') && !t.includes('时光')) return 'lighting';
                if (t.includes('色') || t.includes('彩')) return 'color';
                // quality 优先于 texture：含画质特征的词即使含"纹理"也应归 quality
                if (t.includes('超细节') || t.includes('超精细') || t.includes('细节纹理') || t.includes('超高清')) return 'quality';
                if (t.includes('质感') || t.includes('纹理') || t.includes('磨砂') || t.includes('光滑') || t.includes('金属') || t.includes('玻璃') || t.includes('肌理')) return 'texture';
                if (t.includes('风格') || t.includes('主义') || (t.includes('风') && !t.includes('风扇'))) return 'style';
                if (t.includes('画质') || t.includes('分辨率') || t.includes('渲染') || t.includes('高清') || t.includes('超清') || t.includes('细节')) return 'quality';
                if (t.includes('对比度') || t.includes('饱和度') || t.includes('调色') || t.includes('滤镜') || t.includes('暗角') || (t.includes('色调') && !t.includes('色调色'))) return 'post';
                return 'other';
            },

            // 提取并分类所有关键词
            parseAndClassify(prompt) {
                // 提取排版和尺寸信息（保留原内容，不丢弃）
                const layoutInfo = {
                    layout: '',      // 【文字排版】内容
                    size: '',        // 尺寸：
                    ratio: '',       // 比例：
                    headlineText: '', // 原始标题格式化文本（如 标题："xxx"、"yyy"）
                    promoText: ''    // 原始副标题格式化文本（如 副标题："xxx"、"yyy"）
                };
                let workingPrompt = prompt;

                // 提取标题和副标题的格式化文本（保留引号格式，支持多引号如 "xx"、"yy"）
                // 策略：匹配 标题："..." 或 标题："..."、"..." 的完整格式
                // 支持英文引号 " ' 和中文弯引号 \u201C \u201D
                const Q = '["\'\\u201C\\u201D]';   // 引号字符类
                const NQ = '[^"\'\\u201C\\u201D]'; // 非引号字符类
                const extractQuotedItems = (prefix) => {
                    const regex = new RegExp(prefix + '[：:]\\s*' + Q + '(' + NQ + '+?)' + Q);
                    const match = workingPrompt.match(regex);
                    if (!match) return [];
                    const startIdx = match.index + match[0].length;
                    const items = [match[1]];
                    // 继续匹配后续的 、"xxx" 格式
                    let remaining = workingPrompt.substring(startIdx);
                    const continueRegex = new RegExp('^\\s*[,，、]\\s*' + Q + '(' + NQ + '+?)' + Q);
                    while (continueRegex.test(remaining)) {
                        const cm = remaining.match(continueRegex);
                        items.push(cm[1]);
                        remaining = remaining.substring(cm[0].length);
                    }
                    return items;
                };
                const headlineItems = extractQuotedItems('标题');
                if (headlineItems.length > 0) {
                    layoutInfo.headlineText = '标题："' + headlineItems.join('"、"') + '"';
                }
                const promoItems = extractQuotedItems('副标题');
                if (promoItems.length > 0) {
                    layoutInfo.promoText = '副标题："' + promoItems.join('"、"') + '"';
                }

                // 提取排版描述（新格式：自然语言融入，旧格式：兼容【文字排版】元标签）
                // 新格式：以排版关键词开头的中文描述（如"文字横幅排版，"、"海报式文字排版，"等）
                const layoutKeywords = ['文字横幅排版', '海报式文字排版', '角标式文字排版', '简约文字排版',
                    '竖排文字排版', '杂志封面式排版', '标签阵列式排版', '环绕式文字排版',
                    '粗体无衬线字体', '优雅衬线字体', '书法字体', '手写风格字体', '特粗黑体字', '纤细优雅字体',
                    '白色文字配', '黑色文字配', '金色渐变文字', '文字颜色跟随',
                    '文字带有描边', '文字带有投影', '文字带有外发光', '文字采用渐变', '文字带有浮雕',
                    '标题显示"', '促销信息"',
                    '文字排版'];
                // 匹配从排版关键词开始到尺寸/比例前或结尾的一段
                const layoutStart = layoutKeywords.find(kw => workingPrompt.includes(kw));
                if (layoutStart) {
                    const idx = workingPrompt.indexOf(layoutStart);
                    const layoutSection = workingPrompt.substring(idx);
                    const endMatch = layoutSection.match(/(?:\n\n尺寸：|\n尺寸：|\n\n比例：|\n比例：)/);
                    if (endMatch) {
                        layoutInfo.layout = layoutSection.substring(0, endMatch.index).trim();
                    } else {
                        layoutInfo.layout = layoutSection.trim();
                    }
                }
                // 兼容旧格式
                if (!layoutInfo.layout) {
                    const layoutMatch = workingPrompt.match(/【文字排版】([\s\S]*?)(?=\n\n尺寸：|\n尺寸：|\n\n比例：|\n比例：|$)/);
                    if (layoutMatch) {
                        layoutInfo.layout = layoutMatch[1].trim();
                    }
                }
                // 提取尺寸
                const sizeMatch = workingPrompt.match(/\n{0,2}尺寸：[^\n]+/);
                if (sizeMatch) {
                    layoutInfo.size = sizeMatch[0].replace(/^\n+/, '').replace(/^尺寸：/, '').trim();
                }
                // 提取比例
                const ratioMatch = workingPrompt.match(/\n{0,2}比例：[^\n]+/);
                if (ratioMatch) {
                    layoutInfo.ratio = ratioMatch[0].replace(/^\n+/, '').replace(/^比例：/, '').trim();
                }

                // 先剥离附加内容（排版指令、尺寸等），只保留核心提示词
                let corePrompt = workingPrompt
                    // 剥离新格式排版描述
                    .replace(/(?:文字横幅排版|海报式文字排版|角标式文字排版|简约文字排版|竖排文字排版|杂志封面式排版|标签阵列式排版|环绕式文字排版)[\s\S]*?(?=\n\n尺寸：|\n尺寸：|\n\n比例：|\n比例：|$)/g, '')
                    // 兼容旧格式
                    .replace(/【文字排版】[\s\S]*?(?=\n\n尺寸：|\n尺寸：|\n\n比例：|\n比例：|$)/g, '')
                    .replace(/\n\n尺寸：[^\n]+/g, '')
                    .replace(/\n尺寸：[^\n]+/g, '')
                    .replace(/\n\n比例：[^\n]+/g, '')
                    .replace(/\n比例：[^\n]+/g, '')
                    .replace(/【负面提示词】[\s\S]*/g, '')
                    .replace(/【画面中避免出现】[\s\S]*/g, '')
                    .replace(/【请避免】[\s\S]*/g, '')
                    .replace(/\[Negative Prompt\][\s\S]*/g, '')
                    .trim();

                // 从 corePrompt 中移除标题/副标题片段（已通过 extractQuotedItems 提取到 layoutInfo）
                // 避免标题引号内的文本污染 token 分类
                corePrompt = corePrompt.replace(new RegExp('(标题|副标题)[：:]\\s*' + Q + NQ + '+?' + Q + '(?:\\s*[,，、]\\s*' + Q + NQ + '+?' + Q + ')*', 'g'), '')
                    .replace(/[,，、]{2,}/g, '，')
                    .replace(/^[,，、]\s*/, '')
                    .replace(/\s*[,，、]\s*$/, '')
                    .trim();

                const tokens = corePrompt.split(/[,，、]/).map(t => t.trim()).filter(t => t);
                const classified = {
                    quality: [], subject: [], display: [], scene: [],
                    style: [], color: [], lighting: [], camera: [],
                    texture: [], post: [], atmosphere: [], headline: [],
                    promo: [], negative: [], other: []
                };
                const seen = new Set();
                tokens.forEach(token => {
                    // 防御性：清理可能残留的标题/副标题前缀
                    const cleanToken = token.replace(new RegExp('^(标题|副标题)[：:]' + Q + '*\\s*'), '').replace(new RegExp(Q + '$'), '').trim();
                    const category = this.classifyToken(cleanToken);
                    if (!seen.has(cleanToken.toLowerCase())) {
                        seen.add(cleanToken.toLowerCase());
                        if (classified[category]) {
                            classified[category].push(cleanToken);
                        } else {
                            classified.other.push(cleanToken);
                        }
                    }
                });
                // 将排版尺寸信息附加到返回结果
                classified._layout = layoutInfo;
                return classified;
            },

            // ===== 联想扩展引擎：以用户词为种子，生长出超出预期的完整描述 =====
            // 核心原则：用户的词是线索，不能丢弃，只能增强
            expandFromSeeds(groups) {
                const expanded = {};
                for (const k of Object.keys(groups)) {
                    if (Array.isArray(groups[k])) {
                        expanded[k] = [...groups[k]];
                    }
                }
                const allUserTokens = new Set();
                Object.values(groups).forEach(arr => {
                    if (Array.isArray(arr)) arr.forEach(t => allUserTokens.add(t.toLowerCase()));
                });

                const hasAny = (cats) => cats.some(c => (groups[c] || []).length > 0);
                const addIfNew = (cat, token) => {
                    const t = String(token);
                    if (!allUserTokens.has(t.toLowerCase())) {
                        if (!expanded[cat]) expanded[cat] = [];
                        if (!expanded[cat].some(e => e.toLowerCase() === t.toLowerCase())) {
                            expanded[cat].push(t);
                            allUserTokens.add(t.toLowerCase());
                        }
                    }
                };

                // --- 画质增强：用户选了某个画质词，联想更专业的表达 ---
                if (hasAny(['quality'])) {
                    const qWords = groups.quality.map(t => t.toLowerCase()).join(' ');
                    if (qWords.includes('8k') || qWords.includes('超高')) {
                        addIfNew('quality', '超写实渲染');
                        addIfNew('quality', '光线追踪');
                    }
                    if (qWords.includes('电影') || qWords.includes('cinematic')) {
                        addIfNew('quality', '商业级修图品质');
                        addIfNew('quality', 'HDR高动态范围');
                    }
                    if (qWords.includes('写实') || qWords.includes('真实')) {
                        addIfNew('quality', '微距级细节');
                        addIfNew('quality', '照片级真实感');
                    }
                    // 始终补充基础画质保证
                    if (groups.quality.length <= 2) {
                        addIfNew('quality', '超高画质');
                        addIfNew('quality', '超精细细节');
                    }
                }

                // --- 场景扩展：从用户场景词推理环境氛围 ---
                if (hasAny(['scene'])) {
                    const sWords = groups.scene.map(t => t.toLowerCase()).join(' ');
                    if (sWords.includes('纯白') || sWords.includes('极简')) {
                        addIfNew('scene', '干净无杂物的展示空间');
                    }
                    if (sWords.includes('镜面') || sWords.includes('反射')) {
                        addIfNew('lighting', '柔光漫射');
                        addIfNew('camera', '镜面倒影构图');
                    }
                    if (sWords.includes('霓虹') || sWords.includes('赛博')) {
                        addIfNew('lighting', '霓虹光晕');
                        addIfNew('color', '赛博霓虹灯色');
                        addIfNew('atmosphere', '科技未来感');
                    }
                    if (sWords.includes('金色') || sWords.includes('奢华')) {
                        addIfNew('color', '金色奢华风');
                        addIfNew('lighting', '黄金时刻暖光');
                    }
                    if (sWords.includes('自然') || sWords.includes('花园') || sWords.includes('植物')) {
                        addIfNew('lighting', '自然窗光');
                        addIfNew('atmosphere', '清新自然感');
                    }
                    if (sWords.includes('窗台') || sWords.includes('窗')) {
                        addIfNew('lighting', '窗边散射光');
                    }
                }

                // --- 光影扩展 ---
                if (hasAny(['lighting'])) {
                    const lWords = groups.lighting.map(t => t.toLowerCase()).join(' ');
                    if (lWords.includes('柔光') || lWords.includes('漫射')) {
                        addIfNew('camera', '景深虚化效果');
                        addIfNew('atmosphere', '纯净透明感');
                    }
                    if (lWords.includes('逆光') || lWords.includes('轮廓')) {
                        addIfNew('atmosphere', '文艺电影感');
                        addIfNew('camera', '前后景深层次');
                    }
                    if (lWords.includes('黄金') || lWords.includes('暖光')) {
                        addIfNew('color', '温暖大地色');
                        addIfNew('atmosphere', '温暖舒适感');
                    }
                }

                // --- 构图扩展 ---
                if (hasAny(['camera'])) {
                    const cWords = groups.camera.map(t => t.toLowerCase()).join(' ');
                    if (cWords.includes('微距') || cWords.includes('特写')) {
                        addIfNew('quality', '微距级细节');
                        addIfNew('quality', '锐利焦点');
                    }
                    if (cWords.includes('留白') || cWords.includes('大面积')) {
                        addIfNew('style', '极简主义');
                        addIfNew('atmosphere', '简约冷淡感');
                    }
                }

                // --- 风格扩展 ---
                if (hasAny(['style'])) {
                    const stWords = groups.style.map(t => t.toLowerCase()).join(' ');
                    if (stWords.includes('极简')) {
                        addIfNew('scene', '纯白极简背景');
                        addIfNew('color', '黑白极简');
                    }
                    if (stWords.includes('奢华') || stWords.includes('轻奢')) {
                        addIfNew('texture', '亮面高光');
                        addIfNew('atmosphere', '轻奢高级感');
                        // 只有用户选了金色相关词才添加金色场景
                        if (stWords.includes('金色') || (groups.color || []).some(c => c.includes('金色'))) {
                            addIfNew('color', '金色奢华风');
                            addIfNew('scene', '金色奢华幕布');
                        }
                    }
                    if (stWords.includes('胶片') || stWords.includes('复古')) {
                        addIfNew('texture', '颗粒感');
                        addIfNew('post', '暗角效果');
                        addIfNew('post', '复古褪色');
                    }
                    if (stWords.includes('韩系') || stWords.includes('画报')) {
                        addIfNew('color', '奶油白');
                        addIfNew('lighting', '柔光漫射');
                        addIfNew('atmosphere', '优雅知性感');
                    }
                    if (stWords.includes('赛博') || stWords.includes('朋克')) {
                        addIfNew('color', '赛博霓虹灯色');
                        addIfNew('lighting', '霓虹光晕');
                        addIfNew('post', '赛博朋克调色');
                    }
                    if (stWords.includes('国潮') || stWords.includes('新中式')) {
                        addIfNew('color', '经典红金配');
                        addIfNew('texture', '丝绸柔滑');
                        addIfNew('atmosphere', '艺术殿堂感');
                    }
                }

                // --- 色彩扩展 ---
                if (hasAny(['color'])) {
                    const coWords = groups.color.map(t => t.toLowerCase()).join(' ');
                    if (coWords.includes('莫兰迪') || coWords.includes('高级灰')) {
                        addIfNew('atmosphere', '轻奢高级感');
                        addIfNew('style', '极简主义');
                    }
                    if (coWords.includes('暖色调') || coWords.includes('温暖')) {
                        addIfNew('lighting', '黄金时刻暖光');
                        addIfNew('atmosphere', '温馨治愈感');
                    }
                    if (coWords.includes('冷色调') || coWords.includes('冷白')) {
                        addIfNew('lighting', '冷白棚拍光');
                        addIfNew('atmosphere', '简约冷淡感');
                    }
                    if (coWords.includes('高饱和') || coWords.includes('撞色')) {
                        addIfNew('style', '波普艺术');
                        addIfNew('atmosphere', '青春活力感');
                    }
                }

                // --- 主体扩展 ---
                if (hasAny(['subject'])) {
                    const suWords = groups.subject.map(t => t.toLowerCase()).join(' ');
                    if (suWords.includes('化妆品') || suWords.includes('护肤品') || suWords.includes('美妆')) {
                        addIfNew('scene', '大理石纹理台面');
                        addIfNew('texture', '珠光贝母');
                        addIfNew('lighting', '柔光漫射');
                    }
                    if (suWords.includes('香水') || suWords.includes('瓶')) {
                        addIfNew('display', '光影穿过产品');
                        addIfNew('texture', '玻璃通透');
                        addIfNew('lighting', '逆光轮廓光');
                    }
                    if (suWords.includes('手表') || suWords.includes('珠宝') || suWords.includes('首饰')) {
                        addIfNew('scene', '镜面反射展台');
                        addIfNew('lighting', '顶光聚焦');
                        addIfNew('texture', '金属拉丝');
                        addIfNew('camera', '微距特写');
                    }
                    if (suWords.includes('饮料') || suWords.includes('食品')) {
                        addIfNew('display', '动态飞溅效果');
                        addIfNew('scene', '冰镇水珠表面');
                        addIfNew('lighting', '环形光');
                    }
                    if (suWords.includes('运动鞋') || suWords.includes('鞋')) {
                        addIfNew('display', '产品旋转动感');
                        addIfNew('atmosphere', '运动能量感');
                        addIfNew('scene', '水泥工业风墙面');
                    }
                    if (suWords.includes('手机') || suWords.includes('数码') || suWords.includes('电脑')) {
                        addIfNew('scene', '科技感数字空间');
                        addIfNew('lighting', '霓虹光晕');
                        addIfNew('atmosphere', '科技未来感');
                    }
                }

                // --- 展示状态扩展 ---
                if (hasAny(['display'])) {
                    const dWords = groups.display.map(t => t.toLowerCase()).join(' ');
                    if (dWords.includes('悬浮')) {
                        addIfNew('scene', '干净无杂物的展示空间');
                        addIfNew('lighting', '柔光漫射');
                    }
                    if (dWords.includes('飞溅') || dWords.includes('动态')) {
                        addIfNew('quality', '超高速捕捉');
                        addIfNew('lighting', '硬光侧打');
                    }
                }

                // --- 氛围扩展 ---
                if (hasAny(['atmosphere'])) {
                    const aWords = groups.atmosphere.map(t => t.toLowerCase()).join(' ');
                    if (aWords.includes('轻奢') || aWords.includes('高级')) {
                        addIfNew('color', '莫兰迪色系');
                        addIfNew('style', '轻奢质感风');
                    }
                    if (aWords.includes('温馨') || aWords.includes('治愈')) {
                        addIfNew('color', '温暖大地色');
                        addIfNew('lighting', '黄金时刻暖光');
                    }
                }

                return expanded;
            },

            // 按模型指定的顺序重组关键词
            reorderTokenGroups(groups, order) {
                const result = [];
                const used = new Set();
                order.forEach(cat => {
                    if (groups[cat]) {
                        groups[cat].forEach(t => {
                            if (!used.has(t.toLowerCase())) {
                                result.push(t);
                                used.add(t.toLowerCase());
                            }
                        });
                    }
                });
                // 未分类的追加到最后
                (groups.other || []).forEach(t => {
                    if (!used.has(t.toLowerCase())) result.push(t);
                });
                return result;
            },

            // 权重包裹
            wrapWeight(token, weight) {
                if (weight === 1) return token;
                return `(${token}:${weight})`;
            },

            // 清理标点
            cleanPunctuation(text, sep) {
                return text.replace(/[,，、]{2,}/g, sep)
                    .replace(/^[,，、]\s*/, '')
                    .replace(/\s*[,，、]\s*$/, '')
                    .trim();
            }
        };

        const AI_MODELS = [
            {
                id: 'wanxiang',
                name: '万相',
                badge: '阿里',
                format: '中文逗号分隔，越靠前权重越高',
                strategy: '中文原生 · 种子生长 · 质量层叠 · 细节铺陈',
                optimize: function(prompt) {
                    // 万相：中文原生，靠位置决定权重
                    const groups = OPT_UTILS.parseAndClassify(prompt);
                    const negatives = [...groups.negative];
                    groups.negative = [];

                    // ★ 以用户词为种子，扩展生长出完整描述
                    const enriched = OPT_UTILS.expandFromSeeds(groups);

                    // 万相最优结构：画质基调 → 主体特写 → 场景氛围 → 光影质感 → 色彩后期
                    // 第一层：画质锚点（最靠前 = 最高权重）
                    const layer1_quality = [];
                    const qPriority = ['杰作', '超高画质', '超精细细节', '8K超高清', '电影级画质',
                        '照片级真实感', '超写实渲染', '商业级修图品质', '微距级细节',
                        '锐利焦点', 'HDR高动态范围', '光线追踪'];
                    qPriority.forEach(q => {
                        if (enriched.quality.some(t => t === q || t.includes(q))) layer1_quality.push(q);
                    });
                    // 用户自己的画质词排在最前
                    groups.quality.forEach(q => {
                        if (!layer1_quality.includes(q)) layer1_quality.push(q);
                    });

                    // 第二层：主体 + 展示方式
                    const layer2_subject = [...enriched.subject, ...enriched.display];

                    // 第三层：场景空间
                    const layer3_scene = [...enriched.scene];

                    // 第四层：风格 + 氛围
                    const layer4_style = [...enriched.style, ...enriched.atmosphere];

                    // 第五层：光影 + 质感
                    const layer5_tech = [...enriched.lighting, ...enriched.texture, ...enriched.camera];

                    // 第六层：色彩 + 后期
                    const layer6_color = [...enriched.color, ...enriched.post];

                    // 收集未分类的 other 词（确保不丢失任何用户输入）
                    const usedCats = ['quality','subject','display','scene','style','atmosphere','lighting','texture','camera','color','post','headline','promo','negative'];
                    const otherTokens = groups.other.filter(t => !usedCats.some(c => (enriched[c]||[]).includes(t) || (groups[c]||[]).includes(t)));

                    // 组装 + 去重（标题文案不在关键词层中混合，后面格式化输出）
                    const allLayers = [layer1_quality, layer2_subject, layer3_scene,
                        layer4_style, layer5_tech, layer6_color, otherTokens];
                    const seen = new Set();
                    const tokens = [];
                    allLayers.forEach(layer => {
                        layer.forEach(t => {
                            if (t && !seen.has(t.toLowerCase())) {
                                seen.add(t.toLowerCase());
                                tokens.push(t);
                            }
                        });
                    });

                    let result = tokens.join('，');
                    result = result.replace(/[,，]{2,}/g, '，').replace(/^[,，]\s*/, '').trim();

                    // 标题/副标题 + 排版：融合为自然语言描述融入提示词
                    const layout = groups._layout || {};
                    const extraParts = [];
                    if (layout.headlineText || layout.promoText) {
                        const copyParts = [];
                        if (layout.headlineText) copyParts.push(layout.headlineText);
                        if (layout.promoText) copyParts.push(layout.promoText);
                        extraParts.push(copyParts.join('，'));
                    }
                    if (layout.layout) {
                        extraParts.push(layout.layout);
                    }
                    if (layout.size) {
                        extraParts.push(`画面尺寸为${layout.size}`);
                    }
                    if (layout.ratio) {
                        extraParts.push(`画面比例为${layout.ratio}`);
                    }
                    if (extraParts.length > 0) {
                        if (result) result += '，';
                        result += extraParts.join('，');
                    }

                    if (negatives.length > 0) {
                        result += '\n\n【负面提示词】' + negatives.join('，');
                    }
                    return result;
                }
            },
            {
                id: 'seedream',
                name: 'Seedream',
                badge: '字节',
                format: '英文逗号 · (关键词:权重值) 加权 · 可中英混合',
                strategy: '种子生长 · 权重分层 · 英文优先 · 氛围层次',
                optimize: function(prompt) {
                    // Seedream：完全支持SD系权重语法，英文效果最佳
                    const groups = OPT_UTILS.parseAndClassify(prompt);
                    const negatives = [...groups.negative];
                    groups.negative = [];

                    // ★ 种子扩展
                    const enriched = OPT_UTILS.expandFromSeeds(groups);

                    // 构建分层加权描述
                    // L1: 画质基石 (最高权重)
                    const l1 = ['masterpiece', 'best quality', '8K', 'ultra detailed',
                        'photorealistic', 'hyperdetailed', 'sharp focus'];
                    const l1Tokens = l1.filter(t =>
                        enriched.quality.some(q => q.toLowerCase().includes(t.toLowerCase())) ||
                        groups.quality.some(q => q.toLowerCase().includes(t.toLowerCase()))
                    );
                    // 确保核心质量词存在
                    if (!l1Tokens.some(t => t.includes('masterpiece'))) l1Tokens.unshift('masterpiece');
                    if (!l1Tokens.some(t => t.includes('best quality'))) l1Tokens.push('best quality');

                    // L2: 主体 (高权重)
                    const l2Tokens = [...enriched.subject, ...enriched.display];

                    // L3: 场景环境
                    const l3Tokens = [...enriched.scene];

                    // L4: 风格氛围
                    const l4Tokens = [...enriched.style, ...enriched.atmosphere];

                    // L5: 光影质感构图
                    const l5Tokens = [...enriched.lighting, ...enriched.texture, ...enriched.camera];

                    // L6: 色彩后期
                    const l6Tokens = [...enriched.color, ...enriched.post];

                    // L7: 未分类词（确保不丢失任何用户输入）
                    const usedCats = ['quality','subject','display','scene','style','atmosphere','lighting','texture','camera','color','post','headline','promo','negative'];
                    const otherTokens = groups.other.filter(t => !usedCats.some(c => (enriched[c]||[]).includes(t) || (groups[c]||[]).includes(t)));

                    // 组装加权（标题文案不在关键词层中混合，后面格式化输出）
                    const seen = new Set();
                    const tokens = [];

                    const pushWeighted = (arr, baseWeight, indexBoost) => {
                        arr.forEach((t, i) => {
                            if (!t || seen.has(t.toLowerCase())) return;
                            seen.add(t.toLowerCase());
                            const weight = baseWeight + (arr.length - i) * indexBoost;
                            if (weight >= 1.3) tokens.push(`(${t}:${weight.toFixed(2)})`);
                            else if (weight >= 1.2) tokens.push(`(${t}:${weight.toFixed(2)})`);
                            else if (weight >= 1.1) tokens.push(`(${t}:${weight.toFixed(1)})`);
                            else tokens.push(t);
                        });
                    };

                    pushWeighted(l1Tokens, 1.2, 0.02);   // 画质层：1.2~1.34
                    pushWeighted(l2Tokens, 1.15, 0.02);  // 主体层：1.15~1.33
                    pushWeighted(l3Tokens, 1.05, 0.01);  // 场景层：1.05~1.15
                    pushWeighted(l4Tokens, 1.05, 0.01);  // 风格层
                    pushWeighted(l5Tokens, 1.05, 0.01);  // 技术层
                    pushWeighted(l6Tokens, 1.0, 0.0);    // 色彩层
                    pushWeighted(otherTokens, 1.0, 0.0); // 未分类词（保留用户原始输入）

                    let result = tokens.join(', ');
                    result = result.replace(/，/g, ', ').replace(/,\s*,/g, ',').trim();

                    // 标题/副标题：格式化输出
                    const layout = groups._layout || {};
                    if (layout.headlineText || layout.promoText) {
                        const copyParts = [];
                        if (layout.headlineText) copyParts.push(layout.headlineText);
                        if (layout.promoText) copyParts.push(layout.promoText);
                        if (result) result += ', ';
                        result += copyParts.join(', ');
                    }

                    // 排版和尺寸信息 → 英文关键词（增强新格式识别）
                    const layoutTokens = [];
                    if (layout.layout) {
                        const layoutText = layout.layout;
                        if (layoutText.includes('居中') || layoutText.includes('置中')) layoutTokens.push('(centered text:0.9)');
                        if (layoutText.includes('底部') || layoutText.includes('下方')) layoutTokens.push('(text at bottom:0.9)');
                        if (layoutText.includes('顶部') || layoutText.includes('上方')) layoutTokens.push('(text at top:0.9)');
                        if (layoutText.includes('左') || layoutText.includes('左侧') || layoutText.includes('侧边')) layoutTokens.push('(text left-aligned:0.9)');
                        if (layoutText.includes('右') || layoutText.includes('右侧')) layoutTokens.push('(text right-aligned:0.9)');
                        if (layoutText.includes('半透明') || layoutText.includes('透明')) layoutTokens.push('(semi-transparent overlay:0.9)');
                        if (layoutText.includes('底条') || layoutText.includes('条') || layoutText.includes('横幅')) layoutTokens.push('(text banner:0.9)');
                        if (layoutText.includes('描边')) layoutTokens.push('(text outline:0.9)');
                        if (layoutText.includes('投影')) layoutTokens.push('(text shadow:0.9)');
                        if (layoutText.includes('发光')) layoutTokens.push('(text glow:0.9)');
                        if (layoutText.includes('浮雕')) layoutTokens.push('(embossed text:0.9)');
                        if (layoutText.includes('渐变')) layoutTokens.push('(gradient text:0.9)');
                        if (layoutText.includes('白色') || layoutText.includes('白字')) layoutTokens.push('(white text:0.9)');
                        if (layoutText.includes('黑字') || layoutText.includes('黑色')) layoutTokens.push('(black text:0.9)');
                        if (layoutText.includes('金色')) layoutTokens.push('(gold text:0.9)');
                        if (layoutText.includes('竖排') || layoutText.includes('竖向')) layoutTokens.push('(vertical text:0.9)');
                        if (layoutText.includes('环绕')) layoutTokens.push('(text wrap:0.9)');
                        if (layoutText.includes('杂志')) layoutTokens.push('(magazine layout:0.9)');
                        if (layoutText.includes('标签')) layoutTokens.push('(tag layout:0.9)');
                        if (layoutText.includes('衬线')) layoutTokens.push('(serif font:0.9)');
                        if (layoutText.includes('书法')) layoutTokens.push('(calligraphy font:0.9)');
                        if (layoutText.includes('手写')) layoutTokens.push('(handwritten font:0.9)');
                        if (layoutText.includes('无衬线') || layoutText.includes('黑体')) layoutTokens.push('(sans-serif bold font:0.9)');
                        if (layoutTokens.length === 0) layoutTokens.push('(text overlay:0.85)');
                    }
                    if (layout.size) layoutTokens.push(`(${layout.size}:0.9)`);
                    if (layout.ratio) layoutTokens.push(`(${layout.ratio}:0.9)`);
                    if (layoutTokens.length > 0) {
                        result += ', ' + layoutTokens.join(', ');
                    }

                    if (negatives.length > 0) {
                        result += '\n\n[Negative Prompt] ' + negatives.join(', ');
                    }
                    return result;
                }
            },
            {
                id: 'lingdong',
                name: '灵动图像',
                badge: '网易',
                format: '中文逗号 · 技术摄影术语 · 写实强化',
                strategy: '摄影写实 · 种子生长 · 光影精确 · 质感还原',
                optimize: function(prompt) {
                    // 灵动图像：偏写实摄影，构图/光影术语权重高
                    const groups = OPT_UTILS.parseAndClassify(prompt);
                    const negatives = [...groups.negative];
                    groups.negative = [];

                    // ★ 种子扩展
                    const enriched = OPT_UTILS.expandFromSeeds(groups);

                    // 摄影级写实描述：围绕用户线索生长
                    // L1: 摄影品质锚点
                    const photoBase = ['专业摄影级', '超写实', '锐利对焦', 'RAW格式质感',
                        '照片级真实感', '高精度建模', '光线追踪'];
                    const l1 = photoBase.filter(p =>
                        enriched.quality.some(q => q.includes(p)) ||
                        groups.quality.some(q => q.includes(p))
                    );
                    if (l1.length < 3) {
                        ['专业摄影级', '超写实', '锐利对焦'].forEach(p => {
                            if (!l1.includes(p)) l1.push(p);
                        });
                    }

                    // L2: 主体 + 展示
                    const l2 = [...enriched.subject, ...enriched.display];

                    // L3: 构图 (灵动核心优势)
                    const l3 = [...enriched.camera];

                    // L4: 光影 (灵动核心优势)
                    const l4 = [...enriched.lighting];

                    // L5: 色彩
                    const l5 = [...enriched.color];

                    // L6: 场景
                    const l6 = [...enriched.scene];

                    // L7: 质感
                    const l7 = [...enriched.texture];

                    // L8: 风格氛围
                    const l8 = [...enriched.style, ...enriched.atmosphere, ...enriched.post];

                    // L9: 未分类词（确保不丢失任何用户输入）
                    const usedCats = ['quality','subject','display','camera','lighting','color','scene','texture','style','atmosphere','post','headline','promo','negative'];
                    const otherTokens = groups.other.filter(t => !usedCats.some(c => (enriched[c]||[]).includes(t) || (groups[c]||[]).includes(t)));

                    // L10: 文案（不在关键词层混合，后面格式化输出）
                    const allLayers = [l1, l2, l3, l4, l5, l6, l7, l8, otherTokens];
                    const seen = new Set();
                    const tokens = [];
                    allLayers.forEach(layer => {
                        layer.forEach(t => {
                            if (t && !seen.has(t.toLowerCase())) {
                                seen.add(t.toLowerCase());
                                tokens.push(t);
                            }
                        });
                    });

                    let result = tokens.join('，');
                    result = result.replace(/[,，]{2,}/g, '，').replace(/^[,，]\s*/, '').trim();

                    // 标题/副标题 + 排版：自然语言融入
                    const layout = groups._layout || {};
                    const extraParts = [];
                    if (layout.headlineText || layout.promoText) {
                        const copyParts = [];
                        if (layout.headlineText) copyParts.push(layout.headlineText);
                        if (layout.promoText) copyParts.push(layout.promoText);
                        extraParts.push(copyParts.join('，'));
                    }
                    if (layout.layout) {
                        extraParts.push(layout.layout);
                    }
                    if (layout.size) {
                        extraParts.push(`画面尺寸为${layout.size}`);
                    }
                    if (layout.ratio) {
                        extraParts.push(`画面比例为${layout.ratio}`);
                    }
                    if (extraParts.length > 0) {
                        if (result) result += '，';
                        result += extraParts.join('，');
                    }

                    if (negatives.length > 0) {
                        result += '\n\n【负面提示词】' + negatives.join('，');
                    }
                    return result;
                }
            },
            {
                id: 'qwen-image',
                name: '千问图像',
                badge: '阿里',
                format: '自然语言完整句子 · 场景叙述 · 语义优先',
                strategy: '种子叙事 · 场景化 · 完整句式 · 氛围营造',
                optimize: function(prompt) {
                    // 千问图像：最强自然语言理解，围绕用户词生长出完整画面叙事
                    const groups = OPT_UTILS.parseAndClassify(prompt);
                    const negatives = [...groups.negative];

                    // ★ 种子扩展
                    const enriched = OPT_UTILS.expandFromSeeds(groups);

                    const subject = enriched.subject.join('、') || groups.subject.join('、') || '';
                    const scene = enriched.scene.join('、');
                    const style = enriched.style.join('、');
                    const color = enriched.color.join('、');
                    const lighting = enriched.lighting.join('、');
                    const camera = enriched.camera.join('、');
                    const texture = enriched.texture.join('、');
                    const display = enriched.display.join('、');
                    const atmosphere = enriched.atmosphere.join('、');
                    const headline = enriched.headline.join('、');
                    const promo = enriched.promo.join('、');
                    const quality = enriched.quality.join('、');

                    // 收集所有尚未使用的 other 词
                    const usedCats = ['quality','subject','scene','style','color','lighting','camera','texture','display','atmosphere','headline','promo','negative'];
                    const extraTokens = groups.other.filter(t => !usedCats.some(c => (enriched[c]||[]).includes(t)));

                    // 构建自然语言叙述 —— 从用户线索出发，生长为完整画面
                    let narratives = [];

                    // 开场：画质基调（取前3个关键词，避免冗长）
                    if (quality) {
                        const qualityTokens = quality.split('、');
                        const topQuality = qualityTokens.slice(0, 3).join('、');
                        narratives.push(`这是一幅${topQuality}的摄影作品`);
                        // 多余的画质词放入技术描述
                        if (qualityTokens.length > 3) {
                            const extraQuality = qualityTokens.slice(3).join('、');
                            if (!texture) {
                                // 将多余画质词暂存，后续并入技术层
                            }
                        }
                    } else {
                        narratives.push('这是一幅高质量摄影作品');
                    }

                    // 主体特写（最核心的线索）
                    if (subject) {
                        let subjectDesc = `画面核心是${subject}`;
                        if (display) subjectDesc += `，${display}`;
                        narratives.push(subjectDesc);
                    }

                    // 场景设定
                    if (scene) narratives.push(`场景设定在${scene}`);

                    // 风格与氛围
                    let styleParts = [];
                    if (style) styleParts.push(`整体呈现${style}风格`);
                    if (atmosphere) styleParts.push(`营造${atmosphere}的氛围`);
                    if (styleParts.length > 0) narratives.push(styleParts.join('，'));

                    // 色调
                    if (color) narratives.push(`色调上采用${color}`);

                    // 光影构图质感
                    let techDesc = [];
                    if (lighting) techDesc.push(`用光上采用${lighting}`);
                    if (camera) techDesc.push(`构图上运用${camera}`);
                    if (texture) techDesc.push(`质感上带有${texture}`);
                    if (techDesc.length > 0) narratives.push(techDesc.join('，'));

                    // 广告信息（使用原始格式化文本）
                    const layout = groups._layout || {};
                    if (layout.headlineText || layout.promoText) {
                        let copyParts = [];
                        if (layout.headlineText) copyParts.push(layout.headlineText);
                        if (layout.promoText) copyParts.push(layout.promoText);
                        narratives.push(`画面中可加入${copyParts.join('，')}`);
                    }

                    // 额外关键词
                    if (extraTokens.length > 0) {
                        narratives.push(`同时体现以下元素：${extraTokens.join('、')}`);
                    }

                    // 排版与尺寸（自然语言融入）
                    if (layout.layout) {
                        narratives.push(layout.layout);
                    }
                    if (layout.size || layout.ratio) {
                        let specParts = [];
                        if (layout.size) specParts.push(`画面尺寸为${layout.size}`);
                        if (layout.ratio) specParts.push(`画面比例为${layout.ratio}`);
                        narratives.push(specParts.join('，'));
                    }

                    // 收尾：整体画面感
                    narratives.push('画面充满故事感与艺术氛围');

                    let result = narratives.filter(n => n).join('。\n');

                    if (negatives.length > 0) {
                        result += '\n\n【画面中避免出现】' + negatives.join('、');
                    }
                    return result.trim();
                }
            },
            {
                id: 'z-image-turbo',
                name: 'Z Image Turbo',
                badge: '高速',
                format: '英文逗号 · 极简关键词 · ≤15词最优',
                strategy: '种子精简 · 去虚词 · 纯关键词 · 顺序即权重',
                optimize: function(prompt) {
                    // Z Image Turbo：token敏感，极简关键词，英文优先
                    const groups = OPT_UTILS.parseAndClassify(prompt);
                    const negatives = [...groups.negative];

                    // ★ 种子扩展 (但严格控制数量，最多只取关键扩展)
                    const enriched = OPT_UTILS.expandFromSeeds(groups);

                    // 去虚词集合
                    const redundant = new Set([
                        '的', '了', '着', '在', '是', '和', '与', '一个', '非常',
                        '极其', '十分', '很', '一些', '这个', '那个', '而', '也'
                    ]);

                    // Z Image 精选顺序：画质 → 主体 → 展示 → 风格 → 场景 → 光影 → 色彩 → 构图 → 质感 → 氛围 → 标题文案
                    // 每层最多取3个词
                    const pickTop = (arr, max = 3) => arr.filter(t => t && !redundant.has(t) && t.length > 1).slice(0, max);

                    const l1 = pickTop([...enriched.quality, ...groups.quality], 4);
                    const l2 = pickTop([...enriched.subject, ...groups.subject], 3);
                    const l3 = pickTop([...enriched.display, ...groups.display], 2);
                    const l4 = pickTop([...enriched.style, ...groups.style], 2);
                    const l5 = pickTop([...enriched.scene, ...groups.scene], 2);
                    const l6 = pickTop([...enriched.lighting, ...groups.lighting], 2);
                    const l7 = pickTop([...enriched.color, ...groups.color], 2);
                    const l8 = pickTop([...enriched.camera, ...groups.camera], 1);
                    const l9 = pickTop([...enriched.texture, ...groups.texture], 1);
                    const l10 = pickTop([...enriched.atmosphere, ...groups.atmosphere], 1);
                    // L11: 未分类词（保留用户原始输入）
                    const usedCats = ['quality','subject','display','style','scene','lighting','color','camera','texture','atmosphere','headline','promo','negative'];
                    const otherTokens = groups.other.filter(t => !usedCats.some(c => (enriched[c]||[]).includes(t) || (groups[c]||[]).includes(t)));
                    const l11 = pickTop(otherTokens, 5);
                    // 标题文案不在关键词层中混合，后面格式化输出
                    let tokens = [...l1, ...l2, ...l3, ...l4, ...l5, ...l6, ...l7, ...l8, ...l9, ...l10, ...l11];

                    // 中译英映射
                    const translateMap = {
                        '杰作': 'masterpiece', '超高画质': 'ultra HD', '超精细细节': 'hyperdetailed',
                        '年轻女性': 'young woman', '街拍路人': 'street portrait',
                        '自然风光': 'landscape', '城市建筑': 'urban architecture',
                        '暖色调': 'warm tone', '冷色调': 'cool tone',
                        '逆光轮廓光': 'backlight silhouette', '黄金时刻暖光': 'golden hour',
                        '柔光漫射': 'soft natural light', '窗边散射光': 'window light',
                        '日系小清新': 'Japanese fresh', '韩系画报': 'Korean pictorial',
                        '复古胶片': 'vintage film', '赛博朋克': 'cyberpunk',
                        '文艺电影感': 'cinematic aesthetic', '景深效果': 'depth of field',
                        '电影级光影': 'cinematic lighting', '锐利对焦': 'sharp focus',
                        '极简主义': 'minimalist', '轻奢质感风': 'luxury aesthetic',
                        '莫兰迪色系': 'morandi palette', '高饱和撞色': 'high contrast pop',
                        '金属拉丝': 'brushed metal', '磨砂哑光': 'matte finish',
                        '玻璃通透': 'glass transparency', '亮面高光': 'glossy highlight',
                        '纯白极简背景': 'white minimal background', '大理石纹理台面': 'marble surface',
                        '科技感数字空间': 'tech digital space', '镜面反射展台': 'mirror podium',
                        '产品悬浮展示': 'floating product', '动态飞溅效果': 'splash effect',
                        '微距特写': 'macro close-up', '居中对称构图': 'symmetric composition',
                        '轻奢高级感': 'luxury elegance', '科技未来感': 'futuristic tech',
                        '温馨治愈感': 'cozy warm', '青春活力感': 'youthful energy',
                    };
                    tokens = tokens.map(t => translateMap[t] || t);

                    // 去重
                    const seen = new Set();
                    tokens = tokens.filter(t => {
                        if (!t) return false;
                        const lower = t.toLowerCase();
                        if (seen.has(lower)) return false;
                        seen.add(lower);
                        return true;
                    });

                    // 限制长度 ≤ 15
                    if (tokens.length > 15) {
                        tokens = tokens.slice(0, 15);
                    }

                    let result = tokens.join(', ');

                    // 标题/副标题 + 排版：精简英文关键词
                    const layout = groups._layout || {};
                    if (layout.headlineText || layout.promoText) {
                        const copyParts = [];
                        if (layout.headlineText) copyParts.push(layout.headlineText);
                        if (layout.promoText) copyParts.push(layout.promoText);
                        if (result) result += ', ';
                        result += copyParts.join(', ');
                    }

                    // 排版关键词精简版（英文，Z Image 偏好）
                    if (layout.layout) {
                        const lt = layout.layout;
                        const zTokens = [];
                        if (lt.includes('居中') || lt.includes('置中')) zTokens.push('centered text');
                        if (lt.includes('底部') || lt.includes('下方')) zTokens.push('bottom text');
                        if (lt.includes('顶部') || lt.includes('上方')) zTokens.push('top text');
                        if (lt.includes('侧边')) zTokens.push('side text');
                        if (lt.includes('横幅') || lt.includes('底条')) zTokens.push('text banner');
                        if (lt.includes('描边')) zTokens.push('text outline');
                        if (lt.includes('投影')) zTokens.push('text shadow');
                        if (lt.includes('发光')) zTokens.push('text glow');
                        if (lt.includes('竖排')) zTokens.push('vertical text');
                        if (lt.includes('标签')) zTokens.push('tag text');
                        if (zTokens.length === 0) zTokens.push('text overlay');
                        result += ', ' + zTokens.slice(0, 3).join(', ');
                    }
                    if (layout.size) result += ', ' + layout.size;
                    if (layout.ratio) result += ', ' + layout.ratio;

                    if (negatives.length > 0 && negatives.length <= 5) {
                        const negEnglish = negatives.slice(0, 5).join(', ');
                        result += '\n\nNegative: ' + negEnglish;
                    }
                    return result.trim();
                }
            },
            {
                id: 'doubao',
                name: '豆包',
                badge: '字节',
                format: '中文自然语言 · 详细描述 · 对话式表达',
                strategy: '种子叙事 · 语义丰富 · 细节描述 · 场景生长',
                optimize: function(prompt) {
                    // 豆包：擅长理解中文自然语言，围绕用户线索生长为完整画面描述
                    const groups = OPT_UTILS.parseAndClassify(prompt);
                    const negatives = [...groups.negative];
                    groups.negative = [];

                    // ★ 种子扩展
                    const enriched = OPT_UTILS.expandFromSeeds(groups);

                    const subject = enriched.subject.join('、') || groups.subject.join('、') || '';
                    const scene = enriched.scene.join('、');
                    const style = enriched.style.join('、');
                    const color = enriched.color.join('、');
                    const lighting = enriched.lighting.join('、');
                    const camera = enriched.camera.join('、');
                    const texture = enriched.texture.join('、');
                    const quality = enriched.quality.join('、');
                    const display = enriched.display.join('、');
                    const atmosphere = enriched.atmosphere.join('、');
                    const headline = enriched.headline.join('、');
                    const promo = enriched.promo.join('、');

                    const usedCats = ['quality','subject','scene','style','color','lighting','camera','texture','display','atmosphere','headline','promo','negative'];
                    const extraTokens = groups.other.filter(t => !usedCats.some(c => (enriched[c]||[]).includes(t)));

                    // 构建完整中文自然语言描述
                    let sentences = [];

                    // 开场：画质定调（取前3个关键词，避免冗长）
                    if (quality) {
                        const qualityTokens = quality.split('、');
                        const topQuality = qualityTokens.slice(0, 3).join('、');
                        sentences.push(`请生成一张${topQuality}的图片`);
                    } else {
                        sentences.push('请生成一张高质量的图片');
                    }

                    // 主体特写
                    if (subject) {
                        let subjectLine = `画面核心是${subject}`;
                        if (display) subjectLine += `，${display}`;
                        sentences.push(subjectLine);
                    }

                    // 场景
                    if (scene) sentences.push(`场景设定为${scene}`);

                    // 风格与色调
                    let styleParts = [];
                    if (style) styleParts.push(`${style}风格`);
                    if (atmosphere) styleParts.push(`营造${atmosphere}的氛围`);
                    if (color) styleParts.push(`${color}色调`);
                    if (styleParts.length > 0) {
                        sentences.push(`整体采用${styleParts.join('、')}`);
                    }

                    // 光影与构图
                    let techParts = [];
                    if (lighting) techParts.push(`${lighting}的光线效果`);
                    if (camera) techParts.push(`${camera}的构图方式`);
                    if (texture) techParts.push(`${texture}的质感表现`);
                    if (techParts.length > 0) {
                        sentences.push(`在技术层面，注重${techParts.join('、')}`);
                    }

                    // 广告信息（使用原始格式化文本）
                    const layout = groups._layout || {};
                    if (layout.headlineText || layout.promoText) {
                        let copyParts = [];
                        if (layout.headlineText) copyParts.push(layout.headlineText);
                        if (layout.promoText) copyParts.push(layout.promoText);
                        sentences.push(`广告信息为${copyParts.join('，')}`);
                    }

                    // 额外关键词
                    if (extraTokens.length > 0) {
                        sentences.push(`除此之外，还需要体现：${extraTokens.join('、')}`);
                    }

                    // 排版与尺寸（自然语言融入）
                    if (layout.layout) {
                        sentences.push(layout.layout);
                    }
                    if (layout.size || layout.ratio) {
                        let specParts = [];
                        if (layout.size) specParts.push(`画面尺寸为${layout.size}`);
                        if (layout.ratio) specParts.push(`画面比例为${layout.ratio}`);
                        sentences.push(specParts.join('，'));
                    }

                    // 最终要求
                    sentences.push('要求画面精致、细节丰富、符合上述所有描述');

                    let result = sentences.join('。');

                    if (negatives.length > 0) {
                        result += '。\n\n【请避免】' + negatives.join('、');
                    }
                    return result.trim();
                }
            }
        ];

        let currentModelId = null;
        let modelResults = {}; // 缓存各模型优化结果
        let modelFed = false; // 是否已填入优化
        let fedPromptHash = ''; // 填入时的提示词哈希，用于检测变化

        function renderOptStatusBar() {
            const container = document.getElementById('modelOptStatus');
            const rawPrompt = document.getElementById('resultTextarea').value.trim();

            if (!rawPrompt) {
                container.innerHTML = '';
                return;
            }

            if (modelFed) {
                const currentHash = simpleHash(rawPrompt);
                if (currentHash !== fedPromptHash) {
                    // 提示词已变更
                    container.innerHTML = `
                        <div class="opt-status-bar stale">
                            <span class="status-dot"></span>
                            <span>原始提示词已变更，优化结果可能已过时</span>
                            <div class="status-actions">
                                <button class="btn btn-optimize-feed btn-sm" onclick="feedToOptimization()">重新填入优化</button>
                            </div>
                        </div>
                    `;
                } else {
                    const resultCount = Object.keys(modelResults).length;
                    container.innerHTML = `
                        <div class="opt-status-bar fed">
                            <span class="status-dot"></span>
                            <span>✓ 已填入优化中 — ${resultCount}/${AI_MODELS.length} 个模型优化完成</span>
                            <div class="status-actions">
                                <button class="btn btn-ghost btn-sm" onclick="clearAllModelResults()">清除</button>
                            </div>
                        </div>
                    `;
                }
            } else {
                container.innerHTML = `
                    <div class="opt-status-bar" style="background: rgba(99,102,241,0.08); border: 1px dashed var(--primary); color: var(--text-secondary);">
                        <span>提示词已就绪，点击上方「填入优化中」即可一键优化</span>
                    </div>
                `;
            }
        }

        function simpleHash(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash |= 0;
            }
            return hash.toString();
        }

        function renderModelTabs() {
            const container = document.getElementById('modelTabs');
            container.innerHTML = AI_MODELS.map(m => `
                <button class="model-tab ${m.id === currentModelId ? 'active' : ''} ${modelResults[m.id] ? 'has-result' : ''}" 
                        onclick="selectModel('${m.id}')">
                    ${m.name}<span class="model-badge">${m.badge}</span>
                </button>
            `).join('');
        }

        function feedToOptimization() {
            const rawPrompt = document.getElementById('resultTextarea').value.trim();
            if (!rawPrompt) {
                showToast('请先生成提示词', 'warning');
                return;
            }

            // 填入优化：为所有模型生成优化结果
            modelResults = {};
            AI_MODELS.forEach(m => {
                modelResults[m.id] = m.optimize(rawPrompt);
            });

            modelFed = true;
            fedPromptHash = simpleHash(rawPrompt);

            // 自动选中第一个模型展示
            currentModelId = AI_MODELS[0].id;
            renderModelTabs();
            renderModelResult(currentModelId);
            renderOptStatusBar();

            showToast(`已填入优化中 — ${AI_MODELS.length} 个模型优化完成`, 'success');
        }

        function selectModel(modelId) {
            currentModelId = modelId;
            renderModelTabs();

            const rawPrompt = document.getElementById('resultTextarea').value.trim();
            if (!rawPrompt) {
                document.getElementById('modelResultArea').innerHTML = `
                    <div class="model-empty">
                        <p>请先生成提示词，然后点击「填入优化中」查看各模型优化结果</p>
                    </div>
                `;
                return;
            }

            // 检查是否有缓存
            if (modelResults[modelId]) {
                renderModelResult(modelId);
            } else {
                // 没有缓存，单独优化
                optimizeForModel(modelId);
                renderModelResult(modelId);
                renderModelTabs(); // 刷新标签状态
                if (modelFed) renderOptStatusBar();
            }
        }

        function optimizeForModel(modelId) {
            const model = AI_MODELS.find(m => m.id === modelId);
            if (!model) return;

            const rawPrompt = document.getElementById('resultTextarea').value.trim();
            if (!rawPrompt) return;

            const optimized = model.optimize(rawPrompt);
            modelResults[modelId] = optimized;
        }

        function renderModelResult(modelId) {
            const model = AI_MODELS.find(m => m.id === modelId);
            if (!model) return;

            const result = modelResults[modelId] || '';
            const area = document.getElementById('modelResultArea');

            area.innerHTML = `
                <div class="model-result-card fade-in">
                    <div class="model-result-header">
                        <div class="model-result-info">
                            <span class="model-result-name">${model.name}</span>
                            <span class="model-result-strategy">${model.format || model.strategy}</span>
                        </div>
                    </div>
                    <div class="model-result-body">
                        <textarea id="modelResultText_${modelId}" class="model-result-textarea" readonly>${escapeHtml(result)}</textarea>
                    </div>
                    <div class="model-result-actions">
                        <button class="btn btn-primary btn-sm" onclick="copyModelResult('${modelId}')">复制优化结果</button>
                        <button class="btn btn-secondary btn-sm" onclick="reOptimizeModel('${modelId}')">重新优化</button>
                        <button class="btn btn-ghost btn-sm" onclick="clearModelResult('${modelId}')">清空</button>
                    </div>
                    <div class="model-type-hint">
                        <strong>${model.name} 优化指南：</strong><br>${getModelHint(modelId).replace(/\n/g, '<br>')}
                    </div>
                </div>
            `;
        }

        function getModelHint(modelId) {
            const hints = {
                'wanxiang': '万相是中文原生模型，靠位置决定权重——越靠前的词影响力越大。质量词必须放在最前面，主体紧随其后。\n• 格式：中文逗号「，」分隔\n• 权重：靠前置位置，无括号语法\n• 技巧：最重要的元素放开头，质量词前置必加\n• 负面提示词：建议单独输入，不要混入正向提示词',
                'seedream': 'Seedream 完全兼容 SD 系提示词语法，支持 (keyword:权重) 加权格式，英文优先但中英混合效果更佳。\n• 格式：英文逗号「, 」分隔，(keyword:1.3) 加权\n• 权重：前3个关键词自动加权 1.2~1.3\n• 技巧：高质量英文前缀 + 艺术氛围词组合\n• 支持复杂的艺术家风格引用',
                'lingdong': '灵动图像偏写实摄影风格，构图和光影术语权重最高，RAW质感类关键词能显著提升画质。\n• 格式：中文逗号「，」分隔\n• 权重：构图/光影关键词越靠前效果越好\n• 技巧：强化构图术语 + 光影层次描述\n• 避免过于抽象的词汇，写实类效果最佳',
                'qwen-image': '千问图像拥有最强的自然语言理解能力，完整句子描述效果远超关键词堆砌。\n• 格式：自然语言完整句子，句号分隔\n• 权重：靠语义理解，非关键词位置\n• 技巧：用叙事句描述场景 → 风格 → 光影\n• 不需要刻意拆分关键词，口语化表达即可',
                'z-image-turbo': 'Z Image Turbo 速度优先，对提示词长度敏感，必须精简高效。\n• 格式：英文逗号「, 」分隔，建议 ≤ 15 个关键词\n• 权重：顺序即权重，核心词放前面\n• 技巧：严格去重去虚词，中文自动转英文\n• 超过18词自动裁剪，去掉冗余修饰',
                'doubao': '豆包是字节跳动AI助手，中文自然语言理解能力强，适合用完整句子描述需求。\n• 格式：中文自然语言完整句子，句号分隔\n• 权重：靠语义理解而非关键词位置\n• 技巧：像对话一样自然描述画面内容\n• 越详细具体的描述，生成的图片越贴合预期'
            };
            return hints[modelId] || '';
        }

        function copyModelResult(modelId) {
            const textarea = document.getElementById('modelResultText_' + modelId);
            copyText(modelResults[modelId], '优化提示词已复制到剪贴板', textarea);
        }

        function reOptimizeModel(modelId) {
            const rawPrompt = document.getElementById('resultTextarea').value.trim();
            if (!rawPrompt) {
                showToast('请先生成原始提示词', 'warning');
                return;
            }

            // 清除缓存重新优化
            delete modelResults[modelId];
            optimizeForModel(modelId);
            renderModelResult(modelId);
            renderModelTabs();
            renderOptStatusBar();
            showToast('已重新优化', 'success');
        }

        function clearModelResult(modelId) {
            delete modelResults[modelId];
            if (currentModelId === modelId) {
                currentModelId = null;
                renderModelTabs();
                document.getElementById('modelResultArea').innerHTML = `
                    <div class="model-empty">
                        <p>请点击「填入优化中」或选择一个模型查看优化结果</p>
                    </div>
                `;
            }
            renderModelTabs();
            renderOptStatusBar();
            showToast('优化结果已清空', 'success');
        }

        function clearAllModelResults() {
            modelResults = {};
            modelFed = false;
            fedPromptHash = '';
            currentModelId = null;
            renderModelTabs();
            renderOptStatusBar();
            document.getElementById('modelResultArea').innerHTML = `
                <div class="model-empty">
                    <p>已清除所有优化结果，点击「填入优化中」重新生成</p>
                </div>
            `;
            showToast('所有模型优化结果已清除', 'success');
        }

        // 原始提示词变化时，不清除缓存但标记为过期
        function invalidateModelCache() {
            if (modelFed) {
                // 标记为过期，但保留结果供参考
                renderOptStatusBar();
                if (currentModelId && modelResults[currentModelId]) {
                    renderModelResult(currentModelId);
                }
            } else {
                modelResults = {};
                currentModelId = null;
                renderModelTabs();
                renderOptStatusBar();
                document.getElementById('modelResultArea').innerHTML = `
                    <div class="model-empty">
                        <p>请选择上方词库后，再点击模型查看优化结果</p>
                    </div>
                `;
            }
        }

        // ==================== History ====================
        function getHistory() {
            return loadData(STORAGE_KEYS.HISTORY, []);
        }

        function saveHistory(history) {
            saveData(STORAGE_KEYS.HISTORY, history);
        }

        function saveToHistory() {
            const result = document.getElementById('resultTextarea').value;
            if (!result) {
                showToast('没有内容可保存', 'warning');
                return;
            }

            const history = getHistory();
            history.unshift({
                id: generateId(),
                text: result,
                timestamp: Date.now()
            });

            // Keep only last 50 items
            if (history.length > 50) {
                history.pop();
            }

            saveHistory(history);
            renderHistory();
            showToast('已保存到历史记录', 'success');
        }

        function renderHistory() {
            const history = getHistory();
            const container = document.getElementById('historyList');
            const countBadge = document.getElementById('historyCount');

            countBadge.textContent = history.length;

            if (history.length === 0) {
                container.innerHTML = '<div class="empty-state" style="padding: 1rem;"><p>暂无历史记录</p></div>';
                return;
            }

            container.innerHTML = history.map(item => `
                <div class="history-item" onclick="loadHistoryItem('${item.id}')">
                    <span class="history-item-text">${escapeHtml(item.text.substring(0, 60))}${item.text.length > 60 ? '...' : ''}</span>
                    <span class="history-item-time">${formatTime(item.timestamp)}</span>
                    <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); copyHistoryItem('${item.id}')" title="复制">复制</button>
                    <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); deleteHistoryItem('${item.id}')" title="删除">删除</button>
                </div>
            `).join('');
        }

        function loadHistoryItem(id) {
            const history = getHistory();
            const item = history.find(h => h.id === id);
            if (item) {
                document.getElementById('resultTextarea').value = item.text;
                showToast('已加载历史记录', 'success');
            }
        }

        function copyHistoryItem(id) {
            const history = getHistory();
            const item = history.find(h => h.id === id);
            if (item && item.text) {
                copyText(item.text, '已复制到剪贴板');
            } else {
                showToast('没有内容可复制', 'warning');
            }
        }

        function deleteHistoryItem(id) {
            const history = getHistory().filter(h => h.id !== id);
            saveHistory(history);
            renderHistory();
            showToast('历史记录已删除', 'success');
        }

        function toggleHistory() {
            const toggle = document.getElementById('historyToggle');
            const content = document.getElementById('historyContent');
            toggle.classList.toggle('open');
            content.classList.toggle('open');
        }

        // ==================== Panel Collapse ====================
        function toggleFormulaPanel() {
            const panel = document.getElementById('formulaPanel');
            panel.classList.toggle('collapsed');
            localStorage.setItem('formula-panel-collapsed', panel.classList.contains('collapsed'));
        }

        // Restore formula panel state on load（默认收起）
        (function() {
            const panel = document.getElementById('formulaPanel');
            if (!panel) return;
            if (localStorage.getItem('formula-panel-collapsed') === 'false') {
                panel.classList.remove('collapsed');
            }
        })();

        // ==================== Import/Export ====================
        function exportData() {
            const data = {
                version: DATA_VERSION,
                type: 'prompt-combinator-full-backup',
                formulas: getFormulas(),
                thesaurus: getThesaurus(),
                thesaurusDefaults: getThesaurusDefaults(),
                sizeTabs: getSizeTabs(),
                exportedAt: new Date().toISOString()
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `prompt-combinator-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);

            showToast('数据已导出', 'success');
        }

        function importData() {
            document.getElementById('importModal').classList.add('active');
            // 重置状态
            document.getElementById('importPreview').style.display = 'none';
            document.getElementById('csvFormatHint').style.display = 'none';
            document.getElementById('importFileInput').value = '';
            pendingTxtData = null;
            pendingFileName = '';
            // 默认选中合并模式
            const mergeRadio = document.querySelector('input[name="importMode"][value="merge"]');
            if (mergeRadio) mergeRadio.checked = true;
        }

        function closeImportModal() {
            document.getElementById('importModal').classList.remove('active');
            pendingTxtData = null;
        }

        // 处理TXT/CSV文件导入 — 预览
        let pendingTxtData = null;
        let pendingFileName = '';

        function showTxtPreview(content) {
            const fileName = pendingFileName || '';
            let result;
            if (fileName.endsWith('.csv')) {
                result = parseCsvToThesaurus(content);
            } else {
                result = parseTxtToThesaurus(content);
            }

            if (result.categories.length === 0) {
                showToast('未识别到有效的词库格式', 'error');
                return;
            }

            pendingTxtData = result;
            document.getElementById('csvFormatHint').style.display = 'block';
            showImportPreview(result);
        }

        function showImportPreview(result) {
            const preview = document.getElementById('importPreview');
            const content = document.getElementById('previewContent');

            let html = '';
            result.categories.forEach((cat, catIndex) => {
                html += `
                    <div class="preview-category">
                        <div class="preview-category-header">
                            <input type="text" class="preview-category-input" value="${escapeAttr(cat.name)}" 
                                   onchange="updateCategoryName(${catIndex}, this.value)" 
                                   placeholder="分类名称">
                            <span style="color: var(--text-secondary); font-size: 0.8rem;">${cat.words.length}个词汇</span>
                            <button class="btn btn-ghost btn-sm" onclick="removeCategory(${catIndex})" title="删除分类">删除</button>
                        </div>
                        <div class="preview-words">
                            ${cat.words.map((w, wordIndex) => `
                                <span class="preview-word editable" onclick="editWord(this, ${catIndex}, ${wordIndex})">${escapeHtml(getWordText(w))}${hasWordChildren(w) ? ' ▸' : ''}</span>
                            `).join('')}
                        </div>
                        <div class="preview-add-word">
                            <input type="text" class="preview-add-input" placeholder="添加词汇..." 
                                   onkeypress="if(event.key==='Enter') addWordFromPreview(${catIndex}, this.value, this)">
                            <button class="btn btn-ghost btn-sm" onclick="addWordFromPreview(${catIndex}, this.previousElementSibling.value, this.previousElementSibling)">+</button>
                        </div>
                    </div>
                `;
            });

            content.innerHTML = html;
            preview.style.display = 'block';
        }

        function updateCategoryName(catIndex, newName) {
            pendingTxtData.categories[catIndex].name = newName;
        }

        function removeCategory(catIndex) {
            pendingTxtData.categories.splice(catIndex, 1);
            if (pendingTxtData.categories.length === 0) {
                cancelImport();
                showToast('已删除所有分类', 'warning');
                return;
            }
            showImportPreview(pendingTxtData);
        }

        function editWord(element, catIndex, wordIndex) {
            const currentWord = pendingTxtData.categories[catIndex].words[wordIndex];
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'preview-edit-input';
            input.value = currentWord;
            input.onblur = () => saveWordEdit(element, catIndex, wordIndex, input.value);
            input.onkeypress = (e) => { if (e.key === 'Enter') saveWordEdit(element, catIndex, wordIndex, input.value); };
            element.replaceWith(input);
            input.focus();
        }

        function saveWordEdit(element, catIndex, wordIndex, newWord) {
            pendingTxtData.categories[catIndex].words[wordIndex] = newWord;
            element.textContent = newWord;
            element.onclick = () => editWord(element, catIndex, wordIndex);
        }

        function addWordFromPreview(catIndex, word, inputEl) {
            if (!word.trim()) return;
            pendingTxtData.categories[catIndex].words.push(word.trim());
            showImportPreview(pendingTxtData);
        }

        function confirmTxtImport() {
            if (!pendingTxtData) return;

            importTxtData(pendingTxtData);
            pendingTxtData = null;
            document.getElementById('importPreview').style.display = 'none';
            document.getElementById('importModal').classList.remove('active');
        }

        function cancelImport() {
            pendingTxtData = null;
            document.getElementById('importPreview').style.display = 'none';
            document.getElementById('csvFormatHint').style.display = 'none';
        }

        // 解析CSV格式
        function parseCsvToThesaurus(content) {
            const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l);
            const categories = [];

            // 检测CSV分隔符
            const detectDelimiter = (line) => {
                const commas = (line.match(/,/g) || []).length;
                const semicolons = (line.match(/;/g) || []).length;
                const tabs = (line.match(/\t/g) || []).length;
                
                if (tabs > commas && tabs > semicolons) return '\t';
                if (semicolons > commas) return ';';
                return ',';
            };

            if (lines.length === 0) {
                return { categories: [] };
            }

            const delimiter = detectDelimiter(lines[0]);

            lines.forEach(line => {
                // 解析CSV行，处理引号包裹的值
                const cells = parseCSVLine(line, delimiter);
                
                if (cells.length === 0) return;

                const categoryName = cells[0].trim();
                
                // 把单元格按顿号、逗号再次拆分
                const words = cells.slice(1).flatMap(w => {
                    return w.split(/[、,，]/).map(word => word.trim()).filter(word => word);
                });

                if (categoryName && words.length > 0) {
                    categories.push({ name: categoryName, words: words });
                } else if (words.length > 0 && !categoryName) {
                    // 整行都是词汇，没有分类名
                    categories.push({ name: '导入词汇', words: words });
                }
            });

            return { categories };
        }

        // 解析CSV单行（处理引号）
        function parseCSVLine(line, delimiter = ',') {
            const result = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];

                if (char === '"') {
                    if (inQuotes && line[i + 1] === '"') {
                        // 转义的引号
                        current += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === delimiter && !inQuotes) {
                    result.push(current);
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current);

            return result;
        }

        function parseTxtToThesaurus(content) {
            const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l);
            const categories = [];
            let currentCategory = null;
            let currentWords = [];

            lines.forEach(line => {
                // 检测是否为分类名行（以冒号结尾）
                const isCategoryLine = line.endsWith(':');

                if (isCategoryLine) {
                    // 保存上一个分类
                    if (currentCategory && currentWords.length > 0) {
                        categories.push({ name: currentCategory, words: currentWords });
                    }
                    // 开始新分类
                    currentCategory = line.replace(/:/g, '').trim();
                    currentWords = [];

                    // 如果冒号后面还有内容，按顿号、逗号分隔
                    const afterColon = line.substring(line.indexOf(':') + 1);
                    if (afterColon.trim()) {
                        currentWords = afterColon.split(/[、,，]/).map(w => w.trim()).filter(w => w);
                    }
                } else if (line.includes('、') || line.includes(',')) {
                    // 单行包含多个顿号或逗号分隔的词
                    const words = line.split(/[、,，]/).map(w => w.trim()).filter(w => w);
                    if (currentCategory) {
                        currentWords = currentWords.concat(words);
                    } else {
                        // 没有分类名，创建一个默认分类
                        currentCategory = '导入词汇';
                        currentWords = words;
                    }
                } else {
                    // 单个词
                    if (currentCategory) {
                        currentWords.push(line);
                    } else {
                        currentCategory = '导入词汇';
                        currentWords.push(line);
                    }
                }
            });

            // 保存最后一个分类
            if (currentCategory && currentWords.length > 0) {
                categories.push({ name: currentCategory, words: currentWords });
            }

            return { categories, originalContent: content };
        }

        function importTxtData(result) {
            const existingThesaurus = getThesaurus();
            let addedCount = 0;

            result.categories.forEach(cat => {
                const existing = existingThesaurus.find(c => c.name === cat.name);
                if (existing) {
                    // 合并词汇（用文本去重，兼容分层词对象）
                    const textMap = new Map();
                    existing.words.forEach(w => textMap.set(getWordText(w), w));
                    cat.words.forEach(w => {
                        if (!textMap.has(getWordText(w))) {
                            textMap.set(getWordText(w), w);
                        }
                    });
                    existing.words = Array.from(textMap.values());
                } else {
                    // 添加新分类
                    existingThesaurus.push({
                        id: generateId(),
                        name: cat.name,
                        words: cat.words
                    });
                }
                addedCount++;
            });

            saveThesaurus(existingThesaurus);
            renderCategories();
            closeImportModal();
            showToast(`成功导入 ${addedCount} 个分类`, 'success');
        }

        function handleFileImport(event) {
            const file = event.target.files[0];
            if (!file) return;

            const ext = file.name.split('.').pop().toLowerCase();
            const reader = new FileReader();

            reader.onload = (e) => {
                const content = e.target.result;

                if (ext === 'json') {
                    // JSON 文件：直接导入
                    try {
                        const data = JSON.parse(content);
                        performImport(data);
                    } catch (err) {
                        showToast('JSON 格式错误：' + err.message, 'error');
                    }
                } else {
                    // TXT/CSV 文件：预览后导入
                    pendingFileName = file.name;
                    showTxtPreview(content);
                }
            };
            reader.readAsText(file);

            // Reset file input
            event.target.value = '';
        }

        function performImport(data) {
            const modeRadio = document.querySelector('input[name="importMode"]:checked');
            const isReplace = modeRadio && modeRadio.value === 'replace';

            if (isReplace) {
                if (!confirm('替换模式将清空当前所有数据（词库、公式、尺寸等），确定要替换吗？\n\n此操作不可撤销，建议先导出备份。')) {
                    return;
                }
                localStorage.clear();
                currentSelections = {};
                currentFormulaId = null;
                currentSize = null;
                currentSizeLabel = null;
                currentSizeIsCustom = false;
                customSizeApplied = false;
                currentSizeTabId = 'tab_jfb';
                editingTabId = null;
                modelResults = {};
                modelFed = false;
                fedPromptHash = '';
                currentModelId = null;
            }

            // Import formulas
            if (data.formulas && Array.isArray(data.formulas)) {
                if (isReplace) {
                    saveFormulas(data.formulas.map(f => ({ ...f })));
                } else {
                    const existingFormulas = getFormulas();
                    const existingIds = new Set(existingFormulas.map(f => f.id));
                    data.formulas.forEach(f => {
                        if (!existingIds.has(f.id)) {
                            existingFormulas.push(f);
                        }
                    });
                    saveFormulas(existingFormulas);
                }
            }

            // Import thesaurus
            if (data.thesaurus && Array.isArray(data.thesaurus)) {
                if (isReplace) {
                    saveThesaurus(data.thesaurus.map(c => ({ ...c, words: [...c.words] })));
                } else {
                    const existingThesaurus = getThesaurus();
                    data.thesaurus.forEach(cat => {
                        const existing = existingThesaurus.find(c => c.name === cat.name);
                        if (existing) {
                            const textMap = new Map();
                            existing.words.forEach(w => textMap.set(getWordText(w), w));
                            cat.words.forEach(w => {
                                if (!textMap.has(getWordText(w))) {
                                    textMap.set(getWordText(w), w);
                                }
                            });
                            existing.words = Array.from(textMap.values());
                        } else {
                            existingThesaurus.push(cat);
                        }
                    });
                    saveThesaurus(existingThesaurus);
                }
            }

            // Import thesaurus defaults
            if (data.thesaurusDefaults && typeof data.thesaurusDefaults === 'object') {
                if (isReplace) {
                    const defaults = {};
                    Object.entries(data.thesaurusDefaults).forEach(([name, words]) => {
                        if (Array.isArray(words) && words.length > 0) {
                            defaults[name] = [...words];
                        }
                    });
                    saveThesaurusDefaults(defaults);
                } else {
                    const existingDefaults = getThesaurusDefaults();
                    Object.entries(data.thesaurusDefaults).forEach(([name, words]) => {
                        if (Array.isArray(words) && words.length > 0) {
                            existingDefaults[name] = words;
                        }
                    });
                    saveThesaurusDefaults(existingDefaults);
                }
            }

            // Import sizeTabs
            if (data.sizeTabs && Array.isArray(data.sizeTabs)) {
                if (isReplace) {
                    saveSizeTabs(data.sizeTabs.map(t => ({ ...t, entries: (t.entries || []).map(e => ({ ...e })) })));
                } else {
                    const existingTabs = getSizeTabs();
                    const existingIds = new Set(existingTabs.map(t => t.id));
                    data.sizeTabs.forEach(tab => {
                        if (existingIds.has(tab.id)) {
                            const existing = existingTabs.find(t => t.id === tab.id);
                            if (existing) {
                                existing.name = tab.name;
                                existing.type = tab.type;
                                const mergedEntries = [...existing.entries];
                                (tab.entries || []).forEach(entry => {
                                    const key = entry.size || entry.ratio;
                                    if (!mergedEntries.some(e => (e.size || e.ratio) === key)) {
                                        mergedEntries.push({ ...entry });
                                    }
                                });
                                existing.entries = mergedEntries;
                            }
                        } else {
                            existingTabs.push({ ...tab, entries: (tab.entries || []).map(e => ({ ...e })) });
                        }
                    });
                    saveSizeTabs(existingTabs);
                }
            }

            // 保存版本号
            localStorage.setItem('data-version', DATA_VERSION);

            renderFormulas();
            renderCategories();
            renderSizeTabs();
            renderSizeGrid();
            updateFormulaSelect();
            closeImportModal();

            const modeLabel = isReplace ? '（替换模式）' : '（合并模式）';
            showToast('数据导入成功 ' + modeLabel, 'success');
        }

        // ==================== Version History (公式版本记录) - Cloud + Local ====================
        const VERSION_STORAGE_KEY = 'formula-version-history';
        let _versionsCache = null;
        let _versionsLoaded = false;

        async function getVersionHistoryAsync() {
            if (_versionsLoaded && _versionsCache !== null) return JSON.parse(JSON.stringify(_versionsCache));
            const ok = await waitForCloud();
            const userId = getEffectiveUserId();
            if (ok && userId) {
                try {
                    const { data, error } = await supabaseClient
                        .from('version_snapshots')
                        .select('*')
                        .eq('user_id', userId)
                        .order('timestamp', { ascending: false })
                        .limit(50);
                    if (!error && data) {
                        _versionsCache = data.map(r => ({
                            id: r.id,
                            timestamp: r.timestamp,
                            label: r.label,
                            formulas: r.snapshot_data.formulas || [],
                            thesaurus: r.snapshot_data.thesaurus || [],
                            formulaCount: r.formula_count,
                            thesaurusCount: r.thesaurus_count,
                            totalWords: r.total_words
                        }));
                        _versionsLoaded = true;
                        saveData(VERSION_STORAGE_KEY, _versionsCache);
                        return JSON.parse(JSON.stringify(_versionsCache));
                    }
                } catch (e) {
                    console.warn('[Versions] 云端读取失败，使用本地缓存:', e.message);
                }
            }
            _versionsCache = loadData(VERSION_STORAGE_KEY, []);
            _versionsLoaded = true;
            return JSON.parse(JSON.stringify(_versionsCache));
        }

        function getVersionHistory() {
            if (_versionsLoaded && _versionsCache !== null) return JSON.parse(JSON.stringify(_versionsCache));
            return loadData(VERSION_STORAGE_KEY, []);
        }

        async function saveVersionHistoryAsync(versions) {
            const trimmed = versions.length > 50 ? versions.slice(0, 50) : versions;
            _versionsCache = JSON.parse(JSON.stringify(trimmed));
            _versionsLoaded = true;
            saveData(VERSION_STORAGE_KEY, trimmed);
            const ok = await waitForCloud(3000);
            const userId = getEffectiveUserId();
            if (ok && userId) {
                try {
                    await supabaseClient.from('version_snapshots').delete().eq('user_id', userId);
                    const rows = trimmed.map(v => ({
                        id: v.id,
                        user_id: userId,
                        label: v.label,
                        snapshot_data: { formulas: v.formulas, thesaurus: v.thesaurus },
                        formula_count: v.formulaCount,
                        thesaurus_count: v.thesaurusCount,
                        total_words: v.totalWords,
                        timestamp: v.timestamp
                    }));
                    if (rows.length > 0) {
                        const { error } = await supabaseClient.from('version_snapshots').insert(rows);
                        if (error) console.warn('[Versions] 云端保存失败:', error.message);
                    }
                } catch (e) {
                    console.warn('[Versions] 云端保存异常:', e.message);
                }
            }
        }

        function saveVersionHistory(versions) {
            const trimmed = versions.length > 50 ? versions.slice(0, 50) : versions;
            _versionsCache = JSON.parse(JSON.stringify(trimmed));
            _versionsLoaded = true;
            saveData(VERSION_STORAGE_KEY, trimmed);
            saveVersionHistoryAsync(trimmed).catch(() => {});
        }

        async function createVersionSnapshot() {
            const formulas = getFormulas();
            if (formulas.length === 0) {
                showToast('没有公式可记录', 'warning');
                return;
            }

            const thesaurus = getThesaurus();
            const versionId = generateId();

            // 先从云端获取最新版本列表来计算序号
            const versions = await getVersionHistoryAsync();
            const seq = versions.length + 1;
            const formulaNames = formulas.map(f => f.name).join('、');

            const snapshot = {
                id: versionId,
                timestamp: Date.now(),
                label: `v${seq} · ${formulaNames}`,
                formulas: JSON.parse(JSON.stringify(formulas)),
                thesaurus: JSON.parse(JSON.stringify(thesaurus)),
                formulaCount: formulas.length,
                thesaurusCount: thesaurus.length,
                totalWords: thesaurus.reduce((sum, c) => sum + c.words.length, 0)
            };

            versions.unshift(snapshot);
            await saveVersionHistoryAsync(versions);
            renderVersionHistoryList();
            showToast(`版本 v${seq} 已保存（已同步到云端）`, 'success');
        }

        function openVersionHistory() {
            renderVersionHistoryList();
            document.getElementById('versionHistoryModal').classList.add('active');
        }

        function closeVersionHistory() {
            document.getElementById('versionHistoryModal').classList.remove('active');
        }

        async function renderVersionHistoryList() {
            const versions = await getVersionHistoryAsync();
            const container = document.getElementById('versionHistoryList');

            if (versions.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="padding: 2rem;">
                        <p>暂无版本记录</p>
                        <p style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.5rem;">点击「手动创建快照」保存当前公式和词库状态到云端</p>
                    </div>`;
                return;
            }

            container.innerHTML = versions.map((v, idx) => {
                const time = formatTime(v.timestamp);
                const label = v.label || `版本 ${idx + 1}`;
                const isLatest = idx === 0;
                return `
                <div class="version-item" style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;background:var(--surface);border-radius:10px;border:1px solid ${isLatest ? 'var(--primary)' : 'var(--border)'};transition:all 0.2s ease;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:600;font-size:0.9rem;color:var(--text-primary);display:flex;align-items:center;gap:0.5rem;">
                            ${escapeHtml(label)}
                            ${isLatest ? '<span class="badge" style="background:var(--primary);color:#fff;">最新</span>' : ''}
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-secondary);margin-top:0.25rem;">
                            ${time} · ${v.formulaCount}个公式 · ${v.thesaurusCount}个分类 · ${v.totalWords}个词
                        </div>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="previewVersionSnapshot('${v.id}')" title="预览快照内容">预览</button>
                    <button class="btn btn-primary btn-sm" onclick="restoreVersionSnapshot('${v.id}')" title="恢复到此版本">恢复</button>
                    <button class="btn btn-ghost btn-sm" onclick="deleteVersionSnapshot('${v.id}')" title="删除此版本" style="color:var(--error);">删除</button>
                </div>`;
            }).join('');
        }

        function previewVersionSnapshot(versionId) {
            getVersionHistoryAsync().then(versions => {
                const v = versions.find(x => x.id === versionId);
                if (!v) return;

                const formulaText = v.formulas.map(f =>
                    `【${f.name}】\n${f.template}`
                ).join('\n\n');

                const thesaurusText = v.thesaurus.map(c =>
                    `[${c.name}] ${c.words.map(w => {
                        const text = getWordText(w);
                        const children = getWordChildren(w);
                        return children.length > 0 ? `${text}{${children.join('、')}}` : text;
                    }).join('、')}`
                ).join('\n');

                const preview = `=== 公式 (${v.formulaCount}个) ===\n${formulaText}\n\n=== 词库 (${v.thesaurusCount}个分类, ${v.totalWords}个词) ===\n${thesaurusText}`;

                alert(preview.substring(0, 1500) + (preview.length > 1500 ? '\n\n...内容过长已截断' : ''));
            });
        }

        async function restoreVersionSnapshot(versionId) {
            const versions = await getVersionHistoryAsync();
            const v = versions.find(x => x.id === versionId);
            if (!v) return;

            const label = v.label || '该版本';
            if (!confirm(`确定要恢复到「${label}」吗？\n\n这将替换当前的公式和词库数据，当前状态会自动保存为新的快照（同步到云端）。`)) return;

            // 先保存当前状态为快照
            await createVersionSnapshotSilent();

            // 恢复数据
            saveFormulas(v.formulas);
            saveThesaurus(v.thesaurus);

            // 重置运行时状态
            currentSelections = {};
            currentFormulaId = null;
            currentSize = null;
            currentSizeLabel = null;
            currentSizeIsCustom = false;
            customSizeApplied = false;
            modelResults = {};
            modelFed = false;
            fedPromptHash = '';
            currentModelId = null;

            // 重新渲染
            renderFormulas();
            renderCategories();
            renderSizeTabs();
            renderSizeGrid();
            renderTitleLayout();
            updateFormulaSelect();
            document.getElementById('resultTextarea').value = '';
            invalidateModelCache();
            closeVersionHistory();

            showToast(`已恢复到「${label}」（已同步到云端）`, 'success');
        }

        async function createVersionSnapshotSilent() {
            const formulas = getFormulas();
            if (formulas.length === 0) return;
            const thesaurus = getThesaurus();
            const versions = await getVersionHistoryAsync();
            const seq = versions.length + 1;
            const formulaNames = formulas.map(f => f.name).join('、');
            versions.unshift({
                id: generateId(),
                timestamp: Date.now(),
                label: `v${seq} · ${formulaNames}`,
                formulas: JSON.parse(JSON.stringify(formulas)),
                thesaurus: JSON.parse(JSON.stringify(thesaurus)),
                formulaCount: formulas.length,
                thesaurusCount: thesaurus.length,
                totalWords: thesaurus.reduce((sum, c) => sum + c.words.length, 0)
            });
            await saveVersionHistoryAsync(versions);
        }

        async function deleteVersionSnapshot(versionId) {
            if (!confirm('确定要删除此版本记录吗？（云端同步删除）')) return;
            const versions = await getVersionHistoryAsync();
            const filtered = versions.filter(x => x.id !== versionId);
            await saveVersionHistoryAsync(filtered);
            renderVersionHistoryList();
            showToast('版本已删除（已同步到云端）', 'success');
        }

        // ==================== Utilities ====================
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // 用于onclick等属性值的转义（转义反引号）
        function escapeAttr(text) {
            return text.replace(/`/g, '&#96;').replace(/'/g, '&#39;');
        }

        function formatTime(timestamp) {
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;

            if (diff < 60000) return '刚刚';
            if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
            if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;

            return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        }

        function showToast(message, type = 'success') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;

            const labels = {
                success: '成功',
                error: '失败',
                warning: '注意',
                info: '提示'
            };

            toast.innerHTML = `
                <span class="toast-label">[${labels[type] || type}]</span>
                <span class="toast-message">${escapeHtml(message)}</span>
            `;

            container.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // ==================== Size Management ====================
        const DEFAULT_SIZE_TABS = [
            {
                id: 'tab_jfb',
                name: '聚福宝',
                type: 'size',
                entries: [
                    { id: 'sz_1', label: '常规尺寸', size: '710×280' },
                    { id: 'sz_2', label: '礼包尺寸', size: '710×320' },
                    { id: 'sz_3', label: '通栏尺寸', size: '750×420' },
                    { id: 'sz_4', label: '三拼大图尺寸', size: '345×520' },
                    { id: 'sz_5', label: '三拼小图尺寸', size: '345×250' }
                ]
            },
            {
                id: 'tab_ratio',
                name: '比例',
                type: 'ratio',
                entries: [
                    { id: 'rt_1', label: '1:1 方形', ratio: '1:1' },
                    { id: 'rt_2', label: '2:3 竖版', ratio: '2:3' },
                    { id: 'rt_3', label: '3:4 竖版海报', ratio: '3:4' },
                    { id: 'rt_4', label: '9:16 手机竖屏', ratio: '9:16' },
                    { id: 'rt_5', label: '16:9 横版视频', ratio: '16:9' },
                    { id: 'rt_6', label: '3:2 横版', ratio: '3:2' },
                    { id: 'rt_7', label: '4:3 标准', ratio: '4:3' },
                    { id: 'rt_8', label: '21:9 超宽', ratio: '21:9' }
                ]
            }
        ];

        function getSizeTabs() {
            return loadData(STORAGE_KEYS.SIZE_TABS, DEFAULT_SIZE_TABS.map(t => ({ ...t, entries: t.entries.map(e => ({ ...e })) })));
        }

        function saveSizeTabs(tabs) {
            saveData(STORAGE_KEYS.SIZE_TABS, tabs);
        }

        let currentSize = null;       // 当前选中的尺寸值，如 "710×280" 或 "16:9"
        let currentSizeLabel = null;  // 预留：当前选中的尺寸标签
        let currentSizeIsCustom = false;
        let customSizeApplied = false;  // 自定义尺寸是否已通过按钮确认应用
        let currentSizeTabId = 'tab_jfb';  // 当前激活的尺寸Tab ID
        let editingTabId = null;      // 正在编辑名称的Tab ID

        function renderSizeTabs() {
            const container = document.getElementById('sizeTabs');
            const tabs = getSizeTabs();
            const activeTab = tabs.find(t => t.id === currentSizeTabId);
            const isSizeType = activeTab && activeTab.type === 'size';

            container.innerHTML = tabs.map(tab => {
                const isEditing = editingTabId === tab.id;
                const tabClass = `size-tab ${currentSizeTabId === tab.id ? 'active' : ''} ${isEditing ? 'editing' : ''}`;
                if (isEditing) {
                    return `
                        <span class="${tabClass}">
                            <input class="tab-edit-input" id="tabEditInput_${tab.id}" value="${escapeHtml(tab.name)}"
                                   onblur="saveTabName('${tab.id}')" onkeydown="if(event.key==='Enter')saveTabName('${tab.id}')">
                        </span>`;
                }
                return `
                    <span class="${tabClass}" ondblclick="editTabName('${tab.id}')" title="双击编辑名称">
                        ${escapeHtml(tab.name)}
                        ${tabs.length > 1 ? `<span class="tab-delete" onclick="event.stopPropagation(); deleteSizeTab('${tab.id}')" title="删除此分类">✕</span>` : ''}
                    </span>`;
            }).join('') + (isSizeType ? '<span class="size-unit-label">单位：像素</span>' : '');

            // 给当前激活tab绑定点击
            container.querySelectorAll('.size-tab:not(.editing)').forEach(el => {
                const tabId = el.querySelector('.tab-delete')?.getAttribute('onclick')?.match(/deleteSizeTab\('([^']+)'\)/)?.[1]
                    || el.getAttribute('ondblclick')?.match(/editTabName\('([^']+)'\)/)?.[1];
                if (tabId) {
                    el.addEventListener('click', (e) => {
                        if (!e.target.closest('.tab-delete')) {
                            switchSizeTab(tabId);
                        }
                    });
                }
            });
        }

        function switchSizeTab(tabId) {
            currentSizeTabId = tabId;
            editingTabId = null;
            renderSizeTabs();
            renderSizeGrid();
        }

        function editTabName(tabId) {
            editingTabId = tabId;
            renderSizeTabs();
            const input = document.getElementById(`tabEditInput_${tabId}`);
            if (input) {
                input.focus();
                input.select();
            }
        }

        function saveTabName(tabId) {
            const input = document.getElementById(`tabEditInput_${tabId}`);
            if (!input) return;
            const newName = input.value.trim();
            const tabs = getSizeTabs();
            const tab = tabs.find(t => t.id === tabId);
            if (tab && newName && newName !== tab.name) {
                if (tabs.some(t => t.id !== tabId && t.name === newName)) {
                    showToast('名称已存在', 'error');
                    editingTabId = null;
                    renderSizeTabs();
                    return;
                }
                tab.name = newName;
                saveSizeTabs(tabs);
            }
            editingTabId = null;
            renderSizeTabs();
        }

        function addSizeTab() {
            const name = prompt('请输入新分类名称：');
            if (!name || !name.trim()) return;
            const tabs = getSizeTabs();
            if (tabs.some(t => t.name === name.trim())) {
                showToast('名称已存在', 'error');
                return;
            }
            const newTab = {
                id: generateId(),
                name: name.trim(),
                type: 'size',
                entries: []
            };
            tabs.push(newTab);
            saveSizeTabs(tabs);
            currentSizeTabId = newTab.id;
            renderSizeTabs();
            renderSizeGrid();
        }

        function deleteSizeTab(tabId) {
            const tabs = getSizeTabs();
            if (tabs.length <= 1) {
                showToast('至少保留一个分类', 'warning');
                return;
            }
            if (!confirm('确定要删除这个分类吗？该分类下的所有尺寸也会被删除。')) return;

            // 先保存被删Tab的数据，用于后续检查
            const deletedTab = tabs.find(t => t.id === tabId);
            const idx = tabs.findIndex(t => t.id === tabId);
            tabs.splice(idx, 1);
            saveSizeTabs(tabs);

            if (currentSizeTabId === tabId) {
                currentSizeTabId = tabs[0].id;
            }

            // 如果当前选中的尺寸来自被删除的tab，清除选择
            if (deletedTab && currentSize && !currentSizeIsCustom) {
                const stillExists = deletedTab.entries.some(e => (e.size || e.ratio) === currentSize);
                if (stillExists) {
                    currentSize = null;
                    currentSizeLabel = null;
                    currentSizeIsCustom = false;
                }
            }

            renderSizeTabs();
            renderSizeGrid();
            updateResult();
        }

        function renderSizeGrid() {
            const container = document.getElementById('sizeGrid');
            const tabs = getSizeTabs();
            const tab = tabs.find(t => t.id === currentSizeTabId);
            if (!tab) { container.innerHTML = ''; return; }

            const entries = tab.entries || [];
            let html = '';

            if (tab.type === 'ratio') {
                // 比例类型：每行显示一个比例按钮
                html = entries.map(e => {
                    const value = e.ratio;
                    const isSelected = !currentSizeIsCustom && currentSize === value;
                    return `
                        <button class="size-btn ${isSelected ? 'selected' : ''}"
                                onclick="selectSizeEntry('${e.id}', '${escapeAttr(value)}', '${escapeAttr(e.label)}')"
                                title="${escapeHtml(e.label)}">
                            <span>${escapeHtml(e.label)}</span>
                            <span class="size-value">${escapeHtml(value)}</span>
                            <span class="size-remove" onclick="event.stopPropagation(); deleteSizeEntry('${e.id}')">✕</span>
                        </button>`;
                }).join('');
            } else {
                // 尺寸类型：两列网格排列
                html = entries.map(e => {
                    const value = e.size;
                    const isSelected = !currentSizeIsCustom && currentSize === value;
                    return `
                        <button class="size-btn ${isSelected ? 'selected' : ''}"
                                onclick="selectSizeEntry('${e.id}', '${escapeAttr(value)}', '${escapeAttr(e.label)}')"
                                title="${escapeHtml(e.label)}">
                            <span>${escapeHtml(e.label)}</span>
                            <span class="size-value">${escapeHtml(value)}</span>
                            <span class="size-remove" onclick="event.stopPropagation(); deleteSizeEntry('${e.id}')">✕</span>
                        </button>`;
                }).join('');
            }

            container.innerHTML = html;

            // 更新自定义输入框
            if (currentSizeIsCustom && currentSize) {
                const parts = currentSize.split('×');
                document.getElementById('customWidth').value = parts[0] || '';
                document.getElementById('customHeight').value = parts[1] || '';
            } else if (!currentSize) {
                document.getElementById('customWidth').value = '';
                document.getElementById('customHeight').value = '';
            }
        }

        function selectSizeEntry(entryId, value, label) {
            if (!currentSizeIsCustom && currentSize === value) {
                currentSize = null;
                currentSizeLabel = null;
            } else {
                currentSize = value;
                currentSizeLabel = label;
                currentSizeIsCustom = false;
            }
            // 选择预设尺寸时，重置自定义按钮状态
            customSizeApplied = false;
            document.getElementById('customWidth').value = '';
            document.getElementById('customHeight').value = '';
            updateCustomBtn();
            renderSizeGrid();
            updateResult();
        }

        function deleteSizeEntry(entryId) {
            const tabs = getSizeTabs();
            const tab = tabs.find(t => t.id === currentSizeTabId);
            if (!tab) return;
            const entry = tab.entries.find(e => e.id === entryId);
            if (!entry) return;
            if (!confirm(`确定删除「${entry.label}」吗？`)) return;

            const value = entry.size || entry.ratio;
            tab.entries = tab.entries.filter(e => e.id !== entryId);
            saveSizeTabs(tabs);

            // 如果当前选中这个被删的条目，清除选择
            if (!currentSizeIsCustom && currentSize === value) {
                currentSize = null;
                currentSizeLabel = null;
            }
            renderSizeGrid();
            updateResult();
        }

        function addSizeEntry() {
            const tabs = getSizeTabs();
            const tab = tabs.find(t => t.id === currentSizeTabId);
            if (!tab) return;

            if (tab.type === 'ratio') {
                const input = prompt('请输入比例（格式：宽:高，如 16:9）：');
                if (!input || !input.trim()) return;
                const parts = input.trim().split(':');
                if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
                    showToast('格式错误，请使用 宽:高 格式', 'error');
                    return;
                }
                const ratio = `${parts[0]}:${parts[1]}`;
                if (tab.entries.some(e => e.ratio === ratio)) {
                    showToast('此比例已存在', 'warning');
                    return;
                }
                tab.entries.push({ id: generateId(), label: `${ratio} 比例`, ratio });
            } else {
                const label = prompt('请输入尺寸名称（如：主图 800×800）：');
                if (!label || !label.trim()) return;
                const size = prompt('请输入尺寸（格式：宽×高，如 800×800）：');
                if (!size || !size.trim()) return;
                const parts = size.trim().split('×');
                if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
                    showToast('格式错误，请使用 宽×高 格式', 'error');
                    return;
                }
                const sizeValue = `${parts[0]}×${parts[1]}像素`;
                if (tab.entries.some(e => e.size === sizeValue)) {
                    showToast('此尺寸已存在', 'warning');
                    return;
                }
                tab.entries.push({ id: generateId(), label: label.trim(), size: sizeValue });
            }

            saveSizeTabs(tabs);
            renderSizeGrid();
        }

        function clearSizeSelection() {
            currentSize = null;
            currentSizeLabel = null;
            currentSizeIsCustom = false;
            customSizeApplied = false;
            document.getElementById('customWidth').value = '';
            document.getElementById('customHeight').value = '';
            updateCustomBtn();
            renderSizeGrid();
            updateResult();
        }

        function updateCustomBtn() {
            const btn = document.getElementById('customSizeBtn');
            if (!btn) return;
            if (customSizeApplied) {
                btn.textContent = '取消';
                btn.className = 'size-custom-btn cancel';
            } else {
                btn.textContent = '使用';
                btn.className = 'size-custom-btn';
            }
        }

        function toggleCustomSize() {
            const w = parseInt(document.getElementById('customWidth').value) || 0;
            const h = parseInt(document.getElementById('customHeight').value) || 0;

            if (customSizeApplied) {
                // 取消：清除自定义尺寸
                currentSize = null;
                currentSizeLabel = null;
                currentSizeIsCustom = false;
                customSizeApplied = false;
                updateCustomBtn();
                renderSizeGrid();
                updateResult();
                return;
            }

            if (w <= 0 || h <= 0) {
                showToast('请先输入有效的宽度和高度', 'warning');
                return;
            }

            // 使用：应用自定义尺寸
            currentSize = `${w}×${h}`;
            currentSizeLabel = '自定义';
            currentSizeIsCustom = true;
            customSizeApplied = true;
            updateCustomBtn();
            renderSizeGrid();
            updateResult();
        }

        // ==================== Initialization ====================
        const DATA_VERSION = 'v20';

        // 提取默认公式模板（避免重复定义）
        function getDefaultFormulas() {
            return [{
                id: generateId(),
                name: '电商广告设计公式',
                template: '{{广告背景}}，{{广告氛围}}，{{主要内容}}，{{展示状态}}，{{场景}}，{{风格}}，{{色彩}}，{{质感}}，{{光影}}，{{构图}}，{{画质}}，{{广告标题}}，{{促销文案}}，{{后期}}，{{负面提示词}}',
                createdAt: Date.now()
            }, {
                id: generateId(),
                name: '图标设计公式',
                template: '{{图标主体}}，{{图标类型}}，{{设计风格}}，{{色彩方案}}，{{线条粗细}}，{{细节程度}}，{{背景处理}}，{{视角角度}}，{{特殊效果}}，{{画质输出}}，{{负面提示词}}',
                createdAt: Date.now() + 1
            }, {
                id: generateId(),
                name: '创意海报设计公式',
                template: '{{海报主题}}，{{视觉风格}}，{{主体元素}}，{{色彩搭配}}，{{排版布局}}，{{文字设计}}，{{背景氛围}}，{{图形元素}}，{{装饰点缀}}，{{光影效果}}，{{质感材质}}，{{画质输出}}，{{负面提示词}}',
                createdAt: Date.now() + 2
            }, {
                id: generateId(),
                name: 'Logo设计公式',
                template: '{{Logo类型}}，{{品牌名称}}，{{设计风格}}，{{图形元素}}，{{色彩方案}}，{{字体风格}}，{{构成方式}}，{{造型手法}}，{{背景底衬}}，{{质感效果}}，{{画质输出}}，{{负面提示词}}',
                createdAt: Date.now() + 3
            }, {
                id: generateId(),
                name: '人像写真公式',
                template: '{{人物特征}}，{{姿势动作}}，{{服装造型}}，{{妆发造型}}，{{场景环境}}，{{光线布光}}，{{拍摄角度}}，{{镜头焦段}}，{{色调风格}}，{{情绪氛围}}，{{构图方式}}，{{画质输出}}，{{负面提示词}}',
                createdAt: Date.now() + 4
            }, {
                id: generateId(),
                name: '封面包装设计公式',
                template: '{{包装类型}}，{{产品类别}}，{{设计风格}}，{{色彩方案}}，{{材质工艺}}，{{图案元素}}，{{文字排版}}，{{展示角度}}，{{光影效果}}，{{背景环境}}，{{画质输出}}，{{负面提示词}}',
                createdAt: Date.now() + 5
            }];
        }

        // 提取默认词库初始化（根据默认公式变量动态生成，回退到硬编码词库）
        function getDefaultThesaurus() {
            const defaultFormulas = getDefaultFormulas();
            const allCategories = new Set();
            defaultFormulas.forEach(f => {
                parseVariables(f.template).forEach(v => allCategories.add(v.category));
            });
            
            const thesaurus = [];
            allCategories.forEach(catName => {
                const defaultWords = getCategoryDefaultWords(catName);
                thesaurus.push({
                    id: generateId(),
                    name: catName,
                    words: [...defaultWords]
                });
            });
            return thesaurus;
        }

        function fallbackToLocalData() {
            const existingFormulas = getFormulas();
            const existingThesaurus = getThesaurus();
            if (existingFormulas.length === 0) {
                saveFormulas(getDefaultFormulas());
            }
            if (existingThesaurus.length === 0) {
                saveThesaurus(getDefaultThesaurus());
            }
        }

        async function init() {
            // 首先初始化 Supabase 连接（等待连接建立）
            console.log('[Init] 开始初始化，连接 Supabase...');
            const supabaseReady = await initSupabase();
            console.log('[Init] Supabase 初始化结果:', supabaseReady, '用户:', currentUser ? currentUser.email : '未登录');

            // 确保未登录时显示登录按钮
            if (!currentUser) updateAuthUI(null);

            // 版本检测：新版本进行数据迁移（不再清空全部数据！）
            const savedVersion = localStorage.getItem('data-version');
            if (savedVersion !== DATA_VERSION) {
                console.log(`[Init] 版本升级: ${savedVersion || '首次'} → ${DATA_VERSION}，执行数据迁移...`);
                // 不再使用 localStorage.clear()！只清除版本特定的缓存标记
                _formulasCache = null; _formulasLoaded = false;
                _thesaurusCache = null; _thesaurusLoaded = false;
                _versionsCache = null; _versionsLoaded = false;
                // 清除 Supabase 认证状态缓存（但保留数据）
                // 注意：不再清除 prompt-formulas, prompt-thesaurus 等用户数据
            }

            // 尝试从云端加载数据（仅登录用户可用云端）
            const cloudOk = supabaseReady && currentUser;

            if (cloudOk) {
                console.log('[Init] 已登录，从云端加载数据...');
                try {
                    const formulas = await getFormulasAsync();
                    const thesaurus = await getThesaurusAsync();
                    if (formulas.length === 0) {
                        // 云端无数据：尝试从本地恢复，本地也无数据则用默认
                        const localFormulas = loadData(getStorageKey(STORAGE_KEYS.FORMULAS), []);
                        if (localFormulas.length > 0) {
                            console.log('[Init] 云端无数据，将本地数据同步到云端');
                            saveFormulas(localFormulas);
                        } else {
                            saveFormulas(getDefaultFormulas());
                        }
                    }
                    if (thesaurus.length === 0) {
                        const localThesaurus = loadData(getStorageKey(STORAGE_KEYS.THESAURUS), []);
                        if (localThesaurus.length > 0) {
                            console.log('[Init] 云端无词库，将本地词库同步到云端');
                            saveThesaurus(localThesaurus);
                        } else {
                            saveThesaurus(getDefaultThesaurus());
                        }
                    }
                } catch (e) {
                    console.warn('[Init] 云端加载失败，使用本地数据:', e.message);
                    fallbackToLocalData();
                }
            } else {
                console.log('[Init] 未登录或云端不可用，使用本地数据');
                fallbackToLocalData();
            }

            // 初始化默认尺寸Tabs
            const existingSizeTabs = getSizeTabs();
            if (existingSizeTabs.length === 0) {
                saveSizeTabs(DEFAULT_SIZE_TABS.map(t => ({ ...t, entries: t.entries.map(e => ({ ...e })) })));
            }

            renderCategories();
            renderSizeTabs();
            renderSizeGrid();
            renderFormulas();
            renderTitleLayout();
            renderHistory();
            renderModelTabs();
            renderOptStatusBar();
            updateFormulaSelect(); // 初始化公式选择器

            // 保存数据版本号
            localStorage.setItem('data-version', DATA_VERSION);

            // Close modals on overlay click
            document.querySelectorAll('.modal-overlay').forEach(overlay => {
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {
                        overlay.classList.remove('active');
                    }
                });
            });

            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
                }
            });

            // 批量词汇输入实时预览
            const batchTextarea = document.getElementById('batchWords');
            if (batchTextarea) {
                batchTextarea.addEventListener('input', updateBatchHint);
            }

            // 云端同步状态提示
            if (cloudOk) {
                console.log('[Init] ✅ 云端存储已就绪，数据将跨设备同步');
                updateCloudStatus(true);
            } else {
                console.log('[Init] ⚠️ 使用本地存储模式，数据不会跨设备同步');
                updateCloudStatus(false);
            }
        }

        function updateCloudStatus(online) {
            const el = document.getElementById('cloudStatus');
            if (!el) return;
            if (online) {
                el.className = 'cloud-status online';
                el.textContent = '☁️ 云端已同步';
                el.title = '数据已同步到云端，可在其他设备上恢复';
                el.onclick = null;
            } else {
                el.className = 'cloud-status offline';
                el.textContent = '📡 本地模式';
                el.title = '云端未连接，点击重试链接云端';
                el.onclick = connectCloud;
            }
        }

        async function connectCloud() {
            const el = document.getElementById('cloudStatus');
            if (!el) return;
            // 如果已有用户，直接尝试同步
            if (currentUser) {
                el.textContent = '☁️ 同步中...';
                el.className = 'cloud-status online';
                try {
                    await reloadCloudData();
                    updateCloudStatus(true);
                    showToast('云端数据已同步！', 'success');
                } catch (e) {
                    updateCloudStatus(false);
                    showToast('云端同步失败: ' + e.message, 'error');
                }
                return;
            }
            // 未登录：提示登录
            showToast('请先登录以启用云端同步', 'warning');
            openAuthModal();
        }

        // Start app
        init();

        // ==================== 顶层视图切换 ====================
        let currentView = 'compose';

        function switchView(viewName) {
            if (currentView === viewName) return;
            currentView = viewName;
            
            // 更新 Tab 状态
            document.querySelectorAll('#navTabs .nav-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.view === viewName);
            });
            
            // 切换视图容器
            document.querySelectorAll('.view-container').forEach(c => c.classList.remove('active'));
            const targetView = viewName === 'compose' ? 'viewCompose' : 'viewImagePrompt';
            document.getElementById(targetView).classList.add('active');
            
            // 切换到图片反推视图时，渲染布局
            if (viewName === 'image-prompt') {
                renderImagePromptView();
            }
            // 切换回词汇组合视图时，刷新渲染确保数据最新
            if (viewName === 'compose') {
                refreshComposeView();
            }
        }

        function refreshComposeView() {
            // 重新渲染词汇组合视图的所有面板
            renderCategories();
            renderSizeTabs();
            renderSizeGrid();
            renderFormulas();
            renderTitleLayout();
            renderHistory();
            renderModelTabs();
            renderOptStatusBar();
            updateFormulaSelect();
        }

        function renderImagePromptView() {
            const container = document.getElementById('imagePromptLayout');
            if (!container) return;

            container.innerHTML = `
                <!-- 左侧：上传 + 模板 + 结果 -->
                <div class="left-panel">
                    <!-- 上传图片 -->
                    <div class="panel-card">
                        <div class="card-header">
                            <span class="card-title">上传图片</span>
                            <button class="btn btn-ghost btn-sm" onclick="clearImagePrompt()" title="清空">清空</button>
                        </div>
                        <div class="card-body">
                            <div class="upload-zone" id="uploadZone" onclick="document.getElementById('imageInput').click()">
                                <span class="upload-text">拖拽图片到这里或点击上传</span>
                                <span class="upload-hint">支持 JPG / PNG / WebP，最大 10MB</span>
                            </div>
                            <input type="file" id="imageInput" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleImageSelect(event)">
                            <div style="display:flex;align-items:center;gap:0.4rem;margin-top:0.5rem;">
                                <span style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;">或输入URL：</span>
                                <input type="text" id="imageUrlInput" placeholder="https://example.com/image.jpg" oninput="handleImageUrlInput()" style="flex:1;padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:6px;font-size:0.78rem;background:rgba(15,23,42,0.5);color:var(--text-primary);">
                            </div>
                        </div>
                    </div>

                    <!-- API Key 配置 -->
                    <div class="panel-card" id="apiConfigCard">
                        <div class="card-header">
                            <span class="card-title">API Key</span>
                            <span id="apiKeyStatus" style="font-size:0.72rem;"></span>
                        </div>
                        <div class="card-body">
                            <!-- 提供商选择 -->
                            <div id="providerSelector">
                                <button class="mini-btn active" data-provider="zhipu" onclick="switchImageProvider('zhipu', this)">智谱</button>
                                <button class="mini-btn" data-provider="gemini" onclick="switchImageProvider('gemini', this)">Gemini</button>
                                <button class="mini-btn" data-provider="kimi" onclick="switchImageProvider('kimi', this)">Kimi</button>
                                <button class="mini-btn" data-provider="qwen" onclick="switchImageProvider('qwen', this)">千问</button>
                                <button class="mini-btn" data-provider="groq" onclick="switchImageProvider('groq', this)">Groq</button>
                            </div>
                            <!-- 模型选择下拉框（按提供商动态显示） -->
                            <div id="zhipuModelSelector" style="margin-bottom:0.75rem;">
                                <select id="zhipuModelSelect" onchange="switchZhipuModel(this.value)" style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;background:rgba(15,23,42,0.5);color:var(--text-primary);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path fill=%22%2394a3b8%22 d=%22M6 8L1 3h10z%22/></svg>');background-repeat:no-repeat;background-position:right 0.75rem center;padding-right:2rem;">
                                    <option value="glm-4v-flash">GLM-4V-Flash（免费·不限量·速度快）</option>
                                    <option value="glm-4.1v-thinking-flash">GLM-4.1V-Thinking（免费·内置思维链推理）</option>
                                    <option value="glm-4.6v-flash">GLM-4.6V-Flash（免费·128K上下文·最新免费）</option>
                                    <option value="glm-4v-plus-0111">GLM-4V-Plus（付费·高级视觉·16K上下文）</option>
                                    <option value="glm-4.5v">GLM-4.5V（付费·MOE架构·64K上下文）</option>
                                    <option value="glm-4.6v">GLM-4.6V（付费·全能旗舰·128K上下文）</option>
                                    <option value="glm-5v-turbo">GLM-5V-Turbo（付费·5代·200K上下文·视觉编程）</option>
                                </select>
                            </div>
                            <!-- Gemini 模型选择 -->
                            <div id="geminiModelSelector" style="display:none;margin-bottom:0.75rem;">
                                <select id="geminiModelSelect" onchange="switchGeminiModel(this.value)" style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;background:rgba(15,23,42,0.5);color:var(--text-primary);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path fill=%22%2394a3b8%22 d=%22M6 8L1 3h10z%22/></svg>');background-repeat:no-repeat;background-position:right 0.75rem center;padding-right:2rem;">
                                    <option value="gemini-2.5-flash">Gemini 2.5 Flash（免费·每日1500次·最新）</option>
                                    <option value="gemini-2.0-flash">Gemini 2.0 Flash（免费·每日1500次）</option>
                                    <option value="gemini-2.5-pro">Gemini 2.5 Pro（付费·最强推理·每日50次免费）</option>
                                </select>
                            </div>
                            <!-- Kimi 模型选择 -->
                            <div id="kimiModelSelector" style="display:none;margin-bottom:0.75rem;">
                                <select id="kimiModelSelect" onchange="switchKimiModel(this.value)" style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;background:rgba(15,23,42,0.5);color:var(--text-primary);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path fill=%22%2394a3b8%22 d=%22M6 8L1 3h10z%22/></svg>');background-repeat:no-repeat;background-position:right 0.75rem center;padding-right:2rem;">
                                    <option value="kimi-k2.5">Kimi K2.5（多模态·256K上下文）</option>
                                </select>
                            </div>
                            <!-- 千问模型选择 -->
                            <div id="qwenModelSelector" style="display:none;margin-bottom:0.75rem;">
                                <select id="qwenModelSelect" onchange="switchQwenModel(this.value)" style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;background:rgba(15,23,42,0.5);color:var(--text-primary);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path fill=%22%2394a3b8%22 d=%22M6 8L1 3h10z%22/></svg>');background-repeat:no-repeat;background-position:right 0.75rem center;padding-right:2rem;">
                                    <option value="qwen3-vl-235b-a22b-thinking">Qwen3-VL-235B（最强视觉·思维链）</option>
                                    <option value="qwen3-vl-32b-thinking">Qwen3-VL-32B（高效视觉·思维链）</option>
                                    <option value="qwen3-vl-30b-a3b-thinking">Qwen3-VL-30B-A3B（轻量视觉·思维链）</option>
                                </select>
                            </div>
                            <!-- Groq 模型选择 -->
                            <div id="groqModelSelector" style="display:none;margin-bottom:0.75rem;">
                                <select id="groqModelSelect" onchange="switchGroqModel(this.value)" style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;background:rgba(15,23,42,0.5);color:var(--text-primary);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path fill=%22%2394a3b8%22 d=%22M6 8L1 3h10z%22/></svg>');background-repeat:no-repeat;background-position:right 0.75rem center;padding-right:2rem;">
                                    <option value="meta-llama/llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B（免费·通用视觉·128K）</option>
                                    <option value="meta-llama/llama-4-maverick-17b-128e-instruct">Llama 4 Maverick 17B（免费·复杂视觉推理·128K）</option>
                                    <option value="llava-v1.5-7b-4096-preview">LLaVA v1.5 7B（免费·轻量视觉·速度快）</option>
                                </select>
                            </div>
                            <!-- 模型提示 -->
                            <div id="modelHint" style="margin-bottom:0.75rem;font-size:0.72rem;color:var(--text-secondary);line-height:1.5;"></div>
                            <!-- 智谱 Key -->
                            <div id="zhipuKeyRow" style="display:flex;gap:0.5rem;align-items:flex-start;">
                                <div style="position:relative;flex:1;">
                                    <input type="password" id="zhipuApiKey" placeholder="粘贴智谱 GLM-4V API Key" oninput="updateApiKeyStatus()" style="width:100%;padding:0.5rem 2.5rem 0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;background:rgba(15,23,42,0.5);color:var(--text-primary);box-sizing:border-box;">
                                    <button onclick="toggleApiVisibility()" title="显示/隐藏" class="btn-toggle-visibility">显示</button>
                                </div>
                                <button class="btn btn-primary btn-sm" onclick="verifyAndSaveApiKey()" style="flex-shrink:0;white-space:nowrap;">验证并保存</button>
                            </div>
                            <!-- Gemini Key -->
                            <div id="geminiKeyRow" style="display:none;gap:0.5rem;align-items:flex-start;">
                                <div style="position:relative;flex:1;">
                                    <input type="password" id="geminiApiKey" placeholder="粘贴 Gemini API Key" oninput="updateApiKeyStatus()" style="width:100%;padding:0.5rem 3.2rem 0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;background:rgba(15,23,42,0.5);color:var(--text-primary);box-sizing:border-box;">
                                    <button onclick="toggleApiVisibility()" title="显示/隐藏" class="btn-toggle-visibility">显示</button>
                                </div>
                                <button class="btn btn-primary btn-sm" onclick="verifyAndSaveApiKey()" style="flex-shrink:0;white-space:nowrap;">验证并保存</button>
                            </div>
                            <!-- Kimi Key -->
                            <div id="kimiKeyRow" style="display:none;gap:0.5rem;align-items:flex-start;">
                                <div style="position:relative;flex:1;">
                                    <input type="password" id="kimiApiKey" placeholder="粘贴 Kimi API Key" oninput="updateApiKeyStatus()" style="width:100%;padding:0.5rem 3.2rem 0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;background:rgba(15,23,42,0.5);color:var(--text-primary);box-sizing:border-box;">
                                    <button onclick="toggleApiVisibility()" title="显示/隐藏" class="btn-toggle-visibility">显示</button>
                                </div>
                                <button class="btn btn-primary btn-sm" onclick="verifyAndSaveApiKey()" style="flex-shrink:0;white-space:nowrap;">验证并保存</button>
                            </div>
                            <!-- 千问 Key -->
                            <div id="qwenKeyRow" style="display:none;gap:0.5rem;align-items:flex-start;">
                                <div style="position:relative;flex:1;">
                                    <input type="password" id="qwenApiKey" placeholder="粘贴阿里百炼 API Key" oninput="updateApiKeyStatus()" style="width:100%;padding:0.5rem 3.2rem 0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;background:rgba(15,23,42,0.5);color:var(--text-primary);box-sizing:border-box;">
                                    <button onclick="toggleApiVisibility()" title="显示/隐藏" class="btn-toggle-visibility">显示</button>
                                </div>
                                <button class="btn btn-primary btn-sm" onclick="verifyAndSaveApiKey()" style="flex-shrink:0;white-space:nowrap;">验证并保存</button>
                            </div>
                            <!-- Groq Key -->
                            <div id="groqKeyRow" style="display:none;gap:0.5rem;align-items:flex-start;">
                                <div style="position:relative;flex:1;">
                                    <input type="password" id="groqApiKey" placeholder="粘贴 Groq API Key (gsk_...)" oninput="updateApiKeyStatus()" style="width:100%;padding:0.5rem 3.2rem 0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;background:rgba(15,23,42,0.5);color:var(--text-primary);box-sizing:border-box;">
                                    <button onclick="toggleApiVisibility()" title="显示/隐藏" class="btn-toggle-visibility">显示</button>
                                </div>
                                <button class="btn btn-primary btn-sm" onclick="verifyAndSaveApiKey()" style="flex-shrink:0;white-space:nowrap;">验证并保存</button>
                            </div>
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.5rem;" id="apiKeyLinks">
                                <a href="https://bigmodel.cn/usercenter/apikeys" target="_blank" style="font-size:0.72rem;color:var(--accent);text-decoration:none;" id="apiKeyLink">获取免费 API Key</a>
                                <span style="font-size:0.72rem;color:var(--text-muted);">仅保存在本地浏览器</span>
                            </div>
                        </div>
                    </div>

                    <!-- 反推结果 -->
                    <div class="panel-card">
                        <div class="card-header">
                            <span class="card-title">反推结果</span>
                            <div style="display:flex;gap:0.3rem;" id="ipResultActions">
                                <button class="mini-btn active" id="langZhBtn" onclick="switchResultLang('zh')" title="中文">中</button>
                                <button class="mini-btn" id="langEnBtn" onclick="switchResultLang('en')" title="英文">EN</button>
                                <button class="mini-btn" onclick="copyImageDescription()" title="复制">复制</button>
                                <button class="mini-btn primary" id="fillComposeBtn" onclick="fillResultToCompose()" title="提示词直出：直接填入结果区；关键词标签：智能匹配词库并自动选中词汇">填入组合</button>
                                <button class="mini-btn danger" onclick="clearImagePromptResult()" title="清空反推结果">清空</button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="mode-selector" id="promptModes">
                                <button class="mode-btn active" data-mode="prompt" onclick="setPromptMode('prompt', this)">提示词直出</button>
                                <button class="mode-btn" data-mode="keywords" onclick="setPromptMode('keywords', this)">关键词标签</button>
                            </div>
                            <textarea class="result-textarea" id="ipResultTextarea" placeholder="上传图片并点击「开始反推」，AI 将自动分析图片内容并生成提示词..." readonly></textarea>
                            <div class="result-meta">
                                <span id="resultCharCount">0 / 2000</span>
                                <span id="resultModelBadge"></span>
                            </div>
                            <button class="analyze-btn" id="analyzeBtn" disabled onclick="analyzeImage()">
                                <span id="analyzeBtnText">开始反推</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 右侧：历史记录 -->
                <div class="right-panel">
                    <div class="panel-header">
                        <span class="panel-title">历史记录</span>
                        <button class="btn btn-ghost btn-sm" onclick="clearImageHistory()" title="清空历史">清空</button>
                    </div>
                    <div class="panel-body" id="imageHistoryList">
                        <div class="history-empty">
                            <p>暂无历史记录</p>
                            <p style="font-size:0.8rem;margin-top:0.5rem;">反推结果将自动保存到这里</p>
                        </div>
                    </div>
                </div>
            `;

            // 恢复 API Key（5个提供商）
            ['zhipu','gemini','kimi','qwen','groq'].forEach(p => {
                const savedKey = localStorage.getItem(p + '_api_key');
                if (savedKey) {
                    const keyInput = document.getElementById(p + 'ApiKey');
                    if (keyInput) keyInput.value = savedKey;
                }
            });
            // 恢复上次选择的提供商
            const savedProvider = localStorage.getItem('image_provider') || 'zhipu';
            imagePromptState.apiProvider = savedProvider;
            restoreProviderUI(savedProvider);
            
            // 恢复各提供商的模型选择
            const savedZhipuModel = localStorage.getItem('zhipu_model') || 'glm-4v-flash';
            imagePromptState.zhipuModel = savedZhipuModel;
            const zhipuSelect = document.getElementById('zhipuModelSelect');
            if (zhipuSelect) zhipuSelect.value = savedZhipuModel;
            
            const savedGeminiModel = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
            imagePromptState.geminiModel = savedGeminiModel;
            const geminiSelect = document.getElementById('geminiModelSelect');
            if (geminiSelect) geminiSelect.value = savedGeminiModel;
            
            const savedKimiModel = localStorage.getItem('kimi_model') || 'kimi-k2.5';
            imagePromptState.kimiModel = savedKimiModel;
            const kimiSelect = document.getElementById('kimiModelSelect');
            if (kimiSelect) kimiSelect.value = savedKimiModel;
            
            const savedQwenModel = localStorage.getItem('qwen_model') || 'qwen3-vl-235b-a22b-thinking';
            imagePromptState.qwenModel = savedQwenModel;
            const qwenSelect = document.getElementById('qwenModelSelect');
            if (qwenSelect) qwenSelect.value = savedQwenModel;
            
            const savedGroqModel = localStorage.getItem('groq_model') || 'meta-llama/llama-4-scout-17b-16e-instruct';
            imagePromptState.groqModel = savedGroqModel;
            const groqSelect = document.getElementById('groqModelSelect');
            if (groqSelect) groqSelect.value = savedGroqModel;
            
            updateModelHint();
            
            updateApiKeyStatus();

            // 重新绑定拖拽事件
            rebindUploadEvents();

            // 恢复已上传的图片状态
            if (imagePromptState.imageBase64) {
                renderImagePreview(imagePromptState.imageBase64, imagePromptState.imageFile?.name || '');
                updateAnalyzeButton();
            }

            // 恢复已有结果
            if (imagePromptState.resultData) {
                renderImagePromptResults(imagePromptState.resultData);
            }

            // 渲染历史记录
            renderImageHistory();
        }

        function rebindUploadEvents() {
            const zone = document.getElementById('uploadZone');
            if (!zone || zone.classList.contains('has-image')) return;
            
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('drag-over');
            });
            zone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('drag-over');
            });
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('drag-over');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    handleImageFile(files[0]);
                }
            });
        }

        function renderImagePromptResults(data) {
            const textarea = document.getElementById('ipResultTextarea');
            const charCount = document.getElementById('resultCharCount');
            const modelBadge = document.getElementById('resultModelBadge');
            const resultActions = document.getElementById('ipResultActions');
            if (!textarea) return;

            // 模型名称映射
            const modelNames = {
                'glm-4v-flash': 'GLM-4V-Flash',
                'glm-4.1v-thinking-flash': '4.1V-Thinking',
                'glm-4.6v-flash': '4.6V-Flash',
                'glm-4v-plus-0111': 'GLM-4V-Plus',
                'glm-4.5v': 'GLM-4.5V',
                'glm-4.6v': 'GLM-4.6V',
                'glm-5v-turbo': 'GLM-5V-Turbo',
                'gemini-2.0-flash': 'Gemini 2.0 Flash'
            };
            const usedModel = data._modelUsed || '';
            const modelLabel = modelNames[usedModel] || usedModel;
            const modeLabel = data.mode === 'prompt' ? '提示词直出' : data.mode === 'prompt-en' ? '英文直出' : data.mode === 'keywords' ? '关键词标签' : data.mode === 'wand' ? '变体' : '描述';
            
            let text = '';
            if (data.mode === 'prompt' || data.mode === 'prompt-en') {
                text = data.description || '';
                if (modelBadge) modelBadge.textContent = `${modelLabel} · ${modeLabel}`;
                if (resultActions) resultActions.innerHTML = defaultResultActionsHTML();
            } else if (data.mode === 'keywords' && data.keywords && data.keywords.length > 0) {
                // 关键词模式：显示原始关键词列表 + 引导梳理
                if (data.categoryMap && Object.keys(data.categoryMap).length > 0) {
                    text = Object.entries(data.categoryMap).map(([cat, kws]) => `${cat}：${kws.join('、')}`).join('\n');
                } else {
                    text = data.keywords.join('、');
                }
                if (modelBadge) modelBadge.textContent = `${modelLabel} · ${modeLabel}`;
                // 关键词模式：显示「梳理关键词」+「添加到词库」按钮
                if (resultActions) resultActions.innerHTML = keywordsResultActionsHTML();
            } else if (data.mode === 'wand' && data.variants && data.variants.length > 0) {
                text = data.variants.map(v => `[${v.label}]\n${v.text}`).join('\n\n');
                if (modelBadge) modelBadge.textContent = `${modelLabel} · ${modeLabel}`;
                if (resultActions) resultActions.innerHTML = defaultResultActionsHTML();
            } else if (data.description) {
                text = data.description;
                if (modelBadge) modelBadge.textContent = `${modelLabel} · ${modeLabel}`;
                if (resultActions) resultActions.innerHTML = defaultResultActionsHTML();
            }

            textarea.value = text;
            textarea.readOnly = false;
            if (charCount) charCount.textContent = `${text.length} / 2000`;

            // 缓存当前语言结果
            if (imagePromptState.resultLang === 'zh') {
                imagePromptState.resultZh = text;
            } else {
                imagePromptState.resultEn = text;
            }

            // 保存到历史记录
            saveToImageHistory(data);
            renderImageHistory();
        }

        // 默认模式的操作按钮HTML：语言切换 + 复制 + 填入结果区 + 清空
        function defaultResultActionsHTML() {
            const zhActive = imagePromptState.resultLang === 'zh' ? ' active' : '';
            const enActive = imagePromptState.resultLang === 'en' ? ' active' : '';
            return `<button class="mini-btn${zhActive}" id="langZhBtn" onclick="switchResultLang('zh')" title="中文">中</button>
                <button class="mini-btn${enActive}" id="langEnBtn" onclick="switchResultLang('en')" title="英文">EN</button>
                <button class="mini-btn" onclick="copyImageDescription()" title="复制结果">复制</button>
                <button class="mini-btn primary" id="fillComposeBtn" onclick="fillResultToCompose()" title="将反推结果填入词汇组合">填入组合</button>
                <button class="mini-btn danger" onclick="clearImagePromptResult()" title="清空反推结果">清空</button>`;
        }

        // 关键词模式的操作按钮HTML：语言切换 + 梳理关键词 + 添加到词库 + 清空
        function keywordsResultActionsHTML() {
            const zhActive = imagePromptState.resultLang === 'zh' ? ' active' : '';
            const enActive = imagePromptState.resultLang === 'en' ? ' active' : '';
            return `<button class="mini-btn${zhActive}" id="langZhBtn" onclick="switchResultLang('zh')" title="中文">中</button>
                <button class="mini-btn${enActive}" id="langEnBtn" onclick="switchResultLang('en')" title="英文">EN</button>
                <button class="mini-btn primary" style="background:#8b5cf6;border-color:#8b5cf6;" id="organizeKeywordsBtn" onclick="organizeKeywordsByFormula()" title="AI 根据你的公式和词库，智能梳理关键词到对应分类">梳理关键词</button>
                <button class="mini-btn primary" style="background:#f59e0b;border-color:#f59e0b;" id="addToThesaurusBtn" onclick="addKeywordsToThesaurus()" title="将当前梳理结果中的所有新词汇批量添加到对应公式的词库">添加到词库</button>
                <button class="mini-btn danger" onclick="clearImagePromptResult()" title="清空反推结果">清空</button>`;
        }

        function copyImageDescription() {
            const textarea = document.getElementById('ipResultTextarea');
            if (textarea && textarea.value) {
                copyText(textarea.value, '已复制到剪贴板', textarea);
            } else {
                showToast('没有内容可复制', 'warning');
            }
        }

        // 清空反推结果
        function clearImagePromptResult() {
            const textarea = document.getElementById('ipResultTextarea');
            if (textarea) {
                textarea.value = '';
            }
            imagePromptState.resultData = null;
            imagePromptState.resultZh = '';
            imagePromptState.resultEn = '';
            // 重置字符计数
            const charCount = document.getElementById('resultCharCount');
            if (charCount) charCount.textContent = '0 / 2000';
            // 重置模型标识
            const modelBadge = document.getElementById('resultModelBadge');
            if (modelBadge) modelBadge.textContent = '';
            // 恢复默认操作按钮
            const resultActions = document.getElementById('ipResultActions');
            if (resultActions) {
                resultActions.innerHTML = defaultResultActionsHTML();
            }
            showToast('反推结果已清空', 'success');
        }

        function fillResultToCompose() {
            const resultData = imagePromptState.resultData;
            // 关键词标签模式：智能匹配词库并自动选中词汇
            if (resultData && resultData.mode === 'keywords' && resultData.categoryMap && Object.keys(resultData.categoryMap).length > 0) {
                matchAndSelectKeywords(resultData.categoryMap);
                return;
            }
            // 其他模式：直接填入结果文本框
            const textarea = document.getElementById('ipResultTextarea');
            if (textarea && textarea.value) {
                fillToResult(textarea.value);
            }
        }

        // 一键添加：将反推结果的所有词汇批量添加到对应公式的词库分类中
        // 梳理关键词：调用AI根据用户的公式和词库，将反推关键词重新梳理成公式分组格式
        async function organizeKeywordsByFormula() {
            const resultData = imagePromptState.resultData;
            if (!resultData || !resultData.keywords || resultData.keywords.length === 0) {
                showToast('没有可梳理的关键词数据，请先进行图片反推', 'warning');
                return;
            }

            const formulas = getFormulas();
            if (formulas.length === 0) {
                showToast('没有可用公式，请先在词汇组合中创建公式', 'warning');
                return;
            }

            const thesaurus = getThesaurus();

            // 构建公式和词库的描述信息给AI
            const formulasDesc = formulas.map(f => {
                const vars = parseVariables(f.template).map(v => v.category);
                return `公式「${f.name}」的分类：${vars.join('、')}`;
            }).join('\n');

            const thesaurusDesc = thesaurus.map(cat => {
                const words = cat.words.map(w => getWordText(w)).join('、');
                return `词库分类「${cat.name}」的词汇：${words}`;
            }).join('\n');

            const keywordsList = resultData.keywords.join('、');

            const prompt = `你是一个关键词梳理助手。请根据以下信息，将图片反推得到的关键词重新组织，匹配到各个公式的对应分类下。

**重要：你的核心任务是从图片反推结果中，为每个公式的每个分类补充新词汇，用于完善词库。已存在于词库中的词汇不需要再列出来。**

## 用户的公式
${formulasDesc}

## 用户的词库（这些是已有的词汇，不要重复）
${thesaurusDesc}

## 图片反推得到的关键词（需要梳理的原始关键词）
${keywordsList}

## 要求
1. 为每个公式输出一个分组，格式为：## [公式名称]
2. 在每个公式下，列出该公式涉及的分类，并将**关键词分配到对应分类下**
3. 每个分类下的关键词用顿号（、）分隔
4. **只列出词库中不存在的新词汇**，已存在于词库的词汇不要列出
5. 如果某个分类下所有关键词都已在词库中，该分类可以省略
6. 如果某个公式所有分类的关键词都已在词库中，该公式可以省略
7. 对于每个公式的每个分类，尽可能提取更多准确的关键词，不要遗漏
8. 关键词要具体、准确，去除重复和含义重叠的词汇
9. 如果某个公式的某个分类在原始关键词中找不到直接对应的词汇，可以根据图片内容合理推导补充（用[推断]标记）
10. 只输出梳理结果，不要任何解释或额外文字

输出格式示例：
## 电商广告
产品：哑光唇釉、丝绒口红、金属眼影盘
风格：都市摩登、轻奢质感
场景：T台背景、镁光灯效

## Logo设计
色彩：玫瑰金渐变、磨砂质感
构图：居中对称、负空间设计`;

            // 显示加载状态
            const organizeBtn = document.getElementById('organizeKeywordsBtn');
            if (organizeBtn) {
                organizeBtn.disabled = true;
                organizeBtn.textContent = '梳理中...';
            }

            try {
                const apiKey = document.getElementById('geminiApiKey')?.value?.trim();
                if (!apiKey) {
                    showToast('请先配置 Gemini API Key', 'warning');
                    return;
                }

                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [{ text: prompt }]
                            }],
                            generationConfig: {
                                temperature: 0.2,
                                topP: 0.95,
                                maxOutputTokens: 2048
                            }
                        })
                    }
                );

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error?.message || `HTTP ${response.status}`);
                }

                const data = await response.json();
                const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!aiText) throw new Error('AI 未返回有效结果');

                console.log('[梳理] AI 返回原始文本:', aiText.substring(0, 300));

                // 解析AI返回的梳理结果：按公式分组
                const organizedResult = parseOrganizedKeywords(aiText, formulas, thesaurus);

                console.log('[梳理] 解析结果 - 公式分组:', Object.keys(organizedResult.formulaGroups));
                console.log('[梳理] 解析结果 - 新词分类:', Object.keys(organizedResult.categoryMap));
                console.log('[梳理] 解析结果 - 是否有新词:', organizedResult.hasNewWords);

                // 更新 categoryMap 为梳理后的结果（只包含新词）
                imagePromptState.resultData.categoryMap = organizedResult.categoryMap;
                imagePromptState.resultData.organizedText = organizedResult.displayText;
                imagePromptState.resultData.organizedFormulas = organizedResult.formulaGroups;
                imagePromptState.resultData.hasNewWords = organizedResult.hasNewWords;

                // 显示梳理后的结果
                const textarea = document.getElementById('ipResultTextarea');
                if (textarea) {
                    textarea.value = organizedResult.displayText;
                    const charCount = document.getElementById('resultCharCount');
                    if (charCount) charCount.textContent = `${organizedResult.displayText.length} / 2000`;
                }

                // 更新操作按钮
                const resultActions = document.getElementById('ipResultActions');
                if (resultActions) {
                    resultActions.innerHTML = organizedResultActionsHTML(organizedResult.hasNewWords);
                }

                if (organizedResult.hasNewWords) {
                    showToast(`梳理完成！发现 ${Object.keys(organizedResult.categoryMap).length} 个分类的新词可补充`, 'success');
                } else {
                    showToast('梳理完成！所有词汇已存在于词库中', 'info');
                }
            } catch (err) {
                console.error('关键词梳理失败 - 完整错误:', err);
                console.error('梳理失败 - 错误类型:', err.name);
                console.error('梳理失败 - 错误消息:', err.message);
                console.error('梳理失败 - 错误堆栈:', err.stack);
                // 尝试提取更详细的错误信息
                let errMsg = err.message || '未知错误';
                if (err.name === 'TypeError') errMsg = '数据处理异常，请刷新页面重试';
                else if (errMsg.includes('API key')) errMsg = 'API Key 无效，请重新配置';
                else if (errMsg.includes('429')) errMsg = '请求频繁，请稍后重试';
                else if (errMsg.includes('fetch')) errMsg = '网络连接失败，请检查网络';
                showToast('梳理失败: ' + errMsg, 'error');
            } finally {
                if (organizeBtn) {
                    organizeBtn.disabled = false;
                    organizeBtn.textContent = '梳理关键词';
                }
            }
        }

        // 解析AI返回的梳理结果，构建 categoryMap 和展示文本
        function parseOrganizedKeywords(aiText, formulas, thesaurus) {
            const lines = aiText.split('\n');
            const formulaGroups = {}; // { formulaName: { category: [words] } }
            const categoryMap = {};   // { categoryName: [words] } 扁平化，用于添加词库
            let currentFormula = null;
            let currentFormulaName = null;

            // 先建立公式名称映射
            const formulaNameMap = {};
            formulas.forEach(f => { formulaNameMap[f.name] = f; });

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // 匹配公式标题：## 公式名 或 【公式名】
                const formulaMatch = trimmed.match(/^(?:##\s*|【)(.+?)(?:】)?$/);
                if (formulaMatch && formulaNameMap[formulaMatch[1]]) {
                    currentFormulaName = formulaMatch[1];
                    currentFormula = formulaNameMap[currentFormulaName];
                    if (!formulaGroups[currentFormulaName]) {
                        formulaGroups[currentFormulaName] = {};
                    }
                    continue;
                }

                // 匹配分类行：分类名：关键词1、关键词2
                if (currentFormulaName) {
                    const catMatch = trimmed.match(/^([^:：]+)[:：]\s*(.+)$/);
                    if (catMatch) {
                        const catName = catMatch[1].trim();
                        const kws = catMatch[2].split(/[、,，]/).map(k => k.trim()).filter(k => k.length > 0);
                        if (kws.length > 0) {
                            formulaGroups[currentFormulaName][catName] = kws;
                            if (!categoryMap[catName]) categoryMap[catName] = [];
                            kws.forEach(kw => {
                                if (!categoryMap[catName].includes(kw)) {
                                    categoryMap[catName].push(kw);
                                }
                            });
                        }
                    }
                }
            }

            // 构建展示文本：按公式分组，**只显示新词**（词库中不存在的词汇）
            const displayLines = [];
            const thesaurusCatMap = {};
            let hasAnyNewWords = false;
            thesaurus.forEach(cat => {
                thesaurusCatMap[cat.name] = new Set(cat.words.map(w => getWordText(w)));
            });

            // 构建只包含新词的 categoryMap（用于后续添加词库）
            const newCategoryMap = {};

            Object.entries(formulaGroups).forEach(([formulaName, catWords]) => {
                let formulaHasNew = false;
                const newLines = [];

                Object.entries(catWords).forEach(([cat, words]) => {
                    const existingSet = thesaurusCatMap[cat] || new Set();
                    const newWords = words.filter(w => !existingSet.has(w));

                    if (newWords.length > 0) {
                        formulaHasNew = true;
                        hasAnyNewWords = true;
                        newLines.push(`  ${cat}：${newWords.join('、')}`);
                        // 加入新词 categoryMap
                        if (!newCategoryMap[cat]) newCategoryMap[cat] = [];
                        newWords.forEach(kw => {
                            if (!newCategoryMap[cat].includes(kw)) {
                                newCategoryMap[cat].push(kw);
                            }
                        });
                    }
                });

                if (formulaHasNew) {
                    displayLines.push(`【${formulaName}】`);
                    displayLines.push(...newLines);
                    displayLines.push('');
                }
            });

            // 如果所有词汇都已存在
            if (!hasAnyNewWords) {
                displayLines.push('✅ 所有关键词已存在于词库中，无需补充新词。');
            }

            return {
                categoryMap: newCategoryMap,  // 只包含新词
                formulaGroups,
                displayText: displayLines.join('\n').trim(),
                hasNewWords: hasAnyNewWords
            };
        }

        // 梳理完成后的操作按钮HTML
        function organizedResultActionsHTML(hasNewWords) {
            const zhActive = imagePromptState.resultLang === 'zh' ? ' active' : '';
            const enActive = imagePromptState.resultLang === 'en' ? ' active' : '';
            const addBtn = hasNewWords
                ? `<button class="mini-btn primary" style="background:#f59e0b;border-color:#f59e0b;" id="addToThesaurusBtn" onclick="addKeywordsToThesaurus()" title="将所有梳理结果中的新词汇批量添加到对应公式的词库">添加到词库</button>`
                : `<button class="mini-btn" style="background:#f59e0b;border-color:#f59e0b;opacity:0.5;cursor:default;" disabled title="没有新词汇需要添加">无需添加</button>`;
            const fillBtn = hasNewWords
                ? `<button class="mini-btn primary" id="fillComposeBtn" onclick="fillOrganizedToCompose()" title="将梳理的新词汇填充到词汇组合中">填充到组合</button>`
                : `<button class="mini-btn" style="opacity:0.5;cursor:default;" disabled title="没有新词汇可填充">填充到组合</button>`;
            return `<button class="mini-btn${zhActive}" id="langZhBtn" onclick="switchResultLang('zh')" title="中文">中</button>
                <button class="mini-btn${enActive}" id="langEnBtn" onclick="switchResultLang('en')" title="英文">EN</button>
                <button class="mini-btn" style="background:#8b5cf6;border-color:#8b5cf6;opacity:0.7;cursor:default;" disabled>✓ 已梳理</button>
                ${addBtn}
                ${fillBtn}
                <button class="mini-btn danger" onclick="clearImagePromptResult()" title="清空反推结果">清空</button>`;
        }

        // 将梳理后的新词结果填充到词汇组合
        function fillOrganizedToCompose() {
            const resultData = imagePromptState.resultData;
            if (!resultData || !resultData.categoryMap || Object.keys(resultData.categoryMap).length === 0) {
                showToast('没有新词汇可填充，请先梳理关键词', 'warning');
                return;
            }

            const categoryMap = resultData.categoryMap;  // 只包含新词的扁平分类
            const formulas = getFormulas();
            if (formulas.length === 0) {
                showToast('没有可用公式，请先创建公式', 'warning');
                return;
            }

            // 选择第一个公式
            const firstFormula = formulas[0];
            currentFormulaId = firstFormula.id;
            const formulaSelect = document.getElementById('formulaSelect');
            if (formulaSelect) formulaSelect.value = firstFormula.id;

            // 填充 currentSelections：只填充新词
            const formulaCategories = parseVariables(firstFormula.template).map(v => v.category);
            Object.entries(categoryMap).forEach(([cat, words]) => {
                // 匹配公式的分类
                const matchedCat = formulaCategories.find(fc => fc === cat || cat.includes(fc) || fc.includes(cat));
                const targetCat = matchedCat || cat;
                if (!currentSelections[targetCat]) currentSelections[targetCat] = [];
                words.forEach(w => {
                    if (!currentSelections[targetCat].includes(w)) {
                        currentSelections[targetCat].push(w);
                    }
                });
            });

            // 切换到词汇组合视图
            if (currentView !== 'compose') {
                switchView('compose');
            }

            // 刷新UI
            renderCategories();
            updateResult();

            // 滚动到结果区
            setTimeout(() => {
                const resultPanel = document.querySelector('.result-panel');
                if (resultPanel) {
                    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 150);

            showToast(`已填充公式「${firstFormula.name}」的新词到组合`, 'success');
        }

        function addKeywordsToThesaurus() {
            const resultData = imagePromptState.resultData;
            if (!resultData || !resultData.categoryMap || Object.keys(resultData.categoryMap).length === 0) {
                showToast('没有可添加的词汇数据', 'warning');
                return;
            }

            const categoryMap = resultData.categoryMap;
            const thesaurus = getThesaurus();
            const formulas = getFormulas();

            if (thesaurus.length === 0) {
                showToast('词库为空，请先创建词库分类', 'warning');
                return;
            }
            if (formulas.length === 0) {
                showToast('没有可用公式，请先创建公式', 'warning');
                return;
            }

            let totalAdded = 0;
            let totalSkipped = 0;
            const addedByFormula = {}; // 记录每个公式添加了哪些词汇，用于后续填充

            // 遍历每个公式
            formulas.forEach(formula => {
                const formulaCategories = parseVariables(formula.template).map(v => v.category);
                const formulaCatSet = new Set(formulaCategories);

                formulaCategories.forEach(fCat => {
                    // 在词库中找到匹配的分类
                    const matchedCat = findMatchingCategory(fCat, thesaurus, formulaCatSet);
                    if (!matchedCat) return;

                    // 从 categoryMap 中获取该分类的AI关键词
                    let aiKeywords = categoryMap[fCat] || categoryMap[matchedCat.name];
                    if (!aiKeywords) {
                        // 模糊匹配
                        for (const [mapCat, kws] of Object.entries(categoryMap)) {
                            if (mapCat.includes(fCat) || fCat.includes(mapCat) || matchedCat.name.includes(mapCat) || mapCat.includes(matchedCat.name)) {
                                aiKeywords = kws;
                                break;
                            }
                        }
                    }
                    if (!aiKeywords || aiKeywords.length === 0) return;

                    // 构建已有词汇的文本集合（用于去重）
                    const existingTexts = new Set(matchedCat.words.map(w => getWordText(w)));
                    // 也收集子词汇
                    matchedCat.words.forEach(w => {
                        getWordChildren(w).forEach(child => existingTexts.add(child));
                    });

                    const addedWords = [];
                    aiKeywords.forEach(kw => {
                        if (!existingTexts.has(kw)) {
                            matchedCat.words.push(kw);
                            existingTexts.add(kw);
                            addedWords.push(kw);
                            totalAdded++;
                        } else {
                            totalSkipped++;
                        }
                    });

                    if (addedWords.length > 0) {
                        if (!addedByFormula[formula.id]) {
                            addedByFormula[formula.id] = { formula, words: {} };
                        }
                        addedByFormula[formula.id].words[fCat] = addedWords;
                    }
                });
            });

            if (totalAdded === 0) {
                showToast(totalSkipped > 0 ? `词汇已存在于词库中，无需重复添加` : '没有可添加的词汇', 'info');
                return;
            }

            // 保存词库
            saveThesaurus(thesaurus);

            // 构建成功消息
            let msg = `成功补充 ${totalAdded} 个新词汇到词库`;
            if (totalSkipped > 0) msg += `（${totalSkipped} 个已存在自动跳过）`;
            const formulaNames = Object.values(addedByFormula).map(f => f.formula.name).join('、');
            msg += `\n涉及公式：${formulaNames}`;
            showToast(msg, 'success');

            // 自动在词汇组合中填充：选择第一个有添加词汇的公式，自动选中所有已添加的词
            if (Object.keys(addedByFormula).length > 0) {
                const firstFormulaEntry = Object.values(addedByFormula)[0];
                const formula = firstFormulaEntry.formula;

                // 切换到该公式
                currentFormulaId = formula.id;
                const formulaSelect = document.getElementById('formulaSelect');
                if (formulaSelect) formulaSelect.value = formula.id;

                // 填充 currentSelections
                Object.entries(firstFormulaEntry.words).forEach(([cat, words]) => {
                    if (!currentSelections[cat]) currentSelections[cat] = [];
                    words.forEach(w => {
                        if (!currentSelections[cat].includes(w)) {
                            currentSelections[cat].push(w);
                        }
                    });
                });

                // 切换到词汇组合视图
                if (currentView !== 'compose') {
                    switchView('compose');
                }

                // 刷新UI
                renderCategories();
                updateResult();

                // 滚动到结果区
                setTimeout(() => {
                    const resultPanel = document.querySelector('.result-panel');
                    if (resultPanel) {
                        resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 150);
            }

            // 更新结果区按钮状态
            renderCategories();
        }

        // 智能匹配：将AI反推的分类关键词匹配到词库，自动选中词汇
        function matchAndSelectKeywords(categoryMap) {
            const thesaurus = getThesaurus();
            if (thesaurus.length === 0) {
                showToast('词库为空，请先添加词库分类', 'warning');
                return;
            }

            // 获取当前公式，没有则自动选择第一个
            let formula = getCurrentFormula();
            if (!formula) {
                const formulas = getFormulas();
                if (formulas.length === 0) {
                    showToast('没有可用公式，请先创建公式', 'warning');
                    return;
                }
                // 自动选择第一个公式
                formula = formulas[0];
                currentFormulaId = formula.id;
                document.getElementById('formulaSelect').value = formula.id;
                renderCategories();
            }

            const formulaCategories = new Set(parseVariables(formula.template).map(v => v.category));
            let matchedCount = 0;

            // 遍历AI返回的每个分类，尝试匹配到词库
            Object.entries(categoryMap).forEach(([aiCatName, aiKeywords]) => {
                // 1. 找到匹配的词库分类
                const matchedCat = findMatchingCategory(aiCatName, thesaurus, formulaCategories);
                if (!matchedCat) return;

                // 2. 在匹配到的词库分类中，逐个匹配AI关键词
                const selectedWords = [];
                aiKeywords.forEach(aiKw => {
                    const matchedWord = findMatchingWord(aiKw, matchedCat.words);
                    if (matchedWord !== null) {
                        if (!selectedWords.includes(matchedWord)) {
                            selectedWords.push(matchedWord);
                        }
                    }
                });

                if (selectedWords.length > 0) {
                    // 合并到 currentSelections
                    if (!currentSelections[matchedCat.name]) {
                        currentSelections[matchedCat.name] = [];
                    }
                    selectedWords.forEach(w => {
                        if (!currentSelections[matchedCat.name].includes(w)) {
                            currentSelections[matchedCat.name].push(w);
                        }
                    });
                    matchedCount++;
                }
            });

            // 切换到词汇组合视图
            if (currentView !== 'compose') {
                switchView('compose');
            }

            // 刷新UI
            renderCategories();
            updateResult();

            if (matchedCount > 0) {
                showToast(`已智能匹配 ${matchedCount} 个分类，自动选中对应词汇`, 'success');
                // 滚动到结果区
                setTimeout(() => {
                    const resultPanel = document.querySelector('.result-panel');
                    if (resultPanel) {
                        resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 150);
            } else {
                showToast('未能匹配到词库中的词汇，请检查词库内容', 'warning');
            }
        }

        // 在词库中找到匹配的分类
        function findMatchingCategory(aiCatName, thesaurus, formulaCategories) {
            // 1. 完全匹配
            for (const cat of thesaurus) {
                if (cat.name === aiCatName && formulaCategories.has(cat.name)) return cat;
            }
            // 2. 包含关系匹配（优先在公式分类中找）
            for (const cat of thesaurus) {
                if (!formulaCategories.has(cat.name)) continue;
                if (cat.name.includes(aiCatName) || aiCatName.includes(cat.name)) return cat;
            }
            // 3. 宽松匹配（忽略"广告"等前缀）
            const normalize = s => s.replace(/[广告图片设计绘画海报]/g, '');
            const aiNorm = normalize(aiCatName);
            for (const cat of thesaurus) {
                if (!formulaCategories.has(cat.name)) continue;
                const catNorm = normalize(cat.name);
                if (catNorm === aiNorm || catNorm.includes(aiNorm) || aiNorm.includes(catNorm)) return cat;
            }
            return null;
        }

        // 在词库分类的词汇列表中找到匹配的词
        function findMatchingWord(aiKeyword, words) {
            // 1. 完全匹配
            for (const w of words) {
                const text = getWordText(w);
                if (text === aiKeyword) return text;
            }
            // 2. 包含关系匹配
            for (const w of words) {
                const text = getWordText(w);
                if (text.includes(aiKeyword) || aiKeyword.includes(text)) return text;
            }
            // 3. 在分层词的子词汇中匹配
            for (const w of words) {
                if (!hasWordChildren(w)) continue;
                const children = getWordChildren(w);
                for (const child of children) {
                    if (child === aiKeyword) return child;
                    if (child.includes(aiKeyword) || aiKeyword.includes(child)) return child;
                }
            }
            return null;
        }

        // ==================== 图片反推历史记录 ====================
        function getImageHistory() {
            return loadData(getStorageKey(STORAGE_KEYS.IMAGE_HISTORY), []);
        }

        function saveToImageHistory(data) {
            const history = getImageHistory();
            const item = {
                id: Date.now(),
                thumb: imagePromptState.imageBase64 || '',
                desc: data.description || (data.keywords ? data.keywords.join(', ') : '') || (data.variants ? data.variants[0].text : ''),
                mode: data.mode || 'detailed',
                date: new Date().toISOString().slice(0, 10),
                keywords: data.keywords || [],
                categoryMap: data.categoryMap || {},
                variants: data.variants || []
            };
            history.unshift(item);
            if (history.length > 50) history.pop();
            saveData(getStorageKey(STORAGE_KEYS.IMAGE_HISTORY), history);
        }

        function renderImageHistory() {
            const container = document.getElementById('imageHistoryList');
            if (!container) return;
            const history = getImageHistory();

            if (history.length === 0) {
                container.innerHTML = `
                    <div class="history-empty">
                        <p>暂无历史记录</p>
                        <p style="font-size:0.8rem;margin-top:0.5rem;">反推结果将自动保存到这里</p>
                    </div>
                `;
                return;
            }

            const badgeMap = {
                'prompt': { text: '提示词直出', cls: 'badge-wanxiang' },
                'prompt-en': { text: '英文直出', cls: 'badge-wanxiang' },
                'detailed': { text: '描述', cls: 'badge-generic' },
                'keywords': { text: '关键词', cls: 'badge-qwen' },
                'wand': { text: '变体', cls: 'badge-wanxiang' }
            };

            container.innerHTML = history.map(item => {
                const badge = badgeMap[item.mode] || badgeMap['detailed'];
                const shortDesc = item.desc.length > 120 ? item.desc.slice(0, 120) + '...' : item.desc;
                return `
                    <div class="history-item" onclick="loadImageHistoryItem(${item.id})">
                        <div class="history-thumb">
                            ${item.thumb ? `<img src="${escapeAttr(item.thumb)}" alt="">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:var(--text-muted);">无图</div>'}
                        </div>
                        <div class="history-content">
                            <div class="history-desc">${escapeHtml(shortDesc)}</div>
                            <div class="history-meta">
                                <span class="history-date">${escapeHtml(item.date)}</span>
                                <span class="history-model ${badge.cls}">${badge.text}</span>
                            </div>
                            <div class="history-actions" onclick="event.stopPropagation()">
                                <button class="mini-btn" onclick="viewImageHistoryDetail(${item.id})">详情</button>
                                <button class="mini-btn" onclick="copyImageHistoryItem(${item.id})">复制</button>
                                <button class="mini-btn" onclick="deleteImageHistoryItem(${item.id})">删除</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function loadImageHistoryItem(id) {
            const history = getImageHistory();
            const item = history.find(h => h.id === id);
            if (!item) return;

            // 恢复 resultData 到 imagePromptState，以便后续操作使用
            imagePromptState.resultData = {
                mode: item.mode,
                description: item.desc,
                keywords: item.keywords || [],
                categoryMap: item.categoryMap || {},
                variants: item.variants || []
            };
            // 清空梳理状态（需要重新梳理）
            imagePromptState.resultData.organizedFormulas = undefined;
            imagePromptState.resultData.organizedText = undefined;

            // 关键词模式：显示原始分类关键词列表
            if (item.mode === 'keywords' && item.categoryMap && Object.keys(item.categoryMap).length > 0) {
                const formattedText = Object.entries(item.categoryMap).map(([cat, kws]) => `${cat}：${kws.join('、')}`).join('\n');
                const textarea = document.getElementById('ipResultTextarea');
                if (textarea) {
                    textarea.value = formattedText;
                    textarea.readOnly = false;
                    const charCount = document.getElementById('resultCharCount');
                    if (charCount) charCount.textContent = `${formattedText.length} / 2000`;
                }
            } else {
                // 恢复结果到文本框
                const textarea = document.getElementById('ipResultTextarea');
                if (textarea) {
                    textarea.value = item.desc;
                    textarea.readOnly = false;
                    const charCount = document.getElementById('resultCharCount');
                    if (charCount) charCount.textContent = `${item.desc.length} / 2000`;
                }
            }

            // 设置模式
            setPromptMode(item.mode, document.querySelector(`[data-mode="${item.mode}"]`));
        }

        function viewImageHistoryDetail(id) {
            const history = getImageHistory();
            const item = history.find(h => h.id === id);
            if (!item) return;

            const badgeMap = {
                'prompt': { text: '提示词直出', cls: 'badge-wanxiang' },
                'prompt-en': { text: '英文直出', cls: 'badge-wanxiang' },
                'detailed': { text: '描述', cls: 'badge-generic' },
                'keywords': { text: '关键词', cls: 'badge-qwen' },
                'wand': { text: '变体', cls: 'badge-wanxiang' }
            };
            const badge = badgeMap[item.mode] || badgeMap['detailed'];

            const modal = document.getElementById('imageHistoryDetailModal');
            if (!modal) return;

            modal.querySelector('.detail-date').textContent = item.date;
            modal.querySelector('.detail-badge').textContent = badge.text;
            modal.querySelector('.detail-badge').className = 'badge ' + badge.cls + ' detail-badge';
            
            // 关键词模式：显示原始关键词列表
            if (item.mode === 'keywords' && item.categoryMap && Object.keys(item.categoryMap).length > 0) {
                modal.querySelector('.detail-text').textContent = 
                    Object.entries(item.categoryMap).map(([cat, kws]) => `${cat}：${kws.join('、')}`).join('\n');
                // 显示「梳理关键词」+「添加到词库」按钮
                const footer = document.getElementById('historyDetailFooter');
                if (footer) {
                    footer.innerHTML = `
                        <button class="btn btn-ghost btn-sm" onclick="copyImageHistoryItem(parseInt(document.getElementById('imageHistoryDetailModal').dataset.historyId))">复制全文</button>
                        <button class="btn btn-primary btn-sm" style="background:#8b5cf6;border-color:#8b5cf6;" onclick="organizeHistoryKeywords(${id});closeImageHistoryDetail()">梳理关键词</button>
                        <button class="btn btn-ghost btn-sm" onclick="closeImageHistoryDetail()">关闭</button>
                    `;
                }
            } else {
                modal.querySelector('.detail-text').textContent = item.desc;
                // 恢复默认按钮
                const footer = document.getElementById('historyDetailFooter');
                if (footer) {
                    footer.innerHTML = `
                        <button class="btn btn-ghost btn-sm" onclick="copyImageHistoryItem(parseInt(document.getElementById('imageHistoryDetailModal').dataset.historyId))">复制全文</button>
                        <button class="btn btn-primary btn-sm" onclick="fillImageHistoryDetail();closeImageHistoryDetail()">填入组合</button>
                        <button class="btn btn-ghost btn-sm" onclick="closeImageHistoryDetail()">关闭</button>
                    `;
                }
            }

            modal.dataset.historyId = id;
            modal.classList.add('active');
        }

        // 从历史记录中梳理关键词
        function organizeHistoryKeywords(id) {
            const history = getImageHistory();
            const item = history.find(h => h.id === id);
            if (!item || !item.categoryMap || Object.keys(item.categoryMap).length === 0) {
                showToast('没有可梳理的关键词数据', 'warning');
                return;
            }

            // 将历史数据的 categoryMap 和 keywords 设置到 imagePromptState.resultData 中
            imagePromptState.resultData = {
                mode: 'keywords',
                categoryMap: item.categoryMap,
                keywords: item.keywords || [],
                description: item.desc || '',
                variants: item.variants || []
            };

            // 切换到关键词标签模式
            setPromptMode('keywords', document.querySelector('[data-mode="keywords"]'));

            // 显示原始关键词在文本框
            const textarea = document.getElementById('ipResultTextarea');
            if (textarea) {
                textarea.value = Object.entries(item.categoryMap).map(([cat, kws]) => `${cat}：${kws.join('、')}`).join('\n');
            }

            // 自动触发梳理
            organizeKeywordsByFormula();
        }

        function closeImageHistoryDetail() {
            const modal = document.getElementById('imageHistoryDetailModal');
            if (modal) modal.classList.remove('active');
        }

        function fillImageHistoryDetail() {
            const modal = document.getElementById('imageHistoryDetailModal');
            if (!modal) return;
            const id = parseInt(modal.dataset.historyId);
            if (!id) return;
            const history = getImageHistory();
            const item = history.find(h => h.id === id);
            if (!item) return;
            // 关键词模式且有categoryMap：智能匹配词库
            if (item.mode === 'keywords' && item.categoryMap && Object.keys(item.categoryMap).length > 0) {
                matchAndSelectKeywords(item.categoryMap);
            } else {
                fillToResult(item.desc);
            }
        }

        // 从历史记录详情中将关键词批量添加到词库
        function addHistoryKeywordsToThesaurus(id) {
            const history = getImageHistory();
            const item = history.find(h => h.id === id);
            if (!item || !item.categoryMap || Object.keys(item.categoryMap).length === 0) {
                showToast('没有可添加的词汇数据', 'warning');
                return;
            }

            // 将历史数据的 categoryMap 设置到 imagePromptState.resultData 中
            imagePromptState.resultData = {
                mode: 'keywords',
                categoryMap: item.categoryMap,
                keywords: item.keywords || [],
                description: item.desc || '',
                variants: item.variants || []
            };

            // 调用统一的添加函数
            addKeywordsToThesaurus();
        }

        function copyImageHistoryItem(id) {
            const history = getImageHistory();
            const item = history.find(h => h.id === id);
            if (item) copyText(item.desc, '已复制到剪贴板');
        }

        function deleteImageHistoryItem(id) {
            let history = getImageHistory();
            history = history.filter(h => h.id !== id);
            saveData(getStorageKey(STORAGE_KEYS.IMAGE_HISTORY), history);
            renderImageHistory();
        }

        function clearImageHistory() {
            if (!confirm('确定要清空所有历史记录吗？')) return;
            saveData(getStorageKey(STORAGE_KEYS.IMAGE_HISTORY), []);
            renderImageHistory();
        }

        // ==================== 图片反推提示词功能 ====================
        let imagePromptState = {
            imageFile: null,
            imageBase64: null,
            imageUrl: '',           // 在线图片 URL（用于免费 Flash 模型）
            promptMode: 'prompt',
            resultLang: 'zh',       // 'zh' | 'en'
            resultZh: '',           // 中文结果缓存
            resultEn: '',           // 英文结果缓存
            resultTab: 'description',
            resultData: null,
            isAnalyzing: false,
            apiProvider: 'zhipu',    // 'zhipu' | 'gemini' | 'kimi' | 'qwen' | 'groq'
            zhipuModel: 'glm-4v-flash',  // 智谱模型
            geminiModel: 'gemini-2.5-flash',  // Gemini 模型
            kimiModel: 'kimi-k2.5',  // Kimi 模型
            qwenModel: 'qwen3-vl-235b-a22b-thinking',  // 千问模型
            groqModel: 'meta-llama/llama-4-scout-17b-16e-instruct'  // Groq 模型
        };

        function switchResultLang(lang) {
            imagePromptState.resultLang = lang;
            const zhBtn = document.getElementById('langZhBtn');
            const enBtn = document.getElementById('langEnBtn');
            if (zhBtn && enBtn) {
                if (lang === 'zh') {
                    zhBtn.classList.add('active');
                    enBtn.classList.remove('active');
                } else {
                    enBtn.classList.add('active');
                    zhBtn.classList.remove('active');
                }
            }
            // 根据当前语言更新文本框内容
            const textarea = document.getElementById('ipResultTextarea');
            if (textarea) {
                const text = lang === 'zh' ? (imagePromptState.resultZh || '') : (imagePromptState.resultEn || imagePromptState.resultZh || '');
                textarea.value = text;
                const charCount = document.getElementById('resultCharCount');
                if (charCount) charCount.textContent = `${text.length} / 2000`;
            }
        }

        // 拖拽上传支持由 renderImagePromptView() -> rebindUploadEvents() 动态绑定

        function handleImageSelect(event) {
            const file = event.target.files[0];
            if (file) handleImageFile(file);
        }

        function handleImageFile(file) {
            // 验证格式
            const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
            if (!validTypes.includes(file.type)) {
                showToast('仅支持 JPG、PNG、WebP 格式', 'error');
                return;
            }
            // 验证大小 (10MB)
            if (file.size > 10 * 1024 * 1024) {
                showToast('图片大小不能超过 10MB', 'error');
                return;
            }
            
            imagePromptState.imageFile = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePromptState.imageBase64 = e.target.result;
                renderImagePreview(e.target.result, file.name);
                updateAnalyzeButton();
            };
            reader.readAsDataURL(file);
        }

        function renderImagePreview(dataUrl, fileName) {
            const zone = document.getElementById('uploadZone');
            zone.classList.add('has-image');
            zone.onclick = null; // 移除点击上传事件
            zone.innerHTML = `
                <div class="preview-container">
                    <img src="${dataUrl}" alt="${fileName || '预览'}">
                    <button class="preview-remove" onclick="event.stopPropagation(); removeImage()" title="移除图片">✕</button>
                </div>
                <span class="upload-hint" style="margin-top:0.4rem;">${fileName || ''}</span>
            `;
        }

        function removeImage() {
            imagePromptState.imageFile = null;
            imagePromptState.imageBase64 = null;
            imagePromptState.resultData = null;
            
            const zone = document.getElementById('uploadZone');
            if (zone) {
                zone.classList.remove('has-image');
                zone.onclick = () => document.getElementById('imageInput').click();
                zone.innerHTML = `
                    <span class="upload-text">拖拽图片到这里或点击上传</span>
                    <span class="upload-hint">支持 JPG / PNG / WebP，最大 10MB</span>
                `;
            }
            
            const input = document.getElementById('imageInput');
            if (input) input.value = '';
            
            // 隐藏结果面板，显示空状态
            ['resultDescriptionPanel', 'resultKeywordsPanel', 'resultVariantsPanel'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            const emptyPanel = document.getElementById('resultEmptyPanel');
            if (emptyPanel) emptyPanel.style.display = '';
            
            updateAnalyzeButton();
        }

        // 处理图片 URL 输入
        function handleImageUrlInput() {
            const urlInput = document.getElementById('imageUrlInput');
            if (!urlInput) return;
            const url = urlInput.value.trim();
            imagePromptState.imageUrl = url;
            // 如果输入了 URL，清除本地上传的图片
            if (url && imagePromptState.imageBase64) {
                removeImage();
            }
            updateAnalyzeButton();
        }

        function setPromptMode(mode, btn) {
            imagePromptState.promptMode = mode;
            document.querySelectorAll('#promptModes .mode-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            // 更新操作按钮区域
            const resultActions = document.getElementById('ipResultActions');
            if (resultActions) {
                if (mode === 'keywords') {
                    // 检查是否已经梳理过
                    const hasOrganized = imagePromptState.resultData && 
                        imagePromptState.resultData.organizedFormulas && 
                        Object.keys(imagePromptState.resultData.organizedFormulas).length > 0;
                    if (hasOrganized) {
                        const hasNew = imagePromptState.resultData.hasNewWords !== false;
                        resultActions.innerHTML = organizedResultActionsHTML(hasNew);
                    } else {
                        resultActions.innerHTML = keywordsResultActionsHTML();
                    }
                } else {
                    resultActions.innerHTML = defaultResultActionsHTML();
                }
            }
        }

        function updateAnalyzeButton() {
            const btn = document.getElementById('analyzeBtn');
            if (btn) btn.disabled = (!imagePromptState.imageBase64 && !imagePromptState.imageUrl) || imagePromptState.isAnalyzing;
        }

        // 切换图片反推 API 提供商
        function switchImageProvider(provider, btnEl) {
            imagePromptState.apiProvider = provider;
            localStorage.setItem('image_provider', provider);
            
            // 更新按钮样式
            document.querySelectorAll('#providerSelector .mini-btn').forEach(b => b.classList.remove('active'));
            if (btnEl) btnEl.classList.add('active');
            
            // 所有 Key 行和模型选择器先隐藏
            ['zhipuKeyRow','geminiKeyRow','kimiKeyRow','qwenKeyRow','groqKeyRow'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            ['zhipuModelSelector','geminiModelSelector','kimiModelSelector','qwenModelSelector','groqModelSelector'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            
            // 显示当前提供商的 Key 行和模型选择器
            const keyRow = document.getElementById(provider + 'KeyRow');
            if (keyRow) keyRow.style.display = 'flex';
            const modelSel = document.getElementById(provider + 'ModelSelector');
            if (modelSel) modelSel.style.display = 'block';
            
            // 更新 API Key 链接
            const apiLink = document.getElementById('apiKeyLink');
            if (apiLink) {
                const linkMap = {
                    'zhipu': { href: 'https://bigmodel.cn/usercenter/apikeys', text: '获取智谱 API Key' },
                    'gemini': { href: 'https://aistudio.google.com/apikey', text: '获取 Gemini API Key' },
                    'kimi': { href: 'https://platform.moonshot.cn/console/api-keys', text: '获取 Kimi API Key' },
                    'qwen': { href: 'https://bailian.console.aliyun.com/', text: '获取百炼 API Key' },
                    'groq': { href: 'https://console.groq.com/keys', text: '获取 Groq API Key（免费）' }
                };
                const info = linkMap[provider] || linkMap['zhipu'];
                apiLink.href = info.href;
                apiLink.textContent = info.text;
            }
            
            // 更新模型提示
            updateModelHint();
            
            updateApiKeyStatus();
        }
        
        // 切换智谱模型
        function switchZhipuModel(model) {
            imagePromptState.zhipuModel = model;
            localStorage.setItem('zhipu_model', model);
            const select = document.getElementById('zhipuModelSelect');
            if (select) select.value = model;
            updateModelHint();
        }
        
        // 切换 Gemini 模型
        function switchGeminiModel(model) {
            imagePromptState.geminiModel = model;
            localStorage.setItem('gemini_model', model);
            const select = document.getElementById('geminiModelSelect');
            if (select) select.value = model;
            updateModelHint();
        }
        
        // 切换 Kimi 模型
        function switchKimiModel(model) {
            imagePromptState.kimiModel = model;
            localStorage.setItem('kimi_model', model);
            const select = document.getElementById('kimiModelSelect');
            if (select) select.value = model;
            updateModelHint();
        }
        
        // 切换千问模型
        function switchQwenModel(model) {
            imagePromptState.qwenModel = model;
            localStorage.setItem('qwen_model', model);
            const select = document.getElementById('qwenModelSelect');
            if (select) select.value = model;
            updateModelHint();
        }
        
        // 切换 Groq 模型
        function switchGroqModel(model) {
            imagePromptState.groqModel = model;
            localStorage.setItem('groq_model', model);
            const select = document.getElementById('groqModelSelect');
            if (select) select.value = model;
            updateModelHint();
        }
        
        // 统一更新模型提示
        function updateModelHint() {
            const modelHint = document.getElementById('modelHint');
            if (!modelHint) return;
            const provider = imagePromptState.apiProvider || 'zhipu';
            
            const hints = {
                'zhipu': {
                    'glm-4v-flash': '免费·不限量·速度快，⚠️ 不支持本地上传，仅支持在线图片URL',
                    'glm-4.1v-thinking-flash': '免费·思维链推理，⚠️ 不支持本地上传，仅支持在线图片URL',
                    'glm-4.6v-flash': '免费·128K上下文·最新，⚠️ 不支持本地上传，仅支持在线图片URL',
                    'glm-4v-plus-0111': '付费·高级视觉·16K上下文，✅ 支持本地上传',
                    'glm-4.5v': '付费·MOE架构·64K上下文，✅ 支持本地上传',
                    'glm-4.6v': '付费·全能旗舰·128K上下文，✅ 支持本地上传',
                    'glm-5v-turbo': '付费·5代·200K上下文·视觉编程，✅ 支持本地上传'
                },
                'gemini': {
                    'gemini-2.5-flash': '免费·每日1500次·最新·速度快，✅ 支持本地上传base64',
                    'gemini-2.0-flash': '免费·每日1500次，✅ 支持本地上传base64',
                    'gemini-2.5-pro': '付费·最强推理·每日50次免费，✅ 支持本地上传base64'
                },
                'kimi': {
                    'kimi-k2.5': '新用户赠送额度·多模态·256K上下文，✅ 支持本地上传base64'
                },
                'qwen': {
                    'qwen3-vl-235b-a22b-thinking': '最强视觉·思维链，✅ 支持本地上传base64（新用户7000万Token免费）',
                    'qwen3-vl-32b-thinking': '高效视觉·思维链，✅ 支持本地上传base64（新用户7000万Token免费）',
                    'qwen3-vl-30b-a3b-thinking': '轻量视觉·思维链，✅ 支持本地上传base64（新用户7000万Token免费）'
                },
                'groq': {
                    'meta-llama/llama-4-scout-17b-16e-instruct': '完全免费·通用视觉·OCR·128K上下文，✅ 支持本地上传base64',
                    'meta-llama/llama-4-maverick-17b-128e-instruct': '完全免费·复杂视觉推理·128K上下文，✅ 支持本地上传base64',
                    'llava-v1.5-7b-4096-preview': '完全免费·轻量视觉·速度极快，✅ 支持本地上传base64'
                }
            };
            
            let model;
            if (provider === 'zhipu') model = imagePromptState.zhipuModel;
            else if (provider === 'gemini') model = imagePromptState.geminiModel;
            else if (provider === 'kimi') model = imagePromptState.kimiModel;
            else if (provider === 'qwen') model = imagePromptState.qwenModel;
            else if (provider === 'groq') model = imagePromptState.groqModel;
            
            const providerHints = hints[provider] || {};
            modelHint.textContent = providerHints[model] || '';
        }

        // 恢复提供商 UI 状态
        function restoreProviderUI(provider) {
            // 隐藏所有 Key 行和模型选择器
            ['zhipuKeyRow','geminiKeyRow','kimiKeyRow','qwenKeyRow','groqKeyRow'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            ['zhipuModelSelector','geminiModelSelector','kimiModelSelector','qwenModelSelector','groqModelSelector'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            
            // 高亮当前提供商按钮
            const btns = document.querySelectorAll('#providerSelector .mini-btn');
            btns.forEach(b => b.classList.remove('active'));
            const targetBtn = document.querySelector(`#providerSelector .mini-btn[data-provider="${provider}"]`);
            if (targetBtn) targetBtn.classList.add('active');
            
            // 显示当前提供商
            const keyRow = document.getElementById(provider + 'KeyRow');
            if (keyRow) keyRow.style.display = 'flex';
            const modelSel = document.getElementById(provider + 'ModelSelector');
            if (modelSel) modelSel.style.display = 'block';
            
            // 恢复链接
            const apiLink = document.getElementById('apiKeyLink');
            if (apiLink) {
                const linkMap = {
                    'zhipu': { href: 'https://bigmodel.cn/usercenter/apikeys', text: '获取智谱 API Key' },
                    'gemini': { href: 'https://aistudio.google.com/apikey', text: '获取 Gemini API Key' },
                    'kimi': { href: 'https://platform.moonshot.cn/console/api-keys', text: '获取 Kimi API Key' },
                    'qwen': { href: 'https://bailian.console.aliyun.com/', text: '获取百炼 API Key' },
                    'groq': { href: 'https://console.groq.com/keys', text: '获取 Groq API Key（免费）' }
                };
                const info = linkMap[provider] || linkMap['zhipu'];
                apiLink.href = info.href;
                apiLink.textContent = info.text;
            }
            
            updateModelHint();
        }

        function toggleApiVisibility() {
            const provider = imagePromptState.apiProvider || 'zhipu';
            const inputId = provider + 'ApiKey';
            const keyInput = document.getElementById(inputId);
            if (!keyInput) return;
            const isHidden = keyInput.type === 'password';
            keyInput.type = isHidden ? 'text' : 'password';
            const btn = keyInput.parentElement.querySelector('.btn-toggle-visibility');
            if (btn) btn.textContent = isHidden ? '隐藏' : '显示';
        }

        function saveApiKey() {
            const provider = imagePromptState.apiProvider || 'zhipu';
            const inputId = provider + 'ApiKey';
            const storageKey = provider + '_api_key';
            const keyInput = document.getElementById(inputId);
            if (!keyInput) return;
            const key = keyInput.value.trim();
            if (key) {
                localStorage.setItem(storageKey, key);
            }
            updateApiKeyStatus();
        }

        async function verifyAndSaveApiKey() {
            const provider = imagePromptState.apiProvider || 'zhipu';
            const inputId = provider + 'ApiKey';
            const storageKey = provider + '_api_key';
            const keyInput = document.getElementById(inputId);
            if (!keyInput) return;
            const key = keyInput.value.trim();
            if (!key) {
                showToast('请先输入 API Key', 'warning');
                keyInput.focus();
                return;
            }
            
            const statusEl = document.getElementById('apiKeyStatus');
            if (statusEl) {
                statusEl.textContent = '验证中...';
                statusEl.style.color = 'var(--accent)';
            }
            
            try {
                let response;
                if (provider === 'zhipu') {
                    // 智谱 API 验证：简单对话请求
                    response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${key}`
                        },
                        body: JSON.stringify({
                            model: 'glm-4v-flash',
                            messages: [{ role: 'user', content: 'ping' }],
                            max_tokens: 1
                        })
                    });
                } else if (provider === 'gemini') {
                    // Gemini API 验证
                    response = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: 'ping' }] }],
                                generationConfig: { maxOutputTokens: 1 }
                            })
                        }
                    );
                } else if (provider === 'kimi') {
                    // Kimi API 验证：简单对话请求（OpenAI 兼容格式）
                    response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${key}`
                        },
                        body: JSON.stringify({
                            model: 'kimi-k2.5',
                            messages: [{ role: 'user', content: 'ping' }],
                            max_tokens: 1
                        })
                    });
                } else if (provider === 'qwen') {
                    // 千问 API 验证：OpenAI 兼容格式
                    response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${key}`
                        },
                        body: JSON.stringify({
                            model: 'qwen3-vl-235b-a22b-thinking',
                            messages: [{ role: 'user', content: 'ping' }],
                            max_tokens: 1
                        })
                    });
                } else if (provider === 'groq') {
                    // Groq API 验证：OpenAI 兼容格式
                    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${key}`
                        },
                        body: JSON.stringify({
                            model: 'llava-v1.5-7b-4096-preview',
                            messages: [{ role: 'user', content: 'ping' }],
                            max_tokens: 1
                        })
                    });
                }
                
                if (response.ok) {
                    localStorage.setItem(storageKey, key);
                    if (statusEl) {
                        statusEl.textContent = '已连接';
                        statusEl.style.color = 'var(--success)';
                    }
                    showToast('API Key 验证成功，已保存', 'success');
                } else {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || '';
                    if (response.status === 401 || response.status === 403) {
                        if (statusEl) {
                            statusEl.textContent = 'Key 无效';
                            statusEl.style.color = '#ef4444';
                        }
                        showToast('API Key 无效，请检查后重试', 'error');
                    } else if (errMsg.toLowerCase().includes('insufficient balance') || errMsg.toLowerCase().includes('suspended')) {
                        if (statusEl) {
                            statusEl.textContent = '余额不足';
                            statusEl.style.color = '#ef4444';
                        }
                        showToast('账户余额不足，请充值或切换其他模型', 'error');
                    } else {
                        if (statusEl) {
                            statusEl.textContent = '验证失败';
                            statusEl.style.color = '#ef4444';
                        }
                        showToast('验证失败: ' + (errMsg || `HTTP ${response.status}`), 'error');
                    }
                }
            } catch (err) {
                if (statusEl) {
                    statusEl.textContent = '网络错误';
                    statusEl.style.color = '#ef4444';
                }
                showToast('验证失败: 网络连接异常，请检查网络', 'error');
            }
        }

        function updateApiKeyStatus() {
            const statusEl = document.getElementById('apiKeyStatus');
            if (!statusEl) return;
            const provider = imagePromptState.apiProvider || 'zhipu';
            const inputId = provider + 'ApiKey';
            const storageKey = provider + '_api_key';
            const keyInput = document.getElementById(inputId);
            const savedKey = localStorage.getItem(storageKey);
            
            if (savedKey && keyInput && keyInput.value.trim() === savedKey) {
                statusEl.textContent = '已保存';
                statusEl.style.color = 'var(--success)';
            } else if (keyInput && keyInput.value.trim()) {
                statusEl.textContent = '未保存';
                statusEl.style.color = '#f59e0b';
            } else {
                statusEl.textContent = '未配置';
                statusEl.style.color = 'var(--text-muted)';
            }
        }

        // 获取当前提供商的 API Key
        function getCurrentApiKey() {
            const provider = imagePromptState.apiProvider || 'zhipu';
            const inputId = provider + 'ApiKey';
            const keyInput = document.getElementById(inputId);
            if (!keyInput) return null;
            return keyInput.value.trim();
        }

        async function analyzeImage() {
            const hasLocal = !!imagePromptState.imageBase64;
            const hasUrl = !!imagePromptState.imageUrl;
            if ((!hasLocal && !hasUrl) || imagePromptState.isAnalyzing) return;
            
            const provider = imagePromptState.apiProvider || 'zhipu';
            const apiKey = getCurrentApiKey();
            if (!apiKey) {
                const providerNames = { zhipu: '智谱 GLM-4V', gemini: 'Gemini', kimi: 'Kimi', qwen: '通义千问', groq: 'Groq' };
                showToast(`请先输入 ${providerNames[provider] || provider} API Key`, 'warning');
                return;
            }

            // URL 模式提示（智谱 Flash 模型需要 URL）
            if (hasUrl && !hasLocal && provider === 'zhipu') {
                const url = imagePromptState.imageUrl;
                const isDirectImage = /\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$/i.test(url);
                if (!isDirectImage) {
                    showToast('提示：该URL可能不是图片直链，请使用以 .jpg/.png/.webp 等结尾的图片直链', 'warning');
                }
            }
            
            imagePromptState.isAnalyzing = true;
            const btn = document.getElementById('analyzeBtn');
            btn.disabled = true;
            const btnText = document.getElementById('analyzeBtnText');
            if (btnText) btnText.innerHTML = '<span class="spinner"></span> AI 分析中...';

            try {
                let result;
                const actualProvider = provider;
                let actualModel;
                
                // 获取当前模型名
                if (provider === 'zhipu') actualModel = imagePromptState.zhipuModel;
                else if (provider === 'gemini') actualModel = imagePromptState.geminiModel;
                else if (provider === 'kimi') actualModel = imagePromptState.kimiModel;
                else if (provider === 'qwen') actualModel = imagePromptState.qwenModel;
                else if (provider === 'groq') actualModel = imagePromptState.groqModel;
                
                // 优先使用在线 URL，否则使用本地 base64
                const imageInput = hasUrl ? imagePromptState.imageUrl : imagePromptState.imageBase64;
                const mode = imagePromptState.promptMode;
                
                if (provider === 'zhipu') {
                    result = await callZhipuVision(imageInput, apiKey, mode, actualModel);
                } else if (provider === 'gemini') {
                    result = await callGeminiVision(imageInput, apiKey, mode, actualModel);
                } else if (provider === 'kimi') {
                    result = await callKimiVision(imageInput, apiKey, mode, actualModel);
                } else if (provider === 'qwen') {
                    result = await callQwenVision(imageInput, apiKey, mode, actualModel);
                } else if (provider === 'groq') {
                    result = await callGroqVision(imageInput, apiKey, mode, actualModel);
                }
                
                imagePromptState.resultData = result;
                result._modelUsed = actualModel;
                result._provider = actualProvider;
                renderImagePromptResults(result);
                showToast('反推完成！', 'success');
            } catch (err) {
                console.error('图片反推失败:', err);
                const errMsg = err.message || '未知错误';
                if (errMsg.includes('timeout') || errMsg.includes('超时')) {
                    showToast('反推超时，请尝试切换其他模型后重试', 'error');
                } else {
                    showToast('反推失败: ' + errMsg, 'error');
                }
            } finally {
                imagePromptState.isAnalyzing = false;
                if (btnText) btnText.innerHTML = '开始反推';
                updateAnalyzeButton();
            }
        }

        async function callGeminiVision(imageInput, apiKey, mode, modelName) {
            const model = modelName || 'gemini-2.5-flash';
            
            // 判断是 URL 还是 base64
            const isUrl = imageInput.startsWith('http://') || imageInput.startsWith('https://');
            let parts;
            
            if (isUrl) {
                // URL 模式
                parts = [
                    { text: '' },
                    { file_data: { mime_type: 'image/jpeg', file_uri: imageInput } }
                ];
            } else {
                // Base64 模式
                const matches = imageInput.match(/^data:(image\/\w+);base64,(.+)$/);
                if (!matches) throw new Error('无效的图片数据');
                const mimeType = matches[1];
                const base64 = matches[2];
                parts = [
                    { text: '' },
                    { inline_data: { mime_type: mimeType, data: base64 } }
                ];
            }
            
            // 根据模式构建不同的 prompt（Gemini 专用）
            const prompts = {
                'prompt': `你是一个顶级的AI绘画提示词工程师。请仔细观察这张图片的每一个细节，然后直接生成一段完整、精确的AI绘画提示词。

观察清单（必须在提示词中体现）：
1. 主体：是什么人物/动物/物体？姿势/动作/表情？服装/材质？数量？
2. 场景：室内还是室外？具体环境？有什么背景元素？
3. 风格：写实/插画/3D/油画/水彩/动漫/像素/赛博朋克等？
4. 光影：光源方向？光色温（暖光/冷光）？阴影软硬？有无逆光/侧光/顶光？
5. 色彩：主色调？配色方案？饱和度高低？对比度？
6. 构图：特写/中景/全景？视角（平视/俯视/仰视）？画面比例？
7. 质感：皮肤/金属/布料/玻璃/木质等材质细节？
8. 氛围：宁静/动感/神秘/温暖/冷酷/梦幻等？

输出要求：
- 直接输出提示词正文，不要任何解释、前缀或分析
- 提示词必须精准还原图片内容，不能凭空编造
- 用中文逗号分隔，质量词前置，结构紧凑`,

                'prompt-en': `You are a world-class AI art prompt engineer. Examine this image with extreme attention to every detail, then generate a complete, precise English prompt.

Observation checklist (must reflect in prompt):
1. Subject: Who/what? Pose/action/expression? Clothing/material? Count?
2. Scene: Indoor/outdoor? Specific environment? Background elements?
3. Style: Photorealistic/illustration/3D/oil painting/watercolor/anime/pixel art/cyberpunk?
4. Lighting: Light source direction? Warm/cool light? Hard/soft shadows?
5. Color: Dominant colors? Color scheme? Saturation? Contrast?
6. Composition: Close-up/medium/wide shot? Angle?
7. Texture: Skin/metal/fabric/glass/wood material details?
8. Atmosphere: Serene/dynamic/mysterious/warm/cold/dreamy?

Output ONLY the prompt text, comma-separated English, quality tags first, compact.`,
                
                'detailed': `请作为图片分析专家，对这张图片进行极其详尽的观察和描述。必须覆盖以下每个维度：

1. 主体内容：精确描述画面中的主要对象，包括具体姿态、表情、动作、服饰细节
2. 背景场景：详细描述所处环境（室内外、具体场所类型、背景元素）
3. 艺术风格：判断画风类型（写实摄影/3D渲染/手绘插画/概念艺术/油画/水彩/动漫等）
4. 光影设计：分析光源方向、光质（硬光/柔光）、色温、阴影分布
5. 色彩方案：列出主色调、辅助色，分析饱和度、明暗对比
6. 构图方式：描述视角、景别、主体位置、画面平衡
7. 材质质感：描述各类物体的材质表现（金属光泽/布料纹理/皮肤质感等）
8. 氛围情绪：精准描述整体画面的情感氛围

请用自然中文输出，每个维度单独成段，尽可能详细具体。`,
                
                'keywords': `请作为AI绘画关键词专家，极其仔细地分析这张图片，按以下分类提取精准关键词：

- 画质词: 基于实际画质选择（超高画质/8K/杰作/超精细/HDR等）
- 主体: 精确描述主体特征（性别/年龄/发型/表情/服装/姿态等）
- 场景: 具体环境场所（不要泛泛，要具体到场景类型）
- 风格: 准确判断画风（3D渲染/写实摄影/二次元/油画/概念艺术等）
- 光影: 光源类型、方向、色温
- 色彩: 主色调和配色方案
- 构图: 景别和视角
- 质感: 关键材质
- 氛围: 情感调性

每个分类输出3-5个中文逗号分隔的精准关键词。`,
                
                'wand': `你是一个顶级AI绘画提示词工程师。请仔细观察这张图片，为以下AI绘画模型分别生成最精准的提示词：

1. **万相格式**（中文逗号分隔，质量词前置）
2. **Seedream格式**（英文逗号，带权重标注）
3. **千问图像格式**（自然语言完整句子描述）
4. **通用格式**（精简英文关键词，逗号分隔）

请确保每个格式都精准还原图片，不要添加图片中不存在的内容。`
            };
            
            const prompt = prompts[mode] || prompts['detailed'];
            
            // 将 prompt 文本设置到 parts 的第一个元素
            parts[0] = { text: prompt };
            
            // 调用 Gemini API（带 60 秒超时）
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);
            let response;
            try {
                response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: parts }],
                            generationConfig: {
                                temperature: 0.4,
                                topP: 0.95,
                                maxOutputTokens: 2048
                            }
                        }),
                        signal: controller.signal
                    }
                );
            } catch (fetchErr) {
                if (fetchErr.name === 'AbortError') {
                    throw new Error('Gemini API 请求超时（60秒），请重试或切换模型');
                }
                throw fetchErr;
            } finally {
                clearTimeout(timeoutId);
            }
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || `HTTP ${response.status}`;
                if (response.status === 400 && errMsg.includes('API key')) {
                    throw new Error('API Key 无效，请检查');
                }
                if (response.status === 429) {
                    throw new Error('请求过于频繁，请稍后再试');
                }
                throw new Error(errMsg);
            }
            
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error('AI 未返回有效结果');
            
            return parseResult(text, mode);
        }

        // Kimi 视觉模型调用（Kimi K2.5，OpenAI 兼容格式，支持 base64）
        async function callKimiVision(imageInput, apiKey, mode, modelName) {
            const model = modelName || 'kimi-k2.5';
            
            // 构建图片 content：URL 或 base64
            let imageContent;
            if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
                imageContent = { type: 'image_url', image_url: { url: imageInput } };
            } else {
                imageContent = { type: 'image_url', image_url: { url: imageInput } }; // data:image/xxx;base64,...
            }
            
            const prompts = {
                'prompt': `你是一个顶级的AI绘画提示词工程师。请仔细观察这张图片的每一个细节，然后直接生成一段完整、精确的AI绘画提示词。

观察清单（必须在提示词中体现）：
1. 主体：是什么人物/动物/物体？姿势/动作/表情？服装/材质？数量？
2. 场景：室内还是室外？具体环境？有什么背景元素？
3. 风格：写实/插画/3D/油画/水彩/动漫/像素/赛博朋克等？
4. 光影：光源方向？光色温（暖光/冷光）？阴影软硬？有无逆光/侧光/顶光？
5. 色彩：主色调？配色方案？饱和度高低？对比度？
6. 构图：特写/中景/全景？视角（平视/俯视/仰视）？画面比例？
7. 质感：皮肤/金属/布料/玻璃/木质等材质细节？
8. 氛围：宁静/动感/神秘/温暖/冷酷/梦幻等？

输出要求：
- 直接输出提示词正文，不要任何解释、前缀或分析
- 提示词必须精准还原图片内容，不能凭空编造
- 用中文逗号分隔，质量词前置，结构紧凑`,

                'prompt-en': `You are a world-class AI art prompt engineer. Examine this image with extreme attention to every detail, then generate a complete, precise English prompt.

Observation checklist: 1.Subject 2.Scene 3.Style 4.Lighting 5.Color 6.Composition 7.Texture 8.Atmosphere.

Output ONLY the prompt text, comma-separated English, quality tags first, compact.`,
                
                'detailed': `请作为图片分析专家，对这张图片进行极其详尽的观察和描述。必须覆盖：主体内容、背景场景、艺术风格、光影设计、色彩方案、构图方式、材质质感、氛围情绪。请用自然中文输出，每个维度单独成段，尽可能详细具体。`,
                
                'keywords': `请作为AI绘画关键词专家，极其仔细地分析这张图片，按以下分类提取精准关键词：画质词、主体、场景、风格、光影、色彩、构图、质感、氛围。每个分类输出3-5个中文逗号分隔的精准关键词。`,
                
                'wand': `你是一个顶级AI绘画提示词工程师。请仔细观察这张图片，为以下AI绘画模型分别生成最精准的提示词：1.万相格式（中文逗号分隔，质量词前置）2.Seedream格式（英文逗号，带权重标注）3.千问图像格式（自然语言完整句子描述）4.通用格式（精简英文关键词，逗号分隔）`
            };
            
            const prompt = prompts[mode] || prompts['detailed'];
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);
            let response;
            try {
                response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{
                            role: 'user',
                            content: [imageContent, { type: 'text', text: prompt }]
                        }],
                        max_tokens: 2048,
                        temperature: 0.4
                    }),
                    signal: controller.signal
                });
            } catch (fetchErr) {
                if (fetchErr.name === 'AbortError') {
                    throw new Error('Kimi API 请求超时（60秒），请重试或切换模型');
                }
                throw fetchErr;
            } finally {
                clearTimeout(timeoutId);
            }
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || `HTTP ${response.status}`;
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Kimi API Key 无效，请检查');
                }
                if (response.status === 429) {
                    throw new Error('Kimi 请求过于频繁，请稍后再试');
                }
                if (errMsg.toLowerCase().includes('insufficient balance') || errMsg.toLowerCase().includes('suspended')) {
                    throw new Error('Kimi 账户余额不足，请充值或切换其他模型（如智谱、Gemini）');
                }
                throw new Error('Kimi: ' + errMsg);
            }
            
            const data = await response.json();
            const text = data.choices?.[0]?.message?.content;
            if (!text) throw new Error('Kimi AI 未返回有效结果');
            
            return parseResult(text, mode);
        }

        // 千问视觉模型调用（通义千问 Qwen-VL，阿里百炼 OpenAI 兼容格式，支持 base64）
        async function callQwenVision(imageInput, apiKey, mode, modelName) {
            const model = modelName || 'qwen3-vl-235b-a22b-thinking';
            
            // 构建图片 content
            let imageContent;
            if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
                imageContent = { type: 'image_url', image_url: { url: imageInput } };
            } else {
                imageContent = { type: 'image_url', image_url: { url: imageInput } };
            }
            
            const prompts = {
                'prompt': `你是一个顶级的AI绘画提示词工程师。请仔细观察这张图片的每一个细节，然后直接生成一段完整、精确的AI绘画提示词。

观察清单（必须在提示词中体现）：
1. 主体：是什么人物/动物/物体？姿势/动作/表情？服装/材质？数量？
2. 场景：室内还是室外？具体环境？有什么背景元素？
3. 风格：写实/插画/3D/油画/水彩/动漫/像素/赛博朋克等？
4. 光影：光源方向？光色温（暖光/冷光）？阴影软硬？有无逆光/侧光/顶光？
5. 色彩：主色调？配色方案？饱和度高低？对比度？
6. 构图：特写/中景/全景？视角（平视/俯视/仰视）？画面比例？
7. 质感：皮肤/金属/布料/玻璃/木质等材质细节？
8. 氛围：宁静/动感/神秘/温暖/冷酷/梦幻等？

输出要求：
- 直接输出提示词正文，不要任何解释、前缀或分析
- 提示词必须精准还原图片内容，不能凭空编造
- 用中文逗号分隔，质量词前置，结构紧凑`,

                'prompt-en': `You are a world-class AI art prompt engineer. Examine this image with extreme attention to every detail, then generate a complete, precise English prompt.

Observation checklist: 1.Subject 2.Scene 3.Style 4.Lighting 5.Color 6.Composition 7.Texture 8.Atmosphere.

Output ONLY the prompt text, comma-separated English, quality tags first, compact.`,
                
                'detailed': `请作为图片分析专家，对这张图片进行极其详尽的观察和描述。必须覆盖：主体内容、背景场景、艺术风格、光影设计、色彩方案、构图方式、材质质感、氛围情绪。请用自然中文输出，每个维度单独成段，尽可能详细具体。`,
                
                'keywords': `请作为AI绘画关键词专家，极其仔细地分析这张图片，按以下分类提取精准关键词：画质词、主体、场景、风格、光影、色彩、构图、质感、氛围。每个分类输出3-5个中文逗号分隔的精准关键词。`,
                
                'wand': `你是一个顶级AI绘画提示词工程师。请仔细观察这张图片，为以下AI绘画模型分别生成最精准的提示词：1.万相格式（中文逗号分隔，质量词前置）2.Seedream格式（英文逗号，带权重标注）3.千问图像格式（自然语言完整句子描述）4.通用格式（精简英文关键词，逗号分隔）`
            };
            
            const prompt = prompts[mode] || prompts['detailed'];
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);
            let response;
            try {
                response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{
                            role: 'user',
                            content: [imageContent, { type: 'text', text: prompt }]
                        }],
                        max_tokens: 2048,
                        temperature: 0.4
                    }),
                    signal: controller.signal
                });
            } catch (fetchErr) {
                if (fetchErr.name === 'AbortError') {
                    throw new Error('千问 API 请求超时（60秒），请重试或切换模型');
                }
                throw fetchErr;
            } finally {
                clearTimeout(timeoutId);
            }
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || `HTTP ${response.status}`;
                if (response.status === 401 || response.status === 403) {
                    throw new Error('千问 API Key 无效，请检查');
                }
                if (response.status === 429) {
                    throw new Error('千问 请求过于频繁，请稍后再试');
                }
                throw new Error('千问: ' + errMsg);
            }
            
            const data = await response.json();
            const text = data.choices?.[0]?.message?.content;
            if (!text) throw new Error('千问 AI 未返回有效结果');
            
            return parseResult(text, mode);
        }

        // Groq 视觉模型调用（Llama 4 Scout/Maverick, LLaVA，OpenAI 兼容格式，支持 base64）
        async function callGroqVision(imageInput, apiKey, mode, modelName) {
            const model = modelName || 'meta-llama/llama-4-scout-17b-16e-instruct';
            
            // 构建图片 content：URL 或 base64
            let imageContent;
            if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
                imageContent = { type: 'image_url', image_url: { url: imageInput } };
            } else {
                imageContent = { type: 'image_url', image_url: { url: imageInput } }; // data:image/xxx;base64,...
            }
            
            const prompts = {
                'prompt': `你是一个顶级的AI绘画提示词工程师。请仔细观察这张图片的每一个细节，然后直接生成一段完整、精确的AI绘画提示词。

观察清单（必须在提示词中体现）：
1. 主体：是什么人物/动物/物体？姿势/动作/表情？服装/材质？数量？
2. 场景：室内还是室外？具体环境？有什么背景元素？
3. 风格：写实/插画/3D/油画/水彩/动漫/像素/赛博朋克等？
4. 光影：光源方向？光色温（暖光/冷光）？阴影软硬？有无逆光/侧光/顶光？
5. 色彩：主色调？配色方案？饱和度高低？对比度？
6. 构图：特写/中景/全景？视角（平视/俯视/仰视）？画面比例？
7. 质感：皮肤/金属/布料/玻璃/木质等材质细节？
8. 氛围：宁静/动感/神秘/温暖/冷酷/梦幻等？

输出要求：
- 直接输出提示词正文，不要任何解释、前缀或分析
- 提示词必须精准还原图片内容，不能凭空编造
- 用中文逗号分隔，质量词前置，结构紧凑`,

                'prompt-en': `You are a world-class AI art prompt engineer. Examine this image with extreme attention to every detail, then generate a complete, precise English prompt.

Observation checklist: 1.Subject 2.Scene 3.Style 4.Lighting 5.Color 6.Composition 7.Texture 8.Atmosphere.

Output ONLY the prompt text, comma-separated English, quality tags first, compact.`,
                
                'detailed': `请作为图片分析专家，对这张图片进行极其详尽的观察和描述。必须覆盖：主体内容、背景场景、艺术风格、光影设计、色彩方案、构图方式、材质质感、氛围情绪。请用自然中文输出，每个维度单独成段，尽可能详细具体。`,
                
                'keywords': `请作为AI绘画关键词专家，极其仔细地分析这张图片，按以下分类提取精准关键词：画质词、主体、场景、风格、光影、色彩、构图、质感、氛围。每个分类输出3-5个中文逗号分隔的精准关键词。`,
                
                'wand': `你是一个顶级AI绘画提示词工程师。请仔细观察这张图片，为以下AI绘画模型分别生成最精准的提示词：1.万相格式（中文逗号分隔，质量词前置）2.Seedream格式（英文逗号，带权重标注）3.千问图像格式（自然语言完整句子描述）4.通用格式（精简英文关键词，逗号分隔）`
            };
            
            const prompt = prompts[mode] || prompts['detailed'];
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);
            let response;
            try {
                response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{
                            role: 'user',
                            content: [imageContent, { type: 'text', text: prompt }]
                        }],
                        max_tokens: 2048,
                        temperature: 0.4
                    }),
                    signal: controller.signal
                });
            } catch (fetchErr) {
                if (fetchErr.name === 'AbortError') {
                    throw new Error('Groq API 请求超时（60秒），请重试或切换模型');
                }
                throw fetchErr;
            } finally {
                clearTimeout(timeoutId);
            }
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || `HTTP ${response.status}`;
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Groq API Key 无效，请检查（Key 格式应为 gsk_...）');
                }
                if (response.status === 429) {
                    throw new Error('Groq 请求过于频繁，请稍后再试');
                }
                throw new Error('Groq: ' + errMsg);
            }
            
            const data = await response.json();
            const text = data.choices?.[0]?.message?.content;
            if (!text) throw new Error('Groq AI 未返回有效结果');
            
            return parseResult(text, mode);
        }

        // 智谱视觉模型调用（支持多模型切换）
        async function callZhipuVision(imageInput, apiKey, mode, modelName) {
            const model = modelName || imagePromptState.zhipuModel || 'glm-4v-flash';
            
            // 判断是 URL 还是 base64
            const isUrl = imageInput.startsWith('http://') || imageInput.startsWith('https://');
            
            let imagePayload;
            if (isUrl) {
                // 直接使用 URL
                imagePayload = imageInput;
                console.log('[Zhipu] using image URL:', imageInput);
            } else {
                // 提取纯 base64（去除 data:image/xxx;base64, 前缀）
                const matches = imageInput.match(/^data:(image\/\w+);base64,(.+)$/);
                const mimeType = matches ? matches[1] : 'image/jpeg';
                const pureBase64 = matches ? matches[2] : imageInput;
                // 智谱API使用完整 Data URL 格式：data:image/jpeg;base64,...
                imagePayload = `data:${mimeType};base64,${pureBase64}`;
                console.log('[Zhipu] using base64, length:', imagePayload.length);
            }
            
            const prompts = {
                'prompt': `你是一个顶级的AI绘画提示词工程师。请仔细观察这张图片的每一个细节，然后直接生成一段完整、精确的AI绘画提示词。

观察清单（必须在提示词中体现）：
1. 主体：是什么人物/动物/物体？姿势/动作/表情？服装/材质？数量？
2. 场景：室内还是室外？具体环境？有什么背景元素？
3. 风格：写实/插画/3D/油画/水彩/动漫/像素/赛博朋克等？
4. 光影：光源方向？光色温（暖光/冷光）？阴影软硬？有无逆光/侧光/顶光？
5. 色彩：主色调？配色方案？饱和度高低？对比度？
6. 构图：特写/中景/全景？视角（平视/俯视/仰视）？画面比例？
7. 质感：皮肤/金属/布料/玻璃/木质等材质细节？
8. 氛围：宁静/动感/神秘/温暖/冷酷/梦幻等？

输出要求：
- 直接输出提示词正文，不要任何解释、前缀或分析
- 提示词必须精准还原图片内容，不能凭空编造
- 用中文逗号分隔，质量词前置，结构紧凑
- 例如："超高画质，8K，杰作，[主体描述]，[场景]，[风格]，[光影]，[色彩]，[构图]，[质感]，[氛围]"`,

                'prompt-en': `You are a world-class AI art prompt engineer. Examine this image with extreme attention to every detail, then generate a complete, precise English prompt.

Observation checklist (must reflect in prompt):
1. Subject: Who/what? Pose/action/expression? Clothing/material? Count?
2. Scene: Indoor/outdoor? Specific environment? Background elements?
3. Style: Photorealistic/illustration/3D/oil painting/watercolor/anime/pixel art/cyberpunk?
4. Lighting: Light source direction? Warm/cool light? Hard/soft shadows? Backlight/side light/top light?
5. Color: Dominant colors? Color scheme? Saturation? Contrast?
6. Composition: Close-up/medium/wide shot? Angle (eye-level/low-angle/high-angle)?
7. Texture: Skin/metal/fabric/glass/wood material details?
8. Atmosphere: Serene/dynamic/mysterious/warm/cold/dreamy?

Requirements:
- Output ONLY the prompt text, no explanations or prefixes
- Be precise and faithful to the actual image content
- Use English, comma-separated, quality tags first, compact
- Format: "masterpiece, best quality, 8K, [subject], [scene], [style], [lighting], [color], [composition], [texture], [atmosphere]"`,

                'detailed': `请作为图片分析专家，对这张图片进行极其详尽的观察和描述。必须覆盖以下每个维度：

1. 主体内容：精确描述画面中的主要对象（人物特征/物体形态/动物种类等），包括具体姿态、表情、动作、服饰细节
2. 背景场景：详细描述所处环境（室内外、具体场所类型、背景元素和装饰物）
3. 艺术风格：判断画风类型（写实摄影/3D渲染/手绘插画/概念艺术/油画/水彩/动漫/像素艺术/赛博朋克等）
4. 光影设计：分析光源方向、光质（硬光/柔光）、色温、阴影分布、高光位置
5. 色彩方案：列出主色调、辅助色、点缀色，分析饱和度、明暗对比、色彩情绪
6. 构图方式：描述视角、景别、主体位置、引导线、留白比例、画面平衡感
7. 材质质感：描述画面中各类物体的材质表现（金属光泽/布料纹理/皮肤质感/玻璃透明感等）
8. 氛围情绪：用精准词汇描述整体画面的情感氛围和视觉感受

请用自然中文输出，每个维度单独成段，尽可能详细具体。`,

                'keywords': `请作为AI绘画关键词专家，极其仔细地分析这张图片，按以下分类提取精确关键词：

- 画质词: 基于图片实际画质，选择超高画质、8K、杰作、超精细、HDR、锐利等
- 主体: 精确描述主体（人物性别年龄发型表情服装/动物品种姿态/物体形态颜色）
- 场景: 具体环境场所（不要只说"室内"，要具体到"现代简约客厅""日式庭院"等）
- 风格: 准确判断画风（3D渲染/写实摄影/二次元/油画/水彩/概念艺术/赛博朋克等）
- 光影: 光源类型（自然光/霓虹灯/烛光/柔光箱）、方向、色温
- 色彩: 主色调和配色（莫兰迪色系/赛博朋克霓虹/日系清新/复古胶片等）
- 构图: 景别和视角（特写/半身/全身/广角、平视/俯视/仰视、三分法/对称/对角线）
- 质感: 关键材质（皮革/丝绸/金属/玻璃/木质/塑料/毛绒）
- 氛围: 情感调性（宁静/动感/神秘/浪漫/忧郁/庄严/活泼/梦幻）

每个分类输出3-5个中文逗号分隔的精准关键词。`,

                'wand': `你是一个顶级AI绘画提示词工程师。请仔细观察这张图片，为以下AI绘画模型分别生成最精准的提示词：

1. **万相格式**（中文逗号分隔，质量词前置）：
   格式：超高画质，杰作，[主体]，[场景]，[风格]，[光影]，[色彩]，[构图]，[质感]，[氛围]

2. **Seedream格式**（英文逗号，带权重标注）：
   格式：masterpiece, best quality, (subject:1.2), (scene:1.1), (style:1.2), (lighting:1.1), (color:1.1), (composition), (texture), (atmosphere)

3. **千问图像格式**（自然语言完整句子描述）：
   格式：这是一幅/一张...，画面中...，背景是...，整体呈现...风格，光线...，色彩...，给人...的感觉。

4. **通用格式**（精简英文关键词，逗号分隔）：
   格式：masterpiece, high quality, [subject keywords], [scene], [style], [lighting], [color], [composition]

请确保每个格式都精准还原图片，不要添加图片中不存在的内容。`
            };

            const prompt = prompts[mode] || prompts['detailed'];
            
            // 构建请求体
            // 智谱API content 数组中 image_url 在前、text 在后（与官方示例一致）
            const buildBody = (imageUrl) => {
                const body = {
                    model: model,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: imageUrl } },
                            { type: 'text', text: prompt }
                        ]
                    }]
                };
                // 付费模型支持 temperature 和 max_tokens，免费 Flash 模型不支持
                if (!model.includes('flash')) {
                    body.temperature = 0.4;
                    body.max_tokens = 2048;
                }
                return body;
            };

            // 如果是 URL，简单检查可访问性
            if (isUrl) {
                console.log('[Zhipu] Image URL:', imagePayload);
                // 提示用户确认 URL 是公开可访问的图片直链
                const isDirectImage = /\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$/i.test(imagePayload);
                if (!isDirectImage) {
                    console.warn('[Zhipu] URL 可能不是图片直链，智谱服务器可能无法访问');
                }
            }

            // 打印完整请求体用于调试
            const requestBody = buildBody(imagePayload);
            console.log('[Zhipu] Request body:', JSON.stringify(requestBody, null, 2));

            // 创建带超时的 fetch
            const fetchWithTimeout = (url, options, timeoutMs = 60000) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
            };

            // 调用 API
            let response;
            try {
                response = await fetchWithTimeout('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(requestBody)
                });
            } catch (fetchErr) {
                if (fetchErr.name === 'AbortError') {
                    throw new Error('智谱 API 请求超时（60秒），请尝试切换模型或减小图片大小');
                }
                throw fetchErr;
            }

            // 如果是 base64 模式且失败，尝试纯 base64 格式重试（仅非 URL 模式）
            if (!response.ok && !isUrl) {
                const errData = await response.json().catch(() => ({}));
                console.error('[Zhipu] Error with data URL:', JSON.stringify(errData));
                
                // 提取纯 base64 用于重试
                const matches = imageInput.match(/^data:(image\/\w+);base64,(.+)$/);
                const pureBase64 = matches ? matches[2] : imageInput;
                
                const errMsg = (errData.error?.message || '').toLowerCase();
                if (errMsg.includes('参数') || errMsg.includes('格式') || errMsg.includes('base64') || errMsg.includes('image')) {
                    console.log('[Zhipu] Retrying with pure base64 format...');
                    try {
                        response = await fetchWithTimeout('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify(buildBody(pureBase64))
                        });
                    } catch (retryErr) {
                        if (retryErr.name === 'AbortError') {
                            throw new Error('智谱 API 请求超时（60秒），请尝试切换模型或减小图片大小');
                        }
                        throw retryErr;
                    }
                }
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                console.error('[Zhipu] Final error:', JSON.stringify(errData));
                const finalErrMsg = errData.error?.message || `HTTP ${response.status}`;
                const errCode = errData.error?.code || '';
                if (response.status === 401 || response.status === 403) {
                    throw new Error('智谱 API Key 无效，请检查 Key 是否正确且未过期');
                }
                if (response.status === 429) {
                    throw new Error('智谱 API 请求过于频繁，请稍后再试');
                }
                // 1210: 参数错误 - 可能是图片URL无法访问、格式不支持等
                if (errCode === '1210') {
                    if (isUrl) {
                        throw new Error('智谱参数错误：图片URL可能无法被智谱服务器访问，请确保URL是公开可访问的图片直链（以.jpg/.png/.webp等结尾），或尝试切换其他模型');
                    } else {
                        throw new Error('智谱参数错误：免费Flash模型不支持本地上传，请使用图片URL，或切换到付费模型（GLM-4V-Plus等）');
                    }
                }
                throw new Error('智谱: ' + finalErrMsg);
            }

            const data = await response.json();
            const text = data.choices?.[0]?.message?.content;
            if (!text) throw new Error('智谱 AI 未返回有效结果');

            return parseResult(text, mode);
        }

        function parseResult(text, mode) {
            // 提取关键词
            const extracted = extractKeywords(text);
            const keywords = extracted.keywords || [];
            const categoryMap = extracted.categoryMap || {};
            
            // 为提示词反推模式解析各模型格式
            let variants = [];
            if (mode === 'wand') {
                variants = parseWandResult(text);
            } else {
                // 为非wand模式生成简化的变体
                variants = [
                    {
                        label: '填入结果区',
                        text: text.trim(),
                        model: 'raw'
                    }
                ];
            }
            
            return {
                description: text.trim(),
                keywords: keywords,
                categoryMap: categoryMap,
                variants: variants,
                mode: mode
            };
        }

        function extractKeywords(text) {
            // 从文本中提取关键词，同时保留分类→关键词的映射
            const lines = text.split('\n').filter(l => l.trim());
            const keywords = [];
            const seen = new Set();
            const categoryMap = {};  // { "画质": ["超高画质","8K"], "风格": ["极简主义"], ... }
            
            for (const line of lines) {
                // 匹配分类下的关键词: "画质: 超高画质, 8K, 杰作"
                const match = line.match(/^[-•*]?\s*([^:：]+)[:：]\s*(.+)$/);
                if (match) {
                    const catName = match[1].trim();
                    const kws = match[2].split(/[,，、]/).map(k => k.trim()).filter(k => k.length > 1 && k.length < 30);
                    if (kws.length > 0) {
                        if (!categoryMap[catName]) categoryMap[catName] = [];
                        for (const kw of kws) {
                            if (!categoryMap[catName].includes(kw)) {
                                categoryMap[catName].push(kw);
                            }
                            if (!seen.has(kw)) {
                                seen.add(kw);
                                keywords.push(kw);
                            }
                        }
                    }
                }
            }
            
            // 如果提取不到分类关键词，尝试从全文提取逗号分隔的短语
            if (keywords.length === 0) {
                const phrases = text.split(/[,，、\n]/).map(p => p.trim()).filter(p => p.length > 1 && p.length < 30);
                for (const p of phrases) {
                    if (!seen.has(p) && !/^[#\-\*]/.test(p)) {
                        seen.add(p);
                        keywords.push(p);
                    }
                }
                return { keywords: keywords.slice(0, 30), categoryMap: {} };
            }
            
            return { keywords: keywords.slice(0, 30), categoryMap };
        }

        function parseWandResult(text) {
            const variants = [];
            const sections = text.split(/\*\*(.+?)\*\*/);
            
            for (let i = 1; i < sections.length; i += 2) {
                const label = sections[i].trim();
                const content = (sections[i + 1] || '').trim().replace(/^[:：]\s*/, '').replace(/\n+/g, ' ').trim();
                
                let modelLabel = 'raw';
                if (label.includes('万相')) modelLabel = 'wanxiang';
                else if (label.includes('Seedream') || label.includes('seedream')) modelLabel = 'seedream';
                else if (label.includes('千问')) modelLabel = 'qwen-image';
                else if (label.includes('通用')) modelLabel = 'z-image-turbo';
                
                if (content) {
                    variants.push({
                        label: label,
                        text: content,
                        model: modelLabel
                    });
                }
            }
            
            // 如果解析失败，把全文作为一个变体
            if (variants.length === 0) {
                variants.push({
                    label: '反推结果',
                    text: text.trim(),
                    model: 'raw'
                });
            }
            
            return variants;
        }

        function fillToResult(text, modelId) {
            // 自动切换到词汇组合视图
            if (currentView !== 'compose') {
                switchView('compose');
            }
            
            // 填入结果文本框
            const textarea = document.getElementById('resultTextarea');
            if (textarea) {
                textarea.value = text;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
            // 如果指定了模型，切换到该模型
            if (modelId && typeof selectModel === 'function') {
                selectModel(modelId);
            }
            
            // 滚动到结果区
            setTimeout(() => {
                const resultPanel = document.querySelector('.result-panel');
                if (resultPanel) {
                    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 150);
            
            showToast('已填入词汇组合结果区', 'success');
        }

        function clearImagePrompt() {
            removeImage();
            imagePromptState.resultData = null;
            imagePromptState.imageUrl = '';
            // 清空 URL 输入框
            const urlInput = document.getElementById('imageUrlInput');
            if (urlInput) urlInput.value = '';
            const modes = document.querySelectorAll('#promptModes .mode-btn');
            if (modes.length > 0) {
                modes.forEach((b, i) => b.classList.toggle('active', i === 0));
            }
            imagePromptState.promptMode = 'prompt';
            // 清空结果文本框
            const textarea = document.getElementById('ipResultTextarea');
            if (textarea) textarea.value = '';
            const charCount = document.getElementById('resultCharCount');
            if (charCount) charCount.textContent = '0 / 2000';
            const badge = document.getElementById('resultModelBadge');
            if (badge) badge.textContent = '';
        }

