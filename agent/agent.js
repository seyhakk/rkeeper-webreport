const { createClient } = require('@supabase/supabase-js');
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

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
const apiKey = config.apiKey;
const POLL_INTERVAL = (config.pollInterval || 3) * 1000;

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
  const claimRes = await fetch(`${config.supabaseUrl}/rest/v1/rpc/claim_job`, { method: 'POST' }).catch(() => null);
  if (!claimRes) {
    // Direct API fallback
    const claim = await fetch(`${config.apiUrl}/api/agent/${apiKey}/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.id })
    }).then(r => r.json()).catch(() => null);
    if (!claim) return;
    job = claim;
  }

  try {
    const query = QUERIES[job.report_id];
    if (!query) throw new Error(`Unknown report: ${job.report_id}`);

    const data = await runQuery(query, job.date_from, job.date_to);

    // Push result
    const pushRes = await fetch(`${config.apiUrl || config.supabaseUrl.replace('.supabase.co', '.vercel.app')}/api/agent/${apiKey}/push`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job.id, report_id: job.report_id,
        date_from: job.date_from, date_to: job.date_to,
        data: data, columns: null
      })
    });
    const result = await pushRes.json();
    console.log(`[${new Date().toISOString()}] Completed: ${job.report_id} - ${result.status}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error: ${job.report_id} - ${err.message}`);
    await fetch(`${config.apiUrl || config.supabaseUrl.replace('.supabase.co', '.vercel.app')}/api/agent/${apiKey}/push`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.id, report_id: job.report_id, error: err.message })
    });
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Agent started for restaurant API key: ${apiKey.slice(0,8)}...`);
  console.log(`Polling every ${POLL_INTERVAL/1000}s...`);

  // If --run-once, just test SQL connection
  if (process.argv.includes('--test')) {
    try {
      const pool = await sql.connect(sqlConfig);
      const result = await pool.request().query('SELECT COUNT(*) AS cnt FROM STAT_RK7_SHIFTS_OPERATION');
      console.log(`SQL OK: ${result.recordset[0].cnt} operation rows`);
      await pool.close();
    } catch (err) {
      console.error(`SQL ERROR: ${err.message}`);
    }
    process.exit(0);
  }

  // Continuous polling mode
  while (true) {
    try {
      const res = await fetch(`${config.apiUrl || config.supabaseUrl.replace('.supabase.co', '.vercel.app')}/api/agent/${apiKey}/jobs`);
      if (res.ok) {
        const jobs = await res.json();
        for (const job of jobs) {
          await processJob(job);
        }
      }
    } catch (err) {
      console.error(`Poll error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch(console.error);
