require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const music = require('./commands/music');
const playlist = require('./commands/playlist');
const youtube = require('./commands/youtube');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true }).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => console.error('MongoDB connection error:', err));

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('ftm.')) return;

  const args = message.content.slice(4).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'play' || command === 'p') {
    await music.play(message, args);
  } else if (command === 'pause') {
    await music.pause(message);
  } else if (command === 'resume') {
    await music.resume(message);
  } else if (command === 'stop') {
    await music.stop(message);
  } else if (command === 'skip') {
    await music.skip(message);
  } else if (command === 'queue') {
    await music.showQueue(message);
  } else if (command === 'create-playlist') {
    await playlist.createPlaylist(message, args);
  } else if (command === 'add-to-playlist') {
    await playlist.addSong(message, args);
  } else if (command === 'remove-from-playlist') {
    await playlist.removeSong(message, args);
  } else if (command === 'show-playlist') {
    await playlist.showPlaylistSongs(message, args);
  } else if (command === 'play-playlist') {
    await playlist.playPlaylist(message, args);
  } else if (command === 'delete-playlist') {
    await playlist.deletePlaylist(message, args);
  } else if (command === 'import-youtube-playlist') {
    await youtube.importPlaylist(message, args);
  } else if (command === 'auth-youtube') {
    await youtube.authenticateYouTube(message);
  } else if (command === 'auth-code') {
    await youtube.handleAuthCode(message, args);
  } else if (command === 'help') {
    // Centralized help command - only one response
    const embed = new EmbedBuilder()
      .setTitle('FTR Music Bot Commands')
      .setDescription('All commands start with ftm.')
      .addFields(
        { name: 'Music Controls', value: 'ftm.play/p <name/URL> - Play song\nftm.pause - Pause\nftm.resume - Resume\nftm.stop - Stop\nftm.skip - Skip\nftm.queue - View queue' },
        { name: 'Playlists', value: 'ftm.create-playlist <name> - Create\nftm.add-to-playlist <name> <song/URL> - Add song\nftm.remove-from-playlist <name> <index> - Remove\nftm.show-playlist <name> - Show\nftm.play-playlist <name> - Play\nftm.delete-playlist <name> - Delete' },
        { name: 'YouTube Import', value: 'ftm.auth-youtube - Authenticate\nftm.auth-code <code> - Submit code\nftm.import-youtube-playlist - Import (follow prompts)' }
      )
      .setColor('#4CAF50');
    await message.reply({ embeds: [embed] });
  }
});

// Voice state update for inactivity disconnect
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
        }, 300000); // 5 minutes
      }
    }
  }
});

// Error handling
process.on('unhandledRejection', error => console.error('Unhandled promise rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught Exception:', error));

// Express server for Render keep-alive
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(PORT, () => console.log(`🌐 HTTP server running on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);
