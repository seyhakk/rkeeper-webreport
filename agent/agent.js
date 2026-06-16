const sql = require('mssql');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// In SEA .exe, __dirname is a temp dir. Always use the exe's folder.
const EXE_DIR = path.dirname(process.execPath);
const CONFIG_PATH = path.join(EXE_DIR, 'config.json');

async function runSetup() {
  console.log('\n=== R-Keeper Report Agent Setup ===\n');
  console.log('This wizard will create config.json for this restaurant PC.\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  function ask(q) { return new Promise(r => rl.question(q, r)); }
  const apiUrl = (await ask('Cloud URL [https://rkeeper-reports.vercel.app]: ')) || 'https://rkeeper-reports.vercel.app';
  const apiKey = await ask('API Key (from admin panel): ');
  if (!apiKey) { console.error('API Key is required.'); rl.close(); process.exit(1); }
  const server = (await ask('SQL Server [localhost\\SQLEXPRESS]: ')) || 'localhost\\SQLEXPRESS';
  const database = (await ask('Database [RKDEMO]: ')) || 'RKDEMO';
  const user = await ask('SQL Username: ');
  if (!user) { console.error('SQL Username is required.'); rl.close(); process.exit(1); }
  const password = await ask('SQL Password: ');
  if (!password) { console.error('SQL Password is required.'); rl.close(); process.exit(1); }
  const config = { apiUrl, apiKey, sql: { server, database, user, password, port: 1433 } };
  console.log('\nTesting SQL connection...');
  try {
    const pool = await sql.connect({ server, database, user, password, port: 1433, options: { encrypt: false, trustServerCertificate: true }, connectionTimeout: 10000 });
    const r = await pool.request().query('SELECT COUNT(*) AS cnt FROM STAT_RK7_SHIFTS_OPERATION');
    await pool.close();
    console.log('  SQL OK: ' + r.recordset[0].cnt + ' rows');
  } catch (e) {
    console.error('  SQL FAILED: ' + e.message);
    if ((await ask('Save config anyway? (y/N): ')).toLowerCase() !== 'y') { rl.close(); process.exit(1); }
  }
  console.log('Testing API connection...');
  try {
    const res = await fetch(apiUrl + '/api/agent/' + apiKey + '/jobs');
    if (res.ok) { const jobs = await res.json(); console.log('  API OK: ' + jobs.length + ' pending jobs'); }
    else {
      console.error('  API FAILED: ' + (res.status === 401 ? 'Invalid API key' : (await res.text()).slice(0,100)));
      if ((await ask('Save config anyway? (y/N): ')).toLowerCase() !== 'y') { rl.close(); process.exit(1); }
    }
  } catch (e) {
    console.error('  API FAILED: ' + e.message);
    if ((await ask('Save config anyway? (y/N): ')).toLowerCase() !== 'y') { rl.close(); process.exit(1); }
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('\n  Config saved to: ' + CONFIG_PATH);
  rl.close();
  return config;
}

function pause(msg) {
  // When double-clicked, show message before closing
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(msg || '\n  Press Enter to exit...', () => { rl.close(); r(); }));
}

async function getConfig() {
  if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const hasArgs = process.argv.length > 2; // running from cmd with flags
  console.log('');
  console.log('  config.json not found at:');
  console.log('  ' + CONFIG_PATH);
  console.log('');

  if (process.argv.includes('--setup')) {
    return await runSetup();
  }

  // If no command-line args, this was likely double-clicked — run setup directly
  if (!hasArgs) {
    console.log('  Launching setup wizard...');
    console.log('');
    return await runSetup();
  }

  console.error('  Create config.json next to Agent.exe, then run again.');
  await pause();
  process.exit(1);
}

//=========== MAIN ===========

async function main() {
  const config = await getConfig();
  const API_URL = config.apiUrl || 'https://rkeeper-reports.vercel.app';
  const API_KEY = config.apiKey;
  const POLL_MS = (config.pollInterval || 3) * 1000;
  const sqlConfig = {
    server: config.sql.server, database: config.sql.database, user: config.sql.user,
    password: config.sql.password, port: config.sql.port || 1433,
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 1, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 10000, requestTimeout: 60000
  };

  const QUERIES = {
    'dish-sale': 'SELECT CashServer, ReportCategory, Dish, SUM(Quantity) AS Quantity, CASE WHEN SUM(Quantity)>0 THEN ROUND(SUM(BaseAmount)/SUM(Quantity),2) ELSE 0 END AS AvgPrice, SUM(BaseAmount) AS Amount, 0 AS DiscountSum, ROUND(SUM(BaseAmount)*1.05,2) AS PaidAmount, 0 AS TaxSVC, ROUND(SUM(BaseAmount)*0.05,2) AS Surcharge5Pct FROM (SELECT o.MIDSERVERNAME+\':\'+CAST(o.MIDSRV AS VARCHAR) AS CashServer, ISNULL(cat.NAME,\'Uncategorized\') AS ReportCategory, o.DISHNAME AS Dish, o.QUANTITY AS Quantity, o.PAYSUM AS BaseAmount FROM STAT_RK7_SHIFTS_OPERATION o INNER JOIN MENUITEMS m ON o.DISHGUID=m.GUIDSTRING LEFT JOIN CATEGLIST cat ON m.PARENT=cat.SIFR WHERE o.DISHNAME<>\'\' AND o.QUANTITY>0 AND o.PAYSUM>0 AND CAST(o.SHIFTDATE AS DATE)>=@df AND CAST(o.SHIFTDATE AS DATE)<=@dt) t GROUP BY CashServer,ReportCategory,Dish ORDER BY CashServer,ReportCategory,Dish',
    'receipt': 'SELECT RESTAURANT AS Restaurant, CHECKNUM AS ReceiptNumber, CASE WHEN GUESTCOUNT>0 THEN GUESTCOUNT ELSE 1 END AS Quantity, CASE WHEN GUESTCOUNT>0 THEN ROUND((CASE WHEN DISCOUNTSUM=0 THEN PAIDSUM-TAXSUM ELSE PAIDSUM-DISCOUNTSUM END)/GUESTCOUNT,2) ELSE ROUND(CASE WHEN DISCOUNTSUM=0 THEN PAIDSUM-TAXSUM ELSE PAIDSUM-DISCOUNTSUM END,2) END AS AvgPrice, CASE WHEN DISCOUNTSUM=0 THEN PAIDSUM-TAXSUM ELSE PAIDSUM-DISCOUNTSUM END AS Amount, DISCOUNTSUM AS DiscountSum, PAIDSUM AS PaidAmount, TAXSUM AS Surcharge5Pct FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt AND CHECKNUM IS NOT NULL',
    'waiter-sales': 'SELECT WAITER AS Waiter, COUNT(*) AS NumChecks, SUM(BASICSUM) AS TotalSales, AVG(BASICSUM) AS AvgCheck, SUM(DISCOUNTSUM) AS DiscountTotal, SUM(TAXSUM) AS TaxTotal, SUM(GUESTCOUNT) AS GuestCount FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt AND WAITER IS NOT NULL AND WAITER<>\'\' GROUP BY WAITER ORDER BY TotalSales DESC',
    'hourly-sales': 'SELECT DATEPART(HOUR,CLOSEDATETIME) AS HourOfDay, COUNT(*) AS NumChecks, SUM(BASICSUM) AS TotalSales, AVG(BASICSUM) AS AvgCheck, SUM(DISCOUNTSUM) AS DiscountTotal, SUM(GUESTCOUNT) AS GuestCount FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(CLOSEDATETIME AS DATE)>=@df AND CAST(CLOSEDATETIME AS DATE)<=@dt AND CLOSEDATETIME IS NOT NULL GROUP BY DATEPART(HOUR,CLOSEDATETIME) ORDER BY HourOfDay',
    'top-dishes': 'SELECT ROW_NUMBER() OVER(ORDER BY SUM(BaseAmount) DESC) AS Rank, Category, Dish, SUM(Quantity) AS TotalQty, CASE WHEN SUM(Quantity)>0 THEN ROUND(SUM(BaseAmount)/SUM(Quantity),2) ELSE 0 END AS AvgPrice, SUM(BaseAmount) AS TotalAmount, ROUND(SUM(BaseAmount)*100.0/SUM(SUM(BaseAmount)) OVER(),2) AS Pct FROM (SELECT ISNULL(cat.NAME,\'Uncategorized\') AS Category, o.DISHNAME AS Dish, o.QUANTITY AS Quantity, o.PAYSUM AS BaseAmount FROM STAT_RK7_SHIFTS_OPERATION o INNER JOIN MENUITEMS m ON o.DISHGUID=m.GUIDSTRING LEFT JOIN CATEGLIST cat ON m.PARENT=cat.SIFR WHERE o.DISHNAME<>\'\' AND o.QUANTITY>0 AND o.PAYSUM>0 AND CAST(o.SHIFTDATE AS DATE)>=@df AND CAST(o.SHIFTDATE AS DATE)<=@dt) t GROUP BY Category,Dish ORDER BY Rank',
    'daily-summary': 'SELECT CAST(SHIFTDATE AS DATE) AS SaleDate, COUNT(*) AS TotalChecks, SUM(BASICSUM) AS TotalSales, SUM(TAXSUM) AS TaxTotal, SUM(DISCOUNTSUM) AS DiscountTotal, SUM(GUESTCOUNT) AS GuestCount FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt GROUP BY CAST(SHIFTDATE AS DATE) ORDER BY SaleDate DESC',
    'category-sales': 'SELECT Category, SUM(Quantity) AS TotalQty, CASE WHEN SUM(Quantity)>0 THEN ROUND(SUM(BaseAmount)/SUM(Quantity),2) ELSE 0 END AS AvgPrice, SUM(BaseAmount) AS TotalAmount, ROUND(SUM(BaseAmount)*1.05,2) AS PaidAmount, ROUND(SUM(BaseAmount)*0.05,2) AS Surcharge FROM (SELECT ISNULL(cat.NAME,\'Uncategorized\') AS Category, o.QUANTITY AS Quantity, o.PAYSUM AS BaseAmount FROM STAT_RK7_SHIFTS_OPERATION o INNER JOIN MENUITEMS m ON o.DISHGUID=m.GUIDSTRING LEFT JOIN CATEGLIST cat ON m.PARENT=cat.SIFR WHERE o.DISHNAME<>\'\' AND o.QUANTITY>0 AND o.PAYSUM>0 AND CAST(o.SHIFTDATE AS DATE)>=@df AND CAST(o.SHIFTDATE AS DATE)<=@dt) t GROUP BY Category ORDER BY TotalAmount DESC',
    'currency-sales': 'SELECT ch.RESTAURANT AS Restaurant, CAST(ch.SHIFTDATE AS DATE) AS SaleDate, ISNULL(ct.NAME,\'Unknown\') AS CurrencyType, ISNULL(c.NAME,\'Unknown\') AS Currency, COUNT(*) AS LineCount, ROUND(SUM(cl.BASICSUM),2) AS Amount, ROUND(SUM(cl.DISBALLANCE),2) AS DiscountSum, ROUND(SUM(cl.BASICSUM+cl.DISBALLANCE)*1.05,2) AS PaidAmount, ROUND(SUM(cl.BASICSUM+cl.DISBALLANCE)*0.05,2) AS Surcharge5Pct FROM CURRLINES cl INNER JOIN PRINTCHECKS pc ON cl.CHECKUNI=pc.UNI INNER JOIN STAT_RK7_SHIFTS_CHECKS ch ON pc.CHECKNUM=ch.CHECKNUM LEFT JOIN CURRENCIES c ON cl.SIFR=c.SIFR LEFT JOIN CURRENCYTYPES ct ON cl.IHIGHLEVELTYPE=ct.SIFR WHERE cl.BASICSUM IS NOT NULL AND CAST(ch.SHIFTDATE AS DATE)>=@df AND CAST(ch.SHIFTDATE AS DATE)<=@dt GROUP BY ch.RESTAURANT, CAST(ch.SHIFTDATE AS DATE), ct.NAME, c.NAME ORDER BY ch.RESTAURANT, SaleDate, ct.NAME, c.NAME',
    'guest-count': 'SELECT CAST(SHIFTDATE AS DATE) AS SaleDate, COUNT(*) AS TotalChecks, SUM(GUESTCOUNT) AS TotalGuests, SUM(BASICSUM) AS TotalSales, ROUND(AVG(CAST(GUESTCOUNT AS FLOAT)),2) AS AvgGuests, ROUND(SUM(BASICSUM)/NULLIF(SUM(GUESTCOUNT),0),2) AS SalesPerGuest FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt GROUP BY CAST(SHIFTDATE AS DATE) ORDER BY SaleDate DESC'
  };

  async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(API_URL + path, opts);
    if (!res.ok) throw new Error('API ' + res.status + ': ' + (await res.text().catch(() => '')));
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function runQuery(query, df, dt) {
    const pool = await sql.connect(sqlConfig);
    const request = pool.request();
    request.input('df', sql.Date, df);
    request.input('dt', sql.Date, dt);
    const result = await request.query(query);
    await pool.close();
    return result.recordset;
  }

  async function processJob(job) {
    console.log('[' + new Date().toISOString() + '] Running: ' + job.report_id + ' (' + job.date_from + ' to ' + job.date_to + ')');
    await api('POST', '/api/agent/' + API_KEY + '/claim', { job_id: job.id });
    try {
      const query = QUERIES[job.report_id];
      if (!query) throw new Error('Unknown report: ' + job.report_id);
      const data = await runQuery(query, job.date_from, job.date_to);
      console.log('  Fetched ' + data.length + ' rows');
      const result = await api('POST', '/api/agent/' + API_KEY + '/push', { job_id: job.id, report_id: job.report_id, date_from: job.date_from, date_to: job.date_to, data: data });
      console.log('  Completed: ' + result.status);
    } catch (err) {
      console.error('  Error: ' + err.message);
      await api('POST', '/api/agent/' + API_KEY + '/push', { job_id: job.id, report_id: job.report_id, error: err.message });
    }
  }

  console.log('\n=== R-Keeper Report Agent ===');
  console.log('API: ' + API_URL);
  console.log('Key: ' + API_KEY.slice(0,12) + '...');
  console.log('SQL: ' + config.sql.server + '\\' + config.sql.database);
  console.log('Poll: every ' + POLL_MS/1000 + 's\n');

  if (process.argv.includes('--once')) {
    console.log('Running once...');
    while (true) {
      const jobs = await api('GET', '/api/agent/' + API_KEY + '/jobs');
      if (!jobs || jobs.length === 0) { console.log('No pending jobs. Exiting.'); break; }
      for (const job of jobs) await processJob(job);
    }
    process.exit(0);
  }

  if (process.argv.includes('--test')) {
    try {
      const pool = await sql.connect(sqlConfig);
      const r = await pool.request().query('SELECT COUNT(*) AS cnt FROM STAT_RK7_SHIFTS_OPERATION');
      console.log('SQL OK: ' + r.recordset[0].cnt + ' rows');
      const j = await api('GET', '/api/agent/' + API_KEY + '/jobs');
      console.log('API OK: ' + j.length + ' pending jobs');
      await pool.close();
    } catch (err) { console.error('TEST FAILED: ' + err.message); }
    process.exit(0);
  }

  console.log('Waiting for jobs... (Ctrl+C to stop)');
  while (true) {
    try { const jobs = await api('GET', '/api/agent/' + API_KEY + '/jobs'); for (const job of jobs) await processJob(job); }
    catch (err) { /* idle */ }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

main().catch(function(err) {
  console.error('FATAL: ' + err.message);
  if (process.argv.length <= 2) { /* double-clicked */ const rl = readline.createInterface({input:process.stdin,output:process.stdout}); rl.question('\nPress Enter to exit...', () => { rl.close(); process.exit(1); }); }
  else process.exit(1);
});
