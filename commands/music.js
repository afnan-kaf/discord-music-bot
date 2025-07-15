const { joinVoiceChannel, createAudioPlayer, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const ytdl = require('ytdl-core');
const ytSearch = require('youtube-search-api');
const musicPlayer = require('../utils/musicPlayer');

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

    // Check if it's a YouTube URL
    if (ytdl.validateURL(query)) {
      try {
        const songInfo = await ytdl.getBasicInfo(query);
        song = {
          title: songInfo.videoDetails.title,
          url: songInfo.videoDetails.video_url,
          duration: songInfo.videoDetails.lengthSeconds,
          thumbnail: songInfo.videoDetails.thumbnails?.[0]?.url,
          requester: message.author.username
        };
      } catch (infoError) {
        console.error('YouTube URL error:', infoError);
        return await searchMessage.edit('❌ This video is not available!');
      }
    } else {
      // Search for song
      const results = await ytSearch.GetListByKeyword(query, false, 3);
      if (!results.items?.length) {
        return await searchMessage.edit('❌ No results found for your search!');
      }
      
      // Try multiple results for better success rate
      let videoFound = false;
      for (const video of results.items) {
        const testUrl = `https://www.youtube.com/watch?v=${video.id}`;
        try {
          if (ytdl.validateURL(testUrl)) {
            const songInfo = await ytdl.getBasicInfo(testUrl);
            song = {
              title: songInfo.videoDetails.title,
              url: songInfo.videoDetails.video_url,
              duration: songInfo.videoDetails.lengthSeconds,
              thumbnail: songInfo.videoDetails.thumbnails?.[0]?.url,
              requester: message.author.username
            };
            videoFound = true;
            break;
          }
        } catch (testError) {
          continue;
        }
      }
      
      if (!videoFound) {
        return await searchMessage.edit('❌ No available videos found for your search!');
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
          musicPlayer.deleteQueue(message.guild.id);
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5000),
            ]);
          } catch (error) {
            connection.destroy();
            musicPlayer.deleteQueue(message.guild.id);
          }
        });

        musicPlayer.setQueue(message.guild.id, queueConstruct);
        
        await musicPlayer.playSong(message.guild, song);
      } catch (connectionError) {
        console.error('Connection Error:', connectionError);
        message.channel.send('❌ Failed to join voice channel. Please try again.');
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
    message.reply('❌ An error occurred while trying to play the song.');
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
