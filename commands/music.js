const { joinVoiceChannel, createAudioPlayer, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const ytSearch = require('youtube-search-api');
const musicPlayer = require('../utils/musicPlayer');

async function playMusic(message, args) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    return message.reply('❌ You need to be in a voice channel!');
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
    const searchMessage = await message.reply('🔍 Searching...');

    // Check if it's a YouTube URL
    if (query.includes('youtube.com/watch') || query.includes('youtu.be/')) {
      song = {
        title: 'YouTube Video',
        url: query,
        requester: message.author.username
      };
    } else {
      // Search for song
      const results = await ytSearch.GetListByKeyword(query, false, 1);
      if (!results.items?.length) {
        return await searchMessage.edit('❌ No results found!');
      }
      
      const video = results.items[0];
      song = {
        title: video.title,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        requester: message.author.username
      };
    }

    await searchMessage.edit(`✅ Found: **${song.title}**`);

    const serverQueue = musicPlayer.getQueue(message.guild.id);

    if (!serverQueue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      // Extended timeout for hosting environments
      await entersState(connection, VoiceConnectionStatus.Ready, 60000);
      
      const player = createAudioPlayer();
      const queueConstruct = {
        textChannel: message.channel,
        voiceChannel: voiceChannel,
        voiceConnection: connection,
        player: player,
        songs: [song]
      };

      connection.subscribe(player);
      
      // Better error handling for voice connection
      connection.on('error', error => {
        console.error('Voice connection error:', error);
        message.channel.send('❌ Voice connection failed. Please try again.');
        musicPlayer.deleteQueue(message.guild.id);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5000),
          ]);
        } catch (error) {
          console.log('Voice connection lost, cleaning up...');
          musicPlayer.deleteQueue(message.guild.id);
        }
      });

      musicPlayer.setQueue(message.guild.id, queueConstruct);
      
      await musicPlayer.playSong(message.guild, song);
    } else {
      serverQueue.songs.push(song);
      const embed = new EmbedBuilder()
        .setTitle('✅ Added to Queue')
        .setDescription(`**${song.title}**`)
        .setColor('#4CAF50');
      await message.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Play command error:', error);
    if (error.message.includes('aborted')) {
      message.reply('❌ Voice connection timed out. Please try again or use a different song.');
    } else {
      message.reply('❌ An error occurred while trying to play the song.');
    }
  }
}

// ... rest of your existing functions (pause, resume, skip, etc.)

module.exports = {
  play: playMusic,
  pause,
  resume,
  skip,
  showQueue,
  stop
};
