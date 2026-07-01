require('dotenv').config();
const express = require('express');
const app = express();
const db = require("./config/db");

const helmet = require('helmet');
const cors = require('cors');

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);

const allowedOrigins = [
    "http://localhost:5173",
  "https://vandoraapp.netlify.app" // SUBSTITUA PELA SUA URL REAL DO NETLIFY
];

app.use(cors({
  origin: function (origin, callback) {
    // Permite requisições sem origem (como ferramentas de postman ou mobile)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Bloqueado pelo CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

//app.use('/uploads', express.static('uploads'));

// ROTAS
const userRoutes = require('./routes/userRoutes');
const storeRoutes = require('./routes/storeRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const pedidoRoutes = require("./routes/pedidoRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const chatRoutes = require("./routes/chatRoutes");
const adminRoutes = require("./routes/adminRoutes");
const bannerRoutes = require('./routes/bannerRoutes');

const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests
    message: "Muitas requisições, tente novamente mais tarde"
});


//app.use(limiter);
app.use('/api', userRoutes);
app.use('/api', storeRoutes);
app.use('/api', productRoutes);
app.use('/api', cartRoutes);
app.use('/api', categoryRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', notificationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api', adminRoutes);
app.use('/api', bannerRoutes);

app.get('/', (req, res) => {
    res.send("Servidor funcionando!");
});

// HTTP + SOCKET
const http = require("http");
const server = http.createServer(app);

const { Server } = require("socket.io");

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

// 🔥 IMPORTANTE: registrar IO no utils PRIMEIRO
const socketUtil = require("./utils/socket");
socketUtil.setIo(io);

// SOCKET CONNECTION
io.on("connection", (socket) => {
    console.log("Cliente conectado:", socket.id);

    // Mantenha o join_loja assim:
    socket.on("join_loja", async (userId) => {
        // Buscamos a loja atrelada ao usuário
        db.query("SELECT id FROM stores WHERE user_id = ?", [userId], (err, result) => {
            if (err || result.length === 0) return;
            
            const lojaId = result[0].id;
            socket.join(`loja_${lojaId}`);
            console.log(`✅ Socket ${socket.id} entrou na sala: loja_${lojaId}`);
        });
    });

    // 🔥 ADICIONE ESTE NOVO BLOCO PARA O USUÁRIO COMUM
    socket.on("join", (room) => {
        socket.join(room); // Ex: user_123
        console.log(`✅ Usuário entrou na sala: ${room}`);
    });

    socket.on("disconnect", () => {
        console.log("Cliente saiu:", socket.id);
    });
    
    socket.on("join_loja_direto", (nomeDaSala) => {
    socket.join(nomeDaSala);
    console.log(`✅ O painel entrou na sala exata: ${nomeDaSala}`);
});

    socket.on("join_chat", (chatId) => {
    socket.join(`chat_${chatId}`);
    console.log(`✅ Usuário entrou na sala do chat: chat_${chatId}`);
});


});
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});