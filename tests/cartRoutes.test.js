const request = require("supertest");
const express = require("express");

// 1. MOCK DO BANCO DE DADOS
jest.mock("../config/db", () => ({
    query: jest.fn()
}));

// 2. MOCK DO MIDDLEWARE DE AUTENTICAÇÃO
jest.mock("../middlewares/authMiddleware", () => (req, res, next) => {
    req.user = { id: 42 }; // Injeta um ID de usuário fictício fixo para os testes
    next();
});

const db = require("../config/db");
const cartRouter = require("../routes/cartRoutes");

const app = express();
app.use(express.json());
app.use("/api", cartRouter);

describe("Suíte de Testes - Rotas de Carrinho", () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ==========================================
    // TESTE: DELETE /cart/clear
    // ==========================================
    describe("DELETE /api/cart/clear", () => {
        it("Deve limpar o carrinho com sucesso", async () => {
            db.query.mockImplementation((sql, params, callback) => {
                callback(null, { affectedRows: 2 });
            });

            const res = await request(app).delete("/api/cart/clear");

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ message: "Carrinho limpo com sucesso!" });
        });

        it("Deve retornar erro 500 se falhar no banco", async () => {
            const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
            db.query.mockImplementation((sql, params, callback) => {
                callback(new Error("Erro de banco"), null);
            });

            const res = await request(app).delete("/api/cart/clear");

            expect(res.status).toBe(500);
            expect(res.body).toHaveProperty("error", "Erro interno ao limpar o carrinho");
            consoleSpy.mockRestore();
        });
    });

    // ==========================================
    // TESTE: DELETE /cart/delete/:id
    // ==========================================
    describe("DELETE /api/cart/delete/:id", () => {
        it("Deve retornar 400 se o ID do produto for inválido", async () => {
            const res = await request(app).delete("/api/cart/delete/abc");
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty("message", "ID inválido");
        });

        it("Deve remover o item específico com sucesso", async () => {
            db.query.mockImplementation((sql, params, callback) => {
                callback(null, { affectedRows: 1 });
            });

            const res = await request(app).delete("/api/cart/delete/10");
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ message: "Removido" });
        });

        it("Deve retornar 404 se o produto não estiver no carrinho", async () => {
            db.query.mockImplementation((sql, params, callback) => {
                callback(null, { affectedRows: 0 });
            });

            const res = await request(app).delete("/api/cart/delete/10");
            expect(res.status).toBe(404);
            expect(res.body).toHaveProperty("message", "Produto não encontrado no carrinho");
        });
    });

    // ==========================================
    // TESTE: PUT /cart/decrease/:id
    // ==========================================
    describe("PUT /api/cart/decrease/:id", () => {
        it("Deve remover o item do carrinho se a quantidade atual for 1", async () => {
            // Primeiro query (SELECT): retorna quantidade = 1
            db.query.mockImplementationOnce((sql, params, callback) => {
                callback(null, [{ id: 1, quantidade: 1 }]);
            });
            // Segundo query (DELETE): executa remoção
            db.query.mockImplementationOnce((sql, params, callback) => {
                callback(null, { affectedRows: 1 });
            });

            const res = await request(app).put("/api/cart/decrease/5");
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ message: "Item removido" });
        });

        it("Deve diminuir a quantidade se for maior que 1", async () => {
            // Primeiro query (SELECT): retorna quantidade = 3
            db.query.mockImplementationOnce((sql, params, callback) => {
                callback(null, [{ id: 1, quantidade: 3 }]);
            });
            // Segundo query (UPDATE)
            db.query.mockImplementationOnce((sql, params, callback) => {
                callback(null, { affectedRows: 1 });
            });

            const res = await request(app).put("/api/cart/decrease/5");
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ message: "Quantidade diminuída!" });
        });
    });

    // ==========================================
    // TESTE: PUT /cart/increase/:id
    // ==========================================
    describe("PUT /api/cart/increase/:id", () => {
        it("Deve retornar 400 se a quantidade atingir o limite do estoque", async () => {
            db.query.mockImplementationOnce((sql, params, callback) => {
                callback(null, [{ quantidade: 5, estoque: 5, nome: "Camiseta" }]);
            });

            const res = await request(app).put("/api/cart/increase/5");
            expect(res.status).toBe(400);
            expect(res.body.message).toContain("Quantidade indisponível");
        });

        it("Deve aumentar a quantidade com sucesso se houver estoque", async () => {
            db.query.mockImplementationOnce((sql, params, callback) => {
                callback(null, [{ quantidade: 2, estoque: 10, nome: "Camiseta" }]);
            });
            db.query.mockImplementationOnce((sql, params, callback) => {
                callback(null, { affectedRows: 1 });
            });

            const res = await request(app).put("/api/cart/increase/5");
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ message: "Quantidade aumentada!" });
        });
    });

    // ==========================================
    // TESTE: POST /cart
    // ==========================================
    describe("POST /api/cart", () => {
        it("Deve travar se o usuário tentar adicionar itens de lojas diferentes", async () => {
            // 1. SELECT carrinho existente
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 1 }]));
            // 2. SELECT produto novo (Loja 2)
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, [{ store_id: 2, estoque: 10, nome: "Item Novo" }]));
            // 3. SELECT loja atual no carrinho (Loja 1)
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, [{ store_id: 1 }]));

            const res = await request(app)
                .post("/api/cart")
                .send({ product_id: 8, quantidade: 2 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain("Você só pode adicionar produtos de uma loja por vez");
        });

        it("Deve adicionar novo item se a loja for compatível e houver estoque", async () => {
            // 1. Carrinho existente
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 1 }]));
            // 2. Produto novo (Loja 1)
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, [{ store_id: 1, estoque: 10, nome: "Item Novo" }]));
            // 3. Loja atual compatível (Loja 1)
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, [{ store_id: 1 }]));
            // 4. Verificação de item duplicado (Não duplicado)
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, []));
            // 5. Inserção final bem sucedida
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, { insertId: 99 }));

            const res = await request(app)
                .post("/api/cart")
                .send({ product_id: 8, quantidade: 2 });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ message: "Produto adicionado!" });
        });
    });

    // ==========================================
    // TESTE: GET /cart
    // ==========================================
    describe("GET /api/cart", () => {
        it("Deve listar todos os itens do carrinho do usuário autenticado", async () => {
            const mockItens = [
                { product_id: 1, nome: "Caneta", preco: 5.50, quantidade: 2 }
            ];
            db.query.mockImplementation((sql, params, callback) => {
                callback(null, mockItens);
            });

            const res = await request(app).get("/api/cart");
            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockItens);
        });
    });
});