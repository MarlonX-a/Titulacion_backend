import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNREGISTERED_IDENTITY = 'allowUnregisteredIdentity';

export const AllowUnregisteredIdentity = () =>
  SetMetadata(ALLOW_UNREGISTERED_IDENTITY, true);
