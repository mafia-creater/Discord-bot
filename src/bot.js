const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { validateEnvironment, DISCORD_TOKEN } = require('./config/environment');
const { getSpotifyAccessToken } = require('./spotify/spotifyManager');
const { handleInteraction } = require('./discord/interactionHandlers');
const { 
    handleFetchCommand, 
    handleFetchCategoryCommand, 
    handleSetupCommand, 
    handleStartGameCommand,
    handleHelpCommand,
    handleTestCommand
} = require('./commands/messageCommands');

// Validate environment variables
validateEnvironment();

// -------- DISCORD CLIENT SETUP --------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel],
});

client.once('ready', async () => {
    console.log(`✅ Bot ready: ${client.user.tag}`);
    await getSpotifyAccessToken();
});

// -------- INTERACTION HANDLERS --------
client.on('interactionCreate', handleInteraction);

// -------- RATE LIMITING --------
const userCooldowns = new Map();
const COMMAND_COOLDOWN = 2000; // 2 seconds between commands per user

function isRateLimited(userId) {
    const now = Date.now();
    const lastCommand = userCooldowns.get(userId) || 0;
    
    if (now - lastCommand < COMMAND_COOLDOWN) {
        return true;
    }
    
    userCooldowns.set(userId, now);
    return false;
}

// -------- ENHANCED MESSAGE COMMANDS --------
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    // Rate limiting
    if (isRateLimited(message.author.id)) {
        return; // Silently ignore rate-limited commands
    }

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Command validation
    const validCommands = ['fetch', 'fetch-category', 'setup', 'start', 'help', 'test', 'stop', 'skip', 'hint', 'stats', 'leaderboard'];
    
    try {
        switch (command) {
            case 'fetch':
                if (!message.member?.permissions.has('MANAGE_CHANNELS')) {
                    return message.reply('❌ You need "Manage Channels" permission to load playlists.');
                }
                await handleFetchCommand(message, args);
                break;
            case 'fetch-category':
                if (!message.member?.permissions.has('MANAGE_CHANNELS')) {
                    return message.reply('❌ You need "Manage Channels" permission to load playlists.');
                }
                await handleFetchCategoryCommand(message, args);
                break;
            case 'setup':
                await handleSetupCommand(message);
                break;
            case 'start':
                await handleStartGameCommand(message, args);
                break;
            case 'help':
                await handleHelpCommand(message);
                break;
            case 'test':
                await handleTestCommand(message, args);
                break;
            // Add other commands as needed
            default:
                // Handle open answer guesses during game
                if (validCommands.includes(command)) {
                    message.reply(`❌ Command "${command}" is not yet implemented.`);
                } else if (message.content.length > 1 && message.content.length < 100) {
                    // This would be handled by a separate function for game guesses
                    // await handleOpenAnswerGuess(message);
                }
                break;
        }
    } catch (error) {
        logError(error, `Command-${command}`);
        
        // More specific error messages
        if (error.message.includes('Missing Permissions')) {
            message.reply('❌ I don\'t have the required permissions to execute this command.');
        } else if (error.message.includes('timeout')) {
            message.reply('❌ Command timed out. Please try again.');
        } else if (error.message.includes('rate limit')) {
            message.reply('❌ Rate limited. Please wait a moment and try again.');
        } else {
            message.reply('❌ An error occurred while processing your command. Please try again later.');
        }
    }
});

// -------- ENHANCED ERROR HANDLING AND MONITORING --------
const errorCounts = new Map();
const MAX_ERRORS_PER_HOUR = 50;

function logError(error, context = 'Unknown') {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] Error in ${context}:`, error);
    
    // Track error frequency
    const hourKey = Math.floor(Date.now() / (60 * 60 * 1000));
    const errorKey = `${context}-${hourKey}`;
    errorCounts.set(errorKey, (errorCounts.get(errorKey) || 0) + 1);
    
    // Alert if too many errors
    if (errorCounts.get(errorKey) > MAX_ERRORS_PER_HOUR) {
        console.error(`🚨 HIGH ERROR RATE DETECTED in ${context}: ${errorCounts.get(errorKey)} errors this hour`);
    }
}

process.on('unhandledRejection', (reason, promise) => {
    logError(reason, 'UnhandledRejection');
    console.error('Promise:', promise);
});

process.on('uncaughtException', (error) => {
    logError(error, 'UncaughtException');
    
    // Try to cleanup gracefully before exit
    try {
        const { gameState } = require('./game/gameState');
        gameState.cleanup();
        client.destroy();
    } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
    }
    
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('📴 Shutting down gracefully...');
    
    try {
        const { gameState } = require('./game/gameState');
        gameState.cleanup();
    } catch (error) {
        console.error('Error during shutdown cleanup:', error);
    }
    
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('📴 Received SIGTERM, shutting down gracefully...');
    
    try {
        const { gameState } = require('./game/gameState');
        gameState.cleanup();
    } catch (error) {
        console.error('Error during shutdown cleanup:', error);
    }
    
    client.destroy();
    process.exit(0);
});

// Memory monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    if (memMB > 500) { // Alert if using more than 500MB
        console.warn(`⚠️ High memory usage: ${memMB}MB`);
    }
    
    // Clean up old error counts
    const currentHour = Math.floor(Date.now() / (60 * 60 * 1000));
    for (const [key] of errorCounts) {
        const keyHour = parseInt(key.split('-').pop());
        if (currentHour - keyHour > 24) { // Keep 24 hours of data
            errorCounts.delete(key);
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

// Periodic cleanup of stale game states
setInterval(() => {
    try {
        const { gameState } = require('./game/gameState');
        if (gameState.isStale() && !gameState.isPlaying) {
            console.log('🧹 Cleaning up stale game state');
            gameState.cleanup();
            gameState.reset();
        }
    } catch (error) {
        logError(error, 'PeriodicCleanup');
    }
}, 10 * 60 * 1000); // Check every 10 minutes

// -------- START BOT --------
client.login(DISCORD_TOKEN);