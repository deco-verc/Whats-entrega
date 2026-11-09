import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import {
  createDatabaseConnection,
} from "../src/database/connection.js";
import {
  CustomerRepository,
  OrderRepository,
  AuditLogRepository,
} from "../src/database/repositories.js";
import {
  sanitizePhone,
  validateCaktoSecret,
  normalizeEventType,
  normalizeCaktoWebhook,
  processNormalizedWebhook,
} from "../src/webhooks/adapters.js";
import {
  createWebhookApp,
} from "../src/webhooks/server.js";

describe("Adaptadores e Normalização de Payloads Cakto (adapters.ts)", () => {
  test("sanitizePhone deve higienizar formatos brasileiros adicionando DDI 55 quando ausente", () => {
    // 11 digitos nacionais
    assert.equal(sanitizePhone("(11) 98765-4321"), "5511987654321");
    assert.equal(sanitizePhone("11987654321"), "5511987654321");

    // 10 digitos nacionais
    assert.equal(sanitizePhone("(21) 8888-7777"), "552188887777");

    // Com DDI 55 ja informado
    assert.equal(sanitizePhone("5511987654321"), "5511987654321");
    assert.equal(sanitizePhone("+55 (11) 98765-4321"), "5511987654321");

    // Formato internacional explicito
    assert.equal(sanitizePhone("+1 (202) 555-0199"), "12025550199");
  });

  test("sanitizePhone deve lancar erro para formatos invalidos", () => {
    assert.throws(() => sanitizePhone(""), /Invalid phone/);
    assert.throws(() => sanitizePhone("1234"), /expected between 10 and 15 digits/);
    assert.throws(() => sanitizePhone("+12"), /too short/);
  });

  test("validateCaktoSecret deve comparar segredo de forma segura em tempo constante", () => {
    const validSecret = "cakto_sec_test_123456";

    assert.equal(validateCaktoSecret(validSecret, validSecret), true);
    assert.equal(validateCaktoSecret(` ${validSecret} `, validSecret), true);

    // Segredos incorretos
    assert.equal(validateCaktoSecret("segredo_errado", validSecret), false);
    assert.equal(validateCaktoSecret("", validSecret), false);
    assert.equal(validateCaktoSecret(undefined, validSecret), false);
    assert.equal(validateCaktoSecret(validSecret, ""), false);
  });

  test("normalizeEventType deve mapear eventos para padrao canonico", () => {
    assert.equal(normalizeEventType("purchase_approved"), "purchase_approved");
    assert.equal(normalizeEventType("approved"), "purchase_approved");
    assert.equal(normalizeEventType("paid"), "purchase_approved");
    assert.equal(normalizeEventType(undefined, "paid"), "purchase_approved");

    assert.equal(normalizeEventType("pix_generated"), "pix_generated");
    assert.equal(normalizeEventType("waiting_payment"), "pix_generated");
    assert.equal(normalizeEventType(undefined, "pending"), "pix_generated");

    assert.equal(normalizeEventType("boleto_generated"), "boleto_generated");
    assert.equal(normalizeEventType("purchase_refunded"), "purchase_refunded");
    assert.equal(normalizeEventType("chargeback"), "chargeback");
    assert.equal(normalizeEventType("custom_event"), "custom_event");
  });

  test("normalizeCaktoWebhook deve extrair DTO limpo de estrutura aninhada da Cakto", () => {
    const rawPayload = {
      event: "purchase_approved",
      secret: "sec_test",
      data: {
        id: "trans_cakto_9988",
        status: "paid",
        customer: {
          name: "Lucas Aluno",
          phone: "(11) 99887-6655",
          email: "lucas@test.com",
        },
        product: {
          id: "prod_main",
        },
        offer: {
          id: "off_main_promo",
        },
        pix: {
          qr_code_text: "00020126580014BR.GOV.BCB.PIX",
          qr_code_url: "https://cakto.com/pix/qr.png",
        },
        paid_at: "2026-10-31T18:00:00Z",
      },
    };

    const normalized = normalizeCaktoWebhook(rawPayload);

    assert.equal(normalized.transactionId, "trans_cakto_9988");
    assert.equal(normalized.eventType, "purchase_approved");
    assert.equal(normalized.status, "PAID");
    assert.equal(normalized.customer.name, "Lucas Aluno");
    assert.equal(normalized.customer.phone, "5511998876655");
    assert.equal(normalized.customer.email, "lucas@test.com");
    assert.equal(normalized.product.id, "prod_main");
    assert.equal(normalized.product.offerId, "off_main_promo");
    assert.equal(normalized.pix?.qrCodeText, "00020126580014BR.GOV.BCB.PIX");
    assert.equal(normalized.pix?.qrCodeUrl, "https://cakto.com/pix/qr.png");
    assert.equal(normalized.paidAt, "2026-10-31T18:00:00Z");
  });

  test("normalizeCaktoWebhook deve validar campos obrigatorios", () => {
    assert.throws(
      () => normalizeCaktoWebhook({}),
      /transaction_id is required/
    );

    assert.throws(
      () => normalizeCaktoWebhook({ id: "t1" }),
      /customer.name is required/
    );

    assert.throws(
      () => normalizeCaktoWebhook({ id: "t1", customer: { name: "Deco" } }),
      /customer.phone is required/
    );

    assert.throws(
      () => normalizeCaktoWebhook({ id: "t1", customer: { name: "Deco", phone: "11999998888" } }),
      /product.id is required/
    );
  });

  test("processNormalizedWebhook deve persistir cliente e pedido com idempotencia", () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const ordRepo = new OrderRepository(db);
    const audRepo = new AuditLogRepository(db);

    const payload = {
      transactionId: "tx_idem_100",
      eventType: "purchase_approved",
      status: "APPROVED",
      customer: {
        name: "Renata Vendas",
        phone: "5511988881234",
        email: "renata@example.com",
      },
      product: {
        id: "prod_main",
        offerId: "off_default",
      },
      rawPayload: { test: true },
    };

    // Primeiro processamento
    const res1 = processNormalizedWebhook(payload, {
      customerRepo: custRepo,
      orderRepo: ordRepo,
      auditRepo: audRepo,
    });

    assert.equal(res1.isDuplicate, false);
    assert.equal(res1.customer.phone, "5511988881234");
    assert.equal(res1.order.transaction_id, "tx_idem_100");

    // Segundo processamento identico (mesmo transaction_id + event_type)
    const res2 = processNormalizedWebhook(payload, {
      customerRepo: custRepo,
      orderRepo: ordRepo,
      auditRepo: audRepo,
    });

    assert.equal(res2.isDuplicate, true);
    assert.equal(res2.order.id, res1.order.id);

    // Contagem no SQLite deve permanecer 1
    assert.equal(ordRepo.count(), 1);
    assert.equal(custRepo.count(), 1);

    db.close();
  });
});

describe("Servidor HTTP de Webhooks Cakto (server.ts)", () => {
  test("deve responder GET /api/health com JSON de integridade e headers de seguranca", async () => {
    const app = createWebhookApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");

    const data = await res.json() as any;
    assert.equal(data.status, "ok");
    assert.ok(typeof data.uptime === "number");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("deve rejeitar POST /webhook/cakto com HTTP 401 se secret for invalido ou ausente", async () => {
    const app = createWebhookApp({ secret: "segredo_obrigatorio" });
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    // Sem secret
    const res1 = await fetch(`http://127.0.0.1:${port}/webhook/cakto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "t1" }),
    });
    assert.equal(res1.status, 401);

    // Com secret incorreto
    const res2 = await fetch(`http://127.0.0.1:${port}/webhook/cakto`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cakto-signature": "segredo_incorreto",
      },
      body: JSON.stringify({ id: "t1" }),
    });
    assert.equal(res2.status, 401);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("deve aceitar POST /webhook/cakto com HTTP 200 (<100ms) quando secret for valido via header", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const ordRepo = new OrderRepository(db);
    const audRepo = new AuditLogRepository(db);

    const secret = "segredo_valido_cakto";
    const app = createWebhookApp({
      secret,
      repositories: {
        customerRepo: custRepo,
        orderRepo: ordRepo,
        auditRepo: audRepo,
      },
    });
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const payload = {
      event: "purchase_approved",
      data: {
        id: "trans_http_101",
        status: "paid",
        customer: {
          name: "Mariana Teste",
          phone: "11987654321",
          email: "mariana@test.com",
        },
        product: { id: "prod_main" },
        offer: { id: "off_main_default" },
      },
    };

    const startTime = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/webhook/cakto`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cakto-signature": secret,
      },
      body: JSON.stringify(payload),
    });
    const duration = Date.now() - startTime;

    assert.equal(res.status, 200);
    assert.ok(duration < 100, `Resposta levou ${duration}ms, esperado < 100ms`);

    const json = await res.json() as any;
    assert.equal(json.success, true);
    assert.equal(json.transaction_id, "trans_http_101");
    assert.equal(json.duplicate, false);

    // Segundo envio do mesmo webhook -> retorna 200 com duplicate: true
    const resDupe = await fetch(`http://127.0.0.1:${port}/webhook/cakto`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cakto-signature": secret,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(resDupe.status, 200);
    const jsonDupe = await resDupe.json() as any;
    assert.equal(jsonDupe.duplicate, true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  test("deve aceitar secret via query parameter ?secret= e via Authorization Bearer", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const ordRepo = new OrderRepository(db);

    const secret = "segredo_query_test";
    const app = createWebhookApp({
      secret,
      repositories: {
        customerRepo: custRepo,
        orderRepo: ordRepo,
      },
    });
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    // Via query param
    const resQuery = await fetch(`http://127.0.0.1:${port}/webhook/cakto?secret=${secret}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "tx_query_1",
        event: "pix_generated",
        customer: { name: "Deco", phone: "11999998888" },
        product: { id: "prod_main" },
      }),
    });
    assert.equal(resQuery.status, 200);

    // Via Authorization Bearer
    const resBearer = await fetch(`http://127.0.0.1:${port}/webhook/cakto`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: JSON.stringify({
        id: "tx_bearer_2",
        event: "pix_generated",
        customer: { name: "Deco", phone: "11999998888" },
        product: { id: "prod_main" },
      }),
    });
    assert.equal(resBearer.status, 200);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  test("deve retornar 400 Bad Request para payload malformado", async () => {
    const secret = "segredo_teste_400";
    const app = createWebhookApp({ secret });
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/webhook/cakto`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cakto-signature": secret,
      },
      body: JSON.stringify({
        id: "tx_incomplete",
        // Faltando dados obrigatorios do customer e product
      }),
    });
    assert.equal(res.status, 400);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("deve servir HTML na rota raiz GET / e bloquear Path Traversal", async () => {
    const app = createWebhookApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const resRoot = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(resRoot.status, 200);
    assert.ok(resRoot.headers.get("content-type")?.includes("text/html"));

    // Path Traversal
    const resTraversal = await fetch(`http://127.0.0.1:${port}/../../../.env`);
    assert.equal(resTraversal.status, 403);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("GET /api/status deve expor objeto whatsapp estruturado { status, qr, pairingCode, connectedPhone }", async () => {
    const app = createWebhookApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;

    assert.equal(data.status, "ok");
    assert.ok(data.whatsapp);
    assert.ok("status" in data.whatsapp);
    assert.ok("qr" in data.whatsapp);
    assert.ok("pairingCode" in data.whatsapp);
    assert.ok("connectedPhone" in data.whatsapp);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("POST /api/whatsapp/pair deve validar telefone e rejeitar payload invalido", async () => {
    const app = createWebhookApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const resInvalid = await fetch(`http://127.0.0.1:${port}/api/whatsapp/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "123" }),
    });
    assert.equal(resInvalid.status, 400);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("POST /api/whatsapp/logout deve desconectar sessao com sucesso", async () => {
    const app = createWebhookApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const resLogout = await fetch(`http://127.0.0.1:${port}/api/whatsapp/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(resLogout.status, 200);
    const json = await resLogout.json() as any;
    assert.equal(json.success, true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
