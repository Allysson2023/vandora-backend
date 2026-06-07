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

app.use(cors({
  origin: "http://localhost:5173",
  credentials: true
}));

app.use(express.json());

app.use('/uploads', express.static('uploads'));

// ROTAS
const userRoutes = require('./routes/userRoutes');
const storeRoutes = require('./routes/storeRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const pedidoRoutes = require("./routes/pedidoRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const chatRoutes = require("./routes/chatRoutes");

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
    console.log("USER SOCKET COUNT:", io.engine.clientsCount);
    socket.on("disconnect", () => {
    console.log("Cliente saiu:", socket.id);
});

    // usuário geral
    socket.on("join", (userId) => {
        socket.join(`user_${userId}`);
    });

    // loja geral
    socket.on("join_loja", (userId) => {

    db.query(
        "SELECT id FROM stores WHERE user_id = ?",
        [userId],
        (err, result) => {

            if (err) return;

            if (result.length > 0) {
                const lojaId = result[0].id;

                socket.join(`loja_${lojaId}`);

                console.log("Entrou na loja:", lojaId);
            }
        }
    );
});

    // chat específico (CLIENTE + LOJA)
    socket.on("entrar_chat", ({ chatId }) => {

    socket.join(`chat_${chatId}`);

    console.log(`💬 Entrou no chat: chat_${chatId}`);
});

socket.on("sair_chat", ({ chatId }) => {
    socket.leave(`chat_${chatId}`);
});

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});