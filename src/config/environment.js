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

module.exports = {
    validateEnvironment,
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    DISCORD_TOKEN: process.env.DISCORD_TOKEN
};