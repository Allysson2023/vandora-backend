const express = require('express');
const router = express.Router();
const db = require('../config/db');

// 1. ROTA PARA CADASTRO DE LOJAS (Apenas os Departamentos Principais)
router.get('/principais', async (req, res) => {
    try {
        const [principais] = await db.query("SELECT * FROM categorias_principais ORDER BY nome ASC");
        res.json(principais);
    } catch (err) {
        console.error("Erro ao buscar departamentos:", err);
        res.status(500).json({ error: "Erro ao buscar departamentos" });
    }
});

// 2. ROTA PARA CADASTRO DE PRODUTOS (Estrutura Completa/Árvore)
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