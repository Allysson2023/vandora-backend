const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadProdutos = require('../middlewares/uploadProdutos');

// Helper para validar campos (reutilizável)
const validarProduto = (data) => {
    const { nome, descricao, preco, estoque } = data;
    if (!nome || nome.trim().length < 3) return "Nome deve possuir pelo menos 3 caracteres";
    if (!descricao || descricao.trim().length < 1) return "Descrição muito curta";
    if (Number(preco) <= 0) return "Preço inválido";
    if (Number(estoque) < 0) return "Estoque inválido";
    return null;
};

// 1. CADASTRAR PRODUTO (Versão Profissional com Transação)
router.post("/products", authMiddleware, uploadProdutos.fields([{ name: "imagem", maxCount: 1 }, { name: "imagem2", maxCount: 1 }, { name: "imagem3", maxCount: 1 }]), async (req, res) => {
    const connection = await db.getConnection(); // Pegamos uma conexão exclusiva
    try {
        await connection.beginTransaction(); // Inicia a segurança

        const erro = validarProduto(req.body);
        if (erro) throw new Error(erro);

        const [storeResult] = await connection.query("SELECT id FROM stores WHERE user_id = ?", [req.user.id]);
        if (storeResult.length === 0) throw new Error("Loja não encontrada");

        const { nome, descricao, preco, preco_antigo, estoque, category_id, variantes, specs } = req.body;
        const img1 = req.files?.imagem?.[0]?.filename || null;
        const img2 = req.files?.imagem2?.[0]?.filename || null;
        const img3 = req.files?.imagem3?.[0]?.filename || null;

        // Inserir Produto
        const [prodResult] = await connection.query(
            `INSERT INTO products (nome, descricao, preco, preco_antigo, estoque, imagem, imagem2, imagem3, category_id, store_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [nome, descricao, preco, preco_antigo || null, estoque, img1, img2, img3, category_id, storeResult[0].id]
        );

        const productId = prodResult.insertId;

        // Se houver variantes (Array enviado pelo Front), salva elas
        if (variantes && Array.isArray(variantes)) {
            for (let v of variantes) {
                await connection.query(
                    "INSERT INTO product_variants (product_id, nome_variante, preco_adicional, estoque) VALUES (?,?,?,?)",
                    [productId, v.nome_variante, v.preco_adicional || 0, v.estoque || 0]
                );
            }
        }

        await connection.commit(); // Tudo certo! Confirma a gravação
        res.json({ message: "Produto cadastrado com sucesso!", productId });
    } catch (err) {
        await connection.rollback(); // Deu erro? Desfaz TUDO o que foi feito nesta tentativa
        console.error(err);
        res.status(500).json({ message: err.message || "Erro interno no servidor" });
    } finally {
        connection.release(); // Libera a conexão de volta para o pool
    }
});


// BUSCAR PRODUTOS DE UMA LOJA ESPECÍFICA
router.get("/stores/:id/products", async (req, res) => {
    try {
        const { id } = req.params; // ID da loja
        const { pagina = 1 } = req.query;
        const offset = (parseInt(pagina) - 1) * 30;

        const [products] = await db.query(
            `SELECT * FROM products WHERE store_id = ? ORDER BY id DESC LIMIT 30 OFFSET ?`,
            [id, offset]
        );
        res.json(products);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro ao buscar produtos da loja" });
    }
});

// 2. LISTAR PRODUTOS (COM FILTROS)
router.get("/products", async (req, res) => {
    try {
        const { category_id, busca, pagina = 1 } = req.query;
        // Adicionamos o JOIN com categories para filtrar pelo nome
        let sql = `SELECT p.*, s.nome AS nomeLoja, c.nome AS nomeCategoria, COUNT(pl.id) AS curtidas 
                   FROM products p 
                   JOIN stores s ON p.store_id = s.id 
                   LEFT JOIN categories c ON p.category_id = c.id
                   LEFT JOIN product_likes pl ON pl.product_id = p.id WHERE 1=1`;
        let values = [];

        if (category_id) { sql += " AND p.category_id = ?"; values.push(category_id); }
        if (busca) { 
            // Agora a busca olha para o nome do produto, o nome da categoria e o nome da loja
            sql += " AND (p.nome LIKE ? OR c.nome LIKE ? OR s.nome LIKE ?)"; 
            values.push(`%${busca}%`, `%${busca}%`, `%${busca}%`); 
        }

        sql += " GROUP BY p.id ORDER BY p.id DESC LIMIT ? OFFSET ?";
        values.push(30, (parseInt(pagina) - 1) * 30);

        const [result] = await db.query(sql, values);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro ao buscar produtos" });
    }
});

// NOVA ROTA: BUSCAR CATEGORIAS (Para o seu Frontend preencher os menus)
router.get("/categories", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM categories ORDER BY nome ASC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: "Erro ao buscar categorias" });
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

        const { nome, descricao, preco, preco_antigo, estoque, category_id } = req.body;
        const img1 = req.files?.imagem?.[0]?.filename;
        const img2 = req.files?.imagem2?.[0]?.filename;
        const img3 = req.files?.imagem3?.[0]?.filename;

        await db.query(`UPDATE products SET nome=?, descricao=?, preco=?, preco_antigo=?, estoque=?, category_id=?, 
                        imagem=COALESCE(?, imagem), imagem2=COALESCE(?, imagem2), imagem3=COALESCE(?, imagem3) WHERE id=?`,
            [nome, descricao, preco, preco_antigo || null, estoque, category_id || null, img1 || null, img2 || null, img3 || null, req.params.id]);

        res.json({ message: "Produto atualizado com sucesso!" });
    } catch (err) {
        res.status(500).json({ message: "Erro ao atualizar produto" });
    }
});

// ROTA DELETE
router.delete("/products/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        // Verifica se o produto pertence ao dono da loja antes de deletar
        const [prod] = await db.query("SELECT s.user_id FROM products p JOIN stores s ON p.store_id = s.id WHERE p.id = ?", [id]);
        
        if (prod.length === 0) return res.status(404).json({ message: "Produto não encontrado" });
        if (prod[0].user_id !== req.user.id) return res.status(403).json({ message: "Sem permissão" });

        await db.query("DELETE FROM products WHERE id = ?", [id]);
        res.json({ message: "Produto excluído com sucesso!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro ao excluir produto" });
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