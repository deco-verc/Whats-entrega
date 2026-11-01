import { Router, Request, Response } from "express";
import type { WASocket } from "@whiskeysockets/baileys";
import { sanitizePhone, type ProcessWebhookRepositories } from "../webhooks/adapters.js";
import { getDatabase } from "../database/connection.js";
import { CustomerRepository, AuditLogRepository } from "../database/repositories.js";
import { getWhatsAppSocket, getWhatsAppConnectionStatus } from "../whatsapp/socket.js";
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
    const db = getDatabase();
    const customerRepo =
      options.repositories?.customerRepo ??
      (db && db.open ? new CustomerRepository(db) : undefined);
    const resolved = await resolveJid(sanitizedPhone, sock, { customerRepo });

    // 5. Envio de acordo com o tipo
    let dispatchResult;
    const dispatchOptions = { skipPresenceSimulation: Boolean(skipSimulation) };

    if (type === "text") {
      dispatchResult = await sendTextMessage(sock, resolved.jid, messageContent, dispatchOptions);
    } else if (type === "audio_ptt") {
      dispatchResult = await sendAudioPtt(sock, resolved.jid, mediaPath.trim(), dispatchOptions);
    } else {
      dispatchResult = await sendDocumentMessage(
        sock,
        resolved.jid,
        mediaPath.trim(),
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
