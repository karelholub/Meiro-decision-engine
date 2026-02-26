-- RBAC + Releases
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "permissions" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

CREATE TABLE "UserEnvRole" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "env" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserEnvRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserEnvRole_userId_env_roleId_key" ON "UserEnvRole"("userId", "env", "roleId");
CREATE INDEX "UserEnvRole_env_idx" ON "UserEnvRole"("env");

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "env" TEXT,
  "actorUserId" TEXT,
  "actorEmail" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityKey" TEXT,
  "entityVersion" INTEGER,
  "metadata" JSONB,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_ts_idx" ON "AuditEvent"("ts");
CREATE INDEX "AuditEvent_env_action_idx" ON "AuditEvent"("env", "action");
CREATE INDEX "AuditEvent_entityType_entityKey_idx" ON "AuditEvent"("entityType", "entityKey");

CREATE TABLE "Release" (
  "id" TEXT NOT NULL,
  "sourceEnv" TEXT NOT NULL,
  "targetEnv" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdByEmail" TEXT,
  "approvalByUserId" TEXT,
  "approvalNote" TEXT,
  "appliedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "summary" TEXT,
  "planJson" JSONB NOT NULL,
  CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Release_sourceEnv_targetEnv_idx" ON "Release"("sourceEnv", "targetEnv");
CREATE INDEX "Release_status_createdAt_idx" ON "Release"("status", "createdAt");
