import state, { type Page } from "../state.ts";
import { batchAudioChunk } from "../utils.ts";
export async function joinZoom(page) {
  console.log("🎯 Starting Zoom meeting join with PROVEN approach...");

  // Human-like random delay function (EXACT from your working code)
  const randomDelay = (min: number = 1000, max: number = 3000) => {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.random() * (max - min) + min)
    );
  };

  try {
    // Set viewport to common resolution (from your working code)
    await page.setViewport({ width: 1920, height: 1080 });

    // Additional stealth measures (from your working code)
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      delete Object.getPrototypeOf(navigator).webdriver;

      // Override the `plugins` property to use a custom getter.
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });

      // Override the `languages` property to use a custom getter.
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });

      // Override the `webdriver` property to use a custom getter.
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });

      // Mock chrome object
      (window as any).chrome = {
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
        app: {},
      };

      // Mock notification permission
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === "notifications"
          ? Promise.resolve({
              state: Notification.permission,
            } as PermissionStatus)
          : originalQuery(parameters);
    });

    // Human-like delay (from your working code)
    await randomDelay(2000, 4000);

    // ✅ **Accept cookies if prompted** (EXACT from your working code)
    try {
      await page.waitForSelector("button#onetrust-accept-btn-handler", {
        timeout: 5000,
      });
      await randomDelay(500, 1500);
      await page.click("button#onetrust-accept-btn-handler");
      console.log("✅ Accepted cookies.");
    } catch {
      console.log("ℹ️ No cookies popup found, continuing...");
    }

    // ✅ **Handle Camera/Mic Permission Popup** (EXACT from your working code)
    try {
      await page.waitForSelector(".allow-permission-prompt", {
        timeout: 5000,
      });
      console.log("🔒 Permission popup detected!");

      await randomDelay(1000, 2000);

      // Try to find and click Allow button instead of removing modal (from your working code)
      const allowButton = await page.$(
        'button[aria-label*="Allow"], button:contains("Allow"), button[data-selenium*="allow"]'
      );
      if (allowButton) {
        await allowButton.click();
        console.log("✅ Clicked Allow on permission popup.");
      } else {
        // Fallback to removing modal (from your working code)
        await page.evaluate(() => {
          let modal = document.querySelector(".ReactModalPortal");
          if (modal) modal.remove();
        });
        console.log("✅ Permission popup removed.");
      }
    } catch {
      console.log("ℹ️ No permission popup detected.");
    }

    // Use fixed bot name for consistency
    const botName = "Design Bot";
    console.log(`🤖 Using name: ${botName}`);

    // ✅ **Enter bot name with human-like typing** (EXACT from your working code)
    await page.waitForSelector("#input-for-name", { timeout: 10000 });
    await page.click("#input-for-name", { clickCount: 3 }); // Select all existing text
    await randomDelay(300, 800);

    // Type with realistic delays between characters (EXACT from your working code)
    for (const char of botName) {
      await page.keyboard.type(char);
      await randomDelay(50, 200);
    }

    await randomDelay(1000, 2000);

    // ✅ **PRIORITY: Disable Camera and Microphone BEFORE Joining**
    console.log(
      "🔇 PRIORITY: Disabling camera and microphone BEFORE joining Zoom meeting..."
    );

    // Disable camera first - comprehensive Zoom selectors
    console.log("📷 PRIORITY: Disabling camera before joining...");
    const cameraSelectors = [
      // Zoom pre-join camera selectors
      "#preview-video-control-button",
      'button[aria-label*="Turn off camera"]',
      'button[aria-label*="Stop camera"]',
      'button[aria-label*="Disable camera"]',
      'button[aria-label*="camera"]',
      'button[aria-label*="Camera"]',
      'button[title*="camera"]',
      'button[title*="Camera"]',
      'button[class*="camera"]',
      'button[class*="video"]',
      '[data-testid*="camera"]',
      '[data-testid*="video"]',
      'button[aria-label*="Turn on camera"]', // If already off, this text appears
      'button[aria-label*="Start camera"]',
      ".preview-video-control button",
      "#preview-video-button",
      'button:has([class*="camera"])',
      'button:has([class*="video"])',
    ];

    let cameraDisabled = false;
    for (const selector of cameraSelectors) {
      try {
        const cameraButton = await page.$(selector);
        if (cameraButton) {
          console.log(`🔍 Found camera button with selector: ${selector}`);

          // Check button state to determine if camera is on/off
          const buttonState = await page.evaluate((el: Element) => {
            const element = el as HTMLElement;
            return {
              ariaLabel: element.getAttribute("aria-label"),
              title: element.title,
              className: element.className,
              textContent: element.textContent?.trim(),
              disabled: element.hasAttribute("disabled"),
              pressed: element.getAttribute("aria-pressed"),
            };
          }, cameraButton);

          console.log(
            `📊 Camera button state:`,
            JSON.stringify(buttonState, null, 2)
          );

          // Determine if camera is currently ON and needs to be turned OFF
          // If button says "Turn off camera" or "Stop camera" or "Stop Video" - camera is ON
          // If button says "Turn on camera" or "Start camera" - camera is already OFF
          const isCameraOn =
            buttonState.ariaLabel?.toLowerCase().includes("turn off camera") ||
            buttonState.ariaLabel?.toLowerCase().includes("stop camera") ||
            buttonState.ariaLabel?.toLowerCase().includes("disable camera") ||
            buttonState.ariaLabel?.toLowerCase().includes("stop video") ||
            buttonState.ariaLabel?.toLowerCase().includes("turn off video") ||
            buttonState.ariaLabel?.toLowerCase().includes("stop my video") ||
            buttonState.ariaLabel
              ?.toLowerCase()
              .includes("turn off my video") ||
            buttonState.textContent?.toLowerCase().includes("stop video") ||
            (buttonState.ariaLabel?.toLowerCase().includes("camera") &&
              !buttonState.ariaLabel?.toLowerCase().includes("turn on") &&
              !buttonState.ariaLabel?.toLowerCase().includes("start") &&
              !buttonState.ariaLabel?.toLowerCase().includes("enable")) ||
            buttonState.pressed === "true";

          console.log(
            `🔍 Camera analysis: ariaLabel="${buttonState.ariaLabel}", pressed="${buttonState.pressed}", isCameraOn=${isCameraOn}`
          );

          if (isCameraOn) {
            console.log("📷 Camera is ON, disabling NOW before joining...");
            await randomDelay(500, 1000);
            await cameraButton.click();
            await randomDelay(500, 1000);
            console.log("✅ Camera disabled BEFORE joining.");
            cameraDisabled = true;
            break;
          } else {
            console.log("📷 Camera is already OFF or disabled.");
            cameraDisabled = true;
            break;
          }
        }
      } catch (error) {
        console.log(
          `⚠️ Error checking camera button with selector ${selector}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (!cameraDisabled) {
      console.log(
        "⚠️ No camera button found - camera may already be disabled by default"
      );
    }

    // Disable microphone - comprehensive Zoom selectors
    /*
    console.log("🎤 PRIORITY: Disabling microphone before joining...");
    const micSelectors = [
      // Zoom pre-join microphone selectors
      "#preview-audio-control-button",
      'button[aria-label*="Mute microphone"]',
      'button[aria-label*="Turn off microphone"]',
      'button[aria-label*="Disable microphone"]',
      'button[aria-label*="mute"]',
      'button[aria-label*="Mute"]',
      'button[aria-label*="microphone"]',
      'button[aria-label*="Microphone"]',
      'button[title*="mute"]',
      'button[title*="Mute"]',
      'button[title*="microphone"]',
      'button[title*="Microphone"]',
      'button[class*="mute"]',
      'button[class*="audio"]',
      '[data-testid*="mute"]',
      '[data-testid*="audio"]',
      'button[aria-label*="Unmute microphone"]', // If already muted, this text appears
      'button[aria-label*="Turn on microphone"]',
      ".preview-audio-control button",
      "#preview-audio-button",
      'button:has([class*="mute"])',
      'button:has([class*="audio"])',
    ];

    let micDisabled = false;
    for (const selector of micSelectors) {
      try {
        const micButton = await page.$(selector);
        if (micButton) {
          console.log(`🔍 Found microphone button with selector: ${selector}`);

          // Check button state to determine if mic is on/off
          const buttonState = await page.evaluate((el: Element) => {
            const element = el as HTMLElement;
            return {
              ariaLabel: element.getAttribute("aria-label"),
              title: element.title,
              className: element.className,
              textContent: element.textContent?.trim(),
              disabled: element.hasAttribute("disabled"),
              pressed: element.getAttribute("aria-pressed"),
            };
          }, micButton);

          console.log(
            `📊 Microphone button state:`,
            JSON.stringify(buttonState, null, 2)
          );

          // Determine if microphone is currently ON and needs to be MUTED
          // If button says "Mute microphone" or "Turn off microphone" - mic is ON
          // If button says "Unmute microphone" or "Turn on microphone" - mic is already MUTED
          const isMicOn =
            buttonState.ariaLabel?.toLowerCase().includes("mute microphone") ||
            buttonState.ariaLabel
              ?.toLowerCase()
              .includes("turn off microphone") ||
            buttonState.ariaLabel
              ?.toLowerCase()
              .includes("disable microphone") ||
            (buttonState.ariaLabel?.toLowerCase().includes("microphone") &&
              !buttonState.ariaLabel?.toLowerCase().includes("unmute") &&
              !buttonState.ariaLabel?.toLowerCase().includes("turn on") &&
              !buttonState.ariaLabel?.toLowerCase().includes("enable")) ||
            (buttonState.ariaLabel?.toLowerCase().includes("mute") &&
              !buttonState.ariaLabel?.toLowerCase().includes("unmute")) ||
            buttonState.pressed === "false"; // For Zoom, pressed="false" often means mic is ON

          console.log(
            `🔍 Microphone analysis: ariaLabel="${buttonState.ariaLabel}", pressed="${buttonState.pressed}", isMicOn=${isMicOn}`
          );

          if (isMicOn) {
            console.log("🎤 Microphone is ON, muting NOW before joining...");
            await randomDelay(500, 1000);
            await micButton.click();
            await randomDelay(500, 1000);
            console.log("✅ Microphone muted BEFORE joining.");
            micDisabled = true;
            break;
          } else {
            console.log("🎤 Microphone is already muted or disabled.");
            micDisabled = true;
            break;
          }
        }
      } catch (error) {
        console.log(
          `⚠️ Error checking microphone button with selector ${selector}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (!micDisabled) {
      console.log(
        "⚠️ No microphone button found - mic may already be muted by default"
      );
    }
    */

    // Wait for UI to stabilize after camera/mic changes
    await randomDelay(1000, 2000);
    console.log(
      "✅ PRIORITY: Camera and microphone controls completed BEFORE joining."
    );

    // ✅ **Click Join Button** (EXACT from your working code)
    await page.waitForSelector("button.preview-join-button", {
      timeout: 5000,
    });
    await randomDelay(500, 1500);
    await page.evaluate(() => {
      const button = document.querySelector(
        "button.preview-join-button"
      ) as HTMLButtonElement;
      if (button) button.click();
    });

    console.log("✅ Bot joined Zoom successfully!");

    // ✅ **Wait for meeting to fully load** (EXACT from your working code)
    console.log("⏳ Waiting for meeting UI to fully load...");
    await randomDelay(8000, 12000);

    // ✅ **Enable system audio capture** (from your working code)
    await page.evaluate(() => {
      // Override audio context to capture system audio
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
      navigator.mediaDevices.getUserMedia = function (constraints: any) {
        if (constraints && constraints.audio) {
          constraints.audio = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 44100,
            channelCount: 2,
          };
        }
        return originalGetUserMedia.call(this, constraints);
      };
    });

    // ✅ **Wait for Video Elements and ensure audio is available** (from your working code)
    console.log("⏳ Waiting for media elements...");
    try {
      await page.waitForSelector("video, audio", { timeout: 20000 });
      console.log("✅ Media elements detected, proceeding...");

      // Wait a bit more for audio streams to establish (from your working code)
      await randomDelay(5000, 8000);
    } catch {
      console.log("⚠️ No media elements detected. Continuing anyway...");
    }

    // ✅ **Handle microphone muting for both pre-join and in-meeting states**
    /*
    console.log(
      "🎤 Verifying microphone and camera are disabled in meeting..."
    );

    // First verify microphone is muted in the meeting
    const inMeetingMuteSelectors = [
      // Zoom in-meeting mute selectors
      'button[aria-label*="Unmute microphone"]', // If muted, button shows "Unmute"
      'button[aria-label*="Unmute"]',
      'button[aria-label*="Turn on microphone"]',
      'button[aria-label*="Enable microphone"]',
      'button[aria-label*="Mute microphone"]', // If unmuted, button shows "Mute"
      'button[aria-label*="Mute"]',
      'button[aria-label*="Turn off microphone"]',
      'button[aria-label*="microphone"]',
      'button[aria-label*="Microphone"]',
      'button[title*="mute"]',
      'button[title*="Mute"]',
      'button[class*="mute"]',
      'button[class*="audio"]',
      '[data-testid*="mute"]',
      '[data-testid*="audio"]',
      ".audio-control button",
      ".mic-control button",
    ];

    let micVerified = false;
    for (const selector of inMeetingMuteSelectors) {
      try {
        const muteButton = await page.$(selector);
        if (muteButton) {
          console.log(`🔍 Found mute button with selector: ${selector}`);

          // Check button state
          const buttonState = await page.evaluate((el: Element) => {
            const element = el as HTMLElement;
            return {
              ariaLabel: element.getAttribute("aria-label"),
              title: element.title,
              className: element.className,
              textContent: element.textContent?.trim(),
              pressed: element.getAttribute("aria-pressed"),
            };
          }, muteButton);

          console.log(
            `📊 In-meeting mute button state:`,
            JSON.stringify(buttonState, null, 2)
          );

          // If button says "Unmute" or "Turn on microphone" - mic is already MUTED ✅
          // If button says "Mute" or "Turn off microphone" - mic is ON and needs to be muted
          const isMicMuted =
            buttonState.ariaLabel?.toLowerCase().includes("unmute") ||
            buttonState.ariaLabel
              ?.toLowerCase()
              .includes("turn on microphone") ||
            buttonState.ariaLabel
              ?.toLowerCase()
              .includes("enable microphone") ||
            buttonState.pressed === "true"; // pressed="true" often means muted

          const isMicOn =
            buttonState.ariaLabel?.toLowerCase().includes("mute microphone") ||
            buttonState.ariaLabel
              ?.toLowerCase()
              .includes("turn off microphone") ||
            buttonState.ariaLabel
              ?.toLowerCase()
              .includes("disable microphone") ||
            (buttonState.ariaLabel?.toLowerCase().includes("mute") &&
              !buttonState.ariaLabel?.toLowerCase().includes("unmute")) ||
            buttonState.pressed === "false";

          console.log(
            `🔍 Microphone verification: isMuted=${isMicMuted}, isOn=${isMicOn}`
          );

          if (isMicMuted) {
            console.log("✅ Microphone is properly muted in meeting.");
            micVerified = true;
            break;
          } else if (isMicOn) {
            console.log("🎤 Microphone is ON in meeting, muting now...");
            await randomDelay(500, 1000);
            await muteButton.click();
            await randomDelay(500, 1000);
            console.log("✅ Microphone muted in meeting.");
            micVerified = true;
            break;
          }
        }
      } catch (error) {
        console.log(
          `⚠️ Error with mute selector ${selector}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (!micVerified) {
      console.log(
        "⚠️ Could not verify microphone state - attempting fallback mute..."
      );

      // Fallback: Try to find and mute via JavaScript
      try {
        const jsResult = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          for (const btn of buttons) {
            const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
            const title = btn.title?.toLowerCase() || "";
            const text = btn.textContent?.toLowerCase() || "";

            // Look for buttons that would mute the mic (not unmute)
            if (
              (label.includes("mute") && !label.includes("unmute")) ||
              (title.includes("mute") && !title.includes("unmute")) ||
              (text.includes("mute") && !text.includes("unmute"))
            ) {
              console.log("Found potential mute button:", {
                label,
                title,
                text,
              });
              (btn as HTMLButtonElement).click();
              return true;
            }
          }
          return false;
        });

        if (jsResult) {
          console.log("✅ JavaScript mute attempt completed!");
        } else {
          console.log("⚠️ No mute button found via JavaScript.");
        }
      } catch (jsError) {
        console.log(
          "❌ JavaScript mute failed:",
          jsError instanceof Error ? jsError.message : jsError
        );
      }
    }

    */

    // Now verify camera is disabled in the meeting
    console.log("📷 Verifying camera is disabled in meeting...");
    const inMeetingCameraSelectors = [
      // Zoom in-meeting camera selectors - comprehensive list
      'button[aria-label*="Turn on camera"]', // If camera off, button shows "Turn on"
      'button[aria-label*="Start camera"]',
      'button[aria-label*="Enable camera"]',
      'button[aria-label*="Turn off camera"]', // If camera on, button shows "Turn off"
      'button[aria-label*="Stop camera"]',
      'button[aria-label*="Disable camera"]',
      'button[aria-label*="stop my video"]', // Zoom often uses this exact text
      'button[aria-label*="turn off my video"]',
      'button[aria-label*="start my video"]',
      'button[aria-label*="turn on my video"]',
      'button[aria-label*="stop video"]',
      'button[aria-label*="turn off video"]',
      'button[aria-label*="start video"]',
      'button[aria-label*="turn on video"]',
      'button[aria-label*="camera"]',
      'button[aria-label*="Camera"]',
      'button[aria-label*="video"]',
      'button[aria-label*="Video"]',
      'button[title*="camera"]',
      'button[title*="Camera"]',
      'button[title*="video"]',
      'button[title*="Video"]',
      'button[class*="camera"]',
      'button[class*="video"]',
      'button[class*="send-video"]', // Zoom uses send-video-container class
      '[data-testid*="camera"]',
      '[data-testid*="video"]',
      ".video-control button",
      ".camera-control button",
      ".send-video-container button", // Zoom-specific class
      '.footer-button-base__button[class*="video"]',
      'button:has([class*="video"])',
      'button:has([class*="camera"])',
    ];

    let cameraVerified = false;
    for (const selector of inMeetingCameraSelectors) {
      try {
        const cameraButton = await page.$(selector);
        if (cameraButton) {
          console.log(`🔍 Found camera button with selector: ${selector}`);

          // Check button state
          const buttonState = await page.evaluate((el: Element) => {
            const element = el as HTMLElement;
            return {
              ariaLabel: element.getAttribute("aria-label"),
              title: element.title,
              className: element.className,
              textContent: element.textContent?.trim(),
              pressed: element.getAttribute("aria-pressed"),
            };
          }, cameraButton);

          console.log(
            `📊 In-meeting camera button state:`,
            JSON.stringify(buttonState, null, 2)
          );

          // If button says "Turn on camera" or "Start camera" - camera is already OFF ✅
          // If button says "Turn off camera" or "Stop camera" or "stop my video" - camera is ON and needs to be turned off
          const isCameraOff =
            buttonState.ariaLabel?.toLowerCase().includes("turn on camera") ||
            buttonState.ariaLabel?.toLowerCase().includes("start camera") ||
            buttonState.ariaLabel?.toLowerCase().includes("enable camera") ||
            buttonState.ariaLabel?.toLowerCase().includes("start my video") ||
            buttonState.ariaLabel?.toLowerCase().includes("turn on my video") ||
            buttonState.pressed === "false"; // pressed="false" often means camera off

          const isCameraOn =
            buttonState.ariaLabel?.toLowerCase().includes("turn off camera") ||
            buttonState.ariaLabel?.toLowerCase().includes("stop camera") ||
            buttonState.ariaLabel?.toLowerCase().includes("disable camera") ||
            buttonState.ariaLabel?.toLowerCase().includes("stop my video") || // CRITICAL: Handle "stop my video"
            buttonState.ariaLabel
              ?.toLowerCase()
              .includes("turn off my video") ||
            buttonState.ariaLabel?.toLowerCase().includes("stop video") ||
            buttonState.ariaLabel?.toLowerCase().includes("turn off video") ||
            buttonState.textContent?.toLowerCase().includes("stop video") ||
            buttonState.pressed === "true";

          console.log(
            `🔍 Camera verification: isOff=${isCameraOff}, isOn=${isCameraOn}`
          );

          if (isCameraOff) {
            console.log("✅ Camera is properly disabled in meeting.");
            cameraVerified = true;
            break;
          } else if (isCameraOn) {
            console.log("📷 Camera is ON in meeting, disabling now...");
            await randomDelay(500, 1000);
            await cameraButton.click();
            await randomDelay(500, 1000);
            console.log("✅ Camera disabled in meeting.");
            cameraVerified = true;
            break;
          }
        }
      } catch (error) {
        console.log(
          `⚠️ Error with camera selector ${selector}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (!cameraVerified) {
      console.log(
        "⚠️ Could not verify camera state - attempting fallback camera disable..."
      );

      // Fallback: Try to find and disable camera via JavaScript
      try {
        const jsResult = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          for (const btn of buttons) {
            const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
            const title = btn.title?.toLowerCase() || "";
            const text = btn.textContent?.toLowerCase() || "";

            // Look for buttons that would disable/stop the camera (not enable/start)
            if (
              (label.includes("stop") &&
                (label.includes("video") || label.includes("camera"))) ||
              (title.includes("stop") &&
                (title.includes("video") || title.includes("camera"))) ||
              (text.includes("stop") &&
                (text.includes("video") || text.includes("camera"))) ||
              (label.includes("turn off") &&
                (label.includes("video") || label.includes("camera"))) ||
              (label.includes("disable") &&
                (label.includes("video") || label.includes("camera")))
            ) {
              console.log("Found potential camera disable button:", {
                label,
                title,
                text,
              });
              (btn as HTMLButtonElement).click();
              return true;
            }
          }
          return false;
        });

        if (jsResult) {
          console.log("✅ JavaScript camera disable attempt completed!");
        } else {
          console.log("⚠️ No camera disable button found via JavaScript.");
        }
      } catch (jsError) {
        console.log(
          "❌ JavaScript camera disable failed:",
          jsError instanceof Error ? jsError.message : jsError
        );
      }
    }

    console.log("✅ Microphone and camera verification completed!");

    // ✅ **Final Verification Summary**
    console.log("📋 Final verification summary:");
    try {
      const finalState = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        let micState = "unknown";
        let cameraState = "unknown";

        for (const btn of buttons) {
          const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
          const text = btn.textContent?.toLowerCase() || "";

          // Check microphone state
          if (
            label.includes("unmute") ||
            (label.includes("turn on") && label.includes("microphone"))
          ) {
            micState = "muted"; // If button says "unmute", mic is muted ✅
          } else if (label.includes("mute") && !label.includes("unmute")) {
            micState = "active"; // If button says "mute", mic is active ❌
          }

          // Check camera state
          if (
            label.includes("turn on") &&
            (label.includes("video") || label.includes("camera"))
          ) {
            cameraState = "disabled"; // If button says "turn on video", camera is disabled ✅
          } else if (
            label.includes("start") &&
            (label.includes("video") || label.includes("camera"))
          ) {
            cameraState = "disabled"; // If button says "start video", camera is disabled ✅
          } else if (
            label.includes("stop") &&
            (label.includes("video") || label.includes("camera"))
          ) {
            cameraState = "active"; // If button says "stop video", camera is active ❌
          } else if (
            label.includes("turn off") &&
            (label.includes("video") || label.includes("camera"))
          ) {
            cameraState = "active"; // If button says "turn off video", camera is active ❌
          }
        }

        return { micState, cameraState };
      });

      console.log(`🎤 Microphone final state: ${finalState.micState}`);
      console.log(`📷 Camera final state: ${finalState.cameraState}`);

      if (
        finalState.micState === "muted" &&
        finalState.cameraState === "disabled"
      ) {
        console.log(
          "✅ SUCCESS: Both microphone and camera are properly disabled!"
        );
      } else {
        console.log(
          "⚠️ WARNING: Some controls may still be active - check manually if needed"
        );
      }
    } catch (summaryError) {
      console.log(
        "⚠️ Could not verify final state:",
        summaryError instanceof Error ? summaryError.message : summaryError
      );
    }

    // ✅ **CRITICAL: Implement Browser-Side Audio Capture System** (only if puppeteer-stream is working)
    if (!state.isUsingSimulatedAudio) {
      console.log("🎧 Starting system audio capture for Zoom meeting...");
    } else {
      console.log(
        "🎧 Skipping Zoom-specific audio capture - fallback system will handle it"
      );
      return; // Skip Zoom-specific audio capture when using fallback
    }

    // ✅ **CRITICAL: Expose handleRealAudioChunk to browser context**
    await page.exposeFunction(
      "handleRealAudioChunk",
      (audioChunk: number[], sampleRate: number = 44100) => {
        console.log(
          `🎵 Received audio chunk from browser: ${audioChunk.length} bytes, sample rate: ${sampleRate} Hz`
        );
        try {
          // Convert back to Uint8Array and send to transcription system with correct sample rate
          const uint8Array = new Uint8Array(audioChunk);
          batchAudioChunk(uint8Array, sampleRate); // FIXED: Pass the actual sample rate from browser
          console.log(
            `✅ Audio chunk sent to transcription system with ${sampleRate} Hz`
          );
        } catch (error) {
          console.log(`❌ Error processing audio chunk:`, error);
        }
      }
    );
    console.log("✅ handleRealAudioChunk function exposed to browser");

    // ✅ **Execute Browser-Side Audio Capture with Promise.race timeout**
    try {
      console.log("🔊 Setting up system audio capture in browser...");

      const systemAudioResult = await Promise.race([
        page.evaluate(() => {
          return new Promise((resolve) => {
            const diagnostics: string[] = [];
            diagnostics.push(
              "🔥 GUARANTEED: Browser-side audio capture script started"
            );

            let realAudioDetected = false;
            let audioChunkCount = 0;

            // Try direct audio element capture first (most reliable for Zoom)
            const audioElements = document.querySelectorAll("audio, video");
            diagnostics.push(
              `📊 MediaStream details: Found ${audioElements.length} audio/video elements`
            );

            if (audioElements.length > 0) {
              diagnostics.push(
                "🔥 GUARANTEED: Found audio/video elements, setting up direct capture"
              );

              try {
                const audioContext = new AudioContext();
                diagnostics.push(
                  `🔊 AudioContext created with sample rate: ${audioContext.sampleRate} Hz`
                );

                audioElements.forEach((element, index) => {
                  try {
                    diagnostics.push(
                      `🔍 TRACK DEBUG: Element ${index}: ${element.tagName}`
                    );

                    let source:
                      | MediaElementAudioSourceNode
                      | MediaStreamAudioSourceNode
                      | null = null;

                    // Handle both srcObject (MediaStream) and src (URL) elements
                    if ((element as any).srcObject) {
                      diagnostics.push(
                        `📈 Audio processing entries: Element ${index} has srcObject (MediaStream)`
                      );
                      source = audioContext.createMediaStreamSource(
                        (element as any).srcObject
                      );
                    } else if ((element as any).src) {
                      diagnostics.push(
                        `📈 Audio processing entries: Element ${index} has src (${
                          (element as any).src
                        })`
                      );
                      source = audioContext.createMediaElementSource(
                        element as HTMLMediaElement
                      );
                    }

                    if (source) {
                      const processor = audioContext.createScriptProcessor(
                        4096,
                        2,
                        2
                      );
                      const gainNode = audioContext.createGain();
                      gainNode.gain.value = 3.0; // Boost gain for better detection

                      processor.onaudioprocess = (event) => {
                        const inputData = event.inputBuffer.getChannelData(0);
                        let sum = 0;
                        for (let i = 0; i < inputData.length; i++) {
                          sum += inputData[i] * inputData[i];
                        }
                        const rms = Math.sqrt(sum / inputData.length);
                        const audioLevel = rms * 100;

                        // Detect significant audio
                        if (audioLevel > 0.005) {
                          if (!realAudioDetected) {
                            console.log(
                              `🎉 FIRST REAL AUDIO DETECTED! Level: ${audioLevel.toFixed(
                                4
                              )}`
                            );
                            realAudioDetected = true;
                          }

                          // Log every 50th chunk for monitoring
                          if (audioChunkCount % 50 === 0) {
                            console.log(
                              `🔊 Audio chunk #${audioChunkCount} - Level: ${audioLevel.toFixed(
                                4
                              )}`
                            );
                          }

                          // Convert to 16-bit PCM for transcription
                          const int16Array = new Int16Array(inputData.length);
                          for (let i = 0; i < inputData.length; i++) {
                            int16Array[i] = Math.max(
                              -32768,
                              Math.min(32767, inputData[i] * 32768)
                            );
                          }

                          // Send to transcription system
                          if ((window as any).handleRealAudioChunk) {
                            (window as any).handleRealAudioChunk(
                              Array.from(new Uint8Array(int16Array.buffer)),
                              audioContext.sampleRate
                            );
                          }

                          audioChunkCount++;
                        }
                      };

                      // Connect audio pipeline
                      console.log(
                        "🔥 GUARANTEED: Connecting audio pipeline..."
                      );
                      source.connect(gainNode);
                      console.log("🔥 GUARANTEED: Source → Gain connected");
                      gainNode.connect(processor);
                      console.log("🔥 GUARANTEED: Gain → Processor connected");
                      processor.connect(audioContext.destination);
                      console.log(
                        "🔥 GUARANTEED: Processor → Destination connected"
                      );

                      diagnostics.push(
                        `✅ Audio capture setup complete for element ${index}`
                      );
                    }
                  } catch (elementError) {
                    diagnostics.push(
                      `❌ Error setting up audio for element ${index}: ${elementError}`
                    );
                  }
                });

                diagnostics.push(
                  "✅ Direct audio element capture setup completed"
                );
              } catch (audioContextError) {
                diagnostics.push(
                  `❌ AudioContext setup failed: ${audioContextError}`
                );
              }
            } else if (
              navigator.mediaDevices &&
              navigator.mediaDevices.getDisplayMedia
            ) {
              // Fallback to getDisplayMedia for system audio
              diagnostics.push(
                "🔄 No audio elements found, trying getDisplayMedia..."
              );

              try {
                navigator.mediaDevices
                  .getDisplayMedia({
                    audio: true,
                    video: false,
                  })
                  .then((stream) => {
                    diagnostics.push("✅ getDisplayMedia stream obtained");

                    const audioContext = new AudioContext();
                    const source = audioContext.createMediaStreamSource(stream);
                    const processor = audioContext.createScriptProcessor(
                      4096,
                      1,
                      1
                    );

                    processor.onaudioprocess = (event) => {
                      const inputData = event.inputBuffer.getChannelData(0);
                      let sum = 0;
                      for (let i = 0; i < inputData.length; i++) {
                        sum += inputData[i] * inputData[i];
                      }
                      const rms = Math.sqrt(sum / inputData.length);
                      const audioLevel = rms * 100;

                      if (audioLevel > 0.005) {
                        if (!realAudioDetected) {
                          console.log(
                            `🎉 SYSTEM AUDIO DETECTED! Level: ${audioLevel.toFixed(
                              4
                            )}`
                          );
                          realAudioDetected = true;
                        }

                        const int16Array = new Int16Array(inputData.length);
                        for (let i = 0; i < inputData.length; i++) {
                          int16Array[i] = Math.max(
                            -32768,
                            Math.min(32767, inputData[i] * 32768)
                          );
                        }

                        if ((window as any).handleRealAudioChunk) {
                          (window as any).handleRealAudioChunk(
                            Array.from(new Uint8Array(int16Array.buffer)),
                            audioContext.sampleRate
                          );
                        }

                        audioChunkCount++;
                      }
                    };

                    source.connect(processor);
                    processor.connect(audioContext.destination);
                  })
                  .catch((error) => {
                    diagnostics.push(`❌ getDisplayMedia failed: ${error}`);
                  });
              } catch (displayMediaError) {
                diagnostics.push(
                  `❌ getDisplayMedia not available: ${displayMediaError}`
                );
              }
            } else {
              diagnostics.push("❌ No audio capture methods available");
            }

            diagnostics.push("🔥 GUARANTEED: Audio capture setup completed");

            // Return diagnostics after brief delay
            setTimeout(() => {
              resolve({
                success: true,
                audioElementsFound: audioElements.length,
                diagnostics: diagnostics,
                realAudioDetected: realAudioDetected,
                audioChunkCount: audioChunkCount,
              });
            }, 2000);
          });
        }),
        // Timeout promise
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Audio setup timeout")), 15000)
        ),
      ]);

      console.log("✅ System audio capture result:", systemAudioResult);

      if (systemAudioResult && typeof systemAudioResult === "object") {
        const result = systemAudioResult as any;
        console.log(
          `📊 Audio setup completed - Elements: ${result.audioElementsFound}, Success: ${result.success}`
        );

        if (result.diagnostics && Array.isArray(result.diagnostics)) {
          result.diagnostics.forEach((diagnostic: string) => {
            console.log(`🔍 Diagnostic: ${diagnostic}`);
          });
        }
      }
    } catch (audioError) {
      console.log("❌ System audio setup error:", audioError);
      console.log("❌ Will continue without real-time audio capture");
    }

    // ✅ ** Anti-Detection Strategy** - Start immediately after joining
    console.log("🕵️ Starting anti-detection measures...");
    await startAntiDetectionBehavior(page);

    console.log(
      "🟡 Zoom joining process completed with system audio capture approach."
    );
  } catch (error) {
    console.log(
      "❌ Error in Zoom joining process:",
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}

// ✅ ** Anti-Detection Behavior System**
async function startAntiDetectionBehavior(page: Page) {
  console.log("🤖 Initializing human-like behavior patterns...");

  // Start multiple behavior patterns simultaneously
  Promise.all([
    simulateHumanMouseActivity(page),
    simulateRealisticScrolling(page),
    simulatePeriodicInteractions(page),
    preventIdleDetection(page),
  ]).catch((error) => {
    console.log(
      "⚠️ Anti-detection behavior error (continuing):",
      error instanceof Error ? error.message : error
    );
  });
}

// 🖱️ **Human-like Mouse Movement Pattern**
async function simulateHumanMouseActivity(page: Page) {
  const randomDelay = (min: number = 3000, max: number = 8000) => {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.random() * (max - min) + min)
    );
  };

  while (state.isBotRunning && !state.isClosing) {
    try {
      await randomDelay(5000, 15000); // Random interval between movements

      if (!state.isBotRunning || state.isClosing) break;

      // Generate realistic mouse coordinates (avoid edges)
      const x = Math.floor(Math.random() * 800) + 200;
      const y = Math.floor(Math.random() * 400) + 200;

      // Smooth mouse movement with human-like curves
      await page.mouse.move(x, y, {
        steps: Math.floor(Math.random() * 5) + 3,
      });

      // Occasionally simulate micro-movements (human fidgeting)
      if (Math.random() < 0.3) {
        await page.mouse.move(
          x + Math.random() * 20 - 10,
          y + Math.random() * 20 - 10,
          { steps: 2 }
        );
      }

      console.log(`🖱️ Human-like mouse movement to (${x}, ${y})`);
    } catch (error) {
      console.log(
        "⚠️ Mouse simulation error:",
        error instanceof Error ? error.message : error
      );
      await randomDelay(10000, 20000); // Wait longer on error
    }
  }
}

// 📜 **Realistic Scrolling Behavior**
async function simulateRealisticScrolling(page: Page) {
  const randomDelay = (min: number = 8000, max: number = 20000) => {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.random() * (max - min) + min)
    );
  };

  while (state.isBotRunning && !state.isClosing) {
    try {
      await randomDelay(10000, 25000);

      if (!state.isBotRunning || state.isClosing) break;

      // Random scroll direction and amount
      const scrollDelta =
        Math.random() < 0.5
          ? -(Math.random() * 200 + 50) // Scroll up
          : Math.random() * 200 + 50; // Scroll down

      await page.mouse.wheel({ deltaY: scrollDelta });

      // Sometimes do multiple small scrolls (reading behavior)
      if (Math.random() < 0.4) {
        await new Promise((resolve) =>
          setTimeout(resolve, 800 + Math.random() * 1200)
        );
        await page.mouse.wheel({ deltaY: scrollDelta * 0.3 });
      }

      console.log(
        `📜 Realistic scroll (${scrollDelta > 0 ? "down" : "up"}: ${Math.abs(
          scrollDelta
        )})`
      );
    } catch (error) {
      console.log(
        "⚠️ Scroll simulation error:",
        error instanceof Error ? error.message : error
      );
      await randomDelay(15000, 30000);
    }
  }
}

// 👆 **Periodic Human-like Interactions**
async function simulatePeriodicInteractions(page: Page) {
  const randomDelay = (min: number = 15000, max: number = 40000) => {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.random() * (max - min) + min)
    );
  };

  while (state.isBotRunning && !state.isClosing) {
    try {
      await randomDelay(20000, 50000); // Longer intervals for interactions

      if (!state.isBotRunning || state.isClosing) break;

      // Randomly choose an interaction type
      const interactions = [
        "hover_participant",
        "brief_focus_change",
        "subtle_click",
        "keyboard_activity",
      ];

      const interaction =
        interactions[Math.floor(Math.random() * interactions.length)];

      switch (interaction) {
        case "hover_participant":
          await simulateParticipantHover(page);
          break;
        case "brief_focus_change":
          await simulateFocusChange(page);
          break;
        case "subtle_click":
          await simulateSubtleClick(page);
          break;
        case "keyboard_activity":
          await simulateKeyboardActivity(page);
          break;
      }

      console.log(`👆 Performed interaction - ${interaction}`);
    } catch (error) {
      console.log(
        "⚠️ Interaction simulation error:",
        error instanceof Error ? error.message : error
      );
      await randomDelay(30000, 60000);
    }
  }
}

// 👥 **Simulate hovering over participant video (natural curiosity)**
async function simulateParticipantHover(page: Page) {
  try {
    const videos = await page.$$("video");
    if (videos.length > 0) {
      const randomVideo = videos[Math.floor(Math.random() * videos.length)];
      const box = await randomVideo.boundingBox();

      if (box) {
        await page.mouse.move(
          box.x + box.width * (0.3 + Math.random() * 0.4),
          box.y + box.height * (0.3 + Math.random() * 0.4),
          { steps: 5 }
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 1500 + Math.random() * 3000)
        );
      }
    }
  } catch (error) {
    console.log("⚠️ Participant hover simulation failed");
  }
}

// 🎯 **Simulate focus changes (natural attention shifts)**
async function simulateFocusChange(page: Page) {
  try {
    // Simulate Alt+Tab or clicking somewhere else briefly
    await page.keyboard.down("Alt");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await page.keyboard.up("Alt");

    // Brief delay to simulate looking away
    await new Promise((resolve) =>
      setTimeout(resolve, 2000 + Math.random() * 3000)
    );
  } catch (error) {
    console.log("⚠️ Focus change simulation failed");
  }
}

// 🖱️ **Subtle clicks on non-interactive areas**
async function simulateSubtleClick(page: Page) {
  try {
    // Click on empty areas that won't trigger actions
    const x = Math.floor(Math.random() * 400) + 300;
    const y = Math.floor(Math.random() * 200) + 200;

    await page.mouse.click(x, y);
    await new Promise((resolve) =>
      setTimeout(resolve, 500 + Math.random() * 1000)
    );
  } catch (error) {
    console.log("⚠️ Subtle click simulation failed");
  }
}

// ⌨️ **Subtle keyboard activity (non-disruptive)**
async function simulateKeyboardActivity(page: Page) {
  try {
    // Simulate keyboard presence without typing visible characters
    await page.keyboard.down("Shift");
    await new Promise((resolve) =>
      setTimeout(resolve, 100 + Math.random() * 200)
    );
    await page.keyboard.up("Shift");
  } catch (error) {
    console.log("⚠️ Keyboard activity simulation failed");
  }
}

// 🚫 **Prevent Idle Detection**
async function preventIdleDetection(page: Page) {
  const randomDelay = (min: number = 25000, max: number = 45000) => {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.random() * (max - min) + min)
    );
  };

  while (state.isBotRunning && !state.isClosing) {
    try {
      await randomDelay(30000, 60000); // Every 30-60 seconds

      if (!state.isBotRunning || state.isClosing) break;

      // Execute anti-idle measures
      await page.evaluate(() => {
        // Simulate user activity at the browser level
        const events = [
          "mousedown",
          "mouseup",
          "mousemove",
          "keydown",
          "keyup",
          "focus",
          "blur",
        ];

        const event = events[Math.floor(Math.random() * events.length)];
        document.dispatchEvent(new Event(event, { bubbles: true }));

        // Reset any idle timers
        if (typeof window !== "undefined") {
          (window as any).lastActivity = Date.now();
        }
      });

      console.log("🚫 Anti-idle measures executed");
    } catch (error) {
      console.log(
        "⚠️ Anti-idle error:",
        error instanceof Error ? error.message : error
      );
      await randomDelay(45000, 90000);
    }
  }
}
