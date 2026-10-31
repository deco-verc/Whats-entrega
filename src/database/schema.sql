-- Schema DDL para o Funil de Direct Response WhatsappEntrega
-- Conexao em modo WAL com PRAGMA synchronous = NORMAL

PRAGMA foreign_keys = ON;

-- 1. Tabela de Clientes
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  jid TEXT,
  name TEXT NOT NULL,
  email TEXT,
  current_state TEXT NOT NULL DEFAULT 'NEW',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_customers_jid ON customers (jid);
CREATE INDEX IF NOT EXISTS idx_customers_current_state ON customers (current_state);

-- 2. Tabela de Pedidos e Transacoes Cakto (Idempotencia estrita via UNIQUE(transaction_id, event_type))
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  paid_at TEXT,
  raw_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_orders_transaction_event UNIQUE (transaction_id, event_type),
  FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_transaction_id ON orders (transaction_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

-- 3. Tabela da Fila de Mensagens (Fila Indiana Anti-Banimento)
CREATE TABLE IF NOT EXISTS message_queue (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  jid TEXT,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  media_path TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_queue_scheduled_at ON message_queue (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_message_queue_status ON message_queue (status);
CREATE INDEX IF NOT EXISTS idx_message_queue_status_scheduled ON message_queue (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_message_queue_customer_id ON message_queue (customer_id);

-- 4. Tabelas Complementares de Observabilidade e Configuracao do Sistema
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
