const { createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');

class MusicPlayer {
  constructor() {
    this.queues = new Map();
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
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
        serverQueue.textChannel.send('❌ Audio player error. Skipping to next song...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

    } catch (error) {
      console.error('Error creating stream:', error);
      let errorMessage = '❌ Failed to play this song. ';
      
      if (error.message.includes('410')) {
        errorMessage += 'Video is no longer available (410 error). ';
      } else if (error.message.includes('timeout')) {
        errorMessage += 'Connection timeout. ';
      } else if (error.message.includes('blocked')) {
        errorMessage += 'Video blocked by YouTube. ';
      } else {
        errorMessage += 'Unknown error occurred. ';
      }
      
      errorMessage += 'Skipping to next song...';
      serverQueue.textChannel.send(errorMessage);
      serverQueue.songs.shift();
      this.playSong(guild, serverQueue.songs[0]);
    }
  }

  async createAudioStreamWithRetry(url, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxRetries} to create audio stream`);
        return await this.createAudioStream(url, attempt);
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Wait before retry with exponential backoff
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }
  }

  async createAudioStream(url, attempt = 1) {
    return new Promise((resolve, reject) => {
      const executables = [
        'yt-dlp',
        'youtube-dl',
        '/opt/render/.python/bin/yt-dlp',
        '/opt/render/.python/bin/youtube-dl',
        '/home/render/.local/bin/yt-dlp',
        '/home/render/.local/bin/youtube-dl',
        'python3 -m yt_dlp',
        'python3 -m youtube_dl'
      ];
      
      let executableIndex = 0;
      
      const tryExecutable = () => {
        if (executableIndex >= executables.length) {
          reject(new Error('No working YouTube downloader found'));
          return;
        }
        
        const executable = executables[executableIndex];
        console.log(`Trying ${executable} (attempt ${attempt})...`);
        
        const randomUserAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
        const isPythonModule = executable.includes('python3 -m');
        
        let command, args;
        
        if (isPythonModule) {
          command = 'python3';
          const module = executable.includes('yt_dlp') ? 'yt_dlp' : 'youtube_dl';
          args = [
            '-m', module,
            '--user-agent', randomUserAgent,
            '--referer', 'https://www.youtube.com/',
            '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            '--add-header', 'Accept-Language:en-US,en;q=0.5',
            '--add-header', 'Accept-Encoding:gzip, deflate',
            '--add-header', 'Connection:keep-alive',
            '--add-header', 'Upgrade-Insecure-Requests:1',
            '--extract-audio',
            '--audio-format', 'opus',
            '--audio-quality', '0',
            '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
            '--no-playlist',
            '--no-warnings',
            '--ignore-errors',
            '--no-check-certificate',
            '--prefer-insecure',
            '--socket-timeout', '30',
            '--retries', '3',
            '--output', '-',
            url
          ];
        } else {
          command = executable;
          args = [
            '--user-agent', randomUserAgent,
            '--referer', 'https://www.youtube.com/',
            '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            '--add-header', 'Accept-Language:en-US,en;q=0.5',
            '--add-header', 'Accept-Encoding:gzip, deflate',
            '--add-header', 'Connection:keep-alive',
            '--add-header', 'Upgrade-Insecure-Requests:1',
            '--extract-audio',
            '--audio-format', 'opus',
            '--audio-quality', '0',
            '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
            '--no-playlist',
            '--no-warnings',
            '--ignore-errors',
            '--no-check-certificate',
            '--prefer-insecure',
            '--socket-timeout', '30',
            '--retries', '3',
            '--output', '-',
            url
          ];
        }

        const process = spawn(command, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 45000 // 45 second timeout
        });

        const stream = new PassThrough();
        let hasData = false;
        let resolved = false;

        process.stdout.on('data', (chunk) => {
          if (!resolved) {
            console.log(`✅ ${executable} started streaming successfully`);
            resolved = true;
            resolve(stream);
          }
          hasData = true;
          stream.write(chunk);
        });

        process.stdout.on('end', () => {
          stream.end();
        });

        process.stderr.on('data', (data) => {
          const errorStr = data.toString();
          console.error(`${executable} stderr:`, errorStr);
          
          // Check for specific YouTube errors
          if (errorStr.includes('410') || errorStr.includes('Gone')) {
            if (!resolved) {
              resolved = true;
              reject(new Error('Video returned 410 Gone - video no longer available'));
            }
          } else if (errorStr.includes('blocked') || errorStr.includes('403')) {
            if (!resolved) {
              resolved = true;
              reject(new Error('Video blocked by YouTube (403 Forbidden)'));
            }
          }
        });

        process.on('error', (error) => {
          console.error(`${executable} spawn error:`, error.message);
          if (!resolved) {
            executableIndex++;
            tryExecutable();
          }
        });

        process.on('close', (code) => {
          if (code !== 0 && !hasData && !resolved) {
            console.error(`${executable} exited with code ${code}`);
            executableIndex++;
            tryExecutable();
          }
        });

        // Extended timeout for hosting environments
        setTimeout(() => {
          if (!resolved) {
            process.kill('SIGKILL');
            executableIndex++;
            tryExecutable();
          }
        }, 40000);
      };
      
      tryExecutable();
    });
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
