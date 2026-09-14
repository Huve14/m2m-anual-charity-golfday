import assert from "node:assert/strict";
import test from "node:test";
process.env.SUPABASE_URL = "https://photos.test";
process.env.SUPABASE_SECRET_KEY = "test-secret";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-public";
const { default: handler } = await import("../api/v1/photos.js");
const { default: adminHandler } = await import("../api/v1/admin/photos.js");
const { default: linkHandler } = await import("../api/v1/photo-links.js");
const event = "10000000-0000-4000-8000-000000000001";
const team = "20000000-0000-4000-8000-000000000001";
const link = "30000000-0000-4000-8000-000000000001";
const photo = "40000000-0000-4000-8000-000000000001";
const actor = "50000000-0000-4000-8000-000000000001";
const batch = "60000000-0000-4000-8000-000000000001";
const token = "a".repeat(43);
function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
}
function mock(t, options = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, method: init.method });
    let data;
    if (url.pathname.endsWith("/m2m_photo_access")) {
      if (options.revoked)
        return Response.json(
          { message: "photo_link_invalid", code: "P0001" },
          { status: 400 },
        );
      data = {
        id: link,
        event_id: event,
        fourball_id: team,
        kind: options.kind || "gallery",
      };
    } else if (url.pathname.endsWith("/m2m_photo_settings"))
      data = {
        gallery_enabled: !options.closed,
        uploads_enabled: !options.uploadsClosed,
      };
    else if (url.pathname.endsWith("/m2m_events"))
      data = { id: event, name: "Golf Day" };
    else if (url.pathname.endsWith("/m2m_fourballs"))
      data = [{ id: team, team_name: "Team One" }];
    else if (url.pathname.endsWith("/m2m_photos")) data = options.photo || null;
    else if (url.pathname.endsWith("/m2m_photo_reserve"))
      data = [{ id: photo, upload_status: "uploading" }];
    else if (url.pathname === "/auth/v1/user") data = { id: actor };
    else if (url.pathname.endsWith("/m2m_profiles"))
      data = { id: actor, role: options.role || "admin", is_active: true };
    else if (url.pathname.endsWith("/m2m_photo_issue_link_batch"))
      data = body.p_links.map((item) => ({
        id: link,
        fourball_id: item.fourball_id,
        kind: "gallery",
        label: "Cart gallery",
      }));
    else if (url.pathname.endsWith("/m2m_photo_moderate")) data = null;
    else if (url.pathname.endsWith("/m2m_fourball_hosts")) data = null;
    else if (url.pathname.includes("/object/upload/sign/"))
      data = {
        url: "/object/upload/sign/m2m-photo-staging/test?token=scoped-test-token",
      };
    else throw new Error(`Unexpected photo test request ${url.pathname}`);
    return Response.json(data);
  });
  return calls;
}
const req = (query = {}, body) => ({
  method: body ? "POST" : "GET",
  headers: { "x-photo-token": token, "content-type": "application/json" },
  query,
  body,
});
test("invalid capability is rejected without any database or storage call", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw new Error("unexpected");
  });
  const res = response();
  await handler({ ...req(), headers: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(requests, 0);
});
test("gallery context contains only the current fourball and public event identity", async (t) => {
  const calls = mock(t);
  const res = response();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.fourballId, team);
  const query = calls.find((c) => c.url.pathname.endsWith("/m2m_fourballs")).url
    .searchParams;
  assert.equal(query.get("id"), `eq.${team}`);
  assert.equal(query.get("select"), "id,team_name");
  assert.equal(res.body.event.name, "Golf Day");
  assert.equal(res.headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(calls[0].body.p_hash.length, 64);
  assert.notEqual(calls[0].body.p_hash, token);
});
test("staff capability cannot browse the approved gallery", async (t) => {
  const calls = mock(t, { kind: "staff" });
  const res = response();
  await handler(req({ view: "gallery" }), res);
  assert.equal(res.statusCode, 403);
  assert.ok(!calls.some((c) => c.url.pathname.endsWith("/m2m_photos")));
});
test("revoked links and closed galleries cannot return any photo data", async (t) => {
  for (const options of [{ revoked: true }, { closed: true }]) {
    const calls = mock(t, options);
    const res = response();
    await handler(req({ view: "gallery" }), res);
    assert.equal(res.statusCode, 403);
    assert.ok(!calls.some((c) => c.url.pathname.endsWith("/m2m_photos")));
    t.mock.restoreAll();
  }
});
test("pending and cross-event photos cannot receive signed read URLs", async (t) => {
  for (const changes of [
    { status: "pending" },
    { event_id: "other-event" },
    { upload_status: "uploading" },
  ]) {
    const calls = mock(t, {
      photo: {
        id: photo,
        event_id: event,
        upload_status: "complete",
        status: "approved",
        ...changes,
      },
    });
    const res = response();
    await handler(req({ view: "photo", id: photo }), res);
    assert.equal(res.statusCode, 404);
    assert.ok(!calls.some((c) => c.url.pathname.includes("/storage/")));
    t.mock.restoreAll();
  }
});
test("reservation uses authenticated capability scope and stable client IDs", async (t) => {
  const calls = mock(t);
  const body = {
    action: "reserve",
    batchId: batch,
    files: [{ id: photo, name: "test.jpg", type: "image/jpeg", size: 1000 }],
    fourballIds: [team],
  };
  const res = response();
  await handler(req({}, body), res);
  assert.equal(res.statusCode, 200);
  const rpc = calls.find((c) =>
    c.url.pathname.endsWith("/m2m_photo_reserve"),
  ).body;
  assert.equal(rpc.p_link, link);
  assert.equal(rpc.p_batch, batch);
  assert.equal(rpc.p_files[0].id, photo);
});
test("oversized batches and unsupported files never reserve storage", async (t) => {
  const calls = mock(t);
  const res = response();
  await handler(
    req(
      {},
      {
        action: "reserve",
        batchId: batch,
        fourballIds: [],
        files: [
          { id: photo, name: "raw.heic", type: "image/heic", size: 1000 },
        ],
      },
    ),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.ok(!calls.some((c) => c.url.pathname.endsWith("/m2m_photo_reserve")));
});
test("paused contributions reject new reservations before storage", async (t) => {
  const calls = mock(t, { uploadsClosed: true });
  const res = response();
  await handler(req({}, { action: "complete", id: photo }), res);
  assert.equal(res.statusCode, 403);
  assert.ok(!calls.some((c) => c.url.pathname.includes("/storage/")));
});
test("completed upload retries are idempotent and do not reprocess images", async (t) => {
  const calls = mock(t, {
    photo: {
      id: photo,
      event_id: event,
      link_id: link,
      upload_status: "complete",
    },
  });
  const res = response();
  await handler(req({}, { action: "complete", id: photo }), res);
  assert.equal(res.body.complete, true);
  assert.ok(!calls.some((c) => c.url.pathname.includes("/storage/")));
  const lookup = calls.find((c) => c.url.pathname.endsWith("/m2m_photos")).url;
  assert.equal(lookup.searchParams.get("link_id"), `eq.${link}`);
});
test("contributors cannot approve through either API", async (t) => {
  mock(t);
  let res = response();
  await handler(
    req(
      {},
      { action: "moderate", eventId: event, ids: [photo], status: "approved" },
    ),
    res,
  );
  assert.equal(res.statusCode, 400);
  res = response();
  await adminHandler(
    req(
      {},
      { action: "moderate", eventId: event, ids: [photo], status: "approved" },
    ),
    res,
  );
  assert.equal(res.statusCode, 401);
});
test("only admins can moderate; the actor is taken from the validated session", async (t) => {
  const calls = mock(t);
  const res = response();
  await adminHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      },
      body: {
        action: "moderate",
        eventId: event,
        ids: [photo],
        status: "approved",
        fourballIds: [team],
      },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(
    calls.find((c) => c.url.pathname.endsWith("/m2m_photo_moderate")).body
      .p_actor,
    actor,
  );
});
test("hosts cannot create gallery links for unassigned fourballs", async (t) => {
  const calls = mock(t, { role: "host" });
  const res = response();
  await linkHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer host-token",
        "content-type": "application/json",
      },
      body: { eventId: event, fourballId: team },
    },
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.ok(
    !calls.some(
      (c) => c.method === "POST" && c.url.pathname.endsWith("/m2m_photo_links"),
    ),
  );
});

test("upload credentials use the signed TUS endpoint and never expose a server key", async (t) => {
  mock(t, {
    photo: {
      id: photo,
      event_id: event,
      link_id: link,
      upload_status: "uploading",
      staging_path: `${event}/${photo}`,
    },
  });
  const res = response();
  await handler(req({}, { action: "credentials", id: photo }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(
    res.body.endpoint,
    "https://photos.test/storage/v1/upload/resumable/sign",
  );
  assert.equal(res.body.token, "scoped-test-token");
  assert.ok(!JSON.stringify(res.body).includes("test-secret"));
});

test("admin batch issues links through one RPC with hashes only and stable retry tokens", async (t) => {
  const calls = mock(t);
  const request = {
    ...req(
      {},
      {
        action: "link-batch",
        eventId: event,
        fourballIds: [team],
        batchToken: token,
      },
    ),
    headers: {
      authorization: "Bearer admin-token",
      "content-type": "application/json",
    },
  };
  const first = response();
  await adminHandler(request, first);
  assert.equal(first.statusCode, 200);
  const second = response();
  await adminHandler(request, second);
  assert.deepEqual(first.body.links, second.body.links);
  const rpc = calls.filter((c) =>
    c.url.pathname.endsWith("/m2m_photo_issue_link_batch"),
  );
  assert.equal(rpc.length, 2);
  assert.equal(rpc[0].body.p_links[0].token_hash.length, 64);
  assert.ok(!JSON.stringify(rpc[0].body).includes(token));
});
test("hosts cannot create admin batches", async (t) => {
  const calls = mock(t, { role: "host" });
  const res = response();
  await adminHandler(
    {
      ...req(
        {},
        {
          action: "link-batch",
          eventId: event,
          fourballIds: [team],
          batchToken: token,
        },
      ),
      headers: { authorization: "Bearer host-token" },
    },
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.ok(!calls.some((c) => c.url.pathname.includes("issue_link_batch")));
});
