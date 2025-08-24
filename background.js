const BLUESKY_API_URL = 'https://bsky.social/xrpc';
const AUTH_URL = 'https://bsky.app';
const SESSION_CHECK_INTERVAL = 30; // Check session every 30 minutes

let sessionData = null;
let storedCredentials = null;

// Initialize on extension startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated - initializing');
  initializeSession();
  setupSessionHealthCheck();
});

// Also initialize on browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started - initializing');
  initializeSession();
  setupSessionHealthCheck();
});

// Initialize immediately when background script loads
console.log('Background script loaded - initializing');
initializeSession();
setupSessionHealthCheck();

async function initializeSession() {
  console.log('Initializing session...');
  try {
    const storage = await chrome.storage.local.get(['blueskySession', 'blueskyCredentials']);
    
    if (storage.blueskyCredentials) {
      storedCredentials = storage.blueskyCredentials;
      console.log('Found stored credentials');
    }
    
    if (storage.blueskySession) {
      sessionData = storage.blueskySession;
      console.log('Found existing session, validating...');
      
      // Validate the session
      const isValid = await validateSession();
      if (!isValid) {
        console.log('Session invalid, attempting recovery');
        await handleSessionRecovery();
      } else {
        console.log('Session is valid');
      }
    } else if (storage.blueskyCredentials) {
      // Try to authenticate with stored credentials
      console.log('No session found but have credentials, attempting auto-login');
      await handleSessionRecovery();
    } else {
      console.log('No session or credentials found');
    }
  } catch (error) {
    console.error('Failed to initialize session:', error);
  }
}

function setupSessionHealthCheck() {
  // Clear any existing alarm
  chrome.alarms.clear('sessionHealthCheck');
  
  // Set up periodic session health check
  chrome.alarms.create('sessionHealthCheck', {
    periodInMinutes: SESSION_CHECK_INTERVAL
  });
  
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sessionHealthCheck') {
      performSessionHealthCheck();
    }
  });
}

async function performSessionHealthCheck() {
  console.log('Performing session health check');
  
  if (!sessionData) {
    // Try to recover session if we have credentials
    if (storedCredentials) {
      await handleSessionRecovery();
    }
    return;
  }
  
  const isValid = await validateSession();
  if (!isValid) {
    console.log('Session health check failed, attempting recovery');
    await handleSessionRecovery();
  }
}

// Helper function to notify all content scripts about auth status changes
function notifyAuthStatusChange(authenticated) {
  chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'authStatusChanged',
        authenticated: authenticated
      }).catch(err => {
        // Ignore errors for tabs that might not have content script loaded
        console.log('Could not notify tab:', tab.id);
      });
    });
  });
}

async function validateSession() {
  if (!sessionData || !sessionData.accessJwt) {
    console.log('No session data or access token for validation');
    return false;
  }
  
  try {
    // Try a simple API call to validate the session
    const url = `${BLUESKY_API_URL}/app.bsky.actor.getProfile?actor=${encodeURIComponent(sessionData.did)}`;
    console.log('Validating session for:', sessionData.did);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${sessionData.accessJwt}`
      }
    });
    
    console.log('Session validation response status:', response.status);
    
    if (response.status === 401 || response.status === 403) {
      console.log('Session validation failed - unauthorized');
      return false;
    }
    
    if (!response.ok) {
      console.log('Session validation failed - status:', response.status);
      return false;
    }
    
    console.log('Session validation successful');
    return true;
  } catch (error) {
    console.error('Session validation error:', error);
    return false;
  }
}

async function handleSessionRecovery() {
  console.log('Starting session recovery process');
  
  // First try to refresh the session
  if (sessionData && sessionData.refreshJwt) {
    try {
      await refreshSession();
      return true;
    } catch (error) {
      console.log('Session refresh failed:', error.message);
    }
  } else {
    console.log('No refresh token available, skipping refresh attempt');
  }
  
  // If refresh failed or no refresh token, try to re-authenticate with stored credentials
  if (storedCredentials) {
    console.log('Attempting re-authentication with stored credentials');
    try {
      const result = await authenticateWithStoredCredentials();
      if (result) {
        console.log('Successfully re-authenticated with stored credentials');
        notifyAuthStatusChange(true);
        return true;
      }
    } catch (error) {
      console.error('Re-authentication failed:', error);
    }
  } else {
    console.log('No stored credentials available for re-authentication');
  }
  
  // Clear invalid session if all recovery attempts failed
  console.log('All recovery attempts failed, clearing session');
  sessionData = null;
  await chrome.storage.local.remove(['blueskySession']);
  
  // Keep credentials for potential manual retry
  // Only clear credentials if explicitly logged out
  
  notifyAuthStatusChange(false);
  return false;
}

async function authenticateWithStoredCredentials() {
  if (!storedCredentials) {
    console.log('No stored credentials available');
    return null;
  }
  
  try {
    // Decrypt credentials (in production, use proper encryption)
    const identifier = atob(storedCredentials.i);
    const password = atob(storedCredentials.p);
    
    console.log('Attempting authentication with stored credentials for:', identifier);
    
    const response = await fetch(`${BLUESKY_API_URL}/com.atproto.server.createSession`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identifier,
        password,
      }),
    });
    
    console.log('Stored credentials auth response:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Authentication with stored credentials failed:', errorText);
      
      // Don't immediately clear credentials - they might work later
      // Only clear if user explicitly logs out
      return null;
    }
    
    const session = await response.json();
    console.log('Successfully authenticated with stored credentials');
    
    sessionData = session;
    await chrome.storage.local.set({ blueskySession: session });
    
    return session;
  } catch (error) {
    console.error('Failed to authenticate with stored credentials:', error);
    return null;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'authenticate') {
    authenticateBluesky(request.identifier, request.password, request.rememberMe)
      .then((session) => {
        sendResponse({ success: true, session });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'checkAuth') {
    // Return current session from memory if available, otherwise from storage
    if (sessionData) {
      sendResponse({ authenticated: true, session: sessionData });
    } else {
      chrome.storage.local.get(['blueskySession'], (result) => {
        if (result.blueskySession) {
          sessionData = result.blueskySession;
          sendResponse({ authenticated: true, session: result.blueskySession });
        } else {
          sendResponse({ authenticated: false, session: null });
        }
      });
    }
    return true;
  }

  if (request.action === 'logout') {
    chrome.storage.local.remove(['blueskySession', 'blueskyCredentials'], () => {
      sessionData = null;
      storedCredentials = null;
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'reconnect') {
    handleSessionRecovery()
      .then((success) => {
        if (success && sessionData) {
          sendResponse({ success: true, session: sessionData });
        } else {
          sendResponse({ success: false, error: 'Failed to reconnect. Please log in manually.' });
        }
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'postToBluesky') {
    postToBluesky(request.text, request.media || request.images || [])
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'postBlueskyThread') {
    postBlueskyThread(request.thread)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

async function authenticateBluesky(identifier, password, rememberMe = false) {
  const response = await fetch(`${BLUESKY_API_URL}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifier,
      password,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Authentication failed');
  }

  const session = await response.json();
  sessionData = session;
  
  // Store session
  await chrome.storage.local.set({ blueskySession: session });
  
  // Store encrypted credentials if user opted in
  if (rememberMe) {
    // Basic encoding for storage (in production, use proper encryption)
    const encodedCredentials = {
      i: btoa(identifier),
      p: btoa(password),
      timestamp: Date.now()
    };
    storedCredentials = encodedCredentials;
    await chrome.storage.local.set({ blueskyCredentials: encodedCredentials });
  } else {
    // Clear any stored credentials if not remembering
    storedCredentials = null;
    await chrome.storage.local.remove(['blueskyCredentials']);
  }
  
  return session;
}

async function refreshSession() {
  console.log('Attempting to refresh session');
  
  if (!sessionData || !sessionData.refreshJwt) {
    console.log('No refresh token available');
    throw new Error('No session to refresh');
  }

  try {
    const response = await fetch(`${BLUESKY_API_URL}/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionData.refreshJwt}`,
      },
    });

    console.log('Refresh response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Session refresh failed:', errorText);
      
      // Don't clear session data yet - let handleSessionRecovery try other methods
      throw new Error('Session refresh failed');
    }

    const newSession = await response.json();
    console.log('Session refreshed successfully');
    
    // Update both memory and storage
    sessionData = newSession;
    await chrome.storage.local.set({ blueskySession: newSession });
    
    // Notify content scripts of successful refresh
    notifyAuthStatusChange(true);
    
    return newSession;
  } catch (error) {
    console.error('Error during session refresh:', error);
    throw error;
  }
}

async function postToBluesky(text, media = []) {
  // Check if we have a session first
  if (!sessionData) {
    // Try to load from storage
    const result = await chrome.storage.local.get(['blueskySession']);
    if (result.blueskySession) {
      sessionData = result.blueskySession;
    } else {
      throw new Error('Not authenticated - please log in again');
    }
  }

  // Validate session data
  if (!sessionData.accessJwt || !sessionData.did) {
    throw new Error('Invalid session - please log in again');
  }

  // Log the text to verify line breaks are present
  console.log('Posting text to Bluesky:', text);
  console.log('Text contains line breaks:', text.includes('\n'));
  console.log('Line break positions:', [...text].map((c, i) => c === '\n' ? i : null).filter(x => x !== null));

  return await attemptPost(text, media, 0);
}

async function attemptPost(text, media, retryCount) {
  if (retryCount > 1) {
    throw new Error('Authentication failed - please log in again');
  }

  let embed = undefined;
  let warnings = [];
  
  if (media && media.length > 0) {
    console.log('Processing media for upload, count:', media.length);
    // Filter and process media
    const supportedMedia = [];
    const images = [];
    
    for (const item of media) {
      console.log('Processing media item:', item);
      if (typeof item === 'string') {
        // Backward compatibility - treat strings as image URLs
        images.push({ url: item, alt: '', type: 'image' });
      } else if (item.type === 'image') {
        images.push(item);
      } else if (item.type === 'gif') {
        images.push(item); // GIFs are handled as images in Bluesky
      } else if (item.type === 'video' || item.type === 'video_thumbnail') {
        warnings.push('Videos cannot be uploaded to Bluesky. Only the thumbnail will be included.');
        // Try to use video thumbnail if available
        if (item.url && (item.url.includes('jpg') || item.url.includes('png') || item.url.includes('jpeg'))) {
          images.push({ ...item, type: 'image', alt: item.alt + ' (Video thumbnail)' });
        }
      }
    }
    
    console.log('Images to upload:', images.length);
    if (images.length > 0) {
      try {
        console.log('Starting media upload for', images.length, 'images');
        const uploadedImages = await Promise.all(images.slice(0, 4).map(img => uploadMedia(img)));
        console.log('Successfully uploaded', uploadedImages.length, 'images');
        embed = {
          $type: 'app.bsky.embed.images',
          images: uploadedImages,
        };
        
        if (images.length > 4) {
          warnings.push('Only the first 4 images were uploaded (Bluesky limit).');
        }
      } catch (error) {
        console.error('Media upload failed:', error);
        warnings.push('Failed to upload some media files.');
        // Continue without media if upload fails
      }
    } else {
      console.log('No images to upload after filtering');
    }
  } else {
    console.log('No media provided');
  }

  const urls = extractUrls(text);
  if (urls.length > 0 && !embed) {
    try {
      const cardData = await fetchLinkCard(urls[0]);
      if (cardData) {
        embed = {
          $type: 'app.bsky.embed.external',
          external: cardData,
        };
      }
    } catch (error) {
      console.error('Failed to fetch link card:', error);
    }
  }

  // Ensure text preserves line breaks
  const processedText = text ? text : '';
  
  const record = {
    $type: 'app.bsky.feed.post',
    text: processedText,
    createdAt: new Date().toISOString(),
    facets: parseMentionsAndLinks(processedText),
  };

  if (embed) {
    record.embed = embed;
    console.log('Adding embed to record with', embed.images ? embed.images.length : 0, 'images');
  }
  
  console.log('Final record text:', record.text);
  console.log('Record has line breaks:', record.text.includes('\n'));
  console.log('Record has embed:', !!record.embed);
  if (record.embed && record.embed.images) {
    console.log('Record has', record.embed.images.length, 'images attached');
  }

  try {
    console.log('Attempting to post with session:', {
      hasAccessJwt: !!sessionData.accessJwt,
      hasDid: !!sessionData.did,
      retryCount
    });

    const response = await fetch(`${BLUESKY_API_URL}/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionData.accessJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo: sessionData.did,
        collection: 'app.bsky.feed.post',
        record: record,
      }),
    });

    if (response.status === 401 || response.status === 403) {
      console.log('Auth error, attempting session recovery...');
      try {
        // First try to refresh
        if (sessionData && sessionData.refreshJwt) {
          await refreshSession();
          return await attemptPost(text, media, retryCount + 1);
        }
      } catch (refreshError) {
        console.log('Refresh failed, attempting re-authentication');
      }
      
      // Try re-authentication with stored credentials
      if (storedCredentials) {
        try {
          const result = await authenticateWithStoredCredentials();
          if (result) {
            console.log('Re-authenticated successfully, retrying post');
            return await attemptPost(text, media, retryCount + 1);
          }
        } catch (authError) {
          console.error('Re-authentication failed:', authError);
        }
      }
      
      // If all recovery attempts failed
      sessionData = null;
      await chrome.storage.local.remove(['blueskySession']);
      throw new Error('Session expired - please log in again');
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to post';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }
      console.error('Post failed with status:', response.status, errorMessage);
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('Post successful:', result);
    
    // Include any warnings in the response
    if (warnings.length > 0) {
      result.warnings = warnings;
      console.log('Post warnings:', warnings);
    }
    
    return result;
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error - please check your connection');
    }
    throw error;
  }
}

async function getImageAspectRatio(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    
    img.onload = function() {
      const width = this.width;
      const height = this.height;
      URL.revokeObjectURL(url);
      
      if (width > 0 && height > 0) {
        resolve({ width, height });
      } else {
        reject(new Error('Invalid image dimensions'));
      }
    };
    
    img.onerror = function() {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for dimension calculation'));
    };
    
    img.src = url;
  });
}

async function uploadMedia(mediaItem) {
  console.log('uploadMedia called with:', mediaItem);
  const mediaUrl = typeof mediaItem === 'string' ? mediaItem : mediaItem.url;
  const alt = typeof mediaItem === 'string' ? '' : (mediaItem.alt || '');
  
  let blob;
  let aspectRatio = undefined;
  
  // Fetch from URL
  console.log('Fetching media from URL:', mediaUrl);
  const imageResponse = await fetch(mediaUrl);
  if (!imageResponse.ok) {
    console.error('Failed to fetch media, status:', imageResponse.status);
    throw new Error(`Failed to fetch media: ${imageResponse.status}`);
  }
  blob = await imageResponse.blob();
  console.log('Fetched media blob, size:', blob.size, 'type:', blob.type);
  
  // Try to get image dimensions for aspect ratio
  try {
    aspectRatio = await getImageAspectRatio(blob);
    console.log('Calculated aspect ratio:', aspectRatio);
  } catch (error) {
    console.log('Could not determine aspect ratio, will upload without it:', error.message);
  }
  
  const response = await fetch(`${BLUESKY_API_URL}/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sessionData.accessJwt}`,
      'Content-Type': blob.type,
    },
    body: blob,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('Authentication failed during media upload');
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload media: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const imageData = {
    alt: alt,
    image: result.blob,
  };
  
  // Add aspect ratio if we have it
  if (aspectRatio) {
    imageData.aspectRatio = aspectRatio;
  }
  
  return imageData;
}

async function uploadImage(imageUrl) {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.status}`);
  }
  
  const blob = await imageResponse.blob();
  
  // Try to get image dimensions for aspect ratio
  let aspectRatio = undefined;
  try {
    aspectRatio = await getImageAspectRatio(blob);
    console.log('Calculated aspect ratio for image:', aspectRatio);
  } catch (error) {
    console.log('Could not determine aspect ratio, will upload without it:', error.message);
  }
  
  const response = await fetch(`${BLUESKY_API_URL}/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sessionData.accessJwt}`,
      'Content-Type': blob.type,
    },
    body: blob,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('Authentication failed during image upload');
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload image: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const imageData = {
    alt: '',
    image: result.blob,
  };
  
  // Add aspect ratio if we have it
  if (aspectRatio) {
    imageData.aspectRatio = aspectRatio;
  }
  
  return imageData;
}

async function fetchLinkCard(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const contentType = response.headers.get('content-type');
    
    if (!contentType || !contentType.includes('text/html')) {
      return null;
    }

    return {
      uri: url,
      title: url,
      description: '',
    };
  } catch (error) {
    return null;
  }
}

function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
}

function parseMentionsAndLinks(text) {
  const facets = [];
  
  // Convert string to UTF-8 bytes for proper indexing (Bluesky uses byte indices)
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);
  
  const mentionRegex = /@([a-zA-Z0-9.-]+)/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const startByte = encoder.encode(text.substring(0, match.index)).length;
    const endByte = encoder.encode(text.substring(0, match.index + match[0].length)).length;
    
    facets.push({
      index: {
        byteStart: startByte,
        byteEnd: endByte,
      },
      features: [
        {
          $type: 'app.bsky.richtext.facet#mention',
          did: `did:plc:${match[1]}`,
        },
      ],
    });
  }

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  while ((match = urlRegex.exec(text)) !== null) {
    const startByte = encoder.encode(text.substring(0, match.index)).length;
    const endByte = encoder.encode(text.substring(0, match.index + match[0].length)).length;
    
    facets.push({
      index: {
        byteStart: startByte,
        byteEnd: endByte,
      },
      features: [
        {
          $type: 'app.bsky.richtext.facet#link',
          uri: match[0],
        },
      ],
    });
  }

  return facets;
}

async function postBlueskyThread(thread) {
  // Check if we have a session first
  if (!sessionData) {
    // Try to load from storage
    const result = await chrome.storage.local.get(['blueskySession']);
    if (result.blueskySession) {
      sessionData = result.blueskySession;
    } else {
      throw new Error('Not authenticated - please log in again');
    }
  }

  // Validate session data
  if (!sessionData.accessJwt || !sessionData.did) {
    throw new Error('Invalid session - please log in again');
  }

  console.log('Posting thread with', thread.length, 'posts');
  
  const results = [];
  let previousPost = null;
  
  for (let i = 0; i < thread.length; i++) {
    const post = thread[i];
    console.log(`Posting thread item ${i + 1}/${thread.length}`);
    
    try {
      // Process media if present
      let embed = undefined;
      let warnings = [];
      
      if (post.media && post.media.length > 0) {
        const images = post.media.filter(m => m.type === 'image' || m.type === 'gif').slice(0, 4);
        
        if (images.length > 0) {
          try {
            const uploadedImages = await Promise.all(images.map(img => uploadMedia(img)));
            embed = {
              $type: 'app.bsky.embed.images',
              images: uploadedImages,
            };
            
            if (post.media.length > 4) {
              warnings.push('Only the first 4 images were uploaded (Bluesky limit).');
            }
          } catch (error) {
            console.error('Media upload failed:', error);
            warnings.push('Failed to upload some media files.');
          }
        }
      }

      // Extract URLs for link cards if no media
      const urls = extractUrls(post.text);
      if (urls.length > 0 && !embed) {
        try {
          const cardData = await fetchLinkCard(urls[0]);
          if (cardData) {
            embed = {
              $type: 'app.bsky.embed.external',
              external: cardData,
            };
          }
        } catch (error) {
          console.error('Failed to fetch link card:', error);
        }
      }

      // Ensure text preserves line breaks
      const processedText = post.text ? post.text : '';
      
      const record = {
        $type: 'app.bsky.feed.post',
        text: processedText,
        createdAt: new Date().toISOString(),
        facets: parseMentionsAndLinks(processedText),
      };

      if (embed) {
        record.embed = embed;
      }

      // Add reply reference if this is not the first post
      if (previousPost) {
        record.reply = {
          root: {
            uri: results[0].uri,
            cid: results[0].cid
          },
          parent: {
            uri: previousPost.uri,
            cid: previousPost.cid
          }
        };
      }

      const response = await fetch(`${BLUESKY_API_URL}/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionData.accessJwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repo: sessionData.did,
          collection: 'app.bsky.feed.post',
          record: record,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        console.log('Auth error in thread, attempting session recovery...');
        
        let recovered = false;
        
        // First try to refresh
        if (sessionData && sessionData.refreshJwt) {
          try {
            await refreshSession();
            recovered = true;
          } catch (refreshError) {
            console.log('Refresh failed, attempting re-authentication');
          }
        }
        
        // Try re-authentication with stored credentials
        if (!recovered && storedCredentials) {
          try {
            const result = await authenticateWithStoredCredentials();
            if (result) {
              console.log('Re-authenticated successfully, continuing thread');
              recovered = true;
            }
          } catch (authError) {
            console.error('Re-authentication failed:', authError);
          }
        }
        
        if (recovered) {
          // Retry this post
          i--;
          continue;
        } else {
          // If all recovery attempts failed
          sessionData = null;
          await chrome.storage.local.remove(['blueskySession']);
          throw new Error('Session expired - please log in again');
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = 'Failed to post';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
          errorMessage = errorText || errorMessage;
        }
        console.error('Thread post failed with status:', response.status, errorMessage);
        throw new Error(`Failed to post thread item ${i + 1}: ${errorMessage}`);
      }

      const result = await response.json();
      results.push(result);
      previousPost = result;
      
      if (warnings.length > 0) {
        result.warnings = warnings;
      }
      
      // Small delay between posts to avoid rate limiting
      if (i < thread.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (error) {
      console.error(`Failed to post thread item ${i + 1}:`, error);
      throw new Error(`Thread posting failed at item ${i + 1}: ${error.message}`);
    }
  }
  
  console.log('Thread posted successfully:', results);
  return results;
}