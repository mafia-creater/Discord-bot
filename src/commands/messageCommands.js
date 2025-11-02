const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { gameState, playerStats, skipVotes, requiredVotes, customCategories } = require('../game/gameState');
const { generateHints, calculateSimilarity } = require('../game/gameLogic');
const { fetchSpotifyPlaylist, getPlaylistIdFromUrl, customCategories: spotifyCategories } = require('../spotify/spotifyManager');
const { initializeGame, endGame, skipCurrentRound } = require('../game/gameFlow');

// -------- MESSAGE COMMANDS --------
async function handleFetchCommand(message, args) {
    if (!args[0]) {
        return message.reply("⚠️ Please provide a Spotify playlist URL.\nExample: `!fetch https://open.spotify.com/playlist/37i9dQZF1DXbTxeAdrVG2l`");
    }

    const playlistId = getPlaylistIdFromUrl(args[0]);
    if (!playlistId) {
        return message.reply("❌ Invalid Spotify playlist URL. Please check the URL and try again.");
    }

    const loadingMessage = await message.reply("🔄 Validating playlist...");

    try {
        // First validate the playlist
        const { validatePlaylist } = require('../spotify/spotifyManager');
        const validation = await validatePlaylist(playlistId);
        
        if (!validation.isValid) {
            return loadingMessage.edit(`❌ ${validation.error}`);
        }

        await loadingMessage.edit("🔄 Loading playlist tracks...");
        const { info, tracks } = await fetchSpotifyPlaylist(playlistId);

        if (tracks.length === 0) {
            return loadingMessage.edit("❌ No valid tracks found in this playlist.");
        }

        gameState.tracks = tracks;
        gameState.usedTracks.clear();

        const embed = new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle('✅ Playlist Loaded Successfully!')
            .setDescription(`**${info.name}**`)
            .addFields(
                { name: '📊 Total Tracks', value: `${tracks.length}`, inline: true },
                { name: '👤 Owner', value: info.owner.display_name, inline: true },
                { name: '🎵 Ready to Play', value: 'Use `!start` to begin!', inline: true }
            )
            .setThumbnail(info.images[0]?.url || null)
            .setFooter({ text: `Playlist ID: ${playlistId}` });

        await loadingMessage.edit({ content: null, embeds: [embed] });
    } catch (error) {
        console.error("Error fetching playlist:", error);
        
        let errorMessage;
        if (error.message.includes('not found')) {
            errorMessage = "❌ Playlist not found. Please check the URL and make sure the playlist exists and is public.";
        } else if (error.message.includes('private')) {
            errorMessage = "❌ This playlist is private. Please make sure the playlist is public or use a different playlist.";
        } else if (error.message.includes('Rate limited')) {
            errorMessage = "❌ Too many requests to Spotify. Please wait a moment and try again.";
        } else if (error.message.includes('Network error')) {
            errorMessage = "❌ Network connection issue. Please check your internet and try again.";
        } else if (error.message.includes('token')) {
            errorMessage = "❌ Spotify authentication issue. Please try again in a few moments.";
        } else {
            errorMessage = `❌ Failed to load playlist: ${error.message}`;
        }
        
        await loadingMessage.edit(errorMessage);
    }
}

async function handleFetchCategoryCommand(message, args) {
    if (!args[0]) {
        const categories = Object.keys(spotifyCategories).join(', ');
        return message.reply(`⚠️ Please specify a category.\nAvailable: ${categories}\nExample: \`!fetch-category 90s-hits\``);
    }

    const category = args[0].toLowerCase();
    const playlistId = spotifyCategories[category];

    if (!playlistId) {
        const categories = Object.keys(spotifyCategories).join(', ');
        return message.reply(`❌ Category not found.\nAvailable: ${categories}`);
    }

    const loadingMessage = await message.reply(`🔄 Loading ${category} playlist...`);

    try {
        const { info, tracks } = await fetchSpotifyPlaylist(playlistId);
        gameState.tracks = tracks;
        gameState.usedTracks.clear();

        const embed = new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle(`✅ ${category.toUpperCase()} Loaded!`)
            .setDescription(`**${info.name}**`)
            .addFields(
                { name: '📊 Total Tracks', value: `${tracks.length}`, inline: true },
                { name: '🎵 Ready to Play', value: 'Use `!start` to begin!', inline: true }
            )
            .setThumbnail(info.images[0]?.url || null);

        await loadingMessage.edit({ content: null, embeds: [embed] });
    } catch (error) {
        console.error("Error fetching category playlist:", error);
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

async function handleStartGameCommand(message, args) {
    if (gameState.isPlaying) {
        return message.reply("⚠️ A game is already in progress!");
    }

    if (gameState.tracks.length === 0) {
        return message.reply("⚠️ No playlist loaded! Use `!fetch <spotify_url>` first.");
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        return message.reply("⚠️ You need to be in a voice channel to start a game.");
    }

    // Parse optional rounds argument
    if (args[0] && !isNaN(args[0])) {
        const rounds = parseInt(args[0]);
        if (rounds >= 1 && rounds <= 50) {
            gameState.totalRounds = rounds;
        }
    }

    await initializeGame(message, voiceChannel);
}

// Add other command handlers here...
async function handleHelpCommand(message) {
    const helpEmbed = new EmbedBuilder()
        .setColor('#9146FF')
        .setTitle('🎵 Guess the Song Bot - Commands')
        .setDescription('Here are all available commands:')
        .addFields(
            { name: '🎮 Game Commands', value: '`!fetch <url>` - Load Spotify playlist\n`!setup` - Interactive game setup\n`!start [rounds]` - Start game\n`!stop` - Stop current game', inline: false },
            { name: '🎯 During Game', value: '`!skip` - Vote to skip song\n`!hint` - Get a hint\nJust type your guess!', inline: false },
            { name: '📊 Info Commands', value: '`!stats [@user]` - View statistics\n`!leaderboard` - Top players\n`!categories` - Available categories', inline: false },
            { name: '👥 Team Commands', value: '`!teams create <name>` - Create team\n`!teams join <name>` - Join team\n`!teams list` - List teams', inline: false }
        )
        .setFooter({ text: 'Use !setup for interactive configuration!' });
    return message.reply({ embeds: [helpEmbed] });
}

async function handleTestCommand(message, args) {
    if (!args[0]) {
        return message.reply("⚠️ Please provide a Spotify playlist URL to test.\nExample: `!test https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M`");
    }

    const playlistId = getPlaylistIdFromUrl(args[0]);
    if (!playlistId) {
        return message.reply("❌ Invalid Spotify playlist URL format.\n\n**Valid formats:**\n• `https://open.spotify.com/playlist/ID`\n• `spotify:playlist:ID`");
    }

    const testMessage = await message.reply("🔍 Testing playlist...");

    try {
        const { validatePlaylist } = require('../spotify/spotifyManager');
        const validation = await validatePlaylist(playlistId);
        
        if (validation.isValid) {
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Playlist Valid!')
                .setDescription(`**${validation.name}**`)
                .addFields(
                    { name: '📊 Total Tracks', value: `${validation.trackCount}`, inline: true },
                    { name: '🆔 Playlist ID', value: playlistId, inline: true },
                    { name: '✅ Status', value: 'Ready to use with `!fetch`', inline: true }
                );
            
            await testMessage.edit({ content: null, embeds: [embed] });
        } else {
            await testMessage.edit(`❌ Playlist test failed: ${validation.error}`);
        }
    } catch (error) {
        console.error("Error testing playlist:", error);
        await testMessage.edit(`❌ Test failed: ${error.message}`);
    }
}

// Export all command handlers
module.exports = {
    handleFetchCommand,
    handleFetchCategoryCommand,
    handleSetupCommand,
    handleStartGameCommand,
    handleHelpCommand,
    handleTestCommand
    // Add other handlers as needed
};