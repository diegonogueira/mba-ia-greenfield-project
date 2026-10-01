import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BEARER_PREFIX } from '../auth.constants';
import { JwtPayload } from '../auth.types';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

type AuthRequest = { headers: Record<string, string>; user: unknown };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      targets,
    );
    const request = context.switchToHttp().getRequest<AuthRequest>();

    if (isPublic) {
      const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(
        IS_OPTIONAL_AUTH_KEY,
        targets,
      );
      // Optional auth: anonymous when no header, but never ignore bad credentials.
      if (isOptionalAuth && request.headers?.authorization) {
        await this.authenticate(request);
      }
      return true;
    }

    await this.authenticate(request);
    return true;
  }

  private async authenticate(request: AuthRequest): Promise<void> {
    const authHeader = request.headers?.authorization;

    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException();
    }

    const token = authHeader.slice(BEARER_PREFIX.length);

    try {
      request.user = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }
}
