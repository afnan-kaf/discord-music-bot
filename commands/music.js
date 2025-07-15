const { joinVoiceChannel, createAudioPlayer, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const ytdl = require('ytdl-core');
const ytSearch = require('youtube-search-api');
const musicPlayer = require('../utils/musicPlayer');

// Rate limiting
let lastSearchTime = 0;
const SEARCH_DELAY = 1000;

function extractVideoId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

async function validateYouTubeVideo(url) {
  try {
    // Rate limiting
    const now = Date.now();
    if (now - lastSearchTime < SEARCH_DELAY) {
      await new Promise(resolve => setTimeout(resolve, SEARCH_DELAY));
    }
    lastSearchTime = Date.now();

    if (!ytdl.validateURL(url)) {
      return null;
    }

    const info = await ytdl.getBasicInfo(url);
    
    if (info.videoDetails.isLiveContent) {
      return null; // Skip live streams
    }

    return {
      title: info.videoDetails.title,
      url: info.videoDetails.video_url,
      duration: info.videoDetails.lengthSeconds,
      thumbnail: info.videoDetails.thumbnails?.[0]?.url
    };
  } catch (error) {
    console.error('Video validation error:', error.message);
    return null;
  }
}

async function searchYouTubeVideos(query, maxResults = 20) {
  try {
    const searchVariations = [
      query,
      `${query} official`,
      `${query} music video`,
      `${query} song`,
      `${query} audio`
    ];

    for (const searchTerm of searchVariations) {
      try {
        const results = await ytSearch.GetListByKeyword(searchTerm, false, maxResults);
        if (results.items && results.items.length > 0) {
          console.log(`Found ${results.items.length} results for: ${searchTerm}`);
          return results.items;
        }
      } catch (searchError) {
        console.log(`Search failed for: ${searchTerm}`);
        continue;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return [];
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
}

async function playMusic(message, args) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    return message.reply('❌ You need to be in a voice channel to play music!');
  }

  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions.has('Connect') || !permissions.has('Speak')) {
    return message.reply('❌ I need permissions to join and speak in your voice channel!');
  }

  if (!args.length) {
    return message.reply('❌ Please provide a song name or YouTube URL!');
  }

  const query = args.join(' ');
  let song;

  try {
    const searchMessage = await message.reply('🔍 Searching for your song...');

    // Handle YouTube URLs
    if (query.includes('youtube.com/watch') || query.includes('youtu.be/')) {
      const videoId = extractVideoId(query);
      if (videoId) {
        const directUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const videoInfo = await validateYouTubeVideo(directUrl);
        
        if (videoInfo) {
          song = {
            ...videoInfo,
            requester: message.author.username
          };
        } else {
          return await searchMessage.edit('❌ This YouTube video is not available or restricted!');
        }
      } else {
        return await searchMessage.edit('❌ Invalid YouTube URL format!');
      }
    } else {
      // Search for songs
      const searchResults = await searchYouTubeVideos(query, 25);
      
      if (!searchResults.length) {
        return await searchMessage.edit('❌ No search results found! Please try a different search term.');
      }

      let videoFound = false;
      let attemptCount = 0;

      for (const video of searchResults) {
        attemptCount++;
        
        if (attemptCount > 1 && attemptCount <= 10) {
          await searchMessage.edit(`🔍 Searching... (${attemptCount}/${Math.min(10, searchResults.length)})`);
        }

        const testUrl = `https://www.youtube.com/watch?v=${video.id}`;
        console.log(`Attempting video ${attemptCount}: ${video.title}`);
        
        try {
          const videoInfo = await validateYouTubeVideo(testUrl);
          
          if (videoInfo) {
            song = {
              ...videoInfo,
              requester: message.author.username
            };
            videoFound = true;
            console.log(`✅ Successfully validated: ${videoInfo.title}`);
            break;
          }
        } catch (testError) {
          console.log(`❌ Error testing video ${video.title}: ${testError.message}`);
          continue;
        }

        if (attemptCount >= 10) break;
      }

      if (!videoFound) {
        return await searchMessage.edit(`❌ No playable videos found for "${query}"!\n\n**Try:**\n• Different search terms\n• More specific song titles\n• Adding "official" or "music video"`);
      }
    }

    await searchMessage.edit(`✅ Found: **${song.title}**`);

    const serverQueue = musicPlayer.getQueue(message.guild.id);

    if (!serverQueue) {
      try {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 30000);
        
        const player = createAudioPlayer();
        const queueConstruct = {
          textChannel: message.channel,
          voiceChannel: voiceChannel,
          voiceConnection: connection,
          player: player,
          songs: [song]
        };

        connection.subscribe(player);
        
        connection.on('error', error => {
          console.error('Voice connection error:', error);
          message.channel.send('❌ Voice connection error occurred.');
          musicPlayer.deleteQueue(message.guild.id);
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5000),
            ]);
          } catch (error) {
            console.log('Voice connection lost permanently');
            connection.destroy();
            musicPlayer.deleteQueue(message.guild.id);
          }
        });

        musicPlayer.setQueue(message.guild.id, queueConstruct);
        
        await musicPlayer.playSong(message.guild, song);
        
      } catch (connectionError) {
        console.error('Connection Error:', connectionError);
        message.channel.send('❌ Failed to join voice channel. Please check bot permissions and try again.');
        return;
      }
    } else {
      serverQueue.songs.push(song);
      const embed = new EmbedBuilder()
        .setTitle('✅ Added to Queue')
        .setDescription(`**${song.title}**`)
        .setThumbnail(song.thumbnail)
        .setColor('#4CAF50')
        .addFields(
          { name: 'Position in queue', value: `${serverQueue.songs.length}`, inline: true },
          { name: 'Requested by', value: song.requester, inline: true }
        );
      
      await message.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Play command error:', error);
    message.reply('❌ An error occurred while trying to play the song. Please try again.');
  }
}

async function pause(message) {
  if (!message.member.voice.channel) {
    return message.reply('❌ You need to be in a voice channel to pause music!');
  }

  const serverQueue = musicPlayer.getQueue(message.guild.id);
  if (!serverQueue) {
    return message.reply('❌ There is no music playing!');
  }

  const success = musicPlayer.pauseSong(message.guild.id);
  if (success) {
    message.reply('⏸️ Music paused!');
  } else {
    message.reply('❌ Nothing is playing!');
  }
}

async function resume(message) {
  if (!message.member.voice.channel) {
    return message.reply('❌ You need to be in a voice channel to resume music!');
  }

  const serverQueue = musicPlayer.getQueue(message.guild.id);
  if (!serverQueue) {
    return message.reply('❌ There is no music to resume!');
  }

  const success = musicPlayer.resumeSong(message.guild.id);
  if (success) {
    message.reply('▶️ Music resumed!');
  } else {
    message.reply('❌ Nothing to resume!');
  }
}

async function skip(message) {
  if (!message.member.voice.channel) {
    return message.reply('❌ You need to be in a voice channel to skip music!');
  }

  const serverQueue = musicPlayer.getQueue(message.guild.id);
  if (!serverQueue || !serverQueue.songs.length) {
    return message.reply('❌ There is no music to skip!');
  }

  const success = musicPlayer.skipSong(message.guild);
  if (success) {
    message.reply('⏭️ Song skipped!');
  } else {
    message.reply('❌ Nothing to skip!');
  }
}

async function showQueue(message) {
  const serverQueue = musicPlayer.getQueue(message.guild.id);
  if (!serverQueue?.songs.length) {
    return message.reply('❌ The queue is empty!');
  }

  const embed = new EmbedBuilder()
    .setTitle('🎵 Current Queue')
    .setColor('#2196F3');

  let queueList = '';
  serverQueue.songs.slice(0, 10).forEach((song, index) => {
    const duration = song.duration ? `[${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}]` : '[Unknown]';
    queueList += `${index === 0 ? '🎵' : `${index}.`} **${song.title}** ${duration} (${song.requester})\n`;
  });

  if (serverQueue.songs.length > 10) {
    queueList += `\n... and ${serverQueue.songs.length - 10} more songs`;
  }

  embed.setDescription(queueList);
  await message.reply({ embeds: [embed] });
}

async function stop(message) {
  if (!message.member.voice.channel) {
    return message.reply('❌ You need to be in a voice channel to stop music!');
  }

  const serverQueue = musicPlayer.getQueue(message.guild.id);
  if (!serverQueue) {
    return message.reply('❌ There is no music playing!');
  }

  musicPlayer.deleteQueue(message.guild.id);
  message.reply('🛑 Music stopped and queue cleared!');
}

module.exports = {
  play: playMusic,
  pause,
  resume,
  skip,
  showQueue,
  stop
};
