/**
 * OPD Data Aggregation Script
 * =============================
 * Reads opd_visit_partitioned.csv (3.65M rows, 1.2GB) via streaming
 * and generates 4 summary CSV files for the OPD dashboard.
 *
 * Usage: node generate-opd-summaries.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const INPUT_FILE = path.join(__dirname, 'opd_visit_partitioned.csv');

const OUTPUT_DIR = __dirname;

// In-memory aggregation stores
const diagMap = new Map();       // key → { byear, year_visit, month_visit, changwat, amphur, sex, diag_code, diag_type, visit_count }
const deptMap = new Map();       // key → { byear, year_visit, month_visit, changwat, amphur, sex, department, visit_count }
const ageMap = new Map();        // key → { byear, year_visit, month_visit, changwat, amphur, sex, age_group, visit_count }
const locMap = new Map();        // key → { byear, changwat, amphur, district, visit_count }

function getAgeGroup(age) {
    const a = parseInt(age, 10);
    if (isNaN(a)) return 'ไม่ระบุ';
    if (a <= 14) return '0-14 ปี';
    if (a <= 29) return '15-29 ปี';
    if (a <= 44) return '30-44 ปี';
    if (a <= 59) return '45-59 ปี';
    if (a <= 74) return '60-74 ปี';
    return '75+ ปี';
}

// Custom CSV parser for a single line (handles quoted fields)
function parseCSVLine(line) {
    const result = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cell += '"';
                i++;
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

function incrementMap(map, key, fields) {
    if (map.has(key)) {
        map.get(key).visit_count += 1;
    } else {
        map.set(key, { ...fields, visit_count: 1 });
    }
}

async function aggregate() {
    console.log(`[${new Date().toISOString()}] Starting aggregation from: ${INPUT_FILE}`);
    const start = Date.now();

    const fileStream = fs.createReadStream(INPUT_FILE, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let lineCount = 0;
    let headers = [];

    for await (const line of rl) {
        if (!line.trim()) continue;
        lineCount++;

        if (lineCount === 1) {
            headers = parseCSVLine(line);
            console.log(`Headers (${headers.length}):`, headers);
            continue;
        }

        const values = parseCSVLine(line);
        const row = {};
        for (let i = 0; i < headers.length; i++) {
            row[headers[i]] = values[i] !== undefined ? values[i].trim() : '';
        }

        const byear = row.byear || '';
        const year_visit = row.year_visit || '';
        const month_visit = (row.month_visit || '').padStart(2, '0');
        const changwat = row.changwat || 'ไม่ระบุ';
        const amphur = row.amphur || 'ไม่ระบุ';
        const district = row.district || 'ไม่ระบุ';
        const sex = row.sex || 'ไม่ระบุ';
        const diag_code = row.diag_code || 'ไม่ระบุ';
        const diag_type = row.diag_type || 'ไม่ระบุ';
        const department = row.department || 'ไม่ระบุ';
        const age = row.age || '0';
        const age_group = getAgeGroup(age);

        // 1. Diag Summary
        const diagKey = `${byear}|${year_visit}|${month_visit}|${changwat}|${amphur}|${sex}|${diag_code}|${diag_type}`;
        incrementMap(diagMap, diagKey, {
            byear, year_visit, month_visit, changwat, amphur, sex, diag_code, diag_type
        });

        // 2. Department Summary
        const deptKey = `${byear}|${year_visit}|${month_visit}|${changwat}|${amphur}|${sex}|${department}`;
        incrementMap(deptMap, deptKey, {
            byear, year_visit, month_visit, changwat, amphur, sex, department
        });

        // 3. Age Group Summary
        const ageKey = `${byear}|${year_visit}|${month_visit}|${changwat}|${amphur}|${sex}|${age_group}`;
        incrementMap(ageMap, ageKey, {
            byear, year_visit, month_visit, changwat, amphur, sex, age_group
        });

        // 4. Location Summary
        const locKey = `${byear}|${changwat}|${amphur}|${district}`;
        incrementMap(locMap, locKey, {
            byear, changwat, amphur, district
        });

        if (lineCount % 500000 === 0) {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            console.log(`[${new Date().toISOString()}] Processed ${lineCount.toLocaleString()} rows... (${elapsed}s)`);
        }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n[${new Date().toISOString()}] Finished reading ${lineCount.toLocaleString()} rows in ${elapsed}s`);
    console.log(`  Diag entries: ${diagMap.size.toLocaleString()}`);
    console.log(`  Dept entries: ${deptMap.size.toLocaleString()}`);
    console.log(`  Age entries:  ${ageMap.size.toLocaleString()}`);
    console.log(`  Loc entries:  ${locMap.size.toLocaleString()}`);

	    // Write output CSVs
	    await writeCSV('opd_diag_summary.csv', ['byear','year_visit','month_visit','changwat','amphur','sex','diag_code','diag_type','visit_count'], diagMap);
	    await writeCSV('opd_dept_summary.csv', ['byear','year_visit','month_visit','changwat','amphur','sex','department','visit_count'], deptMap);
	    await writeCSV('opd_age_summary.csv', ['byear','year_visit','month_visit','changwat','amphur','sex','age_group','visit_count'], ageMap);
	    await writeCSV('opd_location_summary.csv', ['byear','changwat','amphur','district','visit_count'], locMap);

    console.log(`\n[${new Date().toISOString()}] All summary files generated successfully!`);
    console.log(`Total time: ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function writeCSV(filename, columns, dataMap) {
    const filePath = path.join(OUTPUT_DIR, filename);
    
    return new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(filePath, { encoding: 'utf8' });
        
        // BOM + header
        ws.write('\uFEFF');
        ws.write(columns.join(',') + '\n');

        let rowCount = 0;
        for (const entry of dataMap.values()) {
            const row = columns.map(col => {
                const val = entry[col] !== undefined ? String(entry[col]) : '';
                // Quote if contains comma or quote
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    return '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            });
            ws.write(row.join(',') + '\n');
            rowCount++;
        }

        ws.on('finish', () => {
            try {
                const fileSize = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
                console.log(`  Wrote ${filename}: ${rowCount.toLocaleString()} rows, ${fileSize} MB`);
                resolve();
            } catch (err) {
                reject(err);
            }
        });
        ws.on('error', reject);
        
        ws.end();
    });
}

aggregate().catch(err => {
    console.error('Aggregation failed:', err);
    process.exit(1);
});
