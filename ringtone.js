/**
 * TechTitans Ringtone — Web Audio API ring generator
 * Plays a classic phone-style ringtone without any audio files.
 */
const TechTitansRingtone = {
  _context: null,
  _interval: null,
  _playing: false,

  _ensureContext() {
    if (!this._context) {
      this._context = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._context.state === 'suspended') {
      this._context.resume().catch(() => {});
    }
    return this._context;
  },

  _playTone(frequency, duration) {
    const context = this._ensureContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(0.3, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + duration);
  },

  _ringCycle() {
    // Classic double-ring: two short bursts of dual-tone
    this._playTone(440, 0.4);  // A4
    this._playTone(480, 0.4);  // slightly higher for dual-tone effect

    setTimeout(() => {
      if (!this._playing) return;
      this._playTone(440, 0.4);
      this._playTone(480, 0.4);
    }, 500);
  },

  start() {
    if (this._playing) return;
    this._playing = true;

    try {
      this._ringCycle();
      this._interval = setInterval(() => {
        if (!this._playing) return;
        this._ringCycle();
      }, 3000);
    } catch (error) {
      console.warn('Ringtone playback failed:', error);
      this._playing = false;
    }
  },

  stop() {
    this._playing = false;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
};

window.TechTitansRingtone = TechTitansRingtone;
