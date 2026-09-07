import { Module } from "@nestjs/common";
import { DbService } from "./db/db.service";
import { AuthService } from "./auth/auth.service";
import { AuthGuard } from "./auth/auth.guard";
import { AuthController } from "./auth/auth.controller";
import { CollectionService } from "./collection/collection.service";
import { CollectionController } from "./collection/collection.controller";
import { StorageService } from "./storage/storage.service";
import { MediaService } from "./media/media.service";
import { MediaController } from "./media/media.controller";
import { CatalogService } from "./catalog/catalog.service";
import { CatalogController } from "./catalog/catalog.controller";
import { ProcessingService } from "./processing/processing.service";
import { ProcessingController } from "./processing/processing.controller";
import { ExportService } from "./export/export.service";
import { ExportController } from "./export/export.controller";
@Module({
  controllers: [
    AuthController,
    CollectionController,
    MediaController,
    CatalogController,
    ProcessingController,
    ExportController,
  ],
  providers: [
    DbService,
    AuthService,
    AuthGuard,
    CollectionService,
    StorageService,
    MediaService,
    CatalogService,
    ProcessingService,
    ExportService,
  ],
  exports: [DbService, ProcessingService],
})
export class AppModule {}
