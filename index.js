/**
 * SERVEUR Z-SURVIVAL - Railway + PostgreSQL + WebSocket
 * Serveur multi-joueurs haute performance
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["https://z-survival.vercel.app", "http://localhost:3000", "*"],
        methods: ["GET", "POST"]
    }
});

// Configuration PostgreSQL (Railway)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:password@localhost:5432/zsurvival",
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Stockage en mémoire (fallback)
const games = new Map();
const players = new Map();

// Routes API
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        mode: 'Railway + PostgreSQL',
        games: games.size,
        players: players.size
    });
});

app.get('/api/stats', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) as total_games FROM games WHERE status = $1', ['active']);
        res.json({
            games: games.size,
            players: players.size,
            database_games: parseInt(result.rows[0].total_games)
        });
    } catch (error) {
        res.json({ games: games.size, players: players.size });
    }
});

// Initialiser la base de données
async function initDatabase() {
    try {
        // Créer la table games si elle n'existe pas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                game_code VARCHAR(6) UNIQUE NOT NULL,
                host_name VARCHAR(50) NOT NULL,
                status VARCHAR(20) DEFAULT 'waiting',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                metadata JSONB
            )
        `);

        // Créer la table players si elle n'existe pas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                id SERIAL PRIMARY KEY,
                game_code VARCHAR(6) REFERENCES games(game_code),
                player_id VARCHAR(50) NOT NULL,
                player_name VARCHAR(50) NOT NULL,
                is_host BOOLEAN DEFAULT FALSE,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                metadata JSONB
            )
        `);

        console.log('🗄️ Base de données PostgreSQL initialisée');
    } catch (error) {
        console.error('❌ Erreur initialisation BDD:', error);
    }
}

// Gestion des connexions WebSocket
io.on('connection', (socket) => {
    console.log('🔌 Nouvelle connexion:', socket.id);
    
    // Créer une partie
    socket.on('createGame', async (data) => {
        try {
            const gameCode = generateGameCode();
            const playerId = 'host-' + Date.now();
            
            // Sauvegarder en mémoire
            const game = {
                id: gameCode,
                gameCode: gameCode,
                hostId: socket.id,
                hostName: data.hostName,
                players: [{
                    id: playerId,
                    name: data.hostName,
                    isHost: true,
                    socketId: socket.id
                }],
                status: 'waiting',
                createdAt: new Date().toISOString()
            };
            
            games.set(gameCode, game);
            players.set(socket.id, { playerId, gameCode, isHost: true });
            
            // Sauvegarder en PostgreSQL
            try {
                await pool.query(
                    'INSERT INTO games (game_code, host_name, status, metadata) VALUES ($1, $2, $3, $4)',
                    [gameCode, data.hostName, 'waiting', JSON.stringify(game)]
                );
                
                await pool.query(
                    'INSERT INTO players (game_code, player_id, player_name, is_host, metadata) VALUES ($1, $2, $3, $4, $5)',
                    [gameCode, playerId, data.hostName, true, JSON.stringify({ socketId: socket.id })]
                );
            } catch (dbError) {
                console.error('❌ Erreur sauvegarde BDD:', dbError);
            }
            
            socket.join(gameCode);
            
            console.log(`🎮 Partie créée: ${gameCode} par ${data.hostName}`);
            
            socket.emit('gameCreated', {
                success: true,
                gameCode: gameCode,
                playerId: playerId,
                requestId: data.requestId
            });
            
        } catch (error) {
            console.error('❌ Erreur création partie:', error);
            socket.emit('gameCreated', {
                success: false,
                error: error.message,
                requestId: data.requestId
            });
        }
    });

    // Rejoindre une partie
    socket.on('joinGame', async (data) => {
        try {
            const game = games.get(data.gameCode);
            
            if (!game) {
                // Essayer de récupérer depuis la BDD
                try {
                    const dbResult = await pool.query('SELECT * FROM games WHERE game_code = $1', [data.gameCode]);
                    if (dbResult.rows.length > 0) {
                        const dbGame = dbResult.rows[0];
                        const gameData = JSON.parse(dbGame.metadata || '{}');
                        
                        // Recréer en mémoire
                        const reconstructedGame = {
                            ...gameData,
                            gameCode: data.gameCode,
                            status: dbGame.status
                        };
                        
                        games.set(data.gameCode, reconstructedGame);
                    }
                } catch (dbError) {
                    console.error('❌ Erreur récupération BDD:', dbError);
                }
            }
            
            const currentGame = games.get(data.gameCode);
            
            if (!currentGame) {
                socket.emit('gameJoined', {
                    success: false,
                    error: 'Partie non trouvée',
                    requestId: data.requestId
                });
                return;
            }
            
            if (currentGame.status !== 'waiting') {
                socket.emit('gameJoined', {
                    success: false,
                    error: 'La partie a déjà commencé',
                    requestId: data.requestId
                });
                return;
            }
            
            // Ajouter le joueur
            const playerId = 'player-' + Date.now();
            const player = {
                id: playerId,
                name: data.playerName,
                isHost: false,
                socketId: socket.id
            };
            
            currentGame.players.push(player);
            currentGame.status = 'active';
            
            players.set(socket.id, { playerId, gameCode: data.gameCode, isHost: false });
            
            // Sauvegarder en PostgreSQL
            try {
                await pool.query(
                    'INSERT INTO players (game_code, player_id, player_name, is_host, metadata) VALUES ($1, $2, $3, $4, $5)',
                    [data.gameCode, playerId, data.playerName, false, JSON.stringify({ socketId: socket.id })]
                );
                
                await pool.query(
                    'UPDATE games SET status = $1, metadata = $2 WHERE game_code = $3',
                    ['active', JSON.stringify(currentGame), data.gameCode]
                );
            } catch (dbError) {
                console.error('❌ Erreur sauvegarde BDD:', dbError);
            }
            
            socket.join(data.gameCode);
            
            console.log(`📱 ${data.playerName} a rejoint la partie ${data.gameCode}`);
            
            // Notifier tous les joueurs
            io.to(data.gameCode).emit('playerJoined', {
                success: true,
                gameCode: data.gameCode,
                player: player,
                players: currentGame.players,
                requestId: data.requestId
            });
            
            socket.emit('gameJoined', {
                success: true,
                gameCode: data.gameCode,
                playerId: playerId,
                players: currentGame.players,
                requestId: data.requestId
            });
            
        } catch (error) {
            console.error('❌ Erreur rejoindre partie:', error);
            socket.emit('gameJoined', {
                success: false,
                error: error.message,
                requestId: data.requestId
            });
        }
    });

    // Démarrer la partie
    socket.on('startGame', async (data) => {
        try {
            const playerInfo = players.get(socket.id);
            
            if (!playerInfo || !playerInfo.isHost) {
                socket.emit('gameStarted', {
                    success: false,
                    error: 'Action non autorisée',
                    requestId: data.requestId
                });
                return;
            }
            
            const game = games.get(data.gameCode || playerInfo.gameCode);
            
            if (!game) {
                socket.emit('gameStarted', {
                    success: false,
                    error: 'Partie non trouvée',
                    requestId: data.requestId
                });
                return;
            }
            
            game.status = 'started';
            game.startedAt = new Date().toISOString();
            
            // Sauvegarder en PostgreSQL
            try {
                await pool.query(
                    'UPDATE games SET status = $1, started_at = $2, metadata = $3 WHERE game_code = $4',
                    ['started', new Date(), JSON.stringify(game), data.gameCode || playerInfo.gameCode]
                );
            } catch (dbError) {
                console.error('❌ Erreur sauvegarde BDD:', dbError);
            }
            
            console.log(`🚀 Partie démarrée: ${data.gameCode || playerInfo.gameCode}`);
            
            // Notifier tous les joueurs
            io.to(data.gameCode || playerInfo.gameCode).emit('gameStarted', {
                success: true,
                gameCode: data.gameCode || playerInfo.gameCode,
                game: game,
                requestId: data.requestId
            });
            
        } catch (error) {
            console.error('❌ Erreur démarrage partie:', error);
            socket.emit('gameStarted', {
                success: false,
                error: error.message,
                requestId: data.requestId
            });
        }
    });

    // Actions de jeu
    socket.on('gameAction', (data) => {
        const playerInfo = players.get(socket.id);
        
        if (!playerInfo || playerInfo.gameCode !== data.gameCode) {
            return;
        }
        
        // Relayer l'action aux autres joueurs
        socket.to(data.gameCode).emit('gameAction', {
            playerId: data.playerId,
            action: data.action,
            data: data.data,
            timestamp: data.timestamp
        });
    });

    // Déconnexion
    socket.on('disconnect', async () => {
        console.log('🔌 Déconnexion:', socket.id);
        
        const playerInfo = players.get(socket.id);
        
        if (playerInfo) {
            const game = games.get(playerInfo.gameCode);
            
            if (game) {
                // Retirer le joueur
                game.players = game.players.filter(p => p.socketId !== socket.id);
                
                // Notifier les autres joueurs
                io.to(playerInfo.gameCode).emit('playerLeft', {
                    playerId: playerInfo.playerId,
                    players: game.players
                });
                
                // Si plus de joueurs, supprimer la partie
                if (game.players.length === 0) {
                    games.delete(playerInfo.gameCode);
                    
                    // Supprimer de la BDD
                    try {
                        await pool.query('DELETE FROM games WHERE game_code = $1', [playerInfo.gameCode]);
                        await pool.query('DELETE FROM players WHERE game_code = $1', [playerInfo.gameCode]);
                    } catch (dbError) {
                        console.error('❌ Erreur suppression BDD:', dbError);
                    }
                }
            }
            
            players.delete(socket.id);
        }
    });
});

// Générer un code de partie
function generateGameCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Nettoyage périodique
setInterval(() => {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes
    
    for (const [gameCode, game] of games.entries()) {
        const gameAge = now - new Date(game.createdAt).getTime();
        
        if (gameAge > timeout || game.status === 'started') {
            games.delete(gameCode);
            console.log(`🗑️ Partie supprimée: ${gameCode}`);
        }
    }
}, 5 * 60 * 1000); // Toutes les 5 minutes

// Démarrer le serveur
const PORT = process.env.PORT || 3000;

async function start() {
    await initDatabase();
    
    server.listen(PORT, () => {
        console.log(`🚀 Serveur Z-SURVIVAL démarré sur le port ${PORT}`);
        console.log(`🌐 Mode: Railway + PostgreSQL + WebSocket`);
        console.log(`📊 Health: http://localhost:${PORT}/health`);
    });
}

start().catch(console.error);