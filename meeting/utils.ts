import assert from "node:assert";

import {
  BOT_ID,
  SILENCE_THRESHOLD,
  ENABLE_FULL_AUDIO_ACCUMULATION,
} from "./constants.ts";
import state, { type Page, setHasJoined } from "./state.ts";
import { stopMeetBot } from "./stop_meet_bot.ts";

let lastParticipantCheck = Date.now();
let previousSpeaker = "";

// ✅ **Meeting Platform Detection**
export type MeetingPlatform = "google-meet" | "teams" | "zoom" | "unknown";

// ✅ **Zoom URL Transformation**
export function transformZoomUrl(url: string): string {
  if (!url || typeof url !== "string") {
    return url;
  }

  // Check if it's a Zoom URL with regional subdomain pattern (e.g., us04web.zoom.us/j/)
  const zoomRegionalPattern = /^(@?https?:\/\/)(us\d+web\.zoom\.us\/j\/)/i;

  if (zoomRegionalPattern.test(url)) {
    // Replace regional subdomain pattern with standard zoom.us/wc/join/
    const transformedUrl = url.replace(
      zoomRegionalPattern,
      "$1zoom.us/wc/join/"
    );
    console.log(`🔄 Transformed Zoom URL: ${url} → ${transformedUrl}`);
    return transformedUrl;
  }

  return url;
}

export function detectMeetingPlatform(meetUrl: string): MeetingPlatform {
  // Guard clause: handle undefined, null, or empty meetUrl
  if (!meetUrl || typeof meetUrl !== "string") {
    console.error(
      `❌ Invalid meetUrl provided to detectMeetingPlatform: ${meetUrl}`
    );
    return "unknown";
  }

  const url = meetUrl.toLowerCase();

  // Google Meet URL patterns
  if (url.includes("meet.google.com") || url.includes("meet.google.co")) {
    return "google-meet";
  }

  // Microsoft Teams URL patterns
  if (
    url.includes("teams.microsoft.com") ||
    url.includes("teams.live.com") ||
    url.includes("teams.office.com") ||
    url.includes("teams.microsoft.us") ||
    url.includes("teams.gov.microsoft.us")
  ) {
    return "teams";
  }

  // Zoom URL patterns
  if (
    url.includes("zoom.us") ||
    url.includes("zoom.com") ||
    url.includes("zoom.") ||
    url.match(/us\d+web\.zoom\.us/) ||
    url.match(/\w+\.zoom\.us/) ||
    (url.includes("/j/") && (url.includes("zoom") || url.match(/\d{9,11}/)))
  ) {
    return "zoom";
  }

  return "unknown";
}

// ✅ **Enhanced Audio Batch Processing with Advanced Audio Processing** (with dynamic sample rate)
export function batchAudioChunk(chunk: Uint8Array, sampleRate: number = 16000) {
  if (state.isBotPaused) {
    //console.log(`⏸️ [${BOT_ID}] Ignoring audio chunk during pause.`)
    return; // Don't collect audio during pause
  }

  // ✅ **Store current sample rate in state for forced transcriptions**
  state.currentAudioSampleRate = sampleRate;

  // ✅ **Debug logging for audio chunk reception**
  if (Math.random() < 0.1) {
    // 10% chance to log when debugging
    console.log(
      `🎵 [${BOT_ID}] Received audio chunk: ${chunk.length} bytes, sample rate: ${sampleRate} Hz, speaker: ${state.currentSpeaker}`
    );
  }

  const audioBuffer = Buffer.from(chunk);
  const currentSpeaker =
    state.currentSpeaker === "Unknown"
      ? "User"
      : state.currentSpeaker || "User";
  const speakerChanged = currentSpeaker !== previousSpeaker;

  if (speakerChanged && previousSpeaker) {
    console.log(`🔄 Speaker changed: ${previousSpeaker} → ${currentSpeaker}`);
  }

  // Full Audio Accumulation Mode (alongside normal chunking)
  if (ENABLE_FULL_AUDIO_ACCUMULATION && state.isFullAccumulationMode) {
    const now = Date.now();

    // Update audio offset based on new audio chunk
    const chunkDurationMs = (audioBuffer.length / 2 / sampleRate) * 1000; // Convert bytes to ms using dynamic sample rate

    // 🚨 Memory safety check: Prevent accumulator from growing too large
    const memorySafetyLimit = 100 * 1024 * 1024; // 100MB safety limit
    const criticalMemoryLimit = 200 * 1024 * 1024; // 200MB critical limit

    if (state.fullAudioAccumulator.length > criticalMemoryLimit) {
      console.log(
        `🚨 CRITICAL: Audio accumulator exceeds ${Math.round(
          criticalMemoryLimit / 1024 / 1024
        )}MB, emergency reset to prevent OOM...`
      );
      // Emergency reset to prevent OOM - sacrifice accumulated audio to save the process
      const resetSizeMB = Math.round(
        state.fullAudioAccumulator.length / 1024 / 1024
      );
      state.fullAudioAccumulator = Buffer.alloc(0);
      state.currentAudioOffsetMs = 0;
      state.speakerHistory = [];

      // Force garbage collection if available
      if (global.gc) {
        console.log("🗑️ Emergency garbage collection triggered");
        global.gc();
      }

      console.log(
        `🚨 Emergency reset completed - ${resetSizeMB}MB buffer cleared`
      );
    } else if (state.fullAudioAccumulator.length > memorySafetyLimit) {
      // Warning but continue accumulating
      const currentSizeMB = Math.round(
        state.fullAudioAccumulator.length / 1024 / 1024
      );
      console.log(
        `⚠️ Audio accumulator size warning: ${currentSizeMB}MB (approaching limit)`
      );
    }

    // Accumulate all audio for end-of-meeting processing
    state.fullAudioAccumulator = Buffer.concat([
      state.fullAudioAccumulator,
      audioBuffer,
    ]);

    // Track speakers who participate in the meeting
    if (
      currentSpeaker &&
      currentSpeaker !== "Unknown" &&
      currentSpeaker !== "User"
    ) {
      state.meetingSpeakers.add(currentSpeaker);
    }

    // Record speaker at regular intervals (every 2 seconds) or on speaker changes
    const shouldRecordSpeaker =
      now - state.lastSpeakerUpdate > 2000 || // Every 2 seconds
      speakerChanged || // On speaker change
      state.speakerHistory.length === 0; // First recording

    if (shouldRecordSpeaker && currentSpeaker) {
      state.speakerHistory.push({
        speaker: currentSpeaker,
        audioOffsetMs: state.currentAudioOffsetMs,
      });
      state.lastSpeakerUpdate = now;

      if (speakerChanged) {
        console.log(
          `🎤 Speaker at ${Math.round(
            state.currentAudioOffsetMs / 1000
          )}s: ${currentSpeaker}`
        );
      }
    }

    // Update current audio position
    state.currentAudioOffsetMs += chunkDurationMs;

    // Periodic logging to show accumulation progress
    if (Math.random() < 0.001) {
      // ~0.1% chance to log stats
      const totalDurationMs = state.currentAudioOffsetMs;
      const totalSizeMB =
        Math.round((state.fullAudioAccumulator.length / 1024 / 1024) * 100) /
        100;
      const speakerList = Array.from(state.meetingSpeakers).join(", ");
      console.log(
        `🎙️ Audio accumulation: ${Math.round(
          totalDurationMs / 1000
        )}s (${totalSizeMB}MB) buffered | Speakers: ${speakerList}`
      );
    }
  }

  // Update previous speaker
  previousSpeaker = currentSpeaker;
}

// Helper delay function
export async function delay(ms = 500) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Update getActiveSpeaker to capture the blue outline .tC2Wod
export async function getActiveSpeakers(page: Page): Promise<string[]> {
  if (page.isClosed()) {
    console.log(`🛑 [${BOT_ID}] getActiveSpeakers: Page is closed.`);
    return [];
  }

  try {
    // Detect platform based on URL
    const currentUrl = page.url();
    const platform = detectMeetingPlatform(currentUrl);

    if (platform === "google-meet") {
      return await getActiveSpeakersGoogleMeet(page);
    } else if (platform === "teams") {
      return await getActiveSpeakersTeams(page);
    } else if (platform === "zoom") {
      return await getActiveSpeakersZoom(page);
    } else {
      console.log(
        `⚠️ [${BOT_ID}] Unknown platform for speaker detection: ${platform}`
      );
      return [];
    }
  } catch (error) {
    console.error(`❌ [${BOT_ID}] Error detecting active speakers:`, error);
    return [];
  }
}

// ✅ **Google Meet Speaker Detection**
async function getActiveSpeakersGoogleMeet(page: Page): Promise<string[]> {
  const result = await page.evaluate((BOT_ID) => {
    const detectedSpeakers = new Set<string>();

    // Select only `.tC2Wod` elements that are **active** (i.e., have `.kssMZb`)
    const activeElements = Array.from(
      document.querySelectorAll(".tC2Wod.kssMZb")
    );

    console.log(
      `[${BOT_ID}] Found ${activeElements.length} possible active speaker elements (.tC2Wod.kssMZb)`
    );

    // If no active elements found, let's try broader selectors
    if (activeElements.length === 0) {
      // Try finding elements with just .kssMZb (might indicate active state)
      const kssMZbElements = Array.from(document.querySelectorAll(".kssMZb"));

      kssMZbElements.forEach((elem, idx) => {
        const parentTile = elem.closest('div[jsname="E2KThb"]');
        if (parentTile) {
          console.log("Found parent tile for kssMZb element:", parentTile);
        }
      });

      // Also try looking for any elements that might indicate speaking
      const possibleSpeakingElements = Array.from(
        document.querySelectorAll('[class*="kssMZb"]')
      );
      console.log(
        `Found ${possibleSpeakingElements.length} elements containing kssMZb in class`
      );
    }

    activeElements.forEach((outlineElement, index) => {
      // **Ensure it's VISIBLE on screen**
      const rect = outlineElement.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0;

      console.log(`🔍 [${BOT_ID}] Checking speaker ${index + 1}:`, {
        isVisible,
        rect,
      });

      if (!isVisible) {
        console.log(`⚠️ [${BOT_ID}] Outline is not visible. Skipping.`);
        return;
      }

      // Move up the DOM to find the closest participant tile (div[jsname="E2KThb"])
      const parentTile = outlineElement.closest('div[jsname="E2KThb"]');
      if (!parentTile) {
        console.log(`⚠️ [${BOT_ID}] No parent tile found for this speaker.`);
        return;
      }

      console.log(`✅ [${BOT_ID}] Found parent participant tile:`, parentTile);

      // Extract the participant name from the tile with updated selectors
      // First try the primary name selectors (most reliable)
      const nameElem = parentTile.querySelector(
        "span.notranslate, .ne2Ple-oshW8e-V67aGc, [data-self-name], .KjwKEb, div[aria-label], .zP5qcb, .GvcuGe, .zWfAib, [data-tooltip], [title]"
      );

      let speakerName = "";

      if (nameElem) {
        speakerName =
          nameElem.textContent ||
          nameElem.getAttribute("aria-label") ||
          nameElem.getAttribute("data-tooltip") ||
          nameElem.getAttribute("title") ||
          "";
      }

      if (!speakerName) {
        // Secondary selectors if primary fails
        const secondaryElem = parentTile.querySelector(
          "div[data-self-name], .smuKUc"
        );
        if (secondaryElem) {
          speakerName =
            secondaryElem.textContent ||
            secondaryElem.getAttribute("data-self-name") ||
            "";
        }
      }

      if (!speakerName) {
        // Final fallback: look for any text content in the tile
        const textElements = Array.from(
          parentTile.querySelectorAll("div, span")
        );
        for (const elem of textElements) {
          if (
            elem.textContent &&
            elem.textContent.trim().length > 0 &&
            elem.textContent.trim().length < 50
          ) {
            speakerName = elem.textContent.trim();
            break;
          }
        }
      }

      if (speakerName) {
        // Clean up the name (remove "You" suffix, etc.)
        speakerName = speakerName.replace(/\s*\(You\)/i, "").trim();

        // Filter out UI text that isn't a real name
        const lower = speakerName.toLowerCase();
        const isValidName =
          speakerName &&
          speakerName !== "Design Bot" &&
          !lower.includes("gemini") &&
          !lower.includes("taking notes") &&
          !lower.includes("transcript") &&
          !lower.includes("captions") &&
          !lower.includes("recording") &&
          !lower.includes("camera") &&
          !lower.includes("microphone") &&
          !lower.includes("pin") &&
          !lower.includes("unpin") &&
          !lower.includes("more options") &&
          !lower.includes("turn on") &&
          !lower.includes("turn off") &&
          !lower.includes("settings") &&
          !lower.includes("menu") &&
          !lower.includes("share your screen") &&
          !lower.includes("not allowed") &&
          !lower.includes("error") &&
          !lower.includes("failed") &&
          !lower.includes("denied") &&
          !lower.includes("permission") &&
          speakerName.length < 50 &&
          speakerName.length > 1;

        if (isValidName) {
          detectedSpeakers.add(speakerName);
          console.log(`🗣️ [${BOT_ID}] Active Speaker Detected: ${speakerName}`);
        } else {
          console.log(
            `❌ [${BOT_ID}] Filtered out invalid speaker name: "${speakerName}" (length: ${speakerName.length}, lower: "${lower}")`
          );
        }
      } else {
        console.log(
          `❌ [${BOT_ID}] No name element found inside the participant tile.`
        );
      }
    });

    // If no active speakers found, try different approaches to find who's speaking
    if (detectedSpeakers.size === 0) {
      // Try approach 1: Look for any element with kssMZb class
      const kssMZbElements = Array.from(document.querySelectorAll(".kssMZb"));

      for (const kssMZbElement of kssMZbElements) {
        const parentTile = kssMZbElement.closest('div[jsname="E2KThb"]');
        if (parentTile) {
          const notranslateSpan = parentTile.querySelector("span.notranslate");
          if (notranslateSpan && notranslateSpan.textContent) {
            const name = notranslateSpan.textContent
              .trim()
              .replace(/\s*\(You\)/i, "")
              .trim();
            if (
              name &&
              name !== "Design Bot" &&
              name.length > 1 &&
              name.length < 50
            ) {
              detectedSpeakers.add(name);
              console.log(
                `🗣️ [${BOT_ID}] Active Speaker found via .kssMZb: ${name}`
              );
            }
          }
        }
      }
    }

    return Array.from(detectedSpeakers);
  }, BOT_ID);

  return result;
}

// ✅ **Microsoft Teams Speaker Detection**
async function getActiveSpeakersTeams(page: Page): Promise<string[]> {
  try {
    const result = await page.evaluate((BOT_ID) => {
      const detectedSpeakers = new Set<string>();

      // Helper function to check if text is a UI element (not a real name)
      function isUIElement(text: string): boolean {
        const lower = text.toLowerCase();
        const uiElements = [
          "raise",
          "react",
          "view",
          "mic",
          "mute",
          "unmute",
          "camera",
          "video",
          "share",
          "screen",
          "leave",
          "end",
          "settings",
          "more",
          "options",
          "background",
          "effects",
          "device",
          "audio",
          "chat",
          "participants",
          "join",
          "call",
          "meeting",
          "teams",
          "microsoft",
          "hang up",
          "people",
          "roster",
          "gallery",
          "speaker",
          "layout",
          "record",
          "stop",
          "start",
          "blur",
          "replace",
          "remove",
          "turn on",
          "turn off",
          "enable",
          "disable",
          "open",
          "close",
          "minimize",
          "maximize",
          "full screen",
          "exit",
          "hand",
          "raised",
          "lower",
          "pin",
          "unpin",
          "spotlight",
          "together mode",
          "large gallery",
          "focus mode",
          "breakout rooms",
          "lobby",
          "admit",
          "deny",
          "waiting",
        ];

        return uiElements.some(
          (uiElement) =>
            lower.includes(uiElement) ||
            lower === uiElement ||
            text.length < 2 ||
            text.length > 50
        );
      }

      // Extract clean participant name
      function extractParticipantName(text: string): string | null {
        if (!text) return null;

        // Remove "(you)" suffix and common Teams indicators
        let cleanText = text.replace(/\s*\(you\)\s*$/i, "").trim();
        cleanText = cleanText.replace(/\s*\(presenter\)\s*/i, "").trim();
        cleanText = cleanText.replace(/\s*\(organizer\)\s*/i, "").trim();

        // Look for pattern: "BotName + UserName" and extract UserName
        if (cleanText.includes("Design Bot")) {
          cleanText = cleanText.replace("Design Bot", "").trim();
        }

        // If still has spaces, might be "FirstName LastName"
        if (cleanText && !isUIElement(cleanText) && cleanText.length > 1) {
          return cleanText;
        }

        return null;
      }

      // Strategy 1: Look for active audio/video indicators
      const audioVisualIndicators = [
        // Audio wave/voice activity animations
        '[class*="audio-indicator"]',
        '[class*="voice-indicator"]',
        '[class*="speaking"]',
        '[class*="voice-active"]',
        '[class*="audio-active"]',
        '[class*="sound-wave"]',
        '[class*="audio-wave"]',
        '[class*="voice-activity"]',
        '[class*="mic-active"]',
        '[class*="microphone-active"]',
        // Video tile emphasis
        '[class*="active-speaker"]',
        '[class*="dominant-speaker"]',
        '[class*="current-speaker"]',
        '[class*="highlighted"]',
        '[class*="emphasized"]',
        '[class*="focused"]',
        // Common Teams selectors
        '[data-tid*="speaking"]',
        '[data-tid*="audio-active"]',
        '[data-tid*="voice"]',
        '[aria-label*="speaking"]',
        '[aria-label*="voice"]',
        '[aria-label*="audio active"]',
        // CSS animations often used for speaking
        '[style*="animation"]',
        '[style*="transform"]',
      ];

      for (const selector of audioVisualIndicators) {
        try {
          const elements = Array.from(document.querySelectorAll(selector));

          elements.forEach((element, index) => {
            // Check if element is visible and potentially active
            const computedStyle = window.getComputedStyle(element);
            const isVisible =
              computedStyle.display !== "none" &&
              computedStyle.visibility !== "hidden" &&
              computedStyle.opacity !== "0";

            if (isVisible) {
              // Look for names in this element and nearby elements
              const searchElements = [
                element,
                element.parentElement,
                ...Array.from(element.children),
              ];

              searchElements.forEach((searchEl) => {
                if (searchEl) {
                  const text = searchEl.textContent?.trim();
                  const ariaLabel = searchEl.getAttribute("aria-label");
                  const title = searchEl.getAttribute("title");

                  const contents = [text, ariaLabel, title].filter(
                    (content): content is string =>
                      content !== null &&
                      content !== undefined &&
                      content.trim().length > 0
                  );

                  contents.forEach((content) => {
                    const name = extractParticipantName(content);
                    if (name) {
                      detectedSpeakers.add(name);
                    }
                  });
                }
              });
            }
          });
        } catch (error) {
          // Selector failed, continue to next
        }
      }

      // Strategy 2: Look for participant tiles with visual emphasis (borders, shadows, etc.)
      const participantTileSelectors = [
        '[data-tid*="participant"]',
        '[data-tid*="video-tile"]',
        '[data-tid*="audio-tile"]',
        '[data-tid*="member"]',
        '[class*="participant"]',
        '[class*="video-tile"]',
        '[class*="member-tile"]',
        '[class*="user-tile"]',
        '[class*="avatar"]',
      ];

      participantTileSelectors.forEach((selector) => {
        try {
          const tiles = Array.from(document.querySelectorAll(selector));

          tiles.forEach((tile) => {
            const computedStyle = window.getComputedStyle(tile);

            // Check for visual indicators of active speaking
            const hasActiveBorder =
              computedStyle.borderWidth !== "0px" &&
              computedStyle.borderWidth !== "" &&
              !computedStyle.borderColor.includes("rgba(0, 0, 0, 0)") &&
              computedStyle.borderColor !== "transparent";

            const hasBoxShadow = computedStyle.boxShadow !== "none";
            const hasTransform = computedStyle.transform !== "none";
            const hasAnimation = computedStyle.animationName !== "none";
            const hasHighlight =
              !computedStyle.backgroundColor.includes("rgba(0, 0, 0, 0)") &&
              computedStyle.backgroundColor !== "transparent";

            const isVisuallyEmphasized =
              hasActiveBorder ||
              hasBoxShadow ||
              hasTransform ||
              hasAnimation ||
              hasHighlight;

            if (isVisuallyEmphasized) {
              // Found visually emphasized tile

              // Extract name from this emphasized tile
              const tileText = tile.textContent?.trim();
              const tileAriaLabel = tile.getAttribute("aria-label");

              const tileContents = [tileText, tileAriaLabel].filter(
                (content): content is string =>
                  content !== null &&
                  content !== undefined &&
                  content.trim().length > 0
              );

              tileContents.forEach((content) => {
                const name = extractParticipantName(content);
                if (name) {
                  detectedSpeakers.add(name);
                }
              });
            }
          });
        } catch (error) {
          // Tile selector failed, continue
        }
      });

      // Strategy 3: Look for recent activity or "now speaking" indicators
      const recentActivitySelectors = [
        '[aria-live="polite"]',
        '[aria-live="assertive"]',
        '[class*="recent"]',
        '[class*="current"]',
        '[class*="now"]',
        '[class*="active"]',
        '[data-tid*="current"]',
        '[data-tid*="active"]',
      ];

      recentActivitySelectors.forEach((selector) => {
        try {
          const elements = Array.from(document.querySelectorAll(selector));
          elements.forEach((element) => {
            const text = element.textContent?.trim();
            if (
              text &&
              (text.includes("speaking") || text.includes("talking"))
            ) {
              const name = extractParticipantName(text);
              if (name) {
                detectedSpeakers.add(name);
              }
            }
          });
        } catch (error) {
          // Activity selector failed, continue
        }
      });

      // Strategy 4: Look for "(you)" patterns as fallback
      if (detectedSpeakers.size === 0) {
        const youElements = Array.from(document.querySelectorAll("*")).filter(
          (el) => el.textContent?.includes("(you)")
        );

        youElements.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) {
            const name = extractParticipantName(text);
            if (name) {
              detectedSpeakers.add(name);
            }
          }
        });
      }

      const finalSpeakers = Array.from(detectedSpeakers).filter(
        (name) => name && name !== "Design Bot" && !isUIElement(name)
      );

      return finalSpeakers;
    }, BOT_ID);

    // Only log when we find speakers or when there's a change
    if (result.length > 0) {
      console.log(
        `🔍 [${BOT_ID}] Teams active speakers detected: ${result.join(", ")}`
      );
    }

    return result;
  } catch (error) {
    console.error(`❌ [${BOT_ID}] Error in Teams speaker detection:`, error);
    return [];
  }
}

// ✅ **Zoom Speaker Detection**
async function getActiveSpeakersZoom(page: Page): Promise<string[]> {
  try {
    const result = await page.evaluate((BOT_ID) => {
      const detectedSpeakers = new Set<string>();

      // Helper function to check if text is a UI element (not a real name)
      function isUIElement(text: string): boolean {
        const lower = text.toLowerCase();
        const uiElements = [
          "raise",
          "react",
          "view",
          "mic",
          "mute",
          "unmute",
          "camera",
          "video",
          "share",
          "screen",
          "leave",
          "end",
          "settings",
          "more",
          "options",
          "background",
          "effects",
          "device",
          "audio",
          "chat",
          "participants",
          "join",
          "call",
          "meeting",
          "teams",
          "microsoft",
          "hang up",
          "people",
          "roster",
          "gallery",
          "speaker",
          "layout",
          "record",
          "stop",
          "start",
          "blur",
          "replace",
          "remove",
          "turn on",
          "turn off",
          "enable",
          "disable",
          "open",
          "close",
          "minimize",
          "maximize",
          "full screen",
          "exit",
          "hand",
          "raised",
          "lower",
          "pin",
          "unpin",
          "spotlight",
          "together mode",
          "large gallery",
          "focus mode",
          "breakout rooms",
          "lobby",
          "admit",
          "deny",
          "waiting",
        ];

        return uiElements.some(
          (uiElement) =>
            lower.includes(uiElement) ||
            lower === uiElement ||
            text.length < 2 ||
            text.length > 50
        );
      }

      // Extract clean participant name
      function extractParticipantName(text: string): string | null {
        if (!text) return null;

        // Remove "(you)" suffix and common Zoom indicators
        let cleanText = text.replace(/\s*\(you\)\s*$/i, "").trim();
        cleanText = cleanText.replace(/\s*\(presenter\)\s*/i, "").trim();
        cleanText = cleanText.replace(/\s*\(organizer\)\s*/i, "").trim();

        // Look for pattern: "BotName + UserName" and extract UserName
        if (cleanText.includes("Design Bot")) {
          cleanText = cleanText.replace("Design Bot", "").trim();
        }

        // If still has spaces, might be "FirstName LastName"
        if (cleanText && !isUIElement(cleanText) && cleanText.length > 1) {
          return cleanText;
        }

        return null;
      }

      // Strategy 1: Look for active audio/video indicators
      const audioVisualIndicators = [
        // Audio wave/voice activity animations
        '[class*="audio-indicator"]',
        '[class*="voice-indicator"]',
        '[class*="speaking"]',
        '[class*="voice-active"]',
        '[class*="audio-active"]',
        '[class*="sound-wave"]',
        '[class*="audio-wave"]',
        '[class*="voice-activity"]',
        '[class*="mic-active"]',
        '[class*="microphone-active"]',
        // Video tile emphasis
        '[class*="active-speaker"]',
        '[class*="dominant-speaker"]',
        '[class*="current-speaker"]',
        '[class*="highlighted"]',
        '[class*="emphasized"]',
        '[class*="focused"]',
        // Common Zoom selectors
        '[data-tid*="speaking"]',
        '[data-tid*="audio-active"]',
        '[data-tid*="voice"]',
        '[aria-label*="speaking"]',
        '[aria-label*="voice"]',
        '[aria-label*="audio active"]',
        // CSS animations often used for speaking
        '[style*="animation"]',
        '[style*="transform"]',
      ];

      for (const selector of audioVisualIndicators) {
        try {
          const elements = Array.from(document.querySelectorAll(selector));

          elements.forEach((element, index) => {
            // Check if element is visible and potentially active
            const computedStyle = window.getComputedStyle(element);
            const isVisible =
              computedStyle.display !== "none" &&
              computedStyle.visibility !== "hidden" &&
              computedStyle.opacity !== "0";

            if (isVisible) {
              // Look for names in this element and nearby elements
              const searchElements = [
                element,
                element.parentElement,
                ...Array.from(element.children),
              ];

              searchElements.forEach((searchEl) => {
                if (searchEl) {
                  const text = searchEl.textContent?.trim();
                  const ariaLabel = searchEl.getAttribute("aria-label");
                  const title = searchEl.getAttribute("title");

                  const contents = [text, ariaLabel, title].filter(
                    (content): content is string =>
                      content !== null &&
                      content !== undefined &&
                      content.trim().length > 0
                  );

                  contents.forEach((content) => {
                    const name = extractParticipantName(content);
                    if (name) {
                      detectedSpeakers.add(name);
                    }
                  });
                }
              });
            }
          });
        } catch (error) {
          // Selector failed, continue to next
        }
      }

      // Strategy 2: Look for participant tiles with visual emphasis (borders, shadows, etc.)
      const participantTileSelectors = [
        '[data-tid*="participant"]',
        '[data-tid*="video-tile"]',
        '[data-tid*="audio-tile"]',
        '[data-tid*="member"]',
        '[class*="participant"]',
        '[class*="video-tile"]',
        '[class*="member-tile"]',
        '[class*="user-tile"]',
        '[class*="avatar"]',
      ];

      participantTileSelectors.forEach((selector) => {
        try {
          const tiles = Array.from(document.querySelectorAll(selector));

          tiles.forEach((tile) => {
            const computedStyle = window.getComputedStyle(tile);

            // Check for visual indicators of active speaking
            const hasActiveBorder =
              computedStyle.borderWidth !== "0px" &&
              computedStyle.borderWidth !== "" &&
              !computedStyle.borderColor.includes("rgba(0, 0, 0, 0)") &&
              computedStyle.borderColor !== "transparent";

            const hasBoxShadow = computedStyle.boxShadow !== "none";
            const hasTransform = computedStyle.transform !== "none";
            const hasAnimation = computedStyle.animationName !== "none";
            const hasHighlight =
              !computedStyle.backgroundColor.includes("rgba(0, 0, 0, 0)") &&
              computedStyle.backgroundColor !== "transparent";

            const isVisuallyEmphasized =
              hasActiveBorder ||
              hasBoxShadow ||
              hasTransform ||
              hasAnimation ||
              hasHighlight;

            if (isVisuallyEmphasized) {
              // Found visually emphasized tile

              // Extract name from this emphasized tile
              const tileText = tile.textContent?.trim();
              const tileAriaLabel = tile.getAttribute("aria-label");

              const tileContents = [tileText, tileAriaLabel].filter(
                (content): content is string =>
                  content !== null &&
                  content !== undefined &&
                  content.trim().length > 0
              );

              tileContents.forEach((content) => {
                const name = extractParticipantName(content);
                if (name) {
                  detectedSpeakers.add(name);
                }
              });
            }
          });
        } catch (error) {
          // Tile selector failed, continue
        }
      });

      // Strategy 3: Look for recent activity or "now speaking" indicators
      const recentActivitySelectors = [
        '[aria-live="polite"]',
        '[aria-live="assertive"]',
        '[class*="recent"]',
        '[class*="current"]',
        '[class*="now"]',
        '[class*="active"]',
        '[data-tid*="current"]',
        '[data-tid*="active"]',
      ];

      recentActivitySelectors.forEach((selector) => {
        try {
          const elements = Array.from(document.querySelectorAll(selector));
          elements.forEach((element) => {
            const text = element.textContent?.trim();
            if (
              text &&
              (text.includes("speaking") || text.includes("talking"))
            ) {
              const name = extractParticipantName(text);
              if (name) {
                detectedSpeakers.add(name);
              }
            }
          });
        } catch (error) {
          // Activity selector failed, continue
        }
      });

      // Strategy 4: Look for "(you)" patterns as fallback
      if (detectedSpeakers.size === 0) {
        const youElements = Array.from(document.querySelectorAll("*")).filter(
          (el) => el.textContent?.includes("(you)")
        );

        youElements.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) {
            const name = extractParticipantName(text);
            if (name) {
              detectedSpeakers.add(name);
            }
          }
        });
      }

      const finalSpeakers = Array.from(detectedSpeakers).filter(
        (name) => name && name !== "Design Bot" && !isUIElement(name)
      );

      return finalSpeakers;
    }, BOT_ID);

    // Only log when we find speakers or when there's a change
    if (result.length > 0) {
      console.log(
        `🔍 [${BOT_ID}] Zoom active speakers detected: ${result.join(", ")}`
      );
    }

    return result;
  } catch (error) {
    console.error(`❌ [${BOT_ID}] Error in Zoom speaker detection:`, error);
    return [];
  }
}

export function isBufferSilent(buffer: Buffer, threshold = SILENCE_THRESHOLD) {
  if (buffer.length === 0) return true;
  let total = 0;
  const sampleCount = buffer.length / 2; // 16-bit samples
  for (let i = 0; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    total += sample * sample;
  }
  const rms = Math.sqrt(total / sampleCount);
  //console.log('Current RMS:', rms)
  return rms < threshold;
}

export async function monitorKickout(page: Page) {
  console.log(`⏳ [${BOT_ID}] Waiting for bot to be let into the meeting...`);

  const startTime = Date.now();
  const maxWaitTime = 15 * 60 * 1000; // 15 minutes in milliseconds

  // Detect platform
  const currentUrl = page.url();
  const platform = detectMeetingPlatform(currentUrl);

  while (
    Date.now() - startTime < maxWaitTime &&
    state.isBotRunning &&
    !page.isClosed()
  ) {
    try {
      let isWaiting = false;

      if (platform === "google-meet") {
        // ✅ **FIXED**: Check for actual waiting room indicators
        const waitingRoomIndicators = await page.evaluate(() => {
          // Check for waiting room specific text and elements
          const bodyText = document.body.innerText.toLowerCase();
          const hasWaitingText =
            bodyText.includes("asking to join") ||
            bodyText.includes("waiting for the host") ||
            bodyText.includes("waiting to join") ||
            bodyText.includes("waiting for someone to let you in");

          // Check for waiting room specific buttons/elements
          const hasAskToJoinButton = !!document.querySelector(
            'span[jsname="V67aGc"].UywwFc-vQzf8d'
          );
          const hasWaitingSpinner = !!document.querySelector(
            '[data-loading="true"], .loading, [class*="spinner"]'
          );

          // Check if we're on the actual meeting page (has participant tiles, controls, etc.)
          const hasParticipantTiles =
            document.querySelectorAll(
              '[data-participant-id], [jsname="A5il2e"], [data-sender-name]'
            ).length > 0;
          const hasActiveMeetingControls = !!document.querySelector(
            '[aria-label*="microphone"], [aria-label*="camera"], [jsname="BOHaEe"]'
          );

          return (
            (hasWaitingText || hasAskToJoinButton || hasWaitingSpinner) &&
            !hasParticipantTiles &&
            !hasActiveMeetingControls
          );
        });

        isWaiting = waitingRoomIndicators;
      } else if (platform === "teams") {
        // Check for Teams lobby indicators
        const lobbyIndicators = await page.$$(
          '[data-tid="lobby-screen"], [class*="lobby"], [aria-label*="lobby"], [aria-label*="waiting"]'
        );
        const waitingIndicators = await page.$$(
          '[class*="waiting"], [aria-label*="waiting room"]'
        );
        isWaiting = lobbyIndicators.length > 0 || waitingIndicators.length > 0;
      } else if (platform === "zoom") {
        // Check for Zoom waiting room indicators
        const waitingRoomIndicators = await page.$$(
          '[class*="waiting-room"], [class*="waitingroom"], [aria-label*="waiting"], [class*="lobby"]'
        );
        const hasWaitingMessage = await page.evaluate(() => {
          const bodyText = document.body.innerText.toLowerCase();
          return (
            bodyText.includes("waiting for the host") ||
            bodyText.includes("waiting room") ||
            bodyText.includes("please wait")
          );
        });
        isWaiting = waitingRoomIndicators.length > 0 || hasWaitingMessage;
      }

      if (isWaiting) {
        console.log(`🚪 [${BOT_ID}] Bot is still waiting at the door...`);
      } else {
        console.log(`✅ [${BOT_ID}] Bot has entered the meeting!`);
        // ✅ Grace period to allow UI to fully load
        /*
        console.log(
          `⏳ [${BOT_ID}] Waiting 5 seconds for meeting UI to stabilize...`
        );
        
        */
        //await delay(5000);

        setHasJoined(true);

        // 👉 START monitorParticipants
        monitorParticipants(page);
        break; // Exit waiting loop and start monitoring
      }
    } catch (err) {
      console.error(`[${BOT_ID}] Error while waiting for entry:`, err);
    }

    await delay(5000); // Check every 5 seconds
  }

  // If bot is already stopping or page closed, bail out.
  if (!state.isBotRunning || page.isClosed()) {
    console.log("Bot was stopped or page closed, exiting monitorKickout...");
    return;
  }

  // Final check if still waiting after timeout
  let stillWaiting = false;
  if (platform === "google-meet") {
    // ✅ **FIXED**: Use same proper waiting room detection logic
    stillWaiting = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      const hasWaitingText =
        bodyText.includes("asking to join") ||
        bodyText.includes("waiting for the host") ||
        bodyText.includes("waiting to join") ||
        bodyText.includes("waiting for someone to let you in");

      const hasAskToJoinButton = !!document.querySelector(
        'span[jsname="V67aGc"].UywwFc-vQzf8d'
      );
      const hasWaitingSpinner = !!document.querySelector(
        '[data-loading="true"], .loading, [class*="spinner"]'
      );

      const hasParticipantTiles =
        document.querySelectorAll(
          '[data-participant-id], [jsname="A5il2e"], [data-sender-name]'
        ).length > 0;
      const hasActiveMeetingControls = !!document.querySelector(
        '[aria-label*="microphone"], [aria-label*="camera"], [jsname="BOHaEe"]'
      );

      return (
        (hasWaitingText || hasAskToJoinButton || hasWaitingSpinner) &&
        !hasParticipantTiles &&
        !hasActiveMeetingControls
      );
    });
  } else if (platform === "teams") {
    const lobbyIndicators = await page.$$(
      '[data-tid="lobby-screen"], [class*="lobby"]'
    );
    stillWaiting = lobbyIndicators.length > 0;
  }

  if (stillWaiting) {
    console.log(
      `❌ [${BOT_ID}] Bot was not let into the meeting after 15 minutes. Exiting...`
    );
    await stopMeetBot();
    return;
  }

  console.log(`🎥 [${BOT_ID}] Monitoring for bot kickout...`);

  // Now that the bot is in, start monitoring for kickout
  while (state.isBotRunning) {
    try {
      if (platform === "google-meet") {
        // Google Meet specific checks

        // Check for "You've been removed from the meeting" message
        const removedElem = await page.$("div.Fi0Gqc");
        if (removedElem) {
          const text = await page.evaluate((el) => el.innerText, removedElem);
          if (text.includes("You've been removed from the meeting")) {
            console.log(
              `🚨 [${BOT_ID}] Bot has been removed from the meeting. Stopping recording...`
            );
            await stopMeetBot();
            break;
          }
        }

        // ✅ **Enhanced Leave Button Detection - Multiple Selectors**
        const leaveButtonSelectors = [
          'button[aria-label="Leave call"]',
          'button[aria-label="End call"]',
          'button[aria-label="Hang up"]',
          'button[aria-label="Exit meeting"]',
          'button[aria-label*="leave"]',
          'button[aria-label*="end"]',
          'button[aria-label*="exit"]',
          'button[aria-label*="hang"]',
          '[data-tooltip*="Leave"]',
          '[data-tooltip*="End"]',
          'button[jsname="CQylAd"]', // Google Meet specific leave button
          'button[jsname="Qx7uuf"]', // Google Meet generic button
        ];

        let leaveCallButton = null;
        let foundSelector = "";

        for (const selector of leaveButtonSelectors) {
          leaveCallButton = await page.$(selector);
          if (leaveCallButton) {
            foundSelector = selector;
            break;
          }
        }

        if (!leaveCallButton) {
          // ✅ **Additional Check: Look for meeting controls to confirm we're still in meeting**
          const meetingControlsExist = await page.evaluate(() => {
            // Check for any meeting control indicators
            const controlSelectors = [
              '[aria-label*="microphone"]',
              '[aria-label*="camera"]',
              '[aria-label*="mic"]',
              '[aria-label*="video"]',
              '[jsname="BOHaEe"]', // Google Meet controls container
              "[data-participant-id]", // Participant elements
              '[class*="participant"]',
              'button[aria-label*="mute"]',
              'button[aria-label*="unmute"]',
            ];

            return controlSelectors.some(
              (selector) => !!document.querySelector(selector)
            );
          });

          if (meetingControlsExist) {
            console.log(
              `⚠️ [${BOT_ID}] Leave button not found, but meeting controls detected - continuing...`
            );
          } else {
            console.log(
              `🚨 [${BOT_ID}] No leave button or meeting controls found. Bot may have been removed. Stopping recording...`
            );
            await stopMeetBot();
            break;
          }
        } else {
          console.log(
            `✅ [${BOT_ID}] Leave button found using selector: ${foundSelector}`
          );
        }
      } else if (platform === "teams") {
        // Microsoft Teams specific checks - MADE MORE CONSERVATIVE

        // Check for Teams removal messages
        const removalMessages = [
          "You have been removed from the meeting",
          "removed from the meeting",
          "Meeting has ended",
          "meeting has ended",
          "The meeting has been ended",
        ];

        const pageText = await page.evaluate(() => document.body.innerText);
        const isRemoved = removalMessages.some((msg) =>
          pageText.toLowerCase().includes(msg.toLowerCase())
        );

        if (isRemoved) {
          console.log(
            `🚨 [${BOT_ID}] Bot has been removed from Teams meeting. Stopping recording...`
          );
          await stopMeetBot();
          break;
        }

        // MORE CONSERVATIVE: Only stop if we're clearly disconnected
        // Check if we're back at lobby/join screen or connection is lost
        const lobbySelectors = [
          '[data-tid="lobby-screen"]',
          '[class*="lobby"]',
          '[aria-label*="lobby"]',
          '[aria-label*="waiting room"]',
          'button[aria-label*="Join now"]',
          'button[aria-label*="join meeting"]',
        ];

        let isBackInLobby = false;
        for (const selector of lobbySelectors) {
          const element = await page.$(selector);
          if (element) {
            isBackInLobby = true;
            break;
          }
        }

        if (isBackInLobby) {
          console.log(
            `🚨 [${BOT_ID}] Bot is back in Teams lobby/join screen. Stopping recording...`
          );
          await stopMeetBot();
          break;
        }

        // Also check if page redirected to a join URL (sign of being kicked)
        const currentUrl = page.url();
        if (
          currentUrl.includes("/join/") ||
          currentUrl.includes("/meeting/join")
        ) {
          console.log(
            `🚨 [${BOT_ID}] Bot was redirected to join URL. Stopping recording...`
          );
          await stopMeetBot();
          break;
        }
      } else if (platform === "zoom") {
        // Zoom specific checks - detect meeting end/removal

        // Check for Zoom removal/end messages
        const removalMessages = [
          "The meeting has ended",
          "meeting has ended",
          "You have been removed",
          "removed from the meeting",
          "The host has ended the meeting",
          "Meeting ended by host",
          "Connection lost",
          "Reconnecting",
          "Unable to connect",
        ];

        const pageText = await page.evaluate(() => document.body.innerText);
        const isRemoved = removalMessages.some((msg) =>
          pageText.toLowerCase().includes(msg.toLowerCase())
        );

        if (isRemoved) {
          console.log(
            `🚨 [${BOT_ID}] Bot has been removed from Zoom meeting or meeting ended. Stopping recording...`
          );
          await stopMeetBot();
          break;
        }

        // Check if we're back at join screen - ULTRA SPECIFIC: Prevent false positives
        // FIRST: Quick check if we're clearly in an active meeting
        const activeMeetingCheck = await page.evaluate(() => {
          const hasActiveElements =
            !!document.querySelector('[aria-label*="unmute"]') ||
            !!document.querySelector('[aria-label*="start my video"]') ||
            !!document.querySelector('[aria-label*="stop my video"]') ||
            !!document.querySelector('[class*="participant"]') ||
            !!document.querySelector('[class*="roster"]') ||
            document.querySelectorAll("video").length > 0 ||
            document.title.toLowerCase().includes("my meeting") ||
            document.body.innerText.toLowerCase().includes("participants");

          return hasActiveElements;
        });

        // If we have clear signs of an active meeting, DON'T check for pre-join elements
        if (activeMeetingCheck) {
          console.log(
            `✅ [${BOT_ID}] Active meeting elements detected - skipping pre-join check`
          );
        } else {
          // Only check for pre-join if we don't have active meeting signs
          console.log(
            `🔍 [${BOT_ID}] No active meeting elements - checking for pre-join state`
          );

          // VERY SPECIFIC pre-join detection - only the most obvious ones
          const criticalPreJoinSelectors = [
            "button.preview-join-button", // THE specific pre-join button
            "#input-for-name", // Name input field (only on pre-join)
          ];

          let isBackAtPreJoin = false;
          for (const selector of criticalPreJoinSelectors) {
            const element = await page.$(selector);
            if (element) {
              console.log(
                `🔍 [${BOT_ID}] Detected CRITICAL pre-join element: ${selector}`
              );
              isBackAtPreJoin = true;
              break;
            }
          }

          // Additional STRICT check for pre-join specific text/state
          if (!isBackAtPreJoin) {
            const isPreJoinState = await page.evaluate(() => {
              const bodyText = document.body.innerText.toLowerCase();
              const title = document.title.toLowerCase();

              // Very specific pre-join indicators
              const hasPreJoinText =
                bodyText.includes("enter your name") ||
                (title.includes("zoom meeting on web") &&
                  bodyText.includes("your name"));

              // Double-check we don't have meeting elements
              const hasActiveMeetingElements =
                !!document.querySelector('[aria-label*="unmute"]') ||
                !!document.querySelector('[aria-label*="start my video"]') ||
                !!document.querySelector('[class*="participant"]') ||
                document.querySelectorAll("video").length > 0;

              return hasPreJoinText && !hasActiveMeetingElements;
            });

            if (isPreJoinState) {
              console.log(
                `🔍 [${BOT_ID}] Detected pre-join state via STRICT text analysis`
              );
              isBackAtPreJoin = true;
            }
          }

          if (isBackAtPreJoin) {
            console.log(
              `🚨 [${BOT_ID}] Bot is back at Zoom pre-join screen. Stopping recording...`
            );
            await stopMeetBot();
            break;
          }
        }

        // Check for connection issues - FIXED: More specific URL detection
        const currentUrl = page.url();

        // Only trigger if we're ACTUALLY back at a join page, not just because URL contains '/join'
        // Zoom web client URLs naturally contain '/join' even when in meeting
        const isActuallyBackAtJoin =
          currentUrl.includes("/launch") || // Zoom launcher page
          (currentUrl.includes("zoom.us/j/") && !currentUrl.includes("/wc/")) || // Direct join URL without web client
          currentUrl.includes("/start/") || // Starting a meeting page
          currentUrl.endsWith("/join") || // Ends with join (not part of path)
          currentUrl.includes("signin") || // Sign-in page
          currentUrl.includes("login"); // Login page

        if (isActuallyBackAtJoin) {
          console.log(
            `🚨 [${BOT_ID}] Bot was redirected away from Zoom meeting (URL: ${currentUrl}). Stopping recording...`
          );
          await stopMeetBot();
          break;
        }
      }
    } catch (err) {
      console.error(`[${BOT_ID}] Error checking meeting status:`, err);
    }

    await delay(5000); // Check every 5 seconds (less aggressive than 1 second)
  }
}

// ✅ **Monitor Participants and Stop if Only Bot is Left**
export function monitorParticipants(page: Page) {
  if (!page) {
    console.error(
      `❌ [${BOT_ID}] monitorParticipants: Page object is undefined.`
    );
    return;
  }

  // Detect platform
  const currentUrl = page.url();
  const platform = detectMeetingPlatform(currentUrl);

  const participantCheckInterval = setInterval(async () => {
    //console.log('🔄 Running participant check...')
    try {
      // **Prevent execution if stopMeetBot is already running**
      if (state.isClosing) {
        console.log(
          `⚠️ [${BOT_ID}] Bot is already stopping. Exiting participant monitoring.`
        );
        clearInterval(participantCheckInterval);
        return;
      }

      // Check if the page is still open before evaluating
      if (page.isClosed()) {
        console.log(
          `🛑 [${BOT_ID}] Page is closed. Stopping participant monitoring.`
        );
        clearInterval(participantCheckInterval);
        return;
      }

      let participantCount = null;

      if (platform === "google-meet") {
        participantCount = await page.evaluate(() => {
          const participantElement = document.querySelector(
            ".gFyGKf.BN1Lfc .uGOf1d"
          );
          return participantElement instanceof HTMLElement
            ? Number.parseInt(participantElement.innerText.trim(), 10)
            : null;
        });
      } else if (platform === "teams") {
        participantCount = await page.evaluate(() => {
          // Strategy 1: Look for participant count in roster
          const strategies = [
            () => {
              const rosterButton = document.querySelector(
                '[data-tid="roster-button"], [aria-label*="participant"], [aria-label*="people"]'
              );
              if (rosterButton) {
                const text =
                  rosterButton.textContent ||
                  rosterButton.getAttribute("aria-label") ||
                  "";
                const match = text.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : null;
              }
              return null;
            },
            () => {
              // Strategy 2: Count participant items in opened roster
              const participantItems = document.querySelectorAll(
                '[data-tid="participant-item"], .participant-item'
              );
              return participantItems.length > 0
                ? participantItems.length
                : null;
            },
            () => {
              // Strategy 3: Look for participant count in call info
              const callInfo = document.querySelector(
                '[class*="participant-count"], [aria-label*="participant count"]'
              );
              if (callInfo) {
                const text =
                  callInfo.textContent ||
                  callInfo.getAttribute("aria-label") ||
                  "";
                const match = text.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : null;
              }
              return null;
            },
            () => {
              // Strategy 4: Count visible participant elements
              const visibleParticipants = Array.from(
                document.querySelectorAll(
                  '[class*="participant"], [class*="member"]'
                )
              ).filter((el) => {
                const style = window.getComputedStyle(el);
                return (
                  style.display !== "none" && style.visibility !== "hidden"
                );
              });
              return visibleParticipants.length > 0
                ? visibleParticipants.length
                : null;
            },
          ];

          for (const strategy of strategies) {
            const count = strategy();
            if (count !== null && count > 0) {
              return count;
            }
          }
          return null;
        });
      } else if (platform === "zoom") {
        participantCount = await page.evaluate(() => {
          // Strategy 1: Look for participant count in participants panel button
          const strategies = [
            () => {
              const participantButton = document.querySelector(
                '[aria-label*="participant"], [aria-label*="Participant"], button[aria-label*="people"]'
              );
              if (participantButton) {
                const text =
                  participantButton.textContent ||
                  participantButton.getAttribute("aria-label") ||
                  "";
                const match = text.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : null;
              }
              return null;
            },
            () => {
              // Strategy 2: Count visible video tiles
              const videoTiles = document.querySelectorAll(
                '[class*="video-tile"], [class*="participant"], [data-participant-id]'
              );
              const visibleTiles = Array.from(videoTiles).filter((tile) => {
                const style = window.getComputedStyle(tile);
                return (
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  style.opacity !== "0"
                );
              });
              return visibleTiles.length > 0 ? visibleTiles.length : null;
            },
            () => {
              // Strategy 3: Look for participant list items
              const participantItems = document.querySelectorAll(
                '[class*="participant-item"], [class*="attendee"], li[role="listitem"]'
              );
              return participantItems.length > 0
                ? participantItems.length
                : null;
            },
            () => {
              // Strategy 4: Look for specific Zoom participant indicators
              const zoomParticipants = document.querySelectorAll(
                '[data-testid*="participant"], [data-automation-id*="participant"]'
              );
              return zoomParticipants.length > 0
                ? zoomParticipants.length
                : null;
            },
            () => {
              // Strategy 5: Check footer or header for participant count
              const footerHeader = document.querySelector(
                'footer, header, [class*="footer"], [class*="header"]'
              );
              if (footerHeader) {
                const text = footerHeader.textContent || "";
                const match = text.match(/(\d+)\s*participants?/i);
                return match ? parseInt(match[1], 10) : null;
              }
              return null;
            },
          ];

          for (const strategy of strategies) {
            const count = strategy();
            if (count !== null && count > 0) {
              return count;
            }
          }
          return null;
        });
      }

      // IMPROVED LOGIC: Don't stop if we're actively detecting speakers
      // Check if we have active speakers (more reliable than participant count for Teams)
      let activeSpeakers: string[] = [];
      try {
        activeSpeakers = await getActiveSpeakers(page);
        // Filter out bot name
        activeSpeakers = activeSpeakers.filter(
          (speaker) => speaker !== "Design Bot" && speaker.trim() !== ""
        );
      } catch (err) {
        console.log(
          `⚠️ [${BOT_ID}] Could not get active speakers for participant check: ${err}`
        );
      }

      // Only consider stopping if BOTH conditions are true:
      // 1. Low/null participant count AND
      // 2. No active speakers detected
      const hasActiveSpeakers = activeSpeakers.length > 0;
      const lowParticipantCount =
        participantCount === null || participantCount === 1;

      if (lowParticipantCount && !hasActiveSpeakers) {
        if (Date.now() - lastParticipantCheck >= 60000) {
          console.log(
            `⏳ [${BOT_ID}] No participants AND no speakers detected for 1 minute. Stopping Meet Bot...`
          );
          console.log(
            `📊 [${BOT_ID}] Final check - Participant count: ${participantCount}, Active speakers: ${activeSpeakers.length}`
          );

          clearInterval(participantCheckInterval);

          // **Give the system a moment before stopping**
          setTimeout(async () => {
            console.log(`🛑 [${BOT_ID}] Call stop Meet bot 🛑`);
            await stopMeetBot();
            // **Set state to prevent duplicate stop calls**
            state.isClosing = true;
          }, 2000);
        }
      } else {
        // Reset the timer if we have participants OR speakers
        lastParticipantCheck = Date.now();

        // Log why we're not stopping (for debugging)
        if (lowParticipantCount && hasActiveSpeakers) {
          console.log(
            `✅ [${BOT_ID}] Low participant count (${participantCount}) but active speakers detected (${activeSpeakers.join(
              ", "
            )}) - continuing...`
          );
        }
      }
    } catch (error) {
      console.error(
        `❌ [${BOT_ID}] Error monitoring participants:`,
        error instanceof Error ? error.message : error
      );
    }
  }, 30000); // Check every 30 seconds
}

// ✅ **Monitor Active Speaker**
export async function monitorSpeakers(page: Page) {
  let lastSpeakers = [] as string[]; // Stores last detected speakers (short history)

  // Try to get initial participants when monitoring starts
  try {
    const initialSpeakers = await getActiveSpeakers(page);
    if (initialSpeakers.length > 0) {
      const firstSpeaker = initialSpeakers.find(
        (name) => name !== "Design Bot"
      );
      if (firstSpeaker) {
        state.currentSpeaker = firstSpeaker;
        console.log(`🎤 [${BOT_ID}] Initial speaker detected: ${firstSpeaker}`);
      }
    } else {
      // Fallback: try to get any participants in the meeting
      try {
        const allParticipants = await page.evaluate(() => {
          // Look for participant tiles and names more specifically
          const participants = [];

          // Method 1: Look for participant tiles
          const participantTiles = Array.from(
            document.querySelectorAll('div[jsname="E2KThb"]')
          );

          for (const tile of participantTiles) {
            // Look for name elements within each tile
            const nameEl = tile.querySelector(
              ".ne2Ple-oshW8e-V67aGc, [data-self-name], .KjwKEb"
            );
            if (nameEl && nameEl.textContent) {
              const name = nameEl.textContent
                .trim()
                .replace(/\s*\(You\)/i, "")
                .trim();
              if (name && name !== "Design Bot") {
                participants.push(name);
                console.log(`Found participant in tile: ${name}`);
              }
            }
          }

          // Method 2: Look for "You" indicator (the user themselves)
          const youElements = Array.from(
            document.querySelectorAll('[aria-label*="You"], [title*="You"]')
          );
          for (const el of youElements) {
            // Try to find the name near the "You" indicator
            const parentTile =
              el.closest('div[jsname="E2KThb"]') ||
              el.closest(".KjwKEb") ||
              el.closest(".zWfAib");
            if (parentTile) {
              const nameEl = parentTile.querySelector(
                ".ne2Ple-oshW8e-V67aGc, [data-self-name]"
              );
              if (nameEl && nameEl.textContent) {
                const name = nameEl.textContent
                  .trim()
                  .replace(/\s*\(You\)/i, "")
                  .trim();
                if (name && name !== "Design Bot") {
                  participants.push(name + " (You)");
                  console.log(`Found user themselves: ${name}`);
                }
              }
            }
          }

          // Filter out obvious UI text and duplicates
          const filteredParticipants = participants
            .filter((name) => {
              const lower = name.toLowerCase();
              return (
                !lower.includes("gemini") &&
                !lower.includes("taking notes") &&
                !lower.includes("transcript") &&
                !lower.includes("captions") &&
                !lower.includes("recording") &&
                !lower.includes("camera") &&
                !lower.includes("microphone") &&
                !lower.includes("pin") &&
                !lower.includes("unpin") &&
                !lower.includes("more options") &&
                !lower.includes("turn on") &&
                !lower.includes("turn off") &&
                !lower.includes("settings") &&
                !lower.includes("menu") &&
                !lower.includes("share your screen") &&
                !lower.includes("not allowed") &&
                !lower.includes("error") &&
                !lower.includes("failed") &&
                !lower.includes("denied") &&
                !lower.includes("permission") &&
                name.length < 50 && // Names shouldn't be super long
                name.length > 1
              );
            })
            .filter((name, index, arr) => arr.indexOf(name) === index); // Remove duplicates

          console.log(`Final filtered participants:`, filteredParticipants);
          return filteredParticipants.slice(0, 3);
        });

        if (allParticipants.length > 0 && allParticipants[0]) {
          state.currentSpeaker = allParticipants[0];
          console.log(
            `🎤 [${BOT_ID}] Fallback speaker from participants: ${state.currentSpeaker}`
          );
        }
      } catch (fallbackErr) {
        console.log(
          `⚠️ [${BOT_ID}] Fallback participant detection failed: ${fallbackErr}`
        );
      }
    }
  } catch (err) {
    console.log(`⚠️ [${BOT_ID}] Could not detect initial speakers: ${err}`);
  }

  while (state.isBotRunning) {
    if (page.isClosed()) {
      console.log(
        `🛑 [${BOT_ID}] monitorSpeakers: Page is closed. Stopping speaker monitoring.`
      );
      break;
    }

    try {
      const speakers = await getActiveSpeakers(page); // Get all active speakers

      if (speakers.length > 0) {
        lastSpeakers = [...lastSpeakers, ...speakers].slice(-5); // Keep last 5 detections
        const newSpeaker = lastSpeakers[lastSpeakers.length - 1]; // Most recent

        // Only update if we have a real speaker name (not bot name)
        if (
          newSpeaker &&
          newSpeaker !== "Design Bot" &&
          newSpeaker !== state.currentSpeaker
        ) {
          console.log(
            `🔄 [${BOT_ID}] Speaker changed: ${state.currentSpeaker} → ${newSpeaker}`
          );
          state.currentSpeaker = newSpeaker;
        } else if (newSpeaker && newSpeaker !== "Design Bot") {
          state.currentSpeaker = newSpeaker;
        }

        // Only log speaker info every 10 seconds instead of every 250ms to reduce spam
        const now = Date.now();
        if (
          !state.lastSpeakerLogTime ||
          now - state.lastSpeakerLogTime >= 10000
        ) {
          console.log(
            `🎤 [${BOT_ID}] Active Speakers: ${Array.from(
              new Set(lastSpeakers)
            ).join(", ")} | Current: ${state.currentSpeaker}`
          );
          state.lastSpeakerLogTime = now;
        }
      } else {
        // No active speakers detected, but don't log this constantly
        const now = Date.now();
        if (
          !state.lastNoSpeakerLogTime ||
          now - state.lastNoSpeakerLogTime >= 30000
        ) {
          console.log(
            `🔇 [${BOT_ID}] No active speakers detected, keeping: ${state.currentSpeaker}`
          );
          state.lastNoSpeakerLogTime = now;
        }
      }
    } catch (err) {
      console.error(
        `❌ [${BOT_ID}] monitorSpeakers: Error getting active speakers:`,
        err instanceof Error ? err.message : err
      );
      break; // avoid repeated crashing loop
    }

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Scan every 2 seconds (reduced from 250ms to reduce excessive logging)
  }
}

export async function openParticipantsPanel(page: Page) {
  try {
    await page.waitForSelector("button[aria-label='People']", {
      timeout: 10000,
    });
    await page.click("button[aria-label='People']");
    console.log(`[${BOT_ID}] Opened participants panel.`);
    return true;
  } catch (error) {
    console.error(`[${BOT_ID}] Failed to open participants panel:`, error);
    return false;
  }
}

export async function openChatWindow(page: Page) {
  const chatButtonSelector = 'button[aria-label="Chat with everyone"]';

  try {
    await page.waitForSelector(chatButtonSelector, {
      timeout: 10000,
    });

    const chatButton = await page.$(chatButtonSelector);
    assert(chatButton, "❌ Chat button not found");
    const isPressed = await page.evaluate(
      (btn) => btn.getAttribute("aria-pressed") === "true",
      chatButton
    );

    if (!isPressed) {
      await chatButton.click();
      console.log("💬 Clicked chat button to open chat panel.");
      await delay(1000);
    } else {
      console.log("💬 Chat panel was already open.");
    }

    return true;
  } catch (error) {
    console.error(
      "❌ Failed to open chat panel:",
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

export async function getChatTextarea(page: Page) {
  return page.$(
    [
      'textarea[aria-label="Send a message"]',
      'textarea[aria-label="Send a message to everyone"]',
    ].join(", ") as `textarea[${string}]`
  );
}

export async function sendChatMessage(page: Page, message: string) {
  try {
    const textarea = await getChatTextarea(page);
    assert(textarea, "❌ Chat input not found. Is the chat panel open?");

    await textarea.type(message, { delay: 30 });
    await delay(300);

    const sendButton = await page.$(
      ['button[aria-label="Send a message"]', 'button[jsname="SoqoBf"]'].join(
        ", "
      ) as `button[${string}]`
    );
    assert(sendButton, "❌ Send button not found. Is the chat panel open?");
    const isDisabled = await page.evaluate((btn) => btn.disabled, sendButton);

    if (!isDisabled) {
      await sendButton.click();
      console.log(`📤 Sent message: "${message}"`);
    } else {
      console.warn("⚠️ Send button is disabled. Message not sent.");
    }
  } catch (err) {
    console.error(
      "❌ Error sending chat message:",
      err instanceof Error ? err.message : err
    );
  }
}
