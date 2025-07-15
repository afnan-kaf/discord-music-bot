const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const musicPlayer = require('./utils/musicPlayer');
const musicCommands = require('./commands/music');
const playlistCommands = require('./commands/playlist');
const youtubeCommands = require('./commands/youtube');
const express = require('express');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// HTTP server for Render deployment
const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'FTR Music Bot is running!',
    bot: client.user ? client.user.tag : 'offline',
    uptime: process.uptime(),
    guilds: client.guilds.cache.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    bot: client.user ? 'online' : 'offline',
    queues: musicPlayer.queues ? musicPlayer.queues.size : 0,
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

client.once('ready', () => {
  console.log(`🎵 ${client.user.tag} is online!`);
  client.user.setActivity('🎵 FTR Music from YouTube', { type: 'LISTENING' });
});

// Command handler with updated prefix
client.on('messageCreate', async message => {
  const prefix = 'ftm.';
  
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).split(/ +/);
  const command = args.shift().toLowerCase();

  try {
    // Music commands
    if (command === 'play' || command === 'p') {
      await musicCommands.play(message, args);
    } else if (command === 'pause') {
      await musicCommands.pause(message);
    } else if (command === 'resume') {
      await musicCommands.resume(message);
    } else if (command === 'skip') {
      await musicCommands.skip(message);
    } else if (command === 'queue' || command === 'q') {
      await musicCommands.showQueue(message);
    } else if (command === 'stop') {
      await musicCommands.stop(message);
    }
    
    // Playlist commands
    else if (command === 'create-playlist' || command === 'cp') {
      await playlistCommands.createPlaylist(message, args);
    } else if (command === 'delete-playlist' || command === 'dp') {
      await playlistCommands.deletePlaylist(message, args);
    } else if (command === 'add-song' || command === 'as') {
      await playlistCommands.addSong(message, args);
    } else if (command === 'remove-song' || command === 'rs') {
      await playlistCommands.removeSong(message, args);
    } else if (command === 'my-playlists' || command === 'mp') {
      await playlistCommands.showPlaylists(message);
    } else if (command === 'show-playlist' || command === 'sp') {
      await playlistCommands.showPlaylistSongs(message, args);
    } else if (command === 'play-playlist' || command === 'pp') {
      await playlistCommands.playPlaylist(message, args);
    } else if (command === 'rename-playlist' || command === 'rp') {
      await playlistCommands.renamePlaylist(message, args);
    }
    
    // YouTube integration commands
    else if (command === 'auth-youtube' || command === 'ay') {
      await youtubeCommands.authenticateYouTube(message);
    } else if (command === 'authcode') {
      await youtubeCommands.handleAuthCode(message, args);
    } else if (command === 'import-playlist' || command === 'ip') {
      await youtubeCommands.importPlaylist(message);
    }
    
    // Help command
    else if (command === 'help') {
      await showHelp(message);
    }
  } catch (error) {
    console.error('Command error:', error);
    message.reply('❌ An error occurred while executing the command.');
  }
});

async function showHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle('🎵 FTR Music Bot Commands')
    .setColor('#FF6B6B')
    .addFields(
      { 
        name: '🎶 Music Commands', 
        value: '`ftm.play <song/url>` or `ftm.p` - Play music\n`ftm.pause` - Pause current song\n`ftm.resume` - Resume paused song\n`ftm.skip` - Skip current song\n`ftm.queue` or `ftm.q` - Show current queue\n`ftm.stop` - Stop music and clear queue', 
        inline: false 
      },
      { 
        name: '📝 Playlist Commands', 
        value: '`ftm.create-playlist <name>` or `ftm.cp` - Create playlist\n`ftm.delete-playlist <name>` or `ftm.dp` - Delete playlist\n`ftm.add-song <playlist> <song>` or `ftm.as` - Add song to playlist\n`ftm.remove-song <playlist> <index>` or `ftm.rs` - Remove song from playlist\n`ftm.my-playlists` or `ftm.mp` - Show your playlists\n`ftm.show-playlist <name>` or `ftm.sp` - Show playlist songs\n`ftm.play-playlist <name>` or `ftm.pp` - Play entire playlist\n`ftm.rename-playlist <old> <new>` or `ftm.rp` - Rename playlist', 
        inline: false 
      },
      { 
        name: '📺 YouTube Integration', 
        value: '`ftm.auth-youtube` or `ftm.ay` - Authenticate with YouTube\n`ftm.authcode <code>` - Complete authentication\n`ftm.import-playlist` or `ftm.ip` - Import YouTube playlists', 
        inline: false 
      }
    )
    .setFooter({ text: 'FTR Music Bot - Optimized for Render' });

  await message.reply({ embeds: [embed] });
}

// Voice connection management
client.on('voiceStateUpdate', (oldState, newState) => {
  if (oldState.member.user.bot) return;
  
  const serverQueue = musicPlayer.getQueue(oldState.guild.id);
  if (serverQueue && oldState.channelId === serverQueue.voiceChannel.id) {
    if (newState.channelId !== oldState.channelId) {
      const membersInChannel = oldState.channel.members.filter(member => !member.user.bot);
      if (membersInChannel.size === 0) {
        setTimeout(() => {
          const currentQueue = musicPlayer.getQueue(oldState.guild.id);
          if (currentQueue) {
            musicPlayer.deleteQueue(oldState.guild.id);
            serverQueue.textChannel.send('🔇 Left voice channel due to inactivity.');
          }
        }, 300000);
      }
    }
  }
});

// Error handling
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
});

// Start Discord bot
client.login(process.env.DISCORD_TOKEN);
