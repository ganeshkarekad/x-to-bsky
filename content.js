let isAuthenticated = false;
let currentTweetElement = null;

chrome.runtime.sendMessage({ action: 'checkAuth' }, (response) => {
  if (response) {
    isAuthenticated = response.authenticated;
  }
});

function injectBlueskyOption() {
  try {
    console.log('Starting Bluesky option injection...');
    
    // Track clicks on "More" buttons to know which tweet is active
    document.addEventListener('click', (e) => {
      try {
        const moreButton = e.target.closest('[aria-label*="More"], [data-testid="caret"], [aria-haspopup="menu"]');
        if (moreButton) {
          // Find the parent tweet
          const tweet = moreButton.closest('article');
          if (tweet) {
            currentTweetElement = tweet;
            console.log('Tracked tweet for dropdown:', tweet);
          }
        }
      } catch (err) {
        console.error('Error in click handler:', err);
      }
    }, true);

    // Set up observer to watch for dropdown menus and compose areas
    const observer = new MutationObserver((mutations) => {
      try {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            // Process any newly added nodes that might be dropdown menus
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === 1) { // Element node
                try {
                  processDropdownMenu(node);
                  // Also check children
                  const dropdowns = node.querySelectorAll('[role="menu"]');
                  dropdowns.forEach(dropdown => processDropdownMenu(dropdown));
                  
                  // Check for compose tweet areas
                  processComposeTweetAreas(node);
                } catch (err) {
                  console.error('Error processing node:', err);
                }
              }
            });
            
            // Also check for compose tweet areas in existing DOM
            processComposeTweetAreas(document);
            
            // Re-check existing processed areas in case they changed from regular to reply
            recheckProcessedAreas();
          }
        });
      } catch (err) {
        console.error('Error in MutationObserver:', err);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    
    // Initial processing with a small delay to ensure DOM is ready
    console.log('Scheduling initial processComposeTweetAreas...');
    setTimeout(() => {
      console.log('Running initial processComposeTweetAreas...');
      processComposeTweetAreas(document);
      console.log('Initial processing complete');
    }, 1000);
    
  } catch (error) {
    console.error('Error in injectBlueskyOption:', error);
  }
}

function processDropdownMenu(menuElement) {
  try {
    // Check if this is a dropdown menu and hasn't been processed
    if (menuElement.getAttribute('role') === 'menu' && !menuElement.querySelector('.bluesky-repost-option')) {
      console.log('Processing dropdown menu:', menuElement);
      
      // Look for menu items in the dropdown
      const menuItems = menuElement.querySelectorAll('[role="menuitem"]');
      
      if (menuItems.length > 0) {
        // Find the last menu item to insert after
        const lastMenuItem = menuItems[menuItems.length - 1];
        const blueskyOption = createBlueskyMenuItem(lastMenuItem);
        
        if (blueskyOption) {
          // Insert the Bluesky option
          lastMenuItem.parentNode.insertBefore(blueskyOption, lastMenuItem.nextSibling);
          console.log('Injected Bluesky option into dropdown');
        }
      }
    }
  } catch (error) {
    console.error('Error in processDropdownMenu:', error);
  }
}

function createBlueskyMenuItem(referenceMenuItem) {
  // Clone the structure of an existing menu item
  const option = document.createElement('div');
  option.className = referenceMenuItem.className + ' bluesky-repost-option';
  option.setAttribute('role', 'menuitem');
  option.setAttribute('tabindex', '0');
  
  // Get the computed styles of the reference item
  const refStyles = window.getComputedStyle(referenceMenuItem);
  
  // Create the menu item with Bluesky branding
  option.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: flex-start; padding: 15px 20px; cursor: pointer; font-family: ${refStyles.fontFamily}; font-size: ${refStyles.fontSize}; width: 100%;">
      <div style="margin-right: 12px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        <span style="font-size: 18px;">🦋</span>
      </div>
      <span style="color: inherit; text-align: left;">Repost to Bluesky</span>
    </div>
  `;

  // Add hover effect
  option.addEventListener('mouseenter', () => {
    option.style.backgroundColor = 'rgba(0, 168, 255, 0.1)';
  });

  option.addEventListener('mouseleave', () => {
    option.style.backgroundColor = 'transparent';
  });

  option.addEventListener('click', async (e) => {
    console.log('Bluesky option clicked!');
    e.preventDefault();
    e.stopPropagation();
    
    try {
      // Use the tracked tweet element
      if (currentTweetElement) {
        console.log('Using tracked tweet:', currentTweetElement);
        
        // Close the dropdown by clicking outside
        document.body.click();
        
        // Small delay to let dropdown close
        setTimeout(async () => {
          try {
            await handleRepostToBluesky(currentTweetElement);
          } catch (err) {
            console.error('Error handling repost:', err);
            showNotification('Failed to repost: ' + err.message, 'error');
          }
        }, 100);
      } else {
        console.error('No tweet element found');
        showNotification('Could not identify the tweet. Please try again.', 'error');
      }
    } catch (error) {
      console.error('Error in Bluesky option click:', error);
      showNotification('An error occurred. Please try again.', 'error');
    }
  });

  return option;
}

function processComposeTweetAreas(container) {
  try {
    // Find compose tweet areas that haven't been processed
    const composeAreas = container.querySelectorAll('[data-testid="toolBar"]:not(.bluesky-dual-processed)');
    
    console.log('Found', composeAreas.length, 'unprocessed compose areas');
    
    composeAreas.forEach(toolbar => {
      try {
        // Check if this is actually a compose toolbar (has a Post button)
        const postButton = toolbar.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
        if (postButton) {
          console.log('Found post button with text:', postButton.textContent);
          
          // Check if this is a reply
          const isReply = isReplyCompose(toolbar);
          console.log('Is reply?', isReply);
          
          if (isReply) {
            console.log('Skipping dual post button for reply compose');
            toolbar.classList.add('bluesky-dual-processed');
            // Remove existing button if it exists
            const existingButton = toolbar.querySelector('.bluesky-dual-post-button');
            if (existingButton) {
              existingButton.remove();
            }
          } else if (!toolbar.querySelector('.bluesky-dual-post-button')) {
            console.log('Adding dual post button to normal compose');
            addDualPostButton(toolbar, postButton);
            toolbar.classList.add('bluesky-dual-processed');
          } else {
            console.log('Dual post button already exists');
            toolbar.classList.add('bluesky-dual-processed');
          }
        } else {
          console.log('No post button found in toolbar');
        }
      } catch (err) {
        console.error('Error processing toolbar:', err);
      }
    });
  } catch (error) {
    console.error('Error in processComposeTweetAreas:', error);
  }
}

function isReplyCompose(toolbar) {
  // Strategy 1: Check if the post button says "Reply" instead of "Post"
  const postButton = toolbar.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
  if (postButton && postButton.textContent) {
    const buttonText = postButton.textContent.toLowerCase();
    console.log('Post button text:', buttonText);
    if (buttonText === 'reply' || buttonText === 'reply all') {
      console.log('Detected reply by button text');
      return true;
    }
  }
  
  // Strategy 2: Look for reply indicators in the compose area
  const composeContainer = toolbar.closest('[role="dialog"], [data-testid="primaryColumn"]') || 
                           toolbar.closest('[data-testid="toolBar"]')?.parentNode;
  
  if (composeContainer) {
    // Very specific check for "Replying to @username" text
    // This element should be a direct child/sibling, not deep in the tree
    const replyingToElements = composeContainer.querySelectorAll('div');
    for (const element of replyingToElements) {
      if (element.textContent && 
          element.textContent.startsWith('Replying to @') && 
          element.textContent.length < 100 && // Short text, not the whole tweet
          !element.querySelector('[data-testid="tweetText"]')) { // Not the tweet itself
        console.log('Found "Replying to" indicator:', element.textContent);
        return true;
      }
    }
    
    // Check for inline reply (when replying from timeline)
    const inlineReply = toolbar.closest('[data-testid="inline-reply"]');
    if (inlineReply) {
      console.log('Detected inline reply');
      return true;
    }
  }
  
  // Strategy 3: Check if we're in a reply modal specifically
  // Only consider it a reply if we're on a status page AND the modal says "Reply"
  if (window.location.pathname.includes('/status/') && !window.location.pathname.includes('/compose/tweet')) {
    // We're on a tweet page - check if the compose area is for replying
    const modal = toolbar.closest('[role="dialog"]');
    if (modal) {
      const modalHeading = modal.querySelector('[role="heading"]');
      if (modalHeading && modalHeading.textContent && modalHeading.textContent.toLowerCase().includes('reply')) {
        console.log('Detected reply modal');
        return true;
      }
    }
  }
  
  console.log('Not a reply - normal compose');
  return false;
}

function recheckProcessedAreas() {
  // Re-check all processed areas to see if they should have the button or not
  const processedAreas = document.querySelectorAll('[data-testid="toolBar"].bluesky-dual-processed');
  
  processedAreas.forEach(toolbar => {
    const existingButton = toolbar.querySelector('.bluesky-dual-post-button');
    const postButton = toolbar.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
    
    if (isReplyCompose(toolbar)) {
      // Should not have button - remove if exists
      if (existingButton) {
        console.log('Removing dual post button from reply compose');
        existingButton.remove();
      }
    } else {
      // Should have button - add if missing
      if (!existingButton && postButton) {
        console.log('Adding dual post button back to regular compose');
        addDualPostButton(toolbar, postButton);
      }
    }
  });
}

function addDualPostButton(toolbar, originalPostButton) {
  try {
    console.log('Creating dual post button...');
    
    // Create the dual post button
    const dualButton = document.createElement('div');
    dualButton.className = 'bluesky-dual-post-button';
    dualButton.setAttribute('role', 'button');
    dualButton.setAttribute('tabindex', '0');
    dualButton.setAttribute('aria-label', 'Post to X and Bluesky');
    
    // Get the styles from the original post button
    const originalStyles = window.getComputedStyle(originalPostButton);
    
    dualButton.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(45deg, #1d9bf0 0%, #00a8ff 100%);
      color: white;
      border: none;
      border-radius: 20px;
      padding: 8px 16px;
      margin-left: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: ${originalStyles.fontFamily};
      min-height: ${originalStyles.height};
    `;
    
    dualButton.innerHTML = `
      <span style="margin-right: 6px;">🦋</span>
      <span>Post to X & Bsky</span>
    `;
    
    // Add hover effect
    dualButton.addEventListener('mouseenter', () => {
      dualButton.style.transform = 'translateY(-1px)';
      dualButton.style.boxShadow = '0 4px 12px rgba(0, 168, 255, 0.3)';
    });
    
    dualButton.addEventListener('mouseleave', () => {
      dualButton.style.transform = 'translateY(0)';
      dualButton.style.boxShadow = 'none';
    });
    
    // Add click handler
    dualButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!isAuthenticated) {
        showNotification('Please log in to Bluesky first', 'error');
        return;
      }
      
      // Check if this is a thread
      const threadContent = await extractThreadContent(toolbar);
      console.log('Thread detection result:', threadContent);
      
      if (threadContent && threadContent.length > 1) {
        console.log('Detected thread with', threadContent.length, 'posts');
        await handleThreadDualPost(threadContent, originalPostButton);
      } else {
        console.log('Not a thread, extracting single post content');
        const composeContent = await extractComposeContent(toolbar);
        console.log('Extracted content for dual post:', composeContent);
        
        if (!composeContent.text && (!composeContent.media || composeContent.media.length === 0)) {
          console.error('No content found. Text:', composeContent.text, 'Media:', composeContent.media);
          showNotification('Please write something to post', 'error');
          return;
        }
        
        await handleDualPost(composeContent, originalPostButton);
      }
    });
  
    // Insert the button next to the original post button
    originalPostButton.parentNode.insertBefore(dualButton, originalPostButton.nextSibling);
    
    console.log('Added dual post button to compose area');
  } catch (error) {
    console.error('Error in addDualPostButton:', error);
  }
}

// Helper function to convert blob URL or image element to base64
async function blobToBase64(blobUrl) {
  try {
    console.log('Attempting to convert blob URL to base64:', blobUrl);
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    console.log('Blob fetched, size:', blob.size, 'type:', blob.type);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        console.log('Successfully converted to base64, length:', reader.result.length);
        resolve(reader.result);
      };
      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        reject(error);
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to convert blob to base64:', error);
    console.error('Error details:', error.message);
    return null;
  }
}

// Alternative: Convert image element directly to base64 using canvas
async function imageToBase64(imgElement) {
  try {
    console.log('Converting image element to base64 using canvas');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Wait for image to load if needed
    if (!imgElement.complete) {
      await new Promise((resolve) => {
        imgElement.onload = resolve;
        imgElement.onerror = () => {
          console.error('Image failed to load');
          resolve();
        };
      });
    }
    
    canvas.width = imgElement.naturalWidth;
    canvas.height = imgElement.naturalHeight;
    ctx.drawImage(imgElement, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/png');
    console.log('Canvas conversion successful, length:', dataUrl.length);
    return dataUrl;
  } catch (error) {
    console.error('Failed to convert image using canvas:', error);
    return null;
  }
}

async function extractComposeContent(toolbar) {
  const content = {
    text: '',
    media: []
  };
  
  // Try multiple strategies to find the compose text area
  // Strategy 1: Look for the main compose container
  let composeContainer = toolbar.closest('[data-testid="toolBar"]')?.parentNode;
  
  // Strategy 2: Look for the modal or drawer container
  if (!composeContainer) {
    composeContainer = toolbar.closest('[role="dialog"], [data-testid="primaryColumn"]');
  }
  
  // Strategy 3: Look backwards from toolbar
  if (!composeContainer) {
    composeContainer = toolbar.parentElement?.parentElement;
  }
  
  // Strategy 4: Look for the broader compose tweet modal
  if (!composeContainer) {
    composeContainer = toolbar.closest('[aria-labelledby="modal-header"], [data-testid="tweetComposer"]');
  }
  
  console.log('Compose container found:', !!composeContainer);
  
  // Find text areas with multiple selectors
  const textAreaSelectors = [
    '[data-testid="tweetTextarea_0"]',
    '[data-testid="tweetTextarea_1"]',
    '[contenteditable="true"][role="textbox"]',
    '[class*="DraftEditor-content"]',
    '[data-contents="true"]',
    '[aria-label*="Tweet text"]',
    '[aria-label*="Post text"]',
    '[aria-label*="Reply"]',
    'div[contenteditable="true"]'
  ];
  
  let textArea = null;
  for (const selector of textAreaSelectors) {
    textArea = composeContainer?.querySelector(selector) || document.querySelector(selector);
    if (textArea) {
      console.log('Found text area with selector:', selector);
      break;
    }
  }
  
  if (textArea) {
    // Use a more sophisticated extraction that preserves line breaks
    let fullText = '';
    const walker = document.createTreeWalker(
      textArea,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            return NodeFilter.FILTER_ACCEPT;
          }
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Accept BR tags for line breaks
            if (node.tagName === 'BR') {
              return NodeFilter.FILTER_ACCEPT;
            }
            // Accept DIV tags (they represent line breaks in Twitter's editor)
            if (node.tagName === 'DIV') {
              return NodeFilter.FILTER_ACCEPT;
            }
            // Accept IMG tags for emojis
            if (node.tagName === 'IMG' && 
                (node.hasAttribute('alt') || node.src.includes('emoji'))) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );
    
    let node;
    let isFirstDiv = true;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        fullText += node.textContent;
      } else if (node.tagName === 'IMG' && node.alt) {
        fullText += node.alt;
      } else if (node.tagName === 'BR') {
        fullText += '\n';
      } else if (node.tagName === 'DIV') {
        // DIVs in Twitter's editor represent line breaks
        // But we need to be careful not to add extra line breaks
        if (!isFirstDiv && fullText.length > 0 && !fullText.endsWith('\n')) {
          fullText += '\n';
        }
        isFirstDiv = false;
      }
    }
    
    // Clean up the text - preserve linebreaks but trim excessive ones
    content.text = fullText.trim();
    console.log('Extracted text:', content.text);
    console.log('Text contains line breaks:', content.text.includes('\n'));
    console.log('Text as JSON:', JSON.stringify(content.text));
  } else {
    console.warn('Could not find text area in compose interface');
  }
  
  // Find attached media - within the compose container or broader search
  if (composeContainer) {
    console.log('Looking for media in compose container');
    // Look for media attachments in the compose area - expanded selectors
    const mediaContainerSelectors = [
      '[data-testid="attachments"]',
      '[class*="attach"]',
      '[aria-label*="Media"]',
      'div[dir="auto"] > div > div > div > img', // Common pattern for attached images
      '[data-testid="tweetMediaContainer"]',
      '[data-testid="media-preview"]',
      // Additional selectors for media
      'div[style*="background-image"]', // Sometimes images are backgrounds
      '[data-testid="media-attachment"]',
      'div[role="group"] img' // Media in groups
    ];
    
    let mediaContainer = null;
    for (const selector of mediaContainerSelectors) {
      mediaContainer = composeContainer.querySelector(selector);
      if (mediaContainer) {
        console.log('Found media container with selector:', selector);
        break;
      }
    }
    
    // If no container found, look for parent of any image
    if (!mediaContainer) {
      const anyImage = composeContainer.querySelector('img[src*="blob:"], img[src*="pbs.twimg.com/media"]');
      if (anyImage) {
        mediaContainer = anyImage.parentElement;
        console.log('Using parent of found image as media container');
      }
    }
    
    if (mediaContainer) {
      const mediaElements = mediaContainer.querySelectorAll('img, video');
      console.log('Found', mediaElements.length, 'media elements in container');
      
      for (const media of mediaElements) {
        if (media.tagName === 'IMG' && media.src && !media.src.includes('emoji')) {
          console.log('Processing image from container:', media.src.substring(0, 50));
          
          // Check for alternative URLs
          const actualUrl = media.getAttribute('data-src') || media.getAttribute('data-image') || media.src;
          console.log('Using URL:', actualUrl.substring(0, 50));
          
          let mediaData = {
            type: 'image',
            url: actualUrl,
            alt: media.alt || ''
          };
          
          // Convert blob URLs to base64
          if (actualUrl.startsWith('blob:')) {
            // Try blob fetch first
            let base64 = await blobToBase64(actualUrl);
            
            // If blob fetch fails, try canvas method
            if (!base64) {
              console.log('Blob fetch failed, trying canvas method');
              base64 = await imageToBase64(media);
            }
            
            if (base64) {
              mediaData.base64 = base64;
              console.log('Successfully converted blob URL to base64');
            } else {
              console.error('Failed to convert blob URL with both methods');
            }
          }
          
          content.media.push(mediaData);
        } else if (media.tagName === 'VIDEO') {
          console.log('Processing video from container');
          content.media.push({
            type: 'video',
            url: media.src || media.poster,
            alt: 'Video'
          });
        }
      }
    } else {
      console.log('No media container found, will rely on direct image search');
    }
    
    // Also check for images directly in the compose container (Twitter sometimes places them differently)
    console.log('Checking for direct images in compose container');
    const directImages = composeContainer.querySelectorAll('img[src*="blob:"], img[src*="pbs.twimg.com/media"], img[draggable="true"]');
    console.log('Found', directImages.length, 'direct images');
    
    for (const img of directImages) {
      // Skip profile images, emojis, and already processed images
      if (!img.src.includes('emoji') && 
          !img.src.includes('profile_images') && 
          !img.src.includes('emoji') &&
          !content.media.some(m => m.url === img.src)) {
        console.log('Processing direct image:', img.src.substring(0, 50));
        let mediaData = {
          type: 'image',
          url: img.src,
          alt: img.alt || ''
        };
        
        // Convert blob URLs to base64
        if (img.src.startsWith('blob:')) {
          // Try blob fetch first
          let base64 = await blobToBase64(img.src);
          
          // If blob fetch fails, try canvas method
          if (!base64) {
            console.log('Blob fetch failed for direct image, trying canvas method');
            base64 = await imageToBase64(img);
          }
          
          if (base64) {
            mediaData.base64 = base64;
            console.log('Converted blob URL to base64 for direct image');
          } else {
            console.error('Failed to convert direct image blob URL');
          }
        }
        
        content.media.push(mediaData);
      }
    }
  } else {
    // Fallback: If no compose container found, look in the entire document near the toolbar
    console.log('No compose container found, using fallback media search');
    const fallbackImages = document.querySelectorAll('[role="dialog"] img[src*="blob:"], [role="dialog"] img[src*="pbs.twimg.com/media"]');
    console.log('Fallback search found', fallbackImages.length, 'images');
    
    for (const img of fallbackImages) {
      if (!img.src.includes('emoji') && 
          !img.src.includes('profile_images') &&
          !content.media.some(m => m.url === img.src)) {
        console.log('Processing fallback image:', img.src.substring(0, 50));
        let mediaData = {
          type: 'image',
          url: img.src,
          alt: img.alt || ''
        };
        
        if (img.src.startsWith('blob:')) {
          // Try blob fetch first
          let base64 = await blobToBase64(img.src);
          
          // If blob fetch fails, try canvas method
          if (!base64) {
            console.log('Blob fetch failed for fallback image, trying canvas method');
            base64 = await imageToBase64(img);
          }
          
          if (base64) {
            mediaData.base64 = base64;
            console.log('Converted fallback blob URL to base64');
          } else {
            console.error('Failed to convert fallback blob URL');
          }
        }
        
        content.media.push(mediaData);
      }
    }
  }
  
  console.log('Final extracted compose content:', content);
  console.log('Final text has line breaks:', content.text.includes('\n'));
  console.log('Final media count:', content.media.length);
  if (content.media.length > 0) {
    console.log('Media URLs:', content.media.map(m => m.url.substring(0, 50)));
    console.log('Media with base64:', content.media.filter(m => m.base64).length);
  }
  return content;
}

async function extractThreadContent(toolbar) {
  // Look for thread indicators
  const composeContainer = toolbar.closest('[role="dialog"], [data-testid="primaryColumn"]') || 
                           toolbar.closest('[data-testid="toolBar"]')?.parentNode;
  
  if (!composeContainer) {
    console.log('No compose container found for thread detection');
    return null;
  }
  
  // Look for multiple tweet text areas (thread indicator)
  // Check for at least tweetTextarea_0 AND tweetTextarea_1 to confirm it's a thread
  const textArea0 = composeContainer.querySelector('[data-testid="tweetTextarea_0"]');
  const textArea1 = composeContainer.querySelector('[data-testid="tweetTextarea_1"]');
  
  console.log('Thread detection - textArea0:', !!textArea0, 'textArea1:', !!textArea1);
  
  // Only consider it a thread if we have at least 2 text areas
  if (!textArea0 || !textArea1) {
    return null;
  }
  
  // Get all text areas in the thread
  const textAreas = composeContainer.querySelectorAll('[data-testid^="tweetTextarea_"]');
  console.log('Found', textAreas.length, 'text areas for thread');
  
  const thread = [];
  
  // Extract content from each tweet in the thread
  for (const textArea of textAreas) {
    const tweetContainer = textArea.closest('[data-testid^="cellInnerDiv"], [data-testid^="tweet-box-"]') || textArea.parentElement;
    
    const content = {
      text: '',
      media: []
    };
    
    // Extract text with line breaks preserved
    let fullText = '';
    const walker = document.createTreeWalker(
      textArea,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            return NodeFilter.FILTER_ACCEPT;
          }
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Accept BR tags for line breaks
            if (node.tagName === 'BR') {
              return NodeFilter.FILTER_ACCEPT;
            }
            // Accept DIV tags (they represent line breaks in Twitter's editor)
            if (node.tagName === 'DIV') {
              return NodeFilter.FILTER_ACCEPT;
            }
            // Accept IMG tags for emojis
            if (node.tagName === 'IMG' && 
                (node.hasAttribute('alt') || node.src.includes('emoji'))) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );
    
    let node;
    let isFirstDiv = true;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        fullText += node.textContent;
      } else if (node.tagName === 'IMG' && node.alt) {
        fullText += node.alt;
      } else if (node.tagName === 'BR') {
        fullText += '\n';
      } else if (node.tagName === 'DIV') {
        // DIVs in Twitter's editor represent line breaks
        if (!isFirstDiv && fullText.length > 0 && !fullText.endsWith('\n')) {
          fullText += '\n';
        }
        isFirstDiv = false;
      }
    }
    
    content.text = fullText.trim();
    console.log('Thread item text:', content.text);
    console.log('Thread text contains line breaks:', content.text.includes('\n'));
    
    // Look for media in this specific tweet
    const mediaContainer = tweetContainer?.querySelector('[data-testid="attachments"], [class*="attach"]');
    if (mediaContainer) {
      const mediaElements = mediaContainer.querySelectorAll('img, video');
      for (const media of mediaElements) {
        if (media.tagName === 'IMG' && media.src && !media.src.includes('emoji')) {
          let mediaData = {
            type: 'image',
            url: media.src,
            alt: media.alt || ''
          };
          
          // Convert blob URLs to base64
          if (media.src.startsWith('blob:')) {
            // Try blob fetch first
            let base64 = await blobToBase64(media.src);
            
            // If blob fetch fails, try canvas method
            if (!base64) {
              console.log('Blob fetch failed for thread image, trying canvas method');
              base64 = await imageToBase64(media);
            }
            
            if (base64) {
              mediaData.base64 = base64;
              console.log('Converted thread blob URL to base64 for image');
            } else {
              console.error('Failed to convert thread blob URL');
            }
          }
          
          content.media.push(mediaData);
        } else if (media.tagName === 'VIDEO') {
          content.media.push({
            type: 'video',
            url: media.src || media.poster,
            alt: 'Video'
          });
        }
      }
    }
    
    if (content.text || content.media.length > 0) {
      thread.push(content);
    }
  }
  
  return thread.length > 0 ? thread : null;
}

async function handleThreadDualPost(threadContent, originalPostButton) {
  // Disable the dual post button temporarily
  const dualButton = document.querySelector('.bluesky-dual-post-button');
  if (dualButton) {
    dualButton.style.opacity = '0.5';
    dualButton.style.pointerEvents = 'none';
    dualButton.innerHTML = '<span>Posting thread...</span>';
  }
  
  try {
    console.log('Starting thread dual post process...');
    
    // Show notification about posting thread
    showNotification(`Posting thread with ${threadContent.length} posts to Bluesky...`, 'info');
    
    // Send thread to background script
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        action: 'postBlueskyThread',
        thread: threadContent
      });
    } catch (err) {
      if (err.message && err.message.includes('Extension context invalidated')) {
        throw new Error('Extension was updated or reloaded. Please refresh the page and try again.');
      }
      throw err;
    }
    
    if (response && response.success) {
      console.log('Bluesky thread posted successfully');
      
      // Now click the X post button to post the thread there
      originalPostButton.click();
      
      // Show success message
      setTimeout(() => {
        showNotification(`Successfully posted ${threadContent.length}-part thread to both X and Bluesky! 🧵`, 'success');
      }, 1000);
    } else {
      throw new Error('Failed to post thread to Bluesky: ' + (response ? response.error : 'Unknown error'));
    }
    
  } catch (error) {
    console.error('Thread dual post failed:', error);
    showNotification('Failed to post thread to Bluesky: ' + error.message, 'error');
  } finally {
    // Re-enable the dual post button
    if (dualButton) {
      dualButton.style.opacity = '1';
      dualButton.style.pointerEvents = 'auto';
      dualButton.innerHTML = '<span style="margin-right: 6px;">🦋</span><span>Post to X & Bsky</span>';
    }
  }
}

async function handleDualPost(content, originalPostButton) {
  // Disable the dual post button temporarily
  const dualButton = document.querySelector('.bluesky-dual-post-button');
  if (dualButton) {
    dualButton.style.opacity = '0.5';
    dualButton.style.pointerEvents = 'none';
    dualButton.innerHTML = '<span>Posting...</span>';
  }
  
  try {
    console.log('Starting dual post process...');
    
    // Step 1: Post to Bluesky first
    showNotification('Posting to Bluesky...', 'info');
    
    console.log('Sending to background script - text:', content.text);
    console.log('Sending to background script - has line breaks:', content.text.includes('\n'));
    console.log('Sending to background script - media count:', content.media ? content.media.length : 0);
    console.log('Sending to background script - media:', content.media);
    
    let blueskyResponse;
    try {
      blueskyResponse = await chrome.runtime.sendMessage({
        action: 'postToBluesky',
        text: content.text,
        media: content.media || []
      });
    } catch (err) {
      if (err.message && err.message.includes('Extension context invalidated')) {
        throw new Error('Extension was updated or reloaded. Please refresh the page and try again.');
      }
      throw err;
    }
    
    if (!blueskyResponse || !blueskyResponse.success) {
      throw new Error('Failed to post to Bluesky: ' + (blueskyResponse ? blueskyResponse.error : 'Unknown error'));
    }
    
    console.log('Bluesky post successful, now posting to X...');
    showNotification('Posted to Bluesky! Now posting to X...', 'info');
    
    // Step 2: Click the original X post button
    originalPostButton.click();
    
    // Step 3: Show success message
    setTimeout(() => {
      let message = 'Successfully posted to both X and Bluesky! 🎉';
      if (blueskyResponse.result && blueskyResponse.result.warnings && blueskyResponse.result.warnings.length > 0) {
        message += ' Note: ' + blueskyResponse.result.warnings.join(' ');
      }
      showNotification(message, 'success');
    }, 1000);
    
  } catch (error) {
    console.error('Dual post failed:', error);
    showNotification('Failed to post to Bluesky: ' + error.message, 'error');
  } finally {
    // Re-enable the dual post button
    if (dualButton) {
      dualButton.style.opacity = '1';
      dualButton.style.pointerEvents = 'auto';
      dualButton.innerHTML = '<span style="margin-right: 6px;">🦋</span><span>Post to X & Bsky</span>';
    }
  }
}

async function extractTweetContent(tweetElement) {
  console.log('Extracting content from tweet:', tweetElement);
  
  const content = {
    text: '',
    images: [],
    author: '',
    timestamp: ''
  };

  // Extract text content with proper emoji and line break handling
  const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
  if (textElement) {
    // Get all text nodes including emojis and preserve line breaks
    let fullText = '';
    const walker = document.createTreeWalker(
      textElement,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            return NodeFilter.FILTER_ACCEPT;
          }
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Accept BR tags for line breaks
            if (node.tagName === 'BR') {
              return NodeFilter.FILTER_ACCEPT;
            }
            // Accept DIV/SPAN tags that might represent line breaks
            if (node.tagName === 'DIV' || node.tagName === 'SPAN') {
              // Check if this is a block-level element that should create a line break
              const display = window.getComputedStyle(node).display;
              if (display === 'block' || display === 'flex') {
                return NodeFilter.FILTER_ACCEPT;
              }
            }
            // Accept img elements that are emojis
            if (node.tagName === 'IMG' && 
                (node.hasAttribute('alt') || node.src.includes('emoji'))) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );
    
    let node;
    let lastWasBlock = false;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        fullText += node.textContent;
        lastWasBlock = false;
      } else if (node.tagName === 'IMG' && node.alt) {
        // Add emoji from alt text
        fullText += node.alt;
        lastWasBlock = false;
      } else if (node.tagName === 'BR') {
        fullText += '\n';
        lastWasBlock = true;
      } else if (node.tagName === 'DIV' || node.tagName === 'SPAN') {
        // Add line break for block elements if needed
        if (!lastWasBlock && fullText.length > 0 && !fullText.endsWith('\n')) {
          fullText += '\n';
        }
        lastWasBlock = true;
      }
    }
    
    content.text = fullText.trim();
    console.log('Extracted text with emojis and line breaks:', content.text);
    console.log('Tweet text contains line breaks:', content.text.includes('\n'));
    console.log('Tweet text as JSON:', JSON.stringify(content.text));
  }

  // Extract media (images, GIFs, videos)
  content.media = [];
  
  // Look for images
  const imageElements = tweetElement.querySelectorAll('img[src*="pbs.twimg.com/media"], [data-testid="tweetPhoto"] img, img[alt="Image"]');
  for (const img of imageElements) {
    if (img.src && !img.src.includes('profile_images') && !content.media.some(m => m.url === img.src)) {
      let mediaData = {
        type: 'image',
        url: img.src,
        alt: img.alt || ''
      };
      
      // Convert blob URLs to base64 (though tweet content usually has regular URLs)
      if (img.src.startsWith('blob:')) {
        const base64 = await blobToBase64(img.src);
        if (base64) {
          mediaData.base64 = base64;
          console.log('Converted tweet blob URL to base64 for image');
        }
      }
      
      content.media.push(mediaData);
      console.log('Found image:', img.src);
    }
  }
  
  // Look for GIFs and videos
  const videoElements = tweetElement.querySelectorAll('video, [data-testid="videoPlayer"] video');
  videoElements.forEach(video => {
    if (video.src || video.poster) {
      const mediaUrl = video.src || video.poster;
      if (mediaUrl && !content.media.some(m => m.url === mediaUrl)) {
        content.media.push({
          type: video.src ? 'video' : 'video_thumbnail',
          url: mediaUrl,
          alt: 'Video'
        });
        console.log('Found video:', mediaUrl);
      }
    }
    
    // Also check for source elements
    const sources = video.querySelectorAll('source');
    sources.forEach(source => {
      if (source.src && !content.media.some(m => m.url === source.src)) {
        content.media.push({
          type: 'video',
          url: source.src,
          alt: 'Video'
        });
        console.log('Found video source:', source.src);
      }
    });
  });
  
  // Look for GIFs (often displayed as images with specific patterns)
  const gifElements = tweetElement.querySelectorAll('img[src*=".gif"], img[src*="tweet_gif"], [data-testid="gif"]');
  for (const gif of gifElements) {
    if (gif.src && !content.media.some(m => m.url === gif.src)) {
      let mediaData = {
        type: 'gif',
        url: gif.src,
        alt: gif.alt || 'GIF'
      };
      
      // Convert blob URLs to base64 if needed
      if (gif.src.startsWith('blob:')) {
        const base64 = await blobToBase64(gif.src);
        if (base64) {
          mediaData.base64 = base64;
          console.log('Converted GIF blob URL to base64');
        }
      }
      
      content.media.push(mediaData);
      console.log('Found GIF:', gif.src);
    }
  }
  
  // Keep backward compatibility
  content.images = content.media.filter(m => m.type === 'image').map(m => m.url);

  // Extract author - try multiple methods
  const authorSelectors = [
    '[data-testid="User-Name"] a[href^="/"]',
    'a[href^="/"][tabindex="-1"]',
    'a[role="link"][href^="/"]'
  ];
  
  for (const selector of authorSelectors) {
    const authorElement = tweetElement.querySelector(selector);
    if (authorElement) {
      const href = authorElement.getAttribute('href');
      if (href && href.startsWith('/') && !href.includes('/status/')) {
        content.author = '@' + href.substring(1).split('/')[0];
        console.log('Found author:', content.author);
        break;
      }
    }
  }

  // Extract timestamp
  const timeElement = tweetElement.querySelector('time');
  if (timeElement) {
    content.timestamp = timeElement.getAttribute('datetime') || timeElement.textContent;
    console.log('Found timestamp:', content.timestamp);
  }

  console.log('Extracted content:', content);
  return content;
}

async function handleRepostToBluesky(tweetElement) {
  console.log('Handling repost for tweet:', tweetElement);
  
  if (!isAuthenticated) {
    showNotification('Please log in to Bluesky first', 'error');
    chrome.runtime.sendMessage({ action: 'openPopup' });
    return;
  }

  const content = await extractTweetContent(tweetElement);
  
  if (!content.text && (!content.media || content.media.length === 0)) {
    showNotification('Could not extract tweet content', 'error');
    console.error('No content extracted from tweet');
    return;
  }

  showRepostModal(content);
}

function showRepostModal(content) {
  console.log('Showing modal with content:', content);
  
  // Remove any existing modal
  const existingModal = document.getElementById('bluesky-repost-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement('div');
  modal.id = 'bluesky-repost-modal';
  modal.className = 'bluesky-modal';
  
  modal.innerHTML = `
    <div class="bluesky-modal-content">
      <div class="bluesky-modal-header">
        <h3>Repost to Bluesky</h3>
        <button class="bluesky-close-btn">&times;</button>
      </div>
      <div class="bluesky-modal-body">
        <textarea class="bluesky-text-input" placeholder="Add your comment (optional)"></textarea>
        <div class="bluesky-original-content">
          <div class="bluesky-original-header">Original post${content.author ? ' by ' + content.author : ''}</div>
          <div class="bluesky-original-text">${escapeHtml(content.text)}</div>
          ${content.media && content.media.length > 0 ? `
            <div class="bluesky-original-media">
              ${content.media.map(media => {
                if (media.type === 'image') {
                  return `<img src="${media.url}" alt="${media.alt}" style="max-width: 100%; border-radius: 8px;">`;
                } else if (media.type === 'gif') {
                  return `<div style="position: relative; display: inline-block;">
                    <img src="${media.url}" alt="${media.alt}" style="max-width: 100%; border-radius: 8px;">
                    <span style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px;">GIF</span>
                  </div>`;
                } else if (media.type === 'video' || media.type === 'video_thumbnail') {
                  return `<div style="position: relative; display: inline-block;">
                    <img src="${media.url}" alt="${media.alt}" style="max-width: 100%; border-radius: 8px;">
                    <span style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px;">VIDEO</span>
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 24px;">▶</div>
                  </div>`;
                }
                return '';
              }).join('')}
            </div>
          ` : ''}
        </div>
      </div>
      <div class="bluesky-modal-footer">
        <button class="bluesky-cancel-btn">Cancel</button>
        <button class="bluesky-post-btn">Post to Bluesky</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('.bluesky-close-btn');
  const cancelBtn = modal.querySelector('.bluesky-cancel-btn');
  const postBtn = modal.querySelector('.bluesky-post-btn');
  const textInput = modal.querySelector('.bluesky-text-input');

  closeBtn.addEventListener('click', () => modal.remove());
  cancelBtn.addEventListener('click', () => modal.remove());
  
  postBtn.addEventListener('click', async () => {
    console.log('Post button clicked');
    postBtn.disabled = true;
    postBtn.textContent = 'Posting...';
    
    const comment = textInput.value.trim();
    const fullText = comment ? 
      `${comment}\n\n---\n${content.text}` : 
      content.text;

    try {
      console.log('Sending post to Bluesky:', fullText);
      console.log('Text includes emojis:', /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(fullText));
      
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          action: 'postToBluesky',
          text: fullText,
          media: content.media || [],
          images: content.images // Keep for backward compatibility
        });
      } catch (err) {
        if (err.message && err.message.includes('Extension context invalidated')) {
          throw new Error('Extension was updated or reloaded. Please refresh the page and try again.');
        }
        throw err;
      }

      console.log('Response from background:', response);

      if (response && response.success) {
        let message = 'Successfully posted to Bluesky!';
        if (response.result && response.result.warnings && response.result.warnings.length > 0) {
          message += ' Note: ' + response.result.warnings.join(' ');
        }
        showNotification(message, 'success');
        modal.remove();
      } else {
        const errorMsg = response ? response.error : 'Unknown error';
        console.error('Post failed:', errorMsg);
        
        // Check if it's an auth error
        if (errorMsg.includes('authentication') || errorMsg.includes('log in again') || errorMsg.includes('expired')) {
          showNotification('Session expired. Please reconnect to Bluesky.', 'error');
          // Update auth status
          isAuthenticated = false;
        } else {
          showNotification('Failed to post: ' + errorMsg, 'error');
        }
        
        postBtn.disabled = false;
        postBtn.textContent = 'Post to Bluesky';
      }
    } catch (error) {
      console.error('Error posting:', error);
      showNotification('Error: ' + error.message, 'error');
      postBtn.disabled = false;
      postBtn.textContent = 'Post to Bluesky';
    }
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showNotification(message, type = 'info') {
  console.log(`Notification (${type}):`, message);
  
  const notification = document.createElement('div');
  notification.className = `bluesky-notification bluesky-notification-${type}`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('bluesky-notification-show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('bluesky-notification-show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectBlueskyOption);
} else {
  injectBlueskyOption();
}

// Listen for auth status changes
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'authStatusChanged') {
    isAuthenticated = request.authenticated;
  }
});

console.log('X to Bluesky extension loaded - version 1.0.1');
console.log('Current URL:', window.location.href);
console.log('Document ready state:', document.readyState);