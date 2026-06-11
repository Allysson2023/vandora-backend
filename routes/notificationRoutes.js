const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");

// ==========================================
// LISTAR NOTIFICAÇÕES DO USUÁRIO LOGADO
// ==========================================
router.get("/notifications", authMiddleware, async (req, res) => {
    const userId = req.user.id;

    const sql = `
        SELECT *
        FROM notifications
        WHERE user_id = ?
        ORDER BY id DESC
    `;

    try {
        // Usamos await para esperar a query e desestruturamos o resultado
        const [result] = await db.query(sql, [userId]);
        
        // Retorna o resultado obtido
        res.json(result);
    } catch (err) {
        // Registra o erro internamente para o desenvolvedor
        console.error("Erro ao buscar notificações:", err);
        // Resposta genérica e segura para o cliente
        res.status(500).json({ error: "Erro interno ao buscar notificações" });
    }
});

module.exports = router;