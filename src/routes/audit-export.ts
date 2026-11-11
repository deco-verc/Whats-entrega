import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { getDatabase } from "../database/connection.js";
import { createRepositories } from "../database/repositories.js";

/**
 * Escapa uma célula CSV em conformidade com a RFC 4180
 * e neutraliza injeções de fórmulas de planilhas (CWE-1236 / Formula Injection).
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  let str = typeof value === "object" ? JSON.stringify(value) : String(value);

  // Prevenção de Formula Injection: se começar com caracteres acionadores de fórmulas
  // (=, +, -, @, tabulação ou carriage return), prefixa com apóstrofo (')
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Se contiver aspas, vírgulas ou quebras de linha, envolve em aspas e duplica aspas internas
  if (/[",\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Converte um array de objetos planos em string CSV RFC 4180 sanitizada
 */
export function convertToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  if (!rows || rows.length === 0) {
    return columns.join(",") + "\r\n";
  }

  const headerLine = columns.map(col => sanitizeCsvCell(col)).join(",");
  const dataLines = rows.map(row => {
    return columns.map(col => sanitizeCsvCell(row[col])).join(",");
  });

  return [headerLine, ...dataLines].join("\r\n") + "\r\n";
}

export function createAuditExportRouter(database: () => Database.Database = getDatabase): Router {
  const router = Router();

  // GET /api/audit-logs — Listagem estruturada de logs com filtros e limite seguro
  router.get("/audit-logs", (req: Request, res: Response): void => {
    try {
      const db = database();
      const repos = createRepositories(db);

      const entity = typeof req.query.entity === "string" && req.query.entity.trim().length > 0
        ? req.query.entity.trim()
        : undefined;

      const rawLimit = parseInt(String(req.query.limit || "50"), 10);
      const limit = Math.min(200, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));

      const logs = repos.auditLogs.listLogs(entity, limit);

      res.status(200).json({
        success: true,
        count: logs.length,
        logs,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: "Erro ao consultar trilha de auditoria", details: msg });
    }
  });

  // POST /api/export/csv — Exportação em lote de entidades no formato CSV sanitizado
  router.post("/export/csv", (req: Request, res: Response): void => {
    try {
      const db = database();
      const { entity, project_id } = req.body || {};

      if (!entity || typeof entity !== "string") {
        res.status(400).json({
          success: false,
          error: "ValidationError: Campo 'entity' é obrigatório no corpo da requisição.",
        });
        return;
      }

      const validEntities = ["orders", "message_queue", "audit_logs"];
      if (!validEntities.includes(entity)) {
        res.status(400).json({
          success: false,
          error: `ValidationError: Entidade '${entity}' não suportada para exportação. Entidades válidas: ${validEntities.join(", ")}.`,
        });
        return;
      }

      let rows: Record<string, unknown>[] = [];
      let columns: string[] = [];

      if (entity === "orders") {
        columns = [
          "id",
          "project_id",
          "transaction_id",
          "customer_id",
          "product_id",
          "offer_id",
          "event_type",
          "status",
          "paid_at",
          "created_at",
        ];
        if (project_id) {
          rows = db
            .prepare<[string]>(`SELECT ${columns.join(", ")} FROM orders WHERE project_id = ? ORDER BY created_at DESC LIMIT 5000`)
            .all(String(project_id)) as Record<string, unknown>[];
        } else {
          rows = db
            .prepare(`SELECT ${columns.join(", ")} FROM orders ORDER BY created_at DESC LIMIT 5000`)
            .all() as Record<string, unknown>[];
        }
      } else if (entity === "message_queue") {
        columns = [
          "id",
          "project_id",
          "customer_id",
          "phone",
          "message_type",
          "status",
          "attempts",
          "last_error",
          "scheduled_at",
          "created_at",
        ];
        if (project_id) {
          rows = db
            .prepare<[string]>(`SELECT ${columns.join(", ")} FROM message_queue WHERE project_id = ? ORDER BY created_at DESC LIMIT 5000`)
            .all(String(project_id)) as Record<string, unknown>[];
        } else {
          rows = db
            .prepare(`SELECT ${columns.join(", ")} FROM message_queue ORDER BY created_at DESC LIMIT 5000`)
            .all() as Record<string, unknown>[];
        }
      } else if (entity === "audit_logs") {
        columns = ["id", "actor", "action", "entity", "entity_id", "diff_json", "created_at"];
        rows = db
          .prepare(`SELECT ${columns.join(", ")} FROM audit_logs ORDER BY created_at DESC LIMIT 5000`)
          .all() as Record<string, unknown>[];
      }

      const csvContent = convertToCsv(rows, columns);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${entity}_export_${timestamp}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csvContent);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: "Erro ao gerar exportação CSV", details: msg });
    }
  });

  // GET /api/kpis — Indicadores consolidados de desempenho e entrega
  router.get("/kpis", (_req: Request, res: Response): void => {
    try {
      const db = database();
      const totalOrdersRow = db.prepare("SELECT COUNT(*) as count FROM orders").get() as { count: number } | undefined;
      const totalDeliveredRow = db.prepare("SELECT COUNT(*) as count FROM message_queue WHERE status = 'SENT'").get() as { count: number } | undefined;
      const totalPendingRow = db.prepare("SELECT COUNT(*) as count FROM message_queue WHERE status = 'PENDING'").get() as { count: number } | undefined;
      const activeProjectsRow = db.prepare("SELECT COUNT(*) as count FROM projects WHERE is_active = 1").get() as { count: number } | undefined;

      const totalOrders = totalOrdersRow?.count || 0;
      const totalDelivered = totalDeliveredRow?.count || 0;
      const totalPending = totalPendingRow?.count || 0;
      const activeProjects = activeProjectsRow?.count || 0;
      const deliveryRate = totalOrders > 0 ? Number(((totalDelivered / totalOrders) * 100).toFixed(1)) : 100;

      res.status(200).json({
        success: true,
        totalOrders,
        totalDelivered,
        totalPending,
        activeProjects,
        deliveryRate,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: "Erro ao calcular KPIs", details: msg });
    }
  });

  return router;
}

export default createAuditExportRouter;
