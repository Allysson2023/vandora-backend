const mysql = require('mysql2');

// Criamos o pool em vez de uma conexão simples
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 4000,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    timezone: '-03:00', // Isso força o driver a converter as datas para -03
    waitForConnections: true,
    connectionLimit: 10, // Quantidade máxima de conexões simultâneas
    queueLimit: 0,
    connectTimeout: 20000,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

// O pool não precisa de um .connect() manual, ele cria as conexões 
// assim que a primeira query for executada.

// Exportamos o pool com o suporte a Promises (fica mais fácil usar async/await)
module.exports = pool.promise();