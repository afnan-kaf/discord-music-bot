const { createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');

class MusicPlayer {
  constructor() {
    this.queues = new Map();
    // Rotate between different user agents to avoid detection
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async playSong(guild, song) {
    const serverQueue = this.queues.get(guild.id);
    if (!song) {
      if (serverQueue?.voiceConnection) {
        serverQueue.voiceConnection.destroy();
      }
      this.queues.delete(guild.id);
      return;
    }

    try {
      console.log('Creating audio stream for:', song.title);
      console.log('Using URL:', song.url);
      
      const stream = await this.createAudioStreamWithRetry(song.url, 3);
      
      const resource = createAudioResource(stream, {
        inputType: 'arbitrary',
        inlineVolume: false
      });
      
      serverQueue.player.play(resource);
      
      serverQueue.player.once(AudioPlayerStatus.Playing, () => {
        console.log('✅ Now playing:', song.title);
        serverQueue.textChannel.send(`🎵 **Now playing:** ${song.title}\n*Requested by: ${song.requester}*`);
      });

      serverQueue.player.once(AudioPlayerStatus.Idle, () => {
        console.log('Song finished, playing next...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

      serverQueue.player.on('error', error => {
        console.error('Player error:', error);
        serverQueue.textChannel.send('❌ Error playing song. Skipping...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

    } catch (error) {
      console.error('Error creating stream:', error);
      serverQueue.textChannel.send('❌ Failed to play this song. Skipping...');
      serverQueue.songs.shift();
      this.playSong(guild, serverQueue.songs[0]);
    }
  }

  async createAudioStreamWithRetry(url, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Stream attempt ${attempt}/${maxRetries}`);
        
        // Add random delay to avoid pattern detection
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));
        
        return await this.createAudioStream(url);
      } catch (error) {
        console.error(`Stream attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Exponential backoff with jitter
        const backoffDelay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }

  async createAudioStream(url) {
    try {
      const stream = ytdl(url, {
        filter: 'audioonly',
        quality: 'lowestaudio',
        requestOptions: {
          headers: {
            // Enhanced user agent rotation
            'User-Agent': this.getRandomUserAgent(),
            
            // Comprehensive browser headers
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8,hi;q=0.7', // Added Bengali and Hindi
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            
            // Security headers that browsers send
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'Sec-CH-UA': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-CH-UA-Mobile': '?0',
            'Sec-CH-UA-Platform': '"Windows"',
            
            // Cache control headers
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            
            // Additional headers to mimic real browser behavior
            'DNT': '1',
            'Referer': 'https://www.youtube.com/',
            'Origin': 'https://www.youtube.com',
            
            // Viewport and device info
            'Viewport-Width': '1920',
            'Device-Memory': '8',
            'DPR': '1'
          },
          // Additional request options
          timeout: 30000,
          agent: false
        },
        // Enhanced ytdl-core options
        highWaterMark: 1 << 25,
        dlChunkSize: 1024 * 1024,
        
        // Format selection to prefer available formats
        format: 'audioonly',
        
        // Additional options for better compatibility
        begin: undefined,
        liveBuffer: 20000,
        
        // Custom format selection
        chooseBestFormat: true
      });

      // Add additional error handling for the stream
      stream.on('error', (error) => {
        console.error('Stream error:', error);
        throw error;
      });

      // Add timeout handling
      const timeout = setTimeout(() => {
        stream.destroy();
        throw new Error('Stream timeout after 30 seconds');
      }, 30000);

      stream.on('response', () => {
        clearTimeout(timeout);
      });

      return stream;
    } catch (error) {
      console.error('ytdl-core error:', error);
      throw new Error(`Failed to create audio stream: ${error.message}`);
    }
  }

  pauseSong(guildId) {
    const serverQueue = this.queues.get(guildId);
    if (serverQueue?.player) {
      serverQueue.player.pause();
      return true;
    }
    return false;
  }

  resumeSong(guildId) {
    const serverQueue = this.queues.get(guildId);
    if (serverQueue?.player) {
      serverQueue.player.unpause();
      return true;
    }
    return false;
  }

  skipSong(guild) {
    const serverQueue = this.queues.get(guild.id);
    if (serverQueue?.songs.length > 0) {
      serverQueue.player.stop();
      return true;
    }
    return false;
  }

  getQueue(guildId) {
    return this.queues.get(guildId);
  }

  setQueue(guildId, queue) {
    this.queues.set(guildId, queue);
  }

  deleteQueue(guildId) {
    const serverQueue = this.queues.get(guildId);
    if (serverQueue) {
      serverQueue.player?.stop();
      serverQueue.voiceConnection?.destroy();
    }
    this.queues.delete(guildId);
  }
}

module.exports = new MusicPlayer();
