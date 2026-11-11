import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { getDatabase } from "./connection.js";
import { CATALOG } from "../config/catalog.js";

// ============================================================================
// Tipagens e Contratos de Entidades do Dominio
// ============================================================================

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly cakto_product_id: string | null;
  readonly cakto_webhook_secret: string | null;
  readonly is_active: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CreateProjectInput {
  readonly id?: string;
  readonly name: string;
  readonly slug: string;
  readonly description?: string | null;
  readonly cakto_product_id?: string | null;
  readonly cakto_webhook_secret?: string | null;
  readonly is_active?: number;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly cakto_product_id?: string | null;
  readonly cakto_webhook_secret?: string | null;
  readonly is_active?: number;
}

export interface Customer {
  readonly id: string;
  readonly project_id: string;
  readonly phone: string;
  readonly jid: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly current_state: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface UpsertCustomerInput {
  readonly id?: string;
  readonly project_id?: string;
  readonly phone: string;
  readonly jid?: string | null;
  readonly name: string;
  readonly email?: string | null;
  readonly current_state?: string;
}

export interface Order {
  readonly id: string;
  readonly project_id: string;
  readonly transaction_id: string;
  readonly customer_id: string;
  readonly product_id: string;
  readonly offer_id: string;
  readonly event_type: string;
  readonly status: string;
  readonly paid_at: string | null;
  readonly raw_payload: string;
  readonly is_test?: number;
  readonly created_at: string;
}

export interface CreateOrderInput {
  readonly id?: string;
  readonly project_id?: string;
  readonly transaction_id: string;
  readonly customer_id: string;
  readonly product_id: string;
  readonly offer_id: string;
  readonly event_type: string;
  readonly status: string;
  readonly paid_at?: string | null;
  readonly raw_payload: string | Record<string, unknown>;
  readonly is_test?: number;
}

export type QueueMessageStatus = "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";

export interface QueueJob {
  readonly id: string;
  readonly project_id: string;
  readonly customer_id: string;
  readonly phone: string;
  readonly jid: string | null;
  readonly message_type: string;
  readonly content: string;
  readonly media_path: string | null;
  readonly scheduled_at: string;
  readonly status: QueueMessageStatus;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly whatsapp_message_id?: string | null;
  readonly delivered_at?: string | null;
  readonly is_test?: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface EnqueueJobInput {
  readonly id?: string;
  readonly project_id?: string;
  readonly customer_id: string;
  readonly phone: string;
  readonly jid?: string | null;
  readonly message_type: string;
  readonly content: string;
  readonly media_path?: string | null;
  readonly scheduled_at: string | Date;
  readonly status?: QueueMessageStatus;
  readonly whatsapp_message_id?: string | null;
  readonly is_test?: number;
}

export interface AuditLog {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly entity: string;
  readonly entity_id: string;
  readonly diff_json: string;
  readonly created_at: string;
}

export interface MessageTemplate {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly content: string;
  readonly tags_json: string;
  readonly media_path: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CreateTemplateInput {
  readonly id?: string;
  readonly project_id?: string;
  readonly name: string;
  readonly content: string;
  readonly tags?: readonly string[] | string;
  readonly media_path?: string | null;
}

export interface UpdateTemplateInput {
  readonly project_id?: string;
  readonly name?: string;
  readonly content?: string;
  readonly tags?: readonly string[] | string;
  readonly media_path?: string | null;
}

export interface FunnelTrigger {
  readonly id: string;
  readonly project_id: string;
  readonly trigger_key: string;
  readonly name: string;
  readonly event_type: string;
  readonly is_active: number;
  readonly delay_seconds: number;
  readonly template_id: string | null;
  readonly media_path: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly template_name?: string | null;
  readonly template_content?: string | null;
}

export interface CreateTriggerInput {
  readonly id?: string;
  readonly project_id?: string;
  readonly trigger_key: string;
  readonly name: string;
  readonly event_type: string;
  readonly is_active?: number;
  readonly delay_seconds?: number;
  readonly template_id?: string | null;
  readonly media_path?: string | null;
}

export interface UpdateTriggerInput {
  readonly name?: string;
  readonly event_type?: string;
  readonly is_active?: number;
  readonly delay_seconds?: number;
  readonly template_id?: string | null;
  readonly media_path?: string | null;
}

// ============================================================================
// Utilitarios de Normalizacao
// ============================================================================

export function normalizeIsoDate(dateOrIso?: string | Date | null): string {
  if (!dateOrIso) {
    return new Date().toISOString();
  }
  if (dateOrIso instanceof Date) {
    return dateOrIso.toISOString();
  }
  const parsed = new Date(dateOrIso);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function stringifyPayload(payload: string | Record<string, unknown>): string {
  if (typeof payload === "string") {
    return payload;
  }
  return JSON.stringify(payload);
}

// ============================================================================
// Repositorio de Clientes (CustomerRepository)
// ============================================================================

export class CustomerRepository {
  private readonly db: Database.Database;
  private readonly stmtFindById: Database.Statement<[string]>;
  private readonly stmtFindByPhone: Database.Statement<[string, string]>;
  private readonly stmtFindByJid: Database.Statement<[string, string]>;
  private readonly stmtInsert: Database.Statement<[string, string, string | null, string, string | null, string, string]>;
  private readonly stmtUpdate: Database.Statement<[string, string | null, string | null, string | null, string]>;
  private readonly stmtUpdateState: Database.Statement<[string, string]>;
  private readonly stmtUpdateJid: Database.Statement<[string, string]>;
  private readonly stmtListAll: Database.Statement<[number, number]>;
  private readonly stmtCount: Database.Statement<[]>;

  public get database(): Database.Database {
    return this.db;
  }

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.stmtFindById = db.prepare<[string]>(`SELECT * FROM customers WHERE id = ?`);
    this.stmtFindByPhone = db.prepare(`SELECT * FROM customers WHERE phone = ? AND project_id = ?`);
    this.stmtFindByJid = db.prepare(`SELECT * FROM customers WHERE jid = ? AND project_id = ?`);
    this.stmtInsert = db.prepare<[string, string, string | null, string, string | null, string, string]>(`
      INSERT INTO customers (id, phone, jid, name, email, current_state, created_at, updated_at, project_id)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
      RETURNING *
    `);
    this.stmtUpdate = db.prepare<[string, string | null, string | null, string | null, string]>(`
      UPDATE customers
      SET name = ?,
          email = COALESCE(?, email),
          jid = COALESCE(?, jid),
          current_state = COALESCE(?, current_state),
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *
    `);
    this.stmtUpdateState = db.prepare<[string, string]>(`
      UPDATE customers
      SET current_state = ?,
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *
    `);
    this.stmtUpdateJid = db.prepare<[string, string]>(`
      UPDATE customers
      SET jid = ?,
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *
    `);
    this.stmtListAll = db.prepare<[number, number]>(`
      SELECT * FROM customers
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    this.stmtCount = db.prepare<[]>(`SELECT COUNT(*) as total FROM customers`);
  }

  public findById(id: string): Customer | null {
    const row = this.stmtFindById.get(id) as Customer | undefined;
    return row ?? null;
  }

  public findByPhone(phone: string, projectId = "default"): Customer | null {
    const cleanPhone = phone.trim();
    const row = this.stmtFindByPhone.get(cleanPhone, projectId) as Customer | undefined;
    return row ?? null;
  }

  public findByJid(jid: string, projectId = "default"): Customer | null {
    const cleanJid = jid.trim();
    const row = this.stmtFindByJid.get(cleanJid, projectId) as Customer | undefined;
    return row ?? null;
  }

  public findInboundCustomer(jid: string, phones: string[], projectId?: string): Customer | null {
    const matches = this.db.prepare(`
      SELECT c.* FROM customers c JOIN projects p ON p.id = c.project_id
      WHERE p.is_active = 1 AND (? IS NULL OR c.project_id = ?)
        AND (c.jid = ? OR c.phone IN (SELECT value FROM json_each(?)))
      LIMIT 2
    `).all(projectId ?? null, projectId ?? null, jid, JSON.stringify(phones)) as Customer[];
    return matches.length === 1 ? matches[0] : null;
  }

  public upsert(input: UpsertCustomerInput): Customer {
    const cleanPhone = input.phone.trim();
    const cleanName = input.name.trim();
    const projectId = input.project_id?.trim() || "default";

    return this.db.transaction(() => {
      const existing = this.findByPhone(cleanPhone, projectId);
      if (existing) {
        const updated = this.stmtUpdate.get(
          cleanName,
          input.email?.trim() ?? null,
          input.jid?.trim() ?? null,
          input.current_state?.trim() ?? null,
          existing.id
        ) as Customer;
        return updated;
      }

      const id = input.id ?? `cust_${randomUUID()}`;
      const state = input.current_state?.trim() || "NEW";
      const created = this.stmtInsert.get(
        id,
        cleanPhone,
        input.jid?.trim() ?? null,
        cleanName,
        input.email?.trim() ?? null,
        state,
        projectId
      ) as Customer;
      return created;
    })();
  }

  public updateState(idOrPhone: string, newState: string): Customer | null {
    const target = this.findById(idOrPhone) ?? this.findByPhone(idOrPhone);
    if (!target) return null;
    const updated = this.stmtUpdateState.get(newState.trim(), target.id) as Customer | undefined;
    return updated ?? null;
  }

  public updateJid(id: string, jid: string): Customer | null {
    const updated = this.stmtUpdateJid.get(jid.trim(), id) as Customer | undefined;
    return updated ?? null;
  }

  public listAll(limit = 100, offset = 0, projectId?: string): Customer[] {
    if (projectId) {
      return this.db.prepare(
        "SELECT * FROM customers WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(projectId, Math.max(1, limit), Math.max(0, offset)) as Customer[];
    }
    return this.stmtListAll.all(Math.max(1, limit), Math.max(0, offset)) as Customer[];
  }

  public count(projectId?: string): number {
    if (projectId) {
      const row = this.db.prepare("SELECT COUNT(*) as total FROM customers WHERE project_id = ?").get(projectId) as { total: number } | undefined;
      return row?.total ?? 0;
    }
    const row = this.stmtCount.get() as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public clearCustomers(projectId?: string): number {
    if (projectId) {
      const res = this.db.prepare("DELETE FROM customers WHERE project_id = ?").run(projectId);
      return res.changes;
    }
    const res = this.db.prepare("DELETE FROM customers").run();
    return res.changes;
  }
}

// ============================================================================
// Repositorio de Pedidos e Transacoes (OrderRepository)
// ============================================================================

export class OrderRepository {
  private readonly db: Database.Database;
  private readonly stmtFindById: Database.Statement<[string]>;
  private readonly stmtFindByTransactionAndEvent: Database.Statement<[string, string, string]>;
  private readonly stmtListByCustomer: Database.Statement<[string]>;
  private readonly stmtListByTransaction: Database.Statement<[string, string]>;
  private readonly stmtListAll: Database.Statement<[number, number]>;
  private readonly stmtCount: Database.Statement<[]>;
  private readonly stmtInsert: Database.Statement<[string, string, string, string, string, string, string, string | null, string, string, number]>;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.stmtFindById = db.prepare<[string]>(`SELECT * FROM orders WHERE id = ?`);
    this.stmtFindByTransactionAndEvent = db.prepare(`
      SELECT * FROM orders WHERE transaction_id = ? AND event_type = ? AND project_id = ?
    `);
    this.stmtListByCustomer = db.prepare<[string]>(`
      SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC
    `);
    this.stmtListByTransaction = db.prepare(`
      SELECT * FROM orders WHERE transaction_id = ? AND project_id = ? ORDER BY created_at DESC
    `);
    this.stmtListAll = db.prepare<[number, number]>(`
      SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?
    `);
    this.stmtCount = db.prepare<[]>(`SELECT COUNT(*) as total FROM orders WHERE is_test = 0`);
    this.stmtInsert = db.prepare<[string, string, string, string, string, string, string, string | null, string, string, number]>(`
      INSERT INTO orders (
        id, transaction_id, customer_id, product_id, offer_id,
        event_type, status, paid_at, raw_payload, created_at, project_id, is_test
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
      RETURNING *
    `);
  }

  public findById(id: string): Order | null {
    const row = this.stmtFindById.get(id) as Order | undefined;
    return row ?? null;
  }

  public findByTransactionAndEvent(transactionId: string, eventType: string, projectId = "default"): Order | null {
    const row = this.stmtFindByTransactionAndEvent.get(transactionId.trim(), eventType.trim(), projectId) as Order | undefined;
    return row ?? null;
  }

  public create(input: CreateOrderInput): Order {
    const id = input.id ?? `ord_${randomUUID()}`;
    const payload = stringifyPayload(input.raw_payload);
    const paidAt = input.paid_at ? normalizeIsoDate(input.paid_at) : null;
    const projectId = input.project_id?.trim() || "default";
    if (!this.db.prepare("SELECT 1 FROM customers WHERE id = ? AND project_id = ?").get(input.customer_id.trim(), projectId)) {
      throw new Error("Cliente não pertence ao projeto do pedido.");
    }

    const created = this.stmtInsert.get(
      id,
      input.transaction_id.trim(),
      input.customer_id.trim(),
      input.product_id.trim(),
      input.offer_id.trim(),
      input.event_type.trim(),
      input.status.trim(),
      paidAt,
      payload,
      projectId,
      input.is_test ?? 0
    ) as Order;

    return created;
  }

  /**
   * Idempotent insert within the project.
   * Returns { order, inserted: true } if inserted, or { order, inserted: false } if already existed.
   */
  public createOrIgnore(input: CreateOrderInput): { order: Order; inserted: boolean } {
    const existing = this.findByTransactionAndEvent(input.transaction_id, input.event_type, input.project_id?.trim());
    if (existing) {
      return { order: existing, inserted: false };
    }

    try {
      const order = this.create(input);
      return { order, inserted: true };
    } catch (error: unknown) {
      // Handle potential race condition where another process inserted simultaneously
      const conflictCheck = this.findByTransactionAndEvent(input.transaction_id, input.event_type, input.project_id?.trim());
      if (conflictCheck) {
        return { order: conflictCheck, inserted: false };
      }
      throw error;
    }
  }

  public listByCustomerId(customerId: string): Order[] {
    return this.stmtListByCustomer.all(customerId) as Order[];
  }

  public listByTransactionId(transactionId: string, projectId = "default"): Order[] {
    return this.stmtListByTransaction.all(transactionId, projectId) as Order[];
  }

  public listAll(limit = 100, offset = 0, projectId?: string): Order[] {
    if (projectId) {
      return this.db.prepare(
        "SELECT * FROM orders WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(projectId, Math.max(1, limit), Math.max(0, offset)) as Order[];
    }
    return this.stmtListAll.all(Math.max(1, limit), Math.max(0, offset)) as Order[];
  }

  public count(projectId?: string): number {
    if (projectId) {
      const row = this.db.prepare("SELECT COUNT(*) as total FROM orders WHERE project_id = ? AND is_test = 0").get(projectId) as { total: number } | undefined;
      return row?.total ?? 0;
    }
    const row = this.stmtCount.get() as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public clearOrders(projectId?: string): number {
    if (projectId) {
      const res = this.db.prepare("DELETE FROM orders WHERE project_id = ?").run(projectId);
      return res.changes;
    }
    const res = this.db.prepare("DELETE FROM orders").run();
    return res.changes;
  }
}

// ============================================================================
// Repositorio da Fila de Mensagens (MessageQueueRepository)
// ============================================================================

export class MessageQueueRepository {
  private readonly db: Database.Database;
  private readonly stmtFindById: Database.Statement<[string]>;
  private readonly stmtFindDueJobs: Database.Statement<[string, number]>;
  private readonly stmtFindNextDue: Database.Statement<[string]>;
  private readonly stmtInsert: Database.Statement<[string, string, string, string | null, string, string, string | null, string, string, string, number]>;
  private readonly stmtMarkProcessing: Database.Statement<[string]>;
  private readonly stmtMarkSent: Database.Statement<[string]>;
  private readonly stmtMarkFailedTerminal: Database.Statement<[string, string]>;
  private readonly stmtMarkFailedRetry: Database.Statement<[string, string, string]>;
  private readonly stmtCancelByCustomer: Database.Statement<[string]>;
  private readonly stmtCancelByCustomerAndType: Database.Statement<[string, string]>;
  private readonly stmtRescheduleJob: Database.Statement<[string, string]>;
  private readonly stmtReschedulePendingByType: Database.Statement<[string, string, string]>;
  private readonly stmtListByCustomer: Database.Statement<[string]>;
  private readonly stmtListByCustomerAndStatus: Database.Statement<[string, string]>;
  private readonly stmtListPending: Database.Statement<[number]>;
  private readonly stmtCountByStatus: Database.Statement<[string]>;
  private readonly stmtDelete: Database.Statement<[string]>;
  private readonly stmtFindCustomerProject: Database.Statement<[string]>;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.stmtFindById = db.prepare<[string]>(`SELECT * FROM message_queue WHERE id = ?`);
    this.stmtFindCustomerProject = db.prepare<[string]>(`SELECT project_id FROM customers WHERE id = ?`);
    this.stmtFindDueJobs = db.prepare<[string, number]>(`
      SELECT * FROM message_queue
      WHERE status = 'PENDING' AND datetime(scheduled_at) <= datetime(?)
        AND project_id IN (SELECT id FROM projects WHERE is_active = 1)
      ORDER BY datetime(scheduled_at) ASC, scheduled_at ASC
      LIMIT ?
    `);
    this.stmtFindNextDue = db.prepare<[string]>(`
      SELECT * FROM message_queue
      WHERE status = 'PENDING' AND datetime(scheduled_at) <= datetime(?)
        AND project_id IN (SELECT id FROM projects WHERE is_active = 1)
      ORDER BY datetime(scheduled_at) ASC, scheduled_at ASC
      LIMIT 1
    `);
    this.stmtInsert = db.prepare<[string, string, string, string | null, string, string, string | null, string, string, string, number]>(`
      INSERT INTO message_queue (
        id, customer_id, phone, jid, message_type, content, media_path,
        scheduled_at, status, attempts, last_error, created_at, updated_at, project_id, is_test
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, datetime('now'), datetime('now'), ?, ?)
      RETURNING *
    `);
    this.stmtMarkProcessing = db.prepare<[string]>(`
      UPDATE message_queue
      SET status = 'PROCESSING',
          attempts = attempts + 1,
          updated_at = datetime('now')
      WHERE id = ? AND status = 'PENDING'
        AND project_id IN (SELECT id FROM projects WHERE is_active = 1)
    `);
    this.stmtMarkSent = db.prepare<[string]>(`
      UPDATE message_queue
      SET status = 'SENT',
          updated_at = datetime('now')
      WHERE id = ?
    `);
    this.stmtMarkFailedTerminal = db.prepare<[string, string]>(`
      UPDATE message_queue
      SET status = 'FAILED',
          last_error = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    this.stmtMarkFailedRetry = db.prepare<[string, string, string]>(`
      UPDATE message_queue
      SET status = 'PENDING',
          last_error = ?,
          scheduled_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    this.stmtCancelByCustomer = db.prepare<[string]>(`
      UPDATE message_queue
      SET status = 'CANCELLED',
          updated_at = datetime('now')
      WHERE customer_id = ? AND status = 'PENDING'
    `);
    this.stmtCancelByCustomerAndType = db.prepare<[string, string]>(`
      UPDATE message_queue
      SET status = 'CANCELLED',
          updated_at = datetime('now')
      WHERE customer_id = ? AND message_type = ? AND status = 'PENDING'
    `);
    this.stmtRescheduleJob = db.prepare<[string, string]>(`
      UPDATE message_queue
      SET scheduled_at = ?,
          updated_at = datetime('now')
      WHERE id = ? AND status = 'PENDING'
    `);
    this.stmtReschedulePendingByType = db.prepare<[string, string, string]>(`
      UPDATE message_queue
      SET scheduled_at = ?,
          updated_at = datetime('now')
      WHERE customer_id = ? AND message_type = ? AND status = 'PENDING'
    `);
    this.stmtListByCustomer = db.prepare<[string]>(`
      SELECT * FROM message_queue WHERE customer_id = ? ORDER BY scheduled_at ASC
    `);
    this.stmtListByCustomerAndStatus = db.prepare<[string, string]>(`
      SELECT * FROM message_queue WHERE customer_id = ? AND status = ? ORDER BY scheduled_at ASC
    `);
    this.stmtListPending = db.prepare<[number]>(`
      SELECT * FROM message_queue WHERE status = 'PENDING' ORDER BY scheduled_at ASC LIMIT ?
    `);
    this.stmtCountByStatus = db.prepare<[string]>(`
      SELECT COUNT(*) as total FROM message_queue WHERE status = ?
    `);
    this.stmtDelete = db.prepare<[string]>(`
      DELETE FROM message_queue WHERE id = ?
    `);
  }

  public findById(id: string): QueueJob | null {
    const row = this.stmtFindById.get(id) as QueueJob | undefined;
    return row ?? null;
  }

  public recoverInterrupted(): void {
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE message_queue
        SET status = 'PENDING', attempts = MAX(0, attempts - 1), updated_at = datetime('now')
        WHERE status = 'PROCESSING' AND id NOT IN (SELECT job_id FROM queue_dispatch_attempts)
      `).run();
      this.db.prepare(`
        UPDATE message_queue SET status = 'FAILED', last_error = 'ENVIO_INDETERMINADO', updated_at = datetime('now')
        WHERE status = 'PROCESSING'
      `).run();
    }).immediate();
  }

  public enqueue(input: EnqueueJobInput): QueueJob {
    const id = input.id ?? `job_${randomUUID()}`;
    const scheduledAt = normalizeIsoDate(input.scheduled_at);
    const status = input.status ?? "PENDING";
    const customer = this.stmtFindCustomerProject.get(input.customer_id.trim()) as { project_id: string } | undefined;
    const projectId = input.project_id?.trim() || customer?.project_id || "default";
    if (!customer || customer.project_id !== projectId) throw new Error("Cliente não pertence ao projeto do agendamento.");

    const job = this.stmtInsert.get(
      id,
      input.customer_id.trim(),
      input.phone.trim(),
      input.jid?.trim() ?? null,
      input.message_type.trim(),
      input.content,
      input.media_path?.trim() ?? null,
      scheduledAt,
      status,
      projectId,
      input.is_test ?? 0
    ) as QueueJob;

    return job;
  }

  public enqueueBatch(inputs: EnqueueJobInput[]): QueueJob[] {
    if (inputs.length === 0) return [];

    return this.db.transaction(() => {
      const results: QueueJob[] = [];
      for (const input of inputs) {
        results.push(this.enqueue(input));
      }
      return results;
    })();
  }

  public findDueJobs(referenceTime: string | Date = new Date(), limit = 10, projectId?: string): QueueJob[] {
    const refIso = normalizeIsoDate(referenceTime);
    if (projectId) {
      return this.db.prepare(
        "SELECT * FROM message_queue WHERE status = 'PENDING' AND datetime(scheduled_at) <= datetime(?) AND project_id = ? ORDER BY datetime(scheduled_at) ASC, scheduled_at ASC LIMIT ?"
      ).all(refIso, projectId, Math.max(1, limit)) as QueueJob[];
    }
    return this.stmtFindDueJobs.all(refIso, Math.max(1, limit)) as QueueJob[];
  }

  public findNextDueJob(referenceTime: string | Date = new Date(), projectId?: string): QueueJob | null {
    const refIso = normalizeIsoDate(referenceTime);
    if (projectId) {
      const row = this.db.prepare(
        "SELECT * FROM message_queue WHERE status = 'PENDING' AND datetime(scheduled_at) <= datetime(?) AND project_id = ? ORDER BY datetime(scheduled_at) ASC, scheduled_at ASC LIMIT 1"
      ).get(refIso, projectId) as QueueJob | undefined;
      return row ?? null;
    }
    const row = this.stmtFindNextDue.get(refIso) as QueueJob | undefined;
    return row ?? null;
  }

  public markAsProcessing(id: string): boolean {
    const res = this.stmtMarkProcessing.run(id);
    return res.changes > 0;
  }

  public markAsSent(id: string, whatsappMessageId?: string | null): boolean {
    if (whatsappMessageId) {
      const res = this.db.prepare(`
        UPDATE message_queue
        SET status = 'SENT',
            whatsapp_message_id = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(whatsappMessageId, id);
      return res.changes > 0;
    }
    const res = this.stmtMarkSent.run(id);
    return res.changes > 0;
  }

  public markAsDelivered(idOrMessageId: string): boolean {
    const res = this.db.prepare(`
      UPDATE message_queue
      SET delivered_at = datetime('now'),
          updated_at = datetime('now')
      WHERE (id = ? OR whatsapp_message_id = ?) AND delivered_at IS NULL
    `).run(idOrMessageId, idOrMessageId);
    return res.changes > 0;
  }

  public cancelPendingTestJobs(projectId: string): number {
    const res = this.db.prepare(`
      UPDATE message_queue
      SET status = 'CANCELLED',
          updated_at = datetime('now')
      WHERE project_id = ? AND is_test = 1 AND status = 'PENDING'
    `).run(projectId);
    return res.changes;
  }

  public markAsFailed(
    id: string,
    errorMessage: string,
    maxAttempts = 3,
    retryDelaySeconds = 60
  ): boolean {
    const job = this.findById(id);
    if (!job) return false;

    if (job.attempts >= maxAttempts) {
      const res = this.stmtMarkFailedTerminal.run(errorMessage.slice(0, 1000), id);
      return res.changes > 0;
    }

    const nextRetryDate = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
    const res = this.stmtMarkFailedRetry.run(errorMessage.slice(0, 1000), nextRetryDate, id);
    return res.changes > 0;
  }

  public cancelPendingByCustomer(customerId: string, messageType?: string): number {
    if (messageType) {
      const res = this.stmtCancelByCustomerAndType.run(customerId, messageType.trim());
      return res.changes;
    }
    const res = this.stmtCancelByCustomer.run(customerId);
    return res.changes;
  }

  public rescheduleJob(id: string, newScheduledAt: string | Date): boolean {
    const isoDate = normalizeIsoDate(newScheduledAt);
    const res = this.stmtRescheduleJob.run(isoDate, id);
    return res.changes > 0;
  }

  /**
   * Reschedules pending jobs of a given message type for a customer.
   * Crucial for Micro-Commitment: accelerates PITCH_UPSELL_1 to `now` when customer replies!
   */
  public reschedulePendingByType(
    customerId: string,
    messageType: string,
    newScheduledAt: string | Date = new Date()
  ): number {
    const isoDate = normalizeIsoDate(newScheduledAt);
    const res = this.stmtReschedulePendingByType.run(isoDate, customerId, messageType.trim());
    return res.changes;
  }

  public listByCustomerId(customerId: string, status?: QueueMessageStatus): QueueJob[] {
    if (status) {
      return this.stmtListByCustomerAndStatus.all(customerId, status) as QueueJob[];
    }
    return this.stmtListByCustomer.all(customerId) as QueueJob[];
  }

  public listPending(limit = 100, projectId?: string): QueueJob[] {
    if (projectId) {
      return this.db.prepare(
        "SELECT * FROM message_queue WHERE status = 'PENDING' AND project_id = ? ORDER BY scheduled_at ASC LIMIT ?"
      ).all(projectId, Math.max(1, limit)) as QueueJob[];
    }
    return this.stmtListPending.all(Math.max(1, limit)) as QueueJob[];
  }

  public countByStatus(status: QueueMessageStatus, projectId?: string): number {
    if (projectId) {
      const row = this.db.prepare(
        "SELECT COUNT(*) as total FROM message_queue WHERE status = ? AND project_id = ?"
      ).get(status, projectId) as { total: number } | undefined;
      return row?.total ?? 0;
    }
    const row = this.stmtCountByStatus.get(status) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public deleteJob(id: string): boolean {
    const res = this.stmtDelete.run(id);
    return res.changes > 0;
  }

  public listAll(options: { projectId?: string; status?: QueueMessageStatus; limit?: number; offset?: number } = {}): QueueJob[] {
    const { projectId, status, limit = 50, offset = 0 } = options;
    if (projectId && status) {
      return this.db.prepare(
        "SELECT * FROM message_queue WHERE project_id = ? AND status = ? ORDER BY scheduled_at DESC LIMIT ? OFFSET ?"
      ).all(projectId, status, Math.max(1, limit), Math.max(0, offset)) as QueueJob[];
    }
    if (projectId) {
      return this.db.prepare(
        "SELECT * FROM message_queue WHERE project_id = ? ORDER BY scheduled_at DESC LIMIT ? OFFSET ?"
      ).all(projectId, Math.max(1, limit), Math.max(0, offset)) as QueueJob[];
    }
    if (status) {
      return this.db.prepare(
        "SELECT * FROM message_queue WHERE status = ? ORDER BY scheduled_at DESC LIMIT ? OFFSET ?"
      ).all(status, Math.max(1, limit), Math.max(0, offset)) as QueueJob[];
    }
    return this.db.prepare(
      "SELECT * FROM message_queue ORDER BY scheduled_at DESC LIMIT ? OFFSET ?"
    ).all(Math.max(1, limit), Math.max(0, offset)) as QueueJob[];
  }

  public clearQueue(projectId?: string): number {
    if (projectId) {
      const res = this.db.prepare("DELETE FROM message_queue WHERE project_id = ?").run(projectId);
      return res.changes;
    }
    const res = this.db.prepare("DELETE FROM message_queue").run();
    return res.changes;
  }
}

// ============================================================================
// Repositorio de Auditoria (AuditLogRepository)
// ============================================================================

export class AuditLogRepository {
  private readonly db: Database.Database;
  private readonly stmtInsert: Database.Statement<[string, string, string, string, string, string]>;
  private readonly stmtList: Database.Statement<[number]>;
  private readonly stmtListByEntity: Database.Statement<[string, number]>;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.stmtInsert = db.prepare<[string, string, string, string, string, string]>(`
      INSERT INTO audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    this.stmtList = db.prepare<[number]>(`
      SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?
    `);
    this.stmtListByEntity = db.prepare<[string, number]>(`
      SELECT * FROM audit_logs WHERE entity = ? ORDER BY created_at DESC LIMIT ?
    `);
  }

  public log(actor: string, action: string, entity: string, entityId: string, diff: unknown): void {
    const id = `aud_${randomUUID()}`;
    const diffJson = typeof diff === "string" ? diff : JSON.stringify(diff);
    this.stmtInsert.run(id, actor, action, entity, entityId, diffJson);
  }

  public listLogs(entity?: string, limit = 50): AuditLog[] {
    if (entity) {
      return this.stmtListByEntity.all(entity, Math.max(1, limit)) as AuditLog[];
    }
    return this.stmtList.all(Math.max(1, limit)) as AuditLog[];
  }

  public listByEntity(entity: string, entityId?: string): AuditLog[] {
    if (entityId) {
      const stmt = this.db.prepare<[string, string]>(
        "SELECT * FROM audit_logs WHERE entity = ? AND entity_id = ? ORDER BY created_at DESC"
      );
      return stmt.all(entity, entityId) as AuditLog[];
    }
    return this.stmtListByEntity.all(entity, 100) as AuditLog[];
  }
}

// ============================================================================
// Repositorio de Projetos (ProjectRepository)
// ============================================================================

export class ProjectRepository {
  private readonly db: Database.Database;
  private readonly stmtFindById: Database.Statement<[string]>;
  private readonly stmtFindBySlug: Database.Statement<[string]>;
  private readonly stmtFindByCaktoProductId: Database.Statement<[string]>;
  private readonly stmtListAll: Database.Statement<[]>;
  private readonly stmtInsert: Database.Statement<[string, string, string, string | null, string | null, string | null, number]>;
  private readonly stmtUpdate: Database.Statement<[string, string, string | null, string | null, string | null, number, string]>;
  private readonly stmtDelete: Database.Statement<[string]>;
  private readonly stmtCount: Database.Statement<[]>;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.stmtFindById = db.prepare<[string]>(`SELECT * FROM projects WHERE id = ?`);
    this.stmtFindBySlug = db.prepare<[string]>(`SELECT * FROM projects WHERE slug = ?`);
    this.stmtFindByCaktoProductId = db.prepare<[string]>(`SELECT * FROM projects WHERE cakto_product_id = ? AND is_active = 1 LIMIT 1`);
    this.stmtListAll = db.prepare<[]>(`SELECT * FROM projects ORDER BY created_at ASC`);
    this.stmtInsert = db.prepare<[string, string, string, string | null, string | null, string | null, number]>(`
      INSERT INTO projects (id, name, slug, description, cakto_product_id, cakto_webhook_secret, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      RETURNING *
    `);
    this.stmtUpdate = db.prepare<[string, string, string | null, string | null, string | null, number, string]>(`
      UPDATE projects
      SET name = ?,
          slug = ?,
          description = ?,
          cakto_product_id = ?,
          cakto_webhook_secret = ?,
          is_active = ?,
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *
    `);
    this.stmtDelete = db.prepare<[string]>(`DELETE FROM projects WHERE id = ?`);
    this.stmtCount = db.prepare<[]>(`SELECT COUNT(*) as total FROM projects`);
  }

  public findById(id: string): Project | null {
    const row = this.stmtFindById.get(id) as Project | undefined;
    return row ?? null;
  }

  public findBySlug(slug: string): Project | null {
    const row = this.stmtFindBySlug.get(slug.trim().toLowerCase()) as Project | undefined;
    return row ?? null;
  }

  public findByCaktoProductId(productId: string): Project | null {
    const row = this.stmtFindByCaktoProductId.get(productId.trim()) as Project | undefined;
    return row ?? null;
  }

  public listAll(): Project[] {
    return this.stmtListAll.all() as Project[];
  }

  public create(input: CreateProjectInput): Project {
    const id = input.id ?? `proj_${randomUUID()}`;
    const slug = input.slug.trim().toLowerCase();
    const row = this.stmtInsert.get(
      id,
      input.name.trim(),
      slug,
      input.description?.trim() ?? null,
      input.cakto_product_id?.trim() ?? null,
      input.cakto_webhook_secret?.trim() ?? null,
      input.is_active ?? 1
    ) as Project;
    return row;
  }

  public update(id: string, input: UpdateProjectInput): Project | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const name = input.name !== undefined ? input.name.trim() : existing.name;
    const slug = input.slug !== undefined ? input.slug.trim().toLowerCase() : existing.slug;
    const description = input.description !== undefined ? input.description?.trim() ?? null : existing.description;
    const caktoProductId = input.cakto_product_id !== undefined ? input.cakto_product_id?.trim() ?? null : existing.cakto_product_id;
    const caktoSecret = input.cakto_webhook_secret !== undefined ? input.cakto_webhook_secret?.trim() ?? null : existing.cakto_webhook_secret;
    const isActive = input.is_active !== undefined ? input.is_active : existing.is_active;

    const updated = this.stmtUpdate.get(
      name,
      slug,
      description,
      caktoProductId,
      caktoSecret,
      isActive,
      id
    ) as Project;
    return updated;
  }

  public delete(id: string): boolean {
    if (id === "default") {
      throw new Error("Não é permitido excluir o projeto padrão 'default'.");
    }
    const res = this.stmtDelete.run(id);
    return res.changes > 0;
  }

  public count(): number {
    const row = this.stmtCount.get() as { total: number } | undefined;
    return row?.total ?? 0;
  }
}

// ============================================================================
// Repositorio de Templates de Mensagens (TemplateRepository)
// ============================================================================

export class TemplateRepository {
  private readonly db: Database.Database;
  private readonly stmtInsert: Database.Statement<[string, string, string, string, string | null, string]>;
  private readonly stmtFindById: Database.Statement<[string]>;
  private readonly stmtFindByName: Database.Statement<[string]>;
  private readonly stmtFindAll: Database.Statement<[]>;
  private readonly stmtDelete: Database.Statement<[string]>;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.stmtInsert = db.prepare<[string, string, string, string, string | null, string]>(`
      INSERT INTO message_templates (id, name, content, tags_json, media_path, created_at, updated_at, project_id)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
    `);
    this.stmtFindById = db.prepare<[string]>(`
      SELECT * FROM message_templates WHERE id = ?
    `);
    this.stmtFindByName = db.prepare<[string]>(`
      SELECT * FROM message_templates WHERE name = ?
    `);
    this.stmtFindAll = db.prepare<[]>(`
      SELECT * FROM message_templates ORDER BY created_at DESC, rowid DESC
    `);
    this.stmtDelete = db.prepare<[string]>(`
      DELETE FROM message_templates WHERE id = ?
    `);
  }

  public create(input: CreateTemplateInput): MessageTemplate {
    const id = input.id || `tpl_${randomUUID()}`;
    const name = input.name.trim();
    const content = input.content.trim();
    const projectId = input.project_id?.trim() || "default";
    const tagsJson = Array.isArray(input.tags)
      ? JSON.stringify(input.tags)
      : typeof input.tags === "string"
      ? (input.tags.startsWith("[") ? input.tags : JSON.stringify(input.tags.split(",").map((t) => t.trim()).filter(Boolean)))
      : JSON.stringify(this.extractTags(content));
    const mediaPath = input.media_path ? input.media_path.trim() : null;

    this.stmtInsert.run(id, name, content, tagsJson, mediaPath, projectId);
    return this.findById(id)!;
  }

  public findById(id: string): MessageTemplate | null {
    const row = this.stmtFindById.get(id) as MessageTemplate | undefined;
    return row ?? null;
  }

  public findByName(name: string, projectId = "default"): MessageTemplate | null {
    const stmt = this.db.prepare<[string, string]>(
      "SELECT * FROM message_templates WHERE name = ? AND project_id = ? LIMIT 1"
    );
    const row = stmt.get(name, projectId) as MessageTemplate | undefined;
    if (row) return row;
    if (projectId !== "default") {
      const defaultRow = stmt.get(name, "default") as MessageTemplate | undefined;
      return defaultRow ?? null;
    }
    return null;
  }

  public findAll(projectId?: string): MessageTemplate[] {
    if (projectId) {
      return this.db.prepare(
        "SELECT * FROM message_templates WHERE project_id = ? ORDER BY created_at DESC, rowid DESC"
      ).all(projectId) as MessageTemplate[];
    }
    return this.stmtFindAll.all() as MessageTemplate[];
  }

  public update(id: string, input: UpdateTemplateInput): MessageTemplate | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    const content = input.content !== undefined ? input.content.trim() : existing.content;
    const projectId = input.project_id !== undefined ? input.project_id.trim() : existing.project_id;
    const tagsJson = input.tags !== undefined
      ? (Array.isArray(input.tags)
          ? JSON.stringify(input.tags)
          : typeof input.tags === "string"
          ? (input.tags.startsWith("[") ? input.tags : JSON.stringify(input.tags.split(",").map((t) => t.trim()).filter(Boolean)))
          : JSON.stringify(this.extractTags(content)))
      : (input.content !== undefined ? JSON.stringify(this.extractTags(content)) : existing.tags_json);
    const mediaPath = input.media_path !== undefined
      ? (input.media_path ? input.media_path.trim() : null)
      : existing.media_path;

    this.db.prepare(`
      UPDATE message_templates
      SET name = ?, content = ?, tags_json = ?, media_path = ?, project_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, content, tagsJson, mediaPath, projectId, id);

    return this.findById(id);
  }

  public delete(id: string): boolean {
    const result = this.stmtDelete.run(id);
    return result.changes > 0;
  }

  public extractTags(content: string): string[] {
    const tagMatches = content.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
    const doubleMatches = content.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];
    const set = new Set<string>();
    for (const m of tagMatches) {
      const clean = m.slice(1, -1);
      if (!clean.includes("|")) set.add(clean);
    }
    for (const m of doubleMatches) {
      const clean = m.slice(2, -2);
      if (!clean.includes("|")) set.add(clean);
    }
    return Array.from(set);
  }

  public interpolate(
    contentOrTemplate: string | MessageTemplate,
    variables: Record<string, string | number | undefined | null> = {}
  ): string {
    const rawContent = typeof contentOrTemplate === "string" ? contentOrTemplate : contentOrTemplate.content;
    let resolved = rawContent;

    // Normaliza variaveis e aliases
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      const val = value !== undefined && value !== null ? String(value) : "";
      vars[key] = val;
      if (key === "first_name") vars["primeiro_nome"] = val;
      if (key === "primeiro_nome") vars["first_name"] = val;
      if (key === "name") vars["nome"] = val;
      if (key === "nome") vars["name"] = val;
      if (key === "product_name") vars["produto"] = val;
      if (key === "produto") vars["product_name"] = val;
      if (key === "pix_code") vars["pix_copia_cola"] = val;
      if (key === "pix_copia_cola") vars["pix_code"] = val;
      if (key === "checkout_url") {
        if (!vars["link"]) vars["link"] = val;
        if (!vars["link_checkout"]) vars["link_checkout"] = val;
        if (!vars["link_acesso"]) vars["link_acesso"] = val;
        if (!vars["link_upsell_1"]) vars["link_upsell_1"] = val;
        if (!vars["link_upsell_2"]) vars["link_upsell_2"] = val;
        if (!vars["link_downsell"]) vars["link_downsell"] = val;
      }
      if (key === "link") {
        if (!vars["link_checkout"]) vars["link_checkout"] = val;
        if (!vars["checkout_url"]) vars["checkout_url"] = val;
      }
    }

    // 1. Interpola tags {{tag}} e {tag}
    for (const [key, valStr] of Object.entries(vars)) {
      resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), valStr);
      resolved = resolved.replace(new RegExp(`\\{${key}\\}`, "g"), valStr);
    }

    // 2. Resolve Spintax: {opcao1|opcao2|opcao3}
    const spintaxRegex = /\{([^{}]+)\}/;
    let loopGuard = 0;
    while (loopGuard++ < 100) {
      const match = spintaxRegex.exec(resolved);
      if (!match) break;
      if (match[1].includes("|")) {
        const choices = match[1].split("|");
        const chosen = choices[Math.floor(Math.random() * choices.length)];
        resolved = resolved.slice(0, match.index) + chosen + resolved.slice(match.index + match[0].length);
      } else {
        break;
      }
    }

    return resolved;
  }

  public validateSpintax(content: string): { valid: boolean; error?: string } {
    let openCount = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "{") openCount++;
      if (content[i] === "}") {
        openCount--;
        if (openCount < 0) {
          return { valid: false, error: `Caractere '}' inesperado na posicao ${i}.` };
        }
      }
    }
    if (openCount > 0) {
      return { valid: false, error: "Existem chaves '{' nao fechadas no template." };
    }
    return { valid: true };
  }

  public seedDefaultTemplates(force = false): number {
    const existing = this.findAll();
    if (!force && existing.length > 0) return 0;

    const defaultTemplates: CreateTemplateInput[] = [
      {
        id: "PIX_RECOVERY",
        name: "PIX_RECOVERY",
        content: "{Ola|Oi|Fala}, *{primeiro_nome}*! Vi que voce gerou o Pix para o *{produto}*, mas ainda nao concluiu o pagamento.\n\nPara nao perder sua vaga e o valor promocional, segue abaixo o seu codigo Pix Copia e Cola:\n\n```{pix_code}```\n\nAssim que pagar, o sistema libera seu material imediatamente por aqui. Precisa de alguma ajuda?",
        tags: ["nome", "primeiro_nome", "produto", "pix_code"],
        media_path: null,
      },
      {
        id: "MAIN_DELIVERY",
        name: "MAIN_DELIVERY",
        content: "{Ola|Oi|Fala}, *{primeiro_nome}*! Parabens pela decisao! Seu pagamento do *{produto}* foi confirmado com sucesso.\n\nAcabei de anexar acima o seu material em PDF para download imediato.\n\nConseguiu abrir o material direitinho? Me responde SIM aqui so para eu confirmar.",
        tags: ["nome", "primeiro_nome", "produto"],
        media_path: "data/media/guia_definitivo_alta_conversao.pdf",
      },
      {
        id: "UPSELL_1_OFFER",
        name: "UPSELL_1_OFFER",
        content: "{Escuta|Ouve} esse audio rapidinho de 1 minuto que gravei exclusivamente para voce, *{primeiro_nome}*.\n\nComo voce ja garantiu o metodo principal, liberei uma condicao unica de upgrade para ter acesso aos nossos templates prontos de alta conversao:\n\nAcesse pelo link oficial: {link}",
        tags: ["nome", "primeiro_nome", "produto", "link"],
        media_path: "data/media/pitch_upsell_1.ogg",
      },
      {
        id: "UPSELL_1_DELIVERY",
        name: "UPSELL_1_DELIVERY",
        content: "{Perfeito|Show|Sensacional}, *{primeiro_nome}*! Seu upgrade para o Acelerador foi ativado com sucesso.\n\nSegue acima o material completo do Pacote de Templates.\n\nMaterial do Acelerador entregue! Conseguiu baixar o arquivo?",
        tags: ["primeiro_nome"],
        media_path: "data/media/pack_templates_acelerador.pdf",
      },
      {
        id: "DOWNSELL_OFFER",
        name: "DOWNSELL_OFFER",
        content: "{Oi|Fala}, *{primeiro_nome}*! Sei que a rotina e corrida e talvez o investimento no pacote completo nao tenha sido no momento ideal.\n\nPara nao te deixar sem apoio na implementacao, conversei com a equipe e liberamos uma versao essencial com 65% de desconto apenas hoje:\n\nAcesse pelo link oficial: {link}",
        tags: ["nome", "primeiro_nome", "produto", "link"],
        media_path: "data/media/pitch_downsell.ogg",
      },
      {
        id: "DOWNSELL_DELIVERY",
        name: "DOWNSELL_DELIVERY",
        content: "Parabens, *{primeiro_nome}*! Seu acesso a Versao Essencial dos Templates foi entregue acima.\n\nTudo certo com o download dos seus templates essenciais?",
        tags: ["primeiro_nome"],
        media_path: "data/media/pack_templates_essenciais.pdf",
      },
      {
        id: "UPSELL_2_OFFER",
        name: "UPSELL_2_OFFER",
        content: "*{primeiro_nome}*, preparei uma oportunidade final restrita apenas a quem adquiriu o pacote completo.\n\n{Escuta|Confere} o audio explicativo que mandei acima. Se quiser dar o proximo passo na sua operacao, acesse pelo link especial:\n\nAcesse pelo link oficial: {link}",
        tags: ["nome", "primeiro_nome", "produto", "link"],
        media_path: "data/media/pitch_upsell_2.ogg",
      },
      {
        id: "UPSELL_2_DELIVERY",
        name: "UPSELL_2_DELIVERY",
        content: "Acesso liberado a Masterclass de Escala! Bons estudos e boas vendas, *{primeiro_nome}*.",
        tags: ["primeiro_nome"],
        media_path: "data/media/masterclass_escala_acesso.pdf",
      },
    ];

    let inserted = 0;
    for (const tpl of defaultTemplates) {
      if (!this.findById(tpl.id || "") && !this.findByName(tpl.name)) {
        this.create(tpl);
        inserted++;
      }
    }

    return inserted;
  }

  public seedFunnelTemplates(force = false): number {
    const funnelTemplates: CreateTemplateInput[] = [
      {
        id: "PIX_RECOVERY",
        name: "PIX_RECOVERY",
        content:
          CATALOG.MAIN.pixRecovery?.messagesSpintax[0] ??
          "{Ola|Oi|Fala}, *{primeiro_nome}*! Vi que voce gerou o Pix para o *{produto}*, mas ainda nao concluiu o pagamento.\n\nPara nao perder sua vaga e o valor promocional, segue abaixo o seu codigo Pix Copia e Cola:\n\n```{pix_code}```\n\nAssim que pagar, o sistema libera seu material imediatamente por aqui. Precisa de alguma ajuda?",
        tags: ["nome", "primeiro_nome", "produto", "pix_code"],
        media_path: null,
      },
      {
        id: "MAIN_DELIVERY",
        name: "MAIN_DELIVERY",
        content:
          CATALOG.MAIN.delivery.messagesSpintax[0] ??
          "{Ola|Oi|Fala}, *{primeiro_nome}*! Parabens pela decisao! Seu pagamento do *{produto}* foi confirmado com sucesso.\n\nAcabei de anexar acima o seu material em PDF para download imediato.\n\nConseguiu abrir o material direitinho? Me responde SIM aqui so para eu confirmar.",
        tags: ["nome", "primeiro_nome", "produto", "link"],
        media_path: CATALOG.MAIN.delivery.mediaFiles[0]?.fileName
          ? `data/media/${CATALOG.MAIN.delivery.mediaFiles[0].fileName}`
          : "data/media/guia_definitivo_alta_conversao.pdf",
      },
      {
        id: "UPSELL_1_OFFER",
        name: "UPSELL_1_OFFER",
        content:
          CATALOG.UPSELL_1.pitch?.messagesSpintax[0] ??
          "{Escuta|Ouve} esse audio rapidinho de 1 minuto que gravei exclusivamente para voce, *{primeiro_nome}*.\n\nComo voce ja garantiu o metodo principal, liberei uma condicao unica de upgrade para ter acesso aos nossos templates prontos de alta conversao:\n\nAcesse pelo link oficial: {link}",
        tags: ["nome", "primeiro_nome", "produto", "link"],
        media_path: CATALOG.UPSELL_1.pitch?.audioFileName
          ? `data/media/${CATALOG.UPSELL_1.pitch.audioFileName}`
          : "data/media/pitch_upsell_1.ogg",
      },
      {
        id: "DOWNSELL_OFFER",
        name: "DOWNSELL_OFFER",
        content:
          CATALOG.DOWNSELL.pitch?.messagesSpintax[0] ??
          "{Oi|Fala}, *{primeiro_nome}*! Sei que a rotina e corrida e talvez o investimento no pacote completo nao tenha sido no momento ideal.\n\nPara nao te deixar sem apoio na implementacao, conversei com a equipe e liberamos uma versao essencial com 65% de desconto apenas hoje:\n\nAcesse pelo link oficial: {link}",
        tags: ["nome", "primeiro_nome", "produto", "link"],
        media_path: CATALOG.DOWNSELL.pitch?.audioFileName
          ? `data/media/${CATALOG.DOWNSELL.pitch.audioFileName}`
          : "data/media/pitch_downsell.ogg",
      },
      {
        id: "UPSELL_2_OFFER",
        name: "UPSELL_2_OFFER",
        content:
          CATALOG.UPSELL_2.pitch?.messagesSpintax[0] ??
          "*{primeiro_nome}*, preparei uma oportunidade final restrita apenas a quem adquiriu o pacote completo.\n\n{Escuta|Confere} o audio explicativo que mandei acima. Se quiser dar o proximo passo na sua operacao, acesse pelo link especial:\n\nAcesse pelo link oficial: {link}",
        tags: ["nome", "primeiro_nome", "produto", "link"],
        media_path: CATALOG.UPSELL_2.pitch?.audioFileName
          ? `data/media/${CATALOG.UPSELL_2.pitch.audioFileName}`
          : "data/media/pitch_upsell_2.ogg",
      },
    ];

    let inserted = 0;
    for (const tpl of funnelTemplates) {
      const existing = (tpl.id ? this.findById(tpl.id) : null) || this.findByName(tpl.name);
      if (!existing) {
        this.create(tpl);
        inserted++;
      } else if (force) {
        this.update(existing.id, {
          content: tpl.content,
          tags: tpl.tags,
          media_path: tpl.media_path,
        });
        inserted++;
      }
    }
    return inserted;
  }

  public seedIfEmpty(force = false): number {
    const existing = this.findAll();
    if (!force && existing.length > 0) return 0;
    return this.seedDefaultTemplates(force);
  }
}

// ============================================================================
// Repositorio de Gatilhos e Regras do Funil (FunnelTriggerRepository)
// ============================================================================

export class FunnelTriggerRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
  }

  public templateBelongsToProject(templateId: string, projectId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM message_templates WHERE id = ? AND project_id = ?").get(templateId, projectId));
  }

  public findById(id: string): FunnelTrigger | null {
    const row = this.db.prepare(`
      SELECT ft.*, mt.name as template_name, mt.content as template_content
      FROM funnel_triggers ft
      LEFT JOIN message_templates mt ON ft.template_id = mt.id AND mt.project_id = ft.project_id
      WHERE ft.id = ?
    `).get(id) as FunnelTrigger | undefined;
    return row ?? null;
  }

  public findByKey(projectId: string, triggerKey: string): FunnelTrigger | null {
    const cleanProj = (projectId || "default").trim();
    const cleanKey = triggerKey.trim();
    const row = this.db.prepare(`
      SELECT ft.*, mt.name as template_name, mt.content as template_content
      FROM funnel_triggers ft
      LEFT JOIN message_templates mt ON ft.template_id = mt.id AND mt.project_id = ft.project_id
      WHERE ft.project_id = ? AND ft.trigger_key = ?
      LIMIT 1
    `).get(cleanProj, cleanKey) as FunnelTrigger | undefined;
    return row ?? null;
  }

  public listByProject(projectId?: string): FunnelTrigger[] {
    const cleanProj = (projectId || "default").trim();
    if (cleanProj === "all") {
      return this.db.prepare(`
        SELECT ft.*, mt.name as template_name, mt.content as template_content
        FROM funnel_triggers ft
        LEFT JOIN message_templates mt ON ft.template_id = mt.id AND mt.project_id = ft.project_id
        ORDER BY ft.created_at ASC
      `).all() as FunnelTrigger[];
    }
    return this.db.prepare(`
      SELECT ft.*, mt.name as template_name, mt.content as template_content
      FROM funnel_triggers ft
      LEFT JOIN message_templates mt ON ft.template_id = mt.id AND mt.project_id = ft.project_id
      WHERE ft.project_id = ?
      ORDER BY ft.created_at ASC
    `).all(cleanProj) as FunnelTrigger[];
  }

  public create(input: CreateTriggerInput): FunnelTrigger {
    const id = input.id ?? `trg_${randomUUID()}`;
    const projectId = input.project_id?.trim() || "default";
    const isActive = input.is_active !== undefined ? Number(input.is_active) : 1;
    const delay = input.delay_seconds !== undefined ? Number(input.delay_seconds) : 0;

    const row = this.db.prepare(`
      INSERT INTO funnel_triggers (
        id, project_id, trigger_key, name, event_type, is_active, delay_seconds, template_id, media_path, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      RETURNING *
    `).get(
      id,
      projectId,
      input.trigger_key.trim(),
      input.name.trim(),
      input.event_type.trim(),
      isActive,
      delay,
      input.template_id?.trim() ?? null,
      input.media_path?.trim() ?? null
    ) as FunnelTrigger;

    return row;
  }

  public update(id: string, input: UpdateTriggerInput): FunnelTrigger | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    const eventType = input.event_type !== undefined ? input.event_type.trim() : existing.event_type;
    const isActive = input.is_active !== undefined ? Number(input.is_active) : existing.is_active;
    const delay = input.delay_seconds !== undefined ? Number(input.delay_seconds) : existing.delay_seconds;
    const templateId = input.template_id !== undefined ? (input.template_id ? input.template_id.trim() : null) : existing.template_id;
    const mediaPath = input.media_path !== undefined ? (input.media_path ? input.media_path.trim() : null) : existing.media_path;

    const updated = this.db.prepare(`
      UPDATE funnel_triggers
      SET name = ?,
          event_type = ?,
          is_active = ?,
          delay_seconds = ?,
          template_id = ?,
          media_path = ?,
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *
    `).get(name, eventType, isActive, delay, templateId, mediaPath, id) as FunnelTrigger;

    return updated;
  }

  public toggle(id: string): { success: boolean; is_active: number } | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const newActive = existing.is_active === 1 ? 0 : 1;
    this.db.prepare(`
      UPDATE funnel_triggers
      SET is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newActive, id);

    return { success: true, is_active: newActive };
  }

  public seedDefaultTriggers(projectId = "default", force = false): number {
    const defaults: CreateTriggerInput[] = [
      {
        id: `trg_${projectId}_abandonment`,
        project_id: projectId,
        trigger_key: "ABANDONMENT_RECOVERY",
        name: "Recuperação de Abandono (Pix e Carrinho)",
        event_type: "pix_generated",
        is_active: 1,
        delay_seconds: 420, // 7 minutos
        template_id: "PIX_RECOVERY",
        media_path: null,
      },
      {
        id: `trg_${projectId}_main_delivery`,
        project_id: projectId,
        trigger_key: "MAIN_DELIVERY",
        name: "Entregável do Produto Principal",
        event_type: "purchase_approved",
        is_active: 1,
        delay_seconds: 0, // Imediato
        template_id: "MAIN_DELIVERY",
        media_path: "data/media/guia_definitivo_alta_conversao.pdf",
      },
      {
        id: `trg_${projectId}_upsell1_offer`,
        project_id: projectId,
        trigger_key: "UPSELL_1_OFFER",
        name: "Oferta de Upsell 1 (Pitch)",
        event_type: "purchase_approved",
        is_active: 1,
        delay_seconds: 600, // 10 minutos
        template_id: "UPSELL_1_OFFER",
        media_path: "data/media/pitch_upsell_1.ogg",
      },
      {
        id: `trg_${projectId}_upsell1_delivery`,
        project_id: projectId,
        trigger_key: "UPSELL_1_DELIVERY",
        name: "Entregável do Upsell 1",
        event_type: "purchase_approved",
        is_active: 1,
        delay_seconds: 0,
        template_id: "UPSELL_1_DELIVERY",
        media_path: "data/media/pack_templates_acelerador.pdf",
      },
      {
        id: `trg_${projectId}_upsell2_offer`,
        project_id: projectId,
        trigger_key: "UPSELL_2_OFFER",
        name: "Oferta de Upsell 2 (Pitch Masterclass)",
        event_type: "purchase_approved",
        is_active: 1,
        delay_seconds: 900, // 15 minutos
        template_id: "UPSELL_2_OFFER",
        media_path: "data/media/pitch_upsell_2.ogg",
      },
      {
        id: `trg_${projectId}_upsell2_delivery`,
        project_id: projectId,
        trigger_key: "UPSELL_2_DELIVERY",
        name: "Entregável do Upsell 2",
        event_type: "purchase_approved",
        is_active: 1,
        delay_seconds: 0,
        template_id: "UPSELL_2_DELIVERY",
        media_path: "data/media/masterclass_escala_acesso.pdf",
      },
      {
        id: `trg_${projectId}_downsell_offer`,
        project_id: projectId,
        trigger_key: "DOWNSELL_OFFER",
        name: "Oferta de Downsell (Condição Especial)",
        event_type: "customer_reply",
        is_active: 1,
        delay_seconds: 300, // 5 minutos
        template_id: "DOWNSELL_OFFER",
        media_path: "data/media/pitch_downsell.ogg",
      },
      {
        id: `trg_${projectId}_downsell_delivery`,
        project_id: projectId,
        trigger_key: "DOWNSELL_DELIVERY",
        name: "Entregável do Downsell",
        event_type: "purchase_approved",
        is_active: 1,
        delay_seconds: 0,
        template_id: "DOWNSELL_DELIVERY",
        media_path: "data/media/pack_templates_essenciais.pdf",
      },
    ];

    let inserted = 0;
    for (const definition of defaults) {
      const def = projectId === "default" ? definition : {
        ...definition, is_active: 0, template_id: null, media_path: null,
      };
      const existingTrg = this.findByKey(projectId, def.trigger_key);
      if (!existingTrg) {
        this.create(def);
        inserted++;
      } else if (force) {
        this.update(existingTrg.id, {
          name: def.name,
          event_type: def.event_type,
          delay_seconds: def.delay_seconds,
          template_id: def.template_id,
          media_path: def.media_path,
        });
        inserted++;
      }
    }
    return inserted;
  }
}

// ============================================================================
// Helper de Transacoes e Fabrica de Repositorios
// ============================================================================

export interface Repositories {
  readonly db: Database.Database;
  readonly customers: CustomerRepository;
  readonly orders: OrderRepository;
  readonly messageQueue: MessageQueueRepository;
  readonly auditLogs: AuditLogRepository;
  readonly templates: TemplateRepository;
  readonly projects: ProjectRepository;
  readonly funnelTriggers: FunnelTriggerRepository;
  readonly transaction: <T>(fn: () => T) => T;
}

export function createRepositories(db: Database.Database = getDatabase()): Repositories {
  return {
    db,
    customers: new CustomerRepository(db),
    orders: new OrderRepository(db),
    messageQueue: new MessageQueueRepository(db),
    auditLogs: new AuditLogRepository(db),
    templates: new TemplateRepository(db),
    projects: new ProjectRepository(db),
    funnelTriggers: new FunnelTriggerRepository(db),
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  };
}

export function runInTransaction<T>(fn: () => T, db: Database.Database = getDatabase()): T {
  return db.transaction(fn)();
}

export const repositories: Repositories = createRepositories();
export const customerRepository = repositories.customers;
export const orderRepository = repositories.orders;
export const messageQueueRepository = repositories.messageQueue;
export const auditLogRepository = repositories.auditLogs;
export const templateRepository = repositories.templates;
export const projectRepository = repositories.projects;
export const funnelTriggerRepository = repositories.funnelTriggers;

export function seedDefaultTemplates(repo: TemplateRepository = templateRepository): number {
  return repo.seedDefaultTemplates();
}

export function seedFunnelTemplates(repo: TemplateRepository = templateRepository, force = false): number {
  return repo.seedFunnelTemplates(force);
}

export function seedDefaultTriggers(repo: FunnelTriggerRepository = funnelTriggerRepository, projectId = "default"): number {
  return repo.seedDefaultTriggers(projectId);
}

export default repositories;
