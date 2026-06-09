const express = require("express");
const router = express.Router();
const db = require("../config/db");
const bcrypt = require("bcrypt");
const authMiddleware = require("../middlewares/authMiddleware");
const adminMiddleware = require("../middlewares/adminMiddleware");

router.post("/admin/users", authMiddleware, adminMiddleware, async (req, res) => {
    // 1. Adicionamos os novos campos na desestruturação
    const { username, email, senha, role, telefone, data_nascimento } = req.body;

    // 2. Atualizamos a validação dos campos obrigatórios (ajuste conforme sua necessidade)
    if (!username || !email || !senha || !role) {
        return res.status(400).json({ message: "Usuário, E-mail, senha e tipo são obrigatórios!" });
    }

    if (!['funcionario', 'lojista'].includes(role)) {
        return res.status(400).json({ message: "Tipo de conta inválido!" });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(senha, saltRounds);

        // 3. Atualizamos o SQL para incluir as novas colunas
        const sql = `
            INSERT INTO users (username, password, tipo, email, telefone, data_nascimento) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        // 4. Incluímos as variáveis no array de parâmetros
        // Nota: se telefone ou data_nascimento não forem obrigatórios, 
        // eles podem vir como null ou undefined do front-end.
        db.query(sql, [username, passwordHash, role, email, telefone, data_nascimento || null], (err, result) => {
            if (err) {
                console.error("Erro ao criar conta administrativa:", err);
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ message: "Este usuário/e-mail já está cadastrado!" });
                }
                return res.status(500).json({ error: "Erro interno ao processar cadastro no banco" });
            }

            res.status(201).json({ 
                message: `${role === 'lojista' ? 'Lojista' : 'Funcionário'} criado com sucesso!` 
            });
        });

    } catch (error) {
        console.error("Erro no servidor:", error);
        return res.status(500).json({ error: "Erro interno do servidor" });
    }
});

module.exports = router;