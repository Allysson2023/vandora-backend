const express = require("express");
const router = express.Router();
const db = require("../config/db"); // Certifique-se que este arquivo exporta a versão 'promise' do mysql2
const authMiddleware = require("../middlewares/authMiddleware");
const { getIo } = require("../utils/socket");

// 1. ROTA: CRIAÇÃO DE PEDIDOS
router.post("/pedidos", authMiddleware, async (req, res) => {
    const usuario_id = req.user.id;
    const { loja_id, produtos, tipoPedido, dadosEntrega } = req.body;
    
    // [Validações de entrada mantidas iguais]
    if (!Number.isInteger(Number(loja_id)) || !Array.isArray(produtos) || produtos.length === 0) {
        return res.status(400).json({ message: "Dados inválidos" });
    }

    try {
        const idsProdutos = produtos.map(p => p.produto_id);
        const [produtosDoBanco] = await db.query("SELECT id, preco FROM products WHERE id IN (?)", [idsProdutos]);

        let totalCalculado = 0;
        const itensParaInserir = produtos.map(item => {
            const p = produtosDoBanco.find(prod => prod.id === Number(item.produto_id));
            if (!p) throw new Error(`Produto ${item.produto_id} não encontrado`);
            totalCalculado += p.preco * item.quantidade;
            return [item.produto_id, item.quantidade, p.preco];
        });

        // Transação
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            const sqlPedido = `INSERT INTO pedidos (usuario_id, loja_id, total, status, tipo_pedido, nome_cliente, endereco, numero, bairro, pagamento, cpf, observacao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
            const [result] = await connection.query(sqlPedido, [usuario_id, loja_id, totalCalculado, "AGUARDANDO_CONFIRMACAO", tipoPedido, dadosEntrega.nome, dadosEntrega.endereco, dadosEntrega.numero, dadosEntrega.bairro, dadosEntrega.pagamento, dadosEntrega.cpf, dadosEntrega.observacao]);
            
            const pedido_id = result.insertId;
            const itensFinais = itensParaInserir.map(i => [pedido_id, ...i]);
            await connection.query("INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, preco) VALUES ?", [itensFinais]);

            await connection.commit();
            connection.release();

            // Socket
            const io = getIo();
            io.to(`loja_${loja_id}`).emit("novo_pedido", { id: pedido_id, total: totalCalculado });

            return res.json({ message: "Pedido criado", pedidoId: pedido_id });
        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message || "Erro interno" });
    }
});

// 2. ROTA: BUSCAR PEDIDO POR ID
router.get("/pedidos/:id", authMiddleware, async (req, res) => {
    try {
        const [pedidoResult] = await db.query(`SELECT p.*, s.user_id AS dono_loja FROM pedidos p JOIN stores s ON s.id = p.loja_id WHERE p.id = ?`, [req.params.id]);
        if (!pedidoResult.length) return res.status(404).json({ message: "Pedido não encontrado" });

        const pedido = pedidoResult[0];
        if (Number(pedido.usuario_id) !== req.user.id && Number(pedido.dono_loja) !== req.user.id) {
            return res.status(403).json({ message: "Acesso negado" });
        }

        const [itens] = await db.query("SELECT pi.*, pr.nome FROM pedido_itens pi JOIN products pr ON pr.id = pi.produto_id WHERE pi.pedido_id = ?", [req.params.id]);
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
        // Validações e Permissões...
        const [perm] = await db.query("SELECT p.status FROM pedidos p JOIN stores s ON s.id = p.loja_id WHERE p.id = ? AND s.user_id = ?", [id, req.user.id]);
        if (!perm.length) return res.status(403).json({ message: "Sem permissão" });

        // Se for finalizado, inicia transação de estoque
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

module.exports = router;