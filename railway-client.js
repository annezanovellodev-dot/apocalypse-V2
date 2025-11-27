/**
 * RAILWAY CLIENT - Z-SURVIVAL
 * Client multi-joueurs pour serveur Railway + PostgreSQL
 */

class RailwayClient {
    constructor() {
        // URL du serveur Railway (remplace par ton URL déployée)
        this.serverUrl = 'https://z-survival-production.up.railway.app'; // À remplacer
        this.wsUrl = 'wss://z-survival-production.up.railway.app'; // À remplacer
        this.socket = null;
        this.connected = false;
        this.gameCode = null;
        this.playerId = null;
        this.isHost = false;
        this.listeners = [];
        
        console.log('🚀 Initialisation client Railway...');
        this.init();
    }

    // Initialiser la connexion WebSocket
    async init() {
        try {
            // Test connexion HTTP d'abord
            const response = await fetch(`${this.serverUrl}/health`);
            if (response.ok) {
                console.log('✅ Serveur Railway accessible');
                this.connectWebSocket();
            }
        } catch (error) {
            console.log('⚠️ Serveur Railway non accessible, mode offline');
            this.connected = false;
        }
    }

    // Connexion WebSocket
    connectWebSocket() {
        try {
            this.socket = new WebSocket(this.wsUrl);

            this.socket.onopen = () => {
                console.log('🔌 WebSocket connecté !');
                this.connected = true;
                this.emit('connected');
            };

            this.socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            };

            this.socket.onclose = () => {
                console.log('🔌 WebSocket déconnecté');
                this.connected = false;
                this.emit('disconnected');
                
                // Tentative de reconnexion après 3 secondes
                setTimeout(() => {
                    this.connectWebSocket();
                }, 3000);
            };

            this.socket.onerror = (error) => {
                console.error('❌ Erreur WebSocket:', error);
                this.connected = false;
            };

        } catch (error) {
            console.error('❌ Erreur connexion WebSocket:', error);
            this.connected = false;
        }
    }

    // Gérer les messages du serveur
    handleMessage(data) {
        console.log('📨 Message reçu:', data);
        
        switch (data.type) {
            case 'gameCreated':
                this.emit('gameCreated', data);
                break;
            case 'gameJoined':
                this.emit('gameJoined', data);
                break;
            case 'playerJoined':
                this.emit('playerJoined', data);
                break;
            case 'gameStarted':
                this.emit('gameStarted', data);
                break;
            case 'playerLeft':
                this.emit('playerLeft', data);
                break;
            case 'gameUpdate':
                this.emit('gameUpdate', data);
                break;
            default:
                console.log('Message non géré:', data);
        }
    }

    // Envoyer un message au serveur
    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        } else {
            console.error('❌ WebSocket non connecté');
        }
    }

    // Événements
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }

    // Test de connexion
    async testConnection() {
        try {
            const response = await fetch(`${this.serverUrl}/health`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    // Créer une partie
    async createGame(hostName) {
        return new Promise((resolve) => {
            if (!this.connected) {
                resolve({ success: false, error: 'Non connecté au serveur' });
                return;
            }

            const requestId = Date.now();
            
            // Écouter la réponse
            const onResponse = (data) => {
                if (data.requestId === requestId) {
                    this.removeListener('gameCreated', onResponse);
                    
                    if (data.success) {
                        this.gameCode = data.gameCode;
                        this.playerId = data.playerId;
                        this.isHost = true;
                    }
                    
                    resolve(data);
                }
            };
            
            this.on('gameCreated', onResponse);
            
            // Envoyer la demande
            this.send({
                type: 'createGame',
                hostName: hostName,
                requestId: requestId
            });
            
            // Timeout après 10 secondes
            setTimeout(() => {
                this.removeListener('gameCreated', onResponse);
                resolve({ success: false, error: 'Timeout serveur' });
            }, 10000);
        });
    }

    // Rejoindre une partie
    async joinGame(gameCode, playerName) {
        return new Promise((resolve) => {
            if (!this.connected) {
                resolve({ success: false, error: 'Non connecté au serveur' });
                return;
            }

            const requestId = Date.now();
            
            // Écouter la réponse
            const onResponse = (data) => {
                if (data.requestId === requestId) {
                    this.removeListener('gameJoined', onResponse);
                    
                    if (data.success) {
                        this.gameCode = gameCode;
                        this.playerId = data.playerId;
                        this.isHost = false;
                    }
                    
                    resolve(data);
                }
            };
            
            this.on('gameJoined', onResponse);
            
            // Envoyer la demande
            this.send({
                type: 'joinGame',
                gameCode: gameCode,
                playerName: playerName,
                requestId: requestId
            });
            
            // Timeout après 10 secondes
            setTimeout(() => {
                this.removeListener('gameJoined', onResponse);
                resolve({ success: false, error: 'Timeout serveur' });
            }, 10000);
        });
    }

    // Démarrer la partie
    async startGame(gameCode) {
        return new Promise((resolve) => {
            if (!this.connected || !this.isHost) {
                resolve({ success: false, error: 'Action non autorisée' });
                return;
            }

            const requestId = Date.now();
            
            // Écouter la réponse
            const onResponse = (data) => {
                if (data.requestId === requestId) {
                    this.removeListener('gameStarted', onResponse);
                    resolve(data);
                }
            };
            
            this.on('gameStarted', onResponse);
            
            // Envoyer la demande
            this.send({
                type: 'startGame',
                gameCode: gameCode || this.gameCode,
                requestId: requestId
            });
            
            // Timeout après 10 secondes
            setTimeout(() => {
                this.removeListener('gameStarted', onResponse);
                resolve({ success: false, error: 'Timeout serveur' });
            }, 10000);
        });
    }

    // Écouter les joueurs qui rejoignent
    listenForPlayers(gameCode, callback) {
        this.on('playerJoined', (data) => {
            if (data.gameCode === gameCode) {
                callback(data.players);
            }
        });
    }

    // Quitter la partie
    leaveGame() {
        if (this.connected && this.gameCode) {
            this.send({
                type: 'leaveGame',
                gameCode: this.gameCode,
                playerId: this.playerId
            });
        }
        
        this.gameCode = null;
        this.playerId = null;
        this.isHost = false;
    }

    // Envoyer une action de jeu
    sendGameAction(action, data) {
        if (this.connected && this.gameCode) {
            this.send({
                type: 'gameAction',
                gameCode: this.gameCode,
                playerId: this.playerId,
                action: action,
                data: data,
                timestamp: Date.now()
            });
        }
    }

    // Obtenir le statut
    getStatus() {
        return {
            connected: this.connected,
            gameCode: this.gameCode,
            playerId: this.playerId,
            isHost: this.isHost,
            serverUrl: this.serverUrl
        };
    }

    // Nettoyer les listeners
    removeListener(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    // Déconnexion
    disconnect() {
        this.leaveGame();
        
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        
        this.connected = false;
    }
}

// Mode fallback local si Railway non disponible
class LocalMultiplayer {
    constructor() {
        this.games = new Map();
        this.currentGame = null;
        console.log('🏠 Mode local activé');
    }

    async testConnection() {
        return true; // Toujours "connecté" en mode local
    }

    async createGame(hostName) {
        const gameCode = this.generateGameCode();
        const game = {
            gameCode: gameCode,
            hostName: hostName,
            players: [{ id: 'host', name: hostName, isHost: true }],
            status: 'waiting',
            createdAt: new Date().toISOString()
        };
        
        this.games.set(gameCode, game);
        this.currentGame = game;
        
        return {
            success: true,
            gameCode: gameCode,
            playerId: 'host'
        };
    }

    async joinGame(gameCode, playerName) {
        const game = this.games.get(gameCode);
        
        if (!game) {
            return { success: false, error: 'Partie non trouvée' };
        }
        
        if (game.status !== 'waiting') {
            return { success: false, error: 'Partie déjà commencée' };
        }
        
        const player = { id: 'player', name: playerName, isHost: false };
        game.players.push(player);
        game.status = 'active';
        
        this.currentGame = game;
        
        return {
            success: true,
            playerId: 'player',
            players: game.players
        };
    }

    async startGame(gameCode) {
        if (this.currentGame) {
            this.currentGame.status = 'started';
            return { success: true };
        }
        return { success: false, error: 'Aucune partie active' };
    }

    generateGameCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    listenForPlayers(gameCode, callback) {
        // Simulé en mode local
        setTimeout(() => {
            if (this.currentGame) {
                callback(this.currentGame.players);
            }
        }, 1000);
    }
}

// Auto-détection et initialisation
window.RailwayClient = class {
    constructor() {
        // Essayer Railway d'abord, sinon fallback local
        this.client = null;
        this.isRailway = false;
        
        this.init();
    }

    async init() {
        try {
            // Test si Railway est disponible
            const railway = new RailwayClient();
            const connected = await railway.testConnection();
            
            if (connected) {
                this.client = railway;
                this.isRailway = true;
                console.log('🚀 Mode Railway activé');
            } else {
                throw new Error('Railway non disponible');
            }
        } catch (error) {
            this.client = new LocalMultiplayer();
            this.isRailway = false;
            console.log('🏠 Mode local activé (fallback)');
        }
    }

    async testConnection() {
        return this.client.testConnection();
    }

    async createGame(hostName) {
        return this.client.createGame(hostName);
    }

    async joinGame(gameCode, playerName) {
        return this.client.joinGame(gameCode, playerName);
    }

    async startGame(gameCode) {
        return this.client.startGame(gameCode);
    }

    listenForPlayers(gameCode, callback) {
        this.client.listenForPlayers(gameCode, callback);
    }

    getStatus() {
        const status = this.client.getStatus ? this.client.getStatus() : {};
        return {
            ...status,
            isRailway: this.isRailway,
            mode: this.isRailway ? 'Railway' : 'Local'
        };
    }
};

console.log('✅ Client Railway initialisé !');
