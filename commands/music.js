const { joinVoiceChannel, createAudioPlayer, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const youtubedl = require('youtube-dl-exec');
const ytSearch = require('youtube-search-api');
const musicPlayer = require('../utils/musicPlayer');

// Enhanced user agents and headers for better bot detection avoidance
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Enhanced video info extraction with anti-bot measures
async function getVideoInfo(url) {
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds between retries
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting to get video info (attempt ${attempt}/${maxRetries})...`);
      
      const info = await youtubedl(url, {
        dumpSingleJson: true,
        noPlaylist: true,
        noWarnings: true,
        ignoreErrors: true,
        userAgent: getRandomUserAgent(),
        referer: 'https://www.youtube.com/',
        // Enhanced headers to avoid bot detection
        addHeader: [
          'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language:en-US,en;q=0.9,es;q=0.8',
          'Accept-Encoding:gzip, deflate, br',
          'Connection:keep-alive',
          'Upgrade-Insecure-Requests:1',
          'Sec-Fetch-Dest:document',
          'Sec-Fetch-Mode:navigate',
          'Sec-Fetch-Site:none',
          'Cache-Control:max-age=0'
        ],
        // Additional anti-bot options
        sleepInterval: 1,
        maxSleepInterval: 5,
        sleepSubtitles: 1
      });
      
      return {
        title: info.title || 'Unknown Title',
        url: info.webpage_url || url,
        duration: info.duration || 0,
        thumbnail: info.thumbnail || null,
        uploader: info.uploader || 'Unknown'
      };
      
    } catch (error) {
      console.error(`Video info extraction failed (attempt ${attempt}):`, error.message);
      
      if (attempt === maxRetries) {
        throw new Error(`Failed to extract video info after ${maxRetries} attempts`);
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
    }
  }
}

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
    const searchMessage = await message.reply('🔍 Searching for your song...');

    // Check if it's a YouTube URL
    if (query.includes('youtube.com/watch') || query.includes('youtu.be/')) {
      try {
        const videoInfo = await getVideoInfo(query);
        song = {
          title: videoInfo.title,
          url: videoInfo.url,
          duration: videoInfo.duration,
          thumbnail: videoInfo.thumbnail,
          requester: message.author.username
        };
        console.log('Direct URL video info retrieved:', song.title);
      } catch (infoError) {
        console.error('Direct URL failed:', infoError);
        await searchMessage.edit('❌ This video is not available due to YouTube restrictions.');
        return;
      }
    } else {
      // Search for song using YouTube Search API
      try {
        const results = await ytSearch.GetListByKeyword(query, false, 5); // Get 5 results for fallback
        if (!results.items?.length) {
          await searchMessage.edit('❌ No results found for your search!');
          return;
        }
        
        // Try multiple videos from search results
        let videoFound = false;
        for (const [index, video] of results.items.entries()) {
          const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
          console.log(`Trying video ${index + 1}: ${video.title}`);
          
          try {
            const videoInfo = await getVideoInfo(videoUrl);
            song = {
              title: videoInfo.title,
              url: videoInfo.url,
              duration: videoInfo.duration,
              thumbnail: videoInfo.thumbnail,
              requester: message.author.username
            };
            videoFound = true;
            console.log('Successfully retrieved info for:', song.title);
            break;
          } catch (videoError) {
            console.error(`Video ${video.title} failed info extraction, trying next...`);
            continue;
          }
        }
        
        if (!videoFound) {
          await searchMessage.edit('❌ All search results are blocked by YouTube. Please try a different search term.');
          return;
        }
        
      } catch (searchError) {
        console.error('Search Error:', searchError);
        await searchMessage.edit('❌ Error searching for the song. Please try again.');
        return;
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
        .setColor('#4CAF50');
      await message.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Play command error:', error);
    message.reply('❌ An error occurred while trying to play the song.');
  }
}

// ... rest of your music command functions remain the same

module.exports = {
  play: playMusic,
  pause: async (message) => {
    const success = musicPlayer.pauseSong(message.guild.id);
    message.reply(success ? '⏸️ Paused!' : '❌ Nothing is playing!');
  },
  resume: async (message) => {
    const success = musicPlayer.resumeSong(message.guild.id);
    message.reply(success ? '▶️ Resumed!' : '❌ Nothing to resume!');
  },
  skip: async (message) => {
    const success = musicPlayer.skipSong(message.guild);
    message.reply(success ? '⏭️ Skipped!' : '❌ Nothing to skip!');
  },
  showQueue: async (message) => {
    const serverQueue = musicPlayer.getQueue(message.guild.id);
    if (!serverQueue?.songs.length) {
      return message.reply('❌ Queue is empty!');
    }

    const embed = new EmbedBuilder()
      .setTitle('🎵 Current Queue')
      .setColor('#2196F3');

    let queueList = '';
    serverQueue.songs.slice(0, 10).forEach((song, index) => {
      queueList += `${index === 0 ? '🎵' : `${index}.`} **${song.title}** (${song.requester})\n`;
    });

    embed.setDescription(queueList);
    await message.reply({ embeds: [embed] });
  },
  stop: async (message) => {
    musicPlayer.deleteQueue(message.guild.id);
    message.reply('🛑 Stopped and cleared queue!');
  }
};
