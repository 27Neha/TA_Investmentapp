import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/** Mirrors apps/mobile/src/i18n/locales.ts. 11 owner-confirmed (en hi mr gu pa bn ta te as kn ml) + 2 PROPOSED (or ur) pending the owner's final list; edit both registries together. Legal text for non-English locales falls back to English until human-reviewed. */
export const SUPPORTED_LOCALES = ['en', 'hi', 'mr', 'gu', 'pa', 'bn', 'ta', 'te', 'as', 'kn', 'ml', 'or', 'ur'] as const;

export class SignupDto {
  @IsString() @Length(2, 100) fullName: string;
  @IsEmail() @MaxLength(254) @Transform(({ value }) => String(value).trim().toLowerCase()) email: string;
  @IsString() @MaxLength(20) mobile: string;
  @IsDateString() dateOfBirth: string;
  @IsString() @Length(10, 128) password: string;
  @IsIn(SUPPORTED_LOCALES as unknown as string[]) locale: string;
  @IsBoolean() acceptTerms: boolean;
  @IsBoolean() acceptPrivacy: boolean;
  @IsString() @MaxLength(32) termsVersion: string;
  @IsString() @MaxLength(32) privacyVersion: string;
}

export class VerifyEmailDto {
  @IsEmail() @Transform(({ value }) => String(value).trim().toLowerCase()) email: string;
  @Matches(/^\d{6}$/) code: string;
}

export class LoginDto {
  @IsEmail() @Transform(({ value }) => String(value).trim().toLowerCase()) email: string;
  @IsString() @MaxLength(128) password: string;
}

export class RefreshDto {
  @IsString() @MaxLength(256) refreshToken: string;
}

export class ForgotPasswordDto {
  @IsEmail() @Transform(({ value }) => String(value).trim().toLowerCase()) email: string;
}

export class VerifyResetOtpDto {
  @IsEmail() @Transform(({ value }) => String(value).trim().toLowerCase()) email: string;
  @Matches(/^\d{6}$/) code: string;
}

export class ResetPasswordDto {
  @IsString() @MaxLength(2048) resetToken: string;
  @IsString() @Length(10, 128) newPassword: string;
}

export class LocaleDto {
  @IsOptional() @IsIn(SUPPORTED_LOCALES as unknown as string[]) locale: string;
}
