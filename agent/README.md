# R-Keeper Report Agent

Standalone `.exe` that runs on each restaurant's Windows PC. Connects to the local SQL Server, polls the cloud portal for report jobs, executes queries, and pushes results back.

**No Node.js installation required** — just the `.exe` + `config.json`.

## Files to Deploy

Copy these two files to the restaurant PC:

```
Agent.exe     (101 MB — standalone, no dependencies)
config.json   (create from config.example.json)
```

## Setup

1. **Copy `Agent.exe`** to any folder on the restaurant PC.

2. **Create `config.json`** next to `Agent.exe` (or copy `config.example.json` and edit):
   ```json
   {
     "apiUrl": "https://rkeeper-reports.vercel.app",
     "apiKey": "YOUR_RESTAURANT_API_KEY",
     "pollInterval": 3,
     "sql": {
       "server": "localhost\\SQLEXPRESS",
       "database": "RKDEMO",
       "user": "sa",
       "password": "YOUR_SQL_PASSWORD",
       "port": 1433
     }
   }
   ```

3. **Get your API key** from the admin panel:
   - Go to `https://rkeeper-reports.vercel.app/admin/restaurants`
   - Find your restaurant, click Edit
   - Copy the API Key

## Usage

### Test connection
```cmd
Agent.exe --test
```
Verifies SQL Server and cloud portal connectivity. Shows pass/fail for each.

### Process pending jobs once and exit
```cmd
Agent.exe --once
```
Fetches all pending sync jobs from the portal, executes them, pushes results, then exits. Good for scheduled tasks.

### Continuous polling (default)
```cmd
Agent.exe
```
Runs indefinitely, polls every 3 seconds (configurable) for new report jobs. Press `Ctrl+C` to stop.

### Setup wizard
```cmd
Agent.exe --setup
```
Interactive wizard to create `config.json` — prompts for all settings and tests connections.

## config.json reference

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `apiUrl` | Yes | — | Cloud portal URL |
| `apiKey` | Yes | — | Restaurant API key from admin panel |
| `pollInterval` | No | `3` | Seconds between polls |
| `sql.server` | Yes | — | SQL Server hostname\\instance |
| `sql.database` | Yes | — | Database name |
| `sql.user` | Yes | — | SQL login username |
| `sql.password` | Yes | — | SQL login password |
| `sql.port` | No | `1433` | SQL Server port |

## Windows Scheduled Task (auto-start)

1. Open Task Scheduler
2. Create Task
   - **Trigger**: At startup
   - **Action**: Start a program → browse to `Agent.exe`
   - **Arguments**: `--once`
3. OK → save

This runs Agent at boot, processes any pending jobs, then exits.

## Rebuilding Agent.exe

Only needed if you modify `agent.js`. Requires Node.js 20+ installed:

```cmd
cd agent
npm install
npm run build
```

This uses Node.js SEA (Single Executable Application) to produce a standalone `Agent.exe`.
