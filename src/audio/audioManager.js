const { spawn } = require('child_process');
const https = require('https');
const { PassThrough } = require('stream');
const { createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');

// Audio cache to prevent re-downloading same songs
const audioCache = new Map();
const MAX_CACHE_SIZE = 50;

// Connection pool for better resource management
const connectionPool = new Map();

// -------- OPTIMIZED AUDIO PLAYBACK WITH CACHING AND RETRY LOGIC --------
async function findAndPlayAudio(connection, song, spotifyApi, retryCount = 0) {
    const MAX_RETRIES = 2;
    const cacheKey = `${song.title}-${song.artist}`.toLowerCase().replace(/[^\w]/g, '');

    try {
        const player = createAudioPlayer();
        connection.subscribe(player);

        // Enhanced player error handling with retry logic
        player.on('error', (error) => {
            console.log(`Audio error: ${error.message}`);
            if (retryCount < MAX_RETRIES) {
                console.log(`Retrying audio playback (${retryCount + 1}/${MAX_RETRIES})...`);
                setTimeout(() => {
                    findAndPlayAudio(connection, song, spotifyApi, retryCount + 1);
                }, 2000);
            }
        });

        player.on(AudioPlayerStatus.Idle, () => {
            console.log('Audio playback completed');
        });

        // Check cache first
        if (audioCache.has(cacheKey)) {
            console.log(`🎵 Using cached audio for: ${song.title}`);
            const cachedData = audioCache.get(cacheKey);
            await playCachedAudio(player, cachedData);
            return player;
        }

        console.log(`🎵 Song: ${song.title} by ${song.artist}`);
        console.log(`🔗 Preview URL: ${song.preview_url ? 'Available' : 'Not available'}`);

        // Try Spotify preview first
        if (song.preview_url) {
            try {
                console.log(`🎵 Using Spotify preview for: ${song.title} by ${song.artist}`);
                await playSpotifyPreview(player, song.preview_url, song.title, song.artist);
                // Cache successful preview
                cacheAudioData(cacheKey, { type: 'spotify', url: song.preview_url });
                return player;
            } catch (error) {
                console.log(`Spotify preview failed: ${error.message}, trying search...`);
            }
        }

        // Try to search for the track on Spotify to get preview URL
        try {
            console.log(`🔍 Searching Spotify for preview: ${song.title} by ${song.artist}`);
            const searchResult = await searchSpotifyForPreview(song.title, song.artist, spotifyApi);
            if (searchResult && searchResult.preview_url) {
                console.log(`🎵 Found Spotify preview via search!`);
                await playSpotifyPreview(player, searchResult.preview_url, song.title, song.artist);
                // Cache successful search result
                cacheAudioData(cacheKey, { type: 'spotify', url: searchResult.preview_url });
                return player;
            }
        } catch (error) {
            console.log(`Spotify search failed: ${error.message}`);
        }

        // Fallback to YouTube with enhanced error handling
        console.log(`🔍 Searching YouTube: ${song.title} by ${song.artist}`);
        await playFromYouTube(player, song.title, song.artist);
        return player;

    } catch (error) {
        console.error(`Critical audio error: ${error.message}`);
        if (retryCount < MAX_RETRIES) {
            console.log(`Retrying entire audio process (${retryCount + 1}/${MAX_RETRIES})...`);
            return findAndPlayAudio(connection, song, spotifyApi, retryCount + 1);
        }
        throw error;
    }
}

function cacheAudioData(key, data) {
    // Implement LRU cache
    if (audioCache.size >= MAX_CACHE_SIZE) {
        const firstKey = audioCache.keys().next().value;
        audioCache.delete(firstKey);
    }
    audioCache.set(key, data);
}

async function playCachedAudio(player, cachedData) {
    if (cachedData.type === 'spotify') {
        await playSpotifyPreview(player, cachedData.url, 'Cached Song', 'Cached Artist');
    }
    // Add other cache types as needed
}

async function searchSpotifyForPreview(title, artist, spotifyApi) {
    const MAX_SEARCH_RETRIES = 3;
    let retryCount = 0;

    while (retryCount < MAX_SEARCH_RETRIES) {
        try {
            // Try multiple search strategies
            const searchQueries = [
                `track:"${title}" artist:"${artist}"`,
                `"${title}" "${artist}"`,
                `${title} ${artist}`,
                title // Last resort - just the title
            ];

            for (const query of searchQueries) {
                const searchResults = await spotifyApi.searchTracks(query, { limit: 5 });

                if (searchResults.body.tracks.items.length > 0) {
                    // Find best match with preview
                    const trackWithPreview = searchResults.body.tracks.items.find(track =>
                        track.preview_url &&
                        (track.name.toLowerCase().includes(title.toLowerCase()) ||
                            track.artists.some(a => a.name.toLowerCase().includes(artist.toLowerCase())))
                    );

                    if (trackWithPreview) {
                        return {
                            preview_url: trackWithPreview.preview_url,
                            title: trackWithPreview.name,
                            artist: trackWithPreview.artists.map(a => a.name).join(", ")
                        };
                    }
                }
            }

            return null;
        } catch (error) {
            retryCount++;
            console.error(`Spotify search error (attempt ${retryCount}):`, error.message);

            if (retryCount < MAX_SEARCH_RETRIES) {
                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
            }
        }
    }

    return null;
}

async function playSpotifyPreview(player, previewUrl, title, artist) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            request.destroy();
            reject(new Error('Spotify preview timeout'));
        }, 15000);

        const request = https.get(previewUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (response) => {
            clearTimeout(timeout);

            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return playSpotifyPreview(player, response.headers.location, title, artist)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }

            try {
                // Buffer the stream for better reliability
                const chunks = [];
                let totalLength = 0;

                response.on('data', (chunk) => {
                    chunks.push(chunk);
                    totalLength += chunk.length;
                });

                response.on('end', () => {
                    try {
                        const buffer = Buffer.concat(chunks, totalLength);
                        const stream = new PassThrough();
                        stream.end(buffer);

                        const resource = createAudioResource(stream, {
                            inputType: 'arbitrary',
                            inlineVolume: true
                        });

                        if (resource.volume) {
                            resource.volume.setVolume(0.5);
                        }

                        player.play(resource);
                        console.log(`✅ Playing Spotify preview: ${title} by ${artist} (${Math.round(totalLength / 1024)}KB)`);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });

                response.on('error', reject);
            } catch (err) {
                reject(err);
            }
        });

        request.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

async function playFromYouTube(player, songTitle, songArtist, retryCount = 0) {
    const MAX_YT_RETRIES = 2;

    return new Promise((resolve, reject) => {
        // Clean and optimize search query
        const cleanTitle = songTitle.replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();
        const cleanArtist = songArtist.split(',')[0].split('&')[0].split('feat')[0].trim();
        const searchQuery = `${cleanTitle} ${cleanArtist}`.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

        console.log(`🔍 YouTube search: "${searchQuery}"`);

        const ytDlpArgs = [
            `ytsearch1:${searchQuery}`,
            '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio[filesize<25M]',
            '--no-playlist',
            '--no-warnings',
            '--buffer-size', '64K',
            '--http-chunk-size', '1M',
            '--socket-timeout', '15',
            '--retries', '2',
            '--fragment-retries', '2',
            '--skip-unavailable-fragments',
            '--abort-on-unavailable-fragment',
            '--max-filesize', '20M',
            '-o', '-'
        ];

        const ytDlpProcess = spawn('yt-dlp', ytDlpArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 30000 // 30 second process timeout
        });

        let hasStarted = false;
        let errorOutput = '';
        let bytesReceived = 0;
        let timeout = null;
        let isResolved = false;

        const audioBuffer = new PassThrough({
            highWaterMark: 1024 * 256, // Increased buffer size
            objectMode: false
        });

        // Enhanced error handling
        ytDlpProcess.stderr.on('data', (data) => {
            const output = data.toString();
            errorOutput += output;

            // Log only important errors
            if (output.includes('ERROR') && !output.includes('unable to write data') && !output.includes('Broken pipe')) {
                console.log('yt-dlp error:', output.trim());
            }
        });

        // Optimized audio data handling
        ytDlpProcess.stdout.on('data', (chunk) => {
            if (isResolved) return;

            bytesReceived += chunk.length;

            if (!audioBuffer.destroyed) {
                audioBuffer.write(chunk);
            }

            // Start playing after sufficient buffering (128KB for better stability)
            if (!hasStarted && bytesReceived > 128 * 1024) {
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
                    console.log(`✅ Playing from YouTube: ${songTitle} by ${songArtist} (${Math.round(bytesReceived / 1024)}KB buffered)`);

                    isResolved = true;
                    resolve();
                } catch (err) {
                    console.error('Audio resource error:', err);
                    cleanup();
                    if (!isResolved) {
                        isResolved = true;
                        handleRetry(err);
                    }
                }
            }
        });

        ytDlpProcess.stdout.on('end', () => {
            if (!audioBuffer.destroyed) {
                audioBuffer.end();
            }
        });

        ytDlpProcess.stdout.on('error', (err) => {
            if (err.code === 'EOF' || err.message.includes('EOF') || err.message.includes('Broken pipe')) {
                console.log('Stream ended normally');
                return;
            }

            if (!hasStarted && !isResolved) {
                cleanup();
                isResolved = true;
                handleRetry(new Error(`Stream error: ${err.message}`));
            }
        });

        ytDlpProcess.on('close', (code) => {
            if (code !== 0 && !hasStarted && !isResolved) {
                cleanup();
                isResolved = true;
                handleRetry(new Error(`yt-dlp failed with code ${code}: ${errorOutput || 'Process failed'}`));
            }
        });

        ytDlpProcess.on('error', (err) => {
            cleanup();
            if (!isResolved) {
                isResolved = true;
                handleRetry(new Error(`Failed to start yt-dlp: ${err.message}`));
            }
        });

        function handleRetry(error) {
            if (retryCount < MAX_YT_RETRIES) {
                console.log(`Retrying YouTube audio (${retryCount + 1}/${MAX_YT_RETRIES})...`);
                setTimeout(() => {
                    playFromYouTube(player, songTitle, songArtist, retryCount + 1)
                        .then(resolve)
                        .catch(reject);
                }, 3000);
            } else {
                reject(error);
            }
        }

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
                }, 3000);
            }
            if (audioBuffer && !audioBuffer.destroyed) {
                audioBuffer.destroy();
            }
        }

        // Increased timeout for better reliability
        timeout = setTimeout(() => {
            if (!hasStarted && !isResolved) {
                console.log('YouTube audio timeout - cleaning up...');
                cleanup();
                isResolved = true;
                handleRetry(new Error('YouTube audio timeout'));
            }
        }, 25000);
    });
}

module.exports = {
    findAndPlayAudio,
    searchSpotifyForPreview,
    playSpotifyPreview,
    playFromYouTube
};