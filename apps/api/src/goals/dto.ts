import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export const GOAL_TYPES = ['RETIREMENT', 'EDUCATION', 'CHILD_EDUCATION', 'MARRIAGE', 'HOME', 'CAR', 'TRAVEL', 'EMERGENCY', 'WEALTH', 'CUSTOM'];
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const num = { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 };

export class GoalDto {
  @trim() @IsString() @Length(2, 60) name: string;
  @IsIn(GOAL_TYPES) type: string;
  @IsNumber(num) @Min(1000) @Max(10_000_000_000) targetAmount: number;
  @IsNumber(num) @Min(0) @Max(10_000_000_000) currentSavings: number;
  @IsNumber(num) @Min(0) @Max(100_000_000) monthlyContribution: number;
  /** The user's own assumption for an illustrative projection. Not a forecast and not provided by TechArtha. */
  @IsNumber(num) @Min(0) @Max(20) expectedReturnPct: number;
  @IsDateString() targetDate: string;
  /** Optional: if set, targetAmount is treated as today's cost and inflated to the target date. */
  @IsOptional() @IsNumber(num) @Min(0) @Max(15) inflationPct?: number;
}

export class ContributionDto {
  @IsNumber(num) @Min(1) @Max(100_000_000) amount: number;
  @IsDateString() contributedOn: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(120) note?: string;
}
