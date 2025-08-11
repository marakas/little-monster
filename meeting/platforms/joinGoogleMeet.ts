import { delay } from "../utils.ts";
import state, { type Page } from "../state.ts";
import { stopAudioProcessing, stopMeetBot } from "../stop_meet_bot.ts";

export async function joinGoogleMeet(page: Page, meetUrl: string) {
  console.log(`🚀 Starting Google Meet join process for: ${meetUrl}`);
  console.log(`🔍 Current page URL: ${page.url()}`);

  /*
  try {
    await page.waitForSelector("span[jsname='V67aGc'].mUIrbf-vQzf8d", {
      timeout: 5000,
    });
    await page.click("span[jsname='V67aGc'].mUIrbf-vQzf8d"); // TODO : check if we need to click somethign different to allow mic access
    console.log("Continued without microphone and camera.");
    await delay();
  } catch {
    console.log("No option to continue without mic and camera found.");
  }

  // ✅ Step 1: Handle first-time "Continue without microphone and camera" button
  try {
    await page.waitForSelector("button[jsname='IbE0S']", { timeout: 5000 });
    await page.click("button[jsname='IbE0S']");
    console.log("✅ Clicked 'Continue without microphone and camera' button.");
  } catch {
    console.log(
      "⚠️ No first-time prompt for 'Continue without microphone and camera' found."
    );
  }
  */

  // ✅ Step 2: Skip early microphone muting - will be done after interface loads

  // ✅ Step 3: Explicitly disable camera
  try {
    const cameraButton = await page.$("div[jsname='psRWwc']");
    if (cameraButton) {
      await cameraButton.click();
      console.log("✅ Camera disabled.");
      await delay();
    } else {
      console.warn("⚠️ Camera disable button not found.");
    }
  } catch (error) {
    console.error(
      "❌ Error disabling camera:",
      error instanceof Error ? error.message : error
    );
  }

  try {
    await page.waitForSelector("button[data-mdc-dialog-action='accept']", {
      timeout: 5000,
    });
    await page.click("button[data-mdc-dialog-action='accept']");
    console.log("Accepted cookies.");
    await delay();
  } catch {
    console.log("No cookies popup found.");
  }

  try {
    await page.waitForSelector("button[jsname='EszDEe']", { timeout: 5000 });
    await page.click("button[jsname='EszDEe']");
    console.log("Clicked 'Got it' button.");
    await delay();
  } catch {
    console.log("No 'Got it' button found.");
  }

  try {
    await page.waitForSelector("button.VfPpkd-LgbsSe", { timeout: 5000 });
    await page.click("button.VfPpkd-LgbsSe");
    console.log("Clicked sign-in dismiss button.");
    await delay();
  } catch {
    console.log("No Google sign-in popup found.");
  }

  // ✅ **MICROPHONE MUTING** - Simple approach without popup dismissal
  /*
  console.log(
    "🎤 Now checking microphone state and muting if necessary (after interface load)..."
  );
  const micSelectors = [
    // ✅ **EXACT SELECTORS FROM USER'S HTML** (highest priority)
    "div[jsname='hw0c9'][aria-label*='Turn off microphone']", // EXACT match from user's inspect
    "div[jsname='hw0c9'][aria-label*='Turn on microphone']", // Muted state version
    "div[jsname='hw0c9'][data-is-muted='false']", // Using data attribute
    "div[jsname='hw0c9'][data-is-muted='true']", // Muted state
    "div[jsname='hw0c9']", // Original selector (broader)

    // ✅ **ACTUAL MIC CONTROL SELECTORS** (prioritized)
    "div[aria-label*='Turn off microphone']", // "Turn off microphone" div (mic ON)
    "div[aria-label*='Turn on microphone']", // "Turn on microphone" div (mic OFF)
    "button[aria-label*='Turn off microphone']", // "Turn off microphone" button (mic ON)
    "button[aria-label*='Turn on microphone']", // "Turn on microphone" button (mic OFF)
  ];

  let micMutedAfterLoad = false;
  for (const selector of micSelectors) {
    try {
      const micButton = await page.$(selector);
      if (micButton) {
        console.log(`🔍 Found microphone button with selector: ${selector}`);

        // Get button state
        const buttonState = await page.evaluate((el: Element) => {
          const element = el as HTMLElement;
          return {
            ariaPressed: element.getAttribute("aria-pressed"),
            ariaLabel: element.getAttribute("aria-label"),
            className: element.className,
            title: element.title,
            textContent: element.textContent?.trim(),
            disabled: element.hasAttribute("disabled"),
            innerHTML: element.innerHTML,
          };
        }, micButton);

        console.log(
          `📊 Microphone button state:`,
          JSON.stringify(buttonState, null, 2)
        );

        // ✅ **INTELLIGENT DEVICE PROBLEM FILTERING**
        // Skip device problem buttons UNLESS they have correct structural indicators
        const hasDeviceProblemText =
          buttonState.ariaLabel?.toLowerCase().includes("problem") ||
          buttonState.ariaLabel?.toLowerCase().includes("show more info") ||
          buttonState.ariaLabel?.toLowerCase().includes("error") ||
          buttonState.ariaLabel?.toLowerCase().includes("not found");

        const hasValidMicStructure =
          selector.includes("jsname='hw0c9'") || // Has correct jsname
          selector.includes("data-is-muted") || // Has mute data attribute
          buttonState.ariaLabel?.toLowerCase().includes("microphone"); // Clearly mic-related

        if (hasDeviceProblemText && !hasValidMicStructure) {
          console.log(
            `⚠️ Skipping device problem button: "${buttonState.ariaLabel}" - not a mic control`
          );
          continue; // Skip this button and try next selector
        } else if (hasDeviceProblemText && hasValidMicStructure) {
          console.log(
            `🔧 Docker environment: Found mic control with device problem label - will attempt to use it`
          );
          console.log(`   → Selector: ${selector}`);
          console.log(`   → Label: "${buttonState.ariaLabel}"`);
        }

        // ✅ **ENHANCED MICROPHONE STATE DETECTION**
        // Check data-is-muted attribute first (most reliable)
        const dataMuted = await page.evaluate((el: Element) => {
          return (el as HTMLElement).getAttribute("data-is-muted");
        }, micButton);

        console.log(`🔍 data-is-muted attribute: "${dataMuted}"`);

        // Determine if microphone is currently ON (unmuted)
        // Priority 1: data-is-muted="false" means mic is ON (even with device problem label)
        // Priority 2: aria-label analysis
        const isMicOn =
          dataMuted === "false" || // Most reliable indicator (works even with "problem" labels)
          buttonState.ariaPressed === "false" ||
          buttonState.ariaLabel
            ?.toLowerCase()
            .includes("turn off microphone") || // EXACT match from user's HTML
          buttonState.ariaLabel?.toLowerCase().includes("mute microphone") ||
          buttonState.ariaLabel?.toLowerCase().includes("disable microphone") ||
          (buttonState.ariaLabel?.toLowerCase().includes("mute") &&
            !buttonState.ariaLabel?.toLowerCase().includes("unmute")) ||
          buttonState.className?.includes("mic-on") ||
          buttonState.className?.includes("enabled") ||
          buttonState.title?.toLowerCase().includes("mute microphone") ||
          buttonState.title?.toLowerCase().includes("turn off microphone");

        console.log(
          `🔍 Microphone analysis: ariaLabel="${buttonState.ariaLabel}", ariaPressed="${buttonState.ariaPressed}", isMicOn=${isMicOn}`
        );

        if (isMicOn) {
          const isDeviceProblemButton = buttonState.ariaLabel
            ?.toLowerCase()
            .includes("problem");
          if (isDeviceProblemButton) {
            console.log(
              "🔧 Docker environment: Using device problem button as mic control"
            );
            console.log(
              `   → Reason: data-is-muted="${dataMuted}" indicates mic is ON`
            );
          }
          console.log("🎤 Microphone is ON, muting NOW...");
          await micButton.click();
          await delay(1000);
          console.log("✅ Microphone muted successfully.");
          micMutedAfterLoad = true;
          break;
        } else {
          console.log("🎤 Microphone is already muted.");
          micMutedAfterLoad = true;
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

  if (!micMutedAfterLoad) {
    console.log(
      "⚠️ Could not locate or mute microphone - mic may be muted by default or use different selectors"
    );
  }

  */

  // ✅ Note: Name entry is handled in the main section below with better validation

  // ✅ **JOIN BUTTON** - Click "Ask to join"
  console.log('🚪 Looking for "Ask to join" button...');
  const joinButtonSelectors = [
    'span[jsname="V67aGc"].UywwFc-vQzf8d',
    'div[role="button"][aria-label*="Ask to join"]',
    'button[aria-label*="Ask to join"]',
  ];

  let joinButtonClicked = false;
  for (const selector of joinButtonSelectors) {
    try {
      const joinButton = await page.$(selector);
      if (joinButton) {
        console.log(`✅ Found 'Ask to join' button with selector: ${selector}`);
        await joinButton.click();
        console.log(
          `✅ Successfully clicked 'Ask to join' button using ${selector}`
        );
        joinButtonClicked = true;
        break;
      }
    } catch (error) {
      console.log(
        `⚠️ Error with join button selector ${selector}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (!joinButtonClicked) {
    console.log('❌ Failed to find or click "Ask to join" button');
  }

  // ✅ **POST-JOIN MICROPHONE VERIFICATION & MUTING** (Safety net)
  /*
  console.log(
    "🎤 Verifying and muting microphone after joining meeting (safety net)..."
  );
  await delay(3000); // Wait for meeting UI to stabilize

  // Use the same intelligent filtering logic for post-join muting
  for (const selector of micSelectors) {
    try {
      const micButton = await page.$(selector);
      if (micButton) {
        console.log(
          `🔍 Found post-join microphone button with selector: ${selector}`
        );

        const buttonState = await page.evaluate((el: Element) => {
          const element = el as HTMLElement;
          return {
            ariaLabel: element.getAttribute("aria-label"),
            dataMuted: element.getAttribute("data-is-muted"),
          };
        }, micButton);

        // Apply same intelligent filtering for post-join
        const hasDeviceProblemText =
          buttonState.ariaLabel?.toLowerCase().includes("problem") ||
          buttonState.ariaLabel?.toLowerCase().includes("show more info") ||
          buttonState.ariaLabel?.toLowerCase().includes("error") ||
          buttonState.ariaLabel?.toLowerCase().includes("not found");

        const hasValidMicStructure =
          selector.includes("jsname='hw0c9'") ||
          selector.includes("data-is-muted") ||
          buttonState.ariaLabel?.toLowerCase().includes("microphone");

        if (hasDeviceProblemText && !hasValidMicStructure) {
          console.log(
            `⚠️ Skipping post-join device problem button: "${buttonState.ariaLabel}"`
          );
          continue;
        }

        // Check if mic is on and mute it
        const isMicOn =
          buttonState.dataMuted === "false" ||
          buttonState.ariaLabel
            ?.toLowerCase()
            .includes("turn off microphone") ||
          buttonState.ariaLabel?.toLowerCase().includes("mute microphone");

        if (isMicOn) {
          console.log(
            "🎤 Post-join: Microphone is ON, muting as safety net..."
          );
          await micButton.click();
          await delay(1000);
          console.log("✅ Post-join microphone muting successful");
          break;
        } else {
          console.log("✅ Post-join verification: Microphone is already muted");
          break;
        }
      }
    } catch (error) {
      console.log(
        `⚠️ Error checking post-join microphone with selector ${selector}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  
  */

  // ✅ **Enter bot name with better selector and validation**
  try {
    // Try multiple selectors for the name input field
    const nameSelectors = [
      'input[aria-label*="name"]', // Most specific
      'input[placeholder*="name"]', // Common pattern
      'input[data-promo-anchor-id="displayName"]', // Google Meet specific
      'input[jsname="YPqjbf"]', // Google Meet jsname
      'input[type="text"]', // Fallback
    ];

    let nameInput = null;
    let usedSelector = "";

    for (const selector of nameSelectors) {
      try {
        nameInput = await page.$(selector);
        if (nameInput) {
          usedSelector = selector;
          console.log(`✅ Found name input with selector: ${selector}`);
          break;
        }
      } catch (error) {
        console.log(
          `⚠️ Selector ${selector} failed:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (nameInput) {
      // Clear any existing text first - use multiple methods for reliability
      await nameInput.evaluate((el) => {
        (el as HTMLInputElement).value = "";
      }); // Direct clear
      await nameInput.click({ clickCount: 3 }); // Select all (in case evaluate didn't trigger events)
      await nameInput.press("Backspace"); // Delete any remaining text
      await delay(200); // Brief pause for UI to update
      await nameInput.type("Pulse Companion");

      // Verify the name was actually entered
      const enteredName = await nameInput.evaluate(
        (el) => (el as HTMLInputElement).value
      );
      if (enteredName === "Pulse Companion") {
        console.log(
          `✅ Bot name successfully entered using ${usedSelector}: "${enteredName}"`
        );
      } else {
        console.log(
          `⚠️ Name verification failed. Expected: "Pulse Companion", Got: "${enteredName}"`
        );
      }

      await delay(1000);
    } else {
      console.log("❌ Name input field not found with any selector!");

      // Debug: Log all input elements
      const allInputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("input")).map((input) => ({
          type: input.type,
          placeholder: input.placeholder,
          ariaLabel: input.getAttribute("aria-label"),
          className: input.className,
          jsname: input.getAttribute("jsname"),
        }));
      });
      console.log(
        "🔍 All input elements found:",
        JSON.stringify(allInputs, null, 2)
      );
    }
  } catch (error) {
    console.error(
      "❌ Error entering bot name:",
      error instanceof Error ? error.message : error
    );
  }

  // ✅ **Click "Ask to join" button with better validation**

  // ✅ **INVESTIGATE: Join button accessibility despite modal**
  const joinButtonInvestigation = await page.evaluate(() => {
    const modal = document.querySelector(
      '[role="dialog"], .modal, [data-mdc-dialog-surface]'
    );
    const joinButton = document.querySelector(
      'span[jsname="V67aGc"].UywwFc-vQzf8d, button[jsname="Qx7uuf"]'
    );

    if (modal && joinButton) {
      const modalRect = modal.getBoundingClientRect();
      const buttonRect = joinButton.getBoundingClientRect();
      const modalStyle = window.getComputedStyle(modal);
      const buttonStyle = window.getComputedStyle(joinButton);

      return {
        modalOverlapsButton: !(
          modalRect.right < buttonRect.left ||
          modalRect.left > buttonRect.right ||
          modalRect.bottom < buttonRect.top ||
          modalRect.top > buttonRect.bottom
        ),
        modalZIndex: modalStyle.zIndex,
        buttonZIndex: buttonStyle.zIndex,
        modalPointerEvents: modalStyle.pointerEvents,
        buttonPointerEvents: buttonStyle.pointerEvents,
        buttonVisibility: buttonStyle.visibility,
        buttonDisplay: buttonStyle.display,
      };
    }
    return { noModalOrButton: true };
  });

  console.log("🔍 JOIN BUTTON vs MODAL INVESTIGATION:");
  console.log(JSON.stringify(joinButtonInvestigation, null, 2));

  try {
    // Try multiple selectors for the Ask to join button
    const joinButtonSelectors = [
      "span[jsname='V67aGc'].UywwFc-vQzf8d", // Original selector
      "button[jsname='Qx7uuf']", // Alternative Google Meet button
      "div[role='button'][jsname='Qx7uuf']", // Sometimes it's a div
      "[data-idom-class*='join']", // General join button
      "span[jsname='V67aGc']", // Simplified jsname selector
      "button[aria-label*='join']", // Aria label based
    ];

    let joinButton = null;
    let usedSelector = "";

    for (const selector of joinButtonSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        joinButton = await page.$(selector);
        if (joinButton) {
          usedSelector = selector;
          console.log(
            `✅ Found 'Ask to join' button with selector: ${selector}`
          );
          break;
        }
      } catch (error) {
        console.log(
          `⚠️ Join button selector ${selector} failed:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    // If no button found with selectors, try text-based search
    if (!joinButton) {
      console.log("🔍 Attempting text-based search for join button...");
      try {
        const textButtons = await page.$$eval("*", (elements) => {
          return elements
            .map((el, index) => {
              const text = el.textContent?.toLowerCase().trim();
              if (
                text === "ask to join" ||
                text === "join" ||
                text === "request to join"
              ) {
                el.setAttribute("data-found-by-text", String(index));
                return index;
              }
              return -1;
            })
            .filter((i) => i >= 0);
        });

        if (textButtons.length > 0) {
          joinButton = await page.$(`[data-found-by-text="${textButtons[0]}"]`);
          if (joinButton) {
            usedSelector = "text-based search";
            console.log("✅ Found join button via text-based search");
          }
        }
      } catch (error) {
        console.log(
          "⚠️ Text-based search failed:",
          error instanceof Error ? error.message : error
        );
      }
    }

    if (joinButton) {
      // Ensure the button is visible and clickable
      const isVisible = await joinButton.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          window.getComputedStyle(el).visibility !== "hidden"
        );
      });

      if (isVisible) {
        await joinButton.click();
        console.log(
          `✅ Successfully clicked 'Ask to join' button using ${usedSelector}`
        );

        // ✅ **ENHANCED JOIN VERIFICATION**
        await delay(2000);

        // Multiple verification checks
        const joinVerification = await page.evaluate((selector) => {
          const button = document.querySelector(selector);
          const buttonExists = !!button;
          const buttonVisible = button
            ? button.getBoundingClientRect().width > 0
            : false;
          const buttonText = button ? button.textContent?.trim() : "";

          // Check for waiting/joined indicators
          const bodyText = document.body.innerText.toLowerCase();
          const hasWaitingText =
            bodyText.includes("asking to join") ||
            bodyText.includes("waiting for the host") ||
            bodyText.includes("waiting to be admitted");
          const hasJoinedText =
            bodyText.includes("you joined") ||
            bodyText.includes("joined the meeting");

          return {
            buttonExists,
            buttonVisible,
            buttonText,
            hasWaitingText,
            hasJoinedText,
            bodySnippet: bodyText.substring(0, 300),
          };
        }, usedSelector);

        console.log("🔍 Join verification results:");
        console.log(`   Button exists: ${joinVerification.buttonExists}`);
        console.log(`   Button visible: ${joinVerification.buttonVisible}`);
        console.log(`   Has waiting text: ${joinVerification.hasWaitingText}`);
        console.log(`   Has joined text: ${joinVerification.hasJoinedText}`);

        if (joinVerification.buttonExists && joinVerification.buttonVisible) {
          console.log(
            "⚠️ 'Ask to join' button still present - attempting additional clicks..."
          );

          // Try multiple click methods
          for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`🔄 Additional click attempt ${attempt}/3...`);

            try {
              // Method 1: Direct click
              await page.click(usedSelector);
              await delay(500);

              // Method 2: Force click via evaluate
              await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) {
                  (btn as HTMLElement).click();
                  console.log("Forced click executed");
                }
              }, usedSelector);
              await delay(500);

              // Method 3: Click all join-like buttons
              await page.evaluate(() => {
                const joinTexts = ["ask to join", "join", "enter"];
                const allButtons = document.querySelectorAll(
                  'button, [role="button"], span[jsname], div[jsname]'
                );

                for (const btn of Array.from(allButtons)) {
                  const text = btn.textContent?.toLowerCase().trim() || "";
                  if (joinTexts.some((jt) => text.includes(jt))) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                      (btn as HTMLElement).click();
                    }
                  }
                }
              });
              await delay(1000);

              // Check if successful
              const stillVisible = await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                return btn && btn.getBoundingClientRect().width > 0;
              }, usedSelector);

              if (!stillVisible) {
                console.log(`✅ Button disappeared after attempt ${attempt}`);
                break;
              }
            } catch (error) {
              console.log(`⚠️ Click attempt ${attempt} failed:`, error);
            }
          }
        } else if (joinVerification.hasWaitingText) {
          console.log("✅ Join successful - bot is waiting to be admitted");
        } else if (joinVerification.hasJoinedText) {
          console.log("✅ Join successful - bot has entered the meeting");
        } else {
          console.log(
            "✅ Join request appears successful - 'Ask to join' button is gone"
          );
        }
      } else {
        console.log("❌ 'Ask to join' button found but not visible/clickable");
      }
    } else {
      console.log("❌ 'Ask to join' button not found with any selector!");

      // Debug: Log all clickable elements
      const allButtons = await page.evaluate(() => {
        return Array.from(
          document.querySelectorAll(
            'button, [role="button"], span[jsname], div[jsname]'
          )
        )
          .map((el) => ({
            tagName: el.tagName,
            textContent: el.textContent?.trim().substring(0, 50),
            className: el.className,
            jsname: el.getAttribute("jsname"),
            role: el.getAttribute("role"),
          }))
          .filter((el) => el.textContent && el.textContent.length > 0);
      });
      console.log(
        "🔍 All potential buttons found:",
        JSON.stringify(allButtons.slice(0, 10), null, 2)
      );

      await stopMeetBot();
      throw new Error("'Ask to join' button not found");
    }
  } catch (error) {
    console.error(
      "❌ Error clicking 'Ask to join' button:",
      error instanceof Error ? error.message : error
    );
    await stopMeetBot();
    throw error;
  }

  //await delay(10000); // Wait for meeting acceptance

  // ✅ **POST-JOIN MICROPHONE VERIFICATION & MUTING** (Safety net)
  /* console.log(
    "🎤 Verifying and muting microphone after joining meeting (safety net)..."
  );
  await delay(3000); // Wait for meeting UI to stabilize
 */
  const postJoinMicSelectors = [
    // ✅ **EXACT SELECTORS FROM USER'S HTML** (highest priority)
    "div[jsname='hw0c9'][aria-label*='Turn off microphone']", // EXACT match from user's inspect
    "div[jsname='hw0c9'][aria-label*='Turn on microphone']", // Muted state version
    "div[jsname='hw0c9'][data-is-muted='false']", // Using data attribute (mic ON)
    "div[jsname='hw0c9'][data-is-muted='true']", // Using data attribute (mic OFF)
    "div[jsname='hw0c9']", // Broader fallback

    // ✅ **STANDARD POST-JOIN SELECTORS**
    "button[aria-label*='Unmute']", // If button says "Unmute", mic is muted ✅
    "button[aria-label*='Turn on microphone']", // If says "Turn on", mic is off ✅
    "button[aria-label*='Mute']", // If says "Mute", mic is on ❌
    "button[aria-label*='Turn off microphone']", // If says "Turn off", mic is on ❌
    "div[aria-label*='Turn off microphone']", // Div version
    "div[aria-label*='Turn on microphone']", // Div version
    "div[aria-label*='Unmute']", // Div unmute
    "div[aria-label*='Mute microphone']", // Div mute
    "[role='button'][aria-label*='Turn off microphone']", // Role-based
    "[role='button'][aria-label*='Turn on microphone']", // Role-based
    "button[data-tooltip*='Unmute']", // Tooltip-based
    "button[title*='Unmute']", // Title-based
    "button[jsname='BOHaEe']", // Alternative selector
  ];

  let postJoinMicMuted = false;
  for (const selector of postJoinMicSelectors) {
    try {
      const micButton = await page.$(selector);
      if (micButton) {
        /*  console.log(
          `🔍 Found post-join microphone button with selector: ${selector}`
        ); */

        const buttonState = await page.evaluate((el: Element) => {
          const element = el as HTMLElement;
          return {
            ariaPressed: element.getAttribute("aria-pressed"),
            ariaLabel: element.getAttribute("aria-label"),
            className: element.className,
            title: element.title,
            textContent: element.textContent?.trim(),
            dataMuted: element.getAttribute("data-is-muted"),
            dataTooltip: element.getAttribute("data-tooltip"),
            jsname: element.getAttribute("jsname"),
          };
        }, micButton);

        /* console.log(
          `📊 Post-join microphone button state:`,
          JSON.stringify(buttonState, null, 2)
        );
 */
        // ✅ **INTELLIGENT DEVICE PROBLEM FILTERING** in post-join too
        const hasDeviceProblemText =
          buttonState.ariaLabel?.toLowerCase().includes("problem") ||
          buttonState.ariaLabel?.toLowerCase().includes("show more info") ||
          buttonState.ariaLabel?.toLowerCase().includes("error") ||
          buttonState.ariaLabel?.toLowerCase().includes("not found");

        const hasValidMicStructure =
          selector.includes("jsname='hw0c9'") || // Has correct jsname
          selector.includes("data-is-muted") || // Has mute data attribute
          buttonState.ariaLabel?.toLowerCase().includes("microphone"); // Clearly mic-related

        if (hasDeviceProblemText && !hasValidMicStructure) {
          /*  console.log(
            `⚠️ Skipping post-join device problem button: "${buttonState.ariaLabel}" - not a mic control`
          ); */
          continue;
        } else if (hasDeviceProblemText && hasValidMicStructure) {
          /* console.log(
            `🔧 Post-join Docker environment: Found mic control with device problem label - will attempt to use it`
          );
          console.log(`   → Selector: ${selector}`);
          consol e.log(`   → Label: "${buttonState.ariaLabel}"`);
          */
        }

        // Check data-is-muted attribute first (most reliable)
        const dataMuted = buttonState.dataMuted;
        console.log(`🔍 Post-join data-is-muted attribute: "${dataMuted}"`);

        // Microphone is MUTED if:
        // - data-is-muted="true" (most reliable)
        // - aria-pressed="true" (pressed = muted)
        // - aria-label contains "Unmute" or "Turn on microphone"
        const isMicMuted =
          dataMuted === "true" ||
          buttonState.ariaPressed === "true" ||
          buttonState.ariaLabel?.toLowerCase().includes("unmute") ||
          buttonState.ariaLabel?.toLowerCase().includes("turn on microphone") ||
          buttonState.ariaLabel?.toLowerCase().includes("enable microphone") ||
          buttonState.className?.includes("muted") ||
          buttonState.className?.includes("mic-off") ||
          buttonState.title?.toLowerCase().includes("unmute");

        // Microphone is ON if:
        // - data-is-muted="false" (most reliable)
        // - aria-pressed="false" (not pressed = not muted)
        // - aria-label contains "Mute" or "Turn off microphone"
        const isMicOn =
          dataMuted === "false" ||
          buttonState.ariaPressed === "false" ||
          buttonState.ariaLabel
            ?.toLowerCase()
            .includes("turn off microphone") ||
          buttonState.ariaLabel?.toLowerCase().includes("mute microphone") ||
          (buttonState.ariaLabel?.toLowerCase().includes("mute") &&
            !buttonState.ariaLabel?.toLowerCase().includes("unmute"));

        console.log(
          `🔍 Post-join microphone analysis: isMuted=${isMicMuted}, isOn=${isMicOn}`
        );

        if (isMicMuted) {
          //  console.log("✅ Microphone is properly muted in meeting.");
          postJoinMicMuted = true;
          break;
        } else if (isMicOn) {
          //console.log("⚠️ Microphone is ON in meeting, muting now...");
          //await micButton.click();
          //await delay(1000);
          //console.log("✅ Microphone muted in meeting.");
          postJoinMicMuted = true;
          break;
        }
      }
    } catch (error) {
      console.log(
        `⚠️ Error with post-join mic selector ${selector}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (!postJoinMicMuted) {
    console.log(
      "⚠️ Could not verify microphone state after joining - attempting post-join fallback..."
    );

    try {
      const postJoinFallbackResult = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll(
            'button, div[role="button"], div[jscontroller], div[jsname]'
          )
        );
        for (const btn of buttons) {
          const element = btn as HTMLElement;
          const label = element.getAttribute("aria-label")?.toLowerCase() || "";
          const title = element.title?.toLowerCase() || "";
          const dataMuted = element.getAttribute("data-is-muted");
          const jsname = element.getAttribute("jsname");

          // Skip device problem buttons
          if (
            label.includes("problem") ||
            label.includes("show more info") ||
            label.includes("error") ||
            label.includes("not found")
          ) {
            continue;
          }

          // Priority 1: Check data-is-muted="false" (mic is ON, needs muting)
          if (
            dataMuted === "false" ||
            label.includes("turn off microphone") ||
            title.includes("turn off microphone") ||
            (label.includes("mute microphone") && !label.includes("unmute")) ||
            (jsname === "hw0c9" && dataMuted === "false")
          ) {
            console.log("Found post-join fallback mic button:", {
              label: element.getAttribute("aria-label"),
              title: element.title,
              dataMuted,
              jsname,
              reason:
                dataMuted === "false"
                  ? "data-is-muted=false"
                  : "aria-label match",
            });
            element.click();
            return {
              success: true,
              method: "post-join-fallback",
              label,
              dataMuted,
              jsname,
            };
          }
        }
        return { success: false };
      });

      if (postJoinFallbackResult.success) {
        console.log(
          "✅ Post-join fallback microphone mute successful:",
          postJoinFallbackResult
        );
        postJoinMicMuted = true;
      } else {
        console.log(
          "ℹ️ No post-join mute actions needed - microphone may already be properly muted"
        );
      }
    } catch (finalError) {
      console.log(
        "⚠️ Post-join fallback mute attempt failed:",
        finalError instanceof Error ? finalError.message : finalError
      );
    }
  }

  // ✅ Handle "This Video call is being recorded" modal
  try {
    await page.waitForSelector("span[jsname='V67aGc']", { timeout: 5000 });
    const joinNowButtons = await page.$$("span[jsname='V67aGc']");

    for (const button of joinNowButtons) {
      const text = await page.evaluate((el: Element) => el.textContent, button);
      if (text && (text.includes("Join now") || text.includes("Join Now"))) {
        await button.click();
        console.log("✅ Clicked 'Join Now' in recording consent modal.");
        await delay(2000);
        break;
      }
    }
  } catch {
    console.log(
      "⚠️ No recording consent modal found (meeting may not be recorded)."
    );
  }
}
