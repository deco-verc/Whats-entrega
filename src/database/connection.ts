import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { env, ensureDataDirectoriesExist } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let activeDatabase: Database.Database | null = null;

export const EMBEDDED_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

-- 0. Tabela de Projetos (Multi-Tenant / Multi-Produto)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  cakto_product_id TEXT,
  cakto_webhook_secret TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug);
CREATE INDEX IF NOT EXISTS idx_projects_cakto_product_id ON projects (cakto_product_id);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default',
  phone TEXT NOT NULL UNIQUE,
  jid TEXT,
  name TEXT NOT NULL,
  email TEXT,
  current_state TEXT NOT NULL DEFAULT 'NEW',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_customers_jid ON customers (jid);
CREATE INDEX IF NOT EXISTS idx_customers_current_state ON customers (current_state);
CREATE INDEX IF NOT EXISTS idx_customers_project_id ON customers (project_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default',
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
  FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_transaction_id ON orders (transaction_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders (project_id);

CREATE TABLE IF NOT EXISTS message_queue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default',
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
  FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_queue_scheduled_at ON message_queue (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_message_queue_status ON message_queue (status);
CREATE INDEX IF NOT EXISTS idx_message_queue_status_scheduled ON message_queue (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_message_queue_customer_id ON message_queue (customer_id);
CREATE INDEX IF NOT EXISTS idx_message_queue_project_id ON message_queue (project_id);

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

CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  media_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_templates_name ON message_templates (name);
CREATE INDEX IF NOT EXISTS idx_message_templates_project_id ON message_templates (project_id);
`.trim();

export function loadSchemaSql(): string {
  const candidatePaths = [
    path.resolve(__dirname, "schema.sql"),
    path.resolve(__dirname, "../../src/database/schema.sql"),
    path.resolve(process.cwd(), "src/database/schema.sql"),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        return fs.readFileSync(candidate, "utf-8");
      } catch {
        // Fallback to next path or embedded schema
      }
    }
  }

  return EMBEDDED_SCHEMA_SQL;
}

export function applySchema(db: Database.Database): void {
  // 1. Garante tabela de projetos e projeto default antes de tabelas filhas
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        cakto_product_id TEXT,
        cakto_webhook_secret TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO projects (id, name, slug, description)
      VALUES ('default', 'Projeto Padrão', 'default', 'Projeto padrão do sistema');
    `);
  } catch {
    // Ignora se ja existir
  }

  // 2. Migracoes aditivas para tabelas pre-existentes (antes de criar indices que dependem de colunas novas)
  const tablesToMigrate = ["customers", "orders", "message_queue", "message_templates"];
  for (const table of tablesToMigrate) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`);
    } catch {
      // Coluna ja existe ou tabela sera criada pelo schemaSql
    }
  }

  // 3. Aplica o schema completo DDL
  const schemaSql = loadSchemaSql();
  db.exec(schemaSql);

  // 4. Garante registro default presente
  try {
    db.exec(`INSERT OR IGNORE INTO projects (id, name, slug, description) VALUES ('default', 'Projeto Padrão', 'default', 'Projeto padrão do sistema')`);
  } catch {
    // Ja inserido
  }
}

export interface ConnectionOptions {
  readonly readonly?: boolean;
  readonly fileMustExist?: boolean;
  readonly timeout?: number;
  readonly verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
  readonly applyMigrations?: boolean;
}

export function createDatabaseConnection(
  dbFilePath: string = env.paths.databaseFile,
  options: ConnectionOptions = {}
): Database.Database {
  if (dbFilePath !== ":memory:") {
    const dbDir = path.dirname(dbFilePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  const {
    readonly = false,
    fileMustExist = false,
    timeout = 10000,
    verbose,
    applyMigrations = true,
  } = options;

  const db = new Database(dbFilePath, {
    readonly,
    fileMustExist,
    timeout,
    verbose,
  });

  // Mandatory PRAGMAs for high-concurrency WAL persistence
  db.pragma("journal_mode = WAL;");
  db.pragma("synchronous = NORMAL;");
  db.pragma("foreign_keys = ON;");
  db.pragma(`busy_timeout = ${timeout};`);

  if (applyMigrations && !readonly) {
    applySchema(db);
  }

  return db;
}

export function initDatabase(
  dbFilePath: string = env.paths.databaseFile,
  options: ConnectionOptions = {}
): Database.Database {
  if (activeDatabase && activeDatabase.open) {
    return activeDatabase;
  }

  ensureDataDirectoriesExist(env.paths);
  activeDatabase = createDatabaseConnection(dbFilePath, options);
  return activeDatabase;
}

export function getDatabase(): Database.Database {
  if (!activeDatabase || !activeDatabase.open) {
    return initDatabase();
  }
  return activeDatabase;
}

export function closeDatabase(): void {
  if (activeDatabase) {
    if (activeDatabase.open) {
      activeDatabase.close();
    }
    activeDatabase = null;
  }
}

export default {
  createDatabaseConnection,
  initDatabase,
  getDatabase,
  closeDatabase,
  applySchema,
  loadSchemaSql,
  EMBEDDED_SCHEMA_SQL,
};
