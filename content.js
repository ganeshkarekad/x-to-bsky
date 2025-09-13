let isAuthenticated = false;
// Removed dropdown repost feature; no longer tracking a current tweet element from the overflow menu
// let currentTweetElement = null;

chrome.runtime.sendMessage({ action: 'checkAuth' }, (response) => {
  if (response) {
    isAuthenticated = response.authenticated;
  }
});

function injectBlueskyOption() {
  try {
    console.log('Starting Bluesky compose button injection...');

    // Set up observer to watch for compose areas only
    const observer = new MutationObserver((mutations) => {
      try {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            // Process newly added nodes for compose areas
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === 1) { // Element node
                try {
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
      console.log('=== DUAL POST BUTTON CLICKED ===');
      e.preventDefault();
      e.stopPropagation();
      
      if (!isAuthenticated) {
        showNotification('Please log in to Bluesky first', 'error');
        return;
      }
      
      // Log the toolbar element
      console.log('Toolbar element:', toolbar);
      console.log('Toolbar parent:', toolbar.parentElement);
      
      // Check if this is a thread
      const threadContent = extractThreadContent(toolbar);
      console.log('Thread detection result:', threadContent);
      
      if (threadContent && threadContent.length > 1) {
        console.log('Detected thread with', threadContent.length, 'posts');
        await handleThreadDualPost(threadContent, originalPostButton);
      } else {
        console.log('Not a thread, extracting single post content');
        const composeContent = extractComposeContent(toolbar);
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


function extractComposeContent(toolbar) {
  console.log('=== EXTRACTING COMPOSE CONTENT ===');
  const content = {
    text: '',
    media: []
  };
  
  // Try multiple strategies to find the compose text area
  // We need to find ONLY the compose area, not the entire timeline
  console.log('Strategy 1: Looking for dialog container');
  // Strategy 1: Look for the modal/dialog that contains everything
  let composeContainer = toolbar.closest('[role="dialog"]');
  console.log('Strategy 1 result:', !!composeContainer);
  
  // Strategy 2: Find the smallest container that has both toolbar and textarea
  if (!composeContainer) {
    console.log('Strategy 2: Finding smallest container with text area and toolbar');
    let parent = toolbar.parentElement;
    let smallestContainer = null;
    
    while (parent && parent !== document.body) {
      // Check if this parent has the text area
      if (parent.querySelector('[data-testid="tweetTextarea_0"]')) {
        smallestContainer = parent;
        // Keep going to find the smallest one
        if (!parent.querySelector('[aria-label="Home timeline"]') && 
            !parent.querySelector('[data-testid="primaryColumn"]')) {
          // This is likely the compose box, not the whole timeline
          composeContainer = parent;
          break;
        }
      }
      parent = parent.parentElement;
    }
    
    // If we didn't find a good small container, use the smallest one we found
    if (!composeContainer && smallestContainer) {
      composeContainer = smallestContainer;
    }
    console.log('Strategy 2 result:', !!composeContainer);
  }
  
  // Strategy 3: Look for specific compose box containers
  if (!composeContainer) {
    console.log('Strategy 3: Looking for compose box specific containers');
    // Look for the compose box that's a sibling or ancestor of the toolbar
    const possibleContainers = [
      toolbar.closest('[data-testid="tweetComposer"]'),
      toolbar.closest('[data-testid="tweet-compose"]'),
      toolbar.closest('[role="group"]'),
      toolbar.closest('form')
    ];
    
    for (const container of possibleContainers) {
      if (container && container.querySelector('[data-testid="tweetTextarea_0"]')) {
        composeContainer = container;
        break;
      }
    }
    console.log('Strategy 3 result:', !!composeContainer);
  }
  
  // Strategy 4: Last resort - use primary column but limit scope
  if (!composeContainer) {
    console.log('Strategy 4: Using primary column with limited scope');
    composeContainer = toolbar.closest('[data-testid="primaryColumn"]');
    console.log('Strategy 4 result:', !!composeContainer);
  }
  
  console.log('Final compose container found:', !!composeContainer);
  if (composeContainer) {
    console.log('Container element:', composeContainer.tagName, 'with classes:', composeContainer.className);
  }
  
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
    console.log('Compose container HTML preview:', composeContainer.innerHTML.substring(0, 500));
    
    // First, let's see all images in the container
    const allImages = composeContainer.querySelectorAll('img');
    console.log('ALL images found in container:', allImages.length);
    allImages.forEach((img, index) => {
      console.log(`Image ${index}: src=${img.src?.substring(0, 100)}, alt=${img.alt}, class=${img.className}`);
    });
    
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
      'div[role="group"] img', // Media in groups
      // More specific selectors for pasted images
      'div[data-testid] img[draggable="false"]',
      'div[role="button"] img',
      'div[tabindex] img'
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
          content.media.push({
            type: 'image',
            url: media.src,
            alt: media.alt || ''
          });
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
    
    // Only look for images that are likely attached to the compose, not from timeline
    // First, find the compose box boundaries
    const textArea = composeContainer.querySelector('[data-testid="tweetTextarea_0"]');
    const composeBox = textArea?.closest('div[class*="css-"]')?.parentElement?.parentElement;
    
    // Look for images near the text area or in attachment areas
    let directImages = [];
    
    if (composeBox) {
      // Look for images specifically in the compose box area
      directImages = composeBox.querySelectorAll('img[src*="blob:"], img[draggable="false"]:not([src*="profile_images"])');
      console.log('Found', directImages.length, 'images in compose box area');
    }
    
    // If no compose box or no images, try broader search but filter carefully
    if (directImages.length === 0) {
      const allImages = composeContainer.querySelectorAll('img');
      directImages = Array.from(allImages).filter(img => {
        // Only include blob images or images that are not profile/emoji/video thumbnails
        return (img.src.includes('blob:') || 
                (img.draggable === false && !img.src.includes('profile_images'))) &&
               !img.src.includes('emoji') &&
               !img.src.includes('ext_tw_video_thumb') &&
               !img.closest('article'); // Exclude images from tweet articles
      });
      console.log('Found', directImages.length, 'filtered images');
    }
    
    for (const img of directImages) {
      if (!content.media.some(m => m.url === img.src)) {
        console.log('Processing direct image:', img.src.substring(0, 50));
        content.media.push({
          type: 'image',
          url: img.src,
          alt: img.alt || ''
        });
      }
    }
  } else {
    // Fallback: If no compose container found, look in the entire document near the toolbar
    console.log('No compose container found, using fallback media search');
    
    // Try to find images in any dialog or modal
    const fallbackImages = document.querySelectorAll('[role="dialog"] img, [aria-modal="true"] img, [data-testid="tweetComposer"] img');
    console.log('Fallback search found', fallbackImages.length, 'total images');
    
    // Filter to only relevant images
    const relevantImages = Array.from(fallbackImages).filter(img => 
      img.src && 
      !img.src.includes('emoji') && 
      !img.src.includes('profile_images') &&
      (img.src.includes('blob:') || img.src.includes('pbs.twimg.com') || img.src.includes('twimg.com/media'))
    );
    console.log('Filtered to', relevantImages.length, 'relevant images');
    
    for (const img of relevantImages) {
      if (!content.media.some(m => m.url === img.src)) {
        console.log('Processing fallback image:', img.src.substring(0, 50));
        content.media.push({
          type: 'image',
          url: img.src,
          alt: img.alt || ''
        });
      }
    }
  }
  
  console.log('Final extracted compose content:', content);
  console.log('Final text has line breaks:', content.text.includes('\n'));
  console.log('Final media count:', content.media.length);
  if (content.media.length > 0) {
    console.log('Media URLs:', content.media.map(m => m.url.substring(0, 50)));
  }
  return content;
}

function extractThreadContent(toolbar) {
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
          content.media.push({
            type: 'image',
            url: media.src,
            alt: media.alt || ''
          });
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
  console.log('=== HANDLE DUAL POST CALLED ===');
  console.log('Content received:', {
    textLength: content.text?.length,
    hasText: !!content.text,
    mediaCount: content.media?.length || 0,
    media: content.media
  });
  
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

function extractTweetContent(tweetElement) {
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
      content.media.push({
        type: 'image',
        url: img.src,
        alt: img.alt || ''
      });
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
      content.media.push({
        type: 'gif',
        url: gif.src,
        alt: gif.alt || 'GIF'
      });
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

// removed: handleRepostToBluesky (dropdown repost feature removed)

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

// removed: escapeHtml (only used by deleted modal repost feature)

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
