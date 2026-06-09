const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../config/db');
const authMiddleware = require("../middlewares/authMiddleware");
const sharp = require('sharp'); // Importe no topo

// Configuração do Multer para Banners
const storage = multer.diskStorage({
  destination: './uploads/banners/',
  filename: (req, file, cb) => {
    cb(null, 'banner-' + Date.now() + path.extname(file.originalname));
  }
});

// Ajuste no seu upload do multer no backend:
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    // Aceita imagens OU vídeos mp4
    if (file.mimetype.startsWith('image/') || file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens ou vídeos MP4 são permitidos!'));
    }
  }
});

// Rota para listar (pode acessar sem estar logado)
router.get('/banners', (req, res) => {
  db.query('SELECT * FROM banners', (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// Adicione esta rota no seu backend para que o Home.jsx consiga buscar apenas as imagens
router.get('/banners/imagens', (req, res) => {
  db.query("SELECT * FROM banners WHERE tipo = 'imagem'", (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});


// Rota para o vídeo destaque
router.get('/banners/video', (req, res) => {
  // Removi o LIMIT 1 para vir a lista completa
  db.query("SELECT * FROM banners WHERE tipo = 'video'", (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results || []); // Retorna o array ou um array vazio
  });
});

router.post('/banners', authMiddleware, upload.single('imagem'), async (req, res) => {
  const { titulo, link_destino, tipo } = req.body; // Recebe o 'tipo' do front
  if (!req.file) return res.status(400).json({ error: "Arquivo é obrigatório" });
  
  const funcionario_id = req.user.id; 
  const nome_funcionario = req.user.username;

  try {
    let nomeArquivoFinal = req.file.filename;

    // SÓ processa com Sharp se for IMAGEM
    if (req.file.mimetype.startsWith('image/')) {
      nomeArquivoFinal = `resized-${req.file.filename}`;
      const fs = require('fs');
      
      await sharp(req.file.path)
        .resize(1200, 300)
        .toFile(`./uploads/banners/${nomeArquivoFinal}`);
      
      fs.unlinkSync(req.file.path); // Apaga o original não redimensionado
    }
    // Se for vídeo, ele mantém o arquivo original intacto na pasta

    // SALVA NO BANCO (Incluindo a coluna 'tipo')
    const sql = 'INSERT INTO banners (imagem, titulo, link_destino, funcionario_id, nome_funcionario, tipo) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [nomeArquivoFinal, titulo, link_destino, funcionario_id, nome_funcionario, tipo], (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Banner/Vídeo cadastrado com sucesso!" });
    });
    
  } catch (error) {
    res.status(500).json({ error: "Erro ao processar arquivo", details: error });
  }
});

// Rota para deletar
router.delete('/banners/:id', authMiddleware, (req, res) => {
  const fs = require('fs');
  
  // 1. Busca o nome do arquivo antes de deletar o registro
  db.query('SELECT imagem FROM banners WHERE id = ?', [req.params.id], (err, results) => {
    if (err || results.length === 0) return res.status(404).json({ error: "Banner não encontrado" });

    const nomeImagem = results[0].imagem;
    
    // 2. Deleta o registro no banco
    db.query('DELETE FROM banners WHERE id = ?', [req.params.id], (err) => {
      if (err) return res.status(500).json(err);
      
      // 3. Deleta o arquivo da pasta
      const caminhoArquivo = path.join(__dirname, '../uploads/banners/', nomeImagem);
      if (fs.existsSync(caminhoArquivo)) {
        fs.unlinkSync(caminhoArquivo);
      }
      
      res.json({ message: "Banner e arquivo deletados com sucesso!" });
    });
  });
});

module.exports = router;