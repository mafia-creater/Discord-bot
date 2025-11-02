const SpotifyWebApi = require('spotify-web-api-node');
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = require('../config/environment');

// -------- SPOTIFY SETUP --------
const spotifyApi = new SpotifyWebApi({
    clientId: SPOTIFY_CLIENT_ID,
    clientSecret: SPOTIFY_CLIENT_SECRET,
});

class SpotifyTokenManager {
    constructor() {
        this.tokenRefreshTimeout = null;
        this.isRefreshing = false;
        this.tokenExpiresAt = null;
        this.retryCount = 0;
        this.maxRetries = 5;
    }

    async getSpotifyAccessToken() {
        // Prevent multiple simultaneous refresh attempts
        if (this.isRefreshing) {
            console.log("Token refresh already in progress, waiting...");
            return this.waitForRefresh();
        }

        this.isRefreshing = true;

        try {
            const data = await spotifyApi.clientCredentialsGrant();
            spotifyApi.setAccessToken(data.body['access_token']);
            
            this.tokenExpiresAt = Date.now() + (data.body['expires_in'] * 1000);
            this.retryCount = 0; // Reset retry count on success
            
            console.log("✅ Spotify token refreshed");
            
            // Clear existing timeout
            if (this.tokenRefreshTimeout) clearTimeout(this.tokenRefreshTimeout);
            
            // Refresh token 5 minutes before expiry
            const refreshTime = (data.body['expires_in'] - 300) * 1000;
            this.tokenRefreshTimeout = setTimeout(() => {
                this.getSpotifyAccessToken();
            }, refreshTime);

            this.isRefreshing = false;
            return true;
        } catch (err) {
            this.isRefreshing = false;
            this.retryCount++;
            
            console.error(`❌ Error fetching Spotify token (attempt ${this.retryCount}):`, err.message);
            
            // Clear existing timeout
            if (this.tokenRefreshTimeout) clearTimeout(this.tokenRefreshTimeout);
            
            // Exponential backoff with max retry limit
            if (this.retryCount < this.maxRetries) {
                const retryDelay = Math.min(Math.pow(2, this.retryCount) * 1000, 5 * 60 * 1000);
                console.log(`Retrying token refresh in ${retryDelay/1000} seconds...`);
                this.tokenRefreshTimeout = setTimeout(() => {
                    this.getSpotifyAccessToken();
                }, retryDelay);
            } else {
                console.error("❌ Max token refresh retries exceeded. Manual intervention required.");
            }
            
            throw err;
        }
    }

    async waitForRefresh() {
        while (this.isRefreshing) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    isTokenValid() {
        return this.tokenExpiresAt && Date.now() < this.tokenExpiresAt - 60000; // 1 minute buffer
    }

    async ensureValidToken() {
        if (!this.isTokenValid()) {
            await this.getSpotifyAccessToken();
        }
    }
}

const tokenManager = new SpotifyTokenManager();

function getPlaylistIdFromUrl(url) {
    if (!url || typeof url !== 'string') {
        console.log('❌ Invalid URL provided');
        return null;
    }

    // Clean the URL
    const cleanUrl = url.trim();
    
    const patterns = [
        /playlist\/([a-zA-Z0-9]+)/,
        /open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/,
        /spotify:playlist:([a-zA-Z0-9]+)/,
        // Handle URLs with query parameters
        /playlist\/([a-zA-Z0-9]+)\?/,
        /open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)\?/,
    ];
    
    for (const pattern of patterns) {
        const match = cleanUrl.match(pattern);
        if (match && match[1]) {
            const playlistId = match[1];
            // Validate playlist ID format (Spotify IDs are 22 characters, base62)
            if (playlistId.length === 22 && /^[a-zA-Z0-9]+$/.test(playlistId)) {
                console.log(`✅ Extracted playlist ID: ${playlistId}`);
                return playlistId;
            }
        }
    }
    
    console.log(`❌ No valid playlist ID found in URL: ${cleanUrl}`);
    return null;
}

// -------- PLAYLIST VALIDATION --------
async function validatePlaylist(playlistId) {
    try {
        await tokenManager.ensureValidToken();
        
        // Debug: Log the request details
        console.log(`🔍 Validating playlist ID: ${playlistId}`);
        console.log(`🔑 Token set: ${!!spotifyApi.getAccessToken()}`);
        
        // Try a direct API call first to debug
        const axios = require('axios');
        const token = spotifyApi.getAccessToken();
        
        try {
            const response = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    fields: 'id,name,public,tracks.total'
                }
            });
            
            console.log(`✅ Direct API call successful for playlist: ${response.data.name}`);
            
            if (!response.data.public) {
                throw new Error('Playlist is private');
            }
            
            if (response.data.tracks.total === 0) {
                throw new Error('Playlist is empty');
            }
            
            return {
                isValid: true,
                name: response.data.name,
                trackCount: response.data.tracks.total
            };
            
        } catch (axiosError) {
            console.log(`❌ Direct API call failed: ${axiosError.response?.status} - ${axiosError.response?.statusText}`);
            console.log(`Response data:`, axiosError.response?.data);
            
            // Fall back to spotify-web-api-node
            console.log(`🔄 Trying with spotify-web-api-node library...`);
            const playlist = await spotifyApi.getPlaylist(playlistId, { fields: 'id,name,public,tracks.total' });
            
            if (!playlist.body.public) {
                throw new Error('Playlist is private');
            }
            
            if (playlist.body.tracks.total === 0) {
                throw new Error('Playlist is empty');
            }
            
            return {
                isValid: true,
                name: playlist.body.name,
                trackCount: playlist.body.tracks.total
            };
        }
        
    } catch (error) {
        console.error(`❌ Playlist validation error:`, error);
        
        // Provide more helpful error messages
        let errorMessage = error.message || 'Unknown error occurred';
        
        if (error.response?.status === 404 || error.statusCode === 404) {
            errorMessage = `Playlist not found. This could mean:\n• The playlist doesn't exist\n• The playlist is private\n• The playlist ID is incorrect\n\nTry one of these working playlists:\n• Today's Top Hits: 37i9dQZF1DXcBWIGoYBM5M\n• Global Top 50: 37i9dQZEVXbMDoHDwVN2tF\n• Pop Rising: 37i9dQZF1DWUa8ZRTfalHk`;
        } else if (error.response?.status === 403 || error.statusCode === 403) {
            errorMessage = 'Access denied. The playlist might be private or region-restricted.';
        } else if (error.response?.status === 401 || error.statusCode === 401) {
            errorMessage = 'Authentication failed. Token might be expired or invalid.';
        }
        
        return {
            isValid: false,
            error: errorMessage
        };
    }
}

// -------- OPTIMIZED SPOTIFY PLAYLIST FETCHING WITH CACHING --------
const playlistCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

async function fetchSpotifyPlaylist(playlistId, useCache = true) {
    // Check cache first
    if (useCache && playlistCache.has(playlistId)) {
        const cached = playlistCache.get(playlistId);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
            console.log(`📦 Using cached playlist: ${playlistId}`);
            return cached.data;
        }
    }

    try {
        // Validate playlist first
        const validation = await validatePlaylist(playlistId);
        if (!validation.isValid) {
            throw new Error(validation.error);
        }

        console.log(`🎵 Validated playlist: ${validation.name} (${validation.trackCount} tracks)`);

        // Ensure we have a valid token
        await tokenManager.ensureValidToken();

        const playlistInfo = await spotifyApi.getPlaylist(playlistId);
        let allTracks = [];
        let offset = 0;
        const limit = 50;
        const maxTracks = 2000; // Increased limit but still reasonable
        
        console.log(`🔄 Fetching playlist: ${playlistInfo.body.name} (${playlistInfo.body.tracks.total} tracks)`);
        
        while (offset < Math.min(maxTracks, playlistInfo.body.tracks.total)) {
            try {
                const data = await spotifyApi.getPlaylistTracks(playlistId, {
                    limit: limit,
                    offset: offset,
                    fields: 'items(track(name,artists,preview_url,duration_ms,popularity)),next,total'
                });
                
                const tracks = data.body.items
                    .filter(item => 
                        item.track && 
                        item.track.name && 
                        item.track.artists.length > 0 &&
                        item.track.duration_ms > 30000 // At least 30 seconds
                    )
                    .map(item => ({
                        title: item.track.name.trim(),
                        artist: item.track.artists.map(a => a.name).join(", ").trim(),
                        preview_url: item.track.preview_url,
                        duration: item.track.duration_ms,
                        popularity: item.track.popularity || 0
                    }))
                    .filter(track => 
                        track.title.length > 0 && 
                        track.artist.length > 0 &&
                        !track.title.toLowerCase().includes('instrumental') // Filter out instrumentals
                    );
                
                allTracks = allTracks.concat(tracks);
                
                // Progress logging
                const withPreviews = tracks.filter(t => t.preview_url).length;
                console.log(`📊 Batch ${Math.floor(offset/limit) + 1}: ${tracks.length} tracks, ${withPreviews} with previews`);
                
                offset += limit;
                
                if (data.body.items.length < limit) break;
                
                // Rate limiting - small delay between requests
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (trackError) {
                console.error(`Error fetching tracks at offset ${offset}:`, trackError.message);
                
                // If it's a rate limit error, wait longer
                if (trackError.statusCode === 429) {
                    const retryAfter = trackError.headers['retry-after'] || 1;
                    console.log(`Rate limited, waiting ${retryAfter} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    continue; // Retry the same offset
                }
                break;
            }
        }
        
        // Remove duplicates based on title + artist
        const uniqueTracks = [];
        const seen = new Set();
        
        for (const track of allTracks) {
            const key = `${track.title.toLowerCase()}-${track.artist.toLowerCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueTracks.push(track);
            }
        }
        
        // Sort by popularity for better game experience
        uniqueTracks.sort((a, b) => b.popularity - a.popularity);
        
        // Final summary
        const totalWithPreviews = uniqueTracks.filter(t => t.preview_url).length;
        const previewPercentage = Math.round(totalWithPreviews/uniqueTracks.length*100);
        
        console.log(`📊 Playlist Summary: ${uniqueTracks.length} unique tracks, ${totalWithPreviews} (${previewPercentage}%) with Spotify previews`);

        const result = {
            info: playlistInfo.body,
            tracks: uniqueTracks
        };

        // Cache the result
        if (useCache) {
            playlistCache.set(playlistId, {
                data: result,
                timestamp: Date.now()
            });
        }

        return result;
    } catch (error) {
        console.error('Spotify playlist fetch error:', error.message);
        
        // Handle specific error types
        if (error.statusCode === 404) {
            throw new Error('Playlist not found. Please check that the playlist exists and is public.');
        } else if (error.statusCode === 403) {
            throw new Error('Access denied. The playlist might be private or you may not have permission to access it.');
        } else if (error.statusCode === 401 && !tokenManager.isRefreshing) {
            console.log('Token expired, refreshing and retrying...');
            try {
                await tokenManager.getSpotifyAccessToken();
                return fetchSpotifyPlaylist(playlistId, false); // Retry without cache
            } catch (tokenError) {
                throw new Error('Failed to refresh Spotify token. Please try again later.');
            }
        } else if (error.statusCode === 429) {
            const retryAfter = error.headers['retry-after'] || 60;
            throw new Error(`Rate limited by Spotify. Please wait ${retryAfter} seconds and try again.`);
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            throw new Error('Network error. Please check your internet connection and try again.');
        }
        
        // Generic error for unknown issues
        throw new Error(`Spotify API error: ${error.message || 'Unknown error occurred'}`);
    }
}

// -------- CUSTOM PLAYLISTS & CATEGORIES --------
// These are popular Spotify playlists that should be publicly accessible
const customCategories = {
    "today-hits": "37i9dQZF1DXcBWIGoYBM5M",        // Today's Top Hits
    "global-top-50": "37i9dQZEVXbMDoHDwVN2tF",     // Global Top 50
    "viral-50": "37i9dQZEVXbLiRSasKsNU9",          // Viral 50 - Global
    "pop-rising": "37i9dQZF1DWUa8ZRTfalHk",        // Pop Rising
    "rock-classics": "37i9dQZF1DWXRqgorJj26U",     // Rock Classics
    "hip-hop-central": "37i9dQZF1DX0XUsuxWHRQd",   // RapCaviar
    "indie-pop": "37i9dQZF1DX2Nc3B70tvx0",         // Indie Pop
    "chill-hits": "37i9dQZF1DX4WYpdgoIcn6",        // Chill Hits
    "workout": "37i9dQZF1DX76Wlfdnj7AP",           // Beast Mode
    "throwback": "37i9dQZF1DX4o1oenSJRJd"          // Throwback Thursday
};

// Cleanup old playlists from cache periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of playlistCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            playlistCache.delete(key);
        }
    }
}, 10 * 60 * 1000); // Clean every 10 minutes

module.exports = {
    spotifyApi,
    tokenManager,
    getSpotifyAccessToken: () => tokenManager.getSpotifyAccessToken(),
    getPlaylistIdFromUrl,
    fetchSpotifyPlaylist,
    validatePlaylist,
    customCategories
};