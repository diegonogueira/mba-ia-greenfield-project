import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import type { VideoMetadata } from '../videos/entities/video.entity';
import { InvalidMediaError } from './media.errors';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 120_000;
const THUMBNAIL_TIMEOUT_MS = 120_000;
const THUMBNAIL_POSITION_RATIO = 0.1;
const THUMBNAIL_MAX_WIDTH = 1280;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export interface ProbeResult extends VideoMetadata {
  durationSeconds: number | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; format_name?: string; bit_rate?: string };
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Evaluates ffprobe's "num/den" frame rates ("30000/1001" → 29.97). */
function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return Math.round((num / den) * 1000) / 1000;
}

/** Maps ffprobe JSON to the metadata stored on the video. */
export function mapProbeOutput(output: FfprobeOutput): ProbeResult {
  const streams = output.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) {
    throw new InvalidMediaError('No video stream found');
  }
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = toNumber(output.format?.duration);

  return {
    durationSeconds: duration !== null && duration > 0 ? duration : null,
    width: video.width ?? null,
    height: video.height ?? null,
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    formatName: output.format?.format_name ?? null,
    bitRate: toNumber(output.format?.bit_rate),
    frameRate:
      parseFrameRate(video.avg_frame_rate) ??
      parseFrameRate(video.r_frame_rate),
  };
}

/** Frame used as thumbnail: 10% into the video, 0 when the duration is unknown. */
export function thumbnailTimestamp(durationSeconds: number | null): number {
  if (durationSeconds === null || durationSeconds <= 0) return 0;
  return durationSeconds * THUMBNAIL_POSITION_RATIO;
}

/**
 * Wraps the ffprobe/ffmpeg binaries. Both read the object straight from a
 * (presigned) URL with HTTP range requests — the file is never copied to disk.
 */
@Injectable()
export class MediaProbeService {
  async probe(url: string): Promise<ProbeResult> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          url,
        ],
        { timeout: PROBE_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
      ));
    } catch (err) {
      throw new InvalidMediaError(
        `ffprobe could not read the file: ${(err as Error).message.split('\n')[0]}`,
      );
    }
    return mapProbeOutput(JSON.parse(stdout) as FfprobeOutput);
  }

  async captureThumbnail(url: string, atSeconds: number): Promise<Buffer> {
    let stdout: Buffer;
    try {
      ({ stdout } = await execFileAsync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-ss',
          atSeconds.toFixed(3),
          '-i',
          url,
          '-frames:v',
          '1',
          '-vf',
          `scale='min(${THUMBNAIL_MAX_WIDTH},iw)':-2`,
          '-f',
          'image2pipe',
          '-vcodec',
          'mjpeg',
          'pipe:1',
        ],
        {
          encoding: 'buffer',
          timeout: THUMBNAIL_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
        },
      ));
    } catch (err) {
      throw new InvalidMediaError(
        `ffmpeg could not render a frame: ${(err as Error).message.split('\n')[0]}`,
      );
    }
    if (!stdout || stdout.length === 0) {
      throw new InvalidMediaError('ffmpeg produced an empty thumbnail');
    }
    return stdout;
  }
}
