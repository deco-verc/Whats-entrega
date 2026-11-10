import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import * as http from "node:http";
import { createDatabaseConnection } from "../src/database/connection.js";
import { createWebhookApp } from "../src/webhooks/server.js";
import {
  ProjectRepository,
  TemplateRepository,
  MessageQueueRepository,
  CustomerRepository,
  OrderRepository,
} from "../src/database/repositories.js";

describe("Gestao de Projetos, Templates e Mensagens por Projeto", () => {
  test("deve listar projeto padrao 'default' apos inicializacao", () => {
    const db = createDatabaseConnection(":memory:");
    const projectRepo = new ProjectRepository(db);

    const projects = projectRepo.listAll();
    assert.ok(projects.length >= 1);
    const def = projects.find((p) => p.id === "default" || p.slug === "default");
    assert.ok(def, "Projeto default deve existir");
    assert.equal(def.slug, "default");
  });

  test("deve criar novo projeto com slug unico e produto Cakto associado", () => {
    const db = createDatabaseConnection(":memory:");
    const projectRepo = new ProjectRepository(db);

    const project = projectRepo.create({
      name: "Combo Natal Descomplicado",
      slug: "combo-natal",
      description: "Campanha especial de Natal",
      cakto_product_id: "prod_natal_2026",
      cakto_webhook_secret: "sec_natal_12345",
    });

    assert.ok(project.id);
    assert.equal(project.name, "Combo Natal Descomplicado");
    assert.equal(project.slug, "combo-natal");
    assert.equal(project.cakto_product_id, "prod_natal_2026");

    const foundBySlug = projectRepo.findBySlug("combo-natal");
    assert.ok(foundBySlug);
    assert.equal(foundBySlug.id, project.id);

    const foundByProd = projectRepo.findByCaktoProductId("prod_natal_2026");
    assert.ok(foundByProd);
    assert.equal(foundByProd.id, project.id);
  });

  test("deve isolar templates por projeto e permitir templates homonimos em projetos distintos", () => {
    const db = createDatabaseConnection(":memory:");
    const projectRepo = new ProjectRepository(db);
    const templateRepo = new TemplateRepository(db);

    const projA = projectRepo.create({ name: "Projeto A", slug: "proj-a" });
    const projB = projectRepo.create({ name: "Projeto B", slug: "proj-b" });

    const tplA = templateRepo.create({
      name: "PIX_RECOVERY",
      project_id: projA.id,
      content: "Mensagem Pix Projeto A para {nome}",
      tags: ["nome"],
    });

    const tplB = templateRepo.create({
      name: "PIX_RECOVERY",
      project_id: projB.id,
      content: "Mensagem Pix Projeto B para {nome}",
      tags: ["nome"],
    });

    assert.equal(tplA.project_id, projA.id);
    assert.equal(tplB.project_id, projB.id);

    const listA = templateRepo.findAll(projA.id);
    assert.ok(listA.some((t) => t.id === tplA.id));
    assert.ok(!listA.some((t) => t.id === tplB.id));

    const foundForA = templateRepo.findByName("PIX_RECOVERY", projA.id);
    assert.ok(foundForA);
    assert.equal(foundForA.content, "Mensagem Pix Projeto A para {nome}");

    const foundForB = templateRepo.findByName("PIX_RECOVERY", projB.id);
    assert.ok(foundForB);
    assert.equal(foundForB.content, "Mensagem Pix Projeto B para {nome}");
  });

  test("deve isolar fila de mensagens por projeto e permitir limpeza seletiva", () => {
    const db = createDatabaseConnection(":memory:");
    const projectRepo = new ProjectRepository(db);
    const queueRepo = new MessageQueueRepository(db);
    const custRepo = new CustomerRepository(db);

    const projA = projectRepo.create({ name: "Projeto Alfa", slug: "proj-alfa" });
    const projB = projectRepo.create({ name: "Projeto Beta", slug: "proj-beta" });

    const custA = custRepo.upsert({ phone: "5511999990001", name: "Cliente A", project_id: projA.id });
    const custB = custRepo.upsert({ phone: "5511999990002", name: "Cliente B", project_id: projB.id });

    queueRepo.enqueue({
      customer_id: custA.id,
      phone: custA.phone,
      message_type: "PIX_RECOVERY",
      content: "Mensagem A",
      scheduled_at: new Date(),
      project_id: projA.id,
    });

    queueRepo.enqueue({
      customer_id: custB.id,
      phone: custB.phone,
      message_type: "PIX_RECOVERY",
      content: "Mensagem B",
      scheduled_at: new Date(),
      project_id: projB.id,
    });

    const dueA = queueRepo.findDueJobs(new Date(), 10, projA.id);
    assert.equal(dueA.length, 1);
    assert.equal(dueA[0].project_id, projA.id);

    const dueB = queueRepo.findDueJobs(new Date(), 10, projB.id);
    assert.equal(dueB.length, 1);
    assert.equal(dueB[0].project_id, projB.id);

    // Limpa apenas a fila do Projeto A
    const deletedA = queueRepo.clearQueue(projA.id);
    assert.equal(deletedA, 1);

    // Projeto A vazio, Projeto B intacto
    assert.equal(queueRepo.findDueJobs(new Date(), 10, projA.id).length, 0);
    assert.equal(queueRepo.findDueJobs(new Date(), 10, projB.id).length, 1);

    // Limpeza geral remove o restante
    const deletedAll = queueRepo.clearQueue();
    assert.equal(deletedAll, 1);
    assert.equal(queueRepo.findDueJobs(new Date(), 10).length, 0);
  });

  test("API REST: CRUD de projetos e endpoints de limpeza de fila", async () => {
    const app = createWebhookApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const testSlug = `black-friday-${Date.now()}`;

    try {
      // 1. Criar projeto via POST /api/projects
      const createRes = await fetch(`${baseUrl}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Campanha Black Friday",
          slug: testSlug,
          description: "Descontos de Novembro",
          cakto_product_id: "prod_bf_2026",
          cakto_webhook_secret: "secret_bf_999",
        }),
      });

      assert.equal(createRes.status, 201);
      const createdData = (await createRes.json()) as any;
      assert.equal(createdData.success, true);
      assert.equal(createdData.project.slug, testSlug);
      const projId = createdData.project.id;

      // 2. Listar projetos via GET /api/projects
      const listRes = await fetch(`${baseUrl}/api/projects`);
      assert.equal(listRes.status, 200);
      const listData = (await listRes.json()) as any;
      assert.ok(listData.projects.length >= 2);
      const found = listData.projects.find((p: any) => p.id === projId);
      assert.ok(found);
      assert.ok(found.stats);

      // 3. Limpar fila do projeto via POST /api/projects/:id/clear-queue
      const clearProjRes = await fetch(`${baseUrl}/api/projects/${projId}/clear-queue`, {
        method: "POST",
      });
      assert.equal(clearProjRes.status, 200);
      const clearProjData = (await clearProjRes.json()) as any;
      assert.equal(clearProjData.success, true);

      // 4. Limpar fila geral via POST /api/queue/clear
      const clearAllRes = await fetch(`${baseUrl}/api/queue/clear`, {
        method: "POST",
      });
      assert.equal(clearAllRes.status, 200);
      const clearAllData = (await clearAllRes.json()) as any;
      assert.equal(clearAllData.success, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("Webhook Validation Probe: GET e HEAD devem responder 200 OK para verificacao de URL da Cakto", async () => {
    const app = createWebhookApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const getRes = await fetch(`${baseUrl}/api/webhook/cakto`);
      assert.equal(getRes.status, 200);
      const getData = (await getRes.json()) as any;
      assert.equal(getData.status, "ok");

      const getSlugRes = await fetch(`${baseUrl}/api/webhook/cakto/meu-projeto`);
      assert.equal(getSlugRes.status, 200);
      const getSlugData = (await getSlugRes.json()) as any;
      assert.equal(getSlugData.status, "ok");
      assert.equal(getSlugData.slug, "meu-projeto");

      const headRes = await fetch(`${baseUrl}/api/webhook/cakto`, { method: "HEAD" });
      assert.equal(headRes.status, 200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
