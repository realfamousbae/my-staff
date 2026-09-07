import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { raw } from "express";
import { AppModule } from "./app.module";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use("/v1/import", raw({ type: "application/zip", limit: "200mb" }));
  app.setGlobalPrefix("v1");
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
}
bootstrap();
