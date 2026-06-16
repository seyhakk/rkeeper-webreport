const sql = require('mssql');
const path = require('path');
const fs = require('fs');

// Load config
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('config.json not found. Create it next to Agent.exe');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const API_URL = config.apiUrl || 'https://rkeeper-reports.vercel.app';
const API_KEY = config.apiKey;
const POLL_MS = (config.pollInterval || 3) * 1000;

const sqlConfig = {
  server: config.sql.server,
  database: config.sql.database,
  user: config.sql.user,
  password: config.sql.password,
  port: config.sql.port || 1433,
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 1, min: 0, idleTimeoutMillis: 30000 },
  connectionTimeout: 10000,
  requestTimeout: 60000
};

const QUERIES = {
  'dish-sale': `SELECT CashServer, ReportCategory, Dish, SUM(Quantity) AS Quantity, CASE WHEN SUM(Quantity)>0 THEN ROUND(SUM(BaseAmount)/SUM(Quantity),2) ELSE 0 END AS AvgPrice, SUM(BaseAmount) AS Amount, 0 AS DiscountSum, ROUND(SUM(BaseAmount)*1.05,2) AS PaidAmount, 0 AS TaxSVC, ROUND(SUM(BaseAmount)*0.05,2) AS Surcharge5Pct FROM (SELECT o.MIDSERVERNAME+':'+CAST(o.MIDSRV AS VARCHAR) AS CashServer, ISNULL(cat.NAME,'Uncategorized') AS ReportCategory, o.DISHNAME AS Dish, o.QUANTITY AS Quantity, o.PAYSUM AS BaseAmount FROM STAT_RK7_SHIFTS_OPERATION o INNER JOIN MENUITEMS m ON o.DISHGUID=m.GUIDSTRING LEFT JOIN CATEGLIST cat ON m.PARENT=cat.SIFR WHERE o.DISHNAME<>'' AND o.QUANTITY>0 AND o.PAYSUM>0 AND CAST(o.SHIFTDATE AS DATE)>=@df AND CAST(o.SHIFTDATE AS DATE)<=@dt) t GROUP BY CashServer,ReportCategory,Dish ORDER BY CashServer,ReportCategory,Dish`,
  'receipt': `SELECT RESTAURANT AS Restaurant, CHECKNUM AS ReceiptNumber, CASE WHEN GUESTCOUNT>0 THEN GUESTCOUNT ELSE 1 END AS Quantity, CASE WHEN GUESTCOUNT>0 THEN ROUND((CASE WHEN DISCOUNTSUM=0 THEN PAIDSUM-TAXSUM ELSE PAIDSUM-DISCOUNTSUM END)/GUESTCOUNT,2) ELSE ROUND(CASE WHEN DISCOUNTSUM=0 THEN PAIDSUM-TAXSUM ELSE PAIDSUM-DISCOUNTSUM END,2) END AS AvgPrice, CASE WHEN DISCOUNTSUM=0 THEN PAIDSUM-TAXSUM ELSE PAIDSUM-DISCOUNTSUM END AS Amount, DISCOUNTSUM AS DiscountSum, PAIDSUM AS PaidAmount, TAXSUM AS Surcharge5Pct FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt AND CHECKNUM IS NOT NULL`,
  'waiter-sales': `SELECT WAITER AS Waiter, COUNT(*) AS NumChecks, SUM(BASICSUM) AS TotalSales, AVG(BASICSUM) AS AvgCheck, SUM(DISCOUNTSUM) AS DiscountTotal, SUM(TAXSUM) AS TaxTotal, SUM(GUESTCOUNT) AS GuestCount FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt AND WAITER IS NOT NULL AND WAITER<>'' GROUP BY WAITER ORDER BY TotalSales DESC`,
  'hourly-sales': `SELECT DATEPART(HOUR,CLOSEDATETIME) AS HourOfDay, COUNT(*) AS NumChecks, SUM(BASICSUM) AS TotalSales, AVG(BASICSUM) AS AvgCheck, SUM(DISCOUNTSUM) AS DiscountTotal, SUM(GUESTCOUNT) AS GuestCount FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(CLOSEDATETIME AS DATE)>=@df AND CAST(CLOSEDATETIME AS DATE)<=@dt AND CLOSEDATETIME IS NOT NULL GROUP BY DATEPART(HOUR,CLOSEDATETIME) ORDER BY HourOfDay`,
  'top-dishes': `SELECT ROW_NUMBER() OVER(ORDER BY SUM(BaseAmount) DESC) AS Rank, Category, Dish, SUM(Quantity) AS TotalQty, CASE WHEN SUM(Quantity)>0 THEN ROUND(SUM(BaseAmount)/SUM(Quantity),2) ELSE 0 END AS AvgPrice, SUM(BaseAmount) AS TotalAmount, ROUND(SUM(BaseAmount)*100.0/SUM(SUM(BaseAmount)) OVER(),2) AS Pct FROM (SELECT ISNULL(cat.NAME,'Uncategorized') AS Category, o.DISHNAME AS Dish, o.QUANTITY AS Quantity, o.PAYSUM AS BaseAmount FROM STAT_RK7_SHIFTS_OPERATION o INNER JOIN MENUITEMS m ON o.DISHGUID=m.GUIDSTRING LEFT JOIN CATEGLIST cat ON m.PARENT=cat.SIFR WHERE o.DISHNAME<>'' AND o.QUANTITY>0 AND o.PAYSUM>0 AND CAST(o.SHIFTDATE AS DATE)>=@df AND CAST(o.SHIFTDATE AS DATE)<=@dt) t GROUP BY Category,Dish ORDER BY Rank`,
  'daily-summary': `SELECT CAST(SHIFTDATE AS DATE) AS SaleDate, COUNT(*) AS TotalChecks, SUM(BASICSUM) AS TotalSales, SUM(TAXSUM) AS TaxTotal, SUM(DISCOUNTSUM) AS DiscountTotal, SUM(GUESTCOUNT) AS GuestCount FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt GROUP BY CAST(SHIFTDATE AS DATE) ORDER BY SaleDate DESC`,
  'category-sales': `SELECT Category, SUM(Quantity) AS TotalQty, CASE WHEN SUM(Quantity)>0 THEN ROUND(SUM(BaseAmount)/SUM(Quantity),2) ELSE 0 END AS AvgPrice, SUM(BaseAmount) AS TotalAmount, ROUND(SUM(BaseAmount)*1.05,2) AS PaidAmount, ROUND(SUM(BaseAmount)*0.05,2) AS Surcharge FROM (SELECT ISNULL(cat.NAME,'Uncategorized') AS Category, o.QUANTITY AS Quantity, o.PAYSUM AS BaseAmount FROM STAT_RK7_SHIFTS_OPERATION o INNER JOIN MENUITEMS m ON o.DISHGUID=m.GUIDSTRING LEFT JOIN CATEGLIST cat ON m.PARENT=cat.SIFR WHERE o.DISHNAME<>'' AND o.QUANTITY>0 AND o.PAYSUM>0 AND CAST(o.SHIFTDATE AS DATE)>=@df AND CAST(o.SHIFTDATE AS DATE)<=@dt) t GROUP BY Category ORDER BY TotalAmount DESC`,
  'currency-sales': `SELECT ch.RESTAURANT AS Restaurant, CAST(ch.SHIFTDATE AS DATE) AS SaleDate, ISNULL(ct.NAME,'Unknown') AS CurrencyType, ISNULL(c.NAME,'Unknown') AS Currency, COUNT(*) AS LineCount, ROUND(SUM(cl.BASICSUM),2) AS Amount, ROUND(SUM(cl.DISBALLANCE),2) AS DiscountSum, ROUND(SUM(cl.BASICSUM+cl.DISBALLANCE)*1.05,2) AS PaidAmount, ROUND(SUM(cl.BASICSUM+cl.DISBALLANCE)*0.05,2) AS Surcharge5Pct FROM CURRLINES cl INNER JOIN PRINTCHECKS pc ON cl.CHECKUNI=pc.UNI INNER JOIN STAT_RK7_SHIFTS_CHECKS ch ON pc.CHECKNUM=ch.CHECKNUM LEFT JOIN CURRENCIES c ON cl.SIFR=c.SIFR LEFT JOIN CURRENCYTYPES ct ON cl.IHIGHLEVELTYPE=ct.SIFR WHERE cl.BASICSUM IS NOT NULL AND CAST(ch.SHIFTDATE AS DATE)>=@df AND CAST(ch.SHIFTDATE AS DATE)<=@dt GROUP BY ch.RESTAURANT, CAST(ch.SHIFTDATE AS DATE), ct.NAME, c.NAME ORDER BY ch.RESTAURANT, SaleDate, ct.NAME, c.NAME`,
  'guest-count': `SELECT CAST(SHIFTDATE AS DATE) AS SaleDate, COUNT(*) AS TotalChecks, SUM(GUESTCOUNT) AS TotalGuests, SUM(BASICSUM) AS TotalSales, ROUND(AVG(CAST(GUESTCOUNT AS FLOAT)),2) AS AvgGuests, ROUND(SUM(BASICSUM)/NULLIF(SUM(GUESTCOUNT),0),2) AS SalesPerGuest FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt GROUP BY CAST(SHIFTDATE AS DATE) ORDER BY SaleDate DESC`
};

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(API_URL + path, opts);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`);
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
  console.log(`[${new Date().toISOString()}] Running: ${job.report_id} (${job.date_from} to ${job.date_to})`);

  // Claim the job
  await api('POST', `/api/agent/${API_KEY}/claim`, { job_id: job.id });

  try {
    const query = QUERIES[job.report_id];
    if (!query) throw new Error(`Unknown report: ${job.report_id}`);

    const data = await runQuery(query, job.date_from, job.date_to);
    console.log(`  Fetched ${data.length} rows from SQL`);

    // Push result
    const result = await api('POST', `/api/agent/${API_KEY}/push`, {
      job_id: job.id, report_id: job.report_id,
      date_from: job.date_from, date_to: job.date_to,
      data: data
    });
    console.log(`  Completed: ${result.status}`);
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    await api('POST', `/api/agent/${API_KEY}/push`, {
      job_id: job.id, report_id: job.report_id, error: err.message
    });
  }
}

async function main() {
  console.log(`\n=== R-Keeper Report Agent ===`);
  console.log(`API: ${API_URL}`);
  console.log(`Key: ${API_KEY.slice(0,12)}...`);
  console.log(`SQL: ${config.sql.server}\\${config.sql.database}`);
  console.log(`Poll: every ${POLL_MS/1000}s\n`);

  // Run-once mode
  if (process.argv.includes('--once')) {
    console.log('Running once (polling disabled)...');
    while (true) {
      const jobs = await api('GET', `/api/agent/${API_KEY}/jobs`);
      if (!jobs || jobs.length === 0) { console.log('No pending jobs. Exiting.'); break; }
      for (const job of jobs) await processJob(job);
    }
    process.exit(0);
  }

  // Test mode
  if (process.argv.includes('--test')) {
    try {
      const pool = await sql.connect(sqlConfig);
      const result = await pool.request().query('SELECT COUNT(*) AS cnt FROM STAT_RK7_SHIFTS_OPERATION');
      console.log(`SQL OK: ${result.recordset[0].cnt} operation rows`);
      const apiTest = await api('GET', `/api/agent/${API_KEY}/jobs`);
      console.log(`API OK: ${apiTest.length} pending jobs`);
      await pool.close();
    } catch (err) { console.error(`TEST FAILED: ${err.message}`); }
    process.exit(0);
  }

  // Continuous polling mode
  console.log('Waiting for jobs... (Ctrl+C to stop)');
  while (true) {
    try {
      const jobs = await api('GET', `/api/agent/${API_KEY}/jobs`);
      for (const job of jobs) await processJob(job);
    } catch (err) { /* poll errors are normal when idle */ }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
