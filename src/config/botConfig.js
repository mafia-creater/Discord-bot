// -------- BOT CONFIGURATION --------

const config = {
    // Game Settings
    game: {
        defaultRounds: 5,
        maxRounds: 50,
        minRounds: 1,
        defaultTimeLimit: 30000, // 30 seconds
        maxHints: 2,
        difficulties: {
            easy: { timeLimit: 45000, label: 'Easy (45s)' },
            medium: { timeLimit: 30000, label: 'Medium (30s)' },
            hard: { timeLimit: 15000, label: 'Hard (15s)' }
        },
        gameModes: ['multiple_choice', 'open_answer'],
        maxPlaybackDelay: 10, // seconds
        minSimilarityScore: 0.7 // For open answer matching
    },

    // Audio Settings
    audio: {
        maxCacheSize: 50,
        cacheTimeout: 30 * 60 * 1000, // 30 minutes
        spotifyPreviewTimeout: 15000, // 15 seconds
        youtubeTimeout: 25000, // 25 seconds
        maxRetries: 2,
        bufferSize: 128 * 1024, // 128KB
        volume: 0.5,
        maxFileSize: '20M'
    },

    // Spotify Settings
    spotify: {
        maxPlaylistTracks: 2000,
        batchSize: 50,
        rateLimitDelay: 100, // ms between requests
        cacheTimeout: 30 * 60 * 1000, // 30 minutes
        maxTokenRetries: 5,
        searchLimit: 5
    },

    // Discord Settings
    discord: {
        commandCooldown: 2000, // 2 seconds
        maxErrorsPerHour: 50,
        connectionTimeout: 20000, // 20 seconds
        maxConnectionRetries: 3,
        embedColor: '#9146FF',
        successColor: '#00FF00',
        errorColor: '#FF6B6B',
        warningColor: '#FFD700'
    },

    // Performance Settings
    performance: {
        memoryWarningThreshold: 500, // MB
        cleanupInterval: 10 * 60 * 1000, // 10 minutes
        staleGameTimeout: 30 * 60 * 1000, // 30 minutes
        performanceLogInterval: 30 * 60 * 1000, // 30 minutes
        slowOperationThreshold: 5000 // 5 seconds
    },

    // Feature Flags
    features: {
        enableCaching: true,
        enablePerformanceMonitoring: true,
        enableDetailedLogging: process.env.NODE_ENV === 'development',
        enableRateLimiting: true,
        enableAutoCleanup: true,
        enableTeamMode: true,
        enablePowerUps: true,
        enableAchievements: true
    },

    // Custom Categories (Spotify Playlist IDs)
    categories: {
        "90s-hits": "37i9dQZF1DXbTxeAdrVG2l",
        "rock-classics": "37i9dQZF1DWXRqgorJj26U", 
        "pop-2020s": "37i9dQZF1DX0XUsuxWHRQd",
        "indie-favorites": "37i9dQZF1DX2Nc3B70tvx0",
        "hip-hop": "37i9dQZF1DX0XUsuxWHRQd",
        "electronic": "37i9dQZF1DX4dyzvuaRJ0n"
    },

    // Messages
    messages: {
        errors: {
            noPermission: '❌ You don\'t have permission to use this command.',
            rateLimited: '❌ Please wait before using another command.',
            gameInProgress: '⚠️ A game is already in progress!',
            noPlaylist: '⚠️ No playlist loaded! Use `!fetch <spotify_url>` first.',
            notInVoice: '⚠️ You need to be in a voice channel to start a game.',
            invalidUrl: '❌ Invalid Spotify playlist URL. Please check the URL and try again.',
            playlistNotFound: '❌ Playlist not found or is private. Please check the URL and make sure the playlist is public.',
            audioError: '❌ Error playing audio. Skipping to next round...',
            connectionError: '❌ Voice connection error. Please try again.',
            timeout: '❌ Command timed out. Please try again.'
        },
        success: {
            playlistLoaded: '✅ Playlist loaded successfully!',
            gameStarted: '🎮 Game Starting!',
            gameEnded: '🏁 Game Over!',
            roundComplete: '🎉 Correct Answer!',
            connectionEstablished: '✅ Connected to voice channel'
        },
        info: {
            loading: '🔄 Loading...',
            searching: '🔍 Searching...',
            buffering: '⏳ Buffering audio...',
            roundSkipped: '⏭️ Round Skipped',
            timeUp: 'Time\'s up!',
            hint: '💡 Hint'
        }
    }
};

// Environment-specific overrides
if (process.env.NODE_ENV === 'development') {
    config.features.enableDetailedLogging = true;
    config.discord.commandCooldown = 1000; // Shorter cooldown for dev
    config.performance.performanceLogInterval = 5 * 60 * 1000; // More frequent logging
}

if (process.env.NODE_ENV === 'production') {
    config.features.enableDetailedLogging = false;
    config.performance.memoryWarningThreshold = 800; // Higher threshold for production
}

module.exports = config;