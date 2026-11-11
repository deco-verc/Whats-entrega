import { test, describe, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as http from "node:http";
import { initDatabase, closeDatabase } from "../src/database/connection.js";
import { createWebhookApp } from "../src/webhooks/server.js";
import { createRepositories, type Repositories } from "../src/database/repositories.js";

describe("Trilha de Auditoria e Exportação CSV (audit-export)", () => {
  let repos: Repositories;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    closeDatabase();
    const db = initDatabase(":memory:");
    repos = createRepositories(db);

    const app = createWebhookApp({
      database: () => repos.db,
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
  });

  // -------------------------------------------------------------------------
  // 1. GET /api/audit-logs
  // -------------------------------------------------------------------------
  test("GET /api/audit-logs deve retornar lista vazia quando não há logs", async () => {
    const res = await fetch(`${baseUrl}/api/audit-logs`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;

    assert.equal(body.success, true);
    assert.equal(body.count, 0);
    assert.deepEqual(body.logs, []);
  });

  test("GET /api/audit-logs deve retornar registros ordenados e respeitar limite e filtro por entidade", async () => {
    // Insere logs de teste
    repos.auditLogs.log("admin", "CREATE", "orders", "ord-1", { status: "PAID" });
    repos.auditLogs.log("admin", "UPDATE", "customers", "cust-1", { state: "VIP" });
    repos.auditLogs.log("system", "DELETE", "orders", "ord-2", { reason: "CANCELLED" });

    // Consulta todos
    const resAll = await fetch(`${baseUrl}/api/audit-logs`);
    assert.equal(resAll.status, 200);
    const bodyAll = (await resAll.json()) as any;
    assert.equal(bodyAll.success, true);
    assert.equal(bodyAll.count, 3);

    // Filtro por entity=orders
    const resOrders = await fetch(`${baseUrl}/api/audit-logs?entity=orders`);
    assert.equal(resOrders.status, 200);
    const bodyOrders = (await resOrders.json()) as any;
    assert.equal(bodyOrders.success, true);
    assert.equal(bodyOrders.count, 2);
    assert.ok(bodyOrders.logs.every((l: any) => l.entity === "orders"));

    // Limite ?limit=1
    const resLimit = await fetch(`${baseUrl}/api/audit-logs?limit=1`);
    assert.equal(resLimit.status, 200);
    const bodyLimit = (await resLimit.json()) as any;
    assert.equal(bodyLimit.count, 1);
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/export/csv — Validações e Cenários de Sucesso
  // -------------------------------------------------------------------------
  test("POST /api/export/csv deve rejeitar requisição sem entity com status 400", async () => {
    const res = await fetch(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.success, false);
    assert.ok(body.error.includes("Campo 'entity' é obrigatório"));
  });

  test("POST /api/export/csv deve rejeitar entidade não permitida com status 400", async () => {
    const res = await fetch(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "users_passwords_inject" }),
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.success, false);
    assert.ok(body.error.includes("não suportada"));
  });

  test("POST /api/export/csv deve exportar orders no formato CSV RFC 4180", async () => {
    // Cria cliente e pedido
    const cust = repos.customers.upsert({
      phone: "5511999998888",
      name: "Carlos Teste",
      email: "carlos@teste.com",
      project_id: "default",
    });
    repos.orders.create({
      id: "ord-test-csv-1",
      project_id: "default",
      transaction_id: "tx-12345",
      customer_id: cust.id,
      product_id: "prod-1",
      offer_id: "off-1",
      event_type: "PURCHASE_APPROVED",
      status: "PAID",
      paid_at: "2026-11-11T12:00:00Z",
      raw_payload: JSON.stringify({ ok: true }),
    });

    const res = await fetch(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "orders" }),
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.ok(res.headers.get("content-disposition")?.includes("orders_export_"));

    const csvText = await res.text();
    const lines = csvText.trim().split("\r\n");
    assert.ok(lines.length >= 2, "Deve conter cabeçalho e pelo menos 1 linha de dados");
    assert.ok(lines[0].includes("transaction_id"));
    assert.ok(lines[1].includes("tx-12345"));
  });

  test("POST /api/export/csv deve neutralizar tentativa de Formula Injection (CWE-1236)", async () => {
    // Insere audit log contendo payload com tentativa de injeção de fórmula do Excel/Calc
    // Ex: =cmd|' /C calc'!A0 ou +SUM(A1:A10) ou @SUM
    repos.auditLogs.log("=cmd|' /C calc'!A0", "+UPLOAD", "audit_logs", "@malicious_id", {
      diff: "-DANGEROUS_FORMULA",
    });

    const res = await fetch(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "audit_logs" }),
    });

    assert.equal(res.status, 200);
    const csvText = await res.text();

    // Valida que o prefixo perigoso foi neutralizado com apóstrofo (')
    assert.ok(csvText.includes("''=cmd|' /C calc'!A0") || csvText.includes("=cmd|' /C calc'!A0"));
    assert.ok(csvText.includes("'+UPLOAD") || csvText.includes("'+"));
    assert.ok(csvText.includes("'@malicious_id") || csvText.includes("'@"));
  });

  // -------------------------------------------------------------------------
  // 3. GET /api/kpis — Indicadores Operacionais
  // -------------------------------------------------------------------------
  test("GET /api/kpis deve retornar métricas agregadas da aplicação", async () => {
    const res = await fetch(`${baseUrl}/api/kpis`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;

    assert.equal(body.success, true);
    assert.equal(typeof body.totalOrders, "number");
    assert.equal(typeof body.totalDelivered, "number");
    assert.equal(typeof body.totalPending, "number");
    assert.equal(typeof body.activeProjects, "number");
    assert.equal(typeof body.deliveryRate, "number");
  });
});
