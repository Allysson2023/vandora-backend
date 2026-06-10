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
router.get('/banners', authMiddleware, (req, res) => {
  const funcionario_id = req.user.id;
  db.query('SELECT * FROM banners WHERE funcionario_id = ?', [funcionario_id], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// Rotas Públicas (Home)
router.get('/banners/imagens', (req, res) => {
  db.query("SELECT * FROM banners WHERE tipo = 'imagem'", (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

router.get('/banners/video', (req, res) => {
  db.query("SELECT * FROM banners WHERE tipo = 'video'", (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results || []);
  });
});

// Rota de Cadastro
router.post('/banners', authMiddleware, upload.single('imagem'), async (req, res) => {
  const { titulo, link_destino, tipo } = req.body;
  if (!req.file) return res.status(400).json({ error: "Arquivo é obrigatório" });
  
  const funcionario_id = req.user.id; 
  const nome_funcionario = req.user.username;

  try {
    let nomeArquivoFinal = req.file.filename;
    const fs = require('fs');

    // SÓ processa com Sharp se for IMAGEM e existir o arquivo
    if (req.file.mimetype.startsWith('image/')) {
      const caminhoDestino = path.join(__dirname, '../uploads/banners/', `resized-${req.file.filename}`);
      
      await sharp(req.file.path)
        .resize(1200, 300)
        .toFile(caminhoDestino); // Use o caminho completo aqui
      
      nomeArquivoFinal = `resized-${req.file.filename}`;
    }

    const sql = 'INSERT INTO banners (imagem, titulo, link_destino, funcionario_id, nome_funcionario, tipo) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [nomeArquivoFinal, titulo, link_destino, funcionario_id, nome_funcionario, tipo], (err) => {
      if (err) return res.status(500).json({ error: "Erro ao salvar no banco", details: err });
      res.json({ message: "Banner/Vídeo cadastrado com sucesso!" });
    });
    
  } catch (error) {
    console.error("Erro no Sharp:", error); // ISSO VAI MOSTRAR O ERRO NO SEU TERMINAL DO VSCODE
    res.status(500).json({ error: "Erro ao processar arquivo", details: error.message });
  }
});

// Rota de Deletar (SEGURA E ÚNICA)
router.delete('/banners/:id', authMiddleware, (req, res) => {
  const fs = require('fs');
  const funcionario_id = req.user.id; 
  const banner_id = req.params.id;

  db.query('SELECT imagem, funcionario_id FROM banners WHERE id = ?', [banner_id], (err, results) => {
    if (err || results.length === 0) return res.status(404).json({ error: "Banner não encontrado" });
    
    if (results[0].funcionario_id !== funcionario_id) {
      return res.status(403).json({ error: "Você não tem permissão para excluir este banner" });
    }

    const nomeImagem = results[0].imagem;
    db.query('DELETE FROM banners WHERE id = ?', [banner_id], (err) => {
      if (err) return res.status(500).json(err);
      
      const caminhoArquivo = path.join(__dirname, '../uploads/banners/', nomeImagem);
      if (fs.existsSync(caminhoArquivo)) {
        fs.unlinkSync(caminhoArquivo);
      }
      res.json({ message: "Banner e arquivo deletados com sucesso!" });
    });
  });
});

module.exports = router;