import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { createDatabaseConnection } from "../src/database/connection.js";
import {
  CustomerRepository,
  OrderRepository,
  AuditLogRepository,
  MessageQueueRepository,
} from "../src/database/repositories.js";
import { createWebhookApp } from "../src/webhooks/server.js";
import { computeCaktoHmac } from "../src/webhooks/adapters.js";
import { env } from "../src/config/env.js";

describe("Simulador de Eventos Cakto (POST /api/simulator/cakto)", () => {
  test("deve retornar 400 Bad Request se telefone estiver ausente ou tiver menos de 8 digitos", async () => {
    const app = createWebhookApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // Sem telefone
      const resEmpty = await fetch(`http://127.0.0.1:${port}/api/simulator/cakto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Teste Sem Telefone" }),
      });
      assert.equal(resEmpty.status, 400);
      const dataEmpty = await resEmpty.json() as any;
      assert.equal(dataEmpty.error, "ValidationError");

      // Telefone com menos de 8 dígitos
      const resShort = await fetch(`http://127.0.0.1:${port}/api/simulator/cakto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "12345", name: "Teste Curto" }),
      });
      assert.equal(resShort.status, 400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve simular evento pix_generated gerando payload valido e assinatura HMAC-SHA256", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const ordRepo = new OrderRepository(db);
    const audRepo = new AuditLogRepository(db);

    const secret = "cakto_sec_sim_test_123";
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

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/simulator/cakto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          name: "Carlos Teste Pix",
          event: "pix_generated",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.equal(data.success, true);
      assert.equal(data.simulated_event, "pix_generated");
      assert.ok(data.transaction_id.startsWith("sim_tx_"));
      assert.ok(typeof data.hmac_signature === "string" && data.hmac_signature.length === 64);

      // Valida isolamento estrito: simulação é dry-run e não persiste dados no banco de produção
      const customer = custRepo.findByPhone("5511988887777");
      assert.equal(customer, null, "Simulação isolada não deve persistir cliente no banco");

      const order = ordRepo.findByTransactionAndEvent(data.transaction_id, "pix_generated");
      assert.equal(order, null, "Simulação isolada não deve persistir pedido no banco");
      assert.equal(data.approved, true);
      assert.equal(data.sent, false);
      assert.ok(Array.isArray(data.jobs) && data.jobs.length >= 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  });

  test("deve simular compra aprovada do produto principal (purchase_approved MAIN)", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const ordRepo = new OrderRepository(db);
    const audRepo = new AuditLogRepository(db);

    const secret = "cakto_sec_sim_main_456";
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

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/simulator/cakto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "(21) 97777-6666",
          name: "Mariana Aluna",
          event: "purchase_approved",
          productType: "MAIN",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.equal(data.success, true);
      assert.equal(data.simulated_event, "purchase_approved");
      assert.equal(data.product_id, "prod_main_01");

      // Valida isolamento estrito: simulação é dry-run e não persiste dados no banco de produção
      const customer = custRepo.findByPhone("5521977776666");
      assert.equal(customer, null, "Simulação isolada não deve persistir cliente no banco");
      assert.equal(data.approved, true);
      assert.equal(data.sent, false);
      assert.ok(Array.isArray(data.jobs) && data.jobs.length >= 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  });

  test("deve simular compra de Upsell 1 (purchase_approved UPSELL_1)", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const ordRepo = new OrderRepository(db);

    const app = createWebhookApp({
      repositories: {
        customerRepo: custRepo,
        orderRepo: ordRepo,
      },
    });
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/simulator/cakto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11966665555",
          name: "Felipe Upsell",
          event: "purchase_approved",
          productType: "UPSELL_1",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.equal(data.success, true);
      assert.equal(data.product_id, "prod_upsell_01");
      assert.equal(data.offer_id, "off_upsell_1_standard");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  });

  test("deve simular resposta do cliente ativando micro-comprometimento", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const ordRepo = new OrderRepository(db);
    const queueRepo = new MessageQueueRepository(db);

    // Cria cliente prévio no estado DELIVERED_MAIN com job PITCH_UPSELL_1 agendado
    const customer = custRepo.upsert({
      phone: "5511955554444",
      name: "Bruna Silva",
      current_state: "DELIVERED_MAIN",
    });

    queueRepo.enqueue({
      customer_id: customer.id,
      phone: customer.phone,
      message_type: "PITCH_UPSELL_1",
      content: "Audio PTT Upsell 1",
      scheduled_at: new Date(Date.now() + 900 * 1000), // +15min
    });

    const app = createWebhookApp({
      repositories: {
        customerRepo: custRepo,
        orderRepo: ordRepo,
      },
    });
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/simulator/cakto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "5511955554444",
          name: "Bruna Silva",
          event: "customer_reply",
          text: "SIM, abri e achei fantastico!",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.equal(data.success, true);
      assert.equal(data.mode, "customer_reply");
      assert.ok(data.message.includes("Resposta processada") || data.message.includes("Resposta do cliente"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  });

  test("computeCaktoHmac deve gerar hash HMAC-SHA256 deterministico", () => {
    const secret = "test_hmac_secret_key";
    const payload = { test: 123, event: "purchase_approved" };
    const hash1 = computeCaktoHmac(payload, secret);
    const hash2 = computeCaktoHmac(payload, secret);

    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hash1));
  });
});
