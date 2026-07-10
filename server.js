const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();

// Load configuration
let config = {};
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
        console.error('Error parsing config.json:', err);
    }
}

const port = (config.server && config.server.port) || 3000;

// Caches for in-memory data
let cmiCache = [];
let transfersCache = [];
let itemsCache = [];
let opdCache = [];
let opdDiagCache = [];
let opdLocCache = [];

// Database Connection & Failover State
let currentMode = 'csv'; // Initial mode is csv, will try db on startup
let pool = null;

function initializeDatabase() {
    if (!config.database) {
        console.warn('No database configuration found in config.json. Defaulting to CSV mode.');
        currentMode = 'csv';
        loadCSVDataSources();
        return;
    }

    console.log(`[${new Date().toISOString()}] Initializing PostgreSQL connection pool...`);
    pool = new Pool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: config.database.database,
        connectionTimeoutMillis: config.database.connectionTimeoutMillis || 3000,
        idleTimeoutMillis: config.database.idleTimeoutMillis || 30000
    });

    pool.on('error', (err) => {
        console.error('Unexpected error on idle database client:', err.message);
        if (currentMode === 'db') {
            switchToCSV('DB idle client error: ' + err.message);
        }
    });

    // Always load CSV data as fallback baseline (also serves the new OPD endpoints)
    loadCSVDataSources();

    // Run initial connection test
    testConnection();
    // Start heartbeat monitor
    startHeartbeat();
}

async function testConnection() {
    try {
        const client = await pool.connect();
        client.release();
        console.log(`[${new Date().toISOString()}] Successfully connected to PostgreSQL at ${config.database.host}`);
        if (currentMode !== 'db') {
            switchToDB();
        }
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Failed to connect to PostgreSQL:`, err.message);
        if (currentMode !== 'csv') {
            switchToCSV(err.message);
        } else {
            // Ensure CSV data is loaded if we're in CSV mode and caches are empty
            if (cmiCache.length === 0) {
                loadCSVDataSources();
            }
        }
    }
}

function switchToCSV(reason) {
    console.warn(`[${new Date().toISOString()}] SWITCHING TO CSV BACKUP MODE. Reason: ${reason}`);
    currentMode = 'csv';
    if (cmiCache.length === 0 || transfersCache.length === 0 || itemsCache.length === 0 || opdCache.length === 0 ||
        opdDiagCache.length === 0 || opdLocCache.length === 0) {
        loadCSVDataSources();
    }
}

function switchToDB() {
    console.log(`[${new Date().toISOString()}] SWITCHING TO DATABASE MODE.`);
    currentMode = 'db';
}

function startHeartbeat() {
    const interval = (config.failover && config.failover.heartbeat_interval_ms) || 10000;
    const dbTimeout = (config.failover && config.failover.db_timeout_ms) || 3000;
    
    setInterval(async () => {
        if (!pool) return;
        
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error('Database query timed out'));
            }, dbTimeout);
        });
        
        const queryPromise = pool.query('SELECT 1');
        
        try {
            await Promise.race([queryPromise, timeoutPromise]);
            clearTimeout(timeoutId);
            
            if (currentMode !== 'db') {
                console.log(`[${new Date().toISOString()}] Database is back online.`);
                switchToDB();
            }
        } catch (err) {
            clearTimeout(timeoutId);
            console.error(`[${new Date().toISOString()}] Heartbeat check failed:`, err.message);
            if (currentMode !== 'csv') {
                switchToCSV('Heartbeat failure: ' + err.message);
            }
        }
    }, interval);
}

async function queryDatabase(type) {
    if (!pool) throw new Error('Database pool not initialized');
    
    const client = await pool.connect();
    try {
        if (type === 'cmi') {
            const tableName = config.db_tables && config.db_tables.cmi ? config.db_tables.cmi : 'ipd_cmi';
            const res = await client.query(`SELECT * FROM ${tableName}`);
            return res.rows.map(row => ({
                insure_group: row.insure_group,
                insure_desc: row.insure_desc ? row.insure_desc.trim() : '',
                mdc: row.mdc ? row.mdc.trim().padStart(2, '0') : '',
                mdc_desc: row.mdc_desc ? row.mdc_desc.trim() : '',
                total: parseInt(row.total) || 0,
                sum_adjrw: parseFloat(row.sum_adjrw) || 0,
                average_adjrw: parseFloat(row.average_adjrw) || 0,
                surgery_total: parseInt(row.surgery_total) || 0,
                surgery_sum_adjrw: parseFloat(row.surgery_sum_adjrw) || 0,
                med_total: parseInt(row.med_total) || 0,
                med_sum_adjrw: parseFloat(row.med_sum_adjrw) || 0,
                byear: parseInt(row.byear) || 0,
                year: parseInt(row.year) || 0,
                month: parseInt(row.month) || 0
            })).filter(row => row.byear > 0 && row.total > 0 && row.mdc !== '' && row.insure_desc !== 'รวม');
        } else if (type === 'transfers') {
            const tableName = config.db_tables && config.db_tables.transfers ? config.db_tables.transfers : 'fundtransfer';
            const res = await client.query(`SELECT * FROM ${tableName}`);
            return res.rows.map(row => {
                const amount = parseFloat(row.amount) || 0;
                const deduction = parseFloat(row.deduction) || 0;
                let remain = parseFloat(row.remain) || 0;
                
                if (amount === 0 && deduction > 0 && remain > 0) {
                    remain = -remain;
                }
                
                return {
                    no: row.no,
                    transfer_date: row.transfer_date ? row.transfer_date.trim() : '',
                    date: row.date ? row.date.trim() : '',
                    month: row.month ? row.month.trim() : '',
                    year: parseInt(row.year) || 0,
                    sub_fund: row.sub_fund ? row.sub_fund.trim() : 'ไม่ระบุกองทุนย่อย',
                    main_fund: row.main_fund ? row.main_fund.trim() : 'ไม่ระบุกองทุนหลัก',
                    amount: amount,
                    delay: parseFloat(row.delay) || 0,
                    deduction: deduction,
                    contract_guarantee: parseFloat(row.contract_guarantee) || 0,
                    tax: parseFloat(row.tax) || 0,
                    transfer_amount: remain,
                    byear: parseInt(row.byear) || 0
                };
            }).filter(row => row.byear > 0 && row.main_fund !== '');
        } else if (type === 'items') {
            const tableName = config.db_tables && config.db_tables.items ? config.db_tables.items : 'view_items_summary_aggregated';
            const res = await client.query(`SELECT * FROM ${tableName}`);
            return res.rows.map(row => ({
                visit_type: row.visit_type ? row.visit_type.trim() : 'ไม่ระบุประเภทผู้ป่วย',
                item_group: row.item_group ? row.item_group.trim() : 'ไม่ระบุกลุ่มบริการ',
                item_common_name: row.item_common_name ? row.item_common_name.trim() : 'ไม่ระบุรายการบริการ',
                total_quantity: parseInt(row.total_quantity) || 0,
                total_price: parseFloat(row.total_price) || 0,
                byear: parseInt(row.byear) || 0,
                year: parseInt(row.year) || 0,
                month: row.month ? row.month.toString().padStart(2, '0') : ''
            })).filter(row => row.byear > 0 && row.item_group !== '');
        } else if (type === 'opd') {
            const tableName = config.db_tables && config.db_tables.opd ? config.db_tables.opd : 'view_opd_visit_summary';
            const res = await client.query(`SELECT * FROM ${tableName}`);
            return res.rows.map(row => ({
                byear: parseInt(row.byear) || 0,
                year_visit: parseInt(row.year_visit) || 0,
                month_visit: row.month_visit ? row.month_visit.toString().padStart(2, '0') : '',
                sex: row.sex ? row.sex.trim() : 'ไม่ระบุ',
                changwat: row.changwat ? row.changwat.trim() : 'ไม่ระบุ',
                amphur: row.amphur ? row.amphur.trim() : 'ไม่ระบุ',
                district: row.district ? row.district.trim() : 'ไม่ระบุ',
                ins_type: row.ins_type ? row.ins_type.trim() : 'ไม่ระบุ',
                diag_code: row.diag_code ? row.diag_code.trim() : 'ไม่ระบุ',
                diag_type: row.diag_type ? row.diag_type.trim() : 'ไม่ระบุ',
                visit_count: parseInt(row.visit_count) || 0,
                sum_age: parseInt(row.sum_age) || 0
            })).filter(row => row.byear > 0 && row.visit_count > 0);
        }
        return [];
    } finally {
        client.release();
    }
}

// Custom CSV Parser helper functions
function parseCSVLine(line) {
    const result = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cell += '"';
                i++; // Skip the next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(cell);
            cell = '';
        } else {
            cell += char;
        }
    }
    result.push(cell);
    return result;
}

function parseCSVFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    if (lines.length === 0) return [];
    
    const headerLine = lines[0];
    if (!headerLine) return [];
    const headers = parseCSVLine(headerLine).map(h => h.trim());
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const rowValues = parseCSVLine(line);
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = rowValues[j] !== undefined ? rowValues[j] : '';
        }
        data.push(row);
    }
    return data;
}

function loadCSVDataSources() {
    console.log(`[${new Date().toISOString()}] Loading data from CSV files...`);
    const start = Date.now();

    // 1. Load CMI Data
    const cmiFilename = (config.data_files && config.data_files.cmi) || 'ipd_cmi.csv';
    const cmiPath = path.join(__dirname, cmiFilename);
    const cmiRaw = parseCSVFile(cmiPath);
    cmiCache = cmiRaw.map(row => ({
        insure_group: row.insure_group,
        insure_desc: row.insure_desc ? row.insure_desc.trim() : '',
        mdc: row.mdc ? row.mdc.trim().padStart(2, '0') : '',
        mdc_desc: row.mdc_desc ? row.mdc_desc.trim() : '',
        total: parseInt(row.total) || 0,
        sum_adjrw: parseFloat(row.sum_adjrw) || 0,
        average_adjrw: parseFloat(row.average_adjrw) || 0,
        surgery_total: parseInt(row.surgery_total) || 0,
        surgery_sum_adjrw: parseFloat(row.surgery_sum_adjrw) || 0,
        med_total: parseInt(row.med_total) || 0,
        med_sum_adjrw: parseFloat(row.med_sum_adjrw) || 0,
        byear: parseInt(row.byear) || 0,
        year: parseInt(row.year) || 0,
        month: parseInt(row.month) || 0
    })).filter(row => row.byear > 0 && row.total > 0 && row.mdc !== '' && row.insure_desc !== 'รวม');
    console.log(`[${new Date().toISOString()}] Loaded ${cmiFilename}: ${cmiCache.length} rows`);

    // 2. Load NHSO Fund Transfer Data
    const transfersFilename = (config.data_files && config.data_files.transfers) || 'fundtransfer.csv';
    const transfersPath = path.join(__dirname, transfersFilename);
    const transfersRaw = parseCSVFile(transfersPath);
    transfersCache = transfersRaw.map(row => {
        const amount = parseFloat(row.amount) || 0;
        const deduction = parseFloat(row.deduction) || 0;
        let remain = parseFloat(row.remain) || 0;

        // Fix database data entry sign error: if amount is 0 and deduction is positive, remain should be negative
        if (amount === 0 && deduction > 0 && remain > 0) {
            remain = -remain;
        }

        return {
            no: row.no,
            transfer_date: row.transfer_date ? row.transfer_date.trim() : '',
            date: row.date ? row.date.trim() : '',
            month: row.month ? row.month.trim() : '',
            year: parseInt(row.year) || 0,
            sub_fund: row.sub_fund ? row.sub_fund.trim() : 'ไม่ระบุกองทุนย่อย',
            main_fund: row.main_fund ? row.main_fund.trim() : 'ไม่ระบุกองทุนหลัก',
            amount: amount,
            delay: parseFloat(row.delay) || 0,
            deduction: deduction,
            contract_guarantee: parseFloat(row.contract_guarantee) || 0,
            tax: parseFloat(row.tax) || 0,
            transfer_amount: remain,
            byear: parseInt(row.byear) || 0
        };
    }).filter(row => row.byear > 0 && row.main_fund !== '');
    console.log(`[${new Date().toISOString()}] Loaded ${transfersFilename}: ${transfersCache.length} rows`);

    // 3. Load Items Service Data
    const itemsFilename = (config.data_files && config.data_files.items) || 'items_summary_aggregated.csv';
    const itemsPath = path.join(__dirname, itemsFilename);
    const itemsRaw = parseCSVFile(itemsPath);
    itemsCache = itemsRaw.map(row => ({
        visit_type: row.visit_type ? row.visit_type.trim() : 'ไม่ระบุประเภทผู้ป่วย',
        item_group: row.item_group ? row.item_group.trim() : 'ไม่ระบุกลุ่มบริการ',
        item_common_name: row.item_common_name ? row.item_common_name.trim() : 'ไม่ระบุรายการบริการ',
        total_quantity: parseInt(row.total_quantity) || 0,
        total_price: parseFloat(row.total_price) || 0,
        byear: parseInt(row.byear) || 0,
        year: parseInt(row.year) || 0,
        month: row.month ? row.month.toString().padStart(2, '0') : ''
    })).filter(row => row.byear > 0 && row.item_group !== '');
    console.log(`[${new Date().toISOString()}] Loaded ${itemsFilename}: ${itemsCache.length} rows`);

    // 4. Load OPD Summary Data
    const opdFilename = (config.data_files && config.data_files.opd) || 'opd_visit_summary.csv';
    const opdPath = path.join(__dirname, opdFilename);
    const opdRaw = parseCSVFile(opdPath);
    opdCache = opdRaw.map(row => ({
        byear: parseInt(row.byear) || 0,
        year_visit: parseInt(row.year_visit) || 0,
        month_visit: row.month_visit ? row.month_visit.toString().padStart(2, '0') : '',
        sex: row.sex ? row.sex.trim() : 'ไม่ระบุ',
        changwat: row.changwat ? row.changwat.trim() : 'ไม่ระบุ',
        amphur: row.amphur ? row.amphur.trim() : 'ไม่ระบุ',
        district: row.district ? row.district.trim() : 'ไม่ระบุ',
        ins_type: row.ins_type ? row.ins_type.trim() : 'ไม่ระบุ',
        diag_code: row.diag_code ? row.diag_code.trim() : 'ไม่ระบุ',
        diag_type: row.diag_type ? row.diag_type.trim() : 'ไม่ระบุ',
        visit_count: parseInt(row.visit_count) || 0,
        sum_age: parseInt(row.age) || 0   // CSV column is 'age' but internally we keep sum_age
    })).filter(row => row.byear > 0 && row.visit_count > 0);
	    console.log(`[${new Date().toISOString()}] Loaded ${opdFilename}: ${opdCache.length} rows`);

	    // 5. Load OPD Diag Summary Data
	    const diagFilename = 'opd_diag_summary.csv';
	    const diagPath = path.join(__dirname, diagFilename);
	    const diagRaw = parseCSVFile(diagPath);
	    opdDiagCache = diagRaw.map(row => ({
	        byear: parseInt(row.byear) || 0,
	        year_visit: parseInt(row.year_visit) || 0,
	        month_visit: row.month_visit ? row.month_visit.toString().padStart(2, '0') : '',
	        changwat: row.changwat ? row.changwat.trim() : 'ไม่ระบุ',
	        amphur: row.amphur ? row.amphur.trim() : 'ไม่ระบุ',
	        sex: row.sex ? row.sex.trim() : 'ไม่ระบุ',
	        diag_code: row.diag_code ? row.diag_code.trim() : 'ไม่ระบุ',
	        diag_type: row.diag_type ? row.diag_type.trim() : 'ไม่ระบุ',
	        visit_count: parseInt(row.visit_count) || 0
	    })).filter(row => row.byear > 0 && row.visit_count > 0);
		    console.log(`[${new Date().toISOString()}] Loaded ${diagFilename}: ${opdDiagCache.length} rows`);

		    // 6. Load OPD Location Summary Data
	    const locFilename = 'opd_location_summary.csv';
	    const locPath = path.join(__dirname, locFilename);
	    const locRaw = parseCSVFile(locPath);
	    opdLocCache = locRaw.map(row => ({
	        byear: parseInt(row.byear) || 0,
	        changwat: row.changwat ? row.changwat.trim() : 'ไม่ระบุ',
	        amphur: row.amphur ? row.amphur.trim() : 'ไม่ระบุ',
	        district: row.district ? row.district.trim() : 'ไม่ระบุ',
	        visit_count: parseInt(row.visit_count) || 0
	    })).filter(row => row.byear > 0 && row.visit_count > 0);
	    console.log(`[${new Date().toISOString()}] Loaded ${locFilename}: ${opdLocCache.length} rows`);

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[${new Date().toISOString()}] All data sources loaded into memory in ${duration}s`);
}

// Clear all CSV caches (force reload on next read)
function clearAllCaches() {
    cmiCache = [];
    transfersCache = [];
    itemsCache = [];
    opdCache = [];
    opdDiagCache = [];
    opdLocCache = [];
}

// Watch CSV files for changes & reload automatically
function startCSVWatcher() {
    const csvFiles = [
        'ipd_cmi.csv',
        'fundtransfer.csv',
        'items_summary_aggregated.csv',
        'opd_visit_summary.csv',
        'opd_diag_summary.csv',
        'opd_location_summary.csv'
    ];

    csvFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (!fs.existsSync(filePath)) return;

        fs.watchFile(filePath, { interval: 5000 }, (curr, prev) => {
            if (curr.mtimeMs !== prev.mtimeMs) {
                console.log(`[${new Date().toISOString()}] Detected change in ${file}, reloading...`);
                clearAllCaches();
                loadCSVDataSources();
            }
        });
    });
    console.log(`[${new Date().toISOString()}] CSV file watcher started (polling every 5s)`);
}

// Middleware to log requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Enable CORS for frontend running on other ports (e.g., port 8000)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve static web portal files from the current directory
app.use(express.static(path.join(__dirname, '.')));

// API: Get status of database connection
app.get('/api/status', (req, res) => {
    res.json({
        mode: currentMode,
        db_connected: currentMode === 'db',
        host: config.database ? config.database.host : null
    });
});

// API: Manual reload all CSV data
app.post('/api/reload', (req, res) => {
    console.log(`[${new Date().toISOString()}] Manual reload triggered by user.`);
    clearAllCaches();
    loadCSVDataSources();
    res.json({ success: true, message: 'CSV data reloaded successfully.' });
});

// API: Get CMI data
app.get('/api/cmi', async (req, res) => {
    if (currentMode === 'db') {
        try {
            const data = await queryDatabase('cmi');
            res.json(data);
            return;
        } catch (err) {
            console.error('Failed to fetch CMI from database, falling back to CSV:', err.message);
            switchToCSV('Query error: ' + err.message);
        }
    }
    res.json(cmiCache);
});

// API: Get NHSO Fund Transfer data
app.get('/api/transfers', async (req, res) => {
    if (currentMode === 'db') {
        try {
            const data = await queryDatabase('transfers');
            res.json(data);
            return;
        } catch (err) {
            console.error('Failed to fetch Transfers from database, falling back to CSV:', err.message);
            switchToCSV('Query error: ' + err.message);
        }
    }
    res.json(transfersCache);
});

// API: Get Items Summary data
app.get('/api/items', async (req, res) => {
    if (currentMode === 'db') {
        try {
            const data = await queryDatabase('items');
            res.json(data);
            return;
        } catch (err) {
            console.error('Failed to fetch Items from database, falling back to CSV:', err.message);
            switchToCSV('Query error: ' + err.message);
        }
    }
    res.json(itemsCache);
});

// API: Get OPD Summary data
app.get('/api/opd/summary', async (req, res) => {
    if (currentMode === 'db') {
        try {
            const data = await queryDatabase('opd');
            res.json(data);
            return;
        } catch (err) {
            console.error('Failed to fetch OPD summary from database, falling back to CSV:', err.message);
            switchToCSV('Query error: ' + err.message);
        }
    }
    res.json(opdCache);
});

// API: Get OPD Diag Summary data
app.get('/api/opd/diag-summary', async (req, res) => {
    res.json(opdDiagCache);
});

// API: Get OPD Location Summary data
app.get('/api/opd/locations', async (req, res) => {
    res.json(opdLocCache);
});

// Start Express server
app.listen(port, () => {
    console.log(`==================================================`);
    console.log(` Healthcare Portal Server running at:`);
    console.log(` http://localhost:${port}/index.html`);
    console.log(` Data Sources: PostgreSQL (Primary) / CSV (Fallback)`);
    console.log(`==================================================`);
    
    // Initialize Database and heartbeat monitor
    initializeDatabase();
    // Start CSV file watcher for auto-reload on file changes
    startCSVWatcher();
});
