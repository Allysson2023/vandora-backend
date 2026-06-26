const express = require("express");
const router = express.Router();

const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");
const { getIo } = require("../utils/socket");


async function checkStoreOwner(req, res, next) {
    try {
        const [result] = await db.query("SELECT id FROM stores WHERE id = ? AND user_id = ? LIMIT 1", [req.params.lojaId, req.user.id]);
        if (result.length === 0) return res.status(403).json({ message: "Acesso negado" });
        next();
    } catch (err) {
        console.error("Erro no checkStoreOwner:", err);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
}

async function checkChatAccess(req, res, next) {
    try {
        const [result] = await db.query("SELECT c.*, s.user_id AS dono_loja FROM chats c INNER JOIN stores s ON s.id = c.loja_id WHERE c.id = ? LIMIT 1", [req.params.chatId]);
        if (result.length === 0) return res.status(404).json({ message: "Chat não encontrado" });
        
        const chat = result[0];
        if (Number(chat.cliente_id) !== Number(req.user.id) && Number(chat.dono_loja) !== Number(req.user.id)) {
            return res.status(403).json({ message: "Você não tem acesso a esse chat" });
        }
        req.chat = chat;
        next();
    } catch (err) {
        console.error("Erro no checkChatAccess:", err);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
}


async function checkChatMessageAccess(req, res, next) {
    if (!req.user) return res.status(401).json({ message: "Precisa estar logado" });
    if (!req.body.chat_id) return next();

    try {
        const [result] = await db.query(`
            SELECT c.*, s.user_id as dono_loja 
            FROM chats c 
            INNER JOIN stores s ON s.id = c.loja_id 
            WHERE c.id = ? LIMIT 1`, [req.body.chat_id]);

        if (result.length === 0) return res.status(404).json({ message: "Chat não encontrado" });
        
        const chat = result[0];
        const userId = Number(req.user.id);
        if (Number(chat.cliente_id) !== userId && Number(chat.dono_loja) !== userId) {
            return res.status(403).json({ message: "Acesso negado" });
        }
        next();
    } catch (err) {
        console.error("Erro no checkChatMessageAccess:", err);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
}

router.get("/cliente", authMiddleware, async (req, res) => {
    try {
        const [result] = await db.query(`
            SELECT c.id AS chatId, c.loja_id, c.atualizado_em, l.nome AS nomeLoja,
            (SELECT mensagem FROM mensagens m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultimaMensagem
            FROM chats c INNER JOIN stores l ON l.id = c.loja_id WHERE c.cliente_id = ? ORDER BY c.atualizado_em DESC`, [req.user.id]);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Erro interno ao buscar conversas" });
    }
});


router.get("/loja/:lojaId", authMiddleware, checkStoreOwner, async (req, res) => {
    try {
        const [result] = await db.query(`
            SELECT c.*, u.username AS cliente_nome,
            (SELECT mensagem FROM mensagens m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) as ultima_mensagem
            FROM chats c INNER JOIN users u ON u.id = c.cliente_id WHERE c.loja_id = ? ORDER BY c.atualizado_em DESC`, [req.params.lojaId]);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Erro interno ao buscar o inbox da loja" });
    }
});


// ==========================================
// DADOS DO CHAT (DADOS DE CABEÇALHO/METADADOS)
// ==========================================
router.get("/:chatId", authMiddleware, checkChatAccess, async (req, res) => {
    try {
        const [result] = await db.query("SELECT c.*, s.nome AS loja_nome FROM chats c INNER JOIN stores s ON s.id = c.loja_id WHERE c.id = ?", [req.params.chatId]);
        res.json(result[0]);
    } catch (err) {
        res.status(500).json({ error: "Erro interno ao buscar dados do chat" });
    }
});

// ==========================================
// LISTAR MENSAGENS DO CHAT (HISTÓRICO DA CONVERSA)
// ==========================================
router.get("/:chatId/mensagens", authMiddleware, checkChatAccess, async (req, res) => {
    try {
        const [result] = await db.query("SELECT * FROM mensagens WHERE chat_id = ? ORDER BY criado_em ASC", [req.params.chatId]);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Erro interno ao carregar o histórico de mensagens" });
    }
});
// ==========================================================
// ENVIAR MENSAGEM (COM CRIAÇÃO DE CHAT DINÂMICA E WEBSOCKET)
// ==========================================================
router.post("/mensagem", authMiddleware, checkChatMessageAccess, async (req, res) => {
    const { chat_id, mensagem, tipo, remetente_tipo, loja_id, cliente_id } = req.body;
    const remetente_id = req.user.id;

    try {
        let targetChatId = chat_id;

        if (!chat_id) {
            const [newChat] = await db.query("INSERT INTO chats (cliente_id, loja_id, atualizado_em, tem_nova_msg) VALUES (?, ?, NOW(), TRUE)", 
                [remetente_tipo === "cliente" ? remetente_id : cliente_id, loja_id]);
            targetChatId = newChat.insertId;
        } else {
            await db.query("UPDATE chats SET tem_nova_msg = TRUE, atualizado_em = NOW() WHERE id = ?", [chat_id]);
        }

        const [msgResult] = await db.query("INSERT INTO mensagens (chat_id, remetente_id, remetente_tipo, tipo, mensagem) VALUES (?, ?, ?, ?, ?)", 
            [targetChatId, remetente_id, remetente_tipo, tipo, mensagem]);

        const [chatData] = await db.query("SELECT loja_id FROM chats WHERE id = ?", [targetChatId]);
        const lojaIdReal = chatData[0].loja_id;

        const novaMensagem = { id: msgResult.insertId, chat_id: targetChatId, loja_id: lojaIdReal, mensagem, remetente_tipo, remetente_id, criado_em: new Date().toISOString() };

        const io = getIo();
        if (io) {
            io.to(`chat_${targetChatId}`).emit("nova_mensagem", novaMensagem);
        }

        res.json({ message: "Mensagem enviada", chat_id: targetChatId, id: msgResult.insertId });
    } catch (err) {
        res.status(500).json({ error: "Erro interno ao processar mensagem" });
    }
});
        
// ==========================================================
// ABRIR OU LOCALIZAR CHAT EXISTENTE (BOTÃO "CONVERSAR")
// ==========================================================
router.post("/abrir", authMiddleware, async (req, res) => {
    const { loja_id } = req.body;
    try {
        const [loja] = await db.query("SELECT id FROM stores WHERE id = ? LIMIT 1", [loja_id]);
        if (loja.length === 0) return res.status(404).json({ message: "A loja não existe" });

        const [chat] = await db.query("SELECT id FROM chats WHERE cliente_id = ? AND loja_id = ? LIMIT 1", [req.user.id, loja_id]);
        if (chat.length > 0) return res.json({ chat_id: chat[0].id });

        const [newChat] = await db.query("INSERT INTO chats (cliente_id, loja_id, atualizado_em) VALUES (?, ?, NOW())", [req.user.id, loja_id]);
        res.json({ chat_id: newChat.insertId });
    } catch (err) {
        res.status(500).json({ error: "Erro interno ao processar abertura de chat" });
    }
});



// ==========================================================
// MARCAR CHAT COMO VISUALIZADO (LIMPAR NOTIFICAÇÃO)
// ==========================================================
router.put("/visualizar/:chatId", authMiddleware, checkChatAccess, async (req, res) => {
    try {
        await db.query("UPDATE chats SET tem_nova_msg = FALSE WHERE id = ?", [req.params.chatId]);
        res.json({ message: "Chat visualizado com sucesso" });
    } catch (err) {
        res.status(500).json({ error: "Erro interno ao atualizar status do chat" });
    }
});



module.exports = router;