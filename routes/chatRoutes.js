const express = require("express");
const router = express.Router();

const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");
const { getIo } = require("../utils/socket");
function checkStoreOwner(req, res, next) {

    const lojaId = req.params.lojaId;

    const sql = `
        SELECT id
        FROM stores
        WHERE id = ?
        AND user_id = ?
        LIMIT 1
    `;

    db.query(
        sql,
        [lojaId, req.user.id],
        (err, result) => {

            if (err) {
                return res.status(500).json(err);
            }

            if (result.length === 0) {
                return res.status(403).json({
                    message: "Acesso negado"
                });
            }

            next();

        }
    );

}
function checkChatAccess(req, res, next) {

    const { chatId } = req.params;

    const sql = `
        SELECT 
            c.id,
            c.cliente_id,
            c.loja_id,
            s.user_id AS dono_loja
        FROM chats c
        INNER JOIN stores s ON s.id = c.loja_id
        WHERE c.id = ?
        LIMIT 1
    `;

    db.query(sql, [chatId], (err, result) => {

        if (err) {
            return res.status(500).json(err);
        }

        if (result.length === 0) {
            return res.status(404).json({
                message: "Chat não encontrado"
            });
        }

        const chat = result[0];

        const userId = Number(req.user.id);

        const isCliente = Number(chat.cliente_id) === userId;
        const isLojaOwner = Number(chat.dono_loja) === userId;

        // 🔥 BLOQUEIO TOTAL
        if (!isCliente && !isLojaOwner) {
            return res.status(403).json({
                message: "Você não tem acesso a esse chat"
            });
        }

        // 🔥 IMPORTANTE: salva no req pra reutilizar
        req.chat = chat;

        next();
    });
}
function checkChatMessageAccess(req, res, next) {
    const { chat_id } = req.body;

    // só garante login
    if (!req.user) {
        return res.status(401).json({
            message: "Precisa estar logado"
        });
    }

    // se não tem chat_id, deixa criar novo chat
    if (!chat_id) {
        return next();
    }

    const sql = `
        SELECT c.*, s.user_id as dono_loja
        FROM chats c
        INNER JOIN stores s ON s.id = c.loja_id
        WHERE c.id = ?
        LIMIT 1
    `;

    db.query(sql, [chat_id], (err, result) => {

        if (err) return res.status(500).json(err);

        if (result.length === 0) {
            return next(); // chat novo permitido
        }

        const chat = result[0];

       const usuarioEhCliente =
    Number(chat.cliente_id) === Number(req.user.id);

const usuarioEhDonoLoja =
    Number(chat.dono_loja) === Number(req.user.id);

        if (!usuarioEhCliente && !usuarioEhDonoLoja) {
            return res.status(403).json({
                message: "Acesso negado"
            });
        }

        next();
    });
}

 router.get("/cliente", authMiddleware, (req, res) => {
        
            const clienteId = req.user.id;
        
            const sql = `
                SELECT 
                    c.id AS chatId,
                    c.loja_id,
                    c.atualizado_em,
        
                    (
                        SELECT mensagem
                        FROM mensagens m
                        WHERE m.chat_id = c.id
                        ORDER BY m.id DESC
                        LIMIT 1
                    ) AS ultimaMensagem,
        
                    l.nome AS nomeLoja
        
                FROM chats c
        
                INNER JOIN stores l ON l.id = c.loja_id
        
                WHERE c.cliente_id = ?
        
                ORDER BY c.atualizado_em DESC
            `;
        
            db.query(sql, [clienteId], (err, result) => {
        
                if (err) {
                    console.log(err);
                    return res.status(500).json(err);
                }
        
                res.json(result);
        
            });
        
        });
// ==========================================
// LISTAR CHATS DA LOJA (INBOX)
// ==========================================
router.get("/loja/:lojaId", authMiddleware,
    checkStoreOwner, (req, res) => {

    const { lojaId } = req.params;

    const sql = `
       SELECT
    c.id,
    c.pedido_id,
    c.cliente_id,
    c.loja_id,
    c.criado_em,
    c.atualizado_em,
    c.tem_nova_msg,

    u.username AS cliente_nome,

    (
        SELECT mensagem
        FROM mensagens m
        WHERE m.chat_id = c.id
        ORDER BY m.id DESC
        LIMIT 1
    ) as ultima_mensagem

FROM chats c

INNER JOIN users u
    ON u.id = c.cliente_id

WHERE c.loja_id = ?

ORDER BY c.atualizado_em DESC
    `;

    db.query(sql, [lojaId], (err, result) => {

        if (err) {
            console.log(err);
            return res.status(500).json(err);
        }

        res.json(result);

    });

});

// ==========================================
// DADOS DO CHAT
// ==========================================
router.get("/:chatId", authMiddleware,
    checkChatAccess, (req, res) => {

    const { chatId } = req.params;

    const sql = `
        SELECT
            c.*,
            s.nome AS loja_nome
        FROM chats c

        INNER JOIN stores s
            ON s.id = c.loja_id

        WHERE c.id = ?
        LIMIT 1
    `;

    db.query(sql, [chatId], (err, result) => {

        if (err) {
            return res.status(500).json(err);
        }

        if (result.length === 0) {
            return res.status(404).json({
                message: "Chat não encontrado"
            });
        }

        res.json(result[0]);

    });

});

// ==========================================
// LISTAR MENSAGENS DO CHAT
// ==========================================
router.get("/:chatId/mensagens", authMiddleware,
    checkChatAccess, (req, res) => {

    const { chatId } = req.params;

    const sql = `
        SELECT *
        FROM mensagens
        WHERE chat_id = ?
        ORDER BY criado_em ASC
    `;

    db.query(sql, [chatId], (err, result) => {

        if (err) {
            console.log(err);
            return res.status(500).json(err);
        }

        res.json(result);

    });

});


// ==========================================
// ENVIAR MENSAGEM
// ==========================================
router.post("/mensagem", authMiddleware, (req, res) => {

    const {
        chat_id,
        mensagem,
        tipo,
        remetente_tipo,
        loja_id,
        cliente_id
    } = req.body;

    const remetente_id = req.user.id;

    // ==========================================
    // CRIAR CHAT SE NÃO EXISTIR
    // ==========================================
    if (!chat_id) {

        const criarChat = `
            INSERT INTO chats
            (pedido_id, cliente_id, loja_id, atualizado_em, tem_nova_msg)
            VALUES (?, ?, ?, NOW(), TRUE)
        `;

        db.query(
            criarChat,
            [
                null,
                remetente_tipo === "cliente"
                    ? remetente_id
                    : cliente_id,
                loja_id
            ],
            (err, result) => {

                if (err) {
                    return res.status(500).json(err);
                }

                const novoChatId = result.insertId;

                salvarMensagem(novoChatId);
            }
        );

    } else {

        salvarMensagem(chat_id);

    }

    // ==========================================
    // SALVAR MENSAGEM
    // ==========================================
    function salvarMensagem(chatId) {

        const sql = `
            INSERT INTO mensagens
            (chat_id, remetente_id, remetente_tipo, tipo, mensagem)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [
                chatId,
                remetente_id,
                remetente_tipo,
                tipo,
                mensagem
            ],
            (err, result) => {

                if (err) {
                    return res.status(500).json(err);
                }

                // ==========================================
                // BUSCAR LOJA DO CHAT
                // ==========================================
                const buscarLoja = `
                    SELECT loja_id
                    FROM chats
                    WHERE id = ?
                    LIMIT 1
                `;

                db.query(
                    buscarLoja,
                    [chatId],
                    (err2, chatResult) => {

                        if (err2) {
                            return res.status(500).json(err2);
                        }

                        if (chatResult.length === 0) {
                            return res.status(404).json({
                                message: "Chat não encontrado"
                            });
                        }

                        const lojaIdReal =
                            chatResult[0].loja_id;

                        const novaMensagem = {
                            id: result.insertId,
                            chat_id: chatId,
                            loja_id: lojaIdReal,
                            mensagem,
                            remetente_tipo,
                            remetente_id,
                            criado_em: new Date().toISOString()
                        };

                        const io = getIo();

                        console.log("==============");
                        console.log("CHAT:", chatId);
                        console.log("LOJA_ID:", lojaIdReal);
                        console.log("REMETENTE:", remetente_tipo);
                        console.log("MSG:", mensagem);
                        console.log("==============");

                        // mensagem dentro do chat
                        io.to(`chat_${chatId}`).emit(
                            "nova_mensagem",
                            novaMensagem
                        );

                        // atualizar inbox da loja
                        io.to(`loja_${lojaIdReal}`).emit(
                            "nova_mensagem_loja",
                            novaMensagem
                        );

                        return res.json({
                            message: "Mensagem enviada",
                            chat_id: chatId,
                            id: result.insertId
                        });
                    }
                );
            }
        );
    }
});

        
router.post("/abrir", authMiddleware, (req, res) => {

    const cliente_id = req.user.id;
    const { loja_id } = req.body;

    // procura chat existente
    const buscarChat = `
        SELECT *
        FROM chats
        WHERE cliente_id = ?
        AND loja_id = ?
        LIMIT 1
    `;

    db.query(
        buscarChat,
        [cliente_id, loja_id],
        (err, result) => {

            if (err) {
                return res.status(500).json(err);
            }

            // já existe
            if (result.length > 0) {

                return res.json({
                    chat_id: result[0].id
                });

            }

            // cria novo
            const criarChat = `
                INSERT INTO chats
                (cliente_id, loja_id, atualizado_em)
                VALUES (?, ?, NOW())
            `;

            db.query(
                criarChat,
                [cliente_id, loja_id],
                (err2, result2) => {

                    if (err2) {
                        return res.status(500).json(err2);
                    }

                    res.json({
                        chat_id: result2.insertId
                    });

                }
            );

        }
    );

});



// ==========================================
// MARCAR CHAT COMO VISUALIZADO
// ==========================================
router.put("/visualizar/:chatId", authMiddleware,
    checkChatAccess, (req, res) => {

    const { chatId } = req.params;

    const sql = `
        UPDATE chats
        SET tem_nova_msg = FALSE
        WHERE id = ?
    `;

    db.query(sql, [chatId], (err) => {

        if (err) {
            console.log(err);
            return res.status(500).json(err);
        }

        res.json({
            message: "Chat visualizado"
        });

    });

});



module.exports = router;