const { createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');

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
      
      // Create stream with verbose error handling
      const stream = youtubedl(song.url, {
        output: '-',
        format: 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
        extractAudio: true,
        audioFormat: 'opus',
        audioQuality: 0,
        noPlaylist: true,
        quiet: false, // Enable output for debugging
        verbose: true // Enable verbose output
      });
      
      // Monitor stream for data
      let hasStartedStreaming = false;
      
      stream.on('data', (chunk) => {
        if (!hasStartedStreaming) {
          console.log('✅ Audio stream started successfully');
          hasStartedStreaming = true;
        }
      });

      stream.on('error', (error) => {
        console.error('❌ Stream error:', error);
        serverQueue.textChannel.send('❌ Failed to create audio stream. Check if youtube-dl is installed.');
      });

      stream.on('end', () => {
        if (!hasStartedStreaming) {
          console.log('❌ Stream ended without data - youtube-dl may not be working');
          serverQueue.textChannel.send('❌ Audio stream failed - please check youtube-dl installation.');
        }
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
        console.error('Player error:', error);
        serverQueue.textChannel.send('❌ Audio player error. Skipping to next song...');
        serverQueue.songs.shift();
        this.playSong(guild, serverQueue.songs[0]);
      });

    } catch (error) {
      console.error('Error creating stream:', error);
      serverQueue.textChannel.send('❌ Failed to play this song. Ensure youtube-dl is installed and accessible.');
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
