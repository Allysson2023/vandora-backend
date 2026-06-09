const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ==========================================
// LISTAR TODAS AS CATEGORIAS (PÚBLICO)
// ==========================================
router.get('/categories', (req, res) => {
    const sql = "SELECT * FROM categories ORDER BY nome ASC";

    db.query(sql, (err, result) => {
        if (err) {
            // Registra o erro real apenas nos logs internos do servidor
            console.error("Erro ao listar categorias:", err);
            // Retorna uma resposta segura e genérica para o cliente externo
            return res.status(500).json({ error: "Erro interno ao buscar categorias" });
        }

        // Retorna o array de categorias ordenado por nome
        res.json(result);
    });
});

module.exports = router;