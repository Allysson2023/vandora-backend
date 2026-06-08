const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");
const { getIo } = require("../utils/socket");

// ==========================================
// 1. ROTA: CRIAÇÃO DE PEDIDOS (SEGURA)
// ==========================================
router.post("/pedidos", authMiddleware, async (req, res) => {
    const usuario_id = req.user.id;
    const { loja_id, produtos, tipoPedido, dadosEntrega } = req.body;
    const status = "AGUARDANDO_CONFIRMACAO";

    if (!Number.isInteger(Number(loja_id))) {
        return res.status(400).json({ message: "Loja inválida" });
    }

    if (!Array.isArray(produtos) || produtos.length === 0) {
        return res.status(400).json({ message: "Produtos inválidos" });
    }

    for (const prod of produtos) {
        if (!Number.isInteger(Number(prod.produto_id)) || Number(prod.produto_id) <= 0) {
            return res.status(400).json({ message: "Produto inválido" });
        }
        if (!Number.isInteger(Number(prod.quantidade)) || Number(prod.quantidade) <= 0) {
            return res.status(400).json({ message: "Quantidade inválida" });
        }
    }

    let dados = dadosEntrega;
    try {
        if (typeof dados === "string") {
            dados = JSON.parse(dados);
        }
    } catch {
        return res.status(400).json({ message: "Dados de entrega inválidos" });
    }
    dados = dados || {};

    const idsProdutos = produtos.map(p => p.produto_id);
    
    db.query("SELECT id, preco FROM products WHERE id IN (?)", [idsProdutos], (errProdutos, produtosDoBanco) => {
        if (errProdutos) {
            console.error("Erro ao buscar produtos no banco:", errProdutos);
            return res.status(500).json({ message: "Erro interno no servidor" });
        }

        let totalCalculado = 0;
        const itensParaInserir = [];

        for (const itemEnviado of produtos) {
            const produtoOriginal = produtosDoBanco.find(p => p.id === Number(itemEnviado.produto_id));
            
            if (!produtoOriginal) {
                return res.status(400).json({ message: `Produto ${itemEnviado.produto_id} não encontrado` });
            }

            const precoReal = produtoOriginal.preco;
            totalCalculado += precoReal * itemEnviado.quantidade;

            itensParaInserir.push([
                itemEnviado.produto_id, 
                itemEnviado.quantidade, 
                precoReal
            ]);
        }

        db.beginTransaction((errTx) => {
            if (errTx) {
                console.error("Erro ao iniciar transação:", errTx);
                return res.status(500).json({ message: "Erro interno no servidor" });
            }

            const sqlPedido = `
                INSERT INTO pedidos 
                (usuario_id, loja_id, total, status, tipo_pedido, nome_cliente, endereco, numero, bairro, pagamento, cpf, observacao) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const paramsPedido = [
                usuario_id, loja_id, totalCalculado, status, tipoPedido,
                dados.nome || null, dados.endereco || null, dados.numero || null,
                dados.bairro || null, dados.pagamento || null, dados.cpf || null, dados.observacao || null
            ];

            db.query(sqlPedido, paramsPedido, (errPedido, result) => {
                if (errPedido) {
                    return db.rollback(() => {
                        console.error("Erro ao inserir em pedidos:", errPedido);
                        res.status(500).json({ message: "Erro ao salvar pedido" });
                    });
                }

                const pedido_id = result.insertId;
                const itensFinais = itensParaInserir.map(item => [pedido_id, ...item]);

                const sqlItens = `
                    INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, preco) 
                    VALUES ?
                `;

                db.query(sqlItens, [itensFinais], (errItens) => {
                    if (errItens) {
                        return db.rollback(() => {
                            console.error("Erro ao inserir em pedido_itens:", errItens);
                            res.status(500).json({ message: "Erro ao salvar itens" });
                        });
                    }

                    db.commit((errCommit) => {
                        if (errCommit) {
                            return db.rollback(() => {
                                console.error("Erro no commit:", errCommit);
                                res.status(500).json({ message: "Erro ao finalizar pedido" });
                            });
                        }

                        try {
                            const io = getIo();
                            io.to(`loja_${loja_id}`).emit("novo_pedido", {
                                id: pedido_id, loja_id, usuario_id,
                                total: totalCalculado, status, tipo_pedido: tipoPedido
                            });
                            io.to(`loja_${loja_id}`).emit("dashboard_update", { lojaId: loja_id });
                        } catch (socketErr) {
                            console.error("Aviso: Falha ao emitir Socket.IO:", socketErr);
                        }

                        return res.json({
                            message: "Pedido criado com sucesso",
                            pedidoId: pedido_id
                        });
                    });
                });
            });
        });
    });
});

// ==========================================
// 2. ROTA: BUSCAR PEDIDO POR ID (PROTEGIDA)
// ==========================================
router.get("/pedidos/:id", authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const sqlPedido = `
        SELECT pedidos.*, stores.user_id AS dono_loja, stores.nome AS loja_nome, stores.whatsapp AS whatsapp
        FROM pedidos
        JOIN stores ON stores.id = pedidos.loja_id
        WHERE pedidos.id = ? LIMIT 1
    `;

    const sqlItens = `
        SELECT pedido_itens.*, products.nome, products.imagem
        FROM pedido_itens
        JOIN products ON products.id = pedido_itens.produto_id
        WHERE pedido_itens.pedido_id = ?
    `;

    db.query(sqlPedido, [id], (err, pedidoResult) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Erro ao buscar pedido" });
        }

        if (!pedidoResult.length) {
            return res.status(404).json({ message: "Pedido não encontrado" });
        }

        const pedido = pedidoResult[0];
        const ehDonoLoja = Number(pedido.dono_loja) === Number(userId);
        const ehCliente = Number(pedido.usuario_id) === Number(userId);

        if (!ehCliente && !ehDonoLoja) {
            return res.status(403).json({ message: "Sem permissão para visualizar este pedido" });
        }

        db.query(sqlItens, [id], (err2, itensResult) => {
            if (err2) {
                console.error(err2);
                return res.status(500).json({ message: "Erro ao buscar itens do pedido" });
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

// ==========================================
// 3. ROTA: MEUS PEDIDOS (CLIENTE LOGADO)
// ==========================================
router.get("/meus-pedidos", authMiddleware, (req, res) => {
    const usuario_id = req.user.id;
    const sql = "SELECT * FROM pedidos WHERE usuario_id = ? ORDER BY id DESC";

    db.query(sql, [usuario_id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Erro ao buscar históricos" });
        }
        res.json(result);
    });
});

// ==========================================
// 4. ROTA: PEDIDOS GERAIS DA LOJA DO USUÁRIO
// ==========================================
router.get("/loja/pedidos", authMiddleware, (req, res) => {
    const userId = req.user.id;
    const sql = `
        SELECT pedidos.id, pedidos.total, pedidos.status, pedidos.tipo_pedido, pedidos.created_at, users.username, stores.nome AS loja_nome
        FROM pedidos
        JOIN stores ON stores.id = pedidos.loja_id
        JOIN users ON users.id = pedidos.usuario_id
        WHERE stores.user_id = ? ORDER BY pedidos.id DESC
    `;

    db.query(sql, [userId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Erro ao listar pedidos" });
        }
        res.json(result);
    });
});

// ==========================================
// 5. ROTA: PEDIDOS DE UMA LOJA ESPECÍFICA (DONO VÁLIDO)
// ==========================================
router.get("/loja/:id/pedidos", authMiddleware, (req, res) => {
    const storeId = req.params.id;
    const userId = req.user.id;

    const sqlLoja = "SELECT id FROM stores WHERE id = ? AND user_id = ?";

    db.query(sqlLoja, [storeId, userId], (err, loja) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Erro interno no servidor" });
        }

        if (loja.length === 0) {
            return res.status(403).json({ message: "Você não tem acesso a essa loja" });
        }

        const sqlPedidos = `
            SELECT pedidos.id, pedidos.total, pedidos.status, pedidos.tipo_pedido, users.username
            FROM pedidos
            JOIN users ON users.id = pedidos.usuario_id
            WHERE pedidos.loja_id = ? ORDER BY pedidos.id DESC
        `;

        db.query(sqlPedidos, [storeId], (err2, result) => {
            if (err2) {
                console.error(err2);
                return res.status(500).json({ message: "Erro ao buscar os pedidos" });
            }
            return res.json(result);
        });
    });
});

// ==========================================
// 6. ROTA: ATUALIZAÇÃO DE STATUS + BLINDAGEM DE ESTOQUE
// ==========================================
router.put("/pedidos/:id/status", authMiddleware, (req, res) => {
    const pedidoId = req.params.id;
    const { status } = req.body;
    const userId = req.user.id;

    // 🛡️ BLINDAGEM 1: Valida se o status enviado é legítimo (Evita injeção ou estados inválidos)
    const statusPermitidos = ["AGUARDANDO_CONFIRMACAO", "aceito", "separacao", "rota", "finalizado", "recusado"];
    if (!statusPermitidos.includes(status)) {
        return res.status(400).json({ message: "Status inválido solicitado." });
    }

    const sqlPermissao = `
        SELECT pedidos.id, pedidos.status AS status_atual
        FROM pedidos
        JOIN stores ON stores.id = pedidos.loja_id
        WHERE pedidos.id = ? AND stores.user_id = ?
    `;

    db.query(sqlPermissao, [pedidoId, userId], (errPerm, resultPerm) => {
        if (errPerm) {
            console.error(errPerm);
            return res.status(500).json({ message: "Erro ao validar permissões" });
        }

        if (resultPerm.length === 0) {
            return res.status(403).json({ message: "Sem permissão para alterar este pedido" });
        }

        const pedidoOriginal = resultPerm[0];

        // 🛡️ BLINDAGEM 2: Impede re-processar estoque se o pedido já estiver finalizado
        if (pedidoOriginal.status_atual === "finalizado" && status === "finalizado") {
            return res.status(400).json({ message: "Este pedido já foi finalizado anteriormente." });
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

        const sqlUpdatePedido = "UPDATE pedidos SET status = ? WHERE id = ?";

        db.query(sqlUpdatePedido, [status, pedidoId], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Erro ao atualizar status" });
            }

            if (status === "finalizado") {
                const sqlItens = "SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?";

                db.query(sqlItens, [pedidoId], (errItens, itens) => {
                    if (errItens) {
                        console.error(errItens);
                        return res.status(500).json({ message: "Erro ao processar estoque" });
                    }

                    if (itens.length === 0) {
                        return enviarNotificacoes();
                    }

                    // 🛡️ BLINDAGEM 3: Transação atômica para checar e subtrair estoque (Sem Race Conditions)
                    db.beginTransaction((errEstoqueTx) => {
                        if (errEstoqueTx) {
                            console.error(errEstoqueTx);
                            return res.status(500).json({ message: "Erro interno no inventário" });
                        }

                        let errosEstoque = 0;
                        let processados = 0;

                        itens.forEach((item) => {
                            // Subtrai apenas se o estoque resultante for maior ou igual a 0
                            const sqlSubtrairEstoque = `
                                UPDATE products 
                                SET estoque = estoque - ? 
                                WHERE id = ? AND estoque >= ?
                            `;

                            db.query(sqlSubtrairEstoque, [item.quantidade, item.produto_id, item.quantidade], (errUp, resUp) => {
                                processados++;

                                if (errUp || resUp.affectedRows === 0) {
                                    errosEstoque++;
                                }

                                if (processados === itens.length) {
                                    if (errosEstoque > 0) {
                                        return db.rollback(() => {
                                            // Reverte o status do pedido para não quebrar a consistência
                                            db.query("UPDATE pedidos SET status = 'separacao' WHERE id = ?", [pedidoId]);
                                            return res.status(400).json({ 
                                                message: "Estoque insuficiente ou falha ao dar baixa nos produtos." 
                                            });
                                        });
                                    }

                                    db.commit((errEstoqueCommit) => {
                                        if (errEstoqueCommit) {
                                            return db.rollback(() => {
                                                return res.status(500).json({ message: "Erro ao consolidar estoque" });
                                            });
                                        }
                                        enviarNotificacoes();
                                    });
                                }
                            });
                        });
                    });
                }
                );
            } else {
                enviarNotificacoes();
            }

            function enviarNotificacoes() {
                const sqlUser = "SELECT usuario_id, loja_id FROM pedidos WHERE id = ?";

                db.query(sqlUser, [pedidoId], (err2, result) => {
                    if (err2 || !result.length) {
                        return res.status(500).json({ message: "Pedido não localizado para notificações" });
                    }

                    const usuarioId = result[0].usuario_id;
                    const lojaId = result[0].loja_id;

                    const sqlNotificacao = `
                        INSERT INTO notifications (user_id, pedido_id, titulo, mensagem) VALUES (?, ?, ?, ?)
                    `;

                    db.query(sqlNotificacao, [
                        usuarioId,
                        pedidoId,
                        "Atualização do Pedido",
                        mensagemStatus[status] || "Seu pedido mudou de estado"
                    ]);

                    try {
                        const io = getIo();
                        io.to(`user_${usuarioId}`).emit("nova_notificacao", {
                            pedido_id: pedidoId,
                            mensagem: mensagemStatus[status] || "Seu pedido mudou de estado",
                            titulo: "Atualização do Pedido"
                        });

                        if (status === "finalizado") {
                            io.emit("dashboard_update", { lojaId });
                        }
                    } catch (skErr) {
                        console.error("Erro Socket:", skErr);
                    }

                    return res.json({ message: "Status atualizado com sucesso!" });
                });
            }
        });
    }
});

// ==========================================
// 7. ROTA: MAIS VENDIDOS DA LOJA
// ==========================================
router.get("/stores/:id/mais-vendidos", authMiddleware, (req, res) => {
    const storeId = req.params.id;
    const userId = req.user.id;

    const sqlLoja = "SELECT id FROM stores WHERE id = ? AND user_id = ?";

    db.query(sqlLoja, [storeId, userId], (errLoja, lojaResult) => {
        if (errLoja) {
            console.error(errLoja);
            return res.status(500).json({ message: "Erro no servidor" });
        }

        if (lojaResult.length === 0) {
            return res.status(403).json({ message: "Sem permissão para consultar dados desta loja" });
        }

        const sql = `
            SELECT products.id, products.nome, products.imagem, SUM(pedido_itens.quantidade) AS total_vendido
            FROM pedido_itens
            JOIN products ON products.id = pedido_itens.produto_id
            JOIN pedidos ON pedidos.id = pedido_itens.pedido_id
            WHERE pedidos.loja_id = ? AND pedidos.status = 'finalizado'
            GROUP BY products.id ORDER BY total_vendido DESC
        `;

        db.query(sql, [storeId], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Erro ao gerar ranking de vendas" });
            }
            return res.json(result);
        });
    });
});

module.exports = router;