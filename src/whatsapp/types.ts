import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { Customer, QueueJob } from "../database/repositories.js";

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

export type PairingCodeHandler = (code: string) => void | Promise<void>;

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
