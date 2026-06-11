const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadProdutos = require('../middlewares/uploadProdutos');

// Helper para validar campos (reutilizável)
const validarProduto = (data) => {
    const { nome, descricao, preco, estoque } = data;
    if (!nome || nome.trim().length < 3) return "Nome deve possuir pelo menos 3 caracteres";
    if (!descricao || descricao.trim().length < 10) return "Descrição muito curta";
    if (Number(preco) <= 0) return "Preço inválido";
    if (Number(estoque) < 0) return "Estoque inválido";
    return null;
};

// 1. CADASTRAR PRODUTO
router.post("/products", authMiddleware, uploadProdutos.fields([{ name: "imagem", maxCount: 1 }, { name: "imagem2", maxCount: 1 }, { name: "imagem3", maxCount: 1 }]), async (req, res) => {
    try {
        const erro = validarProduto(req.body);
        if (erro) return res.status(400).json({ message: erro });

        const [storeResult] = await db.query("SELECT id FROM stores WHERE user_id = ?", [req.user.id]);
        if (storeResult.length === 0) return res.status(404).json({ message: "Loja não encontrada" });

        const { nome, descricao, preco, preco_antigo, estoque, categoria } = req.body;
        const img1 = req.files?.imagem?.[0]?.filename || null;
        const img2 = req.files?.imagem2?.[0]?.filename || null;
        const img3 = req.files?.imagem3?.[0]?.filename || null;

        await db.query(`INSERT INTO products (nome, descricao, preco, preco_antigo, estoque, imagem, imagem2, imagem3, categoria, store_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [nome, descricao, preco, preco_antigo, estoque, img1, img2, img3, categoria, storeResult[0].id]);

        res.json({ message: "Produto cadastrado!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno no servidor" });
    }
});

// 2. LISTAR PRODUTOS (COM FILTROS)
router.get("/products", async (req, res) => {
    try {
        const { categoria, busca, pagina = 1 } = req.query;
        let sql = `SELECT p.*, s.nome AS nomeLoja, COUNT(pl.id) AS curtidas FROM products p 
                   JOIN stores s ON p.store_id = s.id 
                   LEFT JOIN product_likes pl ON pl.product_id = p.id WHERE 1=1`;
        let values = [];

        if (categoria) { sql += " AND p.categoria = ?"; values.push(categoria); }
        if (busca) { sql += " AND (p.nome LIKE ? OR p.categoria LIKE ? OR s.nome LIKE ?)"; values.push(`%${busca}%`, `%${busca}%`, `%${busca}%`); }

        sql += " GROUP BY p.id ORDER BY p.id DESC LIMIT ? OFFSET ?";
        values.push(30, (parseInt(pagina) - 1) * 30);

        const [result] = await db.query(sql, values);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: "Erro ao buscar produtos" });
    }
});

// BUSCAR DETALHES DE UM PRODUTO PELO ID
router.get("/products/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        // Buscamos o produto e também o nome da loja associada
        const [rows] = await db.query(`
            SELECT p.*, s.nome AS nomeLoja 
            FROM products p 
            JOIN stores s ON p.store_id = s.id 
            WHERE p.id = ?`, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: "Produto não encontrado" });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro ao buscar detalhes do produto" });
    }
});

// 3. ATUALIZAR PRODUTO
router.put("/products/:id", authMiddleware, uploadProdutos.fields([{ name: "imagem", maxCount: 1 }, { name: "imagem2", maxCount: 1 }, { name: "imagem3", maxCount: 1 }]), async (req, res) => {
    try {
        const [prod] = await db.query("SELECT s.user_id FROM products p JOIN stores s ON p.store_id = s.id WHERE p.id = ?", [req.params.id]);
        if (!prod.length) return res.status(404).json({ message: "Produto não encontrado" });
        if (prod[0].user_id !== req.user.id) return res.status(403).json({ message: "Sem permissão" });

        const erro = validarProduto(req.body);
        if (erro) return res.status(400).json({ message: erro });

        const { nome, descricao, preco, preco_antigo, estoque, categoria } = req.body;
        const img1 = req.files?.imagem?.[0]?.filename;
        const img2 = req.files?.imagem2?.[0]?.filename;
        const img3 = req.files?.imagem3?.[0]?.filename;

        await db.query(`UPDATE products SET nome=?, descricao=?, preco=?, preco_antigo=?, estoque=?, categoria=?, 
                        imagem=COALESCE(?, imagem), imagem2=COALESCE(?, imagem2), imagem3=COALESCE(?, imagem3) WHERE id=?`,
            [nome, descricao, preco, preco_antigo || null, estoque, categoria || null, img1 || null, img2 || null, img3 || null, req.params.id]);

        res.json({ message: "Produto atualizado com sucesso!" });
    } catch (err) {
        res.status(500).json({ message: "Erro ao atualizar produto" });
    }
});

// 4. CURTIDAS (Exemplo de simplificação)
router.post("/products/:id/like", authMiddleware, async (req, res) => {
    try {
        await db.query("INSERT INTO product_likes (user_id, product_id) VALUES (?, ?)", [req.user.id, req.params.id]);
        res.json({ message: "Produto curtido!" });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ message: "Você já curtiu este produto" });
        res.status(500).json({ message: "Erro interno" });
    }
});

router.delete('/products/:id/like', authMiddleware, async (req, res) => {
    try {
        await db.query("DELETE FROM product_likes WHERE user_id = ? AND product_id = ?", [req.user.id, req.params.id]);
        res.json({ message: "Like removido!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// =========================
// ROTA: TOTAL DE CURTIDAS
// =========================
router.get('/products/:id/likes', async (req, res) => {
    try {
        const [result] = await db.query("SELECT COUNT(*) AS total FROM product_likes WHERE product_id = ?", [req.params.id]);
        res.json({ total: result[0].total });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// =========================
// ROTA: VERIFICAR SE JÁ CURTIU
// =========================
router.get('/products/:id/liked', authMiddleware, async (req, res) => {
    try {
        const [result] = await db.query("SELECT id FROM product_likes WHERE user_id = ? AND product_id = ?", [req.user.id, req.params.id]);
        res.json({ liked: result.length > 0 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});


module.exports = router;