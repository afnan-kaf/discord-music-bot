const { google } = require('googleapis');
const { EmbedBuilder } = require('discord.js');
const Playlist = require('../models/Playlist');

const youtube = google.youtube('v3');
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

const userTokens = new Map();

async function authenticateYouTube(message) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.readonly'],
    state: message.author.id
  });

  const embed = new EmbedBuilder()
    .setTitle('🔐 YouTube Authentication')
    .setDescription(`[Click here to authenticate with YouTube](${authUrl})`)
    .setColor('#FF0000')
    .addFields({
      name: 'Instructions',
      value: '1. Click the link above\n2. Sign in to your YouTube account\n3. Grant permissions\n4. Copy the authorization code\n5. Use `ftr.authcode <code>` to complete authentication'
    });

  await message.reply({ embeds: [embed] });
}

async function handleAuthCode(message, args) {
  if (!args.length) {
    return message.reply('❌ Please provide the authorization code!');
  }

  const code = args[0];
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    userTokens.set(message.author.id, tokens);
    
    const embed = new EmbedBuilder()
      .setTitle('✅ Authentication Successful')
      .setDescription('You can now import your YouTube playlists!')
      .setColor('#4CAF50');
    
    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Auth error:', error);
    message.reply('❌ Invalid authorization code. Please try again.');
  }
}

async function importPlaylist(message) {
  const userToken = userTokens.get(message.author.id);
  if (!userToken) {
    return message.reply('❌ Please authenticate with YouTube first using `ftr.auth-youtube`');
  }

  oauth2Client.setCredentials(userToken);

  try {
    const playlistsResponse = await youtube.playlists.list({
      auth: oauth2Client,
      part: 'snippet',
      mine: true,
      maxResults: 50
    });

    if (!playlistsResponse.data.items.length) {
      return message.reply('❌ No playlists found in your YouTube account!');
    }

    const embed = new EmbedBuilder()
      .setTitle('📺 Your YouTube Playlists')
      .setColor('#FF0000');

    let playlistList = '';
    playlistsResponse.data.items.forEach((playlist, index) => {
      playlistList += `${index + 1}. **${playlist.snippet.title}**\n`;
    });

    embed.setDescription(playlistList);
    embed.addFields({
      name: 'Import Instructions',
      value: 'Reply with the number of the playlist you want to import (e.g., `1`)'
    });

    await message.reply({ embeds: [embed] });

    const filter = (response) => {
      return response.author.id === message.author.id && 
             !isNaN(response.content) && 
             parseInt(response.content) > 0 && 
             parseInt(response.content) <= playlistsResponse.data.items.length;
    };

    const collector = message.channel.createMessageCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async (response) => {
      const selectedIndex = parseInt(response.content) - 1;
      const selectedPlaylist = playlistsResponse.data.items[selectedIndex];
      
      await importYouTubePlaylist(message, selectedPlaylist);
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        message.channel.send('⏰ Import timeout. Please try again.');
      }
    });

  } catch (error) {
    console.error('Import playlist error:', error);
    message.reply('❌ An error occurred while fetching your playlists.');
  }
}

async function importYouTubePlaylist(message, youtubePlaylist) {
  try {
    const playlistItemsResponse = await youtube.playlistItems.list({
      auth: oauth2Client,
      part: 'snippet',
      playlistId: youtubePlaylist.id,
      maxResults: 50
    });

    const songs = playlistItemsResponse.data.items.map(item => ({
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
      duration: 'Unknown',
      thumbnail: item.snippet.thumbnails?.default?.url
    }));

    const existingPlaylist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: youtubePlaylist.snippet.title
    });

    if (existingPlaylist) {
      existingPlaylist.songs = songs;
      existingPlaylist.isYouTubeImported = true;
      existingPlaylist.youtubePlaylistId = youtubePlaylist.id;
      existingPlaylist.updatedAt = new Date();
      await existingPlaylist.save();
    } else {
      const newPlaylist = new Playlist({
        userId: message.author.id,
        guildId: message.guild.id,
        name: youtubePlaylist.snippet.title,
        songs: songs,
        isYouTubeImported: true,
        youtubePlaylistId: youtubePlaylist.id
      });
      await newPlaylist.save();
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Playlist Imported')
      .setDescription(`Imported **${youtubePlaylist.snippet.title}** with ${songs.length} songs`)
      .setColor('#4CAF50');
    
    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Import YouTube playlist error:', error);
    message.reply('❌ An error occurred while importing the playlist.');
  }
}

module.exports = {
  authenticateYouTube,
  handleAuthCode,
  importPlaylist
};
