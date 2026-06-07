const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadLojas');
const uploadPerfil = require('../middlewares/uploadPerfil');
const {
    loginLimiter,
    registerLimiter
} = require("../middlewares/rateLimiter");
const SECRET = process.env.JWT_SECRET;
const bcrypt = require("bcrypt");

// ===============================
// CRIAR USUÁRIO TEMOS NO BANCO enum('cliente','lojista','funcionario','admin')
// ===============================
router.post('/users', registerLimiter, async (req, res) => {

    try {

        const { username, password } = req.body;

        // Campos obrigatórios
        if (!username || !password) {
            return res.status(400).json({
                error: "Usuário e senha são obrigatórios."
            });
        }

        // Remove espaços extras
        const usernameLimpo = username.trim();

        // Tamanho mínimo do usuário
        if (usernameLimpo.length < 4) {
            return res.status(400).json({
                error: "O usuário deve ter pelo menos 4 caracteres."
            });
        }

        // Tamanho mínimo da senha
        if (password.length < 6) {
            return res.status(400).json({
                error: "A senha deve ter pelo menos 6 caracteres."
            });
        }

        // Verifica se já existe
        db.query(
            "SELECT id FROM users WHERE username = ?",
            [usernameLimpo],
            async (err, result) => {

                if (err) {
                    return res.status(500).json(err);
                }

                if (result.length > 0) {
                    return res.status(409).json({
                        error: "Este usuário já existe."
                    });
                }

                const senhaHash = await bcrypt.hash(password, 10);

                db.query(
                    `
                    INSERT INTO users
                    (username, password, tipo)
                    VALUES (?, ?, ?)
                    `,
                    [
                        usernameLimpo,
                        senhaHash,
                        "cliente"
                    ],
                    (err) => {

                        if (err) {
                            return res.status(500).json(err);
                        }

                        res.json({
                            message: "Conta criada com sucesso!"
                        });

                    }
                );

            }
        );

    } catch (error) {

        console.log(error);

        return res.status(500).json({
            error: "Erro interno do servidor"
        });

    }

});



// ===============================
// LOGIN (CORRIGIDO)
// ===============================
router.post('/login',loginLimiter , (req, res) => {

    const { username, password } = req.body;

    const sql = `
        SELECT
            users.id,
            users.username,
            users.password,
            users.tipo,
            stores.id AS loja_id
        FROM users
        LEFT JOIN stores
            ON stores.user_id = users.id
        WHERE users.username = ?
        LIMIT 1
    `;

    db.query(sql, [username], async (err, result) => {

        if (err) {
            console.log(err);
            return res.status(500).json(err);
        }

        if (result.length === 0) {
            return res.status(401).json({
                error: "Usuário ou senha inválidos"
            });
        }

        const user = result[0];

        let senhaCorreta = false;

        // Senha criptografada com bcrypt
        if (
            user.password.startsWith("$2a$") ||
            user.password.startsWith("$2b$") ||
            user.password.startsWith("$2y$")
        ) {

            senhaCorreta = await bcrypt.compare(
                password,
                user.password
            );

        } else {

            // Senha antiga salva em texto puro
            senhaCorreta = (
                password === user.password
            );

        }

        if (!senhaCorreta) {
            return res.status(401).json({
                error: "Usuário ou senha inválidos"
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                tipo: user.tipo
            },
            SECRET,
            {
                expiresIn: "23h"
            }
        );

        res.json({
            message: "Login feito com sucesso!",
            token,
            user: {
                id: user.id,
                username: user.username,
                tipo: user.tipo,
                loja_id: user.loja_id || null
            }
        });

    });

});


// ===============================
// LISTAR USUÁRIOS
// ===============================
router.get('/users', authMiddleware,  (req, res) => {

    db.query("SELECT * FROM users", (err, result) => {

        if (err) {
            return res.status(500).json({
    message: "Erro interno no servidor"
});
        }

        res.json(result);

    });

});

// ===============================
// BUSCAR USUÁRIO POR ID
// ===============================
router.get('/users/:id', authMiddleware, (req, res) => {

    const { id } = req.params;

    const sql = `
        SELECT
            id,
            username
        FROM users
        WHERE id = ?
        LIMIT 1
    `;

    db.query(sql, [id], (err, result) => {

        if (err) {
            return res.status(500).json(err);
        }

        if (result.length === 0) {
            return res.status(404).json({
                error: "Usuário não encontrado"
            });
        }

        res.json(result[0]);

    });

});

// ===============================
// ATUALIZAR USUÁRIO
// ===============================
router.put(
    '/users/:id',
    authMiddleware,
    uploadPerfil.single('imagem_perfil'),
    async (req, res) => {

        try {

            const userIdLogado = req.user.id;
            const { id } = req.params;

            // 🔒 segurança: só pode editar o próprio usuário
            if (Number(id) !== Number(userIdLogado)) {
                return res.status(403).json({
                    error: "Você não tem permissão para alterar este usuário"
                });
            }

            const { username, password } = req.body;

            // 📸 imagem opcional
            const imagem = req.file ? req.file.filename : null;

            // 👤 valida username
            if (!username || username.trim().length < 4) {
                return res.status(400).json({
                    error: "O usuário deve ter pelo menos 4 caracteres"
                });
            }

            let sql;
            let valores;

            // ===============================
            // CASO TENHA SENHA NOVA
            // ===============================
            if (password && password.trim()) {

                if (password.length < 6) {
                    return res.status(400).json({
                        error: "A senha deve ter pelo menos 6 caracteres"
                    });
                }

                const senhaForte = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

                if (!senhaForte.test(password)) {
                    return res.status(400).json({
                        error: "A senha deve conter letra maiúscula, minúscula e número"
                    });
                }

                const senhaHash = await bcrypt.hash(password, 10);

                // ===============================
                // COM OU SEM IMAGEM (SENHA)
                // ===============================
                if (imagem) {

                    sql = `
                        UPDATE users
                        SET username = ?, password = ?, imagem_perfil = ?
                        WHERE id = ?
                    `;

                    valores = [
                        username,
                        senhaHash,
                        imagem,
                        id
                    ];

                } else {

                    sql = `
                        UPDATE users
                        SET username = ?, password = ?
                        WHERE id = ?
                    `;

                    valores = [
                        username,
                        senhaHash,
                        id
                    ];

                }

            } else {

                // ===============================
                // SEM ALTERAR SENHA
                // ===============================
                if (imagem) {

                    sql = `
                        UPDATE users
                        SET username = ?, imagem_perfil = ?
                        WHERE id = ?
                    `;

                    valores = [
                        username,
                        imagem,
                        id
                    ];

                } else {

                    sql = `
                        UPDATE users
                        SET username = ?
                        WHERE id = ?
                    `;

                    valores = [
                        username,
                        id
                    ];

                }
            }

            // ===============================
            // EXECUTA UPDATE
            // ===============================
            db.query(sql, valores, (err) => {

                if (err) {
                    return res.status(500).json(err);
                }

                res.json({
                    message: "Usuário atualizado com sucesso"
                });

            });

        } catch (error) {

            console.log(error);

            return res.status(500).json({
                error: "Erro interno do servidor"
            });

        }

    }
);

// ===============================
// PERFIL DO CLIENTE
// ===============================
router.get('/client-profile', authMiddleware, (req, res) => {

    const userId = req.user.id;

    const sql = `
        SELECT
            u.id,
            u.username,
    u.imagem_perfil,
            u.created_at,
            COUNT(p.id) AS total_compras
        FROM users u
        LEFT JOIN pedidos p
            ON p.usuario_id = u.id
        WHERE u.id = ?
        GROUP BY u.id
    `;

    db.query(sql, [userId], (err, result) => {

        if (err) {
            return res.status(500).json(err);
        }

        if (result.length === 0) {
            return res.status(404).json({
                error: "Usuário não encontrado"
            });
        }

        res.json({
    id: result[0].id,
    username: result[0].username,
    imagem_perfil: result[0].imagem_perfil,
    created_at: result[0].created_at,
    total_compras: result[0].total_compras
});

    });

});

router.get("/perfil-cliente/:id", (req, res) => {

    const { id } = req.params;

    const sql = `
        SELECT
            id,
            username,
            imagem_perfil,
            created_at
        FROM users
        WHERE id = ?
    `;

    db.query(sql, [id], (err, result) => {

        if (err) {
            console.log(err);
            return res.status(500).json(err);
        }

        if (result.length === 0) {
            return res.status(404).json({
                message: "Usuário não encontrado"
            });
        }

        res.json(result[0]);

    });

});

router.get("/perfil-cliente/:id/pedidos", (req, res) => {

    const { id } = req.params;

    const sql = `
        SELECT id
        FROM pedidos
        WHERE usuario_id = ?
    `;

    db.query(sql, [id], (err, result) => {

        if (err) {
            console.log(err);
            return res.status(500).json(err);
        }

        res.json(result);

    });

});

// ===============================
// PERFIL LOGADO
// ===============================
router.get('/perfil', authMiddleware, (req, res) => {

    res.json({
        message: "Você está logado!",
        user: req.user
    });

});


// ===============================
// PEGAR PERFIL COMPLETO
// ===============================
router.get('/profile', authMiddleware, (req, res) => {

    const userId = req.user.id;

    const sql = `
        SELECT 
            users.id,
            users.username,
            stores.nome AS nomeLoja,
            stores.categoria,
            stores.imagem
        FROM users
        LEFT JOIN stores 
            ON users.id = stores.user_id
        WHERE users.id = ?
        LIMIT 1
    `;

    db.query(sql, [userId], (err, result) => {

        if (err) {
            return res.status(500).json(err);
        }

        res.json(result[0]);

    });

});


// ===============================
// ATUALIZAR PERFIL + LOJA
// ===============================
router.put('/update-profile', authMiddleware, upload.single('imagem'), (req, res) => {

    const userId = req.user.id;
    const { username, nomeLoja, categoria } = req.body;
    const imagem = req.file ? req.file.filename : null;

    // atualizar user
    const sqlUser = `
        UPDATE users 
        SET username = ? 
        WHERE id = ?
    `;

    db.query(sqlUser, [username, userId], (err) => {

        if (err) {
            return res.status(500).json(err);
        }

        // verificar se loja existe
        db.query(
            "SELECT id FROM stores WHERE user_id = ?",
            [userId],
            (err2, result) => {

                if (err2) {
                    return res.status(500).json(err2);
                }

                // se não existe loja, cria
                if (result.length === 0) {

                    const sqlInsert = `
                        INSERT INTO stores 
                        (user_id, nome, categoria, imagem)
                        VALUES (?, ?, ?, ?)
                    `;

                    db.query(sqlInsert, [
                        userId,
                        nomeLoja,
                        categoria,
                        imagem
                    ], (err3) => {

                        if (err3) {
                            return res.status(500).json(err3);
                        }

                        return res.json({
                            message: "Perfil e loja criados com sucesso"
                        });

                    });

                } else {

                    // atualiza loja existente
                    let sqlStore;
                    let valores;

                    if (imagem) {

                        sqlStore = `
                            UPDATE stores 
                            SET nome = ?, categoria = ?, imagem = ?
                            WHERE user_id = ?
                        `;

                        valores = [
                            nomeLoja,
                            categoria,
                            imagem,
                            userId
                        ];

                    } else {

                        sqlStore = `
                            UPDATE stores 
                            SET nome = ?, categoria = ?
                            WHERE user_id = ?
                        `;

                        valores = [
                            nomeLoja,
                            categoria,
                            userId
                        ];

                    }

                    db.query(sqlStore, valores, (err4) => {

                        if (err4) {
                            return res.status(500).json(err4);
                        }

                        res.json({
                            message: "Perfil atualizado com sucesso"
                        });

                    });

                }

            }
        );

    });

});

module.exports = router;