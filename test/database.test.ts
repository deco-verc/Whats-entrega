import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import {
  createDatabaseConnection,
  initDatabase,
  getDatabase,
  closeDatabase,
  applySchema,
  loadSchemaSql,
} from "../src/database/connection.js";
import {
  createRepositories,
  CustomerRepository,
  OrderRepository,
  MessageQueueRepository,
  runInTransaction,
  normalizeIsoDate,
} from "../src/database/repositories.js";
import { env } from "../src/config/env.js";

describe("Camada de Conexao SQLite em Modo WAL (connection.ts)", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db && db.open) {
      db.close();
    }
  });

  test("deve carregar schema DDL completo de src/database/schema.sql", () => {
    const schemaSql = loadSchemaSql();
    assert.ok(typeof schemaSql === "string" && schemaSql.length > 0);
    assert.ok(schemaSql.includes("CREATE TABLE IF NOT EXISTS customers"));
    assert.ok(schemaSql.includes("CREATE TABLE IF NOT EXISTS orders"));
    assert.ok(schemaSql.includes("CREATE TABLE IF NOT EXISTS message_queue"));
    assert.ok(schemaSql.includes("UNIQUE (transaction_id, event_type)"));
    assert.ok(schemaSql.includes("idx_message_queue_scheduled_at"));
    assert.ok(schemaSql.includes("idx_message_queue_status"));
  });

  test("deve inicializar banco em memoria e configurar PRAGMAs obrigatorios", () => {
    db = createDatabaseConnection(":memory:");
    assert.ok(db.open, "Banco em memoria deve estar aberto");

    // Validar ativacao de foreign keys
    const fkEnabled = db.pragma("foreign_keys", { simple: true });
    assert.equal(fkEnabled, 1, "PRAGMA foreign_keys deve estar ativo (= 1)");

    // Validar criacao das tabelas
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    assert.ok(tableNames.includes("customers"), "Tabela customers deve existir");
    assert.ok(tableNames.includes("orders"), "Tabela orders deve existir");
    assert.ok(tableNames.includes("message_queue"), "Tabela message_queue deve existir");
    assert.ok(tableNames.includes("audit_logs"), "Tabela audit_logs deve existir");
    assert.ok(tableNames.includes("system_settings"), "Tabela system_settings deve existir");

    // Validar indices obrigatorios
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    assert.ok(indexNames.includes("idx_customers_phone"));
    assert.ok(indexNames.includes("idx_orders_customer_id"));
    assert.ok(indexNames.includes("idx_orders_transaction_id"));
    assert.ok(indexNames.includes("idx_message_queue_scheduled_at"));
    assert.ok(indexNames.includes("idx_message_queue_status"));
    assert.ok(indexNames.includes("idx_message_queue_status_scheduled"));
  });

  test("deve inicializar banco fisico em disco com PRAGMA journal_mode = WAL e synchronous = NORMAL", () => {
    const testDbPath = path.resolve(env.paths.databaseDir, "test_wal_verify.db");

    // Remover banco de teste anterior se existir
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }

    db = createDatabaseConnection(testDbPath);
    assert.ok(db.open);

    const journalMode = db.pragma("journal_mode", { simple: true });
    assert.equal(journalMode, "wal", "Persistencia fisica deve operar estritamente em modo WAL");

    const synchronous = db.pragma("synchronous", { simple: true });
    assert.equal(synchronous, 1, "PRAGMA synchronous deve ser NORMAL (codigo 1 no SQLite)");

    db.close();

    // Limpar arquivo de teste
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  test("deve gerenciar conexao singleton global atraves de getDatabase() e closeDatabase()", () => {
    const defaultDb = getDatabase();
    assert.ok(defaultDb.open);
    const sameDb = getDatabase();
    assert.strictEqual(defaultDb, sameDb, "getDatabase deve retornar a mesma instancia singleton");

    closeDatabase();
  });
});

describe("Repositorios Transacionais SQLite (repositories.ts)", () => {
  let db: Database.Database;
  let repos: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    repos = createRepositories(db);
  });

  afterEach(() => {
    if (db && db.open) {
      db.close();
    }
  });

  describe("CustomerRepository", () => {
    test("deve realizar upsert de novo cliente com estado inicial NEW", () => {
      const customer = repos.customers.upsert({
        phone: "5511999998888",
        name: "Carlos Silva",
        email: "carlos@exemplo.com",
      });

      assert.ok(customer.id.startsWith("cust_"));
      assert.equal(customer.phone, "5511999998888");
      assert.equal(customer.name, "Carlos Silva");
      assert.equal(customer.email, "carlos@exemplo.com");
      assert.equal(customer.current_state, "NEW");
      assert.equal(customer.jid, null);
      assert.ok(customer.created_at);

      const found = repos.customers.findById(customer.id);
      assert.deepEqual(found, customer);
    });

    test("deve atualizar cliente existente no upsert sem duplicar registro (idempotencia por telefone)", () => {
      const initial = repos.customers.upsert({
        phone: "5511999998888",
        name: "Carlos Silva",
        email: "carlos@exemplo.com",
      });

      const updated = repos.customers.upsert({
        phone: "5511999998888",
        name: "Carlos Silva Atualizado",
        jid: "5511999998888@s.whatsapp.net",
      });

      assert.equal(updated.id, initial.id, "ID do cliente deve ser mantido");
      assert.equal(updated.name, "Carlos Silva Atualizado");
      assert.equal(updated.email, "carlos@exemplo.com", "Email pre-existente deve ser preservado via COALESCE");
      assert.equal(updated.jid, "5511999998888@s.whatsapp.net");
      assert.equal(repos.customers.count(), 1, "Total de clientes no banco deve continuar 1");
    });

    test("deve atualizar estado do funil do cliente por id ou telefone", () => {
      const customer = repos.customers.upsert({
        phone: "5511888887777",
        name: "Mariana Souza",
      });

      const modified = repos.customers.updateState(customer.id, "DELIVERED_MAIN");
      assert.equal(modified?.current_state, "DELIVERED_MAIN");

      const modifiedByPhone = repos.customers.updateState("5511888887777", "DELIVERED_UPSELL_1");
      assert.equal(modifiedByPhone?.current_state, "DELIVERED_UPSELL_1");
    });

    test("deve atualizar JID validado pelo Baileys", () => {
      const customer = repos.customers.upsert({
        phone: "5531988881111",
        name: "Lucas Pereira",
      });

      const updated = repos.customers.updateJid(customer.id, "553188881111@s.whatsapp.net");
      assert.equal(updated?.jid, "553188881111@s.whatsapp.net");

      const foundByJid = repos.customers.findByJid("553188881111@s.whatsapp.net");
      assert.equal(foundByJid?.id, customer.id);
    });
  });

  describe("OrderRepository & Idempotencia Estrita", () => {
    test("deve registrar pedido atrelado ao cliente", () => {
      const customer = repos.customers.upsert({
        phone: "5511977776666",
        name: "Ana Beatriz",
      });

      const order = repos.orders.create({
        transaction_id: "trx_cakto_1001",
        customer_id: customer.id,
        product_id: "prod_main_01",
        offer_id: "off_main_full",
        event_type: "purchase_approved",
        status: "approved",
        paid_at: new Date().toISOString(),
        raw_payload: { amount_cents: 9700, test: true },
      });

      assert.ok(order.id.startsWith("ord_"));
      assert.equal(order.transaction_id, "trx_cakto_1001");
      assert.equal(order.event_type, "purchase_approved");
      assert.equal(order.status, "approved");
      assert.ok(order.raw_payload.includes("amount_cents"));

      const byCustomer = repos.orders.listByCustomerId(customer.id);
      assert.equal(byCustomer.length, 1);
      assert.equal(byCustomer[0].id, order.id);
    });

    test("deve garantir unicidade estrita UNIQUE(transaction_id, event_type) rejeitando duplicatas com create()", () => {
      const customer = repos.customers.upsert({
        phone: "5511977776666",
        name: "Ana Beatriz",
      });

      repos.orders.create({
        transaction_id: "trx_dup_001",
        customer_id: customer.id,
        product_id: "prod_main_01",
        offer_id: "off_main_full",
        event_type: "purchase_approved",
        status: "approved",
        raw_payload: "{}",
      });

      // Tentativa de duplicar a mesma transacao com mesmo evento deve lancar erro de constraint
      assert.throws(
        () =>
          repos.orders.create({
            transaction_id: "trx_dup_001",
            customer_id: customer.id,
            product_id: "prod_main_01",
            offer_id: "off_main_full",
            event_type: "purchase_approved",
            status: "approved",
            raw_payload: "{}",
          }),
        /UNIQUE constraint failed: orders\.transaction_id, orders\.event_type/
      );
    });

    test("createOrIgnore deve processar webhook duplicado de forma graciosa e idempotente", () => {
      const customer = repos.customers.upsert({
        phone: "5511977776666",
        name: "Ana Beatriz",
      });

      const firstCall = repos.orders.createOrIgnore({
        transaction_id: "trx_idempotent_01",
        customer_id: customer.id,
        product_id: "prod_main_01",
        offer_id: "off_main_full",
        event_type: "purchase_approved",
        status: "approved",
        raw_payload: { attempt: 1 },
      });

      assert.equal(firstCall.inserted, true);
      assert.ok(firstCall.order);

      // Segunda chamada com mesmo transaction_id e event_type (reenvio do webhook da Cakto)
      const secondCall = repos.orders.createOrIgnore({
        transaction_id: "trx_idempotent_01",
        customer_id: customer.id,
        product_id: "prod_main_01",
        offer_id: "off_main_full",
        event_type: "purchase_approved",
        status: "approved",
        raw_payload: { attempt: 2 },
      });

      assert.equal(secondCall.inserted, false);
      assert.equal(secondCall.order.id, firstCall.order.id);
      assert.equal(repos.orders.count(), 1, "Nao deve duplicar pedido no banco");
    });
  });

  describe("MessageQueueRepository & Fila Indiana", () => {
    test("deve enfileirar mensagens e buscar jobs vencidos por horario (findDueJobs)", () => {
      const customer = repos.customers.upsert({
        phone: "5511966665555",
        name: "Roberto Dias",
      });

      const now = new Date();
      const pastTime = new Date(now.getTime() - 10000); // 10 segundos atras
      const futureTime = new Date(now.getTime() + 60000); // 1 minuto no futuro

      // Job 1: Vencido (deve ser retornado)
      const job1 = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "Ola! Segue o material em PDF.",
        scheduled_at: pastTime,
      });

      // Job 2: Futuro (nao deve ser retornado agora)
      repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "PITCH_UPSELL_1",
        content: "Quer dar o proximo passo?",
        scheduled_at: futureTime,
      });

      assert.ok(job1.id.startsWith("job_"));
      assert.equal(job1.status, "PENDING");
      assert.equal(job1.attempts, 0);

      const dueJobs = repos.messageQueue.findDueJobs(now);
      assert.equal(dueJobs.length, 1);
      assert.equal(dueJobs[0].id, job1.id);
      assert.equal(dueJobs[0].message_type, "DELIVERY_MAIN");

      const nextDue = repos.messageQueue.findNextDueJob(now);
      assert.equal(nextDue?.id, job1.id);
    });

    test("deve enfileirar lote (enqueueBatch) dentro de transacao atomica", () => {
      const customer = repos.customers.upsert({
        phone: "5511955554444",
        name: "Juliana Mendes",
      });

      const jobs = repos.messageQueue.enqueueBatch([
        {
          customer_id: customer.id,
          phone: customer.phone,
          message_type: "DELIVERY_TEXT",
          content: "Msg 1 de boas vindas",
          scheduled_at: new Date(),
        },
        {
          customer_id: customer.id,
          phone: customer.phone,
          message_type: "DELIVERY_DOC",
          content: "Msg 2 documento",
          media_path: "data/media/entrega.pdf",
          scheduled_at: new Date(),
        },
      ]);

      assert.equal(jobs.length, 2);
      assert.equal(repos.messageQueue.countByStatus("PENDING"), 2);
    });

    test("deve transicionar status do job: PENDING -> PROCESSING -> SENT", () => {
      const customer = repos.customers.upsert({
        phone: "5511944443333",
        name: "Fabio Santos",
      });

      const job = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "Entrega do material",
        scheduled_at: new Date(),
      });

      const markProcessingOk = repos.messageQueue.markAsProcessing(job.id);
      assert.equal(markProcessingOk, true);

      let fetched = repos.messageQueue.findById(job.id);
      assert.equal(fetched?.status, "PROCESSING");
      assert.equal(fetched?.attempts, 1);

      const markSentOk = repos.messageQueue.markAsSent(job.id);
      assert.equal(markSentOk, true);

      fetched = repos.messageQueue.findById(job.id);
      assert.equal(fetched?.status, "SENT");
    });

    test("deve controlar falhas e retentativas (markAsFailed)", () => {
      const customer = repos.customers.upsert({
        phone: "5511933332222",
        name: "Patricia Gomes",
      });

      const job = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "Entrega teste falha",
        scheduled_at: new Date(),
      });

      // Tentativa 1 de envio
      repos.messageQueue.markAsProcessing(job.id);
      repos.messageQueue.markAsFailed(job.id, "Connection timeout", 3, 30);

      let current = repos.messageQueue.findById(job.id);
      assert.equal(current?.status, "PENDING", "Deve voltar a PENDING para re-tentativa quando attempts < maxAttempts");
      assert.equal(current?.last_error, "Connection timeout");
      assert.equal(current?.attempts, 1);

      // Tentativa 2
      repos.messageQueue.markAsProcessing(job.id);
      repos.messageQueue.markAsFailed(job.id, "Second error", 3, 30);

      // Tentativa 3 (esgota tentativas)
      repos.messageQueue.markAsProcessing(job.id);
      repos.messageQueue.markAsFailed(job.id, "Third and final error", 3, 30);

      current = repos.messageQueue.findById(job.id);
      assert.equal(current?.status, "FAILED", "Deve marcar como FAILED definitivo apos atingir maxAttempts");
      assert.equal(current?.attempts, 3);
      assert.equal(current?.last_error, "Third and final error");
    });

    test("deve cancelar jobs pendentes do cliente por cancelPendingByCustomer", () => {
      const customer = repos.customers.upsert({
        phone: "5511922221111",
        name: "Gabriel Neves",
      });

      repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "PIX_RECOVERY",
        content: "Msg Pix 1",
        scheduled_at: new Date(),
      });

      repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "PIX_RECOVERY",
        content: "Msg Pix 2",
        scheduled_at: new Date(),
      });

      const cancelledCount = repos.messageQueue.cancelPendingByCustomer(customer.id, "PIX_RECOVERY");
      assert.equal(cancelledCount, 2);
      assert.equal(repos.messageQueue.countByStatus("CANCELLED"), 2);
      assert.equal(repos.messageQueue.countByStatus("PENDING"), 0);
    });

    test("deve reagendar job por micro-comprometimento (reschedulePendingByType)", () => {
      const customer = repos.customers.upsert({
        phone: "5511911110000",
        name: "Vanessa Lima",
      });

      const futureTime = new Date(Date.now() + 15 * 60 * 1000); // +15 min
      const job = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "PITCH_UPSELL_1",
        content: "Pitch do Upsell 1",
        scheduled_at: futureTime,
      });

      assert.equal(repos.messageQueue.findDueJobs(new Date()).length, 0);

      // Cliente respondeu 'SIM' no WhatsApp -> acelerar para NOW!
      const immediateNow = new Date();
      const updatedCount = repos.messageQueue.reschedulePendingByType(
        customer.id,
        "PITCH_UPSELL_1",
        immediateNow
      );

      assert.equal(updatedCount, 1);
      const dueNow = repos.messageQueue.findDueJobs(immediateNow);
      assert.equal(dueNow.length, 1);
      assert.equal(dueNow[0].id, job.id);
    });
  });

  describe("Transacoes Atomicas e Integridade Referencial", () => {
    test("runInTransaction deve reverter todas as alteracoes em caso de erro", () => {
      const initialCount = repos.customers.count();

      assert.throws(() => {
        repos.transaction(() => {
          repos.customers.upsert({
            phone: "5511999990001",
            name: "Cliente Sucesso Temporario",
          });

          // Forcar erro no meio da transacao
          throw new Error("Simulated Rollback Error");
        });
      }, /Simulated Rollback Error/);

      assert.equal(
        repos.customers.count(),
        initialCount,
        "Rollback deve impedir insercao do cliente no banco"
      );
    });

    test("cenario completo do funil: Pix -> Compra Main -> Micro-Comprometimento -> Reembolso", () => {
      // 1. Pix Gerado
      const customer = repos.customers.upsert({
        phone: "5511988880002",
        name: "Camila Rocha",
        current_state: "WAITING_PAYMENT",
      });

      repos.orders.create({
        transaction_id: "trx_funnel_01",
        customer_id: customer.id,
        product_id: "prod_main_01",
        offer_id: "off_main_full",
        event_type: "pix_generated",
        status: "waiting_payment",
        raw_payload: "{}",
      });

      const pixJob = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "PIX_RECOVERY",
        content: "Ajuda com seu Pix",
        scheduled_at: new Date(Date.now() + 7 * 60 * 1000),
      });

      assert.equal(repos.messageQueue.countByStatus("PENDING"), 1);

      // 2. Compra Aprovada do MAIN
      repos.transaction(() => {
        // Idempotencia do pedido
        repos.orders.createOrIgnore({
          transaction_id: "trx_funnel_01",
          customer_id: customer.id,
          product_id: "prod_main_01",
          offer_id: "off_main_full",
          event_type: "purchase_approved",
          status: "approved",
          paid_at: new Date().toISOString(),
          raw_payload: "{}",
        });

        // Cancelar Pix Recovery pendente
        repos.messageQueue.cancelPendingByCustomer(customer.id, "PIX_RECOVERY");

        // Atualizar estado para DELIVERED_MAIN
        repos.customers.updateState(customer.id, "DELIVERED_MAIN");

        // Agendar entrega imediata e pitch em 15 minutos
        repos.messageQueue.enqueue({
          customer_id: customer.id,
          phone: customer.phone,
          message_type: "DELIVERY_MAIN",
          content: "Seu ebook foi entregue!",
          scheduled_at: new Date(),
        });

        repos.messageQueue.enqueue({
          customer_id: customer.id,
          phone: customer.phone,
          message_type: "PITCH_UPSELL_1",
          content: "Oferta especial de aceleracao",
          scheduled_at: new Date(Date.now() + 15 * 60 * 1000),
        });
      });

      // Validar cancelamento do Pix e criacao dos 2 novos jobs
      const cancelledPix = repos.messageQueue.findById(pixJob.id);
      assert.equal(cancelledPix?.status, "CANCELLED");
      assert.equal(repos.messageQueue.countByStatus("PENDING"), 2);

      const updatedCustomer = repos.customers.findById(customer.id);
      assert.equal(updatedCustomer?.current_state, "DELIVERED_MAIN");

      // 3. Micro-comprometimento: cliente respondeu no WhatsApp
      repos.messageQueue.reschedulePendingByType(customer.id, "PITCH_UPSELL_1", new Date());

      // Agora ambos os jobs (entrega e pitch) estao prontos para disparo
      const dueNow = repos.messageQueue.findDueJobs(new Date());
      assert.equal(dueNow.length, 2);

      // 4. Reembolso: cancela todos os jobs pendentes
      repos.transaction(() => {
        repos.orders.createOrIgnore({
          transaction_id: "trx_funnel_01",
          customer_id: customer.id,
          product_id: "prod_main_01",
          offer_id: "off_main_full",
          event_type: "purchase_refunded",
          status: "refunded",
          raw_payload: "{}",
        });

        repos.messageQueue.cancelPendingByCustomer(customer.id);
        repos.customers.updateState(customer.id, "REFUNDED");
      });

      assert.equal(repos.messageQueue.countByStatus("PENDING"), 0);
      assert.equal(repos.customers.findById(customer.id)?.current_state, "REFUNDED");
    });
  });
});
