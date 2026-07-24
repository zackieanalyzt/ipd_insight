// Healthcare CMI & NHSO Fund Transfer Dashboard Logic - Unified Portal Version

// Global State
let currentTab = 'cmi'; // 'cmi', 'transfer', or 'items'

// Dashboard 1: CMI State
let cmiRawData = [];
let selectedYears = new Set();
let selectedSchemes = new Set();
let selectedCMIMonths = new Set();
let cmiMin = 0;
let cmiMax = Infinity;
let cmiChartInstance = null;
let cmiMdcTrendChartInstance = null;
let cmiMdcChartSearchQuery = '';
let cmiSortColumn = 'mdc';
let cmiSortDirection = 'asc';

// Dashboard 2: Fund Transfer State
let transferRawData = [];
let selectedTransferYears = new Set();
let selectedTransferMonths = new Set();
let selectedMainFund = 'all';
let transferSearchQuery = '';
let fundMainChartInstance = null;
let fundTrendChartInstance = null;
let transferSortColumn = 'month_year'; // Default sort key
let transferSortDirection = 'desc';

// Dashboard 3: Items State
let itemsRawData = [];
let selectedItemsYears = new Set();
let selectedItemsMonths = new Set();
let selectedVisitType = 'all';
let itemsSearchQuery = '';
let itemsGroupChartInstance = null;
let itemsTrendChartInstance = null;
let itemsSortColumn = 'total_price';
let itemsSortDirection = 'desc';
let itemsTableSearchQuery = '';

// Connection & Failover State
let currentSystemMode = 'db'; // Track DB/CSV mode on client
let statusPollInterval = null;

// Dashboard 4: OPD Visits State
let opdRawData = [];
let opdDiagCache = [];
let opdLocCache = [];
let selectedOpdYears = new Set();
let selectedOpdMonths = new Set();
let selectedOpdSex = new Set();
let selectedOpdDiagTypes = new Set();
let selectedOpdDiagCodes = new Set();
let selectedOpdIns = 'all';
let selectedOpdChangwat = 'all';
let selectedOpdAmphur = 'all';
let selectedOpdDistrict = 'all';
let opdDiagSearchQuery = '';
let opdTrendChartInstance = null;
let opdDiagChartInstance = null;

// =====================================================
// Fullscreen + Resize display area — Template for all charts
// =====================================================

/**
 * Auto-setup fullscreen + resize for all chart containers (.visual-container).
 * Scans the DOM for canvases inside .visual-container and adds:
 *   - Fullscreen toggle button 🗖
 *   - Size slider + +/- buttons (25%-200%)
 *   - CSS resize:both handle on chart-wrapper for drag resizing
 *
 * Runs once on page load — any chart added to HTML gets this automatically.
 */
function setupAllChartFullscreen() {
    const containers = document.querySelectorAll('.visual-container');
    containers.forEach(container => {
        const canvas = container.querySelector('canvas');
        if (!canvas) return;
        const canvasId = canvas.id;
        if (!canvasId) return;

        // Get or create panel-actions
        let panelHeader = container.querySelector('.panel-header');
        if (!panelHeader) return;
        let panelActions = panelHeader.querySelector('.panel-actions');
        if (!panelActions) {
            panelActions = document.createElement('div');
            panelActions.className = 'panel-actions';
            panelHeader.appendChild(panelActions);
        }

        const chartWrapper = canvas.closest('.chart-wrapper');
        if (!chartWrapper) return;

        // ---- Fullscreen toggle button ----
        const fsBtn = document.createElement('button');
        fsBtn.className = 'fullscreen-btn';
        fsBtn.title = 'ขยายเต็มจอ';
        fsBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
        panelActions.appendChild(fsBtn);

        // ---- Size controls (shown only in fullscreen) ----
        const sizeControls = document.createElement('div');
        sizeControls.className = 'size-controls';
        sizeControls.style.display = 'none';
        sizeControls.innerHTML = [
            '<span class="fullscreen-indicator"><i class="fa-solid fa-arrows-up-down-left-right"></i> ปรับขนาดพื้นที่แสดงผล</span>',
            '<button class="size-btn" data-action="sizeOut" title="ย่อลง"><i class="fa-solid fa-minus"></i></button>',
            '<div class="size-slider-wrapper">',
            '  <input type="range" class="size-slider" min="25" max="200" value="100" step="5">',
            '  <span class="size-label">100%</span>',
            '</div>',
            '<button class="size-btn" data-action="sizeIn" title="ขยายขึ้น"><i class="fa-solid fa-plus"></i></button>',
            '<button class="size-btn" data-action="sizeReset" title="รีเซ็ตขนาด"><i class="fa-solid fa-rotate-left"></i> 100%</button>',
            '<button class="exit-fullscreen-btn" title="ออกจากโหมดเต็มจอ"><i class="fa-solid fa-compress"></i> ออกจากโหมดเต็มจอ</button>'
        ].join('');
        panelActions.appendChild(sizeControls);

        // ---- References ----
        const sizeSlider = sizeControls.querySelector('.size-slider');
        const sizeLabel = sizeControls.querySelector('.size-label');
        const wrapperParent = chartWrapper.parentElement;
        let baseW = 0, baseH = 0, isFullscreen = false;

        function resetSize() {
            chartWrapper.style.width = '';
            chartWrapper.style.height = '';
            chartWrapper.style.flex = '';
            sizeSlider.value = 100;
            sizeLabel.textContent = '100%';
            const chart = Chart.getChart(canvas);
            if (chart) chart.resize();
        }

        function applySizePct(pct) {
            if (!isFullscreen) return;
            const w = Math.round(baseW * pct / 100);
            const h = Math.round(baseH * pct / 100);
            chartWrapper.style.width = w + 'px';
            chartWrapper.style.height = h + 'px';
            chartWrapper.style.flex = 'none';
            sizeSlider.value = pct;
            sizeLabel.textContent = pct + '%';
            const chart = Chart.getChart(canvas);
            if (chart) chart.resize();
        }

        sizeSlider.addEventListener('input', () => {
            applySizePct(parseInt(sizeSlider.value));
        });

        sizeControls.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            switch (btn.dataset.action) {
                case 'sizeIn': {
                    let pct = Math.min(200, parseInt(sizeSlider.value) + 10);
                    sizeSlider.value = pct;
                    applySizePct(pct);
                    break;
                }
                case 'sizeOut': {
                    let pct = Math.max(25, parseInt(sizeSlider.value) - 10);
                    sizeSlider.value = pct;
                    applySizePct(pct);
                    break;
                }
                case 'sizeReset':
                    resetSize();
                    break;
            }
        });

        function enterFullscreen() {
            container.classList.add('chart-fullscreen');
            fsBtn.style.display = 'none';
            sizeControls.style.display = 'flex';
            isFullscreen = true;

            requestAnimationFrame(() => {
                const rect = wrapperParent.getBoundingClientRect();
                const header = container.querySelector('.panel-header');
                const headerH = header ? header.getBoundingClientRect().height : 0;
                baseW = rect.width;
                baseH = rect.height - headerH;
                resetSize();
                const chart = Chart.getChart(canvas);
                if (chart) chart.resize();
            });

            document.body.style.overflow = 'hidden';
        }

        function exitFullscreen() {
            container.classList.remove('chart-fullscreen');
            fsBtn.style.display = '';
            sizeControls.style.display = 'none';
            isFullscreen = false;
            resetSize();
            document.body.style.overflow = '';
            const chart = Chart.getChart(canvas);
            if (chart) chart.resize();
        }

        fsBtn.addEventListener('click', enterFullscreen);
        sizeControls.querySelector('.exit-fullscreen-btn').addEventListener('click', exitFullscreen);

        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape' && container.classList.contains('chart-fullscreen')) {
                exitFullscreen();
            }
        });
    });
}

// Distinct color palette for MDCs (Tailwind-like vibrant palette)
const mdcColors = [
    '#3b82f6', // 01 - Blue
    '#10b981', // 02 - Emerald
    '#f59e0b', // 03 - Amber
    '#8b5cf6', // 04 - Purple
    '#ef4444', // 05 - Red
    '#06b6d4', // 06 - Cyan
    '#ec4899', // 07 - Pink
    '#14b8a6', // 08 - Teal
    '#f97316', // 09 - Orange
    '#6366f1', // 10 - Indigo
    '#84cc16', // 11 - Lime
    '#d946ef', // 12 - Magenta
    '#f43f5e', // 13 - Rose
    '#0284c7', // 14 - Sky Blue
    '#a855f7', // 15 - Violet
    '#22c55e', // 16 - Green
    '#be185d', // 17 - Deep Pink
    '#4d7c0f', // 18 - Olive
    '#b45309', // 19 - Brown
    '#0f766e', // 20 - Dark Teal
    '#4338ca', // 21 - Dark Indigo
    '#701a75', // 22 - Deep Violet
    '#059669', // 23 - Medium Emerald
    '#dc2626', // 24 - Dark Red
    '#2563eb'  // 25 - Bright Blue
];

const monthNamesThai = {
    '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
    '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
    '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.'
};

// Document Elements - Common
const loadingOverlay = document.getElementById('loading');
const resetFiltersBtn = document.getElementById('reset-filters');
const themeToggleBtn = document.getElementById('theme-toggle');
const reloadDataBtn = document.getElementById('btn-reload-data');
const adminSettingsBtn = document.getElementById('btn-admin-settings');
const adminModal = document.getElementById('admin-settings-modal');
const adminHourInput = document.getElementById('time-hour');
const adminMinuteInput = document.getElementById('time-minute');
const adminDbUsernameInput = document.getElementById('admin-db-username');
const adminDbPasswordInput = document.getElementById('admin-db-password');
const btnTogglePassword = document.getElementById('btn-toggle-password');
const adminStatusDiv = document.getElementById('admin-sync-status');
const btnAdminSync = document.getElementById('btn-admin-sync');
const btnAdminCancel = document.getElementById('btn-admin-cancel');
const btnAdminSave = document.getElementById('btn-admin-save');
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
const sidebarResizer = document.getElementById('sidebar-resizer');
const sidebarElement = document.querySelector('aside.sidebar');

// Document Elements - Dashboard 1: CMI
const cmiFiltersContainer = document.getElementById('cmi-filters-container');
const cmiDashboardContent = document.getElementById('cmi-dashboard-content');
const yearFiltersContainer = document.getElementById('year-filters');
const schemeFiltersContainer = document.getElementById('scheme-filters');
const cmiMonthFiltersContainer = document.getElementById('cmi-month-filters');
const cmiMinInput = document.getElementById('cmi-min');
const cmiMaxInput = document.getElementById('cmi-max');
const chartZoomResetBtn = document.getElementById('chart-zoom-reset');
const tableSearchInput = document.getElementById('table-search');
const tableBody = document.getElementById('table-body');
const btnExportCsv = document.getElementById('btn-export-csv');
const cmiMdcChartSearch = document.getElementById('cmi-mdc-chart-search');

// Document Elements - Dashboard 2: Fund Transfer
const transferFiltersContainer = document.getElementById('transfer-filters-container');
const transferDashboardContent = document.getElementById('transfer-dashboard-content');
const transferYearFiltersContainer = document.getElementById('transfer-year-filters');
const transferMonthFiltersContainer = document.getElementById('transfer-month-filters');
const transferFundSearchInput = document.getElementById('transfer-fund-search');
const transferFundSelect = document.getElementById('transfer-fund-select');
const transferTableSearchInput = document.getElementById('transfer-table-search');
const transferTableBody = document.getElementById('transfer-table-body');
const btnTransferExportCsv = document.getElementById('btn-transfer-export-csv');
const transferFundSortSelect = document.getElementById('transfer-fund-sort-select');

// Document Elements - Dashboard 3: Items
const itemsFiltersContainer = document.getElementById('items-filters-container');
const itemsDashboardContent = document.getElementById('items-dashboard-content');
const itemsYearFiltersContainer = document.getElementById('items-year-filters');
const itemsMonthFiltersContainer = document.getElementById('items-month-filters');
const itemsSearchInput = document.getElementById('items-search');
const itemsVisitSelect = document.getElementById('items-visit-select');
const itemsTableSearchInput = document.getElementById('items-table-search');
const itemsTableBody = document.getElementById('items-table-body');
const btnItemsExportCsv = document.getElementById('btn-items-export-csv');
const itemsGroupSortSelect = document.getElementById('items-group-sort-select');

// Connection Status Banner Elements
const connectionStatusBanner = document.getElementById('connection-status-banner');
const statusBannerMessage = document.getElementById('status-banner-message');
const btnReconnectRefresh = document.getElementById('btn-reconnect-refresh');
const dataSourceBadge = document.getElementById('data-source-badge');
const dataSourceText = document.getElementById('data-source-text');

// Document Elements - Dashboard 4: OPD Visits
const opdFiltersContainer = document.getElementById('opd-filters-container');
const opdDashboardContent = document.getElementById('opd-dashboard-content');
const opdYearFiltersContainer = document.getElementById('opd-year-filters');
const opdMonthFiltersContainer = document.getElementById('opd-month-filters');
const opdSexFiltersContainer = document.getElementById('opd-sex-filters');
const opdDiagTypeFiltersContainer = document.getElementById('opd-diagtype-filters');
const opdDiagSearch = document.getElementById('opd-diag-search');
const opdDiagSelected = document.getElementById('opd-diag-selected');
const opdDiagSuggestions = document.getElementById('opd-diag-suggestions');
const opdInsSelect = document.getElementById('opd-ins-select');
const opdChangwatSelect = document.getElementById('opd-changwat-select');
const opdAmphurSelect = document.getElementById('opd-amphur-select');
const opdDistrictSelect = document.getElementById('opd-district-select');

// Initialize Dashboard Portal
document.addEventListener('DOMContentLoaded', () => {
    // Restore sidebar state immediately on page load to prevent layout shifts
    const savedWidth = localStorage.getItem('sidebar-width');
    if (savedWidth) {
        document.documentElement.style.setProperty('--sidebar-width', savedWidth);
    }
    const collapsedState = localStorage.getItem('sidebar-collapsed') === 'true';
    if (collapsedState) {
        document.body.classList.add('sidebar-collapsed');
    }

    loadAllData();
    setupEventListeners();
    initConnectionStatusHandler();
    setupOpdEventListeners();
    initGridStack();
});

function resizeAllCharts() {
    if (cmiChartInstance) cmiChartInstance.resize();
    if (cmiMdcTrendChartInstance) cmiMdcTrendChartInstance.resize();
    if (fundMainChartInstance) fundMainChartInstance.resize();
    if (fundTrendChartInstance) fundTrendChartInstance.resize();
    if (itemsGroupChartInstance) itemsGroupChartInstance.resize();
    if (itemsTrendChartInstance) itemsTrendChartInstance.resize();
    if (opdTrendChartInstance) opdTrendChartInstance.resize();
    if (opdDiagChartInstance) opdDiagChartInstance.resize();
}

// Setup event listeners for tab switching, themes, sorting, searching
function setupEventListeners() {
    // Sidebar Toggle Button — improved expand/collapse with icon & tooltip swap
    if (sidebarToggleBtn && sidebarElement) {
        // Restore icon state on page load
        const savedCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
        if (savedCollapsed) {
            sidebarToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            sidebarToggleBtn.title = 'แสดงแถบตัวกรอง';
        } else {
            sidebarToggleBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
            sidebarToggleBtn.title = 'ซ่อนแถบตัวกรอง';
        }

        sidebarToggleBtn.addEventListener('click', () => {
            const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem('sidebar-collapsed', isCollapsed);
            
            // Swap icon and tooltip
            if (isCollapsed) {
                sidebarToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
                sidebarToggleBtn.title = 'แสดงแถบตัวกรอง';
            } else {
                sidebarToggleBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
                sidebarToggleBtn.title = 'ซ่อนแถบตัวกรอง';
            }
            
            setTimeout(resizeAllCharts, 310);
        });
    }

    // Sidebar Resizer (Drag to resize) — improved with collapse-on-dblclick
    if (sidebarResizer && sidebarElement) {
        const onMouseMove = (e) => {
            const containerRect = document.querySelector('.dashboard-container').getBoundingClientRect();
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            if (!clientX) return;

            let newWidth = clientX - containerRect.left;
            const minWidth = 150;
            const maxWidth = 600;

            if (newWidth < minWidth) newWidth = minWidth;
            if (newWidth > maxWidth) newWidth = maxWidth;

            document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
            localStorage.setItem('sidebar-width', `${newWidth}px`);
        };

        const onMouseUp = () => {
            sidebarResizer.classList.remove('dragging');
            sidebarElement.classList.remove('resizing');
            document.body.style.removeProperty('cursor');
            document.body.style.removeProperty('user-select');
            
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('touchmove', onMouseMove);
            document.removeEventListener('touchend', onMouseUp);

            resizeAllCharts();
        };

        const startDrag = (e) => {
            sidebarResizer.classList.add('dragging');
            sidebarElement.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            document.addEventListener('touchmove', onMouseMove, { passive: true });
            document.addEventListener('touchend', onMouseUp);
        };

        sidebarResizer.addEventListener('mousedown', startDrag);
        sidebarResizer.addEventListener('touchstart', startDrag, { passive: true });

        // Double click to toggle collapse/expand (expand/contract)
        sidebarResizer.addEventListener('dblclick', () => {
            const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem('sidebar-collapsed', isCollapsed);
            // Also update toggle button icon
            if (sidebarToggleBtn) {
                if (isCollapsed) {
                    sidebarToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
                    sidebarToggleBtn.title = 'แสดงแถบตัวกรอง';
                } else {
                    sidebarToggleBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
                    sidebarToggleBtn.title = 'ซ่อนแถบตัวกรอง';
                }
            }
            setTimeout(resizeAllCharts, 310);
        });
    }

    // Theme toggle
    themeToggleBtn.addEventListener('click', toggleTheme);

    // Manual CSV reload button
    if (reloadDataBtn) {
        reloadDataBtn.addEventListener('click', () => {
            reloadDataBtn.classList.add('reload-spinning');
            fetch('api/reload', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        // Reload all data from server
                        loadAllData();
                    }
                    reloadDataBtn.classList.remove('reload-spinning');
                })
                .catch(err => {
                    console.error('Reload failed:', err);
                    reloadDataBtn.classList.remove('reload-spinning');
                    hideLoading();
                    alert('โหลดข้อมูลใหม่ล้มเหลว กรุณาลองใหม่อีกครั้ง');
                });
        });
    }

    // Helper to show admin status message
    function showAdminStatus(text, type) {
        if (!adminStatusDiv) return;
        adminStatusDiv.style.display = 'block';
        adminStatusDiv.className = `admin-sync-status ${type}`;
        adminStatusDiv.innerText = text;
    }

    // Time picker interactive arrow buttons
    const btnHourUp = document.getElementById('time-hour-up');
    const btnHourDown = document.getElementById('time-hour-down');
    const btnMinUp = document.getElementById('time-min-up');
    const btnMinDown = document.getElementById('time-min-down');

    function adjustTime(inputEl, delta, max) {
        if (!inputEl) return;
        let val = parseInt(inputEl.value, 10) || 0;
        val += delta;
        if (val < 0) val = max;
        if (val > max) val = 0;
        inputEl.value = String(val).padStart(2, '0');
    }

    if (btnHourUp && adminHourInput) {
        btnHourUp.addEventListener('click', () => adjustTime(adminHourInput, 1, 23));
    }
    if (btnHourDown && adminHourInput) {
        btnHourDown.addEventListener('click', () => adjustTime(adminHourInput, -1, 23));
    }
    if (btnMinUp && adminMinuteInput) {
        btnMinUp.addEventListener('click', () => adjustTime(adminMinuteInput, 1, 59));
    }
    if (btnMinDown && adminMinuteInput) {
        btnMinDown.addEventListener('click', () => adjustTime(adminMinuteInput, -1, 59));
    }

    // Toggle Password Visibility
    if (btnTogglePassword && adminDbPasswordInput) {
        btnTogglePassword.addEventListener('click', () => {
            const type = adminDbPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            adminDbPasswordInput.setAttribute('type', type);
            const icon = btnTogglePassword.querySelector('i');
            if (icon) {
                if (type === 'text') {
                    icon.className = 'fa-solid fa-eye-slash';
                } else {
                    icon.className = 'fa-solid fa-eye';
                }
            }
        });
    }

    // Admin Settings gear button click
    if (adminSettingsBtn && adminModal) {
        adminSettingsBtn.addEventListener('click', () => {
            if (adminDbPasswordInput) {
                adminDbPasswordInput.value = '';
                adminDbPasswordInput.setAttribute('type', 'password');
            }
            const icon = btnTogglePassword ? btnTogglePassword.querySelector('i') : null;
            if (icon) icon.className = 'fa-solid fa-eye';

            if (adminStatusDiv) adminStatusDiv.style.display = 'none';
            
            fetch('api/admin/config')
                .then(res => res.json())
                .then(data => {
                    if (data.time) {
                        const parts = data.time.split(':');
                        if (adminHourInput) adminHourInput.value = parts[0] || '00';
                        if (adminMinuteInput) adminMinuteInput.value = parts[1] || '00';
                    }
                    if (adminDbUsernameInput && data.user) {
                        adminDbUsernameInput.value = data.user;
                    }
                    adminModal.classList.add('active');
                })
                .catch(err => {
                    console.error('Failed to load sync config:', err);
                    alert('ไม่สามารถโหลดข้อมูลตั้งค่าได้');
                });
        });
    }

    // Admin Settings Cancel
    if (btnAdminCancel && adminModal) {
        btnAdminCancel.addEventListener('click', () => {
            adminModal.classList.remove('active');
        });
    }

    // Admin Settings Save Time
    if (btnAdminSave && adminModal) {
        btnAdminSave.addEventListener('click', () => {
            const hour = adminHourInput ? adminHourInput.value.trim() : '00';
            const minute = adminMinuteInput ? adminMinuteInput.value.trim() : '00';
            const time = `${hour}:${minute}`;
            const user = adminDbUsernameInput ? adminDbUsernameInput.value.trim() : '';
            const password = adminDbPasswordInput ? adminDbPasswordInput.value : '';

            if (!user) {
                showAdminStatus('กรุณากรอกชื่อผู้ใช้ฐานข้อมูล (User)', 'error');
                return;
            }
            if (!password) {
                showAdminStatus('กรุณากรอกรหัสผ่านเพื่อตรวจสอบสิทธิ์', 'error');
                return;
            }

            showAdminStatus('กำลังบันทึก...', 'info');
            btnAdminSave.disabled = true;

            fetch('api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, password, time })
            })
            .then(async res => {
                const data = await res.json();
                if (res.ok && data.success) {
                    showAdminStatus('บันทึกเวลาและอัปเดตสิทธิ์เชื่อมต่อสำเร็จ!', 'success');
                    setTimeout(() => {
                        adminModal.classList.remove('active');
                    }, 1500);
                } else {
                    showAdminStatus(data.message || 'บันทึกไม่สำเร็จ', 'error');
                }
            })
            .catch(err => {
                console.error('Save config failed:', err);
                showAdminStatus('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
            })
            .finally(() => {
                btnAdminSave.disabled = false;
            });
        });
    }

    // Admin Settings Sync Now
    if (btnAdminSync && adminModal) {
        btnAdminSync.addEventListener('click', () => {
            const user = adminDbUsernameInput ? adminDbUsernameInput.value.trim() : '';
            const password = adminDbPasswordInput ? adminDbPasswordInput.value : '';

            if (!user) {
                showAdminStatus('กรุณากรอกชื่อผู้ใช้ฐานข้อมูล (User)', 'error');
                return;
            }
            if (!password) {
                showAdminStatus('กรุณากรอกรหัสผ่านเพื่อสั่งดึงข้อมูล', 'error');
                return;
            }

            showAdminStatus('กำลังดึงข้อมูลจาก Database (ขั้นตอนนี้อาจใช้เวลา 1-2 นาที)...', 'info');
            btnAdminSync.disabled = true;
            if (btnAdminSave) btnAdminSave.disabled = true;
            if (btnAdminCancel) btnAdminCancel.disabled = true;

            fetch('api/admin/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, password })
            })
            .then(async res => {
                const data = await res.json();
                if (res.ok && data.success) {
                    showAdminStatus('ดึงข้อมูลสำเร็จและอัปเดตระบบเรียบร้อย!', 'success');
                    loadAllData();
                    setTimeout(() => {
                        adminModal.classList.remove('active');
                    }, 2000);
                } else {
                    showAdminStatus(data.message || 'การดึงข้อมูลล้มเหลว', 'error');
                }
            })
            .catch(err => {
                console.error('Manual sync failed:', err);
                showAdminStatus('เกิดข้อผิดพลาดในการดึงข้อมูล', 'error');
            })
            .finally(() => {
                btnAdminSync.disabled = false;
                if (btnAdminSave) btnAdminSave.disabled = false;
                if (btnAdminCancel) btnAdminCancel.disabled = false;
            });
        });
    }

    // Tab switching
    document.querySelectorAll('.portal-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            switchTab(tab);
        });
    });

    // Reset filters (resets active tab's filters)
    resetFiltersBtn.addEventListener('click', resetActiveTabFilters);
    
    // ----------------------------------------------------
    // Event listeners - CMI
    // ----------------------------------------------------
    cmiMinInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        cmiMin = isNaN(val) ? 0 : val;
        updateCMIDashboard();
    });
    
    cmiMaxInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        cmiMax = isNaN(val) ? Infinity : val;
        updateCMIDashboard();
    });
    
    chartZoomResetBtn.addEventListener('click', () => {
        updateCMIDashboard();
    });

    if (cmiMdcChartSearch) {
        cmiMdcChartSearch.addEventListener('input', (e) => {
            cmiMdcChartSearchQuery = e.target.value.toLowerCase().trim();
            renderCmiMdcTrendChart();
        });
    }
    
    tableSearchInput.addEventListener('input', () => {
        renderCMITable();
    });
    
    // Sorting CMI Table
    document.querySelectorAll('#data-table th[data-column]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-column');
            if (cmiSortColumn === column) {
                cmiSortDirection = cmiSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                cmiSortColumn = column;
                cmiSortDirection = column === 'mdc' || column === 'mdc_desc' ? 'asc' : 'desc';
            }
            
            document.querySelectorAll('#data-table th[data-column]').forEach(el => {
                el.classList.remove('sort-asc', 'sort-desc');
            });
            th.classList.add(cmiSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            
            renderCMITable();
        });
    });
    
    btnExportCsv.addEventListener('click', exportCMITableToCsv);

    // ----------------------------------------------------
    // Event listeners - Fund Transfer
    // ----------------------------------------------------
    transferFundSelect.addEventListener('change', (e) => {
        selectedMainFund = e.target.value;
        updateTransferDashboard();
    });

    transferTableSearchInput.addEventListener('input', () => {
        renderTransferTable();
    });

    // Sorting Transfer Table
    document.querySelectorAll('#transfer-data-table th[data-column]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-column');
            if (transferSortColumn === column) {
                transferSortDirection = transferSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                transferSortColumn = column;
                transferSortDirection = column === 'main_fund' || column === 'sub_fund' ? 'asc' : 'desc';
            }
            
            document.querySelectorAll('#transfer-data-table th[data-column]').forEach(el => {
                el.classList.remove('sort-asc', 'sort-desc');
            });
            th.classList.add(transferSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            
            renderTransferTable();
        });
    });

    btnTransferExportCsv.addEventListener('click', exportTransferTableToCsv);

    if (transferFundSortSelect) {
        transferFundSortSelect.addEventListener('change', () => {
            updateTransferDashboard();
        });
    }

    // Fund search input
    transferFundSearchInput.addEventListener('input', (e) => {
        transferSearchQuery = e.target.value.toLowerCase().trim();
        updateTransferDashboard();
    });

    // ----------------------------------------------------
    // Event listeners - Items Summary (Dashboard 3)
    // ----------------------------------------------------
    itemsVisitSelect.addEventListener('change', (e) => {
        selectedVisitType = e.target.value;
        updateItemsDashboard();
    });

    itemsSearchInput.addEventListener('input', (e) => {
        itemsSearchQuery = e.target.value.toLowerCase().trim();
        updateItemsDashboard();
    });

    itemsTableSearchInput.addEventListener('input', () => {
        renderItemsTable();
    });

    btnItemsExportCsv.addEventListener('click', exportItemsTableToCsv);

    if (itemsGroupSortSelect) {
        itemsGroupSortSelect.addEventListener('change', () => {
            updateItemsDashboard();
        });
    }

    // Sorting Items Table
    document.querySelectorAll('#items-data-table th[data-column]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-column');
            if (itemsSortColumn === column) {
                itemsSortDirection = itemsSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                itemsSortColumn = column;
                itemsSortDirection = column === 'visit_type' || column === 'item_group' || column === 'item_common_name' ? 'asc' : 'desc';
            }
            
            document.querySelectorAll('#items-data-table th[data-column]').forEach(el => {
                el.classList.remove('sort-asc', 'sort-desc');
            });
            th.classList.add(itemsSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            
            renderItemsTable();
        });
    });

}

// Switch between portal tabs (CMI vs Fund Transfer)
function switchTab(tab) {
    if (currentTab === tab) return;
    currentTab = tab;

    // Toggle nav active state
    document.querySelectorAll('.portal-tab-btn').forEach(btn => {
        const tabAttr = btn.getAttribute('data-tab');
        if (tabAttr === tab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Toggle filter sidebars
    cmiFiltersContainer.classList.remove('active');
    transferFiltersContainer.classList.remove('active');
    itemsFiltersContainer.classList.remove('active');
    opdFiltersContainer.classList.remove('active');
    
    cmiDashboardContent.classList.remove('active');
    transferDashboardContent.classList.remove('active');
    itemsDashboardContent.classList.remove('active');
    opdDashboardContent.classList.remove('active');

    if (tab === 'cmi') {
        cmiFiltersContainer.classList.add('active');
        cmiDashboardContent.classList.add('active');
        updateCMIDashboard();
    } else if (tab === 'transfer') {
        transferFiltersContainer.classList.add('active');
        transferDashboardContent.classList.add('active');
        updateTransferDashboard();
    } else if (tab === 'items') {
        itemsFiltersContainer.classList.add('active');
        itemsDashboardContent.classList.add('active');
        updateItemsDashboard();
    } else if (tab === 'opd') {
        opdFiltersContainer.classList.add('active');
        opdDashboardContent.classList.add('active');
        updateOpdDashboard();
    }

    // Reflow GridStack for the active tab (ensures proper layout after tab switch)
    if (grids[tab]) {
        setTimeout(() => {
            grids[tab].compact();
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }
}

// Reset filters depending on which tab is active
function resetActiveTabFilters() {
    if (currentTab === 'cmi') {
        const checkboxes = yearFiltersContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = true;
            selectedYears.add(parseInt(cb.value));
        });
        
        const schemeCheckboxes = schemeFiltersContainer.querySelectorAll('input[type="checkbox"]');
        schemeCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedSchemes.add(cb.value);
        });

        const monthCheckboxes = cmiMonthFiltersContainer.querySelectorAll('input[type="checkbox"]');
        monthCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedCMIMonths.add(cb.value);
            cb.parentElement.classList.add('checked');
        });
        
        cmiMinInput.value = '';
        cmiMaxInput.value = '';
        cmiMin = 0;
        cmiMax = Infinity;
        tableSearchInput.value = '';
        updateCMIDashboard();
    } else if (currentTab === 'transfer') {
        const yearCheckboxes = transferYearFiltersContainer.querySelectorAll('input[type="checkbox"]');
        yearCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedTransferYears.add(parseInt(cb.value));
        });
        
        const monthCheckboxes = transferMonthFiltersContainer.querySelectorAll('input[type="checkbox"]');
        monthCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedTransferMonths.add(cb.value);
            cb.parentElement.classList.add('checked');
        });
        
        transferFundSelect.value = 'all';
        selectedMainFund = 'all';
        transferFundSearchInput.value = '';
        transferSearchQuery = '';
        transferTableSearchInput.value = '';
        updateTransferDashboard();
    } else if (currentTab === 'items') {
        const yearCheckboxes = itemsYearFiltersContainer.querySelectorAll('input[type="checkbox"]');
        yearCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedItemsYears.add(parseInt(cb.value));
        });

        const monthCheckboxes = itemsMonthFiltersContainer.querySelectorAll('input[type="checkbox"]');
        monthCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedItemsMonths.add(cb.value);
            cb.parentElement.classList.add('checked');
        });

        itemsVisitSelect.value = 'all';
        selectedVisitType = 'all';
        itemsSearchInput.value = '';
        itemsSearchQuery = '';
        itemsTableSearchInput.value = '';
        updateItemsDashboard();
    } else if (currentTab === 'opd') {
        const yearCheckboxes = opdYearFiltersContainer.querySelectorAll('input[type="checkbox"]');
        yearCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedOpdYears.add(parseInt(cb.value));
        });

        const monthCheckboxes = opdMonthFiltersContainer.querySelectorAll('input[type="checkbox"]');
        monthCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedOpdMonths.add(cb.value);
            cb.parentElement.classList.add('checked');
        });

        const sexCheckboxes = opdSexFiltersContainer.querySelectorAll('input[type="checkbox"]');
        sexCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedOpdSex.add(cb.value);
        });

        const diagCheckboxes = opdDiagTypeFiltersContainer.querySelectorAll('input[type="checkbox"]');
        diagCheckboxes.forEach(cb => {
            cb.checked = true;
            selectedOpdDiagTypes.add(cb.value);
        });

        opdInsSelect.value = 'all';
        selectedOpdIns = 'all';
        opdChangwatSelect.value = 'all';
        selectedOpdChangwat = 'all';
        opdAmphurSelect.value = 'all';
        selectedOpdAmphur = 'all';
        opdDistrictSelect.value = 'all';
        selectedOpdDistrict = 'all';
        if (opdDiagSearch) opdDiagSearch.value = '';
        selectedOpdDiagCodes.clear();
        if (opdDiagSelected) opdDiagSelected.innerHTML = '';
        updateOpdDashboard();
    }
}

function loadAllData() {
    showLoading();
    
    let cmiLoaded = false;
    let transferLoaded = false;
    let itemsLoaded = false;
    let opdLoaded = false;
    let opdDiagLoaded = false;
    let opdLocLoaded = false;

    function checkAllLoaded() {
        if (cmiLoaded && transferLoaded && itemsLoaded && opdLoaded &&
            opdDiagLoaded && opdLocLoaded) {
            onAllDataReady();
        }
    }

    // Check system status first
    fetch('api/status')
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch status');
            return res.json();
        })
        .then(statusData => {
            currentSystemMode = statusData.mode;
            updateStatusBanner(statusData.mode, false);
        })
        .catch(err => {
            console.error('Error fetching system status on load:', err);
            currentSystemMode = 'csv';
            updateStatusBanner('csv', false);
        });

    // Fetch CMI data from Server API
    fetch('api/cmi')
        .then(res => {
            if (!res.ok) throw new Error('Failed to load CMI data');
            return res.json();
        })
        .then(data => {
            cmiRawData = data;
            cmiLoaded = true;
            checkAllLoaded();
        })
        .catch(err => {
            console.error('Error loading CMI data:', err);
            cmiLoaded = true;
            checkAllLoaded();
        });

    // Fetch Transfers data from Server API
    fetch('api/transfers')
        .then(res => {
            if (!res.ok) throw new Error('Failed to load Transfers data');
            return res.json();
        })
        .then(data => {
            transferRawData = data;
            transferLoaded = true;
            checkAllLoaded();
        })
        .catch(err => {
            console.error('Error loading Transfers data:', err);
            transferLoaded = true;
            checkAllLoaded();
        });

    // Fetch Items Summary data from Server API
    fetch('api/items')
        .then(res => {
            if (!res.ok) throw new Error('Failed to load Items data');
            return res.json();
        })
        .then(data => {
            itemsRawData = data;
            itemsLoaded = true;
            checkAllLoaded();
        })
        .catch(err => {
            console.error('Error loading Items data:', err);
            itemsLoaded = true;
            checkAllLoaded();
        });

    // Fetch OPD Summary data from Server API
    fetch('api/opd/summary')
        .then(res => {
            if (!res.ok) throw new Error('Failed to load OPD data');
            return res.json();
        })
        .then(data => {
            opdRawData = data;
            opdLoaded = true;
            checkAllLoaded();
        })
        .catch(err => {
            console.error('Error loading OPD data:', err);
            opdLoaded = true;
            checkAllLoaded();
        });

    // Fetch OPD Diag Summary data
    fetch('api/opd/diag-summary')
        .then(res => {
            if (!res.ok) throw new Error('Failed to load OPD diag data');
            return res.json();
        })
        .then(data => {
            opdDiagCache = data;
            opdDiagLoaded = true;
            checkAllLoaded();
        })
        .catch(err => {
            console.error('Error loading OPD diag data:', err);
            opdDiagLoaded = true;
            checkAllLoaded();
        });

    // Fetch OPD Location Summary data
    fetch('api/opd/locations')
        .then(res => {
            if (!res.ok) throw new Error('Failed to load OPD location data');
            return res.json();
        })
        .then(data => {
            opdLocCache = data;
            opdLocLoaded = true;
            checkAllLoaded();
        })
        .catch(err => {
            console.error('Error loading OPD location data:', err);
            opdLocLoaded = true;
            checkAllLoaded();
        });
}

function initConnectionStatusHandler() {
    // Polling Status Checker every 10 seconds
    if (statusPollInterval) clearInterval(statusPollInterval);
    
    statusPollInterval = setInterval(() => {
        fetch('api/status')
            .then(res => {
                if (!res.ok) throw new Error('Status endpoint error');
                return res.json();
            })
            .then(statusData => {
                const newMode = statusData.mode;
                
                // Case 1: Was DB, now CSV (Disconnection)
                if (currentSystemMode === 'db' && newMode === 'csv') {
                    currentSystemMode = 'csv';
                    updateStatusBanner('csv', false);
                }
                // Case 2: Was CSV, now DB (Reconnection - show refresh button)
                else if (currentSystemMode === 'csv' && newMode === 'db') {
                    updateStatusBanner('db', true);
                }
            })
            .catch(err => {
                console.error('Status polling check failed:', err.message);
                if (currentSystemMode === 'db') {
                    currentSystemMode = 'csv';
                    updateStatusBanner('csv', false);
                }
            });
    }, 10000);

    // Event listener for the reconnect refresh button
    if (btnReconnectRefresh) {
        btnReconnectRefresh.addEventListener('click', () => {
            console.log('User triggered manual data reload from database...');
            currentSystemMode = 'db';
            updateStatusBanner('db', false); // Hide banner
            loadAllData(); // Reload data from API
        });
    }
}

function updateStatusBanner(mode, suggestRefresh) {
    // Update header status badge
    if (dataSourceBadge && dataSourceText) {
        if (mode === 'csv') {
            dataSourceBadge.className = 'data-source-badge csv';
            dataSourceText.innerText = 'Backup (CSV)';
        } else if (mode === 'db') {
            dataSourceBadge.className = 'data-source-badge db';
            dataSourceText.innerText = 'Database (PostgreSQL)';
        }
    }

    if (!connectionStatusBanner || !statusBannerMessage || !btnReconnectRefresh) return;

    if (mode === 'csv') {
        connectionStatusBanner.className = 'status-banner'; // Reset to standard warning styles
        statusBannerMessage.innerHTML = `<i class="fa-solid fa-triangle-exclamation status-banner-icon"></i> ขณะนี้ระบบกำลังใช้ข้อมูลสำรองจากไฟล์ .csv เนื่องจากหลุดการเชื่อมต่อจากฐานข้อมูลหลัก (ข้อมูลอาจจะไม่เป็นปัจจุบัน)`;
        btnReconnectRefresh.classList.add('hidden');
        connectionStatusBanner.classList.remove('hidden');
    } else if (mode === 'db') {
        if (suggestRefresh) {
            connectionStatusBanner.className = 'status-banner success'; // Add green success style
            statusBannerMessage.innerHTML = `<i class="fa-solid fa-circle-check status-banner-icon"></i> เชื่อมต่อฐานข้อมูลหลักสำเร็จ ข้อมูลได้รับการกู้คืนแล้ว โปรดกดปุ่มด้านขวาเพื่อโหลดข้อมูลใหม่ล่าสุด`;
            btnReconnectRefresh.classList.remove('hidden');
            connectionStatusBanner.classList.remove('hidden');
        } else {
            connectionStatusBanner.classList.add('hidden');
            btnReconnectRefresh.classList.add('hidden');
        }
    }
}

function updateLatestDataBadges() {
    // 1. CMI latest month/year
    let cmiMaxYear = 0;
    let cmiMaxMonth = 0;
    cmiRawData.forEach(row => {
        const y = parseInt(row.year);
        const m = parseInt(row.month);
        if (y > cmiMaxYear || (y === cmiMaxYear && m > cmiMaxMonth)) {
            cmiMaxYear = y;
            cmiMaxMonth = m;
        }
    });
    if (cmiMaxYear > 0 && cmiMaxMonth > 0) {
        const monthStr = cmiMaxMonth.toString().padStart(2, '0');
        const monthName = monthNamesThai[monthStr] || monthStr;
        const text = `ข้อมูลล่าสุด: ${monthName} ${cmiMaxYear}`;
        const b1 = document.getElementById('cmi-scatter-latest');
        const b2 = document.getElementById('cmi-trend-latest');
        if (b1) b1.innerText = text;
        if (b2) b2.innerText = text;
    }

    // 2. Transfers latest date using transfer_date
    let transMaxYear = 0;
    let transMaxMonth = 0;
    let transMaxDate = 0;
    let latestTransferDate = '';
    transferRawData.forEach(row => {
        const y = parseInt(row.year);
        const m = parseInt(row.month);
        const d = parseInt(row.date) || 0;
        if (y > transMaxYear || 
           (y === transMaxYear && m > transMaxMonth) || 
           (y === transMaxYear && m === transMaxMonth && d > transMaxDate)) {
            transMaxYear = y;
            transMaxMonth = m;
            transMaxDate = d;
            latestTransferDate = row.transfer_date;
        }
    });
    if (latestTransferDate) {
        const text = `ข้อมูลล่าสุด: ${latestTransferDate}`;
        const b1 = document.getElementById('transfer-main-latest');
        const b2 = document.getElementById('transfer-trend-latest');
        if (b1) b1.innerText = text;
        if (b2) b2.innerText = text;
    }

    // 3. Items latest month/year
    let itemsMaxYear = 0;
    let itemsMaxMonth = 0;
    itemsRawData.forEach(row => {
        const y = parseInt(row.year);
        const m = parseInt(row.month);
        if (y > itemsMaxYear || (y === itemsMaxYear && m > itemsMaxMonth)) {
            itemsMaxYear = y;
            itemsMaxMonth = m;
        }
    });
    if (itemsMaxYear > 0 && itemsMaxMonth > 0) {
        const monthStr = itemsMaxMonth.toString().padStart(2, '0');
        const monthName = monthNamesThai[monthStr] || monthStr;
        const text = `ข้อมูลล่าสุด: ${monthName} ${itemsMaxYear}`;
        const b1 = document.getElementById('items-group-latest');
        const b2 = document.getElementById('items-trend-latest');
        if (b1) b1.innerText = text;
        if (b2) b2.innerText = text;
    }
}

function onAllDataReady() {
    initializeCMIFilters();
    initializeTransferFilters();
    initializeItemsFilters();
    initializeOpdFilters();
    initCmiBenchmark();
    updateLatestDataBadges();
    hideLoading();

    // Render default CMI tab
    updateCMIDashboard();

    // Auto-setup fullscreen + resize for ALL chart containers (template)
    setupAllChartFullscreen();

    // Refresh all GridStack layouts after data is rendered
    setTimeout(() => {
        ['cmi', 'transfer', 'items', 'opd'].forEach(tab => {
            if (grids[tab]) {
                grids[tab].compact();
            }
        });
        window.dispatchEvent(new Event('resize'));
    }, 200);
}

// -----------------------------------------------------------------------------
// DASHBOARD 1: CMI LOGIC
// -----------------------------------------------------------------------------

function getMdcColor(mdcCode) {
    const code = parseInt(mdcCode) || 0;
    const index = (code - 1) % mdcColors.length;
    return mdcColors[index >= 0 ? index : 0];
}

function initializeCMIFilters() {
    const uniqueYears = [...new Set(cmiRawData.map(row => row.byear))].sort((a, b) => b - a);
    selectedYears = new Set(uniqueYears);
    
    yearFiltersContainer.innerHTML = '';
    uniqueYears.forEach(year => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = year;
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) selectedYears.add(year);
            else selectedYears.delete(year);
            updateCMIDashboard();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(`ปีงบประมาณ ${year}`));
        yearFiltersContainer.appendChild(label);
    });
    
    const uniqueSchemes = [...new Set(cmiRawData.map(row => row.insure_desc))].sort();
    selectedSchemes = new Set(uniqueSchemes);
    
    schemeFiltersContainer.innerHTML = '';
    uniqueSchemes.forEach(scheme => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = scheme;
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) selectedSchemes.add(scheme);
            else selectedSchemes.delete(scheme);
            updateCMIDashboard();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(scheme));
        schemeFiltersContainer.appendChild(label);
    });

    // 3. Setup month checkboxes grid for CMI
    const allMonths = ['10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09']; // Fiscal year calendar order
    selectedCMIMonths = new Set(allMonths);
    
    cmiMonthFiltersContainer.innerHTML = '';
    allMonths.forEach(monthCode => {
        const monthLabel = monthNamesThai[monthCode] || monthCode;
        
        const label = document.createElement('label');
        label.className = 'checkbox-label checked'; // Initially all checked
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = monthCode;
        checkbox.checked = true;
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedCMIMonths.add(monthCode);
                label.classList.add('checked');
            } else {
                selectedCMIMonths.delete(monthCode);
                label.classList.remove('checked');
            }
            updateCMIDashboard();
        });
        
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(monthLabel));
        cmiMonthFiltersContainer.appendChild(label);
    });
}

function getAggregatedCMIData() {
    const filtered = cmiRawData.filter(row => {
        if (!selectedYears.has(row.byear)) return false;
        if (!selectedSchemes.has(row.insure_desc)) return false;
        const monthStr = row.month.toString().padStart(2, '0');
        if (!selectedCMIMonths.has(monthStr)) return false;
        return true;
    });
    
    const grouped = {};
    filtered.forEach(row => {
        const key = row.mdc;
        if (!grouped[key]) {
            grouped[key] = {
                mdc: row.mdc,
                mdc_desc: row.mdc_desc,
                total: 0,
                sum_adjrw: 0,
                surgery_total: 0,
                surgery_sum_adjrw: 0,
                med_total: 0,
                med_sum_adjrw: 0
            };
        }
        grouped[key].total += row.total;
        grouped[key].sum_adjrw += row.sum_adjrw;
        grouped[key].surgery_total += row.surgery_total;
        grouped[key].surgery_sum_adjrw += row.surgery_sum_adjrw;
        grouped[key].med_total += row.med_total;
        grouped[key].med_sum_adjrw += row.med_sum_adjrw;
    });
    
    return Object.values(grouped).map(group => {
        const cmi = group.total > 0 ? (group.sum_adjrw / group.total) : 0;
        return { ...group, cmi: cmi };
    }).filter(item => item.cmi >= cmiMin && item.cmi <= cmiMax);
}

function updateCMIDashboard() {
    if (currentTab !== 'cmi') return;
    
    const aggregated = getAggregatedCMIData();
    updateCMIKPIs(aggregated);
    renderCMIChart(aggregated);
    renderCmiMdcTrendChart();
    renderCMITable(aggregated);
}

function getCMIKPIValuesForYear(year) {
    const filtered = cmiRawData.filter(row => {
        if (row.byear !== year) return false;
        if (!selectedSchemes.has(row.insure_desc)) return false;
        const monthStr = row.month.toString().padStart(2, '0');
        if (!selectedCMIMonths.has(monthStr)) return false;
        return true;
    });

    const totalVolume = filtered.reduce((sum, item) => sum + item.total, 0);
    const totalAdjRw = filtered.reduce((sum, item) => sum + item.sum_adjrw, 0);
    const avgCmi = totalVolume > 0 ? (totalAdjRw / totalVolume) : 0;

    return { totalVolume, totalAdjRw, avgCmi };
}

function updateCMIKPIs(aggregatedData) {
    const totalVolume = aggregatedData.reduce((sum, item) => sum + item.total, 0);
    const totalAdjRw = aggregatedData.reduce((sum, item) => sum + item.sum_adjrw, 0);
    const avgCmi = totalVolume > 0 ? (totalAdjRw / totalVolume) : 0;
    
    let topBurdenItem = null;
    aggregatedData.forEach(item => {
        if (!topBurdenItem || item.sum_adjrw > topBurdenItem.sum_adjrw) {
            topBurdenItem = item;
        }
    });
    
    document.getElementById('val-total-volume').textContent = totalVolume.toLocaleString();
    document.getElementById('val-avg-cmi').textContent = avgCmi.toFixed(4);
    document.getElementById('val-total-adjrw').textContent = totalAdjRw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Calculate YoY Comparison
    const availableYears = [...new Set(cmiRawData.map(row => row.byear))];
    const { targetYear, baseYear } = getComparisonYears(selectedYears, availableYears);
    
    if (targetYear && baseYear) {
        const targetKPIs = getCMIKPIValuesForYear(targetYear);
        const baseKPIs = getCMIKPIValuesForYear(baseYear);
        const customText = `เทียบกับปีงบประมาณ ${baseYear}`;

        renderKPIChangeBadge('badge-total-volume', targetKPIs.totalVolume, baseKPIs.totalVolume, 'percentage', customText);
        renderKPIChangeBadge('badge-avg-cmi', targetKPIs.avgCmi, baseKPIs.avgCmi, 'percentage', customText);
        renderKPIChangeBadge('badge-total-adjrw', targetKPIs.totalAdjRw, baseKPIs.totalAdjRw, 'percentage', customText);
    } else {
        renderKPIChangeBadge('badge-total-volume', null, null);
        renderKPIChangeBadge('badge-avg-cmi', null, null);
        renderKPIChangeBadge('badge-total-adjrw', null, null);
    }
    
    const topBurdenValEl = document.getElementById('val-top-burden');
    const topBurdenAmtEl = document.getElementById('val-top-burden-amount');
    
    if (topBurdenItem) {
        topBurdenValEl.textContent = `MDC ${topBurdenItem.mdc}: ${topBurdenItem.mdc_desc}`;
        topBurdenValEl.title = `MDC ${topBurdenItem.mdc}: ${topBurdenItem.mdc_desc}`;
        topBurdenAmtEl.textContent = `${topBurdenItem.sum_adjrw.toLocaleString(undefined, { maximumFractionDigits: 2 })} AdjRw`;
        document.getElementById('kpi-top-burden').style.setProperty('--primary', getMdcColor(topBurdenItem.mdc));
    } else {
        topBurdenValEl.textContent = '-';
        topBurdenAmtEl.textContent = '0.00 AdjRw';
    }

    // Surgical vs Medical calculations
    const surTotal = aggregatedData.reduce((sum, item) => sum + (item.surgery_total || 0), 0);
    const medTotal = aggregatedData.reduce((sum, item) => sum + (item.med_total || 0), 0);
    const overallTotalVolume = surTotal + medTotal;

    const surVolPct = overallTotalVolume > 0 ? (surTotal / overallTotalVolume) * 100 : 0;
    const medVolPct = overallTotalVolume > 0 ? (medTotal / overallTotalVolume) * 100 : 0;

    const surSumAdj = aggregatedData.reduce((sum, item) => sum + (item.surgery_sum_adjrw || 0), 0);
    const medSumAdj = aggregatedData.reduce((sum, item) => sum + (item.med_sum_adjrw || 0), 0);
    const overallSumAdj = surSumAdj + medSumAdj;

    const surAdjPct = overallSumAdj > 0 ? (surSumAdj / overallSumAdj) * 100 : 0;
    const medAdjPct = overallSumAdj > 0 ? (medSumAdj / overallSumAdj) * 100 : 0;

    const surCmi = surTotal > 0 ? (surSumAdj / surTotal) : 0;
    const medCmi = medTotal > 0 ? (medSumAdj / medTotal) : 0;

    // Update Progress Bars (Width and value)
    const barVolumeSur = document.getElementById('bar-volume-sur');
    const barVolumeNonsur = document.getElementById('bar-volume-nonsur');
    if (barVolumeSur) barVolumeSur.style.width = `${surVolPct}%`;
    if (barVolumeNonsur) barVolumeNonsur.style.width = `${medVolPct}%`;

    document.getElementById('val-volume-sur-pct').textContent = `${surVolPct.toFixed(1)}%`;
    document.getElementById('val-volume-sur-count').textContent = surTotal.toLocaleString();
    document.getElementById('val-volume-nonsur-pct').textContent = `${medVolPct.toFixed(1)}%`;
    document.getElementById('val-volume-nonsur-count').textContent = medTotal.toLocaleString();

    const barBurdenSur = document.getElementById('bar-burden-sur');
    const barBurdenNonsur = document.getElementById('bar-burden-nonsur');
    if (barBurdenSur) barBurdenSur.style.width = `${surAdjPct}%`;
    if (barBurdenNonsur) barBurdenNonsur.style.width = `${medAdjPct}%`;

    document.getElementById('val-burden-sur-pct').textContent = `${surAdjPct.toFixed(1)}%`;
    document.getElementById('val-burden-sur-sum').textContent = surSumAdj.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('val-burden-nonsur-pct').textContent = `${medAdjPct.toFixed(1)}%`;
    document.getElementById('val-burden-nonsur-sum').textContent = medSumAdj.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    document.getElementById('val-cmi-sur').textContent = surCmi.toFixed(4);
    document.getElementById('val-cmi-nonsur').textContent = medCmi.toFixed(4);
}

function renderCMIChart(aggregatedData) {
    const ctx = document.getElementById('cmiBubbleChart').getContext('2d');
    if (cmiChartInstance) cmiChartInstance.destroy();
    
    if (aggregatedData.length === 0) {
        cmiChartInstance = new Chart(ctx, {
            type: 'bubble', data: { datasets: [] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'ไม่มีข้อมูลแสดงผล', color: getThemeTextColor() } } }
        });
        return;
    }
    
    const maxAdjRw = Math.max(...aggregatedData.map(d => d.sum_adjrw), 1);
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#243049' : '#e2e8f0';
    const textColor = isDark ? '#9ca3af' : '#64748b';
    const tooltipBg = isDark ? '#1e293b' : '#0f172a';
    
    const bubblePoints = aggregatedData.map(item => {
        const minSize = 6, maxSize = 45;
        const size = minSize + Math.sqrt(item.sum_adjrw / maxAdjRw) * (maxSize - minSize);
        return {
            x: item.cmi, y: item.total, r: size,
            mdc: item.mdc, mdc_desc: item.mdc_desc, sum_adjrw: item.sum_adjrw
        };
    });
    
    cmiChartInstance = new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: [{
                label: 'กลุ่มโรค (MDC)', data: bubblePoints,
                backgroundColor: aggregatedData.map(item => getMdcColor(item.mdc) + 'b0'),
                borderColor: aggregatedData.map(item => getMdcColor(item.mdc)),
                borderWidth: 1.5, hoverBorderColor: '#ffffff', hoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: 'ความซับซ้อนของผู้ป่วยเฉลี่ย (Case Mix Index - CMI)', color: textColor, font: { family: 'Sarabun', size: 13, weight: 600 } },
                    grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Inter', size: 11 } }
                },
                y: {
                    title: { display: true, text: 'จำนวนผู้ป่วยในสะสม (Case Volume - ราย)', color: textColor, font: { family: 'Sarabun', size: 13, weight: 600 } },
                    grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Inter', size: 11 }, callback: v => v.toLocaleString() }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: tooltipBg, titleColor: '#ffffff', bodyColor: '#e2e8f0',
                    titleFont: { family: 'Sarabun', size: 13 }, bodyFont: { family: 'Sarabun', size: 12 }, padding: 12,
                    callbacks: {
                        title: c => `MDC ${c[0].raw.mdc} - ${c[0].raw.mdc_desc}`,
                        label: c => [
                            ` CMI (ความซับซ้อน): ${c.raw.x.toFixed(4)}`,
                            ` จำนวนผู้ป่วย: ${c.raw.y.toLocaleString()} ราย`,
                            ` ภาระสะสมรวม (AdjRw): ${c.raw.sum_adjrw.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        ]
                    }
                }
            }
        }
    });
}

function renderCmiMdcTrendChart() {
    const ctx = document.getElementById('cmiMdcTrendChart').getContext('2d');
    if (cmiMdcTrendChartInstance) cmiMdcTrendChartInstance.destroy();

    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#243049' : '#e2e8f0';
    const textColor = isDark ? '#9ca3af' : '#64748b';
    const tooltipBg = isDark ? '#1e293b' : '#0f172a';

    const activeYears = [...selectedYears].sort((a, b) => a - b);
    
    const filteredRows = cmiRawData.filter(row => {
        if (!selectedYears.has(row.byear)) return false;
        if (!selectedSchemes.has(row.insure_desc)) return false;
        const monthStr = row.month.toString().padStart(2, '0');
        if (!selectedCMIMonths.has(monthStr)) return false;
        return true;
    });

    if (filteredRows.length === 0 || activeYears.length === 0) {
        cmiMdcTrendChartInstance = new Chart(ctx, {
            type: 'line', data: { datasets: [] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'ไม่มีข้อมูลแสดงผล', color: textColor } } }
        });
        return;
    }

    const yearMonthPairs = [];
    const seenPairs = new Set();
    filteredRows.forEach(row => {
        const key = `${row.byear}-${row.month.toString().padStart(2, '0')}`;
        if (!seenPairs.has(key)) {
            seenPairs.add(key);
            yearMonthPairs.push({ byear: row.byear, year: row.year, month: row.month });
        }
    });

    const fiscalMonthOrder = { '10': 0, '11': 1, '12': 2, '01': 3, '02': 4, '03': 5, '04': 6, '05': 7, '06': 8, '07': 9, '08': 10, '09': 11 };
    yearMonthPairs.sort((a, b) => {
        if (a.byear !== b.byear) return a.byear - b.byear;
        const aMonthPadded = a.month.toString().padStart(2, '0');
        const bMonthPadded = b.month.toString().padStart(2, '0');
        return fiscalMonthOrder[aMonthPadded] - fiscalMonthOrder[bMonthPadded];
    });

    const labels = yearMonthPairs.map(p => {
        const monthName = monthNamesThai[p.month.toString().padStart(2, '0')] || p.month;
        const shortYear = (p.year % 100).toString();
        return `${monthName} ${shortYear}`;
    });

    function calculateRegression(points) {
        const N = points.length;
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumXX = 0;
        for (let i = 0; i < N; i++) {
            sumX += i;
            sumY += points[i];
            sumXY += i * points[i];
            sumXX += i * i;
        }
        const denom = (N * sumXX - sumX * sumX);
        const m = denom !== 0 ? (N * sumXY - sumX * sumY) / denom : 0;
        const c = denom !== 0 ? (sumY - m * sumX) / N : (N > 0 ? points[0] : 0);
        
        const line = [];
        for (let i = 0; i < N; i++) {
            line.push(m * i + c);
        }
        return { line, slope: m };
    }

    const mdcTotals = {};
    const mdcDescriptions = {};
    filteredRows.forEach(row => {
        mdcTotals[row.mdc] = (mdcTotals[row.mdc] || 0) + row.total;
        mdcDescriptions[row.mdc] = row.mdc_desc;
    });

    let targetMdcs = [];
    if (cmiMdcChartSearchQuery) {
        targetMdcs = Object.keys(mdcTotals).filter(mdc => {
            const desc = (mdcDescriptions[mdc] || '').toLowerCase();
            const code = mdc.toLowerCase();
            return code.includes(cmiMdcChartSearchQuery) || desc.includes(cmiMdcChartSearchQuery);
        });
    } else {
        targetMdcs = Object.keys(mdcTotals);
    }

    targetMdcs.sort((a, b) => mdcTotals[b] - mdcTotals[a]);
    targetMdcs = targetMdcs.slice(0, 10);

    if (targetMdcs.length === 0) {
        cmiMdcTrendChartInstance = new Chart(ctx, {
            type: 'line', data: { datasets: [] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'ไม่พบข้อมูลกลุ่มโรคที่ค้นหา', color: textColor } } }
        });
        return;
    }

    let datasets = [];

    if (targetMdcs.length === 1) {
        const mdc = targetMdcs[0];
        
        const volumeDataPoints = yearMonthPairs.map(p => {
            return filteredRows
                .filter(row => row.mdc === mdc && row.byear === p.byear && row.month === p.month)
                .reduce((sum, row) => sum + row.total, 0);
        });

        const adjrwDataPoints = yearMonthPairs.map(p => {
            return filteredRows
                .filter(row => row.mdc === mdc && row.byear === p.byear && row.month === p.month)
                .reduce((sum, row) => sum + row.sum_adjrw, 0);
        });

        const cmiDataPoints = yearMonthPairs.map((p, idx) => {
            const vol = volumeDataPoints[idx];
            const adj = adjrwDataPoints[idx];
            return vol > 0 ? (adj / vol) : 0;
        });

        const volReg = calculateRegression(volumeDataPoints);
        const adjrwReg = calculateRegression(adjrwDataPoints);
        const cmiReg = calculateRegression(cmiDataPoints);

        datasets = [
            {
                label: `จำนวนผู้ป่วย: MDC ${mdc} - ${mdcDescriptions[mdc] || ''}`,
                data: volumeDataPoints,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                borderWidth: 2.5,
                pointBackgroundColor: '#8b5cf6',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1,
                pointRadius: 3.5,
                pointHoverRadius: 5.5,
                tension: 0.2,
                spanGaps: true,
                yAxisID: 'yVolume',
                order: 1
            },
            {
                label: 'แนวโน้มจำนวนผู้ป่วย (Trend Line)',
                data: volReg.line,
                borderColor: isDark ? '#f87171' : '#ef4444',
                backgroundColor: 'transparent',
                borderWidth: 3.5,
                borderDash: [2, 4],
                pointRadius: 0,
                pointHitRadius: 12,
                pointHoverRadius: 5,
                pointBackgroundColor: isDark ? '#f87171' : '#ef4444',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                tension: 0,
                spanGaps: true,
                yAxisID: 'yVolume',
                order: 0,
                slope: volReg.slope,
                metricType: 'volume'
            },
            {
                label: `CMI: MDC ${mdc} - ${mdcDescriptions[mdc] || ''}`,
                data: cmiDataPoints,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderWidth: 2.5,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1,
                pointRadius: 3.5,
                pointHoverRadius: 5.5,
                tension: 0.2,
                spanGaps: true,
                yAxisID: 'yCmi',
                order: 1
            },
            {
                label: 'แนวโน้มค่า CMI (Trend Line)',
                data: cmiReg.line,
                borderColor: '#60a5fa',
                backgroundColor: 'transparent',
                borderWidth: 3.5,
                borderDash: [2, 4],
                pointRadius: 0,
                pointHitRadius: 12,
                pointHoverRadius: 5,
                pointBackgroundColor: '#60a5fa',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                tension: 0,
                spanGaps: true,
                yAxisID: 'yCmi',
                order: 0,
                slope: cmiReg.slope,
                metricType: 'cmi'
            },
            {
                label: `AdjRW: MDC ${mdc} - ${mdcDescriptions[mdc] || ''}`,
                data: adjrwDataPoints,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                borderWidth: 2.5,
                pointBackgroundColor: '#10b981',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1,
                pointRadius: 3.5,
                pointHoverRadius: 5.5,
                tension: 0.2,
                spanGaps: true,
                yAxisID: 'yVolume',
                order: 1
            },
            {
                label: 'แนวโน้มค่า AdjRW (Trend Line)',
                data: adjrwReg.line,
                borderColor: '#34d399',
                backgroundColor: 'transparent',
                borderWidth: 3.5,
                borderDash: [2, 4],
                pointRadius: 0,
                pointHitRadius: 12,
                pointHoverRadius: 5,
                pointBackgroundColor: '#34d399',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                tension: 0,
                spanGaps: true,
                yAxisID: 'yVolume',
                order: 0,
                slope: adjrwReg.slope,
                metricType: 'adjrw'
            }
        ];
    } else {
        datasets = targetMdcs.map(mdc => {
            const color = getMdcColor(mdc);
            const dataPoints = yearMonthPairs.map(p => {
                return filteredRows
                    .filter(row => row.mdc === mdc && row.byear === p.byear && row.month === p.month)
                    .reduce((sum, row) => sum + row.total, 0);
            });

            return {
                label: `MDC ${mdc} - ${mdcDescriptions[mdc] || ''}`,
                data: dataPoints,
                borderColor: color,
                backgroundColor: color + '15',
                borderWidth: 2.5,
                pointBackgroundColor: color,
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1,
                pointRadius: 3.5,
                pointHoverRadius: 5.5,
                tension: 0.2,
                spanGaps: true,
                yAxisID: 'yVolume',
                order: 1
            };
        });

        const averageDataPoints = yearMonthPairs.map((p, monthIdx) => {
            let sum = 0;
            let count = 0;
            datasets.forEach(dataset => {
                const val = dataset.data[monthIdx];
                if (val !== undefined && val !== null) {
                    sum += val;
                    count++;
                }
            });
            return count > 0 ? (sum / count) : 0;
        });

        const volReg = calculateRegression(averageDataPoints);

        datasets.push({
            label: 'เส้นแนวโน้มค่าเฉลี่ยสะสม (Trend Line)',
            data: volReg.line,
            borderColor: isDark ? '#f87171' : '#ef4444',
            backgroundColor: 'transparent',
            borderWidth: 3.5,
            borderDash: [2, 4],
            pointRadius: 0,
            pointHitRadius: 12,
            pointHoverRadius: 5,
            pointBackgroundColor: isDark ? '#f87171' : '#ef4444',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
            tension: 0,
            spanGaps: true,
            order: 0,
            slope: volReg.slope,
            metricType: 'volume'
        });
    }

    cmiMdcTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Sarabun', size: 10 } }
                },
                yVolume: {
                    type: 'linear',
                    position: 'left',
                    title: { 
                        display: true, 
                        text: targetMdcs.length === 1 ? 'จำนวนผู้ป่วย (ราย) / ภาระงานสะสม (AdjRW)' : 'จำนวนผู้ป่วย (ราย)', 
                        color: textColor, 
                        font: { family: 'Sarabun', size: 12, weight: 600 } 
                    },
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Inter', size: 10 }, callback: v => v.toLocaleString() }
                },
                yCmi: {
                    type: 'linear',
                    position: 'right',
                    display: targetMdcs.length === 1,
                    title: { display: true, text: 'CMI (ความซับซ้อนเฉลี่ย)', color: textColor, font: { family: 'Sarabun', size: 12, weight: 600 } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: textColor, font: { family: 'Inter', size: 10 }, callback: v => v.toFixed(2) }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { 
                        color: textColor, 
                        font: { family: 'Sarabun', size: 10 },
                        generateLabels: chart => {
                            const original = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                            original.forEach(label => {
                                if (label.text.length > 25) {
                                    label.text = label.text.slice(0, 23) + '...';
                                }
                            });
                            return original;
                        }
                    }
                },
                tooltip: {
                    backgroundColor: tooltipBg, titleColor: '#ffffff', bodyColor: '#e2e8f0',
                    titleFont: { family: 'Sarabun', size: 12 }, bodyFont: { family: 'Sarabun', size: 12 }, padding: 10,
                    callbacks: {
                        title: c => `เดือน ${c[0].label}`,
                        label: function(context) {
                            const val = context.raw;
                            const labelStr = context.dataset.label;
                            const isTrendLine = labelStr.includes('Trend Line');
                            
                            if (isTrendLine) {
                                const slopeVal = context.dataset.slope;
                                const slopeSign = slopeVal >= 0 ? '+' : '';
                                const metricType = context.dataset.metricType;
                                
                                if (metricType === 'cmi') {
                                    return ` แนวโน้มค่า CMI (Trend Line) มีค่า ${slopeSign}${slopeVal.toFixed(3)}`;
                                } else if (metricType === 'adjrw') {
                                    return ` แนวโน้มค่า AdjRW (Trend Line) มีค่า ${slopeSign}${slopeVal.toFixed(2)}`;
                                } else {
                                    return ` แนวโน้มค่าเฉลี่ยสะสม (Trend Line) มีค่า ${slopeSign}${slopeVal.toFixed(2)}`;
                                }
                            }
                            
                            // Normal dataset formatting
                            if (labelStr.includes('CMI:')) {
                                return ` ${labelStr}: ${val.toFixed(3)}`;
                            } else if (labelStr.includes('AdjRW:')) {
                                return ` ${labelStr}: ${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                            } else {
                                return ` ${labelStr}: ${val.toLocaleString()} ราย`;
                            }
                        }
                    }
                }
            }
        }
    });
}

function renderCMITable(aggregatedData) {
    const data = aggregatedData || getAggregatedCMIData();
    const query = tableSearchInput.value.toLowerCase().trim();
    
    let filteredData = data.filter(item => {
        return item.mdc.toLowerCase().includes(query) || item.mdc_desc.toLowerCase().includes(query);
    });
    
    filteredData.sort((a, b) => {
        let valA = a[cmiSortColumn];
        let valB = b[cmiSortColumn];
        if (typeof valA === 'string') { valA = valA.toLowerCase(); valB = valB.toLowerCase(); }
        if (valA < valB) return cmiSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return cmiSortDirection === 'asc' ? 1 : -1;
        return 0;
    });
    
    tableBody.innerHTML = '';
    if (filteredData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-secondary);">ไม่พบข้อมูลกลุ่มโรค</td></tr>`;
        return;
    }
    
    filteredData.forEach(item => {
        const tr = document.createElement('tr');
        const mdcColor = getMdcColor(item.mdc);
        tr.innerHTML = `
            <td><span class="mdc-badge" style="background-color: ${mdcColor};">${item.mdc}</span></td>
            <td>${item.mdc_desc}</td>
            <td class="numeric-cell">${item.total.toLocaleString()}</td>
            <td class="numeric-cell" style="font-family:'Inter'; font-weight:500;">${item.cmi.toFixed(4)}</td>
            <td class="numeric-cell" style="font-family:'Inter';">${item.sum_adjrw.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })}</td>
        `;
        tableBody.appendChild(tr);
    });
}

function exportCMITableToCsv() {
    const data = getAggregatedCMIData();
    if (data.length === 0) return;
    let csv = '\uFEFFรหัส MDC,กลุ่มโรค,จำนวนผู้ป่วยทั้งหมด (ราย),ความซับซ้อนทั้งหมด (CMI),ภาระงานทั้งหมด (AdjRw),จำนวนผู้ป่วยผ่าตัด (Sur total),ภาระงานผ่าตัด (Sur AdjRw),จำนวนผู้ป่วยอายุรกรรม (Non-Sur total),ภาระงานอายุรกรรม (Non-Sur AdjRw)\n';
    data.forEach(item => {
        csv += `${item.mdc},"${item.mdc_desc}",${item.total},${item.cmi.toFixed(4)},${item.sum_adjrw.toFixed(4)},${item.surgery_total},${item.surgery_sum_adjrw.toFixed(4)},${item.med_total},${item.med_sum_adjrw.toFixed(4)}\n`;
    });
    downloadCsv(csv, `cmi_mdc_export_${Date.now()}.csv`);
}


// -----------------------------------------------------------------------------
// DASHBOARD 2: NHSO FUND TRANSFER LOGIC
// -----------------------------------------------------------------------------

function initializeTransferFilters() {
    // 1. Get unique years sorted descending
    const uniqueYears = [...new Set(transferRawData.map(row => row.byear))].sort((a, b) => b - a);
    selectedTransferYears = new Set(uniqueYears);
    
    transferYearFiltersContainer.innerHTML = '';
    uniqueYears.forEach(year => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = year;
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) selectedTransferYears.add(year);
            else selectedTransferYears.delete(year);
            updateTransferDashboard();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(`ปีงบประมาณ ${year}`));
        transferYearFiltersContainer.appendChild(label);
    });
    
    // 2. Setup month checkboxes grid
    // Standard months 01-12. Note that we display them chronologically
    const allMonths = ['10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09']; // Fiscal year calendar order
    selectedTransferMonths = new Set(allMonths);
    
    transferMonthFiltersContainer.innerHTML = '';
    allMonths.forEach(monthCode => {
        const monthLabel = monthNamesThai[monthCode] || monthCode;
        
        const label = document.createElement('label');
        label.className = 'checkbox-label checked'; // Initially all checked
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = monthCode;
        checkbox.checked = true;
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedTransferMonths.add(monthCode);
                label.classList.add('checked');
            } else {
                selectedTransferMonths.delete(monthCode);
                label.classList.remove('checked');
            }
            updateTransferDashboard();
        });
        
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(monthLabel));
        transferMonthFiltersContainer.appendChild(label);
    });

    // 3. Setup main fund dropdown filter
    const uniqueFunds = [...new Set(transferRawData.map(row => row.main_fund))].sort();
    
    transferFundSelect.innerHTML = '<option value="all">-- ทุกกองทุนหลัก --</option>';
    uniqueFunds.forEach(fund => {
        const option = document.createElement('option');
        option.value = fund;
        option.textContent = fund;
        transferFundSelect.appendChild(option);
    });
}

// Aggregation logic for NHSO Transfers
function getFilteredTransferData() {
    return transferRawData.filter(row => {
        // Year filter
        if (!selectedTransferYears.has(row.byear)) return false;
        
        // Month filter
        if (!selectedTransferMonths.has(row.month)) return false;
        
        // Main Fund filter
        if (selectedMainFund !== 'all' && row.main_fund !== selectedMainFund) return false;
        
        // Fuzzy text search on main_fund and sub_fund
        if (transferSearchQuery) {
            const matchMain = row.main_fund.toLowerCase().includes(transferSearchQuery);
            const matchSub = row.sub_fund.toLowerCase().includes(transferSearchQuery);
            if (!matchMain && !matchSub) return false;
        }
        
        return true;
    });
}

function updateTransferDashboard() {
    if (currentTab !== 'transfer') return;
    
    const filtered = getFilteredTransferData();
    
    updateTransferKPIs(filtered);
    renderTransferCharts(filtered);
    renderTransferTable(filtered);
}

// Update KPI cards for NHSO Transfers
function getTransferKPIValuesForYear(year) {
    const filtered = transferRawData.filter(row => {
        if (row.byear !== year) return false;
        const monthStr = row.month ? row.month.trim() : '';
        if (!selectedTransferMonths.has(monthStr)) return false;
        if (selectedMainFund !== 'all' && row.main_fund !== selectedMainFund) return false;
        if (transferSearchQuery) {
            const q = transferSearchQuery.toLowerCase();
            const main = row.main_fund.toLowerCase();
            const sub = row.sub_fund.toLowerCase();
            if (!main.includes(q) && !sub.includes(q)) return false;
        }
        return true;
    });

    const totalReceived = filtered.reduce((sum, row) => sum + row.transfer_amount, 0);
    const totalBilled = filtered.reduce((sum, row) => sum + row.amount, 0);
    const totalDeductions = filtered.reduce((sum, row) => sum + (row.deduction + row.tax + (row.delay || 0) + (row.contract_guarantee || 0)), 0);

    return { totalReceived, totalBilled, totalDeductions };
}

function updateTransferKPIs(filteredData) {
    const totalReceived = filteredData.reduce((sum, row) => sum + row.transfer_amount, 0);
    const totalBilled = filteredData.reduce((sum, row) => sum + row.amount, 0);
    const totalDeductions = filteredData.reduce((sum, row) => sum + (row.deduction + row.tax + (row.delay || 0) + (row.contract_guarantee || 0)), 0);

    // Group by main_fund to find top source
    const fundTotals = {};
    filteredData.forEach(row => {
        fundTotals[row.main_fund] = (fundTotals[row.main_fund] || 0) + row.transfer_amount;
    });

    let topFundName = '-';
    let topFundVal = 0;
    Object.keys(fundTotals).forEach(fund => {
        if (fundTotals[fund] > topFundVal) {
            topFundVal = fundTotals[fund];
            topFundName = fund;
        }
    });

    // Update DOM elements
    document.getElementById('val-transfer-total-received').textContent = totalReceived.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('val-transfer-total-billed').textContent = totalBilled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('val-transfer-total-deductions').textContent = totalDeductions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Calculate YoY Comparison
    const availableYears = [...new Set(transferRawData.map(row => row.byear))];
    const { targetYear, baseYear } = getComparisonYears(selectedTransferYears, availableYears);

    if (targetYear && baseYear) {
        const targetKPIs = getTransferKPIValuesForYear(targetYear);
        const baseKPIs = getTransferKPIValuesForYear(baseYear);
        const customText = `เทียบกับปีงบประมาณ ${baseYear}`;

        renderKPIChangeBadge('badge-transfer-received', targetKPIs.totalReceived, baseKPIs.totalReceived, 'percentage', customText);
        renderKPIChangeBadge('badge-transfer-billed', targetKPIs.totalBilled, baseKPIs.totalBilled, 'percentage', customText);
        renderKPIChangeBadge('badge-transfer-deductions', targetKPIs.totalDeductions, baseKPIs.totalDeductions, 'percentage', customText);
    } else {
        renderKPIChangeBadge('badge-transfer-received', null, null);
        renderKPIChangeBadge('badge-transfer-billed', null, null);
        renderKPIChangeBadge('badge-transfer-deductions', null, null);
    }

    const topFundValEl = document.getElementById('val-transfer-top-fund');
    const topFundAmtEl = document.getElementById('val-transfer-top-fund-amount');

    topFundValEl.textContent = topFundName;
    topFundValEl.title = topFundName;
    topFundAmtEl.textContent = `${topFundVal.toLocaleString(undefined, { maximumFractionDigits: 2 })} บาท`;
}

// Curated color mapping for fiscal years to ensure consistency across charts
const yearColors = {
    2568: '#10b981', // Emerald/Green
    2567: '#3b82f6', // Blue
    2566: '#f59e0b', // Amber
    2565: '#8b5cf6', // Purple
    2564: '#ec4899'  // Pink
};

function getYearColor(year) {
    return yearColors[year] || '#64748b';
}

// Render horizontal bar chart and monthly receipt trend line chart with YoY comparison
function renderTransferCharts(filteredData) {
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#243049' : '#e2e8f0';
    const textColor = isDark ? '#9ca3af' : '#64748b';
    const tooltipBg = isDark ? '#1e293b' : '#0f172a';

    const activeYears = [...selectedTransferYears].sort((a, b) => a - b);

    // ----------------------------------------------------
    // CHART 1: MAIN FUND BREAKDOWN (Grouped Horizontal Bar)
    // ----------------------------------------------------
    const mainCtx = document.getElementById('fundMainChart').getContext('2d');
    if (fundMainChartInstance) fundMainChartInstance.destroy();

    // 1. Group by main_fund to get total volume for sorting
    const fundTotals = {};
    filteredData.forEach(row => {
        fundTotals[row.main_fund] = (fundTotals[row.main_fund] || 0) + row.transfer_amount;
    });

    // 2. Get sort direction from dropdown
    const sortDirection = transferFundSortSelect ? transferFundSortSelect.value : 'desc';

    // Get top 10 main funds sorted
    const topFunds = Object.keys(fundTotals)
        .map(fund => ({ name: fund, value: fundTotals[fund] }))
        .sort((a, b) => {
            return sortDirection === 'asc' ? a.value - b.value : b.value - a.value;
        })
        .slice(0, 10)
        .map(f => f.name);

    if (topFunds.length === 0 || activeYears.length === 0) {
        fundMainChartInstance = new Chart(mainCtx, {
            type: 'bar', data: { datasets: [] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'ไม่มีข้อมูลแสดงผล', color: textColor } } }
        });
    } else {
        const labels = ["รวม", ...topFunds.map(f => f.length > 20 ? f.slice(0, 18) + '...' : f)];
        
        // 3. Create datasets: one dataset per year, sorted descending so more recent year is on top
        const activeYearsDescending = [...activeYears].reverse();
        const barDatasets = activeYearsDescending.map(year => {
            const color = getYearColor(year);
            const totalForYear = filteredData
                .filter(row => row.byear === year)
                .reduce((sum, row) => sum + row.transfer_amount, 0);

            const dataPoints = ["รวม", ...topFunds].map(fund => {
                if (fund === "รวม") {
                    return totalForYear;
                }
                return filteredData
                    .filter(row => row.byear === year && row.main_fund === fund)
                    .reduce((sum, row) => sum + row.transfer_amount, 0);
            });

            return {
                label: `ปีงบประมาณ ${year}`,
                data: dataPoints,
                backgroundColor: color + 'cc', // 80% opacity
                borderColor: color,
                borderWidth: 1.5,
                borderRadius: 4
            };
        });

        fundMainChartInstance = new Chart(mainCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: barDatasets
            },
            options: {
                indexAxis: 'y', // Horizontal bar chart
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Inter', size: 10 }, callback: v => v.toLocaleString() }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Sarabun', size: 11 } }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: textColor, font: { family: 'Sarabun', size: 11 } }
                    },
                    tooltip: {
                        backgroundColor: tooltipBg, titleColor: '#ffffff', bodyColor: '#e2e8f0',
                        titleFont: { family: 'Sarabun', size: 12 }, bodyFont: { family: 'Inter', size: 12 }, padding: 10,
                        callbacks: {
                            title: c => {
                                const idx = c[0].dataIndex;
                                return idx === 0 ? "ยอดเงินโอนรวมทุกกองทุน" : topFunds[idx - 1];
                            },
                            label: function(context) {
                                const currentVal = context.raw;
                                const dataIndex = context.dataIndex;
                                const titleStr = dataIndex === 0 ? "ยอดเงินโอนรวม" : context.dataset.label;
                                let labelText = ` ${titleStr}: ${currentVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
                                
                                const chart = context.chart;
                                const label = context.dataset.label;
                                const match = label.match(/\d+/);
                                
                                if (match) {
                                    const currentYear = parseInt(match[0]);
                                    const prevDataset = chart.data.datasets.find(ds => {
                                        const dsMatch = ds.label.match(/\d+/);
                                        return dsMatch && parseInt(dsMatch[0]) === currentYear - 1;
                                    });
                                    if (prevDataset) {
                                        const prevVal = prevDataset.data[dataIndex];
                                        if (prevVal !== undefined && prevVal !== null && prevVal > 0) {
                                            const pctChange = ((currentVal - prevVal) / prevVal) * 100;
                                            const direction = pctChange > 0 ? 'เพิ่มขึ้น' : (pctChange < 0 ? 'ลดลง' : 'เท่าเดิม');
                                            const pctText = pctChange !== 0 ? ` ${Math.abs(pctChange).toFixed(1)}%` : '';
                                            labelText += ` (${direction}${pctText} เทียบกับ${prevDataset.label.replace('ปีงบประมาณ ', 'ปี ')})`;
                                        }
                                    }
                                }
                                return labelText;
                            }
                        }
                    }
                }
            }
        });
    }

    // ----------------------------------------------------
    // CHART 2: MONTHLY TREND LINE CHART (Continuous Timeline)
    // ----------------------------------------------------
    const trendCtx = document.getElementById('fundTrendChart').getContext('2d');
    if (fundTrendChartInstance) fundTrendChartInstance.destroy();

    if (filteredData.length === 0 || activeYears.length === 0) {
        fundTrendChartInstance = new Chart(trendCtx, {
            type: 'line', data: { datasets: [] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'ไม่มีข้อมูลแสดงผล', color: textColor } } }
        });
    } else {
        // Build chronological year-month pairs using actual year column
        const yearMonthPairs = [];
        const seenPairs = new Set();
        filteredData.forEach(row => {
            const key = `${row.byear}-${row.month.toString().padStart(2, '0')}`;
            if (!seenPairs.has(key)) {
                seenPairs.add(key);
                yearMonthPairs.push({ byear: row.byear, year: row.year, month: parseInt(row.month) });
            }
        });

        const fiscalMonthOrder = { '10': 0, '11': 1, '12': 2, '01': 3, '02': 4, '03': 5, '04': 6, '05': 7, '06': 8, '07': 9, '08': 10, '09': 11 };
        yearMonthPairs.sort((a, b) => {
            if (a.byear !== b.byear) return a.byear - b.byear;
            const aMonthPadded = a.month.toString().padStart(2, '0');
            const bMonthPadded = b.month.toString().padStart(2, '0');
            return fiscalMonthOrder[aMonthPadded] - fiscalMonthOrder[bMonthPadded];
        });

        const labels = yearMonthPairs.map(p => {
            const monthName = monthNamesThai[p.month.toString().padStart(2, '0')] || p.month;
            const shortYear = (p.year % 100).toString();
            return `${monthName} ${shortYear}`;
        });

        const dataPoints = yearMonthPairs.map(p => {
            return filteredData
                .filter(row => row.byear === p.byear && parseInt(row.month) === p.month)
                .reduce((sum, row) => sum + row.transfer_amount, 0);
        });

        const trendColor = '#3b82f6'; // Clean blue color

        fundTrendChartInstance = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'ยอดเงินโอนรับเข้าสะสม (บาท)',
                    data: dataPoints,
                    borderColor: trendColor,
                    backgroundColor: trendColor + '15',
                    borderWidth: 3,
                    pointBackgroundColor: trendColor,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: '#ffffff',
                    pointHoverBorderColor: trendColor,
                    pointHoverBorderWidth: 3,
                    fill: true,
                    tension: 0.35
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Sarabun', size: 10 } }
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Inter', size: 10 }, callback: v => v.toLocaleString() }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: tooltipBg, titleColor: '#ffffff', bodyColor: '#e2e8f0',
                        titleFont: { family: 'Sarabun', size: 12 }, bodyFont: { family: 'Sarabun', size: 12 }, padding: 10,
                        callbacks: {
                            title: c => `เดือน ${c[0].label}`,
                            label: function(context) {
                                const currentVal = context.raw;
                                if (currentVal === null || currentVal === undefined) return '';
                                
                                let labelText = ` ยอดเงินโอน: ${currentVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
                                
                                const chart = context.chart;
                                const currentLabel = context.label;
                                const labelParts = currentLabel.split(' ');
                                if (labelParts.length === 2) {
                                    const monthName = labelParts[0];
                                    const currentYearShort = parseInt(labelParts[1]);
                                    const prevLabel = `${monthName} ${currentYearShort - 1}`;
                                    const prevIndex = chart.data.labels.indexOf(prevLabel);
                                    if (prevIndex !== -1) {
                                        const prevVal = chart.data.datasets[context.datasetIndex].data[prevIndex];
                                        if (prevVal !== undefined && prevVal !== null && prevVal > 0) {
                                            const pctChange = ((currentVal - prevVal) / prevVal) * 100;
                                            const direction = pctChange > 0 ? 'เพิ่มขึ้น' : (pctChange < 0 ? 'ลดลง' : 'เท่าเดิม');
                                            const pctText = pctChange !== 0 ? ` ${Math.abs(pctChange).toFixed(1)}%` : '';
                                            labelText += ` (${direction}${pctText} เทียบกับปีปฏิทินก่อนหน้า)`;
                                        }
                                    }
                                }
                                return labelText;
                            }
                        }
                    }
                }
            }
        });
    }
}

// Render detailed table for NHSO Transfers
function renderTransferTable(filteredData) {
    const data = filteredData || getFilteredTransferData();
    const query = transferTableSearchInput.value.toLowerCase().trim();

    // 1. Group by byear, year, month, main_fund, sub_fund to keep table concise but detailed
    const tableGrouped = {};
    data.forEach(row => {
        const key = `${row.byear}_${row.year}_${row.month}_${row.main_fund}_${row.sub_fund}`;
        if (!tableGrouped[key]) {
            tableGrouped[key] = {
                byear: row.byear,
                year: row.year,
                month: row.month,
                main_fund: row.main_fund,
                sub_fund: row.sub_fund,
                amount: 0,
                deduction: 0,
                transfer_amount: 0
            };
        }
        tableGrouped[key].amount += row.amount;
        tableGrouped[key].deduction += (row.deduction + row.tax + (row.delay || 0) + (row.contract_guarantee || 0));
        tableGrouped[key].transfer_amount += row.transfer_amount;
    });

    let groupedArray = Object.values(tableGrouped);

    // 2. Filter by search query
    let filteredList = groupedArray.filter(item => {
        return item.main_fund.toLowerCase().includes(query) || 
               item.sub_fund.toLowerCase().includes(query) ||
               item.byear.toString().includes(query);
    });

    // 3. Sort list
    filteredList.sort((a, b) => {
        let valA = a[transferSortColumn];
        let valB = b[transferSortColumn];

        if (transferSortColumn === 'month_year') {
            // Sort key for year/month: "year_month"
            valA = `${a.year}_${a.month}`;
            valB = `${b.year}_${b.month}`;
        }

        if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        if (valA < valB) return transferSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return transferSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    // 4. Render rows
    transferTableBody.innerHTML = '';
    
    if (filteredList.length === 0) {
        transferTableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.5;"></i>
                    ไม่พบข้อมูลธุรกรรมการเงินตามตัวค้นหา
                </td>
            </tr>
        `;
        return;
    }

    filteredList.forEach(item => {
        const tr = document.createElement('tr');
        const monthLabel = monthNamesThai[item.month] || item.month;
        const shortYear = item.year.toString().slice(-2);
        
        tr.innerHTML = `
            <td><strong>ปีงบประมาณ ${item.byear}</strong></td>
            <td style="font-family: 'Sarabun';">${monthLabel} ${shortYear}</td>
            <td><span class="badge total">${item.main_fund}</span></td>
            <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.sub_fund}">${item.sub_fund}</td>
            <td class="numeric-cell" style="font-family: 'Inter';">${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="numeric-cell" style="font-family: 'Inter'; color: #ef4444;">${item.deduction.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="numeric-cell" style="font-family: 'Inter'; font-weight: 600; color: #22c55e;">${item.transfer_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        `;
        transferTableBody.appendChild(tr);
    });
}

function exportTransferTableToCsv() {
    const filtered = getFilteredTransferData();
    if (filtered.length === 0) return;
    
    // Header
    let csvContent = '\uFEFF'; // UTF-8 BOM
    csvContent += 'ปีงบประมาณ,วันที่โอน,กองทุนหลัก,กองทุนย่อย,ยอดเบิก (บาท),หักปรับ (บาท),ภาษี (บาท),โอนสุทธิ (บาท)\n';
    
    filtered.forEach(item => {
        csvContent += `${item.byear},"${item.transfer_date}","${item.main_fund}","${item.sub_fund}",${item.amount},${item.deduction},${item.tax},${item.transfer_amount}\n`;
    });
    
    downloadCsv(csvContent, `nhso_transfers_export_${Date.now()}.csv`);
}


// -----------------------------------------------------------------------------
// COMMON FUNCTIONS
// -----------------------------------------------------------------------------

// Render KPI comparison percentage change badge next to KPI values
function renderKPIChangeBadge(badgeId, targetVal, baseVal, type = 'percentage', customText = '') {
    const badge = document.getElementById(badgeId);
    if (!badge) return;

    // Helper text clean-up
    const oldText = badge.parentNode.parentNode.querySelector('.kpi-compare-detail');
    if (oldText) oldText.remove();

    if (baseVal === undefined || baseVal === null || baseVal === 0 || isNaN(baseVal) || targetVal === undefined || targetVal === null || isNaN(targetVal)) {
        badge.style.display = 'none';
        return;
    }

    let pctChange = ((targetVal - baseVal) / baseVal) * 100;
    if (type === 'absolute_diff') {
        pctChange = targetVal - baseVal;
    }

    badge.style.display = 'inline-flex';
    badge.className = 'kpi-change-badge';

    let sign = '';
    let arrow = '';
    if (pctChange > 0) {
        badge.classList.add('positive');
        sign = '+';
        arrow = '▲ ';
    } else if (pctChange < 0) {
        badge.classList.add('negative');
        sign = '';
        arrow = '▼ ';
    } else {
        badge.classList.add('neutral');
        sign = '';
        arrow = '';
    }

    let displayVal = '';
    if (type === 'percentage') {
        displayVal = `${arrow}${sign}${pctChange.toFixed(1)}%`;
    } else {
        displayVal = `${arrow}${sign}${pctChange.toFixed(4)}`;
    }
    badge.textContent = displayVal;

    // Add compare detail text underneath for context
    if (customText) {
        const detailEl = document.createElement('div');
        detailEl.className = 'kpi-compare-detail';
        detailEl.textContent = customText;
        badge.parentNode.parentNode.appendChild(detailEl);
    }
}

// Get target and base years for comparison calculations
function getComparisonYears(selectedYearsSet, availableYearsArray) {
    if (selectedYearsSet.size === 0) return { targetYear: null, baseYear: null };

    const sortedSelected = [...selectedYearsSet].sort((a, b) => a - b);
    
    let targetYear = null;
    let baseYear = null;

    if (sortedSelected.length >= 2) {
        // Compare the latest selected year with the second latest selected year
        targetYear = sortedSelected[sortedSelected.length - 1];
        baseYear = sortedSelected[sortedSelected.length - 2];
    } else if (sortedSelected.length === 1) {
        // Compare the single selected year with the previous year (target - 1)
        targetYear = sortedSelected[0];
        baseYear = targetYear - 1;
    }

    // Check if baseYear exists in available raw data
    if (baseYear && availableYearsArray && availableYearsArray.includes(baseYear)) {
        return { targetYear, baseYear };
    }
    return { targetYear: null, baseYear: null };
}

function downloadCsv(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Toggle light/dark theme
function toggleTheme() {
    const body = document.body;
    body.classList.toggle('dark-mode');
    
    const isDark = body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    
    // Update theme toggle button icon
    const icon = themeToggleBtn.querySelector('i');
    if (isDark) {
        icon.className = 'fa-solid fa-sun';
        themeToggleBtn.style.color = '#fbbf24';
    } else {
        icon.className = 'fa-solid fa-moon';
        themeToggleBtn.style.color = 'var(--text-primary)';
    }
    
    // Re-render charts to update grid colors
    if (cmiRawData.length > 0) {
        updateCMIDashboard();
        updateTransferDashboard();
        updateItemsDashboard();
    }
}

function getThemeTextColor() {
    return document.body.classList.contains('dark-mode') ? '#f3f4f6' : '#1e293b';
}

function showLoading() {
    loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
}

// Bulk select/deselect checkboxes inside a container and trigger change event
window.bulkSelect = function(containerId, selectAll) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked !== selectAll) {
            cb.checked = selectAll;
            cb.dispatchEvent(new Event('change'));
        }
    });
};


// -----------------------------------------------------------------------------
// DASHBOARD 3: ITEMS SUMMARY LOGIC
// -----------------------------------------------------------------------------

function initializeItemsFilters() {
    // 1. Get unique years sorted descending
    const uniqueYears = [...new Set(itemsRawData.map(row => row.byear))].sort((a, b) => b - a);
    selectedItemsYears = new Set(uniqueYears);
    
    itemsYearFiltersContainer.innerHTML = '';
    uniqueYears.forEach(year => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = year;
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) selectedItemsYears.add(year);
            else selectedItemsYears.delete(year);
            updateItemsDashboard();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(`ปีงบประมาณ ${year}`));
        itemsYearFiltersContainer.appendChild(label);
    });
    
    // 2. Setup month checkboxes grid
    const allMonths = ['10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09']; // Fiscal year calendar order
    selectedItemsMonths = new Set(allMonths);
    
    itemsMonthFiltersContainer.innerHTML = '';
    allMonths.forEach(monthCode => {
        const monthLabel = monthNamesThai[monthCode] || monthCode;
        
        const label = document.createElement('label');
        label.className = 'checkbox-label checked';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = monthCode;
        checkbox.checked = true;
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedItemsMonths.add(monthCode);
                label.classList.add('checked');
            } else {
                selectedItemsMonths.delete(monthCode);
                label.classList.remove('checked');
            }
            updateItemsDashboard();
        });
        
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(monthLabel));
        itemsMonthFiltersContainer.appendChild(label);
    });

    // 3. Setup visit type dropdown filter
    const uniqueVisitTypes = [...new Set(itemsRawData.map(row => row.visit_type))].sort();
    
    itemsVisitSelect.innerHTML = '<option value="all">-- ทุกประเภทผู้ป่วย --</option>';
    uniqueVisitTypes.forEach(vt => {
        const option = document.createElement('option');
        option.value = vt;
        option.textContent = vt;
        itemsVisitSelect.appendChild(option);
    });
}

function getFilteredItemsData() {
    return itemsRawData.filter(row => {
        // Year filter
        if (!selectedItemsYears.has(row.byear)) return false;
        
        // Month filter
        if (!selectedItemsMonths.has(row.month)) return false;
        
        // Visit Type filter
        if (selectedVisitType !== 'all' && row.visit_type !== selectedVisitType) return false;
        
        // Fuzzy text search on item_group and item_common_name
        if (itemsSearchQuery) {
            const matchGroup = row.item_group.toLowerCase().includes(itemsSearchQuery);
            const matchName = row.item_common_name.toLowerCase().includes(itemsSearchQuery);
            if (!matchGroup && !matchName) return false;
        }
        
        return true;
    });
}

function updateItemsDashboard() {
    if (currentTab !== 'items') return;
    
    const filtered = getFilteredItemsData();
    
    updateItemsKPIs(filtered);
    renderItemsCharts(filtered);
    renderItemsTable(filtered);
}

function getItemsKPIValuesForYear(year) {
    const filtered = itemsRawData.filter(row => {
        if (row.byear !== year) return false;
        const monthStr = row.month ? row.month.toString().padStart(2, '0') : '';
        if (!selectedItemsMonths.has(monthStr)) return false;
        if (selectedVisitType !== 'all' && row.visit_type !== selectedVisitType) return false;
        if (itemsSearchQuery) {
            const q = itemsSearchQuery.toLowerCase();
            const g = row.item_group.toLowerCase();
            const n = row.item_common_name.toLowerCase();
            if (!g.includes(q) && !n.includes(q)) return false;
        }
        return true;
    });

    const totalQuantity = filtered.reduce((sum, row) => sum + row.total_quantity, 0);
    const totalPrice = filtered.reduce((sum, row) => sum + row.total_price, 0);
    const avgPrice = totalQuantity > 0 ? (totalPrice / totalQuantity) : 0;

    return { totalQuantity, totalPrice, avgPrice };
}

function updateItemsKPIs(filteredData) {
    const totalQuantity = filteredData.reduce((sum, row) => sum + row.total_quantity, 0);
    const totalPrice = filteredData.reduce((sum, row) => sum + row.total_price, 0);
    const avgPrice = totalQuantity > 0 ? (totalPrice / totalQuantity) : 0;

    // Group by item_group to find top group
    const groupTotals = {};
    filteredData.forEach(row => {
        groupTotals[row.item_group] = (groupTotals[row.item_group] || 0) + row.total_price;
    });

    let topGroupName = '-';
    let topGroupVal = 0;
    Object.keys(groupTotals).forEach(group => {
        if (groupTotals[group] > topGroupVal) {
            topGroupVal = groupTotals[group];
            topGroupName = group;
        }
    });

    // Update DOM elements
    document.getElementById('val-items-total-quantity').textContent = totalQuantity.toLocaleString();
    document.getElementById('val-items-total-price').textContent = totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('val-items-avg-price').textContent = avgPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const topGroupValEl = document.getElementById('val-items-top-group');
    const topGroupAmtEl = document.getElementById('val-items-top-group-amount');

    topGroupValEl.textContent = topGroupName;
    topGroupValEl.title = topGroupName;
    topGroupAmtEl.textContent = `${topGroupVal.toLocaleString(undefined, { maximumFractionDigits: 2 })} บาท`;

    // Calculate YoY Comparison
    const availableYears = [...new Set(itemsRawData.map(row => row.byear))];
    const { targetYear, baseYear } = getComparisonYears(selectedItemsYears, availableYears);

    if (targetYear && baseYear) {
        const targetKPIs = getItemsKPIValuesForYear(targetYear);
        const baseKPIs = getItemsKPIValuesForYear(baseYear);
        const customText = `เทียบกับปีงบประมาณ ${baseYear}`;

        renderKPIChangeBadge('badge-items-quantity', targetKPIs.totalQuantity, baseKPIs.totalQuantity, 'percentage', customText);
        renderKPIChangeBadge('badge-items-price', targetKPIs.totalPrice, baseKPIs.totalPrice, 'percentage', customText);
        renderKPIChangeBadge('badge-items-avg-price', targetKPIs.avgPrice, baseKPIs.avgPrice, 'percentage', customText);
    } else {
        renderKPIChangeBadge('badge-items-quantity', null, null);
        renderKPIChangeBadge('badge-items-price', null, null);
        renderKPIChangeBadge('badge-items-avg-price', null, null);
    }
}

function renderItemsCharts(filteredData) {
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#243049' : '#e2e8f0';
    const textColor = isDark ? '#9ca3af' : '#64748b';
    const tooltipBg = isDark ? '#1e293b' : '#0f172a';

    const activeYears = [...selectedItemsYears].sort((a, b) => a - b);

    // ----------------------------------------------------
    // CHART 1: ITEM GROUP BREAKDOWN (Grouped Horizontal Bar)
    // ----------------------------------------------------
    const mainCtx = document.getElementById('itemsGroupChart').getContext('2d');
    if (itemsGroupChartInstance) itemsGroupChartInstance.destroy();

    // Group by item_group to get total volume for sorting
    const groupTotals = {};
    filteredData.forEach(row => {
        groupTotals[row.item_group] = (groupTotals[row.item_group] || 0) + row.total_price;
    });

    // Get sort direction from dropdown
    const sortDirection = itemsGroupSortSelect ? itemsGroupSortSelect.value : 'desc';

    // Get top 10 item groups sorted
    const topGroups = Object.keys(groupTotals)
        .map(group => ({ name: group, value: groupTotals[group] }))
        .sort((a, b) => {
            return sortDirection === 'asc' ? a.value - b.value : b.value - a.value;
        })
        .slice(0, 10)
        .map(g => g.name);

    if (topGroups.length === 0 || activeYears.length === 0) {
        itemsGroupChartInstance = new Chart(mainCtx, {
            type: 'bar', data: { datasets: [] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'ไม่มีข้อมูลแสดงผล', color: textColor } } }
        });
    } else {
        const labels = topGroups.map(g => g.length > 22 ? g.slice(0, 20) + '...' : g);
        
        // Create datasets: one dataset per year, sorted descending so more recent year is on top
        const activeYearsDescending = [...activeYears].reverse();
        const barDatasets = activeYearsDescending.map(year => {
            const color = getYearColor(year);
            const dataPoints = topGroups.map(group => {
                return filteredData
                    .filter(row => row.byear === year && row.item_group === group)
                    .reduce((sum, row) => sum + row.total_price, 0);
            });

            return {
                label: `ปีงบประมาณ ${year}`,
                data: dataPoints,
                backgroundColor: color + 'cc',
                borderColor: color,
                borderWidth: 1.5,
                borderRadius: 4
            };
        });

        itemsGroupChartInstance = new Chart(mainCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: barDatasets
            },
            options: {
                indexAxis: 'y', // Horizontal
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Inter', size: 10 }, callback: v => v.toLocaleString() }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Sarabun', size: 11 } }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: textColor, font: { family: 'Sarabun', size: 11 } }
                    },
                    tooltip: {
                        backgroundColor: tooltipBg, titleColor: '#ffffff', bodyColor: '#e2e8f0',
                        titleFont: { family: 'Sarabun', size: 12 }, bodyFont: { family: 'Inter', size: 12 }, padding: 10,
                        callbacks: {
                            title: c => topGroups[c[0].dataIndex],
                            label: function(context) {
                                const currentVal = context.raw;
                                let labelText = ` ${context.dataset.label}: ${currentVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
                                
                                const chart = context.chart;
                                const dataIndex = context.dataIndex;
                                const label = context.dataset.label;
                                const match = label.match(/\d+/);
                                
                                if (match) {
                                    const currentYear = parseInt(match[0]);
                                    const prevDataset = chart.data.datasets.find(ds => {
                                        const dsMatch = ds.label.match(/\d+/);
                                        return dsMatch && parseInt(dsMatch[0]) === currentYear - 1;
                                    });
                                    if (prevDataset) {
                                        const prevVal = prevDataset.data[dataIndex];
                                        if (prevVal !== undefined && prevVal !== null && prevVal > 0) {
                                            const pctChange = ((currentVal - prevVal) / prevVal) * 100;
                                            const direction = pctChange > 0 ? 'เพิ่มขึ้น' : (pctChange < 0 ? 'ลดลง' : 'เท่าเดิม');
                                            const pctText = pctChange !== 0 ? ` ${Math.abs(pctChange).toFixed(1)}%` : '';
                                            labelText += ` (${direction}${pctText} เทียบกับ${prevDataset.label.replace('ปีงบประมาณ ', 'ปี ')})`;
                                        }
                                    }
                                }
                                return labelText;
                            }
                        }
                    }
                }
            }
        });
    }
    // ----------------------------------------------------
    // CHART 2: MONTHLY TREND LINE CHART (Continuous Timeline)
    // ----------------------------------------------------
    const trendCtx = document.getElementById('itemsTrendChart').getContext('2d');
    if (itemsTrendChartInstance) itemsTrendChartInstance.destroy();

    if (filteredData.length === 0 || activeYears.length === 0) {
        itemsTrendChartInstance = new Chart(trendCtx, {
            type: 'line', data: { datasets: [] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'ไม่มีข้อมูลแสดงผล', color: textColor } } }
        });
    } else {
        // Build chronological year-month pairs using actual year column
        const yearMonthPairs = [];
        const seenPairs = new Set();
        filteredData.forEach(row => {
            const key = `${row.byear}-${row.month.toString().padStart(2, '0')}`;
            if (!seenPairs.has(key)) {
                seenPairs.add(key);
                yearMonthPairs.push({ byear: row.byear, year: row.year, month: parseInt(row.month) });
            }
        });

        const fiscalMonthOrder = { '10': 0, '11': 1, '12': 2, '01': 3, '02': 4, '03': 5, '04': 6, '05': 7, '06': 8, '07': 9, '08': 10, '09': 11 };
        yearMonthPairs.sort((a, b) => {
            if (a.byear !== b.byear) return a.byear - b.byear;
            const aMonthPadded = a.month.toString().padStart(2, '0');
            const bMonthPadded = b.month.toString().padStart(2, '0');
            return fiscalMonthOrder[aMonthPadded] - fiscalMonthOrder[bMonthPadded];
        });

        const labels = yearMonthPairs.map(p => {
            const monthName = monthNamesThai[p.month.toString().padStart(2, '0')] || p.month;
            const shortYear = (p.year % 100).toString();
            return `${monthName} ${shortYear}`;
        });

        const dataPoints = yearMonthPairs.map(p => {
            return filteredData
                .filter(row => row.byear === p.byear && parseInt(row.month) === p.month)
                .reduce((sum, row) => sum + row.total_price, 0);
        });

        const trendColor = '#10b981'; // Green color to match Items theme

        itemsTrendChartInstance = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'มูลค่าบริการรวม (บาท)',
                    data: dataPoints,
                    borderColor: trendColor,
                    backgroundColor: trendColor + '15',
                    borderWidth: 3,
                    pointBackgroundColor: trendColor,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: '#ffffff',
                    pointHoverBorderColor: trendColor,
                    pointHoverBorderWidth: 3,
                    fill: true,
                    tension: 0.35
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Sarabun', size: 10 } }
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Inter', size: 10 }, callback: v => v.toLocaleString() }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: tooltipBg, titleColor: '#ffffff', bodyColor: '#e2e8f0',
                        titleFont: { family: 'Sarabun', size: 12 }, bodyFont: { family: 'Sarabun', size: 12 }, padding: 10,
                        callbacks: {
                            title: c => `เดือน ${c[0].label}`,
                            label: function(context) {
                                const currentVal = context.raw;
                                if (currentVal === null || currentVal === undefined) return '';
                                
                                let labelText = ` มูลค่าบริการ: ${currentVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
                                
                                const chart = context.chart;
                                const currentLabel = context.label;
                                const labelParts = currentLabel.split(' ');
                                if (labelParts.length === 2) {
                                    const monthName = labelParts[0];
                                    const currentYearShort = parseInt(labelParts[1]);
                                    const prevLabel = `${monthName} ${currentYearShort - 1}`;
                                    const prevIndex = chart.data.labels.indexOf(prevLabel);
                                    if (prevIndex !== -1) {
                                        const prevVal = chart.data.datasets[context.datasetIndex].data[prevIndex];
                                        if (prevVal !== undefined && prevVal !== null && prevVal > 0) {
                                            const pctChange = ((currentVal - prevVal) / prevVal) * 100;
                                            const direction = pctChange > 0 ? 'เพิ่มขึ้น' : (pctChange < 0 ? 'ลดลง' : 'เท่าเดิม');
                                            const pctText = pctChange !== 0 ? ` ${Math.abs(pctChange).toFixed(1)}%` : '';
                                            labelText += ` (${direction}${pctText} เทียบกับปีปฏิทินก่อนหน้า)`;
                                        }
                                    }
                                }
                                return labelText;
                            }
                        }
                    }
                }
            }
        });
    }
}

function renderItemsTable(filteredData) {
    const data = filteredData || getFilteredItemsData();
    const query = itemsTableSearchInput.value.toLowerCase().trim();

    // Group by byear, visit_type, item_group, item_common_name
    const tableGrouped = {};
    data.forEach(row => {
        const key = `${row.byear}_${row.visit_type}_${row.item_group}_${row.item_common_name}`;
        if (!tableGrouped[key]) {
            tableGrouped[key] = {
                byear: row.byear,
                visit_type: row.visit_type,
                item_group: row.item_group,
                item_common_name: row.item_common_name,
                total_quantity: 0,
                total_price: 0
            };
        }
        tableGrouped[key].total_quantity += row.total_quantity;
        tableGrouped[key].total_price += row.total_price;
    });

    let groupedArray = Object.values(tableGrouped);

    // Filter by search query
    let filteredList = groupedArray.filter(item => {
        return item.item_group.toLowerCase().includes(query) || 
               item.item_common_name.toLowerCase().includes(query) ||
               item.visit_type.toLowerCase().includes(query) ||
               item.byear.toString().includes(query);
    });

    const totalFilteredCount = filteredList.length;

    // Sort list
    filteredList.sort((a, b) => {
        let valA = a[itemsSortColumn];
        let valB = b[itemsSortColumn];

        if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        if (valA < valB) return itemsSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return itemsSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    // Limit to first 200 rows for rendering speed
    const renderList = filteredList.slice(0, 200);

    // Update table info text
    const infoEl = document.getElementById('items-table-info');
    if (infoEl) {
        if (totalFilteredCount > 200) {
            infoEl.innerHTML = `<i class="fa-solid fa-circle-info" style="color: var(--primary);"></i> แสดง 200 รายการแรก จากผลการค้นหาทั้งหมด <strong>${totalFilteredCount.toLocaleString()}</strong> รายการ (กรุณาพิมพ์ในช่องค้นหาเพื่อเจาะจงข้อมูลที่ต้องการ)`;
        } else {
            infoEl.innerHTML = `แสดงผลลัพธ์ทั้งหมด <strong>${totalFilteredCount.toLocaleString()}</strong> รายการ`;
        }
    }

    // Render rows
    itemsTableBody.innerHTML = '';
    
    if (renderList.length === 0) {
        itemsTableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.5;"></i>
                    ไม่พบข้อมูลรายการบริการการเงินตามตัวค้นหา
                </td>
            </tr>
        `;
        return;
    }

    renderList.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>ปีงบประมาณ ${item.byear}</strong></td>
            <td><span class="badge uc">${item.visit_type}</span></td>
            <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.item_group}">${item.item_group}</td>
            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.item_common_name}">${item.item_common_name}</td>
            <td class="numeric-cell" style="font-family: 'Inter';">${item.total_quantity.toLocaleString()}</td>
            <td class="numeric-cell" style="font-family: 'Inter'; font-weight: 600; color: var(--primary);">${item.total_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        `;
        itemsTableBody.appendChild(tr);
    });
}

function exportItemsTableToCsv() {
    const filtered = getFilteredItemsData();
    if (filtered.length === 0) return;

    // Group first so that CSV matches screen data exactly
    const csvGrouped = {};
    filtered.forEach(row => {
        const key = `${row.byear}_${row.visit_type}_${row.item_group}_${row.item_common_name}`;
        if (!csvGrouped[key]) {
            csvGrouped[key] = {
                byear: row.byear,
                visit_type: row.visit_type,
                item_group: row.item_group,
                item_common_name: row.item_common_name,
                total_quantity: 0,
                total_price: 0
            };
        }
        csvGrouped[key].total_quantity += row.total_quantity;
        csvGrouped[key].total_price += row.total_price;
    });

    const csvData = Object.values(csvGrouped);
    
    // Header
    let csvContent = '\uFEFF'; // UTF-8 BOM
    csvContent += 'ปีงบประมาณ,ประเภทผู้ป่วย,กลุ่มบริการ,รายการบริการ,จำนวนหน่วย,มูลค่าบริการรวม (บาท)\n';
    
    csvData.forEach(item => {
        csvContent += `${item.byear},"${item.visit_type}","${item.item_group}","${item.item_common_name}",${item.total_quantity},${item.total_price}\n`;
    });
    
    downloadCsv(csvContent, `medical_items_summary_export_${Date.now()}.csv`);
}

// -----------------------------------------------------------------------------
// DASHBOARD 4: OPD VISITS LOGIC — วิเคราะห์ผู้ป่วยนอก
// -----------------------------------------------------------------------------

// Diag type label mapping
const opdDiagTypeLabels = {
    '1': 'Principal Diag (วินิจฉัยหลัก)',
    '2': 'Co-morbidity (โรคร่วม)',
    '3': 'External Cause (สาเหตุภายนอก)',
    '4': 'Other (วินิจฉัยอื่น)',
    '5': 'Procedure (หัตถการ)'
};

function initializeOpdFilters() {
    // 1. Years
    const uniqueYears = [...new Set(opdRawData.map(row => row.byear))].sort((a, b) => b - a);
    selectedOpdYears = new Set(uniqueYears);
    opdYearFiltersContainer.innerHTML = '';
    uniqueYears.forEach(year => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = year;
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) selectedOpdYears.add(year);
            else selectedOpdYears.delete(year);
            updateOpdDashboard();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(`ปีงบประมาณ ${year}`));
        opdYearFiltersContainer.appendChild(label);
    });

    // 2. Months
    const monthNamesLong = {
        '01': 'มกราคม', '02': 'กุมภาพันธ์', '03': 'มีนาคม', '04': 'เมษายน',
        '05': 'พฤษภาคม', '06': 'มิถุนายน', '07': 'กรกฎาคม', '08': 'สิงหาคม',
        '09': 'กันยายน', '10': 'ตุลาคม', '11': 'พฤศจิกายน', '12': 'ธันวาคม'
    };
    const uniqueMonths = [...new Set(opdRawData.map(row => row.month_visit))].sort();
    selectedOpdMonths = new Set(uniqueMonths);
    opdMonthFiltersContainer.innerHTML = '';
    uniqueMonths.forEach(m => {
        const name = monthNamesLong[m] || m;
        const label = document.createElement('label');
        label.className = 'checkbox-label checked';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = m;
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) { selectedOpdMonths.add(m); label.classList.add('checked'); }
            else { selectedOpdMonths.delete(m); label.classList.remove('checked'); }
            updateOpdDashboard();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(name));
        opdMonthFiltersContainer.appendChild(label);
    });

    // 3. Sex
    const uniqueSexes = [...new Set(opdRawData.map(row => row.sex))].sort();
    selectedOpdSex = new Set(uniqueSexes);
    opdSexFiltersContainer.innerHTML = '';
    uniqueSexes.forEach(sex => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = sex;
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) selectedOpdSex.add(sex);
            else selectedOpdSex.delete(sex);
            updateOpdDashboard();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(sex));
        opdSexFiltersContainer.appendChild(label);
    });

    // 4. Diag Type
    const uniqueDiagTypes = [...new Set(opdRawData.map(row => row.diag_type))].sort();
    selectedOpdDiagTypes = new Set(uniqueDiagTypes);
    opdDiagTypeFiltersContainer.innerHTML = '';
    uniqueDiagTypes.forEach(dt => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = dt;
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) selectedOpdDiagTypes.add(dt);
            else selectedOpdDiagTypes.delete(dt);
            updateOpdDashboard();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(opdDiagTypeLabels[dt] || `ประเภท ${dt}`));
        opdDiagTypeFiltersContainer.appendChild(label);
    });

    // 5. Diag Code — Search + Tag selection (use diag cache)
    if (opdDiagSearch) {
        opdDiagSearch.addEventListener('input', (e) => {
            opdDiagSearchQuery = e.target.value.trim().toUpperCase();
            renderDiagSuggestions();
        });
        opdDiagSearch.addEventListener('blur', () => {
            setTimeout(() => { if (opdDiagSuggestions) opdDiagSuggestions.style.display = 'none'; }, 200);
        });
        opdDiagSearch.addEventListener('focus', () => {
            if (opdDiagSearchQuery) renderDiagSuggestions();
        });
    }

    // 6. Insurance Type
    const uniqueIns = [...new Set(opdRawData.map(row => row.ins_type))].sort();
    opdInsSelect.innerHTML = '<option value="all">-- ทุกสิทธิ์การรักษา --</option>';
    uniqueIns.forEach(ins => {
        if (!ins) return;
        const opt = document.createElement('option');
        opt.value = ins;
        opt.innerText = ins;
        opdInsSelect.appendChild(opt);
    });

    // 7. Changwat (Province) — from location cache
    const uniqueChangwats = [...new Set(opdLocCache.map(row => row.changwat))].sort();
    opdChangwatSelect.innerHTML = '<option value="all">-- ทุกจังหวัด --</option>';
    uniqueChangwats.forEach(cw => {
        if (!cw) return;
        const opt = document.createElement('option');
        opt.value = cw;
        opt.innerText = cw;
        opdChangwatSelect.appendChild(opt);
    });

    // 8. Amphur — initially all
    const uniqueAmphurs = [...new Set(opdLocCache.map(row => row.amphur))].sort();
    opdAmphurSelect.innerHTML = '<option value="all">-- ทุกอำเภอ --</option>';
    uniqueAmphurs.forEach(amp => {
        if (!amp) return;
        const opt = document.createElement('option');
        opt.value = amp;
        opt.innerText = amp;
        opdAmphurSelect.appendChild(opt);
    });

    // 9. District — initially all
    const uniqueDistricts = [...new Set(opdLocCache.map(row => row.district))].sort();
    opdDistrictSelect.innerHTML = '<option value="all">-- ทุกตำบล --</option>';
    uniqueDistricts.forEach(dis => {
        if (!dis) return;
        const opt = document.createElement('option');
        opt.value = dis;
        opt.innerText = dis;
        opdDistrictSelect.appendChild(opt);
    });
}

// ---- Diag Code auto-complete ----
function renderDiagSuggestions() {
    if (!opdDiagSuggestions || !opdDiagSearchQuery || opdDiagSearchQuery.length < 1) {
        if (opdDiagSuggestions) opdDiagSuggestions.style.display = 'none';
        return;
    }
    const q = opdDiagSearchQuery.toUpperCase();
    const allCodes = [...new Set(opdDiagCache.map(r => r.diag_code))].filter(c => c && c !== 'ไม่ระบุ');
    const matches = allCodes.filter(c => c.includes(q)).slice(0, 20);

    opdDiagSuggestions.innerHTML = '';
    if (matches.length === 0) {
        opdDiagSuggestions.style.display = 'none';
        return;
    }
    opdDiagSuggestions.style.display = 'block';
    matches.forEach(code => {
        const div = document.createElement('div');
        div.style.cssText = 'padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.85rem; border-bottom: 1px solid var(--border-color);';
        div.textContent = code;
        div.addEventListener('mousedown', (e) => {
            e.preventDefault();
            addDiagCode(code);
            opdDiagSearch.value = '';
            opdDiagSearchQuery = '';
            opdDiagSuggestions.style.display = 'none';
        });
        div.addEventListener('mouseenter', () => { div.style.backgroundColor = 'var(--bg-hover)'; });
        div.addEventListener('mouseleave', () => { div.style.backgroundColor = ''; });
        opdDiagSuggestions.appendChild(div);
    });
}

function addDiagCode(code) {
    if (selectedOpdDiagCodes.has(code)) return;
    selectedOpdDiagCodes.add(code);
    renderDiagTags();
    updateOpdDashboard();
}

function removeDiagCode(code) {
    selectedOpdDiagCodes.delete(code);
    renderDiagTags();
    updateOpdDashboard();
}

function renderDiagTags() {
    if (!opdDiagSelected) return;
    opdDiagSelected.innerHTML = '';
    if (selectedOpdDiagCodes.size === 0) return;
    selectedOpdDiagCodes.forEach(code => {
        const tag = document.createElement('span');
        tag.style.cssText = 'display: inline-flex; align-items: center; gap: 0.25rem; background: var(--primary); color: #fff; padding: 0.15rem 0.5rem; border-radius: 12px; font-size: 0.75rem;';
        tag.innerHTML = `${code} <i class="fa-solid fa-xmark" style="cursor:pointer;font-size:0.7rem;"></i>`;
        tag.querySelector('i').addEventListener('click', () => removeDiagCode(code));
        opdDiagSelected.appendChild(tag);
    });
}

// ---- Cascading Location Filters ----
function updateAmphurOptions(selectedChangwat) {
    let amphurs = [...new Set(opdLocCache
        .filter(r => selectedChangwat === 'all' || r.changwat === selectedChangwat)
        .map(r => r.amphur)
    )].sort();

    opdAmphurSelect.innerHTML = '<option value="all">-- ทุกอำเภอ --</option>';
    amphurs.forEach(amp => {
        if (!amp) return;
        const opt = document.createElement('option');
        opt.value = amp;
        opt.innerText = amp;
        if (selectedOpdAmphur === amp) opt.selected = true;
        opdAmphurSelect.appendChild(opt);
    });

    // Reset district when amphur changes
    updateDistrictOptions(selectedChangwat, selectedOpdAmphur);
}

function updateDistrictOptions(selectedChangwat, selectedAmphur) {
    let districts = [...new Set(opdLocCache
        .filter(r => {
            if (selectedChangwat !== 'all' && r.changwat !== selectedChangwat) return false;
            if (selectedAmphur !== 'all' && r.amphur !== selectedAmphur) return false;
            return true;
        })
        .map(r => r.district)
    )].sort();

    opdDistrictSelect.innerHTML = '<option value="all">-- ทุกตำบล --</option>';
    districts.forEach(dis => {
        if (!dis) return;
        const opt = document.createElement('option');
        opt.value = dis;
        opt.innerText = dis;
        if (selectedOpdDistrict === dis) opt.selected = true;
        opdDistrictSelect.appendChild(opt);
    });
}

// ---- Filter Logic (combines all filters across all data caches) ----
function getFilteredOpdData() {
    return opdRawData.filter(row => {
        if (!selectedOpdYears.has(row.byear)) return false;
        if (!selectedOpdMonths.has(row.month_visit)) return false;
        if (!selectedOpdSex.has(row.sex)) return false;
        if (!selectedOpdDiagTypes.has(row.diag_type)) return false;
        if (selectedOpdIns !== 'all' && row.ins_type !== selectedOpdIns) return false;
        if (selectedOpdChangwat !== 'all' && row.changwat !== selectedOpdChangwat) return false;
        if (selectedOpdAmphur !== 'all' && row.amphur !== selectedOpdAmphur) return false;
        if (selectedOpdDistrict !== 'all' && row.district !== selectedOpdDistrict) return false;
        return true;
    });
}

// For diag cache: apply year/month/sex/changwat/amphur filters
function filterDiagData() {
    return opdDiagCache.filter(row => {
        if (!selectedOpdYears.has(row.byear)) return false;
        if (!selectedOpdMonths.has(row.month_visit)) return false;
        if (!selectedOpdSex.has(row.sex)) return false;
        if (!selectedOpdDiagTypes.has(row.diag_type)) return false;
        if (selectedOpdChangwat !== 'all' && row.changwat !== selectedOpdChangwat) return false;
        if (selectedOpdAmphur !== 'all' && row.amphur !== selectedOpdAmphur) return false;
        if (selectedOpdDiagCodes.size > 0 && !selectedOpdDiagCodes.has(row.diag_code)) return false;
        return true;
    });
}

// ---- Main Update Function ----
function updateOpdDashboard() {
    const filtered = getFilteredOpdData();
    const diagData = filterDiagData();

    // KPIs
    let totalVisits = 0, totalAgeWeightedSum = 0, maleVisits = 0, femaleVisits = 0;
    filtered.forEach(row => {
        totalVisits += row.visit_count;
        totalAgeWeightedSum += row.sum_age;
        if (row.sex === 'ชาย') maleVisits += row.visit_count;
        else if (row.sex === 'หญิง') femaleVisits += row.visit_count;
    });
    const avgAge = totalVisits > 0 ? (totalAgeWeightedSum / totalVisits) : 0;
    const femalePct = totalVisits > 0 ? (femaleVisits / totalVisits * 100) : 0;
    const malePct = totalVisits > 0 ? (maleVisits / totalVisits * 100) : 0;

    document.getElementById('val-opd-total-visits').innerText = totalVisits.toLocaleString();
    document.getElementById('val-opd-avg-age').innerText = avgAge.toFixed(2);
    document.getElementById('val-opd-female-pct').innerText = `${femalePct.toFixed(1)}%`;
    document.getElementById('val-opd-female-count').innerText = `${femaleVisits.toLocaleString()} ครั้ง`;
    document.getElementById('val-opd-male-pct').innerText = `${malePct.toFixed(1)}%`;
    document.getElementById('val-opd-male-count').innerText = `${maleVisits.toLocaleString()} ครั้ง`;

    // Charts
    renderOpdTrendChart(filtered);
    renderOpdDiagChart(filtered);

    // Latest data badge
    const maxYear = [...selectedOpdYears].sort((a,b)=>b-a)[0];
    if (maxYear) {
        const badge = document.getElementById('opd-trend-badge');
        if (badge) badge.innerText = `ข้อมูลล่าสุด: ปี ${maxYear}`;
    }
}

// ---- Chart 1: Monthly Visit Trend ----
function renderOpdTrendChart(data) {
    const canvas = document.getElementById('opdTrendChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (opdTrendChartInstance) opdTrendChartInstance.destroy();

    const monthly = {};
    data.forEach(row => {
        const key = `${row.year_visit}-${row.month_visit}`;
        if (!monthly[key]) monthly[key] = { visits: 0 };
        monthly[key].visits += row.visit_count;
    });

    const sortedKeys = Object.keys(monthly).sort();
    const labels = sortedKeys.map(k => {
        const parts = k.split('-');
        const m = parts[1]; const y = parts[0];
        const mn = { '01':'ม.ค.','02':'ก.พ.','03':'มี.ค.','04':'เม.ย.','05':'พ.ค.','06':'มิ.ย.','07':'ก.ค.','08':'ส.ค.','09':'ก.ย.','10':'ต.ค.','11':'พ.ย.','12':'ธ.ค.' }[m] || m;
        return `${mn} ${y}`;
    });
    const chartData = sortedKeys.map(k => monthly[k].visits);

    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#243049' : '#e2e8f0';
    const textColor = isDark ? '#9ca3af' : '#64748b';

    opdTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'จำนวนครั้ง (ครั้ง)',
                data: chartData,
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79,70,229,0.1)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.3,
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
                y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 }, callback: v => v.toLocaleString() } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: c => ` จำนวนครั้ง: ${c.raw.toLocaleString()} ครั้ง`
                    }
                }
            }
        }
    });
}

// ---- Chart 2: Top Diagnosis Codes ----
function renderOpdDiagChart(data) {
    const canvas = document.getElementById('opdDiagChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (opdDiagChartInstance) opdDiagChartInstance.destroy();

    const limitSelect = document.getElementById('opd-diag-limit');
    const limit = limitSelect ? parseInt(limitSelect.value) : 10;

    // 1. Group overall to find Top N codes across all selected years
    const overallGrouped = {};
    data.forEach(row => {
        const code = row.diag_code || 'ไม่ระบุ';
        overallGrouped[code] = (overallGrouped[code] || 0) + row.visit_count;
    });

    const sortedTop = Object.entries(overallGrouped).sort((a, b) => b[1] - a[1]).slice(0, limit);
    const labels = sortedTop.map(e => e[0]);

    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#243049' : '#e2e8f0';
    const textColor = isDark ? '#9ca3af' : '#64748b';
    const tooltipBg = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)';

    if (labels.length === 0 || selectedOpdYears.size === 0) {
        opdDiagChartInstance = new Chart(ctx, {
            type: 'bar', data: { datasets: [] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'ไม่มีข้อมูล', color: textColor } } }
        });
        return;
    }

    // 2. Create datasets: one dataset per year, sorted descending so more recent year is on top
    const activeYears = Array.from(selectedOpdYears).sort((a, b) => a - b);
    const activeYearsDescending = [...activeYears].reverse();
    
    // Function to get color from root vars or fallback
    const getYearColor = (year, index) => {
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
        return colors[index % colors.length];
    };

    const barDatasets = activeYearsDescending.map((year, index) => {
        const color = getYearColor(year, index);
        
        const dataPoints = labels.map(code => {
            return data
                .filter(row => row.byear === year && (row.diag_code || 'ไม่ระบุ') === code)
                .reduce((sum, row) => sum + row.visit_count, 0);
        });

        return {
            label: `ปีงบประมาณ ${year}`,
            data: dataPoints,
            backgroundColor: color,
            borderRadius: 4
        };
    });

    opdDiagChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: barDatasets
        },
        options: {
            indexAxis: 'y', // Horizontal bar chart
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Inter', size: 10 }, callback: v => v.toLocaleString() }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: 'Inter', size: 11 } }
                }
            },
            plugins: {
                legend: {
                    display: activeYears.length > 1, // Only show legend if multiple years are selected
                    position: 'bottom',
                    labels: { color: textColor, font: { family: 'Sarabun', size: 12 }, padding: 20, usePointStyle: true }
                },
                tooltip: {
                    backgroundColor: tooltipBg, titleColor: isDark ? '#ffffff' : '#1e293b', bodyColor: isDark ? '#e2e8f0' : '#475569',
                    titleFont: { family: 'Sarabun', size: 13, weight: 'bold' }, bodyFont: { family: 'Sarabun', size: 13 },
                    padding: 12, borderColor: isDark ? '#334155' : '#cbd5e1', borderWidth: 1,
                    callbacks: {
                        title: c => `รหัสโรค: ${c[0].label}`,
                        label: function(context) {
                            const currentVal = context.raw;
                            if (currentVal === null || currentVal === undefined) return '';
                            
                            let labelText = ` ${context.dataset.label}: ${currentVal.toLocaleString()} ครั้ง`;
                            
                            const chart = context.chart;
                            const dataIndex = context.dataIndex;
                            const label = context.dataset.label;
                            const match = label.match(/\d+/);
                            
                            if (match) {
                                const currentYear = parseInt(match[0]);
                                const prevDataset = chart.data.datasets.find(ds => {
                                    const dsMatch = ds.label.match(/\d+/);
                                    return dsMatch && parseInt(dsMatch[0]) === currentYear - 1;
                                });
                                if (prevDataset) {
                                    const prevVal = prevDataset.data[dataIndex];
                                    if (prevVal !== undefined && prevVal !== null && prevVal > 0) {
                                        const pctChange = ((currentVal - prevVal) / prevVal) * 100;
                                        const direction = pctChange > 0 ? 'เพิ่มขึ้น' : (pctChange < 0 ? 'ลดลง' : 'เท่าเดิม');
                                        const pctText = pctChange !== 0 ? ` ${Math.abs(pctChange).toFixed(1)}%` : '';
                                        labelText += ` (${direction}${pctText} เทียบกับปี ${prevDataset.label.replace('ปีงบประมาณ ', 'ปี ')})`;
                                    }
                                }
                            }
                            return labelText;
                        }
                    }
                }
            }
        }
    });
}

// ---- Event Listeners ----
function setupOpdEventListeners() {

    const limitSelect = document.getElementById('opd-diag-limit');
    if (limitSelect) limitSelect.addEventListener('change', updateOpdDashboard);
    
    const compareSelect = document.getElementById('opd-diag-compare');
    if (compareSelect) compareSelect.addEventListener('change', updateOpdDashboard);

    // Insurance
    if (opdInsSelect) {
        opdInsSelect.addEventListener('change', (e) => {
            selectedOpdIns = e.target.value;
            updateOpdDashboard();
        });
    }

    // Changwat (Province)
    if (opdChangwatSelect) {
        opdChangwatSelect.addEventListener('change', (e) => {
            selectedOpdChangwat = e.target.value;
            selectedOpdAmphur = 'all';
            selectedOpdDistrict = 'all';
            updateAmphurOptions(selectedOpdChangwat);
            if (opdAmphurSelect) opdAmphurSelect.value = 'all';
            if (opdDistrictSelect) opdDistrictSelect.value = 'all';
            updateOpdDashboard();
        });
    }

    // Amphur
    if (opdAmphurSelect) {
        opdAmphurSelect.addEventListener('change', (e) => {
            selectedOpdAmphur = e.target.value;
            selectedOpdDistrict = 'all';
            updateDistrictOptions(selectedOpdChangwat, selectedOpdAmphur);
            if (opdDistrictSelect) opdDistrictSelect.value = 'all';
            updateOpdDashboard();
        });
    }

    // District
    if (opdDistrictSelect) {
        opdDistrictSelect.addEventListener('change', (e) => {
            selectedOpdDistrict = e.target.value;
            updateOpdDashboard();
        });
    }
}







// --- GridStack Integration ---
let grids = {};
function initGridStack() {
    const gridOptions = {
        column: 12,
        cellHeight: '80px',
        margin: '10px',
        resizable: { handles: 'e, se, s, sw, w, nw, n, ne' },
        handle: '.kpi-header, .panel-header, .table-header, .breakdown-title'
    };
    
    const tabs = ['cmi', 'transfer', 'items', 'opd'];
    const originalDisplays = {};
    
    // 1. Temporarily force all dashboard contents to be visible so GridStack can read their widths
    tabs.forEach(tab => {
        const el = document.getElementById(tab + '-dashboard-content');
        if (el) {
            originalDisplays[tab] = el.style.display;
            el.style.display = 'block';
            el.classList.add('active'); // ensure it gets display: block from CSS
        }
    });
    
    // 2. Initialize GridStack on all grids
    tabs.forEach(tab => {
        const el = document.querySelector('#grid-' + tab);
        if (el) {
            grids[tab] = GridStack.init(gridOptions, el);
            
            grids[tab].on('resizestop', function(event, el) {
                if (typeof resizeAllCharts === 'function') {
                    resizeAllCharts();
                }
                window.dispatchEvent(new Event('resize'));
            });
        }
    });
    
    // 3. Restore original visibility states
    tabs.forEach(tab => {
        const el = document.getElementById(tab + '-dashboard-content');
        if (el) {
            el.style.display = originalDisplays[tab];
            if (tab !== 'cmi') {
                el.classList.remove('active');
            }
        }
    });
}

// -----------------------------------------------------------------------------
// CMI BENCHMARK COMPARISON LOGIC (Risk 5-7 M1 vs Li Hospital)
// -----------------------------------------------------------------------------

let cmiBenchRawData = null;
let cmiBenchSortKey = null;
let cmiBenchSortDir = 'asc';

function initCmiBenchmark() {
    const codeSearchInput = document.getElementById('cmi-bench-code-search');
    const descSearchInput = document.getElementById('cmi-bench-desc-search');
    const exportBtn = document.getElementById('btn-export-cmi-bench-csv');
    const toggleContainer = document.getElementById('cmi-bench-col-toggles');
    const headerRow = document.getElementById('cmi-bench-table-header');

    // Year / Month Checkbox Bulk Action Buttons
    const btnYearAll = document.getElementById('btn-bench-year-all');
    const btnYearClear = document.getElementById('btn-bench-year-clear');
    const btnMonthAll = document.getElementById('btn-bench-month-all');
    const btnMonthClear = document.getElementById('btn-bench-month-clear');

    if (btnYearAll) {
        btnYearAll.addEventListener('click', () => {
            document.querySelectorAll('#cmi-bench-year-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = true);
            triggerBenchDataReload();
        });
    }

    if (btnYearClear) {
        btnYearClear.addEventListener('click', () => {
            document.querySelectorAll('#cmi-bench-year-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
            triggerBenchDataReload();
        });
    }

    if (btnMonthAll) {
        btnMonthAll.addEventListener('click', () => {
            document.querySelectorAll('#cmi-bench-month-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = true);
            triggerBenchDataReload();
        });
    }

    if (btnMonthClear) {
        btnMonthClear.addEventListener('click', () => {
            document.querySelectorAll('#cmi-bench-month-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
            triggerBenchDataReload();
        });
    }

    // Month checkboxes change listener
    const monthContainer = document.getElementById('cmi-bench-month-checkboxes');
    if (monthContainer) {
        monthContainer.addEventListener('change', () => {
            triggerBenchDataReload();
        });
    }

    // Code & Description Search inputs listener
    if (codeSearchInput) {
        codeSearchInput.addEventListener('input', () => {
            renderCmiBenchmarkTable();
        });
    }

    if (descSearchInput) {
        descSearchInput.addEventListener('input', () => {
            renderCmiBenchmarkTable();
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            exportCmiBenchmarkCSV();
        });
    }

    // Header Sort Listener
    if (headerRow) {
        headerRow.addEventListener('click', (e) => {
            const th = e.target.closest('th[data-sort]');
            if (!th) return;
            const key = th.getAttribute('data-sort');
            if (cmiBenchSortKey === key) {
                cmiBenchSortDir = cmiBenchSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                cmiBenchSortKey = key;
                cmiBenchSortDir = 'asc';
            }
            updateCmiBenchSortIcons();
            renderCmiBenchmarkTable();
        });
    }

    // Column Toggles Listener
    if (toggleContainer) {
        toggleContainer.addEventListener('change', (e) => {
            if (e.target && e.target.type === 'checkbox') {
                const col = e.target.getAttribute('data-col');
                const table = document.getElementById('cmi-benchmark-table');
                if (table && col) {
                    if (e.target.checked) {
                        table.classList.remove(`hide-${col}`);
                    } else {
                        table.classList.add(`hide-${col}`);
                    }
                }
            }
        });
    }

    // Initial load
    loadCmiBenchmarkData('all', 'all', true);
}

function getSelectedBenchYears() {
    const list = document.querySelectorAll('#cmi-bench-year-checkboxes input[type="checkbox"]:checked');
    const allCheckboxes = document.querySelectorAll('#cmi-bench-year-checkboxes input[type="checkbox"]');
    if (!list || list.length === 0) return 'none';
    if (list.length === allCheckboxes.length) return 'all';
    return Array.from(list).map(cb => cb.value).join(',');
}

function getSelectedBenchMonths() {
    const list = document.querySelectorAll('#cmi-bench-month-checkboxes input[type="checkbox"]:checked');
    const allCheckboxes = document.querySelectorAll('#cmi-bench-month-checkboxes input[type="checkbox"]');
    if (!list || list.length === 0) return 'none';
    if (list.length === allCheckboxes.length) return 'all';
    return Array.from(list).map(cb => cb.value).join(',');
}

function triggerBenchDataReload() {
    const yStr = getSelectedBenchYears();
    const mStr = getSelectedBenchMonths();
    loadCmiBenchmarkData(yStr, mStr);
}

function updateCmiBenchSortIcons() {
    const headers = document.querySelectorAll('#cmi-bench-table-header th[data-sort]');
    headers.forEach(th => {
        const key = th.getAttribute('data-sort');
        const icon = th.querySelector('i');
        th.classList.remove('active-sort');
        if (icon) {
            icon.className = 'fa-solid fa-sort';
        }
        if (key === cmiBenchSortKey) {
            th.classList.add('active-sort');
            if (icon) {
                if (key === 'code' || key === 'desc') {
                    icon.className = cmiBenchSortDir === 'asc' ? 'fa-solid fa-arrow-down-a-z' : 'fa-solid fa-arrow-up-z-a';
                } else {
                    icon.className = cmiBenchSortDir === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
                }
            }
        }
    });
}

function loadCmiBenchmarkData(year, month, isInitial = false) {
    const url = `/api/cmi/benchmark?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;
    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch CMI benchmark data');
            return res.json();
        })
        .then(data => {
            cmiBenchRawData = data;

            // Populate year checkboxes on initial load
            if (isInitial && data.available_years && data.available_years.length > 0) {
                const yearContainer = document.getElementById('cmi-bench-year-checkboxes');
                if (yearContainer) {
                    yearContainer.innerHTML = '';
                    data.available_years.forEach(y => {
                        const label = document.createElement('label');
                        label.className = 'bench-checkbox-tag';
                        label.innerHTML = `<input type="checkbox" value="${y}" checked /> ปี ${y}`;
                        yearContainer.appendChild(label);
                    });

                    // Add change listener to year checkboxes
                    yearContainer.addEventListener('change', () => {
                        triggerBenchDataReload();
                    });
                }
            }

            // Update KPI Mini Cards
            const casesEl = document.getElementById('val-bench-cases');
            const adjrwEl = document.getElementById('val-bench-adjrw');
            const cmiEl = document.getElementById('val-bench-cmi');

            if (casesEl && data.summary) {
                casesEl.textContent = data.summary.total_li_cases.toLocaleString('th-TH');
            }
            if (adjrwEl && data.summary) {
                adjrwEl.textContent = data.summary.total_li_sum_adjrw.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
            }
            if (cmiEl && data.summary) {
                cmiEl.textContent = data.summary.overall_li_cmi.toFixed(4);
            }

            renderCmiBenchmarkTable();
        })
        .catch(err => {
            console.error('Error loading CMI benchmark:', err);
        });
}

function renderCmiBenchmarkTable() {
    const tbody = document.getElementById('cmi-benchmark-table-body');
    const codeSearchInput = document.getElementById('cmi-bench-code-search');
    const descSearchInput = document.getElementById('cmi-bench-desc-search');
    if (!tbody || !cmiBenchRawData || !cmiBenchRawData.data) return;

    const codeQuery = codeSearchInput ? codeSearchInput.value.trim().toLowerCase() : '';
    const descQuery = descSearchInput ? descSearchInput.value.trim().toLowerCase() : '';

    let filtered = cmiBenchRawData.data.filter(row => {
        if (codeQuery && !row.code.toLowerCase().includes(codeQuery)) return false;
        if (descQuery && !row.desc.toLowerCase().includes(descQuery)) return false;
        return true;
    });

    // Apply Column Sorting if sort key is set
    if (cmiBenchSortKey) {
        filtered.sort((a, b) => {
            if (cmiBenchSortKey === 'code' || cmiBenchSortKey === 'desc') {
                const valA = (a[cmiBenchSortKey] || '').toString();
                const valB = (b[cmiBenchSortKey] || '').toString();
                return cmiBenchSortDir === 'asc'
                    ? valA.localeCompare(valB, 'th')
                    : valB.localeCompare(valA, 'th');
            } else {
                const valA = parseFloat(a[cmiBenchSortKey]) || 0;
                const valB = parseFloat(b[cmiBenchSortKey]) || 0;
                return cmiBenchSortDir === 'asc' ? valA - valB : valB - valA;
            }
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-sidebar-muted); padding: 1.5rem;">ไม่พบข้อมูลโรคที่ตรงตามคำค้นหา</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach(row => {
        const diff = row.diff;
        let diffBadge = '';

        if (row.li_cases === 0) {
            diffBadge = `<span style="display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.78rem; background: var(--bg-hover); color: var(--text-sidebar-muted);">0 เคส</span>`;
        } else if (diff > 0) {
            diffBadge = `<span style="display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.78rem; background: rgba(34, 197, 94, 0.15); color: #16a34a; font-weight: 600;"><i class="fa-solid fa-arrow-up"></i> +${diff.toFixed(4)}</span>`;
        } else if (diff < 0) {
            diffBadge = `<span style="display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.78rem; background: rgba(239, 68, 68, 0.15); color: #dc2626; font-weight: 600;"><i class="fa-solid fa-arrow-down"></i> ${diff.toFixed(4)}</span>`;
        } else {
            diffBadge = `<span style="display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.78rem; background: rgba(107, 114, 128, 0.15); color: var(--text-secondary); font-weight: 600;">= 0.0000</span>`;
        }

        const cmiLiStr = row.li_cases > 0 ? row.cmi_li.toFixed(4) : '-';

        html += `
            <tr>
                <td class="col-code">${row.code}</td>
                <td class="col-desc">${row.desc}</td>
                <td class="col-hosp-5 numeric-cell">${row.sanpatong.toFixed(2)}</td>
                <td class="col-hosp-5 numeric-cell">${row.chiangkham.toFixed(2)}</td>
                <td class="col-hosp-5 numeric-cell">${row.chomthong.toFixed(2)}</td>
                <td class="col-hosp-5 numeric-cell">${row.fang.toFixed(2)}</td>
                <td class="col-hosp-5 numeric-cell">${row.sansai.toFixed(2)}</td>
                <td class="col-avg-5 numeric-cell" style="background: var(--bg-hover); font-weight: 600;">${row.avg5.toFixed(4)}</td>
                <td class="col-li-cases numeric-cell" style="background: rgba(34, 197, 94, 0.05); font-weight: 600;">${row.li_cases.toLocaleString('th-TH')}</td>
                <td class="col-li-adjrw numeric-cell" style="background: rgba(34, 197, 94, 0.05);">${row.li_cases > 0 ? row.li_sum_adjrw.toFixed(4) : '-'}</td>
                <td class="col-li-cmi numeric-cell" style="background: rgba(34, 197, 94, 0.12); font-weight: 700; color: #16a34a;">${cmiLiStr}</td>
                <td class="col-diff" style="text-align: center;">${diffBadge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function exportCmiBenchmarkCSV() {
    if (!cmiBenchRawData || !cmiBenchRawData.data || cmiBenchRawData.data.length === 0) {
        alert('ไม่มีข้อมูลสำหรับส่งออก CSV');
        return;
    }

    const yVal = getSelectedBenchYears();
    const mVal = getSelectedBenchMonths();

    const headers = [
        'รหัสโรค (ICD-10)',
        'ชื่อโรค (Description)',
        'สันป่าตอง (11128)',
        'เชียงคำ (10718)',
        'จอมทอง (11119)',
        'ฝาง (11125)',
        'สันทราย (11130)',
        'เฉลี่ย 5 รพ.',
        'จำนวนเคส (รพ.ลี้)',
        'ผลรวม AdjRW (รพ.ลี้)',
        'CMI (รพ.ลี้)',
        'ส่วนต่าง (ลี้ vs เฉลี่ย 5 รพ.)'
    ];

    const csvRows = [headers.join(',')];

    cmiBenchRawData.data.forEach(r => {
        const rowVal = [
            `"${r.code}"`,
            `"${r.desc.replace(/"/g, '""')}"`,
            r.sanpatong.toFixed(2),
            r.chiangkham.toFixed(2),
            r.chomthong.toFixed(2),
            r.fang.toFixed(2),
            r.sansai.toFixed(2),
            r.avg5.toFixed(4),
            r.li_cases,
            r.li_sum_adjrw.toFixed(4),
            r.li_cases > 0 ? r.cmi_li.toFixed(4) : 0,
            r.diff.toFixed(4)
        ];
        csvRows.push(rowVal.join(','));
    });

    const csvContent = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const fileName = `CMI_Benchmark_Risk5-7_Li_Hospital_Years_${yVal}_Months_${mVal}.csv`;
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

