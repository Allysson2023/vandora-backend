const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadProdutos = require('../middlewares/uploadProdutos');
const axios = require('axios');
const multer = require('multer');
const upload = multer();

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
router.post("/products", authMiddleware, async (req, res) => {
    const connection = await db.getConnection(); 
    try {
        await connection.beginTransaction(); 

        const erro = validarProduto(req.body);
        if (erro) throw new Error(erro);

        const [storeResult] = await connection.query("SELECT id FROM stores WHERE user_id = ?", [req.user.id]);
        if (storeResult.length === 0) throw new Error("Loja não encontrada");

        // --- ÚNICA EXTRAÇÃO NECESSÁRIA ---
        const { nome, descricao, preco, preco_antigo, estoque, category_id, variantes, destaque, imagem, imagem2, imagem3 } = req.body;
        console.log("DEBUG CATEGORIA:", { category_id, tipo: typeof category_id });

        // --- VALIDAÇÃO AGORA FUNCIONA PORQUE CATEGORY_ID JÁ EXISTE ---
        const [catCheck] = await connection.query("SELECT id FROM categories WHERE id = ?", [parseInt(category_id)]);
        if (catCheck.length === 0) {
            throw new Error("Categoria selecionada inválida.");
        }

        const slug = nome
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9 -]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');

        const [prodResult] = await connection.query(
            `INSERT INTO products (nome, descricao, preco, preco_antigo, estoque, imagem, imagem2, imagem3, category_id, store_id, destaque, slug) 
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [nome, descricao, preco, preco_antigo || null, estoque, imagem || null, imagem2 || null, imagem3 || null, category_id, storeResult[0].id, destaque ? 1 : 0, slug]
        );

        const productId = prodResult.insertId;

        if (variantes && Array.isArray(variantes)) {
            for (let v of variantes) {
                await connection.query(
                    "INSERT INTO product_variants (product_id, nome_variante, preco_adicional, estoque) VALUES (?,?,?,?)",
                    [productId, v.nome_variante, v.preco_adicional || 0, v.estoque || 0]
                );
            }
        }

        await connection.commit(); 
        res.json({ message: "Produto cadastrado com sucesso!", productId });
    } catch (err) {
        await connection.rollback(); 
        console.error("Erro no servidor:", err); // Log para ver o erro real
        res.status(500).json({ message: err.message || "Erro interno no servidor" });
    } finally {
        connection.release(); 
    }
});

router.post("/upload-image", authMiddleware, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Nenhum arquivo" });

        const formData = new FormData();
        formData.append("image", req.file.buffer.toString('base64'));

        const response = await axios.post(
            `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`, 
            formData
        );
        
        res.json({ url: response.data.data.url });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erro ao subir imagem para o ImgBB" });
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

// 2. LISTAR PRODUTOS (COM FILTROS - CORRIGIDO PARA SQL MODE)
router.get("/products", async (req, res) => {
    try {
        // Mudamos 'category_id' para 'categoria' (nome)
        const { categoria, busca, pagina = 1 } = req.query; 
        
        let sql = `SELECT p.*, s.nome AS nomeLoja, c.nome AS nomeCategoria, COUNT(pl.id) AS curtidas 
                   FROM products p 
                   JOIN stores s ON p.store_id = s.id 
                   LEFT JOIN categories c ON p.category_id = c.id
                   LEFT JOIN product_likes pl ON pl.product_id = p.id WHERE 1=1`;
        let values = [];

        // ALTERAÇÃO AQUI: Filtramos pelo NOME da categoria (c.nome)
        if (categoria) { 
            sql += " AND c.nome = ?"; 
            values.push(categoria); 
        }
        
        if (busca) { 
            sql += " AND (p.nome LIKE ? OR c.nome LIKE ? OR s.nome LIKE ?)"; 
            values.push(`%${busca}%`, `%${busca}%`, `%${busca}%`); 
        }

        sql += " GROUP BY p.id, s.nome, c.nome ORDER BY p.id DESC LIMIT ? OFFSET ?";
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
        
        // Adicionamos p.store_id na busca
        const [rows] = await db.query(`
            SELECT p.*, s.nome AS nomeLoja, p.store_id 
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
router.put("/products/:id", authMiddleware, async (req, res) => {
    try {
        // Verifica se o produto existe e pertence ao usuário logado
        const [prod] = await db.query("SELECT s.user_id FROM products p JOIN stores s ON p.store_id = s.id WHERE p.id = ?", [req.params.id]);
        if (!prod.length) return res.status(404).json({ message: "Produto não encontrado" });
        if (prod[0].user_id !== req.user.id) return res.status(403).json({ message: "Sem permissão" });

        const erro = validarProduto(req.body);
        if (erro) return res.status(400).json({ message: erro });
        if (category_id) {
    const [catCheck] = await db.query("SELECT id FROM categories WHERE id = ?", [category_id]);
    if (catCheck.length === 0) {
        return res.status(400).json({ message: "Categoria selecionada inválida." });
    }
}

        // Agora recebemos as URLs das imagens diretamente do req.body
        const { nome, descricao, preco, preco_antigo, estoque, category_id, destaque, imagem, imagem2, imagem3 } = req.body;

        const novaSlug = nome
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9 -]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');

        // Atualização simples: salvamos exatamente o que veio do frontend
        await db.query(`
            UPDATE products SET 
                nome = ?, 
                descricao = ?, 
                preco = ?, 
                preco_antigo = ?, 
                estoque = ?, 
                category_id = ?, 
                destaque = ?, 
                slug = ?, 
                imagem = ?, 
                imagem2 = ?, 
                imagem3 = ? 
            WHERE id = ?`,
            [
                nome, 
                descricao, 
                preco, 
                preco_antigo || null, 
                estoque, 
                category_id || null, 
                destaque ? 1 : 0, 
                novaSlug, 
                imagem, // URL da imagem 1
                imagem2, // URL da imagem 2
                imagem3, // URL da imagem 3
                req.params.id
            ]
        );

        res.json({ message: "Produto atualizado com sucesso!" });
    } catch (err) {
        console.error(err);
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

// Rota para buscar produto pelo slug
router.get('/products/slug/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        
        // Buscando no banco pelo campo slug
        const [product] = await db.execute(
            'SELECT * FROM products WHERE slug = ?', 
            [slug]
        );

        if (product.length === 0) {
            return res.status(404).json({ message: "Produto não encontrado" });
        }

        res.json(product[0]);
    } catch (error) {
        res.status(500).json({ message: "Erro no servidor" });
    }
});


module.exports = router;