const express = require("express");
const router = express.Router();

const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");

router.get("/notifications", authMiddleware, (req, res) => {

    const sql = `
        SELECT *
        FROM notifications
        WHERE user_id = ?
        ORDER BY id DESC
    `;

    db.query(sql, [req.user.id], (err, result) => {

        if (err) {
            return res.status(500).json(err);
        }

        res.json(result);

    });

});

module.exports = router;