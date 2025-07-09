const { createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');

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
      
      const stream = await this.createAudioStream(song.url);
      
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
      serverQueue.textChannel.send('❌ Failed to play this song. Trying next...');
      serverQueue.songs.shift();
      this.playSong(guild, serverQueue.songs[0]);
    }
  }

  async createAudioStream(url) {
    return new Promise((resolve, reject) => {
      console.log('Attempting to create audio stream...');
      
      // Try yt-dlp with anti-bot measures
      const ytDlpArgs = [
        '--extract-audio',
        '--audio-format', 'best',
        '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
        '--no-playlist',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--referer', 'https://www.youtube.com/',
        '--add-header', 'Accept-Language:en-US,en;q=0.9',
        '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        '--extractor-retries', '3',
        '--output', '-',
        url
      ];

      console.log('Trying yt-dlp with anti-bot measures...');
      const ytDlpProcess = spawn('yt-dlp', ytDlpArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const stream = new PassThrough();
      let hasData = false;
      let processResolved = false;

      ytDlpProcess.stdout.on('data', (chunk) => {
        if (!hasData) {
          hasData = true;
          if (!processResolved) {
            processResolved = true;
            console.log('✅ yt-dlp started streaming successfully');
            resolve(stream);
          }
        }
        stream.write(chunk);
      });

      ytDlpProcess.stdout.on('end', () => {
        stream.end();
      });

      ytDlpProcess.stderr.on('data', (data) => {
        console.error('yt-dlp stderr:', data.toString());
      });

      ytDlpProcess.on('error', (error) => {
        console.error('yt-dlp spawn error:', error);
        if (!processResolved) {
          processResolved = true;
          this.tryYoutubeDlFallback(url, resolve, reject);
        }
      });

      ytDlpProcess.on('close', (code) => {
        if (code !== 0 && !hasData && !processResolved) {
          console.log('yt-dlp failed, trying youtube-dl fallback...');
          processResolved = true;
          this.tryYoutubeDlFallback(url, resolve, reject);
        }
      });

      // Timeout for yt-dlp
      setTimeout(() => {
        if (!hasData && !processResolved) {
          console.log('yt-dlp timeout, trying youtube-dl...');
          ytDlpProcess.kill();
          processResolved = true;
          this.tryYoutubeDlFallback(url, resolve, reject);
        }
      }, 20000);
    });
  }

  tryYoutubeDlFallback(url, resolve, reject) {
    console.log('Trying youtube-dl fallback...');
    
    // Fixed youtube-dl arguments
    const youtubeDlArgs = [
      '--extract-audio',
      '--audio-format', 'best',
      '--format', 'bestaudio',
      '--no-playlist',
      '--quiet',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      '--referer', 'https://www.youtube.com/',
      '--output', '-.%(ext)s', // Fixed syntax for piping
      url
    ];

    const youtubeDlProcess = spawn('youtube-dl', youtubeDlArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stream = new PassThrough();
    let hasData = false;

    youtubeDlProcess.stdout.on('data', (chunk) => {
      if (!hasData) {
        hasData = true;
        console.log('✅ youtube-dl started streaming successfully');
        resolve(stream);
      }
      stream.write(chunk);
    });

    youtubeDlProcess.stdout.on('end', () => {
      stream.end();
    });

    youtubeDlProcess.stderr.on('data', (data) => {
      console.error('youtube-dl stderr:', data.toString());
    });

    youtubeDlProcess.on('error', (error) => {
      console.error('youtube-dl spawn error:', error);
      if (!hasData) {
        reject(new Error('Both yt-dlp and youtube-dl failed'));
      }
    });

    youtubeDlProcess.on('close', (code) => {
      if (code !== 0 && !hasData) {
        console.error('youtube-dl failed with code:', code);
        reject(new Error('Both yt-dlp and youtube-dl failed'));
      }
    });

    // Timeout for youtube-dl
    setTimeout(() => {
      if (!hasData) {
        youtubeDlProcess.kill();
        reject(new Error('Both yt-dlp and youtube-dl timed out'));
      }
    }, 20000);
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
