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
import { scheduleProjectAutomations } from "../src/engine/project-automations.js";
import { QueueWorker } from "../src/engine/worker.js";
import type { NormalizedCaktoPayload } from "../src/webhooks/adapters.js";

test("Auditoria e Homologacao de Delays: Modo Rapido vs. Delays Reais", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "entrega-delays-test-"));
  const filename = path.join(directory, "funnel.db");
  const db = createDatabaseConnection(filename);
  const repos = createRepositories(db);

  try {
    // Setup do Projeto "Natal Descomplicado" com as duas automacoes canonicas:
    // 1. Entrega Natal (delay: 60 segundos)
    // 2. Oferta Upsell (delay: 1800 segundos / 30 minutos)
    const project = repos.projects.create({
      name: "Natal Descomplicado",
      slug: "natal-descomplicado",
      cakto_product_id: "prod-natal-main",
    });

    const templateEntrega = repos.templates.create({
      name: "Entrega Natal",
      content: "Ola {{first_name}}, aqui esta o seu acesso ao Natal Descomplicado!",
      project_id: project.id,
    });

    const templateUpsell = repos.templates.create({
      name: "Oferta Upsell",
      content: "Ola {{first_name}}, confira nossa masterclass exclusiva de Natal!",
      project_id: project.id,
    });

    const triggerEntrega = repos.funnelTriggers.create({
      name: "Entrega Natal 1min",
      trigger_key: "natal_entrega_main",
      event_type: "purchase_approved",
      delay_seconds: 60,
      is_active: 1,
      template_id: templateEntrega.id,
      project_id: project.id,
    });

    const triggerUpsell = repos.funnelTriggers.create({
      name: "Oferta Upsell 30min",
      trigger_key: "natal_upsell_offer",
      event_type: "purchase_approved",
      delay_seconds: 1800,
      is_active: 1,
      template_id: templateUpsell.id,
      project_id: project.id,
    });

    const customer = repos.customers.upsert({
      name: "Cliente Teste Natal",
      phone: "5511999998888",
      project_id: project.id,
    });

    const orderTest = repos.orders.create({
      transaction_id: "TX_TEST_001",
      customer_id: customer.id,
      product_id: "prod-natal-main",
      offer_id: "OFF_MAIN",
      event_type: "purchase_approved",
      status: "PAID",
      project_id: project.id,
      is_test: 1,
      raw_payload: { amount: 97, currency: "BRL" },
    });

    const mockEvent: NormalizedCaktoPayload = {
      transactionId: "TX_TEST_001",
      eventType: "purchase_approved",
      status: "PAID",
      customer: {
        name: customer.name,
        email: "teste@example.com",
        phone: customer.phone,
      },
      product: {
        id: "prod-natal-main",
        offerId: "OFF_MAIN",
      },
      paidAt: new Date().toISOString(),
      rawPayload: {},
    };

    // Permissao de marketing para que a regra de upsell seja elegivel
    repos.db.prepare(
      "INSERT INTO contact_permissions (project_id, phone, marketing, opted_out) VALUES (?, ?, 1, 0)"
    ).run(project.id, customer.phone);

    const app = express();
    app.use(express.json());
    app.use("/api/projects", createProjectWorkspaceRouter(() => db, {}));

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      await t.test("1 & 2 & 4: MODO B — Teste Real deve agendar Entrega (60s) e Upsell (1800s) a partir do mesmo instante", async () => {
        const referenceTime = new Date("2026-11-11T12:00:00.000Z");
        const res = await fetch(`${origin}/api/projects/${project.id}/test-dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: customer.phone,
            name: customer.name,
            mode: "real",
            event_type: "purchase_approved",
            offer_type: "main",
            authorized: true,
            marketing_consent: true,
          }),
        });

        assert.equal(res.status, 200);
        const body = await res.json() as any;
        assert.equal(body.success, true);
        assert.equal(body.mode, "real");
        assert.equal(body.jobs.length, 2, "Devem ser criados 2 jobs na fila");

        const entregaJob = body.jobs.find((j: any) => j.automation === "Entrega Natal 1min");
        const upsellJob = body.jobs.find((j: any) => j.automation === "Oferta Upsell 30min");

        assert.ok(entregaJob, "Job de entrega deve existir");
        assert.ok(upsellJob, "Job de upsell deve existir");

        // Verifica os timestamps exatos
        const entregaTime = new Date(entregaJob.scheduled_at).getTime();
        const upsellTime = new Date(upsellJob.scheduled_at).getTime();

        // A diferenca entre Upsell e Entrega deve ser exatamente 1800s - 60s = 1740s
        const diffSeconds = (upsellTime - entregaTime) / 1000;
        assert.equal(diffSeconds, 1740, "Upsell deve ser agendado exatamente 1740s apos a entrega (1800s do evento)");
      });

      await t.test("3: MODO A — Teste Rapido deve agendar delays de homologacao (2s e 5s) sem colapsar no mesmo segundo", async () => {
        const res = await fetch(`${origin}/api/projects/${project.id}/test-dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: "5511999996666",
            name: "Cliente Teste Rapido",
            mode: "fast",
            event_type: "purchase_approved",
            offer_type: "main",
            authorized: true,
            marketing_consent: true,
          }),
        });

        assert.equal(res.status, 200);
        const body = await res.json() as any;
        assert.equal(body.success, true);
        assert.equal(body.mode, "fast");
        assert.equal(body.jobs.length, 2);

        const j1 = body.jobs[0];
        const j2 = body.jobs[1];

        const t1 = new Date(j1.scheduled_at).getTime();
        const t2 = new Date(j2.scheduled_at).getTime();

        // No modo rapido, primeiro job e +2s, segundo job e +5s (3s de diferenca para fila ordenada)
        const diffMs = t2 - t1;
        assert.ok(diffMs >= 2000 && diffMs <= 4000, "Jobs no modo rapido devem ser sequenciais com espacamento seguro");
      });

      await t.test("5: Configuracoes de producao em funnel_triggers NAO sofrem nenhuma mutacao", () => {
        const t1 = repos.funnelTriggers.findById(triggerEntrega.id);
        const t2 = repos.funnelTriggers.findById(triggerUpsell.id);

        assert.equal(t1?.delay_seconds, 60, "Trigger Entrega deve manter delay_seconds = 60");
        assert.equal(t2?.delay_seconds, 1800, "Trigger Upsell deve manter delay_seconds = 1800");
      });

      await t.test("6 & 10: Persistencia no SQLite com ISO 8601 estrito e recuperacao pos-reinicializacao", () => {
        const jobs = repos.db.prepare("SELECT scheduled_at FROM message_queue WHERE project_id = ?").all(project.id) as { scheduled_at: string }[];
        for (const job of jobs) {
          assert.ok(job.scheduled_at.includes("T"), "Data em scheduled_at deve conter o separador 'T' do formato ISO 8601");
          assert.ok(job.scheduled_at.endsWith("Z"), "Data em scheduled_at deve conter o sufixo 'Z' (UTC)");
          const parsed = new Date(job.scheduled_at);
          assert.ok(!Number.isNaN(parsed.getTime()), "Data deve ser um timestamp valido");
        }
      });

      await t.test("7 & 8: QueueWorker NAO processa jobs antes do scheduled_at e processa apos vencimento", async () => {
        // Limpa jobs anteriores para teste temporal isolado
        repos.messageQueue.clearQueue(project.id);

        // Criamos um job agendado para 10 minutos no futuro
        const futureTime = new Date(Date.now() + 600 * 1000);
        const futureJob = repos.messageQueue.enqueue({
          project_id: project.id,
          customer_id: customer.id,
          phone: customer.phone,
          message_type: "TEXT",
          content: "Mensagem futura",
          scheduled_at: futureTime.toISOString(),
          is_test: 1,
        });

        const mockSock = {
          sendMessage: async () => ({ key: { id: "MSG_MOCK_1" } }),
          onWhatsApp: async (jid: string) => [{ exists: true, jid }],
          sendPresenceUpdate: async () => {},
        };

        const worker = new QueueWorker({
          repos,
          sock: mockSock as any,
          minJitterMs: 0,
          maxJitterMs: 0,
          dispatchOptions: { skipPresenceSimulation: true },
        });

        // 1. Tenta processar com o horario de AGORA -> Nao deve processar nada
        const resultNow = await worker.processNextJob(new Date());
        assert.equal(resultNow, null, "Worker nao pode processar job futuro");

        const checkJobStillPending = repos.messageQueue.findById(futureJob.id);
        assert.equal(checkJobStillPending?.status, "PENDING", "Job futuro deve continuar PENDING");

        // 2. Agora processa simulando que o relogio avancou 11 minutos
        const clockAfter11Min = new Date(futureTime.getTime() + 60 * 1000);
        const resultDue = await worker.processNextJob(clockAfter11Min);
        assert.ok(resultDue, "Worker deve processar o job vencido");
        assert.equal(resultDue.job.id, futureJob.id);

        const checkJobSent = repos.messageQueue.findById(futureJob.id);
        assert.equal(checkJobSent?.status, "SENT", "Job processado deve transicionar para SENT");
      });

      await t.test("9: Isolamento entre projetos", async () => {
        const projectB = repos.projects.create({
          name: "Outro Projeto",
          slug: "outro-projeto",
        });
        const customerB = repos.customers.upsert({
          name: "Cliente B",
          phone: "5511988887777",
          project_id: projectB.id,
        });

        repos.messageQueue.enqueue({
          project_id: project.id,
          customer_id: customer.id,
          phone: customer.phone,
          message_type: "TEXT",
          content: "Job Projeto A",
          scheduled_at: new Date(Date.now() - 1000).toISOString(),
          is_test: 1,
        });
        repos.messageQueue.enqueue({
          project_id: projectB.id,
          customer_id: customerB.id,
          phone: customerB.phone,
          message_type: "TEXT",
          content: "Job Projeto B",
          scheduled_at: new Date(Date.now() - 1000).toISOString(),
          is_test: 1,
        });

        const dueProjectA = repos.messageQueue.findDueJobs(new Date(), 10, project.id);
        const dueProjectB = repos.messageQueue.findDueJobs(new Date(), 10, projectB.id);

        assert.equal(dueProjectA.every((j) => j.project_id === project.id), true);
        assert.equal(dueProjectB.every((j) => j.project_id === projectB.id), true);
        assert.ok(dueProjectA.length >= 1);
        assert.ok(dueProjectB.length >= 1);
      });

      await t.test("11 & 12: Endpoint de Previa GET /test-dispatch/preview retorna delays e previsao correta", async () => {
        // Previa no modo rapido
        const prevFast = await fetch(`${origin}/api/projects/${project.id}/test-dispatch/preview?event_type=purchase_approved&mode=fast`);
        assert.equal(prevFast.status, 200);
        const fastData = await prevFast.json() as any;
        assert.equal(fastData.mode, "fast");
        assert.equal(fastData.automations.length, 2);
        assert.equal(fastData.automations[0].test_delay_seconds, 2);
        assert.equal(fastData.automations[1].test_delay_seconds, 5);
        assert.ok(fastData.automations[0].scheduled_at);

        // Previa no modo real
        const prevReal = await fetch(`${origin}/api/projects/${project.id}/test-dispatch/preview?event_type=purchase_approved&mode=real`);
        assert.equal(prevReal.status, 200);
        const realData = await prevReal.json() as any;
        assert.equal(realData.mode, "real");
        assert.equal(realData.automations.length, 2);
        assert.equal(realData.automations[0].test_delay_seconds, 60);
        assert.equal(realData.automations[1].test_delay_seconds, 1800);
        assert.equal(realData.automations[0].original_delay_formatted, "1 minuto");
        assert.equal(realData.automations[1].original_delay_formatted, "30 minutos");
      });

      await t.test("13: Reavaliacao de elegibilidade no despacho cancela job se compra posterior ocorrer", async () => {
        // Job de abandono criado
        const abandonJob = repos.messageQueue.enqueue({
          project_id: project.id,
          customer_id: customer.id,
          phone: customer.phone,
          message_type: "TEXT",
          content: "Voce esqueceu seu carrinho!",
          scheduled_at: new Date(Date.now() - 10000).toISOString(),
          is_test: 1,
        });

        // Vincula a uma execucao de abandono
        const abandonOrder = repos.orders.create({
          transaction_id: "TX_ABANDON_001",
          customer_id: customer.id,
          product_id: "prod-natal-main",
          offer_id: "OFF_MAIN",
          event_type: "checkout_abandonment",
          status: "ABANDONED",
          project_id: project.id,
          is_test: 1,
          raw_payload: { amount: 97, currency: "BRL" },
        });

        repos.db.prepare(
          "INSERT INTO automation_executions (job_id, trigger_id, order_id) VALUES (?, ?, ?)"
        ).run(abandonJob.id, triggerEntrega.id, abandonOrder.id);

        // Simula compra concluida antes do envio do abandono
        repos.orders.create({
          transaction_id: "TX_PAID_AFTER_ABANDON",
          customer_id: customer.id,
          product_id: "prod-natal-main",
          offer_id: "OFF_MAIN",
          event_type: "purchase_approved",
          status: "PAID",
          project_id: project.id,
          is_test: 1,
          raw_payload: { amount: 97, currency: "BRL" },
        });

        const worker = new QueueWorker({
          repos,
          sock: { sendMessage: async () => ({ key: { id: "MSG_MOCK_2" } }) } as any,
          dispatchOptions: { skipPresenceSimulation: true },
        });

        const res = await worker.processNextJob(new Date());
        assert.equal(res, null, "Worker deve recusar despacho de abandono apos compra concluida");

        const updatedAbandonJob = repos.messageQueue.findById(abandonJob.id);
        assert.equal(updatedAbandonJob?.status, "CANCELLED", "Job deve ser marcado como CANCELLED");
        assert.equal(updatedAbandonJob?.last_error, "O cliente concluiu a compra após o abandono.");
      });
    } finally {
      server.close();
    }
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
