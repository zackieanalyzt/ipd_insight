/**
 * Database Table to CSV Exporter (Column Filtered)
 * ==============================================
 * Exports large tables by streaming them using PostgreSQL cursors.
 * 
 * Usage (CLI):
 *   node export-db-to-csv.js fundtransfer
 *   node export-db-to-csv.js items_partitioned
 *   node export-db-to-csv.js opd_visit_partitioned
 *   node export-db-to-csv.js all
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load config
const configPath = path.join(__dirname, 'config.json');
let config = {};
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.error('Failed to load config.json:', e.message);
}

const pool = config.database ? new Pool(config.database) : null;

const EXPORT_CONFIGS = {
    fundtransfer: {
        table: 'fundtransfer',
        output: 'fundtransfer.csv',
        columns: [
            'no', 'transfer_date', 'date', 'month', 'year', 'batch_no', 
            'installment_number', 'account_code', 'sub_fund', 'amount', 
            'delay', 'deduction', 'contract_guarantee', 'tax', 'remain', 
            'amount_pending', 'transfer_amount', 'byear', 'main_fund'
        ]
    },
    items_partitioned: {
        table: 'items_summary_partitioned', 
        output: 'items_summary_partitioned.csv',
        columns: [
            'visit_type', 'item_common_name', 'item_group', 'byear', 
            'year', 'month', 'date', 'total_quantity', 'total_price', 'last_update'
        ]
    },
    opd_visit_partitioned: {
        table: 'opd_visit_partitioned',
        output: 'opd_visit_partitioned.csv',
        columns: [
            'vn', 'hn', 'age', 'sex', 'village', 'district', 'amphur', 'changwat',
            'diag_code', 'diag_type', 'year_visit', 'month_visit', 'date_visit',
            'visit_type', 'ovstist', 'pt_subtype', 'pt_priority', 'pt_walk',
            'department', 'refer_status', 'refer', 'ins_type', 'byear'
        ]
    }
};

function formatCSVValue(val) {
    if (val === null || val === undefined) return '';
    if (val instanceof Date) return val.toISOString();
    
    const str = String(val).trim();
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

async function exportTable(key) {
    const spec = EXPORT_CONFIGS[key];
    if (!spec) {
        console.error(`Invalid key: ${key}`);
        return;
    }

    if (!pool) {
        console.error('Database connection not configured in config.json');
        return;
    }

    console.log(`[${new Date().toISOString()}] Starting export: "${spec.table}" -> "${spec.output}"`);
    const start = Date.now();
    const outputPath = path.join(__dirname, spec.output);
    const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

    writeStream.write('\uFEFF'); // BOM for Excel
    writeStream.write(spec.columns.join(',') + '\n');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const cursorName = `cur_${key}`;
        const query = `DECLARE ${cursorName} NO SCROLL CURSOR FOR SELECT ${spec.columns.map(c => `"${c}"`).join(', ')} FROM ${spec.table}`;
        await client.query(query);

        let rowCount = 0;
        const fetchSize = 50000;
        let hasMore = true;

        while (hasMore) {
            const fetchRes = await client.query(`FETCH ${fetchSize} FROM ${cursorName}`);
            const rows = fetchRes.rows;
            
            if (rows.length === 0) {
                hasMore = false;
                break;
            }

            for (const row of rows) {
                const csvRow = spec.columns.map(col => formatCSVValue(row[col])).join(',') + '\n';
                writeStream.write(csvRow);
            }

            rowCount += rows.length;
        }

        await client.query('COMMIT');
        writeStream.end();

        await new Promise((resolve) => writeStream.on('finish', resolve));
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const fileSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
        console.log(`[${new Date().toISOString()}] Finished "${spec.table}": ${rowCount.toLocaleString()} rows, ${fileSize} MB in ${elapsed}s`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Failed to export ${key}:`, err.message);
        writeStream.end();
    } finally {
        client.release();
    }
}

async function exportAll() {
    for (const key of Object.keys(EXPORT_CONFIGS)) {
        await exportTable(key);
    }
}

// Support manual execution from CLI
if (require.main === module) {
    (async () => {
        const target = process.argv[2] || 'all';
        
        try {
            const client = await pool.connect();
            client.release();
        } catch (err) {
            console.error('Cannot connect to database:', err.message);
            process.exit(1);
        }

        if (target === 'all') {
            await exportAll();
        } else {
            let key = target;
            if (target === 'items_summary_partitioned') key = 'items_partitioned';
            await exportTable(key);
        }

        await pool.end();
    })();
}

module.exports = { exportAll, exportTable };
