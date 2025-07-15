const { EmbedBuilder } = require('discord.js');
const Playlist = require('../models/Playlist');
const ytdl = require('ytdl-core');
const ytSearch = require('youtube-search-api');
const musicCommands = require('./music');

// Rate limiting for API calls
let lastSearchTime = 0;
const SEARCH_DELAY = 1000; // 1 second between searches

async function createPlaylist(message, args) {
  if (!args.length) {
    return message.reply('❌ Please provide a name for your playlist!');
  }

  const playlistName = args.join(' ');
  
  try {
    const existingPlaylist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });

    if (existingPlaylist) {
      return message.reply('❌ You already have a playlist with this name!');
    }

    const newPlaylist = new Playlist({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName,
      songs: []
    });

    await newPlaylist.save();

    const embed = new EmbedBuilder()
      .setTitle('✅ Playlist Created')
      .setDescription(`Created playlist: **${playlistName}**`)
      .setColor('#4CAF50');

    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Create playlist error:', error);
    message.reply('❌ An error occurred while creating the playlist.');
  }
}

async function deletePlaylist(message, args) {
  if (!args.length) {
    return message.reply('❌ Please provide the name of the playlist to delete!');
  }

  const playlistName = args.join(' ');
  
  try {
    const result = await Playlist.deleteOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });

    if (result.deletedCount === 0) {
      return message.reply('❌ Playlist not found!');
    }

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Playlist Deleted')
      .setDescription(`Deleted playlist: **${playlistName}**`)
      .setColor('#F44336');

    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Delete playlist error:', error);
    message.reply('❌ An error occurred while deleting the playlist.');
  }
}

async function validateYouTubeVideo(url) {
  try {
    if (!ytdl.validateURL(url)) {
      return null;
    }
    
    const info = await ytdl.getBasicInfo(url);
    return {
      title: info.videoDetails.title,
      url: info.videoDetails.video_url,
      duration: info.videoDetails.lengthSeconds,
      thumbnail: info.videoDetails.thumbnails?.[0]?.url
    };
  } catch (error) {
    console.error('Video validation error:', error);
    return null;
  }
}

async function addSong(message, args) {
  if (args.length < 2) {
    return message.reply('❌ Usage: `ftm.add-song <playlist-name> <song-name-or-url>`');
  }

  const playlistName = args[0];
  const songQuery = args.slice(1).join(' ');

  try {
    const playlist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });

    if (!playlist) {
      return message.reply('❌ Playlist not found!');
    }

    let song;
    const searchMessage = await message.reply('🔍 Searching for song...');

    // Rate limiting
    const now = Date.now();
    if (now - lastSearchTime < SEARCH_DELAY) {
      await new Promise(resolve => setTimeout(resolve, SEARCH_DELAY));
    }
    lastSearchTime = Date.now();

    // Check if it's a YouTube URL
    if (songQuery.includes('youtube.com/watch') || songQuery.includes('youtu.be/')) {
      const videoInfo = await validateYouTubeVideo(songQuery);
      if (!videoInfo) {
        return await searchMessage.edit('❌ Invalid or unavailable YouTube video!');
      }
      song = videoInfo;
    } else {
      // Search for song using YouTube search API with anti-bot measures
      try {
        const results = await ytSearch.GetListByKeyword(songQuery, false, 3);
        if (!results.items?.length) {
          return await searchMessage.edit('❌ No results found for your search!');
        }

        // Try multiple results for better success rate
        let videoFound = false;
        for (const video of results.items) {
          const testUrl = `https://www.youtube.com/watch?v=${video.id}`;
          const videoInfo = await validateYouTubeVideo(testUrl);
          
          if (videoInfo) {
            song = videoInfo;
            videoFound = true;
            break;
          }
        }

        if (!videoFound) {
          return await searchMessage.edit('❌ No available videos found for your search!');
        }
      } catch (searchError) {
        console.error('Search error:', searchError);
        return await searchMessage.edit('❌ Error searching for the song. Please try again.');
      }
    }

    playlist.songs.push({
      title: song.title,
      url: song.url,
      duration: song.duration ? song.duration.toString() : 'Unknown',
      thumbnail: song.thumbnail
    });
    playlist.updatedAt = new Date();
    await playlist.save();

    const embed = new EmbedBuilder()
      .setTitle('✅ Song Added')
      .setDescription(`Added **${song.title}** to playlist **${playlistName}**`)
      .setThumbnail(song.thumbnail)
      .setColor('#4CAF50');

    await searchMessage.edit({ content: '', embeds: [embed] });
  } catch (error) {
    console.error('Add song error:', error);
    message.reply('❌ An error occurred while adding the song.');
  }
}

async function removeSong(message, args) {
  if (args.length < 2) {
    return message.reply('❌ Usage: `ftm.remove-song <playlist-name> <song-number>`');
  }

  const playlistName = args[0];
  const songIndex = parseInt(args[1]) - 1;

  try {
    const playlist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });

    if (!playlist) {
      return message.reply('❌ Playlist not found!');
    }

    if (songIndex < 0 || songIndex >= playlist.songs.length) {
      return message.reply('❌ Invalid song number! Use `ftm.show-playlist` to see song numbers.');
    }

    const removedSong = playlist.songs[songIndex];
    playlist.songs.splice(songIndex, 1);
    playlist.updatedAt = new Date();
    await playlist.save();

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Song Removed')
      .setDescription(`Removed **${removedSong.title}** from playlist **${playlistName}**`)
      .setColor('#F44336');

    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Remove song error:', error);
    message.reply('❌ An error occurred while removing the song.');
  }
}

async function showPlaylists(message) {
  try {
    const playlists = await Playlist.find({
      userId: message.author.id,
      guildId: message.guild.id
    });

    if (!playlists.length) {
      return message.reply('❌ You don\'t have any playlists yet! Use `ftm.create-playlist` to create one.');
    }

    const embed = new EmbedBuilder()
      .setTitle('📝 Your Playlists')
      .setColor('#9C27B0');

    let playlistList = '';
    playlists.forEach((playlist, index) => {
      const songCount = playlist.songs.length;
      const isImported = playlist.isYouTubeImported ? '📺' : '📝';
      playlistList += `${isImported} **${playlist.name}** (${songCount} songs)\n`;
    });

    embed.setDescription(playlistList);
    embed.setFooter({ text: '📺 = YouTube imported, 📝 = Manual playlist' });

    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Show playlists error:', error);
    message.reply('❌ An error occurred while fetching playlists.');
  }
}

async function showPlaylistSongs(message, args) {
  if (!args.length) {
    return message.reply('❌ Please provide the name of the playlist to view!');
  }

  const playlistName = args.join(' ');

  try {
    const playlist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });

    if (!playlist) {
      return message.reply('❌ Playlist not found!');
    }

    if (!playlist.songs.length) {
      return message.reply('❌ This playlist is empty! Use `ftm.add-song` to add songs.');
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎵 Songs in "${playlist.name}"`)
      .setColor('#2196F3');

    let songList = '';
    playlist.songs.slice(0, 15).forEach((song, index) => {
      const duration = song.duration !== 'Unknown' ? `[${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}]` : '[Unknown]';
      songList += `${index + 1}. **${song.title}** ${duration}\n`;
    });

    if (playlist.songs.length > 15) {
      songList += `\n... and ${playlist.songs.length - 15} more songs`;
    }

    embed.setDescription(songList);
    embed.setFooter({ text: `Total: ${playlist.songs.length} songs` });

    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Show playlist songs error:', error);
    message.reply('❌ An error occurred while fetching playlist songs.');
  }
}

async function playPlaylist(message, args) {
  if (!args.length) {
    return message.reply('❌ Please provide the name of the playlist to play!');
  }

  const playlistName = args.join(' ');

  try {
    const playlist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });

    if (!playlist) {
      return message.reply('❌ Playlist not found!');
    }

    if (!playlist.songs.length) {
      return message.reply('❌ This playlist is empty!');
    }

    const embed = new EmbedBuilder()
      .setTitle('🎵 Playing Playlist')
      .setDescription(`Starting playlist **${playlist.name}** (${playlist.songs.length} songs)`)
      .setColor('#2196F3');

    await message.reply({ embeds: [embed] });

    // Play the first song, then add the rest to queue
    const firstSong = playlist.songs[0];
    await musicCommands.play(message, [firstSong.url]);

    // Add remaining songs to queue with delay to avoid rate limiting
    for (let i = 1; i < playlist.songs.length; i++) {
      setTimeout(async () => {
        await musicCommands.play(message, [playlist.songs[i].url]);
      }, i * 1000); // 1 second delay between each song
    }

  } catch (error) {
    console.error('Play playlist error:', error);
    message.reply('❌ An error occurred while playing the playlist.');
  }
}

async function renamePlaylist(message, args) {
  if (args.length < 2) {
    return message.reply('❌ Usage: `ftm.rename-playlist <old-name> <new-name>`');
  }

  const oldName = args[0];
  const newName = args.slice(1).join(' ');

  try {
    const playlist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: oldName
    });

    if (!playlist) {
      return message.reply('❌ Playlist not found!');
    }

    const existingPlaylist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: newName
    });

    if (existingPlaylist) {
      return message.reply('❌ A playlist with this name already exists!');
    }

    playlist.name = newName;
    playlist.updatedAt = new Date();
    await playlist.save();

    const embed = new EmbedBuilder()
      .setTitle('✏️ Playlist Renamed')
      .setDescription(`Renamed **${oldName}** to **${newName}**`)
      .setColor('#FF9800');

    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Rename playlist error:', error);
    message.reply('❌ An error occurred while renaming the playlist.');
  }
}

module.exports = {
  createPlaylist,
  deletePlaylist,
  addSong,
  removeSong,
  showPlaylists,
  showPlaylistSongs,
  playPlaylist,
  renamePlaylist
};
