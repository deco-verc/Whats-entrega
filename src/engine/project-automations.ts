import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { env } from "../config/env.js";
import { getProductById, getProductByOfferId } from "../config/catalog.js";
import type { Customer, FunnelTrigger, MessageTemplate, Order, Project, QueueJob, Repositories } from "../database/repositories.js";
import type { NormalizedCaktoPayload } from "../webhooks/adapters.js";

export const AUTOMATION_EVENTS = [
  "purchase_approved", "purchase_refused", "pix_generated", "pix_expirado", "boleto_generated",
  "picpay_gerado", "purchase_refunded", "refund_requested", "chargeback", "checkout_abandonment",
  "dispute_defense_requested", "purchase_email_failed", "openfinance_nubank_gerado", "oxxo_gerado",
  "spei_gerado", "pse_gerado", "nequi_gerado", "subscription_created", "subscription_renewed",
  "subscription_canceled", "subscription_renewal_refused", "subscription_paused", "subscription_resumed",
  "subscription_late", "subscription_late_recovered",
] as const;

const LEGACY_KEYS = new Set([
  "ABANDONMENT_RECOVERY", "PIX_RECOVERY", "MAIN_DELIVERY", "UPSELL_1_OFFER", "UPSELL_1_DELIVERY",
  "UPSELL_2_OFFER", "UPSELL_2_DELIVERY", "DOWNSELL_OFFER", "DOWNSELL_DELIVERY",
]);

export const isLegacyAutomationKey = (key: string): boolean => LEGACY_KEYS.has(key);

export interface AutomationConditions {
  product_id?: string;
  offer_id?: string;
  offer_type?: string;
  status?: string;
  state?: string;
  prior_purchase?: "yes" | "no";
  skip_if_offer_purchased?: string;
  marketing?: boolean;
}

export interface TemplateOptions {
  category: string;
  message_type: "TEXT" | "AUDIO_PTT" | "DOCUMENT";
  missing_policy: "block" | "omit" | "fallback";
  fallback: string | null;
}

export function projectMediaPath(input: string, type: TemplateOptions["message_type"], projectId = "default"): string | null {
  if (type === "TEXT") return null;
  const name = path.basename(input);
  if (input !== name || !name.toLowerCase().endsWith(type === "AUDIO_PTT" ? ".ogg" : ".pdf")) return null;
  try {
    if (!/^[\w-]+$/.test(projectId)) return null;
    const mediaRoot = fs.realpathSync(env.paths.mediaDir);
    const projectRoot = projectId === "default" ? mediaRoot : path.join(mediaRoot, projectId);
    const media = fs.realpathSync(path.join(projectRoot, name));
    return path.dirname(media) === projectRoot && fs.statSync(media).isFile() ? media : null;
  } catch {
    return null;
  }
}

export function renderProjectTemplate(
  repos: Repositories,
  template: MessageTemplate,
  variables: Record<string, string | number | undefined | null>
): { content: string; mediaPath: string | null; type: TemplateOptions["message_type"]; error?: string } {
  const options = repos.db.prepare("SELECT * FROM template_options WHERE template_id = ?").get(template.id) as TemplateOptions | undefined;
  const mediaName = path.basename(template.media_path ?? "");
  const type = options?.message_type ?? (mediaName.endsWith(".ogg") ? "AUDIO_PTT" : mediaName.endsWith(".pdf") ? "DOCUMENT" : "TEXT");
  const mediaPath = projectMediaPath(mediaName, type, template.project_id);
  const missing: string[] = [];
  const content = template.content.replace(/\{\{([a-zA-Z0-9_]+)\}\}|\{([a-zA-Z0-9_]+)\}/g, (_match, double, single) => {
    const key = double ?? single;
    const value = Object.hasOwn(variables, key) ? variables[key] : undefined;
    if (value !== undefined && value !== null && value !== "") return String(value);
    missing.push(key);
    return options?.missing_policy === "fallback" ? options.fallback ?? "" : "";
  });
  let error: string | undefined;
  if (missing.length && (options?.missing_policy ?? "block") === "block") error = `Variáveis sem valor: ${[...new Set(missing)].join(", ")}`;
  if (type !== "TEXT" && !mediaPath) error = "Arquivo de mídia indisponível.";
  if (type === "TEXT" && !content.trim()) error ??= "Mensagem sem conteúdo.";
  return { content: repos.templates.interpolate(content), type, mediaPath, error };
}

export function projectTemplateVariables(db: Database.Database, project: Project, name: string, event?: NormalizedCaktoPayload) {
  const metadata = db.prepare("SELECT product_name, links_json FROM project_workspace WHERE project_id = ?").get(project.id) as
    { product_name: string | null; links_json: string } | undefined;
  const links = JSON.parse(metadata?.links_json ?? "{}") as Record<string, string>;
  const firstName = name.trim().split(/\s+/)[0];
  const checkoutLink = links.link_checkout || links.link || links.link_acesso;
  return {
    ...links, nome: name, name, primeiro_nome: firstName, first_name: firstName,
    produto: metadata?.product_name ?? project.name, product_name: metadata?.product_name ?? project.name,
    email: event?.customer.email, valor_pedido: event?.amount, moeda: event?.currency,
    pix_code: event?.pix?.qrCodeText, pix_copia_cola: event?.pix?.qrCodeText,
    link: links.link || links.link_acesso, link_checkout: checkoutLink, checkout_url: checkoutLink,
  };
}

function storedConditions(db: Database.Database, triggerId: string): AutomationConditions | null {
  const row = db.prepare("SELECT conditions_json FROM automation_conditions WHERE trigger_id = ?").get(triggerId) as { conditions_json: string } | undefined;
  return row ? JSON.parse(row.conditions_json) as AutomationConditions : null;
}

function hasPurchase(db: Database.Database, order: Order, offerId?: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM orders purchase
    WHERE purchase.project_id = ? AND purchase.customer_id = ?
      AND purchase.event_type = 'purchase_approved' AND (? IS NULL OR purchase.id <> ?)
      AND (? IS NULL OR purchase.offer_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM orders reversal
        WHERE reversal.project_id = purchase.project_id AND reversal.transaction_id = purchase.transaction_id
          AND reversal.event_type IN ('purchase_refunded', 'chargeback')
      )
    LIMIT 1
  `).get(order.project_id, order.customer_id, offerId ? null : order.id, order.id, offerId ?? null, offerId ?? null));
}

function matchesLegacyStage(rule: FunnelTrigger, event: NormalizedCaktoPayload): boolean {
  const knownType = (getProductByOfferId(event.product.offerId) ?? getProductById(event.product.id))?.type;
  const productType = knownType ?? (event.offerType === "downsell" ? "DOWNSELL" :
    event.offerType === "upsell" ? "UPSELL_1" : event.offerType === "orderbump" ? "ORDER_BUMP" : "MAIN");
  switch (rule.trigger_key) {
    case "MAIN_DELIVERY":
    case "UPSELL_1_OFFER":
      return productType === "MAIN";
    case "UPSELL_1_DELIVERY":
    case "UPSELL_2_OFFER":
      return productType === "UPSELL_1";
    case "UPSELL_2_DELIVERY":
      return productType === "UPSELL_2";
    case "DOWNSELL_DELIVERY":
      return productType === "DOWNSELL";
    case "DOWNSELL_OFFER":
      return false;
    default:
      return true;
  }
}

function isMarketingStage(key: string): boolean {
  return key === "UPSELL_1_OFFER" || key === "UPSELL_2_OFFER" || key === "DOWNSELL_OFFER";
}

function ineligibility(db: Database.Database, rule: AutomationConditions, order: Order, customer: Customer, state: string): string | undefined {
  if (rule.state && rule.state !== state) return "Etapa do cliente incompatível.";
  if (rule.prior_purchase && hasPurchase(db, order) !== (rule.prior_purchase === "yes")) return "Histórico de compras incompatível.";
  if (rule.skip_if_offer_purchased && hasPurchase(db, order, rule.skip_if_offer_purchased)) return "O cliente já comprou a oferta.";
  const permission = db.prepare("SELECT marketing, opted_out FROM contact_permissions WHERE project_id = ? AND phone = ?")
    .get(customer.project_id, customer.phone) as { marketing: number; opted_out: number } | undefined;
  const stopped = db.prepare("SELECT 1 FROM whatsapp_opt_out WHERE phone = ?").get(customer.phone);
  if (stopped || permission?.opted_out) return "O destinatário solicitou descadastro.";
  if (rule.marketing && !permission?.marketing) return "O destinatário não autorizou ofertas.";
  return undefined;
}

export function scheduleProjectAutomations(
  repos: Repositories, project: Project, event: NormalizedCaktoPayload, customer: Customer, order: Order, simulation = false
) {
  const rules = repos.funnelTriggers.listByProject(project.id).filter((rule) => (
    rule.event_type === event.eventType && (project.id !== "default" || !LEGACY_KEYS.has(rule.trigger_key))
  ));
  return rules.map((rule) => {
    const configured = storedConditions(repos.db, rule.id);
    const conditions = { ...(configured ?? {}), marketing: configured?.marketing ?? isMarketingStage(rule.trigger_key) };
    const template = rule.template_id ? repos.templates.findById(rule.template_id) : null;
    let reason: string | undefined;
    if (!rule.is_active && !simulation) reason = "Automação pausada.";
    else if (!configured && !matchesLegacyStage(rule, event)) reason = "O evento não pertence à etapa desta automação.";
    else if (
      (conditions.product_id && conditions.product_id !== event.product.id) ||
      (conditions.offer_id && conditions.offer_id !== event.product.offerId) ||
      (conditions.offer_type && conditions.offer_type !== event.offerType) ||
      (conditions.status && conditions.status !== event.status)
    ) reason = "O evento não atende às condições.";
    else reason = ineligibility(repos.db, conditions, order, customer, customer.current_state);

    const schedule = new Date(Date.now() + rule.delay_seconds * 1000);
    const result = template?.project_id === project.id
      ? renderProjectTemplate(repos, template, projectTemplateVariables(repos.db, project, customer.name, event))
      : undefined;
    reason ??= result ? result.error : "Template do projeto indisponível.";
    if (!reason && result) {
      const job = repos.messageQueue.enqueue({
        project_id: project.id, customer_id: customer.id, phone: customer.phone, jid: customer.jid,
        message_type: result.type, content: result.content, media_path: result.mediaPath, scheduled_at: schedule,
      });
      repos.db.prepare("INSERT INTO automation_executions (job_id, trigger_id, order_id) VALUES (?, ?, ?)")
        .run(job.id, rule.id, order.id);
    }
    return {
      id: rule.id, name: rule.name, template: template?.project_id === project.id ? template.name : null,
      delay_seconds: rule.delay_seconds, scheduled_at: reason ? null : schedule.toISOString(),
      conditions, result: reason ?? "Elegível para agendamento",
    };
  });
}

export function checkQueuedAutomation(repos: Repositories, job: QueueJob, customer: Customer): string | undefined {
  const execution = repos.db.prepare("SELECT trigger_id, order_id FROM automation_executions WHERE job_id = ?")
    .get(job.id) as { trigger_id: string | null; order_id: string } | undefined;
  if (!execution) return undefined;
  const trigger: FunnelTrigger | null = execution.trigger_id ? repos.funnelTriggers.findById(execution.trigger_id) : null;
  const order = repos.orders.findById(execution.order_id);
  if (!trigger?.is_active || trigger.project_id !== job.project_id || order?.project_id !== job.project_id) return "Automação indisponível ou pausada.";
  if (customer.current_state === "REFUNDED" && order.event_type !== "purchase_refunded" && order.event_type !== "chargeback") {
    return "Compra reembolsada.";
  }
  if (order.event_type === "pix_generated" && repos.orders.findByTransactionAndEvent(order.transaction_id, "purchase_approved", job.project_id)) {
    return "O Pix já foi pago.";
  }
  if (order.event_type === "pix_generated" && repos.orders.findByTransactionAndEvent(order.transaction_id, "pix_expirado", job.project_id)) {
    return "O Pix expirou.";
  }
  if ((job.message_type === "AUDIO_PTT" || job.message_type === "DOCUMENT") &&
      (!job.media_path || !projectMediaPath(path.basename(job.media_path), job.message_type, job.project_id))) {
    return "Arquivo de mídia indisponível.";
  }
  const conditions = storedConditions(repos.db, trigger.id);
  return ineligibility(repos.db, { ...conditions, marketing: conditions?.marketing ?? isMarketingStage(trigger.trigger_key) },
    order, customer, customer.current_state);
}
