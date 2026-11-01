import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import express, { type Request, type Response, type NextFunction, type Application } from "express";
import { env, validatePort } from "../config/env.js";
import { getDatabase } from "../database/connection.js";
import type { WASocket } from "@whiskeysockets/baileys";
import { handleManualSend } from "../routes/manual-send.js";
import { createTemplatesRouter } from "../routes/templates.js";
import { TemplateRepository } from "../database/repositories.js";
import { getWhatsAppConnectionStatus } from "../whatsapp/socket.js";





import {
  validateCaktoSecret,
  normalizeCaktoWebhook,
  processNormalizedWebhook,
  sanitizePhone,
  type ProcessWebhookRepositories,
} from "./adapters.js";

export interface WebhookServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly secret?: string;
  readonly repositories?: ProcessWebhookRepositories;
  readonly publicDir?: string;
  readonly sock?: WASocket | null | (() => WASocket | null);
  readonly templateRepo?: TemplateRepository;
}

/**
 * Cria a aplicação Express do servidor de webhooks
 */
export function createWebhookApp(options: WebhookServerOptions = {}): Application {
  const app = express();
  const publicDir = options.publicDir || path.resolve(process.cwd(), "public");

  // Middlewares de seguranca e parsing de payload
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Headers de seguranca (AppSec Invariants)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  // Healthcheck obrigatorio
  const handleHealth = (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
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

    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: "connected",
      whatsapp: getWhatsAppConnectionStatus(),
      port: options.port ?? (process.env.PORT ? Number(process.env.PORT) : env.port),
      stats: {
        total_customers: customersCount,
        total_orders: ordersCount,
        pending_jobs: pendingJobsCount,
        sent_jobs: sentJobsCount,
      },
    });
  });

  app.get("/api/queue", (_req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const jobs = db.prepare(
        "SELECT id, customer_id, phone, message_type, content, scheduled_at, status, attempts, last_error, created_at FROM message_queue ORDER BY scheduled_at DESC LIMIT 50"
      ).all();
      res.status(200).json({ jobs });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/orders", (_req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const orders = db.prepare(
        "SELECT id, transaction_id, customer_id, product_id, offer_id, event_type, status, paid_at, created_at FROM orders ORDER BY created_at DESC LIMIT 50"
      ).all();
      res.status(200).json({ orders });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/customers", (_req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const customers = db.prepare(
        "SELECT id, phone, name, email, current_state, jid, created_at FROM customers ORDER BY created_at DESC LIMIT 50"
      ).all();
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

  // Endpoint receptor do Webhook da Cakto
  const handleCaktoWebhook = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
      // 1. Extração do secret de multiplas origens permitidas
      const authHeader = req.headers["authorization"];
      const bearerSecret = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : undefined;

      const providedSecret =
        (req.headers["x-cakto-signature"] as string | undefined) ||
        (req.headers["x-cakto-secret"] as string | undefined) ||
        (req.headers["x-webhook-secret"] as string | undefined) ||
        bearerSecret ||
        (req.query.secret as string | undefined) ||
        (req.query.token as string | undefined) ||
        (req.body && typeof req.body === "object" ? req.body.secret : undefined) ||
        (req.body && typeof req.body === "object" && req.body.data && typeof req.body.data === "object"
          ? req.body.data.secret
          : undefined);

      const expectedSecret = options.secret ?? env.caktoWebhookSecret;
      const isValidSecret = validateCaktoSecret(providedSecret, expectedSecret);

      if (!isValidSecret) {
        res.status(401).json({
          error: "Unauthorized: invalid or missing Cakto webhook secret",
        });
        return;
      }

      // 2. Validação do corpo da requisição
      if (!req.body || typeof req.body !== "object" || Object.keys(req.body).length === 0) {
        res.status(400).json({
          error: "Bad Request: missing or empty webhook body",
        });
        return;
      }

      // 3. Normalização do payload Cakto
      const normalized = normalizeCaktoWebhook(req.body);

      // 4. Persistência idempotente no SQLite
      const result = processNormalizedWebhook(normalized, options.repositories);
      const processingTimeMs = Date.now() - startTime;

      // 5. Resposta imediata 200 OK (< 100ms)
      res.status(200).json({
        success: true,
        transaction_id: normalized.transactionId,
        event_type: normalized.eventType,
        status: normalized.status,
        customer_id: result.customer.id,
        order_id: result.order.id,
        duplicate: result.isDuplicate,
        processing_time_ms: processingTimeMs,
        processed_at: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const statusCode = errorMsg.startsWith("Invalid Cakto payload") || errorMsg.startsWith("Invalid phone")
        ? 400
        : 500;

      res.status(statusCode).json({
        error: errorMsg,
      });
    }
  };

  app.post("/webhook/cakto", handleCaktoWebhook);
  app.post("/api/webhook/cakto", handleCaktoWebhook);

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
    if (!safePath.startsWith(publicDir) || /\/\.|\.env|\.git/i.test(req.path)) {
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

      const app = createWebhookApp(options);
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
