import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InvestingGate } from './investing-gate.service';
import { OrdersService } from './orders.service';

class PaymentDto {
  @IsString() @Length(1, 40) schemeCode!: string;
  @IsString() @Length(1, 200) schemeName!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(100) @Max(10_000_000) amount!: number;
  @IsString() @Length(8, 64) @Matches(/^[A-Za-z0-9_-]+$/) clientRequestId!: string;
  @IsOptional() @IsIn(['UPI', 'NETBANKING']) method?: string;
  @IsOptional() @IsBoolean() acknowledgeRisk?: boolean;
}
class MandateDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(100) @Max(10_000_000) maxAmount!: number;
  @IsString() @Length(8, 64) @Matches(/^[A-Za-z0-9_-]+$/) clientRequestId!: string;
}
class SipDto {
  @IsString() @Length(1, 40) schemeCode!: string;
  @IsString() @Length(1, 200) schemeName!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(100) @Max(10_000_000) amount!: number;
  @IsIn(['MONTHLY', 'WEEKLY', 'QUARTERLY']) frequency!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(28) dayOfMonth?: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @IsOptional() @IsUUID() mandateId?: string;
  @IsOptional() @IsBoolean() acknowledgeRisk?: boolean;
  @IsString() @Length(8, 64) @Matches(/^[A-Za-z0-9_-]+$/) clientRequestId!: string;
}
const uid = (r: Request) => (r as any).user.sub as string;

/** All routes are authenticated (S1 session check) and scoped to the caller's own rows. Write routes fail closed via InvestingGate. */
@UseGuards(JwtAuthGuard)
@Controller('v1/me')
export class OrdersController {
  constructor(private readonly s: OrdersService, private readonly gate: InvestingGate) {}

  @Get('investing/eligibility') async eligibility(@Req() r: Request, @Query('kind') kind?: string) { return this.gate.check(uid(r), kind === 'SIP' ? 'SIP' : 'LUMPSUM'); }

  @Get('payments') listPayments(@Req() r: Request) { return this.s.listPayments(uid(r)); }
  @Post('payments') @Throttle({ default: { limit: 10, ttl: 60_000 } }) startPayment(@Req() r: Request, @Body() b: PaymentDto) { return this.s.startPayment(uid(r), b); }
  @Get('payments/:id') getPayment(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @Query('returned') returned?: string) { return this.s.getPayment(uid(r), id, returned === '1'); }
  @Get('payments/:id/receipt') receipt(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.receipt(uid(r), id); }
  @Post('payments/:id/retry') @HttpCode(201) @Throttle({ default: { limit: 10, ttl: 60_000 } }) retry(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.retryPayment(uid(r), id); }

  @Get('mandates') listMandates(@Req() r: Request) { return this.s.listMandates(uid(r)); }
  @Post('mandates') @Throttle({ default: { limit: 10, ttl: 60_000 } }) createMandate(@Req() r: Request, @Body() b: MandateDto) { return this.s.createMandate(uid(r), b); }
  @Get('mandates/:id') getMandate(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @Query('returned') returned?: string) { return this.s.getMandate(uid(r), id, returned === '1'); }
  @Post('mandates/:id/cancel') @HttpCode(200) cancelMandate(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.cancelMandate(uid(r), id); }

  @Get('sips') listSips(@Req() r: Request) { return this.s.listSips(uid(r)); }
  @Post('sips') @Throttle({ default: { limit: 10, ttl: 60_000 } }) createSip(@Req() r: Request, @Body() b: SipDto) { return this.s.createSip(uid(r), b); }
  @Get('sips/:id') getSip(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.getSip(uid(r), id); }
  @Post('sips/:id/cancel') @HttpCode(200) cancelSip(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.cancelSip(uid(r), id); }
}
