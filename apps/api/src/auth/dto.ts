import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export const SUPPORTED_LOCALES = ['en', 'hi', 'mr'] as const; // extend once the approved ~13-language list is confirmed

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
