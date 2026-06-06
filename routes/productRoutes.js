const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadProdutos');

router.post(
    '/products',
    authMiddleware,
    upload.fields([
        { name: "imagem", maxCount: 1 },
        { name: "imagem2", maxCount: 1 },
        { name: "imagem3", maxCount: 1 }
    ]),
    (req, res) => {

        const userId = req.user.id;

        const {
            nome,
            descricao,
            preco,
            preco_antigo,
            estoque,
            categoria
        } = req.body;

        const imagem = req.files?.imagem
            ? req.files.imagem[0].filename
            : null;

        const imagem2 = req.files?.imagem2
            ? req.files.imagem2[0].filename
            : null;

        const imagem3 = req.files?.imagem3
            ? req.files.imagem3[0].filename
            : null;

        const sqlStore = `
            SELECT id FROM stores
            WHERE user_id = ?
        `;

        db.query(sqlStore, [userId], (err, storeResult) => {

            if(err){
                return res.status(500).json(err);
            }

            if(storeResult.length === 0){
                return res.status(404).json({
                    error: "Loja não encontrada"
                });
            }

            const store_id = storeResult[0].id;

            const sql = `
                INSERT INTO products
                (
                    nome,
                    descricao,
                    preco,
                    preco_antigo,
                    estoque,
                    imagem,
                    imagem2,
                    imagem3,
                    categoria,
                    store_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.query(
                sql,
                [
                    nome,
                    descricao,
                    preco,
                    preco_antigo,
                    estoque,
                    imagem,
                    imagem2,
                    imagem3,
                    categoria,
                    store_id
                ],
                (err, result) => {

                    if(err){
                        return res.status(500).json(err);
                    }

                    res.json({
                        message: "Produto cadastrado!"
                    });

                }
            );

        });

    }
);

router.get('/products', (req, res) => {

    const { categoria, busca } = req.query;

    let sql = `
        SELECT
            products.*,
            stores.nome AS nomeLoja,
            COUNT(product_likes.id) AS curtidas
        FROM products
        JOIN stores
            ON products.store_id = stores.id
        LEFT JOIN product_likes
            ON product_likes.product_id = products.id
        WHERE 1=1
    `;

    let values = [];

    if (categoria) {
        sql += " AND products.categoria = ?";
        values.push(categoria);
    }

    if (busca) {
        sql += `
            AND (
                products.nome LIKE ?
                OR products.categoria LIKE ?
                OR stores.nome LIKE ?
            )
        `;
        values.push(`%${busca}%`);
        values.push(`%${busca}%`);
        values.push(`%${busca}%`);
    }

    sql += `
        GROUP BY products.id
        ORDER BY products.id DESC
        LIMIT ? OFFSET ?
    `;

    const pagina = parseInt(req.query.pagina) || 1;
    const limite = 30;
    const offset = (pagina - 1) * limite;

    values.push(limite, offset);

    db.query(sql, values, (err, result) => {
        if (err) {
            return res.status(500).json(err);
        }

        res.json(result);
    });
});

router.get('/products/:id', (req, res) => {

    const productId = req.params.id;

    const sql = `
        SELECT
            products.*,
            stores.nome AS nomeLoja
        FROM products
        JOIN stores
        ON products.store_id = stores.id
        WHERE products.id = ?
    `;

    db.query(sql, [productId], (err, result) => {

        if(err){
            return res.status(500).json(err);
        }

        if(result.length === 0){
            return res.status(404).json({
                error: "Produto não encontrado"
            });
        }

        res.json(result[0]);

    });

});

router.get('/stores/:id/products', (req, res) => {

    const storeId = req.params.id;

    const pagina = parseInt(req.query.pagina) || 1;
    const limite = 15;
    const offset = (pagina - 1) * limite;

    const sql = `
        SELECT
            products.*,
            COUNT(product_likes.id) AS curtidas
        FROM products
        LEFT JOIN product_likes
            ON product_likes.product_id = products.id
        WHERE products.store_id = ?
        GROUP BY products.id
        ORDER BY products.id DESC
        LIMIT ? OFFSET ?
    `;

    db.query(sql, [storeId, limite, offset], (err, result) => {
        if (err) {
            return res.status(500).json(err);
        }

        res.json(result);
    });

});


router.put(
  '/products/:id',
  authMiddleware,
  upload.fields([
    { name: "imagem", maxCount: 1 },
    { name: "imagem2", maxCount: 1 },
    { name: "imagem3", maxCount: 1 }
  ]),
  (req, res) => {

    const productId = req.params.id;
    const userId = req.user.id;

    // 1. buscar produto + loja dele
    const sqlCheck = `
      SELECT store_id
      FROM products
      WHERE id = ?
    `;

    db.query(sqlCheck, [productId], (err, result) => {

      if (err) {
        return res.status(500).json(err);
      }

      if (result.length === 0) {
        return res.status(404).json({
          message: "Produto não encontrado"
        });
      }

      const storeId = result[0].store_id;

      // 2. verificar dono da loja
      const sqlOwner = `
        SELECT user_id
        FROM stores
        WHERE id = ?
      `;

      db.query(sqlOwner, [storeId], (err2, storeResult) => {

        if (err2) {
          return res.status(500).json(err2);
        }

        if (storeResult.length === 0) {
          return res.status(404).json({
            message: "Loja não encontrada"
          });
        }

        const ownerId = storeResult[0].user_id;

        // 3. BLOQUEIO DE SEGURANÇA
        if (ownerId !== userId) {
          return res.status(403).json({
            message: "Você não tem permissão para editar este produto"
          });
        }

        // =========================
        // 4. SE PASSOU → ATUALIZA
        // =========================

        const {
          nome,
          descricao,
          preco,
          preco_antigo,
          estoque,
          categoria
        } = req.body;

        const clean = (value) => {
          if (
            value === "" ||
            value === "null" ||
            value === undefined
          ) {
            return null;
          }
          return value;
        };

        const imagem = req.files?.imagem
          ? req.files.imagem[0].filename
          : null;

        const imagem2 = req.files?.imagem2
          ? req.files.imagem2[0].filename
          : null;

        const imagem3 = req.files?.imagem3
          ? req.files.imagem3[0].filename
          : null;

        const sqlUpdate = `
          UPDATE products
          SET
            nome = ?,
            descricao = ?,
            preco = ?,
            preco_antigo = ?,
            estoque = ?,
            categoria = ?,
            imagem = COALESCE(?, imagem),
            imagem2 = COALESCE(?, imagem2),
            imagem3 = COALESCE(?, imagem3)
          WHERE id = ?
        `;

        db.query(
          sqlUpdate,
          [
            nome,
            descricao,
            preco,
            clean(preco_antigo),
            estoque,
            clean(categoria),
            imagem,
            imagem2,
            imagem3,
            productId
          ],
          (err3) => {

            if (err3) {
              return res.status(500).json(err3);
            }

            return res.json({
              message: "Produto atualizado com sucesso!"
            });

          }
        );

      });

    });

  }
);

// =========================
// CURTIR PRODUTO
// =========================
router.post('/products/:id/like', authMiddleware, (req, res) => {

    const userId = req.user.id;
    const productId = req.params.id;

    const sql = `
        INSERT INTO product_likes (user_id, product_id)
        VALUES (?, ?)
    `;

    db.query(sql, [userId, productId], (err) => {

        if (err) {

            // já curtiu (UNIQUE KEY)
            if (err.code === "ER_DUP_ENTRY") {
                return res.status(400).json({
                    message: "Você já curtiu este produto"
                });
            }

            return res.status(500).json(err);
        }

        res.json({
            message: "Produto curtido!"
        });

    });

});

router.delete('/products/:id/like', authMiddleware, (req, res) => {

    const userId = req.user.id;
    const productId = req.params.id;

    const sql = `
        DELETE FROM product_likes
        WHERE user_id = ? AND product_id = ?
    `;

    db.query(sql, [userId, productId], (err) => {

        if (err) {
            return res.status(500).json(err);
        }

        res.json({
            message: "Like removido!"
        });

    });

});

router.get('/products/:id/likes', (req, res) => {

    const productId = req.params.id;

    const sql = `
        SELECT COUNT(*) AS total
        FROM product_likes
        WHERE product_id = ?
    `;

    db.query(sql, [productId], (err, result) => {

        if (err) {
            return res.status(500).json(err);
        }

        res.json({
            total: result[0].total
        });

    });

});

router.get('/products/:id/liked', authMiddleware, (req, res) => {

    const userId = req.user.id;
    const productId = req.params.id;

    const sql = `
        SELECT id
        FROM product_likes
        WHERE user_id = ? AND product_id = ?
    `;

    db.query(sql, [userId, productId], (err, result) => {

        if (err) {
            return res.status(500).json(err);
        }

        res.json({
            liked: result.length > 0
        });

    });

});


module.exports = router;