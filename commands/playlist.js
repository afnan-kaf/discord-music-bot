const { EmbedBuilder } = require('discord.js');
const Playlist = require('../models/Playlist');
const newPipeService = require('../utils/newpipeService');
const music = require('./music');

// Rate limiting for API calls
let lastSearchTime = 0;
const SEARCH_DELAY = 1000; // 1 second between searches

async function createPlaylist(message, args) {
  if (!args.length) return message.reply('❌ Please provide a name for your playlist!');

  const playlistName = args.join(' ');
  try {
    const existingPlaylist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });
    if (existingPlaylist) return message.reply('❌ You already have a playlist with this name!');

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
  if (!args.length) return message.reply('❌ Please provide the name of the playlist to delete!');

  const playlistName = args.join(' ');
  try {
    const result = await Playlist.deleteOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });
    if (result.deletedCount === 0) return message.reply('❌ Playlist not found!');

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
  if (args.length < 2) return message.reply('❌ Usage: ftm.add-to-playlist <playlist-name> <song-name or URL>');

  const playlistName = args[0];
  const songQuery = args.slice(1).join(' ');
  try {
    const playlist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });
    if (!playlist) return message.reply('❌ Playlist not found!');

    let song;
    const searchMessage = await message.reply('🔍 Searching for song...');

    // Check if it's a URL
    if (songQuery.includes('youtube.com/watch') || songQuery.includes('youtu.be/')) {
      const videoInfo = await newPipeService.validateVideo(extractVideoId(songQuery));
      if (!videoInfo) return await searchMessage.edit('❌ Invalid or unavailable video!');
      song = videoInfo;
    } else {
      // Search using NewPipe
      const results = await newPipeService.searchVideos(songQuery, 5);
      if (!results.length) return await searchMessage.edit('❌ No results found for your search!');

      let videoFound = false;
      for (const result of results) {
        try {
          const streamData = await newPipeService.getStreamUrls(result.videoId);
          if (streamData && streamData.audioUrl) {
            song = {
              title: streamData.title,
              url: result.url,
              duration: streamData.duration ? streamData.duration.toString() : 'Unknown',
              thumbnail: streamData.thumbnail
            };
            videoFound = true;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      if (!videoFound) return await searchMessage.edit('❌ No playable videos found!');
    }

    playlist.songs.push({
      title: song.title,
      url: song.url,
      duration: song.duration,
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
  if (args.length < 2) return message.reply('❌ Usage: ftm.remove-from-playlist <playlist-name> <song-number>');

  const playlistName = args[0];
  const songIndex = parseInt(args[1]) - 1;
  try {
    const playlist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });
    if (!playlist) return message.reply('❌ Playlist not found!');

    if (songIndex < 0 || songIndex >= playlist.songs.length) return message.reply('❌ Invalid song number! Use ftm.show-playlist to see numbers.');

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

async function showPlaylistSongs(message, args) {
  if (!args.length) return message.reply('❌ Please provide the name of the playlist to view!');

  const playlistName = args.join(' ');
  try {
    const playlist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });
    if (!playlist) return message.reply('❌ Playlist not found!');

    if (!playlist.songs.length) return message.reply('❌ This playlist is empty! Use ftm.add-to-playlist to add songs.');

    const embed = new EmbedBuilder()
      .setTitle(`🎵 Songs in "${playlist.name}"`)
      .setColor('#2196F3');
    let songList = '';
    playlist.songs.slice(0, 15).forEach((song, index) => {
      const duration = song.duration !== 'Unknown' ? `[${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}]` : '[Unknown]';
      songList += `${index + 1}. **${song.title}** ${duration}\n`;
    });
    if (playlist.songs.length > 15) songList += `\n... and ${playlist.songs.length - 15} more songs`;
    embed.setDescription(songList);
    embed.setFooter({ text: `Total: ${playlist.songs.length} songs` });
    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Show playlist songs error:', error);
    message.reply('❌ An error occurred while fetching playlist songs.');
  }
}

async function playPlaylist(message, args) {
  if (!args.length) return message.reply('❌ Please provide the name of the playlist to play!');

  const playlistName = args.join(' ');
  try {
    const playlist = await Playlist.findOne({
      userId: message.author.id,
      guildId: message.guild.id,
      name: playlistName
    });
    if (!playlist) return message.reply('❌ Playlist not found!');

    if (!playlist.songs.length) return message.reply('❌ This playlist is empty!');

    const embed = new EmbedBuilder()
      .setTitle('🎵 Playing Playlist')
      .setDescription(`Starting playlist **${playlist.name}** (${playlist.songs.length} songs)`)
      .setColor('#2196F3');
    await message.reply({ embeds: [embed] });

    // Play the first song, then add the rest to queue with delay to avoid rate limiting
    const firstSong = playlist.songs[0];
    await music.play(message, [firstSong.url]);

    for (let i = 1; i < playlist.songs.length; i++) {
      await new Promise(resolve => setTimeout(resolve, i * 1000)); // 1 second delay
      await music.play(message, [playlist.songs[i].url]);
    }
  } catch (error) {
    console.error('Play playlist error:', error);
    message.reply('❌ An error occurred while playing the playlist.');
  }
}

module.exports = { createPlaylist, deletePlaylist, addSong, removeSong, showPlaylistSongs, playPlaylist };
