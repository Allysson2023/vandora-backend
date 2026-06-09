const express = require("express");
const router = express.Router();

const db = require("../config/db");
const authMiddleware = require("../middlewares/authMiddleware");
const { getIo } = require("../utils/socket");


function checkStoreOwner(req, res, next) {
    // Garantimos que o ID da loja vindo da URL seja tratado corretamente
    const lojaId = req.params.lojaId;

    const sql = `
        SELECT id
        FROM stores
        WHERE id = ?
        AND user_id = ?
        LIMIT 1
    `;

    db.query(
        sql,
        [lojaId, req.user.id],
        (err, result) => {
            if (err) {
                // Logamos o erro real no console do servidor para você depurar
                console.error("Erro no checkStoreOwner:", err);
                // Retornamos uma mensagem segura para o cliente externo
                return res.status(500).json({ error: "Erro interno no servidor" });
            }

            if (result.length === 0) {
                return res.status(403).json({
                    message: "Acesso negado"
                });
            }

            // Se achou a loja e o dono bate com o usuário logado, prossegue
            next();
        }
    );
}

function checkChatAccess(req, res, next) {
    const { chatId } = req.params;

    const sql = `
        SELECT 
            c.id,
            c.cliente_id,
            c.loja_id,
            s.user_id AS dono_loja
        FROM chats c
        INNER JOIN stores s ON s.id = c.loja_id
        WHERE c.id = ?
        LIMIT 1
    `;

    db.query(sql, [chatId], (err, result) => {
        if (err) {
            // O erro real fica salvo apenas nos logs do seu servidor local
            console.error("Erro no checkChatAccess:", err);
            return res.status(500).json({ error: "Erro interno no servidor" });
        }

        if (result.length === 0) {
            return res.status(404).json({
                message: "Chat não encontrado"
            });
        }

        const chat = result[0];

        // Garantimos que a comparação seja feita estritamente como números válidos
        const userId = Number(req.user.id);
        const chatClienteId = Number(chat.cliente_id);
        const chatDonoLoja = Number(chat.dono_loja);

        const isCliente = chatClienteId === userId;
        const isLojaOwner = chatDonoLoja === userId;

        // 🔥 BLOQUEIO TOTAL CONTRA INVASORES
        if (!isCliente && !isLojaOwner) {
            return res.status(403).json({
                message: "Você não tem acesso a esse chat"
            });
        }

        // 🔥 IMPORTANTE: salva os dados tratados no req para usar direto nos controllers
        req.chat = {
            id: chat.id,
            cliente_id: chatClienteId,
            loja_id: chat.loja_id,
            dono_loja: chatDonoLoja
        };

        next();
    });
}


function checkChatMessageAccess(req, res, next) {
    const { chat_id } = req.body;

    // Garante que o usuário está autenticado
    if (!req.user) {
        return res.status(401).json({
            message: "Precisa estar logado"
        });
    }

    // Se NÃO foi enviado chat_id no corpo da requisição, significa que é o início de um chat novo. 
    // Portanto, permitimos avançar para que a rota crie o chat.
    if (!chat_id) {
        return next();
    }

    const sql = `
        SELECT c.*, s.user_id as dono_loja
        FROM chats c
        INNER JOIN stores s ON s.id = c.loja_id
        WHERE c.id = ?
        LIMIT 1
    `;

    db.query(sql, [chat_id], (err, result) => {
        if (err) {
            console.error("Erro no checkChatMessageAccess:", err);
            return res.status(500).json({ error: "Erro interno no servidor" });
        }

        // SE O CHAT_ID FOI ENVIADO, MAS NÃO EXISTE NO BANCO:
        // Bloqueamos aqui com 404 para evitar falhas de chave estrangeira (Foreign Key Error) adiante.
        if (result.length === 0) {
            return res.status(404).json({
                message: "Chat não encontrado"
            });
        }

        const chat = result[0];

        const usuarioEhCliente = Number(chat.cliente_id) === Number(req.user.id);
        const usuarioEhDonoLoja = Number(chat.dono_loja) === Number(req.user.id);

        // 🔥 TRAVA DE SEGURANÇA: Se o usuário logado não for nem o cliente do chat e nem o dono da loja, barramos o invasor.
        if (!usuarioEhCliente && !usuarioEhDonoLoja) {
            return res.status(403).json({
                message: "Acesso negado"
            });
        }

        // Tudo correto, avança para o controller da rota
        next();
    });
}

router.get("/cliente", authMiddleware, (req, res) => {
    // Pegamos o ID diretamente do token verificado (Garante 100% de isolamento)
    const clienteId = req.user.id;

    const sql = `
        SELECT 
            c.id AS chatId,
            c.loja_id,
            c.atualizado_em,
            (
                SELECT mensagem
                FROM mensagens m
                WHERE m.chat_id = c.id
                ORDER BY m.id DESC
                LIMIT 1
            ) AS ultimaMensagem,
            l.nome AS nomeLoja
        FROM chats c
        INNER JOIN stores l ON l.id = c.loja_id
        WHERE c.cliente_id = ?
        ORDER BY c.atualizado_em DESC
    `;

    db.query(sql, [clienteId], (err, result) => {
        if (err) {
            // Registra a falha no console de forma destacada para o desenvolvedor
            console.error("Erro ao listar chats do cliente:", err);
            // Mensagem limpa e segura contra engenharia reversa de hackers
            return res.status(500).json({ error: "Erro interno ao buscar conversas" });
        }

        // Retorna a lista de chats perfeitamente estruturada
        res.json(result);
    });
});


router.get("/loja/:lojaId", authMiddleware, checkStoreOwner, (req, res) => {
    const { lojaId } = req.params;

    const sql = `
        SELECT
            c.id,
            c.pedido_id,
            c.cliente_id,
            c.loja_id,
            c.criado_em,
            c.atualizado_em,
            c.tem_nova_msg,
            u.username AS cliente_nome,
            (
                SELECT mensagem
                FROM mensagens m
                WHERE m.chat_id = c.id
                ORDER BY m.id DESC
                LIMIT 1
            ) as ultima_mensagem
        FROM chats c
        INNER JOIN users u ON u.id = c.cliente_id
        WHERE c.loja_id = ?
        ORDER BY c.atualizado_em DESC
    `;

    db.query(sql, [lojaId], (err, result) => {
        if (err) {
            // Log detalhado para o ambiente de desenvolvimento
            console.error("Erro ao listar chats da loja:", err);
            // Resposta padronizada e segura para o cliente externo
            return res.status(500).json({ error: "Erro interno ao buscar o inbox da loja" });
        }

        // Retorna os chats com o nome do cliente e a última mensagem atualizada
        res.json(result);
    });
});



// ==========================================
// DADOS DO CHAT (DADOS DE CABEÇALHO/METADADOS)
// ==========================================
router.get("/:chatId", authMiddleware, checkChatAccess, (req, res) => {
    const { chatId } = req.params;

    const sql = `
        SELECT
            c.*,
            s.nome AS loja_nome
        FROM chats c
        INNER JOIN stores s ON s.id = c.loja_id
        WHERE c.id = ?
        LIMIT 1
    `;

    db.query(sql, [chatId], (err, result) => {
        if (err) {
            console.error("Erro ao buscar dados do chat:", err);
            return res.status(500).json({ error: "Erro interno ao buscar dados do chat" });
        }

        // Como o checkChatAccess já roda antes e barra se não existir, 
        // este if 404 aqui vira uma rede de segurança extra perfeita.
        if (result.length === 0) {
            return res.status(404).json({
                message: "Chat não encontrado"
            });
        }

        // Devolve os dados do chat com o nome da loja associada
        res.json(result[0]);
    });
});



// ==========================================
// LISTAR MENSAGENS DO CHAT (HISTÓRICO DA CONVERSA)
// ==========================================
router.get("/:chatId/mensagens", authMiddleware, checkChatAccess, (req, res) => {
    const { chatId } = req.params;

    const sql = `
        SELECT *
        FROM mensagens
        WHERE chat_id = ?
        ORDER BY criado_em ASC
    `;

    db.query(sql, [chatId], (err, result) => {
        if (err) {
            // Registra o erro interno detalhado apenas no servidor backend
            console.error("Erro ao listar mensagens do chat:", err);
            // Retorna um erro limpo e padronizado para o front-end/cliente
            return res.status(500).json({ error: "Erro interno ao carregar o histórico de mensagens" });
        }

        // Retorna o array de mensagens ordenado por ordem cronológica (as mais antigas primeiro)
        res.json(result);
    });
});

// ==========================================================
// ENVIAR MENSAGEM (COM CRIAÇÃO DE CHAT DINÂMICA E WEBSOCKET)
// ==========================================================
router.post("/mensagem", authMiddleware, checkChatMessageAccess, (req, res) => {
    const {
        chat_id,
        mensagem,
        tipo,
        remetente_tipo,
        loja_id,
        cliente_id
    } = req.body;

    const remetente_id = req.user.id;

    // 1. SE NÃO HOUVER CHAT_ID, CRIA UM NOVO CHAT NO BANCO
    if (!chat_id) {
        const criarChat = `
            INSERT INTO chats
            (pedido_id, cliente_id, loja_id, atualizado_em, tem_nova_msg)
            VALUES (?, ?, ?, NOW(), TRUE)
        `;

        db.query(
            criarChat,
            [
                null,
                remetente_tipo === "cliente" ? remetente_id : cliente_id,
                loja_id
            ],
            (err, result) => {
                if (err) {
                    console.error("Erro ao criar novo chat:", err);
                    return res.status(500).json({ error: "Erro interno ao iniciar chat" });
                }

                const novoChatId = result.insertId;
                salvarMensagem(novoChatId);
            }
        );
    } else {
        // 2. SE JÁ EXISTIR, ATUALIZA O STATUS DO CHAT E SALVA A MENSAGEM
        const atualizarChat = `
            UPDATE chats 
            SET tem_nova_msg = TRUE, atualizado_em = NOW() 
            WHERE id = ?
        `;
        
        db.query(atualizarChat, [chat_id], (err) => {
            if (err) {
                console.error("Erro ao atualizar metadados do chat:", err);
                // Continua mesmo se falhar o update, para não travar o envio da mensagem
            }
            salvarMensagem(chat_id);
        });
    }

    // FUNÇÃO INTERNA PARA INSERIR A MENSAGEM E EMITIR VIA SOCKET.IO
    function salvarMensagem(chatId) {
        const sql = `
            INSERT INTO mensagens
            (chat_id, remetente_id, remetente_tipo, tipo, mensagem)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [chatId, remetente_id, remetente_tipo, tipo, mensagem],
            (err, result) => {
                if (err) {
                    console.error("Erro ao salvar mensagem:", err);
                    return res.status(500).json({ error: "Erro interno ao salvar mensagem" });
                }

                // BUSCA O LOJA_ID REAL PARA ENVIAR O WEBSOCKET PARA A SALA CERTA
                const buscarLoja = `
                    SELECT loja_id
                    FROM chats
                    WHERE id = ?
                    LIMIT 1
                `;

                db.query(buscarLoja, [chatId], (err2, chatResult) => {
                    if (err2) {
                        console.error("Erro ao buscar loja do chat para socket:", err2);
                        return res.status(500).json({ error: "Erro interno ao processar metadados" });
                    }

                    if (chatResult.length === 0) {
                        return res.status(404).json({ message: "Chat não encontrado" });
                    }

                    const lojaIdReal = chatResult[0].loja_id;

                    const novaMensagem = {
                        id: result.insertId,
                        chat_id: chatId,
                        loja_id: lojaIdReal,
                        mensagem,
                        remetente_tipo,
                        remetente_id,
                        criado_em: new Date().toISOString()
                    };

                    // 🔥 BLOCO DEFENSIVO DE WEBSOCKET (Protege a suíte de testes do Jest)
                    try {
                        const io = getIo();
                        if (io && typeof io.to === "function") {
                            // Envia para a sala exclusiva do chat aberto (Cliente e Lojista sintonizados)
                            io.to(`chat_${chatId}`).emit("nova_mensagem", novaMensagem);

                            // Envia para o Inbox global da loja (Para atualizar a bolinha de notificação do lojista)
                            io.to(`loja_${lojaIdReal}`).emit("nova_mensagem_loja", novaMensagem);
                        }
                    } catch (socketErr) {
                        // Silencia o erro de socket no console durante os testes
                    }

                    // Retorna sucesso para o front-end
                    return res.json({
                        message: "Mensagem enviada",
                        chat_id: chatId,
                        id: result.insertId
                    });
                });
            }
        );
    }
});

        
// ==========================================================
// ABRIR OU LOCALIZAR CHAT EXISTENTE (BOTÃO "CONVERSAR")
// ==========================================================
router.post("/abrir", authMiddleware, (req, res) => {
    const cliente_id = req.user.id;
    const { loja_id } = req.body;

    // Validação básica do body para evitar queries desnecessárias
    if (!loja_id) {
        return res.status(400).json({ error: "O campo loja_id é obrigatório." });
    }

    // 1. ANTES DE TUDO, VERIFICA SE A LOJA REALMENTE EXISTE
    const verificarLoja = `SELECT id FROM stores WHERE id = ? LIMIT 1`;

    db.query(verificarLoja, [loja_id], (errLoja, lojaResult) => {
        if (errLoja) {
            console.error("Erro ao verificar existência da loja:", errLoja);
            return res.status(500).json({ error: "Erro interno no servidor" });
        }

        if (lojaResult.length === 0) {
            return res.status(404).json({ message: "A loja informada não existe" });
        }

        // 2. PROCURA SE JÁ EXISTE UM CHAT ENTRE ESTE CLIENTE E ESTA LOJA
        const buscarChat = `
            SELECT id
            FROM chats
            WHERE cliente_id = ?
            AND loja_id = ?
            LIMIT 1
        `;

        db.query(buscarChat, [cliente_id, loja_id], (err, result) => {
            if (err) {
                console.error("Erro ao buscar chat existente:", err);
                return res.status(500).json({ error: "Erro interno no servidor" });
            }

            // Se o chat já existe, apenas retorna o ID dele para o front-end redirecionar
            if (result.length > 0) {
                return res.json({
                    chat_id: result[0].id
                });
            }

            // 3. SE NÃO EXISTIR, CRIA UM NOVO CHAT COM SEGURANÇA
            const criarChat = `
                INSERT INTO chats
                (cliente_id, loja_id, atualizado_em)
                VALUES (?, ?, NOW())
            `;

            db.query(criarChat, [cliente_id, loja_id], (err2, result2) => {
                if (err2) {
                    console.error("Erro ao criar novo chat no /abrir:", err2);
                    return res.status(500).json({ error: "Erro interno ao gerar nova conversa" });
                }

                // Retorna o ID do chat recém-criado
                res.json({
                    chat_id: result2.insertId
                });
            });
        });
    });
});



// ==========================================================
// MARCAR CHAT COMO VISUALIZADO (LIMPAR NOTIFICAÇÃO)
// ==========================================================
router.put("/visualizar/:chatId", authMiddleware, checkChatAccess, (req, res) => {
    const { chatId } = req.params;

    const sql = `
        UPDATE chats
        SET tem_nova_msg = FALSE
        WHERE id = ?
    `;

    db.query(sql, [chatId], (err) => {
        if (err) {
            // Loga o erro real internamente para o desenvolvedor analisar
            console.error("Erro ao marcar chat como visualizado:", err);
            // Resposta padronizada e segura para o cliente externo
            return res.status(500).json({ error: "Erro interno ao atualizar status do chat" });
        }

        // Retorna sucesso para o front-end sumir com o indicador de "não lido"
        res.json({
            message: "Chat visualizado com sucesso"
        });
    });
});



module.exports = router;