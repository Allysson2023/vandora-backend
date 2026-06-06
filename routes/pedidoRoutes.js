const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");
const { getIo } = require("../utils/socket");

router.post("/pedidos", authMiddleware, (req, res) => {

    const usuario_id = req.user.id;

    const {
        loja_id,
        total,
        produtos,
        tipoPedido,
        dadosEntrega
    } = req.body;

    const status = "AGUARDANDO_CONFIRMACAO";

    let dados = dadosEntrega;

    if (typeof dados === "string") {
        dados = JSON.parse(dados);
    }

    dados = dados || {};

    const sqlPedido = `
    INSERT INTO pedidos
    (usuario_id, loja_id, total, status,
     tipo_pedido, nome_cliente, endereco, numero, bairro, pagamento, cpf, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

    db.query(
        sqlPedido,
        [
            usuario_id,
            loja_id,
            total,
            status,
            tipoPedido,
            dados.nome || null,
            dados.endereco || null,
            dados.numero || null,
            dados.bairro || null,
            dados.pagamento || null,
            dados.cpf || null,
    dados.observacao || null
        ],
        (err, result) => {

            if (err) {
                return res.status(500).json(err);
            }

            const pedido_id = result.insertId;

            const itens = produtos.map((produto) => [
                pedido_id,
                produto.produto_id,
                produto.quantidade,
                produto.preco
            ]);

            const sqlItens = `
                INSERT INTO pedido_itens
                (pedido_id, produto_id, quantidade, preco)
                VALUES ?
            `;

            db.query(sqlItens, [itens], (err2) => {

                if (err2) {
                    return res.status(500).json(err2);
                }

                // =========================
                // 🔥 SOCKET (TEMPO REAL)
                // =========================
                const io = getIo();

                io.to(`loja_${loja_id}`).emit("novo_pedido", {
    id: pedido_id,
    loja_id,
    usuario_id,
    total,
    status: "AGUARDANDO_CONFIRMACAO",
    tipo_pedido: tipoPedido
});

                io.to(`loja_${loja_id}`).emit("dashboard_update", {
                    lojaId: loja_id
                });

                return res.json({
                    message: "Pedido criado com sucesso",
                    pedidoId: pedido_id
                });

            });

        }
    );
});


router.get("/pedidos/:id", authMiddleware, (req, res) => {

    const { id } = req.params;
    const userId = req.user.id;

    const sqlPedido = `
SELECT 
    pedidos.*,
    stores.user_id AS dono_loja,
    stores.nome AS loja_nome,
    stores.whatsapp AS whatsapp
FROM pedidos
JOIN stores ON stores.id = pedidos.loja_id
WHERE pedidos.id = ?
LIMIT 1
`;

    const sqlItens = `
        SELECT 
            pedido_itens.*,
            products.nome,
            products.imagem
        FROM pedido_itens
        JOIN products 
            ON products.id = pedido_itens.produto_id
        WHERE pedido_itens.pedido_id = ?
    `;

    db.query(sqlPedido, [id], (err, pedidoResult) => {

        if (err) {
            return res.status(500).json(err);
        }

        if (!pedidoResult.length) {
            return res.status(404).json({
                message: "Pedido não encontrado"
            });
        }

        const pedido = pedidoResult[0];

        // ✅ CLIENTE OU DONO DA LOJA
       const ehDonoLoja = Number(pedido.dono_loja) === Number(userId);
const ehCliente = Number(pedido.usuario_id) === Number(userId);

if (!ehCliente && !ehDonoLoja) {
    return res.status(403).json({
        message: "Sem permissão"
    });
}

        db.query(sqlItens, [id], (err2, itensResult) => {

            if (err2) {
                return res.status(500).json(err2);
            }

            const pedidoFormatado = {
                ...pedido,

                dadosEntrega: {
                    nome: pedido.nome_cliente,
                    endereco: pedido.endereco,
                    numero: pedido.numero,
                    bairro: pedido.bairro,
                    pagamento: pedido.pagamento,
                    cpf: pedido.cpf,
                    observacao: pedido.observacao
                }
            };

            res.json({
                pedido: pedidoFormatado,
                itens: itensResult || []
            });

        });

    });

});


router.get("/meus-pedidos", authMiddleware, (req, res) => {

    const usuario_id = req.user.id;

    const sql = `
        SELECT * FROM pedidos
        WHERE usuario_id = ?
        ORDER BY id DESC
    `;

    db.query(sql, [usuario_id], (err, result) => {

        if (err) return res.status(500).json(err);

        res.json(result);

    });

});

router.get("/loja/pedidos", authMiddleware, (req, res) => {

    const userId = req.user.id;

    const sql = `
        SELECT 
            pedidos.id,
            pedidos.total,
            pedidos.status,
            pedidos.tipo_pedido,
            pedidos.created_at,
            users.username,
            stores.nome AS loja_nome
        FROM pedidos
        JOIN stores ON stores.id = pedidos.loja_id
        JOIN users ON users.id = pedidos.usuario_id
        WHERE stores.user_id = ?
        ORDER BY pedidos.id DESC
    `;

    db.query(sql, [userId], (err, result) => {

        if (err) {
            return res.status(500).json(err);
        }

        res.json(result);

    });

});

router.get("/loja/:id/pedidos", authMiddleware, (req, res) => {

    const storeId = req.params.id;
    const userId = req.user.id;

    // 🔥 1. primeiro valida se essa loja pertence ao usuário logado
    const sqlLoja = `
        SELECT * FROM stores
        WHERE id = ? AND user_id = ?
    `;

    db.query(sqlLoja, [storeId, userId], (err, loja) => {

        if (err) return res.status(500).json(err);

        // ❌ não é dono da loja
        if (loja.length === 0) {
            return res.status(403).json({
                message: "Você não tem acesso a essa loja"
            });
        }

        // ✅ agora sim busca pedidos
        const sqlPedidos = `
            SELECT 
                pedidos.id,
                pedidos.total,
                pedidos.status,
                pedidos.tipo_pedido,
                users.username
            FROM pedidos
            JOIN users ON users.id = pedidos.usuario_id
            WHERE pedidos.loja_id = ?
            ORDER BY pedidos.id DESC
        `;

        db.query(sqlPedidos, [storeId], (err2, result) => {

            if (err2) return res.status(500).json(err2);

            return res.json(result);
        });

    });

});

router.put("/pedidos/:id/status", authMiddleware, (req, res) => {

    const pedidoId = req.params.id;
    const { status } = req.body;

    const userId = req.user.id;

const sqlPermissao = `
    SELECT pedidos.id
    FROM pedidos
    JOIN stores 
        ON stores.id = pedidos.loja_id
    WHERE pedidos.id = ?
    AND stores.user_id = ?
`;

db.query(sqlPermissao, [pedidoId, userId], (errPerm, resultPerm) => {

    if (errPerm) {
        return res.status(500).json(errPerm);
    }

    // ❌ não é dono da loja
    if (resultPerm.length === 0) {
        return res.status(403).json({
            message: "Sem permissão para alterar este pedido"
        });
    }

    continuarAtualizacao();
});
function continuarAtualizacao() {

const mensagemStatus = {
        aceito: "Seu pedido foi aceito pela loja ✅",
        separacao: "Seu pedido está em separação 📦",
        rota: "Seu pedido saiu para entrega 🛵",
        finalizado: "Pedido finalizado ✔️",
        recusado: "Seu pedido foi recusado ❌"
    };

    const sqlUpdatePedido = `
        UPDATE pedidos
        SET status = ?
        WHERE id = ?
    `;

    db.query(sqlUpdatePedido, [status, pedidoId], (err) => {

        if (err) {
            return res.status(500).json(err);
        }

        // =========================
        // 🔥 ESTOQUE SÓ SE FINALIZAR
        // =========================
        if (status === "finalizado") {

            const sqlItens = `
                SELECT produto_id, quantidade
                FROM pedido_itens
                WHERE pedido_id = ?
            `;

            db.query(sqlItens, [pedidoId], (errItens, itens) => {

                if (errItens) {
                    return res.status(500).json(errItens);
                }

                let faltando = false;
                let checkCount = 0;

                if (itens.length === 0) {
                    return finalizarPedido();
                }

                itens.forEach((item) => {

                    const sqlCheck = `
                        SELECT estoque
                        FROM products
                        WHERE id = ?
                    `;

                    db.query(sqlCheck, [item.produto_id], (errCheck, result) => {

                        if (errCheck) {
                            faltando = true;
                        }

                        const estoque = result?.[0]?.estoque || 0;

                        if (estoque < item.quantidade) {
                            faltando = true;
                        }

                        checkCount++;

                        if (checkCount === itens.length) {

                            // ❌ NÃO TEM ESTOQUE
                            if (faltando) {
                                return res.status(400).json({
                                    message: "Estoque insuficiente para finalizar pedido"
                                });
                            }

                            // ✅ BAIXAR ESTOQUE
                            itens.forEach((item) => {

                                const sqlUpdate = `
                                    UPDATE products
                                    SET estoque = estoque - ?
                                    WHERE id = ?
                                `;

                                db.query(sqlUpdate, [
                                    item.quantidade,
                                    item.produto_id
                                ]);
                            });

                            finalizarPedido();
                        }
                    });
                });
            });

        } else {
            finalizarPedido();
        }

        // =========================
        // 🔥 FUNÇÃO FINAL (NOTIFICAÇÃO + SOCKET)
        // =========================
        function finalizarPedido() {

            const sqlUser = `
                SELECT usuario_id, loja_id
                FROM pedidos
                WHERE id = ?
            `;

            db.query(sqlUser, [pedidoId], (err2, result) => {

                if (err2 || !result.length) {
                    return res.status(500).json(err2 || { message: "Pedido não encontrado" });
                }

                const usuarioId = result[0].usuario_id;
                const lojaId = result[0].loja_id;

                const sqlNotificacao = `
                    INSERT INTO notifications
                    (user_id, pedido_id, titulo, mensagem)
                    VALUES (?, ?, ?, ?)
                `;

                db.query(sqlNotificacao, [
                    usuarioId,
                    pedidoId,
                    "Atualização do Pedido",
                    mensagemStatus[status]
                ]);

                const io = getIo();

                io.to(`user_${usuarioId}`).emit("nova_notificacao", {
                    pedido_id: pedidoId,
                    mensagem: mensagemStatus[status],
                    titulo: "Atualização do Pedido"
                });

                if (status === "finalizado") {
                    io.emit("dashboard_update", {
                        lojaId
                    });
                }

                return res.json({
                    message: "Status atualizado com sucesso!"
                });
            });
        }

    });
}

});

router.get(
    "/stores/:id/mais-vendidos",
    authMiddleware,
    (req, res) => {

        const storeId = req.params.id;
        const userId = req.user.id;

        // 🔒 validar se a loja pertence ao usuário
        const sqlLoja = `
            SELECT *
            FROM stores
            WHERE id = ?
            AND user_id = ?
        `;

        db.query(sqlLoja, [storeId, userId], (errLoja, lojaResult) => {

            if (errLoja) {
                return res.status(500).json(errLoja);
            }

            if (lojaResult.length === 0) {
                return res.status(403).json({
                    message: "Sem permissão"
                });
            }

            // 🔥 ranking produtos mais vendidos
            const sql = `
                SELECT
                    products.id,
                    products.nome,
                    products.imagem,

                    SUM(pedido_itens.quantidade) AS total_vendido

                FROM pedido_itens

                JOIN products
                    ON products.id = pedido_itens.produto_id

                JOIN pedidos
                    ON pedidos.id = pedido_itens.pedido_id

                WHERE pedidos.loja_id = ?
                AND pedidos.status = 'finalizado'

                GROUP BY products.id

                ORDER BY total_vendido DESC
            `;

            db.query(sql, [storeId], (err, result) => {

                if (err) {
                    return res.status(500).json(err);
                }

                return res.json(result);

            });

        });

    }
);

module.exports = router;