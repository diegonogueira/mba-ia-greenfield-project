import { ApiProperty } from '@nestjs/swagger';

export class UploadedPartDto {
  @ApiProperty({ example: 1 })
  partNumber: number;

  @ApiProperty({ example: 67108864 })
  sizeBytes: number;
}

export class UploadStatusDto {
  @ApiProperty({ example: 67108864 })
  partSize: number;

  @ApiProperty({ example: 160 })
  partCount: number;

  @ApiProperty({ type: [UploadedPartDto] })
  uploadedParts: UploadedPartDto[];
}
