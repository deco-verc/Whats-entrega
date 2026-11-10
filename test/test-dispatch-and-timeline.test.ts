import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { createDatabaseConnection } from "../src/database/connection.js";
import { createRepositories } from "../src/database/repositories.js";
import { createProjectWorkspaceRouter } from "../src/routes/project-workspace.js";
import { extractOfferType } from "../src/webhooks/adapters.js";

test("extractOfferType: fallback para 'main' e deteccao de upsell/orderbump", () => {
  assert.equal(extractOfferType({}, {}), "main");
  assert.equal(extractOfferType({ offer_type: "main" }, {}), "main");
  assert.equal(extractOfferType({ offer_type: "upsell" }, {}), "upsell");
  assert.equal(extractOfferType({ type: "orderbump" }, {}), "orderbump");
  assert.equal(extractOfferType({ is_upsell: true }, {}), "upsell");
});

test("Fluxo de Teste Real de Disparo, Isolamento de Metricas e Linha do Tempo", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "entrega-test-dispatch-"));
  const filename = path.join(directory, "funnel.db");
  const db = createDatabaseConnection(filename);
  const repos = createRepositories(db);

  try {
    const project = repos.projects.create({
      name: "Projeto Natal Teste",
      slug: "natal-teste",
      cakto_product_id: "prod-natal",
    });

    const template = repos.templates.create({
      name: "Entrega Natal",
      content: "Ola {nome}, seu acesso ao {produto} esta liberado!",
      project_id: project.id,
    });

    const trigger = repos.funnelTriggers.create({
      name: "Compra Aprovada Main",
      trigger_key: "custom_natal_1",
      event_type: "purchase_approved",
      delay_seconds: 60,
      is_active: 1,
      template_id: template.id,
      project_id: project.id,
    });

    repos.db.prepare(
      "INSERT INTO automation_conditions (trigger_id, conditions_json) VALUES (?, ?)"
    ).run(trigger.id, JSON.stringify({ offer_type: "main" }));

    const app = express();
    app.use(express.json());
    app.use("/api/projects", createProjectWorkspaceRouter(() => db, {}));

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      // 1. Rejeita se nao autorizado
      const unauthReq = await fetch(`${origin}/api/projects/${project.id}/test-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "5511999998888",
          authorized: false,
        }),
      });
      assert.equal(unauthReq.status, 400);

      // 2. Executa disparo de teste real autorizado
      const testReq = await fetch(`${origin}/api/projects/${project.id}/test-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "5511999998888",
          name: "Comprador Teste",
          authorized: true,
          fast_delay: true,
          offer_type: "main",
          event_type: "purchase_approved",
        }),
      });

      assert.equal(testReq.status, 200);
      const testBody = await testReq.json() as any;
      assert.equal(testBody.success, true);
      assert.ok(testBody.transaction_id.startsWith("TEST_"));
      assert.equal(testBody.jobs.length, 1);
      const createdJob = testBody.jobs[0];
      assert.equal(createdJob.status, "PENDING");

      // 3. Verifica isolamento: contagem de orders do KPI ignora is_test = 1
      const orderCount = repos.orders.count(project.id);
      assert.equal(orderCount, 0, "Orders de teste nao devem contar no KPI de vendas de producao");

      // 4. Inspeciona a linha do tempo
      const timelineReq = await fetch(`${origin}/api/projects/${project.id}/queue/${createdJob.id}/timeline`);
      assert.equal(timelineReq.status, 200);
      const timelineBody = await timelineReq.json() as any;
      assert.equal(timelineBody.job.id, createdJob.id);
      assert.equal(timelineBody.job.is_test, 1);
      assert.equal(timelineBody.webhook_event.is_test, 1);
      assert.equal(timelineBody.order.is_test, 1);

      // 5. Simula entrega confirmada
      const markRes = repos.messageQueue.markAsDelivered(createdJob.id);
      assert.equal(markRes, true);
      const updatedJob = repos.messageQueue.findById(createdJob.id);
      assert.ok(updatedJob?.delivered_at);

      // 6. Testa cancelamento de disparos de teste pendentes
      const anotherReq = await fetch(`${origin}/api/projects/${project.id}/test-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "5511999997777",
          name: "Segundo Teste",
          authorized: true,
          fast_delay: false,
        }),
      });
      assert.equal(anotherReq.status, 200);

      const cancelReq = await fetch(`${origin}/api/projects/${project.id}/queue/cancel-test-jobs`, {
        method: "POST",
      });
      assert.equal(cancelReq.status, 200);
      const cancelBody = await cancelReq.json() as any;
      assert.ok(cancelBody.cancelled_count >= 1);
    } finally {
      server.close();
    }
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
