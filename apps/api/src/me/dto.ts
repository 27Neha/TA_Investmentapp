import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { SUPPORTED_LOCALES } from '../auth/dto';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const upper = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value));

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
export const OCCUPATIONS = ['SALARIED', 'SELF_EMPLOYED', 'BUSINESS', 'PROFESSIONAL', 'RETIRED', 'HOMEMAKER', 'STUDENT', 'OTHER'];
export const INCOME_BANDS = ['BELOW_1L', '1L_5L', '5L_10L', '10L_25L', '25L_1CR', 'ABOVE_1CR'];
export const ACCOUNT_TYPES = ['SAVINGS', 'CURRENT'];
export const RELATIONSHIPS = ['SPOUSE', 'FATHER', 'MOTHER', 'SON', 'DAUGHTER', 'BROTHER', 'SISTER', 'OTHER'];

export class ProfileDto {
  @trim() @IsString() @Length(2, 100) fullName: string;
  @IsDateString() dateOfBirth: string;
  @IsIn(GENDERS) gender: string;
  @IsIn(OCCUPATIONS) occupation: string;
  @IsIn(INCOME_BANDS) incomeBand: string;
  @upper() @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'Enter a valid 10-character PAN (e.g. ABCDE1234F).' }) pan: string;
  @IsBoolean() taxResidentIndia: boolean;
  @IsBoolean() pepDeclared: boolean;
}

export class AddressDto {
  @trim() @IsString() @Length(3, 120) line1: string;
  @trim() @IsOptional() @IsString() @MaxLength(120) line2?: string;
  @trim() @IsString() @Length(2, 60) city: string;
  @trim() @IsString() @Length(2, 60) state: string;
  @trim() @Matches(/^[1-9]\d{5}$/, { message: 'Enter a valid 6-digit PIN code.' }) pincode: string;
}

export class BankDto {
  @trim() @IsString() @Length(2, 100) holderName: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '') : value))
  @Matches(/^\d{9,18}$/, { message: 'Enter a valid account number (9–18 digits).' }) accountNumber: string;
  @upper() @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'Enter a valid 11-character IFSC.' }) ifsc: string;
  @IsIn(ACCOUNT_TYPES) accountType: string;
}

export class NomineeItemDto {
  @trim() @IsString() @Length(2, 100) name: string;
  @IsIn(RELATIONSHIPS) relationship: string;
  @IsDateString() dateOfBirth: string;
  @IsInt() @Min(1) @Max(100) sharePercent: number;
}
export class NomineesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => NomineeItemDto) nominees: NomineeItemDto[];
}
export class NoNomineeDto { @IsBoolean() optOut: boolean; }

export class RiskDto { @IsObject() answers: Record<string, string>; }

export class GuardianDto {
  @trim() @IsString() @Length(2, 100) guardianName: string;
  @IsIn(['FATHER', 'MOTHER', 'LEGAL_GUARDIAN']) relationship: string;
  @IsString() @MaxLength(20) guardianMobile: string;
}

export class AcceptConsentsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsIn(['TERMS', 'PRIVACY', 'RISK', 'DISTRIBUTOR'], { each: true }) kinds: string[];
}

export class LocaleDto { @IsIn(SUPPORTED_LOCALES as unknown as string[]) locale: string; }

export class NotificationsDto {
  @IsBoolean() emailMarketing: boolean;
  @IsBoolean() pushEnabled: boolean;
  @IsBoolean() whatsappUpdates: boolean;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(128) currentPassword: string;
  @IsString() @Length(10, 128) newPassword: string;
}
