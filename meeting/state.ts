import type { Transform } from 'node:stream'

import type { FfmpegCommand } from 'fluent-ffmpeg'
import type { launch } from 'puppeteer-stream'

export type Browser = Awaited<ReturnType<typeof launch>>
export type Page = Awaited<ReturnType<Browser['newPage']>>

// Shared global variables
// Shared global state variables
export default {
  activeBrowser: null as Browser | null, // Active browser process
  activeProcess: null as FfmpegCommand | null, // Active recording process
  activeRecordings: {} as Record<string, (() => void) | null>, // store active recording processes
  activeStream: null as Transform | null, // Active audio stream
  audioBuffer: Buffer.alloc(0), // Shared audio buffer
  audioProcessingInterval: null as NodeJS.Timeout | null, // Audio processing interval
  currentRecordingPath: null as string | null, // Path to the recorded video/audio
  currentSpeaker: 'User', // Current active speaker
  hasJoined: false,
  heartbeatInterval: null as NodeJS.Timeout | null, // Heartbeat updater interval
  isBotPaused: false, // Flag to track bot pausing
  isBotRunning: false, // Flag to track bot status
  isClosing: false, // Flag to track bot closing
  isFinalizing: false, // Flag to track bot finalizing
  meetingId: null as string | null, // Active meeting ID
  page: null as Page | null, // Active browser page
  pendingTranscriptions: 0, // Pending transcriptions
  sessionDir: null as string | null, // Current meeting session directory
  stopTimeout: null as NodeJS.Timeout | null, // Timeout for stopping bot after max duration
  transcriptionLog: [] as string[], // Store transcriptions
  transcriptionLogPath: null as string | null, // Path to AI-enhanced final transcription log file
  chunkedTranscriptionLogPath: null as string | null, // Path to real-time chunked transcription log file
  fullTranscriptionLogPath: null as string | null, // Path to full audio transcription log file
  // Full Audio Accumulation Mode
  fullAudioAccumulator: Buffer.alloc(0), // Accumulate entire audio for end-of-meeting processing
  isFullAccumulationMode: false, // Flag to indicate if we're in full accumulation mode
  meetingSpeakers: new Set<string>(), // Track all speakers who participated in the meeting
  speakerHistory: [] as Array<{ speaker: string; audioOffsetMs: number }>, // Track speaker at different audio positions
  currentAudioOffsetMs: 0, // Current position in accumulated audio (in milliseconds)
  lastSpeakerUpdate: 0, // Last time we recorded speaker info
  // AI-Enhanced Transcription Merging
  chunkedTranscriptions: [] as string[], // Store chunked transcriptions separately
  fullAudioTranscriptions: [] as string[], // Store full audio transcriptions separately
  // Logging throttling
  lastSpeakerLogTime: 0, // Last time we logged speaker information
  lastNoSpeakerLogTime: 0, // Last time we logged "no speakers" message
  // Audio simulation cleanup
  audioSimulationCleanup: null as (() => void) | null, // Function to cleanup audio simulation
  isUsingSimulatedAudio: false, // Flag to indicate if we're using simulated audio (bypass FFmpeg)
  // Platform information for audio processing
  meetingPlatform: 'google-meet' as string, // Current meeting platform (affects audio processing)
  // Modal suppression for Google Meet
  modalSuppressionInterval: null as NodeJS.Timeout | null, // Interval for continuous modal removal
  // Audio sample rate tracking
  currentAudioSampleRate: 16000, // Current audio sample rate (16000 Hz for Google Meet/Teams, 44100 Hz for Zoom)
}
