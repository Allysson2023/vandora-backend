// middlewares/adminMiddleware.js
module.exports = (req, res, next) => {
    // Verifica se o authMiddleware já rodou e se o usuário é admin usando 'tipo'
    if (!req.user || req.user.tipo !== 'admin') { 
        return res.status(403).json({ error: "Acesso negado. Rota exclusiva para o administrador do sistema." });
    }
    next();
};