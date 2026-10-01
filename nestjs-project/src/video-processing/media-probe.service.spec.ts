import { InvalidMediaError } from './media.errors';
import { mapProbeOutput, thumbnailTimestamp } from './media-probe.service';

describe('mapProbeOutput', () => {
  it('maps streams and format into the stored metadata', () => {
    const result = mapProbeOutput({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30000/1001',
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: {
        duration: '12.480000',
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        bit_rate: '4500000',
      },
    });

    expect(result).toEqual({
      durationSeconds: 12.48,
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      audioCodec: 'aac',
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitRate: 4500000,
      frameRate: 29.97,
    });
  });

  it('returns null audio codec for a silent video and falls back to r_frame_rate', () => {
    const result = mapProbeOutput({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'vp9',
          width: 640,
          height: 360,
          avg_frame_rate: '0/0',
          r_frame_rate: '25/1',
        },
      ],
      format: { duration: '3.0' },
    });

    expect(result.audioCodec).toBeNull();
    expect(result.frameRate).toBe(25);
    expect(result.bitRate).toBeNull();
  });

  it('returns null duration when ffprobe reports none', () => {
    const result = mapProbeOutput({
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
      format: {},
    });

    expect(result.durationSeconds).toBeNull();
  });

  it('rejects a file without a video stream', () => {
    expect(() =>
      mapProbeOutput({
        streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
        format: { duration: '60' },
      }),
    ).toThrow(InvalidMediaError);
  });
});

describe('thumbnailTimestamp', () => {
  it.each([
    [100, 10],
    [2, 0.2],
    [null, 0],
    [0, 0],
  ])('duration %p → %p s', (duration, expected) => {
    expect(thumbnailTimestamp(duration)).toBeCloseTo(expected);
  });
});
