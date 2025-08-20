let isAuthenticated = false;
let currentTweetElement = null;

chrome.runtime.sendMessage({ action: 'checkAuth' }, (response) => {
  if (response) {
    isAuthenticated = response.authenticated;
  }
});

function injectBlueskyOption() {
  // Track clicks on "More" buttons to know which tweet is active
  document.addEventListener('click', (e) => {
    const moreButton = e.target.closest('[aria-label*="More"], [data-testid="caret"], [aria-haspopup="menu"]');
    if (moreButton) {
      // Find the parent tweet
      const tweet = moreButton.closest('article');
      if (tweet) {
        currentTweetElement = tweet;
        console.log('Tracked tweet for dropdown:', tweet);
      }
    }
  }, true);

  // Set up observer to watch for dropdown menus
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        // Process any newly added nodes that might be dropdown menus
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) { // Element node
            processDropdownMenu(node);
            // Also check children
            const dropdowns = node.querySelectorAll('[role="menu"]');
            dropdowns.forEach(dropdown => processDropdownMenu(dropdown));
          }
        });
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function processDropdownMenu(menuElement) {
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

  option.addEventListener('click', (e) => {
    console.log('Bluesky option clicked!');
    e.preventDefault();
    e.stopPropagation();
    
    // Use the tracked tweet element
    if (currentTweetElement) {
      console.log('Using tracked tweet:', currentTweetElement);
      
      // Close the dropdown by clicking outside
      document.body.click();
      
      // Small delay to let dropdown close
      setTimeout(() => {
        handleRepostToBluesky(currentTweetElement);
      }, 100);
    } else {
      console.error('No tweet element found');
      showNotification('Could not identify the tweet. Please try again.', 'error');
    }
  });

  return option;
}

function extractTweetContent(tweetElement) {
  console.log('Extracting content from tweet:', tweetElement);
  
  const content = {
    text: '',
    images: [],
    author: '',
    timestamp: ''
  };

  // Extract text content with proper emoji handling
  const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
  if (textElement) {
    // Get all text nodes including emojis
    let fullText = '';
    const walker = document.createTreeWalker(
      textElement,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            return NodeFilter.FILTER_ACCEPT;
          }
          // Also accept img elements that are emojis
          if (node.nodeType === Node.ELEMENT_NODE && 
              node.tagName === 'IMG' && 
              (node.hasAttribute('alt') || node.src.includes('emoji'))) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );
    
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        fullText += node.textContent;
      } else if (node.tagName === 'IMG' && node.alt) {
        // Add emoji from alt text
        fullText += node.alt;
      }
    }
    
    content.text = fullText.trim();
    console.log('Extracted text with emojis:', content.text);
  }

  // Extract media (images, GIFs, videos)
  content.media = [];
  
  // Look for images
  const imageElements = tweetElement.querySelectorAll('img[src*="pbs.twimg.com/media"], [data-testid="tweetPhoto"] img, img[alt="Image"]');
  imageElements.forEach(img => {
    if (img.src && !img.src.includes('profile_images') && !content.media.some(m => m.url === img.src)) {
      content.media.push({
        type: 'image',
        url: img.src,
        alt: img.alt || ''
      });
      console.log('Found image:', img.src);
    }
  });
  
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
  gifElements.forEach(gif => {
    if (gif.src && !content.media.some(m => m.url === gif.src)) {
      content.media.push({
        type: 'gif',
        url: gif.src,
        alt: gif.alt || 'GIF'
      });
      console.log('Found GIF:', gif.src);
    }
  });
  
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

  const content = extractTweetContent(tweetElement);
  
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
      
      const response = await chrome.runtime.sendMessage({
        action: 'postToBluesky',
        text: fullText,
        media: content.media || [],
        images: content.images // Keep for backward compatibility
      });

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

console.log('X to Bluesky extension loaded');