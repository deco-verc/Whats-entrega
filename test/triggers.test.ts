import { test, describe, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as http from "node:http";
import { getDatabase, closeDatabase } from "../src/database/connection.js";
import { createWebhookApp } from "../src/webhooks/server.js";
import {
  createRepositories,
  FunnelTriggerRepository,
  type Repositories,
} from "../src/database/repositories.js";
import { FunnelStateMachine } from "../src/engine/state-machine.js";

describe("Gatilhos do Funil e Regras de Automacao (funnel_triggers)", () => {
  let repos: Repositories;
  let triggerRepo: FunnelTriggerRepository;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    closeDatabase();
    process.env.DB_PATH = ":memory:";
    const db = getDatabase();
    repos = createRepositories(db);
    triggerRepo = repos.funnelTriggers;
    repos.templates.seedDefaultTemplates(true);

    const app = createWebhookApp({
      repositories: {
        customerRepo: repos.customers,
        orderRepo: repos.orders,
        auditRepo: repos.auditLogs,
        templateRepo: repos.templates,
        funnelTriggers: triggerRepo,
      },
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

  test("GET /api/triggers deve listar e auto-seedar os 8 gatilhos canonicos do projeto", async () => {
    const res = await fetch(`${baseUrl}/api/triggers?project_id=default`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    console.log("DEBUG_TRIGGERS_VPS:", body.triggers.map((t: any) => t.trigger_key));

    assert.equal(body.success, true);
    assert.equal(body.total, 8);
    assert.equal(body.triggers.length, 8);

    const keys = body.triggers.map((t: any) => t.trigger_key);
    assert.ok(keys.includes("ABANDONMENT_RECOVERY"));
    assert.ok(keys.includes("MAIN_DELIVERY"));
    assert.ok(keys.includes("UPSELL_1_OFFER"));
    assert.ok(keys.includes("UPSELL_1_DELIVERY"));
    assert.ok(keys.includes("DOWNSELL_OFFER"));
    assert.ok(keys.includes("DOWNSELL_DELIVERY"));
    assert.ok(keys.includes("UPSELL_2_OFFER"));
    assert.ok(keys.includes("UPSELL_2_DELIVERY"));
  });

  test("PATCH /api/triggers/:id/toggle deve alternar status ativo/inativo", async () => {
    triggerRepo.seedDefaultTriggers("default", true);
    const trigger = triggerRepo.findByKey("default", "ABANDONMENT_RECOVERY");
    assert.ok(trigger);
    triggerRepo.update(trigger.id, { is_active: 1 });

    const res = await fetch(`${baseUrl}/api/triggers/${trigger.id}/toggle`, {
      method: "PATCH",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;

    assert.equal(body.success, true);
    assert.equal(body.is_active, 0);

    const updated = triggerRepo.findById(trigger.id);
    assert.equal(updated?.is_active, 0);
  });

  test("PUT /api/triggers/:id deve atualizar delay e template_id", async () => {
    triggerRepo.seedDefaultTriggers("default", true);
    const trigger = triggerRepo.findByKey("default", "MAIN_DELIVERY");
    assert.ok(trigger);

    const res = await fetch(`${baseUrl}/api/triggers/${trigger.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        delay_seconds: 60,
        name: "Entrega Principal Customizada",
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;

    assert.equal(body.success, true);
    assert.equal(body.trigger.delay_seconds, 60);
    assert.equal(body.trigger.name, "Entrega Principal Customizada");
  });

  test("FunnelStateMachine deve respeitar gatilho desativado de Recuperacao de Abandono", async () => {
    const fsm = new FunnelStateMachine(repos);
    triggerRepo.seedDefaultTriggers("default", true);
    const trigger = triggerRepo.findByKey("default", "ABANDONMENT_RECOVERY");
    assert.ok(trigger);

    // Desativa gatilho diretamente com update
    triggerRepo.update(trigger.id, { is_active: 0 });
    const triggerDeactivated = triggerRepo.findById(trigger.id);
    assert.equal(triggerDeactivated?.is_active, 0);

    const testTx = `tx_abandoned_test_${Date.now()}`;
    const testPhone = `551199999${Math.floor(1000 + Math.random() * 9000)}`;

    const result = fsm.handlePixGenerated({
      transactionId: testTx,
      phone: testPhone,
      name: "Cliente Abandono",
      pixCode: "PIX_CODE_TEST",
      projectId: "default",
    });

    assert.equal(result.success, true);
    assert.equal(result.enqueuedJobsCount, 0); // Zero mensagens enfileiradas porque gatilho esta inativo

    const jobs = repos.messageQueue.listByCustomerId(result.customerId, "PENDING");
    assert.equal(jobs.length, 0);
  });

  test("FunnelStateMachine deve aplicar delay customizado do gatilho quando ativo", async () => {
    const fsm = new FunnelStateMachine(repos);
    triggerRepo.seedDefaultTriggers("default", true);
    const trigger = triggerRepo.findByKey("default", "ABANDONMENT_RECOVERY");
    assert.ok(trigger);

    // Garante ativo e define delay de 120 segundos (2 minutos)
    triggerRepo.update(trigger.id, { is_active: 1, delay_seconds: 120 });

    const before = Date.now();
    const testTx = `tx_abandoned_delay_${Date.now()}`;
    const testPhone = `551199999${Math.floor(1000 + Math.random() * 9000)}`;

    const result = fsm.handlePixGenerated({
      transactionId: testTx,
      phone: testPhone,
      name: "Cliente Delay",
      pixCode: "PIX_CODE_TEST_2",
      projectId: "default",
    });

    assert.equal(result.success, true);
    assert.ok(result.enqueuedJobsCount >= 1);

    const jobs = repos.messageQueue.listByCustomerId(result.customerId, "PENDING");
    assert.ok(jobs.length >= 1);
    const scheduled = new Date(jobs[0].scheduled_at).getTime();
    const diffSeconds = Math.round((scheduled - before) / 1000);
    assert.ok(diffSeconds >= 118 && diffSeconds <= 125);
  });
});
