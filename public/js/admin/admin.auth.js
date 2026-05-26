// Modul AdminApp — autentikasi, tab switching, dan API error handling
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

AdminApp.prototype.init = function init() {
	// Hubungkan elemen-elemen HTML ke variabel
	this.viewLogin = document.getElementById('view-login');
	this.viewDashboard = document.getElementById('view-dashboard');

	this.loginForm = document.getElementById('login-form');
	this.productForm = document.getElementById('add-product-form');
	this.activeTab = this.getStoredActiveTab();

	this.tabOrders = document.getElementById('tab-orders');
	this.tabProducts = document.getElementById('tab-products');
	this.tabStatistics = document.getElementById('tab-statistics');
	this.tabStoreStatus = document.getElementById('tab-store-status');

	this.sessionHeartbeatMs = 60 * 1000;
	this.sessionHeartbeatTimer = null;
	this.isHandlingSessionTermination = false;

	// Pasang event listener form utama
	this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
	this.productForm.addEventListener('submit', (e) => this.handleAddProduct(e));

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible') return;
		const isDashboardVisible = this.viewDashboard && !this.viewDashboard.classList.contains('hidden');
		if (!isDashboardVisible) return;
		void this.verifyAdminSessionHeartbeat({ silent: true });
	});

	// Mulai dengan verifikasi sesi (cookie HttpOnly)
	this.checkAuth();
};

AdminApp.prototype.checkAuth = async function checkAuth() {
	const apiBaseUrl = this.getApiBaseUrl();
	const modal = this.getModalApi();
	try {
		// Verifikasi session admin dari cookie HttpOnly
		const res = await fetch(`${apiBaseUrl}/api/admin/verify`, {
			method: 'GET',
			credentials: 'include'
		});

		if (res.ok) {
			this.showDashboard();
			return;
		}

		const payload = await this.parseJsonSafe(res);
		if (res.status === 401 && payload?.code === 'E-ADMIN-SESSION-REPLACED') {
			await this.handleSessionReplaced(payload);
			return;
		}

		this.showLogin();
	} catch (_error) {
		await modal.alert('Gagal terhubung ke server.');
		this.showLogin();
	}
};

AdminApp.prototype.startSessionHeartbeat = function startSessionHeartbeat() {
	this.stopSessionHeartbeat();
	this.sessionHeartbeatTimer = window.setInterval(() => {
		void this.verifyAdminSessionHeartbeat({ silent: true });
	}, this.sessionHeartbeatMs);
};

AdminApp.prototype.stopSessionHeartbeat = function stopSessionHeartbeat() {
	if (!this.sessionHeartbeatTimer) return;
	window.clearInterval(this.sessionHeartbeatTimer);
	this.sessionHeartbeatTimer = null;
};

AdminApp.prototype.verifyAdminSessionHeartbeat = async function verifyAdminSessionHeartbeat(options = {}) {
	const { silent = true } = options;
	const apiBaseUrl = this.getApiBaseUrl();
	const logger = this.getAppLogger();
	const modal = this.getModalApi();
	try {
		const res = await fetch(`${apiBaseUrl}/api/admin/verify`, {
			method: 'GET',
			credentials: 'include'
		});
		if (res.ok) return true;
		await this.handleApiError(res);
		return false;
	} catch (error) {
		logger.warn('Heartbeat verifikasi sesi admin gagal', error);
		if (!silent) {
			await modal.alert('Gagal memverifikasi sesi login. Periksa koneksi internet.');
		}
		return false;
	}
};

AdminApp.prototype.showLogin = function showLogin() {
	this.stopSessionHeartbeat();
	this.viewLogin.classList.remove('hidden');
	this.viewDashboard.classList.add('hidden');
};

AdminApp.prototype.showDashboard = function showDashboard() {
	this.viewLogin.classList.add('hidden');
	this.viewDashboard.classList.remove('hidden');
	this.switchTab(this.activeTab, { skipPersist: true, skipFetch: true });
	this.startSessionHeartbeat();

	// Memuat data awal saat dashboard terbuka
	this.fetchDashboardData();
};

AdminApp.prototype.fetchDashboardData = async function fetchDashboardData() {
	// Memuat ringkasan dashboard (produk + pesanan) dengan loading yang konsisten
	let loadingMessage = 'Memuat data dashboard...';
	if (this.tabStatistics && !this.tabStatistics.classList.contains('hidden')) {
		loadingMessage = 'Memuat data statistik...';
	} else if (this.tabOrders && !this.tabOrders.classList.contains('hidden')) {
		loadingMessage = 'Memuat data pesanan...';
	} else if (this.tabProducts && !this.tabProducts.classList.contains('hidden')) {
		loadingMessage = 'Memuat katalog produk...';
	} else if (this.tabStoreStatus && !this.tabStoreStatus.classList.contains('hidden')) {
		loadingMessage = 'Memuat status web...';
	}
	await this.withGlobalLoading(async () => {
		// Ambil produk dulu untuk total jumlah, lalu pesanan untuk hitung statistik
		await this.fetchAdminProducts({ silent: true });
		await this.fetchOrders({ silent: true });
		const isStatisticsActive = this.tabStatistics && !this.tabStatistics.classList.contains('hidden');
		if (isStatisticsActive && typeof this.fetchOrdersAnalytics === 'function') {
			await this.fetchOrdersAnalytics({ silent: true, force: true });
			this.calculateStatistics();
		}
		if (typeof this.fetchStoreStatus === 'function') {
			await this.fetchStoreStatus({ silent: true });
		}
	}, { message: loadingMessage });
};

AdminApp.prototype.handleLogin = async function handleLogin(e) {
	e.preventDefault();
	const apiBaseUrl = this.getApiBaseUrl();
	const logger = this.getAppLogger();
	const modal = this.getModalApi();
	const usr = document.getElementById('adminUsername').value;
	const pwd = document.getElementById('adminPassword').value;
	const btn = this.loginForm.querySelector('button[type="submit"]');
	if (btn) btn.disabled = true;

	try {
		const res = await fetch(`${apiBaseUrl}/api/admin/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ username: usr, password: pwd })
		});

		const data = await res.json();

		if (res.ok && data.success) {
			this.isHandlingSessionTermination = false;
			this.showDashboard();
		} else {
			this.showAdminError(data, 'Username atau sandi salah!');
		}
	} catch (err) {
		logger.error('Gagal login admin', err);
		await modal.alert('Terjadi kesalahan jaringan.');
	} finally {
		if (btn) btn.disabled = false;
	}
};

AdminApp.prototype.logout = async function logout(options = {}) {
	const { skipServer = false } = options;
	const apiBaseUrl = this.getApiBaseUrl();
	const logger = this.getAppLogger();

	this.stopSessionHeartbeat();

	if (!skipServer) {
		try {
			// Hapus session di server (cookie admin_token)
			await fetch(`${apiBaseUrl}/api/admin/logout`, {
				method: 'POST',
				credentials: 'include'
			});
		} catch (error) {
			logger.error('Gagal logout ke server', error);
		}
	}

	this.showLogin();
	this.isHandlingSessionTermination = false;
};

AdminApp.prototype.switchTab = function switchTab(tabName, options = {}) {
	const normalizedTab = this.normalizeAdminTab(tabName);
	const { skipPersist = false, skipFetch = false } = options;
	// Mengatur visibilitas konten tab
	this.tabOrders.classList.add('hidden');
	this.tabProducts.classList.add('hidden');
	this.tabStatistics.classList.add('hidden');
	if (this.tabStoreStatus) this.tabStoreStatus.classList.add('hidden');

	if (normalizedTab === 'orders') {
		this.tabOrders.classList.remove('hidden');
	} else if (normalizedTab === 'products') {
		this.tabProducts.classList.remove('hidden');
	} else if (normalizedTab === 'statistics') {
		this.tabStatistics.classList.remove('hidden');
	} else if (normalizedTab === 'store-status' && this.tabStoreStatus) {
		this.tabStoreStatus.classList.remove('hidden');
	}

	// Mengatur status aktif pada tombol navigasi sidebar
	const navOrders = document.getElementById('nav-orders');
	const navProducts = document.getElementById('nav-products');
	const navStatistics = document.getElementById('nav-statistics');
	const navStoreStatus = document.getElementById('nav-store-status');

	if (navOrders) navOrders.classList.remove('active');
	if (navProducts) navProducts.classList.remove('active');
	if (navStatistics) navStatistics.classList.remove('active');
	if (navStoreStatus) navStoreStatus.classList.remove('active');

	if (normalizedTab === 'orders' && navOrders) {
		navOrders.classList.add('active');
	} else if (normalizedTab === 'products' && navProducts) {
		navProducts.classList.add('active');
	} else if (normalizedTab === 'statistics' && navStatistics) {
		navStatistics.classList.add('active');
	} else if (normalizedTab === 'store-status' && navStoreStatus) {
		navStoreStatus.classList.add('active');
	}

	this.activeTab = normalizedTab;
	if (!skipPersist) {
		this.storeActiveTab(normalizedTab);
	}

	this.syncTabAriaState(normalizedTab);

	// Pastikan konten tab yang aktif segera segar saat dibuka
	if (skipFetch) {
		return;
	}

	if (normalizedTab === 'orders') {
		this.fetchOrders({ silent: true });
	} else if (normalizedTab === 'products' && Array.isArray(this.products) && this.products.length > 0) {
		this.renderProductsData(this.products);
	} else if (normalizedTab === 'statistics') {
		if (typeof this.fetchOrdersAnalytics === 'function') {
			this.fetchOrdersAnalytics({ silent: true, force: !this.hasFetchedAnalytics }).then(() => {
				this.calculateStatistics();
			});
		} else {
			this.calculateStatistics();
		}
	} else if (normalizedTab === 'store-status') {
		if (this.storeStatusData && typeof this.renderStoreStatus === 'function') {
			this.renderStoreStatus();
		} else if (typeof this.fetchStoreStatus === 'function') {
			this.fetchStoreStatus({ silent: true });
		}
	}
};

AdminApp.prototype.formatSessionReplacedMessage = function formatSessionReplacedMessage(payload) {
	const replacedBy = payload?.session_replaced_by || {};
	const device = String(replacedBy?.device || 'Unknown Browser / Unknown Device');
	const ip = String(replacedBy?.ip || 'unknown');
	const loginAtWib = String(replacedBy?.login_at_wib || '-');

	return [
		'Sesi login habis karena akun ini login di perangkat baru.',
		'',
		`Perangkat/Browser: ${device}`,
		`IP Login Baru: ${ip}`,
		`Waktu Login Baru: ${loginAtWib}`
	].join('\n');
};

AdminApp.prototype.handleSessionReplaced = async function handleSessionReplaced(payload) {
	if (this.isHandlingSessionTermination) return;
	this.isHandlingSessionTermination = true;
	const modal = this.getModalApi();

	try {
		await modal.alert(
			this.formatSessionReplacedMessage(payload),
			'Sesi Digantikan',
			'warning'
		);
	} finally {
		await this.logout({ skipServer: true });
	}
};

AdminApp.prototype.handleGenericUnauthorized = async function handleGenericUnauthorized() {
	if (this.isHandlingSessionTermination) return;
	this.isHandlingSessionTermination = true;
	const modal = this.getModalApi();

	try {
		await modal.alert('Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.');
	} finally {
		await this.logout({ skipServer: true });
	}
};

AdminApp.prototype.handleApiError = async function handleApiError(res) {
	if (res.status !== 401) {
		return false;
	}

	const payload = await this.parseJsonSafe(res);
	if (payload?.code === 'E-ADMIN-SESSION-REPLACED') {
		await this.handleSessionReplaced(payload);
		return true;
	}

	await this.handleGenericUnauthorized();
	return true;
};

AdminApp.prototype.normalizeAdminTab = function normalizeAdminTab(tabName) {
	if (tabName === 'products' || tabName === 'statistics' || tabName === 'store-status') {
		return tabName;
	}
	return 'orders';
};

AdminApp.prototype.getStoredActiveTab = function getStoredActiveTab() {
	try {
		const rawTab = localStorage.getItem('admin_active_tab');
		return this.normalizeAdminTab(rawTab);
	} catch (_error) {
		return 'orders';
	}
};

AdminApp.prototype.storeActiveTab = function storeActiveTab(tabName) {
	try {
		localStorage.setItem('admin_active_tab', this.normalizeAdminTab(tabName));
	} catch (_error) {
		// Abaikan jika browser menolak akses storage (private mode / policy)
	}
};

AdminApp.prototype.syncTabAriaState = function syncTabAriaState(activeTab) {
	const tabMap = [
		{ key: 'orders', navId: 'nav-orders', panel: this.tabOrders },
		{ key: 'products', navId: 'nav-products', panel: this.tabProducts },
		{ key: 'statistics', navId: 'nav-statistics', panel: this.tabStatistics },
		{ key: 'store-status', navId: 'nav-store-status', panel: this.tabStoreStatus }
	];

	tabMap.forEach(({ key, navId, panel }) => {
		const navEl = document.getElementById(navId);
		const isActive = key === activeTab;
		if (navEl) {
			navEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
			navEl.setAttribute('aria-current', isActive ? 'page' : 'false');
			navEl.setAttribute('tabindex', isActive ? '0' : '-1');
		}
		if (panel) {
			panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
		}
	});
};
