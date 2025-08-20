const BLUESKY_API_URL = 'https://bsky.social/xrpc';
const AUTH_URL = 'https://bsky.app';

let sessionData = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['blueskySession'], (result) => {
    if (result.blueskySession) {
      sessionData = result.blueskySession;
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'authenticate') {
    authenticateBluesky(request.identifier, request.password)
      .then((session) => {
        sendResponse({ success: true, session });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'checkAuth') {
    chrome.storage.local.get(['blueskySession'], (result) => {
      sendResponse({ authenticated: !!result.blueskySession, session: result.blueskySession });
    });
    return true;
  }

  if (request.action === 'logout') {
    chrome.storage.local.remove(['blueskySession'], () => {
      sessionData = null;
      sendResponse({ success: true });
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
});

async function authenticateBluesky(identifier, password) {
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
  
  await chrome.storage.local.set({ blueskySession: session });
  
  return session;
}

async function refreshSession() {
  if (!sessionData || !sessionData.refreshJwt) {
    throw new Error('No session to refresh');
  }

  const response = await fetch(`${BLUESKY_API_URL}/com.atproto.server.refreshSession`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sessionData.refreshJwt}`,
    },
  });

  if (!response.ok) {
    sessionData = null;
    await chrome.storage.local.remove(['blueskySession']);
    throw new Error('Session refresh failed');
  }

  const newSession = await response.json();
  sessionData = newSession;
  await chrome.storage.local.set({ blueskySession: newSession });
  
  return newSession;
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

  return await attemptPost(text, media, 0);
}

async function attemptPost(text, media, retryCount) {
  if (retryCount > 1) {
    throw new Error('Authentication failed - please log in again');
  }

  let embed = undefined;
  let warnings = [];
  
  if (media && media.length > 0) {
    // Filter and process media
    const supportedMedia = [];
    const images = [];
    
    for (const item of media) {
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
    
    if (images.length > 0) {
      try {
        const uploadedImages = await Promise.all(images.slice(0, 4).map(img => uploadMedia(img)));
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
    }
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

  const record = {
    $type: 'app.bsky.feed.post',
    text: text,
    createdAt: new Date().toISOString(),
    facets: parseMentionsAndLinks(text),
  };

  if (embed) {
    record.embed = embed;
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
      console.log('Auth error, attempting to refresh session...');
      try {
        await refreshSession();
        return await attemptPost(text, media, retryCount + 1);
      } catch (refreshError) {
        console.error('Session refresh failed:', refreshError);
        // Clear invalid session
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

async function uploadMedia(mediaItem) {
  const mediaUrl = typeof mediaItem === 'string' ? mediaItem : mediaItem.url;
  const alt = typeof mediaItem === 'string' ? '' : (mediaItem.alt || '');
  
  const imageResponse = await fetch(mediaUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch media: ${imageResponse.status}`);
  }
  
  const blob = await imageResponse.blob();
  
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
  return {
    alt: alt,
    image: result.blob,
  };
}

async function uploadImage(imageUrl) {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.status}`);
  }
  
  const blob = await imageResponse.blob();
  
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
  return {
    alt: '',
    image: result.blob,
  };
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