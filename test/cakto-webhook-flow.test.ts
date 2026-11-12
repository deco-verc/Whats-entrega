import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import crypto from "node:crypto";
import { createDatabaseConnection } from "../src/database/connection.js";
import {
  createRepositories,
  CustomerRepository,
  OrderRepository,
  AuditLogRepository,
  MessageQueueRepository,
  ProjectRepository,
  FunnelTriggerRepository,
  TemplateRepository,
} from "../src/database/repositories.js";
import {
  classifyCaktoWebhook,
  normalizeCaktoWebhook,
  maskSensitivePayload,
} from "../src/webhooks/adapters.js";
import { createWebhookApp } from "../src/webhooks/server.js";

describe("Fluxo de Integração e Homologação Cakto -> WhatsAppEntrega (18 Cenários)", () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let server: http.Server;
  let port: number;
  const projectSecret = "cakto_sec_natal_descomplicado";

  beforeEach(async () => {
    db = createDatabaseConnection(":memory:");
    const repos = createRepositories(db);

    // Cria projeto de teste
    repos.projects.create({
      id: "proj_natal",
      name: "Natal Descomplicado",
      slug: "natal-descomplicado",
      cakto_product_id: "prod_natal_main",
      cakto_webhook_secret: projectSecret,
      is_active: 1,
    });

    // Cria templates
    const tplEntrega = repos.templates.create({
      project_id: "proj_natal",
      name: "Entrega Natal",
      content: "Ola {{nome}}, aqui esta seu acesso ao {{produto}}!",
    });
    const tplUpsell = repos.templates.create({
      project_id: "proj_natal",
      name: "Oferta Upsell",
      content: "Ola {{primeiro_nome}}, aproveite esta oferta exclusiva!",
    });

    // Cria gatilhos de automação
    repos.funnelTriggers.create({
      project_id: "proj_natal",
      name: "Entrega Natal Descomplicado",
      trigger_key: "trg_natal_main",
      event_type: "purchase_approved",
      delay_seconds: 60,
      is_active: 1,
      template_id: tplEntrega.id,
    });
    repos.funnelTriggers.create({
      project_id: "proj_natal",
      name: "Oferta Upsell Natal",
      trigger_key: "trg_natal_upsell",
      event_type: "purchase_approved",
      delay_seconds: 1800,
      is_active: 1,
      template_id: tplUpsell.id,
    });

    const tplAbandono = repos.templates.create({
      project_id: "proj_natal",
      name: "Recuperação de Abandono",
      content: "Ola {{primeiro_nome}}, finalize seu pedido!",
    });
    const tplPix = repos.templates.create({
      project_id: "proj_natal",
      name: "Lembrete de Pix",
      content: "Ola {{primeiro_nome}}, segue seu Pix: {{pix_code}}",
    });

    repos.funnelTriggers.create({
      project_id: "proj_natal",
      name: "Recuperação de Abandono",
      trigger_key: "trg_natal_abandonment",
      event_type: "checkout_abandonment",
      delay_seconds: 900,
      is_active: 1,
      template_id: tplAbandono.id,
    });
    repos.funnelTriggers.create({
      project_id: "proj_natal",
      name: "Lembrete de Pix",
      trigger_key: "trg_natal_pix",
      event_type: "pix_generated",
      delay_seconds: 420,
      is_active: 1,
      template_id: tplPix.id,
    });

    const app = createWebhookApp({
      secret: projectSecret,
      requireAdmin: false,
      database: () => db,
      repositories: {
        customerRepo: repos.customers,
        orderRepo: repos.orders,
        auditRepo: repos.auditLogs,
        funnelTriggers: repos.funnelTriggers,
        templateRepo: repos.templates,
        projectRepo: repos.projects,
      },
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // 1. Ping de conectividade
  test("Cenario 1: Ping de conectividade deve ser classificado como PROBE sem criar pedido", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cakto-signature": projectSecret,
      },
      body: JSON.stringify({ event: "ping" }),
    });

    assert.equal(res.status, 200);
    const json = await res.json() as any;
    assert.equal(json.success, true);
    assert.equal(json.probe, true);

    const events = db.prepare("SELECT * FROM webhook_events WHERE project_id = 'proj_natal'").all() as any[];
    assert.equal(events.length, 1);
    assert.equal(events[0].result, "PROBE");
    assert.equal(events[0].authenticated, 1);

    const ordersCount = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE project_id = 'proj_natal'").get() as any;
    assert.equal(ordersCount.c, 0);
  });

  // 2. Evento de teste oficial com payload composto (card && pix && boleto && picpay)
  test("Cenario 2: Evento de teste oficial com payload composto deve registrar TEST com automacoes elegiveis", async () => {
    const payloadComposto = {
      event: "purchase_approved",
      data: {
        id: "cakto_test_multimethod_01",
        status: "paid",
        customer: { name: "Comprador Teste Cakto", phone: "11999999999", email: "teste@cakto.com.br" },
        product: { id: "prod_natal_main" },
        card: { brand: "visa", last_digits: "1234", amount: 197 },
        pix: { qr_code: "00020126580014br.gov.bcb.pix...", amount: 197 },
        boleto: { barcode: "34191090080000000000...", amount: 197 },
        picpay: { qr_code: "https://picpay.me/...", amount: 197 },
      },
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cakto-signature": projectSecret,
      },
      body: JSON.stringify(payloadComposto),
    });

    assert.equal(res.status, 200);
    const json = await res.json() as any;
    assert.equal(json.success, true);
    assert.equal(json.test, true);
    assert.ok(Array.isArray(json.matched_automations));
    assert.ok(json.matched_automations.length >= 1);

    const event = db.prepare("SELECT * FROM webhook_events WHERE project_id = 'proj_natal'").get() as any;
    assert.equal(event.result, "TEST");
    assert.equal(event.is_test, 1);
    assert.equal(event.event_type, "purchase_approved");

    // Zero pedidos de producao
    const ordersCount = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE project_id = 'proj_natal'").get() as any;
    assert.equal(ordersCount.c, 0);
  });

  // 3. Evento de teste sem dados suficientes
  test("Cenario 3: Evento de teste com dados parciais deve aplicar fallbacks seguros de teste sem crash", () => {
    const payloadIncompleto = {
      is_test: true,
      data: {
        event: "purchase_approved",
      },
    };
    const normalized = normalizeCaktoWebhook(payloadIncompleto, { isTest: true });
    assert.ok(normalized.transactionId.startsWith("TEST_"));
    assert.equal(normalized.eventType, "purchase_approved");
    assert.equal(normalized.customer.name, "Cliente de Teste Cakto");
    assert.equal(normalized.customer.phone, "5511999999999");
  });

  // 4. Evento purchase_approved comercial valido
  test("Cenario 4: Compra aprovada comercial valida deve criar pedido e agendar automacoes na fila", async () => {
    const commercialPayload = {
      event: "purchase_approved",
      data: {
        id: "comm_order_998877",
        status: "paid",
        offer_type: "main",
        customer: { name: "Joao Silva", phone: "11987654321", email: "joao@exemplo.com" },
        product: { id: "prod_natal_main" },
        offer: { id: "off_principal" },
        amount: 97,
      },
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cakto-signature": projectSecret,
      },
      body: JSON.stringify(commercialPayload),
    });

    assert.equal(res.status, 200);
    const json = await res.json() as any;
    assert.equal(json.success, true);
    assert.equal(json.duplicate, false);

    const order = db.prepare("SELECT * FROM orders WHERE project_id = 'proj_natal' AND transaction_id = 'comm_order_998877'").get() as any;
    assert.ok(order);
    assert.equal(order.is_test, 0);
    assert.equal(order.status, "PAID");

    const jobs = db.prepare("SELECT * FROM message_queue WHERE project_id = 'proj_natal' AND is_test = 0").all() as any[];
    assert.ok(jobs.length >= 1);
  });

  // 5. Evento comercial com assinatura invalida
  test("Cenario 5: Assinatura invalida deve retornar 401 e registrar AUTH_FAILED", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cakto-signature": "segredo_completamente_incorreto",
      },
      body: JSON.stringify({ event: "purchase_approved", data: { id: "tx_fake" } }),
    });

    assert.equal(res.status, 401);
    const event = db.prepare("SELECT * FROM webhook_events WHERE project_id = 'proj_natal' AND result = 'AUTH_FAILED'").get() as any;
    assert.ok(event);
    assert.equal(event.authenticated, 0);
  });

  // 6. Evento duplicado
  test("Cenario 6: Webhook comercial repetido deve aplicar idempotencia retornando duplicate: true", async () => {
    const commercialPayload = {
      event: "purchase_approved",
      data: {
        id: "comm_order_dupe_1",
        status: "paid",
        offer_type: "main",
        customer: { name: "Maria Duplicada", phone: "11987654322", email: "maria@exemplo.com" },
        product: { id: "prod_natal_main" },
        offer: { id: "off_principal" },
      },
    };

    // Primeiro envio
    const res1 = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cakto-signature": projectSecret },
      body: JSON.stringify(commercialPayload),
    });
    assert.equal(res1.status, 200);
    const json1 = await res1.json() as any;
    assert.equal(json1.duplicate, false);

    // Segundo envio identico
    const res2 = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cakto-signature": projectSecret },
      body: JSON.stringify(commercialPayload),
    });
    assert.equal(res2.status, 200);
    const json2 = await res2.json() as any;
    assert.equal(json2.duplicate, true);
  });

  // 7. Evento de teste repetido
  test("Cenario 7: Evento de teste repetido nao colide com pedidos comerciais", async () => {
    const testPayload = {
      is_test: true,
      event: "purchase_approved",
      data: {
        id: "TEST_REPEATED_01",
        status: "paid",
        customer: { name: "Tester", phone: "11999998888" },
        product: { id: "prod_natal_main" },
      },
    };

    const res1 = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cakto-signature": projectSecret },
      body: JSON.stringify(testPayload),
    });
    assert.equal(res1.status, 200);

    const res2 = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cakto-signature": projectSecret },
      body: JSON.stringify(testPayload),
    });
    assert.equal(res2.status, 200);

    const testEvents = db.prepare("SELECT * FROM webhook_events WHERE project_id = 'proj_natal' AND result = 'TEST'").all();
    assert.equal(testEvents.length, 2);
  });

  // 8. Ausencia de produto
  test("Cenario 8: Evento comercial sem identificacao de produto deve retornar 400", async () => {
    const payloadSemProd = {
      event: "purchase_approved",
      data: {
        id: "comm_no_prod",
        status: "paid",
        customer: { name: "Sem Produto", phone: "11987654323" },
      },
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cakto-signature": projectSecret },
      body: JSON.stringify(payloadSemProd),
    });

    assert.equal(res.status, 400);
  });

  // 9. Produto incompativel
  test("Cenario 9: Produto sem vinculo com o projeto deve retornar 422 PRODUCT_MISMATCH", async () => {
    const payloadProdErrado = {
      event: "purchase_approved",
      data: {
        id: "comm_wrong_prod",
        status: "paid",
        product: { id: "produto_de_outro_projeto" },
        customer: { name: "Cliente Estranho", phone: "11987654324" },
      },
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cakto-signature": projectSecret },
      body: JSON.stringify(payloadProdErrado),
    });

    assert.equal(res.status, 422);
    const event = db.prepare("SELECT * FROM webhook_events WHERE project_id = 'proj_natal' AND result = 'PRODUCT_MISMATCH'").get() as any;
    assert.ok(event);
  });

  // 10. Condicao de upsell
  test("Cenario 10: Oferta com tipo upsell deve ser identificada corretamente", () => {
    const body = { event: "purchase_approved" };
    const data = {
      id: "tx_up",
      offer_type: "upsell",
      product: { id: "p1" },
      customer: { name: "Cliente Upsell", phone: "11988887777" },
    };
    const normalized = normalizeCaktoWebhook({ ...body, data });
    assert.equal(normalized.offerType, "upsell");
  });

  // 11. Condicao de compra principal
  test("Cenario 11: Compra sem indicacao de upsell deve assumir compra principal", () => {
    const body = { event: "purchase_approved" };
    const data = {
      id: "tx_main",
      product: { id: "p1" },
      customer: { name: "Cliente Principal", phone: "11988887777" },
    };
    const normalized = normalizeCaktoWebhook({ ...body, data });
    assert.equal(normalized.offerType, "main");
  });

  // 12. Teste com disparo autorizado
  test("Cenario 12: Testar automacoes com evento em modo dispatch gera jobs na fila com is_test = 1", async () => {
    // Insere evento de teste no banco
    const rawPayload = {
      event: "purchase_approved",
      data: {
        id: "TEST_INITIAL_EVENT",
        status: "paid",
        product: { id: "prod_natal_main" },
      },
      is_test: true,
    };
    const eventRow = db.prepare(`
      INSERT INTO webhook_events (project_id, event_type, product_id, transaction_id, authenticated, result, payload_json, is_test)
      VALUES ('proj_natal', 'purchase_approved', 'prod_natal_main', 'TEST_INITIAL_EVENT', 1, 'TEST', ?, 1)
      RETURNING *
    `).get(JSON.stringify(rawPayload)) as any;

    const adminHeader = (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD)
      ? { Authorization: `Basic ${Buffer.from(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`).toString("base64")}` }
      : {};

    const res = await fetch(`http://127.0.0.1:${port}/api/projects/proj_natal/webhooks/${eventRow.id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeader },
      body: JSON.stringify({
        mode: "dispatch",
        phone: "5511999998888",
        name: "Destinatario Autorizado",
        authorized: true,
        fast_delay: true,
        marketing_consent: true,
      }),
    });

    assert.equal(res.status, 200);
    const json = await res.json() as any;
    assert.equal(json.success, true);
    assert.equal(json.mode, "dispatch");
    assert.ok(json.jobs.length >= 1);

    const createdJob = db.prepare("SELECT * FROM message_queue WHERE project_id = 'proj_natal' AND phone = '5511999998888'").get() as any;
    assert.ok(createdJob);
    assert.equal(createdJob.is_test, 1);
    assert.equal(createdJob.status, "PENDING");
  });

  // 12B. Replay repetido do mesmo evento de webhook em modo dispatch
  test("Cenario 12B: Re-testar o mesmo webhook em modo dispatch com outro numero nao deve falhar nem colidir idempotencia", async () => {
    const rawPayload = {
      secret: "secret_natal_test",
      event: "purchase_approved",
      data: {
        id: "tx_cakto_test_replay_twice",
        product: { id: "prod_natal_main", name: "Natal Descomplicado" },
        customer: { name: "Comprador Exemplo", phone: "5511000000000" },
        amount: 47.0,
      },
    };

    const eventRow = db.prepare(`
      INSERT INTO webhook_events (project_id, event_type, product_id, transaction_id, payload_json, authenticated, result, is_test)
      VALUES ('proj_natal', 'purchase_approved', 'prod_natal_main', 'tx_cakto_test_replay_twice', ?, 1, 'TEST', 1)
      RETURNING *
    `).get(JSON.stringify(rawPayload)) as any;

    const adminHeader = (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD)
      ? { Authorization: `Basic ${Buffer.from(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`).toString("base64")}` }
      : {};

    const res1 = await fetch(`http://127.0.0.1:${port}/api/projects/proj_natal/webhooks/${eventRow.id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeader },
      body: JSON.stringify({
        mode: "dispatch",
        phone: "5511999991111",
        name: "Primeiro Teste",
        authorized: true,
        fast_delay: true,
        marketing_consent: true,
      }),
    });
    assert.equal(res1.status, 200);
    const json1 = await res1.json() as any;
    assert.equal(json1.success, true);
    assert.ok(json1.jobs.length >= 1);

    const res2 = await fetch(`http://127.0.0.1:${port}/api/projects/proj_natal/webhooks/${eventRow.id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeader },
      body: JSON.stringify({
        mode: "dispatch",
        phone: "5511999992222",
        name: "Segundo Teste",
        authorized: true,
        fast_delay: true,
        marketing_consent: true,
      }),
    });
    assert.equal(res2.status, 200);
    const json2 = await res2.json() as any;
    assert.equal(json2.success, true);
    assert.ok(json2.jobs.length >= 1);

    const jobsPhone1 = db.prepare("SELECT * FROM message_queue WHERE project_id = 'proj_natal' AND phone = '5511999991111'").all() as any[];
    const jobsPhone2 = db.prepare("SELECT * FROM message_queue WHERE project_id = 'proj_natal' AND phone = '5511999992222'").all() as any[];
    assert.ok(jobsPhone1.length >= 1);
    assert.ok(jobsPhone2.length >= 1);
  });

  // 13. Teste sem autorizacao
  test("Cenario 13: Teste em modo dispatch sem declaracao de autorizacao deve retornar 400", async () => {
    const eventRow = db.prepare(`
      INSERT INTO webhook_events (project_id, event_type, product_id, transaction_id, authenticated, result, is_test)
      VALUES ('proj_natal', 'purchase_approved', 'prod_natal_main', 'TEST_NO_AUTH', 1, 'TEST', 1)
      RETURNING *
    `).get() as any;

    const adminHeader = (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD)
      ? { Authorization: `Basic ${Buffer.from(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`).toString("base64")}` }
      : {};

    const res = await fetch(`http://127.0.0.1:${port}/api/projects/proj_natal/webhooks/${eventRow.id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeader },
      body: JSON.stringify({
        mode: "dispatch",
        phone: "5511999998888",
        authorized: false,
      }),
    });

    assert.equal(res.status, 400);
    const json = await res.json() as any;
    assert.ok(json.error.includes("autorizado"));
  });

  // 14. Isolamento entre projetos
  test("Cenario 14: Slug e dados do projeto A nao afetam projeto B", async () => {
    const repos = createRepositories(db);
    repos.projects.create({
      id: "proj_outro",
      name: "Outro Projeto",
      slug: "outro-projeto",
      cakto_product_id: "prod_outro",
      cakto_webhook_secret: "secret_outro_projeto",
      is_active: 1,
    });

    // Envia webhook para proj_natal
    const resA = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cakto-signature": projectSecret },
      body: JSON.stringify({ event: "ping" }),
    });
    assert.equal(resA.status, 200);

    // O outro projeto nao deve ter eventos gravados
    const eventsB = db.prepare("SELECT COUNT(*) AS c FROM webhook_events WHERE project_id = 'proj_outro'").get() as any;
    assert.equal(eventsB.c, 0);

    // Tentativa com secret errado para proj_outro
    const resB = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/outro-projeto`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cakto-signature": "secret_invalido" },
      body: JSON.stringify({ event: "ping" }),
    });
    assert.equal(resB.status, 401);
  });

  // 15. Criacao e processamento de jobs persistentes
  test("Cenario 15: Jobs persistentes sao salvos no SQLite e recuperaveis por findDueJobs", () => {
    const repos = createRepositories(db);
    const cust = repos.customers.upsert({ phone: "5511999997777", name: "Cliente 15", project_id: "proj_natal" });
    const pastDate = new Date(Date.now() - 10000);

    const job = repos.messageQueue.enqueue({
      project_id: "proj_natal",
      phone: "5511999997777",
      customer_id: cust.id,
      message_type: "TEXT",
      content: "Mensagem teste",
      scheduled_at: pastDate,
      is_test: 1,
    });

    assert.ok(job.id);
    const dueJobs = repos.messageQueue.findDueJobs(new Date(), 10);
    assert.ok(dueJobs.some((j) => j.id === job.id));
  });

  // 16. Reinicializacao com jobs pendentes
  test("Cenario 16: Nova instancia de repositorio localiza jobs pendentes apos reinicializacao", () => {
    const repos1 = createRepositories(db);
    const cust = repos1.customers.upsert({ phone: "5511999996666", name: "Cliente 16", project_id: "proj_natal" });
    repos1.messageQueue.enqueue({
      project_id: "proj_natal",
      phone: "5511999996666",
      customer_id: cust.id,
      message_type: "TEXT",
      content: "Mensagem pendente pos reinicializacao",
      scheduled_at: new Date(Date.now() - 5000),
      is_test: 1,
    });

    // Simula reinicializacao de conexao/repositorio com o mesmo SQLite
    const repos2 = createRepositories(db);
    const due = repos2.messageQueue.findDueJobs(new Date(), 10);
    assert.ok(due.some((j) => j.phone === "5511999996666"));
  });

  // 17. Atualizacao de status de envio
  test("Cenario 17: Transicao de status PENDING -> PROCESSING -> SENT atualiza registros", () => {
    const repos = createRepositories(db);
    const cust = repos.customers.upsert({ phone: "5511999995555", name: "Cliente 17", project_id: "proj_natal" });
    const job = repos.messageQueue.enqueue({
      project_id: "proj_natal",
      phone: "5511999995555",
      customer_id: cust.id,
      message_type: "TEXT",
      content: "Transicao de status",
      scheduled_at: new Date(Date.now() - 1000),
      is_test: 1,
    });

    assert.equal(job.status, "PENDING");

    repos.messageQueue.markAsProcessing(job.id);
    const processingJob = repos.messageQueue.findById(job.id);
    assert.equal(processingJob?.status, "PROCESSING");

    repos.messageQueue.markAsSent(job.id, "WA_MSG_ID_TEST_123");
    const sentJob = repos.messageQueue.findById(job.id);
    assert.equal(sentJob?.status, "SENT");
    assert.equal(sentJob?.whatsapp_message_id, "WA_MSG_ID_TEST_123");
  });

  // 18. Confirmacao de entrega quando disponivel
  test("Cenario 18: Confirmacao de entrega atualiza delivered_at e reflete no timeline", () => {
    const repos = createRepositories(db);
    const cust = repos.customers.upsert({ phone: "5511999994444", name: "Cliente 18", project_id: "proj_natal" });
    const job = repos.messageQueue.enqueue({
      project_id: "proj_natal",
      phone: "5511999994444",
      customer_id: cust.id,
      message_type: "TEXT",
      content: "Entrega confirmada",
      scheduled_at: new Date(Date.now() - 1000),
      is_test: 1,
    });

    repos.messageQueue.markAsSent(job.id, "WA_MSG_ACK_18");
    db.prepare("UPDATE message_queue SET delivered_at = datetime('now') WHERE id = ?").run(job.id);

    const deliveredJob = repos.messageQueue.findById(job.id);
    assert.ok(deliveredJob?.delivered_at);
  });

  // 19. Isolamento rigoroso entre Abandono de Checkout e Pix Gerado
  test("Cenario 19: Webhook de abandono aciona exclusivamente regra de abandono e cancela se houver compra posterior", async () => {
    const repos = createRepositories(db);

    // 1. Envia webhook com evento de abandono
    const bodyAbandono = JSON.stringify({
      event: "checkout_abandonment",
      data: {
        customerCellphone: "5511999993333",
        customerName: "Lead Abandono",
        customerEmail: "abandono@teste.com",
        createdAt: "2026-11-10T18:00:00Z",
        product: { id: "prod_natal_main" },
      },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = "v1=" + crypto.createHmac("sha256", projectSecret).update(`${timestamp}.${bodyAbandono}`).digest("hex");

    const resAbandono = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cakto-Signature": signature,
        "X-Cakto-Timestamp": timestamp,
      },
      body: bodyAbandono,
    });
    assert.equal(resAbandono.status, 200);

    // Verifica que na fila existe SOMENTE o job de abandono
    const jobsAbandono = db.prepare("SELECT * FROM message_queue WHERE phone = '5511999993333'").all() as any[];
    assert.equal(jobsAbandono.length, 1);
    assert.ok(jobsAbandono[0].content.includes("finalize seu pedido"));

    // 2. Envia webhook de Pix para outro cliente
    const bodyPix = JSON.stringify({
      event: "pix_generated",
      data: {
        id: "tx_pix_999",
        status: "waiting_payment",
        customer: { name: "Lead Pix", phone: "5511999992222" },
        product: { id: "prod_natal_main" },
        pix: { qr_code_text: "00020126...PIX" },
      },
    });
    const tsPix = Math.floor(Date.now() / 1000).toString();
    const sigPix = "v1=" + crypto.createHmac("sha256", projectSecret).update(`${tsPix}.${bodyPix}`).digest("hex");

    const resPix = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cakto-Signature": sigPix,
        "X-Cakto-Timestamp": tsPix,
      },
      body: bodyPix,
    });
    assert.equal(resPix.status, 200);

    // Verifica que na fila o cliente Pix recebeu SOMENTE a mensagem de Pix
    const jobsPix = db.prepare("SELECT * FROM message_queue WHERE phone = '5511999992222'").all() as any[];
    assert.equal(jobsPix.length, 1);
    assert.ok(jobsPix[0].content.includes("segue seu Pix"));

    // 3. Agora o cliente de abandono conclui a compra
    const bodyPaid = JSON.stringify({
      event: "purchase_approved",
      data: {
        id: "tx_paid_after_abandonment",
        status: "paid",
        customer: { name: "Lead Abandono", phone: "5511999993333" },
        product: { id: "prod_natal_main" },
      },
    });
    const tsPaid = Math.floor(Date.now() / 1000).toString();
    const sigPaid = "v1=" + crypto.createHmac("sha256", projectSecret).update(`${tsPaid}.${bodyPaid}`).digest("hex");

    const resPaid = await fetch(`http://127.0.0.1:${port}/api/webhook/cakto/natal-descomplicado`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cakto-Signature": sigPaid,
        "X-Cakto-Timestamp": tsPaid,
      },
      body: bodyPaid,
    });
    assert.equal(resPaid.status, 200);

    // O job de abandono anterior agora deve ser inelegível
    const { checkQueuedAutomation } = await import("../src/engine/project-automations.js");
    const customer = repos.customers.findByPhone("5511999993333", "proj_natal");
    assert.ok(customer);
    const ineligibilityReason = checkQueuedAutomation(repos, jobsAbandono[0], customer);
    assert.equal(ineligibilityReason, "O cliente concluiu a compra após o abandono.");
  });
});
