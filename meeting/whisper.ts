import assert from 'node:assert'
import { appendFile, writeFile } from 'node:fs/promises'
import fs from 'node:fs'

import axios from 'axios'

import {
  BOT_ID,
  MIN_AUDIO_BYTES,
  OPENAI_API_KEY,
  OPENAI_WHISPER_API,
  OPENAI_WHISPER_MODEL,
  RETRY_FAILED_TRANSCRIPTIONS,
  MAX_TRANSCRIPTION_RETRIES,
  CONFIDENCE_THRESHOLD,
  ENABLE_UI_AUDIO_FILTERING,
  ENABLE_FULL_AUDIO_ACCUMULATION,
} from './constants.ts'
import state from './state.ts'

// Helper functions to create a proper WAV file from audio chunks:
function createWavBuffer(dataBuffer: Buffer, sampleRate: number = 16000, channels: number = 1) {
  const header = Buffer.alloc(44)
  const dataLength = dataBuffer.length
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM format
  header.writeUInt16LE(channels, 22) // Channels
  header.writeUInt32LE(sampleRate, 24) // Sample rate
  header.writeUInt32LE((sampleRate * channels * 16) / 8, 28) // Byte rate
  header.writeUInt16LE((channels * 16) / 8, 32) // Block align
  header.writeUInt16LE(16, 34) // Bits per sample
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)
  return Buffer.concat([header, dataBuffer])
}

function prepareWavChunk(buffer_: Buffer, sampleRate: number = 16000) {
  let buffer = buffer_
  // If buffer already includes a header, strip it
  if (buffer.length > 44 && buffer.slice(0, 4).toString() === 'RIFF') {
    buffer = buffer.slice(44)
  }
  return createWavBuffer(buffer, sampleRate, 1)
}

// ✅ Enhanced transcription function with retry logic and better error handling  
export async function sendToWhisper(audioData: Buffer, retryCount: number = 0, isFromChunking: boolean = false, sampleRate: number = 16000): Promise<void> {
  // ✅ Allow the last batch to be processed if we're finalizing OR if it's from final audio chunking
  if (!state.isBotRunning && !state.isFinalizing && !isFromChunking) {
    console.log('🔇 Bot is stopped. Ignoring audio batch.')
    return
  }

  // ✅ Prevent new transcriptions if finalizing, but allow the last one
  if (state.isFinalizing && state.pendingTranscriptions > 0) {
    console.log('⚠️ Finalizing: Ignoring new transcription requests.')
    return
  }

  if (audioData.length === 0) {
    console.log('⚠️ Skipping empty audio batch.')
    return
  }

  // Enhanced minimum audio check with better threshold
  if (audioData.length < MIN_AUDIO_BYTES) {
    console.log(`⚠️ Chunk too short (${audioData.length} bytes), discarding.`)
    return
  }

  // ✅ Increase pending transcription counter
  state.pendingTranscriptions = (state.pendingTranscriptions || 0) + 1

  try {
    const audioDurationMs = (audioData.length / 2 / sampleRate) * 1000 // Use dynamic sample rate for duration calculation
    console.log(
      `📝 Transcribing batch (${audioData.length} bytes, ${Math.round(audioDurationMs)}ms, ${sampleRate} Hz) for ${state.currentSpeaker}...`,
    )
    
    const wavBuffer = prepareWavChunk(audioData, sampleRate) // Pass sample rate to prepareWavChunk

    const formData = new FormData()
    formData.append(
      'file',
      new Blob([wavBuffer]),
      `audio_batch_${Date.now()}.wav`,
    )

    formData.append('model', OPENAI_WHISPER_MODEL)
    
    // ✅ Enhanced Whisper API parameters for better accuracy
    formData.append('response_format', 'verbose_json') // Get confidence scores
    formData.append('temperature', '0') // More deterministic results
    formData.append('language', 'en') // Specify language for better performance
    
    const startTime = Date.now()
    const response = await axios.post<{ 
      text: string; 
      segments?: Array<{
        text: string;
        start: number;
        end: number;
        avg_logprob?: number;
        confidence?: number;
      }>;
      language?: string;
    }>(
      OPENAI_WHISPER_API,
      formData,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          contentType: 'audio/wav',
          filename: `audio_batch_${Date.now()}.wav`,
        },
        timeout: 30000, // 30 second timeout
      },
    )

    let transcription = response.data.text.trim()
    
    // ✅ Calculate confidence score if available
    let confidence = 1.0
    if (response.data.segments && response.data.segments.length > 0) {
      const avgLogProbs = response.data.segments
        .map(s => s.avg_logprob || 0)
        .filter(p => p !== 0)
      
      if (avgLogProbs.length > 0) {
        const avgLogProb = avgLogProbs.reduce((a, b) => a + b, 0) / avgLogProbs.length
        confidence = Math.exp(avgLogProb) // Convert log probability to confidence
      }
    }
    
    // ✅ Quality check - retry if confidence is too low, but after max retries, save anyway
    if (confidence < CONFIDENCE_THRESHOLD && RETRY_FAILED_TRANSCRIPTIONS && retryCount < MAX_TRANSCRIPTION_RETRIES) {
      console.log(`🔄 Low confidence (${Math.round(confidence * 100)}%), retrying transcription... (attempt ${retryCount + 1}/${MAX_TRANSCRIPTION_RETRIES})`)
      state.pendingTranscriptions -= 1 // Don't double count
      return sendToWhisper(audioData, retryCount + 1, isFromChunking, sampleRate)
    }
    
    // ✅ If we've exhausted retries but still have low confidence, save with warning
    if (confidence < CONFIDENCE_THRESHOLD && transcription.length > 0) {
      console.log(`⚠️ Saving low confidence transcription after ${retryCount} retries: ${Math.round(confidence * 100)}%`)
    }
    
    // ✅ Enhanced logging and saving logic
    console.log(`🎯 Whisper response: text="${transcription}", confidence=${Math.round(confidence * 100)}%`)
    
    if (transcription.length > 0) {
      const rawTranscription = transcription
      
      // 🛡️ Filter out likely UI text/sounds that shouldn't be transcribed
      if (ENABLE_UI_AUDIO_FILTERING) {
        const isLikelyUIText = (
          // Very short phrases that are common UI text
          (transcription.length <= 10 && /^(you|thank you|more|options|yes|no|ok|hi)$/i.test(transcription.trim())) ||
          // Common UI button/tooltip text patterns
          /^(more options|dismiss|close|mute|unmute|camera|video|chat|leave|join|settings?)$/i.test(transcription.trim()) ||
          // Single words that are likely UI elements
          (transcription.length <= 4 && /^(you|ok|hi|no|yes)$/i.test(transcription.trim())) ||
          // Repeated single words (often UI feedback)
          /^(.+)\s+\1$/i.test(transcription.trim())
        )
        
        if (isLikelyUIText) {
          console.log(`🛡️ Filtered out likely UI text: "${rawTranscription}"`)
          return // Skip saving this transcription
        }
      }
      
      const timestamp = new Date().toISOString()
      
      // ✅ Clean format without confidence percentage
      transcription = `[${timestamp}] ${state.currentSpeaker}: ${transcription}`

      // 🎛️ Smart transcription saving based on mode toggle
      if (ENABLE_FULL_AUDIO_ACCUMULATION && state.isFullAccumulationMode) {
        // 🤖 AI-Enhanced Mode: Store transcriptions separately for later merging
        if (isFromChunking) {
          // Chunks from final audio processing go to full audio transcriptions
          state.fullAudioTranscriptions.push(transcription)
          
          // Also save to separate full audio transcription file
          if (state.fullTranscriptionLogPath) {
            await appendFile(state.fullTranscriptionLogPath, `${transcription}\n`)
            console.log(`📝 Full audio chunk transcription saved to: ${state.fullTranscriptionLogPath}`)
          }
        } else {
          // Real-time chunks go to chunked transcriptions
          state.chunkedTranscriptions.push(transcription)
          
          // Also save to separate chunked transcription file
          assert(state.chunkedTranscriptionLogPath)
          await appendFile(state.chunkedTranscriptionLogPath, `${transcription}\n`)
          console.log(`📝 Chunked transcription saved to: ${state.chunkedTranscriptionLogPath}`)
        }
      } else {
        // 📝 Simple Mode: Save directly to main log (immediate transcription)
        state.transcriptionLog.push(transcription)
        assert(state.transcriptionLogPath)
        await appendFile(state.transcriptionLogPath, `${transcription}\n`)
        console.log(`💾 Transcription saved to: ${state.transcriptionLogPath}`)
      }
    } else {
      // ✅ Retry if transcription is empty and we haven't exceeded retry limit
      if (RETRY_FAILED_TRANSCRIPTIONS && retryCount < MAX_TRANSCRIPTION_RETRIES && audioDurationMs > 1000) {
        console.log(`🔄 Empty transcription for significant audio (${Math.round(audioDurationMs)}ms), retrying... (attempt ${retryCount + 1}/${MAX_TRANSCRIPTION_RETRIES})`)
        state.pendingTranscriptions -= 1 // Don't double count
        return sendToWhisper(audioData, retryCount + 1, isFromChunking, sampleRate)
      }
    }
  } catch (error) {
    const errorMessage = axios.isAxiosError(error)
      ? error.response?.data || error.message
      : error instanceof Error
        ? error.message
        : error

    console.error(`❌ Error sending batch to Whisper (attempt ${retryCount + 1}):`, errorMessage)
    
    // ✅ Retry on certain types of errors
    if (RETRY_FAILED_TRANSCRIPTIONS && retryCount < MAX_TRANSCRIPTION_RETRIES) {
      const shouldRetry = axios.isAxiosError(error) && (
        error.code === 'ECONNRESET' ||
        error.response?.status === 429 || // Rate limited
        error.response?.status === 500 || // Server error
        error.response?.status === 502 || // Bad gateway
        error.response?.status === 503    // Service unavailable
      )
      
      if (shouldRetry) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000) // Exponential backoff, max 10s
        console.log(`🔄 Retrying transcription in ${delay}ms... (attempt ${retryCount + 1}/${MAX_TRANSCRIPTION_RETRIES})`)
        
        state.pendingTranscriptions -= 1 // Don't double count
        setTimeout(() => {
          sendToWhisper(audioData, retryCount + 1, isFromChunking, sampleRate)
        }, delay)
        return
      }
    }
  } finally {
    // ✅ Decrease pending transcription counter
    state.pendingTranscriptions -= 1
  }
}

// 🧪 Experimental: Process entire accumulated audio at end of meeting
export async function processFullAccumulatedAudio(): Promise<void> {
  if (!ENABLE_FULL_AUDIO_ACCUMULATION || !state.isFullAccumulationMode) {
    console.log('📝 Full audio accumulation mode not enabled')
    return
  }

  if (state.fullAudioAccumulator.length === 0) {
    console.log('⚠️ No audio accumulated for full processing')
    return
  }

  const totalDurationMs = (state.fullAudioAccumulator.length / 2 / 16000) * 1000 // Use original hardcoded 16000 Hz for duration calculation
  const audioSizeMB = Math.round(state.fullAudioAccumulator.length / 1024 / 1024)
  console.log(`🎙️ Processing entire accumulated audio: ${state.fullAudioAccumulator.length} bytes (${Math.round(totalDurationMs / 1000)}s, ${audioSizeMB}MB)`)

  // ✅ Memory safety: Check if audio is too large for safe processing
  const maxFileSize = 25 * 1024 * 1024 // 25MB Whisper API limit
  const memorySafetyLimit = 50 * 1024 * 1024 // 50MB memory safety limit
  
  // Restored to original behavior
  console.log(`🎵 Using 16000 Hz sample rate for full audio processing`)

  // If the accumulated audio is very large, use chunking immediately to avoid OOM
  if (state.fullAudioAccumulator.length > memorySafetyLimit) {
    console.log(`🚨 Audio file very large (${audioSizeMB}MB), using chunked processing to prevent memory issues...`)
    await processLargeAudioInChunks(state.fullAudioAccumulator, 16000)
    return
  }
  
  // Check if adding WAV header would exceed Whisper limit
  const estimatedWavSize = state.fullAudioAccumulator.length + 44 // Add WAV header size
  if (estimatedWavSize > maxFileSize) {
    console.log(`⚠️ Audio too large for single Whisper request (estimated ${Math.round(estimatedWavSize / 1024 / 1024)}MB), splitting into chunks...`)
    await processLargeAudioInChunks(state.fullAudioAccumulator, 16000)
    return
  }
  
  // Safe to prepare WAV buffer for direct processing
  const wavBuffer = prepareWavChunk(state.fullAudioAccumulator) // Restored to original API

  try {
    state.pendingTranscriptions = (state.pendingTranscriptions || 0) + 1

    const formData = new FormData()
    formData.append(
      'file',
      new Blob([wavBuffer]),
      `full_audio_${Date.now()}.wav`,
    )

    formData.append('model', OPENAI_WHISPER_MODEL)
    formData.append('response_format', 'verbose_json')
    formData.append('temperature', '0')
    formData.append('language', 'en')
    // Enable word-level timestamps for better analysis
    formData.append('timestamp_granularities', '["word", "segment"]')

    console.log('📡 Sending entire audio to Whisper for processing...')
    const startTime = Date.now()
    
    const response = await axios.post<{ 
      text: string; 
      segments?: Array<{
        text: string;
        start: number;
        end: number;
        avg_logprob?: number;
        confidence?: number;
      }>;
      words?: Array<{
        word: string;
        start: number;
        end: number;
        confidence?: number;
      }>;
      language?: string;
    }>(
      OPENAI_WHISPER_API,
      formData,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          contentType: 'audio/wav',
          filename: `full_audio_${Date.now()}.wav`,
        },
        timeout: 120000, // 2 minute timeout for large files
      },
    )

    const processingTime = Date.now() - startTime
    console.log(`🎯 Full audio transcription completed in ${Math.round(processingTime / 1000)}s`)

    const transcription = response.data.text.trim()
    
    if (transcription.length > 0) {
      const speakers = Array.from(state.meetingSpeakers)
      console.log(`📝 Full transcription processed: ${transcription.length} characters`)
      console.log(`📊 Processing time: ${Math.round(processingTime / 1000)}s, Duration: ${Math.round(totalDurationMs / 1000)}s`)
      console.log(`🎤 Participants: ${speakers.join(', ')}`)
      
      // Note: Full audio transcriptions are saved to separate file, not the main log
      
      // Process segments with speaker attribution
      if (response.data.segments && response.data.segments.length > 0) {
        console.log(`🔄 Mapping ${response.data.segments.length} segments to ${state.speakerHistory.length} speaker history entries`)
        
        // Log speaker history for debugging
        console.log('🎤 Speaker history:')
        state.speakerHistory.forEach((entry, index) => {
          console.log(`  ${index}: ${Math.round(entry.audioOffsetMs / 1000)}s - ${entry.speaker}`)
        })
        
        for (const segment of response.data.segments) {
          const segmentText = segment.text.trim()
          if (segmentText.length === 0) continue
          
          // Map segment timestamp to speaker based on audio-relative timing data
          const segmentStartMs = segment.start * 1000 // Convert to milliseconds
          const speaker = mapAudioTimestampToSpeaker(segmentStartMs, state.speakerHistory)
          
          console.log(`🎯 Segment ${Math.round(segment.start)}s-${Math.round(segment.end)}s: "${segmentText}" → ${speaker}`)
          
          const timestamp = new Date().toISOString()
          const fullTranscription = `[${timestamp}] ${speaker}: ${segmentText}`
          
          // 🤖 Store full audio transcription separately for AI merging
          state.fullAudioTranscriptions.push(fullTranscription)
          
          // Also save to separate full audio transcription file
          if (state.fullTranscriptionLogPath) {
            await appendFile(state.fullTranscriptionLogPath, `${fullTranscription}\n`)
          }
        }
        
        // 🤖 Trigger AI-enhanced transcription merging
        console.log(`🤖 Starting AI-enhanced transcription merging...`)
        await mergeTranscriptionsWithAI()
      } else {
        // Fallback: save as single block if no segments
        const timestamp = new Date().toISOString()
        const speakerAttribution = speakers.length === 1 ? speakers[0] : `Multiple Speakers (${speakers.join(', ')})`
        const fullTranscription = `[${timestamp}] ${speakerAttribution}: ${transcription}`
        
        state.transcriptionLog.push(fullTranscription)
        
        // Note: Fallback transcription is saved to separate full audio file, not main log
        
        console.log(`💾 Full audio transcription saved as single block`)
      }
    } else {
      console.log('⚠️ Empty transcription from full audio processing')
    }

  } catch (error) {
    const errorMessage = axios.isAxiosError(error)
      ? error.response?.data || error.message
      : error instanceof Error
        ? error.message
        : error

    console.error('❌ Error processing full accumulated audio:', errorMessage)
  } finally {
    state.pendingTranscriptions -= 1
    
    // Clear the accumulator after processing to free memory immediately
    console.log(`🧹 Clearing ${Math.round(state.fullAudioAccumulator.length / 1024 / 1024)}MB audio accumulator`)
    state.fullAudioAccumulator = Buffer.alloc(0)
    state.isFullAccumulationMode = false
    
    // Clear other accumulated data
    state.chunkedTranscriptions = []
    state.fullAudioTranscriptions = []
    state.speakerHistory = []
    state.meetingSpeakers.clear()
    
    // Suggest garbage collection after large operation
    if (global.gc) {
      console.log('🗑️ Triggering garbage collection after full audio processing')
      global.gc()
    }
  }
}

// Helper function to map audio timestamp to speaker based on speaker history
function mapAudioTimestampToSpeaker(
  audioTimestampMs: number, 
  speakerHistory: Array<{ speaker: string; audioOffsetMs: number }>
): string {
  if (speakerHistory.length === 0) {
    return 'Unknown Speaker'
  }
  
  // Find the most recent speaker entry before or at this timestamp
  let bestSpeaker = speakerHistory[0].speaker
  let bestOffset = speakerHistory[0].audioOffsetMs
  
  for (const entry of speakerHistory) {
    // If this entry is before or at the target timestamp and is more recent than our current best
    if (entry.audioOffsetMs <= audioTimestampMs && entry.audioOffsetMs >= bestOffset) {
      bestSpeaker = entry.speaker
      bestOffset = entry.audioOffsetMs
    }
  }
  
  return bestSpeaker
}

// Helper function to process large audio files in manageable chunks
async function processLargeAudioInChunks(fullAudio: Buffer, sampleRate: number = 16000): Promise<void> {
  // Use smaller chunks to reduce memory pressure
  const chunkSize = 10 * 1024 * 1024 // 10MB chunks instead of 20MB
  const overlapSize = 256 * 1024 // 256KB overlap instead of 1MB
  
  let offset = 0
  let chunkIndex = 0
  const totalChunks = Math.ceil(fullAudio.length / chunkSize)
  
  console.log(`🎙️ Processing large audio file in ${totalChunks} chunks (${Math.round(fullAudio.length / 1024 / 1024)}MB total)`)
  
  while (offset < fullAudio.length) {
    const endOffset = Math.min(offset + chunkSize, fullAudio.length)
    
    // Create chunk buffer
    const chunk = fullAudio.slice(offset, endOffset)
    
    console.log(`📝 Processing chunk ${chunkIndex + 1}/${totalChunks} (${Math.round(chunk.length / 1024 / 1024)}MB)`)
    
    try {
      // Process this chunk with flag indicating it's from chunking
      await sendToWhisper(chunk, 0, true, sampleRate) // Pass sample rate parameter
      
      // 🧠 Force garbage collection opportunity after each chunk
      // Small delay to allow garbage collection
      if (chunkIndex % 3 === 0) { // Every 3rd chunk
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Suggest garbage collection if available (Node.js with --expose-gc flag)
        if (global.gc) {
          console.log(`🗑️ Triggering garbage collection after chunk ${chunkIndex + 1}`)
          global.gc()
        }
      }
      
    } catch (error) {
      console.error(`❌ Error processing chunk ${chunkIndex + 1}:`, error)
      // Continue with next chunk rather than failing entire operation
    }
    
    chunkIndex++
    
    // Move to next chunk with overlap, but prevent infinite loop
    const nextOffset = endOffset - overlapSize
    if (nextOffset <= offset || chunkIndex >= totalChunks) {
      // If we're not making progress or reached expected chunk count, stop
      break
    }
    offset = nextOffset
  }
  
  console.log(`✅ Completed processing ${chunkIndex} chunks from large audio file`)
  
  // 🤖 Trigger AI-enhanced transcription merging after chunked processing
  if (state.fullAudioTranscriptions.length > 0) {
    console.log(`🤖 Starting AI-enhanced transcription merging after chunked processing...`)
    await mergeTranscriptionsWithAI()
  } else {
    console.log('⚠️ No full audio transcriptions found for AI merging after chunked processing')
  }
  
  // Final cleanup suggestion
  if (global.gc) {
    console.log('🗑️ Final garbage collection after large audio processing')
    global.gc()
  }
}

// 🤖 AI-Enhanced Transcription Merging
async function mergeTranscriptionsWithAI(): Promise<void> {
  try {
    // Check if we have any transcriptions to work with
    const hasChunkedTranscriptions = state.chunkedTranscriptions.length > 0
    const hasFullAudioTranscriptions = state.fullAudioTranscriptions.length > 0
    
    if (!hasChunkedTranscriptions && !hasFullAudioTranscriptions) {
      console.log('⚠️ No transcriptions available for merging - skipping AI enhancement')
      return
    }
    
    // If we only have one type of transcription, use it as the final transcription
    if (!hasChunkedTranscriptions && hasFullAudioTranscriptions) {
      console.log('📝 Only full audio transcriptions available - using as final transcription')
      const finalTranscription = state.fullAudioTranscriptions.join('\n')
      
      if (state.transcriptionLogPath) {
        await appendFile(state.transcriptionLogPath, `${finalTranscription}\n`)
        console.log(`💾 Full audio transcription saved as final: ${state.transcriptionLogPath}`)
      }
      return
    }
    
    if (hasChunkedTranscriptions && !hasFullAudioTranscriptions) {
      console.log('📝 Only chunked transcriptions available - using as final transcription')
      const finalTranscription = state.chunkedTranscriptions.join('\n')
      
      if (state.transcriptionLogPath) {
        await appendFile(state.transcriptionLogPath, `${finalTranscription}\n`)
        console.log(`💾 Chunked transcription saved as final: ${state.transcriptionLogPath}`)
      }
      return
    }

    console.log(`🤖 Merging ${state.chunkedTranscriptions.length} chunked + ${state.fullAudioTranscriptions.length} full audio transcriptions`)

    const speakers = Array.from(state.meetingSpeakers).join(', ')
    
    // Prepare prompt for AI merging
    const mergePrompt = `You are an expert transcription editor. You have two transcriptions of the same meeting from different processing methods:

**METHOD 1 - Real-time Chunked Transcription:**
${state.chunkedTranscriptions.join('\n')}

**METHOD 2 - Full Audio Context Transcription:**
${state.fullAudioTranscriptions.join('\n')}

**Meeting Participants:** ${speakers}

Please create a single, highly accurate, final transcription by:
1. Comparing both transcriptions carefully
2. Choosing the most accurate words and phrases from each
3. Ensuring proper speaker attribution
4. Maintaining chronological order
5. Fixing any obvious errors or fragments
6. Creating natural, coherent sentences

Keep the same timestamp format: [ISO_TIMESTAMP] Speaker: Content

Provide ONLY the final merged transcription, no explanations or commentary.`

    // Check if the combined transcription is too large for AI processing
    const combinedLength = mergePrompt.length
    console.log(`📊 AI merge request size: ${Math.round(combinedLength / 1024)}KB`)
    
    if (combinedLength > 100000) { // If larger than ~100KB
      console.log('⚠️ Transcription too large for AI merging, using full audio transcription as fallback')
      
      // Fallback: Use full audio transcription when too large for AI
      const fallbackTranscription = state.fullAudioTranscriptions.join('\n')
      
      if (state.transcriptionLogPath) {
        await appendFile(state.transcriptionLogPath, `${fallbackTranscription}\n`)
        console.log(`💾 Full audio transcription saved as fallback: ${state.transcriptionLogPath}`)
      }
      return
    }

    // Send to OpenAI for merging with increased timeout
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini', // Fast and cost-effective for this task
        messages: [
          {
            role: 'system',
            content: 'You are an expert transcription editor who creates accurate, final transcriptions by merging and improving multiple source transcriptions.'
          },
          {
            role: 'user',
            content: mergePrompt
          }
        ],
        temperature: 0.1, // Low temperature for consistency
        max_tokens: 8000 // Increased from 4000 to handle larger outputs
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 180000 // Increased to 3 minutes (180 seconds)
      }
    )

    const mergedTranscription = response.data.choices[0].message.content.trim()
    
    if (mergedTranscription.length > 0) {
      // Save only the clean AI-enhanced final transcription to the main log file
      if (state.transcriptionLogPath) {
        await appendFile(state.transcriptionLogPath, `${mergedTranscription}\n`)
      }
      
      console.log(`🎉 AI-enhanced transcription completed successfully!`)
      console.log(`📝 Merged ${state.chunkedTranscriptions.length + state.fullAudioTranscriptions.length} total segments`)
      console.log(`💾 AI-Enhanced Final Transcription: ${state.transcriptionLogPath}`)
      console.log(`💾 Real-time Chunked Transcription: ${state.chunkedTranscriptionLogPath}`)
      console.log(`💾 Full Audio Transcription: ${state.fullTranscriptionLogPath}`)
    } else {
      console.log('⚠️ Empty response from AI merging')
    }

  } catch (error) {
    console.error('❌ Error in AI transcription merging:', error)
    
    // Enhanced fallback: Use full audio transcription when AI fails
    console.log('🔄 AI merging failed, using full audio transcription as fallback...')
    
    const errorFallbackTranscription = state.fullAudioTranscriptions.join('\n')
    
    // Save the fallback transcription to the main file
    if (state.transcriptionLogPath) {
      try {
        await appendFile(state.transcriptionLogPath, `${errorFallbackTranscription}\n`)
        console.log(`💾 Full audio transcription saved as emergency fallback: ${state.transcriptionLogPath}`)
      } catch (fileError) {
        console.error('❌ Failed to save emergency fallback transcription:', fileError)
      }
    }
    
    console.log(`💾 Source transcriptions also available separately:`)
    console.log(`💾 Real-time Chunked Transcription: ${state.chunkedTranscriptionLogPath}`)
    console.log(`💾 Full Audio Transcription: ${state.fullTranscriptionLogPath}`)
  }
}

// 🧹 Simple LLM cleanup for transcription hallucinations and repetitions
export async function cleanupTranscriptionHallucinations(): Promise<void> {
  if (state.transcriptionLog.length === 0) {
    console.log('⚠️ No transcriptions to clean up')
    return
  }

  try {
    console.log(`🧹 Cleaning up transcription hallucinations (${state.transcriptionLog.length} entries)...`)
    
    const rawTranscription = state.transcriptionLog.join('\n')
    
    // Simple cleanup prompt focused on common issues
    const cleanupPrompt = `Please clean up this meeting transcription by fixing common speech-to-text issues:

1. Remove obvious repetitions (like "hello hello hello" → "hello")
2. Fix stuttering text (like "I I I think" → "I think") 
3. Remove meaningless filler repetitions (like "bye bye bye bye" → "bye")
4. Keep natural speech patterns (don't over-correct)
5. Maintain original timestamps and speaker names exactly
6. Only fix obvious errors, don't rewrite content

Here's the transcription to clean:

${rawTranscription}

Please return ONLY the cleaned transcription with the same format.`

    // Check if transcription is too large for processing
    if (cleanupPrompt.length > 80000) { // ~80KB limit
      console.log('⚠️ Transcription too large for cleanup, skipping LLM cleaning')
      return
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini', // Fast and cost-effective
        messages: [
          {
            role: 'system',
            content: 'You are a transcription cleanup assistant. Fix only obvious repetitions and hallucinations while preserving the original meaning and format.'
          },
          {
            role: 'user',
            content: cleanupPrompt
          }
        ],
        temperature: 0.1, // Low temperature for consistency
        max_tokens: 6000
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 1 minute timeout
      }
    )

    const cleanedTranscription = response.data.choices[0].message.content.trim()
    
    if (cleanedTranscription.length > 0 && state.transcriptionLogPath) {
      // Overwrite the existing transcription file with cleaned version
      await writeFile(state.transcriptionLogPath, cleanedTranscription)
      console.log(`✨ Cleaned transcription saved to: ${state.transcriptionLogPath}`)
      console.log(`🧹 Original transcription has been replaced with cleaned version`)
    } else {
      console.log('⚠️ Empty response from transcription cleanup')
    }

  } catch (error) {
    console.error('❌ Error cleaning up transcription:', error)
    console.log('📝 Original transcription remains unchanged at:', state.transcriptionLogPath)
  }
}


