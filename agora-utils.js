(function() {
  function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function compactChannelName(prefix, value) {
    if (!prefix || !value) {
      throw new Error('Channel prefix and value are required.');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    const hash = toHex(new Uint8Array(digest).slice(0, 10));
    const channelName = `${prefix}_${hash}`;

    if (!isValidChannelName(channelName)) {
      throw new Error('Generated Agora channel name is invalid.');
    }

    return channelName;
  }

  function isValidChannelName(channelName) {
    return /^(dm|group)_[A-Za-z0-9_-]+$/.test(channelName) &&
      new TextEncoder().encode(channelName).length < 64;
  }

  window.TechTitansAgora = {
    compactChannelName,
    isValidChannelName
  };
})();
