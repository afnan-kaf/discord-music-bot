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
      
      // Create proper stream using spawn instead of youtube-dl-exec directly
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
      // Try yt-dlp first, then youtube-dl as fallback
      const executables = ['yt-dlp', 'youtube-dl'];
      let executableIndex = 0;
      
      const tryExecutable = () => {
        if (executableIndex >= executables.length) {
          reject(new Error('Neither yt-dlp nor youtube-dl is available'));
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
          '--output', '-',
          url
        ];

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
          console.error(`${executable} stderr:`, data.toString());
        });

        process.on('error', (error) => {
          console.error(`${executable} process error:`, error.message);
          executableIndex++;
          tryExecutable();
        });

        process.on('close', (code) => {
          if (code !== 0 && !hasData) {
            console.error(`${executable} process exited with code ${code}`);
            executableIndex++;
            tryExecutable();
          }
        });

        // Resolve when we start receiving data
        process.stdout.once('data', () => {
          console.log(`✅ ${executable} started streaming successfully`);
          resolve(stream);
        });

        // Timeout after 15 seconds
        setTimeout(() => {
          if (!hasData) {
            process.kill();
            executableIndex++;
            tryExecutable();
          }
        }, 15000);
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
