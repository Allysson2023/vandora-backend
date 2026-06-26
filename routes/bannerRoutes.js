const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../config/db');
const authMiddleware = require("../middlewares/authMiddleware");
const sharp = require('sharp');

// Configuração do Multer
const storage = multer.diskStorage({
  destination: './uploads/banners/',
  filename: (req, file, cb) => {
    cb(null, 'banner-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens ou vídeos MP4 são permitidos!'));
    }
  }
});

// Rota para listar APENAS os banners do funcionário logado
router.get('/banners', authMiddleware, async (req, res) => {
    try {
        const funcionario_id = req.user.id;
        const [results] = await db.query('SELECT * FROM banners WHERE funcionario_id = ?', [funcionario_id]);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar banners", details: err });
    }
});

// Rotas Públicas (Home)
router.get('/banners/imagens', async (req, res) => {
    try {
        const [results] = await db.query("SELECT * FROM banners WHERE tipo = 'imagem'");
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar imagens", details: err });
    }
});

router.get('/banners/video', async (req, res) => {
    try {
        const [results] = await db.query("SELECT * FROM banners WHERE tipo = 'video'");
        res.json(results || []);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar vídeos", details: err });
    }
});

// Rota de Cadastro
router.post('/banners', authMiddleware, upload.single('imagem'), async (req, res) => {
    const { titulo, loja_id, tipo } = req.body;
    if (!req.file) return res.status(400).json({ error: "Arquivo é obrigatório" });

    const funcionario_id = req.user.id;
    const nome_funcionario = req.user.username;

    try {
        let nomeArquivoFinal = req.file.filename;

        if (req.file.mimetype.startsWith('image/')) {
            const sharp = require('sharp');
            const caminhoDestino = path.join(__dirname, '../uploads/banners/', `resized-${req.file.filename}`);
            await sharp(req.file.path).resize(1200, 300).toFile(caminhoDestino);
            nomeArquivoFinal = `resized-${req.file.filename}`;
        }

        const sql = 'INSERT INTO banners (imagem, titulo, loja_id, funcionario_id, nome_funcionario, tipo) VALUES (?, ?, ?, ?, ?, ?)';
        await db.query(sql, [nomeArquivoFinal, titulo, loja_id, funcionario_id, nome_funcionario, tipo]);
        
        res.json({ message: "Banner/Vídeo cadastrado com sucesso!" });
    } catch (error) {
        console.error("Erro no processamento:", error);
        res.status(500).json({ error: "Erro ao salvar banner", details: error.message });
    }
});

// Rota de Deletar (SEGURA E ÚNICA)
router.delete('/banners/:id', authMiddleware, async (req, res) => {
    const fs = require('fs');
    const funcionario_id = req.user.id;
    const banner_id = req.params.id;

    try {
        const [results] = await db.query('SELECT imagem, funcionario_id FROM banners WHERE id = ?', [banner_id]);
        
        if (results.length === 0) return res.status(404).json({ error: "Banner não encontrado" });
        if (results[0].funcionario_id !== funcionario_id) {
            return res.status(403).json({ error: "Você não tem permissão" });
        }

        const nomeImagem = results[0].imagem;
        await db.query('DELETE FROM banners WHERE id = ?', [banner_id]);

        const caminhoArquivo = path.join(__dirname, '../uploads/banners/', nomeImagem);
        if (fs.existsSync(caminhoArquivo)) {
            fs.unlinkSync(caminhoArquivo);
        }

        res.json({ message: "Banner e arquivo deletados com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: "Erro ao deletar banner", details: err });
    }
});

module.exports = router;