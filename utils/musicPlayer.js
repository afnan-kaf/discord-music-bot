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
      serverQueue.textChannel.send('❌ Failed to play this song. Skipping...');
      serverQueue.songs.shift();
      this.playSong(guild, serverQueue.songs[0]);
    }
  }

  async createAudioStream(url) {
    return new Promise((resolve, reject) => {
      // Extended executable paths for different hosting environments
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
        console.log(`Trying ${executable}...`);
        
        const isPythonModule = executable.includes('python3 -m');
        let command, args;
        
        if (isPythonModule) {
          command = 'python3';
          const module = executable.includes('yt_dlp') ? 'yt_dlp' : 'youtube_dl';
          args = [
            '-m', module,
            '--extract-audio',
            '--audio-format', 'opus',
            '--audio-quality', '0',
            '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '--referer', 'https://www.youtube.com/',
            '--output', '-',
            url
          ];
        } else {
          command = executable;
          args = [
            '--extract-audio',
            '--audio-format', 'opus',
            '--audio-quality', '0',
            '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '--referer', 'https://www.youtube.com/',
            '--output', '-',
            url
          ];
        }

        const process = spawn(command, args, {
          stdio: ['ignore', 'pipe', 'pipe']
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
          console.error(`${executable} stderr:`, data.toString());
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
            console.error(`${executable} process exited with code ${code}`);
            executableIndex++;
            tryExecutable();
          }
        });

        // Timeout after 20 seconds
        setTimeout(() => {
          if (!resolved) {
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
