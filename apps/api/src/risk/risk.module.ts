import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { RiskController } from './risk.controller';
import { RiskService } from './risk.service';

@Module({ imports: [AuthModule], controllers: [RiskController, AssessmentController], providers: [RiskService, AssessmentService], exports: [RiskService] })
export class RiskModule {}
