/**
 * Generate new opd_visit_summary.csv + age_group.csv
 * ==================================================
 * Reads opd_visit_partitioned.csv via streaming and aggregates by:
 *   byear, year_visit, month_visit, sex, changwat, amphur, district,
 *   ins_type, diag_code, diag_type
 *
 * Includes: visit_count (COUNT of rows), age (SUM of ages)
 *
 * Also creates age_group.csv mapping age → age_group for reference/join.
 *
 * Usage: node generate-opd-visit-summary.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const INPUT_FILE = path.join(__dirname, 'opd_visit_partitioned.csv');
const OUTPUT_DIR = __dirname;

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

async function main() {
    console.log(`[${new Date().toISOString()}] Starting...`);
    const start = Date.now();

    const fileStream = fs.createReadStream(INPUT_FILE, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    // Map for opd_visit_summary
    // key → { fields..., visit_count, age (sum) }
    const summaryMap = new Map();
    const seenAges = new Set();

    let lineCount = 0;
    let headers = [];

    for await (const line of rl) {
        if (!line.trim()) continue;
        lineCount++;

        if (lineCount === 1) {
            headers = parseCSVLine(line);
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
        const sex = row.sex || 'ไม่ระบุ';
        const changwat = row.changwat || 'ไม่ระบุ';
        const amphur = row.amphur || 'ไม่ระบุ';
        const district = row.district || 'ไม่ระบุ';
        const ins_type = row.ins_type || 'ไม่ระบุ';
        const diag_code = row.diag_code || 'ไม่ระบุ';
        const diag_type = row.diag_type || 'ไม่ระบุ';
        const ageVal = parseInt(row.age) || 0;

        // Key excludes age — age is aggregated as SUM
        const key = `${byear}|${year_visit}|${month_visit}|${sex}|${changwat}|${amphur}|${district}|${ins_type}|${diag_code}|${diag_type}`;

        if (summaryMap.has(key)) {
            const entry = summaryMap.get(key);
            entry.visit_count += 1;
            entry.age += ageVal;
        } else {
            summaryMap.set(key, {
                byear, year_visit, month_visit, sex, changwat, amphur, district,
                ins_type, diag_code, diag_type,
                visit_count: 1,
                age: ageVal
            });
        }

        seenAges.add(ageVal);

        if (lineCount % 500000 === 0) {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
            console.log(`  ${lineCount.toLocaleString()} rows... (${elapsed}s, ${mem} MB heap)`);
        }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n[${new Date().toISOString()}] Read ${lineCount.toLocaleString()} rows in ${elapsed}s`);
    console.log(`Summary entries: ${summaryMap.size.toLocaleString()}`);

    // ── Write opd_visit_summary.csv ──
    const sumPath = path.join(OUTPUT_DIR, 'opd_visit_summary.csv');
    const columns = ['byear','year_visit','month_visit','sex','changwat','amphur','district','ins_type','diag_code','diag_type','visit_count','age'];

    await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(sumPath, { encoding: 'utf8' });
        ws.write('\uFEFF');
        ws.write(columns.join(',') + '\n');

        let rowCount = 0;
        for (const entry of summaryMap.values()) {
            const row = columns.map(col => {
                const val = String(entry[col] ?? '');
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    return '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            });
            ws.write(row.join(',') + '\n');
            rowCount++;
        }

        ws.on('finish', () => {
            const size = (fs.statSync(sumPath).size / 1024 / 1024).toFixed(2);
            console.log(`Wrote opd_visit_summary.csv: ${rowCount.toLocaleString()} rows, ${size} MB`);
            resolve();
        });
        ws.on('error', reject);
        ws.end();
    });

    // ── Write age_group.csv ──
    const ages = [...seenAges].filter(a => !isNaN(a)).sort((a, b) => a - b);
    const agePath = path.join(OUTPUT_DIR, 'age_group.csv');

    await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(agePath, { encoding: 'utf8' });
        ws.write('\uFEFF');
        ws.write('age,age_group\n');

        ages.forEach(age => {
            const group = getAgeGroup(age);
            ws.write(`${age},${group}\n`);
        });

        ws.on('finish', () => {
            const size = (fs.statSync(agePath).size / 1024 / 1024).toFixed(2);
            console.log(`Wrote age_group.csv: ${ages.length} rows, ${size} MB`);
            const groups = [...new Set(ages.map(a => getAgeGroup(a)))].join(', ');
            console.log(`  Age groups: ${groups}`);
            resolve();
        });
        ws.on('error', reject);
        ws.end();
    });

    const totalTime = ((Date.now() - start) / 1000).toFixed(1);
    const memEnd = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    console.log(`\n[${new Date().toISOString()}] Done! Total time: ${totalTime}s (final heap: ${memEnd} MB)`);
}

main().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
