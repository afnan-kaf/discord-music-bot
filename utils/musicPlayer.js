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
      
      // Create stream with faster timeout handling
      const stream = await this.createAudioStream(song.url);
      
      const resource = createAudioResource(stream, {
        inputType: 'arbitrary',
        inlineVolume: false,
        metadata: {
          title: song.title,
          url: song.url
        }
      });
      
      serverQueue.player.play(resource);
      
      // Set up timeout for playing status
      const playTimeout = setTimeout(() => {
        console.log('⚠️ Play timeout - forcing next song');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      }, 30000); // 30 second timeout

      serverQueue.player.once(AudioPlayerStatus.Playing, () => {
        clearTimeout(playTimeout);
        console.log('✅ Now playing:', song.title);
        serverQueue.textChannel.send(`🎵 **Now playing:** ${song.title}\n*Requested by: ${song.requester}*`);
      });

      serverQueue.player.once(AudioPlayerStatus.Idle, () => {
        clearTimeout(playTimeout);
        console.log('Song finished, playing next...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

      serverQueue.player.on('error', error => {
        clearTimeout(playTimeout);
        console.error('Player error:', error);
        serverQueue.textChannel.send('❌ Audio player error. Skipping to next song...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

    } catch (error) {
      console.error('Error creating stream:', error);
      serverQueue.textChannel.send('❌ Stream creation failed. Trying next song...');
      serverQueue.songs.shift();
      this.playSong(guild, serverQueue.songs[0]);
    }
  }

  async createAudioStream(url) {
    return new Promise((resolve, reject) => {
      const executables = ['yt-dlp', 'youtube-dl'];
      let executableIndex = 0;
      
      const tryExecutable = () => {
        if (executableIndex >= executables.length) {
          reject(new Error('All executables failed - hosting platform may not support binaries'));
          return;
        }
        
        const executable = executables[executableIndex];
        console.log(`Trying ${executable}...`);
        
        const args = [
          '--extract-audio',
          '--audio-format', 'opus',
          '--audio-quality', '0',
          '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
          '--no-playlist',
          '--quiet',
          '--no-warnings',
          '--socket-timeout', '10',
          '--output', '-',
          url
        ];

        const process = spawn(executable, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        const stream = new PassThrough();
        let hasData = false;
        let resolved = false;

        process.stdout.on('data', (chunk) => {
          if (!hasData) {
            hasData = true;
            if (!resolved) {
              console.log(`✅ ${executable} streaming started`);
              resolved = true;
              resolve(stream);
            }
          }
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
          executableIndex++;
          tryExecutable();
        });

        process.on('close', (code) => {
          if (code !== 0 && !hasData) {
            console.error(`${executable} exited with code ${code}`);
            executableIndex++;
            tryExecutable();
          }
        });

        // Reduced timeout for hosting environments
        setTimeout(() => {
          if (!hasData) {
            console.log(`${executable} timeout - trying next executable`);
            process.kill();
            executableIndex++;
            tryExecutable();
          }
        }, 10000); // 10 second timeout instead of 15
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
