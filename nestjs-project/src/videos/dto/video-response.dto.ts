import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../videos.constants';

export class VideoMetadataDto {
  @ApiProperty({ nullable: true, type: Number, example: 1920 })
  width: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 1080 })
  height: number | null;

  @ApiProperty({ nullable: true, type: String, example: 'h264' })
  videoCodec: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'aac' })
  audioCodec: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'mov,mp4,m4a,3gp,3g2,mj2' })
  formatName: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 4500000 })
  bitRate: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 29.97 })
  frameRate: number | null;
}

export class VideoChannelDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'john' })
  nickname: string;
}

export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ', description: 'Unique 11-char public id' })
  slug: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiProperty({ example: 'video/mp4' })
  mimeType: string;

  @ApiProperty({ example: 104857600 })
  sizeBytes: number;

  @ApiProperty({ nullable: true, type: Number, example: 212.34 })
  durationSeconds: number | null;

  @ApiProperty({ nullable: true, type: VideoMetadataDto })
  metadata: VideoMetadataDto | null;

  @ApiProperty({ nullable: true, type: String })
  failureReason: string | null;

  @ApiProperty({ type: VideoChannelDto })
  channel: VideoChannelDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  processedAt: Date | null;
}

export class SignedPartDto {
  @ApiProperty({ example: 1 })
  partNumber: number;

  @ApiProperty({ description: 'Presigned PUT URL for this part' })
  url: string;
}

export class UploadSessionDto {
  @ApiProperty({ example: 67108864 })
  partSize: number;

  @ApiProperty({ example: 2 })
  partCount: number;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;

  @ApiProperty({ type: [SignedPartDto] })
  parts: SignedPartDto[];
}

export class CreatedVideoResponseDto extends VideoResponseDto {
  @ApiProperty({ type: UploadSessionDto })
  upload: UploadSessionDto;
}

export class SignedPartsResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;

  @ApiProperty({ type: [SignedPartDto] })
  parts: SignedPartDto[];
}
