import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { OptionalCurrentUser } from '../auth/decorators/optional-current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { SignPartsDto } from './dto/sign-parts.dto';
import { UploadStatusDto } from './dto/upload-status.dto';
import {
  CreatedVideoResponseDto,
  SignedPartsResponseDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import { VideosService } from './videos.service';

// Rate limiting is scoped to the auth endpoints (phase-02-auth/TD-08); the
// global ThrottlerGuard would otherwise cap video reads/polling at 10 req/min.
@SkipThrottle()
@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Pre-registers the video as a draft in the caller\'s channel, generates its unique slug and opens a multipart upload in the object storage. Returns one presigned PUT URL per part; the file bytes go straight to the storage, never through the API.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created and upload session opened',
    type: CreatedVideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (e.g. size above 10 GiB, non-video MIME type)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'The authenticated user has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<CreatedVideoResponseDto> {
    return this.videosService.createDraft(user.sub, dto);
  }

  @Get(':slug/upload')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the upload session state',
    description:
      'Owner only. Lists the parts the storage already holds, so an interrupted upload can resume by sending only the missing parts.',
  })
  @ApiResponse({ status: 200, type: UploadStatusDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or caller is not the owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'The video upload is no longer active (status is not draft)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getUploadSession(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
  ): Promise<UploadStatusDto> {
    return this.videosService.getUploadSession(slug, user.sub);
  }

  @Post(':slug/upload/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Re-sign upload part URLs',
    description:
      'Owner only. Returns fresh presigned PUT URLs for the requested parts (expired URLs or parts to be re-sent). No resource is created, hence 200.',
  })
  @ApiResponse({ status: 200, type: SignedPartsResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, or a part number is greater than the part count (INVALID_PART_NUMBER)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or caller is not the owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'The video upload is no longer active (status is not draft)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signUploadParts(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: SignPartsDto,
  ): Promise<SignedPartsResponseDto> {
    return this.videosService.signUploadParts(slug, user.sub, dto.partNumbers);
  }

  @Post(':slug/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete the upload',
    description:
      'Owner only. Checks every part in the storage, completes the multipart upload, moves the video from draft to processing and enqueues the processing job (duration/metadata extraction and thumbnail). Processing continues asynchronously, hence 202.',
  })
  @ApiResponse({ status: 202, type: VideoResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or caller is not the owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'The video upload is no longer active (already completed)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 422,
    description:
      'Missing parts, size different from the declared one, or part set rejected by the storage (UPLOAD_INCOMPLETE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
  ): Promise<VideoResponseDto> {
    return this.videosService.completeUpload(slug, user.sub);
  }

  @Public()
  @OptionalAuth()
  @Get(':slug')
  @ApiOperation({
    summary: 'Get a video by its unique slug',
    description:
      'Public. Ready videos are visible to anyone with the slug; draft, processing and failed videos only to their owner (send the access token). An invalid token is rejected.',
  })
  @ApiResponse({ status: 200, type: VideoResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Authorization header present with an invalid token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug, or video not ready and caller is not the owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getVideo(
    @Param('slug') slug: string,
    @OptionalCurrentUser() viewer?: JwtPayload,
  ): Promise<VideoResponseDto> {
    return this.videosService.getVideo(slug, viewer);
  }

  @Public()
  @OptionalAuth()
  @Get(':slug/stream')
  @Redirect()
  @ApiOperation({
    summary: 'Stream the video',
    description:
      'Public. Redirects (302) to a short-lived presigned URL of the original file; the storage answers HTTP Range requests with 206 Partial Content, so playback starts without downloading the whole file.',
  })
  @ApiResponse({ status: 302, description: 'Location: presigned playback URL' })
  @ApiResponse({
    status: 401,
    description: 'Authorization header present with an invalid token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug, or video not ready and caller is not the owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'The owner requested a video that is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('slug') slug: string,
    @OptionalCurrentUser() viewer?: JwtPayload,
  ): Promise<{ url: string }> {
    return {
      url: await this.videosService.getPlaybackUrl(slug, viewer, 'stream'),
    };
  }

  @Public()
  @OptionalAuth()
  @Get(':slug/download')
  @Redirect()
  @ApiOperation({
    summary: 'Download the video',
    description:
      'Public. Redirects (302) to a short-lived presigned URL that answers with Content-Disposition: attachment and the original file name.',
  })
  @ApiResponse({ status: 302, description: 'Location: presigned download URL' })
  @ApiResponse({
    status: 401,
    description: 'Authorization header present with an invalid token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug, or video not ready and caller is not the owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'The owner requested a video that is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('slug') slug: string,
    @OptionalCurrentUser() viewer?: JwtPayload,
  ): Promise<{ url: string }> {
    return {
      url: await this.videosService.getPlaybackUrl(slug, viewer, 'download'),
    };
  }

  @Public()
  @OptionalAuth()
  @Get(':slug/thumbnail')
  @Redirect()
  @ApiOperation({
    summary: 'Get the video thumbnail',
    description:
      'Public. Redirects (302) to a short-lived presigned URL of the JPEG thumbnail generated by the worker.',
  })
  @ApiResponse({ status: 302, description: 'Location: presigned thumbnail URL' })
  @ApiResponse({
    status: 401,
    description: 'Authorization header present with an invalid token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug, or video not ready and caller is not the owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'The owner requested a video that is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async thumbnail(
    @Param('slug') slug: string,
    @OptionalCurrentUser() viewer?: JwtPayload,
  ): Promise<{ url: string }> {
    return { url: await this.videosService.getThumbnailUrl(slug, viewer) };
  }
}
