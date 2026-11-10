const main = document.querySelector("main");
const dialog = document.querySelector("dialog");
const navigation = document.querySelector("#navigation");
const switcher = document.querySelector("#switcher");
const search = document.querySelector("#project-search");
const toast = document.querySelector("#toast");
dialog.addEventListener("close", () => {
  if (!dialog.open) dialog.replaceChildren();
});
const state = { projects: [], revision: 0, days: 7, queueStatus: "", connection: null };
const nav = [
  ["overview", "Visão Geral", "M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v5H3zM14 15h7v5h-7z"],
  ["integration", "Integração Cakto", "m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 10a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-2 2"],
  ["orders", "Pedidos", "M4 7h16v14H4zM8 7V6a4 4 0 0 1 8 0v1"],
  ["templates", "Templates", "M4 4h16v13H9l-5 4zM8 8h8m-8 4h6"],
  ["automations", "Automações", "m13 2-9 12h7l-1 8 10-12h-7z"],
  ["queue", "Fila de Mensagens", "M5 6h14M5 12h14M5 18h14"],
  ["lab", "Laboratório de Testes", "M9 3h6m-5 0v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3m-6 12h8"],
  ["history", "Histórico", "M3 12a9 9 0 1 1 3 7m-3-7V7m0 5h5m4-5v5l3 2"],
  ["settings", "Configurações", "M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-7 2v4"],
];
const gridIcon = "M3 5h7l2 2h9v13H3z";
const eventLabels = {
  purchase_approved: "Compra aprovada", purchase_refused: "Compra recusada", pix_generated: "Pix gerado (pagamento pendente)",
  pix_expirado: "Pix expirado", boleto_generated: "Boleto gerado", picpay_gerado: "PicPay gerado",
  purchase_refunded: "Reembolso", refund_requested: "Reembolso solicitado", chargeback: "Chargeback",
  checkout_abandonment: "Abandono de Checkout", subscription_created: "Assinatura criada",
  subscription_renewed: "Assinatura renovada", subscription_canceled: "Assinatura cancelada",
  subscription_renewal_refused: "Renovação recusada",
  purchase_approved_upsell: "Upsell aprovado", purchase_approved_downsell: "Downsell aprovado",
};
const statusLabels = {
  PENDING: "Agendada", PROCESSING: "Processando", SENT: "Enviada", DELIVERED: "Entregue", FAILED: "Falha de processamento",
  CANCELLED: "Cancelada", PROCESSED: "Validado", DUPLICATE: "Duplicado", AUTH_FAILED: "Falha de autenticação",
  INVALID_PAYLOAD: "Payload inválido", PRODUCT_MISMATCH: "Produto incompatível", PROBE: "Teste de conectividade",
  PROCESSING_ERROR: "Erro de processamento", PAID: "Pago", APPROVED: "Aprovado", REFUSED: "Recusado",
  SIMULATED: "Simulação concluída", NO_MATCH: "Sem agendamento", TEST: "Teste Cakto",
  PROCESSED: "Produção", AMBIGUOUS: "Ambíguo (Retido)", TEST_FAILED: "Falha de teste",
  AUTH_FAILED: "Falha de autenticação", DUPLICATE: "Duplicado",
};

const jobStatus = (job) => {
  let label = statusLabels[job.status] ?? job.status ?? "—";
  let type = "";
  if (job.status === "SENT") {
    if (job.delivered_at) {
      label = "Entregue";
      type = "good";
    } else {
      label = "Enviada";
      type = "good";
    }
  } else if (job.status === "PENDING") {
    label = "Agendada";
    type = "warn";
  } else if (job.status === "PROCESSING") {
    label = "Processando";
    type = "warn";
  } else if (job.status === "FAILED") {
    label = "Falha de processamento";
    type = "bad";
  } else if (job.status === "CANCELLED") {
    label = "Cancelada";
    type = "";
  }
  const tag = job.is_test ? `<span class="pill" style="margin-left:4px;font-size:10px;opacity:0.8;">TESTE</span>` : "";
  return badge(label, type) + tag;
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const h = escapeHtml;
const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const badge = (label, type = "") => `<span class="pill ${type}">${h(label)}</span>`;
const status = (value) => badge(statusLabels[value] ?? value ?? "—",
  ["SENT", "PROCESSED", "PAID", "APPROVED"].includes(value) ? "good" : ["FAILED", "AUTH_FAILED", "INVALID_PAYLOAD", "PRODUCT_MISMATCH", "PROCESSING_ERROR"].includes(value) ? "bad" : value === "PENDING" ? "warn" : "");
const date = (value, zone = state.project?.timezone ?? "America/Sao_Paulo") => {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short", timeZone: zone,
  }).format(parsed);
};
const labelEvent = (value) => eventLabels[value] ?? value ?? "—";
const projectPath = (project, view = "overview") => `#project/${encodeURIComponent(project.id)}/${view}`;
const endpoint = (project, route = "") => `/api/projects/${encodeURIComponent(project.id)}${route ? "/" + route : ""}`;
const heading = (section, title, description, action = "") => `<header class="page-heading"><div><span class="eyebrow">${h(section)}</span><h1>${h(title)}</h1><p>${h(description)}</p></div>${action}</header>`;
const button = (label, action, style = "", id = "") => `<button type="button" class="button ${style}" data-action="${action}"${id ? ` data-id="${h(id)}"` : ""}>${h(label)}</button>`;
const empty = (title, text, action = "") => `<div class="empty"><span class="tile">${icon(gridIcon)}</span><h2>${h(title)}</h2><p>${h(text)}</p>${action}</div>`;
const table = (columns, rows, blank) => rows.length ? `<div class="table-wrap" tabindex="0" aria-label="Tabela com rolagem"><table>
  <thead><tr>${columns.map((column) => `<th scope="col">${h(column)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  : empty(blank, "Os dados serão exibidos aqui quando estiverem disponíveis.");

async function api(url, method = "GET", body) {
  const response = await fetch(url, {
    method, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.message || result.error || `Falha na solicitação (${response.status}).`);
  return result;
}

function notify(message, error = false) {
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.dataset.error = String(error);
  toast.hidden = false;
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, 5200);
}

function showDialog(title, markup, wide = false) {
  if (dialog.open) dialog.close();
  dialog.classList.toggle("wide", wide);
  dialog.innerHTML = `<div class="dialog-inner"><header class="dialog-head"><h2 id="dialog-title">${h(title)}</h2>
    <button type="button" class="icon-button" aria-label="Fechar" data-action="close-dialog">${icon("m6 6 12 12M18 6 6 18")}</button></header>${markup}</div>`;
  dialog.showModal();
  (dialog.querySelector("input, select, textarea") ?? dialog.querySelector("button"))?.focus();
}

function bindForm(form, submit) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = event.submitter ?? form.querySelector("[type=submit]");
    const error = form.querySelector("[data-error]");
    error.hidden = true;
    submitButton.disabled = true;
    try {
      await submit(Object.fromEntries(new FormData(form)), form);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submitButton.disabled = false;
      form.dispatchEvent(new Event("submitfinished"));
    }
  });
}

const formError = '<div class="notice error" role="alert" data-error hidden></div>';
const submit = (label) => `<div class="dialog-actions"><button class="button primary" type="submit">${h(label)}</button></div>`;
const field = (label, name, value = "", attrs = "") => `<label class="field">${h(label)}<input name="${name}" value="${h(value)}" ${attrs}></label>`;
const textarea = (label, name, value = "", attrs = "") => `<label class="field">${h(label)}<textarea name="${name}" ${attrs}>${h(value)}</textarea></label>`;
const select = (label, name, items, value, attrs = "") => `<label class="field">${h(label)}<select name="${name}" ${attrs}>${items.map(([key, text]) =>
  `<option value="${h(key)}"${String(key) === String(value) ? " selected" : ""}>${h(text)}</option>`).join("")}</select></label>`;
const check = (label, name, checked = false) => `<label class="checkbox"><input type="checkbox" name="${name}"${checked ? " checked" : ""}> ${h(label)}</label>`;

function renderShell(project, view) {
  const current = (match) => match ? ' aria-current="page"' : "";
  navigation.innerHTML = `<span class="nav-label">Espaço de trabalho</span><a href="#projects"${current(!project)}>${icon(gridIcon)} Meus Projetos</a>`;
  if (project) navigation.insertAdjacentHTML("beforeend", `<span class="nav-label">Operação do projeto</span>${nav.map(([key, title, path]) =>
    `<a href="${h(projectPath(project, key))}"${current(view === key)}>${icon(path)} ${title}</a>`).join("")}`);
  document.querySelector("#breadcrumb").textContent = project ? `Projetos / ${nav.find(([key]) => key === view)?.[1] ?? "Configuração inicial"}` : "Central de projetos";
  switcher.hidden = !project;
  switcher.open = false;
  document.querySelector("#switcher-label").textContent = project ? `Projeto: ${project.name}` : "Selecionar projeto";
  search.value = "";
  renderSwitcher();
}

function renderSwitcher() {
  const term = search.value.trim().toLocaleLowerCase("pt-BR");
  const projects = state.projects.filter((project) => `${project.name} ${project.slug}`.toLocaleLowerCase("pt-BR").includes(term));
  document.querySelector("#switcher-list").innerHTML = projects.map((project) => `<a href="${h(projectPath(project, state.view === "onboarding" ? "overview" : state.view))}"
    aria-current="${project.id === state.project?.id}">${h(project.name)} <small>${h(project.slug)}</small></a>`).join("") || "<p>Nenhum projeto encontrado.</p>";
}

function renderProjects() {
  main.innerHTML = heading("Central de projetos", "Meus Projetos", "Escolha um produto para acompanhar pedidos, mensagens e automações em seu próprio espaço.",
    `<div class="row"><button type="button" class="button" id="project-wa" data-action="whatsapp-dialog">
      <span class="signal ${state.connection?.connected ? "online" : ""}" aria-hidden="true"></span>
      <span>${state.connection?.connected ? "WhatsApp conectado" : state.connection ? "WhatsApp desconectado" : "Status do WhatsApp"}</span>
    </button>${button("+ Novo Projeto", "create-project", "primary")}</div>`);
  main.insertAdjacentHTML("beforeend", state.projects.length ? `<div class="grid project-grid">${state.projects.map((project) => {
    const stats = project.stats;
    const connected = project.integration_verified;
    return `<article class="card project-card">
      <div class="card-head"><span class="tile">${icon(gridIcon)}</span>${badge(project.is_active ? "Ativo" : "Pausado", project.is_active ? "good" : "warn")}</div>
      <div><h2>${h(project.name)}</h2><p>${h(project.product_name)}</p><span class="slug">/${h(project.slug)}</span></div>
      <div>${badge(connected ? "Cakto validada" : project.secret_configured && project.cakto_product_id ? "Cakto configurada" : "Cakto pendente", connected ? "good" : "")}</div>
      <div class="stats-line"><div><strong>${stats.active_automations}</strong><small>Automações ativas</small></div><div><strong>${stats.sent_queue}</strong><small>Mensagens enviadas</small></div></div>
      <small>Último webhook · ${h(date(project.last_webhook?.created_at, project.timezone))}</small>
      <div class="row"><a class="button primary" href="${h(projectPath(project))}">Abrir Projeto</a>
        <details class="menu"><summary class="icon-button" aria-label="Ações de ${h(project.name)}">${icon("M5 12h.1m6.9 0h.1m6.9 0h.1")}</summary>
        <div class="menu-panel">${button("Editar", "edit-project", "", project.id)}${button("Duplicar", "duplicate-project", "", project.id)}
          ${project.id === "default" ? "" : button("Excluir da central", "archive-project", "danger", project.id)}</div></details></div>
    </article>`;
  }).join("")}</div>` : empty("Você ainda não criou nenhum projeto.", "Crie um espaço para configurar seu primeiro produto e acompanhar suas entregas.",
    button("Criar Primeiro Projeto", "create-project", "primary")));
}

function projectDialog(project) {
  showDialog(project ? "Editar projeto" : "Novo projeto", `<form class="stack">
    <p>Identifique o espaço de trabalho e vincule o produto quando tiver o ID da Cakto.</p>
    <div class="form-grid">${field("Nome do projeto", "name", project?.name, 'required maxlength="150"')}
      ${field("Nome do produto", "product_name", project?.product_name, 'required maxlength="150"')}
      ${field("Slug do webhook", "slug", project?.slug, 'required pattern="[a-z0-9][a-z0-9_\\-]{0,79}"')}
      ${field("Fuso horário", "timezone", project?.timezone ?? "America/Sao_Paulo", 'required')}
      ${field("ID do produto Cakto", "cakto_product_id", project?.cakto_product_id, 'maxlength="150"')}</div>
    ${textarea("Descrição (opcional)", "description", project?.description)}${formError}${submit(project ? "Salvar projeto" : "Criar Projeto")}
  </form>`);
  const form = dialog.querySelector("form");
  const name = form.elements.name;
  const slug = form.elements.slug;
  let edited = Boolean(project);
  slug.addEventListener("input", () => { edited = true; });
  name.addEventListener("input", () => {
    if (!edited) slug.value = name.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  });
  bindForm(form, async (data) => {
    const result = await api(project ? endpoint(project) : "/api/projects", project ? "PUT" : "POST", data);
    dialog.close();
    notify(project ? "Projeto atualizado." : "Projeto criado.");
    if (project) await render();
    else location.hash = projectPath(result.project, "onboarding");
  });
}

const onboarding = [
  ["Projeto criado", "Seu projeto foi salvo. Você já pode voltar à central e continuar depois.", "overview"],
  ["Integração Cakto", "Vincule o produto, copie a URL exclusiva e salve a chave do webhook.", "integration"],
  ["Templates", "Crie o conteúdo que será usado na entrega e nas ofertas.", "templates"],
  ["Automações", "Selecione os eventos, as condições, o template e o tempo de espera.", "automations"],
  ["Testes", "Simule um evento no laboratório e confira o resultado do agendamento.", "lab"],
  ["Ativação", "Habilite as automações desejadas e ative o projeto para começar a processar eventos.", "settings"],
];

function renderOnboarding(project) {
  const step = project.onboarding_step;
  const checks = project.onboarding_checks;
  const [title, text, page] = onboarding[step - 1];
  main.innerHTML = heading(project.name, "Configuração inicial", "Continue de onde parou. O progresso acompanha os dados salvos do projeto.") +
    `<section class="panel stack"><ol class="steps">${onboarding.map(([label], index) => `<li class="${checks[index] ? "complete" : ""}" ${index + 1 === step ? 'aria-current="step"' : ""}>
      <strong>${index + 1} · ${label}</strong><small>${checks[index] ? "Concluído" : "Pendente"}</small></li>`).join("")}</ol>
      <h2>${step}. ${title}</h2><p>${text}</p><div class="row">
      ${step > 1 ? button("Voltar", "step-back") : ""}<a class="button" href="${h(projectPath(project, page))}">Abrir ${h(nav.find(([key]) => key === page)?.[1] ?? page)}</a>
      ${step < 6 ? `<button class="button primary" type="button" data-action="step-next"${checks[step - 1] ? "" : " disabled"}>Avançar</button>` : ""}
      <a class="button" href="${h(projectPath(project))}">Continuar depois</a></div></section>`;
}

function activityTable(activity) {
  return table(["Atividade", "Resultado", "Data e hora"], activity.map((item) =>
    [h(labelEvent(item.label)), status(item.status), h(date(item.at))]), "Nenhuma atividade registrada");
}

function renderOverview(project, data) {
  const labels = {
    customers_count: "Clientes", orders_count: "Pedidos recebidos", valid_webhooks: "Webhooks válidos",
    sent_queue: "Mensagens enviadas", pending_queue: "Mensagens pendentes", failed_queue: "Mensagens com falha",
    active_automations: "Automações ativas",
  };
  const sent = new Map(data.sent.map((item) => [item.day, item.total]));
  const series = Array.from({ length: state.days }, (_, index) => {
    const day = new Date(Date.now() - (state.days - index - 1) * 86400000).toISOString().slice(0, 10);
    return [day, sent.get(day) ?? 0];
  });
  const peak = Math.max(1, ...series.map(([, total]) => total));
  main.innerHTML = heading("Visão geral", project.name, project.description || `Acompanhe a operação do produto ${project.product_name}.`,
    `<a class="button" href="${h(projectPath(project, "onboarding"))}">Configuração inicial</a>`) +
    `<div class="stack"><div class="kpis">${Object.entries(labels).map(([key, label]) =>
      `<article class="card kpi"><small>${label}</small><strong>${project.stats[key].toLocaleString("pt-BR")}</strong></article>`).join("")}</div>
      <section class="panel"><div class="section-head"><div><h2>Mensagens enviadas</h2><p>Total por dia · UTC</p></div>
      ${select("Período", "days", [[7, "Últimos 7 dias"], [30, "Últimos 30 dias"], [90, "Últimos 90 dias"]], state.days, 'id="period"')}</div>
      ${sent.size ? `<div class="chart" role="img" aria-label="${h(series.filter(([, count]) => count).map(([day, count]) => `${day}: ${count}`).join("; "))}">${series.map(([day, count]) =>
        `<div class="chart-bar" style="height:${count ? Math.max(4, count / peak * 150) : 2}px" title="${day} · ${count} mensagens"></div>`).join("")}</div>
        <div class="chart-axis"><small>${series[0][0]}</small><small>${series.at(-1)[0]}</small></div>`
        : '<div class="notice">Nenhuma mensagem enviada no período selecionado.</div>'}</section>
      <section class="stack compact"><h2>Atividade recente</h2>${activityTable(data.activity)}</section></div>`;
}

function webhookTable(events) {
  return table(["Data e hora", "Evento", "Produto", "Transação", "Autenticação", "Resultado", "Detalhes"],
    events.map((item) => [h(date(item.created_at)), h(labelEvent(item.event_type)), h(item.product_id || "—"),
      h(item.transaction_id || "—"), badge(item.authenticated ? "Válida" : "Rejeitada", item.authenticated ? "good" : "bad"),
      status(item.result), button("Ver", "webhook-detail", "", String(item.id))]), "Nenhum webhook recebido");
}

function validateWebhookConfig(url) {
  if (!url || typeof url !== "string") {
    return { valid: false, message: "URL do webhook não informada." };
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, message: "Protocolo inválido. Utilize HTTP ou HTTPS." };
    }
    const isBareIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname);
    const isBareIpv6 = parsed.hostname.includes(":") && !parsed.hostname.includes(".");
    if (parsed.protocol === "https:" && (isBareIpv4 || isBareIpv6)) {
      return {
        valid: false,
        message: "Configuração incorreta: IPs diretos com HTTPS causam erro de certificado SSL na Cakto. Utilize o domínio público FQDN configurado no PUBLIC_BASE_URL (ex: https://18.191.162.237.sslip.io).",
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, message: "Formato de URL inválido." };
  }
}

function renderIntegration(project, data) {
  const url = project.webhook_url || `${state.public_base_url || location.origin}/api/webhook/cakto/${encodeURIComponent(project.slug)}`;
  const check = validateWebhookConfig(url);
  const warningNotice = !check.valid ? `<div class="notice error" style="margin-bottom:14px;border-left:4px solid var(--danger, #ef4444);">
    <strong>Configuração Incorreta de Webhook:</strong> ${h(check.message)}
  </div>` : "";
  main.innerHTML = heading(project.name, "Integração Cakto", "Configure a URL e acompanhe os eventos validados para este produto.",
    button("Aguardar Evento Real", "monitor-webhook", "primary")) +
    `<div class="stack">${warningNotice}<section class="panel stack"><div class="card-head"><h2>Webhook do projeto</h2>
      ${badge(data.first_validated ? "Evento real validado" : project.onboarding_checks[1] ? "Webhook configurado" : "Configuração pendente", data.first_validated ? "good" : "warn")}</div>
      <label class="field">URL exclusiva<input id="webhook-url" value="${h(url)}" readonly></label>
      <div class="row">${button("Copiar URL", "copy-webhook")}${button("Simular Webhook", "simulate-dialog")}</div>
      <div class="grid"><div><small>Produto vinculado</small><strong>${h(project.product_name)}</strong></div>
        <div><small>Último evento</small><strong>${h(labelEvent(project.last_webhook?.event_type))} · ${h(date(project.last_webhook?.created_at))}</strong></div>
        <div><small>Primeiro webhook validado</small><strong>${h(date(data.first_validated?.created_at))}</strong></div>
        <div><small>Último teste interno</small><strong>${h(date(data.simulated_at))}</strong></div></div></section>
      <section class="panel"><form class="stack" id="integration-form"><h2>Vínculo e autenticação</h2>
        <div class="form-grid">${field("ID do produto Cakto", "cakto_product_id", project.cakto_product_id, 'required')}
          ${field("Chave secreta do webhook", "cakto_webhook_secret", "", `type="password" autocomplete="new-password" placeholder="${project.secret_configured ? "•••••••• (salva)" : "Informe a chave da Cakto"}"`)}
        </div>${field("IDs de produtos adicionais (separados por vírgula)", "additional_products", project.additional_products.join(", "))}
        ${formError}${submit("Salvar integração")}</form></section>
      <section class="stack compact"><h2>Histórico de webhooks</h2>${webhookTable(data.events)}</section></div>`;
  bindForm(main.querySelector("#integration-form"), async (values) => {
    const { cakto_webhook_secret, additional_products, ...settings } = values;
    await api(endpoint(project), "PUT", { ...settings, ...(cakto_webhook_secret ? { cakto_webhook_secret } : {}),
      additional_products: additional_products.split(",").map((value) => value.trim()).filter(Boolean) });
    notify("Integração atualizada.");
    await render();
  });
}

function renderOrders(project, { orders }) {
  main.innerHTML = heading(project.name, "Pedidos", "Veja as transações e os eventos registrados para este projeto.") +
    table(["Transação", "Cliente", "Evento", "Status", "Oferta", "Recebido em"], orders.map((order) =>
      [h(order.transaction_id), h(order.name), h(labelEvent(order.event_type)), status(order.status), h(order.offer_id || "—"), h(date(order.created_at))]),
    "Nenhum pedido recebido");
}

const categories = ["Entrega Principal", "Upsell 1", "Upsell 2", "Downsell", "Recuperação", "Personalizados"];
const messageTypes = [["TEXT", "Texto"], ["AUDIO_PTT", "Áudio PTT"], ["DOCUMENT", "Documento PDF"]];
const templateType = (tpl) => tpl?.options?.message_type ?? (tpl?.media_path?.endsWith(".ogg") ? "AUDIO_PTT" : tpl?.media_path?.endsWith(".pdf") ? "DOCUMENT" : "TEXT");
function templateCategory(template) {
  if (template?.options?.category) return template.options.category;
  const key = template?.name ?? "";
  if (key.includes("UPSELL_1")) return "Upsell 1";
  if (key.includes("UPSELL_2")) return "Upsell 2";
  if (key.includes("DOWNSELL")) return "Downsell";
  if (key.includes("RECOVERY")) return "Recuperação";
  return key === "MAIN_DELIVERY" ? "Entrega Principal" : "Personalizados";
}

function renderTemplates(project, { templates }) {
  main.innerHTML = heading(project.name, "Templates", "Organize as mensagens que suas automações enviam em cada etapa do funil.",
    button("+ Novo Template", "new-template", "primary"));
  main.insertAdjacentHTML("beforeend", templates.length ? `<div class="grid">${templates.map((tpl) => `<article class="card stack">
    <div class="card-head"><span class="tile">${icon(nav[3][2])}</span>${badge(templateCategory(tpl))}</div>
    <div><h2>${h(tpl.name)}</h2><p>${h(messageTypes.find(([type]) => type === templateType(tpl))?.[1])} · ${tpl.automations.length ? "Em uso" : "Disponível"}</p></div>
    <p>${h(tpl.content.slice(0, 120))}${tpl.content.length > 120 ? "…" : ""}</p>
    <small>Automações · ${h(tpl.automations.map((rule) => rule.name).join(", ") || "Nenhuma")}</small>
    <small>Última edição · ${h(date(tpl.updated_at))}</small>
    <div class="row">${button("Editar", "edit-template", "", tpl.id)}${button("Duplicar", "duplicate-template", "", tpl.id)}${button("Testar", "test-template", "", tpl.id)}</div>
    </article>`).join("")}</div>` : empty("Nenhum template neste projeto", "Crie uma mensagem de entrega ou oferta para usar nas automações.",
    button("Criar template", "new-template", "primary")));
}

function templateDialog(project, tpl, duplicate = false) {
  const name = duplicate ? `${tpl.name} (cópia)` : tpl?.name;
  showDialog(duplicate ? "Duplicar template" : tpl ? "Editar template" : "Novo template", `<form class="stack">
    <div class="editor"><div class="stack compact">
      ${field("Nome", "name", name, 'required maxlength="150"')}
      <div class="form-grid">${select("Categoria", "category", categories.map((item) => [item, item]), templateCategory(tpl))}
      ${select("Tipo de mensagem", "message_type", messageTypes, templateType(tpl))}</div>
      ${textarea("Conteúdo", "content", tpl?.content)}
      <div class="row">${["nome", "primeiro_nome", "produto", "email", "valor_pedido", "link", "link_acesso", "link_upsell", "link_downsell", "pix_copia_cola"].map((tag) =>
        button(`{${tag}}`, "insert-tag", "", tag)).join("")}</div>
      ${field("Nome do arquivo na pasta de mídia", "media_path", tpl?.media_path?.split(/[\\/]/).at(-1), 'placeholder="entrega.pdf ou oferta.ogg"')}
      <label class="field" id="upload-field">Ou anexe um arquivo de até 16 MB<input type="file" accept=".pdf,.ogg" id="template-file"></label>
      ${select("Se faltar uma variável", "missing_policy", [["block", "Bloquear envio"], ["omit", "Omitir variável"], ["fallback", "Usar texto de reserva"]], tpl?.options?.missing_policy ?? "block")}
      ${field("Texto de reserva", "fallback", tpl?.options?.fallback)}
    </div><div class="stack compact"><span class="eyebrow">Prévia · dados simulados</span>
      <div class="phone"><strong class="phone-title">${h(project.product_name)}</strong><div class="bubble" id="message-preview"></div></div>
      ${field("Nome na prévia", "demo_name", "Maria Silva")}
      ${field("E-mail na prévia", "demo_email", "", 'type="email"')}
      ${field("Valor na prévia", "demo_amount", "", 'type="number" min="0" step="0.01"')}
    </div></div>${formError}${submit("Salvar template")}
  </form>`, true);
  const form = dialog.querySelector("form");
  const preview = () => {
    const fields = form.elements;
    const data = { ...project.links, nome: fields.demo_name.value, primeiro_nome: fields.demo_name.value.trim().split(/\s+/)[0],
      produto: project.product_name, email: fields.demo_email.value, valor_pedido: fields.demo_amount.value,
      link: project.links.link || project.links.link_acesso };
    const result = fields.content.value.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_match, double, single) => {
      const key = double ?? single;
      if (Object.hasOwn(data, key) && data[key]) return data[key];
      return fields.missing_policy.value === "fallback" ? fields.fallback.value : fields.missing_policy.value === "omit" ? "" : `[{${key}}]`;
    }).replace(/\{([^{}]+\|[^{}]+)\}/g, (_match, choices) => choices.split("|")[0]);
    dialog.querySelector("#message-preview").textContent = result || "A mensagem aparecerá aqui.";
    fields.media_path.closest("label").hidden = fields.message_type.value === "TEXT";
    dialog.querySelector("#upload-field").hidden = fields.message_type.value === "TEXT";
    fields.fallback.closest("label").hidden = fields.missing_policy.value !== "fallback";
  };
  form.addEventListener("input", preview);
  preview();
  bindForm(form, async ({ demo_name, demo_email, demo_amount, ...data }) => {
    const upload = form.querySelector("#template-file");
    if (data.message_type !== "TEXT" && upload.files.length) {
      const response = await fetch(endpoint(project, "media"), {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: upload.files[0],
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível enviar o arquivo de mídia.");
      form.elements.media_path.value = result.filename;
      data.media_path = result.filename;
      upload.value = "";
      if (result.message_type !== data.message_type) throw new Error("Escolha o tipo de mensagem correspondente ao arquivo.");
    }
    await api(endpoint(project, tpl && !duplicate ? `templates/${encodeURIComponent(tpl.id)}` : "templates"), tpl && !duplicate ? "PUT" : "POST", data);
    dialog.close();
    notify("Template salvo.");
    await render();
  });
}

function renderAutomations(project, { triggers }) {
  const canonical = project.id === "default" && triggers.filter((rule) => rule.legacy).length < 8
    ? button("Configurar etapas canônicas", "seed-canonical") : "";
  main.innerHTML = heading(project.name, "Automações do Funil", "Decida o que enviar, quando enviar e quais condições cada evento deve cumprir.",
    `<div class="row">${canonical}${button("+ Criar Automação", "new-rule", "primary")}</div>`);
  main.insertAdjacentHTML("beforeend", triggers.length ? `<div class="grid">${triggers.map((rule) => `<article class="card stack">
    <div class="card-head"><span class="tile">${icon(nav[4][2])}</span>${badge(rule.is_active ? "Ativa" : "Pausada", rule.is_active ? "good" : "warn")}</div>
    <div><h2>${h(rule.name)}</h2><p>${h(labelEvent(rule.event_type))} · ${h(formatDelay(rule.delay_seconds))}</p></div>
    <div class="notice">Template · ${h(rule.template_name || "Sem template vinculado")}<br>Produto/oferta · ${h([rule.conditions.product_id, rule.conditions.offer_id, rule.conditions.offer_type].filter(Boolean).join(" / ") || "Conforme o evento")}</div>
    <small>${rule.executions} execuções · Última em ${h(date(rule.last_execution))}</small>
    <div class="row">${button("Editar", "edit-rule", "", rule.id)}${button("Duplicar", "duplicate-rule", "", rule.id)}
      ${button(rule.is_active ? "Pausar" : "Ativar", "toggle-rule", "", rule.id)}</div></article>`).join("")}</div>` :
    empty("Nenhuma automação configurada", "Comece com uma regra de entrega para uma compra aprovada.", button("Criar automação", "new-rule", "primary")));
}

const units = [[1, "segundos"], [60, "minutos"], [3600, "horas"], [86400, "dias"]];
function formatDelay(seconds) {
  if (!seconds) return "Imediatamente";
  const [unit, label] = [...units].reverse().find(([unit]) => seconds % unit === 0);
  return `${seconds / unit} ${label}`;
}

async function automationDialog(project, rule, duplicate = false) {
  const [{ templates }, { events }] = await Promise.all([api(endpoint(project, "templates")), api(endpoint(project, "triggers"))]);
  if (state.project?.id !== project.id) return;
  const conditions = rule?.conditions ?? {};
  const legacy = rule?.legacy && !duplicate;
  const seconds = rule?.delay_seconds ?? 0;
  const unit = seconds ? [...units].reverse().find(([unit]) => seconds % unit === 0)[0] : 0;
  const options = (legacy ? [rule.event_type] : events).map((event) => [event, labelEvent(event)]);
  showDialog(duplicate ? "Duplicar automação" : rule ? "Editar automação" : "Criar automação", `<form class="stack">
    <ol class="steps"><li>1. Evento</li><li>2. Condições</li><li>3. Template</li><li>4. Espera</li><li>5. Ativação</li></ol>
    <div class="stack" data-step="0">${field("Nome da automação", "name", duplicate ? rule.name + " (cópia)" : rule?.name, 'required')}
      ${select("Evento Cakto", "event_type", options, rule?.event_type ?? "purchase_approved")}</div>
    <div class="form-grid" data-step="1" hidden>${legacy ? '<p>Esta etapa usa as condições do funil canônico.</p>' : `${field("ID do produto", "product_id", conditions.product_id)}
      ${field("ID da oferta de origem", "offer_id", conditions.offer_id)}
      ${select("Tipo de oferta de origem", "offer_type", [["", "Qualquer"], ["main", "Principal"], ["upsell", "Upsell"], ["downsell", "Downsell"], ["orderbump", "Order bump"]], conditions.offer_type ?? "")}
      ${field("Status da transação", "status", conditions.status, 'placeholder="PAID, REFUSED…"')}
      ${select("Etapa após o evento", "state", [["", "Qualquer"], ...["NEW", "WAITING_PAYMENT", "DELIVERED_MAIN", "DELIVERED_UPSELL_1", "DELIVERED_UPSELL_2", "DELIVERED_DOWNSELL", "REFUNDED"].map((item) => [item, item])], conditions.state ?? "")}
      ${select("Compras anteriores", "prior_purchase", [["", "Qualquer"], ["yes", "Exigir compra anterior"], ["no", "Sem compra anterior"]], conditions.prior_purchase ?? "")}
      ${field("Cancelar se já comprou esta oferta", "skip_if_offer_purchased", conditions.skip_if_offer_purchased, 'placeholder="ID da oferta de destino"')}
      ${check("Mensagem promocional (exige autorização)", "marketing", conditions.marketing)}`}</div>
    <div class="stack" data-step="2" hidden>${select("Template do projeto", "template_id", [["", "Selecione"], ...templates.map((tpl) => [tpl.id, tpl.name])], rule?.template_id ?? "")}
      ${templates.length ? "" : '<p>Crie um template na área de Templates para ativar esta regra.</p>'}</div>
    <div class="form-grid" data-step="3" hidden>${select("Quando executar", "unit", [[0, "Imediatamente"], ...units], unit)}
      ${field("Quantidade", "delay", unit ? seconds / unit : 0, 'type="number" min="0" max="31536000" step="1" required')}</div>
    <div class="stack" data-step="4" hidden>${select("Status da automação", "is_active", [[0, "Pausada (rascunho)"], [1, "Ativa"]], duplicate ? 0 : rule?.is_active ?? 0)}
      <div class="notice" id="rule-review"></div></div>
    ${formError}<div class="dialog-actions">${button("Voltar", "rule-back")}${button("Avançar", "rule-next", "primary")}
      <button type="submit" class="button primary" hidden>Salvar automação</button></div>
  </form>`);
  const form = dialog.querySelector("form");
  let step = 0;
  const showStep = () => {
    form.querySelectorAll("[data-step]").forEach((panel) => { panel.hidden = Number(panel.dataset.step) !== step; });
    form.querySelectorAll("ol li").forEach((item, index) => {
      item.toggleAttribute("aria-current", index === step);
      if (index === step) item.setAttribute("aria-current", "step");
    });
    form.querySelector("[data-action=rule-back]").hidden = step === 0;
    form.querySelector("[data-action=rule-next]").hidden = step === 4;
    form.querySelector("[type=submit]").hidden = step !== 4;
    form.querySelector("#rule-review").textContent = `${labelEvent(form.elements.event_type.value)} → ${formatDelay(Number(form.elements.unit.value) * Number(form.elements.delay.value))} → ${form.elements.template_id.selectedOptions[0].textContent}`;
  };
  form.querySelector("[data-action=rule-next]").onclick = () => {
    if ([...form.querySelectorAll(`[data-step="${step}"] input`)].every((field) => field.reportValidity())) {
      step++;
      showStep();
    }
  };
  form.querySelector("[data-action=rule-back]").onclick = () => { step--; showStep(); };
  form.elements.unit.onchange = () => {
    form.elements.delay.closest("label").hidden = form.elements.unit.value === "0";
    if (!Number(form.elements.delay.value) && form.elements.unit.value !== "0") form.elements.delay.value = "1";
  };
  form.elements.unit.onchange();
  showStep();
  bindForm(form, async (values) => {
    const { name, event_type, template_id, is_active, delay, unit, marketing, ...fields } = values;
    const conditions = Object.fromEntries(Object.entries(fields).filter(([, value]) => value.trim()).map(([key, value]) =>
      [key, key === "status" ? value.trim().toUpperCase() : value.trim()]));
    if (!legacy) conditions.marketing = marketing === "on";
    await api(endpoint(project, rule && !duplicate ? `triggers/${encodeURIComponent(rule.id)}` : "triggers"), rule && !duplicate ? "PUT" : "POST", {
      name, event_type, template_id: template_id || null, is_active: Number(is_active), delay_seconds: Number(delay) * Number(unit), conditions,
    });
    dialog.close();
    notify("Automação salva.");
    await render();
  });
}

function renderQueue(project, { jobs }) {
  main.innerHTML = heading(project.name, "Fila de Mensagens", "Consulte os envios agendados e acompanhe os resultados deste projeto.") +
    `<div class="stack"><div class="toolbar">
      ${select("Status", "queue_status", [["", "Todos"], ...["PENDING", "PROCESSING", "SENT", "FAILED", "CANCELLED"].map((value) => [value, statusLabels[value]])], state.queueStatus, 'id="queue-status"')}
      ${button("Atualizar", "refresh")}
      ${button("Cancelar disparos de teste", "cancel-test-jobs", "danger")}
    </div>` +
    table(["Tipo", "Destinatário", "Agendado para", "Status", "Tentativas", "Falha", "Ações"], jobs.map((job) => [
      h(job.automation || job.message_type), h(job.phone), h(date(job.scheduled_at)), jobStatus(job), h(job.attempts),
      h(job.last_error === "ENVIO_INDETERMINADO" ? "Envio indeterminado após interrupção" : job.last_error || "—"),
      `<div class="row compact">
        ${button("Linha do tempo", "timeline-job", "", job.id)}
        ${job.status === "PENDING" ? button("Cancelar", "cancel-job", "", job.id)
          : job.status === "FAILED" && job.last_error !== "ENVIO_INDETERMINADO" ? button("Reprocessar", "retry-job", "", job.id) : ""}
      </div>`,
    ]), "Nenhuma mensagem neste filtro") + "</div>";
}

function renderLab(project, { diagnostics, templates, events = [] }) {
  const system = diagnostics.worker;
  const caktoEvents = events.filter((e) => e.authenticated === 1 || e.result === "TEST" || e.result === "PROBE" || e.result === "PROCESSED" || e.result === "AMBIGUOUS");
  const eventRows = caktoEvents.slice(0, 20).map((evt) => {
    const authBadge = evt.authenticated ? badge("Válida", "good") : badge("Falhou", "bad");
    let classBadge = "";
    if (evt.result === "TEST") classBadge = badge("Teste Cakto", "warn");
    else if (evt.result === "PROBE") classBadge = badge("Conectividade (Probe)", "");
    else if (evt.result === "PROCESSED") classBadge = badge("Produção", "good");
    else if (evt.result === "AMBIGUOUS") classBadge = badge("Ambíguo (Retido)", "warn");
    else classBadge = badge(statusLabels[evt.result] || evt.result, "bad");

    return [
      h(date(evt.created_at)),
      h(labelEvent(evt.event_type || "—")),
      authBadge,
      classBadge,
      h(evt.product_id || "—"),
      h(evt.details || "—"),
      `<div class="row compact">
        ${button("Testar automações", "test-webhook-event", "primary compact", evt.id)}
        ${button("Ver payload", "view-webhook-payload", "compact", evt.id)}
      </div>`,
    ];
  });

  main.innerHTML = heading(project.name, "Laboratório de Testes", "Valide as regras com simulação isolada ou execute disparos reais para números autorizados.") +
    `<div class="stack"><div class="grid">
      <section class="panel stack"><span class="tile">${icon(nav[3][2])}</span><h2>Testar mensagem</h2>
        <p>Veja a prévia de um template salvo e informe os dados do destinatário de teste.</p>
        <form id="choose-test" class="stack">${select("Template", "template_id", templates.map((tpl) => [tpl.id, tpl.name]), templates[0]?.id)}
        ${formError}<div><button class="button primary" type="submit"${templates.length ? "" : " disabled"}>Abrir teste de mensagem</button></div></form></section>
      <section class="panel stack"><span class="tile">${icon(nav[6][2])}</span><h2>Simular evento Cakto (Dry Run)</h2>
        <p>Confira as condições, os templates e os horários de agendamento em simulação isolada sem envio real.</p>
        <div>${button("Simular Webhook", "simulate-dialog", "primary")}</div></section>
      <section class="panel stack"><span class="tile">${icon(nav[5][2])}</span><h2>Teste Real de Disparo</h2>
        <p>Dispare para um número autorizado avaliando automações reais sem impactar vendas de produção.</p>
        <div>${button("Novo Teste Real", "test-dispatch-dialog", "primary")}</div></section>
    </div>

    <section class="panel stack">
      <div class="card-head">
        <div>
          <h2>Teste de Webhook Externo da Cakto</h2>
          <p>Eventos enviados pela Cakto para a URL deste projeto. Verifique a autenticação e execute testes com payloads de exemplo ou eventos reais.</p>
        </div>
        ${button("Atualizar", "refresh")}
      </div>
      ${table(["Data / Hora", "Tipo Identificado", "Autenticação", "Classificação", "Produto", "Normalização / Detalhes", "Ações"], eventRows, "Nenhum webhook recebido da Cakto até o momento")}
    </section>

    <section class="panel stack"><div class="card-head"><h2>Diagnóstico</h2>${button("Atualizar", "refresh")}</div>
    <div class="grid">
      <div><small>WhatsApp global</small>${badge(state.connection?.connected ? "Conectado" : "Desconectado", state.connection?.connected ? "good" : "warn")}</div>
      <div><small>Banco global</small>${badge(diagnostics.database === "connected" ? "Conectado" : "Indisponível", diagnostics.database === "connected" ? "good" : "bad")}</div>
      <div><small>Processador da fila global</small>${badge(system ? system.isRunning ? "Ativo" : "Parado" : "Não informado", system?.isRunning ? "good" : "warn")}</div>
      <div><small>Fila deste projeto</small><strong>${project.stats.pending_queue} pendentes</strong></div>
      <div><small>Webhook deste projeto</small><strong>${project.integration_verified ? "Evento real validado" : "Aguardando evento real"}</strong></div>
      <div><small>Última falha na fila</small><strong>${h(date(diagnostics.last_failure?.updated_at))}</strong></div>
      <div><small>Última execução de automação</small><strong>${h(date(diagnostics.last_execution?.updated_at))}</strong></div>
    </div></section></div>`;
  bindForm(main.querySelector("#choose-test"), async ({ template_id }) => {
    const template = templates.find((item) => item.id === template_id);
    if (template) testTemplateDialog(project, template);
  });
}

function testDispatchDialog(project) {
  showDialog("Novo Teste Real de Disparo", `<form class="stack" id="form-test-dispatch">
    <div class="notice">
      Este teste avalia as regras reais do projeto e <strong>agenda o envio verdadeiro via WhatsApp</strong> para o número informado.<br>
      O evento e a ordem são marcados como <code>TEST</code> e <strong>não afetam os relatórios nem as métricas de conversão de produção</strong>.
    </div>
    <div class="form-grid">
      ${field("Seu WhatsApp para receber o teste", "phone", "", 'type="tel" required placeholder="5511999998888"')}
      ${field("Nome do comprador de teste", "name", "Usuário Teste", "required")}
      ${select("Evento a disparar", "event_type", Object.entries(eventLabels), "purchase_approved")}
      ${select("Tipo da oferta", "offer_type", [["main", "Produto principal (main)"], ["upsell", "Upsell 1 / 2"], ["downsell", "Downsell"], ["orderbump", "Order Bump"]], "main")}
      ${select("Comportamento do Delay", "fast_delay", [["fast", "Disparo imediato / rápido (2s para homologação)"], ["real", "Respeitar delay real configurado na regra"]], "fast")}
      ${field("Valor da compra (R$)", "amount", "97.00", 'type="number" min="0" step="0.01"')}
    </div>
    <div class="stack compact">
      ${check("Declaro expressamente que este número de WhatsApp me pertence ou foi autorizado para receber este teste de disparo.", "authorized", false, 'required')}
      ${check("Simular que o destinatário autorizou mensagens de marketing (necessário para ofertas de upsell)", "marketing_consent", true)}
    </div>
    ${formError}
    <div id="test-dispatch-result" class="stack" aria-live="polite"></div>
    <div class="dialog-actions">
      <button class="button primary" type="submit" id="btn-submit-test-dispatch">Executar Disparo Real de Teste</button>
    </div>
  </form>`, true);

  bindForm(dialog.querySelector("#form-test-dispatch"), async ({ phone, name, event_type, offer_type, fast_delay, amount, authorized, marketing_consent }) => {
    if (authorized !== "on") {
      throw new Error("Confirme a autorização do número de telefone antes de disparar.");
    }
    const result = await api(endpoint(project, "test-dispatch"), "POST", {
      phone,
      name,
      event_type,
      offer_type,
      fast_delay: fast_delay === "fast",
      amount: amount ? Number(amount) : 97,
      authorized: true,
      marketing_consent: marketing_consent === "on",
    });

    const resultBox = dialog.querySelector("#test-dispatch-result");
    const jobsCount = result.jobs ? result.jobs.length : 0;
    resultBox.innerHTML = `
      <div class="notice" style="border-left: 3px solid #22c55e;">
        <strong>Disparo de teste iniciado!</strong><br>
        Identificador do evento: <code>${h(result.transaction_id)}</code><br>
        Mensagens agendadas: <strong>${jobsCount}</strong><br>
        ${fast_delay === "fast" ? "O worker do WhatsApp processará os envios em poucos segundos." : "Os envios seguirão os delays configurados."}
      </div>
      ${table(["Automação", "Template", "Espera", "Resultado"], result.evaluations.map((rule) => [
        h(rule.name), h(rule.template || "—"), h(formatDelay(rule.delay_seconds)), h(rule.result)
      ]), "Nenhuma regra avaliada")}
    `;
    notify("Disparo de teste registrado.");
  });
}

async function testWebhookEventDialog(project, eventId) {
  showDialog("Testar Automações com Evento Cakto", `<div class="stack" id="test-event-loading"><p class="muted">Carregando dados do evento...</p></div>`, true);
  try {
    const data = await api(endpoint(project, `webhooks/${encodeURIComponent(eventId)}`));
    const { event, payload, matched_automations } = data;
    const container = dialog.querySelector("#test-event-loading");
    if (!container) return;

    const matchedList = matched_automations && matched_automations.length ? matched_automations.join(", ") : "Nenhuma correspondente direta identificada";

    container.outerHTML = `
      <div class="stack">
        <div class="notice">
          <strong>Evento #${h(event.id)}:</strong> ${h(labelEvent(event.event_type || "Evento"))} · 
          <strong>Resultado:</strong> ${h(event.result)} · 
          <strong>Produto:</strong> <code>${h(event.product_id || "—")}</code><br>
          <strong>Automações ativas elegíveis:</strong> ${h(matchedList)}
        </div>

        <div class="tabs-segmented" role="tablist" style="display:flex;gap:8px;margin-bottom:12px;">
          <button type="button" class="button active" id="tab-btn-sim" style="flex:1;">Opção 1 — Simulação Isolada</button>
          <button type="button" class="button" id="tab-btn-disp" style="flex:1;">Opção 2 — Teste com Envio Real</button>
        </div>

        <!-- Opcao 1: Simulacao -->
        <div id="tab-sim-content" class="stack">
          <p class="muted">Avalie as regras, templates e horários deste projeto sem realizar envios nem criar pedidos comerciais.</p>
          <div class="dialog-actions">
            <button type="button" class="button primary" id="btn-exec-simulate">Executar Simulação Isolada</button>
          </div>
        </div>

        <!-- Opcao 2: Teste de Disparo Real -->
        <div id="tab-disp-content" class="stack" style="display:none;">
          <div class="notice">
            Dispara as mensagens de teste <strong>exclusivamente para seu número autorizado</strong>.<br>
            Os jobs serão marcados como <code>TEST</code> e <strong>não alteram vendas reais de produção</strong>.
          </div>
          <form id="form-webhook-dispatch" class="stack">
            <div class="form-grid">
              ${field("Seu WhatsApp para receber o teste", "phone", "", 'type="tel" required placeholder="5511999998888"')}
              ${field("Nome do comprador de teste", "name", "Usuário Homologação", "required")}
              ${select("Comportamento do Delay", "fast_delay", [["fast", "Disparo rápido (2s para homologação)"], ["real", "Respeitar delay real configurado"]], "fast")}
            </div>
            <div class="stack compact">
              ${check("Declaro expressamente que este número de WhatsApp me pertence ou foi autorizado para este teste.", "authorized", false, 'required')}
              ${check("Simular que o destinatário autorizou ofertas de marketing (upsell/downsell)", "marketing_consent", true)}
            </div>
            ${formError}
            <div class="dialog-actions">
              <button type="submit" class="button primary" id="btn-exec-dispatch">Executar Teste Autorizado</button>
            </div>
          </form>
        </div>

        <div id="webhook-test-result" class="stack" aria-live="polite"></div>
      </div>
    `;

    const tabSimBtn = dialog.querySelector("#tab-btn-sim");
    const tabDispBtn = dialog.querySelector("#tab-btn-disp");
    const tabSimContent = dialog.querySelector("#tab-sim-content");
    const tabDispContent = dialog.querySelector("#tab-disp-content");
    const resultBox = dialog.querySelector("#webhook-test-result");

    tabSimBtn.addEventListener("click", () => {
      tabSimBtn.classList.add("active");
      tabDispBtn.classList.remove("active");
      tabSimContent.style.display = "block";
      tabDispContent.style.display = "none";
    });

    tabDispBtn.addEventListener("click", () => {
      tabDispBtn.classList.add("active");
      tabSimBtn.classList.remove("active");
      tabSimContent.style.display = "none";
      tabDispContent.style.display = "block";
    });

    dialog.querySelector("#btn-exec-simulate").addEventListener("click", async () => {
      resultBox.innerHTML = '<p class="muted">Executando simulação...</p>';
      try {
        const res = await api(endpoint(project, `webhooks/${encodeURIComponent(eventId)}/test`), "POST", { mode: "simulate" });
        resultBox.innerHTML = `
          <div class="notice" style="border-left: 3px solid #0ea5e9;">
            <strong>Simulação concluída!</strong> Evento: <code>${h(res.event_type)}</code> · Transação simulada: <code>${h(res.transaction_id)}</code>
          </div>
          ${table(["Automação", "Template", "Espera", "Resultado"], res.evaluations.map((rule) => [
            h(rule.name), h(rule.template || "—"), h(formatDelay(rule.delay_seconds)), h(rule.result)
          ]), "Nenhuma regra avaliada")}
        `;
        notify("Simulação isolada concluída.");
      } catch (err) {
        resultBox.innerHTML = `<p class="notice error">${h(err.message)}</p>`;
      }
    });

    bindForm(dialog.querySelector("#form-webhook-dispatch"), async ({ phone, name, fast_delay, authorized, marketing_consent }) => {
      if (authorized !== "on") throw new Error("Confirme a autorização do número de telefone antes de disparar.");
      resultBox.innerHTML = '<p class="muted">Agendando teste de disparo...</p>';
      const res = await api(endpoint(project, `webhooks/${encodeURIComponent(eventId)}/test`), "POST", {
        mode: "dispatch",
        phone,
        name,
        fast_delay: fast_delay === "fast",
        authorized: true,
        marketing_consent: marketing_consent === "on",
      });
      const jobsCount = res.jobs ? res.jobs.length : 0;
      resultBox.innerHTML = `
        <div class="notice" style="border-left: 3px solid #22c55e;">
          <strong>Teste autorizado registrado com sucesso!</strong><br>
          Identificador: <code>${h(res.transaction_id)}</code><br>
          Mensagens agendadas: <strong>${jobsCount}</strong><br>
          ${fast_delay === "fast" ? "O worker do WhatsApp processará os disparos em poucos segundos." : "Os envios seguirão os delays configurados nas regras."}
        </div>
        ${table(["Automação", "Template", "Espera", "Resultado"], res.evaluations.map((rule) => [
          h(rule.name), h(rule.template || "—"), h(formatDelay(rule.delay_seconds)), h(rule.result)
        ]), "Nenhuma regra avaliada")}
      `;
      notify("Teste autorizado agendado na fila.");
    });

  } catch (err) {
    const container = dialog.querySelector("#test-event-loading");
    if (container) container.innerHTML = `<p class="notice error">Erro ao carregar evento: ${h(err.message)}</p>`;
  }
}

async function viewWebhookPayloadDialog(project, eventId) {
  showDialog(`Payload do Webhook #${eventId}`, `<div class="stack" id="view-payload-loading"><p class="muted">Carregando payload...</p></div>`, true);
  try {
    const data = await api(endpoint(project, `webhooks/${encodeURIComponent(eventId)}`));
    const container = dialog.querySelector("#view-payload-loading");
    if (!container) return;

    const payloadStr = data.payload ? JSON.stringify(data.payload, null, 2) : "Nenhum payload registrado no banco.";
    container.outerHTML = `
      <div class="stack">
        <div class="row" style="gap:16px;">
          <div><small>Status</small><br>${badge(data.event.result, data.event.result === "PROCESSED" ? "good" : data.event.result === "TEST" ? "warn" : "")}</div>
          <div><small>Autenticação</small><br>${data.event.authenticated ? badge("Aprovada", "good") : badge("Falhou", "bad")}</div>
          <div><small>Evento</small><br><strong>${h(labelEvent(data.event.event_type || "—"))}</strong></div>
          <div><small>Recebido em</small><br><strong>${h(date(data.event.created_at))}</strong></div>
        </div>
        <pre style="background:var(--bg-card);padding:12px;border-radius:6px;max-height:360px;overflow:auto;font-size:12px;border:1px solid var(--border);"><code>${h(payloadStr)}</code></pre>
        <div class="dialog-actions">
          ${button("Testar automações", "test-webhook-event", "primary", eventId)}
        </div>
      </div>
    `;
  } catch (err) {
    const container = dialog.querySelector("#view-payload-loading");
    if (container) container.innerHTML = `<p class="notice error">Erro ao carregar payload: ${h(err.message)}</p>`;
  }
}

async function jobTimelineDialog(project, jobId) {
  showDialog("Linha do tempo da mensagem", `<div class="stack" id="timeline-loading"><p class="muted">Carregando linha do tempo...</p></div>`, true);
  try {
    const data = await api(endpoint(project, `queue/${encodeURIComponent(jobId)}/timeline`));
    const { job, order, webhook_event } = data;

    const timelineContainer = dialog.querySelector("#timeline-loading");
    if (!timelineContainer) return;

    const steps = [
      {
        title: "1. Evento recebido",
        time: webhook_event?.created_at || order?.created_at || job.created_at,
        state: "good",
        statusText: "Concluído",
        desc: `Evento ${h(labelEvent(order?.event_type || webhook_event?.event_type || "Evento"))} recebido (${job.is_test ? "Identificado como TEST" : "Produção"})`,
      },
      {
        title: "2. Validado",
        time: order?.created_at || job.created_at,
        state: "good",
        statusText: "Concluído",
        desc: `Transação ${h(order?.transaction_id || "Validada")} · Pedido registrado`,
      },
      {
        title: "3. Automação identificada",
        time: job.created_at,
        state: "good",
        statusText: "Concluído",
        desc: `Regra: ${h(job.trigger_name || job.automation || "Automação")} · Template: ${h(job.template_name || "Template padrão")}`,
      },
      {
        title: "4. Mensagem agendada",
        time: job.scheduled_at,
        state: "good",
        statusText: "Concluído",
        desc: `Agendado para envio (delay de ${formatDelay(job.delay_seconds || 0)})`,
      },
      {
        title: "5. Processando",
        time: job.status !== "PENDING" ? job.updated_at : null,
        state: job.status === "PROCESSING" ? "warn" : job.status === "PENDING" ? "" : "good",
        statusText: job.status === "PROCESSING" ? "Em andamento" : job.status === "PENDING" ? "Aguardando horário" : "Concluído",
        desc: `Tentativas: ${job.attempts}`,
      },
      {
        title: "6. Enviada",
        time: job.status === "SENT" ? job.updated_at : null,
        state: job.status === "SENT" ? "good" : job.status === "FAILED" ? "bad" : job.status === "CANCELLED" ? "warn" : "",
        statusText: job.status === "SENT" ? "Enviada" : job.status === "FAILED" ? "Falha de processamento" : job.status === "CANCELLED" ? "Cancelada" : "Aguardando envio",
        desc: job.status === "SENT" ? `Despachado ao WhatsApp (ID Meta: ${h(job.whatsapp_message_id || "gerado")})`
          : job.status === "FAILED" ? "Falha na comunicação com o provedor WhatsApp"
          : job.status === "CANCELLED" ? "Disparo cancelado antes do envio"
          : "Aguardando execução do worker",
        error: job.status === "FAILED" ? (job.last_error || "Erro no despacho") : undefined,
      },
      {
        title: "7. Entregue",
        time: job.delivered_at || null,
        state: job.delivered_at ? "good" : job.status === "SENT" ? "warn" : "",
        statusText: job.delivered_at ? "Entregue" : job.status === "SENT" ? "Aguardando confirmação do provedor" : (job.status === "FAILED" || job.status === "CANCELLED") ? "Não entregue" : "Aguardando envio",
        desc: job.delivered_at ? "Confirmação de recebimento registrada do handset do destinatário (DELIVERY_ACK)."
          : job.status === "SENT" ? "A mensagem foi despachada pela VPS. Aguardando recibo de entrega do aparelho do destinatário."
          : "Entrega não realizada.",
      },
    ];

    const timelineHtml = `
      <div class="panel stack">
        <div class="card-head">
          <div>
            <strong>Destinatário:</strong> ${h(job.phone)} · <strong>Tipo:</strong> ${h(job.message_type)}
            ${job.is_test ? '<span class="pill" style="margin-left:6px;font-size:10px;">TESTE</span>' : ''}
          </div>
          <div>${jobStatus(job)}</div>
        </div>
        <div class="timeline">
          ${steps.map((s, idx) => `
            <div class="timeline-item">
              <div class="timeline-dot ${s.state}">${idx + 1}</div>
              <div class="timeline-head">
                <span class="timeline-title">${h(s.title)}</span>
                <span class="timeline-time">${s.time ? h(date(s.time)) : "—"}</span>
              </div>
              <div class="row compact" style="margin-bottom:4px;">
                ${badge(s.statusText, s.state)}
              </div>
              <div class="timeline-desc">${h(s.desc)}</div>
              ${s.error ? `<div class="timeline-error">${h(s.error)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;

    timelineContainer.outerHTML = timelineHtml;
  } catch (error) {
    const timelineContainer = dialog.querySelector("#timeline-loading");
    if (timelineContainer) timelineContainer.innerHTML = `<p class="notice error">Erro ao carregar linha do tempo: ${h(error.message)}</p>`;
  }
}

function simulationDialog(project) {
  const targetWebhookUrl = project.webhook_url || `${state.public_base_url || location.origin}/api/webhook/cakto/${encodeURIComponent(project.slug)}`;
  showDialog("Simular evento Cakto", `<form class="stack">
    <div class="notice">Simulação isolada do endpoint: <code>${h(targetWebhookUrl)}</code>. A prévia usa dados de teste e não envia mensagens.</div>
    <div class="form-grid">
      ${select("Evento", "event", Object.entries(eventLabels), "purchase_approved")}
      ${field("Telefone fictício", "phone", "5511999990000", 'type="tel" required')}
      ${field("Nome fictício", "name", "Cliente de simulação", "required")}
      ${field("E-mail fictício", "email", "", 'type="email"')}
      ${select("Produto vinculado", "product_id", [["", "Produto principal"], ...project.additional_products.map((id) => [id, id])], "")}
      ${field("ID da oferta", "offer_id")}
      ${field("Valor do pedido", "amount", "", 'type="number" min="0" step="0.01"')}
    </div>${check("Simular destinatário que autorizou ofertas", "marketing_consent")}
    ${formError}<div id="simulation-result" class="stack" aria-live="polite"></div>${submit("Executar simulação")}</form>`, true);
  bindForm(dialog.querySelector("form"), async ({ amount, offer_id, marketing_consent, ...values }) => {
    const result = await api("/api/simulator/cakto", "POST", { ...values, project_id: project.id,
      marketing_consent: marketing_consent === "on",
      ...(amount ? { amount: Number(amount) } : {}), ...(offer_id ? { offer_id } : {}) });
    dialog.querySelector("#simulation-result").innerHTML = `<div class="notice">${h(labelEvent(result.simulated_event))} · ${h(project.name)}
      · ${result.jobs.length} mensagens simuladas · Endpoint avaliado: <code>${h(result.simulated_webhook_url || targetWebhookUrl)}</code></div>` +
      table(["Automação", "Template", "Espera", "Resultado"], result.evaluations.map((rule) =>
        [h(rule.name), h(rule.template || "—"), h(formatDelay(rule.delay_seconds)), h(rule.result)]), "Nenhuma regra personalizada encontrada") +
      table(["Tipo", "Horário simulado", "Conteúdo"], result.jobs.map((job) => [h(job.message_type), h(date(job.scheduled_at)), h(job.content)]),
        "Nenhum agendamento na simulação");
    notify("Simulação concluída.");
  });
}

function testTemplateDialog(project, tpl) {
  showDialog("Testar mensagem", `<form class="stack">
    <p>${h(tpl.name)} · ${h(messageTypes.find(([type]) => type === templateType(tpl))?.[1])}</p>
    <div class="form-grid">${field("Número de WhatsApp autorizado", "phone", "", 'type="tel"')}
      ${field("Nome do comprador simulado", "name", "")}
      ${field("E-mail simulado", "email", "", 'type="email"')}
      ${field("Valor simulado", "amount", "", 'type="number" min="0" step="0.01"')}</div>
    ${check("O destinatário autorizou este envio de teste", "authorized")}
    ${formError}<div class="notice" id="template-result" aria-live="polite" hidden></div>
    <div class="dialog-actions"><button class="button" type="submit" value="preview">Visualizar prévia</button>
      <button class="button primary" id="send-template" type="submit" value="send" disabled>Enviar Teste</button></div></form>`);
  const form = dialog.querySelector("form");
  let intent = "preview";
  let reviewed = false;
  const sendButton = form.querySelector("#send-template");
  const updateSend = () => { sendButton.disabled = !reviewed || !form.elements.authorized.checked || !form.elements.phone.value.trim(); };
  form.addEventListener("submit", (event) => { intent = event.submitter?.value ?? "preview"; });
  form.addEventListener("input", (event) => {
    if (!["authorized", "phone"].includes(event.target.name)) reviewed = false;
    updateSend();
  });
  bindForm(form, async ({ amount, authorized, ...values }) => {
    const result = await api(endpoint(project, `templates/${encodeURIComponent(tpl.id)}/test`), "POST", {
      ...values, ...(amount ? { amount: Number(amount) } : {}), authorized: authorized === "on", send: intent === "send",
    });
    const preview = form.querySelector("#template-result");
    preview.textContent = intent === "send" ? "Mensagem de teste enviada." : result.content || "Prévia de mídia pronta.";
    preview.hidden = false;
    reviewed = intent !== "send";
    if (!reviewed) notify("Mensagem de teste enviada.");
  });
  form.addEventListener("submitfinished", updateSend);
}

function renderHistory(project, data) {
  main.innerHTML = heading(project.name, "Histórico", "Acompanhe os registros recentes e inspecione os eventos recebidos.") +
    `<div class="stack"><section class="stack compact"><h2>Atividade do projeto</h2>${activityTable(data.activity)}</section>
    <section class="stack compact"><h2>Eventos Cakto</h2>${webhookTable(data.events)}</section></div>`;
}

function renderSettings(project) {
  main.innerHTML = heading(project.name, "Configurações", "Gerencie o estado do projeto, os links dos templates e as permissões dos destinatários.",
    button("Editar projeto", "edit-project", "", project.id)) +
    `<div class="stack"><section class="panel stack"><div class="card-head"><h2>Operação</h2>
      ${badge(project.is_active ? "Ativo" : "Pausado", project.is_active ? "good" : "warn")}</div>
      <p>${project.is_active ? "O projeto pode agendar e enviar mensagens de acordo com suas automações." : "O projeto recebe eventos Cakto. Os envios aguardam ativação."}</p>
      <div class="row">${button(project.is_active ? "Pausar projeto" : "Ativar projeto", "toggle-project", "primary")}
      <a class="button" href="${h(projectPath(project, "onboarding"))}">Configuração inicial</a></div></section>
      <section class="panel"><form class="stack" id="links-form"><h2>Links dos templates</h2>
        <div class="form-grid">${field("Link geral", "link", project.links.link, 'type="url"')}${field("Link de acesso", "link_acesso", project.links.link_acesso, 'type="url"')}
        ${field("Link de upsell", "link_upsell", project.links.link_upsell, 'type="url"')}${field("Link de downsell", "link_downsell", project.links.link_downsell, 'type="url"')}</div>
        ${formError}${submit("Salvar links")}</form></section>
      <section class="panel"><form class="stack" id="permission-form"><h2>Permissões do destinatário</h2>
        <p>Registre a autorização ou o descadastro deste número para o projeto.</p>
        ${field("Telefone do destinatário", "phone", "", 'type="tel" required')}
        <div class="row">${check("Autorizou ofertas", "marketing")}${check("Solicitou descadastro", "opted_out")}</div>
        ${formError}${submit("Registrar permissão")}</form></section>
      <section class="panel stack"><h2>WhatsApp global</h2><p>A conexão é compartilhada pelos projetos.</p>
      <div>${button("Gerenciar conexão", "whatsapp-dialog")}</div></section></div>`;
  bindForm(main.querySelector("#links-form"), async (links) => {
    await api(endpoint(project), "PUT", { links: { ...project.links, ...links } });
    notify("Links atualizados.");
  });
  bindForm(main.querySelector("#permission-form"), async ({ phone, marketing, opted_out }, form) => {
    await api(endpoint(project, "contact-permissions"), "POST", { phone, marketing: marketing === "on", opted_out: opted_out === "on" });
    form.reset();
    notify("Permissão registrada.");
  });
}

async function updateConnection() {
  try {
    state.connection = await api("/api/whatsapp/status");
  } catch {
    state.connection = null;
  }
  const online = Boolean(state.connection?.connected);
  document.querySelector(".signal").classList.toggle("online", online);
  document.querySelector("#connection-state").textContent = online ? "Conectado" : state.connection ? "Desconectado" : "Status indisponível";
  const projectIndicator = document.querySelector("#project-wa");
  if (projectIndicator) {
    projectIndicator.firstElementChild.classList.toggle("online", online);
    projectIndicator.lastElementChild.textContent = online ? "WhatsApp conectado" : state.connection ? "WhatsApp desconectado" : "Status do WhatsApp";
  }
  if (dialog.open && dialog.querySelector("#wa-state")) refreshConnectionDialog();
}

function refreshConnectionDialog() {
  const data = state.connection;
  const qr = dialog.querySelector("#wa-qr");
  dialog.querySelector("#wa-state").textContent = data?.connected ? "Conectado" : data?.status ?? "Indisponível";
  if (data?.qr && state.lastQr !== data.qr) qr.src = "/api/whatsapp/qr?t=" + Date.now();
  state.lastQr = data?.qr;
  qr.hidden = !data?.qr;
  const pairingCode = dialog.querySelector("#pairing-code");
  pairingCode.hidden = !data?.pairing_code;
  pairingCode.textContent = data?.pairing_code ?? "";
}

function connectionDialog() {
  state.lastQr = null;
  showDialog("Conexão WhatsApp", `<div class="stack">
    <p>Conexão compartilhada por todos os projetos.</p>
    <strong id="wa-state" aria-live="polite">Consultando…</strong>
    <img class="qr" id="wa-qr" alt="QR de pareamento do WhatsApp" hidden>
    <form class="stack">${field("Telefone para pareamento", "phone", "", 'type="tel" required')}
      ${formError}${submit("Gerar código de pareamento")}<strong id="pairing-code" aria-live="polite" hidden></strong></form>
    <div class="row">${button("Reconectar", "wa-reconnect")}${button("Desconectar", "wa-disconnect")}${button("Encerrar sessão", "wa-logout", "danger")}</div></div>`);
  refreshConnectionDialog();
  bindForm(dialog.querySelector("form"), async (data) => {
    const result = await api("/api/whatsapp/pair", "POST", data);
    state.connection = { ...state.connection, pairing_code: result.pairing_code };
    refreshConnectionDialog();
  });
}

function monitorWebhook(project) {
  showDialog("Aguardando evento real", '<div class="stack"><p>Envie um evento pela Cakto para a URL deste projeto.</p><div class="notice" id="monitor-state" aria-live="polite">Consultando o histórico…</div></div>');
  const lastId = state.data?.events?.[0]?.id ?? 0;
  let timer;
  const monitor = async () => {
    const output = dialog.querySelector("#monitor-state");
    if (!dialog.open || !output) return;
    try {
      const { events } = await api(endpoint(project, "webhooks"));
      if (!output.isConnected) return;
      const current = events.find((event) => event.id > lastId && event.result === "PROCESSED") ??
        events.find((event) => event.id > lastId);
      if (current) {
        output.textContent = `${labelEvent(current.event_type)} · ${statusLabels[current.result] ?? current.result} · ${date(current.created_at)}`;
        if (current.result === "PROCESSED") {
          await render();
          return;
        }
      } else output.textContent = "Aguardando uma nova entrega…";
    } catch (error) {
      output.textContent = error.message;
    }
    if (output.isConnected && dialog.open) timer = setTimeout(monitor, 3000);
  };
  dialog.addEventListener("close", () => clearTimeout(timer), { once: true });
  void monitor();
}

const pageData = {
  overview: (project) => api(endpoint(project, `dashboard?days=${state.days}`)),
  integration: (project) => api(endpoint(project, "webhooks")),
  orders: (project) => api(endpoint(project, "orders")),
  templates: (project) => api(endpoint(project, "templates")),
  automations: (project) => api(endpoint(project, "triggers")),
  queue: (project) => api(endpoint(project, `queue?status=${encodeURIComponent(state.queueStatus)}`)),
  lab: async (project) => {
    const [diagnostics, { templates }, { events }] = await Promise.all([
      api(endpoint(project, "diagnostics")),
      api(endpoint(project, "templates")),
      api(endpoint(project, "webhooks")),
    ]);
    return { diagnostics, templates, events: events || [] };
  },
  history: async (project) => {
    const [{ activity }, { events }] = await Promise.all([api(endpoint(project, "dashboard")), api(endpoint(project, "webhooks"))]);
    return { activity, events };
  },
};
const screens = {
  overview: renderOverview, integration: renderIntegration, orders: renderOrders, templates: renderTemplates,
  automations: renderAutomations, queue: renderQueue, lab: renderLab, history: renderHistory, settings: renderSettings, onboarding: renderOnboarding,
};

async function render() {
  const revision = ++state.revision;
  main.setAttribute("aria-busy", "true");
  main.innerHTML = '<div class="skeleton" aria-label="Carregando dados do projeto"></div>';
  try {
    const { projects, public_base_url } = await api("/api/projects");
    if (revision !== state.revision) return;
    state.projects = projects;
    if (public_base_url) state.public_base_url = public_base_url;
    const match = location.hash.match(/^#project\/([^/]+)\/([a-z]+)$/);
    const project = match && projects.find((item) => encodeURIComponent(item.id) === match[1]);
    const view = project && Object.hasOwn(screens, match[2]) ? match[2] : "overview";
    state.project = project || null;
    state.view = view;
    state.data = null;
    renderShell(project, view);
    if (!project) {
      document.title = "Meus Projetos · WhatsAppEntrega";
      renderProjects();
      return;
    }
    const data = Object.hasOwn(pageData, view) ? await pageData[view](project) : {};
    if (revision !== state.revision) return;
    state.data = data;
    document.title = `${nav.find(([key]) => key === view)?.[1] ?? "Configuração inicial"} · ${project.name}`;
    screens[view](project, data);
  } catch (error) {
    if (revision !== state.revision) return;
    main.innerHTML = empty("Não foi possível carregar esta tela", error.message, button("Tentar novamente", "refresh", "primary"));
  } finally {
    if (revision === state.revision) main.setAttribute("aria-busy", "false");
  }
}

function confirmAction(title, text, label, action) {
  showDialog(title, `<form class="stack"><p>${h(text)}</p>${formError}${submit(label)}</form>`);
  bindForm(dialog.querySelector("form"), action);
}

async function runAction(target) {
  const { action, id } = target.dataset;
  const project = state.project;
  const selected = state.projects.find((item) => item.id === id);
  const tpl = state.data?.templates?.find((item) => item.id === id);
  const rule = state.data?.triggers?.find((item) => item.id === id);
  switch (action) {
    case "close-dialog": dialog.close(); break;
    case "refresh": await Promise.all([render(), updateConnection()]); break;
    case "create-project": projectDialog(); break;
    case "edit-project": if (selected) projectDialog(selected); break;
    case "duplicate-project": {
      const { project: copy } = await api(endpoint(selected, "duplicate"), "POST", {});
      notify("Projeto duplicado como rascunho.");
      location.hash = projectPath(copy, "onboarding");
      break;
    }
    case "archive-project":
      confirmAction("Excluir da central", `Arquivar ${selected.name} e pausar seus envios? O histórico continuará armazenado.`, "Arquivar projeto", async () => {
        await api(endpoint(selected), "DELETE", {});
        dialog.close();
        notify("Projeto arquivado.");
        await render();
      });
      break;
    case "step-next":
    case "step-back":
      await api(endpoint(project), "PUT", { onboarding_step: project.onboarding_step + (action === "step-next" ? 1 : -1) });
      await render();
      break;
    case "copy-webhook": {
      const input = main.querySelector("#webhook-url");
      const urlValue = input?.value || "";
      const validation = validateWebhookConfig(urlValue);
      if (!validation.valid) {
        notify(validation.message, "error");
        alert("Configuração de Webhook Incorreta:\n\n" + validation.message);
        break;
      }
      try {
        await navigator.clipboard.writeText(urlValue);
        notify("URL pública copiada com sucesso.");
      } catch {
        input.select();
        notify("URL selecionada. Pressione Ctrl+C para copiar.");
      }
      break;
    }
    case "simulate-dialog": simulationDialog(project); break;
    case "monitor-webhook": monitorWebhook(project); break;
    case "webhook-detail": {
      const event = state.data.events.find((item) => String(item.id) === id);
      showDialog("Detalhes do webhook", `<p>${h(project.name)} · ${h(statusLabels[event.result])}</p>
        ${event.details ? `<p>${h(event.details)}</p>` : ""}<pre class="code">${h(event.payload_json ? JSON.stringify(JSON.parse(event.payload_json), null, 2) : "Sem payload disponível para este evento.")}</pre>`);
      break;
    }
    case "new-template": templateDialog(project); break;
    case "edit-template": templateDialog(project, tpl); break;
    case "duplicate-template": templateDialog(project, tpl, true); break;
    case "test-template": testTemplateDialog(project, tpl); break;
    case "insert-tag": {
      const content = dialog.querySelector("textarea");
      content.setRangeText(`{${id}}`, content.selectionStart, content.selectionEnd, "end");
      content.dispatchEvent(new Event("input", { bubbles: true }));
      content.focus();
      break;
    }
    case "new-rule": await automationDialog(project); break;
    case "seed-canonical":
      await api(endpoint(project, "canonical-triggers"), "POST", {});
      notify("Etapas canônicas configuradas.");
      await render();
      break;
    case "edit-rule": await automationDialog(project, rule); break;
    case "duplicate-rule": await automationDialog(project, rule, true); break;
    case "toggle-rule":
      await api(endpoint(project, `triggers/${encodeURIComponent(rule.id)}`), "PUT", { ...rule, is_active: rule.is_active ? 0 : 1 });
      notify(rule.is_active ? "Automação pausada." : "Automação ativada.");
      await render();
      break;
    case "toggle-project":
      await api(endpoint(project), "PUT", { is_active: project.is_active ? 0 : 1 });
      notify(project.is_active ? "Projeto pausado." : "Projeto ativado.");
      await render();
      break;
    case "cancel-job":
    case "retry-job": {
      const operation = action === "cancel-job" ? "cancel" : "retry";
      await api(endpoint(project, `queue/${encodeURIComponent(id)}/${operation}`), "POST", {});
      notify(operation === "cancel" ? "Mensagem cancelada." : "Mensagem reagendada.");
      await render();
      break;
    }
    case "test-dispatch-dialog": testDispatchDialog(project); break;
    case "cancel-test-jobs":
      confirmAction("Cancelar disparos de teste", "Deseja cancelar todas as mensagens de teste que ainda estão agendadas na fila deste projeto?", "Cancelar disparos de teste", async () => {
        const res = await api(endpoint(project, "queue/cancel-test-jobs"), "POST", {});
        notify(`${res.cancelled_count} mensagens de teste canceladas.`);
        await render();
      });
      break;
    case "timeline-job": await jobTimelineDialog(project, id); break;
    case "test-webhook-event": await testWebhookEventDialog(project, id); break;
    case "view-webhook-payload": await viewWebhookPayloadDialog(project, id); break;
    case "whatsapp-dialog": connectionDialog(); break;
    case "wa-reconnect":
    case "wa-disconnect":
      await api(`/api/whatsapp/${action.slice(3)}`, "POST", {});
      await updateConnection();
      notify(action === "wa-reconnect" ? "Reconexão solicitada." : "WhatsApp desconectado.");
      break;
    case "wa-logout":
      confirmAction("Encerrar sessão WhatsApp", "Todos os projetos ficarão sem conexão até um novo pareamento.", "Encerrar sessão", async () => {
        await api("/api/whatsapp/logout", "POST", {});
        dialog.close();
        await updateConnection();
        notify("Sessão encerrada.");
      });
      break;
    default: break;
  }
}

search.addEventListener("input", renderSwitcher);
document.querySelector("#switcher-create").addEventListener("click", () => { switcher.open = false; projectDialog(); });
document.querySelector("#connection").addEventListener("click", connectionDialog);
document.querySelector("#mobile-menu").addEventListener("click", (event) => {
  const open = document.querySelector(".sidebar").classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});
main.addEventListener("change", (event) => {
  if (event.target.id === "period") state.days = Number(event.target.value);
  else if (event.target.id === "queue-status") state.queueStatus = event.target.value;
  else return;
  void render();
});
document.addEventListener("click", async (event) => {
  const target = event.target.closest("button[data-action]");
  if (!target || ["rule-back", "rule-next"].includes(target.dataset.action)) return;
  target.disabled = true;
  try {
    await runAction(target);
  } catch (error) {
    notify(error.message, true);
  } finally {
    target.disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  if (location.hash === "#main") return;
  if (dialog.open) dialog.close();
  document.querySelector(".sidebar").classList.remove("open");
  document.querySelector("#mobile-menu").setAttribute("aria-expanded", "false");
  window.scrollTo(0, 0);
  void render();
});
document.querySelector(".skip-link").addEventListener("click", (event) => { event.preventDefault(); main.focus(); });
void render();
void updateConnection();
setInterval(updateConnection, 8000);
