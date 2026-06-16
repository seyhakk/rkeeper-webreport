const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ============ REPORT DEFINITIONS ============

const reports = [
  { id: 'dish-sale', name: 'Dish Sale Report', description: 'Dish sales by server and category', icon: 'bi bi-cup-hot text-danger', template: 'dish-report' },
  { id: 'receipt', name: 'Receipt Number Report', description: 'Sales by receipt/check number', icon: 'bi bi-receipt text-warning', template: 'receipt-report' },
  { id: 'waiter-sales', name: 'Sales by Waiter', description: 'Performance by waiter', icon: 'bi bi-person-check text-info', template: 'generic-report' },
  { id: 'hourly-sales', name: 'Hourly Sales Analysis', description: 'Sales by hour of day', icon: 'bi bi-clock-history text-success', template: 'generic-report' },
  { id: 'top-dishes', name: 'Top Selling Dishes', description: 'Dishes ranked by sales', icon: 'bi bi-trophy text-warning', template: 'generic-report' },
  { id: 'daily-summary', name: 'Daily Sales Summary', description: 'Day-by-day sales totals', icon: 'bi bi-calendar-check text-primary', template: 'generic-report' },
  { id: 'category-sales', name: 'Sales by Category', description: 'Sales by menu category', icon: 'bi bi-diagram-3 text-success', template: 'generic-report' },
  { id: 'currency-sales', name: 'Sales by Currency', description: 'Sales by payment type and currency', icon: 'bi bi-currency-exchange text-info', template: 'currency-report' },
  { id: 'guest-count', name: 'Guest Count Report', description: 'Daily guest statistics', icon: 'bi bi-people text-info', template: 'generic-report' }
];

const reportTemplates = {
  'dish-sale': { template: 'dish-report', columns: null, filters: null },
  'receipt': { template: 'receipt-report', columns: null, filters: null },
  'currency-sales': { template: 'currency-report', columns: null, filters: null },
  'waiter-sales': { template: 'generic-report',
    columns: [
      { key:'Waiter', label:'Waiter', style:'iscs1', dataStyle:'iscs2', type:'text' },
      { key:'NumChecks', label:'Checks', style:'iscs6', dataStyle:'iscs3', type:'int' },
      { key:'TotalSales', label:'Total Sales', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'AvgCheck', label:'Avg Check', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'DiscountTotal', label:'Discount', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'TaxTotal', label:'Tax/SVC', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'GuestCount', label:'Guests', style:'iscs6', dataStyle:'iscs3', type:'int' }
    ],
    filters: [] },
  'hourly-sales': { template: 'generic-report',
    columns: [
      { key:'HourOfDay', label:'Hour', style:'iscs1', dataStyle:'iscs2', type:'hour' },
      { key:'NumChecks', label:'Checks', style:'iscs6', dataStyle:'iscs3', type:'int' },
      { key:'TotalSales', label:'Total Sales', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'AvgCheck', label:'Avg Check', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'DiscountTotal', label:'Discount', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'GuestCount', label:'Guests', style:'iscs6', dataStyle:'iscs3', type:'int' }
    ],
    filters: [] },
  'top-dishes': { template: 'generic-report',
    columns: [
      { key:'Rank', label:'#', style:'iscs1', dataStyle:'iscs3', type:'int' },
      { key:'Category', label:'Category', style:'iscs1', dataStyle:'iscs2', type:'text' },
      { key:'Dish', label:'Dish', style:'iscs1', dataStyle:'iscs2', type:'text' },
      { key:'TotalQty', label:'Quantity', style:'iscs6', dataStyle:'iscs3', type:'int' },
      { key:'AvgPrice', label:'Avg Price', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'TotalAmount', label:'Total Amount', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'Pct', label:'% of Total', style:'iscs6', dataStyle:'iscs3', type:'pct', grandTotal:'100.00' }
    ],
    filters: [] },
  'daily-summary': { template: 'generic-report',
    columns: [
      { key:'SaleDate', label:'Date', style:'iscs1', dataStyle:'iscs2', type:'date' },
      { key:'TotalChecks', label:'Checks', style:'iscs6', dataStyle:'iscs3', type:'int' },
      { key:'TotalSales', label:'Total Sales', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'TaxTotal', label:'Tax/SVC', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'DiscountTotal', label:'Discount', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'GuestCount', label:'Guests', style:'iscs6', dataStyle:'iscs3', type:'int' }
    ],
    filters: [] },
  'category-sales': { template: 'generic-report',
    columns: [
      { key:'Category', label:'Category', style:'iscs1', dataStyle:'iscs2', type:'text' },
      { key:'TotalQty', label:'Quantity', style:'iscs6', dataStyle:'iscs3', type:'decimal3' },
      { key:'AvgPrice', label:'Avg Price', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'TotalAmount', label:'Total Amount', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'PaidAmount', label:'Paid Amount', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'Surcharge', label:'Surcharge 5%', style:'iscs6', dataStyle:'iscs3', type:'money' }
    ],
    filters: [] },
  'guest-count': { template: 'generic-report',
    columns: [
      { key:'SaleDate', label:'Date', style:'iscs1', dataStyle:'iscs2', type:'date' },
      { key:'TotalChecks', label:'Checks', style:'iscs6', dataStyle:'iscs3', type:'int' },
      { key:'TotalGuests', label:'Total Guests', style:'iscs6', dataStyle:'iscs3', type:'int' },
      { key:'TotalSales', label:'Total Sales', style:'iscs6', dataStyle:'iscs3', type:'money' },
      { key:'AvgGuests', label:'Avg Guests/Check', style:'iscs6', dataStyle:'iscs3', type:'avg', formula:{num:'TotalGuests',den:'TotalChecks'} },
      { key:'SalesPerGuest', label:'Sales/Guest', style:'iscs6', dataStyle:'iscs3', type:'avg', formula:{num:'TotalSales',den:'TotalGuests'} }
    ],
    filters: [] }
};

// ============ MIDDLEWARE ============

async function getRestaurant(slug) {
  const { data, error } = await supabase.from('restaurants').select('*').eq('slug', slug).single();
  if (error || !data) return null;
  return data;
}

// ============ ROUTES ============

app.get('/', (req, res) => res.redirect('/r'));

app.get('/r', async (req, res) => {
  const { data: restaurants } = await supabase.from('restaurants').select('*').order('name');
  res.render('index', { title: 'R-Keeper Reports', reports: reports, restaurants: restaurants || [] });
});

app.get('/r/:slug', async (req, res) => {
  const restaurant = await getRestaurant(req.params.slug);
  if (!restaurant) return res.status(404).send('Restaurant not found');
  res.render('index', { title: restaurant.name + ' - Reports', reports: reports, restaurants: null });
});

app.get('/r/:slug/:reportId', async (req, res) => {
  const restaurant = await getRestaurant(req.params.slug);
  if (!restaurant) return res.status(404).send('Restaurant not found');

  const report = reports.find(r => r.id === req.params.reportId);
  if (!report) return res.status(404).send('Report not found');

  const config = reportTemplates[report.id];
  res.render(config.template, {
    title: restaurant.name + ' - ' + report.name,
    report: { id: report.id, name: report.name, description: report.description, icon: report.icon, groupBy: config.groupBy },
    data: null, error: null, params: null,
    columns: config.columns, filters: config.filters || [], filterOpts: null
  });
});

// POST: user clicks Run → create sync job
app.post('/r/:slug/:reportId', async (req, res) => {
  const restaurant = await getRestaurant(req.params.slug);
  if (!restaurant) return res.status(404).send('Restaurant not found');

  const report = reports.find(r => r.id === req.params.reportId);
  if (!report) return res.status(404).send('Report not found');

  const dateFrom = req.body.DateFrom || new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const dateTo = req.body.DateTo || new Date().toISOString().slice(0,10);

  // Create sync job
  const { data: job, error } = await supabase.from('sync_jobs').insert({
    restaurant_id: restaurant.id,
    report_id: report.id,
    date_from: dateFrom,
    date_to: dateTo,
    status: 'pending'
  }).select().single();

  if (error) {
    const config = reportTemplates[report.id];
    return res.render(config.template, {
      title: restaurant.name + ' - ' + report.name,
      report: { id: report.id, name: report.name, description: report.description, icon: report.icon },
      data: null, error: 'Failed to create sync job: ' + error.message, params: req.body,
      columns: config.columns, filters: config.filters || [], filterOpts: null
    });
  }

  const config = reportTemplates[report.id];
  res.render(config.template, {
    title: restaurant.name + ' - ' + report.name,
    report: { id: report.id, name: report.name, description: report.description, icon: report.icon },
    data: null, error: null, params: req.body,
    columns: config.columns, filters: config.filters || [], filterOpts: null,
    syncJobId: job.id,
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseKey
  });
});

// AJAX: poll for job result
app.get('/api/jobs/:jobId/result', async (req, res) => {
  const { data: job } = await supabase.from('sync_jobs').select('*').eq('id', req.params.jobId).single();
  if (!job) return res.json({ status: 'not_found' });
  if (job.status === 'failed') return res.json({ status: 'failed', error: job.error });
  if (job.status !== 'completed') return res.json({ status: job.status });

  const { data: result } = await supabase.from('sync_results').select('*').eq('job_id', req.params.jobId).single();
  if (!result) return res.json({ status: 'no_data' });

  // Return data and schedule deletion
  res.json({ status: 'completed', data: result.data, report_id: result.report_id, columns: result.columns });

  // Delete after delivery
  await supabase.from('sync_results').delete().eq('job_id', req.params.jobId);
  await supabase.from('sync_jobs').delete().eq('id', req.params.jobId);
});

// ============ AGENT API ============

// Agent polls for pending jobs
app.get('/api/agent/:apiKey/jobs', async (req, res) => {
  const { data: restaurant } = await supabase.from('restaurants').select('*').eq('api_key', req.params.apiKey).single();
  if (!restaurant) return res.status(401).json({ error: 'Invalid API key' });

  const { data: jobs } = await supabase.from('sync_jobs')
    .select('*').eq('restaurant_id', restaurant.id).eq('status', 'pending')
    .order('created_at').limit(5);

  res.json(jobs || []);
});

// Agent updates job status + pushes result
app.post('/api/agent/:apiKey/push', async (req, res) => {
  const { data: restaurant } = await supabase.from('restaurants').select('*').eq('api_key', req.params.apiKey).single();
  if (!restaurant) return res.status(401).json({ error: 'Invalid API key' });

  const { job_id, data, error: errMsg } = req.body;

  if (errMsg) {
    await supabase.from('sync_jobs').update({ status: 'failed', error: errMsg, completed_at: new Date().toISOString() }).eq('id', job_id);
    return res.json({ status: 'failed' });
  }

  await supabase.from('sync_jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', job_id);
  await supabase.from('sync_results').insert({
    job_id, restaurant_id: restaurant.id, report_id: req.body.report_id,
    date_from: req.body.date_from, date_to: req.body.date_to,
    data: data, columns: req.body.columns || null
  });

  res.json({ status: 'completed' });
});

// Agent: claim a job (set to running)
app.post('/api/agent/:apiKey/claim', async (req, res) => {
  const { data: restaurant } = await supabase.from('restaurants').select('*').eq('api_key', req.params.apiKey).single();
  if (!restaurant) return res.status(401).json({ error: 'Invalid API key' });

  const { job_id } = req.body;
  await supabase.from('sync_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job_id);

  const { data: job } = await supabase.from('sync_jobs').select('*').eq('id', job_id).single();
  res.json(job);
});

// ============ EXPORT ============

module.exports = app;
