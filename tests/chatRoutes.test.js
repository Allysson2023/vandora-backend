const request = require("supertest");
const express = require("express");

// 1. REALIZA OS MOCKS ANTES DE CARREGAR AS ROTAS
// Mock do banco de dados para não poluir o banco real durante os testes
jest.mock("../config/db", () => ({
    query: jest.fn()
}));

// Mock do módulo socket para evitar que o Jest quebre por falta de servidor HTTP
jest.mock("../utils/socket", () => ({
    getIo: jest.fn(() => ({
        to: jest.fn(() => ({
            emit: jest.fn()
        }))
    }))
}));

// Mock do middleware de autenticação para injetar usuários fictícios nas requisições
jest.mock("../middlewares/authMiddleware", () => {
    return (req, res, next) => {
        // Injeta por padrão um usuário mockado comum, rotas específicas podem sobrescrever se necessário
        req.user = { id: 1, username: "usuario_teste" };
        next();
    };
});

const db = require("../config/db");
const chatRouter = require("../routes/chatRoutes"); // Ajuste o caminho se seu arquivo real tiver outro nome

const app = express();
app.use(express.json());
app.use("/api/chats", chatRouter);

describe("Suíte de Testes - Rotas de Chat", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ==========================================
    // TESTES DA ROTA: GET /cliente
    // ==========================================
    describe("GET /api/chats/cliente", () => {
        it("Deve listar os chats do cliente autenticado com sucesso", async () => {
            const mockChats = [
                { chatId: 10, loja_id: 2, nomeLoja: "Loja Exemplo", ultimaMensagem: "Olá!" }
            ];
            db.query.mockImplementation((sql, params, callback) => {
                callback(null, mockChats);
            });

            const res = await request(app).get("/api/chats/cliente");

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockChats);
            expect(db.query).toHaveBeenCalled();
        });

        it("Deve retornar erro 500 se o banco de dados falhar", async () => {
            db.query.mockImplementation((sql, params, callback) => {
                callback(new Error("Falha de conexão"), null);
            });

            const res = await request(app).get("/api/chats/cliente");

            expect(res.status).toBe(500);
            expect(res.body).toHaveProperty("error");
        });
    });

    // ==========================================
    // TESTES DA ROTA: GET /loja/:lojaId
    // ==========================================
    describe("GET /api/chats/loja/:lojaId", () => {
        it("Deve permitir acesso e listar chats se o usuário for o dono da loja", async () => {
            // Primeiro mock: Execução do middleware checkStoreOwner (acha a loja vinculada ao user 1)
            // Segundo mock: Execução da query principal do controller
            db.query
                .mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 2 }]))
                .mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 10, cliente_nome: "Allysson" }]));

            const res = await request(app).get("/api/chats/loja/2");

            expect(res.status).toBe(200);
            expect(res.body[0]).toHaveProperty("cliente_nome", "Allysson");
        });

        it("Deve retornar 403 se o usuário logado não for dono da loja", async () => {
            // Mock do middleware checkStoreOwner retornando array vazio (não é dono)
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, []));

            const res = await request(app).get("/api/chats/loja/3");

            expect(res.status).toBe(403);
            expect(res.body.message).toBe("Acesso negado");
        });
    });

    // ==========================================
    // TESTES DA ROTA: POST /abrir
    // ==========================================
    describe("POST /api/chats/abrir", () => {
        it("Deve retornar 400 se o campo loja_id não for enviado", async () => {
            const res = await request(app).post("/api/chats/abrir").send({});
            expect(res.status).toBe(400);
        });

        it("Deve retornar 404 se a loja informada não existir no banco", async () => {
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, []));

            const res = await request(app).post("/api/chats/abrir").send({ loja_id: 99 });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe("A loja informada não existe");
        });

        it("Deve retornar o chat_id existente se o chat já tiver sido criado antes", async () => {
            db.query
                .mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 2 }])) // Loja existe
                .mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 55 }])); // Chat já existe (id 55)

            const res = await request(app).post("/api/chats/abrir").send({ loja_id: 2 });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ chat_id: 55 });
        });

        it("Deve criar um chat novo se ele ainda não existir", async () => {
            db.query
                .mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 2 }])) // Loja existe
                .mockImplementationOnce((sql, params, callback) => callback(null, [])) // Chat não existe
                .mockImplementationOnce((sql, params, callback) => callback(null, { insertId: 88 })); // Insere chat novo

            const res = await request(app).post("/api/chats/abrir").send({ loja_id: 2 });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ chat_id: 88 });
        });
    });

    // ==========================================
    // TESTES DA ROTA: POST /mensagem
    // ==========================================
    describe("POST /api/chats/mensagem", () => {
        it("Deve enviar mensagem em chat existente com sucesso", async () => {
            db.query
                .mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 10, cliente_id: 1, dono_loja: 2 }])) // Middleware checkChatMessageAccess passa
                .mockImplementationOnce((sql, params, callback) => callback(null, {})) // Query de update do status do chat
                .mockImplementationOnce((sql, params, callback) => callback(null, { insertId: 500 })) // Insere msg
                .mockImplementationOnce((sql, params, callback) => callback(null, [{ loja_id: 2 }])); // Busca loja_id para o socket

            const res = await request(app)
                .post("/api/chats/mensagem")
                .send({ chat_id: 10, mensagem: "Olá, suporte!", tipo: "texto", remetente_tipo: "cliente" });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                message: "Mensagem enviada",
                chat_id: 10,
                id: 500
            });
        });

        it("Deve barrar envio se o usuário não pertencer ao chat informado", async () => {
            // Middleware encontra o chat, mas mostra que pertence ao cliente_id: 99 e dono_loja: 99 (Usuário logado é o 1)
            db.query.mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 10, cliente_id: 99, dono_loja: 99 }]));

            const res = await request(app)
                .post("/api/chats/mensagem")
                .send({ chat_id: 10, mensagem: "Invasão", tipo: "texto", remetente_tipo: "cliente" });

            expect(res.status).toBe(403);
            expect(res.body.message).toBe("Acesso negado");
        });
    });

    // ==========================================
    // TESTES DA ROTA: PUT /visualizar/:chatId
    // ==========================================
    describe("PUT /api/chats/visualizar/:chatId", () => {
        it("Deve marcar o chat como visualizado com sucesso", async () => {
            db.query
                .mockImplementationOnce((sql, params, callback) => callback(null, [{ id: 10, cliente_id: 1, dono_loja: 2 }])) // Middleware checkChatAccess ok
                .mockImplementationOnce((sql, params, callback) => callback(null, {})); // Update ok

            const res = await request(app).put("/api/chats/visualizar/10");

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Chat visualizado com sucesso");
        });
    });
});