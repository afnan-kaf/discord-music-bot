const mongoose = require('mongoose');

const playlistSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  guildId: { type: String, required: true },
  name: { type: String, required: true },
  songs: [{
    title: String,
    url: String,
    duration: String,
    thumbnail: String,
    addedAt: { type: Date, default: Date.now }
  }],
  isYouTubeImported: { type: Boolean, default: false },
  youtubePlaylistId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound index for efficient queries
playlistSchema.index({ userId: 1, guildId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Playlist', playlistSchema);
