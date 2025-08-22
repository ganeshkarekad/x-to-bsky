document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('login-section');
  const authenticatedSection = document.getElementById('authenticated-section');
  const loginForm = document.getElementById('login-form');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const reconnectBtn = document.getElementById('reconnect-btn');
  const errorMessage = document.getElementById('error-message');
  const userHandle = document.getElementById('user-handle');

  checkAuthStatus();

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const identifier = document.getElementById('identifier').value;
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('remember-me').checked;
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Connecting...';
    errorMessage.style.display = 'none';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'authenticate',
        identifier: identifier,
        password: password,
        rememberMe: rememberMe
      });

      if (response.success) {
        showAuthenticatedState(response.session);
        notifyContentScripts(true);
      } else {
        showError(response.error || 'Authentication failed');
      }
    } catch (error) {
      showError(error.message);
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Connect to Bluesky';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ action: 'logout' });
    
    if (response.success) {
      showLoginState();
      notifyContentScripts(false);
    }
  });

  reconnectBtn.addEventListener('click', async () => {
    reconnectBtn.disabled = true;
    reconnectBtn.textContent = 'Reconnecting...';
    errorMessage.style.display = 'none';
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'reconnect' });
      
      if (response.success) {
        showAuthenticatedState(response.session);
        notifyContentScripts(true);
        showSuccess('Session reconnected successfully');
      } else {
        showError(response.error || 'Failed to reconnect');
      }
    } catch (error) {
      showError(error.message);
    } finally {
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = 'Reconnect Session';
    }
  });

  async function checkAuthStatus() {
    const response = await chrome.runtime.sendMessage({ action: 'checkAuth' });
    
    if (response.authenticated && response.session) {
      showAuthenticatedState(response.session);
      
      // Check if credentials are stored
      chrome.storage.local.get(['blueskyCredentials'], (result) => {
        if (result.blueskyCredentials) {
          // Add indicator that auto-reconnect is enabled
          const statusIndicator = document.querySelector('.status-indicator');
          if (statusIndicator) {
            statusIndicator.textContent = 'Active (Auto-reconnect)';
            statusIndicator.style.color = '#00ba7c';
          }
          // Show reconnect button when auto-reconnect is enabled
          if (reconnectBtn) {
            reconnectBtn.style.display = 'block';
          }
        }
      });
    } else {
      showLoginState();
    }
  }

  function showAuthenticatedState(session) {
    loginSection.style.display = 'none';
    authenticatedSection.style.display = 'block';
    errorMessage.style.display = 'none';
    
    if (session.handle) {
      userHandle.textContent = `@${session.handle}`;
    } else if (session.email) {
      userHandle.textContent = session.email;
    }
  }

  function showLoginState() {
    loginSection.style.display = 'block';
    authenticatedSection.style.display = 'none';
    errorMessage.style.display = 'none';
    
    document.getElementById('identifier').value = '';
    document.getElementById('password').value = '';
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    errorMessage.style.color = '#ef4444';
  }

  function showSuccess(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    errorMessage.style.color = '#00ba7c';
    setTimeout(() => {
      errorMessage.style.display = 'none';
    }, 3000);
  }

  function notifyContentScripts(authenticated) {
    chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'authStatusChanged',
          authenticated: authenticated
        });
      });
    });
  }
});