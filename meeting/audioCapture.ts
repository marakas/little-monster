import { sendRealtimeAudio } from "./realtimeClient.ts";
import state, { type Page, noteFallbackActivity } from "./state.ts";

export async function audioCapture(page: Page, platform: string) {
  try {
    const targetSampleRate = 16000;
    console.log(
      `🎵 Setting up browser-side audio capture for ${platform} (target sample rate: ${targetSampleRate} Hz)`
    );

    // ✅ send the audio to realtime api
    try {
      await page.exposeFunction(
        "handleRealAudioChunk",
        (audioChunk: number[], browserSampleRate: number) => {
          if (!state.hasJoined) return; // wait until in-room
          noteFallbackActivity(); // mark activity
          if (state.audioMux.active !== "fallback") return; // only if fallback owns the lane

          const uint8 = new Uint8Array(audioChunk);
          // ✅ tell the sender the true rate so it resamples 48k -> 16k
          sendRealtimeAudio(uint8.buffer, browserSampleRate);

          console.log(
            `✅ handleRealAudioChunk: Sent ${uint8.byteLength} bytes to Realtime @ ${browserSampleRate} Hz`
          );
        }
      );
    } catch (exposeError) {
      console.log(
        "ℹ️ handleRealAudioChunk already exposed, using existing function"
      );
    }

    // ✅ **Execute Node-Side Audio Capture**
    const audioResult = await Promise.race([
      page.evaluate((targetSampleRate) => {
        return new Promise((resolve) => {
          const diagnostics: string[] = [];
          diagnostics.push("🔥 FALLBACK: Browser-side audio capture started");

          let audioSetupSuccess = false;
          let audioChunkCount = 0;

          try {
            const audioContext = new AudioContext({ sampleRate: 48000 });
            diagnostics.push(
              `🔊 Fallback: AudioContext created with sample rate: ${audioContext.sampleRate} Hz (target: ${targetSampleRate} Hz)`
            );

            // Try to find audio/video elements first
            const audioElements = document.querySelectorAll("audio, video");
            diagnostics.push(
              `📊 Fallback: Found ${audioElements.length} audio/video elements`
            );

            if (audioElements.length > 0) {
              audioElements.forEach((element, index) => {
                try {
                  let source:
                    | MediaElementAudioSourceNode
                    | MediaStreamAudioSourceNode
                    | null = null;

                  if ((element as any).srcObject) {
                    source = audioContext.createMediaStreamSource(
                      (element as any).srcObject
                    );
                    diagnostics.push(
                      `✅ Fallback: Created MediaStream source for element ${index}`
                    );
                  } else if ((element as any).src) {
                    source = audioContext.createMediaElementSource(
                      element as HTMLMediaElement
                    );
                    diagnostics.push(
                      `✅ Fallback: Created MediaElement source for element ${index}`
                    );
                  }

                  if (source) {
                    const processor = audioContext.createScriptProcessor(
                      4096,
                      2,
                      2
                    );
                    const gainNode = audioContext.createGain();
                    gainNode.gain.value = 2.0;

                    processor.onaudioprocess = (event) => {
                      const inputData = event.inputBuffer.getChannelData(0);
                      let sum = 0;
                      for (let i = 0; i < inputData.length; i++) {
                        sum += inputData[i] * inputData[i];
                      }
                      const rms = Math.sqrt(sum / inputData.length);
                      const audioLevel = rms * 100;

                      if (audioLevel > 0.005) {
                        const int16Array = new Int16Array(inputData.length);
                        for (let i = 0; i < inputData.length; i++) {
                          int16Array[i] = Math.max(
                            -32768,
                            Math.min(32767, inputData[i] * 32768)
                          );
                        }

                        if ((window as any).handleRealAudioChunk) {
                          console.log("send audio from AudioCapture");
                          (window as any).handleRealAudioChunk(
                            Array.from(new Uint8Array(int16Array.buffer)),
                            audioContext.sampleRate
                          );
                        }

                        audioChunkCount++;
                        if (audioChunkCount === 1) {
                          console.log(
                            `🎉 Fallback: First audio detected! Level: ${audioLevel.toFixed(
                              4
                            )}`
                          );
                          audioSetupSuccess = true;
                        }
                      }
                    };

                    source.connect(gainNode);
                    gainNode.connect(processor);
                    processor.connect(audioContext.destination);

                    diagnostics.push(
                      `✅ Fallback: Audio pipeline connected for element ${index}`
                    );
                  }
                } catch (elementError) {
                  diagnostics.push(
                    `❌ Fallback: Error with element ${index}: ${elementError}`
                  );
                }
              });
            } else {
              diagnostics.push("⚠️ Fallback: No audio elements found");
            }
          } catch (setupError) {
            diagnostics.push(`❌ Fallback: Audio setup error: ${setupError}`);
          }

          // Return result after short delay
          setTimeout(() => {
            resolve({
              success: audioSetupSuccess,
              diagnostics: diagnostics,
              audioChunkCount: audioChunkCount,
            });
          }, 3000);
        });
      }, targetSampleRate),
      // 10 second timeout
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Fallback audio setup timeout")),
          10000
        )
      ),
    ]);

    console.log(
      "✅ Fallback: Browser-side audio capture setup completed:",
      audioResult
    );

    if (audioResult && typeof audioResult === "object") {
      const result = audioResult as any;
      if (result.diagnostics && Array.isArray(result.diagnostics)) {
        result.diagnostics.forEach((diagnostic: string) => {
          console.log(`🔍 Fallback: ${diagnostic}`);
        });
      }
      console.log(
        `📊 Fallback: Setup result - Success: ${result.success}, Chunks: ${result.audioChunkCount}`
      );
    }
  } catch (error) {
    console.log("❌ Fallback: Browser-side audio capture setup failed:", error);
    console.log("⚠️ Fallback: Continuing without real-time audio capture");
  }
}
