const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const axios = require('axios');

const NodeGeocoder = require('node-geocoder');

const geocoder = NodeGeocoder({ 
    provider: 'openstreetmap',
    httpAdapter: 'fetch',
    headers: {
        // Use apenas letras, números, hífen e um e-mail válido (sem o http://)
        'User-Agent': 'MeuAppDelivery-1.0 (allyssoncarlos.ac21@gmail.com)' 
    }
});

function calcularDistancia(coord1, coord2) {
    if (!coord1 || !coord2) return 0;
    const R = 6371; 
    const dLat = (coord2.latitude - coord1.latitude) * (Math.PI / 180);
    const dLon = (coord2.longitude - coord1.longitude) * (Math.PI / 180);
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(coord1.latitude * (Math.PI / 180)) * Math.cos(coord2.latitude * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

router.delete("/cart/clear", authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const sql = `DELETE cart_items FROM cart_items JOIN cart ON cart.id = cart_items.cart_id WHERE cart.user_id = ?`;
    try {
        await db.query(sql, [userId]);
        res.json({ message: "Carrinho limpo com sucesso!" });
    } catch (err) {
        console.error("Erro ao limpar carrinho:", err);
        res.status(500).json({ error: "Erro interno ao limpar o carrinho" });
    }
});

router.delete("/cart/delete/:id", authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const productId = Number(req.params.id);
    const sql = `DELETE cart_items FROM cart_items JOIN cart ON cart.id = cart_items.cart_id WHERE cart.user_id = ? AND cart_items.product_id = ?`;
    try {
        const [result] = await db.query(sql, [userId, productId]);
        if (result.affectedRows === 0) return res.status(404).json({ message: "Produto não encontrado no carrinho" });
        res.json({ message: "Removido" });
    } catch (err) {
        console.error("Erro ao remover item:", err);
        res.status(500).json({ error: "Erro interno ao remover item" });
    }
});


router.put("/cart/decrease/:id", authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const productId = Number(req.params.id);
    try {
        const [items] = await db.query("SELECT cart_items.id, quantidade FROM cart_items JOIN cart ON cart.id = cart_items.cart_id WHERE cart.user_id = ? AND cart_items.product_id = ?", [userId, productId]);
        
        if (items.length === 0) return res.status(404).json({ message: "Item não encontrado" });

        if (items[0].quantidade <= 1) {
            await db.query("DELETE cart_items FROM cart_items JOIN cart ON cart.id = cart_items.cart_id WHERE cart.user_id = ? AND cart_items.product_id = ?", [userId, productId]);
            res.json({ message: "Item removido" });
        } else {
            await db.query("UPDATE cart_items JOIN cart ON cart.id = cart_items.cart_id SET quantidade = quantidade - 1 WHERE cart.user_id = ? AND cart_items.product_id = ?", [userId, productId]);
            res.json({ message: "Quantidade diminuída!" });
        }
    } catch (err) {
        console.error("Erro ao processar diminuição:", err);
        res.status(500).json({ error: "Erro interno ao atualizar" });
    }
});

router.put("/cart/increase/:id", authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const productId = Number(req.params.id);
    try {
        const [result] = await db.query(`SELECT ci.quantidade, p.estoque, p.nome FROM cart_items ci JOIN cart c ON c.id = ci.cart_id JOIN products p ON p.id = ci.product_id WHERE c.user_id = ? AND ci.product_id = ?`, [userId, productId]);
        
        if (result.length === 0) return res.status(404).json({ message: "Produto não encontrado" });
        if (result[0].quantidade >= result[0].estoque) return res.status(400).json({ message: "Estoque insuficiente" });

        await db.query("UPDATE cart_items JOIN cart ON cart.id = cart_items.cart_id SET quantidade = quantidade + 1 WHERE cart.user_id = ? AND cart_items.product_id = ?", [userId, productId]);
        res.json({ message: "Quantidade aumentada!" });
    } catch (err) {
        res.status(500).json({ error: "Erro interno ao aumentar" });
    }
});
// ==========================================
// AUMENTAR QUANTIDADE DE UM ITEM (+1)
// ==========================================
router.post('/cart', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const { product_id, quantidade } = req.body;

    if (!Number.isInteger(product_id) || product_id <= 0 || !Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 50) {
        return res.status(400).json({ message: "Dados inválidos" });
    }

    try {
        // 1. Busca ou cria o carrinho
        let [cartRows] = await db.query("SELECT id FROM cart WHERE user_id = ?", [userId]);
        let cartId;

        if (cartRows.length === 0) {
            const [result] = await db.query("INSERT INTO cart (user_id) VALUES (?)", [userId]);
            cartId = result.insertId;
        } else {
            cartId = cartRows[0].id;
        }

        // 2. Busca dados do produto
        const [products] = await db.query("SELECT store_id, estoque, nome FROM products WHERE id = ?", [product_id]);
        if (products.length === 0) return res.status(404).json({ message: "Produto não encontrado" });
        
        const { store_id: lojaNova, estoque, nome: nomeProduto } = products[0];

        // 3. Valida se é a mesma loja
        const [lojaAtualResult] = await db.query(`
            SELECT products.store_id FROM cart_items 
            JOIN products ON products.id = cart_items.product_id 
            WHERE cart_id = ? LIMIT 1`, [cartId]);
        
        if (lojaAtualResult.length > 0 && lojaAtualResult[0].store_id !== lojaNova) {
            return res.status(400).json({ message: "Você só pode adicionar produtos de uma loja por vez" });
        }

        // 4. Verifica item no carrinho e atualiza ou insere
        const [existing] = await db.query("SELECT quantidade FROM cart_items WHERE cart_id = ? AND product_id = ?", [cartId, product_id]);

        if (existing.length > 0) {
            if (existing[0].quantidade + quantidade > estoque) {
                return res.status(400).json({ message: `Estoque insuficiente de ${nomeProduto}` });
            }
            await db.query("UPDATE cart_items SET quantidade = quantidade + ? WHERE cart_id = ? AND product_id = ?", [quantidade, cartId, product_id]);
            res.json({ message: "Quantidade atualizada!" });
        } else {
            if (quantidade > estoque) return res.status(400).json({ message: "Estoque insuficiente" });
            await db.query("INSERT INTO cart_items (cart_id, product_id, quantidade) VALUES (?, ?, ?)", [cartId, product_id, quantidade]);
            res.json({ message: "Produto adicionado!" });
        }

    } catch (err) {
        console.error("Erro no processamento do carrinho:", err);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
});


// ==========================================
// VER ITENS DO CARRINHO DO USUÁRIO LOGADO
// ==========================================
router.get('/cart', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    // Adicione p.store_id nesta lista de campos selecionados
    const sql = `
        SELECT 
            ci.product_id, 
            p.nome, 
            p.preco, 
            p.imagem, 
            ci.quantidade, 
            p.estoque, 
            s.taxa_entrega, 
            p.store_id 
        FROM cart_items ci 
        JOIN cart c ON c.id = ci.cart_id 
        JOIN products p ON p.id = ci.product_id 
        JOIN stores s ON p.store_id = s.id 
        WHERE c.user_id = ?
    `;
    try {
        const [rows] = await db.query(sql, [userId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Erro ao carregar carrinho" });
    }
});router.get('/cart', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const sql = `SELECT ci.product_id, p.nome, p.preco, p.imagem, ci.quantidade, p.estoque, s.taxa_entrega FROM cart_items ci JOIN cart c ON c.id = ci.cart_id JOIN products p ON p.id = ci.product_id JOIN stores s ON p.store_id = s.id WHERE c.user_id = ?`;
    try {
        const [rows] = await db.query(sql, [userId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Erro ao carregar carrinho" });
    }
});


router.post('/calcular-frete', async (req, res) => {
    // CEP da loja fixo (o seu)
    const cepLoja = "60349040"; 
    const { cepCliente } = req.body;
    
    if (!cepCliente) return res.status(400).json({ message: "CEP é obrigatório" });

    // Pega os 3 primeiros dígitos para identificar a região/bairro
    const prefixoLoja = cepLoja.substring(0, 5); 
    const prefixoCliente = cepCliente.replace('-', '').substring(0, 5);

    try {
        let taxa = 0;

        // Lógica simples:
        if (prefixoLoja === prefixoCliente) {
            // Mesmo CEP/Bairro
            taxa = 10.00;
        } else {
            // Vizinho ou outro lugar
            taxa = 25.00;
        }

        res.json({ taxa: taxa, tipo: "Entrega Local" });
    } catch (err) {
        res.status(500).json({ message: "Erro ao calcular" });
    }
});


module.exports = router;