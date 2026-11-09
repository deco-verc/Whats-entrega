import * as path from "node:path";
import * as fs from "node:fs";
import type { WASocket } from "@whiskeysockets/baileys";
import { env } from "../config/env.js";
import {
  Repositories,
  repositories as defaultRepositories,
  type QueueJob,
  type Customer,
} from "../database/repositories.js";
import {
  sleep,
  getRandomDelay,
  resolveJid,
  resolveSpintax,
  sendTextMessage,
  sendAudioPtt,
  sendDocumentMessage,
  type DispatchResult,
  type DispatchOptions,
} from "../whatsapp/dispatcher.js";

// ============================================================================
// Tipos e Interfaces do Worker de Fila
// ============================================================================

export interface QueueWorkerOptions {
  /**
   * Intervalo de checagem do banco em milissegundos (padrao: 5000ms = 5s)
   */
  readonly pollIntervalMs?: number;

  /**
   * Delay elastico minimo entre mensagens do mesmo lote (padrao: 3000ms = 3s)
   */
  readonly minJitterMs?: number;

  /**
   * Delay elastico maximo entre mensagens do mesmo lote (padrao: 6000ms = 6s)
   */
  readonly maxJitterMs?: number;

  /**
   * Numero maximo de tentativas por job antes de falha definitiva (padrao: 3)
   */
  readonly maxAttempts?: number;

  /**
   * Intervalo para retentativa em caso de erro transiente (padrao: 60s)
   */
  readonly retryDelaySeconds?: number;

  /**
   * Repositorios de banco injetaveis para isolamento em testes
   */
  readonly repos?: Repositories;

  /**
   * Opcoes adicionais de despacho (ex: pular presenca em testes unitarios)
   */
  readonly dispatchOptions?: DispatchOptions;

  /**
   * Socket Baileys ou funcao que retorna o socket ativo
   */
  readonly sock?: WASocket | (() => WASocket | null | undefined);

  /**
   * Se verdadeiro, inicia o loop imediatamente na instanciacao (padrao: false)
   */
  readonly autoStart?: boolean;
}

export interface WorkerStats {
  processedCount: number;
  sentCount: number;
  failedCount: number;
  lastRunTimestamp: string | null;
  lastProcessedJobId: string | null;
}

export interface ProcessJobResult {
  readonly job: QueueJob;
  readonly dispatchResult: DispatchResult;
  readonly durationMs: number;
  readonly jitterMs: number;
}

// ============================================================================
// Classe Principal: QueueWorker (Fila Indiana Anti-Banimento)
// ============================================================================

export class QueueWorker {
  private readonly pollIntervalMs: number;
  private readonly minJitterMs: number;
  private readonly maxJitterMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelaySeconds: number;
  private readonly repos: Repositories;
  private readonly dispatchOptions?: DispatchOptions;
  private readonly sockProvider?: WASocket | (() => WASocket | null | undefined);

  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;
  private lastCustomerId: string | null = null;

  private stats: WorkerStats = {
    processedCount: 0,
    sentCount: 0,
    failedCount: 0,
    lastRunTimestamp: null,
    lastProcessedJobId: null,
  };

  constructor(options: QueueWorkerOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.minJitterMs = options.minJitterMs ?? 3000;
    this.maxJitterMs = options.maxJitterMs ?? 6000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelaySeconds = options.retryDelaySeconds ?? 60;
    this.repos = options.repos ?? defaultRepositories;
    this.dispatchOptions = options.dispatchOptions;
    this.sockProvider = options.sock;

    if (options.autoStart) {
      this.start();
    }
  }

  /**
   * Inicia o loop de verificacao periodica (a cada 5 segundos)
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const scheduleNext = () => {
      if (!this.isRunning) return;
      this.timer = setTimeout(async () => {
        try {
          await this.processNextJob();
        } catch {
          // Captura silenciosa para manter o worker ativo
        } finally {
          if (this.isRunning) {
            scheduleNext();
          }
        }
      }, this.pollIntervalMs);
    };

    scheduleNext();
  }

  /**
   * Encerramento gracioso do worker
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Se estiver no meio do processamento de um job, aguarda conclusao
    let attempts = 0;
    while (this.isProcessing && attempts < 50) {
      await sleep(100);
      attempts++;
    }
  }

  /**
   * Processa estritamente 1 job vencido por vez (Fila Indiana)
   */
  public async processNextJob(referenceTime: Date = new Date()): Promise<ProcessJobResult | null> {
    if (this.isProcessing) {
      return null;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      // 1. Busca exatamente 1 job vencido com status PENDING
      const dueJobs = this.repos.messageQueue.findDueJobs(referenceTime, 1);
      if (dueJobs.length === 0) {
        return null;
      }

      const job = dueJobs[0];
      this.stats.lastProcessedJobId = job.id;
      this.stats.lastRunTimestamp = new Date().toISOString();

      // 2. Transiciona status: PENDING -> PROCESSING
      const marked = this.repos.messageQueue.markAsProcessing(job.id);
      if (!marked) {
        return null;
      }

      // 3. Resolve socket Baileys ativo
      const sock = this.resolveSocket();
      if (!sock) {
        const errorMsg = "Socket WhatsApp nao disponivel ou desconectado";
        this.repos.messageQueue.markAsFailed(
          job.id,
          errorMsg,
          this.maxAttempts,
          this.retryDelaySeconds
        );
        this.stats.failedCount++;
        return null;
      }

      // 4. Localiza cliente para interpolacao de variaveis Spintax
      const customer = this.repos.customers.findById(job.customer_id);
      const firstName = customer?.name ? customer.name.trim().split(/\s+/)[0] : "Cliente";

      const spintaxVariables: Record<string, string> = {
        first_name: firstName,
        primeiro_nome: firstName,
        name: customer?.name ?? firstName,
        phone: job.phone,
      };

      // 5. Motor Spintax: resolve variacoes dinamicas no momento do despacho
      const resolvedContent = resolveSpintax(job.content, spintaxVariables);

      // 6. Obtem ou valida o JID Meta
      let targetJid = job.jid;
      if (!targetJid || !targetJid.includes("@")) {
        try {
          const resolved = await resolveJid(job.phone, sock, {
            updateDatabase: true,
            customerRepo: this.repos.customers,
            auditRepo: this.repos.auditLogs,
          });
          targetJid = resolved.jid;
        } catch {
          targetJid = `${job.phone.replace(/\D/g, "")}@s.whatsapp.net`;
        }
      }

      // 7. Despacho conforme o tipo de mensagem com simulacao de presenca
      let dispatchResult: DispatchResult;

      const isAudio =
        job.message_type === "AUDIO_PTT" ||
        job.message_type === "audio_ptt" ||
        job.message_type.startsWith("PITCH_") && job.media_path?.endsWith(".ogg");

      const isDocument =
        job.message_type === "DOCUMENT" ||
        job.message_type === "document" ||
        job.message_type.startsWith("DELIVERY_") && job.media_path?.endsWith(".pdf");

      if (isAudio && job.media_path) {
        let resolvedAudio = path.isAbsolute(job.media_path)
          ? job.media_path
          : path.resolve(env.paths.mediaDir, job.media_path);
        if (!fs.existsSync(resolvedAudio)) {
          resolvedAudio = path.resolve(process.cwd(), job.media_path);
        }

        if (!fs.existsSync(resolvedAudio)) {
          this.repos.auditLogs.log(
            "QueueWorker",
            "MEDIA_FALLBACK_TEXT",
            "message_queue",
            job.id,
            {
              level: "WARN",
              reason: "Audio file not found on disk, falling back to text message",
              media_path: job.media_path,
              fallback_content: resolvedContent,
            }
          );
          dispatchResult = await sendTextMessage(sock, targetJid, resolvedContent, this.dispatchOptions);
        } else {
          dispatchResult = await sendAudioPtt(sock, targetJid, job.media_path, this.dispatchOptions);
        }
      } else if (isDocument && job.media_path) {
        const fileName = path.basename(job.media_path);
        const caption = job.content !== job.media_path ? resolvedContent : undefined;
        let resolvedDoc = path.isAbsolute(job.media_path)
          ? job.media_path
          : path.resolve(env.paths.mediaDir, job.media_path);
        if (!fs.existsSync(resolvedDoc)) {
          resolvedDoc = path.resolve(process.cwd(), job.media_path);
        }

        if (!fs.existsSync(resolvedDoc)) {
          this.repos.auditLogs.log(
            "QueueWorker",
            "MEDIA_FALLBACK_TEXT",
            "message_queue",
            job.id,
            {
              level: "WARN",
              reason: "Document file not found on disk, falling back to text message",
              media_path: job.media_path,
              fallback_content: caption || resolvedContent,
            }
          );
          const fallbackText = caption || resolvedContent || `Acesse seu material: ${job.media_path}`;
          dispatchResult = await sendTextMessage(sock, targetJid, fallbackText, this.dispatchOptions);
        } else {
          dispatchResult = await sendDocumentMessage(
            sock,
            targetJid,
            job.media_path,
            fileName,
            "application/pdf",
            caption,
            this.dispatchOptions
          );
        }
      } else {
        dispatchResult = await sendTextMessage(sock, targetJid, resolvedContent, this.dispatchOptions);
      }

      // 8. Atualiza resultado no banco de dados
      if (dispatchResult.success) {
        this.repos.messageQueue.markAsSent(job.id);
        this.stats.sentCount++;
      } else {
        this.repos.messageQueue.markAsFailed(
          job.id,
          dispatchResult.error ?? "Erro no despacho WhatsApp",
          this.maxAttempts,
          this.retryDelaySeconds
        );
        this.stats.failedCount++;
      }

      this.stats.processedCount++;

      // 9. Delay Elastico (Jitter Anti-Banimento entre 3s e 6s)
      const isSameCustomer = this.lastCustomerId === job.customer_id;
      const jitterMs = getRandomDelay(this.minJitterMs, this.maxJitterMs);
      this.lastCustomerId = job.customer_id;

      if (this.isRunning && jitterMs > 0) {
        await sleep(jitterMs);
      }

      return {
        job,
        dispatchResult,
        durationMs: Date.now() - startTime,
        jitterMs,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.stats.failedCount++;
      return null;
    } finally {
      this.isProcessing = false;
    }
  }

  public getStatus(): {
    readonly isRunning: boolean;
    readonly isProcessing: boolean;
    readonly stats: Readonly<WorkerStats>;
  } {
    return {
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      stats: { ...this.stats },
    };
  }

  private resolveSocket(): WASocket | null {
    if (!this.sockProvider) {
      return null;
    }
    if (typeof this.sockProvider === "function") {
      const s = this.sockProvider();
      return s ?? null;
    }
    return this.sockProvider;
  }
}

export function createQueueWorker(options?: QueueWorkerOptions): QueueWorker {
  return new QueueWorker(options);
}

export default QueueWorker;
