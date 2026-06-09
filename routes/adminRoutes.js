const express = require("express");
const router = express.Router();
const db = require("../config/db");
const bcrypt = require("bcrypt");
const authMiddleware = require("../middlewares/authMiddleware");
const adminMiddleware = require("../middlewares/adminMiddleware");

router.post("/admin/users", authMiddleware, adminMiddleware, async (req, res) => {
    // Recebe os dados exatamente como o formulário do React envia
    const { email, senha, role } = req.body;

    if (!email || !senha || !role) {
        return res.status(400).json({ message: "Usuário/E-mail, senha e tipo são obrigatórios!" });
    }

    if (!['funcionario', 'lojista'].includes(role)) {
        return res.status(400).json({ message: "Tipo de conta inválido!" });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(senha, saltRounds);

        // Ajustado para usar as colunas reais do seu banco: username, password, tipo
        const sql = `
            INSERT INTO users (username, password, tipo) 
            VALUES (?, ?, ?)
        `;

        db.query(sql, [email, passwordHash, role], (err, result) => {
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