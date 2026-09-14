import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const event = "10000000-0000-4000-8000-000000000001";
const otherEvent = "10000000-0000-4000-8000-000000000002";
const team = "20000000-0000-4000-8000-000000000001";
const otherTeam = "20000000-0000-4000-8000-000000000002";
const secondTeam = "20000000-0000-4000-8000-000000000003";
const actor = "30000000-0000-4000-8000-000000000001";
const link = "40000000-0000-4000-8000-000000000001";
const staff = "40000000-0000-4000-8000-000000000002";
const batch = "50000000-0000-4000-8000-000000000001";
const photo = "60000000-0000-4000-8000-000000000001";
const photo2 = "60000000-0000-4000-8000-000000000002";
const files = JSON.stringify([
  { id: photo, name: "photo.jpg", type: "image/jpeg", size: 1000 },
]);
test("photo migration and access rules execute in PostgreSQL", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema storage;
 create table public.m2m_events(id uuid primary key);
 create table public.m2m_profiles(id uuid primary key);
 create table public.m2m_fourballs(id uuid primary key,event_id uuid references m2m_events(id),unique(id,event_id));
 create table public.m2m_audit_events(event_id uuid,actor_profile_id uuid,action text,entity_type text,entity_id text,metadata jsonb);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 grant all on all tables in schema public to service_role;
 insert into m2m_events values('${event}'),('${otherEvent}');
 insert into m2m_profiles values('${actor}');
 insert into m2m_fourballs values('${team}','${event}'),('${secondTeam}','${event}'),('${otherTeam}','${otherEvent}');
 `);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260914155811_golf_day_photos.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260914164309_photo_cart_link_batches.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`insert into m2m_photo_settings(event_id) values('${event}');
 insert into m2m_photo_links(id,event_id,fourball_id,kind,token_hash,created_by) values('${link}','${event}','${team}','gallery','gallery-hash','${actor}'),('${staff}','${event}',null,'staff','staff-hash','${actor}');`);
  async function isolated(name, fn) {
    await t.test(name, async () => {
      await db.exec("begin");
      try {
        await fn();
      } finally {
        await db.exec("rollback");
      }
    });
  }
  const batchLinks = (key = "a".repeat(64), ids = [team, secondTeam]) =>
    db.query("select * from m2m_photo_issue_link_batch($1,$2,$3,$4::jsonb)", [
      key,
      event,
      actor,
      JSON.stringify(
        ids.map((id, i) => ({
          fourball_id: id,
          token_hash: key.slice(0, 60) + String(i).padStart(4, "0"),
        })),
      ),
    ]);
  await isolated(
    "admin batches create more than ten links immediately and replay without duplicates",
    async () => {
      const ids = Array.from(
        { length: 30 },
        (_, i) => `90000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      );
      for (const id of ids)
        await db.query("insert into m2m_fourballs values($1,$2)", [id, event]);
      const first = await batchLinks("a".repeat(64), ids);
      const retry = await batchLinks("a".repeat(64), ids);
      assert.equal(first.rows.length, 30);
      assert.deepEqual(
        first.rows.map((r) => r.id).sort(),
        retry.rows.map((r) => r.id).sort(),
      );
      assert.equal(
        (await db.query("select count(*)::int n from m2m_photo_link_batches"))
          .rows[0].n,
        1,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from m2m_audit_events where action='photos.links_batch_created'",
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await isolated("batch replay cannot change its fourballs", async () => {
    await batchLinks();
    await assert.rejects(
      batchLinks("a".repeat(64), [team]),
      /photo_batch_invalid/,
    );
  });
  await isolated("cross-event batches insert nothing", async () => {
    await db.exec("savepoint invalid_batch");
    await assert.rejects(
      batchLinks("a".repeat(64), [team, otherTeam]),
      /photo_tags_invalid/,
    );
    await db.exec("rollback to savepoint invalid_batch");
    assert.equal(
      (await db.query("select count(*)::int n from m2m_photo_link_batches"))
        .rows[0].n,
      0,
    );
  });
  await isolated(
    "five new batches allowed but replays do not count again",
    async () => {
      for (const key of ["a", "b", "c", "d", "e"])
        await batchLinks(key.repeat(64));
      await batchLinks();
      await assert.rejects(
        batchLinks("f".repeat(64)),
        /photo_batch_rate_limit/,
      );
    },
  );
  await isolated(
    "batch records and RPC are inaccessible to public roles",
    async () => {
      for (const role of ["anon", "authenticated"]) {
        const result = await db.query(
          `select has_function_privilege('${role}','m2m_photo_issue_link_batch(text,uuid,uuid,jsonb)','execute') fn, has_table_privilege('${role}','m2m_photo_link_batches','select') tbl`,
        );
        assert.deepEqual(result.rows[0], { fn: false, tbl: false });
      }
    },
  );
  const reserve = (id = link, tags = [team], items = files) =>
    db.query("select * from m2m_photo_reserve($1,$2,$3::jsonb,$4::uuid[])", [
      id,
      batch,
      items,
      tags,
    ]);
  await isolated(
    "only service role can call capability functions or read private records",
    async () => {
      for (const role of ["anon", "authenticated"]) {
        const access = await db.query(
          `select has_function_privilege('${role}','m2m_photo_access(text)','execute') ok`,
        );
        assert.equal(access.rows[0].ok, false);
        const tables = await db.query(
          `select has_table_privilege('${role}','m2m_photos','select') ok`,
        );
        assert.equal(tables.rows[0].ok, false);
      }
      const rls = await db.query(
        "select relrowsecurity from pg_class where relname in ('m2m_photos','m2m_photo_links','m2m_photo_fourballs','m2m_photo_batches','m2m_photo_settings')",
      );
      assert.equal(rls.rows.length, 5);
      assert.ok(rls.rows.every((r) => r.relrowsecurity));
      const buckets = await db.query("select public from storage.buckets");
      assert.ok(buckets.rows.every((r) => !r.public));
      await db.exec("set local role service_role");
      const result = await reserve();
      assert.equal(result.rows.length, 1);
    },
  );
  await isolated(
    "reservation is pending and retries do not duplicate rows or quota",
    async () => {
      const first = await reserve();
      assert.equal(first.rows[0].status, "pending");
      assert.equal(first.rows[0].upload_status, "uploading");
      const retry = await reserve();
      assert.equal(retry.rows[0].id, photo);
      assert.equal(
        (await db.query("select count(*)::int n from m2m_photos")).rows[0].n,
        1,
      );
    },
  );
  await isolated("gallery links cannot tag another fourball", async () => {
    await assert.rejects(reserve(link, [secondTeam]), /photo_tags_invalid/);
  });
  await isolated("staff links cannot tag another event", async () => {
    await assert.rejects(reserve(staff, [otherTeam]), /photo_tags_invalid/);
  });
  await isolated(
    "staff can link several fourballs and general photos can be untagged",
    async () => {
      await reserve(staff, [team, secondTeam]);
      assert.equal(
        (await db.query("select count(*)::int n from m2m_photo_fourballs"))
          .rows[0].n,
        2,
      );
      await db.query("select m2m_photo_retag($1,$2,$3::uuid[])", [
        staff,
        photo,
        [],
      ]);
      assert.equal(
        (await db.query("select count(*)::int n from m2m_photo_fourballs"))
          .rows[0].n,
        0,
      );
    },
  );
  await isolated("incomplete files cannot be approved", async () => {
    await reserve();
    await assert.rejects(
      db.query("select m2m_photo_moderate($1,$2::uuid[],$3,$4)", [
        event,
        [photo],
        actor,
        "approved",
      ]),
      /photo_not_ready/,
    );
  });
  await isolated(
    "approval, withdrawal and retagging are atomic and audited",
    async () => {
      await reserve();
      await db.query(
        "update m2m_photos set upload_status='complete',original_path='full.jpg',preview_path='preview.webp' where id=$1",
        [photo],
      );
      await db.query(
        "select m2m_photo_moderate($1,$2::uuid[],$3,$4,$5::uuid[])",
        [event, [photo], actor, "approved", [team, secondTeam]],
      );
      assert.equal(
        (await db.query("select status from m2m_photos")).rows[0].status,
        "approved",
      );
      assert.equal(
        (await db.query("select count(*)::int n from m2m_audit_events")).rows[0]
          .n,
        1,
      );
      await db.query("select m2m_photo_moderate($1,$2::uuid[],$3,$4)", [
        event,
        [photo],
        actor,
        "pending",
      ]);
      assert.equal(
        (await db.query("select status from m2m_photos")).rows[0].status,
        "pending",
      );
    },
  );
  await isolated("contributors cannot retag an approved photo", async () => {
    await reserve();
    await db.exec(
      "update m2m_photos set upload_status='complete',original_path='x',preview_path='y',status='approved'",
    );
    await assert.rejects(
      db.query("select m2m_photo_retag($1,$2,$3::uuid[])", [link, photo, []]),
      /photo_not_ready/,
    );
  });
  await isolated("revoked access cannot reserve or authenticate", async () => {
    await db.query("update m2m_photo_links set revoked_at=now() where id=$1", [
      link,
    ]);
    await assert.rejects(
      db.query("select m2m_photo_access($1)", ["gallery-hash"]),
      /photo_link_invalid/,
    );
  });
  await isolated("expired links cannot reserve", async () => {
    await db.query(
      "update m2m_photo_links set expires_at=now()-interval '1 second' where id=$1",
      [link],
    );
    await assert.rejects(reserve(), /photo_link_invalid/);
  });
  await isolated("uploads stop when the event is closed", async () => {
    await db.exec("update m2m_photo_settings set uploads_enabled=false");
    await assert.rejects(reserve(), /photo_uploads_closed/);
  });
  await isolated(
    "event photo quotas cannot be exceeded by a batch",
    async () => {
      await db.exec("update m2m_photo_settings set photo_limit=1");
      await assert.rejects(
        reserve(
          link,
          [team],
          JSON.stringify([
            { id: photo, name: "a.jpg", type: "image/jpeg", size: 1 },
            { id: photo2, name: "b.jpg", type: "image/jpeg", size: 1 },
          ]),
        ),
        /photo_quota_exceeded/,
      );
    },
  );
  await isolated("byte quotas include uploading files", async () => {
    await db.exec("update m2m_photo_settings set byte_limit=999");
    await assert.rejects(reserve(), /photo_quota_exceeded/);
  });
  await isolated("rate limiting rejects exhausted links", async () => {
    await db.query("update m2m_photo_links set rate_count=240 where id=$1", [
      link,
    ]);
    await assert.rejects(
      db.query("select m2m_photo_access($1)", ["gallery-hash"]),
      /photo_rate_limit/,
    );
  });
  await isolated(
    "batch IDs cannot be claimed by another contributor",
    async () => {
      await reserve();
      await assert.rejects(reserve(staff), /photo_batch_invalid/);
    },
  );
});
