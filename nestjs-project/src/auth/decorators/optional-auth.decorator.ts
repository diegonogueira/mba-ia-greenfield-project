import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Used together with `@Public()`: the route stays accessible without a token,
 * but a present `Authorization` header must carry a valid Bearer token, whose
 * payload is attached to `request.user` (read it with `@OptionalCurrentUser()`).
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
