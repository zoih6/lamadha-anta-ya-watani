/**
 * compose_video.js — assemble the frames + the Suno master into deliverables.
 *
 *   output.mp4              1920x1080 (the film)
 *   output_vertical.mp4     1080x1920 (reels / TikTok — centre crop)
 *   output_promo.mp4        ~15s 9:16 teaser
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FRAMES = process.env.FRAMES || '/var/tmp/voxframes';
const AUDIO = process.env.AUDIO || path.join(ROOT, 'assets', 'audio.mp3');

const OUT = path.join(ROOT, 'output');
fs.mkdirSync(OUT, { recursive: true });

const FPS = 25;
const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';
const FFPROBE = process.env.FFPROBE || '/usr/bin/ffprobe';
const run = c => {
  // execSync runs /bin/sh -c: a raw newline would split this into several
  // commands (the 2nd one being '-c:v ...' -> exit 127). Collapse to one line.
  const cmd = c.replace(/\s*\n\s*/g, ' ').trim();
  console.log('$', cmd);
  execSync(cmd, { stdio: 'inherit' });
};

const nFrames = fs.readdirSync(FRAMES).filter(f => f.endsWith('.jpg')).length;
console.log(`[compose] ${nFrames} frames in ${FRAMES}`);
if (nFrames < 100) { console.error('[compose] too few frames — aborting'); process.exit(1); }

// light grade: keep the charcoal, lift the mid-tones, add a touch of bite
// NOTE: no unsharp here on purpose. The film carries an animated grain plate,
// and sharpening grain is the single most expensive thing you can hand to
// x264 - it doubled the bitrate for no visible gain. Contrast/lift only.
const GRADE = 'eq=contrast=1.06:saturation=0.90:brightness=0.012';

const main = path.join(OUT, 'output.mp4');
run(`
${FFMPEG} -y -framerate ${FPS} -i ${FRAMES}/frame_%05d.jpg -i "${AUDIO}"
 -c:v libx264 -preset medium -crf 25 -maxrate 1600k -bufsize 3200k -pix_fmt yuv420p
 -vf "${GRADE}" -c:a aac -b:a 192k -shortest -movflags +faststart "${main}"
`);

// vertical: take the centre of the 16:9 frame, blow it up to 9:16
const vert = path.join(OUT, 'output_vertical.mp4');
run(`
${FFMPEG} -y -i "${main}"
 -vf "crop=607:1080:656:0,scale=1080:1920:flags=lanczos,eq=contrast=1.04:saturation=0.92"
 -c:v libx264 -preset medium -crf 26 -maxrate 1250k -bufsize 2500k -pix_fmt yuv420p
 -c:a aac -b:a 128k -shortest -movflags +faststart "${vert}"
`);

// 15s teaser from the chorus (39.4s -> 54.4s)
const promo = path.join(OUT, 'output_promo.mp4');
run(`
${FFMPEG} -y -ss 39.0 -t 15 -i "${vert}"
 -c:v libx264 -preset medium -crf 26 -maxrate 900k -bufsize 1800k -pix_fmt yuv420p
 -c:a aac -b:a 128k -movflags +faststart "${promo}"
`);

for (const f of [main, vert, promo]) {
  const mb = (fs.statSync(f).size / 1024 / 1024).toFixed(1);
  console.log(`[compose] ${path.basename(f).padEnd(24)} ${mb} MB`);
}

// probe the result so we can prove the deliverable is what it claims to be
const probe = JSON.parse(execSync(
  `${FFPROBE} -v error -print_format json -show_streams -show_format "${main}"`).toString());
const v = probe.streams.find(s => s.codec_type === 'video');
const a = probe.streams.find(s => s.codec_type === 'audio');
console.log(`[compose] video ${v.width}x${v.height} ${v.r_frame_rate} ${v.codec_name} ${v.nb_frames}f`);
console.log(`[compose] audio ${a.codec_name} ${a.sample_rate}Hz ${a.channels}ch`);
console.log(`[compose] duration ${probe.format.duration}s  size ${(probe.format.size / 1048576).toFixed(1)}MB`);
