import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  VIDEO_FILENAME_MAX_LENGTH,
  VIDEO_MAX_SIZE_BYTES,
  VIDEO_TITLE_MAX_LENGTH,
} from '../videos.constants';

export class CreateVideoDto {
  /** Video title (trimmed). */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(VIDEO_TITLE_MAX_LENGTH)
  title: string;

  /** Original file name, used as the download file name. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(VIDEO_FILENAME_MAX_LENGTH)
  fileName: string;

  /** MIME type of the file, e.g. `video/mp4`. */
  @IsString()
  @Matches(/^video\/[a-z0-9.+-]+$/, {
    message: 'mimeType must be a video MIME type',
  })
  mimeType: string;

  /** Exact file size in bytes (at most 10 GiB). */
  @IsInt()
  @Min(1)
  @Max(VIDEO_MAX_SIZE_BYTES)
  sizeBytes: number;
}
