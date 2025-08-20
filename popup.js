document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('login-section');
  const authenticatedSection = document.getElementById('authenticated-section');
  const loginForm = document.getElementById('login-form');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const errorMessage = document.getElementById('error-message');
  const userHandle = document.getElementById('user-handle');

  checkAuthStatus();

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const identifier = document.getElementById('identifier').value;
    const password = document.getElementById('password').value;
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Connecting...';
    errorMessage.style.display = 'none';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'authenticate',
        identifier: identifier,
        password: password
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

  async function checkAuthStatus() {
    const response = await chrome.runtime.sendMessage({ action: 'checkAuth' });
    
    if (response.authenticated && response.session) {
      showAuthenticatedState(response.session);
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