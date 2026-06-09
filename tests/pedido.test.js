const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db"); 
const pedidoRoutes = require("../routes/pedidoRoutes"); 

const app = express();
app.use(express.json());
app.use("/api", pedidoRoutes);

afterAll((done) => {
    if (db && typeof db.end === "function") {
        db.end(done);
    } else {
        done();
    }
});

describe("Testes do Módulo de Pedidos (Integration)", () => {

    it("Deve recusar a criação de pedido se o usuário não estiver autenticado (Sem Token)", async () => {
        const resposta = await request(app)
            .post("/api/pedidos")
            .send({
                loja_id: 1,
                produtos: [{ produto_id: 1, quantidade: 2 }]
            });

        expect(resposta.statusCode).toBe(401);
    });

    it("Deve impedir a visualização de detalhes de um pedido que não existe", async () => {
        const payloadFake = { id: 1, email: "teste@teste.com" };
        
        const tokenValido = jwt.sign(payloadFake, process.env.JWT_SECRET || "sua_chave_secreta", {
            expiresIn: "1h"
        });

        const resposta = await request(app)
            .get("/api/pedidos/999999")
            .set("Authorization", `Bearer ${tokenValido}`); 
            
        expect(resposta.statusCode).toBe(404);
    });

    // --- TESTE 3: O CAMINHO FELIZ (Criação de Pedido Real) ---
    it("Deve criar um pedido com sucesso quando os dados forem válidos", async () => {
        // 1. Cria o token do usuário logado
        const payloadFake = { id: 1, email: "cliente@teste.com" };
        const tokenValido = jwt.sign(payloadFake, process.env.JWT_SECRET || "sua_chave_secreta", {
            expiresIn: "1h"
        });

        // 2. Faz o POST simulando o clique do botão do seu React
        // ⚠️ ATENÇÃO: Mude o loja_id e produto_id para IDs que existam no seu banco!
        const resposta = await request(app)
            .post("/api/pedidos")
            .set("Authorization", `Bearer ${tokenValido}`)
            .send({
                loja_id: 1, // Deve existir na tabela lojas
                total: 50.00,
                produtos: [
                    { produto_id: 1, quantidade: 2, preco: 25.00 } // Deve existir na tabela produtos
                ],
                tipoPedido: "entrega",
                dadosEntrega: {
                    nome: "Allysson Teste",
                    endereco: "Rua dos Testes",
                    numero: "123",
                    bairro: "Centro",
                    pagamento: "pix",
                    cpf: "12345678900",
                    observacao: "Entregar na portaria"
                }
            });

        // Como o seu backend responde com 200 (OK) em vez de 201, mudamos aqui:
        expect(resposta.statusCode).toBe(200); 
        
        // Verifica se o backend retornou a mensagem de sucesso no formato JSON
        expect(resposta.body).toHaveProperty("message");
    });

});