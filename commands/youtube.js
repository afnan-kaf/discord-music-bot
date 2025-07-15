const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const Playlist = require('../models/Playlist');
//const youtubedl = require('youtube-dl-exec');

const youtube = google.youtube('v3');
const OAuth2 = google.auth.OAuth2;

const oauth2Client = new OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

// Store user tokens in memory (in production, use a database)
const userTokens = new Map();

// Rate limiting for YouTube API calls
let lastYouTubeApiCall = 0;
const YOUTUBE_API_DELAY = 1000; // 1 second between API calls

async function authenticateYouTube(message) {
  const scopes = [
    'https://www.googleapis.com/auth/youtube.readonly'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: message.author.id
  });

  const embed = new EmbedBuilder()
    .setTitle('🔐 YouTube Authentication')
    .setDescription('Click the link below to authenticate with YouTube:')
    .setColor('#FF0000')
    .addFields(
      { name: '🔗 Authentication Link', value: `[Click here to authenticate](${authUrl})` },
      { name: '📋 Instructions', value: '1. Click the link above\n2. Sign in to your YouTube account\n3. Copy the authorization code\n4. Use `ftm.authcode <code>` to complete authentication' }
    )
    .setFooter({ text: 'This allows the bot to access your YouTube playlists (read-only)' });

  await message.reply({ embeds: [embed] });
}

async function handleAuthCode(message, args) {
  if (!args.length) {
    return message.reply('❌ Please provide the authorization code from YouTube!');
  }

  const code = args[0];

  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    userTokens.set(message.author.id, {
      ...tokens,
      expiry_date: Date.now() + (tokens.expires_in * 1000)
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Authentication Successful')
      .setDescription('You can now import your YouTube playlists using `ftm.import-playlist`!')
      .setColor('#4CAF50');

    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Auth error:', error);
    message.reply('❌ Invalid authorization code. Please try again with `ftm.auth-youtube`.');
  }
}

async function refreshTokenIfNeeded(userId) {
  const userToken = userTokens.get(userId);
  if (!userToken) return false;

  if (userToken.expiry_date && userToken.expiry_date - Date.now() < 300000) {
    try {
      oauth2Client.setCredentials(userToken);
      const { credentials } = await oauth2Client.refreshAccessToken();
      userTokens.set(userId, {
        ...credentials,
        expiry_date: Date.now() + (credentials.expires_in * 1000)
      });
      return true;
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  }
  return true;
}

async function importPlaylist(message) {
  const userToken = userTokens.get(message.author.id);
  if (!userToken) {
    return message.reply('❌ Please authenticate with YouTube first using `ftm.auth-youtube`');
  }

  if (!await refreshTokenIfNeeded(message.author.id)) {
    return message.reply('❌ Authentication expired. Please re-authenticate with `ftm.auth-youtube`');
  }

  oauth2Client.setCredentials(userTokens.get(message.author.id));

  try {
    const now = Date.now();
    if (now - lastYouTubeApiCall < YOUTUBE_API_DELAY) {
      await new Promise(resolve => setTimeout(resolve, YOUTUBE_API_DELAY));
    }
    lastYouTubeApiCall = Date.now();

    const playlistsResponse = await youtube.playlists.list({
      auth: oauth2Client,
      part: 'snippet,contentDetails',
      mine: true,
      maxResults: 25
    });

    if (!playlistsResponse.data.items || !playlistsResponse.data.items.length) {
      return message.reply('❌ No playlists found in your YouTube account!');
    }

    const embed = new EmbedBuilder()
      .setTitle('📺 Your YouTube Playlists')
      .setColor('#FF0000')
      .setFooter({ text: 'Reply with the number of the playlist you want to import' });

    let playlistList = '';
    playlistsResponse.data.items.forEach((playlist, index) => {
      const itemCount = playlist.contentDetails.itemCount || 0;
      playlistList += `${index + 1}. **${playlist.snippet.title}** (${itemCount} videos)\n`;
    });

    embed.setDescription(playlistList);
    embed.addFields({
      name: '📋 Import Instructions',
      value: 'Reply with the number of the playlist you want to import (e.g., `1`)\n⏰ You have 30 seconds to respond'
    });

    await message.reply({ embeds: [embed] });

    const filter = (response) => {
      return response.author.id === message.author.id &&
        !isNaN(response.content) &&
        parseInt(response.content) > 0 &&
        parseInt(response.content) <= playlistsResponse.data.items.length;
    };

    const collector = message.channel.createMessageCollector({ 
      filter, 
      time: 30000, 
      max: 1 
    });

    collector.on('collect', async (response) => {
      const selectedIndex = parseInt(response.content) - 1;
      const selectedPlaylist = playlistsResponse.data.items[selectedIndex];
      await importYouTubePlaylist(message, selectedPlaylist);
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        message.channel.send('⏰ Import timeout. Please run `ftm.import-playlist` again to try again.');
      }
    });

  } catch (error) {
    console.error('Import playlist error:', error);
    
    if (error.code === 401) {
      message.reply('❌ Authentication expired. Please re-authenticate with `ftm.auth-youtube`');
    } else if (error.code === 403) {
      message.reply('❌ YouTube API quota exceeded. Please try again later.');
    } else {
      message.reply('❌ An error occurred while fetching your playlists. Please try again.');
    }
  }
}

async function importYouTubePlaylist(message, youtubePlaylist) {
  const importMessage = await message.reply('🔄 Importing playlist... This may take a moment.');

  try {
    const now = Date.now();
    if (now - lastYouTubeApiCall < YOUTUBE_API_DELAY) {
      await new Promise(resolve => setTimeout(resolve, YOUTUBE_API_DELAY));
    }
    lastYouTubeApiCall = Date.now();

    const playlistItemsResponse = await youtube.playlistItems.list({
      auth: oauth2Client,
      part: 'snippet',
      playlistId: youtubePlaylist.id,
      maxResults: 50
    });

    if (!playlistItemsResponse.data.items || !playlistItemsResponse.data.items.length) {
      return await importMessage.edit('❌ This playlist is empty or contains no accessible videos.');
    }

    const songs = [];
    let processedCount = 0;

    for (const item of playlistItemsResponse.data.items) {
      try {
        const videoId = item.snippet.resourceId.videoId;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        songs.push({
          title: item.snippet.title,
          url: videoUrl,
          duration: 'Unknown',
          thumbnail: item.snippet.thumbnails?.default?.url || null
        });
        
        processedCount++;
        
        if (processedCount % 10 === 0) {
          await importMessage.edit(`🔄 Processing videos... ${processedCount}/${playlistItemsResponse.data.items.length}`);
        }
        
        if (processedCount % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (videoError) {
        console.error('Video processing error:', videoError);
        continue;
      }
    }

    if (songs.length === 0) {
      return await importMessage.edit('❌ No accessible videos found in this playlist.');
    }

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
      .setTitle('✅ Playlist Imported Successfully')
      .setDescription(`Imported **${youtubePlaylist.snippet.title}**`)
      .addFields(
        { name: '📊 Statistics', value: `${songs.length} accessible videos imported\n${processedCount - songs.length} videos skipped (unavailable)` },
        { name: '🎵 Usage', value: `Use \`ftm.play-playlist ${youtubePlaylist.snippet.title}\` to play this playlist` }
      )
      .setColor('#4CAF50')
      .setThumbnail(youtubePlaylist.snippet.thumbnails?.default?.url);

    await importMessage.edit({ content: '', embeds: [embed] });

  } catch (error) {
    console.error('Import YouTube playlist error:', error);
    
    if (error.code === 401) {
      await importMessage.edit('❌ Authentication expired during import. Please re-authenticate with `ftm.auth-youtube`');
    } else if (error.code === 403) {
      await importMessage.edit('❌ YouTube API quota exceeded. Please try again later.');
    } else {
      await importMessage.edit('❌ An error occurred while importing the playlist. Please try again.');
    }
  }
}

module.exports = {
  authenticateYouTube,
  handleAuthCode,
  importPlaylist
};
