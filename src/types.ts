export interface AudioTrackInfo {
  index: number;
  streamIndex: number;
  codec: string;
  language?: string;
  title?: string;
  channels?: number;
}

export interface SubtitleTrackInfo {
  index: number;
  streamIndex: number;
  codec: string;
  language?: string;
  title?: string;
  isExternal?: boolean;
  isImported?: boolean;
  source?: 'local' | 'opensubtitles';
  filePath?: string;
}

export interface OnlineSubtitleOption {
  id: string;
  fileId: number;
  language: string;
  languageName?: string;
  release?: string;
  fileName?: string;
  fps?: number;
  hearingImpaired?: boolean;
  downloadCount?: number;
}

export interface HardwareAccelerationStatus {
  mode: 'auto' | 'off' | 'software';
  encoder?: string;
  hwaccel?: string;
  availableEncoders: string[];
}

export interface CastMember {
  id: number;
  name: string;
  character?: string;
  profilePath?: string;
}

export interface Episode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  fileName: string;
  filePath: string;
  relativeFilePath?: string;
  extension: string;
  sizeBytes: number;
  durationSeconds: number;
  videoCodec?: string;
  pixFmt?: string;
  resolution?: string;
  audioTracks: AudioTrackInfo[];
  subtitleTracks: SubtitleTrackInfo[];
  thumbnailPath?: string;
  watched: boolean;
  progressSeconds: number;
  lastWatchedAt?: string;
  selectedAudioIndex?: number;
  selectedSubtitleIndex?: number; // -1 for off
  tmdbId?: number;
  overview?: string;
  airDate?: string;
  rating?: number;
  stillPath?: string;
  isTorrent?: boolean;
  fileIndex?: number;
  magnetUri?: string;
  infoHash?: string;
}

export interface Season {
  seasonNumber: number;
  title: string;
  episodes: Episode[];
}

export type MediaKind = 'series' | 'movie';

export interface MediaItem {
  id: string;
  title: string;
  originalTitle?: string;
  kind: MediaKind;
  folderPath: string;
  relativeFolderPath?: string;
  posterPath?: string;
  backdropPath?: string;
  year?: number;
  overview?: string;
  tagline?: string;
  genres?: string[];
  rating?: number;
  voteCount?: number;
  cast?: CastMember[];
  tmdbId?: number;
  metadataProvider?: 'tmdb';
  customTitle?: string;
  totalEpisodes: number;
  totalSeasons: number;
  seasons: Season[];
  lastWatchedEpisodeId?: string;
  lastWatchedAt?: string;
  createdAt: string;
  updatedAt: string;
  isTorrent?: boolean;
  magnetUri?: string;
  infoHash?: string;
}

export interface LibraryData {
  version: number;
  updatedAt: string;
  settings: {
    preferredAudioLanguage: string;
    preferredSubtitleLanguage: string;
    autoPlayNext: boolean;
    relocateDriveLetterMap?: Record<string, string>;
    tmdbApiKey?: string;
    tmdbAccessToken?: string;
    tmdbLanguage?: string;
  };
  items: MediaItem[];
}

export interface SystemStatus {
  ffmpegFound: boolean;
  ffmpegPath?: string;
  ffprobeFound: boolean;
  ffprobePath?: string;
  appDir: string;
  dataDir: string;
  libraryPath: string;
  totalItems: number;
  platform: string;
  tmdbConfigured?: boolean;
  tmdbApiKeyConfigured?: boolean;
  tmdbLanguage?: string;
  openSubtitlesConfigured?: boolean;
  openSubtitlesAccountConfigured?: boolean;
  openSubtitlesUsername?: string;
  hardwareAcceleration?: HardwareAccelerationStatus;
}

export interface BrowseItem {
  name: string;
  path: string;
  isDirectory: boolean;
  hasMediaFiles?: boolean;
}

export interface TorrentFileItem {
  index: number;
  name: string;
  path: string;
  length: number;
  isVideo: boolean;
  isSubtitle: boolean;
  extension: string;
}

export interface TorrentStatus {
  infoHash: string;
  magnetUri?: string;
  name: string;
  state: 'connecting' | 'metadata' | 'ready' | 'downloading' | 'error';
  totalBytes: number;
  downloadedBytes: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  progress: number;
  selectedFileIndex: number;
  files: TorrentFileItem[];
  errorMessage?: string;
}

export interface TorrentHistoryItem {
  infoHash: string;
  magnetUri: string;
  name: string;
  kind?: MediaKind;
  dateAdded: string;
  lastWatchedAt?: string;
  progressSeconds?: number;
  durationSeconds?: number;
  selectedFileIndex?: number;
  totalBytes?: number;
}

export interface IptvChannel {
  id: string;
  name: string;
  logo?: string;
  group: string;
  country?: string;
  language?: string;
  url: string;
  tvgId?: string;
  resolution?: string;
  httpUserAgent?: string;
  httpReferrer?: string;
}

export interface IptvPreset {
  name: string;
  url: string;
  description: string;
}

export interface IptvPlaylistSummary {
  url: string;
  totalChannels: number;
  categories: string[];
  countries: string[];
  channels: IptvChannel[];
  lastUpdated: string;
}

export type ChannelStatus = 'online' | 'offline' | 'unknown';

export interface ChannelStatusInfo {
  status: 'online' | 'offline';
  lastChecked: string;
}

