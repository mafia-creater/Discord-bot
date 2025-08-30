// Load environment variables
require('dotenv').config();

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
    gameMode: 'multiple_choice', // 'multiple_choice' or 'open_answer'
    currentOptions: [],
    playbackDelay: 0, // Add delay control
};

// -------- SPOTIFY SETUP --------
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

async function getSpotifyAccessToken() {
    try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        console.log("✅ Spotify token refreshed");
        setTimeout(getSpotifyAccessToken, data.body['expires_in'] * 1000);
    } catch (err) {
        console.error("❌ Error fetching Spotify token:", err);
        setTimeout(getSpotifyAccessToken, 5 * 60 * 1000);
    }
}

function getPlaylistIdFromUrl(url) {
    const regex = /playlist\/([a-zA-Z0-9]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

// -------- YOUTUBE AUDIO FETCH WITH IMMEDIATE START --------
async function findAndPlayYouTubeAudio(connection, songTitle, songArtist) {
    const player = createAudioPlayer();
    connection.subscribe(player);

    const searchQuery = `${songTitle} by ${songArtist} audio`;
    console.log(`🔍 Searching: ${searchQuery}`);

    try {
        const process = spawn('yt-dlp', [
            `ytsearch1:${searchQuery}`,
            '-f', 'bestaudio',
            '--no-playlist',
            '--no-warnings',
            '--buffer-size', '1M', // Add buffer for faster start
            '--socket-timeout', '10',
            '-o', '-',
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Create resource and play immediately
        const resource = createAudioResource(process.stdout, {
            inputType: 'arbitrary'
        });
        
        // Add delay if specified
        if (gameState.playbackDelay > 0) {
            setTimeout(() => {
                player.play(resource);
            }, gameState.playbackDelay * 1000);
        } else {
            player.play(resource);
        }

        process.on('error', (err) => {
            console.error("❌ yt-dlp spawn error:", err);
        });

        return player;

    } catch (err) {
        console.error("❌ YouTube play error:", err);
        return null;
    }
}

// -------- MULTIPLE CHOICE OPTIONS GENERATOR --------
function generateMultipleChoiceOptions(correctSong, allTracks, type = 'title') {
    const options = [correctSong];
    const used = new Set([correctSong.title + correctSong.artist]);
    
    // Get 3 random wrong options
    while (options.length < 4) {
        const randomTrack = allTracks[Math.floor(Math.random() * allTracks.length)];
        const key = randomTrack.title + randomTrack.artist;
        
        if (!used.has(key)) {
            options.push(randomTrack);
            used.add(key);
        }
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
    return 1 - (distance / maxLength);
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

// -------- DISCORD CLIENT & COMMANDS --------
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

// Handle button/select menu interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    if (interaction.customId === 'song_options' && gameState.isPlaying) {
        const selectedValue = interaction.values[0];
        const selectedOption = gameState.currentOptions.find(opt => opt.value === selectedValue);
        
        if (selectedOption && selectedOption.isCorrect) {
            const userId = interaction.user.id;
            const timeBonus = Math.max(1, Math.floor((gameState.timeLimit - (Date.now() - gameState.roundStartTime)) / 1000));
            const points = Math.max(1, Math.floor(timeBonus / 5));
            
            gameState.playerScores[userId] = (gameState.playerScores[userId] || 0) + points;

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🎉 Correct Answer!')
                .setDescription(`<@${userId}> selected the right answer!`)
                .addFields(
                    { name: 'Song', value: `**${gameState.currentSong.title}**`, inline: true },
                    { name: 'Artist', value: `**${gameState.currentSong.artist}**`, inline: true },
                    { name: 'Points Earned', value: `**+${points}**`, inline: true }
                );

            await interaction.reply({ embeds: [embed] });
            
            clearTimeout(gameState.timeoutId);
            gameState.isPlaying = false;
            if (gameState.player) gameState.player.stop();

            setTimeout(() => {
                const member = interaction.guild.members.cache.get(userId);
                const voiceChannel = member?.voice?.channel;
                if (gameState.currentRound < gameState.totalRounds && voiceChannel) {
                    startNextRound(interaction, voiceChannel);
                } else {
                    endGame(interaction);
                }
            }, 3000);
        } else {
            await interaction.reply({ content: '❌ Wrong answer! Keep trying!', ephemeral: true });
        }
    }

    // Handle game setup buttons
    if (interaction.customId.startsWith('setup_')) {
        const action = interaction.customId.split('_')[1];
        
        switch (action) {
            case 'mode':
                gameState.gameMode = gameState.gameMode === 'multiple_choice' ? 'open_answer' : 'multiple_choice';
                break;
            case 'difficulty':
                const difficulties = ['easy', 'medium', 'hard'];
                const currentIndex = difficulties.indexOf(gameState.difficulty);
                gameState.difficulty = difficulties[(currentIndex + 1) % difficulties.length];
                gameState.timeLimit = gameState.difficulty === 'easy' ? 45000 : 
                                      gameState.difficulty === 'medium' ? 30000 : 15000;
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
    
    if (interaction.customId === 'start_game') {
        await interaction.deferReply();
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.followUp("⚠️ You need to be in a voice channel to start a game.");
        }
        
        if (gameState.tracks.length === 0) {
            return interaction.followUp("⚠️ Load a playlist first with `!fetch <spotify_url>`.");
        }

        gameState.isPlaying = true;
        gameState.currentRound = 0;
        gameState.playerScores = {};
        gameState.usedTracks.clear();
        gameState.gameChannel = interaction.channel;

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎮 Game Starting!')
            .setDescription(`**${gameState.totalRounds} rounds** • **${gameState.difficulty}** difficulty • **${gameState.gameMode}** mode`)
            .addFields(
                { name: 'Time per round', value: `${gameState.timeLimit / 1000} seconds`, inline: true },
                { name: 'Voice Channel', value: voiceChannel.name, inline: true },
                { name: 'Playback Delay', value: `${gameState.playbackDelay} seconds`, inline: true }
            );

        await interaction.followUp({ embeds: [embed] });
        setTimeout(() => startNextRound(interaction, voiceChannel), 2000);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.split(" ");
    const command = args.shift().toLowerCase();

    if (command === "!help") {
        const helpEmbed = new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle('🎵 Guess the Song Bot Commands')
            .addFields(
                { name: '!fetch <playlist_url>', value: 'Load songs from Spotify playlist', inline: false },
                { name: '!setup', value: 'Interactive game setup with options', inline: false },
                { name: '!startgame [rounds] [difficulty]', value: 'Quick start game (default: 5 rounds, medium)', inline: false },
                { name: '!settings', value: 'View current game settings', inline: false },
                { name: '!leaderboard', value: 'Show current scores', inline: false },
                { name: '!skip', value: 'Skip current song (majority vote)', inline: false },
                { name: '!hint', value: 'Get a hint (limited per round)', inline: false },
                { name: '!stop', value: 'Stop the current game', inline: false },
            )
            .setFooter({ text: 'Use !setup for interactive configuration!' });
        return message.reply({ embeds: [helpEmbed] });
    }

    if (command === "!setup") {
        const embed = new EmbedBuilder()
            .setColor('#9146FF')
            .setTitle('🎮 Game Setup')
            .setDescription('Configure your game settings:')
            .addFields(
                { name: 'Game Mode', value: `**${gameState.gameMode.replace('_', ' ').toUpperCase()}**`, inline: true },
                { name: 'Difficulty', value: `**${gameState.difficulty.toUpperCase()}** (${gameState.timeLimit/1000}s)`, inline: true },
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

    if (command === "!fetch") {
        const playlistUrl = args[0];
        if (!playlistUrl) {
            return message.reply("⚠️ Please provide a Spotify playlist URL.");
        }

        const playlistId = getPlaylistIdFromUrl(playlistUrl);
        if (!playlistId) {
            return message.reply("⚠️ Invalid Spotify playlist URL format.");
        }

        try {
            const loadingMessage = await message.channel.send("🎶 Fetching songs from Spotify...");
            const playlistInfo = await spotifyApi.getPlaylist(playlistId);
            
            let allTracks = [];
            let offset = 0;
            const limit = 50;
            
            do {
                const data = await spotifyApi.getPlaylistTracks(playlistId, { 
                    limit: limit, 
                    offset: offset 
                });
                
                const tracks = data.body.items
                    .filter(item => item.track)
                    .map(item => ({
                        title: item.track.name,
                        artist: item.track.artists.map(a => a.name).join(", "),
                    }));
                
                allTracks = allTracks.concat(tracks);
                offset += limit;
                
                if (data.body.items.length < limit) break;
            } while (offset < 500);

            gameState.tracks = allTracks;
            gameState.usedTracks.clear();

            const embed = new EmbedBuilder()
                .setColor('#1DB954')
                .setTitle(`✅ Playlist Loaded: ${playlistInfo.body.name}`)
                .setDescription(`**${gameState.tracks.length}** playable tracks loaded!`)
                .addFields(
                    { name: 'Ready to play?', value: 'Use `!setup` or `!startgame` to begin!', inline: false }
                )
                .setThumbnail(playlistInfo.body.images[0]?.url);
            
            await loadingMessage.edit({ content: '', embeds: [embed] });
        } catch (err) {
            console.error("Fetch error:", err);
            if (err.statusCode === 401) {
                await getSpotifyAccessToken();
                return message.reply("🔄 Token expired. Please try again.");
            }
            message.reply("❌ Failed to fetch playlist. Make sure it's public and the URL is correct.");
        }
    }

    else if (command === "!settings") {
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('⚙️ Current Game Settings')
            .addFields(
                { name: 'Game Mode', value: `${gameState.gameMode.replace('_', ' ')}`, inline: true },
                { name: 'Rounds', value: `${gameState.totalRounds}`, inline: true },
                { name: 'Difficulty', value: `${gameState.difficulty}`, inline: true },
                { name: 'Time Limit', value: `${gameState.timeLimit / 1000}s`, inline: true },
                { name: 'Playback Delay', value: `${gameState.playbackDelay}s`, inline: true },
                { name: 'Loaded Songs', value: `${gameState.tracks.length}`, inline: true },
                { name: 'Max Hints', value: `${gameState.maxHints} per round`, inline: true },
            );
        return message.reply({ embeds: [embed] });
    }

    else if (command === "!startgame") {
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

        const requestedRounds = parseInt(args[0]);
        if (!isNaN(requestedRounds) && requestedRounds > 0) {
            gameState.totalRounds = Math.min(20, requestedRounds);
        }

        const requestedDifficulty = args[1]?.toLowerCase();
        if (['easy', 'medium', 'hard'].includes(requestedDifficulty)) {
            gameState.difficulty = requestedDifficulty;
            gameState.timeLimit = requestedDifficulty === 'easy' ? 45000 : 
                                  requestedDifficulty === 'medium' ? 30000 : 15000;
        }

        gameState.isPlaying = true;
        gameState.currentRound = 0;
        gameState.playerScores = {};
        gameState.usedTracks.clear();
        gameState.gameChannel = message.channel;

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎮 Game Starting!')
            .setDescription(`**${gameState.totalRounds} rounds** • **${gameState.difficulty}** difficulty • **${gameState.gameMode}** mode`)
            .addFields(
                { name: 'Time per round', value: `${gameState.timeLimit / 1000} seconds`, inline: true },
                { name: 'Voice Channel', value: voiceChannel.name, inline: true }
            );

        await message.reply({ embeds: [embed] });
        setTimeout(() => startNextRound(message, voiceChannel), 2000);
    }

    else if (command === "!skip") {
        if (!gameState.isPlaying || !gameState.currentSong) {
            return message.reply("⚠️ No active round to skip.");
        }
        skipCurrentRound(message);
    }

    else if (command === "!hint") {
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

    else if (command === "!stop") {
        if (!gameState.isPlaying) {
            return message.reply("⚠️ No active game to stop.");
        }
        endGame(message, true);
        return message.reply("🛑 Game stopped by user.");
    }

    else if (command === "!leaderboard") {
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
            .setTitle('🏆 Leaderboard')
            .setDescription(leaderboard)
            .addFields(
                { name: 'Round', value: `${gameState.currentRound}/${gameState.totalRounds}`, inline: true }
            );
        return message.reply({ embeds: [embed] });
    }

    // Open answer mode guessing
    else if (gameState.isPlaying && gameState.currentSong && gameState.gameMode === 'open_answer' && message.channel === gameState.gameChannel) {
        const guess = message.content;
        const titleSimilarity = calculateSimilarity(guess, gameState.currentSong.title);
        const artistSimilarity = calculateSimilarity(guess, gameState.currentSong.artist);
        
        if (titleSimilarity > 0.8 || artistSimilarity > 0.8) {
            const userId = message.author.id;
            const timeBonus = Math.max(1, Math.floor((gameState.timeLimit - (Date.now() - gameState.roundStartTime)) / 1000));
            const points = Math.max(1, Math.floor(timeBonus / 5));
            
            gameState.playerScores[userId] = (gameState.playerScores[userId] || 0) + points;

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🎉 Correct Guess!')
                .setDescription(`<@${userId}> got it right!`)
                .addFields(
                    { name: 'Song', value: `**${gameState.currentSong.title}**`, inline: true },
                    { name: 'Artist', value: `**${gameState.currentSong.artist}**`, inline: true },
                    { name: 'Points Earned', value: `**+${points}**`, inline: true }
                );

            await message.channel.send({ embeds: [embed] });
            
            clearTimeout(gameState.timeoutId);
            gameState.isPlaying = false;
            if (gameState.player) gameState.player.stop();

            setTimeout(() => {
                const voiceChannel = message.member?.voice?.channel;
                if (gameState.currentRound < gameState.totalRounds && voiceChannel) {
                    startNextRound(message, voiceChannel);
                } else {
                    endGame(message);
                }
            }, 3000);
        }
        else if (titleSimilarity > 0.5 || artistSimilarity > 0.5) {
            message.react('🔥');
        } else if (titleSimilarity > 0.3 || artistSimilarity > 0.3) {
            message.react('👍');
        }
    }
});

// -------- HELPER FUNCTION FOR SETUP UPDATES --------
async function updateSetupMessage(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#9146FF')
        .setTitle('🎮 Game Setup')
        .setDescription('Configure your game settings:')
        .addFields(
            { name: 'Game Mode', value: `**${gameState.gameMode.replace('_', ' ').toUpperCase()}**`, inline: true },
            { name: 'Difficulty', value: `**${gameState.difficulty.toUpperCase()}** (${gameState.timeLimit/1000}s)`, inline: true },
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

// -------- ENHANCED GAME FLOW FUNCTIONS --------
async function startNextRound(message, voiceChannel) {
    gameState.currentRound++;
    
    if (gameState.currentRound > gameState.totalRounds) {
        return endGame(message);
    }

    const availableTracks = gameState.tracks.filter((_, index) => !gameState.usedTracks.has(index));
    if (availableTracks.length === 0) {
        gameState.usedTracks.clear();
    }
    
    const randomIndex = Math.floor(Math.random() * gameState.tracks.length);
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
        )
        .setFooter({ text: gameState.gameMode === 'multiple_choice' ? 'Select from the options below!' : 'Type your guess in chat!' });

    const components = [];
    
    // Add multiple choice component if in that mode
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

    const sentMessage = await message.channel.send({ 
        embeds: [embed], 
        components: components 
    });

    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        gameState.connection = connection;
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

        // Add playback delay notification
        if (gameState.playbackDelay > 0) {
            await message.channel.send(`⏱️ Audio will start in ${gameState.playbackDelay} seconds...`);
        }

        const player = await findAndPlayYouTubeAudio(connection, gameState.currentSong.title, gameState.currentSong.artist);
        gameState.player = player;

        if (player) {
            gameState.timeoutId = setTimeout(() => {
                if (gameState.isPlaying) {
                    skipCurrentRound(message);
                }
            }, gameState.timeLimit);

            player.on(AudioPlayerStatus.Idle, () => {
                if (gameState.isPlaying) {
                    skipCurrentRound(message);
                }
            });

            player.on('error', (error) => {
                console.error('Player error:', error);
                if (gameState.isPlaying) {
                    skipCurrentRound(message);
                }
            });
        } else {
            setTimeout(() => skipCurrentRound(message), 3000);
        }
    } catch (err) {
        console.error("Round error:", err);
        message.channel.send("❌ Error starting round. Skipping...");
        setTimeout(() => {
            if (gameState.currentRound < gameState.totalRounds) {
                startNextRound(message, voiceChannel);
            } else {
                endGame(message);
            }
        }, 2000);
    }
}

function skipCurrentRound(message) {
    if (!gameState.isPlaying) return;
    
    clearTimeout(gameState.timeoutId);
    gameState.isPlaying = false;
    
    if (gameState.player) {
        gameState.player.stop();
        gameState.player = null;
    }
    
    if (gameState.connection) {
        gameState.connection.destroy();
        gameState.connection = null;
    }

    const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('⏭️ Round Skipped')
        .setDescription('Time\'s up or song skipped!')
        .addFields(
            { name: 'Song', value: `**${gameState.currentSong.title}**`, inline: true },
            { name: 'Artist', value: `**${gameState.currentSong.artist}**`, inline: true }
        );

    message.channel.send({ embeds: [embed] });

    setTimeout(() => {
        const voiceChannel = message.member?.voice?.channel;
        if (gameState.currentRound < gameState.totalRounds && voiceChannel) {
            startNextRound(message, voiceChannel);
        } else {
            endGame(message);
        }
    }, 3000);
}

function endGame(message, forced = false) {
    gameState.isPlaying = false;
    clearTimeout(gameState.timeoutId);
    
    if (gameState.connection) {
        gameState.connection.destroy();
        gameState.connection = null;
    }
    
    if (gameState.player) {
        gameState.player.stop();
        gameState.player = null;
    }

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
    }

    const channelToSend = message.channel || gameState.gameChannel;
    if (channelToSend) {
        channelToSend.send({ embeds: [embed] });
    }
}

function generateHints(song) {
    const hints = [
        `First letter of the title: **${song.title.charAt(0).toUpperCase()}**`,
        `Artist starts with: **${song.artist.split(',')[0].trim().charAt(0).toUpperCase()}**`,
        `Song title has **${song.title.length}** letters.`
    ];
    return hints;
}

// -------- ERROR HANDLING --------
process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

// -------- LOGIN --------
client.login(process.env.DISCORD_TOKEN);