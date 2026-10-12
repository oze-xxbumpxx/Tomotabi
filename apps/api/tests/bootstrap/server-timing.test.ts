import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  addDbMs,
  serverTiming,
} from "../../src/bootstrap/server-timing";

const TIMING_PATTERN =
  /^app;dur=\d+(\.\d+)?, db;dur=\d+(\.\d+)?, cold;desc="(true|false)"(, boot;dur=\d+(\.\d+)?)?$/;

function createApp(): Express {
  const app = express();
  app.use("/api", serverTiming);
  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/db-work", (_req, res) => {
    addDbMs(12.5);
    res.json({ ok: true });
  });
  return app;
}

// IU-04: Server-Timingの形。coldはモジュールの読み込みでtrue・最初の要求で
// falseなので、「最初の要求」の確かめはこのファイルの先頭の要求で行う。
describe("serverTiming（IU-04）", () => {
  it("最初の要求だけcold=trueでbootが付き、2回目以降はcold=falseでbootが無い", async () => {
    const app = createApp();

    const first = await request(app).get("/api/ping");
    const firstHeader = first.headers["server-timing"];
    expect(firstHeader).toMatch(TIMING_PATTERN);
    expect(firstHeader).toContain('cold;desc="true"');
    expect(firstHeader).toContain("boot;dur=");

    const second = await request(app).get("/api/ping");
    const secondHeader = second.headers["server-timing"];
    expect(secondHeader).toMatch(TIMING_PATTERN);
    expect(secondHeader).toContain('cold;desc="false"');
    expect(secondHeader).not.toContain("boot");
  });

  it("dbの時間は入れ物に足した分だけ出る。DBを使わない要求は0", async () => {
    const app = createApp();

    const withDb = await request(app).get("/api/db-work");
    expect(withDb.headers["server-timing"]).toMatch(TIMING_PATTERN);
    expect(withDb.headers["server-timing"]).toContain("db;dur=12.5");

    const withoutDb = await request(app).get("/api/ping");
    expect(withoutDb.headers["server-timing"]).toMatch(TIMING_PATTERN);
    expect(withoutDb.headers["server-timing"]).toContain("db;dur=0");
  });
});
