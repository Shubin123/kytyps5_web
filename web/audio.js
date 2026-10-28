const RING_SIZE = 16384;
const CHANNELS = 2;

export class AudioManager {
  constructor() {
    this._ctx = null;
    this._gain = null;
    this._workletReady = false;
    this._workletNode = null;
    this._volume = 1;
    this._muted = false;
    this._ringBuffer = new Float32Array(RING_SIZE * CHANNELS);
    this._writePos = 0;
    this._readPos = 0;
    this._samplesAvailable = 0;
  }

  async _ensureContext() {
    if (this._ctx) return;
    this._ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this._gain = this._ctx.createGain();
    this._gain.gain.value = this._muted ? 0 : this._volume;
    this._gain.connect(this._ctx.destination);

    try {
      const workletCode = `
        class KytyAudioProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this._buffer = new Float32Array(${RING_SIZE * CHANNELS});
            this._writePos = 0;
            this._readPos = 0;
            this._count = 0;
            this.port.onmessage = (e) => {
              const samples = e.data;
              for (let i = 0; i < samples.length; i++) {
                this._buffer[this._writePos] = samples[i];
                this._writePos = (this._writePos + 1) % this._buffer.length;
              }
              this._count = Math.min(this._count + samples.length / ${CHANNELS}, ${RING_SIZE});
            };
          }
          process(inputs, outputs) {
            const out = outputs[0];
            const frames = out[0].length;
            for (let i = 0; i < frames; i++) {
              if (this._count > 0) {
                for (let ch = 0; ch < out.length; ch++) {
                  out[ch][i] = this._buffer[this._readPos + ch];
                }
                this._readPos = (this._readPos + ${CHANNELS}) % this._buffer.length;
                this._count--;
              } else {
                for (let ch = 0; ch < out.length; ch++) out[ch][i] = 0;
              }
            }
            return true;
          }
        }
        registerProcessor('kyty-audio', KytyAudioProcessor);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await this._ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      this._workletNode = new AudioWorkletNode(this._ctx, 'kyty-audio', {
        outputChannelCount: [CHANNELS],
      });
      this._workletNode.connect(this._gain);
      this._workletReady = true;
    } catch {
      this._workletReady = false;
    }
  }

  async resume() {
    await this._ensureContext();
    if (this._ctx?.state === 'suspended') {
      await this._ctx.resume();
    }
  }

  needsSamples() {
    return this._samplesAvailable < RING_SIZE / 2;
  }

  pushSamples(samples) {
    if (!this._workletReady || !this._workletNode) {
      for (let i = 0; i < samples.length; i++) {
        this._ringBuffer[this._writePos] = samples[i];
        this._writePos = (this._writePos + 1) % this._ringBuffer.length;
      }
      this._samplesAvailable = Math.min(this._samplesAvailable + samples.length / CHANNELS, RING_SIZE);
      return;
    }
    this._workletNode.port.postMessage(samples);
    this._samplesAvailable = Math.min(this._samplesAvailable + samples.length / CHANNELS, RING_SIZE);
  }

  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._gain && !this._muted) {
      this._gain.gain.setValueAtTime(this._volume, this._ctx.currentTime);
    }
  }

  setMuted(m) {
    this._muted = m;
    if (this._gain) {
      this._gain.gain.setValueAtTime(m ? 0 : this._volume, this._ctx.currentTime);
    }
  }
}
