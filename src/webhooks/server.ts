import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import express, { type Request, type Response, type NextFunction, type Application } from "express";
import qrcode from "qrcode-generator";
import { env, validatePort, buildProjectWebhookUrl } from "../config/env.js";
import { getDatabase } from "../database/connection.js";
import { CATALOG } from "../config/catalog.js";
import { FunnelStateMachine } from "../engine/state-machine.js";
import { createRepositories } from "../database/repositories.js";
import type { WASocket } from "@whiskeysockets/baileys";
import { handleManualSend } from "../routes/manual-send.js";
import { createTemplatesRouter } from "../routes/templates.js";
import { createProjectsRouter } from "../routes/projects.js";
import { createProjectWorkspaceRouter } from "../routes/project-workspace.js";
import { createTriggersRouter } from "../routes/triggers.js";
import { protectAdministration } from "./admin-auth.js";
import { linkedProducts, logWebhook, processProjectEvent } from "./project-events.js";
import { AUTOMATION_EVENTS, storedConditions } from "../engine/project-automations.js";
import { TemplateRepository } from "../database/repositories.js";
import {
  whatsappManager,
  WhatsAppSocketManager,
} from "../whatsapp/socket.js";

import {
  validateCaktoSecret,
  normalizeCaktoWebhook,
  normalizeEventType,
  sanitizePhone,
  validateCaktoSignature,
  classifyCaktoWebhook,
  type NormalizedCaktoPayload,
  type ProcessWebhookRepositories,
} from "./adapters.js";

export interface WebhookServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly secret?: string;
  readonly repositories?: ProcessWebhookRepositories;
  readonly database?: () => Database.Database;
  readonly publicDir?: string;
  readonly sock?: WASocket | null | (() => WASocket | null);
  readonly templateRepo?: TemplateRepository;
  readonly whatsappManager?: WhatsAppSocketManager;
  readonly adminCredentials?: { username: string; password: string };
  readonly requireAdmin?: boolean;
  readonly diagnostics?: () => unknown;
}

/**
 * Cria a aplicação Express do servidor de webhooks
 */
export function createWebhookApp(options: WebhookServerOptions = {}): Application {
  const app = express();
  const publicDir = path.resolve(options.publicDir ?? "public");
  const database = () => options.database?.() ?? options.repositories?.customerRepo?.database ?? getDatabase();
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  const isTestEnv = process.env.NODE_ENV === "test";
  const shouldProtectAdmin = options.requireAdmin !== undefined
    ? Boolean(options.requireAdmin)
    : (env.isProduction || (!isTestEnv && Boolean(ADMIN_USERNAME && ADMIN_PASSWORD)));
  app.use(protectAdministration(
    options.adminCredentials ?? (ADMIN_USERNAME && ADMIN_PASSWORD ? { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } : undefined),
    shouldProtectAdmin
  ));
  app.use(express.json({
    limit: "2mb",
    verify(req, _res, body) {
      (req as Request & { rawBody?: Buffer }).rawBody = body;
    },
  }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Healthcheck obrigatorio
  const handleHealth = (_req: Request, res: Response) => {
    try {
      database().prepare("SELECT 1").get();
      res.json({ status: "ok", database: "connected", uptime: process.uptime(), timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "error", database: "unavailable" });
    }
  };

  app.get("/api/health", handleHealth);
  app.get("/health", handleHealth);

  // Status detalhado do sistema, WhatsApp e contadores
  app.get("/api/status", (_req: Request, res: Response) => {
    let customersCount = 0;
    let ordersCount = 0;
    let pendingJobsCount = 0;
    let sentJobsCount = 0;

    try {
      const db = getDatabase();
      if (db && db.open) {
        const cRow = db.prepare("SELECT COUNT(*) as count FROM customers").get() as { count: number } | undefined;
        const oRow = db.prepare("SELECT COUNT(*) as count FROM orders").get() as { count: number } | undefined;
        const pRow = db.prepare("SELECT COUNT(*) as count FROM message_queue WHERE status = 'PENDING'").get() as { count: number } | undefined;
        const sRow = db.prepare("SELECT COUNT(*) as count FROM message_queue WHERE status = 'SENT'").get() as { count: number } | undefined;
        customersCount = cRow?.count ?? 0;
        ordersCount = oRow?.count ?? 0;
        pendingJobsCount = pRow?.count ?? 0;
        sentJobsCount = sRow?.count ?? 0;
      }
    } catch {
      // Ignora falha de contagem inicial se banco ainda nao inicializado
    }

    const manager = options.whatsappManager ?? whatsappManager;
    const waConnection = manager.getConnectionState();

    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: "connected",
      whatsapp: waConnection,
      qr: waConnection.qr,
      pairing_code: waConnection.pairingCode,
      pairingCode: waConnection.pairingCode,
      whatsapp_details: {
        status: waConnection.status,
        connected: manager.isConnected(),
        qr: waConnection.qr,
        pairing_code: waConnection.pairingCode,
        connectedPhone: waConnection.connectedPhone,
      },
      port: options.port ?? (process.env.PORT ? Number(process.env.PORT) : env.port),
      public_base_url: env.publicBaseUrl,
      stats: {
        total_customers: customersCount,
        total_orders: ordersCount,
        pending_jobs: pendingJobsCount,
        sent_jobs: sentJobsCount,
      },
    });
  });

  app.get("/api/queue", (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const projectId = typeof req.query.project_id === "string" ? req.query.project_id.trim() || "default" : "default";
      let query = "SELECT id, project_id, customer_id, phone, message_type, content, scheduled_at, status, attempts, last_error, created_at FROM message_queue";
      const params: unknown[] = [];
      if (projectId) {
        query += " WHERE project_id = ?";
        params.push(projectId);
      }
      query += " ORDER BY scheduled_at DESC LIMIT 50";
      const jobs = db.prepare(query).all(...params);
      res.status(200).json({ jobs });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Limpeza da fila de mensagens (geral ou filtrada por projeto)
  app.post("/api/queue/clear", (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const projectId = (req.query.project_id ? String(req.query.project_id) : req.body?.project_id ? String(req.body.project_id) : undefined)?.trim();
      const targetProject = projectId || "default";
      const deletedCount = db.prepare("UPDATE message_queue SET status = 'CANCELLED', updated_at = datetime('now') WHERE project_id = ? AND status = 'PENDING'").run(targetProject).changes;
      res.status(200).json({
        success: true,
        message: targetProject
          ? `Fila de mensagens do projeto '${targetProject}' limpa com sucesso.`
          : "Fila de mensagens limpa com sucesso.",
        deleted_count: deletedCount,
        project_id: targetProject || "all",
      });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.get("/api/orders", (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const projectId = typeof req.query.project_id === "string" ? req.query.project_id.trim() || "default" : "default";
      let query = "SELECT id, project_id, transaction_id, customer_id, product_id, offer_id, event_type, status, paid_at, created_at FROM orders";
      const params: unknown[] = [];
      if (projectId) {
        query += " WHERE project_id = ?";
        params.push(projectId);
      }
      query += " ORDER BY created_at DESC LIMIT 50";
      const orders = db.prepare(query).all(...params);
      res.status(200).json({ orders });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/customers", (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const projectId = typeof req.query.project_id === "string" ? req.query.project_id.trim() || "default" : "default";
      let query = "SELECT id, project_id, phone, name, email, current_state, jid, created_at FROM customers";
      const params: unknown[] = [];
      if (projectId) {
        query += " WHERE project_id = ?";
        params.push(projectId);
      }
      query += " ORDER BY created_at DESC LIMIT 50";
      const customers = db.prepare(query).all(...params);
      res.status(200).json({ customers });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/settings", (_req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const settings = db.prepare("SELECT key, value, updated_at FROM system_settings").all();
      res.status(200).json({ settings });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/settings", (req: Request, res: Response) => {
    try {
      const { key, value } = req.body || {};
      if (!key || typeof key !== "string" || key.trim().length === 0) {
        res.status(400).json({ error: "ValidationError", message: "Campo 'key' e obrigatorio." });
        return;
      }
      if (value === undefined || value === null) {
        res.status(400).json({ error: "ValidationError", message: "Campo 'value' e obrigatorio." });
        return;
      }
      const db = getDatabase();
      db.prepare(
        "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).run(key.trim(), String(value));
      res.status(200).json({ success: true, key: key.trim(), value: String(value) });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Endpoint de Disparo Rapido Manual via WhatsApp Baileys (src/routes/manual-send.ts)
  app.post("/api/messages/manual-send", (req: Request, res: Response): Promise<void> => {
    return handleManualSend(req, res, options);
  });

  // Endpoints do Ciclo de Vida e Pareamento WhatsApp Baileys
  app.get("/api/whatsapp/status", (_req: Request, res: Response): void => {
    const manager = options.whatsappManager ?? whatsappManager;
    res.status(200).json({
      status: manager.getStatus(),
      connected: manager.isConnected(),
      qr: manager.getQr(),
      pairing_code: manager.getPairingCode(),
      pairingCode: manager.getPairingCode(),
    });
  });

  app.get("/api/whatsapp/qr", (_req, res) => {
    const raw = (options.whatsappManager ?? whatsappManager).getQr();
    if (!raw) {
      res.status(404).json({ error: "Nenhum QR disponível." });
      return;
    }
    const qr = qrcode(0, "M");
    qr.addData(raw);
    qr.make();
    res.type("image/svg+xml").send(qr.createSvgTag(4, 16));
  });

  app.post("/api/whatsapp/reconnect", async (_req, res) => {
    const manager = options.whatsappManager ?? whatsappManager;
    await manager.connect();
    res.json({ success: true, status: manager.getStatus() });
  });

  app.post("/api/whatsapp/pair", async (req: Request, res: Response): Promise<void> => {
    try {
      const { phone } = req.body || {};
      if (!phone || typeof phone !== "string" || phone.trim().length === 0) {
        res.status(400).json({
          error: "ValidationError",
          message: "Campo 'phone' e obrigatorio.",
        });
        return;
      }

      const cleanPhone = phone.replace(/\D/g, "");
      if (cleanPhone.length < 10) {
        res.status(400).json({
          error: "ValidationError",
          message: "Telefone invalido para pareamento. Forneca DDD + Numero (minimo 10 digitos).",
        });
        return;
      }

      const manager = options.whatsappManager ?? whatsappManager;
      const code = await manager.requestPairingCode(cleanPhone);

      res.status(200).json({
        success: true,
        pairing_code: code,
        pairingCode: code,
        phone: cleanPhone,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const isValidationError =
        message.includes("invalido") ||
        message.includes("ja esta autenticado") ||
        message.includes("ja possui credenciais");
      res.status(isValidationError ? 400 : 500).json({
        error: isValidationError ? "ValidationError" : "PairingError",
        message,
      });
    }
  });

  app.post("/api/whatsapp/disconnect", async (_req: Request, res: Response): Promise<void> => {
    try {
      const manager = options.whatsappManager ?? whatsappManager;
      await manager.disconnect();
      res.status(200).json({
        success: true,
        status: manager.getStatus(),
        message: "WhatsApp desconectado com sucesso.",
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: "DisconnectError",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/whatsapp/logout", async (_req: Request, res: Response): Promise<void> => {
    try {
      const manager = options.whatsappManager ?? whatsappManager;
      await manager.logout();
      res.status(200).json({
        success: true,
        status: manager.getStatus(),
        message: "Sessao WhatsApp desconectada e limpa com sucesso.",
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: "LogoutError",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Gestao de Templates de Mensagens com Tags Dinamicas e Spintax (src/routes/templates.ts)
  const effectiveTemplateRepo = options.templateRepo ?? options.repositories?.templateRepo;
  try {
    const tplRepo = effectiveTemplateRepo ?? (getDatabase()?.open ? new TemplateRepository(getDatabase()) : undefined);
    tplRepo?.seedIfEmpty();
  } catch {
    // Ignora falha de seed em caso de banco isolado
  }
  app.use(
    "/api/templates",
    createTemplatesRouter({ templateRepo: effectiveTemplateRepo })
  );

  // Gestao de Projetos Multi-Tenant (src/routes/projects.ts)
  app.use("/api/projects", createProjectsRouter(database));
  app.use("/api/projects", createProjectWorkspaceRouter(database, options));

  // Gestao de Gatilhos e Regras de Automacao (src/routes/triggers.ts)
  app.use(
    "/api/triggers",
    createTriggersRouter({
      triggerRepo: options.repositories?.funnelTriggers,
    })
  );

  const getEventRepos = () => createRepositories(database());

  const handleCaktoWebhook = (req: Request, res: Response): void => {
    const started = Date.now();
    const repos = getEventRepos();
    const projectRepo = repos.projects;
    const slug = req.params.project_slug;
    const projectRef = req.query.project_id ?? req.query.project;
    const rawRecords: Array<Record<string, any> | undefined> = Array.isArray(req.body?.data) ? req.body.data : [req.body?.data ?? req.body];
    const productIds = rawRecords.map((item) => item?.product?.id ?? item?.product_id);
    const candidates = slug || projectRef ? [] : projectRepo.listAll().filter((project) =>
      !repos.db.prepare("SELECT 1 FROM project_workspace WHERE project_id = ? AND archived_at IS NOT NULL").get(project.id) &&
      productIds.some((id) => linkedProducts(repos, project).includes(id)));
    if (candidates.length > 1) {
      res.status(409).json({ error: "Use a URL exclusiva do projeto para este produto." });
      return;
    }
    const project = typeof slug === "string" ? projectRepo.findBySlug(slug)
      : typeof projectRef === "string" ? projectRepo.findById(projectRef) ?? projectRepo.findBySlug(projectRef)
      : candidates[0] ?? projectRepo.findById("default");

    if (!project || repos.db.prepare("SELECT 1 FROM project_workspace WHERE project_id = ? AND archived_at IS NOT NULL").get(project.id)) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }

    const signature = req.get("X-Cakto-Signature");
    const timestamp = req.get("X-Cakto-Timestamp");
    const secret = project.cakto_webhook_secret ?? (project.id === "default" ? options.secret ?? env.caktoWebhookSecret : "");
    const isSigned = Boolean(timestamp || signature?.startsWith("v1="));
    const providedSecret = signature || req.get("X-Cakto-Secret") || req.get("X-Webhook-Secret") ||
      req.get("Authorization")?.match(/^Bearer (.+)$/)?.[1] || (!env.isProduction ? req.query.secret || req.query.token : undefined);
    const valid = isSigned
      ? validateCaktoSignature((req as Request & { rawBody?: Buffer }).rawBody, timestamp, signature, secret)
      : validateCaktoSecret(providedSecret ?? req.body?.secret, secret, signature ? req.body : undefined);
    if (!valid) {
      logWebhook(repos, project.id, false, "AUTH_FAILED", undefined, "Segredo ou assinatura Cakto inválidos.", req.body, false);
      res.status(401).json({ error: "Segredo ou assinatura Cakto inválidos." });
      return;
    }

    const eventName = req.body?.event ?? req.body?.event_type ?? rawRecords[0]?.event ?? rawRecords[0]?.event_type;
    const normalizedEventName = normalizeEventType(eventName);

    // Se o payload tiver dados de transacao mas nenhum evento, rejeita como 400
    if (!eventName && rawRecords.length > 0 && rawRecords.some((r) => r?.id || r?.transaction_id)) {
      logWebhook(repos, project.id, true, "INVALID_PAYLOAD", undefined, "Evento ausente no payload.", req.body, false);
      res.status(400).json({ error: "Payload Cakto inválido ou evento não suportado." });
      return;
    }

    // Classificação estrita entre PROBE, TEST, AMBIGUOUS e PRODUCTION
    const classification = classifyCaktoWebhook(req.body, rawRecords);

    // A. PROBE DE CONECTIVIDADE
    if (classification.category === "PROBE") {
      logWebhook(repos, project.id, true, "PROBE", undefined, classification.reason, req.body, true);
      res.json({ success: true, probe: true, project_id: project.id, message: "Probe de conectividade recebido com sucesso." });
      return;
    }

    // B. EVENTO DE TESTE DA CAKTO
    if (classification.category === "TEST") {
      let normalizedTest: NormalizedCaktoPayload;
      try {
        normalizedTest = normalizeCaktoWebhook(req.body, { isTest: true });
      } catch (err: any) {
        logWebhook(repos, project.id, true, "TEST_FAILED", undefined, `Falha na normalização de teste: ${err?.message}`, req.body, true);
        res.status(400).json({ error: "Estrutura do payload de teste inválida." });
        return;
      }

      // Identifica automações ativas do projeto que seriam elegíveis
      const matchingTriggers = repos.funnelTriggers.listByProject(project.id).filter((trigger) => {
        if (!trigger.is_active) return false;
        if (trigger.event_type !== normalizedTest.eventType) return false;
        const conditions = storedConditions(repos.db, trigger.id);
        if (conditions?.offer_type && conditions.offer_type.toLowerCase() !== (normalizedTest.offerType || "main").toLowerCase()) return false;
        if (conditions?.status && conditions.status.toUpperCase() !== (normalizedTest.status || "").toUpperCase()) return false;
        return true;
      });
      const matchedNames = matchingTriggers.map((t) => t.name);
      const detailsMsg = `Evento de teste da Cakto. ${matchedNames.length} automação(ões) correspondente(s): ${matchedNames.join(", ") || "Nenhuma correspondente"}.`;

      logWebhook(repos, project.id, true, "TEST", normalizedTest, detailsMsg, req.body, true);

      res.status(200).json({
        success: true,
        test: true,
        probe: classification.isMultiMethod,
        project_id: project.id,
        event_type: normalizedTest.eventType,
        transaction_id: normalizedTest.transactionId,
        matched_automations: matchedNames,
        message: "Evento de teste da Cakto recebido e registrado no Laboratório de Testes.",
      });
      return;
    }

    // Evento Ambíguo
    if (classification.category === "AMBIGUOUS") {
      logWebhook(repos, project.id, true, "AMBIGUOUS", undefined, classification.reason, req.body, true);
      res.status(200).json({
        success: true,
        ambiguous: true,
        project_id: project.id,
        message: "Evento registrado para inspeção sem criação de pedido.",
      });
      return;
    }

    // C. EVENTO COMERCIAL REAL (PRODUÇÃO)
    let events: NormalizedCaktoPayload[] = [];
    try {
      if (rawRecords.length === 0 || !eventName) throw new Error("Evento ausente.");
      if (isSigned && rawRecords.some((data) => !data || typeof data !== "object" ||
          (!data.product?.id && !data.product_id && !req.body?.product_id) ||
          (normalizedEventName !== "checkout_abandonment" && (typeof data.id !== "string" || typeof data.status !== "string")))) {
        throw new Error("Estrutura da entrega assinada inválida.");
      }
      events = rawRecords.map((data) => normalizeCaktoWebhook({ ...req.body, data }, { isTest: false }));
      for (const event of events) {
        if (!(AUTOMATION_EVENTS as readonly string[]).includes(event.eventType)) throw new Error("Evento Cakto não suportado.");
        if (event.eventType === "purchase_approved" && !["APPROVED", "PAID"].includes(event.status)) {
          throw new Error("Compra aprovada exige status de pagamento confirmado.");
        }
        if (event.eventType === "purchase_refunded" && event.status !== "REFUNDED") {
          throw new Error("Reembolso exige status de reembolso confirmado.");
        }
      }
    } catch {
      logWebhook(repos, project.id, true, "INVALID_PAYLOAD", undefined, "Estrutura, evento ou dados de pagamento inválidos.", req.body, false);
      res.status(400).json({ error: "Payload Cakto inválido ou evento não suportado." });
      return;
    }

    const allowed = linkedProducts(repos, project);
    if ((project.id !== "default" || allowed.length > 0) && events.some((event) => !allowed.includes(event.product.id))) {
      logWebhook(repos, project.id, true, "PRODUCT_MISMATCH", events.find((event) => !allowed.includes(event.product.id)), "Produto sem vínculo com este projeto.", req.body, false);
      res.status(422).json({ error: "Produto sem vínculo com este projeto." });
      return;
    }

    try {
      const results = repos.db.transaction(() => events.map((event) => {
        const result = processProjectEvent(repos, project, event, options.repositories, false);
        logWebhook(repos, project.id, true, result.isDuplicate ? "DUPLICATE" : "PROCESSED", event, undefined, req.body, false);
        return {
          success: true, transaction_id: event.transactionId, event_type: event.eventType, status: event.status,
          project_id: project.id, customer_id: result.customer.id, order_id: result.order.id,
          duplicate: result.isDuplicate,
        };
      })).immediate();
      res.json({
        ...results[0], ...(results.length > 1 ? { events: results } : {}),
        processing_time_ms: Date.now() - started, processed_at: new Date().toISOString(),
      });
    } catch {
      logWebhook(repos, project.id, true, "PROCESSING_ERROR", events[0], "Erro interno ao processar evento comercial.", req.body, false);
      res.status(500).json({ error: "Não foi possível processar o webhook." });
    }
  };
  // Handlers de verificacao de URL da Cakto (GET e HEAD)
  const handleCaktoValidation = (req: Request, res: Response): void => {
    const rawSlug = req.params?.project_slug;
    const slug = typeof rawSlug === "string" ? rawSlug.trim() : undefined;
    res.status(200).json({
      status: "ok",
      message: "Cakto webhook endpoint is active and listening for events.",
      slug: slug || "default",
      webhook_url: buildProjectWebhookUrl(slug, env.publicBaseUrl),
      public_base_url: env.publicBaseUrl,
      timestamp: new Date().toISOString(),
    });
  };

  app.get("/webhook/cakto", handleCaktoValidation);
  app.get("/webhook/cakto/:project_slug", handleCaktoValidation);
  app.get("/api/webhook/cakto", handleCaktoValidation);
  app.get("/api/webhook/cakto/:project_slug", handleCaktoValidation);
  app.head("/webhook/cakto", handleCaktoValidation);
  app.head("/webhook/cakto/:project_slug", handleCaktoValidation);
  app.head("/api/webhook/cakto", handleCaktoValidation);
  app.head("/api/webhook/cakto/:project_slug", handleCaktoValidation);

  app.post("/webhook/cakto", handleCaktoWebhook);
  app.post("/webhook/cakto/:project_slug", handleCaktoWebhook);
  app.post("/api/webhook/cakto", handleCaktoWebhook);
  app.post("/api/webhook/cakto/:project_slug", handleCaktoWebhook);

  app.post("/api/simulator/cakto", (req: Request, res: Response): void => {
    const { phone, name, email, event, eventType, productType, text, project_id, product_id, offer_id, amount, marketing_consent } = req.body ?? {};
    if (typeof phone !== "string" || phone.replace(/\D/g, "").length < 8) {
      res.status(400).json({ error: "ValidationError", message: "Informe um telefone de simulação válido." });
      return;
    }
    const repos = getEventRepos();
    const project = repos.projects.findById(typeof project_id === "string" ? project_id : "default");
    if (!project || repos.db.prepare("SELECT 1 FROM project_workspace WHERE project_id = ? AND archived_at IS NOT NULL").get(project.id)) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }
    const selected = String(event || eventType || "purchase_approved");
    const upsell = selected === "purchase_approved_upsell" || productType === "UPSELL_1";
    const downsell = selected === "purchase_approved_downsell" || productType === "DOWNSELL";
    const catalog = upsell ? CATALOG.UPSELL_1 : downsell ? CATALOG.DOWNSELL : CATALOG.MAIN;
    const type = upsell || downsell ? "purchase_approved" : selected === "pix_gerado" ? "pix_generated" : selected;
    const reply = ["customer_reply", "inbound_message", "reply"].includes(type);
    if (!reply && !(AUTOMATION_EVENTS as readonly string[]).includes(type)) {
      res.status(400).json({ error: "Evento não suportado." });
      return;
    }
    const productId = typeof product_id === "string" && product_id ? product_id
      : project.cakto_product_id ?? (project.id === "default" ? catalog.productId : null);
    if (!productId && !reply) {
      res.status(422).json({ error: "Vincule o produto Cakto antes de simular." });
      return;
    }
    if (productId && project.id !== "default" && !linkedProducts(repos, project).includes(productId)) {
      res.status(422).json({ error: "Produto de simulação sem vínculo com este projeto." });
      return;
    }

    const rollback = Symbol("simulation");
    let result: Record<string, unknown> = {};
    let approved = false;
    try {
      repos.db.transaction(() => {
        const cleanPhone = sanitizePhone(phone);
        if (reply) {
          const state = new FunnelStateMachine(repos).handleInboundMessage({
            phoneOrJid: cleanPhone, text: typeof text === "string" ? text : "SIM", projectId: project.id,
          });
          result = { mode: "customer_reply", state_machine: state, message: "Resposta do cliente simulada." };
          throw rollback;
        }

        const id = "sim_tx_" + randomUUID();
        const simulatedOffer = typeof offer_id === "string" ? offer_id : project.id === "default" ? catalog.defaultOfferId : "";
        const status = type === "pix_generated" ? "waiting_payment"
          : type === "purchase_refused" ? "refused"
          : type === "purchase_refunded" ? "refunded"
          : type === "pix_expirado" || type === "subscription_canceled" ? "canceled"
          : type === "purchase_approved" || type === "subscription_renewed" ? "paid" : type;
        const normalized = normalizeCaktoWebhook({
          event: type === "checkout_abandonment" ? "checkout_abandonment" : type,
          data: {
            id, status, offer_type: upsell ? "upsell" : downsell ? "downsell" : "main",
            customer: { name: typeof name === "string" && name.trim() ? name.trim() : "Cliente de simulação", phone: cleanPhone, email },
            product: { id: productId }, offer: { id: simulatedOffer }, amount,
            pix: type === "pix_generated" ? { qr_code_text: "PIX_DE_SIMULACAO" } : undefined,
          },
        });
        const last = repos.db.prepare("SELECT COALESCE(MAX(rowid), 0) AS id FROM message_queue").get() as { id: number };
        if (marketing_consent === true) {
          repos.db.prepare(`
            INSERT INTO contact_permissions (project_id, phone, marketing, opted_out) VALUES (?, ?, 1, 0)
            ON CONFLICT(project_id, phone) DO UPDATE SET marketing = 1
          `).run(project.id, cleanPhone);
        }
        const processed = processProjectEvent(repos, { ...project, is_active: 1 }, normalized, undefined, true);
        const jobs = repos.db.prepare(`
          SELECT message_type, scheduled_at, content FROM message_queue WHERE project_id = ? AND rowid > ?
          ORDER BY scheduled_at
        `).all(project.id, last.id);
        approved = jobs.length > 0;
        result = {
          simulated_event: type, transaction_id: id, product_id: productId, offer_id: simulatedOffer,
          evaluations: processed.evaluations, state_machine: processed.canonical, jobs,
        };
        throw rollback;
      }).immediate();
    } catch (error) {
      if (error !== rollback) {
        res.status(422).json({ error: "Não foi possível simular. Confira o telefone e as configurações do projeto." });
        return;
      }
    }
    if (approved) {
      repos.db.prepare(`
        INSERT INTO project_workspace (project_id, simulated_at) VALUES (?, datetime('now'))
        ON CONFLICT(project_id) DO UPDATE SET simulated_at = excluded.simulated_at
      `).run(project.id);
    }
    repos.auditLogs.log("admin", "simulate_cakto", "projects", project.id, {
      event: type, scheduled: Array.isArray(result.jobs) ? result.jobs.length : 0, approved,
    });
    res.json({
      success: true,
      mode: "dry_run",
      simulated_webhook_url: buildProjectWebhookUrl(project.slug, env.publicBaseUrl),
      public_base_url: env.publicBaseUrl,
      ...result,
      project_id: project.id,
      sent: false,
      approved,
    });
  });
  // Roteamento SPA e arquivos estáticos (Full-Stack Invariants)
  const serveSpaIndex = (_req: Request, res: Response) => {
    const indexPath = path.resolve(publicDir, "index.html");
    if (fs.existsSync(indexPath)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.sendFile(indexPath);
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>WhatsappEntrega - Dashboard</title>
</head>
<body>
  <div id="app">WhatsappEntrega Webhook Service Active</div>
</body>
</html>`);
    }
  };

  // Servir ativos publicos se diretorio existir, com blindagem de Path Traversal
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    if (req.path.startsWith("/api") || req.path.startsWith("/webhook")) {
      return next();
    }

    const safePath = path.resolve(publicDir, "." + req.path);

    // Bloqueia Path Traversal e arquivos ocultos (.env, .git)
    if (safePath !== publicDir && !safePath.startsWith(publicDir + path.sep) || /\/\.|\.env|\.git/i.test(req.path)) {
      res.status(403).send("Forbidden");
      return;
    }

    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      res.sendFile(safePath);
      return;
    }

    next();
  });

  // Fallback SPA na rota raiz e rotas de navegacao
  app.get("/", serveSpaIndex);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/webhook")) {
      serveSpaIndex(req, res);
      return;
    }
    next();
  });

  app.use((error: { status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
    res.status(status).json({ error: status === 413 ? "Arquivo ou corpo acima do limite." :
      status === 400 ? "Corpo da solicitação inválido." : "Não foi possível processar a solicitação." });
  });

  return app;
}

/**
 * Inicializa o servidor HTTP na porta configurada (PORT_GUARD 4000-4999)
 */
export function startWebhookServer(options: WebhookServerOptions = {}): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    try {
      const portCandidate = options.port ?? (process.env.PORT ? Number(process.env.PORT) : env.port);
      const port = validatePort(portCandidate);
      const host = options.host ?? process.env.HOST ?? env.host;

      const app = createWebhookApp({
        ...options,
        requireAdmin: options.requireAdmin ?? (!env.isTest && !["127.0.0.1", "::1", "localhost"].includes(host)),
      });
      const server = http.createServer(app);

      server.listen(port, host, () => {
        resolve(server);
      });

      server.on("error", (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export default createWebhookApp;
