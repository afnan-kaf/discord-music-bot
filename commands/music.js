const { joinVoiceChannel, createAudioPlayer, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const newPipeService = require('../utils/newpipeService');
const ytSearch = require('youtube-search-api');
const musicPlayer = require('../utils/musicPlayer');

// Extract video ID from YouTube URL
function extractVideoId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
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
    const searchMessage = await message.reply('🔍 Searching using NewPipe API...');

    // Handle YouTube URLs
    if (query.includes('youtube.com/watch') || query.includes('youtu.be/')) {
      const videoId = extractVideoId(query);
      if (videoId) {
        await searchMessage.edit('🔍 Getting stream from YouTube URL...');
        
        try {
          const streamData = await newPipeService.getStreamUrls(videoId);
          if (streamData && streamData.audioUrl) {
            song = {
              title: streamData.title,
              audioUrl: streamData.audioUrl,
              duration: streamData.duration,
              thumbnail: streamData.thumbnail,
              uploader: streamData.uploader,
              source: 'newpipe',
              requester: message.author.username
            };
          } else {
            return await searchMessage.edit('❌ Cannot extract audio from this YouTube URL!');
          }
        } catch (error) {
          return await searchMessage.edit(`❌ Failed to get stream: ${error.message}`);
        }
      } else {
        return await searchMessage.edit('❌ Invalid YouTube URL format!');
      }
    } else {
      // Search for songs using NewPipe
      await searchMessage.edit('🔍 Searching NewPipe instances...');
      
      const searchResults = await newPipeService.searchVideos(query, 10);
      
      if (!searchResults.length) {
        // Fallback to YouTube Search API + NewPipe extraction
        await searchMessage.edit('🔍 Fallback to YouTube Search API...');
        
        try {
          const ytResults = await ytSearch.GetListByKeyword(query, false, 5);
          if (ytResults.items?.length) {
            let videoFound = false;
            
            for (const video of ytResults.items) {
              await searchMessage.edit(`🔍 Trying: ${video.title.substring(0, 50)}...`);
              
              try {
                const streamData = await newPipeService.getStreamUrls(video.id);
                if (streamData && streamData.audioUrl) {
                  song = {
                    title: streamData.title,
                    audioUrl: streamData.audioUrl,
                    duration: streamData.duration,
                    thumbnail: streamData.thumbnail,
                    uploader: streamData.uploader,
                    source: 'newpipe',
                    requester: message.author.username
                  };
                  videoFound = true;
                  break;
                }
              } catch (error) {
                console.log(`Failed to extract ${video.title}:`, error.message);
                continue;
              }
            }
            
            if (!videoFound) {
              return await searchMessage.edit('❌ No playable videos found! All videos failed extraction.');
            }
          } else {
            return await searchMessage.edit('❌ No search results found!');
          }
        } catch (searchError) {
          return await searchMessage.edit('❌ Search failed on all platforms!');
        }
      } else {
        // Try to get stream from NewPipe search results
        let videoFound = false;
        
        for (const result of searchResults) {
          await searchMessage.edit(`🔍 Trying: ${result.title.substring(0, 50)}...`);
          
          try {
            const streamData = await newPipeService.getStreamUrls(result.videoId);
            if (streamData && streamData.audioUrl) {
              song = {
                title: streamData.title,
                audioUrl: streamData.audioUrl,
                duration: streamData.duration,
                thumbnail: streamData.thumbnail,
                uploader: streamData.uploader,
                source: 'newpipe',
                requester: message.author.username
              };
              videoFound = true;
              break;
            }
          } catch (error) {
            console.log(`Failed to extract ${result.title}:`, error.message);
            continue;
          }
        }
        
        if (!videoFound) {
          return await searchMessage.edit('❌ No playable videos found! All videos failed extraction.');
        }
      }
    }

    await searchMessage.edit(`✅ Found: **${song.title}** via NewPipe`);

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
          { name: 'Source', value: song.source.toUpperCase(), inline: true },
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

// Other functions remain the same (pause, resume, skip, etc.)
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
