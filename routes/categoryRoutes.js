const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ==========================================
// LISTAR TODAS AS CATEGORIAS (PÚBLICO)
// ==========================================
router.get('/categories', async (req, res) => {
    const sql = "SELECT * FROM categories ORDER BY nome ASC";

    try {
        // Com o mysql2/promise, usamos await e desestruturamos o resultado
        const [result] = await db.query(sql);
        
        // Retorna o array de categorias ordenado por nome
        res.json(result);
    } catch (err) {
        // Registra o erro real apenas nos logs internos do servidor
        console.error("Erro ao listar categorias:", err);
        // Retorna uma resposta segura e genérica para o cliente externo
        res.status(500).json({ error: "Erro interno ao buscar categorias" });
    }
});

module.exports = router;