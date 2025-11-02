// -------- OPTIMIZED GAME STATE WITH VALIDATION --------
class GameState {
    constructor() {
        this.reset();
    }

    reset() {
        this.currentSong = null;
        this.playerScores = {};
        this.isPlaying = false;
        this.tracks = [];
        this.usedTracks = new Set();
        this.currentRound = 0;
        this.totalRounds = 5;
        this.roundStartTime = null;
        this.connection = null;
        this.player = null;
        this.timeLimit = 30000;
        this.timeoutId = null;
        this.difficulty = 'medium';
        this.gameChannel = null;
        this.hintCount = 0;
        this.maxHints = 2;
        this.gameMode = 'multiple_choice';
        this.currentOptions = [];
        this.playbackDelay = 0;
        this.lastActivity = Date.now();
    }

    // Validation methods
    isValidDifficulty(difficulty) {
        return ['easy', 'medium', 'hard'].includes(difficulty);
    }

    isValidGameMode(mode) {
        return ['multiple_choice', 'open_answer'].includes(mode);
    }

    isValidRounds(rounds) {
        return Number.isInteger(rounds) && rounds >= 1 && rounds <= 50;
    }

    // Safe setters with validation
    setDifficulty(difficulty) {
        if (this.isValidDifficulty(difficulty)) {
            this.difficulty = difficulty;
            this.timeLimit = {
                'easy': 45000,
                'medium': 30000,
                'hard': 15000
            }[difficulty];
            return true;
        }
        return false;
    }

    setGameMode(mode) {
        if (this.isValidGameMode(mode)) {
            this.gameMode = mode;
            return true;
        }
        return false;
    }

    setTotalRounds(rounds) {
        if (this.isValidRounds(rounds)) {
            this.totalRounds = rounds;
            return true;
        }
        return false;
    }

    // Activity tracking for cleanup
    updateActivity() {
        this.lastActivity = Date.now();
    }

    isStale(maxAge = 30 * 60 * 1000) { // 30 minutes default
        return Date.now() - this.lastActivity > maxAge;
    }

    // Safe cleanup
    cleanup() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        if (this.player) {
            try {
                this.player.stop();
                this.player.removeAllListeners();
            } catch (error) {
                console.log('Error stopping player:', error.message);
            }
            this.player = null;
        }

        if (this.connection) {
            try {
                this.connection.destroy();
            } catch (error) {
                console.log('Error destroying connection:', error.message);
            }
            this.connection = null;
        }

        this.isPlaying = false;
    }
}

const gameState = new GameState();

// -------- TEAM MODE FEATURE --------
const teamState = {
    teams: {},
    teamScores: {},
    teamMode: false
};

// -------- POWER-UPS SYSTEM --------
const powerUps = {
    doublePoints: { name: "2x Points", emoji: "💰", uses: 1 },
    extraTime: { name: "+10 Seconds", emoji: "⏰", uses: 1 },
    eliminateTwo: { name: "Remove 2 Options", emoji: "❌", uses: 1 },
    skipPenalty: { name: "Skip Without Penalty", emoji: "⏭️", uses: 1 }
};
const playerPowerUps = {};

// -------- DAILY CHALLENGES --------
const dailyChallenges = {
    current: null,
    lastReset: null,
    types: [
        { name: "Speed Demon", description: "Win 3 rounds in under 10 seconds", reward: "2x Points powerup" },
        { name: "Streak Master", description: "Win 5 rounds in a row", reward: "Extra Time powerup" },
        { name: "Genre Expert", description: "Win 10 rounds from the same playlist", reward: "Skip Penalty powerup" }
    ]
};

// -------- ENHANCED STATISTICS TRACKING --------
class PlayerStatsManager {
    constructor() {
        this.stats = {};
        this.sessionStats = {};
    }

    getStats(userId) {
        if (!this.stats[userId]) {
            this.stats[userId] = {
                gamesPlayed: 0,
                roundsWon: 0,
                totalPoints: 0,
                averageGuessTime: 0,
                bestStreak: 0,
                currentStreak: 0,
                totalGuesses: 0,
                lastPlayed: null,
                favoriteGenre: null,
                achievements: []
            };
        }
        return this.stats[userId];
    }

    updateStats(userId, won, guessTime = null, points = 0) {
        const stats = this.getStats(userId);
        stats.lastPlayed = new Date();

        if (won) {
            stats.roundsWon++;
            stats.currentStreak++;
            stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
            stats.totalPoints += points;
            
            if (guessTime) {
                stats.totalGuesses++;
                stats.averageGuessTime = ((stats.averageGuessTime * (stats.totalGuesses - 1)) + guessTime) / stats.totalGuesses;
            }
        } else {
            stats.currentStreak = 0;
        }

        // Update session stats
        if (!this.sessionStats[userId]) {
            this.sessionStats[userId] = { roundsWon: 0, totalPoints: 0 };
        }
        if (won) {
            this.sessionStats[userId].roundsWon++;
            this.sessionStats[userId].totalPoints += points;
        }
    }

    getLeaderboard(limit = 10) {
        return Object.entries(this.stats)
            .sort((a, b) => b[1].totalPoints - a[1].totalPoints)
            .slice(0, limit)
            .map(([userId, stats]) => ({ userId, ...stats }));
    }

    getSessionLeaderboard(limit = 10) {
        return Object.entries(this.sessionStats)
            .sort((a, b) => b[1].totalPoints - a[1].totalPoints)
            .slice(0, limit)
            .map(([userId, stats]) => ({ userId, ...stats }));
    }

    resetSession() {
        this.sessionStats = {};
    }
}

const playerStats = new PlayerStatsManager();

// -------- VOTING SYSTEM FOR SKIPS --------
const skipVotes = new Set();
const requiredVotes = (channel) => Math.ceil(channel.members.filter(m => !m.user.bot).size / 2);

// -------- ACHIEVEMENTS SYSTEM --------
const achievements = {
    firstWin: { name: "First Victory", description: "Win your first round", emoji: "🌟" },
    speedster: { name: "Lightning Fast", description: "Win in under 5 seconds", emoji: "⚡" },
    streakMaster: { name: "On Fire", description: "Win 5 rounds in a row", emoji: "🔥" },
    perfectGame: { name: "Perfect Game", description: "Win every round in a game", emoji: "💎" },
    centurion: { name: "Centurion", description: "Win 100 total rounds", emoji: "👑" }
};
const playerAchievements = {};

module.exports = {
    gameState,
    teamState,
    powerUps,
    playerPowerUps,
    dailyChallenges,
    playerStats,
    skipVotes,
    requiredVotes,
    achievements,
    playerAchievements
};