const { EmbedBuilder } = require('discord.js');
const Playlist = require('../models/Playlist');
const ytSearch = require('youtube-search-api');
const musicCommands = require('./music');

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

async function addSong(message, args) {
  if (args.length < 2) {
    return message.reply('❌ Usage: `ftr.add-song <playlist_name> <song_name_or_url>`');
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
    
    // Check if it's a YouTube URL
    if (songQuery.includes('youtube.com/watch') || songQuery.includes('youtu.be/')) {
      song = {
        title: 'YouTube Video',
        url: songQuery,
        duration: 0,
        thumbnail: null
      };
    } else {
      // Search for song using YouTube search API
      const results = await ytSearch.GetListByKeyword(songQuery, false, 1);
      if (!results.items?.length) {
        return message.reply('❌ No results found for your search!');
      }
      
      const video = results.items[0];
      song = {
        title: video.title,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        duration: 0,
        thumbnail: video.thumbnail?.thumbnails?.[0]?.url
      };
    }

    playlist.songs.push(song);
    playlist.updatedAt = new Date();
    await playlist.save();

    const embed = new EmbedBuilder()
      .setTitle('✅ Song Added')
      .setDescription(`Added **${song.title}** to playlist **${playlistName}**`)
      .setThumbnail(song.thumbnail)
      .setColor('#4CAF50');
    
    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Add song error:', error);
    message.reply('❌ An error occurred while adding the song.');
  }
}

async function removeSong(message, args) {
  if (args.length < 2) {
    return message.reply('❌ Usage: `ftr.remove-song <playlist_name> <song_index>`');
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
      return message.reply('❌ Invalid song index!');
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
      return message.reply('❌ You don\'t have any playlists yet!');
    }

    const embed = new EmbedBuilder()
      .setTitle('📝 Your Playlists')
      .setColor('#9C27B0');

    let playlistList = '';
    playlists.forEach((playlist) => {
      const songCount = playlist.songs.length;
      playlistList += `📝 **${playlist.name}** (${songCount} songs)\n`;
    });

    embed.setDescription(playlistList);
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
      return message.reply('❌ This playlist is empty!');
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎵 Songs in "${playlist.name}"`)
      .setColor('#2196F3');

    let songList = '';
    playlist.songs.slice(0, 15).forEach((song, index) => {
      songList += `${index + 1}. **${song.title}**\n`;
    });

    if (playlist.songs.length > 15) {
      songList += `\n... and ${playlist.songs.length - 15} more songs`;
    }

    embed.setDescription(songList);
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

    // Add all songs from playlist to queue
    for (const song of playlist.songs) {
      await musicCommands.play(message, [song.url]);
    }

    const embed = new EmbedBuilder()
      .setTitle('🎵 Playing Playlist')
      .setDescription(`Playing **${playlist.name}** (${playlist.songs.length} songs)`)
      .setColor('#2196F3');
    
    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Play playlist error:', error);
    message.reply('❌ An error occurred while playing the playlist.');
  }
}

async function renamePlaylist(message, args) {
  if (args.length < 2) {
    return message.reply('❌ Usage: `ftr.rename-playlist <old_name> <new_name>`');
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
