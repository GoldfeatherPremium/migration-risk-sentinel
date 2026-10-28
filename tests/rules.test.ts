// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeMigration, RULES } from "../packages/core/src/index.js";
import { analyzeSql, ids } from "./helpers";

describe("MIG000 syntax", () => {
  it("detects unbalanced parentheses and unterminated strings", () => {
    expect(ids("create table t (id int;")).toContain("MIG000");
    expect(ids("select 'oops;")).toContain("MIG000");
  });
  it("accepts valid SQL", () => {
    expect(ids("create table t (id int);")).not.toContain("MIG000");
  });
});

describe("MIG001 DROP TABLE", () => {
  it("flags drop table", () => expect(ids("drop table if exists public.a;")).toContain("MIG001"));
  it("ignores tables created in the same file and other drops", () => {
    expect(ids("create table tmp (id int); drop table tmp;")).not.toContain("MIG001");
    expect(ids("drop view v;")).not.toContain("MIG001");
  });
});

describe("MIG002 DROP COLUMN", () => {
  it("flags drop column with and without COLUMN keyword", () => {
    expect(ids("alter table users drop column a;")).toContain("MIG002");
    expect(ids("alter table users drop a;")).toContain("MIG002");
  });
  it("ignores drop constraint / drop default", () => {
    expect(ids("alter table users drop constraint c;")).not.toContain("MIG002");
    expect(ids("alter table users alter column a drop default;")).not.toContain("MIG002");
  });
});

describe("MIG003 TRUNCATE", () => {
  it("flags truncate", () => expect(ids("truncate users;")).toContain("MIG003"));
  it("ignores strings mentioning truncate", () =>
    expect(ids("select 'truncate users';")).not.toContain("MIG003"));
});

describe("MIG004 DROP SCHEMA", () => {
  it("flags drop schema", () => expect(ids("drop schema archive cascade;")).toContain("MIG004"));
  it("ignores create schema", () => expect(ids("create schema archive;")).not.toContain("MIG004"));
});

describe("MIG005 DROP INDEX", () => {
  it("flags drop index as warning", () => {
    const r = analyzeSql("drop index users_email_idx;", { rules: { MIG032: "off" } });
    expect(r.findings.find((f) => f.ruleId === "MIG005")?.severity).toBe("warning");
  });
  it("downgrades to info when the index is recreated, and ignores freshly created indexes", () => {
    const r = analyzeSql("drop index i; create index i on t (a);");
    expect(r.findings.find((f) => f.ruleId === "MIG005")?.severity).toBe("info");
    expect(ids("create table t (a int); create index i on t (a); drop index i;")).not.toContain(
      "MIG005",
    );
  });
});

describe("MIG010 NOT NULL column", () => {
  it("flags NOT NULL without default", () =>
    expect(ids("alter table orders add column s text not null;")).toContain("MIG010"));
  it("flags SET NOT NULL and volatile defaults as warnings", () => {
    const r = analyzeSql(
      "alter table o alter column s set not null; alter table o add column t uuid default gen_random_uuid();",
    );
    expect(r.findings.filter((f) => f.ruleId === "MIG010").map((f) => f.severity)).toEqual([
      "warning",
      "warning",
    ]);
  });
  it("allows constant defaults, nullable columns and new tables", () => {
    expect(ids("alter table orders add column s text not null default 'x';")).not.toContain(
      "MIG010",
    );
    expect(ids("alter table orders add column s text;")).not.toContain("MIG010");
    expect(ids("create table o (id int); alter table o add column s text not null;")).not.toContain(
      "MIG010",
    );
    expect(ids("alter table orders add column s text default 'not null';")).not.toContain("MIG010");
  });
});

describe("MIG011 type change", () => {
  it("flags type changes", () => {
    expect(ids("alter table o alter column a type bigint;")).toContain("MIG011");
    expect(ids("alter table o alter a set data type text;")).toContain("MIG011");
  });
  it("ignores other column alterations", () =>
    expect(ids("alter table o alter column a set default 1;")).not.toContain("MIG011"));
});

describe("MIG012 unique", () => {
  it("flags unique constraints and unique indexes", () => {
    expect(ids("alter table u add constraint u_email unique (email);")).toContain("MIG012");
    expect(ids("create unique index concurrently u_email on u (email);")).toContain("MIG012");
  });
  it("ignores USING INDEX and new tables", () => {
    expect(
      ids("alter table u add constraint u_email unique using index u_email_idx;"),
    ).not.toContain("MIG012");
    expect(
      ids("create table u (email text); alter table u add constraint x unique (email);"),
    ).not.toContain("MIG012");
  });
});

describe("MIG013 foreign key", () => {
  it("flags validated foreign keys", () =>
    expect(ids("alter table o add constraint fk foreign key (c) references c (id);")).toContain(
      "MIG013",
    ));
  it("ignores NOT VALID", () =>
    expect(
      ids("alter table o add constraint fk foreign key (c) references c (id) not valid;"),
    ).not.toContain("MIG013"));
});

describe("MIG014 no WHERE", () => {
  it("flags update/delete without where", () => {
    expect(ids("update o set a = 1;")).toContain("MIG014");
    expect(ids("delete from o;")).toContain("MIG014");
    expect(ids("with x as (select 1) delete from o;")).toContain("MIG014");
  });
  it("ignores statements with WHERE, including WHERE inside subqueries only counting at top level", () => {
    expect(ids("update o set a = 1 where id = 2;")).not.toContain("MIG014");
    expect(ids("delete from o where id in (select id from p where x);")).not.toContain("MIG014");
  });
  it("still flags when WHERE only appears in a subquery", () => {
    expect(ids("update o set a = (select max(b) from p where p.id = 1);")).toContain("MIG014");
  });
});

describe("MIG015 broad WHERE", () => {
  it("flags trivially true predicates as warning and broad predicates as info", () => {
    const r = analyzeSql("update o set a = 1 where true; update o set a = 1 where a is null;", {
      rules: { MIG032: "off" },
    });
    expect(r.findings.filter((f) => f.ruleId === "MIG015").map((f) => f.severity)).toEqual([
      "warning",
      "info",
    ]);
  });
  it("ignores selective predicates", () =>
    expect(ids("delete from o where id = 5;")).not.toContain("MIG015"));
});

describe("MIG020 CREATE INDEX without CONCURRENTLY", () => {
  it("flags plain create index", () => expect(ids("create index i on o (a);")).toContain("MIG020"));
  it("ignores concurrent and new-table indexes", () => {
    expect(ids("create index concurrently i on o (a);")).not.toContain("MIG020");
    expect(ids("create table o (a int); create index i on o (a);")).not.toContain("MIG020");
  });
});

describe("MIG021 CONCURRENTLY in transaction", () => {
  it("flags concurrent index inside BEGIN/COMMIT", () => {
    expect(ids("begin; create index concurrently i on o (a); commit;")).toContain("MIG021");
    expect(ids("begin; drop index concurrently i; commit;")).toContain("MIG021");
  });
  it("ignores concurrent index outside a transaction unless implicit transactions are assumed", () => {
    expect(ids("create index concurrently i on o (a);")).not.toContain("MIG021");
    expect(ids("begin; commit; create index concurrently i on o (a);")).not.toContain("MIG021");
    expect(
      ids("select 1; create index concurrently i on o (a);", { assumeImplicitTransaction: true }),
    ).toContain("MIG021");
  });
});

describe("MIG022 expensive rebuild", () => {
  it("flags REINDEX, CLUSTER, VACUUM FULL", () => {
    expect(ids("reindex table o;")).toContain("MIG022");
    expect(ids("cluster o using i;")).toContain("MIG022");
    expect(ids("vacuum full o;")).toContain("MIG022");
  });
  it("ignores plain vacuum and analyze", () => {
    expect(ids("vacuum o;")).not.toContain("MIG022");
    expect(ids("analyze o;")).not.toContain("MIG022");
  });
});

describe("MIG023 repeated locks", () => {
  it("flags three ALTERs on the same table", () => {
    expect(
      ids(
        "alter table o add column a int; alter table o add column b int; alter table o add column c int;",
      ),
    ).toContain("MIG023");
  });
  it("respects the threshold option and ignores a single combined statement", () => {
    expect(
      ids("alter table o add column a int, add column b int, add column c int;"),
    ).not.toContain("MIG023");
    expect(
      ids("alter table o add column a int; alter table o add column b int;", {
        rules: { MIG023: { options: { threshold: 2 } } },
      }),
    ).toContain("MIG023");
  });
});

describe("MIG030 duplicates", () => {
  it("flags duplicate creates across files", () => {
    const r = analyzeMigration({
      files: [
        { path: "1.sql", content: "create table a (id int);" },
        { path: "2.sql", content: "create table a (id int);" },
      ],
    });
    expect(r.findings.map((f) => f.ruleId)).toContain("MIG030");
  });
  it("ignores IF NOT EXISTS and drop-then-recreate", () => {
    const r = analyzeMigration({
      files: [
        {
          path: "1.sql",
          content: "create table a (id int); create table if not exists b (id int);",
        },
        {
          path: "2.sql",
          content: "create table if not exists b (id int); drop table a; create table a (id int);",
        },
      ],
    });
    expect(r.findings.map((f) => f.ruleId)).not.toContain("MIG030");
  });
});

describe("MIG031 ordering", () => {
  it("flags references to tables created in later files", () => {
    const r = analyzeMigration({
      files: [
        { path: "2_b.sql", content: "create table b (id int);" },
        { path: "1_a.sql", content: "alter table b add column x int;" },
      ],
    });
    expect(r.findings.find((f) => f.ruleId === "MIG031")?.file).toBe("1_a.sql");
  });
  it("ignores correct ordering", () => {
    const r = analyzeMigration({
      files: [
        { path: "1.sql", content: "create table b (id int);" },
        { path: "2.sql", content: "alter table b add column x int;" },
      ],
    });
    expect(r.findings.map((f) => f.ruleId)).not.toContain("MIG031");
  });
});

describe("MIG032 explicit transaction", () => {
  it("flags multi-DDL files without BEGIN", () => {
    expect(
      analyzeSql("create table a (id int); create table b (id int);").findings.map((f) => f.ruleId),
    ).toContain("MIG032");
  });
  it("ignores wrapped files and concurrent files", () => {
    expect(
      analyzeSql("begin; create table a (id int); create table b (id int); commit;").findings.map(
        (f) => f.ruleId,
      ),
    ).not.toContain("MIG032");
    expect(
      analyzeSql(
        "create index concurrently i on a (x); create index concurrently j on a (y);",
      ).findings.map((f) => f.ruleId),
    ).not.toContain("MIG032");
  });
});

describe("MIG033 recovery plan", () => {
  it("flags destructive files without recovery notes", () => {
    expect(analyzeSql("drop table a;").findings.map((f) => f.ruleId)).toContain("MIG033");
  });
  it("accepts a recovery comment", () => {
    expect(
      analyzeSql("-- recovery: restore from snapshot\ndrop table a;").findings.map((f) => f.ruleId),
    ).not.toContain("MIG033");
  });
});

describe("MIG034 empty", () => {
  it("flags empty and comment-only files", () => {
    expect(ids("")).toEqual(["MIG034"]);
    expect(ids("-- nothing\n/* here */")).toEqual(["MIG034"]);
  });
  it("ignores files with SQL", () => expect(ids("select 1;")).toEqual([]));
});

describe("rule registry", () => {
  it("has unique IDs and full metadata", () => {
    const seen = new Set<string>();
    for (const r of RULES) {
      expect(seen.has(r.id)).toBe(false);
      seen.add(r.id);
      expect(r.description && r.rationale && r.remediation).toBeTruthy();
      expect(r.limitations.length).toBeGreaterThan(0);
    }
  });
});
