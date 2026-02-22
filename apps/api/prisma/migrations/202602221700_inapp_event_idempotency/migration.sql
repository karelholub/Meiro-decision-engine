ALTER TABLE "inapp_events"
ADD COLUMN "sourceStreamId" TEXT;

CREATE UNIQUE INDEX "inapp_events_sourceStreamId_key"
ON "inapp_events"("sourceStreamId");
