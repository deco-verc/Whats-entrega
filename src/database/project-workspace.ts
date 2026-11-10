export const PROJECT_WORKSPACE_SCHEMA = `
CREATE TABLE IF NOT EXISTS project_workspace (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  product_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  links_json TEXT NOT NULL DEFAULT '{}',
  additional_products_json TEXT NOT NULL DEFAULT '[]',
  integration_after_id INTEGER NOT NULL DEFAULT 0,
  onboarding_step INTEGER NOT NULL DEFAULT 1,
  simulated_at TEXT,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT,
  product_id TEXT,
  transaction_id TEXT,
  authenticated INTEGER NOT NULL,
  result TEXT NOT NULL,
  details TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_project ON webhook_events(project_id, id DESC);
CREATE TABLE IF NOT EXISTS template_options (
  template_id TEXT PRIMARY KEY REFERENCES message_templates(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  message_type TEXT NOT NULL,
  missing_policy TEXT NOT NULL,
  fallback TEXT
);
CREATE TABLE IF NOT EXISTS automation_conditions (
  trigger_id TEXT PRIMARY KEY REFERENCES funnel_triggers(id) ON DELETE CASCADE,
  conditions_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_executions (
  job_id TEXT PRIMARY KEY REFERENCES message_queue(id) ON DELETE CASCADE,
  trigger_id TEXT REFERENCES funnel_triggers(id) ON DELETE SET NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE (trigger_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_automation_executions_trigger ON automation_executions(trigger_id);
CREATE TABLE IF NOT EXISTS queue_dispatch_attempts (
  job_id TEXT PRIMARY KEY REFERENCES message_queue(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contact_permissions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  marketing INTEGER NOT NULL,
  opted_out INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, phone)
);
CREATE TABLE IF NOT EXISTS whatsapp_opt_out (
  phone TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
