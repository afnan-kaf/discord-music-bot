const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
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
    message.reply('❌ An error occurred.');
  }
});

async function showHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle('🎵 FTR Music Bot Commands')
    .setColor('#FF6B6B')
    .addFields(
      { 
        name: '🎶 Music Commands', 
        value: `\`ftr.play <song/url>\` - Play music\n\`ftr.pause\` - Pause\n\`ftr.resume\` - Resume\n\`ftr.skip\` - Skip\n\`ftr.queue\` - Show queue\n\`ftr.stop\` - Stop`, 
        inline: false 
      },
      { 
        name: '📝 Playlist Commands', 
        value: `\`ftr.create-playlist <name>\` - Create playlist\n\`ftr.my-playlists\` - Show playlists\n\`ftr.add-song <playlist> <song>\` - Add song\n\`ftr.play-playlist <name>\` - Play playlist`, 
        inline: false 
      }
    );

  await message.reply({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);
