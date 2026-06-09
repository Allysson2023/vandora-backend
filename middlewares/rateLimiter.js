const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        error: "Muitas tentativas de login. Tente novamente mais tarde."
    }
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: {
        error: "Muitas tentativas de cadastro. Tente novamente mais tarde."
    }
});

module.exports = {
    loginLimiter,
    registerLimiter
};