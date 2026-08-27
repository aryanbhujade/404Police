// 404 Police — static build.
//
// No server. The browser calls each status API directly, so this only works for
// endpoints that send Access-Control-Allow-Origin (see tools/cors-check.html).
//
// Cost model: we fetch exactly the services on the user's board, never the whole
// catalog. services.json is one cached request regardless of how large it grows.

const CATALOG_URL = 'services.json';
const BOARD_KEY = '404police.board';
const CACHE_TTL_MS = 60 * 1000;
const CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 10000;
const AUTO_REFRESH_MS = 5 * 60 * 1000;

// Bounded concurrent map. Unbounded Promise.all across a large board would fire
// every request at once and get us rate-limited by Statuspage's CDN.
async function pooledMap(items, worker, limit) {
    const queue = items.map((item, index) => ({ item, index }));
    const results = new Array(items.length);
    const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) {
            const { item, index } = queue.shift();
            results[index] = await worker(item);
        }
    });
    await Promise.all(runners);
    return results;
}

class ServiceStatusDashboard {
    constructor() {
        this.catalog = [];
        this.catalogByKey = new Map();
        this.board = [];
        this.services = [];
        this.cache = new Map();
        this.isLoading = false;
        this.refreshInterval = null;
        this.cardTimers = [];

        this.initialiseApp();
        this.setupEventListeners();
        this.initialiseDarkMode();
        this.start();
    }

    initialiseApp() {
        this.loadingMessage = document.getElementById('loadingMessage');
        this.errorMessage = document.getElementById('errorMessage');
        this.operationalCount = document.getElementById('operationalCount');
        this.degradedCount = document.getElementById('degradedCount');
        this.outageCount = document.getElementById('outageCount');
        this.lastUpdated = document.getElementById('lastUpdated');

        this.categoryGrids = {
            ai: document.getElementById('aiGrid'),
            messaging: document.getElementById('messagingGrid'),
            streaming: document.getElementById('streamingGrid'),
            developer: document.getElementById('developerGrid'),
            cloud: document.getElementById('cloudGrid'),
            other: document.getElementById('otherGrid')
        };

        this.categorySections = {
            ai: document.getElementById('aiServices'),
            messaging: document.getElementById('messagingServices'),
            streaming: document.getElementById('streamingServices'),
            developer: document.getElementById('developerServices'),
            cloud: document.getElementById('cloudServices'),
            other: document.getElementById('otherServices')
        };

        this.detail = document.getElementById('incidentDetail');
        this.detailTitle = document.getElementById('detailTitle');
        this.detailBody = document.getElementById('detailBody');
        this.detailClose = document.getElementById('detailClose');

        this.addModal = document.getElementById('addServiceModal');
        this.addSearch = document.getElementById('addServiceSearch');
        this.addResults = document.getElementById('addServiceResults');
        this.addClose = document.getElementById('addServiceClose');
    }

    setupEventListeners() {
        document.getElementById('refreshBtn')
            .addEventListener('click', () => this.refreshServices());
        document.getElementById('darkModeToggle')
            .addEventListener('click', () => this.toggleDarkMode());
        document.getElementById('addServiceBtn')
            .addEventListener('click', () => this.openAddModal());

        this.detailClose.addEventListener('click', () => this.closeDetail());
        this.detail.addEventListener('click', (e) => {
            if (e.target === this.detail) this.closeDetail();
        });

        this.addClose.addEventListener('click', () => this.closeAddModal());
        this.addModal.addEventListener('click', (e) => {
            if (e.target === this.addModal) this.closeAddModal();
        });
        // Filtering is pure in-memory work over the catalog: no network on keystroke.
        this.addSearch.addEventListener('input', () => this.renderAddResults());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.addModal.classList.contains('show')) this.closeAddModal();
                else if (this.detail.classList.contains('show')) this.closeDetail();
            }
            if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.refreshServices();
            }
        });
    }

    initialiseDarkMode() {
        if (
            localStorage.getItem('theme') === 'dark' ||
            (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            }
        });
    }

    toggleDarkMode() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        const waveColor = getComputedStyle(document.documentElement).getPropertyValue('--wave-color');
        initBackgroundWaves(waveColor);
    }

    // ---- catalog + board -------------------------------------------------

    async start() {
        this.showLoadingMessage();
        try {
            const response = await fetch(CATALOG_URL);
            if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
            const catalog = await response.json();

            // Services needing a per-provider adapter are searchable but not addable,
            // so a board can never contain a card that cannot resolve.
            this.catalog = catalog.services.filter(s => s.supported !== false);
            this.catalog.forEach(s => this.catalogByKey.set(s.key, s));
            this.board = this.loadBoard(catalog.defaults);
            await this.loadServices();
            this.startAutoRefresh();
        } catch (error) {
            this.showErrorMessage(`Could not load the service catalog: ${error.message}`);
        }
    }

    loadBoard(defaults) {
        let stored = null;
        try {
            stored = JSON.parse(localStorage.getItem(BOARD_KEY));
        } catch {
            stored = null;
        }
        const source = Array.isArray(stored) && stored.length ? stored : defaults;
        // Drop keys that no longer exist so a stale board cannot wedge startup.
        return source.filter(key => this.catalogByKey.has(key));
    }

    saveBoard() {
        localStorage.setItem(BOARD_KEY, JSON.stringify(this.board));
    }

    // ---- fetching --------------------------------------------------------

    async fetchService(entry, { force = false } = {}) {
        const cached = this.cache.get(entry.key);
        if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
            return cached.value;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(entry.url, { signal: controller.signal, mode: 'cors' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const value = this.normalise(entry, data);
            this.cache.set(entry.key, { at: Date.now(), value });
            return value;
        } catch (error) {
            // Serve stale data rather than blanking a card on a transient blip.
            if (cached) return { ...cached.value, stale: true };
            return {
                key: entry.key,
                service: entry.name,
                category: entry.category,
                icon: entry.icon || null,
                status: { description: 'Unable to fetch status', indicator: 'unknown' },
                last_updated: new Date().toISOString(),
                error: true
            };
        } finally {
            clearTimeout(timer);
        }
    }

    normalise(entry, data) {
        const raw = data.status || (data.page && data.page.status) || null;
        // Unrecognised payloads report 'unknown', never 'operational'. Guessing
        // healthy is the one failure mode a status dashboard must not have.
        const status = raw
            ? {
                description: raw.description || 'Unknown',
                indicator: raw.indicator || 'unknown'
            }
            : { description: 'Unrecognised status format', indicator: 'unknown' };

        return {
            key: entry.key,
            service: entry.name,
            category: entry.category,
            icon: entry.icon || null,
            status,
            last_updated: new Date().toISOString(),
            incidents: data.incidents || [],
            components: data.components || []
        };
    }

    async loadServices({ force = false } = {}) {
        if (this.isLoading) return;
        this.setLoadingState(true);
        try {
            const entries = this.board.map(key => this.catalogByKey.get(key));
            this.services = await pooledMap(
                entries,
                entry => this.fetchService(entry, { force }),
                CONCURRENCY
            );
            this.renderServices();
            this.updateStatusSummary();
            this.updateLastUpdated(new Date().toISOString());
            this.hideLoadingMessage();
        } finally {
            this.setLoadingState(false);
        }
    }

    async refreshServices() {
        await this.loadServices({ force: true });
    }

    async addService(key) {
        if (this.board.includes(key)) return;
        this.board.push(key);
        this.saveBoard();

        // One fetch for one card. Adding never re-requests the rest of the board.
        const entry = this.catalogByKey.get(key);
        const result = await this.fetchService(entry);
        this.services.push(result);
        this.renderServices();
        this.updateStatusSummary();
        this.renderAddResults();
    }

    removeService(key) {
        this.board = this.board.filter(k => k !== key);
        this.saveBoard();
        this.services = this.services.filter(s => s.key !== key);
        this.cache.delete(key);
        this.renderServices();
        this.updateStatusSummary();
    }

    // ---- add-service modal ----------------------------------------------

    openAddModal() {
        this.addModal.classList.add('show');
        document.body.style.overflow = 'hidden';
        this.addSearch.value = '';
        this.renderAddResults();
        this.addSearch.focus();
    }

    closeAddModal() {
        this.addModal.classList.remove('show');
        document.body.style.overflow = '';
    }

    renderAddResults() {
        const query = this.addSearch.value.trim().toLowerCase();
        const matches = this.catalog
            .filter(s => !query || s.name.toLowerCase().includes(query) || s.key.includes(query))
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, 60);

        this.addResults.innerHTML = '';

        if (!matches.length) {
            const empty = document.createElement('p');
            empty.className = 'add-empty';
            empty.textContent = 'No services match that search.';
            this.addResults.appendChild(empty);
            return;
        }

        matches.forEach(svc => {
            const onBoard = this.board.includes(svc.key);
            const row = document.createElement('div');
            row.className = 'add-row';

            const label = document.createElement('div');
            label.className = 'add-row-label';
            if (svc.icon) {
                const logoFrame = document.createElement('span');
                logoFrame.className = 'add-row-logo-frame';
                logoFrame.title = svc.name;
                const logo = document.createElement('img');
                logo.className = 'add-row-logo';
                logo.src = svc.icon;
                logo.alt = '';
                logo.setAttribute('aria-hidden', 'true');
                logoFrame.appendChild(logo);
                label.appendChild(logoFrame);
            }
            const name = document.createElement('span');
            name.className = 'add-row-name';
            name.textContent = svc.name;
            const cat = document.createElement('span');
            cat.className = 'add-row-category';
            cat.textContent = svc.category;
            label.append(name, cat);

            const button = document.createElement('button');
            button.className = onBoard ? 'add-row-btn added' : 'add-row-btn';
            button.textContent = onBoard ? 'Remove' : 'Add';
            button.addEventListener('click', () => {
                if (this.board.includes(svc.key)) {
                    this.removeService(svc.key);
                    this.renderAddResults();
                } else {
                    this.addService(svc.key);
                }
            });

            row.append(label, button);
            this.addResults.appendChild(row);
        });
    }

    // ---- rendering -------------------------------------------------------

    setLoadingState(loading) {
        this.isLoading = loading;
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn.classList.toggle('loading', loading);
        refreshBtn.disabled = loading;
    }

    showLoadingMessage() {
        this.loadingMessage.style.display = 'flex';
        this.errorMessage.style.display = 'none';
        Object.values(this.categorySections).forEach(s => { s.style.display = 'none'; });
    }

    hideLoadingMessage() {
        this.loadingMessage.style.display = 'none';
    }

    showErrorMessage(text) {
        this.loadingMessage.style.display = 'none';
        this.errorMessage.style.display = 'flex';
        if (text) {
            const p = this.errorMessage.querySelector('p');
            if (p) p.textContent = text;
        }
    }

    clearCardTimers() {
        this.cardTimers.forEach(clearInterval);
        this.cardTimers = [];
    }

    renderServices() {
        // Every render rebuilds the cards, so the previous render's relative-time
        // intervals must be cleared or they accumulate for the life of the page.
        this.clearCardTimers();
        Object.values(this.categoryGrids).forEach(grid => { grid.innerHTML = ''; });

        const byCategory = {};
        this.services.forEach(service => {
            const category = service.category || 'other';
            (byCategory[category] ||= []).push(service);
        });

        Object.entries(this.categorySections).forEach(([category, section]) => {
            const grid = this.categoryGrids[category];
            const services = byCategory[category];
            if (!grid || !section) return;
            if (!services || !services.length) {
                section.style.display = 'none';
                return;
            }
            services
                .sort((a, b) => a.service.localeCompare(b.service))
                .forEach(service => grid.appendChild(this.createServiceCard(service)));
            section.style.display = 'block';
        });
    }

    createServiceCard(service) {
        const card = document.createElement('div');
        card.className = service.icon ? 'service-card has-service-logo' : 'service-card';

        const statusClass = this.getStatusClass(service.status.indicator);
        const statusDescription = service.status.description || 'Unknown';
        const safeServiceName = this.escapeHtml(service.service || 'Unknown Service');
        const safeIcon = service.icon ? this.escapeHtml(service.icon) : '';
        const safeStatusDescription = this.escapeHtml(statusDescription);
        const safeFormattedStatus = this.escapeHtml(this.formatStatusText(statusDescription));
        const incidentCount = service.incidents ? service.incidents.length : 0;
        const hasIncidents = incidentCount > 0;

        card.innerHTML = `
            <div class="service-header">
                <h3 class="service-name" title="${safeServiceName}">
                    ${safeIcon ? `
                        <span class="service-logo-frame" aria-hidden="true">
                            <img class="service-logo" src="${safeIcon}" alt="">
                        </span>
                    ` : ''}
                    <span class="service-name-text">${safeServiceName}</span>
                </h3>
                <span class="service-status ${statusClass}">
                    ${safeFormattedStatus}
                </span>
            </div>
            <div class="service-description">
                Status: ${safeStatusDescription}
                ${service.error ? ' (Connection Error)' : ''}
                ${service.stale ? ' (showing last known)' : ''}
            </div>
            <div class="service-footer">
                <div class="service-meta">
                    <div class="incident-count ${hasIncidents ? 'has-incidents' : ''}">
                        ${hasIncidents ? `${incidentCount} active incident${incidentCount > 1 ? 's' : ''}` : 'No incidents'}
                    </div>
                    <div class="last-updated">
                        Updated: ${this.formatTime(service.last_updated)}
                    </div>
                </div>
                <button class="view-details">Details <span aria-hidden="true">→</span></button>
            </div>
            <button class="service-remove" title="Remove from board" aria-label="Remove ${safeServiceName}">&times;</button>
        `;

        // Click anywhere on the card opens details, as in the original. The
        // View Details button bubbles up to this, so it needs no handler.
        card.addEventListener('click', () => this.showServiceDetails(service));
        card.querySelector('.service-remove')
            .addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeService(service.key);
            });

        const lastUpdatedEl = card.querySelector('.last-updated');
        if (lastUpdatedEl) {
            const tick = () => {
                lastUpdatedEl.textContent = `Updated: ${this.formatTime(service.last_updated)}`;
            };
            tick();
            this.cardTimers.push(setInterval(tick, 10000));
        }

        return card;
    }

    escapeHtml(value) {
        const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
    }

    getStatusClass(indicator) {
        switch (indicator) {
            case 'none': return 'operational';
            case 'minor': return 'degraded';
            case 'major':
            case 'critical': return 'major';
            default: return 'unknown';
        }
    }

    formatStatusText(description) {
        if (!description) return 'Unknown';
        if (/operational|all systems/i.test(description)) return 'Operational';
        if (/degraded|minor/i.test(description)) return 'Degraded';
        if (/major|outage/i.test(description)) return 'Major Outage';
        return description;
    }

    updateStatusSummary() {
        let operational = 0, degraded = 0, outages = 0;
        this.services.forEach(service => {
            const indicator = service.status.indicator;
            if (indicator === 'none') operational++;
            else if (indicator === 'minor') degraded++;
            else if (indicator === 'major' || indicator === 'critical') outages++;
        });
        this.operationalCount.textContent = operational;
        this.degradedCount.textContent = degraded;
        this.outageCount.textContent = outages;
    }

    updateLastUpdated(timestamp) {
        if (timestamp) this.lastUpdated.textContent = this.formatTime(timestamp);
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const diffSecs = Math.floor((new Date() - date) / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        if (diffSecs < 60) {
            return diffSecs < 10 ? 'Just now' : `${Math.floor(diffSecs / 10) * 10}s ago`;
        }
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    showServiceDetails(service) {
        this.detailTitle.textContent = `${service.service} - Service Details`;
        const safeStatusDescription = this.escapeHtml(service.status.description || 'Unknown');
        let content = `
            <div class="service-details">
                <div class="status-summary">
                    <div class="status-row">
                        <span class="status-label">Current Status:</span>
                        <span class="status-value">${safeStatusDescription}</span>
                    </div>
                    <div class="status-row">
                        <span class="status-label">Last Updated:</span>
                        <span class="status-value">${this.formatTime(service.last_updated)}</span>
                    </div>
                </div>
                ${service.error ? '<div class="service-error-note"><strong>Note:</strong> There was an error fetching the latest status information.</div>' : ''}
            <div class="incidents-section">
                <h4>Recent Incidents</h4>
        `;
        if (service.incidents && service.incidents.length > 0) {
            service.incidents.slice(0, 5).forEach(incident => {
                content += `
                    <div class="incident-item">
                        <div class="incident-title">${this.escapeHtml(incident.name || 'Unnamed Incident')}</div>
                        <div class="incident-status ${this.getStatusClass(incident.status)}">${this.escapeHtml(incident.status || 'Unknown')}</div>
                        <div class="incident-description">${this.escapeHtml(incident.description || 'No description available')}</div>
                        ${incident.created_at ? `<div class="update-time">Created: ${this.formatTime(incident.created_at)}</div>` : ''}
                    </div>
                `;
            });
        } else {
            content += `<p class="no-incidents">No recent incidents reported.</p>`;
        }
        content += `</div>`;

        if (service.components && service.components.length > 0) {
            content += `<div class="components-section"><h4>Components</h4><ul class="component-list">`;
            const statusMap = {
                operational: { label: 'Operational', class: 'operational' },
                degraded_performance: { label: 'Degraded Performance', class: 'degraded' },
                partial_outage: { label: 'Partial Outage', class: 'degraded' },
                major_outage: { label: 'Major Outage', class: 'major' },
                under_maintenance: { label: 'Under Maintenance', class: 'maintenance' },
                maintenance: { label: 'Maintenance', class: 'maintenance' }
            };
            service.components.forEach(component => {
                const mapped = statusMap[component.status] || { label: component.status || 'Unknown', class: '' };
                content += `
                        <li class="component-item">
                            <span class="component-name">${this.escapeHtml(component.name || 'Unknown Component')}</span>
                            <span class="component-status ${mapped.class}">${this.escapeHtml(mapped.label)}</span>
                        </li>
                `;
            });
            content += `</ul></div>`;
        }
        content += '</div>';
        this.detailBody.innerHTML = content;
        this.detail.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    closeDetail() {
        this.detail.classList.remove('show');
        document.body.style.overflow = '';
    }

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshInterval = setInterval(() => this.refreshServices(), AUTO_REFRESH_MS);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Assigned to window so the visibilitychange handler below can actually reach
    // it — in the original this was dropped, leaving auto-refresh always running.
    window.serviceStatusDashboard = new ServiceStatusDashboard();
    const waveColor = getComputedStyle(document.documentElement).getPropertyValue('--wave-color');
    initBackgroundWaves(waveColor);
});

document.addEventListener('visibilitychange', () => {
    const dashboard = window.serviceStatusDashboard;
    if (!dashboard) return;
    if (document.hidden) {
        dashboard.stopAutoRefresh();
    } else {
        dashboard.startAutoRefresh();
        dashboard.refreshServices();
    }
});
