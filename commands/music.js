const { joinVoiceChannel, createAudioPlayer, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const youtubedl = require('youtube-dl-exec');
const ytSearch = require('youtube-search-api');
const musicPlayer = require('../utils/musicPlayer');

// Helper function to validate YouTube URLs
function isValidYouTubeUrl(url) {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
  return youtubeRegex.test(url);
}

// Helper function to get video info with bypassing
async function getVideoInfo(url) {
  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noPlaylist: true,
      noWarnings: true,
      ignoreErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      referer: 'https://www.youtube.com/',
      addHeader: [
        'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language:en-US,en;q=0.5',
        'Accept-Encoding:gzip, deflate',
        'Connection:keep-alive'
      ]
    });
    
    return {
      title: info.title || 'Unknown Title',
      url: info.webpage_url || url,
      duration: info.duration || 0,
      thumbnail: info.thumbnail || null,
      uploader: info.uploader || 'Unknown'
    };
  } catch (error) {
    console.error('Video info extraction failed:', error);
    throw new Error('Failed to get video information');
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

    if (isValidYouTubeUrl(query)) {
      console.log('Valid YouTube URL detected:', query);
      
      try {
        const videoInfo = await getVideoInfo(query);
        song = {
          title: videoInfo.title,
          url: videoInfo.url,
          duration: videoInfo.duration,
          thumbnail: videoInfo.thumbnail,
          requester: message.author.username
        };
        console.log('Song info retrieved:', song.title);
      } catch (infoError) {
        console.error('Video info error:', infoError);
        
        // Fallback - use URL directly if info extraction fails
        song = {
          title: 'YouTube Video',
          url: query,
          duration: 0,
          thumbnail: null,
          requester: message.author.username
        };
      }
    } else {
      console.log('Searching for:', query);
      try {
        const results = await ytSearch.GetListByKeyword(query, false, 3);
        if (!results.items || !results.items.length) {
          await searchMessage.edit('❌ No results found for your search!');
          return;
        }
        
        // Try multiple results in case some are blocked
        let videoFound = false;
        for (const video of results.items) {
          const testUrl = `https://www.youtube.com/watch?v=${video.id}`;
          try {
            const videoInfo = await getVideoInfo(testUrl);
            song = {
              title: videoInfo.title,
              url: videoInfo.url,
              duration: videoInfo.duration,
              thumbnail: videoInfo.thumbnail,
              requester: message.author.username
            };
            videoFound = true;
            break;
          } catch (testError) {
            console.log(`Video ${video.title} failed info extraction, trying next...`);
            continue;
          }
        }
        
        if (!videoFound) {
          // Final fallback - use first search result directly
          const video = results.items[0];
          song = {
            title: video.title,
            url: `https://www.youtube.com/watch?v=${video.id}`,
            duration: 0,
            thumbnail: video.thumbnail?.thumbnails?.[0]?.url,
            requester: message.author.username
          };
        }
        
        console.log('Search result:', song.title);
      } catch (searchError) {
        console.error('Search Error:', searchError);
        await searchMessage.edit('❌ Error searching for the song. Please try again.');
        return;
      }
    }

    await searchMessage.edit(`✅ Found: **${song.title}**`);

    const serverQueue = musicPlayer.getQueue(message.guild.id);

    if (!serverQueue) {
      console.log('Creating new queue and joining voice channel...');
      
      try {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 30000);
        console.log('Voice connection established');

        const player = createAudioPlayer();
        
        const queueConstruct = {
          textChannel: message.channel,
          voiceChannel: voiceChannel,
          voiceConnection: connection,
          player: player,
          songs: []
        };

        connection.subscribe(player);
        
        // Enhanced connection error handling
        connection.on('error', error => {
          console.error('Voice connection error:', error);
          message.channel.send('❌ Voice connection error occurred.');
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
        queueConstruct.songs.push(song);

        console.log('Starting to play song...');
        await musicPlayer.playSong(message.guild, queueConstruct.songs[0]);
        
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
          { name: 'Requested by', value: song.requester, inline: true },
          { name: 'Duration', value: song.duration ? `${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}` : 'Unknown', inline: true }
        );
      
      await message.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Play command error:', error);
    message.reply('❌ An error occurred while trying to play the song. Please try a different song or try again later.');
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
    message.reply('❌ There is no music playing!');
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
    message.reply('❌ There is no music to resume!');
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
    message.reply('❌ There is no music to skip!');
  }
}

async function showQueue(message) {
  const serverQueue = musicPlayer.getQueue(message.guild.id);
  if (!serverQueue || !serverQueue.songs.length) {
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
