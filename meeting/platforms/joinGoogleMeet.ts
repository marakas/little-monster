import { delay } from "../utils.ts";
import state, { type Page } from "../state.ts";
import { stopAudioProcessing, stopMeetBot } from "../stop_meet_bot.ts";

export async function clickMeetGotIt(page: Page) {
  const TIMEOUT_MS = 8000;
  const POLL_MS = 200;
  const GOT_IT_TEXTS = [
    "got it",
    "ok",
    "okay",
    "understood",
    "close",
    "了解",
    "わかりました",
    "閉じる",
    "確認",
  ];

  const delayMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const tryInContext = async (ctx: any): Promise<boolean> => {
    // 1) Specific MDC "ok" inside Meet dialog
    const specificSel =
      "div.VfPpkd-P5QLlc[role='dialog'] button[data-mdc-dialog-action='ok'], " +
      "div[role='dialog'] button[data-mdc-dialog-action='ok']";
    const btn = await ctx.$?.(specificSel);
    if (btn) {
      try {
        await btn.click({ delay: 15 });
        return true;
      } catch {}
      try {
        await btn.evaluate((el: HTMLElement) => el.click());
        return true;
      } catch {}
    }

    // 2) Any visible button with a "Got it"-like label (multi-locale)
    const clicked = await ctx.evaluate?.((texts: string[]) => {
      const isVisible = (el: Element) => {
        const s = getComputedStyle(el as HTMLElement);
        const r = (el as HTMLElement).getBoundingClientRect();
        return (
          s.visibility !== "hidden" &&
          s.display !== "none" &&
          r.width > 0 &&
          r.height > 0
        );
      };

      const dialogs = Array.from(
        document.querySelectorAll("div[role='dialog']")
      );
      for (const dlg of dialogs) {
        const buttons = Array.from(dlg.querySelectorAll("button"));
        for (const b of buttons) {
          const raw = (b.textContent || "").trim();
          const txt = raw.toLowerCase();
          const spanTxt = (b.querySelector("span")?.textContent || "")
            .trim()
            .toLowerCase();
          if (
            isVisible(b) &&
            (texts.some((t) => txt.includes(t)) ||
              texts.some((t) => spanTxt.includes(t)))
          ) {
            (b as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    }, GOT_IT_TEXTS);

    if (clicked) return true;

    // 3) Enter to activate default dialog button (MDC sets default focus attributes)
    try {
      await page.keyboard?.press?.("Enter");
      await delayMs(50);
    } catch {}
    return false;
  };

  const tryEverywhere = async (): Promise<boolean> => {
    // main document
    if (await tryInContext(page)) return true;

    // iframes (Meet sometimes renders overlays inside frames)
    const frames: any[] =
      typeof page.frames === "function" ? page.frames() : [];
    for (const f of frames) {
      try {
        if (await tryInContext(f)) return true;
      } catch {}
    }
    return false;
  };

  const endAt = Date.now() + TIMEOUT_MS;
  let dismissed = false;

  // Poll until found/dismissed or timeout
  while (Date.now() < endAt && !dismissed) {
    // If no dialog exists anymore, we’re done
    const hasDialog = await page.evaluate(
      () =>
        !!document.querySelector(
          "div[role='dialog'], div.VfPpkd-P5QLlc[role='dialog']"
        )
    );
    if (!hasDialog) break;

    dismissed = await tryEverywhere();
    if (!dismissed) await delayMs(POLL_MS);
  }

  // Verify removal
  const stillThere = await page.evaluate(
    () =>
      !!document.querySelector(
        "div[role='dialog'], div.VfPpkd-P5QLlc[role='dialog']"
      )
  );

  if (!stillThere) {
    console.log("✅ Dismissed Meet modal.");
    state.dismissed = true;
    await delayMs(150);
    return;
  }

  // 🔥 Final fallback: force remove overlay (automation-safe)
  const removed = await page.evaluate(() => {
    let removedAny = false;
    document
      .querySelectorAll(
        "div.VfPpkd-wzTsW, div.VfPpkd-P5QLlc[role='dialog'], div[role='dialog']"
      )
      .forEach((el) => {
        (el as HTMLElement).remove();
        removedAny = true;
      });
    return removedAny;
  });

  if (removed) {
    console.log("🧹 Force-removed Meet modal overlay.");
  } else {
    console.log("⚠️ Could not dismiss Meet modal (no button found).");
  }
}

export async function joinGoogleMeet(page: Page, meetUrl: string) {
  console.log(`🚀 Starting Google Meet join process for: ${meetUrl}`);
  console.log(`🔍 Current page URL: ${page.url()}`);

  async function findCameraBtn(page: Page) {
    const selector =
      'button[jsname="psRWwc"][aria-label*="camera" i],' + // in-call button
      'div[jsname="psRWwc"][role="button"][aria-label*="camera" i]'; // pre-join role=button
    return await page.$(selector);
  }

  async function cameraIsOff(page: Page): Promise<boolean> {
    return await page.evaluate(() => {
      const btn =
        document.querySelector(
          'button[jsname="psRWwc"][aria-label*="camera" i]'
        ) ||
        document.querySelector(
          'div[jsname="psRWwc"][role="button"][aria-label*="camera" i]'
        );
      if (!btn) return false;
      const el = btn as HTMLElement;
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const muted = (el.getAttribute("data-is-muted") || "").toLowerCase();
      // OFF if label says "Turn on camera" (JP: カメラをオン) or data-is-muted="true"
      return (
        aria.includes("turn on camera") ||
        aria.includes("カメラをオン") ||
        muted === "true"
      );
    });
  }

  async function ensureCameraOff(page: Page, logTag = "🎥") {
    try {
      await page.waitForSelector("body", { timeout: 60000 });
    } catch {}
    try {
      await page.mouse.move(300, 300);
    } catch {}
    // If already off, nothing to do
    if (await cameraIsOff(page)) {
      console.log(`${logTag} Camera already OFF`);
      return true;
    }

    const btn = await findCameraBtn(page);
    if (btn) {
      console.log(`${logTag} Toggling camera OFF via UI button…`);
      await btn.click({ delay: 40 });
      // wait until state flips to OFF
      const flipped = await page
        .waitForFunction(
          () => {
            const el =
              document.querySelector(
                'button[jsname="psRWwc"][aria-label*="camera" i]'
              ) ||
              document.querySelector(
                'div[jsname="psRWwc"][role="button"][aria-label*="camera" i]'
              );
            if (!el) return false;
            const aria = (el.getAttribute("aria-label") || "").toLowerCase();
            const muted = (
              el.getAttribute("data-is-muted") || ""
            ).toLowerCase();
            return (
              aria.includes("turn on camera") ||
              aria.includes("カメラをオン") ||
              muted === "true"
            );
          },
          { timeout: 5000 }
        )
        .then(() => true)
        .catch(() => false);

      if (flipped) {
        console.log(`${logTag} ✅ Camera is OFF`);
        return true;
      }

      console.log(`${logTag} Button didn’t flip state—trying shortcut…`);
    } else {
      console.log(`${logTag} Camera button not found—trying shortcut…`);
    }

    // Fallback: Meet shortcut (Ctrl/⌘ + E)
    try {
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyE");
      await page.keyboard.up("Control");
    } catch {}
    try {
      await page.keyboard.down("Meta");
      await page.keyboard.press("KeyE");
      await page.keyboard.up("Meta");
    } catch {}

    const off = await cameraIsOff(page);
    if (off) console.log(`${logTag} ✅ Camera OFF via shortcut`);
    else console.log(`${logTag} ⚠️ Couldn’t confirm camera OFF`);
    return off;
  }

  await ensureCameraOff(page, "🎥 [pre-join]");

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
      await nameInput.type("Design Bot");

      // Verify the name was actually entered
      const enteredName = await nameInput.evaluate(
        (el) => (el as HTMLInputElement).value
      );
      if (enteredName === "Design Bot") {
        console.log(
          `✅ Bot name successfully entered using ${usedSelector}: "${enteredName}"`
        );
      } else {
        console.log(
          `⚠️ Name verification failed. Expected: "Design Bot", Got: "${enteredName}"`
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

  await delay(1500);
  await ensureCameraOff(page, "🎥 [in-call]");

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

  try {
    await clickMeetGotIt(page);
  } catch (e) {
    console.log("⚠️ Failed to dismiss 'Got it' dialog:", e);
  }
}
