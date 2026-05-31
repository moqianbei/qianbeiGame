/**
 * 音效生成脚本
 * 运行: node sounds/generate.js
 * 在 puzzle/ 目录下执行
 */
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════
//  WAV 文件生成
// ═══════════════════════════════════
function createWav(samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * blockAlign;

  // 16-bit PCM samples
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
  }

  const header = Buffer.alloc(44);
  let offset = 0;
  header.write('RIFF', offset); offset += 4;
  header.writeUInt32LE(36 + dataSize, offset); offset += 4;
  header.write('WAVE', offset); offset += 4;
  header.write('fmt ', offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4;          // chunk size
  header.writeUInt16LE(1, offset); offset += 2;            // PCM
  header.writeUInt16LE(numChannels, offset); offset += 2;
  header.writeUInt32LE(sampleRate, offset); offset += 4;
  header.writeUInt32LE(byteRate, offset); offset += 4;
  header.writeUInt16LE(blockAlign, offset); offset += 2;
  header.writeUInt16LE(bitsPerSample, offset); offset += 2;
  header.write('data', offset); offset += 4;
  header.writeUInt32LE(dataSize, offset); offset += 4;

  return Buffer.concat([header, Buffer.from(pcm.buffer)]);
}

// ═══════════════════════════════════
//  音频工具函数
// ═══════════════════════════════════
function sine(t, freq) {
  return Math.sin(2 * Math.PI * freq * t);
}

function tri(t, freq) {
  const phase = (freq * t) % 1;
  return 4 * Math.abs(phase - 0.5) - 1;
}

function saw(t, freq) {
  return 2 * ((freq * t) % 1) - 1;
}

function noise() {
  return Math.random() * 2 - 1;
}

function envelope(t, duration, attack, release) {
  if (t < attack) return t / attack;
  if (t > duration - release) return (duration - t) / release;
  return 1;
}

function genSamples(duration, sampleRate, fn) {
  const len = Math.floor(duration * sampleRate);
  const samples = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    samples[i] = fn(t, i, len);
  }
  return samples;
}

// ═══════════════════════════════════
//  各音效生成
// ═══════════════════════════════════
const SR = 44100;

// 1. pickup — 短促上挑音
function genPickup() {
  return genSamples(0.08, SR, (t) => {
    const freq = 400 + t * 2500; // 400→600Hz
    const env = envelope(t, 0.08, 0.005, 0.03);
    return sine(t, freq) * env * 0.35;
  });
}

// 2. drop — 低沉下落音
function genDrop() {
  return genSamples(0.1, SR, (t) => {
    const freq = 200 * Math.pow(80/200, t/0.1); // 200→80Hz 指数下降
    const env = envelope(t, 0.1, 0.002, 0.06);
    const n = noise() * 0.15 * Math.pow(1 - t/0.1, 2);
    return (tri(t, freq) * 0.3 + n) * env;
  });
}

// 3. snap — 清脆"叮"一声
function genSnap() {
  return genSamples(0.15, SR, (t) => {
    const freq = 1200 + (800 - 1200) * (t / 0.15);
    const env = envelope(t, 0.15, 0.003, 0.12);
    // 加一点高泛音让声音更"亮"
    const fundamental = sine(t, freq);
    const harmonic = sine(t, freq * 2.01) * 0.15;
    return (fundamental + harmonic) * env * 0.4;
  });
}

// 4. complete — 上行琶音 C5 E5 G5 C6
function genComplete() {
  const notes = [523, 659, 784, 1047];
  const noteDuration = 0.15;
  const totalDuration = notes.length * noteDuration + 0.1;
  return genSamples(totalDuration, SR, (t) => {
    const noteIndex = Math.min(Math.floor(t / noteDuration), notes.length - 1);
    const noteT = t - noteIndex * noteDuration;
    const freq = notes[noteIndex];
    const env = envelope(noteT, noteDuration, 0.01, 0.12);
    // 使用 sine + 少量谐波，做出柔和音色
    const sig = sine(noteT, freq) * 0.7 + sine(noteT, freq * 2) * 0.2 + sine(noteT, freq * 3) * 0.1;
    const fadeIn = Math.min(t / 0.02, 1);
    const fadeOut = Math.max(0, Math.min(1, (totalDuration - t) / 0.4));
    return sig * env * 0.35 * fadeIn * fadeOut;
  });
}

// 5. shuffle — 快速随机音符
function genShuffle() {
  const noteCount = 8;
  const noteDuration = 0.04;
  const totalDuration = noteCount * noteDuration;
  const freqs = [];
  for (let i = 0; i < noteCount; i++) {
    freqs.push(350 + Math.random() * 550);
  }
  return genSamples(totalDuration, SR, (t) => {
    const noteIndex = Math.min(Math.floor(t / noteDuration), noteCount - 1);
    const noteT = t - noteIndex * noteDuration;
    const freq = freqs[noteIndex];
    const env = Math.sin(Math.PI * noteT / noteDuration); // 快速 fade in/out
    return sine(noteT, freq) * env * 0.2;
  });
}

// 6. button — 极短点击音
function genButton() {
  return genSamples(0.04, SR, (t) => {
    const freq = 800 + (600 - 800) * (t / 0.04);
    const env = envelope(t, 0.04, 0.001, 0.02);
    return sine(t, freq) * env * 0.3;
  });
}

// 7. bgm — 柔和环境循环 (~10秒)
function genBgm() {
  const duration = 10;
  // 和弦: G B D (G 大调)
  const chord = [196, 247, 294, 392];
  return genSamples(duration, SR, (t) => {
    let sig = 0;
    const tremolo = 1 + 0.15 * sine(t, 0.3);
    for (let i = 0; i < chord.length; i++) {
      const freq = chord[i];
      // 轻微频率调制营造"飘渺"感
      const mod = 1 + 0.002 * sine(t, 0.15 + i * 0.05);
      sig += sine(t, freq * mod) * (0.06 / (i + 1));
    }
    // 整体音量包络
    const fadeIn = Math.min(t / 2, 1);
    const fadeOut = Math.max(0, Math.min(1, (duration - t) / 2));
    return sig * tremolo * fadeIn * fadeOut * 0.5;
  });
}

// ═══════════════════════════════════
//  写入文件
// ═══════════════════════════════════
const outDir = __dirname;

const sounds = [
  { name: 'pickup',   gen: genPickup },
  { name: 'drop',     gen: genDrop },
  { name: 'snap',     gen: genSnap },
  { name: 'complete', gen: genComplete },
  { name: 'shuffle',  gen: genShuffle },
  { name: 'button',   gen: genButton },
  { name: 'bgm',      gen: genBgm },
];

sounds.forEach(({ name, gen }) => {
  const samples = gen();
  const wav = createWav(samples, SR);
  const filePath = path.join(outDir, name + '.wav');
  fs.writeFileSync(filePath, wav);
  console.log(`✅ ${name}.wav — ${(samples.length / SR).toFixed(2)}s, ${(wav.length / 1024).toFixed(1)} KB`);
});

console.log('\n🎉 全部音效生成完成！');
