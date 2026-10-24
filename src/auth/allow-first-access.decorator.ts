import { SetMetadata } from '@nestjs/common';

export const ALLOW_FIRST_ACCESS = 'allow-first-access';
export const AllowFirstAccess = () => SetMetadata(ALLOW_FIRST_ACCESS, true);
