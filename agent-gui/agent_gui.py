import json
import os
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
from datetime import datetime, date as date_type
import pymssql
import urllib.request
import urllib.error

APP_NAME = "R-Keeper Report Agent"
VERSION = "1.0"
CONFIG_FILE = "config.json"

def get_config_path():
    if getattr(sys, 'frozen', False):
        return os.path.join(os.path.dirname(sys.executable), CONFIG_FILE)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), CONFIG_FILE)

def load_config():
    p = get_config_path()
    if os.path.exists(p):
        with open(p, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {
        "apiUrl": "https://rkeeper-reports.vercel.app",
        "apiKey": "",
        "pollInterval": 3,
        "sql": {
            "server": "localhost\\SQLEXPRESS",
            "database": "RKDEMO",
            "trusted_connection": True,
            "user": "",
            "password": "",
            "port": 1433
        }
    }

def save_config(cfg):
    with open(get_config_path(), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2)

QUERIES = {
    'dish-sale': "SELECT CashServer, ReportCategory, Dish, SUM(Quantity) AS Quantity, CASE WHEN SUM(Quantity)>0 THEN ROUND(SUM(BaseAmount)/SUM(Quantity),2) ELSE 0 END AS AvgPrice, SUM(BaseAmount) AS Amount, 0 AS DiscountSum, ROUND(SUM(BaseAmount)*1.05,2) AS PaidAmount, 0 AS TaxSVC, ROUND(SUM(BaseAmount)*0.05,2) AS Surcharge5Pct FROM (SELECT o.MIDSERVERNAME+':'+CAST(o.MIDSRV AS VARCHAR) AS CashServer, ISNULL(cat.NAME,'Uncategorized') AS ReportCategory, o.DISHNAME AS Dish, o.QUANTITY AS Quantity, o.PAYSUM AS BaseAmount FROM STAT_RK7_SHIFTS_OPERATION o INNER JOIN MENUITEMS m ON o.DISHGUID=m.GUIDSTRING LEFT JOIN CATEGLIST cat ON m.PARENT=cat.SIFR WHERE o.DISHNAME<>'' AND o.QUANTITY>0 AND o.PAYSUM>0 AND CAST(o.SHIFTDATE AS DATE)>=@df AND CAST(o.SHIFTDATE AS DATE)<=@dt) t GROUP BY CashServer,ReportCategory,Dish ORDER BY CashServer,ReportCategory,Dish",
    'receipt': "SELECT RESTAURANT AS Restaurant, CHECKNUM AS ReceiptNumber, CASE WHEN GUESTCOUNT>0 THEN GUESTCOUNT ELSE 1 END AS Quantity, CASE WHEN GUESTCOUNT>0 THEN ROUND((CASE WHEN DISCOUNTSUM=0 THEN PAIDSUM-TAXSUM ELSE PAIDSUM-DISCOUNTSUM END)/GUESTCOUNT,2) ELSE ROUND(CASE WHEN DISCOUNTSUM=0 THEN PAIDSUM-TAXSUM ELSE PAIDSUM-DISCOUNTSUM END,2) END AS AvgPrice, CASE WHEN DISCOUNTSUM=0 THEN PAIDSUM-TAXSUM ELSE PAIDSUM-DISCOUNTSUM END AS Amount, DISCOUNTSUM AS DiscountSum, PAIDSUM AS PaidAmount, TAXSUM AS Surcharge5Pct FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt AND CHECKNUM IS NOT NULL",
    'waiter-sales': "SELECT WAITER AS Waiter, COUNT(*) AS NumChecks, SUM(BASICSUM) AS TotalSales, AVG(BASICSUM) AS AvgCheck, SUM(DISCOUNTSUM) AS DiscountTotal, SUM(TAXSUM) AS TaxTotal, SUM(GUESTCOUNT) AS GuestCount FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt AND WAITER IS NOT NULL AND WAITER<>'' GROUP BY WAITER ORDER BY TotalSales DESC",
    'hourly-sales': "SELECT DATEPART(HOUR,CLOSEDATETIME) AS HourOfDay, COUNT(*) AS NumChecks, SUM(BASICSUM) AS TotalSales, AVG(BASICSUM) AS AvgCheck, SUM(DISCOUNTSUM) AS DiscountTotal, SUM(GUESTCOUNT) AS GuestCount FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(CLOSEDATETIME AS DATE)>=@df AND CAST(CLOSEDATETIME AS DATE)<=@dt AND CLOSEDATETIME IS NOT NULL GROUP BY DATEPART(HOUR,CLOSEDATETIME) ORDER BY HourOfDay",
    'top-dishes': "SELECT ROW_NUMBER() OVER(ORDER BY SUM(BaseAmount) DESC) AS Rank, Category, Dish, SUM(Quantity) AS TotalQty, CASE WHEN SUM(Quantity)>0 THEN ROUND(SUM(BaseAmount)/SUM(Quantity),2) ELSE 0 END AS AvgPrice, SUM(BaseAmount) AS TotalAmount, ROUND(SUM(BaseAmount)*100.0/SUM(SUM(BaseAmount)) OVER(),2) AS Pct FROM (SELECT ISNULL(cat.NAME,'Uncategorized') AS Category, o.DISHNAME AS Dish, o.QUANTITY AS Quantity, o.PAYSUM AS BaseAmount FROM STAT_RK7_SHIFTS_OPERATION o INNER JOIN MENUITEMS m ON o.DISHGUID=m.GUIDSTRING LEFT JOIN CATEGLIST cat ON m.PARENT=cat.SIFR WHERE o.DISHNAME<>'' AND o.QUANTITY>0 AND o.PAYSUM>0 AND CAST(o.SHIFTDATE AS DATE)>=@df AND CAST(o.SHIFTDATE AS DATE)<=@dt) t GROUP BY Category,Dish ORDER BY Rank",
    'daily-summary': "SELECT CAST(SHIFTDATE AS DATE) AS SaleDate, COUNT(*) AS TotalChecks, SUM(BASICSUM) AS TotalSales, SUM(TAXSUM) AS TaxTotal, SUM(DISCOUNTSUM) AS DiscountTotal, SUM(GUESTCOUNT) AS GuestCount FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt GROUP BY CAST(SHIFTDATE AS DATE) ORDER BY SaleDate DESC",
    'category-sales': "SELECT Category, SUM(Quantity) AS TotalQty, CASE WHEN SUM(Quantity)>0 THEN ROUND(SUM(BaseAmount)/SUM(Quantity),2) ELSE 0 END AS AvgPrice, SUM(BaseAmount) AS TotalAmount, ROUND(SUM(BaseAmount)*1.05,2) AS PaidAmount, ROUND(SUM(BaseAmount)*0.05,2) AS Surcharge FROM (SELECT ISNULL(cat.NAME,'Uncategorized') AS Category, o.QUANTITY AS Quantity, o.PAYSUM AS BaseAmount FROM STAT_RK7_SHIFTS_OPERATION o INNER JOIN MENUITEMS m ON o.DISHGUID=m.GUIDSTRING LEFT JOIN CATEGLIST cat ON m.PARENT=cat.SIFR WHERE o.DISHNAME<>'' AND o.QUANTITY>0 AND o.PAYSUM>0 AND CAST(o.SHIFTDATE AS DATE)>=@df AND CAST(o.SHIFTDATE AS DATE)<=@dt) t GROUP BY Category ORDER BY TotalAmount DESC",
    'currency-sales': "SELECT ch.RESTAURANT AS Restaurant, CAST(ch.SHIFTDATE AS DATE) AS SaleDate, ISNULL(ct.NAME,'Unknown') AS CurrencyType, ISNULL(c.NAME,'Unknown') AS Currency, COUNT(*) AS LineCount, ROUND(SUM(cl.BASICSUM),2) AS Amount, ROUND(SUM(cl.DISBALLANCE),2) AS DiscountSum, ROUND(SUM(cl.BASICSUM+cl.DISBALLANCE)*1.05,2) AS PaidAmount, ROUND(SUM(cl.BASICSUM+cl.DISBALLANCE)*0.05,2) AS Surcharge5Pct FROM CURRLINES cl INNER JOIN PRINTCHECKS pc ON cl.CHECKUNI=pc.UNI INNER JOIN STAT_RK7_SHIFTS_CHECKS ch ON pc.CHECKNUM=ch.CHECKNUM LEFT JOIN CURRENCIES c ON cl.SIFR=c.SIFR LEFT JOIN CURRENCYTYPES ct ON cl.IHIGHLEVELTYPE=ct.SIFR WHERE cl.BASICSUM IS NOT NULL AND CAST(ch.SHIFTDATE AS DATE)>=@df AND CAST(ch.SHIFTDATE AS DATE)<=@dt GROUP BY ch.RESTAURANT, CAST(ch.SHIFTDATE AS DATE), ct.NAME, c.NAME ORDER BY ch.RESTAURANT, SaleDate, ct.NAME, c.NAME",
    'guest-count': "SELECT CAST(SHIFTDATE AS DATE) AS SaleDate, COUNT(*) AS TotalChecks, SUM(GUESTCOUNT) AS TotalGuests, SUM(BASICSUM) AS TotalSales, ROUND(AVG(CAST(GUESTCOUNT AS FLOAT)),2) AS AvgGuests, ROUND(SUM(BASICSUM)/NULLIF(SUM(GUESTCOUNT),0),2) AS SalesPerGuest FROM STAT_RK7_SHIFTS_CHECKS WHERE CAST(SHIFTDATE AS DATE)>=@df AND CAST(SHIFTDATE AS DATE)<=@dt GROUP BY CAST(SHIFTDATE AS DATE) ORDER BY SaleDate DESC"
}

def api_request(method, url, data=None):
    headers = {"Content-Type": "application/json"} if data else {}
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as resp:
        txt = resp.read().decode()
        return json.loads(txt) if txt else None

def get_sql_connection(sql_cfg):
    trusted = sql_cfg.get("trusted_connection", False)
    if trusted:
        conn = pymssql.connect(
            server=sql_cfg['server'],
            database=sql_cfg['database'],
            port=str(sql_cfg.get('port', 1433)),
            login_timeout=10
        )
    else:
        conn = pymssql.connect(
            server=sql_cfg['server'],
            user=sql_cfg['user'],
            password=sql_cfg['password'],
            database=sql_cfg['database'],
            port=str(sql_cfg.get('port', 1433)),
            login_timeout=10
        )
    return conn

def run_query(sql_cfg, query_key, date_from, date_to):
    query = QUERIES.get(query_key)
    if not query:
        raise ValueError(f"Unknown report: {query_key}")
    # pymssql uses %s placeholders (not T-SQL @df/@dt)
    query_fixed = query.replace('@df', '%s').replace('@dt', '%s')
    conn = get_sql_connection(sql_cfg)
    cursor = conn.cursor(as_dict=True)
    cursor.execute(query_fixed, (date_from, date_to))
    rows = cursor.fetchall()
    conn.close()
    return rows


class AgentApp:
    def __init__(self):
        self.running = False
        self.poll_thread = None
        self.config = load_config()

        self.root = tk.Tk()
        self.root.title(f"{APP_NAME} v{VERSION}")
        self.root.geometry("640x600")
        self.root.resizable(False, False)
        self.root.protocol("WM_DELETE_WINDOW", self.minimize_to_tray)

        self.tray_icon = None
        self._build_ui()
        self._load_config_to_ui()

    def _build_ui(self):
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        # --- Config Tab ---
        cfg_frame = ttk.Frame(notebook, padding=10)
        notebook.add(cfg_frame, text="  Settings  ")

        row = 0
        ttk.Label(cfg_frame, text="Cloud Portal URL:").grid(row=row, column=0, sticky=tk.W, pady=3)
        self.ent_api_url = ttk.Entry(cfg_frame, width=50)
        self.ent_api_url.grid(row=row, column=1, sticky=tk.EW, pady=3, padx=(5,0))

        row += 1
        ttk.Label(cfg_frame, text="API Key:").grid(row=row, column=0, sticky=tk.W, pady=3)
        self.ent_api_key = ttk.Entry(cfg_frame, width=50)
        self.ent_api_key.grid(row=row, column=1, sticky=tk.EW, pady=3, padx=(5,0))

        row += 1
        ttk.Separator(cfg_frame, orient=tk.HORIZONTAL).grid(row=row, column=0, columnspan=2, sticky=tk.EW, pady=8)

        row += 1
        ttk.Label(cfg_frame, text="SQL Server Connection", font=("", 10, "bold")).grid(row=row, column=0, columnspan=2, sticky=tk.W, pady=(0,4))

        row += 1
        ttk.Label(cfg_frame, text="Server:").grid(row=row, column=0, sticky=tk.W, pady=3)
        self.ent_server = ttk.Entry(cfg_frame, width=50)
        self.ent_server.grid(row=row, column=1, sticky=tk.EW, pady=3, padx=(5,0))

        row += 1
        ttk.Label(cfg_frame, text="Database:").grid(row=row, column=0, sticky=tk.W, pady=3)
        self.ent_database = ttk.Entry(cfg_frame, width=50)
        self.ent_database.grid(row=row, column=1, sticky=tk.EW, pady=3, padx=(5,0))

        row += 1
        ttk.Label(cfg_frame, text="Port:").grid(row=row, column=0, sticky=tk.W, pady=3)
        self.ent_port = ttk.Entry(cfg_frame, width=10)
        self.ent_port.grid(row=row, column=1, sticky=tk.W, pady=3, padx=(5,0))

        row += 1
        self.win_auth_var = tk.BooleanVar(value=True)
        self.chk_win_auth = ttk.Checkbutton(cfg_frame, text="Windows Authentication (Trusted Connection)", variable=self.win_auth_var, command=self._toggle_auth)
        self.chk_win_auth.grid(row=row, column=0, columnspan=2, sticky=tk.W, pady=3)

        row += 1
        ttk.Label(cfg_frame, text="SQL Username:").grid(row=row, column=0, sticky=tk.W, pady=3)
        self.ent_user = ttk.Entry(cfg_frame, width=50)
        self.ent_user.grid(row=row, column=1, sticky=tk.EW, pady=3, padx=(5,0))

        row += 1
        ttk.Label(cfg_frame, text="SQL Password:").grid(row=row, column=0, sticky=tk.W, pady=3)
        self.ent_password = ttk.Entry(cfg_frame, width=50, show="*")
        self.ent_password.grid(row=row, column=1, sticky=tk.EW, pady=3, padx=(5,0))

        row += 1
        ttk.Label(cfg_frame, text="Poll Interval (sec):").grid(row=row, column=0, sticky=tk.W, pady=3)
        self.ent_poll = ttk.Entry(cfg_frame, width=10)
        self.ent_poll.grid(row=row, column=1, sticky=tk.W, pady=3, padx=(5,0))

        cfg_frame.columnconfigure(1, weight=1)

        row += 1
        btn_frame = ttk.Frame(cfg_frame)
        btn_frame.grid(row=row, column=0, columnspan=2, pady=(12,0))
        ttk.Button(btn_frame, text="Save Settings", command=self._save_config).pack(side=tk.LEFT, padx=4)
        ttk.Button(btn_frame, text="Test Connection", command=self._test_connection).pack(side=tk.LEFT, padx=4)

        # --- Log Tab ---
        log_frame = ttk.Frame(notebook, padding=10)
        notebook.add(log_frame, text="  Log  ")

        self.log_text = scrolledtext.ScrolledText(log_frame, height=20, state=tk.DISABLED, font=("Consolas", 9))
        self.log_text.pack(fill=tk.BOTH, expand=True)

        ctrl_frame = ttk.Frame(log_frame)
        ctrl_frame.pack(fill=tk.X, pady=(8,0))
        self.btn_start = ttk.Button(ctrl_frame, text="Start Agent", command=self._start_agent)
        self.btn_start.pack(side=tk.LEFT, padx=4)
        self.btn_stop = ttk.Button(ctrl_frame, text="Stop Agent", command=self._stop_agent, state=tk.DISABLED)
        self.btn_stop.pack(side=tk.LEFT, padx=4)
        ttk.Button(ctrl_frame, text="Clear Log", command=self._clear_log).pack(side=tk.RIGHT, padx=4)

        self.status_var = tk.StringVar(value="Stopped")
        ttk.Label(ctrl_frame, textvariable=self.status_var, foreground="gray").pack(side=tk.LEFT, padx=12)

        self._toggle_auth()

    def _toggle_auth(self):
        trusted = self.win_auth_var.get()
        state = tk.DISABLED if trusted else tk.NORMAL
        self.ent_user.config(state=state)
        self.ent_password.config(state=state)

    def _load_config_to_ui(self):
        c = self.config
        self.ent_api_url.delete(0, tk.END); self.ent_api_url.insert(0, c.get("apiUrl", ""))
        self.ent_api_key.delete(0, tk.END); self.ent_api_key.insert(0, c.get("apiKey", ""))
        s = c.get("sql", {})
        self.ent_server.delete(0, tk.END); self.ent_server.insert(0, s.get("server", ""))
        self.ent_database.delete(0, tk.END); self.ent_database.insert(0, s.get("database", ""))
        self.ent_port.delete(0, tk.END); self.ent_port.insert(0, str(s.get("port", 1433)))
        self.win_auth_var.set(s.get("trusted_connection", True))
        self.ent_user.delete(0, tk.END); self.ent_user.insert(0, s.get("user", ""))
        self.ent_password.delete(0, tk.END); self.ent_password.insert(0, s.get("password", ""))
        self.ent_poll.delete(0, tk.END); self.ent_poll.insert(0, str(c.get("pollInterval", 3)))
        self._toggle_auth()

    def _read_config_from_ui(self):
        return {
            "apiUrl": self.ent_api_url.get().strip().rstrip("/"),
            "apiKey": self.ent_api_key.get().strip(),
            "pollInterval": int(self.ent_poll.get().strip() or "3"),
            "sql": {
                "server": self.ent_server.get().strip(),
                "database": self.ent_database.get().strip(),
                "trusted_connection": self.win_auth_var.get(),
                "user": self.ent_user.get().strip(),
                "password": self.ent_password.get().strip(),
                "port": int(self.ent_port.get().strip() or "1433")
            }
        }

    def _save_config(self):
        self.config = self._read_config_from_ui()
        save_config(self.config)
        messagebox.showinfo("Saved", "Settings saved to config.json")

    def _test_connection(self):
        cfg = self._read_config_from_ui()

        self._log("Testing SQL connection...")
        try:
            conn = get_sql_connection(cfg["sql"])
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM STAT_RK7_SHIFTS_OPERATION")
            count = cursor.fetchone()[0]
            conn.close()
            auth_type = "Windows" if cfg["sql"].get("trusted_connection") else "SQL"
            self._log(f"  SQL OK ({auth_type} auth): {count} rows in STAT_RK7_SHIFTS_OPERATION")
        except Exception as e:
            self._log(f"  SQL FAILED: {e}")
            messagebox.showerror("SQL Failed", f"SQL connection failed:\n{e}")
            return

        self._log("Testing API connection...")
        try:
            url = cfg["apiUrl"] + "/api/agent/" + cfg["apiKey"] + "/jobs"
            jobs = api_request("GET", url)
            self._log(f"  API OK: {len(jobs)} pending jobs")
        except Exception as e:
            self._log(f"  API FAILED: {e}")
            messagebox.showerror("API Failed", f"API connection failed:\n{e}")
            return

        messagebox.showinfo("Test OK", "SQL and API connections working!")

    def _log(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] {msg}\n"
        def _insert():
            self.log_text.config(state=tk.NORMAL)
            self.log_text.insert(tk.END, line)
            self.log_text.see(tk.END)
            self.log_text.config(state=tk.DISABLED)
        if threading.current_thread() is threading.main_thread():
            _insert()
        else:
            self.root.after(0, _insert)

    def _clear_log(self):
        self.log_text.config(state=tk.NORMAL)
        self.log_text.delete("1.0", tk.END)
        self.log_text.config(state=tk.DISABLED)

    def _start_agent(self):
        if self.running:
            return
        self.config = self._read_config_from_ui()
        save_config(self.config)
        self.running = True
        self.btn_start.config(state=tk.DISABLED)
        self.btn_stop.config(state=tk.NORMAL)
        self.status_var.set("Running")
        self._log("Agent started. Polling for jobs...")
        self.poll_thread = threading.Thread(target=self._poll_loop, daemon=True)
        self.poll_thread.start()

    def _stop_agent(self):
        self.running = False
        self.btn_start.config(state=tk.NORMAL)
        self.btn_stop.config(state=tk.DISABLED)
        self.status_var.set("Stopped")
        self._log("Agent stopped.")

    def _poll_loop(self):
        cfg = self.config
        api_url = cfg["apiUrl"]
        api_key = cfg["apiKey"]
        interval = cfg.get("pollInterval", 3)

        self._log(f"Polling {api_url}/api/agent/{api_key[:8]}.../jobs every {interval}s")

        while self.running:
            try:
                url = f"{api_url}/api/agent/{api_key}/jobs"
                jobs = api_request("GET", url)
                if jobs:
                    self._log(f"Found {len(jobs)} job(s)")
                for job in (jobs or []):
                    self._process_job(api_url, api_key, cfg["sql"], job)
            except Exception as e:
                self._log(f"Poll error: {e}")
            time.sleep(interval)

    def _process_job(self, api_url, api_key, sql_cfg, job):
        report_id = job["report_id"]
        date_from = job["date_from"]
        date_to = job["date_to"]
        job_id = job["id"]
        self._log(f"Job: {report_id} ({date_from} to {date_to})")

        try:
            api_request("POST", f"{api_url}/api/agent/{api_key}/claim", {"job_id": job_id})
            self._log(f"  Claimed, running SQL query...")
            rows = run_query(sql_cfg, report_id, date_from, date_to)
            data = []
            for r in rows:
                row = {}
                for k, v in r.items():
                    if isinstance(v, (date_type,)):
                        row[k] = v.isoformat()
                    elif hasattr(v, '__float__'):
                        row[k] = float(v)
                    else:
                        row[k] = v
                data.append(row)
            self._log(f"  Fetched {len(data)} rows, pushing to cloud...")

            # Chunk large payloads to avoid 413
            chunk_size = 200
            total_rows = len(data)
            for i in range(0, total_rows, chunk_size):
                chunk = data[i:i+chunk_size]
                is_last = (i + chunk_size) >= total_rows
                push_data = {
                    "job_id": job_id, "report_id": report_id,
                    "date_from": date_from, "date_to": date_to,
                    "data": chunk
                }
                if not is_last:
                    push_data["_more"] = True
                api_request("POST", f"{api_url}/api/agent/{api_key}/push", push_data)
                self._log(f"  Pushed chunk {i//chunk_size+1} ({len(chunk)} rows)")

            self._log(f"  Completed!")
        except Exception as e:
            self._log(f"  Error: {e}")
            try:
                api_request("POST", f"{api_url}/api/agent/{api_key}/push", {
                    "job_id": job_id, "report_id": report_id, "error": str(e)
                })
            except:
                pass

    def minimize_to_tray(self):
        self.root.withdraw()
        self._show_tray()

    def _show_tray(self):
        if self.tray_icon:
            return
        try:
            import pystray
            from PIL import Image, ImageDraw

            img = Image.new('RGBA', (64, 64), (0, 120, 215, 255))
            d = ImageDraw.Draw(img)
            d.text((16, 14), "RK", fill="white")

            menu = pystray.Menu(
                pystray.MenuItem("Show", lambda: self.root.after(0, self._restore_from_tray)),
                pystray.MenuItem("Exit", lambda: self.root.after(0, self._quit))
            )
            self.tray_icon = pystray.Icon(APP_NAME, img, APP_NAME, menu)
            threading.Thread(target=self.tray_icon.run, daemon=True).start()
        except Exception:
            pass

    def _restore_from_tray(self):
        if self.tray_icon:
            self.tray_icon.stop()
            self.tray_icon = None
        self.root.deiconify()
        self.root.lift()

    def _quit(self):
        self.running = False
        if self.tray_icon:
            self.tray_icon.stop()
            self.tray_icon = None
        self.root.destroy()

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    app = AgentApp()
    app.run()
