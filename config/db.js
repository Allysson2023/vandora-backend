const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '1122',
    database: 'marketplace'
});

connection.connect((err) => {
    if (err) {
        console.log("Erro ao conectar no MySQL:", err);
        return;
    }
    console.log("Conectadi ao MySQL!");
})

module.exports = connection;