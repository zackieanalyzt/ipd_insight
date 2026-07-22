const fs = require('fs');
const path = require('path');
const readline = require('readline');

const INPUT_FILE = path.join(__dirname, 'items_summary_partitioned.csv');
const OUTPUT_FILE = path.join(__dirname, 'items_summary_aggregated.csv');

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

async function main() {
    console.log(`[${new Date().toISOString()}] Starting items summary aggregation...`);
    const start = Date.now();

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`Input file not found: ${INPUT_FILE}`);
        process.exit(1);
    }

    const fileStream = fs.createReadStream(INPUT_FILE, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const aggMap = new Map();
    let lineCount = 0;
    let headers = [];

    for await (const line of rl) {
        if (!line.trim()) continue;
        lineCount++;

        if (lineCount === 1) {
            headers = parseCSVLine(line).map(h => h.replace(/^"|"$/g, '').trim());
            console.log('Headers:', headers);
            continue;
        }

        const values = parseCSVLine(line);
        const row = {};
        for (let i = 0; i < headers.length; i++) {
            const val = values[i] !== undefined ? values[i].trim() : '';
            row[headers[i]] = val.replace(/^"|"$/g, '').trim();
        }

        const visit_type = row.visit_type || 'ไม่ระบุ';
        const item_group = row.item_group || 'ไม่ระบุ';
        const item_common_name = row.item_common_name || 'ไม่ระบุ';
        const byear = row.byear || '';
        const year = row.year || '';
        const month = row.month || '';
        
        const qty = parseInt(row.total_quantity, 10) || 0;
        const price = parseFloat(row.total_price) || 0;

        const key = `${visit_type}|${item_group}|${item_common_name}|${byear}|${year}|${month}`;

        if (aggMap.has(key)) {
            const entry = aggMap.get(key);
            entry.total_quantity += qty;
            entry.total_price += price;
        } else {
            aggMap.set(key, {
                visit_type,
                item_group,
                item_common_name,
                byear,
                year,
                month,
                total_quantity: qty,
                total_price: price
            });
        }

        if (lineCount % 200000 === 0) {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            console.log(`  Processed ${lineCount.toLocaleString()} rows... (${elapsed}s)`);
        }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nRead ${lineCount.toLocaleString()} rows in ${elapsed}s`);
    console.log(`Aggregated entries: ${aggMap.size.toLocaleString()}`);

    // Write to items_summary_aggregated.csv
    const columns = ['visit_type', 'item_group', 'item_common_name', 'byear', 'year', 'month', 'total_quantity', 'total_price'];

    await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(OUTPUT_FILE, { encoding: 'utf8' });
        ws.write('\uFEFF'); // BOM
        ws.write(columns.join(',') + '\n');

        let rowCount = 0;
        for (const entry of aggMap.values()) {
            const row = columns.map(col => {
                let val = entry[col];
                if (col === 'total_price') {
                    // Check if it's an integer to append .0, otherwise keep decimal representation
                    val = Number.isInteger(val) ? val.toFixed(1) : String(val);
                } else {
                    val = String(val ?? '');
                }
                
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    return '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            });
            ws.write(row.join(',') + '\n');
            rowCount++;
        }

        ws.on('finish', () => {
            const size = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2);
            console.log(`Wrote items_summary_aggregated.csv: ${rowCount.toLocaleString()} rows, ${size} MB`);
            resolve();
        });
        ws.on('error', reject);
        ws.end();
    });

    const totalTime = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Done! Total time: ${totalTime}s`);
}

main().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
