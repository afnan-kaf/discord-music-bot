const { createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');

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
      
      const stream = ytdl(song.url, {
        filter: 'audioonly',
        quality: 'lowestaudio',
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
          }
        }
      });
      
      const resource = createAudioResource(stream, {
        inputType: 'arbitrary'
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

      stream.on('error', (error) => {
        console.error('Stream error:', error);
        serverQueue.textChannel.send('❌ YouTube stream error. Skipping...');
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

  // ... rest of methods remain the same
  async createAudioStream(url) {
    return new Promise((resolve, reject) => {
      // Enhanced binary paths for Render
      const executables = [
        'yt-dlp',
        'youtube-dl',
        '/usr/local/bin/yt-dlp',
        '/usr/local/bin/youtube-dl',
        '/usr/bin/yt-dlp',
        '/usr/bin/youtube-dl',
        '/opt/render/.python/bin/yt-dlp',
        '/opt/render/.python/bin/youtube-dl'
      ];
      
      let executableIndex = 0;
      
      const tryExecutable = () => {
        if (executableIndex >= executables.length) {
          reject(new Error('No working YouTube downloader found'));
          return;
        }
        
        const executable = executables[executableIndex];
        console.log(`Trying ${executable}...`);
        
        // Different arguments for different tools
        let args;
        if (executable.includes('yt-dlp')) {
          args = [
            '--extract-audio',
            '--audio-format', 'opus',
            '--audio-quality', '0',
            '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '--no-check-certificates',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '--output', '-',
            url
          ];
        } else {
          // youtube-dl specific arguments
          args = [
            '--extract-audio',
            '--audio-format', 'best',
            '--audio-quality', '0',
            '--format', 'bestaudio',
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '--output', '-.%(ext)s',
            url
          ];
        }

        const process = spawn(executable, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        const stream = new PassThrough();
        let hasData = false;

        process.stdout.on('data', (chunk) => {
          hasData = true;
          stream.write(chunk);
        });

        process.stdout.on('end', () => {
          stream.end();
        });

        process.stderr.on('data', (data) => {
          const errorMsg = data.toString();
          console.error(`${executable} stderr:`, errorMsg);
          
          // Check for specific YouTube bot detection
          if (errorMsg.includes('Sign in to confirm')) {
            console.log('YouTube bot detection triggered, trying next method...');
          }
        });

        process.on('error', (error) => {
          console.error(`${executable} process error:`, error.message);
          executableIndex++;
          tryExecutable();
        });

        process.on('close', (code) => {
          console.log(`${executable} process exited with code ${code}`);
          if (code !== 0 && !hasData) {
            executableIndex++;
            tryExecutable();
          }
        });

        // Resolve when we start receiving data
        process.stdout.once('data', () => {
          console.log(`✅ ${executable} started streaming successfully`);
          resolve(stream);
        });

        // Timeout after 20 seconds
        setTimeout(() => {
          if (!hasData) {
            process.kill();
            executableIndex++;
            tryExecutable();
          }
        }, 20000);
      };
      
      tryExecutable();
    });
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
