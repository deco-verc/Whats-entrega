import { Router, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type { WASocket } from "@whiskeysockets/baileys";
import { sanitizePhone, type ProcessWebhookRepositories } from "../webhooks/adapters.js";
import { getDatabase } from "../database/connection.js";
import { CustomerRepository, AuditLogRepository } from "../database/repositories.js";
import { getWhatsAppSocket, getWhatsAppConnectionStatus } from "../whatsapp/socket.js";
import { env } from "../config/env.js";
import { projectMediaPath } from "../engine/project-automations.js";
import {
  resolveJid,
  sendTextMessage,
  sendAudioPtt,
  sendDocumentMessage,
} from "../whatsapp/dispatcher.js";

export interface ManualSendOptions {
  sock?: WASocket | null | (() => WASocket | null);
  repositories?: ProcessWebhookRepositories;
}

/**
 * Processa a requisicao de disparo avulso manual de mensagens via WhatsApp Baileys.
 */
export async function handleManualSend(
  req: Request,
  res: Response,
  options: ManualSendOptions = {}
): Promise<void> {
  try {
    const {
      phone,
      type = "text",
      message,
      text,
      mediaPath,
      fileName,
      mimetype,
      caption,
      skipSimulation = false,
      project_id = "default",
    } = req.body || {};

    // 1. Validacao rigorosa do telefone
    if (!phone || typeof phone !== "string" || phone.trim().length === 0) {
      res.status(400).json({
        error: "ValidationError",
        message: "Campo 'phone' e obrigatorio.",
      });
      return;
    }

    let sanitizedPhone: string;
    try {
      sanitizedPhone = sanitizePhone(phone);
    } catch (phoneErr) {
      res.status(400).json({
        error: "ValidationError",
        message: `Telefone invalido: ${phoneErr instanceof Error ? phoneErr.message : String(phoneErr)}`,
      });
      return;
    }

    // 2. Validacao do tipo de mensagem
    const validTypes = ["text", "audio_ptt", "document"] as const;
    if (!validTypes.includes(type)) {
      res.status(400).json({
        error: "ValidationError",
        message: `Tipo de mensagem invalido: '${type}'. Tipos suportados: text, audio_ptt, document`,
      });
      return;
    }

    const messageContent = (message || text || "").trim();
    if (type === "text" && messageContent.length === 0) {
      res.status(400).json({
        error: "ValidationError",
        message: "Para mensagens do tipo 'text', o campo 'message' ou 'text' e obrigatorio.",
      });
      return;
    }

    if (
      (type === "audio_ptt" || type === "document") &&
      (!mediaPath || typeof mediaPath !== "string" || mediaPath.trim().length === 0)
    ) {
      res.status(400).json({
        error: "ValidationError",
        message: `Para mensagens do tipo '${type}', o campo 'mediaPath' e obrigatorio.`,
      });
      return;
    }

    const db = options.repositories?.customerRepo?.database ?? getDatabase();
    if (typeof project_id !== "string" || !db.prepare(`
      SELECT 1 FROM projects p LEFT JOIN project_workspace w ON w.project_id = p.id
      WHERE p.id = ? AND w.archived_at IS NULL
    `).get(project_id)) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }
    if (db.prepare("SELECT 1 FROM whatsapp_opt_out WHERE phone = ?").get(sanitizedPhone) ||
        db.prepare("SELECT 1 FROM contact_permissions WHERE project_id = ? AND phone = ? AND opted_out = 1").get(project_id, sanitizedPhone)) {
      res.status(403).json({ error: "O destinatário solicitou descadastro." });
      return;
    }
    let allowedMedia: string | null = null;
    if (type !== "text") {
      const media = mediaPath.trim();
      allowedMedia = projectMediaPath(path.basename(media), type === "audio_ptt" ? "AUDIO_PTT" : "DOCUMENT", project_id);
      if (allowedMedia && path.basename(media) !== media) {
        try {
          const provided = fs.realpathSync(path.isAbsolute(media) ? media : path.resolve(env.paths.mediaDir, media));
          if (provided !== allowedMedia) allowedMedia = null;
        } catch {
          allowedMedia = null;
        }
      }
      if (!allowedMedia) {
        res.status(400).json({ error: "Arquivo de mídia inválido ou fora deste projeto." });
        return;
      }
    }

    // 3. Obtencao do socket Baileys ativo
    const sock = options.sock
      ? typeof options.sock === "function"
        ? options.sock()
        : options.sock
      : getWhatsAppSocket();

    if (!sock) {
      res.status(503).json({
        success: false,
        error: "WhatsApp Baileys socket nao esta conectado no momento.",
        status: getWhatsAppConnectionStatus(),
      });
      return;
    }

    // 4. Resolucao do JID com 9º digito
    const customerRepo =
      options.repositories?.customerRepo ??
      (db && db.open ? new CustomerRepository(db) : undefined);
    const scopedCustomer = customerRepo?.findByPhone(sanitizedPhone, project_id);
    const resolved = await resolveJid(scopedCustomer ?? sanitizedPhone, sock, { customerRepo, projectId: project_id });

    // 5. Envio de acordo com o tipo
    let dispatchResult;
    const dispatchOptions = { skipPresenceSimulation: Boolean(skipSimulation) };

    if (type === "text") {
      dispatchResult = await sendTextMessage(sock, resolved.jid, messageContent, dispatchOptions);
    } else if (type === "audio_ptt") {
      dispatchResult = await sendAudioPtt(sock, resolved.jid, allowedMedia!, dispatchOptions);
    } else {
      dispatchResult = await sendDocumentMessage(
        sock,
        resolved.jid,
        allowedMedia!,
        fileName || "documento.pdf",
        mimetype || "application/pdf",
        caption,
        dispatchOptions
      );
    }

    // 6. Registro opcional de auditoria
    try {
      const auditRepo =
        options.repositories?.auditRepo ??
        (db && db.open ? new AuditLogRepository(db) : undefined);
      if (auditRepo) {
        auditRepo.log("api", "manual_send", "whatsapp_message", resolved.jid, {
          projectId: project_id,
          phone: sanitizedPhone,
          type,
          success: dispatchResult.success,
          durationMs: dispatchResult.durationMs,
          messageId: dispatchResult.messageId,
        });
      }
    } catch (auditErr) {
      console.warn("[System] Aviso: falha ao registrar log de auditoria do disparo manual:", auditErr);
    }

    if (dispatchResult.success) {
      res.status(200).json({
        success: true,
        messageId: dispatchResult.messageId,
        jid: resolved.jid,
        phone: sanitizedPhone,
        type,
        durationMs: dispatchResult.durationMs,
        sentAt: new Date().toISOString(),
      });
    } else {
      res.status(500).json({
        success: false,
        error: dispatchResult.error || "Falha no envio da mensagem via WhatsApp",
        jid: resolved.jid,
        phone: sanitizedPhone,
        type,
        durationMs: dispatchResult.durationMs,
      });
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
}

/**
 * Cria o Router Express para o endpoint de disparo manual.
 */
export function createManualSendRouter(options: ManualSendOptions = {}): Router {
  const router = Router();
  router.post("/", (req: Request, res: Response) => handleManualSend(req, res, options));
  return router;
}
