const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');


router.delete("/cart/clear", authMiddleware, (req, res) => {

    const userId = req.user.id;

    const sql = `
        DELETE cart_items
        FROM cart_items
        JOIN cart ON cart.id = cart_items.cart_id
        WHERE cart.user_id = ?
    `;

    db.query(sql, [userId], (err) => {

        if (err) return res.status(500).json(err);

        res.json({ message: "Carrinho limpo com sucesso!" });

    });

});

router.delete("/cart/delete/:id", authMiddleware, (req,res)=>{

  const userId = req.user.id;
  const productId = req.params.id;

  const sql = `
    DELETE cart_items
    FROM cart_items
    JOIN cart ON cart.id = cart_items.cart_id
    WHERE cart.user_id = ? AND cart_items.product_id = ?
  `;

  db.query(sql, [userId, productId], (err)=>{
    if(err) return res.status(500).json(err);
    res.json({message:"removido"});
  });

});

router.put("/cart/decrease/:id", authMiddleware, (req, res) => {

    const userId = req.user.id;
    const productId = req.params.id;

    const getSql = `
        SELECT cart_items.id, cart_items.quantidade
        FROM cart_items
        JOIN cart ON cart.id = cart_items.cart_id
        WHERE cart.user_id = ? AND cart_items.product_id = ?
    `;

    db.query(getSql, [userId, productId], (err, result) => {

        if (err) return res.status(500).json(err);

        if (result.length === 0) {
            return res.status(404).json({ message: "Item não encontrado" });
        }

        const item = result[0];

        // 🔥 SE FOR 1, REMOVE
        if (item.quantidade <= 1) {

            const deleteSql = `
                DELETE cart_items
                FROM cart_items
                JOIN cart ON cart.id = cart_items.cart_id
                WHERE cart.user_id = ? AND cart_items.product_id = ?
            `;

            db.query(deleteSql, [userId, productId], (err) => {
                if (err) return res.status(500).json(err);

                return res.json({ message: "Item removido" });
            });

        } else {

            // ➖ SE FOR MAIOR QUE 1, DIMINUI
            const updateSql = `
                UPDATE cart_items
                JOIN cart ON cart.id = cart_items.cart_id
                SET quantidade = quantidade - 1
                WHERE cart.user_id = ? AND cart_items.product_id = ?
            `;

            db.query(updateSql, [userId, productId], (err) => {
                if (err) return res.status(500).json(err);

                return res.json({ message: "Quantidade atualizada" });
            });
        }
    });
});

router.put("/cart/increase/:id", authMiddleware, (req, res) => {

    const userId = req.user.id;
    const productId = req.params.id;

    // Busca item do carrinho + estoque do produto
    const sql = `
        SELECT 
            cart_items.quantidade,
            products.estoque,
            products.nome
        FROM cart_items
        JOIN cart ON cart.id = cart_items.cart_id
        JOIN products ON products.id = cart_items.product_id
        WHERE cart.user_id = ? 
        AND cart_items.product_id = ?
    `;

    db.query(sql, [userId, productId], (err, result) => {

        if (err) return res.status(500).json(err);

        if (result.length === 0) {
            return res.status(404).json({
                message: "Produto não encontrado no carrinho"
            });
        }

        const item = result[0];

        const quantidadeAtual = item.quantidade;
        const estoque = item.estoque;
        const nomeProduto = item.nome;

        // 🔥 Produto indisponível
        if (estoque <= 0) {
            return res.status(400).json({
                message: `${nomeProduto} está indisponível no momento`
            });
        }

        // 🔥 Limite atingido
        if (quantidadeAtual >= estoque) {

            return res.status(400).json({
                message:
                    `Quantidade indisponível. Existem apenas ${estoque} unidades disponíveis. Fale com a loja para saber quando haverá reposição.`
            });
        }

        // ✅ Pode aumentar
        const updateSql = `
            UPDATE cart_items 
            JOIN cart ON cart.id = cart_items.cart_id
            SET quantidade = quantidade + 1
            WHERE cart.user_id = ? 
            AND cart_items.product_id = ?
        `;

        db.query(updateSql, [userId, productId], (err) => {

            if (err) return res.status(500).json(err);

            res.json({
                message: "Quantidade aumentada!"
            });
        });

    });

});

router.post('/cart', authMiddleware, (req, res) => {

    const userId = req.user.id;
    const { product_id, quantidade } = req.body;

    // 1. buscar carrinho do usuário
    db.query("SELECT * FROM cart WHERE user_id = ?", [userId], (err, cartResult) => {

        if (err) return res.status(500).json(err);

        const processCart = (cartId) => {

            // 2. pegar loja do produto novo
            db.query(
                "SELECT store_id, estoque, nome FROM products WHERE id = ?",
                [product_id],
                (err, productResult) => {

                    if (err) return res.status(500).json(err);

                    if (productResult.length === 0) {
                        return res.status(404).json({
                            message: "Produto não encontrado"
                        });
                    }

                    const lojaNova = productResult[0].store_id;
                    const estoque = productResult[0].estoque;
                    const nomeProduto = productResult[0].nome;

                    // 3. pegar loja atual do carrinho
                    const sqlLojaAtual = `
                        SELECT products.store_id
                        FROM cart_items
                        JOIN cart ON cart.id = cart_items.cart_id
                        JOIN products ON products.id = cart_items.product_id
                        WHERE cart.user_id = ?
                        LIMIT 1
                    `;

                    db.query(sqlLojaAtual, [userId], (err, lojaResult) => {

                        if (err) return res.status(500).json(err);

                        const lojaAtual = lojaResult[0]?.store_id;

                        // 🚨 BLOQUEIO DE LOJA DIFERENTE
                        if (lojaAtual && lojaAtual !== lojaNova) {
                            return res.status(400).json({
                                message: "Você só pode adicionar produtos de uma loja por vez no carrinho"
                            });
                        }

                        // 4. continuar fluxo normal

                        const checkSql = `
                            SELECT * FROM cart_items 
                            WHERE cart_id = ? AND product_id = ?
                        `;

                        db.query(checkSql, [cartId, product_id], (err, result) => {

                            if (err) return res.status(500).json(err);

                            if (result.length > 0) {

                                const quantidadeAtual = result[0].quantidade;

                                // 🚨 ESTOQUE
                                if ((quantidadeAtual + quantidade) > estoque) {
                                    return res.status(400).json({
                                        message: `Quantidade indisponível. Existem apenas ${estoque} unidades de ${nomeProduto}`
                                    });
                                }

                                // ✔ atualizar quantidade
                                const updateSql = `
                                    UPDATE cart_items 
                                    SET quantidade = quantidade + ?
                                    WHERE cart_id = ? AND product_id = ?
                                `;

                                db.query(
                                    updateSql,
                                    [quantidade, cartId, product_id],
                                    (err) => {

                                        if (err) return res.status(500).json(err);

                                        return res.json({
                                            message: "Quantidade atualizada!"
                                        });
                                    }
                                );

                            } else {

                                // ✔ inserir novo item
                                const insertSql = `
                                    INSERT INTO cart_items (cart_id, product_id, quantidade)
                                    VALUES (?, ?, ?)
                                `;

                                db.query(
                                    insertSql,
                                    [cartId, product_id, quantidade],
                                    (err) => {

                                        if (err) return res.status(500).json(err);

                                        return res.json({
                                            message: "Produto adicionado!"
                                        });
                                    }
                                );
                            }
                        });

                    });

                }
            );
        };

        // se não tem carrinho, cria
        if (cartResult.length === 0) {

            db.query(
                "INSERT INTO cart (user_id) VALUES (?)",
                [userId],
                (err, result) => {

                    if (err) return res.status(500).json(err);

                    processCart(result.insertId);
                }
            );

        } else {

            processCart(cartResult[0].id);
        }

    });
});

router.get('/cart', authMiddleware, (req, res) =>{
    const userId = req.user.id;

    const sql = `
    SELECT 
    cart_items.product_id,
    products.nome,
    products.preco,
    products.imagem,
    cart_items.quantidade,
    products.estoque,
    products.store_id
FROM cart_items
JOIN cart ON cart.id = cart_items.cart_id
JOIN products ON products.id = cart_items.product_id
WHERE cart.user_id = ?
`;
    
    db.query(sql, [userId], (err, result) => {
        if (err) return res.status(500).json(err);

        res.json(result);
    });
});

module.exports = router;