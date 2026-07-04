/* =============================================
   SMART HOME PRO - APPLICATION COMPLÈTE
   Arduino : Portes & Fenêtres uniquement
   ============================================= */

class SmartHomeApp {
    constructor() {
        // Configuration GPS
        this.HOME_LATITUDE = 48.8566;
        this.HOME_LONGITUDE = 2.3522;
        this.PROXIMITY_RADIUS = 2;

        // État
        this.isLoggedIn = false;
        this.currentUser = null;
        this.isInProximity = false;
        this.geoWatchId = null;
        this.currentConfigCameraId = null;
        this.recordingTimers = {};
        this.rememberMe = false;
        this._recorders = new Map();

        // Utilisateurs
        this.users = [];

        // Configuration Arduino (UNIQUEMENT pour portes/fenêtres)
        // Format : { 'door-1': { ip: '192.168.1.100' }, 'door-2': { ip: '192.168.1.101' } }
        this.arduinoDevices = {};

        // Appareils par défaut
        this.devices = [
            // PORTES (contrôlables par Arduino)
            { id: 'door-1', name: 'Porte Principale', type: 'door', room: 'Entrée', status: 'closed', icon: 'fa-door-closed', arduinoIP: null },
            { id: 'door-2', name: 'Porte Arrière', type: 'door', room: 'Cuisine', status: 'closed', icon: 'fa-door-closed', arduinoIP: null },
            
            // FENÊTRES (contrôlables par Arduino)
            { id: 'window-1', name: 'Fenêtre Salon', type: 'window', room: 'Salon', status: 'closed', icon: 'fa-window-maximize', arduinoIP: null },
            { id: 'window-2', name: 'Fenêtre Chambre', type: 'window', room: 'Chambre', status: 'closed', icon: 'fa-window-maximize', arduinoIP: null },
            
            // LUMIÈRES (pas d'Arduino, contrôle local)
            { id: 'light-1', name: 'Plafond Salon', type: 'light', room: 'Salon', status: 'off', icon: 'fa-lightbulb' },
            { id: 'light-2', name: 'Lampe Cuisine', type: 'light', room: 'Cuisine', status: 'off', icon: 'fa-lightbulb' },
            { id: 'light-3', name: 'Lumière Chambre', type: 'light', room: 'Chambre', status: 'off', icon: 'fa-lightbulb' },
            
            // CAMÉRAS (pas d'Arduino)
            { id: 'camera-1', name: 'Caméra Entrée', type: 'camera', room: 'Entrée', status: 'online', icon: 'fa-video', cameraUrl: null, streamType: null, localStream: null, captures: [] },
            { id: 'camera-2', name: 'Caméra Jardin', type: 'camera', room: 'Jardin', status: 'online', icon: 'fa-video', cameraUrl: null, streamType: null, localStream: null, captures: [] },
        ];

        this.notifications = [];
        this.activityLog = [];

        this.init();
    }

    /* ==================== INITIALISATION ==================== */
    init() {
        console.log('🏠 Smart Home Pro - Démarrage...');
        this.loadAllData();
        this.setupEventListeners();

        if (this.users.length === 0) {
            this.createDefaultAdmin();
        }

        if (this.isLoggedIn && this.currentUser) {
            this.showDashboard();
            this.startProximityCheck();
        }

        console.log('✅ Prêt | Utilisateurs:', this.users.length, '| Appareils:', this.devices.length);
        console.log('🔌 Arduino configurés:', Object.keys(this.arduinoDevices).length);
    }

    loadAllData() {
        try {
            const saved = localStorage.getItem('smarthome_data');
            if (saved) {
                const data = JSON.parse(saved);
                this.devices = data.devices || this.devices;
                this.activityLog = data.activityLog || [];
                this.notifications = data.notifications || [];
                this.devices.forEach(d => {
                    d.localStream = null;
                    d.motionInterval = null;
                    if (d.type === 'camera' && d.status === 'recording') d.status = 'online';
                });
            }
        } catch (e) { console.error('Erreur chargement:', e); }

        try {
            const usersSaved = localStorage.getItem('smarthome_users');
            if (usersSaved) this.users = JSON.parse(usersSaved);
        } catch (e) {}

        try {
            const sessionSaved = localStorage.getItem('smarthome_session');
            if (sessionSaved) {
                const session = JSON.parse(sessionSaved);
                this.rememberMe = session.rememberMe || false;
                if (session.userId) {
                    const user = this.users.find(u => u.id === session.userId);
                    if (user) {
                        this.currentUser = {
                            id: user.id, username: user.username, email: user.email,
                            initial: user.username.charAt(0).toUpperCase(), isAdmin: user.isAdmin || false
                        };
                        this.isLoggedIn = true;
                    }
                }
            }
        } catch (e) {}

        // Charger config Arduino (portes/fenêtres uniquement)
        try {
            const arduinoSaved = localStorage.getItem('smarthome_arduino');
            if (arduinoSaved) this.arduinoDevices = JSON.parse(arduinoSaved);
        } catch (e) {}
    }

    saveAllData() {
        try {
            const devicesCopy = this.devices.map(d => {
                const { localStream, motionInterval, ...rest } = d;
                return rest;
            });
            localStorage.setItem('smarthome_data', JSON.stringify({
                devices: devicesCopy, activityLog: this.activityLog, notifications: this.notifications
            }));
        } catch (e) {}
    }

    saveUsers() {
        try {
            localStorage.setItem('smarthome_users', JSON.stringify(this.users));
            localStorage.setItem('smarthome_session', JSON.stringify({
                rememberMe: this.rememberMe, userId: this.currentUser?.id || null
            }));
        } catch (e) {}
    }

    saveArduinoConfig() {
        try { localStorage.setItem('smarthome_arduino', JSON.stringify(this.arduinoDevices)); } catch (e) {}
    }

    setupEventListeners() {
        const loginForm = document.getElementById('login-form');
        if (loginForm) loginForm.addEventListener('submit', (e) => { e.preventDefault(); this.login(); });

        const registerForm = document.getElementById('register-form');
        if (registerForm) registerForm.addEventListener('submit', (e) => { e.preventDefault(); this.register(); });

        const regPassword = document.getElementById('reg-password');
        if (regPassword) regPassword.addEventListener('input', () => this.checkPasswordStrength(regPassword.value));

        const regConfirm = document.getElementById('reg-confirm-password');
        if (regConfirm) regConfirm.addEventListener('input', () => {
            const pw = document.getElementById('reg-password').value;
            regConfirm.style.borderColor = pw === regConfirm.value ? 'var(--accent)' : 'var(--danger)';
        });

        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        const overlay = document.getElementById('panel-overlay');
        if (overlay) overlay.addEventListener('click', () => this.toggleNotificationPanel());

        document.querySelectorAll('.modal-overlay').forEach(ov => {
            ov.addEventListener('click', (e) => {
                if (e.target === ov) {
                    this.closeAddDeviceModal(); this.closeConfigCameraModal(); this.closeProfileModal();
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAddDeviceModal(); this.closeConfigCameraModal(); this.closeProfileModal();
                if (document.getElementById('notification-panel')?.classList.contains('active')) {
                    this.toggleNotificationPanel();
                }
            }
            if (e.ctrlKey && e.key === 'p') { e.preventDefault(); this.simulateProximity(); }
        });

        window.addEventListener('beforeunload', () => {
            this.stopAllCameraStreams();
            Object.values(this.recordingTimers).forEach(t => clearInterval(t));
            this.devices.forEach(d => { if (d.motionInterval) clearInterval(d.motionInterval); });
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.refreshAllVideoStreams();
        });
    }

    /* ==================== HASHAGE ==================== */
    hashPassword(password) {
        let hash = password;
        for (let i = 0; i < 1000; i++) hash = this._simpleHash(hash + 'SmartHomeSalt' + i);
        return hash;
    }
    _simpleHash(str) { let hash = 0; for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash = hash & hash; } return Math.abs(hash).toString(36); }
    verifyPassword(password, hash) { return this.hashPassword(password) === hash; }
    isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

    /* ==================== AUTH ==================== */
    switchAuthTab(tab) {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        const tabBtn = document.querySelector(`.auth-tab[onclick*="${tab}"]`);
        if (tabBtn) tabBtn.classList.add('active');
        document.getElementById('login-form').classList.toggle('active', tab === 'login');
        document.getElementById('register-form').classList.toggle('active', tab === 'register');
        document.getElementById('login-error').classList.remove('show');
        document.getElementById('login-success').classList.remove('show');
    }

    showError(message) {
        const el = document.getElementById('login-error');
        if (el) { el.textContent = message; el.classList.add('show'); document.getElementById('login-success')?.classList.remove('show'); setTimeout(() => el.classList.remove('show'), 4000); }
    }

    showSuccess(message) {
        const el = document.getElementById('login-success');
        if (el) { el.textContent = message; el.classList.add('show'); document.getElementById('login-error')?.classList.remove('show'); }
    }

    register() {
        const username = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-confirm-password').value;

        if (!username || !email || !password) { this.showError('Tous les champs sont requis'); return; }
        if (username.length < 3) { this.showError('Nom : 3 caractères minimum'); return; }
        if (!this.isValidEmail(email)) { this.showError('Email invalide'); return; }
        if (password.length < 6) { this.showError('Mot de passe : 6 caractères minimum'); return; }
        if (password !== confirm) { this.showError('Les mots de passe ne correspondent pas'); return; }
        if (this.users.find(u => u.username.toLowerCase() === username.toLowerCase())) { this.showError('Nom déjà pris'); return; }
        if (this.users.find(u => u.email.toLowerCase() === email.toLowerCase())) { this.showError('Email déjà utilisé'); return; }

        this.users.push({
            id: 'user-' + Date.now(), username, email: email.toLowerCase(),
            password: this.hashPassword(password), createdAt: new Date().toISOString(),
            lastLogin: null, isAdmin: false, settings: { theme: 'dark', notifications: true }
        });
        this.saveUsers();
        this.showSuccess('✅ Compte créé ! Connectez-vous.');

        ['reg-username', 'reg-email', 'reg-password', 'reg-confirm-password'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });

        setTimeout(() => { this.switchAuthTab('login'); document.getElementById('login-username').value = username; document.getElementById('login-password').focus(); }, 1500);
        this.logActivity('Inscription : ' + username, 'system', '👤');
    }

    login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const rememberMe = document.getElementById('remember-me')?.checked || false;

        if (!username || !password) { this.showError('Champs requis'); return; }

        const user = this.users.find(u => u.username.toLowerCase() === username.toLowerCase() || u.email.toLowerCase() === username.toLowerCase());
        if (!user) { this.showError('Utilisateur introuvable'); return; }
        if (!this.verifyPassword(password, user.password)) { this.showError('Mot de passe incorrect'); return; }

        this.isLoggedIn = true;
        this.currentUser = { id: user.id, username: user.username, email: user.email, initial: user.username.charAt(0).toUpperCase(), isAdmin: user.isAdmin || false };
        this.rememberMe = rememberMe;
        user.lastLogin = new Date().toISOString();
        this.saveUsers(); this.saveAllData();
        this.showDashboard(); this.startProximityCheck();
        this.logActivity('Connexion : ' + user.username, 'login', '🔑');
        this.showToast('Bienvenue ' + user.username + ' ! 🏠', 'success');
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
    }

    logout() {
        this.stopAllCameraStreams();
        Object.values(this.recordingTimers).forEach(t => clearInterval(t));
        this.devices.forEach(d => { if (d.motionInterval) clearInterval(d.motionInterval); });
        this.isLoggedIn = false;
        if (!this.rememberMe) this.currentUser = null;
        this.stopProximityCheck();
        document.getElementById('dashboard-screen').classList.remove('active');
        document.getElementById('login-screen').classList.add('active');
        this.saveAllData();
    }

    showDashboard() {
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('dashboard-screen').classList.add('active');
        if (this.currentUser) {
            document.getElementById('user-avatar').textContent = this.currentUser.initial;
            document.getElementById('user-name').textContent = this.currentUser.username;
        }
        this.updateConnectionUI();
        this.switchTab('dashboard');
        this.renderAll();
    }

    /* ==================== PROFIL ==================== */
    openProfileModal() {
        if (!this.currentUser) return;
        document.getElementById('profile-avatar').textContent = this.currentUser.initial;
        document.getElementById('profile-name').textContent = this.currentUser.username;
        document.getElementById('profile-email').textContent = this.currentUser.email;
        const user = this.users.find(u => u.id === this.currentUser.id);
        if (user) document.getElementById('profile-date').textContent = 'Membre depuis le ' + new Date(user.createdAt).toLocaleDateString('fr-FR');
        document.getElementById('modal-profile').classList.add('active');
    }
    closeProfileModal() {
        document.getElementById('modal-profile').classList.remove('active');
        ['current-password', 'new-password', 'confirm-new-password'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    }

    changePassword() {
        const cp = document.getElementById('current-password').value;
        const np = document.getElementById('new-password').value;
        const conf = document.getElementById('confirm-new-password').value;
        if (!cp || !np || !conf) { this.showToast('Champs requis', 'error'); return; }
        if (np.length < 6) { this.showToast('6 caractères minimum', 'error'); return; }
        if (np !== conf) { this.showToast('Ne correspondent pas', 'error'); return; }
        const user = this.users.find(u => u.id === this.currentUser.id);
        if (!user) { this.showToast('Utilisateur introuvable', 'error'); return; }
        if (!this.verifyPassword(cp, user.password)) { this.showToast('Mot de passe actuel incorrect', 'error'); return; }
        user.password = this.hashPassword(np);
        this.saveUsers(); this.closeProfileModal();
        this.showToast('✅ Mot de passe mis à jour !', 'success');
        this.logActivity('Mot de passe modifié', 'system', '🔒');
    }

    deleteAccount() {
        if (!confirm('⚠️ Supprimer votre compte ? IRRÉVERSIBLE.')) return;
        if (!confirm('Confirmer ?')) return;
        this.users = this.users.filter(u => u.id !== this.currentUser.id);
        this.saveUsers();
        this.stopAllCameraStreams();
        this.isLoggedIn = false; this.currentUser = null; this.rememberMe = false;
        this.stopProximityCheck();
        document.getElementById('dashboard-screen').classList.remove('active');
        document.getElementById('login-screen').classList.add('active');
        this.saveAllData();
        this.showToast('Compte supprimé', 'info');
    }

    checkPasswordStrength(password) {
        const fill = document.getElementById('strength-fill'), text = document.getElementById('strength-text');
        if (!fill || !text) return;
        let s = 0;
        if (password.length >= 6) s++; if (password.length >= 10) s++;
        if (/[A-Z]/.test(password)) s++; if (/[0-9]/.test(password)) s++; if (/[^A-Za-z0-9]/.test(password)) s++;
        fill.className = 'strength-fill';
        if (s <= 1) { fill.classList.add('weak'); text.textContent = 'Faible'; }
        else if (s === 2) { fill.classList.add('fair'); text.textContent = 'Moyen'; }
        else if (s === 3) { fill.classList.add('good'); text.textContent = 'Bon'; }
        else { fill.classList.add('strong'); text.textContent = '💪 Fort !'; }
    }

    createDefaultAdmin() {
        this.users.push({
            id: 'admin-default', username: 'admin', email: 'admin@smarthome.local',
            password: this.hashPassword('admin123'), createdAt: new Date().toISOString(),
            lastLogin: null, isAdmin: true, settings: { theme: 'dark', notifications: true }
        });
        this.saveUsers();
        console.log('✅ Admin créé : admin / admin123');
    }

    /* ==================== PROXIMITÉ GPS ==================== */
    startProximityCheck() {
        if (!navigator.geolocation) { this.isInProximity = false; this.updateConnectionUI(); return; }
        this.geoWatchId = navigator.geolocation.watchPosition(
            (pos) => this._handlePosition(pos),
            (err) => { this.isInProximity = false; this.updateConnectionUI(); },
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
        );
    }
    _handlePosition(pos) {
        const d = this._calcDistance(pos.coords.latitude, pos.coords.longitude);
        const was = this.isInProximity;
        this.isInProximity = d <= this.PROXIMITY_RADIUS;
        if (was !== this.isInProximity) { this.updateConnectionUI(); this.renderAll(); }
        const dt = document.getElementById('distance-text');
        if (dt) dt.textContent = d < 1 ? ` (${(d*100).toFixed(0)} cm)` : ` (${d.toFixed(1)} m)`;
    }
    stopProximityCheck() { if (this.geoWatchId !== null) { navigator.geolocation.clearWatch(this.geoWatchId); this.geoWatchId = null; } this.isInProximity = false; this.updateConnectionUI(); }
    _calcDistance(lat1, lon1) { const R=6371000,dLat=(this.HOME_LATITUDE-lat1)*Math.PI/180,dLon=(this.HOME_LONGITUDE-lon1)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(this.HOME_LATITUDE*Math.PI/180)*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
    simulateProximity() { this.isInProximity=!this.isInProximity; this.updateConnectionUI(); this.renderAll(); this.showToast(this.isInProximity?'📍 Proximité ACTIVÉE':'📍 Proximité DÉSACTIVÉE',this.isInProximity?'success':'warning'); }
    canControl() { if(!this.isInProximity){this.showToast('❌ À moins de 2m (Ctrl+P pour simuler)','error');return false;} return true; }

    /* ==================== CONTRÔLE APPAREILS (AVEC ARDUINO POUR PORTES/FENÊTRES) ==================== */
    
    /**
     * Active/désactive un appareil
     * Pour les portes/fenêtres : envoie commande à Arduino si configuré
     * Pour les lumières : contrôle local
     */
    toggleDevice(deviceId) {
        if (!this.canControl()) return;

        const device = this.devices.find(d => d.id === deviceId);
        if (!device || device.type === 'camera') return;

        // Si c'est une porte ou fenêtre ET qu'un Arduino est configuré
        if ((device.type === 'door' || device.type === 'window') && this.arduinoDevices[deviceId]?.ip) {
            this._sendToArduino(deviceId);
            return;
        }

        // Sinon, contrôle local
        if (device.type === 'door' || device.type === 'window') {
            device.status = device.status === 'open' ? 'closed' : 'open';
        } else if (device.type === 'light') {
            device.status = device.status === 'on' ? 'off' : 'on';
        }

        const action = this._getActionText(device);
        this.addNotification(`${this._getEmoji(device.type)} ${device.name} ${action}`, 'info');
        this.logActivity(`${device.name} ${action}`, device.type, this._getEmoji(device.type));
        this.showToast(`${device.name} ${action}`, 'success');
        this.saveAllData();
        this.renderAll();
    }

    /**
     * Envoie une commande à l'Arduino (toggle ouverture/fermeture)
     */
    async _sendToArduino(deviceId) {
        const config = this.arduinoDevices[deviceId];
        const device = this.devices.find(d => d.id === deviceId);
        if (!config?.ip || !device) return;

        this.showToast('📡 Envoi commande à Arduino...', 'info');

        try {
            const response = await fetch(`http://${config.ip}/toggle`);
            const data = await response.json();

            if (data.success) {
                device.status = data.status;
                this.saveAllData();
                this.renderAll();
                this.showToast(`✅ Arduino : ${data.message || 'OK'}`, 'success');
                this.logActivity(`Arduino : ${device.name} ${data.status === 'open' ? 'ouverte' : 'fermée'}`, device.type, '🤖');
            } else {
                throw new Error('Échec commande');
            }
        } catch (error) {
            console.error('❌ Arduino inaccessible:', error);
            this.showToast('❌ Arduino inaccessible - Mode local activé', 'error');
            
            // Fallback local
            device.status = device.status === 'open' ? 'closed' : 'open';
            this.saveAllData();
            this.renderAll();
            this.logActivity(`${device.name} ${this._getActionText(device)} (local)`, device.type, '💻');
        }
    }

    /**
     * Configure l'IP Arduino pour une porte/fenêtre
     */
    configureArduinoIP(deviceId) {
        const device = this.devices.find(d => d.id === deviceId);
        if (!device || (device.type !== 'door' && device.type !== 'window')) {
            this.showToast('⚠️ Arduino uniquement pour portes et fenêtres', 'warning');
            return;
        }

        const currentIP = this.arduinoDevices[deviceId]?.ip || '';
        const ip = prompt(
            `🔌 Configuration Arduino\n\n` +
            `Appareil : ${device.name} (${device.type === 'door' ? 'Porte' : 'Fenêtre'})\n` +
            `IP actuelle : ${currentIP || 'Non configurée'}\n\n` +
            `Entrez l'adresse IP de l'ESP8266/ESP32 :\n` +
            `Exemple : 192.168.1.100`,
            currentIP
        );

        if (ip && ip.trim()) {
            this.arduinoDevices[deviceId] = { ip: ip.trim(), type: 'esp8266' };
            this.saveArduinoConfig();
            this.showToast(`✅ IP configurée : ${ip}`, 'success');
            this.testArduinoConnection(deviceId);
            this.renderAll();
        }
    }

    /**
     * Teste la connexion avec l'Arduino
     */
    async testArduinoConnection(deviceId) {
        const config = this.arduinoDevices[deviceId];
        if (!config?.ip) return;

        try {
            const response = await fetch(`http://${config.ip}/status`);
            if (response.ok) {
                const data = await response.json();
                this.showToast(`✅ ${data.name || 'Arduino'} connecté !`, 'success');
                console.log('✅ Arduino trouvé :', data);
                
                // Mettre à jour le statut
                const device = this.devices.find(d => d.id === deviceId);
                if (device && data.status) {
                    device.status = data.status;
                    this.saveAllData();
                    this.renderAll();
                }
            }
        } catch (error) {
            this.showToast('❌ Arduino inaccessible. Vérifiez l\'IP.', 'error');
        }
    }

    toggleAllLights() {
        if (!this.canControl()) return;
        const lights = this.devices.filter(d => d.type === 'light');
        if (!lights.length) { this.showToast('Aucune lumière', 'info'); return; }
        const anyOn = lights.some(l => l.status === 'on');
        lights.forEach(l => l.status = anyOn ? 'off' : 'on');
        const action = anyOn ? 'éteintes' : 'allumées';
        this.addNotification(`💡 Lumières ${action}`, 'info');
        this.logActivity(`Lumières ${action}`, 'light', '💡');
        this.showToast(`Lumières ${action}`, 'success');
        this.saveAllData(); this.renderAll();
    }

    closeAllDoorsWindows() {
        if (!this.canControl()) return;
        const items = this.devices.filter(d => (d.type === 'door' || d.type === 'window') && d.status === 'open');
        if (!items.length) { this.showToast('Tout fermé', 'info'); return; }
        items.forEach(i => {
            if (this.arduinoDevices[i.id]?.ip) {
                this._sendToArduino(i.id);
            } else {
                i.status = 'closed';
            }
        });
        this.addNotification(`🔒 ${items.length} fermeture(s)`, 'info');
        this.showToast(`${items.length} fermeture(s)`, 'success');
        this.saveAllData(); this.renderAll();
    }

    _getActionText(d) { return { door: { open:'ouverte',closed:'fermée' }, window: { open:'ouverte',closed:'fermée' }, light: { on:'allumée',off:'éteinte' } }[d.type]?.[d.status] || 'modifié(e)'; }
    _getEmoji(t) { return { door:'🚪', window:'🪟', light:'💡', camera:'📹' }[t] || '📦'; }

    /* ==================== CAMÉRAS ==================== */
    openConfigCameraModal(deviceId) {
        const device = this.devices.find(d => d.id === deviceId);
        if (!device || device.type !== 'camera') return;
        this.currentConfigCameraId = deviceId;
        document.getElementById('config-camera-url').value = device.cameraUrl || '';
        document.getElementById('modal-config-camera').classList.add('active');
    }
    closeConfigCameraModal() { document.getElementById('modal-config-camera').classList.remove('active'); this.currentConfigCameraId = null; }

    saveCameraConfig() {
        if (!this.currentConfigCameraId) return;
        const device = this.devices.find(d => d.id === this.currentConfigCameraId);
        if (!device) return;
        if (device.localStream) this._stopStream(device);
        device.cameraUrl = document.getElementById('config-camera-url').value.trim() || null;
        device.streamType = device.cameraUrl ? 'remote' : null;
        this.saveAllData(); this.renderAll(); this.closeConfigCameraModal();
        this.showToast('✅ Caméra configurée', 'success');
    }

    async usePhoneCamera() {
        if (!this.currentConfigCameraId) return;
        const device = this.devices.find(d => d.id === this.currentConfigCameraId);
        if (!device) return;
        this.closeConfigCameraModal();
        try {
            this._stopStream(device);
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment', width:{ideal:1280}, height:{ideal:720} }, audio:false });
            device.localStream = stream; device.cameraUrl = null; device.streamType = 'local'; device.status = 'recording';
            stream.getVideoTracks()[0].addEventListener('ended', () => { device.localStream=null; device.status='online'; device.streamType=null; this.saveAllData(); this.renderAll(); });
            this.saveAllData(); this.renderAll();
            setTimeout(() => this._attachStream(device.id, stream), 200);
            this.showToast('📱 Caméra activée !', 'success');
            this.logActivity(`Caméra ${device.name} activée`,'camera','📱');
        } catch(e) {
            let m='Erreur'; if(e.name==='NotAllowedError')m='Accès refusé'; else if(e.name==='NotFoundError')m='Pas de caméra';
            this.showToast('❌ '+m,'error');
        }
    }

    _stopStream(d) { if(d?.localStream){ d.localStream.getTracks().forEach(t=>t.stop()); d.localStream=null; d.streamType=null; if(d.type==='camera'&&d.status==='recording')d.status='online'; } }
    stopAllCameraStreams() { this.devices.forEach(d=>this._stopStream(d)); }
    _attachStream(id,stream){ const v=document.getElementById(`video-${id}`); if(v&&stream?.active){ v.srcObject=stream; v.muted=true; v.playsInline=true; v.play().catch(()=>{}); } }
    refreshAllVideoStreams() { this.devices.forEach(d=>{ if(d.type==='camera'&&d.localStream?.active)setTimeout(()=>this._attachStream(d.id,d.localStream),100); }); }

    /* ==================== CAPTURES ==================== */
    captureImage(deviceId) {
        const d=this.devices.find(x=>x.id===deviceId);
        if(!d||d.type!=='camera'){this.showToast('❌ Pas une caméra','error');return;}
        if(d.localStream?.active)this._captureVideo(d);
        else if(d.cameraUrl)this._captureUrl(d);
        else this.showToast('❌ Aucun flux','error');
    }
    _captureVideo(d) {
        const v=document.getElementById(`video-${d.id}`);
        if(!v?.srcObject){this.showToast('❌ Flux non dispo','error');return;}
        const c=document.createElement('canvas');c.width=v.videoWidth||640;c.height=v.videoHeight||480;
        const ctx=c.getContext('2d');ctx.drawImage(v,0,0,c.width,c.height);
        ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,c.height-35,c.width,35);
        ctx.fillStyle='#fff';ctx.font='14px monospace';ctx.fillText(new Date().toLocaleString('fr-FR'),10,c.height-10);
        this._saveCapture(d,c.toDataURL('image/jpeg',0.85));this._flash(d.id);
    }
    _captureUrl(d) {
        const img=document.getElementById(`img-${d.id}`);
        if(!img?.complete||img.naturalWidth===0){this.showToast('❌ Image non chargée','error');return;}
        const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
        const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
        ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,c.height-35,c.width,35);
        ctx.fillStyle='#fff';ctx.font='14px monospace';ctx.fillText(new Date().toLocaleString('fr-FR'),10,c.height-10);
        this._saveCapture(d,c.toDataURL('image/jpeg',0.85));this._flash(d.id);
    }
    _saveCapture(d,dataUrl) {
        if(!d.captures)d.captures=[];
        d.captures.unshift({id:'cap-'+Date.now(),timestamp:new Date().toISOString(),imageData:dataUrl,size:(dataUrl.length/1024).toFixed(1)+' KB'});
        if(d.captures.length>50)d.captures=d.captures.slice(0,50);
        this.saveAllData();this.showToast('📸 Capture !','success');
        if(document.getElementById(`gallery-${d.id}`)?.classList.contains('active'))this._renderGallery(d.id);
    }
    _flash(id){const c=document.querySelector(`#video-${id}`)?.parentElement||document.querySelector(`#img-${id}`)?.parentElement;if(c){c.style.filter='brightness(2)';setTimeout(()=>c.style.filter='brightness(1)',150);}}
    toggleCapturesGallery(deviceId){const g=document.getElementById(`gallery-${deviceId}`);if(!g)return;g.classList.toggle('active');if(g.classList.contains('active'))this._renderGallery(deviceId);}
    _renderGallery(deviceId) {
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        const c=document.getElementById(`gallery-content-${deviceId}`);if(!c)return;
        if(!d.captures?.length){c.innerHTML='<div class="empty-state"><i class="fas fa-camera-retro"></i><p>Aucune</p></div>';return;}
        c.innerHTML=d.captures.map(cap=>`
            <div class="capture-thumbnail" onclick="app._viewFull('${deviceId}','${cap.id}')">
                <img src="${cap.imageData}" loading="lazy"><div class="capture-info"><span>${new Date(cap.timestamp).toLocaleString('fr-FR')}</span><span>${cap.size}</span></div>
            </div>`).join('');
    }
    _viewFull(did,cid){const d=this.devices.find(x=>x.id===did),cap=d?.captures?.find(x=>x.id===cid);if(!cap)return;const m=document.createElement('div');m.className='fullscreen-modal';m.innerHTML=`<div class="fullscreen-overlay" onclick="this.parentElement.remove()"></div><div class="fullscreen-content"><button class="fullscreen-close" onclick="this.parentElement.parentElement.remove()"><i class="fas fa-times"></i></button><img src="${cap.imageData}"><div class="fullscreen-info"><span>${d.name} - ${new Date(cap.timestamp).toLocaleString('fr-FR')}</span></div></div>`;document.body.appendChild(m);}
    clearAllCaptures(did){const d=this.devices.find(x=>x.id===did);if(!d?.captures?.length){this.showToast('Aucune','info');return;}if(confirm('Supprimer ?')){d.captures=[];this.saveAllData();this._renderGallery(did);this.renderAll();this.showToast('Supprimées','info');}}

    /* ==================== ENREGISTREMENT VIDÉO ==================== */
    async toggleRecording(deviceId) {
        const d=this.devices.find(x=>x.id===deviceId);if(!d||d.type!=='camera')return;
        if(this._recorders.has(deviceId)){this._stopRec(deviceId);this.showToast('⏹️ Arrêté','info');if(this.recordingTimers[deviceId]){clearInterval(this.recordingTimers[deviceId]);delete this.recordingTimers[deviceId];}}
        else{if(!d.localStream?.active){this.showToast('❌ Activez la caméra','error');return;}
            const ok=await this._startRec(deviceId,d.localStream);if(ok){this.showToast('🔴 Enregistrement','success');this._startRecTimer(deviceId);}}
        this.renderAll();
    }
    async _startRec(deviceId,stream){if(!MediaRecorder.isTypeSupported('video/webm')){this.showToast('❌ Non supporté','error');return false;}
        try{const mr=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});const chunks=[],st=Date.now();
            mr.ondataavailable=e=>{if(e.data?.size>0)chunks.push(e.data);};
            mr.onstop=async()=>{const blob=new Blob(chunks,{type:'video/webm'});await this._saveVideo(deviceId,blob,{id:'rec-'+Date.now(),deviceId,startTime:new Date(st).toISOString(),duration:(Date.now()-st)/1000,size:blob.size,type:'manual'});this._recorders.delete(deviceId);this.addNotification(`📹 Vidéo sauvegardée`,'success');this.renderAll();};
            mr.start(1000);this._recorders.set(deviceId,{recorder:mr,startTime:st});
            setTimeout(()=>{if(this._recorders.has(deviceId))this._stopRec(deviceId);},60000);return true;
        }catch(e){return false;}}
    _stopRec(id){const r=this._recorders.get(id);if(r?.recorder.state==='recording')r.recorder.stop();}
    _startRecTimer(id){if(this.recordingTimers[id])clearInterval(this.recordingTimers[id]);this.recordingTimers[id]=setInterval(()=>{const r=this._recorders.get(id),t=document.getElementById(`recording-timer-${id}`);if(!r||!t){clearInterval(this.recordingTimers[id]);delete this.recordingTimers[id];return;}const d=(Date.now()-r.startTime)/1000;t.textContent=`🔴 ${Math.floor(d/60)}:${Math.floor(d%60).toString().padStart(2,'0')}`;},1000);}
    async _saveVideo(deviceId,blob,meta){try{const db=await this._openDB();const tx=db.transaction(['recordings','videoChunks'],'readwrite');tx.objectStore('recordings').add({...meta,blobSize:blob.size});const cs=tx.objectStore('videoChunks'),chunkSize=1024*1024,total=Math.ceil(blob.size/chunkSize);for(let i=0;i<total;i++){const s=i*chunkSize,e=Math.min(s+chunkSize,blob.size);cs.add({chunkId:`${meta.id}-${i}`,recordingId:meta.id,chunkIndex:i,totalChunks:total,data:blob.slice(s,e)});}}catch(e){}}
    _openDB(){return new Promise((res,rej)=>{const r=indexedDB.open('SmartHomeVideos',1);r.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains('recordings')){const s=db.createObjectStore('recordings',{keyPath:'id'});s.createIndex('deviceId','deviceId');}if(!db.objectStoreNames.contains('videoChunks'))db.createObjectStore('videoChunks',{keyPath:'chunkId'});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
    async _getRecordings(deviceId=null){try{const db=await this._openDB();const tx=db.transaction(['recordings'],'readonly');const store=tx.objectStore('recordings');const recs=await new Promise((res,rej)=>{const req=deviceId?store.index('deviceId').getAll(deviceId):store.getAll();req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});recs.sort((a,b)=>new Date(b.startTime)-new Date(a.startTime));return recs;}catch(e){return[];}}
    async _getVideoBlob(recordingId){const db=await this._openDB();const tx=db.transaction(['videoChunks'],'readonly');const store=tx.objectStore('videoChunks');const chunks=await new Promise((res,rej)=>{const rng=IDBKeyRange.bound(`${recordingId}-0`,`${recordingId}-999`);const req=store.getAll(rng);req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});chunks.sort((a,b)=>a.chunkIndex-b.chunkIndex);return new Blob(chunks.map(c=>c.data),{type:'video/webm'});}
    async playRecording(rid){try{const blob=await this._getVideoBlob(rid),url=URL.createObjectURL(blob);const m=document.createElement('div');m.className='video-player-modal';m.innerHTML=`<div class="video-player-overlay" onclick="this.parentElement.remove();URL.revokeObjectURL('${url}')"></div><div class="video-player-content"><button class="video-player-close" onclick="this.closest('.video-player-modal').remove();URL.revokeObjectURL('${url}')"><i class="fas fa-times"></i></button><video controls autoplay style="max-width:100%;max-height:80vh;border-radius:12px"><source src="${url}" type="video/webm"></video></div>`;document.body.appendChild(m);}catch(e){this.showToast('❌ Erreur','error');}}
    async downloadRecording(rid){try{const blob=await this._getVideoBlob(rid),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`video-${rid}.webm`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);this.showToast('💾 Téléchargé','success');}catch(e){this.showToast('❌ Erreur','error');}}
    async deleteRecording(rid){try{const db=await this._openDB();const tx=db.transaction(['recordings','videoChunks'],'readwrite');tx.objectStore('recordings').delete(rid);const cs=tx.objectStore('videoChunks'),rng=IDBKeyRange.bound(`${rid}-0`,`${rid}-999`);const chunks=await new Promise(res=>{const req=cs.getAll(rng);req.onsuccess=()=>res(req.result);});chunks.forEach(c=>cs.delete(c.chunkId));this.showToast('🗑️ Supprimé','info');}catch(e){}}
    async showVideoGallery(deviceId){const d=this.devices.find(x=>x.id===deviceId);if(!d)return;const recs=await this._getRecordings(deviceId);const m=document.createElement('div');m.className='modal-overlay active';m.innerHTML=`<div class="modal" style="max-width:600px"><div class="modal-header"><h2>📹 ${d.name}</h2><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div><div class="modal-body">${recs.length===0?'<div class="empty-state"><i class="fas fa-video-slash"></i><p>Aucun</p></div>':`<div class="recordings-list">${recs.map(r=>`<div class="recording-item"><div class="recording-item-info"><i class="fas fa-video"></i><div><strong>${new Date(r.startTime).toLocaleString('fr-FR')}</strong><small>${r.duration.toFixed(1)}s • ${(r.blobSize/1024/1024).toFixed(2)}MB</small></div></div><div class="recording-item-actions"><button class="btn btn-primary btn-sm" onclick="app.playRecording('${r.id}')"><i class="fas fa-play"></i></button><button class="btn btn-outline btn-sm" onclick="app.downloadRecording('${r.id}')"><i class="fas fa-download"></i></button><button class="btn btn-outline btn-sm" onclick="app.deleteRecording('${r.id}');this.closest('.modal-overlay').remove();app.showVideoGallery('${deviceId}')"><i class="fas fa-trash"></i></button></div></div>`).join('')}</div>`}</div></div>`;document.body.appendChild(m);m.addEventListener('click',e=>{if(e.target===m)m.remove();});}
    async renderAllRecordings(){const c=document.getElementById('all-recordings-container');if(!c)return;try{const recs=await this._getRecordings();if(!recs.length){c.innerHTML='<div class="empty-state"><i class="fas fa-film"></i><p>Aucun enregistrement</p></div>';return;}let total=0;recs.forEach(r=>total+=r.blobSize||0);c.innerHTML=`<p style="margin-bottom:15px;color:var(--text-secondary)">${recs.length} vidéos • ${(total/1024/1024).toFixed(2)} MB</p><div class="recordings-list">${recs.map(r=>{const d=this.devices.find(x=>x.id===r.deviceId);return`<div class="recording-item"><div class="recording-item-info"><i class="fas fa-video"></i><div><strong>${d?.name||r.deviceId}</strong><small>${new Date(r.startTime).toLocaleString('fr-FR')} • ${r.duration.toFixed(1)}s</small></div></div><div class="recording-item-actions"><button class="btn btn-primary btn-sm" onclick="app.playRecording('${r.id}')"><i class="fas fa-play"></i></button><button class="btn btn-outline btn-sm" onclick="app.downloadRecording('${r.id}')"><i class="fas fa-download"></i></button><button class="btn btn-outline btn-sm" onclick="app.deleteRecording('${r.id}');app.renderAllRecordings()"><i class="fas fa-trash"></i></button></div></div>`}).join('')}</div>`;}catch(e){c.innerHTML='<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Erreur</p></div>';}}

    /* ==================== APPAREILS CRUD ==================== */
    openAddDeviceModal(){document.getElementById('modal-add-device').classList.add('active');document.getElementById('new-device-name').focus();this.onDeviceTypeChange();}
    closeAddDeviceModal(){document.getElementById('modal-add-device').classList.remove('active');['new-device-name','new-device-room','new-camera-url'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('camera-url-group').style.display='none';}
    onDeviceTypeChange(){document.getElementById('camera-url-group').style.display=document.getElementById('new-device-type').value==='camera'?'block':'none';}
    addDevice(){
        const name=document.getElementById('new-device-name').value.trim(),type=document.getElementById('new-device-type').value,room=document.getElementById('new-device-room').value.trim(),curl=document.getElementById('new-camera-url')?.value.trim()||null;
        if(!name){this.showToast('Nom requis','error');return;}
        const icons={door:'fa-door-closed',window:'fa-window-maximize',light:'fa-lightbulb',camera:'fa-video'};
        const nd={id:type+'-'+Date.now(),name,type,room:room||'Non spécifié',status:type==='camera'?'online':(type==='light'?'off':'closed'),icon:icons[type],cameraUrl:type==='camera'?curl:null,streamType:null,localStream:null,captures:[]};
        this.devices.push(nd);this.addNotification(`✅ ${name} ajouté(e)`,'success');this.logActivity(`${name} ajouté(e)`,'system',this._getEmoji(type));this.saveAllData();this.renderAll();this.closeAddDeviceModal();this.showToast(`${name} ajouté !`,'success');
    }
    deleteDevice(deviceId){if(!this.canControl())return;const d=this.devices.find(x=>x.id===deviceId);if(!d)return;if(!confirm(`Supprimer "${d.name}" ?`))return;if(d.localStream)this._stopStream(d);if(d.motionInterval)clearInterval(d.motionInterval);this.devices=this.devices.filter(x=>x.id!==deviceId);this.addNotification(`🗑️ ${d.name} supprimé(e)`,'info');this.saveAllData();this.renderAll();this.showToast(`${d.name} supprimé(e)`,'info');}

    /* ==================== RENDU ==================== */
    renderAll(){this._renderDashboard();this._renderDoorsWindows();this._renderLights();this._renderCameras();this._renderActivity();this._renderNotifications();this._updateNotifBadge();setTimeout(()=>this.refreshAllVideoStreams(),300);}
    _renderDashboard(){
        const doors=this.devices.filter(d=>d.type==='door'),windows=this.devices.filter(d=>d.type==='window'),lights=this.devices.filter(d=>d.type==='light'),cameras=this.devices.filter(d=>d.type==='camera');
        this._setText('summary-doors',`${doors.filter(d=>d.status==='open').length}/${doors.length}`);
        this._setText('summary-windows',`${windows.filter(d=>d.status==='open').length}/${windows.length}`);
        this._setText('summary-lights',`${lights.filter(l=>l.status==='on').length}/${lights.length}`);
        this._setText('summary-cameras',cameras.filter(c=>c.status!=='offline').length);
        const qg=document.getElementById('quick-access-grid');if(qg)qg.innerHTML=[...doors,...windows,...lights,...cameras].slice(0,6).map(d=>this._createCard(d)).join('')||'<div class="empty-state"><i class="fas fa-plug"></i><p>Aucun</p></div>';
        const ra=document.getElementById('recent-activity');if(ra)ra.innerHTML=this.activityLog.slice(0,5).map(a=>this._createActItem(a)).join('')||'<div class="empty-state"><i class="fas fa-history"></i><p>Aucune</p></div>';
    }
    _renderDoorsWindows(){const g=document.getElementById('doors-windows-grid');if(!g)return;const items=this.devices.filter(d=>d.type==='door'||d.type==='window');g.innerHTML=items.length?items.map(d=>this._createCard(d)).join(''):'<div class="empty-state"><i class="fas fa-door-closed"></i><p>Aucune</p></div>';}
    _renderLights(){const g=document.getElementById('lights-grid');if(!g)return;const lights=this.devices.filter(d=>d.type==='light');g.innerHTML=lights.length?lights.map(d=>this._createCard(d)).join(''):'<div class="empty-state"><i class="fas fa-lightbulb"></i><p>Aucune</p></div>';const btn=document.getElementById('btn-all-lights');if(btn&&lights.length){const anyOn=lights.some(l=>l.status==='on');btn.innerHTML=anyOn?'<i class="fas fa-power-off"></i> Tout éteindre':'<i class="fas fa-power-off"></i> Tout allumer';}}
    _renderCameras(){const g=document.getElementById('cameras-grid');if(!g)return;const cameras=this.devices.filter(d=>d.type==='camera');g.innerHTML=cameras.length?cameras.map(d=>this._createCard(d)).join(''):'<div class="empty-state"><i class="fas fa-video-slash"></i><p>Aucune</p></div>';}

    _createCard(device){
        const sc=this._getStatusClass(device),st=this._getStatusText(device),isControllable=device.type!=='camera',disabled=!this.isInProximity&&isControllable?'disabled':'',isRec=this._recorders.has(device.id),hasArduino=this.arduinoDevices[device.id]?.ip;
        let controls='';
        if(device.type==='light')controls=`<label class="toggle-switch"><input type="checkbox" ${device.status==='on'?'checked':''} onchange="app.toggleDevice('${device.id}')" ${disabled}><span class="toggle-slider"></span></label>`;
        else if(device.type==='door'||device.type==='window'){
            controls=`
                <button class="btn ${device.status==='open'?'btn-danger':'btn-primary'} btn-sm" onclick="app.toggleDevice('${device.id}')" ${disabled}>
                    <i class="fas fa-${device.status==='open'?'lock':'lock-open'}"></i> ${device.status==='open'?'Fermer':'Ouvrir'}
                </button>
                <button class="btn btn-outline btn-sm" onclick="app.configureArduinoIP('${device.id}')" title="Configurer Arduino">
                    <i class="fas fa-microchip"></i> ${hasArduino?'✓':''}
                </button>`;
        }else if(device.type==='camera'){
            controls=`
                <button class="btn btn-outline btn-sm" onclick="app.openConfigCameraModal('${device.id}')"><i class="fas fa-cog"></i></button>
                ${device.localStream?`<button class="btn ${isRec?'btn-danger':'btn-outline'} btn-sm" onclick="app.toggleRecording('${device.id}')"><i class="fas fa-${isRec?'stop':'record-vinyl'}"></i></button>`:''}
                <button class="btn btn-outline btn-sm" onclick="app.showVideoGallery('${device.id}')"><i class="fas fa-folder-open"></i></button>`;
        }
        let camHtml='';
        if(device.type==='camera'){
            if(device.localStream)camHtml+=`<div class="camera-container"><video class="camera-feed-video" id="video-${device.id}" autoplay playsinline muted></video><div class="camera-recording-badge">● DIRECT</div></div>`;
            else if(device.cameraUrl)camHtml+=`<div class="camera-container"><img class="camera-feed-img" id="img-${device.id}" src="${device.cameraUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="camera-error" style="display:none"><i class="fas fa-exclamation-triangle"></i><p>Inaccessible</p></div></div>`;
            else camHtml+=`<div class="camera-container"><div class="camera-placeholder"><i class="fas fa-video-slash"></i><p>Aucun flux</p></div></div>`;
            if(isRec){const rec=this._recorders.get(device.id),dur=rec?(Date.now()-rec.startTime)/1000:0;camHtml+=`<div class="recording-timer" id="recording-timer-${device.id}">🔴 ${Math.floor(dur/60)}:${Math.floor(dur%60).toString().padStart(2,'0')}</div>`;}
            camHtml+=`<div class="camera-actions-bar"><button class="btn btn-primary btn-sm" onclick="app.captureImage('${device.id}')" ${!device.localStream&&!device.cameraUrl?'disabled':''}><i class="fas fa-camera"></i></button><button class="btn btn-outline btn-sm" onclick="app.toggleCapturesGallery('${device.id}')"><i class="fas fa-images"></i> ${device.captures?.length||0}</button></div><div class="captures-gallery" id="gallery-${device.id}"><div class="gallery-header"><h4>📸 (${device.captures?.length||0})</h4>${device.captures?.length?`<button class="btn btn-outline btn-sm" onclick="app.clearAllCaptures('${device.id}')"><i class="fas fa-trash"></i></button>`:''}</div><div class="gallery-grid" id="gallery-content-${device.id}"></div></div>`;
        }
        return `<div class="device-card type-${device.type}"><div class="device-card-header"><div class="device-card-icon"><i class="fas ${device.icon}"></i></div><span class="device-status-badge ${sc}">${st}</span></div><div class="device-card-name">${device.name}</div><div class="device-card-room"><i class="fas fa-map-marker-alt"></i> ${device.room}</div>${camHtml}<div class="device-card-actions">${controls}<button class="btn btn-outline btn-sm" onclick="app.deleteDevice('${device.id}')" ${!this.isInProximity?'disabled':''}><i class="fas fa-trash"></i></button></div></div>`;
    }
    _getStatusClass(d){return['open','on','online','recording'].includes(d.status)?'open':'closed';}
    _getStatusText(d){return{door:{open:'Ouverte',closed:'Fermée'},window:{open:'Ouverte',closed:'Fermée'},light:{on:'Allumée',off:'Éteinte'},camera:{online:'En ligne',recording:'Direct',offline:'Hors ligne'}}[d.type]?.[d.status]||d.status;}

    /* ==================== ACTIVITÉ & NOTIFICATIONS ==================== */
    _renderActivity(){const fa=document.getElementById('full-activity');if(fa)fa.innerHTML=this.activityLog.length?this.activityLog.map(a=>this._createActItem(a)).join(''):'<div class="empty-state"><i class="fas fa-history"></i><p>Aucune</p></div>';}
    _createActItem(a){return`<div class="activity-item"><span class="activity-icon">${a.emoji||'📝'}</span><span class="activity-message">${a.message}</span><span class="activity-time">${this._formatTime(a.timestamp)}</span></div>`;}
    logActivity(m,t,e='📝'){this.activityLog.unshift({message:m,type:t,emoji:e,timestamp:new Date().toISOString()});if(this.activityLog.length>200)this.activityLog=this.activityLog.slice(0,200);this._renderActivity();this.saveAllData();}
    clearActivity(){if(confirm('Effacer ?')){this.activityLog=[];this.saveAllData();this.renderAll();this.showToast('Effacé','info');}}
    addNotification(m,t='info'){this.notifications.unshift({message:m,type:t,timestamp:new Date().toISOString(),read:false});if(this.notifications.length>100)this.notifications=this.notifications.slice(0,100);this._updateNotifBadge();this._renderNotifications();this.saveAllData();}
    _renderNotifications(){const l=document.getElementById('notification-list');if(l)l.innerHTML=this.notifications.length?this.notifications.map((n,i)=>`<div class="notification-item ${n.read?'':'unread'}" onclick="app._markNotifRead(${i})"><span class="notif-icon">${{success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'}[n.type]||'📢'}</span><div class="notif-content"><div>${n.message}</div><div class="notif-time">${this._formatTime(n.timestamp)}</div></div></div>`).join(''):'<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Aucune</p></div>';}
    _markNotifRead(i){if(this.notifications[i]){this.notifications[i].read=true;this._updateNotifBadge();this._renderNotifications();this.saveAllData();}}
    clearNotifications(){this.notifications=[];this._updateNotifBadge();this._renderNotifications();this.saveAllData();this.showToast('Effacées','info');}
    _updateNotifBadge(){const b=document.getElementById('notification-badge');if(!b)return;const u=this.notifications.filter(n=>!n.read).length;b.textContent=u>99?'99+':u;b.classList.toggle('show',u>0);}
    toggleNotificationPanel(){const p=document.getElementById('notification-panel'),o=document.getElementById('panel-overlay');if(!p)return;const a=p.classList.contains('active');if(a){p.classList.remove('active');if(o)o.classList.remove('active');}else{p.classList.add('active');if(o)o.classList.add('active');this._renderNotifications();}}

    /* ==================== NAVIGATION ==================== */
    switchTab(tabName){
        document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
        const btn=document.querySelector(`.tab-button[data-tab="${tabName}"]`),panel=document.getElementById(`panel-${tabName}`);
        if(btn)btn.classList.add('active');if(panel)panel.classList.add('active');
        if(tabName==='dashboard')this._renderDashboard();
        else if(tabName==='devices')this._renderDoorsWindows();
        else if(tabName==='lights')this._renderLights();
        else if(tabName==='cameras')this._renderCameras();
        else if(tabName==='recordings')this.renderAllRecordings();
        else if(tabName==='activity')this._renderActivity();
        setTimeout(()=>this.refreshAllVideoStreams(),200);
    }

    /* ==================== UI ==================== */
    updateConnectionUI(){
        const badge=document.getElementById('connection-badge'),text=document.getElementById('connection-text'),alert=document.getElementById('proximity-alert');
        if(!badge||!text)return;badge.className='connection-badge';
        if(this.isInProximity){badge.classList.add('local');text.textContent='Connecté (Local)';}
        else if(this.isLoggedIn){badge.classList.add('remote');text.textContent='Distant (Lecture seule)';}
        else{badge.classList.add('disconnected');text.textContent='Déconnecté';}
        if(alert)alert.classList.toggle('show',!this.isInProximity&&this.isLoggedIn);
    }
    _setText(id,text){const el=document.getElementById(id);if(el)el.textContent=text;}
    showToast(m,t='info'){const c=document.getElementById('toast-container');if(!c)return;const icons={success:'<i class="fas fa-check-circle"></i>',error:'<i class="fas fa-times-circle"></i>',warning:'<i class="fas fa-exclamation-triangle"></i>',info:'<i class="fas fa-info-circle"></i>'};const toast=document.createElement('div');toast.className=`toast ${t}`;toast.innerHTML=`${icons[t]||icons.info} ${m}`;c.appendChild(toast);setTimeout(()=>toast.remove(),3000);}
    _formatTime(ts){const d=new Date(ts),n=new Date(),s=Math.floor((n-d)/1000),mn=Math.floor(s/60),h=Math.floor(mn/60),j=Math.floor(h/24);if(s<10)return'À l\'instant';if(s<60)return`Il y a ${s}s`;if(mn<60)return`Il y a ${mn}min`;if(h<24)return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});if(j<7)return`Il y a ${j}j`;return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});}
}

const app = new SmartHomeApp();
console.log('✅ Smart Home Pro prêt !');
console.log('👤 admin / admin123');
console.log('💡 Ctrl+P = simuler proximité');
console.log('🔌 Arduino : bouton microchip sur portes/fenêtres');