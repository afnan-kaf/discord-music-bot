const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const musicPlayer = require('./utils/musicPlayer');
const musicCommands = require('./commands/music');
const playlistCommands = require('./commands/playlist');
const youtubeCommands = require('./commands/youtube');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

client.once('ready', () => {
  console.log(`🤖 ${client.user.tag} is online!`);
  client.user.setActivity('🎵 FTR Music from YouTube', { type: 'LISTENING' });
});

client.on('messageCreate', async message => {
  const prefix = 'ftr.';
  
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
        value: '`ftr.play <song/url>` or `ftr.p` - Play music\n`ftr.pause` - Pause current song\n`ftr.resume` - Resume paused song\n`ftr.skip` - Skip current song\n`ftr.queue` or `ftr.q` - Show current queue\n`ftr.stop` - Stop music and clear queue', 
        inline: false 
      },
      { 
        name: '📝 Playlist Commands', 
        value: '`ftr.create-playlist <name>` or `ftr.cp` - Create playlist\n`ftr.delete-playlist <name>` or `ftr.dp` - Delete playlist\n`ftr.add-song <playlist> <song>` or `ftr.as` - Add song to playlist\n`ftr.remove-song <playlist> <index>` or `ftr.rs` - Remove song from playlist\n`ftr.my-playlists` or `ftr.mp` - Show your playlists\n`ftr.show-playlist <name>` or `ftr.sp` - Show playlist songs\n`ftr.play-playlist <name>` or `ftr.pp` - Play entire playlist\n`ftr.rename-playlist <old> <new>` or `ftr.rp` - Rename playlist', 
        inline: false 
      },
      { 
        name: '📺 YouTube Integration', 
        value: '`ftr.auth-youtube` or `ftr.ay` - Authenticate with YouTube\n`ftr.authcode <code>` - Complete authentication\n`ftr.import-playlist` or `ftr.ip` - Import YouTube playlists', 
        inline: false 
      }
    )
    .setFooter({ text: 'FTR Music Bot - Enhanced with YouTube Bypassing' });

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

// HTTP server for Render deployment
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

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
    queues: musicPlayer.queues.size,
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
});

app.listen(PORT, () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
