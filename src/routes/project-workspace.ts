import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { raw, Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { createRepositories, type Project } from "../database/repositories.js";
import { AUTOMATION_EVENTS, isLegacyAutomationKey, projectMediaPath, projectTemplateVariables, renderProjectTemplate, scheduleProjectAutomations } from "../engine/project-automations.js";
import { sanitizePhone, normalizeCaktoWebhook, processNormalizedWebhook } from "../webhooks/adapters.js";
import { handleManualSend, type ManualSendOptions } from "./manual-send.js";
import { env, buildProjectWebhookUrl } from "../config/env.js";

type Workspace = {
  product_name: string | null; timezone: string; links_json: string; additional_products_json: string;
  integration_after_id: number;
  onboarding_step: number; simulated_at: string | null; archived_at: string | null;
};

export function workspaceFor(db: Database.Database, id: string): Workspace | undefined {
  return db.prepare("SELECT * FROM project_workspace WHERE project_id = ?").get(id) as Workspace | undefined;
}

export function publicProject(db: Database.Database, project: Project) {
  const { cakto_webhook_secret, ...publicFields } = project;
  const workspace = workspaceFor(db, project.id);
  const lastWebhook = db.prepare("SELECT created_at, event_type, result FROM webhook_events WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(project.id);
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM customers WHERE project_id = @id) AS customers_count,
      (SELECT COUNT(*) FROM orders WHERE project_id = @id AND is_test = 0) AS orders_count,
      (SELECT COUNT(*) FROM message_templates WHERE project_id = @id) AS templates_count,
      (SELECT COUNT(*) FROM funnel_triggers WHERE project_id = @id AND is_active = 1) AS active_automations,
      (SELECT COUNT(*) FROM message_queue WHERE project_id = @id AND status = 'SENT') AS sent_queue,
      (SELECT COUNT(*) FROM message_queue WHERE project_id = @id AND status = 'PENDING') AS pending_queue,
      (SELECT COUNT(*) FROM message_queue WHERE project_id = @id AND status = 'FAILED') AS failed_queue,
      (SELECT COUNT(*) FROM webhook_events WHERE project_id = @id AND result = 'PROCESSED') AS valid_webhooks
  `).get({ id: project.id }) as Record<string, number>;
  return {
    ...publicFields, secret_configured: Boolean(cakto_webhook_secret), last_webhook: lastWebhook ?? null, stats,
    webhook_url: buildProjectWebhookUrl(project.slug, env.publicBaseUrl),
    public_base_url: env.publicBaseUrl,
    integration_verified: Boolean(db.prepare("SELECT 1 FROM webhook_events WHERE project_id = ? AND id > ? AND result = 'PROCESSED' LIMIT 1")
      .get(project.id, workspace?.integration_after_id ?? 0)),
    product_name: workspace?.product_name ?? project.name,
    timezone: workspace?.timezone ?? "America/Sao_Paulo",
    links: JSON.parse(workspace?.links_json ?? "{}"),
    additional_products: JSON.parse(workspace?.additional_products_json ?? "[]"),
    onboarding_step: workspace?.onboarding_step ?? 1,
    onboarding_checks: [
      true, Boolean(project.cakto_product_id && cakto_webhook_secret),
      stats.templates_count > 0,
      Boolean(db.prepare(`SELECT 1 FROM funnel_triggers f JOIN message_templates t ON t.id = f.template_id AND t.project_id = f.project_id WHERE f.project_id = ?`).get(project.id)),
      Boolean(workspace?.simulated_at), Boolean(project.is_active),
    ],
  };
}

export function parseProjectMetadata(body: Record<string, unknown>) {
  const { product_name, timezone, links, additional_products, onboarding_step } = body;
  if (product_name !== undefined && (typeof product_name !== "string" || !product_name.trim() || product_name.length > 150)) throw new Error("Informe o nome do produto.");
  if (timezone !== undefined) {
    if (typeof timezone !== "string") throw new Error("Fuso horário inválido.");
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone });
  }
  if (onboarding_step !== undefined && (!Number.isInteger(onboarding_step) || Number(onboarding_step) < 1 || Number(onboarding_step) > 6)) throw new Error("Etapa inválida.");
  if (additional_products !== undefined && (!Array.isArray(additional_products) ||
      additional_products.length > 50 || additional_products.some((id) => typeof id !== "string" || !id.trim() || id.length > 150))) {
    throw new Error("IDs de produtos adicionais inválidos.");
  }
  if (links !== undefined) {
    if (!links || typeof links !== "object" || Array.isArray(links)) throw new Error("Links inválidos.");
    const allowed = ["link", "link_acesso", "link_upsell", "link_upsell_1", "link_upsell_2", "link_downsell", "link_checkout"];
    for (const [key, value] of Object.entries(links)) {
      if (!allowed.includes(key) || typeof value !== "string" || value.length > 2000 ||
          (value && !["https:", "http:"].includes(new URL(value).protocol))) throw new Error("Use URLs HTTP ou HTTPS válidas nos links.");
    }
  }
  return {
    product_name: typeof product_name === "string" ? product_name.trim() : null,
    timezone: typeof timezone === "string" ? timezone : null,
    links: links === undefined ? null : JSON.stringify(links),
    additional_products: additional_products === undefined ? null : JSON.stringify([...new Set((additional_products as string[]).map((id) => id.trim()))]),
    step: typeof onboarding_step === "number" ? onboarding_step : null,
  };
}

export function saveProjectMetadata(db: Database.Database, id: string, metadata: ReturnType<typeof parseProjectMetadata>) {
  db.prepare(`
    INSERT INTO project_workspace (project_id, product_name, timezone, links_json, additional_products_json, onboarding_step)
    VALUES (@id, @product_name, COALESCE(@timezone, 'America/Sao_Paulo'), COALESCE(@links, '{}'),
      COALESCE(@additional_products, '[]'), COALESCE(@step, 1))
    ON CONFLICT(project_id) DO UPDATE SET
      product_name = COALESCE(@product_name, product_name), timezone = COALESCE(@timezone, timezone),
      links_json = COALESCE(@links, links_json), additional_products_json = COALESCE(@additional_products, additional_products_json),
      onboarding_step = COALESCE(@step, onboarding_step)
  `).run({ id, ...metadata });
}

export function createProjectWorkspaceRouter(db: () => Database.Database, options: ManualSendOptions & { diagnostics?: () => unknown }) {
  const router = Router();
  router.param("projectId", (_req, res, next, id: string) => {
    const repos = createRepositories(db());
    const project = repos.projects.findById(id);
    if (!project || workspaceFor(repos.db, id)?.archived_at) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }
    res.locals.project = project;
    res.locals.repos = repos;
    next();
  });
  type Handler = (req: Request, res: Response, repos: ReturnType<typeof createRepositories>, project: Project) => void | Promise<void>;
  const route = (handler: Handler) => (req: Request, res: Response) => handler(req, res, res.locals.repos, res.locals.project);

  router.get("/:projectId/dashboard", route((req, res, repos, project) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const sent = repos.db.prepare(`
      SELECT date(updated_at) AS day, COUNT(*) AS total FROM message_queue
      WHERE project_id = ? AND status = 'SENT' AND date(updated_at) >= date('now', ?)
      GROUP BY date(updated_at) ORDER BY day
    `).all(project.id, `-${days - 1} days`);
    const activity = repos.db.prepare(`
      SELECT * FROM (
        SELECT event_type AS label, result AS status, created_at AS at FROM webhook_events WHERE project_id = @id
        UNION ALL SELECT message_type, status, updated_at FROM message_queue WHERE project_id = @id
        UNION ALL SELECT 'Cliente cadastrado', current_state, created_at FROM customers WHERE project_id = @id
        UNION ALL SELECT 'Envio de teste', CASE WHEN json_extract(diff_json, '$.success') THEN 'SENT' ELSE 'FAILED' END, created_at
          FROM audit_logs WHERE action = 'manual_send' AND json_valid(diff_json) AND json_extract(diff_json, '$.projectId') = @id
        UNION ALL SELECT 'Simulação Cakto', CASE WHEN json_extract(diff_json, '$.approved') THEN 'SIMULATED' ELSE 'NO_MATCH' END, created_at
          FROM audit_logs WHERE action = 'simulate_cakto' AND entity = 'projects' AND entity_id = @id
      ) ORDER BY at DESC LIMIT 20
    `).all({ id: project.id });
    res.json({ project: publicProject(repos.db, project), sent, activity });
  }));

  router.get("/:projectId/orders", route((_req, res, repos, project) => {
    const orders = repos.db.prepare(`
      SELECT o.id, o.transaction_id, o.product_id, o.offer_id, o.event_type, o.status, o.paid_at, o.created_at, o.is_test, c.name
      FROM orders o JOIN customers c ON c.id = o.customer_id AND c.project_id = o.project_id
      WHERE o.project_id = ? ORDER BY o.created_at DESC LIMIT 100
    `).all(project.id);
    res.json({ orders });
  }));

  router.get("/:projectId/webhooks", route((_req, res, repos, project) => {
    const events = repos.db.prepare("SELECT * FROM webhook_events WHERE project_id = ? ORDER BY id DESC LIMIT 100").all(project.id);
    const workspace = workspaceFor(repos.db, project.id);
    const verified = repos.db.prepare("SELECT created_at FROM webhook_events WHERE project_id = ? AND id > ? AND result = 'PROCESSED' ORDER BY id LIMIT 1")
      .get(project.id, workspace?.integration_after_id ?? 0);
    res.json({ events, first_validated: verified ?? null, simulated_at: workspace?.simulated_at ?? null });
  }));

  router.get("/:projectId/webhooks/:eventId", route((req, res, repos, project) => {
    const eventId = Number(req.params.eventId);
    const event = repos.db.prepare("SELECT * FROM webhook_events WHERE id = ? AND project_id = ?").get(eventId, project.id) as any;
    if (!event) {
      res.status(404).json({ error: "Evento de webhook não encontrado." });
      return;
    }
    let payload = null;
    if (event.payload_json) {
      try { payload = JSON.parse(event.payload_json); } catch { payload = null; }
    }
    const matchingTriggers = repos.funnelTriggers.listByProject(project.id).filter((t) => t.is_active && t.event_type === event.event_type);
    res.json({ event, payload, matched_automations: matchingTriggers.map((t) => t.name) });
  }));

  router.post("/:projectId/webhooks/:eventId/test", route(async (req, res, repos, project) => {
    const eventId = Number(req.params.eventId);
    const { mode = "simulate", phone, name, fast_delay, authorized, marketing_consent } = req.body ?? {};

    const webhookEvent = repos.db.prepare(
      "SELECT * FROM webhook_events WHERE id = ? AND project_id = ?"
    ).get(eventId, project.id) as {
      id: number; project_id: string; event_type: string | null; product_id: string | null;
      transaction_id: string | null; authenticated: number; result: string; details: string | null;
      payload_json: string | null; is_test: number; created_at: string;
    } | undefined;

    if (!webhookEvent) {
      res.status(404).json({ error: "Evento de webhook não encontrado neste projeto." });
      return;
    }

    let parsedPayload: Record<string, any> = {};
    if (webhookEvent.payload_json) {
      try { parsedPayload = JSON.parse(webhookEvent.payload_json); } catch { parsedPayload = {}; }
    }

    let normalized: any;
    try {
      normalized = normalizeCaktoWebhook(parsedPayload, { isTest: true });
    } catch {
      const txId = webhookEvent.transaction_id || `TEST_REPLAY_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
      const evtType = webhookEvent.event_type || "purchase_approved";
      const prodId = webhookEvent.product_id || project.cakto_product_id || "PROD_TEST";
      normalized = {
        transactionId: txId.startsWith("TEST_") ? txId : `TEST_${txId}`,
        eventType: evtType,
        status: evtType === "checkout_abandonment" ? "ABANDONED" : evtType === "pix_generated" ? "WAITING_PAYMENT" : "PAID",
        offerType: "main",
        amount: 97,
        currency: "BRL",
        customer: {
          name: typeof name === "string" && name.trim() ? name.trim() : "Usuário de Homologação",
          phone: typeof phone === "string" && phone ? sanitizePhone(phone) : "5511999998888",
          email: null,
        },
        product: { id: prodId, offerId: "OFF_TEST" },
        rawPayload: parsedPayload,
      };
    }

    if (mode === "simulate") {
      const mockCustomer = {
        id: "cust_sim_" + randomUUID(),
        phone: normalized.customer.phone,
        name: normalized.customer.name,
        email: normalized.customer.email ?? null,
        project_id: project.id,
        current_state: "NEW",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const mockOrder = {
        id: "ord_sim_" + randomUUID(),
        project_id: project.id,
        customer_id: mockCustomer.id,
        transaction_id: normalized.transactionId,
        product_id: normalized.product.id,
        offer_id: normalized.product.offerId,
        event_type: normalized.eventType,
        status: normalized.status,
        paid_at: normalized.paidAt ?? null,
        is_test: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const evaluations = scheduleProjectAutomations(repos, project, normalized, mockCustomer as any, mockOrder as any, { simulation: true, dryRun: true });

      res.json({
        success: true,
        mode: "simulate",
        webhook_event_id: webhookEvent.id,
        transaction_id: normalized.transactionId,
        event_type: normalized.eventType,
        evaluations,
      });
      return;
    }

    if (mode === "dispatch") {
      if (!authorized) {
        res.status(400).json({ error: "Confirme que o número informado foi expressamente autorizado para teste." });
        return;
      }

      let cleanPhone: string;
      try {
        cleanPhone = sanitizePhone(phone);
      } catch {
        res.status(400).json({ error: "Informe um telefone de teste válido com DDD (mínimo 10 dígitos)." });
        return;
      }

      const baseTxId = normalized.transactionId.startsWith("TEST_")
        ? normalized.transactionId
        : `TEST_${normalized.transactionId}`;
      const replayTxId = `${baseTxId}_REPLAY_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const testCustName = typeof name === "string" && name.trim() ? name.trim() : normalized.customer.name || "Usuário de Homologação";
      const testNormalized = {
        ...normalized,
        transactionId: replayTxId,
        customer: {
          ...normalized.customer,
          name: testCustName,
          phone: cleanPhone,
        },
      };

      if (marketing_consent === true) {
        repos.db.prepare(`
          INSERT INTO contact_permissions (project_id, phone, marketing, opted_out) VALUES (?, ?, 1, 0)
          ON CONFLICT(project_id, phone) DO UPDATE SET marketing = 1, opted_out = 0
        `).run(project.id, cleanPhone);
      }

      const rawMode = String(req.body.test_mode || req.body.mode || (req.body.fast_delay === true ? "fast" : req.body.fast_delay === false ? "real" : "fast")).toLowerCase();
      const testMode: "fast" | "real" = rawMode === "real" ? "real" : "fast";
      const referenceDate = new Date();

      const { order, evaluations } = repos.transaction(() => {
        const processed = processNormalizedWebhook(testNormalized, repos, project.id, { isTest: true });
        const evals = scheduleProjectAutomations(repos, project, testNormalized, processed.customer, processed.order, {
          testMode,
          eventTime: referenceDate,
        });
        return { order: processed.order, evaluations: evals };
      });

      const createdJobs = repos.db.prepare(`
        SELECT q.id, q.message_type, q.scheduled_at, q.status, t.name AS automation, t.delay_seconds
        FROM message_queue q
        JOIN automation_executions e ON e.job_id = q.id
        JOIN funnel_triggers t ON t.id = e.trigger_id
        WHERE e.order_id = ?
      `).all(order.id);

      res.json({
        success: true,
        mode: "dispatch",
        test_mode: testMode,
        webhook_event_id: webhookEvent.id,
        transaction_id: testNormalized.transactionId,
        evaluations,
        jobs: createdJobs,
      });
      return;
    }

    res.status(400).json({ error: "Modo de teste inválido. Escolha 'simulate' ou 'dispatch'." });
  }));

  router.get("/:projectId/settings", route((_req, res, repos, project) => {
    res.json({ project: publicProject(repos.db, project) });
  }));

  router.get("/:projectId/diagnostics", route((_req, res, repos, project) => {
    const lastFailure = repos.db.prepare(`
      SELECT status, updated_at FROM message_queue WHERE project_id = ? AND status = 'FAILED' ORDER BY updated_at DESC LIMIT 1
    `).get(project.id);
    const lastExecution = repos.db.prepare(`
      SELECT q.status, q.updated_at FROM automation_executions e JOIN message_queue q ON q.id = e.job_id
      WHERE q.project_id = ? ORDER BY q.updated_at DESC LIMIT 1
    `).get(project.id);
    res.json({ database: repos.db.open ? "connected" : "unavailable", worker: options.diagnostics?.() ?? null,
      last_failure: lastFailure ?? null, last_execution: lastExecution ?? null,
      project: publicProject(repos.db, project) });
  }));

  router.get("/:projectId/queue", route((req, res, repos, project) => {
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
    const jobs = repos.db.prepare(`
      SELECT q.id, CASE WHEN c.project_id = q.project_id THEN q.phone END AS phone,
        q.message_type, q.scheduled_at, q.status, q.attempts, q.last_error,
        q.whatsapp_message_id, q.delivered_at, q.is_test, q.created_at, q.updated_at,
        t.name AS automation, t.delay_seconds
      FROM message_queue q LEFT JOIN automation_executions e ON e.job_id = q.id
      LEFT JOIN funnel_triggers t ON t.id = e.trigger_id AND t.project_id = q.project_id
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE q.project_id = ? AND (? IS NULL OR q.status = ?) ORDER BY q.scheduled_at DESC LIMIT 100
    `).all(project.id, status, status);
    res.json({ jobs });
  }));

  router.get("/:projectId/test-dispatch/preview", route((req, res, repos, project) => {
    const eventType = String(req.query.event_type || "purchase_approved");
    const rawMode = String(req.query.mode || (req.query.fast_delay === "true" ? "fast" : "fast")).toLowerCase();
    const mode: "fast" | "real" = rawMode === "real" ? "real" : "fast";
    const now = new Date();
    const referenceTimeMs = now.getTime();

    const rules = repos.funnelTriggers.listByProject(project.id).filter((rule) => (
      rule.event_type === eventType && (project.id !== "default" || !isLegacyAutomationKey(rule.trigger_key))
    ));

    const automations = rules.map((rule, index) => {
      const template = rule.template_id ? repos.templates.findById(rule.template_id) : null;
      const originalDelaySeconds = rule.delay_seconds;
      const testDelaySeconds = mode === "fast" ? (index === 0 ? 2 : 2 + index * 3) : originalDelaySeconds;
      const scheduledAt = new Date(referenceTimeMs + testDelaySeconds * 1000);

      const formatDelay = (seconds: number): string => {
        if (seconds <= 0) return "Imediato";
        if (seconds < 60) return `${seconds} segundo${seconds > 1 ? "s" : ""}`;
        const minutes = Math.floor(seconds / 60);
        const remainingSec = seconds % 60;
        if (minutes < 60) {
          return remainingSec > 0
            ? `${minutes} min e ${remainingSec}s`
            : `${minutes} minuto${minutes > 1 ? "s" : ""}`;
        }
        const hours = Math.floor(minutes / 60);
        const remainingMin = minutes % 60;
        return remainingMin > 0
          ? `${hours}h e ${remainingMin}min`
          : `${hours} hora${hours > 1 ? "s" : ""}`;
      };

      return {
        trigger_id: rule.id,
        name: rule.name,
        template_name: template?.project_id === project.id ? template.name : null,
        original_delay_seconds: originalDelaySeconds,
        original_delay_formatted: formatDelay(originalDelaySeconds),
        test_delay_seconds: testDelaySeconds,
        test_delay_formatted: formatDelay(testDelaySeconds),
        scheduled_at: scheduledAt.toISOString(),
        is_active: Boolean(rule.is_active),
      };
    });

    res.json({
      mode,
      reference_time: now.toISOString(),
      automations,
    });
  }));

  router.post("/:projectId/test-dispatch", route(async (req, res, repos, project) => {
    const { phone, name, email, event_type, offer_type, product_id, offer_id, amount, marketing_consent, fast_delay, mode: bodyMode, authorized } = req.body ?? {};
    if (!authorized) {
      res.status(400).json({ error: "Confirme que o número informado foi expressamente autorizado para teste." });
      return;
    }
    let cleanPhone: string;
    try {
      cleanPhone = sanitizePhone(phone);
    } catch {
      res.status(400).json({ error: "Informe um telefone válido com DDD (mínimo 10 dígitos)." });
      return;
    }

    const event = String(event_type || "purchase_approved");
    const rawOfferType = String(offer_type || "main").toLowerCase();
    const rawMode = String(bodyMode || (fast_delay === true ? "fast" : fast_delay === false ? "real" : "fast")).toLowerCase();
    const testMode: "fast" | "real" = rawMode === "real" ? "real" : "fast";
    const referenceDate = new Date();
    const prodId = String(product_id || project.cakto_product_id || "PROD_TEST");
    const offId = String(offer_id || "OFF_TEST");
    const txId = `TEST_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const custName = String(name || "Usuário de Teste").trim();

    // 1. Inserir em webhook_events com is_test = 1
    const rawPayload = {
      event,
      data: {
        id: txId,
        status: event === "pix_generated" ? "waiting_payment" : event === "checkout_abandonment" ? "abandoned" : "paid",
        offer_type: rawOfferType,
        customer: { name: custName, phone: cleanPhone, email: email || null },
        product: { id: prodId },
        offer: { id: offId },
        amount: typeof amount === "number" ? amount : 100,
        pix: event === "pix_generated" ? { qr_code_text: "PIX_TESTE_DISPARO" } : undefined,
      },
      is_test: true,
    };

    const webhookEvent = repos.db.prepare(`
      INSERT INTO webhook_events (project_id, event_type, product_id, transaction_id, authenticated, result, details, payload_json, is_test, created_at)
      VALUES (?, ?, ?, ?, 1, 'TEST', 'Teste Real de Disparo autorizado', ?, 1, datetime('now'))
      RETURNING *
    `).get(project.id, event, prodId, txId, JSON.stringify(rawPayload)) as { id: number };

    // 2. Permissão de marketing se selecionada
    if (marketing_consent === true) {
      repos.db.prepare(`
        INSERT INTO contact_permissions (project_id, phone, marketing, opted_out) VALUES (?, ?, 1, 0)
        ON CONFLICT(project_id, phone) DO UPDATE SET marketing = 1, opted_out = 0
      `).run(project.id, cleanPhone);
    }

    // 3. Normalizar payload
    const normalized = normalizeCaktoWebhook(rawPayload);

    // 4. Processar webhook com is_test = 1 (não incrementa métricas financeiras de produção)
    // 5. Agendar automações reais do projeto de forma atômica
    const { order, evaluations } = repos.transaction(() => {
      const processed = processNormalizedWebhook(normalized, repos, project.id, { isTest: true });
      const evals = scheduleProjectAutomations(repos, project, normalized, processed.customer, processed.order, {
        testMode,
        eventTime: referenceDate,
      });
      return { order: processed.order, evaluations: evals };
    });

    const createdJobs = repos.db.prepare(`
      SELECT q.id, q.message_type, q.scheduled_at, q.status, t.name AS automation, t.delay_seconds
      FROM message_queue q
      JOIN automation_executions e ON e.job_id = q.id
      JOIN funnel_triggers t ON t.id = e.trigger_id
      WHERE e.order_id = ?
    `).all(order.id);

    res.json({
      success: true,
      mode: testMode,
      transaction_id: txId,
      webhook_event_id: webhookEvent.id,
      evaluations,
      jobs: createdJobs,
    });
  }));

  router.post("/:projectId/queue/cancel-test-jobs", route((_req, res, repos, project) => {
    const cancelled = repos.messageQueue.cancelPendingTestJobs(project.id);
    res.json({ success: true, cancelled_count: cancelled });
  }));

  router.get("/:projectId/queue/:jobId/timeline", route((req, res, repos, project) => {
    const jobId = String(req.params.jobId);
    const job = repos.db.prepare(`
      SELECT q.*, c.name AS customer_name, t.name AS trigger_name, t.trigger_key,
             t.delay_seconds, t.event_type AS trigger_event_type, m.name AS template_name,
             m.content AS template_content, e.order_id
      FROM message_queue q
      LEFT JOIN customers c ON c.id = q.customer_id
      LEFT JOIN automation_executions e ON e.job_id = q.id
      LEFT JOIN funnel_triggers t ON t.id = e.trigger_id
      LEFT JOIN message_templates m ON m.id = t.template_id
      WHERE q.id = ? AND q.project_id = ?
    `).get(jobId, project.id) as any;

    if (!job) {
      res.status(404).json({ error: "Mensagem não encontrada neste projeto." });
      return;
    }

    const order = job.order_id ? repos.orders.findById(job.order_id) : null;
    const baseOrderTxId = order ? order.transaction_id.replace(/_REPLAY_[0-9a-f]+$/i, "") : "";
    const webhookEvent = order ? repos.db.prepare(`
      SELECT id, event_type, result, is_test, created_at
      FROM webhook_events
      WHERE project_id = ? AND (
        transaction_id = ? OR
        transaction_id = ? OR
        json_extract(payload_json, '$.data.id') = ? OR
        json_extract(payload_json, '$.data.transaction_id') = ?
      )
      ORDER BY id DESC LIMIT 1
    `).get(project.id, order.transaction_id, baseOrderTxId, order.transaction_id, order.transaction_id) as any : null;

    res.json({
      job,
      order,
      webhook_event: webhookEvent ?? null,
    });
  }));

  router.post("/:projectId/queue/:jobId/:action", route((req, res, repos, project) => {
    const id = String(req.params.jobId);
    const job = repos.messageQueue.findById(id);
    if (job?.project_id !== project.id) {
      res.status(404).json({ error: "Mensagem não encontrada." });
      return;
    }
    const action = req.params.action;
    const result = action === "cancel" ? repos.db.prepare(`
      UPDATE message_queue SET status = 'CANCELLED', updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND status = 'PENDING'
    `).run(id, project.id) : action === "retry" ? repos.db.prepare(`
      UPDATE message_queue SET status = 'PENDING', attempts = 0, scheduled_at = ?, updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND status = 'FAILED' AND last_error <> 'ENVIO_INDETERMINADO'
    `).run(new Date().toISOString(), id, project.id) : null;
    if (!result?.changes) {
      res.status(409).json({ error: "A mensagem não está elegível para essa ação." });
      return;
    }
    res.json({ success: true });
  }));

  router.get("/:projectId/templates", route((_req, res, repos, project) => {
    const optionsFor = repos.db.prepare("SELECT * FROM template_options WHERE template_id = ?");
    const usage = repos.db.prepare("SELECT id, name FROM funnel_triggers WHERE template_id = ? AND project_id = ?");
    res.json({ templates: repos.templates.findAll(project.id).map((template) => ({
      ...template, options: optionsFor.get(template.id) ?? null, automations: usage.all(template.id, project.id),
    })) });
  }));

  router.post("/:projectId/media", raw({ type: "application/octet-stream", limit: "16mb" }), route((req, res, _repos, project) => {
    const bytes = req.body;
    const pdf = Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString() === "%PDF-";
    const audio = Buffer.isBuffer(bytes) && bytes.subarray(0, 4).toString() === "OggS" &&
      bytes.subarray(0, 128).includes(Buffer.from("OpusHead"));
    if (!pdf && !audio) {
      res.status(400).json({ error: "Envie um PDF ou um áudio OGG codificado em Opus." });
      return;
    }
    if (!/^[\w-]+$/.test(project.id)) {
      res.status(400).json({ error: "Projeto incompatível com o armazenamento de mídia." });
      return;
    }
    const mediaRoot = fs.realpathSync(env.paths.mediaDir);
    const directory = project.id === "default" ? mediaRoot : path.join(mediaRoot, project.id);
    fs.mkdirSync(directory, { recursive: true });
    if (fs.realpathSync(directory) !== directory) {
      res.status(400).json({ error: "Diretório de mídia inválido." });
      return;
    }
    const filename = randomUUID() + (pdf ? ".pdf" : ".ogg");
    fs.writeFileSync(path.join(directory, filename), bytes, { flag: "wx", mode: 0o600 });
    res.status(201).json({ filename, message_type: pdf ? "DOCUMENT" : "AUDIO_PTT" });
  }));

  const saveTemplate: Handler = (req, res, repos, project) => {
    const { name, content, category, message_type, media_path, missing_policy, fallback } = req.body ?? {};
    const id = typeof req.params.templateId === "string" ? req.params.templateId : undefined;
    if (id && repos.templates.findById(id)?.project_id !== project.id) {
      res.status(404).json({ error: "Template não encontrado." });
      return;
    }
    const validType = ["TEXT", "AUDIO_PTT", "DOCUMENT"].includes(message_type);
    if (typeof name !== "string" || !name.trim() || typeof content !== "string" ||
        (message_type === "TEXT" && !content.trim()) || typeof category !== "string" || !category.trim() ||
        !validType || !["block", "omit", "fallback"].includes(missing_policy) ||
        (missing_policy === "fallback" && (typeof fallback !== "string" || !fallback.trim())) ||
        !repos.templates.validateSpintax(content).valid) {
      res.status(400).json({ error: "Confira os campos e a sintaxe do template." });
      return;
    }
    const media = typeof media_path === "string" ? media_path : "";
    if (message_type !== "TEXT" && !projectMediaPath(media, message_type, project.id)) {
      res.status(400).json({ error: "Informe o nome de um arquivo OGG ou PDF existente no armazenamento de mídia." });
      return;
    }
    const template = repos.transaction(() => {
      const fields = { name, content, media_path: message_type === "TEXT" ? null : media };
      const saved = id ? repos.templates.update(id, fields)! : repos.templates.create({ ...fields, project_id: project.id });
      repos.db.prepare(`
        INSERT INTO template_options VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(template_id) DO UPDATE SET category = excluded.category, message_type = excluded.message_type,
          missing_policy = excluded.missing_policy, fallback = excluded.fallback
      `).run(saved.id, category, message_type, missing_policy, missing_policy === "fallback" ? fallback : null);
      repos.db.prepare("UPDATE project_workspace SET simulated_at = NULL WHERE project_id = ?").run(project.id);
      return saved;
    });
    res.status(id ? 200 : 201).json({ template });
  };
  router.post("/:projectId/templates", route(saveTemplate));
  router.put("/:projectId/templates/:templateId", route(saveTemplate));
  router.post("/:projectId/templates/:templateId/test", route(async (req, res, repos, project) => {
    const template = repos.templates.findById(String(req.params.templateId));
    if (template?.project_id !== project.id) {
      res.status(404).json({ error: "Template não encontrado." });
      return;
    }
    const { phone, name, email, amount, authorized, send } = req.body ?? {};
    const variables = {
      ...projectTemplateVariables(repos.db, project, typeof name === "string" ? name : ""),
      email: typeof email === "string" ? email : undefined,
      valor_pedido: typeof amount === "number" && Number.isFinite(amount) ? amount : undefined,
    };
    const rendered = renderProjectTemplate(repos, template, variables);
    if (rendered.error) {
      res.status(422).json({ error: rendered.error });
      return;
    }
    if (send !== true) {
      res.json({ content: rendered.content, message_type: rendered.type, sent: false });
      return;
    }
    if (authorized !== true) {
      res.status(400).json({ error: "Confirme que o destinatário autorizou o envio de teste." });
      return;
    }
    req.body = { phone, message: rendered.content, caption: rendered.content, type: rendered.type.toLowerCase(),
      mediaPath: rendered.mediaPath, project_id: project.id, skipSimulation: true };
    await handleManualSend(req, res, options);
  }));

  router.get("/:projectId/triggers", route((_req, res, repos, project) => {
    const stats = repos.db.prepare(`
      SELECT c.conditions_json,
        (SELECT COUNT(*) FROM automation_executions WHERE trigger_id = f.id) AS executions,
        (SELECT MAX(q.updated_at) FROM automation_executions e JOIN message_queue q ON q.id = e.job_id WHERE e.trigger_id = f.id) AS last_execution
      FROM funnel_triggers f LEFT JOIN automation_conditions c ON c.trigger_id = f.id WHERE f.id = ?
    `);
    res.json({ events: AUTOMATION_EVENTS, triggers: repos.funnelTriggers.listByProject(project.id).map((trigger) => {
      const data = stats.get(trigger.id) as { conditions_json: string | null; executions: number; last_execution: string | null };
      return {
        ...trigger, legacy: project.id === "default" && isLegacyAutomationKey(trigger.trigger_key),
        executions: data.executions, last_execution: data.last_execution, conditions: JSON.parse(data.conditions_json ?? "{}"),
      };
    }) });
  }));

  router.post("/:projectId/canonical-triggers", route((_req, res, repos, project) => {
    if (project.id !== "default") {
      res.status(404).json({ error: "Etapas canônicas indisponíveis neste projeto." });
      return;
    }
    res.json({ seeded: repos.transaction(() => repos.funnelTriggers.seedDefaultTriggers(project.id)) });
  }));

  const saveTrigger: Handler = (req, res, repos, project) => {
    const { name, event_type, delay_seconds, is_active, template_id, conditions = {} } = req.body ?? {};
    const id = typeof req.params.triggerId === "string" ? req.params.triggerId : undefined;
    const previous = id ? repos.funnelTriggers.findById(id) : null;
    if (id && previous?.project_id !== project.id) {
      res.status(404).json({ error: "Automação não encontrada." });
      return;
    }
    const template = typeof template_id === "string" && template_id ? repos.templates.findById(template_id) : null;
    const legacy = Boolean(project.id === "default" && previous && isLegacyAutomationKey(previous.trigger_key));
    const allowed = ["product_id", "offer_id", "offer_type", "status", "state", "prior_purchase", "skip_if_offer_purchased", "marketing"];
    if (typeof name !== "string" || !name.trim() ||
        (legacy ? event_type !== previous?.event_type : !(AUTOMATION_EVENTS as readonly string[]).includes(event_type)) ||
        !Number.isSafeInteger(delay_seconds) || delay_seconds < 0 || delay_seconds > 31536000 ||
        ![0, 1].includes(is_active) || (template_id && template?.project_id !== project.id) ||
        !conditions || typeof conditions !== "object" || Array.isArray(conditions) ||
        Object.entries(conditions).some(([key, value]) => !allowed.includes(key) ||
          (key === "marketing" ? typeof value !== "boolean" : typeof value !== "string" || value.length > 150)) ||
        (conditions.prior_purchase && !["yes", "no"].includes(conditions.prior_purchase)) ||
        (legacy && Object.keys(conditions).length > 0)) {
      res.status(400).json({ error: "Confira o evento, as condições, o template e o tempo de espera." });
      return;
    }
    if (is_active && !template && !legacy) {
      res.status(422).json({ error: "Selecione um template do projeto para ativar a automação." });
      return;
    }
    if (is_active && template && renderProjectTemplate(repos, template, {}).error === "Arquivo de mídia indisponível.") {
      res.status(422).json({ error: "O arquivo de mídia do template não está disponível." });
      return;
    }
    const trigger = repos.transaction(() => {
      const previousConditions = previous && repos.db.prepare("SELECT conditions_json FROM automation_conditions WHERE trigger_id = ?")
        .get(previous.id) as { conditions_json: string } | undefined;
      const fields = { name, event_type, delay_seconds, is_active, template_id: template?.id ?? null };
      const saved = id ? repos.funnelTriggers.update(id, fields)! : repos.funnelTriggers.create({
        ...fields, trigger_key: "custom_" + randomUUID(), project_id: project.id,
      });
      repos.db.prepare(`
        INSERT INTO automation_conditions VALUES (?, ?)
        ON CONFLICT(trigger_id) DO UPDATE SET conditions_json = excluded.conditions_json
      `).run(saved.id, JSON.stringify(conditions));
      if (!previous || previous.event_type !== event_type || previous.delay_seconds !== delay_seconds ||
          previous.template_id !== fields.template_id || (previousConditions?.conditions_json ?? "{}") !== JSON.stringify(conditions)) {
        repos.db.prepare("UPDATE project_workspace SET simulated_at = NULL WHERE project_id = ?").run(project.id);
      }
      return saved;
    });
    res.status(id ? 200 : 201).json({ trigger });
  };
  router.post("/:projectId/triggers", route(saveTrigger));
  router.put("/:projectId/triggers/:triggerId", route(saveTrigger));

  router.post("/:projectId/contact-permissions", route((req, res, repos, project) => {
    const { phone, marketing, opted_out } = req.body ?? {};
    let normalized: string;
    try {
      normalized = sanitizePhone(phone);
      if (typeof marketing !== "boolean" || typeof opted_out !== "boolean") throw new Error();
    } catch {
      res.status(400).json({ error: "Informe um telefone e a permissão registrada do destinatário." });
      return;
    }
    repos.db.prepare(`
      INSERT INTO contact_permissions (project_id, phone, marketing, opted_out) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, phone) DO UPDATE SET marketing = excluded.marketing,
        opted_out = excluded.opted_out, updated_at = datetime('now')
    `).run(project.id, normalized, Number(marketing), Number(opted_out));
    res.json({ success: true });
  }));
  return router;
}
