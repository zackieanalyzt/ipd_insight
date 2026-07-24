/**
 * Database Table to CSV Exporter (Incremental & Full Sync)
 * =======================================================
 * Supports Incremental Sync (Delta Load) by reading the last record 
 * from the existing CSV file on the host machine and querying 
 * PostgreSQL only for newer records.
 * 
 * Configs:
 * - cmi: full sync (small table)
 * - fundtransfer: incremental via "no" (integer ID)
 * - items_partitioned: incremental via "last_update" (timestamp)
 * - opd_visit_partitioned: incremental via "vn" (sequential visit number)
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
    cmi: {
        table: 'ipd_cmi',
        output: 'ipd_cmi.csv',
        // Full Sync: no keyColumn or keyIndex specified
        columns: [
            'insure_group', 'insure_desc', 'mdc', 'mdc_desc', 'total', 
            'sum_adjrw', 'average_adjrw', 'surgery_total', 'surgery_sum_adjrw', 
            'med_total', 'med_sum_adjrw', 'byear', 'year', 'month'
        ]
    },
    fundtransfer: {
        table: 'fundtransfer',
        output: 'fundtransfer.csv',
        keyColumn: 'no',
        keyIndex: 0,
        isNumeric: true,
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
        keyColumn: 'last_update',
        keyIndex: 9,
        isNumeric: false,
        columns: [
            'visit_type', 'item_common_name', 'item_group', 'byear', 
            'year', 'month', 'date', 'total_quantity', 'total_price', 'last_update'
        ]
    },
    opd_visit_partitioned: {
        table: 'opd_visit_partitioned',
        output: 'opd_visit_partitioned.csv',
        keyColumn: 'vn',
        keyIndex: 0,
        isNumeric: false,
        columns: [
            'vn', 'hn', 'age', 'sex', 'village', 'district', 'amphur', 'changwat',
            'diag_code', 'diag_type', 'year_visit', 'month_visit', 'date_visit',
            'visit_type', 'ovstist', 'pt_subtype', 'pt_priority', 'pt_walk',
            'department', 'refer_status', 'refer', 'ins_type', 'byear'
        ]
    }
};

/**
 * Read the last line of a file efficiently without loading it entirely into memory.
 * Returns the key value of the specified index.
 */
function getLastRowKey(filePath, keyIndex, isNumeric) {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return null;

    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        // Read the last 8KB of the file
        const bufferSize = Math.min(stat.size, 8192);
        const buffer = Buffer.alloc(bufferSize);
        fs.readSync(fd, buffer, 0, bufferSize, stat.size - bufferSize);
        fs.closeSync(fd);

        const str = buffer.toString('utf8');
        const lines = str.trim().split(/\r?\n/);

        // Loop backwards to find the last valid data line (skipping header if any)
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line && !line.includes('visit_type') && !line.includes('transfer_date') && !line.includes('vn,hn') && !line.includes('insure_group')) {
                const cols = line.split(',');
                if (cols[keyIndex]) {
                    const rawVal = cols[keyIndex].replace(/"/g, '').trim();
                    if (rawVal) {
                        if (isNumeric) {
                            const num = Number(rawVal);
                            if (!isNaN(num)) return num;
                        } else {
                            return rawVal;
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error(`Error reading last row of ${filePath}:`, err.message);
        if (fd) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
    return null;
}

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

    const outputPath = path.join(__dirname, spec.output);
    
    // Check if we can perform an incremental export
    const hasKey = spec.keyColumn !== undefined;
    const lastKey = hasKey ? getLastRowKey(outputPath, spec.keyIndex, spec.isNumeric) : null;
    const isIncremental = lastKey !== null;

    if (isIncremental) {
        console.log(`[${new Date().toISOString()}] Incremental sync active for "${spec.table}". Last key "${spec.keyColumn}": ${lastKey}`);
    } else {
        console.log(`[${new Date().toISOString()}] Full sync active for "${spec.table}"`);
    }

    const start = Date.now();
    const writeStream = fs.createWriteStream(outputPath, { 
        flags: isIncremental ? 'a' : 'w', 
        encoding: 'utf8' 
    });

    if (!isIncremental) {
        writeStream.write('\uFEFF'); // BOM for Excel
        writeStream.write(spec.columns.join(',') + '\n');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const cursorName = `cur_${key}`;
        let query = `DECLARE ${cursorName} NO SCROLL CURSOR FOR SELECT ${spec.columns.map(c => `"${c}"`).join(', ')} FROM ${spec.table}`;
        
        if (isIncremental) {
            query += ` WHERE "${spec.keyColumn}" > $1 ORDER BY "${spec.keyColumn}" ASC`;
        } else {
            if (spec.keyColumn) {
                query += ` ORDER BY "${spec.keyColumn}" ASC`;
            }
        }
        
        await client.query(query, isIncremental ? [lastKey] : []);

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
        
        if (isIncremental) {
            console.log(`[${new Date().toISOString()}] Incremental finished for "${spec.table}": Appended ${rowCount.toLocaleString()} new rows. Current size: ${fileSize} MB in ${elapsed}s`);
        } else {
            console.log(`[${new Date().toISOString()}] Full finished for "${spec.table}": Written ${rowCount.toLocaleString()} rows, ${fileSize} MB in ${elapsed}s`);
        }

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
