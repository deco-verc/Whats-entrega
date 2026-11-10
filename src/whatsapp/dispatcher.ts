import * as fs from "node:fs";
import * as path from "node:path";
import type { WASocket } from "@whiskeysockets/baileys";
import { env } from "../config/env.js";
import {
  customerRepository,
  auditLogRepository,
  messageQueueRepository,
  CustomerRepository,
  AuditLogRepository,
  MessageQueueRepository,
  type Customer,
  type QueueJob,
} from "../database/repositories.js";

/**
 * Resultado da resolucao do JID com normalizacao do 9º digito brasileiro
 */
export interface JidResolutionResult {
  readonly phone: string;
  readonly jid: string;
  readonly exists: boolean;
  readonly fromCache: boolean;
  readonly testedCandidates: readonly string[];
  readonly customerId?: string;
}

/**
 * Parametros de configuracao do despacho com simulacao humana
 */
export interface DispatchOptions {
  readonly beforeSend?: () => void;
  readonly messageId?: string;
  readonly skipPresenceSimulation?: boolean;
  readonly minComposingMs?: number;
  readonly maxComposingMs?: number;
  readonly minRecordingMs?: number;
  readonly maxRecordingMs?: number;
}

/**
 * Resultado do envio de uma mensagem
 */
export interface DispatchResult {
  readonly success: boolean;
  readonly messageId?: string;
  readonly jid: string;
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * Utilitario de espera assincrona (sleep)
 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retorna atraso pseudo-aleatorio inteiro entre minMs e maxMs inclusivos
 */
export function getRandomDelay(minMs: number, maxMs: number): number {
  const min = Math.min(minMs, maxMs);
  const max = Math.max(minMs, maxMs);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Gera candidatos de telefones brasileiros normalizando o 9º digito movel
 * Formato internacional Brasil: 55 + DDD (2 digitos) + 8 ou 9 digitos
 */
export function resolveBrazilianPhoneCandidates(rawPhone: string): {
  readonly canonicalPhone: string;
  readonly candidates: string[];
} {
  const isExplicitInternational = rawPhone.trim().startsWith("+") && !rawPhone.trim().startsWith("+55");
  const digits = rawPhone.replace(/\D/g, "");

  // Se nao for internacional e nao tiver DDI 55 mas tiver 10 ou 11 digitos nacionais, prefixa 55
  let fullDigits = digits;
  if (!isExplicitInternational && !fullDigits.startsWith("55") && (fullDigits.length === 10 || fullDigits.length === 11)) {
    fullDigits = `55${fullDigits}`;
  }

  // Verifica se e um numero brasileiro valido (DDI 55 + DDD 2 digitos)
  if (!isExplicitInternational && fullDigits.startsWith("55") && (fullDigits.length === 12 || fullDigits.length === 13)) {
    const ddd = fullDigits.slice(2, 4);
    const subscriber = fullDigits.slice(4);

    if (fullDigits.length === 13) {
      // 13 digitos: 55 + DDD + 9 + 8 digitos
      const candidateWith9 = fullDigits;
      const candidateWithout9 = `55${ddd}${subscriber.slice(1)}`;
      return {
        canonicalPhone: fullDigits,
        candidates: [candidateWith9, candidateWithout9],
      };
    } else {
      // 12 digitos: 55 + DDD + 8 digitos
      const candidateWithout9 = fullDigits;
      const candidateWith9 = `55${ddd}9${subscriber}`;
      return {
        canonicalPhone: candidateWith9,
        candidates: [candidateWith9, candidateWithout9],
      };
    }
  }

  // Numeros internacionais ou outros formatos
  return {
    canonicalPhone: digits,
    candidates: [digits],
  };
}

export interface ResolveJidOptions {
  readonly projectId?: string;
  readonly forceRefresh?: boolean;
  readonly updateDatabase?: boolean;
  readonly customerRepo?: CustomerRepository;
  readonly auditRepo?: AuditLogRepository;
}

/**
 * JID Resolver com normalizacao do 9º digito brasileiro e persistencia em SQLite
 */
export async function resolveJid(
  phoneOrCustomer: string | Customer,
  sock: WASocket,
  options: ResolveJidOptions = {}
): Promise<JidResolutionResult> {
  const custRepo = options.customerRepo ?? customerRepository;
  const auditRepo = options.auditRepo ?? auditLogRepository;

  let targetPhone = "";
  let existingCustomer: Customer | null = null;

  if (typeof phoneOrCustomer === "string") {
    const trimmed = phoneOrCustomer.trim();
    // Se ja for um JID completo do WhatsApp, retorna diretamente
    if (trimmed.includes("@s.whatsapp.net") || trimmed.includes("@g.us")) {
      const purePhone = trimmed.replace(/@.*$/, "").replace(/\D/g, "");
      return {
        phone: purePhone,
        jid: trimmed,
        exists: true,
        fromCache: true,
        testedCandidates: [purePhone],
      };
    }
    targetPhone = trimmed;
    const byId = custRepo.findById(targetPhone);
    existingCustomer = custRepo.findByPhone(targetPhone, options.projectId) ||
      (byId?.project_id === (options.projectId ?? "default") ? byId : null);
  } else {
    existingCustomer = phoneOrCustomer;
    targetPhone = existingCustomer.phone;
  }

  // Cache hit no banco SQLite: se ja tiver JID verificado e nao for forceRefresh, aproveita
  if (existingCustomer?.jid && !options.forceRefresh) {
    return {
      phone: existingCustomer.phone,
      jid: existingCustomer.jid,
      exists: true,
      fromCache: true,
      testedCandidates: [],
      customerId: existingCustomer.id,
    };
  }

  const { canonicalPhone, candidates } = resolveBrazilianPhoneCandidates(targetPhone);

  try {
    const results = await sock.onWhatsApp(...candidates);

    if (results && results.length > 0) {
      // Busca primeiro resultado ativo retornado pela Meta
      const activeMatch = results.find((r) => r && r.exists && r.jid);

      if (activeMatch && activeMatch.jid) {
        const canonicalJid = activeMatch.jid;

        // Salva JID real Meta no banco de dados SQLite
        if (options.updateDatabase !== false) {
          if (!existingCustomer) {
            for (const cand of candidates) {
              const found = custRepo.findByPhone(cand, options.projectId);
              if (found) {
                existingCustomer = found;
                break;
              }
            }
            if (!existingCustomer) {
              existingCustomer = custRepo.findByPhone(targetPhone, options.projectId) || custRepo.findByPhone(canonicalPhone, options.projectId);
            }
          }

          if (existingCustomer) {
            custRepo.updateJid(existingCustomer.id, canonicalJid);
            auditRepo.log(
              "SYSTEM",
              "RESOLVE_JID",
              "customers",
              existingCustomer.id,
              {
                phone: targetPhone,
                canonicalPhone,
                resolvedJid: canonicalJid,
                candidates,
              }
            );
          }
        }

        return {
          phone: targetPhone,
          jid: canonicalJid,
          exists: true,
          fromCache: false,
          testedCandidates: candidates,
          customerId: existingCustomer?.id,
        };
      }
    }
  } catch (error) {
    console.error("[WhatsApp] Erro durante consulta onWhatsApp:", error);
  }

  // Fallback caso a Meta nao retorne existencia ativa
  const fallbackJid = `${candidates[0]}@s.whatsapp.net`;
  return {
    phone: targetPhone,
    jid: fallbackJid,
    exists: false,
    fromCache: false,
    testedCandidates: candidates,
    customerId: existingCustomer?.id,
  };
}

/**
 * Simula presenca humana de digitacao ('composing' por 2.5s a 5.0s antes de texto)
 */
export async function simulateTypingPresence(
  sock: WASocket,
  jid: string,
  options?: DispatchOptions
): Promise<number> {
  if (options?.skipPresenceSimulation) return 0;

  const min = options?.minComposingMs ?? 2500;
  const max = options?.maxComposingMs ?? 5000;
  const delay = getRandomDelay(min, max);
  const targetJid = jid.includes("@") ? jid : `${jid.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    await sock.sendPresenceUpdate("composing", targetJid);
    await sleep(delay);
    await sock.sendPresenceUpdate("paused", targetJid);
  } catch (error) {
    console.error("[WhatsApp] Falha ao enviar presenca composing:", error);
  }

  return delay;
}

/**
 * Simula presenca humana de gravacao de audio ('recording' por 4.0s a 7.0s antes de audio)
 */
export async function simulateRecordingPresence(
  sock: WASocket,
  jid: string,
  options?: DispatchOptions
): Promise<number> {
  if (options?.skipPresenceSimulation) return 0;

  const min = options?.minRecordingMs ?? 4000;
  const max = options?.maxRecordingMs ?? 7000;
  const delay = getRandomDelay(min, max);
  const targetJid = jid.includes("@") ? jid : `${jid.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    await sock.sendPresenceUpdate("recording", targetJid);
    await sleep(delay);
    await sock.sendPresenceUpdate("paused", targetJid);
  } catch (error) {
    console.error("[WhatsApp] Falha ao enviar presenca recording:", error);
  }

  return delay;
}

/**
 * Resolve Spintax ({A|B|C}) e interpola variaveis {{chave}} ou {chave} com aliases
 */
export function resolveSpintax(
  template: string,
  variables: Record<string, string | number | undefined | null> = {}
): string {
  let resolved = template;

  // Mapa de aliases e variaveis normalizadas
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    const val = value !== undefined && value !== null ? String(value) : "";
    vars[key] = val;
    if (key === "first_name") vars["primeiro_nome"] = val;
    if (key === "primeiro_nome") vars["first_name"] = val;
    if (key === "product_name") vars["produto"] = val;
    if (key === "produto") vars["product_name"] = val;
    if (key === "pix_code") vars["pix_copia_cola"] = val;
    if (key === "pix_copia_cola") vars["pix_code"] = val;
    if (key === "checkout_url") {
      if (!vars["link_checkout"]) vars["link_checkout"] = val;
      if (!vars["link_acesso"]) vars["link_acesso"] = val;
      if (!vars["link_upsell_1"]) vars["link_upsell_1"] = val;
      if (!vars["link_upsell_2"]) vars["link_upsell_2"] = val;
      if (!vars["link_downsell"]) vars["link_downsell"] = val;
    }
  }

  // 1. Interpola variaveis do template: {{chave}} e {chave}
  for (const [key, val] of Object.entries(vars)) {
    resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
    resolved = resolved.replace(new RegExp(`\\{${key}\\}`, "g"), val);
  }

  // 2. Resolve Spintax: {opcao1|opcao2|opcao3}
  const spintaxRegex = /\{([^{}]+)\}/;
  let safetyLoop = 0;
  while (safetyLoop++ < 200) {
    const match = spintaxRegex.exec(resolved);
    if (!match) break;
    if (match[1].includes("|")) {
      const choices = match[1].split("|");
      const chosen = choices[Math.floor(Math.random() * choices.length)];
      resolved = resolved.slice(0, match.index) + chosen + resolved.slice(match.index + match[0].length);
    } else {
      // Chave sem pipe nao reconhecida: remove para evitar loop infinito
      resolved = resolved.slice(0, match.index) + "" + resolved.slice(match.index + match[0].length);
    }
  }

  return resolved;
}

/**
 * Envia mensagem de texto com simulacao humana de digitacao ('composing')
 */
export async function sendTextMessage(
  sock: WASocket,
  jid: string,
  text: string,
  options?: DispatchOptions
): Promise<DispatchResult> {
  const startTime = Date.now();
  const targetJid = jid.includes("@") ? jid : `${jid.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    await simulateTypingPresence(sock, targetJid, options);

    options?.beforeSend?.();
    const sent = await sock.sendMessage(targetJid, {
      text,
    }, options?.messageId ? { messageId: options.messageId } : undefined);

    const durationMs = Date.now() - startTime;
    return {
      success: true,
      messageId: sent?.key.id ?? undefined,
      jid: targetJid,
      durationMs,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      jid: targetJid,
      durationMs: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Envia audio nativo no formato .ogg com codec Opus e ptt: true
 */
export async function sendAudioPtt(
  sock: WASocket,
  jid: string,
  audioPathOrBuffer: string | Buffer,
  options?: DispatchOptions
): Promise<DispatchResult> {
  const startTime = Date.now();
  const targetJid = jid.includes("@") ? jid : `${jid.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    let audioBuffer: Buffer;

    if (Buffer.isBuffer(audioPathOrBuffer)) {
      audioBuffer = audioPathOrBuffer;
    } else {
      let resolvedPath = path.isAbsolute(audioPathOrBuffer)
        ? audioPathOrBuffer
        : path.resolve(env.paths.mediaDir, audioPathOrBuffer);

      if (!fs.existsSync(resolvedPath)) {
        resolvedPath = path.resolve(process.cwd(), audioPathOrBuffer);
      }

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Arquivo de audio PTT nao encontrado no caminho: ${audioPathOrBuffer}`);
      }

      audioBuffer = await fs.promises.readFile(resolvedPath);
    }

    if (audioBuffer.length === 0) {
      throw new Error("Buffer de audio PTT esta vazio.");
    }

    // Simula gravacao humana de audio (4s a 7s)
    await simulateRecordingPresence(sock, targetJid, options);

    // Envio com codec Opus e parametro ptt: true obrigatorio
    options?.beforeSend?.();
    const sent = await sock.sendMessage(targetJid, {
      audio: audioBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    }, options?.messageId ? { messageId: options.messageId } : undefined);

    const durationMs = Date.now() - startTime;
    return {
      success: true,
      messageId: sent?.key.id ?? undefined,
      jid: targetJid,
      durationMs,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      jid: targetJid,
      durationMs: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Envia documento anexado (ex: PDFs de entrega do catalogo) com simulacao humana
 */
export async function sendDocumentMessage(
  sock: WASocket,
  jid: string,
  filePathOrBuffer: string | Buffer,
  fileName: string,
  mimetype = "application/pdf",
  caption?: string,
  options?: DispatchOptions
): Promise<DispatchResult> {
  const startTime = Date.now();
  const targetJid = jid.includes("@") ? jid : `${jid.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    let documentBuffer: Buffer;

    if (Buffer.isBuffer(filePathOrBuffer)) {
      documentBuffer = filePathOrBuffer;
    } else {
      let resolvedPath = path.isAbsolute(filePathOrBuffer)
        ? filePathOrBuffer
        : path.resolve(env.paths.mediaDir, filePathOrBuffer);

      if (!fs.existsSync(resolvedPath)) {
        resolvedPath = path.resolve(process.cwd(), filePathOrBuffer);
      }

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Arquivo de documento nao encontrado no caminho: ${filePathOrBuffer}`);
      }

      documentBuffer = await fs.promises.readFile(resolvedPath);
    }

    await simulateTypingPresence(sock, targetJid, options);

    options?.beforeSend?.();
    const sent = await sock.sendMessage(targetJid, {
      document: documentBuffer,
      mimetype,
      fileName,
      caption,
    }, options?.messageId ? { messageId: options.messageId } : undefined);

    const durationMs = Date.now() - startTime;
    return {
      success: true,
      messageId: sent?.key.id ?? undefined,
      jid: targetJid,
      durationMs,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      jid: targetJid,
      durationMs: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Utilitario para resolucao e verificacao da existencia fisica de arquivos de midia no disco
 */
export function resolveMediaFilePath(filePathOrName?: string | null): string | null {
  if (!filePathOrName || typeof filePathOrName !== "string") return null;
  const trimmed = filePathOrName.trim();
  if (!trimmed) return null;

  if (path.isAbsolute(trimmed)) {
    return fs.existsSync(trimmed) ? trimmed : null;
  }

  const inCwd = path.resolve(process.cwd(), trimmed);
  if (fs.existsSync(inCwd)) return inCwd;

  const inMediaDir = path.resolve(env.paths.mediaDir, trimmed);
  if (fs.existsSync(inMediaDir)) return inMediaDir;

  const inMediaDirBasename = path.resolve(env.paths.mediaDir, path.basename(trimmed));
  if (fs.existsSync(inMediaDirBasename)) return inMediaDirBasename;

  return null;
}

export function isMediaFileAvailable(filePathOrName?: string | null): boolean {
  return resolveMediaFilePath(filePathOrName) !== null;
}

export interface DispatchQueueJobOptions extends DispatchOptions {
  readonly customerRepo?: CustomerRepository;
  readonly queueRepo?: MessageQueueRepository;
  readonly auditRepo?: AuditLogRepository;
}

/**
 * Despacha um job pendente da tabela message_queue pelo socket WhatsApp
 */
export async function dispatchQueueJob(
  job: QueueJob,
  sock: WASocket,
  options?: DispatchQueueJobOptions
): Promise<DispatchResult> {
  const queueRepo = options?.queueRepo ?? messageQueueRepository;
  const auditRepo = options?.auditRepo ?? auditLogRepository;

  const isMarked = queueRepo.markAsProcessing(job.id);
  if (!isMarked && job.status !== "PROCESSING") {
    return {
      success: false,
      jid: job.jid || "",
      durationMs: 0,
      error: `Job ${job.id} nao pode ser colocado em status PROCESSING (status atual: ${job.status}).`,
    };
  }

  // Obtem ou resolve JID do destinatario
  let targetJid = job.jid;
  if (!targetJid || !targetJid.includes("@")) {
    const resolved = await resolveJid(job.phone, sock, {
      updateDatabase: true,
      customerRepo: options?.customerRepo,
      auditRepo: auditRepo,
    });
    targetJid = resolved.jid;
  }

  let result: DispatchResult;
  const msgTypeUpper = (job.message_type || "").toUpperCase();

  if (msgTypeUpper === "AUDIO_PTT") {
    const audioTarget = job.media_path || job.content;
    const resolvedAudio = resolveMediaFilePath(audioTarget);

    if (!resolvedAudio) {
      auditRepo.log("dispatcher", "MEDIA_MISSING_FALLBACK_TEXT", "message_queue", job.id, {
        level: "WARN",
        jobId: job.id,
        messageType: job.message_type,
        mediaPath: job.media_path,
        reason: "Arquivo de audio PTT inexistente no disco, realizando fallback para mensagem de texto",
        fallbackContent: job.content,
      });
      result = await sendTextMessage(sock, targetJid, job.content, options);
    } else {
      result = await sendAudioPtt(sock, targetJid, resolvedAudio, options);
    }
  } else if (msgTypeUpper === "DOCUMENT") {
    const docTarget = job.media_path || job.content;
    const resolvedDoc = resolveMediaFilePath(docTarget);

    if (!resolvedDoc) {
      auditRepo.log("dispatcher", "MEDIA_MISSING_FALLBACK_TEXT", "message_queue", job.id, {
        level: "WARN",
        jobId: job.id,
        messageType: job.message_type,
        mediaPath: job.media_path,
        reason: "Arquivo de documento inexistente no disco, realizando fallback para mensagem de texto",
        fallbackContent: job.content,
      });
      result = await sendTextMessage(sock, targetJid, job.content, options);
    } else {
      const fileName = path.basename(resolvedDoc);
      const caption = job.content !== docTarget ? job.content : undefined;
      result = await sendDocumentMessage(sock, targetJid, resolvedDoc, fileName, "application/pdf", caption, options);
    }
  } else {
    result = await sendTextMessage(sock, targetJid, job.content, options);
  }

  if (result.success) {
    queueRepo.markAsSent(job.id);
  } else {
    queueRepo.markAsFailed(job.id, result.error || "Falha desconhecida no despacho");
  }

  return result;
}
