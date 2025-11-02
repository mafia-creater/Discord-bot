# 🎵 Discord Guess the Song Bot

A feature-rich Discord bot that lets you play "guess the song" games using Spotify playlists with smart audio playback (Spotify previews + YouTube fallback).

## ✨ Features

- **Smart Audio Playback**: Tries Spotify previews first (instant), falls back to YouTube
- **Multiple Game Modes**: Multiple choice or open answer
- **Spotify Integration**: Load any public Spotify playlist
- **Persistent Voice Connection**: Bot stays in channel between rounds for faster gameplay
- **Rich Statistics**: Player stats, achievements, leaderboards
- **Team Mode**: Create and join teams for collaborative play
- **Power-ups & Daily Challenges**: Enhanced gameplay mechanics
- **Interactive Setup**: Button-based game configuration

## 🚀 Quick Start

### Prerequisites
## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- A Discord bot token (from the Developer Portal)
- Spotify Client ID & Secret
- yt-dlp installed and available on PATH
- FFmpeg installed (required by prism-media / discord voice stack)

### Installation

1. Clone and install dependencies

```powershell
git clone <your-repo>
cd "Discord bot"
npm install
```

2. Create your `.env` from the example

```powershell
copy .env.example .env
# then edit .env and fill the values
```

3. Install yt-dlp

Windows (recommended):

```powershell
# Using Scoop (recommended)
```
src/
├── audio/
│   └── audioManager.js      # Audio playback logic (Spotify + YouTube)
```

macOS / Linux:

```bash
brew install yt-dlp    # macOS with Homebrew
sudo apt install yt-dlp || pip install -U yt-dlp
```

4. Install FFmpeg (required)

Windows (download a static build and add to PATH):

1. Download a build from https://www.gyan.dev/ffmpeg/builds/ or https://ffmpeg.org/download.html
2. Extract and copy the `bin` folder path (example: `C:\ffmpeg\bin`).
3. Add that path to your System Environment Variables PATH and restart your terminal.

macOS / Linux:

```bash
brew install ffmpeg   # macOS
sudo apt install ffmpeg # Debian/Ubuntu
```

5. Start the bot

```powershell
npm start
# or for development
npm run dev
```
├── commands/
│   └── messageCommands.js   # Text command handlers
├── config/
│   └── environment.js       # Environment validation
├── discord/
│   └── interactionHandlers.js # Button/menu interactions
├── game/
│   ├── gameState.js         # Game state management
│   ├── gameLogic.js         # Core game mechanics
│   └── gameFlow.js          # Game flow control
├── spotify/
│   └── spotifyManager.js    # Spotify API integration
└── bot.js                   # Main bot entry point
```

## 🎮 Commands

### Game Commands
- `!fetch <spotify_url>` - Load a Spotify playlist
- `!fetch-category <category>` - Load predefined category
- `!setup` - Interactive game configuration
- `!start [rounds]` - Start a game
- `!stop` - Stop current game

### During Game
- `!skip` - Vote to skip current song
- `!hint` - Get a hint about the current song
- Type your guess directly in chat

### Info Commands
- `!stats [@user]` - View player statistics
- `!leaderboard` - Show top players
- `!categories` - List available categories
- `!help` - Show all commands

### Team Commands
- `!teams create <name>` - Create a team
- `!teams join <name>` - Join a team
- `!teams list` - List all teams

## 🔧 Configuration

The bot supports various game modes and settings:

- **Game Modes**: Multiple choice or open answer
- **Difficulty**: Easy (45s), Medium (30s), Hard (15s)
- **Rounds**: 5-50 rounds per game
- **Playback Delay**: 0-10 second delay before audio starts

## 🎵 Audio System

The bot uses a smart two-tier audio system:

1. **Spotify Previews** (Primary): 30-second official previews, instant playback
2. **YouTube** (Fallback): Full songs via yt-dlp when no preview available

This provides the best of both worlds - speed and reliability.

## 🏗️ Architecture

### Modular Design
- **Separation of Concerns**: Each module handles specific functionality
- **Easy Maintenance**: Clear file structure makes updates simple
- **Extensible**: Easy to add new features or commands

### Key Modules
- **Audio Manager**: Handles all audio playback logic
- **Game State**: Centralized state management
- **Spotify Manager**: API integration and playlist handling
- **Game Flow**: Controls game progression and rounds

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

MIT — see `LICENSE` for details.

## 🐛 Troubleshooting

### Common Issues

**Bot not playing audio:**
- Ensure yt-dlp is installed and in PATH
- Check voice channel permissions
- Verify Spotify credentials

**Spotify previews not working:**
- Many songs don't have previews - this is normal
- Bot will automatically fall back to YouTube

**Connection issues:**
- Bot reuses voice connections for better performance
- Connections are cleaned up automatically

### Debug Mode

Set environment variable for detailed logging:
```bash
DEBUG=true npm start
```

## 📊 Performance

- **Spotify Previews**: ~1-2 second start time
- **YouTube Fallback**: ~5-15 second start time  
- **Memory Usage**: ~50-100MB typical
- **Connection Reuse**: Eliminates join/leave delays

---

## 🎃 Hacktoberfest 2025

This project is officially participating in **Hacktoberfest 2025!**  
Whether you're a beginner or an experienced developer, you're welcome to contribute.

### 💻 How to Contribute
1. **Fork** the repository  
2. **Create a new branch** for your feature or fix  
   ```bash
   git checkout -b feature/your-feature-name
