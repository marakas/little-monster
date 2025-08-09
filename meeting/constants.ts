import { env } from './env.ts'

// Shared constants
export const BOT_ID = `bot-${Math.random().toString(36).substring(7)}` // Unique bot identifier
export const HEARTBEAT_INTERVAL = 60_000 // dynamo db heartbeat interval
export const MAX_CONCURRENT_MEETINGS = 1 // Only process one meeting at a time

// ✅ Enhanced Audio Processing Constants
export const MAX_INTERVAL = 8_000 // Reduced from 10s to 8s for better responsiveness
export const MEET_BOT_MAX_DURATION = env.MEET_BOT_MAX_DURATION_MINUTES * 60_000 // Convert to ms
export const MIN_AUDIO_BYTES = 12_000 // Increased to prevent very short noise clips
export const MIN_AUDIO_CHUNK_LENGTH = 160_000 // Back to ~5 seconds at 16kHz * 2 bytes for better quality
export const MIN_SILENCE_DURATION = 1_200 // Increased to 1.2s for more natural breaks
export const OPENAI_API_KEY = env.OPENAI_API_KEY
export const OPENAI_WHISPER_API = 'https://api.openai.com/v1/audio/transcriptions'
export const OPENAI_WHISPER_MODEL = 'whisper-1' //'gpt-4o-transcribe',
export const POLL_INTERVAL = 5_000 // 5 seconds

// ✅ Balanced Voice Activity Detection Constants
export const SILENCE_THRESHOLD = 1_500 // Balanced threshold - not too sensitive, not too strict
export const SPEECH_THRESHOLD = 2_500 // Reduced from 3000 to allow more speech through
export const NOISE_FLOOR = 700 // Slightly reduced from 800
export const VAD_WINDOW_SIZE = 400 // 25ms windows at 16kHz (400 samples)
export const VAD_HOP_SIZE = 160 // 10ms hop (160 samples)
export const ENERGY_SMOOTH_FACTOR = 0.4 // Reduced smoothing for better responsiveness
export const SPEECH_CONFIRMATION_FRAMES = 4 // Reduced from 5 to be more responsive
export const SILENCE_CONFIRMATION_FRAMES = 10 // Reduced from 12 to prevent buffer buildup

// ✅ Balanced Audio Chunking Constants  
export const OPTIMAL_CHUNK_DURATION = 7_000 // Reduced from 8s to 7s
export const MIN_CHUNK_DURATION = 2_500 // Reduced from 3s to 2.5s
export const MAX_CHUNK_DURATION = 12_000 // Reduced from 15s to 12s to prevent large buffers
export const OVERLAP_DURATION = 300 // Keep minimal overlap
export const SPEAKER_CHANGE_BUFFER = 800 // Keep reduced buffer

// ✅ Balanced Audio Quality Enhancement
export const ENABLE_NOISE_REDUCTION = true
export const ENABLE_VOLUME_NORMALIZATION = true
export const TARGET_RMS = 6_500 // Slightly increased from 6000
export const NORMALIZATION_FACTOR = 0.7 // Slightly increased from 0.6

// ✅ Balanced Transcription Enhancement Constants
export const ENABLE_SPEAKER_DIARIZATION = true
export const CONFIDENCE_THRESHOLD = 0.5 // Reduced to 0.5 to capture more transcriptions
export const RETRY_FAILED_TRANSCRIPTIONS = true
export const MAX_TRANSCRIPTION_RETRIES = 2

// ✅ Balanced Anti-False-Positive Constants
export const MIN_SPEECH_DURATION = 1_000 // Reduced from 1500ms to 1000ms
export const ENERGY_VARIANCE_THRESHOLD = 0.2 // Reduced from 0.3 to 0.2 for more flexibility
export const CONSECUTIVE_SPEECH_THRESHOLD = 0.6 // Reduced from 0.7 to 0.6 (60% instead of 70%)

// 🛡️ UI Audio Filtering Constants
export const STARTUP_GRACE_PERIOD_MS = 30_000 // 30 seconds to filter out UI interactions during startup
export const ENABLE_UI_AUDIO_FILTERING = true // Filter out likely UI sounds/text

// 🎛️ TRANSCRIPTION MODE TOGGLE
// Set to true: AI-Enhanced mode (full audio + chunked + AI merging)
// Set to false: Simple mode (real-time chunked transcription only)
export const ENABLE_FULL_AUDIO_ACCUMULATION = false // send entire audio to Whisper at end
