/**
 * High-End Racing Audio Synthesizer Engine
 * Uses Web Audio API for synthetic engine roar, transmission whine, tire skid, and race SFX.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private isInitialized: boolean = false;
  public isMuted: boolean = false;

  // Engine sound nodes
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;

  // Tire skid / screech nodes
  private skidGain: GainNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private skidNoiseNode: AudioBufferSourceNode | null = null;

  // MediaStream capture destination for recording
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;

  init() {
    if (this.isInitialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return;

      this.ctx = new AudioCtxClass();
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.45, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Cổng stream để thu âm thanh đồng bộ vào Video Recorder
      try {
        this.mediaStreamDest = this.ctx.createMediaStreamDestination();
        this.masterGain.connect(this.mediaStreamDest);
      } catch {
        // Ignore if MediaStreamDestination not supported
      }

      // 1. Engine Oscillator Chain (Sawtooth + Triangle rich harmonics)
      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.setValueAtTime(65, this.ctx.currentTime);

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.setValueAtTime(32.5, this.ctx.currentTime);

      this.filterNode = this.ctx.createBiquadFilter();
      this.filterNode.type = 'lowpass';
      this.filterNode.frequency.setValueAtTime(450, this.ctx.currentTime);
      this.filterNode.Q.setValueAtTime(3.5, this.ctx.currentTime);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.3, this.ctx.currentTime);

      this.engineOsc1.connect(this.filterNode);
      this.engineOsc2.connect(this.filterNode);
      this.filterNode.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOsc1.start();
      this.engineOsc2.start();

      // 2. Tire Skid Noise Generator (Pink/White noise with bandpass filter)
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.skidNoiseNode = this.ctx.createBufferSource();
      this.skidNoiseNode.buffer = noiseBuffer;
      this.skidNoiseNode.loop = true;

      this.skidFilter = this.ctx.createBiquadFilter();
      this.skidFilter.type = 'bandpass';
      this.skidFilter.frequency.setValueAtTime(1400, this.ctx.currentTime);
      this.skidFilter.Q.setValueAtTime(4.0, this.ctx.currentTime);

      this.skidGain = this.ctx.createGain();
      this.skidGain.gain.setValueAtTime(0, this.ctx.currentTime);

      this.skidNoiseNode.connect(this.skidFilter);
      this.skidFilter.connect(this.skidGain);
      this.skidGain.connect(this.masterGain);

      this.skidNoiseNode.start();

      this.isInitialized = true;
    } catch (err) {
      console.warn('AudioEngine initialization error:', err);
    }
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 0.45, this.ctx.currentTime, 0.05);
    }
    return this.isMuted;
  }

  playCountdownBeep(isFinal: boolean = false) {
    if (this.isMuted || !this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = isFinal ? 'square' : 'sine';
      osc.frequency.setValueAtTime(isFinal ? 880 : 440, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + (isFinal ? 0.6 : 0.25));

      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + (isFinal ? 0.65 : 0.3));
    } catch {
      // Ignore audio glitches
    }
  }

  update(rpm: number = 3500, throttle: number = 0.8, isDrifting: boolean = false, isBraking: boolean = false, speed: number = 120) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;

    try {
      const now = this.ctx.currentTime;

      // Base engine frequency scaled by RPM & speed (40Hz idle to 380Hz redline)
      const baseFreq = THREE_MathUtils_lerp(50, 360, Math.min(1.0, Math.max(0.1, (rpm || 3000) / 9500)));
      if (this.engineOsc1) {
        this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.04);
      }
      if (this.engineOsc2) {
        this.engineOsc2.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.04);
      }

      // Filter opening with throttle & speed
      if (this.filterNode) {
        const filterCutoff = THREE_MathUtils_lerp(400, 2600, Math.min(1.0, (throttle * 0.6) + (speed / 500) * 0.5));
        this.filterNode.frequency.setTargetAtTime(filterCutoff, now, 0.05);
      }

      // Tire Skid sound
      if (this.skidGain) {
        const targetSkidVol = (isDrifting || isBraking) ? Math.min(0.35, 0.15 + (speed / 500) * 0.2) : 0;
        this.skidGain.gain.setTargetAtTime(targetSkidVol, now, 0.06);
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Lấy Audio Track của MediaStream để chèn trực tiếp vào MediaRecorder
   */
  getMediaStreamTrack(): MediaStreamTrack | null {
    this.init();
    if (!this.ctx || !this.masterGain) return null;
    try {
      if (!this.mediaStreamDest) {
        this.mediaStreamDest = this.ctx.createMediaStreamDestination();
        this.masterGain.connect(this.mediaStreamDest);
      }
      const tracks = this.mediaStreamDest.stream.getAudioTracks();
      return tracks[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Tạo chuỗi dữ liệu âm thanh PCM Stereo chất lượng cao giả lập tiếng động cơ F1 / Hypercar gầm rú,
   * tăng tốc chuyển số, tiếng rít lốp bám đường cua và tiếng gió xé tốc độ 600 km/h cho file video xuất ra
   */
  generateRacingAudioPCM(durationSeconds: number, sampleRate: number = 44100): { left: Float32Array; right: Float32Array; totalSamples: number } {
    const totalSamples = Math.floor(durationSeconds * sampleRate);
    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);

    let phaseOsc1 = 0;
    let phaseOsc2 = 0;
    let phaseSub = 0;
    let phaseTurbo = 0;
    let filterStateL = 0;
    let filterStateR = 0;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;

      // Chu kỳ sang số và vào cua tự nhiên lặp lại mỗi 5.2 giây
      const cycleTime = t % 5.2;
      let throttle = 1.0;
      let rpmNorm = 0.5;
      let isGearShift = false;
      let isCorner = false;

      if (cycleTime < 0.28) {
        // Sang số bốc đầu: RPM tụt nhẹ rồi rít vọt lên
        rpmNorm = 0.52 + (cycleTime / 0.28) * 0.18;
        isGearShift = true;
      } else if (cycleTime < 3.6) {
        // Đạp lút ga thẳng tắp: RPM leo dốc từ 0.65 lên 1.0 (vòng tua 12,000 RPM)
        const progress = (cycleTime - 0.28) / 3.32;
        rpmNorm = 0.65 + progress * 0.35;
      } else if (cycleTime < 4.1) {
        // Đạp phanh giảm tốc trước khúc cua
        const brakeProgress = (cycleTime - 3.6) / 0.5;
        rpmNorm = 1.0 - brakeProgress * 0.45;
        throttle = 0.35;
        isCorner = true;
      } else {
        // Thoát cua rít lốp bứt tốc
        const exitProgress = (cycleTime - 4.1) / 1.1;
        rpmNorm = 0.55 + exitProgress * 0.25;
        isCorner = true;
      }

      // Tần số động cơ F1 V10 / Hypercar: 90Hz -> 370Hz
      const engineFreq = 88 + rpmNorm * 272;

      // Cập nhật pha dao động
      phaseOsc1 += (2 * Math.PI * engineFreq) / sampleRate;
      phaseOsc2 += (2 * Math.PI * (engineFreq * 0.504)) / sampleRate;
      phaseSub += (2 * Math.PI * 46) / sampleRate;
      phaseTurbo += (2 * Math.PI * (1150 + rpmNorm * 1850)) / sampleRate;

      if (phaseOsc1 > 2 * Math.PI) phaseOsc1 -= 2 * Math.PI;
      if (phaseOsc2 > 2 * Math.PI) phaseOsc2 -= 2 * Math.PI;
      if (phaseSub > 2 * Math.PI) phaseSub -= 2 * Math.PI;
      if (phaseTurbo > 2 * Math.PI) phaseTurbo -= 2 * Math.PI;

      // Sóng Sawtooth và Triangle phong phú hài âm
      const saw1 = (phaseOsc1 / Math.PI) - 1.0;
      const tri1 = Math.abs((phaseOsc2 / Math.PI) - 1.0) * 2 - 1.0;
      const sub = Math.sin(phaseSub) * 0.2;
      const turboWhine = Math.sin(phaseTurbo) * 0.04 * rpmNorm;

      // Tiếng nổ pô pặp pặp khi sang số
      let backfire = 0;
      if (isGearShift && Math.random() < 0.28) {
        backfire = (Math.random() * 2 - 1) * 0.35;
      }

      // Tiếng rít lốp khi vào cua
      let tireScreech = 0;
      if (isCorner) {
        tireScreech = (Math.random() * 2 - 1) * (0.09 + Math.sin(t * 19) * 0.04);
      }

      // Tiếng xé gió rít tốc độ cao
      const windRush = (Math.random() * 2 - 1) * (0.02 + rpmNorm * 0.035);

      // Tổng hợp tín hiệu
      const rawSignal = (saw1 * 0.38 + tri1 * 0.26 + sub + turboWhine + backfire + tireScreech + windRush) * throttle;

      // Low-pass filter mô phỏng bộ giảm âm và tiêu âm thể thao
      const cutoff = 0.08 + rpmNorm * 0.22;
      filterStateL += cutoff * (rawSignal - filterStateL);
      filterStateR += cutoff * (rawSignal - filterStateR);

      // Hiệu ứng Stereo không gian nhẹ
      const panOffset = Math.sin(t * 0.35) * 0.12;
      const leftSample = filterStateL * (0.85 + panOffset) + tireScreech * 0.3;
      const rightSample = filterStateR * (0.85 - panOffset) + tireScreech * 0.3;

      // Soft Limiter (tanh) ngăn chặn hoàn toàn clipping âm thanh
      left[i] = Math.tanh(leftSample * 1.45) * 0.78;
      right[i] = Math.tanh(rightSample * 1.45) * 0.78;
    }

    return { left, right, totalSamples };
  }
}

function THREE_MathUtils_lerp(x: number, y: number, t: number): number {
  return (1 - t) * x + t * y;
}

export const audioEngine = new AudioEngine();
