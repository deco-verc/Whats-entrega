import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import Database from "better-sqlite3";
import { createDatabaseConnection } from "../src/database/connection.js";
import { TemplateRepository, createRepositories } from "../src/database/repositories.js";
import { createWebhookApp } from "../src/webhooks/server.js";

describe("Editor de Templates com Tags Dinamicas e Spintax (TemplateRepository & API)", () => {
  let db: Database.Database;
  let repo: TemplateRepository;

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    repo = new TemplateRepository(db);
  });

  afterEach(() => {
    if (db && db.open) {
      db.close();
    }
  });

  describe("TemplateRepository (Camada de Banco SQLite)", () => {
    test("deve criar novo template com tags extraidas automaticamente", () => {
      const created = repo.create({
        name: "Boas-vindas",
        content: "{Ola|Oi}, {first_name}! Seu produto {product_name} esta pronto.",
        media_path: "data/media/audio.ogg",
      });

      assert.ok(created.id);
      assert.equal(created.name, "Boas-vindas");
      assert.equal(created.media_path, "data/media/audio.ogg");
      const tags = JSON.parse(created.tags_json);
      assert.ok(tags.includes("first_name"));
      assert.ok(tags.includes("product_name"));
      assert.ok(created.created_at);
      assert.ok(created.updated_at);
    });

    test("deve localizar template por id e por nome", () => {
      const created = repo.create({
        name: "Recuperacao PIX",
        content: "Pague seu PIX: {pix_code}",
      });

      const foundById = repo.findById(created.id);
      assert.ok(foundById);
      assert.equal(foundById?.name, "Recuperacao PIX");

      const foundByName = repo.findByName("Recuperacao PIX");
      assert.ok(foundByName);
      assert.equal(foundByName?.id, created.id);

      assert.equal(repo.findById("id_inexistente"), null);
      assert.equal(repo.findByName("Nome Inexistente"), null);
    });

    test("deve listar todos os templates em ordem decrescente", () => {
      repo.create({ name: "Template 1", content: "Conteudo 1" });
      repo.create({ name: "Template 2", content: "Conteudo 2" });

      const all = repo.findAll();
      assert.equal(all.length, 2);
      assert.equal(all[0].name, "Template 2");
      assert.equal(all[1].name, "Template 1");
    });

    test("deve atualizar campos de template existente", () => {
      const created = repo.create({
        name: "Original",
        content: "Texto original {first_name}",
      });

      const updated = repo.update(created.id, {
        name: "Atualizado",
        content: "Novo texto {first_name} {pix_code}",
      });

      assert.ok(updated);
      assert.equal(updated?.name, "Atualizado");
      assert.ok(updated?.content.includes("Novo texto"));
      const tags = JSON.parse(updated!.tags_json);
      assert.ok(tags.includes("pix_code"));

      assert.equal(repo.update("id_inexistente", { name: "Nao existe" }), null);
    });

    test("deve excluir template por id", () => {
      const created = repo.create({
        name: "Para Excluir",
        content: "Sera deletado",
      });

      const deleted = repo.delete(created.id);
      assert.equal(deleted, true);
      assert.equal(repo.findById(created.id), null);
      assert.equal(repo.delete("id_inexistente"), false);
    });

    test("deve extrair tags ignorando Spintax", () => {
      const tags = repo.extractTags("{Ola|Oi|Fala}, {first_name}! Aqui esta seu {pix_code} do {{product_name}}.");
      assert.equal(tags.length, 3);
      assert.ok(tags.includes("first_name"));
      assert.ok(tags.includes("pix_code"));
      assert.ok(tags.includes("product_name"));
    });

    test("deve interpolar variaveis e resolver Spintax", () => {
      const template = "{Ola|Oi}, {first_name}! Acesse {{checkout_url}} para garantir o {product_name}.";
      const result = repo.interpolate(template, {
        first_name: "Carlos",
        checkout_url: "https://cakto.com.br/pay/123",
        product_name: "Guia Completo",
      });

      assert.ok(result.startsWith("Ola, Carlos!") || result.startsWith("Oi, Carlos!"));
      assert.ok(result.includes("https://cakto.com.br/pay/123"));
      assert.ok(result.includes("Guia Completo"));
      assert.ok(!result.includes("{first_name}"));
      assert.ok(!result.includes("{{checkout_url}}"));
    });

    test("deve interpolar tags dinamicas em portugues (primeiro_nome, produto, pix_copia_cola)", () => {
      const template = "{Oi|Ola}, {primeiro_nome}! Seu {produto} tem o Pix: {pix_copia_cola}";
      const result = repo.interpolate(template, {
        first_name: "Deco",
        product_name: "Metodo Pro",
        pix_code: "123456789",
      });
      assert.ok(result.includes("Deco"));
      assert.ok(result.includes("Metodo Pro"));
      assert.ok(result.includes("123456789"));
      assert.ok(!result.includes("{primeiro_nome}"));
      assert.ok(!result.includes("{produto}"));
      assert.ok(!result.includes("{pix_copia_cola}"));
    });

    test("deve validar sintaxe Spintax e detectar chaves desbalanceadas", () => {
      const valid = repo.validateSpintax("{Ola|Oi}, {first_name}!");
      assert.equal(valid.valid, true);

      const invalidOpen = repo.validateSpintax("{Ola|Oi, {first_name}!");
      assert.equal(invalidOpen.valid, false);
      assert.ok(invalidOpen.error?.includes("nao fechadas"));

      const invalidClose = repo.validateSpintax("Ola}, {first_name}!");
      assert.equal(invalidClose.valid, false);
      assert.ok(invalidClose.error?.includes("inesperado"));
    });

    test("seedIfEmpty deve popular templates padrao se banco vazio", () => {
      const seededCount = repo.seedIfEmpty();
      assert.ok(seededCount >= 5);
      assert.equal(repo.findAll().length, seededCount);

      // Chamada subsequente nao duplica
      const secondRun = repo.seedIfEmpty();
      assert.equal(secondRun, 0);
      assert.equal(repo.findAll().length, seededCount);
    });

    test("createRepositories deve incluir templateRepository", () => {
      const repos = createRepositories(db);
      assert.ok(repos.templates);
      assert.equal(typeof repos.templates.create, "function");
      assert.equal(typeof repos.templates.findAll, "function");
    });
  });

  describe("API REST de Templates (/api/templates)", () => {
    let server: http.Server;
    let baseUrl: string;

    beforeEach(async () => {
      const app = createWebhookApp({
        repositories: { templateRepo: repo },
      });
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
      if (server && server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test("GET /api/templates deve listar templates com sucesso", async () => {
      repo.create({ name: "Tpl Teste", content: "Conteudo teste" });

      const res = await fetch(`${baseUrl}/api/templates`);
      assert.equal(res.status, 200);
      const json = await res.json() as any;
      assert.equal(json.success, true);
      assert.ok(Array.isArray(json.templates));
      assert.ok(json.templates.length >= 1);
    });

    test("POST /api/templates deve criar novo template com validacao", async () => {
      // 1. Falha: sem nome
      const resBad1 = await fetch(`${baseUrl}/api/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Texto sem nome" }),
      });
      assert.equal(resBad1.status, 400);

      // 2. Falha: sem conteudo
      const resBad2 = await fetch(`${baseUrl}/api/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nome sem conteudo" }),
      });
      assert.equal(resBad2.status, 400);

      // 3. Falha: Spintax invalido
      const resBad3 = await fetch(`${baseUrl}/api/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Spintax quebrado", content: "{Invalido|Sem fechar" }),
      });
      assert.equal(resBad3.status, 400);

      // 4. Sucesso: cria template
      const resOk = await fetch(`${baseUrl}/api/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Oferta VIP",
          content: "{Ola|Oi}, {first_name}! Segue seu link: {checkout_url}",
          media_path: "data/media/audio_pitch.ogg",
        }),
      });
      assert.equal(resOk.status, 201);
      const json = await resOk.json() as any;
      assert.equal(json.success, true);
      assert.equal(json.template.name, "Oferta VIP");
      assert.ok(json.template.id);
    });

    test("GET /api/templates/:id deve retornar template especifico ou 404", async () => {
      const created = repo.create({ name: "Busca ID", content: "Texto" });

      const resFound = await fetch(`${baseUrl}/api/templates/${created.id}`);
      assert.equal(resFound.status, 200);
      const jsonFound = await resFound.json() as any;
      assert.equal(jsonFound.template.id, created.id);

      const resNotFound = await fetch(`${baseUrl}/api/templates/id_inexistente`);
      assert.equal(resNotFound.status, 404);
    });

    test("PUT /api/templates/:id deve atualizar template existente", async () => {
      const created = repo.create({ name: "Antes", content: "Texto antes" });

      const resUpdate = await fetch(`${baseUrl}/api/templates/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Depois",
          content: "Texto depois {first_name}",
        }),
      });

      assert.equal(resUpdate.status, 200);
      const json = await resUpdate.json() as any;
      assert.equal(json.template.name, "Depois");

      const resNotFound = await fetch(`${baseUrl}/api/templates/id_inexistente`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nao existe" }),
      });
      assert.equal(resNotFound.status, 404);
    });

    test("DELETE /api/templates/:id deve excluir template", async () => {
      const created = repo.create({ name: "Deletar", content: "Vai sumir" });

      const resDelete = await fetch(`${baseUrl}/api/templates/${created.id}`, {
        method: "DELETE",
      });
      assert.equal(resDelete.status, 200);
      const json = await resDelete.json() as any;
      assert.equal(json.deleted, true);

      const resNotFound = await fetch(`${baseUrl}/api/templates/id_inexistente`, {
        method: "DELETE",
      });
      assert.equal(resNotFound.status, 404);
    });

    test("POST /api/templates/preview deve simular interpolacao de tags e Spintax", async () => {
      const res = await fetch(`${baseUrl}/api/templates/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "{Ola|Oi}, {first_name}! Seu PIX {pix_code} esta gerado.",
          variables: {
            first_name: "Mariana",
            pix_code: "00020126580014br.gov.bcb.pix...",
          },
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json() as any;
      assert.equal(json.success, true);
      assert.ok(json.preview.includes("Mariana"));
      assert.ok(json.preview.includes("00020126580014br.gov.bcb.pix..."));
      assert.ok(json.spintax_valid);
      assert.ok(json.extracted_tags.includes("first_name"));
      assert.ok(json.extracted_tags.includes("pix_code"));
    });

    test("POST /api/templates/seed deve popular templates se vazio", async () => {
      const res = await fetch(`${baseUrl}/api/templates/seed`, {
        method: "POST",
      });
      assert.equal(res.status, 200);
      const json = await res.json() as any;
      assert.equal(json.success, true);
      assert.ok(json.seeded_count >= 5);
    });

    test("GET /templates.html deve servir a interface dedicada de templates", async () => {
      const res = await fetch(`${baseUrl}/templates.html`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("text/html"));
      const html = await res.text();
      assert.ok(html.includes("Editor de Templates"));
      assert.ok(html.includes("template-form"));
    });
  });
});
