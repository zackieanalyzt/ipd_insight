const express = require('express');
const fs = require('fs');
const path = require('path');

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

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[${new Date().toISOString()}] All data sources loaded into memory in ${duration}s`);
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

// API: Get CMI data from CSV cache
app.get('/api/cmi', (req, res) => {
    res.json(cmiCache);
});

// API: Get NHSO Fund Transfer data from CSV cache
app.get('/api/transfers', (req, res) => {
    res.json(transfersCache);
});

// API: Get Items Summary data from CSV cache
app.get('/api/items', (req, res) => {
    res.json(itemsCache);
});

// Start Express server
app.listen(port, () => {
    console.log(`==================================================`);
    console.log(` Healthcare Portal Server running at:`);
    console.log(` http://localhost:${port}/index.html`);
    console.log(` Data Sources: CSV Files (Local In-Memory Cache)`);
    console.log(`==================================================`);
    
    // Load all data sources in memory on startup
    loadCSVDataSources();
});
