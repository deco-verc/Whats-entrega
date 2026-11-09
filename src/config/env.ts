import * as fs from "node:fs";
import * as path from "node:path";
import dotenv from "dotenv";
import Database from "better-sqlite3";

dotenv.config();

export interface StoragePaths {
  readonly dataDir: string;
  readonly authInfoDir: string;
  readonly databaseDir: string;
  readonly databaseFile: string;
  readonly mediaDir: string;
}

export interface EnvConfig {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: "development" | "production" | "test";
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  readonly caktoWebhookSecret: string;
  readonly whatsappPairingPhone: string;
  readonly paths: StoragePaths;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
}

const FORBIDDEN_PORTS = [3000, 3001, 5173] as const;

export function validatePort(rawPort?: unknown): number {
  if (rawPort === undefined || rawPort === null || rawPort === "") {
    return 4000;
  }
  const port = Number(rawPort);
  if (!Number.isFinite(port) || !Number.isInteger(port)) {
    throw new Error(`Invalid PORT configuration: "${rawPort}" must be a valid integer.`);
  }
  if (FORBIDDEN_PORTS.includes(port as typeof FORBIDDEN_PORTS[number])) {
    throw new Error(
      `PORT ${port} is strictly forbidden by PORT_GUARD (reserved for DecoHUB infrastructure). Use port in range 4000-4999.`
    );
  }
  if (port < 4000 || port > 4999) {
    throw new Error(
      `PORT ${port} is out of safe range (PORT_GUARD requires 4000-4999). Received: ${port}.`
    );
  }
  return port;
}

export function validateNodeEnv(rawEnv?: string): "development" | "production" | "test" {
  if (!rawEnv) return "development";
  const normalized = rawEnv.trim().toLowerCase();
  if (normalized === "production" || normalized === "test" || normalized === "development") {
    return normalized;
  }
  throw new Error(`Invalid NODE_ENV: "${rawEnv}". Expected 'development', 'production', or 'test'.`);
}

export function validateLogLevel(rawLevel?: string): "fatal" | "error" | "warn" | "info" | "debug" | "trace" {
  const validLogLevels = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
  if (!rawLevel) return "info";
  const normalized = rawLevel.trim().toLowerCase();
  if (validLogLevels.includes(normalized as typeof validLogLevels[number])) {
    return normalized as typeof validLogLevels[number];
  }
  throw new Error(`Invalid LOG_LEVEL: "${rawLevel}". Expected one of: ${validLogLevels.join(", ")}.`);
}

export function validateCaktoSecret(rawSecret: string | undefined, isProduction: boolean): string {
  if (!rawSecret || rawSecret.trim().length === 0) {
    if (isProduction) {
      throw new Error(
        "Fail-fast: Missing required environment variable CAKTO_WEBHOOK_SECRET in production environment."
      );
    }
    return "dev_cakto_webhook_secret";
  }
  return rawSecret.trim();
}

export function validatePairingPhone(rawPhone?: string): string {
  if (!rawPhone || rawPhone.trim().length === 0) {
    return "";
  }
  const digitsOnly = rawPhone.replace(/\D/g, "");
  if (digitsOnly.length > 0 && (digitsOnly.length < 10 || digitsOnly.length > 15)) {
    throw new Error(
      `Fail-fast: Invalid WHATSAPP_PAIRING_PHONE "${rawPhone}". Expected between 10 and 15 numeric digits.`
    );
  }
  return digitsOnly;
}

export function resolvePaths(): StoragePaths {
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, process.env.DATA_DIR || "data");
  const authInfoDir = path.resolve(
    dataDir,
    process.env.AUTH_INFO_DIR ? path.basename(process.env.AUTH_INFO_DIR) : "auth_info"
  );
  const databaseDir = path.resolve(
    dataDir,
    process.env.DATABASE_DIR ? path.basename(process.env.DATABASE_DIR) : "database"
  );
  const databaseFile = path.resolve(
    databaseDir,
    process.env.DATABASE_FILE ? path.basename(process.env.DATABASE_FILE) : "funnel.db"
  );
  const mediaDir = path.resolve(
    dataDir,
    process.env.MEDIA_DIR ? path.basename(process.env.MEDIA_DIR) : "media"
  );

  return {
    dataDir,
    authInfoDir,
    databaseDir,
    databaseFile,
    mediaDir,
  };
}

export function ensurePlaceholderMediaExist(mediaDir: string = env.paths.mediaDir): void {
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  const dummyPdf = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n";
  const dummyOgg = Buffer.from([
    0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x13,
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x01, 0x00, 0x00,
    0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);

  const pdfFiles = [
    "guia_definitivo_alta_conversao.pdf",
    "entrega.pdf",
    "pack_templates_acelerador.pdf",
    "masterclass_escala_acesso.pdf",
    "pack_templates_essenciais.pdf",
  ];

  const oggFiles = [
    "pitch_upsell_1.ogg",
    "pitch_upsell_2.ogg",
    "pitch_downsell.ogg",
    "audio_pitch.ogg",
  ];

  for (const fileName of pdfFiles) {
    const fullPath = path.join(mediaDir, fileName);
    if (!fs.existsSync(fullPath)) {
      try {
        fs.writeFileSync(fullPath, dummyPdf, "utf-8");
      } catch {
        // Ignora erro se nao puder gravar
      }
    }
  }

  for (const fileName of oggFiles) {
    const fullPath = path.join(mediaDir, fileName);
    if (!fs.existsSync(fullPath)) {
      try {
        fs.writeFileSync(fullPath, dummyOgg);
      } catch {
        // Ignora erro se nao puder gravar
      }
    }
  }
}

export function ensureEnvExampleExists(): void {
  const envExamplePath = path.resolve(process.cwd(), ".env.example");
  if (!fs.existsSync(envExamplePath)) {
    const content = `# Servidor HTTP e Ambiente
PORT=4000
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# Seguranca e Integracao Cakto
CAKTO_WEBHOOK_SECRET=dev_cakto_webhook_secret

# WhatsApp Baileys Conexao
WHATSAPP_PAIRING_PHONE=5511999999999

# Diretorios de Armazenamento Local
DATA_DIR=./data
AUTH_INFO_DIR=./data/auth_info
DATABASE_DIR=./data/database
DATABASE_FILE=./data/database/funnel.db
MEDIA_DIR=./data/media
`;
    try {
      fs.writeFileSync(envExamplePath, content, "utf-8");
    } catch {
      // Ignora erro de gravacao
    }
  }
}

export function ensureDataDirectoriesExist(paths: StoragePaths = env.paths): void {
  const dirs = [
    paths.dataDir,
    paths.authInfoDir,
    paths.databaseDir,
    paths.mediaDir,
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  ensurePlaceholderMediaExist(paths.mediaDir);
  ensureEnvExampleExists();
}

export function initSqliteDatabase(dbFilePath: string = env.paths.databaseFile): Database.Database {
  ensureDataDirectoriesExist(env.paths);
  const db = new Database(dbFilePath);
  db.pragma("journal_mode = WAL;");
  db.pragma("synchronous = NORMAL;");
  return db;
}

export function validateEnvConfig(candidate: EnvConfig): void {
  validatePort(candidate.port);
  validateNodeEnv(candidate.nodeEnv);
  validateLogLevel(candidate.logLevel);
  if (candidate.isProduction && (!candidate.caktoWebhookSecret || candidate.caktoWebhookSecret.trim().length === 0)) {
    throw new Error("Fail-fast: Missing required environment variable CAKTO_WEBHOOK_SECRET in production.");
  }
  validatePairingPhone(candidate.whatsappPairingPhone);
}

function buildEnvConfig(): EnvConfig {
  const nodeEnv = validateNodeEnv(process.env.NODE_ENV);
  const isProduction = nodeEnv === "production";
  const isDevelopment = nodeEnv === "development";
  const isTest = nodeEnv === "test";

  const host = process.env.HOST || "0.0.0.0";
  const port = validatePort(process.env.PORT);
  const logLevel = validateLogLevel(process.env.LOG_LEVEL);
  const caktoWebhookSecret = validateCaktoSecret(process.env.CAKTO_WEBHOOK_SECRET, isProduction);
  const whatsappPairingPhone = validatePairingPhone(process.env.WHATSAPP_PAIRING_PHONE);
  const paths = resolvePaths();

  const cfg: EnvConfig = {
    port,
    host,
    nodeEnv,
    logLevel,
    caktoWebhookSecret,
    whatsappPairingPhone,
    paths,
    isProduction,
    isDevelopment,
    isTest,
  };

  validateEnvConfig(cfg);
  return cfg;
}

export const env: EnvConfig = buildEnvConfig();
export const config = env;

ensureDataDirectoriesExist(env.paths);

export default env;
