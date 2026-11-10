import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { getDatabase } from "../database/connection.js";
import { createRepositories } from "../database/repositories.js";
import { parseProjectMetadata, publicProject, saveProjectMetadata, workspaceFor } from "./project-workspace.js";

export function createProjectsRouter(database: () => Database.Database = getDatabase): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const repos = createRepositories(database());
    const projects = repos.projects.listAll().filter((project) => !workspaceFor(repos.db, project.id)?.archived_at);
    res.json({ success: true, projects: projects.map((project) => publicProject(repos.db, project)) });
  });

  const save = (req: Request, res: Response): void => {
    const repos = createRepositories(database());
    const id = typeof req.params.id === "string" ? req.params.id : undefined;
    const previous = id ? repos.projects.findById(id) : null;
    if (id && (!previous || workspaceFor(repos.db, id)?.archived_at)) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }
    const body = req.body ?? {};
    const { name, slug, description, cakto_product_id, cakto_webhook_secret, is_active } = body;
    if ((!previous || name !== undefined) && (typeof name !== "string" || !name.trim() || name.length > 150) ||
        (!previous || slug !== undefined) && (typeof slug !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(slug.trim()) || slug.trim().toLowerCase() === "all") ||
        [description, cakto_product_id, cakto_webhook_secret].some((value) => value != null && (typeof value !== "string" || value.length > 2000)) ||
        (is_active !== undefined && ![0, 1].includes(is_active))) {
      res.status(400).json({ error: "Confira o nome, o slug e os dados do projeto." });
      return;
    }
    const cleanSlug = typeof slug === "string" ? slug.trim().toLowerCase() : previous?.slug;
    const taken = cleanSlug ? repos.projects.findBySlug(cleanSlug) : null;
    if (taken && taken.id !== id) {
      res.status(409).json({ error: "Já existe um projeto com este slug." });
      return;
    }
    let metadata: ReturnType<typeof parseProjectMetadata>;
    try {
      metadata = parseProjectMetadata(body);
    } catch {
      res.status(400).json({ error: "Confira o produto, o fuso horário e os links informados." });
      return;
    }
    if (is_active === 1 && previous && !previous.is_active && previous.id !== "default") {
      const current = publicProject(repos.db, previous);
      const validRule = repos.db.prepare(`
        SELECT 1 FROM funnel_triggers f JOIN message_templates t ON t.id = f.template_id AND t.project_id = f.project_id
        WHERE f.project_id = ? AND f.is_active = 1
      `).get(previous.id);
      if (!current.onboarding_checks.slice(1, 5).every(Boolean) || !validRule ||
          cakto_product_id !== undefined || cakto_webhook_secret !== undefined ||
          metadata.links !== null || metadata.additional_products !== null || cleanSlug !== previous.slug) {
        res.status(422).json({ error: "Conclua a integração e a simulação e habilite pelo menos uma automação antes de ativar." });
        return;
      }
    }
    const project = repos.transaction(() => {
      const fields = { name, slug: cleanSlug, description, cakto_product_id, cakto_webhook_secret };
      const saved = id
        ? repos.projects.update(id, { ...fields, is_active })!
        : repos.projects.create({ ...fields, name, slug: cleanSlug!, is_active: 0 });
      const oldMetadata = workspaceFor(repos.db, saved.id);
      const integrationChanged = previous && (previous.cakto_product_id !== saved.cakto_product_id ||
        previous.cakto_webhook_secret !== saved.cakto_webhook_secret || previous.slug !== saved.slug ||
        (metadata.additional_products !== null && metadata.additional_products !== (oldMetadata?.additional_products_json ?? "[]")));
      saveProjectMetadata(repos.db, saved.id, metadata);
      if (integrationChanged) {
        repos.db.prepare(`
          UPDATE project_workspace SET integration_after_id = COALESCE((SELECT MAX(id) FROM webhook_events WHERE project_id = ?), 0)
          WHERE project_id = ?
        `).run(saved.id, saved.id);
      }
      if (integrationChanged || (metadata.links && metadata.links !== oldMetadata?.links_json)) {
        repos.db.prepare("UPDATE project_workspace SET simulated_at = NULL WHERE project_id = ?").run(saved.id);
      }
      return publicProject(repos.db, saved);
    });
    res.status(id ? 200 : 201).json({ success: true, project });
  };
  router.post("/", save);
  router.put("/:id", save);

  router.get("/:id", (req, res) => {
    const repos = createRepositories(database());
    const project = repos.projects.findById(req.params.id) ?? repos.projects.findBySlug(req.params.id);
    if (!project || workspaceFor(repos.db, project.id)?.archived_at) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }
    res.json({ success: true, project: publicProject(repos.db, project) });
  });

  router.post("/:id/duplicate", (req, res) => {
    const repos = createRepositories(database());
    const source = repos.projects.findById(req.params.id);
    if (!source || workspaceFor(repos.db, source.id)?.archived_at) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }
    const project = repos.transaction(() => {
      const base = source.slug.slice(0, 67) + "-copia";
      let slug = base;
      for (let i = 2; repos.projects.findBySlug(slug); i++) slug = `${base}-${i}`;
      const copy = repos.projects.create({ name: source.name + " (cópia)", slug, description: source.description, is_active: 0 });
      const metadata = workspaceFor(repos.db, source.id);
      saveProjectMetadata(repos.db, copy.id, parseProjectMetadata({
        product_name: metadata?.product_name ?? source.name, timezone: metadata?.timezone,
      }));
      const templates = new Map<string, string>();
      for (const template of repos.templates.findAll(source.id)) {
        const clone = repos.templates.create({ ...template, id: undefined, project_id: copy.id });
        templates.set(template.id, clone.id);
        repos.db.prepare("INSERT INTO template_options SELECT ?, category, message_type, missing_policy, fallback FROM template_options WHERE template_id = ?")
          .run(clone.id, template.id);
      }
      for (const trigger of repos.funnelTriggers.listByProject(source.id)) {
        const clone = repos.funnelTriggers.create({
          ...trigger, id: undefined, project_id: copy.id, is_active: 0, media_path: null,
          template_id: trigger.template_id ? templates.get(trigger.template_id) ?? null : null,
        });
        repos.db.prepare("INSERT INTO automation_conditions SELECT ?, conditions_json FROM automation_conditions WHERE trigger_id = ?").run(clone.id, trigger.id);
      }
      return publicProject(repos.db, copy);
    });
    res.status(201).json({ success: true, project });
  });

  router.delete("/:id", (req, res) => {
    const repos = createRepositories(database());
    const id = req.params.id;
    if (id === "default") {
      res.status(400).json({ error: "O projeto padrão não pode ser arquivado." });
      return;
    }
    if (!repos.projects.findById(id) || workspaceFor(repos.db, id)?.archived_at) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }
    repos.transaction(() => {
      repos.projects.update(id, { is_active: 0 });
      repos.db.prepare(`
        INSERT INTO project_workspace (project_id, archived_at) VALUES (?, datetime('now'))
        ON CONFLICT(project_id) DO UPDATE SET archived_at = excluded.archived_at
      `).run(id);
    });
    res.json({ success: true, archived: true });
  });

  router.post("/:id/clear-queue", (req, res) => {
    const repos = createRepositories(database());
    const id = req.params.id;
    if (!repos.projects.findById(id) || workspaceFor(repos.db, id)?.archived_at) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }
    const result = repos.db.prepare(`
      UPDATE message_queue SET status = 'CANCELLED', updated_at = datetime('now') WHERE project_id = ? AND status = 'PENDING'
    `).run(id);
    res.json({ success: true, deleted_count: 0, cancelled_count: result.changes });
  });
  return router;
}

export default createProjectsRouter;
