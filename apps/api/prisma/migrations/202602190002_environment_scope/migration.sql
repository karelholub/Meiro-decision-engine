-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('DEV', 'STAGE', 'PROD');

-- AlterTable
ALTER TABLE "Decision" ADD COLUMN "environment" "Environment" NOT NULL DEFAULT 'DEV';

-- DropIndex
DROP INDEX "Decision_key_key";

-- CreateIndex
CREATE UNIQUE INDEX "Decision_environment_key_key" ON "Decision"("environment", "key");
