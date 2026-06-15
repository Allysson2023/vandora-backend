const express = require("express");
const router = express.Router();
const db = require("../config/db"); // Certifique-se que este arquivo exporta a versão 'promise' do mysql2
const authMiddleware = require("../middlewares/authMiddleware");
const { getIo } = require("../utils/socket");

// 1. ROTA: CRIAÇÃO DE PEDIDOS
router.post("/pedidos", authMiddleware, async (req, res) => {

    // ADICIONE ESTAS LINHAS:
    console.log("--- DEBUG PEDIDO ---");
    console.log("Body recebido:", JSON.stringify(req.body, null, 2));
    console.log("Loja ID original:", req.body.loja_id);
    const usuario_id = req.user.id;
    const { loja_id, produtos, tipoPedido, dadosEntrega } = req.body;

    if (!Array.isArray(produtos) || produtos.length === 0) {
    return res.status(400).json({ message: "Carrinho vazio." });
}

    // 1. Validação estrita de campos obrigatórios
    if (!dadosEntrega || !dadosEntrega.nome || !dadosEntrega.pagamento) {
        return res.status(400).json({ message: "Dados de entrega ou pagamento faltando." });
    }

    if (tipoPedido === 'entrega' && (!dadosEntrega.endereco || !dadosEntrega.numero || !dadosEntrega.bairro)) {
        return res.status(400).json({ message: "Endereço completo é obrigatório para entrega." });
    }

    if (tipoPedido === 'retirada' && !dadosEntrega.cpf) {
        return res.status(400).json({ message: "CPF é obrigatório para retirada." });
    }
    
    const lojaIdInt = parseInt(loja_id, 10);
if (isNaN(lojaIdInt)) {
    return res.status(400).json({ message: "ID da loja inválido" });
}
    

    try {
        const idsProdutos = produtos.map(p => p.produto_id);
        const [produtosDoBanco] = await db.query("SELECT id, preco FROM products WHERE id IN (?)", [idsProdutos]);

        let totalCalculado = 0;
        
        const itensParaInserir = produtos.map(item => {
            const p = produtosDoBanco.find(prod => prod.id === Number(item.produto_id));
            if (!p) throw new Error(`Produto ${item.produto_id} não encontrado`);
            totalCalculado += Number(p.preco) * Number(item.quantidade);
            return [item.produto_id, item.quantidade, p.preco];
        });


// 2. ADICIONE O CÁLCULO DA TAXA
const taxaServico = totalCalculado * 0.03; // 3%
const totalFinal = totalCalculado + taxaServico ;


        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // INSERT EXPLICITO: Define exatamente quais colunas receberão dados
            const sqlPedido = `
    INSERT INTO pedidos (
        usuario_id, loja_id, total, taxa_servico, total_final,
        status, tipo_pedido, nome_cliente, endereco, numero, bairro, 
        pagamento, cpf, observacao
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

            const [result] = await connection.query(sqlPedido, [
    usuario_id, 
    lojaIdInt, 
    totalCalculado,
    taxaServico,
    totalFinal,
    "AGUARDANDO_CONFIRMACAO", 
    tipoPedido, 
    dadosEntrega.nome, 
    dadosEntrega.endereco, 
    dadosEntrega.numero, 
    dadosEntrega.bairro, 
    dadosEntrega.pagamento, 
    dadosEntrega.cpf || null, 
    dadosEntrega.observacao || null
]);
            
            const pedido_id = result.insertId;
            const itensFinais = itensParaInserir.map(i => [pedido_id, ...i]);
            
            await connection.query("INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, preco) VALUES ?", [itensFinais]);

            await connection.commit();
            connection.release();

            const io = getIo();
            io.to(`loja_${lojaIdInt}`).emit("novo_pedido", { id: pedido_id, total: totalCalculado });

            return res.json({ message: "Pedido criado", pedidoId: pedido_id });
        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }
    } catch (err) {
        console.error("Erro ao criar pedido:", err);
        res.status(500).json({ message: err.message || "Erro interno ao processar pedido" });
    }
});

// 2. ROTA: BUSCAR PEDIDO POR ID
router.get("/pedidos/:id", authMiddleware, async (req, res) => {
    try {
        const [pedidoResult] = await db.query(`
            SELECT p.*, s.nome as loja_nome, s.id as loja_id 
            FROM pedidos p 
            JOIN stores s ON s.id = p.loja_id 
            WHERE p.id = ?`, [req.params.id]);

        if (!pedidoResult.length) return res.status(404).json({ message: "Pedido não encontrado" });

        const pedido = pedidoResult[0];
        
        pedido.dadosEntrega = {
            nome: pedido.nome_cliente,
            endereco: pedido.endereco,
            numero: pedido.numero,
            bairro: pedido.bairro,
            pagamento: pedido.pagamento,
            cpf: pedido.cpf
        };

        const [itens] = await db.query("SELECT pi.*, pr.nome, pr.imagem FROM pedido_itens pi JOIN products pr ON pr.id = pi.produto_id WHERE pi.pedido_id = ?", [req.params.id]);
        
        res.json({ pedido, itens });
    } catch (err) {
        res.status(500).json({ message: "Erro ao buscar pedido" });
    }
});

// 3, 4, 5 (Ficarão muito curtas com async/await, apenas troque os callbacks por await db.query)
// Exemplo de uma simples:
router.get("/meus-pedidos", authMiddleware, async (req, res) => {
    try {
        const [pedidos] = await db.query("SELECT * FROM pedidos WHERE usuario_id = ? ORDER BY id DESC", [req.user.id]);
        res.json(pedidos);
    } catch (err) {
        res.status(500).json({ message: "Erro interno" });
    }
});

// 6. ROTA: ATUALIZAÇÃO DE STATUS (ESTOQUE)
router.put("/pedidos/:id/status", authMiddleware, async (req, res) => {
    const { status } = req.body;
    const { id } = req.params;
    
    try {
        const [perm] = await db.query("SELECT p.status FROM pedidos p JOIN stores s ON s.id = p.loja_id WHERE p.id = ? AND s.user_id = ?", [id, req.user.id]);
        if (!perm.length) return res.status(403).json({ message: "Sem permissão" });

        if (status === "finalizado") {
            const connection = await db.getConnection();
            await connection.beginTransaction();
            try {
                const [itens] = await connection.query("SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id]);
                for (const item of itens) {
                    const [up] = await connection.query("UPDATE products SET estoque = estoque - ? WHERE id = ? AND estoque >= ?", [item.quantidade, item.produto_id, item.quantidade]);
                    if (up.affectedRows === 0) throw new Error("Estoque insuficiente");
                }
                await connection.query("UPDATE pedidos SET status = 'finalizado' WHERE id = ?", [id]);
                await connection.commit();
                connection.release();
            } catch (err) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ message: err.message });
            }
        } else {
            await db.query("UPDATE pedidos SET status = ? WHERE id = ?", [status, id]);
        }
        res.json({ message: "Status atualizado" });
    } catch (err) {
        res.status(500).json({ message: "Erro interno" });
    }
});

// ROTA: BUSCAR PEDIDOS DA LOJA DO USUÁRIO LOGADO
router.get("/loja/pedidos", authMiddleware, async (req, res) => {
    try {
        // O SQL abaixo garante que o usuário só verá pedidos 
        // de lojas onde ele é o dono (s.user_id = req.user.id)
        const sql = `
            SELECT p.* FROM pedidos p 
            JOIN stores s ON s.id = p.loja_id 
            WHERE s.user_id = ? 
            ORDER BY p.id DESC
        `;
        
        const [pedidos] = await db.query(sql, [req.user.id]);
        
        res.json(pedidos);
    } catch (err) {
        console.error("Erro ao buscar pedidos da loja:", err);
        res.status(500).json({ message: "Erro interno ao buscar pedidos" });
    }
});



// ROTA: DETALHES DO PEDIDO (PARA O DONO DA LOJA)
// No seu rotas.js
// Agora a rota recebe o ID da loja como parâmetro
router.get("/loja/:loja_id/pedidos", authMiddleware, async (req, res) => {
    const { loja_id } = req.params;
    try {
        // SQL: busca pedidos desta loja E verifica se o usuário logado é o dono dela
        const sql = `
            SELECT p.* FROM pedidos p 
            JOIN stores s ON s.id = p.loja_id 
            WHERE p.loja_id = ? AND s.user_id = ? 
            ORDER BY p.id DESC
        `;
        
        const [pedidos] = await db.query(sql, [loja_id, req.user.id]);
        res.json(pedidos);
    } catch (err) {
        console.error("Erro:", err);
        res.status(500).json({ message: "Erro ao buscar pedidos da loja" });
    }
});



module.exports = router;