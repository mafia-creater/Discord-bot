const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { gameState } = require('../game/gameState');
const { updatePlayerStats } = require('../game/gameLogic');
const { initializeGame, startNextRound, endGame } = require('../game/gameFlow');

// -------- INTERACTION HANDLERS --------
async function handleInteraction(interaction) {
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
}

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
        const { cleanupRound } = require('../game/gameFlow');
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

module.exports = {
    handleInteraction,
    handleMultipleChoiceAnswer,
    handleSetupButton,
    handleStartGame,
    updateSetupMessage
};