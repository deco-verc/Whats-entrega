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
import { messageQueueRepository } from "../database/repositories.js";

/**
 * Ciclo de vida da conexao WhatsApp Baileys
 * Estados canonicos:
 * DISCONNECTED | CONNECTING | QR_READY | PAIRING_CODE_READY | AUTHENTICATING | CONNECTED | RECONNECTING | LOGGED_OUT | ERROR
 * (IDLE mantido como compatibilidade retroativa)
 */
export type WhatsAppConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "QR_READY"
  | "PAIRING_CODE_READY"
  | "AUTHENTICATING"
  | "CONNECTED"
  | "RECONNECTING"
  | "LOGGED_OUT"
  | "ERROR"
  | "IDLE";

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
 * Previne sockets duplicados, mantem estado canonico e gerencia persistencia com seguranca.
 */
export class WhatsAppSocketManager {
  private sock: WASocket | null = null;
  private status: WhatsAppConnectionStatus = "IDLE";
  private qr: string | null = null;
  private pairingCode: string | null = null;
  private connectedPhone: string | null = null;
  private connectedAt: string | null = null;
  private lastDisconnectReason: string | null = null;
  private lastDisconnectCode: number | null = null;
  private lastError: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pairingCodeTimer: NodeJS.Timeout | null = null;
  private isExplicitDisconnect = false;
  private connectPromise: Promise<WASocket> | null = null;
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

  public getQr(): string | null {
    return this.qr;
  }

  public getPairingCode(): string | null {
    return this.pairingCode;
  }

  public getConnectedPhone(): string | null {
    return this.connectedPhone;
  }

  public getConnectedAt(): string | null {
    return this.connectedAt;
  }

  public getLastDisconnectReason(): string | null {
    return this.lastDisconnectReason;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getConnectionState(): {
    status: WhatsAppConnectionStatus;
    qr: string | null;
    pairingCode: string | null;
    connectedPhone: string | null;
  } {
    return {
      status: this.status,
      qr: this.qr,
      pairingCode: this.pairingCode,
      connectedPhone: this.connectedPhone,
    };
  }

  public getState(): {
    status: WhatsAppConnectionStatus;
    qr: string | null;
    pairingCode: string | null;
    connected: boolean;
  } {
    return {
      status: this.status,
      qr: this.qr,
      pairingCode: this.pairingCode,
      connected: this.isConnected(),
    };
  }

  public getConnectionDetails(): {
    status: WhatsAppConnectionStatus;
    connected: boolean;
    qr: string | null;
    pairing_code: string | null;
    pairingCode: string | null;
    connected_phone: string | null;
    connectedPhone: string | null;
    connected_at: string | null;
    last_disconnect_reason: string | null;
    last_disconnect_code: number | null;
    last_error: string | null;
    reconnect_attempts: number;
  } {
    return {
      status: this.status,
      connected: this.isConnected(),
      qr: this.qr,
      pairing_code: this.pairingCode,
      pairingCode: this.pairingCode,
      connected_phone: this.connectedPhone,
      connectedPhone: this.connectedPhone,
      connected_at: this.connectedAt,
      last_disconnect_reason: this.lastDisconnectReason,
      last_disconnect_code: this.lastDisconnectCode,
      last_error: this.lastError,
      reconnect_attempts: this.reconnectAttempts,
    };
  }

  public setQrForTesting(qr: string | null): void {
    this.qr = qr;
    if (qr) {
      this.setStatus("QR_READY");
    }
  }

  public setPairingCodeForTesting(code: string | null): void {
    this.pairingCode = code;
    if (code) {
      this.setStatus("PAIRING_CODE_READY");
    }
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
    if (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    for (const handler of this.statusHandlers) {
      try {
        void handler(newStatus, error);
      } catch (err) {
        console.error("[WhatsApp] Error in connection status handler:", err);
      }
    }
  }

  /**
   * Encerra com seguranca a instancia anterior do socket e remove listeners
   */
  public cleanExistingSocket(): void {
    if (this.sock) {
      try {
        if (typeof (this.sock.ev as any)?.removeAllListeners === "function") {
          (this.sock.ev as any).removeAllListeners();
        }
        this.sock.end(undefined);
      } catch {
        // Socket ja pode estar fechado
      }
      this.sock = null;
    }
  }

  /**
   * Cria backup seguro e carimbado da pasta de autenticacao antes de operacoes destrutivas
   */
  public backupAuthDir(authDir: string): string | null {
    try {
      if (!fs.existsSync(authDir)) return null;
      const backupBase = path.join(path.dirname(authDir), "backups");
      if (!fs.existsSync(backupBase)) {
        fs.mkdirSync(backupBase, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const destDir = path.join(backupBase, `auth_backup_${timestamp}`);
      fs.cpSync(authDir, destDir, { recursive: true });
      console.log(`[WhatsApp] Backup de sessao preservado em: ${destDir}`);
      return destDir;
    } catch (err) {
      console.warn("[WhatsApp] Falha ao criar backup de authDir:", err);
      return null;
    }
  }

  /**
   * Conecta ao WhatsApp com garantia de trava de concorrencia e limpeza previa de socket
   */
  public async connect(options: WhatsAppSocketOptions = {}): Promise<WASocket> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.doConnect(options).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private async doConnect(options: WhatsAppSocketOptions = {}): Promise<WASocket> {
    this.currentOptions = { ...this.currentOptions, ...options };
    this.isExplicitDisconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pairingCodeTimer) {
      clearTimeout(this.pairingCodeTimer);
      this.pairingCodeTimer = null;
    }

    this.cleanExistingSocket();

    ensureDataDirectoriesExist(env.paths);

    const authDir = options.authInfoDir || this.currentOptions.authInfoDir || env.paths.authInfoDir;
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    this.setStatus("CONNECTING");

    try {
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

      // Suporte a Pairing Code programado/automatico
      const pairingPhone = (options.pairingPhone || this.currentOptions.pairingPhone || env.whatsappPairingPhone || "").trim();
      if (!state.creds?.registered && pairingPhone.length >= 10) {
        const cleanPhone = pairingPhone.replace(/\D/g, "");
        const delayMs = options.pairingCodeDelayMs ?? 2000;
        this.pairingCodeTimer = setTimeout(async () => {
          try {
            if (this.sock && !this.sock.authState?.creds?.registered) {
              const pairingCode = await this.sock.requestPairingCode(cleanPhone);
              this.pairingCode = pairingCode;
              this.setStatus("PAIRING_CODE_READY");
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
        if (typeof this.pairingCodeTimer.unref === "function") {
          this.pairingCodeTimer.unref();
        }
      }

      // Monitoramento do ciclo de vida da conexao e reconexao resiliente
      sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qr = qr;
          this.setStatus("QR_READY");
          if (!pairingPhone && (options.printQrTerminal ?? false)) {
            console.log("[WhatsApp] QR Code emitido para pareamento no terminal");
          }
        }

        if (connection === "connecting") {
          if (this.status === "QR_READY" || this.status === "PAIRING_CODE_READY") {
            this.setStatus("AUTHENTICATING");
          } else {
            this.setStatus("CONNECTING");
          }
        } else if (connection === "open") {
          this.reconnectAttempts = 0;
          this.qr = null;
          this.pairingCode = null;
          this.lastDisconnectReason = null;
          this.lastDisconnectCode = null;
          this.lastError = null;
          this.connectedAt = new Date().toISOString();
          const userJid = sock.user?.id || "";
          this.connectedPhone = userJid.split(":")[0].replace(/\D/g, "") || null;
          this.setStatus("CONNECTED");
        } else if (connection === "close") {
          const boomError = lastDisconnect?.error as Boom | undefined;
          const statusCode = boomError?.output?.statusCode;
          this.lastDisconnectCode = statusCode ?? null;
          this.lastDisconnectReason = boomError?.message || (statusCode ? `Disconnect code ${statusCode}` : "Connection closed");

          const isLoggedOut = statusCode === DisconnectReason.loggedOut; // 401
          const isRestartRequired = statusCode === DisconnectReason.restartRequired; // 515
          const isConnectionReplaced = statusCode === 440;

          if (isLoggedOut) {
            this.qr = null;
            this.pairingCode = null;
            this.connectedPhone = null;
            this.cleanExistingSocket();
            this.setStatus("LOGGED_OUT", boomError);
            return;
          }

          if (isConnectionReplaced) {
            this.cleanExistingSocket();
            this.setStatus("DISCONNECTED", boomError);
            return;
          }

          if (isRestartRequired) {
            this.cleanExistingSocket();
            this.setStatus("RECONNECTING", boomError);
            setTimeout(() => {
              void this.connect(this.currentOptions);
            }, 500);
            return;
          }

          // Falhas transientes de rede (408 timedOut, 428 connectionClosed, 500 badSession, etc.)
          this.setStatus("RECONNECTING", boomError);
          if (!this.isExplicitDisconnect && (options.autoReconnect ?? true)) {
            this.scheduleReconnect();
          }
        }
      });

      // Escuta de mensagens recebidas (fromMe: false exclusivamente)
      sock.ev.on("messages.upsert", async ({ messages }) => {
        if (!messages || messages.length === 0) return;

        for (const msg of messages) {
          if (msg.key.fromMe) continue;

          const remoteJid = msg.key.remoteJid;
          if (!remoteJid) continue;

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

      // Escuta atualizacoes de status de mensagens enviadas (entrega / leitura)
      sock.ev.on("messages.update", async (updates) => {
        if (!updates || updates.length === 0) return;
        for (const update of updates) {
          const msgId = update.key?.id;
          const statusNum = typeof update.update?.status === "number" ? update.update.status : undefined;
          if (msgId && statusNum !== undefined && statusNum >= 3) {
            try {
              messageQueueRepository.markAsDelivered(msgId);
            } catch {
              // Ignora falha de banco concorrente
            }
          }
        }
      });

      // Escuta recibos de entrega
      sock.ev.on("message-receipt.update", async (receipts) => {
        if (!receipts || receipts.length === 0) return;
        for (const receipt of receipts) {
          const msgId = receipt.key?.id;
          if (msgId && receipt.receipt?.receiptTimestamp) {
            try {
              messageQueueRepository.markAsDelivered(msgId);
            } catch {
              // Ignora falha de banco concorrente
            }
          }
        }
      });

      return sock;
    } catch (error: any) {
      this.lastError = error?.message || String(error);
      this.setStatus("ERROR", error);
      throw error;
    }
  }

  /**
   * Forca geracao de novo QR Code encerrando socket anterior e iniciando novo ciclo
   */
  public async refreshQr(): Promise<string | null> {
    this.cleanExistingSocket();
    this.qr = null;
    this.pairingCode = null;
    this.reconnectAttempts = 0;
    await this.connect({
      ...this.currentOptions,
      pairingPhone: undefined,
    });
    return this.qr;
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
   * Solicita o codigo de pareamento de 8 digitos do Baileys para o telefone informado
   */
  public async requestPairingCode(phone: string): Promise<string> {
    const cleanPhone = (phone || "").replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      throw new Error("Telefone invalido para pareamento. Forneca DDD + Numero (minimo 10 digitos).");
    }

    if (this.isConnected() && this.sock?.authState?.creds?.registered) {
      throw new Error("WhatsApp ja esta autenticado e conectado.");
    }

    // Se o socket nao existir ou estiver desligado, inicia o socket
    if (!this.sock || this.status === "IDLE" || this.status === "DISCONNECTED" || this.status === "LOGGED_OUT") {
      await this.connect({
        ...this.currentOptions,
        pairingPhone: cleanPhone,
      });
    }

    if (!this.sock) {
      throw new Error("Falha ao inicializar socket WhatsApp.");
    }

    if (this.sock.authState?.creds?.registered) {
      throw new Error("WhatsApp ja possui credenciais registradas.");
    }

    if (this.pairingCodeTimer) {
      clearTimeout(this.pairingCodeTimer);
      this.pairingCodeTimer = null;
    }

    const code = await this.sock.requestPairingCode(cleanPhone);
    this.pairingCode = code;
    this.setStatus("PAIRING_CODE_READY");

    for (const handler of this.pairingCodeHandlers) {
      try {
        void handler(code);
      } catch (handlerErr) {
        console.error("[WhatsApp] Erro no handler de pairing code:", handlerErr);
      }
    }

    return code;
  }

  /**
   * Encerramento gracioso da conexao Baileys sem deletar credenciais
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

    this.cleanExistingSocket();

    this.qr = null;
    this.pairingCode = null;
    this.connectedPhone = null;
    this.reconnectAttempts = 0;
    this.setStatus("DISCONNECTED");
  }

  /**
   * Encerra a sessao do WhatsApp, faz backup preventivo e limpa credenciais para novo pareamento
   */
  public async logout(): Promise<void> {
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
        await this.sock.logout();
      } catch {
        try {
          this.sock.end(undefined);
        } catch {
          // Socket ja pode estar fechado
        }
      }
      this.sock = null;
    }

    const authDir = this.currentOptions.authInfoDir || env.paths.authInfoDir;
    try {
      this.backupAuthDir(authDir);
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
        fs.mkdirSync(authDir, { recursive: true });
      }
    } catch (err) {
      console.warn("[WhatsApp] Falha ao limpar authInfoDir no logout:", err);
    }

    this.qr = null;
    this.pairingCode = null;
    this.connectedPhone = null;
    this.connectedAt = null;
    this.reconnectAttempts = 0;
    this.setStatus("LOGGED_OUT");
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

export function getWhatsAppConnectionState(): {
  status: WhatsAppConnectionStatus;
  qr: string | null;
  pairingCode: string | null;
  connectedPhone: string | null;
} {
  return whatsappManager.getConnectionState();
}

export function getWhatsAppConnectionDetails() {
  return whatsappManager.getConnectionDetails();
}

export function getWhatsAppQr(): string | null {
  return whatsappManager.getQr();
}

export function getWhatsAppPairingCode(): string | null {
  return whatsappManager.getPairingCode();
}

export async function requestWhatsAppPairingCode(phone: string): Promise<string> {
  return whatsappManager.requestPairingCode(phone);
}

export async function refreshWhatsAppQr(): Promise<string | null> {
  return whatsappManager.refreshQr();
}

export async function disconnectWhatsApp(): Promise<void> {
  return whatsappManager.disconnect();
}

export async function logoutWhatsApp(): Promise<void> {
  return whatsappManager.logout();
}

export default whatsappManager;
