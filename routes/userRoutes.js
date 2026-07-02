const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middlewares/authMiddleware');
const bcrypt = require("bcrypt");
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// IMPORTAÇÃO CORRETA (Sem chaves, pois seu arquivo exporta a instância diretamente)
const uploadPerfil = require('../middlewares/uploadPerfil'); 

const { loginLimiter, registerLimiter } = require("../middlewares/rateLimiter");
const SECRET = process.env.JWT_SECRET;
// ===============================
// CRIAR USUÁRIO TEMOS NO BANCO enum('cliente','lojista','funcionario','admin')
// ===============================
router.post('/users', registerLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Usuário e senha são obrigatórios." });

        const usernameLimpo = username.trim();
        if (usernameLimpo.length < 4 || password.trim().length < 6) {
            return res.status(400).json({ error: "Dados inválidos: min 4 caracteres para usuário e 6 para senha." });
        }

        const [exists] = await db.query("SELECT id FROM users WHERE username = ?", [usernameLimpo]);
        if (exists.length > 0) return res.status(409).json({ error: "Este usuário já existe." });

        const senhaHash = await bcrypt.hash(password.trim(), 10);
        await db.query("INSERT INTO users (username, password, tipo) VALUES (?, ?, 'cliente')", [usernameLimpo, senhaHash]);

        res.json({ message: "Conta criada com sucesso!" });
    } catch (error) {
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// ===============================
// LOGIN
// ===============================
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const [users] = await db.query(`
            SELECT u.*, s.id AS loja_id FROM users u 
            LEFT JOIN stores s ON s.user_id = u.id 
            WHERE u.username = ? LIMIT 1`, [username]);

        if (users.length === 0) return res.status(401).json({ error: "Usuário ou senha inválidos" });

        const user = users[0];
        const isBcrypt = user.password.startsWith("$2a$") || user.password.startsWith("$2b$") || user.password.startsWith("$2y$");
        const senhaCorreta = isBcrypt ? await bcrypt.compare(password, user.password) : (password === user.password);

        if (!senhaCorreta) return res.status(401).json({ error: "Usuário ou senha inválidos" });

        const token = jwt.sign({ id: user.id, tipo: user.tipo }, SECRET, { expiresIn: "23h" });

        res.json({
            message: "Login feito com sucesso!",
            token,
            user: { id: user.id, username: user.username, tipo: user.tipo, loja_id: user.loja_id || null }
        });
    } catch (err) {
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// ===============================
// ATUALIZAR USUÁRIO (Dinâmico)
// ===============================
router.put('/users/:id', authMiddleware, async (req, res) => {
    try {
        if (Number(req.params.id) !== Number(req.user.id)) return res.status(403).json({ error: "Sem permissão" });

        const { username, nome_completo, email, telefone, data_nascimento, cpf_cnpj, password, imagem_perfil } = req.body;
        
        const updates = [];
        const values = [];

        if (username) { updates.push("username = ?"); values.push(username.trim()); }
        if (nome_completo !== undefined) { updates.push("nome_completo = ?"); values.push(nome_completo); }
        if (email !== undefined) { updates.push("email = ?"); values.push(email); }
        if (telefone !== undefined) { updates.push("telefone = ?"); values.push(telefone); }
        if (data_nascimento !== undefined) { updates.push("data_nascimento = ?"); values.push(data_nascimento || null); }
        if (cpf_cnpj !== undefined) { updates.push("cpf_cnpj = ?"); values.push(cpf_cnpj); }
        
        // AQUI A MUDANÇA: Recebemos a URL do ImgBB como string normal
        if (imagem_perfil) {
            updates.push("imagem_perfil = ?");
            values.push(imagem_perfil); // Salva a URL diretamente no banco
        }

        if (password) {
            updates.push("password = ?");
            values.push(await bcrypt.hash(password, 10));
        }

        if (updates.length === 0) return res.status(400).json({ error: "Nada para atualizar" });

        values.push(req.params.id);
        await db.query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values);

        res.json({ message: "Usuário atualizado com sucesso" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao atualizar" });
    }
});




// ===============================
// PERFIL DO CLIENTE
// ===============================
router.get('/client-profile', authMiddleware, async (req, res) => {
    try {
        const [result] = await db.query(`
            SELECT u.id, u.username, u.imagem_perfil, u.created_at, 
                   u.nome_completo, u.email, u.telefone, u.data_nascimento, u.cpf_cnpj,
                   COUNT(p.id) AS total_compras
            FROM users u
            LEFT JOIN pedidos p ON p.usuario_id = u.id
            WHERE u.id = ? GROUP BY u.id`, [req.user.id]);

        if (result.length === 0) return res.status(404).json({ error: "Usuário não encontrado" });
        
        res.json(result[0]);
    } catch (err) {
        console.error(err); // Dica: sempre logue o erro no console do servidor
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

router.get("/perfil-cliente/:id", async (req, res) => {
    try {
        const [result] = await db.query("SELECT id, username, imagem_perfil, created_at FROM users WHERE id = ?", [req.params.id]);
        if (result.length === 0) return res.status(404).json({ message: "Usuário não encontrado" });
        res.json(result[0]);
    } catch (err) {
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

router.get("/perfil-cliente/:id/pedidos", async (req, res) => {
    try {
        const [result] = await db.query("SELECT id FROM pedidos WHERE usuario_id = ?", [req.params.id]);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// ===============================
// PERFIL LOGADO E COMPLETO
// ===============================
router.get('/perfil', authMiddleware, (req, res) => res.json({ message: "Você está logado!", user: req.user }));

router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const [result] = await db.query(`
            SELECT u.id, u.username, s.nome AS nomeLoja, s.categoria, s.imagem
            FROM users u LEFT JOIN stores s ON u.id = s.user_id
            WHERE u.id = ? LIMIT 1`, [req.user.id]);
        res.json(result[0] || {});
    } catch (err) {
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// ===============================
// ATUALIZAR PERFIL + LOJA (Com Transação)
// ===============================
router.put('/update-profile', authMiddleware,uploadPerfil.single('imagem'), async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const { username, nomeLoja, categoria } = req.body;
        const imagem = req.file ? req.file.filename : null;

        // 1. Atualiza Usuário
        await connection.query("UPDATE users SET username = ? WHERE id = ?", [username, req.user.id]);

        // 2. Verifica/Atualiza Loja
        const [loja] = await connection.query("SELECT id FROM stores WHERE user_id = ?", [req.user.id]);

        if (loja.length === 0) {
            await connection.query(
                "INSERT INTO stores (user_id, nome, categoria, imagem) VALUES (?, ?, ?, ?)",
                [req.user.id, nomeLoja, categoria, imagem]
            );
        } else {
            const updates = ["nome = ?", "categoria = ?"];
            const values = [nomeLoja, categoria];
            if (imagem) { updates.push("imagem = ?"); values.push(imagem); }
            values.push(req.user.id);
            await connection.query(`UPDATE stores SET ${updates.join(", ")} WHERE user_id = ?`, values);
        }

        await connection.commit();
        res.json({ message: "Perfil e loja atualizados com sucesso" });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: "Erro ao atualizar perfil" });
    } finally {
        connection.release();
    }
});

// ROTA PARA FAZER UPLOAD DA FOTO DO USUÁRIO PARA O IMGBB
router.post("/upload-user-photo", authMiddleware, uploadPerfil.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado" });

        const formData = new FormData();
        // Lemos o arquivo que o multer salvou e mandamos para o ImgBB
        formData.append("image", fs.createReadStream(req.file.path));

        const response = await axios.post(
            `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`, 
            formData,
            { headers: formData.getHeaders() }
        );
        
        // Remove o arquivo temporário do servidor
        fs.unlinkSync(req.file.path);
        
        // Retorna a URL para o seu Frontend
        res.json({ url: response.data.data.url });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erro ao subir imagem para o ImgBB" });
    }
});


// ROTA PARA BUSCAR DADOS DO USUÁRIO PELO ID
router.get('/users/:id', authMiddleware, async (req, res) => {
    try {
        const [users] = await db.query("SELECT id, username FROM users WHERE id = ?", [req.params.id]);
        
        if (users.length === 0) {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }
        
        res.json(users[0]);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar usuário" });
    }
});

module.exports = router;