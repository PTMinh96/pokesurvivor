/* ============ encode.mjs — combines frames and audio into an MP4 ============
 *   node tools/trailer/encode.mjs <record.mjs output directory> <output.mp4>
 * Requires ffmpeg: pip install imageio-ffmpeg (or use one on PATH).
 * H.264 1080p60 (high quality, suitable for YouTube) and AAC 320 kb/s.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('uso: node encode.mjs <carpeta> <salida.mp4>'); process.exit(1); }
let ff = 'ffmpeg';
try { ff = execFileSync('python', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())']).toString().trim(); } catch (e) { /* use the one on PATH */ }

const frames = fs.readdirSync(dir).filter(f => /^f\d+\.png$/.test(f)).sort();
const first = +frames[0].slice(1, 6);
const wav = path.join(dir, 'audio.wav');
const args = ['-y', '-framerate', '60', '-start_number', String(first), '-i', path.join(dir, 'f%05d.png')];
if (fs.existsSync(wav)) args.push('-i', wav);
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-tune', 'animation',
  '-movflags', '+faststart', '-r', '60');
// Audio: limiter (peaks from many simultaneous effects) and YouTube loudness (-14 LUFS).
if (fs.existsSync(wav)) args.push('-af', 'alimiter=limit=0.9:level=false,loudnorm=I=-14:TP=-1.0:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '320k', '-shortest');
args.push(out);
console.log(frames.length, 'fotogramas →', out);
const r = spawnSync(ff, args, { stdio: 'inherit' });
process.exit(r.status || 0);
