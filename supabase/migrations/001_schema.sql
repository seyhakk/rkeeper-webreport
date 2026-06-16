CREATE TABLE restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  api_key text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  report_id text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  error text,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE sync_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid UNIQUE NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  report_id text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  columns jsonb,
  data jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_sync_jobs_restaurant_status ON sync_jobs(restaurant_id, status);
CREATE INDEX idx_sync_results_job ON sync_results(job_id);
CREATE INDEX idx_sync_results_restaurant ON sync_results(restaurant_id);

ALTER TABLE sync_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

-- Restaurants are readable by authenticated users
CREATE POLICY "restaurants_read" ON restaurants FOR SELECT USING (true);
CREATE POLICY "restaurants_insert" ON restaurants FOR INSERT WITH CHECK (true);

-- Jobs: agent can read pending, update own jobs
CREATE POLICY "jobs_read_pending" ON sync_jobs FOR SELECT USING (status = 'pending');
CREATE POLICY "jobs_update_own" ON sync_jobs FOR UPDATE USING (true);
CREATE POLICY "jobs_insert" ON sync_jobs FOR INSERT WITH CHECK (true);

-- Results: readable by authenticated users, deletable after use
CREATE POLICY "results_read" ON sync_results FOR SELECT USING (true);
CREATE POLICY "results_insert" ON sync_results FOR INSERT WITH CHECK (true);
CREATE POLICY "results_delete" ON sync_results FOR DELETE USING (true);

-- Seed a demo restaurant
INSERT INTO restaurants (name, slug, api_key) VALUES
  ('LINGER KNR', 'linger-knr', 'demo_key_123456789'),
  ('BORAN COFFEE', 'boran-coffee', 'demo_key_987654321')
ON CONFLICT (slug) DO NOTHING;
