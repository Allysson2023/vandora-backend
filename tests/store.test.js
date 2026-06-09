const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db"); 
const storeRoutes = require("../routes/storeRoutes"); // Confirme o nome exato do seu arquivo de rotas de loja

const app = express();
app.use(express.json());
app.use("/api", storeRoutes); // Injeta as rotas de loja de forma isolada

afterAll((done) => {
    if (db && typeof db.end === "function") {
        db.end(done);
    } else {
        done();
    }
});

describe("Testes de Segurança - Store Routes", () => {
    let funcionarioToken;
    let clienteToken;
    let outroLojistaToken;
    const jwtSecret = process.env.JWT_SECRET || "sua_chave_secreta";

    beforeAll(() => {
        // Gerando os tokens estruturados com a assinatura correta do seu sistema
        funcionarioToken = jwt.sign({ id: 1, tipo: "funcionario" }, jwtSecret, { expiresIn: "1h" });
        clienteToken = jwt.sign({ id: 2, tipo: "cliente" }, jwtSecret, { expiresIn: "1h" });
        
        // Criamos o token com o ID 3 (Lojista Invasor)
        outroLojistaToken = jwt.sign({ id: 3, tipo: "lojista" }, jwtSecret, { expiresIn: "1h" });
    });

    // ==========================================================
    // 1. TESTE DA CORREÇÃO DA ROTA TOP-LOJAS
    // ==========================================================
    describe("GET /funcionario/top-lojas", () => {
        it("Deve barrar o acesso se o usuário não estiver autenticado", async () => {
            const res = await request(app)
                .get("/api/funcionario/top-lojas");

            expect(res.statusCode).toBe(401); // Exige autenticação (authMiddleware)
        });
    });

    // ==========================================================
    // 2. TESTES DE CRIAÇÃO E CONTROLE DA LOJA
    // ==========================================================
    describe("POST /stores", () => {
        it("Deve impedir que um cliente comum crie uma loja", async () => {
            const res = await request(app)
                .post("/api/stores")
                .set("Authorization", `Bearer ${clienteToken}`)
                .send({
                    nome: "Loja Invasora",
                    categoria: "Roupas"
                });

            expect(res.statusCode).toBe(403); // Apenas funcionários/permissões corretas
        });
    });

    describe("Controles de Acesso às Lojas (checkOwner)", () => {
        it("Deve proibir um lojista de acessar o dashboard de outra loja", async () => {
            const lojaIdAlheia = 999; 
            
            const res = await request(app)
                .get(`/api/stores/${lojaIdAlheia}/dashboard`)
                .set("Authorization", `Bearer ${outroLojistaToken}`);

            expect(res.statusCode).toBe(403);
        });
    });

    // ==========================================================
    // 3. TESTES DE AVALIAÇÃO E RESPOSTAS (DONO DA RESPOSTA)
    // ==========================================================
    describe("POST /avaliacoes/:id/responder", () => {
        it("Deve impedir que um terceiro/cliente responda ao comentário de uma loja", async () => {
            // Usamos o ID 4 que existe na sua tabela marketplace.avaliacoes
            const avaliacaoId = 4; 

            const res = await request(app)
                .post(`/api/avaliacoes/${avaliacaoId}/responder`)
                .set("Authorization", `Bearer ${outroLojistaToken}`) // ID 3 tentando responder pela loja do ID 4
                .send({
                    resposta: "Tentativa de resposta invasora"
                });

            // O backend vai encontrar a avaliação 4 no banco, verá que o ID 3 não tem permissão de dono e mandará 403!
            expect(res.statusCode).toBe(403); 
        });
    });
});