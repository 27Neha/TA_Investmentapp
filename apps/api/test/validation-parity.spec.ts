import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import * as server from '../src/common/validators';
import { AddressDto, BankDto, ProfileDto } from '../src/me/dto';
import * as mobile from '../../mobile/src/validation';

/** The mobile app validates for UX only; these tests pin its rules to the server's so the two cannot drift. */
describe('mobile/server validation parity', () => {
  const pans = ['ABCDE1234F', 'abcde1234f', 'ABCDE12345', 'ABCD1234FF', '', 'ABCDE1234'];
  const ifscs = ['HDFC0001234', 'hdfc0001234', 'HDFC1001234', 'HDFC000123', 'HDFC0A01234'];
  const accts = ['123456789', '12345678', '1234567890123456789', '123456789012345678', '12345678a'];
  const pins = ['411033', '011033', '41103', '4110333', 'abcdef'];

  it('regexes are identical', () => {
    for (const k of ['PAN_RE', 'IFSC_RE', 'ACCOUNT_RE', 'PINCODE_RE'] as const) expect((mobile as any)[k].source).toBe((server as any)[k].source);
  });

  const okProfile = { fullName: 'Asha Rao', dateOfBirth: '1990-04-25', gender: 'FEMALE', occupation: 'SALARIED', incomeBand: '5L_10L', pan: 'ABCDE1234F', taxResidentIndia: true, pepDeclared: false };
  const errs = async (cls: any, o: any) => (await validate(plainToInstance(cls, o))).map((e) => e.property);

  it('PAN: mobile accepts (after cleaning) iff the DTO accepts', async () => {
    for (const p of pans) expect(mobile.PAN_RE.test(mobile.cleanPan(p))).toBe(!(await errs(ProfileDto, { ...okProfile, pan: p })).includes('pan'));
  });
  it('IFSC and account number', async () => {
    const base = { holderName: 'Asha Rao', accountNumber: '123456789', ifsc: 'HDFC0001234', accountType: 'SAVINGS' };
    for (const i of ifscs) expect(mobile.IFSC_RE.test(mobile.cleanIfsc(i))).toBe(!(await errs(BankDto, { ...base, ifsc: i })).includes('ifsc'));
    for (const a of accts) expect(mobile.ACCOUNT_RE.test(mobile.cleanAccount(a))).toBe(!(await errs(BankDto, { ...base, accountNumber: a })).includes('accountNumber'));
  });
  it('PIN code', async () => {
    for (const p of pins) expect(mobile.PINCODE_RE.test(p)).toBe(!(await errs(AddressDto, { line1: 'Flat 1', city: 'Pune', state: 'MH', pincode: p })).includes('pincode'));
  });
  it('date of birth and minor rule', () => {
    const now = new Date('2026-11-16T00:00:00Z');
    expect(mobile.parseDob('2026-02-30', now)).toBeNull();
    expect(mobile.parseDob('2027-01-01', now)).toBeNull();
    expect(mobile.parseDob('1890-01-01', now)).toBeNull();
    expect(mobile.parseDob('25-04-1990', now)).toBeNull();
    expect(mobile.isMinorDob('2008-11-17', now)).toBe(true);
    expect(mobile.isMinorDob('2008-11-16', now)).toBe(false);
  });
});
