import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import type { WASocket } from "@whiskeysockets/baileys";
import { createDatabaseConnection, EMBEDDED_SCHEMA_SQL } from "../src/database/connection.js";
import { createRepositories } from "../src/database/repositories.js";
import { QueueWorker } from "../src/engine/worker.js";
import { createWebhookApp } from "../src/webhooks/server.js";

test("migra SQLite legado com backup e permite o mesmo telefone e transação em dois projetos", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "entrega-migration-"));
  const filename = path.join(directory, "funnel.db");
  try {
    const legacy = new Database(filename);
    legacy.exec(EMBEDDED_SCHEMA_SQL
      .replace("phone TEXT NOT NULL,", "phone TEXT NOT NULL UNIQUE,")
      .replace(",\n  UNIQUE (project_id, phone)", "")
      .replace("UNIQUE (project_id, transaction_id, event_type)", "UNIQUE (transaction_id, event_type)"));
    legacy.exec(`
      INSERT INTO projects (id, name, slug) VALUES ('default', 'Padrão', 'default');
      INSERT INTO customers (id, phone, name) VALUES ('legacy-customer', '5511999990000', 'Cliente');
      INSERT INTO orders (id, customer_id, transaction_id, product_id, offer_id, event_type, status, raw_payload)
        VALUES ('legacy-order', 'legacy-customer', 'order-shared', 'product', 'offer', 'purchase_approved', 'PAID', '{}');
      INSERT INTO message_queue (id, customer_id, phone, message_type, content, scheduled_at)
        VALUES ('legacy-job', 'legacy-customer', '5511999990000', 'TEXT', 'Entrega', '2030-01-01T00:00:00.000Z');
    `);
    legacy.close();

    const db = createDatabaseConnection(filename);
    try {
      const repos = createRepositories(db);
      assert.equal(db.pragma("user_version", { simple: true }), 1);
      assert.deepEqual(db.pragma("foreign_key_check"), []);
      const backup = fs.readdirSync(directory).find((name) => name.endsWith(".bak"));
      assert.ok(backup);
      const saved = new Database(path.join(directory, backup), { readonly: true });
      assert.equal(saved.pragma("user_version", { simple: true }), 0);
      assert.ok(saved.prepare("SELECT id FROM message_queue WHERE id = ?").get("legacy-job"));
      saved.close();
      const project = repos.projects.create({ name: "Separado", slug: "separado" });
      const customer = repos.customers.upsert({ phone: "5511999990000", name: "Outro cliente", project_id: project.id });
      assert.notEqual(customer.id, "legacy-customer");
      const order = repos.orders.createOrIgnore({
        transaction_id: "order-shared", customer_id: customer.id, product_id: "product", offer_id: "offer",
        event_type: "purchase_approved", status: "PAID", raw_payload: {}, project_id: project.id,
      });
      assert.equal(order.inserted, true);
      assert.equal(repos.orders.findByTransactionAndEvent("order-shared", "purchase_approved")?.id, "legacy-order");
      assert.equal(repos.messageQueue.findById("legacy-job")?.scheduled_at, "2030-01-01T00:00:00.000Z");
      for (const id of ["before-dispatch", "during-dispatch"]) {
        repos.messageQueue.enqueue({
          id, customer_id: customer.id, project_id: project.id, phone: customer.phone, message_type: "TEXT",
          content: "Teste de reinício", scheduled_at: "2030-02-01T00:00:00.000Z",
        });
        assert.equal(repos.messageQueue.markAsProcessing(id), true);
      }
      db.prepare("INSERT INTO queue_dispatch_attempts (job_id) VALUES (?)").run("during-dispatch");
    } finally {
      db.close();
    }
    const reopened = createDatabaseConnection(filename);
    try {
      const queue = createRepositories(reopened).messageQueue;
      queue.recoverInterrupted();
      assert.equal(queue.findById("legacy-job")?.status, "PENDING");
      assert.equal(queue.findById("before-dispatch")?.status, "PENDING");
      assert.equal(queue.findById("before-dispatch")?.attempts, 0);
      assert.equal(queue.findById("during-dispatch")?.last_error, "ENVIO_INDETERMINADO");
      assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith(".bak")).length, 1);
    } finally {
      reopened.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("projetos isolam regras, webhook, simulação, fila e autorização administrativa", async () => {
  const db = createDatabaseConnection(":memory:");
  const repos = createRepositories(db);
  const sent: unknown[] = [];
  const sock = {
    onWhatsApp: async (phone: string) => [{ jid: `${phone}@s.whatsapp.net`, exists: true }],
    sendMessage: async (_jid: string, payload: unknown) => { sent.push(payload); return { key: { id: "sent-id" } }; },
  } as unknown as WASocket;
  const server = createServer(createWebhookApp({
    repositories: { customerRepo: repos.customers, orderRepo: repos.orders, auditRepo: repos.auditLogs, templateRepo: repos.templates },
    adminCredentials: { username: "operator", password: "local-test" }, secret: "global-test", sock,
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const admin = "Basic " + Buffer.from("operator:local-test").toString("base64");
  const request = async (route: string, method = "GET", data?: unknown) => {
    const response = await fetch(origin + "/api" + route, {
      method, headers: { Authorization: admin, "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const webhook = async (slug: string, secret: string, data: object, event = "purchase_approved", timestamp = String(Math.floor(Date.now() / 1000))) => {
    const body = JSON.stringify({ event, data }, null, 2);
    const signature = createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
    return fetch(origin + "/api/webhook/cakto/" + slug, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Cakto-Timestamp": timestamp, "X-Cakto-Signature": "v1=" + signature }, body,
    });
  };

  try {
    assert.equal((await fetch(origin + "/api/projects")).status, 401);
    assert.equal((await fetch(origin + "/api/health")).status, 200);
    const create = (slug: string, product: string, secret: string) => request("/projects", "POST", {
      name: slug, slug, product_name: "Produto " + slug, cakto_product_id: product, cakto_webhook_secret: secret,
    });
    const created = await create("natal", "product-natal", "secret-natal");
    assert.equal(created.status, 201);
    const first = created.body.project;
    const second = (await create("outro", "product-outro", "secret-outro")).body.project;
    assert.equal(first.secret_configured, true);
    assert.equal(first.cakto_webhook_secret, undefined);
    assert.equal(first.is_active, 0);
    const root = "/projects/" + first.id;
    const other = "/projects/" + second.id;
    assert.equal((await request(root, "PUT", { timezone: "America/Fortaleza", links: { link_acesso: "https://example.com/acesso" } })).body.project.timezone, "America/Fortaleza");
    const fields = { name: "Entrega", content: "Olá {primeiro_nome}! {link_acesso}", category: "Entrega Principal", message_type: "TEXT", missing_policy: "block" };
    const templateResponse = await request(root + "/templates", "POST", fields);
    assert.equal(templateResponse.status, 201);
    const template = templateResponse.body.template;
    assert.equal((await request(other + "/templates/" + template.id, "PUT", fields)).status, 404);
    assert.equal((await request("/templates/" + template.id)).status, 404);
    const preview = await request(root + "/templates/" + template.id + "/test", "POST", { name: "Maria Silva" });
    assert.equal(preview.body.content, "Olá Maria! https://example.com/acesso");
    assert.equal((await request(root + "/templates/" + template.id + "/test", "POST", { name: "Maria", send: true })).status, 400);
    assert.equal((await request(root + "/templates", "POST", { ...fields, message_type: "DOCUMENT", media_path: "../private.pdf" })).status, 400);
    const upload = await fetch(origin + "/api" + root + "/media", {
      method: "POST", headers: { Authorization: admin, "Content-Type": "application/octet-stream" }, body: "%PDF-1.7\n%%EOF",
    });
    assert.equal(upload.status, 201);
    const { filename } = await upload.json() as { filename: string };
    assert.equal((await request(other + "/templates", "POST", { ...fields, message_type: "DOCUMENT", media_path: filename })).status, 400);

    const ruleFields = { name: "Entrega em um minuto", event_type: "purchase_approved", is_active: 0, delay_seconds: 60, template_id: template.id,
      conditions: { offer_type: "main" } };
    const mainRule = await request(root + "/triggers", "POST", ruleFields);
    assert.equal(mainRule.status, 201);
    assert.equal((await request(other + "/triggers", "POST", ruleFields)).status, 400);
    const pitch = await request(root + "/triggers", "POST", {
      ...ruleFields, name: "Oferta em 30 minutos", delay_seconds: 1800,
      conditions: { offer_type: "main", skip_if_offer_purchased: "offer-up" },
    });
    assert.equal(pitch.status, 201);

    const simulation = await request("/simulator/cakto", "POST", { project_id: first.id, name: "Maria Silva", phone: "5511999990000" });
    assert.equal(simulation.status, 200);
    assert.equal(simulation.body.approved, true);
    assert.equal(simulation.body.sent, false);
    assert.equal(simulation.body.jobs.length, 2);
    assert.equal(repos.orders.count(first.id), 0);
    assert.equal(repos.customers.count(first.id), 0);
    assert.equal(repos.messageQueue.listAll({ projectId: first.id }).length, 0);
    assert.equal(sent.length, 0);

    assert.equal((await request(root + "/triggers/" + mainRule.body.trigger.id, "PUT", { ...ruleFields, is_active: 1 })).status, 200);
    assert.equal((await request(root + "/triggers/" + pitch.body.trigger.id, "PUT", {
      ...ruleFields, name: "Oferta em 30 minutos", delay_seconds: 1800, is_active: 1, conditions: { offer_type: "main", skip_if_offer_purchased: "offer-up" },
    })).status, 200);
    assert.equal((await request(root, "PUT", { is_active: 1 })).status, 200);

    const order = { id: "same-order-id", status: "paid", offer_type: "main", customer: { name: "Maria Silva", phone: "5511999990000" },
      product: { id: "product-natal" }, offer: { id: "offer-main" }, amount: 197, currency: "BRL" };
    assert.equal((await webhook("natal", "global-test", order)).status, 401);
    assert.equal((await webhook("missing", "secret-natal", order)).status, 404);
    assert.equal((await webhook("outro", "secret-outro", order)).status, 422);
    assert.equal((await webhook("natal", "secret-natal", { ...order, status: "refused" })).status, 400);
    assert.equal((await webhook("natal", "secret-natal", order, "purchase_approved", "1700000000")).status, 401);
    assert.equal((await webhook("natal", "secret-natal", order)).status, 200);
    assert.equal((await (await webhook("natal", "secret-natal", order)).json() as any).duplicate, true);
    assert.equal((await webhook("outro", "secret-outro", { ...order, product: { id: "product-outro" } })).status, 200);
    assert.equal(repos.customers.count(first.id), 1);
    assert.equal(repos.customers.count(second.id), 1);
    assert.equal((await request(other + "/orders")).body.orders.length, 1);
    assert.equal((await request(other + "/queue")).body.jobs.length, 0);
    const otherOrder = { ...order, product: { id: "product-outro" } };
    const wrongBatch = await webhook("outro", "secret-outro", [{ ...otherOrder, id: "valid-in-batch" }, { ...order, id: "foreign-in-batch" }]);
    assert.equal(wrongBatch.status, 422);
    assert.equal(repos.orders.count(second.id), 1);
    const batch = await webhook("outro", "secret-outro", [
      { ...otherOrder, id: "first-in-batch" }, { ...otherOrder, id: "second-in-batch" },
    ]);
    assert.equal(batch.status, 200);
    assert.equal((await batch.json() as any).events.length, 2);
    const probe = await webhook("outro", "secret-outro", { ...otherOrder, id: "probe-order", card: {}, pix: {}, boleto: {}, picpay: {} });
    assert.equal((await probe.json() as any).probe, true);
    assert.equal(repos.orders.count(second.id), 3);

    const queue = (await request(root + "/queue")).body.jobs;
    assert.equal(queue.length, 2);
    assert.equal((await request(other + "/queue/" + queue[0].id + "/cancel", "POST", {})).status, 404);
    const pendingDelivery = queue.find((item: any) => item.automation === "Entrega em um minuto");
    const pendingPitch = queue.find((item: any) => item.automation === "Oferta em 30 minutos");
    assert.ok(new Date(pendingPitch.scheduled_at).getTime() - new Date(pendingDelivery.scheduled_at).getTime() >= 1739000);

    const worker = new QueueWorker({ repos, sock, dispatchOptions: { skipPresenceSimulation: true } });
    assert.equal(await worker.processNextJob(new Date(Date.now())), null);
    await worker.processNextJob(new Date(Date.now() + 61000));
    assert.equal(repos.messageQueue.findById(pendingDelivery.id)?.status, "SENT");
    assert.equal((await webhook("natal", "secret-natal", { ...order, id: "upsell-order", offer_type: "upsell", offer: { id: "offer-up" } })).status, 200);
    await worker.processNextJob(new Date(Date.now() + 1810000));
    assert.equal(repos.messageQueue.findById(pendingPitch.id)?.status, "CANCELLED");
    assert.equal(sent.length, 1);
    const authorized = await request(root + "/templates/" + template.id + "/test", "POST", {
      name: "Maria", phone: "5511999990001", send: true, authorized: true,
    });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.body.messageId, "sent-id");
    assert.equal(sent.length, 2);

    const history = (await request(root + "/webhooks")).body;
    assert.ok(history.first_validated);
    assert.ok(history.events.some((item: any) => item.result === "AUTH_FAILED"));
    assert.ok(!JSON.stringify(history).includes("secret-natal"));
    assert.ok(!JSON.stringify(history).includes("5511999990000"));
    const duplicated = (await request(root + "/duplicate", "POST", {})).body.project;
    assert.equal(duplicated.is_active, 0);
    assert.equal(duplicated.secret_configured, false);
    assert.equal(duplicated.cakto_product_id, null);
    assert.equal(duplicated.stats.orders_count, 0);
    const copied = (await request("/projects/" + duplicated.id + "/templates")).body.templates;
    assert.equal(copied.length, 1);
    assert.notEqual(copied[0].id, template.id);
    assert.equal((await request(root, "DELETE", {})).body.archived, true);
    assert.equal((await request(root + "/orders")).status, 404);
    assert.equal(repos.orders.count(first.id), 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});
