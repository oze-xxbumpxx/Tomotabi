import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";

describe("foundation HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns process health", async () => {
    const response = await request(app.getHttpServer()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("increments and then reads the same probe count", async () => {
    const before = await request(app.getHttpServer()).get(
      "/api/foundation/probes",
    );
    const created = await request(app.getHttpServer()).post(
      "/api/foundation/probes/increment",
    );
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ count: before.body.count + 1 });

    const current = await request(app.getHttpServer()).get(
      "/api/foundation/probes",
    );
    expect(current.status).toBe(200);
    expect(current.body).toEqual(created.body);
  });
});
