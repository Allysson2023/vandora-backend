const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

connection.connect((err) => {
    if (err) {
        console.log("Erro ao conectar no MySQL:", err);
        return;
    }

    console.log("Conectado ao MySQL!");
});

module.exports = connection;