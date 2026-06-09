const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db"); 
const userRoutes = require("../routes/userRoutes"); // Confirme se o nome do seu arquivo está exatamente assim

const app = express();
app.use(express.json());
app.use("/api", userRoutes);

afterAll((done) => {
    if (db && typeof db.end === "function") {
        db.end(done);
    } else {
        done();
    }
});

describe("Testes do Módulo de Usuários (Integration & Security)", () => {

    // --- TESTE 1: VALIDAÇÃO DE TAMANHO DE USUÁRIO ---
    it("Deve retornar erro 400 se o username tiver menos de 4 caracteres", async () => {
        const resposta = await request(app)
            .post("/api/users")
            .send({
                username: "all", // Curto demais (Dispara a validação do seu código)
                password: "senha123"
            });

        expect(resposta.statusCode).toBe(400);
        expect(resposta.body).toHaveProperty("error", "O usuário deve ter pelo menos 4 caracteres.");
    });

    // --- TESTE 2: BLOQUEIO DE LOGIN INVÁLIDO ---
    it("Deve recusar o login se a senha estiver incorreta", async () => {
        const resposta = await request(app)
            .post("/api/login")
            .send({
                username: "usuario_que_nao_existe_no_banco",
                password: "senha_errada"
            });

        // O seu backend retorna 401 para Usuário ou senha inválidos
        expect(resposta.statusCode).toBe(401);
        expect(resposta.body).toHaveProperty("error", "Usuário ou senha inválidos");
    });

    // --- TESTE 3: TRAVA DE SEGURANÇA (HACKER TENTANDO ALTERAR OUTRO USER) ---
    it("Deve proibir (403) um usuário de atualizar o perfil de outro usuário", async () => {
        // Criamos um token simulando que o usuário logado é o ID: 5
        const payloadFake = { id: 5, tipo: "cliente" };
        const tokenValido = jwt.sign(payloadFake, process.env.JWT_SECRET || "sua_chave_secreta", {
            expiresIn: "1h"
        });

        // O ID 5 tenta enviar um PUT para alterar os dados do ID: 999
        const resposta = await request(app)
            .put("/api/users/999")
            .set("Authorization", `Bearer ${tokenValido}`)
            .send({
                username: "hacker_username",
                password: "NovaSenhaForte1"
            });

        // O seu backend tem a trava: if (Number(id) !== Number(userIdLogado)) return res.status(403)
        expect(resposta.statusCode).toBe(403);
        expect(resposta.body).toHaveProperty("error", "Você não tem permissão para alterar este usuário");
    });

});