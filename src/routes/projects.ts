import { Router, Request, Response } from "express";
import { getDatabase } from "../database/connection.js";
import {
  ProjectRepository,
  TemplateRepository,
  MessageQueueRepository,
  CustomerRepository,
  OrderRepository,
  type Project,
} from "../database/repositories.js";

export interface ProjectsRouterOptions {
  projectRepo?: ProjectRepository;
  templateRepo?: TemplateRepository;
  queueRepo?: MessageQueueRepository;
  customerRepo?: CustomerRepository;
  orderRepo?: OrderRepository;
}

export function createProjectsRouter(options: ProjectsRouterOptions = {}): Router {
  const router = Router();

  const getRepos = () => {
    const db = getDatabase();
    return {
      projectRepo: options.projectRepo ?? new ProjectRepository(db),
      templateRepo: options.templateRepo ?? new TemplateRepository(db),
      queueRepo: options.queueRepo ?? new MessageQueueRepository(db),
      customerRepo: options.customerRepo ?? new CustomerRepository(db),
      orderRepo: options.orderRepo ?? new OrderRepository(db),
      db,
    };
  };

  // GET /api/projects - Listar todos os projetos com estatisticas
  router.get("/", (_req: Request, res: Response): void => {
    try {
      const { projectRepo, db } = getRepos();
      const projects = projectRepo.listAll();

      const projectsWithStats = projects.map((p) => {
        const tplCount = (
          db.prepare("SELECT COUNT(*) as count FROM message_templates WHERE project_id = ?").get(p.id) as { count: number }
        )?.count ?? 0;
        const pendingQueue = (
          db.prepare("SELECT COUNT(*) as count FROM message_queue WHERE project_id = ? AND status = 'PENDING'").get(p.id) as { count: number }
        )?.count ?? 0;
        const sentQueue = (
          db.prepare("SELECT COUNT(*) as count FROM message_queue WHERE project_id = ? AND status = 'SENT'").get(p.id) as { count: number }
        )?.count ?? 0;
        const ordersCount = (
          db.prepare("SELECT COUNT(*) as count FROM orders WHERE project_id = ?").get(p.id) as { count: number }
        )?.count ?? 0;
        const customersCount = (
          db.prepare("SELECT COUNT(*) as count FROM customers WHERE project_id = ?").get(p.id) as { count: number }
        )?.count ?? 0;

        return {
          ...p,
          stats: {
            templates_count: tplCount,
            pending_queue: pendingQueue,
            sent_queue: sentQueue,
            orders_count: ordersCount,
            customers_count: customersCount,
          },
        };
      });

      res.status(200).json({ success: true, projects: projectsWithStats });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // POST /api/projects - Criar novo projeto
  router.post("/", (req: Request, res: Response): void => {
    try {
      const { projectRepo } = getRepos();
      const { name, slug, description, cakto_product_id, cakto_webhook_secret } = req.body || {};

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: "ValidationError: campo 'name' e obrigatorio.",
        });
        return;
      }

      if (!slug || typeof slug !== "string" || slug.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: "ValidationError: campo 'slug' e obrigatorio.",
        });
        return;
      }

      const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
      const existing = projectRepo.findBySlug(cleanSlug);
      if (existing) {
        res.status(409).json({
          success: false,
          error: `SlugConflict: ja existe um projeto com o slug "${cleanSlug}".`,
        });
        return;
      }

      const created = projectRepo.create({
        name: name.trim(),
        slug: cleanSlug,
        description: description ? String(description).trim() : null,
        cakto_product_id: cakto_product_id ? String(cakto_product_id).trim() : null,
        cakto_webhook_secret: cakto_webhook_secret ? String(cakto_webhook_secret).trim() : null,
      });

      res.status(201).json({ success: true, project: created });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // GET /api/projects/:id - Obter detalhes de um projeto
  router.get("/:id", (req: Request, res: Response): void => {
    try {
      const { projectRepo } = getRepos();
      const idOrSlug = String(req.params.id);
      const project = projectRepo.findById(idOrSlug) ?? projectRepo.findBySlug(idOrSlug);

      if (!project) {
        res.status(404).json({ success: false, error: "Projeto nao encontrado." });
        return;
      }

      res.status(200).json({ success: true, project });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // PUT /api/projects/:id - Atualizar projeto
  router.put("/:id", (req: Request, res: Response): void => {
    try {
      const { projectRepo } = getRepos();
      const id = String(req.params.id);
      const existing = projectRepo.findById(id);

      if (!existing) {
        res.status(404).json({ success: false, error: "Projeto nao encontrado." });
        return;
      }

      const { name, slug, description, cakto_product_id, cakto_webhook_secret, is_active } = req.body || {};

      let cleanSlug = undefined;
      if (slug !== undefined) {
        cleanSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
        if (cleanSlug !== existing.slug) {
          const conflict = projectRepo.findBySlug(cleanSlug);
          if (conflict && conflict.id !== id) {
            res.status(409).json({
              success: false,
              error: `SlugConflict: ja existe outro projeto com o slug "${cleanSlug}".`,
            });
            return;
          }
        }
      }

      const updated = projectRepo.update(id, {
        name: name !== undefined ? String(name).trim() : undefined,
        slug: cleanSlug,
        description: description !== undefined ? String(description).trim() : undefined,
        cakto_product_id: cakto_product_id !== undefined ? String(cakto_product_id).trim() : undefined,
        cakto_webhook_secret: cakto_webhook_secret !== undefined ? String(cakto_webhook_secret).trim() : undefined,
        is_active: is_active !== undefined ? Number(is_active) : undefined,
      });

      res.status(200).json({ success: true, project: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // DELETE /api/projects/:id - Excluir projeto
  router.delete("/:id", (req: Request, res: Response): void => {
    try {
      const { projectRepo } = getRepos();
      const id = String(req.params.id);

      if (id === "default") {
        res.status(400).json({
          success: false,
          error: "Operacao proibidda: o projeto padrao 'default' nao pode ser excluido.",
        });
        return;
      }

      const success = projectRepo.delete(id);
      if (!success) {
        res.status(404).json({ success: false, error: "Projeto nao encontrado." });
        return;
      }

      res.status(200).json({ success: true, message: "Projeto excluido com sucesso." });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // POST /api/projects/:id/clear-queue - Limpar apenas a fila de mensagens do projeto
  router.post("/:id/clear-queue", (req: Request, res: Response): void => {
    try {
      const { queueRepo } = getRepos();
      const projectId = String(req.params.id);
      const deletedCount = queueRepo.clearQueue(projectId);

      res.status(200).json({
        success: true,
        message: `Fila de mensagens do projeto '${projectId}' limpa com sucesso.`,
        deleted_count: deletedCount,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  return router;
}

export default createProjectsRouter;
