import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { env, validatePort, ensureDataDirectoriesExist } from "./config/env.js";
import { initDatabase, closeDatabase } from "./database/connection.js";
import { MessageQueueRepository, seedFunnelTemplates } from "./database/repositories.js";
import {
  initWhatsAppSocket,
  disconnectWhatsApp,
  getWhatsAppSocket,
  getWhatsAppConnectionStatus,
  whatsappManager,
} from "./whatsapp/socket.js";
import { startWebhookServer } from "./webhooks/server.js";
import { QueueWorker, createQueueWorker } from "./engine/worker.js";
import { funnelStateMachine } from "./engine/state-machine.js";
import { resolveBrazilianPhoneCandidates } from "./whatsapp/dispatcher.js";

// ============================================================================
// Tipos e Interfaces do Entrypoint
// ============================================================================

export interface AppInstance {
  readonly httpServer: http.Server;
  readonly worker: QueueWorker;
  readonly stop: () => Promise<void>;
}

export interface BootstrapOptions {
  readonly startHttpServer?: boolean;
  readonly startWorker?: boolean;
  readonly startWhatsApp?: boolean;
  readonly port?: number;
  readonly host?: string;
  readonly pollIntervalMs?: number;
}

// ============================================================================
// Orquestrador do Sistema (Bootstrap & Lifecycle)
// ============================================================================

export async function bootstrap(options: BootstrapOptions = {}): Promise<AppInstance> {
  const shouldStartHttp = options.startHttpServer ?? true;
  const shouldStartWorker = options.startWorker ?? true;
  const shouldStartWhatsApp = options.startWhatsApp ?? (env.nodeEnv !== "test");

  console.log("[System] Inicializando diretorios de persistencia...");
  ensureDataDirectoriesExist();

  console.log("[System] Conectando ao SQLite (WAL Mode)...");
  const db = initDatabase();
  if (shouldStartWorker) {
    new MessageQueueRepository(db).recoverInterrupted();
  }
  seedFunnelTemplates();

  // 1. Inicializacao do WhatsApp Baileys
  if (shouldStartWhatsApp) {
    try {
      console.log("[System] Inicializando cliente WhatsApp Baileys...");
      await initWhatsAppSocket({
        pairingPhone: env.whatsappPairingPhone,
      });

      // Escuta mensagens recebidas de clientes para o gatilho de micro-comprometimento
      whatsappManager.onMessage(async (inbound) => {
        if (!inbound.text || inbound.isGroup) return;

        try {
          if (/^(?:sair|parar|stop|descadastrar|cancelar mensagens)[.!\s]*$/i.test(inbound.text.trim())) {
            const address = [inbound.fromJid, inbound.rawMessage.key.remoteJidAlt].find((jid) => jid?.endsWith("@s.whatsapp.net"));
            if (address) {
              const { candidates } = resolveBrazilianPhoneCandidates(address.split("@")[0].split(":")[0]);
              db.transaction(() => {
                const insert = db.prepare("INSERT OR IGNORE INTO whatsapp_opt_out (phone) VALUES (?)");
                for (const phone of candidates) insert.run(phone);
              })();
            }
            return;
          }
          const result = funnelStateMachine.handleInboundMessage({
            phoneOrJid: inbound.fromJid,
            text: inbound.text,
            timestamp: new Date(inbound.timestamp),
          });

          if (result.rescheduledJobsCount > 0) {
            console.log(
              `[Funnel] Micro-comprometimento detectado para cliente ${result.customerId}. ${result.rescheduledJobsCount} jobs antecipados para imediato.`
            );
          }
        } catch (msgErr) {
          console.error("[Funnel] Erro ao processar mensagem inbound:", msgErr);
        }
      });
    } catch (wsErr) {
      console.warn("[System] Aviso: WhatsApp Baileys nao conectado no boot (modo offline/resiliente):", wsErr);
    }
  }

  const portCandidate = options.port ?? (process.env.PORT ? Number(process.env.PORT) : env.port);
  const effectivePort = validatePort(portCandidate);
  const effectiveHost = options.host ?? process.env.HOST ?? env.host;

  // 2. Inicializacao do Servidor HTTP de Webhooks Cakto
  let httpServer: http.Server | null = null;
  let worker: QueueWorker;
  if (shouldStartHttp) {
    console.log(`[System] Inicializando servidor HTTP de Webhooks na porta ${effectivePort}...`);
    httpServer = await startWebhookServer({
      port: effectivePort,
      host: effectiveHost,
      sock: () => getWhatsAppSocket(),
      diagnostics: () => worker?.getStatus() ?? null,
    });
    console.log(`[System] Servidor HTTP ativo na porta ${effectivePort}`);
  } else {
    // Servidor dummy para instancias de teste que nao sobem porta real
    httpServer = http.createServer((_req, res) => res.end("ok"));
  }

  // 3. Inicializacao do Worker de Fila Anti-Banimento
  console.log("[System] Inicializando Worker de Fila Anti-Banimento...");
  worker = createQueueWorker({
    pollIntervalMs: options.pollIntervalMs ?? 5000,
    sock: () => getWhatsAppSocket(),
    autoStart: shouldStartWorker,
  });

  if (shouldStartWorker) {
    console.log("[System] Worker de Fila iniciado com intervalo de 5s.");
  }

  // Funcao de encerramento gracioso
  const stop = async () => {
    console.log("[System] Encerrando aplicacao de forma graciosa...");
    try {
      await worker.stop();
    } catch (workerErr) {
      console.error("[System] Erro ao parar worker:", workerErr);
    }

    try {
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
      }
    } catch (httpErr) {
      console.error("[System] Erro ao fechar servidor HTTP:", httpErr);
    }

    try {
      await disconnectWhatsApp();
    } catch (waErr) {
      console.error("[System] Erro ao desconectar WhatsApp:", waErr);
    }

    try {
      closeDatabase();
    } catch (dbErr) {
      console.error("[System] Erro ao fechar banco SQLite:", dbErr);
    }

    console.log("[System] Encerramento gracioso finalizado.");
  };

  return {
    httpServer,
    worker,
    stop,
  };
}

// ============================================================================
// Execucao Direta do Entrypoint
// ============================================================================

export function isDirectExecution(argv1?: string, moduleUrl?: string): boolean {
  if (process.env.pm_id !== undefined) {
    return true;
  }
  if (!argv1) return false;
  try {
    if (moduleUrl) {
      const currentFilePath = fileURLToPath(moduleUrl);
      if (path.resolve(argv1) === path.resolve(currentFilePath)) {
        return true;
      }
    }
  } catch {
    // Parser fallback
  }

  const normalized = path.resolve(argv1).replace(/\\/g, "/");
  return (
    normalized.endsWith("/src/index.ts") ||
    normalized.endsWith("/src/index.js") ||
    normalized.endsWith("/dist/src/index.js") ||
    normalized.endsWith("/dist/index.js") ||
    normalized.includes("ProcessContainer")
  );
}

const isDirectRun = isDirectExecution(process.argv[1], import.meta.url);

if (isDirectRun) {
  bootstrap()
    .then((instance) => {
      const activePort = process.env.PORT ? validatePort(process.env.PORT) : env.port;
      console.log("==================================================");
      console.log("WhatsappEntrega MVP iniciado com sucesso!");
      console.log(`Porta HTTP: ${activePort}`);
      console.log(`Status WhatsApp: ${getWhatsAppConnectionStatus()}`);
      console.log("==================================================");

      if (typeof process.send === "function") {
        process.send("ready");
      }

      const handleSignal = async (signal: string) => {
        console.log(`\n[System] Sinal ${signal} recebido.`);
        await instance.stop();
        process.exit(0);
      };

      process.on("SIGINT", () => void handleSignal("SIGINT"));
      process.on("SIGTERM", () => void handleSignal("SIGTERM"));
    })
    .catch((err) => {
      console.error("[System] Falha critica na inicializacao:", err);
      process.exit(1);
    });
}

export default bootstrap;
