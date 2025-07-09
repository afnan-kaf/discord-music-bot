const { createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const { PassThrough } = require('stream');

// User-Agent header for better YouTube compatibility
const UA = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0'
};

// Enhanced stream function with retry logic
function getStream(url, opts) {
  const pass = new PassThrough();
  let attempt = 0;

  const makeRequest = async () => {
    try {
      attempt += 1;
      const stream = ytdl(url, { 
        ...opts, 
        requestOptions: { headers: UA }, 
        highWaterMark: 1 << 25 
      });
      
      stream.pipe(pass, { end: false });
      
      stream.on('end', () => pass.end());
      
      stream.on('error', err => {
        console.error(`Stream error (attempt ${attempt}):`, err.message);
        // Retry once when the first URL is dead (410/404/403)
        if (attempt === 1 && err.statusCode && String(err.statusCode).startsWith('4')) {
          console.log('Retrying stream with backoff...');
          setTimeout(makeRequest, 700); // small back-off
        } else {
          pass.destroy(err);
        }
      });
    } catch(e) {
      console.error('Stream creation error:', e);
      pass.destroy(e);
    }
  };
  
  makeRequest();
  return pass;
}

class MusicPlayer {
  constructor() {
    this.queues = new Map();
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
      
      // Validate URL before streaming
      if (!ytdl.validateURL(song.url)) {
        throw new Error('Invalid YouTube URL');
      }
      
      // Use enhanced stream function with retry logic
      const stream = getStream(song.url, { 
        filter: 'audioonly', 
        quality: 'lowestaudio' 
      });
      
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
        console.error('Audio player error:', error);
        serverQueue.textChannel.send('❌ Audio player error. Skipping to next song...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

      // Handle stream errors
      stream.on('error', (error) => {
        console.error('Enhanced stream error:', error);
        serverQueue.textChannel.send('❌ Error with audio stream. Skipping to next song...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

    } catch (error) {
      console.error('Error creating stream:', error);
      let errorMessage = '❌ Failed to play this song. ';
      
      if (error.message.includes('Invalid')) {
        errorMessage += 'Invalid YouTube URL. ';
      } else if (error.message.includes('unavailable')) {
        errorMessage += 'Video is unavailable. ';
      } else if (error.message.includes('private')) {
        errorMessage += 'Video is private. ';
      } else if (error.message.includes('copyright')) {
        errorMessage += 'Video is blocked due to copyright. ';
      } else {
        errorMessage += 'YouTube streaming error. ';
      }
      
      errorMessage += 'Skipping to next song...';
      serverQueue.textChannel.send(errorMessage);
      serverQueue.songs.shift();
      this.playSong(guild, serverQueue.songs[0]);
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
      if (serverQueue.player) {
        serverQueue.player.stop();
      }
      if (serverQueue.voiceConnection) {
        serverQueue.voiceConnection.destroy();
      }
    }
    this.queues.delete(guildId);
  }

  // Additional utility methods
  getQueueLength(guildId) {
    const serverQueue = this.queues.get(guildId);
    return serverQueue ? serverQueue.songs.length : 0;
  }

  getCurrentSong(guildId) {
    const serverQueue = this.queues.get(guildId);
    return serverQueue?.songs[0] || null;
  }

  clearQueue(guildId) {
    const serverQueue = this.queues.get(guildId);
    if (serverQueue) {
      serverQueue.songs = [];
      return true;
    }
    return false;
  }
}

module.exports = new MusicPlayer();
