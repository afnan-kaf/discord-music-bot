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
      
      // Create stream using yt-dlp binary (most reliable method)
      const stream = await this.createYtDlpStream(song.url);
      
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
      serverQueue.textChannel.send('❌ Failed to play this song. YouTube may have blocked it. Skipping...');
      serverQueue.songs.shift();
      this.playSong(guild, serverQueue.songs[0]);
    }
  }

  async createYtDlpStream(url) {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', [
        '--extract-audio',
        '--audio-format', 'opus',
        '--audio-quality', '0',
        '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        '--output', '-',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        url
      ]);

      const stream = new PassThrough();
      let hasStarted = false;

      ytDlp.stdout.on('data', (chunk) => {
        if (!hasStarted) {
          hasStarted = true;
          resolve(stream);
        }
        stream.write(chunk);
      });

      ytDlp.stdout.on('end', () => {
        stream.end();
      });

      ytDlp.stderr.on('data', (data) => {
        console.error('yt-dlp stderr:', data.toString());
      });

      ytDlp.on('error', (error) => {
        console.error('yt-dlp spawn error:', error);
        reject(new Error('yt-dlp binary not found. Please install yt-dlp.'));
      });

      ytDlp.on('close', (code) => {
        if (code !== 0 && !hasStarted) {
          reject(new Error(`yt-dlp exited with code ${code}`));
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!hasStarted) {
          ytDlp.kill();
          reject(new Error('yt-dlp timeout'));
        }
      }, 30000);
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
