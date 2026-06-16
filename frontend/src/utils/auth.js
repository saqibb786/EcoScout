let inMemoryToken = '';

export function getSessionToken() {
  if (inMemoryToken) {
    return inMemoryToken;
  }
  try {
    return localStorage.getItem('ecoscout_token') || '';
  } catch (e) {
    console.warn('localStorage is not accessible:', e);
    return '';
  }
}

export function setSessionToken(token) {
  inMemoryToken = token;
  try {
    if (token) {
      localStorage.setItem('ecoscout_token', token);
    } else {
      localStorage.removeItem('ecoscout_token');
    }
  } catch (e) {
    console.warn('localStorage is not writeable:', e);
  }
}
