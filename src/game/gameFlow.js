const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const { gameState, playerStats } = require('./gameState');
const { generateMultipleChoiceOptions } = require('./gameLogic');
const { findAndPlayAudio } = require('../audio/audioManager');
const { spotifyApi } = require('../spotify/spotifyManager');

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
    const availableIndices = Array.from({length: gameState.tracks.length}, (_, i) => i)
        .filter(i => !gameState.usedTracks.has(i));
    
    if (availableIndices.length === 0) {
        gameState.usedTracks.clear();
        availableIndices.push(...Array.from({length: gameState.tracks.length}, (_, i) => i));
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
    const MAX_CONNECTION_RETRIES = 3;
    let connectionRetries = 0;

    while (connectionRetries < MAX_CONNECTION_RETRIES) {
        try {
            // Add playback delay if configured
            if (gameState.playbackDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, gameState.playbackDelay * 1000));
            }

            // Enhanced connection management
            let connection = gameState.connection;
            
            const needsNewConnection = !connection || 
                connection.state.status === VoiceConnectionStatus.Destroyed || 
                connection.state.status === VoiceConnectionStatus.Disconnected ||
                connection.state.status === VoiceConnectionStatus.Signalling;
            
            if (needsNewConnection) {
                console.log('Creating new voice connection...');
                
                // Clean up old connection
                if (connection) {
                    try {
                        connection.destroy();
                    } catch (e) {
                        console.log('Error cleaning up old connection:', e.message);
                    }
                }
                
                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });
                gameState.connection = connection;
                
                // Enhanced connection event handlers
                connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
                    console.log('Voice connection disconnected, attempting reconnection...');
                    try {
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                        ]);
                        console.log('Voice connection recovered');
                    } catch (error) {
                        console.log('Connection lost permanently, will reconnect on next round');
                        gameState.connection = null;
                    }
                });

                connection.on('error', (error) => {
                    console.error('Voice connection error:', error);
                    gameState.connection = null;
                });
            } else {
                console.log('Reusing existing voice connection');
            }
            
            // Wait for connection to be ready with timeout
            await entersState(connection, VoiceConnectionStatus.Ready, 20000);
            
            // Try smart audio playback with enhanced error handling
            let player;
            try {
                gameState.updateActivity(); // Update activity timestamp
                player = await findAndPlayAudio(connection, gameState.currentSong, spotifyApi);
            } catch (primaryError) {
                console.log('Primary audio method failed, trying simplified search...');
                console.error('Primary error:', primaryError.message);
                
                // Try with simplified search query
                const simplifiedSong = {
                    title: gameState.currentSong.title.split('(')[0].split('[')[0].trim(),
                    artist: gameState.currentSong.artist.split(',')[0].trim(),
                    preview_url: null // No preview for simplified search
                };
                
                try {
                    player = await findAndPlayAudio(connection, simplifiedSong, spotifyApi);
                } catch (fallbackError) {
                    console.error('Fallback audio also failed:', fallbackError.message);
                    throw new Error(`All audio methods failed: ${primaryError.message} | ${fallbackError.message}`);
                }
            }
            
            gameState.player = player;

            // Enhanced player error handling
            player.on('error', (error) => {
                console.error('Player error during playback:', {
                    message: error.message,
                    song: `${gameState.currentSong.title} by ${gameState.currentSong.artist}`,
                    code: error.code
                });
                
                // Only notify channel for critical errors
                if (error.message.includes('timeout') || error.message.includes('network')) {
                    if (gameState.gameChannel) {
                        gameState.gameChannel.send('⚠️ Network issue detected, but the round continues!');
                    }
                }
            });

            player.on(AudioPlayerStatus.Idle, () => {
                console.log('Audio finished playing');
            });

            player.on(AudioPlayerStatus.Playing, () => {
                console.log('Audio is now playing successfully');
            });

            // If we get here, everything worked
            break;

        } catch (error) {
            connectionRetries++;
            console.error(`Connection/Audio error (attempt ${connectionRetries}/${MAX_CONNECTION_RETRIES}):`, error.message);
            
            if (connectionRetries < MAX_CONNECTION_RETRIES) {
                console.log(`Retrying connection in 3 seconds...`);
                
                // Clean up failed connection
                if (gameState.connection) {
                    try {
                        gameState.connection.destroy();
                    } catch (e) {
                        console.log('Error cleaning up failed connection:', e.message);
                    }
                    gameState.connection = null;
                }
                
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                console.error('Max connection retries exceeded');
                throw error;
            }
        }
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

    // Don't destroy connection between rounds - keep it alive for faster transitions
    // Only destroy when game ends or there's an error
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
    
    // Destroy connection when game actually ends
    if (gameState.connection) {
        try {
            gameState.connection.destroy();
        } catch (error) {
            console.log('Error destroying connection:', error.message);
        }
        gameState.connection = null;
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

module.exports = {
    initializeGame,
    startNextRound,
    playRoundAudio,
    cleanupRound,
    skipCurrentRound,
    endGame
};