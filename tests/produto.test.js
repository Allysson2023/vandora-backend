const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db"); 
const productRoutes = require("../routes/productRoutes"); // Certifique-se de que o nome do arquivo de rotas está idêntico ao seu

const app = express();
app.use(express.json());
app.use("/api", productRoutes);

afterAll((done) => {
    if (db && typeof db.end === "function") {
        db.end(done);
    } else {
        done();
    }
});

describe("Testes do Módulo de Produtos (Integration)", () => {

    // --- TESTE 1: BUSCAR LISTA DE PRODUTOS ---
    it("Deve listar os produtos com sucesso (Rota Pública)", async () => {
        const resposta = await request(app)
            .get("/api/products")
            .query({ pagina: 1 });

        // A rota deve responder 200 OK e retornar um Array de produtos (mesmo se estiver vazio)
        expect(resposta.statusCode).toBe(200);
        expect(Array.isArray(resposta.body)).toBe(true);
    });

    // --- TESTE 2: VALIDAÇÃO DE PREÇO INVÁLIDO ---
    it("Deve retornar erro 400 se tentar cadastrar produto com preço menor ou igual a zero", async () => {
        const payloadFake = { id: 1, email: "vendedor@teste.com" };
        const tokenValido = jwt.sign(payloadFake, process.env.JWT_SECRET || "sua_chave_secreta", {
            expiresIn: "1h"
        });

        const resposta = await request(app)
            .post("/api/products")
            .set("Authorization", `Bearer ${tokenValido}`)
            .send({
                nome: "Produto Teste",
                descricao: "Esta é uma descrição longa o suficiente com mais de dez caracteres",
                preco: -5.00, // Preço inválido para disparar a validação do seu código
                estoque: 10,
                categoria: "Eletrônicos"
            });

        // O seu backend possui o bloco: if (Number(preco) <= 0) return res.status(400)
        expect(resposta.statusCode).toBe(400);
        expect(resposta.body).toHaveProperty("message", "Preço inválido");
    });

    // --- TESTE 3: SEGURANÇA NA EDIÇÃO ---
    it("Deve recusar a atualização do produto se nenhum token for fornecido", async () => {
        const resposta = await request(app)
            .put("/api/products/1") // Tentando editar o produto ID 1
            .send({
                nome: "Tentativa de Alteração",
                descricao: "Descrição nova longa o suficiente aqui",
                preco: 99.90,
                estoque: 5
            });

        // Como a rota usa o authMiddleware e não enviamos token, o esperado é 401
        expect(resposta.statusCode).toBe(401);
    });

});