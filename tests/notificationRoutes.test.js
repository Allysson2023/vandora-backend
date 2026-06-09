const request = require("supertest");
const express = require("express");

// 1. MOCK DO BANCO DE DADOS
jest.mock("../config/db", () => ({
    query: jest.fn()
}));

// 2. MOCK DO MIDDLEWARE DE AUTENTICAÇÃO
jest.mock("../middlewares/authMiddleware", () => (req, res, next) => {
    req.user = { id: 42 }; // ID de usuário fictício para os testes
    next();
});

const db = require("../config/db");
const notificationRouter = require("../routes/notificationRoutes");

const app = express();
app.use(express.json());
app.use("/api", notificationRouter);

describe("Suíte de Testes - Rotas de Notificações", () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("Deve listar as notificações do usuário com sucesso", async () => {
        const mockNotificacoes = [
            { id: 3, user_id: 42, titulo: "Pedido Enviado", mensagem: "Seu pedido saiu para entrega." },
            { id: 2, user_id: 42, titulo: "Pagamento Confirmado", mensagem: "Recebemos seu pagamento." }
        ];

        // Simula o retorno de sucesso do MySQL
        db.query.mockImplementation((sql, params, callback) => {
            callback(null, mockNotificacoes);
        });

        const res = await request(app).get("/api/notifications");

        expect(res.status).toBe(200);
        expect(res.body).toEqual(mockNotificacoes);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [42], expect.any(Function));
    });

    it("Deve retornar erro 500 protegido se o banco de dados falhar", async () => {
        // Silencia temporariamente o console.error para o terminal ficar limpo
        const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

        // Simula uma falha crítica no banco de dados
        db.query.mockImplementation((sql, params, callback) => {
            callback(new Error("Erro crítico de conexão interna"), null);
        });

        const res = await request(app).get("/api/notifications");

        expect(res.status).toBe(500);
        // Garante que a resposta NÃO vaza o erro original
        expect(res.body).not.toHaveProperty("message", "Erro crítico de conexão interna");
        expect(res.body).toEqual({ error: "Erro interno ao buscar notificações" });

        consoleSpy.mockRestore(); // Restaura o comportamento do console
    });
});