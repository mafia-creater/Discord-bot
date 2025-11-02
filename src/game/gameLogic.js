const { gameState, playerStats, playerAchievements, achievements } = require('./gameState');

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

function generateHints(song) {
    const hints = [
        `First letter of the title: **${song.title.charAt(0).toUpperCase()}**`,
        `Number of words in title: **${song.title.split(' ').length}**`,
        `Artist starts with: **${song.artist.charAt(0).toUpperCase()}**`
    ];
    return hints;
}

module.exports = {
    updatePlayerStats,
    checkAchievements,
    generateMultipleChoiceOptions,
    calculateSimilarity,
    levenshteinDistance,
    generateHints
};