import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { getDatabase } from "./connection.js";

// ============================================================================
// Tipagens e Contratos de Entidades do Dominio
// ============================================================================

export interface Customer {
  readonly id: string;
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
  readonly phone: string;
  readonly jid?: string | null;
  readonly name: string;
  readonly email?: string | null;
  readonly current_state?: string;
}

export interface Order {
  readonly id: string;
  readonly transaction_id: string;
  readonly customer_id: string;
  readonly product_id: string;
  readonly offer_id: string;
  readonly event_type: string;
  readonly status: string;
  readonly paid_at: string | null;
  readonly raw_payload: string;
  readonly created_at: string;
}

export interface CreateOrderInput {
  readonly id?: string;
  readonly transaction_id: string;
  readonly customer_id: string;
  readonly product_id: string;
  readonly offer_id: string;
  readonly event_type: string;
  readonly status: string;
  readonly paid_at?: string | null;
  readonly raw_payload: string | Record<string, unknown>;
}

export type QueueMessageStatus = "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";

export interface QueueJob {
  readonly id: string;
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
  readonly created_at: string;
  readonly updated_at: string;
}

export interface EnqueueJobInput {
  readonly id?: string;
  readonly customer_id: string;
  readonly phone: string;
  readonly jid?: string | null;
  readonly message_type: string;
  readonly content: string;
  readonly media_path?: string | null;
  readonly scheduled_at: string | Date;
  readonly status?: QueueMessageStatus;
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
  private readonly stmtFindByPhone: Database.Statement<[string]>;
  private readonly stmtFindByJid: Database.Statement<[string]>;
  private readonly stmtInsert: Database.Statement<[string, string, string | null, string, string | null, string]>;
  private readonly stmtUpdate: Database.Statement<[string, string | null, string | null, string | null, string]>;
  private readonly stmtUpdateState: Database.Statement<[string, string]>;
  private readonly stmtUpdateJid: Database.Statement<[string, string]>;
  private readonly stmtListAll: Database.Statement<[number, number]>;
  private readonly stmtCount: Database.Statement<[]>;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.stmtFindById = db.prepare<[string]>(`SELECT * FROM customers WHERE id = ?`);
    this.stmtFindByPhone = db.prepare<[string]>(`SELECT * FROM customers WHERE phone = ?`);
    this.stmtFindByJid = db.prepare<[string]>(`SELECT * FROM customers WHERE jid = ?`);
    this.stmtInsert = db.prepare<[string, string, string | null, string, string | null, string]>(`
      INSERT INTO customers (id, phone, jid, name, email, current_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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

  public findByPhone(phone: string): Customer | null {
    const cleanPhone = phone.trim();
    const row = this.stmtFindByPhone.get(cleanPhone) as Customer | undefined;
    return row ?? null;
  }

  public findByJid(jid: string): Customer | null {
    const cleanJid = jid.trim();
    const row = this.stmtFindByJid.get(cleanJid) as Customer | undefined;
    return row ?? null;
  }

  public upsert(input: UpsertCustomerInput): Customer {
    const cleanPhone = input.phone.trim();
    const cleanName = input.name.trim();

    return this.db.transaction(() => {
      const existing = this.findByPhone(cleanPhone);
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
        state
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

  public listAll(limit = 100, offset = 0): Customer[] {
    return this.stmtListAll.all(Math.max(1, limit), Math.max(0, offset)) as Customer[];
  }

  public count(): number {
    const row = this.stmtCount.get() as { total: number } | undefined;
    return row?.total ?? 0;
  }
}

// ============================================================================
// Repositorio de Pedidos e Transacoes (OrderRepository)
// ============================================================================

export class OrderRepository {
  private readonly db: Database.Database;
  private readonly stmtFindById: Database.Statement<[string]>;
  private readonly stmtFindByTransactionAndEvent: Database.Statement<[string, string]>;
  private readonly stmtListByCustomer: Database.Statement<[string]>;
  private readonly stmtListByTransaction: Database.Statement<[string]>;
  private readonly stmtListAll: Database.Statement<[number, number]>;
  private readonly stmtCount: Database.Statement<[]>;
  private readonly stmtInsert: Database.Statement<[string, string, string, string, string, string, string, string | null, string]>;

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.stmtFindById = db.prepare<[string]>(`SELECT * FROM orders WHERE id = ?`);
    this.stmtFindByTransactionAndEvent = db.prepare<[string, string]>(`
      SELECT * FROM orders WHERE transaction_id = ? AND event_type = ?
    `);
    this.stmtListByCustomer = db.prepare<[string]>(`
      SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC
    `);
    this.stmtListByTransaction = db.prepare<[string]>(`
      SELECT * FROM orders WHERE transaction_id = ? ORDER BY created_at DESC
    `);
    this.stmtListAll = db.prepare<[number, number]>(`
      SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?
    `);
    this.stmtCount = db.prepare<[]>(`SELECT COUNT(*) as total FROM orders`);
    this.stmtInsert = db.prepare<[string, string, string, string, string, string, string, string | null, string]>(`
      INSERT INTO orders (
        id, transaction_id, customer_id, product_id, offer_id,
        event_type, status, paid_at, raw_payload, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      RETURNING *
    `);
  }

  public findById(id: string): Order | null {
    const row = this.stmtFindById.get(id) as Order | undefined;
    return row ?? null;
  }

  public findByTransactionAndEvent(transactionId: string, eventType: string): Order | null {
    const row = this.stmtFindByTransactionAndEvent.get(transactionId.trim(), eventType.trim()) as Order | undefined;
    return row ?? null;
  }

  public create(input: CreateOrderInput): Order {
    const id = input.id ?? `ord_${randomUUID()}`;
    const payload = stringifyPayload(input.raw_payload);
    const paidAt = input.paid_at ? normalizeIsoDate(input.paid_at) : null;

    const created = this.stmtInsert.get(
      id,
      input.transaction_id.trim(),
      input.customer_id.trim(),
      input.product_id.trim(),
      input.offer_id.trim(),
      input.event_type.trim(),
      input.status.trim(),
      paidAt,
      payload
    ) as Order;

    return created;
  }

  /**
   * Idempotent insert: checks UNIQUE(transaction_id, event_type).
   * Returns { order, inserted: true } if inserted, or { order, inserted: false } if already existed.
   */
  public createOrIgnore(input: CreateOrderInput): { order: Order; inserted: boolean } {
    const existing = this.findByTransactionAndEvent(input.transaction_id, input.event_type);
    if (existing) {
      return { order: existing, inserted: false };
    }

    try {
      const order = this.create(input);
      return { order, inserted: true };
    } catch (error: unknown) {
      // Handle potential race condition where another process inserted simultaneously
      const conflictCheck = this.findByTransactionAndEvent(input.transaction_id, input.event_type);
      if (conflictCheck) {
        return { order: conflictCheck, inserted: false };
      }
      throw error;
    }
  }

  public listByCustomerId(customerId: string): Order[] {
    return this.stmtListByCustomer.all(customerId) as Order[];
  }

  public listByTransactionId(transactionId: string): Order[] {
    return this.stmtListByTransaction.all(transactionId) as Order[];
  }

  public listAll(limit = 100, offset = 0): Order[] {
    return this.stmtListAll.all(Math.max(1, limit), Math.max(0, offset)) as Order[];
  }

  public count(): number {
    const row = this.stmtCount.get() as { total: number } | undefined;
    return row?.total ?? 0;
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
  private readonly stmtInsert: Database.Statement<[string, string, string, string | null, string, string, string | null, string, string]>;
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

  constructor(db: Database.Database = getDatabase()) {
    this.db = db;
    this.stmtFindById = db.prepare<[string]>(`SELECT * FROM message_queue WHERE id = ?`);
    this.stmtFindDueJobs = db.prepare<[string, number]>(`
      SELECT * FROM message_queue
      WHERE status = 'PENDING' AND scheduled_at <= ?
      ORDER BY scheduled_at ASC
      LIMIT ?
    `);
    this.stmtFindNextDue = db.prepare<[string]>(`
      SELECT * FROM message_queue
      WHERE status = 'PENDING' AND scheduled_at <= ?
      ORDER BY scheduled_at ASC
      LIMIT 1
    `);
    this.stmtInsert = db.prepare<[string, string, string, string | null, string, string, string | null, string, string]>(`
      INSERT INTO message_queue (
        id, customer_id, phone, jid, message_type, content, media_path,
        scheduled_at, status, attempts, last_error, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, datetime('now'), datetime('now'))
      RETURNING *
    `);
    this.stmtMarkProcessing = db.prepare<[string]>(`
      UPDATE message_queue
      SET status = 'PROCESSING',
          attempts = attempts + 1,
          updated_at = datetime('now')
      WHERE id = ? AND status = 'PENDING'
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

  public enqueue(input: EnqueueJobInput): QueueJob {
    const id = input.id ?? `job_${randomUUID()}`;
    const scheduledAt = normalizeIsoDate(input.scheduled_at);
    const status = input.status ?? "PENDING";

    const job = this.stmtInsert.get(
      id,
      input.customer_id.trim(),
      input.phone.trim(),
      input.jid?.trim() ?? null,
      input.message_type.trim(),
      input.content,
      input.media_path?.trim() ?? null,
      scheduledAt,
      status
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

  public findDueJobs(referenceTime: string | Date = new Date(), limit = 10): QueueJob[] {
    const refIso = normalizeIsoDate(referenceTime);
    return this.stmtFindDueJobs.all(refIso, Math.max(1, limit)) as QueueJob[];
  }

  public findNextDueJob(referenceTime: string | Date = new Date()): QueueJob | null {
    const refIso = normalizeIsoDate(referenceTime);
    const row = this.stmtFindNextDue.get(refIso) as QueueJob | undefined;
    return row ?? null;
  }

  public markAsProcessing(id: string): boolean {
    const res = this.stmtMarkProcessing.run(id);
    return res.changes > 0;
  }

  public markAsSent(id: string): boolean {
    const res = this.stmtMarkSent.run(id);
    return res.changes > 0;
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

  public listPending(limit = 100): QueueJob[] {
    return this.stmtListPending.all(Math.max(1, limit)) as QueueJob[];
  }

  public countByStatus(status: QueueMessageStatus): number {
    const row = this.stmtCountByStatus.get(status) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public deleteJob(id: string): boolean {
    const res = this.stmtDelete.run(id);
    return res.changes > 0;
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
  readonly transaction: <T>(fn: () => T) => T;
}

export function createRepositories(db: Database.Database = getDatabase()): Repositories {
  return {
    db,
    customers: new CustomerRepository(db),
    orders: new OrderRepository(db),
    messageQueue: new MessageQueueRepository(db),
    auditLogs: new AuditLogRepository(db),
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

export default repositories;
