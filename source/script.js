//Background waves styling

function initBackgroundWaves(options = {}) {

    const existingWaves = document.querySelector('.waves');
    if (existingWaves) {
        existingWaves.remove();
    }


    let lineColor = "#fff";
    let waveSpeedX = 0.0125;
    let waveSpeedY = 0.005;
    let waveAmpX = 32;
    let waveAmpY = 16;
    let xGap = 10;
    let yGap = 32;
    let friction = 0.925;
    let tension = 0.005;
    let maxCursorMove = 100;
    if (typeof options === "string") {
        lineColor = options;
    } else if (typeof options === "object" && options !== null) {
        ({
            lineColor = lineColor,
            waveSpeedX = waveSpeedX,
            waveSpeedY = waveSpeedY,
            waveAmpX = waveAmpX,
            waveAmpY = waveAmpY,
            xGap = xGap,
            yGap = yGap,
            friction = friction,
            tension = tension,
            maxCursorMove = maxCursorMove
        } = options);
    }

    class Grad {
        constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
        dot2(x, y) { return this.x * x + this.y * y; }
    }
    class Noise {
        constructor(seed = 0) {
            this.grad3 = [
                new Grad(1, 1, 0), new Grad(-1, 1, 0), new Grad(1, -1, 0), new Grad(-1, -1, 0),
                new Grad(1, 0, 1), new Grad(-1, 0, 1), new Grad(1, 0, -1), new Grad(-1, 0, -1),
                new Grad(0, 1, 1), new Grad(0, -1, 1), new Grad(0, 1, -1), new Grad(0, -1, -1)
            ];
            this.p = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30,
                69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219,
                203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74,
                165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105,
                92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208,
                89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217,
                226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17,
                182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167,
                43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246,
                97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239,
                107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254,
                138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180
            ];
            this.perm = new Array(512);
            this.gradP = new Array(512);
            this.seed(seed);
        }
        seed(seed) {
            if (seed > 0 && seed < 1) seed *= 65536;
            seed = Math.floor(seed);
            if (seed < 256) seed |= seed << 8;
            for (let i = 0; i < 256; i++) {
                let v = (i & 1) ? (this.p[i] ^ (seed & 255)) : (this.p[i] ^ ((seed >> 8) & 255));
                this.perm[i] = this.perm[i + 256] = v;
                this.gradP[i] = this.gradP[i + 256] = this.grad3[v % 12];
            }
        }
        perlin2(x, y) {
            function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
            function lerp(a, b, t) { return (1 - t) * a + t * b; }
            let X = Math.floor(x), Y = Math.floor(y);
            x -= X; y -= Y; X &= 255; Y &= 255;
            const n00 = this.gradP[X + this.perm[Y]].dot2(x, y);
            const n01 = this.gradP[X + this.perm[Y + 1]].dot2(x, y - 1);
            const n10 = this.gradP[X + 1 + this.perm[Y]].dot2(x - 1, y);
            const n11 = this.gradP[X + 1 + this.perm[Y + 1]].dot2(x - 1, y - 1);
            const u = fade(x);
            return lerp(
                lerp(n00, n10, u),
                lerp(n01, n11, u),
                fade(y)
            );
        }
    }
    const container = document.createElement('div');
    container.className = 'waves';
    Object.assign(container.style, {
        position: "fixed",
        top: 0,
        left: 0,
        margin: 0,
        padding: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        zIndex: "-1"
    });
    const canvas = document.createElement('canvas');
    canvas.className = 'waves-canvas';
    container.appendChild(canvas);
    document.body.appendChild(container);
    const ctx = canvas.getContext("2d");
    const bounding = { width: 0, height: 0, left: 0, top: 0 };
    const noise = new Noise(Math.random());
    const lines = [];
    const mouse = { x: -10, y: 0, lx: 0, ly: 0, sx: 0, sy: 0, v: 0, vs: 0, a: 0, set: false };
    function setSize() {
        const rect = container.getBoundingClientRect();
        bounding.width = rect.width; bounding.height = rect.height;
        bounding.left = rect.left; bounding.top = rect.top;
        canvas.width = rect.width; canvas.height = rect.height;
    }
    function setLines() {
        const { width, height } = bounding;
        lines.length = 0;
        const oWidth = width + 200, oHeight = height + 30;
        const totalLines = Math.ceil(oWidth / xGap);
        const totalPoints = Math.ceil(oHeight / yGap);
        const xStart = (width - xGap * totalLines) / 2;
        const yStart = (height - yGap * totalPoints) / 2;
        for (let i = 0; i <= totalLines; i++) {
            const pts = [];
            for (let j = 0; j <= totalPoints; j++) {
                pts.push({
                    x: xStart + xGap * i,
                    y: yStart + yGap * j,
                    wave: { x: 0, y: 0 },
                    cursor: { x: 0, y: 0, vx: 0, vy: 0 }
                });
            }
            lines.push(pts);
        }
    }
    function movePoints(time) {
        lines.forEach((pts) => {
            pts.forEach((p) => {
                const move = noise.perlin2(
                    (p.x + time * waveSpeedX) * 0.002,
                    (p.y + time * waveSpeedY) * 0.0015
                ) * 12;
                p.wave.x = Math.cos(move) * waveAmpX;
                p.wave.y = Math.sin(move) * waveAmpY;
                const dx = p.x - mouse.sx, dy = p.y - mouse.sy;
                const dist = Math.hypot(dx, dy), l = Math.max(175, mouse.vs);
                if (dist < l) {
                    const s = 1 - dist / l;
                    const f = Math.cos(dist * 0.001) * s;
                    p.cursor.vx += Math.cos(mouse.a) * f * l * mouse.vs * 0.00065;
                    p.cursor.vy += Math.sin(mouse.a) * f * l * mouse.vs * 0.00065;
                }
                p.cursor.vx += (0 - p.cursor.x) * tension;
                p.cursor.vy += (0 - p.cursor.y) * tension;
                p.cursor.vx *= friction;
                p.cursor.vy *= friction;
                p.cursor.x += p.cursor.vx * 2;
                p.cursor.y += p.cursor.vy * 2;
                p.cursor.x = Math.min(maxCursorMove, Math.max(-maxCursorMove, p.cursor.x));
                p.cursor.y = Math.min(maxCursorMove, Math.max(-maxCursorMove, p.cursor.y));
            });
        });
    }
    function moved(point, withCursor = true) {
        const x = point.x + point.wave.x + (withCursor ? point.cursor.x : 0);
        const y = point.y + point.wave.y + (withCursor ? point.cursor.y : 0);
        return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    }
    function drawLines() {
        ctx.clearRect(0, 0, bounding.width, bounding.height);
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        lines.forEach((points) => {
            let p1 = moved(points[0], false);
            ctx.moveTo(p1.x, p1.y);
            points.forEach((p, idx) => {
                const isLast = idx === points.length - 1;
                p1 = moved(p, !isLast);
                const p2 = moved(points[idx + 1] || points[points.length - 1], !isLast);
                ctx.lineTo(p1.x, p1.y);
                if (isLast) ctx.moveTo(p2.x, p2.y);
            });
        });
        ctx.stroke();
    }
    function tick(t) {
        mouse.sx += (mouse.x - mouse.sx) * 0.1;
        mouse.sy += (mouse.y - mouse.sy) * 0.1;
        const dx = mouse.x - mouse.lx, dy = mouse.y - mouse.ly;
        const d = Math.hypot(dx, dy);
        mouse.v = d;
        mouse.vs += (d - mouse.vs) * 0.1;
        mouse.vs = Math.min(100, mouse.vs);
        mouse.lx = mouse.x; mouse.ly = mouse.y;
        mouse.a = Math.atan2(dy, dx);
        movePoints(t);
        drawLines();
        requestAnimationFrame(tick);
    }
    function onResize() { setSize(); setLines(); }
    function onMouseMove(e) { updateMouse(e.clientX, e.clientY); }
    function onTouchMove(e) { const touch = e.touches[0]; updateMouse(touch.clientX, touch.clientY); }
    function updateMouse(x, y) {
        mouse.x = x - bounding.left;
        mouse.y = y - bounding.top;
        if (!mouse.set) {
            mouse.sx = mouse.x; mouse.sy = mouse.y;
            mouse.lx = mouse.x; mouse.ly = mouse.y;
            mouse.set = true;
        }
    }
    setSize();
    setLines();
    requestAnimationFrame(tick);
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
}









class ServiceStatusDashboard {
    constructor() {
        this.services = [];
        this.isLoading = false;
        this.refreshInterval = null;

        this.initialiseApp();
        this.setupEventListeners();
        this.initialiseDarkMode();
        this.loadServices();

        // Auto-refresh every 5 minutes
        this.startAutoRefresh();
    }

    initialiseApp() {
        // initialise DOM elements
        this.loadingMessage = document.getElementById('loadingMessage');
        this.errorMessage = document.getElementById('errorMessage');
        this.operationalCount = document.getElementById('operationalCount');
        this.degradedCount = document.getElementById('degradedCount');
        this.outageCount = document.getElementById('outageCount');
        this.lastUpdated = document.getElementById('lastUpdated');

        // Category grids
        this.categoryGrids = {
            ai: document.getElementById('aiGrid'),
            messaging: document.getElementById('messagingGrid'),
            streaming: document.getElementById('streamingGrid'),
            developer: document.getElementById('developerGrid'),
            cloud: document.getElementById('cloudGrid'),
            other: document.getElementById('otherGrid')
        };

        // Category sections
        this.categorySections = {
            ai: document.getElementById('aiServices'),
            messaging: document.getElementById('messagingServices'),
            streaming: document.getElementById('streamingServices'),
            developer: document.getElementById('developerServices'),
            cloud: document.getElementById('cloudServices'),
            other: document.getElementById('otherServices')
        };

        // Detail elements
        this.detail = document.getElementById('incidentDetail');
        this.detailTitle = document.getElementById('detailTitle');
        this.detailBody = document.getElementById('detailBody');
        this.detailClose = document.getElementById('detailClose');
    }

    setupEventListeners() {
        // Refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn.addEventListener('click', () => this.refreshServices());

        // Dark mode toggle
        const darkModeToggle = document.getElementById('darkModeToggle');
        darkModeToggle.addEventListener('click', () => this.toggleDarkMode());

        // Detail close events
        this.detailClose.addEventListener('click', () => this.closeDetail());
        this.detail.addEventListener('click', (e) => {
            if (e.target === this.detail) {
                this.closeDetail();
            }
        });

        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.detail.classList.contains('show')) {
                this.closeDetail();
            }
            if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.refreshServices();
            }
        });
    }

    initialiseDarkMode() {
        // Check for saved theme preference or default to system preference
        if (
            localStorage.getItem('theme') === 'dark' ||
            (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        // Listen for system theme changes
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

        // Re‑initialise background waves with new color for the new theme
        const waveColor = getComputedStyle(document.documentElement).getPropertyValue('--wave-color');
        initBackgroundWaves(waveColor);
    }

    async loadServices() {
        if (this.isLoading) return;
        this.setLoadingState(true);
        this.showLoadingMessage();
        try {
            const response = await fetch('/api/status/all');
            const data = await response.json();
            if (data.services) {
                this.services = data.services;
                this.renderServices();
                this.updateStatusSummary();
                this.updateLastUpdated(data.last_updated);
                this.hideLoadingMessage();
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {

            this.showErrorMessage();
        } finally {
            this.setLoadingState(false);
        }
    }

    async refreshServices() {
        await this.loadServices();
    }

    setLoadingState(loading) {
        this.isLoading = loading;
        const refreshBtn = document.getElementById('refreshBtn');

        if (loading) {
            refreshBtn.classList.add('loading');
            refreshBtn.disabled = true;
        } else {
            refreshBtn.classList.remove('loading');
            refreshBtn.disabled = false;
        }
    }

    showLoadingMessage() {
        this.loadingMessage.style.display = 'flex';
        this.errorMessage.style.display = 'none';

        // Hide all category sections
        Object.values(this.categorySections).forEach(section => {
            section.style.display = 'none';
        });
    }

    hideLoadingMessage() {
        this.loadingMessage.style.display = 'none';
    }

    showErrorMessage() {
        this.loadingMessage.style.display = 'none';
        this.errorMessage.style.display = 'flex';
    }

    renderServices() {

        Object.values(this.categoryGrids).forEach(grid => {
            grid.innerHTML = '';
        });

        // Group services by category
        const servicesByCategory = {};
        this.services.forEach(service => {
            const category = service.category || 'other';
            if (!servicesByCategory[category]) {
                servicesByCategory[category] = [];
            }
            servicesByCategory[category].push(service);
        });

        // Render services in each category
        Object.entries(servicesByCategory).forEach(([category, services]) => {
            const grid = this.categoryGrids[category];
            const section = this.categorySections[category];

            if (grid && section) {
                services.forEach(service => {
                    grid.appendChild(this.createServiceCard(service));
                });
                section.style.display = 'block';
            }
        });
    }

    createServiceCard(service) {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.addEventListener('click', () => this.showServiceDetails(service));

        const statusClass = this.getStatusClass(service.status.indicator);
        const statusDescription = service.status.description || 'Unknown';
        const safeServiceName = this.escapeHtml(service.service || 'Unknown Service');
        const safeStatusDescription = this.escapeHtml(statusDescription);
        const safeFormattedStatus = this.escapeHtml(this.formatStatusText(statusDescription));
        const incidentCount = service.incidents ? service.incidents.length : 0;
        const hasIncidents = incidentCount > 0;

        card.innerHTML = `
            <div class="service-header">
                <h3 class="service-name">${safeServiceName}</h3>
                <span class="service-status ${statusClass}">
                    ${safeFormattedStatus}
                </span>
            </div>
            <div class="service-description">
                Status: ${safeStatusDescription}
                ${service.error ? ' (Connection Error)' : ''}
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
                <button class="view-details">View Details</button>
            </div>
        `;

        // Update the last-updated field every 10 seconds in 10s increments
        const lastUpdatedEl = card.querySelector('.last-updated');
        if (lastUpdatedEl) {
            const updateLastUpdatedText = () => {
                lastUpdatedEl.textContent = `Updated: ${this.formatTime(service.last_updated)}`;
            };
            updateLastUpdatedText();
            setInterval(updateLastUpdatedText, 10000);
        }

        return card;
    }

    escapeHtml(value) {
        const entities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
    }

    getStatusClass(indicator) {
        switch (indicator) {
            case 'none':
                return 'operational';
            case 'minor':
                return 'degraded';
            case 'major':
                return 'major';
            case 'critical':
                return 'major';
            default:
                return 'operational';
        }
    }

    formatStatusText(description) {

        if (!description) return 'Unknown';
        if (
            /operational|all systems/i.test(description)
        ) {
            return 'Operational';
        } else if (
            /degraded|minor/i.test(description)
        ) {
            return 'Degraded';
        } else if (
            /major|outage/i.test(description)
        ) {
            return 'Major Outage';
        }
        return description;
    }

    updateStatusSummary() {
        let operational = 0;
        let degraded = 0;
        let outages = 0;

        this.services.forEach(service => {
            const indicator = service.status.indicator;
            if (indicator === 'none' || !indicator) {
                operational++;
            } else if (indicator === 'minor') {
                degraded++;
            } else if (indicator === 'major' || indicator === 'critical') {
                outages++;
            }
        });

        this.operationalCount.textContent = operational;
        this.degradedCount.textContent = degraded;
        this.outageCount.textContent = outages;


    }

    updateLastUpdated(timestamp) {
        if (timestamp) {
            this.lastUpdated.textContent = this.formatTime(timestamp);
        }
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);

        if (diffSecs < 60) {
            if (diffSecs < 10) {
                return 'Just now';
            } else {
                const roundedSecs = Math.floor(diffSecs / 10) * 10;
                return `${roundedSecs}s ago`;
            }
        } else if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffMins < 1440) {
            const hours = Math.floor(diffMins / 60);
            return `${hours}h ago`;
        } else {
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        }
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
                ${
                    service.error
                        ? '<div class="service-error-note"><strong>Note:</strong> There was an error fetching the latest status information.</div>'
                        : ''
                }
        `;
        // Recent Incidents section
        content += `
            <div class="incidents-section">
                <h4>Recent Incidents</h4>
        `;
        if (service.incidents && service.incidents.length > 0) {
            service.incidents.slice(0, 5).forEach(incident => {
                const safeIncidentName = this.escapeHtml(incident.name || 'Unnamed Incident');
                const safeIncidentStatus = this.escapeHtml(incident.status || 'Unknown');
                const safeIncidentDescription = this.escapeHtml(incident.description || 'No description available');
                content += `
                    <div class="incident-item">
                        <div class="incident-title">${safeIncidentName}</div>
                        <div class="incident-status ${this.getStatusClass(incident.status)}">${safeIncidentStatus}</div>
                        <div class="incident-description">${safeIncidentDescription}</div>
                        ${incident.created_at ? `<div class="update-time">Created: ${this.formatTime(incident.created_at)}</div>` : ''}
                    </div>
                `;
            });
        } else {
            content += `<p class="no-incidents">No recent incidents reported.</p>`;
        }
        content += `</div>`;
        // Components section
        if (service.components && service.components.length > 0) {
            content += `
                <div class="components-section">
                    <h4>Components</h4>
                    <ul class="component-list">
            `;
            service.components.forEach(component => {
                const statusMap = {
                    operational: { label: 'Operational', class: 'operational' },
                    degraded_performance: { label: 'Degraded Performance', class: 'degraded' },
                    partial_outage: { label: 'Partial Outage', class: 'degraded' },
                    major_outage: { label: 'Major Outage', class: 'major' },
                    under_maintenance: { label: 'Under Maintenance', class: 'maintenance' },
                    maintenance: { label: 'Maintenance', class: 'maintenance' }
                };
                const mappedStatus = statusMap[component.status] || { label: component.status || 'Unknown', class: '' };
                const safeComponentName = this.escapeHtml(component.name || 'Unknown Component');
                const safeComponentStatus = this.escapeHtml(mappedStatus.label);
                content += `
                        <li class="component-item">
                            <span class="component-name">${safeComponentName}</span>
                            <span class="component-status ${mappedStatus.class}">${safeComponentStatus}</span>
                        </li>
                `;
            });
            content += `
                    </ul>
                </div>
            `;
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

        this.refreshInterval = setInterval(() => {
            this.refreshServices();
        }, 5 * 60 * 1000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}





// initialise the status hub
document.addEventListener('DOMContentLoaded', () => {
    new ServiceStatusDashboard();
    const waveColor = getComputedStyle(document.documentElement).getPropertyValue('--wave-color');
    initBackgroundWaves(waveColor);
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    const dashboard = window.serviceStatusDashboard;
    if (dashboard) {
        if (document.hidden) {
            dashboard.stopAutoRefresh();
        } else {
            dashboard.startAutoRefresh();
            dashboard.refreshServices();
        }
    }
});
