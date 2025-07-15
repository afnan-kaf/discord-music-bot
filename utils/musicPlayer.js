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
        serverQueue.textChannel.send('❌ Audio player error. Skipping to next song...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

      stream.on('error', (error) => {
        console.error('Stream error:', error);
        serverQueue.textChannel.send('❌ YouTube stream error. Skipping to next song...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

    } catch (error) {
      console.error('Error creating stream:', error);
      serverQueue.textChannel.send('❌ Failed to play this song. Skipping to next song...');
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
      serverQueue.player?.stop();
      serverQueue.voiceConnection?.destroy();
    }
    this.queues.delete(guildId);
  }
}

module.exports = new MusicPlayer();
