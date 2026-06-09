const express = require('express');
const router = express.Router();

const db = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadLojas');
const bcrypt = require("bcrypt");

function checkOwner(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Não autenticado" });
  }

  const storeId = parseInt(req.params.id);

  if (isNaN(storeId)) {
    return res.status(400).json({ message: "ID inválido" });
  }

  const sql = `
    SELECT id
    FROM stores
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `;

  db.query(sql, [storeId, req.user.id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Erro no servidor" });
    }

    if (result.length === 0) {
      return res.status(403).json({ message: "Acesso negado" });
    }

    req.storeId = storeId;
    next();
  });
}

// ===============================
// IMAGEM DA LOJA
// ===============================
router.put(
  '/stores/imagem',
  authMiddleware,
  upload.single('imagem'),
  (req, res) => {

    const userId = req.user.id;
    const imagem = req.file ? req.file.filename : null;

    if (!imagem) {
      return res.status(400).json({ message: 'Nenhuma imagem enviada' });
    }

    const sql = `
      UPDATE stores
      SET imagem = ?
      WHERE user_id = ?
    `;

    db.query(sql, [imagem, userId], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Erro ao atualizar imagem' });
      }

      res.json({ message: 'Imagem atualizada com sucesso' });
    });
  }
);


// ===============================
// CRIAR LOJA
// ===============================
router.post(
  '/stores',
  authMiddleware,
  upload.single('imagem'),
  async (req, res) => {

    try {

      // Somente funcionário pode criar loja
      if (req.user.tipo !== "funcionario") {
        return res.status(403).json({
          message: "Apenas funcionários podem criar lojas"
        });
      }

      const {
        nome,
        categoria,
        whatsapp,
        username,
        password
      } = req.body;

      const nomeLimpo = nome?.trim();
      const categoriaLimpa = categoria?.trim();
      const whatsappLimpo = whatsapp?.trim();
      const usernameLimpo = username?.trim().toLowerCase();

      const funcionario_id = req.user.id;

      // Campos obrigatórios
      if (
        !nomeLimpo ||
        !categoriaLimpa ||
        !whatsappLimpo ||
        !usernameLimpo ||
        !password
      ) {
        return res.status(400).json({
          message: "Preencha todos os campos"
        });
      }

      // Imagem obrigatória
      if (!req.file) {
        return res.status(400).json({
          message: "Envie uma imagem da loja"
        });
      }

      // Nome da loja
      if (nomeLimpo.length < 3) {
        return res.status(400).json({
          message: "Nome da loja deve ter pelo menos 3 caracteres"
        });
      }

      if (nomeLimpo.length > 100) {
        return res.status(400).json({
          message: "Nome da loja muito grande"
        });
      }

      // Usuário
      if (usernameLimpo.length < 4) {
        return res.status(400).json({
          message: "Usuário deve ter pelo menos 4 caracteres"
        });
      }

      if (usernameLimpo.length > 30) {
        return res.status(400).json({
          message: "Usuário muito grande"
        });
      }

      // Senha
      if (password.length < 6) {
        return res.status(400).json({
          message: "Senha deve ter pelo menos 6 caracteres"
        });
      }

      // WhatsApp
      const telefoneRegex = /^[0-9]{10,13}$/;

      if (!telefoneRegex.test(whatsappLimpo)) {
        return res.status(400).json({
          message: "WhatsApp inválido"
        });
      }

      // Verifica categoria
      const sqlCategoria = `
        SELECT id
        FROM categories
        WHERE nome = ?
        LIMIT 1
      `;

      db.query(sqlCategoria, [categoriaLimpa], async (err, categoriaExiste) => {

        if (err) {
          return res.status(500).json({
            message: "Erro ao validar categoria"
          });
        }

        if (categoriaExiste.length === 0) {
          return res.status(400).json({
            message: "Categoria inválida"
          });
        }

        // Verifica usuário
        const sqlVerifica = `
          SELECT id
          FROM users
          WHERE username = ?
          LIMIT 1
        `;

        db.query(sqlVerifica, [usernameLimpo], async (err, usuarioExiste) => {

          if (err) {
            return res.status(500).json({
              message: "Erro ao verificar usuário"
            });
          }

          if (usuarioExiste.length > 0) {
            return res.status(400).json({
              message: "Usuário já existe"
            });
          }

          // Criptografa senha
          const senhaHash = await bcrypt.hash(password, 10);

          const sqlUser = `
            INSERT INTO users (
              username,
              password,
              tipo
            )
            VALUES (?, ?, 'lojista')
          `;

          db.query(
            sqlUser,
            [usernameLimpo, senhaHash],
            (err, userResult) => {

              if (err) {
                console.log(err);

                return res.status(500).json({
                  message: "Erro ao criar usuário"
                });
              }

              const lojistaId = userResult.insertId;

              const sqlStore = `
                INSERT INTO stores (
                  nome,
                  categoria,
                  imagem,
                  whatsapp,
                  funcionario_id,
                  user_id
                )
                VALUES (?, ?, ?, ?, ?, ?)
              `;

              db.query(
                sqlStore,
                [
                  nomeLimpo,
                  categoriaLimpa,
                  req.file.filename,
                  whatsappLimpo,
                  funcionario_id,
                  lojistaId
                ],
                (err, storeResult) => {

                  if (err) {
                    console.log(err);

                    return res.status(500).json({
                      message: "Erro ao criar loja"
                    });
                  }

                  res.status(201).json({
                    message: "Loja criada com sucesso",
                    storeId: storeResult.insertId,
                    lojistaId
                  });

                }
              );

            }
          );

        });

      });

    } catch (error) {

      console.log(error);

      return res.status(500).json({
        message: "Erro interno do servidor"
      });

    }

  }
);

// ===============================
// MINHA LOJA
// ===============================
router.get('/minha-loja', authMiddleware, (req, res) => {

  const sql = `
    SELECT * FROM stores
    WHERE user_id = ?
  `;

  db.query(sql, [req.user.id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: 'Erro no servidor' });
    }

    if (result.length > 0) {
      return res.json({ existe: true, loja: result[0] });
    }

    res.json({ existe: false });
  });
});



// ===============================
// LISTAR LOJAS (PÚBLICO)
// ===============================
router.get('/stores', (req, res) => {

  const { busca } = req.query;

  let sql = `
SELECT
  s.*,

  COALESCE((
    SELECT ROUND(AVG(a.nota), 1)
    FROM avaliacoes a
    WHERE a.loja_id = s.id
  ), 0) AS media_avaliacao,

  (
    SELECT COUNT(*)
    FROM avaliacoes a
    WHERE a.loja_id = s.id
  ) AS total_avaliacoes

FROM stores s
`;
  let values = [];

  if (busca) {
    sql += ` WHERE nome LIKE ?`;
    values.push(`%${busca}%`);
  }

  sql += ` ORDER BY id DESC`;

  db.query(sql, values, (err, result) => {
    if (err) {
      return res.status(500).json({ message: 'Erro ao buscar lojas' });
    }

    res.json(result);
  });
});



// ===============================
// LOJA PÚBLICA (CLIENTE)
// ===============================
router.get('/stores/:id/public', (req, res) => {

  const sql = `
    SELECT 
      id,
      nome,
      descricao,
      imagem,
      categoria,
      whatsapp,
      facebook,
      instagram,
      horario_abertura,
      horario_fechamento
    FROM stores
    WHERE id = ?
  `;

  db.query(sql, [req.params.id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Erro no servidor" });
    }

    if (result.length === 0) {
      return res.status(404).json({ message: "Loja não encontrada" });
    }

    res.json(result[0]);
  });
});

// ===============================
// BUSCAR LOJA DO DONO
// ===============================
router.get('/stores/:id', authMiddleware, checkOwner, (req, res) => {

  const sql = `
    SELECT *
    FROM stores
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `;

  db.query(sql, [req.storeId, req.user.id], (err, result) => {

    if (err) {
      return res.status(500).json({
        message: 'Erro no servidor'
      });
    }

    if (result.length === 0) {
      return res.status(404).json({
        message: 'Loja não encontrada'
      });
    }

    res.json(result[0]);

  });

});

// ===============================
// PRODUTOS PÚBLICOS DA LOJA
// ===============================
router.get('/stores/:id/public/products', (req, res) => {

  const storeId = req.params.id;

  const pagina = parseInt(req.query.pagina) || 1;

  const limite = 20;

  const offset = (pagina - 1) * limite;

  const sql = `
    SELECT
      id,
      nome,
      preco,
      imagem
    FROM products
    WHERE store_id = ?
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;

  db.query(sql, [storeId, limite, offset], (err, result) => {

    if (err) {
      console.log(err);

      return res.status(500).json({
        message: 'Erro ao buscar produtos'
      });
    }

    res.json(result);

  });

});


// ===============================
// ATUALIZAR LOJA (SEGURA)
// ===============================
router.put('/stores/:id', authMiddleware, checkOwner, (req, res) => {

  const {
    nome,
    descricao,
    horario_abertura,
    horario_fechamento,
    facebook,
    instagram,
  meta_mensal
  } = req.body;

  if (!nome || nome.trim().length < 3) {
    return res.status(400).json({
        message: "Nome inválido"
    });
}

if (nome.length > 100) {
    return res.status(400).json({
        message: "Nome muito grande"
    });
}

if (descricao && descricao.length > 3000) {
    return res.status(400).json({
        message: "Descrição muito grande"
    });
}

if (
  meta_mensal !== null &&
  meta_mensal !== undefined &&
  isNaN(meta_mensal)
) {
  return res.status(400).json({
    message: "Meta inválida"
  });
}


  const sql = `
  UPDATE stores
  SET nome = ?,
      descricao = ?,
      horario_abertura = ?,
      horario_fechamento = ?,
      facebook = ?,
      instagram = ?,
      meta_mensal = ?
  WHERE id = ? AND user_id = ?
`;

  db.query(sql, [
  nome,
  descricao,
  horario_abertura,
  horario_fechamento,
  facebook,
  instagram,
  meta_mensal,
  req.storeId,
  req.user.id
], (err) => {

  if (err) {
    return res.status(500).json({
      message: "Erro ao atualizar loja"
    });
  }

  res.json({
    message: "Loja atualizada com sucesso"
  });

});
});













// ===============================
// DASHBOARD DA LOJA
// ===============================
router.get('/stores/:id/dashboard', authMiddleware, checkOwner,(req, res) => {

  const storeId = parseInt(req.params.id);

  // META MENSAL DA LOJA
const sqlMetaMensal = `
  SELECT meta_mensal
  FROM stores
  WHERE id = ?
`;

  // FATURAMENTO ÚLTIMOS 7 DIAS
  const sqlUltimosDias = `
    SELECT
      DATE(created_at) AS data,
      COALESCE(SUM(total), 0) AS total
    FROM pedidos
    WHERE loja_id = ?
    AND status = 'finalizado'
    AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    GROUP BY DATE(created_at)
    ORDER BY data ASC
  `;

  // PEDIDOS POR DIA
  const sqlPedidosPorDia = `
    SELECT
      DATE(created_at) AS data,
      COUNT(*) AS total
    FROM pedidos
    WHERE loja_id = ?
    AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    GROUP BY DATE(created_at)
    ORDER BY data ASC
  `;

  // FATURAMENTO HOJE
  const sqlHoje = `
    SELECT COALESCE(SUM(total), 0) AS total
    FROM pedidos
    WHERE loja_id = ?
    AND status = 'finalizado'
    AND DATE(created_at) = CURDATE()
  `;

  // FATURAMENTO MÊS
  const sqlMes = `
    SELECT COALESCE(SUM(total), 0) AS total
    FROM pedidos
    WHERE loja_id = ?
    AND status = 'finalizado'
    AND MONTH(created_at) = MONTH(CURDATE())
    AND YEAR(created_at) = YEAR(CURDATE())
  `;

  // FATURAMENTO ANO
  const sqlAno = `
    SELECT COALESCE(SUM(total), 0) AS total
    FROM pedidos
    WHERE loja_id = ?
    AND status = 'finalizado'
    AND YEAR(created_at) = YEAR(CURDATE())
  `;

  // PRODUTOS MAIS VENDIDOS
  const sqlTopProdutos = `
    SELECT
      p.id,
      p.nome,
      SUM(pi.quantidade) AS quantidade
    FROM pedido_itens pi

    JOIN products p
      ON p.id = pi.produto_id

    JOIN pedidos ped
      ON ped.id = pi.pedido_id

    WHERE ped.loja_id = ?

    GROUP BY p.id, p.nome

    ORDER BY quantidade DESC

    LIMIT 5
  `;


  const sqlMenosVendidos = `
  SELECT
    p.id,
    p.nome,
    SUM(pi.quantidade) AS quantidade
  FROM pedido_itens pi

  JOIN products p
    ON p.id = pi.produto_id

  JOIN pedidos ped
    ON ped.id = pi.pedido_id

  WHERE ped.loja_id = ?

  GROUP BY p.id, p.nome

  ORDER BY quantidade ASC

  LIMIT 5
`;




  // ESTOQUE BAIXO
  const sqlEstoque = `
    SELECT
      id,
      nome,
      estoque
    FROM products
    WHERE store_id = ?
    AND estoque <= 5
  `;

  // TOTAL DE PRODUTOS
  const sqlTotalProdutos = `
    SELECT COUNT(*) AS total
    FROM products
    WHERE store_id = ?
  `;

  // TOTAL DE PEDIDOS
  const sqlTotalPedidos = `
    SELECT COUNT(*) AS total
    FROM pedidos
    WHERE loja_id = ?
  `;

  // ÚLTIMO PEDIDO
const sqlUltimoPedido = `
  SELECT *
  FROM pedidos
  WHERE loja_id = ?
  ORDER BY id DESC
  LIMIT 1
`;

  // EXECUTANDO CONSULTAS
  db.query(sqlPedidosPorDia, [storeId], (err, pedidosPorDia) => {

    if (err) {
      console.log(err);

      console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
    }db.query(sqlMetaMensal, [storeId], (err, metaResult) => {

    if (err) {
      console.log(err);

      console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
    }

    db.query(sqlUltimosDias, [storeId], (err, vendasPorDia) => {

      if (err) {
        console.log(err);

        console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
      }

      db.query(sqlHoje, [storeId], (err, hojeResult) => {

        if (err) {
          console.log(err);

          console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
        }

        db.query(sqlMes, [storeId], (err, mesResult) => {

          if (err) {
            console.log(err);

            console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
          }

          db.query(sqlAno, [storeId], (err, anoResult) => {

            if (err) {
              console.log(err);

              console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
            }

            db.query(sqlTopProdutos, [storeId], (err, topProdutos) => {

              if (err) {
                console.log(err);

                console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
              }

              db.query(sqlMenosVendidos, [storeId], (err, menosVendidos) => {
                if (err) {
                console.log(err);

                console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
              }

              db.query(sqlEstoque, [storeId], (err, estoqueBaixo) => {

                if (err) {
                  console.log(err);

                  console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
                }

                db.query(sqlTotalProdutos, [storeId], (err, totalProdutosResult) => {

                  if (err) {
                    console.log(err);

                    console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
                  }

                  db.query(sqlTotalPedidos, [storeId], (err, totalPedidosResult) => {

  if (err) {
    console.log(err);

    console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
  }

  // ÚLTIMO PEDIDO
  db.query(sqlUltimoPedido, [storeId], (err, ultimoPedidoResult) => {

    if (err) {
      console.log(err);

      console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
    }

    res.json({

      faturamentoHoje: hojeResult[0].total,
      faturamentoMes: mesResult[0].total,
      faturamentoAno: anoResult[0].total,

      totalProdutos: totalProdutosResult[0].total,
      totalPedidos: totalPedidosResult[0].total,

      topProdutos,
      menosVendidos,
      estoqueBaixo,
      vendasPorDia,
      pedidosPorDia,

      metaMensal: metaResult[0]?.meta_mensal || 0,

      ultimoPedido: ultimoPedidoResult[0] || null

    });

  });
  });
  });

});

                });

              });

            });

          });

        });

      });

    });

  });

});



router.get('/stores/:id/estoque', authMiddleware, checkOwner, (req, res) => {

  const storeId = req.params.id;

  const sql = `
    SELECT id, nome, estoque
    FROM products
    WHERE store_id = ?
    ORDER BY estoque ASC
  `;

  db.query(sql, [storeId], (err, result) => {

    if (err) {
      console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
    }

    res.json(result);

  });

});



router.get('/stores/:id/mais-vendidos', authMiddleware, checkOwner, (req, res) => {

  const storeId = req.params.id;

  const sql = `
    SELECT 
      p.id,
      p.nome,
      SUM(pi.quantidade) AS total_vendido
    FROM pedido_itens pi
    JOIN products p ON p.id = pi.produto_id
    JOIN pedidos ped ON ped.id = pi.pedido_id
    WHERE ped.loja_id = ?
    GROUP BY p.id, p.nome
    ORDER BY total_vendido DESC
    LIMIT 10
  `;

  db.query(sql, [storeId], (err, result) => {

    if (err) {
      console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
    }

    res.json(result);

  });

});



router.get('/stores/:id/financeiro', authMiddleware, checkOwner, (req, res) => {

  const storeId = req.params.id;

  const sql = `
    SELECT 
      DATE(created_at) as data,
      SUM(total) as total
    FROM pedidos
    WHERE loja_id = ?
    AND status = 'finalizado'
    GROUP BY DATE(created_at)
    ORDER BY data ASC
  `;

  db.query(sql, [storeId], (err, result) => {

    if (err) {
      console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
    }

    res.json(result);

  });

});



router.get('/stores/:id/clientes', authMiddleware, checkOwner, (req, res) => {

  const storeId = req.params.id;

  const sql = `
    SELECT 
      u.id,
      u.nome,
      COUNT(p.id) as total_pedidos
    FROM pedidos p
    JOIN users u ON u.id = p.user_id
    WHERE p.loja_id = ?
    GROUP BY u.id, u.nome
    ORDER BY total_pedidos DESC
  `;

  db.query(sql, [storeId], (err, result) => {

    if (err) {
      console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
    }

    res.json(result);

  });

});


router.get(
  "/funcionario/minhas-lojas",
  authMiddleware,
  (req, res) => {

    const funcionarioId = req.user.id;

    const sql = `
      SELECT
    s.id,
    s.nome,
    s.categoria,
    s.imagem,

    (
        SELECT COUNT(*)
        FROM products p
        WHERE p.store_id = s.id
    ) AS total_produtos,

    (
        SELECT COUNT(*)
        FROM pedidos pe
        WHERE pe.loja_id = s.id
    ) AS total_pedidos,

    COALESCE((
        SELECT SUM(pe.total)
        FROM pedidos pe
        WHERE pe.loja_id = s.id
        AND pe.status = 'finalizado'
        AND DATE(pe.created_at) = CURDATE()
    ), 0) AS faturamento,

    CASE
        WHEN s.horario_abertura IS NULL
          OR s.horario_fechamento IS NULL THEN 0

        WHEN s.horario_abertura < s.horario_fechamento THEN
            CASE
                WHEN CURTIME() BETWEEN s.horario_abertura
                                   AND s.horario_fechamento
                THEN 1
                ELSE 0
            END

        ELSE
            CASE
                WHEN CURTIME() >= s.horario_abertura
                  OR CURTIME() < s.horario_fechamento
                THEN 1
                ELSE 0
            END
    END AS aberta

FROM stores s

WHERE s.funcionario_id = ?

ORDER BY s.id DESC
    `;

    db.query(sql, [funcionarioId], (err, result) => {

  if (err) {
    console.error(err);

    return res.status(500).json({
      message: "Erro interno do servidor"
    });
  }

  res.json(result);

});
});

router.get("/funcionario/loja-dashboard/:id", authMiddleware, (req, res) => {

    const lojaId = Number(req.params.id);

if (!Number.isInteger(lojaId)) {
    return res.status(400).json({
        message: "ID inválido"
    });
}

    const sql = `
        SELECT
            s.id,
            s.nome,

            COALESCE((
                SELECT SUM(total)
                FROM pedidos
                WHERE loja_id = s.id
                AND status = 'finalizado'
                AND DATE(created_at) = CURDATE()
            ),0) AS faturamentoHoje,

            COALESCE((
                SELECT SUM(total)
                FROM pedidos
                WHERE loja_id = s.id
                AND status = 'finalizado'
                AND MONTH(created_at) = MONTH(CURDATE())
                AND YEAR(created_at) = YEAR(CURDATE())
            ),0) AS faturamentoMes,

            COALESCE((
                SELECT SUM(total)
                FROM pedidos
                WHERE loja_id = s.id
                AND status = 'finalizado'
                AND YEAR(created_at) = YEAR(CURDATE())
            ),0) AS faturamentoAno,

            COALESCE((
                SELECT COUNT(*)
                FROM products
                WHERE store_id = s.id
            ),0) AS total_produtos,

            COALESCE((
                SELECT COUNT(*)
                FROM pedidos
                WHERE loja_id = s.id
            ),0) AS total_pedidos

        FROM stores s
        WHERE s.id = ?
        AND s.funcionario_id = ?
        LIMIT 1
    `;

    db.query(sql, [lojaId, req.user.id], (err, result) => {

        if (err) {
            console.log(err);
            console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
        }

        res.json(result[0]);

    });

});


















router.get(
  "/funcionario/top-lojas",
  authMiddleware,
  (req, res) => {

    const sql = `
      SELECT
          s.id,
          s.nome,
          s.categoria,

          COALESCE(
            SUM(
              CASE
                WHEN p.status = 'finalizado'
                AND DATE(p.created_at) = CURDATE()
                THEN p.total
                ELSE 0
              END
            ),0
          ) AS faturamentoHoje,

          COUNT(
            DISTINCT CASE
              WHEN DATE(p.created_at) = CURDATE()
              THEN p.id
            END
          ) AS pedidosHoje

      FROM stores s

      LEFT JOIN pedidos p
        ON p.loja_id = s.id

      GROUP BY s.id

      ORDER BY faturamentoHoje DESC
    `;

    db.query(sql, (err, result) => {

      if (err) {
        console.log(err);
        console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
      }

      res.json(result);

    });

});

router.get(
  "/funcionario/resumo",
  authMiddleware,
  (req, res) => {

    const funcionarioId = req.user.id;

    const sql = `
      SELECT

        COUNT(*) AS totalLojas,

        COUNT(*) * 40 AS ganhos,

        (
          SELECT COUNT(*)
          FROM products p
          JOIN stores s ON s.id = p.store_id
          WHERE s.funcionario_id = ?
        ) AS totalProdutos

      FROM stores
      WHERE funcionario_id = ?
    `;

    db.query(
      sql,
      [funcionarioId, funcionarioId],
      (err, result) => {

        if (err) {
          console.log(err);
          console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
        }

        const dados = result[0];

        const meta = 50; // exemplo

        const crescimento = Math.min(
          ((dados.totalLojas / meta) * 100),
          100
        );

        res.json({
          totalLojas: dados.totalLojas,
          ganhos: dados.ganhos,
          totalProdutos: dados.totalProdutos,
          crescimento: crescimento.toFixed(0)
        });

      }
    );

  }
);

router.post("/avaliacao", authMiddleware, (req, res) => {
    console.log(req.body);
  
  const { pedido_id, loja_id, nota, comentario } = req.body;
  
  if (!Number.isInteger(Number(nota))) {
    return res.status(400).json({
        error: "Nota inválida"
    });
}

if (nota < 1 || nota > 5) {
    return res.status(400).json({
        error: "Nota deve ser entre 1 e 5"
    });
}

  const cliente_id = req.user.id;

  const sqlVerifica = `
    SELECT avaliado
    FROM pedidos
    WHERE id = ?
  `;

  db.query(sqlVerifica, [pedido_id], (err, pedido) => {

    if (err) {
      return res.status(500).json({ error: "Erro servidor" });
    }

    if (pedido.length === 0) {
      return res.status(404).json({ error: "Pedido não encontrado" });
    }

    if (pedido[0].avaliado === 1) {
      return res.status(400).json({
        error: "Pedido já foi avaliado"
      });
    }

    const sql = `
      INSERT INTO avaliacoes
      (pedido_id, cliente_id, loja_id, nota, comentario)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(
      sql,
      [
        pedido_id,
        cliente_id,
        loja_id,
        nota,
        comentario
      ],
      (err) => {

        if (err) {
          console.log(err);
          return res.status(500).json({
            error: "Erro ao salvar avaliação"
          });
        }

        db.query(
          `
          UPDATE pedidos
          SET avaliado = 1
          WHERE id = ?
          `,
          [pedido_id]
        );

        res.json({
          message: "Avaliação salva"
        });

      }
    );

  });

});

router.get(
  "/avaliacao/verificar/:pedidoId",
  authMiddleware,
  (req, res) => {

    const pedidoId = req.params.pedidoId;

    const sql = `
      SELECT id
      FROM avaliacoes
      WHERE pedido_id = ?
      LIMIT 1
    `;

    db.query(sql, [pedidoId], (err, result) => {

      if (err) {
        console.error(err);

    return res.status(500).json({
        message: "Erro interno do servidor"
    });
      }

      res.json({
        avaliado: result.length > 0
      });

    });

});


router.get("/stores/:id/avaliacoes", (req, res) => {

  const lojaId = Number(req.params.id);

if (!Number.isInteger(lojaId)) {
    return res.status(400).json({
        message: "ID inválido"
    });
}

  const sql = `
    SELECT
      ROUND(AVG(nota), 1) AS media,
      COUNT(*) AS total
    FROM avaliacoes
    WHERE loja_id = ?
  `;

  db.query(sql, [lojaId], (err, result) => {

    if (err) {
      return res.status(500).json({
        error: "Erro ao buscar avaliações"
      });
    }

    res.json({
      media: result[0].media || 0,
      total: result[0].total || 0
    });

  });

});


router.get("/stores/:id/comentarios", (req, res) => {

  const lojaId = Number(req.params.id);

if (!Number.isInteger(lojaId)) {
    return res.status(400).json({
        message: "ID inválido"
    });
}

  const sql = `
    SELECT
      a.id,
      a.nota,
      a.comentario,
      a.created_at,
a.resposta_loja,
a.resposta_data,
      u.username
    FROM avaliacoes a

    JOIN users u
      ON u.id = a.cliente_id

    WHERE a.loja_id = ?

    ORDER BY a.created_at DESC
  `;

  db.query(sql, [lojaId], (err, result) => {

    if (err) {
      console.log(err);

      return res.status(500).json({
        error: "Erro ao buscar comentários"
      });
    }

    res.json(result);

  });

});

router.post(
    "/avaliacoes/:id/responder",
    authMiddleware,
    (req, res) => {
        const avaliacaoId = req.params.id;
        const { resposta } = req.body;
        const userId = req.user.id;
        const userTipo = req.user.tipo; // Pega o tipo do usuário (lojista/funcionario)

        // Buscamos se a avaliação existe e quem é o dono da loja
        const sql = `
            SELECT
                a.id,
                a.resposta_loja,
                s.user_id AS loja_lojista_id
            FROM avaliacoes a
            JOIN stores s ON s.id = a.loja_id
            WHERE a.id = ?
        `;

        db.query(sql, [avaliacaoId], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Erro interno do servidor" });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: "Avaliação não encontrada" });
            }

            const avaliacao = result[0];

            // GARANTIA DE SEGURANÇA: Só aceita se for o lojista dono DAQUELA loja ou um funcionário
            if (userTipo !== 'funcionario' && avaliacao.loja_lojista_id !== userId) {
                return res.status(403).json({ message: "Sem permissão. Você não é o dono desta loja." });
            }

            // impede responder duas vezes
            if (avaliacao.resposta_loja) {
                return res.status(400).json({ message: "Comentário já respondido" });
            }

            db.query(
                `
                UPDATE avaliacoes
                SET
                    resposta_loja = ?,
                    resposta_data = NOW()
                WHERE id = ?
                `,
                [resposta, avaliacaoId],
                (err) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ message: "Erro interno do servidor" });
                    }
                    res.json({ message: "Resposta enviada" });
                }
            );
        });
    }
);

router.post("/stores/:id/favoritar", authMiddleware, async (req, res) => {

    const lojaId = Number(req.params.id);

if (!Number.isInteger(lojaId)) {
    return res.status(400).json({
        message: "ID inválido"
    });
}
    const usuarioId = req.user.id;

    try {

        const [favorito] = await db.promise().query(
            `
            SELECT *
            FROM lojas_favoritas
            WHERE usuario_id = ? AND loja_id = ?
            `,
            [usuarioId, lojaId]
        );

        if (favorito.length > 0) {

            await db.promise().query(
                `
                DELETE FROM lojas_favoritas
                WHERE usuario_id = ? AND loja_id = ?
                `,
                [usuarioId, lojaId]
            );

            return res.json({
                favorito: false
            });
        }

        await db.promise().query(
            `
            INSERT INTO lojas_favoritas
            (usuario_id, loja_id)
            VALUES (?, ?)
            `,
            [usuarioId, lojaId]
        );

        res.json({
            favorito: true
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({
            erro: "Erro interno"
        });
    }
});

router.get("/stores/:id/favorito", authMiddleware, async (req, res) => {

    const lojaId = Number(req.params.id);

if (!Number.isInteger(lojaId)) {
    return res.status(400).json({
        message: "ID inválido"
    });
}
    const usuarioId = req.user.id;

    try {

        const [resultado] = await db.promise().query(
            `
            SELECT id
            FROM lojas_favoritas
            WHERE usuario_id = ? AND loja_id = ?
            `,
            [usuarioId, lojaId]
        );

        res.json({
            favorito: resultado.length > 0
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({
            erro: "Erro interno"
        });
    }
});

router.get("/stores/:id/total-favoritos", async (req, res) => {

    const lojaId = Number(req.params.id);

if (!Number.isInteger(lojaId)) {
    return res.status(400).json({
        message: "ID inválido"
    });
}

    try {

        const [resultado] = await db.promise().query(
            `
            SELECT COUNT(*) AS total
            FROM lojas_favoritas
            WHERE loja_id = ?
            `,
            [lojaId]
        );

        res.json(resultado[0]);

    } catch (err) {
        console.log(err);
        res.status(500).json({
            erro: "Erro interno"
        });
    }
});

router.get("/stores/favoritos/minhas", authMiddleware, async (req, res) => {

    const usuarioId = req.user.id;

    try {

        const [lojas] = await db.promise().query(
            `
            SELECT s.*
            FROM stores s
            INNER JOIN lojas_favoritas lf
                ON lf.loja_id = s.id
            WHERE lf.usuario_id = ?
            ORDER BY lf.criado_em DESC
            `,
            [usuarioId]
        );

        res.json(lojas);

    } catch (err) {
        console.log(err);
        res.status(500).json({
            erro: "Erro interno"
        });
    }
});

router.get(
  "/favoritos/quantidade",
  authMiddleware,
  async (req, res) => {

    const usuarioId = req.user.id;

    try {

      const [resultado] = await db.promise().query(
        `
        SELECT COUNT(*) AS total
        FROM lojas_favoritas
        WHERE usuario_id = ?
        `,
        [usuarioId]
      );

      res.json({
        total: resultado[0].total
      });

    } catch (err) {

      console.log(err);

      res.status(500).json({
        erro: "Erro interno"
      });

    }

  }
);

module.exports = router;