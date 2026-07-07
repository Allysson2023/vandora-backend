const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ==========================================
// LISTAR TODAS AS CATEGORIAS (PÚBLICO)
// ==========================================
router.get('/categories', async (req, res) => {
    try {
        const [principais] = await db.query("SELECT * FROM categorias_principais ORDER BY nome ASC");

        const [subcategorias] = await db.query("SELECT * FROM categories ORDER BY nome ASC");

        const estrutura = principais.map(pai => {
            return {
                ...pai,
                subcategorias: subcategorias.filter(filho => filho.pai_id === pai.id)
            };
        });

        res.json(estrutura);
    } catch (err) {
        console.error("Erro ao estruturar categorias:", err);
        res.status(500).json({ error: "Erro ao buscar estrutura de categorias" });
    }
});

module.exports = router;