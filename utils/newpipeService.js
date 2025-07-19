const axios = require('axios');

class NewPipeService {
  constructor() {
    // Curated list of verified, working Piped instances as of July 2025 (removed invalid/down ones)
    this.instances = [
      'https://pipedapi.kavin.rocks',
      'https://pipedapi.tokhmi.xyz',
      'https://pipedapi.moomoo.me',
      'https://pipedapi.syncpundit.io',
      'https://api-piped.mha.fi',
      'https://pipedapi.rivo.lol',
      'https://pipedapi.leptons.xyz',
      'https://piped-api.lunar.icu',
      'https://pipedapi.colinslegacy.com',
      'https://yapi.vyper.me',
      'https://api.looleh.xyz',
      'https://pipedapi-libre.kavin.rocks',
      'https://pa.mint.lgbt',
      'https://pa.il.ax',
      'https://pipedapi.qdi.fi'
    ];
    this.currentInstance = 0;
  }

  // Get next available instance (rotation for anti-flagging)
  getNextInstance() {
    const instance = this.instances[this.currentInstance];
    this.currentInstance = (this.currentInstance + 1) % this.instances.length;
    return instance;
  }

  // Search for videos with retries and timeout
  async searchVideos(query, maxResults = 10) {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), 30000));
    try {
      return await Promise.race([timeoutPromise, this.performSearch(query, maxResults)]);
    } catch (error) {
      console.error('Search timeout or error:', error);
      return [];
    }
  }

  async performSearch(query, maxResults) {
    for (let attempt = 0; attempt < this.instances.length; attempt++) {
      const instance = this.getNextInstance();
      console.log(`Searching NewPipe instance: ${instance}`);
      for (let retry = 0; retry < 2; retry++) { // Reduced to 2 retries
        try {
          const response = await axios.get(`${instance}/search`, {
            params: { q: query, filter: 'videos' },
            timeout: 10000, // Reduced per-request timeout
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'audio/*,*/*;q=0.9'
            }
          });
          if (response.data.items && response.data.items.length > 0) {
            return response.data.items.slice(0, maxResults).map(item => ({
              title: item.title,
              videoId: this.extractVideoId(item.url),
              url: item.url,
              duration: item.duration,
              thumbnail: item.thumbnail,
              uploader: item.uploaderName,
              source: 'newpipe'
            }));
          }
        } catch (error) {
          console.error(`NewPipe instance ${instance} failed (retry ${retry + 1}):`, error.message);
          if (error.response?.status === 403) break;
          await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced delay to 1s
        }
      }
    }
    return [];
  }

  // Get stream URLs for a video with retries and timeout
  async getStreamUrls(videoId) {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Stream fetch timeout')), 30000));
    try {
      return await Promise.race([timeoutPromise, this.performGetStreams(videoId)]);
    } catch (error) {
      console.error('Stream fetch timeout or error:', error);
      throw error;
    }
  }

  async performGetStreams(videoId) {
    for (let attempt = 0; attempt < this.instances.length; attempt++) {
      const instance = this.getNextInstance();
      console.log(`Getting stream from NewPipe instance: ${instance}`);
      for (let retry = 0; retry < 2; retry++) {
        try {
          const response = await axios.get(`${instance}/streams/${videoId}`, {
            timeout: 15000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          const data = response.data;
          const audioStreams = data.audioStreams || [];
          if (audioStreams.length > 0) {
            const sortedStreams = audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            return {
              title: data.title,
              duration: data.duration,
              thumbnail: data.thumbnailUrl,
              uploader: data.uploader,
              audioUrl: sortedStreams[0].url,
              audioStreams: sortedStreams,
              source: 'newpipe'
            };
          }
        } catch (error) {
          console.error(`NewPipe stream fetch failed (retry ${retry + 1}):`, error.message);
          if (error.response?.status === 403) break;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    throw new Error('No working NewPipe instance found');
  }

  // Extract video ID from URL
  extractVideoId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
    return match ? match[1] : null;
  }

  // Validate video availability
  async validateVideo(videoId) {
    try {
      const streamData = await this.getStreamUrls(videoId);
      return streamData.audioUrl ? streamData : null;
    } catch (error) {
      console.error('Video validation error:', error);
      return null;
    }
  }

  async createAudioStreamFromUrl(audioUrl) {
    try {
      const response = await axios({
        method: 'GET',
        url: audioUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'audio/*,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        },
        timeout: 30000
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create audio stream: ${error.message}`);
    }
  }
}

module.exports = new NewPipeService();
