const request = require("supertest");
const express = require("express");

// 1. MOCK DO BANCO DE DADOS
// Isolamos o banco de dados real para que os testes não dependam de conexões externas
jest.mock("../config/db", () => ({
    query: jest.fn()
}));

const db = require("../config/db");
const categoryRouter = require("../routes/categoryRoutes"); // Ajuste o caminho se o seu arquivo tiver outro nome

const app = express();
app.use(express.json());
app.use("/api", categoryRouter); // Define o prefixo da rota igual ao usado no seu app principal

describe("Suíte de Testes - Rotas de Categoria", () => {
    
    beforeEach(() => {
        // Limpa os mocks antes de cada teste para evitar interferências
        jest.clearAllMocks();
    });

    // ==========================================
    // TESTES DA ROTA: GET /categories
    // ==========================================
    describe("GET /api/categories", () => {
        
        it("Deve listar todas as categorias com sucesso em ordem alfabética", async () => {
            // Dados fictícios simulando o retorno do banco de dados
            const mockCategorias = [
                { id: 1, nome: "Acessórios" },
                { id: 2, nome: "Roupas" },
                { id: 3, nome: "Calçados" }
            ];

            // Força o mock do banco a retornar sucesso com a nossa lista
            db.query.mockImplementation((sql, callback) => {
                callback(null, mockCategorias);
            });

            const res = await request(app).get("/api/categories");

            // Validações
            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockCategorias);
            expect(res.body.length).toBe(3);
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        it("Deve retornar erro 500 com mensagem segura se o banco de dados falhar", async () => {
            // Esconde temporariamente o console.error para não poluir o terminal do teste
            const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

            // Força o mock do banco a simular uma falha crítica interna
            db.query.mockImplementation((sql, callback) => {
                callback(new Error("Falha crítica no banco MySQL"), null);
            });

            const res = await request(app).get("/api/categories");

            // Validações de segurança
            expect(res.status).toBe(500);
            expect(res.body).toHaveProperty("error", "Erro interno ao buscar categorias");
            // Garante que o erro real NÃO foi exposto para o cliente
            expect(res.body).not.toHaveProperty("message", "Falha crítica no banco MySQL");

            // Restaura o console.error original
            consoleSpy.mockRestore();
        });

    });
});