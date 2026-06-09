const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");

// ==========================================
// LISTAR NOTIFICAÇÕES DO USUÁRIO LOGADO
// ==========================================
router.get("/notifications", authMiddleware, (req, res) => {
    const userId = req.user.id;

    const sql = `
        SELECT *
        FROM notifications
        WHERE user_id = ?
        ORDER BY id DESC
    `;

    db.query(sql, [userId], (err, result) => {
        if (err) {
            // Registra o erro internamente para o desenvolvedor ver
            console.error("Erro ao buscar notificações:", err);
            // Resposta genérica e segura para o cliente/hacker
            return res.status(500).json({ error: "Erro interno ao buscar notificações" });
        }

        res.json(result);
    });
});

module.exports = router;