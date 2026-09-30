import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface SampleVideoOptions {
  durationSeconds?: number;
  width?: number;
  height?: number;
  /** Video bitrate — raise it to get a file larger than one upload part. */
  bitrate?: string;
}

/**
 * Generates a small MP4 (test pattern + sine tone) with ffmpeg, so no binary
 * fixture is committed. Returns the file bytes.
 */
export async function generateSampleVideo(
  options: SampleVideoOptions = {},
): Promise<Buffer> {
  const { durationSeconds = 2, width = 320, height = 240 } = options;
  const path = join(
    tmpdir(),
    `sample-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`,
  );
  await execFileAsync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${durationSeconds}:size=${width}x${height}:rate=25`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${durationSeconds}`,
    '-c:v',
    'libx264',
    ...(options.bitrate
      ? [
          '-b:v',
          options.bitrate,
          '-maxrate',
          options.bitrate,
          '-bufsize',
          options.bitrate,
        ]
      : []),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    '-y',
    path,
  ]);
  try {
    return await readFile(path);
  } finally {
    await rm(path, { force: true });
  }
}
