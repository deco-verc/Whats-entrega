import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  type WASocket,
  type ConnectionState,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { env, ensureDataDirectoriesExist } from "../config/env.js";

/**
 * Ciclo de vida da conexao WhatsApp Baileys
 */
export type WhatsAppConnectionStatus =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "LOGGED_OUT";

export type PairingCodeHandler = (code: string) => void | Promise<void>;

/**
 * Opcoes configuraveis para o socket Baileys
 */
export interface WhatsAppSocketOptions {
  readonly authInfoDir?: string;
  readonly pairingPhone?: string;
  readonly printQrTerminal?: boolean;
  readonly autoReconnect?: boolean;
  readonly maxReconnectAttempts?: number;
  readonly baseReconnectDelayMs?: number;
  readonly maxReconnectDelayMs?: number;
  readonly pairingCodeDelayMs?: number;
  readonly onPairingCode?: PairingCodeHandler;
  readonly logLevel?: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readonly socketFactory?: (config: any) => WASocket;
  readonly authStateLoader?: (dir: string) => Promise<{ state: any; saveCreds: () => Promise<void> }>;
}

/**
 * Mensagem recebida filtrada (fromMe: false)
 */
export interface InboundWhatsAppMessage {
  readonly id: string;
  readonly fromJid: string;
  readonly senderPhone: string;
  readonly senderName?: string;
  readonly text: string;
  readonly timestamp: number;
  readonly isGroup: boolean;
  readonly rawMessage: WAMessage;
}

export type InboundMessageHandler = (
  message: InboundWhatsAppMessage,
  sock: WASocket
) => void | Promise<void>;

export type ConnectionStatusHandler = (
  status: WhatsAppConnectionStatus,
  error?: Error | unknown
) => void | Promise<void>;

/**
 * Extrai texto util de diferentes formatos de mensagens do Baileys
 */
export function extractMessageText(msg: WAMessage): string {
  let m = msg.message;
  if (!m) return "";

  // Desempacota mensagens envolvidas em estruturas efemeras ou de visualizacao unica
  if (m.ephemeralMessage?.message) {
    m = m.ephemeralMessage.message;
  }
  if (m.viewOnceMessage?.message) {
    m = m.viewOnceMessage.message;
  }
  if (m.viewOnceMessageV2?.message) {
    m = m.viewOnceMessageV2.message;
  }
  if (m.documentWithCaptionMessage?.message) {
    m = m.documentWithCaptionMessage.message;
  }

  if (m.conversation) {
    return m.conversation.trim();
  }
  if (m.extendedTextMessage?.text) {
    return m.extendedTextMessage.text.trim();
  }
  if (m.imageMessage?.caption) {
    return m.imageMessage.caption.trim();
  }
  if (m.videoMessage?.caption) {
    return m.videoMessage.caption.trim();
  }
  if (m.documentMessage?.caption) {
    return m.documentMessage.caption.trim();
  }
  if (m.buttonsResponseMessage?.selectedButtonId) {
    return m.buttonsResponseMessage.selectedButtonId.trim();
  }
  if (m.templateButtonReplyMessage?.selectedId) {
    return m.templateButtonReplyMessage.selectedId.trim();
  }
  if (m.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return m.listResponseMessage.singleSelectReply.selectedRowId.trim();
  }

  return "";
}

/**
 * Gerenciador do ciclo de vida da conexao WhatsApp Baileys
 */
export class WhatsAppSocketManager {
  private sock: WASocket | null = null;
  private status: WhatsAppConnectionStatus = "IDLE";
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pairingCodeTimer: NodeJS.Timeout | null = null;
  private isExplicitDisconnect = false;
  private readonly messageHandlers = new Set<InboundMessageHandler>();
  private readonly statusHandlers = new Set<ConnectionStatusHandler>();
  private readonly pairingCodeHandlers = new Set<PairingCodeHandler>();
  private currentOptions: WhatsAppSocketOptions = {};

  public getStatus(): WhatsAppConnectionStatus {
    return this.status;
  }

  public getSocket(): WASocket | null {
    return this.sock;
  }

  public isConnected(): boolean {
    return this.status === "CONNECTED" && this.sock !== null;
  }

  public onMessage(handler: InboundMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  public onConnectionChange(handler: ConnectionStatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  public onPairingCode(handler: PairingCodeHandler): () => void {
    this.pairingCodeHandlers.add(handler);
    return () => this.pairingCodeHandlers.delete(handler);
  }

  private setStatus(newStatus: WhatsAppConnectionStatus, error?: unknown): void {
    this.status = newStatus;
    for (const handler of this.statusHandlers) {
      try {
        void handler(newStatus, error);
      } catch (err) {
        console.error("[WhatsApp] Error in connection status handler:", err);
      }
    }
  }

  /**
   * Inicializa o ciclo de vida Baileys com useMultiFileAuthState e suporte a Pairing Code
   */
  public async connect(options: WhatsAppSocketOptions = {}): Promise<WASocket> {
    this.currentOptions = options;
    this.isExplicitDisconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pairingCodeTimer) {
      clearTimeout(this.pairingCodeTimer);
      this.pairingCodeTimer = null;
    }

    ensureDataDirectoriesExist(env.paths);

    const authDir = options.authInfoDir || env.paths.authInfoDir;
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    this.setStatus("CONNECTING");

    const loadAuth = options.authStateLoader ?? useMultiFileAuthState;
    const { state, saveCreds } = await loadAuth(authDir);

    const logLevel = options.logLevel ?? (env.logLevel === "debug" || env.logLevel === "trace" ? env.logLevel : "silent");
    const logger = pino({ level: logLevel });

    const defaultFactory = (makeWASocket as unknown as { default?: typeof makeWASocket }).default ?? makeWASocket;
    const createSocket = options.socketFactory ?? defaultFactory;
    const sock = createSocket({
      auth: state,
      logger,
      printQRInTerminal: options.printQrTerminal ?? false,
      browser: Browsers.appropriate("DirectResponse"),
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
    });

    this.sock = sock;

    // Persistencia automatica de credenciais
    sock.ev.on("creds.update", saveCreds);

    // Suporte a Pairing Code no terminal para conexao sem QR code
    const pairingPhone = (options.pairingPhone || env.whatsappPairingPhone || "").trim();
    if (!state.creds.registered && pairingPhone.length >= 10) {
      const cleanPhone = pairingPhone.replace(/\D/g, "");
      const delayMs = options.pairingCodeDelayMs ?? 2000;
      this.pairingCodeTimer = setTimeout(async () => {
        try {
          if (this.sock && !this.sock.authState.creds.registered) {
            const pairingCode = await this.sock.requestPairingCode(cleanPhone);
            console.log("------------------------------------------");
            console.log(`[WhatsApp] PAIRING CODE GERADO: ${pairingCode}`);
            console.log(`[WhatsApp] Insira no WhatsApp (Aparelhos conectados > Conectar com numero de telefone)`);
            console.log("------------------------------------------");

            if (options.onPairingCode) {
              void options.onPairingCode(pairingCode);
            }
            for (const handler of this.pairingCodeHandlers) {
              try {
                void handler(pairingCode);
              } catch (handlerErr) {
                console.error("[WhatsApp] Erro no handler de pairing code:", handlerErr);
              }
            }
          }
        } catch (error) {
          console.error("[WhatsApp] Falha ao solicitar Pairing Code:", error);
        }
      }, delayMs);
    }

    // Monitoramento do ciclo de vida da conexao e reconexao resiliente
    sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !pairingPhone && (options.printQrTerminal ?? false)) {
        console.log("[WhatsApp] QR Code emitido para pareamento no terminal");
      }

      if (connection === "open") {
        this.reconnectAttempts = 0;
        this.setStatus("CONNECTED");
      } else if (connection === "close") {
        const boomError = lastDisconnect?.error as Boom | undefined;
        const statusCode = boomError?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        if (isLoggedOut) {
          this.setStatus("LOGGED_OUT", boomError);
          return;
        }

        this.setStatus("DISCONNECTED", boomError);

        if (!this.isExplicitDisconnect && (options.autoReconnect ?? true)) {
          this.scheduleReconnect();
        }
      } else if (connection === "connecting") {
        this.setStatus("CONNECTING");
      }
    });

    // Escuta de mensagens recebidas (fromMe: false exclusivamente)
    sock.ev.on("messages.upsert", async ({ messages }) => {
      if (!messages || messages.length === 0) return;

      for (const msg of messages) {
        // Ignora mensagens enviadas pelo proprio bot
        if (msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) continue;

        // Ignora status de broadcast e canais de newsletter
        if (remoteJid.includes("broadcast") || remoteJid.includes("@newsletter")) {
          continue;
        }

        const text = extractMessageText(msg);
        const senderPhone = remoteJid.replace(/@.*$/, "").replace(/\D/g, "");
        const isGroup = remoteJid.endsWith("@g.us");

        const inboundMessage: InboundWhatsAppMessage = {
          id: msg.key.id || randomUUID(),
          fromJid: remoteJid,
          senderPhone,
          senderName: msg.pushName || undefined,
          text,
          timestamp: typeof msg.messageTimestamp === "number" ? msg.messageTimestamp * 1000 : Date.now(),
          isGroup,
          rawMessage: msg,
        };

        for (const handler of this.messageHandlers) {
          try {
            await handler(inboundMessage, sock);
          } catch (handlerError) {
            console.error("[WhatsApp] Erro no handler de mensagem recebida:", handlerError);
          }
        }
      }
    });

    return sock;
  }

  /**
   * Agenda reconexao automatica com backoff exponencial e jitter
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const maxAttempts = this.currentOptions.maxReconnectAttempts ?? 10;
    this.reconnectAttempts += 1;

    if (this.reconnectAttempts > maxAttempts) {
      console.warn(`[WhatsApp] Limite maximo de tentativas (${maxAttempts}) atingido. Reconexao pausada.`);
      return;
    }

    const baseDelay = this.currentOptions.baseReconnectDelayMs ?? 3000;
    const maxDelay = this.currentOptions.maxReconnectDelayMs ?? 30000;
    const jitter = Math.floor(Math.random() * 1000);
    const calculatedDelay = Math.min(baseDelay * Math.pow(1.5, this.reconnectAttempts - 1), maxDelay) + jitter;

    this.setStatus("RECONNECTING");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.currentOptions).catch((err) => {
        console.error("[WhatsApp] Falha na retentativa de reconexao:", err);
      });
    }, calculatedDelay);
  }

  /**
   * Encerramento gracioso da conexao Baileys
   */
  public async disconnect(): Promise<void> {
    this.isExplicitDisconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pairingCodeTimer) {
      clearTimeout(this.pairingCodeTimer);
      this.pairingCodeTimer = null;
    }

    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // Socket ja pode estar fechado
      }
      this.sock = null;
    }

    this.reconnectAttempts = 0;
    this.setStatus("IDLE");
  }
}

// Instancia singleton global
export const whatsappManager = new WhatsAppSocketManager();

export async function initWhatsAppSocket(options: WhatsAppSocketOptions = {}): Promise<WASocket> {
  return whatsappManager.connect(options);
}

export function getWhatsAppSocket(): WASocket | null {
  return whatsappManager.getSocket();
}

export function getWhatsAppConnectionStatus(): WhatsAppConnectionStatus {
  return whatsappManager.getStatus();
}

export async function disconnectWhatsApp(): Promise<void> {
  return whatsappManager.disconnect();
}

export default whatsappManager;
