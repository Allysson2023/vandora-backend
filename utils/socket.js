let io;

function setIo(serverIo) {
    io = serverIo;
}

function getIo() {
    return io;
}

module.exports = { setIo, getIo };