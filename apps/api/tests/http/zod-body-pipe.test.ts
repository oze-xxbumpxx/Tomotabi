import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PublicRoute } from "../../src/common/guard/public-route.decorator";
import { ZodBodyPipe } from "../../src/common/http/zod-body.pipe";
import {
  GetItineraryQueryParams,
  UpdatePlanBody,
} from "../../src/generated/planning.zod";
import {
  CreateTripBody,
  ListTripsQueryParams,
} from "../../src/generated/trips.zod";
import { IDENTITY_READER } from "../../src/modules/identity/adapter/outbound/identity-reader";
import {
  SESSION_VERIFIER,
  type SessionVerifier,
} from "../../src/modules/identity/adapter/outbound/session-verifier";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";

@Controller("pipe-test")
class PipeTestController {
  @PublicRoute()
  @Post("trips")
  @HttpCode(201)
  createTrip(@Body(new ZodBodyPipe(CreateTripBody)) body: unknown): unknown {
    return { received: body };
  }

  @PublicRoute()
  @Post("patch")
  updatePlan(
    @Body(new ZodBodyPipe(UpdatePlanBody, { nonEmptyObject: true })) body: unknown,
  ): unknown {
    return { received: body };
  }

  @PublicRoute()
  @Get("trips")
  listTrips(@Query(new ZodBodyPipe(ListTripsQueryParams)) query: unknown): unknown {
    return { received: query };
  }

  @PublicRoute()
  @Get("itinerary")
  itinerary(
    @Query(new ZodBodyPipe(GetItineraryQueryParams)) query: unknown,
  ): unknown {
    return { received: query };
  }
}

describe("生成した Zod の Pipe（U-16。configure-app で組んだアプリ）", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.PUBLIC_APP_ORIGIN = ORIGIN;
    const verifier: SessionVerifier = {
      verify: async () => ({ kind: "unauthenticated" }),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [PipeTestController],
    })
      .overrideProvider(SESSION_VERIFIER)
      .useValue(verifier)
      .overrideProvider(IDENTITY_READER)
      .useValue({ findDisplayName: async () => "ひなた" })
      .compile();
    app = await createHttpTestApp(moduleRef, null);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.PUBLIC_APP_ORIGIN;
  });

  function post(path: string, body: unknown) {
    return request(app.getHttpServer())
      .post(path)
      .set("Origin", ORIGIN)
      .set("Content-Type", "application/json")
      .send(body);
  }

  it("正常な body は通り、パース済みの値が届く", async () => {
    const response = await post("/api/pipe-test/trips", {
      name: "京都 2 泊",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      received: { name: "京都 2 泊", startsOn: "2026-09-01", endsOn: "2026-09-03" },
    });
  });

  it("未知の項目は 400 INVALID_REQUEST（strict 生成）", async () => {
    const response = await post("/api/pipe-test/trips", {
      name: "x",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
      extra: true,
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REQUEST");
    expect(response.body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(response.body.retryable).toBe(false);
  });

  it("型違いは 400 INVALID_REQUEST", async () => {
    const response = await post("/api/pipe-test/trips", {
      name: 123,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REQUEST");
  });

  it("絵文字 51 個（UTF-16 で 102）の名前は Pipe を通る（文字数は Domain が判定）", async () => {
    const name = "🍣".repeat(51);
    expect(name.length).toBe(102);
    const response = await post("/api/pipe-test/trips", {
      name,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    expect(response.status).toBe(201);
    expect(response.body.received.name).toBe(name);
  });

  it.each(["abc", "2026-9-1", "2026/09/01", "2026-09-01T00:00:00Z"])(
    "YYYY-MM-DD の形でない日付 %s は 400 INVALID_REQUEST（パターン違反）",
    async (startsOn) => {
      const response = await post("/api/pipe-test/trips", {
        name: "x",
        startsOn,
        endsOn: "2026-09-03",
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_REQUEST");
    },
  );

  it("形を満たすが実在しない日付は Pipe を通る（実在日は Domain が 422 で判定）", async () => {
    const response = await post("/api/pipe-test/trips", {
      name: "x",
      startsOn: "2026-02-30",
      endsOn: "2026-09-03",
    });
    expect(response.status).toBe(201);
  });

  it("空の PATCH（minProperties: 1 相当）は Pipe の後で 400", async () => {
    const response = await post("/api/pipe-test/patch", {});
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REQUEST");
  });

  it("PATCH は部分的な更新だけを通す", async () => {
    const response = await post("/api/pipe-test/patch", { memo: null });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ received: { memo: null } });
  });

  it("クエリは coerce と strict が効く（型違い・上限・未知の項目は 400、既定値が入る）", async () => {
    const badType = await request(app.getHttpServer()).get(
      "/api/pipe-test/trips?limit=abc",
    );
    expect(badType.status).toBe(400);

    const overMax = await request(app.getHttpServer()).get(
      "/api/pipe-test/trips?limit=60",
    );
    expect(overMax.status).toBe(400);

    const unknown = await request(app.getHttpServer()).get(
      "/api/pipe-test/trips?foo=1",
    );
    expect(unknown.status).toBe(400);

    const ok = await request(app.getHttpServer()).get(
      "/api/pipe-test/trips?limit=25&status=planning",
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ received: { limit: 25, status: "planning" } });

    const withDefault = await request(app.getHttpServer()).get("/api/pipe-test/trips");
    expect(withDefault.status).toBe(200);
    expect(withDefault.body).toEqual({ received: { limit: 20 } });
  });

  it("クエリの日付も形だけを検証する（形違反は 400、実在日は UseCase が 422 にする）", async () => {
    const badShape = await request(app.getHttpServer()).get(
      "/api/pipe-test/itinerary?date=abc",
    );
    expect(badShape.status).toBe(400);
    expect(badShape.body.code).toBe("INVALID_REQUEST");

    const response = await request(app.getHttpServer()).get(
      "/api/pipe-test/itinerary?date=2026-02-30",
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: { date: "2026-02-30" } });
  });
});
