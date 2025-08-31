// Load environment variables
require('dotenv').config();

// Add validation for environment variables
function validateEnvironment() {
    const required = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'DISCORD_TOKEN'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
    console.log("✅ Environment variables validated");
}
validateEnvironment();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const path = require('path');
const { Readable, PassThrough } = require('stream');

// -------- GAME STATE --------
const gameState = {
    currentSong: null,
    playerScores: {},
    isPlaying: false,
    tracks: [],
    usedTracks: new Set(),
    currentRound: 0,
    totalRounds: 5,
    roundStartTime: null,
    connection: null,
    player: null,
    timeLimit: 30000,
    timeoutId: null,
    difficulty: 'medium',
    gameChannel: null,
    hintCount: 0,
    maxHints: 2,
    gameMode: 'multiple_choice',
    currentOptions: [],
    playbackDelay: 0,
};

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

// -------- STATISTICS TRACKING --------
const playerStats = {};

function updatePlayerStats(userId, won, guessTime = null) {
    if (!playerStats[userId]) {
        playerStats[userId] = {
            gamesPlayed: 0,
            roundsWon: 0,
            totalPoints: 0,
            averageGuessTime: 0,
            bestStreak: 0,
            currentStreak: 0,
            totalGuesses: 0
        };
    }
    const stats = playerStats[userId];
    if (won) {
        stats.roundsWon++;
        stats.currentStreak++;
        stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
        if (guessTime) {
            stats.totalGuesses++;
            stats.averageGuessTime = ((stats.averageGuessTime * (stats.totalGuesses - 1)) + guessTime) / stats.totalGuesses;
        }
    } else {
        stats.currentStreak = 0;
    }
}

// -------- CUSTOM PLAYLISTS & CATEGORIES --------
const customCategories = {
    "90s-hits": "37i9dQZF1DXbTxeAdrVG2l",
    "rock-classics": "37i9dQZF1DWXRqgorJj26U",
    "pop-2020s": "37i9dQZF1DX0XUsuxWHRQd",
    "indie-favorites": "37i9dQZF1DX2Nc3B70tvx0"
};

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

function checkAchievements(userId, gameData) {
    if (!playerAchievements[userId]) playerAchievements[userId] = [];
    const earned = [];
    const stats = playerStats[userId];

    if (stats && stats.roundsWon === 1 && !playerAchievements[userId].includes('firstWin')) {
        earned.push('firstWin');
    }
    if (gameData.guessTime < 5000 && !playerAchievements[userId].includes('speedster')) {
        earned.push('speedster');
    }

    playerAchievements[userId].push(...earned);
    return earned;
}

// -------- SPOTIFY SETUP --------
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

let tokenRefreshTimeout;

async function getSpotifyAccessToken() {
    try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        console.log("✅ Spotify token refreshed");

        // Clear existing timeout
        if (tokenRefreshTimeout) clearTimeout(tokenRefreshTimeout);

        // Refresh token 5 minutes before expiry
        const refreshTime = (data.body['expires_in'] - 300) * 1000;
        tokenRefreshTimeout = setTimeout(getSpotifyAccessToken, refreshTime);
    } catch (err) {
        console.error("❌ Error fetching Spotify token:", err);
        // Retry after 5 minutes on error
        if (tokenRefreshTimeout) clearTimeout(tokenRefreshTimeout);
        tokenRefreshTimeout = setTimeout(getSpotifyAccessToken, 5 * 60 * 1000);
    }
}

function getPlaylistIdFromUrl(url) {
    const patterns = [
        /playlist\/([a-zA-Z0-9]+)/,
        /open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/,
        /spotify:playlist:([a-zA-Z0-9]+)/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            console.log(`✅ Extracted playlist ID: ${match[1]}`);
            return match[1];
        }
    }
    console.log(`❌ No valid playlist ID found in URL: ${url}`);
    return null;
}

// -------- OPTIMIZED STREAMING AUDIO WITH PROPER BUFFERING --------
async function findAndPlayYouTubeAudio(connection, songTitle, songArtist) {
    return new Promise((resolve, reject) => {
        const player = createAudioPlayer();
        connection.subscribe(player);

        const searchQuery = `${songTitle} ${songArtist}`.replace(/[^\w\s]/g, '').trim();
        console.log(`🔍 Searching: ${searchQuery}`);

        const ytDlpArgs = [
            `ytsearch1:${searchQuery}`,
            '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
            '--no-playlist',
            '--no-warnings',
            '--buffer-size', '32K',
            '--http-chunk-size', '2M',
            '--socket-timeout', '10',
            '--retries', '1',
            '-o', '-'
        ];

        const ytDlpProcess = spawn('yt-dlp', ytDlpArgs, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let hasStarted = false;
        let errorOutput = '';
        let bytesReceived = 0;
        let timeout = null;
        const audioBuffer = new PassThrough({
            highWaterMark: 1024 * 128, // 128KB buffer
            objectMode: false
        });

        // Enhanced player error handling - don't crash the game
        player.on('error', (error) => {
            console.log(`Audio error (non-fatal): ${error.message}`);
            // Only reject if we haven't started playing yet
            if (!hasStarted) {
                cleanup();
                reject(error);
            }
        });

        player.on(AudioPlayerStatus.Idle, () => {
            console.log('Audio playback completed');
            cleanup();
        });

        player.on(AudioPlayerStatus.Playing, () => {
            console.log('Audio is now playing');
        });

        // Handle yt-dlp errors
        ytDlpProcess.stderr.on('data', (data) => {
            const output = data.toString();
            errorOutput += output;
            // Only log actual errors, not progress info
            if (output.includes('ERROR') && !output.includes('unable to write data')) {
                console.log('yt-dlp error:', output.trim());
            }
        });

        // Handle audio data with smart buffering
        ytDlpProcess.stdout.on('data', (chunk) => {
            bytesReceived += chunk.length;

            // Write to buffer
            if (!audioBuffer.destroyed) {
                audioBuffer.write(chunk);
            }

            // Start playing after we have enough data (64KB minimum)
            if (!hasStarted && bytesReceived > 64 * 1024) {
                hasStarted = true;
                clearTimeout(timeout);

                try {
                    const resource = createAudioResource(audioBuffer, {
                        inputType: 'arbitrary',
                        inlineVolume: true,
                        silencePaddingFrames: 5
                    });

                    if (resource.volume) {
                        resource.volume.setVolume(0.5);
                    }

                    player.play(resource);
                    console.log(`✅ Started: ${songTitle} by ${songArtist} (${Math.round(bytesReceived / 1024)}KB)`);
                    resolve(player);
                } catch (err) {
                    console.error('Audio resource error:', err);
                    cleanup();
                    reject(err);
                }
            }
        });

        ytDlpProcess.stdout.on('end', () => {
            console.log('yt-dlp stream ended');
            if (!audioBuffer.destroyed) {
                audioBuffer.end();
            }
        });

        ytDlpProcess.stdout.on('error', (err) => {
            // Handle the EOF error gracefully
            if (err.code === 'EOF' || err.message.includes('EOF')) {
                console.log('Stream ended (EOF) - this is normal');
                return;
            }
            console.error('Stream error:', err.message);
            if (!hasStarted) {
                cleanup();
                reject(new Error(`Stream error: ${err.message}`));
            }
        });

        ytDlpProcess.on('close', (code) => {
            console.log(`yt-dlp closed with code ${code}`);
            if (code !== 0 && !hasStarted) {
                console.error('yt-dlp failed:', errorOutput);
                cleanup();
                reject(new Error(`yt-dlp failed: ${errorOutput || 'Process failed'}`));
            }
        });

        ytDlpProcess.on('error', (err) => {
            console.error('yt-dlp spawn error:', err);
            cleanup();
            reject(new Error(`Failed to start yt-dlp: ${err.message}`));
        });

        function cleanup() {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            if (ytDlpProcess && !ytDlpProcess.killed) {
                ytDlpProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (!ytDlpProcess.killed) {
                        ytDlpProcess.kill('SIGKILL');
                    }
                }, 2000);
            }
            if (audioBuffer && !audioBuffer.destroyed) {
                audioBuffer.destroy();
            }
        }

        // Set timeout for initial buffering
        timeout = setTimeout(() => {
            if (!hasStarted) {
                console.log('Audio buffering timeout');
                cleanup();
                reject(new Error('Audio buffering timeout'));
            }
        }, 20000);
    });
}

// -------- MULTIPLE CHOICE OPTIONS GENERATOR --------
function generateMultipleChoiceOptions(correctSong, allTracks, type = 'title') {
    const options = [correctSong];
    const used = new Set([correctSong.title + correctSong.artist]);

    // Get 3 random wrong options
    let attempts = 0;
    while (options.length < 4 && attempts < 50) {
        const randomTrack = allTracks[Math.floor(Math.random() * allTracks.length)];
        const key = randomTrack.title + randomTrack.artist;
        if (!used.has(key)) {
            options.push(randomTrack);
            used.add(key);
        }
        attempts++;
    }

    // Fill remaining slots if needed
    while (options.length < 4) {
        options.push({
            title: `Mystery Song ${options.length}`,
            artist: 'Unknown Artist'
        });
    }

    // Shuffle options
    for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
    }

    return options.map((track, index) => ({
        label: `${['A', 'B', 'C', 'D'][index]}. ${type === 'title' ? track.title : track.artist}`,
        value: `option_${index}`,
        isCorrect: track === correctSong
    }));
}

// -------- SIMILARITY MATCHING --------
function calculateSimilarity(guess, correct) {
    const normalize = (str) => str.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const guessNorm = normalize(guess);
    const correctNorm = normalize(correct);

    if (guessNorm === correctNorm) return 1;
    if (guessNorm.includes(correctNorm) || correctNorm.includes(guessNorm)) return 0.8;

    const distance = levenshteinDistance(guessNorm, correctNorm);
    const maxLength = Math.max(guessNorm.length, correctNorm.length);
    return Math.max(0, 1 - (distance / maxLength));
}

function levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
        for (let i = 1; i <= str1.length; i++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,
                matrix[j - 1][i] + 1,
                matrix[j - 1][i - 1] + cost
            );
        }
    }
    return matrix[str2.length][str1.length];
}

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

// -------- ENHANCED SPOTIFY PLAYLIST FETCHING --------
async function fetchSpotifyPlaylist(playlistId) {
    try {
        const playlistInfo = await spotifyApi.getPlaylist(playlistId);
        let allTracks = [];
        let offset = 0;
        const limit = 50;

        while (offset < 1000) { // Limit to 1000 tracks max
            try {
                const data = await spotifyApi.getPlaylistTracks(playlistId, {
                    limit: limit,
                    offset: offset,
                    fields: 'items(track(name,artists,preview_url)),next,total'
                });

                const tracks = data.body.items
                    .filter(item => item.track && item.track.name && item.track.artists.length > 0)
                    .map(item => ({
                        title: item.track.name.trim(),
                        artist: item.track.artists.map(a => a.name).join(", ").trim(),
                        preview_url: item.track.preview_url
                    }))
                    .filter(track => track.title.length > 0 && track.artist.length > 0);

                allTracks = allTracks.concat(tracks);
                offset += limit;

                if (data.body.items.length < limit) break;
            } catch (trackError) {
                console.error(`Error fetching tracks at offset ${offset}:`, trackError);
                break;
            }
        }

        return {
            info: playlistInfo.body,
            tracks: allTracks
        };
    } catch (error) {
        throw error;
    }
}

// -------- INTERACTION HANDLERS --------
client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    try {
        if (interaction.customId === 'song_options' && gameState.isPlaying) {
            await handleMultipleChoiceAnswer(interaction);
        } else if (interaction.customId.startsWith('setup_')) {
            await handleSetupButton(interaction);
        } else if (interaction.customId === 'start_game') {
            await handleStartGame(interaction);
        }
    } catch (error) {
        console.error('Interaction error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred processing your request.', ephemeral: true });
        }
    }
});

async function handleMultipleChoiceAnswer(interaction) {
    const selectedValue = interaction.values[0];
    const selectedOption = gameState.currentOptions.find(opt => opt.value === selectedValue);

    if (selectedOption && selectedOption.isCorrect) {
        const userId = interaction.user.id;
        const guessTime = Date.now() - gameState.roundStartTime;
        const timeBonus = Math.max(1, Math.floor((gameState.timeLimit - guessTime) / 1000));
        const points = Math.max(1, Math.floor(timeBonus / 3) + 1);

        gameState.playerScores[userId] = (gameState.playerScores[userId] || 0) + points;
        updatePlayerStats(userId, true, guessTime);

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎉 Correct Answer!')
            .setDescription(`<@${userId}> got it right!`)
            .addFields([
                { name: 'Song', value: `**${gameState.currentSong.title}**`, inline: true },
                { name: 'Artist', value: `**${gameState.currentSong.artist}**`, inline: true },
                { name: 'Points Earned', value: `**+${points}**`, inline: true },
                { name: 'Time', value: `${(guessTime / 1000).toFixed(1)}s`, inline: true }
            ]);

        await interaction.reply({ embeds: [embed] });

        clearTimeout(gameState.timeoutId);
        cleanupRound();

        setTimeout(async () => {
            const member = interaction.guild.members.cache.get(userId);
            const voiceChannel = member?.voice?.channel;
            if (gameState.currentRound < gameState.totalRounds && voiceChannel) {
                await startNextRound(interaction, voiceChannel);
            } else {
                await endGame(interaction);
            }
        }, 3000);
    } else {
        await interaction.reply({ content: '❌ Wrong answer! Keep trying!', ephemeral: true });
    }
}

async function handleSetupButton(interaction) {
    const action = interaction.customId.split('_')[1];

    switch (action) {
        case 'mode':
            gameState.gameMode = gameState.gameMode === 'multiple_choice' ? 'open_answer' : 'multiple_choice';
            break;
        case 'difficulty':
            const difficulties = ['easy', 'medium', 'hard'];
            const currentIndex = difficulties.indexOf(gameState.difficulty);
            gameState.difficulty = difficulties[(currentIndex + 1) % difficulties.length];
            gameState.timeLimit = {
                'easy': 45000,
                'medium': 30000,
                'hard': 15000
            }[gameState.difficulty];
            break;
        case 'rounds':
            gameState.totalRounds = gameState.totalRounds >= 20 ? 5 : gameState.totalRounds + 5;
            break;
        case 'delay':
            gameState.playbackDelay = gameState.playbackDelay >= 10 ? 0 : gameState.playbackDelay + 2;
            break;
    }

    await updateSetupMessage(interaction);
}

async function handleStartGame(interaction) {
    await interaction.deferReply();

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
        return interaction.followUp("⚠️ You need to be in a voice channel to start a game.");
    }

    if (gameState.tracks.length === 0) {
        return interaction.followUp("⚠️ Load a playlist first with `!fetch <spotify_url>`.");
    }

    await initializeGame(interaction, voiceChannel);
}

// -------- GAME FLOW FUNCTIONS --------
async function initializeGame(context, voiceChannel) {
    gameState.isPlaying = true;
    gameState.currentRound = 0;
    gameState.playerScores = {};
    gameState.usedTracks.clear();
    gameState.gameChannel = context.channel;

    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🎮 Game Starting!')
        .setDescription(`**${gameState.totalRounds} rounds** • **${gameState.difficulty}** difficulty • **${gameState.gameMode}** mode`)
        .addFields(
            { name: 'Time per round', value: `${gameState.timeLimit / 1000} seconds`, inline: true },
            { name: 'Voice Channel', value: voiceChannel.name, inline: true },
            { name: 'Playback Delay', value: `${gameState.playbackDelay} seconds`, inline: true }
        );

    // Handle different context types (message vs interaction)
    if (context.followUp) {
        // This is an interaction
        await context.followUp({ embeds: [embed] });
    } else if (context.reply) {
        // This is a message
        await context.reply({ embeds: [embed] });
    } else {
        // Fallback to channel send
        await context.channel.send({ embeds: [embed] });
    }

    setTimeout(() => startNextRound(context, voiceChannel), 2000);
}

async function startNextRound(context, voiceChannel) {
    gameState.currentRound++;

    if (gameState.currentRound > gameState.totalRounds) {
        return endGame(context);
    }

    // Select random unused track
    const availableIndices = Array.from({ length: gameState.tracks.length }, (_, i) => i)
        .filter(i => !gameState.usedTracks.has(i));

    if (availableIndices.length === 0) {
        gameState.usedTracks.clear();
        availableIndices.push(...Array.from({ length: gameState.tracks.length }, (_, i) => i));
    }

    const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    gameState.currentSong = gameState.tracks[randomIndex];
    gameState.usedTracks.add(randomIndex);
    gameState.roundStartTime = Date.now();
    gameState.hintCount = 0;
    gameState.isPlaying = true;

    // Generate options for multiple choice mode
    if (gameState.gameMode === 'multiple_choice') {
        gameState.currentOptions = generateMultipleChoiceOptions(gameState.currentSong, gameState.tracks);
    }

    const embed = new EmbedBuilder()
        .setColor('#9146FF')
        .setTitle(`🎵 Round ${gameState.currentRound}/${gameState.totalRounds}`)
        .setDescription(gameState.gameMode === 'multiple_choice' ? 'Select the correct song!' : 'Guess the song title or artist!')
        .addFields(
            { name: 'Time Limit', value: `${gameState.timeLimit / 1000} seconds`, inline: true },
            { name: 'Hints Available', value: `${gameState.maxHints}`, inline: true },
            { name: 'Mode', value: gameState.gameMode.replace('_', ' '), inline: true }
        );

    const components = [];

    if (gameState.gameMode === 'multiple_choice') {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('song_options')
            .setPlaceholder('Choose the correct song...')
            .addOptions(gameState.currentOptions.map(option => ({
                label: option.label,
                value: option.value
            })));

        components.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    // Get the correct channel to send to
    const channel = gameState.gameChannel;
    await channel.send({ embeds: [embed], components: components });

    // Start audio playback
    try {
        await playRoundAudio(voiceChannel);
    } catch (error) {
        console.error('Round audio error:', error);
        await channel.send('❌ Error playing audio. Skipping to next round...');
        setTimeout(() => skipCurrentRound(context), 2000);
        return;
    }

    // Set round timeout
    gameState.timeoutId = setTimeout(() => {
        if (gameState.isPlaying) {
            skipCurrentRound(context);
        }
    }, gameState.timeLimit);
}

async function playRoundAudio(voiceChannel) {
    // Add playback delay if configured
    if (gameState.playbackDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, gameState.playbackDelay * 1000));
    }

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    gameState.connection = connection;

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);

        // Try primary method first
        let player;
        try {
            player = await findAndPlayYouTubeAudio(
                connection,
                gameState.currentSong.title,
                gameState.currentSong.artist
            );
        } catch (primaryError) {
            console.log('Primary audio method failed, trying fallback...');
            // Try with simplified search query
            const simplifiedQuery = gameState.currentSong.title.split('(')[0].split('[')[0].trim();
            player = await findAndPlayYouTubeAudio(
                connection,
                simplifiedQuery,
                gameState.currentSong.artist.split(',')[0].trim()
            );
        }

        gameState.player = player;

        // Enhanced error handling
        player.on('error', (error) => {
            console.error('Player error during playback:', {
                message: error.message,
                song: `${gameState.currentSong.title} by ${gameState.currentSong.artist}`
            });

            // Don't crash the game, just log it
            if (gameState.gameChannel) {
                gameState.gameChannel.send('⚠️ Audio playback encountered an issue, but the round continues!');
            }
        });

        player.on(AudioPlayerStatus.Idle, () => {
            console.log('Audio finished playing');
        });

    } catch (error) {
        console.error('Connection/Audio error:', error);
        throw error;
    }
}

function cleanupRound() {
    gameState.isPlaying = false;
    clearTimeout(gameState.timeoutId);

    if (gameState.player) {
        try {
            gameState.player.stop();
            gameState.player.removeAllListeners();
        } catch (error) {
            console.log('Error stopping player:', error.message);
        }
        gameState.player = null;
    }

    if (gameState.connection) {
        try {
            gameState.connection.destroy();
        } catch (error) {
            console.log('Error destroying connection:', error.message);
        }
        gameState.connection = null;
    }
}

function skipCurrentRound(context) {
    if (!gameState.isPlaying) return;

    cleanupRound();

    const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('⏭️ Round Skipped')
        .setDescription('Time\'s up!')
        .addFields(
            { name: 'Song', value: `**${gameState.currentSong.title}**`, inline: true },
            { name: 'Artist', value: `**${gameState.currentSong.artist}**`, inline: true }
        );

    const channel = context.channel || gameState.gameChannel;
    channel.send({ embeds: [embed] });

    setTimeout(async () => {
        const voiceChannel = context.member?.voice?.channel ||
            context.guild?.members?.cache?.get(context.user?.id || context.author?.id)?.voice?.channel;
        if (gameState.currentRound < gameState.totalRounds && voiceChannel) {
            await startNextRound(context, voiceChannel);
        } else {
            await endGame(context);
        }
    }, 3000);
}

async function endGame(context, forced = false) {
    cleanupRound();

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(forced ? '🛑 Game Stopped' : '🏁 Game Over!')
        .setDescription('Thanks for playing!');

    if (Object.keys(gameState.playerScores).length > 0) {
        const sortedScores = Object.entries(gameState.playerScores)
            .sort((a, b) => b[1] - a[1]);

        const winner = sortedScores[0];
        const leaderboard = sortedScores.slice(0, 5).map(([id, score], i) => {
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏅";
            return `${medal} <@${id}> — **${score}** points`;
        }).join("\n");

        embed.addFields(
            { name: '🏆 Winner', value: `<@${winner[0]}> with **${winner[1]}** points!`, inline: false },
            { name: '📊 Final Scores', value: leaderboard, inline: false }
        );

        // Update player stats
        for (const [userId] of sortedScores) {
            if (!playerStats[userId]) {
                playerStats[userId] = {
                    gamesPlayed: 0,
                    roundsWon: 0,
                    totalPoints: 0,
                    averageGuessTime: 0,
                    bestStreak: 0,
                    currentStreak: 0,
                    totalGuesses: 0
                };
            }
            playerStats[userId].gamesPlayed++;
            playerStats[userId].totalPoints += gameState.playerScores[userId];
        }
    }

    // Use gameChannel which should always be set
    const channel = gameState.gameChannel;
    if (channel) {
        await channel.send({ embeds: [embed] });
    }
}

// -------- HELPER FUNCTIONS --------
async function updateSetupMessage(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#9146FF')
        .setTitle('🎮 Game Setup')
        .setDescription('Configure your game settings:')
        .addFields(
            { name: 'Game Mode', value: `**${gameState.gameMode.replace('_', ' ').toUpperCase()}**`, inline: true },
            { name: 'Difficulty', value: `**${gameState.difficulty.toUpperCase()}** (${gameState.timeLimit / 1000}s)`, inline: true },
            { name: 'Rounds', value: `**${gameState.totalRounds}**`, inline: true },
            { name: 'Playback Delay', value: `**${gameState.playbackDelay}s**`, inline: true },
            { name: 'Loaded Songs', value: `**${gameState.tracks.length}**`, inline: true },
            { name: 'Status', value: gameState.tracks.length > 0 ? '✅ Ready to play!' : '⚠️ Load playlist first', inline: true }
        );

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_mode')
                .setLabel(`Mode: ${gameState.gameMode.replace('_', ' ')}`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎯'),
            new ButtonBuilder()
                .setCustomId('setup_difficulty')
                .setLabel(`Difficulty: ${gameState.difficulty}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⚡'),
            new ButtonBuilder()
                .setCustomId('setup_rounds')
                .setLabel(`Rounds: ${gameState.totalRounds}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔢')
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_delay')
                .setLabel(`Delay: ${gameState.playbackDelay}s`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⏱️'),
            new ButtonBuilder()
                .setCustomId('start_game')
                .setLabel('Start Game!')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🚀')
                .setDisabled(gameState.tracks.length === 0 || gameState.isPlaying)
        );

    await interaction.update({ embeds: [embed], components: [row1, row2] });
}

function generateHints(song) {
    const hints = [
        `First letter of the title: **${song.title.charAt(0).toUpperCase()}**`,
        `Artist starts with: **${song.artist.split(',')[0].trim().charAt(0).toUpperCase()}**`,
        `Song title has **${song.title.length}** letters`
    ];
    return hints;
}

// -------- MESSAGE COMMANDS --------
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.split(" ");
    const command = args.shift().toLowerCase();

    try {
        if (command === "!fetch") {
            await handleFetchCommand(message, args);
        }
        else if (command === "!fetch-category") {
            await handleFetchCategoryCommand(message, args);
        }
        else if (command === "!setup") {
            await handleSetupCommand(message);
        }
        else if (command === "!startgame") {
            await handleStartGameCommand(message, args);
        }
        else if (command === "!settings") {
            await handleSettingsCommand(message);
        }
        else if (command === "!leaderboard") {
            await handleLeaderboardCommand(message);
        }
        else if (command === "!skip") {
            await handleSkipCommand(message);
        }
        else if (command === "!hint") {
            await handleHintCommand(message);
        }
        else if (command === "!stop") {
            await handleStopCommand(message);
        }
        else if (command === "!help") {
            await handleHelpCommand(message);
        }
        else if (command === "!stats") {
            await handleStatsCommand(message);
        }
        else if (command === "!teams") {
            await handleTeamsCommand(message, args);
        }
        else if (command === "!categories") {
            await handleCategoriesCommand(message);
        }
        else if (gameState.isPlaying && gameState.currentSong && gameState.gameMode === 'open_answer' && message.channel === gameState.gameChannel) {
            await handleOpenAnswerGuess(message);
        }
    } catch (error) {
        console.error('Command error:', error);
        message.reply('An error occurred processing your command. Please try again.');
    }
});

// -------- COMMAND HANDLERS --------
async function handleFetchCommand(message, args) {
    const playlistUrl = args[0];
    if (!playlistUrl) {
        return message.reply("⚠️ Please provide a Spotify playlist URL.\nExample: `!fetch https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M`");
    }

    const playlistId = getPlaylistIdFromUrl(playlistUrl);
    if (!playlistId) {
        return message.reply("⚠️ Invalid Spotify playlist URL format. Please use a valid Spotify playlist link.");
    }

    const loadingMessage = await message.channel.send("🎶 Fetching songs from Spotify...");

    try {
        const { info, tracks } = await fetchSpotifyPlaylist(playlistId);

        if (tracks.length === 0) {
            await loadingMessage.edit("❌ No playable tracks found in this playlist.");
            return;
        }

        gameState.tracks = tracks;
        gameState.usedTracks.clear();

        const embed = new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle(`✅ Playlist Loaded: ${info.name}`)
            .setDescription(`**${gameState.tracks.length}** playable tracks loaded!`)
            .addFields(
                { name: 'Playlist Owner', value: info.owner.display_name, inline: true },
                { name: 'Total Tracks', value: `${info.tracks.total}`, inline: true },
                { name: 'Ready to play?', value: 'Use `!setup` or `!startgame` to begin!', inline: false }
            )
            .setThumbnail(info.images[0]?.url);

        await loadingMessage.edit({ content: '', embeds: [embed] });
    } catch (err) {
        console.error("Fetch error:", err);
        let errorMessage = "❌ Failed to fetch playlist. ";

        if (err.statusCode === 401) {
            await getSpotifyAccessToken();
            errorMessage += "Token expired and refreshed. Please try again.";
        } else if (err.statusCode === 404) {
            errorMessage += "Playlist not found - check that it's public and the URL is correct.";
        } else if (err.statusCode === 429) {
            errorMessage += "Rate limited by Spotify. Please wait a moment and try again.";
        } else {
            errorMessage += "Please check the playlist URL and try again.";
        }

        await loadingMessage.edit(errorMessage);
    }
}

async function handleFetchCategoryCommand(message, args) {
    const categoryKey = args[0]?.toLowerCase();
    if (!categoryKey || !customCategories[categoryKey]) {
        const categoryList = Object.keys(customCategories).join(', ');
        return message.reply(`⚠️ Invalid category. Available categories: ${categoryList}`);
    }

    const playlistId = customCategories[categoryKey];
    const loadingMessage = await message.channel.send(`🎶 Loading ${categoryKey} playlist...`);

    try {
        const { info, tracks } = await fetchSpotifyPlaylist(playlistId);
        gameState.tracks = tracks;
        gameState.usedTracks.clear();

        const embed = new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle(`✅ Category Loaded: ${categoryKey}`)
            .setDescription(`**${tracks.length}** tracks loaded!`)
            .addFields(
                { name: 'Ready to play?', value: 'Use `!setup` or `!startgame` to begin!', inline: false }
            );

        await loadingMessage.edit({ content: '', embeds: [embed] });
    } catch (error) {
        console.error("Category fetch error:", error);
        await loadingMessage.edit("❌ Failed to load category playlist.");
    }
}

async function handleSetupCommand(message) {
    const embed = new EmbedBuilder()
        .setColor('#9146FF')
        .setTitle('🎮 Game Setup')
        .setDescription('Configure your game settings:')
        .addFields(
            { name: 'Game Mode', value: `**${gameState.gameMode.replace('_', ' ').toUpperCase()}**`, inline: true },
            { name: 'Difficulty', value: `**${gameState.difficulty.toUpperCase()}** (${gameState.timeLimit / 1000}s)`, inline: true },
            { name: 'Rounds', value: `**${gameState.totalRounds}**`, inline: true },
            { name: 'Playback Delay', value: `**${gameState.playbackDelay}s**`, inline: true },
            { name: 'Loaded Songs', value: `**${gameState.tracks.length}**`, inline: true },
            { name: 'Status', value: gameState.tracks.length > 0 ? '✅ Ready to play!' : '⚠️ Load playlist first', inline: true }
        );

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_mode')
                .setLabel(`Mode: ${gameState.gameMode.replace('_', ' ')}`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎯'),
            new ButtonBuilder()
                .setCustomId('setup_difficulty')
                .setLabel(`Difficulty: ${gameState.difficulty}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⚡'),
            new ButtonBuilder()
                .setCustomId('setup_rounds')
                .setLabel(`Rounds: ${gameState.totalRounds}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔢')
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_delay')
                .setLabel(`Delay: ${gameState.playbackDelay}s`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⏱️'),
            new ButtonBuilder()
                .setCustomId('start_game')
                .setLabel('Start Game!')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🚀')
                .setDisabled(gameState.tracks.length === 0 || gameState.isPlaying)
        );

    return message.reply({ embeds: [embed], components: [row1, row2] });
}

async function handleStartGameCommand(message, args) {
    if (gameState.tracks.length === 0) {
        return message.reply("⚠️ Load a playlist first with `!fetch <spotify_url>`.");
    }

    if (gameState.isPlaying) {
        return message.reply("⚠️ A game is already in progress. Use `!stop` to end it.");
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        return message.reply("⚠️ You need to be in a voice channel to start a game.");
    }

    // Parse optional arguments
    const requestedRounds = parseInt(args[0]);
    if (!isNaN(requestedRounds) && requestedRounds > 0) {
        gameState.totalRounds = Math.min(20, requestedRounds);
    }

    const requestedDifficulty = args[1]?.toLowerCase();
    if (['easy', 'medium', 'hard'].includes(requestedDifficulty)) {
        gameState.difficulty = requestedDifficulty;
        gameState.timeLimit = {
            'easy': 45000,
            'medium': 30000,
            'hard': 15000
        }[requestedDifficulty];
    }

    await initializeGame(message, voiceChannel);
}

async function handleSettingsCommand(message) {
    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('⚙️ Current Game Settings')
        .addFields(
            { name: 'Game Mode', value: gameState.gameMode.replace('_', ' '), inline: true },
            { name: 'Rounds', value: `${gameState.totalRounds}`, inline: true },
            { name: 'Difficulty', value: gameState.difficulty, inline: true },
            { name: 'Time Limit', value: `${gameState.timeLimit / 1000}s`, inline: true },
            { name: 'Playback Delay', value: `${gameState.playbackDelay}s`, inline: true },
            { name: 'Loaded Songs', value: `${gameState.tracks.length}`, inline: true },
            { name: 'Max Hints', value: `${gameState.maxHints} per round`, inline: true }
        );
    return message.reply({ embeds: [embed] });
}

async function handleLeaderboardCommand(message) {
    if (Object.keys(gameState.playerScores).length === 0) {
        return message.reply("🏆 No scores yet. Start a game to see the leaderboard!");
    }

    const leaderboard = Object.entries(gameState.playerScores)
        .sort((a, b) => b[1] - a[1])
        .map(([id, score], i) => {
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏅";
            return `${medal} <@${id}> — **${score}** points`;
        })
        .join("\n");

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 Current Game Leaderboard')
        .setDescription(leaderboard)
        .addFields(
            { name: 'Round', value: `${gameState.currentRound}/${gameState.totalRounds}`, inline: true }
        );
    return message.reply({ embeds: [embed] });
}

async function handleSkipCommand(message) {
    if (!gameState.isPlaying || !gameState.currentSong) {
        return message.reply("⚠️ No active round to skip.");
    }

    const userId = message.author.id;
    skipVotes.add(userId);

    const required = requiredVotes(message.channel);
    const current = skipVotes.size;

    if (current >= required) {
        skipVotes.clear();
        skipCurrentRound(message);
    } else {
        message.reply(`🗳️ Skip vote registered (${current}/${required} needed)`);
    }
}

async function handleHintCommand(message) {
    if (!gameState.isPlaying || !gameState.currentSong) {
        return message.reply("⚠️ No active round for hints.");
    }

    if (gameState.hintCount >= gameState.maxHints) {
        return message.reply("⚠️ No more hints available this round.");
    }

    gameState.hintCount++;
    const hints = generateHints(gameState.currentSong);
    const hint = hints[gameState.hintCount - 1];

    message.channel.send(`💡 **Hint ${gameState.hintCount}/${gameState.maxHints}:** ${hint}`);
}

async function handleStopCommand(message) {
    if (!gameState.isPlaying) {
        return message.reply("⚠️ No active game to stop.");
    }
    await endGame(message, true);
    return message.reply("🛑 Game stopped by user.");
}

async function handleHelpCommand(message) {
    const helpEmbed = new EmbedBuilder()
        .setColor('#1DB954')
        .setTitle('🎵 Guess the Song Bot Commands')
        .addFields(
            { name: '!fetch <playlist_url>', value: 'Load songs from Spotify playlist', inline: false },
            { name: '!fetch-category <category>', value: 'Load predefined music category', inline: false },
            { name: '!setup', value: 'Interactive game setup with options', inline: false },
            { name: '!startgame [rounds] [difficulty]', value: 'Quick start game (default: 5 rounds, medium)', inline: false },
            { name: '!settings', value: 'View current game settings', inline: false },
            { name: '!leaderboard', value: 'Show current game scores', inline: false },
            { name: '!stats [@user]', value: 'Show player statistics', inline: false },
            { name: '!skip', value: 'Vote to skip current song', inline: false },
            { name: '!hint', value: 'Get a hint (limited per round)', inline: false },
            { name: '!stop', value: 'Stop the current game', inline: false },
            { name: '!teams', value: 'Team commands (create/join/list)', inline: false },
            { name: '!categories', value: 'Show available music categories', inline: false }
        )
        .setFooter({ text: 'Use !setup for interactive configuration!' });
    return message.reply({ embeds: [helpEmbed] });
}

async function handleStatsCommand(message) {
    const targetUser = message.mentions.users.first() || message.author;
    const userId = targetUser.id;
    const stats = playerStats[userId];

    if (!stats) {
        return message.reply(`📊 ${targetUser.username} hasn't played any games yet!`);
    }

    const winRate = stats.totalGuesses > 0 ? ((stats.roundsWon / stats.totalGuesses) * 100).toFixed(1) : 0;
    const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle(`📊 ${targetUser.username}'s Stats`)
        .addFields(
            { name: 'Games Played', value: `${stats.gamesPlayed}`, inline: true },
            { name: 'Rounds Won', value: `${stats.roundsWon}`, inline: true },
            { name: 'Win Rate', value: `${winRate}%`, inline: true },
            { name: 'Best Streak', value: `${stats.bestStreak}`, inline: true },
            { name: 'Current Streak', value: `${stats.currentStreak}`, inline: true },
            { name: 'Avg Guess Time', value: `${stats.averageGuessTime.toFixed(1)}s`, inline: true }
        )
        .setThumbnail(targetUser.displayAvatarURL());
    return message.reply({ embeds: [embed] });
}

async function handleTeamsCommand(message, args) {
    const subCommand = args[0]?.toLowerCase();

    if (subCommand === "create") {
        const teamName = args.slice(1).join(" ");
        if (!teamName) return message.reply("⚠️ Please provide a team name: `!teams create TeamName`");

        teamState.teams[teamName] = [message.author.id];
        teamState.teamScores[teamName] = 0;
        teamState.teamMode = true;
        return message.reply(`🏆 Team **${teamName}** created! Use \`!teams join ${teamName}\` to join.`);
    }

    if (subCommand === "join") {
        const teamName = args.slice(1).join(" ");
        if (!teamState.teams[teamName]) return message.reply("⚠️ Team not found!");

        // Remove user from all other teams
        Object.keys(teamState.teams).forEach(team => {
            teamState.teams[team] = teamState.teams[team].filter(id => id !== message.author.id);
        });

        teamState.teams[teamName].push(message.author.id);
        return message.reply(`✅ Joined team **${teamName}**!`);
    }

    if (subCommand === "list") {
        const teamList = Object.entries(teamState.teams)
            .filter(([_, members]) => members.length > 0)
            .map(([name, members]) => `**${name}**: ${members.map(id => `<@${id}>`).join(", ")}`)
            .join("\n") || "No teams created yet.";

        const embed = new EmbedBuilder()
            .setColor('#4CAF50')
            .setTitle('👥 Active Teams')
            .setDescription(teamList);
        return message.reply({ embeds: [embed] });
    }

    return message.reply("⚠️ Valid subcommands: `create`, `join`, `list`");
}

async function handleCategoriesCommand(message) {
    const categoryList = Object.entries(customCategories)
        .map(([key, _]) => `🎵 **${key}**`)
        .join("\n");

    const embed = new EmbedBuilder()
        .setColor('#673AB7')
        .setTitle('🎼 Music Categories')
        .setDescription(categoryList)
        .setFooter({ text: 'Use !fetch-category <category-name> to load!' });
    return message.reply({ embeds: [embed] });
}

async function handleOpenAnswerGuess(message) {
    const guess = message.content.trim();
    const titleSimilarity = calculateSimilarity(guess, gameState.currentSong.title);
    const artistSimilarity = calculateSimilarity(guess, gameState.currentSong.artist);

    if (titleSimilarity > 0.8 || artistSimilarity > 0.8) {
        const userId = message.author.id;
        const guessTime = Date.now() - gameState.roundStartTime;
        const timeBonus = Math.max(1, Math.floor((gameState.timeLimit - guessTime) / 1000));
        const points = Math.max(1, Math.floor(timeBonus / 3) + 1);

        gameState.playerScores[userId] = (gameState.playerScores[userId] || 0) + points;
        updatePlayerStats(userId, true, guessTime);

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎉 Correct Guess!')
            .setDescription(`<@${userId}> got it right!`)
            .addFields(
                { name: 'Song', value: `**${gameState.currentSong.title}**`, inline: true },
                { name: 'Artist', value: `**${gameState.currentSong.artist}**`, inline: true },
                { name: 'Points Earned', value: `**+${points}**`, inline: true },
                { name: 'Time', value: `${(guessTime / 1000).toFixed(1)}s`, inline: true }
            );

        await message.channel.send({ embeds: [embed] });

        clearTimeout(gameState.timeoutId);
        cleanupRound();

        setTimeout(async () => {
            const voiceChannel = message.member?.voice?.channel;
            if (gameState.currentRound < gameState.totalRounds && voiceChannel) {
                await startNextRound(message, voiceChannel);
            } else {
                await endGame(message);
            }
        }, 3000);
    } else if (titleSimilarity > 0.6 || artistSimilarity > 0.6) {
        message.react('🔥'); // Very close
    } else if (titleSimilarity > 0.4 || artistSimilarity > 0.4) {
        message.react('👍'); // Close
    }
}

// -------- ERROR HANDLING --------
process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

// -------- GRACEFUL SHUTDOWN --------
process.on('SIGINT', () => {
    console.log('📴 Shutting down gracefully...');

    // Cleanup game state
    if (gameState.connection) {
        gameState.connection.destroy();
    }
    if (gameState.player) {
        gameState.player.stop();
    }
    if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
    }

    client.destroy();
    process.exit(0);
});

// -------- LOGIN --------
client.login(process.env.DISCORD_TOKEN);