import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { raw, Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { createRepositories, type Project } from "../database/repositories.js";
import { AUTOMATION_EVENTS, isLegacyAutomationKey, projectMediaPath, projectTemplateVariables, renderProjectTemplate } from "../engine/project-automations.js";
import { sanitizePhone } from "../webhooks/adapters.js";
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
      (SELECT COUNT(*) FROM orders WHERE project_id = @id) AS orders_count,
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
      SELECT o.id, o.transaction_id, o.product_id, o.offer_id, o.event_type, o.status, o.paid_at, o.created_at, c.name
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
        q.message_type, q.scheduled_at, q.status, q.attempts, q.last_error, t.name AS automation
      FROM message_queue q LEFT JOIN automation_executions e ON e.job_id = q.id
      LEFT JOIN funnel_triggers t ON t.id = e.trigger_id AND t.project_id = q.project_id
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE q.project_id = ? AND (? IS NULL OR q.status = ?) ORDER BY q.scheduled_at DESC LIMIT 100
    `).all(project.id, status, status);
    res.json({ jobs });
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
