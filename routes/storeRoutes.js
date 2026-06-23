const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const bcrypt = require("bcrypt");
const uploadLojas = require('../middlewares/uploadLojas');
const uploadProdutos = require('../middlewares/uploadProdutos');

// Middleware de autorização otimizado
const checkOwner = async (req, res, next) => {
    try {
        const storeId = parseInt(req.params.id);
        if (isNaN(storeId)) return res.status(400).json({ message: "ID inválido" });

        const [rows] = await db.query("SELECT id FROM stores WHERE id = ? AND user_id = ? LIMIT 1", [storeId, req.user.id]);
        if (rows.length === 0) return res.status(403).json({ message: "Acesso negado" });

        req.storeId = storeId;
        next();
    } catch (err) {
        res.status(500).json({ message: "Erro no servidor" });
    }
};

// 1. IMAGEM DA LOJA
router.put('/stores/imagem', authMiddleware, uploadLojas.single('imagem'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'Nenhuma imagem enviada' });
        await db.query("UPDATE stores SET imagem = ? WHERE user_id = ?", [req.file.filename, req.user.id]);
        res.json({ message: 'Imagem atualizada com sucesso' });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao atualizar imagem' });
    }
});

// 2. CRIAR LOJA (Uso de Transação para segurança)
router.post('/stores', authMiddleware, uploadLojas.single('imagem'), async (req, res) => {
    try {
        if (req.user.tipo !== "funcionario") return res.status(403).json({ message: "Apenas funcionários podem criar lojas" });
        if (!req.file) return res.status(400).json({ message: "Envie uma imagem da loja" });

        const { nome, categoria, whatsapp, username, password } = req.body;
        
        if (!nome || !categoria || !whatsapp || !username || !password) return res.status(400).json({ message: "Preencha todos os campos" });
        
        // --- FUNÇÃO PARA GERAR O SLUG ---
        const gerarSlug = (texto) => {
            return texto
                .toString()
                .toLowerCase()
                .trim()
                .replace(/\s+/g, '-')       // Espaços por -
                .replace(/[^\w\-]+/g, '')   // Remove caracteres especiais
                .replace(/\-\-+/g, '-');    // Remove hífens duplicados
        };

        const slug = gerarSlug(nome);

        // Iniciar Transação
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            const [catResult] = await connection.query("SELECT id FROM categories WHERE nome = ?", [categoria.trim()]);
            if (catResult.length === 0) throw new Error("Categoria inválida");

            const [userExists] = await connection.query("SELECT id FROM users WHERE username = ?", [username.trim().toLowerCase()]);
            if (userExists.length > 0) throw new Error("Usuário já existe");

            const senhaHash = await bcrypt.hash(password, 10);
            const [userResult] = await connection.query("INSERT INTO users (username, password, tipo) VALUES (?, ?, 'lojista')", [username.trim().toLowerCase(), senhaHash]);

            // --- INSERÇÃO COM O SLUG ---
            await connection.query(
                "INSERT INTO stores (nome, slug, categoria, imagem, whatsapp, funcionario_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [nome.trim(), slug, categoria.trim(), req.file.filename, whatsapp.trim(), req.user.id, userResult.insertId]
            );

            await connection.commit();
            res.status(201).json({ message: "Loja criada com sucesso", storeId: userResult.insertId, slug });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        res.status(400).json({ message: err.message || "Erro interno do servidor" });
    }
});

// 3. MINHA LOJA
router.get('/minha-loja', authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM stores WHERE user_id = ?", [req.user.id]);
        res.json(rows.length > 0 ? { existe: true, loja: rows[0] } : { existe: false });
    } catch (err) {
        res.status(500).json({ message: 'Erro no servidor' });
    }
});

// 4. LISTAR LOJAS (PÚBLICO)
router.get('/stores', async (req, res) => {
    try {
        const { busca } = req.query;
        let sql = `SELECT s.*, 
                   COALESCE((SELECT ROUND(AVG(a.nota), 1) FROM avaliacoes a WHERE a.loja_id = s.id), 0) AS media_avaliacao,
                   (SELECT COUNT(*) FROM avaliacoes a WHERE a.loja_id = s.id) AS total_avaliacoes
                   FROM stores s`;
        
        let values = [];
        if (busca) { sql += " WHERE nome LIKE ?"; values.push(`%${busca}%`); }
        sql += " ORDER BY id DESC";

        const [rows] = await db.query(sql, values);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar lojas' });
    }
});

// 5. LOJA PÚBLICA e BUSCA LOJA DO DONO (Simplificados)
router.get('/stores/:id/public', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, nome, descricao, imagem, categoria, whatsapp, facebook, instagram, horario_abertura, horario_fechamento FROM stores WHERE id = ?", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: "Loja não encontrada" });
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ message: "Erro no servidor" }); }
});

router.get('/stores/:id', authMiddleware, checkOwner, async (req, res) => {
    const [rows] = await db.query("SELECT * FROM stores WHERE id = ? AND user_id = ?", [req.storeId, req.user.id]);
    res.json(rows[0]);
});

// 6. PRODUTOS PÚBLICOS
router.get('/stores/:id/public/products', async (req, res) => {
    try {
        const pagina = parseInt(req.query.pagina) || 1;
        const [rows] = await db.query("SELECT id, nome, preco, imagem FROM products WHERE store_id = ? ORDER BY id DESC LIMIT 20 OFFSET ?", 
                      [req.params.id, (pagina - 1) * 20]);
        res.json(rows);
    } catch (err) { res.status(500).json({ message: 'Erro ao buscar produtos' }); }
});


// ===============================
// ATUALIZAR LOJA
// ===============================
router.put('/stores/:id', authMiddleware, checkOwner, async (req, res) => {
    try {
        const { nome, descricao, horario_abertura, horario_fechamento, facebook, instagram, meta_mensal } = req.body;

        if (!nome || nome.trim().length < 3) return res.status(400).json({ message: "Nome inválido" });
        if (nome.length > 100) return res.status(400).json({ message: "Nome muito grande" });
        if (descricao && descricao.length > 3000) return res.status(400).json({ message: "Descrição muito grande" });
        if (meta_mensal !== null && meta_mensal !== undefined && isNaN(meta_mensal)) return res.status(400).json({ message: "Meta inválida" });

        await db.query(`UPDATE stores SET nome=?, descricao=?, horario_abertura=?, horario_fechamento=?, facebook=?, instagram=?, meta_mensal=? WHERE id=? AND user_id=?`,
            [nome, descricao, horario_abertura, horario_fechamento, facebook, instagram, meta_mensal, req.storeId, req.user.id]);

        res.json({ message: "Loja atualizada com sucesso" });
    } catch (err) {
        res.status(500).json({ message: "Erro ao atualizar loja" });
    }
});

// ===============================
// DASHBOARD DA LOJA (Otimizado com Promise.all)
// ===============================
router.get('/stores/:id/dashboard', authMiddleware, checkOwner, async (req, res) => {
    try {
        const storeId = req.storeId; // Já injetado pelo checkOwner

        // Executa todas as consultas em paralelo para ganhar performance
        const [
            [meta], [vendasPorDia], [pedidosPorDia], [hoje], [mes], [ano], 
            [top], [menos], [estoque], [totalProd], [totalPed], [ultimo]
        ] = await Promise.all([
            db.query("SELECT meta_mensal FROM stores WHERE id = ?", [storeId]),

            db.query("SELECT DATE(created_at) AS data, COALESCE(SUM(total_final), 0) AS total FROM pedidos WHERE loja_id = ? AND status = 'finalizado' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY data ASC", [storeId]),

            db.query("SELECT DATE(created_at) AS data, COUNT(*) AS total FROM pedidos WHERE loja_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY data ASC", [storeId]),

            db.query("SELECT COALESCE(SUM(total_final), 0) AS total FROM pedidos WHERE loja_id = ? AND status = 'finalizado' AND DATE(created_at) = CURDATE()", [storeId]),

            db.query("SELECT COALESCE(SUM(total_final), 0) AS total FROM pedidos WHERE loja_id = ? AND status = 'finalizado' AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())", [storeId]),

            db.query("SELECT COALESCE(SUM(total_final), 0) AS total FROM pedidos WHERE loja_id = ? AND status = 'finalizado' AND YEAR(created_at) = YEAR(CURDATE())", [storeId]),
            
            db.query("SELECT p.id, p.nome, SUM(pi.quantidade) AS quantidade FROM pedido_itens pi JOIN products p ON p.id = pi.produto_id JOIN pedidos ped ON ped.id = pi.pedido_id WHERE ped.loja_id = ? GROUP BY p.id ORDER BY quantidade DESC LIMIT 5", [storeId]),

            db.query("SELECT p.id, p.nome, SUM(pi.quantidade) AS quantidade FROM pedido_itens pi JOIN products p ON p.id = pi.produto_id JOIN pedidos ped ON ped.id = pi.pedido_id WHERE ped.loja_id = ? GROUP BY p.id ORDER BY quantidade ASC LIMIT 5", [storeId]),
            db.query("SELECT id, nome, estoque FROM products WHERE store_id = ? AND estoque <= 5", [storeId]),
            db.query("SELECT COUNT(*) AS total FROM products WHERE store_id = ?", [storeId]),
            db.query("SELECT COUNT(*) AS total FROM pedidos WHERE loja_id = ?", [storeId]),
            db.query("SELECT * FROM pedidos WHERE loja_id = ? ORDER BY id DESC LIMIT 1", [storeId])
        ]);

        res.json({
            faturamentoHoje: hoje[0].total,
            faturamentoMes: mes[0].total,
            faturamentoAno: ano[0].total,
            totalProdutos: totalProd[0].total,
            totalPedidos: totalPed[0].total,
            topProdutos: top,
            menosVendidos: menos,
            estoqueBaixo: estoque,
            vendasPorDia,
            pedidosPorDia,
            metaMensal: meta[0]?.meta_mensal || 0,
            ultimoPedido: ultimo[0] || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro ao carregar dashboard" });
    }
});






// ===============================
// ESTOQUE DA LOJA
// ===============================
router.get('/stores/:id/estoque', authMiddleware, checkOwner, async (req, res) => {
    try {
        const [result] = await db.query(
            "SELECT id, nome, estoque FROM products WHERE store_id = ? ORDER BY estoque ASC", 
            [req.storeId]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// ===============================
// PRODUTOS MAIS VENDIDOS
// ===============================
router.get('/stores/:id/mais-vendidos', authMiddleware, checkOwner, async (req, res) => {
    try {
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
        const [result] = await db.query(sql, [req.storeId]);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});







// ===============================
// FINANCEIRO DA LOJA
// ===============================
router.get('/stores/:id/financeiro', authMiddleware, checkOwner, async (req, res) => {
    try {
        const [result] = await db.query(
            "SELECT DATE(created_at) as data, SUM(total_final) as total FROM pedidos WHERE loja_id = ? AND status = 'finalizado' GROUP BY DATE(created_at) ORDER BY data ASC",
            [req.storeId]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// ===============================
// CLIENTES DA LOJA
// ===============================
router.get('/stores/:id/clientes', authMiddleware, checkOwner, async (req, res) => {
    try {
        const [result] = await db.query(
            "SELECT u.id, u.nome, COUNT(p.id) as total_pedidos FROM pedidos p JOIN users u ON u.id = p.user_id WHERE p.loja_id = ? GROUP BY u.id, u.nome ORDER BY total_pedidos DESC",
            [req.storeId]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// ===============================
// MINHAS LOJAS (FUNCIONÁRIO)
// ===============================
router.get("/funcionario/minhas-lojas", authMiddleware, async (req, res) => {
    try {
        // Nota: Apenas funcionários devem ter acesso a essa rota
        if (req.user.tipo !== 'funcionario') return res.status(403).json({ message: "Acesso negado" });

        const sql = `
            SELECT s.id, s.nome, s.categoria, s.imagem,
            (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS total_produtos,
            (SELECT COUNT(*) FROM pedidos pe WHERE pe.loja_id = s.id) AS total_pedidos,
            COALESCE((SELECT SUM(pe.total) FROM pedidos pe WHERE pe.loja_id = s.id AND pe.status = 'finalizado' AND DATE(pe.created_at) = CURDATE()), 0) AS faturamento,
            CASE 
                WHEN s.horario_abertura IS NULL OR s.horario_fechamento IS NULL THEN 0
                WHEN s.horario_abertura < s.horario_fechamento THEN (CASE WHEN CURTIME() BETWEEN s.horario_abertura AND s.horario_fechamento THEN 1 ELSE 0 END)
                ELSE (CASE WHEN CURTIME() >= s.horario_abertura OR CURTIME() < s.horario_fechamento THEN 1 ELSE 0 END)
            END AS aberta
            FROM stores s WHERE s.funcionario_id = ? ORDER BY s.id DESC
        `;
        const [result] = await db.query(sql, [req.user.id]);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// ===============================
// DASHBOARD DA LOJA (FUNCIONÁRIO)
// ===============================
router.get("/funcionario/loja-dashboard/:id", authMiddleware, async (req, res) => {
    try {
        const lojaId = Number(req.params.id);
        if (!Number.isInteger(lojaId)) return res.status(400).json({ message: "ID inválido" });

        const sql = `
            SELECT s.id, s.nome,
            COALESCE((SELECT SUM(total_final) FROM pedidos WHERE loja_id = s.id AND status = 'finalizado' AND DATE(created_at) = CURDATE()), 0) AS faturamentoHoje,
            COALESCE((SELECT SUM(total_final) FROM pedidos WHERE loja_id = s.id AND status = 'finalizado' AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())), 0) AS faturamentoMes,
            COALESCE((SELECT SUM(total_final) FROM pedidos WHERE loja_id = s.id AND status = 'finalizado' AND YEAR(created_at) = YEAR(CURDATE())), 0) AS faturamentoAno,
            COALESCE((SELECT COUNT(*) FROM products WHERE store_id = s.id), 0) AS total_produtos,
            COALESCE((SELECT COUNT(*) FROM pedidos WHERE loja_id = s.id), 0) AS total_pedidos
            FROM stores s WHERE s.id = ? AND s.funcionario_id = ? LIMIT 1
        `;
        const [result] = await db.query(sql, [lojaId, req.user.id]);
        
        if (result.length === 0) return res.status(404).json({ message: "Loja não encontrada ou sem permissão" });
        
        res.json(result[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});






// ===============================
// TOP LOJAS (FUNCIONÁRIO)
// ===============================
router.get("/funcionario/top-lojas", authMiddleware, async (req, res) => {
    try {
        const [result] = await db.query(`
            SELECT s.id, s.nome, s.categoria,
            COALESCE(SUM(CASE WHEN p.status = 'finalizado' AND DATE(p.created_at) = CURDATE() THEN p.total_final ELSE 0 END), 0) AS faturamentoHoje,
            COUNT(DISTINCT CASE WHEN DATE(p.created_at) = CURDATE() THEN p.id END) AS pedidosHoje
            FROM stores s
            LEFT JOIN pedidos p ON p.loja_id = s.id
            GROUP BY s.id ORDER BY faturamentoHoje DESC
        `);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// ===============================
// RESUMO (FUNCIONÁRIO)
// ===============================
router.get("/funcionario/resumo", authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT COUNT(*) AS totalLojas,
            (SELECT COUNT(*) FROM products p JOIN stores s ON s.id = p.store_id WHERE s.funcionario_id = ?) AS totalProdutos
            FROM stores WHERE funcionario_id = ?`, 
            [req.user.id, req.user.id]
        );
        
        const dados = rows[0];
        const meta = 50;
        const crescimento = Math.min(((dados.totalLojas / meta) * 100), 100);

        res.json({
            totalLojas: dados.totalLojas,
            ganhos: dados.totalLojas * 40,
            totalProdutos: dados.totalProdutos,
            crescimento: crescimento.toFixed(0)
        });
    } catch (err) {
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// ===============================
// CADASTRAR AVALIAÇÃO (TRANSACIONAL)
// ===============================
router.post("/avaliacao", authMiddleware, async (req, res) => {
    try {
        const { pedido_id, loja_id, nota, comentario } = req.body;
        if (!Number.isInteger(Number(nota)) || nota < 1 || nota > 5) return res.status(400).json({ error: "Nota inválida" });

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            const [pedido] = await connection.query("SELECT avaliado FROM pedidos WHERE id = ?", [pedido_id]);
            if (pedido.length === 0) throw new Error("Pedido não encontrado");
            if (pedido[0].avaliado === 1) throw new Error("Pedido já foi avaliado");

            await connection.query(
                "INSERT INTO avaliacoes (pedido_id, cliente_id, loja_id, nota, comentario) VALUES (?, ?, ?, ?, ?)",
                [pedido_id, req.user.id, loja_id, nota, comentario]
            );

            await connection.query("UPDATE pedidos SET avaliado = 1 WHERE id = ?", [pedido_id]);

            await connection.commit();
            res.json({ message: "Avaliação salva" });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        res.status(400).json({ error: err.message || "Erro ao processar avaliação" });
    }
});

// ===============================
// VERIFICAR AVALIAÇÃO
// ===============================
router.get("/avaliacao/verificar/:pedidoId", authMiddleware, async (req, res) => {
    try {
        const [result] = await db.query("SELECT id FROM avaliacoes WHERE pedido_id = ? LIMIT 1", [req.params.pedidoId]);
        res.json({ avaliado: result.length > 0 });
    } catch (err) {
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// ===============================
// MÉDIA DE AVALIAÇÕES DA LOJA
// ===============================
router.get("/stores/:id/avaliacoes", async (req, res) => {
    try {
        const lojaId = Number(req.params.id);
        if (!Number.isInteger(lojaId)) return res.status(400).json({ message: "ID inválido" });

        const [result] = await db.query("SELECT ROUND(AVG(nota), 1) AS media, COUNT(*) AS total FROM avaliacoes WHERE loja_id = ?", [lojaId]);
        res.json({
            media: result[0].media || 0,
            total: result[0].total || 0
        });
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar avaliações" });
    }
});


// ===============================
// COMENTÁRIOS DA LOJA
// ===============================
router.get("/stores/:id/comentarios", async (req, res) => {
    try {
        const lojaId = Number(req.params.id);
        if (!Number.isInteger(lojaId)) return res.status(400).json({ message: "ID inválido" });

        const [result] = await db.query(`
            SELECT a.id, a.nota, a.comentario, a.created_at, a.resposta_loja, a.resposta_data, u.username
            FROM avaliacoes a
            JOIN users u ON u.id = a.cliente_id
            WHERE a.loja_id = ?
            ORDER BY a.created_at DESC`, [lojaId]);

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar comentários" });
    }
});

// ===============================
// RESPONDER AVALIAÇÃO
// ===============================
router.post("/avaliacoes/:id/responder", authMiddleware, async (req, res) => {
    try {
        const avaliacaoId = req.params.id;
        const { resposta } = req.body;
        const userId = req.user.id;

        const [result] = await db.query(`
            SELECT a.id, a.resposta_loja, s.user_id AS loja_lojista_id
            FROM avaliacoes a
            JOIN stores s ON s.id = a.loja_id
            WHERE a.id = ?`, [avaliacaoId]);

        if (result.length === 0) return res.status(404).json({ message: "Avaliação não encontrada" });

        const avaliacao = result[0];

        // Regra: Lojista dono da loja ou Funcionário
        if (req.user.tipo !== 'funcionario' && avaliacao.loja_lojista_id !== userId) {
            return res.status(403).json({ message: "Sem permissão." });
        }

        if (avaliacao.resposta_loja) return res.status(400).json({ message: "Comentário já respondido" });

        await db.query(
            "UPDATE avaliacoes SET resposta_loja = ?, resposta_data = NOW() WHERE id = ?",
            [resposta, avaliacaoId]
        );

        res.json({ message: "Resposta enviada" });
    } catch (err) {
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

// ===============================
// FAVORITAR LOJA (Toggle)
// ===============================
router.post("/stores/:id/favoritar", authMiddleware, async (req, res) => {
    try {
        const lojaId = Number(req.params.id);
        if (!Number.isInteger(lojaId)) return res.status(400).json({ message: "ID inválido" });

        const [favorito] = await db.query(
            "SELECT id FROM lojas_favoritas WHERE usuario_id = ? AND loja_id = ?", 
            [req.user.id, lojaId]
        );

        if (favorito.length > 0) {
            await db.query("DELETE FROM lojas_favoritas WHERE usuario_id = ? AND loja_id = ?", [req.user.id, lojaId]);
            return res.json({ favorito: false });
        }

        await db.query("INSERT INTO lojas_favoritas (usuario_id, loja_id) VALUES (?, ?)", [req.user.id, lojaId]);
        res.json({ favorito: true });
    } catch (err) {
        res.status(500).json({ erro: "Erro interno" });
    }
});

// ===============================
// VERIFICAR SE É FAVORITO
// ===============================
router.get("/stores/:id/favorito", authMiddleware, async (req, res) => {
    try {
        const lojaId = Number(req.params.id);
        if (!Number.isInteger(lojaId)) return res.status(400).json({ message: "ID inválido" });

        const [resultado] = await db.query(
            "SELECT id FROM lojas_favoritas WHERE usuario_id = ? AND loja_id = ?", 
            [req.user.id, lojaId]
        );

        res.json({ favorito: resultado.length > 0 });
    } catch (err) {
        res.status(500).json({ erro: "Erro interno" });
    }
});



// ===============================
// TOTAL DE FAVORITOS DA LOJA
// ===============================
router.get("/stores/:id/total-favoritos", async (req, res) => {
    try {
        const lojaId = Number(req.params.id);
        if (!Number.isInteger(lojaId)) return res.status(400).json({ message: "ID inválido" });

        const [resultado] = await db.query(
            "SELECT COUNT(*) AS total FROM lojas_favoritas WHERE loja_id = ?",
            [lojaId]
        );
        res.json(resultado[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// ===============================
// MINHAS LOJAS FAVORITAS
// ===============================
router.get("/stores/favoritos/minhas", authMiddleware, async (req, res) => {
    try {
        const [lojas] = await db.query(
            `SELECT s.* FROM stores s 
             INNER JOIN lojas_favoritas lf ON lf.loja_id = s.id 
             WHERE lf.usuario_id = ? ORDER BY lf.criado_em DESC`,
            [req.user.id]
        );
        res.json(lojas);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// ===============================
// QUANTIDADE DE FAVORITOS DO USUÁRIO
// ===============================
router.get("/favoritos/quantidade", authMiddleware, async (req, res) => {
    try {
        const [resultado] = await db.query(
            "SELECT COUNT(*) AS total FROM lojas_favoritas WHERE usuario_id = ?",
            [req.user.id]
        );
        res.json({ total: resultado[0].total });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// ===============================
// CONFIGURAÇÕES DE DESCONTO DA LOJA
// ===============================

// 1. Rota para buscar as configurações atuais (para preencher o formulário no front)
router.get('/stores/:id/desconto-config', authMiddleware, checkOwner, async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT desconto_ativo, valor_minimo_compra, tipo_desconto, valor_desconto FROM stores WHERE id = ?", 
            [req.storeId]
        );
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ message: "Erro ao buscar configurações de desconto" });
    }
});

// 2. Rota para o lojista SALVAR as novas configurações
router.put('/stores/:id/desconto-config', authMiddleware, checkOwner, async (req, res) => {
    try {
        const { desconto_ativo, valor_minimo_compra, tipo_desconto, valor_desconto } = req.body;

        await db.query(
            `UPDATE stores 
             SET desconto_ativo = ?, valor_minimo_compra = ?, tipo_desconto = ?, valor_desconto = ? 
             WHERE id = ?`,
            [desconto_ativo ? 1 : 0, valor_minimo_compra, tipo_desconto, valor_desconto, req.storeId]
        );

        res.json({ message: "Configurações de desconto atualizadas com sucesso!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro ao salvar configurações" });
    }
});

// Rota pública para usuários logados (qualquer um pode consultar o desconto de uma loja)
router.get('/stores/:id/public/desconto-config', authMiddleware, async (req, res) => {
    try {
        const storeId = parseInt(req.params.id);
        if (isNaN(storeId)) return res.status(400).json({ message: "ID inválido" });

        const [rows] = await db.query(
            "SELECT desconto_ativo, valor_minimo_compra, tipo_desconto, valor_desconto FROM stores WHERE id = ?", 
            [storeId]
        );
        
        if (rows.length === 0) return res.status(404).json({ message: "Loja não encontrada" });
        
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ message: "Erro ao buscar configurações de desconto" });
    }
});

module.exports = router;