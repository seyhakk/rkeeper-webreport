# R-Keeper Report Agent

Runs on each restaurant's Windows PC. Connects to the local SQL Server, waits for jobs from the cloud, runs queries, and pushes results.

## Setup

1. **Build Agent.exe** (one time):
   ```
   cd agent
   npm install
   npm install -g pkg
   npm run build
   ```
   Creates `Agent.exe` (~40MB standalone, no Node.js needed).

2. **Create config.json** next to Agent.exe:
   ```json
   {
     "apiUrl": "https://rkeeper-reports.vercel.app",
     "apiKey": "YOUR_RESTAURANT_API_KEY",
     "sql": {
       "server": "localhost\\SQLEXPRESS",
       "database": "RKDEMO",
       "user": "sa",
       "password": "YOUR_SQL_PASSWORD"
     }
   }
   ```

3. **Get your API key** from the admin panel:
   - Go to https://rkeeper-reports.vercel.app/admin/restaurants
   - Find your restaurant, click Edit
   - Copy the API Key

## Usage

### Run once (sync pending jobs and exit):
```cmd
Agent.exe --once
```
Use this for manual sync or scheduled tasks.

### Continuous polling (recommended):
```cmd
Agent.exe
```
Keeps running, polls every 3 seconds for new jobs. Press Ctrl+C to stop.

### Test connection:
```cmd
Agent.exe --test
```
Tests SQL connection and API connectivity without running jobs.

### Set up as Windows scheduled task (auto-start):
1. Open Task Scheduler
2. Create Task → Trigger: At startup → Action: Start Agent.exe with `--once`
3. Runs at boot, syncs any pending jobs, exits

## config.json reference

| Key | Required | Description |
|-----|----------|-------------|
| `apiUrl` | Yes | Cloud server URL |
| `apiKey` | Yes | Restaurant API key from admin panel |
| `sql.server` | Yes | SQL Server hostname\instance |
| `sql.database` | Yes | Database name (default: RKDEMO) |
| `sql.user` | Yes | SQL login username |
| `sql.password` | Yes | SQL login password |
| `sql.port` | No | SQL port (default: 1433) |
| `pollInterval` | No | Seconds between polls (default: 3) |
