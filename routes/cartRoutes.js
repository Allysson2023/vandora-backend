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

router.delete("/cart/clear", authMiddleware, (req, res) => {
    const userId = req.user.id;

    const sql = `
        DELETE cart_items
        FROM cart_items
        JOIN cart ON cart.id = cart_items.cart_id
        WHERE cart.user_id = ?
    `;

    db.query(sql, [userId], (err) => {
        if (err) {
            console.error("Erro ao limpar carrinho:", err);
            return res.status(500).json({ error: "Erro interno ao limpar o carrinho" });
        }
        res.json({ message: "Carrinho limpo com sucesso!" });
    });
});

router.delete("/cart/delete/:id", authMiddleware, (req, res) => {
    const userId = req.user.id;
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ message: "ID inválido" });
    }

    const sql = `
        DELETE cart_items
        FROM cart_items
        JOIN cart ON cart.id = cart_items.cart_id
        WHERE cart.user_id = ? AND cart_items.product_id = ?
    `;

    db.query(sql, [userId, productId], (err, result) => {
        if (err) {
            console.error("Erro ao remover item do carrinho:", err);
            return res.status(500).json({ error: "Erro interno ao remover item" });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Produto não encontrado no carrinho" });
        }

        res.json({ message: "Removido" });
    });
});

router.put("/cart/decrease/:id", authMiddleware, (req, res) => {
    const userId = req.user.id;
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ message: "ID inválido" });
    }

    const getSql = `
        SELECT cart_items.id, cart_items.quantidade
        FROM cart_items
        JOIN cart ON cart.id = cart_items.cart_id
        WHERE cart.user_id = ? AND cart_items.product_id = ?
    `;

    db.query(getSql, [userId, productId], (err, result) => {
        if (err) {
            console.error("Erro ao buscar item para diminuir:", err);
            return res.status(500).json({ error: "Erro interno ao processar alteração" });
        }

        if (result.length === 0) {
            return res.status(404).json({ message: "Item não encontrado" });
        }

        const item = result[0];

        if (item.quantidade <= 1) {
            const deleteSql = `
                DELETE cart_items
                FROM cart_items
                JOIN cart ON cart.id = cart_items.cart_id
                WHERE cart.user_id = ? AND cart_items.product_id = ?
            `;

            db.query(deleteSql, [userId, productId], (err) => {
                if (err) {
                    console.error("Erro ao deletar item com quantidade zerada:", err);
                    return res.status(500).json({ error: "Erro interno ao remover item" });
                }
                return res.json({ message: "Item removido" });
            });
        } else {
            const updateSql = `
                UPDATE cart_items
                JOIN cart ON cart.id = cart_items.cart_id
                SET quantidade = quantidade - 1
                WHERE cart.user_id = ? AND cart_items.product_id = ?
            `;

            db.query(updateSql, [userId, productId], (err, result) => {
                if (err) {
                    console.error("Erro ao diminuir quantidade:", err);
                    return res.status(500).json({ error: "Erro interno ao atualizar quantidade" });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({ message: "Produto não encontrado" });
                }

                // CORRIGIDO: Mensagem correta para o front-end
                res.json({ message: "Quantidade diminuída!" });
            });
        }
    });
});

// ==========================================
// AUMENTAR QUANTIDADE DE UM ITEM (+1)
// ==========================================
router.put("/cart/increase/:id", authMiddleware, (req, res) => {
    const userId = req.user.id;
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ message: "ID inválido" });
    }

    const sql = `
        SELECT 
            cart_items.quantidade,
            products.estoque,
            products.nome
        FROM cart_items
        JOIN cart ON cart.id = cart_items.cart_id
        JOIN products ON products.id = cart_items.product_id
        WHERE cart.user_id = ? AND cart_items.product_id = ?
    `;

    db.query(sql, [userId, productId], (err, result) => {
        if (err) {
            console.error("Erro ao verificar estoque para aumento:", err);
            return res.status(500).json({ error: "Erro interno ao processar aumento" });
        }

        if (result.length === 0) {
            return res.status(404).json({ message: "Produto não encontrado no carrinho" });
        }

        const item = result[0];
        if (item.estoque <= 0) {
            return res.status(400).json({ message: `${item.nome} está indisponível no momento` });
        }

        if (item.quantidade >= item.estoque) {
            return res.status(400).json({
                message: `Quantidade indisponível. Existem apenas ${item.estoque} unidades disponíveis. Fale com a loja para saber quando haverá reposição.`
            });
        }

        const updateSql = `
            UPDATE cart_items 
            JOIN cart ON cart.id = cart_items.cart_id
            SET quantidade = quantidade + 1
            WHERE cart.user_id = ? AND cart_items.product_id = ?
        `;

        db.query(updateSql, [userId, productId], (err) => {
            if (err) {
                console.error("Erro ao executar aumento de item:", err);
                return res.status(500).json({ error: "Erro interno ao atualizar quantidade" });
            }
            res.json({ message: "Quantidade aumentada!" });
        });
    });
});

// ==========================================
// ADICIONAR ITEM AO CARRINHO (OU SOMAR QUANTIDADE)
// ==========================================
router.post('/cart', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const product_id = Number(req.body.product_id);
    const quantidade = Number(req.body.quantidade);

    if (!Number.isInteger(product_id) || product_id <= 0) {
        return res.status(400).json({ message: "ID do produto inválido" });
    }

    if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 50) {
        return res.status(400).json({ message: "Quantidade inválida" });
    }

    db.query("SELECT * FROM cart WHERE user_id = ?", [userId], (err, cartResult) => {
        if (err) {
            console.error("Erro ao buscar carrinho:", err);
            return res.status(500).json({ error: "Erro interno ao processar carrinho" });
        }

        const processCart = (cartId) => {
            db.query("SELECT store_id, estoque, nome FROM products WHERE id = ?", [product_id], (err, productResult) => {
                if (err) {
                    console.error("Erro ao buscar produto para o carrinho:", err);
                    return res.status(500).json({ error: "Erro interno ao processar produto" });
                }

                if (productResult.length === 0) {
                    return res.status(404).json({ message: "Produto não encontrado" });
                }

                const { store_id: lojaNova, estoque, nome: nomeProduto } = productResult[0];

                const sqlLojaAtual = `
                    SELECT products.store_id
                    FROM cart_items
                    JOIN cart ON cart.id = cart_items.cart_id
                    JOIN products ON products.id = cart_items.product_id
                    WHERE cart.user_id = ? LIMIT 1
                `;

                db.query(sqlLojaAtual, [userId], (err, lojaResult) => {
                    if (err) {
                        console.error("Erro ao validar loja atual do carrinho:", err);
                        return res.status(500).json({ error: "Erro interno de validação" });
                    }

                    const lojaAtual = lojaResult[0]?.store_id;

                    if (lojaAtual && lojaAtual !== lojaNova) {
                        return res.status(400).json({
                            message: "Você só pode adicionar produtos de uma loja por vez no carrinho"
                        });
                    }

                    const checkSql = "SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?";
                    db.query(checkSql, [cartId, product_id], (err, result) => {
                        if (err) {
                            console.error("Erro ao verificar duplicidade no carrinho:", err);
                            return res.status(500).json({ error: "Erro interno ao verificar itens" });
                        }

                        if (result.length > 0) {
                            const quantidadeAtual = result[0].quantidade;

                            if ((quantidadeAtual + quantidade) > estoque) {
                                return res.status(400).json({
                                    message: `Quantidade indisponível. Existem apenas ${estoque} unidades de ${nomeProduto}`
                                });
                            }

                            const updateSql = "UPDATE cart_items SET quantidade = quantidade + ? WHERE cart_id = ? AND product_id = ?";
                            db.query(updateSql, [quantidade, cartId, product_id], (err) => {
                                if (err) {
                                    console.error("Erro ao atualizar somatório do carrinho:", err);
                                    return res.status(500).json({ error: "Erro interno ao atualizar item" });
                                }
                                return res.json({ message: "Quantidade atualizada!" });
                            });
                        } else {
                            if (quantidade > estoque) {
                                return res.status(400).json({
                                    message: `Existem apenas ${estoque} unidades disponíveis de ${nomeProduto}`
                                });
                            }

                            const insertSql = "INSERT INTO cart_items (cart_id, product_id, quantidade) VALUES (?, ?, ?)";
                            db.query(insertSql, [cartId, product_id, quantidade], (err) => {
                                if (err) {
                                    console.error("Erro ao inserir novo item no carrinho:", err);
                                    return res.status(500).json({ error: "Erro interno ao adicionar produto" });
                                }
                                return res.json({ message: "Produto adicionado!" });
                            });
                        }
                    });
                });
            });
        };

        if (cartResult.length === 0) {
            db.query("INSERT INTO cart (user_id) VALUES (?)", [userId], (err, result) => {
                if (err) {
                    console.error("Erro ao criar carrinho inicial:", err);
                    return res.status(500).json({ error: "Erro interno ao inicializar carrinho" });
                }
                processCart(result.insertId);
            });
        } else {
            processCart(cartResult[0].id);
        }
    });
});

// ==========================================
// VER ITENS DO CARRINHO DO USUÁRIO LOGADO
// ==========================================
router.get('/cart', authMiddleware, (req, res) => {
    const userId = req.user.id;

    const sql = `
        SELECT 
            cart_items.product_id,
            products.nome,
            products.preco,
            products.imagem,
            cart_items.quantidade,
            products.estoque,
            products.store_id,
            stores.aceita_entrega,
            stores.aceita_retirada,
            stores.taxa_entrega,
            stores.endereco,
            stores.numero,
            stores.bairro,
            stores.cidade,
            stores.cep
        FROM cart_items
        JOIN cart ON cart.id = cart_items.cart_id
        JOIN products ON products.id = cart_items.product_id
        JOIN stores ON products.store_id = stores.id
        WHERE cart.user_id = ?
    `;
    db.query(sql, [userId], (err, result) => {
        if (err) {
            console.error("Erro ao listar itens do carrinho:", err);
            return res.status(500).json({ error: "Erro interno ao carregar carrinho" });
        }
        res.json(result);
    });
});

router.post('/calcular-frete', async (req, res) => {
    const cepLoja = "60349040"; 
    const cepCliente = req.body.cepCliente ? req.body.cepCliente.toString().replace('-', '') : ""; 

    if (!cepCliente || cepCliente.length !== 8) {
        return res.status(400).json({ message: "CEP inválido." });
    }

    try {
        // Usando o geocoder que você já tinha configurado no topo
        const resLoja = await geocoder.geocode(`${cepLoja}, Brasil`);
        const resCliente = await geocoder.geocode(`${cepCliente}, Brasil`);

        if (resLoja.length === 0 || resCliente.length === 0) {
            throw new Error("Não foi possível encontrar as coordenadas para os CEPs informados.");
        }

        const coord1 = { latitude: resLoja[0].latitude, longitude: resLoja[0].longitude };
        const coord2 = { latitude: resCliente[0].latitude, longitude: resCliente[0].longitude };

        const kmReal = (calcularDistancia(coord1, coord2) * 1.4).toFixed(1);
        const taxa = (kmReal * 1.50).toFixed(2);

        res.json({ taxa: Number(taxa), km: kmReal });

    } catch (err) {
        console.error("Erro no Geocoder:", err.message);
        res.status(400).json({ message: "Erro ao converter CEP para localização. Tente outro CEP." });
    }
});

module.exports = router;