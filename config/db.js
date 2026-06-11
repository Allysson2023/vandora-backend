const mysql = require('mysql2');

// Criamos o pool em vez de uma conexão simples
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10, // Quantidade máxima de conexões simultâneas
    queueLimit: 0
});

// O pool não precisa de um .connect() manual, ele cria as conexões 
// assim que a primeira query for executada.

// Exportamos o pool com o suporte a Promises (fica mais fácil usar async/await)
module.exports = pool.promise();