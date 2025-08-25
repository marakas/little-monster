import {
  ENERGY_SMOOTH_FACTOR,
  NOISE_FLOOR,
  SILENCE_CONFIRMATION_FRAMES,
  SILENCE_THRESHOLD,
  SPEECH_CONFIRMATION_FRAMES,
  SPEECH_THRESHOLD,
  VAD_HOP_SIZE,
  VAD_WINDOW_SIZE,
  ENABLE_NOISE_REDUCTION,
  ENABLE_VOLUME_NORMALIZATION,
  TARGET_RMS,
  NORMALIZATION_FACTOR,
  OVERLAP_DURATION,
  MIN_CHUNK_DURATION,
  MAX_CHUNK_DURATION,
  OPTIMAL_CHUNK_DURATION,
  SPEAKER_CHANGE_BUFFER,
  MIN_SPEECH_DURATION,
  ENERGY_VARIANCE_THRESHOLD,
  CONSECUTIVE_SPEECH_THRESHOLD,
  STARTUP_GRACE_PERIOD_MS,
} from "./constants.ts";

interface AudioProcessorState {
  smoothedEnergy: number;
  speechFrameCount: number;
  silenceFrameCount: number;
  isSpeechActive: boolean;
  lastSpeechTime: number;
  lastSilenceTime: number;
  pendingAudioBuffer: Buffer;
  processedSamples: number;
  backgroundNoiseLevel: number;
  lastSpeakerChangeTime: number;
  recentEnergyValues: number[];
  speechFrameHistory: boolean[];
  totalSpeechFrames: number;
  totalFrames: number;
  startupTime: number;
  hasJoinedMeeting: boolean;
  sampleRate: number; // Add sample rate tracking
}

class EnhancedAudioProcessor {
  private state: AudioProcessorState;

  constructor() {
    this.state = {
      smoothedEnergy: 0,
      speechFrameCount: 0,
      silenceFrameCount: 0,
      isSpeechActive: false,
      lastSpeechTime: Date.now(),
      lastSilenceTime: Date.now(),
      pendingAudioBuffer: Buffer.alloc(0),
      processedSamples: 0,
      backgroundNoiseLevel: NOISE_FLOOR,
      lastSpeakerChangeTime: 0,
      recentEnergyValues: [],
      speechFrameHistory: [],
      totalSpeechFrames: 0,
      totalFrames: 0,
      startupTime: Date.now(),
      hasJoinedMeeting: false,
      sampleRate: 16000, // Initialize sample rate
    };
  }

  /**
   * Calculate energy variance to distinguish speech from constant noise
   */
  private calculateEnergyVariance(): number {
    if (this.state.recentEnergyValues.length < 5) return 0;

    const mean =
      this.state.recentEnergyValues.reduce((a, b) => a + b, 0) /
      this.state.recentEnergyValues.length;
    const variance =
      this.state.recentEnergyValues.reduce(
        (acc, val) => acc + Math.pow(val - mean, 2),
        0
      ) / this.state.recentEnergyValues.length;
    return Math.sqrt(variance) / mean; // Coefficient of variation
  }

  /**
   * Check if current audio pattern resembles human speech
   */
  private isLikelySpeech(energy: number): boolean {
    // 1. Energy must be above speech threshold
    if (energy < SPEECH_THRESHOLD) return false;

    // 2. Energy variance must indicate dynamic content (not constant noise)
    const energyVariance = this.calculateEnergyVariance();
    if (energyVariance < ENERGY_VARIANCE_THRESHOLD) {
      return false;
    }

    // 3. Must be significantly above adaptive background noise
    const adaptiveThreshold = Math.max(
      this.state.backgroundNoiseLevel * 3.5, // Increased multiplier
      SPEECH_THRESHOLD
    );

    return energy > adaptiveThreshold;
  }

  /**
   * Enhanced Voice Activity Detection with false-positive filtering
   */
  private detectVoiceActivity(buffer: Buffer): boolean {
    if (buffer.length < VAD_WINDOW_SIZE * 2) return false;

    let totalEnergy = 0;
    const frameCount = Math.floor(buffer.length / (VAD_WINDOW_SIZE * 2));

    // Process in overlapping windows for better detection
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const startSample = frameIndex * VAD_HOP_SIZE * 2;
      const endSample = Math.min(
        startSample + VAD_WINDOW_SIZE * 2,
        buffer.length
      );

      let frameEnergy = 0;
      const sampleCount = (endSample - startSample) / 2;

      for (let i = startSample; i < endSample; i += 2) {
        const sample = buffer.readInt16LE(i);
        frameEnergy += sample * sample;
      }

      frameEnergy = Math.sqrt(frameEnergy / sampleCount);
      totalEnergy += frameEnergy;
    }

    const avgEnergy = totalEnergy / frameCount;

    // Smooth energy calculation for stability
    this.state.smoothedEnergy =
      ENERGY_SMOOTH_FACTOR * avgEnergy +
      (1 - ENERGY_SMOOTH_FACTOR) * this.state.smoothedEnergy;

    // Track recent energy values for variance calculation
    this.state.recentEnergyValues.push(avgEnergy);
    if (this.state.recentEnergyValues.length > 20) {
      // Keep last 20 values
      this.state.recentEnergyValues.shift();
    }

    // Conservative background noise estimation - only during confirmed silence
    if (
      !this.state.isSpeechActive &&
      avgEnergy < this.state.backgroundNoiseLevel * 1.5
    ) {
      this.state.backgroundNoiseLevel =
        0.98 * this.state.backgroundNoiseLevel + 0.02 * avgEnergy; // Very slow adaptation
    }

    // Use enhanced speech detection
    const isSpeechFrame = this.isLikelySpeech(this.state.smoothedEnergy);

    // Track speech frame history for quality assessment
    this.state.speechFrameHistory.push(isSpeechFrame);
    if (this.state.speechFrameHistory.length > 50) {
      // Keep last 50 frames
      this.state.speechFrameHistory.shift();
    }

    this.state.totalFrames++;
    if (isSpeechFrame) {
      this.state.totalSpeechFrames++;
    }

    // Update frame counters with stricter requirements
    if (isSpeechFrame) {
      this.state.speechFrameCount++;
      this.state.silenceFrameCount = 0;
    } else {
      this.state.silenceFrameCount++;
      this.state.speechFrameCount = 0;
    }

    // Determine speech state with more conservative hysteresis
    const wasSpeechActive = this.state.isSpeechActive;

    if (
      !this.state.isSpeechActive &&
      this.state.speechFrameCount >= SPEECH_CONFIRMATION_FRAMES
    ) {
      // Additional check: ensure we have enough consecutive speech frames
      const recentSpeechRatio =
        this.state.speechFrameHistory.slice(-10).filter(Boolean).length / 10;
      if (recentSpeechRatio >= 0.6) {
        // At least 60% of recent frames are speech
        this.state.isSpeechActive = true;
        this.state.lastSpeechTime = Date.now();
        console.log(
          `🎤 Speech detected (enhanced VAD) - energy: ${Math.round(
            this.state.smoothedEnergy
          )}, ratio: ${Math.round(recentSpeechRatio * 100)}%`
        );
      }
    } else if (
      this.state.isSpeechActive &&
      this.state.silenceFrameCount >= SILENCE_CONFIRMATION_FRAMES
    ) {
      this.state.isSpeechActive = false;
      this.state.lastSilenceTime = Date.now();
      console.log("🔇 Speech ended (enhanced VAD)");
    }

    return this.state.isSpeechActive;
  }

  /**
   * More conservative noise reduction
   */
  private applyNoiseReduction(buffer: Buffer): Buffer {
    if (!ENABLE_NOISE_REDUCTION) return buffer;

    const noiseThreshold = this.state.backgroundNoiseLevel * 1.5; // More conservative threshold
    const result = Buffer.alloc(buffer.length);

    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      const absSample = Math.abs(sample);

      let processedSample = sample;
      if (absSample < noiseThreshold) {
        // More aggressive noise reduction for low-level sounds
        const noiseFactor = Math.max(0.05, absSample / noiseThreshold); // Reduced from 0.1
        processedSample = Math.round(sample * noiseFactor);
      }

      result.writeInt16LE(processedSample, i);
    }

    return result;
  }

  /**
   * More conservative volume normalization
   */
  private normalizeVolume(buffer: Buffer): Buffer {
    if (!ENABLE_VOLUME_NORMALIZATION) return buffer;

    // Calculate current RMS
    let totalSquared = 0;
    const sampleCount = buffer.length / 2;

    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      totalSquared += sample * sample;
    }

    const currentRMS = Math.sqrt(totalSquared / sampleCount);

    if (currentRMS < 200) return buffer; // Higher threshold - too quiet, skip normalization

    // Calculate normalization factor - more conservative
    const targetGain = (TARGET_RMS / currentRMS) * NORMALIZATION_FACTOR;
    const gain = Math.min(targetGain, 2.0); // Reduced max gain from 3.0 to 2.0

    const result = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      const normalizedSample = Math.max(
        -32767,
        Math.min(32767, Math.round(sample * gain))
      );
      result.writeInt16LE(normalizedSample, i);
    }

    return result;
  }

  /**
   * Check if audio chunk contains sufficient speech content
   */
  private hasSignificantSpeechContent(sampleRate: number): boolean {
    const bufferDurationMs =
      (this.state.pendingAudioBuffer.length / 2 / sampleRate) * 1000;

    // Enhanced filtering during startup to prevent UI audio transcription
    if (this.isInStartupGracePeriod()) {
      // Much stricter requirements during startup
      if (bufferDurationMs < MIN_SPEECH_DURATION * 2) {
        // Double minimum duration
        return false;
      }

      const speechRatio =
        this.state.speechFrameHistory.filter(Boolean).length /
        this.state.speechFrameHistory.length;
      if (speechRatio < CONSECUTIVE_SPEECH_THRESHOLD * 1.5) {
        // 50% higher threshold
        return false;
      }

      const energyVariance = this.calculateEnergyVariance();
      if (energyVariance < ENERGY_VARIANCE_THRESHOLD * 2) {
        // Double energy variance requirement
        console.log(
          `🔇 Startup period: Insufficient energy variance (${
            Math.round(energyVariance * 100) / 100
          })`
        );
        return false;
      }

      // Additional check: audio must be significantly above background noise during startup
      if (this.state.smoothedEnergy < this.state.backgroundNoiseLevel * 5) {
        // 5x background noise
        console.log(`🔇 Startup period: Audio too close to background noise`);
        return false;
      }

      return true;
    }

    // Standard requirements after startup
    // 1. Must have minimum duration
    if (bufferDurationMs < MIN_SPEECH_DURATION) {
      return false;
    }

    // 2. Must have sufficient ratio of speech frames
    const speechRatio =
      this.state.speechFrameHistory.filter(Boolean).length /
      this.state.speechFrameHistory.length;
    if (speechRatio < CONSECUTIVE_SPEECH_THRESHOLD) {
      return false;
    }

    // 3. Energy variance check for the entire buffer
    const energyVariance = this.calculateEnergyVariance();
    if (energyVariance < ENERGY_VARIANCE_THRESHOLD) {
      console.log(
        `🔇 Insufficient energy variance (${
          Math.round(energyVariance * 100) / 100
        })`
      );
      return false;
    }

    return true;
  }

  /**
   * More conservative optimal chunk sizing
   */
  private getOptimalChunkSize(
    currentSpeaker: string,
    speakerChanged: boolean
  ): number {
    const now = Date.now();
    const timeSinceLastSpeech = now - this.state.lastSpeechTime;
    const timeSinceLastSpeakerChange = now - this.state.lastSpeakerChangeTime;

    if (speakerChanged) {
      this.state.lastSpeakerChangeTime = now;
      // Slightly longer chunks after speaker changes for better context
      return MIN_CHUNK_DURATION + SPEAKER_CHANGE_BUFFER;
    }

    // If actively speaking, use optimal chunk size
    if (this.state.isSpeechActive || timeSinceLastSpeech < 3000) {
      // Increased from 2000ms
      return OPTIMAL_CHUNK_DURATION;
    }

    // If in silence, use longer chunks to avoid processing noise
    return Math.max(MIN_CHUNK_DURATION * 1.2, OPTIMAL_CHUNK_DURATION * 0.8); // Increased minimum
  }
  /**
   * Enhanced statistics with speech quality metrics
   */
  getStats() {
    const speechRatio =
      this.state.speechFrameHistory.length > 0
        ? this.state.speechFrameHistory.filter(Boolean).length /
          this.state.speechFrameHistory.length
        : 0;
    const energyVariance = this.calculateEnergyVariance();

    return {
      smoothedEnergy: Math.round(this.state.smoothedEnergy),
      backgroundNoise: Math.round(this.state.backgroundNoiseLevel),
      isSpeechActive: this.state.isSpeechActive,
      speechFrames: this.state.speechFrameCount,
      silenceFrames: this.state.silenceFrameCount,
      bufferSize: this.state.pendingAudioBuffer.length,
      bufferDurationMs: Math.round(
        (this.state.pendingAudioBuffer.length / 2 / this.state.sampleRate) *
          1000
      ),
      speechRatio: Math.round(speechRatio * 100) / 100,
      energyVariance: Math.round(energyVariance * 100) / 100,
    };
  }

  /**
   * Reset processor state (useful for new meetings)
   */
  reset() {
    this.state = {
      smoothedEnergy: 0,
      speechFrameCount: 0,
      silenceFrameCount: 0,
      isSpeechActive: false,
      lastSpeechTime: Date.now(),
      lastSilenceTime: Date.now(),
      pendingAudioBuffer: Buffer.alloc(0),
      processedSamples: 0,
      backgroundNoiseLevel: NOISE_FLOOR,
      lastSpeakerChangeTime: 0,
      recentEnergyValues: [],
      speechFrameHistory: [],
      totalSpeechFrames: 0,
      totalFrames: 0,
      startupTime: Date.now(),
      hasJoinedMeeting: false,
      sampleRate: 16000, // Reset sample rate
    };
    console.log("🔄 Audio processor reset - startup grace period activated");
  }

  /**
   * Mark that the bot has successfully joined the meeting (not just UI interactions)
   */
  markMeetingJoined() {
    this.state.hasJoinedMeeting = true;
    console.log(
      "✅ Audio processor: Meeting joined, enabling full transcription"
    );
  }

  /**
   * Check if we're in the startup grace period where UI interactions might create false audio
   */
  private isInStartupGracePeriod(): boolean {
    const timeSinceStartup = Date.now() - this.state.startupTime;
    return (
      !this.state.hasJoinedMeeting || timeSinceStartup < STARTUP_GRACE_PERIOD_MS
    );
  }
}

export const audioProcessor = new EnhancedAudioProcessor();
export default audioProcessor;
