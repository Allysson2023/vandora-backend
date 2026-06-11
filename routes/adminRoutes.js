const express = require("express");
const router = express.Router();
const db = require("../config/db");
const bcrypt = require("bcrypt");
const authMiddleware = require("../middlewares/authMiddleware");
const adminMiddleware = require("../middlewares/adminMiddleware");

router.post("/admin/users", authMiddleware, adminMiddleware, async (req, res) => {
    const { username, email, senha, role, telefone, data_nascimento } = req.body;

    // Validação básica
    if (!username || !email || !senha || !role) {
        return res.status(400).json({ message: "Usuário, E-mail, senha e tipo são obrigatórios!" });
    }

    if (!['funcionario', 'lojista'].includes(role)) {
        return res.status(400).json({ message: "Tipo de conta inválido!" });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(senha, saltRounds);

        const sql = `
            INSERT INTO users (username, password, tipo, email, telefone, data_nascimento) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        // CORREÇÃO: Usamos o await e desestruturamos o [result]
        // Não passamos mais a função (err, result) => { ... }
        await db.query(sql, [username, passwordHash, role, email, telefone, data_nascimento || null]);

        res.status(201).json({ 
            message: `${role === 'lojista' ? 'Lojista' : 'Funcionário'} criado com sucesso!` 
        });

    } catch (error) {
        console.error("Erro ao criar conta administrativa:", error);
        
        // Tratamento específico de erro de duplicidade
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: "Este usuário/e-mail já está cadastrado!" });
        }
        
        return res.status(500).json({ error: "Erro interno do servidor" });
    }
});

module.exports = router;