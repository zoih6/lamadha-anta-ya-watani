/**
 * add_outro.js
 * Encode the end card and splice it onto the finished film.
 *
 * The main film is NOT re-encoded: the outro is encoded with identical codec
 * parameters and joined with -c copy, so the existing 2905 frames keep the
 * quality they already have (a second x264 pass could only lose detail).
 *
 * SILENCE is generated for the card, because the song ends at 116.208s and the
 * card runs to 123.21s.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';
const FFPROBE = process.env.FFPROBE || '/usr/bin/ffprobe';

const FRAMES = process.env.FRAMES || '/var/tmp/outroframes';
const START = parseInt(process.env.START || '2905', 10);
const OUT = path.join(ROOT, 'output');
const MAIN = path.join(OUT, 'output.mp4');
const CARD = path.join(OUT, '_endcard.mp4');
const FINAL = path.join(OUT, '_film_with_outro.mp4');

const sh = c => {
  const cmd = c.replace(/\s*\n\s*/g, ' ').trim();
  console.log('$', cmd);
  execSync(cmd, { stdio: 'inherit' });
};
const probe = f => JSON.parse(
  execSync(`${FFPROBE} -v error -print_format json -show_streams -show_format "${f}"`).toString());

// ------------------------------------------------------- 1. encode the card
const files = fs.readdirSync(FRAMES).filter(f => f.endsWith('.jpg'));
console.log(`[outro] ${files.length} frames from ${FRAMES} (start #${START})`);

sh(`
${FFMPEG} -y -framerate 25 -start_number ${START} -i ${FRAMES}/frame_%05d.jpg
 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000
 -vf "eq=contrast=1.06:saturation=0.90:brightness=0.012"
 -c:v libx264 -preset medium -crf 25 -maxrate 1600k -bufsize 3200k -pix_fmt yuv420p
 -c:a aac -b:a 192k -shortest -movflags +faststart "${CARD}"
`);

// ------------------------------------------- 2. prove the streams can be joined
const a = probe(MAIN), b = probe(CARD);
const va = a.streams.find(s => s.codec_type === 'video');
const vb = b.streams.find(s => s.codec_type === 'video');
const aa = a.streams.find(s => s.codec_type === 'audio');
const ab = b.streams.find(s => s.codec_type === 'audio');

const keys = ['codec_name', 'profile', 'level', 'width', 'height', 'pix_fmt', 'r_frame_rate'];
console.log('\n[outro] stream compatibility');
let ok = true;
for (const k of keys) {
  const x = String(va[k]), y = String(vb[k]);
  const same = x === y;
  if (!same) ok = false;
  console.log(`  ${same ? 'ok  ' : 'DIFF'} ${k.padEnd(14)} ${x.padEnd(10)} | ${y}`);
}
console.log(`  ${aa.codec_name === ab.codec_name ? 'ok  ' : 'DIFF'} ${'audio codec'.padEnd(14)} ${aa.codec_name} | ${ab.codec_name}`);
if (!ok) { console.error('[outro] streams differ — refusing to concat'); process.exit(1); }

// ---------------------------------------------------------------- 3. splice
const list = path.join(OUT, '_concat.txt');
fs.writeFileSync(list, `file '${MAIN}'\nfile '${CARD}'\n`);
sh(`"${FFMPEG}" -y -f concat -safe 0 -i "${list}" -c copy "${FINAL}"`);

// --------------------------------------------------------------- 4. verify
const f = probe(FINAL);
const vf = f.streams.find(s => s.codec_type === 'video');
const af = f.streams.find(s => s.codec_type === 'audio');
console.log(`\n[outro] FINAL`);
console.log(`  video   ${vf.width}x${vf.height} ${vf.r_frame_rate} ${vf.codec_name} ${vf.nb_frames}f`);
console.log(`  audio   ${af.codec_name} ${af.sample_rate}Hz ${af.channels}ch`);
console.log(`  duration ${f.format.duration}s  size ${(f.format.size / 1048576).toFixed(1)}MB`);

const expectedFrames = Math.round(parseFloat(f.format.duration) * 25);
console.log(`  frame count check: ${vf.nb_frames} vs duration*25 = ${expectedFrames} ` +
  `${Math.abs(vf.nb_frames - expectedFrames) <= 2 ? 'OK' : 'MISMATCH'}`);

fs.renameSync(FINAL, MAIN);
fs.unlinkSync(CARD);
fs.unlinkSync(list);
console.log(`[outro] wrote ${MAIN}`);
