const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({

    destination: (req, file, cb) => {

    const pasta = "uploads/produtos";

    if (!fs.existsSync(pasta)) {
        fs.mkdirSync(
            pasta,
            { recursive: true }
        );
    }

    cb(null, pasta);
},

    filename: (req, file, cb) => {

    const unique =
        Date.now() +
        "-" +
        Math.round(Math.random() * 1E9);

    cb(
        null,
        unique +
        path.extname(file.originalname)
    );
}

});

const fileFilter = (req, file, cb) => {

    const tiposPermitidos = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
    ];

    if (!tiposPermitidos.includes(file.mimetype)) {
        return cb(
            new Error("Apenas JPG, PNG e WEBP são permitidos."),
            false
        );
    }

    cb(null, true);
};

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB
        files: 3
    },
    fileFilter
});

module.exports = upload;